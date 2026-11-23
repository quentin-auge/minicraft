// Sealed-era heal: a moon/planet whose lake wells were paved with rock
// below the cap (the sealed spec) converges back to open wells through
// restoreBodyLakeWells + the lake join — the same path the sliced filler
// runs once per stale body. Cap-level player edits (mined holes, placed
// rock outside the mask) are untouched: the restore only converts ROCK
// inside the lake mask below the cap.
import assert from "node:assert/strict";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { AIR } from "../../../src/core/blocks.js";
import { bodySpecs, setPlanetSeed, resetPlanets, bodyReady, markBodyBuilt } from "../../../src/world/planets.js";
import {
  bodyLakeParams, generateBodySurfaceRows, generateBodyUnderRows,
  restoreBodyLakeWells, joinBodyLakeWater, moonReady,
} from "../../../src/world/moon.js";

setDimension("over");

for (const seed of [7, 42]) {
  resetWorld("over");
  resetPlanets();
  setPlanetSeed(seed);
  const specs = [bodySpecs(seed)[0], bodySpecs(seed)[1]];
  for (const spec of specs) {
    const R = spec.r, base = spec.top, thick = spec.thick, R2 = R * R;
    // Healthy worldgen start: cap + full water shafts.
    generateBodySurfaceRows(spec, seed, setBlock, spec.cx - R, spec.cx + R + 1);
    generateBodyUnderRows(spec, seed, setBlock, spec.cx - R, spec.cx + R + 1, getBlock);
    // Simulate the sealed era: pave every lake-center shaft with rock
    // below the cap, then mark built (stale fill, live world).
    const lakes = bodyLakeParams(spec, seed);
    assert.ok(lakes.length > 0, `${spec.key} has lakes`);
    for (const { cx, cz } of lakes) {
      const dc2 = (cx - spec.cx) ** 2 + (cz - spec.cz) ** 2;
      const bottom = base - Math.floor(Math.sqrt(R2 - dc2));
      for (let y = bottom; y <= base - thick; y++) setBlock(cx, y, cz, spec.rock);
    }
    // Player edits at cap level: a mined hole and a cap rock cell.
    let holeX = spec.cx + R - 2;
    while (getBlock(holeX, base, spec.cz) !== spec.rock && holeX > spec.cx) holeX--;
    assert.equal(getBlock(holeX, base, spec.cz), spec.rock, `${spec.key} cap probe is rock`);
    setBlock(holeX, base, spec.cz, AIR);
    let keptX = holeX - 1;
    while (getBlock(keptX, base, spec.cz) !== spec.rock && keptX > spec.cx - R) keptX--;
    // Stale body heals through the filler path (restore + join).
    assert.equal(spec.key === "moon" ? moonReady(seed) : bodyReady(seed, spec.key), false);
    restoreBodyLakeWells(spec, seed, setBlock, getBlock);
    joinBodyLakeWater(spec, seed, setBlock, getBlock);
    markBodyBuilt(seed, spec.key);
    assert.equal(spec.key === "moon" ? moonReady(seed) : bodyReady(seed, spec.key), true);
    // Every sealed shaft is water again, sphere bottom to cap top.
    for (const { cx, cz } of lakes) {
      const dc2 = (cx - spec.cx) ** 2 + (cz - spec.cz) ** 2;
      const bottom = base - Math.floor(Math.sqrt(R2 - dc2));
      for (let y = bottom; y <= base; y++) {
        assert.equal(getBlock(cx, y, cz), spec.water,
          `${spec.key} well healed at (${cx},${y},${cz})`);
      }
    }
    // Cap edits survived: mined hole still open, untouched cap still rock.
    assert.equal(getBlock(holeX, base, spec.cz), AIR, `${spec.key} mined cap hole stays open`);
    if (getBlock(keptX, base, spec.cz) === spec.rock) {
      assert.equal(getBlock(keptX, base, spec.cz), spec.rock, `${spec.key} cap rock untouched`);
    }
  }
  console.log(`PASS lake-heal ${seed}`);
}
