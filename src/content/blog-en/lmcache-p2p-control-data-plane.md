---
title: "LMCache P2P from First Principles: Control Plane, Data Plane, Connections, Reads, and Authentication"
description: "An animated walkthrough of LMCache multiprocess P2P: registration, peer discovery, the NIXL handshake, lookup and locking, address exchange, direct KV reads, unlock, and the exact boundaries that do or do not need authentication."
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
author: Maobaolong
readingTime: 30 min
featured: true
draft: false
---

At first glance, P2P sounds simple: connect two LMCache servers and copy KV Cache between them.

The code quickly raises harder questions. Who discovers whom? Does the Coordinator move data? Why are ZMQ or gRPC and NIXL both involved? Does lookup return KV bytes or addresses? Why must a hit be locked? Can one peer write another peer's cache? If authentication is added, which messages need credentials—and should every DMA page carry a token?

This article starts from zero and follows only the P2P read path in LMCache multiprocess mode. The source baseline is the LMCache `dev` snapshot [`cf87a1ca`][snapshot] from November 6, 2026, so every stage maps to concrete code. This is an architecture and defensive-design guide; it does not discuss unpublished security reports or attack proof-of-concepts.

<section class="p2p-hero" aria-labelledby="p2p-hero-title">
  <p class="p2p-kicker">LMCache P2P · visual field guide</p>
  <h2 id="p2p-hero-title">First ask who decides what to read. Then ask who moves the bytes.</h2>
  <p class="p2p-hero__lede">P2P is not one connection. It overlays three logical channels: the Coordinator supplies a directory, ZMQ or gRPC coordinates lookups and locks, and NIXL moves the actual KV payload. Once separated, the flow becomes much easier to reason about.</p>
  <div class="p2p-hero__lanes" aria-label="Three logical channels">
    <span class="p2p-lane p2p-lane--directory"><i></i>Directory: who is where</span>
    <span class="p2p-lane p2p-lane--control"><i></i>Control: which keys may be read</span>
    <span class="p2p-lane p2p-lane--data"><i></i>Data: where KV bytes move</span>
  </div>
</section>

<nav class="p2p-toc" aria-label="Article contents">
  <a href="#p2p-model">1. Build the mental model</a>
  <a href="#p2p-startup">2. Start, register, discover</a>
  <a href="#p2p-read">3. One complete read</a>
  <a href="#p2p-write">4. What the write path does</a>
  <a href="#p2p-failure">5. Misses, timeouts, cleanup</a>
  <a href="#p2p-auth">6. Draw the auth boundary</a>
  <a href="#p2p-fix">7. Implement authentication</a>
  <a href="#p2p-source-map">8. Source map and checklist</a>
</nav>

<h2 id="p2p-model">1. Build the mental model</h2>

### 1.1 Think of two cache warehouses

Suppose Node B already has the required KV in its DRAM L1, while Node A does not. A must do four things:

1. find B's control endpoint and transfer endpoint;
2. ask B whether specific ObjectKeys exist and lock the hits;
3. obtain each hit's `(offset, size)` inside B's registered shared-memory region;
4. ask NIXL to read those bytes into local L1 objects that A has already prepared, then tell B to unlock.

The Coordinator is a directory. ZMQ or gRPC is the dispatch phone. NIXL is the forklift. **The forklift does not decide which crate to move, and the dispatch phone does not carry the crate.**

<div class="p2p-glossary">
  <div class="p2p-term" style="--accent: var(--p2p-directory)"><b>Coordinator</b><p>Stores active instance IPs, RPC ports, and P2P advertise URLs. It assists discovery but does not enter the KV payload path.</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-control)"><b>P2PController</b><p>Serves lookup/query/unlock handlers while polling the directory and reconciling a local adapter per peer.</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-control)"><b>P2PL2Adapter</b><p>Makes Node B look like a read-only remote L2 to Node A and owns its RPC client, NIXL client, tasks, and address state.</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-data)"><b>TransferChannelAddress</b><p>An `offset + size` relative to a registered L1 region—not a raw process pointer.</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-data)"><b>NIXL handle</b><p>A prepared handle for imported remote memory descriptors. It is reused across reads rather than rebuilt for every key.</p></div>
  <div class="p2p-term" style="--accent: var(--p2p-data)"><b>Read lock</b><p>Keeps B from evicting or reusing a hit after its address is returned but before A finishes reading.</p></div>
