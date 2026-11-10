// Target debug state: the C-key flow, the corner-to-corner selection, and
// the target it builds. Three-free, node direct.
import assert from "node:assert/strict";
import {
  PHASE, TINT, createDebugState, startSelection,
  updateSelection, selectionKind, selectionCells, cellChecksum,
  closeSelection, cancelDebugState,
} from "../../../src/mobs/targets-debug-state.js";
import { targetCells } from "../../../src/mobs/targets.js";

// --- the selection is the box between the two corners -------------------
// The C press is the first corner, the cell under the cursor the second.
{
  const s = createDebugState();
  assert.equal(s.phase, PHASE.IDLE);
  assert.ok(startSelection(s, { x: 2, y: 0, z: 3 }));
  assert.equal(s.phase, PHASE.SELECTING);
  assert.equal(selectionKind(s), "block");
  assert.deepEqual(selectionCells(s), [{ x: 2, y: 0, z: 3 }]);
  // The cursor moves on the same plane: the box is flat.
  updateSelection(s, { x: 4, y: 0, z: 5 });
  assert.equal(selectionKind(s), "area");
  assert.equal(selectionCells(s).length, 3 * 3, "a flat drag is a rectangle");
  assert.ok(selectionCells(s).every((c) => c.y === 0), "a flat drag stays on one plane");
  // The cursor moves off the plane: the box grows in every direction.
  updateSelection(s, { x: 4, y: 2, z: 5 });
  assert.equal(selectionKind(s), "volume");
  const cells = selectionCells(s);
  assert.equal(cells.length, 3 * 3 * 3, "a 3D drag is a box");
  assert.ok(cells.some((c) => c.x === 2 && c.y === 0 && c.z === 3), "the first corner is in the box");
  assert.ok(cells.some((c) => c.x === 4 && c.y === 2 && c.z === 5), "the second corner is in the box");
  assert.ok(cells.every((c) => c.x >= 2 && c.x <= 4 && c.y >= 0 && c.y <= 2 && c.z >= 3 && c.z <= 5),
    "the box spans the two corners");
  // The corner order never matters: the box is the same.
  const t = createDebugState();
  startSelection(t, { x: 4, y: 2, z: 5 });
  updateSelection(t, { x: 2, y: 0, z: 3 });
  assert.deepEqual(selectionCells(t).map((c) => `${c.x},${c.y},${c.z}`).sort(),
    selectionCells(s).map((c) => `${c.x},${c.y},${c.z}`).sort());
}

// --- a wall drag: the box works from any first aim ----------------------
{
  const s = createDebugState();
  startSelection(s, { x: 5, y: 1, z: 2 });
  updateSelection(s, { x: 5, y: 3, z: 4 });
  assert.equal(selectionKind(s), "area", "a wall drag is flat");
  assert.ok(selectionCells(s).every((c) => c.x === 5), "the wall drag stays on its plane");
  assert.equal(selectionCells(s).length, 3 * 3);
  // Down to the floor: the box is a 3D one, the other way round.
  updateSelection(s, { x: 8, y: 0, z: 3 });
  assert.equal(selectionKind(s), "volume");
  const cells = selectionCells(s);
  assert.equal(cells.length, 4 * 2 * 2);
  assert.ok(cells.every((c) => c.x >= 5 && c.x <= 8 && c.y >= 0 && c.y <= 1 && c.z >= 2 && c.z <= 4),
    "the box spans the wall corner and the floor corner");
}

// --- closing the selection builds the target ---------------------------
{
  const s = createDebugState();
  startSelection(s, { x: 1, y: 0, z: 1 });
  const target = closeSelection(s);
  assert.ok(target, "one cell: a target");
  assert.equal(target.key, "block", "one cell: a block target");
  assert.deepEqual(targetCells(target), [{ x: 1, y: 0, z: 1 }]);
  assert.equal(s.phase, PHASE.ARMED);
}
{
  const s = createDebugState();
  startSelection(s, { x: 0, y: 2, z: 0 });
  updateSelection(s, { x: 2, y: 2, z: 1 });
  const target = closeSelection(s);
  assert.equal(target.key, "area", "a flat box: an area target");
  assert.equal(target.axis, "y", "the flat axis is the area's plane");
  assert.equal(targetCells(target).length, 6);
  // The area enumerates exactly the selected cells.
  const a = targetCells(target).map((c) => `${c.x},${c.y},${c.z}`).sort();
  const b = selectionCells(s).map((c) => `${c.x},${c.y},${c.z}`).sort();
  assert.deepEqual(a, b, "the area covers the selection");
}
{
  const s = createDebugState();
  startSelection(s, { x: 0, y: 0, z: 0 });
  updateSelection(s, { x: 1, y: 0, z: 1 });
  updateSelection(s, { x: 1, y: 3, z: 1 });
  const target = closeSelection(s);
  assert.ok(target, "volume: the target is armed");
  assert.equal(target.key, "volume", "a 3D box: a volume target");
  assert.equal(targetCells(target).length, selectionCells(s).length, "volume: the cells are the box");
  assert.equal(s.phase, PHASE.ARMED);
}

