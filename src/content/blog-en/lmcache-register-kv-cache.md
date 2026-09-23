---
title: "Detailed Explanation of LMCache MP Registration Path: What Exactly Does register_kv_cache Do?"
description: "This article systematically explains why LMCache requires this layer of registration protocol, focusing on the KV cache passed after calling register_kv_caches in vLLM, client handling of the LMCache-driven multiprocess connector, server registration, EngineGroupInfo generation, and the complex model layouts of standard Attention, MLA, DeepSeek, Qwen, and Mamba."
publishedAt: 2026-09-16
updatedAt: 2026-09-18
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - kv-cache
  - multiprocess
  - mla
  - mamba
  - hma
author: "Maobaolong"
readingTime: "35 min"
featured: true
draft: false
---
If you only look at the function name, `register_kv_cache` seems like a very ordinary initialization step: vLLM tells LMCache about the KV cache, and LMCache notes it down for later use.

However, in the multiprocess connector of LMCache, this registration action is actually the "modeling moment" of the entire GPU KV transfer path.

Subsequent actual STORE / RETRIEVE requests typically won't carry the complete tensor structure, nor will they re-guess the shape, dtype, stride, block size, and group relationships of each layer of the KV cache every time. They will only carry lightweight information such as token range, cache key, block id, and event handle. The server can translate this lightweight information into the correct GPU copy because the `register_kv_cache` phase has already established the most important details:

- What KV tensors are present in the vLLM worker;
- How these tensors are exposed to the LMCache server via IPC handles;
- The actual physical layout of each tensor;
- Which layers can share the same transfer kernel;
- How vLLM's block id is grouped by engine group;
- How many logical tokens a block id covers, and how many slots a physical tensor page has;
- Which groups are sliding-window, Mamba recurrent state, or connector private aux pool, and which should not be reused by the prefix cache.

This article only discusses the **LMCache driven** mode: the vLLM worker exports the KV cache's device handle, and the LMCache server directly reads and writes the worker's KV buffer through these handles. The engine driven mode will not be elaborated on here.

