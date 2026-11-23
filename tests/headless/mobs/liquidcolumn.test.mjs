// Liquid-column regime: lateral entry into ground-level liquid walls and
// columns, rise to the top, cruise (under lids, under peers), and leave
// through a shore hop or a free air fall with no drop limit. Pool, lake,
// and shallow-bank rules stay untouched (see float.test.mjs and
// transitions.test.mjs): the column only arms on tall liquid standing
// above the shared entry window.
import assert from "node:assert/strict";
import { AIR, STONE, WATER, LAVA } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles, floatTargetY } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid, separateFarmMobs, worstPairPen } from "../../../src/mobs/mover.js";
import { planGroup } from "../../../src/mobs/forecast.js";
import { buildMobGrid } from "../../../src/mobs/grid.js";
import { SEP_GAP } from "../../../src/mobs/collide.js";
import { liquidSurface, NO_EXPIRY } from "../../../src/mobs/step.js";
import {
  liquidEntryProbe, bodyClearOfLiquid, liquidExitClear, liquidSolidAhead, liquidRideTargetY,
  liquidPeerCapY, liquidShaftLoad, liquidShaftCapacity, liquidSpanAt, liquidWetCommit,
  LIQUID_PEER_GAP,
} from "../../../src/mobs/liquidcolumn.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const DT = 1 / 60;
const PIG_H = specCircles(LIVESTOCK_SPECS.pig).h;

function makeMob(kind, x, y, z, yaw, opts = {}) {
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  const mob = {
    type: kind, dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    floatCapable: true,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: opts.speed ?? FARM_WALK, rand: opts.rand ?? (() => 0.5),
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    entryScanT: 0, jrng: null, wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
    transCoolT: 0, _transPrev: null, _transDecision: null,
    _transNoDiveT: 0, _transNoExitT: 0,
    pinWallRide: opts.pinWallRide ?? false,
  };
  if (opts.floatCapable === false) mob.floatCapable = false;
  return mob;
}

function pinCommit(mob, heading, target) {
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: 99, runT: 0 };
}

function groundSlab(x0, x1, z0, z1) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, 0, z, STONE);
}

// Freestanding 1-wide water column, 5 high: ground top 1, surface top 6.
function buildShaft() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 12, 0, 12);
  for (let y = 1; y <= 5; y++) setBlock(6, y, 6, WATER);
}

// Water wall 2 wide x 3 high x 1 deep (house-door shape): ground top 1,
// surface top 4.
function buildWall() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 12);
  for (let y = 1; y <= 3; y++) for (let z = 6; z <= 7; z++) setBlock(6, y, z, WATER);
}

// Lidded water: 4-high water with a stone lintel one above the surface.
// The approach stays open air over the y=0 slab (ground top 1).
function buildLidPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 12);
  for (let y = 1; y <= 4; y++) for (let x = 5; x <= 7; x++) setBlock(x, y, 6, WATER);
  for (let x = 5; x <= 7; x++) setBlock(x, 5, 6, STONE);
}

// Pool fixture (surface at the feet level): the column must never arm.
function buildPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 12, 0, 12);
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    if (x >= 4 && x <= 8 && z >= 4 && z <= 8) setBlock(x, 1, z, WATER);
    else setBlock(x, 1, z, STONE);
  }
}

// --- trigger rule: tall liquid arms, pool rims never do ------------------
{
  buildPool();
  const dry = makeMob("pig", 2.5, 2, 6.5, Math.PI / 2);
  assert.equal(liquidEntryProbe(dry, false), null, "pool rim never arms the column");
  const feet = floatTargetY(2, PIG_H);
  const wet = makeMob("pig", 6.5, feet, 6.5, Math.PI / 2);
  assert.equal(liquidEntryProbe(wet, true), null, "pool floaters never arm the column");
  buildShaft();
  const appr = makeMob("pig", 5.6, 1, 6.5, Math.PI / 2);
  const probe = liquidEntryProbe(appr, false);
  assert.ok(probe && probe.wet === false, "tall wall arms the column from dry land");
  const sunk = makeMob("pig", 6.5, 1.2, 6.5, 0);
  assert.ok(liquidEntryProbe(sunk, true)?.wet === true, "a body under a tall column arms wet");
  const nofloat = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2, { floatCapable: false });
  assert.equal(liquidEntryProbe(nofloat, false), null, "non-floaters never arm");
}
console.log("PASS liquid-trigger");

// --- whole-body exit gate: the rear counts --------------------------------
{
  buildShaft();
  const mob = makeMob("pig", 6.5, 1.0, 6.5, 0);
  assert.ok(!bodyClearOfLiquid(mob), "submerged body is not clear");
  const out = makeMob("pig", 9.5, 1, 6.5, Math.PI / 2);
  assert.ok(bodyClearOfLiquid(out), "dry body reads clear");
  // Straddle: core dry, tail still wet — must NOT read clear.
  const straddle = makeMob("pig", 7.05, 1.0, 6.5, Math.PI / 2);
  const tailWet = !bodyClearOfLiquid(straddle);
  assert.ok(tailWet, "a wet rear holds the exit gate");
}
console.log("PASS liquid-body-clear");

