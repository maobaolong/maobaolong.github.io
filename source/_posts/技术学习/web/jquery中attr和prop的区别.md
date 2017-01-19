---
title: jquery中attr和prop的区别（转）

date: 2016-11-24 15:13:48

tags: [技术学习,web,jquery]

categories: 技术学习

keywords: 技术学习,web,jquery

description: jQuery1.6中新添加了一个prop方法，看起来和用起来都和attr方法一样，这两个方法有什么区别呢？这要从HTMl 的attribute与property区别说起，attr与prop正是这两个东西的缩写。

---
# jquery中attr和prop的区别
## 转自[〖芈老头〗的技术空间](http://www.cnblogs.com/Showshare/p/different-between-attr-and-prop.html "〖芈老头〗的技术空间")

在高版本的jquery引入prop方法后，什么时候该用prop？什么时候用attr？它们两个之间有什么区别？这些问题就出现了。

关于它们两个的区别，网上的答案很多。这里谈谈我的心得，我的心得很简单：

- 对于HTML元素本身就带有的固有属性，在处理时，使用prop方法。
- 对于HTML元素我们自己自定义的DOM属性，在处理时，使用attr方法。


上面的描述也许有点模糊，举几个例子就知道了。

 这个例子里`<a>`元素的DOM属性有href、target和class，这些属性就是`<a>`元素本身就带有的属性，也是W3C标准里就包含有这几个属性，或者说在IDE里能够智能提示出的属性，这些就叫做固有属性。处理这些属性时，建议使用prop方法。

```
<a href="#" id="link1" action="delete">删除</a>
```

这个例子里`<a>`元素的DOM属性有“href、id和action”，很明显，前两个是固有属性，而后面一个“action”属性是我们自己自定义上去的，`<a>`元素本身是没有这个属性的。这种就是自定义的DOM属性。处理这些属性时，建议使用attr方法。使用prop方法取值和设置属性值时，都会返回undefined值。

```
<a href="http://www.baidu.com" target="_self" class="btn">百度</a>
```

再举一个例子：

```
<input id="chk1" type="checkbox" />是否可见
<input id="chk2" type="checkbox" checked="checked" />是否可见
```

像checkbox，radio和select这样的元素，选中属性对应“checked”和“selected”，这些也属于固有属性，因此需要使用prop方法去操作才能获得正确的结果。

```
$("#chk1").prop("checked") == false
$("#chk2").prop("checked") == true
```

如果上面使用attr方法，则会出现：

```
$("#chk1").attr("checked") == undefined
$("#chk2").attr("checked") == "checked"
```

全文完。



以下是官方建议attr(),prop()的使用：

| Attribute/Property              | .attr() |.prop()|
|---------------------------------|---------|-------|
|accesskey                        |   √    |        |
|align	                          |   √    |  	    |
|async	                          |   √    |   √    |
|autofocus                        |   √    |   √    |
|checked                          |   √    |   √    |
|class                            |   √    |  	    |
|contenteditable                  |   √    |  	    |
|draggable	                      |   √    |  	    |
|href	                          |   √    |  	    |
|id	                              |   √    |  	    |
|label	                          |   √    |  	    |
|location ( i.e. window.location )|   √    |   √    |
|multiple	                      |   √    |   √    |
|readOnly	                      |   √    |   √    |
|rel	                          |   √    |  	    |
|selected	                      |   √    |   √    |
|src	                          |   √    |  	    |
|tabindex	                      |   √    |  	    |
|title	                          |   √    |  	    |
|type	                          |   √    |  	    |
|width ( if needed over .width() )|   √    |  	    ||


## 转自[mylove](http://aijuans.iteye.com/blog/1954744 "mylove")

attribute和property都可以翻译为属性，为了以示区别，通常把这两个单词翻译为属性与特性。


```
<div id="test">Click Here</div>
```

上面这段HTML语句中有三个节点，分别是Element “div”、attribute “id”、Text “click here”，我们最常见的attribute正式指的attribute类型节点，在JavaScript有专门处理attribute的函数 .getAttribute(name) / setAttribute(name,value)。当然attribute不只是我们能够在HTML文档上看到的这几个，我们可以自定义attributed加到DOM节点中

```
<div id="test">123</div>
    <script type="text/javascript">
        var t=document.getElementById('test');
        t.setAttribute('class','active');
        t.setAttribute('customizedAttr','customized');
    </script>
```

这样可以div被修改为

```
<div id="test" class="active" customizedattr="customized">123</div>
```

通过方法 setAttribute设置的attribute最终都会反映到元素的attribute类型的节点中

property是DOM对象的字段，跟我们平常使用的一些对象一样，包含很多字段，这些字段就是property，取值或者设置值和普通字段一样通过”对象.字段“的方式。

