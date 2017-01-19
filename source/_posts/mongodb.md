---
title: MongoDB
date: 2016-11-27 00:30:38
categories: MongoDB
tags: 
    - MongoDB
---

# 为什么学mongodb

开源，免费，社区技术支持到位

## 优势

### 无标结构限制

1. 没有任何表结构，每条记录的结构可以完全不同
2. 业务开发方便
3. SQL数据库需要事先定义表结构在使用

### 完成的索引支持

redis只有key-value，hbase的二级索引还需要自己实现

1. 单键索引，多键索引
2. 数组索引
3. 全文索引
4. 地理位置索引

### 方便的冗余和扩展

1. 复制集保证数据安全
2. 分片扩展数据规模

### 良好的支持

1. 完善的文档
2. 齐全的驱动支持

## 相关工具

MongoDB：64Linux

MongoDB版本：2.6.5

ssh：xshell

文本编辑器：vim,sublime

# 常用学习网站

官网：https://www.mongodb.com/

github

jira:https://jira.mongodb.org/secure/Dashboard.jspa

https://groups.google.com/forum/#!forum/mongodb-user

mongodb中文社区：http://www.mongoing.com/

mongodb中文文档：http://docs.mongoing.com/manual-zh/

# 数据库概念

有组织的存放数据

按照不同的需求进行查询

# 数据库分类

SQL数据库：Oracle,Mysql

NoSQl数据库(Not Only SQL)：Redis,MongoDB



| SQL数据库 | NoSQL数据库   |
| ------ | ---------- |
| 实时移植性  | 有延迟        |
| 实务     | 默认不支持      |
| 多表联合查询 | 没有，提供更好的性能 |

# 安装Mongodb

## mac

```shell
brew update
brew install mongodb
```

# 常用命令

mongod：数据库执行程序

mongo：连接mongo数据库的客户端

mongoimport,mongoexport:数据库的导入导出

mongodump，mongorestore:也是导入导出，只是导出的是二进制文件，一般用来做数据的备份和恢复

mongooplog:日志

mongostat:用于查看数据库的状态

# 搭建一个简单的数据库服务器

1. 创建一个目录，用来存放数据库相关的文件
2. 创建data，用来存放数据库文件
3. 创建log，用来存放数据库日志文件
4. 创建bin，存放数据库可执行文件
5. 创建conf，存放数据库配置文件



## 创建配置文件

mongod.conf

```shell
port=12345
dbpath=data
logpath=log/mongod.log
fork=true
```

## 启动数据库服务器

```shell
mongod -f conf/mongod.conf 
```

如果看到如下信息表示服务区已成功开启

```shell
about to fork child process, waiting until server is ready for connections.
forked process: 23963
child process started successfully, parent exiting
```

启动成功后可以在data目录查看到一些文件，并且日志文件也已经生成了

```shell
tail log/mongod.log 
```

# 连接mongo

## 使用mongo命令

```shell
mongo 127.0.0.1:12345/test
```

数据库地址：127.0.0.1

端口：12345

数据库名：test

# 关闭mongo服务

直接kill相应的进程，15，或不带参数，不能使用9

```shell
use admin
db.shutdownServer()
```

# 基本使用

show dbs：查看数据库

use 数据库名：选择数据库，切换前不需要数据库一定存在

db.dropDatabase():删除数据库

show collections：显示集合，相当于一张表

## 增删改查

```shell
db.test_collection.insert({x:'1'})

//可以自定指定id,但不能重复，重复将报错
db.test_collection.insert({x:'1',_id:1})

//默认返回所有
db.test_collection.find()

//指定条件
db.test_collection.find({x:'1'})

//通过for循环，插入多条数据
for(i=3;i<100;i++)db.test_collection.insert({x:i})

//统计数据条数
db.test_collection.find().count()

//跳过3条，限制返回2条，按照x升排序
db.test_collection.find().skip(3).limit(2).sort({x:1})

//将x=1的第一条数据更新为x=888,如果这条数据原来还有自定，就会覆盖为只有x字段
db.test_collection.update({x:'1'},{x:'888'})

//更新指定字段,只更新z字段，其他的字段不变
db.test_collection.update({y:100},{$set:{z:10}})

//更新一条数据，不存在则创建
db.test_collection.update({x:388},{x:488},true)

//更新多条数据，只能用来使用set符号
db.test_collection.update({a:1},{$set:{a:2}},false,true)

//删除，默认删除所有匹配条件的数据
db.test_collection.remove({a:2})

//删除集合
db.test_collection.drop()
```

