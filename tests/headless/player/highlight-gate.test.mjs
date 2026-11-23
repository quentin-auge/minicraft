// Highlight gate: the aim box reflects voxels only, never geometry. A
// geometric celestial pick (id AIR on a body cylinder — possibly outside
// the voxel volume entirely, e.g. below the moon disc) draws no box while
// staying actionable for remote place / grapple / body TNT.
import assert from "node:assert/strict";
import { AIR, MOON, shouldShowHighlight } from "../../../src/core/blocks.js";

assert.equal(shouldShowHighlight(null), false);
assert.equal(shouldShowHighlight(undefined), false);
// Empty geometric pick under the moon disc: no box, ever.
assert.equal(shouldShowHighlight({
  x: 22, y: 849, z: -20, id: AIR, face: [0, 1, 0], t: 900, body: { key: "moon" },
}), false);
// Real voxel hit: box on.
assert.equal(shouldShowHighlight(
  { x: 0, y: 946, z: 0, id: MOON, face: [0, 1, 0], t: 10 },
), true);

console.log("highlight-gate.test.mjs OK");
