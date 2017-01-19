---
title: NodeJs
date: 2016-11-23 00:46:11
categories: NodeJs
tags: 
    - NodeJs
---

# 学习网站

官网：https://nodejs.org

npm:https://www.npmjs.com

github

stack overflow

# 安装nodeJS

## 版本

偶数为稳定版本:0.6.x,0.8.x,0.10.x

基数非稳定版本:0.7.x,0.9.x,0.11.x

## mac安装

升级mac系统到最新，安装最新的xcode

```javascript
xcode-select --install
```

## homebrew

安装方式可以去官网，用ruby命令安装。然后可以安装node js

```javascript
brew install nodejs
```

## 多版本安装

使用n模块来管理，先安装

```javascript
npm install -g n
```

然后就可以通过n来安装相应的版本

```javascript
n 0.10.2
```

安装完了以后，可以通过输入n来切换默认版本：



我们这里是v4.2.3

# 最简单的服务器

```javascript
var http = require('http');

var server = http.createServer(function(request, response) {
	// magic happens here!
	response.writeHead(200, {
		'Content-Type': 'text/html',
		'X-Powered-By': 'bacon'
	});

	response.write('<html>');
	response.write('<body>');
	response.write('<h1>Hello, World!</h1>');
	response.write('</body>');
	response.write('</html>');
	response.end();
});

server.listen(1337, '127.0.0.1')
```

打开浏览器访问http://127.0.0.1:1337,就能看到hello world

# 在命令行执行

我们可以将这段输入到chrome的console中

```javascript
var a=1;var b=2;var add=function(a,b){return a+b};console.log(add(a,b));
```

就可以看到结果为3

同样可以将上面的代码复制到nodejs的命令行，发现结果也是一样。但是他们的全局变量是不一样的，比如我们可以在chrome中输入window,document但是，node里面就不行。但是他有自己的全局变量，比如process,通用浏览器中也是拿不到了。

# 模块

## 模块的使用流程

创建模块：teacher.js

导出模块：exports.add=function(){}

加载模块：var teacher=require('./teacher.js')

使用模块：teacher.add('Li')

# 常用API

## URL

### parse

将一个url解析为host等

```javascript
url.parse('http://i.woblog.cn:8080/post/list?a=b&c=d#abc')
```

输出：

```shell
Url {
  protocol: 'http:',
  slashes: true,
  auth: null,
  host: 'i.woblog.cn:8080',
  port: '8080',
  hostname: 'i.woblog.cn',
  hash: '#abc',
  search: '?a=b&c=d',
  query: 'a=b&c=d',
  pathname: '/post/list',
  path: '/post/list?a=b&c=d',
  href: 'http://i.woblog.cn:8080/post/list?a=b&c=d#abc' }
```

将query解析为对象，只需要传递第二个参数位true

```javascript
url.parse('http://i.woblog.cn:8080/post/list?a=b&c=d#abc',true)
```

```shell
Url {
  protocol: 'http:',
  slashes: true,
  auth: null,
  host: 'i.woblog.cn:8080',
  port: '8080',
  hostname: 'i.woblog.cn',
  hash: '#abc',
  search: '?a=b&c=d',
  query: { a: 'b', c: 'd' }, //这里已经是对象了
  pathname: '/post/list',
  path: '/post/list?a=b&c=d',
  href: 'http://i.woblog.cn:8080/post/list?a=b&c=d#abc' }
```

不知道url协议，也解析出host，不添加第三个参数，可以看到host为空

```javascript
url.parse('//i.woblog.cn:8080/post/list?a=b&c=d#abc',true)
```

```shell
Url {
  protocol: null,
  slashes: null,
  auth: null,
  host: null,
  port: null,
  hostname: null,
  hash: '#abc',
  search: '?a=b&c=d',
  query: { a: 'b', c: 'd' },
  pathname: '//i.woblog.cn:8080/post/list',
  path: '//i.woblog.cn:8080/post/list?a=b&c=d',
  href: '//i.woblog.cn:8080/post/list?a=b&c=d#abc' }
```

第三个参数为true

```javascript
url.parse('//i.woblog.cn:8080/post/list?a=b&c=d#abc',true,true)
```

```shell
Url {
  protocol: null,
  slashes: true,
  auth: null,
  host: 'i.woblog.cn:8080', //有值了
  port: '8080',
  hostname: 'i.woblog.cn',
  hash: '#abc',
  search: '?a=b&c=d',
  query: { a: 'b', c: 'd' },
  pathname: '/post/list',
  path: '/post/list?a=b&c=d',
  href: '//i.woblog.cn:8080/post/list?a=b&c=d#abc' }
```

