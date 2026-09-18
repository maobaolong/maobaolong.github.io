const COPY = {
  register: [
    "vLLM worker 先拿到真实的 KV tensor、KVCacheConfig 和 layout hints；后续所有轻量 STORE / RETRIEVE 都要依赖这次注册建立的契约。",
    "注册前的 edit 不搬 byte，只把 sub-paged attention、MLA 或 Mamba state 改成 LMCache 后面能按 page 搬运的 view。",
    "create_engine_group_infos_from_vllm 把两类事实合在一起：vLLM 的 block-id group 语义，以及真实 tensor 暴露出的 transfer layout。",
    "跨进程发送的不是 torch.Tensor 本体，而是 DeviceIPCWrapper 列表和 EngineGroupInfo；server 可以 import handle，却不需要解析 vLLM layer name。",
    "server import IPC handle 后会基于真实 tensor view 再跑一次 format discovery，并按 layer_indices 找到需要参与分组的 registered tensors。",
    "注册完成后，server 拥有 KVLayerGroupsManager、layout registry 和 context table；后续 STORE / RETRIEVE 才能只带 block ids 和 token span。"
  ],
  review: [
    "最开始 worker tensor 第一维数的是 kernel page，每个 page 只有 32 个 token slot；vLLM block id 还不能直接拿它当 544-token block 用。",
    "如果只拿一小段 physical pages，当成一个 vLLM block，会让 block id 到 byte range 的映射提前截断。",
    "17 个连续 physical pages 才构成 vLLM 调度侧的一个 logical block：17 × 32 = 544 token slots。",
    "re-view 的动作是改 shape，不复制数据：同一段 storage 从 [N * 17, 2, 32, H, C] 被标成 [N, 2, 544, 1, C']。",
    "从这一步之后，LMCache 用 block id 0 寻址时，看到的是完整 logical block 0，而不是 raw tensor 里的单个 32-token kernel page。"
  ],
  grouping: [
    "先把有序 dict 摊平成 registered tensor list；从这一步之后，跨进程协议尽量只讲 index，不再要求 server 理解 vLLM layer name。",
    "vLLM group metadata 仍然使用 layer names。这个例子里 group 0 选择的是 layer.0、layer.2、layer.4。",
    "客户端用 layer_to_idx 把名字翻译成 registered tensor list 的位置，所以 group 0 变成 layer_indices = (0, 2, 4)。",
    "prefix_cacheable = false 的 group 不形成 EngineGroupInfo；它保留在 worker runtime 里，但不进入 prefix KV transfer 协议。",
    "最后还要按 physical transfer identity 拆分。layout、dtype、head_size 或 slots_per_block 不同，就算 engine group 语义相近，也要分成不同 kernel group。"
  ],
  expand: [
    "vLLM 发来的是按 engine group 排列的 block ids；这个坐标系描述调度语义，不直接等于 server 要 launch 的 kernel group 顺序。",
    "info 0 来自 engine group 0，所以拿到 group 0 的 block ids：[10, 11]。",
    "info 1 来自 engine group 1，所以拿到 group 1 的 block ids：[20, 21]。",
    "info 2 虽然是第三个 kernel group，但它的 engine_group_id 仍然是 0；因此它复用 group 0 的 block ids：[10, 11]。"
  ],
  mamba: [
    "Mamba / linear attention 保存的是 recurrent state snapshot，不是每个 token 一份 K/V。这里先把 conv_state 和 ssm_state 当成两段不同形状的 bytes。",
    "注册前的 edit 会把这些 state bytes 放进一个固定 page：conv bytes、ssm bytes 后面可能还有 padding，用来补齐 page 大小。",
    "LMCache transfer kernel 想看到的是统一 page shape，所以这整页 bytes 被 re-view 成 [num_blocks, 2, block_size, 1, head_size]。",
    "这里的 2 和 1 都是 synthetic transfer axes，不是 attention 的 K/V plane 和真实 head。重要的是 block id 能定位完整 state page。",
    "生成 EngineGroupInfo 时会标记 recurrent_state = true，并把可恢复窗口理解成一个 block：命中多个 block 时，真正恢复的是最后一个匹配 snapshot。"
  ]
};

const REVIEW_COUNTS = [0, 5, 17, 17, 17];
const AUTOPLAY_MS = 3600;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function clampStep(value, total) {
  return (value + total) % total;
}

function setGenericState(root, step) {
  root.querySelectorAll("[data-show-from]").forEach((item) => {
    const from = Number(item.dataset.showFrom || 0);
    const until = item.dataset.showUntil == null ? Number.POSITIVE_INFINITY : Number(item.dataset.showUntil);
    item.classList.toggle("is-visible", step >= from && step <= until);
  });

  root.querySelectorAll("[data-highlight-step]").forEach((item) => {
    const steps = (item.dataset.highlightStep || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => !Number.isNaN(value));
    item.classList.toggle("is-highlighted", steps.includes(step));
  });
}

function setReviewState(root, step) {
  const count = REVIEW_COUNTS[step] || 0;
  root.style.setProperty("--review-progress", `${(count / 17) * 100}%`);

  root.querySelectorAll("[data-review-page]").forEach((page) => {
    const index = Number(page.dataset.reviewPage);
    page.classList.toggle("is-selected", index < count);
  });

  const slotLabel = root.querySelector("[data-review-slots]");
  if (slotLabel) {
    slotLabel.textContent = `${count * 32} / 544 slots selected`;
  }

  const addressCards = root.querySelectorAll(".review-address > div");
  addressCards.forEach((card, index) => {
    card.classList.toggle("is-highlighted", (step < 4 && index === 0) || (step >= 4 && index === 1));
  });
}

function setGroupingState(root, step) {
  root.querySelectorAll("[data-group-layer]").forEach((layer) => {
    const role = layer.dataset.role;
    layer.classList.toggle("is-selected", (step >= 1 && role === "main") || (step >= 4 && role === "indexer"));
    layer.classList.toggle("is-excluded", step >= 3 && role === "scratch");
  });

  root.querySelectorAll("[data-group-spec]").forEach((spec) => {
    const role = spec.dataset.groupSpec;
    const visible =
      (role === "main" && step >= 1) ||
      (role === "scratch" && step >= 3) ||
      (role === "indexer" && step >= 4);
    spec.classList.toggle("is-visible", visible);
    spec.classList.toggle("is-highlighted", visible);
  });

  root.querySelectorAll("[data-group-info]").forEach((info) => {
    const role = info.dataset.groupInfo;
    const visible =
      (role === "main" && step >= 2) ||
      (role === "scratch" && step >= 3) ||
      (role === "indexer" && step >= 4);
    info.classList.toggle("is-visible", visible);
    info.classList.toggle("is-highlighted", visible);
  });
}

function setExpandState(root, step) {
  root.querySelectorAll("[data-engine-blocks]").forEach((block) => {
    const engine = Number(block.dataset.engineBlocks);
    block.classList.toggle(
      "is-highlighted",
      step === 0 || (step === 1 && engine === 0) || (step === 2 && engine === 1) || (step === 3 && engine === 0)
    );
  });

  root.querySelectorAll("[data-expand-info]").forEach((info) => {
    const index = Number(info.dataset.expandInfo);
    info.classList.toggle("is-highlighted", step > 0 && index === step - 1);
  });

  root.querySelectorAll("[data-expand-line]").forEach((line) => {
    const index = Number(line.dataset.expandLine);
    line.classList.toggle("is-active", step > 0 && index === step - 1);
  });
}

function setMambaState(root, step) {
  root.querySelectorAll("[data-mamba-part]").forEach((part) => {
    const from = Number(part.dataset.showFrom || 0);
    part.classList.toggle("is-visible", step >= from);
    part.classList.toggle("is-highlighted", Number(part.dataset.highlightStep || -1) === step);
  });

  root.querySelectorAll("[data-mamba-axis]").forEach((axis) => {
    const axisStep = Number(axis.dataset.mambaAxis);
    axis.classList.toggle("is-highlighted", step >= axisStep);
  });

  root.querySelectorAll("[data-mamba-window]").forEach((windowItem) => {
    const from = Number(windowItem.dataset.showFrom || 0);
    windowItem.classList.toggle("is-visible", step >= from);
    windowItem.classList.toggle("is-highlighted", step >= 4);
  });
}

function setStep(root, type, step) {
  const steps = COPY[type];
  const total = steps.length;
  const normalized = clampStep(step, total);
  root.dataset.step = String(normalized);

  const copy = root.querySelector("[data-anim-copy]");
  if (copy) {
    copy.textContent = steps[normalized];
  }

  const label = root.querySelector("[data-anim-step-label]");
  if (label) {
    label.textContent = `Step ${normalized + 1} / ${total}`;
  }

  root.querySelectorAll("[data-anim-dot]").forEach((dot) => {
    dot.classList.toggle("is-active", Number(dot.dataset.animDot) === normalized);
  });

  setGenericState(root, normalized);

  if (type === "review") {
    setReviewState(root, normalized);
  }
  if (type === "grouping") {
    setGroupingState(root, normalized);
  }
  if (type === "expand") {
    setExpandState(root, normalized);
  }
  if (type === "mamba") {
    setMambaState(root, normalized);
  }
}

function initAnimation(root) {
  const type = root.dataset.lmcacheAnimation;
  const steps = COPY[type];
  if (!steps) {
    return;
  }

  const total = steps.length;
  const dots = root.querySelector("[data-anim-dots]");
  if (dots && dots.children.length === 0) {
    steps.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "lmcache-anim__dot";
      dot.dataset.animDot = String(index);
      dot.setAttribute("aria-label", `跳到第 ${index + 1} 步`);
      dots.append(dot);
    });
  }

  let timer = null;
  let userPaused = false;

  const playButton = root.querySelector("[data-anim-play]");
  const current = () => Number(root.dataset.step || 0);
  const go = (step) => setStep(root, type, step);
  const stop = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    if (playButton) {
      playButton.textContent = "▶";
      playButton.setAttribute("aria-label", "播放");
    }
  };
  const start = () => {
    if (reducedMotion || timer) {
      return;
    }
    timer = window.setInterval(() => go(current() + 1), AUTOPLAY_MS);
    if (playButton) {
      playButton.textContent = "Ⅱ";
      playButton.setAttribute("aria-label", "暂停");
    }
  };

  root.querySelector("[data-anim-prev]")?.addEventListener("click", () => {
    userPaused = true;
    stop();
    go(current() - 1);
  });

  root.querySelector("[data-anim-next]")?.addEventListener("click", () => {
    userPaused = true;
    stop();
    go(current() + 1);
  });

  playButton?.addEventListener("click", () => {
    userPaused = Boolean(timer);
    if (timer) {
      stop();
    } else {
      userPaused = false;
      start();
    }
  });

  dots?.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-anim-dot]");
    if (!dot) {
      return;
    }
    userPaused = true;
    stop();
    go(Number(dot.dataset.animDot || 0));
  });

  go(Number(root.dataset.step || 0));

  if (!reducedMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !userPaused) {
            start();
          } else {
            stop();
          }
        });
      },
      { threshold: 0.4 }
    );
    observer.observe(root);
  }
}

