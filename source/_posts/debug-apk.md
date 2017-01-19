---
title: 全方位动态调试Apk
date: 2016-08-19 11:20:54
categories: Android
tags: 
    - 调试APk
    -  debug
---

# 软件调试分类

## 源码调试

多用于软件开发阶段，我们可以拿到软件源码，可以通过集成开发环境(Eclipse,Android Studio)来跟踪软件的变量等

## 汇编级调试

他通常用在逆向工程，分析人员通常拿不到源码，所以只能跟踪栈，分析目标文件的汇编代码和查看寄存器的值，这种方式调试显然没有源码调试那个直观，但是动态调试通用能够跟踪软件的执行流程。通常用在静态分析很难取得突破时，就只能上动态调试了

# Android对动态调试的支持

我们都知道android调试分为java代码的调试和ndk编译的代码调试，java程序使用dalvik虚拟机提供的调试特性来调试，他在最初的版本就加入了对调试的支持并实现了JDWP(java debug wire protocol,java调试有线协议)，所以说我们可以直接使用支持JDWP协议的调试器来调试android程序，如：jdb,eclipse,intellJ,jswat等，但是他并不支持JVMTI(java virtual machine tool interface,java虚拟机接口工具)



dalvik虚拟机为JDWP实现加入了DDM(dalvik debug monitor,davlik调试监视器)特性。他的实现为DDMS(dalvik debug monitor server,dalvik调试监控服务)，他集成到了eclipse和android studio(当然也可以单独运行)



dalvik虚拟机中所有调试的实现在dalvik/vm/jdwp/目录下

dalvik与JDWP之间的通讯桥梁位于dalvik/vm/Debugger.c

这样将代码分开的好处是，多个项目可以复用JDWP的代码



每一个开启了调试的Dalvik虚拟机都会启动一个JDWP线程，一直处于等待状态，直到DDMS或其他调试器来连接它，他只负责接收发来的调试连接，调试的处理则有其他相应的线程发出(比如：虚拟机遇到断点要通知调试器时)

# 开启Dalvik调试功能

当启动一个虚拟机时如果系统属性ro.debuggable=1(可通adb shell getprop ro.debuggable命令查看)时所有的程序都会开启调试支持，如果为0则在判断清单文件debuggable="true"只开启当前程序的调试支持



原生程序则使用传统的Linux程序调试方法来调试，如：GUN调试调试服务器(gdb)。其中原生程序又分动态链接库和可执行程序。动态链接库需要先启动android程序以加载他，然后在以附件的方式来调试，可执行程序则可以直接使用远程方式调试



# DDMS

## Android Studio

默认的窗口只显示了logcat和一些常用的工具，如：录屏，而ddms则需要手动打开，打开有两种方式，一种是通过菜单栏-tools-android-android devices-monitor

