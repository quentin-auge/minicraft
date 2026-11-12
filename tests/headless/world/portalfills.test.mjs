// Portal fill geometry and riding rules (three-free, node direct): the
// fill box, the frame ring, and the rule that decides which fills travel
// with a moving hull.
import assert from "node:assert/strict";
import {
  FILL_FLIGHT_FADE, fillBox, frameRingCells, ridingFills,
} from "../../../src/world/portalfills.js";

// --- the fill box -------------------------------------------------------
{
  // A vertical window on a z face: one cell wide, the height of the fill.
  const b = fillBox([[2, 3, 5], [2, 4, 5], [2, 5, 5]], "v", "z");
  assert.deepEqual(
    { cx: b.cx, cy: b.cy, cz: b.cz, sx: b.sx, sy: b.sy, sz: b.sz },
    { cx: 2.5, cy: 4.5, cz: 5.5, sx: 1, sy: 3, sz: 1 },
    "vertical z-face box"
  );
  // A vertical window on an x face: one cell deep in x.
  const bx = fillBox([[5, 3, 2], [5, 4, 2]], "v", "x");
  assert.equal(bx.sx, 1, "vertical x-face is one cell wide");
  assert.equal(bx.sy, 2, "vertical x-face keeps its height");
  // A flat window: one cell tall, spread over the ground.
  const bh = fillBox([[1, 7, 1], [2, 7, 1], [3, 7, 1]], "h", "z");
  assert.equal(bh.sy, 1, "flat window is one cell tall");
  assert.equal(bh.sx, 3, "flat window keeps its span");
  console.log("PASS fills-box");
}

// --- the frame ring -----------------------------------------------------
{
  const bbox = { minX: 0, maxX: 2, minZ: 0, maxZ: 2, baseY: 5, topY: 5 };
  const ring = frameRingCells(bbox, "h", "z", () => true);
  // A flat 3x3 window: the border only, the centre is fill.
  assert.equal(ring.length, 8, "flat ring is the border");
  assert.ok(!ring.some(([x, y, z]) => x === 1 && z === 1), "flat ring skips the centre");
  // A family with optional corners: the predicate drops them.
  const cornerless = frameRingCells(bbox, "h", "z", (x, y, z) => !(x === 0 && z === 0));
  assert.equal(cornerless.length, 7, "a dropped corner leaves the ring");
  // An upright window on a z face: the top and bottom rows plus the two
  // vertical sides, the middle of the wall open (that is the fill).
  const upright = frameRingCells(
    { minX: 0, maxX: 4, minZ: 0, maxZ: 0, baseY: 0, topY: 4 }, "v", "z", () => true);
  assert.equal(upright.length, 16, "upright ring is the border");
  assert.ok(!upright.some(([x, y]) => y > 0 && y < 4 && x > 0 && x < 4),
    "upright ring leaves the wall open");
  console.log("PASS fills-ring");
}

// --- the riding rule ----------------------------------------------------
{
  const fill = (ring) => ({ ring, box: { cx: 0, cy: 0, cz: 0, sx: 1, sy: 1, sz: 1 } });
  const cells = new Set(["0,0,0", "1,0,0", "0,1,0"]);
  const whole = fill([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  const split = fill([[0, 0, 0], [9, 9, 9]]);
  const riding = ridingFills([whole, split], (x, y, z) => cells.has(x + "," + y + "," + z));
  assert.equal(riding.length, 1, "a split ring never rides");
  assert.equal(riding[0], whole, "the whole ring rides");
  // An empty ring rides (nothing of it is outside).
  assert.equal(ridingFills([fill([])], () => false).length, 1, "an empty ring rides");
  console.log("PASS fills-riding");
}

// --- the flight fade depth ---------------------------------------------
{
  assert.ok(FILL_FLIGHT_FADE > 0 && FILL_FLIGHT_FADE < 1, "the flight fade is a partial opacity");
  console.log("PASS fills-fade");
}

console.log("portalfills.test.mjs: ok");
