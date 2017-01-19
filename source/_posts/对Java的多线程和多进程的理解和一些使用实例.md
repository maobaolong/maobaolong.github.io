---
title: 对Java的多线程和多进程的理解和一些使用实例
date: 2016-5-12 13:53:20
categories: Java
tags: 
    - 多线程
    - 多进程
    - 并发
---
## 简介

大家肯定都经常听见什么多进程(multiprocessing)，多线程(multithreaded)，多任务(multitasking)名词，但是要真正的明白他们的一些定义，区别和使用场景可就不一定全会了。而这篇文章的目的就是要解决这些同时也是自己复习下多线程相关的知识

实际上的多线程是扩展了多进程的概念，一个程序可以执行多个任务，比如：一个浏览器他能同时下载多幅图片，而他的每一个任务称为一个线程(thread)，可以同时运行一个以上的线程的程序我们称为多线程程序

## 多线程和多进程区别

本质上来说每一个进程用友一整套变量，而进程确实共享的
虽然你感觉都自己用自己的这样安全，但是相对线程来说他肯轻快，线程间通讯也更加轻量级
此外在有些操作系统中中，创建或销毁一个线程比操作一个线程开销小的多

## 什么是线程

线程说白了就是一个名字而已，一般情况下一个线程干一件事

## 为什么要使用多线程

如果要直接给大家说有啥好处，可能不太好理解，或者有点强人说难的感觉，那么就说一个小李子

就说一个植物大战僵尸的游戏吧，每一个僵尸他都会移动，如果这个时候我们使用一个线程去处理多个僵尸的移动，那么就会出现这种情况，每次只有一个僵尸移动，其他的都等着。

但是如果我们使用多线程了，即每一个僵尸对应一个线程去处理他的移动，这时候你又看他们活跃起来了，所以像这样的场景我们需要使用多线程

## 创建线程的方式

在java中创建线程有两种方式

### 继承Thread类

```java
private static void createThread1() {

    new MyThread("Thread A").start();
    new MyThread("Thread B").start();
    new MyThread().start();
    new MyThread().start();
    new MyThread().start();
}

static class MyThread extends Thread{
    public MyThread() {
    }

    public MyThread(String name) {
        super(name);
    }

    @Override
    public void run() {
        super.run();
        System.out.println(Thread.currentThread().getName());
    }
}
```

输出：

```shell
Thread A
Thread B
Thread-0
Thread-2
Thread-1
```

可以我创建线程时传入了自定义线程的名称，当如也可以不穿，他们默认的名称是Thread-0，这样的递增方式，通过currentThread方法可以获取当前方法的所在的线程，可以看见的他的顺序是乱的

另外不推荐这种方式创建接口，因为这个方式每次都创建一个新线程可以说是开销非常大的，可以使用线程池来解决这样的问题

### 实现Runnable接口
```java
private static void createThread2() {
    YourRunnable yourRunnable = new YourRunnable();
    new Thread(yourRunnable).start();
    new Thread(yourRunnable).start();
    new Thread(yourRunnable).start();
    new Thread(yourRunnable).start();
}

static class YourRunnable implements Runnable{

    @Override
    public void run() {
        //在这里处理你的逻辑
        System.out.println(Thread.currentThread().getName());
    }
}
```

输出：

```java
Thread-0
Thread-1
Thread-2
Thread-3
```

可以看到不管使用哪种方式创建都是最终由Thread来开启一个任务的

> 注意：不要直接调用线程的run方法，因为这一虽然也执行的里面的逻辑，但是是在同一个线程里执行的，他并不会新开一个线程去执行他

```java
private static void createThread3() {
    new MyThread().run();
    new MyThread().run();
    new MyThread().run();
}
```

输出：

```shell
main
main
main
```

可以看到虽然执行了run方法，但是他们确实在同一个线程执行的，而这个线程时main线程，切记不要这样，这样就没有多线程效果了

## 中断一个线程

什时候需要终端一个线程呢，比如：正在下载一幅图片，但用户点击了停止，因为他想不下载了

什么时候线程会自动终止：

1. 当线程的run方法执行到最后一句时并return返回时
2. 当run方法中未捕捉的异常时

当然这些情况是他主动终止的，像上面下载这种逻辑，肯定是我们需要手动终止的，因为他不知道你什么时候想终止这个线程

### 强制终止线程之interrupt方法

```java
private static void interceptThread1() {
    InterceptThread1 interceptThread1 = new InterceptThread1();
    interceptThread1.start();
    try {
        Thread.sleep(1);
    } catch (InterruptedException e) {
        e.printStackTrace();
    }
    interceptThread1.interrupt();
}

static class InterceptThread1 extends  Thread{
    @Override
    public void run() {
        for (int i = 0; i < 10000; i++) {
            if (isInterrupted()) {
                System.out.println("检测到终止位被置位，因次我要挂了，别想我~~");
                break;
            }
            System.out.println("progress:"+i);
        }
    }
}
```

输出：

```shell
...
progress:38
progress:39
progress:40
progress:41
检测到终止位被置位，因次我要挂了，别想我~~
```