const KNOWLEDGE_NODES = [
  {
    id: "kv-caches",
    phase: "vllm",
    title: "KV tensor",
    badge: "GPU memory",
    short: "vLLM worker 里真正装 K/V 或 state 的 torch.Tensor。",
    remember: "register_kv_caches 收到的不是抽象配置，而是一组已经分配好的 GPU tensor；后续传输最终都要读写这些 storage。",
    why: "server 和 worker 是不同进程。server 只有先注册这些 tensor 的 IPC handle、shape、dtype、stride，后面 STORE / RETRIEVE 才能只拿 block ids 工作。",
    fields: ["layer name", "dtype", "shape", "stride", "device"],
    relates: ["layout-hints", "ipc-wrapper", "engine-group-info"]
  },
  {
    id: "kv-cache-config",
    phase: "vllm",
    title: "KVCacheConfig",
    badge: "scheduler contract",
    short: "vLLM 调度器对 KV cache group、block size 和 layer 归属的描述。",
    remember: "它回答的是“block id 属于哪个 group、这个 group 里有哪些 layer、一个 block 覆盖多少 token”。",
    why: "真实 tensor 能说明 byte 怎么排，但不能说明 vLLM 后续发来的第 0 组 block ids 应该给哪些 layer 用。这个语义来自 KVCacheConfig。",
    fields: ["kv_cache_groups", "block_size", "page_size_bytes", "prefix_cacheable"],
    relates: ["block-id", "logical-physical", "engine-group-info"]
  },
  {
    id: "slot",
    phase: "vllm",
    title: "slot",
    badge: "token position",
    short: "一个 page 或 block 里能放一个 token KV 的位置。",
    remember: "block_size = 16 的普通 attention page 有 16 个 slots；每个 slot 里通常是一份 K 和一份 V。",
    why: "LMCache 外部缓存按 token range 命中，但 GPU transfer 最终按 slot 范围搬。注册阶段要把 token 数和 slot 数对齐。",
    fields: ["token index", "slot offset", "K plane", "V plane"],
    relates: ["page-size", "logical-physical", "mamba-state"]
  },
  {
    id: "page-size",
    phase: "vllm",
    title: "page size",
    badge: "bytes per page",
    short: "一个 page 占多少 bytes；它不总等于“多少 token”的直觉大小。",
    remember: "普通 attention 里 page size 常由 block_size * K/V * heads * head_size * dtype 得出；hybrid 模型还要让不同 group 的 page bytes 对齐。",
    why: "多进程传输和 block table 都需要稳定的 page 边界。page bytes 不一致时，vLLM 可能放大某个 group 的逻辑 block，让各 group 的 page 账本对齐。",
    fields: ["page_size_bytes", "tokens_per_block", "slots_per_block", "dtype bytes"],
    relates: ["logical-physical", "mamba-state", "zero-copy-view"]
  },
  {
    id: "logical-physical",
    phase: "vllm",
    title: "logical block / physical page",
    badge: "two address spaces",
    short: "logical block 是 vLLM 调度坐标；physical kernel page 是底层 tensor / kernel 的存储坐标。",
    remember: "block id 10 可能表示一个 544-token logical block，但底层 attention kernel 仍按 17 个 32-token physical pages 存。",
    why: "如果 LMCache 把 block id 直接解释成 raw tensor 第一维，就会搬错范围；re-view 就是在注册前把两个坐标系对齐。",
    fields: ["manager block", "kernel page", "block table", "page offset"],
    relates: ["block-id", "zero-copy-view", "page-size"]
  },
  {
    id: "block-id",
    phase: "vllm",
    title: "block id",
    badge: "runtime address",
    short: "vLLM 后续 STORE / RETRIEVE 请求携带的页编号。",
    remember: "block id 是 group-relative 的：第 0 个 engine group 的 block id 10 和第 1 个 engine group 的 block id 10 可以指向不同 KV pool。",
    why: "EngineGroupInfo 记录 engine_group_id，server 扩展 kernel group 时才能把同一个 EngineGroupInfo 映射回正确的 block id 列表。",
    fields: ["engine_group_id", "block_ids", "slot range", "cache key"],
    relates: ["engine-group-info", "kernel-group", "kv-cache-config"]
  },
  {
    id: "layout-hints",
    phase: "client",
    title: "layout hints",
    badge: "format clue",
    short: "告诉 LMCache tensor 里的维度顺序，比如 NHD/HND/BLNHC/BLHNC。",
    remember: "rank-4 fused K/V 的一些 layout 单靠 shape 推不出来，必须靠 vLLM config 或 backend hint 补一刀。",
    why: "注册阶段要把 raw tensor 变成一致的 transfer format。hint 错了，server 也许能 import handle，但会按错误 axis 搬数据。",
    fields: ["NHD", "HND", "BLNHC", "BLHNC"],
    relates: ["kv-caches", "zero-copy-view", "object-layout"]
  },
  {
    id: "zero-copy-view",
    phase: "client",
    title: "zero-copy re-view",
    badge: "shape only",
    short: "不复制数据，只改变 tensor 视图，让 LMCache 看到按 logical block 排好的 page。",
    remember: "sub-paged MLA 的 [N*17, 2, 32, H, C] 可以 view 成 [N, 2, 544, 1, C']；storage 还是同一段。",
    why: "LMCache transfer kernel 想按 block id 一页一页搬；注册前 view 好，后续请求就不用知道 kernel 内部 page 更小。",
    fields: ["view", "permute", "contiguous recovery", "shape desc"],
    relates: ["logical-physical", "layout-hints", "mamba-state"]
  },
  {
    id: "ipc-wrapper",
    phase: "client",
    title: "DeviceIPCWrapper",
    badge: "cross process handle",
    short: "worker 把 GPU tensor 暴露给 server 的可导入 handle。",
    remember: "REGISTER_KV_CACHE 消息里不会直接发送 torch.Tensor 本体，而是发送 handle + 元数据。",
    why: "这样 server 后续可以在自己的进程里拿到同一块 device memory 的 view，再用 transfer kernel 读写。",
    fields: ["handle", "device id", "shape", "stride", "dtype"],
    relates: ["kv-caches", "server-context", "engine-group-info"]
  },
  {
    id: "engine-group-info",
    phase: "client",
    title: "EngineGroupInfo",
    badge: "registration unit",
    short: "LMCache 注册协议里把 vLLM group 语义和真实 tensor layout 绑在一起的对象。",
    remember: "函数名是 create_engine_group_infos_from_vllm，复数很重要：一个 vLLM engine group 可能拆成多个 EngineGroupInfo。",
    why: "拆分原因包括 layout 不同、dtype 不同、slot 数不同、MLA indexer 独立、Mamba recurrent state、以及 prefix_cacheable=false 被排除。",
    fields: ["engine_group_id", "layer_indices", "tokens_per_block", "kv_format"],
    relates: ["kernel-group", "object-layout", "block-id"]
  },
  {
    id: "kernel-group",
    phase: "server",
    title: "kernel group",
    badge: "launch shape",
    short: "server 侧真正可以共用同一个 transfer kernel 的 tensor 组。",
    remember: "vLLM 的 group 是调度语义；LMCache kernel group 是传输执行语义。两者经常相关，但不能混为一个概念。",
    why: "同一个 kernel 需要一致的 dtype、layout、page shape 和窗口语义；不一致就要拆组，否则 copy kernel 参数会错。",
    fields: ["PageBufferShapeDesc", "dtype", "layout", "window"],
    relates: ["engine-group-info", "object-layout", "server-context"]
  },
  {
    id: "object-layout",
    phase: "server",
    title: "object layout",
    badge: "storage contract",
    short: "LMCache 外部对象如何对应 GPU page 的描述。",
    remember: "一个 object group 可能对应普通 attention page、MLA page、indexer bytes 或 Mamba state page。",
    why: "STORE / RETRIEVE 不是只搬一块连续 bytes，还要知道外部缓存里的 token window、chunk 和 GPU page 如何互相映射。",
    fields: ["ObjectLayoutDesc", "AttnWindowDesc", "chunk size", "tokens"],
    relates: ["kernel-group", "page-size", "server-context"]
  },
  {
    id: "mamba-state",
    phase: "server",
    title: "Mamba state",
    badge: "recurrent snapshot",
    short: "不是每个 token 一份 K/V，而是一份可继续 decode 的 recurrent 状态快照。",
    remember: "Mamba page 往往由 conv_state、ssm_state 和 padding 拼成固定 page，再包装成类似 KV page 的 transfer shape。",
    why: "hybrid 模型里 attention 和 Mamba 要共用调度/传输框架；register 必须把 state page 标成 recurrent_state，恢复语义才不会被当成普通 token K/V。",
    fields: ["conv state", "ssm state", "padding", "recurrent_state"],
    relates: ["page-size", "zero-copy-view", "scratch-group"]
  },
  {
    id: "scratch-group",
    phase: "server",
    title: "scratch group",
    badge: "not prefix cacheable",
    short: "运行时辅助或临时状态，不应该进入 prefix KV cache 复用。",
    remember: "这个概念最好统一成“prefix_cacheable=false 的 group”，少引入 scratch / exclude / non-cacheable 多套术语。",
    why: "如果把临时 ring buffer 或 connector 私有池注册进 prefix cache，命中恢复可能污染模型真实语义。",
    fields: ["prefix_cacheable=false", "excluded group", "aux pool"],
    relates: ["kv-cache-config", "engine-group-info", "mamba-state"]
  },
  {
    id: "server-context",
    phase: "server",
    title: "GPUCacheContext",
    badge: "registered runtime",
    short: "server 完成注册后保留下来的运行时上下文。",
    remember: "它把 imported tensors、format discovery、group manager、layout registry 和 context table 连成后续请求可复用的状态。",
    why: "后续 STORE / RETRIEVE 只带轻量参数，是因为这些重量级信息已经在 register 阶段进入 server context。",
    fields: ["registered tensors", "KVLayerGroupsManager", "layout registry", "context id"],
    relates: ["ipc-wrapper", "kernel-group", "object-layout"]
  }
];

const KNOWLEDGE_PHASES = [
  { id: "vllm", title: "vLLM 给出的事实", note: "调度语义、block 坐标、真实 tensor。" },
  { id: "client", title: "worker 侧翻译", note: "把名字、layout、view 和 IPC handle 变成协议。" },
  { id: "server", title: "server 侧注册", note: "把协议变成可 launch 的 group 和可恢复的 object layout。" }
];

const KNOWLEDGE_TOUR = [
  "kv-caches",
  "kv-cache-config",
  "logical-physical",
  "layout-hints",
  "zero-copy-view",
  "engine-group-info",
  "kernel-group",
  "server-context"
];

