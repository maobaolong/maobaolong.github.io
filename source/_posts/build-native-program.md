---
title: android中原生代码的编译方式
date: 2016-08-14 16:45:58
categories: NDK
tags: 
    - ndk
    - ndk-build
    - make
---

# ndk

从android1.5就提供了原生的开发套件(Native Development Kit),从R8版本中支持3中cpu，分别是x86，mips,arm,我们一般以arm来讲解

## arm交叉工具链

android-ndk-r12b/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64/bin，前缀为arm-linux-androideabi-，他们和linux下面的gcc使用没什么区别，只是他们编译的程序是用于android平台的

```
arm-linux-androideabi-addr2line 将程序地址转换为文件名和行号
arm-linux-androideabi-ar 建立，修改，提取归档文件
arm-linux-androideabi-as gas汇编器
arm-linux-androideabi-c++ g++的一个拷贝
arm-linux-androideabi-c++filt 连接器使用它过滤符号，防止重载函数冲突
arm-linux-androideabi-cpp c++程序编译工具
arm-linux-androideabi-dwp 
arm-linux-androideabi-elfedit
arm-linux-androideabi-g++ c++编译工具
arm-linux-androideabi-gcc c程序编译工具
arm-linux-androideabi-gcc-4.9 gcc拷贝
arm-linux-androideabi-gcc-4.9.x gcc拷贝
arm-linux-androideabi-gcc-ar
arm-linux-androideabi-gcc-nm 
arm-linux-androideabi-gcc-ranlib 产生归档文件索引并保存到这个归档文件中
arm-linux-androideabi-gcov 程序覆盖度测量工具，记录代码的执行路径
arm-linux-androideabi-gcov-tool
arm-linux-androideabi-gprof 程序信息测量工具
arm-linux-androideabi-ld 连接器，用于生产可以执行文件
arm-linux-androideabi-ld.bfd
arm-linux-androideabi-ld.gold
arm-linux-androideabi-nm 列出目标文件中的符号
arm-linux-androideabi-objcopy 赋值目标文件中的内容到另一种类型的目标文件中
arm-linux-androideabi-objdump 输出目标文件的信息(反编译)
arm-linux-androideabi-ranlib 
arm-linux-androideabi-readelf 显示elf格式可执行文件信息
arm-linux-androideabi-size 显示目标文件每一段的大小以及文件的大小
arm-linux-androideabi-strings 输出目标文件的可打印字符串
arm-linux-androideabi-strip 去除目标文件中的符号信息
```

# 原生程序编译步骤

我们用下面的测试代码来测试几种编译方式

```c
#include <stdio.h>

int main(){
	printf("hello arm\n");
	return 0;
}
```

## gcc

使用gcc需要些makefile(当然也可以直接在目录行下面将依赖库传递给gcc)然后make命令来编译

### makefile

```mak
NDK_ROOT=/Users/renpingqing/Documents/android/android-ndk-r12b
TOOLCHAINS_ROOT=$(NDK_ROOT)/toolchains/arm-linux-androideabi-4.9/prebuilt/darwin-x86_64
TOOLCHAINS_PREFIX=$(TOOLCHAINS_ROOT)/bin/arm-linux-androideabi
TOOLCHAINS_INCLUDE=$(TOOLCHAINS_ROOT)/lib/gcc/arm-linux-androideabi/4.9/include-fixed

PLATFORM_ROOT=$(NDK_ROOT)/platforms/android-14/arch-arm
PLATFORM_INCLUDE=$(PLATFORM_ROOT)/usr/include
PLATFORM_LIB=$(PLATFORM_ROOT)/usr/lib

MODULE_NAME=hello
RM=rm -rf

FLAGS=-I$(TOOLCHAINS_INCLUDE) \
	-I$(PLATFORM_INCLUDE) \
	-L$(PLATFORM_LIB) \
	-nostdlib \
	-lgcc \
	-Bdynamic \
	-lc

OBJS=$(MODULE_NAME).o \
	$(PLATFORM_LIB)/crtbegin_dynamic.o \
	$(PLATFORM_LIB)/crtend_android.o

all:
	#$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -c $(MODULE_NAME).c -o $(MODULE_NAME).o
	#$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) $(OBJS) -o $(MODULE_NAME)

	#下面是分布来编译，一般情况下，用上面两条命令就行了
	#预处理
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -E $(MODULE_NAME).c -o $(MODULE_NAME).i

	#编译
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -S $(MODULE_NAME).i -o $(MODULE_NAME).s

	#汇编
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) -c $(MODULE_NAME).s -o $(MODULE_NAME).o

	#链接
	$(TOOLCHAINS_PREFIX)-gcc $(FLAGS) $(OBJS) -o $(MODULE_NAME)
clean:
	$(RM) *.o
install:
	adb push $(MODULE_NAME) /data/local/
	adb shell chmod 755 /data/local/$(MODULE_NAME)
	adb shell /data/local/$(MODULE_NAME)
```

