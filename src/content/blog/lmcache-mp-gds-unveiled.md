---
title: "揭开 GDS 的神秘面纱：LMCache MP 如何把 KV Cache 放进 NVMe"
description: "从 SSD、DMA、slab、stream 和 buffer 讲起，用七张可逐步播放的动画图，走通 LMCache MP 的初始化、STORE 与 RETRIEVE，再用 muFile 看清面向对象的 backend 扩展边界。"
publishedAt: 2026-09-21
category: AI Infra
tags:
  - LMCache
  - GDS
  - KV Cache
  - NVMe
  - GPU
  - Phoenix
author: 毛宝龙
readingTime: 35 min
featured: true
draft: false
---

GPU 算过的东西，为什么还要再算一遍？

长文档问答、多轮对话、Agent 的共享前缀，都在反复提出这个问题。保存 KV Cache 可以避免一部分重复 prefill，但上下文越长，保存它的空间就越难找：显存要留给模型和正在执行的请求，主机内存也有容量、成本和带宽上限。

于是，我们自然会想到本地 NVMe SSD。接着又冒出一个问题：**如果每次从 SSD 读 KV 都要经过 CPU 内存，再搬进显存，存得下的收益会不会被搬运成本抵消？**

GDS 就在这条路径上。但“SSD 直达 GPU”只有五个字，藏在背后的工作却不少。谁发起读写？内核还参与吗？为什么代码里仍然有临时 GPU buffer？Python 函数返回了，数据就真的到了吗？

