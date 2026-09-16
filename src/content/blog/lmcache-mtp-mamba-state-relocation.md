---
title: "从 MTP 到 Mamba State：LMCache 为什么会把一块草稿缓存当成前缀状态"
description: "从 Prefill、Decode 和 KV Cache 开始，逐步解释 Mamba、GDN、SWA、MLA、MTP、vLLM align-mode checkpoint、speculative block relocation，以及 LMCache PR #5004 修复的状态错位问题。"
publishedAt: 2026-09-16
updatedAt: 2026-09-16
category: AI Infra
tags:
  - lmcache
  - vllm
  - kv-cache
  - mamba
  - gated-deltanet
  - speculative-decoding
  - mtp
  - hybrid-model
author: 毛宝龙
readingTime: 28 min
featured: true
draft: false
---

有些 bug 的代码改动只有十几行，背后却横跨了模型结构、推理调度、显存分页和外部缓存协议。

[LMCache PR #5004](https://github.com/LMCache/LMCache/pull/5004) 修复的就是这样一个问题：vLLM 开启 MTP 以后，会把一块用于推测执行的临时 Mamba state page 搬到 block table 尾部；LMCache 只看到了“尾部新增了这个 block”，却没有看到“旧位置已经被清空”，于是把一块没有有效边界状态的 scratch page 存进了外部缓存。下一次请求加载它以后，模型从错误的递归状态继续计算，最终输出损坏。

只看最终修复，大概只有一句话：

> 当 vLLM 新上报的非零 block ID 已经出现在请求的 block table 中时，把旧位置改成 null block，再把它追加到新位置。

但如果不知道 Mamba block 是什么、GDN 为什么也被 vLLM 叫作 Mamba、MTP 为什么需要临时状态、prefix cache 为什么会少命中一个 block，以及 scheduler 为什么因此跨过一个 block boundary，这句话几乎没法真正理解。

所以本文不从补丁开始，而是从最基础的推理过程一层一层搭起来。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/cache-family-map.svg" aria-label="打开缓存机制全景图原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/cache-family-map.svg" alt="本文涉及的缓存机制全景图" />
  </a>
  <figcaption>图 1：先区分 Attention cache 与递归状态；窄屏可横向滑动，也可以点开原图。</figcaption>
</figure>

## 一、先把 Prefill、Decode 和 KV Cache 放回原位

大语言模型按 token 自回归生成。假设用户输入：

```text
The capital of France is
```

模型先处理整段输入，再开始逐 token 生成 `Paris`。推理系统通常把它分成两个阶段。

### Prefill：读完整段输入

Prefill 一次处理很多 prompt token。Transformer 的每个 Attention 层都会为这些 token 计算 Key 和 Value。

```text
token 0 -> K0, V0
token 1 -> K1, V1
token 2 -> K2, V2
...
```

### Decode：每次向后生成一个或几个 token

生成新 token 时，Attention 需要读取历史 token 的 K/V。如果不保存它们，每生成一个 token 都要把整个 prompt 重算一遍。

因此系统把历史 K/V 留在显存中：

```text
历史 K/V + 当前 token
        -> Attention
        -> 下一个 token
```

这就是通常所说的 KV Cache。

KV Cache 的关键性质是：**它按 token 保存历史。** 上下文越长，需要保留的 K/V 通常越多。

## 二、Mamba 和 GDN 保存的不是逐 token KV

现代模型不一定每一层都是 Full Attention。一些模型会在 Attention 层之间插入 Mamba、GDN 或其他递归层。

这些层不需要保存每个历史 token 的 K/V。它们维护一个固定大小的 recurrent state：

```text
state_t = F(state_{t-1}, x_t)
```

处理到 token `t` 时，过去的历史已经被压缩进 `state_t`。继续处理 token `t+1`，只需要这个 state 和新输入。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/attention-vs-recurrent.svg" aria-label="打开 Attention KV 与递归状态对比原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/attention-vs-recurrent.svg" alt="Full Attention KV 与递归状态的根本差别" loading="lazy" />
  </a>
  <figcaption>图 2：Attention 保存可寻址的历史条目，Mamba/GDN 把历史递归压入 running state。</figcaption>
</figure>

### Mamba：Selective State Space Model

[Mamba](https://arxiv.org/abs/2312.00752) 属于 selective state-space model。它让状态转移参数依赖当前输入，从而决定什么信息应该保留、更新或者遗忘。

推理时，Mamba 层通常维护两类状态：

- convolution state：短卷积需要的最近输入状态；
- SSM state：沿序列递归更新的状态空间记忆。

这些状态的大小由模型维度决定，不随上下文 token 数量线性增长。

### GDN：Gated DeltaNet

[Gated DeltaNet](https://arxiv.org/abs/2412.06464) 属于递归线性注意力。它维护一个类似关联记忆的矩阵状态：query 从中读取信息，delta rule 修正已有的 key-value 关联，gate 控制旧信息如何衰减。

可以把它粗略理解成：

```text
先按 gate 遗忘一部分旧状态
        ↓
用 delta rule 修正当前 key 对应的记忆
        ↓
query 从更新后的矩阵状态中读取结果
```

GDN 和 Mamba 的数学机制不同：

| 机制 | 模型视角 | 保存的状态 |
|---|---|---|
| Mamba | Selective SSM | SSM state + convolution state |
| GDN | Gated delta-rule linear attention | 递归矩阵状态 |

但从推理系统的视角，它们有相同的生命周期特征：

- 都需要把前一步 state 传给下一步；
- 都可以在某个 token boundary 保存 checkpoint；
- 都需要在抢占、恢复和外部缓存时搬运 state；
- speculative decoding 时都要避免把未接受候选的 state 提交成正式状态。

因此 vLLM 把这类递归层统一放进 `MambaSpec` / `MambaManager` 的运行时抽象。也就是说，代码和日志里的 “Mamba state” 有时是一个工程统称；在 PR #5004 对应的 Qwen GDN hybrid 模型里，它实际承载的是 GDN recurrent state。

### SWA 和 MLA 不属于 Mamba/GDN

SWA 是 Sliding Window Attention。它仍然保存逐 token K/V，只让当前 query 关注最近 `W` 个 token：

```text
query_t attends to [t-W+1, ..., t]
```

MLA 是 Multi-head Latent Attention。它把 K/V 表示压缩到 latent vector，但仍属于 Attention 家族。

所以它们的边界是：

```text
Mamba / GDN：历史被压进固定大小 recurrent state
SWA / MLA：仍保存可寻址的 token 或压缩 token 条目
```

例如 DeepSeek-V4 同时使用 compressed MLA 与近期 SWA 分支。vLLM 的 `DeepseekV4SWACache` 返回 [`SlidingWindowMLASpec`](https://github.com/vllm-project/vllm/blob/ab35354c21cc3c36439e79e18070f85cfafc3af2/vllm/v1/attention/backends/mla/sparse_swa.py#L72-L130)，而不是 `MambaSpec`。它也属于 hybrid cache，但 hybrid 的组成是多类 Attention cache，不是 Attention 加递归状态。

## 三、Mamba block 不是“一段 token KV”

vLLM 使用 paged allocator 管理 GPU cache。为了让 Attention KV 和递归状态都进入统一的分配、回收和 block table 体系，它也把 Mamba/GDN state 装进物理 page，并称为 Mamba block。

这里必须区分两个概念：

- 物理 block/page：GPU 内存中真正保存状态的一块空间，有具体 block ID；
- 逻辑 slot：序列位置上的 checkpoint 槽位，表示“处理到哪个 token boundary 后的状态”。

假设 Mamba block size 是 `B`，`align` 模式维护的语义是：

```text
slot 0 = 处理完前 B 个 token 后的 state
slot 1 = 处理完前 2B 个 token 后的 state
slot 2 = 处理完前 3B 个 token 后的 state
```

也就是：

```text
slot p = state after (p + 1) * B tokens
```

[`MambaSpec`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/kv_cache_interface.py#L668-L708) 里有一个容易忽略的设计：align 模式的逻辑 block table 要覆盖整段序列，但实际同时驻留的 state page 只需要 `2 + num_speculative_blocks` 左右。已经不再需要的逻辑 slot 会被替换成 null block。

因此下面这张表是正常的：

```text
逻辑 slot：  0    1    2    3    4
block ID：  10    0    0   17   21
```

`0` 不是一块包含全零有效状态的普通数据，而是“这里没有可用 state”的 null block。

## 四、为什么 checkpoint 必须恰好写在 block boundary

继续假设 `B = 1616`。一个长度为 4538 的 prompt 有两个完整 boundary 和一个尾巴：

```text
0              1616              3232          4538
|----------------|-----------------|--------------|
```

如果希望 slot 1 真正表示 `state_3232`，必须有一个计算 step **恰好结束在 3232**。

原因很直接：递归 kernel 从初始 state 一路处理输入，通常留下这个 step 结束位置的 state。如果一个 step 从 1616 一口气运行到 4538，最终得到的是 `state_4538`；中途经过 3232，不等于系统自动把 `state_3232` 另存了一份。

所以没有 MTP 时，vLLM 的 align-mode scheduler 会把 Prefill 切成：

```text
step 1: [0, 1616)       -> materialize state_1616
step 2: [1616, 3232)    -> materialize state_3232
step 3: [3232, 4538)    -> running tail state
```

这就是 [`_mamba_block_aligned_split`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/core/sched/scheduler.py#L366-L441) 的核心任务：为了让以后可以从 boundary 恢复，Prefill step 要在可缓存边界准确停下。

## 五、MTP 到底在做什么

MTP 是 Multi-Token Prediction。它的目标不是改变最终由主模型定义的输出，而是减少昂贵主模型 forward 的次数。

普通自回归生成一次只推进一个 token：

```text
主模型 forward -> D
主模型 forward -> E
主模型 forward -> F
```

开启 MTP 后，轻量的 MTP modules 先快速提出多个候选：

```text
draft: D E F G
```

主模型把这些候选放在一个批量 forward 中验证。假设主模型给出的连续结果是：

```text
verify: D E X ...
```

系统接受第一个分歧之前的 `D E`，在分歧位置采用主模型的 `X`。一次主模型 forward 就推进了多个 token。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/mtp-draft-verify.svg" aria-label="打开 MTP draft verify commit 流程原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/mtp-draft-verify.svg" alt="MTP 的 draft、verify 与 commit" loading="lazy" />
  </a>
  <figcaption>图 3：MTP 先草拟多个 token，再由主模型批量验证并提交有效前缀。</figcaption>
</figure>

### MTP 为什么需要主模型 hidden state

MTP modules 不是一个只看 token ID 的独立小模型。vLLM 把 `mtp`、EAGLE 等方法归入“使用 target model hidden states 的 speculative decoding”。[`SpeculativeConfig.use_eagle()`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/config/speculative.py#L1477-L1482) 的注释也明确说明了这一点。

普通 Attention prefix cache 保存的是 K/V，不一定保存 generation point 所需的完整 hidden state。于是出现了一个重要区别：

```text
普通生成：命中 KV 后，可以直接继续 Attention
MTP drafting：除了 KV，还需要边界附近的 target hidden state 和 draft-layer state
```

## 六、“丢掉最后一个命中块”不是删除，而是重算

假设 prefix cache 根据 token hash 确认前 3232 个 token 都命中：

```text
0                 1616                 3232
| cached block 0   | cached block 1     |
```

普通生成可以把 `num_computed_tokens` 直接推进到 3232。

但 EAGLE/MTP 需要 generation point 附近的 hidden state。对于 multi-module MTP，尾部 draft-layer KV 还可能依赖 matched prefix 之后最多 `num_speculative_tokens - 1` 个 token；这些 continuation token 不在当前 block hash 的证明范围内。另一条请求即使共享相同 prefix，后续 continuation 也可能不同。

因此 vLLM 的做法是：**命中结果少算最后一个 block，让主模型在当前请求上重算它。**

```text
缓存实际拥有：[0, 3232)
对 scheduler 报告：[0, 1616) 命中
必须重新计算：[1616, 3232)
```

重算会重新产生当前请求需要的：

- Attention K/V；
- generation point 附近的 target hidden state；
- MTP draft modules 对应的 cache/state。

这就是 vLLM 注释里 “drop the last matched block to force recompute” 的准确含义。它不一定从 GPU 中物理删除那块数据，只是不能把那一块计入可直接跳过的 computed prefix。[vLLM 的命中约束](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/core/single_type_kv_cache_manager.py#L544-L568)

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/mtp-prefix-recompute.svg" aria-label="打开 MTP prefix cache 重算流程原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/mtp-prefix-recompute.svg" alt="MTP 命中为什么要回退一个 block" loading="lazy" />
  </a>
  <figcaption>图 4：“丢掉最后一个命中块”是缩短可跳过前缀，并不等于物理删除缓存。</figcaption>
</figure>

## 七、为什么 1616 已经不再是“下一次停止点”

现在把 prefix-hit 约束带回一个全新 prompt 的 Prefill。

没有 MTP 时，长度 4538 的 prompt 最后一个完整可缓存 boundary 是 3232：

```text
last_cache_position = floor(4538 / 1616) * 1616
                    = 3232
```

scheduler 从 1616 开始第二步时，3232 位于当前 step 的前方，所以它会在那里停下：

```text
start = 1616
stop  = 3232
end   = 4538

start < stop < end
```

开启 MTP 后，未来即使命中到 3232，也必须回退一块并从 1616 重算。因此 vLLM 把最后一个值得 materialize 的 Mamba cache position 也退一块：

```text
last_cache_position = 3232 - 1616
                    = 1616
```

第二步开始时已经站在 1616：

```text
start = 1616
stop  = 1616
end   = 4538
```

一个 scheduler stop 必须严格位于当前 step 内部，也就是 `start < stop < end`。现在 `stop == start`，它当然不是“接下来还要停一次”的位置。

于是 Prefill 从三步变成两步：

```text
MTP off:
[0, 1616) [1616, 3232) [3232, 4538)

MTP on:
[0, 1616) [1616,             4538)
```

这不是 MTP 数学上要求必须跨过 3232，而是一个调度选择：既然未来 MTP prefix resume 也不会直接使用 `state_3232`，vLLM 就不为了保存它额外拆一次 Prefill forward。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/mamba-checkpoint-timeline.svg" aria-label="打开 MTP 改变 Prefill checkpoint 原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/mamba-checkpoint-timeline.svg" alt="MTP 开关如何改变 Prefill checkpoint" loading="lazy" />
  </a>
  <figcaption>图 5：第二步已经从 1616 开始时，1616 不能再成为位于 step 内部的未来停止点。</figcaption>
</figure>

## 八、speculative block 为什么会存在

MTP 一次验证多个候选 token。对 Mamba/GDN 递归层来说，每吃进去一个候选 token，state 都会变化：

```text
state_C -> state_D -> state_E -> state_F -> state_G
```

但 verify 完成前，系统不知道最后会接受几个候选。

如果只有 `D E` 被接受，正式状态应该提交为 `state_E`；如果 `F` 也被接受，则应提交 `state_F`。系统不能在结果未知时直接用最深候选的 state 覆盖已提交状态，否则拒绝候选时无法回滚。

所以 vLLM 会为 speculative execution 准备额外的 scratch state pages。它们只是候选路径上的临时空间，不一定对应任何可复用的 prefix boundary。

在 align 模式下，vLLM 不按每个 lookahead token 扩张正常 block grid，而是维护：

- 一个当前 running state block；
- 若干 speculative scratch blocks；
- 必要时一个用于下一步状态交接的新 block。

相关分配逻辑位于 [`MambaManager.allocate_new_blocks`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/core/single_type_kv_cache_manager.py#L1547-L1667)。

## 九、为什么 speculative block 会从中间搬到尾部

继续看 `B = 1616`、MTP 开启的例子。

第一步以后，vLLM 已经为 running state 和 speculative execution 准备了一些物理 page。假设其中一块 scratch page 的 ID 是 `S1`，它暂时出现在逻辑 slot 1。

第二步从 1616 直接运行到 4538，跨过了 3232。由于没有任何 step 结束在 3232，slot 1 不可能拥有合法的 `state_3232`，它必须是 null。

但物理 page `S1` 仍然可以复用。于是 vLLM 做两件事：

```text
1. 把 slot 1 改成 null block 0
2. 把物理 block S1 移到 block table 尾部继续作为 scratch page
```

例如：

```text
搬动前：[A, S1, S2, S3, S4, C]
搬动后：[A,  0, S2, S3, S4, C, S1, D]
```

这里没有复制 `S1`。同一个物理 block ID 从旧逻辑位置离开，然后出现在新的尾部位置。旧 slot 用 null block 表示“这个 boundary 没有 state”。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/speculative-block-relocation.svg" aria-label="打开 speculative state page 搬动过程原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/speculative-block-relocation.svg" alt="vLLM 搬动 speculative state page 的过程" loading="lazy" />
  </a>
  <figcaption>图 6：物理 page S1 从旧逻辑 slot 搬到尾部，旧位置必须同步变成 null block。</figcaption>
</figure>

## 十、LMCache 为什么只看到了搬动的一半

LMCache MP connector 在 scheduler 侧维护自己的 request tracker。tracker 需要知道每个 engine group 的 block table，才能把“某段 token 应该从哪些 GPU block 搬出来”描述给 LMCache server。

问题在于 connector 接收到的是 block allocation delta：它能看到这个 step 在尾部追加了哪些 block，却不会收到 vLLM 对旧 slot 做的原地替换。

在上面的例子中，vLLM 的真实变化是：

```text
旧位置：S1 -> 0
尾部追加：[S1, D]
```

但 connector 只收到：

```text
new_block_ids = [S1, D]
```

旧版 tracker 只是简单执行：

```python
block_ids.extend(group_block_ids)
```

于是两边开始分叉：

```text
vLLM：   [A, 0,  ..., S1, D]
LMCache：[A, S1, ..., S1, D]
```

vLLM 保证同一个非零物理 block 不会同时占据同一请求的两个 slot。LMCache tracker 里出现两个 `S1`，因此不是合法的“两个位置共享一个状态”，而是旧位置漏掉了一次置零。

## 十一、错误状态是怎样进入外部缓存的

LMCache 按 token chunk 建立内容 key，并为不同 object group 保存对应状态。对于 hybrid 模型，Attention KV 与 Mamba/GDN state 可以作为不同 object groups 处理。

当 LMCache 准备存储 `[1616, 3232)` 这个 chunk 时：

```text
Attention group：有真实 KV
Mamba/GDN group：本应是 null，因为 state_3232 从未产生
```

但 tracker 的旧 slot 还写着 `S1`。于是 server 把 `S1` page 中的内容当作 `state_3232` 保存。

这块 page 是 speculative scratch space。没有任何 Prefill kernel 承诺它保存的是 `state_3232`；内容可能属于候选路径、其他时刻，甚至只是尚未初始化成当前 boundary 的旧数据。

下一次相同 prefix 命中 LMCache 时，错误链条反向发生：

```text
LMCache 命中 chunk key
  -> 把 S1 中保存的内容加载到 slot 1
  -> 模型把它当成 state_3232
  -> 从错误递归状态继续处理后续 token
  -> 后续输出确定性损坏
```

注意：错误最后表现在 Decode 文本上，但错误数据是在 Prefill checkpoint 的 store/retrieve 路径中产生的。它不是一个仅在稳态 Decode 或仅在抢占恢复时才存在的问题。

## 十二、修复：从“重复 ID”推导出“旧位置已清空”

PR #5004 修改了 `append_block_ids`。新逻辑可以概括为：

```python
for block_id in group_block_ids:
    if block_id != 0 and block_id in block_ids:
        block_ids[block_ids.index(block_id)] = 0
    block_ids.append(block_id)
```

以测试中的数字为例：

```text
tracker 原来： [10, 11, 12, 13, 14, 15]
vLLM 新上报：  [12, 16]
```

处理 `12` 时，tracker 发现它已经出现在旧 slot。根据 vLLM 的唯一性约束，这意味着 block 12 已经从旧位置搬走：

```text
[10, 11, 12, 13, 14, 15]
         ↓
[10, 11,  0, 13, 14, 15]
```

然后再追加新位置：

```text
[10, 11, 0, 13, 14, 15, 12, 16]
```

这就重新与 vLLM 的真实 block table 对齐。

### 为什么 `block_id != 0`

null block `0` 天生可以重复：

```text
[0, 0, 20, 21, 0, 25]
```

多个 null slot 不表示同一块有效状态被搬了多次。因此只有“重复的非零 block ID”才能作为 relocation/reallocation 的信号。

## 十三、为什么修复以后宁可少命中一个 chunk

tracker 把旧位置恢复成 `0` 后，LMCache server 会看到这个 Mamba object group 在对应 chunk 中全部是 null block。

[`all_null_chunk_masks`](https://github.com/LMCache/LMCache/blob/078cf22e5c23d271fccbca5f8cc6ec7f564c7889/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L136-L148) 会标记这种 chunk。LMCache 不会为它提交一个伪造的 recurrent-state object。

于是同一个 token chunk 可能出现：

```text
Attention object：存在
Mamba/GDN object：不存在
```

Hybrid prefix resume 要求各个必要 group 在同一个恢复点上都拥有有效状态。Mamba/GDN object 缺失时，最终共同命中长度必须回退到更早的 checkpoint。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/lmcache-corruption-and-fix.svg" aria-label="打开 LMCache 错误链与修复流程原图">
    <img src="/images/blog/lmcache-mtp-mamba-state/lmcache-corruption-and-fix.svg" alt="错误链与修复后的安全回退" loading="lazy" />
  </a>
  <figcaption>图 7：旧逻辑会持久化 scratch state；修复后缺失的递归状态会让共同命中点安全回退。</figcaption>
</figure>

这里体现的是一个很重要的缓存原则：

> 缓存命中不是“字节找到了”就算成功，而是这些字节必须对应 key 所声明的准确模型状态。

少命中一个 chunk 只会多做一些计算；把 speculative scratch state 当成合法 checkpoint，则会让模型从错误状态继续执行。正确性必须优先于命中长度。

## 十四、这个问题在哪些场景里成立

这条错误链需要多个条件同时出现：

```text
Hybrid model，包含 Mamba/GDN 类递归层
  + vLLM mamba_cache_mode=align
  + MTP/EAGLE 类 speculative decoding
  + scheduler 跨过一个本应对应逻辑 slot 的 boundary
  + speculative physical block 被搬到尾部
  + LMCache MP connector 只接收 append delta
  + 外部缓存尝试保存或恢复这段状态
```

在对应的 LMCache MP 配置里，还需要启用 `--separate-object-groups`，并让 LMCache chunk size 与 Mamba block size 对齐。这样 Attention KV 与 Mamba/GDN state 才会以独立 object group、相同 token chunk 边界进入 store/retrieve 流程。

它的核心触发阶段是 **chunked Prefill**，不是稳态 Decode。

不同阶段与它的关系如下：

| 阶段 | 关系 |
|---|---|
| 普通 chunked Prefill | 产生被跳过的 Mamba boundary，是直接触发点 |
| LMCache store | 旧 tracker 会把 scratch page 错存成 checkpoint |
| LMCache retrieve | 错误 checkpoint 被重新装回 GPU |
| Decode | 从错误 state 继续生成，因此最容易在输出中观察到损坏 |
| 抢占恢复 | 也依赖 checkpoint，但不是问题发生的必要条件 |

如果模型只有 Full Attention 或 DeepSeek-V4 那样的 MLA/SWA cache，没有 `MambaSpec` 递归状态，这条具体的 Mamba align-mode 因果链就不成立。它们可能有自己的 block 回收和 speculative-cache 约束，但不能因为都叫 hybrid cache 就直接套用这里的结论。

## 十五、最后把整条链压缩成九步

读到这里，可以把整个问题压缩成下面九步：

1. Mamba/GDN 用固定大小 recurrent state 表示历史，而不是逐 token KV。
2. vLLM 用 Mamba block/page 保存这些状态，并让逻辑 slot 对应确定的 token boundary。
3. 一个 boundary state 只有在某次计算 step 恰好结束于该位置时才有效。
4. MTP 需要 generation point 附近的 target hidden state 和 draft-layer state。
5. prefix cache 命中时，vLLM 会少算最后一个 matched block，让当前请求重算它。
6. scheduler 因而不再为了未来不可直接复用的 boundary 额外拆分 Prefill。
7. 被跨过的 slot 应当是 null，原先占位的 speculative block 被搬到尾部复用。
8. LMCache 只收到尾部 append delta，旧 tracker 因而错误地保留了旧 block ID。
9. 修复通过重复非零 ID 推导 relocation，把旧 slot 清零，从而阻止无效 scratch state 进入外部缓存。

最终那几行代码看起来是在维护一个 Python list，实际上维护的是一个更严肃的语义：

> 某个 token boundary 是否真的存在一份可以恢复、可以共享、可以由内容 key 命名的模型状态。

一旦这个语义错一格，后面的显存搬运、外部缓存和命中统计即使全部执行成功，搬运的也只是“格式正确的错误状态”。这正是 hybrid model cache 最难的地方：系统不只要知道一块内存在哪里，还要知道它究竟代表模型运行到了哪里。
