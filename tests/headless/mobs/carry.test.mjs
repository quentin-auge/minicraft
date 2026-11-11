// Pure carry/grab tests: ray-AABB picking, occlusion, hold pose, release
// placement, and held-state transitions. No voxels, no store, no THREE —
// solidity arrives as an injected isSolidAt predicate, bodies as duck-typed
// {pos, hw, h} (pos.set only where mutated).
import assert from "node:assert/strict";
import {
  rayAabbT, mobHitOffset, mobCenterOffset, mobBlockedBySolid, pickMob,
  GRAB_SCALE_RATE, GRAB_SCALE_T0, GRAB_SCALE_MIN, GRAB_SCALE_MAX, grabScale,
} from "../../../src/mobs/pick.js";
import {
  CARRY_DIST, CARRY_DOWN, heldMob, holdMob, latchMob, severCarry, isCarried,
  staysHullPinned,
  holdFeet, tickHeld, boxFree, findReleaseSpot, releasePeerFree, settleReleased,
  grabHaulProtected, resolveBlockLanding, applyMobGap, mobReleaseSpot,
} from "../../../src/mobs/carry.js";
import { registerMobType, registerMobSource, allMobs, mobType } from "../../../src/mobs/registry.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";

const eye = { x: -1, y: 1, z: 0.5 };
const fwd = { x: 1, y: 0, z: 0 };

// --- rayAabbT ---
assert.equal(rayAabbT(eye, fwd, { x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }), 1);
assert.equal(rayAabbT(eye, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }), null);
assert.equal(rayAabbT(eye, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }), null);
// Inside the box reports the exit distance (grab still latches).
assert.ok(rayAabbT({ x: 0.5, y: 1, z: 0.5 }, fwd, { x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }) > 0);

// --- mobHitOffset ---
const mob = { pos: { x: 5, y: 0, z: 0 }, hw: 0.3, h: 1 };
const off = mobHitOffset({ x: 0, y: 0.5, z: 0 }, fwd, mob);
assert.ok(off && Math.abs(off.t - 4.7) < 1e-9);
assert.ok(Math.abs(off.x + 0.3) < 1e-9);
assert.equal(mobHitOffset({ x: 0, y: 5, z: 0 }, fwd, mob), null);
assert.ok(mobHitOffset({ x: 0, y: 0.5, z: 0 }, fwd, mob, 0.5).t < off.t);

// --- occlusion rule ---
assert.equal(mobBlockedBySolid(8, 6), true);
assert.equal(mobBlockedBySolid(5, 6), false);
assert.equal(mobBlockedBySolid(6.5, 6), false); // boundary: not past the wall

// --- pickMob: nearest, occlusion, exclusion ---
const mk = (x, type = "pig") => ({ pos: { x, y: 0, z: 0 }, hw: 0.3, h: 1, alive: true, type });
const e2 = { x: 0, y: 0.5, z: 0 };
assert.equal(pickMob([mk(8), mk(5)], e2, fwd).mob.pos.x, 5);
assert.equal(pickMob([mk(3)], e2, fwd, { blockT: 6 }).mob.pos.x, 3);
assert.equal(pickMob([mk(8), mk(3)], e2, fwd, { blockT: 6 }).mob.pos.x, 3);
assert.equal(pickMob([mk(8)], e2, fwd, { blockT: 6 }), null);
assert.equal(pickMob([mk(5, "dragon"), mk(8)], e2, fwd).mob.pos.x, 5); // no kind filter here
assert.equal(pickMob([mk(5)], e2, fwd, { exclude: () => true }), null);
assert.equal(pickMob([{ ...mk(5), alive: false }], e2, fwd), null);

// --- registry: grabbable defaults off, opt-in per spec ---
assert.equal(mobType(registerMobType({ key: "__carry_probe" }).key).capabilities.grabbable, false);
assert.equal(registerMobType({ key: "__carry_probe2", capabilities: { grabbable: true } }).capabilities.grabbable, true);

// --- hold pose ---
assert.equal(CARRY_DIST, 1.2);
assert.equal(CARRY_DOWN, 0.4);
assert.deepEqual(holdFeet({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: -1 }, 1), { x: 0, y: 9.1, z: -1.2 });

