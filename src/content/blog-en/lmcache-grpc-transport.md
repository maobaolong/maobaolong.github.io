---
title: "LMCache gRPC Support Details: From Enabling Methods to Protocol Evolution"
description: "An introduction to how LMCache multiprocess request transport evolved from ZMQ to gRPC: specific configurations for server and vLLM, implementation principles, codec design, benefits, and how to maintain compatibility when adding new service/message/rpc/field."
publishedAt: 2026-09-17
updatedAt: 2026-09-18
category: "AI Infra"
tags:
  - lmcache
  - grpc
  - vllm
  - kv-cache
  - multiprocess
  - protobuf
  - distributed-systems
author: "Maobaolong"
readingTime: "28 min"
featured: true
draft: false
---
This article does not start with "What is gRPC?" but instead provides a way to enable it that can be copied directly.

In the LMCache MP mode, there are two types of "transports" that can easily be confused:

- **request transport**: vLLM/SGLang/SDK sends control requests such as `LOOKUP`, `STORE`, `RETRIEVE`, and `PING` to the LMCache MP server. The gRPC discussed in this article operates at this layer.
- **KV data transfer**: This refers to how actual KV bytes move between the engine worker and the LMCache server, such as through CUDA IPC, POSIX SHM, engine-driven pickle/SHM, etc. This layer is determined by `--supported-transfer-mode` and the worker-side `lmcache.mp.mp_transfer_mode`, and will not automatically change to "gRPC moving KV tensor" just because the request transport is switched to gRPC.

In short: **gRPC is responsible for clarifying requests; KV data still follows LMCache's original high-performance transport path.**

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/quick-enable-en.svg" aria-label="Open the original gRPC enable configuration diagram">
    <img src="/images/blog/lmcache-grpc-transport/quick-enable-en.svg" alt="LMCache gRPC enable configuration" />
  </a>
  <figcaption>Figure 1: Requests are sent from the vLLM side to the LMCache server; enabling gRPC requires configuration changes on both ends. On narrow screens, you can scroll horizontally or click to view the original image.</figcaption>
</figure>

## Zero, Implementation Path: A Series of PRs Paving the Way

This gRPC support is not a "big PR that directly replaces ZMQ," but rather a series of PRs with gradually clearer boundaries. This rhythm is important: first, let the upper-level code no longer depend on ZMQ details, then consolidate the client creation entry into a factory, isolate the old ZMQ logic, and finally integrate protobuf, gRPC client/server, testing matrix, and packaging process.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/zmq-to-grpc-roadmap-en.svg" aria-label="Open the original ZMQ to gRPC PR roadmap">
    <img src="/images/blog/lmcache-grpc-transport/zmq-to-grpc-roadmap-en.svg" alt="LMCache PR evolution path from ZMQ to gRPC" />
  </a>
  <figcaption>Figure 2: gRPC support is implemented in layers through PRs; future efforts will continue to converge towards gRPC-first.</figcaption>
</figure>

From the public PRs, this path roughly looks like:

