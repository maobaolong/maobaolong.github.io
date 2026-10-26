---
title: "一行代码，少搬一次：LMCache PR #6062 如何让 SGLang KV Cache 直达 Copy Engine"
description: "从零解释 KV Cache、分页内存、NHD/HND layout、LMCache multiprocess 的 kernel 与 direct-copy 两条路径，以及 PR #6062 为什么只加一行 production code 就能补齐 SGLang unified MP 的快速路径。"
publishedAt: 2026-10-26
category: AI Infra
tags:
  - lmcache
  - sglang
  - kv-cache
  - cuda
  - performance
  - multiprocess
author: 毛宝龙
readingTime: 22 min
featured: true
draft: false
---

有些性能 PR 会改几千行代码；有些 PR 的 production code 只有一行，却需要先理解半个推理系统。

[LMCache PR #6062](https://github.com/LMCache/LMCache/pull/6062) 属于后者。它真正新增的代码只有：

```cpp
case EngineKVFormat::NL_X_NB_BS_NH_HS:
```

这行代码没有创造新算法，也没有新增 CUDA kernel。它做的是：告诉 LMCache，SGLang unified multiprocess 使用的这种 KV layout，也可以绕过 GPU staging buffer 和 scatter/gather kernel，直接交给 GPU copy engine 批量搬运。

一句话先记住：**数据以前也能正确搬，现在可以少绕一次路。**

> 本文基于 PR head [`efea9f82`](https://github.com/LMCache/LMCache/tree/efea9f8258699bb4827f7bba870971fd70a7cf85)（2026-10-26）讲解。文中的 H200 数据来自 direct-copy 框架原有设计文档，不是 #6062 新提交的 SGLang 专项 benchmark。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/kv-cache-primer.svg" aria-label="打开 KV Cache 与分页基础图原图">
    <img src="/images/blog/lmcache-sglang-direct-copy/kv-cache-primer.svg" alt="从模型读过的 token 到分页 KV Cache 的入门示意图" />
  </a>
  <figcaption>图 1：KV Cache 像模型的推理记事本；分页之后，逻辑上连续的 token 可以落在不连续的物理 block 中。</figcaption>
</figure>

## 一、先从零开始：KV Cache 到底是什么

大语言模型生成下一个 token 时，需要关注前面已经读过的 token。注意力层会为每个历史 token 计算 Key 和 Value；如果每生成一个 token 都把之前的 Key/Value 重新计算一遍，序列越长，重复计算越多。

KV Cache 就是把这些结果保存下来：

```text
读过 token → 算出 K/V → 放进 KV Cache
生成下一个 token → 直接复用旧 K/V，只计算新增 token
```

可以把它理解成模型的“推理记事本”。模型不必重读整本书，只需要查看已经写好的笔记。

但这个记事本非常大。一个服务同时运行许多请求时，KV Cache 还会不断增长、释放和复用。如果每个请求都要求一整段连续显存，内存很快会碎片化。因此 vLLM、SGLang 等推理引擎通常把 KV Cache 切成固定大小的 page，也叫 block。

常见的物理形状是：

```text
[NB, BS, NH, HS]

NB = Number of Blocks，block 数量
BS = Block Size，每个 block 放多少 token
NH = Number of Heads，KV head 数量
HS = Head Size，每个 head 的宽度
```

例如 `[96, 16, 8, 128]` 表示 96 个 block，每个 block 容纳 16 个 token，每个 token 有 8 个 KV heads，每个 head 宽 128 个元素。

请求看到的是逻辑 token 0、1、2……，GPU 看到的却可能是物理 block 37、8、52……。两者靠 block table 对应：

```text
逻辑 token 0～15   → 物理 block 37
逻辑 token 16～31 → 物理 block 8
```

所以，把一个 LMCache chunk 搬回推理引擎时，不能对整个 KV pool 做一次大 memcpy；必须按 block ID，把每段数据放回正确页面。

## 二、LMCache 为什么要搬 KV Cache

LMCache 把 KV Cache 从推理引擎的本地显存扩展到 CPU 内存、磁盘或远端存储。这样，相同前缀再次出现时，可以取回以前计算过的 KV，而不是重新做完整 prefill。

在 multiprocess 模式下，可以先把问题简化为两个方向：

- **STORE / D2H**：从 engine 的 GPU paged KV Cache 取出数据，保存到 LMCache 的 pinned host object。
- **RETRIEVE / H2D**：从 LMCache object 读取数据，写回 engine 指定的 GPU blocks。

真正困难的不是 H2D 或 D2H，而是两端的内存形状不同：LMCache object 面向连续 token，engine cache 面向离散 page。LMCache 必须完成 gather 或 scatter。

## 三、旧路：staging copy 加 block-transfer kernel

最通用的做法分两步：

```text
Pinned host object
    ⇅ cudaMemcpyAsync
GPU staging buffer
    ⇅ block-transfer CUDA kernel
Engine paged KV Cache
```

以 retrieve 为例：先把连续的 LMCache object 拷进 GPU staging buffer，再启动一个 CUDA kernel，根据 block IDs 把 staging 中的 token 分散到不同 paged blocks。Store 则反过来 gather。

这条路径的优点是兼容性强。即使 engine block 内部的字节顺序和 LMCache object 的 token-major 顺序不同，kernel 也可以逐 token、逐 head 计算地址并完成重排。

代价也很明确：

- 需要 GPU 临时 buffer；
- 同一批数据经历两段搬运；
- 需要启动 CUDA kernel；
- kernel 使用 SM，可能与模型的 prefill/decode 计算竞争调度资源。

## 四、新路：直接让 copy engine 搬到每个 page

[PR #5308](https://github.com/LMCache/LMCache/pull/5308) 为 LMCache-driven transfer 增加了 direct-copy 路径。CPU 预先把每个源地址、目标地址和长度算好，再用 `cudaMemcpyBatchAsync` 一次提交多段 copy：

```text
Pinned host object
    ⇅ cudaMemcpyBatchAsync
Engine paged KV blocks
```

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/transfer-paths.svg" aria-label="打开 kernel 与 direct-copy 路径对比图原图">
    <img src="/images/blog/lmcache-sglang-direct-copy/transfer-paths.svg" alt="LMCache kernel 路径与 direct-copy 路径对比" />
  </a>
  <figcaption>图 2：direct copy 不是“更快的 kernel”，而是跳过 staging buffer 和 kernel，把多段 DMA 交给 copy engine。</figcaption>
</figure>

这里需要区分 GPU 的两类执行资源：

- **SM（Streaming Multiprocessor）** 执行 CUDA kernel，也是模型矩阵计算争用的资源。
- **Copy engine**专门负责 DMA 搬运，能和一部分计算并行。

Direct copy 的价值不是减少最终需要传输的字节，而是删掉中间落点和 scatter/gather kernel。

但它有一个硬条件：**每个 paged block 必须是一整段连续字节，而且字节顺序要和 LMCache object 的 token-major 顺序一致。** 只有这样，一条 memcpy entry 才能表达“搬这个 block”，而不需要 kernel 帮忙重排。

这也是 NHD 和 HND 很重要的原因：

```text
NHD: [Block Size, Num Heads, Head Size]
     一个 block 的所有 token 连续摆放 → 可以整块 memcpy

HND: [Num Heads, Block Size, Head Size]
     某些按 token 组织的传输会跨 head 分段 → 不能总用一段 memcpy 表达
```

Direct copy 不是配置开关。只要 build、driver 和当前 object group 都满足条件，LMCache 就自动选择它；否则安全回退到 kernel 路径。CUDA 需要 runtime/driver 支持 CUDA 12.8 的 batch memcpy；ROCm/HIP 路径还带有显式 opt-in 和 host-pointer 能力检查。

## 五、SGLang unified MP 改变了什么

SGLang 的 unified KV cache 会把不同 cache component 统一交给一套管理框架。对于普通 MHA，K 和 V 仍然是不同的物理 allocation；在 unified MP 注册时，它们被摊平成一个独立 tensor 列表。

传统 SGLang MP 表示更像：

```text
[
  [K_layer0, K_layer1, ...],
  [V_layer0, V_layer1, ...],
]
```

而 unified MP 暴露的是：

```text
[
  K_component0,
  K_component1,
  ...,
  V_component0,
  V_component1,
  ...,
]
```

每个 component 自己都是 `[NB, BS, NH, HS]`。LMCache 为它定义了 `EngineKVFormat::NL_X_NB_BS_NH_HS`，枚举值为 18。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/unified-layout.svg" aria-label="打开 SGLang unified component layout 图原图">
    <img src="/images/blog/lmcache-sglang-direct-copy/unified-layout.svg" alt="传统 SGLang K/V 分组与 unified MP 独立 component 列表的对比" />
  </a>
  <figcaption>图 3：format 18 的列表项是独立 K/V component。这里的 NL 是注册 entry 数，不必等于模型的逻辑 layer 数。</figcaption>
</figure>

这段命名很容易把初学者绕晕：

- `_` 表示同一个 tensor 内的维度；
- `_X_` 表示跨 Python list 的层级；
- `NL_X_NB_BS_NH_HS` 表示“一个列表，列表中每个 tensor 是 `[NB, BS, NH, HS]`”。

更关键的是，format 18 把每个 K 或 V component 当作一个独立 entry，因此它的 `kv_size` 是 1。K/V 不再是 tensor 内部需要额外寻址的轴。

## 六、为什么一行 `case` 就够了

Direct-copy executor 不想在每个 copy entry 上反复判断 layout。它先调用 `resolve_block_addressing()`，把 layout 一次性翻译成：

```text
address = base
        + kv × kv_stride
        + layer × layer_stride
        + block_id × block_stride
```

PR #6062 把 format 18 放进了这组已有 case：

```cpp
case EngineKVFormat::NL_X_NB_BS_HS:
case EngineKVFormat::NL_X_NBBS_ONE_HS:
case EngineKVFormat::NL_X_NB_BS_NH_TWO_HS:
case EngineKVFormat::NL_X_NB_BS_NH_CS:
case EngineKVFormat::NL_X_NB_BS_NH_HS:  // 新增
  out = {B::kPerLayer, 0, 0, blk, tight};
  return true;
```

`{B::kPerLayer, 0, 0, blk, tight}` 的含义是：

| 字段 | 值 | 解释 |
|---|---:|---|
| base | `kPerLayer` | 每个 component 直接使用自己的 base pointer |
| kv stride | `0` | tensor 内没有额外 K/V plane |
| layer stride | `0` | component 之间不用固定 stride；每个 entry 已有独立 pointer |
| block stride | `blk` | block `b` 从 `base + b × blk` 开始 |
| copy bytes | `tight` | 搬运 `BS × NH × HS × element_size` 字节 |

于是 format 18 的实际公式非常简单：

```text
block_address(component, b)
  = component_base_pointer
  + b × BS × NH × HS × element_size
```

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/one-line-unlock.svg" aria-label="打开一行 case 解锁 direct copy 图原图">
    <img src="/images/blog/lmcache-sglang-direct-copy/one-line-unlock.svg" alt="新增一个 EngineKVFormat case 如何同时打开 eligibility 和运行时地址解析" />
  </a>
  <figcaption>图 4：同一个地址解析函数既是 eligibility table，也是运行时 stride recipe，所以一个新 case 同时完成“允许进入”和“告诉 executor 怎么搬”。</figcaption>
</figure>

为什么这行以前缺失，却没有造成数据错误？因为原有 block-transfer kernel 已经在 `calculate_engine_global_offset()` 中支持 format 18。缺的是 direct-copy 地址表，不是基本传输能力。

所以前后行为是：

```text
修改前：format 18 → direct-copy 不认识 → fallback kernel → 正确但多绕一步
修改后：format 18 → 得到 BlockAddressing → batch memcpy → 正确且路径更短
```

## 七、测试为什么比 production code 长得多

表驱动代码最危险的地方，是一行看起来显然正确，但可能把错误的 layout 声明成“连续”。一旦地址公式错了，结果不是普通异常，而可能是静默写坏 KV Cache。

因此 #6062 增加了两层 GPU 测试：

1. **Native executor parity**：为 format 18 构造 `[NB, BS, NH, HS]` geometry，在 store 和 retrieve 两个方向比较 direct path 与 kernel reference，要求 bit-exact 一致；同时更新 eligibility table。
2. **Planner end-to-end parity**：使用真正的 `GPUCacheContext`，指定 `EngineType.SGLANG` 和 `kv_list_layout=unified`，先验证 detector 得到 format 18，再从公开的 `transfer_kv_per_object_group()` 入口分别走 kernel/direct 路径。

Planner 测试还覆盖 `skip_first_n_tokens`。这是 retrieve 时的重要并发保护：已经由 APC 共享、可能正在被其他请求读取的前缀 GPU blocks，不能被重复覆盖。

测试代码多于功能代码不是浪费，而是在证明这行“资格声明”满足它隐含的内存连续性合同。

## 八、性能应该怎样理解

Direct copy 并非所有场景都更快。每个 `(kv, layer, block)` 都要生成一个 batch entry，CPU 也有提交成本。原设计文档给出的 H200 经验值约为每个 entry 0.6 微秒，break-even 大约在 34 KB/entry；小到 4 KB、16 KB 的 block 反而可能不如 kernel path。

它最适合：

- block 很大；
- block 数较少；
- GPU SM 正忙于 prefill/decode；
- 一个 block 按同样的 token-major 顺序连续存放。

原 direct-copy PR 在 Kimi Linear 的 1.1 MB block 场景中，把 128k-token store 从每 rank 26.6 ms 降到 19.7 ms。这说明框架为什么值得做，但**不能直接当作 #6062 在 SGLang 上的加速结论**。#6062 当前提供的是路径与 bit-exact 正确性测试，没有附带 SGLang 专项性能数据。

## 九、把整个 PR 压缩成四句话

1. KV Cache 被分页后，LMCache 必须按 block table 做 gather/scatter。
2. 通用 kernel 路径兼容所有 layout，但多一个 staging buffer 和 CUDA kernel。
3. SGLang unified MP 的 format 18 是 token-major、block-contiguous 的 `[NB, BS, NH, HS]`，具备 direct-copy 条件。
4. `resolve_block_addressing()` 同时承担资格判断和地址 recipe；补一个 `case`，就能让已有框架自动选择更短的 copy-engine 路径。

这就是为什么一个真正只有一行 production code 的 PR，背后仍然涉及 KV Cache、分页内存、tensor layout、CUDA copy engine、multiprocess planner 和测试合同。

## 参考资料

- [LMCache PR #6062：Support direct copy in mem kernel](https://github.com/LMCache/LMCache/pull/6062)
- [Direct-copy 设计文档](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/docs/design/v1/multiprocess/lmcache_driven_transfer_copy_paths.md)
- [`resolve_block_addressing()`](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/csrc/cuda/mp_mem_kernels.cu#L697-L733)
- [SGLang KV format detector](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/lmcache/v1/gpu_connector/kv_format/detectors/sglang.py)
- [Format 18 的 Python spec](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/lmcache/v1/gpu_connector/kv_format/specs/nl_x_nb_bs_nh_hs.py)
- [Planner GPU parity tests](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/tests/v1/multiprocess/test_direct_copy_planner_gpu.py)

