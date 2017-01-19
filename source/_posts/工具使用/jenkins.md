---
title: jenkins
date: 2016-11-09 15:13:48
tags: [工具使用,jenkins]
categories: 工具使用
keywords: 工具使用,jenkins
description: 记录jenkins的安装和配置。
---
# jenkins

[TOC]

## 启动jenkins指定端口
java -jar jenkins.war --httpPort=9010
<font color=red>**后台启动的方法**</font>

nohup command > myout.file 2>&1 &
```
kill `ps -ef | grep [j]enkins.war | awk '{ print $2 }'`
```


## jenkins中通过execute shell启动的进程会被杀死的问题
[摘要：正在jenkins中设置装备摆设主动更新安排项目时，若是采用用execute shell启动/封闭tomcat，会发明能够举行封闭tomcat，然则没法启动tomcat，固然构建会表现履行乐成，然则检察过程，tomcat是出有启动的]
在jenkins中配置自动更新部署项目时，如果采取用execute shell启动/关闭tomcat，会发现可以进行关闭tomcat，但是无法启动tomcat，虽然构建会显示执行成功，但是查看进程，tomcat是没有启动的。这是因为Jenkins默认会在Build结束后Kill掉所有的衍生进程。需要进行以下配置，才能避免此类情况发生:
1. 重设环境变量build_id
  在execute shell输入框中加入BUILD_ID=DONTKILLME,即可防止jenkins杀死启动的tomcat进程
2. 在启动jenkins 的时候禁止jenkins杀死衍生进程
    修改/etc/sysconfig/jenkins配置，在JENKINS_JAVA_OPTIONS中加入-Dhudson.util.ProcessTree.disable=true。需要重启jenkins生效
    此方法配置一次后，所有的job都无需设置BUILD_ID，就能够防止jenkins杀死启动的tomcat进程