## format

将一个对象转为一个url,可以是上面的parse对象

```javascript
url.format({
...   protocol: 'http:',
...   slashes: true,
...   auth: null,
...   host: 'i.woblog.cn:8080',
...   port: '8080',
...   hostname: 'i.woblog.cn',
...   hash: '#abc',
...   search: '?a=b&c=d',
...   query: 'a=b&c=d',
...   pathname: '/post/list',
...   path: '/post/list?a=b&c=d',
...   href: 'http://i.woblog.cn:8080/post/list?a=b&c=d#abc' })
```

```shell
http://i.woblog.cn:8080/post/list?a=b&c=d#abc
```

## resolve

```javascript
url.resolve('/one/two/three', 'four')         // '/one/two/four'
url.resolve('http://example.com/', '/one')    // 'http://example.com/one'
url.resolve('http://example.com/one', '/two') // 'http://example.com/two'
```

## queryString

### 将对象转为参数字符串

```javascript
querystring.stringify({name:'li',age:10,course:['b',1],other:''})
```

```shell
'name=li&age=10&course=b&course=1&other='
```

第二个参数表示多个参数间的连接符号，默认&

```javascript
querystring.stringify({name:'li',age:10,course:['b',1],other:''},',')
```

```shell
'name=li,age=10,course=b,course=1,other='
```

第三个参数表示key和value之间的分隔符，默认=

```javascript
querystring.stringify({name:'li',age:10,course:['b',1],other:''},',',':')
```

```shell
'name:li,age:10,course:b,course:1,other:'
```

### 将字符串解析为对象

```javascript
querystring.parse('name=li&age=10&course=b&course=1&other=')
```

```shell
{ name: 'li', age: '10', course: [ 'b', '1' ], other: '' }
```

通用也可以指定多个参数间的连接符号

```javascript
querystring.parse('name=li,age=10,course=b,course=1,other=',',')
```

```shell
{ name: 'li', age: '10', course: [ 'b', '1' ], other: '' }
```

指定key和value间的分隔符

```javascript
querystring.parse('name:li,age:10,course:b,course:1,other:',',',':')
```

```shell
{ name: 'li', age: '10', course: [ 'b', '1' ], other: '' }
```

### 字符转义

```javascript
querystring.escape('<呵 护>')
```

```shell
'%3C%E5%91%B5%20%E6%8A%A4%3E'
```

反转义

```javascript
querystring.unescape('%3C%E5%91%B5%20%E6%8A%A4%3E')
```

# 上下文

```javascript
//上下文

//var pet = {
//	words : "...",
//	speak:function () {
//		console.log(this.words) //this就是pet
//		console.log(this==pet)
//	}
//}
//
//pet.speak()

//function pet(words) {
//	this.words = words
//	console.log(this.words) //global
//	console.log(this==global)
//}
//
//pet("...")

function Pet(words) {
	this.words = words
	this.speak = function() {
		console.log(this.words)
		console.log(this) //this是Pet当前实例
	}
}

var cat = new Pet("Maomi")
cat.speak()
```

## 改变上下文

将一个方法在另一个对象上调用

```javascript
var pet = {
	words: "...",
	speak: function(say) {
		console.log(say + ' ' + this.words)
	}
}

//pet.speak('Speak')

var dog = {
	words: "wang"
}

//改版了speak方法里面的this为dog，打印Speak wang
pet.speak.call(dog, "Speak")
```

实现继承

```javascript
function Pet(words) {
	this.words = words
	this.speak = function() {
		console.log(this.words)
	}
}

function Dog(words) {
	//	Pet.call(this,words) //相当于继承Pet，所以Dog也有speak方法
	Pet.apply(this, arguments)
}

var dog = new Dog("wang")
dog.speak()
```

# 性能测试

我们使用apache ab测试工具

```shell
ab -n1000 -c10 http://localhost:2015/
```

-n请求次数

-c并发数



打印如下信息：