const KNOWLEDGE_EXTRA = {
  "kv-caches": {
    deep: [
      "vLLM 调用 register_kv_caches 时，KV cache 已经不是“将来会分配”的东西，而是 worker 进程里真实存在的 GPU tensor。",
      "LMCache register 的第一层含义，是把这些 worker-owned tensor 变成 server-importable memory：后续 server 不需要重新向 vLLM 要 tensor，只需要通过 instance_id 找到已注册上下文。",
      "这个 tensor 的 shape/stride 也不是装饰信息。LMCache 后面判断 NHD/HND/BLNHC/BLHNC、rank-3 MLA、Mamba packed state，都要从这些实际 tensor 上读证据。"
    ],
    anchors: [
      ["vLLM 传入什么", "#二vllm-调用完以后传给-lmcache-的是什么"],
      ["谁真正搬数据", "#三lmcache-driven-模式到底是谁搬数据"]
    ]
  },
  "kv-cache-config": {
    deep: [
      "KVCacheConfig 是 vLLM 调度侧的账本。它不告诉你 bytes 在显存里怎么排，但告诉你 block id 的语义边界在哪里。",
      "最关键的是 kv_cache_groups：同一个 group 里的 layer 使用同一套 block-id address space。不同 group 即使 block id 数字相同，也不能混用。",
      "PR #5042 的 prefix_cacheable=false 就来自这层语义：某些 group 是临时 ring 或 aux buffer，不应该进入 prefix cache 注册。"
    ],
    anchors: [
      ["group edits", "#四客户端第一步注册前为什么要先做-kv-cache-group-edits"],
      ["EngineGroupInfo 生成", "#五客户端第二步create_engine_group_infos_from_vllm-是整条链路的翻译器"]
    ]
  },
  slot: {
    deep: [
      "slot 是 page 里的位置单位。普通 attention 里，一个 slot 大致对应一个 token 的 K/V 行。",
      "tokens_per_block 和 slots_per_block 之所以要分开，是因为 MLA/indexer/Mamba 可能不是“一 token 一 slot”。",
      "LMCache 外部缓存按 token prefix 命中，但 GPU copy 按 page/slot 搬，所以 register 必须先把 token 语义和 slot 语义接上。"
    ],
    anchors: [
      ["page size / block 概念", "#先补三个词page-sizelogical-blockphysical-block"],
      ["服务端 tokens/slots", "#九服务端-kvlayergroupsmanager-如何消费-enginegroupinfo"]
    ]
  },
  "page-size": {
    deep: [
      "page size 在这里主要指 page_size_bytes，也就是“一个 page 在显存里占多少 bytes”。它不是 token 数。",
      "普通 attention 的 page bytes 通常跟 block_size 成正比；Mamba state page 的 bytes 更多由 conv/SSM state shape 决定。",
      "hybrid 模型要把多种 group 放进一套容量估算和 block table 账本，因此可能让 attention 的 manager block 变大，使 attention logical page 的 bytes 接近 Mamba state page。"
    ],
    anchors: [
      ["page size 解释", "#先补三个词page-sizelogical-blockphysical-block"],
      ["Mamba state", "#3-mamba-state-page"]
    ]
  },
  "logical-physical": {
    deep: [
      "logical block 是 scheduler / block table / prefix cache 看到的地址单位；physical kernel page 是 attention backend 真实读写 tensor 的单位。",
      "这两者在普通 attention 里经常刚好一样，所以容易被混成一个概念。但在 sub-paged MLA/Mamba-hybrid 里，它们会分开。",
      "register 前的 re-view 不是改变数学语义，而是给 LMCache 建立一个“logical block id 到 physical byte range”的可执行视图。"
    ],
    anchors: [
      ["logical/physical 详解", "#先补三个词page-sizelogical-blockphysical-block"],
      ["sub-paged attention", "#1-sub-paged-attention"]
    ]
  },
  "layout-hints": {
    deep: [
      "layout hints 是 vLLM 给 LMCache 的方向线索：同样一组维度，哪个是 block、哪个是 token slot、哪个是 head，不能永远靠 shape 猜。",
      "rank-4 fused view 尤其容易有歧义。比如 BLNHC / BLHNC 都是 blocks-first，但 token/head 的内层顺序不同。",
      "hint 不是替代 format discovery，而是让 discovery 在 shape 不足以区分时不要走错分支。"
    ],
    anchors: [
      ["Mamba unified view", "#8-pr-5042-的-mamba-unified-view-和-blnhc--blhnc"],
      ["contiguity tie-break", "#9-pr-5042-的-contiguity-recovery-tie-break"]
    ]
  },
  "zero-copy-view": {
    deep: [
      "zero-copy re-view 只改 tensor metadata，不搬 storage。它要求元素数量、storage offset、stride 关系能支持这个新视图。",
      "对 sub-paged attention 来说，关键是把 N*17 个 32-token kernel pages 标成 N 个 544-token logical pages。",
      "对 Mamba 来说，关键是把 conv/SSM/padding 这类状态 bytes 包装成 transfer kernel 能处理的 opaque page。"
    ],
    anchors: [
      ["sub-paged attention", "#1-sub-paged-attention"],
      ["Mamba state page", "#3-mamba-state-page"]
    ]
  },
  "engine-group-info": {
    deep: [
      "EngineGroupInfo 是跨进程协议里的核心注册单元。它保留 vLLM block-id group 语义，同时携带 LMCache transfer 需要的 layer_indices、tokens_per_block、window/recurrent 信息。",
      "它返回 list，不只是因为一个 vLLM group 会拆成多个 kernel group；多个 vLLM groups、indexer/main cache 分离、CacheBlend aux pool、dtype/layout/slots 不同，也都会改变条目数量。",
      "server 后面尽量只消费这些协议字段和 tensor index，而不是再理解 vLLM 的 layer name。"
    ],
    anchors: [
      ["函数详解", "#五客户端第二步create_engine_group_infos_from_vllm-是整条链路的翻译器"],
      ["服务端消费", "#九服务端-kvlayergroupsmanager-如何消费-enginegroupinfo"]
    ]
  },
  "mamba-state": {
    deep: [
      "Mamba state 不是历史 token 的 K/V 表，而是模型继续 decode 所需的 recurrent snapshot。",
      "所以一个 block id 对 Mamba 来说更像“某个状态页编号”，而不是“一段 token K/V 行”。",
      "register 必须把 recurrent_state 写进 EngineGroupInfo，否则服务端会用普通 attention 的 token-window 语义解释它。"
    ],
    anchors: [
      ["Mamba state page", "#3-mamba-state-page"],
      ["Mamba unified view", "#8-pr-5042-的-mamba-unified-view-和-blnhc--blhnc"]
    ]
  },
  "scratch-group": {
    deep: [
      "这里更准确的词是 non-prefix-cacheable KV cache group。scratch ring 只是其中一个例子。",
      "prefix_cacheable=false 表示这个 group 不代表可跨请求复用的 prefix KV。LMCache 应该在 format discovery、EngineGroupInfo 和 block id slicing 中都把它排除。",
      "这样可以避免两个问题：临时 ring 的特殊 layout 让注册失败，以及它过小的 capacity 把整个 prefix chunk 账本拉乱。"
    ],
    anchors: [
      ["Qwen/GLM scratch group", "#6-pr-5042-的-qwen38b--glm-scratch-group"],
      ["format discovery skip", "#2-找出需要-format-discovery-的-layer-group"]
    ]
  },
  "server-context": {
    deep: [
      "GPUCacheContext 是 server 侧注册完成后的 runtime 容器。它持有 imported tensors、原始 IPC wrapper、block id buffer、data pointer tensor、temp buffer 和 CUDA stream。",
      "后续 STORE/RETRIEVE 通过 instance_id 找到这个 context，然后按已注册的 kernel/object group 解释 block ids。",
      "register 做得越完整，后续请求就越轻：它们不需要重复传 shape、stride、layer name、layout 和分组规则。"
    ],
    anchors: [
      ["服务端注册", "#八服务端收到-register_kv_cache-后做什么"],
      ["layout descriptor", "#十服务端还要注册-layout-descriptor"]
    ]
  }
};

const SCENARIO_STAGES = [
  { id: "input", label: "vLLM 输入", verb: "拿到" },
  { id: "edit", label: "注册前编辑", verb: "改成" },
  { id: "infos", label: "EngineGroupInfo", verb: "描述" },
  { id: "payload", label: "IPC payload", verb: "发送" },
  { id: "server", label: "server 注册", verb: "落表" },
  { id: "later", label: "后续请求", verb: "复用" }
];

const SCENARIOS = {
  simple: {
    label: "简单 Attention",
    title: "标准一组 attention KV cache",
    summary: "一个 vLLM block 就是一个 tensor page；register 主要做 layer name 到 index、IPC handle、format metadata 的绑定。",
    accent: "simple",
    stages: {
      input: {
        title: "vLLM 调用 connector.register_kv_caches",
        copy: "worker 已经持有每层 KV tensor，KVCacheConfig 说明 group 0 里有哪些 layer，以及 block_size=16。",
        cards: [
          ["kv_caches", "layer.0 -> [NB, 2, 16, NH, HS]\nlayer.1 -> [NB, 2, 16, NH, HS]"],
          ["kv_cache_groups[0]", "layers=[layer.0, layer.1]\nblock_size=16\nprefix_cacheable=true"],
          ["layout_hints", "NHD 或 HND：告诉 LMCache token/head/head_size 的顺序"]
        ],
        fields: [
          ["NB", "num blocks，tensor 第一维就是 vLLM page/block 数。"],
          ["2", "普通 attention 里通常是 K plane 和 V plane。"],
          ["16", "一个 block 有 16 个 token slots。"]
        ]
      },
      edit: {
        title: "apply_kv_cache_group_edits 基本不用改",
        copy: "普通 attention 已经是“一 block 一 page”的形态，不需要把多个 kernel pages 合并，也不需要把 state 打包。",
        cards: [
          ["before", "[NB, 2, 16, NH, HS]"],
          ["after", "[NB, 2, 16, NH, HS]"],
          ["why", "只保留 layout hint，后面 format discovery 可以稳定识别。"]
        ],
        fields: [
          ["no copy", "没有分配新 tensor，也没有搬数据。"],
          ["view unchanged", "注册前后 shape 相同，只是进入统一处理链路。"]
        ]
      },
      infos: {
        title: "生成一个 EngineGroupInfo",
        copy: "layer names 被翻译成 registered tensor list 里的 indices；group 0 的 block ids 后续就能应用到这些 layer。",
        cards: [
          ["EngineGroupInfo[0]", "engine_group_id=0\nlayer_indices=(0, 1)\ntokens_per_block=16\nslots_per_block=16"],
          ["transfer identity", "dtype=bf16\nformat=NHD/HND\npage shape 一致"],
          ["result", "一个 vLLM engine group 对应一个 LMCache kernel group。"]
        ],
        fields: [
          ["engine_group_id", "后续 block id 列表的来源坐标。"],
          ["layer_indices", "server 不再解析 layer name，只按注册顺序取 tensor。"],
          ["tokens_per_block", "外部 cache key 的 token window 与 GPU page 对齐。"]
        ]
      },
      payload: {
        title: "REGISTER_KV_CACHE payload",
        copy: "跨进程消息携带 IPC wrappers、layout hints、model/world 信息和 EngineGroupInfo，而不是 torch.Tensor 本体。",
        cards: [
          ["DeviceIPCWrapper[]", "2 个 tensor handle + shape/stride/dtype"],
          ["metadata", "model name, tp/dcp/world, kv role"],
          ["engine_group_infos", "只有 1 项：simple attention group"]
        ],
        fields: [
          ["IPC handle", "server import 之后看到同一块 GPU memory。"],
          ["layout_hints", "server 侧 format discovery 的补充证据。"]
        ]
      },
      server: {
        title: "server import handles 并建立 runtime context",
        copy: "LMCache server unwrap IPC handle，检测 tensor format，然后创建 KVLayerGroupsManager 和 layout registry。",
        cards: [
          ["registered tensors", "idx 0 -> layer.0\nidx 1 -> layer.1"],
          ["kernel group", "group 0: same dtype/layout/page shape"],
          ["object layout", "16 token slots -> one cache object chunk"]
        ],
        fields: [
          ["KVLayerGroupsManager", "记录哪些 layer 可以一起 launch transfer kernel。"],
          ["layout registry", "记录外部对象和 GPU page 的映射方式。"]
        ]
      },
      later: {
        title: "后续 STORE / RETRIEVE 只发轻量信息",
        copy: "请求带 group 0 的 block ids=[10,11] 和 token span；server 查注册上下文就知道读写哪些 tensor page。",
        cards: [
          ["request", "engine_group_blocks[0] = [10, 11]\ntokens = 0..31"],
          ["server expands", "EngineGroupInfo[0] -> block ids [10, 11]"],
          ["copy", "layer.0/layer.1 的 page 10、11 被 store/retrieve"]
        ],
        fields: [
          ["block ids", "不携带 shape，因为 shape 已在 register 阶段定下。"],
          ["token span", "用于外部 cache key 和对象切片。"]
        ]
      }
    }
  },
  mla: {
    label: "MLA / indexer",
    title: "MLA 主 cache 和 indexer 共用 block 坐标但物理形态不同",
    summary: "GLM/Kimi/DeepSeek 这类 MLA cache 可能有主 KV cache、indexer cache、sub-paged kernel storage。它们语义上跟同一个 engine group 相关，却必须拆成不同注册单元。",
    accent: "mla",
    stages: {
      input: {
        title: "vLLM 暴露的是 kernel 友好的物理 page",
        copy: "主 MLA cache 可能第一维是 32-token kernel page；indexer 也有自己的更小 page 和 dtype。",
        cards: [
          ["main MLA tensor", "[N * 18, 64, 576] 或 rank-4 变体"],
          ["indexer tensor", "[N * 9, 32, 132]，经常是更紧凑的 metadata"],
          ["engine group", "engine_group_id=0，block id 坐标仍来自同一组调度语义"]
        ],
        fields: [
          ["sub-paged", "一个 logical block 被拆成多个 kernel pages 保存。"],
          ["indexer", "给 MLA lookup/attention kernel 用的辅助 cache，不等于主 KV。"],
          ["rank-3/rank-4", "rank 是 tensor 维度个数：3 维如 [pages, slots, width]，4 维如 [pages, 2, slots, width]。"]
        ]
      },
      edit: {
        title: "把多个 kernel pages re-view 成 logical block",
        copy: "注册前把 kernel page 维度折回 logical block 维度，确保 block id 0 命中的是完整 logical block。",
        cards: [
          ["main re-view", "[N * 18, 64, 576]\n-> [N, 1152, 576]"],
          ["rank-4 variant", "[N * k, 2, 32, H, C]\n-> [N, 2, k*32, 1, H*C]"],
          ["indexer re-view", "[N * 9, 32, 132]\n-> [N, 288, 132]"]
        ],
        fields: [
          ["N * k -> N", "k 个连续 physical pages 合并成 1 个 logical block。"],
          ["32 -> k*32", "每个 kernel page 的 token slots 串起来，变成 logical block 的 slots。"],
          ["H*C -> C'", "head 维有时折进 trailing width，保留元素总数不变。"]
        ]
      },
      infos: {
        title: "同一个 engine group 可以生成多项 EngineGroupInfo",
        copy: "主 cache 和 indexer 共享 engine_group_id=0，但 dtype、slots_per_block、object layout 不同，所以要拆开注册。",
        cards: [
          ["EngineGroupInfo[0]", "main MLA\nengine_group_id=0\nslots_per_block=1152"],
          ["EngineGroupInfo[1]", "MLA indexer\nengine_group_id=0\nslots_per_block=288"],
          ["why list", "不是只因 vLLM group 拆 kernel group；同一 block 坐标下的多种 object/layout 也会产生多项。"]
        ],
        fields: [
          ["same engine_group_id", "后续复用同一组 block ids。"],
          ["different slots", "同一个 logical token block 在不同物理对象里占用的 slot 数不同。"],
          ["different dtype/layout", "不能放进同一个 transfer kernel group。"]
        ]
      },
      payload: {
        title: "payload 同时带主 cache 和 indexer 的注册描述",
        copy: "server 收到的是多项 EngineGroupInfo，每项都指向 registered tensor list 的不同 index 子集。",
        cards: [
          ["DeviceIPCWrapper[]", "main handles + indexer handles"],
          ["EngineGroupInfo list", "[main MLA info, indexer info]"],
          ["address reuse", "两项都从 engine_group_blocks[0] 取 block ids"]
        ],
        fields: [
          ["layer_indices", "主 cache 和 indexer 指向不同 tensor index。"],
          ["shape desc", "告诉 server 每个对象怎样切 page。"]
        ]
      },
      server: {
        title: "server 建两套可执行 layout",
        copy: "KVLayerGroupsManager 会按 transfer identity 拆 kernel group；layout registry 则记录 main MLA object 和 indexer object 的不同窗口。",
        cards: [
          ["kernel group A", "main MLA: large slot page"],
          ["kernel group B", "indexer: compact metadata page"],
          ["object groups", "同一个 token prefix 对应两个需要一致 store/retrieve 的对象"]
        ],
        fields: [
          ["KernelGroupInfo", "同一种 kernel launch 参数的一组 tensors。"],
          ["ObjectLayoutDesc", "外部 cache 里对象 chunk 到 GPU page 的映射。"]
        ]
      },
      later: {
        title: "后续请求一次 block ids，展开成多条 copy 计划",
        copy: "engine_group_blocks[0]=[10] 会同时驱动 main MLA page 10 和 indexer page 10 的传输，只是二者 page shape 不同。",
        cards: [
          ["request", "group 0 block ids = [10]"],
          ["main path", "EngineGroupInfo[0] -> main MLA object"],
          ["indexer path", "EngineGroupInfo[1] -> indexer object"]
        ],
        fields: [
          ["one address, many objects", "调度坐标相同，但要恢复的物理对象不止一个。"],
          ["consistency", "主 cache 和 indexer 必须同命中、同恢复。"]
        ]
      }
    }
  },
  hybrid: {
    label: "Mamba hybrid",
    title: "attention、Mamba state 和不可缓存 group 混在一个模型里",
    summary: "Mamba-hybrid 里有普通 attention page，也有 recurrent state page。为了让不同 KV group 的 page bytes 对齐，attention 的逻辑 block 可能被放大。",
    accent: "hybrid",
    stages: {
      input: {
        title: "vLLM 输入同时包含 attention cache 和 Mamba state",
        copy: "attention kernel 仍可能按 32-token page 存；Mamba 则保存 conv/SSM state snapshot；另有 prefix_cacheable=false 的临时 group。",
        cards: [
          ["attention raw", "[N * 17, 2, 32, H, C]"],
          ["Mamba state", "conv_state + ssm_state -> recurrent snapshot"],
          ["scratch group", "prefix_cacheable=false，不进入 prefix cache"]
        ],
        fields: [
          ["17", "为了让 attention page bytes 接近/对齐 Mamba state page，manager block 被放大到 17 个 kernel pages。"],
          ["32", "底层 attention kernel 实际操作的 token page 大小。"],
          ["recurrent", "Mamba 恢复的是状态快照，不是逐 token K/V。"]
        ]
      },
      edit: {
        title: "注册前把三类对象分流",
        copy: "attention 做 sub-paged re-view；Mamba state 打包成固定 page；scratch group 被排除。",
        cards: [
          ["attention re-view", "[N * 17, 2, 32, H, C]\n-> [N, 2, 544, 1, H*C]"],
          ["Mamba packing", "[conv, ssm]\n-> [N, 2, block, 1, head_size]"],
          ["exclude", "prefix_cacheable=false -> no EngineGroupInfo"]
        ],
        fields: [
          ["544", "17 * 32，logical block 的 token slots。"],
          ["synthetic axes", "Mamba 的 2 和 1 是传输轴，不是真实 K/V 和 attention head。"],
          ["exclude", "排除的是 prefix cache 传输注册，不是 vLLM runtime 删除这个 buffer。"]
        ]
      },
      infos: {
        title: "生成 attention 和 recurrent state 两类 EngineGroupInfo",
        copy: "attention 与 Mamba state 可能来自不同 engine group；scratch 不生成 info。server 后续要按各自语义处理。",
        cards: [
          ["EngineGroupInfo[0]", "attention\nengine_group_id=0\ntokens_per_block=544"],
          ["EngineGroupInfo[1]", "Mamba\nengine_group_id=1\nrecurrent_state=true"],
          ["excluded", "scratch / aux pool\nprefix_cacheable=false"]
        ],
        fields: [
          ["tokens_per_block=544", "外部 prefix 命中按放大后的 logical block 计。"],
          ["recurrent_state=true", "告诉 server 恢复语义是状态快照。"],
          ["engine_group_id=1", "Mamba state 用自己的 block id 列表。"]
        ]
      },
      payload: {
        title: "payload 携带不同 transfer 身份",
        copy: "REGISTER_KV_CACHE 里会同时出现 attention tensor handle、Mamba state page handle、以及各自的 EngineGroupInfo。",
        cards: [
          ["DeviceIPCWrapper[]", "attention handles + recurrent state handles"],
          ["layout hints", "attention: BLNHC/BLHNC 可接受\nMamba: packed page shape"],
          ["EngineGroupInfo list", "attention info + recurrent info"]
        ],
        fields: [
          ["BLNHC/BLHNC", "block-first layout hint，兼容 Mamba-hybrid 中 vLLM 暴露的 view。"],
          ["packed page", "server 看到统一 shape，不需要理解 conv/SSM 原始结构。"]
        ]
      },
      server: {
        title: "server 把普通 page 和 recurrent page 分开注册",
        copy: "attention 进入普通 token-window object layout；Mamba 进入 recurrent state object layout；scratch 没有 prefix cache 对象。",
        cards: [
          ["attention kernel group", "page shape: 544 token slots"],
          ["Mamba kernel group", "state snapshot page\nrecurrent_state=true"],
          ["context table", "同一模型里保存两种恢复语义"]
        ],
        fields: [
          ["AttnWindowDesc", "普通 attention 用 token window 描述。"],
          ["state snapshot", "Mamba 命中多个 block 时，真正有价值的是最后可继续 decode 的状态。"]
        ]
      },
      later: {
        title: "后续请求按不同 group block ids 展开",
        copy: "attention 的 group 0 block ids=[10] 表示 544 slots；Mamba 的 group 1 block ids=[7] 表示一个 state snapshot page。",
        cards: [
          ["request", "group0 attention=[10]\ngroup1 mamba=[7]"],
          ["attention copy", "logical block 10 -> 17 个 kernel pages 的 view"],
          ["Mamba copy", "state page 7 -> recurrent snapshot restore"]
        ],
        fields: [
          ["different meaning", "两个 block id 都叫 block id，但恢复语义完全不同。"],
          ["registered context", "差异已经在 register 阶段记录，所以请求可以保持轻量。"]
        ]
      }
    }
  }
};

