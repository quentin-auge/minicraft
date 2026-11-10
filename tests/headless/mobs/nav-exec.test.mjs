// Navigation execution: the real mover (mover.js) walking a planned path
// on real voxels. The planner only chooses where; the existing
// displacement primitives (open roam, wall-follow, 1-wide, 2-wide) do
// the walking. Rigs: open field, 1-wide L corridor, 2-wide doorway, and
// the refusal (no path -> the mob keeps walking free).
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid, separateFarmMobs } from "../../../src/mobs/mover.js";
import { NO_EXPIRY } from "../../../src/mobs/step.js";
import { assignNav, clearNav } from "../../../src/mobs/nav.js";
import { buildMobGrid } from "../../../src/mobs/grid.js";
import { planGroup } from "../../../src/mobs/forecast.js";
import { entryTick } from "../../../src/mobs/entry.js";
import { createTarget } from "../../../src/mobs/targets.js";
import { normYaw } from "../../../src/mobs/corridor.js";

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60;
const FEET = 1;
const CAPS = { walk: true };
// How far the real trajectory may stray from the planned line (the
// band the mover's plan veto holds: a ride that drifts further ends).
const PATH_DEV = 0.85;

function makeMob(x, y, z, yaw = 0, type = "pig") {
  const spec = LIVESTOCK_SPECS[type];
  const shape = specCircles(spec);
  return {
    type, dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0, entryScanT: 0, jrng: null, wallFollow: false, oneWide: false,
    tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
  };
}

function floor(x0, z0, x1, z1, y = 0) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, y, z, STONE);
}

function wall(x0, z0, x1, z1, y0 = 1, y1 = 2) {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) setBlock(x, y, z, STONE);
    }
  }
}

// 1-wide corridor: the listed cells walk, every neighbour is walled.
function buildCorridor(cells) {
  resetWorld("over");
  setDimension("over");
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  floor(Math.min(...xs) - 4, Math.min(...zs) - 4, Math.max(...xs) + 4, Math.max(...zs) + 4);
  const ps = new Set(cells.map(([x, z]) => `${x},${z}`));
  for (const [x, z] of cells) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (ps.has(`${x + dx},${z + dz}`)) continue;
      setBlock(x + dx, 1, z + dz, STONE);
      setBlock(x + dx, 2, z + dz, STONE);
    }
  }
}

// Run the real mover until the nav ends. Returns {ticks, picks, mob}.
// `picks` counts the random picker calls made while the nav was still
// active (the arrival tick resumes free roaming, so it is excluded).
function runNav(mob, maxTicks = 2000) {
  let picks = 0;
  let picksDuringNav = 0;
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const before = picks;
    tickFarmMob(mob, DT, (m) => {
      picks++;
      return { x: m.pos.x + 10, z: m.pos.z };
    });
    if (mob.nav) picksDuringNav += picks - before;
    if (!mob.nav) break;
  }
  return { ticks, picks: picksDuringNav, mob };
}

// Path fidelity: the real trajectory against the planned path. The mob's
// distance to the planned line, measured every tick, and whether it
// arrived at all (a give-up is a failure, not an arrival).
function runFidelity(mob, plan, maxTicks = 3000, seed = 1) {
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  let maxDev = 0;
  let ticks = 0;
  let rode = 0;
  let laned = 0;
  try {
    for (; ticks < maxTicks; ticks++) {
      tickFarmMob(mob, DT, (m) => ({ x: m.pos.x + 10, z: m.pos.z }));
      const d = pathDeviation(mob, plan);
      if (d > maxDev) maxDev = d;
      if (mob.followLine?.touch === true) rode++;
      if (mob.lane) laned++;
      if (!mob.nav) break;
    }
  } finally {
    Math.random = realRandom;
  }
  return { maxDev, ticks, rode, laned, arrived: !mob.nav };
}

function scriptRand(values) {
  let i = 0;
  const f = () => { f.calls++; return values[i++ % values.length]; };
  f.calls = 0;
  return f;
}

// The 1-wide mouth rig (a hole at (0,4) with two-cell banks beside it).
function buildMouthRig() {
  resetWorld("over");
  setDimension("over");
  for (let x = -6; x <= 6; x++) for (let z = -2; z <= 10; z++) setBlock(x, 0, z, STONE);
  for (const z of [4, 5, 6]) for (const x of [-1, 1]) {
    setBlock(x, 1, z, STONE);
    setBlock(x, 2, z, STONE);
  }
}

