// 1-wide crossings: two true 1-wide rails closing on each other ghost
// through each other (no peer gate, yield, pacing, grind, or backstop
// between them) and keep right of their own lane axis on straight cells —
// opposed rails sit on opposite world sides, a U-turn slides across.
// Files and parted pairs keep every collision rule and the centred ride.
// The REAL mover (mover.js) on REAL voxels (store.js), headless (mob.root
// is null), driven like production (planGroup + mob grid + separation
// backstop), in closed 1-wide, 1-deep trenches where every end is a
// dead-end U-turn.
import assert from "node:assert/strict";
import { AIR, STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import {
  FARM_WALK, tickFarmMob, separateFarmMobs, railCrossing, railOff, worstPairPen, WALL_ALLOW, aabbIntersectsSolid,
} from "../../../src/mobs/mover.js";
import { planGroup } from "../../../src/mobs/forecast.js";
import { buildMobGrid } from "../../../src/mobs/grid.js";
import { NO_EXPIRY, SERVO_STEP, strideTarget } from "../../../src/mobs/step.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const FEET = 1;
const DT = SERVO_STEP;
const STRIDE = FARM_WALK * DT;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1-deep trench: ground at y=1 everywhere except the carved path cells.
function buildTrench(cells) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  for (let x = Math.min(...xs) - 8; x <= Math.max(...xs) + 8; x++) {
    for (let z = Math.min(...zs) - 8; z <= Math.max(...zs) + 8; z++) {
      setBlock(x, 0, z, STONE); setBlock(x, 1, z, STONE);
    }
  }
  for (const [x, z] of cells) setBlock(x, 1, z, AIR);
}

function makeMob(kind, x, z, yaw, seed) {
  const shape = specCircles(LIVESTOCK_SPECS[kind]);
  return {
    type: kind, dim: "over", pos: { x, y: FEET, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK, rand: mulberry32(seed),
    stuckT: 0, lastX: x, lastZ: z, fallFrom: FEET, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0, entryScanT: 0, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
  };
}

const yawStep = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);