FLAGS：变量添加了头文件和库文件上的搜索路径

all:指定了编译程序时需要的命令

clean:用于清理编译生成的文件

install:用来将生成的可执行文件push到手机并执行

> 注意：由于android没有采用标准的glibc库，而是用自己开发的bionic库，所以flags中需要加-nostdlib

### 编译

接下来我们只需要执行

```shell
make
make install
```

就可以看见如下输出

```
hello arm
```

如果makefile叫其他的名字那需要这样执行

```
make -f makefile1
```

> 注意：虽然我们可以通过makefile的方式来编译，但是官方推荐使用ndk-build来完成

## ndk-build

使用gcc来编译时很原始的，所以android开发了一套编译套件，其目录结构一般是在android工程下创建一个jni目录，然后在里面放入原生代码源文件。同时编译脚本

Android.mk：相当于makefile

Application.mk(可选):描述原始程序本身的一些特性，如：支持的指令集，stl支持

也放在这里

Android.mk

```
#定义本地源码的路径，调用了my-dir宏，有编译系统提供，返回Android.mk文件本身的路径，一般在源码跟目录
LOCAL_PATH := $(call my-dir)

# 让编译系统清除已经定义的宏，像LOCAL_ARM_MODE是全局的，当编译多个模块如果不清除将会导致混乱
include $(CLEAR_VARS)

#指定原生程序所使用的arm指令模式
LOCAL_ARM_MODE := arm

#指定生成后的模块名称，如果是共享库，生成libhello.so
LOCAL_MODULE := hello

#源码列表，多个用空格分开
LOCAL_SRC_FILES := hello.c

#指定生成的文件类型，BUILD_SHARED_LIBRARY：动态库，BUILD_EXECUTEABLE:可执行文件，BUILD_STATIC_LIBRARY:静态库
include $(BUILD_EXECUTABLE)
```

现在我们可以在jni上层目录执行

```
ndk-build
```

输出

```shell
[arm64-v8a] Compile        : hello <= hello.c
[arm64-v8a] SharedLibrary  : libhello.so
[arm64-v8a] Install        : libhello.so => libs/arm64-v8a/libhello.so
[x86_64] Compile        : hello <= hello.c
[x86_64] SharedLibrary  : libhello.so
[x86_64] Install        : libhello.so => libs/x86_64/libhello.so
[mips64] Compile        : hello <= hello.c
[mips64] SharedLibrary  : libhello.so
[mips64] Install        : libhello.so => libs/mips64/libhello.so
[armeabi-v7a] Compile arm    : hello <= hello.c
[armeabi-v7a] SharedLibrary  : libhello.so
[armeabi-v7a] Install        : libhello.so => libs/armeabi-v7a/libhello.so
[armeabi] Compile arm    : hello <= hello.c
[armeabi] SharedLibrary  : libhello.so
[armeabi] Install        : libhello.so => libs/armeabi/libhello.so
[x86] Compile        : hello <= hello.c
[x86] SharedLibrary  : libhello.so
[x86] Install        : libhello.so => libs/x86/libhello.so
[mips] Compile        : hello <= hello.c
[mips] SharedLibrary  : libhello.so
[mips] Install        : libhello.so => libs/mips/libhello.so
```