| Stage | PR | What was done | Why it was done first |
|---|---|---|---|
| ZMQ Semantic Abstraction | [#4878](https://github.com/LMCache/LMCache/pull/4878) | Introduced `RequestClient` / `ZmqMultiprocessClient` facade, placing semantic methods like `lookup()`, `store()`, `retrieve()` onto a unified client interface | To allow upper-level callers to detach from `submit_request(RequestType, payload_list)` before changing the transport |
| Client Factory | [#4882](https://github.com/LMCache/LMCache/pull/4882) | Selected transport based on URL scheme through `RequestClientFactory.create(server_url)` | `tcp://` and bare hosts continue to use ZMQ, while `grpc://` can be handled by the new gRPC client |
| ZMQ Boundary Isolation | [#5050](https://github.com/LMCache/LMCache/pull/5050) | Moved ZMQ request handling behind a clearer `zmq_impl` boundary | The old implementation remains usable but is no longer scattered across the shared protocol layer |
| Protobuf Foundation | [#5066](https://github.com/LMCache/LMCache/pull/5066) | Added `*_service.proto`, generated entry points, basic tests, and transport test plumbing | To stabilize schema, generated code, and test entry points before discussing runtime switching |
| Wheel Generation Stability | [#5081](https://github.com/LMCache/LMCache/pull/5081) | Stabilized gRPC proto generation in wheel builds | To prevent protobuf/gRPC tooling from becoming an implicit risk in packaging and installation paths |
| Runtime gRPC | [#4953](https://github.com/LMCache/LMCache/pull/4953) | Integrated gRPC request transport, allowing `--transport grpc` and `grpc://` to run properly, and covered gRPC/ZMQ in tests | This step enables users to utilize the gRPC client/server runtime |

There are still many worthwhile tasks ahead on this path:

- **Gradually remove ZMQ.** New capabilities, documentation, CI, and production recommendations should first shift to gRPC; once the compatibility window closes, historical burdens like the ZMQ facade, ZMQ server path, and `RequestType` numeric wire IDs can be phased out.
- **Simplify the protocol middleware.** The current `RequestType` and `ProtocolDefinition` serve as a bridge from the dual-stack era. After moving to gRPC-only, `package.Service/Method` can become the operation identity, allowing proto descriptors or generated adapters to directly provide Python contracts.
- **Optimize gRPC performance.** Future efforts can focus on deadline propagation, backpressure, connection reuse, worker pool configuration, batching small control requests, and codec overhead for more detailed benchmarks and optimizations.
- **Add gRPC metrics.** Metrics such as per-RPC latency, status code, payload encode/decode cost, server queue wait, affinity worker distribution, and client reconnect/error rates can all become observable indicators.
- **Expand ecosystem capabilities.** gRPC health checks, reflection, external sidecars, cross-language SDKs, debug gateways, and version negotiation will all be more natural than custom ZMQ payloads.
## 1. Minimal Activation Method

### 1. Server Side: Start gRPC Request Server

Previously, the default was to start the ZMQ request server:

```bash
lmcache server \
  --transport zmq \
  --host 0.0.0.0 \
  --port 5555 \
  --l1-size-gb 20 \
  --eviction-policy LRU
```

When switching to gRPC, the key change is just one line:

```bash
lmcache server \
  --transport grpc \
  --host 0.0.0.0 \
  --port 5555 \
  --l1-size-gb 20 \
  --eviction-policy LRU
```

If you want to adjust the number of gRPC access layer threads, you can add:

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

The three worker options here are not the same type:

| Parameter | Function |
|---|---|
| `--grpc-server-workers` | Size of the thread pool for the gRPC Python server to receive and distribute unary RPCs |
| `--max-gpu-workers` | Pool for GPU-related handlers that require client affinity, such as `STORE` / `RETRIEVE` |
| `--max-cpu-workers` | Pool for ordinary handlers for blocking operations like `LOOKUP`, `PING`, and management tasks |

### 2. vLLM Side: Write `lmcache.mp.host` as `grpc://...`

On the vLLM side, there is no need to change the connector name; you still use `LMCacheMPConnector`. The key is in the `kv_connector_extra_config` where `lmcache.mp.host` is defined.

The ZMQ format is usually:

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

The gRPC format is:

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

Note that the port should not be included in the `host` and then concatenated again. The single server configuration of LMCacheMPConnector will combine:

```json
{
  "lmcache.mp.host": "grpc://localhost",
  "lmcache.mp.port": 5555
}
```

into:

```text
grpc://localhost:5555
```

If you have multiple LMCache servers, use `lmcache.mp.server_urls`, and each URL must include the scheme:

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

The most common pitfall during migration is mismatched configurations on both ends:

| LMCache Server | vLLM `lmcache.mp.host` | Result |
|---|---|---|
| `--transport grpc` | `grpc://host` | Correct |
| `--transport zmq` | `tcp://host` or bare `host` | Correct |
| `--transport grpc` | `tcp://host` | vLLM uses ZMQ client, cannot connect to gRPC server |
| `--transport zmq` | `grpc://host` | vLLM uses gRPC client, cannot connect to ZMQ server |

Based on the LMCache `dev` snapshot I pulled while writing this, [`caba24c2`](https://github.com/LMCache/LMCache/tree/caba24c2bbd0319142664213e5bab6d10bd0a47a), gRPC is no longer just a placeholder implementation that only hosts proto but cannot run. The `MPServerConfig.transport` accepts `zmq` / `grpc`, and the server factory will create a gRPC request server when `--transport grpc` is specified, while the client factory will create a gRPC client upon seeing `grpc://` / `grpc+unix://`.
## 2. Why Migrate from ZMQ to gRPC

The initial request path for LMCache in MP mode is quite straightforward: the client sends a `RequestType` and a positional payload list into ZMQ, and the server looks up the handler based on `RequestType`, then decodes the payload in a fixed order.

This method works and is lightweight. However, as the MP server takes on more capabilities, the maintenance costs start to become apparent:

1. **Parameter order is the protocol.** Adding a payload or adjusting a field can lead to subtle misalignments when old clients and servers run together.
2. **Protocol is unreadable.** Seeing `STORE` followed by a list makes it hard to know what fields are actually on the wire and what their types are.
3. **Weak cross-language and tool ecosystem.** The schema, stubs, reflection, gateways, load balancing, and observability ecosystem of protobuf/gRPC are mature, while ZMQ relies on project-specific conventions.
4. **Tight coupling of callers.** If the upper-level code directly constructs `MessageQueueClient`, introducing a second request transport would require a complete overhaul of the codebase.

Thus, supporting gRPC is not simply a matter of replacing `send_multipart` with `stub.Foo.future()`. The real transformation is divided into four steps:

1. First, change the upper-level calling interface to a transport-neutral `RequestClient`;
2. Next, consolidate the Python payload/response types for each RPC into a `ProtocolDefinition`;
3. Then, define the protobuf schema for gRPC and generate the code;
4. Finally, connect the gRPC client/server to the same handler and codec registry.

I understand that ZMQ will gradually be phased out. To be precise, it’s not about “removing ZMQ today,” but rather that **new capabilities, documentation recommendations, CI coverage, and default values for production deployment will gradually converge towards gRPC-first**. ZMQ will still serve a compatibility path for a while, but it is no longer suitable as the primary protocol surface for ongoing expansion.

This also affects the way protocols evolve: in the current dual-stack phase, `RequestType` and `ProtocolDefinition` still serve as the bridge connecting the gRPC registry to proto methods, Python payload/response types, and business handlers; however, they are not an intermediate layer that must be retained forever in the final form of gRPC. Once ZMQ is completely phased out, LMCache can consolidate operation identity into protobuf service/methods and derive Python type contracts from proto descriptors or generated code, reducing the redundant tables maintained today for compatibility with historical wire paths.

## 3. What Do the Request Transport Boundaries Look Like?

The application layer should not directly concern itself with ZMQ or gRPC. It only does two things:

1. Calls `RequestClientFactory.create(server_url)`;
2. Receives a `RequestClient` with named methods, such as `lookup()`, `store()`, `retrieve()`, `ping()`.

The scheme of `server_url` determines the client implementation:

| endpoint | client transport |
|---|---|
| `localhost:5555` | Automatically completes to `tcp://localhost:5555`, using ZMQ |
| `tcp://host:5555` | ZMQ |
| `ipc://path` / `inproc://name` | Recognized by ZMQ client factory |
| `grpc://host:5555` | gRPC |
| `grpc+unix:///path/to/socket` | gRPC Unix domain socket target |

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/transport-boundary-en.svg" aria-label="Open the original request transport boundary diagram">
    <img src="/images/blog/lmcache-grpc-transport/transport-boundary-en.svg" alt="LMCache request transport abstract boundary" />
  </a>
  <figcaption>Figure 3: The application layer only sees `RequestClient`, while wire details are handled in the ZMQ/gRPC implementation.</figcaption>
</figure>

The significance of this boundary is substantial. For example, the vLLM MP connector only needs to parse `lmcache.mp.host` / `lmcache.mp.port`, and then create the request client. It does not need to know what the enum number for `STORE` is under ZMQ, nor does it need to know what fields are present in `StoreRequest` under gRPC.

The responsibility of the ZMQ facade is to maintain compatibility with the old wire:

```text
client.store(key, instance_id, block_ids, event)
  -> RequestType.STORE
  -> [key, instance_id, block_ids, event]
  -> MessageQueueClient
```

The responsibility of the gRPC client is to follow the descriptor and codec:

```text
client.store(key, instance_id, block_ids, event)
  -> StoreRequest protobuf
  -> LMCacheDrivenService.Store.future(...)
  -> StoreResponse protobuf
  -> Python result
```

The upper-level code maintains the same calling style, which makes the migration smoother.
## 4. Why the proto service is split this way

The RPC surface of the LMCache MP server is quite large now. If we were to cram all methods into a gigantic `EngineService`, it would be convenient in the short term, but would lead to a very chaotic protocol boundary in the long term.

Currently, the proto is divided by business domain:

| service | Responsible RPC |
|---|---|
| `LMCacheDrivenService` | `RegisterKvCache`, `Store`, `Retrieve`, and other server-driven KV transfer requests |
| `EngineDrivenService` | `Register...Context`, `PrepareStore`, `CommitStore`, `PrepareRetrieve`, `CommitRetrieve` |
| `LookupService` | `Lookup`, prefetch status, lookup locks, session end |
| `ControllerService` | `Clear`, `GetChunkSize`, `Ping` |
| `ObservabilityService` | `ReportBlockAllocation` |
| `BlendService` | CacheBlend handshake, rope registration, pre-computed retrieve, unified lookup |
| `P2PService` | peer lookup-and-lock, query results, unlock |
| `DebugService` | `Noop` |
| `QStoreService` | Experimental Q cache store |

These services share common messages in `common.proto`, such as `IpcCacheServerKey`, `EventIpcHandleResult`, `BlockIdGroup`, `DeviceIpcWrapper`, and `EngineGroupInfo`.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/proto-service-map-en.svg" aria-label="Open the original gRPC service map">
    <img src="/images/blog/lmcache-grpc-transport/proto-service-map-en.svg" alt="LMCache gRPC service map" />
  </a>
  <figcaption>Figure 4: Services split by protocol domain, with common structures placed in `common.proto`.</figcaption>
</figure>

There is a crucial convention here: **proto RPC names must map back to `RequestType`.**

`GrpcMethodCodecRegistry` will traverse the generated service/method descriptors, convert method names to snake case, and then to uppercase request types:

```text
Lookup                  -> lookup                  -> LOOKUP
Store                   -> store                   -> STORE
P2PLookupAndLock        -> p2p_lookup_and_lock     -> P2P_LOOKUP_AND_LOCK
CbRetrievePreComputed   -> cb_retrieve_pre_computed -> CB_RETRIEVE_PRE_COMPUTED
```

If the generated gRPC method cannot find a corresponding `RequestType`, it will fail at startup. This is much better than discovering "no handler" for a request after running for several hours.
## 5. Why Codecs Must Exist

Many people ask when they first see `proto_codec.py` and `grpc_impl/codecs/`: Since protobuf already exists, why is there an additional layer of codec?

The reason is that protobuf only defines wire messages; it does not know what Python objects the LMCache handler wants.

Taking `Store` as an example, the proto looks like this:

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

But the business handler requires Python semantics:

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

There are several differences in between:

- `IpcCacheServerKey` needs to become the Python `IPCCacheServerKey` dataclass;
- `repeated BlockIdGroup` needs to become `list[list[int]]`;
- `EventIpcHandleResult` needs to become `tuple[bytes, bool]`;
- `optional` fields need to be able to become `None`;
- Objects like `torch.dtype`, `torch.Size`, and `DeviceIPCWrapper` cannot be directly expressed using protobuf's default rules;
- The parameter and return annotations of the handler must be consistent with the protocol definition; otherwise, behavior will diverge when the transport changes.

Thus, the responsibility of the codec is not to "duplicate protobuf," but to connect the two contracts:

1. **protobuf descriptor**: What fields, tags, types, and presence exist on the wire;
2. **Python protocol definition**: What payload types are needed for this RPC in LMCache semantics, and what Python types are returned.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/codec-registry-en.svg" aria-label="Open the original codec registry diagram">
    <img src="/images/blog/lmcache-grpc-transport/codec-registry-en.svg" alt="LMCache gRPC codec registry" />
  </a>
  <figcaption>Figure 5: The method codec registry compiles the protobuf schema and Python type contracts into encoding/decoding functions.</figcaption>
</figure>

LMCache has two types of codecs.

### 1. Structural Codec

Most dataclasses, `msgspec.Struct`, lists, tuples, maps, and optionals can be structurally converted. As long as the Python fields and proto fields can correspond one-to-one, there is no need to write manual codecs.

For example, `RegisterEngineDrivenContextPayload` is a `msgspec.Struct`, and the field order and names in the proto for `RegisterKvCacheEngineDrivenContextRequest` can correspond, so the structural codec can handle it.

The advantage of this approach is that when new ordinary fields are added, there is no need to manually write serialization logic everywhere; the downside is that it requires a more orderly field design and cannot rely on "names can be arbitrary, as long as I know how to read them."

### 2. Explicit Message Codec

Some Python types are not ordinary structures and must be explicitly registered for conversion.

Currently, there are two typical examples:

| Python Type | Proto Message | Why Structural Codec Alone Cannot Be Used |
|---|---|---|
| `DeviceIPCWrapper` | `DeviceIpcWrapper` | Needs to retain the identity of specific device wrapper subclasses, using a pickle payload to carry an opaque handle |
| `torch.Size` | `TensorShape` | `torch.Size` is a tuple-like type, but semantically should map independently to repeated dims |

Thus, `grpc_impl/codecs/common.py` registers `DeviceIPCWrapper`, and `grpc_impl/codecs/p2p.py` registers `torch.Size`. The registry checks for duplicate registrations, ambiguous matches, and other issues during initialization.

The most important benefit of this design is: **the server/client will not each write their own conversion logic.** Each gRPC method obtains the request encoder/decoder and response encoder/decoder through the same registry.
## 6. How a gRPC Call Completes

Taking `LOOKUP` as an example.

The vLLM scheduler constructs an `IPCCacheServerKey` and then calls:

```python
future = req_client.lookup(key, tp_size)
```

If `req_client` is a gRPC client, this method is not a handwritten fixed function, but is installed on `GrpcMultiprocessClient` from the generated descriptor. The calling process is as follows:

1. Find `GrpcMethodCodec` based on `LookupService.Lookup`;
2. Encode `(key, tp_size)` into a `LookupRequest`;
3. Call the generated stub's `Lookup.future(...)`;
4. After gRPC completes, decode `LookupResponse` back to a Python result;
5. Write into LMCache's own `MessagingFuture`, allowing the upper layer to continue using the same future abstraction.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/call-lifecycle-en.svg" aria-label="Open the original gRPC call lifecycle diagram">
    <img src="/images/blog/lmcache-grpc-transport/call-lifecycle-en.svg" alt="LMCache gRPC call lifecycle" />
  </a>
  <figcaption>Figure 6: Both client and server encode and decode around the same method codec registry.</figcaption>
</figure>

The server side is more interesting. `GrpcMultiprocessServer.add_modules()` does not directly write `servicer.Lookup = ...`. Instead, it will:

1. Scan all business modules for `@request_handler`;
2. Build a handler table by `RequestType`;
3. Traverse generated service descriptors;
4. Find the corresponding method codec for each gRPC method;
5. Validate whether the handler parameters/return annotations match;
6. Dynamically mount the generated servicer.

If a business module for a certain method is not enabled, the server will return `UNIMPLEMENTED`, rather than leaving the client stuck with an inexplicable empty result.

## 7. Server Dispatch: gRPC is Not a Large Thread Pool

The ZMQ implementation already has synchronous handlers, a normal worker pool, and an affinity worker pool. The gRPC implementation continues this semantic, rather than indiscriminately placing all requests into the gRPC server executor.

The metadata on `@request_handler` determines how requests are executed:

| Handler Type | gRPC Dispatch Method | Typical Requests |
|---|---|---|
| `HandlerType.SYNC` | Executed serially with `sync_handler_lock` | Quick control plane operations |
| `HandlerType.BLOCKING` | Handed to the normal pool | `LOOKUP`, `PING`, management-related requests |
| `HandlerType.BLOCKING + requires_client_affinity` | Handed to the affinity pool, and affinity key is taken by client-id | `STORE`, `RETRIEVE`, and other GPU-related requests |

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/server-dispatch-en.svg" aria-label="Open the original gRPC server dispatch diagram">
    <img src="/images/blog/lmcache-grpc-transport/server-dispatch-en.svg" alt="LMCache gRPC server dispatch pools" />
  </a>
  <figcaption>Figure 7: The gRPC server retains the original handler types and client-affinity semantics of LMCache.</figcaption>
</figure>

Client affinity is crucial for `STORE` / `RETRIEVE`. Requests from the same vLLM instance will carry a `lmcache-client-id-bin` metadata, and the server calculates the affinity key based on it, allowing GPU transfer-related requests from the same client to ideally fall onto the same affinity execution path, reducing lock contention and uncertainty in execution order.
## 8. Where the Benefits of gRPC Lie

For users, the most direct benefit is that the configuration and connection semantics are clearer:

- `grpc://host:port` immediately indicates that gRPC is being used;
- On the server side, `--transport grpc` clearly shows that it is listening for gRPC requests;
- If the scheme and server transport do not match, issues are concentrated at the connection stage, rather than failing during the decoding of a payload at runtime.

For maintainers, the benefits are even greater:

1. **Protocols have shifted from implicit lists to explicit schemas.** `StoreRequest`, `LookupRequest`, `P2pLookupAndLockRequest` are defined in proto, allowing field names, tags, and optional/repeated/map attributes to be reviewed during code review.
2. **Shared business handlers across transports.** Both ZMQ and gRPC can discover `@request_handler`, preventing long-term forks where "ZMQ supports one request, but gRPC forgot to bind it."
3. **More issues are validated at startup.** Duplicate services, missing `RequestType`, mismatched handler annotations, and unexpressible structured codecs will fail earlier.
4. **Better suited for external integration.** gRPC/protobuf is easier for other languages, gateways, sidecars, and observability tools to understand compared to custom ZMQ payloads.
5. **Clearer evolution paths.** New services, messages, and fields can follow the mature compatibility rules established by the protobuf community.

However, it is important to clarify the boundaries: gRPC should not be understood as "moving KV tensors faster." In the hot path of LMCache MP, the KV data itself is very large, and actual data movement still relies on mechanisms like CUDA IPC, SHM, NIXL, and engine-driven transfer contexts. The value of gRPC is to make the **request control plane** clearer, more maintainable, and easier to deploy across environments.

## 9. How to Add a New RPC

If you want to add a new request, such as `FOO_BAR`, do not just add a method in the client. The complete process should be as follows:

### 1. Choose the Service

First, determine which protocol domain it belongs to:

- KV registration, store/retrieve: `lmcache_driven_service.proto`
- Engine-driven prepare/commit: `engine_driven_service.proto`
- Prefix lookup / prefetch / session: `lookup_service.proto`
- Management: `controller_service.proto`
- Observability: `observability_service.proto`
- P2P: `p2p_service.proto`
- CacheBlend: `blend_service.proto`

If it is a new business domain, create a new service file instead of stuffing it into an unrelated service.

### 2. Define Request/Response Messages and RPC

Prefer to give each RPC an independent request/response message:

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

Even if the response is temporarily empty, keep a clear response message:

```proto
message FooBarResponse {}
```

This way, if fields need to be added later, it can be extended compatibly.

### 3. Append `RequestType`

In the current version, this step is still necessary. `RequestType` is not just a numeric enum for ZMQ; the gRPC method registry will also use the proto method name to find the corresponding `RequestType`, and then locate the handler metadata through it.

In `protocols/base.py`, append the new enum member to the end, before deprecated aliases. Do not insert in the middle, as the old values of `RequestType` are still part of the ZMQ wire protocol.

LMCache already has frozen wire ID tests to prevent old values from being renumbered.

However, this is a requirement during the dual-stack transition period, not a requirement of gRPC itself. In the future, if the ZMQ path is removed, new RPCs theoretically may not need to add `RequestType` first, but instead allow `package.Service/Method` to directly become the operation identity.

### 4. Add `ProtocolDefinition`

Currently, it is still necessary to declare payload and response Python types in the corresponding `protocols/*.py`:

```python
"FOO_BAR": ProtocolDefinition(
    payload_classes=[str, int | None],
    response_class=bool,
    handler_type=HandlerType.SYNC,
)
```

If the payload is complex with many parameters, it is recommended to define a dataclass or `msgspec.Struct`, allowing the Python side to also have named fields instead of continuing to pile positional payloads.

The value of `ProtocolDefinition` is to clarify the Python semantics: what Python objects the handler should receive, what Python objects it should return, whether this call is synchronous or blocking, and whether client affinity is needed. The gRPC codec will also rely on it at compile time to confirm that proto messages and Python types can be converted to each other.

Once the project enters a gRPC-only state, this layer can be simplified. There are two natural directions:

1. Derive the Python payload/response contract directly from the protobuf descriptor and generated types;
2. Or let the generated gRPC adapter directly bind to the handler, using service/method names for handler annotations instead of `RequestType`.

At that time, the chain of `RequestType -> ProtocolDefinition -> codec -> handler` can be shortened to `proto method -> generated adapter / codec -> handler`. In other words, today's intermediate structure primarily helps LMCache transition smoothly from ZMQ to gRPC and should not be understood as a necessary complexity in the long-term architecture of gRPC.

### 5. Add Business Handler

Add to the module:

```python
@request_handler(RequestType.FOO_BAR, HandlerType.SYNC)
def foo_bar(self, request_id: str, deadline_ms: int | None) -> bool:
    ...
```

The handler parameters and return annotations must match the `ProtocolDefinition`. The gRPC server will validate this during registration.

### 6. Add Explicit Message Codec if Necessary

If your Python types are ordinary dataclasses, `msgspec.Struct`, lists, tuples, dictionaries, or optionals, a structural codec is usually sufficient.

If there are unstructured objects inside, such as device IPC wrappers, special expressions for tensor shapes, dtypes, or opaque handles, you should register an explicit codec in the corresponding domain's `grpc_impl/codecs/*.py`.

### 7. Regenerate Bindings and Add Tests

After modifying the proto, run:

```bash
pip install -r requirements/proto.txt
python -m lmcache.v1.multiprocess.transport.grpc_impl._proto_gen._generate
```

Then, at a minimum, add these tests:

- The method registry can find the new RPC;
- Proto request/response can round-trip to Python types;
- Module handler annotations can pass `validate_handler()`;
- gRPC E2E can pass real client/server calls;
- If the ZMQ path still supports that `RequestType`, validate the old facade as well.
## 10. How to Maintain Compatibility When Adding Messages or Fields

gRPC/protobuf provides a wire-level compatibility foundation, but the current LMCache has two additional layers of complexity: the Python type contract and ZMQ historical compatibility. Once ZMQ is phased out, the ZMQ enum layer can be removed, and the focus of compatibility will shift back to the protobuf wire contract, Python handler contract, and codec contract.

<figure class="diagram-scroll">
  <a class="diagram-scroll__canvas" href="/images/blog/lmcache-grpc-transport/compatibility-rules-en.svg" aria-label="Open the original compatibility rules diagram">
    <img src="/images/blog/lmcache-grpc-transport/compatibility-rules-en.svg" alt="LMCache gRPC Compatibility Rules" />
  </a>
  <figcaption>Figure 8: During the current dual-stack phase, both protobuf wire, Python contract, and ZMQ enum need to be maintained; in the future, after transitioning to gRPC-only, the ZMQ enum layer can be removed.</figcaption>
</figure>

I recommend categorizing compatibility into several types.

### 1. Adding a Service

Adding a service is usually safe because old clients will not call it at all. However, keep in mind:

- The service name must not conflict with existing generated services.
- The filename should remain `*_service.proto`; otherwise, descriptor discovery will not load it.
- During the current dual-stack phase, methods in the new service must still map to `RequestType`.
- If this service is an optional module, it should return `UNIMPLEMENTED` when not enabled, rather than allowing the request to partially succeed.

### 2. Adding an RPC

Adding an RPC is also generally safe, provided that old versions do not need to understand it. For mixed environments:

- A new client calling a new RPC should receive a clear failure if the old server has not implemented it.
- A new server supporting the new RPC should not affect old clients calling the old RPC.
- If you are changing the payload shape of an existing RPC, do not directly modify the old RPC; instead, prioritize adding `FooV2` or a new semantic name.

CacheBlend has a good experience in this area: changes in payload shape mean a new request name, rather than reusing the old `RequestType` and making both sides guess the version.

### 3. Adding a Message Type

Adding a message type itself is not an issue. The key is whether it can map to a Python type:

- For ordinary field collections: prioritize using `dataclass` / `msgspec.Struct` + structural codec.
- If you need to preserve Python subclass identity, opaque handles, or special objects: register an explicit codec.
- When a message is used by multiple services as a common structure, place it in `common.proto`; if it belongs to a single business domain, place it in its own service proto.

Do not simplify by stuffing all special objects into `bytes`. While `bytes` can bypass type issues, it hides semantics, making subsequent compatibility reviews more difficult.

### 4. Adding a Field

This is the most common and easiest scenario to encounter issues.

Recommended rules:

1. **Always use a new field number.** Do not reuse numbers that have already been used, even if they have been deleted.
2. **Use optional whenever possible.** If the semantics of "not sent" and "sent with a default value" differ, you must use `optional` to allow the decoder to receive `None`.
3. **Provide default values on the Python side.** New fields in dataclass should be placed in the default field area to avoid crashes when old payloads or old construction paths lack fields.
4. **Prefer appending fields.** Structural codecs align based on field structure; appending is easier to review than inserting in the middle and aligns better with evolutionary intuition.
5. **Do not change the wire type of existing fields.** Changes like `int64` to `string` or `bytes` to message should use new fields.
6. **Retain deprecated fields.** You can mark fields as deprecated in the proto or provide comments; when truly deleting, use `reserved` for old tags/names to prevent future misuse.

For example, if you want to add an optional trace ID to `IpcCacheServerKey`, a stable approach would be:

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

On the Python side, you should also provide default values:

```python
@dataclass(order=True, frozen=True)
class IPCCacheServerKey:
    ...
    num_kv_readers: int = field(default=0, compare=False)
    trace_id: str | None = field(default=None, compare=False)
```

This way, when the old client does not send `trace_id`, the new server can see `None`; when the new client sends `trace_id` to the old server, the old server will at least ignore the unknown protobuf field, preserving the old semantics.

### 5. Modifying Existing Fields

Such operations should be approached very conservatively.

If you are only changing comments, adding meanings, or relaxing business validations, it is usually acceptable.

However, if you want to change semantics, for example:

- `num_kv_readers=0` originally indicated "not sent," but now you want it to represent a valid value;
- `cache_salt` originally participated in cache identity, but now you want it to serve only as metadata;
- `block_ids` originally arranged by kernel group, but now you want it arranged by object group;

These are not simple field modifications but rather changes in protocol semantics. A more stable approach is to add fields, add messages, or add RPCs while retaining the old semantics for a transition period.
## 11. Why Codecs Also Affect Compatibility

The wire compatibility of protobuf does not equal the end-to-end compatibility of LMCache.

Suppose you add a field in the proto, but the Python dataclass does not have a default value, or the structural codec cannot map the missing field to `None`. In that case, requests from an old client may still fail during the server decode phase.

For example, if you change a Python type from `tuple[bytes, bool]` to a dataclass:

```python
@dataclass
class EventResult:
    event_ipc_handle: bytes
    success: bool
```

The wire may still have the same two fields, but the response type seen by the method registry has changed. You need to ensure that the response encoder/decoder, handler annotation, the ZMQ facade in the dual-stack phase, and the test fixture are all synchronized, not just the proto.

This is also why the LMCache registry initialization requires so many checks: when there is an error at the protocol layer, it is better to fail to start than to let the KV cache be polluted by incorrectly interpreted fields at runtime.

## 12. Code Generation and Dependency Boundaries

The gRPC schema source files are located at:

```text
lmcache/v1/multiprocess/transport/grpc_impl/protos/
```

The generated code is located at:

```text
lmcache/v1/multiprocess/transport/grpc_impl/_proto_gen/
```

The entry point for generation is:

```bash
python -m lmcache.v1.multiprocess.transport.grpc_impl._proto_gen._generate
```

The current build process will generate ignored `*_pb2.py`, `*_pb2_grpc.py`, and `*_pb2.pyi` files during package build, and perform a check to ensure that generated imports do not import the LMCache root. This is crucial: in the PEP 517 build subprocess, if the generator imports `lmcache.__init__` or a runtime dependency to import the generated pb2, it will turn the build environment into a runtime environment, and CI can easily fail in a location unrelated to gRPC itself.

If you encounter:

```text
No generated gRPC services found.
```

during local development, first run:

```bash
pip install -r requirements/proto.txt
python -m lmcache.v1.multiprocess.transport.grpc_impl._proto_gen._generate
```

Then run the relevant tests.

## 13. Recommended Migration Strategy

If you currently have a ZMQ deployment, I recommend migrating as follows:

1. First, upgrade LMCache to a version that includes the gRPC runtime;
2. Keep the existing `--transport zmq` and `tcp://...`, ensuring behavior remains unchanged;
3. In the staging environment, change the server to `--transport grpc`, and vLLM to `grpc://...`;
4. Run a minimal validation: the first request misses, the second identical request hits, and the server log shows that the request transport is gRPC;
5. Then run the actual workload to see if `LOOKUP`, `STORE`, `RETRIEVE`, heartbeat, and restart/recovery all meet expectations;
6. Finally, switch the production environment in batches by instance.

The minimal validation can be approached like this:

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

Then, make the same long prompt request twice and observe whether LMCache cached tokens appear on the second request. This validates end-to-end KV reuse, not just that the "gRPC port can connect."
## 14. Summary

The gRPC support in LMCache does not merely replace "ZMQ with another networking library," but rather advances the MP request protocol from implicit conventions to explicit contracts:

- The application layer only calls `RequestClient`;
- The URL scheme and `--transport` determine the request transport;
- Protobuf describes the wire schema;
- In the current dual-stack phase, `ProtocolDefinition` describes Python semantics;
- The codec registry compiles both together;
- The server still reuses transport-neutral handler metadata and dispatch semantics;
- Compatibility is jointly maintained through protobuf field rules, append-only `RequestType`, handler annotation validation, and E2E testing.

This is also why I recommend enabling gRPC for new deployments whenever possible. It will not replace paths that actually move KV bytes, such as CUDA IPC/SHM, but it will make the control surface of LMCache MP more readable, testable, and easier to evolve. As the protocol surface continues to expand, ZMQ is better suited as a compatibility path, while gRPC is more appropriate as the long-term main path; when ZMQ eventually phases out, intermediate structures like `RequestType` and `ProtocolDefinition`, which bridge old and new transports, can continue to converge, ultimately simplifying the process for adding new RPCs to "modify proto, generate adapter, write handler, add tests."
