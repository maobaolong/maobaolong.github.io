---
title: 在 MacBook 上用 Docker 跑通 sglang：从源码到 curl 验证的完整链路
description: 把 sglang 在 Apple Silicon Mac 上跑起来的全过程——为什么只能走 Docker、三处必须打的 aarch64 补丁、Docker Desktop vpnkit 的 HTTP/1.1 chunked 陷阱，以及最终如何用 curl 拿到真实推理结果。
publishedAt: 2026-08-19
updatedAt: 2026-08-19
category: AI Infra
tags:
  - sglang
  - docker
  - macos
  - aarch64
  - serving
  - nginx
author: 毛宝龙
readingTime: 14 min
featured: true
draft: false
---

最近想在自己的 MacBook（M 系列芯片）上把 sglang 跑起来，然后 `curl` 发一条请求证明链路通。本文记录的是从克隆源码到拿到 `choices[0].message.content` 的完整过程，包括所有踩过的坑——尤其是 Docker Desktop for Mac 的 vpnkit 端口转发，会悄悄地把 HTTP/1.1 chunked 响应给吃掉。

## 1. 目标与背景

目标非常朴素：

- 在本机 MacBook 上把 sglang serve 起来
- 用 `curl` 打 `/v1/chat/completions`
- 拿到一份合法 JSON，里面 `choices[0].message.content` 有内容

听起来不复杂，但 Apple Silicon（aarch64）+ macOS 的组合，把这件事的难度往上抬了好几档。

## 2. 为什么不能在 macOS 上直接跑

第一次尝试是 `pip install sglang` 然后 `python -m sglang`。直接失败，原因有三：

1. **没有 CUDA**。sglang 的 `sgl_kernel` 是一个 CUDA C++ 扩展，pip 上能找到的 wheel 只覆盖 x86_64 CUDA / aarch64 CUDA（sm90 / sm100），并不覆盖 macOS aarch64。
2. **`torchvision` 0.28.0 的 aarch64 wheel 有缺陷**。`import torchvision` 直接抛 `RuntimeError: Tried to register an operator (torchvision::nms) with the same name as an existing builtin operator`。这是已知的 aarch64 打包问题。
3. **`vllm` 装不上**。sglang 的 CPU 路径会 `from vllm._custom_ops import rotary_embedding`，而 vllm 在 aarch64 上需要 CUDA，没有 CPU wheel。

所以只能走 Docker：在一个 Linux aarch64 容器里跑 sglang CPU 后端。

## 3. 整体架构

最终跑通的架构由两个容器组成，它们跑在同一个用户自定义 Docker 网络 `sgnet` 上：

| 容器 | 镜像 | 网络 | 角色 | 宿主端口 |
| --- | --- | --- | --- | --- |
| `sglang-cpu` | 自建 `sglang-cpu:latest` | `sgnet` | sglang serve (CPU) | 无 |
| `sgproxy` | `nginx:alpine` | `sgnet` | 反向代理 + HTTP/1.0 上游 | 30080 |

为什么需要 nginx 边车？这正是本文最大的坑，下文会详谈。先把镜像构建讲清楚。

## 4. 构建 sglang CPU 镜像

仓库克隆到 `/Users/mbl/projects/sglang`。镜像基于 `python:3.13-slim`（aarch64 multi-arch），下面是精简过的 `Dockerfile.cpu`：

```dockerfile
FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    SGLANG_USE_MODELSCOPE=false

# 阿里云镜像加速 apt；rustup 从 USTC 镜像取
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && for i in 1 2 3 4 5; do \
      apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build pkg-config git curl wget ca-certificates \
        libnuma-dev libssl-dev libffi-dev && break; sleep 3; \
    done \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable \
    --profile minimal --no-modify-path \
 && . $HOME/.cargo/env && rustup default stable
ENV PATH="/root/.cargo/bin:${PATH}"

# PyTorch CPU + sglang-kernel（CUDA 轮子；只用到 schema 定义）
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.13.0 \
 && pip install "sglang-kernel==0.4.6.post1" triton

WORKDIR /opt/sglang
COPY . /opt/sglang
RUN pip install -e ".[runtime_common]"

EXPOSE 30000
CMD ["/bin/bash"]
```

