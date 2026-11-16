const byId = (id) => document.getElementById(id);

const gcd = (a, b) => {
  while (b) [a, b] = [b, a % b];
  return a;
};
const lcm = (a, b) => (a * b) / gcd(a, b);

const lab = byId("mca-lab");
if (lab) {
  const prefix = byId("mca-prefix");
  const extend = byId("mca-extend");
  const grid = byId("mca-grid");
  const external = byId("mca-external");
  const locale = lab.dataset.locale || "en";

  const renderLab = () => {
    const p = Number(prefix.value);
    const x = Number(extend.value);
    const g = Number(grid.value);
    const e = Number(external.value);
    const end = p + x;
    const old = p + Math.floor(x / g) * g;
    const key = Math.floor(end / e) * e;
    const combined = lcm(g, e);
    const fixed = Math.floor(end / combined) * combined;
    const matches = old === key;

    byId("mca-prefix-out").textContent = p;
    byId("mca-extend-out").textContent = x;
    byId("mca-end").textContent = end;
    byId("mca-old").textContent = old;
    byId("mca-key").textContent = key;
    byId("mca-new").textContent = fixed;

    const min = p;
    const span = Math.max(1, end - min);
    const place = (id, value) => { byId(id).style.left = `${Math.max(0, Math.min(100, ((value - min) / span) * 100))}%`; };
    place("mca-track-prefix", p);
    place("mca-track-key", key);
    place("mca-track-old", old);
    place("mca-track-end", end);

    const verdict = byId("mca-verdict");
    verdict.classList.toggle("good", matches);
    verdict.textContent = locale === "zh"
      ? (matches ? `旧状态 ${old} 恰好与外部 key 对齐；这个输入不会触发冲突。` : `冲突：forward 只保留了 h${old}，但外部 key 是 ${key}。修复后在计算前选择 h${fixed}。`)
      : (matches ? `The old state ${old} already matches the external key for this input.` : `Conflict: forward retained only h${old}, but the external key is ${key}. The fix selects h${fixed} before computation.`);
    byId("mca-formula").textContent = locale === "zh"
      ? `共同粒度 lcm(${g}, ${e}) = ${combined}；floor(${end} / ${combined}) × ${combined} = ${fixed}`
      : `Common grid lcm(${g}, ${e}) = ${combined}; floor(${end} / ${combined}) × ${combined} = ${fixed}`;
  };

  [prefix, extend, grid, external].forEach((control) => control.addEventListener("input", renderLab));
  lab.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    if (preset === "bug") [prefix.value, extend.value, grid.value, external.value] = [8192, 617, 64, 256];
    if (preset === "aligned") [prefix.value, extend.value, grid.value, external.value] = [4096, 512, 64, 256];
    if (preset === "noexternal") [prefix.value, extend.value, grid.value, external.value] = [4096, 355, 64, 64];
    renderLab();
  }));
  renderLab();
}

const player = byId("mca-player");
if (player) {
  const locale = player.dataset.locale || "en";
  const copy = {
    zh: {
      old: ["Scheduler 按 64 粒度选择 8768。问题在这里已经埋下。", "Forward 计算并只保留 h8768；较早的 h8704 不再可用。", "Radix 节点收到 h8768，并继续交给外部层。", "LMCache 按 256-token chunk 生成 key 8704。", "长度不一致，安全检查只能跳过 store。"],
      fixed: ["Scheduler 读取外部对齐 256，并选择共同边界 8704。", "Forward 直接计算并保留正确的 h8704。", "Radix 节点上的状态与可持久化前缀一致。", "LMCache 生成同样的 key 8704。", "状态深度与 key 一致，store 成功且可安全复用。"]
    },
    en: {
      old: ["The Scheduler chooses 8768 on its 64-token grid. The mismatch is already determined here.", "Forward computes and retains only h8768; the earlier h8704 is no longer available.", "The Radix node receives h8768 and passes it toward the external tier.", "LMCache derives key 8704 on its 256-token chunk grid.", "Lengths disagree, so the safety check can only skip the store."],
      fixed: ["The Scheduler reads external alignment 256 and chooses the common boundary 8704.", "Forward directly computes and retains the correct h8704.", "The Radix node now carries the state for the persistable prefix.", "LMCache derives the same key 8704.", "State depth and key agree, so the entry is safely stored and reusable."]
    }
  };
  let step = 0;
  let mode = "old";
  let timer;
  const nodes = [...player.querySelectorAll("[data-stage]")];
  const renderPlayer = () => {
    nodes.forEach((node, index) => {
      node.classList.toggle("active", index === step);
      node.classList.toggle("done", index < step);
    });
    byId("mca-step-count").textContent = `${step + 1} / ${nodes.length}`;
    byId("mca-stage-copy").textContent = copy[locale][mode][step];
    player.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    byId("mca-play").textContent = locale === "zh" ? "播放" : "Play";
  };
  const move = (delta) => { step = (step + delta + nodes.length) % nodes.length; renderPlayer(); };
  byId("mca-prev").addEventListener("click", () => { stop(); move(-1); });
  byId("mca-next").addEventListener("click", () => { stop(); move(1); });
  byId("mca-play").addEventListener("click", () => {
    if (timer) return stop();
    byId("mca-play").textContent = locale === "zh" ? "暂停" : "Pause";
    timer = setInterval(() => move(1), 1600);
  });
  player.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    stop();
    mode = button.dataset.mode;
    step = 0;
    renderPlayer();
  }));
  renderPlayer();
}
