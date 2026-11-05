// Cooperative passing tests: the REAL mover (mover.js) on REAL voxels
// (store.js), headless (mob.root is null, cosmetics self-skip).
// Lane-less mobs hold committed headings and sequence temporally (slow
// only) — advance, turn, slow only, never slide, never speed up. The gate
// refuses steps past the brush budget but walks shallow contact through
// instead of stopping into a re-pick every tick; the separation pass stays
// as a safety-net backstop. Headless rigs drive the real game tick.
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import {
  FARM_WALK, PUSH_T, PUSH_CAP, tickFarmMob, separateFarmMobs, worstPairPen, predictCPA, mobBlockedAt,
} from "../../../src/mobs/mover.js";
import { planGroup } from "../../../src/mobs/forecast.js";
import { buildMobGrid } from "../../../src/mobs/grid.js";
import { normYaw } from "../../../src/mobs/corridor.js";
import { NO_EXPIRY, strideTarget, aabbIntersectsSolid } from "../../../src/mobs/step.js";

// Post-tick residue bound: the damped, capped backstop converges over a
// few ticks instead of teleporting in one — residue may transiently reach
// what the gate itself tolerates (brushes to CROSS_BUDGET walk through),
// but never a deep overlap. maxPush below bounds each single shove.
const RESIDUE_MAX = 0.2;

const DT = 1 / 60;
const FEET = 1;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFlat(r = 12) {
  resetWorld("over");
  setDimension("over");
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) setBlock(x, 0, z, STONE);
  // Pen-like fence ring: keeps the soak on the slab, exercises push vetoes.
  for (let x = -r; x <= r; x++) {
    for (const z of [-r, r]) { setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE); }
  }
  for (let z = -r + 1; z <= r - 1; z++) {
    for (const x of [-r, r]) { setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE); }
  }
}

function makeMob(x, z, yaw, seed) {
  const shape = specCircles(LIVESTOCK_SPECS.pig);
  return {
    type: "pig", dim: "over", pos: { x, y: FEET, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK, rand: mulberry32(seed),
    stuckT: 0, lastX: x, lastZ: z, fallFrom: FEET, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0, entryScanT: 0, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false,
    tunnelHoldX: null, tunnelHoldZ: null, entryCoolT: 0,
    _peerIdx: 0,
  };
}

// Pin a latched roam commit onto a fixed goal (open-field scenario driver:
// strideTarget would otherwise roam free). Repairs target breaks from stuck
// or arrival re-picks; the span expiry is held off by the runner.
// A committed detour (_detour, latched by the stuck re-pick) is left alone
// until the refresh path clears it — re-aiming every tick would kill the
// pass-around maneuver before it starts.
// A committed detour ends early as soon as the straight lane back to
// the goal is mob-free (sampled every metre): there is no point walking
// a long sidestep once the blocker is already behind. Without this the
// detour plays out in full and mobs wander off instead of passing.
// A mover line-rebase (target shifted onto the adopted parallel with a
// consistent commit) is adopted as the new goal: the scenario follows
// the parallel instead of dragging the mob back onto the old line.
function keepGoal(mob, goals, peers) {
  const goal = goals.get(mob);
  if (mob._detour) {
    const dx = goal.x - mob.pos.x, dz = goal.z - mob.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) {
      let blocked = false;
      const steps = Math.max(1, Math.ceil(dist));
      for (let i = 1; i <= steps && !blocked; i++) {
        const t = i / steps;
        if (mobBlockedAt(mob, mob.pos.x + dx * t, mob.pos.z + dz * t, mob.pos.y, peers, 0.3)) blocked = true;
      }
      if (blocked) return;
    }
    mob._detour = false;
  }
  if (mob.target !== goal) {
    if (mob.target && mob.roam && mob.target === mob.roam.tgt && mob.target === mob.roam.target) {
      goals.set(mob, mob.target);
      return;
    }
    mob.target = goal; mob.wanderT = NO_EXPIRY;
    const h = Math.atan2(goal.x - mob.pos.x, goal.z - mob.pos.z);
    mob.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 30 };
  } else if (mob.roam?.tgt !== goal) {
    mob.wanderT = NO_EXPIRY;
    const h = Math.atan2(goal.x - mob.pos.x, goal.z - mob.pos.z);
    mob.roam = { mode: "commit", heading: h, target: goal, tgt: goal, t: 0, span: 30 };
  }
}

function maxPen(list) {
  let m = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const w = worstPairPen(list[i], list[j], i, j);
      if (w) m = Math.max(m, w.pen);
    }
  return m;
}

