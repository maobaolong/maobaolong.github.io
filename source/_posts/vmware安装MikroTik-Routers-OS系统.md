---
title: vmware安装MikroTik-Routers-OS系统
date: 2016-06-09 21:57:06
categories: Router OS
tags: 
    - mikrotik
---

## 什么是RouterOS

MikroTik RouterOS是一种路由操作系统，是基于Linux核心开发，兼容x86 PC的路由软件,并通过该软件将标准的PC电脑变成专业路由器，他有如下优点：

1、强大的防火墙功能：支持二到七层的防火墙规则，实时监控网络的异常行为，及时发现及时禁止。　　
2、有效的带宽管理：优化网络、合理分配网络带宽，有效预防网络拥塞，尽可能保障网络传输通畅。　　
3、邮件安全：邮件备份、邮件杀毒，垃圾邮件过滤，确保对外联络的安全。　　
4、有效的抵御各种网络威胁：有效对上网人员的上网行为进行管理，制定相应访问策略，降低网络面临的安全风险，保障网络的安全。　　
5、多种接入方式：路由、网关、并接等多种接入方式，降低对网络的影响。在不改变网络环境的情况下，方便的实现对原有网络的管理。　　
6、规避法律风险：有效屏蔽非法网站，阻断上网人员的非法上网行为。　　
7、友好的管理界面：使用方便的WEB方式进行管理，无需安装任何客户端软件就可实现管理和控制。　　
8、提高工作效率：控制部分人员上网聊天、游戏等行为，从而提高工作效率。　　
9、降低网络管理成本：可使用现有的硬件。同支持网关、防火墙、路由器、IDS、内容监控等等功能，完全能满足一般的网络安全及管理的需求，无需购买 其他的网络 安全设备。有效的解决中小网络用户一方面对网络安全及网络管理方面的强烈需求另一方面又无法过多的投入去购买高昂的各种专业设备的矛盾。

而我们这里安装的是mikrotik的router os，同类软件有海蜘蛛等

## vmware安装RouterOS

### 下载系统

到[官网这里下载](http://www.mikrotik.com/download)根据你的CPU架构选择相应的版本，我这里下载的是X86架构

![](http://7qnc6h.com1.z0.glb.clouddn.com//kd1ugox52z5v13v381p05kkxzu.png)

我这里的版本是mikrotik-6.34.6.iso


### 创建虚拟机

安装虚拟机我这里就不说了，网上有教程，我这里使用的vm版本是11.0.0，系统选择ubuntu，版本也是
其中要注意的就是至少添加两块以上的网卡，模式为桥接模式，不是要勾选复制物理连接状态
硬盘的格式改为IDE模式

![](http://7qnc6h.com1.z0.glb.clouddn.com//o58vzzpark3aytywgr6pali8ux.png)

并移除必须要的硬件，比如：声卡，打印机，USB等，完成后的硬件配置如下：

![](http://7qnc6h.com1.z0.glb.clouddn.com//opgwqe0rdf7mbe7wh9il1d5gn9.png)

编辑CD/DVD添加上面下载的ISO文件，然后开启电源，就可以看到启动界面了

![](http://7qnc6h.com1.z0.glb.clouddn.com//1nvtapfkhww892wk3ydq4f2mx6.png)

可以看到是让我们选择安装什么样的套件，他预设了两种一种是全安装(a)，另一种是(m)，另外他还说按i键安装，我这里选择全部

![](http://7qnc6h.com1.z0.glb.clouddn.com//jtvsz0c72mlsoflsr2z2tmaxuh.png)

输入：y

安装完以后可以看到如下提示，说按ENTER键重启

![](http://7qnc6h.com1.z0.glb.clouddn.com//n94bq38utm15g1x019kfj5y5bf.png)

重启后可以看到如下界面：

并登陆，用户名admin，没有密码

![](http://7qnc6h.com1.z0.glb.clouddn.com//22a2mfwf8brwlclw2j7eoy8drt.png)

到这里我们就安装完成了，下面说的是怎么连接了

## winbox连接

我实在[这里下在](http://www.cr173.com/soft/32413.html)的winbox 3.30

打开后，我们点击这个按钮，他就会自动探测局域网中的软路由设备，并显示MAC地址

![](http://7qnc6h.com1.z0.glb.clouddn.com//h6rnk1t4adwvc76zru8uym8guv.png)

点击后可以看到我们刚刚安装的系统，并可以看到有两个MAC地址，因为我们刚刚添加了两块网卡

![](http://7qnc6h.com1.z0.glb.clouddn.com//1svrsfp461nbqfo82p9dccpcfp.png)

选择其中任意一个地址就能连接了，成功后如下图：

![](http://7qnc6h.com1.z0.glb.clouddn.com//ci99x6dlgeng6ykap7gski46xb.png)

第一步，我先设置这个路由器的一些信息，比如：IP

点击旁边的Quick Set，编写完毕

![](http://7qnc6h.com1.z0.glb.clouddn.com//o0u571h1wqyw4wsa5hcx8guiej.png)

到这步，我们就可以在手机上通过IP地址来管理他了，当然也可以网页管理了

## 网页管理

直接输入上面填写的IP，随便那一个都行，比如我的地址是：http://192.168.1.249/webfig/ 打开后可以看到如下界面：

![](http://7qnc6h.com1.z0.glb.clouddn.com//7dluz9359eculbzpjm4sfafrsh.png)

## 使用Tiktool管理

这是一个手机版本的Winbox，我这里使用的是Android版本，可以在[这里下载到](http://www.tiktool.com/)

填完用户名和ip地址后

![](http://7qnc6h.com1.z0.glb.clouddn.com//u5z9mqy86lx1d323m9p8jl8t9y.png)

点击连接，现在你可以直接在手机上管理路由啦

![](http://7qnc6h.com1.z0.glb.clouddn.com//su8y8022rfojq5trb6kwpp29sh.png)

好，今天的基本安装和使用就到这里啦