// --- the anchor never moves, and the box is never refused --------------
{
  const s = createDebugState();
  startSelection(s, { x: 20, y: 0, z: 0 });
  // The anchor is the block the press landed on: it stays put while the
  // aim moves anywhere.
  updateSelection(s, { x: 0, y: 0, z: 0 });
  const cells = selectionCells(s);
  assert.ok(cells.some((c) => c.x === 20 && c.y === 0 && c.z === 0),
    "the anchor stays in the box");
  assert.ok(cells.some((c) => c.x === 0 && c.y === 0 && c.z === 0),
    "the aimed cell is in the box");
  assert.equal(cells.length, 21, "the box spans both corners");
  // Nothing aimed: the box keeps its shape (the aim did not move it).
  const before = cells.length;
  const target = closeSelection(s);
  assert.ok(target, "a huge selection still builds a target");
  assert.equal(target.key, "area", "a flat box is an area");
  assert.equal(targetCells(target).length, before, "the target holds the whole box");
  // The shaping continues from the same anchor when a block is aimed again.
  const t = createDebugState();
  startSelection(t, { x: 20, y: 0, z: 0 });
  updateSelection(t, { x: 5, y: 0, z: 0 });
  const mid = selectionCells(t).length;
  updateSelection(t, { x: 5, y: 3, z: 0 });
  const grown = selectionCells(t);
  assert.equal(grown.length, mid * 4, "the box grows from the anchor");
  assert.ok(grown.some((c) => c.x === 20 && c.y === 0 && c.z === 0),
    "the anchor stays in the grown box");
}

// --- a box of any size is selected in full ------------------------------
{
  const s = createDebugState();
  startSelection(s, { x: 0, y: 0, z: 0 });
  updateSelection(s, { x: 39, y: 19, z: 39 });
  assert.equal(selectionCells(s).length, 40 * 20 * 40, "a huge box is enumerated in full");
  const target = closeSelection(s);
  assert.ok(target, "a huge box builds a target");
  assert.equal(target.key, "volume");
  assert.equal(targetCells(target).length, 40 * 20 * 40, "the target holds the whole box");
}

// --- the overlay change detection sees every change ---------------------
// The overlay redraws when the selection changes: a reshape that keeps
// the cell count and the first cell must still be seen.
{
  const a = [{ x: 2, y: 0, z: 3 }, { x: 3, y: 0, z: 3 }, { x: 2, y: 1, z: 3 }];
  const b = [{ x: 2, y: 0, z: 3 }, { x: 3, y: 1, z: 3 }, { x: 2, y: 1, z: 3 }];
  assert.equal(a.length, b.length, "the same count");
  assert.deepEqual(a[0], b[0], "the same first cell");
  assert.notEqual(cellChecksum(a), cellChecksum(b), "the reshape is seen");
  assert.equal(cellChecksum(a), cellChecksum([...a]), "the same cells hash the same");
}

// --- cancel resets everything -----------------------------------------
{
  const s = createDebugState();
  startSelection(s, { x: 0, y: 0, z: 0 });
  closeSelection(s);
  cancelDebugState(s);
  assert.equal(s.phase, PHASE.IDLE);
  assert.equal(s.target, null);
  assert.equal(s.mob, null);
  assert.deepEqual(selectionCells(s), []);
}

// --- the flow: pick a target, then cancel ------------------------------
{
  const s = createDebugState();
  startSelection(s, { x: 2, y: 0, z: 2 });
  updateSelection(s, { x: 4, y: 0, z: 4 });
  const target = closeSelection(s);
  assert.ok(target, "flow: the target is armed");
  assert.equal(s.phase, PHASE.ARMED);
  // Closing twice is a no-op (the phase moved on).
  assert.equal(closeSelection(s), null, "flow: the selection closes once");
}

// The debug greens: the whole overlay — every selection, the path —
// shares one translucent green, the selection's 12 edges stay subtle
// (a dim green, never louder than the body), and the targeted mob is
// painted opaque so it reads as "this one".
assert.equal(TINT.mobOpacity, 1, "the green mob is opaque");
assert.equal(TINT.overlayOpacity, 0.45, "the overlay shares one opacity");
assert.equal(TINT.edgeColor, TINT.green, "the edges are the debug green");
assert.ok(TINT.edgeOpacity < 1, "the edges stay translucent");
assert.ok(TINT.edgeOpacity > TINT.overlayOpacity, "the edges read over the body");
assert.ok(TINT.green !== undefined, "the debug green is defined");

console.log("targets-debug-state.test.mjs: ALL PASS");
