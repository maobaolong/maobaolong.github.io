---
title: hive命令
date: 2016-12-16 11:24:15
tags: [技术学习,bigdata,hive]
categories: 技术学习
keywords: 技术学习,bigdata,hive
description: hive命令

---

## 建表

```hive
create table mbltest
(id int,name string,age int,tel string)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY '\t'
STORED AS TEXTFILE
LOCATION '/user/maobaolong/mbltest';
```

## 查看表结构

```
desc formatted mbltest;
```

## 查看hdfs上的文件

```
dfs -cat hdfs://ns2/user/maobaolong/mbltest/mbltest.txt
```

## 加载数据到表中

### 从本地加载数据

```hive
load data local inpath '/home/maobaolong/mbltest.txt' overwrite into table mbltest;
```

###

```hive
load data inpath '/user/maobaolong/add.txt' into table wyp;
```

## 注意

和我们熟悉的关系型数据库不一样，Hive现在还不支持在insert语句里面直接给出一组记录的文字形式，也就是说，Hive并不支持INSERT INTO …. VALUES形式直接插入数据的语句。

## 生成job

```hive
select * from mbltest order by id desc;
```