// --- held state ---
const body = () => {
  const pos = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  return {
    pos, vel: { set() {} }, hw: 0.3, h: 1, _carried: false,
    root: { rotation: { y: 0 } }, lane: {}, passage: {}, target: {},
  };
};
const m1 = body(), m2 = body();
holdMob(m1);
assert.equal(heldMob(), m1);
assert.equal(m1._carried, true);
holdMob(m2); // re-hold frees the previous body
assert.equal(m1._carried, false);
assert.equal(heldMob(), m2);
tickHeld({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: -1 }, 0);
assert.deepEqual([m2.pos.x, m2.pos.y, m2.pos.z], [0, 9.1, -1.2]);
assert.equal(m2.root.rotation.y, Math.PI);
severCarry();
assert.equal(heldMob(), null);
assert.equal(m2._carried, false);
assert.equal(m2.target, null);
assert.equal(m2.lane, null); // sever clears stale servo state

// --- hull-pin vs grab-hold arbitration: a carried mob is hook-owned -----
assert.equal(staysHullPinned({ _riding: true }), true, "plain rider stays pinned");
assert.equal(staysHullPinned({ _riding: true, _carried: true }), false, "grabbed rider yields to the hold");
assert.equal(staysHullPinned({ _carried: true }), false, "held mob never boards");
assert.equal(staysHullPinned({}), false, "free mob never pins");
assert.equal(staysHullPinned(null), false, "null-safe");
assert.equal(staysHullPinned(undefined), false, "undefined-safe");
// A grab latch flips a rider out of the pin on the spot.
const rider = { _riding: true, vel: { set() {} } };
assert.equal(staysHullPinned(rider), true);
latchMob(rider);
assert.equal(staysHullPinned(rider), false, "latch hands the frame to the hook");

// --- boxFree / findReleaseSpot on a stub voxel set ---
const solid = new Set(["0,0,0"]);
const isSolidAt = (x, y, z) => solid.has(`${x},${y},${z}`);
assert.equal(boxFree(isSolidAt, 0.5, 0, 0.5, 0.3, 1), false);
assert.equal(boxFree(isSolidAt, 0.5, 1, 0.5, 0.3, 1), true);
assert.deepEqual(findReleaseSpot(isSolidAt, 0.3, 1, 0.5, 1, 0.5), { x: 0.5, y: 1, z: 0.5 });
const r = findReleaseSpot(isSolidAt, 0.3, 1, 0.5, 0, 0.5);
assert.ok(r && boxFree(isSolidAt, r.x, r.y, r.z, 0.3, 1));
assert.ok(Math.abs(r.x - 0.5) <= 2 && Math.abs(r.z - 0.5) <= 2 && r.y >= 0);
solid.add("0,1,0");
const r2 = findReleaseSpot(isSolidAt, 0.3, 1, 0.5, 0, 0.5);
assert.ok(r2 && (r2.x !== 0.5 || r2.z !== 0.5 || r2.y > 0));
for (let dx = -2; dx <= 2; dx++)
  for (let dz = -2; dz <= 2; dz++)
    for (let y = 0; y <= 10; y++) solid.add(`${dx},${y},${dz}`);
assert.equal(findReleaseSpot(isSolidAt, 0.3, 1, 0.5, 0, 0.5), null); // nowhere: caller keeps holding

// --- release peer veto: a live peer's body reads like a wall ---
const freeAir = () => false; // no voxels anywhere
const released = { pos: { x: 9, y: 9, z: 9 }, hw: 0.32, h: 1, alive: true, dim: "over" };
const sitter = { pos: { x: 0.5, y: 1, z: 0.5 }, hw: 0.32, h: 1, alive: true, dim: "over" };
assert.equal(releasePeerFree([], released, 0.5, 1, 0.5), true, "no peers: free");
assert.equal(releasePeerFree([sitter], released, 0.5, 1, 0.5), false, "peer on the spot: blocked");
assert.equal(releasePeerFree([{ ...sitter, alive: false }], released, 0.5, 1, 0.5), true, "dead peers never block");
assert.equal(releasePeerFree([{ ...sitter, dim: "end" }], released, 0.5, 1, 0.5), true, "other dims never block");
assert.equal(releasePeerFree([sitter], released, 5, 1, 5), true, "distant peers never block");
assert.deepEqual(findReleaseSpot(freeAir, 0.32, 1, 0.5, 1, 0.5, 0,
  (x, y, z) => releasePeerFree([sitter], released, x, y, z)), { x: -0.5, y: 1, z: -0.5 },
  "peer-held aim falls through to the ring");