可以看到这个方法相当于自定义一个变量，而我们在运行的时候去检测他，如果被置位了，就终止这个run方法。当然聪明的人可能想到一个问题，加入我的线程阻塞了(sleep,wait)，那肯定是没法实时检测这个状态，那这种情况下他是怎么处理的呢，我们看看如下代码：

```java
private static void interceptThread2() {
    InterceptThread2 interceptThread = new InterceptThread2();
    interceptThread.start();
    interceptThread.interrupt();
}


static class InterceptThread2 extends  Thread{
    @Override
    public void run() {
        System.out.println("我要开始睡觉了~~");
        try {
            Thread.sleep(1000);
            System.out.println("我睡着了~~");
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

    }
}
```

输出：

```shell
我要开始睡觉了~~
java.lang.InterruptedException: sleep interrupted
	at java.lang.Thread.sleep(Native Method)
	at com.example.MyClass$InterceptThread2.run(MyClass.java:26)
````

可以看见别人早就考虑到了，这时候会触发InterruptedException异常而终止，可以看到如果终止线程我们采用自定义变量，那我们无法实现在这种状态下终止线程

> 注意：如果中断已经被置位了，再调用sleep时，他不会休眠，相反他会清除终止位并抛出InterruptedException异常

### interrupted方法和interrupt方法

这两个方法可以说是很像，但是我想大家不一定知道还有这样两个方法

interrupted：他是Thread类的一个静态方法，调用它会清除当前线程的中断状态

isInterrupted：是检测当前线程有没有被中断，他不会清除这个状态

请看下面的实例：

```java
private static void interceptThread3() {
    InterceptThread3 interceptThread = new InterceptThread3();
    interceptThread.start();
    try {
        Thread.sleep(2);
    } catch (InterruptedException e) {
        e.printStackTrace();
    }
    interceptThread.interrupt();
}

static class InterceptThread3 extends  Thread{
    @Override
    public void run() {
        for (int i = 0; i < 10000; i++) {
            if (isInterrupted()) {
                System.out.println("检测到终止位被置位，因次我要挂了，别想我~~");
                Thread.interrupted();
                if (isInterrupted()) {
                    System.out.println("我真的挂了~");
                } else {
                    System.out.println("你又把我救活了~");
                }
                break;
            }
            System.out.println("progress:"+i);
        }
    }
}
```

输出：

```shell
...
progress:26
progress:27
progress:28
检测到终止位被置位，因次我要挂了，别想我~~
你又把我救活了~
```

可以看到interrupted确实和我们说的一样的，调用时他清除了该线程的中断位

### 常用API

![](http://7qnc6h.com1.z0.glb.clouddn.com/mw9opabrr10b2dee6dtf9756fx.png)

## 线程的状态

![](http://7qnc6h.com1.z0.glb.clouddn.com/2u29t2a2z6ko6z4sf12ide3kp4.png)

### 新建

就是new Thread()这样创建处理一个线程，但是还没有调用它start方式时

### 可运行

当调用start方法后，线程处于可运行状态，此时他可能是运行了也可能没有运行，这取决于操作系统提供给线程的运行时间

一旦一个线程运行了，但是他不是始终都运行，可能被中断，目的是为了让其他线程获得运行机会

抢占式调度系统给每个线程一个时间片，当时间用完时，系统剥夺他的运行权，并让其他线程运行(线程最高等级的线程)，现在的所有桌面和服务器都是这种策略

### 被阻塞和等待

在这种状态是，他暂时不活动，且消耗最少的资源。知道调度器重新激活它(这取决你他是怎么达到该状态的)

p635

### 被终止的线程

通过我上面提到了[中断一个线程](#中断一个线程)我们可以了解到中断线程的方式

> 特别提心：虽然可以调用stop方法中断一个线程，他会抛出ThreadDeath错误，但是他已经过时不要再使用

![](http://7qnc6h.com1.z0.glb.clouddn.com/m35zlcju0ghqiemoo6a0xosfyw.png)

或者来个更详细的图

![](http://7qnc6h.com1.z0.glb.clouddn.com/bypvkf9udblc84ya3ki6u8ebqp.png)

### 常用API

![](http://7qnc6h.com1.z0.glb.clouddn.com/9fe5moic7qnkxkt6nm3hsanxt7.png)

## 线程的属性

### 优先级

在Java中每一个线程都有优先级，默认会继承父类的优先级，可以设置Thread.MIN_PRIORITY(0)~Thread.MAX_PRIORITY(10)之间的值，默认是NORM_PRIORITY(5)，每当现场调度器需要选择新线程时，他就会优先考虑优先级高的线程，当然这个实现取决你的操作系统，所以说不要太依赖于线程的优先级去做一些事情

```java
private static void testThreadPriority1() {
    MyThread myThread = new MyThread();
    System.out.println(myThread.getPriority()); //默认为5，Thread.NORM_PRIORITY
    myThread.start();
    System.out.println(myThread.getPriority());
}
```

