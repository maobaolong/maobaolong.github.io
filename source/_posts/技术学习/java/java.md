---
title: java 远程调试
date: 2016-11-09 15:13:48
tags: [技术学习,java]
categories: 技术学习
keywords: 技术学习,java,远程调试
description: 介绍java远程调试

---

## 远程调试
```
java -Xdebug -Xnoagent -Djava.compiler=NONE -Xrunjdwp:transport=dt_socket,server=y,suspend=y,address=2345 Main
```

## 运行jar中的包含main函数的类
``` java -cp  app.jar  a.b.C 
//其中C是类位于a.b包,C类中包含main
```