</div>

### 1.2 Three logical channels do not mean three copies of KV

<div class="p2p-split">
  <section class="p2p-plane-card p2p-plane-card--directory"><h3>Directory / orchestration</h3><p>HTTP registration, heartbeats, and `GET /instances`. Messages contain instance metadata and tolerate retries and eventual consistency.</p></section>
  <section class="p2p-plane-card"><h3>Control plane</h3><p>ZMQ or gRPC carries `p2p_lookup_and_lock`, `p2p_query_lookup_results`, and `p2p_unlock_objects`. Messages are small, but they decide what may be read.</p></section>
  <section class="p2p-plane-card p2p-plane-card--data"><h3>Data plane</h3><p>NIXL/UCX issues READ transfers using prepared memory descriptors. This is the large KV payload and therefore bypasses the Coordinator and normal RPC serialization.</p></section>
  <section class="p2p-plane-card"><h3>Local execution</h3><p>StorageManager looks up keys, holds read locks, maps MemoryObj to offsets, and polls completion. These are in-process calls, not network protocols.</p></section>
</div>

<div class="p2p-callout"><p><strong>A useful classification rule:</strong> messages containing keys, task IDs, status, offsets, and sizes are control plane. The path carrying actual K/V tensor bytes is the data plane.</p></div>

<h2 id="p2p-startup">2. Startup, registration, and discovery</h2>

### 2.1 Each node first turns local L1 into a remotely readable region

P2P is enabled when `--p2p-advertise-url` is configured. During startup, `P2PController` locates the one local DRAM L1, obtains `L1MemoryDesc(ptr, size, align_bytes)`, and initializes the transfer-channel context.[Initialization][controller-start]

The current NIXL implementation then:

1. creates a NIXL agent;
2. registers the whole local DRAM L1 as transferable memory;
3. prepares page-granular transfer descriptors using `align_bytes`;
4. starts a dedicated ZMQ REP handshake server on the P2P transfer URL.[NIXL context][nixl-context]

That ZMQ REP socket is not the LMCache request transport. Even when the main RPC transport is gRPC, the current NIXL metadata handshake still owns a separate ZMQ socket. It exchanges NIXL metadata; it does not carry business lookup RPCs.

### 2.2 Registration publishes addresses, not a live connection

The MP server registers `instance_id`, reachable IP, HTTP port, `p2p_advertised_url`, the request/RPC port, and chunk size with the Coordinator.[Registrar][registrar]

Registration says “this is where future peers can find me.” It does not connect A to B, and it never uploads KV. Heartbeats keep the entry alive; an explicit 404 causes re-registration.

### 2.3 Discovery creates an adapter and two clients

`P2PController` periodically fetches `/instances`. It only becomes `REGISTERED` after it can see its own matching entry. For each other valid peer, it creates `P2PL2AdapterConfig` with:

- `peer_mq_server_url`, whose scheme follows the selected request transport;
- `peer_transfer_channel_server_url`, used by the NIXL handshake/data path;
- lookup and load timeouts.

The adapter constructor then creates a ZMQ or gRPC request client and obtains a transfer-channel client. The latter actively connects to the peer, performs the NIXL handshake, and caches a remote handle.[Adapter registration][adapter-register]

The NIXL handshake has two stages: exchange agent metadata, then exchange transfer descriptor lists. Both peers may connect at the same time, so the context keeps one canonical client per advertise URL and closes duplicates.

<figure class="p2p-stage" data-p2p-stage data-lang="en">
  <figcaption>Loading the interactive walkthrough. Without JavaScript, the order is register → discover → NIXL handshake → lookup/lock → address result → NIXL READ → unlock.</figcaption>
</figure>

<h2 id="p2p-read">3. One complete read: from ObjectKey to KV bytes</h2>

### 3.1 `lookup_and_lock`: ask whether it exists and reserve it

Node A's storage manager treats Node B as a remote L2 and calls `submit_lookup_and_lock_task(keys, group_layout_descs)`. The adapter sends:

```text
p2p_lookup_and_lock(
  keys = [ObjectKey(...), ...],
  group_layout_descs = {object_group_id: MemoryLayoutDesc(...)}
)
```

B does not search its own L2 or fetch from disk on A's behalf. The current handler is restricted to the local DRAM L1. Hits are placed under read reservation, and B returns an integer task ID.[Lookup handler][lookup-handler]

The extra query phase follows StorageManager's asynchronous prefetch contract. It leaves room for future implementations even when today's local-L1 lookup usually completes quickly.

### 3.2 `query_lookup_results`: return coordinates, not data

A polls with the remote task ID:

```text
p2p_query_lookup_results(task_id) ->
  [TransferChannelAddress(offset, size), ...] | None
```

`None` means not complete yet or already consumed. A miss is represented by `offset=-1, size=0`. For hits, B obtains the locked objects' shared-memory positions and converts them into offsets relative to the whole registered L1.[Address construction][build-addresses]

### 3.3 `submit_read`: this is where KV payload finally moves

A has already allocated local `MemoryObj` destinations. It converts their `(shm_offset, shm_byte_length)` pairs to local transfer addresses and combines them with the remote addresses from B:

```text
NIXL submit_read(
  local_addresses  = destinations in A's L1,
  remote_addresses = hits in B's L1,
)
```

NIXL translates addresses to page indices, prepares a READ, and submits it. A polls `query_read_status`; only `DONE` sets the corresponding success bits.[Load path][adapter-load]

<figure class="p2p-memory-lab">
  <figcaption><strong>The actual data plane.</strong> The hit pages in B are locked while NIXL writes the KV bytes into A's local destination pages. The Coordinator and business RPC are absent from this payload path.</figcaption>
  <div class="p2p-memory-lab__grid">
    <div class="p2p-memory"><strong>Node A · destination L1</strong><div class="p2p-memory__pages"><i class="p2p-page"></i><i class="p2p-page is-read"></i><i class="p2p-page is-read"></i><i class="p2p-page"></i></div></div>
    <div class="p2p-memory-lab__arrow" aria-hidden="true">←</div>
    <div class="p2p-memory"><strong>Node B · registered L1</strong><div class="p2p-memory__pages"><i class="p2p-page has-kv"></i><i class="p2p-page has-kv is-read"></i><i class="p2p-page has-kv is-read"></i><i class="p2p-page"></i></div></div>
  </div>
</figure>

### 3.4 `unlock`: return the reservation after reading

After completion or abandonment, A sends `p2p_unlock_objects(keys)`. B calls `finish_read_prefetched(keys)` to release the read reservations, while A drops its cached remote addresses for those keys.

This is essential. An offset only identifies an object during a valid lifetime. After unlock, eviction or reuse may place different bytes at the same offset.

<h2 id="p2p-write">4. What the write path actually does</h2>

The current LMCache P2P adapter is not a general remote-memory read/write API.

`P2PL2Adapter.submit_store_task` sends nothing to the peer. It immediately records `L2StoreResult(success=True, bytes_stored=0)` so the generic store controller can finish its bookkeeping.[Read-only store path][adapter-store]

The two flows are therefore:

```text
Normal local STORE / inference
  engine worker → local LMCache server → local L1

P2P remote reuse
  Node A looks up Node B → NIXL READ → Node A local L1
```

P2P pulls an existing remote cache into the requester's local L1. It does not push every new local KV object to all peers.

<div class="p2p-callout p2p-callout--data"><p><strong>Direction in precise terms:</strong> A performs a remote read. Bytes flow out of B's memory and into A's memory. NIXL calls the operation READ because the requester reads a remote region.</p></div>

<h2 id="p2p-failure">5. Misses, timeouts, and cleanup</h2>

