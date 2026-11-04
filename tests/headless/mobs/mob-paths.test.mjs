// Kinematic 1-wide path tests: the REAL mover (mover.js) on REAL voxels
// (store.js), headless (mob.root is null, cosmetics self-skip).
// Paired rigs — waist-high physical murets vs 1-deep ground trenches — must
// behave identically: air walls and solid walls share the unified predicate.
import assert from "node:assert/strict";
import { AIR, STONE, LOG, WATER } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid, segmentWalkable } from "../../../src/mobs/mover.js";
import { strideTarget } from "../../../src/mobs/step.js";
import { entryTick, pickEntryTarget, clearEntryClaims } from "../../../src/mobs/entry.js";
import { exitPassage } from "../../../src/mobs/roam.js";
import { ENTRY_SCAN_T, ENTRY_COOL_T } from "../../../src/mobs/corridor.js";
import { NO_EXPIRY } from "../../../src/mobs/step.js";
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
  doorway: [[2, 0], [2, 1], [2, 2]],
  mouth: [[0, 0], [0, 1], [0, 2], [0, 3]],
  entry1: [[0, 4], [0, 5], [0, 6]],
  room: [[0, 0], [0, 1], [0, 2], [0, 3], [-1, 3], [1, 3], [-1, 4], [0, 4], [1, 4]],
};

// Explicit walls (doorway rig): [x, z] cells raised y=1..2.
const DOOR_WALLS = [
  [-1, 3], [2, 3], [3, 3],
  [-1, 6], [0, 6], [1, 6], [2, 6], [3, 6],
  [-1, 4], [-1, 5], [3, 4], [3, 5],
];

const START = {
  straight: [0, 0], straightE: [0, 0], l: [0, 0], t: [1, 0], cross: [1, -1],
  zigzag: [0, 0], deadend: [0, 0], lstub: [0, 0], lstubret: [1, 2], door2: [0, 0], door2ret: [1, 2],
  doorway: [2, 0], mouth: [0, 0],
  entry1: [0, 1],
  room: [0, 0],
};
const START_YAW = {
  straight: 0, straightE: Math.PI / 2, l: 0, t: 0, cross: 0,   zigzag: 0, deadend: 0, lstub: 0, lstubret: -Math.PI / 2, door2: 0, door2ret: -Math.PI / 2,
  doorway: 0, mouth: 0, room: 0,
  entry1: 0,
};

function buildRig(kind, layout, { auto = true, skip = [], extra = [] } = {}) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  const ps = new Set(layout.map(([x, z]) => `${x},${z}`));
  const skipSet = new Set(skip.map(([x, z]) => `${x},${z}`));
  const all = [...layout, ...extra, ...skip];
  const xs = all.map((c) => c[0]), zs = all.map((c) => c[1]);
  // Wide apron: the floor edge reads as a drop wall, so a narrow apron
  // plus a room wall forms a phantom 2-wide mouth (wall + void edge).
  // Real fields are vast; keep the edge out of entry range.
  const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6;
  const z0 = Math.min(...zs) - 6, z1 = Math.max(...zs) + 6;
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
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    entryScanT: 0, jrng: null, wallFollow: false, oneWide: false, tunnelPass: false,
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
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane != null, fl: mob.followLine ? mob.followLine.line : null, wf: mob.wallFollow === true, ow: mob.oneWide === true, en: mob.roam?.entry === true, tp: mob.tunnelPass === true });
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

// --- doorway: the wall gap is a 2-wide passage — proximity
// attraction steers through it (50/50 per visit), every seed crosses ---
{
  let crossed = 0;
  for (let s = 1; s <= 8; s++) {
    const trace = runTrial("muret", "doorway", {
      seed: s,
      walls: { auto: false, extra: DOOR_WALLS },
      goal: (m) => m.pos.z >= 4.5, maxTicks: 1500,
    });
    assertClean(trace, `doorway seed${s}`);
    if (trace.length < 1500) {
      crossed++;
      const cross = trace.filter((p) => p.z >= 2.8 && p.z <= 3.2);
      assert.ok(cross.length > 0, `doorway seed${s}: crossed the wall plane`);
    }
  }
  assert.ok(crossed >= 6, `doorway: crossed on ${crossed}/8 seeds`);
}
console.log("PASS doorway (muret)");

// --- entry1: 1-wide mouth attraction from the open. The mob starts 3
// blocks out facing the mouth: some seeds draw accept at once (entry
// commit observed), refusals cool down and walk on, but every seed ends
// inside — attraction plus cruise both lead in, wall-clean throughout. ---
{
  let sawEntry = 0;
  for (let s = 1; s <= 12; s++) {
    const trace = runTrial("muret", "entry1", {
      seed: s, walls: { skip: [[0, 3]] },
      goal: (m) => Math.floor(m.pos.z) >= 6, maxTicks: 1500,
    });
    assert.ok(trace.length < 1500, `entry1 seed${s}: walked into the corridor`);
    assertClean(trace, `entry1 seed${s}`);
    if (trace.some((p) => p.en)) sawEntry++;
    // No false negatives: an entry commit always reads violet (the tint
    // may outlive the commit through the post-arrival hold, never the
    // reverse).
    assert.ok(trace.every((p) => !p.en || p.tp), `entry1 seed${s}: commit implies violet`);
  }
  assert.ok(sawEntry >= 1, `entry1: attraction fired on ${sawEntry}/12 seeds`);
}
console.log("PASS entry1 (muret)");