```shell
This is ApacheBench, Version 2.3 <$Revision: 1706008 $>
Copyright 1996 Adam Twiss, Zeus Technology Ltd, http://www.zeustech.net/
Licensed to The Apache Software Foundation, http://www.apache.org/

Benchmarking localhost (be patient)
Completed 100 requests
Completed 200 requests
Completed 300 requests
Completed 400 requests
Completed 500 requests
Completed 600 requests
Completed 700 requests
Completed 800 requests
Completed 900 requests
Completed 1000 requests
Finished 1000 requests


Server Software:        
Server Hostname:        localhost
Server Port:            2015

Document Path:          /
Document Length:        5 bytes

Concurrency Level:      10
Time taken for tests:   0.281 seconds
Complete requests:      1000
Failed requests:        0
Total transferred:      106000 bytes
HTML transferred:       5000 bytes
Requests per second:    3553.72 [#/sec] (mean)
Time per request:       2.814 [ms] (mean)
Time per request:       0.281 [ms] (mean, across all concurrent requests)
Transfer rate:          367.87 [Kbytes/sec] received

Connection Times (ms)
              min  mean[+/-sd] median   max
Connect:        0    0   0.2      0       1
Processing:     1    2   1.9      2      15
Waiting:        1    2   1.9      2      15
Total:          1    3   1.9      2      15

Percentage of the requests served within a certain time (ms)
  50%      2
  66%      3
  75%      3
  80%      3
  90%      4
  95%      5
  98%     11
  99%     12
 100%     15 (longest request)
```

# nodeJS事件

```javascript
var EventEmitter = require('events').EventEmitter

var life = new EventEmitter()

//修改默认值，就不会出现警告
life.setMaxListeners(20)

life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水')
})

life.on('求默默', function(who) {
	console.log('给 ' + who + ' 倒水1')
})

life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水2')
})

life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水3')
})
life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水4')
})
life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水5')
})
life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水6')
})
life.on('求抱抱', function(who) {
	console.log('给 ' + who + ' 倒水7')
})

life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水8')
})
life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水9')
})

//默认超过10个事件，就会有警告，有可能有内存泄漏，可以修改
life.on('求安慰', function(who) {
	console.log('给 ' + who + ' 倒水10')
})

//true，表示已经监听过该事件
var hasConfor = life.emit('求安慰', '美男子')
var hasConfor1 = life.emit('哈哈', '美男子')

console.log(hasConfor)
console.log(hasConfor1)

//移除一个监听，监听时间不能使用匿名函数

function wanwan(who) {
	console.log('给 ' + who + ' 玩玩')
}

life.on('玩玩', wanwan)

//移除事件,移除后，后面就不会打印该事件了
life.removeListener('玩玩', wanwan)

life.emit('玩玩', '美男子')

//获取一个事件有多少个监听器,两种方式
console.log(life.listeners('求安慰').length)
console.log(EventEmitter.listenerCount(life, '求安慰'))

//移除监听

//移除所有事件
//life.removeAllListeners()

//移除指定事件名 事件
life.removeAllListeners('求安慰')

console.log(life.listeners('求抱抱').length)
```

# request方法实例

一个使用request来评论提交评论的例子

```javascript
var http = require('http')
var querystring = require('querystring')

var postData = querystring.stringify({
	'content': '感觉学的还不错！',
	'cid': 348
})

var options = {
	hostname: 'www.imooc.com',
	post: 80,
	path: '/course/docomment',
	method: 'POST',
	headers: {
		'Accept': 'application/json, text/javascript, */*; q=0.01',
		...
	}
}

var req = http.request(options, function(res) {
	console.log('status:' + res.statuscode)
	console.log('headers:' + JSON.stringify(res.headers))

	res.on('data', function(chunk) {
		console.log(Buffer.isBuffer(chunk))
		console.log(typeof chunk)
		console.log(chunk.toString('utf-8'))
	})

	res.on('data', function() {
		console.log('评论完毕')
	})

	res.on('error', function(e) {
		console.log('error:' + e.message)
	})

})

req.write(postData)
req.end()
```

# Promise

先使用用Promise实现一个三个小球的运动

