---
title: velocity
date: 2016-11-09 15:13:48
tags: [技术学习,velocity,模板引擎]
categories: 技术学习
keywords: 技术学习,velocity,模板引擎,web
description: 介绍kafka的api
---

## JAVA中的map传到vm中

```
One option along the lines of what you already have should be to add the attributes to the model as a map. So in java
map = new HashMap(); 
map.put("id", "solikang")
map.put("pwd", "1234")
map.put("email", "something@example.com");
model.addAttribute("data", map);
Then in velocity
#foreach ($key in $data.keySet())
  <input type="hidden" name="$key" value="$data.get($key)">
#end
```