# 索引

索引可以重复创建，对于已创建的索引重复创建，会直接返回成功。

## 查看索引

```javascript
db.c1.getIndexes()
```

输出

```shell
[
	{
		"v" : 1,
		"key" : {
			"_id" : 1 //索引键
		},
		"name" : "_id_", //名称
		"ns" : "test.c1" //数据库.表名
	}
]
```

## 创建索引

```shell
//键:排序方法，-1降序，1正序
db.c1.ensureIndex({a:1})
```

## _id索引

他是绝大多数集合默认建立的索引。对于新插入的数据，都会自动生成，也是唯一索引。

### 单键

是最普通的索引，不会自动创建，比如：这样一条数据{a:1,y:2}，如果建立a的索引，就可以提高以a字段查询的效率。

```shell
db.c1.ensureIndex({a:1})
```

## 多键索引

创建方式和单键相同，区别是字段的值，多键具有多个值，如：数组

```shell
db.c1.insert({a:[1,2,3]})
```

插入这条数据后，如果a创建了单键索引，那么对于这条数据就是多键索引。

## 复合索引

当查询条件不止一个时，比如:这条数据{a:1,b:2,c:3}，如果需要同时查询a和b的值，就可以就需要使用复合索引。

```shell
db.c1.ensureIndex({a:1,b:1})
```

获取索引后可以看到

```shell
{
	"v" : 1,
	"key" : {
		"a" : 1,
		"b" : 1
	},
	"name" : "a_1_b_1",
	"ns" : "test.c1"
}
```

## 过期索引

在一段时间后会过期的索引，过期后，相应的数据会被删除。适合存储登陆信息，日志

```shell
//在time字段上创建了一个过期索引
db.c1.ensureIndex({time:1},{expireAfterSeconds:30})

//这样插入一条数据，过期后就会删除，但是默认60秒扫描一次，所以最低也得60秒
db.c1.insert({time:new Date()} )


```

注意：

1. 存储过期索引字段的值必须要是时间类型，也就是ISODate或者ISODate数组，不能使用时间戳，否则不能自动删除，但插入数据不会报错。
2. 如果是ISODate数组，最只要满足最小的时间就删除
3. 不能是复合索引
4. 删除事件不精确，删除程序60s执行一次，删除也需要一定的时间，所以有误差

## 全文索引

对于字符串，字符串数组可以创建全文索引

```shell
db.articles.ensureIndex({key:"text"})

db.articles.ensureIndex({key_1:"text",key_2:"text"})

//将articles集合的每个字段都建立全文索引
db.articles.ensureIndex({"$**":"text"})
```

```shell
db.articles.ensureIndex({"article":"text"})
```

### 使用全文索引查询

```shell
db.articles.find({$text:{$search:"aa"}}) //aa bb,cc aa bb
db.articles.find({$text:{$search:"aa bb cc"}}) //aa||bb||cc
db.articles.find({$text:{$search:"aa bb -cc"}}) //(aa||bb) && !cc
db.articles.find({$text:{$search:"\"aa\" \"bb\" \"cc\""}}) //aa && bb && cc,将每个关键词用引号

db.articles.find({$text:{$search:'"aa" "bb" "cc"'}}) //与上面等效
db.articles.find({$text:{$search:"'aa' 'bb' 'cc'"}}) //同上
```

### 全文查询相似度

使用$meta操作符，比如：{score:{$meta:"textScore"}}

写在查询条件后面就可以返还相似度score字段(该字段名字可以自定义)，同时还可以使用sort排序。

```shell
db.articles.find({$text:{$search:"aa bb"}},{score:{$meta:"textScore"}})
```

返回的数据

```json
{ "_id" : ObjectId("583ad588d1671746663db3a0"), "article" : "aa bb cc dd ee", "score" : 1.2 }
{ "_id" : ObjectId("583ad59ad1671746663db3a2"), "article" : "aa bb cc hh dd", "score" : 1.2 }
{ "_id" : ObjectId("583ad591d1671746663db3a1"), "article" : "aa bb rr gg", "score" : 1.25 }
{ "_id" : ObjectId("583ad85ad1671746663db3a3"), "article" : "aa bb", "score" : 1.5 }
```

按照相似度从大到小排序

