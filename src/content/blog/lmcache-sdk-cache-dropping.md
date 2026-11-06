---
title: "LMCache SDK 与 Cache Dropping 完整指南：从部署、轮询到 Prefill/Modify/Decode"
description: "面向熟悉 vLLM + LMCache 在线推理、但不了解 SDK 的读者：从 KV Cache 与原始 KV 的定义开始，完整讲清三进程部署、启动顺序、两层轮询、SHM/inline 数据通道、Random/SnapKV/R-KV、vLLM patch，以及 Prefill → Retrieve → Drop → Store → Decode 的每一步。"
publishedAt: 2026-11-06
updatedAt: 2026-11-06
category: AI Infra
tags:
  - lmcache
  - vllm
  - kv-cache
  - cache-dropping
  - sdk
  - long-context
  - inference
author: 毛宝龙
readingTime: 38 min
featured: true
draft: false
---

如果你已经熟悉下面这条在线推理链路：

```text
Client → vLLM → LMCache Server
```

第一次看到 LMCache SDK 和 Cache Dropping 时，很容易产生几个误解：SDK 是不是另一个推理引擎？它是不是跑在 LMCache Server 里面？所谓“保留一半 KV”，是把 prompt 删掉一半吗？Prefill 完成后，谁通知 SDK 开始修改？为什么有的示例需要给 vLLM 打 patch，有的又不需要？

这篇文章从零开始回答这些问题。

先给出一句完整但暂时不要求你立刻看懂的结论：

> **vLLM 先对原始 prompt 做 Prefill，并通过 LMCache MP Connector 把完整 chunk 对应的 KV Cache 保存到 LMCache Server；独立的 SDK 进程随后用 token IDs 查找并取回这些 KV，在 CPU 上选择要保留的 token 位置、同步压缩 KV tensor 与 token 序列、修正必要的位置编码，再把新 KV 写回 LMCache；最后 SDK 再向 vLLM 发起一次 completion，把未缓存的尾部 token 补回去，从压缩后的上下文继续 Decode。**

这里的每个加粗术语，后面都会拆开。

