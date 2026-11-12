// Sub-zero mob datum: in infinite dims (TNT sky) mobs stand and walk on
// platforms below y = 0; in bounded dims the y = 0 floor still rules; in a
// floorless void they keep falling (design, not a bug). Three-free rigs on
// live voxels (store + step + mover only — no scene).
import assert from 'node:assert/strict';
import { STONE } from '../../../src/core/blocks.js';
import {
  resetWorld, setDimension, setBlock, registerInfiniteDim, dimInfinite,
} from '../../../src/core/store.js';
import { LIVESTOCK_SPECS, specCircles } from '../../../src/mobs/livestock.js';
import { FARM_WALK, tickFarmMob } from '../../../src/mobs/mover.js';
import { hasSupport, groundBelow, SUPPORT_SCAN, strideTarget } from '../../../src/mobs/step.js';
import { clearEntryClaims } from '../../../src/mobs/entry.js';

const DT = 1 / 60;

function makeCow(x, y, z, yaw = 0) {
  const spec = LIVESTOCK_SPECS['cow'];
  const shape = specCircles(spec);
  return {
    type: 'cow', dim: 'over', pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: { x, z }, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK, rand: () => 0.37,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0, turnHold: 0,
    entryScanT: 0, entryCoolT: 0, entryCoolKey: null, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    pinWallRide: false, _peerIdx: 0,
  };
}

// The datum table itself: bounded stops at 0, infinite reads below.
assert.equal(dimInfinite('over'), false, 'overworld is bounded');
registerInfiniteDim('tnt');
assert.equal(dimInfinite('tnt'), true, 'TNT sky is infinite');
assert.equal(SUPPORT_SCAN, 8, 'support scan stays bounded-cost');

// Bounded control: platform at y = 0, feet at y = 1 — legacy reads unchanged.
{
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) setBlock(x, 0, z, STONE);
  assert.equal(groundBelow(0.5, 3, 0.5), 1, 'bounded: ground found down to the floor');
  assert.equal(hasSupport(0.5, 1, 0.5, 0.3), true, 'bounded: standing reads supported');
  assert.equal(hasSupport(0.5, 3, 0.5, 0.3), false, 'bounded: hovering reads unsupported');
  const m = makeCow(0.5, 1, 0.5);
  for (let t = 0; t < 120; t++) tickFarmMob(m, DT, (m, rand) => strideTarget(m, null, rand), m.rand);
  assert.equal(m.pos.y, 1, 'bounded: feet stay on the floor');
}

// Infinite, sub-zero platform: the probes see it, the mob walks on it and
// never falls through.
{
  resetWorld('tnt'); setDimension('tnt'); clearEntryClaims();
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) setBlock(x, -11, z, STONE);
  assert.equal(groundBelow(0.5, -8, 0.5), -10, 'infinite: ground found below y = 0');
  assert.equal(hasSupport(0.5, -10, 0.5, 0.3), true, 'infinite: sub-zero standing reads supported');
  assert.equal(hasSupport(0.5, -5, 0.5, 0.3), false, 'infinite: hovering still reads unsupported');
  const m = makeCow(0.5, -10, 0.5);
  m.dim = 'tnt';
  let farthest = 0;
  for (let t = 0; t < 1200; t++) {
    tickFarmMob(m, DT, (m, rand) => strideTarget(m, null, rand), m.rand);
    assert.equal(m.pos.y, -10, `infinite: feet stay on the sub-zero platform @tick${t}`);
    assert.equal(hasSupport(m.pos.x, m.pos.y, m.pos.z, m.hw), true,
      `infinite: every pose stays supported @tick${t}`);
    farthest = Math.max(farthest, Math.hypot(m.pos.x - 0.5, m.pos.z - 0.5));
  }
  assert.ok(farthest > 1.5, `infinite: the mob walks below y = 0 (farthest ${farthest.toFixed(2)})`);
  console.log(`sub-zero walk: farthest ${farthest.toFixed(2)}, y ${m.pos.y}`);
}

// Infinite void: nothing to stand on — the mob falls (floorless design),
// picks no target, and never crashes.
{
  resetWorld('tnt'); setDimension('tnt'); clearEntryClaims();
  const m = makeCow(0.5, -5, 0.5);
  m.dim = 'tnt';
  for (let t = 0; t < 120; t++) tickFarmMob(m, DT, (m, rand) => strideTarget(m, null, rand), m.rand);
  assert.ok(m.pos.y < -5, `infinite void: the mob falls (y ${m.pos.y.toFixed(2)})`);
  assert.equal(m.target, null, 'infinite void: no walkable target down there');
  assert.equal(hasSupport(m.pos.x, m.pos.y, m.pos.z, m.hw), false, 'infinite void: never supported');
}

console.log('subzero.test.mjs: ALL PASS');