构建命令（在宿主机上）：

```bash
cd /Users/mbl/projects/sglang
docker buildx build --platform linux/arm64 \
  -f Dockerfile.cpu -t sglang-cpu:latest --load .
```

> 注意 `--platform linux/arm64`：宿主是 Apple Silicon，构建出来的镜像就是 aarch64；如果省略，docker buildx 默认 amd64 会失败。

构建过程会卡在几个地方：

- **apt 源**：默认 `deb.debian.org` 在国内网络下经常 timeout，所以加了阿里云镜像 + 5 次重试。
- **rustup 安装**：从 `sh.rustup.rs` 拉脚本可能巨慢，所以用官方脚本但只装 stable / minimal profile。
- **sglang-kernel**：必须装上，哪怕它的 wheel 是 CUDA-only——它的 `__init__.py` 里有 schema 注册逻辑，会影响 sglang 启动期是否能 import。

## 5. 三处必须打的补丁

镜像构建成功、`pip install -e .` 完成之后，`sglang serve` 仍然起不来。下面三个问题都得绕过。

### 5.1 torchvision 的 aarch64 wheel 缺陷

`sglang.srt.utils.common` 在 import 阶段就 `from torchvision.io import decode_jpeg`。在镜像里，`import torchvision` 直接抛：

```
RuntimeError: Tried to register an operator (torchvision::nms / torchvision::qnms) with the same name as an existing builtin operator. ...
```

但 `decode_jpeg` 实际只在 GPU 的 JPEG 解码路径里用到，CPU 文本推理永远不会走到这里。

**解决**：把 `common.py` 第 95 行附近的 import 改成懒加载，只在 `_load_image` 内部引用：

```python
# python/sglang/srt/utils/common.py
# --- before ---
from torchvision.io import decode_jpeg

# --- after ---
# (删除顶层 import；下文不再引用)
```

然后在 `_load_image` 里：

```python
def _load_image(...):
    encoded_image = torch.frombuffer(image_bytes, dtype=torch.uint8)
    from torchvision.io import decode_jpeg   # 现在才 import
    image_tensor = decode_jpeg(encoded_image, device="cuda")
```

但 `import transformers` 也会触发 torchvision 的注册逻辑——同一文件底下还有 `transformers.image_processing_utils` 也会 `import torchvision.io`。所以光改 sglang 一处还不够，得在 Python 启动期就先把 torchvision 的注册错误兜住。

### 5.2 sitecustomize.py：把 torchvision + sgl_kernel 的缺失 op 都兜成 no-op

Python 启动时会自动 import `sitecustomize.py`。我把所有 torchvision / sgl_kernel 缺失 op 的注册失败都 swallow 掉，并提前注册两个 `sgl_kernel` CPU op 的 no-op 实现：

```python
# /usr/local/lib/python3.13/site-packages/sitecustomize.py
import torch

_orig_register_fake = torch.library.register_fake

def _safe_register_fake(op_name, *args, **kwargs):
    try:
        return _orig_register_fake(op_name, *args, **kwargs)
    except RuntimeError as exc:
        if "torchvision::" in str(op_name) and "does not exist" in str(exc):
            def _noop(func):
                return func
            return _noop
        raise

torch.library.register_fake = _safe_register_fake

try:
    from torch.library import Library
    _orig_impl = Library.impl
    def _safe_impl(self, *args, **kwargs):
        try:
            return _orig_impl(self, *args, **kwargs)
        except RuntimeError as exc:
            if "torchvision::" in str(args) and "does not exist" in str(exc):
                return None
            raise
    Library.impl = _safe_impl
except Exception:
    pass

# sgl_kernel 是 CUDA-only wheel，缺 CPU op；提前注册 no-op
try:
    torch.library.define(
        "sgl_kernel::init_cpu_threads_env", "(str? local_omp_cpuid) -> ()"
    )
    @torch.library.impl("sgl_kernel::init_cpu_threads_env", "default")
    def _init_cpu_threads_env_shim(local_omp_cpuid):
        return None

    torch.library.define(
        "sgl_kernel::initialize", "(int tp_size, int tp_rank) -> ()"
    )
    @torch.library.impl("sgl_kernel::initialize", "default")
    def _sgl_initialize_shim(tp_size, tp_rank):
        return None
except Exception:
    pass
```

