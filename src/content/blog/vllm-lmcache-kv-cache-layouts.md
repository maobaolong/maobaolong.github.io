---
title: "NHD、HND、BLHNC、BLNHC：vLLM 和 LMCache 的 KV Layout 到底在选什么"
description: "从 vLLM 的 KVCacheLayout 解析、不同 attention backend 的偏好，到 LMCache 的 EngineKVFormat 探测与转换边界，系统解释为什么会有多种 KV layout。"
publishedAt: 2026-09-16
updatedAt: 2026-09-18
category: AI Infra
tags:
  - vllm
  - lmcache
  - kv-cache
  - attention
  - inference
  - distributed-systems
author: 毛宝龙
readingTime: 27 min
featured: true
draft: false
---

如果你最近翻 vLLM 或 LMCache 的 KV cache 代码，很容易遇到这几个名字：`NHD`、`HND`、`BLHNC`、`BLNHC`。

它们看上去像某种硬件暗号，但本质很朴素：**同一批 KV bytes，在内存里先按 token 走，还是先按 head 走；先把 layer 放外面，还是先把 block 放外面。**

这件事之所以重要，是因为 KV cache 不是普通张量。它处在几条热路径的交汇点上：

- attention kernel 要高吞吐读写它；
- tensor parallel 要按 head 或 block 切它；
- prefix cache / HMA 要把多个 layer、多个 KV group 放进同一套 block allocator；
- LMCache、NIXL、Mooncake 这类外部 KV 系统要跨进程、跨机器搬它；
- MLA、sparse attention、quantized KV、hybrid model 又会改变每个 page 的真实形状。

所以 layout name 不是审美选择，而是“kernel、allocator、transfer 三方能不能用同一块物理内存说话”的协议。

