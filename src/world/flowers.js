// Flower looks, drawn once at placement, never on rebuild. Each placed
// flower rolls a random variant (weighted like FLOWER_VARIANTS) and a random
// Y orientation, stored per block per dimension — the mesher only reads
// them back, so a chunk rebuild never reshuffles a flower's look.
// Three-free (plain maps) so worldgen and the headless harness can use it;
// geometries stay in `render/flowers.js`.
import { key } from "../core/store.js";
import { dim } from "../core/store.js";
import { hash2 } from "../core/noise.js";

// Variant weights, in FLOWER_VARIANTS order (the multicolor entry weighs 2).
// Kept here so the draw stays three-free; update both if the registry gains,
// loses, or reweights a variant.
const FLOWER_WEIGHTS = [1, 1, 1, 1, 1, 1, 2];
const WEIGHT_SUM = FLOWER_WEIGHTS.reduce((a, w) => a + w, 0);

export const FLOWER_VARIANT_COUNT = FLOWER_WEIGHTS.length;

function makeMaps() {
  return new Map();
}

// Variant + angle per flower block, kept per dimension.
import { DIMENSION_KEYS } from "../core/store.js";
const fromKeys = (make) => Object.fromEntries(DIMENSION_KEYS.map((k) => [k, make()]));
const flowerVariants = fromKeys(() => makeMaps());
const flowerAngles = fromKeys(() => makeMaps());

// World seed for deterministic draws (set per world; defaults to 1 so the
// headless harness stays stable). Every draw is hash2(coords, seed+salt).
let flowerSeed = 1;
export function setFlowerSeed(s) {
  flowerSeed = s | 0;
}

function rollVariant(x, z) {
  let r = hash2(x, z, flowerSeed + 9101) * WEIGHT_SUM;
  for (let v = 0; v < FLOWER_WEIGHTS.length; v++) {
    if (r < FLOWER_WEIGHTS[v]) return v;
    r -= FLOWER_WEIGHTS[v];
  }
  return FLOWER_WEIGHTS.length - 1;
}

export function noteFlowerPlace(x, y, z) {
  const k = key(x, y, z);
  flowerVariants[dim].set(k, rollVariant(x, z));
  flowerAngles[dim].set(k, hash2(x, z, flowerSeed + 9102) * Math.PI * 2);
}

// Pure reads for the mesher: missing entries fall back to variant 0 / angle
// 0 instead of rolling, so rebuilds never compute anything.
export function flowerVariantAt(x, y, z) {
  const v = flowerVariants[dim].get(key(x, y, z));
  return v === undefined ? 0 : v;
}

export function flowerAngleAt(x, y, z) {
  const a = flowerAngles[dim].get(key(x, y, z));
  return a === undefined ? 0 : a;
}

export function clearFlowerAt(x, y, z) {
  const k = key(x, y, z);
  flowerVariants[dim].delete(k);
  flowerAngles[dim].delete(k);
}

// New worlds never inherit another world's looks.
export function resetFlowerMemory() {
  for (const name of DIMENSION_KEYS) {
    flowerVariants[name].clear();
    flowerAngles[name].clear();
  }
}