// Voxel-free ring fully peered: null, the caller keeps holding.
const crowd = [];
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++)
  crowd.push({ pos: { x: 0.5 + dx, y: 1, z: 0.5 + dz }, hw: 0.32, h: 1, alive: true, dim: "over" });
assert.equal(findReleaseSpot(freeAir, 0.32, 1, 0.5, 1, 0.5, 0,
  (x, y, z) => releasePeerFree(crowd, released, x, y, z)), null);

// --- ENTER-up abort rule: flights abort, a latched grab haul completes ---
assert.equal(grabHaulProtected("mob", true), false); // flying grab aborts
assert.equal(grabHaulProtected("mob", false), true); // latched haul survives
assert.equal(grabHaulProtected("mobRelease", true), false);
assert.equal(grabHaulProtected("mobRelease", false), false);

// --- generous grab box: head, snout, arms latch; slightest hit captures ---
assert.ok(Math.abs(specCircles(LIVESTOCK_SPECS.pig).grabR - 1.01) < 1e-9);
assert.ok(Math.abs(specCircles(LIVESTOCK_SPECS.cow).grabR - 1.09) < 1e-9);
assert.equal(specCircles(LIVESTOCK_SPECS.pig).grabH, specCircles(LIVESTOCK_SPECS.pig).h);
const headed = { pos: { x: 5, y: 0, z: 0 }, hw: 0.32, h: 1, grabR: 1.0, grabH: 1, alive: true };
// Side ray through the snout plane: inside the grab box, outside the core.
assert.ok(mobHitOffset({ x: 0, y: 0.5, z: 0.9 }, fwd, headed));
assert.equal(mobHitOffset({ x: 0, y: 0.5, z: 0.9 }, fwd, { ...headed, grabR: undefined, grabH: undefined }), null);
assert.equal(pickMob([headed], { x: 0, y: 0.5, z: 0.9 }, fwd).mob, headed);
// Tall grab: above the physics box but inside the visual top.
assert.ok(mobHitOffset({ x: 0, y: 1.5, z: 0 }, fwd, { pos: { x: 5, y: 0, z: 0 }, hw: 0.3, h: 1, grabH: 2, alive: true }));
// Enderman arms reach past the core half-width.
const enderman = { pos: { x: 0, y: 0, z: 0 }, hw: 0.31, h: 2.7, grabR: 0.5, grabH: 2.7, alive: true };
assert.ok(mobHitOffset({ x: 0.45, y: 1.5, z: 5 }, { x: 0, y: 0, z: -1 }, enderman));
assert.equal(mobHitOffset({ x: 0.45, y: 1.5, z: 5 }, { x: 0, y: 0, z: -1 }, { ...enderman, grabR: undefined }), null);
// Overlapping generous boxes still pick nearest.
assert.equal(pickMob([{ ...headed, pos: { x: 8, y: 0, z: 0 } }, headed], e2, fwd).mob.pos.x, 5);

