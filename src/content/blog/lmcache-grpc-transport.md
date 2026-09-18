---
title: "LMCache gRPC 支持详解：从启用方式到协议演进"
description: "介绍 LMCache multiprocess request transport 如何从 ZMQ 演进到 gRPC：server 与 vLLM 的具体配置、实现原理、codec 设计、收益，以及新增 service/message/rpc/field 时如何保持兼容。"
publishedAt: 2026-09-17
updatedAt: 2026-09-18
category: AI Infra
tags:
  - lmcache
  - grpc
  - vllm
  - kv-cache
  - multiprocess
  - protobuf
  - distributed-systems
author: 毛宝龙
readingTime: 28 min
featured: true
draft: false
---

这篇文章先不从“gRPC 是什么”讲起，先给能直接复制的启用方式。

LMCache MP 模式里有两类“传输”容易混在一起：

- **request transport**：vLLM/SGLang/SDK 向 LMCache MP server 发 `LOOKUP`、`STORE`、`RETRIEVE`、`PING` 这些控制请求。本文讨论的 gRPC 就在这一层。
- **KV data transfer**：真正的 KV bytes 怎么在 engine worker 和 LMCache server 之间移动，例如 CUDA IPC、POSIX SHM、engine-driven pickle/SHM 等。这层由 `--supported-transfer-mode` 和 worker 侧 `lmcache.mp.mp_transfer_mode` 决定，不会因为 request transport 换成 gRPC 就自动变成“gRPC 搬 KV tensor”。

一句话：**gRPC 负责把请求说清楚；KV 数据仍然走 LMCache 原来的高性能搬运路径。**

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/quick-enable.svg" aria-label="打开 gRPC 启用配置图原图">
    <img src="/images/blog/lmcache-grpc-transport/quick-enable.svg" alt="LMCache gRPC 启用配置" />
  </a>
  <figcaption>图 1：请求从 vLLM 侧发到 LMCache server；启用 gRPC 要同时改两端配置。窄屏可横向滑动，也可以点开原图。</figcaption>
</figure>

## 零、实现路线：一串 PR 怎么铺路

这次 gRPC 支持不是一个“大 PR 直接把 ZMQ 换掉”的做法，而是一串边界逐渐清晰的 PR。这样的节奏很重要：先让上层代码不再依赖 ZMQ 细节，再把 client 创建入口收拢到工厂，然后把老 ZMQ 逻辑隔离出去，最后再接入 protobuf、gRPC client/server、测试矩阵和打包流程。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/zmq-to-grpc-roadmap.svg" aria-label="打开 ZMQ 到 gRPC PR 路线图原图">
    <img src="/images/blog/lmcache-grpc-transport/zmq-to-grpc-roadmap.svg" alt="LMCache 从 ZMQ 到 gRPC 的 PR 演进路线" />
  </a>
  <figcaption>图 2：gRPC 支持按 PR 分层落地；后续会继续向 gRPC-first 收敛。</figcaption>
</figure>

从公开 PR 看，这条路线大致是：

