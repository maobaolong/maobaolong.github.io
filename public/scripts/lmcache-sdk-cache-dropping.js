const q = (root, selector) => root.querySelector(selector);
const qa = (root, selector) => [...root.querySelectorAll(selector)];

function button(label, extra = "") {
  return `<button type="button" class="sdk-btn ${extra}">${label}</button>`;
}

function initKvLab(root) {
  root.classList.add("sdk-lab");
  root.innerHTML = `
    <div class="sdk-lab__head">
      <div>
        <p class="sdk-lab__kicker">Interactive · KV anatomy</p>
        <h3>“保留一半 KV”是沿 token 维度选择位置</h3>
        <p class="sdk-lab__copy">同一选择会应用到 token IDs，以及每一层的 K 和 V。</p>
      </div>
      <div class="sdk-controls">
        <button type="button" class="sdk-btn is-active" aria-pressed="true" data-mode="original">原始 KV</button>
        <button type="button" class="sdk-btn" aria-pressed="false" data-mode="half">保留一半</button>
      </div>
    </div>
    <div class="sdk-kv-summary">
      <div class="sdk-kv-stat"><span>完整 chunks</span><strong data-chunks>8</strong></div>
      <div class="sdk-kv-stat"><span>KV token positions</span><strong data-tokens>2048</strong></div>
      <div class="sdk-kv-stat"><span>示意保留率</span><strong data-ratio>100%</strong></div>
    </div>
    <div class="sdk-kv-axes">
      <div class="sdk-kv-axis-label">token IDs</div>
      <div class="sdk-kv-chunks" data-token-chunks></div>
      <div class="sdk-kv-axis-label">K · all layers</div>
      <div class="sdk-kv-layers" data-k-layers></div>
      <div class="sdk-kv-axis-label">V · all layers</div>
      <div class="sdk-kv-layers" data-v-layers></div>
    </div>
    <p class="sdk-lab__note" data-kv-note>原始 KV：8 个完整 chunk，每个 256 token，共 2048 个 token 位置。K 和 V 在所有 layer 上都有对应切片。</p>`;

  const tokenRow = q(root, "[data-token-chunks]");
  tokenRow.innerHTML = Array.from({ length: 8 }, (_, i) =>
    `<div class="sdk-kv-chunk" data-index="${i}">chunk ${i}<small>256 tokens</small></div>`
  ).join("");
  const layerMarkup = Array.from({ length: 3 }, () =>
    `<div class="sdk-kv-layer">${Array.from({ length: 8 }, (_, i) => `<i data-index="${i}"></i>`).join("")}</div>`
  ).join("");
  q(root, "[data-k-layers]").innerHTML = layerMarkup;
  q(root, "[data-v-layers]").innerHTML = layerMarkup;

  function render(mode) {
    const dropped = mode === "half";
    const keep = new Set([0, 1, 6, 7]);
    qa(root, "[data-index]").forEach((el) => {
      const isKept = keep.has(Number(el.dataset.index));
      el.classList.toggle("is-kept", dropped && isKept);
      el.classList.toggle("is-dropped", dropped && !isKept);
    });
    q(root, "[data-chunks]").textContent = dropped ? "4" : "8";
    q(root, "[data-tokens]").textContent = dropped ? "1024" : "2048";
    q(root, "[data-ratio]").textContent = dropped ? "50%" : "100%";
    q(root, "[data-kv-note]").textContent = dropped
      ? "压缩后：保留 chunk 0、1、6、7；中间 chunk 2–5 被删除。token IDs、每层 K、每层 V 使用同一个 keep_idx。最后一段 Key 还要从旧 RoPE 位置重映射到新位置。"
      : "原始 KV：8 个完整 chunk，每个 256 token，共 2048 个 token 位置。K 和 V 在所有 layer 上都有对应切片。";
    qa(root, "[data-mode]").forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
  qa(root, "[data-mode]").forEach((btn) => btn.addEventListener("click", () => render(btn.dataset.mode)));
}

function initTopology(root) {
  root.classList.add("sdk-lab");
  root.innerHTML = `
    <div class="sdk-lab__head">
      <div><p class="sdk-lab__kicker">Animated topology</p><h3>三个进程，三组不同通信</h3><p class="sdk-lab__copy">重播后按顺序观察 HTTP、控制面和 KV 数据面。</p></div>
      <div class="sdk-controls">${button("重播数据流", "is-active")}</div>
    </div>
    <div class="sdk-topology-grid">
      <article class="sdk-process sdk-process--vllm"><span class="sdk-process__role">Process A · GPU</span><h4>vLLM</h4><ul><li>Prefill / Decode</li><li>注册 GPU KV layout</li><li>LMCacheMPConnector</li></ul></article>
      <article class="sdk-process sdk-process--server"><span class="sdk-process__role">Process B · Service</span><h4>LMCache MP Server</h4><ul><li>Lookup / chunk index</li><li>L1 pool / sessions</li><li>LMCache-driven + Engine-driven</li></ul></article>
      <article class="sdk-process sdk-process--sdk"><span class="sdk-process__role">Process C · CPU</span><h4>SDK / Notebook</h4><ul><li>调用 vLLM HTTP</li><li>Retrieve / Drop / Store</li><li>编排多条 RequestStream</li></ul></article>
    </div>
    <div class="sdk-channel-list">
      <div class="sdk-channel sdk-channel--http"><i></i><span><strong>SDK ↔ vLLM：</strong>HTTP <code>/v1/completions</code> + SSE token stream</span></div>
      <div class="sdk-channel"><i></i><span><strong>SDK ↔ Server 控制面：</strong>HTTP <code>/config</code>、<code>/status</code>；ZMQ/gRPC LOOKUP、status、prepare/commit、end session</span></div>
      <div class="sdk-channel sdk-channel--data"><i></i><span><strong>SDK ↔ Server 数据面：</strong>Engine-driven POSIX SHM，或 inline tensor codec</span></div>
      <div class="sdk-channel sdk-channel--data"><i></i><span><strong>vLLM ↔ Server：</strong>LMCache-driven GPU KV transfer</span></div>
    </div>
    <span class="sdk-packet sdk-packet--http" aria-hidden="true"></span><span class="sdk-packet sdk-packet--control" aria-hidden="true"></span><span class="sdk-packet sdk-packet--data" aria-hidden="true"></span>
    <p class="sdk-lab__note">关键区别：request transport 决定控制消息怎么发；data plane 决定 KV bytes 怎么搬。两者不是同一个开关。</p>`;
  const replay = q(root, "button");
  const run = () => {
    root.classList.remove("is-running");
    void root.offsetWidth;
    root.classList.add("is-running");
  };
  replay.addEventListener("click", run);
  run();
}

const sequenceSteps = [
  { title: "创建 RequestStream", from: "SDK", to: "SDK", message: "保存原始 prompt token IDs", detail: "LMCacheSDKContext 只负责 retrieve/store；RequestStream 保存跨多次 completion 的逻辑状态。", state: ["tokens = original_prompt", "suffix = []", "output history = []"] },
  { title: "发起 1-token Prefill", from: "SDK", to: "vLLM", message: "POST /v1/completions · max_tokens=1", detail: "SDK 使用 HTTP SSE 等待生成流结束。这个请求驱动 vLLM forward 与 connector store。", state: ["HTTP stream = open", "vLLM forward = running", "SDK thread = blocked on SSE"] },
  { title: "保存原始 KV", from: "vLLM", to: "LMCache", message: "LMCache-driven STORE", detail: "vLLM connector 按完整 chunk 把 Prompt KV 保存到 LMCache Server；不足一个 chunk 的尾部不属于可取回 prefix。", state: ["server has chunk-aligned KV", "logical tokens may be longer", "layout came from vLLM registration"] },
  { title: "Prefill 请求结束", from: "vLLM", to: "SDK", message: "SSE token + [DONE]", detail: "SDK 收到生成 token 并等待 HTTP 流结束。结束并不保证外部 KV 已经在同一时刻完全可 retrieve。", state: ["generated token appended", "batch.prefill() returns", "next Python line can run"] },
  { title: "主动执行 Modify", from: "SDK", to: "LMCache", message: "LOOKUP(token IDs)", detail: "没有 Server push callback。Notebook 显式调用 batch.modify()，每条 stream 在 ThreadPool 中开始 retrieve。", state: ["request_id = retrieve-...", "aligned_end = floor(n/chunk)×chunk", "LOOKUP submitted"] },
  { title: "等待 Lookup/Prefetch", from: "SDK", to: "LMCache", message: "QUERY_PREFETCH_STATUS", detail: "内层默认每 10ms 查询一次状态；如果完整 retrieve 返回 None，RequestStream 外层默认每 200ms 重试。", state: ["inner poll = 10ms", "outer retry = 200ms", "server does not push notification"] },
  { title: "搬回连续 CPU Tensor", from: "LMCache", to: "SDK", message: "prepare_retrieve → SHM/inline → commit", detail: "SHM 模式从 slot tensors 拼接；inline 模式解码 chunks。最终得到 [2,L,T,D]。", state: ["cached_len = tensor.shape[2]", "suffix = tokens[cached_len:]", "tensor is CPU contiguous"] },
  { title: "计算 keep_idx 并压缩", from: "SDK", to: "SDK", message: "drop function(new_kv, new_tokens)", detail: "同一个 keep_idx 同步作用于 token IDs 和所有 layer 的 K/V；删除中间位置时还要修正 Key 的 RoPE。", state: ["len(new_tokens) = new_kv.shape[2]", "K/V mapping preserved", "positions compacted"] },
  { title: "写回压缩 KV", from: "SDK", to: "LMCache", message: "prepare_store → copy/chunks → commit", detail: "Server 以新 token chunks 建立新的 cache objects；RequestStream live tokens 被替换为压缩后的 tokens。", state: ["new compact prefix cached", "live tokens = new_tokens", "suffix kept separately"] },
  { title: "补 suffix 后继续 Decode", from: "SDK", to: "vLLM", message: "compressed tokens + suffix → completion", detail: "vLLM 命中压缩前缀，只为 suffix 与新生成 token 继续计算 KV，然后进入长 Decode。", state: ["pending suffix appended once", "LMCache hit on compact prefix", "new tokens stream back to SDK"] }
];

function initSequence(root) {
  root.classList.add("sdk-lab");
  root.innerHTML = `
    <div class="sdk-lab__head"><div><p class="sdk-lab__kicker">Step by step</p><h3>一条请求的十步生命周期</h3><p class="sdk-lab__copy">点左侧步骤；右侧同时显示通信方向、消息和 RequestStream 状态。</p></div><div class="sdk-controls"><button type="button" class="sdk-btn" data-prev>上一步</button><button type="button" class="sdk-btn is-active" data-next>下一步</button></div></div>
    <div class="sdk-sequence-grid"><div class="sdk-step-list" data-step-list></div><div class="sdk-step-stage" aria-live="polite"><p class="sdk-lab__kicker" data-step-number></p><h3 data-step-title></h3><p class="sdk-lab__copy" data-step-detail></p><div class="sdk-step-actors"><div class="sdk-actor" data-actor="vLLM">vLLM</div><div class="sdk-actor" data-actor="LMCache">LMCache Server</div><div class="sdk-actor" data-actor="SDK">SDK</div></div><div class="sdk-step-message"><span class="sdk-step-message__line"></span><strong data-step-message></strong><span class="sdk-step-message__line"></span></div><div data-step-state></div></div></div>`;
  const list = q(root, "[data-step-list]");
  list.innerHTML = sequenceSteps.map((step, i) => `<button type="button" data-step="${i}"><span>${i + 1}</span><span>${step.title}</span></button>`).join("");
  let current = 0;
  function render(index) {
    current = Math.max(0, Math.min(sequenceSteps.length - 1, index));
    const step = sequenceSteps[current];
    q(root, "[data-step-number]").textContent = `STEP ${current + 1} / ${sequenceSteps.length}`;
    q(root, "[data-step-title]").textContent = step.title;
    q(root, "[data-step-detail]").textContent = step.detail;
    q(root, "[data-step-message]").textContent = step.message;
    q(root, "[data-step-state]").innerHTML = step.state.map((item) => `<div class="sdk-state-row"><code>state</code><span>${item}</span></div>`).join("");
    qa(root, "[data-actor]").forEach((actor) => {
      actor.classList.toggle("is-source", actor.dataset.actor === step.from);
      actor.classList.toggle("is-target", actor.dataset.actor === step.to);
    });
    qa(root, "[data-step]").forEach((btn) => btn.classList.toggle("is-active", Number(btn.dataset.step) === current));
    q(root, "[data-prev]").disabled = current === 0;
    q(root, "[data-next]").disabled = current === sequenceSteps.length - 1;
  }
  qa(root, "[data-step]").forEach((btn) => btn.addEventListener("click", () => render(Number(btn.dataset.step))));
  q(root, "[data-prev]").addEventListener("click", () => render(current - 1));
  q(root, "[data-next]").addEventListener("click", () => render(current + 1));
  render(0);
}

function initPolling(root) {
  root.classList.add("sdk-lab");
  root.innerHTML = `
    <div class="sdk-lab__head"><div><p class="sdk-lab__kicker">Polling, not push</p><h3>两层轮询分别解决不同问题</h3><p class="sdk-lab__copy">动画是时序示意，不按真实墙钟比例播放。</p></div><div class="sdk-controls">${button("重播轮询", "is-active")}</div></div>
    <div class="sdk-poll-grid"><div class="sdk-poll-layer"><div class="sdk-poll-layer__label"><strong>Context 内层</strong><span>10ms</span></div><div class="sdk-poll-track"><i></i></div><p>同一个 retrieve session：反复发送 <code>QUERY_PREFETCH_STATUS</code>，直到返回非 <code>None</code>。</p></div><div class="sdk-poll-layer"><div class="sdk-poll-layer__label"><strong>RequestStream 外层</strong><span>200ms</span></div><div class="sdk-poll-track"><i></i></div><p>如果整次 <code>ctx.retrieve()</code> 返回 <code>None</code>，等待后重新创建一次 retrieve。</p></div></div>
    <div class="sdk-poll-log" data-poll-log>LOOKUP accepted\nQUERY_PREFETCH_STATUS → None\nQUERY_PREFETCH_STATUS → None\nQUERY_PREFETCH_STATUS → 4 chunks\nprepare_retrieve → SHM slots\ncommit_retrieve → tensor ready</div>
    <p class="sdk-lab__note">Server 会响应 SDK 发来的查询，但不会在 KV 就绪后主动调用 SDK callback。Prefill HTTP [DONE] 也不是 KV-ready 通知。</p>`;
  const replay = q(root, "button");
  const run = () => { root.classList.remove("is-running"); void root.offsetWidth; root.classList.add("is-running"); };
  replay.addEventListener("click", run);
  run();
}

const decisionData = {
  random: "Random/规则算法只读取 KV。不要打 vLLM patch；不要加载 qstore；不要打开 transfer_intermediate_tensors。先用它验证 SDK 的 retrieve/edit/store 与吞吐链路。",
  snapkv: "SnapKV 需要近期 Query 与历史 Key 计算注意力重要性。需要 vLLM 两文件 patch、qstore server module、transfer_intermediate_tensors=true，并为 RequestStream 同时传入 KV 与 Query context。",
  rkv: "R-KV 同样需要 Query，并增加 Key 冗余计算。系统配置与 SnapKV 相同；算法本身的 CPU/GPU 计算与内存成本更高。"
};

function initDecision(root) {
  root.classList.add("sdk-lab");
  root.innerHTML = `
    <div class="sdk-lab__head"><div><p class="sdk-lab__kicker">Decision matrix</p><h3>先选算法，再决定是否改 vLLM</h3><p class="sdk-lab__copy">patch 的判断标准只有一个：算法是否需要 Query intermediate tensor。</p></div></div>
    <div class="sdk-decision-grid"><article class="sdk-decision-card is-selected" data-kind="random"><h4>Random / 规则</h4><ul><li>只需要 KV</li><li>无 patch</li><li>适合第一次跑通</li></ul></article><article class="sdk-decision-card" data-kind="snapkv"><h4>SnapKV</h4><ul><li>KV + Query</li><li>需要 patch + qstore</li><li>按注意力重要性</li></ul></article><article class="sdk-decision-card" data-kind="rkv"><h4>R-KV</h4><ul><li>KV + Query</li><li>需要 patch + qstore</li><li>重要性减冗余</li></ul></article></div>
    <div class="sdk-controls" style="margin-top:.8rem"><button type="button" class="sdk-btn is-active" data-choice="random">选择 Random</button><button type="button" class="sdk-btn" data-choice="snapkv">选择 SnapKV</button><button type="button" class="sdk-btn" data-choice="rkv">选择 R-KV</button></div>
    <div class="sdk-decision-result" data-result>${decisionData.random}</div>`;
  function render(kind) {
    q(root, "[data-result]").textContent = decisionData[kind];
    qa(root, "[data-kind]").forEach((card) => card.classList.toggle("is-selected", card.dataset.kind === kind));
    qa(root, "[data-choice]").forEach((btn) => {
      const active = btn.dataset.choice === kind;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
  qa(root, "[data-choice]").forEach((btn) => btn.addEventListener("click", () => render(btn.dataset.choice)));
}

document.querySelectorAll("[data-sdk-kv-lab]").forEach(initKvLab);
document.querySelectorAll("[data-sdk-topology]").forEach(initTopology);
document.querySelectorAll("[data-sdk-sequence]").forEach(initSequence);
document.querySelectorAll("[data-sdk-polling]").forEach(initPolling);
document.querySelectorAll("[data-sdk-patch-decision]").forEach(initDecision);

