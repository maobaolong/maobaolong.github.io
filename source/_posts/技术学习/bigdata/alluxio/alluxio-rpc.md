---
title: alluxio rpc 分析

date: 2017-01-18 11:08:15

tags: [技术学习,bigdata,alluxio]

categories: 技术学习

keywords: 技术学习,bigdata,alluxio

description: alluxio rpc 分析

---

## RPC 通信
一个类扩展了 `AbstractThriftClient` 类将成为RPC客户端。使用方法 `retryRPC` 发起一个 PRC 调用， 然后实现接口`Service.Iface`的抽象方法的`ServiceHandler`将会收到调用。

用来统一捕获RPC调用过程中的异常, 比较好的方法是使用静态方法 `RpcUtils.call()`， 提供一个实例实现`RpcCallable` 接口的`call`方法来处理回调。

## RPC 调用

RPC 客户端通过 `clientService`发起一个RPC调用到实现RPC服务端接口的`serviceHandler`。 `Alluxio`中有三个角色，调用方向可以是 `Client->Master`、`Worker->Master`、 `Client->Worker`。

实现接口`ClientService.Iface`的`ServiceHandler`会被RPC客户端调用, 通常地，`ServiceHandler`有一个成员用来在master或worker上执行具体的操作。

下表展示`Alluxio`中的六类RPC调用。

|RPC Client|ClientService(thrift)|ServiceHandler|Master/Worker|调用方向|
|------|-------------|----------------------|--------------|--------------|
|FileSystemMasterClient         |FileSystemMasterClientService|FileSystemMasterClientServiceHandler|FileSystemMaster|Client->Master|
|FileSystemMasterClient'        |FileSystemMasterWorkerService|FileSystemMasterWorkerServiceHandler|FileSystemMaster|Worker->Master|
|RetryHandlingBlockMasterClient |BlockMasterClientService     |BlockMasterClientServiceHandler     |BlockMaster     |Client->Master|
|BlockMasterClient              |BlockMasterWorkerService     |BlockMasterWorkerServiceHandler     |BlockMaster     |Worker->Master|
|FileSystemWorkerClient         |FileSystemWorkerClientService|FileSystemWorkerClientServiceHandler|FileSystemWorker|Client->Worker|
|RetryHandlingBlockWorkerClient |BlockWorkerClientService     |BlockWorkerClientServiceHandler     |BlockWorker     |Client->Worker|

## RPC 方法
 
### master
- FileSystemMasterClientServiceHandler
  - checkConsistency
  - completeFile
  - createDirectory
  - createFile
  - free
  - getFileBlockInfoList
  - getNewBlockIdForFile
  - getStatus
  - getStatusInternal
  - getUfsAddress
  - listStatus
  - loadMetadata
  - mount
  - remove
  - rename
  - scheduleAsyncPersist
  - setAttribute
  - unmount

- FileSystemMasterWorkerServiceHandler
  - getFileInfo
  - getPinIdList
  - heartbeat

- BlockMasterClientServiceHandler
  - getWorkerInfoList
  - getCapacityBytes
  - getUsedBytes
  - getBlockInfo

- BlockMasterWorkerServiceHandler
  - getWorkerId
  - registerWorker
  - heartbeat
  - commitBlock

### worker

- BlockWorkerClientServiceHandler
  - accessBlock
  - cacheBlock
  - cancelBlock
  - lockBlock
  - promoteBlock
  - removeBlock
  - requestBlockLocation
  - requestSpace
  - unlockBlock
  - sessionHeartbeat

- FileSystemWorkerClientServiceHandler
  - cancelUfsFile
  - closeUfsFile
  - completeUfsFile
  - createUfsFile
  - openUfsFile
  - sessionHeartbeat



