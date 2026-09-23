const COPY = {
  register: [
    "the vLLM worker first obtains the real KV tensor, KVCacheConfig, and layout hints; all subsequent lightweight STORE / RETRIEVE depend on the contract established during this registration.",
    "The edits before registration do not move bytes, but change sub-paged attention, MLA, or Mamba state into a view that can be moved by LMCache later.",
    "create_engine_group_infos_from_vllm combines two types of facts: the block-id group semantics of vLLM and the transfer layout exposed by the actual tensor.",
    "What is sent across processes is not the torch.Tensor itself, but a list of DeviceIPCWrapper and EngineGroupInfo; the server can import handles without needing to parse the vLLM layer name.",
    "After the server imports the IPC handle, it will run format discovery again based on the real tensor view and find the registered tensors that need to participate in grouping according to layer_indices.",
    "After registration, the server has KVLayerGroupsManager, layout registry, and context table; subsequent STORE / RETRIEVE can only carry block ids and token spans."
  ],
  review: [
    "Initially, the first dimension of the worker tensor counts the kernel page, with each page having only 32 token slots; the vLLM block ID cannot yet be directly used as a 544-token block.",
    "If only a small segment of physical pages is taken as a vLLM block, it will prematurely truncate the mapping from block id to byte range.",
    "17 consecutive physical pages constitute a logical block on the vLLM scheduling side: 17 × 32 = 544 token slots.",
    "The action of re-view is to change the shape without copying data: the same segment of storage is marked from [N * 17, 2, 32, H, C] to [N, 2, 544, 1, C'].",
    "From this step onward, when LMCache addresses with block ID 0, it sees the complete logical block 0, not a single 32-token kernel page in the raw tensor."
  ],
  grouping: [
    "First, flatten the ordered dict into a registered tensor list; from this step onward, the cross-process protocol should focus on index and no longer require the server to understand vLLM layer names.",
    "vLLM group metadata still uses layer names. In this example, group 0 selects layer.0, layer.2, layer.4.",
    "The client uses layer_to_idx to translate names into positions in the registered tensor list, so group 0 becomes layer_indices = (0, 2, 4).",
    "Groups with prefix_cacheable = false do not form EngineGroupInfo; they remain in the worker runtime but do not enter the prefix KV transfer protocol.",
    "Finally, it also needs to be split according to physical transfer identity. If the layout, dtype, head_size, or slots_per_block are different, even if the engine group semantics are similar, they must be divided into different kernel groups."
  ],
  expand: [
    "vLLM sends block ids arranged by engine group; this coordinate system describes scheduling semantics and does not directly equal the kernel group order the server needs to launch.",
    "info 0 comes from engine group 0, so it retrieves block ids of group 0: [10, 11].",
    "info 1 comes from engine group 1, so it retrieves block ids of group 1: [20, 21].",
    "info 2, although it is the third kernel group, still has an engine_group_id of 0; therefore, it reuses the block ids of group 0: [10, 11]."
  ],
  mamba: [
    "Mamba / linear attention saves a snapshot of the recurrent state, not a K/V for each token. Here, conv_state and ssm_state are treated as two segments of differently shaped bytes.",
    "The edits before registration will place these state bytes into a fixed page: conv bytes, ssm bytes may still have padding afterwards to fill the page size.",
    "LMCache transfer kernel wants to see a unified page shape, so this entire page of bytes is re-viewed as [num_blocks, 2, block_size, 1, head_size].",
    "The 2 and 1 here are synthetic transfer axes, not the K/V plane of attention and real heads. The important thing is that the block ID can locate the complete state page.",
    "When generating EngineGroupInfo, recurrent_state = true will be marked, and the recoverable window is understood as a block: when hitting multiple blocks, what is actually recovered is the last matching snapshot."
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
      dot.setAttribute("aria-label", `Jump to step ${index + 1}`);
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
      playButton.setAttribute("aria-label", "Play");
    }
  };
  const start = () => {
    if (reducedMotion || timer) {
      return;
    }
    timer = window.setInterval(() => go(current() + 1), AUTOPLAY_MS);
    if (playButton) {
      playButton.textContent = "Ⅱ";
      playButton.setAttribute("aria-label", "Pause");
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
    short: "the vLLM worker actually holds the torch.Tensor for K/V or state.",
    remember: "register_kv_caches receives not an abstract configuration but a set of already allocated GPU tensors; subsequent transmissions will ultimately read and write these storages.",
    why: "The server and worker are different processes. The server must first register the IPC handle, shape, dtype, and stride of these tensors; only then can STORE / RETRIEVE work with block ids.",
    fields: ["layer name", "dtype", "shape", "stride", "device"],
    relates: ["layout-hints", "ipc-wrapper", "engine-group-info"]
  },
  {
    id: "kv-cache-config",
    phase: "vllm",
    title: "KVCacheConfig",
    badge: "scheduler contract",
    short: "vLLM scheduler's description of KV cache group, block size, and layer affiliation.",
    remember: "It answers 'which group the block id belongs to, which layers are in this group, and how many tokens a block covers.'",
    why: "The real tensor can explain how bytes are arranged, but cannot explain which layers should use the 0th group block ids sent by vLLM later. This semantics comes from KVCacheConfig.",
    fields: ["kv_cache_groups", "block_size", "page_size_bytes", "prefix_cacheable"],
    relates: ["block-id", "logical-physical", "engine-group-info"]
  },
  {
    id: "slot",
    phase: "vllm",
    title: "slot",
    badge: "token position",
    short: "A page or block can hold the position of a token KV.",
    remember: "a regular attention page with block_size = 16 has 16 slots; each slot typically contains one K and one V.",
    why: "LMCache external cache hits by token range, but GPU transfer ultimately moves by slot range. During registration, the number of tokens and slots must be aligned.",
    fields: ["token index", "slot offset", "K plane", "V plane"],
    relates: ["page-size", "logical-physical", "mamba-state"]
  },
  {
    id: "page-size",
    phase: "vllm",
    title: "page size",
    badge: "bytes per page",
    short: "How many bytes a page occupies; it does not always equal the intuitive size of 'how many tokens'.",
    remember: "In regular attention, the page size is usually derived from block_size * K/V * heads * head_size * dtype; hybrid models also need to align the page bytes of different groups.",
    why: "Multi-process transmission and block tables require stable page boundaries. When page bytes are inconsistent, vLLM may enlarge the logical block of a certain group to align the page ledgers of each group.",
    fields: ["page_size_bytes", "tokens_per_block", "slots_per_block", "dtype bytes"],
    relates: ["logical-physical", "mamba-state", "zero-copy-view"]
  },
  {
    id: "logical-physical",
    phase: "vllm",
    title: "logical block / physical page",
    badge: "two address spaces",
    short: "Logical block is the scheduling coordinate of vLLM; physical kernel page is the storage coordinate of the underlying tensor/kernel.",
    remember: "block id 10 may represent a 544-token logical block, but the underlying attention kernel still stores it as 17 32-token physical pages.",
    why: "If LMCache directly interprets the block id as the first dimension of the raw tensor, it will misinterpret the range; re-view aligns the two coordinate systems before registration.",
    fields: ["manager block", "kernel page", "block table", "page offset"],
    relates: ["block-id", "zero-copy-view", "page-size"]
  },
  {
    id: "block-id",
    phase: "vllm",
    title: "block id",
    badge: "runtime address",
    short: "the page numbers carried by subsequent STORE / RETRIEVE requests from vLLM.",
    remember: "block id is group-relative: block id 10 of the 0th engine group and block id 10 of the 1st engine group can point to different KV pools.",
    why: "EngineGroupInfo records engine_group_id, allowing the same EngineGroupInfo to be mapped back to the correct block id list when the server expands the kernel group.",
    fields: ["engine_group_id", "block_ids", "slot range", "cache key"],
    relates: ["engine-group-info", "kernel-group", "kv-cache-config"]
  },
  {
    id: "layout-hints",
    phase: "client",
    title: "layout hints",
    badge: "format clue",
    short: "Inform LMCache of the dimension order in the tensor, such as NHD/HND/BLNHC/BLHNC.",
    remember: "Some layouts of rank-4 fused K/V cannot be deduced solely from shape and must rely on vLLM config or backend hints for clarification.",
    why: "During the registration phase, raw tensors need to be converted into a consistent transfer format. If the hint is wrong, the server may be able to import the handle but will move data along the wrong axis.",
    fields: ["NHD", "HND", "BLNHC", "BLHNC"],
    relates: ["kv-caches", "zero-copy-view", "object-layout"]
  },
  {
    id: "zero-copy-view",
    phase: "client",
    title: "zero-copy re-view",
    badge: "shape only",
    short: "Does not copy data, only changes the tensor view, allowing LMCache to see pages arranged by logical block.",
    remember: "the sub-paged MLA of [N*17, 2, 32, H, C] can be viewed as [N, 2, 544, 1, C']; the storage remains the same.",
    why: "LMCache transfer kernel wants to move page by page according to block id; viewing before registration is good, so subsequent requests do not need to know that the internal kernel pages are smaller.",
    fields: ["view", "permute", "contiguous recovery", "shape desc"],
    relates: ["logical-physical", "layout-hints", "mamba-state"]
  },
  {
    id: "ipc-wrapper",
    phase: "client",
    title: "DeviceIPCWrapper",
    badge: "cross process handle",
    short: "the worker exposes the GPU tensor to the server as an importable handle.",
    remember: "The REGISTER_KV_CACHE message does not directly send the torch.Tensor body, but sends handles + metadata.",
    why: "This way, the server can later access the same block of device memory's view in its own process and use the transfer kernel for read/write.",
    fields: ["handle", "device id", "shape", "stride", "dtype"],
    relates: ["kv-caches", "server-context", "engine-group-info"]
  },
  {
    id: "engine-group-info",
    phase: "client",
    title: "EngineGroupInfo",
    badge: "registration unit",
    short: "The LMCache registration protocol binds the vLLM group semantics with the actual tensor layout.",
    remember: "The function name is create_engine_group_infos_from_vllm; the plural is important: one vLLM engine group may be split into multiple EngineGroupInfo.",
    why: "Reasons for splitting include different layouts, different dtypes, different slot counts, independent MLA indexers, Mamba recurrent state, and exclusion of prefix_cacheable=false.",
    fields: ["engine_group_id", "layer_indices", "tokens_per_block", "kv_format"],
    relates: ["kernel-group", "object-layout", "block-id"]
  },
  {
    id: "kernel-group",
    phase: "server",
    title: "kernel group",
    badge: "launch shape",
    short: "The tensor group on the server side that can truly share the same transfer kernel.",
    remember: "the group in vLLM is scheduling semantics; the LMCache kernel group is transmission execution semantics. The two are often related but should not be conflated.",
    why: "The same kernel requires consistent dtype, layout, page shape, and window semantics; inconsistencies will require splitting the group, otherwise the copy kernel parameters will be incorrect.",
    fields: ["PageBufferShapeDesc", "dtype", "layout", "window"],
    relates: ["engine-group-info", "object-layout", "server-context"]
  },
  {
    id: "object-layout",
    phase: "server",
    title: "object layout",
    badge: "storage contract",
    short: "How external objects in LMCache correspond to the description of GPU pages.",
    remember: "An object group may correspond to a regular attention page, MLA page, indexer bytes, or Mamba state page.",
    why: "STORE / RETRIEVE does not just move a block of continuous bytes, but also needs to know how the external cache's token window, chunk, and GPU page map to each other.",
    fields: ["ObjectLayoutDesc", "AttnWindowDesc", "chunk size", "tokens"],
    relates: ["kernel-group", "page-size", "server-context"]
  },
  {
    id: "mamba-state",
    phase: "server",
    title: "Mamba state",
    badge: "recurrent snapshot",
    short: "Not one K/V per token, but a snapshot of a recurrent state that can continue decoding.",
    remember: "Mamba pages are often composed of conv_state, ssm_state, and padding to form a fixed page, which is then wrapped into a transfer shape similar to a KV page.",
    why: "in the hybrid model, attention and Mamba need to share the scheduling/transfer framework; the register must mark the state page as recurrent_state, so that the recovery semantics are not treated as ordinary token K/V.",
    fields: ["conv state", "ssm state", "padding", "recurrent_state"],
    relates: ["page-size", "zero-copy-view", "scratch-group"]
  },
  {
    id: "scratch-group",
    phase: "server",
    title: "scratch group",
    badge: "not prefix cacheable",
    short: "Runtime auxiliary or temporary state should not enter prefix KV cache reuse.",
    remember: "This concept is best unified as 'prefix_cacheable=false group' to minimize the introduction of multiple terminologies like scratch / exclude / non-cacheable.",
    why: "If temporary ring buffers or connector private pools are registered in the prefix cache, hits during recovery may contaminate the model's true semantics.",
    fields: ["prefix_cacheable=false", "excluded group", "aux pool"],
    relates: ["kv-cache-config", "engine-group-info", "mamba-state"]
  },
  {
    id: "server-context",
    phase: "server",
    title: "GPUCacheContext",
    badge: "registered runtime",
    short: "The runtime context retained after the server completes registration.",
    remember: "It connects imported tensors, format discovery, group manager, layout registry, and context table into a state that can be reused in subsequent requests.",
    why: "Subsequent STORE / RETRIEVE only carries lightweight parameters because these heavyweight details have already entered the server context during the register phase.",
    fields: ["registered tensors", "KVLayerGroupsManager", "layout registry", "context id"],
    relates: ["ipc-wrapper", "kernel-group", "object-layout"]
  }
];