```shell
db.articles.find({$text:{$search:"aa bb"}},{score1:{$meta:"textScore"}}).sort({score1:{$meta:"textScore"}})
```

可以看到最大的值排到最前

```shell
{ "_id" : ObjectId("583ad85ad1671746663db3a3"), "article" : "aa bb", "score1" : 1.5 }
{ "_id" : ObjectId("583ad591d1671746663db3a1"), "article" : "aa bb rr gg", "score1" : 1.25 }
{ "_id" : ObjectId("583ad588d1671746663db3a0"), "article" : "aa bb cc dd ee", "score1" : 1.2 }
{ "_id" : ObjectId("583ad59ad1671746663db3a2"), "article" : "aa bb cc hh dd", "score1" : 1.2 }
```

### 限制

每次查询只能指定一个$text

$text查询不能出现在nor查询中，也就是说不能查询不包含的某个值的数据

查询中如果包含$text,hint不再起作用，hint可以指定使用哪个索引

## 索引属性

名字，唯一性，稀疏性，是否定时删除，可以使用如下方式指定

```shell
db.articles.ensureIndex({},{属性名：值})
```

### name名称

默认是键_排序方向

```shell
//指定索引名称为normal_index
db.c2.ensureIndex({a:1,b:-1,c:1},{name:"normal_index"})
```

### unique唯一性

```shell
//如果为true，有相同的值，则创建不成功
db.c2.ensureIndex({a:1},{unique:true/false})
```

## 稀疏性

默认创建的不稀疏的。例如：为x字段创建了索引，但插入的数据不存在x，默认也会为这条数据创建索引，如果不希望创建，就可以指定sparse:true。

```shell
db.c2.createIndex({a:1},{sparse:true/false})
```

注意：不能再稀疏索引上查找不存在的某个字段的记录

查找不存在字段b的数据

```shell
db.c2.find({b:{$exists:false}})
```

强制指定使用某个索引

```shell
db.c2.find({b:{$exists:false}}).hint("b_1")
```

## 删除索引

指定索引名称就行了

```shell
db.c2.dropIndex("normal_index")

//删除所有索引，_id索引不能删除
db.c2.dropIndexes()
```

## 地理位置索引

将一些点的位置存储在mongoDB中，创建索引后，可以按照位置来超照其他点，有两种，他们的却别是计算距离上的区别：

2d索引：用于存储和查找平面上的点

2dsphere索引：用于存储和查找球面的点



查找方式：

1. 查找距离某个点一定距离内的点
2. 查找包含在某个区域内的点

### 2d索引

```shell
db.location.ensureIndex({key:"2d"})
```

位置的表示方式是：经纬度[经度,维度]，取值范围,经度[-180,180]，维度[-90,90]

```shell
//创建一个position字段， 用来存储经纬度
db.location.ensureIndex({position:"2d"})

//插入测试数据
db.location.insert({position:[1,2]})
db.location.insert({position:[3,2]})
db.location.insert({position:[100,2]})
db.location.insert({position:[100,20]})
db.location.insert({position:[180,50]})
db.location.insert({position:[180,100]})
```

#### 查询方式

##### near

查询距离某个点最近的点，不支持$minDistance

```shell
//默认返回100个
db.location.find({position:{$near:[1,1]}})

//返回
{ "_id" : ObjectId("583aefba06570f2078e557bb"), "position" : [ 1, 2 ] }
{ "_id" : ObjectId("583aefbc06570f2078e557bc"), "position" : [ 3, 2 ] }
{ "_id" : ObjectId("583aefbf06570f2078e557bd"), "position" : [ 100, 2 ] }
{ "_id" : ObjectId("583aefc206570f2078e557be"), "position" : [ 100, 20 ] }
{ "_id" : ObjectId("583aefc806570f2078e557bf"), "position" : [ 180, 50 ] }
{ "_id" : ObjectId("583aefcb06570f2078e557c0"), "position" : [ 180, 100 ] }

//限制最远距离
db.location.find({position:{$near:[1,1],$maxDistance:10}})

//返回
{ "_id" : ObjectId("583aefba06570f2078e557bb"), "position" : [ 1, 2 ] }
{ "_id" : ObjectId("583aefbc06570f2078e557bc"), "position" : [ 3, 2 ] }
```

$geoWithin：查询包含在某个形状中的点

形状的表示：

$box:矩形，{$box:[[x1,y1],[x2,y2]]}