// --- 1-wide liquid: center, rise to the top, cross, free fall out --------
{
  buildShaft();
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, sawFloat = false, maxY = -Infinity, done = false;
  let lastWetY = null, wasWet = false;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    if (mob.liquid?.phase === "float") sawFloat = true;
    maxY = Math.max(maxY, mob.pos.y);
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    if (wet) lastWetY = mob.pos.y;
    wasWet = wet;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `liquid: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && !wet && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "liquid: the regime armed");
  assert.ok(sawFloat, "liquid: reached the float phase at the top");
  assert.ok(maxY > 5.0, `liquid: rose to the top (maxY=${maxY.toFixed(2)})`);
  assert.ok(done, `liquid: crossed and left (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(!mob.hop, "liquid: no hop on an air exit");
  assert.ok(lastWetY != null && lastWetY > 5.0,
    `liquid: left the water at the top (lastWet=${lastWetY?.toFixed(2)})`);
  assert.ok(lastWetY - 1 > mob.maxDrop,
    `liquid: the exit fall exceeds the step-down bound (${(lastWetY - 1).toFixed(2)} > ${mob.maxDrop})`);
  assert.ok(Math.abs(mob.pos.y - 1) < 0.08, `liquid: stands on the ground (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS liquid-cross-fall");

// --- 2-wide x 3-high wall (house door): fluid threading, no hop ---------
{
  buildWall();
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, hops = 0, wasHop = false;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    if (mob.hop && !wasHop) hops++;
    wasHop = mob.hop != null;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `wall: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "wall: the regime armed");
  assert.ok(done, `wall: threaded the 2-wide wall (x=${mob.pos.x.toFixed(2)})`);
  assert.equal(hops, 0, "wall: no hop over an air exit");
  assert.ok(Math.abs(mob.pos.y - 1) < 0.1, `wall: stands on the ground (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS liquid-wall-thread");

// --- lid: cruise glued underneath, never yanked to the floor -------------
{
  buildLidPool();
  const mob = makeMob("pig", 3.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, minWetY = Infinity, risen = false;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    if (mob.pos.y > 3) risen = true;
    if (wet) minWetY = Math.min(minWetY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `lid: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (risen && wet && mob.liquid) assert.ok(mob.pos.y > 2.0, `lid: never yanked to the floor @tick${t} (y=${mob.pos.y.toFixed(2)}, x=${mob.pos.x.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  assert.ok(sawLiquid, "lid: the regime armed");
  assert.ok(done, `lid: passed under the lintel (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(minWetY < 4.6, `lid: drifted below the surface (minWetY=${minWetY.toFixed(2)})`);
}
console.log("PASS liquid-lid-drift");

// --- parked peer in the shaft: pass underneath, never intersect ---------
{
  buildShaft();
  // Widen the shaft so the lateral slide stays wet: 2x2 water, 5 high.
  for (let y = 1; y <= 5; y++) { setBlock(7, y, 6, WATER); setBlock(6, y, 5, WATER); setBlock(7, y, 5, WATER); }
  const rideY = floatTargetY(6, PIG_H);
  const peer = {
    type: "pig", dim: "over", pos: { x: 6.5, y: rideY, z: 6.5 }, vel: { y: 0 },
    hw: 0.32, h: PIG_H, nose: specCircles(LIVESTOCK_SPECS.pig).nose,
    tail: specCircles(LIVESTOCK_SPECS.pig).tail,
    maxDrop: 1, alive: true, root: null, yaw: 0, speed: 0,
  };
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  const peers = [mob, peer];
  let sawLiquid = false, done = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand, peers, null);
    if (mob.liquid) sawLiquid = true;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `peer: body in wall @tick${t}`);
    // Never intersect the parked peer in 3D.
    const dx = mob.pos.x - peer.pos.x, dz = mob.pos.z - peer.pos.z;
    const dy = Math.abs(mob.pos.y - peer.pos.y);
    if (Math.hypot(dx, dz) < 0.7) assert.ok(dy > 0.9, `peer: passed underneath (dy=${dy.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  assert.ok(sawLiquid, "peer: the regime armed");
  assert.ok(done, `peer: passed under the blocker (x=${mob.pos.x.toFixed(2)})`);
}
console.log("PASS liquid-peer-under");

// --- pool parity: the column never arms, the hop still fires ------------
{
  buildPool();
  const feet = floatTargetY(2, PIG_H);
  const mob = makeMob("pig", 6.5, feet, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, sawHop = false, done = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    if (mob.hop) sawHop = true;
    if (mob.pos.x > 10.5) { done = true; break; }
  }
  assert.ok(done, "pool: crossed");
  assert.ok(!sawLiquid, "pool: the column regime never armed");
  assert.ok(sawHop, "pool: the legacy hop still fires");
}
console.log("PASS liquid-pool-parity");

// --- tall 1x1x10 column, lone mob: center, rise to the top, cross ------
function buildTallColumn() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 10; y++) setBlock(6, y, 6, WATER);
}
{
  buildTallColumn();
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, sawFloat = false, maxY = -Infinity, done = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    if (mob.liquid?.phase === "float") sawFloat = true;
    maxY = Math.max(maxY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `tall: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  assert.ok(sawLiquid, "tall: the regime armed");
  assert.ok(sawFloat, "tall: reached the float phase");
  assert.ok(maxY > 10.0, `tall: rose to the top (maxY=${maxY.toFixed(2)})`);
  assert.ok(done, `tall: crossed and left (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(Math.abs(mob.pos.y - 1) < 0.1, `tall: stands on the ground (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS liquid-tall-cross");

// --- ground-level peer next to the shaft never drags the climber down --
{
  buildTallColumn();
  // Static pen mate standing on the ground, hugging the column base.
  const mate = {
    type: "pig", dim: "over", pos: { x: 7.2, y: 1, z: 6.5 }, vel: { y: 0 },
    hw: 0.32, h: PIG_H, nose: specCircles(LIVESTOCK_SPECS.pig).nose,
    tail: specCircles(LIVESTOCK_SPECS.pig).tail,
    maxDrop: 1, alive: true, root: null, yaw: 0, speed: 0,
  };
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  const peers = [mob, mate];
  let maxY = -Infinity, done = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand, peers, null);
    maxY = Math.max(maxY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `mate: body in wall @tick${t}`);
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  assert.ok(maxY > 10.0, `mate: rose past the ground mate (maxY=${maxY.toFixed(2)})`);
  assert.ok(done, `mate: crossed and left (x=${mob.pos.x.toFixed(2)})`);
}
console.log("PASS liquid-mate-no-drag");

// --- frontal cone: <=45° arms, abeam never does ---------------------------
{
  buildShaft();
  // Diagonal approach toward the column (facing its corner): the fan catches it.
  const diag = makeMob("pig", 5.75, 1, 5.75, Math.PI / 4);
  assert.ok(liquidEntryProbe(diag, false)?.wet === false, "cone: diagonal approach arms");
  // Abeam: walking parallel north of the column, water at 90° — no draw.
  const abeam = makeMob("pig", 6.5, 1, 7.6, 0);
  assert.equal(liquidEntryProbe(abeam, false), null, "cone: abeam graze never arms");
  // Facing away: nothing ahead.
  const away = makeMob("pig", 5.6, 1, 6.5, -Math.PI / 2);
  assert.equal(liquidEntryProbe(away, false), null, "cone: facing away never arms");
}
console.log("PASS liquid-cone");

// --- liquid-faced rides break at the first corner instead of turning ----
function buildWaterWall() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 12);
  for (let y = 1; y <= 2; y++) for (let x = 2; x <= 6; x++) setBlock(x, y, 5, WATER);
}
{
  buildWaterWall();
  // South of the liquid edge, walking east: flank-latches the liquid face.
  const mob = makeMob("pig", 3.0, 1, 4.5, Math.PI / 2, { pinWallRide: true });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 4.5 });
  let latchedLiquid = false, sawLane = false, releasedPastTip = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.followLine?.liquidFace === true) latchedLiquid = true;
    if (mob.lane) sawLane = true;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `liquid-ride: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 7.5) {
      // Past the tip: the ride must be dropped (no U-turn, still eastward).
      if (mob.lane == null && mob.followLine == null) releasedPastTip = true;
      const wrapped = Math.atan2(Math.sin(mob.yaw - Math.PI / 2), Math.cos(mob.yaw - Math.PI / 2));
      assert.ok(Math.abs(wrapped) < 1.0,
        `liquid-ride: never U-turned (yaw=${mob.yaw.toFixed(2)})`);
      break;
    }
  }
  assert.ok(latchedLiquid, "liquid-ride: latched the liquid face");
  assert.ok(sawLane, "liquid-ride: rode the lane");
  assert.ok(releasedPastTip, "liquid-ride: released past the tip instead of turning");
}
console.log("PASS liquid-ride-break");

// --- house door 2x3x1: no fall while the rear is still wet ---------------
{
  buildWall();
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, minExitY = Infinity;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    // Past the wall top, still touching water: the body must hold the ride —
    // the fall starts only once the whole body (rear included) is dry.
    // (The enter climb is legitimately wet at low height — only the float
    // cruise counts here.)
    if (wet && mob.liquid?.phase === "float" && mob.pos.x > 6.2) minExitY = Math.min(minExitY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `door: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "door: the regime armed");
  assert.ok(done, `door: crossed the 2x3x1 wall and landed (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(minExitY > 3.3, `door: never fell while the rear was wet (minExitY=${minExitY.toFixed(2)})`);
}
console.log("PASS liquid-door-rear-free");

// --- pocket escape: a fully wedged commit backs out instead of grinding --
function buildPocket() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 3; y++) setBlock(6, y, 6, WATER);
  // Stone ring hugging the shaft plus a lid: no horizontal step fits.
  for (let y = 1; y <= 4; y++) {
    setBlock(5, y, 5, STONE); setBlock(5, y, 6, STONE); setBlock(5, y, 7, STONE);
    setBlock(6, y, 5, STONE); setBlock(6, y, 7, STONE);
    setBlock(7, y, 5, STONE); setBlock(7, y, 6, STONE); setBlock(7, y, 7, STONE);
  }
  for (let x = 5; x <= 7; x++) for (let z = 5; z <= 7; z++) setBlock(x, 4, z, STONE);
}
{
  buildPocket();
  const mob = makeMob("pig", 6.5, 1.0, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let armed = false, releases = 0, wasArmed = false;
  for (let t = 0; t < 900; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) { armed = true; wasArmed = true; }
    else if (wasArmed) { releases++; wasArmed = false; }
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `pocket: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
  }
  assert.ok(armed, "pocket: the regime armed inside the shaft");
  assert.ok(releases >= 1, `pocket: the wedge released instead of grinding (${releases})`);
}
console.log("PASS liquid-pocket-escape");

// --- tight slot: pressed against a jamb, never wedges -------------------
function buildTightSlot() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 5; y++) setBlock(6, y, 6, WATER);
  // One stone jamb hugging the shaft on the west side, full height.
  for (let y = 1; y <= 6; y++) setBlock(5, y, 6, STONE);
}
{
  buildTightSlot();
  const mob = makeMob("pig", 5.6, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let done = false, still = 0, maxStill = 0, lastX = 5.6, lastZ = 6.5, lastY = 1;
  let sawLiquid = false, sawRelease = false, wasArmed = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) { sawLiquid = true; wasArmed = true; }
    else if (wasArmed) { sawRelease = true; wasArmed = false; }
    const moved = Math.hypot(mob.pos.x - lastX, mob.pos.z - lastZ, mob.pos.y - lastY);
    lastX = mob.pos.x; lastZ = mob.pos.z; lastY = mob.pos.y;
    if (moved < 1e-4) still++; else still = 0;
    if (mob.liquid) maxStill = Math.max(maxStill, still);
    // The spawn overlaps the jamb on purpose (pressed-against-wall entry):
    // the first ticks own the unwedge, then the body must stay free.
    if (t > 30) assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `slot: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "slot: the regime armed");
  // Embedded start, nose buried in the far jamb: the unwedge frees the
  // body, then the pocket escape releases instead of grinding. Either the
  // mob crosses (water low enough to walk out) or the regime lets go.
  assert.ok(done || sawRelease, "slot: crossed or released");
  assert.ok(maxStill < 150, `slot: never ground in place (maxStill=${maxStill})`);
}
console.log("PASS liquid-tight-slot");

// --- flush lid: ceiling flush with the surface, glide under, drop fast --
function buildFlushLid() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 6; y++) for (let x = 5; x <= 7; x++) setBlock(x, y, 6, WATER);
  for (let x = 4; x <= 8; x++) for (let z = 5; z <= 7; z++) setBlock(x, 7, z, STONE);
}
{
  buildFlushLid();
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, maxY = -Infinity, minFallVy = 0;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    if (!wet) minFallVy = Math.min(minFallVy, mob.vel?.y ?? 0);
    maxY = Math.max(maxY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `flush: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "flush: the regime armed");
  assert.ok(done, `flush: crossed under the flush lid (x=${mob.pos.x.toFixed(2)})`);
  // Drift ride hugs the lid (~5.96 for a ceiling at y=7): the mob must
  // cruise just under it, never ram through it (aabb above guards that).
  assert.ok(maxY < 6.3, `flush: stayed under the ceiling (maxY=${maxY.toFixed(2)})`);
  assert.ok(minFallVy < -8, `flush: the exit fall is ballistic (minFallVy=${minFallVy.toFixed(1)})`);
}
console.log("PASS liquid-flush-lid");

