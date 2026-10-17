// Procedural canvas textures and per-block materials, ported from master.
// Kept as-is (lighting/fog behavior included); clouds/moon entries dropped
// since those blocks are never generated in the static build.
import * as THREE from "three";
import {
  GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, PLANKS, GLASS,
  TNT, MEGA_TNT, FLOWER, PORTAL, OBSIDIAN,
} from "./blocks.js";

export function canvasTex(draw, size = 16) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pxNoise(ctx, base, amount, chance = 1) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (Math.random() > chance) continue;
    const d = (Math.random() - 0.5) * amount;
    ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

const makeTex = (base, amount = 24) => canvasTex((ctx) => {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, 16, 16);
  pxNoise(ctx, base, amount);
});

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Linear mix of two rgb triples; tints the outward pocket veil toward the
// liquid color so every liquid tints its own ghosts without per-kind forks.
function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const TEX = {
  grass_top: canvasTex((ctx) => {
    ctx.fillStyle = "#6ab04c"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [106, 176, 76], 20);
    for (let x = 0; x < 16; x++) if (Math.random() < 0.2) { ctx.fillStyle = "#8fce6b"; ctx.fillRect(x, 2 + Math.random() * 2, 1, 1); }
  }),
  grass_side: canvasTex((ctx) => {
    ctx.fillStyle = "#8a5a35"; ctx.fillRect(0, 4, 16, 12);
    pxNoise(ctx, [138, 90, 53], 22);
    ctx.fillStyle = "#6ab04c"; ctx.fillRect(0, 0, 16, 4);
    pxNoise(ctx, [106, 176, 76], 18, 0.9);
    for (let x = 0; x < 16; x++) if (Math.random() < 0.35) { ctx.fillStyle = "#8fce6b"; ctx.fillRect(x, 3, 1, 1); }
  }),
  dirt: makeTex([138, 90, 53], 26),
  stone: canvasTex((ctx) => {
    ctx.fillStyle = "#8d8d8d"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [141, 141, 141], 16);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 3, 4, 1); ctx.fillRect(6, 9, 5, 1); ctx.fillRect(11, 1, 3, 1); ctx.fillRect(3, 13, 4, 1);
  }),
  sand: makeTex([222, 207, 142], 14),
  log_side: canvasTex((ctx) => {
    ctx.fillStyle = "#6b4a2f"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [107, 74, 47], 16);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 3, 16, 1); ctx.fillRect(0, 8, 16, 1); ctx.fillRect(0, 13, 16, 1);
  }),
  log_top: canvasTex((ctx) => {
    ctx.fillStyle = "#8f6a3d"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [143, 106, 61], 14);
    ctx.strokeStyle = "#5d4026"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(8, 8, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, 8, 2, 0, Math.PI * 2); ctx.stroke();
  }),
  leaves: canvasTex((ctx) => {
    ctx.fillStyle = "#2e7d32"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [46, 125, 50], 22);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = Math.random() < 0.5 ? "#3f9145" : "#256a2a"; ctx.fillRect(Math.random() * 16, Math.random() * 16, 1, 1); }
  }),
  planks: canvasTex((ctx) => {
    ctx.fillStyle = "#b98a4e"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [185, 138, 78], 12);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let y = 0; y < 4; y++) ctx.fillRect(0, y * 4, 16, 1);
    ctx.fillRect(4, 0, 1, 4); ctx.fillRect(11, 4, 1, 4); ctx.fillRect(6, 8, 1, 4); ctx.fillRect(13, 12, 1, 4);
  }),
  tnt_side: canvasTex((ctx) => {
    ctx.fillStyle = "#c0392b"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 16, 64, 32);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const red = y < 16 || y > 47;
      const base = red ? [192, 57, 43] : [236, 230, 208];
      const d = (Math.random() - 0.5) * (red ? 14 : 8);
      ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 32, 32);
  }, 64),
  tnt_top: canvasTex((ctx) => {
    ctx.fillStyle = "#c0392b"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [192, 57, 43], 12);
  }),
  mega_side: canvasTex((ctx) => {
    ctx.fillStyle = "#1e3fae"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 16, 64, 32);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const blue = y < 16 || y > 47;
      const base = blue ? [30, 63, 174] : [236, 230, 208];
      const d = (Math.random() - 0.5) * (blue ? 14 : 8);
      ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = "#101828";
    ctx.font = "bold 24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 32, 32);
  }, 64),
  mega_top: canvasTex((ctx) => {
    ctx.fillStyle = "#1e3fae"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [30, 63, 174], 12);
  }),
  glass: canvasTex((ctx) => {
    ctx.fillStyle = "rgba(190,230,255,0.55)"; ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, 14.5, 14.5);
    ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(8, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(15, 8); ctx.stroke();
  }),
  obsidian: canvasTex((ctx) => {
    ctx.fillStyle = "#12070f"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [24, 12, 20], 18);
    ctx.fillStyle = "rgba(96,58,132,0.35)";
    for (let i = 0; i < 7; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 1 + Math.random() * 2, 1 + Math.random() * 2);
    ctx.fillStyle = "rgba(24,10,26,0.9)";
    ctx.fillRect(2, 7, 2, 1); ctx.fillRect(6, 12, 1, 1); ctx.fillRect(10, 3, 2, 1); ctx.fillRect(13, 9, 1, 1);
  }),
  flower: canvasTex((ctx) => {
    const petals = ["rgb(232,30,52)", "rgb(56,106,252)", "rgb(248,188,16)", "rgb(16,204,186)", "rgb(244,132,34)", "rgb(160,80,224)", "rgb(232,30,52)", "rgb(56,106,252)"];
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "#4a9c3a"; ctx.fillRect(7, 9, 2, 6);
    ctx.fillStyle = "#4a9c3a"; ctx.fillRect(3, 12, 2, 1); ctx.fillRect(11, 13, 2, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = 8 + Math.round(Math.cos(a) * 3);
      const py = 4 + Math.round(Math.sin(a) * 3);
      ctx.fillStyle = petals[i];
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    ctx.fillStyle = "#ffd23f"; ctx.fillRect(7, 3, 2, 2);
  }),
  portal: canvasTex((ctx) => {
    ctx.fillStyle = "#3a0d6b"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#9b30ff";
    for (let y = 0; y < 16; y += 2) for (let x = ((y / 2) % 2) * 2; x < 16; x += 4) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = "#d9a6ff";
    ctx.fillRect(7, 4, 2, 8);
  }),
};

