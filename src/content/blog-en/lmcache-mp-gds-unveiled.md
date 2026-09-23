---
title: "Unveiling the Mysteries of GDS: How LMCache MP Integrates KV Cache into NVMe"
description: "Starting with the DMA of SSD controllers, PCIe address mapping, and GPU registers, this article uses seven animated diagrams to walk through the initialization, STORE, and RETRIEVE of LMCache MP, and explains how the backend can be extended using Phoenix."
publishedAt: 2026-09-21
category: "AI Infra"
tags:
  - lmcache
  - gds
  - kv-cache
  - nvme
  - gpu
  - phoenix
author: "Maobaolong"
readingTime: "35 min"
featured: true
draft: false
---
GPU-computed data, why compute it again?

Long document Q&A, multi-turn dialogues, and shared prefixes of agents repeatedly raise this question. Saving the KV Cache can avoid some redundant pre-filling, but as the context grows longer, finding space to save it becomes increasingly difficult: GPU memory must be reserved for the model and the requests being executed, while host memory has limits on capacity, cost, and bandwidth.

Thus, we naturally think of local NVMe SSDs. Then another question arises: **If every time we read KV from the SSD it has to go through CPU memory before being transferred to GPU memory, will the benefits of storage be offset by the transfer costs?**

GDS operates along this path. However, behind the "SSD direct to GPU" concept, there is still a lot of work involved. Who initiates the read/write? Does the kernel still participate? Why are there still temporary GPU buffers in the code? When a Python function returns, does the data really arrive?

