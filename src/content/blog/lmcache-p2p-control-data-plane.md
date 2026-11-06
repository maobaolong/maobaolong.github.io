---
title: "LMCache P2P 零基础详解：控制面、数据面、建链、查询与认证边界"
description: "用交互动画走通 LMCache multiprocess P2P 的节点注册、peer 发现、NIXL 握手、lookup/lock、地址返回、KV 直读与 unlock，并解释每一处为什么需要或不需要身份认证。"
publishedAt: 2026-11-06
category: AI Infra
tags:
  - LMCache
  - P2P
  - KV Cache
  - NIXL
  - ZMQ
  - gRPC
  - security
  - distributed-systems
author: 毛宝龙
readingTime: 32 min
featured: true
draft: false
---

如果只看名字，P2P 很容易让人产生一个模糊印象：两台 LMCache server 互相连接，然后把 KV Cache 传过去。

真正开始读代码后，问题会迅速变多：谁先知道谁？Coordinator 是否参与搬运？为什么既有 ZMQ/gRPC，又有 NIXL？lookup 返回的是 KV，还是地址？为什么需要 lock？P2P 能不能写另一个节点？如果要增加认证，API key 应该放在哪条链路上？是不是每一页 DMA 都要再验一次？

本文从零开始，只讨论 LMCache multiprocess 模式里的 P2P read path。基线固定到 2026-11-06 的 LMCache `dev` 快照 [`cf87a1ca`][snapshot]，这样图中的每一步都能和源码对上。本文不讨论未发布的安全事件或攻击 PoC；认证章节只做架构边界分析和防御设计。

<section class="p2p-hero" aria-labelledby="p2p-hero-title">
  <p class="p2p-kicker">LMCache P2P · visual field guide</p>
  <h2 id="p2p-hero-title">先问“谁决定读什么”，再问“谁搬了哪些字节”</h2>
  <p class="p2p-hero__lede">P2P 不是一条连接，而是三条逻辑通道叠在一起：Coordinator 提供目录，ZMQ/gRPC 协调查询与锁，NIXL 搬真正的 KV payload。把它们拆开，整个流程就不神秘了。</p>
  <div class="p2p-hero__lanes" aria-label="三条逻辑通道">
    <span class="p2p-lane p2p-lane--directory"><i></i>目录：谁在哪里</span>
    <span class="p2p-lane p2p-lane--control"><i></i>控制面：要读哪些 key</span>
    <span class="p2p-lane p2p-lane--data"><i></i>数据面：KV bytes 真正移动</span>
  </div>
</section>

<nav class="p2p-toc" aria-label="文章目录">
  <a href="#p2p-model">一、先建立心智模型</a>
  <a href="#p2p-startup">二、启动、注册与发现</a>
  <a href="#p2p-read">三、一次完整读取</a>
  <a href="#p2p-write">四、写入到底怎么走</a>
  <a href="#p2p-failure">五、超时、miss 与清理</a>
  <a href="#p2p-auth">六、认证边界怎么画</a>
  <a href="#p2p-fix">七、落地认证的改造顺序</a>
  <a href="#p2p-source-map">八、源码地图与检查清单</a>
</nav>

<h2 id="p2p-model">一、先建立心智模型</h2>

### 1.1 把两个节点想成两个仓库

假设 Node B 的 DRAM L1 里已经有请求需要的 KV，而 Node A 没有。Node A 想复用它，大致要完成四件事：

1. 找到 Node B 的两个地址：一个用于发控制请求，一个用于搬数据；
2. 问 B：“这些 ObjectKey 在不在？如果在，请先锁住”；
3. 拿到命中对象在 B 的共享内存区域中的 `(offset, size)`；
4. 让 NIXL 把这些字节读进 A 已经准备好的本地 L1 对象，然后通知 B 解锁。

Coordinator 像仓库目录，只记录地址。ZMQ/gRPC 像调度电话，传 key、task ID、offset 和状态。NIXL 像叉车，真正搬货。**叉车不决定搬哪一箱；调度电话也不把货塞进话筒。**

