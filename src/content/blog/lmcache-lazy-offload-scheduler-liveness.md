---
title: "为什么最后一个请求结束后还不能停？LMCache Lazy Offload 与 vLLM 调度器保活机制"
description: "从 vLLM Engine Step、Scheduler 存活判断和 BlockPool 所有权讲起，完整拆解 LMCache PR #4434 与 #4998：worker 已经完成 store，为什么 block 仍可能无法释放，以及 queued-only 路径为何还没有闭环。"
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
readingTime: 22 min
featured: true
draft: false
---

在阅读 [LMCache PR #4998](https://github.com/LMCache/LMCache/pull/4998) 时，第一眼很容易产生一个疑问：它只是增加了几个 `has_pending_work()`，最后在 `LMCacheMPConnector` 上实现了 `has_pending_push_work()`，为什么值得单独修？

更直觉的质疑是：

> Lazy offload 本来就运行在 vLLM 体系里，PR #4434 也已经调用了 `self._gpu_block_pool.free_blocks()`。既然 worker 存完以后会释放 block，为什么还要让 Scheduler 继续空转？如果一直没有新请求，不释放又有什么影响？

这些问题的答案不在某一行代码里，而在四件事的交界处：

1. vLLM 的 Engine 为什么继续或者停止 Step；
2. Scheduler 和 Model Worker 分别拥有什么状态；
3. worker 的异步 store completion 怎样回到 Scheduler；
4. lazy offload 中 queued 与 in-flight 是两个完全不同的阶段。

本文从这四个边界开始，把 PR #4434 建立的 lazy-offload 生命周期、PR #4998 想补的调度器保活，以及当前实现尚未闭环的部分串成一条完整因果链。

先给出结论：

> `has_pending_push_work()` 不是让 KV store 更快，也不是替代 `free_blocks()`；它是在最后一个用户请求结束后，继续驱动几轮 Engine Step，把 worker 已经完成的 store 回执送回 Scheduler，让 Scheduler 真正执行已有的 `free_blocks()`。

但是，PR #4998 同时把尚未提交的 FIFO metadata 也算作 pending。当前零 token Step 只能收 completion，不能把 FIFO 项目提交给 worker，因此 queued-only 路径仍然存在持续空转风险。

## 一、先建立最重要的心智模型：Engine Step 也是消息泵

我们通常把一次 vLLM Engine Step 理解为一次模型调度与执行：Scheduler 选择请求、分配 KV blocks，Model Worker 执行 forward，最后返回 token。

但接入异步 KV Connector 后，一次 Step 还有第二层职责：

> 它是 Scheduler 与 worker-side connector 之间搬运控制信息和完成状态的消息泵。

简化后的主循环如下：

```text
输入队列收到请求
      ↓
Scheduler.has_requests()
      ↓ true
Scheduler.schedule()
      ↓
ModelExecutor.execute_model()
      ↓
ModelRunnerOutput
      ↓
Scheduler.update_from_output()
      ↓
下一轮
```

如果 `Scheduler.has_requests()` 返回 `False`，`EngineCore.step()` 会直接返回，不再调用 `schedule()` 和 `execute_model()`。vLLM 当前代码的判断非常直接：没有 Scheduler work，就没有新的一轮模型执行与 connector 输出。[EngineCore.step()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/engine/core.py#L608-L620)

这里的“没有请求”并不只是 HTTP 层没有新流量，而是 Scheduler 认为以下几类工作都不存在：

```python
return (
    self.has_unfinished_requests()
    or self.has_finished_requests()
    or self.connector.has_pending_push_work()
)
```

三项分别表示：

| 存活来源 | Scheduler 看到的状态 | 为什么还要 Step |
|---|---|---|
| unfinished requests | waiting / running 中还有请求 | 继续正常生成 |
| finished requests | 请求已结束，但 connector delayed-free 尚未完成 | 收取 transfer completion 并释放 blocks |
| connector pending work | 正常 request 生命周期外，connector 自己还有后台工作 | 继续驱动 connector 控制面 |

第三项就是 PR #4998 接入的钩子。[Scheduler.has_requests()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/core/sched/scheduler.py#L2641-L2668)

这个接口最初随 vLLM 的 NIXL P→D push 能力引入，名字因此叫 `has_pending_push_work()`。[vLLM PR #35264](https://github.com/vllm-project/vllm/pull/35264) 目前接口注释里也保留了 TODO：未来应该用一个更通用的 connector keepalive 机制代替它。[KVConnectorBase_V1](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/distributed/kv_transfer/kv_connector/v1/base.py#L586-L597)

所以虽然 LMCache lazy offload 不是传统意义上的 P→D push，复用这个 API 仍然符合它当前的实际语义：

> Connector 是否还有必须依靠 Engine 继续 Step 才能推进的工作？

## 二、都在 vLLM 里，不代表都在同一个对象里

第二个容易混淆的地方是“进程”这个词。

LMCache lazy offload 的确运行在 vLLM 进程体系中。但 `LMCacheMPConnector` 会按 `KVConnectorRole` 创建不同角色的实例：

- Scheduler role 的实例服务于 EngineCore/Scheduler；
- Worker role 的实例服务于 Model Worker；
- LMCache Server 则是 MP connector 对接的缓存服务进程。

在常见 executor 配置下，Scheduler 与 Model Worker 是不同进程。即使某个部署后端让它们落在同一个 OS 进程中，它们仍然是角色不同、状态不同的 connector 实例，必须沿 vLLM 定义的 SchedulerOutput/ModelRunnerOutput 生命周期交换信息。

![LMCache MP lazy offload 的角色与所有权](/images/blog/lmcache-lazy-offload-liveness/role-boundaries.svg)

PR #4434 的构造代码已经把边界写得很清楚：

```python
if self.role == KVConnectorRole.SCHEDULER:
    self.scheduler_adapter = LMCacheMPSchedulerAdapter(...)
    self._gpu_block_pool = None
    self._pending_store = LazyOffloadPendingStore(...)

elif self.role == KVConnectorRole.WORKER:
    self.worker_adapter = LMCacheMPWorkerAdapter(...)
```

只有 Scheduler role 创建并绑定 `_gpu_block_pool` 与 `_pending_store`；Worker role 持有的是 `worker_adapter`。[PR #4434 中的角色初始化](https://github.com/LMCache/LMCache/blob/0dd39f6346f757105cc7406c9429b253d6e74b12/lmcache/integration/vllm/lmcache_mp_connector.py#L328-L371)

这不是代码组织习惯，而是所有权约束：

| 对象/状态 | 所有者 | 用途 |
|---|---|---|
| `BlockPool` | vLLM Scheduler | 决定 block 是否被占用、缓存、淘汰或再次分配 |
| `_pending_store` | Scheduler-side connector | 缓存尚未提交的 store metadata，并跟踪已 pin 的 block IDs |
| `store_futures` | Worker adapter | 跟踪发送到 LMCache Server 的异步 store |
| `completed_store_requests` | Worker adapter | 暂存已经完成、等待上报的请求 |
| `LMCacheMPWorkerMetadata` | Worker → Scheduler 消息 | 把各 worker 的完成数聚合回 Scheduler |

因此，worker 能访问 KV tensor、能查询 store future，也不等于它拥有 Scheduler 的 BlockPool 分配状态。

## 三、`free_blocks()` 确实存在，但谁来调用它？

PR #4434 已经实现了正常完成后的释放逻辑：

```python
def update_connector_output(self, connector_output):
    meta = connector_output.kv_connector_worker_meta
    for req_id, count in meta.completed_store_requests.items():
        if self.scheduler_adapter.update_pending_store_count(req_id, count):
            gpu_block_ids = self._pending_store.get_request_gpu_block_ids(req_id)
            self._gpu_block_pool.free_blocks(...)
            self._pending_store.remove_request_gpu_block_ids(req_id)
            self.scheduler_adapter.end_session(req_id)
```

这段代码的确会释放 block。但它位于文件明确标注的 `Scheduler-side methods` 区域，并且触发条件是：

> Scheduler 已经从 `connector_output.kv_connector_worker_meta` 收到足够的 worker 完成数。

[Scheduler-side update_connector_output()](https://github.com/LMCache/LMCache/blob/0dd39f6346f757105cc7406c9429b253d6e74b12/lmcache/integration/vllm/lmcache_mp_connector.py#L902-L924)

Worker side 做的是另一半：

```python
def build_connector_worker_meta(self):
    completed = self.worker_adapter.get_completed_store_requests()
    if completed:
        return LMCacheMPWorkerMetadata(
            completed_store_requests=completed
        )
```

也就是生成“我完成了哪些请求”的回执。[Worker completion metadata](https://github.com/LMCache/LMCache/blob/0dd39f6346f757105cc7406c9429b253d6e74b12/lmcache/integration/vllm/lmcache_mp_connector.py#L640-L670)

完整成功路径是：

```text
Scheduler touch blocks
    ↓
STORE metadata 发给 Model Worker
    ↓
Worker 向 LMCache Server 发起异步 store
    ↓
store future 完成
    ↓
Worker 记录 completed_store_requests
    ↓
下一轮 Engine Step 构造 ModelRunnerOutput
    ↓
Scheduler.update_connector_output()
    ↓
Scheduler.free_blocks()
```

所以问题从来不是“PR #4434 忘记写 `free_blocks()`”，而是：

> 如果没有下一轮 Engine Step，已经写好的 `free_blocks()` 根本没有触发机会。

顺便说明，代码里另一个 `free_blocks()` 出现在 block-hash mismatch 分支。它表示 Scheduler 刚 `touch()` block 后发现内容已经被替换，于是取消这次 store 并撤销刚增加的引用。那是提交失败/跳过时的补偿，不是正常异步 store completion 的释放。

## 四、为什么普通 store 不需要 PR #4998？

理解 lazy offload 之前，先看普通非 lazy 模式。

vLLM 调用 connector 的 `request_finished()` 时，connector 可以返回 `True`：

> 请求虽然生成结束了，但 connector 仍在异步发送；请暂时保留请求及其 blocks，直到 `get_finished()` 报告完成。

普通 LMCache MP 路径正是这样做的。请求从 running 队列离开后，仍以 delayed-free 的形式留在 Scheduler 的 `requests` 中。`has_finished_requests()` 能看出“总 requests 数量大于 waiting + running 数量”，因此 Engine 会继续 Step。

vLLM 的 [PR #43433](https://github.com/vllm-project/vllm/pull/43433) 专门修过这种 delayed connector cleanup 的存活问题：不能因为正常生成完成，就停止轮询 connector completion。

普通路径的责任链是：

```text
request_finished() 返回 True
    ↓
vLLM 保留 finished request 与 blocks
    ↓
has_finished_requests() 返回 True
    ↓
Engine 继续 Step
    ↓
get_finished() 返回 finished_sending
    ↓
vLLM 释放 blocks
```

在这条路径中，vLLM 自己知道还有一个 delayed-free request，所以不需要 LMCache 额外声明 pending work。

## 五、lazy offload 为什么故意不走普通 delayed-free？

[LMCache PR #4434](https://github.com/LMCache/LMCache/pull/4434) 引入 lazy offload 的目标是：不要每产生一小段 KV 就立即 store，而是在 Scheduler 侧先积累 metadata，根据策略成批选择已经完成的请求再 offload。

当前 FIFO policy 的两个关键参数是：

```text
lmcache.mp.lazy_offload_threshold   默认 100
lmcache.mp.lazy_offload_select_count 默认 10
```

前者表示完成请求累计到多少时允许触发；后者表示一次最多取多少个请求。这样可以减少零碎 store，提高 batching 机会。

Lazy 模式下，KV metadata 的生命周期分成两个阶段。

### 1. Queued：只有 metadata，还没发给 worker

Scheduler 在正常 token Step 中产生 store metadata，但先放入 FIFO：

```text
_policy._pending_items[request_id]
```

请求结束时，`mark_req_finished()` 只是在 FIFO 中把它标记为可选择。

此时 store 还没有提交给 worker，也没有 worker future。Scheduler 只保存了 block IDs 对应的旧 hash，用于未来选择时检查 block 内容是否已经被复用覆盖。

### 2. In-flight：已发给 worker，等待 completion

当 threshold 满足并且出现可执行 store 的正 token Step 时，Scheduler 从 FIFO 取出请求：

1. 调用 `BlockPool.touch()` 增加 block 引用；
2. 再次核对 block hash；
3. hash 一致才把 STORE metadata 加入当轮 connector metadata；
4. 把 block IDs 记录到 `_request_block_ids`；
5. 等待 worker 完成后再 `free_blocks()`。

这里的 `touch()` 非常关键：lazy 模式下请求早已结束，vLLM 原本可以复用这些 blocks。LMCache 只有在真正准备提交 store 时才重新 pin 它们，并通过 hash 校验保证没有把已经换内容的 block 当成旧请求 KV 存出去。[Lazy store 提交路径](https://github.com/LMCache/LMCache/blob/5599fb6839a7d2cfb4260e30e03a62814c9adabc/lmcache/integration/vllm/lmcache_mp_connector.py#L1477-L1515)

Lazy 模式的 `request_finished()` 返回 `False`：

```python
self._pending_store.mark_req_finished(request.request_id)
return False, ...
```

意思不是“以后不用释放”，而是：

> 不让这个请求进入 vLLM 普通 delayed-free；未来是否选择 offload、什么时候 touch、何时释放，改由 Scheduler-side lazy-offload 状态机负责。

[Lazy request_finished()](https://github.com/LMCache/LMCache/blob/5599fb6839a7d2cfb4260e30e03a62814c9adabc/lmcache/integration/vllm/lmcache_mp_connector.py#L1250-L1300)

这正是 PR #4998 出现的结构性原因：vLLM 已经看不到 delayed-free request，但 LMCache 自己可能还有 in-flight store。

## 六、没有 PR #4998，什么情况下真的会出问题？

用一个具体时间线最容易看清楚。假设 threshold 和 select count 都设为 1，同时运行请求 A、B。

### T1：A 结束

A 的 store metadata 已经在 FIFO。`request_finished(A)` 把 A 标为 finished，然后返回 `False`。A 不再作为 vLLM delayed-free request 存在。

### T2：B 继续运行

下一轮 B 有 token 被调度。Scheduler 构造 connector metadata 时发现 A 已经达到 offload 条件，于是：

```text
FIFO pop A
→ touch A 的 blocks
→ 记录 _request_block_ids[A]
→ 向 worker 提交 STORE
```

Worker 开始异步存储 A。

### T3：B 也结束，但 A 的 store 还没完成

现在 Scheduler 看到：

```text
waiting = 0
running = 0
普通 delayed-free requests = 0
```

在 PR #4998 之前，LMCacheMPConnector 继承 base class 默认实现：

```python
has_pending_push_work() -> False
```

因此 `Scheduler.has_requests()` 返回 `False`，Engine 进入 idle。

### T4：Worker 完成 A 的 store

Worker 把 A 放入 `completed_store_requests`。但是 Engine 已经不再 Step：

- 不会调用 worker connector 的 `get_finished()`；
- 不会调用 `build_connector_worker_meta()`；
- 不会产生下一份 ModelRunnerOutput；
- Scheduler 不会调用 `update_connector_output()`；
- A 的 `_request_block_ids` 不会删除；
- A 的 blocks 仍不可复用。

![没有和有 has_pending_push_work 时的 idle 边界](/images/blog/lmcache-lazy-offload-liveness/idle-gap-timeline.svg)

这就是最精确的问题定义：

> Worker 已经完成数据面操作，但控制面的完成回执停在 worker 侧，Scheduler 没有机会消费它。

## 七、PR #4998 到底补了什么？

PR 很小，但沿着抽象层逐级暴露状态：

1. `OffloadPolicy` 新增抽象 `has_pending_work()`；
2. FIFO policy 用 `bool(_pending_items)` 判断队列是否非空；
3. `LazyOffloadPendingStore` 汇总 queued 与 in-flight；
4. `LMCacheMPConnector.has_pending_push_work()` 只在 Scheduler role + lazy 模式返回状态；
5. 测试覆盖 policy、pending store 和 connector role gating。

核心汇总逻辑是：

```python
def has_pending_work(self) -> bool:
    return (
        self._policy.has_pending_work()
        or bool(self._request_block_ids)
    )
```

含义分别是：

| 判断 | 状态 | 期待推进的动作 |
|---|---|---|
| `_policy.has_pending_work()` | FIFO 里还有 metadata | 选择并提交 store |
| `_request_block_ids` 非空 | store 已提交，blocks 已 pin | 收 completion 并释放 blocks |

Connector 最外层还做了两道保护：

```python
if self.role != KVConnectorRole.SCHEDULER or not self.lazy_offload:
    return False
```

因为 worker role 没有 scheduler-side `_pending_store`；非 lazy 模式则已经受 vLLM delayed-free 生命周期保护。[PR #4998 核心实现](https://github.com/LMCache/LMCache/blob/5599fb6839a7d2cfb4260e30e03a62814c9adabc/lmcache/integration/vllm/lmcache_mp_connector.py#L1319-L1331)

对于 in-flight 状态，后续行为是完整的：

```text
_request_block_ids 非空
    ↓
has_pending_push_work() = True
    ↓
Scheduler.has_requests() = True
    ↓
执行零 token Step
    ↓
kv_connector_no_forward()
    ↓
get_finished() + build_connector_worker_meta()
    ↓
Scheduler.update_connector_output()
    ↓
free_blocks()
    ↓
_request_block_ids 清空
    ↓
下一轮 has_pending_push_work() = False
    ↓
Engine 正常进入 idle
```

零 token Step 不跑模型 forward，但 vLLM 仍会绑定 connector metadata、查询 finished 状态并构造 worker metadata。[kv_connector_no_forward()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/worker/kv_connector_model_runner_mixin.py#L27-L39)

## 八、如果一直没有新请求，不 free 真的有影响吗？

答案需要分“立即影响”和“下一批请求影响”。

### 从此永远没有请求：几乎没有用户可见影响

如果服务从此不再接收请求，也不关心内部状态是否干净，那么 blocks 没有立即复用需求，不会影响模型输出。

另外，`BlockPool.free_blocks()` 通常不是把 GPU 物理内存退还给 CUDA driver 或操作系统，而是把逻辑 block 归还给 vLLM allocator，使它可以再次分配。vLLM 的 KV cache tensor 往往仍然整体驻留在 GPU 上。

所以不能把这里描述成“GPU 显存持续增长直至 OOM”的传统内存泄漏；更准确的是：

> 一部分已经可以复用的 KV blocks，在 Scheduler 的逻辑状态里仍被认为有引用。

### 下一批请求到来：第一个调度周期可能看到旧状态

没有 PR #4998，新请求到来后才重新启动 Engine Step。调度顺序通常是先 `Scheduler.schedule()`，再执行模型，最后处理返回的 connector output。

因此 Scheduler 在第一次给新请求分配 blocks 时，旧请求的 completion 可能还没有被消费：

```text
新请求到达
    ↓
Scheduler 尝试 allocate
    ↓
旧 blocks 此刻仍不可复用
    ↓
执行本轮 forward 或 no-forward
    ↓
收到旧 worker completion
    ↓
free_blocks()
```

有两种结果：

- 空间够：新请求仍能 forward，但旧 blocks 要到本轮末尾才释放；
- 空间不够：新请求可能本轮无法正常调度，先通过一个 no-forward Step 收 completion，下一轮才能 allocate/forward。

因此影响通常是：

- 新 burst 的第一轮可用容量偏小；
- 多等待一个调度周期；
- 容量紧张时更容易出现短暂 preemption 或调度停顿；
- benchmark 收尾时内部 block/bookkeeping 状态不干净。

PR #4998 的价值不是解决一个必现的永久死锁，而是：

> 在上一批流量彻底结束前完成控制面收尾，让下一批请求看到已经恢复可复用的 BlockPool。

## 九、最重要的评审结论：queued 与 in-flight 不能混为一谈

到这里，PR 的 in-flight 动机已经成立。但当前实现还把 FIFO queued metadata 也纳入 `has_pending_work()`，这产生了另一个问题。

![Lazy offload 的 queued 与 in-flight 状态机](/images/blog/lmcache-lazy-offload-liveness/pending-state-machine.svg)

LMCache 当前只在 Scheduler 本轮真正调度了 token 时触发 lazy store：

```python
if scheduler_output.total_num_scheduled_tokens:
    self._process_lazy_offload_store_requests(metadata)
```

代码注释解释了原因：零 token 时 vLLM 会进入 `kv_connector_no_forward()`，而该路径使用 `wait_for_save=False`；如果把新 STORE metadata 塞进去，并不会正常触发 store 提交。[正 token guard](https://github.com/LMCache/LMCache/blob/5599fb6839a7d2cfb4260e30e03a62814c9adabc/lmcache/integration/vllm/lmcache_mp_connector.py#L1428-L1434) [no-forward connector 生命周期](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/worker/kv_connector_model_runner_mixin.py#L69-L107)

于是 queued-only 会出现：

```text
FIFO 非空
    ↓
has_pending_push_work() = True
    ↓
Engine 执行零 token Step
    ↓
total_num_scheduled_tokens = 0
    ↓
不调用 _process_lazy_offload_store_requests()
    ↓
FIFO 仍然非空
    ↓
继续保活
```

vLLM 在没有模型执行但 Scheduler 仍有工作时会短暂 sleep，以便后台线程推进；但这里不是“后台线程再等一会就能把 queued metadata 自动提交”的问题。提交入口本身被正 token guard 挡住，因此仅靠时间不会改变状态。

这意味着 PR #4998 的两种声明要分别评价：

| PR 返回 True 的原因 | 当前是否能由零 token Step 推进 | 结论 |
|---|---|---|
| 已提交 store，等待 worker completion | 能：no-forward 会查询完成并返回 worker metadata | 正确且必要 |
| FIFO 中有尚未提交的 metadata | 不能：正 token guard 阻止提交 | 尚未闭环，可能持续空转 |

## 十、应该怎么改进？

有两个层次的方案。

### 方案 A：最小安全修复

只让真正 in-flight 的 `_request_block_ids` 保活：

```python
def has_pending_work(self) -> bool:
    return bool(self._request_block_ids)
```

或者把 API 拆成：

```text
has_queued_store_metadata()
has_inflight_store_work()
```

然后 `has_pending_push_work()` 只查询后者。

优点是语义准确，不会因无法推进的 FIFO 项目无限保活。代价是 queued metadata 仍然要等下一次真实请求产生正 token Step 才可能提交——但这正是修改前已有的 lazy batching 行为，不会凭空增加新的 idle spin。

### 方案 B：完整 connector-only drain

让零 token Step 也能合法地把 queued store 提交给 worker。这要求重新定义 no-forward connector 生命周期：

- 没有新 forward 时，STORE metadata 怎样引用已存在的 KV blocks；
- worker 应该调用哪条 save/submit API；
- `wait_for_save=False` 是否需要区分 load-only 与 store-only；
- 多 worker completion、错误和 block-hash mismatch 怎样收敛；
- connector-only Step 是否需要独立于模型 Step 的调度预算。

这是更完整的设计，但明显不再是 PR #4998 当前规模的简单 hook。

## 十一、测试应该覆盖什么？

PR 目前新增的测试主要验证局部布尔状态：

- FIFO empty/add/pop 前后的 `has_pending_work()`；
- `_request_block_ids` add/remove 前后的状态；
- Scheduler/Worker role 与 lazy flag gating。

这些测试能证明查询函数写对了，却不能证明 Engine 生命周期能终止。真正关键的回归测试应该包含以下场景。

### 场景 1：in-flight completion 在 idle 前被消费

```text
1. 两个请求交错运行
2. A 的 lazy store 在 B 运行时提交
3. B 结束后无其他用户请求
4. Worker 稍后完成 A
5. 断言 Engine 继续 zero-token Step
6. 断言 Scheduler 收到 completion
7. 断言 free_blocks() 被调用
8. 断言 has_pending_push_work() 最终恢复 False
```

### 场景 2：queued-only 不得无限空转

```text
1. FIFO 中留下未达到/刚达到策略条件的 finished metadata
2. 没有任何 running/waiting request
3. 连续执行若干 Scheduler Step
4. 断言系统要么真正提交并 drain
5. 要么不把 queued-only 当作 keepalive 条件
```

### 场景 3：新 burst 到来前后容量行为

比较有无 keepalive 时：

- 新请求第一轮能看到的 free-block 数；
- 是否多经历一个 no-forward round；
- 是否出现不必要的 preemption；
- completion 是否只处理一次；
- TP/PP 多 worker count 是否正确归零。

只有这类端到端 Scheduler 测试，才能验证 PR 真正声称的“keep the engine loop alive until cleanup drains”。

## 十二、几个常见追问

### Q1：Worker 不是已经知道 store 完成了吗？

知道。但 worker 知道的是 store future 完成；Scheduler 才拥有 BlockPool 的权威状态。完成事实必须经过 ModelRunnerOutput 返回，才能触发 Scheduler-side `free_blocks()`。

### Q2：为什么不能让 worker 直接 free？

因为 worker 不拥有 Scheduler 的 block 引用计数与调度状态。跨角色直接修改会破坏 allocator 的单一权威。即使物理上处在同一 OS 进程，也不应绕过 connector 输出协议修改另一个角色实例的状态。

### Q3：`has_pending_push_work()` 是不是忙等？

对于 in-flight store，它通常只维持少量 no-forward Step，直到 completion 到达，属于有终止条件的短轮询。对于 queued-only，当前实现确实可能变成无法自行终止的空转，这正是本文指出的缺口。

### Q4：没有这个 PR 会不会马上 OOM？

不一定。它主要让已经可释放的 blocks 延迟到下一次 Engine Step 才恢复可复用。如果空闲后永远没有请求，用户通常感觉不到；如果紧接着出现容量较大的 burst，第一轮调度才可能暴露容量不足、额外等待或 preemption。

### Q5：为什么 lazy 模式返回 `False`，普通模式返回 `True`？

普通模式在请求结束时 store 已经处于异步发送生命周期，适合让 vLLM delayed-free 直接保留请求。Lazy 模式可能只有 queued metadata，甚至最终因为 block 被复用而跳过 store，所以不适合从请求结束那一刻起长期保留整条普通 request 生命周期；它选择在真正提交 store 时才 `touch()` 对应 blocks。

## 十三、最终评价

PR #4998 的核心方向是正确的：LMCache MP lazy offload 不能假设“worker 做完 store”自动等于“Scheduler 已经释放 blocks”。在最后一个请求结束的 idle 边界，Engine Step 同时承担 completion 消息泵的作用；如果 connector 不声明 pending work，回执就可能停在 worker 一侧。

它真正解决的是：

```text
submitted store
→ worker completion
→ zero-token keepalive Step
→ Scheduler update
→ free_blocks
```

但不能把这条成立的链路扩大解释成“所有 lazy queued work 都会在 idle 时自动排空”。当前 queued → submitted 仍依赖正 token Step，因此 PR 把 FIFO 非空也纳入 keepalive 后，状态可能无法自然收敛。

最准确的一句话总结是：

> PR #4998 给 lazy offload 补上了“已提交 store 的最后一张完成回执”，让 Scheduler 能在进入 idle 前归还 BlockPool；但尚未提交的 FIFO metadata 还缺少真正的 connector-only drain 通路，不能仅靠 `has_pending_push_work()` 解决。

截至 2026 年 9 月 8 日，PR #4998 仍应重点补充 idle-boundary 集成测试，并明确 queued-only 的处理策略。改动虽小，它触及的却是异步系统里非常典型的一条原则：

> 后台任务完成只是数据面事实；只有完成通知被状态所有者消费，生命周期才真正结束。

## 参考资料

- [LMCache PR #4998：Add pending push work hook for MP lazy offload](https://github.com/LMCache/LMCache/pull/4998)
- [LMCache PR #4434：Support lazy offload](https://github.com/LMCache/LMCache/pull/4434)
- [vLLM PR #35264：NIXL KV push 与 has_pending_push_work](https://github.com/vllm-project/vllm/pull/35264)
- [vLLM PR #43433：Keep scheduler alive for delayed KV connector frees](https://github.com/vllm-project/vllm/pull/43433)
- [vLLM Scheduler.has_requests()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/core/sched/scheduler.py#L2653-L2668)
- [vLLM KVConnectorBase_V1.has_pending_push_work()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/distributed/kv_transfer/kv_connector/v1/base.py#L586-L597)