// --- entryTick units: one 50/50 draw per visit, cooldown, in-flight hold ---
function scriptRand(values) {
  let i = 0;
  const f = () => { f.calls++; return values[i++ % values.length]; };
  f.calls = 0;
  return f;
}
function buildMouthRig() {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let x = -6; x <= 6; x++) for (let z = -2; z <= 10; z++) setBlock(x, 0, z, STONE);
  for (const z of [4, 5, 6]) for (const x of [-1, 1]) {
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}
{
  // Refusal: one draw, no cooldown — the next scan draws again until accept.
  buildMouthRig();
  const mob = makeTestMob("pig", 0.5, FEET, 1.5, 0);
  mob.target = { x: 9, z: 9 };
  const r = scriptRand([0.99, 0.0, 0.99]);
  assert.equal(entryTick(mob, DT, r), false);
  assert.deepEqual(mob.target, { x: 9, z: 9 });
  assert.equal(mob.roam, null);
  assert.equal(r.calls, 1);
  mob.entryScanT = 0;
  assert.equal(entryTick(mob, DT, r), true, "retry: next scan draws again");
  assert.ok(mob.roam?.entry === true);
  assert.equal(r.calls, 3, "retry accept + span draws");
  console.log("PASS entry-refuse-retries");
}
{
  // Accept: entry commit on the mouth centre, lane/line dropped, hold.
  // Single thin hole held both sides (2-long banks): arrival can always
  // walk through.
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = -5; x <= 12; x++) for (let z = -5; z <= 5; z++) setBlock(x, 0, z, STONE);
  for (const z of [-1, 1]) for (const x of [2, 3]) { setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE); }
  const mob = makeTestMob("pig", 0.5, FEET, 0.5, Math.PI / 2);
  mob.target = { x: 9, z: 9 };
  const r = scriptRand([0.0, 0.99]);
  assert.equal(entryTick(mob, DT, r), true);
  assert.ok(mob.roam?.entry === true);
  assert.deepEqual(mob.target, { x: 2.5, z: 0.5 });
  assert.equal(mob.lane, null);
  assert.equal(mob.followLine, null);
  assert.equal(r.calls, 2, "accept + span draws only");
  assert.equal(entryTick(mob, DT, r), true, "in-flight hold");
  assert.equal(r.calls, 2, "in-flight: no new draw");
  // Arrival hands a plain through-commit past the mouth (plus a violet
  // hold on the aimed slot): the mob walks out instead of turning back in.
  mob.pos.x = 2.5; mob.pos.z = 0.5;
  const before = r.calls;
  assert.equal(entryTick(mob, DT, r), false);
  assert.ok(mob.roam && mob.roam?.entry !== true, "arrival hands a through-commit");
  assert.ok(mob.target.x > 2.5, "through: past the mouth");
  assert.ok(r.calls > before, "through commit draws its span");
  mob.entryScanT = 0;
  // Face back west: the stacked neighbour mouth (3,0) reads behind, so
  // the only in-range mouth is the underfoot one — which never re-triggers.
  mob.yaw = -Math.PI / 2; mob.yawTarget = -Math.PI / 2;
  const atScan = r.calls;
  assert.equal(entryTick(mob, DT, r), false, "own cell: no re-trigger");
  assert.equal(r.calls, atScan, "own cell: no new draw");
  console.log("PASS entry-accept-hold-close");
}
{
  // Violet hold: arrival closes the commit, but the tint persists until
  // the mob walks VIOLET_HOLD_D past the aimed slot; leaving arms a
  // 5 s cooldown that blocks re-draws until it expires.
  buildMouthRig();
  const mob = makeTestMob("pig", 0.5, FEET, 1.5, 0);
  mob.target = { x: 9, z: 9 };
  assert.equal(entryTick(mob, DT, scriptRand([0.0, 0.99])), true);
  assert.ok(mob.roam?.entry === true);
  const realRandom = Math.random;
  Math.random = mulberry32(3);
  try {
    let t = 0;
    for (; t < 1500 && mob.roam?.entry === true; t++) {
      tickFarmMob(mob, DT, () => mob.target);
    }
    assert.ok(mob.roam?.entry !== true, "violet-hold: commit closed on arrival");
    assert.deepEqual([mob.tunnelHoldX, mob.tunnelHoldZ], [0.5, 4.5], "violet-hold: hold armed on the slot");
    assert.ok(mob.tunnelPass === true, "violet-hold: tint survives the commit");
    // Walk clear of the slot through the real mover: every inside tick
    // stays violet with no commit running.
    let cleared = false;
    for (let k = 0; k < 600 && !cleared; k++) {
      assert.ok(mob.tunnelPass === true, `violet-hold: violet inside the hold @tick${k}`);
      assert.ok(mob.roam?.entry !== true, `violet-hold: no commit inside the hold @tick${k}`);
      tickFarmMob(mob, DT, () => mob.target);
      cleared = mob.tunnelHoldX == null;
    }
    assert.ok(cleared, "violet-hold: hold clears past the slot");
    assert.ok(mob.entryCoolT > 0 && mob.entryCoolT <= ENTRY_COOL_T,
      `violet-hold: cooldown armed (${mob.entryCoolT})`);
    assert.ok(mob.tunnelPass === false, "violet-hold: tint ends with the hold");
  } finally {
    Math.random = realRandom;
  }
  // Cooldown gate (unit-level): a listed, facing, free mouth draws nothing
  // while the cooldown runs, and draws again once it expires.
  buildMouthRig();
  clearEntryClaims();
  const mob2 = makeTestMob("pig", 0.5, FEET, 1.5, 0);
  mob2.target = { x: 9, z: 9 };
  mob2.entryScanT = 0;
  mob2.entryCoolT = ENTRY_COOL_T;
  const r2 = scriptRand([0.0, 0.99]);
  assert.equal(entryTick(mob2, DT, r2), false, "cooldown: no draw");
  assert.equal(r2.calls, 0, "cooldown: rand untouched");
  mob2.entryCoolT = 0;
  assert.equal(entryTick(mob2, DT, r2), true, "expired: draws again");
  assert.ok(mob2.roam?.entry === true, "expired: commit latched");
  console.log("PASS violet-hold");
}
{
  // A cruising true lane never re-draws (its own mouth stays in range).
  buildMouthRig();
  const mob = makeTestMob("pig", 0.5, FEET, 4.5, 0);
  mob.lane = { axis: 0, entry: Math.PI, lockX: -1, lockZ: -1 };
  mob.followLine = null;
  const r = scriptRand([0.0]);
  assert.equal(entryTick(mob, DT, r), false);
  assert.equal(r.calls, 0, "lane cruise: no draw at all");
  console.log("PASS entry-lane-skip");
}
{
  // 2-wide slots: nearest of left cell, right cell, middle wins (ties
  // fall to the middle); the pick consumes no draw at all.
  const e = { kind: "two", ax: 0.5, az: 0.5, bx2: 1.5, bz2: 0.5, x: 1.0, z: 0.5 };
  assert.deepEqual(pickEntryTarget(e, 0.4, 0.5), { x: 0.5, z: 0.5 }, "nearest left");
  assert.deepEqual(pickEntryTarget(e, 1.6, 0.5), { x: 1.5, z: 0.5 }, "nearest right");
  assert.deepEqual(pickEntryTarget(e, 1.0, 2.0), { x: 1.0, z: 0.5 }, "nearest middle");
  assert.deepEqual(pickEntryTarget(e, 0.75, 0.5), { x: 1.0, z: 0.5 }, "tie: middle");
  const one = { kind: "one", x: 0.5, z: 4.5 };
  const r = scriptRand([0.0]);
  assert.deepEqual(pickEntryTarget(one, 9, 9), { x: 0.5, z: 4.5 });
  assert.equal(r.calls, 0, "slot pick: no draw at all");
  console.log("PASS entry-slots");
}
{
  // Throttle: while entryScanT runs, no rescan and no draw at all.
  buildMouthRig();
  const mob = makeTestMob("pig", 0.5, FEET, 1.5, 0);
  mob.target = { x: 9, z: 9 };
  mob.entryScanT = 10;
  const r = scriptRand([0.0]);
  assert.equal(entryTick(mob, DT, r), false);
  assert.equal(r.calls, 0, "throttled: no draw at all");
  assert.equal(mob.entryScanT, 10, "throttled: timer untouched by entryTick");
  mob.entryScanT = 0;
  assert.equal(entryTick(mob, DT, r), true, "expired: scans and accepts again");
  assert.equal(mob.entryScanT, ENTRY_SCAN_T, "scan reloads the throttle");
  console.log("PASS entry-throttle");
}
{
  // Directed latch: a stalled entry touches the blocking wall hole-ward
  // with the existing ride machinery — one budget draw, no entry draw.
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) setBlock(x, 0, z, STONE);
  for (let z = -4; z <= 4; z++) { setBlock(0, 1, z, STONE); setBlock(0, 2, z, STONE); }
  const mob = makeTestMob("pig", 1.5, FEET, 0.5, -Math.PI / 2);
  mob.target = { x: -1.5, z: 2.5 };
  mob.jrng = () => 0.5; // pre-seeded junction stream: only the test's draws count
  mob.roam = {
    mode: "commit", heading: -Math.PI / 2, target: mob.target, tgt: mob.target,
    axis: 0, stallT: 0, passageKey: "over|9:9,9",
    t: 0, span: 99, runT: 0, entry: true,
  };
  const r = scriptRand([0.0]);
  let latched = false;
  for (let t = 0; t < 60 && !latched; t++) {
    tickFarmMob(mob, DT, () => mob.target, r);
    if (mob.lane != null) latched = true;
  }
  assert.ok(latched, "stall latches the blocking wall");
  assert.equal(mob.lane.axis, 0, "lane runs hole-ward (north)");
  assert.equal(mob.followLine?.touch, true, "touch ride latched");
  assert.ok(mob.wallFollow === true, "blue while riding to the hole");
  assert.equal(r.calls, 1, "ride budget only, no entry draw");
  console.log("PASS entry-directed-latch");
}

// --- preemption: attraction primes over a wall ride; refusal keeps it ---
function buildRideMouthRig() {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let x = -8; x <= 8; x++) for (let z = -6; z <= 6; z++) setBlock(x, 0, z, STONE);
  for (let x = -8; x <= 8; x++) {
    if (x === 3) continue; // the hole the corridor continues through
    setBlock(x, 1, 2, STONE); setBlock(x, 2, 2, STONE);
  }
  for (const z of [3, 4, 5]) for (const x of [2, 4]) {
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}
function rideMob(x, z, yaw) {
  const mob = makeTestMob("pig", x, FEET, z, yaw);
  mob.pinWallRide = true;
  mob.target = { x: 0.5, z: 30 };
  return mob;
}
function rideLatchTick(seed, maxTicks) {
  buildRideMouthRig();
  const mob = rideMob(1.5, 1.4, 0);
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMob(mob, DT, () => mob.target);
      if (mob.roam?.entry) return t;
    }
    return -1;
  } finally {
    Math.random = realRandom;
  }
}
{
  // Calibrated by running: first scan accepts (latch on tick 0) or refuses
  // then accepts on a later scan (latch inside 300 ticks).
  let acceptSeed = 0, refuseSeed = 0;
  for (let s = 1; s <= 50 && (!acceptSeed || !refuseSeed); s++) {
    const t = rideLatchTick(s, 300);
    if (t === 0 && !acceptSeed) acceptSeed = s;
    else if (t >= 15 && !refuseSeed) refuseSeed = s;
  }
  assert.ok(acceptSeed > 0 && refuseSeed > 0, "ride seed pair found");
  // Accept: the ride never latches — entry commit owns the tick.
  {
    buildRideMouthRig();
    const mob = rideMob(1.5, 1.4, 0);
    const realRandom = Math.random;
    Math.random = mulberry32(acceptSeed);
    try {
      tickFarmMob(mob, DT, () => mob.target);
    } finally {
      Math.random = realRandom;
    }
    assert.ok(mob.roam?.entry === true, "accept: entry commit latched");
    assert.deepEqual(mob.target, { x: 3.5, z: 2.5 }, "accept: the hole ahead");
    assert.equal(mob.lane, null, "accept: no lane");
    assert.equal(mob.wallFollow, false, "accept: ride quit");
    assert.equal(mob.tunnelPass, true, "accept: violet while passing");
  }
  // Refuse: the ride latches first, but scans keep drawing until one
  // accepts — a mob that targets the hole always gets through eventually.
  {
    buildRideMouthRig();
    const mob = rideMob(1.5, 1.4, 0);
    const realRandom = Math.random;
    Math.random = mulberry32(refuseSeed);
    const trace = [];
    try {
      for (let t = 0; t < 300 && !mob.roam?.entry; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ lane: mob.lane != null, blue: mob.wallFollow === true });
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(mob.roam?.entry === true, "retry: a later scan accepts");
    assert.ok(trace[0].lane, "retry: touch ride latched first");
    assert.ok(trace.some((p) => p.blue), "retry: ride kept the wall first");
  }
  console.log("PASS entry-preempts-ride");
}