export function material(map, opts = {}) {
  return new THREE.MeshLambertMaterial({ map, ...opts });
}

// Liquid surfaces: two roles, one registry. `outside` is the liquid color,
// drawn blue on both sides of every bound (FrontSide outside sheet +
// coplanar blue BackSide sheet, tops stronger since they read against
// bright ground showing through); pocket bounds use depth-writing blue
// variants so the near wall occludes the far wall. `pocket` is trapped air:
// a plain white inward veil for divers, a plain light-blue outward veil
// (`outOpacity`, `outTint` toward the liquid color) for open-air eyes — no
// ring patterns anywhere. Both veils gate on the eye medium in mesher.js, so
// pocket interiors keep pure blue. All unlit
// so tone is identical from every angle. Open-sea sheets keep no depth write
// so shallows stay see-through; only pocket-bound sheets write depth, so each
// pocket shows exactly one face.
// New liquids register a spec; the mesher dispatches through it without
// framework forks.
const LIQUID_DEFAULTS = {
  outside: { color: "#2f66cc", opacity: 0.7, topOpacity: 0.9, grain: 16 },
  pocket: { color: "#f2fcff", opacity: 0.3, outOpacity: 0.35, outTint: 0.65, grain: 5 },
};
export const LIQUID_SURFACE = [
  { liquid: WATER, key: "water" },
];
const liquidSpecById = new Map(LIQUID_SURFACE.map((s) => [s.liquid, s]));
// One table maps every visual role to its look: which side renders, which
// registry spec supplies color/opacity (`spec`), which painted texture
// (`tex`, keyed `<liquid>_<tex>` below), whether the sheet writes depth
// (pocket bounds only, so each pocket shows one face; open-sea sheets stay
// depthless to keep shallows see-through), and whether opacity comes from
// `outOpacity` (`out`, the open-air veil only).
const ROLE_STYLE = {
  outside: { side: THREE.FrontSide, spec: "outside", tex: "outside", depthWrite: false },
  inner: { side: THREE.BackSide, spec: "outside", tex: "outside", depthWrite: false },
  pocketblue: { side: THREE.FrontSide, spec: "outside", tex: "outside", depthWrite: true },
  pocketblueback: { side: THREE.BackSide, spec: "outside", tex: "outside", depthWrite: true },
  "pocket-out": { side: THREE.DoubleSide, spec: "pocket", tex: "pocketout", depthWrite: true, out: true },
  "pocket-in": { side: THREE.BackSide, spec: "pocket", tex: "pocket", depthWrite: true },
};
function liquidSpec(id, specKey) {
  const entry = liquidSpecById.get(id) || liquidSpecById.get(WATER);
  return { ...LIQUID_DEFAULTS[specKey], ...(entry[specKey] || {}) };
}
// Paint every liquid × role texture from the registry above, keyed
// `<key>_<role>`. The water outside texture keeps its short alias since the
// hotbar icon reads TEX.water. `inner` and both pocket-blue variants reuse
// the outside texture (blue everywhere); `pocket` stays plain white while
// `pocketout` mixes white toward the liquid color (plain light blue outside).
for (const entry of LIQUID_SURFACE) {
  const outSpec = { ...LIQUID_DEFAULTS.outside, ...(entry.outside || {}) };
  const pocketSpec = { ...LIQUID_DEFAULTS.pocket, ...(entry.pocket || {}) };
  const outBase = hexToRgb(outSpec.color);
  TEX[entry.key + "_outside"] = makeTex(outBase, outSpec.grain);
  TEX[entry.key + "_pocket"] = makeTex(hexToRgb(pocketSpec.color), pocketSpec.grain);
  TEX[entry.key + "_pocketout"] = makeTex(
    mixRgb(hexToRgb(pocketSpec.color), outBase, pocketSpec.outTint ?? 0.65),
    pocketSpec.grain);
}
TEX.water = TEX.water_outside;
const liquidMatCache = new Map();
export function liquidSurfaceMat(id, role, top = false) {
  const k = id + ":" + role + (top ? ":top" : "");
  if (!liquidMatCache.has(k)) {
    const entry = liquidSpecById.get(id) || liquidSpecById.get(WATER);
    const style = ROLE_STYLE[role];
    const spec = liquidSpec(id, style.spec);
    const opacity = style.out ? spec.outOpacity ?? spec.opacity
      : top ? spec.topOpacity ?? spec.opacity : spec.opacity;
    liquidMatCache.set(k, new THREE.MeshBasicMaterial({
      map: TEX[entry.key + "_" + style.tex],
      transparent: true,
      opacity,
      depthWrite: style.depthWrite,
      side: style.side,
    }));
  }
  return liquidMatCache.get(k);
}

