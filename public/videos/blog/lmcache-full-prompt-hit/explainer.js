for (const figure of document.querySelectorAll(".last-token-video")) {
  const video = figure.querySelector("video");
  for (const link of figure.querySelectorAll("[data-video-start]")) {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      video.currentTime = Number(link.dataset.videoStart);
      video.scrollIntoView({ block: "center" });
      video.play().catch(() => {});
    });
  }
}

for (const demo of document.querySelectorAll("[data-last-token-demo]")) {
  const controls = demo.querySelector("[data-controls]");
  const buttons = [...demo.querySelectorAll("[data-step]")];
  const states = [...demo.querySelectorAll("[data-state]")];
  const play = demo.querySelector("[data-play]");
  const tail = demo.querySelector("[data-tail-label]");
  let current = 0;
  let timer;

  function show(index) {
    current = index;
    demo.dataset.phase = String(index);
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    states.forEach((state, i) => { state.hidden = i !== index; });
    tail.textContent = states[index].dataset.tail;
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = play.dataset.start;
  }

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      stop();
      show(index);
    });
  });

  play.addEventListener("click", () => {
    if (timer !== undefined) {
      stop();
      return;
    }
    if (current === states.length - 1) show(0);
    play.textContent = play.dataset.stop;
    timer = setInterval(() => {
      show(current + 1);
      if (current === states.length - 1) stop();
    }, 2400);
  });

  controls.hidden = false;
}