const KNOWLEDGE_PHASES = [
  { id: "vllm", title: "the facts provided by vLLM", note: "Scheduling semantics, block coordinates, actual tensor." },
  { id: "client", title: "worker-side translation", note: "Convert the name, layout, view, and IPC handle into a protocol." },
  { id: "server", title: "Server-side registration.", note: "Transform the protocol into a launchable group and a recoverable object layout." }
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
      "when vLLM calls register_kv_caches, the KV cache is no longer something 'to be allocated in the future', but a real GPU tensor that exists in the worker process.",
      "The first layer of meaning in LMCache register is to turn these worker-owned tensors into server-importable memory: subsequent servers do not need to request tensors from vLLM again, they just need to find the registered context through instance_id.",
      "The shape/stride of this tensor is not decorative information either. LMCache later judges NHD/HND/BLNHC/BLHNC, rank-3 MLA, and Mamba packed state, all of which need to read evidence from these actual tensors."
    ],
    anchors: [
      ["what vLLM passes in", "#Two - What is passed to lmcache after vllm is called"],
      ["Who actually moves the data", "#Three - Who is actually moving data in the lmcache-driven mode"]
    ]
  },
  "kv-cache-config": {
    deep: [
      "KVCacheConfig is the ledger on the vLLM scheduling side. It does not tell you how bytes are arranged in GPU memory but indicates where the semantic boundaries of block ids are.",
      "The most critical aspect is kv_cache_groups: layers within the same group use the same block-id address space. Different groups cannot mix even if the block ID numbers are the same.",
      "The prefix_cacheable=false from PR #5042 comes from this layer of semantics: certain groups are temporary rings or aux buffers and should not enter the prefix cache registration."
    ],
    anchors: [
      ["group edits", "#Four - Why does the client need to do kv-cache-group-edits before the first step of registration"],
      ["Generating EngineGroupInfo", "#Five - The second step of the client create_engine_group_infos_from_vllm is the translator for the entire chain"]
    ]
  },
  slot: {
    deep: [
      "slot is the positional unit within the page. In regular attention, one slot roughly corresponds to one token's K/V row.",
      "tokens_per_block and slots_per_block need to be separated because MLA/indexer/Mamba may not be 'one token one slot'.",
      "LMCache external cache hits by token prefix, but GPU copy moves by page/slot, so registration must first connect token semantics with slot semantics."
    ],
    anchors: [
      ["Page size/block concept.", "#First, add three terms: page-size, logical-block, physical-block"],
      ["Server tokens/slots", "#Nine - How does the server's kvlayergroupsmanager consume enginegroupinfo"]
    ]
  },
  "page-size": {
    deep: [
      "Page size here mainly refers to page_size_bytes, which is 'how many bytes a page occupies in GPU memory.' It is not the number of tokens.",
      "The page bytes of regular attention are usually proportional to block_size; the bytes of the Mamba state page are more determined by the conv/SSM state shape.",
      "the hybrid model needs to include multiple groups in a single capacity estimation and block table ledger, which may enlarge the manager block of attention, bringing the bytes of the attention logical page closer to the Mamba state page.",
      "Note that this will constrain LMCache chunk_size: if the tokens_per_block of a certain cacheable group becomes 544, the default 256 will no longer be valid, and chunk_size must be changed to a common multiple of the tokens_per_block of all cacheable groups."
    ],
    anchors: [
      ["Page size explanation.", "#First, add three terms: page-size, logical-block, physical-block"],
      ["Mamba state", "#3-mamba-state-page"]
    ]
  },
  "logical-physical": {
    deep: [
      "Logical block is the address unit seen by the scheduler/block table/prefix cache; physical kernel page is the unit where the attention backend actually reads and writes tensors.",
      "These two are often exactly the same in regular attention, so they can easily be confused as one concept. However, in sub-paged MLA/Mamba-hybrid, they will be separated.",
      "The re-view before register does not change the mathematical semantics but establishes an executable view for LMCache from 'logical block id to physical byte range'."
    ],
    anchors: [
      ["Detailed explanation of logical/physical.", "#First, add three terms: page-size, logical-block, physical-block"],
      ["sub-paged attention", "#1-sub-paged-attention"]
    ]
  },
  "layout-hints": {
    deep: [
      "Layout hints are directional clues from vLLM to LMCache: for the same set of dimensions, which is a block, which is a token slot, and which is a head cannot always be guessed by shape.",
      "Rank-4 fused views are particularly prone to ambiguity. For example, BLNHC / BLHNC are both blocks-first, but the inner order of token/head is different.",
      "hint is not a substitute for format discovery, but rather ensures that discovery does not take the wrong branch when the shape is insufficient to distinguish."
    ],
    anchors: [
      ["Mamba unified view", "#8 - pr-5042's mamba unified view and blnhc - blhnc"],
      ["contiguity tie-break", "#9 - pr-5042's contiguity recovery tie-break"]
    ]
  },
  "zero-copy-view": {
    deep: [
      "Zero-copy re-view only modifies tensor metadata, without moving storage. It requires that the number of elements, storage offset, and stride relationships can support this new view.",
      "For sub-paged attention, the key is to label N*17 32-token kernel pages as N 544-token logical pages.",
      "For Mamba, the key is to package state bytes like conv/SSM/padding into opaque pages that the transfer kernel can handle."
    ],
    anchors: [
      ["sub-paged attention", "#1-sub-paged-attention"],
      ["Mamba state page", "#3-mamba-state-page"]
    ]
  },
  "engine-group-info": {
    deep: [
      "EngineGroupInfo is the core registration unit in the inter-process protocol. It retains the vLLM block-id group semantics while carrying the layer_indices, tokens_per_block, and window/recurrent information needed for LMCache transfer.",
      "It returns a list, not just because one vLLM group may split into multiple kernel groups; multiple vLLM groups, separated indexer/main cache, CacheBlend aux pool, and different dtype/layout/slots will also change the number of entries.",
      "The server will try to consume only these protocol fields and tensor indices later, rather than understanding the layer names of vLLM again."
    ],
    anchors: [
      ["Function details", "#Five - The second step of the client create_engine_group_infos_from_vllm is the translator for the entire chain"],
      ["Server consumption", "#Nine - How does the server's kvlayergroupsmanager consume enginegroupinfo"]
    ]
  },
  "mamba-state": {
    deep: [
      "Mamba state is not a historical token K/V table, but a recurrent snapshot needed for the model to continue decoding.",
      "So a block ID is more like 'a certain state page number' for Mamba, rather than 'a segment of token K/V rows'.",
      "register must write recurrent_state into EngineGroupInfo; otherwise, the server will interpret it using the standard attention token-window semantics."
    ],
    anchors: [
      ["Mamba state page", "#3-mamba-state-page"],
      ["Mamba unified view", "#8 - pr-5042's mamba unified view and blnhc - blhnc"]
    ]
  },
  "scratch-group": {
    deep: [
      "The more accurate term here is non-prefix-cacheable KV cache group. The scratch ring is just one example.",
      "prefix_cacheable=false indicates that this group does not represent a prefix KV that can be reused across requests. LMCache should exclude it in format discovery, EngineGroupInfo, and block ID slicing.",
      "This can avoid two issues: the special layout of the temporary ring causing registration failures, and its insufficient capacity disrupting the entire prefix chunk ledger."
    ],
    anchors: [
      ["Qwen/GLM scratch group", "#6 - pr-5042's qwen38b - glm-scratch-group"],
      ["format discovery skip", "#2 - Identify layer group that needs format discovery"]
    ]
  },
  "server-context": {
    deep: [
      "GPUCacheContext is the runtime container after registration on the server side. It holds imported tensors, the original IPC wrapper, block id buffer, data pointer tensor, temp buffer, and CUDA stream.",
      "Subsequent STORE/RETRIEVE finds this context through instance_id, then interprets block ids according to the registered kernel/object group.",
      "The more complete the register, the lighter the subsequent requests: they do not need to repeatedly transmit shape, stride, layer name, layout, and grouping rules."
    ],
    anchors: [
      ["Server registration", "#Eight - What does the server do after receiving register_kv_cache"],
      ["layout descriptor", "#Ten - The server also needs to register layout-descriptor"]
    ]
  }
};