const SCENARIO_NOTES = {
  simple: {
    input: {
      notes: [
        "这个场景最像大家直觉里的 KV cache：每个 layer 有一块形状规则的 attention KV tensor，第一维就是 vLLM 分配出来的 block/page 数。",
        "KVCacheConfig 在这里主要提供 group 语义：group 0 包含哪些 layer、block_size 是多少、这个 group 是否 prefix_cacheable。",
        "layout_hints 是为了让 LMCache 后面把 tensor 维度解释成正确的 axis；即使 simple 场景通常能从 shape 猜出来，register 仍然把 hint 作为协议输入。"
      ],
      anchors: [["vLLM 传入内容", "#二vllm-调用完以后传给-lmcache-的是什么"]]
    },
    edit: {
      notes: [
        "普通 attention 不需要做 sub-paged 合并，因为 logical block 和 physical page 天然一一对应。",
        "这里仍然经过 apply_kv_cache_group_edits，是为了让所有模型都走同一条预处理路径：simple 场景相当于“检查后不改”。",
        "这个不改本身很重要：它说明 register 不是为了强行改 tensor，而是只在 vLLM 调度坐标和物理存储坐标不一致时才插入 zero-copy view。"
      ],
      anchors: [["group edits 背景", "#四客户端第一步注册前为什么要先做-kv-cache-group-edits"]]
    },
    infos: {
      notes: [
        "create_engine_group_infos_from_vllm 会把 layer name 变成 layer_indices。这样 server 不需要懂 vLLM layer name 字符串，只需要按 registered tensor list 的 index 工作。",
        "tokens_per_block=16 来自 vLLM spec.block_size；slots_per_block=16 来自真实 tensor shape。这两个数字相等时，说明没有 slot compression。",
        "如果所有 layer 的 dtype/layout/head_size 都一样，group_layers_by_identity 只会产生一个 transfer identity，于是这里只有一个 EngineGroupInfo。"
      ],
      anchors: [["函数详解", "#五客户端第二步create_engine_group_infos_from_vllm-是整条链路的翻译器"]]
    },
    payload: {
      notes: [
        "REGISTER_KV_CACHE 发送的不是 tensor 数据，也不是 Python torch.Tensor 对象，而是 DeviceIPCWrapper 和 EngineGroupInfo。",
        "DeviceIPCWrapper 负责跨进程重新打开同一块 GPU memory；EngineGroupInfo 负责告诉 server 这些 memory 应该如何按 vLLM block id 分组。",
        "这一步把重信息一次性发过去，后续 STORE/RETRIEVE 才能只传 token span、cache key 和 block ids。"
      ],
      anchors: [["LMCache driven 模式", "#三lmcache-driven-模式到底是谁搬数据"]]
    },
    server: {
      notes: [
        "server 会 import IPC handle，得到自己进程可见的 tensor view，但底层仍指向 worker 的 GPU memory。",
        "server 还会再做一次 format discovery。这不是重复劳动，而是保证 server 看到的 imported view 和客户端假设一致。",
        "最后它建立 KVLayerGroupsManager、layout registry、data pointer tensor 和 staging buffer。后续真正 copy 时，这些都直接参与 kernel launch。"
      ],
      anchors: [["服务端注册", "#八服务端收到-register_kv_cache-后做什么"]]
    },
    later: {
      notes: [
        "后续请求带来的 block ids 是 engine group 坐标。simple 场景里这个坐标刚好和唯一 kernel group 对齐，所以看起来很简单。",
        "server 根据 instance_id 找到注册好的 GPUCacheContext，再把 block ids 应用到 group 0 的 layer tensors。",
        "这里没有再传 shape/stride/layout，是因为 register 阶段已经把这些重信息固化到 context 里了。"
      ],
      anchors: [["后续请求如何复用", "#十一注册之后-store--retrieve-如何使用这份信息"]]
    }
  },
  mla: {
    input: {
      notes: [
        "MLA 的关键不是“有 K/V 两个 plane”，而是用 latent/cache state 支撑 attention。它的 tensor 可能是 rank-3，也可能出现 rank-4 的 single-head style view。",
        "sub-paged 表示底层 kernel 为了计算效率使用更小的 page。vLLM 调度层仍可能把多个 kernel pages 视为一个 larger logical block。",
        "indexer 是另一类辅助 cache。它跟主 MLA cache 共享 block-id 语义，但 dtype、slot 数和对象布局可能不同。"
      ],
      anchors: [["Sub-paged MLA", "#2-sub-paged-mla"], ["带 indexer 的 MLA", "#4-带-indexer-的-mla"]]
    },
    edit: {
      notes: [
        "re-view 的目标是把 raw tensor 第一维从 kernel-page 坐标改成 logical-block 坐标。比如 N*18 变 N，表示 18 个物理页合成一个逻辑页。",
        "这个动作不复制 bytes。它只是让 LMCache 后面按 block id 寻址时，一次看到完整 logical block 的 payload。",
        "rank-4 变体里 H 可能变成 1，C 变成 H*C，本质是把 head 维折叠成 opaque payload width，保证一页元素总数守恒。"
      ],
      anchors: [["Sub-paged attention 逐维解释", "#1-sub-paged-attention"], ["PR rank-3/rank-4", "#7-pr-5042-的-sub-paged-mla-rank-3--rank-4"]]
    },
    infos: {
      notes: [
        "同一个 engine_group_id 可以出现两次：主 MLA cache 一条 EngineGroupInfo，indexer cache 又一条 EngineGroupInfo。",
        "这不是协议重复，而是因为它们需要不同 copy kernel / object layout；server 后续会用同一份 engine group block ids 驱动两条传输路径。",
        "这也解释了为什么函数名是 infos 复数：返回 list 的原因包括多 vLLM group、多 transfer identity、多 object kind、aux pool，以及 exclusion。"
      ],
      anchors: [["EngineGroupInfo 为什么是 list", "#五客户端第二步create_engine_group_infos_from_vllm-是整条链路的翻译器"]]
    },
    payload: {
      notes: [
        "payload 里会有多组 IPC handle 和多项 EngineGroupInfo。每项 info 通过 layer_indices 指向 registered tensor list 的不同子集。",
        "主 MLA 和 indexer 共享同一个 engine_group_id，意味着后续从同一个 vLLM block-id list 取地址。",
        "但它们的 slots_per_block 可能不同，所以 server 必须分别建立 shape descriptor，不能把两者合并成一个 kernel group。"
      ],
      anchors: [["服务端消费 EngineGroupInfo", "#九服务端-kvlayergroupsmanager-如何消费-enginegroupinfo"]]
    },
    server: {
      notes: [
        "server import 后会对主 cache 和 indexer 各自做 format discovery。rank-3、rank-4、rank-5 进入不同 EngineKVFormat 分支。",
        "KVLayerGroupsManager 会按 transfer identity 拆分。identity 中的 dtype、head_size、slots_per_block、engine_kv_format 任一不同，都不能共用同一个 kernel group。",
        "layout registry 还要让外部缓存知道同一个 prefix 需要存/取多种对象；只恢复主 cache 不恢复 indexer，会破坏真实模型运行。"
      ],
      anchors: [["server group manager", "#九服务端-kvlayergroupsmanager-如何消费-enginegroupinfo"]]
    },
    later: {
      notes: [
        "STORE/RETRIEVE 收到 group 0 block ids=[10] 后，server 会把这份 block ids 展开给 main MLA info 和 indexer info。",
        "展开后的 copy 计划有相同 logical address，但不同 page shape、dtype 和 object layout。",
        "这就是 register 阶段要精确建模的原因：后续请求越轻量，注册时的语义越不能模糊。"
      ],
      anchors: [["block ids 展开", "#十一注册之后-store--retrieve-如何使用这份信息"]]
    }
  },
  hybrid: {
    input: {
      notes: [
        "Mamba-hybrid 模型里至少有两种缓存语义：attention 是逐 token 的 K/V page，Mamba 是 recurrent state snapshot。",
        "vLLM 为了让不同 group 进入同一套 page/block 账本，可能要求 page_size_bytes 对齐；attention 这边就可能把 manager block 放大。",
        "同时，Qwen/GLM 这类模型还可能有 prefix_cacheable=false 的临时 group。它在 vLLM runtime 中存在，但不应进入 LMCache prefix cache。"
      ],
      anchors: [["page size 对齐", "#先补三个词page-sizelogical-blockphysical-block"], ["Qwen/GLM scratch", "#6-pr-5042-的-qwen38b--glm-scratch-group"]]
    },
    edit: {
      notes: [
        "attention raw tensor 仍按 32-token kernel pages 存，但 register 前会把 17 个 physical pages view 成一个 544-token logical block。",
        "Mamba 的 conv_state/ssm_state 会被包装成固定大小的 opaque page，再映射到 LMCache transfer kernel 能接受的 shape。",
        "prefix_cacheable=false 的 group 则不做 format discovery、不生成 EngineGroupInfo，也不会参与后续 prefix store/retrieve。"
      ],
      anchors: [["logical vs physical", "#先补三个词page-sizelogical-blockphysical-block"], ["Mamba state page", "#3-mamba-state-page"]]
    },
    infos: {
      notes: [
        "attention EngineGroupInfo 记录 tokens_per_block=544，表示 vLLM block id 在这个 group 中覆盖 544 个 token slots。",
        "Mamba EngineGroupInfo 记录 recurrent_state=true，表示恢复语义是 state snapshot，不是普通 attention token window。",
        "scratch/aux 临时 group 没有 EngineGroupInfo。这里排除的是 group 的 prefix-cacheable 语义，不是删除某个 layer。"
      ],
      anchors: [["recurrent-state 字段", "#5-解析-sliding-window-和-recurrent-state-信息"]]
    },
    payload: {
      notes: [
        "payload 需要同时描述 attention tensor handle、Mamba packed state handle，以及各自的 group metadata。",
        "BLNHC/BLHNC 这类 block-first layout hint 在 Mamba unified view 中很关键，因为 server 要知道内层哪个维度应被当作 token/state axis。",
        "这个阶段的目标是让 server 不理解 vLLM 私有对象也能重建 transfer view。"
      ],
      anchors: [["Mamba unified view", "#8-pr-5042-的-mamba-unified-view-和-blnhc--blhnc"]]
    },
    server: {
      notes: [
        "server 会把 attention 和 Mamba state 建成不同 object group 或不同 window descriptor，因为它们的生命周期和恢复语义不同。",
        "attention 使用 token window；Mamba recurrent state 更像“最后一个可继续 decode 的 snapshot”。",
        "这也是为什么只说 scratch / cacheable / exclude 容易乱：register 需要明确每个 group 是普通 token KV、recurrent state，还是 non-prefix-cacheable。"
      ],
      anchors: [["layout descriptor", "#十服务端还要注册-layout-descriptor"]]
    },
    later: {
      notes: [
        "后续请求里 group0 attention=[10] 与 group1 mamba=[7] 都叫 block ids，但它们的意义不同。",
        "attention 的 block id 10 指向一个 544-token logical page；Mamba 的 block id 7 指向一个 state snapshot page。",
        "server 之所以能区分，是因为 register 时已经把 tokens_per_block、slots_per_block、recurrent_state 和 object layout 都写入上下文。"
      ],
      anchors: [["注册之后如何使用", "#十一注册之后-store--retrieve-如何使用这份信息"]]
    }
  }
};

