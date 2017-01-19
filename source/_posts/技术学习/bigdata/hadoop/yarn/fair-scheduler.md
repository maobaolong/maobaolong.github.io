---
title: fair-scheduler
date: 2016-11-09 15:13:48
tags: [技术学习,yarn,hadoop]
categories: 技术学习
keywords: 技术学习,hadoop,yarn,fair-scheduler
description: 介绍fair-scheduler文件配置
---
# fair-scheduler.xml的配置
在一个公司内部的Hadoop Yarn集群，肯定会被多个业务、多个用户同时使用，共享Yarn的资源，如果不做资源的管理与规划，那么整个Yarn的资源很容易被某一个用户提交的Application占满，其它任务只能等待，这种当然很不合理，我们希望每个业务都有属于自己的特定资源来运行MapReduce任务，Hadoop中提供的公平调度器–Fair Scheduler，就可以满足这种需求。

Fair Scheduler将整个Yarn的可用资源划分成多个资源池，每个资源池中可以配置最小和最大的可用资源（内存和CPU）、最大可同时运行Application数量、权重、以及可以提交和管理Application的用户等。

## 根据用户名分配资源池
![](http://7xipth.com1.z0.glb.clouddn.com/1026-1.jpg)

如图所示，假设整个Yarn集群的可用资源为100vCPU，100GB内存，现在为3个业务各自规划一个资源池，另外，规划一个default资源池，用于运行其他用户和业务提交的任务。如果没有在任务中指定资源池（通过参数mapreduce.job.queuename），那么可以配置使用用户名作为资源池名称来提交任务，即用户businessA提交的任务被分配到资源池businessA中，用户businessC提交的任务被分配到资源池businessC中。除了配置的固定用户，其他用户提交的任务将会被分配到资源池default中。

这里的用户名，就是提交Application所使用的Linux/Unix用户名。

另外，每个资源池可以配置允许提交任务的用户名，比如，在资源池businessA中配置了允许用户businessA和用户lxw1234提交任务，如果使用用户lxw1234提交任务，并且在任务中指定了资源池为businessA，那么也可以正常提交到资源池businessA中。

## 根据权重获得额外的空闲资源
在每个资源池的配置项中，有个weight属性（默认为1），标记了资源池的权重，当资源池中有任务等待，并且集群中有空闲资源时候，每个资源池可以根据权重获得不同比例的集群空闲资源。

比如，资源池businessA和businessB的权重分别为2和1，这两个资源池中的资源都已经跑满了，并且还有任务在排队，此时集群中有30个Container的空闲资源，那么，businessA将会额外获得20个Container的资源，businessB会额外获得10个Container的资源。


## 最小资源保证
在每个资源池中，允许配置该资源池的最小资源，这是为了防止把空闲资源共享出去还未回收的时候，该资源池有任务需要运行时候的资源保证。

比如，资源池businessA中配置了最小资源为（5vCPU，5GB），那么即使没有任务运行，Yarn也会为资源池businessA预留出最小资源，一旦有任务需要运行，而集群中已经没有其他空闲资源的时候，这个最小资源也可以保证资源池businessA中的任务可以先运行起来，随后再从集群中获取资源。

## 动态更新资源配额
Fair Scheduler除了需要在yarn-site.xml文件中启用和配置之外，还需要一个XML文件来配置资源池以及配额，而该XML中每个资源池的配额可以动态更新，之后使用命令：yarn rmadmin –refreshQueues 来使得其生效即可，不用重启Yarn集群。

需要注意的是：动态更新只支持修改资源池配额，如果是新增或减少资源池，则需要重启Yarn集群。


    
    1. 配置文件yarn-site.xml
    （1） yarn.scheduler.fair.allocation.file ：自定义XML配置文件所在位置，该文件主要用于描述各个队列的属性，比如资源量、权重等，具体配置格式将在后面介绍。
    （2）  yarn.scheduler.fair.user-as-default-queue：当应用程序未指定队列名时，是否指定用户名作为应用程序所在的队列名。如果设置为false或者未设置，所有未知队列的应用程序将被提交到default队列中，默认值为true。
    （3）  yarn.scheduler.fair.preemption：是否启用抢占机制，默认值是false。
    （4）  yarn.scheduler.fair.sizebasedweight：在一个队列内部分配资源时，默认情况下，采用公平轮询的方法将资源分配各各个应用程序，而该参数则提供了另外一种资源分配方式：按照应用程序资源需求数目分配资源，即需求资源数量越多，分配的资源越多。默认情况下，该参数值为false。
    （5）  yarn.scheduler.assignmultiple：是否启动批量分配功能。当一个节点出现大量资源时，可以一次分配完成，也可以多次分配完成。默认情况下，该参数值为false。
    （6）  yarn.scheduler.fair.max.assign：如果开启批量分配功能，可指定一次分配的container数目。默认情况下，该参数值为-1，表示不限制。
    （7）  yarn.scheduler.fair.locality.threshold.node：当应用程序请求某个节点上资源时，它可以接受的可跳过的最大资源调度机会。当按照分配策略，可将一个节点上的资源分配给某个应用程序时，如果该节点不是应用程序期望的节点，可选择跳过该分配机会暂时将资源分配给其他应用程序，直到出现满足该应用程序需的节点资源出现。通常而言，一次心跳代表一次调度机会，而该参数则表示跳过调度机会占节点总数的比例，默认情况下，该值为-1.0，表示不跳过任何调度机会。
    （8）  yarn.scheduler.fair.locality.threshold.rack：当应用程序请求某个机架上资源时，它可以接受的可跳过的最大资源调度机会。
    （9）  yarn.scheduler.increment-allocation-mb：内存规整化单位，默认是1024，这意味着，如果一个Container请求资源是1.5GB，则将被调度器规整化为ceiling(1.5 GB / 1GB) * 1G=2GB。
    （10）  yarn.scheduler.increment-allocation-vcores：虚拟CPU规整化单位，默认是1，含义与内存规整化单位类似。
    2. 自定义配置文件
    Fair Scheduler允许用户将队列信息专门放到一个配置文件（默认是fair-scheduler.xml），对于每个队列，管理员可配置以下几个选项：
    （1）  minResources ：最少资源保证量，设置格式为“X mb, Y vcores”，当一个队列的最少资源保证量未满足时，它将优先于其他同级队列获得资源，对于不同的调度策略（后面会详细介绍），最少资源保证量的含义不同，对于fair策略，则只考虑内存资源，即如果一个队列使用的内存资源超过了它的最少资源量，则认为它已得到了满足；对于drf策略，则考虑主资源使用的资源量，即如果一个队列的主资源量超过它的最少资源量，则认为它已得到了满足。
    （2）  maxResources：最多可以使用的资源量，fair scheduler会保证每个队列使用的资源量不会超过该队列的最多可使用资源量。
    （3）  maxRunningApps：最多同时运行的应用程序数目。通过限制该数目，可防止超量Map Task同时运行时产生的中间输出结果撑爆磁盘。
    （4）  minSharePreemptionTimeout：最小共享量抢占时间。如果一个资源池在该时间内使用的资源量一直低于最小资源量，则开始抢占资源。
    （5）  schedulingMode/schedulingPolicy：队列采用的调度模式，可以是fifo、fair或者drf。
    （6）  aclSubmitApps：可向队列中提交应用程序的Linux用户或用户组列表，默认情况下为“*”，表示任何用户均可以向该队列提交应用程序。需要注意的是，该属性具有继承性，即子队列的列表会继承父队列的列表。配置该属性时，用户之间或用户组之间用“，”分割，用户和用户组之间用空格分割，比如“user1, user2 group1,group2”。
    （7）  aclAdministerApps：该队列的管理员列表。一个队列的管理员可管理该队列中的资源和应用程序，比如可杀死任意应用程序。
    管理员也可为单个用户添加maxRunningJobs属性限制其最多同时运行的应用程序数目。此外，管理员也可通过以下参数设置以上属性的默认值：
    （1）  userMaxJobsDefault：用户的maxRunningJobs属性的默认值。
    （2） defaultMinSharePreemptionTimeout ：队列的minSharePreemptionTimeout属性的默认值。
    （3）  defaultPoolSchedulingMode：队列的schedulingMode属性的默认值。
    （4）  fairSharePreemptionTimeout：公平共享量抢占时间。如果一个资源池在该时间内使用资源量一直低于公平共享量的一半，则开始抢占资源。
