---
title: "一次 Step 为什么决定 GPU block 能不能释放？LMCache Lazy Offload 与 vLLM 调度器保活"
description: "从 vLLM Step 消息泵、Scheduler/Worker/Cache Service 三方边界出发，解释 LMCache PR #4998 为什么只为 in-flight lazy store 保活，以及没有它时最后一批 GPU blocks 为什么会延迟释放。"
publishedAt: 2026-09-08
updatedAt: 2026-09-08
category: AI Infra
tags:
  - lmcache
  - vllm
  - kv-cache
  - scheduler
  - lazy-offload
  - distributed-systems
author: 毛宝龙
readingTime: 16 min
featured: true
draft: false
---

看 [LMCache PR #4998](https://github.com/LMCache/LMCache/pull/4998) 时，很容易卡在同一个问题上：

> PR #4434 不是已经在 lazy offload 完成后调用 `free_blocks()` 了吗？为什么还要增加 `has_pending_push_work()`，让 vLLM 在没有用户请求时继续 Step？

关键不在于“有没有写释放代码”，而在于**释放代码由谁执行、完成消息怎样到达它**。

在 LMCache MP lazy offload 中：

- Model Worker 知道异步 store 何时完成；
- Scheduler 才拥有 vLLM `BlockPool`，也只有它能改变 block 的可复用状态；
- worker 的完成信息必须借下一次 vLLM Step 回到 Scheduler；
- 如果最后一个请求结束后 Engine 不再 Step，完成信息就会停在 worker 侧，Scheduler 中已有的 `free_blocks()` 没有执行机会。

所以 PR #4998 做的不是“增加一种释放方式”，而是补齐已有释放链路的最后一次驱动：

```text
worker store 完成
      ↓
继续一次 connector-only Step
      ↓
completion 回到 Scheduler
      ↓
Scheduler 调用 free_blocks()
```

下面从 vLLM 的 Step 循环开始，把这条因果链完整串起来。

## Step 不只是一次模型 forward

一次 vLLM Engine Step 至少做三件事：

1. Scheduler 判断还有没有工作，并选择本轮请求、token 和 KV blocks；
2. Model Executor 执行模型，或者在零 token 时只执行 connector 控制逻辑；
3. Scheduler 消费 `ModelRunnerOutput`，更新请求状态和 connector 状态。

因此，接入异步 KV Connector 后，Step 同时还是一个**消息泵**：Scheduler 向 worker 发送 connector metadata，worker 再通过输出把 transfer completion 带回 Scheduler。

![vLLM Step 调度循环与 connector 消息泵](/images/blog/lmcache-lazy-offload-liveness/vllm-step-loop.svg)

入口在 `EngineCore.step()`：

```python
if not self.scheduler.has_requests():
    return {}, False

scheduler_output = self.scheduler.schedule(...)
model_output = self.model_executor.execute_model(scheduler_output, ...).result()
self.scheduler.update_from_output(scheduler_output, model_output)
```

也就是说，`Scheduler.has_requests()` 一旦返回 `False`，后面的 `schedule → execute_model → update_from_output` 整条链都不会发生。[EngineCore.step()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/engine/core.py#L608-L638)

当前 vLLM 用三类状态决定 Engine 是否继续：

```python
return (
    self.has_unfinished_requests()
    or self.has_finished_requests()
    or self.connector.has_pending_push_work()
)
```

| 保活来源 | 表示什么 | 下一轮 Step 推进什么 |
|---|---|---|
| unfinished requests | waiting/running 中仍有请求 | 正常调度 token 和 forward |
| finished requests | 请求已生成完，但 connector delayed-free 未完成 | 收 transfer completion，完成普通延迟释放 |
| connector pending push work | request 生命周期外仍有 connector 工作 | 继续搬运 connector completion |

第三项就是 PR #4998 接入的位置。[Scheduler.has_requests()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/core/sched/scheduler.py#L2641-L2668)

名字虽然是 `has_pending_push_work()`，它在这里表达的实际问题更一般：

> Connector 是否还有只能依靠下一次 Engine Step 才能推进的工作？

## 三个角色，两条通信链路

“Lazy offload 运行在 vLLM 进程里”并不等于“所有逻辑都在同一个对象里”。LMCache MP Connector 至少涉及三个角色：

- **Scheduler-side connector**：参与命中查询、请求生命周期、block allocation 上报和 lazy offload 状态管理；
- **Worker-side connector**：直接接触 KV tensor，提交 store/retrieve，并轮询异步 future；
- **LMCache Server / Cache Service**：提供跨进程缓存服务和会话/控制能力。

Cache Service 并非只和 Model Worker 通信。Scheduler 侧通过 `scheduler_adapter` 与它交换 lookup、lock/session、allocation telemetry 等控制信息；Worker 侧则通过 `worker_adapter` 传输 KV 数据。与此同时，worker completion 不是由 Cache Service 直接修改 Scheduler，而是通过 vLLM 的 `ModelRunnerOutput` 返回。

![Scheduler、Model Worker 与 LMCache Server 的控制面和数据面](/images/blog/lmcache-lazy-offload-liveness/role-boundaries.svg)

这张图里有两条不同的链：

```text
LMCache 控制面：Scheduler-side connector ↔ Cache Service
KV 数据面：    Model Worker ↔ Cache Service
vLLM 内部链：  Scheduler → SchedulerOutput → Worker
               Worker → ModelRunnerOutput → Scheduler
```

它们不能互相替代。Cache Service 可以确认 store RPC 完成，Worker 可以把它记为 completed，但只有 Scheduler 能改变自己维护的 `BlockPool` 引用和可分配状态。

对应到关键状态：

| 状态 | 所在位置 | 含义 |
|---|---|---|
| `BlockPool` | vLLM Scheduler | block 是否仍有引用、能否重新分配 |
| FIFO pending metadata | Scheduler-side connector | 计划以后 offload，但尚未发给 worker |
| `_request_block_ids` | Scheduler-side connector | store 已提交；这些 blocks 正等待 completion 后释放 |
| store futures | Worker-side adapter | 发往 Cache Service 的异步传输 |
| `completed_store_requests` | Worker-side adapter | 已完成、等待随 vLLM 输出上报的请求 |

这就是为什么“Worker 自己 lazy offload 完成”不能自动推出“GPU blocks 已经 free”。它只说明数据面完成了；Scheduler 还必须消费这个事实。

## 普通 offload 为什么不需要这个 PR

普通非 lazy 路径使用 vLLM 原生 delayed-free 协议。

请求结束时，connector 的 `request_finished()` 返回 `True`，含义是：

> 这个请求还在异步发送，请先不要释放它的 blocks；等 `get_finished()` 返回 request ID 后再释放。

虽然请求已经不再生成 token，它仍保留在 Scheduler 的 request bookkeeping 中。因此 `has_finished_requests()` 可以看到它，Engine 会继续 Step：

```text
request_finished() → True
        ↓
vLLM 保留 finished request 与 blocks
        ↓
has_finished_requests() → True
        ↓
继续 Step、轮询 get_finished()
        ↓
vLLM 完成 delayed-free
```

普通路径已经有自己的存活信号，不需要 LMCache 再用 `has_pending_push_work()` 重复保活。

## Lazy offload 为什么脱离了普通 delayed-free

[PR #4434](https://github.com/LMCache/LMCache/pull/4434) 引入 lazy offload，是为了先在 Scheduler 侧积累 store metadata，再按策略成批选择已完成请求，而不是每产生一小段 KV 就立即提交 store。

这使一个 lazy store 分成两个阶段：

![Lazy offload 从 queued 到 in-flight 再到 freed](/images/blog/lmcache-lazy-offload-liveness/pending-state-machine.svg)

### Queued：计划要存，但还没有提交

正常 token Step 产生的 store metadata 先进入 FIFO。请求结束时，lazy 路径调用 `mark_req_finished()`，然后从 `request_finished()` 返回 `False`：

```python
if self.lazy_offload:
    self._pending_store.mark_req_finished(request.request_id)
    return False, ...
```

这里的 `False` 是在告诉 vLLM：**不要把该请求留在普通 delayed-free 生命周期里**。请求原来的 blocks 可以照常进入 vLLM 的缓存/复用流程；FIFO 中保存旧 block hash，等待未来真正选择 store 时再验证内容是否仍然一致。

这个阶段只有“待办 metadata”，worker 还没有收到 store，自然也没有 completion 可以收。

### In-flight：已经提交，正在等完成回执

当 FIFO 策略允许 offload，并且某一轮真的调度了模型 token，Scheduler-side connector 会：

1. 从 FIFO 取出请求；
2. `BlockPool.touch()`，为将要传输的 blocks 增加引用；
3. 重新比较 block hash，确认内容尚未被复用覆盖；
4. 把 STORE metadata 交给 worker；
5. 把 block IDs 写入 `_request_block_ids`。

从这一刻起，store 已经 in-flight，blocks 也已因这次异步传输被 pin。它们必须等所有 worker 的 completion 回到 Scheduler 后才能解除引用。[Lazy store 提交路径](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1479-L1517)

Scheduler 侧的释放代码原本就存在：

```python
for req_id, count in meta.completed_store_requests.items():
    if self.scheduler_adapter.update_pending_store_count(req_id, count):
        gpu_block_ids = self._pending_store.get_request_gpu_block_ids(req_id)
        self._gpu_block_pool.free_blocks(...)
        self._pending_store.remove_request_gpu_block_ids(req_id)
```

所以缺的不是 `free_blocks()`，而是**最后一个用户请求消失后，谁保证这段代码还能被调用一次**。[Scheduler-side completion handling](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1237-L1248)

## 问题只在一个窄窗口里发生

假设请求 A 已被选中 lazy offload，请求 B 是系统里最后一个仍在生成的请求：

1. Scheduler `touch()` A 的 blocks，把 STORE metadata 发给 worker；
2. Worker 异步向 Cache Service 写 A；
3. B 在 A 的 store completion 回来之前结束；
4. Scheduler 此时已没有 waiting、running 或普通 delayed-free request；
5. 如果 connector 也报告没有 pending work，`has_requests()` 就变成 `False`；
6. Worker 随后完成 A，但 Engine 已经停止 Step；
7. completion 留在 worker，Scheduler 的 `_request_block_ids[A]` 和 block 引用没有清掉。

![最后一个请求结束时，没有和有 connector keepalive 的差别](/images/blog/lmcache-lazy-offload-liveness/idle-gap-timeline.svg)

这也是为什么它常见于测试收尾、突发流量结束或服务进入空闲的边界，而不是持续满载期间。只要一直有别的请求推动 Step，completion 总有机会顺便回来。

如果服务从此再也没有请求，逻辑 block 暂时不归还通常没有用户可见影响；KV cache tensor 本来也往往整体驻留在 GPU 上，`free_blocks()` 主要是归还 vLLM allocator 中的可复用资格，并非把对应显存立刻退还 CUDA driver。

真正的影响出现在下一批请求到达时。没有这次 idle 收尾，Scheduler 可能先基于偏小的可用 BlockPool 做第一次 allocate，然后才在本轮末尾收到旧 completion：

```text
新请求到达
    ↓
Scheduler 尝试 allocate（旧 blocks 仍被 pin）
    ↓
空间足够：照常执行，但本轮容量偏小
空间不足：等待 / 抢占 / 先跑一轮 no-forward
    ↓
旧 completion 回来，free_blocks()
    ↓
下一轮才看到完整可用容量
```

因此，这不是典型的“显存不断增长直到 OOM”，也不是 worker store 永久死锁；更准确的描述是：**上一批请求的控制面收尾被拖到下一批流量，令新 burst 的第一个调度周期看到陈旧的 block 可用状态。**

## PR #4998 只为能够推进的状态保活

修正后的 PR 用 `_request_block_ids` 判断是否还有 in-flight store：

```python
def has_inflight_store_work(self) -> bool:
    return bool(self._request_block_ids)
```

Connector 只在 Scheduler role 且启用 lazy offload 时返回它：

```python
def has_pending_push_work(self) -> bool:
    if self.role != KVConnectorRole.SCHEDULER or not self.lazy_offload:
        return False

    pending_store = getattr(self, "_pending_store", None)
    return (
        pending_store is not None
        and pending_store.has_inflight_store_work()
    )
```

[PR #4998 的 keepalive 实现](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1319-L1333)

于是 in-flight 路径能够自然收敛：

```text
_request_block_ids 非空
        ↓
has_pending_push_work() = True
        ↓
Scheduler.has_requests() = True
        ↓
执行零 token connector-only Step
        ↓
worker completion 随 ModelRunnerOutput 返回
        ↓
update_connector_output() → free_blocks()
        ↓
删除 _request_block_ids
        ↓
has_pending_push_work() = False，Engine 安全 idle
```

这里必须强调“能够推进”。零 token Step 可以轮询已提交 store 的 completion，但当前不能把 FIFO 中尚未提交的 queued metadata 交给 worker。LMCache 只在 `scheduler_output.total_num_scheduled_tokens > 0` 时调用 lazy store 提交流程，因为 vLLM 的 no-forward connector 路径不能可靠承载这些 store ops。[正 token 提交条件](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1471-L1477)

因此 PR 明确不把 queued-only 算进 keepalive：

| 状态 | `has_pending_push_work()` | 原因 |
|---|---:|---|
| 只有 FIFO queued metadata | `False` | 空 Step 无法提交，保活也不会前进；等下一次正 token Step |
| `_request_block_ids` 非空 | `True` | 空 Step 能收 completion 并释放 blocks |
| completion 已被 Scheduler 消费 | `False` | 生命周期已经闭环，可以 idle |
| 非 lazy 模式 | `False` | 由 vLLM 普通 delayed-free 保活 |

这是一条很重要的调度原则：

> Keepalive 信号不能只表示“还有东西”；它必须表示“再执行一轮，状态有机会向前推进”。

queued-only 的主动 drain 可以将来单独设计，例如让 connector-only Step 真正支持提交 store、增加明确的唤醒事件或采用独立后台进度机制。但在这些能力存在之前，不为它保活比无进展地无限空转更安全。

## 把整件事压缩成一句话

PR #4434 已经写好了 Scheduler 侧的 `free_blocks()`，PR #4998 补的是抵达这行代码所需的最后一次 Step。

Worker 完成 store 只是数据面事实；completion 经 vLLM 输出回到 Scheduler，才是生命周期真正结束。修正后的实现只为 in-flight store 保活，因为零 token Step 能让它从“等待完成”走向“释放”；queued-only 目前留给下一次有模型 token 的 Step，不用一个无法推进的信号强行维持 Engine 空转。

## 参考资料

- [LMCache PR #4998：Add pending push work hook for MP lazy offload](https://github.com/LMCache/LMCache/pull/4998)
- [LMCache PR #4434：Support lazy offload](https://github.com/LMCache/LMCache/pull/4434)
- [vLLM PR #35264：引入 has_pending_push_work](https://github.com/vllm-project/vllm/pull/35264)
- [vLLM PR #43433：delayed KV connector cleanup 的 Scheduler 保活](https://github.com/vllm-project/vllm/pull/43433)
- [vLLM EngineCore.step()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/engine/core.py#L608-L638)
- [vLLM Scheduler.has_requests()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/core/sched/scheduler.py#L2641-L2668)