![](http://7qnc6h.com1.z0.glb.clouddn.com/ddms-as1.png)

另一种是通过快捷工具栏的android图标启动

![](http://7qnc6h.com1.z0.glb.clouddn.com/ddms-as2.png)

打开后的界面和eclipse里面的差不多，具体的就不细说了

# 怎么定位关键代码

不论是破解还是逆向研究一个应用，最难的就是定位到关键点代码，下面我们就说说有哪些方法可以定位

## log

当阅读反编译过来的文件时不太确定那个地方是关键点，我们就可以使用log方法在你怀疑是关键点的地方，注入log，然后在打包运行，就可以确定哪里是关键点，但是这个方法有个弊端是每次的改完文件还得编译签名安装，这步骤是很麻烦的

MyLog.smali

```
.class public Lex/ample/MyLog;
.super Ljava/lang/Object;
.source "MyLog.java"


# static fields
.field private static DEBUG:Z = false

.field private static final DEFAULT_TAG:Ljava/lang/String; = "DEFAULT_TAG"

.field private static final LOG_STRING:Ljava/lang/String; = "%s:%s:%d:%s"


# direct methods
.method static constructor <clinit>()V
    .locals 1

    .prologue
    .line 10
    const/4 v0, 0x1

    sput-boolean v0, Lex/ample/MyLog;->DEBUG:Z

    return-void
.end method

.method public constructor <init>()V
    .locals 0

    .prologue
    .line 5
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    return-void
.end method

.method public static e(Ljava/lang/Object;)V
    .locals 2
    .param p0, "msg"    # Ljava/lang/Object;

    .prologue
    .line 13
    sget-boolean v0, Lex/ample/MyLog;->DEBUG:Z

    if-eqz v0, :cond_0

    .line 14
    const-string v0, "DEFAULT_TAG"

    invoke-static {v0}, Lex/ample/MyLog;->getCallStackString(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v0

    invoke-static {p0}, Lex/ample/MyLog;->formatMessage(Ljava/lang/Object;)Ljava/lang/String;

    move-result-object v1

    invoke-static {v0, v1}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;)I

    .line 16
    :cond_0
    return-void
.end method

.method public static e(Ljava/lang/String;Ljava/lang/Object;)V
    .locals 2
    .param p0, "tag"    # Ljava/lang/String;
    .param p1, "msg"    # Ljava/lang/Object;

    .prologue
    .line 19
    sget-boolean v0, Lex/ample/MyLog;->DEBUG:Z

    if-eqz v0, :cond_0

    .line 20
    invoke-static {p0}, Lex/ample/MyLog;->getCallStackString(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v0

    invoke-static {p1}, Lex/ample/MyLog;->formatMessage(Ljava/lang/Object;)Ljava/lang/String;

    move-result-object v1

    invoke-static {v0, v1}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;)I

    .line 22
    :cond_0
    return-void
.end method

.method private static formatMessage(Ljava/lang/Object;)Ljava/lang/String;
    .locals 1
    .param p0, "msg"    # Ljava/lang/Object;

    .prologue
    .line 30
    if-nez p0, :cond_0

    .line 31
    const-string v0, ""

    .line 33
    :goto_0
    return-object v0

    :cond_0
    invoke-static {p0}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;

    move-result-object v0

    goto :goto_0
.end method

.method private static getCallStackString(Ljava/lang/String;)Ljava/lang/String;
    .locals 5
    .param p0, "defaultTag"    # Ljava/lang/String;

    .prologue
    const/4 v2, 0x4

    .line 25
    invoke-static {}, Ljava/lang/Thread;->currentThread()Ljava/lang/Thread;

    move-result-object v1

    invoke-virtual {v1}, Ljava/lang/Thread;->getStackTrace()[Ljava/lang/StackTraceElement;

    move-result-object v1

    aget-object v0, v1, v2

    .line 26
    .local v0, "stackTraceElement":Ljava/lang/StackTraceElement;
    const-string v1, "%s:%s:%d:%s"

    new-array v2, v2, [Ljava/lang/Object;

    const/4 v3, 0x0

    invoke-virtual {v0}, Ljava/lang/StackTraceElement;->getClassName()Ljava/lang/String;

    move-result-object v4

    aput-object v4, v2, v3

    const/4 v3, 0x1

    invoke-virtual {v0}, Ljava/lang/StackTraceElement;->getMethodName()Ljava/lang/String;

    move-result-object v4

    aput-object v4, v2, v3

    const/4 v3, 0x2

    invoke-virtual {v0}, Ljava/lang/StackTraceElement;->getLineNumber()I

    move-result v4

    invoke-static {v4}, Ljava/lang/Integer;->valueOf(I)Ljava/lang/Integer;

    move-result-object v4

    aput-object v4, v2, v3

    const/4 v3, 0x3

    aput-object p0, v2, v3

    invoke-static {v1, v2}, Ljava/lang/String;->format(Ljava/lang/String;[Ljava/lang/Object;)Ljava/lang/String;

    move-result-object v1

    return-object v1
.end method
```

使用方法也很简单，就是一个方法调用，可以传递一个tag或用默认的tag

```
const-string v0, "message"

invoke-static {v0}, Lex/ample/MyLog;->e(Ljava/lang/Object;)V
```

```
const-string v0, "message"

const-string v1, "TAG"

invoke-static {v1,v0}, Lex/ample/MyLog;->e(Ljava/lang/String;,Ljava/lang/Object;)V
```

## method profiling

我们都知道Ollydbg调试器有个trace功能，他能记录每个被调用的api名称，同时还能在关键性的api地方下断点。但是method profiling不能这样来设置断点，但可以记录方法的调用过程

使用方法是在ddms-devices标签列表先选中一个程序点击start method profiling按钮，然后操作应用你想关注的逻辑，然后在点击这个按钮就会弹出如下界面

![](http://7qnc6h.com1.z0.glb.clouddn.com/method-profiling1.png) 

可以看到name处就是方法调用列表，每个方法可以展开。如果我们要已启动界面就开跟踪方法，那我们就可以通过代码方式来加入，在要开始跟踪方法的位置添加开始跟踪方法

```
Debug.startMethodTracing("a");
```

在合适的地方关闭跟踪

```
Debug.stopMethodTracing();
```

这样就会在/sdcard/下生产a.trace文件，导出到电脑，用traceview a.trace命令分析这个文件，这个工具在sdk\tools\目录下

# AndBug


























