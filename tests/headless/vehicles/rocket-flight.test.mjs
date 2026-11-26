// Rocket carve debris: per-tick volume-scaled burst at true intersections,
// rigid vessel follow, fixed shipped look.
// Pure helpers run node-direct; the flush wiring is pinned by source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// --- carve debris: true intersections, rigid follow, per-tick volume -----
{
  const { CARVE_DEBRIS_HALF, CARVE_IMPACT_VARIANT_DEFAULT } = await import("../../../src/fx/rocketfx.js");
  assert.equal(CARVE_DEBRIS_HALF, 3, "the debris box ships at 3");
  assert.ok(!("CARVE_DEBRIS_HALVES" in await import("../../../src/fx/rocketfx.js")), "no box-size presets survive");
  assert.equal(CARVE_IMPACT_VARIANT_DEFAULT, "fireCubesRing", "fire + cubes + ring ship");
  const src = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(!src.includes("cycleImpactVariant"), "no variant cycling survives");
  assert.ok(!src.includes("impactVariantName"), "no variant readout survives");
  assert.ok(!src.includes("debrisSpawnBox(vesselBox, origin.x"), "no spawn-box rebase: debris stay at the true intersections");
  assert.ok(!src.includes("function boxEnclosed()"), "no enclosure gate: every carve tick emits");
  assert.ok(!src.includes("heldFaces"), "no one-tick hold survives");
  assert.ok(!src.includes("traverseFaces"), "no traversal sample survives");
  assert.ok(src.includes("CARVE_FACE_FRAME_CAP = 192"), "the frame holds one tick of shaft");
  assert.ok(src.includes("carveFaces = carveFaces.filter((_, i) => i % 2 === 0);"), "past the cap the sample stride-thins");
  assert.ok(src.includes("debrisCount = Math.min(DEBRIS_CHUNK * 2, faces.length * DEBRIS_PER_FACE)"), "cubes scale with emitted faces");
  assert.ok(src.includes("faces, factor: CARVE_FX_FACTOR,"), "fire, ring and debris anchor on the same tick of shaft");
  assert.ok(!src.includes("faces: anchorFaces"), "no separate anchor faces survive");
  assert.ok(src.includes("debrisFaces: faces"), "debris covers the tick of shaft");
  assert.ok(!src.includes("f.x += dx"), "no centroid rebase survives");
  assert.ok(!src.includes('playFx("carve"'), "no hull dust call survives");
  assert.ok(src.includes("variant: CARVE_IMPACT_VARIANT_DEFAULT"), "the flush plays the fixed shipped look");
  assert.ok(src.includes("faceColors, faceIds"), "the flush tints every face with its own wall");
  assert.ok(src.includes("shiftFollowDebris(origin.x - shiftPrev.x, origin.y - shiftPrev.y, origin.z - shiftPrev.z);"), "every flight tick carries the live debris");
  const keys = readFileSync(fileURLToPath(new URL("../../../src/player/keys.js", import.meta.url)), "utf8");
  assert.ok(!keys.includes("isImpactVariantCycleCode"), "no variant key survives");
  const main = readFileSync(fileURLToPath(new URL("../../../main.js", import.meta.url)), "utf8");
  assert.ok(!main.includes("cycleImpactVariant"), "no variant cursor survives");
  assert.ok(!main.includes("impactVariantName"), "no variant readout survives");
  assert.ok(!main.includes("rocketBoostInfo"), "no boost readout survives");
  assert.ok(!main.includes("| boost"), "no boost HUD suffix survives");
  console.log("PASS rocketflight-debris-box");
}

// --- flight caps: soft decay both sides, no snap, proportional brake ---
{
  const src = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(!src.includes("if (rvel.y > cap) rvel.y = cap;"), "no hard snap survives");
  assert.ok(!src.includes("if (rvel.y < -cap) rvel.y = -cap;"), "no hard snap from below survives");
  assert.ok(src.includes("Math.max(cap, rvel.y - dec)"), "overspeed decays instead of snapping");
  assert.ok(src.includes("Math.min(-cap, rvel.y + dec)"), "underspeed decays instead of snapping");
  assert.ok(src.includes("BRAKE_K = 1.5"), "opposition brake ships at 1.5/s");
  assert.ok(src.includes("BRAKE_K * -rvel.y"), "up-thrust brakes a fall proportionally");
  assert.ok(src.includes("BRAKE_K * rvel.y"), "down-thrust brakes a climb proportionally");
  assert.ok(!src.includes("rvel.x = cap") && !src.includes("rvel.z = cap"), "horizontal stays free of any cap");
  assert.ok(src.includes("VOID_CAP = 1000"), "void ceiling ships at 1000");
  assert.ok(src.includes("Math.min((MAX_SPEED + (BOOST_SPEED - MAX_SPEED) * boostF) * spaceF, VOID_CAP)"), "the vertical cap is clipped to the void ceiling");
  assert.ok(src.includes("landingDistBox(origin.x, yBottom, origin.z, vesselBox)"), "descent reads the bbox body gap");
  assert.ok(src.includes("gapBelowFootprint(getBlock, origin.x, yBottom, origin.z, vesselBox, SPACE_BUFFER)"), "descent scans voxels under the footprint");
  assert.ok(src.includes("spaceFactorFromDist(Math.min(bodyGap, voxGap))"), "descent caps on the nearest surface, body or voxel");
  assert.ok(!src.includes("rocketSpeed"), "no speed readout survives in the flight loop");
  console.log("PASS rocketflight-softcap");
}

console.log("rocket-flight.test.mjs: ok");
