const copy = {
  zh: {
    nodes: {
      coord: ["目录 / DIRECTORY", "Coordinator", "保存 instance_id、IP、RPC 端口与 P2P advertise URL"],
      ac: ["请求方 / NODE A", "P2P Adapter + Controller", "发现 peer，发送查询，管理 remote address 与超时"],
      am: ["请求方 / NODE A", "Local DRAM L1", "为读回的 KV 准备本地共享内存对象"],
      bc: ["拥有者 / NODE B", "Request Server + Controller", "查询本地 L1、加锁、返回 offset/size、解锁"],
      bm: ["拥有者 / NODE B", "Registered DRAM L1", "整块区域注册给 NIXL；真正的 KV bytes 在这里"]
    },
    controls: { prev: "← 上一步", play: "▶ 自动播放", pause: "Ⅱ 暂停", next: "下一步 →", step: "步骤" },
    scenes: [
      ["启动注册", "节点启动后把本地 DRAM L1 注册给 NIXL，并把 RPC 地址与 P2P advertise URL 登记到 Coordinator。目录只保存地址，不保存 KV。", "directory", "register(instance metadata)", "ac", "coord"],
      ["发现 Peer", "Node A 周期性 GET /instances，看到 Node B 后创建一个 P2PL2Adapter。这个 adapter 把 B 当作只读的远程 L2。", "directory", "GET /instances", "coord", "ac"],
      ["建立数据通道", "Adapter 构造时连接 B 的 NIXL handshake 服务：交换 agent metadata 与整块 L1 的 transfer descriptors，准备可复用的 remote handle。这里交换的是元数据，不是 KV。", "control", "InitReq → MemRegReq", "ac", "bc"],
      ["查询并加锁", "A 经 ZMQ 或 gRPC 发送 p2p_lookup_and_lock(keys, layouts)。B 只查本地 DRAM L1；命中的对象被 read-lock，防止读到一半被回收。", "control", "lookup_and_lock(keys)", "ac", "bc"],
      ["返回地址", "A 轮询 p2p_query_lookup_results(task_id)。B 把命中对象映射成 TransferChannelAddress(offset, size)；miss 使用无效地址。返回的是坐标，不是 KV bytes。", "control", "[(offset, size), …]", "bc", "ac"],
      ["直接读取 KV", "A 为本地对象生成地址，调用 NIXL submit_read。KV payload 从 B 的已注册 L1 直接进入 A 的 L1，不经过 Coordinator，也不塞进 RPC response。", "data", "NIXL READ · KV bytes", "bm", "am"],
      ["解锁", "读取完成后，A 调用 p2p_unlock_objects(keys)。B 释放 read lock；A 同时丢弃这些 key 对应的 remote address。", "control", "unlock(keys)", "ac", "bc"],
      ["写入并不走 P2P", "当前 P2P adapter 是只读的。submit_store_task 立即返回 0-byte success；真正写入某节点 L1 的，是该节点自己的正常 STORE / inference 路径。", "none", "read-only adapter", "am", "am"]
    ]
  },
  en: {
    nodes: {
      coord: ["DIRECTORY", "Coordinator", "Stores instance IDs, IPs, RPC ports, and P2P advertise URLs"],
      ac: ["REQUESTER / NODE A", "P2P Adapter + Controller", "Discovers peers, issues lookups, tracks remote addresses and timeouts"],
      am: ["REQUESTER / NODE A", "Local DRAM L1", "Provides local shared-memory objects that receive copied KV"],
      bc: ["OWNER / NODE B", "Request Server + Controller", "Looks up local L1, locks hits, returns offsets and unlocks"],
      bm: ["OWNER / NODE B", "Registered DRAM L1", "The whole region is registered with NIXL; the KV bytes live here"]
    },
    controls: { prev: "← Previous", play: "▶ Auto play", pause: "Ⅱ Pause", next: "Next →", step: "Step" },
    scenes: [
      ["Start and register", "Each node registers its local DRAM L1 with NIXL, then publishes its RPC address and P2P advertise URL to the Coordinator. The directory stores locations, not KV bytes.", "directory", "register(instance metadata)", "ac", "coord"],
      ["Discover peers", "Node A periodically GETs /instances. When it sees Node B, it creates a P2PL2Adapter and treats B as a read-only remote L2.", "directory", "GET /instances", "coord", "ac"],
      ["Establish the data channel", "During adapter construction A connects to B's NIXL handshake service, exchanges agent metadata and whole-L1 transfer descriptors, and prepares a reusable remote handle. This is metadata, not KV payload.", "control", "InitReq → MemRegReq", "ac", "bc"],
      ["Lookup and lock", "A sends p2p_lookup_and_lock(keys, layouts) over ZMQ or gRPC. B checks only its local DRAM L1 and read-locks hits so they cannot be reclaimed mid-transfer.", "control", "lookup_and_lock(keys)", "ac", "bc"],
      ["Return addresses", "A polls p2p_query_lookup_results(task_id). B maps hits to TransferChannelAddress(offset, size); misses use an invalid address. These are coordinates, not KV bytes.", "control", "[(offset, size), …]", "bc", "ac"],
      ["Read KV directly", "A turns its destination objects into local addresses and calls NIXL submit_read. The KV payload moves from B's registered L1 into A's L1 without passing through the Coordinator or an RPC response.", "data", "NIXL READ · KV bytes", "bm", "am"],
      ["Unlock", "After the read completes A calls p2p_unlock_objects(keys). B releases the read locks, while A drops the cached remote addresses for those keys.", "control", "unlock(keys)", "ac", "bc"],
      ["Writes do not use P2P", "The current P2P adapter is read-only. submit_store_task immediately reports a zero-byte success; a node's normal STORE or inference path is what populates its local L1.", "none", "read-only adapter", "am", "am"]
    ]
  }
};

