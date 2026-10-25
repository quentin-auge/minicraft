// Kinematic 1-wide path tests: the REAL mover (mover.js) on REAL voxels
// (store.js), headless (mob.root is null, cosmetics self-skip).
// Paired rigs — waist-high physical murets vs 1-deep ground trenches — must
// behave identically: air walls and solid walls share the unified predicate.
import assert from "node:assert/strict";
import { AIR, STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid, segmentWalkable } from "../../../src/mobs/mover.js";
import { village, computeLayout, placeVillage } from "../../../src/world/village.js";

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
  straightE: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]],
  l: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  t: [[1, 0], [1, 1], [0, 2], [1, 2], [2, 2]],
  cross: [[1, -1], [1, 0], [1, 1], [1, 2], [1, 3], [0, 1], [2, 1]],
  zigzag: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [2, 4]],
  deadend: [[0, 0], [0, 1], [0, 2]],
  lstub: [[0, 0], [0, 1], [0, 2], [1, 2]],
  lstubret: [[0, 0], [0, 1], [0, 2], [1, 2]],
  door2: [[0, 0], [0, 1], [0, 2], [1, 2]],
  door2ret: [[0, 0], [0, 1], [0, 2], [1, 2]],
  straight2: (() => { const c = []; for (let z = 0; z <= 7; z++) { c.push([0, z], [1, z]); } return c; })(),
  l2: (() => {
    const c = [];
    for (let z = 0; z <= 3; z++) { c.push([0, z], [1, z]); }
    for (let x = 0; x <= 5; x++) { c.push([x, 2], [x, 3]); }
    return [...new Map(c.map((p) => [`${p[0]},${p[1]}`, p])).values()];
  })(),
  funnel21: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]],
  t2: [[1, 0], [1, 1], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 2], [-1, 3], [0, 3], [1, 3], [2, 3], [3, 3]],
  doorway: [[2, 0], [2, 1], [2, 2]],
  mouth: [[0, 0], [0, 1], [0, 2], [0, 3]],
};

// Explicit walls (doorway rig): [x, z] cells raised y=1..2.
const DOOR_WALLS = [
  [-1, 3], [2, 3], [3, 3],
  [-1, 6], [0, 6], [1, 6], [2, 6], [3, 6],
  [-1, 4], [-1, 5], [3, 4], [3, 5],
];

const START = {
  straight: [0, 0], straightE: [0, 0], l: [0, 0], t: [1, 0], cross: [1, -1],
  zigzag: [0, 0], deadend: [0, 0], lstub: [0, 0], lstubret: [1, 2], door2: [0, 0], door2ret: [1, 2], straight2: [0, 0], l2: [0, 0],
  funnel21: [0, 0], t2: [1, 0], doorway: [2, 0], mouth: [0, 0],
};
const START_YAW = {
  straight: 0, straightE: Math.PI / 2, l: 0, t: 0, cross: 0,   zigzag: 0, deadend: 0, lstub: 0, lstubret: -Math.PI / 2, door2: 0, door2ret: -Math.PI / 2,
  straight2: 0, l2: 0, funnel21: 0, t2: 0, doorway: 0, mouth: 0,
};

function buildRig(kind, layout, { auto = true, skip = [], extra = [] } = {}) {
  resetWorld("over");
  setDimension("over");
  const ps = new Set(layout.map(([x, z]) => `${x},${z}`));
  const skipSet = new Set(skip.map(([x, z]) => `${x},${z}`));
  const all = [...layout, ...extra, ...skip];
  const xs = all.map((c) => c[0]), zs = all.map((c) => c[1]);
  const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3;
  const z0 = Math.min(...zs) - 3, z1 = Math.max(...zs) + 3;
  const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const raiseWall = (x, z) => { setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE); };
  if (kind === "muret") {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, 0, z, STONE);
    if (auto) {
      for (const cell of ps) {
        const [x, z] = cell.split(",").map(Number);
        for (const [dx, dz] of adj) {
          if (ps.has(`${x + dx},${z + dz}`) || skipSet.has(`${x + dx},${z + dz}`)) continue;
          raiseWall(x + dx, z + dz);
        }
      }
    }
    for (const [x, z] of extra) raiseWall(x, z);
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
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    funnelT: 0, funnelCool: 0,
  };
}

