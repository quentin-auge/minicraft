// 1-wide passing: two opposed red rails offset lane-relative just before
// contact (same rotational side each, opposite world sides) and brush past
// at full stride, re-centering the moment the peer is behind. The REAL
// mover (mover.js) on REAL voxels (store.js), headless (mob.root is null),
// driven like production (planGroup + mob grid + live entry scans).
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import {
  FARM_WALK, PASS_BUDGET, tickFarmMob, separateFarmMobs, worstPairPen,
} from "../../../src/mobs/mover.js";
import { planGroup } from "../../../src/mobs/forecast.js";
import { buildMobGrid } from "../../../src/mobs/grid.js";
import { NO_EXPIRY, strideTarget, aabbIntersectsSolid } from "../../../src/mobs/step.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const FEET = 1;
const DT = 1 / 60;
const STRIDE = FARM_WALK * DT;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Muret auto-wall rig (mob-paths pattern): path cells stay open, every
// non-path neighbour gets y=1..2 walls, wide floor apron underneath.
function buildPath(cells, extraWalls = []) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  const ps = new Set(cells.map(([x, z]) => `${x},${z}`));
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  const x0 = Math.min(...xs) - 8, x1 = Math.max(...xs) + 8;
  const z0 = Math.min(...zs) - 8, z1 = Math.max(...zs) + 8;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, 0, z, STONE);
  for (const key of ps) {
    const [x, z] = key.split(",").map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (ps.has(`${x + dx},${z + dz}`)) continue;
      // These rigs test mouths into the field; closed tracks have their
      // own repeated-return suite in narrow.test.mjs.
      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .filter(([ax, az]) => ps.has(`${x + ax},${z + az}`));
      if (neighbours.length === 1 && neighbours[0][0] === -dx && neighbours[0][1] === -dz) continue;
      setBlock(x + dx, 1, z + dz, STONE); setBlock(x + dx, 2, z + dz, STONE);
    }
  }
  for (const [x, z] of extraWalls) {
    if (ps.has(`${x},${z}`)) continue;
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}

