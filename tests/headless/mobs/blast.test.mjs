// Unified ballistics: one airborne rule (core/launch.js stepAir) for every
// body — player or mob. Thrown arcs (mega launch, grapple fling, fly exit)
// are just initial velocities: no arming, no gates. Three-free rig on live
// voxels, plus pure stepAir drills.
import assert from 'node:assert/strict';
import { STONE, WATER, MOON } from '../../../src/core/blocks.js';
import { resetWorld, setDimension, setBlock, registerInfiniteDim } from '../../../src/core/store.js';
import { LIVESTOCK_SPECS, specCircles } from '../../../src/mobs/livestock.js';
import { FARM_WALK, tickFarmMob, launchMobBlast } from '../../../src/mobs/mover.js';
import * as ballistics from '../../../src/core/launch.js';
import { computeMegaLaunch, megaFlyShove, stepAir, dragAir, steerAir, gravityAt, knockCutoff, GRAVITY, AIR_DRAG, AIR_SNAP, TERMINAL_VELOCITY, LAUNCH_VMAX, KNOCK_DECAY, KNOCK_SNAP, KNOCK_TAIL_FRAC } from '../../../src/core/launch.js';
import { hasSupport, aabbIntersectsSolid, stepVertical, liquidSurface } from '../../../src/mobs/step.js';
import { registerMoonDim, markMoonDirty, isMoonGone, MOON_MIN_Y } from '../../../src/world/moon.js';
import { clearEntryClaims } from '../../../src/mobs/entry.js';

const DT = 1 / 60;
const FLOOR = 1; // feet rest on the y=0 slab

// No dead ends: the old per-case machinery is gone from the shared module.
assert.ok(!('arcBleed' in ballistics), 'no arcBleed state machine');
assert.ok(!('flyExitVerticalizes' in ballistics), 'no fly-exit gate');
assert.ok(!('ARC_LIN' in ballistics), 'no ARC_LIN');
assert.ok(!('PLAYER_GRAVITY' in ballistics), 'no player-only gravity');
assert.equal(typeof ballistics.steerAir, 'function', 'one additive steering rule');
assert.equal(typeof ballistics.megaFlyShove, 'function', 'one fly-shove rule');
assert.equal(ballistics.KNOCK_DECAY, 2.2, 'one shove decay');
assert.equal(ballistics.KNOCK_SNAP, 7.0, 'shove tail cut, no slow glide');
assert.equal(ballistics.KNOCK_TAIL_FRAC, 0.12, 'big-pool cutoff scales with the peak');
// Peak-relative kill floor: small punches keep the fixed floor, big ones
// die below a share of their own peak.
{
  assert.equal(knockCutoff(0), KNOCK_SNAP, 'no peak: fixed floor');
  assert.equal(knockCutoff(1.5 * 15 * KNOCK_DECAY), KNOCK_SNAP, 'R15 peak: fixed floor');
  assert.ok(Math.abs(knockCutoff(1.5 * 40 * KNOCK_DECAY) - KNOCK_TAIL_FRAC * 132) < 1e-9,
    'R40 peak: relative cutoff');
  console.log('knockoff: peak-relative kill floor ok');
}
assert.equal(GRAVITY, 37.44, 'one gravity for every body');

function buildFloor(x0, x1, z0, z1) {
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, 0, z, STONE);
}

function makeCow(x, z, yaw = 0) {
  const spec = LIVESTOCK_SPECS['cow'];
  const shape = specCircles(spec);
  return {
    type: 'cow', dim: 'over', pos: { x, y: FLOOR, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    floatCapable: true,
    yaw, yawTarget: yaw, target: { x, z }, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK, rand: () => 0.37,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: FLOOR, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0, turnHold: 0,
    entryScanT: 0, entryCoolT: 0, entryCoolKey: null, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    pinWallRide: false, _peerIdx: 0,
  };
}

// Ticks the flight to its end; the body must never enter solid on the way.
function flyUntilLanded(m, maxTicks = 480) {
  let t = 0;
  for (; t < maxTicks && m._blast; t++) {
    tickFarmMob(m, DT, () => m.target, m.rand);
    assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
      `flight: body never enters solid @tick${t}`);
  }
  return t;
}