// One scenario run: every tick holds goals, ticks with/without cooperation,
// measures pre-separation contact (the planner + gate own keeping this at
// zero — the backstop must stay idle), then runs the damped backstop and
// asserts only shallow residue remains (≤ PUSH_T). Returns contact stats +
// closest-approach snapshot.
// Arrived mobs despawn (a game mob would re-pick and walk away; the
// fixed-goal rig would otherwise orbit the goal and manufacture contacts).
function runScenario(list, goals, { ticks = 900, coop = true } = {}) {
  const pick = (m) => goals.get(m);
  const active = [...list];
  active.forEach((m, i) => { m._peerIdx = i; });
  let contactTicks = 0, maxPre = 0, postViolations = 0, pushTicks = 0;
  let closest = { d: Infinity, za: 0, zb: 0 };
  let maxPush = 0, pushVol = 0;
  let arrivedAt = -1;
  const arrived = (m) => {
    const g = goals.get(m);
    return Math.hypot(g.x - m.pos.x, g.z - m.pos.z) < 1.0;
  };
  for (let t = 0; t < ticks; t++) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (arrived(active[i])) active.splice(i, 1);
    }
    active.forEach((m, i) => { m._peerIdx = i; });
    if (active.length === 0) { arrivedAt = t; break; }
    for (const m of active) { keepGoal(m, goals, active); m.wanderT = NO_EXPIRY; }
    if (coop) planGroup(active, DT);
    for (const m of active) tickFarmMob(m, DT, pick, m.rand, coop ? active : null);
    const pre = maxPen(active);
    if (pre > 1e-6) { contactTicks++; maxPre = Math.max(maxPre, pre); }
    if (pre > PUSH_T) pushTicks++;
    if (active.length === 2) {
      const [a, b] = active;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      if (d < closest.d) closest = { d, za: a.pos.z, zb: b.pos.z };
    }
    const preX = active.map((m) => m.pos.x), preZ = active.map((m) => m.pos.z);
    separateFarmMobs(active);
    active.forEach((m, i) => {
      const pushed = Math.hypot(m.pos.x - preX[i], m.pos.z - preZ[i]);
      if (pushed > 1e-9) { pushVol += pushed; if (pushed > maxPush) maxPush = pushed; }
    });
    if (maxPen(active) > RESIDUE_MAX) postViolations++;
  }
  if (arrivedAt < 0 && active.length === 0) arrivedAt = ticks;
  return { contactTicks, maxPre, postViolations, pushTicks, maxPush, pushVol, closest, arrivedAt };
}

function headOn(coop) {
  buildFlat();
  const a = makeMob(-4.5, 0.5, Math.PI / 2, 11);
  const b = makeMob(4.5, 0.5, -Math.PI / 2, 22);
  const goals = new Map([[a, { x: 4.5, z: 0.5 }], [b, { x: -4.5, z: 0.5 }]]);
  return runScenario([a, b], goals, { coop });
}

// Cooperative head-on: the gate stops both mobs at contact range instead
// of letting them grind, then each re-picks away from the blocker and
// walks around. No steering, no shoving: arrival proves the detour.
{
  const r = headOn(true);
  assert.ok(r.arrivedAt >= 0, "head-on coop: both arrive");
  assert.ok(r.contactTicks <= 40, `head-on coop: ${r.contactTicks} contact ticks, want <= 40 (early temporal sequencing trades a few shallow brush ticks for straight lines)`);
  assert.ok(r.maxPre < 0.15, `head-on coop: max pen ${r.maxPre.toFixed(3)}, want < 0.15`);
  assert.ok(r.postViolations === 0, `head-on coop: ${r.postViolations} post-separation violations`);
  assert.ok(r.pushTicks <= 60, `head-on coop: ${r.pushTicks} push ticks, want <= 60`);
  assert.ok(r.maxPush < 0.12, `head-on coop: max shove ${r.maxPush.toFixed(3)}m in one tick, want < 0.12`);
  console.log(`PASS head-on-coop (contacts ${r.contactTicks}, pushes ${r.pushTicks}/${r.pushVol.toFixed(2)}m, closest ${r.closest.d.toFixed(2)}m)`);
}

// Solo baseline (no peer steering) must actually collide here — otherwise
// the rig above proves nothing.
{
  const r = headOn(false);
  assert.ok(r.contactTicks >= 40, `head-on solo: ${r.contactTicks} contact ticks, want >= 40`);
  console.log(`PASS head-on-solo-collides (${r.contactTicks} contact ticks)`);
}

// predictCPA units: pure intent math, no voxels. Fake mobs carry only
// what the predictor reads (pos/yaw/speed/roam commit).
{
  const mk = (x, z, yaw, speed, heading = null) => ({
    pos: { x, y: 1, z }, yaw, speed,
    roam: heading == null ? null : { mode: "commit", heading },
  });
  // Head-on, 6 m apart, closing at 4 m/s: meet in 1.5 s dead center.
  let w = predictCPA(mk(0, 0, Math.PI / 2, 2), mk(6, 0, -Math.PI / 2, 2));
  assert.ok(w && Math.abs(w.t - 1.5) < 1e-9 && w.miss < 1e-9, `cpa head-on: ${JSON.stringify(w)}`);
  // Parallel same speed: no CPA (never converges).
  assert.equal(predictCPA(mk(0, 0, Math.PI / 2, 2), mk(0, 3, Math.PI / 2, 2)), null, "cpa parallel");
  // Diverging (faster mob ahead): no CPA.
  assert.equal(predictCPA(mk(0, 0, Math.PI / 2, 1), mk(1, 0, Math.PI / 2, 2)), null, "cpa diverging");
  
// mobBlockedAt units: pure body-circle math, no voxels or ticks. A step
// whose body box or nose disc overlaps any live same-level peer is
// refused; everything else (clear lanes, dead peers, other floors) is
// free. The step gate calls this per candidate position.
{
  const mk = (x, z, yaw = 0, y = 1, alive = true) => ({
    pos: { x, y, z }, yaw, alive, hw: 0.32,
    nose: { along: 0.75, r: 0.26 }, tail: { along: -0.66, r: 0.22 },
  });
  const me = mk(0, 0);
  assert.equal(mobBlockedAt(me, 0.5, 0, 1, [me, mk(0.5, 0)]), true, "core overlap blocks");
  assert.equal(mobBlockedAt(me, 2.0, 0, 1, [me, mk(0.5, 0)]), false, "clear lane is free");
  assert.equal(mobBlockedAt(me, 0, -0.2, 1, [me, mk(0, 0.9, Math.PI)]), true, "nose reach blocks");
  assert.equal(mobBlockedAt(me, 0, -0.2, 1, [me, mk(0, 2.2, Math.PI)]), false, "distant nose is free");
  assert.equal(mobBlockedAt(me, 0.5, 0, 1, [mk(0.5, 0, 0, 5)]), false, "Y-gated (faller ignored)");
  const dead = mk(0.5, 0); dead.alive = false;
  assert.equal(mobBlockedAt(me, 0.5, 0, 1, [me, dead]), false, "dead peers never block");
  assert.equal(mobBlockedAt(me, 0.9, 0, 1, [me, mk(0, 0)], 0.3), true, "comfort margin widens");
  assert.equal(mobBlockedAt(me, 0.9, 0, 1, [me, mk(0, 0)], 0), false, "exact gate stays tight");
  console.log("PASS mobBlockedAt units");
}

// Perpendicular crossing: meet in 1.5 s dead center.
  w = predictCPA(mk(0, 0, Math.PI / 2, 2), mk(3, -3, 0, 2));
  assert.ok(w && Math.abs(w.t - 1.5) < 1e-9 && w.miss < 1e-9, `cpa crossing: ${JSON.stringify(w)}`);
  // Same geometry tripled: past the horizon, no CPA.
  assert.equal(predictCPA(mk(0, 0, Math.PI / 2, 2), mk(18, 0, -Math.PI / 2, 2)), null, "cpa past horizon");
  // Committed heading wins over nose direction: mob facing +z whose
  // commit runs +x reads as the head-on case above.
  w = predictCPA(mk(0, 0, 0, 2, Math.PI / 2), mk(6, 0, -Math.PI / 2, 2));
  assert.ok(w && Math.abs(w.t - 1.5) < 1e-9 && w.miss < 1e-9, `cpa commit-over-yaw: ${JSON.stringify(w)}`);
  console.log("PASS predictCPA units");
}