// --- one deciding mob per passage: a latched claim blocks rivals, the
// release hands over ---
{
  buildMouthRig();
  const a = makeTestMob("pig", 0.5, FEET, 1.5, 0);
  const b = makeTestMob("pig", 0.5, FEET, 2.5, 0);
  a.target = { x: 9, z: 9 };
  b.target = { x: -9, z: 9 };
  // A draws accept first: commits, claims the mouth.
  assert.equal(entryTick(a, DT, scriptRand([0.0, 0.99])), true);
  assert.ok(a.roam?.entry === true);
  assert.deepEqual(a.target, { x: 0.5, z: 4.5 });
  // B scans the same mouth: taken — no draw at all, no cooldown.
  const rb = scriptRand([0.0]);
  assert.equal(entryTick(b, DT, rb), false);
  assert.equal(rb.calls, 0, "taken passage: no draw consumed");
  assert.equal(b.roam, null);
  assert.ok(b.entryScanT > 0, "taken passage: waits for the next scan");
  // A arrives: close releases the passage (handing a through-commit past
  // the mouth); B takes it next scan.
  a.pos.x = 0.5; a.pos.z = 4.5;
  assert.equal(entryTick(a, DT, scriptRand([0.0])), false);
  assert.ok(!a.roam?.entry, "arrival closes the entry");
  b.entryScanT = 0;
  assert.equal(entryTick(b, DT, scriptRand([0.0, 0.99])), true);
  assert.ok(b.roam?.entry === true, "released passage: rival commits");
  assert.deepEqual(b.target, { x: 0.5, z: 4.5 });
  console.log("PASS entry-claim");
}

// --- fallback: with two holes, a rival takes the nearest free one ---
{
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = -5; x <= 7; x++) for (let z = -5; z <= 7; z++) setBlock(x, 0, z, STONE);
  for (let z = -3; z <= 6; z++) {
    if (z === 0 || z === 3) continue; // the two holes, 3 apart
    setBlock(2, 1, z, STONE); setBlock(2, 2, z, STONE);
  }
  const a = makeTestMob("pig", 0.5, FEET, 0.5, Math.PI / 2);
  const b = makeTestMob("pig", 0.5, FEET, 2.0, 0);
  a.target = { x: 9, z: 9 };
  b.target = { x: -9, z: 9 };
  // A claims the near hole; B falls back to the far one, same tick.
  assert.equal(entryTick(a, DT, scriptRand([0.0, 0.99])), true);
  assert.deepEqual(a.target, { x: 2.5, z: 0.5 });
  const rb = scriptRand([0.0, 0.99]);
  assert.equal(entryTick(b, DT, rb), true, "rival falls back to the free hole");
  assert.deepEqual(b.target, { x: 2.5, z: 3.5 });
  assert.equal(rb.calls, 2, "fallback: accept + span draws only");
  console.log("PASS entry-fallback");
}

// --- perpendicular: a hole straight ahead of a touch ride preempts it
// (parallel lines), then the walk turns onto the hole line and crosses
// centred instead of grinding the wall beside the hole ---
function buildPerpBreachRig() {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let x = -8; x <= 8; x++) for (let z = -6; z <= 8; z++) setBlock(x, 0, z, STONE);
  // Wall A runs to z=3 so its end never reads as a second mouth.
  for (let z = -2; z <= 3; z++) { setBlock(0, 1, z, STONE); setBlock(0, 2, z, STONE); }
  // Hole one block off the ride line: the servo cannot walk it straight,
  // the entry must leave the wall and centre onto the hole. The row runs
  // past the hole so both its flanks read walled.
  for (let x = -2; x <= 4; x++) {
    if (x === 2) continue; // the hole, head-on but off the ride line
    setBlock(x, 1, 4, STONE); setBlock(x, 2, 4, STONE);
  }
}
function perpLatchTick(seed, maxTicks) {
  buildPerpBreachRig();
  const mob = makeTestMob("pig", 1.5, FEET, 0.5, 0);
  mob.pinWallRide = true;
  mob.target = { x: 1.5, z: 30 };
  mob.entryScanT = 0.3;
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMob(mob, DT, () => mob.target);
      if (mob.roam?.entry) return t;
    }
    return -1;
  } finally {
    Math.random = realRandom;
  }
}
{
  // Calibrated by running: early scans accept (acceptSeed, latch inside
  // 60 ticks) or refuse then accept on a later scan (refuseSeed, latch
  // inside 300 ticks) — the retry proving mobs always get through.
  let acceptSeed = 0, refuseSeed = 0;
  for (let s = 1; s <= 50 && (!acceptSeed || !refuseSeed); s++) {
    const t = perpLatchTick(s, 300);
    if (t >= 0 && t <= 60 && !acceptSeed) acceptSeed = s;
    else if (t > 60 && !refuseSeed) refuseSeed = s;
  }
  assert.ok(acceptSeed > 0 && refuseSeed > 0, "perp seed pair found");
  // Accept: the northbound ride quits for the hole, centres, crosses.
  {
    buildPerpBreachRig();
    const mob = makeTestMob("pig", 1.5, FEET, 0.5, 0);
    mob.pinWallRide = true;
    mob.target = { x: 1.5, z: 30 };
    mob.entryScanT = 0.3;
    const realRandom = Math.random;
    Math.random = mulberry32(acceptSeed);
    const trace = [];
    let crossed = false, tp = false;
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z });
        if (mob.tunnelPass) tp = true;
        if (mob.pos.z > 4.5) { crossed = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(crossed, "perp: crossed through the hole");
    assert.ok(tp, "perp: violet while passing");
    assertClean(trace, "perp");
  }
  // Refuse: the ride latches first, but scans keep drawing until one
  // accepts — the mob always gets through eventually.
  {
    buildPerpBreachRig();
    const mob = makeTestMob("pig", 1.5, FEET, 0.5, 0);
    mob.pinWallRide = true;
    mob.target = { x: 1.5, z: 30 };
    mob.entryScanT = 0.3;
    const realRandom = Math.random;
    Math.random = mulberry32(refuseSeed);
    const trace = [];
    try {
      for (let t = 0; t < 300 && !mob.roam?.entry; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ lane: mob.lane != null, blue: mob.wallFollow === true });
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(mob.roam?.entry === true, "perp retry: a later scan accepts");
    assert.ok(trace[0].lane, "perp retry: touch ride latched first");
    assert.ok(trace.some((p) => p.blue), "perp retry: ride kept the wall first");
  }
  console.log("PASS perp-hole");
}

// --- mouth: 1-wide path opening onto a field commits out; a pinballing
// mob would never get deep into the field, so reaching z>=6 proves a
// clean exit (later returns over the mouth are legitimate roaming) ---
{
  const trace = runTrial("muret", "mouth", { walls: { skip: [[0, 4]] }, goal: (m) => m.pos.z >= 6, maxTicks: 1200 });
  assert.ok(trace.length < 1200, "mouth: walked out into the field");
  assertClean(trace, "mouth");
}
console.log("PASS mouth (muret)");

