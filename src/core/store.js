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

export function chunkOf(v) {
  return Math.floor(v / CHUNK);
}
