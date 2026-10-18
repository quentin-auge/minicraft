// Overworld generation: height field, seas, rivers, terrain fill,
// trees/flowers, clouds, moon surface, then village flattening and
// structures. Only the surface builds here (spawn stands on it); the
// hollow underside fills lazily after the reveal (see moon.js), so
// startup pays only for spawn-visible voxels.
// Tunables live here; the world store holds the voxels.
import {
  AIR, GRASS, DIRT, STONE, SAND, WATER, FLOWER,
} from "../core/blocks.js";
import { hash2, fbm } from "../core/noise.js";
import {
  WORLD_RADIUS, WATER_LEVEL, setBlock, fillColumn, getBlock, setDimension, resetWorld,
} from "../core/store.js";
import { village, computeLayout, intersectsVillage, placeVillage } from "./village.js";
import { tryGrowTree } from "./trees.js";
import { noteFlowerPlace, resetFlowerMemory } from "./flowers.js";
import { generateClouds } from "./clouds.js";
import { generateMoonSurface, resetMoon } from "./moon.js";

// Worldgen tunables as one spec object: terrain shape, river system, and the
// flower scatter density (overworld's own knob; per-variant properties live
// in FLOWER_VARIANTS). New biomes or dimensions override properties here,
// never fork this pipeline.
export const TERRAIN = {
  landRaise: 20.0,
  basinShore: 1.5,
  basinDepth: 2.2,
  rivers: { count: 3, step: 36, width: 6.0, bed: 8 },
  flowerDensity: 0.015,
};

let seed = 1;
let waterScale = 1;
let waterDepth = 1;
let basinFreq = 0.007;
let basinThresh = 0;
let basinMax = 1;
let riverPaths = [];
let forestThresh = 0.5;
const heightMemo = new Map();

export function getSeed() {
  return seed;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function nearestRiver(x, z) {
  let best = null;
  for (const pts of riverPaths) {
    for (let k = 0; k < pts.length - 1; k++) {
      const d = distToSegment(x, z, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
      const w = TERRAIN.rivers.width * (0.7 + 0.6 * (k / (pts.length - 1)));
      if (!best || d - w < best.d - best.w) best = { d, w };
    }
  }
  return best;
}

export function riverClearance(x, z) {
  const rv = nearestRiver(x, z);
  return rv ? rv.d - rv.w : Infinity;
}

export function heightAt(x, z) {
  const mk = x + "," + z;
  const cached = heightMemo.get(mk);
  if (cached !== undefined) return cached;
  const base = fbm(x * 0.02, z * 0.02, seed) * 2 - 1;
  const hills = fbm(x * 0.008 + 100, z * 0.008 + 100, seed + 7) * 2 - 1;
  const rough = fbm(x * 0.06, z * 0.06, seed + 13) * 1.4;
  let h = 8 + TERRAIN.landRaise + base * 8 + hills * 33 + rough;
  const plat = fbm(x * 0.006 + 400, z * 0.006 + 400, seed + 99);
  if (Math.abs(plat - 0.5) < 0.16) {
    const lvl = Math.round(plat * 7) / 7;
    h = 8 + lvl * 44 + (fbm(x * 0.06, z * 0.06, seed + 123) * 2 - 1) * 0.6;
  }
  h = Math.max(WATER_LEVEL + 1, Math.min(70, h));
  const basin = fbm(x * basinFreq + 200, z * basinFreq + 200, seed + 21) * 2 - 1;
  if (basin > basinThresh) {
    const s = (basin - basinThresh) / (basinMax - basinThresh);
    h = Math.max(1, WATER_LEVEL - TERRAIN.basinShore - s * (TERRAIN.basinDepth * waterDepth));
  }
  const rv = nearestRiver(x, z);
  if (rv && rv.d <= rv.w) {
    const t = rv.d / rv.w;
    h = Math.min(h, TERRAIN.rivers.bed + Math.floor(t * 6));
  }
  const out = Math.floor(h);
  heightMemo.set(mk, out);
  return out;
}

function generateRivers() {
  riverPaths = [];
  const S = WORLD_RADIUS;
  for (let i = 0; i < TERRAIN.rivers.count; i++) {
    const rs = seed + 777 + i * 101;
    const edge = Math.floor(hash2(0, 0, rs + 1) * 4);
    const along = (hash2(0, 0, rs + 2) * 2 - 1) * S * 0.6;
    let x, z, head;
    if (edge === 0) { x = -S; z = along; head = 0; }
    else if (edge === 1) { x = S; z = along; head = Math.PI; }
    else if (edge === 2) { x = along; z = -S; head = Math.PI / 2; }
    else { x = along; z = S; head = -Math.PI / 2; }
    const wobA = 0.4 + hash2(0, 0, rs + 3) * 0.3;
    const wobF = 0.12 + hash2(0, 0, rs + 4) * 0.08;
    const phase = hash2(0, 0, rs + 5) * Math.PI * 2;
    const kink = (hash2(0, 0, rs + 6) * 2 - 1) * 0.3;
    const pts = [[x, z]];
    for (let n = 1; n < 60; n++) {
      head += wobA * Math.sin(n * wobF + phase) + kink * Math.sin(n * 0.19 + phase * 1.3);
      if (x > S * 0.6) head -= 0.12;
      if (x < -S * 0.6) head += 0.12;
      if (z > S * 0.6) head -= 0.12;
      if (z < -S * 0.6) head += 0.12;
      x += Math.cos(head) * TERRAIN.rivers.step;
      z += Math.sin(head) * TERRAIN.rivers.step;
      pts.push([x, z]);
      if (pts.length >= 10 || x > S + 40 || x < -S - 40 || z > S + 40 || z < -S - 40) break;
    }
    if (pts.length > 4) riverPaths.push(pts);
  }
}

function isVillage(x, z) {
  return intersectsVillage(x, z);
}

function setupOverworld(newSeed) {
  seed = newSeed;
  setDimension("over");
  resetWorld("over");
  resetFlowerMemory();
  heightMemo.clear();
  waterScale = 1 + (hash2(0, 0, seed + 333) * 4 | 0);
  waterDepth = 1 + (hash2(0, 0, seed + 444) * 3 | 0);
  basinFreq = 0.007 / Math.sqrt(waterScale);
  const vals = [];
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 2)
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 2)
      vals.push(fbm(x * basinFreq + 200, z * basinFreq + 200, seed + 21) * 2 - 1);
  vals.sort((a, b) => a - b);
  basinThresh = vals[(vals.length * 0.85) | 0];
  basinMax = vals[vals.length - 1];
  generateRivers();
  const fvals = [];
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 2)
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 2)
      fvals.push(fbm(x * 0.01 + 500, z * 0.01 + 500, seed + 888));
  fvals.sort((a, b) => a - b);
  forestThresh = fvals[(fvals.length * 0.5) | 0];
  computeLayout(seed, heightAt);
  // Shared per-column context for the tree registry; only `forest` varies.
  return { seed, forest: false, getBlock, setBlock, heightAt, riverClearance };
}