// --- lid with a 1-block air band: full ride, pop allowed, still exits ---
function buildGap1Lid() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 5; y++) for (let x = 5; x <= 7; x++) setBlock(x, y, 6, WATER);
  for (let x = 4; x <= 8; x++) for (let z = 5; z <= 7; z++) setBlock(x, 7, z, STONE);
}
{
  buildGap1Lid();
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, maxY = -Infinity, minFallVy = 0;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    if (!wet) minFallVy = Math.min(minFallVy, mob.vel?.y ?? 0);
    maxY = Math.max(maxY, mob.pos.y);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "gap1: the regime armed");
  assert.ok(done, `gap1: crossed under the raised lid (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(maxY < 6.5, `gap1: never rammed through the lid (maxY=${maxY.toFixed(2)})`);
  assert.ok(minFallVy < -8, `gap1: the exit fall is ballistic (minFallVy=${minFallVy.toFixed(1)})`);
}
console.log("PASS liquid-gap1-lid");

// --- house door with a low lintel: dip under it, exit, drop rear-free ---
function buildDoorLintel() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 12);
  for (let y = 1; y <= 3; y++) for (let z = 6; z <= 7; z++) setBlock(6, y, z, WATER);
  for (let y = 1; y <= 4; y++) { setBlock(6, y, 5, STONE); setBlock(6, y, 8, STONE); }
  for (let x = 5; x <= 7; x++) for (let z = 5; z <= 8; z++) setBlock(x, 4, z, STONE);
}
{
  buildDoorLintel();
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, minExitY = Infinity, minFallVy = 0;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    if (wet && mob.liquid?.phase === "float" && mob.pos.x > 6.2) minExitY = Math.min(minExitY, mob.pos.y);
    if (!wet) minFallVy = Math.min(minFallVy, mob.vel?.y ?? 0);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `lintel-door: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "lintel-door: the regime armed");
  assert.ok(done, `lintel-door: threaded the lidded door (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(minExitY > 2.2, `lintel-door: held the drift until the rear cleared (minExitY=${minExitY.toFixed(2)})`);
  assert.ok(minFallVy < -5, `lintel-door: the exit fall is ballistic (minFallVy=${minFallVy.toFixed(1)})`);
}
console.log("PASS liquid-door-lintel");

// --- walled top: exit blocked on three sides, never grind in place ------
function buildWalledTop() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(-6, 14, 0, 14);
  for (let y = 1; y <= 8; y++) setBlock(0, y, 6, WATER);
  for (let y = 1; y <= 12; y++) for (let z = 5; z <= 7; z++) setBlock(2, y, z, STONE);
  for (let y = 6; y <= 12; y++) for (let x = -1; x <= 1; x++) {
    setBlock(x, y, 5, STONE);
    setBlock(x, y, 8, STONE);
  }
}
{
  buildWalledTop();
  const mob = makeMob("pig", -4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, sawRelease = false, wasArmed = false, maxStill = 0, still = 0;
  let lastX = -4.5, lastZ = 6.5, lastY = 1;
  for (let t = 0; t < 2500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) { sawLiquid = true; wasArmed = true; }
    else if (wasArmed) { sawRelease = true; wasArmed = false; }
    const moved = Math.hypot(mob.pos.x - lastX, mob.pos.y - lastY, mob.pos.z - lastZ);
    lastX = mob.pos.x; lastY = mob.pos.y; lastZ = mob.pos.z;
    if (moved < 1e-4) still++; else still = 0;
    if (mob.liquid) maxStill = Math.max(maxStill, still);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `walled-top: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
  }
  assert.ok(sawLiquid, "walled-top: the regime armed");
  assert.ok(sawRelease, "walled-top: the pocket released instead of grinding");
  assert.ok(maxStill < 200, `walled-top: never ground in place (maxStill=${maxStill})`);
}
console.log("PASS liquid-walled-top");

// --- fall parity: the post-exit fall reads exactly like the dry step ----
{
  buildTallColumn();
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let minFallVy = 0, done = false, leftWaterAt = -1;
  for (let t = 0; t < 3000; t++) {
    const wasWet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    if (!wet) minFallVy = Math.min(minFallVy, mob.vel?.y ?? 0);
    if (wasWet && !wet && leftWaterAt < 0) leftWaterAt = t;
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(done, `fall-parity: crossed and landed (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(minFallVy < -15, `fall-parity: ballistic step-speed fall (minFallVy=${minFallVy.toFixed(1)})`);
}
console.log("PASS liquid-fall-parity");

// --- lidded 1-deep door: no fall until the rear clears, like the free fall
{
  buildDoorLintel();
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, done = false, minHoldY = Infinity, minFallVy = 0;
  let dropExitClear = null;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
    const exitClear = liquidExitClear(mob);
    // Float cruise with the rear still in: hold the drift, never sag early.
    if (mob.liquid?.phase === "float" && !exitClear) minHoldY = Math.min(minHoldY, mob.pos.y);
    // The exit fall starts only once the rear is out (small overlap).
    if (dropExitClear == null && mob.liquid?.phase === "float" && mob.pos.x > 6.2
      && (mob.vel?.y ?? 0) < -1) dropExitClear = exitClear;
    if (!wet) minFallVy = Math.min(minFallVy, mob.vel?.y ?? 0);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `door-1deep: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "door-1deep: the regime armed");
  assert.ok(done, `door-1deep: threaded the lidded door and landed (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(minHoldY > 2.0, `door-1deep: held the drift until the rear cleared (minHoldY=${minHoldY.toFixed(2)})`);
  assert.ok(dropExitClear === true, "door-1deep: the fall started rear-clear, like the free fall");
  assert.ok(minFallVy < -5, `door-1deep: the exit fall is ballistic (minFallVy=${minFallVy.toFixed(1)})`);
}
// Freestanding 3x3 water column, 5 high: ground top 1, surface top 6.
function buildColumn3x3() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 12);
  for (let y = 1; y <= 5; y++)
    for (let x = 5; x <= 7; x++) for (let z = 5; z <= 7; z++) setBlock(x, y, z, WATER);
}
console.log("PASS liquid-door-1deep-rear-exit");

// --- 3x3 top, side crossing: no stall on the rim -------------------------
{
  buildColumn3x3();
  // Spawn inside the south edge (wet start arms at once), cruise north over
  // the top and out the far rim: the rim-only touch (discs dry, hw rim
  // grazing) keeps driving out instead of holding level with no drive and
  // no fall until the watchdog. Stride-capped XZ every tick: no snap.
  const mob = makeMob("pig", 6.5, 1, 5.3, 0);
  pinCommit(mob, 0, { x: 6.5, z: 11.5 });
  let sawLiquid = false, done = false, still = 0, maxStill = 0, maxXZ = 0, doneAt = -1;
  let lastX = 6.5, lastZ = 5.3;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const moved = Math.hypot(mob.pos.x - lastX, mob.pos.z - lastZ);
    maxXZ = Math.max(maxXZ, moved);
    if (mob.liquid && moved < 1e-4) still++; else still = 0;
    if (mob.liquid) maxStill = Math.max(maxStill, still);
    lastX = mob.pos.x; lastZ = mob.pos.z;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `side3x3: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.z > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; doneAt = t; break; }
  }
  assert.ok(sawLiquid, "side3x3: the regime armed");
  assert.ok(done, `side3x3: crossed the 3x3 top and left (z=${mob.pos.z.toFixed(2)})`);
  assert.ok(maxStill < 150, `side3x3: never stalled on the rim (maxStill=${maxStill})`);
  assert.ok(maxXZ <= 0.07, `side3x3: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  console.log(`side3x3: doneAt=${doneAt} maxStill=${maxStill}`);
}
console.log("PASS liquid-3x3-side-cross");

// --- 3x3 top, corner crossing: no stall on the corner --------------------
{
  buildColumn3x3();
  const mob = makeMob("pig", 5.3, 1, 5.3, Math.PI / 4);
  pinCommit(mob, Math.PI / 4, { x: 11.5, z: 11.5 });
  let sawLiquid = false, done = false, still = 0, maxStill = 0, maxXZ = 0;
  let lastX = 5.3, lastZ = 5.3;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const moved = Math.hypot(mob.pos.x - lastX, mob.pos.z - lastZ);
    maxXZ = Math.max(maxXZ, moved);
    if (mob.liquid && moved < 1e-4) still++; else still = 0;
    if (mob.liquid) maxStill = Math.max(maxStill, still);
    lastX = mob.pos.x; lastZ = mob.pos.z;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `corner3x3: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.pos.z > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; break; }
  }
  assert.ok(sawLiquid, "corner3x3: the regime armed");
  assert.ok(done, `corner3x3: crossed the 3x3 corner and left (x=${mob.pos.x.toFixed(2)},z=${mob.pos.z.toFixed(2)})`);
  assert.ok(maxStill < 150, `corner3x3: never stalled on the corner (maxStill=${maxStill})`);
  assert.ok(maxXZ <= 0.07, `corner3x3: no snap (maxXZ=${maxXZ.toFixed(3)})`);
}
console.log("PASS liquid-3x3-corner-cross");

