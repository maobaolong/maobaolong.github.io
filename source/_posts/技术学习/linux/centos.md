---
title: CENTOS笔记
date: 2016-11-09 15:13:48
tags: [技术学习,linux,centos]
categories: 技术学习
keywords: 技术学习,linux,centos
description: 介绍centos软件安装，配置
---

# CENTOS笔记
[TOC]

##连接无线网
### ip addr
找到自己的无线网接口 （ps:本人的是wlp5s0）
### ip link set wlp5s0 up
打开无线网的驱动
### ip link show wlp5s0
查看该网络接口的状态

### 连接无线网
wpa_supplicant -B -i wlp5s0 -c <(wpa_passphrase "ssid" "psk") (连接无线网ssid，密码psk)

### dhcp分配ip
dhclient wlp5s0(为wlp5s0分配ip地址)


## 软件源
### 下载源
wget -O /etc/yum.repos.d/CentOS-Base.repo http://mirrors.aliyun.com/repo/Centos-7.repo
wget -O /etc/yum.repos.d/CentOS-Base.repo http://mirrors.163.com/.help/CentOS7-Base-163.repo

wget -O /etc/yum.repos.d/CentOS-Base.repo http://mirrors.sohu.com/help/CentOS-Base-sohu.repo
wget -O /etc/yum.repos.d/CentOS-Base.repo http://centos.ustc.edu.cn/CentOS-Base.repo

### 安装源
yum clean all
yum makecache

## ssh修改端口号
### step1 修改/etc/ssh/sshd_config
vi /etc/ssh/sshd_config
```
#Port 22         //这行去掉#号
Port 20000      //下面添加这一行
```
### step2 修改SELinux
yum -y install policycoreutils-python

使用以下命令查看当前SElinux 允许的ssh端口：
semanage port -l | grep ssh

添加20000端口到 SELinux
semanage port -a -t ssh_port_t -p tcp 20000

然后确认一下是否添加进去
semanage port -l | grep ssh
如果成功会输出
ssh_port_t                    tcp    20000, 22

### step3 重启ssh
systemctl restart sshd.service