// --- room: tunnel opening onto a 3-wide room; the rail releases at the
// mouth with the 50/50 exit (wall-follow hugs a mouth flank, free roam
// walks out) instead of locking a red lane wandering the room — red may
// only ever read on the axis or in the mouth band (body-wedged mouth
// cells legitimately rail for a few ticks); the room interior (z>=4)
// never runs red off-axis. The mob walks the tunnel axis to the back wall. ---
for (const kind of ["muret", "trench"]) {
  const trace = runTrial(kind, "room", { goal: (m) => m.pos.z >= 4.4, maxTicks: 1500 });
  assert.ok(trace.length < 1500, `${kind}/room: reached the back wall`);
  assertClean(trace, `${kind}/room`);
  const offAxis = trace.filter((p) => p.ow && Math.floor(p.x) !== 0);
  const interior = offAxis.filter((p) => p.z >= 4);
  assert.equal(interior.length, 0, `${kind}/room: no 1-wide in the room interior (${interior.length} ticks)`);
  assert.ok(offAxis.length <= 60, `${kind}/room: mouth-band red stays brief (${offAxis.length} ticks)`);
}
console.log("PASS room (muret + trench)");

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
// lip, never descend, and walk back out. Elevated rigs (feet
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
  clearEntryClaims();
  setDimension("over");
  const ps = new Set(cells.map(([x, z]) => `${x},${z}`));
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  // Wide apron: the plateau edge reads as a drop wall, so a narrow apron
  // plus a corridor wall forms phantom 2-wide mouths in entry range.
  const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6;
  const z0 = Math.min(...zs) - 6, z1 = Math.max(...zs) + 6;
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
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    entryScanT: 0, jrng: null, wallFollow: false, oneWide: false, tunnelPass: false,
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
  let minY = Infinity, maxX = -Infinity, saw = visit == null;
  try {
    for (let t = 0; t < maxTicks; t++) {
      tickFarmMob(mob, DT, () => fixed);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
      if (mob.pos.y < minY) minY = mob.pos.y;
      if (mob.pos.x > maxX) maxX = mob.pos.x;
      if (!saw && visit && visit(mob)) saw = true;
      if (saw && goal(mob)) break;
    }
  } finally {
    Math.random = realRandom;
  }
  return { trace, minY, maxX, saw };
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
    // descend, walk back out.
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
for (const name of ["straight", "l", "zigzag", "deadend", "lstub", "lstubret", "door2", "door2ret"]) {
  const goals = {
    straight: (m) => Math.floor(m.pos.z) >= 6,
    l: (m) => Math.floor(m.pos.x) >= 3 && Math.floor(m.pos.z) >= 2,
    zigzag: (m) => Math.floor(m.pos.x) >= 2 && Math.floor(m.pos.z) >= 4,
    deadend: null,
    lstub: (m) => m.pos.x >= 1.5,
    lstubret: (m) => Math.floor(m.pos.z) <= 0 && Math.floor(m.pos.x) === 0,
    door2: (m) => Math.floor(m.pos.x) === 1 && Math.floor(m.pos.z) === 2,
    door2ret: (m) => Math.floor(m.pos.x) === 0 && Math.floor(m.pos.z) === 0,
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

// --- segmentWalkable: whole-stride validation behind unified picks ---
{
  const pig = makeTestMob("pig", 0.5, 1, 0.5, 0);
  const flat = () => {
    resetWorld("over");
    clearEntryClaims();
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
  clearEntryClaims();
  setDimension("over");
  // Wide floor: the edge reads as a drop wall, which plus the ring wall
  // would form a phantom 2-wide mouth in entry range.
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) setBlock(x, 0, z, STONE);
  for (let x = -2; x <= 2; x++) for (const z of [-2, 2]) {
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
  for (let z = -1; z <= 1; z++) for (const x of [-2, 2]) {
    if (x === 2 && z === 0) continue; // the 1-wide hole
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}
for (const [sx, tx, label] of [[4.5, 0.5, "out-in"], [0.5, 4.5, "in-out"]]) {
  // Same ≥6/8 bar as the other crossing rigs; fluidity as a distribution
  // (median clean, worst bounded — one U-turn reads slow, the line still
  // gets through) like zigzag.
  let crossed = 0;
  const slows = [];
  for (let s = 1; s <= 8; s++) {
    buildPenRing();
    const mob = makeTestMob("pig", sx, FEET, 0.5, sx > 2 ? -Math.PI / 2 : Math.PI / 2);
    mob.target = { x: tx, z: 0.5 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
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
    const done = (sx > 2 && mob.pos.x < 1.5) || (sx < 2 && mob.pos.x > 2.5);
    if (done) {
      crossed++;
      slows.push(speeds(trace).slice(10).filter((v) => v < 0.8).length);
      assertClean(trace, `fence-hole ${label} seed${s}`);
    }
  }
  assert.ok(crossed >= 6, `fence-hole ${label}: crossed on ${crossed}/8 seeds`);
  slows.sort((a, b) => a - b);
  const median = slows[Math.floor(slows.length / 2)];
  assert.ok(median <= 12, `fence-hole ${label}: median slow ticks ${median}`);
  assert.ok(slows[slows.length - 1] <= 150, `fence-hole ${label}: worst slow ticks ${slows[slows.length - 1]}`);
}
console.log("PASS fence-hole");

// --- hole-pen: closed ring holds, knocked-out hole gets used ---
// Realistic wander (strideTarget, never a forced through-wall target): the
// closed ring holds for 400 ticks; once the hole opens, mouth attraction
// draws the mob out. Proves a player-made hole gets used, not just crossed
// when aimed at.
{
  let crossed = 0, sawEntry = 0, sawViolet = 0;
  for (let s = 1; s <= 8; s++) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) setBlock(x, 0, z, STONE);
    for (let x = -2; x <= 2; x++) for (const z of [-2, 2]) {
      setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
    }
    for (let z = -2; z <= 2; z++) for (const x of [-2, 2]) {
      setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
    }
    const mob = makeTestMob("pig", 0.5, FEET, 0.5, 0);
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let out = false, en = false, tp = false;
    try {
      const pick = (m, r) => strideTarget(m, null, r) ?? { x: m.pos.x, z: m.pos.z };
      mob.target = pick(mob, Math.random);
      for (let t = 0; t < 400; t++) {
        tickFarmMob(mob, DT, pick);
        if (mob.pos.x > 2.5) break;
      }
      assert.ok(!(mob.pos.x > 2.5), `hole-pen seed${s}: closed ring holds`);
      setBlock(2, 1, 0, AIR); setBlock(2, 2, 0, AIR);
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, pick);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.roam?.entry) en = true;
        if (mob.tunnelPass) tp = true;
        if (mob.pos.x > 2.5) { out = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    if (out) crossed++;
    if (en) sawEntry++;
    if (tp) sawViolet++;
    if (out) assertClean(trace, `hole-pen seed${s}`);
  }
  assert.ok(crossed >= 6, `hole-pen: exited on ${crossed}/8 seeds`);
  assert.ok(sawEntry >= 1, `hole-pen: attraction fired on ${sawEntry}/8 seeds`);
  assert.ok(sawViolet >= 1, `hole-pen: violet while passing on ${sawViolet}/8 seeds`);
}
console.log("PASS hole-pen");

// --- entry-oblique-hold: an entry commit walking oblique to the fence
// never converts to a plain wall ride — the stall slide stays guided
// (guideKey) until arrival/timeout, and the mob passes through the hole ---
{
  let crossed = 0, guided = 0;
  for (let s = 1; s <= 8; s++) {
    buildPenRing();
    const mob = makeTestMob("pig", 4.5, FEET, 1.8, -Math.PI / 2);
    mob.target = { x: 0.5, z: 0.5 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let plain = false, gd = false, done = false;
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.followLine?.touch) {
          if (mob.followLine.guideKey != null) gd = true;
          else if (mob.roam?.entry) plain = true;
        }
        if (mob.pos.x < 1.5) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(!plain, `entry-oblique-hold seed${s}: never a plain ride mid-commit`);
    if (gd) guided++;
    if (done) { crossed++; assertClean(trace, `entry-oblique-hold seed${s}`); }
  }
  assert.ok(crossed >= 6, `entry-oblique-hold: through on ${crossed}/8 seeds`);
  assert.ok(guided >= 4, `entry-oblique-hold: guided slide on ${guided}/8 seeds`);
}
console.log("PASS entry-oblique-hold");

// --- ride-turns-to-hole: a touch ride along a wall diverts into a hole
// knocked head-on in the ridden wall (travel line across the ride) and
// passes through instead of sliding past ---
{
  let diverted = 0, inside = 0;
  for (let s = 1; s <= 8; s++) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) setBlock(x, 0, z, STONE);
    for (let x = -2; x <= 2; x++) for (const z of [-2, 2]) {
      setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
    }
    for (let z = -2; z <= 2; z++) for (const x of [-2, 2]) {
      setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
    }
    const mob = makeTestMob("pig", -3.0, FEET, -2.55, Math.PI / 2);
    mob.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: -3, lockZ: -3 };
    mob.followLine = {
      axis: Math.PI / 2, line: -2.5, side: -1, rel: 1,
      virtual: true, touch: true, fresh: 0, face: -2, t: 0, wallSpan: 99,
    };
    mob.yawTarget = Math.PI / 2;
    mob.target = { x: 6, z: -2.55 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let en = false, inn = false;
    try {
      for (let t = 0; t < 1500; t++) {
        if (t === 30) { setBlock(0, 1, -2, AIR); setBlock(0, 2, -2, AIR); }
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.roam?.entry) en = true;
        if (mob.pos.z > -1.5 && mob.pos.x > -2 && mob.pos.x < 2) inn = true;
        if (inn && mob.pos.z > 0.5) break;
      }
    } finally {
      Math.random = realRandom;
    }
    if (en) diverted++;
    if (inn) { inside++; assertClean(trace, `ride-turns-to-hole seed${s}`); }
  }
  assert.ok(diverted >= 6, `ride-turns-to-hole: diverted on ${diverted}/8 seeds`);
  assert.ok(inside >= 6, `ride-turns-to-hole: inside on ${inside}/8 seeds`);
}
// --- tunnel-exit-choice: a rail released at a tunnel mouth exits 50/50
// wall-follow vs free roam — never back inside. A lock-turn on the mouth
// cell pins a deterministic east exit; the mouth flanks behind are the
// exit walls. A continuing wall rides straight out along it; a lone mouth
// flank turns 90° onto the exterior face when it continues (pen ring) and
// roams otherwise; open ground roams straight or ±45° with room, a blocked
// straight forces the diagonal ---
{
  const setupExit = (walls) => {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -8; x <= 12; x++) for (let z = -8; z <= 8; z++) setBlock(x, 0, z, STONE);
    for (const [wx, wz] of walls) { setBlock(wx, 1, wz, STONE); setBlock(wx, 2, wz, STONE); }
  };
  const corridor = (n1, s1) => {
    const walls = [];
    for (let x = 0; x <= 4; x++) walls.push([x, 1], [x, -1]);
    for (let x = 5; x <= n1; x++) walls.push([x, 1]);
    for (let x = 5; x <= s1; x++) walls.push([x, -1]);
    return walls;
  };
  const blockedStraight = [];
  for (let z = -2; z <= 4; z++) blockedStraight.push([7, z]);
  const penRingHole = () => {
    const walls = [];
    for (let x = -2; x <= 2; x++) for (const z of [-2, 2]) walls.push([x, z]);
    for (let z = -2; z <= 2; z++) for (const x of [-2, 2]) {
      if (x === 2 && z === 0) continue;
      walls.push([x, z]);
    }
    return walls;
  };
  const runExit = (walls, sx, lockX, s, ticks = 120) => {
    setupExit(walls);
    const mob = makeTestMob("pig", sx, FEET, 0.5, Math.PI / 2);
    mob.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX, lockZ: 0 };
    mob.yawTarget = Math.PI / 2;
    mob.target = { x: 30, z: 0.5 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let rideRel = null, rideAxis = null, sawExitRide = false;
    let firstHead = null, sawEntry = false, minDx = Infinity, maxDx = -Infinity;
    try {
      for (let t = 0; t < ticks; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.followLine?.touch && rideRel === null) {
          rideRel = mob.followLine.rel;
          rideAxis = mob.lane ? mob.lane.axis : null;
        }
        if (mob.followLine?.exitRide != null) sawExitRide = true;
        if (mob.roam?.mode === "commit" && !mob.roam.entry && firstHead === null) {
          firstHead = mob.roam.heading;
        }
        if (mob.roam?.entry) sawEntry = true;
        if (t < 80) minDx = Math.min(minDx, mob.pos.x - sx);
        maxDx = Math.max(maxDx, mob.pos.x - sx);
      }
    } finally {
      Math.random = realRandom;
    }
    return { trace, rideRel, rideAxis, sawExitRide, firstHead, sawEntry, minDx, maxDx };
  };
  const headRel = (h) => (h - Math.PI / 2) * 180 / Math.PI;
  const relOk = (h, maxDeg) => h != null && Math.abs(headRel(h)) <= maxDeg + 1e-9;
  // Freestanding mouth (flanks end at the mouth): no wall continues, so no
  // ride can persist — always free roam, straight or ±45°, never back in.
  {
    for (let s = 1; s <= 8; s++) {
      const r = runExit(corridor(4, 4), 5.0, 5, s);
      assert.ok(!r.sawEntry, `tunnel-exit both seed${s}: no entry steal`);
      assert.ok(r.rideRel == null, `tunnel-exit both seed${s}: no persisting wall, no ride`);
      assert.ok(relOk(r.firstHead, 45), `tunnel-exit both seed${s}: roam straight or ±45° (rel=${r.firstHead == null ? "-" : headRel(r.firstHead).toFixed(0)})`);
      assert.ok(r.minDx >= -0.5, `tunnel-exit both seed${s}: never back in (minDx=${r.minDx.toFixed(2)})`);
      assertClean(r.trace, `tunnel-exit both seed${s}`);
    }
  }
  // North wall continues past the mouth: rides glue left (rel +1) and run
  // it, or roam straight/±45°; the 50/50 shows on both branches.
  {
    let rides = 0, roams = 0;
    for (let s = 1; s <= 8; s++) {
      const r = runExit(corridor(7, 4), 5.0, 5, s);
      assert.ok(!r.sawEntry, `tunnel-exit ncont seed${s}: no entry steal`);
      assert.ok(r.minDx >= -0.5, `tunnel-exit ncont seed${s}: never back in (minDx=${r.minDx.toFixed(2)})`);
      if (r.rideRel != null) {
        rides++;
        assert.ok(r.rideRel === 1, `tunnel-exit ncont seed${s}: rides the continuing north wall (rel=${r.rideRel})`);
        assert.ok(r.rideAxis != null && Math.abs(r.rideAxis - Math.PI / 2) < 1e-9 && r.sawExitRide,
          `tunnel-exit ncont seed${s}: outward exit ride`);
      } else {
        roams++;
        assert.ok(relOk(r.firstHead, 45), `tunnel-exit ncont seed${s}: roam straight or ±45° (rel=${r.firstHead == null ? "-" : headRel(r.firstHead).toFixed(0)})`);
      }
      assertClean(r.trace, `tunnel-exit ncont seed${s}`);
    }
    assert.ok(rides >= 1 && roams >= 1, `tunnel-exit ncont: rides ${rides}/8, roams ${roams}/8`);
  }
  // South wall continues: mirror (rel -1).
  {
    let rides = 0, roams = 0;
    for (let s = 1; s <= 8; s++) {
      const r = runExit(corridor(4, 7), 5.0, 5, s);
      assert.ok(!r.sawEntry, `tunnel-exit scont seed${s}: no entry steal`);
      assert.ok(r.minDx >= -0.5, `tunnel-exit scont seed${s}: never back in (minDx=${r.minDx.toFixed(2)})`);
      if (r.rideRel != null) {
        rides++;
        assert.ok(r.rideRel === -1, `tunnel-exit scont seed${s}: rides the continuing south wall (rel=${r.rideRel})`);
        assert.ok(r.rideAxis != null && Math.abs(r.rideAxis - Math.PI / 2) < 1e-9 && r.sawExitRide,
          `tunnel-exit scont seed${s}: outward exit ride`);
      } else {
        roams++;
        assert.ok(relOk(r.firstHead, 45), `tunnel-exit scont seed${s}: roam straight or ±45° (rel=${r.firstHead == null ? "-" : headRel(r.firstHead).toFixed(0)})`);
      }
      assertClean(r.trace, `tunnel-exit scont seed${s}`);
    }
    assert.ok(rides >= 1 && roams >= 1, `tunnel-exit scont: rides ${rides}/8, roams ${roams}/8`);
  }
  // Open ground: always free roam, straight or ±45° with room.
  {
    for (let s = 1; s <= 8; s++) {
      const r = runExit([], 1.0, 1, s);
      assert.ok(r.rideRel == null, `tunnel-exit open seed${s}: no walls, no ride`);
      assert.ok(relOk(r.firstHead, 45), `tunnel-exit open seed${s}: roam straight or ±45° (rel=${r.firstHead == null ? "-" : headRel(r.firstHead).toFixed(0)})`);
      assert.ok(r.minDx >= -0.5, `tunnel-exit open seed${s}: never back in (minDx=${r.minDx.toFixed(2)})`);
      assertClean(r.trace, `tunnel-exit open seed${s}`);
    }
  }
  // Straight blocked (wall 1.5 ahead, south-east covered): the diagonal.
  {
    for (let s = 1; s <= 8; s++) {
      const r = runExit(blockedStraight, 5.0, 5, s);
      assert.ok(r.rideRel == null, `tunnel-exit blocked seed${s}: no side walls, no ride`);
      assert.ok(r.firstHead != null && Math.abs(Math.abs(headRel(r.firstHead)) - 45) < 1e-9,
        `tunnel-exit blocked seed${s}: diagonal out (rel=${r.firstHead == null ? "-" : headRel(r.firstHead).toFixed(0)})`);
      assert.ok(r.minDx >= -0.5, `tunnel-exit blocked seed${s}: never back in (minDx=${r.minDx.toFixed(2)})`);
      assertClean(r.trace, `tunnel-exit blocked seed${s}`);
    }
  }
  // Pen fence hole, rail driven through: the wall branch turns 90° onto
  // the continuing exterior (north rel +1, south rel -1) instead of
  // releasing on the spot; roam walks out straight or ±45°.
  {
    let rides = 0, roams = 0, crossed = 0;
    for (let s = 1; s <= 8; s++) {
      const r = runExit(penRingHole(), 2.5, 2, s, 200);
      assert.ok(r.minDx >= -0.5, `tunnel-exit pen seed${s}: never back in (minDx=${r.minDx.toFixed(2)})`);
      if (r.maxDx > 1.0) crossed++;
      if (r.rideRel != null) {
        rides++;
        assert.ok(r.rideAxis != null, `tunnel-exit pen seed${s}: turned ride has an axis`);
        const ra = ((r.rideAxis - Math.PI / 2) * 180 / Math.PI + 360) % 360;
        assert.ok(Math.abs(ra - 270) < 1e-9 || Math.abs(ra - 90) < 1e-9,
          `tunnel-exit pen seed${s}: turned north or south (axis=${ra.toFixed(0)})`);
        if (Math.abs(ra - 270) < 1e-9) assert.ok(r.rideRel === 1, `tunnel-exit pen seed${s}: north is left (rel=${r.rideRel})`);
        else assert.ok(r.rideRel === -1, `tunnel-exit pen seed${s}: south is right (rel=${r.rideRel})`);
        assert.ok(r.sawExitRide, `tunnel-exit pen seed${s}: guided as an exit ride`);
      } else if (r.maxDx > 1.0) {
        roams++;
        assert.ok(relOk(r.firstHead, 45), `tunnel-exit pen seed${s}: roam straight or ±45° (rel=${r.firstHead == null ? "-" : headRel(r.firstHead).toFixed(0)})`);
      }
      assertClean(r.trace, `tunnel-exit pen seed${s}`);
    }
    assert.ok(crossed >= 6, `tunnel-exit pen: out on ${crossed}/8 seeds`);
    assert.ok(rides >= 1 && roams >= 1, `tunnel-exit pen: rides ${rides}/8, roams ${roams}/8`);
  }
}
console.log("PASS tunnel-exit-choice");