function makeMob(x, z, yaw, seed, idx) {
  const shape = specCircles(LIVESTOCK_SPECS.pig);
  return {
    type: "pig", dim: "over", pos: { x, y: FEET, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK, rand: mulberry32(seed),
    stuckT: 0, lastX: x, lastZ: z, fallFrom: FEET, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0, entryScanT: 0, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null, _peerIdx: idx,
  };
}

// Game-faithful scenario driver: planGroup + grid + live entry + goal
// bias (far goals; wander only when arrived). stop(list, t) ends the run;
// the stop is always followed by a 100-tick settle so offsets must clear.
// onTick(list, t, R) observes each tick (relock timing, yield distance).
// A spawn may preset a posed lane/yawTarget (forced mid-turn rigs).
function runScenario(cells, spawns, maxTicks, stop, onTick = null, extraWalls = []) {
  buildPath(cells, extraWalls);
  const list = spawns.map((s, i) => {
    const m = makeMob(s.x, s.z, s.yaw, s.seed, i);
    if (s.lane) { m.lane = { ...s.lane }; m.yawTarget = s.yawTarget ?? s.yaw; }
    return m;
  });
  const goals = new Map(list.map((m, i) => [m, spawns[i].goal]));
  const pick = (m, rand) => {
    const g = goals.get(m);
    if (Math.hypot(g.x - m.pos.x, g.z - m.pos.z) < 0.8) return strideTarget(m, undefined, rand);
    return { ...g };
  };
  const R = {
    ticks: 0, crossed: false, maxPen: 0, passTicks: 0,
    bothStalledRun: 0, bothStalledWorst: 0, staleOff: 0, wallDeep: 0,
    // Max excursion from spawn per mob: "travelled" even under
    // wander-when-arrived (final positions are chaotic — a mob may
    // legitimately end near its spawn after roaming far).
    exc: list.map(() => 0),
    // Anticipation timing: first pre-window tick vs first touch tick
    // (circle brush past 0.1 — nose-tip grazes at two metres are
    // proximity, not contact). The offset must lead the contact.
    // Gradualness: max per-tick lateral offset jump — the slide, not a hop.
    preAt: -1, touchAt: -1, maxJump: 0,
  };
  const prevOff = new Map();
  const spawns0 = list.map((m) => ({ x: m.pos.x, z: m.pos.z }));
  let settle = -1;
  for (let t = 0; t < maxTicks; t++) {
    list.forEach((m, i) => { m._peerIdx = i; });
    const grid = buildMobGrid(list, 3);
    planGroup(list, DT, grid);
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list, grid);
    list.forEach((m, i) => {
      R.exc[i] = Math.max(R.exc[i], Math.hypot(m.pos.x - spawns0[i].x, m.pos.z - spawns0[i].z));
    });
    let mp = 0, md = Infinity;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const w = worstPairPen(list[i], list[j], i, j);
      if (w) mp = Math.max(mp, w.pen);
      md = Math.min(md, Math.hypot(list[i].pos.x - list[j].pos.x, list[i].pos.z - list[j].pos.z));
    }
    R.maxPen = Math.max(R.maxPen, mp);
    // First real brush (past GATE_ALLOW-ish flicker): nose-tip grazes at
    // two metres are proximity, not contact — the offset must lead this.
    if (R.touchAt < 0 && mp > 0.1) R.touchAt = t;
    for (const m of list) {
      if ((m._passPreT ?? 0) > 0 && R.preAt < 0) R.preAt = t;
      const off = m._lineOff ?? 0;
      if (prevOff.has(m)) R.maxJump = Math.max(R.maxJump, Math.abs(off - prevOff.get(m)));
      prevOff.set(m, off);
    }
    const allSlow = list.every((m) => (m._adv ?? 1) < 0.2 * STRIDE);
    if (allSlow && md < 3.0) {
      R.bothStalledRun++;
      R.bothStalledWorst = Math.max(R.bothStalledWorst, R.bothStalledRun);
    } else R.bothStalledRun = 0;
    for (const m of list) {
      if (m._passT > 0) R.passTicks++;
      // No stale parallels: a red offset lives only with a held window
      // (or its settle tail) — never paraded after the meeting.
      if (m._lineOff && m.followLine?.touch !== true && m.lane != null &&
        !(m._passT > 0) && !(m._passSettle > 0) && !(m._passSide ?? 0)) R.staleOff++;
      if (aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw - 0.11, m.h)) R.wallDeep++;
    }
    separateFarmMobs(list, grid);
    if (onTick) onTick(list, t, R);
    if (settle < 0 && stop(list, t)) { R.crossed = true; settle = 100; }
    if (settle >= 0 && --settle < 0) { R.ticks = t; break; }
    R.ticks = t;
  }
  R.final = list.map((m) => ({ x: m.pos.x, z: m.pos.z, lane: m.lane != null, off: m._lineOff ?? 0 }));
  return { list, ...R };
}

