// Blast LOD keep: every blast notes the bodies it touches so craters keep
// their real voxels at any range (tnt.js needs three, so the wiring is
// asserted on source, headroom.test.mjs pattern).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tntSrc = readFileSync(fileURLToPath(new URL("../../../src/fx/tnt.js", import.meta.url)), "utf8");

// Shared helper: moon-dim gate, positional body lookup, LOD pin.
assert.ok(tntSrc.includes("function noteBlastBodies(cells) {"), "shared blast-body helper exists");
assert.ok(tntSrc.includes("if (!moonDimHas(dim)) return;"), "noting stays in moon dimensions");
assert.ok(tntSrc.includes("const b = planetBodyAtPlaced(x, y, z);"), "bodies resolve positionally");
assert.ok(tntSrc.includes("if (b) noteBodyInteract(seed, b.key);"), "touched bodies pin their meshes");
// Mega pool: members plus ignition cover void-spanning chained pools.
assert.ok(tntSrc.includes("noteBlastBodies(members.map((m) => [m.x, m.y, m.z]).concat([[cx, cy, cz]]));"),
  "pool notes every member plus ignition");
// Normal blasts: ignition cell.
assert.ok(tntSrc.includes("noteBlastBodies([[cx, cy, cz]]);"), "normal blast notes its ignition body");
// Ultra band path keeps its own noting (unchanged).
assert.ok(tntSrc.includes("noteBodyInteract(seed, body.key);"), "band path noting untouched");
console.log("PASS blast-bodies-wiring");