// --- hole-threads-red: core rule — a 1-wide tunneled cell belongs to the
// rail. Oblique approach to a pen hole: whenever the mob threads the hole
// (guided slide after an oblique stall, or clean entry walk), oneWide
// reads true in/near the hole — never blue through it ---
{
  let crossed = 0, guided = 0;
  for (let s = 1; s <= 8; s++) {
    buildPenRing();
    const mob = makeTestMob("pig", 4.5, FEET, 1.8, -Math.PI / 2);
    mob.target = { x: 0.5, z: 0.5 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let gd = false, red = false, en = false, done = false;
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.roam?.entry) en = true;
        if (mob.followLine?.touch && mob.followLine.guideKey != null) gd = true;
        const nearHole = Math.abs(mob.pos.x - 2.5) < 1.2 && Math.abs(mob.pos.z - 0.5) < 1.2;
        if (nearHole && mob.oneWide) red = true;
        if (mob.pos.x < 1.5) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    // Pre-draw approach blue is legitimate (50/50 per scan): only the
    // guided slide may enter the hole, and it must run red there.
    if (gd) { guided++; assert.ok(red, `hole-threads-red seed${s}: guided slide ran red`); }
    if (en && !gd) assert.ok(red, `hole-threads-red seed${s}: clean walk ran red`);
    if (done) { crossed++; assertClean(trace, `hole-threads-red seed${s}`); }
  }
  assert.ok(crossed >= 6, `hole-threads-red: through on ${crossed}/8 seeds`);
  assert.ok(guided >= 4, `hole-threads-red: guided slide on ${guided}/8 seeds`);
}
console.log("PASS hole-threads-red");