function fillTerrainColumn(treeCtx, x, z) {
  const inVillage = x >= village.minX && x <= village.maxX && z >= village.minZ && z <= village.maxZ;
  let h = heightAt(x, z);
  if (inVillage) h = village.center.y;
  // Bulk runs, not per-block writes: identical voxels, one index pass
  // per run (stone body, dirt band, top cell, then water fill).
  const topId = inVillage ? STONE : (h <= WATER_LEVEL + 1 ? SAND : GRASS);
  if (h >= 3) fillColumn(x, z, 0, h - 3, STONE);
  if (h >= 1) fillColumn(x, z, Math.max(0, h - 2), h - 1, DIRT);
  fillColumn(x, z, h, h, topId);
  if (!inVillage && h < WATER_LEVEL) fillColumn(x, z, h + 1, WATER_LEVEL, WATER);
  if (inVillage) return;
  treeCtx.forest = fbm(x * 0.01 + 500, z * 0.01 + 500, seed + 888) > forestThresh;
  const grown = tryGrowTree(treeCtx, x, h, z);
  if (!grown && getBlock(x, h, z) === GRASS && getBlock(x, h + 1, z) === AIR && hash2(x, z, seed + 7777) < TERRAIN.flowerDensity) {
    setBlock(x, h + 1, z, FLOWER);
    noteFlowerPlace(x, h + 1, z);
  }
}

function finishOverworld() {
  placeVillage(setBlock, getBlock);
  generateClouds(seed, setBlock);
  // Moon surface only (spawn-exact tops); the hollow underside fills
  // lazily after the reveal, its flag reset per world below.
  generateMoonSurface(seed, setBlock);
  resetMoon();
}

export function generateOverworld(newSeed) {
  const treeCtx = setupOverworld(newSeed);
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z++) {
      fillTerrainColumn(treeCtx, x, z);
    }
  }
  finishOverworld();
}

// Sliced twin of generateOverworld: identical voxels in the same order,
// but yields to the event loop every few rows so the menu, Play clicks,
// and renders interleave instead of freezing for ~1s. Aborts fast when
// isAborted() turns true (a newer world started).
export async function generateOverworldAsync(newSeed, isAborted) {
  const treeCtx = setupOverworld(newSeed);
  const ROWS_PER_SLICE = 12;
  let rows = 0;
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z++) {
      fillTerrainColumn(treeCtx, x, z);
    }
    if (++rows % ROWS_PER_SLICE === 0) {
      if (isAborted && isAborted()) return false;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  if (isAborted && isAborted()) return false;
  finishOverworld();
  return true;
}

export { village };
export const __test = { nearestRiver, get rivers() { return riverPaths; } };
