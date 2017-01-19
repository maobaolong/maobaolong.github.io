---
title: alluxio rpc analysis

date: 2017-01-18 11:08:15

tags: [技术学习,bigdata,alluxio,en]

categories: 技术学习

keywords: 技术学习,bigdata,alluxio,en

description: alluxio rpc analysis

---

## RPC communication
A class which extends parent class `AbstractThriftClient` will be a RPC client. They use the method `retryRPC` to invoke a PRC call, then `ServiceHandler`'s method which override `Service.Iface`'s abstract method will receive the calling.

To catch the exception during the calling from RPC client uniformity, it is a better way to use method `RpcUtils.call()` and provide a instance implements the abstract method `call` which defined in interface `RpcCallable` to handle the callback.

## RPC call

RPC client invoke a RPC call to RPC service which is implemented by `serviceHandler` through `clientService`. There are three role in `Alluxio`, the call direction could be `Client->Master`, `Worker->Master`, `Client->Worker`.

The `ServiceHandler` implements `ClientService.Iface` which will called by RPC Client, usually `ServiceHandler` have a member to execute concrete operation on master or worker.

The following table shows six kind RPC call in `Alluxio`.

|RPC Client|ClientService(thrift)|ServiceHandler|Master/Worker|call direction|
|------|-------------|----------------------|--------------|--------------|
|FileSystemMasterClient         |FileSystemMasterClientService|FileSystemMasterClientServiceHandler|FileSystemMaster|Client->Master|
|FileSystemMasterClient'        |FileSystemMasterWorkerService|FileSystemMasterWorkerServiceHandler|FileSystemMaster|Worker->Master|
|RetryHandlingBlockMasterClient |BlockMasterClientService     |BlockMasterClientServiceHandler     |BlockMaster     |Client->Master|
|BlockMasterClient              |BlockMasterWorkerService     |BlockMasterWorkerServiceHandler     |BlockMaster     |Worker->Master|
|FileSystemWorkerClient         |FileSystemWorkerClientService|FileSystemWorkerClientServiceHandler|FileSystemWorker|Client->Worker|
|RetryHandlingBlockWorkerClient |BlockWorkerClientService     |BlockWorkerClientServiceHandler     |BlockWorker     |Client->Worker|

## RPC method 
 
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