// The one rule, pure: without input a fast throw converges to vertical
// (gravity + shared bleed, snapped below AIR_SNAP). Held input never
// reaches this path — the player steers additively (below), so inertia
// survives steering; mobs never steer.
{
  const v = { x: 30, y: 0, z: 0 };
  let t = 0;
  for (; t * DT < 30 && stepAir(v, DT); t++);
  const T = t * DT;
  assert.ok(!stepAir(v, DT) || Math.hypot(v.x, v.z) === 0, 'settled: vertical');
  assert.ok(T < 12, `no-input throw converges (got ${T.toFixed(2)} s)`);
  // dragAir is the gravity-free half the player controller shares while its
  // own vertical chain applies the single gravity.
  const w = { x: 30, y: 0, z: 0 };
  let u = 0;
  for (; u * DT < 30 && dragAir(w, DT); u++);
  assert.ok(Math.abs((u * DT) - T) < DT * 2, 'shared bleed, same timing');
  console.log(`rule: converge ${T.toFixed(2)} s from 30 m/s`);
}

// Player/mob parity: the same initial velocity integrated through the same
// step reads the identical series — both call sites cannot drift.
{
  const p = { x: 12, y: 20, z: -7 }, m = { x: 12, y: 20, z: -7 };
  for (let i = 0; i < 300; i++) {
    stepAir(p, DT);
    stepAir(m, DT);
    assert.equal(p.x, m.x, `parity x @${i}`);
    assert.equal(p.y, m.y, `parity y @${i}`);
    assert.equal(p.z, m.z, `parity z @${i}`);
  }
  console.log('parity: player and mob arcs identical');
}

