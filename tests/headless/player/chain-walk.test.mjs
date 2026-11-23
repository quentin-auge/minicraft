import assert from "node:assert/strict";
import { lineStep, walkCells, strokeGatePass, hasSupport, cellPaintable } from "../../../src/core/gridwalk.js";

// Single steps follow the dominant ray axis.
assert.deepEqual(lineStep(0, 0, 0, 1, 0, 0), [1, 0, 0]);
assert.deepEqual(lineStep(0, 0, 0, -1, 0.1, 0), [-1, 0, 0]);
assert.deepEqual(lineStep(0, 0, 0, 0.1, 1, 0.1), [0, 1, 0]);
assert.deepEqual(lineStep(0, 0, 0, 0.1, -1, 0.1), [0, -1, 0]);
assert.deepEqual(lineStep(5, 5, 5, 0, 0, 0), null);

// Walks are contiguous, inclusive of the target, exclusive of the start.
const w = walkCells([0, 0, 0], [3, 1, 0], 64);
assert.equal(w.length > 0 && w.length <= 5, true);
assert.deepEqual(w[w.length - 1], [3, 1, 0]);
for (let i = 1; i < w.length; i++) {
  const d = Math.abs(w[i][0] - w[i - 1][0]) + Math.abs(w[i][1] - w[i - 1][1]) + Math.abs(w[i][2] - w[i - 1][2]);
  assert.equal(d, 1);
}
assert.deepEqual(walkCells([2, 2, 2], [2, 2, 2], 64), []);

// The cap bounds far-apart inputs: progressive growth, never a whole body.
const long = walkCells([0, 0, 0], [1000, 0, 0], 64);
assert.equal(long.length, 64);
assert.deepEqual(walkCells([0, 0, 0], [1, 0, 0], 0), []);
// Stroke gate: local history always passes; a body sample passes only on a
// body the stroke already touches (same-body continuation, no teleports).
assert.equal(strokeGatePass(true, null, new Set()), true);
assert.equal(strokeGatePass(true, "p0", new Set()), true);
assert.equal(strokeGatePass(false, "p0", new Set(["p0"])), true);
assert.equal(strokeGatePass(false, "p0", new Set(["moon"])), false);
assert.equal(strokeGatePass(false, "p0", new Set()), false);
assert.equal(strokeGatePass(false, null, new Set(["p0"])), false);
assert.equal(strokeGatePass(false, undefined, new Set(["p0"])), false);
// Paint support: bare void never holds a walk cell; any non-air 6-neighbour
// (solid or liquid — diagonally touching doesn't count) does.
{
  const AIR = 0, ROCK = 1, WATER = 2;
  const world = new Map();
  const get = (x, y, z) => world.get(x + "," + y + "," + z) ?? AIR;
  world.set("1,0,0", ROCK);
  assert.equal(hasSupport(get, 0, 0, 0), true);
  world.delete("1,0,0");
  world.set("0,1,0", WATER);
  assert.equal(hasSupport(get, 0, 0, 0), true);
  world.delete("0,1,0");
  assert.equal(hasSupport(get, 0, 0, 0), false);
  world.set("1,1,0", ROCK);
  assert.equal(hasSupport(get, 0, 0, 0), false);
}
// Paint gate: handled/supported always pass; the body-volume clause only
// applies while the body is unbuilt (built bodies answer from voxels).
{
  const touched = new Set(["p0"]);
  assert.equal(cellPaintable(true, null, true, touched, false), true);
  assert.equal(cellPaintable(false, null, true, touched, false), false);
  assert.equal(cellPaintable(false, "p0", false, touched, false), true);
  assert.equal(cellPaintable(false, "p0", true, touched, false), false);
  assert.equal(cellPaintable(false, "p1", false, touched, false), false);
  assert.equal(cellPaintable(false, null, false, touched, false), false);
  assert.equal(cellPaintable(false, null, true, touched, true), true);
}
console.log("PASS chain walk");
