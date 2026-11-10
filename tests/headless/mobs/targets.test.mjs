// Target kinds: the registry, the cell enumeration, and the arrival
// rule (make CONTACT with a target block: on top of it, or beside it).
// Three-free, node direct.
import assert from "node:assert/strict";
import {
  TARGET_KINDS, registerTargetKind, targetKind, createTarget,
  targetCells, targetContains, contactGoalTiers,
} from "../../../src/mobs/targets.js";

assert.deepEqual(TARGET_KINDS.map((k) => k.key), ["block", "area", "volume"]);
assert.throws(() => registerTargetKind({ key: "block", cells: () => [] }), "duplicate kind");
assert.throws(() => registerTargetKind({ key: "no-cells" }), "kind without cells()");
assert.equal(targetKind("nope"), null);
assert.equal(createTarget("nope", {}), null);
assert.equal(targetKind("block").key, "block");

// --- block -------------------------------------------------------------
const block = createTarget("block", { x: 1, y: 2, z: 3 });
assert.deepEqual(targetCells(block), [{ x: 1, y: 2, z: 3 }]);
assert.ok(targetContains(block, 1, 2, 3));
assert.ok(!targetContains(block, 1, 2, 4));
// The goal tiers: on top of the block first, its lateral faces after.
const [blockTop, blockSide] = Array.from(contactGoalTiers(block));
assert.deepEqual(blockTop, [{ x: 1, y: 3, z: 3 }], "the mob stands on the block");
assert.deepEqual(blockSide, [
  { x: 0, y: 2, z: 3 }, { x: 2, y: 2, z: 3 },
  { x: 1, y: 2, z: 2 }, { x: 1, y: 2, z: 4 },
], "the mob can also come beside the block");

// --- area (one axis plane) --------------------------------------------
// A top-face selection: the y coordinate is fixed, x and z span.
const area = createTarget("area", { axis: "y", x0: 0, y0: 1, z0: 0, x1: 2, y1: 1, z1: 1 });
assert.deepEqual(targetCells(area), [
  { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 },
  { x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 },
  { x: 2, y: 1, z: 0 }, { x: 2, y: 1, z: 1 },
]);
assert.deepEqual(Array.from(contactGoalTiers(area))[0], [
  { x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 1 },
  { x: 1, y: 2, z: 0 }, { x: 1, y: 2, z: 1 },
  { x: 2, y: 2, z: 0 }, { x: 2, y: 2, z: 1 },
]);
// The side tier of the area: the lateral neighbours of every area cell.
const areaSide = Array.from(contactGoalTiers(area))[1];
assert.equal(areaSide.length, 16, "the side tier: the lateral neighbours, deduped");
assert.ok(areaSide.some((c) => c.x === 0 && c.y === 1 && c.z === 0), "the side tier: west");
assert.ok(areaSide.some((c) => c.x === 3 && c.y === 1 && c.z === 1), "the side tier: east");
assert.ok(targetContains(area, 1, 1, 1));
assert.ok(!targetContains(area, 3, 1, 1));

// Corner order never matters: the bounds normalize.
const flipped = createTarget("area", { axis: "y", x0: 2, y0: 1, z0: 1, x1: 0, y1: 1, z1: 0 });
assert.deepEqual(targetCells(flipped).map((c) => `${c.x},${c.y},${c.z}`).sort(),
  targetCells(area).map((c) => `${c.x},${c.y},${c.z}`).sort());

// A side-face selection: the z coordinate is fixed, x and y span.
const side = createTarget("area", { axis: "z", x0: 0, y0: 0, z0: 4, x1: 1, y1: 1, z1: 4 });
assert.deepEqual(targetCells(side), [
  { x: 0, y: 0, z: 4 }, { x: 0, y: 1, z: 4 },
  { x: 1, y: 0, z: 4 }, { x: 1, y: 1, z: 4 },
]);

// --- volume (explicit cell set) ----------------------------------------
const volume = createTarget("volume", {
  cells: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }],
});
assert.deepEqual(targetCells(volume), [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }]);
assert.ok(targetContains(volume, 2, 0, 2));
assert.ok(!targetContains(volume, 1, 0, 1));
assert.deepEqual(Array.from(contactGoalTiers(volume))[0], [{ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 2 }]);
assert.equal(Array.from(contactGoalTiers(volume))[1].length, 8, "the side tier: four neighbours each");

// --- extension point: a new kind registers a spec ----------------------
registerTargetKind({
  key: "test-line",
  cells: (t) => t.line.map(([x, y, z]) => ({ x, y, z })),
});
const line = createTarget("test-line", { line: [[0, 0, 0], [0, 0, 1]] });
assert.equal(targetCells(line).length, 2);
assert.ok(targetContains(line, 0, 0, 1));
// A kind can own its own reach rule (the tiers are a spec hook).
registerTargetKind({
  key: "test-reach",
  cells: (t) => [{ x: t.x, y: t.y, z: t.z }],
  goalTiers: (t) => [[{ x: t.x, y: t.y, z: t.z + 2 }]],
});
const reach = createTarget("test-reach", { x: 0, y: 0, z: 0 });
assert.deepEqual(Array.from(contactGoalTiers(reach)), [[{ x: 0, y: 0, z: 2 }]], "the kind owns its tiers");
assert.deepEqual(Array.from(contactGoalTiers(createTarget("nope", {}))), [], "an unknown kind has no tiers");

console.log("targets.test.mjs: ALL PASS");
