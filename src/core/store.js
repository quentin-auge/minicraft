// Voxel storage, one Map per dimension so Nether/End plug in later.
// The active dimension is selected via setDimension(); the overworld
// generator pins it while filling.
// Columns are unbounded above (any y >= 0, no ceiling): key packing stays
// exact to 2^53 with the strides below (practical limit y ~ 2M, far past
// view distance), and per-column indexes keep tall builds cheap.
import { AIR, BLOCK_INFO, isLiquid } from "./blocks.js";

export const WORLD_RADIUS = 96;
export const WATER_LEVEL = 10;
export const CHUNK = 16;
export const RENDER_DIST = 8;
// TNT mesh horizon (192): covers the 150 fog far + margin, so looking down
// a dive always has geometry to show. Bounded dims keep 8; the fog guard
// derives its unload distance from renderDist(), never the constant.
export const TNT_RENDER_DIST = 12;
// Per-dimension mesh-horizon overrides (Nether 14: open lava sea with two
// volcanoes readable from spawn); bounded dims without an entry keep 8.
const renderDists = new Map();
export function registerRenderDist(name, dist) {
  renderDists.set(name, dist);
}
export function renderDist(name = dim) {
  return renderDists.get(name) ?? (dimInfinite(name) ? TNT_RENDER_DIST : RENDER_DIST);
}

// Lazy chunk sources: dimensions whose world is materialized chunk-by-chunk
// register a generator here. The mesher asks for a column's chunk before
// reading it, so generation and rendering share one streaming path.
const chunkSources = new Map();
export function registerChunkSource(name, fn) {
  chunkSources.set(name, fn);
}
export function ensureChunkSource(cx, cz, name = dim) {
  const fn = chunkSources.get(name);
  return fn ? fn(cx, cz) : false;
}

// Lazy-area ensure for streaming dimensions: materialize the whole (2r+1)^2
// square around (cx, cz) before a chunk build reads across its borders.
// Returns the keys freshly generated (empty when nothing was new) — the
// caller (mesher rebuildChunk) requeues only built neighbours adjacent to
// those, whose border faces may have been emitted against default AIR.
// Dimensions without a source stay a no-op ([]) — in practice only the
// Nether registers one, so every other dimension pays nothing here and
// needs no gate: the early return below is the proof.
// Surgical rim refresh (three-free, pure): built chunks adjacent to freshly
// generated ones, excluding the chunk under build (exact already: it reads
// the final voxels). A fresh self still stales its older built neighbours —
// only itself is skipped from the output, never from the cause set.
// Rebuilding anything else replays an identical mesh at full cost.
export function ensureChunkArea(cx, cz, radius = 1, name = dim) {
  const fresh = [];
  const fn = chunkSources.get(name);
  if (!fn) return fresh;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (fn(cx + dx, cz + dz)) fresh.push((cx + dx) + "_" + (cz + dz));
    }
  }
  return fresh;
}
export function rimRefreshKeys(freshKeys, selfCk, hasBuilt) {
  const out = new Set();
  for (const fk of freshKeys) {
    const sep = fk.lastIndexOf("_");
    const fx = +fk.slice(0, sep), fz = +fk.slice(sep + 1);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nk = fx + dx + "_" + (fz + dz);
        if (nk !== selfCk && hasBuilt(nk)) out.add(nk);
      }
    }
  }
  return [...out];
}

// Coordinate packing covers ±65535 on every axis (2^16 offset into 17-bit
// fields, exact under 2^53: X stride 2^34 keeps the whole key below 2^52).
// Bounded dimensions use a ±96 slice of it; infinite dimensions roam the
// full 128k-cubed range — no reachable wall (hours of travel from spawn).
const KEY_OFF = 65536; // 2^16
const KEY_MZ = 131072; // 2^17
const KEY_YSTRIDE = 131072; // 2^17
const KEY_XSTRIDE = 17179869184; // 2^34
const KEY_YMOD = KEY_XSTRIDE / KEY_YSTRIDE; // 2^17

export function key(x, y, z) {
  return (x + KEY_OFF) * KEY_XSTRIDE + (y + KEY_OFF) * KEY_YSTRIDE + (z + KEY_OFF);
}

// Inverse of key(), kept beside the encoder so the strides never drift.
// Exact for every in-range coordinate: the key never goes negative.
export function keyXYZ(k) {
  const z = (k % KEY_YSTRIDE) - KEY_OFF;
  const t = Math.floor(k / KEY_YSTRIDE);
  const y = (t % KEY_YMOD) - KEY_OFF;
  const x = Math.floor(t / KEY_YMOD) - KEY_OFF;
  return [x, y, z];
}

export const colTopIdx = (x, z) => (x + KEY_OFF) * KEY_MZ + (z + KEY_OFF);

function makeColTops() {
  // Sparse: infinite dimensions roam far past any fixed array, and even the
  // overworld only fills 37k of 16M typed-array slots. Missing entry = 0.
  return new Map();
}

// Column-top reads (missing entry reads 0, matching the old filled arrays).
export function topAt(name, x, z) {
  return colTops[name].get(colTopIdx(x, z)) ?? 0;
}
// First-class dimensions: every dimension key owns one entry in each map.
// New dimensions add a key here and a spec in world/dimensions.js, never a fork.
export const DIMENSION_KEYS = ["over", "tnt", "nether", "end"];
const fromKeys = (make) => Object.fromEntries(DIMENSION_KEYS.map((k) => [k, make()]));
export const worlds = fromKeys(() => new Map());
export const colTops = fromKeys(() => makeColTops());
// Sparse column occupancy: colTopIdx -> Set of occupied y. Meshing iterates
// blocks instead of scanning 0..top, so tall builds cost by blocks, not
// height. colLiqTop (colTopIdx -> highest liquid y) answers swim queries in
// O(1) for the same reason. Both are maintained by setBlock, the only
// writer, so generation, edits, and blasts stay consistent with no
// call-site changes.
function makeColOcc() {
  return new Map();
}
export const colOcc = fromKeys(() => makeColOcc());
export const colLiqTop = fromKeys(() => new Map());
const protectedCells = fromKeys(() => new Set());