注意 schema：sglang 实际把 `local_omp_cpuid` 当成字符串传（形如 `"0,1,...,17"`），所以签名必须是 `(str? local_omp_cpuid)`，不是 `(int[]?)`。第一次写成 `int[]?` 会在运行时 type-mismatch。

### 5.3 vllm._custom_ops：RoPE / RMSNorm 的 torch-native 实现

sglang CPU 路径在 `rotary_embedding/base.py:119` 里直接 `from vllm._custom_ops import rotary_embedding`。而 vllm 在 aarch64 CPU 上没有 wheel。

我直接塞了一个 Python-only 的 `vllm/_custom_ops.py`：

```python
# /usr/local/lib/python3.13/site-packages/vllm/_custom_ops.py
import torch

def _rotate_half(x):
    half = x.shape[-1] // 2
    return torch.cat((-x[..., half:], x[..., :half]), dim=-1)

def rotary_embedding(positions, query, key, head_size,
                     cos_sin_cache, is_neox=True):
    cos_sin = cos_sin_cache[positions]
    cos = cos_sin[:, :head_size].unsqueeze(1)
    sin = cos_sin[:, head_size:].unsqueeze(1)
    t = positions.shape[0]
    q = query.view(t, -1, head_size)
    k = key.view(t, -1, head_size)
    if is_neox:
        q_embed = q * cos + _rotate_half(q) * sin
        k_embed = k * cos + _rotate_half(k) * sin
    else:
        def _rotate_interleaved(x):
            x1, x2 = x[..., 0::2], x[..., 1::2]
            return torch.cat((-x2, x1), dim=-1)
        q_embed = q * cos + _rotate_interleaved(q) * sin
        k_embed = k * cos + _rotate_interleaved(k) * sin
    query.copy_(q_embed.reshape_as(query))
    key.copy_(k_embed.reshape_as(key))
    return query, key

def rms_norm(hidden_states, weight, epsilon):
    variance = hidden_states.pow(2).mean(-1, keepdim=True)
    return weight * hidden_states * torch.rsqrt(variance + epsilon)

def fused_add_rms_norm(hidden_states, residual, weight, epsilon):
    residual = residual + hidden_states
    return rms_norm(residual, weight, epsilon), residual
```

把它和 `vllm/__init__.py`（空文件就行）一起放进 site-packages。

到这一步，`sglang serve --device cpu` 才能完成启动期 import。

## 6. 下载模型：ModelScope 比 HF 快得多

我选了 `Qwen2.5-0.5B-Instruct`（小、能在 Mac 上跑得动）。原本想走 HF：

```bash
huggingface-cli download Qwen/Qwen2.5-0.5B-Instruct \
  --local-dir /Users/mbl/projects/models/Qwen2.5-0.5B-Instruct
```

未登录的话会被限速到 ~3 MB/s，下载 988 MB 卡在 201 MB 处根本推不动。

换成 ModelScope（国内网络基本都能跑满）：

```bash
pip install modelscope
modelscope download Qwen/Qwen2.5-0.5B-Instruct \
  --local_dir /Users/mbl/projects/models/Qwen2.5-0.5B-Instruct
```

实测 ~28 MB/s，35 秒下完。下载完直接挂在容器里。

