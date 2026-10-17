// Voxel storage, one Map per dimension so Nether/End plug in later.
// The active dimension is selected via setDimension(); the overworld
// generator pins it while filling.
// Columns are unbounded above (any y >= 0, no ceiling): key packing stays
// exact to 2^53 with the strides below (practical limit y ~ 2M, far past
// view distance), and per-column indexes keep tall builds cheap.
import { AIR, BLOCK_INFO, isLiquid, MOON, MOON_WATER } from "./blocks.js";

export const WORLD_RADIUS = 96;
export const WATER_LEVEL = 10;
export const CHUNK = 16;
export const RENDER_DIST = 8;

const KEY_OFF = 1024;
const KEY_MZ = 2048;
const KEY_YSTRIDE = 2048;
const KEY_XSTRIDE = 4294967296; // 2^32
const KEY_YMOD = KEY_XSTRIDE / KEY_YSTRIDE; // 2^21

export function key(x, y, z) {
  return (x + KEY_OFF) * KEY_XSTRIDE + y * KEY_YSTRIDE + (z + KEY_OFF);
}

// Inverse of key(), kept beside the encoder so the strides never drift.
export function keyXYZ(k) {
  const z = (k % KEY_YSTRIDE) - KEY_OFF;
  const t = Math.floor(k / KEY_YSTRIDE);
  const y = t % KEY_YMOD;
  const x = Math.floor(t / KEY_YMOD) - KEY_OFF;
  return [x, y, z];
}

export const colTopIdx = (x, z) => (x + KEY_OFF) * KEY_MZ + (z + KEY_OFF);

function makeColTops() {
  return new Int32Array(KEY_MZ * KEY_MZ);
}

export const worlds = { over: new Map(), nether: new Map(), end: new Map() };
export const colTops = { over: makeColTops(), nether: makeColTops(), end: makeColTops() };
// Bare column tops: same index, but moon rock and moon water never raise
// it. The Moon disc sets every column top to ~946, which would neuter the
// enclosure fast path below (every ground flood would exhaust its budget
// under the disc); the bare tops restore O(column-height) escapes for
// below-band queries. Spawn and streaming keep using colTops.
export const colTopsBare = { over: makeColTops(), nether: makeColTops(), end: makeColTops() };
// Sparse column occupancy: colTopIdx -> Set of occupied y. Meshing iterates
// blocks instead of scanning 0..top, so tall builds cost by blocks, not
// height. colLiqTop (colTopIdx -> highest liquid y) answers swim queries in
// O(1) for the same reason. Both are maintained by setBlock, the only
// writer, so generation, edits, and blasts stay consistent with no
// call-site changes.
function makeColOcc() {
  return new Map();
}
export const colOcc = { over: makeColOcc(), nether: makeColOcc(), end: makeColOcc() };
export const colLiqTop = { over: new Map(), nether: new Map(), end: new Map() };

export let dim = "over";
export let world = worlds.over;

export function setDimension(name) {
  dim = name;
  world = worlds[name];
}

