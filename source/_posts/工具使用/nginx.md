---

title: nginx
date: 2016-11-09 15:13:48
tags: [工具使用,nginx]
categories: 工具使用
keywords: 工具使用,nginx
description: 记录nginx的安装和配置。

---
## 启动
nginx 
## 重启
nginx -s reload
## 关闭
nginx -s stop

## 修改端口
/etc/nginx/conf/nginx.conf

## 查看端口占用
lsof -i tcp:80
lsof -i tcp:8999

## 检测配置文件是否正确，可以查看配置文件位置
sudo nginx -t

## 查看版本
sudo nginx -V

## 配置文件说明
server_namn : 域名;
