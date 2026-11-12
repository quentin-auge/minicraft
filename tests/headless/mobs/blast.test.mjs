// Mega-pool mob ejection: the shared launcher throws farm mobs onto the
// exact player arc (1.5R travel), and the world walls confine the flight
// (glissade — never outside, then down). Three-free rig on live voxels.
import assert from 'node:assert/strict';
import { STONE } from '../../../src/core/blocks.js';
import { resetWorld, setDimension, setBlock } from '../../../src/core/store.js';
import { LIVESTOCK_SPECS, specCircles } from '../../../src/mobs/livestock.js';
import { FARM_WALK, tickFarmMob, launchMobBlast } from '../../../src/mobs/mover.js';
import { computeMegaLaunch } from '../../../src/core/launch.js';
import { hasSupport, aabbIntersectsSolid } from '../../../src/mobs/step.js';
import { clearEntryClaims } from '../../../src/mobs/entry.js';

const DT = 1 / 60;
const FLOOR = 1; // feet rest on the y=0 slab

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

// Launcher shape: null outside R, upward kick, clamped horizontal speed,
// and a free-flight range of 1.5R back at start height (the player arc).
{
  const R = 15;
  assert.equal(computeMegaLaunch(100, 1.9, 100, 0, 0, 0, R), null, 'far body: no launch');
  const v = computeMegaLaunch(0.5, 1.9, 0.5, 0, 0, 0, R);
  assert.ok(v, 'center body launches');
  assert.ok(v.vy > 22 && v.vy <= 30, `up kick 22..30 (got ${v.vy})`);
  const vh = Math.hypot(v.vx, v.vz);
  assert.ok(vh >= 4 && vh <= 40, `horizontal speed clamped 4..40 (got ${vh})`);
  let x = 0.5, y = 1.9, z = 0.5, vy = v.vy;
  const s = 1 / 240;
  for (let t = 0; t < 2400; t++) {
    vy -= 37.44 * s;
    x += v.vx * s; y += vy * s; z += v.vz * s;
    if (vy < 0 && y <= 1.9) break;
  }
  const travel = Math.hypot(x - 0.5, z - 0.5);
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

console.log('blast.test.mjs: ALL PASS');
