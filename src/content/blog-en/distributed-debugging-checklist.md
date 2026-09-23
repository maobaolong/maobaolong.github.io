---
title: "9 Things I Check First When Troubleshooting Distributed Systems Online"
description: "When encountering complex failures, the most important thing is not to immediately guess the root cause, but to quickly reduce uncertainty."
publishedAt: 2026-08-06
category: "Distributed Systems"
tags:
  - debugging
  - production
  - checklist
author: "Maobaolong"
readingTime: "6 min"
featured: true
draft: false
---
The biggest risk during an online failure is often not "slow repairs," but rather "the more you fix, the messier it gets."

I will first perform a very mechanical convergence action:

## 1. Unify the Timeline

Ensure that everyone is looking at the same time frame. Without a unified timeline, logs and monitoring can easily tell different stories.

## 2. Define the Scope of Impact

Is it a single machine, a single availability zone, a single tenant, or global? This information will greatly influence the order of investigation.

## 3. Review Recent Changes

Including:

- Code releases
- Configuration changes
- Resource scaling
- Upstream dependency upgrades

## 4. Check for "Stuck" Shared Resources

For example:

- Thread pool is full
- Connection pool leak
- Downstream requests are queued
- Lock contention issues

## 5. Determine if it's a Capacity Issue or a Behavioral Issue

Capacity issues are usually related to increased pressure, while behavioral issues may suddenly appear even when traffic remains unchanged.

## 6. Compare Normal Instances with Anomalous Instances

Differential comparisons almost always yield clues, especially regarding configuration, load, call chains, and resource utilization.

## 7. Confirm if it's a "Secondary Failure"

In many systems, the main issue is not the most critical; rather, it is the degradation strategy, retry storms, or cache breakdowns that amplify the situation.

## 8. Provide a Temporary Stopgap Solution

A stopgap is not surrender; it is a way to gain space for analysis.

## 9. Write the Conclusion Last

The conclusion should be based on a chain of evidence, not on the "most likely" intuition.