$center:圆形，{$center:[x,y],r}

$polygon:多边形，${polygon:[x1,y1],[x2,y2],[x3,y3]}

```shell
//查询在1,2:4,4中的点
db.location.find({position:{$geoWithin:{$box:[[1,2],[4,4]]}}})

//查询在圆心为1，1半径为5中的点
db.location.find({position:{$geoWithin:{$center:[[1,1],5]}}})

//查询在多边形中的点
db.location.find({position:{$geoWithin:{$polygon:[[1,1],[2,3],[4,5],[100,50]]}}})
```

##### geoNear

相当于是near的升级版。

在mongodb中可以使用runCommand执行一些命令，geoNear的使用方法如下：

```shell
db.runCommand(
{
	genoNear:集合名,
	near:[x,y],
	minDistance:值, //2d索引无效
	maxDistance:值,
	num:返回的条数
})
```

```shell
db.runCommand({geoNear:"location",near:[1,2],maxDistance:10,num:3})
```

返回：

```shell
{
	"waitedMS" : NumberLong(0),
	"results" : [
		{
			"dis" : 0,
			"obj" : {
				"_id" : ObjectId("583aefba06570f2078e557bb"),
				"position" : [
					1,
					2
				]
			}
		},
		{
			"dis" : 2, //距离我们制定的点，多远
			"obj" : { //真实的数据
				"_id" : ObjectId("583aefbc06570f2078e557bc"),
				"position" : [
					3,
					2
				]
			}
		}
	],
	"stats" : {
		"nscanned" : 41,
		"objectsLoaded" : 2,
		"avgDistance" : 1, //平均距离
		"maxDistance" : 2, //最大距离
		"time" : 4
	},
	"ok" : 1
}
```

### 2dsphere索引

球面地理位置索引。创建方式如下：

```shell
db.location.ensureIndex({position:"2dsphere"})
```

位置表示方式为：GeoJSON，可以描述为一个点，一条直线，多边形

//TODO

# 索引分析

好处：加快相关字段查询

坏处：增加磁盘空间消耗，降低写入性能

## 如何评判索引构建情况

### mongostat工具

用来查看mongodb状态的工具，使用方式

与索引相关的字段为：idx miss百分比,太高有性能影响

```shell
mongostat -h 127.0.0.1:12345
```

其中insert字段表示：插入数据

那怎么测试这值能，可以卡两个命令窗口，一边插入输入：

```shell
//插入10万条
for(i=0;i<100000;i++)db.c2.insert({x:i})
```

另一个命令窗口查看状态

```shell
mongostat -h 127.0.0.1:12345
```

返回：

```shell
insert query update delete getmore command % dirty % used flushes vsize   res qr|qw ar|aw netIn netOut conn                      time
  2531    *0     *0     *0       0     1|0     0.0    0.1       0 2.46G 13.0M   0|0   0|0  291k   122k    2 2016-11-27T23:53:57+08:00
  2995    *0     *0     *0       0     1|0     0.1    0.1       0 2.46G 14.0M   0|0   0|0  344k   141k    2 2016-11-27T23:53:58+08:00
  2873    *0     *0     *0       0     1|0     0.1    0.1       0 2.46G 15.0M   0|0   0|0  330k   136k    2 2016-11-27T23:53:59+08:00
```

可以看到insert字段的值，改变了。

### profile集合

慢操作值

注意：推荐只在开发，和测试阶段或上线观察阶段使用。

### 日志

可以在配置文件中使用verbose=vvvvv配置，v越多越详细。

### explain分析

http://www.cnblogs.com/c-abc/p/6023824.html

可以查看一个查询的详细信息，比如：耗时

```shell
db.c2.find({x:10000}).explain() //2x
db.c2.find({x:10000}).explain("executionStats") //3x
```

未创建索引时executionTimeMillis为51毫秒

