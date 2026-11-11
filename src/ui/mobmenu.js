// Cheat spawn float (hold B, requires ?cheat=1). Opens centered and unlocked
// like a modal (sim pauses behind it, free mouse: default arrow off-panel,
// hand on-panel); releasing B hides it and keeps the live-toggled selection
// (release = save, no Ok/Cancel). Up/Down move the cursor, Space or a row
// click toggles; Enter and Escape do nothing on the float — only the release
// closes it. A quick tap of B (<250 ms) never opens the menu: main.js spawns
// the next ticked kind on keyup.
import { moveCursor, toggleAtCursor } from "../mobs/spawn.js";
import { registerMenu, openModal, closeModal } from "./menus.js";

export let mobMenuOpen = false;

let menuCatalog = [];
let menuSelection = null;

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
  mobMenuOpen = true;
  renderMobMenu();
  openModal(el());
}

// Release = save: the selection was toggled live, nothing to restore.
export function closeMobMenu() {
  mobMenuOpen = false;
  closeModal(el());
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

// Kept as a no-op for callers: floating needs no button wiring (no Ok/Cancel,
// the release closes, saves, and re-locks).
export function initMobMenu() {}

registerMenu({
  key: "spawn",
  layer: "float",
  isOpen: () => mobMenuOpen,
  // Paused like a modal: nav keys act, then everything is consumed (Enter
  // and Escape included, with no effect) so game input freezes with the sim.
  onKeydown(e) {
    if (!mobMenuOpen) return false;
    if (e.code === "ArrowUp") { mobMenuMove(-1); e.preventDefault(); return true; }
    if (e.code === "ArrowDown") { mobMenuMove(1); e.preventDefault(); return true; }
    if (e.code === "Space") {
      if (!e.repeat) mobMenuToggle();
      e.preventDefault();
      return true;
    }
    e.preventDefault();
    return true;
  },
  onKeyup(e) {
    if (e.code === "KeyB" && mobMenuOpen) {
      closeMobMenu();
      e.preventDefault();
      return true;
    }
    return false;
  },
});
