// Navigation planner: cell A* over live voxels. Three-free (the store
// only), node direct. Covers the shortest path, obstacle detours, the
// 1-wide corridor shape, the walker's limits (no step up, at most
// maxDrop down), the no-path refusal, and determinism.
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import {
  planPath, assignNav, clearNav, pickStrategy, registerTraversalStrategy, NAV_MAX_GOALS,
} from "../../../src/mobs/nav.js";
import { createTarget } from "../../../src/mobs/targets.js";
import { diagonalSweepFree } from "../../../src/mobs/step.js";

const CAPS = { walk: true };
const FEET = 1;

function makeMob(x, y, z, yaw = 0) {
  const spec = LIVESTOCK_SPECS.pig;
  const shape = specCircles(spec);
  return {
    type: "pig", dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    floatCapable: true,
    yaw, yawTarget: yaw, target: null, wanderT: 0,
    speed: 1, stuckT: 0, lastX: x, lastZ: z, fallFrom: y,
    lane: null, servoStall: 0, blendFrom: null, blendT: 0,
    roam: null, followLine: null, followCool: 0, turnHold: 0,
    entryScanT: 0, jrng: null, wallFollow: false, oneWide: false,
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

function plan(mob, target) {
  return planPath(mob, target, { capabilities: CAPS });
}

function cellNames(cells) {
  return cells.map((c) => `${c.x},${c.y},${c.z}`);
}

// --- strategy registry -------------------------------------------------
assert.ok(pickStrategy({ walk: true }), "walk capability picks the ground strategy");
assert.equal(pickStrategy({ walk: false }), null, "no walk capability: no strategy");
assert.equal(pickStrategy({}), null);
registerTraversalStrategy({
  key: "test-fly",
  capabilities: ["fly"],
  // A 3D strategy: the mob moves through the air, so its path is drawn
  // as cubes, not floor squares.
  moves3D: true,
  neighbors: () => [],
});
assert.ok(pickStrategy({ walk: true, fly: true }), "first registered strategy wins");
// The strategy says how the mob moves: the ground walk is flat, a 3D
// strategy says otherwise.
assert.equal(pickStrategy({ walk: true }).moves3D, false, "the ground walk is flat");
assert.equal(pickStrategy({ fly: true }).moves3D, true, "the 3D strategy moves in 3D");

// --- straight: the shortest walk ---------------------------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 5, y: 0, z: 0 });
  const p = plan(mob, target);
  assert.ok(p, "straight: a path exists");
  assert.deepEqual(p.goal, { x: 5, y: 1, z: 0 }, "straight: goal is the cell on top of the block");
  assert.deepEqual(p.cells[0], { x: 0, y: 1, z: 0 }, "straight: starts at the mob's cell");
  assert.deepEqual(p.cells[p.cells.length - 1], { x: 5, y: 1, z: 0 });
  assert.equal(p.moves3D, false, "straight: the ground walk plans a flat path");
  // 5 cells across with diagonals allowed: 6 nodes.
  assert.equal(p.cells.length, 6, `straight: shortest path (${p.cells.length} nodes)`);
}

// --- a block lying on the ground: the mob comes beside it ---------------
// The top of the block is a step up, which a walker cannot climb, so the
// contact happens on a lateral face instead.
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
setBlock(5, 1, 0, STONE);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 5, y: 1, z: 0 });
  const p = plan(mob, target);
  assert.ok(p, "lying: a path exists");
  assert.equal(p.goal.y, 1, "lying: the goal is at the block's level");
  assert.notDeepEqual(p.goal, { x: 5, y: 2, z: 0 }, "lying: not on top of the block");
  assert.equal(Math.abs(p.goal.x - 5) + Math.abs(p.goal.z - 0), 1,
    "lying: the goal is a lateral cell of the block");
}
// The top tier is tried first: a block flush with the ground is stood on.
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const flush = createTarget("block", { x: 5, y: 0, z: 0 });
  const q = plan(mob, flush);
  assert.ok(q, "flush: a path exists");
  assert.deepEqual(q.goal, { x: 5, y: 1, z: 0 }, "flush: the mob stands on the block");
}

