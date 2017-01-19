---
title: vim
date: 2016-11-09 15:13:48
tags: [工具使用,vim]
categories: 工具使用
keywords: 工具使用,vim,linux软件
description: 介绍vim的命令
---
vim设置粘贴可以500行


	1. :set viminfo='1000,<500  


整体下移：ctrl + e
整体上移 : ctrl + y

显示行号：set nu

vim配置文件：/etc/vim/vimrc

查找字符串 ?内容    N下一个   n上一个

## 配置文件位置
vim /etc/vimrc
## 设置粘贴模式
 粘贴模式可以不带缩进粘贴
 
 `set paste`
 
 `set nopaste`
 
 也可以在.vimrc中设置切换的快捷键，比如设置F9，则可以在.vimrc中加入：
 `set pastetoggle=<F9>`