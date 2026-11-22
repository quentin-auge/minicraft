// Step commits: a mob that sees a drop/jump ≤3 cells away in any of the
// 8 directions when it is free to choose (open roam decide, wall-follow
// budget exit, rail/mouth exit) can commit to taking it or ignore it
// (50/50, off the mob's own step rand stream). A drop straight ahead —
// the mob at the head of a flight — is not a draw at all: the descent
// direction is clear, so it is taken, and the standing offer (made before
// the servo, so a flight is walked instead of ridden as a 1-wide lane)
// never preempts a wall-follow ride, a latched plan or an entry commit.
// A commit faces the drop (perpendicular if straight, diagonal if corner)
// and walks it in a straight line, yellow while the step owns the mob
// (`?color=1`). Right after the drop, another drop/jump within 3 cells and
// ±90° of the facing re-commits automatically — straight and diagonal
// stairs walk with no re-facing (no parasite rotation); turning stairs
// re-face only where the stairs turn (a spiral tours its central column).
// With nothing left the commit drops and regular movement resumes. A
// blocked drop releases instead of grinding (the next decide re-offers).
// A lone drop into a pit never commits; neither does a +1 climb for
// walkers (stepUp 0 — no mob can jump).
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob } from "../../../src/mobs/mover.js";
import { NO_EXPIRY, aabbIntersectsSolid } from "../../../src/mobs/step.js";
import { scanStep, maybeStepCommit, STEP_CLEAR_TURN, STEP_CLEAR_DIST } from "../../../src/mobs/stairs.js";
import { wallQuitCommit } from "../../../src/mobs/roam.js";
import { assignNav, planPath } from "../../../src/mobs/nav.js";
import { createTarget } from "../../../src/mobs/targets.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const DT = 1 / 60;
const TOP = 4; // the platform level of the rigs (feet y=4)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The rig: a height map (cell -> surface y) over a platform.
function buildRig(heights, { floor = 1 } = {}) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  const cells = new Set();
  for (let x = -14; x <= 26; x++) for (let z = -14; z <= 14; z++) cells.add(`${x},${z}`);
  for (const k of Object.keys(heights)) cells.add(k);
  for (const k of cells) {
    const [x, z] = k.split(",").map(Number);
    const surf = heights[k] ?? floor;
    for (let y = surf - 1; y >= 0; y--) setBlock(x, y, z, STONE);
  }
}

function platform(x0, x1, z0, z1, h = TOP) {
  const out = {};
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out[`${x},${z}`] = h;
  return out;
}

function makeMob(x, y, z, yaw, rand = mulberry32(1), kind = "pig") {
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  return {
    type: kind, dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, stepUp: spec.stepUp ?? 0, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK, rand,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followRel: 0,
    turnHold: 0, entryScanT: 0, jrng: null, stepRng: null, stepping: false,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null, capabilities: { walk: true },
  };
}

// Drive a mob with a fixed far target; return the trace.
function run(mob, target, ticks = 400, peers = null) {
  const trace = [];
  for (let t = 0; t < ticks; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand, peers);
    trace.push({
      x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw,
      step: mob.roam?.step === true, stepping: mob.stepping === true,
      mode: mob.roam?.mode ?? "-",
    });
  }
  return trace;
}

const minY = (trace) => Math.min(...trace.map((p) => p.y));
const stepFrames = (trace) => trace.filter((p) => p.step);
// Largest single-tick turn while the step owns the mob: chaining must
// re-face, never pirouette.
function maxStepTurn(trace) {
  let worst = 0;
  for (let i = 1; i < trace.length; i++) {
    if (!trace[i].step) continue;
    let d = Math.abs(trace[i].yaw - trace[i - 1].yaw);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > worst) worst = d;
  }
  return worst;
}