// --- entry-keeps-line: a touch ride that draws its hole never drops the
// line to pivot toward it — the commit stays pending under the ride (blue
// held, yaw locked) until the nose meets the wall, then the hole-ward
// guided touch erects directly. No lanelless pivot, no blue break. ---
{
  let crossed = 0, guided = 0;
  for (let s = 1; s <= 8; s++) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -10; x <= 10; x++) for (let z = -8; z <= 8; z++) setBlock(x, 0, z, STONE);
    for (let x = -6; x <= 6; x++) { if (x !== 0) { setBlock(x, 1, 2, STONE); setBlock(x, 2, 2, STONE); } }
    const mob = makeTestMob("pig", -5.5, FEET, 1.5, Math.PI / 2);
    mob.pinWallRide = true; // legacy ride: no lottery, no budget quit
    mob.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: -6, lockZ: 1 };
    mob.followLine = {
      axis: Math.PI / 2, line: 1.5, side: -1, rel: 1,
      virtual: true, touch: true, fresh: 0, face: 2, t: 0, wallSpan: 99,
    };
    mob.yawTarget = Math.PI / 2;
    mob.target = { x: 30, z: 1.5 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let sawEntry = false, sawGuided = false, done = false, windowOk = true;
    try {
      for (let t = 0; t < 1500 && mob.pos.z < 2.5; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.roam?.entry) {
          sawEntry = true;
          // The whole take runs laned and blue: no drop, no pivot.
          if (mob.lane == null || mob.wallFollow !== true) windowOk = false;
        }
        if (mob.roam?.guided) sawGuided = true;
        if (mob.pos.z >= 2.5 && Math.abs(mob.pos.x - 0.5) < 1.0) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    if (done) {
      crossed++;
      assert.ok(sawEntry, `entry-keeps-line seed${s}: entry drew the ride`);
      assert.ok(windowOk, `entry-keeps-line seed${s}: lane kept, blue held, no pivot`);
      assert.ok(sawGuided, `entry-keeps-line seed${s}: guided erect, not a free pivot`);
      if (sawGuided) guided++;
      assertClean(trace, `entry-keeps-line seed${s}`);
    }
  }
  assert.ok(crossed >= 6, `entry-keeps-line: through on ${crossed}/8 seeds`);
  assert.ok(guided >= 4, `entry-keeps-line: guided erect on ${guided}/8 seeds`);
}
console.log("PASS entry-keeps-line");

// --- village doors: a real leveled village, walk in and back out through
// house 0's door (off-axis approach + interior exit, both deterministic).
for (const seed of [7, 99]) {
  resetWorld("over");
  clearEntryClaims();
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
  clearEntryClaims();
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

// --- V-invariance: the same seed run at ×1 and ×8 sim speeds replays the
// same corridor ride (fixed-step integration: exact SERVO_STEP slices, draws
// aligned per sim-second). Engage frame, sampled states and final spot
// match at both speeds.
{
  const ride = (stepMul, frames) => {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 24; z++) setBlock(x, 0, z, STONE);
    for (let z = -1; z <= 21; z++) {
      setBlock(-1, 1, z, STONE); setBlock(-1, 2, z, STONE);
      setBlock(1, 1, z, STONE); setBlock(1, 2, z, STONE);
    }
    const mob = makeTestMob("pig", 0.5, FEET, 0.5, 0);
    const target = { x: 0.5, z: 30 };
    const realRandom = Math.random;
    Math.random = mulberry32(41);
    const trace = [];
    try {
      for (let t = 0; t < frames; t++) {
        tickFarmMob(mob, DT * stepMul, () => target, mob.rand ?? Math.random);
        trace.push({ x: mob.pos.x, z: mob.pos.z, yaw: mob.yaw, lane: mob.lane ? mob.lane.axis : null });
      }
    } finally {
      Math.random = realRandom;
    }
    return trace;
  };
  const SIM_S = 8, A = ride(1, SIM_S * 60), B = ride(8, SIM_S * 60 / 8);
  assert.ok(A.some((p) => p.lane !== null) && B.some((p) => p.lane !== null),
    `vinv: engaged at both speeds`);
  assert.ok(Math.floor(A.findIndex((p) => p.lane !== null) / 8) === B.findIndex((p) => p.lane !== null),
    `vinv: same engage tick (×1 ${A.findIndex((p) => p.lane !== null)}, ×8 ${B.findIndex((p) => p.lane !== null)})`);
  for (let j = 0; j < B.length; j++) {
    const a = A[j * 8 + 7], b = B[j]; // same substep count: 8(j+1)
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 &&
      Math.abs(a.yaw - b.yaw) < 1e-9 && a.lane === b.lane,
      `vinv: same state @sim-tick ${j * 8}`);
  }
  const endA = A[A.length - 1], endB = B[B.length - 1];
  assert.ok(Math.abs(endA.x - endB.x) < 1e-9 && Math.abs(endA.z - endB.z) < 1e-9,
    `vinv: same final spot`);
  assertClean(A.map((p) => ({ ...p, y: FEET })), "vinv-×1");
  assertClean(B.map((p) => ({ ...p, y: FEET })), "vinv-×8");
}
console.log("PASS v-invariance");

// --- displacement-mode flags (the ?color=1 tint reads these: blue rides
// a follow line, red runs a true 1-wide lane, neither walks open roam) ---
{
  // Red: true 1-wide straight cruise — lane held, never a line.
  const trace = runTrial("muret", "straight", { seed: 3, maxTicks: 600 });
  const cruise = trace.slice(30, 300);
  assert.ok(cruise.length > 200, `modes-red: cruise sampled`);
  assert.ok(cruise.every((p) => p.lane), `modes-red: lane held`);
  assert.ok(cruise.every((p) => p.ow && !p.wf), `modes-red: oneWide, never wallFollow`);
}
console.log("PASS modes-red");
{
  // Blue: frontal wall contact latches a permanent touch ride — lane
  // held, wallFollow on, glued 0.5 off the face, never through the wall.
  // Head-on contact draws lots, so the ride direction is seed luck; the
  // wall outlasts the run so no tip turn breaks the straight asserts.
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let x = -24; x <= 24; x++) for (let z = -8; z <= 8; z++) setBlock(x, 0, z, STONE);
  for (let x = -20; x <= 20; x++) { setBlock(x, 1, 2, STONE); setBlock(x, 2, 2, STONE); }
  const mob = makeTestMob("pig", 0.5, FEET, -2.5, 0);
  mob.pinWallRide = true; // legacy permanent ride: latch on contact, never expire
  const fixed = { x: 0.5, z: 30 };
  mob.target = fixed;
  const realRandom = Math.random;
  Math.random = mulberry32(9);
  const trace = [];
  try {
    for (let t = 0; t < 600; t++) {
      tickFarmMob(mob, DT, () => fixed);
      trace.push({ x: mob.pos.x, z: mob.pos.z, lane: mob.lane != null, wf: mob.wallFollow === true, ow: mob.oneWide === true });
    }
  } finally {
    Math.random = realRandom;
  }
  const ride = trace.slice(200);
  assert.ok(ride.every((p) => p.lane), `modes-blue: lane held`);
  assert.ok(ride.every((p) => p.wf && !p.ow), `modes-blue: wallFollow, never oneWide`);
  // Glued 0.5 off the face (south face z=2, line z=1.5).
  assert.ok(ride.every((p) => Math.abs(p.z - 1.5) < 0.2), `modes-blue: glued off the face`);
  assert.ok(ride.every((p) => p.z < 2), `modes-blue: never through the wall`);
  assert.ok(Math.abs(mob.pos.x - 0.5) > 2, `modes-blue: cruised along the wall (x=${mob.pos.x.toFixed(2)})`);
  assertClean(trace.map((p) => ({ ...p, y: FEET })), "modes-blue");
}
console.log("PASS modes-blue");
{
  // Neither: open-field commit — no lane, no line, no flag.
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 24; z++) setBlock(x, 0, z, STONE);
  const mob = makeTestMob("pig", 0.5, FEET, 0.5, Math.PI / 4);
  const fixed = { x: 20, z: 30 };
  mob.target = fixed;
  const realRandom = Math.random;
  Math.random = mulberry32(5);
  const trace = [];
  try {
    for (let t = 0; t < 400; t++) {
      tickFarmMob(mob, DT, () => fixed);
      trace.push({ lane: mob.lane != null, wf: mob.wallFollow === true, ow: mob.oneWide === true });
    }
  } finally {
    Math.random = realRandom;
  }
  assert.ok(trace.every((p) => !p.lane), `modes-open: never a lane`);
  assert.ok(trace.every((p) => !p.wf && !p.ow), `modes-open: neither flag`);
}
console.log("PASS modes-open");
{
  // No red in the wide: open-field commits across seeds never raise a
  // 1-wide lane (the engage gate + the strict hold share one tunnel rule,
  // so a false-positive engage drops the same tick it would erect).
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 44; z++) setBlock(x, 0, z, STONE);
    const mob = makeTestMob("pig", 0.5, FEET, 0.5, (seed * 1.1) % (Math.PI * 2));
    const fixed = { x: 20 - seed, z: 30 };
    mob.target = fixed;
    const realRandom = Math.random;
    Math.random = mulberry32(seed);
    try {
      for (let t = 0; t < 400; t++) {
        tickFarmMob(mob, DT, () => fixed);
        assert.ok(!mob.oneWide, `modes-wide: no 1-wide in the open (seed ${seed}, tick ${t})`);
        assert.ok(mob.lane == null, `modes-wide: never a lane in the open (seed ${seed}, tick ${t})`);
      }
    } finally {
      Math.random = realRandom;
    }
  }
}
console.log("PASS modes-wide");

