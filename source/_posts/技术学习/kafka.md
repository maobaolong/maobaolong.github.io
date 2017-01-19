---
title: kafka
date: 2016-11-09 15:13:48
tags: [技术学习,kafka,分布式]
categories: 技术学习
keywords: 技术学习,kafka,分布式
description: 介绍kafka的api

---

## 启动zookeeper
```
bin/zookeeper-server-start.sh config/zookeeper.properties &
```
## 启动KAFKA
```
bin/kafka-server-start.sh config/server.properties &
```
## 模拟consumer
```
bin/kafka-console-consumer.sh --zookeeper 127.0.0.1:2181 --from-beginning --topic self_healing
```