```javascript
<!DOCTYPE html>
<html>

	<head>
		<meta charset="UTF-8">
		<title></title>

		<style>
			.ball {
				width: 40px;
				height: 40px;
				border-radius: 20px;
			}
			
			.ball1 {
				background: red;
			}
			
			.ball2 {
				background: green;
			}
			
			.ball3 {
				background: blue;
			}
		</style>
	</head>

	<body>
		<div class="ball ball1" style="margin-left: 0;"></div>
		<div class="ball ball2" style="margin-left: 0;"></div>
		<div class="ball ball3" style="margin-left: 0;"></div>

		<script>
			var ball1 = document.querySelector('.ball1')
			var ball2 = document.querySelector('.ball2')
			var ball3 = document.querySelector('.ball3')

			function promiseAnimate(ball, distance) {
				return new Promise(function(resolve, reject) {

					function _animate() {

						setTimeout(function() {
							var marginLeft = parseInt(ball.style.marginLeft, 10)
								//					console.log('marginLeft:' + marginLeft + ',distance:' + distance)
							if(marginLeft == distance) {
								resolve()
							} else {
								if(marginLeft < distance) {
									marginLeft++
								} else {
									marginLeft--
								}

								console.log('marginLeft:' + marginLeft + ',distance:' + distance)

								ball.style.marginLeft = marginLeft + 'px'

								console.log('left:' + ball.style.marginLeft)

								_animate()
							}
						}, 13)
					}

					_animate(ball, distance)
				})

			}

			//不适用Promise,就需要多个返回嵌套
			// animate(ball1, 100, function() {
			// 		animate(ball2, 200, function() {
			// 			animate(ball3, 300, function() {
			// 				animate(ball3, 150, function() {
			// 					animate(ball2, 150, function() {
			// 						animate(ball1, 150, function() {

			// 						})
			// 					})
			// 				})
			// 			})
			// 		})
			// 	})

			promiseAnimate(ball1, 100)
				.then(function() {
					return promiseAnimate(ball2, 200)
				})
				.then(function() {
					return promiseAnimate(ball3, 300)
				})
				.then(function() {
					return promiseAnimate(ball3, 150)
				})
				.then(function() {
					return promiseAnimate(ball2, 150)
				})
				.then(function() {
					return promiseAnimate(ball1, 150)
				})
		</script>
	</body>

</html>
```

## 三种状态

未完成pending

已完成fulfilled

失败rejected



状态不可逆，也就是说要么已完成，要么失败，不可能即完成又失败。

## Promise

bluebird

Q

then.js

es6-promise

ypromise

async

native-promise-only

## 使用Promise改写的爬虫

```javascript
var http = require('http')
var cheerio = require('cheerio')
var Promise = require('bluebird')
	//var Promise = require('Promise') //老版本没有

var url = "http://www.imooc.com/learn/348"
var baseUrl = "http://www.imooc.com/learn/"

function filterChapters(html) {
	var $ = cheerio.load(html)
	var chapters = $('.chapter')

	//期望的数据格式
	//	couseData = {
	//		title: title,
	//		number: number,
	//		videos: [{
	//			chapterTitle: '',
	//			videos: [
	//				title: '',
	//				id: ''
	//			]
	//		}]//	}

	var title = $('.course-infos .path span').text()
		//	var title = $('.course-infos .hd h2').text()
	var number = $($('.course-infos .statics .static-item')[0]).find('.js-learn-num').text()

	//	console.log(title)

	var courseData = {
		title: title,
		number: number,
		videos: []
	}

	chapters.each(function(item) {
		var chapter = $(this)
			//			var chapterTitle = chapter.find('strong').children()[0].

		var chapterTitle = chapter.find('strong').text().trim()
			//		console.log(chapterTitle)

		var videos = chapter.find('.video').children('li')

		var chapterData = {
			chapterTitle: chapterTitle,
			videos: []
		}

		videos.each(function(item) {
			var video = $(this).find('.J-media-item')
			var videoTitle = video.text().trim()
			var id = video.attr('href').split('video/')[1].trim()
			chapterData.videos.push({
				title: videoTitle,
				id: id
			})
		})

		courseData.videos.push(chapterData)

	})

	return courseData
}

function printCourse(course) {
	console.log('课程：【' + course.title + '】学习人数：' + course.number)
		//	console.log('课程：【'+course.title+'】')

	course.videos.forEach(function(item) {
		console.log(item.chapterTitle + '\n')
		item.videos.forEach(function(video) {
			console.log(' 【' + video.id + '】' + video.title)
		})
	})
}

function getPageAsync(url) {
	return new Promise(function(resolve, reject) {

		http.get(url, function(res) {
			var html = ''

			res.on('data', function(data) {
				html += data
			})

			res.on('end', function() {
				resolve(html)
					//				var course = filterChapters(html)
					//		console.log(course)
					//				printCourse(course)
			})
		}).on('error', function(e) {
			reject(e)
				//			console.log('获取课程出错')
		})
	})
}

//爬取一个课程
//getPageAsync(url).then(function(data) {
//	console.log(data)
//})

//如果要同时爬去多个课程，可以组建多个Promise
//组建每个课程的Promise
var fetchCourseArray = []

//要抓取的课程id
var videoIds = [637, 348, 259]

//创建某个Promise
videoIds.forEach(function(id) {
	fetchCourseArray.push(getPageAsync(baseUrl + id))
})

//并发执行所有Promise
Promise.
all(fetchCourseArray)
	.then(function(pages) {

		var cousreData = []

		//拿到了每页的数据html，循环遍历
		pages.forEach(function(page) {

			//解析每页的源码，解析Wie一个课程
			var courses = filterChapters(page)

			cousreData.push(courses)
		})

		//	按照学习人数排序
		//		cousreData.sort(function (a,b) {
		//			return a.number>b.number
		//		})

		//打印每个课程
		cousreData.forEach(function(item) {
			printCourse(item)
		})
	})
```