// --- wide-cross: oblique 2-wide approach. No yank while committed
// (every guided line gentle — pending lines read exempt, blue held), no
// demi-tour while committed (yaw never reverses past 120° from the accept
// heading — 90° hole-ward turns still read), every seed crosses. Lateral
// drift itself is covered black-box by wide-straight below ---
{
  let crossed = 0, sawViolet = 0;
  for (let s = 1; s <= 8; s++) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -6; x <= 8; x++) for (let z = -6; z <= 10; z++) setBlock(x, 0, z, STONE);
    for (let x = -6; x <= 8; x++) {
      if (x === 0 || x === 1) continue;
      setBlock(x, 1, 3, STONE); setBlock(x, 2, 3, STONE);
    }
    const mob = makeTestMob("pig", -1.5, FEET, 0.5, 0.35);
    const fixed = { x: -1.5, z: 30 };
    mob.target = fixed;
    const realRandom = Math.random;
    Math.random = mulberry32(s * 101 + 7);
    let acceptYaw = null, maxRev = 0, violet = false, done = false, yanked = false;
    try {
      for (let t = 0; t < 1500; t++) {
        const wasV = mob.roam?.entry === true;
        if (wasV && acceptYaw == null) acceptYaw = mob.yaw;
        tickFarmMob(mob, DT, () => fixed);
        const isV = mob.roam?.entry === true;
        if (isV) {
          violet = true;
          // A guided line (hole-ward ride) is always gentle: the fresh yank
          // never fires while committed. Pending lines (no guide yet) read
          // exempt — blue held until the erect, per entry-keeps-line.
          if (mob.followLine?.guideKey != null && mob.followLine.gentle !== true) yanked = true;
          if (acceptYaw != null) {
            let d = mob.yaw - acceptYaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            maxRev = Math.max(maxRev, Math.abs(d));
          }
        } else if (wasV) acceptYaw = null;
        if (mob.pos.z >= 4.5) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    if (done) {
      crossed++;
      assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3), `wide-cross seed${s}: wall-clean`);
    }
    if (violet) {
      sawViolet++;
      assert.ok(!yanked, `wide-cross seed${s}: guided lines stay gentle`);
      assert.ok(maxRev < 2.1, `wide-cross seed${s}: no U-turn while violet (max ${(maxRev * 180 / Math.PI).toFixed(1)}°)`);
    }
  }
  assert.ok(crossed >= 6, `wide-cross: through on ${crossed}/8 seeds`);
  assert.ok(sawViolet >= 6, `wide-cross: violet on ${sawViolet}/8 seeds`);
}
console.log("PASS wide-cross");

// --- wide-straight: off-centre straight walk down a long 2-wide corridor,
// no entry. No lane ever erects (the engage veto + flank guard decline the
// mouth corners and the passage grazes), so the mob holds its line with
// ~zero lateral drift instead of yanking onto an edge ---
{
  for (const s of [1, 2, 3]) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -5; x <= 6; x++) for (let z = -6; z <= 12; z++) setBlock(x, 0, z, STONE);
    for (let z = -2; z <= 8; z++) {
      setBlock(-1, 1, z, STONE); setBlock(-1, 2, z, STONE);
      setBlock(2, 1, z, STONE); setBlock(2, 2, z, STONE);
    }
    const mob = makeTestMob("pig", 0.8, FEET, -1.5, 0.1);
    const fixed = { x: 0.8, z: 30 };
    mob.target = fixed;
    mob.wanderT = NO_EXPIRY;
    mob.entryScanT = 999; // throttled: pure roam walk, no entry draws
    mob.roam = {
      mode: "commit", heading: 0.1, target: fixed, tgt: fixed,
      t: 0, span: 99, runT: 0,
    };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    let latMax = 0, laneTicks = 0, lineTicks = 0, done = false;
    try {
      for (let t = 0; t < 600; t++) {
        tickFarmMob(mob, DT, () => fixed);
        if (mob.pos.z > -2 && mob.pos.z < 8) {
          latMax = Math.max(latMax, Math.abs(mob.pos.x - 0.8));
          if (mob.lane) laneTicks++;
          if (mob.followLine) lineTicks++;
        }
        if (mob.pos.z >= 8) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(done, `wide-straight seed${s}: walks the corridor`);
    assert.ok(laneTicks === 0, `wide-straight seed${s}: no lane (${laneTicks} ticks)`);
    assert.ok(lineTicks === 0, `wide-straight seed${s}: no line (${lineTicks} ticks)`);
    assert.ok(latMax < 0.1, `wide-straight seed${s}: holds its line (drift ${latMax.toFixed(3)})`);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3), `wide-straight seed${s}: wall-clean`);
  }
}
console.log("PASS wide-straight");

// --- exit-gentle: a 2-wide exit with wall contact draws the wall ride, but
// the ride glues gently — lateral steps stay at the soft rate (no fresh
// yank) while the line converges, then the ride quits outward past the
// wall end, wall-clean throughout ---
{
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    // Wide floor west: the edge reads as a drop wall, which plus the wall
    // row would form a phantom 2-wide mouth in entry range.
    for (let x = -9; x <= 8; x++) for (let z = -6; z <= 10; z++) setBlock(x, 0, z, STONE);
  for (let x = -6; x <= 8; x++) {
    if (x === 0 || x === 1) continue;
    setBlock(x, 1, 3, STONE); setBlock(x, 2, 3, STONE);
  }
  const mob = makeTestMob("pig", 0.33, FEET, 3.4, 0);
  mob.entryScanT = 999; // throttled: no entry draws mid-ride
  const r = scriptRand([0.1, 0.5, 0.3, 0.7, 0.2]);
  const latched = exitPassage(mob, 0, DT, true, false, r, () => null);
  assert.ok(latched, "exit-gentle: contact draws the ride");
  assert.ok(mob.lane != null && mob.followLine?.exitRide != null, "exit-gentle: exit-marked lane");
  assert.ok(mob.followLine.gentle === true, "exit-gentle: gentle flag");
  const lineX = mob.followLine.line;
  assert.ok(Math.abs(lineX - 0.5) < 1e-9, `exit-gentle: mouth-wall line (line=${lineX})`);
  let maxLat = 0, px = mob.pos.x;
  const trace = [];
  for (let t = 0; t < 90; t++) {
    tickFarmMob(mob, DT, () => mob.target, r);
    trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z });
    maxLat = Math.max(maxLat, Math.abs(mob.pos.x - px));
    px = mob.pos.x;
  }
  assert.ok(maxLat <= 0.014, `exit-gentle: soft lateral steps (max ${maxLat.toFixed(4)})`);
  assert.ok(Math.abs(mob.pos.x - lineX) <= 0.08, `exit-gentle: converged (x=${mob.pos.x.toFixed(3)})`);
  assertClean(trace, "exit-gentle");
}
console.log("PASS exit-gentle");

// --- mouth-corner: corner-graze false engage. Fat body probes clipping a
// jamb corner one side and a slope block the other read walled with no
// flanking wall in either adjacent cell — the engage gate declines (true
// 1-wide cells and dead-end mouths still engage) so no red rail forms at
// the mouth and the mob walks straight through instead of parading ---
{
  for (const s of [1, 2, 3]) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -5; x <= 6; x++) for (let z = -5; z <= 5; z++) setBlock(x, 0, z, STONE);
    // 2-wide mouth with stub jambs, a walled west column and an east slope
    // block fore of the row: both body probes clip corners with open
    // adjacent cells.
    setBlock(-1, 1, 0, STONE); setBlock(-1, 2, 0, STONE);
    setBlock(2, 1, 0, STONE); setBlock(2, 2, 0, STONE);
    setBlock(-1, 1, -1, STONE); setBlock(-1, 2, -1, STONE);
    setBlock(-1, 1, -2, STONE); setBlock(-1, 2, -2, STONE);
    setBlock(2, 1, -1, STONE); setBlock(2, 2, -1, STONE);
    const mob = makeTestMob("pig", 0.75, FEET, -0.28, 0);
    const fixed = { x: 0.75, z: 30 };
    mob.target = fixed;
    mob.wanderT = NO_EXPIRY;
    mob.entryScanT = 999; // throttled: pure roam walk, no entry draws
    mob.roam = {
      mode: "commit", heading: 0, target: fixed, tgt: fixed,
      t: 0, span: 99, runT: 0,
    };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    let laneTicks = 0, done = false;
    const trace = [];
    try {
      for (let t = 0; t < 600; t++) {
        tickFarmMob(mob, DT, () => fixed);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw });
        if (mob.lane) laneTicks++;
        if (mob.pos.z >= 2) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(done, `mouth-corner seed${s}: walks through the mouth`);
    assert.ok(laneTicks === 0, `mouth-corner seed${s}: never engages (${laneTicks} ticks)`);
    assertClean(trace, `mouth-corner seed${s}`);
  }
}
console.log("PASS mouth-corner");