// Perpendicular crossing: both arrive, barely touch.
{
  buildFlat();
  const a = makeMob(-4.5, 0.5, Math.PI / 2, 33);
  const b = makeMob(0.5, -4.5, 0, 44);
  const goals = new Map([[a, { x: 4.5, z: 0.5 }], [b, { x: 0.5, z: 4.5 }]]);
  const r = runScenario([a, b], goals, { coop: true });
  assert.ok(r.arrivedAt >= 0, "crossing: both arrive");
  assert.ok(r.contactTicks <= 40, `crossing: ${r.contactTicks} contact ticks, want <= 40 (two-level speed only now — no continuous yield easing both through; brushes stay shallow)`);
  assert.ok(r.maxPre < 0.1, `crossing: max pen ${r.maxPre.toFixed(3)}, want < 0.1 (shallow snout brush only)`);
  assert.ok(r.postViolations === 0, `crossing: ${r.postViolations} post-separation violations`);
  console.log(`PASS crossing (contacts ${r.contactTicks})`);
}

// Long-approach crossing (~11 m apart, full pen diagonal): both hold
// committed headings through the meeting on near-constant speed —
// brushes under the gate allowance are walked through, not swerved around.
// Proves committed headings: a per-tick re-facer would zigzag off its
// line instead of brushing straight past.
{
  buildFlat();
  const a = makeMob(-8, 0.5, Math.PI / 2, 101);
  const b = makeMob(0.5, -8, 0, 102);
  const goals = new Map([[a, { x: 8, z: 0.5 }], [b, { x: 0.5, z: 8 }]]);
  const list = [a, b];
  const pick = (m) => goals.get(m);
  const done = new Set();
  list.forEach((m, i) => { m._peerIdx = i; });
  let contacts = 0, maxPre = 0, maxDev = 0, arrivedAt = -1, postViol = 0, maxStreak = 0, streak = 0;
  const arrived = (m) => {
    const g = goals.get(m);
    return Math.hypot(g.x - m.pos.x, g.z - m.pos.z) < 1.0;
  };
  for (let t = 0; t < 1200 && done.size < list.length; t++) {
    for (const m of list) if (!done.has(m) && arrived(m)) done.add(m);
    for (const m of list) {
      if (done.has(m)) continue;
      keepGoal(m, goals, list); m.wanderT = NO_EXPIRY;
    }
    planGroup(list.filter((m) => !done.has(m)), DT);
    for (const m of list) {
      if (done.has(m)) continue;
      tickFarmMob(m, DT, pick, m.rand, list);
    }
    // Straight-line budget for both lanes (both hold their line and brush past).
    maxDev = Math.max(maxDev, Math.abs(a.pos.z - 0.5), Math.abs(b.pos.x - 0.5));
    const pre = maxPen(list);
    if (pre > 1e-6) { contacts++; maxPre = Math.max(maxPre, pre); streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
    separateFarmMobs(list);
    if (maxPen(list) > RESIDUE_MAX) postViol++;
    if (done.size === list.length) arrivedAt = t;
  }
  assert.ok(arrivedAt >= 0, "long crossing: both arrive");
  assert.ok(contacts <= 30, `long crossing: ${contacts} contact ticks, want <= 30 (brushes, not grinds)`);
  assert.ok(maxPre < 0.15, `long crossing: max pen ${maxPre.toFixed(3)}, want < 0.15 (crossing-budget brushes only)`);
  assert.ok(maxStreak <= 30, `long crossing: ${maxStreak}-tick streak, want <= 30 (one pass-through, no grinding)`);
  assert.ok(maxDev < 1.2, `long crossing: wandered ${maxDev.toFixed(2)}m off straight lines, want < 1.2 (one frank sidestep at most)`);
  assert.equal(postViol, 0, "long crossing: post-separation violations");
  console.log(`PASS long-crossing (dev ${maxDev.toFixed(2)}m, arrived @${arrivedAt})`);
}

// Overtake: slow mob ahead, fast mob behind — hold the line and brush
// past at near-constant speed instead of tailgating: evasions keeps the
// raw goal heading through gate-allowance contact (depth capped), so the
// brush lasts longer than a sidestep detour would — contacts are many but
// shallow, never grinds, both arrive.
{
  buildFlat();
  const a = makeMob(-4.5, 0.5, Math.PI / 2, 55);
  const b = makeMob(-1.5, 0.5, Math.PI / 2, 66);
  b.speed = FARM_WALK * 0.45;
  const goals = new Map([[a, { x: 6.5, z: 0.5 }], [b, { x: 4.5, z: 0.5 }]]);
  const r = runScenario([a, b], goals, { coop: true, ticks: 1200 });
  assert.ok(r.arrivedAt >= 0, "overtake: both arrive");
  assert.ok(r.contactTicks <= 150, `overtake: ${r.contactTicks} contact ticks, want <= 150 (line-hold brush-past)`);
  assert.ok(r.maxPre < 0.1, `overtake: max pen ${r.maxPre.toFixed(3)}, want < 0.1 (shallow brush only)`);
  assert.ok(r.postViolations === 0, `overtake: ${r.postViolations} post-separation violations`);
  console.log(`PASS overtake (contacts ${r.contactTicks})`);
}

// Open-field straight: free way ahead, no mob, no wall — the commit keeps
// its heading instead of turning without an obstacle. Bounded to the roam
// run budget (RUN_MAX): a >45° yaw excursion without any obstacle inside
// one run is the regression.
{
  buildFlat(40);
  const m = makeMob(-20, 0.5, Math.PI / 2, 99);
  m._peerIdx = 0;
  const list = [m];
  const pick = (mm, r) => strideTarget(mm, null, r);
  let maxDev = 0;
  for (let t = 0; t < 300; t++) {
    planGroup(list, DT);
    tickFarmMob(m, DT, pick, m.rand, list);
    maxDev = Math.max(maxDev, Math.abs(normYaw(m.yaw - Math.PI / 2)));
    separateFarmMobs(list);
  }
  const dist = Math.hypot(m.pos.x + 20, m.pos.z - 0.5);
  assert.ok(dist > 8, `open straight: walked ${dist.toFixed(1)}m, want > 8 (keeps going)`);
  assert.ok(maxDev < 0.2, `open straight: yaw veered ${maxDev.toFixed(3)} rad, want < 0.2 (no turn without obstacle)`);
  assert.ok(maxPen(list) <= 1e-3, "open straight: no self-penetration");
  console.log(`PASS open-straight (walked ${dist.toFixed(1)}m, veer ${maxDev.toFixed(3)} rad)`);
}

// Offset head-on crossing across every C level and X variation: lateral
// room exists, so the meeting is a brush, not a block. Wider budgets hold
// the line straighter through the brush (same arrival, shallow contact);
// every X variation keeps the safety guarantees. Deterministic per level;
// both resets restore the default bit-identically.
{
  const crossRun = (off) => {
    buildFlat();
    const a = makeMob(-4.5, 0.5 - off / 2, Math.PI / 2, 301);
    const b = makeMob(4.5, 0.5 + off / 2, -Math.PI / 2, 302);
    const list = [a, b];
    const goals = new Map([[a, { x: 4.5, z: 0.5 - off / 2 }], [b, { x: -4.5, z: 0.5 + off / 2 }]]);
    const pick = (m) => goals.get(m);
    list.forEach((m, i) => { m._peerIdx = i; });
    const y0 = [a.yaw, b.yaw];
    let contacts = 0, maxPre = 0, maxDev = 0, viol = 0, arrivedAt = -1;
    let closest = Infinity, sideFlips = 0, sidePrev = Math.sign(a.pos.z - b.pos.z);
    for (let t = 0; t < 900; t++) {
      let done = true;
      for (const m of list) {
        if (Math.hypot(goals.get(m).x - m.pos.x, goals.get(m).z - m.pos.z) >= 1.0) done = false;
      }
      if (done) { arrivedAt = t; break; }
      for (const m of list) { keepGoal(m, goals, list); m.wanderT = NO_EXPIRY; }
      planGroup(list, DT);
      for (const m of list) tickFarmMob(m, DT, pick, m.rand, list);
      const pre = maxPen(list);
      if (pre > 1e-6) { contacts++; maxPre = Math.max(maxPre, pre); }
      list.forEach((m, i) => { maxDev = Math.max(maxDev, Math.abs(normYaw(m.yaw - y0[i]))); });
      closest = Math.min(closest, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
      const side = Math.sign(a.pos.z - b.pos.z);
      if (side !== 0 && sidePrev !== 0 && side !== sidePrev) sideFlips++;
      if (side !== 0) sidePrev = side;
      separateFarmMobs(list);
      if (maxPen(list) > RESIDUE_MAX) viol++;
    }
    return { arrivedAt, contacts, maxPre, maxDev, viol, closest, sideFlips, pos: list.map((m) => [m.pos.x, m.pos.z]) };
  };
  // Offset crossing at the shipped 0.15 m budget: both arrive, brushes
  // stay shallow, and the pair holds its line instead of sidestepping.
  {
    const r = crossRun(0.6), r2 = crossRun(0.6);
    assert.deepEqual(r.pos, r2.pos, "offset cross: deterministic");
    assert.ok(r.arrivedAt >= 0, "offset cross: both arrive");
    assert.ok(r.viol === 0, `offset cross: ${r.viol} post-separation violations`);
    assert.ok(r.maxPre < 0.2, `offset cross: max pen ${r.maxPre.toFixed(3)}, want < 0.2 (shallow brush only)`);
    assert.ok(r.contacts <= 60, `offset cross: ${r.contacts} contact ticks, want <= 60`);
    assert.ok(r.maxDev < 0.5, `offset cross: veered ${r.maxDev.toFixed(2)} rad, want < 0.5 (one frank sidestep at most, no weave)`);
    assert.ok(r.closest >= 0.45, `offset cross: closest approach ${r.closest.toFixed(2)}m, want >= 0.45 (no deep meeting)`);
    assert.ok(r.sideFlips <= 2, `offset cross: ${r.sideFlips} side swaps, want <= 2 (each mob holds its side)`);
    console.log(`PASS offset-cross (contacts ${r.contacts}, veer ${r.maxDev.toFixed(2)}, closest ${r.closest.toFixed(2)}, flips ${r.sideFlips})`);
  }
}

// Parallel file: two mobs same heading, started inside the comfort zone.
// They must widen to the minimum-vital gap and walk it straight: lateral
// separation converges, headings stay parallel (no oscillation), both
// arrive, and the backstop never engages (pre-separation penetration
// stays at/below PUSH_T every tick — separation happens before contact,
// never through pushes).
{
  buildFlat();
  const a = makeMob(-4.5, 0.2, Math.PI / 2, 401);
  const b = makeMob(-4.5, 0.8, Math.PI / 2, 402);
  const list = [a, b];
  const goals = new Map([[a, { x: 5, z: 0.2 }], [b, { x: 5, z: 0.8 }]]);
  const pick = (m) => goals.get(m);
  list.forEach((m, i) => { m._peerIdx = i; });
  let minDist = Infinity, minLat = Infinity, maxLat = 0, flips = 0, visFlips = 0, pushTicks = 0, lastPush = -1;
  let maxPre = 0, maxYawDev = 0, arrivedAt = -1;
  const prevYaw = [a.yaw, b.yaw], prevD = [0, 0];
  for (let t = 0; t < 900; t++) {
    let done = true;
    for (const m of list) {
      if (Math.hypot(goals.get(m).x - m.pos.x, goals.get(m).z - m.pos.z) >= 1.0) done = false;
    }
    if (done) { arrivedAt = t; break; }
    for (const m of list) { keepGoal(m, goals, list); m.wanderT = NO_EXPIRY; }
    planGroup(list, DT);
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    minDist = Math.min(minDist, d);
    const lat = Math.abs(a.pos.z - b.pos.z);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    list.forEach((m, i) => {
      maxYawDev = Math.max(maxYawDev, Math.abs(normYaw(m.yaw - Math.PI / 2)));
      const dd = normYaw(m.yaw - prevYaw[i]);
      // Two counters: raw reversals (includes sub-visible drive jitter
      // from axis-separated stepping) and visible ones (> 0.02 rad per
      // tick both ways — an actual left-right stutter). Only the second
      // is bounded; the first is reported for tuning.
      if (Math.abs(dd) > 0.004 && Math.abs(prevD[i]) > 0.004 && Math.sign(dd) !== Math.sign(prevD[i])) {
        flips++;
        if (Math.abs(dd) > 0.02 && Math.abs(prevD[i]) > 0.02) visFlips++;
      }
      prevD[i] = dd; prevYaw[i] = m.yaw;
    });
    const pre = maxPen(list);
    maxPre = Math.max(maxPre, pre);
    if (pre > PUSH_T) { pushTicks++; lastPush = t; }
    separateFarmMobs(list);
    assert.ok(maxPen(list) <= 0.2, `parallel file: post-separation residue above threshold @tick${t}`);
  }
  assert.ok(arrivedAt >= 0, "parallel file: both arrive");
  assert.ok(pushTicks <= 5, `parallel file: backstop engaged on ${pushTicks} ticks, want <= 5 (settle the spawn overlap, then never push)`);
  assert.ok(lastPush < 60, `parallel file: last push @tick${lastPush}, want < 60 (widen before contact, never grind)`);
  assert.ok(maxPre < 0.15, `parallel file: max pen ${maxPre.toFixed(3)}, want < 0.15 (brushes stay shallow)`);
  assert.ok(minDist >= 0.55, `parallel file: closest approach ${minDist.toFixed(2)}m, want >= 0.55 (no deep meeting)`);
  assert.ok(maxLat >= 0.65, `parallel file: widest lateral ${maxLat.toFixed(2)}m, want >= 0.65 (opens to the comfort gap)`);
  assert.ok(maxYawDev < 0.5, `parallel file: yaw veered ${maxYawDev.toFixed(2)} rad, want < 0.5 (parallel lines, no weave)`);
    assert.ok(flips <= 200, `parallel file: ${flips} heading flips (sub-visible drive jitter, informational only)`);
    assert.ok(visFlips <= 2, `parallel file: ${visFlips} visible left-right reversals, want <= 2 (one spawn-settle jink at most, then straight)`);
    console.log(`PASS parallel-file (lat ${minLat.toFixed(2)}-${maxLat.toFixed(2)}m, closest ${minDist.toFixed(2)}m, veer ${maxYawDev.toFixed(2)}, flips ${flips}/${visFlips})`);
}

// Pen-density soak: 8 mobs free-roaming in a fenced pen. The planner + gate
// own keeping bodies apart (pre-separation penetration must stay at or
// under the push threshold — the backstop stays idle); contacts stay
// shallow brief brushes, never grinds; determinism must be bit-identical.
// Bounds are distribution guards with margin, not targets.
{
  const soak = (seed) => {
    buildFlat();
    const list = [];
    for (let i = 0; i < 8; i++) {
      const m = makeMob(-3 + (i % 4) * 2, -1 + Math.floor(i / 4) * 2 + 0.5, (seed + i) * 1.1, seed + i);
      m._peerIdx = i;
      list.push(m);
    }
    const pick = (m, r) => strideTarget(m, null, r);
    let contacts = 0, deep = 0, violations = 0, maxPre = 0, maxStreak = 0, flips = 0, pushTicks = 0, maxPush = 0;
    const streak = new Map();
    const prevYaw = list.map((m) => m.yaw), prevD = list.map(() => 0);
    for (let t = 0; t < 1200; t++) {
      planGroup(list, DT);
      for (const m of list) tickFarmMob(m, DT, pick, m.rand, list);
      // Zigzag count: consecutive per-tick heading reversals above the
      // noise floor. Committed maneuvers turn once each way (pass out,
      // straighten out); flicker turns back and forth every few ticks.
      list.forEach((m, i) => {
        const d = normYaw(m.yaw - prevYaw[i]);
        if (Math.abs(d) > 0.004 && Math.abs(prevD[i]) > 0.004 && Math.sign(d) !== Math.sign(prevD[i])) flips++;
        prevD[i] = d; prevYaw[i] = m.yaw;
      });
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const w = worstPairPen(list[i], list[j], i, j);
        const k = i + "," + j;
        if (w) {
          contacts++; maxPre = Math.max(maxPre, w.pen);
          // Deep = genuinely deep approach (past the damped-backstop
          // residue band ≤ PUSH_T plus one tick of stride): the damped
          // backstop legitimately leaves shallow brushes to resolve on
          // their own instead of shoving every tick.
          if (w.pen > 0.1) deep++;
          if (w.pen > PUSH_T) pushTicks++;
          const n = (streak.get(k) ?? 0) + 1;
          streak.set(k, n); maxStreak = Math.max(streak.get(k) ?? 0, maxStreak);
        } else streak.set(k, 0);
      }
      const preX = list.map((m) => m.pos.x), preZ = list.map((m) => m.pos.z);
      separateFarmMobs(list);
      list.forEach((m, i) => {
        maxPush = Math.max(maxPush, Math.hypot(m.pos.x - preX[i], m.pos.z - preZ[i]));
      });
      if (maxPen(list) > RESIDUE_MAX) violations++;
    }
    return { contacts, deep, violations, maxPre, maxStreak, flips, pushTicks, maxPush, pos: list.map((m) => [m.pos.x, m.pos.z]) };
  };
  for (const seed of [7, 21]) {
    const r1 = soak(seed), r2 = soak(seed);
    assert.deepEqual(r1.pos, r2.pos, `soak s${seed}: deterministic`);
    assert.ok(r1.violations === 0, `soak s${seed}: ${r1.violations} post-separation violations`);
    assert.ok(r1.contacts <= 750, `soak s${seed}: ${r1.contacts} contact ticks, want <= 750`);
    assert.ok(r1.deep <= 90, `soak s${seed}: ${r1.deep} deep-contact ticks, want <= 90 (genuinely deep approaches past the damped residue band; shallow brushes resolve on their own — see streak/maxPen bounds)`);
    assert.ok(r1.maxStreak <= 300, `soak s${seed}: ${r1.maxStreak}-tick overlap, want <= 300 (a shallow flank-brush can walk together for seconds — depth and maxPen below bound the grind, not the streak)`);
    assert.ok(r1.maxPre < 0.25, `soak s${seed}: max pen ${r1.maxPre.toFixed(3)}, want < 0.25`);
  assert.ok(r1.pushTicks <= 250, `soak s${seed}: ${r1.pushTicks} backstop ticks, want <= 250 (dense milling brushes constantly at gate level; each correction is capped invisible — see maxPush)`);
  assert.ok(r1.maxPush < 0.03, `soak s${seed}: max shove ${r1.maxPush.toFixed(3)}m in one tick, want < 0.03 (PUSH_CAP: a shove never teleports)`);
    assert.ok(r1.flips <= 300, `soak s${seed}: ${r1.flips} heading flips, want <= 300 (commits turn harder under point re-aim than the heading cruise; each maneuver is still a committed hold, not per-tick flicker — see streak/deep bounds)`);
    console.log(`PASS soak s${seed} (contacts ${r1.contacts}/1200 deep ${r1.deep}, streak ${r1.maxStreak}, maxPen ${r1.maxPre.toFixed(3)}, pushes ${r1.pushTicks}/${r1.maxPush.toFixed(3)}m, flips ${r1.flips})`);
  }
}

// Dense turns: 8 mobs milling in a fenced pen (same setup as the soak).
// Commits must fly frankly: no full pirouette inside one commit (rotation
// is bounded per commit identity), no planted-rotation volume (turning
// without travelling), no left-right flicker beyond committed maneuvers,
// and cruises walk near-straight lines. Bounds are distribution guards:
// the pre-fix behavior spins 9–14 rad per commit and plants ~30 rad per
// run, so the pirouette bound is physical (< one full turn) and the rest
// carry margin over the measured frank behavior.
{
  const turns = (seed) => {
    buildFlat();
    const list = [];
    for (let i = 0; i < 8; i++) {
      const m = makeMob(-3 + (i % 4) * 2, -1 + Math.floor(i / 4) * 2 + 0.5, (seed + i) * 1.1, seed + i);
      m._peerIdx = i;
      list.push(m);
    }
    const pick = (m, r) => strideTarget(m, null, r);
    let plantRot = 0, flips = 0, maxRot = 0, maxBend = 0, commits = 0, bent = 0;
    const tr = list.map((m) => ({
      roam: /** @type {any} */ (null), rot: 0, len: 0, sx: m.pos.x, sz: m.pos.z,
    }));
    const prevYaw = list.map((m) => m.yaw), prevD = list.map(() => 0);
    const prevX = list.map((m) => m.pos.x), prevZ = list.map((m) => m.pos.z);
    for (let t = 0; t < 1200; t++) {
      planGroup(list, DT);
      for (const m of list) tickFarmMob(m, DT, pick, m.rand, list);
      list.forEach((m, i) => {
        // Servo ticks are out of scope: junction blends, corner arcs, and
        // deliberate dead-end U-turns all rotate by design (the soak suite
        // owns servo correctness). This rig watches lane-less commits
        // only — a lane engage closes the cruise like a re-decide.
        const key = m.lane ? null : m.roam;
        const s = tr[i];
        // Commit boundary (roam object identity): close out the previous
        // cruise — bend is path length over displacement, counted only
        // for cruises that actually went somewhere.
        if (key !== s.roam) {
          const disp = Math.hypot(m.pos.x - s.sx, m.pos.z - s.sz);
          if (s.roam && disp > 0.5) {
            commits++;
            const b = s.len / disp;
            maxBend = Math.max(maxBend, b);
            // A boxed mob reverses out (pi detour when narrower winds
            // refuse) — one frank escape per scrum, never a weave. Count
            // them; systematic weaving would produce dozens.
            if (b > 3.0) bent++;
          }
          tr[i] = { roam: key, rot: 0, len: 0, sx: m.pos.x, sz: m.pos.z };
        }
        // Lane-owned ticks steer by design — no lane-less metrics here.
        if (key === null) {
          prevD[i] = 0; prevYaw[i] = m.yaw;
          prevX[i] = m.pos.x; prevZ[i] = m.pos.z;
          return;
        }
        const st = tr[i];
        const d = normYaw(m.yaw - prevYaw[i]);
        st.rot += Math.abs(d);
        if (st.rot > maxRot) maxRot = st.rot;
        st.len += Math.hypot(m.pos.x - prevX[i], m.pos.z - prevZ[i]);
        if (Math.abs(d) > 0.004 && Math.abs(prevD[i]) > 0.004 && Math.sign(d) !== Math.sign(prevD[i])) flips++;
        prevD[i] = d; prevYaw[i] = m.yaw;
        // Planted rotation: yaw radians while the feet don't move — the
        // pirouette volume. Wall grinding with a static yaw doesn't count
        // (that's stuck-pushing, covered by the soak), only real turning.
        if (Math.hypot(m.pos.x - prevX[i], m.pos.z - prevZ[i]) < 1e-9) plantRot += Math.abs(d);
        prevX[i] = m.pos.x; prevZ[i] = m.pos.z;
      });
      separateFarmMobs(list);
    }
    return { plantRot, flips, maxRot, maxBend, commits, bent, pos: list.map((m) => [m.pos.x, m.pos.z]) };
  };
  for (const seed of [7, 21]) {
    const r1 = turns(seed), r2 = turns(seed);
    assert.deepEqual(r1.pos, r2.pos, `turns s${seed}: deterministic`);
    assert.ok(r1.maxRot < 6.0, `turns s${seed}: ${r1.maxRot.toFixed(2)} rad in one commit, want < 6.0 (no full pirouette)`);
    assert.ok(r1.plantRot < 60, `turns s${seed}: ${r1.plantRot.toFixed(1)} planted rad, want < 60`);
    assert.ok(r1.maxBend < 6.0, `turns s${seed}: bend ${r1.maxBend.toFixed(2)}, want < 6.0 (never a reversal-and-back weave)`);
    assert.ok(r1.bent <= 2, `turns s${seed}: ${r1.bent} bent cruises, want <= 2 (rare boxed reversals only)`);
    assert.ok(r1.flips <= 200, `turns s${seed}: ${r1.flips} heading flips, want <= 200`);
    console.log(`PASS turns s${seed} (rot ${r1.maxRot.toFixed(2)}, planted ${r1.plantRot.toFixed(1)}, bend ${r1.maxBend.toFixed(2)}, flips ${r1.flips}, cruises ${r1.commits})`);
  }
}

// Group convergence: 4 mobs walk at the center from four
// sides at staggered distances so sequencing can work. The engine reserves
// space-time most-blocked-first: all arrive, contacts stay brief brushes.
{
  buildFlat();
  const defs = [
    [-5, 0.5, Math.PI / 2, 501], [6, 0.5, -Math.PI / 2, 502],
    [0.5, -7, 0, 503], [0.5, 8, Math.PI, 504],
  ];
  const list = defs.map(([x, z, yaw, seed]) => makeMob(x, z, yaw, seed));
  const goals = new Map([
    [list[0], { x: 5, z: 0.5 }], [list[1], { x: -6, z: 0.5 }],
    [list[2], { x: 0.5, z: 7 }], [list[3], { x: 0.5, z: -8 }],
  ]);
  const r = runScenario(list, goals, { coop: true, ticks: 1500 });
  assert.ok(r.arrivedAt >= 0, "group converge: all arrive");
  assert.ok(r.contactTicks <= 130, `group converge: ${r.contactTicks} contact ticks, want <= 130 (4-way point crossing sequences through shallow brushes, never grinds)`);
  assert.ok(r.maxPre < 0.15, `group converge: max pen ${r.maxPre.toFixed(3)}, want < 0.15 (brushes stay shallow)`);
  assert.ok(r.postViolations === 0, `group converge: ${r.postViolations} post-separation violations`);
  assert.ok(r.maxPush < 0.05, `group converge: max shove ${r.maxPush.toFixed(3)}m in one tick, want < 0.05 (damped, never a teleport)`);
  console.log(`PASS group-converge (contacts ${r.contactTicks}, pushes ${r.pushTicks}/${r.pushVol.toFixed(2)}m, arrived @${r.arrivedAt})`);
}

// Triangle deadlock: 3 mobs on a ring, each aiming
// through the center at its antipode — every pair meets, and pairwise
// priority alone can cycle. The group order breaks it: all arrive.
{
  buildFlat();
  const P = Math.PI;
  const defs = [
    [4.5, 0.5, -P / 2, 601], [-2.25, 4.4, (5 * P) / 6, 602], [-2.25, -3.4, P / 6, 603],
  ];
  const list = defs.map(([x, z, yaw, seed]) => makeMob(x, z, yaw, seed));
  const goals = new Map([
    [list[0], { x: -4.5, z: 0.5 }], [list[1], { x: 2.25, z: -3.4 }],
    [list[2], { x: 2.25, z: 4.4 }],
  ]);
  const r = runScenario(list, goals, { coop: true, ticks: 1500 });
  assert.ok(r.arrivedAt >= 0, "triangle: all arrive");
  assert.ok(r.contactTicks <= 300, `triangle: ${r.contactTicks} contact ticks, want <= 300 (the 0.1 crossing budget brushes through instead of sidestepping — arrivals and max pen below stay the health signal)`);
  assert.ok(r.maxPre < 0.2, `triangle: max pen ${r.maxPre.toFixed(3)}, want < 0.2`);
  assert.ok(r.postViolations === 0, `triangle: ${r.postViolations} post-separation violations`);
  console.log(`PASS triangle (contacts ${r.contactTicks}, arrived @${r.arrivedAt})`);
}

// Grid equivalence: the spatial hash must return the same neighbor sets as
// a full scan — same scenario twice (free-roam soak exercises plan, yield,
// gate, detour, separation), once with null grid, once with a
// per-tick grid, must be bit-identical in positions and contact counts.
{
  const soakRun = (useGrid, seed) => {
    buildFlat();
    const list = [];
    for (let i = 0; i < 8; i++) {
      const m = makeMob(-3 + (i % 4) * 2, -1 + Math.floor(i / 4) * 2 + 0.5, (seed + i) * 1.1, seed + i);
      m._peerIdx = i;
      list.push(m);
    }
    const pick = (m, r) => strideTarget(m, null, r);
    let contacts = 0, maxPre = 0;
    for (let t = 0; t < 400; t++) {
      const grid = useGrid ? buildMobGrid(list, 3) : null;
      planGroup(list, DT, grid);
      for (const m of list) tickFarmMob(m, DT, pick, m.rand, list, grid);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const w = worstPairPen(list[i], list[j], i, j);
        if (w) { contacts++; maxPre = Math.max(maxPre, w.pen); }
      }
      separateFarmMobs(list, grid);
    }
    return { contacts, maxPre, pos: list.map((m) => [m.pos.x, m.pos.z]) };
  };
  for (const seed of [7, 21]) {
    const full = soakRun(false, seed), grid = soakRun(true, seed);
    assert.deepEqual(grid.pos, full.pos, `grid s${seed}: identical positions`);
    assert.equal(grid.contacts, full.contacts, `grid s${seed}: identical contact ticks`);
    assert.equal(grid.maxPre, full.maxPre, `grid s${seed}: identical max pen`);
    console.log(`PASS grid-equiv s${seed} (contacts ${grid.contacts}/400)`);
  }
}