This article uses **[PR #5271][pr5271] merged LMCache structure** as a baseline and only elaborates on the read/write path of `LMCacheDrivenTransferModule` in MP mode. The source code link is fixed to [`c9b51e42`][snapshot] for easy line-by-line comparison; the extended example uses the Phoenix implementation from this code.

<figure class="gds-video">
  <video controls playsinline preload="metadata" poster="/videos/blog/lmcache-mp-gds/poster.jpg" aria-label="Unveiling GDS, animated explanation in Chinese with embedded subtitles">
    <source src="/videos/blog/lmcache-mp-gds/lmcache-mp-gds-unveiled.mp4?v=technical-terms" type="video/mp4" />
    <track kind="chapters" src="/videos/blog/lmcache-mp-gds/chapters-en.vtt?v=technical-terms" srclang="en" label="Chapters" />
    Your browser cannot play this video. Please use the download link below.
  </video>
  <figcaption>Video version · 16 minutes 50 seconds · Chinese AI neural voice narration, embedded subtitles, technical terms retained in English. Data block movement demonstration STORE / RETRIEVE, extended example is Phoenix. <a href="/videos/blog/lmcache-mp-gds/lmcache-mp-gds-unveiled.mp4?v=technical-terms">Download MP4</a> · <a href="/videos/blog/lmcache-mp-gds/subtitles-en.vtt?v=technical-terms">Subtitles</a> · <a href="/videos/blog/lmcache-mp-gds/transcript-en.txt?v=technical-terms">Transcript and chapter timings</a></figcaption>
</figure>

<nav class="gds-toc" aria-label="Article Table of Contents">
  <a href="#gds-basics">1. Understanding Devices and Terminology</a>
  <a href="#gds-config">2. Configuration and Backend Selection</a>
  <a href="#gds-init">3. Initialization: Connecting Resources</a>
  <a href="#gds-store">4. STORE: From Paging KV to SSD</a>
  <a href="#gds-retrieve">5. RETRIEVE: From SSD Back to Paging KV</a>
  <a href="#gds-async">6. Async: Who Waits for Whom</a>
  <a href="#gds-extend">7. Extending with Phoenix as an Example</a>
  <a href="#gds-future">8. Capacity and Scalability</a>
</nav>

<h2 id="gds-basics">1. Understanding Devices and Terminology</h2>

### 1.1 Why KV Cache Amplifies Capacity Issues

When a Transformer processes a token, it generates the Keys and Values needed for each layer of Attention. By retaining them, there is no need to regenerate all K/V for the same prefix next time.

For models using conventional Attention or GQA, ignoring additional metadata, the logical capacity of a KV can be roughly expressed as:

```text
KV bytes ≈ 2 × number of layers × number of KV heads × head dimension
             × number of tokens × bytes per element × sequence length
```

Here, the `2` represents K and V, and **the number of KV heads does not necessarily equal the number of query heads**. For example, with 32 layers, 8 KV heads, head dimension of 128, and BF16 with 2 bytes per element: each token requires about 128 KiB; a context of 128 Ki tokens requires about 16 GiB; 64 non-shared contexts total about 1 TiB.

This is just a calculation for understanding the scale, not a measurement of a specific model. Tensor parallelism will change the shares held by each card, while prefix sharing, quantization, sliding windows, and model structure will also affect actual capacity. But the trend is clear: **the product of context length and the number of requests to retain quickly exceeds the economic boundaries of single-machine GPU memory and even host DRAM.**

The value of NVMe is to allow more KV that "might be hit again later" to be retained. After a hit, the necessary parts are sent back to the GPU, replacing some redundant calculations. It does not allow the Attention kernel to directly access the SSD as if it were GPU memory.

### 1.2 GDS is the Path, NVMe is the Medium

An SSD is a device for storing bytes; NVMe is the protocol for accessing such high-speed storage, commonly connecting local NVMe SSDs via PCIe. The HBM/GPU memory of the GPU is the storage space used during computation, while CPU DRAM is the host memory. They are not the same thing.

In this article, GDS refers broadly to mechanisms that directly exchange data between storage and device memory; NVIDIA's specific product is called GPUDirect Storage, and cuFile is the interface it exposes to applications.

The common path for regular reads is:

```text
SSD → CPU memory staging area → GPU memory
```

The direct data path of GDS aims to become:

```text
SSD ←→ GPU memory
```

What it saves is **the transfer of the payload through CPU DRAM**, not the complete removal of the CPU from the system. Native libraries may also take a compatible path if conditions are not met, so "calling the GDS API" does not equal "confirming that direct DMA occurred." [NVIDIA's explanation of direct paths and compatibility modes][nvidia-overview]

<figure class="gds-anim" data-gds-scene="physical" aria-label="Control path and data path animation">
  <figcaption>Figure 1: When reading a segment of KV, the CPU is responsible for organizing the work, while the SSD controller handles data transfer. Dashed lines represent control, solid lines represent payload.</figcaption>
  <p class="gds-fallback">User-space submits requests, the kernel and driver establish device mappings, manage files and I/O, and the SSD controller writes bytes into the GPU buffer via PCIe DMA, finally reporting completion. The direct path does not go through CPU DRAM staging.</p>
</figure>

Following the order in Figure 1, let's place each participant back in their position:

1. **User-space programs run on the CPU.** The Python and later C/C++ native libraries of LMCache belong to this layer. They decide which file to read, which offset, how many bytes, and where to send them in the GPU buffer.
2. **Kernel-space code also runs on the CPU.** The kernel is responsible for permissions, file and device management; the driver cooperates to establish device address mappings for DMA use. The file system also needs to translate file offsets into underlying storage locations. User-space and kernel-space are permission boundaries, not two different processors.
3. **The actual payload is moved by DMA hardware on the storage side.** In this article's local NVMe direct read path, the DMA engine in the SSD storage controller retrieves the data, initiates a PCIe write transaction with the target address, and sends the bytes to the specified address mapped to the GPU endpoint. It is not the CPU copying byte by byte with instructions, nor is it a GPU compute core running a "read SSD" kernel.
4. **The GPU is also an addressable device on PCIe.** It exposes accessible memory ranges to other devices through mapping mechanisms like BAR (Base Address Register). The driver first associates the GPU virtual addresses used by the application with addresses available for DMA, and then the PCIe interconnect routes the transaction to the GPU endpoint, where the GPU accesses the corresponding memory. **The GPU pointer seen by Python cannot be directly treated as a bus address used by the SSD**, nor can any GPU memory be accessed by any SSD.
5. **Completion must also be observed and ordered.** The device reports I/O completion, and the native library and stream mechanism connect it to subsequent tasks; computation cannot read data that has not yet arrived just because a command was issued.

This is the general division of labor for understanding direct I/O, and it does not mean that all backends follow the same kernel call chain. For example, the hot path of uGDS organizes NVMe commands in user space, but device takeover and memory mapping still require initialization support. [GDS design documentation][nvidia-design], [uGDS installation and device binding][ugds-install]

Conversely, when saving KV, the SSD controller can initiate a PCIe read request to the mapped GPU address, receive the returned data, and then write it to the storage medium. The direction of read/write changes, but the storage-side DMA initiating the transfer remains the same. The visible range of BAR, P2P routing, IOMMU/ACS configuration, and driver support together determine whether this path can be established; "bypassing CPU DRAM" does not mean that all PCIe transactions bypass the root complex where the CPU resides. This discussion pertains to local NVMe scenarios; for remote storage, the transfer initiator may also be the DMA engine of a network card.

### 1.3 Six Terms That Will Reappear

| Concept | Meaning in this article | Do not confuse with |
| --- | --- | --- |
| block | A unit of allocation for paging KV in the inference engine; block ID is used to locate the actual GPU page | A sector of the SSD |
| chunk | A cache unit organized by LMCache for a segment of tokens; a chunk can cover multiple engine blocks | A necessarily contiguous segment of engine memory |
| slab | A pre-allocated large block of storage address space, from which small areas are allocated to store cache objects | Creating a file for each request, or the slab allocator in the Linux kernel |
| buffer | A segment of memory that has been allocated. This article focuses on the GPU staging buffer held by LMCache | CPU staging memory |
| handle | A reference to a resource that has been opened or registered. OS fd, GDS file handle, and stream handle refer to different resources | The data itself, or the physical address on disk |
| stream | An ordered work queue in GPU runtime that organizes kernels, I/O, and events | Python threads, or a dedicated PCIe channel |

Additionally, there is **Submission**: it retains the parameters and result storage needed for a particular native asynchronous call. It differs from a buffer, typically consisting of a few `ctypes` scalars in CPU memory, not storing entire blocks of KV data.

### 1.4 Slab: Turning NVMe into Allocatable Cache Space

LMCache does not open a small file for each KV. The file-based backend prepares `lmcache_gds_slab.bin` in a specified directory, pre-allocating capacity; the allocator only allocates offsets within this space.

For example, if a cache object is allocated to `(offset=64 MiB, size=8 MiB)`, it means: "The bytes of this KV are located in this segment of the slab." `GDSMemoryObject` retains this type of metadata; **it is not a CPU tensor containing KV**; its `tensor` and `raw_tensor` are both `None`. [Object implementation][memory-src], [slab allocator][allocator-src]

The figure also shows a completely different set of coordinates: **the registration area of the GPU buffer**. First, a contiguous GPU staging buffer is allocated, and then the range within it is registered with the GDS library, which and the driver establish the mappings required for DMA. Registration does not copy a KV, nor does it partition on the SSD.

Assuming this buffer is 32 MiB, starting at GPU virtual address `B`. Currently, LMCache registers up to 16 MiB per segment; for illustration, we call the first two segments R0 and R1, where R stands for region:

| Figure Name | GPU Virtual Address Range in the Same Allocation | Base Address Registered for I/O |
| --- | --- | --- |
| R0 | `[B, B + 16 MiB)` | `B` |
| R1 | `[B + 16 MiB, B + 32 MiB)` | `B + 16 MiB` |

**They are not two GPUs, nor are they two fixed partitions on GPU hardware, nor are they two slabs.** They are two ranges of the same memory allocated by software for registration and addressing. The virtual addresses in the table still need to be mapped to DMA addresses usable by the device.

<figure class="gds-anim" data-gds-scene="slab" aria-label="Slab address and GPU registration area animation">
  <figcaption>Figure 2: R0/R1 are two registered ranges of the same GPU buffer, each 16 MiB. File offsets and GPU buffer offsets are two sets of coordinates; an 8 MiB object crossing registration boundaries is split into two I/O operations.</figcaption>
  <p class="gds-fallback">The object covers the slab from 64–72 MiB. The target GPU slice starts from 12 MiB within the first 16 MiB registered area: the first transfer moves 4 MiB, and the second transfer moves another 4 MiB from the start of the next registered area.</p>
</figure>

The slab capacity and GPU staging buffer capacity are not the same thing. The slab can be large, while the staging buffer only needs to accommodate a batch of chunks being transferred, which can be reused once used. **NVMe capacity does not need to match the amount of GPU memory.**

Another pitfall to avoid: this GDS L1 path manages temporary caches, **not a persistent KV database that automatically recovers after a restart.** The file-based slab is truncated and reallocated during initialization; metadata indexes are not stored on disk. Even if the original device of uGDS retains old bytes, it does not mean that the old cache index will be restored. [File preparation logic][file-src]

<h2 id="gds-config">2. Configuration and Backend Selection</h2>

### 2.1 From the User's Perspective: Changing the Storage Medium of L1

On a machine with matching LMCache, inference engine, and GDS driver stack already installed, the focus of server configuration is on these parameters. Below is a **schematic for NVIDIA/cuFile scenarios**; `/mnt/nvme/lmcache` should be the NVMe directory prepared for caching, and should not be shared with other service instances.

```bash
lmcache server \
  --port 5555 \
  --supported-transfer-mode lmcache_driven \
  --l1-size-gb 128 \
  --eviction-policy LRU \
  --gds-l1-path /mnt/nvme/lmcache \
  --gds-l1-backend cufile
```

`--gds-l1-path` enables GDS L1, and `--l1-size-gb` controls the slab capacity at this time, not allocating an equal size of CPU DRAM. In this configuration, GDS L1 and CPU pinned-DRAM L1 are mutually exclusive, rather than secretly adding a cache layer behind DRAM. `--gds-l1-use-direct-io` is enabled by default, and the file-based backend uses it to control `O_DIRECT`. [Configuration definitions][config-src]

The inference engine still communicates with the LMCache server through the MP connector. The model startup commands and version pairing are not elaborated here; the [LMCache Quickstart][quickstart] can be used; GPU KV data depends on device IPC mapping, not on stuffing large tensors into request messages. Full environment requirements can be found in the [GDS L1 configuration documentation][gds-doc].

This L1 path does not expose a pool of KV bytes that can be directly read by the CPU, so do not connect L2 adapters that depend on `byte_array` or registerable L1 memory areas in the same way. This article adopts the minimal scenario of only configuring GDS L1.

### 2.2 Four Backends, Differences Beyond Just Library Names

| Backend | Where the Data is Stored | Native Dependencies and Major Limitations |
| --- | --- | --- |
| `cufile` | File system slab | NVIDIA GPU, matching CUDA/GDS stack, `libcufile.so`, and a Python binding that provides `cufile.bindings`. The direct path also depends on the GPU, driver, file system, and PCIe topology. |
| `hipfile` | File system slab | AMD GPU, ROCm/hipFile runtime, and `libhipfile.so`. LMCache binds C ABI itself, not relying on the hipFile Python package. The fast path must simultaneously satisfy kernel P2PDMA, runtime, amdgpu, and mounted volume conditions. |
| `ugds` | A portion of the address space of a dedicated raw device | **Open-source software stack from the ScaleX Lab at the Hong Kong University of Science and Technology (Guangzhou), not a specific SSD hardware, nor a product from NVIDIA/AMD.** Includes user-space `libugds.so` and kernel modules required for device takeover and mapping. The current public implementation supports NVIDIA CUDA and AMD HIP/ROCm, and this article's LMCache encapsulation only connects to these two paths; not all models are automatically available. The path is `/dev/ugds_drvX`, and a capacity query API is required. **Existing data on dedicated SSDs may be corrupted.** |
| `phx` | File system slab | The current LMCache encapsulation accepts CUDA/ROCm PyTorch builds; it also requires the Phoenix `phoenixfs` kernel module, a user-space library matching the accelerator, and the actual loaded `libphxfile.so` shim, and must provide stream-ordered asynchronous symbols. Checking through Python does not guarantee that the underlying device is supported. |

"Do I need specific kernels or OS patches?" cannot be answered uniformly in four lines. Some new NVMe P2PDMA deployments of cuFile can already operate without relying on `nvidia-fs` and custom NVMe patches, but there are clear kernel and driver conditions; hipFile must verify the capabilities required for the fast path, and may fall back to host-bounce if missing; uGDS requires device takeover; Phoenix requires matching running kernel compiled modules, and has system requirements such as IOMMU and BAR mapping. **Installing a Python package cannot replace these conditions.** [NVIDIA deployment instructions][nvidia-overview], [hipFile installation][hip-install] and [fast path checks][hip-check], [uGDS installation][ugds-install]

The project affiliation of uGDS can be seen in the [ScaleX-IO organization introduction][ugds-org], and the two implementation paths for CUDA/HIP can be seen in the [uGDS project description][ugds-project]. This description pertains to the current publicly supported range, not implying that this software technology will forever only support these two vendors.

The meaning of `auto` is also quite restrained: the current default choice is to use cuFile on CUDA and hipFile on ROCm. It does not pick the fastest backend after running a benchmark once, nor will it automatically switch to Phoenix if cuFile fails. uGDS and Phoenix require explicit selection.

### 2.3 Why Phoenix Deserves a Separate Mention

The names cuFile and hipFile naturally carry vendor connotations; [Phoenix][phoenix] is positioned as a lower-level, open I/O stack aimed at various xPUs: it connects applications above and different accelerators below through user-space connectors and kernel P2P backends. It attempts to allow a single storage I/O design to be reused across multiple devices, rather than just creating another Python wrapper.

However, "unification" is an architectural direction, not a promise that "all cards and all file systems have been validated." The support matrix for Phoenix is still evolving, and LMCache's `phx` encapsulation also has its own platform checks. Actual deployment must satisfy conditions on both sides. [Project source code and description][phoenix], [installation guide][phx-install]; for background reading, see this [WeChat article](https://mp.weixin.qq.com/s/zgbhdjKZlH4gvLI22kKoGg).

Particularly note the library name: the core of Phoenix is `libphoenix.so`, while the current LMCache `phx` backend connects through **the `phxFile*` shim ABI of `libphxfile.so`**. Finding the former does not prove that the latter can be loaded. [Actual loader][phx-src]

<h2 id="gds-init">3. Initialization: Connecting Resources</h2>

Now we will walk through the source code. First, remember a relationship without vendor names:

```text
MP server
  ├─ StorageManager → L1Manager → GDSL1MemoryManager
  │                              Allocates slab offsets, manages cache objects
  └─ GDSContext → GDSBackend → GDSHandle
                 Manages registration/drivers    Asynchronous read/write for a registered slab
```

The two lines above solve "where is this KV stored" and "how to move the bytes." Cache keys, object locks, hits, and evictions belong to the first line; library loading, handles, buffers, streams, and I/O belong to the second line. They connect through the offset and size of `GDSMemoryObject`.

### 3.1 Discovering Names Does Not Equal Importing Implementations

When the MP server starts, `MPCacheServerContext` calls `initialize_gds_context(...)`. `GDSContext.initialize()` aligns slab capacity and then calls `create_backend(config.backend)`. [Startup entry][engine-src], [GDSContext][context-src]

The new structure places implementations in `gpu_connector/gds_backends/`. The factory scans the package directory, ignoring private modules and `base`, to obtain available module names. **Scanning the directory does not execute the Python code of each backend.**

When explicitly configuring `phx`, it imports `gds_backends.phx`, checks whether the exported `Backend` inherits from `GDSBackend`, constructs an object, and calls `validate_environment()`. When configuring `auto`, it imports candidates in module name order, calling the class method `is_default()`, stopping at the first match. The latter may import more than one Python module, but should not load native storage libraries. [Discovering and selecting implementations][factory-src]

<figure class="gds-anim" data-gds-scene="init" aria-label="Backend selection and lazy load animation">
  <figcaption>Figure 3: Three different "preparations." Discovering module names, constructing Python objects, and loading native libraries are not the same thing. The figure uses explicit backend selection.</figcaption>
  <p class="gds-fallback">After scanning names, only the selected module is imported; constructing the Backend still does not load the driver. The open_slab prepares storage and registers the handle, requiring the native library; subsequently registering the GPU staging buffer and stream.</p>
</figure>

This is the two-layer meaning of lazy import: **unselected implementations do not need to be imported; optional native dependencies of selected implementations are also delayed until actual use.** Therefore, listing configurations or importing common code should not fail in environments where not all vendor libraries are installed.

### 3.2 open_slab: Backend Explains the Storage Location Itself

`GDSContext` only calls:

```python
handle = backend.open_slab(location, size, direct_io)
```

For implementations inheriting from `FileGDSBackend`, the common logic is: create the directory and slab file, truncate, pre-allocate, close the fd for the preparation phase, then reopen with the required direct-I/O flags, and register it with the specific backend's `open_handle()`. The returned `GDSHandle` has fd and native registration relationships. [File-based parent class][file-src]

uGDS interprets the raw device path itself, checks device type and capacity, and then opens the corresponding range. The general context does not need to write "if the backend is called ugds, do not create files." This is where polymorphism comes into play: **the same operation interface, but the meaning of resource preparation is determined by the object itself.**
OS fd and GDS handle: why coexist? fd indicates which file or device a process has opened; the native GDS handle indicates that the repository recognizes this fd and is ready to associate it with its own I/O path. Registration does not copy file contents, nor does it mean that any KV read/write has been completed.

### 3.3 load lib and binding functions: what exactly is bound

cuFile imports `cufile.bindings` when needed for the first time, accessing `libcufile`; the encapsulations of hipFile, uGDS, and Phoenix use `ctypes.CDLL(...)`. Then, it declares `argtypes` and `restype` for the native functions. [cuFile implementation][cufile-src], [hipFile implementation][hipfile-src]

This is not dynamically renaming Python functions. It tells Python's FFI: "The first parameter is an opaque handle, the second is the GPU address, followed by several integer pointers, and the return value is some C structure or integer."

If a 64-bit pointer is mistakenly treated as a 32-bit integer, or if `size_t*` is passed as a value, it can lead to type errors or, worse, the native library reading the wrong address. Therefore, ABI binding, error code interpretation, and specific alignment requirements should remain in the implementation. The generic layer should not guess each vendor's C ABI.

The backend that explicitly opens the driver reuses the parent class's `_driver_opened` state and switch logic, providing two native hooks: `_open_driver()` and `_close_driver()`. This state belongs to a backend instance; **there is no cross-instance shared driver manager or reference counting**. Phoenix retains its own implicit initialization path: it encapsulates the `phxFileDriverOpen` symbol but does not explicitly call it, cleaning up the loaded shim upon closure. [Public interface][base-src], [Phoenix implementation][phx-src]

### 3.4 Registering KV and registering GDS buffer are not the same thing

The inference worker first hands over the IPC information of the GPU KV tensor to the MP server. LMCache imports these handles, establishing a mapping to the worker's GPU memory in its own process, while also establishing information about layers, layouts, blocks, etc. **What is mapped is still the GPU memory owned by the worker, not a copy of the KV to the server's CPU memory.**

LMCache's device cache context allocates its own temporary GPU buffer. It is divided by `(batch, object group, kernel group)`; the object-level byte view is used for read/write storage, while the kernel-group view is used for layout transport. These views point to the same allocation and do not copy data each time a view is sliced. [GPU temporary buffer implementation][temp-src]

Then, on the transport stream of that context, `GDSContext.register_gpu_buffer()` is called:

- **Stream registration** allows the native library to recognize this queue; some implementations require actual registration, while some shims are no-ops, but each I/O still carries the stream.
- **Buffer registration** prepares the storage stack for the DMA mapping of this segment of GPU memory and requires the allocation to remain valid during registration and unfinished I/O.
- **Region registration** divides the large buffer into registration areas of up to 16 MiB, recording the base address and length of each area for subsequent slice addressing.

16 MiB is the segmentation limit adopted by this LMCache implementation, not a universal definition of the GDS concept. In Figure 2, the target slice starts at 12 MiB within the area; even if the object is only 8 MiB, it must be split into two 4 MiB I/Os at the 16 MiB boundary. [Registration and segmentation logic][context-src]

<h2 id="gds-store">4. STORE: From paginated KV to SSD</h2>

Now assume the worker has computed a segment of KV to save to GDS L1. First, let's look at the complete data sequence:

```text
Worker's paginated KV GPU memory
  → GPU gather / layout transfer
  → LMCache continuous GPU staging buffer
  → GDS WRITE
  → NVMe slab
```

<figure class="gds-anim" data-gds-scene="store" aria-label="STORE step-by-step animation">
  <figcaption>Figure 4: First gather, then write to disk. A–D represent four pieces of schematic data within a chunk; block ID is a demonstration value, not an address from a real run.</figcaption>
  <p class="gds-fallback">Waiting for the worker's producer event; reserve_write obtains the slab object; gather the paginated KV into a continuous GPU staging buffer by block IDs; after identifying GDSMemoryObject, submit WRITE; finally, publish completion in stream order.</p>
</figure>

### Step 1: Prepare keys and block IDs, wait for the worker to finish writing

The entry point is [`LMCacheDrivenTransferModule.store()`][store-src]. The request passes in the cache key, instance ID, various groups of GPU block IDs, and the producer event handle from the worker side.

The server finds the registered cache context, parses the chunk and object-group corresponding object key, checks if the number of block IDs is sufficient, and then organizes and moves the ID list to the GPU. At this point, only a small amount of **address index metadata** is moved, not the entire KV payload.

Next, the producer event is imported, and it waits on the transport stream. Without this step, LMCache's gather kernel may read KV that the worker has not yet finished writing. The wait here adds dependencies to the queue without requiring the CPU to wait in place for the GPU to complete every time.

### Step 2: reserve_write only allocates space, does not move data

For each object group, store calls `StorageManager.reserve_write(..., "new")` according to its layout. The GDS L1 allocator returns a `GDSMemoryObject`, which records slab offset, physical size, and other information.

This step determines "where this object can be written." Existing entries that should not be written or have not been allocated may not be included in the return results. Therefore, the transfer list may contain `None`, and STORE will skip the corresponding entries. Objects also do not become cacheable just because "allocation succeeded."

### Step 3: transfer_kv_per_object_group first executes gather

Store calls [`transfer_kv_per_object_group()`][transfer-src], with the direction set to `D2H`, and the current STORE's `batch_size` fixed at 1.

The function first checks the object list. As long as there is a `GDSMemoryObject`, it will not enter the native merge transfer plan for ordinary objects but will follow this explicit staging path.

For the object group to be transported, it further traverses kernel groups. Here, the responsibilities of the two groups differ: **the object group determines which bytes are together as cache objects; the kernel group determines which layers can execute the transport using the same layout rules.** An object can consist of results from multiple kernel groups.

The function calculates the range, window, and skipped parts of the current batch of block IDs, then calls `device_ops.multi_layer_block_kv_transfer(...)`. This GPU kernel gathers the corresponding KV from each layer to the correct area of the staging buffer based on the engine's layout and block IDs.

Figure 4 deliberately arranges physical blocks as `2, 4, 7, 9`, while the logical order is `7, 2, 9, 4`. The SSD has no idea which ID corresponds to which layer's tensor and will not rearrange for us; this is the job of LMCache's GPU transfer kernel.

### Step 4: Discover GDS object, switch to storage I/O

After all relevant kernel groups are gathered, the function calls `lmcache_memcpy_async_d2h(temp_buffer, memory_obj)`.

Note that `D2H` and the `d2h` in the function name are directional tags in the unified transfer interface. **In the GDS branch, this step does not move the payload to Host memory.** `gpu_ops.py` identifies the object via `isinstance(memory_obj, GDSMemoryObject)` and directly transfers to:

```python
get_gds_context().transfer_async(
    memory_obj, gpu_buffer, SlabDirection.WRITE
)
```

Thus, `store()` itself does not need to know whether cuFile or Phoenix was chosen. The object type determines whether it is a storage read/write, and the backend object then decides how to submit the native call. [Object diversion entry][gpuops-src]

### Step 5: Translate object location into one or more native WRITE calls

`GDSContext.transfer_async()` retrieves the object's `slab_offset` and `get_size()`, then checks which registered area the GPU slice falls into.

Each call requires five types of information: the registered area's `buf_base`, this `size`, the slab's `file_offset`, the `buf_offset` relative to that registered base address, and the current `raw_stream`. **buf_base should be the originally registered area base address and should not be arbitrarily replaced with any slice's address.** The starting difference of the slice is expressed by `buf_offset`.

When encountering a region boundary, it splits and then calls the slab handle's `write_async(...)`. This handle holds the corresponding backend; the cuFile implementation calls `cuFileWriteAsync`, while other implementations call their own native APIs. The common caller only sees the `GDSHandle` interface. [GDSContext's WRITE][context-src], [cuFile asynchronous implementation][cufile-src]

### Step 6: Queue completion, does not mean the cache has been published

Each `write_async()` returns a `Submission` that will be retained by the context. Store records a completion event on the same stream and queues a `finish_write` callback along the successfully submitted path, waiting for the previous transport to complete before notifying the cache management layer to end the write and make the object available.

What is returned to the worker is an exportable event handle and request status. The worker can establish subsequent dependencies based on this; **returning once via RPC should not be understood as the CPU having synchronized and waited for all DMA, nor as power-off persistence confirmation.** `finish_write` is also not `fsync`.

There is a boundary of implementation that needs to be preserved: the success status here can reflect whether the submission path threw an exception, but it cannot be advertised as having checked every delayed I/O error one by one. The completion results in `Submission` and its lifecycle are matters of another level, which will be discussed later.

### Why KV cannot be directly written to SSD

It is not physically impossible, but **the current LMCache's object layout and storage interface require conversion**:

- The engine's KV is scattered across different layers and physical blocks, and the logical token order does not have to equal the address order; the storage interface accepts continuous ranges and does not recognize the block table.
- Different models or layer groups may have different shapes, strides, and layouts. Staging provides a stable object representation, keeping model layout knowledge in the GPU transfer kernel, avoiding the need for each storage backend to implement it again.
- Pre-registered, repeatedly reused small staging blocks are easier to manage than tracking large engine allocations per request. Especially under MP, the worker's KV GPU memory belongs to the worker, and LMCache only maps and uses it according to the protocol.
- Merging into larger continuous I/Os can avoid splitting a chunk into many fragmented random reads and writes, while also facilitating the handling of registration boundaries and alignment.

The cost is also real: occupying a bit more GPU memory increases the internal gather/scatter workload. GDS eliminates host data transfer, **but does not promise to eliminate all copying or layout conversions**. If future support for distributed I/O, different disk layouts, or direct registration of engine buffers is implemented, this layer's correctness and performance trade-offs will still need to be redesigned.

<h2 id="gds-retrieve">5. RETRIEVE: From SSD back to paginated KV</h2>

Reading is not just replacing all STORE function names with read. The preparations on both ends and the final published objects have changed:

```text
NVMe slab
  → GDS READ
  → LMCache continuous GPU staging buffer
  → GPU scatter / layout transfer
  → Worker’s current allocation of paginated KV GPU memory
```

<figure class="gds-anim" data-gds-scene="retrieve" aria-label="RETRIEVE step-by-step animation">
  <figcaption>Figure 5: First read the object into staging, then scatter. Hitting the same KV does not require the target GPU block IDs to be the same as when saved.</figcaption>
  <p class="gds-fallback">Parse key and target block IDs, queue target dependencies, and then obtain the locked object; GDS READ reads slab bytes into the GPU staging buffer, then scatters according to the new block IDs; after the completion event, end the read and release the lock.</p>
</figure>

### Step 1: Hit the key, not a fixed GPU address

The previous lookup/prefetch process confirms retrievable objects and establishes the locks needed for reading. Here, we focus on the case of hitting the local GDS L1.

[`LMCacheDrivenTransferModule.retrieve()`][retrieve-src] first parses the keys of each object group. The hit content still corresponds to the original slab position, not the GPU address at the time of saving.

The GPU block IDs in the request are **the targets to be written in this recovery**. For example, when saved from `[7, 2, 9, 4]`, it may be written to `[3, 11, 0, 6]` during recovery. The prefix content is the same, but it does not mean the engine allocated the same set of physical pages.

### Step 2: Establish dependencies before hitting the target GPU memory

Retrieve also checks block IDs, prepares indices on the GPU, and waits for the producer event on the LMCache transfer stream. For reading, this dependency ensures that the preceding device work related to the target meets protocol requirements, avoiding conflicts between recovery operations and tasks still using the target area.

It passes `skip_first_n_tokens` to subsequent logic. The shared prefix that has been hit cannot be arbitrarily overwritten; otherwise, other requests may be reading these GPU pages. The window-related skips will also affect which objects enter the transfer; not every time will all historical chunks be restored at once.

After queuing the dependencies in the stream, retrieve selects keys based on the valid window of each object group, obtains the locked `GDSMemoryObject` through `read_prefetched_results()`, and then hands it over to the transport helper. These are CPU-side organizational steps; queuing a wait does not mean the CPU has already waited for the GPU event to complete.

### Step 3: Read staging first, temporarily avoid final paginated positions

When calling `transfer_kv_per_object_group()`, the direction changes to `H2D`, and the batch size can use the context's `max_batch_size`.

The function first calls `lmcache_memcpy_async_h2d(memory_obj, temp_buffer)` for this batch of objects. `gpu_ops` then recognizes `GDSMemoryObject` and converts it to `SlabDirection.READ`. Similarly, **H2D in this branch does not represent reading the payload from CPU DRAM**.

The subsequent area parsing, cross-region segmentation, and STORE are the same, only the final call is to `GDSHandle.read_async()`. The bytes of continuous objects in NVMe are sent to the registered GPU staging buffer.

### Step 4: After data is in place, scatter according to this batch's block table

After this batch of READ is queued, `multi_layer_block_kv_transfer(...)` queues according to kernel group, writing the object representations from staging back to the correct engine KV layout for each layer.

Reading occurs first, scattering follows, and using the same stream, the storage repository's promised stream-ordered semantics ensures that scatter will not preemptively read incomplete I/O results.

This also explains why GDS cannot automatically reach all final targets with a single `read(fd, ptr, length)`: **the targets may be non-contiguous multi-layer, multi-page areas, with layout transformations and rules of "not overwriting the previous several tokens."** The storage repository is responsible for moving bytes, not for interpreting the model's block table.

### Step 5: Protecting ranges and failure semantics

In the transport helper, STORE can skip over `None` if it does not obtain the write object; however, RETRIEVE cannot silently skip missing objects that need to be restored, or else the worker may consume unrecovered data. The caller will fill in the prefix positions of the skipped window with `None` to maintain index correspondence; the actual execution range will not read these empty positions.

`skip_first_n_tokens` affects the final scatter's write range; it **does not necessarily mean that the underlying GDS READ will read fewer bytes accordingly**. The current implementation typically restores the complete object to staging first, then skips the protected portions during GPU layout transport. [Object group transfer logic][transfer-src]

### Step 6: Release the cache-side read lock after completion

Retrieve records a completion event on the stream and queues a `finish_read_prefetched` callback. Only after the previous read and scatter are complete can the cache management layer end the corresponding read and release the lock held this time.

Here, there are two types of protection: **event/stream protects the order of device reads and writes; object locks protect the slab area from being evicted or reused during reading.** They cannot replace each other.

At this point, STORE and RETRIEVE can be compressed into a set of symmetric relationships:

| Stage | STORE | RETRIEVE |
| --- | --- | --- |
| Cache-side preparation | Request write object and slab position | Obtain hit object and maintain read lock |
| GPU layout processing | Gather before GDS | Scatter after GDS |
| Storage action | Staging → slab, WRITE | Slab → staging, READ |
| Final wrap-up | `finish_write` publishes write | `finish_read_prefetched` ends read |

<h2 id="gds-async">6. async: Who waits for whom</h2>

### 6.1 async is not "open a Python thread"

The core of this path is **the separation of submission and completion**. The CPU queues kernels, storage I/O, and events sequentially to the stream, then can continue organizing subsequent work. When the native API returns, the I/O may not have actually started yet.

"The same stream" provides order but does not guarantee that adjacent tasks run in parallel. There is also no automatic order between different streams; dependencies need to be established via events or other synchronizations. Whether concurrency can bring benefits depends on the device, library implementation, storage queue, and workload; one cannot simply infer overlap from function names containing `Async`. [cuFile asynchronous API contract][nvidia-api]

Phoenix's stream-ordered implementation is particularly intuitive: host-driven DMA is invisible to the GPU runtime itself, so it uses host callbacks queued in the stream to execute I/O, integrating "this I/O is complete" into the order of the stream. This does not mean that the KV payload has passed through CPU memory. [Phoenix's stream-ordered explanation][phoenix]

