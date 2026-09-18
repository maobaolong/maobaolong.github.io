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

    const meta = makeEl("div", "knowledge-detail__meta");
    meta.append(makeEl("span", "", node.badge), makeEl("span", "", KNOWLEDGE_PHASES.find((phase) => phase.id === node.phase)?.title || ""));

    const remember = makeEl("section", "knowledge-detail__section");
    remember.append(makeEl("h3", "", "先记住"), makeEl("p", "", node.remember));
    const why = makeEl("section", "knowledge-detail__section");
    why.append(makeEl("h3", "", "register 为什么要管"), makeEl("p", "", node.why));
    const fields = makeEl("section", "knowledge-detail__section");
    fields.append(makeEl("h3", "", "携带的信息"), fieldList);
    const links = makeEl("section", "knowledge-detail__section");
    links.append(makeEl("h3", "", "相关概念"), relatedList);

    detail.replaceChildren(meta, makeEl("h2", "", node.title), makeEl("p", "knowledge-detail__short", node.short), remember, why, fields, links);
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
        button.append(makeEl("span", "knowledge-node__badge", node.badge), makeEl("strong", "", node.title), makeEl("em", "", node.short));
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

    const pipeline = makeEl("div", "scenario-pipeline");
    SCENARIO_STAGES.forEach((stage, index) => {
      const stageData = scenario.stages[stage.id];
      const card = makeEl("button", "scenario-pipe-card", "");
      card.type = "button";
      card.dataset.stage = stage.id;
      card.classList.toggle("is-active", stage.id === stageId);
      card.classList.toggle("is-before", SCENARIO_STAGES.findIndex((item) => item.id === stageId) > index);
      card.append(makeEl("span", "scenario-pipe-card__index", String(index + 1)), makeEl("strong", "", stage.label), makeEl("em", "", stageData.title));
      pipeline.append(card);
      if (index < SCENARIO_STAGES.length - 1) {
        pipeline.append(makeEl("div", "scenario-pipe-arrow", "→"));
      }
    });
    visual.append(pipeline);

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

    detail.replaceChildren(
      makeEl("p", "scenario-detail__kicker", scenario.label),
      makeEl("h3", "", stage.title),
      makeEl("p", "scenario-detail__copy", stage.copy),
      makeEl("h4", "", "点击查看携带的信息"),
      fieldButtons,
      explanation
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

document.querySelectorAll("[data-lmcache-knowledge-map]").forEach(initKnowledgeMap);
document.querySelectorAll("[data-lmcache-scenario-lab]").forEach(initScenarioLab);
document.querySelectorAll("[data-lmcache-animation]").forEach(initAnimation);