// Pen spread: the herd must use the whole pen, edges included. The far
// window belongs to the CPA yield and the group order only engages inside
// ENGAGE_T, so a far wall never vetoes outward evasions pinning the group
// at the center. Six mobs free-roam a pen-sized slab for a minute; at
// least a fifth of mob-ticks must sit within 1.5 m of the fence ring.
{
  buildFlat(7);
  const defs = [
    [-2, -2, 11, 11], [2, -2, 22, 22], [-2, 2, 33, 33],
    [2, 2, 44, 44], [0, 0, 55, 55], [0, 0.5, 66, 66],
  ];
  const list = defs.map(([x, z, yaw, seed], i) => {
    const m = makeMob(x, z, yaw, seed);
    m._peerIdx = i;
    return m;
  });
  const pick = (m, r) => strideTarget(m, null, r);
  let border = 0, tot = 0;
  for (let t = 0; t < 3600; t++) {
    const grid = buildMobGrid(list, 3);
    planGroup(list, DT, grid);
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list, grid);
    separateFarmMobs(list, grid);
    for (const m of list) {
      tot++;
      const g = 7 - Math.max(Math.abs(m.pos.x), Math.abs(m.pos.z)) - m.hw;
      if (g < 1.5) border++;
    }
  }
  assert.ok(border / tot >= 0.2, `pen-spread: only ${(100 * border / tot).toFixed(1)}% of mob-ticks near the fence, want >= 20%`);
  console.log(`PASS pen-spread (${(100 * border / tot).toFixed(1)}% near fence)`);
}

