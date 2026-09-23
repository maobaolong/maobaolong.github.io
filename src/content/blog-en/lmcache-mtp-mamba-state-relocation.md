---
title: "From MTP to Mamba State: Why LMCache Treats a Draft Cache as a Prefix State"
description: "Starting from Prefill, Decode, and KV Cache, this article gradually explains Mamba, GDN, SWA, MLA, MTP, vLLM align-mode checkpoint, speculative block relocation, and the state misalignment issue fixed in LMCache PR #5004."
publishedAt: 2026-09-16
updatedAt: 2026-09-19
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - kv-cache
  - mamba
  - gated-deltanet
  - speculative-decoding
  - mtp
  - hybrid-model
author: "Maobaolong"
readingTime: "31 min"
featured: true
draft: false
---
Some bug fixes involve only a few lines of code, yet they span across model architecture, inference scheduling, GPU memory paging, and external caching protocols.

[LMCache PR #5004](https://github.com/LMCache/LMCache/pull/5004) addresses such an issue: after enabling MTP in vLLM, a temporary Mamba state page used for speculative execution is moved to the end of the block table; LMCache only sees "this block added to the end," but does not recognize that "the old position has been cleared." As a result, it stores a scratch page without valid boundary states in the external cache. When the next request loads it, the model continues computation from an incorrect recursive state, ultimately producing corrupted output.

Looking only at the final fix, it can be summarized in one sentence:

> When a non-zero block ID reported by vLLM already appears in the requested block table, change the old position to a null block and append it to the new position.

However, without understanding what a Mamba block is, why GDN is also referred to as Mamba by vLLM, why MTP requires temporary states, why the prefix cache might miss a block, and why the scheduler skips a block boundary as a result, this sentence is nearly impossible to comprehend.

Therefore, this article does not start with the patch but instead builds up from the most fundamental inference processes layer by layer. This version also includes a narrated video and nine animated diagrams: first establishing the difference between Attention cache and recurrent state, then following MTP, scheduler, speculative page relocation, and LMCache tracker to the final fix.

<figure class="video-feature">
  <video controls preload="metadata" poster="/videos/blog/lmcache-mtp-mamba-state/mtp-mamba-relocation-explainer-poster.jpg">
    <source src="/videos/blog/lmcache-mtp-mamba-state/mtp-mamba-relocation-explainer.mp4" type="video/mp4" />
    <track kind="subtitles" src="/videos/blog/lmcache-mtp-mamba-state/mtp-mamba-relocation-explainer-en.vtt" srclang="en" label="Chinese subtitles" default />
  </video>
  <figcaption>Video: The narrated version connects the entire bug chain with animated diagrams, explaining why MTP changes the checkpoint and how LMCache safely rolls back.</figcaption>
</figure>

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/cache-family-map-en.svg" aria-label="Open the original panoramic view of the caching mechanism">
    <img src="/images/blog/lmcache-mtp-mamba-state/cache-family-map-en.svg" alt="Panoramic view of the caching mechanisms discussed in this article" />
  </a>
  <figcaption>Figure 1: The animated diagram first distinguishes between Attention cache and recurrent state; it can be scrolled horizontally on narrow screens or opened in the original image.</figcaption>
</figure>
## 1. First, Restore Prefill, Decode, and KV Cache

Large language models generate text autoregressively by token. Suppose the user inputs:

```text
The capital of France is
```

The model first processes the entire input and then begins to generate `Paris` token by token. The inference system typically divides this into two stages.

### Prefill: Read the Entire Input

Prefill processes many prompt tokens at once. Each Attention layer of the Transformer computes Key and Value for these tokens.

```text
token 0 -> K0, V0
token 1 -> K1, V1
token 2 -> K2, V2
...
```

### Decode: Generate One or Several Tokens at a Time

When generating new tokens, Attention needs to read the historical token's K/V. If they are not saved, the entire prompt must be recomputed for each token generated.

Thus, the system keeps the historical K/V in GPU memory:

```text
Historical K/V + Current token
        -> Attention
        -> Next token
```

This is commonly referred to as the KV Cache.

The key property of the KV Cache is: **It saves history by token.** The longer the context, the more K/V typically needs to be retained.

## 2. Mamba and GDN Do Not Save Token-by-Token KV

Modern models do not necessarily use Full Attention at every layer. Some models insert Mamba, GDN, or other recurrent layers between Attention layers.

These layers do not need to save K/V for every historical token. They maintain a fixed-size recurrent state:

```text
state_t = F(state_{t-1}, x_t)
```

When processing token `t`, the past history has already been compressed into `state_t`. To continue processing token `t+1`, only this state and the new input are needed.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/attention-vs-recurrent-en.svg" aria-label="Open the original comparison image of Attention KV and recurrent state">
    <img src="/images/blog/lmcache-mtp-mamba-state/attention-vs-recurrent-en.svg" alt="The fundamental difference between Full Attention KV and recurrent state" loading="lazy" />
  </a>
  <figcaption>Figure 2: The dynamic diagram shows that Attention saves addressable historical entries, while Mamba/GDN compresses history into a running state.</figcaption>
</figure>

### Mamba: Selective State Space Model

[Mamba](https://arxiv.org/abs/2312.00752) belongs to the selective state-space model. It allows state transition parameters to depend on the current input, determining what information should be retained, updated, or forgotten.

During inference, the Mamba layer typically maintains two types of states:

- convolution state: the most recent input state needed for short convolutions;
- SSM state: state space memory updated recursively along the sequence.

The size of these states is determined by the model dimensions and does not grow linearly with the number of context tokens.

### GDN: Gated DeltaNet

[Gated DeltaNet](https://arxiv.org/abs/2412.06464) belongs to recursive linear attention. It maintains a matrix state similar to associative memory: queries read information from it, the delta rule corrects existing key-value associations, and the gate controls how old information decays.

It can be roughly understood as:

```text
First, forget a portion of the old state according to the gate
        ↓
Use the delta rule to correct the current key's corresponding memory
        ↓
Query reads results from the updated matrix state
```

The mathematical mechanisms of GDN and Mamba differ:

| Mechanism | Model Perspective | Saved State |
|---|---|---|
| Mamba | Selective SSM | SSM state + convolution state |
| GDN | Gated delta-rule linear attention | Recursive matrix state |

However, from the perspective of the inference system, they share the same lifecycle characteristics:

- Both need to pass the previous state to the next step;
- Both can save a checkpoint at a certain token boundary;
- Both need to transport state during preemption, recovery, and external caching;
- Both must avoid submitting unaccepted candidate states as formal states during speculative decoding.

Therefore, vLLM unifies these types of recurrent layers into the runtime abstraction of `MambaSpec` / `MambaManager`. In other words, the "Mamba state" in code and logs sometimes serves as a general engineering term; in the corresponding Qwen GDN hybrid model in PR #5004, it actually carries the GDN recurrent state.

### SWA and MLA Do Not Belong to Mamba/GDN

SWA is Sliding Window Attention. It still saves token-by-token K/V but only allows the current query to focus on the most recent `W` tokens:

```text
query_t attends to [t-W+1, ..., t]
```

MLA is Multi-head Latent Attention. It compresses K/V representations into latent vectors but still belongs to the Attention family.

Thus, their boundaries are:

```text
Mamba / GDN: History is compressed into a fixed-size recurrent state
SWA / MLA: Still saves addressable tokens or compressed token entries
```

For example, DeepSeek-V4 simultaneously uses compressed MLA and recent SWA branches. vLLM's `DeepseekV4SWACache` returns [`SlidingWindowMLASpec`](https://github.com/vllm-project/vllm/blob/ab35354c21cc3c36439e79e18070f85cfafc3af2/vllm/v1/attention/backends/mla/sparse_swa.py#L72-L130), rather than `MambaSpec`. It also belongs to a hybrid cache, but the composition of the hybrid is multiple types of Attention cache, not Attention plus recurrent state.
## 3. Mamba Block is Not a "Segment Token KV"

vLLM uses a paged allocator to manage GPU cache. To unify the allocation, recycling, and block table system for Attention KV and recursive states, it also packs the Mamba/GDN state into physical pages, referred to as Mamba blocks.

Two concepts must be distinguished here:

- Physical block/page: A specific space in GPU memory that actually holds the state, identified by a concrete block ID;
- Logical slot: A checkpoint slot at a sequence position, indicating "the state after processing up to which token boundary."

Assuming the Mamba block size is `B`, the semantics maintained by the `align` mode are:

```text
slot 0 = state after processing the first B tokens
slot 1 = state after processing the first 2B tokens
slot 2 = state after processing the first 3B tokens
```

In other words:

```text
slot p = state after (p + 1) * B tokens
```

There is an easily overlooked design in [`MambaSpec`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/kv_cache_interface.py#L668-L708): the logical block table in `align` mode needs to cover the entire sequence, but the actual state pages that reside simultaneously only need to be around `2 + num_speculative_blocks`. Logical slots that are no longer needed will be replaced with null blocks.

Thus, the following table is normal:

```text
Logical slot:  0    1    2    3    4
Block ID:     10    0    0   17   21
```

`0` is not a regular data block containing all-zero valid states, but rather a null block indicating "no available state here."

## 4. Why Checkpoints Must Be Written Exactly at Block Boundaries

Continuing with the assumption that `B = 1616`. A prompt of length 4538 has two complete boundaries and a tail:

```text
0              1616              3232          4538
|----------------|-----------------|--------------|
```

If slot 1 is to truly represent `state_3232`, there must be a computation step that **ends exactly at 3232**.

The reason is straightforward: the recursive kernel processes the input from the initial state, typically leaving the state at the end position of this step. If a step runs from 1616 all the way to 4538, the final result is `state_4538`; passing through 3232 does not mean that the system automatically saved a copy of `state_3232`.

Therefore, when there is no MTP, vLLM's align-mode scheduler will split Prefill into:

```text
step 1: [0, 1616)       -> materialize state_1616
step 2: [1616, 3232)    -> materialize state_3232
step 3: [3232, 4538)    -> running tail state
```

This is the core task of [`_mamba_block_aligned_split`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/core/sched/scheduler.py#L366-L441): to ensure that the Prefill step accurately stops at cacheable boundaries for future recovery from boundaries.
## 5. What Exactly is MTP Doing?

MTP stands for Multi-Token Prediction. Its goal is not to change the output defined by the main model, but to reduce the number of expensive forward passes of the main model.

A typical autoregressive generation advances one token at a time:

```text
Main model forward -> D
Main model forward -> E
Main model forward -> F
```

With MTP enabled, lightweight MTP modules quickly propose multiple candidates:

```text
draft: D E F G
```

The main model then validates these candidates in a batch forward. Suppose the continuous results provided by the main model are:

```text
verify: D E X ...
```

The system accepts `D E` before the first divergence and uses the main model's `X` at the divergence point. One forward pass of the main model has advanced multiple tokens.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/mtp-draft-verify-en.svg" aria-label="Open the original diagram of the MTP draft verify commit process">
    <img src="/images/blog/lmcache-mtp-mamba-state/mtp-draft-verify-en.svg" alt="MTP's draft, verify, and commit" loading="lazy" />
  </a>
  <figcaption>Figure 3: The dynamic diagram shows how MTP first drafts multiple tokens, then the main model validates and commits effective prefixes in batches.</figcaption>
</figure>

### Why MTP Needs the Main Model's Hidden State

MTP modules are not independent small models that only look at token IDs. vLLM categorizes methods like `mtp` and EAGLE as "speculative decoding using target model hidden states." The comment in [`SpeculativeConfig.use_eagle()`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/config/speculative.py#L1477-L1482) also clearly states this.

The typical Attention prefix cache stores K/V, but may not retain the complete hidden state required for the generation point. This leads to an important distinction:

```text
Typical generation: After hitting KV, can directly continue Attention
MTP drafting: In addition to KV, needs the target hidden state and draft-layer state near the boundary
```

## 6. "Dropping the Last Matched Block" is Not Deletion, But Recalculation

Assuming the prefix cache confirms that the first 3232 tokens all hit based on token hash:

```text
0                 1616                 3232
| cached block 0   | cached block 1     |
```

In typical generation, `num_computed_tokens` can be directly advanced to 3232.

However, EAGLE/MTP requires the hidden state near the generation point. For multi-module MTP, the trailing draft-layer KV may also depend on up to `num_speculative_tokens - 1` tokens after the matched prefix; these continuation tokens are not within the proof range of the current block hash. Another request, even if sharing the same prefix, may have different subsequent continuations.

Therefore, vLLM's approach is: **count the last block as not hit, allowing the main model to recalculate it for the current request.**

```text
Actual cache holds: [0, 3232)
Reports to scheduler: [0, 1616) hit
Must recompute: [1616, 3232)
```

Recalculation will regenerate what the current request needs:

- Attention K/V;
- Target hidden state near the generation point;
- Cache/state corresponding to the MTP draft modules.

This is the precise meaning of "drop the last matched block to force recompute" in the vLLM comments. It does not necessarily physically delete that block of data from the GPU; it simply cannot count that block as part of the computed prefix that can be directly skipped. [vLLM's hit constraints](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/core/single_type_kv_cache_manager.py#L544-L568)

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/mtp-prefix-recompute-en.svg" aria-label="Open the original diagram of the MTP prefix cache recompute process">
    <img src="/images/blog/lmcache-mtp-mamba-state/mtp-prefix-recompute-en.svg" alt="Why MTP hits need to backtrack one block" loading="lazy" />
  </a>
  <figcaption>Figure 4: The dynamic diagram shows that "dropping the last matched block" merely shortens the skippable prefix and does not equate to physically deleting the cache.</figcaption>
</figure>
## 7. Why 1616 is No Longer the "Next Stop"

Now let's bring the prefix-hit constraint back to a new prompt's Prefill.

Without MTP, the last complete cacheable boundary for a prompt of length 4538 is 3232:

```text
last_cache_position = floor(4538 / 1616) * 1616
                    = 3232
```

When the scheduler starts the second step from 1616, 3232 is ahead in the current step, so it will stop there:

```text
start = 1616
stop  = 3232
end   = 4538

start < stop < end
```

After enabling MTP, even if it hits 3232 in the future, it must backtrack a bit and recalculate from 1616. Therefore, vLLM also backs off the last materializable Mamba cache position:

```text
last_cache_position = 3232 - 1616
                    = 1616
```

At the start of the second step, it is already at 1616:

```text
start = 1616
stop  = 1616
end   = 4538
```

A scheduler stop must strictly be within the current step, meaning `start < stop < end`. Now `stop == start`, which is certainly not a position for "next stop."

Thus, Prefill changes from three steps to two:

```text
MTP off:
[0, 1616) [1616, 3232) [3232, 4538)

MTP on:
[0, 1616) [1616,             4538)
```

This is not a mathematical requirement of MTP to cross 3232, but rather a scheduling choice: since the future MTP prefix resume will not directly use `state_3232`, vLLM does not split the Prefill forward just to save it.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/mamba-checkpoint-timeline-en.svg" aria-label="Open MTP changes Prefill checkpoint original image">
    <img src="/images/blog/lmcache-mtp-mamba-state/mamba-checkpoint-timeline-en.svg" alt="How MTP switch changes Prefill checkpoint" loading="lazy" />
  </a>
  <figcaption>Figure 5: The dynamic diagram shows that when the second step starts from 1616, 1616 can no longer be a future stop point within the step.</figcaption>
</figure>

## 8. Why Speculative Blocks Exist

MTP verifies multiple candidate tokens at once. For the Mamba/GDN recursive layer, each candidate token consumed changes the state:

```text
state_C -> state_D -> state_E -> state_F -> state_G
```

However, before verification is complete, the system does not know how many candidates will ultimately be accepted.

If only `D E` are accepted, the formal state should be submitted as `state_E`; if `F` is also accepted, then `state_F` should be submitted. The system cannot directly overwrite the submitted state with the deepest candidate's state when the result is unknown, as it would be impossible to roll back if candidates are rejected.

Therefore, vLLM prepares additional scratch state pages for speculative execution. These are merely temporary spaces along the candidate path and do not necessarily correspond to any reusable prefix boundary.

In align mode, vLLM does not expand the normal block grid for each lookahead token but maintains:

- A current running state block;
- Several speculative scratch blocks;
- A new block for the next state handover when necessary.

The relevant allocation logic is located in [`MambaManager.allocate_new_blocks`](https://github.com/vllm-project/vllm/blob/2cf0a6915ce544dc493a0990f2ea38d81601128a/vllm/v1/core/single_type_kv_cache_manager.py#L1547-L1667).
## 9. Why Speculative Blocks Move from the Middle to the End

Continuing with the example of `B = 1616` and MTP enabled.

After the first step, vLLM has prepared some physical pages for the running state and speculative execution. Assume one of the scratch page IDs is `S1`, which temporarily appears in logical slot 1.

The second step runs directly from 1616 to 4538, skipping 3232. Since no step ends at 3232, slot 1 cannot have a valid `state_3232`; it must be null.

However, the physical page `S1` can still be reused. Therefore, vLLM does two things:

```text
1. Change slot 1 to null block 0
2. Move physical block S1 to the end of the block table to continue as a scratch page
```

For example:

```text
Before moving: [A, S1, S2, S3, S4, C]
After moving:  [A,  0, S2, S3, S4, C, S1, D]
```

Here, `S1` is not copied. The same physical block ID leaves its old logical position and then appears in the new end position. The old slot is represented by a null block, indicating "this boundary has no state."

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/speculative-block-relocation-en.svg" aria-label="Open the original diagram of the speculative state page relocation process">
    <img src="/images/blog/lmcache-mtp-mamba-state/speculative-block-relocation-en.svg" alt="The process of vLLM relocating the speculative state page" loading="lazy" />
  </a>
  <figcaption>Figure 6: A dynamic diagram showing the physical page S1 moving from the old logical slot to the end, with the old position synchronously changing to a null block.</figcaption>
</figure>

## 10. Why LMCache Only Sees Half of the Movement

The LMCache MP connector maintains its own request tracker on the scheduler side. The tracker needs to know the block table of each engine group to describe "which GPU blocks a certain segment of tokens should be moved from" to the LMCache server.

The issue is that the connector receives block allocation deltas: it can see which blocks were added to the end during this step but does not receive the in-place replacement that vLLM made to the old slot.

In the example above, the real change in vLLM is:

```text
Old position: S1 -> 0
Added to the end: [S1, D]
```

But the connector only receives:

```text
new_block_ids = [S1, D]
```

The old tracker simply executes:

```python
block_ids.extend(group_block_ids)
```

Thus, the two sides begin to diverge:

```text
vLLM:   [A, 0,  ..., S1, D]
LMCache: [A, S1, ..., S1, D]
```

vLLM ensures that the same non-zero physical block does not occupy two slots of the same request simultaneously. The LMCache tracker shows two `S1`s, which means it is not a valid "two positions sharing one state," but rather that the old position missed a zeroing out.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/append-delta-blindspot-en.svg" aria-label="Open the original dynamic diagram of the LMCache append delta blind spot">
    <img src="/images/blog/lmcache-mtp-mamba-state/append-delta-blindspot-en.svg" alt="Dynamic diagram showing the tracker divergence when LMCache only receives append delta" loading="lazy" />
  </a>
  <figcaption>Figure 7: A dynamic diagram showing the real changes in vLLM alongside the append delta received by the connector; the repeated non-zero ID is evidence of relocation.</figcaption>
</figure>
## 11. How Error States Enter External Cache

LMCache establishes content keys based on token chunks and saves corresponding states for different object groups. For hybrid models, Attention KV and Mamba/GDN states can be treated as different object groups.

When LMCache is ready to store the chunk `[1616, 3232)`:

```text
Attention group: has real KV
Mamba/GDN group: should be null, as state_3232 has never been produced
```

However, the old slot of the tracker still contains `S1`. Thus, the server saves the content from the `S1` page as `state_3232`.

This page is speculative scratch space. No Prefill kernel guarantees that it holds `state_3232`; the content may belong to a candidate path, other moments, or even just old data that has not yet been initialized to the current boundary.

The next time the same prefix hits LMCache, the error chain occurs in reverse:

```text
LMCache hits chunk key
  -> Loads content saved in S1 into slot 1
  -> The model treats it as state_3232
  -> Continues processing subsequent tokens from the erroneous recursive state
  -> Subsequent output is deterministically corrupted
```

Note: The error ultimately manifests in the decoded text, but the erroneous data was generated in the store/retrieve path of the Prefill checkpoint. It is not a problem that exists only during steady-state decoding or only during preemption recovery.

## 12. Fix: Deriving "Old Position Cleared" from "Duplicate ID"

PR #5004 modified `append_block_ids`. The new logic can be summarized as:

```python
for block_id in group_block_ids:
    if block_id != 0 and block_id in block_ids:
        block_ids[block_ids.index(block_id)] = 0
    block_ids.append(block_id)
```

Using the numbers from the test as an example:

```text
Original tracker: [10, 11, 12, 13, 14, 15]
vLLM new report:  [12, 16]
```

When processing `12`, the tracker finds that it has already appeared in the old slot. According to vLLM's uniqueness constraint, this means block 12 has been moved from its old position:

```text
[10, 11, 12, 13, 14, 15]
         ↓
[10, 11,  0, 13, 14, 15]
```

Then the new position is appended:

```text
[10, 11, 0, 13, 14, 15, 12, 16]
```

This realigns with the actual block table of vLLM.

### Why `block_id != 0`

The null block `0` can naturally be duplicated:

```text
[0, 0, 20, 21, 0, 25]
```

Multiple null slots do not indicate that the same valid state has been moved multiple times. Therefore, only "duplicate non-zero block IDs" can serve as signals for relocation/reallocation.

## 13. Why It's Preferable to Hit One Less Chunk After the Fix

After the tracker restores the old position to `0`, the LMCache server will see that this Mamba object group consists entirely of null blocks in the corresponding chunk.

[`all_null_chunk_masks`](https://github.com/LMCache/LMCache/blob/078cf22e5c23d271fccbca5f8cc6ec7f564c7889/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L136-L148) will mark such chunks. LMCache will not submit a fabricated recurrent-state object for it.

Thus, the same token chunk may appear as:

```text
Attention object: exists
Mamba/GDN object: does not exist
```

Hybrid prefix resume requires that all necessary groups have valid states at the same recovery point. When the Mamba/GDN object is missing, the final common hit length must revert to an earlier checkpoint.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/lmcache-corruption-and-fix-en.svg" aria-label="Open the original diagram of LMCache error chain and fix process">
    <img src="/images/blog/lmcache-mtp-mamba-state/lmcache-corruption-and-fix-en.svg" alt="Error chain and safe rollback after the fix" loading="lazy" />
  </a>
  <figcaption>Figure 8: The dynamic diagram shows how the old logic persisted scratch state; the missing recursive state after the fix allows for a safe rollback of the common hit point.</figcaption>
</figure>

This reflects an important caching principle:

> A cache hit is not successful just because "the bytes were found"; these bytes must correspond to the exact model state declared by the key.

Hitting one less chunk only results in some additional computation; treating speculative scratch state as a valid checkpoint would allow the model to continue executing from an erroneous state. Correctness must take precedence over hit length.
## 14. In Which Scenarios Does This Issue Occur

This error chain requires multiple conditions to occur simultaneously:

```text
Hybrid model, including Mamba/GDN type recursive layers
  + vLLM mamba_cache_mode=align
  + MTP/EAGLE type speculative decoding
  + scheduler crosses a boundary that should correspond to a logical slot
  + speculative physical block is moved to the end
  + LMCache MP connector only receives append delta
  + external cache attempts to save or restore this state
```

In the corresponding LMCache MP configuration, `--separate-object-groups` must also be enabled, and the LMCache chunk size must align with the Mamba block size. This way, Attention KV and Mamba/GDN state will enter the store/retrieve process as independent object groups with the same token chunk boundaries.

The core triggering phase is **chunked Prefill**, not steady-state Decode.

The relationship with different phases is as follows:

| Phase | Relationship |
|---|---|
| Normal chunked Prefill | Produces skipped Mamba boundaries, which are direct trigger points |
| LMCache store | Old tracker mistakenly stores the scratch page as a checkpoint |
| LMCache retrieve | Incorrect checkpoint is reloaded onto the GPU |
| Decode | Continues generating from the erroneous state, making damage most observable in output |
| Preemption recovery | Also relies on checkpoints, but is not a necessary condition for the issue to occur |

If the model only has Full Attention or MLA/SWA cache like DeepSeek-V4, without `MambaSpec` recursive states, this specific Mamba align-mode causal chain does not hold. They may have their own block reclamation and speculative-cache constraints, but cannot directly apply the conclusions here just because they are all called hybrid caches.

## 15. Compressing the Entire Chain into Nine Steps

At this point, the entire issue can be compressed into the following nine steps:

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-mtp-mamba-state/nine-step-causal-chain-en.svg" aria-label="Open the nine-step causal chain dynamic image">
    <img src="/images/blog/lmcache-mtp-mamba-state/nine-step-causal-chain-en.svg" alt="MTP Mamba state relocation nine-step causal chain dynamic image" loading="lazy" />
  </a>
  <figcaption>Figure 9: The dynamic image compresses the entire chain into nine nodes: recursive state, boundary semantics, MTP fallback, speculative relocation, tracker zeroing, and safe fallback.</figcaption>
</figure>

1. Mamba/GDN uses fixed-size recurrent states to represent history, rather than token-by-token KV.
2. vLLM uses Mamba block/page to save these states and ensures logical slots correspond to specific token boundaries.
3. A boundary state is only valid when a computation step happens to end at that position.
4. MTP requires the target hidden state and draft-layer state near the generation point.
5. When the prefix cache hits, vLLM will undercount the last matched block, prompting the current request to recalculate it.
6. The scheduler no longer splits Prefill for boundaries that cannot be reused in the future.
7. The skipped slot should be null, and the originally occupying speculative block is moved to the end for reuse.
8. LMCache only receives the tail append delta, causing the old tracker to mistakenly retain the old block ID.
9. The fix involves deducing relocation through repeated non-zero IDs, zeroing the old slot to prevent invalid scratch states from entering the external cache.

Ultimately, those few lines of code may appear to maintain a Python list, but they actually maintain a more serious semantics:

> Whether a certain token boundary truly has a recoverable, shareable model state that can be named by a content key.

Once this semantics is off by a notch, even if all subsequent memory transfers, external caching, and hit statistics execute successfully, what is transferred is merely a "correctly formatted erroneous state." This is precisely the most challenging aspect of hybrid model caches: the system must not only know where a block of memory is located but also understand what it truly represents in terms of the model's execution state.
