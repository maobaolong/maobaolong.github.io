const labs = document.querySelectorAll("[data-ipc-lab]");

for (const lab of labs) {
  const pointer = lab.querySelector("[data-ipc-pointer]");
  const title = lab.querySelector("[data-ipc-title]");
  const copy = lab.querySelector("[data-ipc-copy]");
  const counter = lab.querySelector("[data-ipc-counter]");
  const buttons = [...lab.querySelectorAll("[data-ipc-step]")];
  const playButton = lab.querySelector("[data-ipc-play]");
  const pointerLabel = lab.querySelector("[data-pointer-label]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const labels = {
    read: lab.dataset.labelRead || "read pointer",
    wrong: lab.dataset.labelWrong || "wrong offset",
    fixed: lab.dataset.labelFixed || "stride-aware"
  };

  let currentStep = 0;
  let currentX = 72;
  let frame = 0;
  let timer = 0;
  let sweepTimers = [];

  const setPointer = (x) => {
    currentX = x;
    pointer.setAttribute("transform", `translate(${x} 0)`);
  };

  const clearSweep = () => {
    sweepTimers.forEach((id) => window.clearTimeout(id));
    sweepTimers = [];
  };

  const animateTo = (target, duration = 850) => {
    cancelAnimationFrame(frame);
    if (reducedMotion) {
      setPointer(target);
      return;
    }
    const start = currentX;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setPointer(start + (target - start) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };

  const animateSweep = () => {
    clearSweep();
    const targets = [72, 252, 432, 612];
    targets.forEach((target, index) => {
      const id = window.setTimeout(() => animateTo(target, 520), index * 620);
      sweepTimers.push(id);
    });
  };

  const stop = () => {
    window.clearInterval(timer);
    timer = 0;
    clearSweep();
    if (playButton) playButton.textContent = playButton.dataset.playLabel || "▶ Play";
  };

  const render = (index) => {
    currentStep = index;
    const button = buttons[index];
    const state = button.dataset.state || "normal";
    lab.classList.toggle("is-wrong", state === "wrong" || state === "gated");
    lab.classList.toggle("is-gated", state === "gated");
    lab.classList.toggle("is-fixed", state === "fixed");
    title.textContent = button.dataset.title || "";
    copy.textContent = button.dataset.copy || "";
    counter.textContent = `${index + 1} / ${buttons.length}`;
    pointerLabel.textContent = state === "wrong" || state === "gated" ? labels.wrong : state === "fixed" ? labels.fixed : labels.read;
    buttons.forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === index));
    clearSweep();
    if (state === "fixed") animateSweep();
    else animateTo(Number(button.dataset.x || 72));
  };

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      stop();
      render(index);
    });
  });

  playButton?.addEventListener("click", () => {
    if (timer) {
      stop();
      return;
    }
    playButton.textContent = playButton.dataset.pauseLabel || "Ⅱ Pause";
    render((currentStep + 1) % buttons.length);
    timer = window.setInterval(() => render((currentStep + 1) % buttons.length), 3600);
  });

  setPointer(currentX);
  render(0);
}