<div class="p2p-glossary">
  <div class="p2p-term" style="--accent: var(--p2p-directory)"><b>Coordinator</b><p>保存活跃 instance 的 IP、RPC 端口和 P2P advertise URL。它帮助发现，不进入 KV payload 热路径。</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-control)"><b>P2PController</b><p>一边对外提供 lookup/query/unlock handler，一边轮询目录，为发现的 peer 创建或移除 adapter。</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-control)"><b>P2PL2Adapter</b><p>从 Node A 看，Node B 像一个只读远程 L2；adapter 持有 RPC client、NIXL client、task 和 address 状态。</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-data)"><b>TransferChannelAddress</b><p>不是指针本身，而是相对已注册 L1 区域的 <code>offset + size</code>。</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-data)"><b>NIXL handle</b><p>握手后准备好的远端内存描述符句柄。后续 read 可复用，不必每个 key 重新建连接。</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-data)"><b>Read lock</b><p>保证 B 返回地址后，到 A 完成读取前，对象不会被 eviction 或复用掉。</p></div>
</div>

### 1.2 三条逻辑通道，不等于三份 KV

<div class="p2p-split">
  <section class="p2p-plane-card p2p-plane-card--directory"><h3>目录 / 编排</h3><p>HTTP register、heartbeat、<code>GET /instances</code>。内容是 instance metadata，频率低，适合重试与最终一致。</p></section>
  <section class="p2p-plane-card"><h3>控制面</h3><p>ZMQ 或 gRPC 承载 <code>p2p_lookup_and_lock</code>、<code>p2p_query_lookup_results</code> 与 <code>p2p_unlock_objects</code>。内容小，但决定“允许读什么”。</p></section>
  <section class="p2p-plane-card p2p-plane-card--data"><h3>数据面</h3><p>NIXL/UCX 根据已准备好的内存 descriptors 发起 READ。内容是大块 KV bytes，因此必须绕开 Coordinator 和普通 RPC 序列化。</p></section>
  <section class="p2p-plane-card"><h3>本地执行</h3><p>StorageManager 查 key、read-lock、把 MemoryObj 转成 offset/size、轮询完成状态。这些是同进程调用，不是网络协议。</p></section>
</div>

<div class="p2p-callout"><p><strong>最重要的判断方法：</strong>如果消息里只有 key、task ID、状态、offset、size，它属于控制面；只有真正包含 K/V tensor 字节的那一段，才属于数据面。</p></div>

<h2 id="p2p-startup">二、启动、注册与发现：连接不是一次建完的</h2>

### 2.1 每个节点先把自己的 L1 变成“可被远程读取的区域”

P2P 只有在配置了 `--p2p-advertise-url` 时才启用。`P2PController` 启动时找到唯一的 local DRAM L1，取得 `L1MemoryDesc(ptr, size, align_bytes)`，再初始化 transfer-channel context。[初始化代码][controller-start]

以当前 NIXL 实现为例，它会：

1. 创建一个 NIXL agent；
2. 把整块 local DRAM L1 注册为可传输内存；
3. 按 `align_bytes` 把区域准备成 page-granular transfer descriptors；
4. 启动一个单独的 ZMQ REP handshake server，监听 P2P transfer URL。[NIXL context][nixl-context]

这里的“ZMQ REP”不要和 LMCache request transport 混淆。即使主 RPC 选择 gRPC，NIXL handshake 当前仍有自己的 ZMQ socket；它只交换 NIXL metadata，不承载 lookup 业务 RPC。

### 2.2 注册到 Coordinator 的是地址，不是连接

MP server 通过 HTTP 向 Coordinator 注册：`instance_id`、可达 IP、HTTP port、`p2p_advertised_url`、MQ/RPC port，以及 chunk size。[注册 schema 使用点][registrar]

注册只告诉目录“以后到哪里找我”。它没有让 A 和 B 立即互连，更没有上传 KV。节点还会周期性 heartbeat；Coordinator 忘记实例后，server 会重新注册。

### 2.3 发现 peer 后，才创建 adapter 和两类 client

`P2PController` 周期性请求 `/instances`。只有当目录中也能看到自己时，它才进入 `REGISTERED`，并为其他合法 peer 创建 `P2PL2AdapterConfig`：

- `peer_mq_server_url`：控制 RPC 地址，scheme 由本机选择的 request transport 决定；
- `peer_transfer_channel_server_url`：NIXL handshake/data 地址；
- lookup 和 load timeout。

