// Glowstone color variants, ported from master. Each palette drives both the
// block texture and the color of the projected light. Textures are lifted
// brighter on purpose (drawn unlit, so a brighter texture reads as a brighter
// block); each color is lifted only along its dominant channels so the hue
// stays pure instead of washing toward white. Green already pops, so its
// lift is half the others'; blue and turquoise are drawn as-is (`flat`).
// Placed stones cluster: a block placed within CLUSTER_DIST of an existing
// one inherits its color, otherwise it rolls a fresh random one.
// Three-free (plain maps, no canvas/THREE) so worldgen and the headless
// harness can use it; texture derivation lives in `core/textures.js`.
import { GLOWSTONE } from "../core/blocks.js";
import { key, keyXYZ, dim } from "../core/store.js";

export const CLUSTER_DIST = 10;
// Hotbar icon / fallback texture variant (yellow, like master).
export const GLOW_ICON_VARIANT = 3;

const VARIANT_DEFAULTS = { lift: 0.8 };

export const GLOW_VARIANTS = [
  { ...VARIANT_DEFAULTS, key: "green", base: [14, 92, 28], bright: [61, 255, 122], glow: 0x3dff7a, lift: 0.4 },
  { ...VARIANT_DEFAULTS, key: "red", base: [92, 16, 32], bright: [255, 61, 92], glow: 0xff3d5c },
  { ...VARIANT_DEFAULTS, key: "blue", base: [40, 80, 255], bright: [140, 200, 255], glow: 0x3d8aff, flat: true },
  { ...VARIANT_DEFAULTS, key: "yellow", base: [92, 74, 14], bright: [255, 229, 61], glow: 0xffe53d },
  { ...VARIANT_DEFAULTS, key: "orange", base: [92, 50, 14], bright: [255, 150, 30], glow: 0xff9620 },
  { ...VARIANT_DEFAULTS, key: "purple", base: [58, 14, 92], bright: [178, 61, 255], glow: 0xb23dff, thresh: 0.7 },
  { ...VARIANT_DEFAULTS, key: "turquoise", base: [0, 190, 215], bright: [150, 250, 255], glow: 0x00cdde, flat: true },
];

export const GLOW_VARIANT_COUNT = GLOW_VARIANTS.length;

function makeMaps() {
  return new Map();
}

// Color per block, kept per dimension (block keys don't include the dim).
import { DIMENSION_KEYS } from "../core/store.js";
const fromKeys = (make) => Object.fromEntries(DIMENSION_KEYS.map((k) => [k, make()]));
const glowVariants = fromKeys(() => makeMaps());
// Live GLOWSTONE block index per dimension, so clustering and light buckets
// iterate just the stones instead of scanning the whole world map.
const glowstoneSets = fromKeys(() => new Set());

// A placed glowstone inherits the color of the nearest glowstone within
// CLUSTER_DIST (so builds cluster by color); otherwise it rolls a fresh one.
export function glowVariantNear(x, y, z) {
  const set = glowstoneSets[dim];
  const gv = glowVariants[dim];
  let best = -1, bestD = CLUSTER_DIST * CLUSTER_DIST;
  for (const k of set) {
    const [tx, ty, tz] = keyXYZ(k);
    if (Math.abs(tx - x) > CLUSTER_DIST || Math.abs(ty - y) > CLUSTER_DIST || Math.abs(tz - z) > CLUSTER_DIST) continue;
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD) {
      const v = gv.get(k);
      if (v !== undefined) { best = v; bestD = d2; }
    }
  }
  return best >= 0 ? best : Math.floor(Math.random() * GLOW_VARIANT_COUNT);
}

export function glowVariantAt(x, y, z) {
  const v = glowVariants[dim].get(key(x, y, z));
  return v === undefined ? 0 : v; // default to green
}

export function noteGlowstonePlace(x, y, z) {
  const v = glowVariantNear(x, y, z);
  const k = key(x, y, z);
  glowstoneSets[dim].add(k);
  glowVariants[dim].set(k, v);
}

export function clearGlowstoneAt(x, y, z) {
  const k = key(x, y, z);
  glowstoneSets[dim].delete(k);
  glowVariants[dim].delete(k);
}

// New worlds never inherit another world's colors or indexes.
export function resetGlowstoneMemory() {
  for (const name of DIMENSION_KEYS) {
    glowstoneSets[name].clear();
    glowVariants[name].clear();
  }
}

// Emitter-framework access: live positions + per-block color keys.
export function glowstoneBlocks(name) {
  return glowstoneSets[name];
}

export function glowstoneVariantKey(name, k) {
  return glowVariants[name].get(k);
}
