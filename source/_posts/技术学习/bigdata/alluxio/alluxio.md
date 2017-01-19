---
title: alluxio介绍与安装

date: 2016-12-13 09:23:00

tags: [技术学习,bigdata]

categories: 技术学习

keywords: 技术学习,bigdata,alluxio

description: alluxio介绍与安装

---

## 介绍
- 概念：是一个开源的基于内存的分布式存储系统，现在成为开源社区中成长最快的大数据开源项目之一。

## 公司简介

- 由项目的创建者李浩源以及来自UC Berkeley, Google, CMU, Palantir, Stanford, Yahoo等不同公司和学校的项目核心开发者组成。
- 完成750万 dollars 的A轮融资，由Andreessen Horowitz投资（硅谷最著名的VC之一，主要成员为网景公司创始人之一）。

## 术语
- Amazon AWS ：亚马逊AWS 云服务-中国领先的可扩展云计算平台
- Amazon S3 ：是一种在Internet 上的云存储服务。 要上传数据（照片、视频、文档等），请首先在一个AWS 区域中创建存储桶。 然后，您可以将任何数量的对象上传到该存储桶。


## 安装
- 解压
```bash
$ tar -xzf alluxio-1.3.0-bin.tar.gz
$ cd alluxio-1.3.0
```
- 生成配置文件
```bash
./bin/alluxio bootstrapConf localhost
```

## 格式化Alluxio
我们格式化Alluxio为启动Alluxio做准备。如下命令会格式化Alluxio的日志和worker存储目录，以便接下来启动master和worker。
```bash
./bin/alluxio format
```
## 启动 
我们启动Alluxio！Alluxio默认配置成在localhost启动master和worker。我们可以用如下命令在localhost启动Alluxio：
```bash
./bin/alluxio-start.sh local
```
如果希望启动worker，则在配置文件workers中配置所有worker的hostname或ip，回车分割
```bash
./bin/alluxio-start.sh all
```
恭喜！Alluxio已经启动并运行了！你可以访问http://localhost:19999查看Alluxio master的运行状态，访问http://localhost:30000查看Alluxio worker的运行状态。

## 使用Alluxio Shell
- 列出文件
```bash
./bin/alluxio fs ls /
```
- 上传文件
```bash
./bin/alluxio fs copyFromLocal LICENSE /LICENSE
```
- 查看文件
```bash
./bin/alluxio fs cat /LICENSE
```

## 关闭
```bash
./bin/alluxio-stop.sh all
```


## Alluxio后端存储（HDFS）
- 修改配置文件./conf/alluxio-env.sh
```properties
ALLUXIO_MASTER_HOSTNAME=${ALLUXIO_MASTER_HOSTNAME:-"BJYFF3-Basketball-170132"}
ALLUXIO_WORKER_MEMORY_SIZE=${ALLUXIO_WORKER_MEMORY_SIZE:-"85688MB"}
ALLUXIO_RAM_FOLDER=${ALLUXIO_RAM_FOLDER:-"/mnt/ramdisk"}
ALLUXIO_UNDERFS_ADDRESS=hdfs://ns2/user/maobaolong/mbl
```
- 修改配置文件./conf/alluxio-c
```properties
alluxio.underfs.hdfs.configuration=/home/maobaolong/hadoop_conf/hdfs-site.xml
```

## 所有配置
[1.3版本所有配置](http://www.alluxio.org/docs/1.3/cn/Configuration-Settings.html)


## mount 
bin/alluxio fs mount -readonly /test /software/temp/test/

## alluxio使用非root用户启动集群的问题分析
mount -t ramfs -o size=100G ramfs /home/appadmin/ramdisk
chown appadmin:appadmin /home/appadmin/ramdisk
alluxio-start all NoMount

## mvn install
mvn clean install -Dhadoop.version=2.7.1 -Pyarn,spark -DskipTests -Dfindbugs.skip -Dmaven.javadoc.skip -Dcheckstyle.skip
 
## ReadType
- 读类型
  - CACHE_PROMOTE:
    如果读取的数据在Worker上时，该数据被移动到Worker的最高层。如果该数据不在本地Worker的Alluxio存储中，那么就将一个副本添加到本地Alluxio Worker中，用于每次完整地读取数据快。这是默认的读类型。
  - CACHE:
    如果该数据不在本地Worker的Alluxio存储中，那么就将一个副本添加到本地Alluxio Worker中，用于每次完整地读取数据快。
  - NO_CACHE:
    不会创建副本。

- 写类型
  - CACHE_THROUGH
    数据被同步地写入到Alluxio的Worker和底层存储系统。
  - MUST_CACHE
    数据被同步地写入到Alluxio的Worker。但不会被写入到底层存储系统。这是默认写类型。
  - THROUGH
    数据被同步地写入到底层存储系统。但不会被写入到Alluxio的Worker。
  - ASYNC_THROUGH
    数据被同步地写入到Alluxio的Worker，并异步地写入到底层存储系统。处于实验阶段。
