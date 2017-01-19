---
title: 为什么说”人生苦短，我用python“
date: 2016-04-13 15:14:57
categories: Python
tags: 
    - Python
    - 编程人生
---
# 为什么说”人生苦短，我用python“？

[TOC]


首先要说明的是本文不扯什么大道理，只是先介绍Python的背景，然后从实用的角度出发举一两个真实栗子。

![这里写图片描述](http://img.blog.csdn.net/20160403203310033)

首先要想了解要一门语言的好坏，或者为什么招程序员喜欢（卧槽，原来程序员喜欢不是女朋友？）我们的先从语言的产生背景开始，比如:他出现在什么年代，为了解决什么问题而出现的等。当然我也只是跟其他语言做一个比较，不讨论谁好谁坏，再说语言也没有什么好坏之分，就算有好坏之分，也得从实际应用场景出发，所有我们不讨论这个问题。

![这里写图片描述](http://img.blog.csdn.net/20160403202819953)

好,好，大兄弟你们都消消气，上面我扯的太多了，下面直接上重点...


## 1. Question

首先还是按照惯例，上来几个问题，这样能让初学者一目了然，有个大概的认识

### 1.1 Python是什么

是一种面向对象、解释型计算机程序设计语言，由Guido van Rossum于1989年圣诞节为打发无聊时间，而开发的一个新的脚本解释程序，可以感觉下什么叫牛人，是ABC语言的一种继承，至于为什么选中Python作为语言名字，是因为他是一叫Monty Python的喜剧团体的爱好者，第一个公开发行版发行于1991年。

他的设计哲学是

- **优雅**
- **明确**
- **简单**

完全的面向对象。函数，模块，数字，字符串都是对象，不想Java中还有基本类型，在Python中一切皆对象，那作为程序员的我们害怕找到对象吗，直接New一个呀，呵呵

![这里写图片描述](http://img.blog.csdn.net/20160403204116005)

### 1.2 人们为什么用Python

这个问题往往是入门者第一个问题，对此我在一本书找到了这样的解答：

> 软件质量
> 开发这效率
> 程序的可移植性
> 众多标准库支持
> 组件集成
> 享受乐趣

其他的不用多讲，需要详细了解的可以搜索下，我只是提供大家几个方面让大家了解，因为往往对于初学者，是迷茫的，因为不支持从什么方向去了解一个事物，而我就是提供方向的，具体的大家可以自己去了解。我只说下最后一个，详细的可以参考下这篇文章[每个程序员都应该学习使用 Python或Ruby](http://www.vaikan.com/why-every-programmer-should-learn-python-or-ruby/)文章里面也说的很明白，我总结几点就是

* 代码量小
* 维护成本低
* 编程效率高

同一样问题，用不同的语言解决，代码量差距太多了，一般情况下python是java的1/5，所以说人数苦短，我用python，多留点时间泡妹子吧，不然就老了

![这里写图片描述](http://img.blog.csdn.net/20160403211531096)

### 1.3 Python是脚本语言吗
·
他是一种多用户语言，至于为什么大家的第一感觉是脚本语言，我是因为人们看他的他直接写一个文件，不需要什么编译，跟脚本似得，直接运行的就行了。所以说我也很难给你一个确定答案，我就举一些常见的应用场景：

* 脚本：可以写一些辅助自己开的脚本，就比如，Android开发，会涉及到一常用的命令，但是如果是在windows用bat写，这样弄到mac就没法运行的，所以可以用，python写。另外如果你是服务器管理员，那么python脚本很适合你，程序长了用bash写，你会砸电脑的
* 网站开发：他有强大的Django，Flask框架
* 科学计算：有Numpy和Matlab一样强的数值计算接口
* 图形界面程序开发：这个不用多解释，就是常见的那种界面啦

## 2. Python版Hello World

通常任何一门语言都有一个hello world的过程，呵呵，所以说我们这里也一样，因为通过他你会学习到该语言的一个最基本的程序框架和运行过程，这对应初学者才是最重要的。

既然前面也说了，可以把他当脚本语言，那我们就来个最简单的，操作步骤如下：

1. 在你的工作目录下创建一个hello.py文件，别问我你不知道工作目录是什么，那你该学学计算机基础了

2. 在该文件里写入

```python
print 'hello world'
```

3. 打开命令行，输入:

```python
python hello.py
```

顺利的话你会看到hello world的输出，是不是感觉好简单，对，你没看错，就这么简单，现在你可以说你是一个python程序员了，呵呵~

## 3. Example

这里就举一个我最近实际应用中的例子，是什么呢，施主莫急，听平僧慢慢到来。场景是这样的最近一个日记软件本身的客户端不能用了，但是数据在sqlite数据库里呀，我们的需求是将里面的一些数据导出为txt文件，怎么这需求简单吧

### 3.1 Python

首先用python来解决这个问题，据跟上面的描述，我们很清楚的想到如下步骤：

1. 连接sqlite3数据库
2. 执行查询语句
3. 打开文件
4. 将查询的接口写入的刚刚打开的文件中
5. 关闭数据
6. 关闭文件

呵呵，我有想到了，让程序员把大象放到冰箱的故事了，可以参考这篇文章[拖放三部曲——从“把大象放进冰箱”说起](http://cdc.tencent.com/?p=3712)

好了，不废话了，直接上代码

```python
#!/usr/bin/python
# -*- coding: cp936 -*-

import sqlite3
import HTMLParser
import codecs
import time

f=codecs.open('note.txt','a',"utf-8") #以追加方式打开一个文件

conn = sqlite3.connect('note.db') #打开sqlite数据库

print "Opened database successfully";

#执行查询语句，返回一个cursor
cursor = conn.execute("select created,weather,address,latitude,longitude,content from tb_notescontents,tb_notes where tb_notescontents.note_guid=tb_notes.guid")

#遍历每一行
for row in cursor:
  
    #取出改行的每一列
    created= row[0]
    weather= row[1]
    address= row[2]
    latitude= row[3]
    longitude= row[4]
    content= row[5]

    html_parser = HTMLParser.HTMLParser()

    d = time.localtime(created/1000)
    currentTime = time.strftime('%Y-%m-%d %H:%M:%S',d)

    #因为原理的内容是经过html转义了，所以要转回来，形如：&#20170;&#22825;&#65292;
    weather = html_parser.unescape(weather) 
    address = html_parser.unescape(address) 
    content = html_parser.unescape(content) 

    
    f.write(currentTime) #写入文件
    f.write('              ')
    f.write(weather)
    f.write('              ')
    f.write(address)
    f.write('              ')
    f.write(content)

    f.write('\n')
    f.write('\n')
    f.write('\n')

conn.close() ## 关闭数据库
f.close() #关闭文件
print "Operation done successfully";

```

至于逻辑，我在上面步骤也写的很清楚了，另外程序也谢了很详细的注释，所以说就算你不懂python也能很容易的看懂。

可以看到我们大概只用了50行代码就完成了，这个小需求，但是如果用Java是什么结果呢

### 3.2 Java

首先的我们的找一个开发工具，就eclipse吧。创建一个项目，然后添加一个TestMan.java

工程结构如下：

![这里写图片描述](http://img.blog.csdn.net/20160403230434451)

在TestMan.java中写一个基本的程序框架

```java
public class TestMain {
	public static void main(String[] args) {
		
	}
}
```

卧槽，这么麻烦，搞了半天才把架子搭好，说实话Java确实中规中矩，干什么你都得按照他的那一套来，所以说呢，我们就不能直接贴代码了，步骤还得细分了，啥？

1. 连接sqlite3数据库
	通过JDBC连接：但是因为jdbc（Java Data Base Connectivity,java数据库连接）是java连接数据库的一套抽象设计API，既然是抽象的所以是不能直接使用，要找到他的实现，既然是连接sqlite所以应该去sqlite官网或者从[bitbucket这里下载](https://bitbucket.org/xerial/sqlite-jdbc/overview)，我下载的版本是[sqlite-jdbc-3.8.11.2](https://bitbucket.org/xerial/sqlite-jdbc/downloads/sqlite-jdbc-3.8.11.2.jar)，下载完后将他放到eclipse的环境变量里，下载才把准备工作做完，下面才开始写代码
2. 执行查询语句
3. 打开文件
4. 将查询的接口写入的刚刚打开的文件中
5. 关闭数据
6. 关闭文件

现在我们直接上代码了

```java
import java.io.BufferedWriter;
import java.io.FileWriter;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import org.apache.commons.lang3.StringEscapeUtils;

public class TestMain {
	public static void main(String[] args) {
		// load the sqlite-JDBC driver using the current class loader

		Connection connection = null;
		BufferedWriter bufferedWriter = null;
		try {
			Class.forName("org.sqlite.JDBC");
			// create a database connection
			connection = DriverManager.getConnection("jdbc:sqlite:note.db");
			Statement statement = connection.createStatement();
			statement.setQueryTimeout(30); // set timeout to 30 sec.

			ResultSet rs = statement
					.executeQuery("select created,weather,address,latitude,longitude,content from tb_notescontents,tb_notes where tb_notescontents.note_guid=tb_notes.guid");

			bufferedWriter = new BufferedWriter(
					new FileWriter("note.txt", true));
			while (rs.next()) {
				// read the result set

				String created = rs.getString("created");
				String weather = rs.getString("weather");
				String address = rs.getString("address");
				String latitude = rs.getString("latitude");
				String longitude = rs.getString("longitude");
				String content = rs.getString("content");

				// write to file
				bufferedWriter.write(created); // 写入文件
				bufferedWriter.write("              ");
				bufferedWriter.write(weather);
				bufferedWriter.write("              ");
				bufferedWriter.write(address);
				bufferedWriter.write("              ");

				// 转义html，可以看到我们又引用了commons-lang jar包
				content = StringEscapeUtils.unescapeHtml4(content);

				bufferedWriter.write(content);

				bufferedWriter.newLine();
			}
		} catch (SQLException e) {
			// if the error message is "out of memory",
			// it probably means no database file is found
			System.err.println(e.getMessage());
		} catch (Exception e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		} finally {
			try {
				if (connection != null)
					connection.close();
			} catch (SQLException e) {
				// connection close failed.
				System.err.println(e);
			}
			try {
				if (bufferedWriter != null) {
					bufferedWriter.close();
				}
			} catch (IOException e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
			}
		}
	}
}
```

现在大家可以看见了java和python的区别了吧，在java中什么功能也提供了，但是得引用各种jar，还得到处找去搜索或下载啦，各种肯爹，不过在python中很多常用库已经内置了，所以省去了很多麻烦，所以说以我个人感觉，python个适合解决工作中的一些小问题，当然大问题也是么有问题的啦~，文章到此基本结束了，当然我也没有偏袒那一面，另外我也是只是从我的工作或学习中得到的一些小领悟特此总结此处，如果大家有什么好的见解欢迎评论吐槽~


感谢：
java连接sqlite参考：http://blog.csdn.net/litaoshoujiao/article/details/8535444
commom-lang：http://commons.apache.org/proper/commons-lang/download_lang.cgi
