// ?test=1 in-page hook: deterministic 1-wide path rigs for the browser
// driver (tests/browser/mob-paths.mjs). Loaded by main.js only when the
// param is set; zero game impact otherwise. Voxel writes go through the
// live store, mob steps through the real tickFarmMobs — the same code the
// game loop runs — with Math.random seeded per trial, so traces are
// reproducible. Rendering is untouched (refreshBlocks keeps meshes honest).
import { AIR, STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { spawnFarmMobAt, clearFarmMobs, tickFarmMobs } from "../../../src/mobs/farm.js";
import { refreshBlocks } from "../../../src/render/mesher.js";

const FEET = 1;
const DT = 1 / 60;

export const LAYOUTS = {
  straight: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]],
  l: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  t: [[1, 0], [1, 1], [0, 2], [1, 2], [2, 2]],
  cross: [[1, -1], [1, 0], [1, 1], [1, 2], [1, 3], [0, 1], [2, 1]],
  zigzag: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [2, 4]],
  deadend: [[0, 0], [0, 1], [0, 2]],
};

export const STARTS = { straight: [0, 0], l: [0, 0], t: [1, 0], cross: [1, -1], zigzag: [0, 0], deadend: [0, 0] };

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

function buildRig(kind, name) {
  resetWorld("over");
  setDimension("over");
  clearFarmMobs();
  const layout = LAYOUTS[name].map(([x, z]) => [x + OX, z + OZ]);
  const ps = new Set(layout.map(([x, z]) => `${x},${z}`));
  const xs = layout.map((c) => c[0]), zs = layout.map((c) => c[1]);
  const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3;
  const z0 = Math.min(...zs) - 3, z1 = Math.max(...zs) + 3;
  const touched = [];
  const put = (x, y, z, id) => { setBlock(x, y, z, id); touched.push([x, y, z]); };
  const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (kind === "muret") {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) put(x, 0, z, STONE);
    for (const cell of ps) {
      const [x, z] = cell.split(",").map(Number);
      for (const [dx, dz] of adj) {
        if (ps.has(`${x + dx},${z + dz}`)) continue;
        put(x + dx, 1, z + dz, STONE);
        put(x + dx, 2, z + dz, STONE);
      }
    }
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
  return { x: sx + OX + 0.5, z: sz + OZ + 0.5 };
}

// One deterministic trial: fixed far target along the start heading, seeded
// RNG behind the stepping (spawn draw, junction picks). Returns plain JSON.
function walk(kind, name, { seed = 1, maxTicks = 1500, goal = null, yaw = 0 } = {}) {
  const start = buildRig(kind, name);
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
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane != null });
      if (goal && goal(mob)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  // Report in rig-local coords so the driver shares predicates headless.
  for (const p of trace) { p.x -= OX; p.z -= OZ; }
  return { ok: true, type: mob.type, trace };
}

export function initTest(ctx) {
  sceneRef = ctx.scene;
  window.__test = { ready: () => ctx.worldReady(), rig: buildRig, walk, layouts: Object.keys(LAYOUTS) };
}
