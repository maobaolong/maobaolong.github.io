const AUTOPLAY_MS = 3800;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function initKernelPagingAnimation(root) {
  const copies = [...root.querySelectorAll(".kp-steps li")].map((item) => item.textContent.trim());
  if (!copies.length) return;

  const copy = root.querySelector("[data-kp-copy]");
  const label = root.querySelector("[data-kp-label]");
  const dots = root.querySelector("[data-kp-dots]");
  const play = root.querySelector("[data-kp-play]");
  const kind = root.dataset.kpAnimation;
  let timer = null;
  let userPaused = false;

  copies.forEach((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "kp-dot";
    dot.dataset.kpDot = String(index);
    dot.setAttribute("aria-label", `${index + 1}`);
    dots?.append(dot);
  });

  function render(next) {
    const step = (next + copies.length) % copies.length;
    root.dataset.step = String(step);
    if (copy) copy.textContent = copies[step];
    if (label) label.textContent = `${step + 1} / ${copies.length}`;
    root.querySelectorAll("[data-kp-dot]").forEach((dot) => {
      dot.classList.toggle("is-active", Number(dot.dataset.kpDot) === step);
    });

    if (kind === "mapping") {
      root.querySelectorAll("[data-engine-block]").forEach((item) => {
        item.classList.toggle("is-active", step >= 1);
      });
      root.querySelectorAll("[data-page]").forEach((item) => {
        const page = Number(item.dataset.page);
        item.classList.remove("is-active", "is-wrong", "is-correct");
        if (step === 1 && (page === 3 || page === 7)) item.classList.add("is-wrong");
        if (step >= 2 && [6, 7, 14, 15].includes(page)) item.classList.add("is-correct");
      });
      const result = root.querySelector("[data-kp-result]");
      if (result) result.innerHTML = result.dataset[`step${step}`] || "";
    }

    if (kind === "paths") {
      root.querySelectorAll("[data-path-step]").forEach((item) => {
        item.classList.toggle("is-active", Number(item.dataset.pathStep) <= step);
      });
      root.querySelectorAll("[data-page]").forEach((item) => {
        item.classList.toggle("is-correct", step >= 2);
      });
    }
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    if (play) play.textContent = "▶";
  }

  function start() {
    if (reducedMotion || userPaused) return;
    stop();
    if (play) play.textContent = "Ⅱ";
    timer = window.setInterval(() => render(Number(root.dataset.step || 0) + 1), AUTOPLAY_MS);
  }

  root.querySelector("[data-kp-prev]")?.addEventListener("click", () => {
    userPaused = true; stop(); render(Number(root.dataset.step || 0) - 1);
  });
  root.querySelector("[data-kp-next]")?.addEventListener("click", () => {
    userPaused = true; stop(); render(Number(root.dataset.step || 0) + 1);
  });
  play?.addEventListener("click", () => {
    if (timer) { userPaused = true; stop(); }
    else { userPaused = false; start(); }
  });
  dots?.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-kp-dot]");
    if (!dot) return;
    userPaused = true; stop(); render(Number(dot.dataset.kpDot));
  });
  root.addEventListener("mouseenter", () => { if (timer) stop(); });
  root.addEventListener("mouseleave", () => { if (!userPaused) start(); });

  render(0);
  start();
}

document.querySelectorAll("[data-kp-animation]").forEach(initKernelPagingAnimation);
