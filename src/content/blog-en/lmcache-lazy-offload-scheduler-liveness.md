---
title: "Why Does Step Decide Whether GPU Blocks Can Be Released? LMCache Lazy Offload and vLLM Scheduler Persistence"
description: "Starting from the vLLM Step message pump and the boundaries of Scheduler/Worker/Cache Service, this explains why LMCache PR #4998 only persists in-flight lazy stores, and why the last batch of GPU blocks is delayed in release without it."
publishedAt: 2026-09-08
updatedAt: 2026-09-08
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - kv-cache
  - scheduler
  - lazy-offload
  - distributed-systems
author: "Maobaolong"
readingTime: "16 min"
featured: true
draft: false
---
When looking at [LMCache PR #4998](https://github.com/LMCache/LMCache/pull/4998), it's easy to get stuck on the same question:

> Didn't PR #4434 already call `free_blocks()` after lazy offload completion? Why add `has_pending_push_work()` to let vLLM continue to Step without user requests?

The key issue isn't "whether the release code is written," but rather **who executes the release code and how the completion message reaches it**.

In the LMCache MP lazy offload:

- The Model Worker knows when the asynchronous store is complete;
- The Scheduler owns the vLLM `BlockPool`, and only it can change the reusable state of blocks;
- The completion information from the worker must return to the Scheduler in the next vLLM Step;
- If the Engine does not Step after the last request ends, the completion information will remain on the worker side, and the existing `free_blocks()` in the Scheduler will have no opportunity to execute.

Thus, PR #4998 does not "add a new release method," but rather completes the last driving force of the existing release chain:

```text
worker store completed
      ↓
continue one connector-only Step
      ↓
completion returns to Scheduler
      ↓
Scheduler calls free_blocks()
```

Next, let's connect this causal chain starting from the vLLM Step loop.

## Step is More Than Just a Model Forward

A single vLLM Engine Step does at least three things:

1. The Scheduler checks if there is any work left and selects the current requests, tokens, and KV blocks;
2. The Model Executor executes the model, or only executes the connector control logic when there are zero tokens;
3. The Scheduler consumes `ModelRunnerOutput`, updating the request state and connector state.

Therefore, after integrating the asynchronous KV Connector, the Step also acts as a **message pump**: the Scheduler sends connector metadata to the worker, which then returns the transfer completion back to the Scheduler through its output.

![vLLM Step Scheduling Loop and Connector Message Pump](/images/blog/lmcache-lazy-offload-liveness/vllm-step-loop-en.svg)

The entry point is in `EngineCore.step()`:

```python
if not self.scheduler.has_requests():
    return {}, False

scheduler_output = self.scheduler.schedule(...)
model_output = self.model_executor.execute_model(scheduler_output, ...).result()
self.scheduler.update_from_output(scheduler_output, model_output)
```

In other words, once `Scheduler.has_requests()` returns `False`, the entire chain of `schedule → execute_model → update_from_output` will not occur. [EngineCore.step()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/engine/core.py#L608-L638)

Currently, vLLM uses three types of states to determine whether the Engine continues:

```python
return (
    self.has_unfinished_requests()
    or self.has_finished_requests()
    or self.connector.has_pending_push_work()
)
```

| Keep-Alive Source | Meaning | What Advances in the Next Step |
|---|---|---|
| unfinished requests | There are still requests in waiting/running | Normal scheduling of tokens and forward |
| finished requests | Requests have been fully generated, but connector delayed-free is not complete | Receive transfer completion, complete normal delayed release |
| connector pending push work | There is still connector work outside the request lifecycle | Continue transporting connector completion |

The third item is where PR #4998 is integrated. [Scheduler.has_requests()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/core/sched/scheduler.py#L2641-L2668)

Although its name is `has_pending_push_work()`, the actual issue it expresses here is more general:

> Does the Connector still have work that can only be advanced in the next Engine Step?
## Three Roles, Two Communication Links

“Lazy offload runs in the vLLM process” does not mean “all logic is in the same object.” The LMCache MP Connector involves at least three roles:

- **Scheduler-side connector**: Participates in hit queries, request lifecycle, block allocation reporting, and lazy offload state management;
- **Worker-side connector**: Directly interacts with KV tensors, submits store/retrieve, and polls asynchronous futures;
- **LMCache Server / Cache Service**: Provides cross-process caching services and session/control capabilities.

The Cache Service does not only communicate with the Model Worker. The Scheduler side exchanges control information such as lookup, lock/session, and allocation telemetry with it through `scheduler_adapter`; the Worker side transmits KV data via `worker_adapter`. Meanwhile, worker completion is not directly modified by the Cache Service to the Scheduler, but is returned through vLLM's `ModelRunnerOutput`.

![Control and data planes of Scheduler, Model Worker, and LMCache Server](/images/blog/lmcache-lazy-offload-liveness/role-boundaries-en.svg)

This diagram shows two different chains:

```text
LMCache control plane: Scheduler-side connector ↔ Cache Service
KV data plane:         Model Worker ↔ Cache Service
vLLM internal chain:   Scheduler → SchedulerOutput → Worker
                       Worker → ModelRunnerOutput → Scheduler
```

They cannot replace each other. The Cache Service can confirm that the store RPC is complete, and the Worker can mark it as completed, but only the Scheduler can change its maintained `BlockPool` references and allocatable status.

Corresponding to key states:

| State                     | Location                | Meaning                                               |
|---------------------------|-------------------------|-------------------------------------------------------|
| `BlockPool`               | vLLM Scheduler          | Whether the block still has references and can be reallocated |
| FIFO pending metadata      | Scheduler-side connector | Planned for future offload, but not yet sent to worker |
| `_request_block_ids`      | Scheduler-side connector | Stores that have been submitted; these blocks are waiting to be released after completion |
| store futures             | Worker-side adapter     | Asynchronous transfers sent to Cache Service          |
| `completed_store_requests` | Worker-side adapter     | Requests that have been completed and are waiting to be reported with vLLM output |

This is why “the Worker completes lazy offload by itself” does not automatically imply “GPU blocks are already free.” It only indicates that the data plane is complete; the Scheduler must also consume this fact.
## Why Ordinary Offload Does Not Need This PR

The ordinary non-lazy path uses the vLLM native delayed-free protocol.

At the end of a request, the connector's `request_finished()` returns `True`, which means:

> This request is still being sent asynchronously; please do not release its blocks yet; wait until `get_finished()` returns the request ID before releasing.

Although the request is no longer generating tokens, it remains in the Scheduler's request bookkeeping. Therefore, `has_finished_requests()` can see it, and the Engine will continue to Step:

```text
request_finished() → True
        ↓
vLLM retains finished request and blocks
        ↓
has_finished_requests() → True
        ↓
Continue Step, polling get_finished()
        ↓
vLLM completes delayed-free
```

The ordinary path already has its own liveliness signal, so there is no need for LMCache to redundantly maintain liveliness with `has_pending_push_work()`.

## Why Lazy Offload Is Separate from Ordinary Delayed-Free

[PR #4434](https://github.com/LMCache/LMCache/pull/4434) introduced lazy offload to first accumulate store metadata on the Scheduler side and then select completed requests in batches according to policy, rather than submitting the store immediately for every small segment of KV produced.

This divides a lazy store into two phases:

![Lazy offload from queued to in-flight to freed](/images/blog/lmcache-lazy-offload-liveness/pending-state-machine-en.svg)

### Queued: Planned to store but not yet submitted

The store metadata generated by normal token Steps first enters FIFO. When the request ends, the lazy path calls `mark_req_finished()`, then returns `False` from `request_finished()`:

```python
if self.lazy_offload:
    self._pending_store.mark_req_finished(request.request_id)
    return False, ...
```

Here, `False` is telling vLLM: **Do not keep this request in the ordinary delayed-free lifecycle**. The original blocks of the request can still enter the vLLM caching/reuse process as usual; the old block hash is saved in FIFO, waiting to verify the content for future actual store selection.

At this stage, there is only "pending metadata"; the worker has not yet received the store, so there is naturally no completion to collect.

### In-flight: Already submitted, waiting for completion acknowledgment

When the FIFO strategy allows offload, and a round of model tokens is actually scheduled, the Scheduler-side connector will:

1. Take the request from FIFO;
2. `BlockPool.touch()`, increasing the reference count for the blocks to be transmitted;
3. Re-compare block hashes to confirm that the content has not been overwritten;
4. Hand over the STORE metadata to the worker;
5. Write the block IDs into `_request_block_ids`.

From this moment on, the store is in-flight, and the blocks have been pinned due to this asynchronous transfer. They must wait for the completion from all workers to return to the Scheduler before they can be unpinned. [Lazy store submission path](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1479-L1517)

The release code on the Scheduler side already exists:

```python
for req_id, count in meta.completed_store_requests.items():
    if self.scheduler_adapter.update_pending_store_count(req_id, count):
        gpu_block_ids = self._pending_store.get_request_gpu_block_ids(req_id)
        self._gpu_block_pool.free_blocks(...)
        self._pending_store.remove_request_gpu_block_ids(req_id)
```

So what is missing is not `free_blocks()`, but **who guarantees that this code can still be called once after the last user request disappears**. [Scheduler-side completion handling](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1237-L1248)
## The Issue Only Occurs in a Narrow Window

Assume request A has been selected for lazy offload, and request B is the last request still being generated in the system:

1. The Scheduler `touch()`es A's blocks and sends STORE metadata to the worker;
2. The Worker asynchronously writes A to the Cache Service;
3. B ends before A's store completion returns;
4. At this point, the Scheduler has no waiting, running, or normally delayed-free requests;
5. If the connector also reports no pending work, `has_requests()` becomes `False`;
6. The Worker subsequently completes A, but the Engine has already stopped the Step;
7. The completion remains with the worker, and the Scheduler's `_request_block_ids[A]` and block references are not cleared.

![Difference between having and not having connector keepalive when the last request ends](/images/blog/lmcache-lazy-offload-liveness/idle-gap-timeline-en.svg)

This is why it commonly occurs at the end of testing, during bursts of traffic, or when the service enters an idle state, rather than during sustained full load. As long as there are other requests pushing the Step, the completion always has a chance to return.

If the service has no further requests, the logical block temporarily not being returned usually has no user-visible impact; KV cache tensors often reside entirely on the GPU, and `free_blocks()` mainly returns reusable eligibility to the vLLM allocator, rather than immediately returning the corresponding VRAM to the CUDA driver.

The real impact occurs when the next batch of requests arrives. Without this idle wrap-up, the Scheduler may first allocate based on a smaller available BlockPool, only to receive old completions at the end of this round:

```text
New request arrives
    ↓
Scheduler attempts to allocate (old blocks are still pinned)
    ↓
Space sufficient: proceed as usual, but this round's capacity is small
Space insufficient: wait / preempt / run a no-forward round first
    ↓
Old completion returns, free_blocks()
    ↓
Next round sees full available capacity
```

Therefore, this is not a typical "VRAM continuously grows until OOM," nor is it a permanent deadlock in the worker store; a more accurate description is: **The control wrap-up of the previous batch of requests is dragged into the next burst of traffic, causing the first scheduling cycle of the new burst to see outdated block availability.**

## PR #4998 Keeps Alive Only for Advancing States

The corrected PR uses `_request_block_ids` to determine if there are any in-flight stores:

```python
def has_inflight_store_work(self) -> bool:
    return bool(self._request_block_ids)
```

The connector only returns this when in the Scheduler role and lazy offload is enabled:

```python
def has_pending_push_work(self) -> bool:
    if self.role != KVConnectorRole.SCHEDULER or not self.lazy_offload:
        return False

    pending_store = getattr(self, "_pending_store", None)
    return (
        pending_store is not None
        and pending_store.has_inflight_store_work()
    )
```

[Implementation of keepalive in PR #4998](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1319-L1333)

Thus, the in-flight path can naturally converge:

```text
_request_block_ids is non-empty
        ↓
has_pending_push_work() = True
        ↓
Scheduler.has_requests() = True
        ↓
Execute zero token connector-only Step
        ↓
worker completion returns with ModelRunnerOutput
        ↓
update_connector_output() → free_blocks()
        ↓
Delete _request_block_ids
        ↓
has_pending_push_work() = False, Engine safely idle
```

It must be emphasized that "able to advance" is crucial. The zero token Step can poll for the completion of submitted stores, but currently cannot pass queued metadata that has not yet been submitted to the worker. LMCache only calls the lazy store submission process when `scheduler_output.total_num_scheduled_tokens > 0`, as the vLLM no-forward connector path cannot reliably handle these store operations. [Conditions for positive token submission](https://github.com/LMCache/LMCache/blob/b042d909d929ef045eae6a7e7593df7e58b0542b/lmcache/integration/vllm/lmcache_mp_connector.py#L1471-L1477)

Thus, the PR explicitly does not count queued-only as part of the keepalive:

| State | `has_pending_push_work()` | Reason |
|---|---:|---|
| Only FIFO queued metadata | `False` | Empty Step cannot submit, keepalive will not advance; wait for the next positive token Step |
| `_request_block_ids` is non-empty | `True` | Empty Step can receive completion and free blocks |
| Completion has been consumed by Scheduler | `False` | Lifecycle has closed, can idle |
| Non-lazy mode | `False` | Maintained by vLLM's regular delayed-free keepalive |

This is an important scheduling principle:

> Keepalive signals cannot merely indicate "there's still something"; they must indicate "execute another round, and the state has a chance to advance."

Active draining of queued-only can be designed separately in the future, such as allowing connector-only Steps to truly support store submissions, adding explicit wake-up events, or adopting an independent background progress mechanism. But until these capabilities exist, not keeping it alive is safer than endlessly spinning without progress.
## Compressing the Whole Matter into One Sentence

PR #4434 has completed the `free_blocks()` on the Scheduler side, and PR #4998 addresses the final Step required to reach this line of code.

The worker completing the store is merely a fact on the data side; the lifecycle truly ends only when completion is returned to the Scheduler via vLLM output. The corrected implementation only keeps the in-flight store alive, as a zero token Step allows it to transition from "waiting for completion" to "released"; queued-only is currently reserved for the next Step with model tokens, avoiding the need to force the Engine to idle with a signal that cannot advance.

## References

- [LMCache PR #4998: Add pending push work hook for MP lazy offload](https://github.com/LMCache/LMCache/pull/4998)
- [LMCache PR #4434: Support lazy offload](https://github.com/LMCache/LMCache/pull/4434)
- [vLLM PR #35264: Introduce has_pending_push_work](https://github.com/vllm-project/vllm/pull/35264)
- [vLLM PR #43433: Scheduler keep-alive for delayed KV connector cleanup](https://github.com/vllm-project/vllm/pull/43433)
- [vLLM EngineCore.step()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/engine/core.py#L608-L638)
- [vLLM Scheduler.has_requests()](https://github.com/vllm-project/vllm/blob/eb6b619ab256df1100cb75684a9ba78485506c3a/vllm/v1/core/sched/scheduler.py#L2641-L2668)
