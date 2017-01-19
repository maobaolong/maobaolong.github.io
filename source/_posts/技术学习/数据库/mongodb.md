---
title: mongodb
date: 2016-11-09 15:13:48
tags: [技术学习,数据库,mongodb]
categories: 技术学习
keywords: 技术学习,数据库,mongodb
description: 介绍mongodb的命令
---
## 启动mongodb

./mongod --dbpath ../dbpath/ --logpath ../logs/mongodb.log --logappend &     --fork  


show dbs


## 使用数据库mydb
use mydb

## 显示表
show collections

## 查看表foo下的记录
db.foo.find()   