// Fixed far target along the start heading; the servo ignores it while
// engaged, roam/wander use it otherwise. walls passes buildRig options.
function runTrial(kind, name, { seed = 1, maxTicks = 1500, goal = null, yaw = null, off = null, walls = null } = {}) {
  buildRig(kind, LAYOUTS[name], walls ?? {});
  const [sx, sz] = START[name];
  const syaw = yaw ?? START_YAW[name] ?? N;
  const [ox, oz] = off ?? [0, 0];
  const mob = makeTestMob("pig", sx + 0.5 + ox, FEET, sz + 0.5 + oz, syaw);
  const fixed = { x: sx + 0.5 + Math.sin(syaw) * 30, z: sz + 0.5 + Math.cos(syaw) * 30 };
  mob.target = fixed;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const trace = [];
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMob(mob, DT, () => fixed);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane != null, fl: mob.followLine ? mob.followLine.line : null });
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

// No lateral dither on straights: the follow line must never latch in a
// true 1-wide corridor (regression: an erect/drop ping-pong shook ±0.03
// at ~30 Hz while the envelope asserts stayed green), and per-tick
// lateral velocity must barely reverse sign.
function assertNoTremble(trace, label, lateral) {
  const steady = trace.slice(15);
  assert.ok(steady.every((p) => p.fl == null), `${label}: no follow line latched`);
  let flips = 0, prevSign = 0;
  for (let i = 1; i < steady.length; i++) {
    const d = lateral(steady[i]) - lateral(steady[i - 1]);
    if (Math.abs(d) > 1e-9) {
      if (prevSign !== 0 && Math.sign(d) !== prevSign) flips++;
      prevSign = Math.sign(d);
    }
  }
  assert.ok(flips < 20, `${label}: lateral flips ${flips}`);
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
  assertNoTremble(trace, `${kind}/straight`, (p) => p.x);
  assertFluid(trace, `${kind}/straight`, 1.0, 4);
  assertClean(trace, `${kind}/straight`);
  assertNoReturn(trace, LAYOUTS.straight, `${kind}/straight`);
}
console.log("PASS straight (muret + trench)");

// --- straightE: same centre tracking on the other axis (spawned off-centre
// so the lateral slide must actually work — the tz component only runs here).
// Regression guard for the az/ax swap: without it z never recentres.
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "straightE", { off: [0, 0.15], goal: (m) => Math.floor(m.pos.x) >= 6 });
  assert.ok(trace.length < 1500, `${kind}/straightE: reached the end`);
  const tail = trace.slice(Math.floor(trace.length * 0.66));
  assert.ok(Math.max(...tail.map((p) => Math.abs(p.z - 0.5))) < 0.05, `${kind}/straightE: recentred`);
  assert.ok(trace.slice(10).every((p) => p.lane), `${kind}/straightE: servo stays latched`);
  assertNoTremble(trace, `${kind}/straightE`, (p) => p.z);
  assertFluid(trace, `${kind}/straightE`, 1.0, 4);
  assertClean(trace, `${kind}/straightE`);
}
console.log("PASS straightE (muret + trench)");

// --- straight2: 2-wide hugs a wall at virtual-lane offset, never glides
// to the middle. Spawn hugging the west wall: settled |x - 0.75| band plus
// an explicit anti-middle assert.
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "straight2", { off: [-0.15, 0], goal: (m) => Math.floor(m.pos.z) >= 7 });
  assert.ok(trace.length < 1500, `${kind}/straight2: reached the end`);
  const tail = trace.slice(Math.floor(trace.length * 0.66));
  assert.ok(Math.max(...tail.map((p) => Math.abs(p.x - 0.75))) < 0.2, `${kind}/straight2: wall offset held`);
  assert.ok(tail.every((p) => Math.abs(p.x - 1.0) > 0.08), `${kind}/straight2: never mid-space`);
  assertFluid(trace, `${kind}/straight2`, 1.0, 6);
  assertClean(trace, `${kind}/straight2`);
}
console.log("PASS straight2 (muret + trench)");

