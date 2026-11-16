---
title: "从零理解 SGLang、HiCache、Mamba 与 LMCache：为什么 8768 的状态不能存到 8704"
description: "从一次 64/256 token 对齐冲突出发，解释混合模型的状态缓存、SGLang 调度器、HiCache 与 LMCache 的边界，以及为什么修复必须发生在调度阶段。"
publishedAt: 2026-11-16
category: "AI Infra"
tags: ["SGLang", "LMCache", "HiCache", "Mamba", "KV Cache", "Scheduler"]
author: "Maobaolong"
readingTime: "30 分钟"
featured: true
draft: false
---

> 本文对应 [SGLang PR #50706](https://github.com/sgl-project/sglang/pull/50706)，代码快照固定在 2026-11-16 的 PR head [`6e4771a`](https://github.com/sgl-project/sglang/commit/6e4771a454b9bb01b365cbdff1d422dff6eaad64)。文章讨论的是一个跨越调度器、Radix Cache 和外部存储的正确性约束，而不是某个后端的性能调优。

一个请求已经处理到第 **8768** 个 token。系统随后准备把状态写进一个以 **256 token** 为块的外部缓存，于是生成了 key **8704**。

只差 64，看起来似乎无伤大雅。

但对 Mamba 来说，这等价于把“读完第 8768 页后的脑中摘要”贴上“只读到第 8704 页”的标签。下次从 8704 继续读时，模型会提前知道后面 64 个 token。这个缓存不是稍微不精确，而是语义上错误。

<div class="mca-callout mca-callout--danger">
  <strong>全文最重要的一句话</strong>
  <span>Mamba 状态的 token 深度是状态内容的一部分。状态可以不存，但不能改名。</span>
</div>

## 先用一分钟认识所有角色

<div class="mca-glossary">
  <article><b>SGLang</b><span>运行大模型请求的推理引擎。它决定哪个请求现在计算、一次计算多少 token，以及哪些缓存可以复用。</span></article>
  <article><b>Scheduler</b><span>SGLang 的调度器。它在一次 forward 之前制定计划，因此知道本轮会走到哪个 token。</span></article>
  <article><b>HiCache</b><span>SGLang 的分层缓存框架，让前缀缓存不只停留在 GPU，还能下沉到更大、更慢的层级。</span></article>
  <article><b>LMCache</b><span>HiCache 可以连接的一种外部存储后端。它按自己的 chunk 粒度组织和复用缓存。</span></article>
  <article><b>Mamba</b><span>一种递归状态模型。它不像注意力那样保存每个历史 token 的 KV，而是不断更新一个“读到这里为止”的状态。</span></article>
  <article><b>Radix Cache</b><span>SGLang 用前缀树管理共享前缀的缓存结构。相同开头的请求可以复用已经计算过的部分。</span></article>
</div>

## 1. 大模型推理到底在缓存什么？

收到 prompt 后，模型先一次性读入已有文本，这叫 **prefill**；随后一次生成一个新 token，这叫 **decode**。如果每次 decode 都从头重算 prompt，成本会非常高，所以系统会缓存“已经读过的历史”。

<figure class="mca-figure">
  <div class="mca-inference-flow" aria-label="prefill and decode flow">
    <div class="mca-token-strip"><span>今</span><span>天</span><span>北</span><span>京</span><span>天</span><span>气</span></div>
    <div class="mca-arrow">prefill →</div>
    <div class="mca-cache-box"><b>历史缓存</b><small>“这些 token 已经算过”</small></div>
    <div class="mca-arrow">decode →</div>
    <div class="mca-token-strip mca-token-strip--new"><span>很</span><span>好</span></div>
  </div>
  <figcaption>缓存不是原始文本的副本，而是模型继续计算所需的中间状态。</figcaption>
</figure>

### Attention：保存一排 KV

Transformer 的注意力层通常为历史中的每个 token 保存 Key/Value。可以把它想成一排带编号的档案：前 8704 个 token 对应前 8704 份档案，边界天然可切。

### Mamba：保存“读到这里”的递归状态

Mamba 更像一位边读边更新笔记的人。读到第 8704 个 token 的状态记作 <span class="mca-state-symbol">h<sub>8704</sub></span>；继续读 64 个 token 后得到 <span class="mca-state-symbol">h<sub>8768</sub></span>：

<div class="mca-equation">h<sub>t+1</sub> = f(h<sub>t</sub>, x<sub>t+1</sub>)</div>

一般情况下，<span class="mca-state-symbol">h<sub>8768</sub></span> **不能反推出** <span class="mca-state-symbol">h<sub>8704</sub></span>。如果中间状态没有保存，后端无法把 8768 的状态“裁掉 64 个 token”。

<div class="mca-state-compare">
  <div><b>Attention KV</b><div class="mca-kv-cells"><i></i><i></i><i></i><i></i><i></i><i></i></div><span>像一排文件，可以在已有边界切片</span></div>
  <div><b>Mamba state</b><div class="mca-state-orb">h<sub>8768</sub></div><span>像压缩后的整体摘要，深度必须精确</span></div>
</div>

现代 **hybrid model** 会同时包含 Attention 层和 Mamba 层。要复用一个前缀，不仅 KV 要对，Mamba 的递归状态也必须对应完全相同的 token 深度。

## 2. Scheduler、Radix Cache、HiCache 与 LMCache 如何协作？

下面这张图是理解问题的地图。把鼠标或手指放到每个节点上，可以看到它拥有的信息。

<div class="mca-architecture" role="img" aria-label="cache ownership architecture">
  <div class="mca-node" tabindex="0"><b>1. Scheduler</b><span>forward 前决定计算到哪里</span><em>唯一能选择要生成哪个 Mamba checkpoint 的地方</em></div>
  <div class="mca-link">计划</div>
  <div class="mca-node" tabindex="0"><b>2. Model forward</b><span>计算 KV 与 Mamba state</span><em>只会产出调度器要求保留的 checkpoint</em></div>
  <div class="mca-link">状态</div>
  <div class="mca-node" tabindex="0"><b>3. Radix / HiCache</b><span>给共享前缀建立索引</span><em>把状态交给本地或外部层级</em></div>
  <div class="mca-link">store</div>
  <div class="mca-node mca-node--accent" tabindex="0"><b>4. LMCache</b><span>按 chunk key 持久化</span><em>知道 chunk_size，但不能重新计算早先的状态</em></div>
</div>

这里要区分两个经常被混用的概念：

- **HiCache 是框架与路径**：SGLang 用它管理多层缓存。
- **LMCache 是一种外部后端**：它为这条路径提供更大容量的存储。

所以，不是每一种 HiCache 配置都使用 LMCache；但当 HiCache 连接 LMCache 时，两侧必须对“一个可存储前缀结束在哪里”达成一致。

## 3. 事故现场：8768 为什么撞上 8704？

这次回归用例很具体：

- 已经命中的前缀：8192 token
- 本轮扩展：617 token
- 请求结束：`8192 + 617 = 8809`
- Mamba / Radix checkpoint 粒度：64 token
- LMCache chunk 粒度：256 token

旧逻辑从已命中的前缀开始，按 64 向下取整：

<div class="mca-equation">8192 + floor(617 ÷ 64) × 64 = <b>8768</b></div>

因此 forward 保留了 <span class="mca-state-symbol">h<sub>8768</sub></span>。但 LMCache 为 8809 生成的最后一个完整 chunk key 是：

<div class="mca-equation">floor(8809 ÷ 256) × 256 = <b>8704</b></div>

于是系统手里只有 **内容属于 8768 的状态**，外部存储却只接受 **名字为 8704 的 chunk**。

<div class="mca-ruler-card">
  <div class="mca-ruler-labels"><span>8192<br><small>cached prefix</small></span><span>8704<br><small>LMCache key</small></span><span>8768<br><small>old state</small></span><span>8809<br><small>request end</small></span></div>
  <div class="mca-ruler"><i style="--x:0%"></i><i style="--x:83%"></i><i class="bad" style="--x:93.4%"></i><i style="--x:100%"></i></div>
  <p><b>64-token gap：</b>它不是可以忽略的 padding，而是 h<sub>8704</sub> 与 h<sub>8768</sub> 的语义差异。</p>
</div>

LMCache 原来的防线会检测长度不一致并跳过 store。这避免了静默写入错误状态，但也意味着本来应该进入外部缓存的前缀没有被保存。下一次请求无法从 LMCache 命中，HiCache 的这条路径失去了作用。

## 4. 自己动手：对齐实验室

下面是一个简化模型。拖动参数，观察“旧 checkpoint”“外部 key”和“修复后的 checkpoint”。真实代码还会检查 checkpoint 是否位于当前可达前缀之后，但核心约束就是这里展示的共同边界。

<section class="mca-lab" id="mca-lab" data-locale="zh">
  <div class="mca-lab-controls">
    <label>命中前缀 <output id="mca-prefix-out">8192</output><input id="mca-prefix" type="range" min="0" max="16384" step="64" value="8192"></label>
    <label>本轮扩展 <output id="mca-extend-out">617</output><input id="mca-extend" type="range" min="1" max="2048" step="1" value="617"></label>
    <label>Mamba / page 粒度 <select id="mca-grid"><option>32</option><option selected>64</option><option>128</option><option>256</option></select></label>
    <label>外部 chunk <select id="mca-external"><option>64</option><option>128</option><option selected>256</option><option>512</option></select></label>
    <div class="mca-presets"><button type="button" data-preset="bug">复现 8768/8704</button><button type="button" data-preset="aligned">天然对齐</button><button type="button" data-preset="noexternal">无外部约束</button></div>
  </div>
  <div class="mca-lab-results">
    <div><small>请求结束</small><strong id="mca-end">8809</strong></div>
    <div class="mca-result-old"><small>旧 checkpoint</small><strong id="mca-old">8768</strong></div>
    <div><small>外部 key</small><strong id="mca-key">8704</strong></div>
    <div class="mca-result-new"><small>修复后 checkpoint</small><strong id="mca-new">8704</strong></div>
  </div>
  <div class="mca-lab-track"><span id="mca-track-prefix"></span><span id="mca-track-key"></span><span id="mca-track-old"></span><span id="mca-track-end"></span></div>
  <p class="mca-verdict" id="mca-verdict" aria-live="polite"></p>
  <code id="mca-formula"></code>
</section>

## 5. 修复不是“让 LMCache 接受 8768”

修复采用的是一个很小、但边界清晰的 capability contract：

1. `BasePrefixCache.external_store_alignment()` 默认返回 `1`。没有外部约束的缓存行为不变。
2. LMCache-backed `UnifiedRadixCache` 返回连接器的 `chunk_size`，例如 `256`。
3. Scheduler 在 forward **之前**把 Mamba checkpoint 粒度、Radix page 粒度和外部粒度合并：

<div class="mca-equation">共同粒度 G = lcm(Mamba 粒度, page 粒度, 外部粒度)</div>

本例中：

<div class="mca-equation">lcm(64, 64, 256) = <b>256</b></div>

然后从请求的绝对 token 位置 8809 向下选择共同边界：

<div class="mca-equation">floor(8809 ÷ 256) × 256 = <b>8704</b></div>

forward 因此直接产出 <span class="mca-state-symbol">h<sub>8704</sub></span>。Radix Cache、HiCache 和 LMCache 看到的是同一个深度，store 可以安全完成。

<div class="mca-player" id="mca-player" data-locale="zh">
  <div class="mca-player-head">
    <div><b>逐步播放：状态从哪里变得不可修复？</b><span id="mca-step-count">1 / 5</span></div>
    <div class="mca-mode"><button type="button" data-mode="old" class="active">旧逻辑</button><button type="button" data-mode="fixed">修复后</button></div>
  </div>
  <div class="mca-stage" id="mca-stage">
    <div class="mca-stage-node" data-stage="0">Scheduler<br><small>选择 checkpoint</small></div>
    <div class="mca-stage-node" data-stage="1">Forward<br><small>只生成所选状态</small></div>
    <div class="mca-stage-node" data-stage="2">Radix<br><small>挂到前缀节点</small></div>
    <div class="mca-stage-node" data-stage="3">LMCache key<br><small>按 chunk 对齐</small></div>
    <div class="mca-stage-node" data-stage="4">Store<br><small>写入或跳过</small></div>
  </div>
  <p id="mca-stage-copy"></p>
  <div class="mca-player-controls"><button type="button" id="mca-prev" aria-label="上一步">←</button><button type="button" id="mca-play">播放</button><button type="button" id="mca-next" aria-label="下一步">→</button></div>
</div>

## 6. 为什么必须改 Scheduler？

因为 **checkpoint 是计算的产物，不是 store 时可以随便切割的字节数组**。

Scheduler 在 forward 之前同时知道：

- 请求这轮从哪里开始、到哪里结束；
- 模型允许在哪些位置捕获 Mamba state；
- Radix Cache 的 page 约束；
- 经由 Prefix Cache 暴露出来的外部存储对齐约束。

一旦 forward 结束且只保留了 <span class="mca-state-symbol">h<sub>8768</sub></span>，下面的存储层已经没有 <span class="mca-state-symbol">h<sub>8704</sub></span>。因此，把修复全部塞进 `lmcache_unified_radix_cache.py` 会面临四个不成立的选择：

<div class="mca-alternatives">
  <details><summary>把 8768 状态标成 8704</summary><p>静默数据错误。后续请求从 8704 恢复，却拿到包含未来 64 token 信息的状态。</p></details>
  <details><summary>让 LMCache 用 8768 作为 key</summary><p>破坏它按固定 chunk 建立的寻址与复用合同，也不能保证其他 tensor 与元数据拥有相同边界。</p></details>
  <details><summary>在 store 时重新计算 8704</summary><p>正确状态需要 forward 过程中的中间演化；此时通常已经丢失。重放还会把缓存写入变成昂贵的额外推理。</p></details>
  <details><summary>只存 KV，不存 Mamba state</summary><p>对 hybrid model 不是可恢复的完整前缀。命中一个无法继续执行的缓存条目没有意义。</p></details>
</div>

把约束从 LMCache 上报给 Scheduler，并不等于“让通用调度器依赖 LMCache”。Scheduler 只看到一个整数 capability：`external_store_alignment()`；默认值为 1，其他后端无需知道 LMCache 的存在。

这与内存分配器向上报告 alignment、网络设备报告 MTU 是同一种设计：**消费者声明约束，生产者在生产时满足约束。**

## 7. 为什么这不只是 LMCache 的问题？

可以用三个问题判断 ownership：

| 问题 | 谁知道答案？ |
|---|---|
| 外部后端接受什么 chunk 边界？ | LMCache connector |
| 当前模型能在哪些位置捕获 Mamba checkpoint？ | SGLang model/scheduler path |
| forward 最终应该产出哪个状态？ | Scheduler，在计算开始之前 |

LMCache 负责诚实地报告自己的对齐要求；SGLang 负责不要生产一个无法沿当前缓存路径持久化的 checkpoint。任意一侧单独行动都无法完成这个合同。

更一般地说，这不是某个产品名的问题，而是 **recurrent-state checkpoint producer** 与 **external chunked-store consumer** 的跨层不变量。未来换成另一种外部后端，只要它也有大于 1 的固定粒度，同样需要把能力传到 checkpoint 的生产点。

## 8. 这个改动的范围是否合理？

PR 的改动集中在五处：

- Prefix Cache 基类增加默认 capability，保持现有实现兼容；
- LMCache-backed cache 返回真实 `chunk_size`；
- Scheduler 用 `lcm` 合并对齐约束，并在存在外部约束时使用绝对边界；
- 一个 fake cache 补齐测试接口；
- 回归测试固定 `8192 + 617 → 8704`。

关键点是：它没有把 LMCache 类型判断硬编码进 Scheduler，也没有改变所有缓存的默认行为。只有后端明确报告外部对齐时，新约束才生效。

PR 的 [Buildkite #6665 端到端验证](https://buildkite.com/sglang/sglang/builds/6665)还覆盖了一个 hybrid model 场景：两次请求输出一致，第二次能够从 LMCache retrieve。这里的“命中”不是单纯检查 store API 被调用，而是验证存下来的状态真的能被下一次推理使用。

## 9. 源码地图

如果你想沿着代码继续读，可以按这个顺序：

1. [`schedule_batch.py`：计算 checkpoint 对齐](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/python/sglang/srt/managers/schedule_batch.py#L2634-L2677)
2. [`base_prefix_cache.py`：通用 capability 默认值](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/python/sglang/srt/mem_cache/base_prefix_cache.py#L881-L883)
3. [`lmcache_unified_radix_cache.py`：LMCache 报告 chunk_size](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/python/sglang/srt/mem_cache/storage/lmcache/lmcache_unified_radix_cache.py#L88-L89)
4. [`test_mamba_checkpoint_depth.py`：回归场景](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/test/registered/unit/managers/test_mamba_checkpoint_depth.py#L99-L110)

## 最后，把整件事压缩成四句话

1. Mamba state 表示“模型精确读到第 N 个 token 后的记忆”，N 不能被改名。
2. LMCache 以固定 chunk 寻址，所以只接受某些 token 边界。
3. 正确边界必须在 forward 之前决定；store 阶段拿到错误深度后已经来不及修。
4. 因此 LMCache 应报告约束，而 SGLang Scheduler 必须在状态的生产点满足它。

这就是为什么 `schedule_batch.py` 的改动不是把 LMCache 细节泄漏到调度器，而是在正确的 ownership 边界上补齐一个此前缺失的跨层合同。
