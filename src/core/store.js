// Voxel storage, one Map per dimension so Nether/End plug in later.
// The active dimension is selected via setDimension(); the overworld
// generator pins it while filling.
import { AIR, BLOCK_INFO } from "./blocks.js";

export const WORLD_RADIUS = 96;
export const WATER_LEVEL = 10;
export const CHUNK = 16;
export const RENDER_DIST = 8;
export const MAX_Y = 256;

const KEY_OFF = 1024;
const KEY_MZ = 2048;
const KEY_MY = KEY_MZ * KEY_MZ;

export function key(x, y, z) {
  return (x + KEY_OFF) * KEY_MY + y * KEY_MZ + (z + KEY_OFF);
}

export const colTopIdx = (x, z) => (x + KEY_OFF) * KEY_MZ + (z + KEY_OFF);

function makeColTops() {
  return new Int16Array(KEY_MZ * KEY_MZ);
}

export const worlds = { over: new Map(), nether: new Map(), end: new Map() };
export const colTops = { over: makeColTops(), nether: makeColTops(), end: makeColTops() };

export let dim = "over";
export let world = worlds.over;

export function setDimension(name) {
  dim = name;
  world = worlds[name];
}

export function resetWorld(name) {
  worlds[name].clear();
  colTops[name].fill(0);
  if (dim === name) world = worlds[name];
}

export function getBlock(x, y, z) {
  return world.get(key(x, y, z)) || AIR;
}

export function getBlockIn(name, x, y, z) {
  return worlds[name].get(key(x, y, z)) || AIR;
}

// Tracks the highest non-air block per column for meshing and spawn.
export function setBlock(x, y, z, id) {
  const k = key(x, y, z);
  if (id === AIR) world.delete(k);
  else world.set(k, id);
  const ci = colTopIdx(x, z);
  const tops = colTops[dim];
  if (id !== AIR) {
    if (y > tops[ci]) tops[ci] = y;
  } else if (y >= tops[ci]) {
    let t = y - 1;
    while (t > 0 && !world.has(key(x, t, z))) t--;
    tops[ci] = t;
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
// world edge or ceiling, or growing past POCKET_FLOOD_LIMIT cells, counts as
// open. Upward-first order so roofed-but-open air exits fast and only true
// pockets pay the full flood. Meshing only (veils, seals): small pockets.
export const POCKET_FLOOD_LIMIT = 512;
export function isEnclosedAir(x, y, z) {
  if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS || y > MAX_Y) return false;
  if (colTops[dim][colTopIdx(x, z)] < y) return false;
  const seen = new Set([key(x, y, z)]);
  const stack = [[x, y, z]];
  while (stack.length) {
    if (seen.size > POCKET_FLOOD_LIMIT) return false;
    const [cx, cy, cz] = stack.pop();
    const ns = [[cx, cy + 1, cz], [cx, cy - 1, cz], [cx - 1, cy, cz], [cx + 1, cy, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]];
    for (const [nx, ny, nz] of ns) {
      if (ny > MAX_Y || Math.abs(nx) > WORLD_RADIUS || Math.abs(nz) > WORLD_RADIUS) return false;
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
  if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS || y > MAX_Y) return false;
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
      if (ny > MAX_Y || Math.abs(nx) > WORLD_RADIUS || Math.abs(nz) > WORLD_RADIUS) return false;
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
