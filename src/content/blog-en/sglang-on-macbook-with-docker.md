---
title: "Running sglang on MacBook with Docker: A Complete Journey from Source Code to curl Verification"
description: "The entire process of getting sglang running on Apple Silicon Mac—why Docker is the only option, three essential aarch64 patches, the HTTP/1.1 chunked trap of Docker Desktop vpnkit, and ultimately how to obtain real inference results using curl."
publishedAt: 2026-08-19
updatedAt: 2026-08-19
category: "AI Infra"
tags:
  - sglang
  - docker
  - macos
  - aarch64
  - serving
  - nginx
author: "Maobaolong"
readingTime: "14 min"
featured: true
draft: false
---
Recently, I wanted to run `sglang` on my MacBook (with an M series chip) and then use `curl` to send a request to verify the connection. This article documents the complete process from cloning the source code to obtaining `choices[0].message.content`, including all the pitfalls encountered—especially the Docker Desktop for Mac's vpnkit port forwarding, which quietly consumes the HTTP/1.1 chunked response.

## 1. Goals and Background

The goals are quite simple:

- Serve `sglang` on the local MacBook
- Use `curl` to hit `/v1/chat/completions`
- Obtain a valid JSON response containing content in `choices[0].message.content`

It sounds straightforward, but the combination of Apple Silicon (aarch64) and macOS raises the difficulty several notches.

## 2. Why Can't It Run Directly on macOS

The first attempt was `pip install sglang` followed by `python -m sglang`. It failed outright for three reasons:

1. **No CUDA**. The `sgl_kernel` of `sglang` is a CUDA C++ extension, and the wheels available on pip only cover x86_64 CUDA / aarch64 CUDA (sm90 / sm100), but not macOS aarch64.
2. **Defective aarch64 wheel for `torchvision` 0.28.0**. `import torchvision` throws `RuntimeError: Tried to register an operator (torchvision::nms) with the same name as an existing builtin operator`. This is a known packaging issue for aarch64.
3. **Unable to install `vllm`**. The CPU path of `sglang` tries to `from vllm._custom_ops import rotary_embedding`, but `vllm` requires CUDA on aarch64 and does not provide a CPU wheel.

Thus, the only option is to use Docker: run the `sglang` CPU backend inside a Linux aarch64 container.

## 3. Overall Architecture

The final working architecture consists of two containers running on the same user-defined Docker network `sgnet`:

| Container      | Image                     | Network | Role                          | Host Port |
|----------------|---------------------------|---------|-------------------------------|-----------|
| `sglang-cpu`   | Custom `sglang-cpu:latest`| `sgnet` | `sglang` serve (CPU)         | None      |
| `sgproxy`      | `nginx:alpine`           | `sgnet` | Reverse proxy + HTTP/1.0 upstream | 30080     |

Why is an nginx sidecar needed? This is the biggest pitfall of this article, which will be discussed in detail later. First, let's clarify the image build process.

## 4. Building the sglang CPU Image

Clone the repository to `/Users/mbl/projects/sglang`. The image is based on `python:3.13-slim` (aarch64 multi-arch). Below is the streamlined `Dockerfile.cpu`:

```dockerfile
FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    SGLANG_USE_MODELSCOPE=false

# Use Aliyun mirror to speed up apt; rustup pulls from USTC mirror
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

# PyTorch CPU + sglang-kernel (CUDA wheel; only used for schema definition)
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.13.0 \
 && pip install "sglang-kernel==0.4.6.post1" triton

WORKDIR /opt/sglang
COPY . /opt/sglang
RUN pip install -e ".[runtime_common]"

EXPOSE 30000
CMD ["/bin/bash"]
```

Build command (on the host machine):

```bash
cd /Users/mbl/projects/sglang
docker buildx build --platform linux/arm64 \
  -f Dockerfile.cpu -t sglang-cpu:latest --load .
```

> Note `--platform linux/arm64`: The host is Apple Silicon, so the built image will be aarch64; if omitted, `docker buildx` defaults to amd64, which will fail.

The build process may hang at several points:

- **APT sources**: The default `deb.debian.org` often times out under domestic networks, so Aliyun mirrors and 5 retries were added.
- **Rustup installation**: Pulling the script from `sh.rustup.rs` can be very slow, so the official script is used but only installs the stable / minimal profile.
- **sglang-kernel**: It must be installed, even though its wheel is CUDA-only—its `__init__.py` contains schema registration logic that affects whether `sglang` can import during startup.
## 5. Three Essential Patches

After successfully building the image and completing `pip install -e .`, `sglang serve` still fails to start. The following three issues need to be bypassed.