// --- oriented pick box: tight flanks in the mob's yaw frame, head on-axis ---
const quad0 = { pos: { x: 0, y: 0, z: 0 }, hw: 0.32, h: 1, grabSide: 0.32, grabFront: 1.0, grabBack: 0.9, yaw: 0, alive: true };
// Flank beyond the torso but inside the old yaw-independent square: miss
// (a z-traveling ray at x = 0.6 never enters the ±0.32 sides).
assert.equal(mobHitOffset({ x: 0.6, y: 0.5, z: -3 }, { x: 0, y: 0, z: 1 }, quad0), null);
assert.ok(mobHitOffset({ x: 0.6, y: 0.5, z: -3 }, { x: 0, y: 0, z: 1 }, { ...quad0, grabSide: undefined, grabFront: undefined, grabBack: undefined, grabR: 1.0 }));
// Head-zone side ray (z = 0.8, past the torso): latches on the head, t = 2.68.
const hz = mobHitOffset({ x: -3, y: 0.8, z: 0.8 }, fwd, quad0);
assert.ok(hz && Math.abs(hz.t - 2.68) < 1e-9);
// A torso-only box would miss that same head-zone ray.
assert.equal(mobHitOffset({ x: -3, y: 0.8, z: 0.8 }, fwd, { ...quad0, grabFront: 0.58, grabBack: 0.58 }), null);
// Rotated 90° (head toward +x): the head-zone ray now crosses empty flank.
const quad90 = { ...quad0, yaw: Math.PI / 2 };
assert.equal(mobHitOffset({ x: -3, y: 0.8, z: 0.8 }, fwd, quad90), null);
// ...and the facing-axis ray latches the rotated head at t = 2.
const hr = mobHitOffset({ x: 3, y: 0.8, z: 0 }, { x: -1, y: 0, z: 0 }, quad90);
assert.ok(hr && Math.abs(hr.t - 2) < 1e-9);
// No yaw field: convention facing +z.
assert.equal(mobHitOffset({ x: 0.6, y: 0.5, z: -3 }, { x: 0, y: 0, z: 1 }, { ...quad0, yaw: undefined }), null);
assert.ok(mobHitOffset({ x: -3, y: 0.8, z: 0.8 }, fwd, { ...quad0, yaw: undefined }));
// Oriented + scaled: far flank inside the grown side box latches.
const farSide = { pos: { x: 25, y: 0, z: 0 }, hw: 0.15, h: 1, grabSide: 0.3, grabFront: 0.5, grabBack: 0.5, yaw: 0, alive: true };
const farSideHit = pickMob([farSide], { x: 0, y: 0.5, z: 0.51 }, fwd, { boxScale: grabScale });
assert.equal(farSideHit.mob, farSide);
assert.ok(Math.abs(farSideHit.t - (25 - 0.3 * grabScale(25 - 0.3 * GRAB_SCALE_MAX))) < 1e-9);

// --- shared player/mob landing: top-or-before, ride-up in the same cases ---
const colAt = (set) => (x, y, z) => set.has(`${x},${y},${z}`);
const closeTo = (a, b) => Math.abs(a - b) < 1e-9;
const soloSlab = colAt(new Set(["0,5,0"]));
// Top face: rides onto the anchor top.
{
  const r = resolveBlockLanding(soloSlab, 0, 5, 0, [0, 1, 0]);
  assert.equal(r.topLand, true);
  assert.equal(r.topY, 5);
  assert.ok(closeTo(r.tx, 0.5) && closeTo(r.ty, 6.001) && closeTo(r.tz, 0.5));
  assert.ok(closeTo(r.ax, 0.5) && closeTo(r.ay, 6) && closeTo(r.az, 0.5));
}
// Tall side face (q = 2): free cell before the hit, feet at its bottom.
{
  const tower = colAt(new Set(["0,1,0", "0,2,0", "0,3,0", "0,4,0", "0,5,0"]));
  const r = resolveBlockLanding(tower, 0, 3, 0, [1, 0, 0]);
  assert.equal(r.topLand, false);
  assert.ok(closeTo(r.tx, 1.5) && closeTo(r.ty, 3.001) && closeTo(r.tz, 0.5));
  assert.ok(closeTo(r.ax, 1) && closeTo(r.ay, 3.5) && closeTo(r.az, 0.5));
}
// Thin bottom face (q = 0): same ride-up as the player grapple.
assert.ok(closeTo(resolveBlockLanding(soloSlab, 0, 5, 0, [0, -1, 0]).ty, 6.001));
// Thick bottom face (q = 2): before-cell below.
{
  const thick = colAt(new Set(["0,3,0", "0,4,0", "0,5,0"]));
  const r = resolveBlockLanding(thick, 0, 3, 0, [0, -1, 0]);
  assert.equal(r.topLand, false);
  assert.ok(closeTo(r.tx, 0.5) && closeTo(r.ty, 2.001) && closeTo(r.tz, 0.5));
  assert.ok(closeTo(r.ax, 0.5) && closeTo(r.ay, 3) && closeTo(r.az, 0.5));
}
// --- mob arrival gaps mirror applyArriveGap with a body instead of an eye ---
const openAt = () => false;
assert.deepEqual(applyMobGap(openAt, 0.3, 1, { topLand: true, tx: 0.5, ty: 6.001, tz: 0.5 }, [0, 1, 0], 0.15, 0.6), { x: 0.5, y: 6.001, z: 0.5 });
{
  const g = applyMobGap(openAt, 0.3, 1, { topLand: false, tx: 1.5, ty: 3.001, tz: 0.5, ax: 1, ay: 3.5, az: 0.5 }, [1, 0, 0], 0.15, 0.6);
  assert.ok(closeTo(g.x, 1.65) && closeTo(g.y, 3.001) && closeTo(g.z, 0.5));
}
assert.deepEqual(applyMobGap(colAt(new Set(["1,4,0"])), 0.3, 1, { topLand: false, tx: 1.5, ty: 3.001, tz: 0.5, ax: 1, ay: 3.5, az: 0.5 }, [1, 0, 0], 0.15, 0.6), { x: 1.5, y: 3.001, z: 0.5 });
{
  const g = applyMobGap(openAt, 0.3, 1, { topLand: false, tx: 0.5, ty: 2.001, tz: 0.5, ax: 0.5, ay: 5.5, az: 0.5 }, [0, -1, 0], 0.15, 0.6);
  assert.ok(closeTo(g.x, 0.5) && closeTo(g.y, 3.9) && closeTo(g.z, 0.5));
}
assert.deepEqual(applyMobGap(colAt(new Set(["0,4,0"])), 0.3, 1, { topLand: false, tx: 0.5, ty: 2.001, tz: 0.5, ax: 0.5, ay: 5.5, az: 0.5 }, [0, -1, 0], 0.15, 0.6), { x: 0.5, y: 2.001, z: 0.5 });
// --- ring without climb: same level or re-hold, never above ---
assert.deepEqual(findReleaseSpot(colAt(new Set(["0,0,0"])), 0.3, 1, 0.5, 0, 0.5, 0), { x: -0.5, y: 0, z: -0.5 });
const walled = new Set();
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) walled.add(`${dx},0,${dz}`);
assert.equal(findReleaseSpot(colAt(walled), 0.3, 1, 0.5, 0, 0.5, 0), null);

