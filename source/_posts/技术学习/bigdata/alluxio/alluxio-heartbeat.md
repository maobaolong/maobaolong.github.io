<!--
---
title: alluxio heartbeat分析

date: 2017-01-17 19:46:28

tags: [技术学习,bigdata,alluxio]

categories: 技术学习

keywords: 技术学习,bigdata,alluxio

description: alluxio heartbeat分析

---
-->
## 心跳线程

心跳线程，`HeartbeatThread`类作为心跳后台线程。线程主体是个可打断的循环，循环中，每一个滴答(`tick`)会心跳(`heartbeat`)一次。如果线程被打断，心跳线程结束。
心跳线程由心跳定时器(`mTimer`)和心跳执行者(`mExecutor`)组成。心跳定时器要实现接口`HeartbeatTimer`，心跳执行者要实现接口`HeartbeatExecutor`。

心跳线程表：

|线程名                            |线程启动类                 |心跳定时器    |心跳执行者                            |默认时间间隔(ms)|
|---------------------------------|--------------------------|-------------|------------------------------------|--------------|
|WORKER_SPACE_RESERVER            |DefaultBlockWorker        |SleepingTimer|SpaceReserver                       |1000          |
|WORKER_BLOCK_SYNC                |DefaultBlockWorker        |SleepingTimer|BlockMasterSync                     |1000          |
|WORKER_PIN_LIST_SYNC             |DefaultBlockWorker        |SleepingTimer|PinListSync                         |1000          |
|WORKER_FILESYSTEM_MASTER_SYNC    |DefaultFileSystemWorker   |SleepingTimer|FileWorkerMasterSyncExecutor        |1000          |
|MASTER_LOST_WORKER_DETECTION     |BlockMaster               |SleepingTimer|LostWorkerDetectionHeartbeatExecutor|1000          |
|MASTER_TTL_CHECK                 |FileSystemMaster          |SleepingTimer|MasterInodeTtlCheckExecutor         |3600000       |
|MASTER_LOST_FILES_DETECTION      |FileSystemMaster          |SleepingTimer|LostFilesDetectionHeartbeatExecutor |1000          |
|MASTER_CHECKPOINT_SCHEDULING     |LineageMaster             |SleepingTimer|CheckpointSchedulingExecutor        |300000        |
|MASTER_FILE_RECOMPUTATION        |LineageMaster             |SleepingTimer|CheckpointSchedulingExecutor        |300000        |
|heartbeat-thread-test-thread-name|DummyHeartbeatTestCallable|ScheduledTimer|DummyHeartbeatExecutor             |调度 |
|WORKER_SPACE_RESERVER            |SpaceReserverTest         |SleepingTimer|SpaceReserver                       |0 |


## 心跳定时器

心跳定时器需要实现接口`HeartbeatTimer`，目前有两个，分为别`SleepingTimer`和`ScheduledTimer`。

### SleepingTimer

`SleepingTimer`按指定的时间间隔执行滴答(`tick`),保证一个tick持续时间大于等于指定时间间隔。如果时间间隔大于给定时间间隔，在log中给出warning.

### ScheduledTimer

`ScheduledTimer`用于测试，tick函数的持续时间不是靠指定时间间隔，而是靠`Condition`的`await`和`signal`进行线程控制，从而控制tick的阻塞和执行。

## 心跳执行者

心跳执行者是实现了`HeartbeatExecutor`接口的类，实现接口中的`heartbeat()`方法，实现具体的心跳到来时的功能。比如块同步、锁定列表同步、文件系统master同步、丢失worker探测、TTL检查、丢失文件探测、检查点调度等等功能。

### BlockMasterSync

BlockMasterSync.heartbeat() -> BlockMaster.workerHeartbeat()

