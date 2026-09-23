---
title: "NHD, HND, BLHNC, BLNHC: What KV Layouts Are Chosen by vLLM and LMCache"
description: "From parsing vLLM's KVCacheLayout and the preferences of different attention backends to probing and converting boundaries of LMCache's EngineKVFormat, this system explains why there are multiple KV layouts."
publishedAt: 2026-09-16
updatedAt: 2026-09-18
category: "AI Infra"
tags:
  - vllm
  - lmcache
  - kv-cache
  - attention
  - inference
  - distributed-systems
author: "Maobaolong"
readingTime: "27 min"
featured: true
draft: false
---
If you've recently explored the KV cache code of vLLM or LMCache, you may have encountered these terms: `NHD`, `HND`, `BLHNC`, `BLNHC`.

They may seem like some sort of hardware code, but their essence is quite simple: **the same batch of KV bytes can be traversed in memory either by token first or by head first; whether to place the layer outside first or the block outside first.**

This is important because the KV cache is not an ordinary tensor. It sits at the intersection of several hot paths:

- The attention kernel needs to read and write it with high throughput;
- Tensor parallelism requires slicing it by head or block;
- Prefix cache / HMA needs to place multiple layers and multiple KV groups into the same block allocator;
- External KV systems like LMCache, NIXL, and Mooncake need to transfer it across processes and machines;
- MLA, sparse attention, quantized KV, and hybrid models will change the actual shape of each page.

Thus, the layout name is not an aesthetic choice, but a protocol for whether the "kernel, allocator, and transfer can communicate using the same physical memory."

