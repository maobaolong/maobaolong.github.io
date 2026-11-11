---
title: "CUDA VMM, POSIX FDs, FABRIC, and LMCache from First Principles"
description: "A visual, interactive introduction to legacy CUDA IPC, virtual memory management, POSIX file-descriptor exports, FABRIC handles, IMEX channels, and the memory-access negotiation between vLLM's extensible KV cache and LMCache MP."
publishedAt: 2026-11-11
category: "AI Infra"
tags:
  - CUDA
  - VMM
  - LMCache
  - vLLM
  - KV Cache
  - CUDA IPC
  - IMEX
author: "Maobaolong"
readingTime: "26 min"
featured: true
draft: false
---

The first encounter with these terms often makes them look like competing transfer protocols:

```text
VMM / FD / FABRIC / IMEX / CUDA IPC
```

That mental model creates more questions than it answers. Is an fd a file containing GPU data? Does a FABRIC handle mean the bytes must travel over NVLink? Does VMM place GPU memory in a virtual machine? If the vLLM worker and LMCache server run on the same host, why not send the GPU pointer directly? What exactly does `isolated_ipc` isolate?

This article starts from one concrete problem:

> **A vLLM worker owns a GPU KV cache. The LMCache server is a different process. How can the server safely see and map the worker's memory?**