export function faceTex(map, opts = {}) {
  return [material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts)];
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z
export function materialsFor(id) {
  switch (id) {
    case GRASS: {
      const side = material(TEX.grass_side);
      return [side, side, material(TEX.grass_top), material(TEX.dirt), side, side];
    }
    case DIRT: return faceTex(TEX.dirt);
    case STONE: return faceTex(TEX.stone);
    case SAND: return faceTex(TEX.sand);
    case LOG: {
      const s = material(TEX.log_side), t = material(TEX.log_top);
      return [s, s, t, t, s, s];
    }
    case LEAVES: return faceTex(TEX.leaves);
    case PLANKS: return faceTex(TEX.planks);
    case GLASS: return faceTex(TEX.glass, { transparent: true, opacity: 0.8, depthWrite: false });
    case WATER: return faceTex(TEX.water, { transparent: true, opacity: 0.65, depthWrite: false });
    case FLOWER: return faceTex(TEX.flower, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    case TNT:
      return [material(TEX.tnt_side), material(TEX.tnt_side), material(TEX.tnt_top), material(TEX.tnt_top), material(TEX.tnt_side), material(TEX.tnt_side)];
    case MEGA_TNT:
      return [material(TEX.mega_side), material(TEX.mega_side), material(TEX.mega_top), material(TEX.mega_top), material(TEX.mega_side), material(TEX.mega_side)];
    case PORTAL: return faceTex(TEX.portal);
    case OBSIDIAN: return faceTex(TEX.obsidian);
    default: return faceTex(TEX.dirt);
  }
}