// --- distance-scaled box: exact up close, wider far away, bounded above ---
assert.equal(GRAB_SCALE_RATE, 0.005);
assert.equal(GRAB_SCALE_T0, 10);
assert.equal(GRAB_SCALE_MIN, 1.0);
assert.equal(GRAB_SCALE_MAX, 5.0);
assert.equal(grabScale(0), 1.0); // the floor IS the exact box
assert.equal(grabScale(2), 1.0);
assert.equal(grabScale(10), 1);
assert.ok(Math.abs(grabScale(15) - 1.025) < 1e-9);
assert.ok(Math.abs(grabScale(100) - 1.45) < 1e-9);
assert.equal(grabScale(2000), GRAB_SCALE_MAX);
assert.equal(grabScale(-100), GRAB_SCALE_MIN);
// Close fringe (lateral 0.29 at 2 m on a 0.3 box): the exact box latches.
const near = { pos: { x: 2, y: 0, z: 0 }, hw: 0.3, h: 1, alive: true };
const nearEye = { x: 0, y: 0.5, z: 0.29 };
assert.equal(pickMob([near], nearEye, fwd).mob, near);
assert.equal(pickMob([near], nearEye, fwd, { boxScale: grabScale }).mob, near);
// Past the exact box (lateral 0.31): still a miss up close.
assert.equal(pickMob([{ ...near, pos: { x: 2, y: 0, z: 0 } }], { x: 0, y: 0.5, z: 0.31 }, fwd, { boxScale: grabScale }), null);
// Far fringe (lateral 0.31 at 25 m): misses exact, latches scaled.
const farBox = { pos: { x: 25, y: 0, z: 0 }, hw: 0.3, h: 1, alive: true };
const farEye = { x: 0, y: 0.5, z: 0.31 };
assert.equal(pickMob([farBox], farEye, fwd), null);
const scaled = pickMob([farBox], farEye, fwd, { boxScale: grabScale });
assert.equal(scaled.mob, farBox);
assert.ok(Math.abs(scaled.t - (25 - 0.3 * grabScale(25 - 0.3 * GRAB_SCALE_MAX))) < 1e-9);
// No scale passed: legacy single-pass behavior, untouched.
assert.equal(pickMob([farBox], farEye, fwd), null);
// On-center far ray: recomputed (earlier) t on the grown box.
const grown = pickMob([farBox], e2, fwd, { boxScale: grabScale });
assert.equal(grown.mob, farBox);
assert.ok(Math.abs(grown.t - (25 - 0.3 * grabScale(25 - 0.3))) < 1e-9);

