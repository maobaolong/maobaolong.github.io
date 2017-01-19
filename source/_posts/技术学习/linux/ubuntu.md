---
title: ubuntu
date: 2016-11-09 15:13:48
tags: [技术学习,linux,ubuntu]
categories: 技术学习
keywords: 技术学习,linux,ubuntu
description: 介绍ubuntu 命令，配置
---

## 删除无用软件
1. 删除libreoffice
```
    sudo apt-get remove libreoffice-common
```
2. 删除Amazon的链接
```
    sudo apt-get remove unity-webapps-common
```
3. 删掉基本不用的自带软件
```
    sudo apt-get remove thunderbird totem rhythmbox empathy brasero simple-scan gnome-mahjongg aisleriot gnome-mines cheese transmission-common gnome-orca webbrowser-app gnome-sudoku landscape-client-ui-install
    sudo apt-get remove onboard deja-dup
```


## 常用软件

| 名称                | 说明                                    |
|--------------------|----------------------------------------|
|    ssh             |  客户端       |
|    openssh-server             |  服务端       |
|    mysql-server    ||
|    mysql-client    ||
|wine||
|gdebi||
|virtualbox| 虚拟机|
|chrome||
|sougou|||
|wps||
|idea||
|hadoop||
## 中文字体

```
	sudo apt-get install ttf-mscorefonts-installer #微软字体  
	sudo apt-get install xfonts-wqy  #文泉驿-点阵宋体  
	cd ~  
	wget http://www.stchman.com/tools/MS_fonts/tahoma.zip #Tahoma 字体  
	sudo unzip -d /usr/share/fonts/truetype/msttcorefonts ~/tahoma.zip  
	sudo fc-cache -f -v  
	rm -f ~/tahoma.zip  
	sudo fc-cache -f -s -v   #刷新字体缓存  
```


## 解压配置





## 常见问题
### root下无法输入中文


/etc/profile中 export XMODIFIERS=@im=fcitx GTK_IM_MODULE=xim

### WPS下搜狗输入法不能输入中文


原因：环境变量未正确设置
$ vi /usr/bin/wps
在第一行 #!/bin/bash 下添加：
export XMODIFIERS="@im=fcitx"
export QT_IM_MODULE="fcitx"

ppt、excel部分
和word一样的方法添加环境变量，只是编辑的文件各不同：
$ vi /usr/bin/wpp
$ vi /usr/bin/et

### idea root无法输入中文


在IDEA的bin目录下的idea.sh文件的前面加上：
export XMODIFIERS=@im=fcitx export QT_IM_MODULE=fcitx


### 无法打开系统设置
sudo apt-get install unity-control-center


###  Ubuntu上方边栏不显示时间，有三中可能原因及相应的解决方法：

	1. 原因：系统设置为了不显示时间。
解决方法：右上角小齿轮->系统设置->时间和日期->时钟->勾选“在菜单栏显示时钟”

	2. 原因：显示时间的进程出错了。

	3. 解决方法：重新登录，或重启电脑，或使用下述命令：
sudo restart lighddm
警告：该命令会使所有用户退出登录。

	4. 原因：indicator-datetime 被误删了。
解决方法：重新安装indicator-datetime。 首先，在确认indicator-datetime确实被误删之后，使用命令sudo apt-get install indicator-datetime 安装。其次，配置日期时间：sudo dpkg-reconfigure --frontend noninteractive tzdata 。最后，重启unity：sudo killall unity-panel-service 。


### 设置分辨率 xrandr
```
sudo xrandr -s 1360x768_60
```