// Nearest path cell index: the 1-D track coordinate (crossings flip order).
function trackIdx(cells, m) {
  let best = 0, bd = Infinity;
  for (let c = 0; c < cells.length; c++) {
    const d = Math.hypot(m.pos.x - cells[c][0] - 0.5, m.pos.z - cells[c][1] - 0.5);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// Production-shaped loop with per-mob motion metrics:
// - still: neither translating (≥ 0.5 stride) nor rotating;
// - creep: translating below 0.8 stride while not rotating (stutter);
// - jump: max per-tick lateral slide (cell-centre lateral of the lane);
// - laneLost: ticks without a lane; wallDeep: body past the graze;
// - cells visited; crossings: track-order flips between mob 0 and 1;
// - sideBad: longest run with both offset, opposed lanes, same world side.
function run(cells, spawns, ticks, extra = []) {
  buildTrench(cells);
  for (const [x, z] of extra) setBlock(x, 1, z, AIR);
  // A spawn may arrive already railed (`railed`: lane on its heading), the
  // way a mob reaches a corridor corner in game — a lane-less body dropped
  // in a corner cell waits out the engage cooldown first (solo too).
  const list = spawns.map((s, i) => {
    const m = makeMob(s.kind ?? "cow", s.x, s.z, s.yaw, s.seed ?? 11 + i * 11);
    if (s.railed) m.lane = { axis: s.yaw, entry: s.yaw + Math.PI, lockX: -1, lockZ: -1 };
    return m;
  });
  // Valid poses only (game spawns validate the same): body and snout clear
  // of the trench walls — an embedded nose refuses every stride.
  for (const m of list) {
    const nx = m.pos.x + Math.sin(m.yaw) * m.nose.along, nz = m.pos.z + Math.cos(m.yaw) * m.nose.along;
    assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) &&
      !aabbIntersectsSolid(nx, m.pos.y, nz, m.nose.r, m.h), `rig spawn embedded (${m.pos.x},${m.pos.z})`);
  }
  const pick = (m, r) => strideTarget(m, undefined, r);
  const R = list.map(() => ({ still: 0, stillRun: 0, stillWorst: 0, creep: 0, jump: 0, laneLost: 0, wallDeep: 0, offIdle: 0, offRun: 0, cells: new Set() }));
  let crossings = 0, lastOrder = 0, sideRun = 0, sideBad = 0, crossTicks = 0, maxPenIdle = 0;
  const trace = [];
  for (let t = 0; t < ticks; t++) {
    list.forEach((m, i) => { m._peerIdx = i; });
    const grid = buildMobGrid(list, 3);
    planGroup(list, DT, grid);
    const prev = list.map((m) => ({ x: m.pos.x, z: m.pos.z, yaw: m.yaw, axis: m.lane?.axis }));
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list, grid);
    separateFarmMobs(list, grid);
    list.forEach((m, i) => {
      const r = R[i], p = prev[i];
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      const rot = yawStep(m.yaw, p.yaw) > 0.02;
      if (d < 0.5 * STRIDE && !rot) { r.still++; r.stillRun++; r.stillWorst = Math.max(r.stillWorst, r.stillRun); } else r.stillRun = 0;
      if (d >= 0.05 * STRIDE && d < 0.8 * STRIDE && !rot) r.creep++;
      if (m.lane) {
        const ax = Math.sin(m.lane.axis), az = Math.cos(m.lane.axis);
        const lat = (q) => (q.x - Math.floor(q.x) - 0.5) * -az + (q.z - Math.floor(q.z) - 0.5) * ax;
        // Off-centre with no crossing: the plain 1-wide ride is centred,
        // side-by-side belongs to crossings only.
        // Corner blends arc off the line legitimately (solo too): straight,
        // aligned riding only.
        const aligned = yawStep(m.yaw, m.lane.axis) < 0.05 && !((m.blendT ?? 0) > 0 && (m.blendT ?? 0) < 1);
        // The re-centring glide after a crossing (≤ 0.26 m at the centring
        // rate) is the only legal off-centre run: a longer one is stale.
        if (t >= 30 && aligned && !(m._crossMates?.length) && Math.abs(lat(m.pos)) > 0.05) { r.offRun++; r.offIdle = Math.max(r.offIdle, r.offRun); } else r.offRun = 0;
        if (p.axis != null && yawStep(p.axis, m.lane.axis) < 1e-6 &&
          Math.floor(p.x) === Math.floor(m.pos.x) && Math.floor(p.z) === Math.floor(m.pos.z)) {
          r.jump = Math.max(r.jump, Math.abs(lat(m.pos) - lat(p)));
        }
      } else if (t >= 30) r.laneLost++; // grace: lane-less spawns engage
      if (aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw - WALL_ALLOW - 1e-3, m.h)) r.wallDeep++;
      r.cells.add(`${Math.floor(m.pos.x)},${Math.floor(m.pos.z)}`);
    });
    if (list.length >= 2) {
      const [a, b] = list;
      const order = Math.sign(trackIdx(cells, a) - trackIdx(cells, b));
      if (order !== 0) { if (lastOrder !== 0 && order !== lastOrder) crossings++; lastOrder = order; }
      if (railCrossing(a, b)) crossTicks++;
      else { const w = worstPairPen(a, b); if (w) maxPenIdle = Math.max(maxPenIdle, w.pen); }
      // World-side rule on a shared straight: opposed lanes on one cell line
      // sit on opposite sides once both are offset.
      let bad = false;
      if (a.lane && b.lane && yawStep(a.lane.axis, b.lane.axis) > 3) {
        const ax = Math.sin(a.lane.axis), az = Math.cos(a.lane.axis);
        const la = (a.pos.x - Math.floor(a.pos.x) - 0.5) * -az + (a.pos.z - Math.floor(a.pos.z) - 0.5) * ax;
        const lb = (b.pos.x - Math.floor(b.pos.x) - 0.5) * -az + (b.pos.z - Math.floor(b.pos.z) - 0.5) * ax;
        const sameLine = ax === 0 || Math.abs(ax) < 1e-9
          ? Math.floor(a.pos.x) === Math.floor(b.pos.x) : Math.floor(a.pos.z) === Math.floor(b.pos.z);
        bad = sameLine && Math.abs(la) > 0.15 && Math.abs(lb) > 0.15 && la * lb > 0;
      }
      if (bad) { sideRun++; sideBad = Math.max(sideBad, sideRun); } else sideRun = 0;
    }
    trace.push(list.map((m) => `${m.pos.x.toFixed(6)},${m.pos.z.toFixed(6)},${m.yaw.toFixed(6)}`).join("|"));
  }
  return { list, R, crossings, sideBad, crossTicks, maxPenIdle, trace };
}