| 阶段 | PR | 做了什么 | 为什么要先做 |
|---|---|---|---|
| ZMQ 语义抽象 | [#4878](https://github.com/LMCache/LMCache/pull/4878) | 引入 `RequestClient` / `ZmqMultiprocessClient` facade，把 `lookup()`、`store()`、`retrieve()` 这些语义方法放到统一 client 接口上 | 上层调用方先脱离 `submit_request(RequestType, payload_list)`，后面才能换 transport |
| client 工厂 | [#4882](https://github.com/LMCache/LMCache/pull/4882) | 通过 `RequestClientFactory.create(server_url)` 按 URL scheme 选择 transport | `tcp://`、裸 host 继续走 ZMQ，`grpc://` 可以交给新的 gRPC client |
| ZMQ 边界隔离 | [#5050](https://github.com/LMCache/LMCache/pull/5050) | 把 ZMQ request handling 移到更明确的 `zmq_impl` 边界后面 | 老实现继续可用，但不再散落在共享协议层里 |
| protobuf 地基 | [#5066](https://github.com/LMCache/LMCache/pull/5066) | 增加 `*_service.proto`、生成入口、基础测试和 transport test plumbing | 先让 schema、生成代码、测试入口稳定，再谈 runtime 切换 |
| wheel 生成稳定性 | [#5081](https://github.com/LMCache/LMCache/pull/5081) | 稳定 wheel 构建里的 gRPC proto generation | 防止 protobuf/gRPC tooling 变成打包和安装路径上的隐性风险 |
| runtime gRPC | [#4953](https://github.com/LMCache/LMCache/pull/4953) | 接入 gRPC request transport，让 `--transport grpc` 和 `grpc://` 真正跑起来，并在测试里覆盖 gRPC/ZMQ | 这一步才是用户能启用的 gRPC client/server runtime |

这条路线后面还有很多值得做的事：

- **逐步删除 ZMQ。** 新能力、文档、CI 和生产推荐先转向 gRPC；等兼容窗口结束后，ZMQ facade、ZMQ server path、`RequestType` 数字 wire id 这些历史负担就可以逐步下线。
- **简化协议中间层。** 当前 `RequestType` 和 `ProtocolDefinition` 是双栈时期的桥。gRPC-only 后，可以让 `package.Service/Method` 成为 operation identity，让 proto descriptor 或生成 adapter 直接提供 Python contract。
- **优化 gRPC 性能。** 后续可以围绕 deadline 传播、backpressure、连接复用、worker pool 配置、批量小控制请求、codec 开销做更细的 benchmark 和优化。
- **增加 gRPC 指标。** per-RPC latency、status code、payload encode/decode cost、server queue wait、affinity worker 分布、client reconnect/error rate 都可以变成可观测指标。
- **扩展生态能力。** gRPC health check、reflection、外部 sidecar、跨语言 SDK、debug gateway、版本协商都会比自定义 ZMQ payload 更自然。

## 一、最小启用方式

### 1. Server 端：启动 gRPC request server

以前默认启动的是 ZMQ request server：

```bash
lmcache server \
  --transport zmq \
  --host 0.0.0.0 \
  --port 5555 \
  --l1-size-gb 20 \
  --eviction-policy LRU
```

切到 gRPC 时，关键只是一项：

```bash
lmcache server \
  --transport grpc \
  --host 0.0.0.0 \
  --port 5555 \
  --l1-size-gb 20 \
  --eviction-policy LRU
```

如果要调 gRPC 接入层线程数，可以加：

```bash
lmcache server \
  --transport grpc \
  --host 0.0.0.0 \
  --port 5555 \
  --grpc-server-workers 32 \
  --max-gpu-workers 8 \
  --max-cpu-workers 4 \
  --l1-size-gb 20 \
  --eviction-policy LRU
```

这里三个 worker 选项不是同一层东西：

| 参数 | 作用 |
|---|---|
| `--grpc-server-workers` | gRPC Python server 接收和分发 unary RPC 的线程池大小 |
| `--max-gpu-workers` | `STORE` / `RETRIEVE` 这类需要 client affinity 的 GPU 相关 handler 池 |
| `--max-cpu-workers` | `LOOKUP`、`PING`、管理类阻塞操作的普通 handler 池 |

### 2. vLLM 端：把 `lmcache.mp.host` 写成 `grpc://...`

vLLM 侧不用换 connector 名字，仍然使用 `LMCacheMPConnector`。关键是 `kv_connector_extra_config` 里的 `lmcache.mp.host`。

ZMQ 写法通常是：

```bash
vllm serve Qwen/Qwen3-8B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector",
    "kv_role":"kv_both",
    "kv_connector_extra_config":{
      "lmcache.mp.host":"tcp://localhost",
      "lmcache.mp.port":5555
    }}'
```

gRPC 写法是：

```bash
vllm serve Qwen/Qwen3-8B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector",
    "kv_role":"kv_both",
    "kv_connector_extra_config":{
      "lmcache.mp.host":"grpc://localhost",
      "lmcache.mp.port":5555,
      "lmcache.mp.mq_timeout":10
    }}'
```

注意这里端口不要写进 `host` 后又再拼一次。LMCacheMPConnector 的单 server 配置会把：

```json
{
  "lmcache.mp.host": "grpc://localhost",
  "lmcache.mp.port": 5555
}
```

拼成：

```text
grpc://localhost:5555
```

如果你有多个 LMCache server，用 `lmcache.mp.server_urls`，每个 URL 都要带 scheme：

```bash
vllm serve Qwen/Qwen3-8B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector",
    "kv_role":"kv_both",
    "kv_connector_extra_config":{
      "lmcache.mp.server_urls":"grpc://lmcache-a:5555,grpc://lmcache-b:5555",
      "lmcache.mp.mq_timeout":10
    }}'
```

迁移时最容易踩的坑是两端不匹配：

| LMCache server | vLLM `lmcache.mp.host` | 结果 |
|---|---|---|
| `--transport grpc` | `grpc://host` | 正确 |
| `--transport zmq` | `tcp://host` 或裸 `host` | 正确 |
| `--transport grpc` | `tcp://host` | vLLM 走 ZMQ client，连不上 gRPC server |
| `--transport zmq` | `grpc://host` | vLLM 走 gRPC client，连不上 ZMQ server |

基于我写这篇时拉取的 LMCache `dev` 快照 [`caba24c2`](https://github.com/LMCache/LMCache/tree/caba24c2bbd0319142664213e5bab6d10bd0a47a)，gRPC 已经不是“只放 proto 还不能跑”的占位实现。`MPServerConfig.transport` 接受 `zmq` / `grpc`，server factory 会在 `--transport grpc` 时创建 gRPC request server，client factory 会在看到 `grpc://` / `grpc+unix://` 时创建 gRPC client。

## 二、为什么要从 ZMQ 往 gRPC 迁

LMCache MP mode 最早的 request path 很直接：client 把一个 `RequestType` 和一个 positional payload list 送进 ZMQ，server 按 `RequestType` 查 handler，再按固定顺序解 payload。

这种方式能跑，而且很轻。但随着 MP server 承载的能力越来越多，它的维护成本开始显现：

1. **参数顺序就是协议。** 新增一个 payload、调整一个字段，都可能让旧 client/server 混跑时出现难以发现的错位。
2. **协议不可读。** 你看到 `STORE` 和一串 list，很难直接知道 wire 上到底有哪些字段、字段类型是什么。
3. **跨语言和工具生态弱。** protobuf/gRPC 的 schema、stub、反射、网关、负载均衡、可观测生态都很成熟，ZMQ 这层要靠项目自己维护约定。
4. **调用方耦合太深。** 如果上层代码直接构造 `MessageQueueClient`，引入第二种 request transport 就会变成全代码库改造。

所以 gRPC 支持不是简单把 `send_multipart` 换成 `stub.Foo.future()`。真正的改造分成四步：

1. 先把上层调用面改成 transport-neutral 的 `RequestClient`；
2. 再把每个 RPC 的 Python payload/response 类型沉淀成 `ProtocolDefinition`；
3. 然后为 gRPC 定义 protobuf schema 和生成代码；
4. 最后把 gRPC client/server 接到同一个 handler 和 codec registry 上。

我理解后续会逐渐放弃 ZMQ，准确说不是“今天删掉 ZMQ”，而是**新增能力、文档推荐、CI 覆盖、生产部署默认值会逐步向 gRPC-first 收敛**。ZMQ 仍然会在一段时间内承担兼容路径，但它不再适合作为不断扩展的主协议面。

这点也影响后面的协议演进方式：当前双栈阶段，`RequestType` 和 `ProtocolDefinition` 仍然是 gRPC registry 连接 proto method、Python payload/response 类型和业务 handler 的桥；但它们不是 gRPC 最终形态必须永远保留的中间层。等 ZMQ 彻底退场后，LMCache 可以把 operation identity 收敛到 protobuf service/method，把 Python 类型契约从 proto descriptor 或生成代码中推导出来，减少今天为了兼容历史 wire path 而维护的重复表。

## 三、request transport 边界长什么样

现在应用层不应该直接关心 ZMQ 或 gRPC。它只做两件事：

1. 调 `RequestClientFactory.create(server_url)`；
2. 拿到一个有命名方法的 `RequestClient`，例如 `lookup()`、`store()`、`retrieve()`、`ping()`。

`server_url` 的 scheme 决定 client 实现：

| endpoint | client transport |
|---|---|
| `localhost:5555` | 自动补成 `tcp://localhost:5555`，走 ZMQ |
| `tcp://host:5555` | ZMQ |
| `ipc://path` / `inproc://name` | ZMQ client factory 识别 |
| `grpc://host:5555` | gRPC |
| `grpc+unix:///path/to/socket` | gRPC Unix domain socket target |

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/transport-boundary.svg" aria-label="打开 request transport 边界图原图">
    <img src="/images/blog/lmcache-grpc-transport/transport-boundary.svg" alt="LMCache request transport 抽象边界" />
  </a>
  <figcaption>图 3：应用层只看 `RequestClient`，wire 细节在 ZMQ/gRPC implementation 里。</figcaption>
</figure>

这个边界的意义很大。比如 vLLM MP connector 只需要解析 `lmcache.mp.host` / `lmcache.mp.port`，然后创建 request client。它并不需要知道 `STORE` 在 ZMQ 下是几号 enum，也不需要知道 gRPC 下 `StoreRequest` 有哪些字段。

ZMQ facade 的职责是兼容老 wire：

```text
client.store(key, instance_id, block_ids, event)
  -> RequestType.STORE
  -> [key, instance_id, block_ids, event]
  -> MessageQueueClient
```

gRPC client 的职责是走 descriptor 和 codec：

```text
client.store(key, instance_id, block_ids, event)
  -> StoreRequest protobuf
  -> LMCacheDrivenService.Store.future(...)
  -> StoreResponse protobuf
  -> Python result
```

上层代码保持同一套调用方式，才有可能让迁移变得温和。

## 四、proto service 为什么这样拆

LMCache MP server 现在的 RPC 面已经不小。如果把所有方法都塞进一个巨大的 `EngineService`，短期方便，长期会让协议边界变得很混乱。

当前 proto 按业务域拆开：

| service | 负责的 RPC |
|---|---|
| `LMCacheDrivenService` | `RegisterKvCache`、`Store`、`Retrieve` 等 server-driven KV transfer 请求 |
| `EngineDrivenService` | `Register...Context`、`PrepareStore`、`CommitStore`、`PrepareRetrieve`、`CommitRetrieve` |
| `LookupService` | `Lookup`、prefetch status、lookup locks、session end |
| `ControllerService` | `Clear`、`GetChunkSize`、`Ping` |
| `ObservabilityService` | `ReportBlockAllocation` |
| `BlendService` | CacheBlend handshake、rope 注册、pre-computed retrieve、unified lookup |
| `P2PService` | peer lookup-and-lock、query results、unlock |
| `DebugService` | `Noop` |
| `QStoreService` | 实验性 Q cache store |

这些 service 共享 `common.proto` 里的公共消息，例如 `IpcCacheServerKey`、`EventIpcHandleResult`、`BlockIdGroup`、`DeviceIpcWrapper`、`EngineGroupInfo`。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/proto-service-map.svg" aria-label="打开 gRPC service map 原图">
    <img src="/images/blog/lmcache-grpc-transport/proto-service-map.svg" alt="LMCache gRPC service map" />
  </a>
  <figcaption>图 4：service 按协议域拆分，公共结构放在 `common.proto`。</figcaption>
</figure>

这里有个很关键的约定：**proto RPC 名称要能映射回 `RequestType`。**

`GrpcMethodCodecRegistry` 会遍历生成出来的 service/method descriptor，把 method 名字转成 snake case，再转成大写 request type：

```text
Lookup                  -> lookup                  -> LOOKUP
Store                   -> store                   -> STORE
P2PLookupAndLock        -> p2p_lookup_and_lock     -> P2P_LOOKUP_AND_LOCK
CbRetrievePreComputed   -> cb_retrieve_pre_computed -> CB_RETRIEVE_PRE_COMPUTED
```

如果生成出来的 gRPC method 找不到对应 `RequestType`，启动时就失败。这比运行几小时后某个请求才发现“没有 handler”要好得多。

## 五、codec 为什么必须存在

很多人第一次看到 `proto_codec.py` 和 `grpc_impl/codecs/` 会问：既然已经有 protobuf，为什么还要一层 codec？

原因是 protobuf 只定义 wire message，它不知道 LMCache handler 想要的 Python 对象是什么。

以 `Store` 为例，proto 长这样：

```proto
message StoreRequest {
  IpcCacheServerKey key = 1;
  int64 instance_id = 2;
  repeated BlockIdGroup gpu_block_ids = 3;
  bytes event_ipc_handle = 4;
}

message StoreResponse {
  EventIpcHandleResult result = 1;
}
```

但业务 handler 需要的是 Python 语义：

```python
@request_handler(RequestType.STORE, HandlerType.BLOCKING, requires_client_affinity=True)
def store(
    self,
    key: IPCCacheServerKey,
    instance_id: int,
    block_ids: list[list[int]],
    event_ipc_handle: bytes,
) -> tuple[bytes, bool]:
    ...
```

中间差了几件事：

- `IpcCacheServerKey` 要变成 Python 的 `IPCCacheServerKey` dataclass；
- `repeated BlockIdGroup` 要变成 `list[list[int]]`；
- `EventIpcHandleResult` 要变成 `tuple[bytes, bool]`；
- `optional` 字段要能变成 `None`；
- `torch.dtype`、`torch.Size`、`DeviceIPCWrapper` 这类对象不可能靠 protobuf 默认规则直接表达；
- handler 的参数和返回注解必须和协议定义一致，否则 transport 换了以后行为会分叉。

所以 codec 的职责不是“重复 protobuf”，而是把两张契约接起来：

1. **protobuf descriptor**：wire 上有哪些字段、tag、类型、presence；
2. **Python protocol definition**：这个 RPC 在 LMCache 语义上需要哪些 payload types，返回什么 Python 类型。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/codec-registry.svg" aria-label="打开 codec registry 图原图">
    <img src="/images/blog/lmcache-grpc-transport/codec-registry.svg" alt="LMCache gRPC codec registry" />
  </a>
  <figcaption>图 5：method codec registry 把 protobuf schema 和 Python 类型契约编译成编码/解码函数。</figcaption>
</figure>

LMCache 这里有两类 codec。

### 1. Structural codec

大多数 dataclass、`msgspec.Struct`、list、tuple、map、optional 都可以结构化转换。只要 Python 字段和 proto 字段能一一对应，就不需要写手工 codec。

比如 `RegisterEngineDrivenContextPayload` 是 `msgspec.Struct`，proto 里的 `RegisterKvCacheEngineDrivenContextRequest` 字段顺序和字段名能对应，结构化 codec 就能处理。

这种方式的好处是：新增普通字段时，不需要到处手写序列化逻辑；坏处是它要求字段设计更规矩，不能指望“名字随便写，反正自己知道怎么读”。

### 2. Explicit message codec

有些 Python 类型不是普通结构，必须显式注册转换。

现在典型例子有两个：

| Python 类型 | proto message | 为什么不能只靠 structural codec |
|---|---|---|
| `DeviceIPCWrapper` | `DeviceIpcWrapper` | 需要保留具体设备 wrapper 子类身份，用 pickle payload 承载 opaque handle |
| `torch.Size` | `TensorShape` | `torch.Size` 是 tuple-like 类型，但语义上应该独立映射到 repeated dims |

所以 `grpc_impl/codecs/common.py` 注册 `DeviceIPCWrapper`，`grpc_impl/codecs/p2p.py` 注册 `torch.Size`。registry 初始化时会检查重复注册、歧义匹配等问题。

这套设计最重要的收益是：**server/client 不会在两边各自手写一套转换逻辑。** 每个 gRPC method 都通过同一个 registry 得到 request encoder/decoder 和 response encoder/decoder。

## 六、一次 gRPC 调用如何跑完

拿 `LOOKUP` 举例。

vLLM scheduler 侧会构造 `IPCCacheServerKey`，然后调用：

```python
future = req_client.lookup(key, tp_size)
```

如果 `req_client` 是 gRPC client，这个方法不是手写出来的固定函数，而是从 generated descriptor 安装到 `GrpcMultiprocessClient` 上的。调用过程是：

1. 根据 `LookupService.Lookup` 找到 `GrpcMethodCodec`；
2. 把 `(key, tp_size)` 编成 `LookupRequest`；
3. 调用 generated stub 的 `Lookup.future(...)`；
4. gRPC 完成后，把 `LookupResponse` decode 回 Python result；
5. 写入 LMCache 自己的 `MessagingFuture`，让上层继续使用同一套 future 抽象。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/call-lifecycle.svg" aria-label="打开 gRPC 调用生命周期图原图">
    <img src="/images/blog/lmcache-grpc-transport/call-lifecycle.svg" alt="LMCache gRPC call lifecycle" />
  </a>
  <figcaption>图 6：客户端和服务端都围绕同一个 method codec registry 编解码。</figcaption>
</figure>

server 侧更有意思。`GrpcMultiprocessServer.add_modules()` 不直接写 `servicer.Lookup = ...`。它会：

1. 扫描所有业务 module 的 `@request_handler`；
2. 按 `RequestType` 建 handler 表；
3. 遍历 generated service descriptors；
4. 为每个 gRPC method 找到对应 method codec；
5. 验证 handler 参数/返回注解是否匹配；
6. 动态挂载 generated servicer。

如果某个 method 的业务 module 没启用，server 会返回 `UNIMPLEMENTED`，而不是让 client 卡在一个莫名其妙的空结果里。

## 七、server 调度：gRPC 不是一个大线程池

ZMQ 实现里已经有同步 handler、普通 worker pool、affinity worker pool。gRPC 实现延续了这套语义，而不是把所有请求无差别地放进 gRPC server executor。

`@request_handler` 上的 metadata 决定请求怎么执行：

| handler 类型 | gRPC 下怎么调度 | 典型请求 |
|---|---|---|
| `HandlerType.SYNC` | 用 `sync_handler_lock` 串行执行 | 很快的控制面操作 |
| `HandlerType.BLOCKING` | 交给 normal pool | `LOOKUP`、`PING`、管理类请求 |
| `HandlerType.BLOCKING + requires_client_affinity` | 交给 affinity pool，并按 client-id 取 affinity key | `STORE`、`RETRIEVE` 等 GPU 相关请求 |

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/server-dispatch.svg" aria-label="打开 gRPC server 调度图原图">
    <img src="/images/blog/lmcache-grpc-transport/server-dispatch.svg" alt="LMCache gRPC server dispatch pools" />
  </a>
  <figcaption>图 7：gRPC server 保留了 LMCache 原来的 handler 类型和 client-affinity 语义。</figcaption>
</figure>

client affinity 对 `STORE` / `RETRIEVE` 很重要。来自同一个 vLLM instance 的请求会带一个 `lmcache-client-id-bin` metadata，server 根据它算 affinity key，让同一 client 的 GPU transfer 相关请求尽量落到同一条 affinity 执行路径上，减少锁竞争和执行顺序的不确定性。

## 八、gRPC 的收益具体在哪里

对使用者来说，最直接的收益是配置和连接语义更明确：

- `grpc://host:port` 一眼能看出走的是 gRPC；
- server 端 `--transport grpc` 一眼能看出监听的是 gRPC request server；
- 如果 scheme 和 server transport 不匹配，问题集中在连接阶段，而不是运行中某个 payload decode 才坏。

对维护者来说，收益更大：

1. **协议从隐式 list 变成显式 schema。** `StoreRequest`、`LookupRequest`、`P2pLookupAndLockRequest` 写在 proto 里，review 时能看见字段名、tag、optional/repeated/map。
2. **跨 transport 共享同一套业务 handler。** ZMQ 和 gRPC 都发现 `@request_handler`，不会出现“ZMQ 支持一个请求，gRPC 忘了绑”的长期分叉。
3. **启动时校验更多问题。** duplicate service、缺失 `RequestType`、handler annotation 不匹配、结构化 codec 不可表达，都会更早失败。
4. **更适合外部集成。** gRPC/protobuf 比自定义 ZMQ payload 更容易被其他语言、网关、sidecar、observability 工具理解。
5. **演进路径更清楚。** 新 service、新 message、新 field 都有 protobuf 社区成熟的兼容规则可遵循。

但也要讲清楚边界：gRPC 不应该被理解成“更快地搬 KV tensor”。LMCache MP 的热路径里，KV 数据本身非常大，真正的数据搬运仍然依赖 CUDA IPC、SHM、NIXL、engine-driven transfer context 等机制。gRPC 的价值是让**请求控制面**更清楚、更可维护、更容易跨环境部署。

## 九、新增 RPC 时怎么做

如果你要新增一个 request，比如 `FOO_BAR`，不要只在 client 里加一个方法。完整流程应该是这样：

### 1. 选择 service

先判断它属于哪个协议域：

- KV 注册、store/retrieve：`lmcache_driven_service.proto`
- engine-driven prepare/commit：`engine_driven_service.proto`
- prefix lookup / prefetch / session：`lookup_service.proto`
- 管理面：`controller_service.proto`
- observability：`observability_service.proto`
- P2P：`p2p_service.proto`
- CacheBlend：`blend_service.proto`

如果是一个新的业务域，再新增 service 文件，而不是塞进不相关 service。

### 2. 定义 request/response message 和 rpc

倾向于给每个 RPC 独立的 request/response message：

```proto
message FooBarRequest {
  string request_id = 1;
  optional int64 deadline_ms = 2;
}

message FooBarResponse {
  bool accepted = 1;
}

service ControllerService {
  rpc FooBar(FooBarRequest) returns (FooBarResponse);
}
```

即使 response 暂时为空，也保留一个明确 response message：

```proto
message FooBarResponse {}
```

这样以后要加字段时还能兼容扩展。

### 3. 追加 `RequestType`

在当前版本里，这一步仍然需要。`RequestType` 不只是 ZMQ 的数字 enum，gRPC 的 method registry 也会用 proto method name 找到对应 `RequestType`，再通过它定位 handler metadata。

在 `protocols/base.py` 里把新 enum member 追加到末尾、deprecated aliases 之前。不要插入中间，因为 `RequestType` 旧值仍然是 ZMQ wire 协议的一部分。

LMCache 已经有 frozen wire id 测试，目的就是防止旧值被 renumber。

但这属于双栈过渡期的要求，不是 gRPC 本身的要求。未来如果 ZMQ 路径被移除，新增 RPC 理论上可以不再先加 `RequestType`，而是让 `package.Service/Method` 直接成为 operation identity。

### 4. 添加 `ProtocolDefinition`

当前也仍然需要在对应 `protocols/*.py` 里声明 payload 和 response Python 类型：

```python
"FOO_BAR": ProtocolDefinition(
    payload_classes=[str, int | None],
    response_class=bool,
    handler_type=HandlerType.SYNC,
)
```

如果 payload 已经复杂到参数很多，更推荐定义一个 dataclass 或 `msgspec.Struct`，让 Python 侧也变成命名字段，而不是继续堆 positional payload。

`ProtocolDefinition` 的价值是把 Python 语义说清楚：handler 应该收哪些 Python 对象、返回什么 Python 对象、这个调用是 sync 还是 blocking、是否需要 client affinity。gRPC codec 编译时也会依赖它来确认 proto message 和 Python 类型能互相转换。

等到项目进入 gRPC-only 形态后，这层可以被简化。比较自然的方向有两种：

1. 从 protobuf descriptor 和生成类型直接推导 Python payload/response contract；
2. 或者让生成出来的 gRPC adapter 直接绑定 handler，handler annotation 使用 service/method 名称，而不是 `RequestType`。

到那时，`RequestType -> ProtocolDefinition -> codec -> handler` 这条链可以缩短成 `proto method -> generated adapter / codec -> handler`。换句话说，今天的中间结构主要是在帮 LMCache 平滑地从 ZMQ 迁到 gRPC，不应该被理解成 gRPC 长期架构里的必要复杂度。

### 5. 添加业务 handler

在 module 上加：

```python
@request_handler(RequestType.FOO_BAR, HandlerType.SYNC)
def foo_bar(self, request_id: str, deadline_ms: int | None) -> bool:
    ...
```

handler 参数和返回注解必须和 `ProtocolDefinition` 匹配。gRPC server 注册时会做校验。

### 6. 必要时添加 explicit message codec

如果你的 Python 类型是普通 dataclass、`msgspec.Struct`、list、tuple、dict、optional，通常 structural codec 就够了。

如果里面有非结构化对象，比如设备 IPC wrapper、tensor shape、dtype 的特殊表达、opaque handle，就应该在对应 domain 的 `grpc_impl/codecs/*.py` 里注册 explicit codec。

### 7. 重新生成 binding 并补测试

改 proto 后运行：

```bash
pip install -r requirements/proto.txt
python -m lmcache.v1.multiprocess.transport.grpc_impl._proto_gen._generate
```

然后至少补这些测试：

- method registry 能找到新 RPC；
- proto request/response 能 round-trip 到 Python 类型；
- module handler annotation 能通过 `validate_handler()`；
- gRPC E2E 能通过真实 client/server 调用；
- ZMQ 路径如果仍支持该 `RequestType`，也要验证旧 facade。

## 十、新增 message 或 field 时如何保持兼容

gRPC/protobuf 给了 wire-level 兼容基础，但当前 LMCache 还多两层账：Python 类型契约和 ZMQ 历史兼容。等 ZMQ 退场后，ZMQ enum 这张账可以消失，兼容性重点会回到 protobuf wire contract、Python handler contract 和 codec contract。

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/compatibility-rules.svg" aria-label="打开兼容性规则图原图">
    <img src="/images/blog/lmcache-grpc-transport/compatibility-rules.svg" alt="LMCache gRPC 兼容性规则" />
  </a>
  <figcaption>图 8：当前双栈阶段要同时维护 protobuf wire、Python contract 和 ZMQ enum；未来 gRPC-only 后可以去掉 ZMQ enum 这层。</figcaption>
</figure>

我建议把兼容性分成几类来看。

### 1. 新增 service

新增 service 通常是安全的，因为旧 client 根本不会调用它。需要注意：

- service 名不能和已有 generated service 重复；
- 文件名保持 `*_service.proto`，否则 descriptor discovery 不会加载；
- 当前双栈阶段，新 service 里的 method 仍然要能映射到 `RequestType`；
- 如果这个 service 是可选模块，未启用时应该返回 `UNIMPLEMENTED`，而不是让请求半成功。

### 2. 新增 RPC

新增 RPC 也通常是安全的，但前提是旧版本不需要理解它。对混部环境来说：

- 新 client 调新 RPC，老 server 没实现时应该得到明确失败；
- 新 server 支持新 RPC，不影响老 client 调旧 RPC；
- 如果你是在改变一个已有 RPC 的 payload shape，不要直接改旧 RPC，优先新增 `FooV2` 或新的语义化名称。

CacheBlend 这块已经有一个很好的经验：payload shape 变化意味着新 request name，而不是复用旧 `RequestType` 让两边猜版本。

### 3. 新增 message type

新增 message type 本身没问题。关键是它能不能映射到 Python 类型：

- 普通字段集合：优先 dataclass / `msgspec.Struct` + structural codec；
- 需要保留 Python 子类身份、opaque handle、特殊对象：注册 explicit codec；
- message 作为公共结构被多个 service 使用时，放进 `common.proto`；只属于一个业务域时，放在自己的 service proto 里。

不要为了省事把所有特殊对象都塞成 `bytes`。`bytes` 当然能绕过类型问题，但会把语义隐藏起来，后续兼容性 review 会更困难。

### 4. 新增 field

这是最常见也最容易出问题的场景。

推荐规则：

1. **永远使用新的 field number。** 已经用过的 number 即使删掉也不要复用。
2. **能 optional 就 optional。** 如果“没发”和“发了默认值”语义不同，必须用 `optional`，让 decoder 能得到 `None`。
3. **Python 侧给默认值。** dataclass 新字段应放在默认字段区域，避免旧 payload 或旧构造路径缺字段时崩掉。
4. **尽量追加字段。** structural codec 按字段结构对齐，追加比中间插入更容易 review，也更符合演进直觉。
5. **不要改已有字段的 wire type。** `int64` 改 `string`、`bytes` 改 message 这类变化，都应该用新 field。
6. **弃用字段先保留。** proto 里可以标注 deprecated 或注释说明；真正删除时要 `reserved` 旧 tag/name，防止未来误用。

举个例子，如果要给 `IpcCacheServerKey` 增加一个可选 trace id，比较稳的写法是：

```proto
message IpcCacheServerKey {
  string model_name = 1;
  int64 world_size = 2;
  optional int64 worker_id = 3;
  repeated int64 token_ids = 4;
  int64 start = 5;
  int64 end = 6;
  string request_id = 7;
  string cache_salt = 8;
  optional bytes encoded_request_configs = 9;
  int64 num_kv_readers = 10;
  optional string trace_id = 11;
}
```

Python 侧也要给默认值：

```python
@dataclass(order=True, frozen=True)
class IPCCacheServerKey:
    ...
    num_kv_readers: int = field(default=0, compare=False)
    trace_id: str | None = field(default=None, compare=False)
```

这样老 client 不发 `trace_id` 时，新 server 能看到 `None`；新 client 发 `trace_id` 给老 server 时，老 server 至少会忽略未知 protobuf field，不影响旧语义。

### 5. 修改已有 field

这类操作要非常保守。

如果只是改注释、补充含义、放宽业务校验，通常可以。

如果要改语义，例如：

- `num_kv_readers=0` 原来表示未发送，现在想表示一个合法值；
- `cache_salt` 原来参与 cache identity，现在想只做 metadata；
- `block_ids` 原来按 kernel group 排列，现在想按 object group 排列；

这些都不是简单 field 修改，而是协议语义变化。更稳的方式是新增字段、新增 message、或者新增 RPC，并让旧语义保留一段迁移期。

## 十一、为什么 codec 也影响兼容性

protobuf 的 wire 兼容不等于 LMCache 的端到端兼容。

假设你在 proto 里追加了一个字段，但 Python dataclass 没加默认值，或者 structural codec 无法把缺失字段映射成 `None`，那么老 client 发来的请求仍然可能在 server decode 阶段失败。

再比如你把一个 Python 类型从 `tuple[bytes, bool]` 改成 dataclass：

```python
@dataclass
class EventResult:
    event_ipc_handle: bytes
    success: bool
```

wire 上也许仍然是同样两个字段，但 method registry 看到的 response type 变了。你需要确认 response encoder/decoder、handler annotation、双栈阶段的 ZMQ facade、测试 fixture 全部同步，而不是只改 proto。

这也是为什么 LMCache 的 registry 初始化要做这么多校验：协议层出错时，宁愿启动失败，也不要让 KV cache 在运行时被错误的字段解释污染。

## 十二、生成代码和依赖边界

gRPC schema 源文件在：

```text
lmcache/v1/multiprocess/transport/grpc_impl/protos/
```

生成代码在：

```text
lmcache/v1/multiprocess/transport/grpc_impl/_proto_gen/
```

生成入口是：

```bash
python -m lmcache.v1.multiprocess.transport.grpc_impl._proto_gen._generate
```

当前构建流程会在 package build 时生成 ignored 的 `*_pb2.py`、`*_pb2_grpc.py`、`*_pb2.pyi` 文件，并对 generated import 做一次不导入 LMCache root 的检查。这点很重要：PEP 517 build subprocess 里，如果 generator 为了导入 generated pb2 顺手 import 了 `lmcache.__init__` 或 runtime dependency，就会把构建环境变成运行环境，CI 很容易炸在一个和 gRPC 本身无关的位置。

如果你在本地开发时遇到：

```text
No generated gRPC services found.
```

先运行：

```bash
pip install -r requirements/proto.txt
python -m lmcache.v1.multiprocess.transport.grpc_impl._proto_gen._generate
```

再跑相关测试。

## 十三、推荐的迁移策略

如果你现在有一套 ZMQ 部署，我建议这样迁：

1. 先升级 LMCache 到包含 gRPC runtime 的版本；
2. 保持现有 `--transport zmq` 和 `tcp://...`，确认行为不变；
3. 在 staging 环境把 server 改成 `--transport grpc`，vLLM 改成 `grpc://...`；
4. 跑一组最小验证：首个请求 miss，第二个相同请求命中，server log 能看到 request transport 是 gRPC；
5. 再跑真实 workload，看 `LOOKUP`、`STORE`、`RETRIEVE`、heartbeat、restart/recovery 是否都符合预期；
6. 最后把生产环境按实例分批切换。

最小验证可以用这种思路：

```bash
# terminal 1
lmcache server \
  --transport grpc \
  --host 0.0.0.0 \
  --port 5555 \
  --l1-size-gb 20 \
  --eviction-policy LRU

# terminal 2
vllm serve Qwen/Qwen3-8B \
  --port 8000 \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector",
    "kv_role":"kv_both",
    "kv_load_failure_policy":"recompute",
    "kv_connector_extra_config":{
      "lmcache.mp.host":"grpc://localhost",
      "lmcache.mp.port":5555,
      "lmcache.mp.mq_timeout":10
    }}'
```

然后对同一个长 prompt 请求两次，观察第二次是否出现 LMCache cached tokens。这里验证的是端到端 KV reuse，不只是“gRPC 端口能连上”。

## 十四、总结

LMCache 这次 gRPC 支持真正解决的不是“把 ZMQ 换成另一个网络库”，而是把 MP request protocol 从隐式约定推进到了显式契约：

- 应用层只调用 `RequestClient`；
- URL scheme 和 `--transport` 决定 request transport；
- protobuf 描述 wire schema；
- 当前双栈阶段，`ProtocolDefinition` 描述 Python 语义；
- codec registry 把两者编译到一起；
- server 仍然复用 transport-neutral handler metadata 和调度语义；
- 兼容性通过 protobuf field 规则、append-only `RequestType`、handler annotation validation 和 E2E 测试共同维护。

这也是为什么我建议新部署尽量启用 gRPC。它不会替代 CUDA IPC/SHM 这些真正搬 KV bytes 的路径，但它会让 LMCache MP 的控制面更可读、更可测、更容易演进。随着协议面继续扩展，ZMQ 更适合作为兼容路径，gRPC 才更适合作为长期主路径；当 ZMQ 最终退场后，`RequestType`、`ProtocolDefinition` 这类为了桥接新旧 transport 的中间结构也可以继续收敛，最终让新增 RPC 更接近“改 proto、生成 adapter、写 handler、补测试”的简单流程。