本文基于 2026-09-16 拉取的源码快照：vLLM [`8be5205`](https://github.com/vllm-project/vllm/tree/8be5205abbabf4c377c603d6c4180a99373f6415)，LMCache [`1b7dff2`](https://github.com/LMCache/LMCache/tree/1b7dff2cd83fc634326b5989eb71aa5f05b4f426)。如果你读到这篇时源码已经继续演进，优先看当前代码。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/axis-order.svg" aria-label="打开 KV layout 轴顺序动态图原图">
    <img src="/images/blog/kv-layouts/axis-order.svg" alt="NHD、HND、BLNHC、BLHNC 轴顺序和连续访问方式动态图" />
  </a>
  <figcaption>图 1：白色游标按物理轴顺序扫描；右侧小格按连续访问顺序亮起，用来区分 token-major、head-major 和 block-first。</figcaption>
</figure>

## 先把名字拆开

vLLM 现在的标准抽象是 `KVCacheLayout`。它把 KV cache group 的逻辑轴固定成：

```text
[L, B, H, N, C]
```

含义是：

| 轴 | 含义 | 直觉 |
|---|---|---|
| `L` | layer | 第几层 |
| `B` | block/page | 第几个 paged-attention block |
| `H` | KV head | 第几个 KV head，TP 经常切这根轴 |
| `N` | block 内 token/state | 老名字里的 `N`，也可以理解成每个 block 里的 token/state 行 |
| `C` | content | 每个 head/state 的内容宽度；可能是 head_dim，也可能是 K/V packed 后的 content size |

源码里这个 enum 写得非常直接：`LBHNC` 是 `[L, B, H, N, C]`，`LBNHC` 是 `[L, B, N, H, C]`，`BLHNC` 是 `[B, L, H, N, C]`，`BLNHC` 是 `[B, L, N, H, C]`。vLLM 还保留了老名字兼容：`NHD -> LBNHC`，`HND -> LBHNC`。也就是说，今天你看到的 `NHD/HND` 多半是在说 **per-layer、block 内部** 的旧命名；而 `LBNHC/LBHNC/BLNHC/BLHNC` 是把 layer 和 block 两根外层轴也纳入名字后的完整物理布局。参考 vLLM 的 [`KVCacheLayout`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/kv_cache_layout.py#L15-L58) 和 [`_LAYOUT_COMPAT_ALIASES`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/config/cache.py#L21-L24)。

把四个常见名字放成一张表：

| 常见名字 | vLLM 标准名 | 物理顺序 | 更像哪种访问 |
|---|---|---|---|
| `NHD` | `LBNHC` | layer -> block -> token/state -> head -> content | token-major，同一个 token 的多个 head 比较近 |
| `HND` | `LBHNC` | layer -> block -> head -> token/state -> content | head-major，同一个 head 的连续 token 比较近 |
| `BLNHC` | `BLNHC` | block -> layer -> token/state -> head -> content | block-first + token-major |
| `BLHNC` | `BLHNC` | block -> layer -> head -> token/state -> content | block-first + head-major |

这里最容易误解的是 `N`。它不是“sequence length 全局维度”，而是 paged KV block 内部的 token/state 维度。一个请求的长序列会被 block table 映射到很多 `B`，每个 block 里面再有 `N` 行。

## 为什么会有多种 KV layout？

最短答案是：**不同路径想让不同维度连续。**

以一个 block 内部为例。假设 `block_size = 16`、`num_kv_heads = 8`、`head_dim = 128`。

`NHD` / `LBNHC` 的局部内存像这样：

```text
token 0: head 0, head 1, ..., head 7
token 1: head 0, head 1, ..., head 7
...
token 15: head 0, head 1, ..., head 7
```

`HND` / `LBHNC` 的局部内存像这样：

```text
head 0: token 0, token 1, ..., token 15
head 1: token 0, token 1, ..., token 15
...
head 7: token 0, token 1, ..., token 15
```

这两种没有绝对高下，只有使用场景不同。

如果 kernel 以 token 为主线读，或者想把 `(block, token)` 直接 flatten 成一个连续 token 维度，那么 `NHD/LBNHC` 很舒服。vLLM 的 FlexAttention 就明说了：它要把 `(B, N)` flatten 成一个 token dim，只有 `LBNHC` 的 stride 能零拷贝做到，所以只支持 `LBNHC`。vLLM 的 HPC 和 TurboQuant backend 也选择 `LBNHC`。对应源码在 [`flex_attention.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/flex_attention.py#L129-L133)、[`hpc_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/hpc_attn.py#L321-L322)、[`turboquant_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/turboquant_attn.py#L160-L161)。

如果要按 head 做切分，或者希望一个 head 的 block 内容是连续段，`HND/LBHNC` 往往更合适。CPU backend 当前只读 head-major block interior，所以它只支持 `LBHNC`。NIXL 和 Mooncake connector 在非 MLA 场景也偏好 `LBHNC`：NIXL 的注释是 better xfer performance；Mooncake 的注释是 heterogeneous TP-safe KV transfer。参考 [`cpu_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/cpu_attn.py#L67-L70)、[`nixl/connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/nixl/connector.py#L141-L158)、[`mooncake_connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/mooncake/mooncake_connector.py#L512-L527)。

那 `BLHNC/BLNHC` 为什么出现？因为有些模型和 allocator 不是“每层一块完整同形状 KV”。DeepSeek V4 indexer、Dots3 NOTE DSA、Qwen4 experimental QSA 这类路径会把小的 index/state sidecar page 和主 KV/MLA page 放在同一个 block allocation 旁边。此时如果仍然是 `L` 在最外层，混合 page size / mixed HNC shape 就不好表达；把 `B` 放到最外层、`L` 放到 block 内，能让“一个 block 里的多个 layer/group page”一起被管理。vLLM 在解析 layout 时也有这条规则：当多个 KV cache spec 的 `(num_heads, num_states, page_size_bytes)` 不一致时，只保留 block-compact layout 候选。参考 [`resolve_kv_cache_layout`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/utils.py#L285-L299)、[`DeepseekV4IndexerBackend`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/mla/indexer.py#L239-L248)、[`Dots3NotePaddedSparseBackend`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/models/dots3_note/nvidia/attention.py#L696-L700)、[`QSAStateCache`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/models/qwen4_exp/common/qsa_cache.py#L754-L756)。

所以，“为什么有这么多种 layout？”不是因为项目喜欢造词，而是因为 KV cache 同时要满足：

1. kernel 内存访问模式；
2. tensor parallel / pipeline / heterogeneous TP 的切分方式；
3. paged allocator 和 HMA 的 page overlay 方式；
4. 外部 KV transfer 的段合并、RDMA 注册和跨 worker 兼容；
5. 模型结构：MHA/GQA/MLA、sliding window、sparse sidecar、quantized packed state；
6. device/backend 能力：CPU、CUDA、ROCm、FlashInfer、AITER、TRTLLM-gen 等 kernel 的真实约束。

## vLLM 到底如何自动选择？

vLLM 的选择流程现在集中在 engine core 解析阶段，而不是每个 worker 自己随便猜。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/selection-flow.svg" aria-label="打开 vLLM KV layout 选择流程动态图原图">
    <img src="/images/blog/kv-layouts/selection-flow.svg" alt="vLLM 在 engine core 中解析 KV cache layout 的动态图" />
  </a>
  <figcaption>图 2：layout 先在 engine core 中解析并写入 CacheConfig，随后 worker 才按 resolved layout 创建 KV cache view。</figcaption>
</figure>

核心逻辑在 `resolve_kv_cache_layout`：

1. 每个 attention backend 通过 `supported_kv_cache_layouts()` 报自己支持的 layout，顺序就是偏好顺序。
2. 如果没有 backend 明确声明，vLLM 使用默认偏好：`LBNHC, LBHNC, BLNHC, BLHNC, BHLNC, LHBNC`。这个默认把旧 main 行为对应的 `NHD/LBNHC` 放第一。
3. 多个 backend 混用时求交集；如果没有交集，启动失败。
4. 如果 KV specs 的 HNC shape 混合，进一步限制到 block-compact layout。
5. 如果用户设置了 `VLLM_KV_CACHE_LAYOUT`，它必须在候选集里；否则报错。
6. 如果 connector 返回了 required/preferred layout，兼容就采用，不兼容就 warning 后回退到候选第一项。
7. 最终 layout 写回 `CacheConfig.kv_cache_layout`，再传给 worker allocation。

源码入口可以看 [`get_supported_kv_cache_layouts`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/utils.py#L204-L239) 和 [`resolve_kv_cache_layout`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/utils.py#L254-L322)。实际分配时，vLLM 先申请一块 `int8` backing buffer，再用 `create_kv_cache_views` 按 resolved layout 做每层 view；也就是说 layout 决定的是同一块 backing allocation 上的 stride/view，而不只是日志里的一行字符串。参考 [`allocate_kv_cache`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/worker/utils.py#L389-L455)。

## 目前哪些组合选什么？

下面这个表按“源码里已经显式声明的选择/偏好”列，默认 backend 未声明时走 vLLM 默认偏好，通常落到 `LBNHC/NHD`。

| 场景 | 当前 layout 选择 | 主要原因 |
|---|---|---|
| 普通未声明 backend | 默认候选第一项 `LBNHC`，也就是旧名 `NHD` | 保持 main 默认行为；backend 没有更强约束 |
| `CPU_ATTN` | `LBHNC` / `HND` | CPU backend 只读 head-major block interior |
| FlexAttention | `LBNHC` / `NHD` | 需要把 `(B, N)` flatten 成 token dim，只有 `LBNHC` 可零拷贝 |
| HPC attention | `LBNHC` / `NHD` | backend 明确只声明 `LBNHC` |
| TurboQuant attention | `LBNHC` / `NHD` | quantized layout/kernel 选择 token-major |
| FlashInfer on NVIDIA capability major 10 | `LBHNC`，可接受 `BLHNC` | TRTLLM-gen kernel 消费 head-major block interior，外层 L/B 嵌套不重要 |
| vLLM B12x backend | `LBHNC`，可接受 `BLHNC` | 同样是 head-major 优先，并允许 block-first 变体 |
| ROCm native attention | `LHBNC` 优先，`LBHNC` 次之 | HIP native kernel 需要 K/V group 跨所有 blocks；Triton fallback stride-aware |
| ROCm AITER FA | `LBHNC`，`LHBNC`；启用某些 connector 时只保留 `LBHNC` | K/V 从 content dim 转置 view 出来；connector 需要 contiguous blocks |
| ROCm AITER MLA sparse | `LBNHC`，`LBHNC` | AITER MLA sparse 同时接受 token-major 和 head-major |
| FlashInfer MLA sparse SM90 | `LBHNC` | 该 MLA sparse backend 显式声明 head-major |
| Kpool tail state cache | `LBHNC` | storage-only tail cache 选择 head-major |
| DeepSeek V4 / V4.1 indexer | `BLHNC`，可接受 `BLNHC` | indexer page 和 MLA latent page pack 在每个 block 内，layer 必须在 block 里面 |
| Dots3 NOTE padded sparse | `BLHNC` | 较小 DSA index page 和 padded MLA/SWA page 同 block 管理 |
| Qwen4 experimental QSA state | `BLNHC`，可接受 `BLHNC` | QSA pages 和 main KV pages 在 block 内并排 |
| NIXL connector，非 MLA | 偏好 `LBHNC` | transfer 性能；heterogeneous TP 按 head 切分更友好 |
| Mooncake connector，非 MLA | 偏好 `LBHNC` | heterogeneous TP-safe KV transfer |
| Offloading connector | HiSparse 时 `BLHNC`，否则 `LBHNC` | HiSparse 需要 block-first；普通 offload 走 head-major |
| HiSparse connector | `BLHNC` | HiSparse transfer engine 直接要求 block-first/head-major |
| Hidden-states example connector | `LBNHC` | 希望同 token 的 hidden states 连续；注释也说 `LBHNC` 更偏 head sharding |
| LMCacheMPConnector | 不向 vLLM 施加偏好 | LMCache 选择尊重 vLLM 已解析 layout；避免压过某些 backend 未声明但实际依赖的布局 |

上表的代码入口主要在各 backend/connector 的 `supported_kv_cache_layouts()` 或 `get_required_kvcache_layout()`：例如 [`flashinfer.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/flashinfer.py#L542-L549)、[`rocm_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/rocm_attn.py#L261-L267)、[`rocm_aiter_fa.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/rocm_aiter_fa.py#L927-L931)、[`offloading_connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/offloading_connector.py#L229-L233)、[`hisparse/connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/hisparse/connector.py#L194-L196)、[`example_hidden_states_connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/example_hidden_states_connector.py#L605-L610)。

这个表里有两个重要点。

第一，`connector` 的偏好不是总能覆盖 `attention backend`。vLLM 的逻辑是 connector preference 只在候选集兼容时采用，不兼容会回退。这样可以避免外部 KV 系统为了搬运方便，强行选出 kernel 不能读的 layout。

第二，MLA 经常是特殊情况。NIXL 和 Mooncake 在 `use_mla` 时会返回 `None`，让 vLLM 回到 backend/default 的选择；因为 MLA 的 KV 形态通常不是传统 `[K,V] x heads x tokens x head_dim`，head/token 的权衡不完全一样。

## LMCache 里为什么又有一套 EngineKVFormat？

vLLM 的 `KVCacheLayout` 回答的是：**这块 KV cache backing allocation 的物理 stride order 是什么？**

LMCache 的 `EngineKVFormat` 回答的是：**某个 serving engine 实际递给 LMCache 的 KV cache 容器长什么样？**

这两个不是同一层抽象。

例如 vLLM 可能把每层 KV 作为一个 list 传过来：

```text
NL x [2, NB, BS, NH, HS]     # vLLM flash-attn NHD
NL x [NB, 2, BS, NH, HS]     # vLLM flash-infer NHD
NL x [NB, BS, NH, CS]        # unified KV cache, K/V packed
```

TRT-LLM 可能是一个 cross-layer pool：

```text
[NB, NL, 2, NH, BS, HS]
```

SGLang MHA 又可能是 `[K_list, V_list]` 两层嵌套。

LMCache 不能只问“你是 HND 还是 NHD”，它还要知道：

- 是单 tensor、per-layer list，还是 `[K_list, V_list]` nested list；
- K/V 是显式 `2` 轴，还是 packed 到 content 维；
- 是 cross-layer 还是 per-layer；
- 是 MLA、MHA、DSA indexer、RBLN singleton-axis 这种特殊结构；
- HND/NHD 是张量 shape 上看得出来，还是只能从 stride/hint 判断。

所以 LMCache 把它们收敛成 `EngineKVFormat`。文档里的表很长，核心例子是：

| EngineKVFormat | Engine/路径 | layout | 结构 |
|---|---|---|---|
| `NL_X_TWO_NB_BS_NH_HS` | vLLM flash-attn | NHD | `NL x [2, NB, BS, NH, HS]` |
| `NL_X_TWO_NB_NH_BS_HS` | vLLM flash-attn | HND | `NL x [2, NB, NH, BS, HS]` |
| `NL_X_NB_TWO_BS_NH_HS` | vLLM flash-infer | NHD | `NL x [NB, 2, BS, NH, HS]` |
| `NL_X_NB_TWO_NH_BS_HS` | vLLM flash-infer | HND | `NL x [NB, 2, NH, BS, HS]` |
| `NL_X_NB_BS_NH_CS` | vLLM blocks-first fused | NHD | `NL x [NB, BS, NH, CS]` |
| `NL_X_NB_NH_BS_CS` | vLLM blocks-first fused | HND | `NL x [NB, NH, BS, CS]` |
| `NB_NL_TWO_BS_NH_HS` | vLLM cross-layer | NHD | `[NB, NL, 2, BS, NH, HS]` |
| `NB_NL_TWO_NH_BS_HS` | TRT-LLM cross-layer | HND | `[NB, NL, 2, NH, BS, HS]` |
| `TWO_X_NL_X_NB_BS_NH_HS` | SGLang MHA via MP daemon | NHD | `[K_list, V_list]`，每层 `[NB, BS, NH, HS]` |
| `NL_X_NBBS_ONE_HS` | SGLang MLA | MLA | `NL x [page_buffer_size, 1, HS]` |

LMCache 的 design doc 明确要求 `normalize_kv_and_discover_format` 是唯一解析入口：它返回 `(EngineKVFormat, normalized_kv_caches)`，后面的 pointer、shape desc、kernel dispatch 都查询 format facts，而不是每个调用点重新按 shape 猜。参考 LMCache 的 [`layout-invariant.md`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/docs/design/v1/gpu_connector/layout-invariant.md#L6-L15) 和 format map [`#L145-L161`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/docs/design/v1/gpu_connector/layout-invariant.md#L145-L161)。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/lmcache-detection.svg" aria-label="打开 LMCache KV format 检测动态图原图">
    <img src="/images/blog/kv-layouts/lmcache-detection.svg" alt="LMCache 结合 raw tensor 和 resolved layout hint 消歧的动态图" />
  </a>
  <figcaption>图 3：LMCache 同时依赖 raw tensor 的 shape/stride/nesting 和 vLLM 的 resolved layout hint；shape 有歧义时，hint 负责消歧。</figcaption>
</figure>

## LMCache 能自动探测吗？

可以，但不是魔法。

LMCache 的检测分三步：

1. `attempt_permute_to_contiguous_view` 先尝试用 stride 信息恢复物理维度。例如 vLLM 的 HND 物理布局可能被暴露成逻辑 NHD view；LMCache 会按 stride 大小排序做 metadata-only `permute`，不复制 storage。
2. `detect_format` 根据 serving engine 找对应 detector。
3. vLLM detector 再结合 `layout_hints["kv_layout"]` 和容器结构，返回具体 `EngineKVFormat`。

这也是为什么 LMCache 的 vLLM integration 会在注册时查询 vLLM 已解析的 layout，把 `LBNHC -> NHD`、`LBHNC -> HND`、`BLHNC/BLNHC` 原样传给 LMCache。参考 [`vllm_layout_hints`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/utils.py#L43-L49) 和 [`translate_vllm_kv_cache_layout`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/utils.py#L52-L75)。

为什么还需要 hint？因为有些形状单靠 rank/shape 分不出来。LMCache 的 vLLM detector 在 rank-4 fused K/V 路径里写得很直白：中间两根轴是 `NH/BS` 还是 `BS/NH`，只看 shape 可能无法区分，必须靠 resolved `kv_layout` 判断；而 `BLHNC/BLNHC` 的差异还要看 stride(0)。参考 [`detectors/vllm.py`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/v1/gpu_connector/kv_format/detectors/vllm.py#L51-L72)。

所以可以这样理解：

| 问题 | vLLM | LMCache |
|---|---|---|
| 谁决定本机 KV cache 用什么物理 layout？ | vLLM engine core | 不决定，尊重 engine |
| 能否自动选择？ | 能，根据 backend/support/env/connector resolution | 不替 vLLM 选择，只自动识别已注册 KV 的 engine format |
| 是否需要 hint？ | 用户可通过 `VLLM_KV_CACHE_LAYOUT` 强制 | 对 shape 歧义、TRT-LLM reshape、SGLang folded dimension 等需要 engine hint |
| 探测失败怎么办？ | layout 不在候选集会启动失败 | unsupported structure / layout 会抛错 |

一个特别值得注意的设计选择是：LMCache 自己的 `LMCacheMPConnector` 现在不向 vLLM 施加 required layout。它的注释说，connector preference 在 vLLM resolution 中优先级高于默认值，但如果某些 backend 还没有声明自己的 layout 依赖，connector 强行偏好会让 backend 静默读错布局。LMCache 选择处理所有已解析 layout，而不是替 vLLM 选择。参考 [`lmcache_mp_connector.py`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/lmcache_mp_connector.py#L1368-L1382)。

## 这些 layout 可以互相转换吗？

要分四种情况。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/conversion-map.svg" aria-label="打开 KV layout 转换成本动态图原图">
    <img src="/images/blog/kv-layouts/conversion-map.svg" alt="KV layout 转换成本分类动态图" />
  </a>
  <figcaption>图 4：把“转换”拆成四类：metadata-only view、真实数据重排、命名翻译、以及当前 transfer kernel 不支持的碎片化布局。</figcaption>
</figure>

**第一种：只是 view 的转换，成本很低。**

如果同一块 storage 的真实物理布局已经是 HND，只是上层给了一个逻辑 NHD view，那么按 stride 重新 `permute` 回物理 shape 是 metadata-only。LMCache 的 `attempt_permute_to_contiguous_view` 就是做这个：排序维度、返回共享 storage 的 view，明确不 fallback 到 `.contiguous()`。参考 [`contiguity.py`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/v1/gpu_connector/kv_format/contiguity.py#L43-L73)。

**第二种：真实数据重排，成本很高。**

如果你真的要把 `[B, H, N, C]` 的 bytes 重排成 `[B, N, H, C]`，那就是大规模 KV 转置。KV cache 动辄 GB 级，这不该成为正常热路径。vLLM 的 NIXL receive path 里有一些特定后处理，例如 experimental `enable_permute_local_kv` 支持 remote `LBHNC` 到 local `LBNHC` 的额外 permute，也能同时处理 block size ratio；但这是特定异构 P/D/TP 场景，不是通用“layout 随便互转”。参考 [`nixl/base_worker.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/nixl/base_worker.py#L2458-L2482) 和 postprocess helper [`utils.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/utils.py#L295-L314)。

**第三种：语义翻译，不是物理转换。**

`NHD -> LBNHC`、`HND -> LBHNC` 这种只是新旧命名对齐。LMCache 把 vLLM 的 `LBNHC/LBHNC` 翻译成自己的 `NHD/HND` hint，也只是把“vLLM 标准名”映射成“LMCache detector 认识的 hint 名”，不是动了内存。

**第四种：不支持就该失败。**

比如 `LHBNC`、`BHLNC` 这类 head-outermost layout，会把每个 block 的内容按 head 分裂成多段。LMCache vLLM integration 当前只支持 `NHD/HND/BLHNC/BLNHC`，遇到 `LHBNC/BHLNC` 会抛 `NotImplementedError`，原因是 transfer kernels 当前按每个 `(layer, block)` 的 contiguous run 处理，head-outermost 会碎片化。参考 [`translate_vllm_kv_cache_layout`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/utils.py#L70-L75)。

工程上最好的策略是：**在 KV cache 分配之前选对 layout；不要指望分配后再把 GB 级 KV cache 转来转去。**

## 读 layout 时的几个判断口诀

可以按四个问题看：

1. **H 在 N 前面还是后面？**  
   `HND/LBHNC/BLHNC` 是 head-major；`NHD/LBNHC/BLNHC` 是 token/state-major。

2. **L 在 B 前面还是后面？**  
   `L*` 是 layer-compact，常见于每层 view；`B*` 是 block-outermost，常见于需要把多个 layer/group page 放到同一 block allocation 里的 hybrid/sparse/sidecar 场景。

3. **K/V 是独立轴还是 packed content？**  
   `[..., 2, ..., HS]` 和 `[..., CS]` 在 LMCache 里会是不同 `EngineKVFormat`。`CS` 经常表示 K/V fused 后的 content size。

4. **这个名字来自 vLLM 还是 LMCache？**  
   vLLM 的 `KVCacheLayout` 是 stride permutation。LMCache 的 `EngineKVFormat` 是 engine-facing container + tensor format。不要把这两个层级混成一个。

## 最后收束一下

`NHD/HND/BLHNC/BLNHC` 背后，其实是三组工程取舍：

- **读写局部性**：token-major 更适合 token 展平，head-major 更适合按 head 读写/切分。
- **分配几何**：layer-first 简单直接，block-first 更适合 mixed page、hybrid allocation 和 sidecar state。
- **系统边界**：vLLM 要让 attention backend 能读；LMCache 要让跨进程/跨设备 transfer 能搬；NIXL/Mooncake 要让 heterogeneous TP 和 RDMA segment 尽量稳。

所以 layout 最好不要被看成“张量 shape 的小差异”。它更像一份内存协议：attention kernel、allocator、KV connector、外部 cache server 都在用它对齐各自的坐标系。

当你看到一个 PR 改 layout，真正该问的不是“它把 NHD 改成 HND 了吗”，而是：

- 这个 backend 是否声明了真实支持集？
- mixed KV spec 是否要求 block-compact？
- connector preference 是否会压过 kernel 约束？
- LMCache 拿到的 layout hint 是否和 vLLM resolved layout 一致？
- 如果发生转换，是 zero-copy view，还是热路径数据重排？

把这几件事问清楚，`NHD/HND/BLHNC/BLNHC` 就不再是四个缩写，而是一张能解释性能、正确性和跨系统兼容性的地图。
