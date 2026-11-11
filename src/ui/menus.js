// Generic menu registry: every overlay (help, spawn picker, pause) registers
// once, and main.js routes keys plus the pause/mousedown gates through here
// instead of naming each menu. Layers: "modal" (start/pause panels), then
// the single "overlay" (pause, derived from lock state), plus "float"
// (hold-to-show panels: help on H, spawn picker on B). Floats open centered
// and pause the sim behind them: the spawn float releases pointer lock on
// open so the mouse runs free (default arrow off-panel, hand on-panel),
// while the help float keeps the lock (no mouse on help — pure readout).
// The hold key still closes them on release (B keeps the live selection,
// Enter/Escape do nothing on floats). Open floats consume every keydown
// like modals; releases route through routeMenuKeyUp.
// Three-free (no DOM): specs and ctx are injected, so dispatch and the
// resume policy stay headless-testable.
const specs = [];

export function registerMenu(spec) {
  if (!spec?.key || typeof spec.isOpen !== "function" ||
    (typeof spec.onKeydown !== "function" && typeof spec.onKeyup !== "function") ||
    specs.some((s) => s.key === spec.key)) throw new Error(`Invalid or duplicate menu: ${spec?.key}`);
  const entry = { layer: "modal", ...spec };
  specs.push(entry);
  return entry;
}

const modals = () => specs.filter((s) => s.layer === "modal");
const floats = () => specs.filter((s) => s.layer === "float");
const overlay = () => specs.find((s) => s.layer === "overlay");

export function anyModalOpen() {
  return modals().some((m) => m.isOpen());
}

export function anyFloatOpen() {
  return floats().some((f) => f.isOpen());
}

// Modals + floats: every centered panel needing the pause/mousedown guards.
export function anyPanelOpen() {
  return anyModalOpen() || anyFloatOpen();
}

export function anyMenuOpen() {
  const over = overlay();
  return anyPanelOpen() || (over ? over.isOpen() : false);
}

// Route one keydown: topmost open modal consumes unconditionally (game input
// freezes with the sim behind it); otherwise the topmost open float consumes
// unconditionally too (paused like a modal — Enter/Escape included, with no
// effect); otherwise the open overlay consumes only what its onKeydown
// reports. Returns true when the key is consumed.
export function routeMenuKey(e, ctx) {
  const ms = modals();
  for (let i = ms.length - 1; i >= 0; i--) {
    if (ms[i].isOpen()) {
      ms[i].onKeydown(e, ctx);
      return true;
    }
  }
  const fs = floats();
  for (let i = fs.length - 1; i >= 0; i--) {
    if (fs[i].isOpen()) {
      if (typeof fs[i].onKeydown === "function") fs[i].onKeydown(e, ctx);
      return true;
    }
  }
  const over = overlay();
  if (over && over.isOpen()) return !!over.onKeydown(e, ctx);
  return false;
}

// Route one keyup: every float sees it (reverse registration order) so a
// hold-to-show panel closes on release even when another float is above it.
// Modals and the overlay never see keyups. Returns true when consumed.
export function routeMenuKeyUp(e, ctx) {
  const fs = floats();
  let consumed = false;
  for (let i = fs.length - 1; i >= 0; i--) {
    if (typeof fs[i].onKeyup === "function") {
      if (fs[i].onKeyup(e, ctx)) consumed = true;
    }
  }
  return consumed;
}

// Shared open/close: showing a modal always releases pointer lock (every
// menu opens unlocked — spawn picker, Play start, pause), hiding one
// only hides it (the close path re-locks via resumePointer). The spawn
// float shares the modal open (centered, unlocked, pausing); the help
// float uses openFloat instead (centered, pausing, lock kept so no mouse).
// Document access
// is guarded so the module stays three-free and headless-testable with a
// stub element.
export function openFloat(floatEl) {
  floatEl.style.display = "flex";
}

export function openModal(modalEl) {
  modalEl.style.display = "flex";
  if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
}

export function closeModal(modalEl) {
  modalEl.style.display = "none";
}

// Shared close policy: hint toasts click-to-resume; defer postpones the
// relock past the browser's Esc-gesture cooldown (a lock requested from an
// Esc keydown is instantly undone, showing the pause menu instead) and fails
// silently elsewhere via canResume; direct relocks at once (every modal
// opens unlocked, so the direct path always has a lock to retake).
// schedule is injectable so tests never wait on wall-clock time.
export function resumePointer(ctx, { hint, defer }, schedule = setTimeout) {
  if (hint) ctx.toast("Click to resume");
  if (defer) {
    schedule(() => {
      if (ctx.canResume()) ctx.requestLock();
    }, 150);
  } else ctx.requestLock();
}