我们可以在当前目录看到生成libs目录有如下内容

```
arm64-v8a
	hello
armeabi
	hello
armeabi-v7a
	hello
mips
	hello
mips64
	hello
x86
	hello
x86_64
	hello
```

如果我们没有指定编译平台，他会编译所有平台。我只需要将arm下的hello文件push到手机，然后运行也可以看到上面同样的输出

### 源码不再jni目录

有时候我们的源码不一定放在jni目录，那么在当前目录执行ndk-build后有如下提示：

```
Android NDK: Could not find application project directory !    
Android NDK: Please define the NDK_PROJECT_PATH variable to point to it.    
/Users/renpingqing/Documents/android/android-ndk-r12b/build/core/build-local.mk:151: *** Android NDK: Aborting    .  Stop.
```

解决办法是要指定NDK_PROJECT_PATH等文件的路径

```
ndk-build NDK_PROJECT_PATH=. APP_BUILD_SCRIPT=./Android.mk
```

这样就可以编译了，会在当前目录下生产libs目录

## eclipse自动编译

大家可以发现如果我们的ndk代码很多而又是从java层调用这些代码，如果我改一点在手动编译，可以是说有点麻烦，所以接下来我们说说怎么是eclipse自动编译，所谓自动编译就是我改了c/c++文件，然后运行和java代码编译方式没什么两样，这里我们可以以官方的[hello-jni](https://github.com/googlesamples/android-ndk/tree/android-mk/hello-jni)例子来演示自动build

### 新建一个build

在项目右键-properties-builders-new，来到如下界面

![](http://7qnc6h.com1.z0.glb.clouddn.com/eclipse-build1.png)

我们按照上图填写，接下来我们来到refresh标签

![](http://7qnc6h.com1.z0.glb.clouddn.com/eclipse-build2.png)

build options

![](http://7qnc6h.com1.z0.glb.clouddn.com/eclipse-build3.png)

这一步我们除了勾选上图，还需要点击specify resource按钮选择jni目录，到这里基本配置完成了，单机ok，如果配置没问题，就会自动编译jni下面的源码。最重要的是，下次我们改变了jni下面的代码他会自动触发编译

## android studio

创建项目我就不说了。创建完成后再项目右键选择open module settings在sdk location的idk location中选择ndk目录

将源代码添加到main/jni目录下，不在需要Android.mk这样的文件了。在build.gradle开启ndk编译

```
defaultConfig {
    ...
    ndk{
        moduleName "hello-jni"    //lib的名称，对应LOCAL_MODULE
        //stl "stlport_shared"    //对应APP_STL
        ldLibs "log", "z", "m"  //链接时使用到的库，对应LOCAL_LDLIBS
        //cFlags 编译gcc的flag，对应LOCAL_CFLAGS
    }
}
```

添加完后，直接运行就可以编译了。如果报错

### Error: NDK integration is deprecated in the current plugin

如果编译时报错，详细错误信息如下

```
Error:Execution failed for task ':app:compileDebugNdk'.
> Error: NDK integration is deprecated in the current plugin.  Consider trying the new experimental plugin.  For details, see http://tools.android.com/tech-docs/new-build-system/gradle-experimental.  Set "android.useDeprecatedNdk=true" in gradle.properties to continue using the current NDK integration.
```

直接在gradle.properties中添加

```
android.useDeprecatedNdk=true
```

### 关闭自动编译

有时候我们想关闭自动as的自动编译，我们注释掉build.gradle的ndk配置，然后添加Android.mk，在jni上层目录执行ndk-build，但是他生成默认在libs目录下，我们需要手动创建jniLibs然后将libs下面的拷贝到当前目录。[以上测试代码在这里](https://github.com/lifengsofts/BuildNativeCodeSimple)