// --- obstacle: the detour goes through the only gap --------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
wall(3, -6, 3, 6, 1, 2);
setBlock(3, 1, 2, 0); // the gap (one cell wide)
setBlock(3, 2, 2, 0);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 6, y: 0, z: 0 });
  const p = plan(mob, target);
  assert.ok(p, "obstacle: a path exists");
  const names = cellNames(p.cells);
  assert.ok(names.includes("3,1,2"), `obstacle: the path uses the gap (${names.join(" ")})`);
  assert.ok(!names.some((n) => n.startsWith("3,1,0")), "obstacle: no wall cell");
}

// --- 1-wide corridor: the path stays cardinal --------------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
wall(-1, 0, -1, 6);
wall(1, 0, 1, 6);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 0, y: 0, z: 6 });
  const p = plan(mob, target);
  assert.ok(p, "corridor: a path exists");
  for (let i = 1; i < p.cells.length; i++) {
    const a = p.cells[i - 1], b = p.cells[i];
    const step = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
    assert.equal(step, 1, `corridor: cardinal steps only (${a.x},${a.z} -> ${b.x},${b.z})`);
  }
  assert.deepEqual(p.goal, { x: 0, y: 1, z: 6 });
}

// --- no path: a sealed chamber -----------------------------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
wall(3, -1, 3, 3);
wall(7, -1, 7, 3);
wall(4, -1, 6, -1);
wall(4, 3, 6, 3);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 5, y: 0, z: 1 });
  assert.equal(plan(mob, target), null, "sealed: no path");
}

// --- no step up: a ledge the walker cannot climb -----------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
wall(3, -6, 3, 10, 1, 1);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 5, y: 0, z: 0 });
  assert.equal(plan(mob, target), null, "ledge: no path for a walker");
}

// --- drop limit: a two-block drop is an air wall -----------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
for (let x = -6; x <= 0; x++) for (let z = -6; z <= 6; z++) {
  setBlock(x, 1, z, STONE);
  setBlock(x, 2, z, STONE);
}
{
  const mob = makeMob(-3.5, 3, 0.5);
  const target = createTarget("block", { x: 5, y: 0, z: 0 });
  assert.equal(plan(mob, target), null, "drop: two blocks down is a wall");
}

// --- a huge target: only the nearest goals are planned ------------------
// The goal set is read per expanded node, so an enormous target would
// make the search explode: the plan keeps the goals nearest the mob.
{
  resetWorld("over");
  setDimension("over");
  floor(-10, -10, 230, 230);
  const cells = [];
  for (let x = 20; x < 220; x++) {
    for (let z = 20; z < 220; z++) cells.push({ x, y: 0, z });
  }
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("volume", { cells });
  const p = plan(mob, target);
  assert.ok(p, "huge: a path exists");
  assert.ok(p.goalCells.length <= NAV_MAX_GOALS, `huge: the goals are capped (${p.goalCells.length})`);
  assert.ok(p.goalCells.length < cells.length, "huge: the cap kicked in");
  // The kept goals are the ones nearest the mob: the far corner of the
  // target is dropped, the near one is kept.
  let maxGoal = 0;
  for (const g of p.goalCells) maxGoal = Math.max(maxGoal, Math.hypot(g.x - 0.5, g.z - 0.5));
  const maxTarget = Math.hypot(219 - 0.5, 219 - 0.5);
  assert.ok(maxGoal < maxTarget, `huge: the far goals are dropped (${maxGoal.toFixed(0)})`);
  let minGoal = Infinity;
  for (const g of p.goalCells) minGoal = Math.min(minGoal, Math.hypot(g.x - 0.5, g.z - 0.5));
  assert.ok(minGoal < 40, `huge: the near goals are kept (${minGoal.toFixed(0)})`);
}

