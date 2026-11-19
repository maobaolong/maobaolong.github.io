---
title: "LMCache 明明全命中，vLLM 为什么还要算最后一个 token？"
description: "从第一个输出 token 怎么生成讲起，用动画拆开 KV cache、logits 和 P−1，再看 LMCache PR #6759 怎样保住一次本来可以成功的加载。"
publishedAt: 2026-11-19
category: "AI Infra"
tags: ["LMCache", "vLLM", "KV Cache", "Prefix Caching"]
author: "Maobaolong"
readingTime: "9 分钟"
featured: true
draft: false
---

同一个 prompt 发两遍。第二遍，vLLM 的本地 prefix cache 是空的，LMCache 却找齐了全部 **257 个 token** 的 KV。照理说可以直接开始生成了吧？实际的加载计划只要 **256 个**。最后一个要等 KV 加载完，再由模型算一遍。

这里有三个不同的问题。LMCache **存着多少**？这次请求**要加载多少**？模型**还要算什么**？把这三件事分开，就能看懂为什么多命中一个 token，曾经会让整个请求返回 HTTP 500。

<link rel="stylesheet" href="/videos/blog/lmcache-full-prompt-hit/explainer.css?v=chunk-boundary">
<script type="module" src="/videos/blog/lmcache-full-prompt-hit/explainer.js"></script>

<figure class="last-token-video">
  <video controls playsinline preload="metadata" width="1280" height="720" poster="/videos/blog/lmcache-full-prompt-hit/poster-zh.jpg" aria-label="动画短片 · 中文口播">
    <source src="/videos/blog/lmcache-full-prompt-hit/explainer-zh.mp4" type="video/mp4">
    <track kind="captions" src="/videos/blog/lmcache-full-prompt-hit/captions-zh.vtt" srclang="zh" label="中文字幕" default>
    <track kind="subtitles" src="/videos/blog/lmcache-full-prompt-hit/subtitles-en-for-zh.vtt" srclang="en" label="English">
  </video>
  <figcaption><strong>动画短片 · 2 分 48 秒 · 中文 AI 口播</strong><span><a href="/videos/blog/lmcache-full-prompt-hit/transcript-zh.txt">阅读口播稿</a> · <a href="/videos/blog/lmcache-full-prompt-hit/explainer-zh.mp4" download>下载视频</a></span></figcaption>
</figure>

## 1. 第一个输出 token 从哪儿来？

你把一段文字发给模型。Tokenizer 先把文字拆成一串 **token**，每个 token 对应一个整数 ID。比如把一个简化的输入画成 A、B、C 三格。A、B、C 只是示意，真实的切分取决于 tokenizer。

模型读取 prompt 的阶段叫 **prefill**。自回归模型在每个位置都可以预测下一格。它读到 C 时，会算出一组覆盖整个词表的分数，这些就是 **logits**。生成程序用最后一个位置的 logits 选出第一个输出 token。随后再处理这个新 token，预测下一个，这就是 **decode** 继续往前走的方式。

<figure class="last-token-figure">
  <div class="last-token-flow">
    <div><span>前两个位置</span><strong>A  B</strong><small>复用 KV cache</small></div>
    <div class="last-token-flow-run"><span>最后一个 prompt token</span><strong>C</strong><small>本次 forward</small></div>
    <div><span>词表分数</span><strong>logits</strong></div>
    <div class="last-token-flow-output"><span>第一个输出 token</span><strong>D</strong><small>采样</small></div>
  </div>
  <figcaption>图 1 · 用 A、B 的 KV 执行最后一个输入 C，再从 C 的 logits 中采样。</figcaption>
</figure>

那 **KV cache** 存的是什么？可以把它想成模型在各个 attention layer 留下的笔记。处理一个位置时，attention 会生成 Key 和 Value，后面的 token 可以用自己的 Query 去查阅它们。把这些 Key 和 Value 留下来，下次遇到相同的开头，就能省掉为那些位置重新计算 KV 的工作。

这也解释了为什么叫 **prefix cache**。处理某个位置时，模型只会用到当前位置和它之前的输入。下次把 A、B、C 换成 A、B、X，前两格仍然可以共享，第三格要从 X 开始算。