// --- the scanner: eligible drops commit (50/50), flats/pits/climbs do not.
{
  // Flat ground has no drop.
  buildRig(platform(-14, 14, -14, 14), { floor: 1 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  assert.equal(scanStep(mob), null, "scan: flat ground has no drop");
  assert.equal(maybeStepCommit(mob, () => 0), false, "commit: flat ground never commits");
  assert.equal(mob.roam, null, "commit: flat ground leaves roam alone");
}
{
  // Three treads down, then the landing at the bottom level.
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  const found = scanStep(mob);
  assert.ok(found != null, "scan: a staircase ahead is found");
  assert.deepEqual([found.x, found.z, found.y], [3.5, 0.5, 3],
    "scan: the nearest drop reads its own centre and level");
  assert.ok(Math.abs(found.yaw - Math.PI / 2) < 1e-9, "scan: a straight drop faces straight");
  // The 50/50 draw: both outcomes happen (explicit step stream).
  const taker = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  taker.stepRng = () => 0;
  assert.equal(maybeStepCommit(taker, () => 0.999), true, "commit: the coin can land commit");
  assert.equal(taker.roam?.step, true, "commit: a step commit is installed");
  assert.deepEqual([taker.target.x, taker.target.z], [3.5, 0.5],
    "commit: the target is the landing cell");
  const ignorer = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  ignorer.stepRng = () => 0.999;
  assert.equal(maybeStepCommit(ignorer, () => 0), false, "commit: the coin can land ignore");
  assert.equal(ignorer.roam, null, "commit: ignore leaves roam alone");
}
{
  // A lone drop into a hole: no same-level continuation and no onward
  // drop, so it is a trap and never commits.
  const h = { ...platform(-14, 2, -14, 14), "3,0": 3, "3,1": 4, "3,-1": 4, "4,0": 4 };
  buildRig(h, { floor: 4 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.equal(scanStep(mob), null, "scan: a pit drop with no way on is refused");
  assert.equal(maybeStepCommit(mob, () => 0), false, "commit: a pit never commits");
}
{
  // A +1 wall with a landing on top: walkers (stepUp 0) never climb it.
  const h = { ...platform(-14, 2, -14, 14), "3,0": 5, "4,0": 5 };
  buildRig(h, { floor: 4 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.equal(scanStep(mob), null, "scan: a +1 wall is not a step for walkers");
  assert.equal(maybeStepCommit(mob, () => 0), false, "commit: walkers never climb");
}
{
  // A diagonal drop whose corner sticks up above the takeoff: the body
  // cannot sweep that corner, but the mob swings around it (the crossing
  // point) and drops onto the tread beyond — so the drop is offered with
  // its crossing point.
  const h = { ...platform(-14, 2, -14, 14), "1,0": 6, "1,1": 3, "2,2": 3 };
  buildRig(h, { floor: 4 });
  const mob = makeMob(0.5, TOP, 0.5, 0, mulberry32(7));
  mob.stepRng = () => 0;
  const found = scanStep(mob);
  assert.ok(found != null, "scan: a corner that can be swung around is walked");
  assert.ok(found.via != null, "scan: the drop carries its crossing point");
  assert.ok(Math.abs(found.via.z - 1) > 0.2, "scan: the crossing point clears the corner");
}
{
  // The same corner, but the swing has no room: the cell the mob would
  // swing through lies two levels below the takeoff, so the diagonal
  // stays refused (the body would grind into the corner).
  const h = { ...platform(-14, 2, -14, 14), "1,0": 6, "1,1": 3, "0,1": 2, "2,2": 3 };
  buildRig(h, { floor: 4 });
  const mob = makeMob(0.5, TOP, 0.5, 0, mulberry32(7));
  mob.stepRng = () => 0;
  assert.equal(scanStep(mob), null, "scan: a corner with no room to swing still blocks");
}
console.log("PASS scan");

// --- straight stairs: commit, walk straight down with no re-facing,
// yellow iff the step owns the mob, release at the bottom.
{
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(maybeStepCommit(mob, () => 0), "straight: the commit installs");
  assert.ok(Math.abs(mob.roam.heading - Math.PI / 2) < 1e-9, "straight: faces the drop");
  const target = { x: 20.5, z: 0.5 };
  const trace = run(mob, target, 900);
  assert.ok(trace.some((p) => p.step), "straight: the step commit walks the mob down");
  assert.ok(minY(trace) <= 1 + 1e-3, "straight: the mob reaches the bottom landing");
  const steps = stepFrames(trace);
  const dev = Math.max(...steps.map((p) => Math.abs(p.yaw - Math.PI / 2)));
  assert.ok(dev < 0.35, `straight: no re-facing mid-flight (max dev ${dev.toFixed(2)})`);
  assert.ok(trace.every((p) => p.stepping === p.step), "straight: yellow iff the step owns the mob");
  assert.ok(!trace[trace.length - 1].step, "straight: the commit releases at the bottom");
  assert.ok(trace[trace.length - 1].x > 10, "straight: regular movement walks on after release");
}
console.log("PASS straight");

// --- diagonal stairs: commit on the diagonal, walk it with no axis snap.
{
  const h = {};
  for (let x = -14; x <= 2; x++) for (let z = -14; z <= 2; z++) h[`${x},${z}`] = 4;
  h["3,3"] = 3; h["4,4"] = 2; h["5,5"] = 1; h["6,6"] = 1;
  for (let x = 6; x <= 18; x++) for (let z = 4; z <= 18; z++) if (h[`${x},${z}`] == null) h[`${x},${z}`] = 1;
  buildRig(h, { floor: 0 });
  const mob = makeMob(0.5, 4, 0.5, Math.PI / 4, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(maybeStepCommit(mob, () => 0), "diagonal: the commit installs");
  assert.ok(Math.abs(mob.roam.heading - Math.PI / 4) < 1e-9, "diagonal: faces the diagonal");
  const target = { x: 20.5, z: 20.5 };
  const trace = run(mob, target, 900);
  assert.ok(trace.some((p) => p.step), "diagonal: the step commit walks the mob down");
  assert.ok(minY(trace) <= 1 + 1e-3, "diagonal: the mob reaches the bottom landing");
  const steps = stepFrames(trace);
  const dev = Math.max(...steps.map((p) => Math.abs(p.yaw - Math.PI / 4)));
  assert.ok(dev < 0.35, `diagonal: no re-facing mid-flight (max dev ${dev.toFixed(2)})`);
  assert.ok(trace.every((p) => p.stepping === p.step), "diagonal: yellow iff the step owns the mob");
  assert.ok(!trace[trace.length - 1].step, "diagonal: the commit releases at the bottom");
}
console.log("PASS diagonal");

// --- chained flight: a straight run turning 90° chains on without a gap,
// even with hostile ambient draws (chaining never re-rolls).
{
  const h = {
    ...platform(-14, 2, -14, 6), "3,0": 3, "4,0": 2, "4,1": 1, "4,2": 1, "4,3": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(maybeStepCommit(mob, () => 0), "chain: the commit installs");
  const target = { x: 20.5, z: 0.5 };
  const trace = [];
  for (let t = 0; t < 900; t++) {
    tickFarmMob(mob, DT, () => target, () => 0.999);
    trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, yaw: mob.yaw, step: mob.roam?.step === true, stepping: mob.stepping === true });
  }
  assert.ok(trace.some((p) => p.step), "chain: the step commit walks");
  assert.ok(minY(trace) <= 1 + 1e-3, "chain: the mob walks both legs down");
  assert.ok(stepFrames(trace).length > 100, "chain: the commit holds across the turn");
  assert.ok(trace.every((p) => p.stepping === p.step), "chain: yellow iff the step drives");
  assert.ok(!trace[trace.length - 1].step, "chain: the commit releases at the end");
}
console.log("PASS chain");

// --- a drop behind the landing (>90° turn) is never chained onto: the
// mob walks on instead of U-turning.
{
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 2, "6,0": 2,
    "4,-1": 1,
  };
  buildRig(h, { floor: 2 });
  const mob = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(maybeStepCommit(mob, () => 0), "no-chase: the straight drop commits");
  const target = { x: 20.5, z: 0.5 };
  const trace = run(mob, target, 900);
  assert.ok(minY(trace) <= 2 + 1e-3, "no-chase: the flight walks down to the landing");
  assert.ok(!trace.some((p) => Math.floor(p.x) === 4 && Math.floor(p.z) === -1 && p.y < 1.9),
    "no-chase: the behind drop is never turned onto");
  assert.ok(trace[trace.length - 1].x > 6, "no-chase: the mob walks on instead of U-turning");
}
console.log("PASS no-chase");

// --- spiral (colimacon): a turning staircase tours the central column
// with no blocking, no freeze, no stutter — each ≤90° re-commit turns
// the walk, never the same tread twice.
{
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  const H = {};
  const put = (x, z, s) => { H[`${x},${z}`] = s; };
  for (let x = -6; x <= 0; x++) for (let z = -2; z <= 4; z++) put(x, z, 5);
  put(1, 0, 4); put(2, 0, 4);
  put(3, 0, 3); put(3, 1, 3);
  put(3, 2, 2); put(2, 2, 2);
  put(1, 2, 1); put(0, 2, 1); put(0, 3, 1);
  for (let x = -2; x <= 4; x++) for (let z = 2; z <= 6; z++) {
    if (H[`${x},${z}`] == null) H[`${x},${z}`] = 1;
  }
  for (const k of Object.keys(H)) {
    const [x, z] = k.split(",").map(Number);
    for (let y = H[k] - 1; y >= 0; y--) setBlock(x, y, z, STONE);
  }
  const mob = makeMob(0.5, 5, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(maybeStepCommit(mob, () => 0), "spiral: the commit installs at the lip");
  const target = { x: 20.5, z: 20.5 };
  const trace = run(mob, target, 1200);
  assert.ok(trace.some((p) => p.step), "spiral: the step commit walks");
  assert.ok(minY(trace) <= 1 + 1e-3, "spiral: the mob tours down to the bottom");
  assert.ok(stepFrames(trace).length > 100, "spiral: the commit holds through the turns");
  assert.ok(trace.every((p) => p.stepping === p.step), "spiral: yellow iff the step drives");
  assert.ok(!trace[trace.length - 1].step, "spiral: the commit releases at the bottom");
  assert.ok(maxStepTurn(trace) < 0.35, `spiral: no parasite rotation (worst tick ${maxStepTurn(trace).toFixed(2)})`);
}
console.log("PASS spiral");

// --- blocked drop: a peer parked on the tread holds the commit until the
// stall watchdog releases it — no grind, no burial, and the walk resumes
// once the tread clears.
{
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(maybeStepCommit(mob, () => 0), "stall: the commit installs");
  const peer = makeMob(4.5, 2, 0.5, -Math.PI / 2, mulberry32(9));
  peer.speed = 0;
  const target = { x: 20.5, z: 0.5 };
  let releases = 0, wasStep = true, buried = false, minY = 99;
  for (let t = 0; t < 1200; t++) {
    const peers = t < 300 ? [peer] : [];
    tickFarmMob(mob, DT, () => target, mob.rand, peers);
    const st = mob.roam?.step === true;
    if (wasStep && !st) releases++;
    wasStep = st;
    if (mob.pos.y < minY) minY = mob.pos.y;
    if (aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h)) buried = true;
  }
  assert.ok(releases >= 1, "stall: a blocked drop releases instead of grinding");
  assert.ok(!buried, "stall: the mob is never buried in the tread");
  assert.ok(minY <= 1 + 1e-3, "stall: the walk resumes and completes once the tread clears");
  assert.ok(!mob.roam?.step, "stall: the commit is released at the end");
}
console.log("PASS stall-release");

// --- wall-follow exits feed the step draw too.
{
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.ok(wallQuitCommit(mob, Math.PI / 2, mulberry32(3), () => ({ x: 9.5, z: 0.5 })),
    "wall-quit: the exit commits");
  assert.ok(mob.roam?.step === true, "wall-quit: a visible drop preempts the open commit");
  assert.equal(mob.lane, null, "wall-quit: the lane drops with the step commit");
  const ignorer = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(7));
  ignorer.stepRng = () => 0.999;
  assert.ok(wallQuitCommit(ignorer, Math.PI / 2, mulberry32(3), () => ({ x: 9.5, z: 0.5 })),
    "wall-quit: the exit still commits when the drop is ignored");
  assert.ok(!ignorer.roam?.step, "wall-quit: an ignore keeps the ordinary open commit");
}
console.log("PASS wall-quit");

// --- decide() offers drops to free roamers (and honours the ignore).
{
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(2));
  mob.stepRng = () => 0;
  const target = { x: 20.5, z: 0.5 };
  tickFarmMob(mob, DT, () => target, mob.rand);
  assert.ok(mob.roam !== undefined, "decide: roam state exists");
  assert.ok(mob.roam?.step === true, "decide: a free roamer facing stairs commits");
  const ignorer = makeMob(0.5, 4, 0.5, Math.PI / 2, mulberry32(2));
  ignorer.stepRng = () => 0.999;
  tickFarmMob(ignorer, DT, () => target, ignorer.rand);
  assert.ok(!ignorer.roam?.step, "decide: the ignore path keeps ordinary roam");
}
console.log("PASS decide");

// --- no step commit mid-air: falling mobs do not re-decide onto stairs.
{
  const h = {
    ...platform(-14, 2, -14, 14), "3,0": 3, "4,0": 2, "5,0": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, 10, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  assert.equal(maybeStepCommit(mob, () => 0), false, "commit: no step while airborne");
}
console.log("PASS no-step-midair");

// --- a clear drop straight ahead is taken without a coin: the mob is at
// the head of a flight, the descent direction is clear, so the staircase
// is walked (no turn, no parasite rotation, and the offer is never
// refused by the draw).
{
  const h = {
    ...platform(-14, 0, -14, 14), "1,0": 3, "1,1": 3, "2,0": 2, "2,1": 2, "3,0": 1, "3,1": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  // The draw refuses everything: a clear drop ignores it.
  mob.stepRng = () => 0.999;
  assert.ok(maybeStepCommit(mob, () => 0), "clear: the drop straight ahead is taken");
  assert.equal(mob.roam?.step, true, "clear: the commit is installed");
  // Farther away the same drop is a draw again (the mob may walk on).
  const far = makeMob(-1.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  far.stepRng = () => 0.999;
  const found = scanStep(far);
  assert.ok(found && found.d > STEP_CLEAR_DIST, "clear: a distant drop is not a clear offer");
  assert.equal(maybeStepCommit(far, () => 0), false, "clear: a distant drop keeps the draw");
  // The clear-only offer (the standing one, before the servo) takes the
  // head of the flight and refuses the rest.
  const head = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  assert.ok(maybeStepCommit(head, () => 0, true), "clear: the standing offer takes the head");
  const side = makeMob(0.5, TOP, -3.5, Math.PI / 2, mulberry32(7));
  assert.equal(maybeStepCommit(side, () => 0, true), false, "clear: the standing offer refuses an oblique drop");
}
console.log("PASS clear-drop");

// --- a regular flight (one tread per row, two wide): the descent is
// walked straight down — no left/right parasite turn at any tread — and
// the mob reaches the bottom.
{
  const h = {
    ...platform(-14, 0, -14, 14), "1,0": 3, "1,1": 3, "2,0": 2, "2,1": 2, "3,0": 1, "3,1": 1,
  };
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 2, mulberry32(7));
  const trace = run(mob, { x: 20.5, z: 0.5 }, 900);
  assert.ok(minY(trace) <= 1 + 1e-3, "flight: the mob reaches the bottom landing");
  const steps = stepFrames(trace);
  assert.ok(steps.length > 60, `flight: the commit owns the descent (${steps.length} frames)`);
  const dev = Math.max(...steps.map((p) => Math.abs(p.yaw - Math.PI / 2)));
  assert.ok(dev < 0.05, `flight: no parasite turn on any tread (max dev ${dev.toFixed(3)})`);
  const lat = Math.max(...steps.map((p) => Math.abs(p.z - 0.5)));
  assert.ok(lat < 0.35, `flight: the walk stays on its line (max ${lat.toFixed(2)})`);
}
console.log("PASS flight");

// --- an oblique flight: the same rule, walked along the diagonal. The
// treads are a continuous band (the surface steps down with x+z), never
// lone cells in a void — a lone tread is a pit and is never taken.
{
  const h = {};
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
    h[`${x},${z}`] = x < 0 || z < 0 ? TOP : (x + z >= 6 ? 1 : TOP - Math.floor((x + z) / 2));
  }
  buildRig(h, { floor: 1 });
  const mob = makeMob(0.5, TOP, 0.5, Math.PI / 4, mulberry32(7));
  const trace = run(mob, { x: 20.5, z: 20.5 }, 900);
  assert.ok(minY(trace) <= 1 + 1e-3, "oblique: the mob reaches the bottom landing");
  const steps = stepFrames(trace);
  assert.ok(steps.length > 60, `oblique: the commit owns the descent (${steps.length} frames)`);
  const dev = Math.max(...steps.map((p) => Math.abs(p.yaw - Math.PI / 4)));
  assert.ok(dev < 0.05, `oblique: no parasite turn on any tread (max dev ${dev.toFixed(3)})`);
}
console.log("PASS oblique-flight");

// --- the colimacon: a flight winding around a newel post. The yellow
// commit walks the whole spiral in one run, and the green plan walks it
// too — neither stalls on the post nor on a tread lip.
function spiralRig() {
  const H = {};
  const ring = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  ring.forEach((c, i) => { H[`${c[0]},${c[1]}`] = 8 - i; });
  H["2,0"] = 8; H["2,1"] = 8;
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    if (H[`${x},${z}`] == null) H[`${x},${z}`] = 1;
  }
  buildRig(H, { floor: 0 });
  for (let y = 0; y <= 8; y++) setBlock(0, y, 0, STONE);
}
{
  spiralRig();
  const mob = makeMob(1.5, 8, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  const trace = run(mob, { x: 20.5, z: 20.5 }, 1800);
  assert.ok(minY(trace) <= 1 + 1e-3, "spiral: the yellow commit reaches the bottom");
  const steps = stepFrames(trace);
  assert.ok(steps.length > 200, `spiral: the commit holds through the turns (${steps.length} frames)`);
  assert.ok(maxStepTurn(trace) < 0.35, `spiral: no parasite rotation (worst tick ${maxStepTurn(trace).toFixed(2)})`);
}
console.log("PASS spiral-commit");

{
  spiralRig();
  const mob = makeMob(1.5, 8, 0.5, Math.PI / 2, mulberry32(7));
  const plan = assignNav(mob, createTarget("block", { x: 2, y: 0, z: 2 }));
  assert.ok(plan != null, "spiral: the plan walks the spiral");
  assert.ok(plan.cells.some((c) => c.y < 6), "spiral: the plan descends");
  const trace = run(mob, { x: 20.5, z: 20.5 }, 1800);
  assert.ok(minY(trace) <= 1 + 1e-3, "spiral: the green plan reaches the bottom");
}
console.log("PASS spiral-plan");

// --- the pinwheel: the flight steps DIAGONALLY around a solid newel
// post (the shape a hand-built spiral staircase takes around its core).
// The body cannot sweep that corner, so the mob walks the crossing point
// clear of it and drops onto the tread beyond. Both the yellow commit and
// the green plan must walk it.
function pinwheelRig() {
  const H = {};
  // Two-deep treads around the newel post: the flight steps diagonally
  // from one tread to the next, and the cell it swings through (the
  // corner beside the post) stands at the tread's own level, so the body
  // can round the post the way a player does.
  const treads = [
    [[1, 0], [1, 1]], [[0, 1], [-1, 1]], [[-1, 0], [-1, -1]], [[0, -1], [1, -1]],
    [[2, -1], [2, -2]], [[2, 0], [3, 0]], [[2, 1], [2, 2]],
  ];
  treads.forEach((cells, i) => { for (const [x, z] of cells) H[`${x},${z}`] = 8 - i; });
  buildRig(H, { floor: 1 });
  // The newel post: solid at every level, the corner the flight turns on.
  for (let y = 0; y <= 9; y++) setBlock(0, y, 0, STONE);
}
{
  pinwheelRig();
  const mob = makeMob(1.5, 8, 0.5, Math.PI, mulberry32(7));
  mob.stepRng = () => 0;
  const trace = run(mob, { x: 2.5, z: -2.5 }, 1500);
  assert.ok(minY(trace) <= 1 + 1e-3, "pinwheel: the yellow commit walks the whole spiral");
  const steps = stepFrames(trace);
  assert.ok(steps.length > 200, `pinwheel: the commit owns the crossing (${steps.length} frames)`);
  assert.ok(maxStepTurn(trace) < 0.9, `pinwheel: the corners turn, they do not spin (${maxStepTurn(trace).toFixed(2)})`);
}
console.log("PASS pinwheel-commit");

{
  pinwheelRig();
  const mob = makeMob(1.5, 8, 0.5, Math.PI, mulberry32(7));
  const plan = assignNav(mob, createTarget("block", { x: 1, y: 4, z: -1 }));
  assert.ok(plan != null, "pinwheel: the plan walks the diagonal spiral");
  assert.ok(plan.cells.some((c) => c.y < 6), "pinwheel: the plan descends");
  const trace = run(mob, { x: 2.5, z: -2.5 }, 1500);
  assert.ok(minY(trace) <= 1 + 1e-3, "pinwheel: the green plan reaches the bottom");
}
console.log("PASS pinwheel-plan");

// --- a helix of single blocks (the hand-built staircase: one 1x1 pad per
// level, void all around). The snout hangs over the void on every step:
// the flight must still be walked.
function padHelixRig() {
  const helix = [
    [1, 0], [1, 1], [0, 1], [0, 0], [-1, 0], [-1, -1], [0, -1], [1, -1],
    [2, -1], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [-1, 2], [-2, 2],
    [-2, 1], [-2, 0], [-2, -1], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2],
  ];
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  helix.forEach(([x, z], i) => setBlock(x, 12 - i, z, STONE));
}
{
  padHelixRig();
  const mob = makeMob(1.5, 13, 0.5, 0, mulberry32(7));
  mob.stepRng = () => 0;
  const trace = run(mob, { x: 2.5, z: -2.5 }, 1500);
  assert.ok(minY(trace) <= 3 + 1e-3, "pads: the yellow commit walks the helix of single blocks");
  assert.ok(stepFrames(trace).length > 200, "pads: the commit owns the descent");
}
console.log("PASS pad-helix");

// --- the staircase shapes, built from a flight of treads: a straight run,
// a diagonal run, a run that turns 90°, and a spiral around a newel. Each
// one is walked by the yellow commit AND by the green plan.
function flightRig(treads) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (const [x, z, top] of treads) {
    for (let y = top - 1; y >= 0; y--) setBlock(x, y, z, STONE);
  }
  const lowest = Math.min(...treads.map((t) => t[2]));
  const floorY = lowest - 1;
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) setBlock(x, floorY, z, STONE);
  return floorY + 1;
}
function straightTreads(n, topY) {
  return Array.from({ length: n }, (_, i) => [i, 0, topY - i]);
}
function diagonalTreads(n, topY) {
  return Array.from({ length: n }, (_, i) => [i, i, topY - i]);
}
function turningTreads(leg, topY) {
  const out = [];
  for (let i = 0; i < leg; i++) out.push([i, 0, topY - i]);
  for (let i = 0; i < leg; i++) out.push([leg - 1, -1 - i, topY - leg - i]);
  return out;
}
function newelTreads(levels, topY) {
  const ring = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  return Array.from({ length: levels }, (_, i) => ring[i % 8].concat([topY - i]));
}

// The flight's head: the mob starts on the first tread.
function flightHead(treads) {
  const [x, z] = [treads[0][0], treads[0][1]];
  return [x + 0.5, treads[0][2], z + 0.5];
}

const FLIGHT_CASES = [
  { name: "straight", treads: () => straightTreads(8, 20) },
  { name: "diagonal", treads: () => diagonalTreads(8, 20) },
  { name: "turning", treads: () => turningTreads(4, 20) },
  { name: "newel", treads: () => newelTreads(8, 20) },
];
for (const c of FLIGHT_CASES) {
  // The yellow commit walks the flight down to the floor.
  const treads = c.treads();
  const floorTop = flightRig(treads);
  const [hx, hy, hz] = flightHead(treads);
  {
    const mob = makeMob(hx, hy, hz, 0, mulberry32(7));
    mob.stepRng = () => 0;
    const trace = run(mob, { x: 20.5, z: 20.5 }, 1800);
    assert.ok(minY(trace) <= floorTop + 1e-3,
      `${c.name}: the yellow commit walks the flight down (${minY(trace)} vs ${floorTop})`);
  }
  // The green plan walks it too, to a target on the floor.
  const treads2 = c.treads();
  const floorTop2 = flightRig(treads2);
  const [gx, gy, gz] = flightHead(treads2);
  {
    const mob = makeMob(gx, gy, gz, 0, mulberry32(7));
    const plan = assignNav(mob, createTarget("block", { x: 9, y: floorTop2 - 1, z: 9 }));
    assert.ok(plan != null, `${c.name}: the plan routes the flight`);
    const trace = run(mob, { x: 9.5, z: 9.5 }, 2400);
    assert.ok(minY(trace) <= floorTop2 + 1e-3,
      `${c.name}: the green plan walks the flight down (${minY(trace)} vs ${floorTop2})`);
  }
}
console.log("PASS flight-shapes");

// --- a flight whose LAST tread is a lone block reached after a 90° turn:
// the chain must still take it (the flight ends there by nature).
{
  const treads = [
    [0, 0, 20], [1, 0, 19], [2, 0, 18], [2, -1, 17],
  ];
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (const [x, z, top] of treads) for (let y = top - 1; y >= 0; y--) setBlock(x, y, z, STONE);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) setBlock(x, 0, z, STONE);
  // The mob stands on the last tread before the turn.
  const mob = makeMob(2.5, 18, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  const found = scanStep(mob, 3, Math.PI / 2, Math.PI / 2, true);
  assert.ok(found != null, "turn-end: the chain takes the flight's last tread");
  assert.equal(found.x, 2.5, "turn-end: the last tread is the one after the turn");
  assert.equal(found.z, -0.5, "turn-end: the last tread is the one after the turn");
}
console.log("PASS turn-end");

// --- the planner and the step scan AGREE: a plain diagonal staircase (no
// core in the corner) is offered by the scan and routed by the planner.
{
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  // Four diagonal treads, one level apart, then the floor they land on
  // (one level under the last tread: the flight lands on it).
  for (let i = 0; i < 4; i++) for (let y = 5 - i; y >= 0; y--) setBlock(i, y, i, STONE);
  for (let x = -4; x <= 10; x++) for (let z = -4; z <= 10; z++) setBlock(x, 1, z, STONE);
  const mob = makeMob(0.5, 6, 0.5, Math.PI / 4, mulberry32(7));
  const found = scanStep(mob);
  assert.ok(found != null, "agree: the scan offers the diagonal staircase");
  const plan = planPath(mob, createTarget("block", { x: 9, y: 1, z: 9 }));
  assert.ok(plan != null, "agree: the planner routes the diagonal staircase");
  const diag = plan.cells.some((c, i) => i > 0 && c.x !== plan.cells[i - 1].x && c.z !== plan.cells[i - 1].z);
  assert.ok(diag, "agree: the route steps diagonally");
}
console.log("PASS scan-plan-agree");

// --- the chain-built spiral (chain.js's chainSpiral footprint): the cursor
// is the CENTRE and it descends one level per call, each level stamping the
// centre plus a rotating skirt around it. The walkable surface therefore
// steps down around a central pillar, and both the yellow commit and the
// green plan must take it down.
function chainSpiralRig(levels = 16, topY = 24) {
  const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const PERPS = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  // The highest surface each cell ever gets.
  const surf = new Map();
  for (let i = 0; i < levels; i++) {
    const d = DIRS[i % 4], p = PERPS[i % 4];
    const y = topY - i;
    const cells = [[0, 0]];
    for (const o of [[d[0], d[1]], [d[0] * 2, d[1] * 2], [d[0] + p[0], d[1] + p[1]],
      [d[0] * 2 + p[0], d[1] * 2 + p[1]], [d[0] + p[0] * 2, d[1] + p[1] * 2],
      [d[0] * 2 + p[0] * 2, d[1] * 2 + p[1] * 2]]) cells.push([o[0], o[1]]);
    for (const [cx, cz] of cells) {
      const k = `${cx},${cz}`;
      if (!surf.has(k) || surf.get(k) < y) surf.set(k, y);
    }
  }
  let lowest = Infinity;
  for (const v of surf.values()) if (v < lowest) lowest = v;
  const floorY = lowest - 1;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) setBlock(x, floorY, z, STONE);
  for (const [k, y] of surf) {
    const [cx, cz] = k.split(",").map(Number);
    for (let b = y - 1; b >= floorY; b--) setBlock(cx, b, cz, STONE);
  }
  return { floorTop: floorY + 1, floorY, topY };
}
{
  const { floorTop, topY } = chainSpiralRig();
  // The mob starts on the top plate, off the central pillar.
  const mob = makeMob(2.5, topY, 0.5, 0, mulberry32(7));
  mob.stepRng = () => 0;
  const trace = run(mob, { x: 20.5, z: 20.5 }, 2400);
  assert.ok(minY(trace) <= floorTop + 1e-3,
    `chain-spiral: the yellow commit walks the chain spiral down (${minY(trace)} vs ${floorTop})`);
}
{
  const { floorTop, topY } = chainSpiralRig();
  const mob = makeMob(2.5, topY, 0.5, 0, mulberry32(7));
  const plan = assignNav(mob, createTarget("block", { x: 6, y: floorTop - 1, z: 6 }));
  assert.ok(plan != null, "chain-spiral: the plan routes the chain spiral");
  const trace = run(mob, { x: 6.5, z: 6.5 }, 2400);
  assert.ok(minY(trace) <= floorTop + 1e-3,
    `chain-spiral: the green plan walks the chain spiral down (${minY(trace)} vs ${floorTop})`);
}
console.log("PASS chain-spiral");

