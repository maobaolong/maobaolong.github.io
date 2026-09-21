/* Controls use Lucide 0.468.0; ISC license: /licenses/lucide-gds.txt. */
const icons = {
  play: '<polygon points="6 3 20 12 6 21 6 3" />',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" />',
  prev: '<path d="m15 18-6-6 6-6" />',
  next: '<path d="m9 18 6-6-6-6" />'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const node = (id, kicker, title, body) => `<section class="gds-node" data-node="${id}"><div class="gds-kicker">${kicker}</div><div class="gds-title">${title}</div><div class="gds-node-body">${body}</div></section>`;
const mono = (text) => `<span class="gds-mono">${text}</span>`;
const field = (name, value) => `<div class="gds-field"><span>${name}</span><span>${value}</span></div>`;
const status = (id) => `<div class="gds-status" data-status="${id}"></div>`;
const tiles = (zone, order, labels) => `<div class="gds-tiles">${order.map((value, i) => `<div class="gds-slot"><div class="gds-tile" data-value="${value}" data-tile="${zone}-${value}">${value}</div><small>${labels[i]}</small></div>`).join("")}</div>`;
const step = (title, text, active, edges = []) => ({ title, text, active, edges });
const edge = (from, to, kind = "data") => ({ from, to, kind });
const letters = ["A", "B", "C", "D"];
const backends = {
  cufile: ["cufile.bindings → libcufile", "文件 slab / O_DIRECT", "cuFileHandleRegister"],
  hipfile: ["CDLL(libhipfile.so)", "文件 slab / O_DIRECT", "hipFileHandleRegister"],
  ugds: ["CDLL(libugds.so)", "专用原始设备 / 容量检查", "uGDS 设备 handle"],
  phx: ["CDLL(libphxfile.so)", "文件 slab / O_DIRECT", "phxFileHandleRegister"]
};

const scenes = {
  physical: {
    label: "控制路径 ≠ 有效载荷路径",
    html: `<div class="gds-grid gds-physical">${
      node("user", "CPU · 用户态", "LMCache + 原生库", "决定 offset、长度和 GPU 目标" + status("user")) +
      node("kernel", "CPU · 内核态", "文件系统 + 驱动", "文件寻址、权限与 DMA 映射" + status("kernel")) +
      node("ssd", "设备 · NVMe SSD", "存储控制器", "接收 I/O 命令，搬运字节" + status("ssd")) +
      node("gpu", "设备 · GPU", "已注册 GPU buffer", "DMA 目标；完成后才能消费" + status("gpu")) +
      node("host", "", "CPU DRAM：直接路径不在这里中转 KV payload", "")
    }</div>`,
    steps: [
      step("1 · 用户态组织请求", "CPU 上的 LMCache 与原生库指定读哪段 slab、多少字节、写到哪个 GPU buffer。此时没有 KV 搬运。", ["user"]),
      step("2 · 建立可访问的映射", "内核与驱动负责文件和设备管理，并准备设备可使用的 DMA 地址。用户态、内核态都由 CPU 执行。", ["user", "kernel"], [edge("user", "kernel", "control")]),
      step("3 · 设备收到命令", "控制信息告诉存储控制器从哪里读取、向哪里写入。不同 backend 的命令提交路径不同。", ["kernel", "ssd"], [edge("kernel", "ssd", "control")]),
      step("4 · payload 经过 PCIe", "在直接路径中，SSD 与 GPU 交换有效载荷，跳过 CPU DRAM 的中转区。CPU 仍参与控制，不负责逐字节复制。", ["ssd", "gpu"], [edge("ssd", "gpu")]),
      step("5 · 完成进入执行顺序", "I/O 完成被原生库及 stream 机制观察，后续 GPU 工作才可消费数据。这与函数刚刚返回不是一回事。", ["gpu", "user"], [edge("ssd", "gpu")])
    ],
    update(v) {
      v.status("user", v.index === 0 ? "提交 READ 请求" : "控制工作，不中转 KV");
      v.status("kernel", v.index < 1 ? "映射尚未就绪" : "DMA 映射已准备");
      v.status("ssd", v.index < 2 ? "尚未收到命令" : v.index === 2 ? "I/O 命令已提交" : "读取 KV 字节");
      v.status("gpu", v.index < 3 ? "等待数据" : v.index === 3 ? "DMA 进行中" : "数据可供后续任务使用");
    }
  },
  slab: {
    label: "同一个对象 · 两套地址 · 两笔 I/O",
    html: `<div class="gds-grid gds-slab-grid">${
      node("file", "存储坐标", "slab 中的 8 MiB", field("对象", "offset 64 MiB") + '<div class="gds-address"><span data-segment="1">64–68</span><span data-segment="2">68–72</span></div>' + mono("file_offset / MiB") + status("file")) +
      node("regions", "GPU 坐标", "跨注册边界的 slice", '<div class="gds-region"><b>R0：注册区 0–16 MiB</b><div class="gds-address"><span>0–4</span><span>4–8</span><span>8–12</span><span data-segment="1">12–16</span></div></div><div class="gds-region"><b>R1：注册区 16–32 MiB</b><div class="gds-address"><span data-segment="2">16–20</span><span>20–24</span><span>24–28</span><span>28–32</span></div></div>' + status("regions"))
    }</div>`,
    steps: [
      step("1 · 对象是 slab 的一个范围", "分配器给出 (64 MiB, 8 MiB)。GDSMemoryObject 保存位置和大小，不持有 CPU tensor。", ["file"]),
      step("2 · GPU slice 跨越注册边界", "slice 从 R0 内的 12 MiB 开始，长度 8 MiB；而 R0 只剩 4 MiB。区间切分发生在 GPU 注册层。", ["regions"]),
      step("3 · 第一笔：R0 + 12 MiB", "file_offset=64 MiB，buf_base=R0，buf_offset=12 MiB，size=4 MiB。基址必须对应原先注册的区域。", ["file", "regions"], [edge("file", "regions")]),
      step("4 · 第二笔：R1 + 0", "file_offset=68 MiB，buf_base=R1，buf_offset=0，size=4 MiB。仍然是同一个 8 MiB 缓存对象。", ["file", "regions"], [edge("file", "regions")])
    ],
    update(v) {
      v.el.querySelectorAll("[data-segment]").forEach(el => el.toggleAttribute("data-dim", v.index === 2 ? el.dataset.segment !== "1" : v.index < 2));
      v.status("file", ["对象范围：64–72 MiB", "对象大小仍是 8 MiB", "本笔文件范围：64–68 MiB", "本笔文件范围：68–72 MiB"][v.index]);
      v.status("regions", ["已注册 R0、R1", "目标 slice：12–20 MiB", "R0 + 12 MiB，搬 4 MiB", "R1 + 0，搬 4 MiB"][v.index]);
    }
  },
  init: {
    label: "显式选择 · 双层懒加载",
    html: `<div class="gds-grid gds-init">${
      node("scan", "01 · 目录", "发现模块名", '<div class="gds-catalog">' + Object.keys(backends).map(n => `<span data-backend="${n}">${n}</span>`).join("") + "</div>" + status("scan")) +
      node("module", "02 · Python", "导入选中模块", '<span class="gds-mono" data-module></span>' + status("module")) +
      node("object", "03 · Python", "构造 Backend", mono("validate_environment()") + status("object")) +
      node("slab", "04 · Native", "准备存储 · 加载库", '<span data-storage></span><br><span class="gds-mono" data-library></span>' + status("slab")) +
      node("handle", "05 · Native", "取得 GDSHandle", '<span class="gds-mono" data-register></span>' + status("handle")) +
      node("buffer", "06 · GPU", "注册 buffer / stream", "LMCache context 持有 staging" + status("buffer"))
    }</div>`,
    steps: [
      step("1 · 扫描不执行实现", "pkgutil.iter_modules 发现名称。增加一个 backend 模块，不必去中央列表登记，也不会在扫描时加载它。", ["scan"]),
      step("2 · 只导入被选 Python 模块", "显式配置走对应模块的 Backend。模块顶层不能急着加载可选原生库；未选实现保持未导入。", ["module"], [edge("scan", "module", "control")]),
      step("3 · 普通继承与对象构造", "确认 Backend 继承公共接口，构造实例，验证该实现的环境。此时还没有打开 native driver。", ["object"], [edge("module", "object", "control")]),
      step("4 · 首次使用才加载原生依赖", "open_slab 由具体对象解释路径，准备文件或设备。到实际注册需要 native API 时，才加载库并绑定 ABI。", ["slab"], [edge("object", "slab", "control")]),
      step("5 · fd 与 GDS handle 各有职责", "OS fd 指向打开的文件或设备；native handle 表示它已被存储库注册。此时还没有写入任何 KV。", ["handle"], [edge("slab", "handle", "control")]),
      step("6 · 接入 context 的 GPU 资源", "设备 context 创建 staging 后，GDSContext 注册 buffer 与 stream，记录可用区域。后续 I/O 反复复用这些资源。", ["buffer"], [edge("handle", "buffer", "control")])
    ],
    update(v) {
      const name = v.backend;
      const info = backends[name];
      v.el.querySelector("[data-module]").textContent = `gds_backends.${name}`;
      v.el.querySelector("[data-library]").textContent = info[0];
      v.el.querySelector("[data-storage]").textContent = info[1];
      v.el.querySelector("[data-register]").textContent = info[2];
      v.el.querySelectorAll("[data-backend]").forEach(el => el.toggleAttribute("data-selected", el.dataset.backend === name));
      ["scan", "module", "object", "slab", "handle", "buffer"].forEach((id, i) => v.status(id, v.index < i ? "尚未到此阶段" : ["已发现名称", "仅选中模块被导入", "对象已创建，native 未加载", "存储准备及 native 加载阶段", "资源已注册", "可提交 I/O"][i]));
    }
  },
  store: {
    label: "STORE · gather → WRITE",
    html: `<div class="gds-grid gds-transfer">${
      node("paged", "WORKER · GPU", "分页 KV", mono("逻辑顺序 [7, 2, 9, 4]") + tiles("paged", ["B", "D", "A", "C"], ["block 2", "block 4", "block 7", "block 9"]) + status("paged")) +
      node("staging", "LMCACHE · GPU", "连续 staging", mono("object-group byte view") + tiles("staging", letters, ["0", "1", "2", "3"]) + status("staging")) +
      node("slab", "NVMe · 存储", "slab 中的对象", mono("GDSMemoryObject(offset, size)") + tiles("slab", letters, ["0", "1", "2", "3"]) + status("slab"))
    }</div>`,
    steps: [
      step("1 · 等 worker 写完", "store 整理 key 与 block IDs，并在 transfer stream 上等待 producer event。索引元数据与 KV payload 不同。", ["paged"]),
      step("2 · 分配 slab 位置", "reserve_write 返回 GDSMemoryObject，只确定 offset 与大小。没有对象的 STORE 条目会被跳过。", ["slab"]),
      step("3 · GPU gather / 布局转换", "transfer_kv_per_object_group 遍历 kernel groups，按 [7,2,9,4] 读物理 block，把 A、B、C、D 排成连续对象。", ["paged", "staging"], [edge("paged", "staging")]),
      step("4 · 识别 GDS object", "gpu_ops 不走 CPU tensor 拷贝，而把 slab offset 与 staging slice 交给 GDSContext。这里 D2H 只是方向标签。", ["staging", "slab"], [edge("staging", "slab", "control")]),
      step("5 · 提交 native WRITE", "解析注册区基址和 buf_offset，必要时分段。handle.write_async 在同一 stream 的 gather 之后执行。", ["staging", "slab"], [edge("staging", "slab")]),
      step("6 · 完成后发布对象", "记录 completion event，按 stream 顺序执行 finish_write。RPC 返回不等于 CPU 同步等完，也不是 fsync。", ["slab"])
    ],
    update(v, animate) {
      v.fill("paged", true);
      v.fill("staging", v.index >= 2);
      v.fill("slab", v.index >= 4);
      v.status("paged", v.index < 1 ? "等待 producer event" : "源数据保留，按索引读取");
      v.status("staging", v.index < 2 ? "已分配 / 已注册，等待 gather" : "A B C D：同一对象的连续表示");
      v.status("slab", v.index === 0 ? "尚未 reserve_write" : v.index < 4 ? "已分配区域，尚未发布" : v.index === 4 ? "WRITE，尚未发布" : "finish_write：结束写入");
      if (animate && v.index === 2) v.fly("paged", "staging");
      if (animate && v.index === 4) v.fly("staging", "slab");
    }
  },
  retrieve: {
    label: "RETRIEVE · READ → scatter",
    html: `<div class="gds-grid gds-transfer">${
      node("slab", "NVMe · 存储", "命中的 KV 对象", mono("同一 key / 原有 slab offset") + tiles("slab", letters, ["0", "1", "2", "3"]) + status("slab")) +
      node("staging", "LMCACHE · GPU", "连续 staging", mono("先恢复对象，再解释布局") + tiles("staging", letters, ["0", "1", "2", "3"]) + status("staging")) +
      node("paged", "WORKER · GPU", "新的目标页", mono("目标 IDs [3, 11, 0, 6]") + tiles("paged", ["C", "A", "D", "B"], ["block 0", "block 3", "block 6", "block 11"]) + status("paged"))
    }</div>`,
    steps: [
      step("1 · 解析 key 与目标页", "此前 lookup/prefetch 已确认命中并持有读锁。retrieve 解析 key，本次目标 block IDs 可以与保存时完全不同。", ["slab"]),
      step("2 · 排入依赖，再取得对象", "整理 block 索引，向 stream 排入 producer event 的等待，再按窗口用 read_prefetched_results 取回对象。", ["paged", "slab"]),
      step("3 · GDS READ 到 staging", "H2D 分支先读对象。handle.read_async 只负责把 slab 字节送入注册 buffer，不解释模型层、block table 或共享前缀。", ["slab", "staging"], [edge("slab", "staging")]),
      step("4 · 同 stream 上 scatter", "READ 排在 kernel 之前。对象就绪后，布局搬运按 [3,11,0,6] 把 A、B、C、D 写进本次的目标物理页。", ["staging", "paged"], [edge("staging", "paged")]),
      step("5 · 保留受保护的 token", "图中 A–D 是需要恢复的范围。scatter 还会跳过前部受保护 token；这不意味着 GDS 必然少读同样比例的字节。", ["paged"]),
      step("6 · 完成后结束读取", "completion event 之后，finish_read_prefetched 释放缓存侧读锁。event 管顺序，锁防止 slab 区域被提前重用。", ["slab", "paged"])
    ],
    update(v, animate) {
      v.fill("slab", true);
      v.fill("staging", v.index >= 2);
      v.fill("paged", v.index >= 3);
      v.status("slab", v.index < 5 ? "持有读锁：区域不可重用" : "finish_read_prefetched：释放锁");
      v.status("staging", v.index < 2 ? "已注册，等待 READ" : "完整对象 A B C D");
      v.status("paged", v.index < 3 ? "等待恢复；前序工作先完成" : v.index === 3 ? "A→3，B→11，C→0，D→6" : "只更新允许恢复的范围");
      if (animate && v.index === 2) v.fly("slab", "staging");
      if (animate && v.index === 3) v.fly("staging", "paged");
    }
  },
  async: {
    label: "时间向前 · 参数仍需存活",
    html: `<div class="gds-grid gds-async">${
      node("cpu", "CPU · 提交者", "调用与完成分离", field("Python 调用", '<span data-call></span>') + field("第几次提交", "64") + status("cpu")) +
      node("stream", "GPU RUNTIME · 顺序", "一条 transfer stream", '<div class="gds-queue"><div data-task="0">gather kernel</div><div data-task="1">GDS WRITE</div><div data-task="2">checkpoint event</div></div>' + status("stream")) +
      node("submission", "CPU 内存 · 参数", "Submission", '<div class="gds-mono">size · file_offset<br>buf_offset · result</div><div class="gds-life"><span data-life="0">uncommitted</span><span data-life="1">inflight</span><span data-life="2">可回收</span></div>' + status("submission"))
    }</div>`,
    steps: [
      step("1 · 原生库拿到指针", "WRITE 的 size、offset、result 是活的 ctypes 存储。它们不是 KV payload，却必须活到原生操作不再访问为止。", ["cpu", "submission"], [edge("cpu", "stream", "control")]),
      step("2 · Python 调用已经返回", "CPU 可以继续工作；stream 仍在执行此前入队的 gather。Submission 不能随栈帧结束而被释放。", ["stream", "submission"]),
      step("3 · 第 64 次触发 checkpoint", "在这些操作之后记录 event，将当前批次从 uncommitted 移入 inflight。event 入队不等于 event 已完成。", ["stream", "submission"], [edge("stream", "submission", "control")]),
      step("4 · WRITE 仍在执行", "event.query() 为 false，说明还不能证明前序 I/O 完成。这一批参数和对应 GPU allocation 继续保持有效。", ["stream", "submission"]),
      step("5 · checkpoint 完成", "WRITE 及前序工作结束后，event 才能完成。之后的查询返回 true；native result 此时才有完成意义。", ["stream", "submission"], [edge("stream", "submission", "control")]),
      step("6 · 回收该批次引用", "GDSContext 可以移除这批 Submission。当前代码按 event 回收，未逐笔检查 bytes_done 的短读、短写或错误值。", ["submission"])
    ],
    update(v) {
      v.el.querySelector("[data-call]").textContent = v.index === 0 ? "提交" : "已返回";
      v.status("cpu", v.index < 1 ? "构造并保留参数" : "无需原地等待所有 DMA");
      v.status("stream", v.index < 2 ? "继续按序执行" : v.index < 4 ? "event.query() = false" : "event.query() = true");
      v.status("submission", v.index < 5 ? "保留 Python 引用" : "释放此批引用；不是释放 KV slab");
      const task = v.index < 3 ? 0 : v.index === 3 ? 1 : 2;
      v.el.querySelectorAll("[data-task]").forEach(el => {
        el.toggleAttribute("data-running", Number(el.dataset.task) === task && v.index < 5);
        el.toggleAttribute("data-done", Number(el.dataset.task) < task || v.index >= 5);
      });
      v.el.querySelectorAll("[data-life]").forEach(el => el.toggleAttribute("data-on", Number(el.dataset.life) === (v.index < 2 ? 0 : v.index < 5 ? 1 : 2)));
    }
  },
  extension: {
    label: "muFile · 省掉中央登记，保留真实适配",
    html: `<div class="gds-grid gds-extension">${
      node("central", "原方案 · 中央代码", "两处登记修改", '<div class="gds-field" data-central>config.py：名称白名单</div><div class="gds-field" data-central>_gds_async.py：backend 分支</div>' + status("central")) +
      node("backend", "新结构 · 实现局部", "新增 backend 与测试", '<div class="gds-field">gds_backends/mufile.py</div><div class="gds-field">GDSBackend / GDSHandle</div><div class="gds-field">对应目录的 ABI / 生命周期测试</div>' + status("backend")) +
      node("device", "仍需完成 · 设备边界", "MUSA 桥接", '<div class="gds-field">raw stream：设备接口</div><div class="gds-field">staging：注册与注销</div><div class="gds-field">失败回滚与设备验证</div>' + status("device"))
    }</div>`,
    steps: [
      step("1 · 原 PR 改了四个已有生产文件", "原 #5027 除新增 wrapper 与测试外，还改配置、中央分发器、GDSContext 和 MUSA cache context。", ["central", "device"]),
      step("2 · 中央登记工作消失", "目录发现接纳模块名，公共代码调用对象接口。无需新增配置白名单，也无需在中央 dispatcher 加 muFile 分支。", ["central", "backend"]),
      step("3 · 原生差异归 backend 所有", "libmufile 加载、ABI、stream flags、描述符保活与错误解释留在 mufile.py。它们没有消失，只是不再扩散。", ["backend"]),
      step("4 · 新设备仍要接通", "raw stream 与 MUSA staging 生命周期仍需适配。按原文件边界是四处收敛为两处必要桥接，不是全工程只加一个文件。", ["device"])
    ],
    update(v) {
      v.el.querySelectorAll("[data-central]").forEach(el => el.toggleAttribute("data-eliminated", v.index >= 1));
      v.status("central", v.index === 0 ? "原方案需要逐处增加名称" : "无需修改中央登记代码");
      v.status("backend", v.index < 2 ? "普通继承 + 惰性模块发现" : "依然需要实现和验证 native ABI");
      v.status("device", v.index < 3 ? "独立于存储库名称的设备能力" : "仍需改动，不能省略");
    }
  }
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const svgNS = "http://www.w3.org/2000/svg";

class FlowFigure {
  constructor(el, sequence) {
    this.el = el;
    this.scene = scenes[el.dataset.gdsScene];
    this.index = 0;
    this.backend = "cufile";
    this.sequence = sequence;
    this.running = false;
    this.animations = [];
    const controls = ["prev", "play", "next"].map(name => `<button class="gds-icon" type="button" data-action="${name}" aria-label="${{ prev: "上一步", play: "播放流程", next: "下一步" }[name]}" title="${{ prev: "上一步", play: "播放流程", next: "下一步" }[name]}">${icon(name)}</button>`).join("");
    const selector = el.dataset.gdsScene === "init" ? `<label>backend <select aria-label="选择初始化 backend">${Object.keys(backends).map(n => `<option value="${n}">${n}</option>`).join("")}</select></label>` : "";
    el.insertAdjacentHTML("beforeend", `<div class="gds-toolbar"><strong>${this.scene.label}</strong>${selector}</div><div class="gds-stage">${this.scene.html}<svg class="gds-edges" aria-hidden="true"></svg></div><div class="gds-note" aria-live="polite" aria-atomic="true"><div class="gds-note-title"></div><div class="gds-note-text"></div></div><div class="gds-controls">${controls}<span class="gds-count"></span><div class="gds-dots" aria-label="流程步骤">${this.scene.steps.map((s, i) => `<button type="button" class="gds-dot" data-step="${i}" aria-label="${s.title}" title="${s.title}"></button>`).join("")}</div></div>`);
    this.stage = el.querySelector(".gds-stage");
    this.svg = el.querySelector(".gds-edges");
    el.dataset.ready = "true";
    el.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.action === "play") return this.toggle();
      this.pause();
      if (btn.dataset.action === "prev") this.show(this.index - 1, true);
      if (btn.dataset.action === "next") this.show(this.index + 1, true);
      if (btn.dataset.step !== undefined) this.show(Number(btn.dataset.step), true);
    });
    el.querySelector("select")?.addEventListener("change", e => {
      this.pause();
      this.backend = e.target.value;
      this.show(this.index, false);
    });
    this.show(0, false);
    new ResizeObserver(() => this.draw(false)).observe(this.stage);
    new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) this.pause();
    }).observe(el);
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause(); });
    reducedMotion.addEventListener("change", () => {
      this.pause();
      this.clearMotion();
      this.draw(false);
    });
  }

  status(id, text) { this.el.querySelector(`[data-status="${id}"]`).textContent = text; }
  fill(zone, filled) {
    this.el.querySelectorAll(`[data-tile^="${zone}-"]`).forEach(el => el.toggleAttribute("data-empty", !filled));
  }
  clearMotion() {
    this.animations.forEach(a => a.cancel());
    this.animations = [];
    this.stage.querySelectorAll(".gds-flying").forEach(el => el.remove());
  }
  fly(from, to) {
    if (reducedMotion.matches) return;
    const bounds = this.stage.getBoundingClientRect();
    letters.forEach((letter, i) => {
      const source = this.el.querySelector(`[data-tile="${from}-${letter}"]`);
      const dest = this.el.querySelector(`[data-tile="${to}-${letter}"]`);
      const a = source.getBoundingClientRect();
      const b = dest.getBoundingClientRect();
      const tile = source.cloneNode(true);
      tile.removeAttribute("data-tile");
      tile.classList.add("gds-flying");
      tile.setAttribute("aria-hidden", "true");
      Object.assign(tile.style, { left: `${a.left - bounds.left}px`, top: `${a.top - bounds.top}px`, width: `${a.width}px`, height: `${a.height}px` });
      this.stage.append(tile);
      const animation = tile.animate([
        { transform: "translate(0, 0)", opacity: 1 },
        { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px)`, opacity: 1 }
      ], { duration: 1050, delay: i * 130, easing: "cubic-bezier(.3,0,.2,1)", fill: "both" });
      const arrival = dest.animate([{ opacity: .15 }, { opacity: 1 }], { duration: 300, delay: 1000 + i * 130, fill: "backwards" });
      animation.onfinish = () => tile.remove();
      this.animations.push(animation, arrival);
    });
  }
  show(index, animate) {
    this.index = Math.max(0, Math.min(index, this.scene.steps.length - 1));
    this.el.dataset.phase = String(this.index);
    this.clearMotion();
    const current = this.scene.steps[this.index];
    this.el.querySelector(".gds-note-title").textContent = current.title;
    this.el.querySelector(".gds-note-text").textContent = current.text;
    this.el.querySelector(".gds-count").textContent = `${this.index + 1} / ${this.scene.steps.length}`;
    this.el.querySelector('[data-action="prev"]').disabled = this.index === 0;
    this.el.querySelector('[data-action="next"]').disabled = this.index === this.scene.steps.length - 1;
    this.el.querySelectorAll("[data-node]").forEach(el => {
      if (current.active.includes(el.dataset.node)) el.dataset.active = current.edges.some(e => e.kind === "control") ? "control" : "data";
      else delete el.dataset.active;
    });
    this.el.querySelectorAll("[data-step]").forEach(el => {
      if (Number(el.dataset.step) === this.index) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    this.scene.update(this, animate);
    this.draw(animate);
  }
  draw(animate) {
    const bounds = this.stage.getBoundingClientRect();
    this.svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    const markerId = `gds-arrow-${this.sequence}`;
    this.svg.innerHTML = `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>`;
    this.scene.steps[this.index].edges.forEach(({ from, to, kind }) => {
      const a = this.el.querySelector(`[data-node="${from}"]`).getBoundingClientRect();
      const b = this.el.querySelector(`[data-node="${to}"]`).getBoundingClientRect();
      const sameRow = Math.abs(a.top - b.top) < 30;
      let x1, x2, y1, y2;
      if (sameRow) {
        const forward = a.left < b.left;
        x1 = (forward ? a.right + 3 : a.left - 3) - bounds.left;
        x2 = (forward ? b.left - 6 : b.right + 6) - bounds.left;
        y1 = y2 = Math.min(a.bottom, b.bottom) - bounds.top - 35;
      } else {
        x1 = a.left + a.width / 2 - bounds.left;
        x2 = b.left + b.width / 2 - bounds.left;
        y1 = a.bottom - bounds.top + 3;
        y2 = b.top - bounds.top - 8;
      }
      const d = `M ${x1} ${y1} C ${sameRow ? (x1 + x2) / 2 : x1} ${sameRow ? y1 : (y1 + y2) / 2}, ${sameRow ? (x1 + x2) / 2 : x2} ${sameRow ? y2 : (y1 + y2) / 2}, ${x2} ${y2}`;
      const path = document.createElementNS(svgNS, "path");
      Object.entries({ d, fill: "none", stroke: kind === "data" ? "#67dfc1" : "#f5c778", "stroke-width": "2", "stroke-dasharray": kind === "control" ? "4 4" : "none", "marker-end": `url(#${markerId})` }).forEach(([k, value]) => path.setAttribute(k, value));
      this.svg.append(path);
      if (animate && !reducedMotion.matches) {
        const packet = document.createElementNS(svgNS, "circle");
        packet.setAttribute("r", kind === "data" ? "4" : "3");
        packet.setAttribute("fill", kind === "data" ? "#d8fff4" : "#ffe1aa");
        this.svg.append(packet);
        const length = path.getTotalLength();
        const frames = Array.from({ length: 25 }, (_, i) => {
          const point = path.getPointAtLength(length * i / 24);
          return { transform: `translate(${point.x}px, ${point.y}px)` };
        });
        const animation = packet.animate(frames, { duration: 1200, easing: "linear", fill: "both" });
        animation.onfinish = () => packet.remove();
        this.animations.push(animation);
      }
    });
  }
  toggle() {
    if (this.running) return this.pause();
    this.running = true;
    this.animations.forEach(a => { if (a.playState === "paused") a.play(); });
    this.el.dataset.playing = "true";
    const button = this.el.querySelector('[data-action="play"]');
    button.innerHTML = icon("pause");
    button.setAttribute("aria-label", "暂停流程");
    button.title = "暂停流程";
    if (this.index === this.scene.steps.length - 1) this.show(0, true);
    const tick = () => {
      if (!this.running) return;
      if (this.index === this.scene.steps.length - 1) return this.pause();
      this.show(this.index + 1, true);
      this.timer = window.setTimeout(tick, 4800);
    };
    this.timer = window.setTimeout(tick, 4800);
  }
  pause() {
    this.running = false;
    delete this.el.dataset.playing;
    window.clearTimeout(this.timer);
    this.animations.forEach(a => { if (a.playState === "running") a.pause(); });
    const button = this.el.querySelector('[data-action="play"]');
    button.innerHTML = icon("play");
    button.setAttribute("aria-label", "播放流程");
    button.title = "播放流程";
  }
}

document.querySelectorAll(".gds-anim[data-gds-scene]").forEach((el, i) => {
  if (!el.dataset.ready && scenes[el.dataset.gdsScene]) new FlowFigure(el, i);
});
