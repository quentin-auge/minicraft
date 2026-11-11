// Elevated 1-wide deck ending in an open lip: the head must stay over
// support like it stays out of the wall. A walled elevated end is the
// control (nose guard owns it); an open corner guards the turn path.
import assert from 'node:assert/strict';
import { STONE } from '../../../src/core/blocks.js';
import { resetWorld, setDimension, setBlock } from '../../../src/core/store.js';
import { LIVESTOCK_SPECS, specCircles, dropAllowed } from '../../../src/mobs/livestock.js';
import { FARM_WALK, tickFarmMob } from '../../../src/mobs/mover.js';
import { groundBelow, aabbIntersectsSolid } from '../../../src/mobs/step.js';
import { normYaw } from '../../../src/mobs/corridor.js';
import { clearEntryClaims } from '../../../src/mobs/entry.js';

const DT = 1 / 60;
const FLOOR = 3; // deck top: two blocks of air beneath (void below)

function buildDeck(cells, wallPastEnd = false) {
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  for (const [x, z] of cells) setBlock(x, FLOOR - 1, z, STONE);
  if (wallPastEnd) {
    const [ex, ez] = cells[cells.length - 1];
    const dx = Math.sign(ex - cells[cells.length - 2][0]);
    const dz = Math.sign(ez - cells[cells.length - 2][1]);
    setBlock(ex + dx, FLOOR, ez + dz, STONE);
    setBlock(ex + dx, FLOOR + 1, ez + dz, STONE);
  }
}