### 5.1 Defect in aarch64 Wheel of torchvision

`sglang.srt.utils.common` imports `from torchvision.io import decode_jpeg` during the import phase. In the image, `import torchvision` throws an error directly:

```
RuntimeError: Tried to register an operator (torchvision::nms / torchvision::qnms) with the same name as an existing builtin operator. ...
```

However, `decode_jpeg` is only used in the GPU JPEG decoding path, and CPU text inference will never reach this point.

**Solution**: Change the import near line 95 in `common.py` to lazy loading, referencing it only within `_load_image`:

```python
# python/sglang/srt/utils/common.py
# --- before ---
from torchvision.io import decode_jpeg

# --- after ---
# (Remove top-level import; no further references below)
```

Then in `_load_image`:

```python
def _load_image(...):
    encoded_image = torch.frombuffer(image_bytes, dtype=torch.uint8)
    from torchvision.io import decode_jpeg   # Now import
    image_tensor = decode_jpeg(encoded_image, device="cuda")
```

However, `import transformers` will also trigger the registration logic of torchvision—there's also `transformers.image_processing_utils` that will `import torchvision.io`. So simply modifying `sglang` is not enough; we need to catch the torchvision registration error during Python startup.

### 5.2 sitecustomize.py: Wrap Missing Ops of torchvision + sgl_kernel as No-ops

Python automatically imports `sitecustomize.py` at startup. I swallow all registration failures for missing ops in torchvision / sgl_kernel and pre-register two no-op implementations for `sgl_kernel` CPU ops:

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

# sgl_kernel is a CUDA-only wheel, missing CPU ops; pre-register no-op
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

Note the schema: sglang actually passes `local_omp_cpuid` as a string (like `"0,1,...,17"`), so the signature must be `(str? local_omp_cpuid)`, not `(int[]?)`. Writing it as `int[]?` initially would cause a runtime type mismatch.

### 5.3 vllm._custom_ops: Torch-native Implementation of RoPE / RMSNorm

The CPU path of sglang directly imports `from vllm._custom_ops import rotary_embedding` in `rotary_embedding/base.py:119`. However, vllm does not have a wheel for aarch64 CPU.

I directly added a Python-only `vllm/_custom_ops.py`:

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

Place it along with `vllm/__init__.py` (an empty file is sufficient) in site-packages.

At this point, `sglang serve --device cpu` can complete the startup import.
## 6. Downloading the Model: ModelScope is Much Faster than HF

I chose `Qwen2.5-0.5B-Instruct` (small, can run on Mac). Initially, I wanted to use HF:

```bash
huggingface-cli download Qwen/Qwen2.5-0.5B-Instruct \
  --local-dir /Users/mbl/projects/models/Qwen2.5-0.5B-Instruct
```

If not logged in, the speed is limited to ~3 MB/s, and the download of 988 MB gets stuck at 201 MB, making no progress at all.

Switching to ModelScope (which can generally run at full speed on domestic networks):

```bash
pip install modelscope
modelscope download Qwen/Qwen2.5-0.5B-Instruct \
  --local_dir /Users/mbl/projects/models/Qwen2.5-0.5B-Instruct
```

In practice, it downloads at ~28 MB/s, completing in 35 seconds. After downloading, it directly runs in the container.

## 7. Starting the sglang Container

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

The first startup will pull the model and perform CPU operator warmup, taking about 1–2 minutes. When you see `The server is fired up and ready to roll!` in the logs, it's done.

There's a detail here: `PYTHONFAULTHANDLER=1` must be added. During the subsequent troubleshooting, I relied on it to see the traceback of fatal signals (though it turned out to be a vpnkit issue that didn’t throw a Python traceback—this was part of the troubleshooting path).

## 8. The Real Pitfall: Docker Desktop for Mac's vpnkit

After a successful startup, I first verified inside the container:

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

It works directly inside the container:

```
{"id":"...","choices":[{"message":{"role":"assistant","content":"Hello! How can I assist you today?"}}]}
```

Then I tried from the host using `curl`:

```bash
docker run -d --name sglang-cpu --network sgnet \
  -p 30000:30000 \
  sglang-cpu:latest serve ...

curl http://127.0.0.1:30000/v1/models
# curl: (52) Empty reply from server
```

It works inside the container, but returns empty on the host. A trivial `python -m http.server` using the same port mapping works fine. This rules out a "Docker Desktop overall issue," pointing the suspicion towards sglang's own response method.

### 8.1 Narrowing Down: What Could Be Consumed by vpnkit?

During the troubleshooting process, I conducted several comparative experiments:

| Service | Can the host get a response? | Notes |
| --- | --- | --- |
| `python -m http.server` (HTTP/1.0 + Content-Length) | ✅ |  |
| Trivial uvicorn in the same image | ✅ |  |
| sglang (HTTP/1.1 + Transfer-Encoding: chunked) | ❌ | Empty reply |
| nginx reverse proxy to sglang (default 1.1) | ❌ | Also Empty reply |
| nginx reverse proxy to sglang (**HTTP/1.0 + Connection: close**) | ✅ | Content-Length returned |

**Conclusion**: vpnkit drops responses with `Transfer-Encoding: chunked` when forwarding container responses back to the host. Uvicorn defaults to HTTP/1.1 + chunked, so from the host's perspective, it appears as "connected, request sent, no response received"—curl reports 52 (Empty reply).

### 8.2 Fix: Nginx Sidecar + Force HTTP/1.0 Upstream

I did something that seemed redundant but was actually the most hassle-free: I added another `nginx:alpine` container as a reverse proxy, allowing it to share the same user network with the sglang container.

`/tmp/nginx-sglang.conf`:

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
        proxy_http_version 1.0;          # Key: allows sglang to respond with Content-Length
        proxy_set_header Connection close;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Starting it:

```bash
docker run -d --name sgproxy --network sgnet \
  -p 30080:80 \
  -v /tmp/nginx-sglang.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

### 8.3 Another Secondary Pitfall: "Sticky Cache" on Host Port 30000

When I first bound nginx to the host port 30000, it still returned an Empty reply; however, changing the binding to 30017 / 30080 immediately worked. It seems that Docker Desktop's vpnkit "sticks" to the forwarding rules of a certain host port—especially in cases where that port was previously used directly by another container with `-p 30000:30000` and later moved. **Avoiding such ports is the safest approach**.

Ultimately, I set the host-side port to **30080**—steering clear of common values like 30000 and 30100, which generally allows it to work on the first try.
## 9. Command List for Reusing This Infrastructure

Next time you restart/rebuild, just follow this order:

```bash
# 1. Image (only if it's the first time or if the Dockerfile has changed)
cd /Users/mbl/projects/sglang
docker buildx build --platform linux/arm64 \
  -f Dockerfile.cpu -t sglang-cpu:latest --load .

# 2. Network
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

# 4. Nginx Sidecar
docker rm -f sgproxy 2>/dev/null
docker run -d --name sgproxy --network sgnet \
  -p 30080:80 \
  -v /tmp/nginx-sglang.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine

# 5. Verification
curl http://127.0.0.1:30080/v1/models
```

> The `sitecustomize.py` and `vllm shim` in the image are baked in during the build phase and will take effect automatically after rebuilding. If you modify these two files but do not change the Dockerfile, you can patch it in place using `docker cp /tmp/sitecustomize.py sglang-cpu:/usr/local/lib/python3.13/site-packages/sitecustomize.py && docker restart sglang-cpu`.

## 10. Some Lessons Learned

- **When troubleshooting container network issues, first `curl` from within the container, then from the host, and finally from another container on the same network**. If all three layers are accessible except the host, it's almost certainly an issue with vpnkit/port-forward.
- **Docker Desktop for Mac's vpnkit is not friendly to HTTP/1.1 chunked responses**. Once the response received by the host is `Transfer-Encoding: chunked`, be cautious. Using nginx as a reverse proxy with `proxy_http_version 1.0` is the most reliable workaround.
- **Don't rush to suspect the application layer when encountering "Empty reply from server"**. First, perform a self-test with `docker exec <container> curl 127.0.0.1:<port>`, then decide whether to trace back.
- **Running sglang/vllm on Apple Silicon's aarch64 compatibility is the result of a series of small pitfalls**; there is no unified solution, and patches need to be applied individually:
  - Avoid being too greedy with top-level imports in `sglang/srt/utils/common.py`;
  - `sitecustomize.py` is the cheapest fallback location that can resolve issues with op registration like "installed but unusable" for torchvision/sgl_kernel;
  - For scenarios like `vllm._custom_ops` where "third-party packages do not exist but the code will import," it's more stable to write a Python-only shim rather than modifying the sglang source code.
- **Use ModelScope instead of HuggingFace inside the container**, especially in domestic network environments. The 988 MB 0.5B model will be throttled to a crawl without logging into HF, while ModelScope can handle it in just a few seconds.

At this point, the entire chain from source code to obtaining valid JSON via `curl` has been successfully completed. If you want to run larger models later, you can revisit tuning `--mem-fraction-static`, KV cache adjustments, and the `--tp-size` for multiple workers, but the foundational link has already been established on this MacBook.
