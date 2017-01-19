---
title: JavaScript语法总结
date: 2016-11-17 11:58:02
categories: JavaScript
tags: 
    - JavaScript
---

# 概述

## 他能做什么

1. 他可以制作交互性极强的网页效果
2. 全世界大部分网页基本上都是用它
3. 所有的主流浏览器基本都支持
4. 数据验证，比如：用户名，邮箱格式验证

# Hello JS

js有很强的易学性，只需要一个文本编辑器就可以编写了，并且js是是解释性的，不需要想c++，java语言需要编译。我们演示一个最简单的例子，就是动态向文档里输出一句话并且动态改变一个标签的字体演示。

```javascript
<!DOCTYPE html>
<html>

	<head>
		<meta charset="utf-8" />
		<title></title>
	</head>

	<body>
		<div id="d1">第一段文字</div>
		<div id="d2">第二段文字</div>

		<script>
			document.write('hello js');
			document.getElementById('d1').style.color = 'red';
		</script>
	</body>

</html>
```

可以看到我们通过document.write方法可以向body标签中添加内容，还可以通过document.getElementById方法通过id选择器找到一个标签动态的将字体的颜色改为了红色。

# 如何在网页里引入js

## head标签

如果将js插入到head标签中，需要用script标签包裹住js代码：

```java
<head>
	<meta charset="utf-8" />
	<title></title>
	
	<script>
		alert('hi')
	</script>
</head>
```

## 引入js文件

js代码不一定非要嵌入到网页里，可以单独写到一个文件，然后引入这文件就好了

common.js

```javascript
alert('我来自一个外部文件')
```

然后在index.html中引入

```html
<script src="js/common.js">

</script>
```

当然也可以在body标签中引入

```javascript
<body>
	<script src="js/common.js">
	</script>

</body>
```

注意：js是一本脚本语言并且可以放到页面的任何位置，但是html是按照从前到后先后顺序执行的，一般放到body的最后面。

# 语句

js语句用分好或换行符隔开。

```javascript
document.write('我是一行语句')
document.write('我是也是一行语句');document.write('我是也是一行语句')
```

其实这是三行语句。

# 注释

注释是写给程序员开的，用以提高代码可读性的。

## 单行注释

用//表示

```javascript
//我是一个单行注释
```

## 多行注释

用`/*开始到*/`结束中间的内容都是注释。

```javascript
/*我是一个多行注释
我可以写多行*/
```

# 变量

简单来讲就是存储可变的量，比如我们我们的天气，每天都不一样。js中变量可以不声明直接使用，但这不符合规范，所有还是先声明，然后在使用，声明变量的语法是：

```javascript
//变量
var weather;
weather='晴天';
alert(weather)

weather='雷阵雨'
alert(weather)

weather=10;
alert(weather)
```

变量可以赋值为不同的类型。

注意：变量名区分大小写。

## 变量名命名规则

1. 字母，下划线，美元符开始
2. 后面接任意多个字母，数字，下划线，美元符
3. 不能使用js的保留关键字

# 流程控制

## if

if else语句可以判断条件是否成立，然后分别执行对应的代码。

```javascript
var age=17;
if (age>=18) {
	alert("你成年了")
} else{
	alert("你还没用成年")
}
```

## if else

```javascript
var myage = 99; //赵红的年龄为99
if(myage <= 44) {
	document.write("青年");
} else if(myage <= 59) {
	document.write("中年人");
} else if(myage <= 89) {
	document.write("老年人");
} else {
	document.write("长寿老年人");
}
```

## switch

```javascript
var myweek = 10; //myweek表示星期几变量
switch(myweek) {
	case 1:
	case 2:
		document.write("学习理念知识");
		break;
	case 3:
	case 4:
		document.write("到企业实践");
		break;

	default:
		document.write("周六、日休息和娱乐");
		break;

	case 5:
		document.write("总结经验");
}
```

一定要写break，default不用一定要放到最后。

# 函数

函数式用来完成某个特定功能的一组语句，用来提高代码的复用性。定义函数的语法是：

```javascript
function 函数名称 () {
	函数代码
}
```

