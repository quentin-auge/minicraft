// Start menu: Play enters the pre-built world; Resume re-locks pointer;
// New World generates a fresh seed. The overlay is translucent so the
// world shows through; the game is fully static, no saves.
export let started = false;
export let locked = false;
export let loading = false;

const overlay = () => document.getElementById("overlay");
const crosshair = () => document.getElementById("crosshair");
const hotbar = () => document.getElementById("hotbar");
const playBtn = () => document.getElementById("btnPlay");
const resumeBtn = () => document.getElementById("btnResume");
const newBtn = () => document.getElementById("btnNew");
const loadingEl = () => document.getElementById("loading");

function refreshButtons() {
  playBtn().style.display = started ? "none" : "";
  resumeBtn().style.display = (!locked && started) ? "block" : "none";
  newBtn().style.display = started ? "block" : "none";
}

export function setLoading(on) {
  loading = on;
  loadingEl().style.display = on ? "flex" : "none";
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

export function initMenu(renderer, onPlay, onNewWorld, isHelpOpen) {
  refreshButtons();
  overlay().addEventListener("click", () => {
    if (!started || loading) return;
    requestLock(renderer);
  });
  playBtn().addEventListener("click", async (e) => {
    e.stopPropagation();
    if (loading || started) return;
    await onPlay();
  });
  newBtn().addEventListener("click", async (e) => {
    e.stopPropagation();
    if (loading || !started) return;
    await onNewWorld();
  });
  resumeBtn().addEventListener("click", (e) => {
    e.stopPropagation();
    if (started && !loading) requestLock(renderer);
  });
  renderer.domElement.addEventListener("click", () => {
    if (started && !locked && !isHelpOpen() && !loading) requestLock(renderer);
  });
  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (isHelpOpen() || loading) return;
    overlay().style.display = locked ? "none" : "flex";
    crosshair().style.display = locked ? "block" : "none";
    hotbar().style.display = locked ? "flex" : "none";
    refreshButtons();
  });
}