const nodeClass = {
  coord: "p2p-node--coord",
  ac: "p2p-node--a-controller",
  am: "p2p-node--a-memory",
  bc: "p2p-node--b-controller",
  bm: "p2p-node--b-memory"
};

const centers = {
  coord: [50, 16],
  ac: [16, 51],
  am: [18, 83],
  bc: [84, 51],
  bm: [82, 83]
};

function nodeMarkup(key, value) {
  const [eyebrow, title, body] = value;
  return `<div class="p2p-node ${nodeClass[key]}" data-node="${key}"><small>${eyebrow}</small><strong>${title}</strong><span>${body}</span></div>`;
}

function stageMarkup(lang) {
  const t = copy[lang];
  return `
    <div class="p2p-stage__header">
      <div><h3>${lang === "zh" ? "把一次 P2P 命中慢放八倍" : "Slow one P2P hit down into eight steps"}</h3><p>${lang === "zh" ? "虚线是目录或控制消息；实线是 KV payload。" : "Dashed lines carry directory/control messages; the solid line carries KV payload."}</p></div>
      <div class="p2p-legend"><span class="directory"><i></i>${lang === "zh" ? "目录" : "Directory"}</span><span class="control"><i></i>${lang === "zh" ? "控制面" : "Control"}</span><span class="data"><i></i>${lang === "zh" ? "数据面" : "Data"}</span></div>
    </div>
    <div class="p2p-stage__board">
      <svg class="p2p-stage__rail" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
        <path class="p2p-rail p2p-rail--directory" data-rail="directory" d="M190 270 C240 145 380 110 500 85 M810 270 C760 145 620 110 500 85" />
        <path class="p2p-rail p2p-rail--control" data-rail="control" d="M210 290 C390 215 610 215 790 290" />
        <path class="p2p-rail p2p-rail--data" data-rail="data" d="M790 430 C610 500 390 500 210 430" />
      </svg>
      <div class="p2p-stage__nodes">${Object.entries(t.nodes).map(([key, value]) => nodeMarkup(key, value)).join("")}</div>
      <div class="p2p-packet" data-packet></div>
    </div>
    <div class="p2p-stage__caption" aria-live="polite">
      <div class="p2p-stage__step" data-step-label></div>
      <div class="p2p-stage__copy"><strong data-step-title></strong><p data-step-body></p></div>
    </div>
    <div class="p2p-controls">
      <button type="button" data-action="prev">${t.controls.prev}</button>
      <button type="button" data-action="play" aria-pressed="false">${t.controls.play}</button>
      <button type="button" data-action="next">${t.controls.next}</button>
      <span class="p2p-controls__spacer"></span>
      <span data-step-buttons></span>
    </div>`;
}