const fmt = (r) => r.R.map((q) => `stillWorst ${q.stillWorst} creep ${q.creep} jump ${q.jump.toFixed(3)} laneLost ${q.laneLost} wallDeep ${q.wallDeep} offIdle ${q.offIdle} cells ${q.cells.size}`).join(" / ");

// Every pair rig: never frozen, no stutter, the slide never hops, lanes
// held, no wall walk-through, both mobs cover the whole path, and they
// cross over and over instead of blocking.
function assertFluent(label, cells, r, minCross, minCells = cells.length) {
  console.log(`${label}: crossings ${r.crossings} sideBad ${r.sideBad} crossTicks ${r.crossTicks} maxPenIdle ${r.maxPenIdle.toFixed(3)} | ${fmt(r)}`);
  r.R.forEach((q, i) => {
    assert.ok(q.stillWorst <= 2, `${label}: mob ${i} froze ${q.stillWorst} ticks`);
    assert.ok(q.creep <= 15, `${label}: mob ${i} crept ${q.creep} ticks (stutter)`);
    // One stride (turning drives move along the yaw) plus the centring
    // slide (0.9 stride): continuous motion, never a hop.
    assert.ok(q.jump <= STRIDE * 1.9 + 1e-3, `${label}: mob ${i} lateral hop ${q.jump.toFixed(3)}`);
    assert.equal(q.laneLost, 0, `${label}: mob ${i} lost its rail`);
    assert.equal(q.wallDeep, 0, `${label}: mob ${i} body past the wall graze`);
    assert.ok(q.offIdle <= 10, `${label}: mob ${i} rode off-centre outside a crossing for ${q.offIdle} ticks`);
    assert.ok(q.cells.size >= minCells, `${label}: mob ${i} visited ${q.cells.size}/${cells.length} cells`);
  });
  assert.ok(r.crossings >= minCross, `${label}: only ${r.crossings} crossings`);
  assert.ok(r.sideBad <= 20, `${label}: opposed rails shared a side for ${r.sideBad} ticks`);
}

// --- 3-long trench: U-turns at both ends, cross without ever blocking,
// head-on and file at any spacing (overlapping spawns included), cows,
// pigs, and mixed sizes.
const T3 = [[0, 0], [0, 1], [0, 2]];
for (const [label, spawns] of [
  ["trench3-headon", [{ x: 0.5, z: 1.1, yaw: 0 }, { x: 0.5, z: 1.9, yaw: Math.PI }]],
  ["trench3-file", [{ x: 0.5, z: 1.1, yaw: 0 }, { x: 0.5, z: 1.9, yaw: 0 }]],
  ["trench3-file-tight", [{ x: 0.5, z: 1.4, yaw: 0 }, { x: 0.5, z: 1.6, yaw: 0 }]],
  ["trench3-pigs", [{ kind: "pig", x: 0.5, z: 1.1, yaw: 0 }, { kind: "pig", x: 0.5, z: 1.9, yaw: Math.PI }]],
  ["trench3-mixed", [{ x: 0.5, z: 1.1, yaw: 0 }, { kind: "pig", x: 0.5, z: 1.9, yaw: 0 }]],
]) {
  assertFluent(label, T3, run(T3, spawns, 1200), 5);
  console.log(`PASS ${label}`);
}

