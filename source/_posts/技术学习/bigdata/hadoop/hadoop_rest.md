---
title: hadoop_rest
date: 2016-11-09 15:13:48
tags: [技术学习,hadoop]
categories: 技术学习
keywords: 技术学习,hadoop,restful
description: 介绍hadoop restfulApi
---

curl -x 172.22.91.78:80 -X GET -H "Accept:application/xml" http://172.16.172.95:19888/ws/v1/history/mapreduce/jobs/job_1470405196301_64396


curl -x 172.22.91.78:80 -X GET -H "Accept:application/json" http://172.16.172.95:19888/ws/v1/history/mapreduce/jobs/job_1470405196301_64396|python -m json.tool