### 6.2 Why Submission must outlive function calls

The native async interface receives several parameters as **pointers**, not immediate copies of Python integers. For example:

```text
Submission
  size         → Length for the native library to read later
  file_offset  → Slab offset for the native library to read later
  buf_offset   → GPU registered area offset for the native library to read later
  result       ← Result written back after the native library completes
```

If these `ctypes` objects are garbage collected after the Python function returns, the native call may continue to use invalid addresses. Therefore, each handle's `read_async()` / `write_async()` returns a `Submission`, which the context holds until it can prove that the corresponding operation has been completed. [Submission definition][base-src]

<figure class="gds-anim" data-gds-scene="async" aria-label="Submission and stream checkpoint animation">
  <figcaption>Figure 6: This example happens to reach the 64th submission. The CPU has returned, but that does not mean parameters can be released; only after the checkpoint event following these operations completes can this batch of Submission be reclaimed.</figcaption>
  <p class="gds-fallback">Submission first enters uncommitted; at the checkpoint, it enters inflight with the event. When event.query is false, it continues to hold; when true, it can be released. The result field and the entire GPU payload are not in the same place.</p>
</figure>

`GDSContext` groups submissions by raw stream: first accumulating to `uncommitted`; every 64 submissions record a checkpoint event, moving this batch to `inflight`; only when an earlier event is queried as complete can the corresponding batch of Python references be released. A small number of submissions that do not reach the next checkpoint will continue to be retained until subsequent checks or synchronous cleanup.

