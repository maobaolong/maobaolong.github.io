---
title: "A Full LMCache Hit. Why Does vLLM Still Run the Last Token?"
description: "Follow the first output token from KV cache to logits, then see why a one-token tail broke retrieval and how LMCache PR #6759 handles it."
publishedAt: 2026-11-19
category: "AI Infra"
tags: ["LMCache", "vLLM", "KV Cache", "Prefix Caching"]
author: "Maobaolong"
readingTime: "9 min"
featured: true
draft: false
---

Send the same prompt twice. On the second request, vLLM's local prefix cache is empty, yet LMCache finds the KV for all **257 tokens**. You might expect generation to start immediately. Instead, the load plan covers **256** tokens. The model will run the last token after the KV load finishes.

That gives us three questions. How much KV does LMCache **have**? How much does this request **load**? What does the model **still need to compute**? The answers explain how one extra cache hit once led to an HTTP 500.

<link rel="stylesheet" href="/videos/blog/lmcache-full-prompt-hit/explainer.css?v=chunk-boundary">
<script type="module" src="/videos/blog/lmcache-full-prompt-hit/explainer.js"></script>

<figure class="last-token-video">
  <video controls playsinline preload="metadata" width="1280" height="720" poster="/videos/blog/lmcache-full-prompt-hit/poster-en.jpg" aria-label="Animated explainer · English narration">
    <source src="/videos/blog/lmcache-full-prompt-hit/explainer-en.mp4" type="video/mp4">
    <track kind="captions" src="/videos/blog/lmcache-full-prompt-hit/captions-en.vtt" srclang="en" label="English captions" default>
    <track kind="subtitles" src="/videos/blog/lmcache-full-prompt-hit/subtitles-zh-for-en.vtt" srclang="zh" label="中文字幕">
  </video>
  <figcaption><strong>Animated explainer · 2:40 · English AI narration</strong><span><a href="/videos/blog/lmcache-full-prompt-hit/transcript-en.txt">Read the transcript</a> · <a href="/videos/blog/lmcache-full-prompt-hit/explainer-en.mp4" download>Download MP4</a></span></figcaption>
</figure>

## 1. Where does the first output token come from?

When you submit text, a tokenizer turns it into a sequence of **tokens**. Each token has an integer ID. Picture a toy prompt with three tokens, A, B, and C. The actual splits depend on the tokenizer.

Processing the prompt is called **prefill**. An autoregressive model can predict the next token at each position. At C, the last input position, it produces one score for every entry in its vocabulary. These scores are the **logits**. The generation code uses the logits from that last position to pick the first output token. During **decode**, it feeds that output token back in to predict the next one.

<figure class="last-token-figure">
  <div class="last-token-flow">
    <div><span>Earlier positions</span><strong>A  B</strong><small>Reuse KV cache</small></div>
    <div class="last-token-flow-run"><span>Last prompt token</span><strong>C</strong><small>Run a forward pass</small></div>
    <div><span>Vocabulary scores</span><strong>Logits</strong></div>
    <div class="last-token-flow-output"><span>First output token</span><strong>D</strong><small>Sample</small></div>
  </div>
  <figcaption>Figure 1. Reuse the KV for A and B, run the last input C, then sample from C’s logits.</figcaption>
</figure>

The **KV cache** is a set of notes the model's attention layers leave as they process the sequence. Each position produces Keys and Values. A later token uses its Query to attend to those earlier Keys and Values. When two requests share the same prefix, reusing the saved KV lets the model skip the work that produced the KV for those earlier positions.

That is why the word **prefix** matters. The model at a given position only uses that token and the tokens before it. If the next prompt is A, B, X, it can reuse the KV for A and B, then do fresh work at X.

