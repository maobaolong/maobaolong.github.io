---
title: "从 LMCache PR #4830 理解 Pinned Memory：一次静默 KV Cache 损坏分析"
description: 从 pageable memory、pinned memory 和 CUDA 异步拷贝讲起，分析 LMCache 如何因为 raw pointer 生命周期和错误的同步边界产生无报错的数据损坏。
publishedAt: 2026-09-03
updatedAt: 2026-09-03
category: AI Infra
tags:
  - lmcache
  - cuda
  - pinned-memory
  - async-copy
  - kv-cache
  - debugging
author: 毛宝龙
readingTime: 13 min
featured: true
draft: false
---

最近读了 [LMCache PR #4830](https://github.com/LMCache/LMCache/pull/4830)。这个 PR 改动不大：两处同步逻辑，加上一组回归测试。但它修复的问题很典型——GPU 异步拷贝还没有完成，CPU 侧的内存已经被读取或重新利用，最终造成 KV Cache 静默损坏。

所谓“静默”，是指系统没有崩溃，CUDA 没有报错，Tensor 的 shape 和 dtype 也都正常，只是里面的数据错了。PR 作者在 8 张 H100 上运行 engine-driven pickle transport 时，观察到 GSM8K 得分从 `0.80` 直接掉到 `0.00`；针对性复现中，修复后损坏 block 的数量从 4000 个降到 0。

这类问题的关键不是“有没有调用复制函数”，而是三个更底层的问题：

1. CPU 内存是否适合被 GPU 异步访问？
2. CUDA 调用返回时，复制是否真的已经完成？
3. 在复制完成之前，谁负责保证那块内存仍然有效、没有被复用？

本文从 pinned memory 开始，把这个问题的完整因果链梳理清楚。

## 普通 CPU 内存为什么不适合直接异步传输

进程平时看到的是虚拟地址。操作系统通过页表，把一段虚拟地址映射到实际的物理内存页。普通 CPU 内存通常是 pageable memory，也就是可分页内存。

在内存压力较大时，操作系统可以把暂时不用的页面换出到 swap 区域——它通常位于磁盘或 SSD 上；之后再次访问时，再把页面换回物理内存。即使不发生换出，虚拟地址背后对应的物理页也由操作系统管理，应用程序不能假设它会一直稳定地留在原处。

CPU 访问这类内存没有问题：缺页、换入和页表更新都由操作系统处理。但 GPU 的 DMA 或异步传输不能在执行到一半时，突然发现目标物理页被换走了。设备需要一组在传输期间位置稳定、不会被操作系统回收或换出的物理页面。

这就是 page-locked memory，也就是通常所说的 pinned memory。

![Pageable memory 与 pinned memory 的区别](/images/blog/lmcache-pinned-memory/pageable-vs-pinned.svg)

Pinned memory 的“pin”锁定的是物理页面。它带来几个重要特性：

- 页面在被 pin 的期间不会被换出到 swap；
- 设备可以依赖稳定的物理页面完成 DMA 或映射访问；
- Host-to-Device（H2D）和 Device-to-Host（D2H）传输更容易真正异步执行；
- 代价是这些物理内存不能被操作系统灵活回收，分配和释放也比普通内存昂贵。

因此 pinned memory 不是越多越好。框架通常会维护缓存池，尽量复用已经申请过的 pinned 内存，避免每次传输都向操作系统重新申请 page-locked 页面。

这里需要特别区分两个概念：

> Page-locked 只代表操作系统不会把物理页换出，并不代表用户态 allocator 永远不会重新利用这块内存。

当一个 pinned Tensor 的最后一个引用消失后，PyTorch 可能把这块内存放回自己的 caching host allocator。下一次申请相同大小的 pinned memory 时，这块地址就可能立即被复用并写入新数据。

## `pin_memory()` 实际做了什么

在 PyTorch 中，可以直接分配 pinned Tensor：

```python
x = torch.empty(shape, device="cpu", pin_memory=True)
```

也可以把普通 CPU Tensor 转成 pinned Tensor：

```python
pinned_x = x.pin_memory()
```

第二种写法容易让人产生误解：它通常不是给原 Tensor 原地增加一个标记，而是申请新的 pinned memory，再把原数据复制过去。

```text
x：         普通 CPU Tensor
                  │ 复制
                  ▼
pinned_x：  新的 pinned CPU Tensor
```

这意味着 `pinned_x` 是一个需要单独管理生命周期的新对象。如果它只是函数里的局部变量，函数返回后又没有其他引用，它就可能立即进入 allocator 的复用流程。

## 异步调用返回，不等于数据复制完成

CUDA stream 可以理解成一条按顺序执行的 GPU 工作队列。CPU 启动一个 CUDA kernel 或异步复制时，通常只是把任务提交到 stream：

```text
CPU：提交复制 ── 调用返回 ── 继续执行其他代码
GPU：          └──────── 后台执行复制 ────────┘
```

所以“函数已经返回”只证明工作成功入队，不证明 GPU 已经读完源数据或写完目标数据。

如果 CPU 接下来要读取 D2H 的目标 buffer，或者准备释放 H2D 的源 buffer，就必须先建立一个完成边界。最直接的方法是：

```python
torch.cuda.synchronize()
```

LMCache 为不同设备平台提供了统一封装：

```python
torch_dev.synchronize()
```

同步的作用不是让复制发生，而是阻止 CPU 越过“GPU 已经完成”的边界。

## Tensor 和 raw pointer 的所有权差别

正常情况下，如果一个 PyTorch 算子直接接收 Tensor：

```python
some_torch_op(tensor)
```

框架知道这个对象的 allocator、设备和 stream 使用情况，有机会跟踪其生命周期，避免底层存储在异步工作结束前被错误复用。

但 native 扩展经常只接收裸指针：

```python
ptr = tensor.data_ptr()
native_cuda_kernel(ptr)
```

`data_ptr()` 返回的只是一个整数地址。传到 C++/CUDA 后，GPU 看见的只有类似 `0x7fa012340000` 的地址，它并不知道这个地址原来属于哪个 Python Tensor，也不会持有那个 Tensor 的引用。

```text
Python Tensor ── data_ptr() ──> 整数地址 ──> CUDA kernel
     │                              │
     └── 所有权和生命周期信息 ──X───┘
```

如果最后一个 Python 引用先消失，PyTorch 可以认为那块内存已经空闲；与此同时，CUDA kernel 仍可能通过保存下来的地址读写它。地址本身通常还是合法地址，所以程序不一定崩溃，只会读到被下一次请求覆盖的新内容。

这正是 PR #4830 第一个 bug 的根源。

## Bug 一：Retrieve 路径过早释放临时 pinned Tensor

Retrieve 路径负责把 CPU 中缓存的 KV 写回 GPU paged KV：

```text
CPU KV ── H2D ──> GPU paged KV
```

pickle 反序列化得到的 CPU Tensor 通常不是 pinned memory。LMCache 的 ptr-only native 路径因此会在 `scatter_cpu_to_paged_kv()` 内动态 pin：

```python
chunks = [
    chunk.pin_memory() if not chunk.is_pinned() else chunk
    for chunk in chunks
]
```

接着，它把这些 Tensor 转成 raw pointer，启动异步 H2D：

```python
objs_arg = [chunk.data_ptr() for chunk in chunks]
device_ops.multi_layer_block_kv_transfer(...)
```

旧代码的时间线如下：

![Retrieve 路径中临时 pinned Tensor 的生命周期竞态](/images/blog/lmcache-pinned-memory/async-copy-lifetime.svg)

问题最容易被忽略的地方是：调用者原本已经在 `scatter_cpu_to_paged_kv()` 后调用了同步，但这个同步仍可能太晚。

在 CPython 中，函数返回时，它的局部引用会先被清理，然后调用者才执行下一条语句。于是可能发生：

```text
scatter 内部启动 H2D
        ↓
scatter 返回，临时 pinned Tensor 的最后一个引用消失
        ↓
allocator 将内存交给下一次 pin_memory() 使用
        ↓
调用者终于执行 synchronize()
```

调用者确实同步了，但它无法倒流时间，阻止此前已经发生的内存复用。

PR 的修复是记录本次调用是否创建了临时 pinned Tensor：

```python
dynamically_pinned = not all(chunk.is_pinned() for chunk in chunks)
```

如果确实创建了临时对象，就在函数内部、这些局部引用消失之前等待 H2D 完成：

```python
if dynamically_pinned:
    torch_dev.synchronize()
```

如果调用方传入的本来就是 pinned Tensor，则不增加这次同步，保留原来的快速路径。修复后的所有权关系很明确：函数创建的临时内存，由函数负责保证 GPU 用完后再释放。

## Bug 二：Store 的 pickle 路径读取了尚未写完的 CPU buffer

Store 是相反方向，把 GPU KV 收集到 CPU：

```text
GPU paged KV ── D2H ──> CPU chunks
```

`gather_paged_kv_to_cpu()` 启动的是异步 D2H。它返回时，GPU 可能仍在向 CPU buffer 写数据。

Engine-driven transfer 有两种 CPU 数据交付方式：

| 路径 | gather 的目标 | gather 后的消费者 |
| --- | --- | --- |
| SHM | 共享内存 slot | server 在 commit 后使用 |
| pickle | 新建 CPU chunks | `pickle.dumps(chunks)` 立即序列化 |

旧代码只在 `out_buffers is not None` 时同步，也就是只照顾了 SHM：

```python
if out_buffers is not None:
    torch_dev.synchronize()
```

但 pickle 路径同样启动了异步 D2H，而且它更快地在 CPU 上消费结果：`commit_store()` 会立即执行 `pickle.dumps(chunks)`。

因此旧时间线可能是：

```text
CPU：gather 返回 ── pickle.dumps 开始读取 buffer
GPU：           └──── 仍在向同一 buffer 写入 ────┘
```

序列化结果可能混合新旧内容：一部分 block 已经写完，另一部分仍是旧数据。修复方式是让同步不再依赖 transport：

```python
cpu_chunks = gather_paged_kv_to_cpu(...)
torch_dev.synchronize()
ok = commit_store(..., cpu_chunks)
```

现在顺序被固定为：

```text
gather 启动 D2H
        ↓
等待 GPU 写完 CPU buffer
        ↓
commit_store / pickle.dumps
```

## 为什么这种错误没有异常

内存生命周期错误不一定表现为非法访问。这里的地址仍然有效，Tensor 的元数据也没有损坏：

- shape 正确；
- dtype 正确；
- pointer 指向已分配内存；
- CUDA kernel 正常结束；
- pickle 和 RPC 正常返回。

错误只发生在数值内容上。KV Cache 被 attention 读取后，模型仍然可以继续生成 token，只是计算依据已经错误。于是最终看到的是模型质量突然下降，而不是明确的系统错误。

这也是 AI Infra 中很棘手的一类故障：

> 合法的 Tensor，不等于正确的 Tensor；请求成功返回，也不等于缓存中的数值可靠。

## 我如何判断这个修复是否成立

我按数据的生产者、持有者和消费者梳理了两条路径。

Retrieve 路径是：

```text
pickle.loads
→ 普通 CPU Tensor
→ 动态创建 pinned Tensor
→ raw pointer
→ 异步 H2D
→ GPU paged KV
```

关键问题是动态 pinned Tensor 由谁持有到 H2D 完成。修复把同步放在创建它的函数内部，生命周期边界正确。

Store 路径是：

```text
GPU paged KV
→ 异步 D2H
→ CPU chunks
→ pickle.dumps
→ COMMIT_STORE
```

关键问题是 CPU 消费者能否在 D2H 完成前读取 buffer。修复把同步放在 gather 和 commit 之间，顺序正确。

新增测试也针对这两个边界：

- Retrieve 测试强制进入 ptr-only 和动态 pin 分支，确认 native transfer 与同步都会发生；
- Store 测试记录 `gather`、`sync`、`commit` 的调用顺序，要求同步必须严格位于 gather 与 commit 之间。

其中第一个测试只分别检查 transfer 和 sync 被调用，没有像第二个测试一样明确断言二者的先后顺序。这是测试严谨性上的一个小缺口，但当前实现中同步确实位于全部 transfer launch 之后，不影响本次修复本身的正确性判断。

PR 当前的 CPU、代码质量、构建和主要 Buildkite 检查已经通过。作者还补充运行了 CUDA engine-driven pickle smoke，第一次和缓存命中的第二次输出逐字节一致，GSM8K 都是 `0.895`。AMD lane 当时没有触发，因此跨平台运行证据并不完全；从代码路径看，修复针对的是 raw-pointer 所有权和同步顺序，并不依赖某个模型结构。

## 总结

这个 PR 最值得记住的不是两次 `synchronize()`，而是一条通用的异步编程规则：

> 提交异步工作之后，源和目标内存都必须存活到工作真正完成；如果跨过了框架能跟踪的 Tensor 边界，只传递 raw pointer，生命周期就必须由调用方显式管理。

Pinned memory 解决的是物理页面对设备访问的稳定性，不会自动解决用户态对象的生命周期；CUDA stream 解决的是工作调度，也不会让调用返回天然等于完成；`synchronize()` 只有放在正确的生产者与消费者边界，才能真正保护数据。

在缓存系统和模型推理链路中，这类问题往往不会报错，而是以命中后答案异常、评测分数骤降或偶发数值漂移的形式出现。排查时不能只看请求是否成功，而要沿着每一块 buffer，追踪它从哪里产生、由谁持有、什么时候被读取，以及什么时候才允许被复用。

## 参考资料

- [LMCache PR #4830: Complete async copies before their buffers are reused](https://github.com/LMCache/LMCache/pull/4830)
- [PyTorch Tutorial: A guide on good usage of `non_blocking` and `pin_memory()`](https://docs.pytorch.org/tutorials/intermediate/pinmem_nonblock.html)
- [NVIDIA CUDA C Programming Guide: Page-Locked Host Memory](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#page-locked-host-memory)
