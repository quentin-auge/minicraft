// ?test=1 in-page hook: deterministic 1-wide path rigs for the browser
// driver (tests/browser/mobs/mob-paths.mjs). Loaded by main.js only when the
// param is set; zero game impact otherwise. Voxel writes go through the
// live store, mob steps through the real tickFarmMobs — the same code the
// game loop runs — with Math.random seeded per trial, so traces are
// reproducible. Rendering is untouched (refreshBlocks keeps meshes honest).
import { AIR, STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { spawnFarmMobAt, clearFarmMobs, tickFarmMobs } from "../../../src/mobs/farm.js";
import { refreshBlocks } from "../../../src/render/mesher.js";
import { village } from "../../../src/world/village.js";

const FEET = 1;
const DT = 1 / 60;

export const LAYOUTS = {
  straight: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]],
  l: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  t: [[1, 0], [1, 1], [0, 2], [1, 2], [2, 2]],
  cross: [[1, -1], [1, 0], [1, 1], [1, 2], [1, 3], [0, 1], [2, 1]],
  zigzag: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [2, 4]],
  deadend: [[0, 0], [0, 1], [0, 2]],
  straight2: (() => { const c = []; for (let z = 0; z <= 7; z++) { c.push([0, z], [1, z]); } return c; })(),
  l2: (() => {
    const c = [];
    for (let z = 0; z <= 3; z++) { c.push([0, z], [1, z]); }
    for (let x = 0; x <= 5; x++) { c.push([x, 2], [x, 3]); }
    return [...new Map(c.map((p) => [`${p[0]},${p[1]}`, p])).values()];
  })(),
  funnel21: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]],
  doorway: [[2, 0], [2, 1], [2, 2]],
  t2: [[1, 0], [1, 1], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 2], [-1, 3], [0, 3], [1, 3], [2, 3], [3, 3]],
  mouth: [[0, 0], [0, 1], [0, 2], [0, 3]],
};

export const DOOR_WALLS = [
  [-1, 3], [2, 3], [3, 3],
  [-1, 6], [0, 6], [1, 6], [2, 6], [3, 6],
  [-1, 4], [-1, 5], [3, 4], [3, 5],
];

export const STARTS = {
  straight: [0, 0], l: [0, 0], t: [1, 0], cross: [1, -1], zigzag: [0, 0], deadend: [0, 0],
  straight2: [0, 0], l2: [0, 0], funnel21: [0, 0], doorway: [2, 0], t2: [1, 0], mouth: [0, 0],
  fencering: [4, 0],
};
export const START_OFF = { straight2: [-0.15, 0], l2: [0.5, 0], funnel21: [0.5, 0] };

// Flat, far from the pen and spawn so pen mobs never interact.
const OX = 40, OZ = 40;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let sceneRef = null;

function buildRig(kind, name, { auto = true, skip = [], extra = [] } = {}) {
  resetWorld("over");
  setDimension("over");
  clearFarmMobs();
  const layout = LAYOUTS[name].map(([x, z]) => [x + OX, z + OZ]);
  const off = (dx, dz) => [dx + OX, dz + OZ];
  const extraW = extra.map(([x, z]) => off(x, z));
  const skipW = skip.map(([x, z]) => off(x, z));
  const ps = new Set(layout.map(([x, z]) => `${x},${z}`));
  const skipSet = new Set(skipW.map(([x, z]) => `${x},${z}`));
  const all = [...layout, ...extraW, ...skipW];
  const xs = all.map((c) => c[0]), zs = all.map((c) => c[1]);
  const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3;
  const z0 = Math.min(...zs) - 3, z1 = Math.max(...zs) + 3;
  const touched = [];
  const put = (x, y, z, id) => { setBlock(x, y, z, id); touched.push([x, y, z]); };
  const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (kind === "muret") {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) put(x, 0, z, STONE);
    if (auto) {
      for (const cell of ps) {
        const [x, z] = cell.split(",").map(Number);
        for (const [dx, dz] of adj) {
          if (ps.has(`${x + dx},${z + dz}`) || skipSet.has(`${x + dx},${z + dz}`)) continue;
          put(x + dx, 1, z + dz, STONE);
          put(x + dx, 2, z + dz, STONE);
        }
      }
    }
    for (const [x, z] of extraW) { put(x, 1, z, STONE); put(x, 2, z, STONE); }
  } else {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      put(x, 0, z, STONE);
      put(x, 1, z, STONE);
    }
    for (const cell of ps) {
      const [x, z] = cell.split(",").map(Number);
      put(x, 1, z, AIR);
    }
  }
  refreshBlocks(touched);
  const [sx, sz] = STARTS[name];
  const [ox, oz] = START_OFF[name] ?? [0, 0];
  return { x: sx + OX + 0.5 + ox, z: sz + OZ + 0.5 + oz };
}

