// Kinematic 1-wide path tests: the REAL mover (mover.js) on REAL voxels
// (store.js), headless (mob.root is null, cosmetics self-skip).
// Paired rigs — waist-high physical murets vs 1-deep ground trenches — must
// behave identically: air walls and solid walls share the unified predicate.
import assert from "node:assert/strict";
import { AIR, STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid } from "../../../src/mobs/mover.js";

const FEET = 1;
const DT = 1 / 60;
const N = 0;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAYOUTS = {
  straight: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]],
  l: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  t: [[1, 0], [1, 1], [0, 2], [1, 2], [2, 2]],
  cross: [[1, -1], [1, 0], [1, 1], [1, 2], [1, 3], [0, 1], [2, 1]],
  zigzag: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [2, 4]],
  deadend: [[0, 0], [0, 1], [0, 2]],
};

const START = { straight: [0, 0], l: [0, 0], t: [1, 0], cross: [1, -1], zigzag: [0, 0], deadend: [0, 0] };

function buildRig(kind, layout) {
  resetWorld("over");
  setDimension("over");
  const ps = new Set(layout.map(([x, z]) => `${x},${z}`));
  const xs = layout.map((c) => c[0]), zs = layout.map((c) => c[1]);
  const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3;
  const z0 = Math.min(...zs) - 3, z1 = Math.max(...zs) + 3;
  const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (kind === "muret") {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, 0, z, STONE);
    for (const cell of ps) {
      const [x, z] = cell.split(",").map(Number);
      for (const [dx, dz] of adj) {
        if (ps.has(`${x + dx},${z + dz}`)) continue;
        setBlock(x + dx, 1, z + dz, STONE);
        setBlock(x + dx, 2, z + dz, STONE);
      }
    }
  } else {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      setBlock(x, 0, z, STONE);
      setBlock(x, 1, z, STONE);
    }
    for (const cell of ps) {
      const [x, z] = cell.split(",").map(Number);
      setBlock(x, 1, z, AIR);
    }
  }
}

function makeTestMob(kind, x, y, z, yaw) {
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  return {
    type: kind, dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0,
  };
}

// Fixed far target along the start heading; the servo ignores it while
// engaged, the wander only uses it before engagement.
function runTrial(kind, name, { seed = 1, maxTicks = 1500, goal = null, yaw = N } = {}) {
  buildRig(kind, LAYOUTS[name]);
  const [sx, sz] = START[name];
  const mob = makeTestMob("pig", sx + 0.5, FEET, sz + 0.5, yaw);
  const fixed = { x: sx + 0.5 + Math.sin(yaw) * 30, z: sz + 0.5 + Math.cos(yaw) * 30 };
  mob.target = fixed;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const trace = [];
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMob(mob, DT, () => fixed);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane != null });
      if (goal && goal(mob)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  return trace;
}

function speeds(trace) {
  const out = [];
  for (let i = 1; i < trace.length; i++) {
    const dx = trace[i].x - trace[i - 1].x, dz = trace[i].z - trace[i - 1].z;
    out.push(Math.hypot(dx, dz) / DT);
  }
  return out;
}

// No wall penetration anywhere (body + nose), no floor sink.
function assertClean(trace, label) {
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    assert.ok(!aabbIntersectsSolid(p.x, p.y, p.z, 0.32, 1.3), `${label}: body in wall @tick${i} (${p.x.toFixed(2)},${p.z.toFixed(2)})`);
    assert.ok(Math.abs(p.y - FEET) < 0.05, `${label}: feet off ground @tick${i} (y=${p.y.toFixed(3)})`);
  }
}

function assertFluid(trace, label, minSpeed, maxStalls) {
  const sp = speeds(trace).slice(15); // grace: engagement + first stride
  const stalls = sp.filter((v) => v < minSpeed).length;
  assert.ok(stalls <= maxStalls, `${label}: ${stalls} slow ticks (min ${Math.min(...sp).toFixed(2)} m/s)`);
}

// Nearest-cell path index must never step back a full cell: no U-turn
// outside dead ends, no junction ping-pong.
function assertNoReturn(trace, layout, label) {
  let lo = 0;
  for (let i = 0; i < trace.length; i++) {
    let best = 0, bd = Infinity;
    for (let c = 0; c < layout.length; c++) {
      const d = Math.abs(trace[i].x - (layout[c][0] + 0.5)) + Math.abs(trace[i].z - (layout[c][1] + 0.5));
      if (d < bd) { bd = d; best = c; }
    }
    assert.ok(best >= lo - 0 || bd < 0.9, `${label}: backward jump @tick${i}`);
    if (bd < 0.9) lo = Math.max(lo, best);
    void lo;
  }
}