const SCENARIO_STAGES = [
  { id: "input", label: "vLLM input", verb: "Get" },
  { id: "edit", label: "Pre-registration editing", verb: "Change to" },
  { id: "infos", label: "EngineGroupInfo", verb: "Description" },
  { id: "payload", label: "IPC payload", verb: "Send" },
  { id: "server", label: "server registration", verb: "Drop Table" },
  { id: "later", label: "Subsequent requests", verb: "Reuse" }
];

const SCENARIOS = {
  simple: {
    label: "Simple Attention",
    title: "Standard set of attention KV cache",
    summary: "A vLLM block is a tensor page; the register mainly binds layer names to indices, IPC handles, and format metadata.",
    accent: "simple",
    stages: {
      input: {
        title: "vLLM calls connector.register_kv_caches",
        copy: "the worker already holds each layer's KV tensor, and KVCacheConfig indicates which layers are in group 0, as well as block_size=16.",
        cards: [
          ["kv_caches", "layer.0 -> [NB, 2, 16, NH, HS]\nlayer.1 -> [NB, 2, 16, NH, HS]"],
          ["kv_cache_groups[0]", "layers=[layer.0, layer.1]\nblock_size=16\nprefix_cacheable=true"],
          ["layout_hints", "NHD or HND: indicates the order of token/head/head_size to the LMCache."]
        ],
        fields: [
          ["NB", "Num blocks, the first dimension of the tensor is the number of vLLM pages/blocks."],
          ["2", "In regular attention, it is usually the K plane and V plane."],
          ["16", "A block has 16 token slots."]
        ]
      },
      edit: {
        title: "apply_kv_cache_group_edits basically does not need to change.",
        copy: "Regular attention is already in the form of 'one block one page', so there is no need to merge multiple kernel pages or package the state.",
        cards: [
          ["before", "[NB, 2, 16, NH, HS]"],
          ["after", "[NB, 2, 16, NH, HS]"],
          ["why", "Only retain layout hint; subsequent format discovery can reliably identify it."]
        ],
        fields: [
          ["no copy", "No new tensor is allocated, and no data is moved."],
          ["view unchanged", "The shape before and after registration is the same, just entering a unified processing pipeline."]
        ]
      },
      infos: {
        title: "Generate an EngineGroupInfo",
        copy: "Layer names are translated into indices in the registered tensor list; the block IDs of group 0 can subsequently be applied to these layers.",
        cards: [
          ["EngineGroupInfo[0]", "engine_group_id=0\nlayer_indices=(0, 1)\ntokens_per_block=16\nslots_per_block=16"],
          ["transfer identity", "dtype=bf16\nformat=NHD/HND\npage shape is consistent"],
          ["result", "A vLLM engine group corresponds to a LMCache kernel group."]
        ],
        fields: [
          ["engine_group_id", "Source coordinates for the subsequent block id list."],
          ["layer_indices", "server no longer parses layer names but retrieves tensors in the order they were registered."],
          ["tokens_per_block", "The token window of the external cache key aligns with the GPU page."]
        ]
      },
      payload: {
        title: "REGISTER_KV_CACHE payload",
        copy: "Inter-process messages carry IPC wrappers, layout hints, model/world information, and EngineGroupInfo, rather than the torch.Tensor itself.",
        cards: [
          ["DeviceIPCWrapper[]", "2 tensor handles + shape/stride/dtype"],
          ["metadata", "model name, tp/dcp/world, kv role"],
          ["engine_group_infos", "Only 1 item: simple attention group"]
        ],
        fields: [
          ["IPC handle", "After server import, the same block of GPU memory is visible."],
          ["layout_hints", "Supplementary evidence for server-side format discovery."]
        ]
      },
      server: {
        title: "server imports handles and establishes runtime context.",
        copy: "LMCache server unwraps IPC handle, checks tensor format, and then creates KVLayerGroupsManager and layout registry.",
        cards: [
          ["registered tensors", "idx 0 -> layer.0\nidx 1 -> layer.1"],
          ["kernel group", "group 0: same dtype/layout/page shape"],
          ["object layout", "16 token slots -> one cache object chunk"]
        ],
        fields: [
          ["KVLayerGroupsManager", "Record which layers can launch transfer kernels together."],
          ["layout registry", "Record the mapping of external objects to GPU pages."]
        ]
      },
      later: {
        title: "Subsequent STORE / RETRIEVE only sends lightweight information",
        copy: "Request block ids=[10,11] with group 0 and token span; the server knows which tensor pages to read/write by checking the registered context.",
        cards: [
          ["request", "engine_group_blocks[0] = [10, 11]\ntokens = 0..31"],
          ["server expands", "EngineGroupInfo[0] -> block ids [10, 11]"],
          ["copy", "Pages 10 and 11 of layer.0/layer.1 are stored/retrieved."]
        ],
        fields: [
          ["block ids", "Does not carry shape, as the shape has been determined in the register phase."],
          ["token span", "For external cache key and object slicing."]
        ]
      }
    }
  },
  mla: {
    label: "MLA / indexer",
    title: "The main cache and indexer in MLA share block coordinates but have different physical forms.",
    summary: "MLA caches like GLM/Kimi/DeepSeek may have a main KV cache, indexer cache, and sub-paged kernel storage. They are semantically related to the same engine group but must be split into different registration units.",
    accent: "mla",
    stages: {
      input: {
        title: "vLLM exposes kernel-friendly physical pages",
        copy: "The main MLA cache may have a first dimension of a 32-token kernel page; the indexer also has its own smaller pages and dtype.",
        cards: [
          ["main MLA tensor", "[N * 18, 64, 576] or rank-4 variant."],
          ["indexer tensor", "[N * 9, 32, 132], often a more compact metadata."],
          ["engine group", "with engine_group_id=0, the block id coordinates still come from the same group scheduling semantics"]
        ],
        fields: [
          ["sub-paged", "A logical block is split into multiple kernel pages for storage."],
          ["indexer", "Auxiliary cache used for MLA lookup/attention kernel, not equal to the main KV."],
          ["rank-3/rank-4", "Rank is the number of tensor dimensions: 3D like [pages, slots, width], 4D like [pages, 2, slots, width]."]
        ]
      },
      edit: {
        title: "Re-view multiple kernel pages into a logical block.",
        copy: "Before registration, revert the kernel page dimensions back to logical block dimensions to ensure that block id 0 hits the complete logical block.",
        cards: [
          ["main re-view", "[N * 18, 64, 576]\n-> [N, 1152, 576]"],
          ["rank-4 variant", "[N * k, 2, 32, H, C]\n-> [N, 2, k*32, 1, H*C]"],
          ["indexer re-view", "[N * 9, 32, 132]\n-> [N, 288, 132]"]
        ],
        fields: [
          ["N * k -> N", "k consecutive physical pages merge into 1 logical block."],
          ["32 -> k*32", "Each kernel page's token slots are concatenated to form the slots of a logical block."],
          ["H*C -> C'", "the head dimension sometimes folds into the trailing width, keeping the total number of elements unchanged."]
        ]
      },
      infos: {
        title: "The same engine group can generate multiple EngineGroupInfo",
        copy: "The main cache and indexer share engine_group_id=0, but dtype, slots_per_block, and object layout are different, so registration needs to be split.",
        cards: [
          ["EngineGroupInfo[0]", "main MLA\nengine_group_id=0\nslots_per_block=1152"],
          ["EngineGroupInfo[1]", "MLA indexer\nengine_group_id=0\nslots_per_block=288"],
          ["why list", "Not only because the vLLM group splits the kernel group; multiple objects/layouts at the same block coordinate can also produce multiple entries."]
        ],
        fields: [
          ["same engine_group_id", "Subsequent reuse of the same group of block ids."],
          ["different slots", "The same logical token block occupies a different number of slots in different physical objects."],
          ["different dtype/layout", "Cannot be placed in the same transfer kernel group."]
        ]
      },
      payload: {
        title: "Payload carries registration descriptions for both the main cache and indexer.",
        copy: "The server receives multiple EngineGroupInfo items, each pointing to different index subsets of the registered tensor list.",
        cards: [
          ["DeviceIPCWrapper[]", "main handles + indexer handles"],
          ["EngineGroupInfo list", "[main MLA info, indexer info]"],
          ["address reuse", "Both items take block IDs from engine_group_blocks[0]."]
        ],
        fields: [
          ["layer_indices", "The main cache and indexer point to different tensor indices."],
          ["shape desc", "Inform the server how each object should page."]
        ]
      },
      server: {
        title: "The server creates two executable layouts.",
        copy: "KVLayerGroupsManager will split the kernel group by transfer identity; the layout registry records the different windows of the main MLA object and indexer object.",
        cards: [
          ["kernel group A", "main MLA: large slot page"],
          ["kernel group B", "indexer: compact metadata page"],
          ["object groups", "The same token prefix corresponds to two objects that need consistent store/retrieve."]
        ],
        fields: [
          ["KernelGroupInfo", "A set of tensors with the same kernel launch parameters."],
          ["ObjectLayoutDesc", "Mapping of object chunks in the external cache to GPU pages."]
        ]
      },
      later: {
        title: "Subsequent requests for block ids, expanded into multiple copy plans",
        copy: "engine_group_blocks[0]=[10] will simultaneously drive the transfer of main MLA page 10 and indexer page 10, although the page shapes of the two are different.",
        cards: [
          ["request", "group 0 block ids = [10]"],
          ["main path", "EngineGroupInfo[0] -> main MLA object"],
          ["indexer path", "EngineGroupInfo[1] -> indexer object"]
        ],
        fields: [
          ["one address, many objects", "The scheduling coordinates are the same, but there is more than one physical object to restore."],
          ["consistency", "The main cache and indexer must hit and recover together."]
        ]
      }
    }
  },
  hybrid: {
    label: "Mamba hybrid",
    title: "attention, Mamba state, and non-cacheable groups mixed in one model",
    summary: "The Mamba-hybrid contains both regular attention pages and recurrent state pages. To align the page bytes of different KV groups, the logical blocks of attention may be enlarged.",
    accent: "hybrid",
    stages: {
      input: {
        title: "vLLM input includes both attention cache and Mamba state",
        copy: "The attention kernel may still store according to 32-token pages; Mamba saves conv/SSM state snapshots; there are also temporary groups with prefix_cacheable=false.",
        cards: [
          ["attention raw", "[N * 17, 2, 32, H, C]"],
          ["Mamba state", "conv_state + ssm_state -> recurrent snapshot"],
          ["scratch group", "prefix_cacheable=false, does not enter prefix cache."]
        ],
        fields: [
          ["17", "To make the attention page bytes close/aligned to the Mamba state page, the manager block is enlarged to 17 kernel pages."],
          ["32", "The actual token page size operated by the underlying attention kernel."],
          ["recurrent", "Mamba restores a state snapshot, not a token-by-token K/V."]
        ]
      },
      edit: {
        title: "Before registration, divert the three types of objects",
        copy: "Attention performs sub-paged re-view; Mamba state is packed into fixed pages; scratch groups are excluded.",
        cards: [
          ["attention re-view", "[N * 17, 2, 32, H, C]\n-> [N, 2, 544, 1, H*C]"],
          ["Mamba packing", "[conv, ssm]\n-> [N, 2, block, 1, head_size]"],
          ["exclude", "prefix_cacheable=false -> no EngineGroupInfo"]
        ],
        fields: [
          ["544", "17 * 32, token slots of the logical block."],
          ["synthetic axes", "Mamba's 2 and 1 are transmission axes, not real K/V and attention heads."],
          ["exclude", "What is excluded is the prefix cache transfer registration, not the vLLM runtime deleting this buffer."]
        ]
      },
      infos: {
        title: "Generate two types of EngineGroupInfo: attention and recurrent state",
        copy: "Attention and Mamba state may come from different engine groups; scratch does not generate info. The server will subsequently process according to their respective semantics.",
        cards: [
          ["EngineGroupInfo[0]", "attention\nengine_group_id=0\ntokens_per_block=544"],
          ["EngineGroupInfo[1]", "Mamba\nengine_group_id=1\nrecurrent_state=true"],
          ["excluded", "scratch / aux pool\nprefix_cacheable=false"]
        ],
        fields: [
          ["tokens_per_block=544", "External prefix hits are counted based on the enlarged logical block."],
          ["recurrent_state=true", "Inform the server that the recovery semantics is a state snapshot."],
          ["engine_group_id=1", "Mamba state uses its own block ID list."]
        ]
      },
      payload: {
        title: "Payload carries different transfer identities.",
        copy: "REGISTER_KV_CACHE will simultaneously include attention tensor handles, Mamba state page handles, and their respective EngineGroupInfo.",
        cards: [
          ["DeviceIPCWrapper[]", "attention handles + recurrent state handles"],
          ["layout hints", "attention: BLNHC/BLHNC is acceptable\nMamba: packed page shape"],
          ["EngineGroupInfo list", "attention info + recurrent info"]
        ],
        fields: [
          ["BLNHC/BLHNC", "block-first layout hint, compatible with the view exposed by vLLM in Mamba-hybrid."],
          ["packed page", "server sees a unified shape and does not need to understand the original structure of conv/SSM."]
        ]
      },
      server: {
        title: "The server registers ordinary pages and recurrent pages separately.",
        copy: "Attention enters a regular token-window object layout; Mamba enters a recurrent state object layout; scratch has no prefix cache objects.",
        cards: [
          ["attention kernel group", "page shape: 544 token slots"],
          ["Mamba kernel group", "state snapshot page\nrecurrent_state=true"],
          ["context table", "The same model saves two types of recovery semantics."]
        ],
        fields: [
          ["AttnWindowDesc", "Regular attention is described using a token window."],
          ["state snapshot", "When Mamba hits multiple blocks, the truly valuable part is the last state that can continue decoding."]
        ]
      },
      later: {
        title: "Expand subsequent requests by different group block ids",
        copy: "The attention group 0 block ids=[10] indicates 544 slots; Mamba's group 1 block ids=[7] indicates a state snapshot page.",
        cards: [
          ["request", "group0 attention=[10]\ngroup1 mamba=[7]"],
          ["attention copy", "Logical block 10 -> view of 17 kernel pages."],
          ["Mamba copy", "state page 7 -> recurrent snapshot restore"]
        ],
        fields: [
          ["different meaning", "Both block IDs are called block ID, but the recovery semantics are completely different."],
          ["registered context", "The differences have already been recorded at the registration stage, so requests can remain lightweight."]
        ]
      }
    }
  }
};