# Buffer

用来处理二进制数据的，直接在node交互是环境下输入Buffer打印如下信息：

```javascript
{ [Function: Buffer]
  poolSize: 8192,
  isBuffer: [Function: isBuffer],
  compare: [Function: compare],
  isEncoding: [Function],
  concat: [Function],
  byteLength: [Function: byteLength] }
```

说明Buffer是一个对象，在node中代表一段内存空间

```javascript
new Buffer('Hello 你好')
<Buffer 48 65 6c 6c 6f 20 e4 bd a0 e5 a5 bd>
```

创建的时候可以执行编码格式，默认是utf-8，比如我们指定为base64

```javascript
> new Buffer('Hello 你好','base64')
<Buffer 1d e9 65 a3>
```

## 指定大小

分配一段指定大小的内存空间，如果写入的长度大于分配的空间，多余的内容不会写入。

```javascript
> var buf = new Buffer(7);buf.write('12345678');console.log(buf);
<Buffer 31 32 33 34 35 36 37>
```

可以看见字符8没有存储。

## 数组方法初始化

```javascript
> var buf=new Buffer([1,3.4,2.1,3]);console.log(buf);
<Buffer 01 03 02 03>
```

他会自动转为int，可以使用下表访问

```javascript
console.log(buf[1])
```

## 常用方法

buffer[index]

buffer.length

buffer.write(string,offset=0,length,encoding=utf8)

可以看到超出长度的字符串不会被写入

```javascript
> var b = new Buffer('hello 你好')
undefined
> b.toString()
'hello 你好'
> b.length
12
> b.write('haha hahahahahahhah你是')
12
> b.toString()
'haha hahahah'
```

从第二个自开始替换，替换两个字符串

```javascript
> var b = new Buffer('hello 你好')
undefined
> b.write('haha hahahahahahhah你是',2,2)
2
> b.toString()
'hehao 你好'
> 
```

buffer.toString(encoding,start=0,end=buffer.length)

指定开始和结束为止位置

```javascript
> b.toString('utf-8',2,4)
'ha'
```

buffer.copy(target,tStart,sStart,sEnd=buffer.length)

buffer.splice(start,end)

buffer.compare(otherBuffer)

buffer.equals(otherBuffer)

buffer.fill(value,offset,end)

## 实例

```javascript
var fs = require('fs')

fs.readFile('logo.png', function(err, origin_buffer) {
	if(err) console.log(err)

	console.log(Buffer.isBuffer(origin_buffer))

	//保存图片
	fs.writeFile('logo_save.png', origin_buffer, function(err) {
		if(err) console.log(err)
	})

	//将图片转为base64
	var imageBase64 = origin_buffer.toString('base64')

	console.log(imageBase64)

	var imageDecode = new Buffer(imageBase64, 'base64')

	console.log(Buffer.compare(origin_buffer, imageDecode))

	fs.writeFile('logo_decode.png', imageDecode, function(err) {
		if(err) console.log(err)
	})
})
```

另外图片的base编码可以通过如下格式用到网页中

```javascript
data:image/png;base64,图片的base64编码
```

然后将上面的数据写入image的src或者css background中的url中，就可以显示出来图片了。

# Stream

流相当于水管，是连接buffer的。

拷贝图片

```javascript
var fs=require('fs')
var source=fs.readFileSync('./logo.png')

fs.writeFileSync('./logo_copy.png',source)
```

## 流事件

```javascript
var fs = require('fs')
var readStream = fs.createReadStream('./stream_copy_image.js')

readStream.
on('data', function(chunk) {
	console.log('data emits')
	console.log(Buffer.isBuffer(chunk))
	console.log(chunk.toString('utf8'));

}).
on('readable', function() {
	console.log('data readable');
}).
on('end', function() {
	console.log('data end')
}).
on('close', function() {
	console.log('data close');
}).
on('error', function(e) {
	console.log('data read error:' + e);
})
```

