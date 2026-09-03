---
title: "从 LMCache PR #4660 看并发状态机：原子操作为什么仍然不够"
description: 通过一次 LocalDiskBackend 磁盘写入审查，分析重复提交、容量预检、失败回滚和 resident/in-flight 交接竞态，以及如何用确定性测试验证修复。
publishedAt: 2026-09-03
updatedAt: 2026-09-03
category: AI Infra
tags:
  - lmcache
  - concurrency
  - storage
  - code-review
  - testing
  - kv-cache
author: 毛宝龙
readingTime: 13 min
featured: true
draft: false
---

最近 review 了 [LMCache PR #4660](https://github.com/LMCache/LMCache/pull/4660)。这个 PR 修复的是 `LocalDiskBackend` 的磁盘写入准入问题：同一个 key 可能被重复提交；容量不足时，失败任务可能永远留在 in-flight 集合里；系统甚至可能先删除一部分有效缓存，最后才发现新对象根本放不下。

作者的第一版修复已经覆盖了这些问题的大部分，但在“异步写入完成”和“下一次提交开始”之间，仍然留下了一个很窄的状态交接窗口。这个窗口不会让程序立刻崩溃，却可能重复写盘、重复增加容量计数，并在磁盘接近上限时错误淘汰其他缓存。

这篇文章不只记录最后加了哪一把锁，更想说明一种通用的并发审查方法：

> 单个操作是原子的，不代表跨多个状态容器的业务不变量也是原子的。

## 先把真实执行路径串起来

一次 KV Cache store 最终会沿着下面的路径进入磁盘后端：

```text
LMCacheEngine.store()
    ↓
StorageManager.batched_put()
    ↓
LocalDiskBackend.batched_submit_put_task()
    ↓
LocalDiskBackend.submit_put_task()
    ↓
LocalDiskWorker 后台执行 async_save_bytes_to_disk()
```

前台的 `submit_put_task()` 只负责判断能不能接收任务、预留容量并把工作提交给后台线程。真正的文件写入异步完成，所以即使前台的 store 请求是顺序到达的，下一次提交仍然可能与上一次后台写入的收尾过程并发。

这正是本次问题成立的基础：不需要两个前台线程同时调用，前台提交线程和后台磁盘线程就已经构成并发。

## 一个 key 同时存在于三个状态系统中

理解这段代码，首先要区分三个结构：

- `self.dict`：已经写入磁盘、可以读取的 resident key；
- `disk_worker.put_tasks`：已经接收、但后台写入尚未结束的 in-flight key；
- `current_cache_size`：已经 resident 或已为 in-flight 写入预留的容量。

一个新 key 通常经历下面的状态变化：

![LocalDiskBackend put 状态机](/images/blog/lmcache-local-disk-put-admission/put-state-machine.svg)

这里有一个容易忽略但合法的过渡状态：后台写入完成时，[代码先调用 `insert_key()`，再删除 put marker](https://github.com/LMCache/LMCache/blob/a3765d8dd4d5f9a2372d8ae6e42402bf8f063953/lmcache/v1/storage_backend/local_disk_backend.py#L714-L716)。因此短时间内，同一个 key 会同时出现在 `self.dict` 和 `put_tasks` 中。

这个“双重存在”本身没有问题。它保证 key 已经对读取方可见时，其他写入提交仍然能够看到旧任务的 marker。真正的不变量是：

1. resident key 不能再次进入新的写盘任务；
2. 同一个 key 最多只能有一个有效的 in-flight 写入；
3. 只有拥有 marker 的提交，才能在失败时删除这个 marker；
4. 容量计数只能对一次成功准入增加一次。

## 原始 bug：准入结果未知，副作用已经发生

[Issue #4659](https://github.com/LMCache/LMCache/issues/4659) 梳理了原实现的三个相关缺陷。

### 1. check 和 insert 分开，重复任务可以同时进入

原逻辑先调用 `exists_in_put_tasks(key)`，随后再调用 `insert_put_task(key)`。两次操作虽然各自加了 `put_lock`，但中间存在空隙：两个提交都可能先看到“不存在”，然后各自插入。

这是典型的 check-then-act race。正确抽象应该是一个 `try_insert_put_task()`：在同一次持锁过程中完成“检查并插入”，并用返回值表示本次调用是否取得 marker 所有权。

### 2. 准入失败后 marker 没有清理

旧代码在容量判断前就把 key 放入 `put_tasks`。如果所有 resident entry 都被 pin、没有任何可淘汰对象，函数会直接返回，却不删除 marker。

于是这个 key 会被永久认为“仍在写入”：

```text
第一次提交 K
  → 注册 marker
  → 容量准入失败
  → marker 泄漏

容量释放后重试 K
  → 发现旧 marker
  → 永远跳过
```

### 3. 先淘汰，最后才知道仍然放不下

旧 eviction loop 每次选一个候选 key，删除以后再检查空间是否足够。如果新对象比整个磁盘缓存预算还大，系统可能删除所有有效 resident entry，最后仍然拒绝新对象。

类似问题也会发生在部分 entry 被 pin 的场景。比如缓存上限为 100，其中 80 不可淘汰、20 可淘汰，而新对象需要 60。即使删掉那 20，空间仍然不够。

因此准入必须先做无副作用的容量预检：统计所有 `metadata.can_evict` 对象的总大小，确认足够以后，才允许 eviction policy 真正选择并删除对象。

这里不能为了“提前看看候选是谁”而直接调用 `get_evict_candidates()`。LFU 等策略在选择候选时会修改自己的频率桶；一次失败的试探同样需要复杂回滚。只统计可淘汰字节，不改变 policy 状态，反而更安全。

## 第一版修复：单个集合原子了，联合状态还没有

第一版 PR 做了几件正确的事：

- 用 `try_insert_put_task()` 原子化 `put_tasks` 内部的 check + insert；
- 对大于整个 cache budget 的对象提前拒绝；
- eviction 前统计总可淘汰容量；
- 用 `finally` 在失败路径清理本次注册的 marker。

问题出在 resident 检查与 marker 注册之间：

```python
with disk_lock:
    if key in resident_dict:
        return

required_size = memory_obj.get_physical_size()

if not try_insert_put_task(key):
    return
```

`self.dict` 由 `disk_lock` 保护，`put_tasks` 由 `put_lock` 保护。`try_insert_put_task()` 的确保证了 marker 集合内部的原子性，但“已经 resident 或者正在写入”是跨两个集合的联合判断，仍然被拆成了两段。

## 真正的错误时序

假设 key `K` 大小为 10，第一次写入 A 已经完成容量准入：

```text
self.dict               = {}
put_tasks               = {K}
current_cache_size      = 10
```

此时后台 A 正在写文件，新的普通提交 B 到达。

![Resident 与 in-flight 交接竞态](/images/blog/lmcache-local-disk-put-admission/handoff-race.svg)

完整交错如下：

1. B 持有 `disk_lock` 检查 `self.dict`，此时 A 还没 publish，B 看不到 `K`；
2. B 释放 `disk_lock`，开始执行 `get_physical_size()`；
3. 后台 A 完成写入，通过 `insert_key(K)` 把 `K` 加入 `self.dict`；
4. A 删除 `put_tasks` 中的旧 marker；
5. B 执行 `try_insert_put_task(K)`，看到 marker 已经消失，于是注册成功；
6. B 不再检查 `self.dict`，再次增加 `current_cache_size` 并调度写盘。

最终只存在一个 10 字节的 resident 文件，容量计数却可能从 10 变成 20。第二次后台写入还会覆盖同一个文件并再次增加 usage。在容量紧张时，这次本不应存在的写入还可能触发额外 eviction。

这个窗口很窄，但它是确定存在的。关键不是估计“生产环境撞上的概率有多大”，而是代码没有建立一个能排除该顺序的 happens-before 关系。

## 如何把竞态从猜测变成确定性测试

并发测试最常见的问题是依赖 `sleep()`：测试偶尔失败、在 CI 上很难复现，而且无法证明自己真的走到了目标交错。

这次验证利用 `get_physical_size()` 恰好位于两段临界区之间，把它设成受控的同步点：

```text
第二次提交通过第一次 resident check
    ↓
进入 get_physical_size()，暂停
    ↓
模拟第一次写入 publish resident key 并删除 marker
    ↓
恢复第二次提交
```

在旧 head 上，恢复后的提交会重新插入 marker、调用 `ref_count_up()`、增加 `current_cache_size` 并调度写盘。受控复现得到的状态是：

```text
resident=True
put_marker_reinserted=True
current_cache_size: 10 → 20
ref_count_up_calls=1
scheduled_calls=1
```

这个测试比“启动八个线程同时调用 `try_insert_put_task()`”更接近真实不变量。后者只能证明一个 list 的 check + insert 是原子的，不能证明 resident 与 in-flight 的交接正确。

## 最终修复：把决策点放进同一个临界区

作者在 commit [`a3765d8d`](https://github.com/LMCache/LMCache/commit/a3765d8dd4d5f9a2372d8ae6e42402bf8f063953) 中增加了第二次 resident check，并把它与 marker 注册放进同一个 `disk_lock` 临界区。最终结构可以概括为：

```python
# 第一次检查：resident fast path，避免无意义的 size 查询
check_resident()
required_size = get_physical_size()

with disk_lock:
    # 第二次检查：关闭异步完成期间的状态交接窗口
    check_resident_again()
    reject_oversized_object()
    task_registered = try_insert_put_task()
    preflight_and_reserve_capacity()
```

当前实现可见于 [`submit_put_task()` 的最终版本](https://github.com/LMCache/LMCache/blob/a3765d8dd4d5f9a2372d8ae6e42402bf8f063953/lmcache/v1/storage_backend/local_disk_backend.py#L352-L425)。

为什么需要保留第一次检查，再加第二次检查？

- 第一次检查是性能与语义 fast path：已经 resident 时，不需要调用 `get_physical_size()`；
- 第二次检查负责并发正确性：size 计算期间，旧写入可能刚好完成；
- 第二次检查与 `try_insert_put_task()` 处于同一个 `disk_lock` 临界区，因此后台 `insert_key()` 不可能插入到两者之间。

可以按三种顺序验证：

1. **B 先拿到 `disk_lock`**：旧 marker 仍在，`try_insert_put_task()` 返回 false；
2. **A 已 publish、尚未删除 marker**：B 的第二次检查看到 resident，直接返回；
3. **A 已 publish 并删除 marker**：B 仍然先看到 resident，不会重新注册。

三种顺序都不会重复准入。

修复还把 `task_registered` 与 `admission_succeeded` 分开记录。这一点很重要：失败清理只能删除“本次提交亲自注册”的 marker。如果 `try_insert_put_task()` 返回 false，marker 属于另一个任务，本次调用绝不能在 `finally` 中把它删掉。

## 回归测试应该验证副作用，而不只是返回值

`submit_put_task()` 的正常返回值始终是 `None`，所以只断言返回值无法区分成功、跳过和失败。最终测试同时检查：

- resident entry 没有改变；
- `current_cache_size` 没有重复增加；
- marker 没有被重新插入；
- eviction policy 没有收到 `update_on_put()`；
- 新对象没有 `ref_count_up()`；
- 没有向事件循环提交第二次写盘任务。

这套断言覆盖的是可观察副作用，也正好对应 bug 会破坏的每一个状态。

在最终 head `a3765d8d` 上，我本地运行了 7 个相关测试，包括新的 handoff 回归、原有 resident-only / resident-and-inflight 测试、容量拒绝与并发注册测试；全部通过。改动文件同时通过 Ruff、format、`git diff --check`、mypy 和相关 pre-commit hooks。写作时 K3 Buildkite 与 DCO 已通过，GitHub 仍有部分 current-head workflow 在运行，因此“代码审查可通过”与“所有 CI 已结束”仍应分别表述。

## 这次 review 留下的几个通用方法

### 1. 先找不变量，再看锁

不要从“这里有没有加锁”开始，而要先写出业务上绝不能被破坏的状态关系。这里真正需要保护的不是某一个 list，而是 `resident ∨ in-flight` 的联合判断。

### 2. 沿异步完成顺序检查状态交接

异步任务的收尾顺序往往决定 race 是否存在。`insert_key()` 在前、`remove_put_task()` 在后，意味着系统有一个合法的 resident + in-flight 过渡态。新的提交逻辑必须能正确处理它。

### 3. 原子 helper 不等于原子业务决策

`try_insert_put_task()` 是正确且必要的，但它只保护 `put_tasks`。如果调用它之前依赖了另一个锁保护的判断，仍然要审查两个临界区之间发生状态变化的可能性。

### 4. 回滚前先证明所有权

`finally` 并不天然安全。只有本次调用成功取得的资源，才能由本次调用释放。`task_registered` 就是 marker 所有权的证据。

### 5. 容量预检必须尽量无副作用

如果查询 eviction candidate 会改变 policy 状态，就不应该拿它做试探。先计算可淘汰总字节，再执行真正的 policy selection，可以避免为失败路径设计复杂回滚。

### 6. 用同步点强制时序，不要等待概率

高质量并发回归测试应该明确控制“谁先走到哪一步”，并验证所有关键副作用。它的目标不是让竞态更容易随机发生，而是让目标交错必然发生。

## 结语

这次改动最后只是增加了一次 resident re-check，并重新安排了锁内决策，但背后的问题并不小：磁盘容量、任务所有权、异步完成和 cache policy 同时参与了一个跨状态机的准入过程。

代码 review 最有价值的部分，通常不是发现某行“看起来不对”，而是把对象从提交、保留、消费到清理的完整生命周期串起来，找出系统在哪个状态转换上缺少原子边界。只要边界说清楚，bug、测试和修复往往会同时变得清楚。