const SCENARIO_NOTES = {
  simple: {
    input: {
      notes: [
        "This scenario resembles the intuitive KV cache: each layer has a regularly shaped attention KV tensor, where the first dimension is the number of blocks/pages allocated by vLLM.",
        "KVCacheConfig mainly provides group semantics here: which layers are included in group 0, what the block_size is, and whether this group is prefix_cacheable.",
        "Layout hints are meant for LMCache to interpret tensor dimensions as the correct axes later; even though simple scenarios can usually be guessed from shape, registration still treats hints as protocol input."
      ],
      anchors: [["content passed in by vLLM", "#Two - What is passed to lmcache after vllm is called"]]
    },
    edit: {
      notes: [
        "Regular attention does not require sub-paged merging, as logical blocks and physical pages naturally correspond one-to-one.",
        "This still goes through apply_kv_cache_group_edits to ensure that all models follow the same preprocessing path: the simple scenario is equivalent to 'check and not modify'.",
        "This is important not to change: it indicates that the register is not meant to forcibly alter the tensor, but only inserts a zero-copy view when the vLLM scheduling coordinates and physical storage coordinates are inconsistent."
      ],
      anchors: [["background of group edits", "#Four - Why does the client need to do kv-cache-group-edits before the first step of registration"]]
    },
    infos: {
      notes: [
        "create_engine_group_infos_from_vllm will turn layer names into layer_indices. This way, the server does not need to understand vLLM layer name strings, it just needs to work based on the index of the registered tensor list.",
        "tokens_per_block=16 comes from the vLLM spec.block_size; slots_per_block=16 comes from the actual tensor shape. When these two numbers are equal, it indicates no slot compression.",
        "If all layers have the same dtype/layout/head_size, group_layers_by_identity will only produce one transfer identity, resulting in only one EngineGroupInfo."
      ],
      anchors: [["Function details", "#Five - The second step of the client create_engine_group_infos_from_vllm is the translator for the entire chain"]]
    },
    payload: {
      notes: [
        "REGISTER_KV_CACHE does not send tensor data, nor Python torch.Tensor objects, but rather DeviceIPCWrapper and EngineGroupInfo.",
        "DeviceIPCWrapper is responsible for reopening the same GPU memory across processes; EngineGroupInfo is responsible for telling the server how to group this memory by vLLM block id.",
        "This step sends the heavy information all at once, so that subsequent STORE/RETRIEVE can only pass the token span, cache key, and block ids."
      ],
      anchors: [["LMCache driven mode", "#Three - Who is actually moving data in the lmcache-driven mode"]]
    },
    server: {
      notes: [
        "The server will import the IPC handle and obtain a tensor view visible to its process, but the underlying memory still points to the worker's GPU memory.",
        "the server will perform format discovery again. This is not redundant work, but ensures that the imported view seen by the server is consistent with the client's assumptions.",
        "Finally, it establishes KVLayerGroupsManager, layout registry, data pointer tensor, and staging buffer. During the actual copy, these directly participate in kernel launch."
      ],
      anchors: [["Server registration", "#Eight - What does the server do after receiving register_kv_cache"]]
    },
    later: {
      notes: [
        "The block ids brought by subsequent requests are the engine group coordinates. In simple scenarios, this coordinate aligns perfectly with the unique kernel group, making it look straightforward.",
        "The server finds the registered GPUCacheContext based on instance_id and then applies the block ids to the layer tensors of group 0.",
        "No shape/stride/layout is passed here because the register phase has already solidified this important information into the context."
      ],
      anchors: [["How to reuse subsequent requests", "#Eleven - How to use this information after registration - store - retrieve"]]
    }
  },
  mla: {
    input: {
      notes: [
        "The key to MLA is not 'having two planes of K/V', but using latent/cache state to support attention. Its tensor may be rank-3 or may appear as a rank-4 single-head style view.",
        "sub-paged indicates that the underlying kernel uses smaller pages for computational efficiency. The vLLM scheduling layer may still treat multiple kernel pages as one larger logical block.",
        "the indexer is another type of auxiliary cache. It shares block-id semantics with the main MLA cache, but dtype, number of slots, and object layout may differ."
      ],
      anchors: [["Sub-paged MLA", "#2-sub-paged-mla"], ["MLA with indexer", "#4 - mla with indexer"]]
    },
    edit: {
      notes: [
        "The goal of re-view is to change the first dimension of the raw tensor from kernel-page coordinates to logical-block coordinates. For example, N*18 becomes N, indicating that 18 physical pages are combined into one logical page.",
        "This action does not copy bytes. It simply allows LMCache to see the complete logical block's payload at once when addressing by block ID.",
        "In the rank-4 variant, H may become 1, and C becomes H*C. Essentially, this collapses the head dimension into an opaque payload width, ensuring the total number of elements per page remains constant."
      ],
      anchors: [["Sub-paged attention explained dimension by dimension.", "#1-sub-paged-attention"], ["PR rank-3/rank-4", "#7 - pr-5042's sub-paged mla rank 3 - rank 4"]]
    },
    infos: {
      notes: [
        "The same engine_group_id can appear twice: one EngineGroupInfo for the main MLA cache and another EngineGroupInfo for the indexer cache.",
        "This is not a protocol repetition, but because they require different copy kernels / object layouts; the server will subsequently use the same engine group block IDs to drive two transfer paths.",
        "This also explains why the function name is in plural 'infos': the reason for returning a list includes multiple vLLM groups, multiple transfer identities, multiple object kinds, aux pools, and exclusions."
      ],
      anchors: [["Why is EngineGroupInfo a list?", "#Five - The second step of the client create_engine_group_infos_from_vllm is the translator for the entire chain"]]
    },
    payload: {
      notes: [
        "The payload will contain multiple IPC handles and multiple EngineGroupInfo items. Each info points to different subsets of the registered tensor list through layer_indices.",
        "The main MLA and indexer share the same engine_group_id, meaning subsequent addresses are taken from the same vLLM block-id list.",
        "However, their slots_per_block may differ, so the server must establish shape descriptors separately and cannot merge the two into one kernel group."
      ],
      anchors: [["Server consumption EngineGroupInfo", "#Nine - How does the server's kvlayergroupsmanager consume enginegroupinfo"]]
    },
    server: {
      notes: [
        "After server import, format discovery will be performed separately for the main cache and indexer. rank-3, rank-4, and rank-5 enter different EngineKVFormat branches.",
        "KVLayerGroupsManager will split by transfer identity. Any difference in dtype, head_size, slots_per_block, or engine_kv_format in the identity cannot share the same kernel group.",
        "The layout registry also needs to inform external caches that the same prefix requires storing/retrieving multiple objects; only restoring the main cache without restoring the indexer will disrupt the actual model operation."
      ],
      anchors: [["server group manager", "#Nine - How does the server's kvlayergroupsmanager consume enginegroupinfo"]]
    },
    later: {
      notes: [
        "After STORE/RETRIEVE receives group 0 block ids=[10], the server will expand this block ids for main MLA info and indexer info.",
        "The expanded copy plan has the same logical address but different page shapes, dtypes, and object layouts.",
        "This is why precise modeling is required in the register phase: the lighter the subsequent requests, the less ambiguous the semantics during registration."
      ],
      anchors: [["block ids expand", "#Eleven - How to use this information after registration - store - retrieve"]]
    }
  },
  hybrid: {
    input: {
      notes: [
        "In the Mamba-hybrid model, there are at least two types of caching semantics: attention is a token-by-token K/V page, while Mamba is a recurrent state snapshot.",
        "vLLM may require page_size_bytes alignment to allow different groups to enter the same page/block ledger; attention may enlarge the manager block here.",
        "The enlarged manager block will become the tokens_per_block of this cacheable group, so the LMCache chunk_size must also align accordingly; the default of 256 cannot accommodate a 544-token logical block.",
        "At the same time, models like Qwen/GLM may also have temporary groups with prefix_cacheable=false. They exist in the vLLM runtime but should not enter the LMCache prefix cache."
      ],
      anchors: [["Page size alignment.", "#First, add three terms: page-size, logical-block, physical-block"], ["Qwen/GLM scratch", "#6 - pr-5042's qwen38b - glm-scratch-group"]]
    },
    edit: {
      notes: [
        "The attention raw tensor still stores according to 32-token kernel pages, but before registration, it views 17 physical pages as a single 544-token logical block.",
        "Mamba's conv_state/ssm_state will be wrapped into a fixed-size opaque page, then mapped to the shape acceptable by the LMCache transfer kernel.",
        "If the final tokens_per_block is 544, the reusable prefix chunk in LMCache must cover at least one complete logical block; prefixes below one chunk will not become complete cross-request cache objects.",
        "Groups with prefix_cacheable=false do not perform format discovery, do not generate EngineGroupInfo, and will not participate in subsequent prefix store/retrieve."
      ],
      anchors: [["logical vs physical", "#First, add three terms: page-size, logical-block, physical-block"], ["Mamba state page", "#3-mamba-state-page"]]
    },
    infos: {
      notes: [
        "The attention EngineGroupInfo records tokens_per_block=544, indicating that the vLLM block id covers 544 token slots in this group.",
        "Mamba EngineGroupInfo records recurrent_state=true, indicating that the recovery semantics is a state snapshot, not an ordinary attention token window.",
        "scratch/aux temporary group does not have EngineGroupInfo. What is excluded here is the prefix-cacheable semantics of the group, not the deletion of a specific layer."
      ],
      anchors: [["recurrent-state field", "#5 - Parse sliding window and recurrent state information"]]
    },
    payload: {
      notes: [
        "Payload needs to describe both the attention tensor handle and Mamba packed state handle, along with their respective group metadata.",
        "Hints like BLNHC/BLHNC for block-first layout are crucial in the Mamba unified view, as the server needs to know which inner dimension should be treated as the token/state axis.",
        "The goal at this stage is to allow the server to reconstruct the transfer view without understanding vLLM private objects."
      ],
      anchors: [["Mamba unified view", "#8 - pr-5042's mamba unified view and blnhc - blhnc"]]
    },
    server: {
      notes: [
        "The server will create different object groups or different window descriptors for attention and Mamba state because their lifecycles and recovery semantics differ.",
        "Attention uses a token window; Mamba recurrent state is more like 'the last snapshot that can continue decoding.'",
        "This is also why it's easy to confuse scratch / cacheable / exclude: the register needs to clearly define whether each group is a regular token KV, recurrent state, or non-prefix-cacheable."
      ],
      anchors: [["layout descriptor", "#Ten - The server also needs to register layout-descriptor"]]
    },
    later: {
      notes: [
        "In subsequent requests, group0 attention=[10] and group1 mamba=[7] are both called block ids, but they have different meanings.",
        "The attention block id 10 points to a 544-token logical page; Mamba's block id 7 points to a state snapshot page.",
        "The server can distinguish because tokens_per_block, slots_per_block, recurrent_state, and object layout were already written into the context during registration."
      ],
      anchors: [["How to use after registration", "#Eleven - How to use this information after registration - store - retrieve"]]
    }
  }
};