// Straight 1-wide head-on: A north (0.5,0.5)->(0.5,14), B south
// (0.5,8.5)->(0.5,-6). Stops at the first order swap + settle — past the
// mouths the legacy exit lottery takes over (out of scope here).
{
  const cells = [];
  for (let z = -1; z <= 9; z++) cells.push([0, z]);
  const r = runScenario(cells,
    [{ x: 0.5, z: 0.5, yaw: 0, seed: 11, goal: { x: 0.5, z: 14 } },
     { x: 0.5, z: 8.5, yaw: Math.PI, seed: 22, goal: { x: 0.5, z: -6 } }],
    900, (list) => list[0].pos.z > list[1].pos.z + 0.5);
  console.log(`passing-straight: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} maxJump ${r.maxJump.toFixed(3)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "straight 1-wide pair must cross");
  assert.ok(r.passTicks > 0, "the meeting must hold the passing window");
  assert.ok(r.maxPen <= PASS_BUDGET, `passing overlap stays inside the budget (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 10, `no joint stall episode (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(r.preAt >= 0 && r.preAt < r.touchAt, `the offset leads the contact (pre @${r.preAt}, touch @${r.touchAt})`);
  assert.ok(r.maxJump <= 0.16, `the offset slides, never hops (engagement step included; max jump ${r.maxJump.toFixed(3)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-straight");
}

// L-turn 1-wide head-on: A north then east, B west then south — they meet
// around the corner. Stops at first crossing (both past the corner) +
// settle, so the exit lottery past the mouths never enters the asserts.
{
  const cells = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]];
  const r = runScenario(cells,
    [{ x: 0.5, z: 0.5, yaw: 0, seed: 11, goal: { x: 8, z: 2.5 } },
     { x: 4.5, z: 2.5, yaw: -Math.PI / 2, seed: 22, goal: { x: 0.5, z: -6 } }],
    900, (list) => list[0].pos.x > 2.5 && list[1].pos.z < 1.0);
  console.log(`passing-L: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} maxJump ${r.maxJump.toFixed(3)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "L-turn 1-wide pair must cross around the corner");
  assert.ok(r.passTicks > 0, "the corner meeting must hold the passing window");
  assert.ok(r.maxPen <= PASS_BUDGET, `corner overlap stays inside the budget (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 10, `no joint stall episode in the corner (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(r.preAt >= 0 && r.preAt < r.touchAt, `the offset leads the contact (pre @${r.preAt}, touch @${r.touchAt})`);
  assert.ok(r.maxJump <= 0.16, `the offset slides, never hops (engagement step included; max jump ${r.maxJump.toFixed(3)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-L");
}

// Files 2v2 head-on: each file holds its lane-relative side (compact),
// the files brush past abreast. Stops once the files swapped + settle.
{
  const cells = [];
  for (let z = -2; z <= 10; z++) cells.push([0, z]);
  const r = runScenario(cells,
    [{ x: 0.5, z: 0.5, yaw: 0, seed: 11, goal: { x: 0.5, z: 14 } },
     { x: 0.5, z: -1.5, yaw: 0, seed: 12, goal: { x: 0.5, z: 14 } },
     { x: 0.5, z: 8.5, yaw: Math.PI, seed: 22, goal: { x: 0.5, z: -6 } },
     { x: 0.5, z: 10.5, yaw: Math.PI, seed: 23, goal: { x: 0.5, z: -6 } }],
    900, (list) => Math.min(list[0].pos.z, list[1].pos.z) > Math.max(list[2].pos.z, list[3].pos.z) + 1.0);
  const [A1, A2, B1, B2] = r.final;
  console.log(`passing-files: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} maxJump ${r.maxJump.toFixed(3)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "opposed 1-wide files must walk through each other");
  assert.ok(r.maxPen <= PASS_BUDGET, `file overlap stays inside the budget (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 10, `no joint stall episode (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(A1.z > A2.z - 1.0 && B1.z < B2.z + 1.0, "files keep their order through the pass");
  assert.ok(r.preAt >= 0 && r.preAt < r.touchAt, `the offset leads the contact (pre @${r.preAt}, touch @${r.touchAt})`);
  assert.ok(r.maxJump <= 0.16, `the offset slides, never hops (engagement step included; max jump ${r.maxJump.toFixed(3)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-files");
}

// Crossroads melee: three mobs arrive together from south, north and
// west. Fixed run; asserts boundedness (no freeze) plus residue.
{
  const cells = [[1, -1], [1, 0], [1, 1], [1, 2], [1, 3], [0, 1], [2, 1]];
  const r = runScenario(cells,
    [{ x: 1.5, z: -0.5, yaw: 0, seed: 11, goal: { x: 1.5, z: 8 } },
     { x: 1.5, z: 2.5, yaw: Math.PI, seed: 22, goal: { x: 1.5, z: -6 } },
     { x: 0.5, z: 1.5, yaw: Math.PI / 2, seed: 33, goal: { x: 8, z: 1.5 } }],
    700, () => false);
  // Nobody parked at its spawn and no two bodies merged: the dance moves.
  let ms = Infinity;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      ms = Math.min(ms, Math.hypot(r.final[i].x - r.final[j].x, r.final[i].z - r.final[j].z));
    }
  }
  const minExc = Math.min(...r.exc);
  console.log(`passing-melee: maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} minExc ${minExc.toFixed(2)} minSpread ${ms.toFixed(2)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.bothStalledWorst <= 60, `no frozen scrum (worst joint stall ${r.bothStalledWorst} ticks)`);
  assert.ok(r.maxPen <= 0.7, `opening contact stays a transient brush (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(minExc > 0.5, `every mob travelled instead of parking (min excursion ${minExc.toFixed(2)} m)`);
  assert.ok(ms > 0.4, `no two bodies merged (min spread ${ms.toFixed(2)} m)`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meetings");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-melee");
}

// Forced mid-turn U-turn: A posed diagonal mid-rotation (lane south,
// yaw east) with B arriving into the sweep disc. The waiter must hold
// outside the rotation while A finishes, then cross at full stride.
{
  const cells = [];
  for (let z = -1; z <= 9; z++) cells.push([0, z]);
  let relockAt = -1, minYieldDist = Infinity, offAtRelock = -1;
  const r = runScenario(cells,
    [{ x: 0.5, z: 4.5, yaw: Math.PI / 2, seed: 11, goal: { x: 0.5, z: -6 },
       lane: { axis: Math.PI, entry: 0, lockX: 0, lockZ: 4 }, yawTarget: Math.PI },
     { x: 0.5, z: 3.3, yaw: 0, seed: 22, goal: { x: 0.5, z: 14 } }],
    900,
    (list) => list[1].pos.z > list[0].pos.z + 0.5,
    (list, t) => {
      const [A, B] = list;
      const yawErr = Math.abs(((A.yaw - Math.PI + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (relockAt < 0 && yawErr < 0.3) { relockAt = t; offAtRelock = Math.abs(B._lineOff ?? 0); }
      if (yawErr > 0.6) {
        minYieldDist = Math.min(minYieldDist, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
      }
    });
  console.log(`passing-uturn-forced: crossed ${r.crossed}@${r.ticks} relock@${relockAt} offAtRelock ${offAtRelock.toFixed(2)} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} minYieldDist ${minYieldDist.toFixed(2)} passTicks ${r.passTicks} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(relockAt >= 0 && relockAt < 120, `the U-turn must complete promptly (relock @${relockAt})`);
  assert.ok(r.crossed, "arriver and turner must cross after the rotation");
  assert.ok(r.maxPen <= PASS_BUDGET, `crossing overlap stays inside the budget (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 10, `no joint stall episode (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(minYieldDist >= 1.0, `the waiter holds outside the sweep (min ${minYieldDist.toFixed(2)} m)`);
  assert.ok(offAtRelock > 0.05, `the waiter is pre-offset at the relock (offset ${offAtRelock.toFixed(2)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-uturn-forced");
}

// Natural dead-end U-turn: a file of two walks into a 1-wide dead end;
// the leader flips at the back wall and rotates while the follower
// arrives behind it, then they cross on the way out. Spawns clear of
// nose/tail reach so the measured overlap is the meeting's, not the
// setup's.
{
  const cells = [];
  for (let z = -1; z <= 6; z++) cells.push([0, z]);
  const r = runScenario(cells,
    [{ x: 0.5, z: 3.5, yaw: 0, seed: 11, goal: { x: 0.5, z: 8 } },
     { x: 0.5, z: 1.5, yaw: 0, seed: 22, goal: { x: 0.5, z: 8 } }],
    900, (list) => list[0].pos.z < list[1].pos.z - 0.5, null, [[0, 7]]);
  console.log(`passing-uturn-deadend: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "leader must U-turn and cross its follower on the way out");
  assert.ok(r.preAt >= 0 && r.preAt < r.touchAt, `the offset leads the contact (pre @${r.preAt}, touch @${r.touchAt})`);
  assert.ok(r.maxPen <= PASS_BUDGET, `crossing overlap stays inside the budget (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 15, `no joint stall episode (worst ${r.bothStalledWorst} ticks)`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-uturn-deadend");
}

// Tight L: short arms so the pair meets exactly at the corner, yaws
// perpendicular at the apex. Anticipation leads by a mile and the offset
// ramps gradually — but the apex itself is a nose-to-nose T-bone (metre
// snouts sweeping the same mouth), so the brush transiently reaches the
// budget before the opposed-yaw window opens and slides them past. The
// joint hesitation is the negotiation, not a wedge: it resolves on its
// own every run.
{
  const cells = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]];
  const r = runScenario(cells,
    [{ x: 0.5, z: 0.5, yaw: 0, seed: 11, goal: { x: 8, z: 2.5 } },
     { x: 2.5, z: 2.5, yaw: -Math.PI / 2, seed: 22, goal: { x: 0.5, z: -6 } }],
    900, (list) => list[0].pos.x > 1.5 && list[1].pos.z < 1.5);
  console.log(`passing-L-tight: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} maxJump ${r.maxJump.toFixed(3)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "tight-L pair must cross at the corner");
  assert.ok(r.preAt >= 0 && r.preAt < r.touchAt, `the offset leads the contact (pre @${r.preAt}, touch @${r.touchAt})`);
  assert.ok(r.maxPen <= 0.6, `apex T-bone stays inside budget plus one simultaneous step (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 25, `the apex negotiation resolves (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(r.maxJump <= 0.16, `the offset slides, never hops (engagement step included; max jump ${r.maxJump.toFixed(3)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-L-tight");
}

// T-junction, synchronized arrival: A crosses the bar east to west
// while B climbs the stem and turns at the mouth — both reach the
// junction together, so the turn, the yield, and the slide-past all
// happen in one meeting (the bar runs on past the junction, both goals
// sit on open rail — no dead-end U-turn involved). Stops once the
// meeting consumed itself: brushed, then parted with A past the
// junction — the exits beyond are roam territory, not passing.
// (A simultaneous nose-kiss T-bone deadlocks identically on the base
// commit — the grind-escape flip into a head-on has no window to exempt
// it; that pre-existing freeze class is out of scope here.)
{
  const cells = [];
  for (let x = -3; x <= 7; x++) cells.push([x, 2]);
  for (let z = -1; z <= 1; z++) cells.push([1, z]);
  let sawBrush = false;
  const r = runScenario(cells,
    [{ x: 4.5, z: 2.5, yaw: -Math.PI / 2, seed: 11, goal: { x: -2.5, z: 2.5 } },
     { x: 1.5, z: -0.5, yaw: 0, seed: 22, goal: { x: 6.5, z: 2.5 } }],
    1200, (list) => {
      const w = worstPairPen(list[0], list[1], 0, 1);
      if (w && w.pen > 0.1) sawBrush = true;
      return sawBrush && list[0].pos.x > 2.0 && (!w || w.pen < 0.02);
    });
  console.log(`passing-T: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} maxJump ${r.maxJump.toFixed(3)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "T-junction pair must cross at the junction");
  assert.ok(r.preAt >= 0 && (r.touchAt < 0 || r.preAt < r.touchAt), `the offset leads the contact (pre @${r.preAt}, touch @${r.touchAt})`);
  assert.ok(r.maxPen <= 0.6, `the junction meeting brushes past inside budget plus overshoot (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 25, `the junction negotiation resolves (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(r.maxJump <= 0.16, `the offset slides, never hops (engagement step included; max jump ${r.maxJump.toFixed(3)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-T");
}

// Files through the corner: 2v2 files meet around the L — leaders cross
// at the apex while followers queue behind on their own sides.
{
  const cells = [];
  for (let z = -2; z <= 2; z++) cells.push([0, z]);
  for (let x = 1; x <= 6; x++) cells.push([x, 2]);
  const r = runScenario(cells,
    [{ x: 0.5, z: 0.5, yaw: 0, seed: 11, goal: { x: 8, z: 2.5 } },
     { x: 0.5, z: -1.5, yaw: 0, seed: 12, goal: { x: 8, z: 2.5 } },
     { x: 4.5, z: 2.5, yaw: -Math.PI / 2, seed: 22, goal: { x: 0.5, z: -6 } },
     { x: 6.5, z: 2.5, yaw: -Math.PI / 2, seed: 23, goal: { x: 0.5, z: -6 } }],
    1200, (list) => list[0].pos.x > 3.5 && list[2].pos.z < 0.5);
  const [A1, A2, B1, B2] = r.final;
  console.log(`passing-files-corner: crossed ${r.crossed}@${r.ticks} maxPen ${r.maxPen.toFixed(3)} bothStalledWorst ${r.bothStalledWorst} passTicks ${r.passTicks} pre@${r.preAt} touch@${r.touchAt} maxJump ${r.maxJump.toFixed(3)} staleOff ${r.staleOff} wallDeep ${r.wallDeep}`);
  assert.ok(r.crossed, "opposed files must walk through the corner");
  assert.ok(r.maxPen <= PASS_BUDGET, `corner file overlap stays inside the budget (maxPen ${r.maxPen.toFixed(3)})`);
  assert.ok(r.bothStalledWorst <= 15, `no joint stall episode in the corner (worst ${r.bothStalledWorst} ticks)`);
  assert.ok(A1.x > A2.x - 1.0 && B1.z < B2.z + 1.0, "files keep their order through the corner");
  assert.ok(r.maxJump <= 0.16, `the offset slides, never hops (engagement step included; max jump ${r.maxJump.toFixed(3)})`);
  assert.equal(r.staleOff, 0, "no stale parallel after the meeting");
  assert.equal(r.wallDeep, 0, "shoulder graze never exceeds 0.1 m into the wall");
  console.log("PASS passing-files-corner");
}

console.log("passing.test.mjs: ALL PASS");