The events here are used to manage **the lifetime of native parameters**. The completion event returned to the worker earlier is a protocol for cross-process operation completion, and the two should not be considered for the same purpose.

One must also be precise: the current checkpoint reclamation logic queries events, **without checking each `Submission.bytes_done` for negatives or short reads/writes**. The interface reserves space for completion results, but this does not mean the upper layer has completed a full chain error audit. When discussing correctness, "completed in order," "parameters still valid," and "successfully transmitted the expected number of bytes" are three different propositions. [Submission reclamation implementation][checkpoint-src]

### 6.3 Who owns resources is responsible for final cleanup

The worker owns the original paginated KV allocation; LMCache's device context holds the imported IPC mapping and owns its own staging buffer and transport stream; the process-level `GDSContext` holds the backend, slab handle, buffer/stream registrations, and unfinished submissions.

When shutting down, it first waits for the relevant device work to complete, then deregisters buffers and streams, closes the slab's registration handle and fd, and finally closes the native driver. Simply nullifying Python variables cannot replace synchronization or native deregistration.

There can still be a process-level `GDSContext` entry. **Object-oriented design does not prohibit any process-level objects but clarifies state ownership, allowing business operations to depend on interfaces rather than switching implementations by replacing module functions.**

### 6.4 GPU staging and "no bounce buffer" are not contradictory