// --- 3x3 east face, parallel rim graze while armed: slide, never stall --
{
  buildColumn3x3();
  // Spawn half-immersed at the east face (the rim graze arms wet), cruise
  // north parallel to the face: the body rises to the top with only the
  // side rim touching — the drive must keep sliding (the vertical holds
  // the level) instead of cutting with no fall until the watchdog fires.
  const mob = makeMob("pig", 7.9, 4.5, 5.0, 0);
  pinCommit(mob, 0, { x: 7.9, z: 11.5 });
  let sawLiquid = false, done = false, still = 0, maxStill = 0, maxXZ = 0, doneAt = -1;
  let lastX = 7.9, lastZ = 5.0;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    const moved = Math.hypot(mob.pos.x - lastX, mob.pos.z - lastZ);
    maxXZ = Math.max(maxXZ, moved);
    if (mob.liquid && moved < 1e-4) still++; else still = 0;
    if (mob.liquid) maxStill = Math.max(maxStill, still);
    lastX = mob.pos.x; lastZ = mob.pos.z;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `graze3x3: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.z > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; doneAt = t; break; }
  }
  assert.ok(sawLiquid, "graze3x3: the regime armed");
  assert.ok(done, `graze3x3: slid the face and left (z=${mob.pos.z.toFixed(2)})`);
  assert.ok(maxStill < 150, `graze3x3: never stalled on the rim (maxStill=${maxStill})`);
  assert.ok(maxXZ <= 0.07, `graze3x3: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  console.log(`graze3x3: doneAt=${doneAt}`);
}
console.log("PASS liquid-3x3-rim-graze");

// --- 3x3 corner, armed rim graze in air: slide out, never stall --------
{
  buildColumn3x3();
  // The user's stuck pose: armed at the top, discs dry in air beside the
  // column, only the hw corner still grazing water, feet below the surface.
  // The old law cut the drive here (discs dry) with the vertical holding
  // the level — no drive, no fall, watchdog churn. The unified law keeps
  // driving while the rim grazes, then falls once fully clear.
  const mob = makeMob("pig", 8.2, 5.5, 7.9, 0);
  pinCommit(mob, 0, { x: 8.2, z: 11.5 });
  mob.liquid = { phase: "float", t: 0 };
  let done = false, still = 0, maxStill = 0, maxXZ = 0, doneAt = -1;
  let lastX = 8.2, lastZ = 7.9;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    const moved = Math.hypot(mob.pos.x - lastX, mob.pos.z - lastZ);
    maxXZ = Math.max(maxXZ, moved);
    if (mob.liquid && moved < 1e-4) still++; else still = 0;
    if (mob.liquid) maxStill = Math.max(maxStill, still);
    lastX = mob.pos.x; lastZ = mob.pos.z;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `cornerHold: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.z > 9.5 && mob.liquid == null && mob.pos.y < 1.2) { done = true; doneAt = t; break; }
  }
  assert.ok(done, `cornerHold: slid out of the corner graze (z=${mob.pos.z.toFixed(2)})`);
  assert.ok(maxStill < 60, `cornerHold: never stalled (maxStill=${maxStill})`);
  assert.ok(maxXZ <= 0.07, `cornerHold: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  console.log(`cornerHold: doneAt=${doneAt} maxStill=${maxStill}`);
}
console.log("PASS liquid-3x3-corner-hold");

// --- open-pool crossing: yield, glide, pass, no snap ---------------------
function buildMeetPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let x = 2; x <= 10; x++) for (let z = 2; z <= 10; z++) setBlock(x, 1, z, WATER);
}
{
  buildMeetPool();
  const feet = floatTargetY(2, PIG_H);
  // Perpendicular courses: west->east meets south->north near the middle,
  // then both walk clear — a brush, never a deadlock.
  const a = makeMob("pig", 2.5, feet, 5.5, Math.PI / 2, { rand: () => 0.3 });
  pinCommit(a, Math.PI / 2, { x: 10.5, z: 5.5 });
  const b = makeMob("pig", 6.5, feet, 2.5, 0, { rand: () => 0.7 });
  pinCommit(b, 0, { x: 6.5, z: 10.5 });
  const list = [a, b];
  let maxXZ = 0, maxPre = 0, minWetY = Infinity, met = false;
  let la = { x: 2.5, z: 5.5 }, lb = { x: 6.5, z: 2.5 };
  for (let t = 0; t < 2400; t++) {
    for (const m of list) tickFarmMob(m, DT, (m) => m.target, m.rand, list, null);
    separateFarmMobs(list, null);
    maxXZ = Math.max(maxXZ, Math.hypot(a.pos.x - la.x, a.pos.z - la.z),
      Math.hypot(b.pos.x - lb.x, b.pos.z - lb.z));
    la = { x: a.pos.x, z: a.pos.z }; lb = { x: b.pos.x, z: b.pos.z };
    for (const m of list) {
      const wet = liquidSurface(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) != null;
      if (wet) minWetY = Math.min(minWetY, m.pos.y);
      assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
        `meet: body in wall @tick${t}`);
    }
    if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 1.5) met = true;
    const w = worstPairPen(a, b, 0, 1);
    if (w) maxPre = Math.max(maxPre, w.pen);
    if (a.pos.x > 9.5 && b.pos.z > 9.5) break;
  }
  assert.ok(met, "meet: the courses actually crossed");
  assert.ok(a.pos.x > 9.5 && b.pos.z > 9.5,
    `meet: both walked clear (a.x=${a.pos.x.toFixed(2)},b.z=${b.pos.z.toFixed(2)})`);
  assert.ok(maxPre < 0.35, `meet: brushes only, no deep overlap (maxPre=${maxPre.toFixed(3)})`);
  assert.ok(maxXZ <= 0.07, `meet: no snap on either body (maxXZ=${maxXZ.toFixed(3)})`);
  assert.ok(minWetY > 1.2, `meet: never sank (minWetY=${minWetY.toFixed(2)})`);
}
console.log("PASS liquid-meet-glide");

// --- capped under a peer: hold depth, rise when the field is free --------
{
  buildShaft();
  for (let y = 1; y <= 5; y++) { setBlock(7, y, 6, WATER); setBlock(6, y, 5, WATER); setBlock(7, y, 5, WATER); }
  const rideY = floatTargetY(6, PIG_H);
  const peer = {
    type: "pig", dim: "over", pos: { x: 6.5, y: rideY, z: 6.5 }, vel: { y: 0 },
    hw: 0.32, h: PIG_H, nose: specCircles(LIVESTOCK_SPECS.pig).nose,
    tail: specCircles(LIVESTOCK_SPECS.pig).tail,
    maxDrop: 1, alive: true, root: null, yaw: 0, speed: 0,
  };
  const mob = makeMob("pig", 4.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  const peers = [mob, peer];
  let sawLiquid = false, done = false, cappedTicks = 0, freed = false, roseFree = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand, peers, null);
    if (mob.liquid) sawLiquid = true;
    const dx = mob.pos.x - peer.pos.x, dz = mob.pos.z - peer.pos.z;
    const under = !freed && mob.liquid && Math.hypot(dx, dz) < 0.7;
    if (under) {
      // Under the parked peer: hold below its feet, never snap to the
      // surface through it — while still advancing.
      cappedTicks++;
      assert.ok(mob.pos.y < rideY - 0.3,
        `cap: held under the peer, no surface snap @tick${t} (y=${mob.pos.y.toFixed(2)})`);
    }
    if (!freed && (cappedTicks >= 30 || (cappedTicks > 0 && Math.hypot(dx, dz) > 1.5))) {
      peer.pos.x = 40; peer.pos.z = 40; freed = true;
    }
    if (freed && mob.liquid && mob.pos.y > rideY - 0.35) roseFree = true;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `cap: body in wall @tick${t}`);
    if (freed && mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  assert.ok(sawLiquid, "cap: the regime armed");
  assert.ok(cappedTicks >= 5,
    `cap: advanced while capped without snapping (cappedTicks=${cappedTicks})`);
  assert.ok(roseFree, "cap: rose once the field was free");
  assert.ok(done, `cap: passed under and left (x=${mob.pos.x.toFixed(2)})`);
}
console.log("PASS liquid-cap-rise-when-free");