export let dim = "over";
export let world = worlds.over;
// Invalidates read-only geometry caches after writes, resets and dimension switches.
export let worldRevision = 0;

export function setDimension(name) {
  worldRevision++;
  dim = name;
  world = worlds[name];
}

export function resetWorld(name) {
  worldRevision++;
  worlds[name].clear();
  colTops[name].clear();
  colOcc[name].clear();
  colLiqTop[name].clear();
  protectedCells[name].clear();
  if (dim === name) world = worlds[name];
}

export function protectCell(x, y, z, name = dim) {
  protectedCells[name].add(key(x, y, z));
}

export function unprotectCell(x, y, z, name = dim) {
  protectedCells[name].delete(key(x, y, z));
}

export function isCellProtected(x, y, z, name = dim) {
  return protectedCells[name].has(key(x, y, z));
}

// Infinite dimensions (TNT sky first): no XZ walls, no floor — voxels roam
// the full key range. Bounded dimensions keep the ±96 cube and y >= 0.
// Registered by world/dimensions.js so store never imports the registry.
const infiniteDims = new Set();
export function registerInfiniteDim(name) {
  infiniteDims.add(name);
}
export function dimInfinite(name = dim) {
  return infiniteDims.has(name);
}
// Half-extent of the walkable/voxel range for a dimension.
export function dimBound(name = dim) {
  return dimInfinite(name) ? KEY_OFF : WORLD_RADIUS;
}
// Out-of-world test for raycasts and floods: bounded dims keep the old
// cube (and y < 0), infinite dims only run out at the key range edge.
export function outOfWorld(x, y, z, name = dim) {
  const B = dimBound(name);
  return x < -B || x > B || z < -B || z > B || (dimInfinite(name) ? y < -B : y < 0);
}

export function getBlock(x, y, z) {
  return world.get(key(x, y, z)) || AIR;
}

export function getBlockIn(name, x, y, z) {
  return worlds[name].get(key(x, y, z)) || AIR;
}

// Tracks the highest non-air block per column for meshing and spawn,
// plus the occupancy and liquid-top indexes (see above).
export function setBlock(x, y, z, id) {
  const k = key(x, y, z);
  if (id === AIR && protectedCells[dim].has(k)) return false;
  worldRevision++;
  const ci = colTopIdx(x, z);
  const tops = colTops[dim];
  const occ = colOcc[dim];
  if (id !== AIR) {
    world.set(k, id);
    let set = occ.get(ci);
    if (!set) { set = new Set(); occ.set(ci, set); }
    set.add(y);
    if (y > (tops.get(ci) ?? 0)) tops.set(ci, y);
    if (isLiquid(id)) {
      const lt = colLiqTop[dim];
      if (y > (lt.get(ci) ?? -1)) lt.set(ci, y);
    }
    return true;
  }
  if (!world.has(k)) return false;
  world.delete(k);
  const set = occ.get(ci);
  if (set) {
    set.delete(y);
    if (!set.size) occ.delete(ci);
  }
  if (y >= (tops.get(ci) ?? 0)) {
    let m = -KEY_OFF - 1;
    if (set) for (const yy of set) if (yy > m) m = yy;
    if (m <= -KEY_OFF - 1) tops.delete(ci);
    else tops.set(ci, m);
  }
  const lt = colLiqTop[dim];
  if (y === lt.get(ci)) {
    let m = -1;
    if (set) {
      for (const yy of set) {
        if (yy > m && isLiquid(world.get(key(x, yy, z)) || AIR)) m = yy;
      }
    }
    if (m < 0) lt.delete(ci);
    else lt.set(ci, m);
  }
  return true;
}

// Bulk column fill: identical voxels and indexes to the equivalent setBlock
// loop, but the per-column bookkeeping (occ set, tops, liquid top)
// runs once instead of per block. Only for fresh solid runs during worldgen
// (never AIR, never overwrites mid-game edits); edits, trees, structures,
// and blasts keep setBlock.
export function fillColumn(x, z, y0, y1, id) {
  if (y0 > y1) return;
  worldRevision++;
  const ci = colTopIdx(x, z);
  const occ = colOcc[dim];
  let set = occ.get(ci);
  if (!set) { set = new Set(); occ.set(ci, set); }
  const base = (x + KEY_OFF) * KEY_XSTRIDE + (z + KEY_OFF);
  for (let y = y0; y <= y1; y++) {
    world.set(base + (y + KEY_OFF) * KEY_YSTRIDE, id);
    set.add(y);
  }
  const tops = colTops[dim];
  if (y1 > (tops.get(ci) ?? 0)) tops.set(ci, y1);
  if (isLiquid(id)) {
    const lt = colLiqTop[dim];
    if (y1 > (lt.get(ci) ?? -1)) lt.set(ci, y1);
  }
}

export function isSolid(x, y, z) {
  const id = world.get(key(x, y, z)) || AIR;
  const info = BLOCK_INFO[id];
  return !!info && info.solid;
}

export function chunkOf(v) {
  return Math.floor(v / CHUNK);
}
