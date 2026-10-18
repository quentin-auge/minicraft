// Hotbar as a dynamic item list: entries can be added, removed, or swapped
// at runtime (altitude bands, future dimensions), and the bar re-renders
// around the change. Selection is tracked by item id, so it survives list
// mutations; it clamps only when its own item disappears. Wheel / K / L /
// click all select with wraparound over the live list.
import {
  GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, WATER,
  FLOWER, TNT, MEGA_TNT, ULTRA_TNT, PORTAL, OBSIDIAN,
} from "../core/blocks.js";
import { materialsFor } from "../core/textures.js";

const BASE_ITEMS = [
  GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES,
  WATER, FLOWER, TNT, MEGA_TNT, ULTRA_TNT, PORTAL, OBSIDIAN,
];

let items = BASE_ITEMS.slice();
let selectedItem = items[0];

export let selected = 0;
const el = () => document.getElementById("hotbar");

function iconSrc(id) {
  const map = materialsFor(id)[0].map;
  return map.image.toDataURL();
}

function clampSelection() {
  const i = items.indexOf(selectedItem);
  selected = i >= 0 ? i : Math.min(selected, items.length - 1);
  if (items.length) selectedItem = items[selected];
}

export function getItems() {
  return items.slice();
}

export function resetItems() {
  items = BASE_ITEMS.slice();
  clampSelection();
  buildHotbar();
}

// Insert id at `at` (default: append); no-op when already listed.
export function addItem(id, at = items.length) {
  if (items.includes(id)) return;
  items.splice(Math.max(0, Math.min(at, items.length)), 0, id);
  clampSelection();
  buildHotbar();
}

// Drop id from the list; the selection follows its item, clamping only
// when the selected item itself is removed.
export function removeItem(id) {
  const i = items.indexOf(id);
  if (i < 0) return;
  items.splice(i, 1);
  clampSelection();
  buildHotbar();
}

// Replace the entry at `index` with id.
export function setItem(index, id) {
  if (index < 0 || index >= items.length) return;
  items[index] = id;
  clampSelection();
  buildHotbar();
}

export function selectedId() {
  return items[selected];
}

export function buildHotbar() {
  const bar = el();
  bar.innerHTML = "";
  items.forEach((id, i) => {
    const slot = document.createElement("div");
    slot.className = "slot" + (i === selected ? " selected" : "");
    const img = document.createElement("img");
    img.src = iconSrc(id);
    img.alt = String(id);
    slot.appendChild(img);
    slot.addEventListener("click", () => select(i));
    bar.appendChild(slot);
  });
}

export function select(i) {
  if (!items.length) return;
  selected = ((i % items.length) + items.length) % items.length;
  selectedItem = items[selected];
  [...el().children].forEach((c, j) => c.classList.toggle("selected", j === selected));
}

let lastWheelT = 0;
export function initHotbarInput(isLoading) {
  document.addEventListener("wheel", (e) => {
    if (isLoading()) return;
    const now = performance.now();
    if (now - lastWheelT < 50) return;
    lastWheelT = now;
    select(selected + (e.deltaY > 0 ? -1 : 1));
  }, { passive: true });
}
