---
title: "How vLLM Seamlessly Pulls Up LMCache: What Did PR #3476's MP Server AutoStart Do?"
description: "An analysis of LMCache PR #3476: How the LMCacheMPConnector automatically pulls up the local MP server when vLLM starts, how the port is resolved, how worker 0 takes on the responsibility of starting, and the lifecycle boundaries of this feature."
publishedAt: 2026-09-11
updatedAt: 2026-09-11
category: "AI Infra"
tags:
  - lmcache
  - vllm
  - kv-cache
  - multiprocess
  - autostart
  - distributed-systems
author: "Maobaolong"
readingTime: "14 min"
featured: true
draft: false
---
In the multiprocess mode of LMCache, the vLLM worker and the LMCache MP server exist as two separate processes. Previously, to get everything running, you typically had to start an `lmcache server` separately, then start `vllm serve` to connect the vLLM connector.

This process itself isn't complicated, but it can be annoying. Especially during local single-machine debugging, CI smoke tests, demo scripts, or when "I just want to verify if the MP connector works," having an additional process orchestration step adds another button that can easily be forgotten.

[PR #3476](https://github.com/LMCache/LMCache/pull/3476) addresses this issue: when vLLM uses the built-in `LMCacheMPConnector`, it can be configured explicitly to have vLLM worker 0 start the local LMCache MP server during the initialization phase.

It may sound like a "small convenience." However, after reviewing it, I believe its most interesting aspect is not `subprocess.Popen`, but rather the careful boundary it draws: **AutoStart is merely a convenience for starting a local single server, not a transformation of the LMCache server into a managed service within vLLM.**

![Comparison of LMCache MP server AutoStart before and after](/images/blog/lmcache-mp-server-autostart/autostart-before-after-en.svg)

## Conclusion First

This PR can be summarized in three sentences:

1. The default behavior remains unchanged. `lmcache.mp.autostart` defaults to `false`, and existing deployments remain connect-only: you start the server yourself, and vLLM is only responsible for connecting.
2. Once enabled, only vLLM worker 0 will attempt to start the local MP server; other workers will simply wait for the server via ZMQ `PING`.
3. It only supports local, single endpoint, single server configurations. Multiple servers, multiple nodes, or servers that need to persist across vLLM lifecycles should continue to be managed externally.

In other words, this is not a "major refactor PR," nor is it a service manager. It is more like smoothing out the most common single-machine startup path: developers no longer need to manually write a two-step script of "start LMCache server first, then start vLLM."

## Previous Issue: Connector Assumes Server is Already There by Default

The basic structure of the LMCache MP connector is as follows:

```text
vLLM worker / scheduler
        │
        │  request client
        ▼
LMCache MP server
        │
        │  KV lookup / store / retrieve
        ▼
LMCache backend
```

In this model, the connector on the vLLM side acts as a client, while the MP server is an already existing service. You can run the server in another terminal, container, systemd, K8s sidecar, or any other orchestration system. This makes sense for formal deployments, as the server's lifecycle, logs, restarts, and resource configurations should have clear ownership.

However, for single-machine development, this can be a bit cumbersome. You first need to remember:

```bash
lmcache server --host 127.0.0.1 --port 5555 \
  --http-host 127.0.0.1 \
  --l1-size-gb 20 \
  --eviction-policy LRU
```

Then, you start vLLM:

```bash
vllm serve Qwen/Qwen3-14B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector","kv_role":"kv_both","kv_connector_extra_config":{"lmcache.mp.port":5555}}'
```

If you forget the first step, the vLLM connector will find the server unhealthy during initialization, and naturally, it won't connect afterward. The issue isn't deep, but it's the kind of small pitfall that can make you sigh daily.

PR #3476 aims to fill this pit.
## Where to Add AutoStart?

From the code structure, this feature mainly resides in three places:

- `lmcache/integration/vllm/lmcache_mp_connector.py`: Parses the MP server endpoint and passes the `server_url` that the current worker should connect to the adapter.
- `lmcache/integration/vllm/vllm_multi_process_adapter.py`: Determines whether the current process is the "starter" or the "waiter."
- `lmcache/integration/vllm/mp_server_launcher.py`: Actually parses the AutoStart configuration, checks health, starts subprocesses, and waits for health.

A key design point here is: **the scheduler is not responsible for starting the server.**

The design document for the PR explains the reason: In the initialization path of the vLLM multiprocess connector targeted by #3476, worker KV connectors are created before the scheduler KV connector. If the start action is placed in the scheduler, the worker may already start connecting to the server, leading to conflicts with the server's startup order.

Thus, the final responsibility allocation is:

![worker 0 starts, other workers wait, scheduler only connects](/images/blog/lmcache-mp-server-autostart/worker-election-sequence-en.svg)

The path for worker 0 is roughly:

```text
parse autostart config
  -> PING the server to check if it's healthy
  -> If healthy, do nothing and reuse
  -> If not healthy, Popen starts the lmcache MP server
  -> Continue PINGing until healthy or timeout
  -> Create a normal request client
```

The path for other workers is simpler:

```text
parse autostart config
  -> Wait for the server via PING
  -> Create a normal request client
```

This avoids multiple workers trying to start on the same port simultaneously.

Another small detail: the PR uses the vLLM worker rank to select the owner, rather than `kv_worker_id`. This choice is not arbitrary. In MLA scenarios, multiple tensor-parallel ranks may share the same derived `kv_worker_id`; using `kv_worker_id == 0` to determine "who is the boss" could lead multiple processes to think they should start the server. The vLLM worker rank is unique within the local scheduler group, making it a more stable choice for owner election.

## How is the Port Number Specified?

This is also where I think this PR is quite restrained: AutoStart does not invent a new endpoint configuration. It reuses the server URL already parsed by the MP connector.

The priority is:

```text
lmcache.mp.server_urls
  > lmcache.mp.host + lmcache.mp.port
  > default tcp://localhost:5555
```

In other words, if you write:

```json
{
  "lmcache.mp.host": "tcp://localhost",
  "lmcache.mp.port": 15555,
  "lmcache.mp.autostart": true,
  "lmcache.mp.autostart.server_args": "--l1-size-gb 20 --eviction-policy LRU"
}
```

Then the server started by AutoStart will bind to `localhost:15555`, and the vLLM worker will connect to this endpoint.

If you do not specify host/port, the default will be:

```text
tcp://localhost:5555
```

The command constructed by the launcher is approximately:

```bash
python -m lmcache.v1.multiprocess.http_server \
  --host localhost \
  --port 5555 \
  --http-host localhost \
  ...extra server args...
```

There are a few limitations to note:

- Once `lmcache.mp.server_urls` is set, it will override `lmcache.mp.host` / `lmcache.mp.port`.
- When AutoStart is enabled, only one server endpoint is allowed; multiple `server_urls` will result in an error during connector initialization.
- The host only accepts `localhost` and `127.0.0.1`.
- IPv6 endpoints, including `::1`, will be rejected.
- `lmcache.mp.autostart.server_args` can pass server sizing parameters like `--l1-size-gb 20 --eviction-policy LRU`.
- However, `server_args` cannot include `--host`, `--port`, or `--http-host`, as this would create a split between the "address the connector should connect to" and the "address the server actually binds to."

![AutoStart configuration parsing path](/images/blog/lmcache-mp-server-autostart/config-resolution-en.svg)

The idea behind this rule is straightforward: there can only be one source for the endpoint. Whatever the connector parses, the launcher should start. Don't let users change the port in two places and end up confusing themselves.

One exception worth mentioning: if there are multiple AutoStart servers on the same machine, each server's ZMQ port must, of course, be different; the HTTP frontend ports may also conflict. The PR documentation suggests passing different `--http-port` values through `server_args` in such cases. `--http-port` is not listed as a prohibited item because it is not the ZMQ endpoint used for connector connections.
## Why Use ZMQ PING for Health Checks?

The MP server process is called `http_server`, but what the vLLM connector really cares about is whether the MP request path is available. The PR does not use HTTP health checks to determine readiness; instead, it reuses the transport side's `RequestClientFactory.create(...)` to create a temporary client and then sends `client.ping(None)`.

I quite like this approach. It checks the "path that the connector will actually use next," rather than another facade that appears healthy.

There are also two small protections in the startup logic:

- Dependencies related to probing are lazily imported. They are only resolved when parsing the AutoStart configuration, so runtime dependencies like torch/transport are not pulled in unnecessarily.
- If worker 0 starts a child process, and that child process exits prematurely or fails to respond to PING within the `wait_timeout`, the launcher will actively clean up this failed startup attempt and raise a `ConnectionError`.

The default wait time is 90 seconds, which can be adjusted via:

```json
{
  "lmcache.mp.autostart.wait_timeout": 120
}
```

This value must be a positive finite number; inputs like `nan` or `inf` will be rejected.

## Why Limit to a Local Single Server?

This question seems like "why not support all deployments at once," but I believe this restraint is justified.

The most common pitfall with AutoStart is not "starting a process," but "who owns this process." A local single server is manageable; vLLM worker 0 starts a child process, and other workers wait for it to be ready, which is a clear semantic.

Once you enter multi-server or multi-node scenarios, the issues become more complex:

- Who should start the server on each node?
- If the server needs to be shared across multiple vLLM instances, who is responsible for avoiding duplicate starts?
- If a server crashes, should vLLM restart it, or should an external supervisor do it?
- Who is responsible for logs, ports, resources, and cleanup?

These questions should not be "pretended to be solved" by a connector initialization function. Therefore, the choice in PR #3476 is that AutoStart only covers local single servers; complex deployments should continue to be managed by Kubernetes, systemd, scripts, or the user's own control mechanisms.

I actually think this is one of the reasons this PR deserves approval: it does not use convenience features to absorb real operational responsibilities.

## Lifecycle Boundary: It Is Not a Persistent Service

The PR body and documentation clearly outline this boundary:

The MP server that comes from AutoStart is a child process of vLLM worker 0, not an independently managed daemon.

`MPServerLauncher` has a `shutdown()` method, but this method is primarily used for "cleaning up the processes it just started in case of a startup failure." The normal shutdown path for the adapter does not explicitly call it. On the other hand, vLLM's own process tree cleanup may also kill this child process.

So the conclusion is not "it will definitely be cleaned up when vLLM exits," nor is it "it will definitely survive after vLLM exits." A more accurate statement is:

> Its lifecycle is tied to vLLM worker 0, but the specific exit behavior depends on the vLLM version and exit path; do not treat it as a LMCache service with persistent semantics.

![AutoStart server lifecycle boundary](/images/blog/lmcache-mp-server-autostart/lifetime-boundary-en.svg)

If you want the LMCache server to continue existing after vLLM restarts, or if multiple vLLM instances need to share the same server, then do not use AutoStart. Instead, run the server independently and let vLLM remain connect-only, which is cleaner.
## How to Write the Configuration?

The minimal form looks like this:

```bash
vllm serve Qwen/Qwen3-14B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector","kv_role":"kv_both","kv_connector_extra_config":{"lmcache.mp.autostart":true,"lmcache.mp.autostart.server_args":"--l1-size-gb 20 --eviction-policy LRU"}}'
```

If you want to change the ZMQ port:

```bash
vllm serve Qwen/Qwen3-14B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector","kv_role":"kv_both","kv_connector_extra_config":{"lmcache.mp.port":15555,"lmcache.mp.autostart":true,"lmcache.mp.autostart.server_args":"--l1-size-gb 20 --eviction-policy LRU --http-port 18080"}}'
```

Here, `lmcache.mp.port` is the ZMQ port shared by the connector and server; `--http-port` is the port for the server's HTTP frontend, which only needs to be specified if you're concerned about HTTP port conflicts.

For an externally hosted server, it remains the original two-step process:

```bash
# Terminal 1
lmcache server --host 127.0.0.1 --port 5555 \
  --http-host 127.0.0.1 \
  --l1-size-gb 20 \
  --eviction-policy LRU

# Terminal 2
vllm serve Qwen/Qwen3-14B \
  --kv-transfer-config \
  '{"kv_connector":"LMCacheMPConnector","kv_role":"kv_both","kv_connector_extra_config":{"lmcache.mp.autostart":false,"lmcache.mp.port":5555}}'
```

## Finally

One reason I like this type of PR is that it’s not about making the architecture seem grander, but rather about addressing small frictions that a developer might actually encounter.

Previously, you had to remember in your head:

```text
Start the LMCache MP server first, then start vLLM.
```

Now, in a single machine single server scenario, it can become:

```text
Start vLLM, and let worker 0 conveniently bring up the local MP server.
```

Fewer steps do not mean fewer boundaries. What PR #3476 truly gets right is preserving both “fewer steps” and “not crossing boundaries.”