function initStage(root) {
  const lang = root.dataset.lang === "en" ? "en" : "zh";
  const t = copy[lang];
  root.innerHTML = stageMarkup(lang);
  let index = 0;
  let timer = null;
  const packet = root.querySelector("[data-packet]");
  const play = root.querySelector('[data-action="play"]');
  const stepButtons = root.querySelector("[data-step-buttons]");

  t.scenes.forEach((scene, sceneIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(sceneIndex + 1);
    button.title = scene[0];
    button.setAttribute("aria-label", `${t.controls.step} ${sceneIndex + 1}: ${scene[0]}`);
    button.addEventListener("click", () => {
      stop();
      render(sceneIndex, true);
    });
    stepButtons.append(button);
  });

  function animatePacket(scene) {
    const [, , plane, label, from, to] = scene;
    packet.className = "p2p-packet";
    if (plane === "none") return;
    packet.textContent = label;
    packet.classList.toggle("is-data", plane === "data");
    packet.classList.toggle("is-directory", plane === "directory");
    packet.style.setProperty("--from-x", `${centers[from][0]}%`);
    packet.style.setProperty("--from-y", `${centers[from][1]}%`);
    packet.style.setProperty("--to-x", `${centers[to][0]}%`);
    packet.style.setProperty("--to-y", `${centers[to][1]}%`);
    void packet.offsetWidth;
    packet.classList.add("is-moving");
  }

  function render(next, animate = true) {
    index = (next + t.scenes.length) % t.scenes.length;
    const scene = t.scenes[index];
    root.querySelector("[data-step-label]").textContent = `${t.controls.step} ${index + 1}/${t.scenes.length}`;
    root.querySelector("[data-step-title]").textContent = scene[0];
    root.querySelector("[data-step-body]").textContent = scene[1];
    root.querySelectorAll("[data-node]").forEach((node) => node.classList.toggle("is-active", node.dataset.node === scene[4] || node.dataset.node === scene[5]));
    root.querySelectorAll("[data-rail]").forEach((rail) => rail.classList.toggle("is-active", rail.dataset.rail === scene[2]));
    [...stepButtons.children].forEach((button, buttonIndex) => button.classList.toggle("is-current", buttonIndex === index));
    if (animate) animatePacket(scene);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    play.setAttribute("aria-pressed", "false");
    play.textContent = t.controls.play;
  }

  function start() {
    stop();
    play.setAttribute("aria-pressed", "true");
    play.textContent = t.controls.pause;
    timer = window.setInterval(() => render(index + 1, true), 3600);
  }

  root.querySelector('[data-action="prev"]').addEventListener("click", () => { stop(); render(index - 1, true); });
  root.querySelector('[data-action="next"]').addEventListener("click", () => { stop(); render(index + 1, true); });
  play.addEventListener("click", () => timer ? stop() : start());
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  render(0, false);
}

function initAuthMap(root) {
  const buttons = root.querySelectorAll("[data-auth-filter]");
  const cards = root.querySelectorAll("[data-auth]");
  buttons.forEach((button) => button.addEventListener("click", () => {
    const filter = button.dataset.authFilter;
    buttons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    cards.forEach((card) => {
      const match = filter === "all" || card.dataset.auth === filter;
      card.classList.toggle("is-dimmed", !match);
      card.classList.toggle("is-highlighted", match && filter !== "all");
    });
  }));
}

document.querySelectorAll("[data-p2p-stage]").forEach(initStage);
document.querySelectorAll("[data-p2p-auth-map]").forEach(initAuthMap);
