---

title: mysql sql语法
date: 2016-11-09 15:13:48
tags: [技术学习,数据库,mysql,sql]
categories: 技术学习
keywords: 技术学习,数据库,mysql,sql
description: 介绍mysql的sql语句

---

# mysql 语句

## 返回players表中town列所有数据项打集合以','分割的集合
SELECT group_concat(town) FROM `players` group by town

## 获取符合条件的记录个数，表头为count
select count(*) as count from t_cluster_config_xml where cluster_name = 'alto'

## 如果存在则不插入
insert into t_cluster_config_xml(a,b)
select a,b from DUAL WHERE NOT EXISTS(SELECT a FROM t_cluster_config_xml WHERE a = 'a');


## 建表字符格式及长度
- CHAR(M) [BINARY]
一个定长字符串，当存储时，总是是用空格填满右边到指定的长度。M的范围是1 ～ 255个字符。当值被检索时，空格尾部被删除。CHAR值根据缺省字符集以大小写不区分的方式排序和比较，除非给出BINARY关键词。NATIONAL CHAR（短形式NCHAR)是ANSI SQL的方式来定义CHAR列应该使用缺省字符集。这是MySQL的缺省。CHAR是CHARACTER的一个缩写。

- TINYBLOB
- TINYTEXT
一个BLOB或TEXT列，最大长度为255(2^8-1)个字符。
- BLOB
- TEXT
一个BLOB或TEXT列，最大长度为65535(2^16-1)个字符。

- MEDIUMBLOB

- MEDIUMTEXT
一个BLOB或TEXT列，最大长度为16777215(2^24-1)个字符。
- LONGBLOB

- LONGTEXT
一个BLOB或TEXT列，最大长度为4294967295(2^32-1)个字符。

## 数值类型长度(M)的含义
[原文](http://www.cnblogs.com/stringzero/p/5707467.html)
m 不是表示的数据长度，而是表示数据在显示时显示的最小长度。
当字符长度超过(m)时，相当于啥都没发生；
当字符长度小于(m)时，就需要指定拿某个字符来填充，比如zerofill（表示用0填充），
设置tinyint(2) zerofill 你插入1时他会显示01；设置tinyint(4) zerofill 你插入1时他会显示0001。
所以，没有zerofill，(m)就是无用的。

**_真相在这里_**

| 类型         | 长度 |范围                                             |名称     |
|------------|------|------------------------------------------|--------|
|TINYINT      |1字节  |(-128，127) (0，255)                             |小整数值 |
|SMALLINT     |2 字节 |( -2^15 ：-32 768，2^15 - 1：32 767) (0，65 535) |大整数值 |
|MEDIUMINT    |3 字节 |(-8 388 608，8 388 607) (0，16 777 215)          |大整数值 |
|INT或INTEGER |4 字节 |(-2^31， 2^31 - 1) (0，4 294 967 295)            |大整数值 |
|BIGINT       |8 字节 |(-2^63，2^63-1) (0，18 446 744 073 709 551 615) |极大整数值|