`P2PL2Adapter` 构造时又做两件事：

1. `RequestClientFactory.create(...)` 创建 ZMQ 或 gRPC 控制 client；
2. `get_transfer_channel_client(...)` 主动连接 peer，进行 NIXL handshake，并缓存 remote handle。[adapter 构造与 region registration][adapter-register]

NIXL handshake 分两阶段：先交换 agent metadata，再交换 transfer descriptor lists。双方可能同时主动连接，所以 context 按 peer advertise URL 保留一个 canonical client，关闭重复 client。

<figure class="p2p-stage" data-p2p-stage data-lang="zh">
  <figcaption>交互动画加载中。若脚本未运行：顺序为注册 → 发现 → NIXL 握手 → lookup/lock → 地址返回 → NIXL READ → unlock。</figcaption>
</figure>

<h2 id="p2p-read">三、一次完整读取：从 ObjectKey 到 KV bytes</h2>

### 3.1 `lookup_and_lock`：先问“有没有”，同时占住对象

Node A 的 storage manager 把 Node B 当作一个 remote L2，调用 adapter 的 `submit_lookup_and_lock_task(keys, group_layout_descs)`。Adapter 通过 request client 发：

```text
p2p_lookup_and_lock(
  keys = [ObjectKey(...), ...],
  group_layout_descs = {object_group_id: MemoryLayoutDesc(...)}
)
```

Node B 的 handler 不会继续去查自己的 L2，也不会为了 A 从磁盘预取；当前实现只允许 local DRAM L1。命中对象进入 prefetch/read-lock 状态，B 返回一个整数 `task_id`。[lookup handler][lookup-handler]

为什么不是直接返回地址？因为 storage manager 的统一 prefetch 接口允许异步完成。即使今天 local L1 通常很快，task + query 的协议也给未来扩展保留了空间。

### 3.2 `query_lookup_results`：返回地址，不返回数据

A 用 remote task ID 轮询：

```text
p2p_query_lookup_results(task_id) ->
  [TransferChannelAddress(offset, size), ...] | None
```

`None` 表示还没完成或结果已被消费。miss 使用 `offset=-1, size=0`。对于 hit，B 通过 `unsafe_read` 拿到被锁定对象的共享内存位置，再生成相对于整块 registered L1 的 offset/size。[地址构造][build-addresses]

名称里的 `unsafe_read` 容易吓人。它不是“从网络不安全读取”，而是 storage manager 内部在已有 lock/invariant 的前提下取得对象；真正跨节点暴露的是后面的 transfer address。

### 3.3 `submit_read`：这一刻才搬 KV payload

A 已经为需要加载的 keys 分配好本地 `MemoryObj`。它把本地对象的 `(shm_offset, shm_byte_length)` 转成本地 transfer addresses，再把 B 返回的地址作为 remote addresses：

```text
NIXL submit_read(
  local_addresses  = A 的目标 L1 区域,
  remote_addresses = B 的命中 L1 区域,
)
```

NIXL 把 addresses 翻译为 page indices，准备 READ transfer 并提交。A 之后轮询 `query_read_status`；`DONE` 才把对应 key 标记为 load success。[load 实现][adapter-load]

<figure class="p2p-memory-lab">
  <figcaption><strong>图：真正的数据面。</strong> B 的四页命中区被锁定；NIXL 把 KV bytes 写进 A 的本地目标页。Coordinator 和业务 RPC 都不在 payload 路径上。</figcaption>
  <div class="p2p-memory-lab__grid">
    <div class="p2p-memory"><strong>Node A · destination L1</strong><div class="p2p-memory__pages"><i class="p2p-page"></i><i class="p2p-page is-read"></i><i class="p2p-page is-read"></i><i class="p2p-page"></i></div></div>
    <div class="p2p-memory-lab__arrow" aria-hidden="true">←</div>
    <div class="p2p-memory"><strong>Node B · registered L1</strong><div class="p2p-memory__pages"><i class="p2p-page has-kv"></i><i class="p2p-page has-kv is-read"></i><i class="p2p-page has-kv is-read"></i><i class="p2p-page"></i></div></div>
  </div>
</figure>

### 3.4 `unlock`：读完之后归还“占用权”

