---
title: "KV Layout 不该靠猜：从 vLLM #63699 到 RBLN 与 LMCache 的显式轴契约"
description: "用 15 张图和两个交互示例，讲清 KV cache 的轴语义、物理布局、内容编码，追踪 allocator 到 connector 的完整调用链，以及 RBLN、MLA、hybrid 模型和 LMCache 接入的边界。"
publishedAt: "2026-10-26T14:01:10Z"
category: "AI Infra"
tags:
  - vllm
  - lmcache
  - kv-cache
  - rbln
  - attention
  - distributed-systems
author: "毛宝龙"
readingTime: "22 min"
featured: true
draft: false
---

同样的 shape、同样的 stride，是否一定表示同样的 KV cache？RBLN 在两个 block 时给出了一个明确的反例：`[B,2,H,1,N,D]` 和 `[2,B,H,1,N,D]` 可以在几何信息上完全相同，K/V 的解释却不同。

这篇文章以 [vLLM #63699](https://github.com/vllm-project/vllm/pull/63699) 为主线，说明如何让创建 view 的一方声明轴语义，再沿注册调用链交给 connector。正文、图表和交互都提供完整中英版本，使用页面顶部的语言按钮切换。

如果你还不熟悉 NHD、HND 和 LBHNC，可以先读 [vLLM 和 LMCache 的 KV Layout 到底在选什么](/blog/vllm-lmcache-kv-cache-layouts/)。本文进一步区分“轴是什么”“字节在哪里”和“内容怎么编码”，并明确标出本 PR 已实现的部分与 LMCache 消费者的后续工作。