Once that boundary is clear, VMM, POSIX file descriptors, FABRIC, IMEX, and the automatic detection in [LMCache PR #6499](https://github.com/LMCache/LMCache/pull/6499) become one causal chain rather than five unrelated terms.

The implementation status in this article is pinned to **November 11, 2026**. vLLM's extensible KV cache [#56492](https://github.com/vllm-project/vllm/pull/56492) and connector access contract [#66605](https://github.com/vllm-project/vllm/pull/66605) are merged. The exportable POSIX-fd allocation work in [#66674](https://github.com/vllm-project/vllm/pull/66674) is still open, and LMCache's auto-detection [#6499](https://github.com/LMCache/LMCache/pull/6499) is still a Draft. Follow the linked code for later changes.

<section class="vmm-hero" aria-labelledby="vmm-hero-title-en">
  <p class="vmm-kicker">CUDA memory sharing · visual field guide</p>
  <h2 id="vmm-hero-title-en">The data is not inside the handle; the handle is a capability to map the allocation</h2>
  <p class="vmm-hero__lede">Separate the physical memory, each process's address, the cross-process capability, and the channel that carries the capability. Nearly every term falls into place.</p>
  <div class="vmm-hero__legend" aria-label="Four-layer mental model">
    <span><i></i>Virtual address: how this process sees it</span>
    <span><i></i>Physical memory: where the bytes live</span>
    <span><i></i>Shareable handle: who may remap it</span>
  </div>
</section>

<nav class="vmm-map" aria-label="Article map">
  <a href="#process-address"><strong>01</strong><span>Why pointers do not cross processes</span></a>
  <a href="#legacy-ipc"><strong>02</strong><span>What legacy CUDA IPC does</span></a>
  <a href="#vmm"><strong>03</strong><span>How VMM separates address and backing</span></a>
  <a href="#fd-fabric"><strong>04</strong><span>FD, FABRIC, and IMEX</span></a>
  <a href="#vllm"><strong>05</strong><span>Why vLLM needs an extensible cache</span></a>
  <a href="#lmcache"><strong>06</strong><span>How LMCache exports and imports</span></a>
  <a href="#autodetect"><strong>07</strong><span>What auto-detection fixes</span></a>
  <a href="#checklist"><strong>08</strong><span>Deployment and debugging checklist</span></a>
</nav>

<h2 id="process-address">1. Start without CUDA: why one process cannot send a pointer to another</h2>

Suppose a vLLM worker prints this address:

```text
0x7f20_8000_0000
```

That number is not a global street address for a GPU location. It is meaningful only inside the current process and CUDA context. Another process that receives the same integer has no corresponding mapping. The same numeric address can refer to something else or to nothing at all.

CPU processes already work this way. Address `0x1234` in process A and `0x1234` in process B can map to different physical pages. Page tables translate each process's virtual addresses into physical memory. GPUs have an analogous virtual-address and mapping model.

Cross-process GPU sharing therefore needs several distinct pieces:

<section class="vmm-primer" aria-label="Parts of cross-process GPU memory sharing">
  <section><strong>1. Allocation</strong><p>The physical GPU-memory object holding K/V bytes, not the pointer in a message.</p></section>
  <section><strong>2. Local mapping</strong><p>The worker maps the allocation into its own GPU virtual address space so model kernels can use it.</p></section>
  <section><strong>3. Shareable handle</strong><p>An exportable capability that lets the server refer to the same allocation.</p></section>
  <section><strong>4. Handle transport</strong><p>The mechanism that carries the capability to the server; different handles require different channels.</p></section>
  <section><strong>5. Remote mapping</strong><p>The server imports the handle and creates a mapping in its own address space, obtaining its own pointer.</p></section>
  <section><strong>6. Lifetime</strong><p>The importer must stop using and unmap the memory before the exporter releases the allocation.</p></section>
</section>

<div class="vmm-callout"><p><strong>A pointer answers “where do I access it?” A handle answers “what authorizes me to map the same physical allocation?”</strong> The two processes do not need the same pointer value.</p></div>

<h2 id="legacy-ipc">2. Legacy CUDA IPC: the traditional path for regular allocations</h2>

The classic path starts with a regular device allocation from `cudaMalloc` or `cuMemAlloc`. Process A calls `cudaIpcGetMemHandle()` or `cuIpcGetMemHandle()` to obtain an opaque IPC handle. Process B receives the handle and calls `cudaIpcOpenMemHandle()` or `cuIpcOpenMemHandle()`. The driver creates a mapping in B and returns a device pointer valid in B.

```text
Process A                                      Process B

cuMemAlloc()                                  receive CUipcMemHandle
    │                                                  │
    ├─ local pointer                                   ├─ cuIpcOpenMemHandle()
    │                                                  │
    └─ cuIpcGetMemHandle() ── opaque handle ───────────┘
                                                       │
                                                       └─ B's local pointer
```

The handle does not contain the KV payload. Pointer values need not match, and the exporter still controls the allocation's lifetime. Most importantly, this contract fits regular CUDA allocations; it does not describe the generic physical allocation handles created through CUDA VMM. NVIDIA documents this separately as legacy IPC. See the [CUDA IPC programming guide](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/inter-process-communication.html).

When LMCache has `use_vmm_api=false`, a normal shared environment uses the PyTorch storage IPC wrapper, while `isolated_ipc=true` selects the driver-level `RawCudaIPCWrapper`. Both belong to the legacy CUDA IPC family. Neither one is a FABRIC handle.

<h2 id="vmm">3. CUDA VMM: reserve an address first, decide physical backing later</h2>

VMM means **Virtual Memory Management**. “Virtual” does not mean a virtual machine, and VMM does not automatically swap GPU memory to disk. It means the application explicitly controls the relationship between GPU virtual addresses and physical allocations.

A traditional `cudaMalloc(size)` bundles size selection, physical allocation, mapping, and pointer creation. CUDA VMM separates them:

1. `cuMemAddressReserve` reserves a virtual-address range.
2. `cuMemCreate` creates a physical allocation handle.
3. `cuMemMap` maps a physical allocation into a virtual range.
4. `cuMemSetAccess` grants device access.
5. Cleanup proceeds through `cuMemUnmap`, `cuMemRelease`, and `cuMemAddressFree`.

<figure class="vmm-lab" data-vmm-lab data-stage="0" aria-label="Interactive four-step CUDA VMM diagram">
  <div class="vmm-lab__header"><h3>Separate the address from physical backing</h3><span class="vmm-lab__counter" data-vmm-counter>1 / 4</span></div>
  <p class="vmm-lab__copy"><strong data-vmm-title></strong><span data-vmm-copy></span></p>
  <div class="vmm-lab__viewport">
    <svg viewBox="0 0 760 330" role="img" aria-label="Virtual-address slots, physical memory chunks, mappings, and an exported handle">
      <text class="vmm-label" x="42" y="48">Virtual address range</text><text class="vmm-sub" x="42" y="69">stable pointer seen by CUDA graphs</text>
      <g transform="translate(42 88)"><rect class="vmm-va-slot" width="150" height="62" rx="8"/><rect class="vmm-va-slot" x="158" width="150" height="62" rx="8"/><rect class="vmm-va-slot" x="316" width="150" height="62" rx="8"/><rect class="vmm-va-slot" x="474" width="150" height="62" rx="8"/><text class="vmm-sub" x="17" y="37">VA 0</text><text class="vmm-sub" x="175" y="37">VA 1</text><text class="vmm-sub" x="333" y="37">VA 2</text><text class="vmm-sub" x="491" y="37">VA 3</text></g>
      <path class="vmm-map-line" d="M112 154 C112 195 120 198 120 226"/><path class="vmm-map-line" d="M270 154 C270 195 290 198 290 226"/><path class="vmm-map-line" d="M428 154 C428 195 460 198 460 226"/>
      <text class="vmm-label" x="42" y="214">Physical allocations</text>
      <g transform="translate(42 226)"><rect class="vmm-physical" width="155" height="62" rx="8"/><rect class="vmm-physical" x="170" width="155" height="62" rx="8"/><rect class="vmm-physical" x="340" width="155" height="62" rx="8"/><text class="vmm-sub" x="18" y="37">chunk A</text><text class="vmm-sub" x="188" y="37">chunk B</text><text class="vmm-sub" x="358" y="37">chunk C</text></g>
      <rect class="vmm-export" x="585" y="221" width="132" height="72" rx="12"/><text class="vmm-export-text" x="651" y="249" text-anchor="middle">shareable</text><text class="vmm-export-text" x="651" y="270" text-anchor="middle">handle</text>
    </svg>
  </div>
  <div class="vmm-lab__controls" role="group" aria-label="VMM animation steps">
    <button type="button" data-vmm-step="0" data-title="1. Reserve a stable address range" data-copy="The virtual range can exist before all physical memory is committed. CUDA graphs capture stable addresses without requiring the final KV-cache size yet.">1. Reserve</button>
    <button type="button" data-vmm-step="1" data-title="2. Create physical chunks after final sizing" data-copy="After warmup and CUDA graph capture, vLLM knows the real amount of free memory and creates only the physical backing it needs.">2. Create</button>
    <button type="button" data-vmm-step="2" data-title="3. Map chunks into the reserved range" data-copy="cuMemMap attaches physical chunks to the continuous virtual address range. The model keeps seeing stable addresses while backing was chosen later.">3. Map</button>
    <button type="button" data-vmm-step="3" data-title="4. Export a physical-allocation capability" data-copy="Another process can import only a handle type requested when the physical allocation was created: a POSIX file descriptor or a FABRIC handle in this design.">4. Export</button>
    <button type="button" data-vmm-play data-play-label="▶ Play once" data-pause-label="Ⅱ Pause" aria-pressed="false">▶ Play once</button>
  </div>
  <figcaption>The diagram omits allocation granularity, device access permissions, and the strict unmap/release sequence, but preserves the ownership model.</figcaption>
</figure>

VMM is valuable because the address stays stable while backing can be bound later and controlled in physical chunks. NVIDIA also describes per-allocation peer access, fragmentation control, dynamic growth, and memory sharing. See the [CUDA VMM programming guide](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/virtual-memory-management.html).

<div class="vmm-callout vmm-callout--gold"><p><strong>Common mistake:</strong> a VMM allocation is not a regular `cudaMalloc` allocation with a new label. Its physical memory is represented by a `CUmemGenericAllocationHandle`, so legacy pointer-based IPC is not the right sharing contract.</p></div>

<h2 id="fd-fabric">4. POSIX FDs, FABRIC handles, and IMEX</h2>

A VMM physical allocation must declare its exportable handle types when it is created. LMCache currently cares about two.

### 4.1 POSIX file descriptors: the OS transfers the capability

With `CU_MEM_HANDLE_TYPE_POSIX_FILE_DESCRIPTOR`, the worker can call:

```text
cuMemExportToShareableHandle(..., POSIX_FILE_DESCRIPTOR, ...) -> fd
```

This fd is not a normal data file containing KV bytes. It is a process-local entry in the Linux descriptor table that references a driver memory object.

Serializing the integer value is insufficient. If the worker prints `fd = 17`, the number 17 in the server may name a log file or nothing at all. A real fd transfer uses ancillary data on a Unix-domain socket, specifically `SCM_RIGHTS`; the kernel installs a new descriptor in the receiving process that references the same object.

LMCache therefore has an out-of-band fd channel:

```text
/dev/shm/lmcache_fd_<port>.sock
AF_UNIX + SOCK_SEQPACKET + SCM_RIGHTS
```

The request path may still use ZMQ or gRPC over TCP. That does not make an fd transferable over TCP. Worker and server must also see the same Unix-socket path, which generally means sharing the relevant `/dev/shm` in container deployments. The exact LMCache protocol is documented in [`vmm_cuda_ipc.md`](https://github.com/LMCache/LMCache/blob/0a33e514c58585d39d5f2e59786b7fd86b0e6f49/docs/design/v1/platform/devices/cuda/vmm_cuda_ipc.md).

### 4.2 FABRIC handles: a driver-managed serializable capability

CUDA 12.4+ provides `CU_MEM_HANDLE_TYPE_FABRIC`. The exported `CUmemFabricHandle` is an opaque blob. LMCache carries its current 64-byte representation in the descriptor, so it does not require a shared Unix-socket path.

FABRIC is not free container-crossing magic. Exporter and importer must have device support, a running IMEX setup, access to the same IMEX channel, and an allocation created with the FABRIC handle type.

IMEX stands for **inter-node memory exchange**. The channel is a driver-enforced security and isolation boundary. A typical device node is:

```text
/dev/nvidia-caps-imex-channels/channel0
```

NVIDIA documents an IMEX domain as either one OS or multiple OS instances securely connected through the NVIDIA IMEX daemon. On supported NVLink-fabric systems, FABRIC handles can support inter-node mapping. That does not by itself mean LMCache MP currently implements arbitrary cross-node KV-pool mapping; here the handle solves the worker/server allocation-sharing boundary.

### 4.3 Choose the conditions and inspect the path

<figure class="vmm-handle-lab" data-vmm-handle-lab data-lang="en" aria-label="CUDA memory-handle selector">
  <div class="vmm-handle-lab__header"><h3>Change deployment conditions and observe the sharing path</h3></div>
  <div class="vmm-handle-lab__controls">
    <div class="vmm-control-group"><span>allocation</span><div><button type="button" data-choice="allocation" data-value="legacy">Regular CUDA</button><button type="button" data-choice="allocation" data-value="vmm">VMM</button></div></div>
    <div class="vmm-control-group"><span>isolated IPC</span><div><button type="button" data-choice="isolated" data-value="false">No</button><button type="button" data-choice="isolated" data-value="true">Yes</button></div></div>
    <div class="vmm-control-group"><span>same IMEX channel</span><div><button type="button" data-choice="imex" data-value="false">Unavailable</button><button type="button" data-choice="imex" data-value="true">Available</button></div></div>
  </div>
  <div class="vmm-handle-lab__viewport">
    <svg viewBox="0 0 760 245" role="img" aria-label="vLLM worker connected to LMCache server through a handle channel">
      <rect class="vmm-route-node" x="42" y="55" width="210" height="120" rx="16"/><text class="vmm-route-label" x="147" y="91" text-anchor="middle">vLLM worker</text><text class="vmm-route-sub" x="147" y="117" text-anchor="middle">owns KV allocation</text><text class="vmm-route-sub" x="147" y="140" text-anchor="middle">exports capability</text>
      <path class="vmm-route-line" d="M270 115 H490"/><path class="vmm-route-line is-muted" d="M270 145 H490"/><text class="vmm-route-sub" x="380" y="103" text-anchor="middle" data-route-transport>AF_UNIX + SCM_RIGHTS</text><text class="vmm-route-sub" x="380" y="169" text-anchor="middle">KV bytes stay in GPU memory</text>
      <rect class="vmm-route-badge" data-route-badge x="320" y="116" width="120" height="34" rx="17"/><text class="vmm-route-badge-text" data-route-badge-text x="380" y="138" text-anchor="middle">POSIX FD</text>
      <rect class="vmm-route-node" x="508" y="55" width="210" height="120" rx="16"/><text class="vmm-route-label" x="613" y="91" text-anchor="middle">LMCache server</text><text class="vmm-route-sub" x="613" y="117" text-anchor="middle">imports handle</text><text class="vmm-route-sub" x="613" y="140" text-anchor="middle">maps same allocation</text>
    </svg>
    <div class="vmm-route-mobile" role="img" aria-label="vLLM worker connected to LMCache server through a handle channel">
      <div class="vmm-route-mobile__node"><strong>vLLM worker</strong><span>owns KV allocation</span><span>exports capability</span></div>
      <div class="vmm-route-mobile__channel"><span data-route-transport>AF_UNIX + SCM_RIGHTS</span><i aria-hidden="true"></i><strong data-route-badge-text>POSIX FD</strong><small>KV bytes stay in GPU memory</small></div>
      <div class="vmm-route-mobile__node"><strong>LMCache server</strong><span>imports handle</span><span>maps same allocation</span></div>
    </div>
  </div>
  <div class="vmm-handle-lab__result" aria-live="polite"><strong data-handle-title></strong><p data-handle-copy></p></div>
</figure>

The compressed rule is: regular allocations use legacy IPC; VMM allocations use a shareable handle requested at creation time. A non-isolated deployment can use a POSIX fd. An isolated deployment generally needs FABRIC plus a shared IMEX authorization domain.

<h2 id="vllm">5. Why vLLM needs VMM: CUDA graphs want stable addresses, but the KV cache wants late sizing</h2>

The KV cache often consumes most of the available GPU memory. vLLM historically had to size it before CUDA graph capture because captured graphs bake in addresses.

The final free-memory amount is only clear after graph capture, warmup, attention workspaces, sampling buffers, and speculative-decoding initialization. Early profiling either underestimates and risks OOM, or reserves excessive slack and wastes memory that could hold KV cache.

vLLM [#56492](https://github.com/vllm-project/vllm/pull/56492) uses VMM to break that dependency:

```text
before graph capture: reserve a large virtual-address range
during capture/warmup: keep those addresses stable
after final sizing: create and map only the required physical chunks
```

The model sees stable pointers while physical backing is chosen after final sizing. The V2 CUDA and ROCm model runners enable the extensible cache by default.

External connectors introduce another constraint. A virtually contiguous segment may contain multiple physical chunks. RDMA registration may require a single physical allocation, and LMCache MP needs to export that allocation to another process. vLLM cannot choose correctly unless each connector declares how it accesses the cache.

That is the purpose of `KVCacheAccess` from merged PR [#66605](https://github.com/vllm-project/vllm/pull/66605):

| Access | Connector behavior | Allocation requirement |
|---|---|---|
| `IN_PROCESS` | kernels or copies inside the worker | any allocation |
| `REGISTERS` | UCX/RDMA registration | one physical chunk per segment |
| `EXPORTS_FD` | another process imports a POSIX fd | single chunk, fd-exportable |
| `EXPORTS_FABRIC` | another process imports a FABRIC handle | single chunk, FABRIC-exportable, IMEX |
| `LEGACY_IPC` | connector only supports legacy IPC | extensible VMM cache is incompatible |

The direction matters: vLLM does not parse LMCache-private flags. LMCache declares its memory-access contract, and vLLM combines that with platform support, IMEX availability, and other `MultiConnector` children.

As of November 11, 2026, the contract is merged, while actual `EXPORTS_FD` backing for extensible allocations remains in [#66674](https://github.com/vllm-project/vllm/pull/66674). An enum value existing in main does not imply every allocator path can already produce it.

<h2 id="lmcache">6. The LMCache MP path: export a handle, register a tensor view</h2>

The vLLM worker owns the GPU KV cache. LMCache server must map it from another process before it can store or retrieve blocks. The complete path has six steps:

<section class="vmm-sequence" aria-label="LMCache VMM KV-cache registration sequence">
  <section><strong>1. Declare connector access</strong><p>Before allocation, return `EXPORTS_FD`, `EXPORTS_FABRIC`, or `LEGACY_IPC` so vLLM knows the sharing requirement.</p></section>
  <section><strong>2. Resolve the allocation</strong><p>vLLM combines platform support and all connectors to choose extensible mode and requested handle types.</p></section>
  <section><strong>3. Select the LMCache wrapper</strong><p>The worker follows the resolved extensible/cuMem state and selects `VmmCudaIPCWrapper`; an explicit `use_vmm_api` remains an override.</p></section>
  <section><strong>4. Export the physical handle</strong><p>The wrapper locates the allocation behind the pointer and exports a POSIX fd or 64-byte FABRIC handle together with shape, stride, and offset metadata.</p></section>
  <section><strong>5. Deliver descriptor and capability</strong><p>A FABRIC handle travels with the descriptor. A POSIX fd must travel over the fd channel through `SCM_RIGHTS`, paired to the request by an export ID.</p></section>
  <section><strong>6. Import and map on the server</strong><p>The server imports the same physical allocation, reserves and maps its own address, then rebuilds the tensor view. Registration does not copy the whole KV pool.</p></section>
</section>

The request channel and fd channel have different jobs:

```text
ZMQ / gRPC request channel
  └─ config, tensor metadata, export IDs, status

AF_UNIX fd channel (POSIX-fd path only)
  └─ the real descriptor capability via SCM_RIGHTS

GPU allocation
  └─ KV bytes remain on GPU; both processes map the same object
```

FABRIC avoids the fd channel because its handle is copyable opaque data, but replaces the shared-filesystem dependency with an IMEX authorization dependency. Neither path is universally “more advanced”; they represent different deployment and security boundaries.

<h2 id="autodetect">7. Why automatic detection is necessary</h2>

Previously users had to set:

```json
{
  "lmcache.mp.use_vmm_api": true
}
```

But vLLM's final allocation is resolved from model-runner behavior, platform capabilities, extensible mode, cuMem allocator settings, connector access, IMEX, and possibly multiple connector children. Asking the user to predict that result creates a circular dependency:

```text
LMCache: Are you using VMM? I need to select a wrapper.
vLLM: How do you need to share memory? I need to select an allocation.
```

[LMCache #6499](https://github.com/LMCache/LMCache/pull/6499) splits this into two phases:

1. **Declare requirements before allocation.** With no explicit override, normal IPC returns `EXPORTS_FD`, isolated IPC returns `EXPORTS_FABRIC`, and explicit false returns `LEGACY_IPC`.
2. **Follow the resolved result after allocation.** During worker-adapter construction, LMCache derives the real mode from vLLM's resolved `enable_extensible_kv_cache` or `enable_cumem_allocator` state.

Explicit true/false values remain authoritative for compatibility and rollback. Older vLLM revisions without `KVCacheAccess` receive `None` and retain import compatibility.

<div class="vmm-matrix">
<table>
  <thead><tr><th>User setting</th><th>Pre-allocation declaration</th><th>Worker behavior</th><th>Main requirement</th></tr></thead>
  <tbody>
    <tr><td>unset</td><td><code>EXPORTS_FD</code></td><td>follow vLLM's resolved allocation</td><td>fd-exportable extensible allocation and a shared fd-channel path</td></tr>
    <tr><td>unset + isolated</td><td><code>EXPORTS_FABRIC</code></td><td>follow vLLM's resolved allocation</td><td>FABRIC support and the same IMEX channel on both sides</td></tr>
    <tr><td><code>false</code></td><td><code>LEGACY_IPC</code></td><td>force legacy wrapper</td><td>vLLM must not select a VMM-only sharing path</td></tr>
    <tr><td><code>true</code></td><td>FD or FABRIC</td><td>force VMM wrapper</td><td>the actual allocation must export the matching handle</td></tr>
  </tbody>
</table>
</div>

<section class="vmm-timeline" aria-label="vLLM and LMCache VMM pull-request sequence">
  <section><time>Nov 2, 2026 · merged</time><strong>vLLM #56492</strong><p>Reserve addresses before capture and map physical KV-cache chunks after final sizing.</p></section>
  <section><time>Nov 10, 2026 · merged</time><strong>vLLM #66605</strong><p>Add `KVCacheAccess` so connectors declare registration, fd, FABRIC, or legacy requirements.</p></section>
  <section><time>Nov 11, 2026 · open</time><strong>vLLM #66674</strong><p>Create fd-exportable extensible allocations for `EXPORTS_FD` and compose FABRIC handle types.</p></section>
  <section><time>Nov 11, 2026 · Draft</time><strong>LMCache #6499</strong><p>Declare access automatically and make the worker follow vLLM's resolved allocation.</p></section>
</section>

The complete production path exists only when the access contract, allocation support, LMCache export/import implementation, and deployment environment all agree.

<h2 id="checklist">8. Deployment and debugging checklist</h2>

### Determine the allocation family first

- Is vLLM using the extensible KV cache or the cuMem allocator?
- Did LMCache select `VmmCudaIPCWrapper` from the resolved engine configuration?
- Do not infer the result only from whether the user wrote `use_vmm_api`.

### For POSIX FDs

- Does the device support `CU_MEM_HANDLE_TYPE_POSIX_FILE_DESCRIPTOR`?
- Was the allocation created with that requested handle type?
- Can worker and server see `/dev/shm/lmcache_fd_<port>.sock`?
- Did the Linux fd channel start and connect?
- Never serialize the raw fd integer as if it were the capability.

### For FABRIC

- Does the device report FABRIC-handle support?
- Is `nvidia-caps-imex-channels` present?
- Can exporter and importer access the same channel device?
- Did allocation creation request the FABRIC handle type?
- For `CUDA_ERROR_NOT_PERMITTED`, inspect IMEX access before tensor geometry.

### For legacy IPC

- Is the allocation truly regular CUDA memory rather than VMM backing?
- Does the exporter remain alive and retain ownership?
- Does the importer close its mapping before release?
- Does an isolated deployment use the raw wrapper instead of shared storage IPC?

Finally, handle success only proves that the process obtained the memory object. Rebuilding the correct tensor still requires dtype, shape, stride, storage offset, and byte span. Hybrid-model padding is a separate layer; see [How a Legal Memory Gap Breaks LMCache CUDA IPC](/en/blog/lmcache-padded-kv-cuda-ipc/).

## Four sentences to keep

1. **VMM is an allocation model** that separates virtual-address reservation from physical-memory creation and mapping.
2. **FD and FABRIC are shareable-handle types for VMM allocations**, not KV payloads or ordinary network protocols.
3. **FD relies on the OS to transfer a capability; FABRIC relies on the driver and an IMEX authorization domain.**
4. **Auto-detection is a two-phase negotiation:** LMCache declares access needs, vLLM resolves allocation, and the worker follows the resolved result.

The vLLM worker and LMCache server each have their own pointer. The handle lets both pointers map the same physical allocation. Cross-process sharing is not about sending an address; it is about securely transferring the capability to create a valid mapping.

## References

- [CUDA Programming Guide: Interprocess Communication](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/inter-process-communication.html)
- [CUDA Programming Guide: Virtual Memory Management](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/virtual-memory-management.html)
- [CUDA Driver API: Virtual Memory Management](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__VA.html)
- [vLLM #56492: Extensible KV cache](https://github.com/vllm-project/vllm/pull/56492)
- [vLLM #66605: Connector KV-cache access contract](https://github.com/vllm-project/vllm/pull/66605)
- [vLLM #66674: Exportable extensible KV cache for LMCache MP](https://github.com/vllm-project/vllm/pull/66674)
- [LMCache #6499: Auto-detect VMM KV cache allocation](https://github.com/LMCache/LMCache/pull/6499)
- [LMCache VMM CUDA IPC design](https://github.com/LMCache/LMCache/blob/0a33e514c58585d39d5f2e59786b7fd86b0e6f49/docs/design/v1/platform/devices/cuda/vmm_cuda_ipc.md)
