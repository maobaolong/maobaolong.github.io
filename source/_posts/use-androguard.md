---
title: androguard的基本使用
date: 2016-08-08 15:06:13
categories: androguard
tags: 
    - androguard
---
# 简介

androguard (Android guard) 是 Android 应用程序的逆向工程，提供恶意软件分析等等功能。

androguard 主要由 Python 编写，支持：

- DEX, ODEX
- APK
- Android's binary xml

安装过程比较复杂，请参考另一篇文章，下面就来说说一些工具的基本使用

# androapkinfo

用来列出apk的文件，权限，主activity,其他activity,service,receivers,providers

是否有native code,是否有动态代码，是否用了反射

```shell
./androapkinfo.py -i apk/app-debug.apk > apk/apkinfo.txt 
```

```
app-debug.apk :
FILES: 
	AndroidManifest.xml Android binary XML -6ccb1fe1
	res/anim-v21/design_appbar_state_list_animator.xml Android binary XML 6d63fc0c
	res/anim-v21/design_bottom_sheet_slide_in.xml Android binary XML -71f29031
	
	...

PERMISSIONS: 
	android.permission.INTERNET ['dangerous', 'full Internet access', 'Allows an application to create network sockets.']
MAIN ACTIVITY:  cn.woblog.weatherapp.MainActivity
ACTIVITIES: 
	cn.woblog.weatherapp.MainActivity {'action': [u'android.intent.action.MAIN'], 'category': [u'android.intent.category.LAUNCHER']}
	cn.woblog.weatherapp.activity.WeatherDetailActivity 
	cn.woblog.weatherapp.activity.TestActivity 
	cn.woblog.weatherapp.activity.SettingsActivity 
SERVICES: 
RECEIVERS: 
PROVIDERS:  []
Native code: False
Dynamic code: True
Reflection code: True
Ascii Obfuscation: False
Landroid/support/design/R$anim; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$anim; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$attr; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$attr; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$bool; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$bool; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$color; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$color; <init> ['ANDROID', 'SUPPORT']
Landroid/support/design/R$dimen; <init> ['ANDROID', 'SUPPORT']

...
```

# androaxml

用来解密apk包中的AndroidManifest.xml文件

```shell
./androaxml.py -i ./apk/app-debug.apk
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          package="cn.woblog.weatherapp"
          platformBuildVersionCode="24"
          platformBuildVersionName="7.000000"
          android:versionCode="1"
          android:versionName="1.0">
    <uses-sdk
        android:minSdkVersion="10"
        android:targetSdkVersion="24">
    </uses-sdk>
    <uses-permission android:name="android.permission.INTERNET">
    </uses-permission>
    <application
        android:name="com.android.tools.fd.runtime.BootstrapApplication"
        name="cn.woblog.weatherapp.AppContext"
        android:allowBackup="true"
        android:debuggable="true"
        android:icon="@7F030000"
        android:label="@7F060020"
        android:supportsRtl="true"
        android:theme="@7F080092">
        <activity
            android:name="cn.woblog.weatherapp.MainActivity"
            android:label="@7F060025"
            android:theme="@7F080039">
            <intent-filter>
                <action android:name="android.intent.action.MAIN">
                </action>
                <category android:name="android.intent.category.LAUNCHER">
                </category>
            </intent-filter>
        </activity>
        <activity
            android:name="cn.woblog.weatherapp.activity.WeatherDetailActivity"
            android:label="@7F060027"
            android:parentActivityName="cn.woblog.weatherapp.MainActivity"
            android:theme="@7F080039">
            <meta-data
                android:name="android.support.PARENT_ACTIVITY"
                android:value=".MainActivity">
            </meta-data>
        </activity>
        <activity
            android:name="cn.woblog.weatherapp.activity.TestActivity"
            android:label="@7F060026"
            android:theme="@7F080039">
        </activity>
        <activity android:name="cn.woblog.weatherapp.activity.SettingsActivity">
        </activity>
    </application>
</manifest>
```

# androsign

# androdd

用来生成apk文件中每个类的方法的调用流程图

```shell
./androdd.py -i ./apk/app-debug.apk -o ./apk -d -f PNG
```

# androdiff

用来比较两个apk文件的差异

```shell
./androdiff.py -i ./apk/smali-demo.apk ./apk/smali-demo-creacked.apk
```

# Androdump

用来dump一个linux进程的信息

用来生成APK的GEXF格式图形文件，可以用Gephi查看

```shell
./androgexf.py -i ./apk/smali-demo.apk -o ./apk/smali-demo.gexf
```

# androlyze

它提供一个交互式环境以提供我们分析apk

```shell
./androlyze.py -s
```

会进入一个shell交互式环境，我们可以通过他提供的对象来获取一些信息，经常用到的有3个对象：apk文件对象，dex文件对象，分析结果对象

