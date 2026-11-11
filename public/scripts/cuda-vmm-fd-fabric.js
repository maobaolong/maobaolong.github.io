const motionReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.querySelectorAll("[data-vmm-lab]").forEach((lab) => {
  const buttons = [...lab.querySelectorAll("[data-vmm-step]")];
  const title = lab.querySelector("[data-vmm-title]");
  const copy = lab.querySelector("[data-vmm-copy]");
  const counter = lab.querySelector("[data-vmm-counter]");
  const play = lab.querySelector("[data-vmm-play]");
  let timer = null;
  let index = 0;

  const stop = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (play) {
      play.textContent = play.dataset.playLabel || "Play";
      play.setAttribute("aria-pressed", "false");
    }
  };

  const select = (next) => {
    index = next;
    const button = buttons[index];
    lab.dataset.stage = button.dataset.vmmStep || String(index);
    buttons.forEach((item, position) => {
      item.classList.toggle("is-active", position === index);
      item.setAttribute("aria-pressed", position === index ? "true" : "false");
    });
    if (title) title.textContent = button.dataset.title || "";
    if (copy) copy.textContent = button.dataset.copy || "";
    if (counter) counter.textContent = `${index + 1} / ${buttons.length}`;
  };

  const advance = () => {
    if (index >= buttons.length - 1) {
      stop();
      return;
    }
    select(index + 1);
    timer = window.setTimeout(advance, 1650);
  };

  buttons.forEach((button, position) => {
    button.addEventListener("click", () => {
      stop();
      select(position);
    });
  });

  play?.addEventListener("click", () => {
    if (timer !== null) {
      stop();
      return;
    }
    if (motionReduced) {
      select(buttons.length - 1);
      return;
    }
    if (index >= buttons.length - 1) select(0);
    play.textContent = play.dataset.pauseLabel || "Pause";
    play.setAttribute("aria-pressed", "true");
    timer = window.setTimeout(advance, 700);
  });

  select(0);
});

const copyByLanguage = {
  zh: {
    legacyShared: {
      title: "Legacy CUDA IPC（共享 IPC 环境）",
      body: "普通 CUDA allocation 可导出 legacy IPC handle。LMCache 使用 PyTorch storage IPC wrapper 恢复 tensor view；不需要 VMM、FD 或 IMEX。",
      badge: "LEGACY IPC",
      transport: "handle metadata",
    },
    legacyIsolated: {
      title: "Raw Legacy CUDA IPC（隔离容器）",
      body: "allocation 仍是普通 CUDA memory。LMCache 使用 driver-level raw IPC handle，避免依赖共享 /dev/shm；这不是 FABRIC handle。",
      badge: "RAW IPC",
      transport: "inline handle",
    },
    fd: {
      title: "VMM + POSIX FD",
      body: "物理 allocation 必须在创建时声明可导出为 POSIX fd。fd 通过 /dev/shm/lmcache_fd_<port>.sock 使用 SCM_RIGHTS 传给 Server；消息里的整数不能代替 fd 本身。",
      badge: "POSIX FD",
      transport: "AF_UNIX + SCM_RIGHTS",
    },
    fabric: {
      title: "VMM + FABRIC handle",
      body: "allocation 必须支持 CU_MEM_HANDLE_TYPE_FABRIC。64-byte handle 可随 descriptor 传输，但 exporter 与 importer 必须能访问同一个 IMEX channel。",
      badge: "FABRIC",
      transport: "64-byte descriptor",
    },
    unsupported: {
      title: "这组条件不能共享 VMM allocation",
      body: "隔离 IPC 不允许依赖共享 /dev/shm，而没有 IMEX 就无法导出可导入的 FABRIC handle。应让 vLLM 回退到 legacy allocation，或为两端提供同一 IMEX channel。",
      badge: "NO PATH",
      transport: "resolve or fail early",
    },
  },
  en: {
    legacyShared: {
      title: "Legacy CUDA IPC (shared IPC environment)",
      body: "A regular CUDA allocation can expose a legacy IPC handle. LMCache rebuilds the tensor view through its PyTorch storage IPC wrapper; VMM, file descriptors, and IMEX are not involved.",
      badge: "LEGACY IPC",
      transport: "handle metadata",
    },
    legacyIsolated: {
      title: "Raw legacy CUDA IPC (isolated containers)",
      body: "The allocation is still regular CUDA memory. LMCache uses a driver-level raw IPC handle to avoid a shared /dev/shm dependency; this is not a FABRIC handle.",
      badge: "RAW IPC",
      transport: "inline handle",
    },
    fd: {
      title: "VMM + POSIX file descriptor",
      body: "The physical allocation must be created as POSIX-fd exportable. LMCache passes the fd over /dev/shm/lmcache_fd_<port>.sock with SCM_RIGHTS; serializing the integer value is not equivalent.",
      badge: "POSIX FD",
      transport: "AF_UNIX + SCM_RIGHTS",
    },
    fabric: {
      title: "VMM + FABRIC handle",
      body: "The allocation must support CU_MEM_HANDLE_TYPE_FABRIC. Its 64-byte handle can travel with the descriptor, but exporter and importer must be authorized for the same IMEX channel.",
      badge: "FABRIC",
      transport: "64-byte descriptor",
    },
    unsupported: {
      title: "These conditions cannot share the VMM allocation",
      body: "Isolated IPC cannot rely on a shared /dev/shm path, while the missing IMEX channel prevents a FABRIC export. vLLM must resolve to a legacy allocation, or both sides need access to the same IMEX channel.",
      badge: "NO PATH",
      transport: "resolve or fail early",
    },
  },
};

document.querySelectorAll("[data-vmm-handle-lab]").forEach((lab) => {
  const language = lab.dataset.lang === "en" ? "en" : "zh";
  const text = copyByLanguage[language];
  const controls = [...lab.querySelectorAll("[data-choice]")];
  const title = lab.querySelector("[data-handle-title]");
  const body = lab.querySelector("[data-handle-copy]");
  const badges = [...lab.querySelectorAll("[data-route-badge]")];
  const badgeTexts = [...lab.querySelectorAll("[data-route-badge-text]")];
  const transports = [...lab.querySelectorAll("[data-route-transport]")];
  const state = { allocation: "vmm", isolated: "false", imex: "false" };

  const resultKey = () => {
    if (state.allocation === "legacy") {
      return state.isolated === "true" ? "legacyIsolated" : "legacyShared";
    }
    if (state.isolated === "false") return "fd";
    if (state.imex === "true") return "fabric";
    return "unsupported";
  };

  const render = () => {
    const key = resultKey();
    const result = text[key];
    lab.classList.toggle("is-error", key === "unsupported");
    controls.forEach((button) => {
      const active = state[button.dataset.choice] === button.dataset.value;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (title) title.textContent = result.title;
    if (body) body.textContent = result.body;
    badges.forEach((badge) => badge.classList.toggle("is-error", key === "unsupported"));
    badgeTexts.forEach((badgeText) => {
      badgeText.textContent = result.badge;
      badgeText.classList.toggle("is-error", key === "unsupported");
    });
    transports.forEach((transport) => { transport.textContent = result.transport; });
  };

  controls.forEach((button) => {
    button.addEventListener("click", () => {
      state[button.dataset.choice] = button.dataset.value;
      render();
    });
  });

  render();
});