## 7. 启动 sglang 容器

```bash
docker network create sgnet 2>/dev/null || true

docker run -d --name sglang-cpu --network sgnet \
  --entrypoint /usr/local/bin/sglang \
  -e PYTHONFAULTHANDLER=1 \
  -v /Users/mbl/projects/models:/models \
  -v sglang-hf-cache:/root/.cache/huggingface \
  sglang-cpu:latest serve \
    --model-path /models/Qwen2.5-0.5B-Instruct \
    --device cpu --host 0.0.0.0 --port 30000
```

第一次启动会拉模型 + 做 CPU 算子 warmup，大约 1–2 分钟。日志里看到 `The server is fired up and ready to roll!` 就成了。

这里有个细节：`PYTHONFAULTHANDLER=1` 一定要加。后面的排查环节里，我就是靠它才能看到致命信号的 traceback（虽然最后发现是 vpnkit 的问题，根本不抛 Python traceback——但这是排查路径的一部分）。

## 8. 真正的坑：Docker Desktop for Mac 的 vpnkit

启动成功后，我先在容器内验证：

```bash
docker exec sglang-cpu python3.13 -c "
import urllib.request, json
req = urllib.request.Request(
    'http://127.0.0.1:30000/v1/chat/completions',
    data=json.dumps({
        'model': '/models/Qwen2.5-0.5B-Instruct',
        'messages': [{'role':'user','content':'Say hi.'}],
        'max_tokens': 24,
    }).encode(),
    headers={'Content-Type':'application/json'},
)
print(urllib.request.urlopen(req, timeout=30).read().decode())
"
```

容器内直接通：

```
{"id":"...","choices":[{"message":{"role":"assistant","content":"Hello! How can I assist you today?"}}]}
```

然后我从宿主 `curl`：

```bash
docker run -d --name sglang-cpu --network sgnet \
  -p 30000:30000 \
  sglang-cpu:latest serve ...

curl http://127.0.0.1:30000/v1/models
# curl: (52) Empty reply from server
```

容器里通的、宿主里空的。Trivial `python -m http.server` 走同一份端口映射却能通。这就排除了“Docker Desktop 整体问题”，把嫌疑指向 sglang 自己的响应方式。

### 8.1 缩小范围：什么会被 vpnkit 吃掉？

排查过程我做了几组对照实验：

| 服务 | 宿主能拿到响应吗 | 备注 |
| --- | --- | --- |
| `python -m http.server` (HTTP/1.0 + Content-Length) | ✅ |  |
| 同一个镜像里的 trivial uvicorn | ✅ |  |
| sglang（HTTP/1.1 + Transfer-Encoding: chunked） | ❌ | Empty reply |
| nginx 反向代理到 sglang（默认 1.1） | ❌ | 同样 Empty reply |
| nginx 反向代理到 sglang（**HTTP/1.0 + Connection: close**） | ✅ | Content-Length 回来了 |

**结论**：vpnkit 在把容器响应转发回宿主时，会丢掉 `Transfer-Encoding: chunked` 的回复。uvicorn 默认就是 HTTP/1.1 + chunked，所以从宿主看就是“连上了、发了请求、收不到回复”——curl 报 52（Empty reply）。

### 8.2 修复：nginx 边车 + 强制 HTTP/1.0 上游

我做了一件看似多余但实际最省心的事：再加一个 `nginx:alpine` 容器作为反向代理，让它跟 sglang 容器走同一个用户网络。

`/tmp/nginx-sglang.conf`：

```nginx
server {
    listen 80;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_connect_timeout 30s;

    location / {
        proxy_pass http://sglang-cpu:30000;
        proxy_http_version 1.0;          # 关键：让 sglang 用 Content-Length 回应
        proxy_set_header Connection close;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启动：

```bash
docker run -d --name sgproxy --network sgnet \
  -p 30080:80 \
  -v /tmp/nginx-sglang.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

### 8.3 还有一个二级坑：宿主端口 30000 的“粘性缓存”