1. 其中function是定义函数的关键字
2. 函数名就是为函数去一个名字，下次用只需要知道函数名称就行了，不需要知道这个函数具体怎么实现额。

例如我们可以编写一个计算两数之和的方法:

```javascript
//定义函数
function add (a,b) {
	return a+b;
}

alert(add(10,20)) //调用函数
```

函数是不能自动执行的，需要我们手动调用。当然我们也可以定义一个button，点击后才执行一个函数。

```javascript
<!DOCTYPE html>
<html>

	<head>
		<meta charset="utf-8" />
		<title></title>
		<script type="text/javascript">

			function clickMe() {
				alert('你再点一下试试！')
			}
		</script>
	</head>

	<body>
		<input type="button" onclick="clickMe()" value="你敢点击吗"></input>
	</body>

</html>
```

# 互动操作

这部分我们将讲解如何输出内容，警告，确认，提问对户口，以及打开新窗口，关闭窗口等操作。

## 输出内容

可以直接用document.write方法。

```javascript
//输出内容
document.write('输出内容')

//可以使用+号连接字符串
document.write('拼接字符串'+"<br/>")
```

## 警告信息

有时候在网页想给用户一个提示框，则可以使用alert对话框。

```javascript
alert('打印一个变量')
var name = '名字'
alert(name)
```

## 确认对话框

该对话框显示一个确定取消对话框，可以和用户交互。

```javascript
function showLoveJS () {
	var loveJS=confirm('你喜欢JS吗？')
	if (loveJS==true) {
		alert('好的，继续加油')
	} else{
		alert('不喜欢也得学呀')
	}
}
```

```html
<input type="button" onclick="showLoveJS()" value="你喜欢js吗">
```

## 提问对话框

通过prompt弹出的对话框还可以让用户输入一些信息。语法：

prompt(str1,str2)

参数解释：

str1:显示在对话框的标题

str2:对话框中文本中的内容，可以修改



返回值

点击确定返回文本框中的内容

点击取消返回null

```javascript
function inputName () {
	var name=prompt('请输入你的名字：')
	if (name==null) {
		alert('请输入名字')
	} else{
		alert('你好,'+name)
	}
}
```

```javascript
<input type="button" onclick="inputName()" value="请输入用户名"></input>
```

## 打开新浏览器窗口

通过open方法可以从已有的窗口打开网页或新建一个浏览器窗口。Win

语法：

window.open([url地址],[窗口名称],[参数字符串])



参数解释：

```
url地址：可选参数，在窗口中显示的路径，如果省略窗口就不显示任何文档。

窗口名：可选参数，被打开窗口的名称。取值如下：

  _top:在框架页面中，上传窗口显示目标网页

  _blank:在新窗口中显示

  _self:在当前窗口显示

窗口名称：相同的name只能创建一个。不能包含空格。

参数字符串：设置窗口的参数，多个用逗号分隔开

```



窗口参数列表：

