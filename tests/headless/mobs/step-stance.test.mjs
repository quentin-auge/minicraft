// Fractional stance: a supported mob stands up to 1e-3 above its tread
// (the support touch tolerance), and an exact one-block drop measured
// from the fractional feet used to fail at a float epsilon —
// scanStep returned null and the gated drives vetoed, so a staircase
// read as un-walkable (yellow never installed, green executor frozen
// yaw-hunting) at whatever height the stance fraction landed past the
// epsilon. The step level reads are stance-quantized now: the same local
// geometry decides identically at any height.
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles, dropAllowed } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob } from "../../../src/mobs/mover.js";
import { scanStep } from "../../../src/mobs/stairs.js";
import { assignNav } from "../../../src/mobs/nav.js";
import { createTarget } from "../../../src/mobs/targets.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const DT = 1 / 60;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMob(x, y, z, yaw, rand) {
  const spec = LIVESTOCK_SPECS.pig;
  const shape = specCircles(spec);
  return {
    type: "pig", dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, stepUp: spec.stepUp ?? 0, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK, rand,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followRel: 0,
    turnHold: 0, entryScanT: 0, jrng: null, stepRng: null, stepping: false,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null, capabilities: { walk: true },
  };
}

// One tread at L, a 1-down landing band beside it, floor past it.
function stanceRig(L) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  for (let y = L - 1; y >= 0; y--) setBlock(0, y, 0, STONE);
  for (let y = L - 2; y >= 0; y--) { setBlock(1, y, 0, STONE); setBlock(2, y, 0, STONE); }
  for (let x = -6; x <= 10; x++) for (let z = -4; z <= 4; z++) setBlock(x, L - 2, z, STONE);
}

// The drop predicate reads the stance, not the fractional feet.
{
  assert.equal(dropAllowed(103.001, 102, 1, 0), true, "drop: 1 down from a +0.001 stance is legal");
  assert.equal(dropAllowed(103.0, 102, 1, 0), true, "drop: 1 down from an exact stance is legal");
  assert.equal(dropAllowed(103.001, 101, 1, 0), false, "drop: 2 down from a +0.001 stance is still refused");
  assert.equal(dropAllowed(103.001, 104, 1, 0), false, "drop: up is still refused for walkers");
  assert.equal(dropAllowed(20.001, 19, 1, 0), true, "drop: same rule low down");
}
console.log("PASS drop-stance");

// The scan finds the head of a flight from a fractional stance — at any height.
for (const L of [20, 76, 103]) {
  stanceRig(L);
  const mob = makeMob(0.5, L + 0.001, 0.5, Math.PI / 2, mulberry32(7));
  const found = scanStep(mob);
  assert.ok(found != null, `scan@${L}: a 1-drop ahead of a +0.001 stance is offered`);
  assert.equal(found.y, L - 1, `scan@${L}: the landing reads one below the tread`);
}
console.log("PASS scan-stance");

// The yellow commit walks the flight from a fractional stance.
{
  const L = 103;
  stanceRig(L);
  const mob = makeMob(0.5, L + 0.001, 0.5, Math.PI / 2, mulberry32(7));
  mob.stepRng = () => 0;
  let minY = Infinity, steps = 0;
  for (let t = 0; t < 900; t++) {
    tickFarmMob(mob, DT, () => ({ x: 20.5, z: 0.5 }), mob.rand);
    if (mob.pos.y < minY) minY = mob.pos.y;
    if (mob.roam?.step === true) steps++;
  }
  assert.ok(steps > 0, "stance-walk: the step commit installs from a fractional stance");
  assert.ok(minY <= L - 1 + 1e-3, `stance-walk: the mob walks down (${minY})`);
}
console.log("PASS stance-walk");

// The green plan walks it too, to a floor target.
{
  const L = 103;
  stanceRig(L);
  const mob = makeMob(0.5, L + 0.001, 0.5, Math.PI / 2, mulberry32(7));
  const plan = assignNav(mob, createTarget("block", { x: 6, y: L - 2, z: 0 }));
  assert.ok(plan != null, "stance-plan: the plan routes the flight");
  let minY = Infinity;
  for (let t = 0; t < 900; t++) {
    tickFarmMob(mob, DT, () => ({ x: 6.5, z: 0.5 }), mob.rand);
    if (mob.pos.y < minY) minY = mob.pos.y;
    if (!mob.nav) break;
  }
  assert.ok(minY <= L - 1 + 1e-3, `stance-plan: the green plan walks down (${minY})`);
}
console.log("PASS stance-plan");