// --- stack units: caps pick the nearest ceiling, rung spacing holds ------
{
  // Pure reads, no ticks: 5 fabricated bodies at exact rung spacing in a
  // 2x2 shaft (surface 6). Each mob must be capped at its own level by the
  // nearest overhead peer (min picks the closest rung, never collapses to
  // the top), and the top reads no ceiling.
  const rideY = floatTargetY(6, PIG_H);
  const rung = PIG_H + LIQUID_PEER_GAP;
  const levels = [0, 1, 2, 3, 4].map((k) => rideY - k * rung);
  const mk = (y) => ({
    type: "pig", dim: "over", pos: { x: 6.5, y, z: 5.5 }, vel: { y: 0 },
    hw: 0.32, h: PIG_H, alive: true, root: null,
  });
  const stack = levels.map(mk);
  for (let i = 0; i < stack.length; i++) {
    const cap = liquidPeerCapY(stack[i], stack);
    if (i === 0) assert.equal(cap, null, "stack: the top rung reads no ceiling");
    else assert.ok(Math.abs(cap - levels[i]) < 1e-9,
      `stack: rung ${i} capped at its own level by the nearest ceiling (cap=${cap})`);
  }
}
console.log("PASS liquid-stack5-units");

// --- cascade drain: 5 stacked, top-down order, all cross -------------------
{
  buildShaft();
  for (let y = 1; y <= 5; y++) { setBlock(7, y, 6, WATER); setBlock(6, y, 5, WATER); setBlock(7, y, 5, WATER); }
  const rideY = floatTargetY(6, PIG_H);
  const rung = PIG_H + SEP_GAP;
  const list = [];
  for (let k = 0; k < 5; k++) {
    const m = makeMob("pig", 6.5, rideY - k * rung, 5.5, Math.PI / 2);
    pinCommit(m, Math.PI / 2, { x: 11.5, z: 5.5 });
    list.push(m);
  }
  const doneAt = new Map();
  let maxXZ = 0, maxPre = 0, minFallVy = 0, maxArmed = 0, maxStillArmed = 0;
  let deepTicks = 0, longRun = 0, curRun = 0;
  const goals = new Map(list.map((m) => [m, { x: 11.5, z: 5.5 }]));
  const last = list.map((m) => ({ x: m.pos.x, z: m.pos.z }));
  const still = list.map(() => 0);
  for (let t = 0; t < 3600 && doneAt.size < 5; t++) {
    let armed = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      // Re-pin the aim (farm picker would re-pick; the pinned rig picker
      // returns the dropped target): maneuvers in flight are left alone.
      const goal = goals.get(m);
      if (!m._detour && m.target !== goal) {
        m.target = goal; m.wanderT = NO_EXPIRY;
        const h = Math.atan2(goal.x - m.pos.x, goal.z - m.pos.z);
        m.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 99, runT: 0 };
      }
      tickFarmMob(m, DT, (m) => m.target, m.rand, list, null);
      if (m.liquid) armed++;
      const moved = Math.hypot(m.pos.x - last[i].x, m.pos.z - last[i].z);
      maxXZ = Math.max(maxXZ, moved);
      if (m.liquid && moved < 1e-4) still[i]++; else still[i] = 0;
      if (m.liquid) maxStillArmed = Math.max(maxStillArmed, still[i]);
      last[i] = { x: m.pos.x, z: m.pos.z };
      const wet = liquidSurface(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) != null;
      if (!wet) minFallVy = Math.min(minFallVy, m.vel?.y ?? 0);
      assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
        `cascade: body in wall @tick${t}`);
      if (!doneAt.has(m) && m.pos.x > 9.5 && m.liquid == null && m.pos.y < 1.2) doneAt.set(m, t);
    }
    separateFarmMobs(list, null);
    maxArmed = Math.max(maxArmed, armed);
    let tickPre = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      // 3D read like the backstop: vertically stacked bodies share XZ by
      // design (rung spacing), only same-level overlap counts.
      const a = list[i], b = list[j];
      if (a.pos.y >= b.pos.y + b.h - 0.05 || b.pos.y >= a.pos.y + a.h - 0.05) continue;
      const w = worstPairPen(a, b, i, j);
      if (w) { maxPre = Math.max(maxPre, w.pen); tickPre = Math.max(tickPre, w.pen); }
    }
    if (tickPre > 0.15) deepTicks++;
    if (tickPre > 0.05) { curRun++; longRun = Math.max(longRun, curRun); } else curRun = 0;
  }
  assert.equal(doneAt.size, 5, `cascade: all 5 drained (done ${doneAt.size}) ${list.map((m, i) => `${i}:(${m.pos.x.toFixed(2)},${m.pos.y.toFixed(2)},${m.pos.z.toFixed(2)},${m.liquid ? m.liquid.phase : '-'},t${m.target ? 'T' : '-'},adv${(m._adv ?? -1).toFixed(3)},spd${(m.speed ?? -1).toFixed(2)})`).join(" ")}`);
  // No FIFO pin: lateral overtakes are legitimate. What matters is no
  // starvation — every rung keeps moving (well under the 20 s timeout).
  assert.ok(maxStillArmed < 600, `cascade: no rung stalled (maxStillArmed=${maxStillArmed})`);
  assert.ok(maxArmed <= 4, `cascade: shaft load metered (maxArmed=${maxArmed})`);
  assert.ok(maxPre < 0.75, `cascade: centers never coincide past need (maxPre=${maxPre.toFixed(3)})`);
  // A draining queue brushes by design (same proportion as the soak-8:
  // ~12% deep ticks here vs 90/1200 there): transient depth, no persistence.
  assert.ok(deepTicks < 300, `cascade: deep brushes stay transient (deepTicks=${deepTicks})`);
  assert.ok(longRun < 300, `cascade: light file contact never stalls the drain (longRun=${longRun})`);
  console.log(`cascade: maxPre=${maxPre.toFixed(3)} deepTicks=${deepTicks} longRun=${longRun} maxStillArmed=${maxStillArmed}`);
  assert.ok(maxXZ <= 0.07, `cascade: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  assert.ok(minFallVy < -5, `cascade: ballistic exits (minFallVy=${minFallVy.toFixed(1)})`);
}
console.log("PASS liquid-cascade-drain");

// --- top yield: targetless ceiling abandons, the capped rise resumes ----
{
  buildShaft();
  for (let y = 1; y <= 5; y++) { setBlock(7, y, 6, WATER); setBlock(6, y, 5, WATER); setBlock(7, y, 5, WATER); }
  const rideY = floatTargetY(6, PIG_H);
  // All targetless and pre-armed: the top bobs as a ceiling, the rungs
  // below wait capped. Nobody can leave on its own — the only way the
  // chain moves is the top standing aside.
  const rung = PIG_H + 0.1;
  const top = makeMob("pig", 6.5, rideY, 5.5, Math.PI / 2);
  top.liquid = { phase: "float", t: 0 };
  const mid = makeMob("pig", 6.5, rideY - rung, 5.5, Math.PI / 2);
  mid.liquid = { phase: "float", t: 0 };
  const low = makeMob("pig", 6.5, rideY - 2 * rung, 5.5, Math.PI / 2);
  low.liquid = { phase: "float", t: 0 };
  const list = [top, mid, low];
  const midY0 = mid.pos.y;
  let midCappedTicks = 0, releaseTick = -1, roseAfter = false, maxXZ = 0;
  const last = list.map((m) => ({ x: m.pos.x, z: m.pos.z }));
  for (let t = 0; t < 1200; t++) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      tickFarmMob(m, DT, (m) => m.target, m.rand, list, null);
      maxXZ = Math.max(maxXZ, Math.hypot(m.pos.x - last[i].x, m.pos.z - last[i].z));
      last[i] = { x: m.pos.x, z: m.pos.z };
    }
    separateFarmMobs(list, null);
    if (top.liquid == null && releaseTick < 0) releaseTick = t;
    if (mid.liquid && mid.pos.y < rideY - 0.3) midCappedTicks++;
    if (releaseTick >= 0 && mid.pos.y > midY0 + 0.4) roseAfter = true;
    for (const m of list) assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
      `yield: body in wall @tick${t}`);
    if (releaseTick >= 0 && roseAfter) break;
  }
  assert.ok(midCappedTicks >= 30, `yield: the middle waited capped (cappedTicks=${midCappedTicks})`);
  assert.ok(releaseTick >= 0 && releaseTick <= (5 + 2) * 60,
    `yield: the stalled top stood aside in time (releaseTick=${releaseTick})`);
  assert.ok(roseAfter, "yield: the capped rung rose once the ceiling left");
  assert.ok(maxXZ <= 0.07, `yield: no snap while yielding (maxXZ=${maxXZ.toFixed(3)})`);
}
console.log("PASS liquid-top-yield");

// --- entry metering: 6 queued, shaft load capped, all cross ----------------
{
  buildShaft();
  for (let y = 1; y <= 5; y++) { setBlock(7, y, 6, WATER); setBlock(6, y, 5, WATER); setBlock(7, y, 5, WATER); }
  const span = liquidSpanAt(6.5, 5.5, 1, PIG_H);
  const cap = liquidShaftCapacity({ hw: 0.32, h: PIG_H }, span);
  assert.equal(cap, 4, `metering: a 5-high pig shaft holds 4 rungs (cap=${cap})`);
  const list = [];
  for (let k = 0; k < 6; k++) {
    const m = makeMob("pig", 6.5, 1, 4.0 - k * 0.8, Math.PI / 2);
    pinCommit(m, Math.PI / 2, { x: 6.5, z: 11.5 });
    list.push(m);
  }
  let maxArmed = 0, sawQueue = 0;
  const goals = new Map(list.map((m) => [m, { x: 6.5, z: 11.5 }]));
  const doneSet = new Set();
  for (let t = 0; t < 6000 && doneSet.size < 6; t++) {
    let armed = 0, unarmedSouth = 0;
    for (const m of list) {
      // Re-pin the aim while queued/crossing (farm picker would re-pick;
      // the pinned rig picker returns the dropped target): leave detours
      // and already-done roamers alone.
      const goal = goals.get(m);
      if (!doneSet.has(m) && !m._detour && m.target !== goal) {
        m.target = goal; m.wanderT = NO_EXPIRY;
        const h = Math.atan2(goal.x - m.pos.x, goal.z - m.pos.z);
        m.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 99, runT: 0 };
      }
      tickFarmMob(m, DT, (m) => m.target, m.rand, list, null);
      if (m.liquid) armed++;
      else if (m.pos.z < 5) unarmedSouth++;
      assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
        `metering: body in wall @tick${t}`);
      if (!doneSet.has(m) && m.pos.z > 9.5 && m.liquid == null && m.pos.y < 1.2) doneSet.add(m);
    }
    separateFarmMobs(list, null);
    maxArmed = Math.max(maxArmed, armed);
    if (armed >= 1 && unarmedSouth >= 2) sawQueue++;
  }
  const done = doneSet.size;
  assert.ok(maxArmed <= cap, `metering: shaft load capped (maxArmed=${maxArmed}, cap=${cap})`);
  assert.ok(sawQueue > 30, `metering: a real ground queue formed (sawQueue=${sawQueue})`);
  assert.equal(done, 6, `metering: all 6 crossed (done=${done}) ${list.map((m) => `(${m.pos.x.toFixed(1)},${m.pos.y.toFixed(1)},${m.pos.z.toFixed(1)},${m.liquid ? m.liquid.phase : '-'},t${m.target ? 'T' : '-'})`).join(" ")}`);
}
console.log("PASS liquid-entry-metering");

// --- meet10: 5v5 head-on through the 3x3, all cross, no snap --------------
{
  buildColumn3x3();
  const list = [], goals = new Map();
  for (let k = 0; k < 5; k++) {
    const a = makeMob("pig", 4.5 + k, 1, 3.0, 0);
    pinCommit(a, 0, { x: 4.5 + k, z: 11.5 });
    goals.set(a, { x: 4.5 + k, z: 11.5 });
    const b = makeMob("pig", 4.5 + k, 1, 10.0, Math.PI);
    pinCommit(b, Math.PI, { x: 4.5 + k, z: 1.5 });
    goals.set(b, { x: 4.5 + k, z: 1.5 });
    list.push(a, b);
  }
  const doneSet = new Set();
  let maxXZ = 0, maxPre = 0, minWetY = Infinity, maxStillArmed = 0, maxArmed = 0;
  let deepTicks = 0, longRun = 0, curRun = 0;
  const last = list.map((m) => ({ x: m.pos.x, z: m.pos.z }));
  const still = list.map(() => 0);
  const doneAt = new Map();
  for (let t = 0; t < 6000 && doneSet.size < 10; t++) {
    let armed = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const goal = goals.get(m);
      if (!doneSet.has(m) && !m._detour && m.target !== goal) {
        m.target = goal; m.wanderT = NO_EXPIRY;
        const h = Math.atan2(goal.x - m.pos.x, goal.z - m.pos.z);
        m.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 99, runT: 0 };
      }
      tickFarmMob(m, DT, (m) => m.target, m.rand, list, null);
      if (m.liquid) armed++;
      const moved = Math.hypot(m.pos.x - last[i].x, m.pos.z - last[i].z);
      maxXZ = Math.max(maxXZ, moved);
      if (m.liquid && moved < 1e-4) still[i]++; else still[i] = 0;
      if (m.liquid) maxStillArmed = Math.max(maxStillArmed, still[i]);
      last[i] = { x: m.pos.x, z: m.pos.z };
      const wet = liquidSurface(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) != null;
      if (wet) minWetY = Math.min(minWetY, m.pos.y);
      assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
        `meet10: body in wall @tick${t}`);
      const g = goals.get(m);
      if (!doneSet.has(m) && m.liquid == null && m.pos.y < 1.2
        && Math.hypot(m.pos.x - g.x, m.pos.z - g.z) < 1.0) { doneSet.add(m); doneAt.set(m, t); }
    }
    separateFarmMobs(list, null);
    maxArmed = Math.max(maxArmed, armed);
    let tickPre = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.pos.y >= b.pos.y + b.h - 0.05 || b.pos.y >= a.pos.y + a.h - 0.05) continue;
      const w = worstPairPen(a, b, i, j);
      if (w) { maxPre = Math.max(maxPre, w.pen); tickPre = Math.max(tickPre, w.pen); }
    }
    if (tickPre > 0.15) deepTicks++;
    if (tickPre > 0.05) { curRun++; longRun = Math.max(longRun, curRun); } else curRun = 0;
  }
  assert.equal(doneSet.size, 10, `meet10: all 10 crossed (done ${doneSet.size})`);
  assert.ok(maxStillArmed < 600, `meet10: nobody stalled (maxStillArmed=${maxStillArmed})`);
  assert.ok(maxPre < 0.75, `meet10: centers never coincide (maxPre=${maxPre.toFixed(3)})`);
  assert.ok(deepTicks < 400, `meet10: deep brushes stay transient (deepTicks=${deepTicks})`);
  assert.ok(maxXZ <= 0.07, `meet10: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  assert.ok(minWetY > 0.9, `meet10: never sank (minWetY=${minWetY.toFixed(2)})`);
  console.log(`meet10: maxPre=${maxPre.toFixed(3)} deepTicks=${deepTicks} longRun=${longRun} maxStillArmed=${maxStillArmed} maxArmed=${maxArmed}`);
}
console.log("PASS liquid-meet10-headon");