<div class="p2p-sequence">
  <div><section><strong>The directory is temporarily unreachable</strong><p>A timeout moves orchestration to DISCONNECTED; other HTTP or schema errors lead to UNREGISTERED and reconciliation. The MP server itself stays up.</p></section></div>
  <div><section><strong>A peer disappears from discovery</strong><p>The adapter is not deleted after one missing poll. The current controller tolerates three consecutive misses, reducing reconnect churn during directory blips.</p></section></div>
  <div><section><strong>The lookup RPC times out</strong><p>The adapter treats it as a cache miss so upper layers can try another tier or recompute instead of blocking forever.</p></section></div>
  <div><section><strong>NIXL load times out or errors</strong><p>The success bitmap stays false. A control-plane hit does not guarantee a successful data-plane transfer.</p></section></div>
  <div><section><strong>The requester abandons query or unlock</strong><p>B eventually drops old lookup jobs. Read reservations mainly rely on L1 read TTL because a blind late unlock could release a newer reader's lock.</p></section></div>
</div>

<h2 id="p2p-auth">6. Where authentication belongs</h2>

Two terms matter:

- **Authentication** establishes who the caller is, or at least that it possesses a trusted credential.
- **Authorization** determines which objects and addresses that authenticated identity may access.

The immediate P2P boundary is to stop unauthenticated network peers from using control RPCs or importing a transfer region. Whether one authenticated peer should be able to address an entire region is a stronger least-privilege problem that an API key alone cannot solve.

<section class="p2p-auth-map" data-p2p-auth-map>
  <div class="p2p-auth-map__toolbar" aria-label="Filter authentication boundaries">
    <button type="button" data-auth-filter="all" aria-pressed="true">All boundaries</button>
    <button type="button" data-auth-filter="required" aria-pressed="false">Authenticate every entry</button>
    <button type="button" data-auth-filter="session" aria-pressed="false">Authenticate at setup</button>
    <button type="button" data-auth-filter="local" aria-pressed="false">No network identity needed</button>
  </div>
  <div class="p2p-auth-grid">
    <article class="p2p-auth-boundary" data-auth="required"><strong>① P2P startup configuration</strong><p>Fail closed when P2P is enabled without credentials. Optional auth otherwise leaves the default P2P deployment anonymous.</p></article>
    <article class="p2p-auth-boundary" data-auth="required"><strong>② Coordinator registration and discovery</strong><p>Authenticate writers and readers of the peer directory to prevent forged instances, endpoint poisoning, and metadata disclosure.</p></article>
    <article class="p2p-auth-boundary" data-auth="required"><strong>③ ZMQ / gRPC control RPC</strong><p>Authenticate lookup, query, and unlock before business payload decoding and handler dispatch. Invalid keys must not touch state.</p></article>
    <article class="p2p-auth-boundary" data-auth="required"><strong>④ NIXL handshake</strong><p>Authenticate before returning agent metadata or transfer descriptors and before registering the client. Descriptors are the capability entry point.</p></article>
    <article class="p2p-auth-boundary" data-auth="session"><strong>⑤ NIXL READ</strong><p>Each DMA page need not carry another Bearer token. The read uses the session/handle established by an authenticated handshake; credential revocation must tear down sessions.</p></article>
    <article class="p2p-auth-boundary" data-auth="local"><strong>⑥ Local lookup and address conversion</strong><p>In-process calls need locks, ownership, bounds, and alignment validation—not a user token threaded through every helper.</p></article>
  </div>
</section>

### 6.1 Why both control RPC and the NIXL handshake must authenticate

Protecting only control RPC is insufficient. A network peer that knows the transfer endpoint can still attempt the independent NIXL handshake. If complete region descriptors are returned before authentication, the control plane is guarded but the data-plane capability is not.

Protecting only the NIXL handshake is also insufficient. An anonymous caller could still create lookup jobs, hold read locks, enumerate hits and misses, consume results, or issue unlock calls.

The proper ordering is:

```text
Network entry A: request transport
  authenticate → decode RPC payload → dispatch handler

Network entry B: transfer-channel handshake
  decode a bounded auth envelope → authenticate
  → add remote agent / deserialize descriptors / return local descriptors
```

### 6.2 Why local helpers do not all need token parameters

`StorageManager.query_prefetch_status`, `unsafe_read`, `addresses_to_indices`, and `query_read_status` operate after entering a trusted process/object boundary. Threading a token through them does not strengthen network identity. It spreads secrets into more APIs and logs.

Authenticate at the network edge, bind the resulting principal or session to the objects it owns, and keep using local type, lock, bounds, and lifetime invariants inside the process.

### 6.3 Authentication is not encryption

