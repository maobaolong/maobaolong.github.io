---
title: saltstack-minion
date: 2016-12-16 11:24:15
tags: [技术学习,bigdata]
categories: 技术学习
keywords: 技术学习,bigdata,saltstack,minion
description: saltstack-minion的命令

---

## salt命令列表
salt
salt-api
salt-call
salt-cp
salt-key
salt-master
salt-minion
salt-run
salt-ssh
salt-unity

## 在minion上查看正在执行的任务，可以通过文件来查看
ls /var/cache/salt/minion/proc
master的job
ls /var/cache/salt/master/jobs/

## master端的jobs，默认保存时间为24小时
```
root@salt-master:~# grep "keep_jobs" /etc/salt/master
#keep_jobs: 24
root@salt-master:~#
```

## 查看job
salt-run jobs.active

## 查看历史job
salt-run jobs.list_jobs | tail  -n 16

## 查看某个任务的执行结果
salt-run jobs.lookup_jid 20140625200258757661

## 某个结点执行命令
salt '172.16.166.34' cmd.run  'ls '

## 将本机的文件拷贝到 目标结点的/root/getIP.py
salt-cp '172.16.166.34'  ./getIP.py /root/getIP.py

