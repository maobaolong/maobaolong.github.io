---
title: "When a Legal Memory Gap Breaks LMCache CUDA IPC"
description: "Starting from LMCache Issue #5097, this article explains hybrid-model dim-0 padding, tensor strides, three CUDA IPC wrappers, and how PR #5693 and #5855 restore zero-copy transport with byte spans and as_strided."
publishedAt: 2026-10-21
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - cuda-ipc
  - kv-cache
  - hybrid-model
  - glm
author: "Maobaolong"
readingTime: "18 min"
featured: true
draft: false
---

Some failures come from invalid input. Others come from a memory layout that is **perfectly valid but wider than the old code's mental model**.

[LMCache Issue #5097](https://github.com/LMCache/LMCache/issues/5097) is the second kind. When GLM-5.3-Flash starts with LMCache MP 0.5.5, `RawCudaIPCWrapper` receives this tensor:

```text
shape  = (11285, 1, 640, 848)
stride = (655360, 542720, 848, 1)
```

It then rejects the tensor as non-contiguous.

At first glance the model appears to have produced a bad tensor. The opposite is true: this is a legitimate padded view created when a hybrid model lets multiple KV-cache groups share one model-wide page size. The old IPC wrapper only knew how to reconstruct densely packed tensors, so it failed closed instead of silently reading the wrong addresses.

This article explains how the layout arises, why it became visible after isolated IPC became the default, and how [PR #5693](https://github.com/LMCache/LMCache/pull/5693) and [PR #5855](https://github.com/LMCache/LMCache/pull/5855) repair the Raw CUDA IPC and CUDA VMM paths respectively.

## The issue and the two fixes at a glance

<section class="ipc-article-map" aria-label="Relationship between Issue 5097 and the two fixes">
  <div class="ipc-map-column">
    <div class="ipc-map-node ipc-map-node--problem"><strong>Issue #5097</strong><span>A GLM-5.3-Flash KV view has dim-0 padding; registration fails in isolated mode.</span></div>
    <div class="ipc-map-node"><strong>Shared root cause</strong><span>Shape describes logical elements. Stride describes their physical spacing. The old code treated them as equivalent.</span></div>
  </div>
  <div class="ipc-map-arrow" aria-hidden="true">→</div>
  <div class="ipc-map-column">
    <div class="ipc-map-node"><strong><code>isolated_ipc=true</code></strong><span>Selects <code>RawCudaIPCWrapper</code>, whose old implementation required a contiguous tensor.</span></div>
    <div class="ipc-map-node"><strong><code>use_vmm_api=true</code></strong><span>Selects <code>VmmCudaIPCWrapper</code> first, with the same dense-layout assumption.</span></div>
    <div class="ipc-map-node"><strong>Both switches are false</strong><span>Uses PyTorch storage IPC, which already reconstructs from shape and stride.</span></div>
  </div>
  <div class="ipc-map-arrow" aria-hidden="true">→</div>
  <div class="ipc-map-column">
    <div class="ipc-map-node ipc-map-node--fix"><strong>PR #5693</strong><span>Raw CUDA IPC maps the full byte span and reconstructs with <code>as_strided</code>.</span></div>
    <div class="ipc-map-node ipc-map-node--fix"><strong>PR #5855</strong><span>The same algorithm is applied to VMM, and its physical-chunk check now includes padding.</span></div>
  </div>
</section>

## Five concepts first

### KV cache

After prefill, a model keeps the Key and Value results produced by each layer. A later request with the same prefix can restore them instead of recomputing the prefix. LMCache moves those results from vLLM's GPU KV pool into an external cache and back again.

### Shape and stride

Shape says how many logical elements a tensor has. A shape of `(4, 8)` can be read as four rows with eight elements each.

Stride says how far the memory pointer moves when one coordinate advances. Two tensors can have the same shape while using entirely different physical layouts.

### Contiguous

A contiguous tensor packs all logical elements back to back. In that case, mapping `numel` elements and reshaping them is usually sufficient.

### Padding

A hybrid model may contain ordinary attention, MLA, Mamba, or indexer cache groups. When all groups share one physical page size, a smaller group can leave unused space after each block. That gap is padding.

### IPC wrapper

The vLLM worker and LMCache server are separate processes. Instead of copying the entire KV cache into a message, a wrapper transports a shareable GPU-allocation handle plus the dtype, shape, stride, and offsets needed to reconstruct the view.

## The actual numbers: how much memory did the old code omit?

For the tensor reported in the issue, one block contains:

```text
1 × 640 × 848 = 542,720 logical elements
```

But `stride[0]` is `655,360`. Moving from one block start to the next requires crossing:

```text
655,360 - 542,720 = 112,640 padding elements
```

Padding occupies 17.1875% of the physical block pitch. Across 11,285 blocks:

```text
logical numel = 6,124,595,200 elements
physical span = 7,395,624,960 elements
```

The old Raw/VMM wrappers used `numel * element_size` as the mapping length and reconstructed the tensor with `reshape(shape)`. That assumes adjacent blocks have no gaps. The computed address for Block 1 therefore lands inside Block 0's padding, and every later block is shifted.

Silently accepting that layout would corrupt restored KV. Rejecting it was a sound fail-closed decision. What was missing was a reconstruction method that could safely represent the gaps.

## Follow the read pointer

The animation below moves an actual SVG pointer. Select a step to move from the current address to the next one. The final step sweeps across all four correct block starts.

<figure class="ipc-lab" data-ipc-lab data-label-read="read pointer" data-label-wrong="wrong offset" data-label-fixed="stride-aware">
  <div class="ipc-lab__header">
    <h3>One shape, two very different walks through memory</h3>
    <span class="ipc-lab__step" data-ipc-counter>1 / 5</span>
  </div>
  <p class="ipc-lab__copy"><strong data-ipc-title></strong><span data-ipc-copy></span></p>
  <div class="ipc-lab__viewport">
    <svg viewBox="0 0 760 240" role="img" aria-label="Four padded KV blocks and a moving read pointer">
      <g transform="translate(40 82)">
        <rect class="ipc-memory-payload" width="145" height="92" rx="8" /><rect class="ipc-memory-padding" x="145" width="35" height="92" rx="5" />
        <text class="ipc-memory-label" x="14" y="32">Block 0</text><text class="ipc-memory-sub" x="14" y="56">payload</text><text class="ipc-memory-sub" x="150" y="78" transform="rotate(-90 150 78)">padding</text>
      </g>
      <g transform="translate(220 82)">
        <rect class="ipc-memory-payload" width="145" height="92" rx="8" /><rect class="ipc-memory-padding" x="145" width="35" height="92" rx="5" />
        <text class="ipc-memory-label" x="14" y="32">Block 1</text><text class="ipc-memory-sub" x="14" y="56">payload</text>
      </g>
      <g transform="translate(400 82)">
        <rect class="ipc-memory-payload" width="145" height="92" rx="8" /><rect class="ipc-memory-padding" x="145" width="35" height="92" rx="5" />
        <text class="ipc-memory-label" x="14" y="32">Block 2</text><text class="ipc-memory-sub" x="14" y="56">payload</text>
      </g>
      <g transform="translate(580 82)">
        <rect class="ipc-memory-payload" width="145" height="92" rx="8" /><rect class="ipc-memory-padding" x="145" width="35" height="92" rx="5" />
        <text class="ipc-memory-label" x="14" y="32">Block 3</text><text class="ipc-memory-sub" x="14" y="56">payload</text>
      </g>
      <g class="ipc-gate"><line x1="202" y1="60" x2="232" y2="196" /><line x1="232" y1="60" x2="202" y2="196" /><text x="178" y="218">REJECT</text></g>
      <g data-ipc-pointer transform="translate(72 0)">
        <line class="ipc-pointer-line" x1="0" y1="42" x2="0" y2="188" /><circle class="ipc-pointer-dot" cx="0" cy="188" r="7" />
        <text class="ipc-pointer-text" data-pointer-label x="9" y="34">read pointer</text>
      </g>
    </svg>
  </div>
  <div class="ipc-lab__controls" role="group" aria-label="Memory addressing animation controls">
    <button type="button" data-ipc-step data-x="72" data-state="normal" data-title="Start with one model-wide page size" data-copy="Blue is the content used by this KV group. Yellow is the gap left behind by model-wide page-size alignment.">1. Unified page</button>
    <button type="button" data-ipc-step data-x="252" data-state="normal" data-title="The real stride crosses the gap" data-copy="stride[0] is 655,360, so the pointer must pass the yellow region before it reaches the next blue payload.">2. Real stride</button>
    <button type="button" data-ipc-step data-x="217" data-state="wrong" data-title="numel plus reshape lands inside padding" data-copy="The dense-layout assumption advances only 542,720 elements and mistakes Block 0's padding for Block 1's payload.">3. Old reshape</button>
    <button type="button" data-ipc-step data-x="217" data-state="gated" data-title="The old wrapper fails closed" data-copy="Rather than silently restore corrupted KV, it checks is_contiguous and raises ValueError.">4. Fail closed</button>
    <button type="button" data-ipc-step data-x="72" data-state="fixed" data-title="byte span plus as_strided restores the map" data-copy="The new path maps every gap and rebuilds the original stride. The pointer now visits every correct block start.">5. Fixed path</button>
    <button class="ipc-play" type="button" data-ipc-play data-play-label="▶ Auto play" data-pause-label="Ⅱ Pause">▶ Auto play</button>
  </div>
  <figcaption>The blue/yellow ratio approximates the real 542,720 / 112,640-element layout. On narrow screens the canvas scrolls horizontally instead of compressing labels.</figcaption>
</figure>

## Why one tensor can take three different IPC paths

<section class="ipc-mode-grid" aria-label="LMCache CUDA IPC wrapper selection matrix">
  <div class="ipc-mode-card"><strong><code>use_vmm_api=true</code></strong><span>Selects <code>VmmCudaIPCWrapper</code> first. Its allocation comes from CUDA VMM and needs an fd or FABRIC handle. PR #5855 repairs this path.</span></div>
  <div class="ipc-mode-card"><strong><code>isolated_ipc=true</code></strong><span>Selects <code>RawCudaIPCWrapper</code>. It uses a driver-level CUDA IPC handle and does not require shared <code>/dev/shm</code>. PR #5693 repairs this path.</span></div>
  <div class="ipc-mode-card"><strong>Both switches are false</strong><span>Selects <code>CudaIPCWrapper</code>. PyTorch storage IPC already reconstructs from storage, offset, shape, and stride.</span></div>
</section>

`use_vmm_api` has the highest priority because a VMM allocation cannot be represented by a legacy CUDA IPC memory handle. It can compose with isolated mode, but if the allocation is exportable only as a POSIX fd and the containers share no filesystem path, the deployment still needs IMEX/FABRIC or must disable isolation. Padding reconstruction cannot change that ownership constraint.

## Why the failure suddenly became common around 0.5.5

<section class="ipc-timeline" aria-label="Causal timeline of the failure">
  <div class="ipc-timeline__item"><strong>A hybrid model uses model-wide pages</strong><span>Cache groups have different content sizes, so smaller groups expose dim-0-padded views.</span></div>
  <div class="ipc-timeline__item"><strong>Format detection already accepts the layout</strong><span><code>attempt_permute_to_contiguous_view</code> verifies that only dim 0 is padded and all inner dimensions remain tightly packed.</span></div>
  <div class="ipc-timeline__item"><strong>Operator PR #4807 changes the default route</strong><span>NVIDIA deployments enable isolated IPC by default and stop sharing hostIPC or <code>/dev/shm</code>, sending more deployments into the Raw wrapper.</span></div>
  <div class="ipc-timeline__item"><strong>Raw and VMM still assume flat bytes</strong><span>The upstream validator accepts the view, but the wrapper can rebuild only dense storage and rejects registration.</span></div>
  <div class="ipc-timeline__item"><strong>#5693 and #5855 add stride-aware reconstruction</strong><span>The model layout remains unchanged; the receiver finally rebuilds the already validated view correctly.</span></div>
</section>

Padding was not new. The default transport path was. The old non-isolated PyTorch storage path preserved stride, while the new isolated default routed the same view through a Raw wrapper that understood only flat bytes.

## The repair algorithm

The old path can be reduced to:

```python
if not tensor.is_contiguous():
    raise ValueError(...)

nbytes = tensor.numel() * tensor.element_size()
raw = map_cuda_bytes(nbytes)
return raw.view(dtype).reshape(shape)
```

The new path has two parts. First, metadata computes the final address reachable through the view:

```python
byte_span = itemsize * (
    storage_offset
    + 1
    + sum((size - 1) * stride for size, stride in zip(shape, stride))
)
```

For a contiguous tensor, `byte_span` equals `numel * itemsize`. For a dim-0-padded view, it includes every inter-block gap.

Second, the receiver restores the stride instead of reshaping dense bytes:

```python
raw = map_cuda_bytes(byte_span)
tensor = raw.view(dtype).as_strided(shape, stride)
```

The operation remains zero-copy. It does not call `.contiguous()` or allocate a huge duplicate KV cache. It creates the correct view over the same shared GPU memory.

### #5693: Raw CUDA IPC

PR #5693 removes Raw's second contiguity rejection, sizes the mapping with `TensorMetadata.byte_span()`, and reconstructs with `as_strided`. Its cross-process regression test verifies the values, writes back from the consumer, and then checks that padding sentinels are untouched.

### #5855: CUDA VMM

PR #5855 applies the same algorithm to VMM. It also initializes tensor metadata before exporting the allocation so the “fits in one physical chunk” check uses the padded byte span instead of logical `numel`.

Existing VMM boundaries stay intact: non-exportable allocations still fail, multi-chunk views still fail, and a POSIX fd still cannot cross a fully isolated deployment without a delivery path. The padding fix does not weaken those ownership checks.

## Why removing the contiguity check does not accept arbitrary dangerous strides

The two changes do not permit every `as_strided` tensor through IPC.

Before either wrapper runs, `attempt_permute_to_contiguous_view()` enforces a narrow contract:

- the innermost stride must be 1;
- all inner dimensions must be tightly packed;
- only dim 0 may be wider than its logical content;
- `stride[0]` cannot be smaller than the inner product, so blocks cannot overlap;
- interior padding, arbitrary slices, and unknown layouts still fail closed.

The new boundary is therefore not “accept non-contiguous tensors.” It is “accept one validated non-contiguous layout already understood by downstream transfer kernels.”

## Why “no lookup ipc key” is easy to misread

The issue also reports a second symptom after isolated IPC is disabled:

```text
Session <ID> has no lookup ipc key, skipping touch
```

This message comes from `end_session()`. It means that the session has no `lookup_ipc_key`, so LMCache cannot refresh the recency of the corresponding L1 objects. It is not a “drop this chat request” message, and by itself it does not prove that STORE or RETRIEVE was skipped.

In the 0.5.5 lookup flow, at least two branches return before the key is recorded:

1. no registered GPU layout/context exists;
2. there is no complete chunk hash.

The reported configuration uses `chunkSize: 640`. A prompt shorter than one complete chunk naturally has nothing to look up. The reproducer also notes that a 4 GB L1 is too small for this model, preventing prefetch reservation and keeping the hit rate at zero. Together, these facts can look like every request was ignored.

The original report does not include the token count and complete server logs for the warning, so the available evidence cannot identify one unique early-return branch. What it does establish is that the warning and the padded-stride registration failure occur at different layers.

## Two related but separate vLLM problems

[vLLM Issue #54831](https://github.com/vllm-project/vllm/issues/54831) discusses the GLM-5.3 DSA indexer's `tail_cache`, page-size unification, and offloading/hash alignment. It helps explain why a hybrid model can produce extreme padding, but it is not the direct target of the LMCache wrapper fixes.

[vLLM PR #57317](https://github.com/vllm-project/vllm/pull/57317) fixes a different addressing bug: a Kpool tail ring buffer was incorrectly passed through the generic slot-mapping kernel. That change repairs vLLM's own indexing, while the LMCache changes repair cross-process stride reconstruction. A reproduction must separate the two or the first crash can mask the second.

## Takeaway

Issue #5097 is not telling us to force a non-contiguous tensor to become contiguous. It exposes a more general rule:

> A valid view can span more physical memory than its logical element count. Cross-process reconstruction that saves shape but loses stride and padding will read the wrong addresses.

PR #5693 and #5855 apply the same disciplined solution:

1. validate that only dim 0 is padded;
2. map the full byte span;
3. rebuild a zero-copy view from the original shape and stride;
4. preserve Raw and VMM allocation, export, and chunk boundaries.

It is also a reusable way to debug GPU tensors: do not stop at shape and `numel`. Walk the pointer with the stride.

## References

- [LMCache Issue #5097](https://github.com/LMCache/LMCache/issues/5097)
- [LMCache PR #5693](https://github.com/LMCache/LMCache/pull/5693)
- [LMCache PR #5855](https://github.com/LMCache/LMCache/pull/5855)
- [LMCache Operator PR #4807](https://github.com/LMCache/LMCache/pull/4807)
- [vLLM Issue #54831](https://github.com/vllm-project/vllm/issues/54831)
- [vLLM PR #57317](https://github.com/vllm-project/vllm/pull/57317)