第一次把 nginx 也绑到宿主 30000 端口时，仍然是 Empty reply；但同一份配置改绑 30017 / 30080 就立刻通。看起来 Docker Desktop 的 vpnkit 会把某个宿主端口的转发规则“粘住”——尤其是这个端口之前被某个别的容器直接 `-p 30000:30000` 用过、后来又挪走的情况。**避开这种端口最稳**。

最终我把宿主侧端口定在 **30080**——避开 30000、30100 这些常见值，基本一次就能通。

## 9. 复用这段基础设施的命令清单

下次重启 / 重建时，按这个顺序就行：

```bash
# 1. 镜像（首次或 Dockerfile 改了再走）
cd /Users/mbl/projects/sglang
docker buildx build --platform linux/arm64 \
  -f Dockerfile.cpu -t sglang-cpu:latest --load .

# 2. 网络
docker network create sgnet 2>/dev/null || true

# 3. sglang
docker rm -f sglang-cpu 2>/dev/null
docker run -d --name sglang-cpu --network sgnet \
  --entrypoint /usr/local/bin/sglang \
  -e PYTHONFAULTHANDLER=1 \
  -v /Users/mbl/projects/models:/models \
  -v sglang-hf-cache:/root/.cache/huggingface \
  sglang-cpu:latest serve \
    --model-path /models/Qwen2.5-0.5B-Instruct \
    --device cpu --host 0.0.0.0 --port 30000

# 4. nginx 边车
docker rm -f sgproxy 2>/dev/null
docker run -d --name sgproxy --network sgnet \
  -p 30080:80 \
  -v /tmp/nginx-sglang.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine

# 5. 验证
curl http://127.0.0.1:30080/v1/models
```

> 镜像里的 sitecustomize.py 和 vllm shim 是构建期就烤进去的，重建后自动生效。如果改了这两个文件但没改 Dockerfile，可以用 `docker cp /tmp/sitecustomize.py sglang-cpu:/usr/local/lib/python3.13/site-packages/sitecustomize.py && docker restart sglang-cpu` 原地打补丁。

## 10. 这件事的几条经验

- **排查容器网络问题时，先在容器内 `curl` 自己、再从宿主 `curl`、再从同网络的另一个容器 `curl`**。三层都通只是宿主不通——几乎可以肯定是 vpnkit / port-forward 这一层的问题。
- **Docker Desktop for Mac 的 vpnkit 对 HTTP/1.1 chunked 不友好**。一旦宿主收到的响应是 `Transfer-Encoding: chunked`，就要警觉。nginx 反代 + `proxy_http_version 1.0` 是最稳的绕开方式。
- **遇到 “Empty reply from server” 不要急着怀疑应用层**。先 `docker exec <容器> curl 127.0.0.1:<port>` 自测，再决定要不要打 traceback。
- **Apple Silicon 上跑 sglang / vllm 的 aarch64 兼容性是一连串小坑叠加的结果**，没有一个统一解法，得逐个打补丁：
  - `sglang/srt/utils/common.py` 顶层 import 别太贪心；
  - `sitecustomize.py` 是最便宜的兜底位置，能解决 torchvision / sgl_kernel 之类“装上了但用不了”的 op 注册问题；
  - `vllm._custom_ops` 这类“第三方包不存在但代码会 import” 的场景，干脆写一个 Python-only 的 shim 顶上，比改 sglang 源码要稳。
- **容器内部用 ModelScope 而不是 HuggingFace**，尤其在国内网络环境。988 MB 的 0.5B 模型，HF 不登录会被限速卡到死，ModelScope 几十秒搞定。

至此，从源码到 `curl` 拿到合法 JSON 的链路就完整跑通了。后续如果想跑更大的模型，可以再回头处理 `--mem-fraction-static`、KV cache 调优、以及多 worker 的 `--tp-size`，但基础链路已经在这台 MacBook 上立住了。