```shell
{
	"queryPlanner" : {
		"plannerVersion" : 1,
		"namespace" : "test.c2",
		"indexFilterSet" : false,
		"parsedQuery" : {
			"x" : {
				"$eq" : 10000
			}
		},
		"winningPlan" : {
			"stage" : "COLLSCAN",
			"filter" : {
				"x" : {
					"$eq" : 10000
				}
			},
			"direction" : "forward"
		},
		"rejectedPlans" : [ ]
	},
	"executionStats" : {
		"executionSuccess" : true,
		"nReturned" : 1,
		"executionTimeMillis" : 51,
		"totalKeysExamined" : 0,
		"totalDocsExamined" : 100014,
		"executionStages" : {
			"stage" : "COLLSCAN",
			"filter" : {
				"x" : {
					"$eq" : 10000
				}
			},
			"nReturned" : 1,
			"executionTimeMillisEstimate" : 50,
			"works" : 100016,
			"advanced" : 1,
			"needTime" : 100014,
			"needYield" : 0,
			"saveState" : 781,
			"restoreState" : 781,
			"isEOF" : 1,
			"invalidates" : 0,
			"direction" : "forward",
			"docsExamined" : 100014
		}
	},
	"serverInfo" : {
		"host" : "rmp.local",
		"port" : 12345,
		"version" : "3.2.10",
		"gitVersion" : "79d9b3ab5ce20f51c272b4411202710a082d0317"
	},
	"ok" : 1
}
```

创建索引后，为0

```shell
{
	"queryPlanner" : {
		"plannerVersion" : 1,
		"namespace" : "test.c2",
		"indexFilterSet" : false,
		"parsedQuery" : {
			"x" : {
				"$eq" : 10000
			}
		},
		"winningPlan" : {
			"stage" : "FETCH",
			"inputStage" : {
				"stage" : "IXSCAN",
				"keyPattern" : {
					"x" : 1
				},
				"indexName" : "x_1",
				"isMultiKey" : false,
				"isUnique" : false,
				"isSparse" : false,
				"isPartial" : false,
				"indexVersion" : 1,
				"direction" : "forward",
				"indexBounds" : {
					"x" : [
						"[10000.0, 10000.0]"
					]
				}
			}
		},
		"rejectedPlans" : [ ]
	},
	"executionStats" : {
		"executionSuccess" : true,
		"nReturned" : 1,
		"executionTimeMillis" : 0,
		"totalKeysExamined" : 1,
		"totalDocsExamined" : 1,
		"executionStages" : {
			"stage" : "FETCH",
			"nReturned" : 1,
			"executionTimeMillisEstimate" : 0,
			"works" : 2,
			"advanced" : 1,
			"needTime" : 0,
			"needYield" : 0,
			"saveState" : 0,
			"restoreState" : 0,
			"isEOF" : 1,
			"invalidates" : 0,
			"docsExamined" : 1,
			"alreadyHasObj" : 0,
			"inputStage" : {
				"stage" : "IXSCAN",
				"nReturned" : 1,
				"executionTimeMillisEstimate" : 0,
				"works" : 2,
				"advanced" : 1,
				"needTime" : 0,
				"needYield" : 0,
				"saveState" : 0,
				"restoreState" : 0,
				"isEOF" : 1,
				"invalidates" : 0,
				"keyPattern" : {
					"x" : 1
				},
				"indexName" : "x_1",
				"isMultiKey" : false,
				"isUnique" : false,
				"isSparse" : false,
				"isPartial" : false,
				"indexVersion" : 1,
				"direction" : "forward",
				"indexBounds" : {
					"x" : [
						"[10000.0, 10000.0]"
					]
				},
				"keysExamined" : 1,
				"dupsTested" : 0,
				"dupsDropped" : 0,
				"seenInvalidated" : 0
			}
		}
	},
	"serverInfo" : {
		"host" : "rmp.local",
		"port" : 12345,
		"version" : "3.2.10",
		"gitVersion" : "79d9b3ab5ce20f51c272b4411202710a082d0317"
	},
	"ok" : 1
}
```

# 安全

物理隔离

网络隔离

防火墙

## 用户名密码

开启权限认证有两种方式

### auth

是在配置文件中加入

```shell
auth=true
```

然后重启服务

```shell
ps -ef | grep mongd | grep 12345
kill 1233
```

重启后我们查看tail log/mongod.log可以看到security: { authorization: "enabled" }，表示已经开启。

但现在我们还可以连接，因为我们还没有创建用户名和密码。

### keyfile

## 创建用户

参考：http://blog.csdn.net/chen88358323/article/details/50206651

2.6版本之前使用addUser，只用使用createUser，语法如下：

```shell
{
	user:username,
	pwd:pwd,
	customData:{自定义的描述信息},
	roles:[{role:角色,db:数据库}]
}
```

内建角色类型：

read,readWrite(只能读写，不能创建索引这些操作),dbAdmin,dbOwner,userAdmin(管理用户，创建用户)