// --- l2: 2-wide corner via wall-follow turns, offset held on the arm ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "l2", { off: [0.5, 0], goal: (m) => Math.floor(m.pos.x) >= 5, maxTicks: 2000 });
  assert.ok(trace.length < 2000, `${kind}/L2: turned onto the arm`);
  assertFluid(trace, `${kind}/L2`, 0.8, 12);
  assertClean(trace, `${kind}/L2`);
  const arm = trace.filter((p) => p.x >= 2.5 && p.x <= 4.3);
  assert.ok(arm.length > 20, `${kind}/L2: arm cruise sampled`);
  assert.ok(Math.max(...arm.map((p) => Math.abs(Math.abs(p.z - 3.0) - 0.25))) < 0.2, `${kind}/L2: steady arm line`);
}
console.log("PASS L2 (muret + trench)");

// --- funnel21: 2-wide narrows to an offset 1-wide arm, walked through ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "funnel21", { off: [0.5, 0], goal: (m) => Math.floor(m.pos.z) >= 6, maxTicks: 2000 });
  assert.ok(trace.length < 2000, `${kind}/funnel21: passed through`);
  assertFluid(trace, `${kind}/funnel21`, 0.8, 14);
  assertClean(trace, `${kind}/funnel21`);
  const narrow = trace.filter((p) => p.z >= 4);
  assert.ok(Math.max(...narrow.map((p) => Math.abs(p.x - 1.5))) < 0.15, `${kind}/funnel21: settled into the narrow arm`);
}
console.log("PASS funnel21 (muret + trench)");

// --- t2: mixed 1-wide stem into 2-wide bar, random arm, never back ---
for (const kind of ["muret", "trench"]) {
  const arms = new Set();
  for (let t = 0; t < 16; t++) {
    const trace = runTrial(kind, "t2", {
      seed: 500 + t, maxTicks: 1500,
      goal: (m) => (Math.floor(m.pos.x) <= -1 || Math.floor(m.pos.x) >= 3) &&
        (Math.floor(m.pos.z) === 2 || Math.floor(m.pos.z) === 3),
    });
    assert.ok(trace.length < 1500, `${kind}/T2 trial${t}: picked an arm`);
    assert.ok(trace.every((p) => p.z > -0.2), `${kind}/T2 trial${t}: never back down the stem`);
    assertClean(trace, `${kind}/T2 trial${t}`);
    arms.add(trace.at(-1).x < 1.5 ? "W" : "E");
  }
  assert.ok(arms.has("W") && arms.has("E"), `${kind}/T2: both arms explored (${[...arms]})`);
}
console.log("PASS T2 branches (muret + trench)");

// --- doorway: off-axis approach steers through the 2-wide gap, no touch ---
{
  const trace = runTrial("muret", "doorway", {
    walls: { auto: false, extra: DOOR_WALLS },
    goal: (m) => m.pos.z >= 4.5, maxTicks: 1500,
  });
  assert.ok(trace.length < 1500, "doorway: entered the room");
  const cross = trace.filter((p) => p.z >= 2.8 && p.z <= 3.2);
  assert.ok(cross.length > 0, "doorway: crossed the wall plane");
  assertClean(trace, "doorway");
}
console.log("PASS doorway (muret)");

// --- mouth: 1-wide path opening onto a field commits out; a pinballing
// mob would never get deep into the field, so reaching z>=6 proves a
// clean exit (later returns over the mouth are legitimate roaming) ---
{
  const trace = runTrial("muret", "mouth", { walls: { skip: [[0, 4]] }, goal: (m) => m.pos.z >= 6, maxTicks: 1200 });
  assert.ok(trace.length < 1200, "mouth: walked out into the field");
  assertClean(trace, "mouth");
}
console.log("PASS mouth (muret)");

// --- L: fluid corner, no stall, ends on the arm ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "l", { goal: (m) => Math.floor(m.pos.x) >= 3 && Math.floor(m.pos.z) >= 2, maxTicks: 2000 });
  assert.ok(trace.length < 2000, `${kind}/L: turned onto the arm`);
  assertFluid(trace, `${kind}/L`, 0.8, 8);
  assertClean(trace, `${kind}/L`);
  assertNoReturn(trace, [...LAYOUTS.l], `${kind}/L`);
  // Post-turn recentring on the arm: the blend arc exits slightly off the
  // centreline, cruise must pull it back (regression: the tz component).
  const arm = trace.filter((p) => p.x >= 1.6 && p.x <= 2.6);
  assert.ok(arm.length > 20, `${kind}/L: arm cruise sampled`);
  assert.ok(Math.max(...arm.map((p) => Math.abs(p.z - 2.5))) < 0.08, `${kind}/L: recentred on arm`);
}
console.log("PASS L (muret + trench)");