At least three types of buffers need to be distinguished:

1. **CPU DRAM bounce buffer**: The host data transfer that GDS's direct path hopes to avoid.
2. **LMCache GPU staging buffer**: The area that converts the engine's paginated layout and continuous cache objects, which is always visible in this article's STORE/RETRIEVE.
3. **A GPU staging pool of some underlying library**: Determined by the backend implementation and runtime mode, which may exist additionally.
For example, the [Phoenix Installation Guide][phx-install] referenced in this article describes two BAR mapping modes: STAGING, which can perform D2D through Phoenix's own GPU pool, and FULL, which has different constraints for direct mapping and RDMA coexistence. This is not the same layer as the layout staging of LMCache, and one cannot claim "zero D2D" just because there is "no CPU intermediary." The deployment should be based on the version of Phoenix being used.

<h2 id="gds-extend">7. Using Phoenix as an Example: Where to Modify for a New Backend</h2>

### 7.1 First Clarify Responsibilities Along Interfaces, Rather Than Copying a Large File

Phoenix has already implemented this in the code. We treat it as a complete access sample: assuming it does not yet exist, a file-based backend using existing device interfaces should be placed in:

```text
lmcache/v1/gpu_connector/gds_backends/phx.py
tests/v1/gpu_connector/gds_backends/test_phx.py
```

