// Floating locomotion: float-capable mobs steer on liquid surfaces, ride
// walls while floating, and hop out onto surface-level shores. Vertical
// buoyancy stays universal (1/3 submerged); steering and exits are gated
// by the float capability. The green planner routes float-capable mobs
// through water via the float-walk strategy.
import assert from "node:assert/strict";
import { AIR, STONE, WATER, LAVA } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles, MOB_FLOAT_FRAC, floatTargetY } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid } from "../../../src/mobs/mover.js";
import { liquidSurface, shoreExitTarget, strideTarget, stepShoreHop, GRAVITY, NO_EXPIRY } from "../../../src/mobs/step.js";
import { mobCanFloat } from "../../../src/mobs/registry.js";
import { planPath, assignNav, pickStrategy } from "../../../src/mobs/nav.js";
import { createTarget } from "../../../src/mobs/targets.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const DT = 1 / 60;

// Pool fixture mirroring village geometry: dry ground top at 2, pool
// water with its surface top at 2, so every rim stands exactly at water
// surface level. Water spans x4..8 / z4..8, one cell deep.
function buildPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) setBlock(x, 0, z, STONE);
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    if (x >= 4 && x <= 8 && z >= 4 && z <= 8) setBlock(x, 1, z, WATER);
    else setBlock(x, 1, z, STONE);
  }
}

// Deep pool mirroring real village geometry: dry ground top at 3, water
// two deep with its surface top at 3, obsidian-grade floor top at 1 — a dry
// stepper reads a 2-block drop to the floor and refuses it.
function buildDeepPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) setBlock(x, 0, z, STONE);
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    if (x >= 4 && x <= 8 && z >= 4 && z <= 8) { setBlock(x, 1, z, WATER); setBlock(x, 2, z, WATER); }
    else { setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE); }
  }
}

// Trough-like pool: dry bank top at 3, water surface one above at 4, floor
// too deep to step down to (top 1) — only the level-plus-rise rule admits it.
function buildRisePool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    setBlock(x, 0, z, STONE); setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
  for (let x = 4; x <= 8; x++) for (let z = 4; z <= 8; z++) {
    setBlock(x, 1, z, WATER); setBlock(x, 2, z, WATER); setBlock(x, 3, z, WATER);
  }
}

// High bank over deep water: the surface sits below the feet — refused,
// mobs stay dry (they may walk around, never in).
function buildHighBankPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    setBlock(x, 0, z, STONE); setBlock(x, 1, z, STONE);
    setBlock(x, 2, z, STONE); setBlock(x, 3, z, STONE);
  }
  for (let x = 4; x <= 8; x++) for (let z = 4; z <= 8; z++) {
    setBlock(x, 2, z, AIR); setBlock(x, 3, z, AIR); setBlock(x, 1, z, WATER);
  }
}

// Deep lava pool at bank level: lava reads exactly like water.
function buildLavaPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    setBlock(x, 0, z, STONE); setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
  for (let x = 4; x <= 8; x++) for (let z = 4; z <= 8; z++) {
    setBlock(x, 1, z, LAVA); setBlock(x, 2, z, LAVA);
  }
}
function buildHighPool() {
  buildPool();
  for (let x = 3; x <= 9; x++) { setBlock(x, 2, 3, STONE); setBlock(x, 2, 9, STONE); }
  for (let z = 4; z <= 8; z++) { setBlock(3, 2, z, STONE); setBlock(9, 2, z, STONE); }
}

const PIG_H = specCircles(LIVESTOCK_SPECS.pig).h;
const COW_H = specCircles(LIVESTOCK_SPECS.cow).h;
const SURFACE = 2;

function makeMob(kind, x, y, z, yaw, { floatCapable = true, rand = () => 0.5, pinWallRide = false } = {}) {
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  return {
    type: kind, dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    floatCapable,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK, rand,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    entryScanT: 0, jrng: null, wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
    pinWallRide,
  };
}