// --- load6 under lids: flush + 1-gap, 6 mobs, all cross, no snap --------
{
  const variants = [
    { build: buildFlushLid, name: "flush", maxY: 6.3 },
    { build: buildGap1Lid, name: "gap1", maxY: 6.5 },
  ];
  for (const v of variants) {
    v.build();
    const list = [], goals = new Map();
    const zs = [4.5, 5.3, 6.1, 6.9, 7.7, 5.7];
    for (let k = 0; k < 6; k++) {
      const m = makeMob("pig", 2.5 + (k % 2) * 0.8, 1, zs[k], Math.PI / 2);
      pinCommit(m, Math.PI / 2, { x: 11.5, z: zs[k] });
      goals.set(m, { x: 11.5, z: zs[k] });
      list.push(m);
    }
    const doneSet = new Set();
    let maxXZ = 0, maxY = -Infinity, minFallVy = 0, maxStillArmed = 0;
    const last = list.map((m) => ({ x: m.pos.x, z: m.pos.z }));
    const still = list.map(() => 0);
    for (let t = 0; t < 6000 && doneSet.size < 6; t++) {
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const goal = goals.get(m);
        if (!doneSet.has(m) && !m._detour && m.target !== goal) {
          m.target = goal; m.wanderT = NO_EXPIRY;
          const h = Math.atan2(goal.x - m.pos.x, goal.z - m.pos.z);
          m.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 99, runT: 0 };
        }
        tickFarmMob(m, DT, (m) => m.target, m.rand, list, null);
        const moved = Math.hypot(m.pos.x - last[i].x, m.pos.z - last[i].z);
        maxXZ = Math.max(maxXZ, moved);
        if (m.liquid && moved < 1e-4) still[i]++; else still[i] = 0;
        if (m.liquid) maxStillArmed = Math.max(maxStillArmed, still[i]);
        last[i] = { x: m.pos.x, z: m.pos.z };
        maxY = Math.max(maxY, m.pos.y);
        const wet = liquidSurface(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) != null;
        if (!wet) minFallVy = Math.min(minFallVy, m.vel?.y ?? 0);
        assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
          `load6-${v.name}: body in wall @tick${t}`);
        if (!doneSet.has(m) && m.pos.x > 9.5 && m.liquid == null && m.pos.y < 1.2) doneSet.add(m);
      }
      separateFarmMobs(list, null);
    }
    assert.equal(doneSet.size, 6, `load6-${v.name}: all 6 crossed (done ${doneSet.size})`);
    assert.ok(maxY < v.maxY, `load6-${v.name}: stayed under the lid (maxY=${maxY.toFixed(2)})`);
    assert.ok(minFallVy < -8, `load6-${v.name}: ballistic exits (minFallVy=${minFallVy.toFixed(1)})`);
    assert.ok(maxStillArmed < 300, `load6-${v.name}: nobody stalled (maxStillArmed=${maxStillArmed})`);
    assert.ok(maxXZ <= 0.07, `load6-${v.name}: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  }
}
console.log("PASS liquid-load6-lidded");

// --- pen soak: 30 mobs, 3x3 shaft, head-on, bounded ------------------------
function buildPenColumn() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 15, 0, 13);
  for (let x = 0; x <= 15; x++) { setBlock(x, 1, 0, STONE); setBlock(x, 1, 13, STONE); }
  for (let z = 1; z <= 12; z++) { setBlock(0, 1, z, STONE); setBlock(15, 1, z, STONE); }
  for (let y = 1; y <= 5; y++)
    for (let x = 7; x <= 9; x++) for (let z = 6; z <= 8; z++) setBlock(x, y, z, WATER);
}
{
  buildPenColumn();
  const list = [], goals = new Map();
  const xs = [2, 4, 6, 10, 12], zs = [2, 4, 6, 8, 10, 12];
  let k = 0;
  for (const z of zs) for (const x of xs) {
    const m = makeMob("pig", x + 0.5, 1, z + 0.5, k % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
    const gx = k % 2 === 0 ? 13.5 : 1.5;
    pinCommit(m, k % 2 === 0 ? Math.PI / 2 : -Math.PI / 2, { x: gx, z: z + 0.5 });
    goals.set(m, { x: gx, z: z + 0.5 });
    m._peerIdx = k;
    list.push(m);
    k++;
  }
  const doneSet = new Set();
  let maxXZ = 0, maxPre3d = 0, minWetY = Infinity, maxStillArmed = 0, maxArmed = 0;
  let deepTicks = 0, longRun = 0, curRun = 0, maxSimHop = 0;
  const last = list.map((m) => ({ x: m.pos.x, z: m.pos.z }));
  const still = list.map(() => 0);
  for (let t = 0; t < 2400 && doneSet.size < 30; t++) {
    const grid = buildMobGrid(list, 3);
    planGroup(list, DT, grid);
    let armed = 0, hops = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const goal = goals.get(m);
      if (!doneSet.has(m) && !m._detour && m.target !== goal) {
        m.target = goal; m.wanderT = NO_EXPIRY;
        const h = Math.atan2(goal.x - m.pos.x, goal.z - m.pos.z);
        m.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 99, runT: 0 };
      }
      tickFarmMob(m, DT, (m) => m.target, m.rand, list, grid);
      if (m.liquid) armed++;
      if (m.hop) hops++;
      const moved = Math.hypot(m.pos.x - last[i].x, m.pos.z - last[i].z);
      maxXZ = Math.max(maxXZ, moved);
      if (m.liquid && moved < 1e-4) still[i]++; else still[i] = 0;
      if (m.liquid) maxStillArmed = Math.max(maxStillArmed, still[i]);
      last[i] = { x: m.pos.x, z: m.pos.z };
      const wet = liquidSurface(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) != null;
      if (wet) minWetY = Math.min(minWetY, m.pos.y);
      assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
        `soak30: body in wall @tick${t}`);
      const g = goals.get(m);
      if (!doneSet.has(m) && m.liquid == null && m.pos.y < 1.2
        && Math.hypot(m.pos.x - g.x, m.pos.z - g.z) < 1.0) doneSet.add(m);
    }
    separateFarmMobs(list, grid);
    maxArmed = Math.max(maxArmed, armed);
    maxSimHop = Math.max(maxSimHop, hops);
    let tickPre = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.pos.y >= b.pos.y + b.h - 0.05 || b.pos.y >= a.pos.y + a.h - 0.05) continue;
      const w = worstPairPen(a, b, i, j);
      if (w) { maxPre3d = Math.max(maxPre3d, w.pen); tickPre = Math.max(tickPre, w.pen); }
    }
    if (tickPre > 0.15) deepTicks++;
    if (tickPre > 0.05) { curRun++; longRun = Math.max(longRun, curRun); } else curRun = 0;
  }
  console.log(`soak30: done=${doneSet.size} maxXZ=${maxXZ.toFixed(3)} maxPre=${maxPre3d.toFixed(3)} deepTicks=${deepTicks} longRun=${longRun} maxStillArmed=${maxStillArmed} maxArmed=${maxArmed} maxSimHop=${maxSimHop} minWetY=${minWetY.toFixed(2)}`);
  assert.equal(doneSet.size, 30, `soak30: all 30 crossed (done=${doneSet.size})`);
  assert.ok(maxStillArmed < 120, `soak30: nobody stalled (maxStillArmed=${maxStillArmed})`);
  // No snap: per-tick XZ stays composed-legitimate — at most a 2-stride
  // pocket glide plus a full separation-cap shove (0.09), far below any
  // teleport. Rock embeds never count: the exact depenetration owns those.
  assert.ok(maxXZ <= 0.10, `soak30: no snap (maxXZ=${maxXZ.toFixed(3)})`);
  assert.ok(maxPre3d < 0.75, `soak30: centers never coincide (maxPre=${maxPre3d.toFixed(3)})`);
  assert.ok(deepTicks < 900, `soak30: deep brushes stay transient (deepTicks=${deepTicks})`);
  assert.ok(longRun < 900, `soak30: light contact never persists (longRun=${longRun})`);
  assert.ok(minWetY > 0.9, `soak30: never sank (minWetY=${minWetY.toFixed(2)})`);
  assert.ok(maxSimHop <= 1, `soak30: no simultaneous hop race (maxSimHop=${maxSimHop})`);
}
console.log("PASS liquid-soak30");

// --- lava column: the same law on every liquid ---------------------------
// Freestanding 1-wide lava column, 10 high. Entry, ride, peer cap, and the
// rear-free exit read no liquid kind — only isLiquid — so a lava shaft
// must cross exactly like a water shaft.
{
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 10; y++) setBlock(6, y, 6, LAVA);
  const sunk = makeMob("pig", 6.5, 1.2, 6.5, 0);
  assert.ok(liquidEntryProbe(sunk, true)?.wet === true, "lava: a body under a tall lava column arms wet");
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, sawFloat = false, maxY = -Infinity, done = false;
  for (let t = 0; t < 3000; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    if (mob.liquid?.phase === "float") sawFloat = true;
    maxY = Math.max(maxY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `lava: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  assert.ok(sawLiquid, "lava: the regime armed");
  assert.ok(sawFloat, "lava: reached the float phase");
  assert.ok(maxY > 10.0, `lava: rose to the top (maxY=${maxY.toFixed(2)})`);
  assert.ok(done, `lava: crossed and left (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(Math.abs(mob.pos.y - 1) < 0.1, `lava: stands on the ground (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS liquid-lava-cross");

// --- ceiling + walls: zero blockage --------------------------------------
// 3x3 liquid shaft, 5 high, stone ceiling at y=6, solid walls against k
// sides. The drift hold under the lid must never strand a body: the wet
// gate commits from the drift (free-floatability, not the feet offset),
// and a boxed body keeps moving — cross, return, or wander, never wedged.
function buildCeilShaft(walls) {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  groundSlab(0, 14, 0, 14);
  for (let y = 1; y <= 5; y++) for (let x = 5; x <= 7; x++) for (let z = 5; z <= 7; z++) setBlock(x, y, z, WATER);
  for (let x = 4; x <= 8; x++) for (let z = 4; z <= 8; z++) setBlock(x, 6, z, STONE);
  for (const s of walls) for (let y = 1; y <= 5; y++) for (let i = 5; i <= 7; i++) {
    if (s === "W") setBlock(4, y, i, STONE);
    if (s === "E") setBlock(8, y, i, STONE);
    if (s === "N") setBlock(i, y, 4, STONE);
    if (s === "S") setBlock(i, y, 8, STONE);
  }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ceiling + west wall: enter from the south, rise to the drift, cruise
// out east under the lid — the drift hold commits instead of becalming.
{
  buildCeilShaft(["W"]);
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLiquid = false, maxY = -Infinity, maxStill = 0, still = 0;
  let lx = mob.pos.x, lz = mob.pos.z, done = false;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.liquid) sawLiquid = true;
    maxY = Math.max(maxY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `ceil-W: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(sawLiquid, "ceil-W: the regime armed");
  assert.ok(maxY > 4.0, `ceil-W: rose to the drift (maxY=${maxY.toFixed(2)})`);
  assert.ok(done, `ceil-W: crossed under the lid (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(maxStill < 300, `ceil-W: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-ceiling-W-cross");

// Ceiling + west/east walls: the far side is shut — cross around the
// north/south or return west, but never wedge.
{
  buildCeilShaft(["W", "E"]);
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let maxStill = 0, still = 0, out = null;
  let lx = mob.pos.x, lz = mob.pos.z;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `ceil-WE: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.pos.x > 9.5 && mob.liquid == null) { out = "cross"; break; }
    if (mob.pos.x < 4.0 && t > 300 && mob.liquid == null) { out = "return"; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(out != null, `ceil-WE: left the shaft (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(maxStill < 300, `ceil-WE: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-ceiling-WE-out");

// Ceiling + three walls (only the south stays open): return to the entry
// side instead of wedging under the lid.
{
  buildCeilShaft(["W", "E", "N"]);
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let maxStill = 0, still = 0, out = null;
  let lx = mob.pos.x, lz = mob.pos.z;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `ceil-WEN: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.pos.x > 9.5 && mob.liquid == null) { out = "cross"; break; }
    if (mob.pos.x < 4.0 && t > 300 && mob.liquid == null) { out = "return"; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(out != null, `ceil-WEN: left the shaft (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(maxStill < 300, `ceil-WEN: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-ceiling-WEN-out");

// Fully boxed shaft + ceiling: physically intraversable — the mob keeps
// moving (the progress trip re-picks past the jitter) instead of
// standing at the wall forever. Unpinned: decide owns the steering.
{
  buildCeilShaft(["W", "E", "N", "S"]);
  const rand = mulberry32(7);
  const mob = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2, { rand });
  mob.target = { x: 11.5, z: 6.5 };
  const pick = (m) => {
    const a = rand() * Math.PI * 2, d = 4 + rand() * 4;
    return { x: m.pos.x + Math.sin(a) * d, z: m.pos.z + Math.cos(a) * d };
  };
  let maxStill = 0, still = 0, done = false;
  let lx = mob.pos.x, lz = mob.pos.z;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, pick, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `ceil-box: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.pos.x > 9.5 && mob.liquid == null) { done = true; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(done, `ceil-box: walked around (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(maxStill < 300, `ceil-box: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-ceiling-box-keepalive");

// --- wet gate: drift holds commit, pool floats never do --------------------
{
  buildPool();
  const feet = floatTargetY(2, PIG_H);
  const poolFloat = makeMob("pig", 6.5, feet, 6.5, 0);
  assert.equal(liquidWetCommit(poolFloat, true), false, "gate: pool floaters never commit");
  assert.equal(liquidEntryProbe(poolFloat, true), null, "gate: pool floaters never arm");
  const wader = makeMob("pig", 2.5, 1, 6.5, Math.PI / 2);
  assert.equal(liquidWetCommit(wader, true), false, "gate: pool-edge waders never commit");
  buildCeilShaft([]);
  const drift = makeMob("pig", 7.08, 4.96, 7.81, Math.PI / 2);
  assert.equal(liquidWetCommit(drift, true), true, "gate: a drift hold under a lid commits");
  assert.ok(liquidEntryProbe(drift, true)?.wet === true, "gate: a drift hold arms wet");
}
console.log("PASS liquid-wet-gate");

// --- floating exits round solids instead of grinding ---------------------
// Pool with a U-trap east (back wall + both arms): a floating mob whose
// exit bearing is solid-blocked latches the wall and follows it around
// (deterministic latch + hold while blocked) instead of dithering
// nose-first and wandering off on a random re-pick.
function buildExitTrap(notch, back) {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) setBlock(x, 0, z, STONE);
  for (let x = 2; x <= 7; x++) for (let z = 2; z <= 9; z++) setBlock(x, 1, z, WATER);
  for (let y = 1; y <= 2; y++) {
    for (let z = 2; z <= 9; z++) {
      if (notch && z === 6) continue;
      setBlock(8, y, z, STONE);
      if (back) setBlock(9, y, z, STONE);
    }
    for (let x = 5; x <= 8; x++) { setBlock(x, y, 2, STONE); setBlock(x, y, 9, STONE); }
  }
}
{
  buildExitTrap(false, false);
  const mob = makeMob("pig", 3.5, 1.7, 5.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 13, z: 5.5 });
  let doneAt = -1, maxStill = 0, still = 0;
  let lx = mob.pos.x, lz = mob.pos.z;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `exit-bypass: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.pos.x > 9.5 && mob.liquid == null) { doneAt = t; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(doneAt >= 0, `exit-bypass: rounded the trap and left (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(doneAt < 1200, `exit-bypass: rounds promptly instead of wandering (t=${doneAt})`);
  assert.ok(maxStill < 150, `exit-bypass: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-exit-bypass");

// --- floating exit through a 1-wide notch stays fast ----------------------
{
  buildExitTrap(true, false);
  const mob = makeMob("pig", 3.5, 1.7, 5.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 13, z: 5.5 });
  let doneAt = -1, maxStill = 0, still = 0;
  let lx = mob.pos.x, lz = mob.pos.z;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `exit-notch: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.pos.x > 9.5 && mob.liquid == null) { doneAt = t; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(doneAt >= 0, `exit-notch: threaded the gap (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(doneAt < 600, `exit-notch: threads directly (t=${doneAt})`);
  assert.ok(maxStill < 60, `exit-notch: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-exit-notch");

// --- dead-end water pocket: round it or come back, never wedge ----------
// U-trap sealed by a back wall (target through it): the mob rounds the
// wall ends or returns west instead of grinding nose-first into the rock.
{
  buildExitTrap(false, true);
  const mob = makeMob("pig", 3.5, 1.7, 5.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 13, z: 5.5 });
  let out = null, maxStill = 0, still = 0;
  let lx = mob.pos.x, lz = mob.pos.z;
  for (let t = 0; t < 2400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `exit-deadend: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.y.toFixed(2)})`);
    if (Math.hypot(mob.pos.x - lx, mob.pos.z - lz) < 1e-9) still++;
    else { maxStill = Math.max(maxStill, still); still = 0; lx = mob.pos.x; lz = mob.pos.z; }
    if (mob.liquid == null && (mob.pos.x > 9.5 || (mob.pos.x < 2.0 && t > 300))) { out = t; break; }
  }
  maxStill = Math.max(maxStill, still);
  assert.ok(out != null, `exit-deadend: rounded the box or came back (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(maxStill < 300, `exit-deadend: never wedged (maxStill=${maxStill})`);
}
console.log("PASS liquid-exit-deadend");

// --- generous peer ceiling: stacked bodies rest with water between -------
// A floater parked at the surface and a climber rising through the same
// shaft: the pass-under cap holds head-to-feet clearance instead of
// pressing the bodies together, and the climber still slides under.
{
  buildTallColumn();
  const rideY = floatTargetY(11, PIG_H);
  const top = makeMob("pig", 6.5, rideY, 6.5, 0);
  const climber = makeMob("pig", 6.5, 1, 6.5, 0);
  pinCommit(climber, Math.PI / 2, { x: 11.5, z: 6.5 });
  const pair = [top, climber];
  let minGap = Infinity, done = false;
  for (let t = 0; t < 3000 && !done; t++) {
    for (const m of pair) tickFarmMob(m, DT, (mm) => mm.target, m.rand, pair, null);
    separateFarmMobs(pair, buildMobGrid(pair, 3));
    if (climber.liquid != null && top.liquid == null
      && Math.hypot(climber.pos.x - top.pos.x, climber.pos.z - top.pos.z) < 0.6
      && Math.abs(climber.pos.y - top.pos.y) > 0.5) {
      const lo = climber.pos.y < top.pos.y ? climber : top;
      const hi = climber.pos.y < top.pos.y ? top : climber;
      minGap = Math.min(minGap, hi.pos.y - (lo.pos.y + lo.h));
    }
    assert.ok(!aabbIntersectsSolid(climber.pos.x, climber.pos.y, climber.pos.z, climber.hw, climber.h),
      `cap-gap: body in wall @tick${t}`);
    if (climber.pos.x > 9.5 && climber.liquid == null) done = true;
  }
  assert.ok(minGap < Infinity, "cap-gap: the pair stacked under the cap");
  assert.ok(minGap >= 0.28, `cap-gap: generous head-to-feet clearance (minGap=${minGap.toFixed(3)})`);
  assert.ok(done, `cap-gap: the climber still slid under and left (x=${climber.pos.x.toFixed(2)})`);
}
console.log("PASS liquid-cap-gap");

// --- cruise spacing: same-bearing floaters hold the generous hitbox ------
// Three abreast in open water on the same commit: the backstop holds them
// apart instead of letting the drives pack them flank-to-flank.
{
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 40; x++) for (let z = 0; z <= 20; z++) {
    setBlock(x, 0, z, STONE);
    if (x >= 2 && x <= 38 && z >= 4 && z <= 10) setBlock(x, 1, z, WATER);
    else setBlock(x, 1, z, STONE);
  }
  const fleet = [
    makeMob("pig", 4.5, 1.7, 6, Math.PI / 2),
    makeMob("pig", 4.5, 1.7, 7, Math.PI / 2),
    makeMob("pig", 4.5, 1.7, 8, Math.PI / 2),
  ];
  for (const m of fleet) pinCommit(m, Math.PI / 2, { x: 35, z: 7 });
  let minXZ = Infinity;
  for (let t = 0; t < 900; t++) {
    for (const m of fleet) tickFarmMob(m, DT, (mm) => mm.target, m.rand);
    separateFarmMobs(fleet, buildMobGrid(fleet, 3));
    if (t > 200 && t < 700) {
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        if (Math.abs(fleet[i].pos.y - fleet[j].pos.y) > 0.5) continue;
        minXZ = Math.min(minXZ, Math.hypot(fleet[i].pos.x - fleet[j].pos.x, fleet[i].pos.z - fleet[j].pos.z));
      }
    }
  }
  assert.ok(minXZ > 0.5, `cruise-gap: same-bearing floaters keep their distance (minXZ=${minXZ.toFixed(3)})`);
}
console.log("PASS liquid-cruise-gap");

console.log("liquidcolumn.test.mjs: ALL PASS");