// --- the standing offer (made before the servo, so a flight is walked
// instead of ridden as a rail) takes a staircase head around a core: the
// mob is offered the diagonal drop, and it is taken without a coin.
{
  // A flight of diagonal treads (0,0)@6, (1,1)@5, (2,2)@4, with a
  // post at (1,0) standing above the takeoff: the drop at (1,1) is a
  // diagonal around a core.
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (const [x, z, top] of [[0, 0, 6], [1, 1, 5], [2, 2, 4]]) {
    for (let y = top - 1; y >= 0; y--) setBlock(x, y, z, STONE);
  }
  for (let y = 0; y <= 6; y++) setBlock(1, y, 0, STONE);
  const mob = makeMob(0.5, 6, 0.5, Math.PI / 4, mulberry32(7));
  // The step stream always refuses: the standing offer must not draw.
  mob.stepRng = () => 0.999;
  const found = scanStep(mob);
  assert.ok(found != null, "head: the staircase head is offered");
  assert.ok(found.via != null, "head: the head is a corner crossing");
  assert.ok(maybeStepCommit(mob, () => 0, true),
    "head: the standing offer takes the corner crossing without a coin");
  assert.ok(mob.roam?.step === true, "head: the commit owns the mob");
  assert.ok(mob.roam?.via != null, "head: the commit carries the crossing point");
}
console.log("PASS corner-head-offer");
