// Lake wells pierce the hollow underside: shafts run from the sphere
// bottom to the cap so the lakes read as water columns from below too
// (master behavior — visible, swimmable, hand-unbreakable like all liquids
// since the DDA skips them; empty geometric picks draw no highlight, only
// real voxels do).
// Locks the open-wells design against the sealed variant: every lake center
// column holds water down to its sphere bottom, and at least one lake per
// body reaches the body's lower band (exposed from the void below).
import assert from "node:assert/strict";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { bodySpecs, setPlanetSeed, resetPlanets } from "../../../src/world/planets.js";
import { bodyLakeParams, generateBody } from "../../../src/world/moon.js";

setDimension("over");

for (const seed of [7, 42]) {
  resetWorld("over");
  resetPlanets();
  setPlanetSeed(seed);
  for (const spec of [bodySpecs(seed)[0], bodySpecs(seed)[1]]) {
    const R = spec.r, base = spec.top, R2 = R * R;
    generateBody(spec, seed, setBlock, getBlock);
    let wet = 0;
    for (const { cx, cz } of bodyLakeParams(spec, seed)) {
      const dc2 = (cx - spec.cx) ** 2 + (cz - spec.cz) ** 2;
      const bottom = base - Math.floor(Math.sqrt(R2 - dc2));
      // Cap row over a lake center stays wet (wells read from the top).
      if (getBlock(cx, base, cz) === spec.water) wet++;
      // The shaft pierces down to the sphere bottom (no sealed gap): the
      // bottom cell is water, and the void below stays open (the join only
      // fills sealed air, and the column below the sphere is open sky).
      assert.equal(getBlock(cx, bottom, cz), spec.water,
        `${spec.key} shaft pierces to sphere bottom (${cx},${bottom},${cz})`);
      assert.notEqual(getBlock(cx, bottom - 1, cz), spec.rock,
        `${spec.key} shaft bottom stays open below (${cx},${bottom - 1},${cz})`);
    }
    assert.ok(wet > 0, `${spec.key} lakes hold water`);
  }
  console.log(`PASS body-shafts ${seed}`);
}