// --- 3-block corner (2 cells, then 1 turn): same, around the bend.
const C3 = [[0, 0], [0, 1], [1, 1]];
for (const [label, spawns] of [
  ["corner3-headon", [{ x: 0.5, z: 0.6, yaw: 0 }, { x: 1.4, z: 1.5, yaw: -Math.PI / 2 }]],
  ["corner3-file", [{ x: 0.5, z: 0.6, yaw: 0 }, { x: 0.8, z: 1.5, yaw: Math.PI / 2, railed: true }]],
  ["corner3-file-tight", [{ x: 0.5, z: 0.85, yaw: 0 }, { x: 0.6, z: 1.5, yaw: Math.PI / 2, railed: true }]],
  ["corner3-pigs", [{ kind: "pig", x: 0.5, z: 0.6, yaw: 0 }, { kind: "pig", x: 1.4, z: 1.5, yaw: -Math.PI / 2 }]],
]) {
  assertFluent(label, C3, run(C3, spawns, 1200), 15);
  console.log(`PASS ${label}`);
}

// --- Zigzag, left right left right left right, closed at both ends.
const Z = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 4]];
for (const [label, spawns] of [
  ["zigzag-headon", [{ x: 0.5, z: 0.5, yaw: 0 }, { x: 3.5, z: 4.5, yaw: Math.PI }]],
  ["zigzag-file", [{ x: 0.5, z: 0.5, yaw: 0 }, { x: 0.85, z: 1.5, yaw: Math.PI / 2, railed: true }]],
  ["zigzag-pigs", [{ kind: "pig", x: 0.5, z: 0.5, yaw: 0 }, { kind: "pig", x: 3.5, z: 4.5, yaw: Math.PI }]],
]) {
  // A cow's nose guard stops its centre one cell short of a 1-cell end arm,
  // so the end cells only ever hold a spawn.
  assertFluent(label, Z, run(Z, spawns, 1800), 4, Z.length - 2);
  console.log(`PASS ${label}`);
}

// --- Long straight head-on: the pair keeps right before contact and
// brushes past at full stride (no creep, no freeze), offsets on opposite
// world sides, then each re-centres once the mate is out of reach.
{
  const S = [];
  for (let z = 0; z <= 13; z++) S.push([0, z]);
  const r = run(S, [{ x: 0.5, z: 1.5, yaw: 0 }, { x: 0.5, z: 12.5, yaw: Math.PI }], 1500);
  assertFluent("straight-headon", S, r, 3);
  assert.ok(r.crossTicks > 0 && r.crossTicks < 1500, `straight-headon: the crossing engages only within reach (${r.crossTicks} ticks)`);
  console.log("PASS straight-headon");
}

