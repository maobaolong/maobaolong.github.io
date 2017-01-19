---
title: 加强版Apktool堪称逆向神器
date: 2016-08-15 23:13:59
categories: Apktool
tags: 
    - Apktool
---
# 简介

首先基本使用我就不讲了，这里只说我在apktool上扩展的两个小功能，一个是自动签名，一个是自动安装。可以实现什么功能呢，就是你更改了代码后，以前是build-sign-install，然后才能在手机上测试。但是现在就是一句话就可以完成这个三个步骤，可以说是你完全感觉不到这两步的存在，但是在静态分析smali时有很大的帮助

# 自动签名

首先自动签名的前提是要一个配置文件和签名文件，把他们放到和apktool同一目录，keystore可以不放同一目录，但在配置文件使用绝对路径，如下图

```
test.keystore
apktool
apktool.jar
sign.conf
```

其中test.keystore就是你创建的签名文件，至于怎么创建，可以用eclipse也可以用命令创建，也可以用现有的

sign.conf就是配置文件,内容如下：

```
jarsigner -keystore test.keystore -storepass 123456 -signedjar %s %s a123456
```

我们可以看见有两个%s，他们是最终会被替换成成apk的真是路径，大家安装这样写就行了，现在我们就可以试试自动签名了，执行下面的命令

```
apktool b -si app
```

其中-si就是自动签名的选项，签名完成后会在dist中生成app-sign.apk，你可以手动安装

# 自动安装

当我们自动签名后，我们希望自动安装

可以在加一个-ri选项,如下面这条命令

```
apktool b -si -ri app
```

就可以实现自动签名和安装，每次修改完代码执行他就行了，是不是很方便呢。[代码仓库在这里](https://github.com/lifengsofts/Apktool)其中生成好的apktool.jar在仓库的art文件夹下面，你只需要下载这三个文件就行了



这两个命令可以通过apktool的帮助查看到

```
usage: apktool b[uild] [options] <app_path>
 -f,--force-all          Skip changes detection and build all files.
 -i,--install            Install this apk.
 -o,--output <dir>       The name of apk that gets written. Default is dist/name.apk
 -p,--frame-path <dir>   Uses framework files located in <dir>.
 -ri,--reinstall         Reinstall this apk.
 -si,--sign              Sign this apk.
```

其中我添加的-si和-ri，也就是上面说的两个命令，-i也是安装，但不是覆盖，所以不常用