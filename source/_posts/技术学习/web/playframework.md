---
title: playframework
date: 2016-11-09 15:13:48
tags: [技术学习,web,playframework,框架]
categories: 技术学习
keywords: 技术学习,web,playframework,框架
description: 介绍playframework

---


目录结构
```
web_app                         根目录               
|   sbt                         SBT Unix 批处理脚本用于启动sbt-launch.jar 
|   sbt.bat                     SBT Windows 批处理脚本用于启动sbt-launch.jar 
|   sbt-launch.jar              SBT 启动的Java可执行类库
|
+---app                         Play Web 应用全部代码所在目录
|   |
|   +---models                  模型代码所在目录
|   |       Message.scala       留言板例程模型代码
|   |
|   +---controllers             控制器代码所在目录
|   |       Application.scala   默认控制器代码
|   |
|   \---views                   视图（Play Scala HTML模板） 代码所在目录
|           main.scala.html     主模板文件
|           index.scala.html    首页模板文件
|           msgboard.scala.html 留言板例程模板文件
|
+---conf                        Play 配置文件所在目录
|       application.conf        应用配置文件
|       routes                  应用入口路由文件，所有的HTTP请求将通过该文件转发到指定的Scala对象处理
|
+---logs                        日志目录
|       application.log         应用运行日志
|
+---project                     SBT工程文件
|       build.properties        保存所需的SBT版本信息，通常无需更改
|       Build.scala             主要的工程配置文件
|       plugins.sbt             告知SBT本工程所需要的插件以及下载位置
|
+---public                      存储一切直接发送给浏览器的资源文件
|   |
|   +---images                  图像文件，如JPEG、PNG、GIF等
|   |
|   +---javascripts             JavaScript脚本文件
|   |
|   \---stylesheets             CSS样式表文件
|
\---target                      存放编译后的可执行代码和编译时的中间代码

```

![](https://www.playframework.com/documentation/1.1.1/images/diagrams_path)

执行play,进入play命令行后，执行:
idea with-sources=yes 或者 eclipse with-source=true.生成对应的工程文件，之后，可以用eclipse或idea导入工程； 






