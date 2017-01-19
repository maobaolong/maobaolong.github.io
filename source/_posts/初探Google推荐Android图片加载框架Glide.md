---
title: 初探Google推荐Android图片加载框架Glide
date: 2016-4-25 19:43:41
categories: Android
tags: 
    - Glide
---
## 简介

现在在Android上加载图片的框架都已经烂大街了，所以我们这里也不说谁好谁坏，当然也不做比较了，因为得出的结果都是片面的，没有谁好谁坏只有适不适合需求罢了

起因是在泰国举行的谷歌开发者论坛上，谷歌为我们介绍了一个叫Glide 的图片加载库，作者是bumptech。这个库被广泛的运用在google的开源项目中，包括2014年Google I/O大会上发布的官方App。需要特别说明的是这个不是一个官方库，个人感觉和Picasso特别像，当然这是第一个感觉，其实内部还真不太一样，[这是英文地址](http://inthecheesefactory.com/blog/get-to-know-glide-recommended-by-google/en)，[当然国内也翻译的参考这个里](http://jcodecraeer.com/a/anzhuokaifa/androidkaifa/2015/0327/2650.html)

当然啦还是安装我写博客的一贯作风啦，上来还是先运行下Demo，这样既然查看到要学这个库一些效果，更能理解大神的项目架构，多学学大神们的项目架构还是很有帮助的

## 运行Demo

首先我来到[Glide的github上](https://github.com/bumptech/glide)，可以看到这么多内

![](http://7qnc6h.com1.z0.glb.clouddn.com/e49x2ph7sbk5i3740yqn5lmhx5.png)

是不是一大部分看到这么多文件，都蒙蔽了，这

按照[Build的方式下载源代码](https://github.com/bumptech/glide#build)，而不是通过Download zip来下载，这里简单总结下步骤

```shell
git clone https://github.com/bumptech/glide.git
```

我们将代码clone到本地，然后使用android studio导入选择最外层的build.gradle文件，成功导入后如下图

![](http://7qnc6h.com1.z0.glb.clouddn.com/a6joj9zif3whfarcu8lf96yrs5.png)

其中：
library：是glide的源码
samples：里面都是demo了
third_party：是library的一些依赖库

现在我们可以运行一下其中的demo了，我们这里运行gallery，可以直接在android studio中运行，可以使用如下命令：

```shell
./gradlew :samples:flickr:run
./gradlew :samples:giphy:run
./gradlew :samples:svg:run
```
> 可以看到这里运行的是demo下面的一个工程的run方法，我们来看看大神们是怎么实现的，我们在gallery的build.gradle文件中到了如下代码

```groovy
task run(type: Exec, dependsOn: 'installDebug') {
    description 'Installs the APK and runs the main activity: "gradlew :samples:???:run"'
    commandLine "${android.sdkDirectory}/platform-tools/adb", 'shell', 'am', 'start', '-n', 'com.bumptech.glide.samples.gallery/.MainActivity'
}
```

这下我们就明白了他运行的run方式怎么来的了吧

还有一个值得学习的地方是，统一把sdk版本和依赖包的版本都放到了gradle.properties文件中，这样做的好处是，如果要更换版本只需要改这一个文件里面的就行了，那我们就来看看他是怎么写的吧，这里只看了gallery目录的build.gradle文件，其他的文件都差不多

```groovy
apply plugin: 'com.android.application'

dependencies {
    compile project(':library')
    compile(project(':integration:recyclerview')) {
        transitive = false
    }
    compile "com.android.support:support-v4:${SUPPORT_V4_VERSION}"
    compile "com.android.support:recyclerview-v7:${SUPPORT_V7_VERSION}"
}

android {
    compileSdkVersion COMPILE_SDK_VERSION as int
    buildToolsVersion BUILD_TOOLS_VERSION

    defaultConfig {
        applicationId 'com.bumptech.glide.samples.gallery'
        minSdkVersion MIN_SDK_VERSION as int
        targetSdkVersion TARGET_SDK_VERSION as int
        versionCode 1
        versionName "1.0"
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_7
        targetCompatibility JavaVersion.VERSION_1_7
    }
}

task run(type: Exec, dependsOn: 'installDebug') {
    description 'Installs the APK and runs the main activity: "gradlew :samples:???:run"'
    commandLine "${android.sdkDirectory}/platform-tools/adb", 'shell', 'am', 'start', '-n', 'com.bumptech.glide.samples.gallery/.MainActivity'
}
```

可以看到${SUPPORT_V4_VERSION}，COMPILE_SDK_VERSION这样的变量，然而他的值是在gradle.properties文件中设置的

```
COMPILE_SDK_VERSION=22
BUILD_TOOLS_VERSION=22.0.1
TARGET_SDK_VERSION=22
MIN_SDK_VERSION=10
```

个人觉得使用这种方式来管理一个项目的一些参数都是很不错的，比如：编译sdk版本，依赖版本或者是一些配置参数

这里可以查看到[官网编译好的jar包](https://github.com/bumptech/glide/releases)

可以看到这个demo会显示我们手机里所有的图片

![](http://7qnc6h.com1.z0.glb.clouddn.com/rvfs4xsc9ykfbqozcu7uvyaz17.png)

现在demo的运行就介绍到这里了，至于其他的，大家就可以自己改改demo然后运行看到效果了，现在就来说说常用的使用方法

## 安装依赖包

这个方式就有很多了，大家选用自己适合的方式

### 现在编译好的依赖

[这里可以下载官方已经编译好的jar](https://github.com/bumptech/glide/releases)

### Gradle

因为Glide的库已经上传到了jcenter，所以我们可以直接在项目最外层的build.gradle文件中添加依赖

```groovy
dependencies {
  compile 'com.github.bumptech.glide:glide:3.7.0'
  compile 'com.android.support:support-v4:19.1.0'
}
```

### Maven

```xml
<dependency>
  <groupId>com.github.bumptech.glide</groupId>
  <artifactId>glide</artifactId>
  <version>3.7.0</version>
</dependency>
<dependency>
  <groupId>com.google.android</groupId>
  <artifactId>support-v4</artifactId>
  <version>r7</version>
</dependency>
```

## Proguard

这一步非常重要，所以不管你混不混淆都添加上，不然哪天想混淆了，到处找要忽略的包，这是一件很痛苦的事情，因为你的依赖库肯定不止这一个
```
-keep public class * implements com.bumptech.glide.module.GlideModule
-keep public enum com.bumptech.glide.load.resource.bitmap.ImageHeaderParser$** {
  **[] $VALUES;
  public *;
}
```

## 简单使用

这一步都很简单啦，不用过多解释，直接看代码

```java
Glide.with(this).load(imgUrl).centerCrop().into(iv1);
```

## 设置暂未图和加载失败图

```java
Glide.with(context).load(datas.get(position)).placeholder(R.drawable.ic_launcher).error(R.drawable.error).centerCrop().crossFade().into(holder.iv);
```

## 加载封面图

一般情况下封面图可以是一个真是图片的小图或者是低像素版

```java
Glide.with(this).load(url).thumbnail(Glide.with(this).load(thumbUrl)).centerCrop().into(iv2);
```

## 从其他路径加载图片

通过API我们可以看见他重载了很多个方法

![](http://7qnc6h.com1.z0.glb.clouddn.com/hen1dg20yin97oaaeo2w8grhhb.png)

其中还有个自定义加载路径

## 加载图片到其他控件

这个需求是很常见的，比如我们需要为一个LinearLayout加载一个背景图片。其中可以用官方提供自定义Target的方法

```java
Glide.with(this).load(imgUrl).into(new SimpleTarget<GlideDrawable>() {
    @Override
    public void onResourceReady(GlideDrawable resource, GlideAnimation<? super GlideDrawable> glideAnimation) {
        linearLayout.setBackgroundDrawable(resource);
    }
});
```

## 调试信息

这些说明也可以在[官网](https://github.com/bumptech/glide/wiki/Debugging-and-Error-Handling)查看到

### 开启请求响应信息

在终端中执行
```shell
adb shell setprop log.tag.GenericRequest DEBUG
```
开启后我们可以查看logcat中输出这样的信息

![](http://7qnc6h.com1.z0.glb.clouddn.com/0cugchh20b43gqhoorej7qsqq6.png)

### 开启工作流日志

意思就是可以查看到内部是怎么查找资源，例如：是从内存，还是磁盘或网络获取的资源

```shell
adb shell setprop log.tag.Engine VERBOSE
adb shell setprop log.tag.EngineJob VERBOSE
adb shell setprop log.tag.DecodeJob VERBOSE
```

开启后输入如下日志信息

![](http://7qnc6h.com1.z0.glb.clouddn.com/gxefraii2gt7f6c760ij8hpu2q.png)

好了，基本使用就到这里了，下一篇会从源码的角度带你熟悉Glide，这样正好也学一学大师们怎么架构一个项目的，并且还能学到一些Glide高级使用，以上测试代码在我的[github上了](https://github.com/lifengsofts/TestImageLoader)

参考：http://www.open-open.com/lib/view/open1440397324450.html
