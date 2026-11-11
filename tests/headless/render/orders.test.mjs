// Transparent compositing bands: the ladder in src/render/orders.js is the
// single source of truth, and the migrated call sites must consume it. The
// regression this guards: the moving rocket hull once carried the default
// renderOrder 0 and wrote depth, so it was drawn before the world's liquid
// sheets (10/11) and erased all water behind the transparent hull.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ORDERS } from "../../../src/render/orders.js";

const src = (rel) => readFileSync(fileURLToPath(new URL("../../../src/" + rel, import.meta.url)), "utf8");

// 1. The ladder is strictly increasing and complete.
{
  const ladder = [
    "LIQUID_OUTSIDE", "LIQUID_INSIDE", "MOTE",
    "GLASS", "VEHICLE", "VEHICLE_GLASS", "VEHICLE_FX",
  ];
  for (let i = 0; i < ladder.length; i++) {
    assert.equal(typeof ORDERS[ladder[i]], "number", ladder[i] + " exists");
    if (i) assert.ok(ORDERS[ladder[i]] > ORDERS[ladder[i - 1]], ladder[i] + " sits above " + ladder[i - 1]);
  }
  assert.equal(Object.keys(ORDERS).length, ladder.length, "no undocumented band");
  console.log("PASS orders-ladder");
}

// 2. No raw numeric renderOrder assignments survive in the migrated modules:
//    a literal is how the hull/water inversion came back before.
{
  for (const rel of ["render/mesher.js", "render/chainproxy.js", "fx/nether.js", "fx/rocketimpact.js", "vehicles/rocket.js"]) {
    assert.ok(!/renderOrder\s*=\s*\d/.test(src(rel)), rel + " has no numeric renderOrder");
  }
  console.log("PASS orders-no-literals");
}

// 3. The migrated call sites consume the bands they should.
{
  const mesher = src("render/mesher.js");
  assert.match(mesher, /ORDERS\.GLASS/, "mesher glass band");
  assert.match(mesher, /ORDERS\.LIQUID_OUTSIDE/, "mesher outside liquid band");
  assert.match(mesher, /ORDERS\.LIQUID_INSIDE/, "mesher inside/pocket liquid band");
  assert.match(src("render/chainproxy.js"), /ORDERS\.LIQUID_OUTSIDE/, "chain proxy liquid band");
  assert.match(src("fx/nether.js"), /ORDERS\.MOTE/, "nether motes band");
  console.log("PASS orders-consumers");
}

// 4. The moving rocket hull composites above the liquids: hull blocks at
//    ORDERS.VEHICLE, its glass one band higher (never tinted by hull blocks),
//    the thruster FX highest; and the hull glass stays depthless (a window,
//    not an occluder) while every solid hull id keeps writing depth.
{
  const rocket = src("vehicles/rocket.js");
  assert.match(
    rocket,
    /mesh\.renderOrder = id === GLASS \? ORDERS\.VEHICLE_GLASS : ORDERS\.VEHICLE/,
    "hull blocks and hull glass bands"
  );
  assert.match(rocket, /c\.depthWrite = src\.depthWrite \?\? true/, "hull depth follows the source");
  // The thruster FX band lives with the FX engine now: every rocket layer
  // draws on the vehicle FX band, so the engine owns it, not the runtime.
  assert.match(src("fx/rocketimpact.js"), /ORDERS\.VEHICLE_FX/, "thruster FX band");
  assert.ok(
    ORDERS.VEHICLE > ORDERS.LIQUID_INSIDE,
    "the hull is always drawn after the liquid sheets"
  );
  console.log("PASS orders-rocket-hull");
}