// --- generic contract: future kinds plug in with data only ---
// Mob sources aggregate without hardcoding kinds.
const sa = { pos: { x: 1, y: 0, z: 0 } }, sb = { pos: { x: 2, y: 0, z: 0 } }, sc = { pos: { x: 3, y: 0, z: 0 } };
registerMobSource("probe-a", () => [sa]);
registerMobSource("probe-b", () => [sb, sc]);
assert.deepEqual(allMobs().slice(-3), [sa, sb, sc]);
assert.throws(() => registerMobSource("probe-a", () => []), /duplicate/i);
assert.throws(() => registerMobSource("probe-c", null), /invalid/i);
// Freeze flag shared by every tick loop.
const fz = { _carried: false };
assert.equal(isCarried(fz), false);
holdMob(fz);
assert.equal(isCarried(fz), true);
severCarry();
assert.equal(isCarried(fz), false);
assert.equal(heldMob(), null);
// Release hook: type-specific reset runs on settle, after the shared one.
registerMobType({ key: "__rel", release: (m) => { m._relCalled = true; } });
const rm = { pos: { x: 0, y: 0, z: 0, set() {} }, vel: { set() {} }, type: "__rel", target: {}, lane: {}, _carried: true };
settleReleased(rm);
assert.equal(rm._carried, false);
assert.equal(rm._relCalled, true);
assert.equal(rm.target, null);
// Release heading: the mob keeps facing the release direction and gets a
// target 6 m ahead along (sin, cos) — movers drive it until arrival.
const rm2 = { pos: { x: 1, y: 0, z: 4, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, vel: { set() {} }, type: "__rel", target: {}, lane: {}, _carried: true, yaw: 0 };
settleReleased(rm2, Math.PI);
assert.equal(rm2.yaw, Math.PI);
assert.deepEqual(rm2.target, { x: 1 + Math.sin(Math.PI) * 6, z: 4 + Math.cos(Math.PI) * 6 });
assert.equal(typeof rm2.wanderT, "number");
// Minimal future mob (no grab box fields): square fallback, yaw ignored,
// still pickable at any range with the distance scale.
const minimal = { pos: { x: 9, y: 0, z: 0 }, hw: 0.2, h: 0.5, alive: true };
assert.equal(pickMob([minimal], { x: 0, y: 0.25, z: 0.25 }, { x: 1, y: 0, z: 0 }, { boxScale: grabScale }), null);
const minimalHit = pickMob([minimal], { x: 0, y: 0.25, z: 0.1 }, { x: 1, y: 0, z: 0 }, { boxScale: grabScale });
assert.equal(minimalHit.mob, minimal);
assert.deepEqual(
  pickMob([{ ...minimal, yaw: Math.PI / 2 }], { x: 0, y: 0.25, z: 0.1 }, { x: 1, y: 0, z: 0 }, { boxScale: grabScale }).offset,
  minimalHit.offset,
);

// --- centered grab anchor: body middle for every mob, yaw-independent ---
assert.deepEqual(mobCenterOffset({ grabH: 2.7, h: 2.7 }), { x: 0, y: 1.35, z: 0 });
assert.deepEqual(mobCenterOffset({ hw: 0.2, h: 0.5 }), { x: 0, y: 0.25, z: 0 });
assert.deepEqual(mobCenterOffset({}), { x: 0, y: 0.5, z: 0 }); // missing h falls back to 1
assert.deepEqual(mobCenterOffset({ ...quad0, yaw: Math.PI / 2 }), mobCenterOffset(quad0));
assert.deepEqual(mobCenterOffset(enderman), { x: 0, y: 1.35, z: 0 });
// The anchor ignores the aim point: a flank hit latches selection, the hook
// still grabs the middle.
{
  const side = mobHitOffset({ x: 0, y: 0.5, z: 0.9 }, fwd, headed);
  assert.ok(side && Math.abs(side.x - 1.0) > 1e-9);
  assert.deepEqual(mobCenterOffset(headed), { x: 0, y: 0.5, z: 0 });
}
// --- live follow: the anchor is re-derived from the live body every frame,
// so a falling mob drags its anchor down with it ---
{
  const falling = { pos: { x: 5, y: 10, z: 0 }, h: 1, grabH: 1 };
  const anchorOf = () => {
    const c = mobCenterOffset(falling);
    return { x: falling.pos.x + c.x, y: falling.pos.y + c.y, z: falling.pos.z + c.z };
  };
  assert.deepEqual(anchorOf(), { x: 5, y: 10.5, z: 0 });
  for (let f = 0; f < 3; f++) {
    falling.pos.y -= 2; // one falling frame
    const c = mobCenterOffset(falling);
    assert.deepEqual(anchorOf(), { x: falling.pos.x + c.x, y: falling.pos.y + c.y, z: falling.pos.z + c.z });
  }
  assert.deepEqual(anchorOf(), { x: 5, y: 4.5, z: 0 });
}

// --- latch: freeze at head arrival, never at fire ---
// The mob stays simulated (falling, wandering) for the whole head flight
// and only freezes when the head latches — so latch is separate from hold.
{
  let velZeroed = 0;
  const falling = { pos: { x: 0, y: 5, z: 0 }, vel: { set() { velZeroed++; } }, _carried: false };
  assert.equal(isCarried(falling), false); // live during the flight
  latchMob(falling);
  assert.equal(isCarried(falling), true);
  assert.equal(velZeroed, 1);
  latchMob(falling); // idempotent: a second latch is a no-op freeze
  assert.equal(isCarried(falling), true);
  assert.equal(latchMob(null), null);
  assert.equal(heldMob(), null); // latch claims no hand: hold still owns that
}

// --- mobReleaseSpot: the shared grapple-equivalent resolution ---
// (hook ferry and cheat spawn menu resolve through this one function)
const spotClose = (s, x, y, z) =>
  assert.ok(s && closeTo(s.x, x) && closeTo(s.y, y) && closeTo(s.z, z),
    `expected ~(${x},${y},${z}), got ${s ? `(${s.x},${s.y},${s.z})` : s}`);
// Top face: rides onto the anchor top.
spotClose(mobReleaseSpot(soloSlab, 0.3, 1, 0, 5, 0, [0, 1, 0]), 0.5, 6.001, 0.5);
{
  // Tall side face: before-cell plus the arrival backoff.
  const tower = colAt(new Set(["0,1,0", "0,2,0", "0,3,0", "0,4,0", "0,5,0"]));
  spotClose(mobReleaseSpot(tower, 0.3, 1, 0, 3, 0, [1, 0, 0]), 1.65, 3.001, 0.5);
  // Backoff blocked (a cell the exact stop never touches): the exact stop
  // is kept.
  const towerGap = colAt(new Set(["0,1,0", "0,2,0", "0,3,0", "0,4,0", "0,5,0", "2,4,0"]));
  spotClose(mobReleaseSpot(towerGap, 0.3, 1, 0, 3, 0, [1, 0, 0], null, { arriveGap: 0.6 }), 1.5, 3.001, 0.5);
  // Exact stop blocked too: the same-level ring answers, never above.
  const towerFull = colAt(new Set(["0,1,0", "0,2,0", "0,3,0", "0,4,0", "0,5,0", "1,4,0", "1,3,0"]));
  const rs = mobReleaseSpot(towerFull, 0.3, 1, 0, 3, 0, [1, 0, 0]);
  spotClose(rs, 0.5, 3.001, -0.5);
  // Custom gaps flow through untouched.
  spotClose(mobReleaseSpot(tower, 0.3, 1, 0, 3, 0, [1, 0, 0], null, { arriveGap: 0 }), 1.5, 3.001, 0.5);
}
{
  // Thick bottom face: dangles below the anchor when it fits.
  const thick = colAt(new Set(["0,3,0", "0,4,0", "0,5,0"]));
  spotClose(mobReleaseSpot(thick, 0.3, 1, 0, 3, 0, [0, -1, 0]), 0.5, 1.4, 0.5);
}
// Fully peer-vetoed: null, the caller keeps holding (or reports No spot).
assert.equal(mobReleaseSpot(soloSlab, 0.3, 1, 0, 5, 0, [0, 1, 0], () => false), null);

console.log("carry.test.mjs: ok");