const DEEP_ANIMS = {
  "config-slot": {
    kicker: "补图 A 动画",
    title: "配置、page、slot 和 page_size_bytes 是怎么连起来的",
    visual: "config",
    caption: "普通 attention 的关键链路：vLLM spec 给 block_size，worker tensor 暴露 slot 维度，LMCache 用 dtype/head/KV plane 计算 page bytes。",
    steps: [
      {
        focus: "config",
        title: "先看配置：block_size 是 token slot 数",
        text: "KVCacheSpec 里的 block_size=16 表示一个 vLLM block 管 16 个 token 位置。它是调度语义：block table 和 prefix cache 会按这个单位切 token。",
        bullets: ["block_size 不是 bytes", "它决定一个 logical page 覆盖多少 token slots", "普通 attention 下，logical block 和 tensor page 一般一一对应"],
        link: ["跳到 page/block 解释", "#先补三个词page-sizelogical-blockphysical-block"]
      },
      {
        focus: "slots",
        title: "再看 page：一个 page 里有一排 slots",
        text: "worker tensor 的 block/page 维度选中 page 7 后，里面有 16 个 slot。slot 0 对应这个 block 中的第一个 token，slot 15 对应最后一个 token。",
        bullets: ["slot 是 page 内 offset", "block id 选 page", "token 在 block 内的位置选 slot"]
      },
      {
        focus: "kv",
        title: "每个 slot 里装 K 和 V 两份向量",
        text: "普通 attention 的每个 token slot 通常包含 K plane 和 V plane。每个 plane 又按 num_kv_heads 和 head_size 展开。",
        bullets: ["形状常见为 [num_blocks, 2, block_size, num_heads, head_size]", "这里的 2 是 K/V plane", "heads 和 head_size 决定单 token 的宽度"]
      },
      {
        focus: "bytes",
        title: "page_size_bytes 是整页占用的内存",
        text: "把 K/V plane、16 个 slots、head 数、head_size 和 dtype_size 乘起来，得到一个 page 的 bytes。LMCache 注册时要知道这个账本，server 才能按 block id 找到正确 byte range。",
        bullets: ["page_size_bytes = 2 * 16 * NH * HS * dtype_size", "STORE/RETRIEVE 最终搬的是 bytes", "register 把 token 语义和 byte 语义连起来"],
        link: ["跳到服务端 group", "#九服务端-kvlayergroupsmanager-如何消费-enginegroupinfo"]
      }
    ]
  },
  "mamba-state-page": {
    kicker: "补图 B 动画",
    title: "Attention page 和 Mamba state page 根本不是同一种东西",
    visual: "mamba-page",
    caption: "Attention page 是逐 token KV 表；Mamba page 是 recurrent state 快照。LMCache 需要把两者都抽象成可按 block id 搬运的 page。",
    steps: [
      {
        focus: "attention",
        title: "Attention：一排 token slots",
        text: "普通 attention 的 page 像一张表。每个 token slot 都有自己的 K/V 向量，所以随着 token 数增加，page bytes 线性增加。",
        bullets: ["slot 0..15 对应 block 内 token", "每个 slot 有 K 和 V", "适合用 token window 描述"],
        link: ["跳到普通 attention", "#1-最普通的-attention"]
      },
      {
        focus: "mamba",
        title: "Mamba：一份状态快照",
        text: "Mamba / recurrent layer 不保存每个历史 token 的 K/V 行。它保存的是继续 decode 所需的状态，比如 conv_state 和 SSM state。",
        bullets: ["不是逐 token KV", "一个 state page 可以代表继续生成所需的历史状态", "恢复时更像拿回最后一个有效 snapshot"],
        link: ["跳到 Mamba state", "#3-mamba-state-page"]
      },
      {
        focus: "pack",
        title: "注册前把多段 state bytes 打包成一页",
        text: "conv_state 和 ssm_state 原本可以是不同 shape 的 tensor。为了走统一 transfer path，LMCache 需要看到固定 page：conv bytes | ssm bytes | padding。",
        bullets: ["padding 用来补齐固定 page 大小", "server 不需要理解 state 内部数学语义", "只要 byte-level round-trip 正确即可"]
      },
      {
        focus: "view",
        title: "最后给它一个 transfer view",
        text: "Mamba packed page 会被 view 成类似 [num_blocks, 2, block_size, 1, head_size] 的形状。这里的 2 和 1 是 synthetic transfer axes，不是真实 K/V 和 attention head。",
        bullets: ["recurrent_state=true 必须写进 EngineGroupInfo", "transfer view 是搬运协议，不是模型语义", "后续 block id 可以定位完整 state page"],
        link: ["跳到 Mamba unified view", "#8-pr-5042-的-mamba-unified-view-和-blnhc--blhnc"]
      }
    ]
  },
  "hybrid-align": {
    kicker: "补图 C 动画",
    title: "为什么 Mamba-hybrid 会把 attention logical block 放大",
    visual: "hybrid-align",
    caption: "对齐的是 page bytes 账本，不是要求 attention 和 Mamba 覆盖相同 token 数。",
    steps: [
      {
        focus: "kernel",
        title: "attention kernel 天然用 32-token physical page",
        text: "底层 attention backend 为了 kernel 效率，仍然按 32 token 一页读写。这一页可以记作 X bytes。",
        bullets: ["physical/kernel page = 32 token slots", "kernel 仍按自己的粒度工作", "这个 X 是 byte 大小，不是 token 数"]
      },
      {
        focus: "mamba",
        title: "Mamba state page 的 bytes 可能大很多",
        text: "Mamba 的一页是状态快照，大小由 conv/SSM state shape 决定。假设它约等于 17 个 attention kernel pages，也就是 17X bytes。",
        bullets: ["Mamba page size 不靠 token slot 线性增长", "state shape 决定 bytes", "hybrid allocator 要把它放进同一套账本"]
      },
      {
        focus: "align",
        title: "vLLM 让 manager block 的 page bytes 对齐",
        text: "attention 这边可以通过把 17 个 32-token physical pages 组成一个 logical block，让 attention logical page 也变成 17X bytes。",
        bullets: ["17 * 32 = 544 token slots", "logical block 变大", "physical kernel page 没变"],
        link: ["跳到 logical/physical", "#先补三个词page-sizelogical-blockphysical-block"]
      },
      {
        focus: "register",
        title: "register 要记录放大后的 logical block",
        text: "LMCache 后续拿到的是 vLLM block id。这个 block id 属于 544-token logical 坐标，所以注册前必须把 raw tensor re-view 成 logical page 视图。",
        bullets: ["block id 10 不能只指向第 10 个 32-token physical page", "它应该指向 17 个连续 physical pages", "这正是 sub-paged re-view 的价值"],
        link: ["跳到 sub-paged attention", "#1-sub-paged-attention"]
      }
    ]
  },
  "logical-physical": {
    kicker: "补图 D 动画",
    title: "logical block 和 physical kernel page 是两个坐标系",
    visual: "logical-physical",
    caption: "这个动画把 block id 从 scheduler 坐标映射到 raw worker tensor 的 physical pages。",
    steps: [
      {
        focus: "physical",
        title: "raw tensor 第一维数的是 physical pages",
        text: "worker tensor 里 page 0、1、2... 是 attention backend 真实使用的 kernel page。每个 page 只有 32 个 token slots。",
        bullets: ["physical page 是底层存储粒度", "它属于 tensor/kernel 视角", "raw 第一维不一定等于 vLLM block id"]
      },
      {
        focus: "logical0",
        title: "logical block 0 覆盖 physical pages 0..16",
        text: "当 vLLM manager block 是 544 tokens 时，一个 logical block 需要 17 个 32-token physical pages 拼起来。",
        bullets: ["logical block 0 = pages 0..16", "这是 scheduler/block table 视角", "LMCache STORE 应该搬完整 544 slots"]
      },
      {
        focus: "logical1",
        title: "logical block 1 覆盖下一组 physical pages",
        text: "logical block 1 不是 raw page 1，而是 physical pages 17..33。直接拿 block id 当 raw 第一维 index 会错位。",
        bullets: ["logical block 1 = pages 17..33", "block id 和 raw page id 的比例是 1:17", "比例来自 logical_block_size / kernel_page_size"]
      },
      {
        focus: "bridge",
        title: "re-view 建立两个坐标系之间的桥",
        text: "注册前把 [N*17, 2, 32, H, C] view 成 [N, 2, 544, 1, C']，就是让 tensor 第一维重新变成 logical block 维。",
        bullets: ["不复制 bytes", "改变的是 shape/stride 解释", "server 后续按 block id 寻址就不会错"],
        link: ["跳到逐维 view", "#1-sub-paged-attention"]
      }
    ]
  },
  "shape-review": {
    kicker: "补图 E 动画",
    title: "Sub-paged attention re-view 每个维度为什么这样变",
    visual: "shape-review",
    caption: "这个 view 的约束是元素数量守恒，同时让第一维变回 vLLM logical block 坐标。",
    steps: [
      {
        focus: "pages",
        title: "num_kernel_pages -> num_logical_blocks",
        text: "原始第一维数 physical/kernel pages。因为 17 个 physical pages 才是一整个 logical block，所以第一维从 N*17 变成 N。",
        bullets: ["N = num_kernel_pages / 17", "要求 num_kernel_pages 能整除 17", "第一维从 kernel 坐标回到 vLLM block 坐标"]
      },
      {
        focus: "kv",
        title: "2 -> 2：保留 transfer 的 KV-like 轴",
        text: "这一维保留，是为了让 LMCache 通用 transfer kernel 仍看到 kv_size=2 的 rank-5 形状。",
        bullets: ["这不一定还能解释成纯 K plane / 纯 V plane", "它是 transfer 兼容轴", "关键是 byte range 能 round-trip"]
      },
      {
        focus: "slots",
        title: "32 -> 544：slot 维拼起来",
        text: "每个 physical page 有 32 个 slots，17 个 page 合起来就是 544 slots。LMCache 后续按 block id 搬时，需要看到完整 544 slots。",
        bullets: ["17 * 32 = 544", "slot 维表达 logical block 覆盖范围", "这一步修正 block id 到 byte range 的映射"]
      },
      {
        focus: "head",
        title: "H -> 1：head 维折叠成 opaque payload",
        text: "这个 view 不是为了让 LMCache 理解每个 attention head，而是为了把整页 bytes 变成可搬运 payload。因此可以使用 1 个 synthetic head。",
        bullets: ["H 不再作为语义 head 展开", "server 不做内容感知 attention 计算", "搬运协议只需要稳定 page layout"]
      },
      {
        focus: "width",
        title: "C -> C'：把元素数补回来",
        text: "H 被折叠后，原来 H*C 的内容进入新的 trailing width。真实代码会按 page_size_bytes / element_size / (2 * 544 * 1) 计算 C'，保证一页元素总数对齐。",
        bullets: ["元素数量守恒", "bytes 不移动", "C' 是 transfer payload width"],
        link: ["跳到逐维表格", "#1-sub-paged-attention"]
      }
    ]
  },
  "group-info": {
    kicker: "图 2 动画",
    title: "create_engine_group_infos_from_vllm 怎样合并两类事实",
    visual: "group-info",
    caption: "EngineGroupInfo 不是 vLLM group 的简单拷贝，而是 vLLM 调度语义和真实 tensor transfer identity 的合成结果。",
    steps: [
      {
        focus: "metadata",
        title: "先拿 vLLM metadata：谁和谁共享 block-id address space",
        text: "KVCacheConfig 里的 kv_cache_groups 告诉 LMCache：哪些 layer 属于同一个 engine group、每个 group 的 block_size/prefix_cacheable/window/recurrent 语义是什么。",
        bullets: ["这是调度语义", "回答 block id 应该给哪些 layer 用", "不回答 tensor 真实 layout"],
        link: ["跳到函数开头", "#五客户端第二步create_engine_group_infos_from_vllm-是整条链路的翻译器"]
      },
      {
        focus: "tensor",
        title: "再看真实 tensor：它能不能共用同一个 transfer kernel",
        text: "LMCache 对 registered tensors 做 format discovery，得到 kv_size、num_heads、head_size、slots_per_block、dtype、engine_kv_format。",
        bullets: ["这是物理搬运语义", "同一 vLLM group 内也可能有不同 layout", "indexer/main cache 就会在这里分开"]
      },
      {
        focus: "exclude",
        title: "prefix_cacheable=false 的 group 不生成 info",
        text: "non-prefix-cacheable group 是运行时临时状态，不属于可复用 prefix KV。它不会参与 format discovery，也不会出现在 EngineGroupInfo list 里。",
        bullets: ["tokens_per_block=0 是排除信号", "避免 scratch ring 破坏 chunk 对齐", "避免无意义 layout 导致注册失败"],
        link: ["跳到 scratch 章节", "#6-pr-5042-的-qwen38b--glm-scratch-group"]
      },
      {
        focus: "identity",
        title: "按 physical transfer identity 再切一次",
        text: "即使 engine_group_id 一样，只要 dtype/layout/slots/head_size 不同，也要拆成不同 EngineGroupInfo。反过来，没有独立 KV owner 的 alias layer 会保持 excluded。",
        bullets: ["engine_group_id 保留 block-id 坐标", "layer_indices 指向 registered tensor list", "tokens_per_block 连接 token prefix 和 GPU page"],
        link: ["跳到 identity 字段", "#7-最后按-physical-transfer-identity-再切一次"]
      },
      {
        focus: "output",
        title: "输出 list[EngineGroupInfo]",
        text: "最终返回 list，是因为真实模型可能有多个 vLLM group、多个 layout/object kind、CacheBlend aux pool，也可能排除部分 group。",
        bullets: ["infos 复数是协议真实形态", "server 后续按这个 list 建 kernel groups", "STORE/RETRIEVE 的 block ids 会按 engine_group_id 展开"],
        link: ["跳到 block ids 展开", "#十一注册之后-store--retrieve-如何使用这份信息"]
      }
    ]
  },
  "model-cases": {
    kicker: "图 3 动画",
    title: "不同模型案例进入 register_kv_cache 时各自哪里特殊",
    visual: "model-cases",
    caption: "这些模型差异看起来很多，但 register 最终都要回答同一组问题：可缓存吗、block id 怎么解释、tensor page 怎么搬、server 怎么分组。",
    steps: [
      {
        focus: "simple",
        title: "普通 attention：一 block 一 page",
        text: "这是最容易理解的 baseline。tokens_per_block == slots_per_block，layout 规则，通常一个 vLLM engine group 生成一个 EngineGroupInfo。",
        bullets: ["不需要 re-view", "block id 直接定位 tensor page", "server 建一个普通 token-window object group"],
        link: ["跳到普通 attention", "#1-最普通的-attention"]
      },
      {
        focus: "mla",
        title: "普通 MLA：格式不同，但未必压缩 token slots",
        text: "MLA 可能是 rank-3 key-only / latent-state cache。它不是普通 K/V plane，但如果 tokens_per_block == slots_per_block，就只是 format 不同。",
        bullets: ["kv_size 常是 1", "num_heads 可以归一为 1", "head_size 是 latent/state width"],
        link: ["跳到普通 MLA", "#2-普通-mla"]
      },
      {
        focus: "indexer",
        title: "带 indexer 的 MLA：同一 block 坐标，多种物理对象",
        text: "主 MLA cache 和 indexer 可能共享 engine_group_id，但 dtype、slots_per_block 和 object layout 不同，因此要拆成多项 EngineGroupInfo。",
        bullets: ["main cache 和 indexer 要同命中", "但 transfer kernel 不能合并", "两个 info 可以复用同一份 block ids"],
        link: ["跳到 indexer", "#4-带-indexer-的-mla"]
      },
      {
        focus: "deepseek",
        title: "DeepSeek-V3.2 fp8_ds_mla：注意别把 bytes 压缩误当 slot 压缩",
        text: "fp8_ds_mla 更像 bytes per slot 变小，而不是多个逻辑 token 共用一个 slot。register 要看真实 slots_per_block 和 tokens_per_block 的关系。",
        bullets: ["slot compression 和 dtype bytes 变化要分开", "compress_ratio 不应靠名字猜", "shape/dtype descriptor 更可靠"],
        link: ["跳到 DeepSeek-V3.2", "#3-deepseek-v32-这类-fp8_ds_mla"]
      },
      {
        focus: "multi",
        title: "DeepSeek-V4 / 多 backbone：多个 group 和 alias layer",
        text: "未来更复杂的模型可能有 full attention、sliding-window、compressed MLA、indexer、多 backbone 和 cross-layer KV sharing。register 不能假设全模型只有一个 block size。",
        bullets: ["每个 group 的 tokens_per_block 可不同", "alias layer 不应重复注册", "object groups/window descriptors 要分开"],
        link: ["跳到多 group", "#5-deepseek-v4-和其他多-backbone--多-group-结构"]
      },
      {
        focus: "scratch",
        title: "Qwen/GLM scratch：prefix_cacheable=false 要排除",
        text: "QSA ring / kpool tail 这类临时 group 不是可跨请求复用的 prefix KV。它们应该在 register 路径里被排除，而不是被当成 scratch layer 到处传播术语。",
        bullets: ["更统一的术语是 non-prefix-cacheable group", "不参与 format discovery", "不生成 EngineGroupInfo"],
        link: ["跳到 scratch group", "#6-pr-5042-的-qwen38b--glm-scratch-group"]
      },
      {
        focus: "mamba",
        title: "Mamba hybrid：state snapshot 和 attention page 共存",
        text: "Mamba state page 是 recurrent snapshot；attention 可能被 page-size 对齐放大成 544-token logical block。register 要分别记录 ordinary token window 和 recurrent_state。",
        bullets: ["attention 做 sub-paged re-view", "Mamba 做 opaque page view", "BLNHC/BLHNC hint 要被接受"],
        link: ["跳到 Mamba unified view", "#8-pr-5042-的-mamba-unified-view-和-blnhc--blhnc"]
      }
    ]
  }
};

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function makeCode(text) {
  const code = makeEl("code", "", text);
  return code;
}