本文以 **[PR #5271][pr5271] 合入后的 LMCache 结构**为基线，只沿 MP mode 中 `LMCacheDrivenTransferModule` 的读写路径展开。源码链接固定到 [`c9b51e42`][snapshot]，便于逐行对照；muFile 的对照固定到 [#5027 的 `aad13e21`][mu-snapshot]。后文讲的是这套新结构如何工作，而不是 PR 的评审过程。

<nav class="gds-toc" aria-label="文章目录">
  <a href="#gds-basics">一、先看懂设备与术语</a>
  <a href="#gds-config">二、配置与 backend 选择</a>
  <a href="#gds-init">三、初始化：把资源接起来</a>
  <a href="#gds-store">四、STORE：从分页 KV 到 SSD</a>
  <a href="#gds-retrieve">五、RETRIEVE：从 SSD 回到分页 KV</a>
  <a href="#gds-async">六、async：谁在等谁</a>
  <a href="#gds-extend">七、以 muFile 为例扩展</a>
  <a href="#gds-future">八、容量与可扩展性</a>
</nav>

<h2 id="gds-basics">一、先看懂设备与术语</h2>

### 1.1 KV Cache 为什么会把容量问题放大

Transformer 在处理一个 token 时，会生成各层 Attention 要用的 Key 和 Value。保留它们，下次就不必重新生成同一段前缀的全部 K/V。

对采用常规 Attention 或 GQA 的模型，忽略额外元数据，一份 KV 的逻辑容量可以粗略写成：

```text
KV 字节数 ≈ 2 × 层数 × KV head 数 × head 维度
             × token 数 × 每元素字节数 × 序列数
```

这里的 `2` 是 K 和 V，**KV head 数不一定等于 query head 数**。例如取 32 层、8 个 KV heads、head 维度 128、BF16 每元素 2 字节：每个 token 约需 128 KiB；一个 128 Ki tokens 的上下文约需 16 GiB；64 份互不共享的上下文合计约 1 TiB。

这只是便于理解量级的算例，不是某个模型的实测。张量并行会改变各卡持有的份额，前缀共享、量化、滑动窗口和模型结构也会改变实际容量。但趋势很清楚：**上下文长度与需要保留的请求数量相乘，容量很快就越过单机显存，甚至主机 DRAM 的经济边界。**

NVMe 的价值，是让更多“以后可能再次命中”的 KV 留下来。命中后再把需要的部分送回 GPU，代替一部分重复计算。它不是让 Attention kernel 直接拿 SSD 当显存访问。

### 1.2 GDS 是路径，NVMe 才是介质

SSD 是保存字节的设备；NVMe 是访问这类高速存储的协议，常见本地 NVMe SSD 连接在 PCIe 上。GPU 的 HBM/显存是计算时使用的存储空间，CPU DRAM 是主机内存。它们不是同一种东西。

本文用 GDS 泛指 GPU Direct Storage 这类存储与设备内存直接交换数据的机制；NVIDIA 的具体产品叫 GPUDirect Storage，cuFile 是它暴露给应用的接口。

普通读取常见的路径是：

```text
SSD → CPU 内存中的中转区 → GPU 显存
```

GDS 的直接数据路径则力求变成：

```text
SSD ←→ GPU 显存
```

它省去的是**有效载荷经过 CPU DRAM 的中转**，不是把整个 CPU 从系统中删除。原生库也可能在不满足条件时走兼容路径，因此“调用了 GDS API”不等于“确认发生了直接 DMA”。[NVIDIA 对直接路径与兼容模式的说明][nvidia-overview]

<figure class="gds-anim" data-gds-scene="physical" aria-label="控制路径与数据路径动画">
  <figcaption>图 1：读取一段 KV 时，CPU 负责组织工作，SSD 控制器搬运数据。虚线表示控制，实线表示有效载荷。</figcaption>
  <p class="gds-fallback">用户态提交请求，内核及驱动建立设备映射、处理文件与 I/O，SSD 控制器通过 PCIe DMA 把字节写入 GPU buffer，最后报告完成。直接路径不经过 CPU DRAM 中转。</p>
</figure>

按图 1 的顺序，把每个参与者放回自己的位置：

1. **用户态程序运行在 CPU 上。** LMCache 的 Python、后面的 C/C++ 原生库都属于这层。它们决定读哪个文件、哪个 offset、多少字节、送到哪个 GPU buffer。
2. **内核态代码也运行在 CPU 上。** 内核负责权限、文件和设备管理；驱动配合建立可供 DMA 使用的设备地址映射。文件系统还要把文件 offset 翻译成底层存储位置。用户态与内核态是权限边界，不是两块不同的处理器。
3. **DMA 是设备搬运，不是 CPU 逐字节复制。** 存储控制器拿到命令和设备可访问的地址后，可以通过 PCIe 搬运有效载荷。GPU 的虚拟地址不能原封不动当作 SSD 的 DMA 地址使用，注册和映射正是为了解决这个问题。
4. **GPU 保有数据与计算任务。** 读回的 KV 进入显存后，GPU 上的搬运 kernel 或计算 kernel 才能消费它。GPU 的显存对 PCIe 暴露哪些区域、拓扑能否 P2P，都影响这条路径。
5. **完成还要被观察和排序。** 设备报告 I/O 完成，原生库与 stream 机制把它衔接到后续任务，不能刚发命令就让计算去读尚未到达的数据。

这是理解直接 I/O 的通用分工，不代表所有 backend 都走相同的内核调用链。例如 uGDS 的热路径在用户态组织 NVMe 命令，但设备接管与内存映射仍需要初始化支持。[GDS 设计说明][nvidia-design]、[uGDS 安装与设备绑定][ugds-install]

### 1.3 后面会反复出现的六个词

| 概念 | 在本文中的意思 | 不要混淆成 |
| --- | --- | --- |
| block | 推理引擎分页 KV 的一个分配单位，block ID 用来定位实际 GPU 页 | SSD 的一个扇区 |
| chunk | LMCache 按一段 token 组织的缓存单位；一个 chunk 可以覆盖多个引擎 block | 必然连续的一段引擎显存 |
| slab | 预先准备的一大块存储地址空间，之后从中分配小区域存放缓存对象 | 每个请求创建一个文件，或 Linux 内核的 slab allocator |
| buffer | 已分配的一段内存。本文重点是 LMCache 持有的 GPU staging buffer | CPU 中转内存 |
| handle | 某个已打开或已注册资源的引用。OS 的 fd、GDS 文件 handle、stream handle 各指不同资源 | 数据本身，或者磁盘物理地址 |
| stream | GPU runtime 中一条有顺序的工作队列，把 kernel、I/O 和 event 组织起来 | Python 线程，或一根独占 PCIe 通道 |

另外还有一个 **Submission**：它保存某次原生异步调用需要继续访问的参数与结果存储。它和 buffer 不一样，通常只是 CPU 内存里几项 `ctypes` 标量，不装整块 KV 数据。

### 1.4 slab：把 NVMe 变成可分配的缓存空间

LMCache 不会为每份 KV 打开一个小文件。文件型 backend 在指定目录中准备 `lmcache_gds_slab.bin`，预分配容量；分配器只在这片空间里分配 offset。

例如某个缓存对象被分配到 `(offset=64 MiB, size=8 MiB)`，它的意思是：“这份 KV 的字节位于 slab 的这一段。”`GDSMemoryObject` 保存的正是这类元数据，**它不是一个装着 KV 的 CPU tensor**；它的 `tensor` 和 `raw_tensor` 都为 `None`。[对象实现][memory-src]、[slab 分配器][allocator-src]

<figure class="gds-anim" data-gds-scene="slab" aria-label="slab 地址与 GPU 注册区域动画">
  <figcaption>图 2：文件 offset 和 GPU buffer offset 是两套坐标。本例把 8 MiB 的对象分两笔传输，原因是 GPU 注册区域边界，不是换了两个缓存对象。</figcaption>
  <p class="gds-fallback">对象覆盖 slab 的 64–72 MiB。目标 GPU slice 从第一个 16 MiB 注册区内的 12 MiB 处开始：第一笔搬 4 MiB，第二笔从下一个注册区的起点再搬 4 MiB。</p>
</figure>

slab 容量与 GPU staging buffer 容量也不是一回事。slab 可以很大，staging buffer 只需容纳一批正在搬运的 chunk，使用完可以复用。**NVMe 容量不需要等量显存来配套。**

还有一个容易踩的坑：这条 GDS L1 路径按临时缓存管理，**不是重启后自动恢复的持久化 KV 数据库**。文件型 slab 在初始化时截断并重新预分配；元数据索引不保存在盘上。uGDS 原始设备即使残留旧字节，也不等于旧缓存索引会恢复。[文件准备逻辑][file-src]

<h2 id="gds-config">二、配置与 backend 选择</h2>

### 2.1 从使用者看：换掉 L1 的存储介质

在已经装好匹配的 LMCache、推理引擎和 GDS 驱动栈的机器上，服务端配置的重点是这几个参数。下面是 **NVIDIA/cuFile 场景的示意**；`/mnt/nvme/lmcache` 应是准备给缓存使用的 NVMe 目录，不要与其他服务实例共用同一个 slab 路径。

```bash
lmcache server \
  --port 5555 \
  --supported-transfer-mode lmcache_driven \
  --l1-size-gb 128 \
  --eviction-policy LRU \
  --gds-l1-path /mnt/nvme/lmcache \
  --gds-l1-backend cufile
```

`--gds-l1-path` 启用 GDS L1，`--l1-size-gb` 此时控制 slab 容量，不是分配同等大小的 CPU DRAM。这个配置中，GDS L1 与 CPU pinned-DRAM L1 是互斥的，而不是偷偷新增一个 DRAM 后面的缓存层。`--gds-l1-use-direct-io` 默认开启，文件型 backend 用它控制 `O_DIRECT`。[配置定义][config-src]

推理引擎仍通过 MP connector 与 LMCache server 通信。这里不展开模型启动命令和版本配对，沿用 [LMCache Quickstart][quickstart] 即可；GPU KV 数据依赖设备 IPC 映射，并不是把大块 tensor 塞进请求消息。完整的环境要求见 [GDS L1 配置文档][gds-doc]。

这条 L1 路径不暴露一块可由 CPU 直接读取的 KV 字节池，因此不要把依赖 `byte_array` 或可注册 L1 内存区域的 L2 adapter 原样接上。本文采用只配置 GDS L1 的最小场景。

### 2.2 四种 backend，差别不只是库名

| backend | 数据放在哪里 | 原生依赖与主要限制 |
| --- | --- | --- |
| `cufile` | 文件系统 slab | NVIDIA GPU、匹配的 CUDA/GDS 栈、`libcufile.so`，以及能提供 `cufile.bindings` 的 Python binding。直接路径还取决于 GPU、驱动、文件系统和 PCIe 拓扑。 |
| `hipfile` | 文件系统 slab | AMD GPU、ROCm/hipFile runtime 与 `libhipfile.so`。LMCache 自己绑定 C ABI，不依赖 hipFile 的 Python 包。fast path 要同时满足 kernel P2PDMA、runtime、amdgpu 和挂载卷条件。 |
| `ugds` | 专用原始设备的前一段地址空间 | 匹配 CUDA 或 HIP 的 `libugds.so`、uGDS 内核模块、被接管的 NVMe 设备。路径是 `/dev/ugds_drvX`，不是目录；需要容量查询 API。**专用 SSD 的原有数据可能被破坏。** |
| `phx` | 文件系统 slab | 当前 LMCache 封装接受 CUDA/ROCm PyTorch 构建；还需 Phoenix 的 `phoenixfs` 内核模块、匹配加速器的用户态库，以及实际加载的 `libphxfile.so` shim，且须提供 stream-ordered 异步符号。通过 Python 检查不代表底层设备已被支持。 |

“是不是要特定 kernel、OS patch？”不能给四行统一的答案。cuFile 的部分新 NVMe P2PDMA 部署已经可以不依赖 `nvidia-fs` 和定制 NVMe patch，但有明确的内核与驱动条件；hipFile 必须核验 fast path 所需能力，缺失时可能回退到 host-bounce；uGDS 需要接管设备；Phoenix 需要匹配运行内核编译模块，并有 IOMMU、BAR 映射等系统要求。**装一个 Python 包不能代替这些条件。** [NVIDIA 部署说明][nvidia-overview]、[hipFile 安装][hip-install]与[fast path 检查][hip-check]、[uGDS 安装][ugds-install]

`auto` 的含义也很克制：当前默认选择在 CUDA 上使用 cuFile、在 ROCm 上使用 hipFile。它不是跑一次 benchmark 后挑最快的 backend，也不会因为 cuFile 失败就自动改用 Phoenix。uGDS 和 Phoenix 需要显式选择。

### 2.3 Phoenix 为什么值得单独说一句

cuFile、hipFile、muFile 的名字天然带有厂商色彩；[Phoenix][phoenix] 的定位是更底层、面向多种 xPU 的开放 I/O 栈：上面接应用，下面通过用户态 connector 和内核 P2P backend 接不同加速器。它尝试让一套存储 I/O 设计被多种设备复用，而不只是再造一个 Python wrapper。

但“可统一”是架构方向，不是“所有卡、所有文件系统都已经验证”的承诺。Phoenix 的支持矩阵仍在演进，LMCache 的 `phx` 封装也有自己的平台检查。实际部署要同时满足两边的条件。[项目源码与说明][phoenix]、[安装指南][phx-install]；背景延伸阅读可看这篇[公众号文章](https://mp.weixin.qq.com/s/zgbhdjKZlH4gvLI22kKoGg)。

特别注意库名：Phoenix 核心是 `libphoenix.so`，而当前 LMCache `phx` backend 通过 **`libphxfile.so` 的 `phxFile*` shim ABI** 接入。只找到前者，并不能证明后者可加载。[实际 loader][phx-src]

<h2 id="gds-init">三、初始化：把资源接起来</h2>

下面开始沿源码走。先记住一条不带厂商名字的关系：

```text
MP server
  ├─ StorageManager → L1Manager → GDSL1MemoryManager
  │                              分配 slab offset，管理缓存对象
  └─ GDSContext → GDSBackend → GDSHandle
                 管注册/驱动    对一个已注册 slab 做异步读写
```

上面两条线分别解决“**这份 KV 放在哪**”和“**如何把字节搬过去**”。缓存 key、对象锁、命中和淘汰属于前一条线；库加载、handle、buffer、stream 以及 I/O 属于后一条线。它们通过 `GDSMemoryObject` 的 offset 和 size 接起来。

### 3.1 发现名字，不等于导入实现

MP server 启动时，`MPCacheServerContext` 调用 `initialize_gds_context(...)`。`GDSContext.initialize()` 对齐 slab 容量，然后调用 `create_backend(config.backend)`。[启动入口][engine-src]、[GDSContext][context-src]

新结构把实现放在 `gpu_connector/gds_backends/`。工厂扫描包目录，忽略私有模块和 `base`，得到可用模块名。**扫描目录不会执行每个 backend 的 Python 代码。**

显式配置 `phx` 时，才导入 `gds_backends.phx`，检查它导出的 `Backend` 是否继承 `GDSBackend`，构造对象并调用 `validate_environment()`。配置 `auto` 时，按模块名顺序导入候选，调用类方法 `is_default()`，在第一个匹配处停止。后者可能导入不止一个 Python 模块，但仍不应加载原生存储库。[发现与选择实现][factory-src]

<figure class="gds-anim" data-gds-scene="init" aria-label="backend 选择与 lazy load 动画">
  <figcaption>图 3：三次不同的“准备”。发现模块名、构造 Python 对象、加载原生库不是同一件事。图中使用显式 backend 选择。</figcaption>
  <p class="gds-fallback">扫描名字后仅导入被选模块；构造 Backend 仍不加载驱动。open_slab 准备存储并注册 handle 时才需要原生库；随后注册 GPU staging buffer 和 stream。</p>
</figure>

这就是 lazy import 的两层含义：**未选实现不必导入；已选实现的可选 native 依赖也推迟到实际使用时加载。** 因此，在没有装齐所有厂商库的环境中，列举配置或导入通用代码不应失败。

### 3.2 open_slab：backend 自己解释存储位置

`GDSContext` 只调用：

```python
handle = backend.open_slab(location, size, direct_io)
```

对于继承 `FileGDSBackend` 的实现，共同逻辑是：创建目录与 slab 文件，截断、预分配，关闭准备阶段的 fd，再用所需的 direct-I/O flags 重新打开，交给具体 backend 的 `open_handle()` 注册。返回的 `GDSHandle` 拥有 fd 和原生注册关系。[文件型父类][file-src]

uGDS 则自己解释原始设备路径，检查设备类型与容量，再打开对应范围。通用上下文不需要写“如果 backend 叫 ugds，就不要建文件”。这是多态发挥作用的地方：**同一个操作接口，资源准备的含义由对象自己决定。**

OS fd 与 GDS handle 为什么要并存？fd 表示进程打开了哪个文件或设备；原生 GDS handle 表示存储库已认识这个 fd，准备好与自己的 I/O 路径关联。注册不是复制文件内容，也不等于已经完成任何一次 KV 读写。

### 3.3 load lib 与绑定函数，到底绑定了什么

cuFile 在首次需要时导入 `cufile.bindings`，通过它接触 `libcufile`；hipFile、uGDS、Phoenix 的封装则使用 `ctypes.CDLL(...)`。随后为原生函数声明 `argtypes`、`restype`。[cuFile 实现][cufile-src]、[hipFile 实现][hipfile-src]

这不是把 Python 函数动态改名。它是在告诉 Python 的 FFI：“第一个参数是 opaque handle，第二个是 GPU 地址，接着几项是整数的指针，返回值是某种 C 结构或整数。”

如果把 64 位指针误当成 32 位整数，或者把 `size_t*` 当成值传过去，轻则类型错误，重则原生库读错地址。所以 ABI 绑定、错误码解释、特有对齐要求，都应留在实现里。通用层不该猜每个厂商的 C ABI。

显式打开驱动的 backend 复用父类的 `_driver_opened` 状态与开关逻辑，提供 `_open_driver()`、`_close_driver()` 两个原生钩子。这个状态属于一个 backend 实例，**没有跨实例共享驱动的管理器或引用计数**。Phoenix 则保留自己的隐式初始化路径：封装声明了 `phxFileDriverOpen` 符号，但没有显式调用它，关闭时清理已加载的 shim。[公共接口][base-src]、[Phoenix 实现][phx-src]

### 3.4 注册 KV、注册 GDS buffer，不是一件事

推理 worker 先把 GPU KV tensor 的 IPC 信息交给 MP server。LMCache 导入这些 handle，在自己的进程里建立对 worker 显存的映射，同时建立 layer、layout、block 等信息。**映射的仍然是 worker 拥有的显存，不是把 KV 复制到了 server 的 CPU 内存。**

LMCache 的设备 cache context 另外分配一块自己的临时 GPU buffer。它按 `(batch, object group, kernel group)` 划分；对象级 byte view 用于存储读写，kernel-group view 用于布局搬运。这些 view 指向同一块 allocation，不会每切一个 view 就复制一次数据。[GPU 临时缓冲实现][temp-src]

随后在该 context 的传输 stream 上，调用 `GDSContext.register_gpu_buffer()`：

- **stream 注册**让原生库认识这条队列；有些实现需要实际注册，有些 shim 是空操作，但每次 I/O 仍携带 stream。
- **buffer 注册**让存储栈准备好这段 GPU 内存的 DMA 映射，并要求 allocation 在注册及未完成 I/O 期间保持有效。
- **区域登记**把大 buffer 切成至多 16 MiB 的注册区，记录每区的基址和长度，供后续 slice 寻址。

16 MiB 是这份 LMCache 实现采用的分段上限，不是 GDS 这个概念的普适定义。图 2 中，目标 slice 从区内 12 MiB 开始，即使对象只有 8 MiB，也要在 16 MiB 边界拆成两笔 4 MiB I/O。[注册与分段逻辑][context-src]

<h2 id="gds-store">四、STORE：从分页 KV 到 SSD</h2>

现在假设 worker 已经算好一段 KV，要把它保存到 GDS L1。先看完整的数据顺序：

```text
worker 的分页 KV 显存
  → GPU gather / layout transfer
  → LMCache 连续 GPU staging buffer
  → GDS WRITE
  → NVMe slab
```

<figure class="gds-anim" data-gds-scene="store" aria-label="STORE 分步动画">
  <figcaption>图 4：保存时先 gather，再写盘。A–D 表示一段 chunk 内的四份示意数据；block ID 是演示值，不是某次真实运行的地址。</figcaption>
  <p class="gds-fallback">等待 worker 的 producer event；reserve_write 获得 slab 对象；按 block IDs 把分页 KV gather 到连续 GPU staging buffer；识别 GDSMemoryObject 后提交 WRITE；最后按 stream 顺序发布完成。</p>
</figure>

### 第一步：准备 keys 与 block IDs，等 worker 写完

入口是 [`LMCacheDrivenTransferModule.store()`][store-src]。请求传入缓存 key、instance ID、各组 GPU block IDs，以及 worker 侧的 producer event handle。

server 找到已注册的 cache context，解析 chunk 与 object-group 对应的对象 key，检查 block ID 数量是否足够，再把 ID 列表整理、搬到 GPU。这时移动的是少量**地址索引元数据**，不是整份 KV payload。

接着导入 producer event，在传输 stream 上等待它。没有这一步，LMCache 的 gather kernel 可能读取 worker 尚未写完的 KV。这里的 wait 把依赖关系加入队列，不要求每次都让 CPU 原地等 GPU 完成。

### 第二步：reserve_write 只分配位置，不搬数据

对每个 object group，store 根据它的 layout 调用 `StorageManager.reserve_write(..., "new")`。GDS L1 分配器返回的是 `GDSMemoryObject`，其中记录 slab offset、物理大小等信息。

这一步决定“可以把这个对象写到哪”。已经存在、不应写入或未获分配的条目，可能不在返回结果中。传输列表因此可能带有 `None`，STORE 会跳过对应条目。对象也还没有因为“分配成功”就变成可命中的完整缓存。

### 第三步：transfer_kv_per_object_group 先执行 gather

store 调用 [`transfer_kv_per_object_group()`][transfer-src]，方向为 `D2H`，当前 STORE 的 `batch_size` 固定为 1。

函数首先检查对象列表。只要存在 `GDSMemoryObject`，就不会进入普通对象的 native 合并传输计划，而是走下面这条显式 staging 路径。

对于要搬运的 object group，它进一步遍历 kernel groups。这里两种 group 的职责不同：**object group 决定哪些字节一起作为缓存对象；kernel group 决定哪些层能用相同布局规则执行搬运。** 一个对象可以由多个 kernel group 的结果组成。

函数算出本批 block IDs 的范围、窗口与跳过部分，再调用 `device_ops.multi_layer_block_kv_transfer(...)`。这个 GPU kernel 根据引擎的 layout 和 block IDs，把各层相应位置的 KV **gather 到 staging buffer 的正确区域**。

图 4 刻意把物理 block 排成 `2、4、7、9`，逻辑次序却是 `7、2、9、4`。SSD 根本不知道这些 ID 代表哪一层的哪个 tensor，也不会替我们重排；这是 LMCache 的 GPU transfer kernel 在做的事。

### 第四步：发现 GDS object，切换到存储 I/O

所有相关 kernel-group gather 入队后，函数调用 `lmcache_memcpy_async_d2h(temp_buffer, memory_obj)`。

注意，`D2H` 和函数名中的 `d2h` 是统一传输接口里的方向标签。**在 GDS 分支里，这一步不会把 payload 搬到 Host 内存。** `gpu_ops.py` 通过 `isinstance(memory_obj, GDSMemoryObject)` 识别对象，直接转到：

```python
get_gds_context().transfer_async(
    memory_obj, gpu_buffer, SlabDirection.WRITE
)
```

因此，`store()` 本身不必知道选了 cuFile 还是 Phoenix。对象类型决定它是存储读写，backend 对象再决定如何提交原生调用。[对象分流入口][gpuops-src]

### 第五步：把对象位置翻译成一次或多次 native WRITE

`GDSContext.transfer_async()` 取出对象的 `slab_offset` 与 `get_size()`，再查 GPU slice 落在哪个已注册区域。

每笔调用需要五类信息：注册区域的 `buf_base`、本次 `size`、slab 内的 `file_offset`、相对该注册基址的 `buf_offset`，以及当前 `raw_stream`。**buf_base 应是原先注册的区域基址，不应随手替换为任意 slice 的地址。** slice 的起点差额由 `buf_offset` 表达。

遇到区域边界就拆分，然后调用 slab handle 的 `write_async(...)`。这个 handle 持有对应 backend；cuFile 实现调用 `cuFileWriteAsync`，其他实现调用自己的 native API。共同的调用者只看见 `GDSHandle` 接口。[GDSContext 的 WRITE][context-src]、[cuFile 异步实现][cufile-src]

### 第六步：入队完成，不等于缓存已经发布

每笔 `write_async()` 返回的 `Submission` 会被 context 保留。store 在同一 stream 上记录 completion event，并在成功提交的路径上排入 `finish_write` 回调，等前面的搬运执行到位，再通知缓存管理层结束写入、使对象可用。

返回给 worker 的是可导出的 event handle 与请求状态。worker 可以据此建立后续依赖；**返回一次 RPC，不应被理解为 CPU 已同步等待所有 DMA，更不是掉电持久化确认。** `finish_write` 也不是 `fsync`。

有一个实现边界需要保留：这里的成功状态能反映提交路径是否抛出异常，但不能把它宣传为逐笔检查了所有延迟 I/O 错误。`Submission` 中的完成结果与它的生命周期，是另一个层面的事情，后文还会说。

### 为什么不能直接把分页 KV 写到 SSD

不是物理上绝对不可能，而是**当前 LMCache 的对象布局与存储接口之间需要转换**：

- 引擎的 KV 分散在不同层、不同物理 block，逻辑 token 次序不必等于地址次序；存储接口接受的是连续范围，不认识 block table。
- 不同模型或层组可能有不同 shape、stride、布局。staging 提供稳定的对象表示，把模型布局知识留在 GPU transfer kernel，避免每个存储 backend 再实现一遍。
- 预先注册、反复复用的小块 staging 比随请求追踪大量引擎 allocation 更容易管理。尤其 MP 下，worker 的 KV 显存归 worker 所有，LMCache 只是映射并按协议使用。
- 合并成较大的连续 I/O，可避免把一个 chunk 拆成大量细碎的随机读写，同时便于处理注册边界与对齐。

代价也是真实的：多占一部分显存，增加 GPU 内部 gather/scatter 工作。GDS 省去了主机数据中转，**没有承诺消除一切复制或布局转换**。如果未来支持散布式 I/O、不同盘上布局或对引擎 buffer 的直接注册，仍需重新设计这一层的正确性与性能权衡。

<h2 id="gds-retrieve">五、RETRIEVE：从 SSD 回到分页 KV</h2>

读取不是把 STORE 的函数名全部换成 read。两端的准备与最终发布对象都发生了变化：

```text
NVMe slab
  → GDS READ
  → LMCache 连续 GPU staging buffer
  → GPU scatter / layout transfer
  → worker 本次分配的分页 KV 显存
```

<figure class="gds-anim" data-gds-scene="retrieve" aria-label="RETRIEVE 分步动画">
  <figcaption>图 5：先把对象读到 staging，再 scatter。命中相同的 KV，并不要求目标 GPU block IDs 与保存时相同。</figcaption>
  <p class="gds-fallback">解析 key 与目标 block IDs，排入目标依赖，再取得已锁定对象；GDS READ 将 slab 字节读入 GPU staging buffer，然后按新的 block IDs scatter；完成事件之后结束读取并释放锁。</p>
</figure>

### 第一步：命中的是 key，不是某个固定 GPU 地址

前面的 lookup/prefetch 流程确认可取回的对象，并建立读取所需的锁。这里聚焦本地 GDS L1 命中的情况。

[`LMCacheDrivenTransferModule.retrieve()`][retrieve-src] 先解析各 object group 的 key。命中的内容仍对应原有 slab 位置，而不是保存时的 GPU 地址。

而请求中的 GPU block IDs 是**这次恢复要写入的目标**。例如保存时来自 `[7, 2, 9, 4]`，恢复时可能写到 `[3, 11, 0, 6]`。前缀内容相同，不意味着引擎恰好分配了同一组物理页。

### 第二步：在碰目标显存前建立依赖

retrieve 同样检查 block IDs、准备 GPU 上的索引，并在 LMCache transfer stream 上等待 producer event。对读取而言，这个依赖保证目标相关的前序设备工作满足协议要求，避免恢复操作与还在使用目标区域的任务冲突。

它把 `skip_first_n_tokens` 传给后续逻辑。已命中的共享前缀不能随意覆写，否则其他请求可能正读着这些 GPU 页。窗口相关的跳过也会影响哪些对象进入传输；不是每次把所有历史 chunk 一股脑恢复。

依赖排入 stream 后，retrieve 按各 object group 的有效窗口选出 key，通过 `read_prefetched_results()` 取得已锁定的 `GDSMemoryObject`，然后才交给传输 helper。这些是 CPU 侧组织步骤；排入 wait 并不意味着 CPU 此刻已经等到 GPU event 完成。

### 第三步：先读 staging，暂时不碰最终分页位置

调用 `transfer_kv_per_object_group()` 时，方向变成 `H2D`，batch size 可以使用 context 的 `max_batch_size`。

函数对本批对象先调用 `lmcache_memcpy_async_h2d(memory_obj, temp_buffer)`。`gpu_ops` 再识别 `GDSMemoryObject`，转为 `SlabDirection.READ`。同样，**H2D 在这个分支里不代表从 CPU DRAM 读 payload**。

后面的区域解析、跨区分段与 STORE 相同，只是最终调用 `GDSHandle.read_async()`。NVMe 中连续对象的字节被送入已注册 GPU staging buffer。

### 第四步：数据到位后，按这次的 block table scatter

本批 READ 入队后，`multi_layer_block_kv_transfer(...)` 按 kernel group 入队，把 staging 中的对象表示写回各层正确的引擎 KV layout。

读在前、scatter 在后，而且使用同一条 stream，存储库承诺的 stream-ordered 语义便能保证：scatter 不会抢先读取尚未完成的 I/O 结果。

这也解释了为何 GDS 不能凭一个 `read(fd, ptr, length)` 自动直达所有最终目标：**目标可能是不连续的多层、多页区域，还带着布局变换和“不覆盖前面若干 token”的规则。** 存储库负责搬字节，不负责解释模型的 block table。

### 第五步：保护范围与失败语义

在传输 helper 中，STORE 遇到没拿到写入对象的 `None` 可以跳过；RETRIEVE 对实际需要恢复的缺失对象则不能默默跳过，否则 worker 可能消费未恢复的数据。调用者会把已跳过窗口的前缀位置补成 `None`，以维持索引对应，真正执行的范围不会去读这些空位。

`skip_first_n_tokens` 影响最终 scatter 的写入范围；它**不必然让底层 GDS READ 同比少读这些字节**。当前实现通常先恢复完整对象到 staging，再在 GPU 布局搬运时跳过受保护的部分。[对象组传输逻辑][transfer-src]

### 第六步：完成后释放缓存侧读锁

retrieve 在 stream 上记录 completion event，并排入 `finish_read_prefetched` 回调。前面的读和 scatter 完成后，缓存管理层才可以结束对应读取，释放这次持有的锁。

这里同时有两种保护：**event/stream 保护设备读写的先后；对象锁保护 slab 区域不会在读取中被淘汰或重用。** 它们不能互相替代。

到这里，STORE 与 RETRIEVE 可以压缩为一组对称关系：

| 阶段 | STORE | RETRIEVE |
| --- | --- | --- |
| 缓存侧准备 | 申请写入对象与 slab 位置 | 取得命中对象并保持读锁 |
| GPU 布局处理 | GDS 之前 gather | GDS 之后 scatter |
| 存储动作 | staging → slab，WRITE | slab → staging，READ |
| 最终收尾 | `finish_write` 发布写入 | `finish_read_prefetched` 结束读取 |

<h2 id="gds-async">六、async：谁在等谁</h2>

### 6.1 async 不是“开一个 Python 线程”

这条路径的核心是 **提交与完成分离**。CPU 将 kernel、存储 I/O、event 依次排到 stream，然后可以继续组织后续工作。原生 API 返回时，I/O 可能尚未真正开始。

“同一个 stream”提供的是顺序，不保证相邻任务并行。不同 stream 之间也没有自动顺序，需要 event 或其他同步建立依赖。并发能否带来收益，取决于设备、库实现、存储队列与工作负载，不能只看到函数名带 `Async` 就推断一定重叠。[cuFile 异步 API 契约][nvidia-api]

Phoenix 的 stream-ordered 实现尤其直观：host-driven DMA 对 GPU runtime 本身不可见，所以它借助排到 stream 中的 host callback 执行 I/O，把“这笔 I/O 完成”接入 stream 的顺序。这不代表 KV payload 经过了 CPU 内存。[Phoenix 的 stream-ordered 说明][phoenix]

### 6.2 为什么 Submission 必须活得比函数调用久

原生 async 接口收到的若干参数是**指针**，不是 Python 整数的即时拷贝。例如：

```text
Submission
  size         → 原生库后续读取本次长度
  file_offset  → 原生库后续读取 slab 偏移
  buf_offset   → 原生库后续读取 GPU 注册区内偏移
  result       ← 原生库完成后写回结果
```

如果 Python 函数返回后，这些 `ctypes` 对象被回收，原生调用就可能继续使用失效的地址。因此每个 handle 的 `read_async()` / `write_async()` 返回一个 `Submission`，context 持有它，直到能证明相应操作已经完成。[Submission 定义][base-src]

<figure class="gds-anim" data-gds-scene="async" aria-label="Submission 与 stream checkpoint 动画">
  <figcaption>图 6：本例恰好来到第 64 次提交。CPU 已经返回，不代表参数可以释放；只有排在这些操作后面的 checkpoint event 完成，才能回收这一批 Submission。</figcaption>
  <p class="gds-fallback">Submission 先进入 uncommitted；到 checkpoint 时随 event 进入 inflight。event.query 为 false 时继续持有，为 true 后才能释放。结果字段与整块 GPU payload 不在同一处。</p>
</figure>

`GDSContext` 按 raw stream 分组记录提交：先累积到 `uncommitted`；每 64 次提交记录一次 checkpoint event，把这一批转到 `inflight`；查询到较早 event 完成，才释放对应批次的 Python 引用。未达到下一次 checkpoint 的少量提交会继续保留，直到后续检查或同步清理。

这里的 event 用来管理 **native 参数的存活期**。前面返回给 worker 的 completion event 则是跨进程操作完成的协议，两者不要当成同一个用途。

还有一条必须精确：当前 checkpoint 回收逻辑查询 event，**没有逐笔检查 `Submission.bytes_done` 是否为负、是否短读/短写**。接口为完成结果保留了空间，不等于上层已经完成全链路错误审计。谈正确性时，“已按序完成”“参数仍有效”“成功传输了期望字节数”是三个不同命题。[提交回收实现][checkpoint-src]

### 6.3 谁拥有资源，谁负责最后清理

worker 拥有原始分页 KV allocation；LMCache 的设备 context 持有导入的 IPC 映射，并拥有自己的 staging buffer 和传输 stream；进程级 `GDSContext` 持有 backend、slab handle、buffer/stream 注册以及未完成 Submission。

关闭时先等待相关设备工作完成，再注销 buffer 和 stream，关闭 slab 的注册 handle 与 fd，最后关闭 native driver。只把 Python 变量置空，既不能替代同步，也不能替代原生 deregister。

这里仍然可以有进程级 `GDSContext` 入口。**面向对象并不是禁止任何进程级对象，而是让状态归属明确，让业务操作依赖接口，不再靠替换模块函数来切换实现。**

### 6.4 GPU staging 与“没有 bounce buffer”并不矛盾

至少要区分三种缓冲：

1. **CPU DRAM bounce buffer**：GDS 直接路径希望避开的主机数据中转。
2. **LMCache GPU staging buffer**：把引擎分页布局和连续缓存对象相互转换，是本文 STORE/RETRIEVE 中始终可见的那一块。
3. **某个底层库自己的 GPU staging pool**：由 backend 实现和运行模式决定，可能额外存在。

例如本文核对的 [Phoenix 安装指南][phx-install] 描述了 STAGING 与 FULL 两种 BAR 映射模式：STAGING 可经过 Phoenix 自己的 GPU pool 再做 D2D，FULL 则有不同的直接映射与 RDMA 共存约束。这与 LMCache 的布局 staging 不是同一层，也不能看到“无 CPU 中转”就宣称“零 D2D”。部署时应以所用 Phoenix 版本为准。

<h2 id="gds-extend">七、以 muFile 为例，新增 backend 要改哪里</h2>

### 7.1 先沿接口分清工作，而不是照抄一个大文件

假设现在把 [#5027 的 SmartIO muFile][pr5027] 迁移到这套结构中。最自然的新增位置是：

```text
lmcache/v1/gpu_connector/gds_backends/mufile.py
tests/v1/gpu_connector/gds_backends/test_mufile.py
```

前一个模块导出 `Backend`，后一个测试它的原生 ABI、错误与资源处理。由于 muFile 使用文件型 slab，可以从 `FileGDSBackend` 继承文件准备流程；异步 handle 则继承 `GDSHandle`。

不需要重新造一份统一分发器，也不需要在 `__init__.py` 写一张新的 backend 名单。

<figure class="gds-anim" data-gds-scene="extension" aria-label="muFile 接入改动边界动画">
  <figcaption>图 7：被删除的是中央登记工作，不是硬件适配工作。muFile 实现和测试仍要写；MUSA 的设备桥接也仍要补齐。</figcaption>
  <p class="gds-fallback">原方案修改配置白名单、中央分发器、GDSContext 和 MUSA context；新结构免去前两处登记修改，backend 与测试进入各自目录，stream 和 buffer 的设备适配仍然保留。</p>
</figure>

需要实现的操作可以按职责分成四组，而不必背一张方法清单：

| 职责 | muFile 要负责什么 | 可以继承什么 |
| --- | --- | --- |
| 选择与环境 | 设置 `name="mufile"`，用 `validate_environment()` 检查 MUSA 环境；需要参与默认选择时再实现 `is_default()` | 通用目录发现、显式选择、默认不限制平台的父类行为 |
| 存储与驱动 | 懒加载 `libmufile.so`、绑定 ABI；`open_handle()` 包装注册后的资源，`_open_driver/_close_driver` 接原生 API | 文件 slab 准备、按实例的 driver 状态、handle 的 fd 清理 |
| 注册与注销 | 把文件、设备 buffer、stream 交给对应 `muFile*Register`，在合适时机解除注册 | 公共上下文安排注册时机、保留 tensor、分段与关闭顺序 |
| 异步读写 | handle 的 `read_async/write_async` 把公共参数翻译为 muFile ABI，返回活得足够久的 Submission | 统一调用形状、上下文的 stream 分组与 Submission 生命周期跟踪 |

这里不是要把所有相似代码都抽成父类。库的查找方式、C 结构体、错误码、注册 flags、描述符保活要求都可能不同，应该继续留在 `mufile.py` 中。

### 7.2 muFile 的 ABI 不能当作 cuFile 的字符串替换

在对照版本中，muFile 有几处必须认真适配的区别：

- stream 注册使用 `0x1`，不能照搬 cuFile/hipFile 的 `0x7`。
- async 函数返回 `ssize_t` 状态，而完成字节数的出参是 `size_t*`；公共 `Submission.result` 使用有符号存储。应在 backend 内使用匹配 ABI 的结果字段，例如继承 `Submission` 增加 native result，再覆盖 `bytes_done` 的解释，不能仅因为两者在某平台同为 8 字节就直接混用指针。
- 原封装按“native handle 引用调用方描述符”的约定保留 `MUFileDescr_t`。新实现应把这个生命周期归入 backend 或 handle，并确保 native deregister 返回之前描述符仍有效。
- 4 KiB 的地址、长度、文件偏移与 buffer 偏移约束，需要在适当位置验证。[muFile 原生封装对照][mufile-src]

这些细节没有因为面向对象而消失。收益是**它们有了一个明确的归属**，不会扩散到 STORE、RETRIEVE 或公共分发代码里。

### 7.3 不能回避的边界：新存储 backend 不等于新设备已接通

这份基线的 `GDSContext` 仍通过 `stream.cuda_stream` 取得 raw stream，现有 MUSA 设备 context 也还没有完成这条 GDS staging 注册接入。因此，针对 **muFile + MUSA**，只添加 `mufile.py` 还不够。

仍需补齐两类工作：

1. 通过设备抽象统一取得 raw stream handle，使 GDSContext 不再依赖 CUDA 风格属性。MUSA 对应的是 `musa_stream` 等设备接口。这应当是一处通用设备能力，而不是在 context 中新增 `if backend.name == "mufile"`。
2. 在 `MUSACacheContext` 中把自己的 staging allocation 注册给 GDS，并在同步后注销；同时保证部分初始化失败时的回滚与 IPC 资源清理正确。

这区分了两种扩展：**新增一个使用已支持设备接口的存储库**，可以只扩展 backend；**接入一个尚未打通的设备平台**，还需要补全设备层。把两者混在一起，才会把“开放扩展”误写成“任何硬件零成本支持”。

原 #5027 还把 4 KiB 和 16 MiB 改成两个返回固定值的 capability 查询。对当前 muFile 的相同约束，不必为了函数数量而照搬；未来出现确实不同的 backend 约束时，再让接口表达这种实际差异。

### 7.4 改动减少了多少：用文件边界说清楚

固定到 `aad13e21`，原 #5027 改了 7 个文件，合计 `+1158 / -28`：新增 native wrapper 与测试占了大头；同时修改了四个已有生产文件。

| 已有生产文件 | 原 #5027 的工作 | 基于新结构的迁移 |
| --- | --- | --- |
| `distributed/config.py` | 把 `mufile` 加入类型/CLI 枚举，并补说明 | 名字不再受中央白名单限制；无需为接纳名称改代码，文档说明可独立补充 |
| `_gds_async.py` | 增加导入分支、平台分支与能力转发 | 该模块已移除；发现、选择不需要增加 muFile 分支 |
| `gds_context.py` | raw stream 适配、能力查询、关闭 driver | raw stream 的设备抽象仍需补；driver 收尾已有；相同常量不必重新转发 |
| `platform/devices/musa/cache_context.py` | staging 注册、注销与生命周期接入 | 仍需要，这是 MUSA 设备桥接 |

所以可以精确地说：**两处已有核心文件的“backend 登记修改”消失了；按原 PR 的文件划分，四处已有生产文件修改可收敛为两处必要的设备桥接。** 若把 raw stream 接口放进新的公共设备 helper，文件总数会相应变化，不能把“两个”当作最终 patch 的硬性指标。

原 PR 中 `config.py` 与 `_gds_async.py` 合计 66 行增删，是这两处旧修改的实际规模；它包含说明与能力转发，**不是承诺新 PR 净减少恰好 66 行**。616 行 native wrapper、364 行 backend 测试也不会凭空消失，只会在迁移时复用公共契约并去掉重复生命周期代码。[原 PR 文件差异][mu-files]

重构最重要的收益，不是漂亮的删行百分比，而是新增实现不再迫使所有 backend 共用的调度代码跟着变化。review 可以集中检查新的 ABI 和设备边界；原有 backend 的回归风险也更容易控制。

测试同样应该围绕边界：检查 native 参数与出参存活期、失败时清理、stream 顺序、首次使用才加载库、以及新模块能被发现。没有必要为每个子类重复测试 Python 自己的继承机制。

<h2 id="gds-future">八、容量与可扩展性：GDS 的意义在哪里</h2>

把 SSD 接进来，不会让它突然拥有 HBM 的延迟。一次缓存复用是否划算，仍要比较：**从 NVMe 恢复 KV 的成本，是否小于重新 prefill 的成本。** 命中率、chunk 大小、I/O 并发、SSD 带宽、PCIe 拓扑、GPU 布局搬运以及写放大，都会影响答案。这里没有给出 benchmark，就不应宣称某个 backend 总是更快。

但随着长上下文、更多并发会话和可复用前缀的积累，只靠 DRAM 扩容会越来越昂贵。**本地 NVMe 提供容量，GDS 尝试降低“把这些容量用起来”的搬运成本。** 当前活跃 KV 留在 GPU，需要再次使用的缓存再恢复，才是这套设计的价值。

Phoenix 在更底层探索统一 storage-to-xPU 的 I/O 栈；LMCache 则在上层统一缓存对象、布局搬运、资源生命周期和存储接口。两者解决的是不同层的问题，可以配合，却不能互相替代。Phoenix 的设备支持扩展仍要验证，LMCache 的设备平台桥接也仍要做。

回看这次重构，方法并不神秘：

- 先认清谁拥有资源、谁等待完成、谁解释布局。
- 把共同行为放在父类，把真实差异留在实现。
- 让调用者依赖 `GDSBackend` 与 `GDSHandle`，让实现自己准备 slab、加载库、解释 native ABI。
- 用目录发现与 lazy import 把“增加实现”从“编辑中央名单”中解放出来，同时保留清楚的错误边界。

最后，GDS 可以还原成几件具体的事：**找对缓存区域，准备好可 DMA 的 GPU 内存，把读写排到正确的 stream，保存所有仍被原生代码引用的资源，完成后再发布或回收。**

“SSD 直达 GPU”并不魔法。真正困难、也真正值得读懂的，是这条路径如何和推理引擎的分页 KV、MP 的进程边界以及异步生命周期严丝合缝地接起来。

## 源码与延伸阅读

正文中的源码均固定到同一 LMCache 版本；动画中的 block IDs、offset 和数据块是教学算例，不是性能测量。

- [LMCache 新结构快照][snapshot]、[GDSBackend / GDSHandle 接口][base-src]、[backend 发现][factory-src]。
- [STORE / RETRIEVE][store-src]、[object-group transfer][transfer-src]、[GDSContext][context-src]。
- [LMCache GDS L1 配置][gds-doc]、[Quickstart][quickstart]。
- [NVIDIA GDS 概览][nvidia-overview]、[设计说明][nvidia-design]、[cuFile API][nvidia-api]。
- [hipFile 安装][hip-install]、[fast path 检查][hip-check]、[uGDS 安装][ugds-install]。
- [Phoenix 项目][phoenix]、[安装指南][phx-install]、[架构说明][phx-arch]。
- [muFile 原提案][pr5027]及其[固定版本差异][mu-files]。

[pr5271]: https://github.com/LMCache/LMCache/pull/5271
[snapshot]: https://github.com/LMCache/LMCache/tree/c9b51e424acf4d88d9c18ed95828bd234a205b5f
[pr5027]: https://github.com/LMCache/LMCache/pull/5027
[mu-snapshot]: https://github.com/LMCache/LMCache/tree/aad13e213f42d141def3021af29cee1054869386
[mu-files]: https://github.com/LMCache/LMCache/compare/1a4b40b1d79b0e76244f127f96ee0982f8bd270f...aad13e213f42d141def3021af29cee1054869386
[mufile-src]: https://github.com/LMCache/LMCache/blob/aad13e213f42d141def3021af29cee1054869386/lmcache/v1/gpu_connector/_mufile_async.py
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
[phoenix]: https://github.com/xPU-IO/Phoenix
[phx-install]: https://github.com/xPU-IO/Phoenix/blob/5c37071f3660a768d970dceb78a6c189c477af00/doc/install.md
[phx-arch]: https://github.com/xPU-IO/Phoenix/blob/5c37071f3660a768d970dceb78a6c189c477af00/doc/architecture.md