// --- zigzag: chained jogs complete on every seed; fluidity as a median.
// Straight-cruise entry healing keeps turn-then-straight cells
// deterministic (no backtrack coin flips), so every seed runs the same
// fast line; the suite still asserts completion everywhere plus a
// distribution bound as a guard.
for (const kind of ["muret", "trench"]) {
  const slows = [];
  for (let s = 1; s <= 8; s++) {
    const trace = runTrial(kind, "zigzag", { seed: s, goal: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 4, maxTicks: 2500 });
    assert.ok(trace.length < 2500, `${kind}/zigzag seed ${s}: cleared all jogs`);
    slows.push(speeds(trace).slice(15).filter((v) => v < 0.8).length);
    assertClean(trace, `${kind}/zigzag seed ${s}`);
  }
  slows.sort((a, b) => a - b);
  const median = (slows[3] + slows[4]) / 2;
  assert.ok(median <= 12, `${kind}/zigzag: median slow ticks ${median} (all: ${slows.join(",")})`);
  assert.ok(slows[7] <= 120, `${kind}/zigzag: worst seed ${slows[7]} slow ticks`);
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

// --- turn-stub: dead end right past a turn, in and back out ---
// The reported case: a 1-wide cul-de-sac directly after a bend must U-turn
// like a straight one, with the arm cruised on its centreline both ways.
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "lstub", { goal: (m) => m.pos.x >= 1.5 });
  assert.ok(trace.length < 1500, `${kind}/lstub: turned into the stub`);
  assertClean(trace, `${kind}/lstub`);
  assertFluid(trace, `${kind}/lstub`, 0.8, 8);
  const arm = trace.filter((p) => p.x > 1.1);
  assert.ok(arm.length > 8, `${kind}/lstub: arm cruise sampled`);
  assert.ok(Math.max(...arm.map((p) => Math.abs(p.z - 2.5))) < 0.08, `${kind}/lstub: centred on the arm`);
  const back = runTrial(kind, "lstubret", { goal: (m) => Math.floor(m.pos.z) <= 0 && Math.floor(m.pos.x) === 0 });
  assert.ok(back.length < 1500, `${kind}/lstubret: walked back out through the turn`);
  assertClean(back, `${kind}/lstubret`);
  assertFluid(back, `${kind}/lstubret`, 0.8, 8);
  const armBack = back.filter((p) => p.x > 1.1);
  assert.ok(armBack.length > 8, `${kind}/lstubret: arm cruise sampled`);
  assert.ok(Math.max(...armBack.map((p) => Math.abs(p.z - 2.5))) < 0.08, `${kind}/lstubret: centred on the arm`);
}
console.log("PASS turn-stub (muret + trench)");

// --- door: 1-wide dead end with a niche (door) in the end wall, in and back
// out. Both turns are forced (no coin flip); the niche is entered, U-turned,
// and left behind for good.
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "door2", { goal: (m) => Math.floor(m.pos.x) === 1 && Math.floor(m.pos.z) === 2 });
  assert.ok(trace.length < 1500, `${kind}/door2: walked into the niche`);
  assertClean(trace, `${kind}/door2`);
  assertFluid(trace, `${kind}/door2`, 0.8, 8);
  const back = runTrial(kind, "door2ret", { goal: (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0 });
  assert.ok(back.length < 1500, `${kind}/door2ret: walked back out through the door`);
  assertClean(back, `${kind}/door2ret`);
  assertFluid(back, `${kind}/door2ret`, 0.8, 8);
}
console.log("PASS door (muret + trench)");

