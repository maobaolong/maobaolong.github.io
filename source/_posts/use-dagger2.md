---
title: 史上最通俗易懂的Android中使用Dagger入门教程
date: 2016-07-18 15:19:39
categories: Dagger2
tags: 
    - Dagger
    - 依赖注入
---

# 简介

Dagger2是Dagger1的分支，早期有square开发，现在由谷歌公司接手。
他要解决问题和核心是：利用生成和写的代码混合达到看似所有的产生和提供依赖的代码都是手写的样子。

官方Github地址：[https://github.com/google/dagger](https://github.com/google/dagger)

官方主页:[http://google.github.io/dagger/](http://google.github.io/dagger/)

# 好处

1. 依赖注入的配置独立于初始化地方，更改配置方便。比如：在MVP架构中，我们写了一个TaskPresenter，但是他在TaskActivity和TaskDetailActivity中都使用了，正常情况是不是我们要在这两个地方都做实例化，后期可能还有更多的界面，但是我们如果使用了依赖注入，我们只需要在这两个地方定义一个TaskPresenter的变量，然后加一个注解，这样初始化在统一的地方，以后更改是不是很方便。
2. 我们可以注入一些依赖的模拟实验。比如：我们的app显示的数据来自网络，但是后台接口还没有写好，但是我们对数据层进行了抽象化，那我们就可以写一个本地json模拟是接口返回的数据，就可以测试了。
3. app的注入组件他不知道在什么地方，初始化完全有我们告诉他在什么地方注入等

# 结构图

![](http://www.jcodecraeer.com/uploads/20150519/1431999102454673.png)

首先大概解释下Dagger中几个角色(或者说是几个注解)：

@Inject：这个很简单了，通常是在需要注入的地方添加这个依赖。比如：MainActivity要使用LocalManager实例，那我们就在要使用的地方定义一个成员变量

```java
@Inject
LocationManager locationManager;
```

> 注意：不能是private修饰的

@Module：就是真正提供依赖的类了。所以我们定义一个类，用@Module注解，这样Dagger在构造类的实例的时候，就知道从哪里去找到需要的 依赖。modules的一个重要特征是它们设计为分区并组合在一起（比如说，在我们的app中可以有多个组成在一起的modules）。所以我们这里可以定义一个AppApplication类用来提供全局依赖，可以是ApiService，Retrofit，Okhttp，LocalManager，Context等

```java
@Module
public class AppApplicationModule {
    ...
}
```

@Provides：就是写在Module中某些方法上，表示这个方法提供依赖

```java
@Provides @Singleton LocationManager provideLocationManager() {
    return (LocationManager) application.getSystemService(LOCATION_SERVICE);
}
```

@Component: 是@Inject和@Module的桥梁，它的主要作用就是连接这两个部分。 Components可以提供所有定义了的类型的实例。

```java
@Singleton
@Component(modules = AppApplicationModule.class)
public interface ApplicationComponent {
    void inject(MainActivity demoActivity);
}
```

基本的注解我就讲解到这里，下面写一个小实例

## 基本配置

首先创建一个Android项目，然后在项目的build.grade，添加android-apt依赖
```grade
buildscript {
    ...
    dependencies {
        ...
        classpath 'com.neenbedankt.gradle.plugins:android-apt:1.8'
        ...
    }
}
```

然后在app的build.gradle添加

```grade
apply plugin: 'com.neenbedankt.android-apt'
```

然后在添加依赖
```grade
dependencies {
    ...
    apt "com.google.dagger:dagger-compiler:2.2"
    provided 'org.glassfish:javax.annotation:10.0-b28'
    compile "com.google.dagger:dagger:2.2"
    ...
}
```

到这一步可以build下，看看配置是否正确，我们下面要做的就是上面说的，给MainActivity提供LocalManager，对，就这么一点，不然写多了大家又懵逼了

首先创建一个AppApplication类，他是一个Application子类，需要在清档文件配置，之所有要创建他是因为，我们要在这里提供一些全局依赖

# 创建Application

```java
public class AppApplication extends Application{
    @Override
    public void onCreate() {
        super.onCreate();
    }
}
```

记得在清单文件配置哟~

# 创建AppApplicationModule

上面说了这是一个真正提供依赖的类，其中一些方法要用@Provides修饰

```java
@Module
public class AppApplicationModule {

    private final Context context;

    public AppApplicationModule(Context context) {
        this.context=context;
    }

    //标示这个方法可以提供LocationManager
    @Provides
    @Singleton
    LocationManager provideLocationManager() {
        return (LocationManager) context.getSystemService(LOCATION_SERVICE);
    }
}
```

# 创建ApplicationComponent

同样也说了，他是Module和Inject之间的桥梁，我们帮他创建到了AppApplication内部

```java
@Singleton
@Component(modules = AppApplicationModule.class)
public interface ApplicationComponent {
    void inject(MainActivity demoActivity);
}
```

# 在AppApplication中注册依赖

```java
public class AppApplication extends Application {

    private ApplicationComponent component;

    @Override
    public void onCreate() {
        super.onCreate();
        component = DaggerAppApplication_ApplicationComponent.builder().appApplicationModule(new AppApplicationModule(this)).build();
        component.inject(this);
    }

    @Singleton
    @Component(modules = AppApplicationModule.class)
    public interface ApplicationComponent {
        void inject(MainActivity demoActivity);
        void inject(AppApplication application);
    }

    public ApplicationComponent component() {
        return component;
    }
}
```

# 在MainActivity注册

```java
public class MainActivity extends AppCompatActivity {

    //可以看到我们没有显示的初始化LocationManager
    @Inject
    LocationManager locationManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        TextView tv_info = (TextView) findViewById(R.id.tv_info);

        //注解依赖
        ((AppApplication) getApplication()).component().inject(this);

        tv_info.setText(locationManager.toString());
    }
}
```

好这就是一个最最基本的Dagger注入例子了，下一篇我们来详细分析下他的实现原理或者再写一个MVP架构例子，感谢你的阅读。源代码下载地址:[https://github.com/lifengsofts/AndroidDagger2](https://github.com/lifengsofts/AndroidDagger2)

如果我的文章对来带来的帮助或者有不明白的地方，可加QQ群：129961195，大家一起交流





















