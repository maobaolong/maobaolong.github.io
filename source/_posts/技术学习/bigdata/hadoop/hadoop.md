---
title: hadoop 命令
date: 2016-11-09 15:13:48
tags: [技术学习,hadoop]
categories: 技术学习
keywords: 技术学习,hadoop,cli
description: 介绍hadoop 命令
---
## 显示log
hadoop fs -cat /tmp/app-logs/prestotest/logs/application_1460457323828_0044/BJHC-Client-77104.hadoop.jd.local_50086

## 创建文件夹
hadoop fs -mkdir /user/admin/aaron/newDir

## 上传文件
hadoop fs –put /home/admin/newFile /user/admin/aaron/

## 下载文件
hadoop fs –get /user/admin/aaron/newFile /home/admin/newFile

## 显示所有job
hadoop job -list