// --- spiral: square 1-wide path winding 4 chained turns into a central
// dead end, plus straight pit rigs (a 1-wide hole across the path with a
// walkable parallel corridor 2 cells away — the exact mirage setup: the
// far side reads walkable through solid rock). Drop-1 (former step-down
// trap) and drop-2 (probe-visible but unreachable) must both U-turn at the
// lip, never descend, never funnel, and walk back out. Elevated rigs (feet
// y=3) so pits stay in groundBelow range. Muret and trench traces must be
// bit-identical.
const SPIRAL_FEET = 3;
const SPIRAL = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [4, 3], [4, 4],
  [3, 4], [2, 4], [1, 4], [0, 4],
  [0, 3], [0, 2], [1, 2], [2, 2],
];
const PITSTRAIGHT = [[-1, 0], [0, 0], [1, 0], [2, 0]];
const PITDECOY = [[-1, -2], [0, -2], [1, -2], [2, -2]];
function buildElevated(kind, cells, pits = []) {
  resetWorld("over");
  setDimension("over");
  const ps = new Set(cells.map(([x, z]) => `${x},${z}`));
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3;
  const z0 = Math.min(...zs) - 3, z1 = Math.max(...zs) + 3;
  const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    for (let y = 0; y <= 2; y++) setBlock(x, y, z, STONE);
    if (kind === "trench") { setBlock(x, 3, z, STONE); setBlock(x, 4, z, STONE); }
  }
  for (const cell of ps) {
    const [x, z] = cell.split(",").map(Number);
    if (kind === "muret") {
      for (const [dx, dz] of adj) {
        if (ps.has(`${x + dx},${z + dz}`)) continue;
        setBlock(x + dx, 3, z + dz, STONE); setBlock(x + dx, 4, z + dz, STONE);
      }
    } else {
      setBlock(x, 3, z, AIR); setBlock(x, 4, z, AIR);
    }
  }
  for (const [x, z, d] of pits)
    for (let y = 2; y > 2 - d; y--) setBlock(x, y, z, AIR);
}
function makeElevMob(x, y, z, yaw) {
  const shape = specCircles(LIVESTOCK_SPECS.pig);
  return {
    type: "pig", dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    funnelT: 0, funnelCool: 0,
  };
}
// visit(m) latches once (e.g. lip reached), goal(m) ends the run after that.
function spiralTrial(kind, cells, { sx, sz, yaw, visit, goal, pits = [], seed = 1, maxTicks = 3000 }) {
  buildElevated(kind, cells, pits);
  const mob = makeElevMob(sx, SPIRAL_FEET, sz, yaw);
  const fixed = { x: sx + Math.sin(yaw) * 30, z: sz + Math.cos(yaw) * 30 };
  mob.target = fixed;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const trace = [];
  let funTicks = 0, minY = Infinity, maxX = -Infinity, saw = visit == null;
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMob(mob, DT, () => fixed);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
      if (mob.pos.y < minY) minY = mob.pos.y;
      if (mob.pos.x > maxX) maxX = mob.pos.x;
      if ((mob.funnelCool ?? 0) > 0) funTicks++;
      if (!saw && visit && visit(mob)) saw = true;
      if (saw && goal(mob)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  return { trace, funTicks, minY, maxX, saw };
}
function assertSpiralClean(trace, label) {
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    assert.ok(!aabbIntersectsSolid(p.x, p.y, p.z, 0.32, 1.3), `${label}: body in wall @tick${i}`);
    assert.ok(Math.abs(p.y - SPIRAL_FEET) < 0.05, `${label}: off level @tick${i} (y=${p.y.toFixed(3)})`);
  }
}
for (const kind of ["muret", "trench"]) {
  // Plain spiral: wind into the centre, U-turn, unwind back out.
  for (const [sx, sz, yaw, goal, label] of [
    [0.5, 0.5, Math.PI / 2, (m) => Math.floor(m.pos.x) === 2 && Math.floor(m.pos.z) === 2, "in"],
    [2.5, 2.5, -Math.PI / 2, (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0, "out"],
  ]) {
    const r = spiralTrial(kind, SPIRAL, { sx, sz, yaw, goal, seed: 1 });
    assert.ok(r.trace.length < 2500, `${kind}/spiral-${label}: completed`);
    assertSpiralClean(r.trace, `${kind}/spiral-${label}`);
    assertFluid(r.trace, `${kind}/spiral-${label}`, 0.8, 20);
  }
  // Pit across the path with a walkable parallel corridor 2 cells away
  // (the exact mirage setup): engage, cruise to the lip, U-turn, never
  // descend, never funnel, walk back out.
  for (const [depth, label] of [[1, "spiral-pit1"], [2, "spiral-pit2"]]) {
    const r = spiralTrial(kind, [...PITSTRAIGHT, ...PITDECOY], {
      sx: -0.5, sz: 0.5, yaw: Math.PI / 2,
      visit: (m) => m.pos.x >= -0.2,
      goal: (m) => m.pos.x < -0.55,
      pits: [[1, 0, depth]], seed: 1,
    });
    assert.ok(r.saw, `${kind}/${label}: reached the lip`);
    assert.ok(r.trace.length < 2500, `${kind}/${label}: walked back out`);
    assertSpiralClean(r.trace, `${kind}/${label}`);
    assert.ok(r.minY >= SPIRAL_FEET - 1e-3, `${kind}/${label}: never descended`);
    assert.equal(r.funTicks, 0, `${kind}/${label}: never funnelled`);
    assert.ok(r.maxX < 1.0, `${kind}/${label}: never entered the pit`);
    assertFluid(r.trace, `${kind}/${label}`, 0.8, 80);
  }
  // Pit IN the spiral's central dead end: U-turn at the lip and unwind.
  {
    const r = spiralTrial(kind, SPIRAL, {
      sx: 1.5, sz: 2.5, yaw: Math.PI / 2,
      goal: (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0,
      pits: [[2, 2, 2]], seed: 1,
    });
    assert.ok(r.trace.length < 2500, `${kind}/spiral-pitend: walked back out`);
    assertSpiralClean(r.trace, `${kind}/spiral-pitend`);
    assert.ok(r.minY >= SPIRAL_FEET - 1e-3, `${kind}/spiral-pitend: never descended`);
    assert.equal(r.funTicks, 0, `${kind}/spiral-pitend: never funnelled`);
    assertFluid(r.trace, `${kind}/spiral-pitend`, 0.8, 80);
  }
}
console.log("PASS spiral (muret + trench)");

// --- spiral equivalence: same seed => bit-identical traces, mur ≡ air ---
for (const [cells, opts, label] of [
  [SPIRAL, { sx: 0.5, sz: 0.5, yaw: Math.PI / 2, goal: (m) => Math.floor(m.pos.x) === 2 && Math.floor(m.pos.z) === 2 }, "spiral-in"],
  [SPIRAL, { sx: 2.5, sz: 2.5, yaw: -Math.PI / 2, goal: (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0 }, "spiral-out"],
  [[...PITSTRAIGHT, ...PITDECOY], { sx: -0.5, sz: 0.5, yaw: Math.PI / 2, visit: (m) => m.pos.x >= -0.2, goal: (m) => m.pos.x < -0.55, pits: [[1, 0, 1]] }, "spiral-pit1"],
  [[...PITSTRAIGHT, ...PITDECOY], { sx: -0.5, sz: 0.5, yaw: Math.PI / 2, visit: (m) => m.pos.x >= -0.2, goal: (m) => m.pos.x < -0.55, pits: [[1, 0, 2]] }, "spiral-pit2"],
  [SPIRAL, { sx: 1.5, sz: 2.5, yaw: Math.PI / 2, goal: (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0, pits: [[2, 2, 2]] }, "spiral-pitend"],
]) {
  const a = spiralTrial("muret", cells, { ...opts, seed: 7 });
  const b = spiralTrial("trench", cells, { ...opts, seed: 7 });
  assert.equal(a.trace.length, b.trace.length, `${label}: same trace length (muret ${a.trace.length} vs trench ${b.trace.length})`);
  let dev = 0;
  for (let i = 0; i < a.trace.length; i++) {
    dev = Math.max(dev, Math.abs(a.trace[i].x - b.trace[i].x) + Math.abs(a.trace[i].z - b.trace[i].z));
  }
  assert.ok(dev < 1e-9, `${label}: identical trajectories (dev ${dev})`);
}
console.log("PASS spiral≡trench equivalence");

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
for (const name of ["straight", "l", "zigzag", "deadend", "lstub", "lstubret", "door2", "door2ret", "straight2", "l2", "funnel21"]) {
  const goals = {
    straight: (m) => Math.floor(m.pos.z) >= 6,
    l: (m) => Math.floor(m.pos.x) >= 3 && Math.floor(m.pos.z) >= 2,
    zigzag: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 4,
    deadend: null,
    lstub: (m) => m.pos.x >= 1.5,
    lstubret: (m) => Math.floor(m.pos.z) <= 0 && Math.floor(m.pos.x) === 0,
    door2: (m) => Math.floor(m.pos.x) === 1 && Math.floor(m.pos.z) === 2,
    door2ret: (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0,
    straight2: (m) => Math.floor(m.pos.z) >= 7,
    l2: (m) => Math.floor(m.pos.x) >= 5,
    funnel21: (m) => Math.floor(m.pos.z) >= 6,
  };
  const offs = {
    straight2: [-0.15, 0], l2: [0.5, 0], funnel21: [0.5, 0],
  };
  const a = runTrial("muret", name, { seed: 7, maxTicks: 1200, goal: goals[name], off: offs[name] });
  const b = runTrial("trench", name, { seed: 7, maxTicks: 1200, goal: goals[name], off: offs[name] });
  assert.equal(a.length, b.length, `${name}: same trace length (muret ${a.length} vs trench ${b.length})`);
  let dev = 0;
  for (let i = 0; i < a.length; i++) {
    dev = Math.max(dev, Math.abs(a[i].x - b[i].x) + Math.abs(a[i].z - b[i].z));
  }
  assert.ok(dev < 1e-9, `${name}: identical trajectories (dev ${dev})`);
}
console.log("PASS muret≡trench equivalence");

console.log("mob-paths.test.mjs: ALL PASS");

// --- segmentWalkable: whole-stride validation behind unified picks ---
{
  const pig = makeTestMob("pig", 0.5, 1, 0.5, 0);
  const flat = () => {
    resetWorld("over");
    setDimension("over");
    for (let x = -4; x <= 8; x++) for (let z = -4; z <= 8; z++) setBlock(x, 0, z, STONE);
  };
  flat();
  assert.ok(segmentWalkable(pig, 0.5, 0.5, 0.5, 6.5), "flat accepts");
  // Wall across the stride rejects.
  setBlock(0, 1, 3, STONE); setBlock(0, 2, 3, STONE);
  assert.ok(!segmentWalkable(pig, 0.5, 0.5, 0.5, 6.5), "wall rejects");
  // 1-wide gap aligned with the stride accepts.
  flat();
  for (let z = 2; z <= 4; z++) { setBlock(-1, 1, z, STONE); setBlock(-1, 2, z, STONE); }
  for (let z = 2; z <= 4; z++) { setBlock(1, 1, z, STONE); setBlock(1, 2, z, STONE); }
  assert.ok(segmentWalkable(pig, 0.5, 0.5, 0.5, 6.5), "aligned gap accepts");
  // 2-deep cliff mid-stride rejects (drop > maxDrop).
  flat();
  for (let x = -4; x <= 8; x++) for (let z = 3; z <= 4; z++) setBlock(x, 0, z, AIR);
  assert.ok(!segmentWalkable(pig, 0.5, 0.5, 0.5, 6.5), "cliff rejects");
  // 1-up step mid-stride rejects (never up).
  flat();
  for (let x = -4; x <= 8; x++) for (let z = 3; z <= 4; z++) setBlock(x, 1, z, STONE);
  assert.ok(!segmentWalkable(pig, 0.5, 0.5, 0.5, 6.5), "uphill rejects");
}
console.log("PASS segmentWalkable");

// --- fence hole: 1-wide gap in a ring passes both ways, no stall ---
function buildPenRing() {
  resetWorld("over");
  setDimension("over");
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) setBlock(x, 0, z, STONE);
  for (let x = -2; x <= 2; x++) for (const z of [-2, 2]) {
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
  for (let z = -1; z <= 1; z++) for (const x of [-2, 2]) {
    if (x === 2 && z === 0) continue; // the 1-wide hole
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}
for (const [sx, tx, label] of [[4.5, 0.5, "out-in"], [0.5, 4.5, "in-out"]]) {
  buildPenRing();
  const mob = makeTestMob("pig", sx, FEET, 0.5, sx > 2 ? -Math.PI / 2 : Math.PI / 2);
  mob.target = { x: tx, z: 0.5 };
  const realRandom = Math.random;
  Math.random = mulberry32(11);
  const trace = [];
  try {
    for (let t = 0; t < 1200; t++) {
      tickFarmMob(mob, DT, () => mob.target);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
      if ((sx > 2 && mob.pos.x < 1.5) || (sx < 2 && mob.pos.x > 2.5)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  assert.ok(trace.length < 1200, `fence-hole ${label}: crossed`);
  assert.ok(speeds(trace).slice(10).filter((v) => v < 0.8).length <= 10, `fence-hole ${label}: fluid`);
  assertClean(trace, `fence-hole ${label}`);
}
console.log("PASS fence-hole");

// --- village doors: a real leveled village, walk in and back out through
// house 0's door (off-axis approach + interior exit, both deterministic).
for (const seed of [7, 99]) {
  resetWorld("over");
  setDimension("over");
  computeLayout(seed, () => 14);
  const vy = village.center.y;
  for (let x = village.minX - 4; x <= village.maxX + 4; x++) {
    for (let z = village.minZ - 4; z <= village.maxZ + 4; z++) {
      for (let y = 0; y <= 14; y++) setBlock(x, y, z, STONE);
    }
  }
  placeVillage(setBlock, getBlock);
  const h = village.houses[0];
  const midx = h.doorNz !== 0 ? h.d0x + 1 : h.d0x + 0.5;
  const midz = h.doorNz !== 0 ? h.d0z + 0.5 : h.d0z + 1;
  // Close off-axis approach: the first roam decide already faces the wall
  // with the gap in scan range (a far spawn lets decide overwrite the
  // fixed target before the door is ever seen).
  const latx = h.doorNz !== 0 ? 1.0 : 0, latz = h.doorNz !== 0 ? 0 : 1.0;
  const inX = h.cx + 0.5, inZ = h.cz + 0.5;
  const outX = midx + h.doorNx * 1.2 + latx, outZ = midz + h.doorNz * 1.2 + latz;
  const inside = (p) => p.x > h.minX && p.x < h.maxX + 1 && p.z > h.minZ && p.z < h.maxZ + 1;
  for (const [sx, sz, tx, tz, goal, label] of [
    [outX, outZ, inX, inZ, (p) => inside(p), "out-in"],
    [inX, inZ, outX, outZ, (p) => !inside(p), "in-out"],
  ]) {
    const mob = makeTestMob("pig", sx, vy + 1, sz, Math.atan2(midx - sx, midz - sz));
    mob.target = { x: tx, z: tz };
    const realRandom = Math.random;
    Math.random = mulberry32(seed);
    const trace = [];
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z });
        if (goal(trace.at(-1))) break;
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(trace.length < 1500, `village-door seed${seed} ${label}: through the door`);
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i];
      assert.ok(!aabbIntersectsSolid(p.x, p.y, p.z, 0.32, 1.3), `village-door ${label}: clean @${i}`);
      assert.ok(Math.abs(p.y - (vy + 1)) < 0.05, `village-door ${label}: feet level @${i}`);
    }
  }
}
console.log("PASS village-door");

// --- open field: straight runs stay bounded, headings keep turning ---
{
  resetWorld("over");
  setDimension("over");
  for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) setBlock(x, 0, z, STONE);
  const mob = makeTestMob("pig", 0.5, FEET, 0.5, 0);
  mob.target = null;
  const realRandom = Math.random;
  Math.random = mulberry32(2026);
  const yaws = [];
  const trace = [];
  let pathLen = 0, px = 0.5, pz = 0.5;
  try {
    for (let t = 0; t < 3600; t++) {
      tickFarmMob(mob, DT, () => mob.target);
      if (t % 10 === 0) yaws.push(mob.yaw);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
      pathLen += Math.hypot(mob.pos.x - px, mob.pos.z - pz);
      px = mob.pos.x; pz = mob.pos.z;
    }
  } finally {
    Math.random = realRandom;
  }
  // Split into runs: a new run starts past 30° from the run start heading.
  let runs = 1, runStart = yaws[0], maxRun = 0, cur = 0;
  for (const y of yaws) {
    let d = y - runStart;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > Math.PI / 6) { runs++; maxRun = Math.max(maxRun, cur); cur = 0; runStart = y; }
    else cur++;
  }
  maxRun = Math.max(maxRun, cur);
  assert.ok(runs >= 3, `open-field: keeps turning (runs=${runs})`);
  assert.ok(maxRun * 10 < 900 + 300, `open-field: no endless straight (max run ${(maxRun * 10) / 60}s)`);
  assert.ok(pathLen > 40, `open-field: keeps covering ground (${pathLen.toFixed(1)}m)`);
  const offCard = (y) => {
    const k = Math.round(y / (Math.PI / 2));
    return Math.abs(y - k * Math.PI / 2);
  };
  const oblique = yaws.filter((y) => offCard(y) > Math.PI / 12);
  assert.ok(oblique.length / yaws.length > 0.25,
    `open-field: walks oblique lines (${(100 * oblique.length / yaws.length).toFixed(0)}%)`);
  assertClean(trace, "open-field");
}
console.log("PASS open-field-turns");

console.log("mob-paths.test.mjs: ALL PASS");