// --- diagonal sweep: a 2-square diagonal of the green path only with
// no solid in the square of the diagonal --------------------------------
// A 1-wide column rising through the swept band beside lower treads: the
// old plan cut the corner (0,0,5)->(1,1,4) straight through the column
// flank and the mob wedged on it. The sweep veto routes around it.
resetWorld("over");
setDimension("over");
for (const [x, z, s] of [[0, 0, 5], [0, 1, 5], [1, 0, 5], [1, 1, 4], [2, 1, 4], [3, 1, 4]]) {
  for (let y = s - 1; y >= 0; y--) setBlock(x, y, z, STONE);
}
{
  const mob = makeMob(0.5, 5, 0.5);
  // The corner-cutting diagonal is refused: the column flank stands in
  // the swept band.
  assert.equal(diagonalSweepFree(mob, 0, 0, 5, 1, 1, 4), false,
    "sweep: the diagonal through the column flank is refused");
  // Void corners never block: open ground stays diagonal.
  assert.equal(diagonalSweepFree(mob, 10, 10, 1, 11, 11, 1), true,
    "sweep: an open diagonal stays legal");
  const target = createTarget("block", { x: 2, y: 3, z: 1 });
  const p = plan(mob, target);
  assert.ok(p, "sweep: a path exists around the column");
  assert.deepEqual(cellNames(p.cells), ["0,5,0", "1,5,0", "1,4,1", "2,4,1"],
    "sweep: the plan walks around the column, never through its flank");
  for (let i = 1; i < p.cells.length; i++) {
    const a = p.cells[i - 1], b = p.cells[i];
    if (Math.abs(b.x - a.x) === 1 && Math.abs(b.z - a.z) === 1) {
      assert.ok(diagonalSweepFree(mob, a.x, a.z, a.y, b.x, b.z, b.y),
        `sweep: diagonal ${a.x},${a.z}->${b.x},${b.z} clears the corner squares`);
    }
  }
}

// --- determinism -------------------------------------------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
wall(3, -6, 3, 6, 1, 2);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 7, y: 0, z: 1 });
  const a = plan(mob, target);
  const b = plan(mob, target);
  assert.deepEqual(cellNames(a.cells), cellNames(b.cells), "determinism: same path twice");
}

// --- assignment: the plan latches on the mob --------------------------
resetWorld("over");
setDimension("over");
floor(-6, -6, 10, 10);
{
  const mob = makeMob(0.5, FEET, 0.5);
  const target = createTarget("block", { x: 4, y: 0, z: 0 });
  const p = assignNav(mob, target, { capabilities: CAPS });
  assert.ok(p, "assign: a path exists");
  assert.ok(mob.nav, "assign: the nav state latches");
  assert.equal(mob.nav.path.length, p.cells.length);
  clearNav(mob);
  assert.equal(mob.nav, null, "clear: the nav state drops");
  // No path: the assignment refuses and leaves no nav state behind.
  const sealed = createTarget("block", { x: 4, y: 40, z: 0 });
  assert.equal(assignNav(mob, sealed, { capabilities: CAPS }), null, "assign: refused");
  assert.equal(mob.nav, null, "assign: refusal leaves no nav state");
  // No walk capability: no strategy, no path.
  assert.equal(assignNav(mob, target, { capabilities: {} }), null, "assign: no strategy, no path");
}

// --- a staircase: the plan descends the treads, and a mob at a tread
// lip still plans (its centre hangs over the next cell while the feet
// stand on the tread behind — the plan starts from the cell that holds
// it up, never from thin air).
{
  resetWorld("over");
  setDimension("over");
  // A flight: the platform at 4, then treads at 3, 2 and 1.
  for (let x = -6; x <= 10; x++) for (let z = -6; z <= 10; z++) {
    const h = x <= 0 ? 4 : x === 1 ? 3 : x === 2 ? 2 : 1;
    for (let y = 0; y < h; y++) setBlock(x, y, z, STONE);
  }
  const mob = makeMob(0.5, 4, 0.5);
  const target = createTarget("block", { x: 6, y: 0, z: 0 });
  const p = plan(mob, target);
  assert.ok(p, "stair: the plan descends the flight");
  const levels = p.cells.map((c) => c.y);
  assert.ok(Math.min(...levels) < 4, `stair: the plan goes down (${Math.min(...levels)})`);
  // A mob straddling the lip of the first tread: the centre already
  // hangs over the lower cell, the feet still stand on the tread.
  const lip = makeMob(1.05, 4, 0.5);
  const p2 = plan(lip, target);
  assert.ok(p2, "stair: a mob at a tread lip still plans");
  assert.equal(p2.cells[0].y, 4, "stair: the plan starts from the tread that supports the mob");
}
console.log("nav.test.mjs: PASS stair-plan");

console.log("nav.test.mjs: ALL PASS");
