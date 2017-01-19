---
title: hive命令
date: 2016-12-16 11:24:15
tags: [技术学习,bigdata,spark]
categories: 技术学习
keywords: 技术学习,bigdata,spark
description: spark
---

## spark SQL
val sqlContext = new org.apache.spark.sql.SQLContext(sc)


## spark 中执行hiveSQL

```scala
val sqlContext2 = new org.apache.spark.sql.hive.HiveContext(sc)
sqlContext2.sql("use databases").collect;
sqlContext2.sql("use default");
sqlContext2.sql("select * from mbltest order by id desc").collect
```

## 读取文件内容

```scala
val textFile = sc.textFile("/usr/maobaolong/mbltest/mbltest.txt")
textFile.first()
textfile.count()
```