function setPressed(buttons, activeId) {
  buttons.forEach((button) => {
    const isActive = button.dataset.id === activeId || button.dataset.stage === activeId || button.dataset.scenario === activeId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function nodeById(id) {
  return KNOWLEDGE_NODES.find((node) => node.id === id) || KNOWLEDGE_NODES[0];
}

function initKnowledgeMap(root) {
  let activeId = "logical-physical";
  let activePhase = "all";

  const shell = makeEl("div", "knowledge-shell");
  const header = makeEl("div", "knowledge-header");
  const titleWrap = makeEl("div", "");
  titleWrap.append(
    makeEl("p", "knowledge-kicker", "知识地图"),
    makeEl("h2", "", "先把 register_kv_cache 的基础概念拼起来"),
    makeEl("p", "knowledge-lead", "点一个概念，就能看到它在 register 阶段为什么存在、携带哪些信息，以及它和其它概念如何连起来。")
  );

  const tour = makeEl("div", "knowledge-tour");
  const prev = makeEl("button", "knowledge-icon-button", "‹");
  prev.type = "button";
  prev.setAttribute("aria-label", "上一个概念");
  const next = makeEl("button", "knowledge-icon-button", "›");
  next.type = "button";
  next.setAttribute("aria-label", "下一个概念");
  tour.append(prev, makeEl("span", "", "按注册顺序浏览"), next);
  header.append(titleWrap, tour);

  const phaseTabs = makeEl("div", "knowledge-tabs");
  const allButton = makeEl("button", "knowledge-tab is-active", "全部");
  allButton.type = "button";
  allButton.dataset.id = "all";
  phaseTabs.append(allButton);
  KNOWLEDGE_PHASES.forEach((phase) => {
    const button = makeEl("button", "knowledge-tab", phase.title);
    button.type = "button";
    button.dataset.id = phase.id;
    phaseTabs.append(button);
  });

  const body = makeEl("div", "knowledge-body");
  const grid = makeEl("div", "knowledge-grid");
  const detail = makeEl("aside", "knowledge-detail");
  body.append(grid, detail);
  shell.append(header, phaseTabs, body);
  root.replaceChildren(shell);

  const renderDetail = () => {
    const node = nodeById(activeId);
    const extra = KNOWLEDGE_EXTRA[activeId] || {};
    const related = node.relates.map(nodeById);
    const fieldList = makeEl("div", "knowledge-fields");
    node.fields.forEach((field) => fieldList.append(makeEl("span", "", field)));
    const relatedList = makeEl("div", "knowledge-related");
    related.forEach((item) => {
      const button = makeEl("button", "", item.title);
      button.type = "button";
      button.dataset.node = item.id;
      relatedList.append(button);
    });

    const deepList = makeEl("ol", "knowledge-deep-list");
    (extra.deep || [node.remember, node.why]).forEach((item) => {
      deepList.append(makeEl("li", "", item));
    });

    const anchorList = makeEl("div", "knowledge-anchors");
    (extra.anchors || []).forEach(([label, href]) => {
      const anchor = makeEl("a", "", label);
      anchor.href = href;
      anchorList.append(anchor);
    });

    const meta = makeEl("div", "knowledge-detail__meta");
    meta.append(makeEl("span", "", node.badge), makeEl("span", "", KNOWLEDGE_PHASES.find((phase) => phase.id === node.phase)?.title || ""));

    const remember = makeEl("section", "knowledge-detail__section");
    remember.append(makeEl("h3", "", "先记住"), makeEl("p", "", node.remember));
    const why = makeEl("section", "knowledge-detail__section");
    why.append(makeEl("h3", "", "register 为什么要管"), makeEl("p", "", node.why));
    const fields = makeEl("section", "knowledge-detail__section");
    fields.append(makeEl("h3", "", "携带的信息"), fieldList);
    const deep = makeEl("section", "knowledge-detail__section");
    deep.append(makeEl("h3", "", "具体展开"), deepList);
    const links = makeEl("section", "knowledge-detail__section");
    links.append(makeEl("h3", "", "相关概念"), relatedList);
    const anchors = makeEl("section", "knowledge-detail__section");
    anchors.append(makeEl("h3", "", "后文详解"), anchorList);

    const children = [meta, makeEl("h2", "", node.title), makeEl("p", "knowledge-detail__short", node.short), remember, why, fields, deep, links];
    if ((extra.anchors || []).length > 0) {
      children.push(anchors);
    }
    detail.replaceChildren(...children);
  };

  const renderGrid = () => {
    grid.replaceChildren();
    KNOWLEDGE_PHASES.forEach((phase) => {
      if (activePhase !== "all" && activePhase !== phase.id) {
        return;
      }
      const column = makeEl("section", "knowledge-phase");
      column.append(makeEl("h3", "", phase.title), makeEl("p", "", phase.note));
      KNOWLEDGE_NODES.filter((node) => node.phase === phase.id).forEach((node) => {
        const button = makeEl("button", "knowledge-node", "");
        button.type = "button";
        button.dataset.node = node.id;
        button.title = node.short;
        button.append(makeEl("span", "knowledge-node__badge", node.badge), makeEl("strong", "", node.title));
        const isRelated = nodeById(activeId).relates.includes(node.id);
        button.classList.toggle("is-active", node.id === activeId);
        button.classList.toggle("is-related", isRelated);
        column.append(button);
      });
      grid.append(column);
    });
  };

  const update = () => {
    renderGrid();
    renderDetail();
    setPressed([...phaseTabs.querySelectorAll("button")], activePhase);
  };

  phaseTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) {
      return;
    }
    activePhase = button.dataset.id;
    update();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-node]");
    if (!button) {
      return;
    }
    activeId = button.dataset.node;
    activePhase = "all";
    update();
  });

  const stepTour = (delta) => {
    const index = KNOWLEDGE_TOUR.indexOf(activeId);
    const nextIndex = index < 0 ? 0 : clampStep(index + delta, KNOWLEDGE_TOUR.length);
    activeId = KNOWLEDGE_TOUR[nextIndex];
    activePhase = "all";
    update();
  };
  prev.addEventListener("click", () => stepTour(-1));
  next.addEventListener("click", () => stepTour(1));

  update();
}

