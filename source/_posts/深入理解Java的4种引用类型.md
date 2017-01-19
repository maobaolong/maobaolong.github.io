---
title: 深入理解Java的4种引用类型
date: 2016-5-6 11:29:00
categories: Java
tags: 
    - 引用类型
    - StrongReference
    - SoftReference
    - WeakReference
    - PhantomReference
    - ReferenceQueue
---
## 简介

首先大家应该都知道Java从1.2起提供了四种引用类型，他们分别是其引用(StrongReference)，软引用(SoftReference)，弱引用(WeakReference)以及PhantomReference(虚引用)，他们被GC回收的可能性从大到小排列。如下图

![](http://7qnc6h.com1.z0.glb.clouddn.com/nksi4ny4al15rh2ckn1abe3o9a.png)

可以看到Reference是继承自Object，而又有三个直接的子类，就是我们要介绍的几个类了。另外还有一个ReferenceQueue我想大家就不一定知道了

![](http://7qnc6h.com1.z0.glb.clouddn.com/xkxcswuaxen1xipiyw9j7uhoxb.png)

他是用来的保存即将释放的引用对象，具体用户下面有实例代码

下面就来分别介绍每个引用，并附上测试代码，方便大家的深入理解

## StrongReference

就可以他的名字一样，任何时候GC是不能回收他的，哪怕内存不足时，系统会直接抛出异常OutOfMemoryError，也不会去回收，首先要说明的是java中默认就是强引用，比如如下代码：

```java
Persion p = new Persion();
```
其中p就是一个强引用，任何时候都不会被gc回收
```java
/**
 * 测试强类型，可以看到我们调用多次gc他还是没有回收
 */
private static void testStrongReference() {
    Person jack = new Person("Jack");
    System.gc();
    System.gc();
    System.out.println(jack);
}
```
## SoftReference

软引用他的特点是当内存足够时不会回收这种引用类型的对象，只有当内存不够用时才会回收，这种特点很适合最一些缓存，比如android中图片的缓存
```java
/**
 * 测试软类型引用
 */
private static void testSoftReference() {
    Person jack = new Person("Jack");
    SoftReference<Person> personSoftReference = new SoftReference<>(jack);
    System.out.println(personSoftReference.get());
    jack = null;
    System.gc();
    System.gc();
    System.out.println(personSoftReference.get());
}
```

输出：

```shell
Person{name='Jack'}
Person{name='Jack'}
```

可以看到虽然我们手动调用了GC但是引用类型没有被回收

## WeakReference

虚引用的特点是只要GC一运行就会把给回收了，个人感觉没多大用处，因为只要GC一运行他就会被回收了‘
```java
private static void testWeakReference() {
    Person jack = new Person("Jack");
    WeakReference<Person> personSoftReference = new WeakReference<Person>(jack);
    System.out.println(personSoftReference.get());
    System.gc();
    System.gc();
    System.out.println(personSoftReference.get());
}
```
我们运行代码发现对象还是没被回收，因为我们虽然调用了GC，这个方法只是通知他执行，但是什么执行还得看他心情。当然上面的代码有个很重要的原因是Jack对象他是强引用，所以在怎么调用GC他还是不会回收的，为啥呢？因为jack这个变量他还强引用着对象，我们给他置空，在调用GC他就回收了，如下代码：
```java
private static void testWeakReference() {
    Person jack = new Person("Jack");
    WeakReference<Person> personSoftReference = new WeakReference<Person>(jack);
    System.out.println(personSoftReference.get());
    jack = null;
    System.gc();
    System.gc();
    System.out.println(personSoftReference.get());
}
```

输出：

```shell
Person{name='Jack'}
null
```

可以看到结果正如我们所料

## PhantomReference

虚引用就相应没引用似得，主要以创建这种类型的引用，那么他所引用类型就回收了

```java
private static void testPhantomReference() {
    Person jack = new Person("Jack");
    ReferenceQueue<Person> personReferenceQueue = new ReferenceQueue<>();
    PhantomReference<Person> personSoftReference = new PhantomReference<Person>(jack,personReferenceQueue);
    System.out.println(personSoftReference.get());
//        jack = null;
//        System.gc();
//        System.gc();
    System.out.println(personSoftReference.get());
}
```

输出：

```shell
null
null
```

可以看到只要一创建完就直接给回收了

## ReferenceQueue

他是一个引用对列，可以监控被回收的Reference对象，具体的就是当一个引用对象他所引用的值被回收了，那么系统就会把这个引用添加到这个对列里面，如下代码：
```java
private static void testReferenceQueue() {
    Person jack = new Person("Jack");
    ReferenceQueue<Person> personReferenceQueue = new ReferenceQueue<>();
    WeakReference<Person> personSoftReference = new WeakReference<Person>(jack, personReferenceQueue);
    jack = null;
    System.gc();
    System.out.println(personSoftReference.get());
}
```

当personSoftReference所引用的Jack对象回收了，系统就会把personSoftReference对象添加到personReferenceQueue里，具体有什么作用呢，想象下这种情景，一个hashMap他的key是一个byte[]数组，我们需要创建一万个这样的key将他添加到hashMap，这是如果机器的内存小那么他就可以内存不足，但是当我们用一个引用来包裹这个key，然后在添加到hashMap就不会了：
```java
private static void testReferenceQueue1() {
    ReferenceQueue<Object> weakReferenceReferenceQueue = new ReferenceQueue<>();

    int M1 = 1024;
    Object o = new Object();
    Map<WeakReference<byte[]>, Object> map = new HashMap<>();

    //创建一个线程监听回收的对象
    new Thread(new Runnable() {
        @Override
        public void run() {
            try {
                int cnt = 0;
                WeakReference<byte[]> k;
                while((k = (WeakReference) weakReferenceReferenceQueue.remove()) != null) {
                    System.out.println((cnt++) + "recycle:" + k+","+k.get());
                    System.out.println("map.size:" + map.size());
                }

            } catch(InterruptedException e) {
                //结束循环

            }
        }
    }).start();

    for (int i = 0; i < 10000; i++) {
        byte[] bytes = new byte[M1];
        map.put(new WeakReference<>(bytes,weakReferenceReferenceQueue),o);
    }
    System.gc();
    System.out.println("map.size:" + map.size());
}
```

输出：
```shell
...
9997recycle:java.lang.ref.WeakReference@2a62b5bc,null
map.size:10000
9998recycle:java.lang.ref.WeakReference@27e47833,null
map.size:10000
9999recycle:java.lang.ref.WeakReference@18e8473e,null
map.size:10000
```
可以看到他回收了这么多对象，因为我们调用get()时返回的为null，但是问题来了，这时候map的size还是10000，这不是我们期望的，因为他所引用的对象都被回首了，那这个map里面的可以相当于失效了，我们希望的是把reference对象也回收了，意思是map的size变成真实可用对象的size
```java
private static void testReferenceQueue2() {
    ReferenceQueue<Object> weakReferenceReferenceQueue = new ReferenceQueue<>();

    int M1 = 1024;
    Object o = new Object();
    Map<WeakReference<byte[]>, Object> map = new HashMap<>();

    //创建一个线程监听回收的对象
    new Thread(new Runnable() {
        @Override
        public void run() {
            try {
                int cnt = 0;
                WeakReference<byte[]> k;
                while ((k = (WeakReference) weakReferenceReferenceQueue.remove()) != null) {
                    map.remove(k); //在这里我们移除被回收对象的引用
                    System.out.println((cnt++) + "recycle:" + k);
                    System.out.println("map.size:" + map.size());
                }


            } catch (InterruptedException e) {
                //结束循环

            }
        }
    }).start();

    for (int i = 0; i < 10000; i++) {
        byte[] bytes = new byte[M1];
        map.put(new WeakReference<>(bytes, weakReferenceReferenceQueue), o);
    }
    System.gc();
    System.out.println("map.size:" + map.size());
}
```

输出：
```shell
9996recycle:java.lang.ref.WeakReference@1608bcbd
map.size:3
9997recycle:java.lang.ref.WeakReference@777c9dc9
map.size:2
9998recycle:java.lang.ref.WeakReference@535779e4
map.size:1
9999recycle:java.lang.ref.WeakReference@6f6745d6
map.size:0
```

可以看见被回收了的对象，我们将它的key也从map里面移除了

## WeakHashMap

他的效果是和上面差不多，当一个key的引用对象被回收时他会自动的移除这个key

我们将下表是偶数的值装到了list，这样做是不让他回收这些对象

```java
private static void testWeakHashMap() {
    ReferenceQueue<Object> weakReferenceReferenceQueue = new ReferenceQueue<>();

    int M1 = 1024;
    Object o = new Object();
    Map<byte[], Object> map = new WeakHashMap<>();

    ArrayList<byte[]> bytes1 = new ArrayList<>();
    for (int i = 0; i < 10000; i++) {
        byte[] bytes = new byte[M1];
        if (i%2==0){
            bytes1.add(bytes);
        }
        map.put(bytes, o);
        bytes  = null;
    }
    System.gc();
    System.out.println("map.size:" + map.size());
}
```

输出：

```shell
map.size:5000
```

可以看到正如我们上面说的，他会移除哪些被回收的key。


参考：http://www.iflym.com/index.php/java-programe/201407140001.html