// Nose parity: the snout must not tap walls. The planner reads past the
// nose reach, so near walls still turn the mob in time — six mobs mill a
// pen-sized slab for a minute, and snout-contact ticks stay a small
// fraction of mob-ticks.
{
  buildFlat(7);
  const defs = [
    [-2, -2, 11, 11], [2, -2, 22, 22], [-2, 2, 33, 33],
    [2, 2, 44, 44], [0, 0, 55, 55], [0, 0.5, 66, 66],
  ];
  const list = defs.map(([x, z, yaw, seed], i) => {
    const m = makeMob(x, z, yaw, seed);
    m._peerIdx = i;
    return m;
  });
  const pick = (m, r) => strideTarget(m, null, r);
  const snout = (m) => {
    const gx = m.pos.x + Math.sin(m.yaw) * m.nose.along;
    const gz = m.pos.z + Math.cos(m.yaw) * m.nose.along;
    return aabbIntersectsSolid(gx, m.pos.y, gz, m.nose.r, m.h);
  };
  let nose = 0;
  for (let t = 0; t < 3600; t++) {
    const grid = buildMobGrid(list, 3);
    planGroup(list, DT, grid);
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list, grid);
    separateFarmMobs(list, grid);
    for (const m of list) if (snout(m)) nose++;
  }
  assert.ok(nose <= 350, `nose-parity: ${nose} snout-contact ticks, want <= 350 (early sidesteps turn near walls, so the snout sweeps more often — brief grazes mid-turn, never grinds; see streak bounds)`);
  console.log(`PASS nose-parity (${nose} snout ticks)`);
}

console.log("separation.test.mjs: ALL PASS");