const DEEP_ANIMS = {
  "config-slot": {
    kicker: "Supplemental Image A Animation",
    title: "How configuration, page, slot, and page_size_bytes are connected.",
    visual: "config",
    caption: "The key links of regular attention: vLLM spec provides block_size, worker tensor exposes slot dimensions, and LMCache calculates page bytes using dtype/head/KV plane.",
    steps: [
      {
        focus: "config",
        title: "First, check the configuration: block_size is the number of token slots",
        text: "A block_size=16 in KVCacheSpec indicates that a vLLM block manages 16 token positions. This is a scheduling semantic: the block table and prefix cache will slice tokens based on this unit.",
        bullets: ["block_size is not in bytes", "It determines how many token slots a logical page covers", "Under regular attention, logical blocks and tensor pages generally correspond one-to-one."],
        link: ["Jump to page/block explanation", "#First, add three terms: page-size, logical-block, physical-block"]
      },
      {
        focus: "slots",
        title: "Next, look at the page: a page contains a row of slots",
        text: "after selecting page 7 in the worker tensor's block/page dimension, there are 16 slots inside. Slot 0 corresponds to the first token in this block, and slot 15 corresponds to the last token.",
        bullets: ["slot is the offset within the page", "block id selects page", "the position of the token within the block selects the slot"]
      },
      {
        focus: "kv",
        title: "Each slot contains two vectors, K and V",
        text: "Each token slot in regular attention typically contains a K plane and a V plane. Each plane is further expanded by num_kv_heads and head_size.",
        bullets: ["Common shapes are [num_blocks, 2, block_size, num_heads, head_size]", "The 2 here is the K/V plane.", "heads and head_size determine the width of a single token"]
      },
      {
        focus: "bytes",
        title: "Page_size_bytes is the memory occupied by a whole page.",
        text: "Multiply the K/V plane, 16 slots, head count, head_size, and dtype_size together to get the bytes of a page. LMCache needs to know this ledger during registration so the server can find the correct byte range by block ID.",
        bullets: ["page_size_bytes = 2 * 16 * NH * HS * dtype_size", "Ultimately, STORE/RETRIEVE moves bytes.", "register connects token semantics with byte semantics."],
        link: ["Jump to server group", "#Nine - How does the server's kvlayergroupsmanager consume enginegroupinfo"]
      }
    ]
  },
  "mamba-state-page": {
    kicker: "Supplemental Image B Animation",
    title: "Attention page and Mamba state page are fundamentally different things",
    visual: "mamba-page",
    caption: "Attention page is a token-by-token KV table; Mamba page is a snapshot of the recurrent state. LMCache needs to abstract both into pages that can be transported by block id.",
    steps: [
      {
        focus: "attention",
        title: "Attention: a row of token slots",
        text: "The page of regular attention is like a table. Each token slot has its own K/V vector, so as the number of tokens increases, the page bytes increase linearly.",
        bullets: ["slot 0..15 corresponds to tokens within the block", "Each slot has K and V", "Suitable for description using token window."],
        link: ["Jump to regular attention", "#1 - Most Common - attention"]
      },
      {
        focus: "mamba",
        title: "Mamba: a state snapshot",
        text: "Mamba / recurrent layer does not save K/V rows for each historical token. It saves the state needed to continue decoding, such as conv_state and SSM state.",
        bullets: ["Not per token KV.", "A state page can represent the historical state needed to continue generation.", "Recovery feels more like retrieving the last valid snapshot"],
        link: ["Jump to Mamba state", "#3-mamba-state-page"]
      },
      {
        focus: "pack",
        title: "Before registration, pack multiple segments of state bytes into one page",
        text: "conv_state and ssm_state could originally be tensors of different shapes. To follow a unified transfer path, LMCache needs to see a fixed page: conv bytes | ssm bytes | padding.",
        bullets: ["Padding is used to fill in fixed page sizes.", "server does not need to understand the internal mathematical semantics of the state.", "As long as the byte-level round-trip is correct, that's sufficient"]
      },
      {
        focus: "view",
        title: "Finally, give it a transfer view.",
        text: "Mamba packed page will be viewed as a shape similar to [num_blocks, 2, block_size, 1, head_size]. Here, 2 and 1 are synthetic transfer axes, not real K/V and attention heads.",
        bullets: ["recurrent_state=true must be written into EngineGroupInfo.", "transfer view is a transport protocol, not a model semantics", "Subsequent block ids can locate the complete state page"],
        link: ["Jump to Mamba unified view", "#8 - pr-5042's mamba unified view and blnhc - blhnc"]
      }
    ]
  },
  "hybrid-align": {
    kicker: "Supplemental Image C Animation",
    title: "Why does Mamba-hybrid enlarge the attention logical block?",
    visual: "hybrid-align",
    caption: "What aligns is the page bytes ledger, not the requirement for attention and Mamba to cover the same number of tokens.",
    steps: [
      {
        focus: "kernel",
        title: "The attention kernel naturally uses 32-token physical pages.",
        text: "The underlying attention backend reads and writes in pages of 32 tokens for kernel efficiency. This page can be recorded as X bytes.",
        bullets: ["physical/kernel page = 32 token slots", "the kernel still works at its own granularity", "This X is in bytes, not the number of tokens."]
      },
      {
        focus: "mamba",
        title: "The bytes of the Mamba state page may be much larger.",
        text: "One page of Mamba is a state snapshot, with size determined by the conv/SSM state shape. It is assumed to be approximately equivalent to 17 attention kernel pages, or 17X bytes.",
        bullets: ["Mamba page size does not grow linearly with token slots", "state shape determines bytes", "the hybrid allocator needs to put it into the same ledger"]
      },
      {
        focus: "align",
        title: "vLLM aligns the page bytes of the manager block",
        text: "Attention can form a logical block by combining 17 32-token physical pages, making the attention logical page also become 17X bytes.",
        bullets: ["17 * 32 = 544 token slots", "Logical block is increasing.", "Physical kernel page has not changed."],
        link: ["Jump to logical/physical", "#First, add three terms: page-size, logical-block, physical-block"]
      },
      {
        focus: "register",
        title: "register needs to record the enlarged logical block.",
        text: "LMCache subsequently receives the vLLM block id. This block id belongs to the 544-token logical coordinate, so the raw tensor must be re-viewed into a logical page view before registration.",
        bullets: ["block id 10 cannot only point to the 10th 32-token physical page", "It should point to 17 consecutive physical pages", "LMCache chunk_size must also align with all cacheable groups"],
        link: ["Jump to sub-paged attention", "#1-sub-paged-attention"]
      }
    ]
  },
  "logical-physical": {
    kicker: "Supplemental Image D Animation",
    title: "Logical blocks and physical kernel pages are two coordinate systems.",
    visual: "logical-physical",
    caption: "This animation maps the block ID from the scheduler coordinates to the physical pages of the raw worker tensor.",
    steps: [
      {
        focus: "physical",
        title: "The first dimension of the raw tensor represents physical pages.",
        text: "pages 0, 1, 2... in the worker tensor are the kernel pages actually used by the attention backend. Each page has only 32 token slots.",
        bullets: ["Physical page is the granularity of underlying storage.", "It belongs to the tensor/kernel perspective", "The first dimension of raw does not necessarily equal the vLLM block id."]
      },
      {
        focus: "logical0",
        title: "Logical block 0 covers physical pages 0..16.",
        text: "When the vLLM manager block is 544 tokens, one logical block needs to be assembled from 17 32-token physical pages.",
        bullets: ["logical block 0 = pages 0..16", "This is the perspective of the scheduler/block table.", "LMCache STORE should move a complete 544 slots"]
      },
      {
        focus: "logical1",
        title: "Logical block 1 covers the next set of physical pages.",
        text: "Logical block 1 is not raw page 1, but physical pages 17..33. Directly using the block ID as the first dimension index will misalign.",
        bullets: ["logical block 1 = pages 17..33", "the ratio of block id to raw page id is 1:17", "The ratio comes from logical_block_size / kernel_page_size"]
      },
      {
        focus: "bridge",
        title: "re-view establishes a bridge between two coordinate systems.",
        text: "Before registration, view [N*17, 2, 32, H, C] as [N, 2, 544, 1, C'], which allows the first dimension of the tensor to become the logical block dimension again.",
        bullets: ["Does not copy bytes.", "What changes is the interpretation of shape/stride.", "Subsequent addressing by block id on the server will not be incorrect."],
        link: ["Jump to dimension-wise view", "#1-sub-paged-attention"]
      }
    ]
  },
  "shape-review": {
    kicker: "Supplemental Image E Animation",
    title: "Sub-paged attention re-view explains why each dimension changes this way.",
    visual: "shape-review",
    caption: "The constraint of this view is the conservation of the number of elements while returning the first dimension to the vLLM logical block coordinates.",
    steps: [
      {
        focus: "pages",
        title: "num_kernel_pages -> num_logical_blocks",
        text: "The original first dimension is physical/kernel pages. Since 17 physical pages make up a whole logical block, the first dimension changes from N*17 to N.",
        bullets: ["N = num_kernel_pages / 17", "Require num_kernel_pages to be divisible by 17", "The first dimension returns from kernel coordinates to vLLM block coordinates"]
      },
      {
        focus: "kv",
        title: "2 -> 2: Retain the KV-like axis of transfer",
        text: "This dimension retention is to ensure that the LMCache universal transfer kernel still sees a rank-5 shape with kv_size=2.",
        bullets: ["This cannot necessarily be interpreted as a pure K plane / pure V plane.", "It is the transfer-compatible axis", "The key is that the byte range can round-trip"]
      },
      {
        focus: "slots",
        title: "32 -> 544: slot dimensions combined",
        text: "Each physical page has 32 slots, and 17 pages together make 544 slots. LMCache needs to see the complete 544 slots when moving by block id later.",
        bullets: ["17 * 32 = 544", "slot dimension expresses the coverage of the logical block", "This step corrects the mapping of block id to byte range"]
      },
      {
        focus: "head",
        title: "H -> 1: head dimension collapses into opaque payload",
        text: "This view is not for LMCache to understand each attention head, but to turn the entire page of bytes into a portable payload. Therefore, one synthetic head can be used.",
        bullets: ["H is no longer expanded as a semantic head", "server does not perform content-aware attention calculations.", "The transport protocol only requires a stable page layout."]
      },
      {
        focus: "width",
        title: "C -> C': Restore the number of elements",
        text: "After H is collapsed, the original H*C content enters the new trailing width. The actual code will calculate C' based on page_size_bytes / element_size / (2 * 544 * 1) to ensure the total number of elements per page is aligned.",
        bullets: ["Element count conservation", "bytes do not move", "C' is the transfer payload width"],
        link: ["Jump to dimension-wise table", "#1-sub-paged-attention"]
      }
    ]
  },
  "group-info": {
    kicker: "Figure 2 Animation",
    title: "how create_engine_group_infos_from_vllm merges two types of facts",
    visual: "group-info",
    caption: "EngineGroupInfo is not a simple copy of the vLLM group, but a composite result of vLLM scheduling semantics and the real tensor transfer identity.",
    steps: [
      {
        focus: "metadata",
        title: "First, obtain vLLM metadata: who shares the block-id address space",
        text: "The kv_cache_groups in KVCacheConfig inform LMCache which layers belong to the same engine group and what the block_size/prefix_cacheable/window/recurrent semantics are for each group.",
        bullets: ["This is the scheduling semantics.", "Indicate which layers should use the block id in the response", "Does not answer the real layout of the tensor."],
        link: ["Jump to the beginning of the function", "#Five - The second step of the client create_engine_group_infos_from_vllm is the translator for the entire chain"]
      },
      {
        focus: "tensor",
        title: "Next, examine the actual tensor: can it share the same transfer kernel?",
        text: "LMCache performs format discovery on registered tensors to obtain kv_size, num_heads, head_size, slots_per_block, dtype, and engine_kv_format.",
        bullets: ["This is the semantic of physical transport.", "There may also be different layouts within the same vLLM group", "the indexer/main cache will separate here"]
      },
      {
        focus: "exclude",
        title: "Groups with prefix_cacheable=false do not generate info.",
        text: "Non-prefix-cacheable groups are runtime temporary states that do not belong to reusable prefix KV. They will not participate in format discovery and will not appear in the EngineGroupInfo list.",
        bullets: ["tokens_per_block=0 is an exclusion signal", "Avoid scratch ring disrupting chunk alignment.", "Avoid meaningless layouts causing registration failures."],
        link: ["Jump to scratch section", "#6 - pr-5042's qwen38b - glm-scratch-group"]
      },
      {
        focus: "identity",
        title: "Cut again by physical transfer identity.",
        text: "Even if the engine_group_id is the same, as long as dtype/layout/slots/head_size differ, they must be split into different EngineGroupInfo. Conversely, alias layers without independent KV owners will remain excluded.",
        bullets: ["engine_group_id retains block-id coordinates", "Layer indices point to the registered tensor list.", "tokens_per_block connects the token prefix and the GPU page"],
        link: ["Jump to identity field", "#7 - Finally cut once more by physical transfer identity"]
      },
      {
        focus: "output",
        title: "Output list[EngineGroupInfo]",
        text: "The final returned list is because the real model may have multiple vLLM groups, multiple layout/object kinds, CacheBlend aux pools, and may also exclude certain groups.",
        bullets: ["infos in plural represent the true form of the protocol", "The server will build kernel groups based on this list.", "The block ids of STORE/RETRIEVE will be expanded by engine_group_id."],
        link: ["Jump to expand block ids", "#Eleven - How to use this information after registration - store - retrieve"]
      }
    ]
  },
  "model-cases": {
    kicker: "Figure 3 Animation",
    title: "Where each model case is special when entering register_kv_cache.",
    visual: "model-cases",
    caption: "These model differences may seem numerous, but the register ultimately needs to answer the same set of questions: is it cacheable, how to interpret the block ID, how to move the tensor page, how to group on the server.",
    steps: [
      {
        focus: "simple",
        title: "Regular attention: one block one page.",
        text: "This is the easiest baseline to understand. tokens_per_block == slots_per_block, layout rules, usually one vLLM engine group generates one EngineGroupInfo.",
        bullets: ["Does not require re-view.", "block id directly locates the tensor page", "The server creates a standard token-window object group."],
        link: ["Jump to regular attention", "#1 - Most Common - attention"]
      },
      {
        focus: "mla",
        title: "Regular MLA: different formats, but not necessarily compressed token slots.",
        text: "MLA may be a rank-3 key-only / latent-state cache. It is not an ordinary K/V plane, but if tokens_per_block == slots_per_block, it is just a different format.",
        bullets: ["kv_size is often 1", "Num_heads can be unified to 1.", "head_size is the latent/state width"],
        link: ["Jump to regular MLA", "#2 - Common - mla"]
      },
      {
        focus: "indexer",
        title: "MLA with indexer: same block coordinates, multiple physical objects",
        text: "The main MLA cache and indexer may share engine_group_id, but dtype, slots_per_block, and object layout are different, so they need to be split into multiple EngineGroupInfo entries.",
        bullets: ["The main cache and indexer must hit the same.", "But the transfer kernel cannot be merged.", "Both infos can reuse the same block IDs."],
        link: ["Jump to indexer", "#4 - mla with indexer"]
      },
      {
        focus: "deepseek",
        title: "DeepSeek-V3.2 fp8_ds_mla: Be careful not to confuse byte compression with slot compression",
        text: "fp8_ds_mla is more like bytes per slot decreasing, rather than multiple logical tokens sharing one slot. The register needs to look at the relationship between real slots_per_block and tokens_per_block.",
        bullets: ["slot compression and dtype bytes changes should be separated", "compress_ratio should not be guessed by name", "shape/dtype descriptor is more reliable"],
        link: ["Jump to DeepSeek-V3.2", "#3 - deepseek-v32 - this type of fp8_ds_mla"]
      },
      {
        focus: "multi",
        title: "DeepSeek-V4 / Multi backbone: multiple groups and alias layers",
        text: "Future more complex models may have full attention, sliding-window, compressed MLA, indexer, multiple backbones, and cross-layer KV sharing. Registration cannot assume the entire model has only one block size.",
        bullets: ["Tokens_per_block may differ for each group", "The alias layer should not be registered again.", "Object groups/window descriptors need to be separated."],
        link: ["Jump to multiple groups", "#5 - deepseek-v4 and other multi-backbone - multi-group structures"]
      },
      {
        focus: "scratch",
        title: "Qwen/GLM scratch: prefix_cacheable=false should be excluded.",
        text: "Temporary groups like QSA ring / kpool tail are not prefix KVs that can be reused across requests. They should be excluded from the register path, rather than being spread around as scratch layer terminology.",
        bullets: ["A more unified term is non-prefix-cacheable group.", "Does not participate in format discovery.", "Does not generate EngineGroupInfo."],
        link: ["Jump to scratch group", "#6 - pr-5042's qwen38b - glm-scratch-group"]
      },
      {
        focus: "mamba",
        title: "Mamba hybrid: state snapshot and attention page coexist",
        text: "Mamba state page is a recurrent snapshot; attention may be aligned to page size and enlarged into a 544-token logical block. Registration must separately record the ordinary token window and recurrent_state.",
        bullets: ["Attention performs sub-paged re-view.", "Mamba does an opaque page view.", "BLNHC/BLHNC hints need to be accepted"],
        link: ["Jump to Mamba unified view", "#8 - pr-5042's mamba unified view and blnhc - blhnc"]
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
    makeEl("p", "knowledge-kicker", "Knowledge map"),
    makeEl("h2", "", "First, piece together the basic concept of register_kv_cache"),
    makeEl("p", "knowledge-lead", "Click on a concept to see why it exists in the registration phase, what information it carries, and how it connects with other concepts.")
  );

  const tour = makeEl("div", "knowledge-tour");
  const prev = makeEl("button", "knowledge-icon-button", "‹");
  prev.type = "button";
  prev.setAttribute("aria-label", "Previous concept");
  const next = makeEl("button", "knowledge-icon-button", "›");
  next.type = "button";
  next.setAttribute("aria-label", "Next concept");
  tour.append(prev, makeEl("span", "", "Browse in registration order."), next);
  header.append(titleWrap, tour);

  const phaseTabs = makeEl("div", "knowledge-tabs");
  const allButton = makeEl("button", "knowledge-tab is-active", "All");
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
    remember.append(makeEl("h3", "", "First, remember"), makeEl("p", "", node.remember));
    const why = makeEl("section", "knowledge-detail__section");
    why.append(makeEl("h3", "", "register Why is it necessary?"), makeEl("p", "", node.why));
    const fields = makeEl("section", "knowledge-detail__section");
    fields.append(makeEl("h3", "", "The information carried"), fieldList);
    const deep = makeEl("section", "knowledge-detail__section");
    deep.append(makeEl("h3", "", "Expand specifically"), deepList);
    const links = makeEl("section", "knowledge-detail__section");
    links.append(makeEl("h3", "", "Related concepts"), relatedList);
    const anchors = makeEl("section", "knowledge-detail__section");
    anchors.append(makeEl("h3", "", "Details will follow"), anchorList);

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
    makeEl("p", "scenario-kicker", "Interaction process."),
    makeEl("h2", "", "Walk through register_kv_cache according to the scenario."),
    makeEl("p", "scenario-lead", "Choosing simple / MLA / hybrid will change the flowchart, the information carried at each step, and the registration results on the server side.")
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
    noteSection.append(makeEl("h4", "", "What exactly is this step doing"), noteList);
    const linkSection = makeEl("section", "scenario-detail__section");
    linkSection.append(makeEl("h4", "", "Jump to detailed explanation later"), anchorList);

    detail.replaceChildren(
      makeEl("p", "scenario-detail__kicker", scenario.label),
      makeEl("h3", "", stage.title),
      makeEl("p", "scenario-detail__copy", stage.copy),
      noteSection,
      makeEl("h4", "", "Click to view the information carried"),
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
  attention.append(makeEl("strong", "", "Attention page"), renderMiniSlots(8, focus === "attention" ? 8 : 3, "deep-slots--compact"), makeEl("em", "", "Each token slot has K/V"));

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
    makeEl("em", "", "Not per token KV, but a recurrent snapshot.")
  );

  const view = makeEl("div", "deep-card deep-card--wide");
  view.classList.toggle("is-active", focus === "view");
  view.append(makeEl("strong", "", "LMCache transfer view"), makeCode("[num_blocks, 2, block_size, 1, head_size]"), makeEl("em", "", "2 and 1 are synthetic transfer axes"));
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
    ["pages", "num_kernel_pages", "num_logical_blocks", "17 physical pages combine to form 1 logical block"],
    ["kv", "2", "2", "Retain KV-like transfer axis"],
    ["slots", "32", "544", "17 * 32 slots form a logical block"],
    ["head", "H", "1", "Real head dimensions folded into synthetic head"],
    ["width", "C", "C'", "Fill in the number of elements of H*C into the payload width."]
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
  equation.textContent = "Element conservation: N*17*2*32*H*C = N*2*544*1*C'";
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
    ["simple", "Regular attention", "tokens == slots"],
    ["mla", "Regular MLA", "rank-3 / key-only"],
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
  equation.textContent = `register question: ${active[1]} -> Can it be cached? How to interpret block id? How many EngineGroupInfo are needed?`;
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
  prev.setAttribute("aria-label", "Previous step");
  const play = makeEl("button", "deep-anim__button", "▶");
  play.type = "button";
  play.setAttribute("aria-label", "Play");
  const next = makeEl("button", "deep-anim__button", "›");
  next.type = "button";
  next.setAttribute("aria-label", "Next step");
  const dots = makeEl("div", "deep-anim__dots");
  anim.steps.forEach((_, index) => {
    const dot = makeEl("button", "deep-anim__dot");
    dot.type = "button";
    dot.dataset.dot = String(index);
    dot.setAttribute("aria-label", `Jump to step ${index + 1}`);
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
    play.setAttribute("aria-label", "Play");
  };
  const start = () => {
    if (reducedMotion || timer) {
      return;
    }
    timer = window.setInterval(() => go(stepIndex + 1), AUTOPLAY_MS);
    play.textContent = "Ⅱ";
    play.setAttribute("aria-label", "Pause");
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
