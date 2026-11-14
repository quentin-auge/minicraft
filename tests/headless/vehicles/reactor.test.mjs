// Reactor setup and nozzle merge rule, three-free, node direct.
import assert from "node:assert/strict";
import {
  ROCKET_FX_DEFAULT_DIAMETER,
  ROCKET_FX_DEFAULT_DEPTH,
  ROCKET_FX_DEFAULT_MERGE,
} from "../../../src/fx/rocketfx.js";
import { mergeReactors, REACTOR_SETUP } from "../../../src/vehicles/reactors.js";

// Four corner nozzles of an w x d footprint (cell centres), just under the
// hull. The rule works in world coordinates, so the origin is arbitrary.
function corners(w, d, ox = 0, oz = 0) {
  const x0 = ox, x1 = ox + w - 1;
  const z0 = oz, z1 = oz + d - 1;
  return [
    [x0 + 0.5, -0.15, z0 + 0.5],
    [x1 + 0.5, -0.15, z0 + 0.5],
    [x0 + 0.5, -0.15, z1 + 0.5],
    [x1 + 0.5, -0.15, z1 + 0.5],
  ];
}
const bounds = (w, d, ox = 0, oz = 0) => ({ x0: ox, x1: ox + w - 1, z0: oz, z1: oz + d - 1 });
const close = (a, b) => Math.abs(a - b) < 1e-9;

// --- the merge rule --------------------------------------------------------
{
  // A single cube: the four coincident corners become one nozzle.
  const one = mergeReactors(corners(1, 1), bounds(1, 1), 1);
  assert.equal(one.length, 1, "a 1x1 hull keeps one reactor");
  assert.ok(close(one[0][0], 0.5) && close(one[0][2], 0.5), "the merged reactor sits at the middle");

  // 2x2: four reactors at n=1, one at n=2.
  assert.equal(mergeReactors(corners(2, 2), bounds(2, 2), 1).length, 4, "n=1 leaves a 2x2 hull alone");
  const two = mergeReactors(corners(2, 2), bounds(2, 2), 2);
  assert.equal(two.length, 1, "n=2 merges a 2x2 hull to one");
  assert.ok(close(two[0][0], 1.0) && close(two[0][2], 1.0), "the merged reactor sits between the cells");

  // 3x7 at n=3: the x axis collapses, z keeps both rows.
  const split = mergeReactors(corners(3, 7), bounds(3, 7), 3);
  assert.equal(split.length, 2, "only the thin axis merges");
  assert.deepEqual(split.map((n) => n[2]), [0.5, 6.5], "the long axis keeps its reactor rows");
  assert.ok(split.every((n) => close(n[0], 1.5)), "the thin axis reads at its middle");

  // The pad rocket is 7x7: none of 1..6 merges it.
  for (let n = 1; n <= 6; n++) {
    assert.equal(mergeReactors(corners(7, 7), bounds(7, 7), n).length, 4, `n=${n} leaves a 7x7 hull alone`);
  }

  // Dedupe is positional: identical points merge, stacked ones stay.
  const dup = [[1, 2, 3], [1, 2, 3], [1, 4, 3]];
  assert.equal(mergeReactors(dup, bounds(1, 1, 0.5, 2.5), 1).length, 2, "same x/z at different y stay distinct");

  // A lone off-centre reactor on a thin axis moves to that axis' middle.
  const lone = mergeReactors([[0.5, 0, 0.5]], bounds(2, 2), 2);
  assert.deepEqual(lone, [[1.0, 0, 1.0]], "a thin hull centres its lone reactor too");

  // Thresholds below 1 leave the list untouched.
  const raw = corners(2, 2);
  assert.equal(mergeReactors(raw, bounds(2, 2), 0), raw, "threshold 0 leaves the list untouched");
}

// --- the shipped setup ---------------------------------------------------
{
  assert.deepEqual(REACTOR_SETUP, {
    diameter: ROCKET_FX_DEFAULT_DIAMETER,
    depth: ROCKET_FX_DEFAULT_DEPTH,
    merge: ROCKET_FX_DEFAULT_MERGE,
  }, "the shipped setup reads from the spec defaults");
  assert.equal(REACTOR_SETUP.diameter, "narrow", "the shipped diameter is narrow");
  assert.equal(REACTOR_SETUP.depth, "shorter", "the shipped depth is shorter");
  assert.equal(REACTOR_SETUP.merge, 2, "the shipped merge threshold is <=2");
}

console.log("reactor.test.mjs: ok");
