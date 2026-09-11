---
title: "LMCache MP 为什么要加 gRPC？从 PR #4953 看 request transport 的拆分"
description: "解读 LMCache PR #4953：它如何在保留 ZMQ 默认路径的同时，引入 gRPC request transport、生成式 protobuf codec、统一 handler 元数据，以及 ZMQ/gRPC 测试矩阵。"
publishedAt: 2026-09-11
updatedAt: 2026-09-11
category: AI Infra
tags:
  - lmcache
  - grpc
  - zmq
  - kv-cache
  - multiprocess
  - distributed-systems
author: 毛宝龙
readingTime: 18 min
featured: true
draft: false
---

我第一次看 [LMCache PR #4953](https://github.com/LMCache/LMCache/pull/4953) 的时候，直觉上以为它只是“给 MP server 加一个 gRPC 入口”。继续往下读，发现它真正动的是一个更底层的边界：**LMCache MP 的请求语义，开始从具体传输实现里拆出来了。**

以前我们说 MP server，多半会自然地把它等同于 ZMQ server。vLLM connector 这边拿到一个 `tcp://localhost:5555`，然后通过 `RequestClientFactory` 创建 ZMQ client；server 侧则启动一个 `MessageQueueServer`，把 `LOOKUP`、`STORE`、`RETRIEVE`、`PING` 这些请求注册进去。

这条路跑了很久，也很实用。但它有一个隐含前提：LMCache 的业务请求协议和 ZMQ 的 server/client 代码绑在一起。要增加 gRPC，就不能只是写一套 gRPC wrapper；否则同一批 `RequestType`、handler 类型、payload 编码规则，很容易在 ZMQ 和 gRPC 两边各维护一份，最后变成“看起来共享协议，实际上两套实现慢慢分叉”。

PR #4953 做的事情，可以概括成一句话：

> `LOOKUP` 还是那个 `LOOKUP`，`STORE` 还是那个 `STORE`；只是它可以从 `tcp://` 进来，也可以从 `grpc://` 进来。

这篇文章就顺着这个思路，把它拆开讲清楚。

![LMCache request transport 边界](/images/blog/lmcache-grpc-request-transport/transport-boundary.svg)

## 先看用户能感受到的变化

最外层的配置变化很小。

原来的 ZMQ 路径还是这样：

```json
{
  "lmcache.mp.host": "tcp://localhost",
  "lmcache.mp.port": 5555
}
```

server 侧仍然可以默认启动 ZMQ，因为 `--transport` 的默认值是 `zmq`：

```bash
lmcache server --host localhost --port 5555
```

如果要走 gRPC，则把 endpoint scheme 换成 `grpc://`，server 也显式启动 gRPC transport：

```json
{
  "lmcache.mp.host": "grpc://localhost",
  "lmcache.mp.port": 5555
}
```

```bash
lmcache server --transport grpc --host localhost --port 5555
```

也就是说，PR 没有把默认行为突然切到 gRPC。裸 `host:port` 仍然会被当成 `tcp://host:port`，`tcp://` 仍然走 ZMQ。这个选择挺重要，因为 MP connector 已经被很多脚本、CI 和部署方式使用，默认路径不能因为新增能力就突然变味。

真正的选择点在 `RequestClientFactory`：

```text
bare host:port  → tcp://host:port → ZMQ
tcp://...       → ZMQ
ipc://...       → ZMQ
inproc://...    → ZMQ
grpc://...      → gRPC
grpc+unix://... → gRPC
```

这个设计有点朴素，但很舒服：调用方不需要多传一个“我要 gRPC”的参数，endpoint 自己就说明了请求要走哪条路。

## 为什么不能只复制一套 gRPC handler

LMCache MP server 不是普通 HTTP API。它的请求背后连接着 KV cache 生命周期：

- Scheduler 侧会发 `LOOKUP`、`FREE_LOOKUP_LOCKS`、`END_SESSION`；
- Worker 侧会发 `REGISTER_KV_CACHE`、`STORE`、`RETRIEVE`；
- engine-driven 路径还会有 `PREPARE_STORE`、`COMMIT_STORE`、`PREPARE_RETRIEVE`、`COMMIT_RETRIEVE`；
- 管理面需要 `PING`、`CLEAR`、`GET_CHUNK_SIZE`；
- P2P 和 Blend 又各有一批自己的请求。

这些请求不只是名字不同。它们还有三类信息必须保持一致：

| 信息 | 为什么重要 |
|---|---|
| payload 类型 | client 发什么参数，server handler 就必须按同样的形状接收 |
| response 类型 | `STORE` 返回 event handle 和成功标记，`LOOKUP` 没有普通返回值，二者不能混 |
| handler 执行方式 | 有些请求可以同步处理，有些要进 blocking pool，有些还需要 client affinity |

如果 ZMQ 一张表、gRPC 一张表，这些信息很容易漂移。比如 ZMQ 里 `STORE` 是 affinity blocking，gRPC 里忘了 affinity；或者某个 response 从 tuple 改成 dataclass，一边更新了，一边没更新。KV cache 这种系统最怕的就是这种“代码能启动，但语义悄悄错了”的不一致。

所以 #4953 先把 handler 元数据抽出来。业务模块的方法上开始挂 `@request_handler(...)`：

```python
@request_handler(
    RequestType.STORE,
    HandlerType.BLOCKING,
    requires_client_affinity=True,
)
def store(...):
    ...
```

这个装饰器表达的是：“这个 Python 方法处理哪个 `RequestType`，应该按什么执行模型跑，是否要求同一个 client 的相关请求落到同一个 affinity worker。”

ZMQ server 读这份元数据来注册 handler；gRPC server 也读同一份元数据来注册 handler。业务模块不需要知道自己后面接的是哪种 transport。

这一步看起来像重构，但它是 gRPC 能比较干净地接进来的前提。

## protobuf 不是另起一套协议

gRPC 当然需要 protobuf message。PR 里新增了多组 service proto，例如：

```protobuf
service LookupService {
  rpc Lookup(LookupRequest) returns (LookupResponse);
  rpc QueryPrefetchStatus(QueryPrefetchStatusRequest)
      returns (QueryPrefetchStatusResponse);
  rpc FreeLookupLocks(FreeLookupLocksRequest) returns (FreeLookupLocksResponse);
}
```

以及 LMCache-driven transfer：

```protobuf
service LMCacheDrivenService {
  rpc RegisterKvCache(RegisterKvCacheRequest) returns (RegisterKvCacheResponse);
  rpc Store(StoreRequest) returns (StoreResponse);
  rpc Retrieve(RetrieveRequest) returns (RetrieveResponse);
}
```

这里容易误解的一点是：protobuf 并没有取代 LMCache 已有的 `RequestType` 协议。它更像是一层 wire contract，负责把 Python 对象摆成 gRPC 能传输的 message。真正判断 `Lookup` 对应哪个请求类型、payload 应该是什么、response 应该怎么还原的，还是来自 LMCache 已有协议定义。

这就是 `GrpcMethodCodecRegistry` 的作用。

![gRPC codec registry](/images/blog/lmcache-grpc-request-transport/codec-registry.svg)

它做的事情很像启动时对账：

1. 扫描生成出来的 `*_service_pb2` 模块；
2. 从 protobuf method 名字推导 client method 名字，比如 `QueryPrefetchStatus` 变成 `query_prefetch_status`；
3. 再把这个名字映射回 `RequestType.QUERY_PREFETCH_STATUS`；
4. 从已有 protocol 里拿 payload class 和 response class；
5. 编译 request encoder/decoder、response encoder/decoder；
6. server 启动时验证 module handler 的类型标注是否和 gRPC contract 对得上。

这套机制有一个好处：gRPC 的 proto 文件和 Python handler 不是“约定俗成地一致”，而是在启动和测试中被明确校验。对于长期维护，这是比“我相信两边一样”更可靠的方式。

## 一次 gRPC 调用是怎么走的

从 client 侧看，gRPC client 并没有要求上层调用方改成 protobuf 风格。

调用方仍然是这种形状：

```python
future = client.store(key, instance_id, gpu_block_ids, event_ipc_handle)
result = future.result(timeout=5)
```

`GrpcMultiprocessClient` 初始化时会扫描所有生成 RPC，为每个方法生成同名 Python 方法。调用发生时，它从 registry 找到对应 codec：

```text
Python args / kwargs
        ↓
request_encoder
        ↓
protobuf request
        ↓
generated gRPC stub future
        ↓
response_decoder
        ↓
MessagingFuture
```

最后仍然包成 LMCache 自己的 `MessagingFuture`。这点很妙：上层 adapter 不需要关心底下是 ZMQ future 还是 gRPC future，它等待的仍然是同一种抽象。

server 侧则反过来：

```text
protobuf request
        ↓
request_decoder
        ↓
Python payloads
        ↓
module handler
        ↓
Python response
        ↓
response_encoder
        ↓
protobuf response
```

![gRPC 调用路径](/images/blog/lmcache-grpc-request-transport/grpc-call-path.svg)

这里还处理了一个 MP 场景很现实的问题：不同请求的执行模型不同。

- `GET_CHUNK_SIZE` 这种轻量请求可以同步执行；
- `LOOKUP`、`PING`、`CLEAR` 这类会进入 blocking pool；
- `STORE`、`RETRIEVE`、engine-driven 的 prepare/commit 需要 client affinity，避免同一 client 的相关数据搬运请求被分散到不同 worker 上。

ZMQ 以前也有类似的 thread pool 分法。#4953 的做法不是让 gRPC 自己随便开线程跑，而是把已有 handler 元数据映射到 gRPC server 的 normal pool 和 affinity pool。也就是说，它在换 transport，但没有放弃 MP runtime 里原来的调度语义。

## 它为什么保留 protobuf 作为 wire format

PR 描述里有一句话很关键：gRPC transport 仍然保持 protobuf 作为 wire format。

这不是废话。因为 LMCache MP 里面有不少 Python 世界里的复杂对象：

- `IPCCacheServerKey`
- `DeviceIPCWrapper`
- `BlockAllocationRecord`
- `MemoryLayoutDesc`
- `TransferChannelAddress`
- `torch.dtype`
- `torch.Size`
- 一些 dict、tuple、optional response

如果每个 gRPC 方法都手写转换，很快会变成一团很难 review 的模板代码。#4953 把结构化转换集中在 `proto_codec.py`，同时把真正非结构化、需要特殊理解的类型转换放到显式 codec registration 里，比如 common codec 和 P2P codec。

我理解这里的取舍是：

- 能从类型结构推导的，就让通用 codec 编译；
- 不能靠结构猜的，就显式注册；
- 不再靠 response message 名字或运行时 payload shape 去猜。

这比“收到一个 protobuf message，然后猜它应该还原成什么 Python 对象”要稳。尤其对 cache 系统来说，猜错一次可能不是报错，而是把错误的数据路径跑通了。

## server 端如何选择 ZMQ 或 gRPC

server 侧新增了 `MPServerConfig.transport`：

```python
transport: Literal["zmq", "grpc"] = "zmq"
```

CLI 上对应：

```bash
lmcache server --transport zmq  --host localhost --port 5555
lmcache server --transport grpc --host localhost --port 5555
```

然后 `create_request_server(modules, mp_config)` 根据 `mp_config.transport` 选择：

```text
transport == "grpc" → build_grpc_request_server(...)
otherwise           → build_zmq_request_server(...)
```

这也解释了为什么 client 和 server 必须成对配置：

| client endpoint | server transport | 结果 |
|---|---|---|
| `tcp://localhost:5555` | `zmq` | 正常 |
| `grpc://localhost:5555` | `grpc` | 正常 |
| `tcp://localhost:5555` | `grpc` | client 会按 ZMQ 发，连不上 |
| `grpc://localhost:5555` | `zmq` | client 会按 gRPC 发，连不上 |

所以 gRPC 不是一个透明替换按钮。它是 request transport 的一条新路径，endpoint scheme 和 server `--transport` 必须一致。

## 和 AutoStart 的关系

这也带出一个当前边界：#4953 的 gRPC 能力和 MP AutoStart 不是天然连在一起的。

AutoStart 那个功能的目标是让 vLLM worker 0 在本地自动启动 MP server。它目前解析的是本地 `tcp://localhost:<port>` / `tcp://127.0.0.1:<port>` endpoint，然后启动 server 时不显式传 `--transport`。在 #4953 之后，因为 server 默认 transport 仍然是 `zmq`，所以现有 ZMQ AutoStart 路径可以继续平滑工作。

但如果用户想写：

```json
{
  "lmcache.mp.host": "grpc://localhost",
  "lmcache.mp.port": 5555,
  "lmcache.mp.autostart": true
}
```

那当前 AutoStart 还不能自动变成 gRPC。它至少需要做三件事：

1. 允许 `grpc://` 本地 endpoint；
2. 从 scheme 推导出 `--transport grpc`；
3. health check 使用同一个 request transport 去 ping。

所以我的判断是：**#4953 不会破坏现有 ZMQ AutoStart，但 gRPC AutoStart 应该作为后续工作单独补。**

![ZMQ、gRPC 与 AutoStart 的边界](/images/blog/lmcache-grpc-request-transport/compatibility-map.svg)

## 测试矩阵补的是信心，不只是覆盖率

#4953 的测试也很有意思。它不是只加一个 `test_grpc_transport.py` 证明 gRPC client/server 能互相说话，而是把很多已有 multiprocess 测试改成 request transport matrix：

```text
LMCACHE_REQUEST_TRANSPORT=zmq
LMCACHE_REQUEST_TRANSPORT=grpc
```

脚本里再把它转成 connector endpoint scheme：

```text
zmq  → tcp://localhost:<port>
grpc → grpc://localhost:<port>
```

server 启动时也传同一个选择：

```bash
lmcache server --transport "$LMCACHE_REQUEST_TRANSPORT" ...
```

这类测试的价值不只是“gRPC 代码跑了一遍”。更重要的是，它在逼着 ZMQ 和 gRPC 共享同一套业务语义：lookup、transfer、P2P、CPU device、SGLang、Buildkite K3 这些路径如果都能在两种 request transport 下跑，才说明 transport 边界真的拆干净了。

当然，矩阵也会带来维护成本。以后新增一个 `RequestType`，不能只想着 ZMQ handler 表；要同时考虑：

- proto service 有没有对应 RPC；
- method registry 能不能映射回 `RequestType`；
- payload/response codec 能不能表示这个类型；
- module handler 有没有 `@request_handler`；
- ZMQ 和 gRPC 两条测试路径是否都覆盖到了。

这就是抽象拆分后的代价：边界更清楚了，但每次扩展都要更认真地把契约补齐。

## 这个 PR 真正改变了什么

我觉得 #4953 最重要的变化不是“LMCache 终于有 gRPC 了”，而是下面这件事：

> MP runtime 开始拥有一个 transport-neutral 的 request layer。

ZMQ 仍然是默认、成熟、兼容旧部署的路径。gRPC 则提供了另一种更标准的 RPC 入口，未来可能更容易和多语言工具、服务治理、代理、观测系统、sidecar、跨进程部署形态结合。

但它没有把所有东西都重做一遍。`RequestType` 还在，业务 module 还在，`MessagingFuture` 还在，server 内部的 normal/affinity pool 语义也还在。PR 做的是在这些东西外面切出一层 transport boundary：

```text
业务语义：LOOKUP / STORE / RETRIEVE / PING
执行语义：SYNC / BLOCKING / client affinity
编码语义：Python payload ↔ protobuf message
传输语义：ZMQ or gRPC
```

把这四件事分清楚之后，系统会更容易继续长大。

## 我会怎么理解它的风险

如果按 review 视角看，我会把风险分成三类。

第一类是兼容性风险。默认仍是 ZMQ，裸 endpoint 仍补成 `tcp://`，所以旧路径没有被强行迁移，这是比较稳的。

第二类是契约漂移风险。PR 用 `@request_handler`、method registry、handler annotation validation 和测试矩阵去压这个风险。这个方向是对的，甚至可以说是这个 PR 最值得肯定的地方。

第三类是运行时成熟度风险。gRPC 新路径刚进来，和 ZMQ 一样长期跑生产负载还需要时间。特别是大 payload、client affinity、错误传播、shutdown、P2P 场景、不同平台 CI，这些都不是靠一个 unit test 就能彻底证明的。但从代码结构看，它不是临时拼出来的旁路，而是在认真给 MP request layer 做第二种 transport。

所以这篇文章的结论很简单：

> #4953 不是“把 ZMQ 换成 gRPC”。它是在 LMCache MP 里补出一个真正的 request transport 抽象。ZMQ 继续兜底，gRPC 成为新入口；短期看是多一种连接方式，长期看是把 MP server 从单一消息队列实现里解耦出来。

这类 PR 不一定一眼惊艳，但系统后面能不能继续扩展，往往就靠这种边界慢慢清出来。

## 源码入口

想顺着代码继续看，可以从这几处开始：

- [PR #4953](https://github.com/LMCache/LMCache/pull/4953)
- `lmcache/v1/multiprocess/transport/factory.py`：client 根据 endpoint scheme 选择 ZMQ 或 gRPC。
- `lmcache/v1/multiprocess/transport/server_factory.py`：server 根据 `MPServerConfig.transport` 选择 request server。
- `lmcache/v1/multiprocess/request_handler.py`：业务 handler 的 transport-neutral 元数据。
- `lmcache/v1/multiprocess/transport/grpc_impl/method_registry.py`：protobuf method、`RequestType`、payload/response codec 的对账表。
- `tests/v1/multiprocess/test_grpc_transport.py`：gRPC service、codec、handler annotation 和端到端调用的集中测试。