// Additive steering: input ADDS a component, never re-aims the body.
// W aligned extends (tapered toward the max, never past it), strafe adds
// sideways while the forward component survives, S brakes toward zero
// without reversing, hover starts along the input.
{
  const v = { x: 30, y: 0, z: 0 };
  let peak = 30;
  for (let t = 0; t * DT < 5; t++) { steerAir(v, 1, 0, 0, DT); peak = Math.max(peak, v.x); }
  assert.ok(v.x > 30 && v.x <= 40, `W aligned extends, capped (got ${v.x.toFixed(2)})`);
  assert.ok(peak <= 40, 'never past the ceiling mid-flight');
  assert.equal(v.z, 0, 'no lateral invention');
  // Strafe keeps the forward component and adds sideways — the old
  // re-aim would have killed x within a second.
  const w = { x: 34, y: 0, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(w, 0, 0, 1, DT);
  assert.ok(Math.abs(w.x - 34) < 0.5, `forward inertia survives strafe (got ${w.x.toFixed(2)})`);
  assert.ok(w.z > 1, `lateral component added (got ${w.z.toFixed(2)})`);
  assert.ok(Math.hypot(w.x, w.z) <= 40 + 1e-6, 'total capped');
  // S brakes live motion toward zero without reversing (the floor only
  // guards braking — from a hover the input drives freely, no dead key).
  const u = { x: 20, y: 0, z: 0 };
  let t = 0;
  for (; t * DT < 10 && u.x > 0.5; t++) {
    steerAir(u, -1, 0, 0, DT);
    assert.ok(u.x >= -1e-9, `no reverse while moving (got ${u.x.toFixed(2)})`);
  }
  assert.ok(t * DT < 10, 'brakes down to hover range');
  const hb = { x: 0, y: 0, z: 0 };
  for (let t2 = 0; t2 * DT < 1; t2++) steerAir(hb, -1, 0, 0, DT);
  assert.ok(hb.x < -1, `hover backs along input (got ${hb.x.toFixed(2)})`);
  // Hover + input starts moving along the input.
  const h = { x: 0, y: 0, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(h, 0, 0, 1, DT);
  assert.ok(h.z > 2 && Math.abs(h.x) < 1e-9, 'hover strafes along input');
  // Diagonal input splits proportionally.
  const d = { x: 10, y: 0, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(d, 1, 0, 1, DT);
  assert.ok(d.x > 10 && d.z > 1, `diagonal adds both (got ${d.x.toFixed(2)}, ${d.z.toFixed(2)})`);
  console.log('steer: additive, capped, no reverse');
}

// Fall cone: in a fast fall the horizontal total is bounded by the fall
// rate — light angle even on long presses, reached fast, eased in.
// Slow falls and up-legs are untouched. steerAir never touches vy.
{
  // Strafe held through a deep fall: capped near the cone, fast.
  const f = { x: 0, y: -35, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(f, 0, 0, 1, DT);
  assert.ok(Math.hypot(f.x, f.z) > 3, `cone reached fast (got ${Math.hypot(f.x, f.z).toFixed(2)})`);
  for (let t = 0; t * DT < 9; t++) steerAir(f, 0, 0, 1, DT);
  assert.ok(Math.hypot(f.x, f.z) < 9, `long press stays light (got ${Math.hypot(f.x, f.z).toFixed(2)})`);
  assert.equal(f.y, -35, 'steering never touches the fall rate');
  // W in a fall: same cone.
  const g = { x: 5, y: -30, z: 0 };
  for (let t = 0; t * DT < 5; t++) steerAir(g, 1, 0, 0, DT);
  assert.ok(g.x < 15, `fall + W stays steep (got ${g.x.toFixed(2)})`);
  assert.equal(g.y, -30, 'steering never touches the fall rate');
  // Over the cone (diving entry): eases down, never snaps.
  const d = { x: 25, y: -30, z: 0 };
  steerAir(d, 0, 0, 1, DT);
  const h1 = Math.hypot(d.x, d.z);
  assert.ok(h1 < 25 && h1 > 6.3, `eased toward the cone (got ${h1.toFixed(2)})`);
  // Slow ease: a held direction keeps its diagonal for a while — a full
  // second later the excess is still largely there, then it rejoins the
  // unified fall.
  const e = { x: 25, y: -30, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(e, 0, 0, 1, DT);
  assert.ok(Math.hypot(e.x, e.z) > 12, `slow ease keeps the diagonal (got ${Math.hypot(e.x, e.z).toFixed(2)})`);
  // Slow fall: no cone, strafe works fully.
  const s = { x: 8, y: -10, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(s, 0, 0, 1, DT);
  assert.ok(s.z > 3, `slow falls steer freely (got ${s.z.toFixed(2)})`);
  // Up-leg: full authority, same input.
  const u = { x: 5, y: 25, z: 0 };
  for (let t = 0; t * DT < 2; t++) steerAir(u, 1, 0, 0, DT);
  assert.ok(u.x > 15, `up-leg steers fully (got ${u.x.toFixed(2)})`);
  console.log('steer: coned falls, free slow air');
}

// Residual authority: at terminal fall the keys never die — enough to
// nudge a landing, coned short of a diagonal.
{
  const v = { x: 0, y: -40, z: 0 };
  for (let t = 0; t * DT < 10; t++) steerAir(v, 0, 0, 1, DT);
  const h = Math.hypot(v.x, v.z);
  assert.ok(h > 2, `terminal fall still steers (got ${h.toFixed(2)})`);
  assert.ok(h < 20, `no diagonal at terminal (got ${h.toFixed(2)})`);
  assert.equal(v.y, -40, 'horizontal input never touches the fall rate');
  console.log('steer: residual authority at terminal');
}

// Look-vertical steering: dive, brake to the sink floor, never pump,
// never climb. S mirrors by construction (opposite input vector).
{
  // Dive: W + mouse down from hover reaches for the terminal.
  const d = { x: 0, y: 0, z: 0 };
  for (let t = 0; t * DT < 2; t++) steerAir(d, 0, -1, 0, DT);
  assert.ok(d.y < -10, `dives (got ${d.y.toFixed(2)})`);
  assert.equal(Math.hypot(d.x, d.z), 0, 'pure vertical input adds no horizontal');
  // Brake: W + mouse up from a fast fall bottoms out at the sink floor.
  const b = { x: 0, y: -30, z: 0 };
  for (let t = 0; t * DT < 10; t++) steerAir(b, 0, 1, 0, DT);
  assert.ok(Math.abs(b.y - (-6)) < 1.0, `brakes to a slow sink (got ${b.y.toFixed(2)})`);
  // No pumping: W + mouse up never raises vy past entry.
  const u = { x: 0, y: 20, z: 0 };
  for (let t = 0; t * DT < 2; t++) steerAir(u, 0, 1, 0, DT);
  assert.equal(u.y, 20, 'never pumps upward');
  // S mirrors: S + mouse up dives.
  const s = { x: 0, y: 0, z: 0 };
  for (let t = 0; t * DT < 2; t++) steerAir(s, 0, -1, 0, DT);
  assert.ok(s.y < -10, `S mirrors the dive (got ${s.y.toFixed(2)})`);
  // Diagonal 45° down: horizontal and vertical grow together.
  const g = { x: 0, y: 0, z: 0 };
  for (let t = 0; t * DT < 1; t++) steerAir(g, 0, -Math.SQRT1_2, Math.SQRT1_2, DT);
  assert.ok(g.z > 3 && g.y < -3, `pitched input splits both axes (got ${g.z.toFixed(2)}, ${g.y.toFixed(2)})`);
  console.log('steer: vertical channel, dives and brakes');
}

// Launcher shape: null outside R, upward kick, clamped horizontal speed,
// and a free-flight range of 1.5R back at start height — through the shared
// step, drag compensation included.
{
  const R = 15;
  assert.equal(computeMegaLaunch(100, 1.9, 100, 0, 0, 0, R), null, 'far body: no launch');
  const v = computeMegaLaunch(0.5, 1.9, 0.5, 0, 0, 0, R);
  assert.ok(v, 'center body launches');
  assert.ok(v.vy > 22 && v.vy <= 30, `up kick 22..30 (got ${v.vy})`);
  const vh = Math.hypot(v.vx, v.vz);
  assert.ok(vh >= 4 && vh <= 40, `horizontal speed clamped 4..40 (got ${vh})`);
  const f = { x: 0.5, y: 1.9, z: 0.5, vx: v.vx, vy: v.vy, vz: v.vz };
  const s = 1 / 240;
  for (let t = 0; t < 2400; t++) {
    const vv = { x: f.vx, y: f.vy, z: f.vz };
    stepAir(vv, s);
    f.vx = vv.x; f.vy = vv.y; f.vz = vv.z;
    f.x += f.vx * s; f.y += f.vy * s; f.z += f.vz * s;
    if (f.vy < 0 && f.y <= 1.9) break;
  }
  const travel = Math.hypot(f.x - 0.5, f.z - 0.5);
  assert.ok(Math.abs(travel - 1.5 * R) < 0.6, `free range ≈ 1.5R (got ${travel})`);
  console.log(`launcher: vy ${v.vy.toFixed(2)}, vh ${vh.toFixed(2)}, range ${travel.toFixed(2)}`);
}

// Crater exit: a mob inside R=15 lands outside R, supported, unharmed.
{
  buildFloor(-110, 110, -110, 110);
  const m = makeCow(5.5, 0.5);
  const v = computeMegaLaunch(m.pos.x, m.pos.y + m.h / 2, m.pos.z, 0, 0, 0, 15);
  assert.ok(v, 'inside body launches');
  launchMobBlast(m, v.vx, v.vy, v.vz);
  assert.ok(m._blast, 'flight state armed');
  const ticks = flyUntilLanded(m);
  assert.ok(!m._blast, 'flight ends (no timeout)');
  assert.ok(ticks < 360, `lands inside the timeout (${ticks} ticks)`);
  const d = Math.hypot(m.pos.x - 0.5, m.pos.z - 0.5);
  assert.ok(d > 15, `lands outside the crater (got ${d.toFixed(2)})`);
  assert.ok(hasSupport(m.pos.x, m.pos.y, m.pos.z, m.hw), 'lands supported');
  console.log(`crater-exit: ${ticks} ticks, dist ${d.toFixed(2)}, y ${m.pos.y.toFixed(2)}`);
}

// World walls: a launch aimed past the east edge slides down the wall and
// lands inside the level — never outside, never stuck.
{
  buildFloor(-110, 110, -110, 110);
  const m = makeCow(90.5, 0.5);
  const v = computeMegaLaunch(m.pos.x, m.pos.y + m.h / 2, m.pos.z, 80, 0, 0, 15);
  assert.ok(v && v.vx > 0, 'wall-bound body launches outward');
  launchMobBlast(m, v.vx, v.vy, v.vz);
  const ticks = flyUntilLanded(m);
  assert.ok(!m._blast, 'walled flight ends');
  assert.ok(Math.abs(m.pos.x) <= 96 && Math.abs(m.pos.z) <= 96,
    `stays inside the level (got ${m.pos.x.toFixed(2)}, ${m.pos.z.toFixed(2)})`);
  assert.ok(hasSupport(m.pos.x, m.pos.y, m.pos.z, m.hw), 'walled landing is supported');
  console.log(`wall-slide: ${ticks} ticks, x ${m.pos.x.toFixed(2)}, y ${m.pos.y.toFixed(2)}`);
}

// Bottomless sky: the bleed runs from release, so the void fall converges
// to vertical on the way down — total drift bounded by v0 / AIR_DRAG.
{
  registerInfiniteDim('tnt');
  resetWorld('tnt'); setDimension('tnt'); clearEntryClaims();
  const m = makeCow(0.5, 0.5);
  m.dim = 'tnt';
  m.pos.y = 100;
  const v = computeMegaLaunch(m.pos.x, m.pos.y + m.h / 2, m.pos.z, 0, 100, 0, 15);
  assert.ok(v, 'void body launches');
  launchMobBlast(m, v.vx, v.vy, v.vz);
  const v0 = Math.hypot(v.vx, v.vz);
  let lastVh = v0, ticks = 0;
  for (; ticks < 480 && m._blast; ticks++) {
    tickFarmMob(m, DT, () => m.target, m.rand);
    if (!m._blast) break;
    lastVh = Math.hypot(m._blast.x, m._blast.z);
  }
  assert.ok(!m._blast, 'void flight ends (timeout)');
  // At the 6 s timeout the residual (~1.3 m/s) is discarded with the flight
  // state and the fall continues straight down; the pure drill above covers
  // full convergence (7.55 s from 30 m/s).
  assert.ok(lastVh < 1.5, `near-vertical at timeout (got ${lastVh.toFixed(2)})`);
  const drift = Math.hypot(m.pos.x - 0.5, m.pos.z - 0.5);
  assert.ok(drift < v0 / AIR_DRAG + 2,
    `void drift is bounded (got ${drift.toFixed(2)})`);
  assert.ok(m.pos.y < 80, `keeps falling (y ${m.pos.y.toFixed(1)})`);
  console.log(`void-fall: drift ${drift.toFixed(2)}, y ${m.pos.y.toFixed(1)}`);
}

// Moon parity: the shared low-g helper halves gravity for any body above
// the lunar floor while the moon lives.
{
  assert.equal(gravityAt(true, false, 200, 100), GRAVITY * 0.5, 'moon sky: half-g');
  assert.equal(gravityAt(true, false, 50, 100), GRAVITY, 'below the moon: full-g');
  assert.equal(gravityAt(false, false, 200, 100), GRAVITY, 'moonless dim: full-g');
  assert.equal(gravityAt(true, true, 200, 100), GRAVITY, 'dead moon: full-g');
  console.log('moon: shared low-g ok');
}

// Terminal parity: every fall converges on the same floor, player or mob.
// A long no-input drop through the shared step and a live mob free-fall
// both settle at TERMINAL_VELOCITY — no divergence past 12 m of void.
{
  assert.equal(TERMINAL_VELOCITY, -40, 'one terminal for every body');
  const v = { x: 3, y: 0, z: -2 };
  for (let t = 0; t * DT < 30; t++) stepAir(v, DT);
  assert.equal(v.y, TERMINAL_VELOCITY, 'shared rule clamps the fall');
  resetWorld('tnt'); setDimension('tnt'); clearEntryClaims();
  const m = makeCow(0.5, 0.5);
  m.dim = 'tnt';
  m.pos.y = 200;
  for (let t = 0; t < 600; t++) tickFarmMob(m, DT, () => m.target, m.rand);
  assert.equal(m.vel.y, TERMINAL_VELOCITY, `mob clamps at the same floor (got ${m.vel.y})`);
  console.log('terminal: shared -40');
}

// Outside R: no launch, the mob keeps its feet.
{
  buildFloor(-40, 40, -40, 40);
  const m = makeCow(30.5, 0.5);
  assert.equal(computeMegaLaunch(m.pos.x, m.pos.y + m.h / 2, m.pos.z, 0, 0, 0, 15), null,
    'outside R: no launch');
  for (let t = 0; t < 60; t++) tickFarmMob(m, DT, () => m.target, m.rand);
  assert.equal(m._blast, undefined, 'no flight state armed');
  assert.equal(m.pos.y, FLOOR, 'feet stay on the floor');
}

// Fly-shove shape: null outside R, 3D line away from the centroid, peak
// from the pool, cap derived from LAUNCH_VMAX — and the same 1.5R travel
// under the KNOCK_DECAY bleed as the ground arc under AIR_DRAG.
{
  const R = 15;
  assert.equal(megaFlyShove(100, 1.9, 100, 0, 0, 0, R), null, 'far body: no shove');
  const s = megaFlyShove(0.5, 1.9, 0.5, 0, 0, 0, R);
  assert.ok(s, 'center body shoves');
  const spd = Math.hypot(s.vx, s.vy, s.vz);
  assert.ok(Math.abs(spd - 1.5 * R * KNOCK_DECAY) < 1e-9, `peak scales with R (got ${spd})`);
  const off = megaFlyShove(5.5, 1.9, 0.5, 0, 0, 0, R);
  assert.ok(off.vx > 0 && off.vy > 0 && Math.abs(off.vz) < 1e-9,
    `shove flees along the 3D line (got ${off.vx.toFixed(2)}, ${off.vy.toFixed(2)}, ${off.vz.toFixed(2)})`);
  const big = megaFlyShove(0.5, 1.9, 0.5, 0, 0, 0, 40);
  assert.equal(Math.hypot(big.vx, big.vy, big.vz), 1.5 * LAUNCH_VMAX * KNOCK_DECAY,
    'cap derives from LAUNCH_VMAX, never a second literal');
  // Pure-bleed travel: v0 / KNOCK_DECAY = 1.5R, mirrored on the arc drill.
  // The center shove is straight up (3D line), so integrate all axes.
  const f = { x: 0.5, y: 1.9, z: 0.5, vx: s.vx, vy: s.vy, vz: s.vz };
  const st = 1 / 240;
  for (let t = 0; t < 2400; t++) {
    const k = Math.exp(-KNOCK_DECAY * st);
    f.vx *= k; f.vy *= k; f.vz *= k;
    f.x += f.vx * st; f.y += f.vy * st; f.z += f.vz * st;
  }
  const travel = Math.hypot(f.x - 0.5, f.y - 1.9, f.z - 0.5);
  assert.ok(Math.abs(travel - 1.5 * R) < 0.6, `shove range ≈ 1.5R (got ${travel.toFixed(2)})`);
  console.log(`shove: spd ${spd.toFixed(2)}, range ${travel.toFixed(2)}`);
}

// Blast over water: liquid contact ends the flight, the float plane takes
// over — the mob never sinks through the lake to the floor.
{
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  buildFloor(-8, 8, -8, 8);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    setBlock(x, 1, z, WATER);
    setBlock(x, 2, z, WATER);
  }
  const m = makeCow(-4.5, 0.5);
  m.pos.y = 5;
  launchMobBlast(m, 10, -1, 0);
  let t = 0;
  for (; t < 360 && m._blast; t++) {
    tickFarmMob(m, DT, () => m.target, m.rand);
    assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
      `flight: body never enters solid @tick${t}`);
  }
  assert.ok(!m._blast, 'flight ends on liquid contact (no timeout)');
  assert.ok(Math.abs(m.pos.x) <= 2.5 && Math.abs(m.pos.z) <= 2.5,
    `finished over the lake (got ${m.pos.x.toFixed(2)}, ${m.pos.z.toFixed(2)})`);
  assert.ok(m.pos.y > FLOOR + 0.5, `liquid ended it above the floor (got ${m.pos.y.toFixed(2)})`);
  // Pin the mob (finish retargets + re-arms roam by design, and a target
  // equal to the position reads as heading 0 and walks): null target keeps
  // the heading, so the cruise walks the rim — with the unified liquid->air
  // exit the floater steps out over the real landing below and drops with
  // gravity (no hop needed when the bank is underfoot) instead of grinding
  // the rim. It must never sink through the lake, clip rock, or drop
  // through the floor on the way out.
  m.target = null;
  m.roam = null; m.wanderT = 1e9;
  let minWetY = Infinity;
  for (let i = 0; i < 240; i++) {
    tickFarmMob(m, DT, () => m.target, m.rand);
    const wet = liquidSurface(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h) != null;
    if (wet) minWetY = Math.min(minWetY, m.pos.y);
    assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
      `finish: body never enters solid @tick${i}`);
    assert.ok(m.pos.y >= FLOOR - 1e-3, `finish: never below the floor (got ${m.pos.y.toFixed(2)})`);
  }
  assert.ok(!m._blast, 'flight never resumes');
  assert.ok(minWetY > FLOOR + 1.0, `never sank through the lake (minWetY ${minWetY.toFixed(2)})`);
  console.log(`water-finish: y ${m.pos.y.toFixed(2)}`);
}

// Step-level lunar gravity: plain mob falls read the same low-g as blast
// flights and the player — full-g only below the lunar floor.
{
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  registerMoonDim('over');
  setBlock(60, 1, 60, MOON); markMoonDirty();
  assert.equal(isMoonGone(), false, 'seeded moon block: moon lives');
  const hi = makeCow(0.5, 0.5);
  hi.pos.y = MOON_MIN_Y + 50;
  for (let t = 0; t < 60; t++) stepVertical(hi, DT, null, false, false);
  assert.ok(Math.abs(hi.vel.y - (-GRAVITY / 2)) < 0.05, `half-g plain fall (got ${hi.vel.y})`);
  const lo = makeCow(2.5, 0.5);
  lo.pos.y = 100;
  for (let t = 0; t < 60; t++) stepVertical(lo, DT, null, false, false);
  assert.ok(Math.abs(lo.vel.y - (-GRAVITY)) < 0.05, `full-g below the moon (got ${lo.vel.y})`);
  console.log('moon: plain falls share the low-g');
}

// Level walls: mobs wall at their dim's level edge — the overworld at any
// altitude (the Moon band runs to +oo until planets arrive), the Nether
// island and the End platform square at any altitude.
{
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  buildFloor(92, 100, -4, 4);
  const edge = makeCow(95.5, 0.5);
  edge.target = { x: 99.5, z: 0.5 };
  for (let t = 0; t < 180; t++) tickFarmMob(edge, DT, () => edge.target, edge.rand);
  assert.ok(edge.pos.x <= 96 - edge.hw + 1e-6, `ground mob stopped at invisible wall (x=${edge.pos.x})`);
  // High platform: still walled, no ceiling yet.
  for (let x = 60; x <= 110; x++) for (let z = -4; z <= 4; z++) setBlock(x, 900, z, STONE);
  const low = makeCow(80.5, 0.5);
  low.pos.y = 901; low.fallFrom = 901;
  low.target = { x: 105.5, z: 0.5 };
  for (let t = 0; t < 180; t++) tickFarmMob(low, DT, () => low.target, low.rand);
  assert.ok(low.pos.x <= 96 - low.hw + 1e-6, `sky mob walled (x=${low.pos.x})`);
  console.log('level walls: ground band and sky: ok');
}

// Nether parity: the island walls at ±96 with the same rebound, any
// altitude — the Nether level is its 193x193 field.
{
  resetWorld('nether'); setDimension('nether'); clearEntryClaims();
  for (let x = -110; x <= 110; x++) for (let z = -110; z <= 110; z++) setBlock(x, 0, z, STONE);
  const m = makeCow(90.5, 0.5);
  m.dim = 'nether';
  const v = computeMegaLaunch(m.pos.x, m.pos.y + m.h / 2, m.pos.z, 80, 0, 0, 15);
  assert.ok(v && v.vx > 0, 'nether wall-bound body launches outward');
  launchMobBlast(m, v.vx, v.vy, v.vz);
  flyUntilLanded(m);
  assert.ok(!m._blast, 'walled nether flight ends');
  assert.ok(Math.abs(m.pos.x) <= 96 && Math.abs(m.pos.z) <= 96,
    `stays inside the island (got ${m.pos.x.toFixed(2)})`);
  assert.ok(m.pos.x < 96 - m.hw - 0.5, `rebounded inward off the nether wall (got ${m.pos.x.toFixed(2)})`);
  console.log(`nether wall-bounce: x ${m.pos.x.toFixed(2)}`);
}

// End parity: the 73x73 platform square walls at ±36 with the same rebound.
{
  resetWorld('end'); setDimension('end'); clearEntryClaims();
  for (let x = -36; x <= 36; x++) for (let z = -36; z <= 36; z++) setBlock(x, 0, z, STONE);
  const m = makeCow(33.5, 0.5);
  m.dim = 'end';
  const v = computeMegaLaunch(m.pos.x, m.pos.y + m.h / 2, m.pos.z, 30, 0, 0, 15);
  assert.ok(v && v.vx > 0, 'end wall-bound body launches outward');
  launchMobBlast(m, v.vx, v.vy, v.vz);
  flyUntilLanded(m);
  assert.ok(!m._blast, 'walled end flight ends');
  assert.ok(Math.abs(m.pos.x) <= 36 && Math.abs(m.pos.z) <= 36,
    `stays inside the platform (got ${m.pos.x.toFixed(2)})`);
  assert.ok(m.pos.x < 36 - m.hw - 0.5, `rebounded inward off the end wall (got ${m.pos.x.toFixed(2)})`);
  console.log(`end wall-bounce: x ${m.pos.x.toFixed(2)}`);
}

console.log('blast.test.mjs: ALL PASS');