本文基于 2026-11-06 拉取的 LMCache `dev` 快照 [`cf87a1ca`](https://github.com/LMCache/LMCache/tree/cf87a1ca70fcea192dc3820c745aae0b9253061b)，以及 [`examples/token_dropping`](https://github.com/LMCache/LMCache/tree/cf87a1ca70fcea192dc3820c745aae0b9253061b/examples/token_dropping) 中的示例。SDK 和 vLLM 都在快速变化，如果你在更晚时间阅读，请优先核对当前代码。

<nav class="sdk-article-map" aria-label="文章知识地图">
  <a href="#first-principles"><strong>1</strong><span>先理解原始 KV</span></a>
  <a href="#architecture"><strong>2</strong><span>三个进程怎么摆</span></a>
  <a href="#end-to-end"><strong>3</strong><span>完整生命周期</span></a>
  <a href="#polling"><strong>4</strong><span>轮询还是通知</span></a>
  <a href="#deployment"><strong>5</strong><span>部署与启动</span></a>
  <a href="#patch-matrix"><strong>6</strong><span>何时打 vLLM patch</span></a>
  <a href="#glossary"><strong>7</strong><span>术语表</span></a>
</nav>

<h2 id="first-principles">一、先从“原始 KV”到底是什么讲起</h2>

### 1. Prompt 不是 KV Cache

假设输入文本是：

```text
北京是中国的首都
```

Tokenizer 会先把它变成 token IDs，例如：

```text
[101, 2457, 3221, 704, 1744, 4638, 1266, 6963]
```

这些整数仍然只是模型输入。模型执行 Prefill 时，每一层 Attention 会为每个 token 计算 Query、Key 和 Value。为了以后生成新 token 时不再重复计算历史部分，推理引擎会保存历史 token 的 Key 和 Value，这才是 [KV Cache](#term-kv-cache)。

因此有三类东西不能混在一起：

| 对象 | 它是什么 | 人能否直接读懂 | Cache Dropping 会不会处理 |
|---|---|---|---|
| 原始文本 | “北京是中国的首都” | 可以 | 不直接处理 |
| Token IDs | `[101, 2457, ...]` | 只能通过 tokenizer 解释 | 必须和 KV 的 token 维度同步裁剪 |
| KV Cache | 每层 Attention 的浮点 Tensor | 不可以 | 真正被取回、选择、压缩和写回的数据 |

LMCache SDK 看到的 KV 通常被整理成连续 CPU Tensor：

```text
[2, L, T, D]
 │  │  │  └─ 每个 token 汇总后的 KV hidden width
 │  │  └──── token 维度
 │  └─────── layer 数量
 └────────── K 与 V
```

这里的 `T` 才是 Cache Dropping 最关心的维度。删除某个 token 位置时，不是删一行文字，而是要在所有层的 K/V 中删除同一个位置，同时从 token IDs 中删除对应元素。

### 2. “原始 KV”不是一个特殊对象

本文后面说“原始 KV”，指的是：

> vLLM 对**尚未做 dropping 的原始 prompt** 完成 Prefill 后产生，并由 LMCache Server 保存的 KV Cache。

它不是 LMCache 中一个叫 `OriginalKV` 的类型，也不意味着一定包含 prompt 的最后一个 token。

原因是 LMCache 按 [Chunk](#term-chunk) 存储。假设：

- prompt 长度为 1,050 token；
- `chunk_size = 256`；
- Prefill 为了驱动请求又生成了 1 个 token；
- 当前逻辑序列一共 1,051 token。

那么完整 chunk 只有：

```text
floor(1051 / 256) × 256 = 1024 token
```

LMCache 能按完整 chunk 取回前 1,024 个 token 的 KV。剩下的 27 个 token 没有进入这次返回的 chunk-aligned KV，它们会成为 [Suffix Tokens](#term-suffix)，留到下一次 Decode 时重新送给 vLLM。

这也是为什么不能简单把“当前 token 数量”当成“LMCache 已保存 KV 的 token 数量”。

### 3. “保留一半 KV”到底是什么意思

假设已经取回 8 个完整 chunk，每个 chunk 256 token：

```text
原始 KV：
chunk 0 | chunk 1 | chunk 2 | chunk 3 | chunk 4 | chunk 5 | chunk 6 | chunk 7
 256       256       256       256       256       256       256       256

合计：2048 个 token 位置对应的 KV
```

“保留一半”不是保留 K、删除 V，也不是每个浮点数砍掉一半精度。它是选择一半的 **token positions**，并保留这些位置在所有 layer 上的 K 和 V。

仓库里的 Random Dropping 示例不是完全随机抽点，而是保留开头和结尾、删除中间一半 chunk。以上面 8 个 chunk 为例，可以近似理解成：

```text
保留：chunk 0、1、6、7
删除：chunk 2、3、4、5

压缩后 KV：1024 个 token 位置
```

为什么保留两头？开头往往包含系统指令和任务背景；结尾离当前生成位置最近。这里只是一个便于验证系统链路的规则，不代表它在所有任务上质量最好。

<section class="sdk-kv-lab" data-sdk-kv-lab aria-label="原始 KV 与保留一半 KV 的交互示意">
  <noscript>原始 KV 有 8 个 chunk，共 2048 个 token 位置。示例保留 chunk 0、1、6、7，删除中间 chunk 2–5；压缩后保留 1024 个 token 位置。请注意，token IDs 与所有 layer 的 K/V 必须按相同索引同步处理。</noscript>
</section>

### 4. 删除中间 token 后，位置编码怎么办

对使用 RoPE 的模型，Key 已经带有原始位置的信息。

假设原来保留的最后一段位于位置 `1536..2047`，删除中间后，它要紧跟在前 512 个 token 后面，新位置变成 `512..1023`。如果只做 tensor 切片而不修正位置，模型读到的 Key 仍然携带旧位置旋转。

因此 Random Dropping 示例会调用 `rerotate_k_cache()`：

1. 用旧位置的旋转做逆变换；
2. 得到未旋转的 Key；
3. 按压缩后的新位置重新应用 RoPE；
4. Value 不执行这一步，因为 RoPE 作用在 Query/Key 上。

这部分计算在 FP32 中完成，最后再转回 KV 原来的 dtype，减少重复旋转在 BF16 下造成的误差。

<h2 id="architecture">二、SDK 不是插件进程：先把三个进程摆清楚</h2>

完整实验至少有三个独立角色：

| 进程 | 主要职责 | 典型端口/入口 |
|---|---|---|
| vLLM | 执行模型 Prefill/Decode；通过 LMCache MP Connector 读写 GPU KV | OpenAI API `:8000` |
| LMCache MP Server | 管理 KV chunk、lookup、L1 pool、传输 session 与锁 | request `:6555`，HTTP `:8080` |
| SDK / Notebook | 调 vLLM completion；向 LMCache 查找、取回、修改并写回 KV | 主动连接另外两者，无监听端口 |

SDK 不在 vLLM worker 内，也不在 LMCache Server 内。它通常就是运行 notebook 或 Python 脚本的那个 CPU 进程。

<section class="sdk-topology" data-sdk-topology aria-label="vLLM、LMCache Server 与 SDK 的通信拓扑">
  <noscript>SDK 通过 HTTP SSE 调用 vLLM；vLLM 通过 LMCache-driven 路径和 LMCache Server 通信；SDK 通过 HTTP 读取 Server 配置和 layout，通过 ZMQ/gRPC 发送 LOOKUP、状态查询和 session 请求，并通过 engine-driven SHM 或 inline 路径搬运实际 KV Tensor。</noscript>
</section>

这里同时存在三组容易混淆的连接。

### 1. SDK ↔ vLLM：HTTP streaming completion

示例中的 `make_post_completion()` 会向：

```text
POST http://localhost:8000/v1/completions
```

发送 token IDs，并开启：

```json
{
  "stream": true,
  "logprobs": 0
}
```

SDK 一边读取 SSE `data:` 行，一边把每个生成 token 转成 `TokenEvent(token_id, text)`。这一条连接负责“让模型运行”，不负责直接搬 KV Tensor。

### 2. vLLM ↔ LMCache Server：LMCache-driven 路径

vLLM 使用 `LMCacheMPConnector`。它在启动时把真实 GPU KV Cache 的 layout、block geometry 和 IPC handle 注册给 LMCache Server。运行过程中，vLLM 与 Server 之间保存/恢复 KV 通常走 LMCache-driven 路径：Server 根据已注册的 GPU buffer 和 block IDs 驱动 KV 传输。

如果你希望更深入理解这个注册动作，可以继续看站内文章：[LMCache MP 注册路径详解：register_kv_cache 到底在干什么](/blog/lmcache-register-kv-cache/)。

### 3. SDK ↔ LMCache Server：Engine-driven 路径

SDK 不拥有 vLLM 的 GPU block table。它需要的是“给我 token IDs 对应的连续 CPU KV Tensor”。因此它注册的是 engine-driven context：由 SDK 发起 `prepare → copy/serialize → commit`。

它又分成两层：

- **Request plane**：ZMQ 或 gRPC，发送 `LOOKUP`、`QUERY_PREFETCH_STATUS`、`PREPARE_RETRIEVE`、`COMMIT_RETRIEVE`、`END_SESSION` 等控制请求。
- **Data plane**：同机优先用 POSIX Shared Memory；没有可用 SHM 时走 inline tensor codec。request transport 是 gRPC 并不代表 KV Tensor 也自动“通过 gRPC 高效直传”。

这与站内文章 [LMCache gRPC 支持详解](/blog/lmcache-grpc-transport/) 中区分 request transport 和 KV data transfer 是同一件事。

### 4. 为什么 Server 要配置 `--supported-transfer-mode auto`

同一个 Server 同时面对两种 client：

- vLLM 使用 LMCache-driven；
- SDK 使用 engine-driven。

因此示例启动 Server 时使用：

```bash
--supported-transfer-mode auto
```

`auto` 不是“自动决定要不要 dropping”，而是让 Server 同时加载两套 transfer path。

<h2 id="registration">三、启动顺序为什么不能随便换</h2>

正确顺序是：

```text
1. LMCache Server
2. vLLM
3. SDK / Notebook
```

### 第一步：Server 先提供 request 与 HTTP 端点

Server 启动后，`/config` 可以提供 chunk size、SHM name 等配置，request port 可以接收注册和 lookup。

### 第二步：vLLM 注册真实模型 KV layout

SDK 只知道 `model_name="Qwen/Qwen3-8B"`，无法仅凭模型名字可靠推导：

- 实际 layer 数；
- dtype；
- KV heads；
- block size；
- vLLM 选择的物理 layout；
- MLA 或普通 Attention；
- kernel group 数量。

这些信息由运行中的 vLLM worker 通过 `REGISTER_KV_CACHE` 注册到 Server。Server 再把 layout 摘要暴露在 HTTP `/status` 的 `cache_context_meta` 中。

### 第三步：SDK connect 时读取并复用 layout

`lmc_sdk.kvcache.connect(...)` 内部会：

1. `GET /config`，读取 `chunk_size` 与 `shm_name`；
2. `GET /status`，找到相同 model name 的 `kv_cache_layout`；
3. 解码 layer、dtype、block size、head geometry；
4. 在 CPU 创建一个只有 1 block 的 dummy buffer；
5. 注册 engine-driven context；
6. 用 `ContiguousTransferWrapper` 把 chunk slots 拼成 `[2, L, T, D]`。

dummy buffer 只用于告诉传输框架“SDK 期望什么 layout”，不是把完整模型 KV 预先复制到 CPU。

如果先启动 SDK、后启动 vLLM，`/status` 中还没有这个模型的注册信息，SDK 会报找不到 GPU layout。

<h2 id="end-to-end">四、完整生命周期：Prefill → Retrieve → Drop → Store → Decode</h2>

下面不再一带而过，而是跟着一条请求完整走一遍。

<section class="sdk-sequence" data-sdk-sequence aria-label="Cache Dropping 完整生命周期交互图">
  <noscript>流程依次是：SDK 向 vLLM 发起 max_tokens=1 completion；vLLM Prefill 并将完整 chunk KV 存入 LMCache；SDK 等 HTTP 流结束；SDK 向 LMCache LOOKUP；轮询 prefetch status；通过 SHM/inline 取回连续 CPU KV；drop 函数同步处理 KV 与 token IDs，并修正 RoPE；SDK 把新 KV store 回 Server；SDK 把未缓存 suffix 拼回新 token 序列；再次请求 vLLM Decode。</noscript>
</section>

### 阶段 A：SDK 创建 RequestStream

Notebook 为每个 prompt 创建 `LMCacheRequestStream`：

```python
request = lmc_sdk.request.create_request(
    contexts=[kv_ctx],
    post_completion=post_completion,
    prompt_token_ids=prompt,
)
```

此时最重要的状态是：

```text
tokens          = 原始 prompt token IDs
_suffix_tokens  = []
decoded_tokens  = 0
```

`LMCacheSDKContext` 本身是无状态的 retrieve/store client；`RequestStream` 才负责把同一逻辑请求的多次 HTTP completion 和中间 KV 修改串起来。

### 阶段 B：`batch.prefill()` 实际上发起一次 1-token completion

```python
batch.prefill({
    "temperature": 1.0,
    "ignore_eos": True,
})
```

`prefill()` 会强制覆盖：

```python
max_tokens = 1
```

为什么不是 `max_tokens=0`？因为示例需要通过一次真实 completion 驱动 vLLM forward、KV Connector 和 LMCache store 路径。生成 1 个 token 后，HTTP stream 正常结束，SDK 才进入下一阶段。

对于多个 prompt，`LMCacheBatchedStream` 使用 `ThreadPoolExecutor`，每个 RequestStream 一个 worker thread，并发向 vLLM 发 completion。这里的“batch”是 SDK 侧并发编排，不等于 SDK 自己执行模型 batch；真正如何合批仍由 vLLM scheduler 决定。

### 阶段 C：vLLM Prefill 并把原始 KV 保存到 LMCache

vLLM 收到 token IDs 后执行 Prefill。LMCache MP Connector 按 token chunk 建立 cache key，并把完整 chunk 对应的 KV 保存到 Server。

注意两个边界：

1. HTTP completion 生成的那个 token 会被 RequestStream 追加到逻辑 `tokens`；
2. LMCache retrieve 只返回 chunk-aligned prefix，最后不足一块的 token 不一定已经存在于返回的 KV 中。

因此 Prefill 结束不代表 `len(tokens)` 个位置都有可直接取回的 KV。

### 阶段 D：SDK 主动调用 `batch.modify()`

Prefill 不是通过 callback 唤醒 SDK。Notebook 代码是普通的同步顺序：

```python
prefill_metrics = batch.prefill(...)
modify_metrics = batch.modify(drop_tokens_fn)
decode_metrics = batch.decode(...)
```

只有 `batch.prefill()` 返回以后，Python 才执行下一行 `batch.modify()`。

### 阶段 E：RequestStream 取回每种需要的 Tensor

对于 Random Dropping，只有一个 KV context：

```text
contexts = [kv_ctx]
```

对于 SnapKV/R-KV，还会有 Query context：

```text
contexts = [kv_ctx, q_ctx]
```

`modify_kv()` 逐个调用 `retrieve(kind)`。KV 返回形状是 `[2, L, T, D]`；Query 返回形状是 `[1, L, T, D]`。

### 阶段 F：保存 chunk 之外的 suffix

假设 RequestStream 当前有 1,051 个 token，但 KV retrieve 只返回前 1,024 个：

```text
cached_len = 1024
suffix = tokens[1024:1051]
```

这些 suffix 不参与本次 dropping，因为它们没有出现在取回的 KV Tensor 中。RequestStream 把它们保存在 `_suffix_tokens`。

### 阶段 G：运行用户提供的 dropping function

接口是：

```python
def drop_tokens_fn(
    tensors: Mapping[LMCacheSDKCacheKind, torch.Tensor],
    token_source: Sequence[int],
) -> tuple[torch.Tensor, Sequence[int]]:
    ...
    return new_kv, new_tokens
```

它必须维护一个硬约束：

```text
new_kv.shape[2] == len(new_tokens)
```

`new_tokens[i]` 必须对应 `new_kv[:, :, i, :]` 的那个 token 位置。只压 KV 不压 token IDs，后续 cache key 会错；只压 token IDs 不压 KV，shape 和语义都会错。

Random 示例的核心可以抽象成：

```python
keep_idx = [要保留的原 token 位置]

new_tokens = token_source[keep_idx]
new_kv = kv[:, :, keep_idx, :]
new_kv = rerotate_key_from_old_positions_to_new_positions(new_kv)
```

SnapKV/R-KV 的区别主要在“如何算 `keep_idx`”，而不是后面的 store 协议完全不同。

### 阶段 H：把压缩后的 KV 写回 LMCache

`ctx.store(new_kv, new_tokens)` 会：

1. 检查 token 数与 KV token dimension 相等；
2. 再次截断到完整 chunk；
3. 把 Tensor 变成 contiguous CPU Tensor；
4. 创建 store session；
5. 通过 SHM slots 或 inline chunks 传给 Server；
6. `commit_store`；
7. `end_session`。

随后 RequestStream 用 `new_tokens` 替换自己的 live `tokens`。此时它代表“压缩后的缓存前缀”，不再等于原始 prompt。

### 阶段 I：下一次 Decode 前补回 suffix

RequestStream 开始下一次 `generate()` 时：

```python
pending = self._suffix_tokens + caller_suffix_tokens
self.tokens.extend(pending)
self._suffix_tokens = []
```

于是发给 vLLM 的新 prompt 是：

```text
压缩后保留的 token IDs + 之前未进入完整 chunk 的 suffix
```

vLLM 能在 LMCache 中命中压缩后前缀的 KV，只需要为 suffix 重新计算 KV，然后继续生成新 token。

这就是 SDK “工作在 Prefill 和 Decode 之间”的准确含义：它没有插入 vLLM 内部 scheduler step；它是外部 orchestrator，先结束一次 HTTP request，修改外部 KV，再发起下一次 HTTP request。

<h2 id="polling">五、到底是轮询，还是 Server 主动通知 SDK</h2>

答案是：**当前实现是同步调用 + 两层轮询，不是 Server push notification。**

<section class="sdk-polling" data-sdk-polling aria-label="SDK 两层轮询时序图">
  <noscript>第一层：LMCacheSDKContext.retrieve 提交 LOOKUP 后，每 10ms 调一次 QUERY_PREFETCH_STATUS，直到返回非 None 或达到 MQ timeout。第二层：LMCacheRequestStream.retrieve 如果 ctx.retrieve 返回 None，则默认每 200ms 再调用一次，最多 30 秒。LOOKUP future.result 只等待请求提交/响应，不等价于 Server 主动推送数据就绪事件。</noscript>
</section>

### 内层轮询：10ms 查询 `QUERY_PREFETCH_STATUS`

`LMCacheSDKContext.retrieve()` 先发送 `LOOKUP`。`future.result(timeout=...)` 等待这次控制请求得到响应，随后进入：

```python
num_prefetched_tokens = check_lookup_result(request_id)
while num_prefetched_tokens is None:
    time.sleep(0.01)
    num_prefetched_tokens = check_lookup_result(request_id)
```

`check_lookup_result()` 每次都会发送 `QUERY_PREFETCH_STATUS`。

- 返回 `None`：Server 侧 lookup/prefetch 还没完成，继续轮询；
- 返回 `0` 或负值：没有可取回 token；
- 返回正数：已经准备好的 chunk 数，乘以 chunk size 得到 token 数。

### 外层轮询：默认 200ms 再调用 `ctx.retrieve()`

`LMCacheRequestStream.retrieve()` 还包了一层：

```python
tensor = ctx.retrieve(...)
while tensor is None and now < deadline:
    time.sleep(0.2)
    tensor = ctx.retrieve(...)
```

这一层处理的不是同一个 lookup job 的状态细节，而是“这次完整 retrieve 没拿到 Tensor，稍后重新发起一次 retrieve”。默认超时 30 秒，间隔 200ms，可由 `batch.modify(..., timeout=..., poll_interval=...)` 调整。

### 为什么已经等 Prefill HTTP 结束，还要轮询

因为 HTTP token stream 结束与外部 KV 在 LMCache Server 中完全可取回，不一定是同一个同步点。KV Connector 的保存路径可能仍在完成传输、索引或 prefetch 状态切换。

所以当前设计选择“Prefill 请求结束后主动查”，而不是假设 HTTP `[DONE]` 就等于所有 LMCache chunk 已可读取。

### 哪些地方是同步等待

| 操作 | 等待方式 |
|---|---|
| SDK 调 vLLM Prefill/Decode | 读取 HTTP SSE，直到 `[DONE]` |
| `LOOKUP` 提交 | request future 同步等待响应/超时 |
| Prefetch 是否完成 | 每 10ms 主动查询状态 |
| 整次 retrieve 暂时没结果 | RequestStream 每 200ms 重试 |
| SHM/inline Tensor retrieve | `prepare_retrieve → copy/cat → commit_retrieve` 同步完成 |
| 多请求并发 | SDK ThreadPool 中每条 stream 各自阻塞，主线程等 futures |

<h2 id="deployment">六、部署与启动：先跑不需要 patch 的 Random Dropping</h2>

第一次运行建议只走 KV，不要一开始就上 SnapKV。这样能把问题拆成两层：先确认 SDK 的 KV retrieve/edit/store 链路，再增加 Query tensor。

### 0. 环境前提

- Linux + NVIDIA GPU；
- Python 3.12；
- LMCache `dev` 源码安装；
- vLLM 示例已验证的版本区间见仓库 README；
- 足够的 CPU memory / SHM；
- 如果用 Docker，`vllm/vllm-openai:latest` 默认 entrypoint 是 `vllm serve`，进入交互构建容器时要显式使用 `--entrypoint bash`。

安装 LMCache 时先安装 PyTorch，再禁用 build isolation：

```bash
uv venv --python 3.12
source .venv/bin/activate

uv pip install torch
uv pip install -e . --no-build-isolation
```

如果 native extension 有更新，editable install 不会自动重编 `.so`，拉取新代码后要重新执行安装。

### 1. 启动 LMCache Server

仓库 Random notebook 的参考配置是：

```bash
lmcache server \
  --l1-size-gb 150 \
  --eviction-policy LRU \
  --chunk-size 256 \
  --port 6555 \
  --http-port 8080 \
  --shm-name lmcache_kvcache_sdk_e2e \
  --no-l1-use-lazy \
  --supported-transfer-mode auto
```

然后确认：

```bash
curl -sf http://localhost:8080/healthcheck && echo " LMCache ready"
```

参数含义：

| 参数 | 为什么需要 |
|---|---|
| `--l1-size-gb 150` | 示例环境的 L1 容量，不是所有机器的推荐值；按机器内存调整 |
| `--chunk-size 256` | cache key 与 store/retrieve 的最小 token chunk |
| `--port 6555` | MP request endpoint，SDK 示例用 `tcp://localhost:6555` |
| `--http-port 8080` | SDK 读取 `/config`、`/status`，也用于 healthcheck/clear |
| `--shm-name ...` | 让 engine-driven SDK data plane 使用共享内存 |
| `--no-l1-use-lazy` | 让所需 L1 SHM pool 预先可用 |
| `--supported-transfer-mode auto` | 同时支持 vLLM 的 LMCache-driven 与 SDK 的 engine-driven |

150 GiB 来自单 RTX 6000 PRO 实验环境，普通工作站不要照抄。先根据 host RAM、prompt 数量和 KV 大小缩小。

### 2. 启动 vLLM

```bash
vllm serve Qwen/Qwen3-8B \
  --port 8000 \
  --served-model-name Qwen/Qwen3-8B \
  --no-enable-prefix-caching \
  --enforce-eager \
  --gpu-memory-utilization 0.65 \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector",
    "kv_role":"kv_both",
    "kv_connector_extra_config":{"lmcache.mp.port":6555}}' \
  --trust-remote-code \
  --return-tokens-as-token-ids
```

检查：

```bash
curl -sf http://localhost:8000/v1/models && echo " vLLM ready"
```

几个容易误解的参数：

- `--no-enable-prefix-caching`：不是 SDK 功能要求，而是 benchmark 隔离要求。它避免 vLLM 自己的 prefix caching 干扰对 LMCache dropping 收益的归因。
- `--return-tokens-as-token-ids`：示例的 HTTP helper 通过 streaming logprobs 中的 `token_id:<id>` 取回生成 token ID。RequestStream 需要 ID 来维护下一轮 prompt 和 cache key。
- `--gpu-memory-utilization 0.65`：要给“dropping 后能容纳更多 decode 请求”留下可观察空间；实际需要结合 GPU 与请求数调参。

### 3. 启动 SDK Notebook

在同一个 LMCache 源码环境中：

```bash
jupyter lab
```

打开：

```text
examples/token_dropping/random_token_dropping.ipynb
```

Notebook 会做两轮：

```text
第一轮：Prefill → Decode                     （baseline）
清空 LMCache
第二轮：Prefill → Modify/Drop → Decode       （dropping）
比较 output_tput
```

清空 cache 是为了避免第二轮复用第一轮的对象，让比较失去边界。

### 4. SDK connect

```python
kv_ctx = lmc_sdk.kvcache.connect(
    url="tcp://localhost:6555",
    http_url="http://localhost:8080",
    model_name="Qwen/Qwen3-8B",
    timeout=60,
)
```

如果 Server 使用 gRPC request transport，则 SDK URL scheme 也要匹配，例如 `grpc://localhost:6555`。request transport 两端不匹配会直接连不上。

### 5. 收尾

```python
kv_ctx.close()
```

这会关闭 SDK request client 和相关 transport resource。不要在 batch 还没完成时提前 close。

<h2 id="patch-matrix">七、vLLM 到底要不要打 patch</h2>

结论用表格最清楚：

| 算法 | 需要的数据 | vLLM patch | qstore server module | `transfer_intermediate_tensors` |
|---|---|---:|---:|---:|
| Random / 基于规则的 dropping | KV | 不需要 | 不需要 | 不需要 |
| SnapKV | KV + Query | 需要 | 需要 | 需要 |
| R-KV | KV + Query | 需要 | 需要 | 需要 |

### 为什么 Query 需要 patch

正常 KV Connector contract 关注 KV Cache，并不会把 Attention forward 的 Query intermediate tensor 交给 connector。

但 SnapKV 要回答：最近窗口里的 Query 最关注历史哪些 Key？没有 Query，就无法计算这类 attention-based importance score。

仓库提供的 patch 修改 vLLM 两个 Python 文件：

1. 在 connector base 增加 `transfer_intermediate_tensors` 属性；
2. Attention wrapper 在该属性为真时，把绑定后的 forward arguments 作为 `intermediate_tensors` 传给 `save_kv_layer()`。

它不修改 CUDA kernel，不需要重编 vLLM；应用 patch 后重启 vLLM 即可。README 标注的验证区间是 vLLM `0.23.0` 到 `0.25.1`，其他版本要先检查 patch context 是否仍匹配。

源码 checkout：

```bash
cd /path/to/vllm
git apply /path/to/LMCache/examples/token_dropping/vllm-export-intermediate-tensors.diff
```

wheel 安装：

```bash
VLLM_DIR=$(python -c "import vllm, os; print(os.path.dirname(vllm.__file__))")
patch -p1 -d "$VLLM_DIR/.." \
  < /path/to/LMCache/examples/token_dropping/vllm-export-intermediate-tensors.diff
```

### Server 还要加载 qstore

```bash
lmcache server \
  ... \
  --supported-transfer-mode auto \
  --server-module \
  '{"module_path":"lmcache.v1.multiprocess.plugin_modules.qstore"}'
```

### vLLM 还要打开中间 Tensor 传输

```json
{
  "kv_connector": "LMCacheMPConnector",
  "kv_role": "kv_both",
  "kv_connector_extra_config": {
    "lmcache.mp.port": 6555,
    "lmcache.mp.transfer_intermediate_tensors": true,
    "lmcache.mp.q.ring_depth": 2
  }
}
```

Query 会通过 QRingBuffer 暂存。`q.ring_depth=2` 表示可以容纳两个 forward pass 的临时 Query 数据；它不是“保留两个 token”。

<section class="sdk-patch-decision" data-sdk-patch-decision aria-label="vLLM patch 决策图">
  <noscript>如果 dropping 算法只依据 KV 或固定规则，不需要 patch；如果算法要依据 Query 与 Key 的 attention score，则需要 vLLM patch、qstore module、transfer_intermediate_tensors 配置和 Query SDK context。</noscript>
</section>

<h2 id="algorithm-boundary">八、Random、SnapKV、R-KV 的系统边界其实相同</h2>

三者都遵循相同的外部生命周期：

```text
Prefill → Retrieve tensors → Compute keep_idx → Compact → Store → Decode
```

区别集中在 `Compute keep_idx`：

| 方法 | 如何决定保留位置 | 优点 | 代价/风险 |
|---|---|---|---|
| Random/规则 | 固定规则或随机选择 | 最容易跑通，不需要 Query | 质量不可控，主要用于系统验证 |
| SnapKV | 最近 Query 对历史 Key 的注意力重要性 | 比随机更有语义依据 | 需要 Query；仍可能删除后续有用信息 |
| R-KV | 注意力重要性减去 Key 冗余项 | 希望保留“重要且不重复”的位置 | 冗余计算可能达到 O(n²)，实现更复杂 |

SDK 的价值在这里变得清楚：它不规定你必须用哪个算法，只提供稳定的“取 tensor → 用户函数修改 → 写回”边界。

<h2 id="performance">九、为什么 Dropping 可能提高吞吐，但不一定提高</h2>

长上下文 Decode 主要有两个相关压力：

1. 每条请求持有的 KV Cache 更大，GPU 同时能放下的活跃请求更少；
2. 每生成一个新 token，Attention 要读取更多历史 K/V，内存带宽和计算开销上升。

Dropping 让每个请求的有效 KV 上下文变短，可能带来：

- 同一块 GPU memory 放入更多 decode request；
- 每步 attention 读取更少历史 KV；
- batch size 上升后，模型计算资源利用率提高。

但收益出现需要条件：

- 原来确实受 KV memory 或长上下文 attention 限制；
- scheduler 能把释放的空间转化为更多并发；
- dropping + CPU retrieve/edit/store 的一次性成本能被后续长 Decode 摊薄；
- 质量损失在业务允许范围内。

如果只有一个短请求，或者生成很快结束，SDK 修改成本可能大于后续收益。仓库 README 中的 1.5–1.7× 是特定 RTX 6000 PRO、请求集和参数下的示例结果，不是产品 SLA。

### 质量是第一约束

KV Cache 是模型历史记忆的一部分。删掉一个 token 的 KV，相当于未来 token 的 Attention 再也不能直接访问那个历史位置。

因此生产化不能只看 tokens/s，还至少要比较：

- 任务正确率或生成质量；
- 首 token 延迟与 modify 时间；
- Decode throughput；
- GPU peak memory 与实际 batch size；
- 不同 prompt 长度、drop ratio、模型与任务的敏感度；
- 算法失败或 SDK 超时时如何回退。

<h2 id="failure-model">十、常见故障从哪一层排查</h2>

| 现象 | 最可能的边界 | 首先检查 |
|---|---|---|
| SDK connect 报找不到 layout | vLLM 尚未注册 | 启动顺序、model name、`/status` |
| SDK 一直 retrieve 不到 KV | Prefill/store/lookup | vLLM connector、Server 日志、chunk 数、两层 timeout |
| ZMQ/gRPC 连不上 | request plane | Server `--transport` 与 SDK URL scheme 是否匹配 |
| SHM 不生效 | data plane | `--shm-name`、`--no-l1-use-lazy`、同机与权限 |
| SnapKV 找不到 Query | intermediate tensor path | vLLM patch、qstore、transfer flag、ring depth |
| Decode 输出异常但不报错 | dropping algorithm | token/KV 索引是否同步、RoPE 是否重映射、质量评测 |
| Dropping 后吞吐没提升 | workload/scheduler | 是否仍是同一 batch size、KV 是否真是瓶颈、modify 是否太贵 |

<h2 id="pr-note">十一、PR #6282 解决的状态记录问题</h2>

Cache Dropping 会让 `RequestStream.tokens` 发生两类变化：

1. `generate()` 把新生成 token 追加进去；
2. `modify_kv()` / `update()` 又会用压缩后的 token 序列替换它，并把未缓存尾部移到 suffix。

所以 `tokens` 是“下一次送给引擎、并用于 KV key 的 live sequence”，不是不可变的生成历史。

PR [#6282](https://github.com/LMCache/LMCache/pull/6282) 处理的问题是：`output_tokens` 原来直接返回 `self.tokens`，因此它会混入 prompt；KV 修改后又会随着 live sequence 被替换，无法稳定表达“模型累计生成了哪些 token”。

该 PR 的处理方式是单独维护 `_output_tokens`：每次 generation 在 `finally` 中把已经 yield 的 token IDs 追加进去，与 `decoded_tokens` 和 `output_text` 保持同一累计语义；`output_tokens` 与 `suffix_tokens` 的 accessor 返回 list copy，避免外部误修改内部状态。

这个改动不改变 Cache Dropping 算法，也不改变 KV retrieve/store 协议。它修正的是 RequestStream 在多次 Prefill/Modify/Decode 之间如何记录生成历史。

<h2 id="constraints">十二、当前 SDK 的边界</h2>

根据当前设计文档，至少要记住：

- SDK 是 out-of-process、CPU-side client，不是透明线上中间件；
- 当前主要面向受控实验与离线 batch orchestration；
- retrieve/store 按 token chunk 寻址；
- 模型 layout 必须先由 vLLM 注册；
- 当前文档约束 `world_size == 1`、单一 non-hybrid kernel group；
- Query 路径是额外的实验能力，需要 qstore 与 vLLM intermediate tensor 支持；
- dropping 的质量责任在算法与评测，不由 SDK 自动保证。

<h2 id="glossary">十三、术语表：阅读代码前先把名字对齐</h2>

<h3 id="term-kv-cache">KV Cache</h3>

Transformer Attention 为历史 token 计算出的 Key/Value Tensor。Decode 时复用它们，避免重算整个历史。它不是文本，也不是 token IDs，而是每层的数值中间状态。

<h3 id="term-prefill">Prefill</h3>

一次处理完整 prompt，计算所有 prompt token 的 hidden states 与 KV Cache。与逐 token 的 Decode 相比，Prefill 并行度高，但长 prompt 的单次计算量大。

<h3 id="term-decode">Decode</h3>

在已有 KV Cache 上一次生成一个或少量 token。每一步会读取历史 KV，新 token 的 KV 再追加到缓存中。

<h3 id="term-chunk">Chunk</h3>

LMCache 进行 hash、lookup、store 和 retrieve 的 token 分块。示例使用 256 token。不是完整 chunk 的尾部不会作为一个不完整对象直接返回给 SDK。

<h3 id="term-original-kv">原始 KV</h3>

本文中的描述性名称：vLLM 对未 dropping 的原始 prompt 执行 Prefill 后产生的 KV。它不是代码类型；能从 LMCache 取回的部分仍受完整 chunk 对齐限制。

<h3 id="term-suffix">Suffix Tokens</h3>

逻辑 token 序列中位于 `cached_len` 之后、没有出现在本次 chunk-aligned KV Tensor 里的尾部。修改 KV 时不能丢掉；下一次 Decode 要把它们重新送给 vLLM 计算 KV。

<h3 id="term-live-sequence">Live Sequence</h3>

RequestStream 当前用于下一次 completion 和 cache key 的 token IDs。Dropping 后它会变成“保留 token + suffix”，所以不能拿它当累计生成历史。

<h3 id="term-request-plane">Request Plane</h3>

传递 LOOKUP、状态查询、prepare/commit、session end 等控制消息的通道。当前可使用 ZMQ 或 gRPC。

<h3 id="term-data-plane">Data Plane</h3>

真正搬运 KV Tensor bytes 的路径。SDK engine-driven 路径可使用 POSIX SHM 或 inline tensor codec；它与 request transport 是两个不同选择。

<h3 id="term-lmcache-driven">LMCache-driven</h3>

LMCache Server 根据 vLLM 已注册的 GPU KV handle 与 block IDs 驱动数据传输。vLLM MP Connector 主要走这条路径。

<h3 id="term-engine-driven">Engine-driven</h3>

外部 engine/client 主动执行 prepare、填充或读取 slot、commit 的传输模式。SDK 为了拿到连续 CPU Tensor 使用这条路径。

<h3 id="term-query-tensor">Query Tensor</h3>

Attention 的 Q。SnapKV/R-KV 用近期 Query 与历史 Key 的关系估计重要性。它不是普通 KV Connector 默认保证导出的对象，因此当前示例需要 vLLM patch。

<h3 id="term-rope">RoPE Re-rotation</h3>

删除中间 token 后，把保留 Key 中编码的旧位置旋转移除，再应用压缩后的新位置旋转。否则 Tensor 虽然 shape 正确，位置语义却仍是旧的。

## 最后再把全流程压缩成一段话

先启动 LMCache Server，再启动带 `LMCacheMPConnector` 的 vLLM，让 vLLM 把真实 GPU KV layout 注册给 Server。随后启动独立 SDK 进程：它先通过 `/v1/completions` 发起 `max_tokens=1` 的 Prefill，等待 HTTP stream 结束；再主动调用 modify，对 LMCache 发 LOOKUP，并通过 10ms 状态轮询与外层 200ms retrieve 重试等待 KV 可用；拿到 chunk-aligned 连续 CPU KV 后，算法计算保留位置，同步压缩 KV 与 token IDs，必要时重做 RoPE，再通过 SHM 或 inline engine-driven path 写回。最后 RequestStream 把没有进入完整 chunk 的 suffix 补回压缩后的 token 序列，重新调用 vLLM Decode。

Random Dropping 只需要 KV，不需要改 vLLM。SnapKV/R-KV 需要 Query，因此当前示例要额外应用 vLLM 两文件 patch、加载 qstore module 并打开 intermediate tensor transfer。

理解这两个边界——**外部同步编排，而不是插入 scheduler；主动轮询，而不是 Server push 通知**——就理解了当前 LMCache SDK Cache Dropping 的系统位置。

