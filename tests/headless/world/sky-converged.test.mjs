// Sky convergence predicate: all body chunks meshed, nothing else.
import assert from "node:assert/strict";
import { bodySpecs, BAND_COUNT } from "../../../src/world/planets.js";
import { skyConverged, bodyChunkKeys } from "../../../src/world/moon.js";

const seed = 7;
const specs = bodySpecs(seed);
assert.equal(specs.length, BAND_COUNT + 1, `moon + ${BAND_COUNT} planets`);
const all = new Set();
for (const spec of specs) {
  for (const k of bodyChunkKeys(spec)) all.add(k);
}
assert.ok(all.size > 5000, `sky spans chunks (${all.size})`);

// Fully meshed sky converges.
assert.equal(skyConverged(specs, (k) => all.has(k)), true, "meshed sky converges");
// One missing chunk breaks convergence.
const missing = [...all][Math.floor(all.size / 2)];
assert.equal(skyConverged(specs, (k) => k !== missing && all.has(k)), false, "one hole blocks");
// Nothing meshed: not converged.
assert.equal(skyConverged(specs, () => false), false, "empty meshes block");
// Empty sky converges vacuously.
assert.equal(skyConverged([], () => false), true, "no bodies converge");
console.log("PASS sky-converged");
