---
title: "KV Layout Should Not Be Guessed: vLLM #63699, RBLN and the LMCache Contract"
description: "15 diagrams and two interactive examples explain KV axis semantics, physical layout and encoding, trace allocation through connector registration, and show the RBLN, MLA, hybrid and LMCache integration boundaries."
publishedAt: "2026-10-26T14:01:10Z"
category: "AI Infra"
tags:
  - vllm
  - lmcache
  - kv-cache
  - rbln
  - attention
  - distributed-systems
author: "Maobaolong"
readingTime: "22 min"
featured: true
draft: false
---

Do identical shapes and strides imply the same KV cache interpretation? RBLN provides a concrete counterexample at two blocks: `[B,2,H,1,N,D]` and `[2,B,H,1,N,D]` can have identical geometry but different K/V semantics.

This article follows [vLLM #63699](https://github.com/vllm-project/vllm/pull/63699): declare axis semantics where the view is created, then carry them to the connector through registration. The prose, diagrams and interactive examples have complete English and Chinese versions, selected with the button in the site header.

For background on NHD, HND and LBHNC, start with [What KV Layouts Are Chosen by vLLM and LMCache](/en/blog/vllm-lmcache-kv-cache-layouts/). Here we separate axis meaning, byte addressing and content encoding, and mark the boundary between the implemented producer API and the remaining LMCache consumer work.