完成或放弃后，A 发送 `p2p_unlock_objects(keys)`。B 调 `finish_read_prefetched(keys)` 释放读锁；A 同时清除这些 key 对应的 remote address，防止下一次误用旧地址。

这一步不能省。offset 只是某个时刻某个对象的位置；解锁后，那段空间可能被 eviction、复用，继续拿旧地址读会破坏对象身份与内存生命周期。

<h2 id="p2p-write">四、写入到底怎么走：P2P adapter 当前是只读的</h2>

这是最容易被名字误导的地方：LMCache P2P 并不是两个节点可以互相任意读写内存。

`P2PL2Adapter.submit_store_task` 当前不向 peer 发送数据。它立即记录一个 `L2StoreResult(success=True, bytes_stored=0)`，让统一 store controller 完成 bookkeeping。[只读 store path][adapter-store]

所以需要分清两条路径：

```text
正常本地 STORE / inference
  engine worker → 本机 LMCache server → 本机 L1

P2P remote reuse
  Node A lookup Node B → NIXL READ → Node A 本机 L1
```

P2P 的作用是把别人的现有缓存读到本地，不是把本地新 KV 主动复制到所有 peer。B 的 L1 之所以有内容，是 B 自己正常处理请求或 store 产生的。

<div class="p2p-callout p2p-callout--data"><p><strong>读写方向的准确说法：</strong>从 A 的视角是 remote read；从 B 的内存视角，数据流出 B、写入 A。NIXL operation 名称使用 READ，因为发起方 A 从 remote region 读取。</p></div>

<h2 id="p2p-failure">五、超时、miss 与清理：失败不是都一样</h2>

<div class="p2p-sequence">
  <div><section><strong>目录暂时不可达</strong><p>轮询 timeout 时状态进入 DISCONNECTED；其他 HTTP/格式错误进入 UNREGISTERED，并开始 reconcile。它不直接杀死 MP server。</p></section></div>
  <div><section><strong>peer 连续消失</strong><p>不是一次 miss 就立刻删 adapter。当前实现允许三次连续漏报，超过后才 drain 并移除，避免目录抖动频繁重建连接。</p></section></div>
  <div><section><strong>lookup RPC 超时</strong><p>Adapter 把它当作 cache miss，允许上层继续走其他存储层或 recompute，而不是无限阻塞请求。</p></section></div>
  <div><section><strong>load 超时或 NIXL error</strong><p>对应 key 的 succeeded bitmap 为 false。注意：控制面命中不等于数据面一定成功。</p></section></div>
  <div><section><strong>请求方忘记 query/unlock</strong><p>B 会回收过期 lookup job；read lock 主要依赖 L1 read TTL 最终释放，因为超时后盲目 unlock 可能误伤后来者的锁。</p></section></div>
</div>

<h2 id="p2p-auth">六、如果增加认证，边界应该画在哪里</h2>

先区分两个词：

- **Authentication（认证）**：你是谁，或者你是否持有可信 credential；
- **Authorization（授权）**：即使你已认证，你能读哪些对象、哪些地址。

当前 P2P 的直接目标是阻止未认证网络 peer 获得控制 RPC 与 transfer region access。但“一个已认证 peer 是否可以读整个 region 的任意 offset”是更强的 least-privilege 授权问题，不能只靠 API key 解决。

<section class="p2p-auth-map" data-p2p-auth-map>
  <div class="p2p-auth-map__toolbar" aria-label="筛选认证边界">
    <button type="button" data-auth-filter="all" aria-pressed="true">全部边界</button>
    <button type="button" data-auth-filter="required" aria-pressed="false">必须认证</button>
    <button type="button" data-auth-filter="session" aria-pressed="false">建链时认证</button>
    <button type="button" data-auth-filter="local" aria-pressed="false">进程内无需身份认证</button>
  </div>
  <div class="p2p-auth-grid">
    <article class="p2p-auth-boundary" data-auth="required"><strong>① P2P 启动配置</strong><p>P2P enabled 但没有 credential 时应 fail closed。否则“可选认证”仍会让默认部署保持匿名。</p></article>
    <article class="p2p-auth-boundary" data-auth="required"><strong>② Coordinator 注册与发现</strong><p>认证写入目录和读取 peer list，避免伪造实例、目录投毒与地址元数据泄露。</p></article>
    <article class="p2p-auth-boundary" data-auth="required"><strong>③ ZMQ / gRPC 控制 RPC</strong><p>在 payload decode 和 handler dispatch 之前认证 lookup、query、unlock。错误 key 不应触碰业务状态。</p></article>
    <article class="p2p-auth-boundary" data-auth="required"><strong>④ NIXL handshake</strong><p>在返回 agent metadata、transfer descriptors 或 register_client 之前认证。descriptor 本身就是进入 remote region 的能力入口。</p></article>
    <article class="p2p-auth-boundary" data-auth="session"><strong>⑤ NIXL READ</strong><p>当前模型中不必给每一页 DMA 再带 Bearer token；它使用握手建立的 authenticated session/handle。撤销 credential 时要重建连接。</p></article>
    <article class="p2p-auth-boundary" data-auth="local"><strong>⑥ 本地 lookup 与地址转换</strong><p>同一受信进程内不需要“用户身份认证”，但仍需要 object lock、bounds/alignment validation 和生命周期约束。</p></article>
  </div>