A Bearer token proves knowledge of a shared secret. Plain ZMQ, insecure gRPC, and NIXL do not become encrypted because a token is present. Crossing an untrusted network still requires TLS, mTLS, CURVE, IPsec, or a controlled encrypted tunnel.

A stronger handshake can use a nonce and HMAC to avoid repeatedly transmitting the raw key and to bind both agent identities, endpoints, and protocol versions into the transcript. KV payload encryption remains a separate property.

<div class="p2p-callout p2p-callout--warning"><p><strong>State the authorization limit honestly:</strong> the current NIXL context registers the whole L1 region. Authentication excludes strangers. If authenticated nodes are mutually untrusted, object-scoped or capability-scoped descriptors are required as well.</p></div>

<h2 id="p2p-fix">7. A practical implementation order</h2>

Start with a testable invariant:

> With P2P enabled, only a peer holding a current credential may invoke P2P RPCs, obtain transfer descriptors, and construct a remote-memory handle. Unauthenticated input fails before business payload decoding, handler dispatch, and NIXL metadata operations.

Then implement in this order:

1. **Fail closed at configuration time.** Reject P2P without credentials, or require an explicit, loudly warned `allow-unauthenticated-p2p` escape hatch.
2. **Reuse one key loader and verifier.** Accept multiple inbound keys for rotation, choose one outbound client key, and redact secrets from representations, status, and environment output.
3. **Protect request transports.** Use a versioned auth frame for ZMQ and metadata interceptors for gRPC; authenticate before decoding business payloads.
4. **Protect the NIXL handshake.** Authenticate `InitReq` before returning agent metadata, then bind `MemRegReq` to the same identity/session.
5. **Protect Coordinator HTTP.** Add credentials to registration, heartbeats, and `/instances`; decide explicitly whether directory and peer credentials share a trust domain.
6. **Define rotation and revocation.** Existing prepared handles do not disappear when a key file changes. Restart or proactively tear down transfer clients.
7. **Add observability.** Distinguish authentication failure, lookup miss, RPC timeout, and transfer error instead of collapsing everything into a cache miss.

| Scenario | Expected control-plane result | Expected data-plane result |
|---|---|---|
| Correct key | lookup/query/unlock succeed | handshake and NIXL READ succeed |
| Missing key | rejected before decode/dispatch | no agent metadata or descriptors returned |
| Wrong key | explicit UNAUTHENTICATED/PermissionError | no remote handle created |
| Malformed auth | bounded, fast failure with no secret leakage | no NIXL metadata parsing |
| Key rotation | old/new accepted inbound, one sent outbound | new connections work; old-session lifetime is explicit |
| P2P with no key | startup fails or requires explicit insecure opt-in | never opens silently |
| Authenticated hit | correct task and addresses | populated L1 bytes copy correctly |
| Authenticated miss | invalid address | no read is submitted |

<h2 id="p2p-source-map">8. Source map and final checklist</h2>

Read from the business flow downward:

1. [`P2PController`][controller] initializes the transfer context, polls `/instances`, maintains adapters, and implements the three P2P RPC handlers.
2. [`P2PL2Adapter`][adapter] performs requester-side lookup, caches remote addresses, submits NIXL reads, and unlocks.
3. [`nixl_impl.py`][nixl] owns agents, whole-L1 registration, the two-stage handshake, page-index translation, and transfer handles.
4. [`registrar.py`][registrar] registers and heartbeats an MP server with the Coordinator.
5. [`transfer_channel/api.py`][tc-api] defines the small address and read-result model.

Five questions test whether the model is clear:

- Must an in-flight NIXL read pass through the Coordinator? **No.**
- Does `query_lookup_results` return KV? **No, only offsets and sizes.**
- Does replacing ZMQ with gRPC move KV bytes through gRPC? **No.**
- Does the P2P adapter write A's KV into B? **Not today; it is read-only.**
- Is adding an API key only to lookup RPC sufficient? **No; the NIXL handshake must authenticate before disclosing descriptors.**

In one sentence:

> The Coordinator lets A find B; control RPC tells A which objects it may read and where they live; NIXL uses an imported remote-memory capability to copy those bytes into A; unlock ends the temporary reservation.

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
