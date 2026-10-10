// Hotbar with every placeable overworld item. Static list: no dimension
// swaps, no unlock gating. Wheel / K / L / click all select.
import {
  GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, WATER,
  FLOWER, TNT, PORTAL, OBSIDIAN,
} from "../core/blocks.js";
import { materialsFor } from "../core/textures.js";

export const HOTBAR = [
  GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES,
  WATER, FLOWER, TNT, PORTAL, OBSIDIAN,
];

export let selected = 0;
const el = () => document.getElementById("hotbar");

function iconSrc(id) {
  const map = materialsFor(id)[0].map;
  return map.image.toDataURL();
}

export function selectedId() {
  return HOTBAR[selected];
}

export function buildHotbar() {
  const bar = el();
  bar.innerHTML = "";
  HOTBAR.forEach((id, i) => {
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
  selected = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
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
