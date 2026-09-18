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

document.querySelectorAll("[data-lmcache-animation]").forEach(initAnimation);
