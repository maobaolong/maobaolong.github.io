---
title: zookeeper
date: 2016-11-09 15:13:48
tags: [技术学习,zookeeper,分布式]
categories: 技术学习
keywords: 技术学习,zookeeper,分布式
description: 介绍zookeeper的使用
---
zkCli.sh -server IP:port

ls(查看当前节点数据),
ls2(查看当前节点数据并能看到更新次数等数据) ,
create(创建一个节点) ,
get(得到一个节点，包含数据和更新次数等数据),
set(修改节点)
delete(删除一个节点)

四字命令，nc 服务器地址 端口号
nc 192.168.193.84 2181



|ZooKeeper 四字命令|功能描述|
|--------|--------|
|conf        |    输出相关服务配置的详细信息。    |
|cons|列出所有连接到服务器的客户端的完全的连接 / 会话的详细信息。包括“接受 / 发送”的包数量、会话 id 、操作延迟、最后的操作执行等等信息。|
|dump|列出未经处理的会话和临时节点。|
|envi|输出关于服务环境的详细信息（区别于 conf 命令）。|
|reqs|列出未经处理的请求|
|ruok|测试服务是否处于正确状态。如果确实如此，那么服务返回“ imok”，否则不做任何相应。|
|stat|输出关于性能和连接的客户端的列表。|
|wchs|列出服务器 watch 的详细信息。|
|wchc|通过 session 列出服务器 watch 的详细信息，它的输出是一个与watch 相关的会话的列表。|
|wchp|通过路径列出服务器 watch 的详细信息。它输出一个与 session 相关的路径。|
|mntr|显示zk信息|



## 获取当前zk服务器的serverId

echo conf|nc 192.168.193.83 2181

## 获取当前zk服务器的角色，如果为leader，则可以获得follower个数

echo mntr|nc 192.168.193.85 2181
