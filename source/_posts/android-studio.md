---
title: AndroidStudio
date: 2016-12-01 12:05:09
categories: Android
tags: 
    - Android
    - AndroidStudio
---

# 常用快捷键

## Log相关

### 快速输入TAG

在方法的外面，类的里面输入logt回车，就会生成

```java
private static final String TAG = "MainActivity";

logd
Log.d(TAG, "onCreate: ");

//打印方法参数
logr
Log.d(TAG, "onCreate() called with: savedInstanceState = [" + savedInstanceState + "]");

//打印log.e
loge
Log.e(TAG, "onRestart: ", new Throwable());     
```

## 代码

### 不区分大小写

setting-editor-general-code completion-case sensitive completion设置为none

### 选中代码

option+↑，↓，多次按↑键会每次增多选择范围

### 自动完成

### 上下移动代码

command+shift+↑，↓

### 复制当前行

command+d

### 删除代码

command+delete

### 光标在方法中快速移动

control+↑，↓

和mac的默认键有冲突，需要先去掉mac的快捷键

### 打开一个类

command+o

### 打开一个文件

command+shift+o

### 变量声明

command+b或者common+鼠标单击

### 查看一个类的父类

command+u

### 查看一个方法在哪里调用了

control+option+h

### 快捷查看一个方法的定义

mac中没有快捷键，view-quick difinition

### 查看类的集成关系

control+h

### 查找字符使用

option+f7

### 光标的前进后退

command+option+←，→

### 最近使用文件

command+e

### 

### 



























