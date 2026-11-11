---
title: "从零理解 CUDA VMM、POSIX FD、FABRIC 与 LMCache：一块 GPU 显存如何跨进程共享"
description: "从虚拟地址与物理显存讲起，用交互动画解释 legacy CUDA IPC、VMM、POSIX file descriptor、FABRIC handle、IMEX channel，以及 vLLM extensible KV cache 与 LMCache MP 为什么必须先协商内存访问方式。"
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
author: "毛宝龙"
readingTime: "28 min"
featured: true
draft: false
---

第一次看到下面这些词时，很容易把它们理解成几种“传输协议”：

```text
VMM / FD / FABRIC / IMEX / CUDA IPC
```

于是问题越想越乱：FD 是不是一个文件？FABRIC 是不是数据一定经过 NVLink？VMM 是不是把 GPU 显存放进虚拟机？既然 vLLM worker 和 LMCache server 都在同一台机器，为什么不能直接把 GPU pointer 发过去？`isolated_ipc` 又和 Docker 的 `--ipc host` 有什么关系？

这篇文章从零开始，只解决一个核心问题：

> **vLLM worker 拥有一块 GPU KV Cache，LMCache server 是另一个进程。后者怎样安全地“看见”并映射前者的显存？**

理解这件事以后，VMM、POSIX FD、FABRIC、IMEX 和这次 [LMCache PR #6499](https://github.com/LMCache/LMCache/pull/6499) 的自动检测，就不再是五个互不相干的名词，而是一条完整因果链。

本文状态固定到 **2026-11-11**：vLLM extensible KV cache [#56492](https://github.com/vllm-project/vllm/pull/56492) 与 connector access contract [#66605](https://github.com/vllm-project/vllm/pull/66605) 已合并；让 extensible allocation 真正支持 POSIX FD 导出的 [#66674](https://github.com/vllm-project/vllm/pull/66674) 仍是 open PR；LMCache 自动检测 [#6499](https://github.com/LMCache/LMCache/pull/6499) 仍是 Draft。后续状态变化请以链接中的当前代码为准。

<section class="vmm-hero" aria-labelledby="vmm-hero-title">
  <p class="vmm-kicker">CUDA memory sharing · visual field guide</p>
  <h2 id="vmm-hero-title">数据没有塞进 handle；handle 只是获得那块显存的能力凭证</h2>
  <p class="vmm-hero__lede">先分清“显存本体、进程内地址、跨进程凭证、传递凭证的通道”四层，几乎所有概念都会自动归位。</p>
  <div class="vmm-hero__legend" aria-label="四层心智模型">
    <span><i></i>虚拟地址：本进程怎么看</span>
    <span><i></i>物理显存：数据实际在哪</span>
    <span><i></i>共享 handle：允许谁重新映射</span>
  </div>
</section>

<nav class="vmm-map" aria-label="文章目录">
  <a href="#process-address"><strong>01</strong><span>为什么 pointer 不能跨进程</span></a>
  <a href="#legacy-ipc"><strong>02</strong><span>Legacy CUDA IPC 是什么</span></a>
  <a href="#vmm"><strong>03</strong><span>VMM 如何拆开地址与物理页</span></a>
  <a href="#fd-fabric"><strong>04</strong><span>FD、FABRIC、IMEX 的区别</span></a>
  <a href="#vllm"><strong>05</strong><span>vLLM 为什么引入 extensible cache</span></a>
  <a href="#lmcache"><strong>06</strong><span>LMCache 怎样导出与导入</span></a>
  <a href="#autodetect"><strong>07</strong><span>自动检测解决了什么</span></a>
  <a href="#checklist"><strong>08</strong><span>部署判断与排错清单</span></a>
</nav>

<h2 id="process-address">一、先忘掉 CUDA：为什么一个 pointer 不能直接交给另一个进程</h2>

假设 vLLM worker 打印出一个地址：

```text
0x7f20_8000_0000
```

这个数字不是“GPU 上的全球门牌号”。它只在当前 CUDA context / 进程的虚拟地址空间里有意义。另一个进程即使收到完全相同的整数，也没有对应映射；它可能得到错误地址，也可能那里根本没有任何东西。

CPU 进程早就遵循同样规则。进程 A 的 `0x1234` 和进程 B 的 `0x1234` 可以指向完全不同的物理页。操作系统用页表完成“虚拟地址 → 物理页”的翻译。GPU 也有类似的虚拟地址与映射机制。

因此跨进程共享显存至少需要四样东西：

<section class="vmm-primer" aria-label="跨进程共享显存的四个组成部分">
  <section><strong>1. Allocation</strong><p>真正保存 K/V bytes 的物理显存对象。它不是消息中的 pointer。</p></section>
  <section><strong>2. Local mapping</strong><p>把 allocation 映射到 worker 自己的 GPU 虚拟地址，模型 kernel 才能读写。</p></section>
  <section><strong>3. Shareable handle</strong><p>一个可导出、可导入的能力凭证，让 Server 能引用同一个 allocation。</p></section>
  <section><strong>4. Handle transport</strong><p>把凭证从 worker 送到 Server。不同 handle 类型需要不同传递方式。</p></section>
  <section><strong>5. Remote mapping</strong><p>Server 导入 handle，在自己的地址空间里重新 reserve/map，得到自己的 pointer。</p></section>
  <section><strong>6. Lifetime</strong><p>exporter 释放 allocation 之前，importer 必须停止使用并解除映射。</p></section>
</section>

这里最重要的一句话是：

<div class="vmm-callout"><p><strong>Pointer 是“我从哪里访问”；handle 是“我凭什么重新映射同一块物理内存”。</strong> 两个进程不需要得到相同 pointer，只需要最终映射到同一个 allocation。</p></div>

<h2 id="legacy-ipc">二、Legacy CUDA IPC：普通 allocation 的传统共享方式</h2>

最经典的路径是：进程 A 用 `cudaMalloc` / `cuMemAlloc` 得到普通 device allocation，然后调用 `cudaIpcGetMemHandle()` 或 `cuIpcGetMemHandle()` 导出一个 opaque IPC handle。进程 B 收到 handle 后调用 `cudaIpcOpenMemHandle()` / `cuIpcOpenMemHandle()`，CUDA driver 在 B 的地址空间中建立映射，返回 B 自己可用的 device pointer。

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

这条路的特点是：

- handle 本身不包含 KV 数据，只描述如何找到 allocation；
- A 与 B 得到的 pointer 不保证相同；
- allocation 的生命周期仍由 exporter 约束；
- 它适合传统 CUDA allocation，但**不能用来表达 CUDA VMM 创建的 physical allocation handle**；
- CUDA 官方把它称为 legacy IPC，与 VMM 的 shareable-handle 路径区分开。[CUDA IPC 官方文档](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/inter-process-communication.html)

在 LMCache 中，如果 `use_vmm_api=false`：

- 普通共享环境走 PyTorch storage IPC wrapper；
- `isolated_ipc=true` 时走 driver-level `RawCudaIPCWrapper`；
- 两者都属于传统 CUDA IPC 家族，**都不是 FABRIC handle**。

为什么要有 Raw wrapper？因为默认 PyTorch storage IPC 路径可能依赖共享 IPC 资源，而隔离容器不应该假设双方共享 `/dev/shm` 或 host IPC namespace。Raw wrapper 直接传 driver-level handle metadata，减少这层环境耦合。

<h2 id="vmm">三、CUDA VMM：先预留地址，再决定背后放多少物理显存</h2>

VMM 是 **Virtual Memory Management**。这里的“虚拟”不是虚拟机，也不是把显存自动 swap 到磁盘；它表示应用显式管理 GPU 虚拟地址与 physical allocation 的映射。

传统 `cudaMalloc(size)` 把几件事绑在一起：选择大小、分配 physical memory、建立 mapping、返回 pointer。CUDA VMM 把它拆开：

1. `cuMemAddressReserve`：预留一段连续虚拟地址；
2. `cuMemCreate`：创建 physical allocation handle；
3. `cuMemMap`：把某个 physical allocation 映射到某段虚拟地址；
4. `cuMemSetAccess`：授予指定 device 的访问权限；
5. 不再使用时依次 `cuMemUnmap`、`cuMemRelease`、`cuMemAddressFree`。

<figure class="vmm-lab" data-vmm-lab data-stage="0" aria-label="CUDA VMM 四步交互动画">
  <div class="vmm-lab__header"><h3>把“地址”和“物理显存”拆开看</h3><span class="vmm-lab__counter" data-vmm-counter>1 / 4</span></div>
  <p class="vmm-lab__copy"><strong data-vmm-title></strong><span data-vmm-copy></span></p>
  <div class="vmm-lab__viewport">
    <svg viewBox="0 0 760 330" role="img" aria-label="虚拟地址槽、物理显存块、映射关系和导出 handle">
      <text class="vmm-label" x="42" y="48">Virtual address range</text><text class="vmm-sub" x="42" y="69">stable pointer seen by CUDA graphs</text>
      <g transform="translate(42 88)"><rect class="vmm-va-slot" width="150" height="62" rx="8"/><rect class="vmm-va-slot" x="158" width="150" height="62" rx="8"/><rect class="vmm-va-slot" x="316" width="150" height="62" rx="8"/><rect class="vmm-va-slot" x="474" width="150" height="62" rx="8"/><text class="vmm-sub" x="17" y="37">VA 0</text><text class="vmm-sub" x="175" y="37">VA 1</text><text class="vmm-sub" x="333" y="37">VA 2</text><text class="vmm-sub" x="491" y="37">VA 3</text></g>
      <path class="vmm-map-line" d="M112 154 C112 195 120 198 120 226"/><path class="vmm-map-line" d="M270 154 C270 195 290 198 290 226"/><path class="vmm-map-line" d="M428 154 C428 195 460 198 460 226"/>
      <text class="vmm-label" x="42" y="214">Physical allocations</text>
      <g transform="translate(42 226)"><rect class="vmm-physical" width="155" height="62" rx="8"/><rect class="vmm-physical" x="170" width="155" height="62" rx="8"/><rect class="vmm-physical" x="340" width="155" height="62" rx="8"/><text class="vmm-sub" x="18" y="37">chunk A</text><text class="vmm-sub" x="188" y="37">chunk B</text><text class="vmm-sub" x="358" y="37">chunk C</text></g>
      <rect class="vmm-export" x="585" y="221" width="132" height="72" rx="12"/><text class="vmm-export-text" x="651" y="249" text-anchor="middle">shareable</text><text class="vmm-export-text" x="651" y="270" text-anchor="middle">handle</text>
    </svg>
  </div>
  <div class="vmm-lab__controls" role="group" aria-label="VMM 动画步骤">
    <button type="button" data-vmm-step="0" data-title="① Reserve：先圈出稳定地址" data-copy="虚拟地址范围可以先存在，背后暂时没有完整 physical memory。CUDA graph 捕获到的是稳定地址，不要求此刻就决定最终 KV cache 大小。">1. Reserve</button>
    <button type="button" data-vmm-step="1" data-title="② Create：按最终需要创建物理块" data-copy="完成 warmup 和 CUDA graph capture 后，vLLM 知道真实剩余显存，再创建所需的 physical allocations，避免靠提前猜测留下过多 slack。">2. Create</button>
    <button type="button" data-vmm-step="2" data-title="③ Map：把物理块接到已预留地址" data-copy="cuMemMap 把 physical chunks 映射进连续虚拟地址。模型仍看到原来的地址，而实际 backing memory 可以晚些决定。">3. Map</button>
    <button type="button" data-vmm-step="3" data-title="④ Export：共享的是 physical allocation handle" data-copy="另一个进程要访问时，必须导出 allocation 创建时允许的 handle 类型；它可能是 POSIX fd，也可能是 FABRIC handle。">4. Export</button>
    <button type="button" data-vmm-play data-play-label="▶ 自动播放一次" data-pause-label="Ⅱ 暂停" aria-pressed="false">▶ 自动播放一次</button>
  </div>
  <figcaption>动画只展示概念关系。真实 VMM 还需要 granularity 对齐、device access 权限和严格的 unmap/release 生命周期。</figcaption>
</figure>

VMM 的价值不是“pointer 更快”，而是**地址稳定、backing 可晚绑定、physical chunks 可精确控制**。NVIDIA 官方文档还列出按 allocation 控制 peer accessibility、减少 fragmentation、动态扩展与跨进程共享等用途。[CUDA VMM Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/virtual-memory-management.html)

<div class="vmm-callout vmm-callout--gold"><p><strong>常见误区：</strong>VMM allocation 不是一块普通 `cudaMalloc` memory 加了新名字。它的 physical memory 由 `CUmemGenericAllocationHandle` 表示，所以 legacy `cuIpcGetMemHandle(pointer)` 不是正确共享契约。</p></div>

<h2 id="fd-fabric">四、POSIX FD、FABRIC handle 与 IMEX：三者分别解决什么</h2>

VMM physical allocation 是否能被另一个进程导入，必须在创建 allocation 时声明 `requestedHandleTypes`。LMCache 当前关心两类：

### 4.1 POSIX file descriptor：本机 OS 帮你转交 capability

当 allocation 支持 `CU_MEM_HANDLE_TYPE_POSIX_FILE_DESCRIPTOR` 时，worker 可以调用：

```text
cuMemExportToShareableHandle(..., POSIX_FILE_DESCRIPTOR, ...) -> fd
```

这个 fd 不是“装着 KV 的普通文件”，也不是把 GPU 数据写进磁盘。它是 Linux 内核维护的一条 process-local descriptor，引用 driver 暴露的 memory object。

这里有一个非常反直觉的细节：

```text
worker 里的 fd = 17
```

把整数 `17` 序列化进 ZMQ/gRPC 消息，server 收到 `17`，**并不会得到同一个 fd**。server 的 descriptor table 里，17 可能指向日志文件，也可能没有打开。

真正传 fd 必须使用 Unix domain socket 的 ancillary data，也就是 `SCM_RIGHTS`。内核在接收进程中创建一个新的 fd number，让它引用同一个 kernel object。

LMCache 因此有一条独立于业务 request transport 的 fd channel：

```text
/dev/shm/lmcache_fd_<port>.sock
AF_UNIX + SOCK_SEQPACKET + SCM_RIGHTS
```

所以 ZMQ/gRPC 使用 TCP 并不等于“fd 也能走 TCP”。worker 和 LMCache server 还必须能看到同一个 Unix socket 路径；在容器部署中，这通常意味着共享对应的 `/dev/shm`。LMCache 的实现与生命周期说明可见 [`vmm_cuda_ipc.md`](https://github.com/LMCache/LMCache/blob/0a33e514c58585d39d5f2e59786b7fd86b0e6f49/docs/design/v1/platform/devices/cuda/vmm_cuda_ipc.md)。

### 4.2 FABRIC handle：driver 管理的可序列化 capability

CUDA 12.4+ 提供 `CU_MEM_HANDLE_TYPE_FABRIC`。导出的 `CUmemFabricHandle` 是一个 opaque blob；LMCache 当前按 64 bytes 处理并随 descriptor 传递，不需要在两端共享 Unix socket 文件。

但 FABRIC 不是“免费跨容器魔法”。exporter 与 importer 必须：

- device 支持 FABRIC handle；
- NVIDIA IMEX 能力已启用；
- 两个进程都能访问**同一个 IMEX channel**；
- allocation 创建时包含 FABRIC handle type。

IMEX 是 **inter-node memory exchange**。channel 是 driver 提供的安全与隔离边界，常见设备节点位于：

```text
/dev/nvidia-caps-imex-channels/channel0
```

同一 channel 的访问权相当于“允许这些进程交换/import fabric memory handle”。NVIDIA 文档明确说明，同一个 IMEX domain 可以覆盖一个 OS，也可以覆盖通过 NVIDIA IMEX daemon 安全连接的多个 OS；在支持的 NVLink fabric 系统上，FABRIC handle 也能用于跨节点映射。[NVIDIA VMM / FABRIC 文档](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/virtual-memory-management.html)

但是本文讨论的 LMCache MP 场景仍然是 **vLLM worker 与 LMCache server 的 allocation sharing**。不要因为底层 handle 叫 FABRIC，就自动推导出当前 LMCache MP 已经实现任意跨节点 KV cache 映射。

### 4.3 选择器：到底会走哪一种 handle

<figure class="vmm-handle-lab" data-vmm-handle-lab data-lang="zh" aria-label="CUDA memory handle 选择器">
  <div class="vmm-handle-lab__header"><h3>改变部署条件，观察共享路径</h3></div>
  <div class="vmm-handle-lab__controls">
    <div class="vmm-control-group"><span>allocation</span><div><button type="button" data-choice="allocation" data-value="legacy">普通 CUDA</button><button type="button" data-choice="allocation" data-value="vmm">VMM</button></div></div>
    <div class="vmm-control-group"><span>isolated IPC</span><div><button type="button" data-choice="isolated" data-value="false">否</button><button type="button" data-choice="isolated" data-value="true">是</button></div></div>
    <div class="vmm-control-group"><span>same IMEX channel</span><div><button type="button" data-choice="imex" data-value="false">没有</button><button type="button" data-choice="imex" data-value="true">可用</button></div></div>
  </div>
  <div class="vmm-handle-lab__viewport">
    <svg viewBox="0 0 760 245" role="img" aria-label="vLLM worker 通过 handle channel 连接 LMCache server">
      <rect class="vmm-route-node" x="42" y="55" width="210" height="120" rx="16"/><text class="vmm-route-label" x="147" y="91" text-anchor="middle">vLLM worker</text><text class="vmm-route-sub" x="147" y="117" text-anchor="middle">owns KV allocation</text><text class="vmm-route-sub" x="147" y="140" text-anchor="middle">exports capability</text>
      <path class="vmm-route-line" d="M270 115 H490"/><path class="vmm-route-line is-muted" d="M270 145 H490"/><text class="vmm-route-sub" x="380" y="103" text-anchor="middle" data-route-transport>AF_UNIX + SCM_RIGHTS</text><text class="vmm-route-sub" x="380" y="169" text-anchor="middle">KV bytes stay in GPU memory</text>
      <rect class="vmm-route-badge" data-route-badge x="320" y="116" width="120" height="34" rx="17"/><text class="vmm-route-badge-text" data-route-badge-text x="380" y="138" text-anchor="middle">POSIX FD</text>
      <rect class="vmm-route-node" x="508" y="55" width="210" height="120" rx="16"/><text class="vmm-route-label" x="613" y="91" text-anchor="middle">LMCache server</text><text class="vmm-route-sub" x="613" y="117" text-anchor="middle">imports handle</text><text class="vmm-route-sub" x="613" y="140" text-anchor="middle">maps same allocation</text>
    </svg>
    <div class="vmm-route-mobile" role="img" aria-label="vLLM worker 通过 handle channel 连接 LMCache server">
      <div class="vmm-route-mobile__node"><strong>vLLM worker</strong><span>owns KV allocation</span><span>exports capability</span></div>
      <div class="vmm-route-mobile__channel"><span data-route-transport>AF_UNIX + SCM_RIGHTS</span><i aria-hidden="true"></i><strong data-route-badge-text>POSIX FD</strong><small>KV bytes stay in GPU memory</small></div>
      <div class="vmm-route-mobile__node"><strong>LMCache server</strong><span>imports handle</span><span>maps same allocation</span></div>
    </div>
  </div>
  <div class="vmm-handle-lab__result" aria-live="polite"><strong data-handle-title></strong><p data-handle-copy></p></div>
</figure>

把它压缩成一句判断：

<div class="vmm-callout"><p><strong>普通 allocation 用 legacy IPC；VMM allocation 必须使用它创建时声明的 shareable handle。非隔离环境可用 POSIX fd，隔离环境通常需要 FABRIC + IMEX。</strong></p></div>

<h2 id="vllm">五、vLLM 为什么突然需要 VMM：CUDA Graph 要稳定地址，KV Cache 又想晚点定大小</h2>

LLM 推理中的 KV Cache 往往占用大量 GPU memory。vLLM 过去需要在 CUDA graph capture 之前决定 KV cache 大小，因为 graph 会把地址固化进去。

问题在于：真正完成 graph capture、warmup、attention workspace、sampler、speculative decode 等初始化以后，才知道还剩多少显存。提前 profile 只能估算，容易出现两种结果：

- 估少了：后续初始化 OOM；
- 留太多 slack：本来可以给 KV Cache 的显存被浪费。

vLLM [#56492](https://github.com/vllm-project/vllm/pull/56492) 引入 extensible KV cache，核心技巧正是 VMM：

```text
graph capture 之前：reserve 足够大的 virtual address range
graph capture / warmup：地址保持不变
知道最终可用显存后：create + map 实际需要的 physical chunks
```

这样 graph 看到的 pointer 不变，而 physical backing 可以在最终 sizing 后确定。该 PR 在 V2 CUDA/ROCm model runner 上默认启用这条路径。

但这又带来一个外部 connector 问题：一段虚拟连续的 KV cache 可能由多个 physical chunks 拼成；RDMA registration 常要求单个物理 allocation；LMCache MP 还需要把 physical allocation 导出给另一个进程。vLLM 不知道每个 out-of-tree connector 怎样访问内存，就无法在 allocation 阶段做对选择。

这就是 [vLLM #66605](https://github.com/vllm-project/vllm/pull/66605) 引入 `KVCacheAccess` contract 的原因。connector 可以提前声明：

| `KVCacheAccess` | connector 的含义 | allocation 要求 |
|---|---|---|
| `IN_PROCESS` | 只在 worker 内用 kernel/copy | 任意 allocation |
| `REGISTERS` | 用 UCX/RDMA 注册 | 每段单一 physical chunk |
| `EXPORTS_FD` | 另一个进程通过 POSIX fd import | 单一 chunk，且 fd-exportable |
| `EXPORTS_FABRIC` | 另一个进程通过 FABRIC import | 单一 chunk，且 FABRIC-exportable + IMEX |
| `LEGACY_IPC` | 只支持 legacy CUDA IPC | extensible VMM cache 不兼容 |

注意这里的方向：**不是 vLLM 读取 LMCache 私有配置，而是 LMCache connector 公布自己的内存访问契约。** vLLM 再把 connector 需求、GPU 能力、IMEX 条件和其他 `MultiConnector` 子项组合起来，解析最终 allocation。

截至 2026-11-11，contract 已经合并；`EXPORTS_FD` 对 extensible allocation 的真正实现仍在 [#66674](https://github.com/vllm-project/vllm/pull/66674) 中。也就是说，枚举值存在不等于所有 allocation path 已经能生产对应 handle。

<h2 id="lmcache">六、LMCache MP 的实际路径：导出的是 handle，注册的是 tensor view</h2>

vLLM worker 拥有真正的 GPU KV cache。LMCache server 需要在另一个进程里映射它，之后才能按 block IDs 执行 store/retrieve。

完整链路可以分成六步：

<section class="vmm-sequence" aria-label="LMCache VMM KV cache 注册时序">
  <section><strong>1. Connector 声明 access</strong><p>配置解析阶段返回 `EXPORTS_FD`、`EXPORTS_FABRIC` 或 `LEGACY_IPC`，让 vLLM 在分配前知道共享要求。</p></section>
  <section><strong>2. vLLM 解析 allocation</strong><p>结合平台能力与所有 connector，决定是否启用 extensible KV cache，以及 physical allocation 的 requested handle types。</p></section>
  <section><strong>3. Worker 选择 wrapper</strong><p>LMCache 根据已解析的 extensible / cuMem allocator 状态选择 `VmmCudaIPCWrapper`；显式 `use_vmm_api` 仍可覆盖。</p></section>
  <section><strong>4. 导出 physical handle</strong><p>VMM wrapper 查询 pointer 对应的 allocation，导出 POSIX fd 或 64-byte FABRIC handle，同时保存 shape、stride、offset 等 metadata。</p></section>
  <section><strong>5. 传递 descriptor 与 capability</strong><p>FABRIC handle 可随 descriptor；POSIX fd 必须额外通过 fd channel 的 `SCM_RIGHTS` 发送，并用 export ID 与业务消息配对。</p></section>
  <section><strong>6. Server import + map</strong><p>Server 导入同一 physical allocation、reserve/map 自己的地址，再按 metadata 重建 tensor view。之后的 KV 操作访问的是同一显存，不是注册时复制出来的一份。</p></section>
</section>

这也解释了为什么 request transport 与 fd channel 是两回事：

```text
ZMQ / gRPC request channel
  └─ 传配置、tensor metadata、export ID、状态

AF_UNIX fd channel（仅 POSIX-fd path）
  └─ 通过 SCM_RIGHTS 传真正的 descriptor capability

GPU allocation
  └─ KV bytes 留在 GPU，双方映射同一个 physical object
```

FABRIC path 不需要 fd channel，因为 handle 是可复制的 opaque bytes；但它把环境依赖换成了 IMEX channel access。两条路径不是谁“更高级”，而是安全域与部署边界不同。

<h2 id="autodetect">七、为什么要自动检测：allocation 是 vLLM 解析出来的，LMCache 不应该要求用户猜</h2>

在自动检测之前，用户需要手工写：

```json
{
  "lmcache.mp.use_vmm_api": true
}
```

问题是用户配置发生在很早，而 vLLM 的最终 allocation 结果取决于 model runner、平台能力、extensible cache、cuMem allocator、connector access、IMEX 与可能的 `MultiConnector` 组合。

于是出现一个循环依赖：

```text
LMCache：你最终是不是 VMM？我才能选 wrapper。
vLLM：你需要怎样共享？我才能决定 allocation。
```

[LMCache #6499](https://github.com/LMCache/LMCache/pull/6499) 把它拆成两个时间点：

1. **分配前声明需求**：没有显式 `use_vmm_api` 时，普通 IPC 声明 `EXPORTS_FD`；`isolated_ipc` 声明 `EXPORTS_FABRIC`；显式 false 才声明 `LEGACY_IPC`。
2. **分配后跟随结果**：构造 worker adapter 时，从 vLLM 已解析的 `enable_extensible_kv_cache` 或 `enable_cumem_allocator` 得到真实 `use_vmm_api`。

显式 `true/false` 仍然最高优先级，既用于兼容，也用于故障回退。旧版 vLLM 没有 `KVCacheAccess` 时，connector 返回 `None`，继续保留 import compatibility。

<div class="vmm-matrix">
<table>
  <thead><tr><th>用户配置</th><th>分配前声明</th><th>worker 最终行为</th><th>主要要求</th></tr></thead>
  <tbody>
    <tr><td>未设置</td><td><code>EXPORTS_FD</code></td><td>跟随 vLLM 最终 allocation</td><td>vLLM 支持 fd-exportable extensible allocation；共享 fd channel 路径</td></tr>
    <tr><td>未设置 + isolated</td><td><code>EXPORTS_FABRIC</code></td><td>跟随 vLLM 最终 allocation</td><td>设备支持 FABRIC；两端可访问同一 IMEX channel</td></tr>
    <tr><td><code>false</code></td><td><code>LEGACY_IPC</code></td><td>强制 legacy wrapper</td><td>vLLM 不应选择只可 VMM 共享的 allocation</td></tr>
    <tr><td><code>true</code></td><td>FD 或 FABRIC</td><td>强制 VMM wrapper</td><td>实际 allocation 必须导出对应 handle</td></tr>
  </tbody>
</table>
</div>

### PR 链为什么必须一起看

<section class="vmm-timeline" aria-label="vLLM 与 LMCache VMM PR 演进">
  <section><time>2026-11-02 · merged</time><strong>vLLM #56492</strong><p>引入 extensible KV cache：先 reserve 地址，最终 sizing 后再 map physical chunks。</p></section>
  <section><time>2026-11-10 · merged</time><strong>vLLM #66605</strong><p>让 connector 用 `KVCacheAccess` 声明注册、FD、FABRIC 或 legacy IPC 需求。</p></section>
  <section><time>2026-11-11 · open</time><strong>vLLM #66674</strong><p>让 `EXPORTS_FD` 真正创建 fd-exportable extensible allocations，并组合 FABRIC handle types。</p></section>
  <section><time>2026-11-11 · Draft</time><strong>LMCache #6499</strong><p>默认自动声明 access，并让 worker 跟随 vLLM 已解析的 VMM allocation。</p></section>
</section>

所以“自动检测 PR 已经写完”并不代表整条生产链已经在 released vLLM 中闭环。只有 contract、allocation support、LMCache export/import 与部署环境同时满足，VMM KV cache 才能被 LMCache server 正确映射。

<h2 id="checklist">八、部署与排错：看到报错时先问哪一层</h2>

### 8.1 先判断 allocation 家族

- vLLM 是否启用了 extensible KV cache？
- 是否显式启用了 cuMem allocator？
- LMCache worker 最终是否选择 `VmmCudaIPCWrapper`？
- 不要只看用户有没有写 `use_vmm_api`；自动模式要看 vLLM 的 resolved config。

### 8.2 如果走 POSIX FD

- device 是否支持 `CU_MEM_HANDLE_TYPE_POSIX_FILE_DESCRIPTOR`？
- allocation 创建时是否请求了该 handle type？
- worker 与 Server 是否能看到同一个 `/dev/shm/lmcache_fd_<port>.sock`？
- fd channel 是否在 Linux 上启动并成功连接？
- Server URL 是否能派生出正确 TCP port？
- 不要尝试把 raw fd integer 放进普通序列化消息。

### 8.3 如果走 FABRIC

- device 是否报告 FABRIC handle 支持？
- `nvidia-caps-imex-channels` 是否存在？
- exporter 与 importer 是否都能访问同一个 channel device？
- allocation 的 requested handle types 是否包含 FABRIC？
- 收到 `CUDA_ERROR_NOT_PERMITTED` 时，优先检查 IMEX 权限，而不是 tensor shape。

### 8.4 如果走 Legacy IPC

- allocation 是否真的是 legacy CUDA allocation，而不是 VMM physical mapping？
- exporter 是否仍然存活并持有 allocation？
- importer 是否在释放前关闭 mapping？
- isolated 环境是否走 Raw wrapper，而不是依赖共享 storage IPC？

### 8.5 最后才看 tensor view

handle 成功只代表“拿到了那块 memory”。要重建正确 tensor，还需要 dtype、shape、stride、storage offset 与 byte span。尤其是 hybrid model 的 dim-0 padding，VMM/Raw wrapper 必须映射包含空洞的完整 byte span，再用 `as_strided` 恢复 view。关于这部分，可以继续阅读：[一段合法的内存空洞，如何让 LMCache CUDA IPC 失效](/blog/lmcache-padded-kv-cuda-ipc/)。

## 最后，用四句话把整篇文章收起来

1. **VMM 是 allocation 模型**：它把虚拟地址 reservation 与 physical memory creation/mapping 分开。
2. **FD 与 FABRIC 是 VMM allocation 的两类 shareable handle**：它们不是 KV payload，也不是普通网络传输协议。
3. **FD 依赖 OS 帮你传 capability；FABRIC 依赖 driver + IMEX 授权域**：一个需要 Unix socket `SCM_RIGHTS`，另一个需要双方访问同一 IMEX channel。
4. **自动检测是两阶段协商**：LMCache 先声明需要怎样访问，vLLM 决定怎样分配；分配完成后，LMCache worker 再跟随最终结果选择 wrapper。

如果只记住一个画面，请记住：vLLM worker 与 LMCache server 各自有自己的 pointer；中间传递的 handle 让两边最终映射到同一个 physical allocation。**跨进程共享的核心不是“把地址发过去”，而是“把重新映射的能力安全地交过去”。**

## 参考资料

- [CUDA Programming Guide: Interprocess Communication](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/inter-process-communication.html)
- [CUDA Programming Guide: Virtual Memory Management](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/virtual-memory-management.html)
- [CUDA Driver API: Virtual Memory Management](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__VA.html)
- [vLLM #56492: Extensible KV cache](https://github.com/vllm-project/vllm/pull/56492)
- [vLLM #66605: Connector KV-cache access contract](https://github.com/vllm-project/vllm/pull/66605)
- [vLLM #66674: Exportable extensible KV cache for LMCache MP](https://github.com/vllm-project/vllm/pull/66674)
- [LMCache #6499: Auto-detect VMM KV cache allocation](https://github.com/LMCache/LMCache/pull/6499)
- [LMCache VMM CUDA IPC design](https://github.com/LMCache/LMCache/blob/0a33e514c58585d39d5f2e59786b7fd86b0e6f49/docs/design/v1/platform/devices/cuda/vmm_cuda_ipc.md)