// --- straight: centre tracking, full speed, servo latched ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "straight", { goal: (m) => Math.floor(m.pos.z) >= 6 });
  assert.ok(trace.length < 1500, `${kind}/straight: reached the end`);
  const lat = trace.slice(15).map((p) => Math.abs(p.x - 0.5));
  assert.ok(Math.max(...lat) < 0.2, `${kind}/straight: centred (max dev ${Math.max(...lat).toFixed(3)})`);
  assert.ok(trace.slice(10).every((p) => p.lane), `${kind}/straight: servo stays latched`);
  assertFluid(trace, `${kind}/straight`, 1.0, 4);
  assertClean(trace, `${kind}/straight`);
  assertNoReturn(trace, LAYOUTS.straight, `${kind}/straight`);
}
console.log("PASS straight (muret + trench)");

// --- L: fluid corner, no stall, ends on the arm ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "l", { goal: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 2, maxTicks: 2000 });
  assert.ok(trace.length < 2000, `${kind}/L: turned onto the arm`);
  assertFluid(trace, `${kind}/L`, 0.8, 8);
  assertClean(trace, `${kind}/L`);
  assertNoReturn(trace, [...LAYOUTS.l], `${kind}/L`);
}
console.log("PASS L (muret + trench)");

// --- zigzag: chained jogs, smooth throughout ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "zigzag", { goal: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 4, maxTicks: 2500 });
  assert.ok(trace.length < 2500, `${kind}/zigzag: cleared all jogs`);
  assertFluid(trace, `${kind}/zigzag`, 0.8, 12);
  assertClean(trace, `${kind}/zigzag`);
}
console.log("PASS zigzag (muret + trench)");

// --- dead end: goes in, U-turns once, walks back out ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "deadend", { maxTicks: 1200 });
  const maxZ = Math.max(...trace.map((p) => p.z));
  assert.ok(maxZ >= 2.3, `${kind}/deadend: reached the back wall (${maxZ.toFixed(2)})`);
  const tail = trace.slice(Math.floor(trace.length * 0.6));
  assert.ok(Math.min(...tail.map((p) => p.z)) <= 1.0, `${kind}/deadend: walked back out`);
  assertClean(trace, `${kind}/deadend`);
}
console.log("PASS deadend (muret + trench)");

// --- T: random arm, both taken across trials, never back down the stem ---
for (const kind of ["muret", "trench"]) {
  const arms = new Set();
  for (let t = 0; t < 16; t++) {
    const trace = runTrial(kind, "t", {
      seed: 500 + t, maxTicks: 1200,
      goal: (m) => Math.floor(m.pos.z) === 2 && (Math.floor(m.pos.x) === 0 || Math.floor(m.pos.x) === 2),
    });
    assert.ok(trace.length < 1200, `${kind}/T trial${t}: picked an arm`);
    assert.ok(trace.every((p) => p.z > -0.2), `${kind}/T trial${t}: never back down the stem`);
    assertClean(trace, `${kind}/T trial${t}`);
    arms.add(trace.at(-1).x < 1.5 ? "W" : "E");
  }
  assert.ok(arms.has("W") && arms.has("E"), `${kind}/T: both arms explored (${[...arms]})`);
}
console.log("PASS T branches (muret + trench)");

// --- cross: all three exits taken across trials, entry never ---
for (const kind of ["muret", "trench"]) {
  const exits = new Set();
  const ends = new Set(["1,3", "0,1", "2,1"]);
  for (let t = 0; t < 24; t++) {
    const trace = runTrial(kind, "cross", {
      seed: 900 + t, maxTicks: 1500,
      goal: (m) => ends.has(`${Math.floor(m.pos.x)},${Math.floor(m.pos.z)}`),
    });
    assert.ok(trace.length < 1500, `${kind}/cross trial${t}: left through an arm`);
    assert.ok(trace.every((p) => p.z > -1.2), `${kind}/cross trial${t}: never reversed out`);
    assertClean(trace, `${kind}/cross trial${t}`);
    exits.add(`${Math.floor(trace.at(-1).x)},${Math.floor(trace.at(-1).z)}`);
  }
  assert.deepEqual(exits, ends, `${kind}/cross: all three exits explored (${[...exits]})`);
}
console.log("PASS cross branches (muret + trench)");

// --- equivalence: same seed => bit-identical traces, mur ≡ air ---
for (const name of ["straight", "l", "zigzag", "deadend"]) {
  const goals = {
    straight: (m) => Math.floor(m.pos.z) >= 6,
    l: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 2,
    zigzag: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 4,
    deadend: null,
  };
  const a = runTrial("muret", name, { seed: 7, maxTicks: 1200, goal: goals[name] });
  const b = runTrial("trench", name, { seed: 7, maxTicks: 1200, goal: goals[name] });
  assert.equal(a.length, b.length, `${name}: same trace length (muret ${a.length} vs trench ${b.length})`);
  let dev = 0;
  for (let i = 0; i < a.length; i++) {
    dev = Math.max(dev, Math.abs(a[i].x - b[i].x) + Math.abs(a[i].z - b[i].z));
  }
  assert.ok(dev < 1e-9, `${name}: identical trajectories (dev ${dev})`);
}
console.log("PASS muret≡trench equivalence");

console.log("mob-paths.test.mjs: ALL PASS");
