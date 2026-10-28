---
title: "When One vLLM Block Is No Longer One KV Page: LMCache PR #6019 Explained"
description: "A beginner-friendly explanation of KV cache blocks, kernel pages, why LMCache confused kernel paging with compression, how cache hits could silently restore the wrong KV, and how PR #6019 fixes every MP transfer path with num_blocks, k detection, and block-to-page expansion."
publishedAt: 2026-10-29
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - kv-cache
  - multiprocess
  - flashinfer
  - correctness
author: "Maobaolong"
readingTime: "24 min"
featured: true
draft: false
---

Much of the KV-cache stack relies on an assumption that feels natural: when vLLM provides a block ID, the same number can index the first dimension of the KV tensor.

That assumption is valid for many backends. It breaks when an attention kernel uses pages smaller than vLLM's configured block: **one engine block ID then covers multiple consecutive tensor pages**. If LMCache still treats a block ID as a page ID, the index can remain perfectly valid while pointing at the wrong KV. The second request appears to hit the cache, yet the model reads displaced history.

This is the correctness bug addressed by [LMCache PR #6019](https://github.com/LMCache/LMCache/pull/6019). This article is based on head `e2b0bf4d` as of 2026-10-29. Rather than walking through the diff line by line, it builds the concepts, coordinate systems, misclassification, fix boundary, and compatibility behavior from first principles.

<div class="kp-callout"><strong>In one sentence:</strong> scheduling and chunk control remain in engine block IDs; only when the code reads or writes a tensor does it expand each block ID into every kernel page ID behind it.</div>

## 1. Starting from zero: why KV cache uses blocks

When a language model produces a new token, attention needs the Keys and Values of earlier tokens. Recomputing all of that history on every decode step would be wasteful, so inference engines keep those intermediate states in GPU memory as the KV cache.

Requests have different lengths and finish at different times. Reserving one large contiguous allocation per request would waste memory. vLLM therefore divides the KV-cache pool into fixed-size blocks and uses a block table to map logical tokens to physical allocations:

```text
tokens 0..127    -> engine block 3
tokens 128..255  -> engine block 7
```

The numbers `3` and `7` are not token positions. They are physical block IDs in the KV pool. LMCache receives the same kind of ID list for STORE and RETRIEVE.

Four terms must remain distinct:

<dl class="kp-glossary">
  <div><dt>token</dt><dd>One logical position in the input or generated sequence.</dd></div>
  <div><dt>engine block</dt><dd>The allocation unit used by the vLLM scheduler and block table, named by a block ID.</dd></div>
  <div><dt>kernel page</dt><dd>The physical page used by the attention backend to address the KV tensor; it may be smaller than an engine block.</dd></div>
  <div><dt>slot</dt><dd>A place in the KV tensor that can hold one token's state. Physical layout determines the number of slots per page.</dd></div>
</dl>

In the simplest case, the concepts align: one engine block covers 128 tokens, one tensor page has 128 slots, and `block ID == page ID`.

## 2. Where the mismatch comes from

`--block-size 128` says that one scheduler block covers 128 tokens. It does not guarantee that every attention kernel can use a 128-token page. A backend may support only a smaller kernel block size.

In the PR's A10 reproduction, FlashInfer pages at no more than 64 tokens. Therefore:

```text
tokens_per_block  = 128
slots_per_page    = 64
k                 = 128 / 64 = 2 pages per engine block
```

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-kernel-paging/two-coordinate-systems-en.svg" aria-label="Open the two-coordinate-system diagram">
    <img src="/images/blog/lmcache-kernel-paging/two-coordinate-systems-en.svg" alt="One 128-token engine block maps to two 64-slot kernel pages" />
  </a>
  <figcaption>Figure 1: The scheduler sees engine blocks; the transfer kernel sees tensor pages. Their IDs match only when k = 1.</figcaption>
</figure>

In general, engine block `b` covers:

<div class="kp-equation">pages(b) = [b × k, b × k + 1, …, b × k + k − 1]</div>

With `k = 2`, `[3, 7]` must become `[6, 7, 14, 15]`. It must not remain `[3, 7]`.

<figure class="kp-animation" data-kp-animation="mapping" data-step="0">
  <div class="kp-animation__head"><h3>Animation 1: the wrong and right way to address the same blocks</h3><span class="kp-step-label" data-kp-label>1 / 4</span></div>
  <p class="kp-animation__copy" data-kp-copy></p>
  <div class="kp-stage">
    <p class="kp-lane-label">engine block ids</p><div class="kp-block-row"><div class="kp-block" data-engine-block>block 3</div><div class="kp-block" data-engine-block>block 7</div></div><div class="kp-map-arrow"></div>
    <p class="kp-lane-label">tensor page ids</p><div class="kp-page-row"><div class="kp-page" data-page="2">page 2</div><div class="kp-page" data-page="3">page 3</div><div class="kp-page" data-page="6">page 6</div><div class="kp-page" data-page="7">page 7</div><div class="kp-page" data-page="8">page 8</div><div class="kp-page" data-page="13">page 13</div><div class="kp-page" data-page="14">page 14</div><div class="kp-page" data-page="15">page 15</div></div>
    <div class="kp-result" data-kp-result data-step0="<strong>Input:</strong> [3, 7] is still in scheduler coordinates." data-step1="<strong>Old path:</strong> index pages 3 and 7 directly, moving two pages from the wrong positions." data-step2="<strong>New path:</strong> expand with k = 2 to [6, 7, 14, 15]." data-step3="<strong>Result:</strong> gather / scatter moves all four pages behind the two engine blocks."></div>
  </div>
  <ol class="kp-steps"><li>vLLM sends block IDs [3, 7]. They describe two 128-token engine blocks, not two indices into the tensor's first dimension.</li><li>The old path treated 3 and 7 as page IDs. Both indices were valid, so the corruption could remain silent.</li><li>PR #6019 detects k = 2 and expands each block into consecutive pages: [3, 7] → [6, 7, 14, 15].</li><li>The transfer kernel finally receives page coordinates and moves the complete four-page representation of both blocks.</li></ol>
  <div class="kp-animation__controls"><button class="kp-control" type="button" data-kp-prev aria-label="Previous step">‹</button><button class="kp-control" type="button" data-kp-play aria-label="Play or pause">▶</button><button class="kp-control" type="button" data-kp-next aria-label="Next step">›</button><div class="kp-dots" data-kp-dots></div></div>
  <figcaption>The dangerous part is that the wrong IDs are still valid. This is silent corruption, not necessarily a crash.</figcaption>
</figure>

## 3. Why the old code mistook paging for compression

LMCache already had to model a different situation: **slot compression**. An engine block might represent 128 logical tokens while the tensor truly stores only 64 slots for it. In that case, `tokens_per_block > slots_per_block` really does imply a compression ratio.

Kernel paging looks similar if only one page is inspected: the page has 64 slots while the engine block represents 128 tokens. The missing 64 slots were not compressed away, however. They live in the next page.

```text
slot compression:  N engine blocks -> N tensor pages, each page has fewer slots
kernel paging:     N engine blocks -> N × k tensor pages, k pages tile one block
```

The old LMCache logic primarily inferred compression from `tokens_per_block` and the slots in one page. It did not know the number of blocks allocated by vLLM, so it could not validate the crucial whole-tensor relationship.

That produced three outcomes:

- the CUDA-default LMCache-driven path interpreted the extra pages as compressed slots, moved only `1/k` of a chunk, and used block IDs as page indices;
- the engine-driven single-group path made the same silent mistake;
- the engine-driven multi-group path classified the group as compressed and rejected it at startup.

The first two were more dangerous: inference still returned text, but a cache hit no longer matched the cold request.

## 4. The missing observation: carry `num_blocks` in registration

To distinguish compression from paging, LMCache needs four facts at once:

1. the number of physical pages in the tensor;
2. the number of block IDs allocated by the engine;
3. the number of slots in one page;
4. the number of logical tokens covered by one engine block.

The PR adds `num_blocks` to `EngineGroupInfo`. vLLM fills it from `KVCacheConfig.num_blocks`. Connector-owned auxiliary pools are not part of that block-ID space and continue to report `0`.

The protobuf field is the new field 7, and the msgspec structure gives it a default of `0`. Older senders that omit it remain decodable; `0` explicitly means "unreported."

The detection rule is:

<div class="kp-equation">if engine_num_blocks &gt; 0
and tensor_pages % engine_num_blocks == 0:
    k = tensor_pages / engine_num_blocks
    kernel_paged = (k &gt; 1 and slots_per_page × k == tokens_per_block)
else:
    k = 1  # compatibility fallback</div>

This is stronger than guessing from a small page. Both the count relationship and the capacity relationship must close exactly.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-kernel-paging/detection-and-transfer-en.svg" aria-label="Open the detection and transfer-boundary diagram">
    <img src="/images/blog/lmcache-kernel-paging/detection-and-transfer-en.svg" alt="Registration detects k, control logic counts blocks, and data movement addresses pages" />
  </a>
  <figcaption>Figure 2: the PR does not convert the entire system to page coordinates. It converts once, at the boundary that actually indexes tensors.</figcaption>
</figure>

## 5. The key design choice: do not expand too early

The fix is not “multiply every block count by k.” Some operations ask how many engine blocks a request has; others ask which pages a tensor copy must touch. Those questions belong to different coordinate systems.

Operations that remain in engine block IDs include:

- the number of blocks in an LMCache chunk;
- block-list underflow checks;
- all-null chunk detection;
- the number of chunks in a retrieve window;
- cross-group chunk alignment.

Only when gather or scatter is about to index the tensor's first dimension does the code call `expand_block_ids_to_pages`:

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

This boundary has two useful properties. A normal `k = 1` backend retains the old behavior exactly. And chunk, window, null-mask, and multi-group synchronization retain the scheduler's semantics instead of inventing additional logical chunks simply because physical paging is finer.

## 6. Why several transfer paths had to change

LMCache MP does not have a single copy entry point. The PR covers:

- LMCache-driven store and retrieve;
- engine-driven synchronous store, asynchronous store, and retrieve;
- single-group and multi-group models;
- inline and shared-memory transports.

The single-group path is particularly easy to miss. It bypasses much of `KVLayerGroupsManager` to reduce overhead. The PR therefore detects `k` separately in single-group registration, registers the correct number of pages per chunk, and expands IDs in the sync store, async store, and retrieve entry points.

<figure class="kp-animation" data-kp-animation="paths" data-step="0">
  <div class="kp-animation__head"><h3>Animation 2: how the fix crosses the transfer pipeline</h3><span class="kp-step-label" data-kp-label>1 / 4</span></div>
  <p class="kp-animation__copy" data-kp-copy></p>
  <div class="kp-stage">
    <div class="kp-paths"><div class="kp-path" data-path-step="0"><b>1 · Register</b><span>EngineGroupInfo.num_blocks → detect k</span></div><div class="kp-path" data-path-step="1"><b>2 · Chunk control</b><span>count engine block IDs</span></div><div class="kp-path" data-path-step="2"><b>3 · Expand</b><span>[3, 7] → [6, 7, 14, 15]</span></div><div class="kp-path" data-path-step="3"><b>4 · Copy</b><span>gather / scatter tensor pages</span></div></div>
    <div style="margin-top:1.4rem"><p class="kp-lane-label">physical pages moved</p><div class="kp-page-row"><div class="kp-page" data-page="6">6</div><div class="kp-page" data-page="7">7</div><div class="kp-page" data-page="14">14</div><div class="kp-page" data-page="15">15</div></div></div>
  </div>
  <ol class="kp-steps"><li>Registration observes both tensor page count and engine block count, producing kernel_pages_per_block = k.</li><li>Chunking, null masks, and windows continue to operate on original engine block IDs.</li><li>Block IDs are expanded into consecutive page IDs only at the gather / scatter boundary.</li><li>LMCache-driven, engine-driven, single-group, multi-group, sync, async, SHM, and inline paths all move the complete page set.</li></ol>
  <div class="kp-animation__controls"><button class="kp-control" type="button" data-kp-prev aria-label="Previous step">‹</button><button class="kp-control" type="button" data-kp-play aria-label="Play or pause">▶</button><button class="kp-control" type="button" data-kp-next aria-label="Next step">›</button><div class="kp-dots" data-kp-dots></div></div>
  <figcaption>Expansion stays close to data movement instead of leaking into every scheduling operation.</figcaption>
</figure>

## 7. Three details that are easy to misread

### 7.1 `slots_per_block` and `slots_per_engine_block` diverge

The PR keeps the physical slots in one page as `shape_desc.bs` / `slots_per_block` and adds the semantic quantity:

```text
slots_per_engine_block = slots_per_page × kernel_pages_per_block
```

Compression ratios must use the latter. Otherwise two 64-slot pages that fully cover 128 tokens would still look like 2:1 compression.

### 7.2 `calculate_num_blocks` now counts tensor pages

The name can be misleading. For a kernel-paged group, its result is the number of pages the transfer kernel must process. Code that needs engine block count divides by `kernel_pages_per_block`.

### 7.3 A connector-side re-view is not a universal solution

For some known layouts, the connector can zero-copy re-view multiple pages as one logical block. That edit is safe only for layouts it understands. Handling page counts inside LMCache lets every layout supported by the format detector share the same rule without inventing a new shape rewrite for every backend.

## 8. What the validation demonstrates

The PR description reports end-to-end runs on an A10 with vLLM 0.32.0, `--block-size 128`, and LMCache chunk size 256.

| Model / backend | Path | `dev` behavior | PR behavior |
|---|---|---|---|
| Qwen3-8B / FlashInfer | LMCache-driven | cache-hit text changed, no error | identical to cold request |
| Qwen3-8B / FlashInfer | engine-driven | inline hit changed | inline and SHM identical |
| Olmo-3-7B-Think / FlashInfer | LMCache-driven | repeated garbage text | identical to cold request |
| Olmo-3-7B-Think / FlashInfer | engine-driven multi-group | startup rejected compressed group | inline and SHM identical |

FlashAttention controls with `k = 1` retain their previous behavior. Tests also cover detection fallbacks, page expansion, null chunks still counted in blocks, store-to-retrieve round trips, and synchronous and asynchronous single/multi-group entries.

The important lesson is broader than those model names: **a cache hit must not merely return successfully; it must agree with the cold result for the same request.** Exception-only checks cannot detect silent corruption.

## 9. Compatibility boundaries and remaining limits

The fix deliberately preserves several boundaries:

- `num_blocks = 0` means the engine did not report a count. Detection falls back to `k = 1`, preserving old protocols but not magically discovering kernel paging;
- detection requires an integral page-to-block ratio and `slots_per_page × k == tokens_per_block`; otherwise it refuses to guess;
- auxiliary pools do not pretend to belong to vLLM's block-ID pool and therefore leave `num_blocks` unset;
- `k = 1` returns the original block-ID list with no new mapping semantics;
- this solves block/page coordinate mismatch, not arbitrary layout, quantization encoding, or recurrent-state inference.

## Summary

PR #6019 is not merely about moving more pages. It makes explicit an abstraction boundary that matching integers had hidden:

```text
engine block IDs carry scheduling semantics
kernel page IDs address tensor storage
```

Reusing the same number is convenient while the mapping is one-to-one. Once `k > 1`, that shortcut becomes a correctness bug. `num_blocks` gives LMCache enough evidence to identify the coordinate system, `kernel_pages_per_block` preserves the ratio, and `expand_block_ids_to_pages` confines conversion to the actual data-movement boundary.

That yields a general systems lesson for KV caches, paged storage, and cross-process GPU transfer: **two layers using the same integer today does not make that integer the same identity.**

Further reading:

- [LMCache PR #6019](https://github.com/LMCache/LMCache/pull/6019)
- [Detailed Explanation of LMCache MP Registration: What Does register_kv_cache Do?](/en/blog/lmcache-register-kv-cache/)
- [vLLM and LMCache KV-Cache Layouts: Same Shape, Different Meaning](/en/blog/vllm-lmcache-kv-cache-layouts/)