// --- hole-oblique: oblique thin-hole approach. Wedged entries
// convert to a hole-ward ride or slide free (failed latches deflect instead
// of freezing); every attracted seed threads the hole ---
{
  let crossed = 0, sawViolet = 0;
  for (let s = 1; s <= 8; s++) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -6; x <= 8; x++) for (let z = -6; z <= 10; z++) setBlock(x, 0, z, STONE);
    for (let x = -6; x <= 8; x++) {
      if (x === 0) continue;
      setBlock(x, 1, 3, STONE); setBlock(x, 2, 3, STONE);
    }
    const mob = makeTestMob("pig", -1.5, FEET, 0.5, 0.35);
    const fixed = { x: -1.5, z: 30 };
    mob.target = fixed;
    const realRandom = Math.random;
    Math.random = mulberry32(s * 101 + 7);
    let violet = false, done = false;
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => fixed);
        if (mob.roam?.entry) violet = true;
        if (mob.pos.z >= 4.5) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    if (violet) {
      sawViolet++;
      assert.ok(done, `hole-oblique seed${s}: commit threads the hole`);
    }
    if (done) {
      crossed++;
      assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3), `hole-oblique seed${s}: wall-clean`);
    }
  }
  assert.ok(sawViolet >= 6, `hole-oblique: violet on ${sawViolet}/8 seeds`);
  assert.ok(crossed >= 6, `hole-oblique: through on ${crossed}/8 seeds`);
}
console.log("PASS hole-oblique");

// --- violet-u-detour: diagonal entry toward a mouth inside a U nook. The
// straight push wedges the nose on the arm's outer corner with no latchable
// wall — instead of grinding to the 15 s backstop and re-accepting forever,
// the commit detours via the approach cell (same commit, still violet) and
// pushes frontal, threading every seed quickly and wall-clean ---
{
  for (let s = 1; s <= 4; s++) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -6; x <= 10; x++) for (let z = -6; z <= 10; z++) setBlock(x, 0, z, STONE);
    for (let x = 0; x <= 4; x++) { if (x === 2) continue; setBlock(x, 1, 4, STONE); setBlock(x, 2, 4, STONE); }
    for (let z = 2; z <= 4; z++) { setBlock(1, 1, z, STONE); setBlock(1, 2, z, STONE); setBlock(3, 1, z, STONE); setBlock(3, 2, z, STONE); }
    const mob = makeTestMob("pig", 0.5, FEET, 1.5, 0.6);
    mob.target = { x: 9, z: 9 };
    assert.equal(entryTick(mob, DT, scriptRand([0.0, 0.99])), true, `u-detour seed${s}: accept`);
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let violet = false, done = false;
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z });
        if (mob.roam?.entry) violet = true;
        if (mob.pos.z > 4.6 && mob.pos.x > 1.5 && mob.pos.x < 3.5) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(violet, `u-detour seed${s}: violet while threading`);
    assert.ok(done, `u-detour seed${s}: threaded the U mouth`);
    assert.ok(trace.length < 1000, `u-detour seed${s}: no grind (${trace.length} ticks)`);
    assertClean(trace, `u-detour seed${s}`);
  }
}
console.log("PASS violet-u-detour");

// Shared fence/pool shape (seed-4 village geometry): the pen fence with
// the pool 2 cells past it, forming a 2-wide slot on the pool side.
function buildFencePool() {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let x = 8; x <= 36; x++) for (let z = -56; z <= -20; z++) setBlock(x, 0, z, STONE);
  for (let x = 16; x <= 30; x++) for (const z of [-48, -36]) setBlock(x, 1, z, LOG);
  for (let z = -48; z <= -36; z++) for (const x of [16, 30]) setBlock(x, 1, z, LOG);
  for (let x = 17; x <= 18; x++) for (let z = -47; z <= -46; z++) setBlock(x, 1, z, WATER);
  for (let z = -47; z <= -45; z++) setBlock(19, 1, z, STONE);
  for (let x = 17; x <= 19; x++) setBlock(x, 1, -45, STONE);
  for (let x = 22; x <= 29; x++) for (let z = -33; z <= -28; z++) setBlock(x, 1, z, WATER);
  for (let x = 21; x <= 30; x++) for (const z of [-34, -27]) setBlock(x, 0, z, STONE);
  for (let z = -34; z <= -27; z++) for (const x of [21, 30]) setBlock(x, 0, z, STONE);
}

// --- gap-walk: 2-wide fence/pool slot attracts (long-flank mouth) ---
// Seed-4 village shape: the pen fence with the pool 2 cells past it. The
// slot between them reads walled both sides with 3 blocks of free depth
// and an open approach from the west — one edge (fence) starts while the
// pool run holds the other side, so the unified rule lists it and a mob
// walking the gap is drawn in and threads it violet. Locks the aligned
// 1/2-wide approach clause (at least one open side). ---
{
  for (let s = 1; s <= 8; s++) {
    buildFencePool();
    const mob = makeTestMob("pig", 18.5, FEET, -34.5, Math.PI / 2);
    mob.target = { x: 60, z: -34.5 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    let done = false, sawViolet = false, sawEntry = false;
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z });
        if (mob.tunnelPass) sawViolet = true;
        if (mob.roam?.entry) sawEntry = true;
        if (mob.pos.x > 31) { done = true; break; }
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(sawEntry, `gap-walk seed${s}: drew into the slot`);
    assert.ok(sawViolet, `gap-walk seed${s}: threaded violet`);
    assert.ok(done, `gap-walk seed${s}: walked the gap`);
    assertClean(trace, `gap-walk seed${s}`);
  }
}
console.log("PASS gap-walk");

// --- pen-pool-farside: a slot mouth across an uncrossable fence never draws ---
// Same fence/pool shape as gap-walk, mob inside the pen facing the pool
// side: the 2-wide slot mouths list in range and ahead, but the straight
// walk there crosses the fence ring — the reachability gate skips them, so
// the mob never reads violet and never commits, on any seed. Locks the
// far-side rejection behind the unified rule. ---
{
  for (let s = 1; s <= 8; s++) {
    buildFencePool();
    const mob = makeTestMob("pig", 22.5, FEET, -37.5, 0);
    mob.target = { x: 22.5, z: -20 };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const trace = [];
    try {
      for (let t = 0; t < 1500; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z });
        assert.ok(!mob.tunnelPass, `pen-pool-farside seed${s}: never violet @tick${t}`);
        assert.ok(!mob.roam?.entry, `pen-pool-farside seed${s}: never an entry @tick${t}`);
      }
    } finally {
      Math.random = realRandom;
    }
    assertClean(trace, `pen-pool-farside seed${s}`);
  }
}
console.log("PASS pen-pool-farside");

// --- scrape-45: diagonal roam commit into a long wall never grinds — the
// drive re-faces along the free axis and slides at stride (no halving
// micro-stop chain), so slow ticks stay at the turn transient and the mob
// makes metres along the face ---
{
  for (const s of [1, 2, 3]) {
    resetWorld("over");
    clearEntryClaims();
    setDimension("over");
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 14; z++) setBlock(x, 0, z, STONE);
    for (let z = -6; z <= 14; z++) { setBlock(2, 1, z, STONE); setBlock(2, 2, z, STONE); }
    const mob = makeTestMob("pig", -0.5, FEET, 0.5, Math.PI / 4);
    mob.target = { x: 9.5, z: 10.5 };
    mob.wanderT = NO_EXPIRY;
    mob.entryScanT = 999; // no entry draws: pure roam scrape
    mob.roam = {
      mode: "commit", heading: Math.PI / 4, target: mob.target, tgt: mob.target,
      t: 0, span: 99, runT: 0,
    };
    const realRandom = Math.random;
    Math.random = mulberry32(s);
    const sp = [];
    let px = mob.pos.x, pz = mob.pos.z;
    try {
      for (let t = 0; t < 240; t++) {
        tickFarmMob(mob, DT, () => mob.target);
        sp.push(Math.hypot(mob.pos.x - px, mob.pos.z - pz) / DT);
        px = mob.pos.x; pz = mob.pos.z;
      }
    } finally {
      Math.random = realRandom;
    }
    const slows = sp.filter((v) => v < 1.0).length;
    assert.ok(slows <= 6, `scrape-45 seed${s}: ${slows} slow ticks`);
    assert.ok(mob.pos.z - 0.5 > 1.5, `scrape-45 seed${s}: slides along the face (dz=${(mob.pos.z - 0.5).toFixed(2)})`);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3), `scrape-45 seed${s}: wall-clean`);
  }
}
console.log("PASS scrape-45");

console.log("mob-paths.test.mjs: ALL PASS");
