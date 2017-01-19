---
title: Android-logback
date: 2017-01-08 12:19:16
categories: Android
tags: 
    - log
---

# 简介

logback-android:https://github.com/tony19/logback-android

logback:http://logback.qos.ch/

# 基本使用

## 加入依赖

```groovy
compile 'org.slf4j:slf4j-api:1.7.21'
compile 'com.github.tony19:logback-android-core:1.1.1-6'
compile('com.github.tony19:logback-android-classic:1.1.1-6') {
    // workaround issue #73
    exclude group: 'com.google.android', module: 'android'
}
```

## 添加配置文件

assets/logback.xml

```xml
<configuration>
    <!-- Create a file appender for a log in the application's data directory -->
    <appender name="file" class="ch.qos.logback.core.FileAppender">
        <file>/sdcard/log/test1.log</file>
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- Write INFO (and higher-level) messages to the log file -->
    <root level="INFO">
        <appender-ref ref="file" />
    </root>
</configuration>
```

## 代码中输出日志

```java
Logger log = LoggerFactory.getLogger(MainActivity.class);
log.info("hello world");
```

这样我们就可以将日志输出到文件了

## 在代码中配置

### 默认配置

```java
static {
    BasicLogcatConfigurator.configureDefaultContext();
}

@Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    org.slf4j.Logger log = LoggerFactory.getLogger(MainActivity.class);
    for (int i = 0; i < 10; i++) {
        log.info("hello world");
    }
}
```

## 将所有日志级别都记录到文件和logcat

```java
private void configureLogbackDirectly() {
    // reset the default context (which may already have been initialized)
    // since we want to reconfigure it
    LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();
    lc.reset();

    // setup FileAppender
    PatternLayoutEncoder encoder1 = new PatternLayoutEncoder();
    encoder1.setContext(lc);
    encoder1.setPattern("%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n");
    encoder1.start();

    FileAppender<ILoggingEvent> fileAppender = new FileAppender<ILoggingEvent>();
    fileAppender.setContext(lc);
    fileAppender.setFile(Environment.getExternalStorageDirectory().getAbsolutePath().concat("/log/file1.log"));
    fileAppender.setEncoder(encoder1);
    fileAppender.start();

    // setup LogcatAppender
    PatternLayoutEncoder encoder2 = new PatternLayoutEncoder();
    encoder2.setContext(lc);
    encoder2.setPattern("[%thread] %msg%n");
    encoder2.start();

    LogcatAppender logcatAppender = new LogcatAppender();
    logcatAppender.setContext(lc);
    logcatAppender.setEncoder(encoder2);
    logcatAppender.start();

    // add the newly created appenders to the root logger;
    // qualify Logger to disambiguate from org.slf4j.Logger
    ch.qos.logback.classic.Logger root = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    root.addAppender(fileAppender);
    root.addAppender(logcatAppender);
}
```

然后在onCreate方法中调用或者在Application中调用configureLogbackDirectly();。最后就可以使用日志api

```
log.debug("debug");
log.info("info");
log.warn("warn");
log.error("error");
```

这样所有级别的日志都记录到了文件，和logcat

## 将所有日志级别都记录到logcat，debug级别以上的记录到文件

```xml
<!--将所有日志级别都记录到logcat，debug级别以上的记录到文件-->
<property name="LOG_DIR" value="/sdcard/log" />

<!-- Create a logcat appender -->
<appender name="logcat" class="ch.qos.logback.classic.android.LogcatAppender">
    <encoder>
        <pattern>%msg</pattern>
    </encoder>
</appender>

<!-- Create a file appender for DEBUG-level messages -->
<appender name="InfoLog" class="ch.qos.logback.core.FileAppender">
    <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
        <level>INFO</level>
    </filter>

    <file>${LOG_DIR}/info.log</file>

    <encoder>
        <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
    </encoder>
</appender>

<!-- 将debug级别的日志打印到logcat，info及以上的日志写到文件 -->
<root level="DEBUG">
    <appender-ref ref="logcat" />
    <appender-ref ref="InfoLog" />
</root>
```



# 配置

## Encoders

pattern输出格式配置，一般情况下用这段

```xml
<pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
```

输出格式解释参考以下链接

参考：http://blog.csdn.net/haidage/article/details/6794529













