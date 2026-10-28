---
title: "当一个 vLLM Block 不再等于一个 KV Page：LMCache PR #6019 详解"
description: "从 KV cache、block table 和 kernel page 的零基础概念讲起，解释 LMCache 为什么会把 kernel paging 误判成压缩、缓存命中为何可能静默恢复错误 KV，以及 PR #6019 如何用 num_blocks、k 检测和 block-to-page 展开修复全部 MP 传输路径。"
publishedAt: 2026-10-29
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - kv-cache
  - multiprocess
  - flashinfer
  - correctness
author: "毛宝龙"
readingTime: "24 min"
featured: true
draft: false
---

大多数 KV cache 代码都默认一件看起来很自然的事：vLLM 给出一个 block ID，KV tensor 的第一维就能用同一个数字索引。

这个假设在很多 backend 上确实成立。但如果 attention kernel 使用的 page 比 vLLM 配置的 block 更小，它就会突然失效：**一个 engine block ID 背后其实有多个连续 tensor page**。LMCache 若仍把 block ID 直接当 page ID，程序不会越界，也不一定报错，却会搬错 KV。第二次请求看似命中了缓存，模型读到的却可能是错位的历史上下文。

这就是 [LMCache PR #6019](https://github.com/LMCache/LMCache/pull/6019) 解决的问题。本文基于 2026-10-29 的 PR head `e2b0bf4d`。重点不是逐行复述 diff，而是把背景、坐标系、误判原因、修复边界和兼容策略完整串起来。

<div class="kp-callout"><strong>一句话结论：</strong>调度与 chunk 控制仍然使用 engine block ID；真正读写 tensor 时，先把每个 block ID 展开成它覆盖的全部 kernel page ID。</div>

## 一、从零开始：KV cache 为什么需要 block

大模型生成文字时，每个新 token 都要回看此前 token 的 Key 和 Value。把历史 K/V 每次重新计算一遍很浪费，所以推理引擎把它们保存在显存里，这就是 KV cache。

请求长度不同、结束时间也不同。如果给每个请求预留一整段连续显存，会有大量浪费。vLLM 因此把 KV cache pool 切成固定大小的块，用 block table 把请求的逻辑 token 映射到物理块：

```text
tokens 0..127    -> engine block 3
tokens 128..255  -> engine block 7
```

这里的 `3` 和 `7` 不是 token 编号，而是 KV pool 中的物理 block ID。LMCache 接到 STORE / RETRIEVE 时，也会收到这样的 ID 列表。

为了避免术语互相覆盖，先固定本文的四个词：

<dl class="kp-glossary">
  <div><dt>token</dt><dd>模型输入或生成序列中的一个逻辑位置。</dd></div>
  <div><dt>engine block</dt><dd>vLLM 调度器和 block table 使用的分配单位，由一个 block ID 标识。</dd></div>
  <div><dt>kernel page</dt><dd>attention backend 真正用于寻址 KV tensor 的物理 page；它可能比 engine block 小。</dd></div>
  <div><dt>slot</dt><dd>KV tensor 里能放一个 token 状态的位置。一个 page 有多少 slot，由物理布局决定。</dd></div>
</dl>

在最简单的情况里，四者很整齐：一个 engine block 覆盖 128 token，一个 tensor page 也有 128 slot，于是 `block ID == page ID`。

## 二、问题出现在哪里：backend 可以选择更小的 page

`--block-size 128` 表达的是 vLLM 调度侧一个 block 覆盖 128 个 token，却不保证每个 attention kernel 都用 128-token page。backend 可能只支持更小的 kernel block size。

PR 的 A10 复现中，FlashInfer 的 page 上限是 64 token。于是：

```text
tokens_per_block  = 128
slots_per_page    = 64
k                 = 128 / 64 = 2 pages per engine block
```

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-kernel-paging/two-coordinate-systems.svg" aria-label="打开 block 与 page 两套坐标图原图">
    <img src="/images/blog/lmcache-kernel-paging/two-coordinate-systems.svg" alt="一个 128-token engine block 映射到两个 64-slot kernel page" />
  </a>
  <figcaption>图 1：调度器看见 engine block，transfer kernel 看见 tensor page。两套编号只有在 k = 1 时相同。</figcaption>
</figure>

一般化以后，engine block `b` 的 page 范围是：

<div class="kp-equation">pages(b) = [b × k, b × k + 1, …, b × k + k − 1]</div>

因此 `[3, 7]` 在 `k = 2` 时必须变成 `[6, 7, 14, 15]`，而不是继续使用 `[3, 7]`。

<figure class="kp-animation" data-kp-animation="mapping" data-step="0">
  <div class="kp-animation__head"><h3>动态图 1：同一组 block ID，错误和正确寻址差在哪里</h3><span class="kp-step-label" data-kp-label>1 / 4</span></div>
  <p class="kp-animation__copy" data-kp-copy></p>
  <div class="kp-stage">
    <p class="kp-lane-label">engine block ids</p>
    <div class="kp-block-row"><div class="kp-block" data-engine-block>block 3</div><div class="kp-block" data-engine-block>block 7</div></div>
    <div class="kp-map-arrow"></div>
    <p class="kp-lane-label">tensor page ids</p>
    <div class="kp-page-row"><div class="kp-page" data-page="2">page 2</div><div class="kp-page" data-page="3">page 3</div><div class="kp-page" data-page="6">page 6</div><div class="kp-page" data-page="7">page 7</div><div class="kp-page" data-page="8">page 8</div><div class="kp-page" data-page="13">page 13</div><div class="kp-page" data-page="14">page 14</div><div class="kp-page" data-page="15">page 15</div></div>
    <div class="kp-result" data-kp-result data-step0="<strong>输入：</strong>[3, 7]，此时还只是调度坐标。" data-step1="<strong>旧路径：</strong>直接索引 page 3 和 page 7，只搬了错误位置的两页。" data-step2="<strong>新路径：</strong>按 k = 2 展开为 [6, 7, 14, 15]。" data-step3="<strong>结果：</strong>两个 engine block 背后的四个 page 被完整 gather / scatter。"></div>
  </div>
  <ol class="kp-steps"><li>vLLM 发送 block IDs [3, 7]。它描述的是两个 128-token engine block，不是 tensor 第一维的两个 page。</li><li>旧路径把 3 和 7 直接当 page ID，只取两页；编号合法，所以错误可以静默发生。</li><li>PR #6019 识别 k = 2，把每个 block 展开成连续 page：[3, 7] → [6, 7, 14, 15]。</li><li>transfer kernel 最终收到 page 坐标，完整移动两个 engine block 对应的四页 KV。</li></ol>
  <div class="kp-animation__controls"><button class="kp-control" type="button" data-kp-prev aria-label="上一步">‹</button><button class="kp-control" type="button" data-kp-play aria-label="播放或暂停">▶</button><button class="kp-control" type="button" data-kp-next aria-label="下一步">›</button><div class="kp-dots" data-kp-dots></div></div>
  <figcaption>这个动画刻意显示了“错误 ID 仍合法”的危险：问题不是 crash，而是 silent corruption。</figcaption>
</figure>

## 三、为什么旧代码会把它误认为压缩

LMCache 早就要处理另一种情况：**slot compression**。例如一个 engine block 逻辑上覆盖 128 token，但 tensor 只给它 64 个 slot。这时 `tokens_per_block > slots_per_block`，确实意味着一个压缩比例。

kernel paging 表面上也满足类似关系：一个 page 只有 64 slot，而 engine block 有 128 token。区别是缺少的 64 slot 没被压缩掉，而是在紧邻的第二个 page 里。

只看单页 shape 时，两者会混在一起：

```text
slot compression:  N engine blocks -> N tensor pages, each page has fewer slots
kernel paging:     N engine blocks -> N × k tensor pages, k pages tile one block
```

旧的 LMCache 逻辑主要从 `tokens_per_block` 和单页 `slots_per_block` 推断压缩。它不知道 vLLM 总共分配了多少 block，因此也无法用 tensor 的 page 总数验证“是不是每个 block 恰好有 k 页”。

后果分三条路径：

- lmcache-driven（CUDA 默认路径）把额外 page 当成压缩后的 slot，每个 chunk 只搬 `1/k`，并用 block ID 错索引 page；
- engine-driven 单 group 路径有同样的静默错误；
- engine-driven multi-group 路径会在启动时把 group 判断为 compressed 并拒绝。

最危险的是前两种：请求仍能返回文本，但缓存命中结果和冷请求不一致。

## 四、修复的观察量：把 `num_blocks` 带到注册协议

要区分两种情况，LMCache 需要同时知道：

1. tensor 第一维有多少物理 page；
2. engine 分配了多少 block ID；
3. 每个 page 有多少 slot；
4. 每个 engine block 覆盖多少 token。

PR 给 `EngineGroupInfo` 新增 `num_blocks`。vLLM 从 `KVCacheConfig.num_blocks` 填入这个值；connector 私有的 auxiliary pool 没有这层含义，继续报告 `0`。

在 protobuf 里它是新的 field 7，在 msgspec 结构里有默认值 `0`。因此旧发送方没提供该字段时，接收方仍能解码，`0` 的语义就是“未报告”。

检测规则可以写成：

<div class="kp-equation">if engine_num_blocks &gt; 0
and tensor_pages % engine_num_blocks == 0:
    k = tensor_pages / engine_num_blocks
    kernel_paged = (k &gt; 1 and slots_per_page × k == tokens_per_block)
else:
    k = 1  # compatibility fallback</div>

这个规则比“看到 slots 少就猜”强，因为它要求**数量关系和容量关系同时闭合**。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-kernel-paging/detection-and-transfer.svg" aria-label="打开检测与传输边界图原图">
    <img src="/images/blog/lmcache-kernel-paging/detection-and-transfer.svg" alt="注册阶段检测 k，控制逻辑按 block 计数，数据移动按 page 寻址" />
  </a>
  <figcaption>图 2：PR 没有把整个系统都改成 page 坐标，而是在最合适的边界做一次转换。</figcaption>
</figure>

## 五、真正关键的设计：不要过早展开

修复不是把所有 block 数乘以 `k`。有些逻辑讨论的是“请求有几个 engine block”，有些逻辑讨论的是“tensor 要访问几个 page”。两者必须留在各自坐标系。

仍按 block ID 计数的部分包括：

- 一个 LMCache chunk 包含多少 engine block；
- block ID 列表是否不足；
- 哪些 chunk 全是 null block；
- retrieve window 覆盖多少 chunk；
- multi-group 中各 group 的 chunk 对齐。

只有真正进入 gather / scatter、也就是 tensor 第一维被索引时，才调用 `expand_block_ids_to_pages`。

```python
def expand_block_ids_to_pages(block_ids, pages_per_block):
    if pages_per_block == 1:
        return block_ids
    return [
        block_id * pages_per_block + offset
        for block_id in block_ids
        for offset in range(pages_per_block)
    ]
```

这条边界有两个好处。第一，`k = 1` 的普通 backend 完全保持旧行为；第二，null chunk、窗口和多 group 同步仍使用调度器原本的语义，不会因为物理 page 变多而虚构出更多逻辑 chunk。

## 六、为什么要同时修改多条 transfer 路径

LMCache MP 不是只有一个复制入口。PR 覆盖了：

- lmcache-driven 的 store 与 retrieve；
- engine-driven 的同步 store、异步 store 与 retrieve；
- single-group 和 multi-group；
- inline 与 SHM 数据路径。

其中 single-group 特别容易漏掉：它为了减少开销，会绕过 `KVLayerGroupsManager` 的多 group 建模。因此 PR 需要在 single-group 注册分支单独检测 `k`，把 chunk 中的 page 数注册正确，并在同步、异步、读取三个入口都展开 ID。

<figure class="kp-animation" data-kp-animation="paths" data-step="0">
  <div class="kp-animation__head"><h3>动态图 2：修复如何穿过整条传输链</h3><span class="kp-step-label" data-kp-label>1 / 4</span></div>
  <p class="kp-animation__copy" data-kp-copy></p>
  <div class="kp-stage">
    <div class="kp-paths"><div class="kp-path" data-path-step="0"><b>1 · Register</b><span>EngineGroupInfo.num_blocks → detect k</span></div><div class="kp-path" data-path-step="1"><b>2 · Chunk control</b><span>count engine block IDs</span></div><div class="kp-path" data-path-step="2"><b>3 · Expand</b><span>[3, 7] → [6, 7, 14, 15]</span></div><div class="kp-path" data-path-step="3"><b>4 · Copy</b><span>gather / scatter tensor pages</span></div></div>
    <div style="margin-top:1.4rem"><p class="kp-lane-label">physical pages moved</p><div class="kp-page-row"><div class="kp-page" data-page="6">6</div><div class="kp-page" data-page="7">7</div><div class="kp-page" data-page="14">14</div><div class="kp-page" data-page="15">15</div></div></div>
  </div>
  <ol class="kp-steps"><li>注册时同时观察 tensor page 数和 engine block 数，得到 kernel_pages_per_block = k。</li><li>chunk、null mask 和 window 仍按原始 engine block ID 工作，保留调度语义。</li><li>到 gather / scatter 边界才把 block IDs 展开成连续 page IDs。</li><li>lmcache-driven、engine-driven、single-group、multi-group、sync、async、SHM 和 inline 最终都移动完整 page 集合。</li></ol>
  <div class="kp-animation__controls"><button class="kp-control" type="button" data-kp-prev aria-label="上一步">‹</button><button class="kp-control" type="button" data-kp-play aria-label="播放或暂停">▶</button><button class="kp-control" type="button" data-kp-next aria-label="下一步">›</button><div class="kp-dots" data-kp-dots></div></div>
  <figcaption>展开动作靠近数据移动边界，而不是扩散到所有调度逻辑里。</figcaption>
</figure>

## 七、三个容易看错的细节

### 1. `slots_per_block` 和 `slots_per_engine_block` 不再是同一个数

PR 把单个物理 page 的 slot 数保留为 `shape_desc.bs` / `slots_per_block`，再新增语义：

```text
slots_per_engine_block = slots_per_page × kernel_pages_per_block
```

压缩比例必须用后者计算。否则 64-slot page × 2 明明完整覆盖 128 token，却仍会被算成 2:1 压缩。

### 2. `calculate_num_blocks` 现在数的是 tensor page

函数名里的 block 容易让人误会。对 kernel-paged group，它返回的是 transfer kernel 要处理的 page 数。需要回到 engine block 数时，再除以 `kernel_pages_per_block`。

### 3. connector-side re-view 不是通用答案

某些已知 layout 可以在 connector 侧把多 page zero-copy re-view 成一个逻辑 block，但这个 edit 只对它认识的格式安全。PR 选择在 LMCache 的 page 计数层处理，因此 format detector 支持的布局都能共享规则，不必为每个 backend 猜一套 shape 重写。

## 八、验证告诉了我们什么

PR 描述给出了 A10、vLLM 0.32.0、`--block-size 128`、LMCache chunk 256 的端到端结果。

| 模型 / backend | 路径 | `dev` 表现 | PR 表现 |
|---|---|---|---|
| Qwen3-8B / FlashInfer | lmcache-driven | 命中后文本变化，无错误 | 与冷请求一致 |
| Qwen3-8B / FlashInfer | engine-driven | inline 命中后文本变化 | inline、SHM 均一致 |
| Olmo-3-7B-Think / FlashInfer | lmcache-driven | 输出退化为重复垃圾文本 | 与冷请求一致 |
| Olmo-3-7B-Think / FlashInfer | engine-driven multi-group | 启动拒绝 compressed group | inline、SHM 均一致 |

FlashAttention 的 `k = 1` 对照组保持原行为。测试还覆盖检测 fallback、page 展开、null chunk 仍按 block 计数、store→retrieve round trip，以及 single/multi-group 的同步和异步入口。

这里最值得记住的不是某个模型名称，而是验证标准：**缓存命中不仅要成功返回，还必须与同一请求的冷结果一致。** silent corruption 的系统不能只检查“有没有 exception”。

## 九、兼容边界与剩余限制

这个修复有意保留了几个边界：

- `num_blocks = 0` 表示 engine 未报告，检测回退到 `k = 1`；兼容旧协议，但也意味着无法凭空识别 kernel paging；
- 检测只在 page 数是 engine block 数的整数倍，且 `slots_per_page × k == tokens_per_block` 时成立；不满足就不冒险猜；
- auxiliary pool 不冒充 vLLM 的 block-id pool，因此不填 `num_blocks`；
- `k = 1` 返回原 block ID 列表，普通 backend 不增加额外映射语义；
- 这解决的是 block/page 坐标错配，不是任意 layout、量化编码或 recurrent state 的自动推断。

## 总结

PR #6019 的本质不是“多搬几页”，而是把一个长期被重合数字掩盖的抽象边界说清楚：

```text
engine block ID 负责调度语义
kernel page ID 负责 tensor 寻址
```

当两者一一对应时，直接复用编号很方便；当 `k > 1` 时，这个捷径就变成 correctness bug。`num_blocks` 让 LMCache 有足够证据识别坐标系，`kernel_pages_per_block` 保存映射比例，`expand_block_ids_to_pages` 则把转换压缩在真正的数据移动边界。

对于 KV cache、分页存储和跨进程 GPU transfer，这是一条很通用的工程原则：**不要因为两个层次暂时使用相同的整数，就把它们当成同一种身份。**

延伸阅读：

- [LMCache PR #6019](https://github.com/LMCache/LMCache/pull/6019)
- [LMCache MP 注册路径详解：register_kv_cache 到底在干什么](/blog/lmcache-register-kv-cache/)
- [vLLM KV Cache Layout：为什么 shape 一样，语义仍可能不同](/blog/vllm-lmcache-kv-cache-layouts/)
