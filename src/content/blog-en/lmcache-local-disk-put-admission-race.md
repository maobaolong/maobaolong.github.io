---
title: "Concurrency State Machines from LMCache PR #4660: Why Atomic Operations Are Still Not Enough"
description: "Through a review of a LocalDiskBackend disk write, analyze duplicate submissions, capacity pre-checks, failure rollbacks, and resident/in-flight handover races, as well as how to validate fixes with deterministic testing."
publishedAt: 2026-09-03
updatedAt: 2026-09-03
category: "AI Infra"
tags:
  - lmcache
  - concurrency
  - storage
  - code-review
  - testing
  - kv-cache
author: "Maobaolong"
readingTime: "13 min"
featured: true
draft: false
---
Recently, I reviewed [LMCache PR #4660](https://github.com/LMCache/LMCache/pull/4660). This PR addresses the disk write admission issue in `LocalDiskBackend`: the same key may be submitted multiple times; when capacity is insufficient, failed tasks may remain in the in-flight collection indefinitely; the system might even delete some valid cache entries before realizing that the new object cannot fit.

The author's first version of the fix covered most of these issues, but there remains a narrow state transition window between "asynchronous write completion" and "next submission start." This window does not cause an immediate crash, but it may lead to repeated disk writes, repeated increases in capacity counts, and incorrect eviction of other caches when the disk approaches its limit.

This article not only documents which lock was added last but also aims to illustrate a general method for concurrent review:

> A single operation being atomic does not imply that business invariants across multiple state containers are also atomic.

## First, Connect the Real Execution Path

A KV Cache store ultimately enters the disk backend along the following path:

```text
LMCacheEngine.store()
    ↓
StorageManager.batched_put()
    ↓
LocalDiskBackend.batched_submit_put_task()
    ↓
LocalDiskBackend.submit_put_task()
    ↓
LocalDiskWorker executes async_save_bytes_to_disk()
```

The front-end `submit_put_task()` is only responsible for determining whether it can accept tasks, reserving capacity, and submitting work to the background thread. The actual file writing is completed asynchronously, so even if the front-end store requests arrive sequentially, the next submission may still overlap with the completion process of the last background write.

This is the foundation for the current issue: it does not require two front-end threads to be called simultaneously; the front-end submission thread and the background disk thread already constitute concurrency.

## A Key Exists Simultaneously in Three State Systems

To understand this code, it is essential to distinguish three structures:

- `self.dict`: resident keys that have been written to disk and can be read;
- `disk_worker.put_tasks`: in-flight keys that have been received but whose background writing has not yet completed;
- `current_cache_size`: the capacity already reserved for resident or in-flight writes.

A new key typically undergoes the following state transitions:

![LocalDiskBackend put state machine](/images/blog/lmcache-local-disk-put-admission/put-state-machine-en.svg)

There is an easily overlooked but valid transitional state: when the background write completes, [the code first calls `insert_key()`, then deletes the put marker](https://github.com/LMCache/LMCache/blob/a3765d8dd4d5f9a2372d8ae6e42402bf8f063953/lmcache/v1/storage_backend/local_disk_backend.py#L714-L716). Thus, for a short time, the same key may appear in both `self.dict` and `put_tasks`.

This "dual existence" is not problematic in itself. It ensures that when the key is visible to readers, other write submissions can still see the old task's marker. The true invariants are:

1. A resident key cannot enter a new write task again;
2. There can be at most one valid in-flight write for the same key;
3. Only submissions with markers can delete this marker in case of failure;
4. The capacity count can only increase once for a successful admission.
## Original Bug: Admission Result Unknown, Side Effects Already Occurred

[Issue #4659](https://github.com/LMCache/LMCache/issues/4659) outlines three related defects in the original implementation.

### 1. Check and Insert Are Separate, Duplicate Tasks Can Enter Simultaneously

The original logic first calls `exists_in_put_tasks(key)`, and then calls `insert_put_task(key)`. Although both operations add `put_lock`, there is a gap in between: both submissions may see "not exist" first and then insert independently.

This is a typical check-then-act race. The correct abstraction should be a `try_insert_put_task()`: completing "check and insert" within the same lock-holding process, with the return value indicating whether this call acquired ownership of the marker.

### 2. Marker Not Cleared After Admission Failure

The old code placed the key into `put_tasks` before checking capacity. If all resident entries are pinned and there are no evictable objects, the function will return directly without deleting the marker.

As a result, this key will be permanently considered "still being written":

```text
First submission K
  → Register marker
  → Capacity admission failed
  → Marker leak

Retry K after capacity release
  → Discover old marker
  → Always skip
```

### 3. Evict First, Only to Find It Still Won't Fit

The old eviction loop selects a candidate key each time, deletes it, and then checks if there is enough space. If the new object is larger than the entire disk cache budget, the system may delete all valid resident entries, yet still refuse the new object.

Similar issues can occur in scenarios where some entries are pinned. For example, if the cache limit is 100, with 80 being non-evictable and 20 being evictable, and the new object requires 60. Even if the 20 are deleted, there is still not enough space.

Therefore, admission must first perform a side-effect-free capacity pre-check: tally the total size of all `metadata.can_evict` objects, and only after confirming it is sufficient, allow the eviction policy to truly select and delete objects.

One cannot directly call `get_evict_candidates()` just to "preview who the candidates are." Strategies like LFU modify their frequency buckets when selecting candidates; a failed probe also requires complex rollback. Simply tallying evictable bytes without changing policy state is, in fact, safer.

## First Version Fix: Single Collection Atomic, Joint State Not Yet

The first version PR accomplished several correct things:

- Atomicized the check + insert within `put_tasks` using `try_insert_put_task()`;
- Preemptively rejected objects larger than the entire cache budget;
- Tallying total evictable capacity before eviction;
- Cleared the registered marker on the failure path using `finally`.

The issue lies between the resident check and marker registration:

```python
with disk_lock:
    if key in resident_dict:
        return

required_size = memory_obj.get_physical_size()

if not try_insert_put_task(key):
    return
```

`self.dict` is protected by `disk_lock`, while `put_tasks` is protected by `put_lock`. `try_insert_put_task()` does ensure atomicity within the marker collection, but the judgment of "already resident or currently being written" is a joint check across two collections, which is still split into two segments.
## True Error Timing

Assuming key `K` has a size of 10, the first write to A has completed capacity admission:

```text
self.dict               = {}
put_tasks               = {K}
current_cache_size      = 10
```

At this point, background A is writing a file, and a new normal commit B arrives.

![Resident and in-flight handoff race](/images/blog/lmcache-local-disk-put-admission/handoff-race-en.svg)

The complete interleaving is as follows:

1. B holds `disk_lock` to check `self.dict`, at this point A has not yet published, so B cannot see `K`;
2. B releases `disk_lock` and starts executing `get_physical_size()`;
3. Background A completes the write and adds `K` to `self.dict` via `insert_key(K)`;
4. A deletes the old marker from `put_tasks`;
5. B executes `try_insert_put_task(K)`, sees that the marker has disappeared, and thus registers successfully;
6. B no longer checks `self.dict`, increases `current_cache_size` again, and schedules a write to disk.

Ultimately, there exists only one 10-byte resident file, but the capacity count may change from 10 to 20. A second background write will overwrite the same file and increase usage again. During tight capacity, this write, which should not exist, may also trigger additional eviction.

This window is narrow, but it definitely exists. The key is not to estimate "how likely it is to hit in production," but rather that the code has not established a happens-before relationship that can exclude this order.

## How to Turn Races from Guesswork into Deterministic Tests

The most common issue in concurrent testing is reliance on `sleep()`: tests occasionally fail, are hard to reproduce in CI, and cannot prove that they have truly reached the target interleaving.

This validation utilizes `get_physical_size()` positioned exactly between two critical sections, setting it as a controlled synchronization point:

```text
The second commit passes the first resident check
    ↓
Enters get_physical_size(), pauses
    ↓
Simulates the first write publishing the resident key and deleting the marker
    ↓
Resumes the second commit
```

On the old head, the resumed commit will reinsert the marker, call `ref_count_up()`, increase `current_cache_size`, and schedule a write to disk. The state obtained from controlled reproduction is:

```text
resident=True
put_marker_reinserted=True
current_cache_size: 10 → 20
ref_count_up_calls=1
scheduled_calls=1
```

This test is closer to the real invariants than "starting eight threads to call `try_insert_put_task()` simultaneously." The latter can only prove that a list's check + insert is atomic, but cannot prove that the handoff between resident and in-flight is correct.

## Final Fix: Place Decision Points in the Same Critical Section

The author added a second resident check in commit [`a3765d8d`](https://github.com/LMCache/LMCache/commit/a3765d8dd4d5f9a2372d8ae6e42402bf8f063953) and placed it in the same `disk_lock` critical section as the marker registration. The final structure can be summarized as:

```python
# First check: resident fast path, avoiding meaningless size queries
check_resident()
required_size = get_physical_size()

with disk_lock:
    # Second check: closes the state handoff window during asynchronous completion
    check_resident_again()
    reject_oversized_object()
    task_registered = try_insert_put_task()
    preflight_and_reserve_capacity()
```

The current implementation can be seen in the final version of [`submit_put_task()`](https://github.com/LMCache/LMCache/blob/a3765d8dd4d5f9a2372d8ae6e42402bf8f063953/lmcache/v1/storage_backend/local_disk_backend.py#L352-L425).

Why is it necessary to retain the first check and add a second check?

- The first check is a performance and semantic fast path: when already resident, there is no need to call `get_physical_size()`;
- The second check is responsible for concurrent correctness: during size calculation, an old write may just complete;
- The second check and `try_insert_put_task()` are in the same `disk_lock` critical section, so background `insert_key()` cannot insert between the two.

Verification can be done in three orders:

1. **B gets `disk_lock` first**: the old marker is still present, `try_insert_put_task()` returns false;
2. **A has published but has not deleted the marker**: B's second check sees resident and returns directly;
3. **A has published and deleted the marker**: B still sees resident first and will not re-register.

None of the three orders will repeat admission.

The fix also separates the recording of `task_registered` and `admission_succeeded`. This is important: failure cleanup can only delete the marker "personally registered by this commit." If `try_insert_put_task()` returns false, the marker belongs to another task, and this call must never delete it in `finally`.
## Regression tests should validate side effects, not just return values

The normal return value of `submit_put_task()` is always `None`, so asserting only the return value cannot distinguish between success, skipping, and failure. The final tests check:

- The resident entry has not changed;
- `current_cache_size` has not increased repeatedly;
- The marker has not been reinserted;
- The eviction policy has not received `update_on_put()`;
- No new object has `ref_count_up()`;
- No second write-back task has been submitted to the event loop.

These assertions cover observable side effects, which correspond to every state that bugs would disrupt.

On the final head `a3765d8d`, I ran 7 related tests locally, including new handoff regression, existing resident-only/resident-and-inflight tests, capacity rejection, and concurrent registration tests; all passed. The modified files also passed Ruff, format, `git diff --check`, mypy, and related pre-commit hooks. At the time of writing, K3 Buildkite and DCO have passed, and some current-head workflows are still running on GitHub, so "code review can pass" and "all CI has finished" should still be stated separately.

## General methods left from this review

### 1. Identify invariants before considering locks

Don’t start with “Is there a lock here?” Instead, first write out the state relationships that must never be violated in business logic. What truly needs protection is not a specific list, but the joint judgment of `resident ∨ in-flight`.

### 2. Check state handover along the order of asynchronous completion

The order of finishing asynchronous tasks often determines whether a race condition exists. `insert_key()` first and `remove_put_task()` later means the system has a legitimate resident + in-flight transitional state. The new submission logic must handle it correctly.

### 3. Atomic helpers do not equal atomic business decisions

`try_insert_put_task()` is correct and necessary, but it only protects `put_tasks`. If it relies on a judgment protected by another lock before being called, the possibility of state changes between the two critical sections still needs to be reviewed.

### 4. Prove ownership before rollback

`finally` is not inherently safe. Only resources successfully acquired in this call can be released by this call. `task_registered` is evidence of the marker's ownership.

### 5. Capacity pre-checks must be as side-effect-free as possible

If querying eviction candidates changes the policy state, it should not be used for probing. First calculate the total bytes that can be evicted, then perform the actual policy selection to avoid designing complex rollbacks for failure paths.

### 6. Enforce timing with synchronization points, do not wait for probabilities

High-quality concurrent regression tests should clearly control "who gets to which step first" and validate all key side effects. Its goal is not to make races more likely to occur randomly, but to ensure that target interleavings happen inevitably.

## Conclusion

This change ultimately only added a resident re-check and rearranged decisions within locks, but the underlying issues are significant: disk capacity, task ownership, asynchronous completion, and cache policy all participate in an admission process across state machines.

The most valuable part of code review is often not discovering a line that "looks wrong," but rather stringing together the complete lifecycle of an object from submission, retention, consumption to cleanup, identifying where the system lacks atomic boundaries in state transitions. Once the boundaries are clear, bugs, tests, and fixes often become clear as well.
