---

title: 树莓派上ownCloud的安装

date: 2016-11-25 18:10:14

tags: [技术学习,linux,树莓派]

categories: 技术学习

keywords: 技术学习,linux,树莓派,rpi,raspberryPi,raspbian,owncloud,个人云

description: 树莓派上ownCloud的安装

---

# 树莓派上ownCloud的安装

```

sudo apt-get install apache2 php5 php5-gd php-xml-parser php5-intl php5-sqlite php5-mysql smbclient curl libcurl3 php5-curl mysql-server

```
## 安装apache
```
sudo apt-get install apache2
```
## 安装php

## 安装mysql

## 安装owncloud

```
$ tar xjf owncloud-4.5.6.tar.bz2
$ cp -r -v owncloud/ /var/www/owncloud/

```

## 安装ownCloud客户端
sudo apt-get install owncloud-client


/etc/init.d/apache2 restart