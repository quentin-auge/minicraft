// Tree types as data: shared properties live in TREE_DEFAULTS, entries
// override only what differs — a new type (pines, ...) is one registry
// entry, never a fork. overworld.js only computes the forest mask and calls
// tryGrowTree per column.
import { AIR, GRASS, LOG, LEAVES } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import { WATER_LEVEL } from "../core/store.js";

const TREE_DEFAULTS = {
  trunkMin: 4,
  trunkMax: 35,
  densityForest: 0.006,
  densityOpen: 0.0015,
};
// Guards shared by every tree type: trees grow on ground only — never in
// water, on riverbeds/banks, or on steep slopes where the canopy would
// bury into a hill.
const SLOPE_TOL = 2;
const RIVER_MARGIN = 2;

function canopyLeaf(ctx, x, topY, z, dx, dz, dy, r) {
  if (dx * dx + dz * dz > r * r + 0.5) return;
  if (Math.abs(dx) === r && Math.abs(dz) === r && dy < 1 &&
      hash2(x + dx * 7, z + dz * 13, ctx.seed + 1000) < 0.5) return;
  if (ctx.getBlock(x + dx, topY + dy, z + dz) !== AIR) return;
  ctx.setBlock(x + dx, topY + dy, z + dz, LEAVES);
}

function growOak(ctx, x, y, z, trunkH) {
  for (let i = 0; i < trunkH; i++) ctx.setBlock(x, y + i, z, LOG);
  const topY = y + trunkH;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy >= 0 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++)
        canopyLeaf(ctx, x, topY, z, dx, dz, dy, r);
  }
  ctx.setBlock(x, topY + 1, z, LEAVES);
}

export const TREE_TYPES = [
  {
    key: "oak",
    salt: 555,
    ...TREE_DEFAULTS,
    ground: (id) => id === GRASS,
    grow: growOak,
  },
];

function groundOk(ctx, x, h, z, type) {
  if (!type.ground(ctx.getBlock(x, h, z))) return false;
  if (h <= WATER_LEVEL + 1) return false;
  if (ctx.riverClearance(x, z) <= RIVER_MARGIN) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (Math.abs(ctx.heightAt(x + dx, z + dz) - h) > SLOPE_TOL) return false;
  }
  return true;
}

// ctx: { seed, forest, getBlock, setBlock, heightAt, riverClearance }.
// Rolls each type's density, enforces its ground guards, grows the first
// match. Returns the grown type key, or null.
export function tryGrowTree(ctx, x, h, z) {
  for (const type of TREE_TYPES) {
    const density = ctx.forest ? type.densityForest : type.densityOpen;
    if (hash2(x, z, ctx.seed + type.salt) >= density) continue;
    const trunkH = type.trunkMin + Math.floor(hash2(x, z, ctx.seed + 999) * (type.trunkMax - type.trunkMin + 1));
    if (!groundOk(ctx, x, h, z, type)) continue;
    type.grow(ctx, x, h + 1, z, trunkH);
    return type.key;
  }
  return null;
}