**The last position's KV and its logits are different data.** Even if the KV for A, B, and C is available, the KV cache does not contain the scores needed to pick the first output token. The model can reuse the KV for A and B, run C again, and get those scores. vLLM's local prefix-cache lookup also reserves a final position for a forward pass. Block-alignment constraints can make the recomputed span longer. [vLLM's cache-hit limit](https://github.com/vllm-project/vllm/blob/ecc827ebbf627792e97a44f328fddac95e293129/vllm/v1/core/kv_cache_manager.py#L317-L325)

## 2. A cold vLLM cache can still get a full LMCache hit

**vLLM** is the inference engine that handles the request, schedules GPU work, and runs the model. Its local prefix cache reuses KV blocks the engine already holds. **LMCache MP** is an external KV cache service vLLM can connect to. Clearing vLLM's local cache leaves the LMCache objects available for a later request. The bug report used exactly that setup. [Issue #6751](https://github.com/LMCache/LMCache/issues/6751)

Take the smallest failing prompt in the reported configuration. A **chunk** holds 256 tokens in LMCache. A **GPU block** holds 64 tokens in the vLLM setup. Chunks are LMCache's storage and transfer units. Blocks are vLLM's units of GPU KV allocation. One full chunk spans four GPU blocks in this example.

1. **The first request saves `256 + 1`.** The setup enables `lmcache.mp.save_unfull_chunk` and sends the first request with `max_tokens = 1`. In the reported configuration, LMCache saves the exact prompt end as an **unfull chunk** containing token 257. Here `max_tokens` limits the length of the response.
2. **The second request finds `257`.** Clear vLLM's local prefix cache, then resend the exact prompt. The local hit is `0`. LMCache finds the full chunk and the tail.
3. **The scheduler plans space for `256`.** In this connector branch, the raw lookup hit `ret` is `257`. The `need_to_load` returned to the vLLM scheduler leaves the last token for a forward pass. Here that gives `257 − 0 − 1 = 256`. Token 257 runs **later**, once the KV load succeeds. [Connector at the PR base](https://github.com/LMCache/LMCache/blob/07f1c6bb642f4772606a36eab730ae009ddce08f/lmcache/integration/vllm/lmcache_mp_connector.py#L1535-L1575)

For a prompt of length `P`, the reuse boundary in this example is at `P−1`. If vLLM already holds some prefix KV, that overlap further reduces how many tokens LMCache needs to load.

<figure class="last-token-figure last-token-demo" data-last-token-demo data-phase="0">
  <div class="last-token-controls" data-controls hidden>
    <div class="last-token-steps">
    <button type="button" data-step="0" aria-pressed="true">Store</button>
    <button type="button" data-step="1" aria-pressed="false">Lookup</button>
    <button type="button" data-step="2" aria-pressed="false">Schedule</button>
    <button type="button" data-step="3" aria-pressed="false">Before</button>
    <button type="button" data-step="4" aria-pressed="false">PR #6759</button>
    </div>
    <button class="last-token-play" type="button" data-play data-start="Play animation" data-stop="Pause animation">Play animation</button>
  </div>
  <div class="last-token-lanes" aria-hidden="true">
    <div class="last-token-lane">
      <span class="last-token-label">Objects in LMCache</span>
      <span class="last-token-kv"><strong>1–256</strong><small>Full chunk</small></span>
      <span class="last-token-tail"><strong>257</strong><small>Tail</small></span>
    </div>
    <div class="last-token-lane last-token-destination">
      <span class="last-token-label">GPU load destinations</span>
      <div class="last-token-blocks"><span>1–64</span><span>65–128</span><span>129–192</span><span>193–256</span><i></i></div>
      <span class="last-token-empty" data-tail-label>Not scheduled</span>
    </div>
  </div>
  <div class="last-token-state" aria-live="polite">
    <div data-state="0" data-tail="Not scheduled"><strong>257 tokens stored in LMCache</strong><span>One 256-token chunk and a tail containing only token 257 are saved.</span></div>
    <div data-state="1" data-tail="Not scheduled" hidden><strong>Local hit: 0. LMCache hit: 257.</strong><span>After clearing vLLM’s local prefix cache, LMCache still holds the complete KV.</span></div>
    <div data-state="2" data-tail="No destination" hidden><strong>Load 256. Run token 257 later.</strong><span>The first 256 tokens get four GPU blocks. The load has no destination for token 257.</span></div>
    <div data-state="3" data-tail="Raises" hidden><strong>Old retrieve still addresses 257 tokens</strong><span>The full chunk can copy. The tail has no destination block, so its exception fails the whole retrieve.</span></div>
    <div data-state="4" data-tail="Skipped" hidden><strong>Skip the tail. Keep the full chunk.</strong><span>The PR skips the tail when every group lacks a destination. The model then runs token 257.</span></div>
  </div>
  <figcaption>Figure 2. Select a step or play the animation. Block widths show grouping and are not to scale.</figcaption>
</figure>

## 3. Why did four GPU blocks lead to a failed retrieve?

The two ends of the load used different lengths. **The scheduler prepared GPU destinations for 256 tokens. The retrieve key still ended at 257.** The connector saved the raw hit length in `tracker.num_lmcache_hit_tokens`, and the old code used that value as the retrieve `end`. When the server resolved that key, it still found the one-token tail. [Retrieve range construction](https://github.com/LMCache/LMCache/blob/07f1c6bb642f4772606a36eab730ae009ddce08f/lmcache/integration/vllm/lmcache_mp_metadata.py#L594-L628)

The full chunk had four blocks to write into. The tail had an empty list of destinations. `trim_and_stage_unfull_chunk_block_ids` prepares target block IDs for each group. It hit the empty list and raised `ValueError: unfull chunk has no block for group 0`. The server marked the whole retrieve as failed. With `kv_load_failure_policy=fail` in the reported setup, vLLM returned an HTTP 500. [The check that raises](https://github.com/LMCache/LMCache/blob/07f1c6bb642f4772606a36eab730ae009ddce08f/lmcache/v1/multiprocess/object_group_transfer/unfull_chunk.py#L129-L138) · [Reproduction logs](https://github.com/LMCache/LMCache/issues/6751)

<h3 id="why-257">Why does 257 fail while 258 works?</h3>

In all three cases, vLLM saves the last token for a forward pass. Look just beyond token 256. **Did LMCache store a tail there, and does the load still need any KV from it?**

<figure class="last-token-figure">
  <div class="last-token-boundary" aria-hidden="true">
    <div class="last-token-boundary-head"><span>Prompt length</span><span>Within the full chunk</span><span>Past the full chunk</span></div>
    <div class="last-token-boundary-row">
      <strong>256</strong>
      <div class="last-token-boundary-chunk"><span class="last-token-load">1–255</span><span class="last-token-run">256</span></div>
      <div class="last-token-boundary-tail"><span class="last-token-absent">No tail object</span></div>
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
  <figcaption>Figure 3. The dashed line marks the chunk boundary after token 256. Blue shows the KV the request plans to reuse. Yellow marks the last token, which runs in the forward pass. The diagram shows token ranges. GPU allocations still happen in blocks.</figcaption>
</figure>

- **256 = one full chunk.** vLLM reserves token 256 for the forward pass. LMCache's stored range ends at the full chunk boundary, so there's no tail object for retrieve to handle.
- **257 = one full chunk + one token.** The tail contains only token 257, the very token reserved for the forward pass. The load plan stops at 256, and the four GPU blocks cover just the full chunk. The old retrieve still includes the tail in its request, with nowhere to put it.
- **258 = one full chunk + two tokens.** Reserving token 258 still leaves token 257 to load. Even that one position needs a fifth GPU block. The old retrieve has a destination when it processes the tail.

The pattern repeats at every chunk boundary. With chunk size `C`, a remainder of zero (`P % C = 0`) means there is no stored tail. A remainder of at least two means there is tail KV left to load after reserving the last token. For a request loading at least one full chunk, **a remainder of exactly one** gives a stored tail with zero tokens in the load range. In other words, `P = k × C + 1`. With `C = 256`, that length condition covers 257, 513, 769, …, 3841.

Length is one condition. In the reported reproduction, the first request used `max_tokens = 1` with tail saving enabled. The second request repeated the prompt after a local prefix-cache reset. The issue records HTTP 500 for 257, 513, and 3841, and success for 258, 3840, and 3842. The 3841-token case also succeeded with vLLM's local prefix cache still populated. [Full reproduction matrix](https://github.com/LMCache/LMCache/issues/6751)

## 4. What does PR #6759 do with the tail?

PR #6759 adds a guard to **retrieve on the LMCache server**. If the key addresses a tail object and **every group's list of destination blocks for the tail is empty**, retrieve skips reading and copying the tail and keeps the full chunks it loaded. A group here is a set of KV layers transferred together. The completion count excludes the skipped tail, and the existing read-lock cleanup still runs. [PR #6759](https://github.com/LMCache/LMCache/pull/6759)

<figure class="last-token-figure">
  <div class="last-token-compare">
    <div><strong>Before</strong><ol><li>Copy the full chunk</li><li>Try to stage the tail</li><li>The entire retrieve fails</li></ol></div>
    <div><strong>PR #6759</strong><ol><li>Copy the full chunk</li><li>Skip the tail if all groups lack destinations</li><li>Keep the 256 loaded tokens</li></ol></div>
  </div>
  <figcaption>Figure 4. Both paths receive the same GPU block IDs. They diverge at the tail.</figcaption>
</figure>

If some groups have a destination and others don't, the existing check still raises. That preserves detection of inconsistent destination metadata. The stored tail remains in LMCache. [Guard condition](https://github.com/LMCache/LMCache/blob/0a707cbbace7d15868bf3e16a77491539360916e/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L1188-L1198) · [Transfer and completion accounting](https://github.com/LMCache/LMCache/blob/0a707cbbace7d15868bf3e16a77491539360916e/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L1272-L1333)

The PR adds a CPU regression test with one full chunk, a tail object, and enough GPU block IDs for only the full chunk. It asserts that retrieval succeeds, only the full chunk is read and transferred, and tail staging is never called. The issue documents the original GPU reproduction. The PR test exercises the server-side fix on CPU. This article describes the November 19, 2026 PR snapshot at `0a707cb`. [Regression test](https://github.com/LMCache/LMCache/blob/0a707cbbace7d15868bf3e16a77491539360916e/tests/v1/multiprocess/test_lmcache_driven_transfer_skip.py#L595-L632)

Back to the 257-token prompt. LMCache can find all **257** tokens. The load only needs to cover the first **256**. With that KV available, vLLM runs the last prompt token and uses its logits to pick the first output. Those steps fit together once retrieve respects the GPU destinations it actually got.
