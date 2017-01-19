---
title: Win10不能启动WampServer图标呈橘黄色的解决方法
date: 2016-05-06 23:51:26
categories: PHP
tags: 
    - WampServer
---
## 简介

这么多年安装WampServer都没遇到过啥问题，都是安装完就能直接启动了，并且都可以用了，但是俗话说的好呀，天有不测风云果不其然今天在Win10安装了他就出问题了，下面慢慢道来

## 计算机中丢失 msvcr110.dll

当快安装完时，直接给弹出这窗口，妈蛋这一看就是缺少什么组建呀，不过这个时候你要是直接安装msvcr110.dll的话，估计安装完一会儿还缺少什么，所以要安装他所在的套件

![](http://7qnc6h.com1.z0.glb.clouddn.com/gzvkrr0ghgwahlkih7g8majyps.png)

所以就是要安装Visual C++ Redistributable for Visual Studio了，[可以直接在这里下载](https://www.microsoft.com/zh-CN/download/details.aspx?id=30679)打开后如下图

![](http://7qnc6h.com1.z0.glb.clouddn.com/u05frd3zd3yjhzym6571upv4h1.png)

我们直接点击下载，然后就到了选择平台界面了

![](http://7qnc6h.com1.z0.glb.clouddn.com/yymveqtqq1wnrb0473jlopx783.png)

因为我的是64位所以就选64位了，然后点击下一步下载完后直接安装了，然后再继续安装WampServer就没有问题了

## 图标橘黄色不能启动

但是当我启动时，右下角图标一直呈橘黄色，并且也是不能访问的，就这种

![](http://7qnc6h.com1.z0.glb.clouddn.com/mz776fqqn7xbhvvy1503fnf561.png)

但是我安装网上说的测试了80端口，卧槽也没有暂用呀，这样测试

![](http://7qnc6h.com1.z0.glb.clouddn.com/65r99yt62zqia3oex9ljd2yy14.png)

结果如下，显示没有暂用，妈蛋什么鬼，为啥不能启动呢？

![](http://7qnc6h.com1.z0.glb.clouddn.com/drix1k0gh42yytoi7apzq7s3jt.png)

最后我灵机一动卧槽，我安装的C盘，是不是有什么权限问题，然后直接就把原来的给卸载了，然后安装到D盘，果然就能启动了

![](http://7qnc6h.com1.z0.glb.clouddn.com/lcoejji4j48170spcefzdo8yqf.png)

然后打开http://localhost/多么熟悉的一幕出现了

![](http://7qnc6h.com1.z0.glb.clouddn.com/y58da75ve4zyfym3150635p5e9.png)

![](http://7qnc6h.com1.z0.glb.clouddn.com/ctyyue2i4rqz1pqqm2xwl7db1e.png)