</section>

### 6.1 为什么控制 RPC 和 NIXL handshake 两边都要认证

只保护控制 RPC 不够。知道 transfer endpoint 的网络 peer 仍可能直接尝试 handshake；如果服务端在认证前返回完整 region descriptors，控制面挡住了 key 查询，数据面入口仍然暴露。

只保护 NIXL handshake 也不够。匿名调用者仍可创建 lookup job、占 read lock、枚举 hit/miss、消费 result 或发送 unlock，造成状态干扰和元数据泄露。

所以正确边界是：

```text
网络入口 A：request transport
  authenticate → decode RPC payload → dispatch handler

网络入口 B：transfer-channel handshake
  decode bounded auth envelope → authenticate
  → add remote agent / deserialize descriptors / return local descriptors
```

### 6.2 为什么不是每个本地函数都加 token 参数

`StorageManager.query_prefetch_status`、`unsafe_read`、`addresses_to_indices` 和 `query_read_status` 都在已建立的进程/对象边界内。把 token 一路塞进这些函数不会增加网络身份保证，只会扩散 secret、增加日志泄露和接口复杂度。

正确做法是在网络入口建立 principal/session，把后续对象访问绑定到这个已经认证的上下文；进程内部继续依靠类型、lock、bounds 和 ownership invariant。

### 6.3 API key 认证不等于加密

Bearer token 可以证明调用者知道共享 secret，但普通 ZMQ/gRPC/NIXL 通道并不会因此自动加密。跨不可信网络时仍需要 TLS、mTLS、CURVE、IPsec 或受控加密隧道。

更强的 handshake 可以使用 nonce + HMAC，避免直接在明文中反复发送原始 key，并把双方 agent identity、endpoint 和协议版本绑定进 transcript。但 KV payload 是否加密仍是另一件事。

<div class="p2p-callout p2p-callout--warning"><p><strong>授权边界仍需诚实描述：</strong>当前 NIXL context 注册的是整块 L1 region。认证能阻止陌生 peer；如果已认证节点之间也互不信任，则还需要 object-scoped/capability-scoped descriptor，而不是把“知道共享 key”当作任意地址读取授权。</p></div>

<h2 id="p2p-fix">七、落地认证时，建议按什么顺序改</h2>

### 7.1 先定义一个清晰的安全不变量

建议把目标写成一句可测试的话：

> 当 P2P 启用时，只有持有当前有效 credential 的 peer 才能调用 P2P RPC、取得 transfer descriptors 并建立 remote-memory handle；未认证输入在业务 payload decode、handler dispatch 和 NIXL metadata 操作之前失败。

然后按下面顺序实现：

1. **配置 fail closed**：P2P enabled 且没有认证材料时拒绝启动，或者仅在显式 `allow-unauthenticated-p2p` 逃生开关下启动并打印高危告警。
2. **复用统一 key loader/verifier**：server 接受多个 key 支持轮换；client 只选择一个 outbound key；所有 `repr`、status、环境输出都隐藏 secret。
3. **保护 request transport**：ZMQ 使用版本化 auth frame，gRPC 使用 metadata interceptor；认证应早于业务 payload decode。
4. **保护 NIXL handshake**：`InitReq` 就必须认证，不应先把 agent metadata 发给匿名方；`MemRegReq` 再绑定同一 session/identity。
5. **保护 Coordinator HTTP**：注册、heartbeat 和 `/instances` 使用认证 header；明确 Coordinator credential 是否和 P2P peer credential 共用。
6. **处理轮换与撤销**：静态 key 更新后重启或主动清理现有 transfer clients，因为已准备好的 handle 不会因为 key 文件变化自动失效。
7. **最后补文档与可观测性**：区分 auth failure、lookup miss、RPC timeout、transfer error，不能都记录成普通 cache miss。

