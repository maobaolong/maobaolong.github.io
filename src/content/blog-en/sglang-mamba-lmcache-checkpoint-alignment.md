---
title: "Why a Mamba State at Token 8768 Cannot Be Stored Under 8704"
description: "SGLang scheduling, HiCache, Mamba state, and LMCache explained from first principles—and why checkpoint alignment must be fixed before the model forward pass."
publishedAt: 2026-11-16
category: "AI Infra"
tags: ["SGLang", "LMCache", "HiCache", "Mamba", "KV Cache", "Scheduler"]
author: "Maobaolong"
readingTime: "30 min"
featured: true
draft: false
---

> This article follows [SGLang PR #50706](https://github.com/sgl-project/sglang/pull/50706) at PR head [`6e4771a`](https://github.com/sgl-project/sglang/commit/6e4771a454b9bb01b365cbdff1d422dff6eaad64) on 2026-11-16. The change repairs a correctness contract spanning the scheduler, radix cache, and external storage. It is not merely an LMCache performance tweak.

A request has produced a model state at token **8768**. The external cache stores data in **256-token chunks**, so it generates the key **8704**.

The difference is only 64 tokens. Why not store it anyway?

For Mamba, that would be like labeling “my memory after page 8768” as “my memory after page 8704.” A later request resuming at 8704 would receive knowledge from 64 future tokens. The cache would not be approximate; it would be semantically wrong.

<div class="mca-callout mca-callout--danger">
  <strong>The one sentence to remember</strong>
  <span>The token depth of a Mamba state is part of its content. A state may be skipped, but it must never be renamed.</span>
</div>

## Meet the components in one minute

<div class="mca-glossary">
  <article><b>SGLang</b><span>An inference engine that runs model requests and decides what to compute and reuse.</span></article>
  <article><b>Scheduler</b><span>The planner that chooses which requests run and how many tokens each forward pass processes.</span></article>
  <article><b>HiCache</b><span>SGLang's hierarchical cache framework, extending prefix caching beyond GPU memory.</span></article>
  <article><b>LMCache</b><span>One external storage backend that HiCache can use. It organizes cached data in chunks.</span></article>
  <article><b>Mamba</b><span>A recurrent state-space model that continuously updates a compact “memory up to here.”</span></article>
  <article><b>Radix Cache</b><span>SGLang's prefix tree for sharing already-computed beginnings across requests.</span></article>
</div>

## 1. What does LLM inference cache?

The model first consumes the prompt in a **prefill**. It then generates one token at a time during **decode**. Recomputing the whole prompt for every new token would be wasteful, so the engine saves the intermediate information needed to continue.

<figure class="mca-figure">
  <div class="mca-inference-flow" aria-label="prefill and decode flow">
    <div class="mca-token-strip"><span>The</span><span>sky</span><span>is</span><span>very</span><span>clear</span></div>
    <div class="mca-arrow">prefill →</div>
    <div class="mca-cache-box"><b>model cache</b><small>“this history is already computed”</small></div>
    <div class="mca-arrow">decode →</div>
    <div class="mca-token-strip mca-token-strip--new"><span>today</span></div>
  </div>
  <figcaption>The cache is not a copy of the text. It is the model's intermediate state for continuing computation.</figcaption>
</figure>

### Attention keeps a row of KV entries

A Transformer attention layer usually stores Key/Value data for every historical token. Imagine a numbered row of files: the first 8704 tokens correspond to the first 8704 files, so existing boundaries can be sliced.

### Mamba keeps a recurrent “memory up to here”

Mamba resembles a reader who continuously rewrites a compact notebook. The state after token 8704 is <span class="mca-state-symbol">h<sub>8704</sub></span>. After 64 more updates, it becomes <span class="mca-state-symbol">h<sub>8768</sub></span>:

<div class="mca-equation">h<sub>t+1</sub> = f(h<sub>t</sub>, x<sub>t+1</sub>)</div>

In general, <span class="mca-state-symbol">h<sub>8768</sub></span> cannot be sliced backward into <span class="mca-state-symbol">h<sub>8704</sub></span>. If the earlier state was not captured, a storage backend cannot recreate it.

<div class="mca-state-compare">
  <div><b>Attention KV</b><div class="mca-kv-cells"><i></i><i></i><i></i><i></i><i></i><i></i></div><span>A row of files that can be cut at an existing boundary</span></div>
  <div><b>Mamba state</b><div class="mca-state-orb">h<sub>8768</sub></div><span>One compressed summary whose depth must be exact</span></div>
</div>

A **hybrid model** contains both Attention and Mamba layers. Reusing a prefix requires both the KV data and the recurrent state to describe exactly the same number of tokens.

## 2. How do Scheduler, Radix Cache, HiCache, and LMCache cooperate?

This is the map for the rest of the article. Hover or focus each node to see what it owns.

<div class="mca-architecture" role="img" aria-label="cache ownership architecture">
  <div class="mca-node" tabindex="0"><b>1. Scheduler</b><span>chooses the checkpoint before forward</span><em>The only layer that can request the right Mamba state</em></div>
  <div class="mca-link">plan</div>
  <div class="mca-node" tabindex="0"><b>2. Model forward</b><span>computes KV and recurrent state</span><em>Only the requested checkpoint is retained</em></div>
  <div class="mca-link">state</div>
  <div class="mca-node" tabindex="0"><b>3. Radix / HiCache</b><span>indexes the shared prefix</span><em>Routes state into local or external tiers</em></div>
  <div class="mca-link">store</div>
  <div class="mca-node mca-node--accent" tabindex="0"><b>4. LMCache</b><span>persists data under chunk keys</span><em>Knows chunk_size, but cannot recompute an earlier state</em></div>
</div>

Two terms are easy to conflate:

- **HiCache is the framework and data path** for SGLang's cache hierarchy.
- **LMCache is one external backend** attached to that path.

Not every HiCache setup uses LMCache. But when it does, both sides must agree on where a storable prefix ends.

## 3. The failure: why does 8768 collide with 8704?

The regression test is deliberately concrete:

- cached prefix: 8192 tokens
- extension in this batch: 617 tokens
- request end: `8192 + 617 = 8809`
- Mamba/radix checkpoint grid: 64 tokens
- LMCache chunk size: 256 tokens

The old scheduler started from the matched prefix and rounded the extension down to 64:

<div class="mca-equation">8192 + floor(617 ÷ 64) × 64 = <b>8768</b></div>

The forward pass therefore retained <span class="mca-state-symbol">h<sub>8768</sub></span>. LMCache, however, derived the last complete chunk key for 8809 as:

<div class="mca-equation">floor(8809 ÷ 256) × 256 = <b>8704</b></div>

The system owned **state content for 8768**, while the external store accepted a **chunk named 8704**.

<div class="mca-ruler-card">
  <div class="mca-ruler-labels"><span>8192<br><small>cached prefix</small></span><span>8704<br><small>LMCache key</small></span><span>8768<br><small>old state</small></span><span>8809<br><small>request end</small></span></div>
  <div class="mca-ruler"><i style="--x:0%"></i><i style="--x:83%"></i><i class="bad" style="--x:93.4%"></i><i style="--x:100%"></i></div>
  <p><b>The 64-token gap</b> is not ignorable padding. It is the semantic difference between h<sub>8704</sub> and h<sub>8768</sub>.</p>
</div>

LMCache's defensive check skipped the store when lengths disagreed. That prevented silent corruption, but the prefix never entered external storage, so the next request could not retrieve it through HiCache.

## 4. Try it: the alignment lab

Change the numbers below and compare the old checkpoint, the external key, and the repaired checkpoint. This is a simplified model; the production code also verifies that a checkpoint remains reachable from the current matched prefix.

<section class="mca-lab" id="mca-lab" data-locale="en">
  <div class="mca-lab-controls">
    <label>Matched prefix <output id="mca-prefix-out">8192</output><input id="mca-prefix" type="range" min="0" max="16384" step="64" value="8192"></label>
    <label>Batch extension <output id="mca-extend-out">617</output><input id="mca-extend" type="range" min="1" max="2048" step="1" value="617"></label>
    <label>Mamba / page grid <select id="mca-grid"><option>32</option><option selected>64</option><option>128</option><option>256</option></select></label>
    <label>External chunk <select id="mca-external"><option>64</option><option>128</option><option selected>256</option><option>512</option></select></label>
    <div class="mca-presets"><button type="button" data-preset="bug">Reproduce 8768/8704</button><button type="button" data-preset="aligned">Naturally aligned</button><button type="button" data-preset="noexternal">No extra constraint</button></div>
  </div>
  <div class="mca-lab-results">
    <div><small>Request end</small><strong id="mca-end">8809</strong></div>
    <div class="mca-result-old"><small>Old checkpoint</small><strong id="mca-old">8768</strong></div>
    <div><small>External key</small><strong id="mca-key">8704</strong></div>
    <div class="mca-result-new"><small>Fixed checkpoint</small><strong id="mca-new">8704</strong></div>
  </div>
  <div class="mca-lab-track"><span id="mca-track-prefix"></span><span id="mca-track-key"></span><span id="mca-track-old"></span><span id="mca-track-end"></span></div>
  <p class="mca-verdict" id="mca-verdict" aria-live="polite"></p>
  <code id="mca-formula"></code>
</section>

## 5. The fix is not “make LMCache accept 8768”

The repair introduces a small capability contract:

1. `BasePrefixCache.external_store_alignment()` returns `1` by default. Caches without an external constraint remain unchanged.
2. The LMCache-backed `UnifiedRadixCache` reports its connector's `chunk_size`, such as `256`.
3. Before forward, the Scheduler combines Mamba, radix-page, and external constraints:

<div class="mca-equation">Common grid G = lcm(Mamba grid, page grid, external grid)</div>

For this request:

<div class="mca-equation">lcm(64, 64, 256) = <b>256</b></div>

It then selects the common boundary from the absolute request position:

<div class="mca-equation">floor(8809 ÷ 256) × 256 = <b>8704</b></div>

The forward pass now produces <span class="mca-state-symbol">h<sub>8704</sub></span> directly. Radix Cache, HiCache, and LMCache all refer to the same token depth, so the store is safe.

<div class="mca-player" id="mca-player" data-locale="en">
  <div class="mca-player-head">
    <div><b>Step through it: when does the state become impossible to repair?</b><span id="mca-step-count">1 / 5</span></div>
    <div class="mca-mode"><button type="button" data-mode="old" class="active">Old path</button><button type="button" data-mode="fixed">Fixed path</button></div>
  </div>
  <div class="mca-stage" id="mca-stage">
    <div class="mca-stage-node" data-stage="0">Scheduler<br><small>chooses checkpoint</small></div>
    <div class="mca-stage-node" data-stage="1">Forward<br><small>creates chosen state</small></div>
    <div class="mca-stage-node" data-stage="2">Radix<br><small>attaches prefix state</small></div>
    <div class="mca-stage-node" data-stage="3">LMCache key<br><small>aligns to chunk</small></div>
    <div class="mca-stage-node" data-stage="4">Store<br><small>writes or skips</small></div>
  </div>
  <p id="mca-stage-copy"></p>
  <div class="mca-player-controls"><button type="button" id="mca-prev" aria-label="Previous step">←</button><button type="button" id="mca-play">Play</button><button type="button" id="mca-next" aria-label="Next step">→</button></div>
</div>

## 6. Why must the Scheduler change?

Because a **checkpoint is a computation result, not a byte array that storage can slice later**.

Before forward, the Scheduler knows:

- where this request starts and ends in the current batch;
- which Mamba checkpoints the model can capture;
- the Radix Cache page constraint;
- the external alignment exposed by the active Prefix Cache.

After forward has retained only <span class="mca-state-symbol">h<sub>8768</sub></span>, the storage layers no longer possess <span class="mca-state-symbol">h<sub>8704</sub></span>. A fix confined to `lmcache_unified_radix_cache.py` would have only invalid options:

<div class="mca-alternatives">
  <details><summary>Relabel state 8768 as 8704</summary><p>This is silent data corruption: a request resuming at 8704 receives information from 64 future tokens.</p></details>
  <details><summary>Let LMCache use key 8768</summary><p>This breaks the fixed-chunk addressing contract and does not ensure that all tensors and metadata share the boundary.</p></details>
  <details><summary>Recompute 8704 during store</summary><p>The intermediate evolution is normally gone. Replaying it would also turn a cache write into extra model inference.</p></details>
  <details><summary>Store KV without Mamba state</summary><p>That is not a resumable prefix for a hybrid model. A hit that cannot continue execution is not useful.</p></details>
</div>

Reporting a constraint upward does not make the generic Scheduler depend on LMCache. It sees only one integer capability, `external_store_alignment()`, whose default is 1. Other backends do not need to know LMCache exists.

This is the same pattern as an allocator reporting alignment or a network device reporting MTU: **the consumer declares a constraint; the producer satisfies it while producing the object.**

## 7. Why is this not just an LMCache issue?

Ask who knows each fact:

| Question | Owner |
|---|---|
| Which chunk boundaries can the external store accept? | LMCache connector |
| Where can this model capture a Mamba checkpoint? | SGLang model/scheduler path |
| Which state should the forward pass produce? | Scheduler, before computation begins |

LMCache must report its constraint honestly. SGLang must avoid producing a checkpoint that cannot be persisted through the selected cache path. Neither side can complete the contract alone.

More generally, this is an invariant between a **recurrent-state checkpoint producer** and an **external chunked-store consumer**. Any future backend with a fixed alignment greater than 1 needs the same capability to reach the production point.

## 8. Is the scope reasonable?

The PR changes five focused areas:

- a default capability on the Prefix Cache base class;
- the real `chunk_size` reported by the LMCache-backed cache;
- `lcm`-based alignment in the Scheduler, using an absolute boundary when external alignment exists;
- a fake cache updated for the interface;
- a regression test pinning `8192 + 617 → 8704`.

It does not hard-code an LMCache type check into the Scheduler, and it does not change default behavior for every cache. The new constraint activates only when a backend explicitly reports one.

The PR's [Buildkite #6665 end-to-end validation](https://buildkite.com/sglang/sglang/builds/6665) also exercises a hybrid model: two requests produce identical output, and the second request retrieves from LMCache. That matters because it verifies reusable state, not merely that a store API was called.

## 9. Source map

Read the implementation in this order:

1. [`schedule_batch.py`: choose checkpoint alignment](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/python/sglang/srt/managers/schedule_batch.py#L2634-L2677)
2. [`base_prefix_cache.py`: generic capability default](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/python/sglang/srt/mem_cache/base_prefix_cache.py#L881-L883)
3. [`lmcache_unified_radix_cache.py`: LMCache reports chunk_size](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/python/sglang/srt/mem_cache/storage/lmcache/lmcache_unified_radix_cache.py#L88-L89)
4. [`test_mamba_checkpoint_depth.py`: regression scenario](https://github.com/sgl-project/sglang/blob/6e4771a454b9bb01b365cbdff1d422dff6eaad64/test/registered/unit/managers/test_mamba_checkpoint_depth.py#L99-L110)

## Four-sentence takeaway

1. A Mamba state means “the model's memory after exactly N tokens,” so N cannot be renamed.
2. LMCache uses fixed-size chunk addressing and therefore accepts only certain token boundaries.
3. The correct boundary must be selected before forward; once storage receives the wrong depth, it is too late to repair.
4. LMCache should report its constraint, and the SGLang Scheduler must satisfy it at the state-production point.

That is why the `schedule_batch.py` change is not LMCache detail leaking into the scheduler. It completes a missing cross-layer contract at the only layer where correctness can still be achieved.
