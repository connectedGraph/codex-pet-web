window.pet = WebPet.create({
  id: "demo-pet",
  spriteSheet: "./assets/codex-spritesheet.webp",
  initialState: "idle",
  width: 128,
  position: { right: 28, bottom: 26 },
  persistenceKey: "codex-pet-web-demo-position",
  draggable: true,
  clickAction: "toggle-playback",
});

const stateButtons = [...document.querySelectorAll("[data-state]")];
const stateValue = document.querySelector("#stateValue");
const positionValue = document.querySelector("#positionValue");
const versionValue = document.querySelector("#versionValue");
const pauseButton = document.querySelector("#pauseButton");
const hideButton = document.querySelector("#hideButton");
const spriteInput = document.querySelector("#spriteInput");
const sizeRange = document.querySelector("#sizeRange");
const sizeOutput = document.querySelector("#sizeOutput");

versionValue.textContent = WebPet.version;

function sync(snapshot = pet.snapshot()) {
  stateValue.textContent = snapshot.state;
  positionValue.textContent = `${Math.round(snapshot.position.x)}, ${Math.round(snapshot.position.y)}`;
  pauseButton.textContent = snapshot.paused ? "继续动画" : "暂停动画";
  hideButton.textContent = snapshot.visible ? "隐藏宠物" : "显示宠物";
  stateButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.state === snapshot.state));
  });
}

stateButtons.forEach((button) => {
  button.addEventListener("click", () => pet.setState(button.dataset.state));
});

document.querySelector("#walkLeft").addEventListener("click", () => {
  pet.motion.walkTo(28, pet.position.y, { duration: 1100 }).catch(() => {});
});

document.querySelector("#walkRight").addEventListener("click", () => {
  const targetX = window.innerWidth - pet.snapshot().size.width - 28;
  pet.motion.walkTo(targetX, pet.position.y, { duration: 1100 }).catch(() => {});
});

document.querySelector("#jumpButton").addEventListener("click", () => {
  pet.motion.jump({ height: 72, duration: 650 }).catch(() => {});
});

document.querySelector("#centerButton").addEventListener("click", () => {
  const size = pet.snapshot().size;
  pet.motion
    .moveTo(
      (window.innerWidth - size.width) / 2,
      (window.innerHeight - size.height) / 2,
      { duration: 650, easing: "easeInOut" },
    )
    .catch(() => {});
});

pauseButton.addEventListener("click", () => pet.toggle());
hideButton.addEventListener("click", () => (pet.visible ? pet.hide() : pet.show()));

spriteInput.addEventListener("change", () => {
  const file = spriteInput.files?.[0];
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  pet.setSpriteSheet(objectUrl);
});

sizeRange.addEventListener("input", () => {
  pet.setSize(Number(sizeRange.value));
  sizeOutput.textContent = `${sizeRange.value}px`;
});

pet.on("statechange", sync);
pet.on("move", sync);
pet.on("play", sync);
pet.on("pause", sync);
pet.on("show", sync);
pet.on("hide", sync);
pet.on("resize", sync);
sync();