### 7.2 最低回归矩阵

| 场景 | 控制面预期 | 数据面预期 |
|---|---|---|
| 正确 key | lookup/query/unlock 正常 | handshake 与 NIXL READ 正常 |
| 缺少 key | 在 decode/dispatch 前拒绝 | 不返回 agent metadata/descriptors |
| 错误 key | 明确 UNAUTHENTICATED/PermissionError | 不创建 remote handle |
| malformed auth | 有界、快速失败，不泄露 secret | 不进入 NIXL metadata 解析 |
| key rotation | old/new 均可入站，client 只发一个 | 新建连接可用，旧 session 生命周期明确 |
| P2P 无 key 配置 | 启动失败或显式高危 opt-in | 不应静默开放 |
| 已认证 hit | task/address 正确 | populated L1 bytes 正确复制 |
| 已认证 miss | invalid address | 不提交 read |

<h2 id="p2p-source-map">八、源码地图：从哪里开始读</h2>

建议不要从 NIXL 的最底层开始。按业务链路读更容易：

1. [`P2PController`][controller]：启动 transfer context、轮询 `/instances`、维护 adapter、实现三个 P2P RPC handler；
2. [`P2PL2Adapter`][adapter]：请求方如何 lookup、缓存 remote address、提交 NIXL read、unlock；
3. [`nixl_impl.py`][nixl]：agent、整块 L1 注册、两阶段 handshake、address→page indices、transfer handle；
4. [`registrar.py`][registrar]：server 如何向 Coordinator 注册与 heartbeat；
5. [`transfer_channel/api.py`][tc-api]：`TransferChannelAddress` 和 read result 的最小数据模型。

读完以后，可以用下面五个问题检查自己是否真的理清了：

- Coordinator 挂掉时，已经开始的一次 NIXL read 是否必须经过它？**不需要。**
- `query_lookup_results` 返回的是 KV 吗？**不是，只返回 offset/size。**
- gRPC 替换 ZMQ 后，KV bytes 会改走 gRPC 吗？**不会。**
- P2P adapter 会把 A 的 KV 写入 B 吗？**当前不会，它是只读 adapter。**
- 只给 lookup RPC 加 API key 是否足够？**不够，NIXL handshake 也必须在泄露 descriptors 前认证。**

最后把整条路径压缩成一句话：

> Coordinator 让 A 找到 B；控制 RPC 让 A 知道 B 的哪些对象可以读以及它们在哪里；NIXL 使用建链时取得的 remote-memory capability 把这些字节复制到 A；unlock 结束这次临时授权。

[snapshot]: https://github.com/LMCache/LMCache/tree/cf87a1ca70fcea192dc3820c745aae0b9253061b
[controller]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/multiprocess/modules/p2p_controller.py
[controller-start]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/multiprocess/modules/p2p_controller.py#L180-L273
[lookup-handler]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/multiprocess/modules/p2p_controller.py#L310-L425
[build-addresses]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/multiprocess/modules/p2p_controller.py#L462-L514
[adapter]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/l2_adapters/p2p_l2_adapter.py
[adapter-register]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/l2_adapters/p2p_l2_adapter.py#L181-L201
[adapter-load]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/l2_adapters/p2p_l2_adapter.py#L430-L494
[adapter-store]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/l2_adapters/p2p_l2_adapter.py#L237-L267
[nixl]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/transfer_channel/impl/nixl_impl.py
[nixl-context]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/transfer_channel/impl/nixl_impl.py#L294-L359
[registrar]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/mp_coordinator/registrar.py
[tc-api]: https://github.com/LMCache/LMCache/blob/cf87a1ca70fcea192dc3820c745aae0b9253061b/lmcache/v1/distributed/transfer_channel/api.py