The former module exports `Backend`, while the latter tests its native ABI, error handling, and resource management. Phoenix uses a file-based slab, so `Backend` inherits from `FileGDSBackend`, reusing the file preparation process; `AsyncHandle` inherits from `GDSHandle`, reusing resource ownership and fd cleanup.

There is no need to reinvent a unified dispatcher, nor to write a new backend list in `__init__.py`.

<figure class="gds-anim" data-gds-scene="extension" aria-label="Phoenix Access Modification Boundary Animation">
  <figcaption>Figure 7: The public layer no longer registers the name of Phoenix. Implementation and testing remain in the backend directory, while library loading, ABI, and native resource management are handled by the phx object.</figcaption>
  <p class="gds-fallback">The original Phoenix access required modifications to configuration enumerations and the central dispatcher; the new structure discovers phx.py by directory, reusing the file-based parent class, with the Phoenix backend and handle interfacing with libphxfile. Driver installation and hardware validation still need to be completed.</p>
</figure>

The operations to be implemented can be divided into four groups by responsibility, without needing to memorize a list of methods:

| Responsibility | What Phoenix is Responsible For | What Can Be Inherited |
| --- | --- | --- |
| Selection and Environment | Set `name="phx"` and use `validate_environment()` to check the current encapsulation's supported CUDA/ROCm builds; explicit selection, not participating in default preemption | General directory discovery, explicit selection, default non-restrictive platform behavior of the parent class |
| Storage and Driver | Load `libphxfile.so` and bind ABI on first use of `library()`; wrap registered fd in `open_handle()`; clean up loaded shim in `close_driver()` | File slab preparation, handle fd cleanup; no need to forcibly apply explicit driver-open processes |
| Registration and Unregistration | Hand over files, device buffers, and streams to the corresponding `phxFile*` interfaces, unregistering upon completion | Public context arrangements for registration timing, retaining tensors, segmenting, and closing order |
| Asynchronous Read/Write | Handle's `read_async/write_async` translates common parameters, calls shim, and returns a `Submission` with retained parameters | Unified calling shapes, context stream grouping, and Submission lifecycle tracking |

