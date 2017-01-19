---
title: html
date: 2016-11-09 15:13:48
tags: [技术学习,web,html]
categories: 技术学习
keywords: 技术学习,web,html
description: 介绍html

---
## 事件相应两次的问题

```
<html>
<head>
<meta charset="utf-8">
<title>菜鸟教程(runoob.com)</title>
<script src="http://apps.bdimg.com/libs/jquery/2.1.4/jquery.min.js">
</script>
</head>
<body>
  <label id="mylabel" >
  <input type="checkbox" value="" level="$!category.level" data-id="$!category.id" data-parentId="$!categoryInfo.id" data-type="categoryInfoType">$!category.name
</label>
<div id="test">
　 <input type="checkbox" name="abc" id="abc"/>
  <label for="abc">3423432432432432</label>
</div>
<script type="text/javascript">
  $("#test").click(function(ev) {
  console.log(ev.target);
  });
  $("#mylabel").click(function(event) {
console.log(event.target);
});
</script>
</body>
</html>

```
## 设置textArea 允许拖动方向
```
<textarea  style="resize:vertical;"></textarea>
```
resize的值，可以为：
- both
- vertical
- horizontal
- none


