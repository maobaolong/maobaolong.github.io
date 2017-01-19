---
title: haproxy
date: 2016-11-09 15:13:48
tags: [工具使用,haproxy]
categories: 工具使用
keywords: 工具使用,haproxy
description: 记录haproxy的安装。
---

## 编译1

uname -a 查看linux版本
vim -R README   ，查找 ?linux ，N查找下一个，找到linux版本对应target
make TARGET=linux2628


## ubuntu apt-get install haproxy安装即可



## centos 用yum安装即可

yum haproxy -y
haproxy x86_64 1.5.14-3.el7 base 833 k
