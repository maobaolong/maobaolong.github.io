---
title: mysql
date: 2016-11-09 15:13:48
tags: [技术学习,数据库,mysql]
categories: 技术学习
keywords: 技术学习,数据库,mysql
description: 介绍mysql的命令
---
[TOC]
## mysql启动服务

### 启动mysql：
方式一：sudo /etc/init.d/mysql start 
方式二：sudo start mysql
方式三：sudo service mysql start

### 停止mysql：
方式一：sudo /etc/init.d/mysql stop 
方式二：sudo stop mysql
方式san：sudo service mysql stop

### 重启mysql：
方式一：sudo/etc/init.d/mysql restart
方式二：sudo restart mysql
方式三：sudo service mysql restart


	* 以root用户登入

mysql -u root -p

### 创建普通用户

create user 'salt'@'localhost';  
set password for 'salt'@'localhost' = password('salt'); 

### 创建数据库

create database UGDAP;

### 显示所有数据库

show databases;

### 为用户salt授予数据库UGDAP下所有表打所有权限

grant all privileges on UGDAP.* to salt@localhost identified by 'salt';
flush privileges;

### 以salt用户登入（远程登入）

mysql -u salt -psalt
mysql -h 192.168.200.213 -P 3306 -usalt -psalt


### 使用指定数据库

use UGDAP;

### 查看所有表

show tables; 

### 删除库和表

drop database 库名; 
drop table 表名； 

### 将表中记录清空

delete from 表名; 

### 创建表

create table tb_emp1
(
 id  INT(11),
 name VARCHAR(25),
 deptid  INT (11),
 salary FLOAT
);


### 显示表结构

describe tb_emp1;

### 导入sql/执行sql脚本（shell中以及mysql中）

mysql db_name < text_file
mysql db_name -u username -p < text_file  

mysql> source file_name
mysql> \. file_name

### 导出数据库

mysqldump -h 192.168.200.213 -P 3306 -usalt -psalt --default-character-set=utf8 UGDAP>./UGDAP.sql



### 卸载mysql

```
sudo rm /var/lib/mysql/ -R

//删除mysql的数据文件


sudo rm /etc/mysql/ -R

//删除mqsql的配置文件

sudo apt-get autoremove mysql* --purge

sudo apt-get remove apparmor

sudo apt-get autoremove
1 sudo apt-get autoremove --purge mysql-server-5.0
2 sudo apt-get remove mysql-server
3 sudo apt-get autoremove mysql-server
4 sudo apt-get remove mysql-common (非常重要)

dpkg -l |grep ^rc|awk '{print $2}' |sudo xargs dpkg -P
```








	* 安装 mysql


1 sudo apt-get install mysql-server
2 sudo apt-get install mysql-client
3 sudo apt-get install php5-mysql(安装php5-mysql 是将php和mysql连接起来 ) 

一旦安装完成，MySQL 服务器应该自动启动。您可以在终端提示符后运行以下命令来检查 MySQL 服务器是否正在运行：
1 sudo netstat -tap | grep mysql


当您运行该命令时，您可以看到类似下面的行：
tcp 0 0 localhost.localdomain:mysql *:* LISTEN -如果服务器不能正常运行，您可以通过下列命令启动它：

1 sudo /etc/init.d/mysql restart

## 修改root用户密码
###第一步：修改Mysql配置文件
[root@liama01 ~]# vi /etc/my.cnf
在mysqld下，加入
```
skip-grant-tables
skip-networking
```
###第二步：重启Mysql后使用mysql -uroot -p 命令登入Mysql并修改密码
```
service mysqld restart
mysql -uroot -p 回车

mysql> use mysql
mysql> update user set password=PASSWORD('root') WHERE user="root";
mysql> flush privileges;
```
###第三步：去掉跳过，并重启服务

```
vi /etc/my.cnf
去掉skip-grant-tables和skip-networking
service mysqld restart
```
###第四步：重置密码
如果不重置会报错

ERROR 1820 (HY000): You must reset your password using ALTER USER statement before executing this statement.
执行重新设置密码
mysql> ALTER USER 'root'@'localhost' IDENTIFIED BY '********'

## 一条命令登录mysql 执行sql语句，然后退出
mysql -h ip -uuser -ppwd -e"select * from bdpops.t_static_data limit 1"
