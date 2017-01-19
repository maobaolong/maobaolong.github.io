# 分层存储种类

1. MEM (内存)

2. SSD (固态硬盘)

3. HDD (硬盘驱动器)

# 分层存储参数
1. alluxio.worker.tieredstore.levels，缺省值1
Alluxio Worker多层存储中的最大存储级数。当前Alluxio支持1，2，3层。
        
2. alluxio.worker.tieredstore.level{x}.alias，缺省值MEM (for alluxio.worker.tieredstore.level0.alias)
每个存储层的别名，x代表存储层序号(顶层为0)。当前有3个别名，MEM，SSD和HDD。

3. alluxio.worker.tieredstore.level{x}.dirs.path，缺省值/mnt/ramdisk (for alluxio.worker.tieredstore.level0.dirs.path)
x存储层的底层存储目录路径，以逗号分割。x代表存储层序号(顶层为0)。建议SSD和HDD层每个硬盘设备有一个存储目录。

4. alluxio.worker.tieredstore.level{x}.dirs.quota，缺省值128MB (for alluxio.worker.tieredstore.level0.dirs.quota)
x存储层所有存储目录的配额，以逗号分割。x代表存储层序号(从0开始)。对于特定的存储层，如果配额的列表长度比目录列表短，剩余目录的配额使用最后一个定义的配额。配额定义可使用这些后缀：KB，MB，GB，TB，PB。

5. alluxio.worker.tieredstore.level{x}.reserved.ratio，缺省值0.1
值在0到1之间，设置了在x存储层预留空间的比例。如果预留空间大小不满足，空间预留器会移出数据块直到预留空间大小满足要求。

6. alluxio.worker.tieredstore.reserver.enabled，缺省值false
开启空间预留器服务的标志。

7. alluxio.worker.tieredstore.reserver.interval.ms
1000
空间预留器检查所有存储层是否预留足够空间的时间间隔。

8. alluxio.worker.allocator.class，缺省值alluxio.worker.block.allocator.MaxFreeAllocator
Alluxio中新数据块分配策略的类名。

9. lluxio.worker.evictor.class，缺省值alluxio.worker.block.evictor.LRUEvictor
当存储层空间用尽时块回收策略的类名。

# 分配策略：选择新数据块的写入位置
1. 贪心分配策略
分配新数据块到首个有足够空间的存储目录。

2. 最大剩余空间分配策略
分配数据块到有最大剩余空间的存储目录。

3. 轮询调度分配策略
分配数据块到有空间的最高存储层，存储目录通过轮询调度选出。

# 回收策略：决定当空间需要释放时，哪些数据块被移到低存储层。
1. 贪心回收策略
移出任意的块直到释放出所需大小的空间。

2. LRU回收策略
移出最近最少使用的数据块直到释放出所需大小的空间。

3. LRFU回收策略
 基于权重分配的最近最少使用和最不经常使用策略移出数据块。如果权重完全偏向最近最少使用,LRFU回收策略退化为LRU回收策略。

4. 部分LRU回收策略
基于最近最少使用移出，但是选择有最大剩余空间的存储目录(StorageDir)，只从该目录移出数据块。

# 举例
举例而言，如果想要配置Alluxio有两级存储–内存和硬盘–，可以使用如下配置：
```properties
alluxio.worker.tieredstore.levels=2
alluxio.worker.tieredstore.level0.alias=MEM
alluxio.worker.tieredstore.level0.dirs.path=/mnt/ramdisk
alluxio.worker.tieredstore.level0.dirs.quota=100GB
alluxio.worker.tieredstore.level0.reserved.ratio=0.2
alluxio.worker.tieredstore.level1.alias=HDD
alluxio.worker.tieredstore.level1.dirs.path=/mnt/hdd1,/mnt/hdd2,/mnt/hdd3
alluxio.worker.tieredstore.level1.dirs.quota=2TB,5TB,500GB
alluxio.worker.tieredstore.level1.reserved.ratio=0.1
```

相关配置说明如下：
```properties
alluxio.worker.tieredstore.levels=2 在Alluxio中配置了两级存储
alluxio.worker.tieredstore.level0.alias=MEM配置了首层(顶层)是内存存储层
alluxio.worker.tieredstore.level0.dirs.path=/mnt/ramdisk 定义了/mnt/ramdisk是首层的文件路径
alluxio.worker.tieredstore.level0.dirs.quota=100GB设置了ramdisk的配额是100GB
alluxio.worker.tieredstore.level0.reserved.ratio=0.2设置了顶层的预留空间比例是0.2
alluxio.worker.tieredstore.level1.alias=HDD配置了第二层是硬盘驱动器层
alluxio.worker.tieredstore.level1.dirs.path=/mnt/hdd1,/mnt/hdd2,/mnt/hdd3配置了第二层3个独立的文件路径
alluxio.worker.tieredstore.level1.dirs.quota=2TB,5TB,500GB定义了第二层3个文件路径各自的配额
alluxio.worker.tieredstore.level1.reserved.ratio=0.1设置了第二层的预留空间比例是0.1
```