**最后一个位置的 KV 与用来采样的 logits 是两份数据。** 即使 A、B、C 的 KV 都在，KV cache 也没有保存这次要用的 logits。模型可以复用 A、B 的 KV，再处理一次 C，得到第一个输出 token 所需的分数。vLLM 在本地 prefix-cache lookup 里也保留最后一个位置供 forward 使用。受 block 对齐约束时，实际可能需要重算更多位置。 [vLLM 的 cache-hit 上限](https://github.com/vllm-project/vllm/blob/ecc827ebbf627792e97a44f328fddac95e293129/vllm/v1/core/kv_cache_manager.py#L317-L325)

## 2. LMCache 全命中时，vLLM 本地可以一个都没命中

**vLLM** 是接收请求、调度 GPU 并运行模型的推理引擎。本地 prefix cache 复用这个引擎已经持有的 KV blocks。**LMCache MP** 是它可以连接的外部 KV 缓存服务。清空 vLLM 自己的 prefix cache 后，LMCache 里的对象依然可以供下一次请求加载。这就是 issue 里的复现方式。 [Issue #6751](https://github.com/LMCache/LMCache/issues/6751)

用这次复现里最小的出错长度来看。LMCache 的一个 **chunk** 对应 256 个 token，vLLM 用于管理 GPU KV 空间的一个 **block** 对应 64 个 token。一个是 LMCache 的存储和传输粒度，一个是 vLLM 的显存分配粒度。此例一个完整 chunk 正好对应四个 GPU blocks。

1. **第一次请求存入 `256 + 1`。** 开启 `lmcache.mp.save_unfull_chunk`，第一次请求设置 `max_tokens = 1`。在 issue 的配置下，LMCache 在 prompt 的精确结束位置存下了一个只含第 257 个 token 的 **unfull chunk**。这里的 `max_tokens` 限制的是输出长度。
2. **第二次请求查到 `257`。** 清空 vLLM 本地 prefix cache，再发完全相同的 prompt。本地命中 `0`，LMCache 找到了完整 chunk 和尾块。
3. **调度器只为外部加载安排 `256`。** 在这条 connector 分支里，LMCache 的原始匹配长度 `ret` 是 `257`，但交给 vLLM 调度器的 `need_to_load` 会预留最后一个 token。此例 `need_to_load = 257 − 0 − 1 = 256`。这时第 257 个 token **还没算**，它要等 KV 加载成功，才会在随后一次 forward 中执行。 [PR 基线上的 connector 代码](https://github.com/LMCache/LMCache/blob/07f1c6bb642f4772606a36eab730ae009ddce08f/lmcache/integration/vllm/lmcache_mp_connector.py#L1535-L1575)

对于长度为 `P` 的 prompt，这个例子里外部加载覆盖的是前 `P−1` 个 token。如果本地已经复用了部分前缀，LMCache 还要扣掉那段重叠。`P−1` 是留下最后一个位置后的**前缀终点**。

<figure class="last-token-figure last-token-demo" data-last-token-demo data-phase="0">
  <div class="last-token-controls" data-controls hidden>
    <div class="last-token-steps">
    <button type="button" data-step="0" aria-pressed="true">首次存储</button>
    <button type="button" data-step="1" aria-pressed="false">再次 lookup</button>
    <button type="button" data-step="2" aria-pressed="false">安排加载</button>
    <button type="button" data-step="3" aria-pressed="false">修复前</button>
    <button type="button" data-step="4" aria-pressed="false">PR #6759</button>
    </div>
    <button class="last-token-play" type="button" data-play data-start="播放动画" data-stop="暂停动画">播放动画</button>
  </div>
  <div class="last-token-lanes" aria-hidden="true">
    <div class="last-token-lane">
      <span class="last-token-label">LMCache 中的对象</span>
      <span class="last-token-kv"><strong>1–256</strong><small>完整 chunk</small></span>
      <span class="last-token-tail"><strong>257</strong><small>尾块</small></span>
    </div>
    <div class="last-token-lane last-token-destination">
      <span class="last-token-label">GPU 加载目的地</span>
      <div class="last-token-blocks"><span>1–64</span><span>65–128</span><span>129–192</span><span>193–256</span><i></i></div>
      <span class="last-token-empty" data-tail-label>尚未安排</span>
    </div>
  </div>
  <div class="last-token-state" aria-live="polite">
    <div data-state="0" data-tail="尚未安排"><strong>257 个 token 写入 LMCache</strong><span>保存一个 256-token chunk 和一个只含第 257 个 token 的尾块。</span></div>
    <div data-state="1" data-tail="尚未安排" hidden><strong>本地命中 0，LMCache 命中 257</strong><span>清空 vLLM 的本地 prefix cache 后，外部缓存仍然有完整的 KV。</span></div>
    <div data-state="2" data-tail="无目标" hidden><strong>加载 256，第 257 个留给 forward</strong><span>前 256 个 token 对应四个 GPU blocks。加载任务没有第 257 个 token 的目标 block。</span></div>
    <div data-state="3" data-tail="抛出异常" hidden><strong>旧 retrieve 仍请求到 257</strong><span>完整 chunk 可以拷贝。尾块没有目标 block，抛出异常后整次 retrieve 返回失败。</span></div>
    <div data-state="4" data-tail="跳过尾块" hidden><strong>跳过尾块，完整 chunk 加载成功</strong><span>任何 group 都没有尾块目的地时，PR 跳过尾块。模型随后运行第 257 个 token。</span></div>
  </div>
  <figcaption>图 2 · 依次点击各步，或播放动画。块宽仅表示分组关系。</figcaption>
</figure>

## 3. 四个 GPU blocks 为什么会让 retrieve 失败？

问题出在加载的两端用了不同的长度。**调度器按 256 个 token 准备 GPU 目的地，retrieve 的 key 仍然以 257 结尾。** 原始命中长度保存在 `tracker.num_lmcache_hit_tokens`，旧代码用它构造 retrieve 的 `end`。于是服务器按 key 去解析对象时，仍然会看到那个 1-token 尾块。 [retrieve 的范围构造](https://github.com/LMCache/LMCache/blob/07f1c6bb642f4772606a36eab730ae009ddce08f/lmcache/integration/vllm/lmcache_mp_metadata.py#L594-L628)

完整 chunk 可以写入已有的四个 blocks。轮到尾块时，它的目的地列表是空的。`trim_and_stage_unfull_chunk_block_ids` 要为每个 group 准备目标 block ID，碰到空列表就抛出 `ValueError: unfull chunk has no block for group 0`。服务器把整次 retrieve 标记为失败。在 issue 的配置中，vLLM 使用 `kv_load_failure_policy=fail`，客户端因此收到了 HTTP 500。 [抛出异常的检查](https://github.com/LMCache/LMCache/blob/07f1c6bb642f4772606a36eab730ae009ddce08f/lmcache/v1/multiprocess/object_group_transfer/unfull_chunk.py#L129-L138) · [复现日志](https://github.com/LMCache/LMCache/issues/6751)

<h3 id="why-257">为什么 257 会失败，258 却可以？</h3>

三种长度都留最后一个 token 给 forward。要看的是**第 256 个 token 之后，LMCache 有没有存尾块，以及这次加载还需不需要进尾块**。

<figure class="last-token-figure">
  <div class="last-token-boundary" aria-hidden="true">
    <div class="last-token-boundary-head"><span>Prompt 长度</span><span>完整 chunk 内</span><span>完整 chunk 之后</span></div>
    <div class="last-token-boundary-row">
      <strong>256</strong>
      <div class="last-token-boundary-chunk"><span class="last-token-load">1–255</span><span class="last-token-run">256</span></div>
      <div class="last-token-boundary-tail"><span class="last-token-absent">无尾块对象</span></div>
    </div>
    <div class="last-token-boundary-row">
      <strong>257</strong>
      <div class="last-token-boundary-chunk"><span class="last-token-load">1–256</span></div>
      <div class="last-token-boundary-tail"><span class="last-token-run">257</span></div>
    </div>
    <div class="last-token-boundary-row">
      <strong>258</strong>
      <div class="last-token-boundary-chunk"><span class="last-token-load">1–256</span></div>
      <div class="last-token-boundary-tail"><span class="last-token-load">257</span><span class="last-token-run">258</span></div>
    </div>
  </div>
  <figcaption>图 3 · 虚线标出第 256 个 token 后的 chunk 边界。蓝色是计划复用的 KV，黄色是留给 forward 的最后一个 token。图示按 token 范围划分，GPU 仍按 block 分配。</figcaption>
</figure>

- **256 = 1 个完整 chunk。** vLLM 留第 256 个 token 给 forward。因为 LMCache 的存储边界也到 256，根本没有尾块对象要处理。
- **257 = 1 个完整 chunk + 1 个 token。** 尾块只有第 257 个 token，刚好就是留给 forward 的那个。加载计划止于第 256 个 token，四个 GPU blocks 刚好覆盖完整 chunk。旧 retrieve 仍把尾块列入加载范围，却没有任何尾块目标 block。
- **258 = 1 个完整 chunk + 2 个 token。** 留第 258 个 token 给 forward 后，第 257 个的 KV 仍要加载。即使只需要尾块里的这一个位置，也得分配第 5 个 GPU block。旧 retrieve 处理尾块时就有目标地址。

所以这个边界按 chunk 大小重复。设 chunk 大小为 `C`，`P % C = 0` 时没有尾块，余数至少为 2 时裁掉最后一个 token 仍会留下需要加载的尾块 KV。对需要加载至少一个完整 chunk 的请求，**余数恰好为 1** 时才会出现「尾块存着，但加载范围里一个尾块 token 都没有」。这时 `P = k × C + 1`。当 `C = 256`，符合这个长度条件的有 257、513、769、⋯、3841。

长度只是触发条件之一。原 issue 中首次请求启用了尾块保存并设置 `max_tokens = 1`，第二次发相同 prompt 前清空了 vLLM 的本地 prefix cache。作者实际观察到 257、513、3841 返回 HTTP 500，258、3840、3842 成功。同样是 3841，如果 vLLM 本地前缀还在，对照请求也成功了。 [完整复现矩阵](https://github.com/LMCache/LMCache/issues/6751)

## 4. PR #6759 怎么处理这个尾块？

PR #6759 在 **LMCache server 的 retrieve** 路径上判断，本次 key 指向尾块对象，而且**所有 group 的尾块目标 block 列表都为空**。`group` 在这里可以理解成一起搬运的一组 KV 层。这个条件成立时，服务器跳过尾块的读取和拷贝，保留已经加载的完整 chunks。完成时报告的 token 数也去掉跳过的尾块，原有的读锁释放流程继续执行。 [PR #6759](https://github.com/LMCache/LMCache/pull/6759)

<figure class="last-token-figure">
  <div class="last-token-compare">
    <div><strong>修复前</strong><ol><li>拷贝完整 chunk</li><li>尝试为尾块 staging</li><li>整次 retrieve 失败</li></ol></div>
    <div><strong>PR #6759</strong><ol><li>拷贝完整 chunk</li><li>所有 group 均无目标，跳过尾块</li><li>保留 256 个已加载 token</li></ol></div>
  </div>
  <figcaption>图 4 · 两条路径接收相同的 GPU block IDs，区别发生在处理尾块时。</figcaption>
</figure>

如果某些 group 有尾块目标 block、另一些没有，就仍走原来的检查并报错。这样可以区分「整段尾块没有任何加载目的地」和「加载所需的目的地信息不一致」。尾块对象仍保存在 LMCache 中。 [判断条件](https://github.com/LMCache/LMCache/blob/0a707cbbace7d15868bf3e16a77491539360916e/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L1188-L1198) · [传输与完成统计](https://github.com/LMCache/LMCache/blob/0a707cbbace7d15868bf3e16a77491539360916e/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L1272-L1333)

PR 新增的 CPU 回归测试构造了「一个完整 chunk、有尾块对象、GPU block 只够完整 chunk」的输入。它断言 `retrieve()` 成功，只读取和传输完整 chunk，且尾块 staging 完全没有被调用。Issue 提供的是修复前的 GPU 复现，PR 提供的是修复逻辑的 CPU 单测。本文按 2026-11-19 的 PR 快照 `0a707cb` 解读。 [回归测试](https://github.com/LMCache/LMCache/blob/0a707cbbace7d15868bf3e16a77491539360916e/tests/v1/multiprocess/test_lmcache_driven_transfer_skip.py#L595-L632)

回到开头的 257 个 token。LMCache 可以找到全部 **257** 个，加载只要覆盖前 **256** 个，vLLM 用它们和最后那个 prompt token 做一次 forward，再从产生的 logits 选出第一个输出。只要 retrieve 按实际给它的 GPU 目的地工作，这三件事就能接起来。