export function resetWorld(name) {
  worlds[name].clear();
  colTops[name].fill(0);
  colTopsBare[name].fill(0);
  colOcc[name].clear();
  colLiqTop[name].clear();
  if (dim === name) world = worlds[name];
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
  const ci = colTopIdx(x, z);
  const tops = colTops[dim];
  const bare = colTopsBare[dim];
  const occ = colOcc[dim];
  if (id !== AIR) {
    world.set(k, id);
    let set = occ.get(ci);
    if (!set) { set = new Set(); occ.set(ci, set); }
    set.add(y);
    if (y > tops[ci]) tops[ci] = y;
    if (id !== MOON && id !== MOON_WATER && y > bare[ci]) bare[ci] = y;
    if (isLiquid(id)) {
      const lt = colLiqTop[dim];
      if (y > (lt.get(ci) ?? -1)) lt.set(ci, y);
    }
    return;
  }
  if (!world.has(k)) return;
  world.delete(k);
  const set = occ.get(ci);
  if (set) {
    set.delete(y);
    if (!set.size) occ.delete(ci);
  }
  if (y >= tops[ci]) {
    let m = 0;
    if (set) for (const yy of set) if (yy > m) m = yy;
    tops[ci] = m;
  }
  // Bare top rescan has its own gate: moon rock can sit far above the bare
  // top, so the tops gate above would miss terrain removals underneath it.
  if (y >= bare[ci]) {
    let bm = 0;
    if (set) for (const yy of set) {
      if (yy > bm) {
        const bid = world.get(key(x, yy, z)) || AIR;
        if (bid !== MOON && bid !== MOON_WATER) bm = yy;
      }
    }
    bare[ci] = bm;
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
}

// Bulk column fill: identical voxels and indexes to the equivalent setBlock
// loop, but the per-column bookkeeping (occ set, tops, bare, liquid top)
// runs once instead of per block. Only for fresh solid runs during worldgen
// (never AIR, never overwrites mid-game edits); edits, trees, structures,
// and blasts keep setBlock.
export function fillColumn(x, z, y0, y1, id) {
  if (y0 > y1) return;
  const ci = colTopIdx(x, z);
  const occ = colOcc[dim];
  let set = occ.get(ci);
  if (!set) { set = new Set(); occ.set(ci, set); }
  const base = (x + KEY_OFF) * KEY_XSTRIDE + (z + KEY_OFF);
  for (let y = y0; y <= y1; y++) {
    world.set(base + y * KEY_YSTRIDE, id);
    set.add(y);
  }
  const tops = colTops[dim];
  if (y1 > tops[ci]) tops[ci] = y1;
  if (id !== MOON && id !== MOON_WATER) {
    const bare = colTopsBare[dim];
    if (y1 > bare[ci]) bare[ci] = y1;
  }
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

// Enclosure test for air pockets (air trapped in liquid/solid, as opposed
// to open sky-air). Fast path: a column with nothing above the cell is open
// in O(1). Otherwise a bounded air-only flood decides; escaping past the
// world edge or the column tops, or growing past POCKET_FLOOD_LIMIT cells,
// counts as open. Upward-first order so roofed-but-open air exits fast and
// only true pockets pay the full flood. Meshing only (veils, seals): small
// pockets.
export const POCKET_FLOOD_LIMIT = 512;
// belowCap restores the fast path under the Moon: moon rock pushes every
// column top to ~946, so without it each ground flood would explore the full
// budget under the disc. Bare tops (moon excluded) bound the flood to column
// height instead. Sound on generated terrain: air above all local non-moon
// solids can only be sealed by moon overhead, which nothing places — sealed
// player builds straddling the bare top (≤512 cells) read open; at- and
// above-cap queries keep the exact old behavior, so lake rims and the sky
// above read exactly as before. The only divergence is player-dug sealed
// moon pockets touching liquid (unbuildable seal, veil tint only), which do
// not exist in generated worlds. Meshing is the only caller.
export function isEnclosedAir(x, y, z, belowCap = false) {
  if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS) return false;
  if (colTops[dim][colTopIdx(x, z)] < y) return false;
  const bare = belowCap ? colTopsBare[dim] : null;
  const seen = new Set([key(x, y, z)]);
  const stack = [[x, y, z]];
  while (stack.length) {
    if (seen.size > POCKET_FLOOD_LIMIT) return false;
    const [cx, cy, cz] = stack.pop();
    if (colTops[dim][colTopIdx(cx, cz)] < cy) return false;
    if (bare && bare[colTopIdx(cx, cz)] < cy) return false;
    const ns = [[cx, cy + 1, cz], [cx, cy - 1, cz], [cx - 1, cy, cz], [cx + 1, cy, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]];
    for (const [nx, ny, nz] of ns) {
      if (Math.abs(nx) > WORLD_RADIUS || Math.abs(nz) > WORLD_RADIUS) return false;
      if (ny < 0) continue;
      if (getBlock(nx, ny, nz) !== AIR) continue;
      const k = key(nx, ny, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nx, ny, nz]);
    }
  }
  return true;
}
// Eye variant of the enclosure test (waterfog.js eye medium only): same
// bounded air-only flood, but a column open to the sky at ANY visited cell
// counts as escaped (so open pits and well shafts clear in a few cells),
// and a flood that exhausts its budget without escaping counts as pocketed
// (big sealed halls murk like divers instead of reading clear air).
// Meshing keeps isEnclosedAir: only small pockets veil. A vast but
// genuinely open maze with no sky cell within budget murks too —
// atmospheric, and the documented direction (murk more, never less).
export function isEyePocketed(x, y, z) {
  if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS) return false;
  const tops = colTops[dim];
  if (tops[colTopIdx(x, z)] < y) return false;
  const seen = new Set([key(x, y, z)]);
  const stack = [[x, y, z]];
  while (stack.length) {
    if (seen.size > POCKET_FLOOD_LIMIT) return true;
    const [cx, cy, cz] = stack.pop();
    if (tops[colTopIdx(cx, cz)] < cy) return false;
    const ns = [[cx, cy + 1, cz], [cx, cy - 1, cz], [cx - 1, cy, cz], [cx + 1, cy, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]];
    for (const [nx, ny, nz] of ns) {
      if (Math.abs(nx) > WORLD_RADIUS || Math.abs(nz) > WORLD_RADIUS) return false;
      if (ny < 0) continue;
      if (getBlock(nx, ny, nz) !== AIR) continue;
      const k = key(nx, ny, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nx, ny, nz]);
    }
  }
  return true;
}

export function chunkOf(v) {
  return Math.floor(v / CHUNK);
}