## 暂停和恢复流

```javascript
var fs = require('fs')
var readStream = fs.createReadStream('./a.mov')
	//var readStream = fs.createReadStream('./stream_copy_image.js')

var n = 0

readStream.
on('data', function(chunk) {
	n++

	console.log('data emits')
	console.log(Buffer.isBuffer(chunk))
		//	console.log(chunk.toString('utf8'));

	//流的暂停和恢复
	readStream.pause()
	console.log("stream pause");

	setTimeout(function() {
		readStream.resume()
		console.log("stream resume");

	}, 2000)

}).
on('readable', function() {
	console.log('data readable');
}).
on('end', function() {
	console.log('data end:' + n)

}).
on('close', function() {
	console.log('data close');
}).
on('error', function(e) {
	console.log('data read error:' + e);
})
```

## 通过流事件拷贝文件

```javascript
var fs = require('fs')
var readStream = fs.createReadStream('a.mov')
var writeStream = fs.createWriteStream('a_copy.mov')

readStream.
on('data', function(chunk) {
	writeStream.write(chunk)
}).
on('end', function() {
	writeStream.end()
})
```

但是上面的代码有个问题就是，有可能写入的数据没有还没有写入到文件，缓冲区就会满了，所以推荐的做法是，判断写入到文件没，没有的话就暂停读取。

```javascript
var fs = require('fs')
var readStream = fs.createReadStream('a.mov')
var writeStream = fs.createWriteStream('a_copy.mov')

readStream.
on('data', function(chunk) {
	if(writeStream.write(chunk) == false) {
		console.log('data pause')
		readStream.pause()
	}
}).
on('end', function() {
	writeStream.end()
})

writeStream.
on('drain', function() {
	console.log('data drains')
	readStream.resume()
})
```

## 流的种类

Readable，Writable，Duplex，Transform

## pipe

```javascript
var http = require('http')
var fs = require('fs')
var request = require('request')

http.createServer(function(req, res) {

	//通过传统方法读取图片
	//	fs.readFile('./logo.png', function(err,data) {
	//		if(err) {
	//			res.end('file not exist')
	//		} else {
	//			res.writeHeader(200, {
	//				'Content-Type': 'image/png'
	//			})
	//			res.end(data)
	//		}
	//	})

	//通过管道
	//	fs.createReadStream('./logo.png').pipe(res)

	//还可以通过网络获取一张图片,需要安装
	request('https://gss1.bdstatic.com/5eN1dDebRNRTm2_p8IuM_a/res/img/richanglogo168_24.png').
	pipe(res)
}).listen(8090)
```

### 拷贝文件

```javascript
var fs = require('fs')
fs.createReadStream('a.mov').pipe(fs.createWriteStream('a_copy.mov'))
```

## 自定义可写流函数

```javascript
var Readable = require('stream').Readable
var Writable = require('stream').Writable

var readStream = new Readable()
var writeStream = new Writable()

readStream.push('i ')
readStream.push("Love ")
readStream.push("JS \n")
readStream.push(null)

//自定义了Writable的write方法
writeStream._write = function(chunk, encode, cb) {
	console.log(chunk.toString())
	cb()
}

readStream.pipe(writeStream)
```

## 自定义流

我们自定义了ReadStream，WritStream，TransformStream并通过TransformStream流混入一些数据

```javascript
var stream = require('stream')
var util = require('util')

function ReadStream() {
	stream.Readable.call(this)
}

util.inherits(ReadStream, stream.Readable)

ReadStream.prototype._read = function() {
	this.push('i ')
	this.push("Love ")
	this.push("JS \n")
	this.push(null)
}

function WritStream() {
	stream.Writable.call(this)
	this._cached = new Buffer('')
}

util.inherits(WritStream, stream.Writable)

WritStream.prototype._write = function(chunk, encode, cb) {
	console.log(chunk.toString());
	cb()
}

function TransformStream() {
	stream.Transform.call(this)
}

util.inherits(TransformStream, stream.Transform)

TransformStream.prototype._transform = function(chunk, encode, cb) {
	this.push(chunk)
	this.push('transform ')
	cb()
}

TransformStream.prototype._flush = function(cb) {
	this.push('flush ')
	cb()
}

var rs = new ReadStream()
var ws = new WritStream()
var ts = new TransformStream()

rs.pipe(ts).pipe(ws)
```

输出

```shell
i 
transform 
Love 
transform 
JS 

transform 
flush 
```

# 常见错误

## 



















