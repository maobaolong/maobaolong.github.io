---
title: maven
date: 2016-11-16 15:13:48
tags: [工具使用,maven]
categories: 工具使用
keywords: 工具使用,maven
description: 记录maven的常用命令。

---

## maven 安装本地库
mvn install:install-file -DgroupId=com.facebook.presto -DartifactId=presto-jdbc -Dversion=0.132-SNAPSHOT -Dpackaging=jar -Dfile=presto-jdbc-0.132-SNAPSHOT.jar

## 打包jar 
### 依赖包独立存在
```
pom中加入
<plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-jar-plugin</artifactId>
                <configuration>
                    <archive>
                        <manifest>
                            <addClasspath>true</addClasspath>
                            <mainClass>youmainclasspath</mainClass>
                        </manifest>
                    </archive>
                </configuration>
            </plugin>
执行 mvn dependency:copy-dependencies -DoutputDirectory=lib package
然后把lib里的所有jar放到你工程的jar包所在的目录
运行java -jar youjar.jar
```

## Maven中-DskipTests和-Dmaven.test.skip=true的区别
在使用mvn package进行编译、打包时，Maven会执行src/test/java中的JUnit测试用例，有时为了跳过测试，会使用参数-DskipTests和-Dmaven.test.skip=true，这两个参数的主要区别是：

-DskipTests，不执行测试用例，但编译测试用例类生成相应的class文件至target/test-classes下。

-Dmaven.test.skip=true，不执行测试用例，也不编译测试用例类。
