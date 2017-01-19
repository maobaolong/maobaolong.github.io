---
title: 使用Build Variants和productFlavors来打包不同配置的APP
date: 2016-06-21 09:56:32
categories: Android
tags: 
    - Build Variants
    - Product Flavors
---
## 背景

众所周知，在一个软件从开发到上线，需要经历多个测试环境来测试，最直接的就是各个测试环境Api地址不一样，以前我们都是在一个文件写多个Api，然后注释或打开，但是有了Build Variants从此我们可以更优雅的解决这个问题了

## 配置不同的Api环境

假设我们的App有三个测试环境：
api1：完全的测试环境，里面的内容可以随便添加，随便删除，也可以叫dev
api2：是线上环境一个镜像，但数据差一天
api：线上环境

我们的要实现的就是，根据一个配置，或者打包不同的版本App是不是打开文件来注释一些代码，而是有一个总开关，这样方便控制，不同的环境其实也相当于渠道包，所以下面我们首先需要配置几个渠道

### 配置渠道

我们在项目的build.grade的android中添加：

```groovy
productFlavors{
    api1{

    }

    api2{

    }
    api{

    }
}
```

我们根据app的一个测试环境来配置了一些渠道包，到这里我们可以看到已经有多个Build variants了，如下图：

![](http://7qnc6h.com1.z0.glb.clouddn.com/build_variants.png)

那我们问题来了，到这里不，他就知道我们api1对应什么域名了，当然是肯定不知道，因为我们什么都还没用定义，所以接下来，我们需要根据渠道创建不同的配置目录

### 根据渠道创建配置文件

然后再在相应的创建一个Api.java，然后更改endpoint的值，创建完后我们的目录结构：

![](http://7qnc6h.com1.z0.glb.clouddn.com/create_build_variants_api.png)

其中api1目录中的Api.java内容：

```java
public class Api {
    public static final String ENDPOINT = "http://api1.baidu.com";
}
```

正常工作中到这一步，就可以实现不同的版本使用不同的Api，但是这里我为了更直观，所以在textview显示当前的endpoint和Build type

### 测试是否更改了endpoint

```java
TextView tv_info = (TextView) findViewById(R.id.tv_info);
StringBuilder stringBuilder = new StringBuilder();
stringBuilder.append("Endpoint:");
stringBuilder.append(Api.ENDPOINT);
stringBuilder.append("\n");

stringBuilder.append("Build type:");

if (BuildConfig.DEBUG) {
    stringBuilder.append("debug");
} else {
    stringBuilder.append("release");
}
stringBuilder.append("\n");
tv_info.setText(stringBuilder.toString());
```

我们部署不同的版本，会发现内容却是改变了

api1:


![](http://7qnc6h.com1.z0.glb.clouddn.com/api1-endpoint.png)

api2:

![](http://7qnc6h.com1.z0.glb.clouddn.com/api2-endpoint.png)

这种方法虽然我们更改了endpoint，但有时候也有这种需求，比如测试App我想测试app和正式app拥有不同的名字，甚至是不同的图标

## 替换部分AndroidManifest.xml

首先我们在清单文件配

置需要替换的地方配置上变量名

```xml
<application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="${app_name}"
```

然后在项目的build.grade的productFlavors里替换项目变量

```groovy
productFlavors {
    api1 {
        manifestPlaceholders = [app_name: "api1版本"]
    }

    api2 {
        manifestPlaceholders = [app_name: "api2版本"]
    }

    api {
        manifestPlaceholders = [app_name: "@string/app_name"]
    }
}
```

分别运行不同的版本即可查看效果

其实想要更改更改清单文件，也可以通过上面更改endpoint的方式更改，也就是把原来的清单文件复制一份到api目录，然后更改需要需更改的内容，比如我这里更改了label

```xml
<application
    tools:replace="android:label"
    android:allowBackup="true"
    android:icon="@mipmap/ic_launcher"
    android:label="完全更改清单文件"
```

更改完成后效果也是我们想要的，好了今天就到这里，，[源码可以这里下载](https://github.com/lifengsofts/TsetBuildVariants)