function initScenarioLab(root) {
  let scenarioId = "simple";
  let stageId = "input";
  let selectedField = null;

  const shell = makeEl("div", "scenario-shell");
  const header = makeEl("div", "scenario-header");
  const titleWrap = makeEl("div", "");
  titleWrap.append(
    makeEl("p", "scenario-kicker", "交互流程"),
    makeEl("h2", "", "按场景走一遍 register_kv_cache"),
    makeEl("p", "scenario-lead", "选择 simple / MLA / hybrid，流程图、每一步携带的信息和 server 侧注册结果会一起变化。")
  );
  const tabs = makeEl("div", "scenario-tabs");
  Object.entries(SCENARIOS).forEach(([id, scenario]) => {
    const button = makeEl("button", "scenario-tab", scenario.label);
    button.type = "button";
    button.dataset.scenario = id;
    tabs.append(button);
  });
  header.append(titleWrap, tabs);

  const stageRail = makeEl("div", "scenario-rail");
  SCENARIO_STAGES.forEach((stage, index) => {
    const button = makeEl("button", "scenario-stage-button", "");
    button.type = "button";
    button.dataset.stage = stage.id;
    button.append(makeEl("span", "", String(index + 1)), makeEl("strong", "", stage.label), makeEl("em", "", stage.verb));
    stageRail.append(button);
  });

  const body = makeEl("div", "scenario-body");
  const visual = makeEl("div", "scenario-visual");
  const detail = makeEl("aside", "scenario-detail");
  body.append(visual, detail);
  shell.append(header, stageRail, body);
  root.replaceChildren(shell);

  const renderVisual = () => {
    const scenario = SCENARIOS[scenarioId];
    visual.replaceChildren();
    visual.dataset.scenario = scenario.accent;

    const summary = makeEl("div", "scenario-visual__summary");
    summary.append(makeEl("h3", "", scenario.title), makeEl("p", "", scenario.summary));
    visual.append(summary);

    const stageData = scenario.stages[stageId];
    const cards = makeEl("div", "scenario-data-cards");
    stageData.cards.forEach(([label, value]) => {
      const card = makeEl("div", "scenario-data-card");
      card.append(makeEl("strong", "", label), makeCode(value));
      cards.append(card);
    });
    visual.append(cards);
  };

  const renderDetail = () => {
    const scenario = SCENARIOS[scenarioId];
    const stage = scenario.stages[stageId];
    const notes = SCENARIO_NOTES[scenarioId]?.[stageId] || {};
    if (!selectedField || !stage.fields.some(([field]) => field === selectedField)) {
      selectedField = stage.fields[0]?.[0] || null;
    }
    const selected = stage.fields.find(([field]) => field === selectedField);

    const fieldButtons = makeEl("div", "scenario-fields");
    stage.fields.forEach(([field, explanation]) => {
      const button = makeEl("button", "", field);
      button.type = "button";
      button.dataset.field = field;
      button.title = explanation;
      button.classList.toggle("is-active", field === selectedField);
      fieldButtons.append(button);
    });

    const explanation = makeEl("div", "scenario-field-explain");
    if (selected) {
      explanation.append(makeEl("strong", "", selected[0]), makeEl("p", "", selected[1]));
    }

    const noteList = makeEl("ol", "scenario-notes");
    (notes.notes || [stage.copy]).forEach((note) => {
      noteList.append(makeEl("li", "", note));
    });

    const anchorList = makeEl("div", "scenario-links");
    (notes.anchors || []).forEach(([label, href]) => {
      const anchor = makeEl("a", "", label);
      anchor.href = href;
      anchorList.append(anchor);
    });

    const noteSection = makeEl("section", "scenario-detail__section");
    noteSection.append(makeEl("h4", "", "这一步到底在干什么"), noteList);
    const linkSection = makeEl("section", "scenario-detail__section");
    linkSection.append(makeEl("h4", "", "跳到后文详解"), anchorList);

    detail.replaceChildren(
      makeEl("p", "scenario-detail__kicker", scenario.label),
      makeEl("h3", "", stage.title),
      makeEl("p", "scenario-detail__copy", stage.copy),
      noteSection,
      makeEl("h4", "", "点击查看携带的信息"),
      fieldButtons,
      explanation,
      ...(notes.anchors || []).length > 0 ? [linkSection] : []
    );
  };

  const update = () => {
    root.dataset.scenario = scenarioId;
    root.dataset.stage = stageId;
    setPressed([...tabs.querySelectorAll("button")], scenarioId);
    setPressed([...stageRail.querySelectorAll("button")], stageId);
    renderVisual();
    renderDetail();
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-scenario]");
    if (!button) {
      return;
    }
    scenarioId = button.dataset.scenario;
    stageId = "input";
    selectedField = null;
    update();
  });

  root.addEventListener("click", (event) => {
    const stageButton = event.target.closest("button[data-stage]");
    if (stageButton) {
      stageId = stageButton.dataset.stage;
      selectedField = null;
      update();
      return;
    }
    const fieldButton = event.target.closest("button[data-field]");
    if (fieldButton) {
      selectedField = fieldButton.dataset.field;
      renderDetail();
    }
  });

  update();
}

function makeAnchorLink(link) {
  const anchor = makeEl("a", "deep-anim__link", link[0]);
  anchor.href = link[1];
  return anchor;
}

function makeBullets(items) {
  const list = makeEl("ul", "deep-anim__bullets");
  items.forEach((item) => list.append(makeEl("li", "", item)));
  return list;
}

function renderMetric(label, value, active) {
  const item = makeEl("div", "deep-metric");
  item.classList.toggle("is-active", active);
  item.append(makeEl("span", "", label), makeEl("strong", "", value));
  return item;
}

function renderMiniSlots(count, activeCount, className = "") {
  const row = makeEl("div", `deep-slots ${className}`.trim());
  for (let index = 0; index < count; index += 1) {
    const slot = makeEl("span", "", String(index));
    slot.classList.toggle("is-active", index < activeCount);
    row.append(slot);
  }
  return row;
}

function renderByteBar(segments, focus) {
  const bar = makeEl("div", "deep-byte-bar");
  segments.forEach((segment) => {
    const part = makeEl("span", `deep-byte-bar__seg deep-byte-bar__seg--${segment.kind || "plain"}`);
    part.style.flexGrow = String(segment.weight || 1);
    part.classList.toggle("is-active", segment.id === focus || segment.active);
    part.textContent = segment.label;
    bar.append(part);
  });
  return bar;
}

function renderDeepConfig(visual, focus) {
  visual.append(
    renderMetric("KVCacheSpec.block_size", "16 token slots", focus === "config"),
    renderMetric("tensor page", "[page 7, 2, 16, NH, HS]", focus === "slots"),
    renderMetric("page_size_bytes", "2 * 16 * NH * HS * dtype", focus === "bytes")
  );
  const page = makeEl("div", "deep-card deep-card--wide");
  page.append(makeEl("strong", "", "worker tensor page 7"), renderMiniSlots(16, focus === "slots" || focus === "kv" || focus === "bytes" ? 16 : 0));
  const kv = makeEl("div", "deep-kv-stack");
  kv.classList.toggle("is-active", focus === "kv" || focus === "bytes");
  kv.append(renderByteBar([{ id: "k", label: "K vector", kind: "cyan", weight: 1 }, { id: "v", label: "V vector", kind: "violet", weight: 1 }], focus === "kv" ? "k" : "v"));
  kv.append(makeEl("span", "", "per slot bytes = 2 * NH * HS * dtype_size"));
  page.append(kv);
  visual.append(page);
}