Selectors only look at interfaces; file-based parent classes only prepare files; Phoenix subclasses only interpret their own native API. Ordinary inheritance and polymorphism are sufficient; there is no need to swap module functions at runtime. [Complete Phoenix Implementation][phx-src]

### 7.2 Phoenix is Not Just a Renamed cuFile

Phoenix precisely demonstrates why ABI details should not be placed in the public layer:

- **Libraries and Symbols.** It interfaces with `libphxfile.so`, not directly calling `libphoenix.so`. The loader checks for the existence of `phxFileReadAsync/WriteAsync`, avoiding incompatibilities that might only be exposed when old shims actually transfer data.
- **Parameters and Error Codes.** The shim accepts fd registered handles; read/write accepts length, two offsets, and a pointer for completion results, immediately returning an integer status. The Python wrapper converts negative statuses into exceptions and cannot simply replicate another library's error structure.
- **Offset Order.** The shim adopts a calling shape with file offsets first and buffer offsets second, while the order in the core Phoenix library is different, with conversions left inside the shim. Callers cannot assume ABI compatibility just because names are similar.
- **Stream and Driver.** `phxFileStreamRegister` has only stream parameters, without flags like cuFile; the current shim's registration is a no-op, but each asynchronous I/O still carries a stream. The wrapper continues to use implicit initialization, not explicitly calling driver open, and cleans up loaded shims upon closure.

These differences still exist, but with clear attribution. STORE and RETRIEVE do not need to know about them; `GDSContext` does not need to write a separate branch for Phoenix.

### 7.3 Where Changes Are Reduced