![](http://img.mukewang.com/52e3677900013d6a05020261.jpg)



例如打开百度，窗口大小为300px*200px，没有菜单，无工具栏，无状态栏，有滚动条。

```javascript
window.open('http://www.baidu.com','_blank','width=300,height=200,menubar=no,toolbar=no, status=no,scrollbars=yes')
```

## 关闭窗口

可是使用window.close()关闭当前窗口，或者使用窗口对象.close()关闭指定窗口。

```javascript
var win = window.open('http://www.baidu.com','_blank','width=300,height=200,menubar=no,toolbar=no, status=no,scrollbars=yes')
win.close()
```

打开一个窗口马上又关闭它。

## 实例：打开用户输入的网址

```javascript
<!DOCTYPE html>
<html>

	<head>
		<meta charset="UTF-8">
		<title></title>

		<script>
			function openWindow() {
				var url = prompt("请输入你想打开的网址：")
				if(url == null) {
					alert('请输入网址')
				} else {
					open(url, '_blank', 'width=300,height=200,menubar=no,toolbar=no, status=no,scrollbars=yes')
				}
			}
		</script>
	</head>

	<body>

		<input type="button" value="打开窗口" onclick="openWindow()" />
	</body>

</html>
```

# Dom操作

## 什么是DOM

全称为Document Object Model也就是文档对象模型，他定义了访问和处理HTML文档的标准方法。DOM将HTML文档呈现为代有元素，属性和文本的树结构，也称节点树。

1. 元素节点：像html,body,p标签
2. 文本节点：内显示内容的节点，li，span
3. 属性节点：如a标签有href属性可以指向一个网址

## 通过ID找元素

id是标签的唯一属性，所以说在网页中可以通过id找到一个确定的元素。

```javascript
document.getElementById('d1').innerText = '我是动态添加的'
```

## innerText属性

用于获取或替换该对象里面的html标签。区分大小写。

```javascript
document.getElementById('d2').innerHTML = '<h1>标题1</h1>'
```

## 改变HTML样式

可以通过js动态的改变html的样式。语法是Object.style.property=new style。

下面列取了常见的属性：

![](http://img.mukewang.com/52e4d4240001dd6c04850229.jpg)

我们来写个实例代码：

```javascript
var d3 = document.getElementById('d3')
d3.style.color='red'
d3.style.fontSize='28'
d3.style.backgroundColor='blue'
```

## 显示和隐藏标签

在网页中，有时候可能某个标签一开始是隐藏的，当一定条件后就显示了。可以通过style.display来设置。

取值：

none：隐藏元素

block:显示元素

```javascript
document.getElementById('d4').style.display='none'
```

## 控制类属性

可以通过className获取或替换class属性值。

```javascript
document.getElementById('d5').className='a'

//添加多个样式
document.getElementById('d5').className='a'
```

# 数组

数组是用来存储多个数组，比如：一个班的同学。

## 定义数组

```javascript
var myarr = new Array();
myarr[0]=80;
myarr[1]=70;
myarr[2]=90;

document.write(myarr[0])
```

创建数组的时候也可以指定长度，但是实际上数组是可以边长的，所有没什么意思。

```javascript
var myarr = new Array(2);

myarr[4]=10;

document.write(myarr.length)

document.write(myarr[0]) //undefined
```

## 创建数组时赋值

```javascript
var myarr = new Array(140,1324);
```

## 字面数组

```javascript
var myarr = [120,34,5];
```

数组里可以是任何类型(数字，字符，布尔值)

## 数组属性

长度：length

## 二维数组

```javascript
var myarr = new Array();
for (var i = 0; i < 10; i++) {
	myarr[i] = new Array();
	
	for (var j = 0; j < 3; j++) {
		myarr[i][j] = i+j;
	}
}

//打印数组
for (var i = 0; i < myarr.length; i++) {
	for (var j = 0; j < myarr[i].length; j++) {
		document.write(myarr[i][j]+' ');
	}
	
	document.write('<br />');
}
```

### 字面常量方式

```javascript
var myarr = [[2,4,5],[2,4]]
for (var i = 0; i < myarr.length; i++) {
	for (var j = 0; j < myarr[i].length; j++) {
		document.write(myarr[i][j]+' ');
	}
	
	document.write('<br />');
}
```

# 事件

事件是可以别js检测到的行为。网页中的元素可以产生某些事件。比如：用户单击一个按钮时触发一个onClick事件。

| 事件          | 说明         |
| ----------- | ---------- |
| onclick     | 鼠标单击事件     |
| onmouseover | 鼠标经过事件     |
| onmouseout  | 鼠标移动事件     |
| onchange    | 文本框内容改变事件  |
| onselect    | 文本框内容选中世事件 |
| onfocus     | 获取到焦点时     |
| onblur      | 失去焦点时      |
| onload      | 网页加载时      |
| onunload    | 关闭网页时      |

# 内置对象

js中所以得事物都是对象，比如：字符串，数组，数值，函数。每个对象有一些属性和方法。

对象的属性：反应该对象的某些特质，比如：人有年龄。

对象的方法：反应某个对象执行的动作，比如：人可以吃饭，睡觉。

js提供了很多内置对象，比如：String,Date,Array等。

## Date

日期对象可以存储任意一个日期，精确到毫秒。

```javascript
var d = new Date(); //当前时间
console.log(d);

var d1 = new Date(2016,10,2);
console.log(d1);

var d2 = new Date('oct 1,2012');
console.log(d2);
```

处理日期时间相关的函数：

| 名称              | 解释              |
| --------------- | --------------- |
| get/setDate     | 获取/设置日期，日       |
| get/setFullYear | 获取/设置年份，YYYY    |
| get/setYear     | 获取/设置年份,三位      |
| get/setMonth    | 获取/设置月份，一月份-0月份 |
| get/setHours    | 获取/设置小时，24小时制   |
| get/setMinutes  | 获取/设置分钟数        |
| get/setSeconds  | 获取/设置秒钟数        |
| get/setTime     | 获取/设置时间，时间戳     |
| set/getDay      | 返回星期，0~6，0表示星期天 |

```javascript
var d = new Date();
console.log(d.getDate()); //19，日

console.log(d.getFullYear()); //2016，年

console.log(d.getYear()); //116,年

console.log(d.getMonth()); //10，月

console.log(d.getHours()); //时

console.log(d.getMinutes()); //分

console.log(d.getSeconds()); //秒

console.log(d.getTime()); //1479521736275,时间戳
```

获取星期

```javascript
var mydate = new Date();
var weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
document.write("今天是：" + weekday[mydate.getDay()]);
```

将当前时间添加2小时

```javascript
mydate.setTime( mydate.getTime()  + 2* 60 * 60 * 1000);
```

## String

### charAt返回指定位置的字符串

```javascript
var  s = "家居安静安静啊hello";
document.write(s.charAt(8)); //e
document.write(s.charAt(0)); //家
```

## indexOf字符串查找

indexOf(subString,startPos)返回某个字符串出现的位置，没搜索到返回-1，区分大小写。

### split分割

split(separator,[limit])，显示返回的字符串个数

```javascript
var s = "家居.安.静安静.啊hello";
console.log(s.split('.')) //家居,安,静安静,啊hello
console.log(s.split('.', 2)) //家居,安
```

如果用""分割，则每个字符都分割

```javascript
//["家", "居", ".", "安", ".", "静", "安", "静", ".", "啊", "h", "e", "l
console.log(s.split('')); 
```

### substring

```javascript
//居.
console.log(s.substring(1, 3)); //不包含位置3
//居.安
console.log(s.substr(1,3));
```

http://www.cnblogs.com/littledu/archive/2011/04/18/2019475.html

区别：

string.substring( 起点 ， 终点 )

string.substr( 起点 ，长度 )

## Math

提供常用的数学计算，平方，对数，π。

Math是一个固有对象，不用创建实例，就可以调用里面的属性，方法。

### 对象属性

| 属性名     | 解释                  |
| ------- | ------------------- |
| E       | 数学常量E，即自然对数底数，2.718 |
| LN2     | 2的自然对数，0.693        |
| LN10    | 10的自然对数，2.302       |
| LOG2E   | 2为底的e对数，1.442       |
| LOG10E  | 10为底的e对数，0.434      |
| PI      | 圆周率，3.14159         |
| SQRT1_2 | 2的平方根的倒数，0.707      |
| SQRT2   | 2的平方根               |

### 对象方法

| 方法         | 解释                   |
| ---------- | -------------------- |
| abs(x)     | 数的绝对值                |
| acos(x)    | 反余弦值                 |
| asin(x)    | 反正弦值                 |
| atan(x)    | 反正切值                 |
| atan2(y,x) | x轴到点(x,y)的角度(以弧度为单位) |
| ceil(x)    | 进行向上舍入               |
| cos(x)     | x的余弦值                |
| exp(x)     | e的指数                 |
| floor(x)   | 对数进行向下舍入             |
| log(x)     | 自然对数，底为e             |
| max(x,y)   | x和y的最大值              |
| min(x,y)   | x和y的最小值              |
| pow(x,y)   | x的y次幂                |
| random()   | 0~1之间的随机数            |
| round(x)   | 四舍五入                 |
| sin(x)     | 数的正弦                 |
| sqrt(x)    | 数的平方根                |
| tan(x)     | 正切                   |
| toSource() | 返回对象的源代码，只有火狐支持      |
| valueOf()  | Math对象的原始值           |

## Array

### 属性

length:数组长度

### 方法

| 方法名             | 解释                         |
| --------------- | -------------------------- |
| concat()        | 连接多个数组，并返回，不改变源数组          |
| join()          | 把数组的所有元素放入字符串，并用分隔符分割，默认逗号 |
| pop()           | 删除并返回数组的最后一个元素             |
| push()          | 向数组的末尾添加一个元素，并返回新长度        |
| reverse()       | 颠倒数组中所以得元素                 |
| shift()         | 删除并返回数组的第一个元素              |
| slice()         | 截取指定区域的元素                  |
| sort()          | 对数组元素排序，可以指定一个函数           |
| splice()        | 删除元素，并向数组添加新元素             |
| toString()      | 将数组转为字符串                   |
| toLocalString() | 把数组转为本地字符串                 |
| unshift()       | 向数组添加一个或多个元素，并返回长度         |
|                 |                            |
|                 |                            |
|                 |                            |

### sort

  若返回值<=-1，则表示 A 在排序后的序列中出现在 B 之前。
  若返回值>-1 && <1，则表示 A 和 B 具有相同的排序顺序。
  若返回值>=1，则表示 A 在排序后的序列中出现在 B 之后。

```javascript
function sortNum(a, b) {
	return a - b;
}
var myarr = new Array("80", "16", "50", "6", "100", "1");
myarr.sort(sortNum)
```

## Window

window对象是BOM的核心，Browser Object Model，浏览器对象模型，他代指当前浏览器窗口。

| 方法名             | 解释                     |
| --------------- | ---------------------- |
| alert()         | 显示一个代一段消息和一个确认按钮的警告框   |
| prompt()        | 用户可以输入的对话框             |
| confirm()       | 一段消息，确定和取消按钮的对话框       |
| open()          | 打开一个浏览器窗口，或者查找一个已命名的窗口 |
| close()         | 关闭一个窗口                 |
| print()         | 打印当前窗口的内容              |
| focus()         | 把键盘焦点给予一个窗口            |
| blur()          | 把键盘从一个窗口移开             |
| moveBy()        | 相对当前坐标叠加到一个坐标         |
| moveTo()        | 把窗口移动到一个指定的坐标          |
| resizeBy()      | 调整当前窗口大小，叠加            |
| resizeTo()      | 调整当前窗口大小到指定的宽高         |
| scrollBy()      | 把内容滚动到指定的坐标，叠加         |
| scrollTo()      | 把内容滚动到指定的坐标            |
| setInterval()   | 每隔指定的时间执行代码            |
| setTimeout()    | 延迟指定的时间执行代码            |
| clearInterval() | 取消setInterval的设置       |
| clearTimeout()  | 取消setTimeout的设置        |

## History

记录了用户曾经访问过的页面，并且可以实现浏览器的前进和后退。

**注意:从窗口被打开的那一刻开始记录，每个浏览器窗口、每个标签页乃至每个框架，都有自己的history对象与特定的window对象关联。**

**语法：**

```
window.history.[属性|方法]
```

**注意：**window可以省略。

### 属性

length:浏览器历史列表中的URL数量

### 方法

| 方法名       | 解释         |
| --------- | ---------- |
| back()    | 前一个URL     |
| forware() | 下一个URL     |
| go()      | 跳转到具体的某个页面 |

## Location

用于获取或设置窗体的URL,并且可以用于解析URL。

**语法:**

```
location.[属性|方法]
```

![](http://img.mukewang.com/53605c5a0001b26909900216.jpg)

### 属性

| 属性名      | 解释             |
| -------- | -------------- |
| hash     | 从#开始的URL,也就是锚  |
| host     | 主机名和端口号        |
| hostname | url主机名         |
| href     | 完整的url         |
| pathname | 路径             |
| port     | 端口             |
| protocol | url协议          |
| search   | 从问号开始的URL，查询部分 |

### 方法

| 方法名       | 解释         |
| --------- | ---------- |
| assign()  | 加载新的文档     |
| reload()  | 重新载入当前文档   |
| replace() | 用新文档替换当前文档 |

## Navigator

包含浏览器的信息，通常用于检测浏览器与操作系统的版本。

### 属性

| 属性名         | 解释                      |
| ----------- | ----------------------- |
| appCodeName | 浏览器代码名字符串表示             |
| appName     | 返回浏览器名字                 |
| appVersion  | 浏览器平台和版本信息              |
| platform    | 运行浏览器的操作系统平台            |
| userAgent   | 返回客户机发给服务器user-agent头的值 |

```javascript
document.write(navigator.appCodeName+'<br />');
document.write(navigator.appName+'<br />');
document.write(navigator.appVersion+'<br />');
document.write(navigator.platform+'<br />');
document.write(navigator.userAgent+'<br />');
```

输出：

```shell
Mozilla
Netscape
5.0 (Macintosh; Intel Mac OS X 10_11_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.98 Safari/537.36
MacIntel
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.98 Safari/537.36
```

通过userAgent判断是什么浏览器：

```javascript
var u_agent = navigator.userAgent;
var B_name = "不是想用的主流浏览器!";
if(u_agent.indexOf("Firefox") > -1) {
	B_name = "Firefox";
} else if(u_agent.indexOf("Chrome") > -1) {
	B_name = "Chrome";
} else if(u_agent.indexOf("MSIE") > -1 && u_agent.indexOf("Trident") > -1) {
	B_name = "IE(8-10)";
} else if(u_agent.indexOf("Safari") > -1) {
	B_name = "Safari";
}
document.write("浏览器:" + B_name + "<br>");
document.write("u_agent:" + u_agent + "<br>");
```

输出：

```shell
浏览器:Chrome
u_agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.98 Safari/537.36
```

## Screen

用于获取用户的屏幕信息。

### 属性

| 属性名         | 解释                        |
| ----------- | ------------------------- |
| availHeight | 窗口可用的屏幕高度,px, 减去界面特性,如任务栏 |
| availWidth  | 可用的屏幕宽度，px                |
| colorDepth  | 用户浏览器表示的颜色位数，通常为32位       |
| pixeDepth   | 同上，ie不支持                  |
| height      | 屏幕的高度，px                  |
| width       | 屏幕的宽度，px                  |

屏幕宽高：

```javascript
//macbook 13.3 retina
document.write(screen.width+'<br />'); //1280
document.write(screen.height+'<br />'); //800
```

屏幕可用宽高

```javascript
document.write("可用宽度：" + screen.availWidth); //1280
document.write("可用高度：" + screen.availHeight); //705
```

## DOM

DOM(Document Object Model)定义和处理HTML文档的标准方法，DOM将html呈现为元素，属性，文本的树结构，也叫节点树。

HTML文档可以说由节点构成的集合，DOM节点有:

1. 元素节点：上图中<html>、<body>、<p>等都是元素节点，即标签。
2. 文本节点:向用户展示的内容，如<li>...</li>中的JavaScript、DOM、CSS等文本。
3. 属性节点:元素属性，如<a>标签的链接属性href="http://bing.com"。

### 属性

| 属性名       | 解释       |
| --------- | -------- |
| nodeName  | 节点名称，字符串 |
| nodeType  | 节点类型，整型  |
| nodeValue | 节点值，字符串  |

```javascript
<body>
	<h1 id="h1">h1</h1>
	<ul>
		<li>l1</li>
		<li>l2</li>
		<li>l3</li>
		<li>l4</li>
		<li>l5</li>
	</ul>

	<script>
		var h1 = document.getElementById('h1');
		console.log(h1.nodeName); //H1
		console.log(h1.nodeType); //1
		console.log(h1.childNodes[0].nodeValue); //h1
	</script>
</body>
```

### 遍历节点方法

| 方法名             | 解释         |
| --------------- | ---------- |
| childNodes      | 元素子节点，数组   |
| firstChild      | 第一个子节点     |
| lastChild       | 最后一个子节点    |
| parentNode      | 父节点        |
| nextSibling     | 当前节点的下一个节点 |
| previousSibling | 当前节点的上一个节点 |

### 节点操作方法

| 方法名                  | 解释                |
| -------------------- | ----------------- |
| createElement(name)  | 创建一个新节点           |
| createTextNode(text) | 创建包含给定文本的文本节点     |
| appendChild()        | 指定节点的子节点最后位置添加新节点 |
| insertBefore()       |                   |
| removeChild()        | 从给定元素中删除一个子节点     |
| replaceChild()       | 替换一个节点            |

```javascript
<!DOCTYPE html>
<html>

	<head>
		<meta charset="UTF-8">
		<title></title>
	</head>

	<body>
		<h1 id="h1">h1</h1>
		<ul>
			<li>l1</li>
			<li>l2</li>
			<li id="ul_l3">l3</li>
			<li>l4</li>
			<li>l5</li>
		</ul>

		<script>
			var ul = document.getElementsByTagName('ul')[0];

			var ul_l3 = document.getElementById('ul_l3');

			var h2Node = document.createElement("h2");
			var textNode = document.createTextNode('这是text');

			var replaceextNode = document.createTextNode('这是替换进来的');

			ul.appendChild(h2Node);

			ul.insertBefore(textNode, ul_l3);

			ul.replaceChild(replaceextNode, ul_l3);

			ul.removeChild(replaceextNode);
		</script>
	</body>

</html>
```

添加一个li标签

```javascript
var otest = document.getElementById("test");
var newNode = document.createElement("li");
newNode.innerText = 'PHP';
otest.appendChild(newNode);
```

移除所以的子节点

```javascript
<!DOCTYPE HTML>
<html>

	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<title>无标题文档</title>
	</head>

	<body>
		<div id="content">
			<h1>html</h1>
			<h1>php</h1>
			<h1>javascript</h1>
			<h1>jquery</h1>
			<h1>java</h1>
		</div>

		<script type="text/javascript">
			function clearText() {
				var content = document.getElementById("content");
				var nodes = content.childNodes;
				// 在此完成该函数

				while(content.firstChild) {
					content.removeChild(content.firstChild);
				}

			}
		</script>

		<button onclick="clearText()">清除节点内容</button>

	</body>

</html>
```

替换子节点

```javascript
<!DOCTYPE HTML>
<html>

	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<title>无标题文档</title>
	</head>

	<body>

		<div><b id="oldnode">JavaScript</b>是一个很常用的技术，为网页添加动态效果。</div>
		<a href="javascript:replaceMessage()"> 将加粗改为斜体</a>

		<script type="text/javascript">
			function replaceMessage() {
				var oldnode = document.getElementById('oldnode');
				var newNode = document.createElement('i');
				newNode.innerText = oldnode.innerText;
				oldnode.parentNode.replaceChild(newNode, oldnode);
			}
		</script>

	</body>

</html>
```

动态创建一个标签

```javascript
<!DOCTYPE HTML>
<html>

	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<title>无标题文档</title>
	</head>

	<body>
		<script type="text/javascript">
			var main = document.body;
			//创建链接
			function createa(url, text) {
				var newNode = document.createElement('a');
				newNode.setAttribute('href', url);
				newNode.innerText = text;
				return newNode;
			}
			// 调用函数创建链接

			var newNode = createa("http://baidu.com", "百度");
			main.appendChild(newNode);
		</script>
	</body>

</html>
```

创建文本节点

```javascript
<!DOCTYPE HTML>
<html>

	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<title>无标题文档</title>
		<style type="text/css">
			.message {
				width: 200px;
				height: 100px;
				background-color: #CCC;
			}
		</style>
	</head>

	<body>
		<script type="text/javascript">
			var divNode = document.createElement('div');
			divNode.className = 'message';
			var textNode = document.createTextNode('I love JavaScript!');
			divNode.appendChild(textNode);
			document.body.appendChild(divNode);
		</script>

	</body>

</html>
```

浏览器窗口可视区域大小

```javascript
<!DOCTYPE html>
<html>

	<head>
		<meta charset="UTF-8">
		<title></title>
	</head>

	<body>
		<script>
			var w = document.documentElement.clientWidth ||
				document.body.clientWidth;
			var h = document.documentElement.clientHeight ||
				document.body.clientHeight;

			alert(w);
			alert(h);
		</script>
	</body>

</html>
```

完整的节点操作案例：动态创建表格一行，删除一行，鼠标经过改变颜色。

```javascript
<!DOCTYPE html>
<html>

	<head>
		<title> new document </title>
		<script type="text/javascript">
			window.onload = function() {

				// 鼠标移动改变背景,可以通过给每行绑定鼠标移上事件和鼠标移除事件来改变所在行背景色。
				var trs = document.getElementsByTagName('tr');
				for(var i = 0; i < trs.length; i++) {

					nodeChangeColor(trs[i]);
					nodeResetColor(trs[i]);
				}

			}

			function nodeChangeColor(n) {
				n.onmouseover = function() {

					this.style.backgroundColor = "red";

				}
			}

			function nodeResetColor(n) {
				n.onmouseout = function() {

					this.style.backgroundColor = "";

				}
			}

			// 编写一个函数，供添加按钮调用，动态在表格的最后一行添加子节点；

			function add() {
				var table = document.getElementById('table').lastChild; //tbody

				var tr = document.createElement('tr');

				nodeChangeColor(tr);
				nodeResetColor(tr);

				var td = document.createElement('td');
				td.innerText = "你好";

				var td1 = document.createElement('td');
				td1.innerText = "哈哈";

				var td2 = document.createElement('td');

				//a
				var a = document.createElement('a');
				a.setAttribute('href', 'javascript:;');
				a.setAttribute('onclick', "del(this)");

				a.innerText = '删除';

				td2.appendChild(a);

				tr.appendChild(td);
				tr.appendChild(td1);
				tr.appendChild(td2);

				table.appendChild(tr);
			}

			// 创建删除函数
			function del(obj) { //obj是外面传入的参数this，也就是删除字段的节点TD

				var a = obj.parentNode.parentNode.parentNode; //获取最外层节点table

				var b = obj.parentNode.parentNode; //获取第二层节点TR，TR里有3个TD，为一行

				a.removeChild(b); //利用父节点table删除子节点TR

			}
		</script>
	</head>

	<body>
		<table border="1" width="50%" id="table">
			<tr>
				<th>学号</th>
				<th>姓名</th>
				<th>操作</th>
			</tr>

			<tr>
				<td>xh001</td>
				<td>王小明</td>
				<td>
					<a href="javascript:;" onclick="del(this)">删除</a>
				</td>
				<!--在删除按钮上添加点击事件  -->
			</tr>

			<tr>
				<td>xh002</td>
				<td>刘小芳</td>
				<td>
					<a href="javascript:;" onclick="del(this)">删除</a>
				</td>
				<!--在删除按钮上添加点击事件  -->
			</tr>

		</table>
		<input type="button" value="添加一行" onclick="add()" />
		<!--在添加按钮上添加点击事件  -->
	</body>

</html>
```



节点类型

| 元素类型 | 节点类型 |
| ---- | ---- |
| 元素   | 1    |
| 属性   | 2    |
| 文本   | 3    |
| 注释   | 8    |
| 文档   | 9    |

# JavaScript版本

![](http://7qnc6h.com1.z0.glb.clouddn.com/Screen%20Shot%202016-12-02%20at%2011.17.10%20PM.png)

# 附录

## 关键字

break
case
catch
continue
default
delete
do
else
finally
for
function
if
in
instanceof
new
return
switch
this
throw
try
typeof
var
void
while
with

## 保留字

abstract
boolean
byte
char
class
const
debugger
double
enum
export
extends
fimal
float
goto
implements
import
int
interface
long
mative
package
private
protected
public
short
static
super
synchronized
throws
transient
volatile