看起来attribute和property应该没有什么关系才对，怎么会。。。attribute和property容易混倄是因为很多attribute节点还有一个相对应的property属性，比如上面div的”id“ attribute 同样可以用t.id取到（实际上绝大部分人都是这样获取的），通过property更改id后，用getAttibute获取的id是更新后的id。

```
t.id='test1';
console.log(t.getAttribute('id'));//test1
```

同样我们也可以自定义property

```
t.customizedProp='customized prop';
```

==区别==

1. 于build-in属性，attribute和property共享数据，attribute更改了会对property造成影响，反之亦然，但是两者的自定义属性是独立的数据，即使name一样，也互不影响，看起来是下面这张图，但是IE6、7没有作区分，依然共享自定义属性数据
![](http://images.cnitblog.com/blog/349217/201309/14160245-d2d2e19297c94935a1ad388be27ba869.png)
2. 并不是所有的attribute与对应的property名字都一致，比如刚才使用的attribute 的class属性，使用property操作的时候应该是这样className

```
<input id="test3" type="checkbox"/>
```
```
var t=document.getElementById('test3');
        console.log(t.getAttribute('checked'));//null
        console.log(t.checked);//false;
        
        t.setAttribute('checked','checked');
        console.log(t.getAttribute('checked'));//checked
        console.log(t.checked);//true
        
        t.checked=false;
        console.log(t.getAttribute('checked'));//checked
        console.log(t.checked);//false
```

4. 对于一些和路径相关的属性，两者取得值也不尽相同，但是同样attribute取得是字面量，property取得是计算后的完整路径

```
<a id="test4" href="#">Click</a>
```
```
var t=document.getElementById('test4');
        console.log(t.getAttribute('href'));//#
        console.log(t.href);//file:///C:/Users/bsun/Desktop/ss/anonymous.html#
```
关于浏览器（IE）造成的兼容性问题可以看看IE 混淆了 DOM 对象属性（property）及 HTML 标签属性（attribute），造成了对 setAttribute、getAttribute 的不正确实现

==**attr和prop**==
相信看完上面内容，大家就明白为什么jQuery要添加prop方法了，在jQuery API中也有专门解释
**Attributes VS. Properties**
在一些特殊的情况下，attributes和properties的区别非常大。在jQuery1.6之前，.attr()方法在获取一些attributes的时候使用了property值，这样会导致一些不一致的行为。在jQuery1.6中，.prop()方法提供了一中明确的获取property值得方式，这样.attr()方法仅返回attributes。

比如，selectedIndex, tagName, nodeName, nodeType, ownerDocument, defaultChecked, 和defaultSelected应该使用.prop()方法获取/设置值。 在jQuery1.6之前这些不属于attribute的property需要用.attr()方法获取。这几个并没有相应的attibute，只有property。

关于布尔类型 attributes，比如一个这样的HTML标签，它在JavaScript中变量名为elem

```
<input type="checkbox" checked="checked" />
```

|  | |
|---------|-------|
|elem.checked	|true (Boolean) Will change with checkbox state       |
|$( elem ).prop( "checked" )	|true (Boolean) Will change with checkbox state |
|elem.getAttribute( "checked" )	|"checked" (String) Initial state of the checkbox; does not change|
|$( elem ).attr( "checked" ) (1.6)	|"checked" (String) Initial state of the checkbox; does not change|
|$( elem ).attr( "checked" ) (1.6.1+)	|"checked" (String) Will change with checkbox state|
|$( elem ).attr( "checked" ) (pre-1.6)	|true (Boolean) Changed with checkbox state|

根据W3C forms specification，checked属性是一个布尔值，这就意味着只要checked属性在HTML中表现出来了，那么相应的property就应该是true，即使checked没有值，这点儿对其它布尔类型的属性一样适用。

然而关于checked 属性需要记住的最重要的一点是：它和checked property并不是一致的。实际上这个attribute和defaultChecked property一致，而且只应该用来设置checkbox的初始值。checked attribute并不随着checkedbox的状态而改变，但是checked property却跟着变。因此浏览器兼容的判断checkebox是否被选中应该使用property

```
if ( elem.checked )
if ( $( elem ).prop( "checked" ) )
if ( $( elem ).is( ":checked" ) )
```

这对其它一些类似于selected、value这样的动态attribute也适用。

在IE9之前版本中，如果property没有在DOM元素被移除之前删除，使用.prop()方法设置DOM元素property（简单类型除外：number、string、boolean）的值会导致内存泄露。为了安全的设置DOM对象的值，避免内存泄露，可以使用.data()方法。

![](http://images.cnitblog.com/blog/349217/201310/01161410-90dde52753e040f3a09b83c418e94026.png)