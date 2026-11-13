// Headroom rule: no placement in 6-face contact with the top of a takeoff
// box (any pad, even empty) or of an independent parked vessel. Pure
// geometry rigs plus tryPlace wiring pins (source-read, like rocketfx).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  headroomBlocked, takeoffBox,
  registerPad, listPads, resetPads,
  registerVessel, listVessels, resetVessels,
} from "../../../src/world/rocketpad.js";

// --- pad takeoff box: the y1+1 row in the XZ extent is closed --------------
{
  resetPads();
  resetVessels();
  const pad = registerPad({ minX: 0, maxX: 10, minZ: 0, maxZ: 10, vy: 5 });
  const ctx = () => ({ pads: listPads(), vessels: listVessels() });
  const tb = takeoffBox(pad);
  assert.deepEqual([tb.x0, tb.x1, tb.y0, tb.y1, tb.z0, tb.z1], [1, 9, 6, 25, 1, 9]);
  assert.deepEqual(headroomBlocked(5, 26, 5, ctx()), { kind: "pad" }, "row above the takeoff top refuses");
  assert.deepEqual(headroomBlocked(1, 26, 1, ctx()), { kind: "pad" }, "corners of the row refuse too");
  assert.equal(headroomBlocked(5, 27, 5, ctx()), null, "two rows up stays free");
  assert.equal(headroomBlocked(0, 26, 5, ctx()), null, "outside the XZ extent stays free");
  assert.equal(headroomBlocked(5, 25, 5, ctx()), null, "inside the box stays free (union building)");
  // A second pad is enforced independently.
  const p2 = registerPad({ minX: 100, maxX: 106, minZ: 100, maxZ: 108, vy: 7 });
  const tb2 = takeoffBox(p2);
  assert.deepEqual(headroomBlocked(103, tb2.y1 + 1, 104, ctx()), { kind: "pad" }, "second pad enforced too");
  assert.equal(headroomBlocked(50, 26, 50, ctx()), null, "between pads stays free");
  // Too-narrow pads yield no box: nothing to guard.
  resetPads();
  registerPad({ minX: 200, maxX: 201, minZ: 200, maxZ: 210, vy: 5 });
  assert.equal(headroomBlocked(200, 26, 205, ctx()), null, "boxless pad guards nothing");
  resetPads();
  resetVessels();
}

// --- independent parked vessels: their own top row is closed ---------------
{
  resetPads();
  resetVessels();
  const v = registerVessel({
    ox: 500, oy: 30, oz: 500,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 1, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  const ctx = () => ({ pads: listPads(), vessels: listVessels() });
  assert.deepEqual(headroomBlocked(500, 31, 500, ctx()), { kind: "vessel", id: v.id }, "vessel top row refuses");
  assert.deepEqual(headroomBlocked(501, 31, 500, ctx()), { kind: "vessel", id: v.id }, "whole top row refuses");
  assert.equal(headroomBlocked(502, 31, 500, ctx()), null, "past the extent stays free");
  assert.equal(headroomBlocked(500, 32, 500, ctx()), null, "two rows up stays free");
  assert.equal(headroomBlocked(500, 30, 500, ctx()), null, "inside the box stays free");
  // Flying records never count.
  v.status = "flying";
  assert.equal(headroomBlocked(500, 31, 500, ctx()), null, "flying vessels guard nothing");
  v.status = "parked";
  // A vessel intersecting a takeoff box is pad-governed, not top-governed:
  // building up inside the box stays allowed.
  const pad = registerPad({ minX: 495, maxX: 505, minZ: 495, maxZ: 505, vy: 29 });
  const tb = takeoffBox(pad);
  assert.ok(tb && 500 >= tb.x0 && 500 <= tb.x1, "vessel sits inside the takeoff box");
  assert.equal(headroomBlocked(500, 31, 500, ctx()), null, "on-pad vessel top stays buildable");
  assert.deepEqual(headroomBlocked(500, tb.y1 + 1, 500, ctx()), { kind: "pad" }, "pad top still refuses above it");
  resetPads();
  resetVessels();
}

// --- tryPlace wiring: gate, toast, batch silence -----------------------------
{
  const editSrc = readFileSync(fileURLToPath(new URL("../../../src/player/edit.js", import.meta.url)), "utf8");
  assert.ok(editSrc.includes("headroomBlocked(px, py, pz,"), "tryPlace calls the headroom guard");
  assert.ok(editSrc.includes('dim === "over"'), "the guard is overworld-only");
  assert.ok(editSrc.includes('toast("No block on top of ship")'), "discrete taps toast the exact string");
  const gate = editSrc.match(/headroomBlocked\(px, py, pz[\s\S]*?\n  \}/);
  assert.ok(gate, "the gate block exists");
  assert.ok(gate[0].includes("if (!batched) toast("), "batch strokes refuse silently");
  assert.ok(/return null;\s*\n  \}\s*\n  setBlock\(px, py, pz, id\);/.test(editSrc), "the guard refuses before the write");
}

console.log("headroom.test.mjs: ok");
