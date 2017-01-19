---
title: 搭建使用Kotlin语言开发Android的环境
date: 2016-07-26 18:38:18
categories: Android
tags: 
    - Kotlin
---
# 简介

大家都知道Kotlin语言在Android界还是很火的，到底有多好呢，这篇文章暂不介绍，而这里主要讲解是搭建一个开发环境

# 首先创建一个Android项目

这一步不细讲

> 注意：是使用Android Studio创建不是eclipse

# 安装Kotlin插件

在plugins的仓库里搜索kotlin,安装完成并重启

# 配置build.gradle

这一步值让我们的项目支持kotlin语言

选择Android Studio菜单的Help-Find Action，输入：configure kotlin in project

安装回车，瞬间就配置完了

# 将现有代码转为Kotlin文件

选择Android Studio菜单的Code-conver java file to kotlin file,转换完后，可以看见我们的MainActivity变成这样了：

```kotlin
package cn.woblog.weatherapp

import android.os.Bundle
import android.support.v7.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

    }

}
```

然后运行，如果不出意外，就可以看见主界面了

# 使用kotlin-android-extensions插件

使用了这个插件我们可以直接在代码中使用布局中写的id访问这个空间，不需要findViewById，直接在app的build.gradle中添加

```groovy
apply plugin: 'kotlin-android-extensions'
```

# databinding

在app的build.gradle中android中添加

```groovy
dataBinding {
    enabled = true
}
```

还需要做如下处理，如果在xml里面使用了事件绑定，如：onClick

```xml
<?xml version="1.0" encoding="utf-8"?>
<layout xmlns:android="http://schemas.android.com/apk/res/android"
        xmlns:tools="http://schemas.android.com/tools">

    <data>

        <variable
            name="item"
            type="cn.woblog.testkotlindatabinding.ItemInput"/>

        <variable
            name="actionHandler"
            type="cn.woblog.testkotlindatabinding.ActionHandler"/>
    </data>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:paddingBottom="@dimen/activity_vertical_margin"
        android:paddingLeft="@dimen/activity_horizontal_margin"
        android:paddingRight="@dimen/activity_horizontal_margin"
        android:paddingTop="@dimen/activity_vertical_margin"
        tools:context="cn.woblog.testkotlindatabinding.MainActivity">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Hello World!"/>

        <Button
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:onClick="@{()->actionHandler.onClick(item)}"
            android:text="click me"/>
    </LinearLayout>
</layout>
```

需要在app的build.gradle的dependencies

```groovy
kapt 'com.android.databinding:compiler:+'
```

并且还要在在最外层添加

```groovy
kapt {
    generateStubs = true
}
```