function makeCow(x, z, yaw, target) {
  const spec = LIVESTOCK_SPECS['cow'];
  const shape = specCircles(spec);
  return { type: 'cow', dim: 'over', pos: { x, y: FLOOR, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    yaw, yawTarget: yaw, target, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK, rand: () => 0.37,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: FLOOR, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0, turnHold: 0,
    entryScanT: 0, entryCoolT: 0, entryCoolKey: null, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    pinWallRide: false, _peerIdx: 0 };
}

// Nose-column support: the head's own ground read (single column at the
// nose tip over the feet level, legal drop only).
function noseHeld(m) {
  const nx = m.pos.x + Math.sin(m.yaw) * m.nose.along;
  const nz = m.pos.z + Math.cos(m.yaw) * m.nose.along;
  const g = groundBelow(nx, m.pos.y + 1, nz);
  return g != null && dropAllowed(m.pos.y, g, m.maxDrop);
}

// Settled = yaw aligned with the lane: in-place turn sweeps are transient
// (a 1-wide deck leaves no room for a supported 180° sweep) and exempt;
// every settled pose must keep the head over support.
function settled(m) {
  return m.lane != null && Math.abs(normYaw(m.yaw - m.lane.axis)) < 0.3;
}

// Open lip: the deck ends in void. The mob must stop with the head still
// over the deck, turn (noseTurn path), and leave — never dangle settled.
{
  const cells = Array.from({ length: 8 }, (_, z) => [0, z]);
  buildDeck(cells);
  const m = makeCow(0.5, 1.5, 0, { x: 0.5, z: 30 });
  let everRail = false, sawNoseTurn = false, wasFar = false, leftLip = false;
  let badSettled = 0, worstStill = 0, still = 0;
  for (let t = 0; t < 1500; t++) {
    const px = m.pos.x, pz = m.pos.z;
    tickFarmMob(m, DT, () => m.target, m.rand);
    if (m.oneWide) everRail = true;
    if (m.noseTurn) sawNoseTurn = true;
    assert.equal(m.pos.y, FLOOR, `open-lip: feet stay on the deck @tick${t}`);
    if (settled(m) && !noseHeld(m)) badSettled++;
    const d = Math.hypot(m.pos.x - px, m.pos.z - pz);
    still = d < FARM_WALK * DT * 0.15 ? still + 1 : 0;
    worstStill = Math.max(worstStill, still);
    if (m.pos.z > 6.5) wasFar = true;
    if (wasFar && m.pos.z < 5.5) leftLip = true;
  }
  console.log(`open-lip: rail ${everRail}, noseTurn ${sawNoseTurn}, left ${leftLip}, badSettled ${badSettled}, worstStill ${worstStill}`);
  assert.ok(everRail, 'open-lip: the open deck rides a 1-wide rail');
  assert.ok(wasFar, 'open-lip: the mob walks out to the lip');
  assert.ok(sawNoseTurn, 'open-lip: the lip trips the nose-turn path');
  assert.ok(leftLip, 'open-lip: the mob leaves the lip after turning');
  assert.equal(badSettled, 0, 'open-lip: no settled pose hangs the head over the void');
  assert.ok(worstStill <= 45, `open-lip: no frozen episode (${worstStill})`);
}

// Walled control: same deck with a wall past the end. The nose guard owns
// the stop; the fix must not move it.
{
  const cells = Array.from({ length: 8 }, (_, z) => [0, z]);
  buildDeck(cells, true);
  const m = makeCow(0.5, 1.5, 0, { x: 0.5, z: 30 });
  let sawNoseTurn = false, wasFar = false, leftLip = false;
  let badSettled = 0, worstStill = 0, still = 0;
  for (let t = 0; t < 1500; t++) {
    const px = m.pos.x, pz = m.pos.z;
    tickFarmMob(m, DT, () => m.target, m.rand);
    if (m.noseTurn) sawNoseTurn = true;
    assert.equal(m.pos.y, FLOOR, `walled-lip: feet stay on the deck @tick${t}`);
    assert.ok(!aabbIntersectsSolid(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h),
      `walled-lip: body never enters solid @tick${t}`);
    if (settled(m) && !noseHeld(m)) badSettled++;
    const d = Math.hypot(m.pos.x - px, m.pos.z - pz);
    still = d < FARM_WALK * DT * 0.15 ? still + 1 : 0;
    worstStill = Math.max(worstStill, still);
    if (m.pos.z > 6.5) wasFar = true;
    if (wasFar && m.pos.z < 5.5) leftLip = true;
  }
  console.log(`walled-lip: noseTurn ${sawNoseTurn}, left ${leftLip}, badSettled ${badSettled}, worstStill ${worstStill}`);
  assert.ok(wasFar && sawNoseTurn && leftLip, 'walled-lip: approach, nose turn, and leave');
  assert.equal(badSettled, 0, 'walled-lip: head stays supported throughout');
  assert.ok(worstStill <= 45, `walled-lip: no frozen episode (${worstStill})`);
}

// Open corner (non-regression): an L deck in the air still turns and
// traverses without falling or freezing. No head assert here: blend arcs
// swing the nose transiently, like the roof straddle tolerance.
{
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]];
  buildDeck(cells);
  const m = makeCow(0.5, 0.5, 0, { x: 4.5, z: 30 });
  let farArm = false, worstStill = 0, still = 0;
  for (let t = 0; t < 2400; t++) {
    const px = m.pos.x, pz = m.pos.z;
    tickFarmMob(m, DT, () => m.target, m.rand);
    assert.equal(m.pos.y, FLOOR, `open-corner: feet stay on the deck @tick${t}`);
    if (m.pos.x > 3.5 && Math.abs(m.pos.z - 4.5) < 0.6) farArm = true;
    const d = Math.hypot(m.pos.x - px, m.pos.z - pz);
    still = d < FARM_WALK * DT * 0.15 ? still + 1 : 0;
    worstStill = Math.max(worstStill, still);
  }
  console.log(`open-corner: farArm ${farArm}, worstStill ${worstStill}`);
  assert.ok(farArm, 'open-corner: the mob rounds the open corner onto the far arm');
  assert.ok(worstStill <= 45, `open-corner: no frozen episode (${worstStill})`);
}

console.log('airlip.test.mjs: ALL PASS');
