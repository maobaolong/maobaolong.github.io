
---
title: Linux下文件类型及表示颜色
date: 2016-12-1 09:13:48
tags: [技术学习,linux]
categories: 技术学习
keywords: 技术学习,linux,shell
description: Linux下文件类型及表示颜色

---
# Linux下文件类型及表示颜色:

　　白色：普通文件 (用-表示)

　　n 红色：压缩文件

　　n 蓝色：目录文件 (用d表示)

　　n 青蓝色：链接文件 (用l表示)

　　n 黄色：设备文件(/dev目录下)(用b或c表示)

　　b表示的是物理设备;c表示的是字符终端设备.

　　n 青绿色：可执行文件(/bin、/sbin目录下)

　　n 粉红色：图片文件或是socket文件(用s表示)

　　n 青黄色：管道文件 (用p表示)

　　Linux下用字符表示的文件类型

　　-：普通文件

　　d：目录文件

　　l：链接文件

　　b：块设备文件

　　c：字符设备文件

　　p：管道文件

　　Linux文件系统配置文件

　　/proc-----内核提供的一个接口，主要用来存储系统统计信息;

　　/etc/mtab--------随着/proc/mount的变化而变化，文件系统的安装和卸载都会在这个文件中反映出来;

　　/etc/fstab-------列出当前系统在启动时自动安装的所有文件系统，也可以使用mount -a 这个命令来手动的安

　　装这个文件中列出的所有文件系统;另外也可以通过修改这个配置文件，使系统在启动时自动安装我们所需要

　　的其他的文件系统;

　　/etc/mtools.conf---------dos文件系统上的操作的配置文件

　　Linux系统管理配置文件

　　/etc/group----------列出有效的组名称以及组中的用户信息;

　　/etc/passwd---------帐号的密码文件;

　　帐号----密码------用户号(UID)-----用户组号(GID)----所属组-----用户主目录---用户所使用的shell类型

　　/etc/shadow--------包含加密后的帐号信息;

　　/etc/shells-------包含系统的可以使用的shell的列表;

　　/etc/motd---------每日的信息，root管理员向系统中所有用户传达信息时使用

　　Linux系统命令配置文件

　　/etc/lilo.conf 包含系统的缺省引导命令行参数，还有启动时使用的不同映象。您在 LILO 引导提示的时候按

　　Tab 键就可以看到这个列表。

　　/etc/logrotate.conf 维护 /var/log 目录中的日志文件。

　　/etc/identd.conf identd是一个超级服务器，这个文件对于的是它的配置文件。

　　/etc/ld.so.conf “动态链接程序”(Dynamic Linker)的配置。

　　/etc/inittab 按年代来讲，这是 UNIX 中第一个配置文件。在一台 UNIX 机器打开之后启动的第一个程序是

　　init，它知道该启动什么，这是由于 inittab 的存在。在运行级别改变时，init 读取 inittab，然后控制主进程的启动

　　Linux主机配置文件

　　/etc/host.conf---------告诉域名服务器如何查找主机名

　　/etc/hosts---------网络中已发现的主机的名称列表，用于解析主机名

　　/etc/sysconfig/network 主机名和网关的信息  

文件

　　Linux连网配置文件

　　/etc/gated.conf gated 的配置。只能被 gated 守护进程所使用。

　　/etc/networks 列举从机器所连接的网络可以访问的网络名和网络地址。通过路由命令使用。允许使用网络

　　名称。

　　/etc/protocols 列举当前可用的协议。

　　/etc/resolv.conf 在程序请求“解析”一个 IP 地址时告诉内核应该查询哪个名称服务器。

　　/etc/rpc 包含 RPC 指令/规则，这些指令/规则可以在 NFS 调用、远程文件系统安装等中使用。

　　/etc/exports 要导出的文件系统(NFS)和对它的权限。

　　/etc/services 将网络服务名转换为端口号/协议。由 inetd、telnet、tcpdump 和一些其它程序读取。有一些C访问例程。