This article is based on the review of [LMCache PR #5042](https://github.com/LMCache/LMCache/pull/5042) dated 2026-09-16, with the head being `e3cffcf`, and the title is `[Feature][MP] Support GLM-5.3-Flash and Qwen3.8-Flash-Next`. If the PR continues to evolve, please refer to the current code.

<section id="register-knowledge-map" class="lmcache-knowledge-map" data-lmcache-knowledge-map aria-label="register_kv_cache Knowledge Map">
  <noscript>This was originally a clickable knowledge map: it connects concepts like KV tensor, block id, page size, layout hint, IPC wrapper, EngineGroupInfo, Mamba state, and scratch group. Your current browser has JavaScript disabled, so please continue reading the main text.</noscript>
</section>

<section id="register-scenario-lab" class="lmcache-scenario-lab" data-lmcache-scenario-lab aria-label="register_kv_cache Scenario Interaction Flow">
  <noscript>This was originally a flowchart for the register_kv_cache interaction process that could switch between simple / MLA / hybrid scenarios. Your current browser has JavaScript disabled, so please continue reading the static processes and tables in the main text.</noscript>
</section>

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-register-kv-cache/register-flow-en.svg" aria-label="Open the original register_kv_cache flowchart">
    <img src="/images/blog/lmcache-register-kv-cache/register-flow-en.svg" alt="Flowchart of LMCache driven register_kv_cache from vLLM worker to LMCache server" />
  </a>
  <figcaption>Figure 1: LMCache driven registration path. The client first standardizes the tensor view, generates EngineGroupInfo, and then sends the IPC wrapper and group metadata to the server.</figcaption>
</figure>

<figure class="lmcache-anim lmcache-anim--register" data-lmcache-animation="register" data-step="0">
  <div class="lmcache-anim__header">
    <div>
      <p class="lmcache-anim__kicker">Animation 1</p>
      <h3>The registration path is not a single message send, but a step-by-step modeling of runtime resources</h3>
    </div>
    <div class="lmcache-anim__step-label" data-anim-step-label>Step 1 / 6</div>
  </div>
  <p class="lmcache-anim__note" data-anim-copy>The vLLM worker first obtains the actual KV tensor, KVCacheConfig, and layout hints; all subsequent lightweight STORE / RETRIEVE operations will rely on the contract established during this registration.</p>
  <div class="lmcache-anim__stage register-stage">
    <div class="register-lane register-lane--worker">
      <h4>vLLM worker</h4>
      <div class="register-node is-visible" data-show-from="0" data-highlight-step="0">
        <strong>Input Triplet</strong>
        <span>kv_caches + kv_cache_groups + layout_hints</span>
      </div>
      <div class="register-arrow" data-show-from="1"></div>
      <div class="register-node" data-show-from="1" data-highlight-step="1">
        <strong>Zero-Copy Re-View</strong>
        <span>Change sub-paged / Mamba views into pages that can be transported by block</span>
      </div>
      <div class="register-arrow" data-show-from="2"></div>
      <div class="register-node" data-show-from="2" data-highlight-step="2">
        <strong>EngineGroupInfo</strong>
        <span>Combine vLLM group semantics and actual tensor layout into a protocol</span>
      </div>
      <div class="register-arrow" data-show-from="3"></div>
      <div class="register-node register-node--payload" data-show-from="3" data-highlight-step="3">
        <strong>REGISTER_KV_CACHE Payload</strong>
        <span>DeviceIPCWrapper[] + model/world + layout_hints + group infos</span>
      </div>
    </div>
    <div class="register-boundary">
      <span>IPC Boundary</span>
      <div class="register-packet" data-show-from="3"></div>
    </div>
    <div class="register-lane register-lane--server">
      <h4>LMCache Server</h4>
      <div class="register-node" data-show-from="4" data-highlight-step="4">
        <strong>Import IPC Handles</strong>
        <span>Unwrap into tensor views visible to the server process</span>
      </div>
      <div class="register-arrow" data-show-from="4"></div>
      <div class="register-node" data-show-from="4" data-highlight-step="4">
        <strong>Reproduce Format Discovery</strong>
        <span>Re-detect shape/stride according to the layer index specified by EngineGroupInfo</span>
      </div>
      <div class="register-arrow" data-show-from="5"></div>
      <div class="register-node" data-show-from="5" data-highlight-step="5">
        <strong>Runtime Transfer Resources</strong>
        <span>KVLayerGroupsManager + layout registry + context table</span>
      </div>
    </div>
  </div>
  <div class="lmcache-anim__controls" role="group" aria-label="Registration Path Animation Controls">
    <button type="button" class="lmcache-anim__button" data-anim-prev aria-label="Previous Step">‹</button>
    <button type="button" class="lmcache-anim__button" data-anim-play aria-label="Play or Pause">▶</button>
    <button type="button" class="lmcache-anim__button" data-anim-next aria-label="Next Step">›</button>
    <div class="lmcache-anim__dots" data-anim-dots aria-label="Animation Steps"></div>
  </div>
  <figcaption>This animation corresponds to the four layers of transformation: memory ownership, layout, semantic grouping, and storage object description. Missing any step means the server cannot safely transport based solely on block ids.</figcaption>
</figure>
## 1. Clarifying the Scene

Large model inference is typically divided into Prefill and Decode.

In the Prefill phase, the prompt is read in at once, and the model computes the Key and Value for each token at every layer of attention. The Decode phase continues to generate new tokens, where the attention of the new tokens needs to read historical Keys/Values. If the historical prompt is recalculated at every step, the cost is very high, so the inference engine stores these intermediate results in GPU memory, which is known as the KV cache.

To efficiently manage the KV cache, vLLM divides consecutive tokens into pages, often referred to as blocks. The logical token sequence requested is mapped to a set of block IDs via a block table. Here’s a very common example:

```text
block_size = 16

tokens 0..15    -> block id 10
tokens 16..31   -> block id 11
tokens 32..47   -> block id 25
```

Here, the block ID is not the token ID but rather the page number in the vLLM KV cache pool. The attention kernel finds the corresponding KV page for each token through the block table.

What LMCache needs to do is store these precomputed KV caches in an external caching layer, and when the same prefix is encountered later, retrieve it back to write into vLLM's KV buffer. This raises a question: the KV buffer of vLLM is in the GPU memory of the vLLM process, while the LMCache server is another process. The server cannot know where the tensors in the worker process are located, nor can it guess how to move them during each STORE operation.

Thus, a cross-process contract must be established during the registration phase:

```text
Where are the KV tensors for this batch of layers?
What do they look like?
Which tensor pages should the block IDs sent by vLLM correspond to?
How should the chunks in the LMCache storage object map back to these pages?
```

This is the core value of the `register_kv_cache` path.

## 2. What is Passed to LMCache After vLLM Calls

On the vLLM worker side, the `register_kv_caches` method of the LMCache connector is called. In the current PR code, the entry point is in `lmcache/integration/vllm/lmcache_mp_connector.py`:

```python
def register_kv_caches(self, kv_caches: dict[str, torch.Tensor]):
    kv_cache_config = getattr(self, "_kv_cache_config", None)
    layout_hints = vllm_layout_hints(self._vllm_config)
    kv_caches = apply_kv_cache_group_edits(
        kv_cache_config, kv_caches, layout_hints=layout_hints
    )
    engine_group_infos = create_engine_group_infos_from_vllm(
        kv_cache_config,
        kv_caches,
        layout_hints=layout_hints,
        dcp_size=self._dcp_size,
    )
    self.worker_adapter.register_kv_caches(
        kv_caches,
        engine_group_infos=engine_group_infos,
        layout_hints=layout_hints,
    )
```

The main character being passed in is `kv_caches`:

```python
dict[str, torch.Tensor]
```

The key is the layer name, such as `model.layers.0.self_attn.kv_cache`; the value is the corresponding KV cache tensor for that layer. For some Mamba/linear attention layers, the value may also initially appear as a tensor list like `[conv_state, ssm_state]`, which will later be re-viewed into a page tensor that LMCache can handle after registration edits.

In addition to the actual tensors, LMCache will also read the `KVCacheConfig` from vLLM. The most critical part is `kv_cache_groups`. This group is not arbitrarily defined by LMCache but is defined by the vLLM scheduling side:

```text
KVCacheGroupSpec(
  layer_names=[...],
  kv_cache_spec=...
)
```

The `kv_cache_spec` contains information such as `block_size`, attention type, sliding window size, Mamba cache mode, the number of states in MLA, and whether it is `prefix_cacheable`, among other details. In other words:

- `kv_caches` indicates "what the actual memory looks like";
- `kv_cache_config.kv_cache_groups` explains "how vLLM's scheduling and block IDs understand this batch of memory";
- `layout_hints` indicates what KV layout vLLM has chosen, such as `NHD`, `HND`, `BLNHC`, `BLHNC`.

The first thing `register_kv_caches` does is combine these three pieces of information.
## 3. Who Moves Data in LMCache Driven Mode

The LMCache driven mode can be understood as follows:

```text
vLLM worker:
  I have KV cache GPU memory.
  I package this batch of tensors into IPC handles and send them to the server.

LMCache server:
  I import these handles to obtain tensor views that point to the worker's KV buffer.
  For subsequent STORE operations, I copy from the worker's KV buffer to the LMCache temp buffer/storage.
  For subsequent RETRIEVE operations, I write back from the LMCache temp buffer/storage to the worker's KV buffer.
```

Thus, during the client registration phase, `LMCacheDrivenTransferContext` is created. This context first checks whether the device where the KV cache resides supports event IPC, and then calls the request client:

```python
future = req_client.register_kv_cache(
    instance_id,
    wrap_kv_caches(kv_caches),
    model_name,
    world_size,
    engine_type,
    layout_hints,
    list(engine_group_infos),
)
future.result(timeout=mq_timeout)
```

Note that what is sent here is not the ordinary tensor itself. Cross-process communication cannot directly send Python tensor objects. `wrap_kv_caches(kv_caches)` will package the tensor into a `DeviceIPCWrapper`. This can be understood as "an importable handle for this device memory + reconstruction information such as shape/stride/storage offset."

The payload of the registration request roughly contains the following items:

| Field | Meaning |
|---|---|
| `instance_id` | The current worker instance, generally understood as the registration identity of a GPU worker |
| `kv_cache` | A list of `DeviceIPCWrapper`, which the server uses to import the worker's KV memory |
| `model_name` | Cache key and layout registry must be distinguished by model |
| `world_size` | Part of the parallel configuration, which also affects the cache key and layout |
| `engine_type` | Here it is vLLM, used for server format detection |
| `layout_hints` | vLLM provides layout clues to LMCache |
| `engine_group_infos` | Neutral grouping protocol generated by LMCache from vLLM group + tensor layout |

This is why registration is not merely a "notification." It actually connects the GPU memory of the vLLM worker to the transfer runtime of the LMCache server.

## 4. Client Step One: Why KV Cache Group Edits Must Be Done Before Registration

`apply_kv_cache_group_edits` is a very important background point in PR #5042. It performs **zero-copy re-view**.

Zero-copy means: no copying of KV bytes, only changing the tensor's shape/stride view, allowing LMCache's subsequent format detection and transfer kernel to understand it using the same set of rules.

Why is re-view necessary? Because the block ID granularity on the vLLM scheduling side and the physical page granularity actually used by the worker's attention kernel are sometimes not the same.

The most common attention looks like this:

```text
vLLM scheduler block id 7
        |
        v
worker tensor page 7

shape: [num_blocks, 2, block_size, num_heads, head_size]
```

One vLLM block corresponds to one tensor page. At this point, LMCache can directly look at the tensor shape to know how many token slots are in a page.

<section class="lmcache-deep-anim" data-lmcache-deep-anim="config-slot" aria-label="Figure A: Configuration, page, and slot in ordinary attention">
  <noscript>Figure A: In ordinary attention, block_size determines how many token slots are in a page; page_size_bytes indicates how much memory these slots' K/V vectors occupy.</noscript>
</section>

However, hybrid/MLA/Mamba models break this intuition.

### First, Three Terms: Page Size, Logical Block, Physical Block

The most confusing terms here are `block_size` and `page_size`. In the vLLM KV cache spec, `block_size` refers to "how many tokens/states a block manages"; `page_size_bytes` refers to "how many bytes such a page actually occupies." Therefore, page size is not the number of tokens, but the size of memory.

For ordinary attention, a token's cache roughly contains two vectors, K and V:

```text
one-token attention bytes
  = K/V planes * num_kv_heads * head_size * dtype_size
```

Thus, the attention page size will grow linearly with block size:

```text
32-token attention page  -> 32 * one-token bytes
544-token attention page -> 544 * one-token bytes
```

But Mamba/recurrent layers are different. They do not cache "one row of K/V for each token," but rather a set of recursive state snapshots, such as conv state, SSM state, along with possible padding. The size of a Mamba page is mainly determined by the shapes and dtypes of these state tensors, not simply multiplying the number of attention token rows.

<section class="lmcache-deep-anim" data-lmcache-deep-anim="mamba-state-page" aria-label="Figure B: Comparison of attention page and Mamba state page">
  <noscript>Figure B: The attention page resembles a row of token slots, each containing K/V; the Mamba page resembles a recurrent state snapshot, composed of conv state, SSM state, and padding.</noscript>
</section>

The Mamba-hybrid model has both attention groups and Mamba groups. The vLLM hybrid memory allocator needs to place these groups into the same KV cache grouping, capacity estimation, and block table system, so it hopes to align the `page_size_bytes` of different groups. Here, "alignment" refers to **byte-level page size alignment**, not requiring each group to cover the same number of tokens.

Intuitively, the allocator and scheduler will continuously ask questions like: how many pages can each group still allocate, which page corresponds to the N-th block ID of a request in each group, and how much concurrency can be supported under a given memory budget. If "one page" of different groups represents completely different byte amounts, unified estimation and bookkeeping of block IDs will become very difficult to maintain, and it may even lead to miscalculating the number of pages for a certain group.

<section class="lmcache-deep-anim" data-lmcache-deep-anim="hybrid-align" aria-label="Figure C: Mamba-hybrid page-size alignment">
  <noscript>Figure C: Page-size alignment aligns the byte bookkeeping. If a Mamba state page is approximately equal to 17 attention kernel pages, vLLM may enlarge the attention manager block to 17 * 32 = 544 token slots.</noscript>
</section>

Why would the logical block size of attention be enlarged? Because the bytes of the attention page can be increased by enlarging the block size, while the bytes of the Mamba state page are often already determined by the state shape. Suppose the attention kernel naturally uses a 32-token page, with a size of `X`; the Mamba state page is approximately `17X`. To align the page sizes of the two groups, vLLM can enlarge the attention manager block size from 32 to 544:

```text
natural attention kernel page: 32 tokens  -> X bytes
Mamba state page:              1 state    -> 17X bytes
aligned attention logical page:544 tokens -> 17X bytes
```

Here, two levels emerge:

| Concept | Perspective | Meaning |
|---|---|---|
| logical block / manager block | scheduler, block table, prefix cache, LMCache register payload | The block ID unit recognized by vLLM scheduling and cache management. In the above example, one logical block covers 544 token slots. |
| physical block / kernel page | attention backend kernel, actual worker tensor | The tensor page unit that the kernel actually reads and writes. In the above example, the kernel still accesses 32-token pages. |

Thus, "544-token logical block" does not mean that the FlashAttention kernel suddenly processes a 544-token page at once. More accurately, it means that the scheduling layer of vLLM treats 17 consecutive 32-token kernel pages as the same manager block:

```text
logical block 0
  = physical/kernel pages 0..16
  = 17 * 32 token slots
  = 544 token slots
```

There is a very important configuration constraint: if the `tokens_per_block` of this cacheable group is indeed 544, then the `chunk_size` of LMCache cannot continue to use the default of 256. The current MP path requires that **the LMCache chunk size must be a multiple of the `tokens_per_block` of each cacheable group**, because an LMCache chunk cannot be split in the middle of a vLLM logical block. That is to say:

```text
tokens_per_block = 544
chunk_size = 256   -> Not allowed, should directly report an error during registration
chunk_size = 544   -> Allowed for this group, one LMCache chunk holds 1 logical block
chunk_size = 1088  -> Allowed for this group, one LMCache chunk holds 2 logical blocks
```

If the same model has other cacheable groups, for example, another group with `tokens_per_block` of 64, then `chunk_size` must also be a common multiple of both 64 and 544. The actual configuration usually takes the least common multiple of the positive `tokens_per_block` of all cacheable groups; temporary groups with `prefix_cacheable = False` do not participate in this constraint because `tokens_per_block = 0`.

Thus, the example of `544` does not imply that "the default 256 can also save a 544-token block," but rather indicates that hybrid/page-size alignment may enlarge the minimum cacheable registration granularity. In real deployments, either set the LMCache `chunk_size` to be a common multiple of all cacheable groups' `tokens_per_block`, or the model cannot be correctly registered according to the current MP prefix KV path.

This also answers another common question: is it impossible to save fewer than 544 tokens in LMCache? Under such configurations, **in terms of a complete prefix chunk, yes, a prefix with fewer than one LMCache chunk will not form a reusable complete cache object**. However, this does not mean that the current request cannot decode, nor does it mean that there are no KV in the vLLM GPU memory; it simply cannot be safely accessed as a complete chunk reusable across requests. The reusability granularity of LMCache is determined by `chunk_size`, which must align with the logical block boundaries of the engine group.

<section class="lmcache-deep-anim" data-lmcache-deep-anim="logical-physical" aria-label="Figure D: Logical block and physical kernel page">
  <noscript>Figure D: Block ID is the coordinate of the logical/manager block; the first dimension of the worker tensor may be the coordinate of the physical/kernel page. The re-view before LMCache registration bridges these two coordinate systems.</noscript>
</section>

<figure class="lmcache-anim lmcache-anim--review" data-lmcache-animation="review" data-step="0">
  <div class="lmcache-anim__header">
    <div>
      <p class="lmcache-anim__kicker">Animation 2</p>
      <h3>How 17 Physical/Kernel Pages Become 1 Logical Block</h3>
    </div>
    <div class="lmcache-anim__step-label" data-anim-step-label>Step 1 / 5</div>
  </div>
  <p class="lmcache-anim__note" data-anim-copy>The worker tensor initially counts kernel pages, each page containing only 32 token slots; the vLLM block ID cannot yet be directly used as a 544-token block.</p>
  <div class="lmcache-anim__stage review-stage">
    <div class="review-ruler" aria-label="17 Physical Kernel Pages">
      <span data-review-page="0">0</span>
      <span data-review-page="1">1</span>
      <span data-review-page="2">2</span>
      <span data-review-page="3">3</span>
      <span data-review-page="4">4</span>
      <span data-review-page="5">5</span>
      <span data-review-page="6">6</span>
      <span data-review-page="7">7</span>
      <span data-review-page="8">8</span>
      <span data-review-page="9">9</span>
      <span data-review-page="10">10</span>
      <span data-review-page="11">11</span>
      <span data-review-page="12">12</span>
      <span data-review-page="13">13</span>
      <span data-review-page="14">14</span>
      <span data-review-page="15">15</span>
      <span data-review-page="16">16</span>
    </div>
    <div class="review-label-row">
      <span>Physical pages: 17 × 32 slots</span>
      <strong data-review-slots>0 / 544 slots selected</strong>
    </div>
    <div class="review-merge">
      <div class="review-merge__fill"></div>
      <span>Logical block 0</span>
    </div>
    <div class="review-shapes">
      <code>[N * 17, 2, 32, H, C]</code>
      <span class="review-shapes__operator">view, no copy</span>
      <code>[N, 2, 544, 1, C']</code>
    </div>
    <div class="review-address">
      <span>Block ID 0</span>
      <div>
        <strong>Before</strong>
        <em>May mistakenly point to 32 slots of page 0</em>
      </div>
      <div>
        <strong>After</strong>
        <em>Stably points to 544 slots of pages 0..16</em>
      </div>
    </div>
  </div>
  <div class="lmcache-anim__controls" role="group" aria-label="Re-view Animation Controls">
    <button type="button" class="lmcache-anim__button" data-anim-prev aria-label="Previous Step">‹</button>
    <button type="button" class="lmcache-anim__button" data-anim-play aria-label="Play or Pause">▶</button>
    <button type="button" class="lmcache-anim__button" data-anim-next aria-label="Next Step">›</button>
    <div class="lmcache-anim__dots" data-anim-dots aria-label="Animation Steps"></div>
  </div>
  <figcaption>This animation intentionally does not depict K/V semantics, but rather address semantics: LMCache is concerned with how the same segment of storage is re-labeled as a byte range understandable by vLLM block IDs.</figcaption>
</figure>

This is also why LMCache registration cannot only look at the first dimension of the raw tensor. The first dimension of the raw tensor may count kernel pages, but the block IDs passed down by vLLM belong to the logical block coordinate system. LMCache must first re-view multiple physical pages into one logical page; otherwise, subsequent STORE/RETRIEVE operations will incorrectly map block IDs to byte ranges.

### 1. Sub-paged Attention

With the above concepts, Sub-paged attention is easier to understand: it refers to **a logical attention block on the vLLM scheduling side being split into multiple smaller physical/kernel pages for storage**.

Thus, the worker tensor may look like this:

```text
[num_kernel_pages, 2, 32, num_heads, head_size]
```

Here, `32` is the actual number of kernel page tokens used by the attention backend. However, the block ID given to LMCache by vLLM is still the ID of a 544-token logical block. One logical block actually occupies 17 consecutive kernel pages:

```text
logical block 0 = kernel pages 0..16
logical block 1 = kernel pages 17..33
```

If LMCache directly treats this tensor as a block size of 32, it will misunderstand the block ID coordinate system. The solution is to re-view the 17 kernel pages as 1 logical page:

```text
[num_kernel_pages, 2, 32, H, C]
        |
        | view, no copy
        v
[num_logical_blocks, 2, 544, 1, C']
```

<section class="lmcache-deep-anim" data-lmcache-deep-anim="shape-review" aria-label="Figure E: Dimension-by-Dimension Explanation of Sub-paged Attention Re-view">
  <noscript>Figure E: The core of this re-view is the conservation of the number of elements. 17 kernel pages are merged into 1 logical block; the original head dimension is folded into the new trailing width, so the registered tensor retains only 1 synthetic head.</noscript>
</section>

Breaking it down dimension by dimension:

| Original Dimension | New Dimension | Reason for Change |
|---|---|---|
| `num_kernel_pages` | `num_logical_blocks = num_kernel_pages / 17` | The original first dimension counts 32-token kernel pages. The vLLM block ID counts 544-token logical blocks. Since `544 / 32 = 17`, 17 consecutive kernel pages combine into 1 logical block. Here, `num_kernel_pages` must be divisible by 17. |
| `2` | `2` | This dimension is retained to allow the general KV transfer behind LMCache to still see a rank-5 shape with `kv_size = 2`. Note that after re-viewing, it no longer reliably represents the "pure K plane / pure V plane of the entire logical block." |
| `32` | `544` | The original `32` is the number of token slots in the kernel page; the new `544` is the logical block size recognized by the vLLM scheduler. When LMCache subsequently moves by block id, it needs to see the 544-token block coordinates, not the 32-token kernel page coordinates. |
| `H` | `1` | The original `H` is the actual number of attention heads. However, the goal of this view is not to let LMCache understand the semantics of each head, but to allow the bytes of an entire logical page to be treated as a movable payload. The code uses 1 synthetic head. |
| `C` | `C'` | The original `C` is the width of each head. Since `H` is collapsed to 1, the content originally spread across `H * C` will be packed into the new trailing width. In simple cases, `C' = H * C`; the actual code calculates it using `spec.page_size_bytes / element_size / (2 * 544 * 1)` to ensure the number of elements per page matches exactly. |

So this view is not reinterpreting the mathematical semantics of attention, but establishing an address view of "block id to byte range." It requires the raw tensor to be contiguous; it does not move any bytes but simply marks the same segment of storage with a new shape. As long as STORE and RETRIEVE use the same view, bytes can correctly round-trip. However, this also means that after re-viewing, `kv_caches[:, 0]` can no longer be treated as a pure K tensor for content-aware processing, as K/V may have already been interleaved in this opaque payload at the kernel-page granularity.

### 2. Sub-paged MLA

The MLA cache is typically not a standard K/V with two planes. It resembles a key-only or latent state cache, where one row of state can serve multiple logical tokens. PR #5042 focuses on MLA caches like GLM / Kimi: the worker kernel uses smaller pages, and LMCache needs to combine multiple kernel pages into a single logical block view.

For example, Kimi K3, a rank-3 MLA cache:

```text
raw worker tensor:
[N * 12, 64, 576]

meaning:
Every 64 rows of state constitute a kernel page.
12 kernel pages combine to form a logical block on the vLLM scheduling side.

edited view:
[N, 768, 576]
```

Here, `rank-3` simply means the tensor has 3 dimensions: `[num_blocks, states, hidden]`. Common K/V attention is typically `rank-5`: `[num_blocks, 2, block_size, num_heads, head_size]`.

PR also supports rank-4 MLA:

```text
[NB, 1, states, C]   # head slot before states, similar to HND
[NB, states, 1, C]   # head slot after states, similar to NHD
```

The `1` is a single head slot. MLA at the LMCache transfer layer is often viewed as a key-only format with `kv_size = 1` and `num_heads = 1`; that head dimension is merely to adapt to the general kernel description and does not represent the multi-head K/V of a typical MHA.

### 3. Mamba state page

Mamba / Gated DeltaNet recurrent layers do not store K/V for each token but rather recursive state snapshots. In the old path, a Mamba layer might register as:

```text
[conv_state, ssm_state]
```

The two tensor shapes and dtypes may differ, but they actually share a padded page:

```text
conv bytes | ssm bytes | padding
```

The LMCache transfer path is better suited for handling tensors where "each block is one page," so before registration, the Mamba page is re-viewed into an opaque page similar to attention:

```text
[num_blocks, 2, block_size, 1, head_size]
```

Here, the `2` is not true K/V; it merely slices a whole page of bytes into a shape that the transfer kernel can handle. PR #5042 also adds support for a unified Mamba view for `BLNHC` / `BLHNC`: blocks-first layout and the original layers-first layout can be reduced to the same inner shape selection in this view.

<figure class="lmcache-anim lmcache-anim--mamba" data-lmcache-animation="mamba" data-step="0">
  <div class="lmcache-anim__header">
    <div>
      <p class="lmcache-anim__kicker">Animation 3</p>
      <h3>Why Mamba state can also use register_kv_cache</h3>
    </div>
    <div class="lmcache-anim__step-label" data-anim-step-label>Step 1 / 5</div>
  </div>
  <p class="lmcache-anim__note" data-anim-copy>Mamba / linear attention saves a recurrent state snapshot, not a K/V for each token. Here, conv_state and ssm_state are treated as two segments of differently shaped bytes.</p>
  <div class="lmcache-anim__stage mamba-stage">
    <div class="mamba-state-source">
      <h4>runtime state tensors</h4>
      <div class="mamba-part mamba-part--conv is-visible" data-mamba-part="conv" data-show-from="0" data-highlight-step="0">
        <strong>conv_state</strong>
        <span>Convolution side short historical state</span>
      </div>
      <div class="mamba-part mamba-part--ssm is-visible" data-mamba-part="ssm" data-show-from="0" data-highlight-step="0">
        <strong>ssm_state</strong>
        <span>state-space hidden state</span>
      </div>
    </div>
    <div class="mamba-pack">
      <h4>one recurrent page</h4>
      <div class="mamba-page">
        <span class="mamba-page__seg mamba-page__seg--conv" data-mamba-part="conv-page" data-show-from="1" data-highlight-step="1">conv bytes</span>
        <span class="mamba-page__seg mamba-page__seg--ssm" data-mamba-part="ssm-page" data-show-from="1" data-highlight-step="1">ssm bytes</span>
        <span class="mamba-page__seg mamba-page__seg--pad" data-mamba-part="padding" data-show-from="1" data-highlight-step="1">padding</span>
      </div>
      <div class="mamba-shape" data-mamba-part="raw-page" data-show-from="1">
        <code>[num_blocks, page_bytes]</code>
      </div>
    </div>
    <div class="mamba-transfer">
      <h4>LMCache transfer view</h4>
      <div class="mamba-transfer-shape" data-mamba-part="transfer" data-show-from="2" data-highlight-step="2">
        <code>[num_blocks, 2, block_size, 1, head_size]</code>
      </div>
      <div class="mamba-axes">
        <span data-mamba-axis="3"><strong>2</strong><em>synthetic split</em></span>
        <span data-mamba-axis="3"><strong>1</strong><em>synthetic head</em></span>
        <span data-mamba-axis="3"><strong>head_size</strong><em>page payload width</em></span>
      </div>
      <div class="mamba-window" data-mamba-window data-show-from="4">
        <strong>EngineGroupInfo</strong>
        <code>recurrent_state = true</code>
        <code>sw_size_tokens = block_size</code>
      </div>
    </div>
  </div>
  <div class="lmcache-anim__controls" role="group" aria-label="Mamba state animation controls">
    <button type="button" class="lmcache-anim__button" data-anim-prev aria-label="Previous step">‹</button>
    <button type="button" class="lmcache-anim__button" data-anim-play aria-label="Play or pause">▶</button>
    <button type="button" class="lmcache-anim__button" data-anim-next aria-label="Next step">›</button>
    <div class="lmcache-anim__dots" data-anim-dots aria-label="Animation steps"></div>
  </div>
  <figcaption>The focus of the Mamba animation is on the "state page" rather than "K/V semantics": the registration phase unifies multiple segments of state bytes into an addressable page and encodes recovery semantics into EngineGroupInfo.</figcaption>
</figure>
## 5. Client Step Two: `create_engine_group_infos_from_vllm` is the Translator for the Entire Link

First, let's clarify the name: `create_engine_group_info_from_engine` is not the function name in the current code of this PR; it is more like a "generic term" or an old singular reference that is easy to say during discussions. The actual entry point in the current code is:

```python
create_engine_group_infos_from_vllm(...)
```

It is called by `LMCacheConnectorV1Impl.register_kv_caches` in `lmcache/integration/vllm/kv_cache_groups.py`. There are three noteworthy words in the function name:

| Name Fragment | Meaning |
|---|---|
| `infos` | The return is not a single info, but a group of infos: `list[EngineGroupInfo]` |
| `from_vllm` | This refers to the `KVCacheConfig` / `KVCacheGroupSpec` of vLLM, not an engine-neutral abstract object |
| `EngineGroupInfo` | A single element describes a transfer/kernel group in the LMCache protocol and which serving-engine block-id group it comes from |

Why must it be `list[EngineGroupInfo]`? It cannot be summarized with just "a vLLM group may be split into multiple LMCache kernel groups." That is merely one of the most common reasons. In the current code, the number of infos returned ultimately depends on how many transfer identities are produced by `group_layers_by_identity(...)`; this identity includes:

```text
(kv_size, num_heads, head_size, slots_per_block,
 engine_group_idx, dtype, engine_kv_format)
```

Thus, `list[EngineGroupInfo]` may vary in length, shorten, or remain empty due to the following situations:

| Situation | What Happens | Why |
|---|---|---|
| vLLM already has multiple engine groups | Typically produces multiple `EngineGroupInfo` | Different vLLM engine groups are in different block-id address spaces; even if tensor shapes are the same, block ids cannot be mixed |
| Different physical layouts within the same vLLM engine group | An `engine_group_id` may split into multiple `EngineGroupInfo` | For example, the main KV is rank-5 K/V, while the indexer is rank-3 key-only; they share the same block id list but have different copy kernel shapes |
| Different shape/dtype/head configurations within the same engine group | Continue to split by identity | Any difference in `kv_size`, `num_heads`, `head_size`, `slots_per_block`, or `dtype` may require different kernel descriptors |
| Non-hybrid cases without vLLM group metadata | May also return multiple infos | When `per_layer_engine_group_idx` is `None`, all layers are treated as engine group 0; however, if the actual tensor layouts differ, they will still be split by physical identity |
| CacheBlend registers a connector's private aux pool | Will add synthetic engine groups | The aux pool is not a native vLLM group, but it also requires independent format discovery, registration, and transfer, thus generating additional group ids with `extra_object_group_tag` |
| Scratch / `prefix_cacheable = False` groups | Will not produce `EngineGroupInfo` | These are temporary ring buffers within requests and do not belong to reusable prefix KV; the code uses `tokens_per_block = 0` to indicate exclusion |
| Cross-layer KV sharing / alias layers | Related layers will be excluded | If some layers' KVs are actually held by the owner layer, duplicate registration may lead to redundant transfers or incorrect block-size calculations |

There are also some fields that will affect the content of `EngineGroupInfo`, but they do not necessarily create new infos independently. For example, DCP will change the attention's `tokens_per_block`; sliding-window will write `sw_size_tokens`; Mamba / linear attention's state snapshot will write `recurrent_state`. They will continue to affect the server's object group, window semantics, and block count calculations, but whether an additional info is created still depends on whether the engine group id and physical transfer identity are separate.

The problem it aims to solve is: the vLLM group and the LMCache transfer group are not the same concept.

The vLLM engine group is concerned with scheduling semantics:

```text
These layers share the same cache spec.
The block ids of these layers belong to the same paged-block address space.
```

The LMCache kernel group is concerned with transfer semantics:

```text
Can these layers use the same copy kernel?
Are their kv_size, num_heads, head_size, slots_per_block, dtype, engine_kv_format the same?
Do their block id coordinate systems match?
```

Thus, the responsibility of `create_engine_group_infos_from_vllm` is not to "copy vLLM groups," but to synthesize the two sets of information into a protocol that can also be reproduced by the server.

<section class="lmcache-deep-anim" data-lmcache-deep-anim="group-info" aria-label="Figure 2: EngineGroupInfo Transformation Process">
  <noscript>Figure 2: vLLM metadata only explains block-id semantics; the actual tensor can explain transfer layout. EngineGroupInfo connects the two.</noscript>
</section>

### 1. First, Establish a Mapping from Layer Name to Tensor Index

`kv_caches` is an ordered dict. The function first converts it into a list and records which tensor corresponds to each layer name:

```python
per_layer_discoverable_kv_caches = list(kv_caches.values())
layer_to_idx = {name: idx for idx, name in enumerate(kv_caches.keys())}
```

All subsequent group metadata will be converted from layer names to layer indices. For example, if the 0th, 2nd, and 4th tensors in the registration list belong to the same vLLM group, when the server receives `EngineGroupInfo(layer_indices=(0, 2, 4))`, it does not need to recognize the vLLM layer names; it just needs to work based on the indices of the registered tensor list.

<figure class="lmcache-anim lmcache-anim--grouping" data-lmcache-animation="grouping" data-step="0">
  <div class="lmcache-anim__header">
    <div>
      <p class="lmcache-anim__kicker">Dynamic Figure 4</p>
      <h3>From Layer Name to Layer Index, Then to EngineGroupInfo</h3>
    </div>
    <div class="lmcache-anim__step-label" data-anim-step-label>Step 1 / 5</div>
  </div>
  <p class="lmcache-anim__note" data-anim-copy>First, flatten the ordered dict into a registered tensor list; from this step onward, the cross-process protocol will try to only discuss indices, no longer requiring the server to understand vLLM layer names.</p>
  <div class="lmcache-anim__stage grouping-stage">
    <div class="grouping-column">
      <h4>Registered Tensor List</h4>
      <ol class="grouping-list">
        <li data-group-layer data-role="main"><span>0</span><code>model.layers.0.self_attn.kv_cache</code><em>rank-5 K/V</em></li>
        <li data-group-layer data-role="scratch"><span>1</span><code>model.layers.1.qsa_ring</code><em>prefix_cacheable = false</em></li>
        <li data-group-layer data-role="main"><span>2</span><code>model.layers.2.self_attn.kv_cache</code><em>rank-5 K/V</em></li>
        <li data-group-layer data-role="indexer"><span>3</span><code>model.layers.3.mla_indexer</code><em>rank-3 uint8</em></li>
        <li data-group-layer data-role="main"><span>4</span><code>model.layers.4.self_attn.kv_cache</code><em>rank-5 K/V</em></li>
      </ol>
    </div>
    <div class="grouping-column">
      <h4>vLLM Group Metadata</h4>
      <div class="grouping-spec" data-group-spec="main">
        <strong>Group 0: Layer Names</strong>
        <code>[layer.0, layer.2, layer.4]</code>
      </div>
      <div class="grouping-spec" data-group-spec="scratch">
        <strong>Group 1: Non-Prefix-Cacheable</strong>
        <code>[layer.1] → tokens_per_block = 0</code>
      </div>
      <div class="grouping-spec" data-group-spec="indexer">
        <strong>Group 2: Indexer Layout</strong>
        <code>[layer.3] → rank-3 / uint8</code>
      </div>
    </div>
    <div class="grouping-column">
      <h4>LMCache Protocol View</h4>
      <div class="grouping-info" data-group-info="main">
        <strong>EngineGroupInfo 0</strong>
        <code>engine_group_id = 0</code>
        <code>layer_indices = (0, 2, 4)</code>
      </div>
      <div class="grouping-info grouping-info--excluded" data-group-info="scratch">
        <strong>No EngineGroupInfo</strong>
        <code>Layer 1 stays EXCLUDED</code>
      </div>
      <div class="grouping-info" data-group-info="indexer">
        <strong>EngineGroupInfo 1</strong>
        <code>engine_group_id = 2</code>
        <code>layer_indices = (3,)</code>
      </div>
    </div>
  </div>
  <div class="lmcache-anim__controls" role="group" aria-label="Grouping Animation Controls">
    <button type="button" class="lmcache-anim__button" data-anim-prev aria-label="Previous Step">‹</button>
    <button type="button" class="lmcache-anim__button" data-anim-play aria-label="Play or Pause">▶</button>
    <button type="button" class="lmcache-anim__button" data-anim-next aria-label="Next Step">›</button>
    <div class="lmcache-anim__dots" data-anim-dots aria-label="Animation Steps"></div>
  </div>
  <figcaption><code>(0, 2, 4)</code> here is the result of this small example: it comes from the positions in the registered tensor list, without requiring the model to actually register only even layers.</figcaption>
</figure>

### 2. Identify Layer Groups Needing Format Discovery

Format discovery is the process by which LMCache determines the KV format based on the actual tensor shape/stride, for example:

```text
rank-5 [NB, 2, BS, NH, HS]       -> Regular K/V attention
rank-3 [NB, BS, HS]              -> MLA key-only
rank-4 [NB, BS, 1, HS]           -> Blocks-first / single-head style view
```

PR #5042 added a crucial logic here: scratch groups do not participate in format discovery.

Scratch groups are those marked `prefix_cacheable = False` by vLLM. They are not reusable KV for token prefixes but temporary ring buffers during the request lifecycle. Since they will not be stored/retrieved later, their unusual layout should not cause registration failures.

Thus, the code constructs `layer_index_groups` like this:

```python
layer_index_groups = [
    [layer_to_idx[name] for name in group.layer_names]
    for group in vllm_groups
    if not is_scratch_spec(group.kv_cache_spec)
]
```

The `is_scratch_spec` check is quite straightforward: if the spec has `prefix_cacheable` and is false, it is considered not part of the prefix cacheable KV. Older versions of vLLM that do not have this field are handled by default according to the token-paged spec.

### 3. Perform Format Discovery for Each Tensor Group, Allowing Different Layouts Within the Same vLLM Group

Here, the following is called:

```python
normalize_and_discover_per_layer_formats(
    per_layer_discoverable_kv_caches,
    layer_index_groups,
    EngineType.VLLM,
    layout_hints,
)
```

It returns two things:

```text
normalized_kv_caches
engine_kv_formats
```

`normalized_kv_caches` is the tensor view processed by contiguous-view recovery/detector; `engine_kv_formats` is the LMCache native format corresponding to each layer.

Why per-layer format? Because a vLLM group may simultaneously contain both regular K/V caches and MLA indexer caches. They may belong to the same `UniformTypeKVCacheSpecs` group on the scheduling side, but their physical tensor formats are entirely different:

```text
Main attention cache:
[NB, 2, BS, NH, HS]       # rank-5, kv_size=2

MLA indexer cache:
[NB, states, C]           # rank-3, kv_size=1
```

If only one format is assigned to the entire model or the entire vLLM group, it may treat the indexer as a regular K/V or vice versa. The related tests in the PR specifically cover scenarios where "a group mixes rank-5 K/V and rank-3 key-only MLA index caches."

### 4. Label Each Layer with `engine_group_id`

Next, the function initializes:

```python
per_layer_group_idx = [EXCLUDED_ENGINE_GROUP] * num_layers
```

This step is particularly interesting. The default is not "all layers go into group 0," but rather "unless vLLM explicitly states that this layer belongs to a cacheable group, exclude it first."

Why? Because some models perform cross-layer KV sharing. For example, in certain multi-backbone or shared KV structures, a layer's KV may actually alias to another owner layer's KV tensor; the vLLM's `kv_cache_groups` only lists cache-owning layers. Shared layers should not form their own LMCache group, or else it would lead to redundant transfers and potentially incorrect block id counts due to inconsistent block sizes.

For each vLLM group, the function calculates:

```python
group_tokens_per_block[engine_group_id] = get_tokens_per_block(
    group.kv_cache_spec, dcp_size
)
```

Here, `tokens_per_block` is a crucial logical quantity: how many logical tokens a vLLM block id covers.

Under regular attention:

```text
tokens_per_block = spec.block_size
```

In DCP scenarios, the scheduler coordinates of the attention group will be scaled according to `dcp_size`:

```text
tokens_per_block = spec.block_size * dcp_size
```

Mamba recurrent state is a copy-style state and does not scale this dimension according to DCP shards, so it retains `spec.block_size`.

For scratch groups, it is:

```text
tokens_per_block = 0
```

`0` here is a marker: this group does not cover cacheable prefix tokens. When the function encounters `0`, it will not fill its layer into `per_layer_group_idx`, and ultimately, it will not form any `EngineGroupInfo`.

### 5. Parse Sliding-Window and Recurrent-State Information

The same layer index mapping will also be used for two auxiliary attributes:

```python
per_layer_sw_size
per_layer_recurrent
```

Sliding-window attention retains only the historical KV within a window range. When LMCache accesses chunks, it needs to know whether this group can only look at a limited window across chunks. The align/all cache mode of Mamba / linear attention saves a recurrent state snapshot, and the recovery semantics resemble a one-block window: what is truly useful upon a hit is the state of the last matching block.

Thus, `EngineGroupInfo` will carry:

```python
sw_size_tokens
recurrent_state
```

This will continue to affect the server's object group and attention window descriptor.

### 6. CacheBlend Aux Pool Will Generate Synthetic Engine Group

CacheBlend may register a connector's private aux page pool, named like:

```text
cb.aux_pool.<tokens_per_block>[.<label>]
```

It is not a native vLLM group, but it also needs to participate in registration, format discovery, and subsequent access. Therefore, the function will place it after vLLM groups, generating a synthetic engine group and marking it with `extra_object_group_tag`.

This detail indicates that `EngineGroupInfo` is not a "mirror of the original vLLM group." It is the protocol view of LMCache: it can accommodate both vLLM groups and the additional page pools needed by the connector.

### 7. Finally, Split Again by Physical Transfer Identity

The last step calls:

```python
group_layers_by_identity(
    normalized_kv_caches,
    engine_kv_formats,
    per_layer_group_idx,
)
```

Its identity is:

```text
(kv_size, num_heads, head_size, slots_per_block,
 engine_group_idx, dtype, engine_kv_format)
```

Each identity will form an LMCache kernel group. Each field has its reason:

| Field | Why It Affects Grouping |
|---|---|
| `kv_size` | Regular K/V is 2, MLA key-only is often 1, kernel processing methods differ |
| `num_heads` | The number of heads affects the layout and copy shape of each block |
| `head_size` | Each head/state row width differs, leading to different copy shapes |
| `slots_per_block` | Number of slots in a physical page, not necessarily equal to the logical token count |
| `engine_group_idx` | Block ID is only meaningful within the same vLLM engine group |
| `dtype` | The element size and kernel specialization differ for bf16/fp16/uint8 |
| `engine_kv_format` | Rank-5 K/V and rank-3 MLA within the same group cannot be merged |

Final function emit:

```python
EngineGroupInfo(
    engine_group_id=identity.engine_group_idx,
    layer_indices=tuple(indices),
    tokens_per_block=...,
    sw_size_tokens=...,
    extra_object_group_tag=...,
    recurrent_state=...,
)
```

This `list[EngineGroupInfo]` is the grouping protocol adhered to by both the client and server.

## 6. Specific Model Scenarios

<section class="lmcache-deep-anim" data-lmcache-deep-anim="model-cases" aria-label="Figure 3: Model Layout Cases">
  <noscript>Figure 3: Different model families expose different issues during the registration phase, but ultimately all must conform to the same EngineGroupInfo / KVLayerGroupsManager protocol.</noscript>
</section>

### 1. The Most Common Attention

The simplest case is when all layers are full attention, and all layers have the same KV tensor shape:

```text
kv_cache_config.kv_cache_groups:
  group 0:
    layer_names = [layer.0, layer.1, ..., layer.N]
    block_size = 16

kv_caches:
  layer.0 -> [NB, 2, 16, NH, HS]
  layer.1 -> [NB, 2, 16, NH, HS]
  ...
```

In this case, `create_engine_group_infos_from_vllm` will essentially produce one info:

```text
EngineGroupInfo(
  engine_group_id = 0,
  layer_indices = (0, 1, ..., N),
  tokens_per_block = 16,
  sw_size_tokens = -1,
  recurrent_state = false
)
```

The server will subsequently create a kernel group: all layers use the same shape descriptor, and a STORE / RETRIEVE request will launch a type of copy kernel for this group.

This is the most basic "one vLLM block one tensor page":

```text
block id 10 -> tensor page 10 -> 16 token slots
```

`tokens_per_block == slots_per_block`, with no compression or re-view.

### 2. Ordinary MLA

The KV cache of MLA may not necessarily have both K and V planes like ordinary attention. A common key-only MLA can be:

```text
[num_blocks, block_size, hidden]
```

This is rank-3. LMCache will interpret it as:

```text
kv_size = 1
num_heads = 1
head_size = hidden
slots_per_block = block_size
```

If `tokens_per_block == slots_per_block`, it is merely a different format, not compression.

### 3. DeepSeek-V3.2 Type fp8_ds_mla

Paths related to DeepSeek-V3.2 can be misleading because it also has MLA and a strong sense of compression in its name. However, it is important to distinguish between two types of "compression":

- One is **slot compression**: multiple logical tokens share one physical state slot, indicated by `tokens_per_block > slots_per_block`;
- The other is **smaller bytes per slot**: for example, a certain fp8 layout reduces the bytes per slot, but one logical token still corresponds to one state slot.

The PR document mentions that DeepSeek-V3.2's `fp8_ds_mla` is closer to the latter: it compresses the bytes representation of each slot rather than stuffing multiple tokens into one slot. Therefore, the spec side can usually still maintain:

```text
block_size == scheduler block size
compress_ratio == 1
```

For `register_kv_cache`, this means it does not need to be misprocessed by sub-paged view and should not be treated as DeepSeek-V4 style slot compression. Format detection and dtype/shape descriptor will reflect its true byte layout.

### 4. MLA with Indexer

Models with an indexer are more complex because there may be two types of physical caches within the same vLLM group:

```text
main MLA cache:
  [NB, states, 512], bf16

indexer cache:
  [NB, states, 132], uint8
```

They may share a `UniformTypeKVCacheSpecs` group because the scheduling side wants them to use the same engine block-id address space. However, LMCache transfer cannot combine them into one kernel group: the width, dtype, and even the number of states per block are different.

Thus, `normalize_and_discover_per_layer_formats` will separate detection within the group by tensor shape, and `group_layers_by_identity` will further split them into different `EngineGroupInfo` due to differences in `head_size` / `dtype` / `engine_kv_format`:

```text
info 0:
  engine_group_id = 0
  layers = main MLA layers

info 1:
  engine_group_id = 0
  layers = indexer layers
```

Note that both infos can share the same `engine_group_id`. This indicates they read the same vLLM block id list, but the transfer kernels run separately.

### 5. DeepSeek-V4 and Other Multi-Backbone / Multi-Group Structures

Models like DeepSeek-V4-Flash push the problem a step further: different groups can have different `tokens_per_block`, and some groups may also have slot compression.

For example, the following conceptual structure may appear:

```text
group 0: full attention, tokens_per_block = 256, slots_per_block = 256
group 1: sliding-window, tokens_per_block = 64, slots_per_block = 64
group 2: compressed MLA, tokens_per_block = 8, slots_per_block = 2
group 3: indexer, tokens_per_block = 4, slots_per_block = 1
```

LMCache can no longer assume "the entire model only has one block size." It must calculate separately for each group:

```text
compress_ratio = tokens_per_block / slots_per_block
blocks_per_chunk = lmcache_chunk_size / tokens_per_block
```

This is also why `EngineGroupInfo` needs to include `tokens_per_block`, and the server's `KVLayerGroupsManager` must re-detect `slots_per_block` from the actual tensor.

As for multi-backbone or cross-layer KV sharing, the core issue is not compression, but that certain layers do not have independent KV owners. vLLM may only place the cache-owning layer into `kv_cache_groups`, while other layers alias to the owner's KV cache. The default strategy of LMCache is to mark layers not explicitly covered by the vLLM group as `EXCLUDED_ENGINE_GROUP`, preventing them from forming their own transfer group. This is because the KV of the owner layer only needs to be moved once.

### 6. PR #5042's Qwen3.8B / GLM Scratch Group

One of the core additions in PR #5042 is to exclude groups with `prefix_cacheable = False` from the prefix KV registration path.

Models like Qwen3.8-Flash-Next may have QSA compressor rings, and GLM-5.3-Flash may also have structures like kpool tails. The common points of these buffers are:

```text
They are temporary states within requests;
Typically overwritten by pos % capacity;
vLLM does not treat them as prefix cache recovery;
They do not represent a token prefix that can be reused across requests.
```

If LMCache treats them as ordinary groups, two problems will arise.

First, the token span on the scheduling side will be lowered. For example, an ordinary group may cover 1600 tokens in one block, while the scratch ring capacity is only 8. If the minimum value is uniformly taken, LMCache will assume that the prefix can only be stored aligned to 8 tokens, thus disrupting the actual store chunk logic.

Second, the layout of the scratch tensor may not be supported by the LMCache transfer kernel. Since it does not need to transfer, format discovery should not fail here.

The handling in the PR is an end-to-end exclusion:

```text
is_scratch_spec(spec) -> prefix_cacheable == False
get_tokens_per_block(spec) -> 0
format discovery -> skip this group
per_layer_group_idx -> remains EXCLUDED_ENGINE_GROUP
EngineGroupInfo -> no entry emitted
slice_block_ids_per_group -> tokens_per_block 0 yields empty block list
```

Therefore, a more accurate term should be **non-prefix-cacheable KV cache group**. The scratch ring is a current example; it is inappropriate to label all cases as scratch layers because what is excluded is the cacheable semantics of the group, not the semantics of a specific Transformer layer.

### 7. PR #5042's Sub-Paged MLA Rank-3 / Rank-4

The PR also extends `_SubpagedMLAAttentionViewEdit` to rank-4 and allows it to use `spec.num_states` or the older version of `block_size / compress_ratio` to determine the number of logical states.

This addresses situations like GLM-5.3-Flash:

```text
block_size = 1152

sparse MLA:
  kernel rows = 64
  logical states = 1152
  ratio = 18

kpool indexer:
  tokens_per_state = 4
  logical states = 1152 / 4 = 288
  kernel rows = 32
  ratio = 9
```

They may be in the same `UniformTypeKVCacheSpecs` group, but each layer's leaf spec is different. Therefore, the PR changes the edit to match per-layer specs rather than applying a one-size-fits-all approach to the entire group's outer spec.

### 8. PR #5042's Mamba Unified View and BLNHC / BLHNC

In the new vLLM layout, blocks-first `BLNHC` / `BLHNC` may appear. For the Mamba unified state, the input looks more like:

```text
[num_blocks, 1, 1, row]
```

Where `row` is an entire row of the recurrent state for this layer, and `stride(0)` is the size of the padded page that each block skips. LMCache needs to view it as:

```text
NHD / BLNHC -> [num_blocks, block_size, 1, head_size]
HND / BLHNC -> [num_blocks, 1, block_size, head_size]
```

The key judgment in the PR is that for this Mamba view, blocks-first and layers-first can be categorized similarly in terms of inner dim selection; `BLNHC` resembles `NHD`, and `BLHNC` resembles `HND`.

### 9. PR #5042's Contiguity Recovery Tie-Break

Another seemingly small but crucial modification in `attempt_permute_to_contiguous_view` is:

```python
perm = sorted(
    range(kv_caches.ndim),
    key=lambda i: (strides[i], shape[i] != 1),
    reverse=True,
)
```

This function attempts to reorder dimensions by stride from largest to smallest, trying to restore a permuted tensor to a physically contiguous layout. The problem is that size-1 dimensions often have the same stride as adjacent dimensions. For example, a `BLNHC` view with only 1 KV head may have:

```text
shape  = [NB, 1, BS, HS]
stride = [block_step, HS, HS, 1]
```

Both the head dimension and the token dimension stride are `HS`. If the unstable sorting places the size-1 head before the token, LMCache may get `[NB, 1, BS, HS]`; however, a more physically reasonable contiguous view would be `[NB, BS, 1, HS]`.

The tie-break condition `shape[i] != 1` means that when strides are the same, non-size-1 dimensions are prioritized to be placed more outward, while size-1 dimensions are placed more inward. This is because size-1 dimensions do not expand the actual address range, and placing them inward aligns better with the results derived from stride to infer contiguous shape.
## 7. What Else Happens During Worker Adapter Registration

Returning to the main process. After generating `engine_group_infos`, `LMCacheMPConnector` calls `worker_adapter.register_kv_caches`.

This layer does three things.

First, it verifies whether the LMCache chunk size aligns with each group's `tokens_per_block`:

```python
for info in engine_group_infos:
    if info.tokens_per_block > 0 and chunk_size % info.tokens_per_block:
        raise ValueError(...)
```

LMCache storage objects are typically organized by chunk. If a group's block covers 64 tokens and the chunk size is 256, then each chunk contains exactly 4 blocks. If a group's block covers 544 tokens, then the default chunk size of 256 is invalid, as one chunk cannot even fit a complete logical block. It must be explicitly changed to 544, 1088, or another multiple of 544. If it cannot be evenly divided, the chunk boundary will fall in the middle of a vLLM block, making STORE / RETRIEVE difficult to maintain consistency.

Second, it saves `kv_caches`, `engine_group_infos`, and `layout_hints`. This is not for aesthetics, but for heartbeat recovery. When the server restarts or recovers, the worker can use the same information to re-register.

Third, it creates a transfer context and sends a registration request:

```python
transfer_ctx = create_transfer_context(kv_caches, mode=self._mp_transfer_mode)
transfer_ctx.register(...)
```

In LMCache driven mode, the selected context is `LMCacheDrivenTransferContext`. It checks for event IPC support, then packages the KV tensor into an IPC wrapper and sends `REGISTER_KV_CACHE` through the request client.

After this moment, the registration action on the worker side is considered complete: it waits for the server to return a response. If it times out, the user sees an error like "LMCache server did not respond to register_kv_caches."

## 8. What Happens on the Server After Receiving REGISTER_KV_CACHE

The server handler is in `LMCacheDrivenTransferModule.register_kv_cache`. The request is a synchronous handler, so registrations with the same `instance_id` will not be concurrently interleaved.

The first step on the server is to deduplicate liveness:

```python
existing = self._cache_contexts.get(instance_id)
if existing is not None:
    existing.last_seen = now
    return
```

If the worker has already registered, such as during a heartbeat recovery where registration occurs again, the server will not re-import the KV handle but will refresh `last_seen`. This prevents the just-recovered worker from being mistakenly cleared by the stale reaper.

The second step is to create the cache context:

```python
cache_context = create_cache_context(
    kv_caches,
    chunk_size,
    layout_hints=layout_hints or None,
    engine_group_infos=engine_group_infos,
    engine_type=engine_type,
    separate_object_groups=...,
    full_sw_kv=...,
)
```

Here, `kv_caches` is already the list of `DeviceIPCWrapper` received by the server. `create_cache_context` will select the corresponding backend based on the device type pointed to by the wrapper. On the GPU, it will use `GPUCacheContext`.

There are several details in the initialization of `GPUCacheContext`:

1. It saves the original IPC wrapper. Since the wrapper holds driver-level mapping, it must be explicitly closed when the context closes to avoid the worker's KV pool being long-term pinned by the server process.
2. `unwrap_kv_cache_tensors(kv_caches)` imports the wrapper into a tensor view visible to the server process.
3. It runs `normalize_and_discover_per_layer_formats` again. The server does not blindly trust that the client has already detected formats but instead reproduces format detection based on the real tensor view after import and `engine_group_layer_indices(engine_group_infos)`.
4. It creates `KVLayerGroupsManager`.
5. It allocates a block ID buffer on the GPU, where subsequent transfer kernels will copy the block IDs.
6. It pre-collects KV tensor data pointers for each kernel group, forming GPU tensors for direct use in subsequent kernel launches.
7. It creates a temporary transfer buffer and CUDA stream, registering the staging buffer to the GDS context.

The most critical step here is step 4: `KVLayerGroupsManager` is the grouping object that the server runtime actually uses.
## 9. How the Server's KVLayerGroupsManager Consumes EngineGroupInfo

The `EngineGroupInfo` sent from the client is still metadata at the protocol layer. The server needs to transform it into an executable kernel group.

The `KVLayerGroupsManager` first determines which engine group each registered layer belongs to based on the `EngineGroupInfo`:

```text
layer 0 -> engine group 0
layer 1 -> EXCLUDED_ENGINE_GROUP
layer 2 -> engine group 2
```

Then, the server re-groups using the same `group_layers_by_identity`. Both the client and server use the same grouping primitive, which is an important error-proof design: as long as the tensor shape/format seen on both sides is consistent, the group order can also be consistent.

Each kernel group on the server will generate a `KernelGroupInfo`, which includes:

| Field              | Source                                         |
|--------------------|------------------------------------------------|
| `layer_indices`    | From `EngineGroupInfo` and identity grouping   |
| `shape_desc`       | Real tensor format + shape + stride inference  |
| `dtype`            | Real tensor dtype                              |
| `tokens_per_block` | Logical token count brought over from vLLM spec |
| `slots_per_block`  | Physical slot count detected from real tensor shape_desc.bs |
| `engine_group_idx` | Which vLLM block id list this layer group uses |
| `sw_size_tokens`   | Sliding-window or Mamba one-block window      |
| `recurrent_state`  | Whether it is Mamba / linear recurrent state   |

Here, `tokens_per_block` and `slots_per_block` must be considered separately.

```text
tokens_per_block:
  How many tokens a vLLM block id covers in scheduling semantics.

slots_per_block:
  How many state/token slots are in a physical tensor page.
```

Normal attention:

```text
tokens_per_block = 16
slots_per_block  = 16
compress_ratio   = 1
```

Compressed MLA / indexer:

```text
tokens_per_block = 1152
slots_per_block  = 288
compress_ratio   = 4
```

LMCache does not need to store `compress_ratio` separately in the protocol. It calculates it when needed:

```text
tokens_per_block / slots_per_block
```

The server will also validate three types of alignment:

- `tokens_per_block` must be an integer multiple of `slots_per_block`;
- LMCache chunk size must be an integer multiple of `tokens_per_block`;
- If the sliding window is smaller than the chunk size, it must also align according to `tokens_per_block`.

If validation fails, registration fails. This is much better than discovering coordinate errors halfway through a STORE operation.
## 10. The Server Also Needs to Register Layout Descriptor

`LMCacheDrivenTransferModule.register_kv_cache` will register the layout descriptor after creating the cache context:

```python
layout_desc = get_layout_desc(cache_context, chunk_size, object_group_id=0)
group_layout_descs = {
    gid: get_layout_desc(cache_context, chunk_size, object_group_id=gid)
    for gid in range(num_object_groups)
}
attn_desc = kv_groups_manager.get_attn_desc()
self._ctx.layout_desc_registry.register(
    model_name,
    world_size,
    layout_desc,
    attn_desc,
    group_layout_descs=group_layout_descs,
)
```

This step is to inform the storage layer of LMCache and the distributed path about "what this model and this world size's cached object looks like."

Why register multiple layouts by object group? Because when `separate_object_groups` is enabled, full attention, sliding-window, recurrent state, and CacheBlend aux pool may not fit into the same object group. Their lifecycles, window semantics, and object key suffixes may differ.

The `attn_desc` exposes the attention window of the object group:

```text
full attention       -> -1
sliding-window       -> finite chunk window
Mamba recurrent      -> recurrent kind + one-block window
aux pool             -> aux kind
```

After registering the layout descriptor, the server will place the entry into `_cache_contexts`:

```python
self._cache_contexts[instance_id] = ContextEntry(
    cache_context=cache_context,
    model_name=model_name,
    world_size=world_size,
    last_seen=now,
    has_liveness_signal=False,
    event_backend=event_backend,
)
```

Subsequent STORE / RETRIEVE operations will find this context using the `instance_id`.

## 11. How to Use This Information After Registration for STORE / RETRIEVE

After registration, each store/load metadata on the vLLM side will carry block IDs. For hybrid models, block IDs are divided by engine group:

```text
engine group 0 block ids: [10, 11]
engine group 1 block ids: [20, 21]
```

However, the kernel groups of the LMCache server follow the order of `EngineGroupInfo`. If an engine group is split into two kernel groups, these two kernel groups must reuse the same engine block IDs.

This is the purpose of `expand_engine_block_ids`. Suppose the registration generates:

```text
info 0: engine_group_id = 0, layers = [0, 2]
info 1: engine_group_id = 1, layers = [1, 3]
info 2: engine_group_id = 0, layers = [4]
```

vLLM provides:

```text
group 0 -> [10, 11]
group 1 -> [20, 21]
```

What LMCache sends to the server will become:

```text
info 0 -> [10, 11]
info 1 -> [20, 21]
info 2 -> [10, 11]
```

<figure class="lmcache-anim lmcache-anim--expand" data-lmcache-animation="expand" data-step="0">
  <div class="lmcache-anim__header">
    <div>
      <p class="lmcache-anim__kicker">Animation 5</p>
      <h3>How Block IDs from the Same Engine Group Are Distributed to Multiple Kernel Groups</h3>
    </div>
    <div class="lmcache-anim__step-label" data-anim-step-label>Step 1 / 4</div>
  </div>
  <p class="lmcache-anim__note" data-anim-copy>vLLM sends block IDs arranged by engine group; this coordinate system describes scheduling semantics and does not directly equal the kernel group order that the server will launch.</p>
  <div class="lmcache-anim__stage expand-stage">
    <div class="expand-source">
      <h4>Engine Block IDs from vLLM</h4>
      <div class="expand-blocks" data-engine-blocks="0"><strong>group 0</strong><code>[10, 11]</code></div>
      <div class="expand-blocks" data-engine-blocks="1"><strong>group 1</strong><code>[20, 21]</code></div>
    </div>
    <div class="expand-router" aria-hidden="true">
      <span data-expand-line="0"></span>
      <span data-expand-line="1"></span>
      <span data-expand-line="2"></span>
    </div>
    <div class="expand-target">
      <h4>Kernel Groups on Server</h4>
      <div class="expand-info" data-expand-info="0" data-engine="0"><strong>info 0</strong><span>layers [0, 2]</span><code>[10, 11]</code></div>
      <div class="expand-info" data-expand-info="1" data-engine="1"><strong>info 1</strong><span>layers [1, 3]</span><code>[20, 21]</code></div>
      <div class="expand-info" data-expand-info="2" data-engine="0"><strong>info 2</strong><span>layers [4]</span><code>[10, 11]</code></div>
    </div>
  </div>
  <div class="lmcache-anim__controls" role="group" aria-label="Block ID Distribution Animation Controls">
    <button type="button" class="lmcache-anim__button" data-anim-prev aria-label="Previous Step">‹</button>
    <button type="button" class="lmcache-anim__button" data-anim-play aria-label="Play or Pause">▶</button>
    <button type="button" class="lmcache-anim__button" data-anim-next aria-label="Next Step">›</button>
    <div class="lmcache-anim__dots" data-anim-dots aria-label="Animation Steps"></div>
  </div>
  <figcaption>The most common mistake here is treating the engine group order as the kernel group order. In the animation, both info 0 and info 2 reuse the block IDs of group 0 because they are just different transfer identities under the same block-ID address space.</figcaption>
</figure>

The server only needs to run copies sequentially according to the kernel group index, without needing to care about the layer names from vLLM.

This is also why it is essential to determine the group order during the registration phase. The block ID list for STORE / RETRIEVE is interpreted according to this order; if the order is incorrect, data will be written to the wrong layer or the wrong page.
## 12. Re-answer: What Exactly Does `register_kv_cache` Do?

It can be summarized in one sentence:

> `register_kv_cache` registers the KV cache memory in the vLLM worker process as a set of runtime transfer resources that can be imported, recognized, grouped, and read/written by block ID in the LMCache server.

In more detail, it completes four layers of transformation.

The first layer is memory ownership transformation:

```text
worker-owned torch.Tensor
  -> DeviceIPCWrapper
  -> server-imported tensor view
```

The worker still owns the actual KV buffer, but the server can access it through IPC mapping.

The second layer is layout transformation:

```text
raw vLLM tensor shape/stride
  -> zero-copy edited view if needed
  -> EngineKVFormat / PageBufferShapeDesc
```

This covers scenarios such as HND/NHD/BLNHC/BLHNC, sub-paged attention, sub-paged MLA, Mamba state page, and contiguity recovery.

The third layer is semantic grouping transformation:

```text
vLLM KVCacheGroupSpec
  -> EngineGroupInfo
  -> server KernelGroupInfo
```

The vLLM group retains the block-id address space, while the LMCache kernel group ensures that each group can use the same copy kernel.

The fourth layer is storage object transformation:

```text
kernel groups
  -> object groups
  -> layout descriptors and attention window descriptors
```

This allows the storage/lookup/distributed path to understand what a chunk should look like in each group.

## 13. Key Points to Grasp When Reading PR #5042

PR #5042 superficially contains several different fixes: scratch group exclusion, sub-paged MLA rank-3/rank-4, Mamba unified view layout, and contiguity tie-break. They may seem scattered, but they all serve the same main line:

```text
During the registration phase, LMCache must see a KV view that is "cacheable, interpretable by vLLM block ID, and correctly transferable by the transfer kernel."
```

For non-prefix-cacheable scratch groups, the correct action is exclusion, as they are not reusable prefix KV.

For sub-paged MLA, the correct action is re-view, as it is reusable KV, but the kernel page granularity is smaller than the logical block.

For Mamba unified state, the correct action is opaque page view, as it is not ordinary attention K/V but can perform byte-level round-trips based on recurrent state pages.

For contiguity recovery, the correct action is to correct the ordering of stride ties, as format detection relies on the description of shape/stride for physical layout.

All of these occur in the registration path. Once the registration incorrectly establishes the relationships between groups, layouts, and tokens/slots, subsequent STORE/RETRIEVE efforts will only move data along the wrong map.

This is the real reason why `register_kv_cache` deserves attention: it is not just an auxiliary initialization, but the place where the LMCache MP mode translates the internal KV world of vLLM into an executable protocol for external caching systems.
## 14. Source Code Map

If you want to read the code along with the PR, I recommend looking at it in this order:

| Issue | Entry File |
|---|---|
| When does the vLLM worker hand over the KV cache to LMCache | `lmcache/integration/vllm/lmcache_mp_connector.py`'s `register_kv_caches` |
| Which tensor views will be rewritten before registration | `lmcache/integration/vllm/kv_cache_group_edits.py` |
| How the vLLM group becomes `EngineGroupInfo` | `lmcache/integration/vllm/kv_cache_groups.py` |
| The protocol meaning of `EngineGroupInfo` and block ID helper | `lmcache/v1/multiprocess/group_view.py` |
| How the worker adapter sends `REGISTER_KV_CACHE` | `lmcache/integration/vllm/vllm_multi_process_adapter.py` |
| How the LMCache driven transfer context wraps tensors | `lmcache/v1/multiprocess/transfer_context/worker_transfer.py` |
| How the server handles registration requests | `lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py` |
| How the server creates runtime kernel groups | `lmcache/v1/kv_layer_groups.py` |
| How the GPU context imports wrappers, creates pointers, and temp buffers | `lmcache/v1/platform/cuda/cache_context.py` |
| Why stride/shape view recovery affects format detection | `lmcache/v1/gpu_connector/kv_format/contiguity.py` |

While reading, keep in mind this principle: **vLLM-related fields should only be understood at the integration layer; after crossing processes, the server consumes EngineGroupInfo, layout hints, and actual tensor views.** Maintaining this boundary allows LMCache to support regular attention, MLA, Mamba, scratch exclusion, multi-group, and more serving engines in the future.