Comparing with the historical [Phoenix access PR #4673][pr4673], fixed to `b771e5ef`, five files were modified at that time, totaling `+971 / -26`: configuration documents, two existing production files, and the newly added wrapper and tests. [Fixed Version Differences][phx-files]

| Task | Original Access Method | New Structure Location |
| --- | --- | --- |
| Accept Backend Name | Modify enumerations and definitions in `distributed/config.py` | Directory discovery has accepted module names, no need to modify the whitelist; help documentation can be supplemented separately |
| Selection and Calling Implementation | Modify imports and dispatch branches in `_gds_async.py` | No need to modify the public factory or `GDSContext` |
| Native Wrapper | Add `_phx_async.py` | New `gds_backends/phx.py`, inheriting from the public class |
| Testing and Usage Documentation | Add tests, update documentation | Still needs to be done, tests placed in the corresponding directory |

Thus, for this Phoenix access using existing device interfaces, **the original modifications to the backend registration in the two existing production files can be reduced to zero necessary changes in the central registration.** The two old files had a total of 58 lines added or removed, but this also included help documentation; it does not guarantee that the new solution will necessarily delete 58 lines, nor that all native code will be eliminated.

The main benefit lies in the change boundary: reviews can focus on checking the native contracts and corresponding tests in `phx.py`, without requiring changes to the scheduling code shared by all backends.

### 7.4 Interfaces Are Extensible, But Hardware Readiness Is Not Automatic

The kernel module, user-space library, and shim of Phoenix still need to be installed and matched with hardware. Currently, `phx.py` accepts CUDA/ROCm builds; if another device runtime is integrated in the future, the device layer's raw stream, memory registration, and lifecycle interfaces must also be completed. **Adding repositories** and **integrating new device platforms** are two separate matters; directory discovery cannot be advertised as "zero-cost support for any hardware."

Testing should also focus on boundaries: checking the lifespan of native parameters and output parameters, cleanup on failure, stream order, loading libraries only on first use, and ensuring new modules can be discovered. There is no need to repeat testing of Python's own inheritance mechanism for each subclass.

<h2 id="gds-future">8. Capacity and Scalability: What is the Significance of GDS?</h2>

Bringing in SSDs does not suddenly give them HBM latency. Whether caching reuse is cost-effective still needs to be compared: **Is the cost of recovering KV from NVMe less than the cost of re-prefilling?** Hit rate, chunk size, I/O concurrency, SSD bandwidth, PCIe topology, GPU layout transport, and write amplification will all affect the answer. Since no benchmarks are provided here, one should not claim that a certain backend is always faster.

However, as long contexts, more concurrent sessions, and reusable prefixes accumulate, merely expanding DRAM will become increasingly expensive. **Local NVMe provides capacity, while GDS attempts to reduce the transport costs of "utilizing this capacity."** Currently active KV remains on the GPU, and caches that need to be reused are recovered, which is the value of this design.

Phoenix explores a unified storage-to-xPU I/O stack at a lower level; LMCache unifies caching objects, layout transport, resource lifecycle, and storage interfaces at a higher level. Both address different layers of problems and can complement each other, but cannot replace one another. The device support extension for Phoenix still needs verification, and the device platform bridging for LMCache also needs to be completed.

Looking back at this restructuring, the methods are not mysterious:

- First, clarify who owns resources, who waits for completion, and who interprets layouts.
- Place common behaviors in the parent class, leaving real differences in the implementation.
- Let callers rely on `GDSBackend` and `GDSHandle`, allowing implementations to prepare slabs, load libraries, and interpret native ABIs themselves.
- Use directory discovery and lazy imports to free "adding implementations" from "editing the central list," while maintaining clear error boundaries.

Finally, GDS can be distilled into several concrete tasks: **Find the right caching area, prepare DMA-capable GPU memory, queue reads and writes to the correct stream, retain all resources still referenced by native code, and publish or reclaim them upon completion.**

"SSD direct to GPU" is not magic. The real challenge, and what is truly worth understanding, is how this path seamlessly connects with the paging KV of inference engines, the process boundaries of MP, and the asynchronous lifecycle.
## Source Code and Further Reading

The source code in the main text is fixed to the same LMCache version; the block IDs, offsets, and data blocks in the animations are educational examples, not performance measurements.

- [LMCache New Structure Snapshot][snapshot], [GDSBackend / GDSHandle Interface][base-src], [Backend Discovery][factory-src].
- [STORE / RETRIEVE][store-src], [Object-Group Transfer][transfer-src], [GDSContext][context-src].
- [LMCache GDS L1 Configuration][gds-doc], [Quickstart][quickstart].
- [NVIDIA GDS Overview][nvidia-overview], [Design Documentation][nvidia-design], [cuFile API][nvidia-api].
- [hipFile Installation][hip-install], [Fast Path Check][hip-check], [uGDS Installation][ugds-install].
- [Phoenix Project][phoenix], [Installation Guide][phx-install], [Architecture Documentation][phx-arch].
- [Phoenix Original Access PR][pr4673] and its [Fixed Version Differences][phx-files].

[pr5271]: https://github.com/LMCache/LMCache/pull/5271
[snapshot]: https://github.com/LMCache/LMCache/tree/c9b51e424acf4d88d9c18ed95828bd234a205b5f
[pr4673]: https://github.com/LMCache/LMCache/pull/4673
[phx-files]: https://github.com/LMCache/LMCache/compare/5f62d2814ec9a66db07549fdb194a96fdc2610a3...b771e5efc6ea1e600be6d93849760148b7a82148
[base-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_backends/base.py
[factory-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/_gds_backends.py
[file-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_backends/_file.py
[cufile-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_backends/cufile.py
[hipfile-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_backends/hipfile.py
[phx-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_backends/phx.py#L192
[context-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_context.py
[checkpoint-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gds_context.py#L341
[engine-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/multiprocess/engine_context.py#L214
[store-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L525
[retrieve-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/multiprocess/modules/lmcache_driven_transfer.py#L778
[transfer-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/multiprocess/object_group_transfer.py#L379
[gpuops-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/gpu_connector/gpu_ops.py
[temp-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/platform/devices/cuda/cache_context.py#L60
[memory-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/memory_management.py#L1051
[allocator-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/distributed/memory_manager/gds_l1_memory_manager.py
[config-src]: https://github.com/LMCache/LMCache/blob/c9b51e424acf4d88d9c18ed95828bd234a205b5f/lmcache/v1/distributed/config.py#L465
[gds-doc]: https://docs.lmcache.ai/mp/configuration.html#gds-l1-tier
[quickstart]: https://docs.lmcache.ai/mp/quickstart.html
[nvidia-overview]: https://docs.nvidia.com/gpudirect-storage/overview-guide/index.html
[nvidia-design]: https://docs.nvidia.com/gpudirect-storage/design-guide/index.html
[nvidia-api]: https://docs.nvidia.com/gpudirect-storage/api-reference-guide/index.html
[hip-install]: https://rocm.docs.amd.com/projects/hipFile/en/latest/install/install.html
[hip-check]: https://rocm.docs.amd.com/projects/hipFile/en/latest/how-to/checking-system-compatibility.html
[ugds-install]: https://github.com/ScaleX-IO/uGDS/blob/main/docs/installation.md
[ugds-org]: https://github.com/ScaleX-IO
[ugds-project]: https://github.com/ScaleX-IO/uGDS
[phoenix]: https://github.com/xPU-IO/Phoenix
[phx-install]: https://github.com/xPU-IO/Phoenix/blob/5c37071f3660a768d970dceb78a6c189c477af00/doc/install.md
[phx-arch]: https://github.com/xPU-IO/Phoenix/blob/5c37071f3660a768d970dceb78a6c189c477af00/doc/architecture.md