This article is based on a source code snapshot pulled on 2026-09-16: vLLM [`8be5205`](https://github.com/vllm-project/vllm/tree/8be5205abbabf4c377c603d6c4180a99373f6415), LMCache [`1b7dff2`](https://github.com/LMCache/LMCache/tree/1b7dff2cd83fc634326b5989eb71aa5f05b4f426). If you are reading this article after the source code has continued to evolve, please refer to the current code first.

If you want to build an overall intuition in a few minutes, you can start by watching this narrated explanation. It strings together the following four dynamic images in the order of "axis order, selection timing, disambiguation detection, and conversion cost."

<figure class="video-feature">
  <video controls preload="metadata" poster="/videos/blog/kv-layouts/kv-layouts-explainer-poster.jpg">
    <source src="/videos/blog/kv-layouts/kv-layouts-explainer.mp4" type="video/mp4" />
  </video>
  <figcaption>Video: A 4-minute narrated version that quickly builds an overall intuition of KV layout using dynamic images.</figcaption>
</figure>

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/axis-order-en.svg" aria-label="Open the original dynamic image of KV layout axis order">
    <img src="/images/blog/kv-layouts/axis-order-en.svg" alt="Dynamic image of NHD, HND, BLNHC, BLHNC axis order and continuous access method" />
  </a>
  <figcaption>Figure 1: The white cursor scans according to the physical axis order; the small squares on the right light up according to the continuous access order, distinguishing token-major, head-major, and block-first.</figcaption>
</figure>
## First, Split the Name

The current standard abstraction of vLLM is `KVCacheLayout`. It fixes the logical axes of the KV cache group to:

```text
[L, B, H, N, C]
```

The meanings are:

| Axis | Meaning | Intuition |
|---|---|---|
| `L` | layer | Which layer |
| `B` | block/page | Which paged-attention block |
| `H` | KV head | Which KV head; TP often slices along this axis |
| `N` | tokens/states within a block | The `N` from the old name, which can also be understood as the rows of tokens/states within each block |
| `C` | content | The width of the content for each head/state; it could be `head_dim`, or the content size after K/V packing |

The enum in the source code is written very directly: `LBHNC` corresponds to `[L, B, H, N, C]`, `LBNHC` corresponds to `[L, B, N, H, C]`, `BLHNC` corresponds to `[B, L, H, N, C]`, and `BLNHC` corresponds to `[B, L, N, H, C]`. vLLM also retains compatibility with old names: `NHD -> LBNHC`, `HND -> LBHNC`. This means that what you see today as `NHD/HND` is mostly referring to the **per-layer, within-block** old naming; while `LBNHC/LBHNC/BLNHC/BLHNC` incorporates both layer and block into the complete physical layout. Refer to vLLM's [`KVCacheLayout`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/kv_cache_layout.py#L15-L58) and [`_LAYOUT_COMPAT_ALIASES`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/config/cache.py#L21-L24).

Here’s a table of the four common names:

| Common Name | vLLM Standard Name | Physical Order | More Like Which Access |
|---|---|---|---|
| `NHD` | `LBNHC` | layer -> block -> token/state -> head -> content | token-major, multiple heads of the same token are relatively close |
| `HND` | `LBHNC` | layer -> block -> head -> token/state -> content | head-major, consecutive tokens of the same head are relatively close |
| `BLNHC` | `BLNHC` | block -> layer -> token/state -> head -> content | block-first + token-major |
| `BLHNC` | `BLHNC` | block -> layer -> head -> token/state -> content | block-first + head-major |

The most easily misunderstood aspect here is `N`. It is not the "global dimension of sequence length," but rather the dimension of tokens/states within the paged KV block. A long sequence from a request will be mapped to many `B` by the block table, with each block containing `N` rows.
## Why Are There Multiple KV Layouts?

The shortest answer is: **Different paths want different dimensions to be contiguous.**

Taking an example within a block. Assume `block_size = 16`, `num_kv_heads = 8`, `head_dim = 128`.

The local memory for `NHD` / `LBNHC` looks like this:

```text
token 0: head 0, head 1, ..., head 7
token 1: head 0, head 1, ..., head 7
...
token 15: head 0, head 1, ..., head 7
```

The local memory for `HND` / `LBHNC` looks like this:

```text
head 0: token 0, token 1, ..., token 15
head 1: token 0, token 1, ..., token 15
...
head 7: token 0, token 1, ..., token 15
```

There is no absolute superiority between these two; they simply have different use cases.

If the kernel reads primarily along the token axis, or if it wants to directly flatten `(block, token)` into a contiguous token dimension, then `NHD/LBNHC` is very comfortable. vLLM's FlexAttention explicitly states: it aims to flatten `(B, N)` into a token dimension, and only the stride of `LBNHC` can achieve zero-copy, so it only supports `LBNHC`. vLLM's HPC and TurboQuant backends also choose `LBNHC`. The corresponding source code can be found in [`flex_attention.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/flex_attention.py#L129-L133), [`hpc_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/hpc_attn.py#L321-L322), and [`turboquant_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/turboquant_attn.py#L160-L161).

If the goal is to segment by head, or if one wants the contents of a head's block to be contiguous segments, `HND/LBHNC` is often more suitable. The CPU backend currently only reads head-major block interiors, so it only supports `LBHNC`. The NIXL and Mooncake connectors also prefer `LBHNC` in non-MLA scenarios: NIXL's comment is better transfer performance; Mooncake's comment is heterogeneous TP-safe KV transfer. Refer to [`cpu_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/cpu_attn.py#L67-L70), [`nixl/connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/nixl/connector.py#L141-L158), and [`mooncake_connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/mooncake/mooncake_connector.py#L512-L527).

So why do `BLHNC/BLNHC` exist? Because some models and allocators do not have "a complete KV of the same shape for each layer." Paths like DeepSeek V4 indexer, Dots3 NOTE DSA, and Qwen4 experimental QSA place small index/state sidecar pages next to the main KV/MLA page within the same block allocation. In this case, if `L` is still on the outer layer, it becomes difficult to express mixed page sizes / mixed HNC shapes; placing `B` on the outer layer and `L` inside the block allows for "multiple layer/group pages within a block" to be managed together. vLLM also has this rule when parsing layouts: when multiple KV cache specs have inconsistent `(num_heads, num_states, page_size_bytes)`, only block-compact layout candidates are retained. Refer to [`resolve_kv_cache_layout`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/utils.py#L285-L299), [`DeepseekV4IndexerBackend`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/mla/indexer.py#L239-L248), [`Dots3NotePaddedSparseBackend`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/models/dots3_note/nvidia/attention.py#L696-L700), and [`QSAStateCache`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/models/qwen4_exp/common/qsa_cache.py#L754-L756).

Thus, the question "Why are there so many layouts?" is not because the project enjoys coining terms, but because the KV cache needs to satisfy:

1. Kernel memory access patterns;
2. Tensor parallel / pipeline / heterogeneous TP segmentation methods;
3. Paged allocator and HMA's page overlay methods;
4. External KV transfer segment merging, RDMA registration, and cross-worker compatibility;
5. Model structures: MHA/GQA/MLA, sliding window, sparse sidecar, quantized packed state;
6. Device/backend capabilities: real constraints of kernels like CPU, CUDA, ROCm, FlashInfer, AITER, TRTLLM-gen, etc.
## How Does vLLM Automatically Select?

The selection process of vLLM is now concentrated in the engine core parsing phase, rather than each worker guessing randomly.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/selection-flow-en.svg" aria-label="Open the original dynamic diagram of the vLLM KV layout selection process">
    <img src="/images/blog/kv-layouts/selection-flow-en.svg" alt="Dynamic diagram of vLLM parsing KV cache layout in the engine core" />
  </a>
  <figcaption>Figure 2: The layout is first parsed in the engine core and written into CacheConfig, after which the worker creates the KV cache view according to the resolved layout.</figcaption>
</figure>

The core logic is in `resolve_kv_cache_layout`:

1. Each attention backend reports its supported layouts through `supported_kv_cache_layouts()`, with the order representing preference.
2. If no backend explicitly declares, vLLM uses the default preference: `LBNHC, LBHNC, BLNHC, BLHNC, BHLNC, LHBNC`. This default places the old main behavior corresponding to `NHD/LBNHC` first.
3. When multiple backends are mixed, the intersection is sought; if there is no intersection, the startup fails.
4. If the HNC shape of the KV specs is mixed, it further restricts to block-compact layout.
5. If the user sets `VLLM_KV_CACHE_LAYOUT`, it must be in the candidate set; otherwise, an error is reported.
6. If the connector returns a required/preferred layout, the compatible one is adopted; if incompatible, a warning is issued and it falls back to the first candidate.
7. The final layout is written back to `CacheConfig.kv_cache_layout`, which is then passed to worker allocation.

The source code entry points can be found in [`get_supported_kv_cache_layouts`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/utils.py#L204-L239) and [`resolve_kv_cache_layout`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/utils.py#L254-L322). During actual allocation, vLLM first requests a block of `int8` backing buffer, and then uses `create_kv_cache_views` to create each layer view according to the resolved layout; that is to say, the layout determines the stride/view on the same backing allocation, rather than just a line of string in the log. Refer to [`allocate_kv_cache`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/worker/utils.py#L389-L455).
## Which Combinations Should Be Selected Currently?

The table below lists the "choices/preferences explicitly declared in the source code." By default, when the backend is not declared, it follows the vLLM default preference, which typically falls to `LBNHC/NHD`.

| Scenario | Current Layout Choice | Main Reason |
|---|---|---|
| Ordinary undeclared backend | Default candidate first item `LBNHC`, also known as the old name `NHD` | Maintain main default behavior; backend has no stronger constraints |
| `CPU_ATTN` | `LBHNC` / `HND` | CPU backend only reads head-major block interior |
| FlexAttention | `LBNHC` / `NHD` | Needs to flatten `(B, N)` into token dim; only `LBNHC` allows zero-copy |
| HPC attention | `LBNHC` / `NHD` | Backend explicitly declares only `LBNHC` |
| TurboQuant attention | `LBNHC` / `NHD` | Quantized layout/kernel selects token-major |
| FlashInfer on NVIDIA capability major 10 | `LBHNC`, acceptable `BLHNC` | TRTLLM-gen kernel consumes head-major block interior; outer L/B nesting is not important |
| vLLM B12x backend | `LBHNC`, acceptable `BLHNC` | Also prioritizes head-major and allows block-first variants |
| ROCm native attention | `LHBNC` preferred, `LBHNC` second | HIP native kernel requires K/V group across all blocks; Triton fallback stride-aware |
| ROCm AITER FA | `LBHNC`, `LHBNC`; only keep `LBHNC` when enabling certain connectors | K/V transposes view from content dim; connector needs contiguous blocks |
| ROCm AITER MLA sparse | `LBNHC`, `LBHNC` | AITER MLA sparse accepts both token-major and head-major |
| FlashInfer MLA sparse SM90 | `LBHNC` | This MLA sparse backend explicitly declares head-major |
| Kpool tail state cache | `LBHNC` | Storage-only tail cache selects head-major |
| DeepSeek V4 / V4.1 indexer | `BLHNC`, acceptable `BLNHC` | Indexer page and MLA latent page pack within each block; layer must be inside the block |
| Dots3 NOTE padded sparse | `BLHNC` | Smaller DSA index page and padded MLA/SWA page managed within the same block |
| Qwen4 experimental QSA state | `BLNHC`, acceptable `BLHNC` | QSA pages and main KV pages are side by side within the block |
| NIXL connector, non-MLA | Prefers `LBHNC` | Transfer performance; heterogeneous TP splits by head are more friendly |
| Mooncake connector, non-MLA | Prefers `LBHNC` | Heterogeneous TP-safe KV transfer |
| Offloading connector | `BLHNC` when HiSparse, otherwise `LBHNC` | HiSparse requires block-first; normal offload follows head-major |
| HiSparse connector | `BLHNC` | HiSparse transfer engine directly requires block-first/head-major |
| Hidden-states example connector | `LBNHC` | Wishes to keep hidden states contiguous with tokens; comments also indicate `LBHNC` favors head sharding |
| LMCacheMPConnector | Does not impose preferences on vLLM | LMCache selection respects vLLM's already resolved layout; avoids forcing certain backend layouts that are undeclared but actually dependent |

The code entries for this table mainly reside in the `supported_kv_cache_layouts()` or `get_required_kvcache_layout()` of each backend/connector: for example, [`flashinfer.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/flashinfer.py#L542-L549), [`rocm_attn.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/rocm_attn.py#L261-L267), [`rocm_aiter_fa.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/v1/attention/backends/rocm_aiter_fa.py#L927-L931), [`offloading_connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/offloading_connector.py#L229-L233), [`hisparse/connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/hisparse/connector.py#L194-L196), [`example_hidden_states_connector.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/example_hidden_states_connector.py#L605-L610).

There are two important points in this table.

First, the preferences of the `connector` do not always override the `attention backend`. The logic of vLLM is that connector preference is only adopted when compatible with the candidate set; incompatibility will fall back. This avoids forcing external KV systems to select layouts that the kernel cannot read for the sake of transport convenience.

Second, MLA is often a special case. NIXL and Mooncake will return `None` when `use_mla` is enabled, allowing vLLM to revert to the backend/default choice; because the KV form of MLA is usually not the traditional `[K,V] x heads x tokens x head_dim`, the trade-offs between head/token are not entirely the same.
## Why is there another EngineKVFormat in LMCache?

The `KVCacheLayout` of vLLM answers: **What is the physical stride order of this KV cache backing allocation?**

The `EngineKVFormat` of LMCache answers: **What does the KV cache container actually look like that a serving engine hands over to LMCache?**

These two are not at the same level of abstraction.

For example, vLLM might pass each layer of KV as a list:

```text
NL x [2, NB, BS, NH, HS]     # vLLM flash-attn NHD
NL x [NB, 2, BS, NH, HS]     # vLLM flash-infer NHD
NL x [NB, BS, NH, CS]        # unified KV cache, K/V packed
```

TRT-LLM might be a cross-layer pool:

```text
[NB, NL, 2, NH, BS, HS]
```

SGLang MHA might have a nested structure of `[K_list, V_list]`.

LMCache cannot just ask, "Are you HND or NHD?" It also needs to know:

- Is it a single tensor, a per-layer list, or a nested list of `[K_list, V_list]`?
- Are K/V explicitly on axis `2`, or packed into the content dimension?
- Is it cross-layer or per-layer?
- Is it a special structure like MLA, MHA, DSA indexer, or RBLN singleton-axis?
- Can HND/NHD be inferred from the tensor shape, or only from stride/hint?

Thus, LMCache consolidates them into `EngineKVFormat`. The table in the documentation is quite long, with the core examples being:

| EngineKVFormat | Engine/Path | Layout | Structure |
|---|---|---|---|
| `NL_X_TWO_NB_BS_NH_HS` | vLLM flash-attn | NHD | `NL x [2, NB, BS, NH, HS]` |
| `NL_X_TWO_NB_NH_BS_HS` | vLLM flash-attn | HND | `NL x [2, NB, NH, BS, HS]` |
| `NL_X_NB_TWO_BS_NH_HS` | vLLM flash-infer | NHD | `NL x [NB, 2, BS, NH, HS]` |
| `NL_X_NB_TWO_NH_BS_HS` | vLLM flash-infer | HND | `NL x [NB, 2, NH, BS, HS]` |
| `NL_X_NB_BS_NH_CS` | vLLM blocks-first fused | NHD | `NL x [NB, BS, NH, CS]` |
| `NL_X_NB_NH_BS_CS` | vLLM blocks-first fused | HND | `NL x [NB, NH, BS, CS]` |
| `NB_NL_TWO_BS_NH_HS` | vLLM cross-layer | NHD | `[NB, NL, 2, BS, NH, HS]` |
| `NB_NL_TWO_NH_BS_HS` | TRT-LLM cross-layer | HND | `[NB, NL, 2, NH, BS, HS]` |
| `TWO_X_NL_X_NB_BS_NH_HS` | SGLang MHA via MP daemon | NHD | `[K_list, V_list]`, each layer `[NB, BS, NH, HS]` |
| `NL_X_NBBS_ONE_HS` | SGLang MLA | MLA | `NL x [page_buffer_size, 1, HS]` |

The design document of LMCache explicitly requires that `normalize_kv_and_discover_format` is the only entry point for parsing: it returns `(EngineKVFormat, normalized_kv_caches)`, and subsequent pointers, shape descriptions, and kernel dispatches query format facts, rather than guessing by shape at each call point. Refer to LMCache's [`layout-invariant.md`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/docs/design/v1/gpu_connector/layout-invariant.md#L6-L15) and the format map [`#L145-L161`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/docs/design/v1/gpu_connector/layout-invariant.md#L145-L161).

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/lmcache-detection-en.svg" aria-label="Open the original dynamic diagram of LMCache KV format detection">
    <img src="/images/blog/kv-layouts/lmcache-detection-en.svg" alt="Dynamic diagram of LMCache disambiguating raw tensor and resolved layout hint" />
  </a>
  <figcaption>Figure 3: LMCache relies on both the shape/stride/nesting of the raw tensor and the resolved layout hint from vLLM; when the shape is ambiguous, the hint is responsible for disambiguation.</figcaption>
</figure>
## Can LMCache Automatically Detect?

Yes, but it's not magic.

The detection process of LMCache consists of three steps:

1. `attempt_permute_to_contiguous_view` first tries to restore the physical dimensions using stride information. For example, the HND physical layout of vLLM may be exposed as a logical NHD view; LMCache will perform a metadata-only `permute` sorted by stride size, without copying storage.
2. `detect_format` finds the corresponding detector based on the serving engine.
3. The vLLM detector then combines `layout_hints["kv_layout"]` and the container structure to return the specific `EngineKVFormat`.

This is also why the vLLM integration of LMCache queries the already resolved layout of vLLM during registration, passing `LBNHC -> NHD`, `LBHNC -> HND`, and `BLHNC/BLNHC` directly to LMCache. Refer to [`vllm_layout_hints`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/utils.py#L43-L49) and [`translate_vllm_kv_cache_layout`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/utils.py#L52-L75).

Why are hints still needed? Because some shapes cannot be distinguished solely by rank/shape. The vLLM detector in the rank-4 fused K/V path states clearly: whether the middle two axes are `NH/BS` or `BS/NH` may not be distinguishable just by looking at the shape; it must rely on the resolved `kv_layout` for judgment. The difference between `BLHNC/BLNHC` also requires checking stride(0). Refer to [`detectors/vllm.py`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/v1/gpu_connector/kv_format/detectors/vllm.py#L51-L72).

So it can be understood like this:

| Question | vLLM | LMCache |
|---|---|---|
| Who decides what physical layout the local KV cache uses? | vLLM engine core | Does not decide, respects the engine |
| Can it automatically choose? | Yes, based on backend/support/env/connector resolution | Does not choose for vLLM, only automatically recognizes the engine format of registered KV |
| Is a hint needed? | Users can enforce via `VLLM_KV_CACHE_LAYOUT` | Needs engine hints for shape ambiguity, TRT-LLM reshape, SGLang folded dimension, etc. |
| What if detection fails? | If the layout is not in the candidate set, it will fail | Unsupported structure/layout will throw an error |

A particularly noteworthy design choice is that LMCache's own `LMCacheMPConnector` does not impose a required layout on vLLM. Its comments state that connector preference has a higher priority than the default value in vLLM resolution, but if certain backends have not declared their layout dependencies, a forced preference by the connector may lead to silent layout reading errors by the backend. LMCache chooses to handle all resolved layouts rather than making choices for vLLM. Refer to [`lmcache_mp_connector.py`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/lmcache_mp_connector.py#L1368-L1382).
## Can these layouts be converted to each other?

There are four cases to consider.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/kv-layouts/conversion-map-en.svg" aria-label="Open the original dynamic image of KV layout conversion costs">
    <img src="/images/blog/kv-layouts/conversion-map-en.svg" alt="Dynamic classification of KV layout conversion costs" />
  </a>
  <figcaption>Figure 4: Breaking down "conversion" into four categories: metadata-only view, real data rearrangement, semantic translation, and fragmented layouts not supported by the current transfer kernel.</figcaption>
</figure>

**First case: Conversion of just the view, with low cost.**

If the actual physical layout of the same storage is already HND, and only a logical NHD view is provided at a higher level, then permuting back to the physical shape by stride is metadata-only. The `attempt_permute_to_contiguous_view` in LMCache does this: it sorts dimensions and returns a view of shared storage, explicitly not falling back to `.contiguous()`. Refer to [`contiguity.py`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/v1/gpu_connector/kv_format/contiguity.py#L43-L73).

**Second case: Real data rearrangement, with high cost.**

If you really need to rearrange the bytes from `[B, H, N, C]` to `[B, N, H, C]`, that involves large-scale KV transposition. KV caches can easily reach GB sizes, and this should not be a normal hot path. The NIXL receive path in vLLM has some specific post-processing, such as the experimental `enable_permute_local_kv`, which supports remote `LBHNC` to local `LBNHC` extra permutation, and can also handle block size ratios; however, this is specific to heterogeneous P/D/TP scenarios, not a general "layout can be converted freely." Refer to [`nixl/base_worker.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/v1/nixl/base_worker.py#L2458-L2482) and the postprocess helper [`utils.py`](https://github.com/vllm-project/vllm/blob/8be5205abbabf4c377c603d6c4180a99373f6415/vllm/distributed/kv_transfer/kv_connector/utils.py#L295-L314).

**Third case: Semantic translation, not physical conversion.**

Converting `NHD -> LBNHC` and `HND -> LBHNC` is merely aligning old and new naming conventions. LMCache translates vLLM's `LBNHC/LBHNC` into its own `NHD/HND` hints, which is simply mapping the "vLLM standard names" to "LMCache detector-recognized hint names," without altering memory.

**Fourth case: Failure when not supported.**

For example, layouts like `LHBNC` and `BHLNC`, which are head-outermost layouts, will split the content of each block into multiple segments by head. The current LMCache vLLM integration only supports `NHD/HND/BLHNC/BLNHC`, and encountering `LHBNC/BHLNC` will raise a `NotImplementedError`. The reason is that transfer kernels currently process each `(layer, block)` as a contiguous run, and head-outermost layouts will fragment. Refer to [`translate_vllm_kv_cache_layout`](https://github.com/LMCache/LMCache/blob/1b7dff2cd83fc634326b5989eb71aa5f05b4f426/lmcache/integration/vllm/utils.py#L70-L75).

The best engineering strategy is: **Choose the right layout before allocating the KV cache; do not expect to convert GB-sized KV caches back and forth after allocation.**
## Key Judgments When Reading Layout

You can look at it through four questions:

1. **Is H before or after N?**  
   `HND/LBHNC/BLHNC` is head-major; `NHD/LBNHC/BLNHC` is token/state-major.

2. **Is L before or after B?**  
   `L*` is layer-compact, commonly found in each layer view; `B*` is block-outermost, often seen in hybrid/sparse/sidecar scenarios where multiple layers/groups need to be placed in the same block allocation.

3. **Are K/V independent axes or packed content?**  
   `[..., 2, ..., HS]` and `[..., CS]` will represent different `EngineKVFormat` in LMCache. `CS` often indicates the content size after K/V fusion.

4. **Does this name come from vLLM or LMCache?**  
   vLLM's `KVCacheLayout` is stride permutation. LMCache's `EngineKVFormat` is an engine-facing container + tensor format. Do not confuse these two levels.

## Final Summary

Behind `NHD/HND/BLHNC/BLNHC`, there are actually three sets of engineering trade-offs:

- **Read/Write Locality**: token-major is more suitable for token flattening, while head-major is better for reading/writing/slicing by head.
- **Allocation Geometry**: layer-first is simple and direct, while block-first is more suitable for mixed pages, hybrid allocation, and sidecar state.
- **System Boundaries**: vLLM needs to allow the attention backend to read; LMCache needs to enable cross-process/cross-device transfer; NIXL/Mooncake aims to stabilize heterogeneous TP and RDMA segments as much as possible.

Therefore, layout should not be viewed as merely "small differences in tensor shape." It is more like a memory protocol: the attention kernel, allocator, KV connector, and external cache server all use it to align their respective coordinate systems.

When you see a PR changing the layout, the real question to ask is not, "Did it change NHD to HND?" but rather:

- Does this backend declare a true support set?
- Does the mixed KV spec require block-compact?
- Will connector preference override kernel constraints?
- Is the layout hint received by LMCache consistent with the resolved layout from vLLM?
- If a conversion occurs, is it a zero-copy view or a hot path data rearrangement?

By clarifying these points, `NHD/HND/BLHNC/BLNHC` will no longer be just four abbreviations, but a map that explains performance, correctness, and cross-system compatibility.
