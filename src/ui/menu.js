// Start menu: Play is clickable from the first frame but entry waits for
// the first rendered world frame (see pendingPlay in main.js); Resume
// re-locks pointer; New World generates a fresh seed. No backdrop veil:
// the world shows through behind the menu; the panel is solid (#1c2030,
// same as help). The game is fully static, no saves. Only New World waits
// on a running build (double-regen protection); everything else stays
// clickable, with no spinner.
export let started = false;
export let locked = false;

const overlay = () => document.getElementById("overlay");
const crosshair = () => document.getElementById("crosshair");
const hotbar = () => document.getElementById("hotbar");
const playBtn = () => document.getElementById("btnPlay");
const resumeBtn = () => document.getElementById("btnResume");
const newBtn = () => document.getElementById("btnNew");

function refreshButtons() {
  playBtn().style.display = started ? "none" : "";
  resumeBtn().style.display = (!locked && started) ? "block" : "none";
  newBtn().style.display = started ? "block" : "none";
}

export function isLocked() {
  return locked;
}

export function requestLock(renderer) {
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

export function enterGame(renderer) {
  started = true;
  overlay().style.display = "none";
  crosshair().style.display = "block";
  hotbar().style.display = "flex";
  refreshButtons();
  requestLock(renderer);
}

export function initMenu(renderer, onPlay, onNewWorld, isHelpOpen, isBuilding) {
  refreshButtons();
  overlay().addEventListener("click", () => {
    if (!started) return;
    requestLock(renderer);
  });
  playBtn().addEventListener("click", async (e) => {
    e.stopPropagation();
    if (started) return;
    await onPlay();
  });
  newBtn().addEventListener("click", async (e) => {
    e.stopPropagation();
    if (isBuilding() || !started) return;
    await onNewWorld();
  });
  resumeBtn().addEventListener("click", (e) => {
    e.stopPropagation();
    if (started) requestLock(renderer);
  });
  renderer.domElement.addEventListener("click", () => {
    if (started && !locked && !isHelpOpen()) requestLock(renderer);
  });
  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (isHelpOpen()) return;
    // Pre-start lock (Play clicked mid-build) never hides the menu: entry
    // happens on the first rendered world frame, which hides it itself.
    if (!started) { refreshButtons(); return; }
    overlay().style.display = locked ? "none" : "flex";
    crosshair().style.display = locked ? "block" : "none";
    hotbar().style.display = locked ? "flex" : "none";
    refreshButtons();
  });
}
