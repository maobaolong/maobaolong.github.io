---
title: tomcat
date: 2016-11-09 15:13:48
tags: [技术学习,web,tomcat,容器]
categories: 技术学习
keywords: 技术学习,web,tomcat,容器
description: 介绍tomcat
---
## 远程调试
Linxu系统: apach/bin/startup.sh开始处中增加如下内容： 

	1. declare -x CATALINA_OPTS="-server -Xdebug -Xnoagent -Djava.compiler=NONE -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=8788"   



.Windows系统: apach/bin/startup.bat开始处中增加如下内容： 

	1. SET CATALINA_OPTS=-server -Xdebug -Xnoagent -Djava.compiler=NONE -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=8788  


## tomcat 配置域名到多个工程目录配置
tomcat server.xml host appbase






