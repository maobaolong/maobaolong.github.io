---
title: "Understanding Pinned Memory from LMCache PR #4830: An Analysis of Silent KV Cache Corruption"
description: "Starting from pageable memory, pinned memory, device support matrices, and asynchronous copying, this analysis explores how LMCache can cause silent data corruption due to raw pointer lifetimes and incorrect synchronization boundaries."
publishedAt: 2026-09-03
updatedAt: 2026-09-03
category: "AI Infra"
tags:
  - lmcache
  - cuda
  - pinned-memory
  - async-copy
  - kv-cache
  - debugging
author: "Maobaolong"
readingTime: "18 min"
featured: true
draft: false
---
Recently, I read [LMCache PR #4830](https://github.com/LMCache/LMCache/pull/4830). This PR has minor changes: two synchronization logic updates and a set of regression tests. However, the issue it addresses is quite typical—GPU asynchronous copy has not completed, while the CPU side memory has already been read or reused, ultimately leading to silent corruption of the KV Cache.

The term "silent" refers to the system not crashing, CUDA not reporting errors, and the shape and dtype of the Tensor being normal; it's just that the data inside is incorrect. The PR author observed that while running engine-driven pickle transport on 8 H100s, the GSM8K score dropped from `0.80` to `0.00` directly; in targeted reproductions, the number of corrupted blocks decreased from 4000 to 0 after the fix.

The key issues here are not whether the copy function was called, but three deeper questions:

1. Is the CPU memory suitable for asynchronous access by the GPU?
2. When the CUDA call returns, has the copy really completed?
3. Before the copy is complete, who is responsible for ensuring that the memory remains valid and has not been reused?

This article starts with pinned memory and clarifies the complete causal chain of this issue.

## Why Ordinary CPU Memory Is Not Suitable for Direct Asynchronous Transfer

Processes typically see virtual addresses. The operating system maps a segment of virtual addresses to actual physical memory pages through a page table. Ordinary CPU memory is usually pageable memory, meaning it can be paged.

When memory pressure is high, the operating system can swap out temporarily unused pages to the swap area—usually located on disk or SSD; when accessed again, the pages are swapped back into physical memory. Even without swapping, the physical pages corresponding to virtual addresses are managed by the operating system, and applications cannot assume they will remain stable in their original locations.

Accessing this type of memory is not a problem for the CPU: page faults, page swaps, and page table updates are handled by the operating system. However, GPU DMA or asynchronous transfers cannot suddenly find that the target physical page has been swapped out while executing halfway. Devices need a set of physical pages that remain stable in location during the transfer and will not be reclaimed or swapped out by the operating system.

This is what page-locked memory, or pinned memory, is all about.

![Difference between Pageable Memory and Pinned Memory](/images/blog/lmcache-pinned-memory/pageable-vs-pinned-en.svg)

The "pin" in pinned memory locks the physical pages. It brings several important features:

- Pages will not be swapped out to swap during the pinning period;
- Devices can rely on stable physical pages to complete DMA or mapped access;
- Host-to-Device (H2D) and Device-to-Host (D2H) transfers can be truly executed asynchronously;
- The cost is that these physical memories cannot be flexibly reclaimed by the operating system, and allocation and deallocation are more expensive than ordinary memory.

Therefore, more pinned memory is not always better. Frameworks typically maintain a cache pool to reuse already allocated pinned memory, avoiding the need to request page-locked pages from the operating system for every transfer.

It's essential to distinguish between two concepts:

> Page-locked only means the operating system will not swap out the physical pages; it does not mean the user-space allocator will never reuse this memory.

When the last reference to a pinned Tensor disappears, PyTorch may return this memory to its caching host allocator. The next time a pinned memory of the same size is requested, this address may be immediately reused and written with new data.

## What `pin_memory()` Actually Does

In PyTorch, you can directly allocate a pinned Tensor:

```python
x = torch.empty(shape, device="cpu", pin_memory=True)
```

You can also convert a regular CPU Tensor into a pinned Tensor:

```python
pinned_x = x.pin_memory()
```

The second form can be misleading: it typically does not just add a marker to the original Tensor in place, but rather allocates new pinned memory and copies the original data over.

```text
x:         Regular CPU Tensor
                  │ Copy
                  ▼
pinned_x:  New pinned CPU Tensor
```

This means `pinned_x` is a new object that needs to be managed separately in terms of its lifecycle. If it is just a local variable in a function, it may immediately enter the allocator's reuse process after the function returns without any other references.

### Does Pinning Host Memory Require a GPU?

Not necessarily. The operating system itself has the capability to lock memory pages, such as Linux's `mlock()`; it does not require a GPU to be present on the machine. However, this only addresses the issue of "keeping the pages in RAM."

To allow a specific accelerator to access this memory directly via DMA, it usually requires calling the registration interface of that device's runtime, such as CUDA's `cudaHostRegister`, MUSA's `musaHostRegister`, or AscendCL's `aclrtHostRegister`. The runtime needs to establish address mappings available to the device, account for them, and check hardware and driver capabilities. Therefore, in PyTorch, requesting an accelerator-aware pinned Tensor typically requires the corresponding PyTorch backend, driver, and runtime to be available; having only a CPU without a device runtime environment does not guarantee the success of `torch.empty(..., pin_memory=True)`.

Indeed, some devices or software stacks do not support this type of pinning or only support part of it. At least two capabilities need to be distinguished here:

1. **Allocating a new pinned buffer**: For example, `torch.empty(pin_memory=True)`, where PyTorch and the current device backend choose an appropriate host allocator.
2. **Registering an existing host area**: For example, passing POSIX SHM, NUMA buffers, or Device-DAX's `mmap` area to `HostRegister`. This requires LMCache to have a raw-pointer registration implementation for the corresponding vendor runtime.

Success in the former does not guarantee that the latter is also supported.

### Pinning Is a Necessary Condition for Direct Asynchronous Transfer, but Not Sufficient

If a device needs to continue reading from or writing to the same host buffer after the CPU call has returned, this memory usually must first be pinned/registered. Otherwise, the device cannot assume that the underlying physical pages remain resident and stable during the transfer, and the runtime can only take one of the following actions:

- Reject true asynchronous transfer;
- Degrade the operation to synchronous;
- First copy the data to an internal pinned staging buffer, then perform DMA from there.

Thus, it is correct to say "you can safely perform asynchronous transfers only after pinning," but a complete statement should add:

> Pinning ensures the physical pages remain stable during device access; the program must also ensure that the Tensor, storage, or registered area remains alive until the event completes or synchronization ends. Pin memory and object lifecycle are both essential.

### Which Devices Currently Support Pin Memory in LMCache

The following inventory is based on the LMCache `dev` branch as of September 3, 2026, at commit [`00db3ced`](https://github.com/LMCache/LMCache/commit/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9). The basic `PinMemoryBackend` of LMCache does not support registration by default; only devices that actively provide a backend will set `is_pin_supported` to true.

| Device Backend | New Allocated Pinned Buffer | Register Existing Host Area | Current Conclusion |
| --- | --- | --- | --- |
| NVIDIA CUDA | Supported by PyTorch | `cudaHostRegister` / `cudaHostUnregister` | Both paths are integrated, still based on runtime detection results |
| Moore Threads MUSA | Supported by TorchMUSA | `musaHostRegister` / `musaHostUnregister` | Both paths are integrated, requires TorchMUSA to expose corresponding interfaces |
| Huawei Ascend NPU | Depends on torch-npu allocator | `aclrtHostRegister` / `aclrtHostUnregister` | Raw-pointer registration is integrated, falls back to synchronous copy on failure |
| Intel XPU | Has a dedicated path, PyTorch will use SYCL USM host allocation | No LMCache raw-pointer registration backend provided | Can use newly allocated pinned staging, but cannot assume any SHM/mmap can be registered |
| AMD ROCm | Depends on PyTorch/HIP pinned allocator | Inherits CUDA backend, detects CUDA-compatible interfaces | No independent HIP registration implementation; availability must be based on actual runtime detection |
| CPU, RBLN, Neuron, HPU | Not guaranteed as LMCache's accelerator-aware pinned allocator | No LMCache raw-pointer registration backend provided | Uses ordinary memory or synchronous/framework fallback paths |

This table describes **code integration capabilities**, not "just because the device name is in the table, it can pin on any machine." Drivers, runtime symbols, device context, process page-locking quotas, and whether the registration interval meets alignment requirements can all cause runtime registration to fail. Therefore, LMCache extensively uses capability detection and safe fallback rather than hardcoding based solely on device names.

Related implementations can be directly cross-checked from the source code: [`DeviceSpec` default capabilities and distribution](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/platform/base/device_spec.py), [CUDA backend](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/platform/cuda/pin_memory.py), [MUSA backend](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/platform/musa/pin_memory.py), [Ascend NPU backend](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/platform/npu/pin_memory.py), and the [SYCL USM host allocation path for XPU](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/platform/torch_ops.py).

### What Specific Uses Has LMCache Made of Pin Memory

In LMCache, this capability not only speeds up a single `copy_()` but currently supports several specific paths:

- **CPU L1 KV Cache and Transfer Staging Buffer**: LMCache can reserve and reuse pinned CPU memory, avoiding the need to temporarily register pages for each H2D/D2H, and allowing CPU RAM to serve as an intermediary layer between the GPU KV Cache and disk or remote storage.
- **Engine-driven Asynchronous Store**: Only when Stream, Event, and `torch.empty(pin_memory=True)` are all integrated through [capability detection](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/multiprocess/transfer_context/worker_transfer.py), will LMCache choose an asynchronous context. The GPU executes D2H on the copy stream, allowing the CPU foreground thread to continue working, while the background waits for the event to complete before committing.
- **Direct SHM Copy**: Workers will attempt to [directly register shared memory mappings](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/multiprocess/transfer_context/shm.py). If successful, the device can asynchronously D2H/H2D to SHM; if it fails, it will use internal pinned staging to perform another CPU copy or revert to the synchronous path.
- **LazyMemoryAllocator**: LMCache can initially reserve a large ordinary virtual address space and then [gradually register it as mapped pinned memory](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/memory_allocators/lazy_memory_allocator.py) in 64 MiB increments, avoiding the need to pin the final capacity all at once at startup. This feature will explicitly check `is_pin_supported`, and if unsupported, will not be enabled.
- **Device-DAX and NIXL CPU Buffer**: LMCache will attempt to register existing [Device-DAX mappings](https://github.com/LMCache/LMCache/blob/00db3cedf7e0c93f8b0df234fa39ccd2b96a4eb9/lmcache/v1/memory_allocators/devdax_memory_allocator.py) with the device; NIXL also requires successful registration when using CPU buffers for DMA.

However, pin memory itself **does not automatically enable all asynchronous capabilities**. For example, cross-process LMCache-driven paths still require device memory IPC wrappers and event IPC; the official device extension documentation also defines host pinning as an independent, optional staging performance capability. In other words, pinning is the infrastructure for host buffers to participate in direct asynchronous DMA, not a master switch for the entire transfer protocol.
## Asynchronous Call Return Does Not Equal Data Copy Completion

A CUDA stream can be understood as a sequentially executed GPU work queue. When the CPU launches a CUDA kernel or an asynchronous copy, it typically just submits the task to the stream:

```text
CPU: Submit copy ── Call returns ── Continue executing other code
GPU:          └──────── Background executing copy ────────┘
```

Thus, "the function has returned" only proves that the work has been successfully enqueued; it does not prove that the GPU has finished reading the source data or writing the target data.

If the CPU needs to read the D2H target buffer next, or is preparing to release the H2D source buffer, it must first establish a completion boundary. The most direct method is:

```python
torch.cuda.synchronize()
```

LMCache provides a unified wrapper for different device platforms:

```python
torch_dev.synchronize()
```

The purpose of synchronization is not to make the copy happen, but to prevent the CPU from crossing the boundary of "the GPU has completed."

## Ownership Differences Between Tensor and Raw Pointer

Under normal circumstances, if a PyTorch operator directly receives a Tensor:

```python
some_torch_op(tensor)
```

The framework knows the allocator, device, and stream usage of this object, allowing it to track its lifecycle and avoid the underlying storage being incorrectly reused before the asynchronous work is finished.

However, native extensions often only receive raw pointers:

```python
ptr = tensor.data_ptr()
native_cuda_kernel(ptr)
```

The `data_ptr()` returns just an integer address. Once passed to C++/CUDA, the GPU sees only an address like `0x7fa012340000`; it does not know which Python Tensor this address originally belonged to, nor will it hold a reference to that Tensor.

```text
Python Tensor ── data_ptr() ──> Integer address ──> CUDA kernel
     │                              │
     └── Ownership and lifecycle info ──X───┘
```

If the last Python reference disappears first, PyTorch can consider that memory as free; meanwhile, the CUDA kernel may still read and write to it using the saved address. The address itself is usually still a valid address, so the program may not crash; it will just read new content that has been overwritten by the next request.

This is precisely the root cause of the first bug in PR #4830.

## Bug 1: Retrieve Path Releases Temporary Pinned Tensor Too Early

The retrieve path is responsible for writing back the cached KV from the CPU to the GPU paged KV:

```text
CPU KV ── H2D ──> GPU paged KV
```

The CPU Tensor obtained from pickle deserialization is usually not pinned memory. Therefore, the ptr-only native path in LMCache will dynamically pin in `scatter_cpu_to_paged_kv()`:

```python
chunks = [
    chunk.pin_memory() if not chunk.is_pinned() else chunk
    for chunk in chunks
]
```

Next, it converts these Tensors to raw pointers and initiates an asynchronous H2D:

```python
objs_arg = [chunk.data_ptr() for chunk in chunks]
device_ops.multi_layer_block_kv_transfer(...)
```

The timeline of the old code is as follows:

![Lifecycle race of temporary pinned Tensor in retrieve path](/images/blog/lmcache-pinned-memory/async-copy-lifetime-en.svg)

The most easily overlooked issue is that the caller has already called synchronization after `scatter_cpu_to_paged_kv()`, but this synchronization may still be too late.

In CPython, when a function returns, its local references are cleaned up first, and only then does the caller execute the next statement. Thus, the following may occur:

```text
scatter internally starts H2D
        ↓
scatter returns, the last reference of the temporary pinned Tensor disappears
        ↓
allocator hands the memory over for the next pin_memory() use
        ↓
caller finally executes synchronize()
```

The caller did synchronize, but it cannot turn back time to prevent the memory reuse that has already occurred.

The fix in the PR is to record whether this call created a temporary pinned Tensor:

```python
dynamically_pinned = not all(chunk.is_pinned() for chunk in chunks)
```

If a temporary object was indeed created, it waits for H2D to complete within the function, before these local references disappear:

```python
if dynamically_pinned:
    torch_dev.synchronize()
```

If the Tensor passed in by the caller is already pinned, then this synchronization is not added, preserving the original fast path. The ownership relationship after the fix is clear: the temporary memory created by the function is the responsibility of the function to ensure it is released only after the GPU has finished using it.
## Bug 2: The pickle path of Store reads an incomplete CPU buffer

Store operates in the opposite direction, collecting GPU KV to CPU:

```text
GPU paged KV ── D2H ──> CPU chunks
```

`gather_paged_kv_to_cpu()` initiates an asynchronous D2H. When it returns, the GPU may still be writing data to the CPU buffer.

Engine-driven transfer has two CPU data delivery methods:

| Path | Target of gather | Consumer after gather |
| --- | --- | --- |
| SHM | Shared memory slot | Used by server after commit |
| pickle | New CPU chunks | `pickle.dumps(chunks)` immediately serializes |

The old code only synchronized when `out_buffers is not None`, which only accounted for SHM:

```python
if out_buffers is not None:
    torch_dev.synchronize()
```

However, the pickle path also initiated an asynchronous D2H, and it consumed results on the CPU more quickly: `commit_store()` would immediately execute `pickle.dumps(chunks)`.

Thus, the old timeline could be:

```text
CPU: gather returns ── pickle.dumps starts reading buffer
GPU:           └──── still writing to the same buffer ────┘
```

The serialization result could mix new and old content: part of the block was already written, while another part still contained old data. The fix is to make synchronization no longer dependent on transport:

```python
cpu_chunks = gather_paged_kv_to_cpu(...)
torch_dev.synchronize()
ok = commit_store(..., cpu_chunks)
```

Now the sequence is fixed as:

```text
gather initiates D2H
        ↓
Wait for GPU to finish writing CPU buffer
        ↓
commit_store / pickle.dumps
```

## Why this error does not raise exceptions

Memory lifecycle errors do not necessarily manifest as illegal access. The address here is still valid, and the Tensor's metadata is not corrupted:

- shape is correct;
- dtype is correct;
- pointer points to allocated memory;
- CUDA kernel finishes normally;
- pickle and RPC return normally.

The error only occurs in the numerical content. After the KV Cache is read by attention, the model can still continue generating tokens, but the computational basis has become incorrect. Thus, what is ultimately observed is a sudden drop in model quality, rather than a clear system error.

This is also a particularly tricky type of fault in AI Infra:

> A valid Tensor does not equal a correct Tensor; a successful request return does not equal reliable values in the cache.

## How I determine if this fix is valid

I outlined two paths based on the producer, holder, and consumer of the data.

The Retrieve path is:

```text
pickle.loads
→ Normal CPU Tensor
→ Dynamically create pinned Tensor
→ Raw pointer
→ Asynchronous H2D
→ GPU paged KV
```

The key issue is who holds the dynamically pinned Tensor until H2D is complete. The fix places synchronization inside the function that creates it, ensuring correct lifecycle boundaries.

The Store path is:

```text
GPU paged KV
→ Asynchronous D2H
→ CPU chunks
→ pickle.dumps
→ COMMIT_STORE
```

The key issue is whether the CPU consumer can read the buffer before D2H is complete. The fix places synchronization between gather and commit, ensuring correct order.

New tests also target these two boundaries:

- The Retrieve test forces entry into the ptr-only and dynamic pin branches, confirming that both native transfer and synchronization occur;
- The Store test records the call order of `gather`, `sync`, and `commit`, requiring synchronization to strictly be between gather and commit.

The first test only checks that transfer and sync are called separately, without explicitly asserting their order as in the second test. This is a minor gap in testing rigor, but in the current implementation, synchronization does indeed occur after all transfer launches, which does not affect the correctness judgment of this fix.

The current PR's CPU, code quality, build, and main Buildkite checks have passed. The author also ran CUDA engine-driven pickle smoke tests, with the first and second outputs matching byte-for-byte, both yielding `0.895` for GSM8K. The AMD lane did not trigger at that time, so cross-platform running evidence is not complete; from the code path perspective, the fix targets raw-pointer ownership and synchronization order, and does not depend on any specific model structure.
## Summary

What’s most noteworthy about this PR is not the two `synchronize()` calls, but rather a general rule of asynchronous programming:

> After submitting asynchronous work, both the source and target memory must remain alive until the work is truly complete; if crossing Tensor boundaries that the framework can track, and only passing raw pointers, the lifecycle must be explicitly managed by the caller.

Pinned memory addresses the stability of physical page access to devices, but it does not automatically resolve the lifecycle of user-space objects; CUDA streams handle work scheduling but do not ensure that a call returns only when complete; `synchronize()` must be placed at the correct producer-consumer boundaries to truly protect data.

In caching systems and model inference pipelines, such issues often do not throw errors but manifest as anomalous answers after hits, sudden drops in evaluation scores, or sporadic numerical drifts. When troubleshooting, one cannot merely check if requests succeed; it is essential to trace each buffer, tracking where it originated, who holds it, when it was read, and when it can be reused.

## References

- [LMCache PR #4830: Complete async copies before their buffers are reused](https://github.com/LMCache/LMCache/pull/4830)
- [PyTorch Tutorial: A guide on good usage of `non_blocking` and `pin_memory()`](https://docs.pytorch.org/tutorials/intermediate/pinmem_nonblock.html)
- [NVIDIA CUDA C Programming Guide: Page-Locked Host Memory](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#page-locked-host-memory)