function renderDeepMambaPage(visual, focus) {
  const attention = makeEl("div", "deep-card");
  attention.classList.toggle("is-active", focus === "attention");
  attention.append(makeEl("strong", "", "Attention page"), renderMiniSlots(8, focus === "attention" ? 8 : 3, "deep-slots--compact"), makeEl("em", "", "每个 token slot 都有 K/V"));

  const mamba = makeEl("div", "deep-card");
  mamba.classList.toggle("is-active", focus === "mamba" || focus === "pack" || focus === "view");
  mamba.append(
    makeEl("strong", "", "Mamba state page"),
    renderByteBar(
      [
        { id: "conv", label: "conv_state bytes", kind: "green", weight: 0.9, active: focus === "mamba" || focus === "pack" },
        { id: "ssm", label: "ssm_state bytes", kind: "violet", weight: 1.35, active: focus === "mamba" || focus === "pack" },
        { id: "pad", label: "padding", kind: "plain", weight: 0.55, active: focus === "pack" }
      ],
      focus
    ),
    makeEl("em", "", "不是逐 token KV，而是 recurrent snapshot")
  );

  const view = makeEl("div", "deep-card deep-card--wide");
  view.classList.toggle("is-active", focus === "view");
  view.append(makeEl("strong", "", "LMCache transfer view"), makeCode("[num_blocks, 2, block_size, 1, head_size]"), makeEl("em", "", "2 和 1 是 synthetic transfer axes"));
  visual.append(attention, mamba, view);
}

function renderDeepHybridAlign(visual, focus) {
  const ledger = makeEl("div", "deep-ledger");
  const attn = makeEl("div", "deep-card");
  attn.classList.toggle("is-active", focus === "kernel");
  attn.append(makeEl("strong", "", "attention physical page"), renderByteBar([{ id: "kernel", label: "32 tokens = X bytes", kind: "cyan", weight: 1 }], "kernel"));

  const mamba = makeEl("div", "deep-card");
  mamba.classList.toggle("is-active", focus === "mamba");
  mamba.append(makeEl("strong", "", "Mamba state page"), renderByteBar([{ id: "mamba", label: "state snapshot = 17X bytes", kind: "green", weight: 17 }], "mamba"));

  const aligned = makeEl("div", "deep-card deep-card--wide");
  aligned.classList.toggle("is-active", focus === "align" || focus === "register");
  aligned.append(makeEl("strong", "", "attention logical block"), renderMiniSlots(17, focus === "align" || focus === "register" ? 17 : 0, "deep-slots--pages"), makeEl("em", "", "17 kernel pages * 32 slots = 544 token slots"));
  ledger.append(attn, mamba, aligned);
  visual.append(ledger);

  const bridge = makeEl("div", "deep-equation");
  bridge.classList.toggle("is-active", focus === "register");
  bridge.textContent = "register view: [N*17, 2, 32, H, C] -> [N, 2, 544, 1, C']";
  visual.append(bridge);
}

function renderDeepLogicalPhysical(visual, focus) {
  const row = makeEl("div", "deep-page-grid");
  for (let index = 0; index < 34; index += 1) {
    const tile = makeEl("span", "", String(index));
    const inLogical0 = index < 17;
    const inLogical1 = index >= 17;
    tile.classList.toggle("is-active", focus === "physical" || (focus === "logical0" && inLogical0) || (focus === "logical1" && inLogical1) || focus === "bridge");
    tile.classList.toggle("is-secondary", focus === "bridge" && inLogical1);
    row.append(tile);
  }
  visual.append(row);
  const labels = makeEl("div", "deep-logical-labels");
  labels.append(
    renderMetric("logical block 0", "physical pages 0..16", focus === "logical0" || focus === "bridge"),
    renderMetric("logical block 1", "physical pages 17..33", focus === "logical1")
  );
  visual.append(labels);
  const equation = makeEl("div", "deep-equation");
  equation.classList.toggle("is-active", focus === "bridge");
  equation.textContent = "block id 0 -> logical block 0 -> 17 physical pages -> 544 slots";
  visual.append(equation);
}

function renderDeepShapeReview(visual, focus) {
  const rows = [
    ["pages", "num_kernel_pages", "num_logical_blocks", "17 个 physical pages 合成 1 个 logical block"],
    ["kv", "2", "2", "保留 KV-like transfer 轴"],
    ["slots", "32", "544", "17 * 32 个 slots 串成一个 logical block"],
    ["head", "H", "1", "真实 head 维折成 synthetic head"],
    ["width", "C", "C'", "把 H*C 的元素数补进 payload width"]
  ];
  const table = makeEl("div", "deep-shape-table");
  rows.forEach(([id, before, after, why]) => {
    const row = makeEl("div", "deep-shape-row");
    row.classList.toggle("is-active", id === focus);
    row.append(makeCode(before), makeEl("span", "", "->"), makeCode(after), makeEl("em", "", why));
    table.append(row);
  });
  visual.append(table);
  const equation = makeEl("div", "deep-equation");
  equation.classList.toggle("is-active", focus === "width");
  equation.textContent = "元素守恒：N*17*2*32*H*C = N*2*544*1*C'";
  visual.append(equation);
}

function renderDeepGroupInfo(visual, focus) {
  const columns = [
    {
      id: "metadata",
      title: "vLLM metadata",
      lines: ["kv_cache_groups", "layer_names", "block_size", "prefix_cacheable", "recurrent/window"]
    },
    {
      id: "tensor",
      title: "real tensor facts",
      lines: ["shape / stride", "dtype", "kv_size", "num_heads", "slots_per_block", "engine_kv_format"]
    },
    {
      id: "output",
      title: "EngineGroupInfo list",
      lines: ["engine_group_id", "layer_indices", "tokens_per_block", "sw_size_tokens", "recurrent_state"]
    }
  ];
  const board = makeEl("div", "deep-flow-board");
  columns.forEach((column, index) => {
    const card = makeEl("div", "deep-card");
    card.classList.toggle("is-active", column.id === focus || (focus === "identity" && column.id !== "metadata") || (focus === "exclude" && column.id === "metadata"));
    card.append(makeEl("strong", "", column.title));
    const list = makeEl("ul", "");
    column.lines.forEach((line) => list.append(makeEl("li", "", line)));
    card.append(list);
    board.append(card);
    if (index < columns.length - 1) {
      board.append(makeEl("div", "deep-flow-arrow", "->"));
    }
  });
  visual.append(board);
  const warning = makeEl("div", "deep-equation");
  warning.classList.toggle("is-active", focus === "exclude" || focus === "identity");
  warning.textContent = focus === "exclude" ? "prefix_cacheable=false -> no EngineGroupInfo" : "identity = engine_group_id + dtype/layout/slots/head shape";
  visual.append(warning);
}

function renderDeepModelCases(visual, focus) {
  const cases = [
    ["simple", "普通 attention", "tokens == slots"],
    ["mla", "普通 MLA", "rank-3 / key-only"],
    ["indexer", "MLA indexer", "same block ids, different object"],
    ["deepseek", "DeepSeek-V3.2", "fp8 bytes != slot compression"],
    ["multi", "DeepSeek-V4 / multi", "multiple groups / alias"],
    ["scratch", "Qwen/GLM scratch", "prefix_cacheable=false"],
    ["mamba", "Mamba hybrid", "recurrent state page"]
  ];
  const grid = makeEl("div", "deep-case-grid");
  cases.forEach(([id, title, tag]) => {
    const card = makeEl("div", "deep-case-card");
    card.classList.toggle("is-active", id === focus);
    card.append(makeEl("strong", "", title), makeEl("span", "", tag));
    grid.append(card);
  });
  visual.append(grid);
  const active = cases.find(([id]) => id === focus) || cases[0];
  const equation = makeEl("div", "deep-equation is-active");
  equation.textContent = `register question: ${active[1]} -> 可缓存吗？block id 怎么解释？需要几个 EngineGroupInfo？`;
  visual.append(equation);
}

function renderDeepVisual(visual, kind, step) {
  visual.replaceChildren();
  visual.dataset.visual = kind;
  if (kind === "config") {
    renderDeepConfig(visual, step.focus);
  } else if (kind === "mamba-page") {
    renderDeepMambaPage(visual, step.focus);
  } else if (kind === "hybrid-align") {
    renderDeepHybridAlign(visual, step.focus);
  } else if (kind === "logical-physical") {
    renderDeepLogicalPhysical(visual, step.focus);
  } else if (kind === "shape-review") {
    renderDeepShapeReview(visual, step.focus);
  } else if (kind === "group-info") {
    renderDeepGroupInfo(visual, step.focus);
  } else if (kind === "model-cases") {
    renderDeepModelCases(visual, step.focus);
  }
}

function initDeepAnimation(root) {
  const type = root.dataset.lmcacheDeepAnim;
  const anim = DEEP_ANIMS[type];
  if (!anim) {
    return;
  }

  let stepIndex = 0;
  let timer = null;
  let userPaused = false;
  const shell = makeEl("figure", "deep-anim");
  const header = makeEl("div", "deep-anim__header");
  const titleWrap = makeEl("div", "");
  titleWrap.append(makeEl("p", "deep-anim__kicker", anim.kicker), makeEl("h3", "", anim.title));
  const label = makeEl("div", "deep-anim__step-label");
  header.append(titleWrap, label);
  const body = makeEl("div", "deep-anim__body");
  const visual = makeEl("div", "deep-anim__visual");
  const panel = makeEl("figcaption", "deep-anim__panel");
  body.append(visual, panel);
  const controls = makeEl("div", "deep-anim__controls");
  const prev = makeEl("button", "deep-anim__button", "‹");
  prev.type = "button";
  prev.setAttribute("aria-label", "上一步");
  const play = makeEl("button", "deep-anim__button", "▶");
  play.type = "button";
  play.setAttribute("aria-label", "播放");
  const next = makeEl("button", "deep-anim__button", "›");
  next.type = "button";
  next.setAttribute("aria-label", "下一步");
  const dots = makeEl("div", "deep-anim__dots");
  anim.steps.forEach((_, index) => {
    const dot = makeEl("button", "deep-anim__dot");
    dot.type = "button";
    dot.dataset.dot = String(index);
    dot.setAttribute("aria-label", `跳到第 ${index + 1} 步`);
    dots.append(dot);
  });
  controls.append(prev, play, next, dots);
  const caption = makeEl("p", "deep-anim__caption", anim.caption);
  shell.append(header, body, controls, caption);
  root.replaceChildren(shell);

  const stop = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    play.textContent = "▶";
    play.setAttribute("aria-label", "播放");
  };
  const start = () => {
    if (reducedMotion || timer) {
      return;
    }
    timer = window.setInterval(() => go(stepIndex + 1), AUTOPLAY_MS);
    play.textContent = "Ⅱ";
    play.setAttribute("aria-label", "暂停");
  };
  const go = (nextIndex) => {
    stepIndex = clampStep(nextIndex, anim.steps.length);
    const step = anim.steps[stepIndex];
    label.textContent = `Step ${stepIndex + 1} / ${anim.steps.length}`;
    renderDeepVisual(visual, anim.visual, step);
    const title = makeEl("h4", "", step.title);
    const text = makeEl("p", "", step.text);
    const children = [title, text, makeBullets(step.bullets || [])];
    if (step.link) {
      children.push(makeAnchorLink(step.link));
    }
    panel.replaceChildren(...children);
    dots.querySelectorAll("[data-dot]").forEach((dot) => {
      dot.classList.toggle("is-active", Number(dot.dataset.dot) === stepIndex);
    });
  };

  prev.addEventListener("click", () => {
    userPaused = true;
    stop();
    go(stepIndex - 1);
  });
  next.addEventListener("click", () => {
    userPaused = true;
    stop();
    go(stepIndex + 1);
  });
  play.addEventListener("click", () => {
    userPaused = Boolean(timer);
    if (timer) {
      stop();
    } else {
      userPaused = false;
      start();
    }
  });
  dots.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-dot]");
    if (!dot) {
      return;
    }
    userPaused = true;
    stop();
    go(Number(dot.dataset.dot || 0));
  });

  go(0);
  if (!reducedMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !userPaused) {
            start();
          } else {
            stop();
          }
        });
      },
      { threshold: 0.35 }
    );
    observer.observe(root);
  }
}

document.querySelectorAll("[data-lmcache-knowledge-map]").forEach(initKnowledgeMap);
document.querySelectorAll("[data-lmcache-scenario-lab]").forEach(initScenarioLab);
document.querySelectorAll("[data-lmcache-deep-anim]").forEach(initDeepAnimation);
document.querySelectorAll("[data-lmcache-animation]").forEach(initAnimation);
