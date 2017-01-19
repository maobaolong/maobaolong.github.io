---
title: jquery
date: 2016-11-09 15:13:48
tags: [技术学习,web,jquery]
categories: 技术学习
keywords: 技术学习,web,jquery
description: 介绍jquery

---
# jquery

$("#id")
$(".样式")
$("标签名[属性名=属性值][属性名2=属性值2][属性名3!=属性值3]")   $("input[data-type=group_checkbox]")
$(this)
$(#id).find("input") 查找后代input元素

$("#addQueueDiv").show();
$("#addQueueDiv").hide();

$("#addQueueDiv")[0].style.visibility="visible"
$("#addQueueDiv")[0].style.visibility="hidden"

tab切换事件
$(document).on('shown.bs.tab', 'a[data-toggle="tab"]', function(e) {
   console.log(e.target) // activated tab
});

