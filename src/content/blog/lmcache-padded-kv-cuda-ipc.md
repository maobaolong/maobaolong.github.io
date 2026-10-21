---
title: "一段合法的内存空洞，如何让 LMCache CUDA IPC 失效"
description: "从 LMCache Issue #5097 出发，解释 hybrid model 的 dim-0 padding、stride、三种 CUDA IPC wrapper，以及 PR #5693 和 #5855 如何用 byte span 与 as_strided 恢复零拷贝传输。"
publishedAt: 2026-10-21
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - cuda-ipc
  - kv-cache
  - hybrid-model
  - glm
author: "毛宝龙"
readingTime: "18 min"
featured: true
draft: false
---

有些故障来自非法输入，也有些故障来自一份**完全合法、却超出旧代码想象**的内存布局。

[LMCache Issue #5097](https://github.com/LMCache/LMCache/issues/5097) 属于后者。GLM-5.3-Flash 在 LMCache MP 0.5.5 下启动时，`RawCudaIPCWrapper` 收到这样的 tensor：

```text
shape  = (11285, 1, 640, 848)
stride = (655360, 542720, 848, 1)
```

随后报错：tensor 不是 contiguous。

乍看像是模型给了一个“坏 tensor”。但真正的问题恰好相反：这是 hybrid model 为了让不同 KV cache group 共用统一 page 而产生的合法 padded view。旧 IPC wrapper 只会重建紧密排列的 tensor，无法表达 block 之间的空洞，于是选择 fail closed。

这篇文章从零解释问题怎样出现、为什么在 isolated IPC 成为默认值以后集中暴露，以及 [PR #5693](https://github.com/LMCache/LMCache/pull/5693) 和 [PR #5855](https://github.com/LMCache/LMCache/pull/5855) 分别怎样补齐 Raw CUDA IPC 与 CUDA VMM 两条传输路径。

## 一张图看懂 issue 与两个修复的关系

<section class="ipc-article-map" aria-label="Issue #5097 与两个修复的关系图">
  <div class="ipc-map-column">
    <div class="ipc-map-node ipc-map-node--problem"><strong>Issue #5097</strong><span>GLM-5.3-Flash 的 KV view 带 dim-0 padding；isolated 模式注册失败。</span></div>
    <div class="ipc-map-node"><strong>共同根因</strong><span>shape 描述逻辑元素，stride 才描述真实物理间距；旧代码把两者当成同一件事。</span></div>
  </div>
  <div class="ipc-map-arrow" aria-hidden="true">→</div>
  <div class="ipc-map-column">
    <div class="ipc-map-node"><strong><code>isolated_ipc=true</code></strong><span>进入 <code>RawCudaIPCWrapper</code>，旧实现要求 contiguous。</span></div>
    <div class="ipc-map-node"><strong><code>use_vmm_api=true</code></strong><span>优先进入 <code>VmmCudaIPCWrapper</code>，旧实现也有相同假设。</span></div>
    <div class="ipc-map-node"><strong>两个开关都为 false</strong><span>进入 PyTorch storage IPC；这条路原本就能按 shape + stride 恢复 view。</span></div>
  </div>
  <div class="ipc-map-arrow" aria-hidden="true">→</div>
  <div class="ipc-map-column">
    <div class="ipc-map-node ipc-map-node--fix"><strong>PR #5693</strong><span>修 Raw CUDA IPC：映射完整 byte span，接收端用 <code>as_strided</code>。</span></div>
    <div class="ipc-map-node ipc-map-node--fix"><strong>PR #5855</strong><span>把同一算法补到 VMM，并让 physical-chunk 检查覆盖 padding。</span></div>
  </div>
</section>

## 先补齐五个基础概念

### KV cache

模型完成 prompt 的 prefill 后，会留下每一层的 Key / Value 中间结果。后续请求如果拥有相同前缀，可以直接恢复这些结果，省去重复计算。LMCache 的工作就是把这些结果从 vLLM 的 GPU KV pool 搬到外部缓存，并在需要时搬回来。

### Shape 与 stride

shape 只说明 tensor 在逻辑上有多少个元素。例如 `(4, 8)` 可以理解为 4 行、每行 8 个元素。

stride 则说明沿某一维移动一步时，内存指针要跨过多少个元素。两块 tensor 可以拥有相同 shape，却拥有完全不同的物理布局。

### Contiguous

如果一个 tensor 的所有逻辑元素在内存里紧密相邻，它就是 contiguous。此时只要知道 `numel`，通常就能映射一段连续字节再 `reshape` 回去。

### Padding

hybrid model 同时拥有普通 attention、MLA、Mamba 或 indexer 等不同 cache group。为了让这些 group 共享统一的物理 page，较小 group 的每个 block 后面可能会留出一段空白。这个空白就是 padding。

### IPC wrapper

vLLM worker 与 LMCache server 是不同进程。wrapper 不会把整块 KV 复制进消息，而是传递 GPU allocation 的共享句柄，以及重建 tensor 所需的 dtype、shape、stride、offset 等 metadata。

## 真实数字：旧代码到底少算了多少内存

Issue 中的 tensor 每个 block 的逻辑内容是：

```text
1 × 640 × 848 = 542,720 elements
```

但是 `stride[0]` 是 `655,360`。所以从一个 block 的开头走到下一个 block 的开头，必须跨过：

```text
655,360 - 542,720 = 112,640 padding elements
```

padding 占整个 block pitch 的 17.1875%。对全部 11,285 个 block：

```text
logical numel = 6,124,595,200 elements
physical span = 7,395,624,960 elements
```

旧 Raw/VMM wrapper 使用 `numel * element_size` 决定映射长度，再用 `reshape(shape)` 重建。它等价于假设每个 block 后面没有空洞。第二个 block 的读取地址因此会落进第一个 block 的 padding，后续所有 block 都会错位。

静默接受这种布局会造成 KV corruption。旧代码选择抛错，是正确的 fail-closed 行为；缺少的是一种能够安全表达空洞的重建方式。

## 跟着读取指针走一遍

下面的动画直接移动 SVG 里的读取指针。点击任意步骤，指针会从当前位置移动到新地址；最后一步会连续扫过四个正确的 block 起点。

<figure class="ipc-lab" data-ipc-lab data-label-read="读取指针" data-label-wrong="错误偏移" data-label-fixed="stride 寻址">
  <div class="ipc-lab__header">
    <h3>同一份 shape，两种完全不同的走法</h3>
    <span class="ipc-lab__step" data-ipc-counter>1 / 5</span>
  </div>
  <p class="ipc-lab__copy"><strong data-ipc-title></strong><span data-ipc-copy></span></p>
  <div class="ipc-lab__viewport">
    <svg viewBox="0 0 760 240" role="img" aria-label="四个带 padding 的 KV block 和移动读取指针">
      <g transform="translate(40 82)">
        <rect class="ipc-memory-payload" width="145" height="92" rx="8" />
        <rect class="ipc-memory-padding" x="145" width="35" height="92" rx="5" />
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
      <g data-ipc-pointer transform="translate(40 0)">
        <line class="ipc-pointer-line" x1="0" y1="42" x2="0" y2="188" />
        <circle class="ipc-pointer-dot" cx="0" cy="188" r="7" />
        <text class="ipc-pointer-text" data-pointer-label x="9" y="34">读取指针</text>
      </g>
    </svg>
  </div>
  <div class="ipc-lab__controls" role="group" aria-label="内存寻址动画控制">
    <button type="button" data-ipc-step data-x="40" data-state="normal" data-title="先看到统一大 page" data-copy="蓝色是这个 KV group 真正使用的内容，黄色是为了对齐 model-wide page size 留下的空洞。指针从 Block 0 的起点出发。">1. 统一 page</button>
    <button type="button" data-ipc-step data-x="220" data-state="normal" data-title="真实 stride 会跨过 padding" data-copy="stride[0] = 655,360，所以从 Block 0 起点走一步，必须越过黄色区域，准确落在 Block 1 起点。">2. 真实 stride</button>
    <button type="button" data-ipc-step data-x="185" data-state="wrong" data-title="numel + reshape 把指针带进空洞" data-copy="旧逻辑只前进 542,720 个元素，指针停在 Block 0 payload 之后的 padding 起点，而不是 Block 1。">3. 旧 reshape</button>
    <button type="button" data-ipc-step data-x="185" data-state="gated" data-title="旧 wrapper 选择拒绝" data-copy="与其静默读错 KV，旧实现检查 is_contiguous 并抛出 ValueError。启动失败，但避免了 silent corruption。">4. fail closed</button>
    <button type="button" data-ipc-step data-x="40" data-state="fixed" data-title="byte span + as_strided 恢复完整地图" data-copy="新逻辑映射包含 padding 的完整跨度，再按原始 stride 重建；指针会依次停在四个 block 的真实起点。">5. 修复后</button>
    <button class="ipc-play" type="button" data-ipc-play data-play-label="▶ 自动播放" data-pause-label="Ⅱ 暂停">▶ 自动播放</button>
  </div>
  <figcaption>动画中的蓝黄比例按真实 542,720 / 112,640 元素近似绘制。窄屏下画布可以横向滚动，不压缩文字。</figcaption>
</figure>

## 为什么同一个 tensor 会走三条不同路径

<section class="ipc-mode-grid" aria-label="LMCache CUDA IPC wrapper 选择矩阵">
  <div class="ipc-mode-card"><strong><code>use_vmm_api=true</code></strong><span>优先选择 <code>VmmCudaIPCWrapper</code>。allocation 来自 CUDA VMM，需要 fd 或 FABRIC handle。PR #5855 修复这条路径。</span></div>
  <div class="ipc-mode-card"><strong><code>isolated_ipc=true</code></strong><span>选择 <code>RawCudaIPCWrapper</code>。它使用 driver-level CUDA IPC handle，不依赖共享 <code>/dev/shm</code>。PR #5693 修复这条路径。</span></div>
  <div class="ipc-mode-card"><strong>两个开关都为 false</strong><span>选择 <code>CudaIPCWrapper</code>。PyTorch storage IPC 原本就会按 storage、offset、shape 和 stride 恢复 view。</span></div>
</section>

`use_vmm_api` 的优先级最高，因为 VMM allocation 无法用 legacy CUDA IPC memory handle 表达。它可以和 isolated 模式组合，但如果 allocation 只能导出 POSIX fd，而两个容器之间又没有共享路径，仍然需要 IMEX/FABRIC 或关闭 isolated。这不是 padding 修复能够改变的约束。

## 为什么问题在 0.5.5 附近突然集中出现

<section class="ipc-timeline" aria-label="问题出现的因果时间线">
  <div class="ipc-timeline__item"><strong>Hybrid model 使用统一 page</strong><span>不同 cache group 的真实内容大小不同，较小 group 得到 dim-0-padded view。</span></div>
  <div class="ipc-timeline__item"><strong>格式检测已经接受这种布局</strong><span><code>attempt_permute_to_contiguous_view</code> 会验证它只有 dim-0 padding，内部维度仍紧密。</span></div>
  <div class="ipc-timeline__item"><strong>Operator PR #4807 改变默认路径</strong><span>NVIDIA 部署默认启用 isolated IPC，不再共享 hostIPC / <code>/dev/shm</code>，因此更多部署进入 Raw wrapper。</span></div>
  <div class="ipc-timeline__item"><strong>Raw/VMM wrapper 仍保留 flat-bytes 假设</strong><span>上游认为 layout 合法，wrapper 却只能处理 contiguous，于是注册阶段抛错。</span></div>
  <div class="ipc-timeline__item"><strong>#5693 与 #5855 补齐重建能力</strong><span>不是改变模型布局，而是让 IPC 接收端按已经验证过的 stride 重建原 view。</span></div>
</section>

换句话说，padding 并不是突然出现的。真正变化的是默认传输路径：过去 non-isolated 的 PyTorch storage IPC 可以保留 stride；isolated 成为默认后，同一个 tensor 开始进入只懂 flat bytes 的 Raw wrapper，潜在不兼容才变成默认启动错误。

## 两个 PR 的修复算法

旧逻辑可以简化成：

```python
if not tensor.is_contiguous():
    raise ValueError(...)

nbytes = tensor.numel() * tensor.element_size()
raw = map_cuda_bytes(nbytes)
return raw.view(dtype).reshape(shape)
```

新逻辑分成两步。

第一步，用 metadata 计算 view 实际能访问到的最后一个元素：

```python
byte_span = itemsize * (
    storage_offset
    + 1
    + sum((size - 1) * stride for size, stride in zip(shape, stride))
)
```

对于 contiguous tensor，`byte_span` 等于 `numel * itemsize`；对于 dim-0-padded view，它把 block 之间的所有空洞也算进去。

第二步，接收端不再 `reshape`，而是恢复原始 stride：

```python
raw = map_cuda_bytes(byte_span)
tensor = raw.view(dtype).as_strided(shape, stride)
```

这仍然是 zero-copy：没有调用 `.contiguous()`，没有创建一份巨大的 KV 副本，只是为同一段共享 GPU memory 建立正确的 view。

### #5693：Raw CUDA IPC

PR #5693 移除 Raw wrapper 的第二次 contiguous 拒绝，使用 `TensorMetadata.byte_span()` 决定映射长度，并以 `as_strided` 重建。新增跨进程测试不仅比较读取内容，还让接收进程写回 `-1`，随后检查每个 block 的 padding sentinel 仍保持不变。这验证了指针没有踩进空洞。

### #5855：CUDA VMM

PR #5855 把相同算法应用到 VMM wrapper。它还有一个额外细节：metadata 必须在导出 allocation 前完成初始化，这样“tensor 是否落在一个 physical chunk 内”的边界检查才能使用 padded byte span，而不是只检查逻辑 numel。

VMM 原有的限制仍然保留：不可导出的 allocation 继续报错；跨多个 physical chunk 的 view 继续报错；isolated 模式下无法传递 POSIX fd 时也继续报错。padding 修复没有放宽这些资源所有权边界。

## 为什么移除 contiguous 检查不会接受任意危险 stride

这两个 PR 并没有让任意 `as_strided` tensor 都能穿过 IPC。

在 wrapper 之前，`attempt_permute_to_contiguous_view()` 已经做了严格验证：

- 最后一维 stride 必须为 1；
- 内部维度必须紧密排列；
- 只有 dim-0 可以比逻辑 block 更宽；
- `stride[0]` 不能小于内部元素乘积，block 不能重叠；
- interior-dim padding、任意切片或其他未知布局继续 fail closed。

因此修复的安全边界不是“接受 non-contiguous”，而是“接受一种已经被识别和证明可由 transfer kernel 理解的 non-contiguous”。

## “no lookup ipc key” 为什么容易误导

Issue 还记录了另一个现象：关闭 isolated IPC 后，模型能够启动，但 server 在每个请求结束时打印：

```text
Session <ID> has no lookup ipc key, skipping touch
```

这条日志发生在 `end_session()`。它的直接含义是：session 结束时没有 `lookup_ipc_key`，所以无法刷新相关 L1 object 的最近使用时间。它不是“丢弃 chat 请求”的日志，也不能单独证明 STORE / RETRIEVE 没有执行。

在 0.5.5 的 lookup 路径里，至少有两种情况会在写入 key 之前返回：

1. 没有注册好的 GPU layout/context；
2. 没有完整 chunk hash。

Issue 配置的 `chunkSize` 是 640。如果 prompt 短于一个完整 chunk，本来就没有可 lookup 的 chunk。复测者还指出 `l1.sizeGB: 4` 对这个模型太小，prefetch 无法预留空间，命中率会保持为 0%。这些现象叠加在一起，很容易被理解成“LMCache 忽略了所有请求”。

但原始报告没有给出触发 warning 的请求 token 数和同一时刻的完整 server 日志，因此无法从现有材料唯一确定它走的是哪个 early-return 分支。能够确定的是：这条 warning 与 padded-stride 注册错误不是同一层问题。

## 两个相关但独立的 vLLM 问题

[vLLM Issue #54831](https://github.com/vllm-project/vllm/issues/54831) 讨论 GLM-5.3 的 DSA indexer `tail_cache`、page-size unification 与 offloading/hash alignment。它解释了为什么 hybrid model 会产生如此极端的 padding，但不是 LMCache IPC wrapper 的直接修复。

[vLLM PR #57317](https://github.com/vllm-project/vllm/pull/57317) 修复 Kpool tail ring buffer 被错误套用 generic slot-mapping kernel 的越界问题。它解决的是 vLLM 自身的寻址错误；LMCache 的两个 PR 解决的是跨进程重建 stride。复现时必须把两者分开，否则第一个崩溃可能遮住第二个。

## 最后总结

Issue #5097 的核心不是“non-contiguous tensor 需要强行变 contiguous”，而是：

> 一个合法 view 的物理跨度大于它的逻辑元素总量。任何跨进程重建如果只保存 shape、丢掉 stride 与 padding，都会读到错误地址。

PR #5693 与 #5855 采用了同一条正确原则：

1. 上游先严格验证只存在 dim-0 padding；
2. IPC 映射覆盖完整 byte span；
3. 接收端用原始 shape + stride 建立 zero-copy view；
4. Raw 与 VMM 各自保留原有 allocation、export 与 chunk 边界。

这也是分析 GPU tensor 问题时最值得重复使用的方法：不要只看 shape 和 numel，要沿着 stride 亲自走一遍指针。

## 参考资料

- [LMCache Issue #5097](https://github.com/LMCache/LMCache/issues/5097)
- [LMCache PR #5693](https://github.com/LMCache/LMCache/pull/5693)
- [LMCache PR #5855](https://github.com/LMCache/LMCache/pull/5855)
- [LMCache Operator PR #4807](https://github.com/LMCache/LMCache/pull/4807)
- [vLLM Issue #54831](https://github.com/vllm-project/vllm/issues/54831)
- [vLLM PR #57317](https://github.com/vllm-project/vllm/pull/57317)