// --- File on a long straight: same-direction rails never cross — they
// keep every collision rule (no ghosting, no keep-right, centred ride, at
// most a brush), until the leader turns round at the dead end: then the
// pair is closing and crosses side by side like any head-on.
{
  const S = [];
  for (let z = 0; z <= 13; z++) S.push([0, z]);
  const r = run(S, [{ x: 0.5, z: 3.0, yaw: 0 }, { x: 0.5, z: 5.4, yaw: 0 }], 1500);
  assertFluent("straight-file", S, r, 1);
  assert.ok(r.maxPenIdle <= 0.2, `straight-file: outside a crossing the pair only brushes (maxPen ${r.maxPenIdle.toFixed(3)})`);
  console.log("PASS straight-file");
}
{
  const S = [];
  for (let z = 0; z <= 30; z++) S.push([0, z]);
  const r = run(S, [{ x: 0.5, z: 3.0, yaw: 0 }, { x: 0.5, z: 5.4, yaw: 0 }], 300);
  console.log(`straight-file-open: crossTicks ${r.crossTicks} maxPenIdle ${r.maxPenIdle.toFixed(3)} | ${fmt(r)}`);
  assert.equal(r.crossTicks, 0, "straight-file-open: a file never crosses");
  assert.ok(r.maxPenIdle <= 0.2, `straight-file-open: the file keeps its spacing (maxPen ${r.maxPenIdle.toFixed(3)})`);
  r.R.forEach((q, i) => {
    assert.equal(q.offIdle, 0, `straight-file-open: mob ${i} left the centre line`);
    assert.ok(q.stillWorst <= 2, `straight-file-open: mob ${i} froze ${q.stillWorst} ticks`);
  });
  console.log("PASS straight-file-open");
}

// --- Junctions with three: a closed T and a closed crossroads, three
// rails meeting and U-turning at every arm end — nobody ever freezes.
for (const [label, cells, spawns] of [
  ["t-three", [[-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [0, 1], [0, 0], [0, -1]],
    [{ kind: "pig", x: -1.5, z: 2.5, yaw: Math.PI / 2 }, { kind: "pig", x: 2.5, z: 2.5, yaw: -Math.PI / 2 },
     { kind: "pig", x: 0.5, z: -0.5, yaw: 0 }]],
  ["cross-three", [[0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-2, 0], [-1, 0], [1, 0], [2, 0]],
    [{ kind: "cow", x: 0.5, z: -1.5, yaw: 0 }, { kind: "pig", x: 0.5, z: 2.5, yaw: Math.PI },
     { kind: "pig", x: -1.5, z: 0.5, yaw: Math.PI / 2 }]],
]) {
  const r = run(cells, spawns, 1800);
  console.log(`${label}: | ${fmt(r)}`);
  r.R.forEach((q, i) => {
    // Files keep their collisions: a follower may wait a beat behind a
    // leader rounding the junction (0.1 s), never longer.
    assert.ok(q.stillWorst <= 6, `${label}: mob ${i} froze ${q.stillWorst} ticks`);
    assert.ok(q.creep <= 30, `${label}: mob ${i} crept ${q.creep} ticks (stutter)`);
    assert.equal(q.wallDeep, 0, `${label}: mob ${i} body past the wall graze`);
    assert.ok(q.cells.size >= cells.length - 2, `${label}: mob ${i} visited ${q.cells.size}/${cells.length} cells`);
  });
  console.log(`PASS ${label}`);
}

// --- Keep-right magnitude: corridor half − hw + graze, any body size.
for (const kind of ["pig", "cow"]) {
  const m = makeMob(kind, 0.5, 0.5, 0, 1);
  assert.ok(Math.abs(railOff(m) - (0.5 - m.hw + 0.08)) < 1e-9, `${kind}: keep-right offset`);
}
console.log("PASS rail-offset");

// --- Out-of-reach invariance: a mate in another trench far away changes
// nothing — the rule only exists within body reach.
{
  const a = run(T3, [{ x: 0.5, z: 1.1, yaw: 0 }], 600);
  const b = run(T3, [{ x: 0.5, z: 1.1, yaw: 0 }, { x: 0.5, z: 31.1, yaw: 0, seed: 99 }], 600,
    [[0, 30], [0, 31], [0, 32]]);
  for (let t = 0; t < 600; t++) assert.equal(b.trace[t].split("|")[0], a.trace[t], `invariance: tick ${t} diverged`);
  assert.equal(b.crossTicks, 0, "invariance: a far rail never reads as a crossing");
  console.log("PASS out-of-reach-invariance");
}

console.log("passing.test.mjs: ALL PASS");