// Pinned open-roam commit: fixed heading and target, no re-decides.
function pinCommit(mob, heading, target) {
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: 99, runT: 0 };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- shared immersion convention: 1/3 submerged, every mob -------------
assert.equal(MOB_FLOAT_FRAC, 1 / 3, "float fraction stays 1/3 submerged");
assert.ok(Math.abs(floatTargetY(SURFACE, PIG_H) - (SURFACE - PIG_H / 3)) < 1e-9, "pig float level");
assert.ok(Math.abs(floatTargetY(SURFACE, COW_H) - (SURFACE - COW_H / 3)) < 1e-9, "cow float level");
assert.ok(mobCanFloat({ floatCapable: true }), "explicit float override");
assert.ok(!mobCanFloat({ floatCapable: false }), "explicit non-float override");
assert.ok(!mobCanFloat({ type: "unknown-kind" }), "unknown kinds do not float");
console.log("PASS float-convention");

// --- cruise across the pool and hop out onto the surface-level rim ------
{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  const mob = makeMob("pig", 6.5, feet, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawHop = false, minY = Infinity, done = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.hop) sawHop = true;
    minY = Math.min(minY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `cross: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 10.5) { done = true; break; }
  }
  assert.ok(done, `cross: reached the far bank (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(sawHop, "cross: hopped out onto the rim");
  assert.ok(minY >= feet - 0.06, `cross: never sank (minY=${minY.toFixed(3)})`);
  assert.ok(Math.abs(mob.pos.y - 2.01) < 0.08, `cross: stands on the far bank (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS float-cross-exit");

// --- wall-following while floating: flank ride along the rim -----------
{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  const mob = makeMob("pig", 4.5, feet, 4.4, Math.PI / 2, { pinWallRide: true });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 4.4 });
  let blues = 0, sawHop = false, maxDx = 0;
  for (let t = 0; t < 90; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.hop) sawHop = true;
    if (mob.wallFollow) blues++;
    maxDx = Math.max(maxDx, mob.pos.x - 4.5);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `ride: body in wall @tick${t}`);
    assert.ok(Math.abs(mob.pos.y - feet) < 0.1, `ride: stays at float level (y=${mob.pos.y.toFixed(3)})`);
  }
  assert.ok(blues > 30, `ride: wall-following engages (${blues} blue ticks)`);
  assert.ok(maxDx > 1.5, `ride: travels along the rim (dx=${maxDx.toFixed(2)})`);
  assert.ok(!sawHop, "ride: a flank ride never hops");
}
console.log("PASS float-wall-ride");

// --- exact shore rule at the unit level ---------------------------------
{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  const mob = makeMob("pig", 8.5, feet, 6.5, Math.PI / 2);
  const hop = shoreExitTarget(mob, 1, 0);
  assert.ok(hop, "surface-level rim admits an exit");
  assert.ok(Math.abs(hop.toY - (SURFACE + 0.01)) < 1e-9, "exit lands on the rim top");
  buildHighPool();
  const mob2 = makeMob("pig", 8.5, feet, 6.5, Math.PI / 2);
  assert.equal(shoreExitTarget(mob2, 1, 0), null, "a rim above the surface never admits an exit");
}
console.log("PASS float-shore-rule");

// --- high shores never trigger a hop ------------------------------------
{
  buildHighPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  const mob = makeMob("pig", 6.5, feet, 6.5, Math.PI / 2);
  mob.followCool = 1e9;
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawHop = false, moved = 0;
  const sx = mob.pos.x, sz = mob.pos.z;
  for (let t = 0; t < 400; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.hop) sawHop = true;
    moved = Math.max(moved, Math.hypot(mob.pos.x - sx, mob.pos.z - sz));
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `high: body in wall @tick${t}`);
    assert.ok(Math.abs(mob.pos.y - feet) < 0.12, `high: stays floating (y=${mob.pos.y.toFixed(3)})`);
  }
  assert.ok(!sawHop, "high: never hops onto a raised rim");
  assert.ok(moved > 0.3, `high: still steers in the water (moved ${moved.toFixed(2)} m)`);
}
console.log("PASS float-high-shore");

// --- steering stays exclusive to float-capable mobs ----------------------
{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  const mob = makeMob("pig", 6.5, feet, 6.5, Math.PI / 2, { floatCapable: false });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  for (let t = 0; t < 300; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `gated: body in wall @tick${t}`);
  }
  assert.ok(Math.hypot(mob.pos.x - 6.5, mob.pos.z - 6.5) < 0.2,
    `gated: a non-floating mob holds station (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(Math.abs(mob.pos.y - feet) < 0.05,
    `gated: universal 1/3 immersion still holds (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS float-capability-gate");

// --- deep pool entry: a dry float-capable mob steps down into 2-deep
// water (no hop on entry — exactly one hop total, the exit), with only
// brief transitional contact while tipping over the bank ----------------
{
  buildDeepPool();
  const deepSurface = 3, deepFeet = floatTargetY(deepSurface, PIG_H);
  const mob = makeMob("pig", 2.5, 3, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawWet = false, hopCount = 0, wasHop = false, overlapTicks = 0, minY = Infinity, done = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null) sawWet = true;
    if (mob.hop && !wasHop) hopCount++;
    wasHop = mob.hop != null;
    if (aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h)) overlapTicks++;
    minY = Math.min(minY, mob.pos.y);
    assert.ok(mob.pos.y >= deepFeet - 1.0, `deep: never falls through (y=${mob.pos.y.toFixed(3)})`);
    if (mob.pos.x > 10.5) { done = true; break; }
  }
  assert.ok(done, `deep: crossed the deep pool (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(sawWet, "deep: entered the water");
  assert.equal(hopCount, 1, `deep: exactly one hop (the exit, got ${hopCount})`);
  assert.ok(overlapTicks <= 40, `deep: transitional contact stays bounded (${overlapTicks} ticks)`);
  assert.ok(minY >= deepFeet - 0.06, `deep: never sank (minY=${minY.toFixed(3)})`);
  assert.ok(Math.abs(mob.pos.y - 3.01) < 0.08, `deep: stands on the far bank (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS float-deep-entry");

// --- green planner: float-walk strategy ----------------------------------
assert.equal(pickStrategy({ walk: true }).key, "ground-walk", "walk alone keeps ground-walk");
{
  const s = pickStrategy({ walk: true, float: true });
  assert.equal(s.key, "float-walk", "walk+float picks float-walk");
  assert.equal(s.moves3D, false, "float-walk stays flat for the green overlay");
}
console.log("PASS float-strategy-pick");

{
  // Dry parity: float-walk plans dry ground exactly like ground-walk.
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = -6; x <= 10; x++) for (let z = -6; z <= 6; z++) setBlock(x, 0, z, STONE);
  const mob = makeMob("pig", 0.5, 1, 0.5, 0);
  const target = createTarget("block", { x: 5, y: 0, z: 0 });
  const dry = planPath(mob, target, { capabilities: { walk: true } });
  const wet = planPath(mob, target, { capabilities: { walk: true, float: true } });
  assert.ok(dry && wet, "parity: both strategies plan dry ground");
  const names = (cells) => cells.map((c) => `${c.x},${c.y},${c.z}`).join(" ");
  assert.equal(names(wet.cells), names(dry.cells), "parity: identical dry routes");
}
console.log("PASS float-dry-parity");

{
  // Through water: a dry float-capable mob plans across the pool.
  buildPool();
  const mob = makeMob("pig", 2.5, 2, 6.5, Math.PI / 2);
  const target = createTarget("block", { x: 10, y: 1, z: 6 });
  const p = planPath(mob, target, { capabilities: { walk: true, float: true } });
  assert.ok(p, "nav: a route across the pool exists");
  const wet = (c) => c.x >= 4 && c.x <= 8 && c.z >= 4 && c.z <= 8;
  assert.ok(p.cells.some(wet), "nav: the float route crosses water");
  const dryOnly = planPath(mob, target, { capabilities: { walk: true } });
  assert.ok(dryOnly, "nav: ground-walk routes around the pool");
  assert.ok(!dryOnly.cells.some(wet), "nav: ground-walk stays dry");
  assert.ok(p.cost < dryOnly.cost, "nav: the water route is shorter");
}
console.log("PASS float-nav-through-water");

{
  // Floating starts plan too, and the executor walks the green route out.
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  const mob = makeMob("pig", 6.5, feet, 6.5, Math.PI / 2);
  const target = createTarget("block", { x: 10, y: 1, z: 6 });
  const started = planPath(mob, target, { capabilities: { walk: true, float: true } });
  assert.ok(started, "nav: a floating mob plans from the water");
  const mob2 = makeMob("pig", 2.5, 2, 6.5, Math.PI / 2, { rand: mulberry32(7) });
  assert.ok(assignNav(mob2, target, { capabilities: { walk: true, float: true } }),
    "nav-exec: a dry mob takes the water route");
  let sawHop = false, done = false;
  for (let t = 0; t < 2500; t++) {
    tickFarmMob(mob2, DT, (m, r) => strideTarget(m, null, r) ?? m.target, mob2.rand);
    if (mob2.hop) sawHop = true;
    assert.ok(!aabbIntersectsSolid(mob2.pos.x, mob2.pos.y, mob2.pos.z, mob2.hw, mob2.h),
      `nav-exec: body in wall @tick${t}`);
    if (!mob2.nav && mob2.pos.x > 9.5) { done = true; break; }
  }
  assert.ok(done, `nav-exec: walked the green route out (x=${mob2.pos.x.toFixed(2)})`);
  assert.ok(sawHop, "nav-exec: exited the water with a hop");
}
console.log("PASS float-nav-exec");

// --- the exit is a true ballistic parabola --------------------------------
{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  // Natural trigger distance: nose contact with the rim, body clear of it.
  const mob = makeMob("pig", 7.5, feet, 6.5, Math.PI / 2);
  const hop = shoreExitTarget(mob, 1, 0);
  assert.ok(hop, "ballistic: an exit solves");
  // Descriptor identities: constant horizontal velocity, gravity-solved
  // vertical launch, peak from physics, exact landing at duration end.
  assert.ok(Math.abs(hop.vx - (hop.toX - hop.fromX) / hop.dur) < 1e-9, "ballistic: constant vx");
  assert.ok(Math.abs(hop.vz - (hop.toZ - hop.fromZ) / hop.dur) < 1e-9, "ballistic: constant vz");
  assert.ok(Math.abs(hop.vy0 - (hop.toY - hop.fromY + 0.5 * GRAVITY * hop.dur * hop.dur) / hop.dur) < 1e-9,
    "ballistic: vy0 solves the landing");
  assert.ok(Math.abs(hop.peak - hop.vy0 * hop.vy0 / (2 * GRAVITY)) < 1e-9, "ballistic: peak from physics");
  // Manual integration follows y(t) = y0 + vy0·t − ½·g·t² exactly.
  mob.hop = { ...hop };
  let maxY = -Infinity, ticks = 0;
  for (;;) {
    const t = Math.min(mob.hop.t + DT, mob.hop.dur);
    const expectY = hop.fromY + hop.vy0 * t - 0.5 * GRAVITY * t * t;
    const expectX = hop.fromX + hop.vx * t;
    const landed = stepShoreHop(mob, DT);
    ticks++;
    if (!landed) {
      assert.ok(Math.abs(mob.pos.y - expectY) < 1e-9, `ballistic: parabolic y @tick${ticks}`);
      assert.ok(Math.abs(mob.pos.x - expectX) < 1e-9, `ballistic: linear x @tick${ticks}`);
    }
    maxY = Math.max(maxY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `ballistic: body in wall @tick${ticks}`);
    if (landed) break;
    assert.ok(ticks < 500, "ballistic: lands in bounded time");
  }
  assert.ok(Math.abs(maxY - (hop.fromY + hop.peak)) < 0.05, `ballistic: reaches the predicted peak (${maxY.toFixed(2)})`);
  assert.ok(Math.abs(mob.pos.x - hop.toX) < 1e-9 && Math.abs(mob.pos.y - hop.toY) < 1e-9,
    "ballistic: touchdown is exact");
}
console.log("PASS float-hop-ballistics");

// --- rise entry: water one block above the bank still admits -----------
{
  buildRisePool();
  const feet = floatTargetY(4, PIG_H);
  const mob = makeMob("pig", 2.5, 3, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawWet = false, hops = 0, wasHop = false, done = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null) sawWet = true;
    if (mob.hop && !wasHop) hops++;
    wasHop = mob.hop != null;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `rise: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 10.5) { done = true; break; }
  }
  assert.ok(done, `rise: crossed the raised water (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(sawWet, "rise: entered the water");
  assert.equal(hops, 1, `rise: exactly one hop (the exit, got ${hops})`);
  assert.ok(Math.abs(mob.pos.y - 3.01) < 0.08, `rise: stands on the far bank (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS float-rise-entry");

// --- high bank over deep water: below-level water is refused ------------
{
  buildHighBankPool();
  const mob = makeMob("pig", 2.5, 4, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawWet = false;
  for (let t = 0; t < 600; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null) sawWet = true;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `high-bank: body in wall @tick${t}`);
    assert.ok(Math.abs(mob.pos.y - 4) < 0.06, `high-bank: stays dry (y=${mob.pos.y.toFixed(3)})`);
  }
  assert.ok(!sawWet, "high-bank: never enters water sitting below the feet");
}
console.log("PASS float-bank-above-refused");

// --- deep lava at bank level: lava reads exactly like water --------------
{
  buildLavaPool();
  const feet = floatTargetY(3, PIG_H);
  const mob = makeMob("pig", 2.5, 3, 6.5, Math.PI / 2);
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawLava = false, hops = 0, wasHop = false, done = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (getBlock(Math.floor(mob.pos.x), Math.floor(mob.pos.y), Math.floor(mob.pos.z)) === LAVA) sawLava = true;
    if (mob.hop && !wasHop) hops++;
    wasHop = mob.hop != null;
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `lava: body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
    if (mob.pos.x > 10.5) { done = true; break; }
  }
  assert.ok(done, `lava: crossed the lava pool (x=${mob.pos.x.toFixed(2)})`);
  assert.ok(sawLava, "lava: floated on lava like on water");
  assert.equal(hops, 1, `lava: exactly one hop (the exit, got ${hops})`);
  assert.ok(Math.abs(mob.pos.y - 3.01) < 0.08, `lava: stands on the far bank (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS float-lava-crossing");

// --- sunk mob: systematic rise back to the shared float level ------------
{
  buildDeepPool();
  const feet = floatTargetY(3, PIG_H);
  const mob = makeMob("pig", 6.5, 1.0, 6.5, 0);
  mob.target = null;
  mob.wanderT = 0;
  let minY = Infinity;
  for (let t = 0; t < 200; t++) {
    tickFarmMob(mob, DT, (m, r) => strideTarget(m, null, r) ?? m.target, mob.rand);
    minY = Math.min(minY, mob.pos.y);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h),
      `rise: body in wall @tick${t}`);
  }
  assert.ok(minY >= 0.95, `rise: never sinks (minY=${minY.toFixed(3)})`);
  assert.ok(Math.abs(mob.pos.y - feet) < 0.06, `rise: floats back up to the surface (y=${mob.pos.y.toFixed(3)})`);
}
console.log("PASS float-rise-from-depth");

console.log("float.test.mjs: ALL PASS");
