// House entry: after threading a 2-wide house door, the erected touch ride
// must survive the door jambs instead of giving up. A fresh (post-2-wide)
// ride that turns onto the exterior wall with the body still tight to the
// jamb admits an unwalkable corner take: the arc clips the jamb cell, the
// forward probe reads blocked, the ride wedges and quits ~30 ticks out.
// The late corner take is refused while fresh (same takeWalkable rule as
// the early tip take and the forced exits): the ride holds straight past
// the jamb on the fresh lock-turn and re-measures the turn with clearance.
// Pinned rigs (always latch, never budget-expire): any quit is geometric.
// The ride is erected with exitMouth at the real door mouth (kind-2 key
// armed, so freshFromMouth holds exactly like a live thread-through).
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid } from "../../../src/mobs/mover.js";
import { NO_EXPIRY } from "../../../src/mobs/step.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";
import { exitMouth } from "../../../src/mobs/roam.js";
import { mouthCellKey } from "../../../src/mobs/corridor.js";
import { village, computeLayout, placeVillage } from "../../../src/world/village.js";

const DT = 1 / 60;

function scriptRand(vals) {
  let i = 0;
  return () => vals[(i++) % vals.length];
}

function makePinnedMob(x, y, z, yaw) {
  const spec = LIVESTOCK_SPECS["pig"];
  const shape = specCircles(spec);
  return {
    type: "pig", dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK, rand: scriptRand([0.5]),
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    entryScanT: 999, jrng: null, wallFollow: false, oneWide: false, tunnelPass: false, inPassage: null,
    entryCoolT: 0, entryCoolKey: null,
    pinWallRide: true,
  };
}

// Erect the kind-2 threading ride in house 0's 2-wide door, walk it out,
// and require the ride to hold (blue, laned) well past the jambs.
function runDoorThread(seed, postTicks) {
  resetWorld("over");
  clearEntryClaims();
  setDimension("over");
  computeLayout(seed, () => 14);
  const vy = village.center.y;
  for (let x = village.minX - 4; x <= village.maxX + 4; x++) {
    for (let z = village.minZ - 4; z <= village.maxX + 4; z++) {
      for (let y = 0; y <= 14; y++) setBlock(x, y, z, STONE);
    }
  }
  placeVillage(setBlock, getBlock);
  const h = village.houses[0];
  const exitAxis = Math.atan2(h.doorNx, h.doorNz);
  const mob = makePinnedMob(h.d0x + 0.5, vy + 1, h.d0z + 0.5, exitAxis);
  const key = mouthCellKey("over", 2, h.d0x, h.d0z, h.d1x, h.d1z);
  const r = scriptRand([0.1, 0.5, 0.3, 0.7, 0.2, 0.9, 0.4, 0.6]);
  // noSlide: the threading ride travels parallel without converging onto
  // its line — exactly the live thread-through state (not a contact latch).
  const latched = exitMouth(mob, exitAxis, DT, true, false, r, () => null, null, { key, noSlide: true });
  assert.ok(latched, `house-entry seed${seed}: exit erects the threading ride`);
  assert.ok(mob.lane != null && mob.followLine?.touch === true, `house-entry seed${seed}: plain touch lane`);
  assert.ok(mob.followLine.noSlide === true, `house-entry seed${seed}: threading (noSlide) flavor`);
  mob.target = { x: mob.pos.x + h.doorNx * 30, z: mob.pos.z + h.doorNz * 30 };
  const realRandom = Math.random;
  Math.random = scriptRand([0.5]);
  const trace = [];
  try {
    for (let t = 0; t < postTicks; t++) {
      tickFarmMob(mob, DT, () => mob.target, r);
      trace.push({ x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, blue: mob.wallFollow === true, lane: mob.lane != null });
      assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
        `house-entry seed${seed}: body in wall @tick${t}`);
    }
  } finally {
    Math.random = realRandom;
  }
  return trace;
}

// The jamb wedge quit ~30 ticks out; the surviving ride holds hundreds
// (its far later release at a true wall end is ordinary budget-free
// behavior, not a wedge — so the window stops at +120, past the jamb).
for (const seed of [99, 100, 21]) {
  const trace = runDoorThread(seed, 200);
  for (const dt of [60, 120]) {
    assert.ok(trace[dt].blue, `house-entry seed${seed}: still blue +${dt} (quit)`);
    assert.ok(trace[dt].lane, `house-entry seed${seed}: still laned +${dt}`);
  }
  const a = trace[0], b = trace[120];
  let path = 0;
  for (let i = 1; i <= 120; i++) path += Math.hypot(trace[i].x - trace[i - 1].x, trace[i].z - trace[i - 1].z);
  assert.ok(path > 2, `house-entry seed${seed}: keeps moving (path=${path.toFixed(2)})`);
  console.log(`PASS house-entry-${seed}`);
}
console.log("house-entry.test.mjs: ALL PASS");
