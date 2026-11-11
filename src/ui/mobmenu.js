// Cheat spawn menu (hold B). Pauses the sim while open like help. Ok and
// Enter validate and relock, Cancel reverts; Esc only closes without relock
// (a lock requested from an Esc gesture is instantly undone by the browser),
// click resumes like help. A tap of B places the next selected kind.
import { moveCursor, toggleAtCursor } from "../mobs/spawn.js";

export let mobMenuOpen = false;

let menuCatalog = [];
let menuSelection = null;
let menuSnapshot = null;

const el = () => document.getElementById("mobmenu");
const list = () => document.getElementById("moblist");

export function isMobMenuOpen() {
  return mobMenuOpen;
}

export function renderMobMenu() {
  const box = list();
  if (!box) return;
  box.innerHTML = "";
  menuCatalog.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "row" + (menuSelection && i === menuSelection.cursor ? " cursor" : "");
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = menuSelection && menuSelection.keys.has(entry.key) ? "[x]" : "[ ]";
    const name = document.createElement("span");
    name.textContent = entry.label;
    row.appendChild(tick);
    row.appendChild(name);
    row.addEventListener("click", () => {
      if (!menuSelection) return;
      menuSelection.cursor = i;
      toggleAtCursor(menuSelection, menuCatalog);
      renderMobMenu();
    });
    box.appendChild(row);
  });
}

export function openMobMenu(catalog, selection) {
  menuCatalog = catalog;
  menuSelection = selection;
  menuSnapshot = selection ? { keys: new Set(selection.keys), cursor: selection.cursor } : null;
  mobMenuOpen = true;
  renderMobMenu();
  el().style.display = "flex";
  if (document.pointerLockElement) document.exitPointerLock();
}

export function closeMobMenu() {
  mobMenuOpen = false;
  el().style.display = "none";
}

// Ok keeps the live-toggled selection; Cancel restores the opening snapshot.
export function mobMenuOk() {
  menuSnapshot = null;
  closeMobMenu();
}

export function mobMenuCancel() {
  if (menuSelection && menuSnapshot) {
    menuSelection.keys = new Set(menuSnapshot.keys);
    menuSelection.cursor = menuSnapshot.cursor;
  }
  menuSnapshot = null;
  closeMobMenu();
}

export function mobMenuMove(delta) {
  if (!menuSelection) return;
  moveCursor(menuSelection, menuCatalog, delta);
  renderMobMenu();
}

export function mobMenuToggle() {
  if (!menuSelection) return;
  toggleAtCursor(menuSelection, menuCatalog);
  renderMobMenu();
}

export function initMobMenu(requestLock) {
  document.getElementById("btnMobOk").addEventListener("click", () => {
    mobMenuOk();
    requestLock();
  });
  document.getElementById("btnMobCancel").addEventListener("click", () => {
    mobMenuCancel();
    requestLock();
  });
  el().addEventListener("click", (e) => {
    if (e.target === el()) {
      mobMenuOk();
      requestLock();
    }
  });
}