function assertClean(mob, label) {
  assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 0.92),
    `${label}: body in wall (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
}

// The mob stands on the target block: its centre is over the block, or —
// when the block sits at a corridor end, where the nose has nowhere to go
// — its body is over it and it is as close as it can get.
function onGoal(mob, goal, label) {
  const dx = mob.pos.x - (goal.x + 0.5);
  const dz = mob.pos.z - (goal.z + 0.5);
  const centred = Math.abs(dx) <= 0.5 && Math.abs(dz) <= 0.5;
  const pressed = Math.hypot(dx, dz) <= 0.82;
  assert.ok(centred || pressed,
    `${label}: stands on the target block (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
}

// Distance from the mob to the planned line: how far the real trajectory
// strays from the planned path.
function pathDeviation(mob, plan) {
  let m = Infinity;
  for (const c of plan.cells) {
    const d = Math.hypot(mob.pos.x - (c.x + 0.5), mob.pos.z - (c.z + 0.5));
    if (d < m) m = d;
  }
  return m;
}

// --- open field: the mob walks to the target block and stands on it ---
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 6, y: 0, z: 0 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(plan, "field: a path exists");
  const run = runNav(mob);
  assert.ok(run.ticks < 2000, "field: the nav ends");
  assert.equal(run.picks, 0, "field: the random picker never runs while navigating");
  assert.ok(Math.floor(mob.pos.x) === 6, `field: stands on the target block (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(Math.floor(mob.pos.z) === 0, `field: stands on the target block (z=${mob.pos.z.toFixed(2)})`);
  assertClean(mob, "field");
}

// --- a block lying on the ground: the mob comes beside it ---------------
// The block cannot be climbed, so the contact happens on a lateral face:
// the mob walks to the cell next to it and stops there.
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  setBlock(6, 1, 0, STONE);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 6, y: 1, z: 0 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(plan, "lying: a path exists");
  assert.equal(plan.goal.y, 1, "lying: the goal is at the block's level");
  const run = runNav(mob, 3000);
  assert.ok(run.ticks < 3000, "lying: the nav ends");
  assert.equal(Math.floor(mob.pos.y), 1, "lying: the mob stays on the ground");
  const cellDist = Math.abs(Math.floor(mob.pos.x) - 6) + Math.abs(Math.floor(mob.pos.z) - 0);
  assert.equal(cellDist, 1,
    `lying: the mob is beside the block (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
  assertClean(mob, "lying");
}

// Yaw-huntmeter: ticks run until the nav ends; every tick near the target
// counts heading flips (a left-right pirouette flips the yaw delta sign)
// and total rotation. Deterministic under the seeded random.
function runPressHunt(mob, maxTicks = 3000, seed = 1) {
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  let ticks = 0, flips = 0, lastW = 0, cumRot = 0, lastYaw = mob.yaw;
  try {
    for (; ticks < maxTicks; ticks++) {
      tickFarmMob(mob, DT, (m) => ({ x: m.pos.x + 10, z: m.pos.z }));
      const dy = normYaw(mob.yaw - lastYaw);
      lastYaw = mob.yaw;
      if (!mob.nav) break;
      cumRot += Math.abs(dy);
      const w = Math.sign(dy) || 0;
      if (w !== 0 && lastW !== 0 && w !== lastW) flips++;
      if (w !== 0) lastW = w;
    }
  } finally {
    Math.random = realRandom;
  }
  return { ticks, flips, cumRot, arrived: !mob.nav };
}

// --- long-nosed press at a ground block: no pirouette ---------------
// A cow's nose (0.81 + 0.28 reach) presses the block while its centre
// stands a hair outside the arrival square: the deflect used to flip
// sides every tick (181 flips, never arriving), the steady slide holds
// one side and walks into contact instead.
{
  resetWorld("over");
  setDimension("over");
  floor(-8, -8, 12, 12);
  setBlock(5, 1, 0, STONE);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2, "cow");
  const target = createTarget("block", { x: 5, y: 1, z: 0 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(plan, "press-side: a path exists");
  assert.equal(plan.tier, 1, "press-side: the block is reached from the side");
  const run = runPressHunt(mob);
  assert.ok(run.arrived, `press-side: the mob touches the block (${run.ticks} ticks)`);
  assert.ok(run.ticks < 600, `press-side: no stalled press (${run.ticks} ticks)`);
  assert.ok(run.flips <= 8, `press-side: no left-right hunt (${run.flips} flips)`);
  onGoal(mob, { x: 4, y: 1, z: 0 }, "press-side");
  assertClean(mob, "press-side");
}

// --- press at a corridor end: contact without room to slide ----------
// The same long nose in a 1-wide dead end facing the block: no sideways
// room exists, so no slide can walk the last hair — the nose pressed on
// the block with the body at the side goal counts as contact instead of
// stalling (or giving up) in front of it.
{
  resetWorld("over");
  setDimension("over");
  for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) setBlock(x, 0, z, STONE);
  for (let x = 0; x <= 5; x++) for (const z of [-1, 1]) {
    setBlock(x, 1, z, STONE);
    setBlock(x, 2, z, STONE);
  }
  setBlock(6, 1, 0, STONE);
  setBlock(6, 2, 0, STONE);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2, "cow");
  const target = createTarget("block", { x: 6, y: 1, z: 0 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(plan, "press-deadend: a path exists");
  assert.equal(plan.tier, 1, "press-deadend: the block is reached from the side");
  const run = runPressHunt(mob);
  assert.ok(run.arrived, `press-deadend: the mob touches the block (${run.ticks} ticks)`);
  assert.ok(run.ticks < 600, `press-deadend: no stalled press (${run.ticks} ticks)`);
  assert.ok(run.flips <= 8, `press-deadend: no left-right hunt (${run.flips} flips)`);
  onGoal(mob, { x: 5, y: 1, z: 0 }, "press-deadend");
  assertClean(mob, "press-deadend");
}

// --- a volume target: the mob walks into the volume --------------------
// The volume is a box of cells (the ground patch and the air above it);
// the mob lands on one of the ground cells inside it.
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const cells = [];
  for (let x = 6; x <= 7; x++) {
    for (let z = 0; z <= 1; z++) {
      cells.push({ x, y: 0, z });
      cells.push({ x, y: 1, z });
    }
  }
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("volume", { cells });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(plan, "volume: a path exists");
  const run = runNav(mob, 3000);
  assert.ok(run.ticks < 3000, "volume: the nav ends");
  assert.ok(mob.pos.x >= 6 && mob.pos.x < 8 && mob.pos.z >= 0 && mob.pos.z < 2,
    `volume: the mob is inside the volume (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
  assertClean(mob, "volume");
}

// --- 1-wide L corridor: the servo threads the corridor and turns ------
{
  const cells = [];
  for (let z = 0; z <= 6; z++) cells.push([0, z]);
  for (let x = 1; x <= 6; x++) cells.push([x, 6]);
  buildCorridor(cells);
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 6, y: 0, z: 6 });
  assert.ok(assignNav(mob, target, { capabilities: CAPS }), "corridor: a path exists");
  const run = runNav(mob, 3000);
  assert.ok(run.ticks < 3000, "corridor: the nav ends");
  assert.equal(run.picks, 0, "corridor: the random picker never runs while navigating");
  onGoal(mob, { x: 6, y: 0, z: 6 }, "corridor");
  assertClean(mob, "corridor");
}

// --- 2-wide doorway: the mob threads the gap without an entry commit --
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  wall(4, -4, 4, 4);
  setBlock(4, 1, 0, 0);
  setBlock(4, 2, 0, 0);
  setBlock(4, 1, 1, 0);
  setBlock(4, 2, 1, 0);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 7, y: 0, z: 0 });
  assert.ok(assignNav(mob, target, { capabilities: CAPS }), "doorway: a path exists");
  const run = runNav(mob, 3000);
  assert.ok(run.ticks < 3000, "doorway: the nav ends");
  assert.equal(run.picks, 0, "doorway: the random picker never runs while navigating");
  onGoal(mob, { x: 7, y: 0, z: 7 - 7 }, "doorway");
  assertClean(mob, "doorway");
}

// --- path fidelity: the real trajectory stays on the planned path -----
// The mob walks the planned line with the existing primitives (open
// roam, wall-follow, 1-wide, 2-wide), but the plan has the last word:
// the real path never strays further than PATH_DEV cells from it, and
// the mob always arrives.

// 1-wide corridor, the mob facing the WRONG way: the corridor servo must
// take the planned branch, not the one it faces.
{
  const cells = [];
  for (let z = 0; z <= 8; z++) cells.push([0, z]);
  buildCorridor(cells);
  const mob = makeMob(0.5, FEET, 4.5, Math.PI);
  const target = createTarget("block", { x: 0, y: 0, z: 8 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(plan, "wrong-yaw: a path exists");
  const run = runFidelity(mob, plan, 3000);
  assert.ok(run.arrived, `wrong-yaw: the mob arrives (${run.ticks} ticks)`);
  onGoal(mob, { x: 0, y: 0, z: 8 }, "wrong-yaw");
  assert.ok(run.maxDev <= PATH_DEV, `wrong-yaw: stays on the path (${run.maxDev.toFixed(2)})`);
  assertClean(mob, "wrong-yaw");
}

// The path runs beside a wall: the wall-follow ride must never capture
// the mob and carry it off the plan (every seed — the latch is a draw).
{
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    resetWorld("over");
    setDimension("over");
    floor(-6, -8, 10, 10);
    wall(1, 0, 6, 0);
    const mob = makeMob(2.5, FEET, -3.5, 0);
    const target = createTarget("block", { x: 2, y: 0, z: 5 });
    const plan = assignNav(mob, target, { capabilities: CAPS });
    assert.ok(plan, `beside-wall seed${seed}: a path exists`);
    const run = runFidelity(mob, plan, 2000, seed);
    assert.ok(run.arrived, `beside-wall seed${seed}: the mob arrives (${run.ticks} ticks)`);
    onGoal(mob, { x: 2, y: 0, z: 5 }, `beside-wall seed${seed}`);
    assert.ok(run.maxDev <= PATH_DEV, `beside-wall seed${seed}: stays on the path (${run.maxDev.toFixed(2)})`);
    assertClean(mob, `beside-wall seed${seed}`);
  }
}

// The open field and the 1-wide L corridor: the primitives follow the
// plan there too (the corridor ride hugs the wall, half a cell off the
// line — inside the tolerance).
{
  const cells = [];
  for (let z = 0; z <= 6; z++) cells.push([0, z]);
  for (let x = 1; x <= 6; x++) cells.push([x, 6]);
  buildCorridor(cells);
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 6, y: 0, z: 6 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  const run = runFidelity(mob, plan, 3000);
  assert.ok(run.arrived, "corridor-fidelity: the mob arrives");
  assert.ok(run.maxDev <= PATH_DEV, `corridor-fidelity: stays on the path (${run.maxDev.toFixed(2)})`);
}
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 6, y: 0, z: 0 });
  const plan = assignNav(mob, target, { capabilities: CAPS });
  const run = runFidelity(mob, plan, 2000);
  assert.ok(run.arrived, "field-fidelity: the mob arrives");
  assert.ok(run.maxDev <= PATH_DEV, `field-fidelity: stays on the path (${run.maxDev.toFixed(2)})`);
}

// The path runs straight along a wall: the wall-follow ride serves the
// plan there and is kept — the primitives still do the walking, the plan
// only vetoes them when they run against it.
{
  let rode = 0;
  for (const seed of [1, 2, 3, 4]) {
    resetWorld("over");
    setDimension("over");
    floor(-6, -8, 10, 10);
    wall(1, -6, 1, 6);
    const mob = makeMob(2.5, FEET, -3.5, 0);
    const target = createTarget("block", { x: 2, y: 0, z: 5 });
    const plan = assignNav(mob, target, { capabilities: CAPS });
    assert.ok(plan, `along-wall seed${seed}: a path exists`);
    const run = runFidelity(mob, plan, 2000, seed);
    assert.ok(run.arrived, `along-wall seed${seed}: the mob arrives (${run.ticks} ticks)`);
    assert.ok(run.maxDev <= PATH_DEV, `along-wall seed${seed}: stays on the path (${run.maxDev.toFixed(2)})`);
    rode += run.rode;
  }
  assert.ok(rode > 0, "along-wall: the wall-follow ride serves the plan");
}

// --- the mouth machinery serves the plan only --------------------------
// A mouth that lies on the planned path may be threaded (the 1-wide and
// 2-wide machinery drives it through); a mouth beside the plan never
// draws — the plan owns the goal.
{
  buildMouthRig();
  const mob = makeMob(0.5, FEET, 1.5, 0);
  const plan = assignNav(mob, createTarget("block", { x: 5, y: 0, z: 1 }), { capabilities: CAPS });
  assert.ok(plan, "gate: a path exists");
  mob.entryScanT = 0;
  const drew = entryTick(mob, DT, scriptRand([0.0]));
  assert.equal(drew, false, "gate: an off-path mouth never draws");
  assert.notEqual(mob.roam?.entry, true, "gate: no entry commit");
}
{
  buildMouthRig();
  const mob = makeMob(0.5, FEET, 1.5, 0);
  const plan = assignNav(mob, createTarget("block", { x: 0, y: 0, z: 8 }), { capabilities: CAPS });
  assert.ok(plan, "gate: a path exists");
  mob.entryScanT = 0;
  const drew = entryTick(mob, DT, scriptRand([0.0]));
  assert.ok(drew, "gate: an on-path mouth draws");
  assert.equal(mob.roam?.entry, true, "gate: the entry commit latches");
}

// --- the wall-follow ride serves the plan, and never carries it away ---
// The mob rides a wall the planned line runs beside; where the plan turns
// off the wall the ride ends there (the plan vetoes a rail that runs
// against it), and the mob keeps to the planned path the whole way.
{
  let rode = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    resetWorld("over");
    setDimension("over");
    floor(-4, -6, 12, 8);
    wall(1, 0, 8, 0);
    const mob = makeMob(2.5, FEET, 1.4, Math.PI / 2);
    const target = createTarget("block", { x: 9, y: 0, z: -3 });
    const plan = assignNav(mob, target, { capabilities: CAPS });
    assert.ok(plan, `ride seed${seed}: a path exists`);
    const realRandom = Math.random;
    Math.random = mulberry32(seed);
    let maxDev = 0;
    let rodeTicks = 0;
    let rodePastTurn = 0;
    let ticks = 0;
    try {
      for (; ticks < 2000; ticks++) {
        tickFarmMob(mob, DT, (m) => ({ x: m.pos.x + 10, z: m.pos.z }));
        if (mob.followLine?.touch === true) {
          rodeTicks++;
          if (mob.pos.x > 9.2) rodePastTurn++;
        }
        const d = pathDeviation(mob, plan);
        if (d > maxDev) maxDev = d;
        if (!mob.nav) break;
      }
    } finally {
      Math.random = realRandom;
    }
    assert.ok(ticks < 2000, `ride seed${seed}: the mob arrives (${ticks} ticks)`);
    assert.ok(maxDev <= PATH_DEV, `ride seed${seed}: stays on the path (${maxDev.toFixed(2)})`);
    assert.ok(rodePastTurn <= 10, `ride seed${seed}: the ride ends at the turn (${rodePastTurn} ticks past)`);
    onGoal(mob, { x: 9, y: 0, z: -3 }, `ride seed${seed}`);
    rode += rodeTicks;
  }
  assert.ok(rode > 0, "ride: the wall-follow ride was offered (and kept only where it serves the plan)");
}

// --- another mob in the path gives way ---------------------------------
// The planned mob holds its line; the peer meets it head-on and
// dodges aside (the plan is the top rank, so the peer yields).
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const lead = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const peer = makeMob(3.5, FEET, 0.5, Math.PI);
  const plan = assignNav(lead, createTarget("block", { x: 8, y: 0, z: 0 }), { capabilities: CAPS });
  assert.ok(plan, "peer: a path exists");
  const pick = (m) => (m === lead
    ? { x: lead.pos.x + 10, z: lead.pos.z }
    : { x: peer.pos.x - 10, z: peer.pos.z });
  const mobs = [lead, peer];
  const grid = buildMobGrid(mobs, 3);
  let maxDev = 0;
  let peerLateral = 0;
  let minDist = Infinity;
  for (let t = 0; t < 2000; t++) {
    planGroup(mobs, DT, grid);
    for (const m of mobs) tickFarmMob(m, DT, pick, Math.random, mobs, grid);
    separateFarmMobs(mobs, grid);
    let d = Infinity;
    for (const c of plan.cells) d = Math.min(d, Math.hypot(lead.pos.x - (c.x + 0.5), lead.pos.z - (c.z + 0.5)));
    if (d < Infinity) maxDev = Math.max(maxDev, d);
    // The peer gives way: it leaves the lead mob's line entirely.
    peerLateral = Math.max(peerLateral, Math.abs(peer.pos.z - 0.5));
    minDist = Math.min(minDist, Math.hypot(lead.pos.x - peer.pos.x, lead.pos.z - peer.pos.z));
    if (!lead.nav) break;
  }
  assert.equal(lead.nav, null, "peer: the lead mob arrives");
  onGoal(lead, { x: 8, y: 0, z: 0 }, "peer");
  assert.ok(maxDev <= PATH_DEV, `peer: stays on the path (${maxDev.toFixed(2)})`);
  assert.ok(peerLateral > 1.0, `peer: the peer gives way (off the line by ${peerLateral.toFixed(2)})`);
  assert.ok(minDist > 0.8, `peer: they never touch (closest ${minDist.toFixed(2)})`);
  assertClean(lead, "peer");
}

// --- an unanticipated block: the mob replans and arrives ---------------
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 10, y: 0, z: 0 });
  assert.ok(assignNav(mob, target, { capabilities: CAPS }), "added: a path exists");
  let added = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => ({ x: m.pos.x + 10, z: m.pos.z }));
    if (!added && mob.pos.x > 3) {
      added = true;
      for (let z = -3; z <= 3; z++) {
        setBlock(5, 1, z, STONE);
        setBlock(5, 2, z, STONE);
      }
    }
    if (!mob.nav) break;
  }
  assert.ok(added, "added: the block landed in front of the mob");
  assert.equal(mob.nav, null, "added: the nav ends");
  onGoal(mob, { x: 10, y: 0, z: 0 }, "added");
  assertClean(mob, "added");
}

// --- the blocked decision is fast ---------------------------------------
// A wall appears in front of the mob: the route stops advancing, and the
// mob decides (replans around it, or gives up) within a fraction of a
// second — it does not press against the wall for seconds.
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 10, y: 0, z: 0 });
  assert.ok(assignNav(mob, target, { capabilities: CAPS }), "fast: a path exists");
  let added = false;
  let pressed = -1;
  let decided = -1;
  let lastReplans = 0;
  let lastX = mob.pos.x;
  let still = 0;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => ({ x: m.pos.x + 10, z: m.pos.z }));
    if (mob.nav && mob.nav.replans !== lastReplans) {
      lastReplans = mob.nav.replans;
      if (added && decided < 0) decided = t;
    }
    if (!added && mob.pos.x > 3) {
      added = true;
      for (let z = -3; z <= 3; z++) {
        setBlock(5, 1, z, STONE);
        setBlock(5, 2, z, STONE);
      }
    }
    if (mob.pos.x - lastX < 1e-6) still++;
    else { still = 0; lastX = mob.pos.x; }
    if (added && pressed < 0 && still >= 5) pressed = t;
    if (!mob.nav) break;
  }
  assert.ok(pressed >= 0, "fast: the mob reached the wall");
  assert.ok(decided >= 0, "fast: the mob decided");
  assert.ok(decided - pressed <= 40,
    `fast: the decision comes fast (${((decided - pressed) / 60).toFixed(2)}s)`);
  onGoal(mob, { x: 10, y: 0, z: 0 }, "fast");
}

// --- no path anymore: the mob gives up ---------------------------------
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5, Math.PI / 2);
  const target = createTarget("block", { x: 10, y: 0, z: 0 });
  assert.ok(assignNav(mob, target, { capabilities: CAPS }), "sealed: a path exists");
  let sealed = false;
  let sealAt = -1;
  let gaveUp = -1;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => ({ x: m.pos.x + 10, z: m.pos.z }));
    if (!sealed && mob.pos.x > 3) {
      sealed = true;
      sealAt = t;
      // Box the target in: the goal cell is walled off, no route remains.
      for (const [bx, bz] of [[9, 0], [11, 0], [10, -1], [10, 1]]) {
        setBlock(bx, 1, bz, STONE);
        setBlock(bx, 2, bz, STONE);
      }
    }
    if (!mob.nav) { gaveUp = t; break; }
  }
  assert.ok(sealed, "sealed: the target was boxed in");
  assert.equal(mob.nav, null, "sealed: the mob gives up");
  assert.ok(gaveUp - sealAt <= 200, `sealed: the give-up comes fast (${((gaveUp - sealAt) / 60).toFixed(2)}s)`);
}

// --- refusal: no path leaves the mob walking free ---------------------
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 6, y: 40, z: 0 });
  assert.equal(assignNav(mob, target, { capabilities: CAPS }), null, "refusal: no path");
  assert.equal(mob.nav, null, "refusal: no nav state");
  let picks = 0;
  for (let t = 0; t < 30; t++) {
    tickFarmMob(mob, DT, (m) => { picks++; return { x: m.pos.x + 10, z: m.pos.z }; });
  }
  assert.ok(picks > 0, "refusal: the mob keeps walking free");
}

// --- clearing: an explicit clear drops the nav ------------------------
{
  resetWorld("over");
  setDimension("over");
  floor(-6, -6, 12, 12);
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 6, y: 0, z: 0 });
  assert.ok(assignNav(mob, target, { capabilities: CAPS }));
  clearNav(mob);
  assert.equal(mob.nav, null);
}

console.log("nav-exec.test.mjs: ALL PASS");