// Fence ring with a 1-wide hole (mirrors the headless fence-hole rig).
function buildPenRing() {
  resetWorld("over");
  setDimension("over");
  clearFarmMobs();
  const touched = [];
  const put = (x, y, z, id) => { setBlock(x, y, z, id); touched.push([x, y, z]); };
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) put(x + OX, 0, z + OZ, STONE);
  for (let x = -2; x <= 2; x++) for (const z of [-2, 2]) {
    put(x + OX, 1, z + OZ, STONE); put(x + OX, 2, z + OZ, STONE);
  }
  for (let z = -1; z <= 1; z++) for (const x of [-2, 2]) {
    if (x === 2 && z === 0) continue;
    put(x + OX, 1, z + OZ, STONE); put(x + OX, 2, z + OZ, STONE);
  }
  refreshBlocks(touched);
}

function walkFence(dir, { seed = 1, maxTicks = 1200 } = {}) {
  buildPenRing();
  const sx = dir === "out-in" ? 4.5 : 0.5, tx = dir === "out-in" ? 0.5 : 4.5;
  const yaw = dir === "out-in" ? -Math.PI / 2 : Math.PI / 2;
  const mob = spawnFarmMobAt(sceneRef, sx + OX, 0.5 + OZ, FEET);
  if (!mob) return { ok: false, reason: "no-spawn" };
  mob.pos.set(sx + OX, FEET, 0.5 + OZ);
  mob.yaw = yaw; mob.yawTarget = yaw;
  mob.fallFrom = FEET;
  mob.target = { x: tx + OX, z: 0.5 + OZ };
  mob.wanderT = 1e9;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const trace = [];
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMobs(DT, "over");
      trace.push({ x: mob.pos.x - OX, y: mob.pos.y, z: mob.pos.z - OZ, yaw: mob.yaw, lane: mob.lane != null, fl: mob.followLine ? mob.followLine.line : null });
      const lx = mob.pos.x - OX;
      if ((dir === "out-in" && lx < 1.5) || (dir === "in-out" && lx > 2.5)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  return { ok: true, type: mob.type, trace };
}

// One deterministic trial: fixed far target along the start heading, seeded
// RNG behind the stepping (spawn draw, junction picks). Returns plain JSON.
function walk(kind, name, { seed = 1, maxTicks = 1500, goal = null, yaw = 0, walls = null } = {}) {
  const start = buildRig(kind, name, walls ?? {});
  const mob = spawnFarmMobAt(sceneRef, start.x, start.z, FEET);
  if (!mob) return { ok: false, reason: "no-spawn" };
  mob.pos.set(start.x, FEET, start.z);
  mob.yaw = yaw; mob.yawTarget = yaw;
  mob.fallFrom = FEET;
  mob.target = { x: start.x + Math.sin(yaw) * 30, z: start.z + Math.cos(yaw) * 30 };
  mob.wanderT = 1e9;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const trace = [];
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMobs(DT, "over");
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane != null, fl: mob.followLine ? mob.followLine.line : null });
      if (goal && goal(mob)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  // Report in rig-local coords so the driver shares predicates headless.
  for (const p of trace) { p.x -= OX; p.z -= OZ; }
  return { ok: true, type: mob.type, trace };
}

// Village door trial on the LIVE village (no voxel writes): house 0's
// door, off-axis approach and interior exit. Trace in world coords plus
// the house frame for driver predicates.
function walkVillageDoor(dir, { seed = 7, maxTicks = 1500 } = {}) {
  const h = village.houses[0];
  if (!h) return { ok: false, reason: "no-house" };
  const vy = h.vy;
  const midx = h.doorNz !== 0 ? h.d0x + 1 : h.d0x + 0.5;
  const midz = h.doorNz !== 0 ? h.d0z + 0.5 : h.d0z + 1;
  const latx = h.doorNz !== 0 ? 1.0 : 0, latz = h.doorNz !== 0 ? 0 : 1.0;
  const inX = h.cx + 0.5, inZ = h.cz + 0.5;
  const outX = midx + h.doorNx * 1.2 + latx, outZ = midz + h.doorNz * 1.2 + latz;
  const [sx, sz, tx, tz] = dir === "out-in"
    ? [outX, outZ, inX, inZ]
    : [inX, inZ, outX, outZ];
  const mob = spawnFarmMobAt(sceneRef, sx, sz, vy + 1);
  if (!mob) return { ok: false, reason: "no-spawn" };
  mob.pos.set(sx, vy + 1, sz);
  mob.yaw = Math.atan2(midx - sx, midz - sz);
  mob.yawTarget = mob.yaw;
  mob.fallFrom = vy + 1;
  mob.target = { x: tx, z: tz };
  mob.wanderT = 1e9;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const trace = [];
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMobs(DT, "over");
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane != null, fl: mob.followLine ? mob.followLine.line : null });
      const p = trace.at(-1);
      const inside = p.x > h.minX && p.x < h.maxX + 1 && p.z > h.minZ && p.z < h.maxZ + 1;
      if ((dir === "out-in" && inside) || (dir === "in-out" && !inside)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  return { ok: true, type: mob.type, trace, house: { ...h }, vy };
}

export function initTest(ctx) {
  sceneRef = ctx.scene;
  window.__test = { ready: () => ctx.worldReady(), rig: buildRig, walk, walkFence, walkVillageDoor, layouts: Object.keys(LAYOUTS) };
}