## 获取一个apk对象

```shell
apk = APK("./apk/smali-demo-creacked.apk")
```

apk.show(),apk.files:输出结果和androapkinfo结果差不多

get_permissions():所有权限

get_providers()：所有ContentProvider

get_receivers()：所有BroadcastReceiver

get_services():所有service

## dex对象

```shell
dex=DalvikVMFormat(apk.get_dex())
```

他保存了dex文件中所有的类(class_)

d.CLASS_Landroid_support_annotation_AnimatorRes：表示android.support.annotation.AnimatorRes类

方法(method)

d.CLASS_Lcn_woblog_testsmali_MainActivity.METHOD_isRegister

MainActivity的isRegister方法

字段信息(class_field_)

d.CLASS_Lcn_woblog_testsmali_MainActivity.FIELD_oblog_testsmali_MainActivity.FIELD_TAG

### 查看方法详情

```
d.CLASS_Lcn_woblog_testsmali_MainActivity.METHOD_isRegister.pretty_show()
```

输出如下：

```shell
########## Method Information
Lcn/woblog/testsmali/MainActivity;->isRegister()Z [access_flags=private]
########## Params
local registers: v0...v2
- return: boolean
####################
***************************************************************************
isRegister-BB@0x0 : 
	0  (00000000) iget-object         v0, v2, Lcn/woblog/testsmali/MainActivity;->et_code Landroid/widget/EditText;
	1  (00000004) invoke-virtual      v0, Landroid/widget/EditText;->getText()Landroid/text/Editable;
	2  (0000000a) move-result-object  v0
	3  (0000000c) invoke-virtual      v0, Ljava/lang/Object;->toString()Ljava/lang/String;
	4  (00000012) move-result-object  v0
	5  (00000014) invoke-virtual      v0, Ljava/lang/String;->trim()Ljava/lang/String;
	6  (0000001a) move-result-object  v0
	7  (0000001c) const-string        v1, '321'
	8  (00000020) invoke-virtual      v0, v1, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
	9  (00000026) move-result         v0
	10 (00000028) return              v0

***************************************************************************
########## XREF
F: Lcn/woblog/testsmali/MainActivity; access$100 (Lcn/woblog/testsmali/MainActivity;)Z 0
####################
```

下面有个XREF表示对象方法引用关系

F:改方法被其他方法调用

T:指定的方法被本方法调用

### 显示java代码

d.CLASS_Lcn_woblog_testsmali_MainActivity.METHOD_isRegister.source()

我这里没测试通过一直报错

## 结果对象

```
result=VMAnalysis(dex)
```

也可以使用这个命令一次获得者三个对象

```
a,d,dr=AnalyzeAPK("./apk/smali-demo.apk")
```

# andromercury

# androrisk

用于评估apk文件中的风险

```
./androrisk.py -m -i ./apk/smali-demo.apk
```

```
RedFlags
DEX {'NATIVE': 0, 'DYNAMIC': 0, 'CRYPTO': 0, 'REFLECTION': 1}
APK {'DEX': 0, 'EXECUTABLE': 0, 'ZIP': 0, 'SHELL_SCRIPT': 0, 'APK': 0, 'SHARED LIBRARIES': 0}
PERM {'PRIVACY': 0, 'NORMAL': 0, 'MONEY': 0, 'INTERNET': 0, 'SMS': 0, 'DANGEROUS': 0, 'SIGNATUREORSYSTEM': 0, 'CALL': 0, 'SIGNATURE': 0, 'GPS': 0}
FuzzyRisk
VALUE 0.0
```

可以看到REFLECTION为1，表示代码中使用反射

# androsign

用于检测apk的信息是否存在于特定数据库中，他的作用于androcsign相反，我们可以将恶意信息的apk放到数据库，如果比对时发现相似信息，可以怀疑他也是恶意

```shell
./androsim.py -i ./apk/smali-demo.apk ./apk/smali-demo-creacked.apk
```

用来生成apk/jar/class/dex文件的控制流程以及功能调用图，输出格式为xgmml

```shell
/androxgmml.py -i ./apk/smali-demo.apk -o ./apk/smali-demo.xgmml
```

# apkviewer

用来为apk文件中每一个类生成一个独立的graphml图形文件

```shell
./apkviewer.py -i ./apk/smali-demo.apk -o ./apk/out
```

可以使用gephi打开上面的文件

# gephi

这是一个开源软件，我们安装完成后，打开上面生成的gexf文件后，我们选择左边-布局-yifan hu，然后就会生成下图：

![](http://7qnc6h.com1.z0.glb.clouddn.com/gephi-home.png)

当分析图生成后，我们可以点击下方的滑块可以调整线的粗细和字体大小颜色等

