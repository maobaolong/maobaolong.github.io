---
title: "One Line, One Less Hop: How LMCache PR #6062 Sends SGLang KV Cache to the Copy Engine"
description: "A beginner-friendly guide to KV cache, paged memory, NHD/HND layouts, LMCache multiprocess kernel and direct-copy paths, and why one production-code line completes the fast path for SGLang unified MP."
publishedAt: 2026-10-26
category: "AI Infra"
tags:
  - lmcache
  - sglang
  - kv-cache
  - cuda
  - performance
  - multiprocess
author: "Maobaolong"
readingTime: "22 min"
featured: true
draft: false
---

Some performance pull requests change thousands of lines. Others change one production line but require half an inference stack to explain.

[LMCache PR #6062](https://github.com/LMCache/LMCache/pull/6062) is the second kind. Its only production-code addition is:

```cpp
case EngineKVFormat::NL_X_NB_BS_NH_HS:
```

This line does not invent an algorithm or add a CUDA kernel. It tells LMCache that the KV layout used by SGLang unified multiprocess mode can skip the GPU staging buffer and scatter/gather kernel, and can instead be submitted directly to the GPU copy engine as a batch of memory copies.

The short version is: **the data was already copied correctly; now it takes one less detour.**

> This article follows PR head [`efea9f82`](https://github.com/LMCache/LMCache/tree/efea9f8258699bb4827f7bba870971fd70a7cf85) as of October 26, 2026. The H200 numbers below come from the existing direct-copy design document, not from a new SGLang-specific benchmark in #6062.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/kv-cache-primer-en.svg" aria-label="Open the full KV cache and paging primer diagram">
    <img src="/images/blog/lmcache-sglang-direct-copy/kv-cache-primer-en.svg" alt="Beginner diagram from tokens already read to a paged KV cache" />
  </a>
  <figcaption>Figure 1: KV cache is the model's inference notebook. After paging, logically consecutive tokens may live in non-consecutive physical blocks.</figcaption>
</figure>

## 1. Starting from zero: what is KV cache?

When a language model generates the next token, it attends to tokens it has already read. Every attention layer computes a Key and a Value for each historical token. Recomputing all previous Keys and Values after every new token would create more and more duplicate work as the sequence grows.

KV cache saves those results:

```text
read token → compute K/V → store them in KV cache
generate next token → reuse old K/V and compute only the new token
```

Think of KV cache as the model's inference notebook. The model consults notes it has already written instead of rereading the whole book.

That notebook is large. A serving system runs many requests while their caches grow, finish, and release memory. Requiring one continuous GPU allocation per request would quickly fragment memory. Engines such as vLLM and SGLang therefore divide KV cache into fixed-size pages, also called blocks.

A common physical shape is:

```text
[NB, BS, NH, HS]

NB = Number of Blocks
BS = Block Size, or tokens per block
NH = Number of KV Heads
HS = Head Size
```

For example, `[96, 16, 8, 128]` means 96 blocks, 16 tokens per block, 8 KV heads per token, and 128 elements per head.

A request sees logical tokens 0, 1, 2, and so on. The GPU may place them in physical blocks 37, 8, and 52. A block table connects the two views:

```text
logical tokens 0–15   → physical block 37
logical tokens 16–31 → physical block 8
```

That is why LMCache cannot restore a chunk by copying the entire engine KV pool. It must follow block IDs and place each part into the correct page.

## 2. Why does LMCache move KV cache?

LMCache extends an inference engine's local GPU KV cache into CPU memory, storage, or a remote cache. When a shared prefix appears again, the engine can retrieve previously computed KV instead of repeating the full prefill.

In multiprocess mode, the two directions can be simplified as:

- **STORE / D2H:** gather data from the engine's paged GPU KV cache into an LMCache pinned-host object.
- **RETRIEVE / H2D:** read an LMCache object and scatter it back into the engine's selected GPU blocks.

H2D versus D2H is not the hard part. The hard part is that the two sides use different memory organizations: LMCache objects follow continuous tokens, while the engine cache follows scattered pages.

## 3. The general route: staging copy plus block-transfer kernel

The most flexible solution uses two steps:

```text
Pinned host object
    ⇅ cudaMemcpyAsync
GPU staging buffer
    ⇅ block-transfer CUDA kernel
Engine paged KV cache
```

For retrieve, LMCache first copies the continuous object into a GPU staging buffer. A CUDA kernel then reads block IDs and scatters staging tokens into paged blocks. Store performs the reverse gather.

This route supports complex layouts. Even when the byte order inside an engine block differs from LMCache's token-major object order, a kernel can calculate every token/head address and perform the required reordering.

The costs are also clear:

- a temporary GPU buffer;
- two movement stages for the same data;
- a CUDA kernel launch;
- SM usage that can compete with model prefill and decode work.

## 4. The shorter route: copy directly into every page

[PR #5308](https://github.com/LMCache/LMCache/pull/5308) added a direct-copy path for LMCache-driven transfer. The CPU resolves each source address, destination address, and length, then submits many copies with one `cudaMemcpyBatchAsync` call:

```text
Pinned host object
    ⇅ cudaMemcpyBatchAsync
Engine paged KV blocks
```

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/transfer-paths-en.svg" aria-label="Open the kernel versus direct-copy path comparison">
    <img src="/images/blog/lmcache-sglang-direct-copy/transfer-paths-en.svg" alt="Comparison between the LMCache kernel path and direct-copy path" />
  </a>
  <figcaption>Figure 2: Direct copy is not a faster kernel. It removes the staging buffer and kernel, then submits a DMA batch to the copy engine.</figcaption>
</figure>

Two GPU resources matter here:

- **Streaming Multiprocessors (SMs)** execute CUDA kernels and are also used by model computation.
- **Copy engines** perform DMA and can overlap with some computation.

Direct copy does not reduce the final byte count. It removes an intermediate landing point and the scatter/gather kernel.

There is a hard requirement: **each paged block must be one continuous byte range in the same token-major order used by the LMCache object.** Only then can one memcpy entry represent “copy this block” without a reordering kernel.

This is why NHD versus HND matters:

```text
NHD: [Block Size, Num Heads, Head Size]
     all tokens of a block are laid out together → one contiguous copy

HND: [Num Heads, Block Size, Head Size]
     token-oriented transfer may be split across heads → not always one copy
```

Direct copy is not a user policy knob. LMCache selects it automatically when the build, driver, and every kernel group in the object group qualify; otherwise it safely falls back to the kernel route. CUDA needs runtime and driver support for the CUDA 12.8 batch-copy API. The ROCm/HIP route additionally requires an explicit opt-in and host-pointer capability checks.

## 5. What SGLang unified MP changes

SGLang's unified KV cache lets different cache components share one management framework. For ordinary MHA, K and V remain separate physical allocations. Unified MP registration flattens them into a list of independent tensors.

Traditional SGLang MP representation looks like:

```text
[
  [K_layer0, K_layer1, ...],
  [V_layer0, V_layer1, ...],
]
```

Unified MP exposes:

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

Every component is an `[NB, BS, NH, HS]` tensor. LMCache describes it with `EngineKVFormat::NL_X_NB_BS_NH_HS`, enum value 18.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/unified-layout-en.svg" aria-label="Open the SGLang unified component layout diagram">
    <img src="/images/blog/lmcache-sglang-direct-copy/unified-layout-en.svg" alt="Traditional grouped SGLang K and V lists compared with the unified MP component list" />
  </a>
  <figcaption>Figure 3: Each format-18 list entry is an independently allocated K or V component. NL counts registered entries here; it need not equal the model's logical layer count.</figcaption>
</figure>

The format name is easier to read with two rules:

- `_` separates dimensions inside one tensor.
- `_X_` separates levels across a Python list.

Therefore, `NL_X_NB_BS_NH_HS` means “a list whose tensors each have shape `[NB, BS, NH, HS]`.”

Most importantly, format 18 treats every K or V component as an independent entry, so its `kv_size` is 1. There is no additional K/V axis to address inside the tensor.

## 6. Why one `case` is enough

The direct-copy executor does not want to branch on the layout for every copy entry. It calls `resolve_block_addressing()` once and converts a format into this affine recipe:

```text
address = base
        + kv × kv_stride
        + layer × layer_stride
        + block_id × block_stride
```

PR #6062 adds format 18 to an existing group:

```cpp
case EngineKVFormat::NL_X_NB_BS_HS:
case EngineKVFormat::NL_X_NBBS_ONE_HS:
case EngineKVFormat::NL_X_NB_BS_NH_TWO_HS:
case EngineKVFormat::NL_X_NB_BS_NH_CS:
case EngineKVFormat::NL_X_NB_BS_NH_HS:  // added
  out = {B::kPerLayer, 0, 0, blk, tight};
  return true;
```

`{B::kPerLayer, 0, 0, blk, tight}` means:

| Field | Value | Meaning |
|---|---:|---|
| base | `kPerLayer` | use each component's own base pointer |
| KV stride | `0` | there is no extra K/V plane inside a tensor |
| layer stride | `0` | components do not need a fixed stride; every entry has its own pointer |
| block stride | `blk` | block `b` begins at `base + b × blk` |
| copy bytes | `tight` | copy `BS × NH × HS × element_size` bytes |

The actual format-18 formula is therefore simple:

```text
block_address(component, b)
  = component_base_pointer
  + b × BS × NH × HS × element_size
```

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-sglang-direct-copy/one-line-unlock-en.svg" aria-label="Open the one-line direct-copy unlock diagram">
    <img src="/images/blog/lmcache-sglang-direct-copy/one-line-unlock-en.svg" alt="How one new EngineKVFormat case enables both eligibility and runtime address resolution" />
  </a>
  <figcaption>Figure 4: The same resolver acts as the eligibility table and the runtime stride recipe, so one case both opens the gate and tells the executor how to copy.</figcaption>
</figure>

Why did the missing line not corrupt data before this PR? The existing block-transfer kernel already handled format 18 in `calculate_engine_global_offset()`. What was missing was the direct-copy address table, not basic transfer support.

The behavior before and after is:

```text
Before: format 18 → direct copy does not recognize it → kernel fallback
        → correct, but with an extra hop

After:  format 18 → valid BlockAddressing → batched memcpy
        → correct, with a shorter path
```

## 7. Why the tests are much longer than the production change

The danger in table-driven code is that a line can look obvious while falsely declaring a layout contiguous. A wrong address formula may not produce a clean exception; it may silently corrupt KV cache.

PR #6062 therefore adds two GPU test layers:

1. **Native executor parity:** construct a format-18 `[NB, BS, NH, HS]` geometry and compare direct copy against the kernel reference in both store and retrieve directions, bit for bit. The eligibility table is checked too.
2. **Planner end-to-end parity:** create a real `GPUCacheContext` with `EngineType.SGLANG` and `kv_list_layout=unified`, verify that detection produces format 18, then exercise both routes through the public `transfer_kv_per_object_group()` entry point.

The planner test also covers `skip_first_n_tokens`. During retrieve, this protects prefix GPU blocks shared through APC and potentially read by other requests from being overwritten.

The test-to-production ratio is not waste. The tests prove that this one-line eligibility declaration satisfies its hidden memory-contiguity contract.

## 8. How to think about performance

Direct copy is not universally faster. Every `(kv, layer, block)` needs a batch entry, and CPU submission has a cost. The existing H200 design measurements estimate roughly 0.6 microseconds per entry and a break-even point near 34 KB per entry. Blocks as small as 4 KB or 16 KB can lose to the kernel path.

The path is most attractive when:

- blocks are large;
- the block count is small;
- GPU SMs are busy with prefill or decode;
- each physical block is contiguous in the same token-major order.

The original direct-copy work reduced a 128k-token store for Kimi Linear's 1.1 MB blocks from 26.6 ms to 19.7 ms per rank. That explains why the framework exists, but it is **not a performance result for #6062 or for SGLang format 18**. This PR contributes path coverage and bit-exact correctness tests, not a new SGLang benchmark.

## 9. The entire PR in four sentences

1. Once KV cache is paged, LMCache must gather or scatter according to a block table.
2. The general kernel route supports every layout but adds a staging buffer and CUDA kernel.
3. SGLang unified MP format 18 is a token-major, block-contiguous `[NB, BS, NH, HS]` layout, so it qualifies for direct copy.
4. `resolve_block_addressing()` is both the eligibility test and the address recipe; one new `case` lets the existing framework select the shorter copy-engine route automatically.

That is how a pull request with one production line can still touch KV cache, paging, tensor layouts, CUDA copy engines, multiprocess planning, and a serious correctness contract.

## References

- [LMCache PR #6062: Support direct copy in mem kernel](https://github.com/LMCache/LMCache/pull/6062)
- [Direct-copy design document](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/docs/design/v1/multiprocess/lmcache_driven_transfer_copy_paths.md)
- [`resolve_block_addressing()`](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/csrc/cuda/mp_mem_kernels.cu#L697-L733)
- [SGLang KV format detector](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/lmcache/v1/gpu_connector/kv_format/detectors/sglang.py)
- [Python spec for format 18](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/lmcache/v1/gpu_connector/kv_format/specs/nl_x_nb_bs_nh_hs.py)
- [Planner GPU parity tests](https://github.com/LMCache/LMCache/blob/efea9f8258699bb4827f7bba870971fd70a7cf85/tests/v1/multiprocess/test_direct_copy_planner_gpu.py)

