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
import { hash2 } from "../core/noise.js";
import { registerHaloSource } from "../render/halobake.js";

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

// Pad-corner ghosts: reserved variants past the 7 normal ones, reusing the
// red/yellow look (no new textures) and rendering fog-faded: no halo, but a
// dynamic pool lamp in the base color while the fog lets them show (the pool
// caps ghost spots at the fog far, see render/poolspots.js).
// Normal placements never roll them (glowVariantNear only draws 0..6 and
// skips ghost entries when clustering); pad corners write them explicitly
// via noteGlowstonePlaceShared. Every render-side ghost branch gates on
// isPadGhostVariant, so the 7 normal variants never pass through one.
export const PAD_GHOST_RED = GLOW_VARIANT_COUNT; // 7, reads as red up close
export const PAD_GHOST_YELLOW = GLOW_VARIANT_COUNT + 1; // 8, reads as yellow
// Corner order, clockwise from the minimum/minimum corner: red, yellow,
// red, yellow (matches rocketpad.js PAD_LIGHTS).
export const PAD_GHOST_VARIANTS = [PAD_GHOST_RED, PAD_GHOST_YELLOW, PAD_GHOST_RED, PAD_GHOST_YELLOW];
export function isPadGhostVariant(v) {
  return v === PAD_GHOST_RED || v === PAD_GHOST_YELLOW;
}
// Ghost look base: the normal variant index whose texture the ghost reuses.
export function padGhostBaseVariant(v) {
  return v === PAD_GHOST_YELLOW ? 3 : 1;
}
// Distance-driven opacity fade (three-free): full strength up close, gone by
// fogFar so ghosts read as glowstones near the pad and vanish with distance.
export const PAD_GHOST_FADE_NEAR = 24;
export function padGhostOpacityAt(d, fogFar = 160) {
  if (d <= PAD_GHOST_FADE_NEAR) return 1;
  if (d >= fogFar) return 0;
  return 1 - (d - PAD_GHOST_FADE_NEAR) / (fogFar - PAD_GHOST_FADE_NEAR);
}

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

// World seed for the unclustered fallback draw (set per world).
let glowSeed = 1;
export function setGlowSeed(s) {
  glowSeed = s | 0;
}

// A placed glowstone inherits the color of the nearest glowstone within
// CLUSTER_DIST (so builds cluster by color); otherwise it rolls a fresh one
// deterministically from its coordinates and the world seed.
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
      if (v === undefined || isPadGhostVariant(v)) continue; // ghosts never seed clusters
      best = v; bestD = d2;
    }
  }
  return best >= 0 ? best : Math.floor(hash2(x * 31 + y, z * 17 + y, glowSeed + 9201) * GLOW_VARIANT_COUNT);
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

// Batch-flush variant: register a stone with a known color (shared with an
// adjacent stone flushed just before) instead of rescanning the stone set.
// Same maps, same lights — only the variant lookup is skipped.
export function noteGlowstonePlaceShared(x, y, z, v) {
  const k = key(x, y, z);
  glowstoneSets[dim].add(k);
  glowVariants[dim].set(k, v);
}

export function clearGlowstoneAt(x, y, z) {
  const k = key(x, y, z);
  glowstoneSets[dim].delete(k);
  glowVariants[dim].delete(k);
}

// New worlds never inherit another world's colors or indexes. Regenerate
// dimensions (End, TNT) drop only their own entry on every entry (see
// clearGlowstoneDim): retain dimensions keep theirs across trips.
export function clearGlowstoneDim(name = dim) {
  glowstoneSets[name]?.clear();
  glowVariants[name]?.clear();
}

export function resetGlowstoneMemory() {
  for (const name of DIMENSION_KEYS) clearGlowstoneDim(name);
}

// Emitter-framework access: live positions + per-block color keys.
export function glowstoneBlocks(name) {
  return glowstoneSets[name];
}

export function glowstoneVariantKey(name, k) {
  return glowVariants[name].get(k);
}

// Baked-halo source: every normal stone tints its neighbors in every
// dimension, so a line of 200 stones reads lit end to end with no dynamic
// light involved (see render/halobake.js). Pad-corner ghosts emit no halo:
// colorOf returns black for them, adding zero tint.
registerHaloSource({
  key: "glowstone",
  radius: 8, // blocks, Euclidean cutoff
  gain: 2.0, // adjacent-block lift
  max: 3, // per-channel clamp against overlap blowout
  positions: (name) => glowstoneSets[name],
  colorOf: (name, k) => {
    const v = glowstoneVariantKey(name, k) ?? 0;
    if (isPadGhostVariant(v)) return 0x000000;
    return GLOW_VARIANTS[v].glow;
  },
});
