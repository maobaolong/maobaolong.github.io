/* Controls use Lucide 0.468.0; ISC license: /licenses/lucide-gds.txt. */
const icons = {
  play: '<polygon points="6 3 20 12 6 21 6 3" />',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" />',
  prev: '<path d="m15 18-6-6 6-6" />',
  next: '<path d="m9 18 6-6-6-6" />',
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  mute: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'
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
  cufile: ["cufile.bindings → libcufile", "File slab / O_DIRECT", "cuFileHandleRegister"],
  hipfile: ["CDLL(libhipfile.so)", "File slab / O_DIRECT", "hipFileHandleRegister"],
  ugds: ["CDLL(libugds.so)", "Dedicated raw device / capacity check", "uGDS device handle"],
  phx: ["CDLL(libphxfile.so)", "File slab / O_DIRECT", "phxFileHandleRegister"]
};

const scenes = {
  physical: {
    label: "Control path ≠ payload path",
    html: `<div class="gds-grid gds-physical">${
      node("user", "CPU · User Mode", "LMCache + Native Library", "Determine offset, length, and GPU target" + status("user")) +
      node("kernel", "CPU · Kernel Mode", "File System + Driver", "File addressing, permissions, and DMA mapping" + status("kernel")) +
      node("ssd", "Device · NVMe SSD", "DMA hardware in the controller", "Initiate PCIe transactions with target addresses" + status("ssd")) +
      node("gpu", "Device · GPU PCIe Endpoint", "BAR mapping → GPU buffer", "Route by device address, landing in mapped VRAM" + status("gpu")) +
      node("host", "", "CPU DRAM: Direct path not routing KV payload here", "")
    }</div>`,
    steps: [
      step("1 · User mode organizes requests", "LMCache on the CPU specifies which slab to read, how many bytes, and which GPU buffer to write to. There is no KV transport at this time.", ["user"]),
      step("2 · Create accessible mapping", "The GPU is also an addressable PCIe endpoint. The driver associates the application's GPU virtual address with the device-accessible video memory mapping; the two types of addresses cannot be mixed directly.", ["user", "kernel"], [edge("user", "kernel", "control")]),
      step("3 · Device received command", "Control information tells the storage controller where to read from and where to write to. The command submission paths differ for different backends.", ["kernel", "ssd"], [edge("kernel", "ssd", "control")]),
      step("4 · SSD controller initiates DMA", "During reading, the SSD controller's DMA hardware sends PCIe write transactions to the GPU mapped address. The GPU endpoint receives the data and accesses the corresponding video memory without going through CPU DRAM.", ["ssd", "gpu"], [edge("ssd", "gpu")]),
      step("5 · Complete the entry execution order", "I/O completion is observed by the native library and stream mechanism, and subsequent GPU work can only consume data afterward. This is not the same as the function just returning.", ["gpu", "user"], [edge("ssd", "gpu")])
    ],
    update(v) {
      v.status("user", v.index === 0 ? "Submit READ request" : "Control work, no KV relay");
      v.status("kernel", v.index < 1 ? "Mapping not yet ready" : "DMA mapping is ready");
      v.status("ssd", v.index < 2 ? "Not yet received command" : v.index === 2 ? "I/O command has been submitted" : "Read KV Bytes");
      v.status("gpu", v.index < 3 ? "Waiting for data" : v.index === 3 ? "DMA in progress" : "Data available for subsequent tasks");
    }
  },
  slab: {
    label: "R = region · Segmented registration of the same GPU buffer.",
    html: `<div class="gds-grid gds-slab-grid">${
      node("file", "Storage Coordinates", "8 MiB in slab", field("Object", "offset 64 MiB") + '<div class="gds-address"><span data-segment="1">64–68</span><span data-segment="2">68–72</span></div>' + mono("file_offset / MiB") + status("file")) +
      node("regions", "A GPU allocation · Base B", "Two registered ranges", '<div class="gds-region"><b>R0: B + [0, 16 MiB)</b><div class="gds-address"><span>0–4</span><span>4–8</span><span>8–12</span><span data-segment="1">12–16</span></div></div><div class="gds-region"><b>R1: B + [16, 32 MiB)</b><div class="gds-address"><span data-segment="2">16–20</span><span>20–24</span><span>24–28</span><span>28–32</span></div></div>' + status("regions"))
    }</div>`,
    steps: [
      step("1 · Object is a range of slab", "The allocator provides (64 MiB, 8 MiB). GDSMemoryObject saves location and size, does not hold CPU tensor.", ["file"]),
      step("2 · A block of video memory, two registration ranges", "R0/R1 are not two separate GPU or SSD partitions. They are the front and back of the same allocation, two 16 MiB ranges; the target slice of 12–20 MiB crosses both boundaries.", ["regions"]),
      step("3 · First entry: R0 + 12 MiB", "file_offset=64 MiB, buf_base=R0, buf_offset=12 MiB, size=4 MiB. The base address must correspond to the originally registered area.", ["file", "regions"], [edge("file", "regions")]),
      step("4 · Second entry: R1 + 0", "file_offset=68 MiB, buf_base=R1, buf_offset=0, size=4 MiB. Still the same 8 MiB cache object.", ["file", "regions"], [edge("file", "regions")])
    ],
    update(v) {
      v.el.querySelectorAll("[data-segment]").forEach(el => el.toggleAttribute("data-dim", v.index === 2 ? el.dataset.segment !== "1" : v.index < 2));
      v.status("file", ["Object range: 64–72 MiB", "Object size is still 8 MiB", "This file range: 64–68 MiB", "This file range: 68–72 MiB"][v.index]);
      v.status("regions", ["Registered R0, R1", "Target slice: 12–20 MiB", "R0 + 12 MiB, move 4 MiB.", "R1 + 0, move 4 MiB."][v.index]);
    }
  },
  init: {
    label: "Explicit selection · Double lazy loading",
    html: `<div class="gds-grid gds-init">${
      node("scan", "01 · Directory", "Discover module names", '<div class="gds-catalog">' + Object.keys(backends).map(n => `<span data-backend="${n}">${n}</span>`).join("") + "</div>" + status("scan")) +
      node("module", "02 · Python", "Import selected module", '<span class="gds-mono" data-module></span>' + status("module")) +
      node("object", "03 · Python", "Construct Backend", mono("validate_environment()") + status("object")) +
      node("slab", "04 · Native", "Prepare storage · Load library", '<span data-storage></span><br><span class="gds-mono" data-library></span>' + status("slab")) +
      node("handle", "05 · Native", "Obtain GDSHandle", '<span class="gds-mono" data-register></span>' + status("handle")) +
      node("buffer", "06 · GPU", "Register buffer / stream", "LMCache context holds staging" + status("buffer"))
    }</div>`,
    steps: [
      step("1 · Scan does not execute implementation", "pkgutil.iter_modules discovers names. Add a backend module without needing to register in the central list, and it will not be loaded during scanning.", ["scan"]),
      step("2 · Import only selected Python modules", "Explicitly configure to use the corresponding module's Backend. The top level of the module should not rush to load optional native libraries; unselected implementations remain unimported.", ["module"], [edge("scan", "module", "control")]),
      step("3 · Regular inheritance and object construction", "Confirm that the Backend inherits the public interface, constructs instances, and verifies the environment of this implementation. The native driver is not yet enabled.", ["object"], [edge("module", "object", "control")]),
      step("4 · Load native dependencies only on first use", "open_slab interprets the path for specific objects, preparing files or devices. The library is only loaded and ABI bound when actual registration requires native API.", ["slab"], [edge("object", "slab", "control")]),
      step("5 · fd and GDS handle have their respective responsibilities", "The OS fd points to an open file or device; the native handle indicates it has been registered with the repository. No KV has been written at this point.", ["handle"], [edge("slab", "handle", "control")]),
      step("6 · Access GPU resources of the context", "After creating the device context staging, GDSContext registers the buffer with the stream and records the available area. Subsequent I/O will repeatedly reuse these resources.", ["buffer"], [edge("handle", "buffer", "control")])
    ],
    update(v) {
      const name = v.backend;
      const info = backends[name];
      v.el.querySelector("[data-module]").textContent = `gds_backends.${name}`;
      v.el.querySelector("[data-library]").textContent = info[0];
      v.el.querySelector("[data-storage]").textContent = info[1];
      v.el.querySelector("[data-register]").textContent = info[2];
      v.el.querySelectorAll("[data-backend]").forEach(el => el.toggleAttribute("data-selected", el.dataset.backend === name));
      ["scan", "module", "object", "slab", "handle", "buffer"].forEach((id, i) => v.status(id, v.index < i ? "Not yet at this stage" : ["Name discovered", "Only selected modules are imported", "Object created, native not loaded", "Storage preparation and native loading phase", "Resource has been registered", "I/O can be committed"][i]));
    }
  },
  store: {
    label: "STORE · gather → WRITE",
    html: `<div class="gds-grid gds-transfer">${
      node("paged", "WORKER · GPU", "Paged KV", mono("Logical order [7, 2, 9, 4]") + tiles("paged", ["B", "D", "A", "C"], ["block 2", "block 4", "block 7", "block 9"]) + status("paged")) +
      node("staging", "LMCACHE · GPU", "Continuous staging", mono("object-group byte view") + tiles("staging", letters, ["0", "1", "2", "3"]) + status("staging")) +
      node("slab", "NVMe · Storage", "Objects in slab", mono("GDSMemoryObject(offset, size)") + tiles("slab", letters, ["0", "1", "2", "3"]) + status("slab"))
    }</div>`,
    steps: [
      step("1 · Wait for worker to finish", "store organizes key and block IDs, and waits for the producer event on the transfer stream. Index metadata differs from KV payload.", ["paged"]),
      step("2 · Allocate slab position", "reserve_write returns GDSMemoryObject, only determining offset and size. STORE entries without objects will be skipped.", ["slab"]),
      step("3 · GPU gather / layout transformation", "transfer_kv_per_object_group iterates over kernel groups, reads physical blocks in the order of [7,2,9,4], and arranges A, B, C, D as contiguous objects.", ["paged", "staging"], [edge("paged", "staging")]),
      step("4 · Identify GDS object", "gpu_ops do not go through CPU tensor copy, but pass the slab offset and staging slice to GDSContext. Here D2H is just a directional label.", ["staging", "slab"], [edge("staging", "slab", "control")]),
      step("5 · Submit native WRITE", "Parse the base address of the registration area and buf_offset, segment if necessary. handle.write_async executes after gather on the same stream.", ["staging", "slab"], [edge("staging", "slab")]),
      step("6 · Publish the object after completion", "Record completion event, execute finish_write in stream order. RPC return does not equal CPU sync completion, nor is it fsync.", ["slab"])
    ],
    update(v, animate) {
      v.fill("paged", true);
      v.fill("staging", v.index >= 2);
      v.fill("slab", v.index >= 4);
      v.status("paged", v.index < 1 ? "Waiting for producer event" : "Source data retained, read by index");
      v.status("staging", v.index < 2 ? "Allocated / Registered, waiting to gather" : "A B C D: Continuous representation of the same object");
      v.status("slab", v.index === 0 ? "Not yet reserve_write" : v.index < 4 ? "Allocated area, not yet released" : v.index === 4 ? "WRITE, not yet released" : "finish_write: end writing");
      if (animate && v.index === 2) v.fly("paged", "staging");
      if (animate && v.index === 4) v.fly("staging", "slab");
    }
  },
  retrieve: {
    label: "RETRIEVE · READ → scatter",
    html: `<div class="gds-grid gds-transfer">${
      node("slab", "NVMe · Storage", "Hit KV objects", mono("Same key / Original slab offset") + tiles("slab", letters, ["0", "1", "2", "3"]) + status("slab")) +
      node("staging", "LMCACHE · GPU", "Continuous staging", mono("Restore object first, then explain layout") + tiles("staging", letters, ["0", "1", "2", "3"]) + status("staging")) +
      node("paged", "WORKER · GPU", "New target page", mono("Target IDs [3, 11, 0, 6]") + tiles("paged", ["C", "A", "D", "B"], ["block 0", "block 3", "block 6", "block 11"]) + status("paged"))
    }</div>`,
    steps: [
      step("1 · Parse key and target page", "The previous lookup/prefetch has confirmed a hit and holds a read lock. The retrieve parses the key, and this time the target block IDs can be completely different from when they were saved.", ["slab"]),
      step("2 · Queue dependencies, then retrieve objects", "Organize block index, queue producer events to stream, then retrieve objects using read_prefetched_results by window.", ["paged", "slab"]),
      step("3 · GDS READ to staging", "The H2D branch first reads the object. handle.read_async is only responsible for sending slab bytes into the registered buffer, without interpreting the model layer, block table, or shared prefix.", ["slab", "staging"], [edge("slab", "staging")]),
      step("4 · Scatter on the same stream", "READ is prioritized before the kernel. After the object is ready, the layout transfer writes A, B, C, D into this target physical page in the order [3,11,0,6].", ["staging", "paged"], [edge("staging", "paged")]),
      step("5 · Retain the protected token", "In the diagram, A–D are the ranges that need to be recovered. Scatter will also skip the protected tokens at the front; this does not mean GDS necessarily reads the same proportion of bytes less.", ["paged"]),
      step("6 · End reading after completion", "After the completion event, finish_read_prefetched releases the cache-side read lock. The event pipeline order prevents the slab area from being reused prematurely.", ["slab", "paged"])
    ],
    update(v, animate) {
      v.fill("slab", true);
      v.fill("staging", v.index >= 2);
      v.fill("paged", v.index >= 3);
      v.status("slab", v.index < 5 ? "Holding read lock: area cannot be reused" : "finish_read_prefetched: release lock");
      v.status("staging", v.index < 2 ? "Registered, waiting for READ" : "Complete object A B C D");
      v.status("paged", v.index < 3 ? "Waiting to resume; complete previous tasks first" : v.index === 3 ? "A→3，B→11，C→0，D→6" : "Only update the range that allows recovery");
      if (animate && v.index === 2) v.fly("slab", "staging");
      if (animate && v.index === 3) v.fly("staging", "paged");
    }
  },
  async: {
    label: "Time moves forward · Parameters still need to persist",
    html: `<div class="gds-grid gds-async">${
      node("cpu", "CPU · Submitter", "Separation of call and completion", field("Python call", '<span data-call></span>') + field("Submission number", "64") + status("cpu")) +
      node("stream", "GPU RUNTIME · Sequence", "A transfer stream", '<div class="gds-queue"><div data-task="0">gather kernel</div><div data-task="1">GDS WRITE</div><div data-task="2">checkpoint event</div></div>' + status("stream")) +
      node("submission", "CPU Memory · Parameters", "Submission", '<div class="gds-mono">size · file_offset<br>buf_offset · result</div><div class="gds-life"><span data-life="0">uncommitted</span><span data-life="1">inflight</span><span data-life="2">recyclable</span></div>' + status("submission"))
    }</div>`,
    steps: [
      step("1 · Native library obtains pointer", "The size, offset, and result of WRITE are live ctypes storage. They are not KV payloads, but must remain alive until the native operation no longer accesses them.", ["cpu", "submission"], [edge("cpu", "stream", "control")]),
      step("2 · Python call has returned", "The CPU can continue working; the stream is still executing the previously queued gather. Submission cannot be released just because the stack frame ends.", ["stream", "submission"]),
      step("3 · 64th checkpoint trigger", "Record the event after these operations, moving the current batch from uncommitted to inflight. Event enqueueing does not equal event completion.", ["stream", "submission"], [edge("stream", "submission", "control")]),
      step("4 · WRITE still in progress", "If event.query() returns false, it means the preceding I/O cannot be confirmed as complete. This batch of parameters and corresponding GPU allocation remain valid.", ["stream", "submission"]),
      step("5 · Checkpoint completed", "After WRITE and preceding tasks are completed, the event can finish. Subsequent queries return true; the native result only has significance at this point.", ["stream", "submission"], [edge("stream", "submission", "control")]),
      step("6 · Reclaim the batch reference", "GDSContext can remove this batch of Submission. The current code recycles by event, without checking for short reads, short writes, or error values in bytes_done on a per-entry basis.", ["submission"])
    ],
    update(v) {
      v.el.querySelector("[data-call]").textContent = v.index === 0 ? "Submit" : "Returned";
      v.status("cpu", v.index < 1 ? "Construct and retain parameters" : "No need to wait for all DMA in place");
      v.status("stream", v.index < 2 ? "Continue executing in order" : v.index < 4 ? "event.query() = false" : "event.query() = true");
      v.status("submission", v.index < 5 ? "Retain Python reference" : "Release this batch reference; not releasing KV slab");
      const task = v.index < 3 ? 0 : v.index === 3 ? 1 : 2;
      v.el.querySelectorAll("[data-task]").forEach(el => {
        el.toggleAttribute("data-running", Number(el.dataset.task) === task && v.index < 5);
        el.toggleAttribute("data-done", Number(el.dataset.task) < task || v.index >= 5);
      });
      v.el.querySelectorAll("[data-life]").forEach(el => el.toggleAttribute("data-on", Number(el.dataset.life) === (v.index < 2 ? 0 : v.index < 5 ? 1 : 2)));
    }
  },
  extension: {
    label: "Phoenix · Inherits the public process, encapsulating native differences.",
    html: `<div class="gds-grid gds-extension">${
      node("central", "Original Plan · Central Code", "Two registration modifications", '<div class="gds-field" data-central>config.py: Name whitelist</div><div class="gds-field" data-central>_gds_async.py: backend branch</div>' + status("central")) +
      node("backend", "New Structure · Local Implementation", "phx.py + Corresponding tests", '<div class="gds-field">Backend → FileGDSBackend</div><div class="gds-field">AsyncHandle → GDSHandle</div><div class="gds-field">Lazy load libphxfile.so</div>' + status("backend")) +
      node("device", "PHOENIX · NATIVE Boundary", "shim and hardware contract", '<div class="gds-field">fd / buffer / stream registration</div><div class="gds-field">Asynchronous parameters and result pointers</div><div class="gds-field">Implicit initialization and cleanup</div>' + status("device"))
    }</div>`,
    steps: [
      step("1 · Original access requires central registration", "Historical Phoenix PR #4673 modified configuration and central dispatcher in addition to implementation, testing, and documentation, adding the phx name to the public code.", ["central"]),
      step("2 · New structure discovered by directory", "phx.py exports Backend. Explicit selection is required for import; the public factory and GDSContext do not need to add a Phoenix branch.", ["central", "backend"]),
      step("3 · Regular inheritance reuse process", "Backend inheritance file preparation; AsyncHandle inherits fd cleanup. Library loading, native read/write, and error interpretation are handled by the Phoenix subclass.", ["backend"]),
      step("4 · ABI remains within implementation", "phx stream registration has no flags, the current shim registration is a no-op, but each I/O still transmits the stream. Driver installation, hardware validation, and new device adaptation will not disappear automatically.", ["device"])
    ],
    update(v) {
      v.el.querySelectorAll("[data-central]").forEach(el => el.toggleAttribute("data-eliminated", v.index >= 1));
      v.status("central", v.index === 0 ? "The original plan required adding names at each location" : "No need to modify central registration code");
      v.status("backend", v.index < 2 ? "Normal inheritance + lazy module discovery" : "Public process inheritance, partial implementation of real differences");
      v.status("device", v.index < 3 ? "Python interfaces with native through shim." : "Dependencies and hardware still need to be validated in practice");
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
    const controls = ["prev", "play", "next"].map(name => `<button class="gds-icon" type="button" data-action="${name}" aria-label="${{ prev: "Previous", play: "Play Flow", next: "Next" }[name]}" title="${{ prev: "Previous", play: "Play Flow", next: "Next" }[name]}">${icon(name)}</button>`).join("");
    const selector = el.dataset.gdsScene === "init" ? `<label>backend <select aria-label="Select initialization backend">${Object.keys(backends).map(n => `<option value="${n}">${n}</option>`).join("")}</select></label>` : "";
    el.insertAdjacentHTML("beforeend", `<div class="gds-toolbar"><strong>${this.scene.label}</strong>${selector}</div><div class="gds-stage">${this.scene.html}<svg class="gds-edges" aria-hidden="true"></svg></div><div class="gds-note" aria-live="polite" aria-atomic="true"><div class="gds-note-title"></div><div class="gds-note-text"></div></div><div class="gds-controls">${controls}<span class="gds-count"></span><div class="gds-dots" aria-label="Process steps">${this.scene.steps.map((s, i) => `<button type="button" class="gds-dot" data-step="${i}" aria-label="${s.title}" title="${s.title}"></button>`).join("")}</div></div>`);
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
    button.setAttribute("aria-label", "Pause process");
    button.title = "Pause process";
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
    button.setAttribute("aria-label", "Playback Process");
    button.title = "Playback Process";
  }
}

document.querySelectorAll(".gds-anim[data-gds-scene]").forEach((el, i) => {
  if (!el.dataset.ready && scenes[el.dataset.gdsScene]) new FlowFigure(el, i);
});

document.querySelectorAll('.gds-video video').forEach(video => {
  const player = document.createElement('div');
  player.className = 'gds-video-player';
  video.replaceWith(player);
  player.append(video);
  const controls = document.createElement('div');
  controls.className = 'gds-video-controls';
  controls.innerHTML = `<button type="button" data-video-action="play" aria-label="Play Video" title="Play Video">${icon('play')}</button>
    <input class="gds-video-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Video Progress" disabled>
    <span class="gds-video-time">0:00 / --:--</span>
    <select class="gds-video-speed" aria-label="Playback Speed" title="Playback Speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
    <button type="button" data-video-action="mute" aria-label="Mute" title="Mute">${icon('volume')}</button>
    <input class="gds-video-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" title="Volume">
    <button type="button" data-video-action="fullscreen" aria-label="Fullscreen" title="Fullscreen">${icon('maximize')}</button>`;
  player.append(controls);
  const error = document.createElement('p');
  error.className = 'gds-video-error';
  error.setAttribute('role', 'status');
  error.hidden = true;
  player.append(error);
  const seek = controls.querySelector('.gds-video-seek');
  const volume = controls.querySelector('.gds-video-volume');
  const play = controls.querySelector('[data-video-action="play"]');
  const mute = controls.querySelector('[data-video-action="mute"]');
  const full = controls.querySelector('[data-video-action="fullscreen"]');
  const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  const label = (button, name, glyph) => {
    button.innerHTML = icon(glyph);
    button.title = name;
    button.setAttribute('aria-label', name);
  };
  const sync = () => {
    label(play, video.paused ? "Play Video" : "Pause video", video.paused ? 'play' : 'pause');
    label(mute, video.muted || video.volume === 0 ? "Enable sound" : "Mute", video.muted || video.volume === 0 ? 'mute' : 'volume');
    if (Number.isFinite(video.duration)) {
      seek.disabled = false;
      seek.max = String(video.duration);
      seek.value = String(video.currentTime);
      seek.setAttribute('aria-valuetext', `${time(video.currentTime)} / ${time(video.duration)}`);
      controls.querySelector('.gds-video-time').textContent = `${time(video.currentTime)} / ${time(video.duration)}`;
    }
    volume.value = String(video.muted ? 0 : video.volume);
  };
  const toggle = async () => {
    error.hidden = true;
    if (!video.paused) return video.pause();
    try { await video.play(); }
    catch { error.textContent = "Playback is temporarily unavailable; you can use the MP4 download link below."; error.hidden = false; }
  };
  play.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.tabIndex = 0;
  video.addEventListener('keydown', event => {
    if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); toggle(); }
  });
  seek.addEventListener('input', () => { video.currentTime = Number(seek.value); });
  mute.addEventListener('click', () => {
    if (video.muted || video.volume === 0) { video.muted = false; if (video.volume === 0) video.volume = 1; }
    else video.muted = true;
  });
  volume.addEventListener('input', () => { video.volume = Number(volume.value); video.muted = false; });
  controls.querySelector('.gds-video-speed').addEventListener('change', event => { video.playbackRate = Number(event.target.value); });
  full.hidden = !player.requestFullscreen && !video.webkitEnterFullscreen;
  full.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
      else video.webkitEnterFullscreen();
    } catch { /* The player remains usable if the browser denies fullscreen. */ }
  });
  document.addEventListener('fullscreenchange', () => label(full, document.fullscreenElement === player ? "Exit Full Screen" : "Full Screen", document.fullscreenElement === player ? 'minimize' : 'maximize'));
  ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended', 'volumechange'].forEach(event => video.addEventListener(event, sync));
  video.addEventListener('error', () => { error.textContent = "Video loading failed; you can use the MP4 download link below."; error.hidden = false; });
  video.controls = false;
  sync();
});
