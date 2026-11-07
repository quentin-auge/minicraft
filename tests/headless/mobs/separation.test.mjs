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
  mobRank, exitFresh1, freshFromMouth, followSlow, lineClaimedByPeer,
} from "../../../src/mobs/mover.js";
import { planGroup } from "../../../src/mobs/forecast.js";
import { buildMobGrid } from "../../../src/mobs/grid.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";
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
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
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

// Acute file catch-up: slow leader ahead, fast follower behind at a slight
// angle (~15°) — the same-direction meeting the file logic used to pace
// forever (the follower tailgated in the leader's wake, slowed every tick,
// never steering onto a parallel). The acute-jam detector (forecast.js)
// steers the follower onto a parallel line at full stride instead: it
// overtakes cleanly, contacts stay shallow brushes, both arrive.
{
  buildFlat();
  const lead = makeMob(0, 0.5, Math.PI / 2, 701);
  lead.speed = FARM_WALK * 0.5;
  const follow = makeMob(-2, 0.3, Math.PI / 2 + 0.25, 702);
  follow.speed = FARM_WALK * 1.4;
  const list = [lead, follow];
  const goals = new Map([[lead, { x: 8, z: 0.5 }], [follow, { x: 8, z: 0.5 }]]);
  const pick = (m) => goals.get(m);
  list.forEach((m, i) => { m._peerIdx = i; });
  const arrived = (m) => Math.hypot(goals.get(m).x - m.pos.x, goals.get(m).z - m.pos.z) < 1.0;
  const done = new Set();
  let contacts = 0, maxPre = 0, viol = 0, passed = false, arrivedAt = -1;
  for (let t = 0; t < 1200 && done.size < list.length; t++) {
    for (const m of list) if (!done.has(m) && arrived(m)) done.add(m);
    if (done.size === list.length) { arrivedAt = t; break; }
    for (const m of list) { if (done.has(m)) continue; keepGoal(m, goals, list); m.wanderT = NO_EXPIRY; }
    const active = list.filter((m) => !done.has(m));
    active.forEach((m, i) => { m._peerIdx = i; });
    planGroup(active, DT);
    for (const m of active) tickFarmMob(m, DT, pick, m.rand, active);
    if (active.length === 2 && follow.pos.x > lead.pos.x) passed = true;
    const pre = maxPen(active);
    if (pre > 1e-6) { contacts++; maxPre = Math.max(maxPre, pre); }
    separateFarmMobs(active);
    if (maxPen(active) > RESIDUE_MAX) viol++;
  }
  assert.ok(arrivedAt >= 0, "acute catch-up: both arrive");
  assert.ok(passed, "acute catch-up: the follower overtakes instead of tailgating forever");
  assert.ok(contacts <= 150, `acute catch-up: ${contacts} contact ticks, want <= 150`);
  assert.ok(maxPre < 0.15, `acute catch-up: max pen ${maxPre.toFixed(3)}, want < 0.15`);
  assert.equal(viol, 0, "acute catch-up: post-separation violations");
  console.log(`PASS acute-catch-up (contacts ${contacts}, arrived @${arrivedAt})`);
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
    let contacts = 0, deep = 0, violations = 0, maxPre = 0, maxStreak = 0, flips = 0, pushTicks = 0, maxPush = 0, postStreak = 0, maxPostStreak = 0;
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
      if (maxPen(list) > RESIDUE_MAX) { violations++; postStreak++; maxPostStreak = Math.max(maxPostStreak, postStreak); }
      else postStreak = 0;
    }
    return { contacts, deep, violations, maxPostStreak, maxPre, maxStreak, flips, pushTicks, maxPush, pos: list.map((m) => [m.pos.x, m.pos.z]) };
  };
  for (const seed of [7, 21]) {
    const r1 = soak(seed), r2 = soak(seed);
    assert.deepEqual(r1.pos, r2.pos, `soak s${seed}: deterministic`);
    assert.ok(r1.violations <= 8, `soak s${seed}: ${r1.violations} post-separation ticks > 0.2 (turn-away escape sweeps converge over a few ticks by design — damped, not teleported; persistence below proves the backstop converges)`);
    assert.ok(r1.maxPostStreak <= 8, `soak s${seed}: residue persisted ${r1.maxPostStreak} ticks (the backstop must converge every overlap — a stuck residue is a backstop failure)`);
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
  assert.ok(nose <= 400, `nose-parity: ${nose} snout-contact ticks, want <= 400 (early sidesteps turn near walls, so the snout sweeps more often — brief grazes mid-turn, never grinds; turn-away escapes add rare wall-grazes in corners, where grinds live; see streak bounds)`);
  console.log(`PASS nose-parity (${nose} snout ticks)`);
}

// Avoidance tiers (rank-only reads, no voxels): RED rails are obstacles,
// JAUNE 2-wide exits/threads hold, SORTIE-1 1-wide exits hold, VIOLET
// commits yield to exits, BLUE rides yield to holders, FREE yields to all.
{
  const base = () => makeMob(0, 0.5, 0, 1);
  assert.equal(mobRank(base()), 0, "free is rank 0");
  assert.equal(mobRank({ ...base(), lane: { axis: 0 }, followLine: null }), -1, "lane without touch is red (-1)");
  assert.equal(mobRank({
    ...base(), lane: { axis: 0, entry: Math.PI, lockX: -1, lockZ: -1 },
    followLine: { touch: true, axis: 0 },
  }), 1, "touch ride is rank 1");
  assert.equal(mobRank({
    ...base(), lane: { axis: 0, entry: Math.PI, lockX: -1, lockZ: -1 },
    followLine: { touch: true, axis: 0 }, roam: { entry: true }, target: { x: 0, z: 5 },
  }), 1, "guided ride (entry-carrying touch ride) is rank 1");
  assert.equal(mobRank({ ...base(), roam: { entry: true }, target: { x: 0, z: 5 } }), 2, "entry commit is rank 2");
  assert.equal(mobRank({ ...base(), entryCoolT: 999, entryCoolKey: "over|1:3,4" }), 3, "fresh 1-wide exit is rank 3");
  assert.equal(mobRank({ ...base(), passage: { kind: 2, axis: 0, key: "k", t: 0 } }), 4, "held passage is rank 4");
  assert.equal(mobRank({ ...base(), inPassage: true }), 4, "riding inside is rank 4");
  assert.equal(mobRank({ ...base(), roam: { smooth: true } }), 4, "smooth exit is rank 4");
  assert.equal(mobRank({ ...base(), entryCoolT: 999, entryCoolKey: "over|2:3,4" }), 4, "fresh 2-wide exit is rank 4");
  assert.equal(mobRank({ ...base(), entryCoolT: 0, entryCoolKey: null }), 0, "expired cooler is rank 0");
  assert.equal(exitFresh1({ ...base(), entryCoolT: 999, entryCoolKey: "over|1:3,4" }), true, "exitFresh1 reads 1-wide keys");
  assert.equal(exitFresh1({ ...base(), entryCoolT: 999, entryCoolKey: "over|2:3,4" }), false, "exitFresh1 ignores 2-wide keys");
  assert.equal(exitFresh1({ ...base(), entryCoolT: 0, entryCoolKey: "over|1:3,4" }), false, "exitFresh1 lapses with the timer");
  assert.equal(freshFromMouth({ ...base(), passage: { kind: 2 } }), true, "passage is fresh from mouth");
  assert.equal(freshFromMouth({ ...base(), entryCoolT: 999, entryCoolKey: "over|1:3,4" }), false, "1-wide freshness is not 2-wide freshness");
  console.log("PASS tiers-rank");
}

// Tiered planning rigs (flat slab): planGroup-only unless noted.
function tierMob(x, z, yaw, seed, i) {
  const m = makeMob(x, z, yaw, seed);
  m._peerIdx = i;
  return m;
}
function laneRide(m, axis = 0) {
  m.lane = { axis, entry: normYaw(axis + Math.PI), lockX: -1, lockZ: -1 };
  m.followLine = { axis, line: m.pos.x - 0.5, side: 1, rel: 1, virtual: true, touch: true, t: 0, wallSpan: 30 };
  return m;
}
function violetTo(m, tx, tz) {
  m.target = { x: tx, z: tz };
  m.wanderT = NO_EXPIRY;
  m.roam = { mode: "commit", heading: Math.atan2(tx - m.pos.x, tz - m.pos.z), target: m.target, tgt: m.target, t: 0, span: 30, entry: true };
  return m;
}

// Deep head-on contact detaches a blue ride to a validated free-roam wind;
// a shallow abreast brush only paces it slowed on the wall. Free roamers
// never trigger a detach (they plan last and go around).
{
  buildFlat();
  const blue = laneRide(tierMob(-2, -0.5, 0, 111, 0));
  const oncoming = violetTo(tierMob(-2, 2.5, Math.PI, 112, 1), -2, -6);
  planGroup([blue, oncoming], DT);
  assert.equal(blue._wantDetach, true, "deep head-on contact detaches the wall ride");
  assert.ok(blue._plan?.forced, "detach carries a forced wind");
  assert.ok(Math.abs(normYaw(blue._plan.heading)) > 0.2, "detach bends off the wall line");
}
{
  buildFlat();
  const blue = laneRide(tierMob(-2, -0.5, 0, 121, 0));
  const abreast = laneRide(tierMob(-1.2, 0.5, 0, 122, 1));
  abreast.target = { x: -1.2, z: 6 };
  planGroup([blue, abreast], DT);
  assert.equal(blue._wantDetach, false, "shallow abreast contact never detaches");
  console.log("PASS tiers-blue-detach");
}

// Head-on blue-blue crossing: exactly one ride detaches — the other holds
// its wall line at full stride through the meeting (yield agreement: the
// trigger already left for it). No double abandon, same tick or later.
{
  buildFlat();
  const a = laneRide(tierMob(-2, -0.5, 0, 171, 0), 0);
  const b = laneRide(tierMob(-2, 2.5, Math.PI, 172, 1), Math.PI);
  const list = [a, b];
  planGroup(list, DT);
  const detached = list.filter((m) => m._wantDetach);
  assert.equal(detached.length, 1, "head-on blue-blue detaches exactly one ride");
  const holder = detached[0] === a ? b : a;
  const yielder = detached[0];
  assert.equal(holder._wantDetach, false, "holder never deals a second detach");
  assert.ok(holder.lane != null, "holder keeps its lane");
  // The mover drops the yielder (lane → free-roam commit); the agreement
  // then holds the keeper at full stride on the following ticks.
  yielder.lane = null; yielder.followLine = null;
  planGroup(list, DT);
  assert.equal(holder._wantDetach, false, "holder never detaches after the yield");
  assert.ok(holder._plan?.forced && holder._plan.slow === 1, "holder keeps full stride");
  assert.ok(Math.abs(normYaw(holder._plan.heading - holder.lane.axis)) < 1e-9, "holder holds its wall line");
  for (let t = 0; t < 4; t++) {
    planGroup(list, DT);
    assert.equal(holder._wantDetach, false, `holder never detaches @tick${t}`);
  }
  console.log("PASS tiers-blue-crossing-yield");
}

// Red rails are moving-wall obstacles only: excluded from dealing.
{
  buildFlat();
  const red = tierMob(0, 0.5, 0, 131, 0);
  red.lane = { axis: 0, entry: Math.PI, lockX: -1, lockZ: -1 };
  const free = tierMob(0, 3.5, Math.PI, 132, 1);
  free.target = { x: 0, z: -6 };
  free.wanderT = NO_EXPIRY;
  free.roam = { mode: "commit", heading: Math.PI, target: free.target, tgt: free.target, t: 0, span: 30 };
  planGroup([red, free], DT);
  assert.equal(red._plan, null, "red plans nothing");
  assert.ok(free._plan?.forced, "others still route around the rail");
  console.log("PASS tiers-red-obstacle");
}

// Wedged 1-wide entry rig: commit north to (0,6) ringed at 1 m (entry is
// list[0]). No mouth voxels — the wedge is synthetic; the abort gate reads
// only the mob's target and the peers.
function wedgedEntry() {
  const entry = violetTo(tierMob(0, 0.5, 0, 141, 0), 0, 6);
  entry.roam.axis = 0; entry.roam.stallT = 0;
  entry.roam.passageKey = "over|1:9,9"; entry.roam.passageKind = 1;
  const ring = [];
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4;
    ring.push(tierMob(Math.sin(ang) * 1.0, 0.5 + Math.cos(ang) * 1.0, ang, 150 + k, k + 1));
  }
  return [entry, ...ring];
}

// A wedged 1-wide committer holds slowed on a static scrum (no abort —
// aborts are head-on yields, see below): ringed at 1 m on flat ground no
// narrow wind stays peer-free, so the plan keeps the slowed line and never
// flags the giveUp path.
{
  buildFlat();
  const list = wedgedEntry();
  planGroup(list, DT);
  assert.equal(list[0]._wantAbort, false, "static wedge never aborts");
  assert.ok(list[0]._plan?.forced && list[0]._plan.slow < 1, "wedged entry still walks slowed this tick (no freeze)");
  console.log("PASS tiers-entry-hold-empty");
}

// A wedged 1-wide committer aborts only for an exiter already inside
// coming out: same ring plus a peer between the mob and its hole slot
// heading outward — the plan flags the giveUp path and the mover latches
// it onto the commit.
{
  buildFlat();
  const list = wedgedEntry();
  list.push(tierMob(0, 1.6, Math.PI, 999, list.length));
  planGroup(list, DT);
  const entry = list[0];
  assert.equal(entry._wantAbort, true, "exiter inside flags abort");
  assert.ok(entry._plan?.forced && entry._plan.slow < 1, "wedged entry still walks slowed this tick (no freeze)");
  const pick = (m) => (m === entry ? entry.target : { x: m.pos.x, z: m.pos.z });
  tickFarmMob(entry, DT, pick, entry.rand, list);
  assert.equal(entry.roam?.giveUp, true, "mover converts the flag to the giveUp path (cooldown + retry)");
  console.log("PASS tiers-entry-abort-exiter");
}

// Detach switch: the mover drops lane+line and installs a free-roam commit
// on the dealt wind.
{
  buildFlat();
  const blue = laneRide(tierMob(-2, -0.5, 0, 161, 0));
  const oncoming = violetTo(tierMob(-2, 2.5, Math.PI, 162, 1), -2, -6);
  const list = [blue, oncoming];
  planGroup(list, DT);
  assert.equal(blue._wantDetach, true, "rig wedges the ride first");
  const pick = (m) => (m === blue ? blue.target : oncoming.target);
  tickFarmMob(blue, DT, pick, blue.rand, list);
  assert.equal(blue.lane, null, "detach drops the lane");
  assert.equal(blue.followLine, null, "detach drops the wall line");
  assert.equal(blue.roam?.mode, "commit", "detach installs a free-roam commit");
  assert.ok((blue.followCool ?? 0) > 0, "detach holds the next latch off");
  console.log("PASS tiers-detach-switch");
}

// Free roam yields to a blue holder: the holder keeps its slowed line
// without detaching (free peers never trigger a detach), the roamer takes
// the dodge (or the slowed cross) around it.
{
  buildFlat();
  const blue = laneRide(tierMob(-2, -0.5, 0, 191, 0));
  const free = tierMob(-2, 2.5, Math.PI, 192, 1);
  free.target = { x: -2, z: -6 };
  free.wanderT = NO_EXPIRY;
  free.roam = { mode: "commit", heading: Math.PI, target: free.target, tgt: free.target, t: 0, span: 30 };
  planGroup([blue, free], DT);
  assert.equal(blue._wantDetach, false, "holder never detaches for a free roamer");
  assert.ok(blue._plan?.forced, "holder keeps a forced plan");
  assert.ok(free._plan?.forced, "free roam routes around the holder");
  console.log("PASS tiers-free-yields");
}

// Guided blue (entry-carrying touch ride, the common in-game shape near
// holes) vs unlaned violet head-on: the guided blue detaches like a pure
// blue, the violet holds its slowed line — blues avoid violets.
{
  buildFlat();
  const guided = laneRide(tierMob(-2, -0.5, 0, 201, 0));
  guided.target = { x: -2, z: 6 };
  guided.wanderT = NO_EXPIRY;
  guided.roam = { mode: "commit", heading: 0, target: guided.target, tgt: guided.target, t: 0, span: 30, entry: true };
  const violet = violetTo(tierMob(-2, 2.5, Math.PI, 202, 1), -2, -6);
  const list = [guided, violet];
  planGroup(list, DT);
  assert.equal(guided._wantDetach, true, "guided blue detaches like a pure blue");
  assert.ok(guided._plan?.forced, "guided detach carries a forced wind");
  assert.equal(violet._wantDetach, false, "violet never detaches");
  assert.ok(violet.lane == null, "violet stays unlaned");
  const pick = (m) => (m === guided ? guided.target : violet.target);
  tickFarmMob(guided, DT, pick, guided.rand, list);
  assert.equal(guided.lane, null, "mover drops the guided lane");
  assert.equal(guided.roam?.entry, true, "the claimed slot survives the detach");
  console.log("PASS tiers-guided-blue-detach");
}

// Blue vs 1-wide exit holder: the holder keeps its slowed line (never
// steers/detaches/aborts), the blue detaches around it.
{
  buildFlat();
  const sortie = laneRide(tierMob(-2, -0.5, 0, 211, 0));
  sortie.target = { x: -2, z: 6 };
  sortie.entryCoolT = 999; sortie.entryCoolKey = "over|1:9,9";
  const blue = laneRide(tierMob(-2, 2.5, Math.PI, 212, 1), Math.PI);
  const list = [sortie, blue];
  planGroup(list, DT);
  assert.equal(sortie._wantDetach, false, "exit holder never detaches");
  assert.equal(sortie._wantAbort, false, "exit holder never aborts");
  assert.ok(sortie._plan?.forced && sortie._plan.slow < 1, "holder keeps its slowed line");
  assert.equal(blue._wantDetach, true, "blue detaches around the exit");
  console.log("PASS tiers-blue-avoids-exit1");
}

// Free-free head-on: both sides route (at least the first planner deals a
// forced wind) — open roam visibly avoids instead of crossing.
{
  buildFlat();
  const a = tierMob(0, -2, 0, 221, 0);
  a.target = { x: 0, z: 6 }; a.wanderT = NO_EXPIRY;
  a.roam = { mode: "commit", heading: 0, target: a.target, tgt: a.target, t: 0, span: 30 };
  const b = tierMob(0, 2, Math.PI, 222, 1);
  b.target = { x: 0, z: -6 }; b.wanderT = NO_EXPIRY;
  b.roam = { mode: "commit", heading: Math.PI, target: b.target, tgt: b.target, t: 0, span: 30 };
  planGroup([a, b], DT);
  assert.ok(a._plan?.forced || b._plan?.forced, "head-on free roam routes around");
  console.log("PASS tiers-free-avoids-free");
}

// Corner meetings: entering/exiting corners converge near ~90°, far outside
// the steer cone — detection reads close-range convergence instead, for
// every phase. Walls below are real voxels (dodge validation is voxel-bound).
function wallRun(x0, x1, z0, z1) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}

// Entering corner: two blues converging at 90° onto the same inner corner.
// Exactly one detaches (validated dodge), the other holds its wall line
// (full stride when the yield agreement fires, slowed crossing while the
// gentle dodge clears — still a single abandon either way).
{
  buildFlat();
  wallRun(-1, -1, -1, 5);
  wallRun(-1, 5, 5, 5);
  const a = laneRide(tierMob(1.0, 3.0, 0, 231, 0), 0);
  const b = laneRide(tierMob(2.4, 4.4, -Math.PI / 2, 232, 1), -Math.PI / 2);
  const list = [a, b];
  planGroup(list, DT);
  const detached = list.filter((m) => m._wantDetach);
  assert.equal(detached.length, 1, "inner corner: exactly one blue detaches");
  const holder = detached[0] === a ? b : a;
  assert.equal(holder._wantDetach, false, "inner corner: holder never double-detaches");
  assert.ok(holder._plan?.forced, "holder keeps a forced plan on its line");
  assert.ok(Math.abs(normYaw(holder._plan.heading - holder.lane.axis)) < 1e-9, "holder holds its wall line");
  console.log("PASS tiers-inner-corner-blues");
}

// Exiting corner: two blues rounding the same wall tip from both faces.
{
  buildFlat();
  wallRun(3, 3, -6, 0);
  const a = laneRide(tierMob(3.5, -0.5, 0, 241, 0), 0);
  const b = laneRide(tierMob(4.8, 0.8, -Math.PI / 2, 242, 1), -Math.PI / 2);
  const list = [a, b];
  planGroup(list, DT);
  const detached = list.filter((m) => m._wantDetach);
  assert.equal(detached.length, 1, "wall tip: exactly one blue detaches");
  const holder = detached[0] === a ? b : a;
  assert.ok(holder._plan?.forced, "tip holder keeps a forced plan on its line");
  assert.ok(Math.abs(normYaw(holder._plan.heading - holder.lane.axis)) < 1e-9, "tip holder holds its wall line");
  console.log("PASS tiers-outer-tip-blues");
}

// Corner cross, free roam: two 90°-crossing commits route around each other
// (detection is phase-agnostic, not wall-ride-only).
{
  buildFlat();
  const a = tierMob(0, -1.2, 0, 251, 0);
  a.target = { x: 0, z: 3 }; a.wanderT = NO_EXPIRY;
  a.roam = { mode: "commit", heading: 0, target: a.target, tgt: a.target, t: 0, span: 30 };
  const b = tierMob(1.4, 0.2, -Math.PI / 2, 252, 1);
  b.target = { x: -3, z: 0.2 }; b.wanderT = NO_EXPIRY;
  b.roam = { mode: "commit", heading: -Math.PI / 2, target: b.target, tgt: b.target, t: 0, span: 30 };
  planGroup([a, b], DT);
  // Either crosser may reserve first (sampling sees the rendezvous from
  // one side first); what matters is that the 90° meeting bends someone
  // off it instead of crossing straight through on both sides.
  const bent = [a, b].some((m) =>
    m._plan?.forced && Math.abs(normYaw(m._plan.heading - (m === a ? 0 : -Math.PI / 2))) > 0.2);
  assert.ok(bent, "corner cross: the 90° meeting bends a crosser off it");
  console.log("PASS tiers-corner-cross-free");
}

// Corner violet: unlaned entry vs guided blue converging at 90° on the same
// crossing point (simultaneous rendezvous) — the blue detaches, the violet
// holds its line (rank matrix, corner bearings).
{
  buildFlat();
  const blue = laneRide(tierMob(1.2, 2.0, 0, 261, 0), 0);
  blue.target = { x: 1.2, z: 6 }; blue.wanderT = NO_EXPIRY;
  blue.roam = { mode: "commit", heading: 0, target: blue.target, tgt: blue.target, t: 0, span: 30, entry: true };
  const violet = violetTo(tierMob(2.4, 3.2, -Math.PI / 2, 262, 1), -3, 3.2);
  const list = [blue, violet];
  planGroup(list, DT);
  assert.equal(blue._wantDetach, true, "corner violet: guided blue detaches");
  assert.equal(violet._wantDetach, false, "corner violet: violet never detaches");
  assert.ok(!violet._plan?.forced ||
    Math.abs(normYaw(violet._plan.heading + Math.PI / 2)) < 0.2,
    "corner violet: violet never bends off its line");
  console.log("PASS tiers-corner-violet");
}

// Matrix enforcement, free vs ranked: a free roamer meeting a blue holder
// on a shallow offset head-on bends around it instead of sequencing
// through the ranked line (deal-first at close range), while the blue
// holds its real wall without detaching. The blue latches naturally
// (servo-owned lane, like in game) and the wall is real voxels.
{
  buildFlat();
  for (let z = -8; z <= 8; z++) { setBlock(0, 1, z, STONE); setBlock(0, 2, z, STONE); }
  const blue = tierMob(1.5, 2, Math.PI, 271, 0);
  const free = tierMob(2.05, -2, 0, 272, 1);
  const list = [blue, free];
  const gBlue = { x: 1.5, z: -8 }, gFree = { x: 2.05, z: 6 };
  const pick = (m) => (m === free ? gFree : gBlue);
  let bent = false, blueDetached = false, blueRode = false;
  for (let t = 0; t < 200 && !bent; t++) {
    for (const m of list) {
      const g = m === free ? gFree : gBlue;
      m.target = g; m.wanderT = NO_EXPIRY;
      if (!m.roam || m.roam.tgt !== g) {
        const h = Math.atan2(g.x - m.pos.x, g.z - m.pos.z);
        m.roam = { mode: "commit", heading: h, target: g, tgt: g, t: 0, span: 30 };
      }
    }
    planGroup(list, DT);
    if (blue._wantDetach) blueDetached = true;
    if (blue.wallFollow) blueRode = true;
    if (free._plan?.forced && Math.abs(normYaw(free._plan.heading)) > 0.2) bent = true;
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list);
    separateFarmMobs(list);
  }
  assert.ok(blueRode, "free vs holder: the blue rides its wall into the meeting");
  assert.ok(bent, "free vs holder: the roamer bends around the ranked line");
  assert.ok(!blueDetached, "free vs holder: the blue never detaches for a roamer");
  console.log("PASS tiers-free-bends-around-blue");
}

// ---- Blue wall-ride meetings, full-tick on real voxels (rigs A–F) ----
// Two mobs walk at each other on real geometry through the real 3-phase
// tick (planGroup with grid + tickFarmMob + separateFarmMobs), like the
// game. Metrics are in the code's own terms: maxPre (pre-backstop
// penetration) must stay under CROSS_BUDGET (0.15) — deeper means the
// avoidance failed — and closest must prove the meeting happened (< 1.2 m).
// Blue rides are fabricated (same fields a natural latch erects) with
// pinWallRide (rides never quit on the budget, like production farm.js)
// and suppressed entry scans (entry preemption is covered by mob-paths
// rigs; here the blue must ride past). The run ends once the pair met and
// separated again, so post-meeting wander cannot manufacture contacts.
// Blues latch naturally (pinned 100% latch like production farm.js, budget
// never expires, entry scans suppressed — entry preemption is covered by
// mob-paths rigs; here the blue must ride past). Yaw aims slightly into
// the wall so the flank touch latches within the first ticks; the servo
// straightens to cardinal after.
function latchMob(x, z, yaw, seed) {
  const m = makeMob(x, z, yaw, seed);
  m.pinWallRide = true;
  m.entryScanT = 1e9;
  m.yawTarget = yaw;
  return m;
}
function runWallMeet(active, picks, { ticks = 700, laned = [] } = {}) {
  let maxPre = 0, contactTicks = 0, closest = Infinity, postViol = 0, ran = 0;
  const detached = new Set();
  const everLan = new Set();
  let met = false;
  for (let t = 0; t < ticks; t++) {
    ran = t + 1;
    active.forEach((m, i) => { m._peerIdx = i; });
    for (const m of laned) if (m.lane != null) everLan.add(m);
    if (t === 60) for (const m of laned) assert.ok(everLan.has(m), "rig setup: expected a latched blue ride by tick 60");
    const grid = buildMobGrid(active, 3);
    planGroup(active, DT, grid);
    for (const m of active) if (m._wantDetach) detached.add(m);
    const pick = (m) => picks.get(m) ?? m.target;
    for (const m of active) tickFarmMob(m, DT, pick, m.rand, active, grid);
    const pre = maxPen(active);
    if (pre > 1e-6) contactTicks++;
    if (pre > maxPre) maxPre = pre;
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const d = Math.hypot(active[i].pos.x - active[j].pos.x, active[i].pos.z - active[j].pos.z);
      if (d < closest) closest = d;
    }
    if (closest < 2.0) met = true;
    separateFarmMobs(active, grid);
    if (maxPen(active) > RESIDUE_MAX) postViol++;
    if (met && active.length === 2 &&
      Math.hypot(active[0].pos.x - active[1].pos.x, active[0].pos.z - active[1].pos.z) > 4) break;
  }
  return { maxPre, contactTicks, closest, detached, postViol, ran };
}
function wallRow(x0, x1, z, skip = []) {
  for (let x = x0; x <= x1; x++) {
    if (skip.includes(x)) continue;
    setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
}

// Rig A: same wall, opposite directions — two blues head-on on one face.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2);
  const a = latchMob(-6, 1.4, Math.PI / 2 - 0.2, 301);
  const b = latchMob(6, 1.4, -Math.PI / 2 + 0.2, 302);
  const r = runWallMeet([a, b], new Map([[a, { x: 30, z: 1.5 }], [b, { x: -30, z: 1.5 }]]), { laned: [a, b] });
  console.log(`wallmeet-A same-wall: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 2.0, `A: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.detached.size >= 1, "A: the head-on meeting must engage the avoidance (a detach)");
  assert.ok(r.maxPre < 0.15, `A: no deep contact head-on on one wall (maxPre ${r.maxPre.toFixed(3)})`);
  assert.equal(r.postViol, 0, "A: no post-separation violations");
  console.log("PASS wallmeet-A-same-wall");
}

// Rig A2: same wall, crowded — a file each way reserves the winds around
// the meeting (like the pen with 8 mobs): even wedged, nobody may walk
// through anybody.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2);
  const a = latchMob(-6, 1.4, Math.PI / 2 - 0.2, 303);
  const a2 = latchMob(-4, 1.4, Math.PI / 2 - 0.2, 304);
  const b = latchMob(6, 1.4, -Math.PI / 2 + 0.2, 305);
  const b2 = latchMob(4, 1.4, -Math.PI / 2 + 0.2, 306);
  const list = [a, a2, b, b2];
  const r = runWallMeet(list, new Map([[a, { x: 30, z: 1.5 }], [a2, { x: 30, z: 1.5 }], [b, { x: -30, z: 1.5 }], [b2, { x: -30, z: 1.5 }]]), { laned: list });
  console.log(`wallmeet-A2 crowd: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 2.0, `A2: the groups must actually meet (closest ${r.closest.toFixed(2)}m)`);
  // Escape sweeps may brush (a startle about-face out of nose contact
  // sweeps the snout across the peer for a few ticks): no body-body
  // overlap, no sustained grind.
  assert.ok(r.maxPre < 0.35, `A2: only transient escape-sweep brushes in the crowd (maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.contactTicks < 120, `A2: meetings must stay brief (contacts ${r.contactTicks})`);
  assert.equal(r.postViol, 0, "A2: no post-separation violations");
  console.log("PASS wallmeet-A2-crowd");
}

// Rig B: opening (inner) corner — one blue turns south into the arm while
// another rides north up the same arm, head-on at the corner mouth.
{
  buildFlat(); clearEntryClaims();
  wallRow(-6, 2, 2);
  for (let z = -4; z <= 2; z++) { setBlock(3, 1, z, STONE); setBlock(3, 2, z, STONE); }
  const a = latchMob(-2, 1.4, Math.PI / 2 - 0.2, 311);
  const b = latchMob(2.4, -2.5, 0.2, 312);
  const r = runWallMeet([a, b], new Map([[a, { x: 30, z: 1.5 }], [b, { x: 2.5, z: 30 }]]), { laned: [a, b] });
  console.log(`wallmeet-B inner-corner: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 3.0, `B: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.detached.size >= 1, "B: the corner meeting must engage the avoidance (a detach)");
  assert.ok(r.maxPre < 0.15, `B: no deep contact in the inner corner (maxPre ${r.maxPre.toFixed(3)})`);
  assert.equal(r.postViol, 0, "B: no post-separation violations");
  console.log("PASS wallmeet-B-inner-corner");
}

// Rig C: exiting (outer) corner — one blue rounds the tip north while
// another rides south down the same column face, head-on at the tip.
{
  buildFlat(); clearEntryClaims();
  wallRow(-6, 2, 2);
  for (let z = 2; z <= 8; z++) { setBlock(2, 1, z, STONE); setBlock(2, 2, z, STONE); }
  const a = latchMob(-3, 1.4, Math.PI / 2 - 0.2, 321);
  const b = latchMob(3.6, 7, Math.PI + 0.2, 322);
  const r = runWallMeet([a, b], new Map([[a, { x: 30, z: 1.5 }], [b, { x: 3.5, z: -30 }]]), { laned: [a, b] });
  console.log(`wallmeet-C outer-tip: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 3.0, `C: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.detached.size >= 1, "C: the tip meeting must engage the avoidance (a detach)");
  assert.ok(r.maxPre < 0.15, `C: no deep contact on the wall tip (maxPre ${r.maxPre.toFixed(3)})`);
  assert.equal(r.postViol, 0, "C: no post-separation violations");
  console.log("PASS wallmeet-C-outer-tip");
}

// Rig D1: 1-wide exiter walks out of the hole (threads the rail like
// production, then holds out on its fresh key) across a blue ride on a
// second wall south of the mouth — the blue must detach around it,
// rail or holder alike.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2, [0]);
  wallRow(-8, 8, -2);
  const a = latchMob(-2.5, -0.4, Math.PI / 2 + 0.2, 331);
  const out = latchMob(0.5, 1.0, Math.PI, 332);
  out.target = { x: 0.5, z: -3 }; out.wanderT = NO_EXPIRY;
  out.roam = { mode: "commit", heading: Math.PI, target: out.target, tgt: out.target, t: 0, span: 30 };
  out.entryCoolT = 999; out.entryCoolKey = "over|1:0,2";
  const r = runWallMeet([a, out], new Map([[a, { x: 30, z: -0.5 }], [out, { x: 0.5, z: -30 }]]), { laned: [a] });
  console.log(`wallmeet-D1 exit1: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 2.5, `D1: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.detached.has(a), "D1: the blue must detach around the 1-wide exiter");
  assert.ok(r.maxPre < 0.15, `D1: no deep contact with the 1-wide exiter (maxPre ${r.maxPre.toFixed(3)})`);
  assert.equal(r.postViol, 0, "D1: no post-separation violations");
  console.log("PASS wallmeet-D1-exit1");
}

// Rig D2: 2-wide exiter walks out of a double hole across a blue ride on
// a second wall south of the mouth.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2, [0, 1]);
  wallRow(-8, 8, -2);
  const a = latchMob(-2.5, -0.4, Math.PI / 2 + 0.2, 341);
  const out = latchMob(1.0, 1.0, Math.PI, 342);
  out.target = { x: 1.0, z: -3 }; out.wanderT = NO_EXPIRY;
  out.roam = { mode: "commit", heading: Math.PI, target: out.target, tgt: out.target, t: 0, span: 30 };
  out.entryCoolT = 999; out.entryCoolKey = "over|2:0,2";
  const r = runWallMeet([a, out], new Map([[a, { x: 30, z: -0.5 }], [out, { x: 1.0, z: -30 }]]), { laned: [a] });
  console.log(`wallmeet-D2 exit2: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  // The wide mouth reads early: the blue detaches before closing in (early
  // avoidance path, unlike D1's tight crossing) — the assert is the
  // detach plus zero contact, not a close pass.
  assert.ok(r.closest < 3.5, `D2: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.detached.has(a), "D2: the blue must detach around the 2-wide exiter");
  assert.ok(r.maxPre < 0.15, `D2: no deep contact with the 2-wide exiter (maxPre ${r.maxPre.toFixed(3)})`);
  assert.equal(r.postViol, 0, "D2: no post-separation violations");
  console.log("PASS wallmeet-D2-exit2");
}

// Rig E: blue vs violet head-on in the open — the violet holds its slot
// line, the blue must go around (matrix), no deep contact either way.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2);
  const a = latchMob(-6, 1.4, Math.PI / 2 - 0.2, 351);
  const v = latchMob(6, 1.5, -Math.PI / 2, 352);
  v.target = { x: -8, z: 1.5 }; v.wanderT = NO_EXPIRY;
  v.roam = { mode: "commit", heading: -Math.PI / 2, target: v.target, tgt: v.target, t: 0, span: 30, entry: true };
  const r = runWallMeet([a, v], new Map([[a, { x: 30, z: 1.5 }], [v, { x: -30, z: 1.5 }]]), { laned: [a] });
  console.log(`wallmeet-E violet: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 2.0, `E: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.detached.has(a), "E: the blue must detach around the violet");
  assert.ok(r.maxPre < 0.15, `E: no deep contact with the violet (maxPre ${r.maxPre.toFixed(3)})`);
  assert.equal(r.postViol, 0, "E: no post-separation violations");
  console.log("PASS wallmeet-E-violet");
}

// Rig F2: free roamer walks a parallel line head-on past a blue wall ride
// (offset half a metre) — the free bends around (plans last), the blue
// never detaches for it, no deep contact either way. (Red rails at mouths
// are covered by D1's rail-threading phase plus the planGroup-only
// tiers-red-obstacle rig.)
{
  buildFlat(); clearEntryClaims();
  for (let z = -8; z <= 8; z++) { setBlock(0, 1, z, STONE); setBlock(0, 2, z, STONE); }
  const a = latchMob(1.6, 2, Math.PI + 0.2, 371);
  const f = latchMob(2.05, -2, 0, 372);
  f.target = { x: 2.05, z: 6 }; f.wanderT = NO_EXPIRY;
  f.roam = { mode: "commit", heading: 0, target: f.target, tgt: f.target, t: 0, span: 30 };
  const r = runWallMeet([a, f], new Map([[a, { x: 1.5, z: -30 }], [f, { x: 2.05, z: 30 }]]), { laned: [a] });
  console.log(`wallmeet-F2 free: closest ${r.closest.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} contacts ${r.contactTicks} detached ${r.detached.size} @${r.ran}`);
  assert.ok(r.closest < 1.5, `F2: the pair must actually meet (closest ${r.closest.toFixed(2)}m)`);
  assert.ok(r.maxPre < 0.15, `F2: no deep contact with the free roamer (maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(!r.detached.has(a), "F2: the blue never detaches for a free roamer");
  assert.equal(r.postViol, 0, "F2: no post-separation violations");
  console.log("PASS wallmeet-F2-free");
}

// Merge rigs: bodies must never fuse into one — a visible overlap is a
// bounded transient (a brush the drives walk out of), never a persistent
// merge. Each rig drives the real tick and tracks, per pair, the pre/post
// backstop penetration plus the longest unbroken visible-contact episode
// (consecutive ticks with pen > 0.05): that episode is what reads as "two
// mobs merged" in game. Bounds match the existing suite (contact budget
// CROSS_BUDGET, residue RESIDUE_MAX) with an added episode cap.
// Hand-erected blue ride (no latch luck): the lane + follow line of a wall
// ride east/west along the north-wall face (line z = 1.5), exactly what a
// contact latch would erect. Deterministic from tick 0, unlike walked-in
// latches whose approach wanders.
function blueRide(m, axis) {
  m.pinWallRide = true; m.entryScanT = 1e9;
  const east = Math.abs(normYaw(axis - Math.PI / 2)) < 1e-9;
  m.lane = { axis, entry: normYaw(axis + Math.PI), lockX: -1, lockZ: -1 };
  m.followLine = {
    axis, line: 1.5, side: -1, rel: east ? 1 : -1,
    virtual: true, touch: true, face: 2, fresh: 30, t: 0,
  };
  m.yaw = axis; m.yawTarget = axis;
  return m;
}
function runMerge(active, picks, { ticks = 700, laned = [], setup = null, name = "?" } = {}) {
  let maxPre = 0, maxPost = 0, maxPostLate = 0, contactTicks = 0, deepTicks = 0, ran = 0;
  let longestRun = 0, run = 0, exactMin = Infinity, finalD = Infinity, detached = 0;
  // Stuck run: consecutive contact ticks with NOBODY going anywhere (no
  // mob past a 0.2 m leash from the run start) and no escape maneuver
  // running. A brush file at full stride resets every tick; a genuine
  // grind — static bodies in contact — accrues. This is the stuck metric:
  // longestRun (contact alone) also counts files walking together.
  let stuckRun = 0, stuck = 0;
  const stuckOX = new Map();
  const everLan = new Set();
  if (setup) setup();
  const pick = (m) => picks.get(m) ?? m.target;
  for (let t = 0; t < ticks; t++) {
    ran = t + 1;
    active.forEach((m, i) => { m._peerIdx = i; });
    for (const m of laned) if (m.lane != null) everLan.add(m);
    const grid = buildMobGrid(active, 3);
    planGroup(active, DT, grid);
    for (const m of active) if (m._wantDetach) detached++;
    for (const m of active) tickFarmMob(m, DT, pick, m.rand, active, grid);
    const pre = maxPen(active);
    if (pre > maxPre) maxPre = pre;
    if (pre > 1e-6) contactTicks++;
    if (pre > 0.15) deepTicks++;
    if (pre > 0.05) { run++; if (run > longestRun) longestRun = run; } else run = 0;
    if (pre > 0.05) {
      let moved = false;
      for (const m of active) {
        if ((m._turnAway ?? 0) > 0) { moved = true; break; }
        const o = stuckOX.get(m);
        if (!o) stuckOX.set(m, { x: m.pos.x, z: m.pos.z });
        else if (Math.hypot(m.pos.x - o.x, m.pos.z - o.z) > 0.2) { moved = true; break; }
      }
      if (moved) { stuck = 0; stuckOX.clear(); }
      else { stuck++; if (stuck > stuckRun) stuckRun = stuck; }
    } else { stuck = 0; stuckOX.clear(); }
    let d = Infinity;
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      d = Math.min(d, Math.hypot(active[i].pos.x - active[j].pos.x, active[i].pos.z - active[j].pos.z));
    }
    if (d < exactMin) exactMin = d;
    finalD = d;
    separateFarmMobs(active, grid);
    const post = maxPen(active);
    if (post > maxPost) maxPost = post;
    if (t >= 60 && post > maxPostLate) maxPostLate = post;
  }
  for (const m of laned) assert.ok(everLan.has(m), name + " rig setup FAILED: never laned pos=" + m.pos.x.toFixed(2) + "," + m.pos.z.toFixed(2));
  return { maxPre, maxPost, maxPostLate, contactTicks, deepTicks, longestRun, stuckRun, exactMin, finalD, ran, detached };
}

// Rig M1: coincident spawn — two mobs on the exact same spot (debug spawn,
// pen pileup). The setup contact is the rig's own fault; the backstop must
// unstack it in bounded ticks and never park both bodies at d ≈ 0.
{
  buildFlat(); clearEntryClaims();
  const a = makeMob(2, 2, 0, 401);
  const b = makeMob(2, 2, Math.PI, 402);
  const goals = new Map([[a, { x: 20, z: 2 }], [b, { x: -20, z: 2 }]]);
  const r = runMerge([a, b], goals, { name: "M1", ticks: 300 });
  console.log(`merge-M1 coincident-spawn: finalD ${r.finalD.toFixed(2)}m longestRun ${r.longestRun} deepTicks ${r.deepTicks} maxPostLate ${r.maxPostLate.toFixed(3)}`);
  assert.ok(r.finalD > 0.8, `M1: coincident spawn must unstack (finalD ${r.finalD.toFixed(2)}m)`);
  assert.ok(r.longestRun < 120, `M1: overlap must resolve in bounded ticks (longestRun ${r.longestRun})`);
  assert.ok(r.maxPostLate < 0.2, `M1: backstop must converge (maxPostLate ${r.maxPostLate.toFixed(3)})`);
  console.log("PASS merge-M1-coincident-spawn");
}

// Rig M2: pace the real advance — a file leader stalled mid-U-turn (speed
// field full, zero underfoot) must stop its exempt follower. followSlow
// reads the speed field only, so the follower keeps full stride into the
// stalled leader. Unit rig (no voxels): the file exemption hands
// tailgating to this discipline alone. Gap 2.5 m: nose-to-tail clear, so
// only the advance ratio decides.
{
  const lead = makeMob(2.5, 0, Math.PI / 2, 403);
  const fol = makeMob(0, 0, Math.PI / 2, 404);
  lead.speed = FARM_WALK; fol.speed = FARM_WALK;
  lead._adv = 0; fol._adv = FARM_WALK / 60;
  const stalled = followSlow(fol, [lead, fol]);
  console.log(`merge-M2 pace-advance: stalled-leader slow ${stalled.toFixed(3)}`);
  assert.ok(stalled < 0.1, `M2: a stalled leader must stop its follower (slow ${stalled.toFixed(3)})`);
  lead._adv = FARM_WALK / 60;
  const steady = followSlow(fol, [lead, fol]);
  assert.ok(Math.abs(steady - 1) < 1e-9, `M2: a steady file keeps full stride (slow ${steady.toFixed(3)})`);
  console.log("PASS merge-M2-pace-advance");
}

// Rig M4b: boxed head-on — two blues meet nose-to-nose on one line with
// the dodge side walled. Both turn away (flip in place, sidestep where
// one validates) and separate instead of parking in contact; no stuck
// episode past half a second, no deep contact, converging residue.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2);
  wallRow(-8, 8, -1);
  const a = blueRide(latchMob(-3, 1.5, Math.PI / 2, 421), Math.PI / 2);
  const b = blueRide(latchMob(3, 1.5, -Math.PI / 2, 422), -Math.PI / 2);
  const r = runMerge([a, b],
    new Map([[a, { x: 30, z: 1.5 }], [b, { x: -30, z: 1.5 }]]),
    { name: "M4b", ticks: 700, laned: [a, b] });
  console.log(`merge-M4b boxed-headon: closest ${r.exactMin.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} longestRun ${r.longestRun} stuckRun ${r.stuckRun} deepTicks ${r.deepTicks} contacts ${r.contactTicks} detached ${r.detached}`);
  assert.ok(r.exactMin < 2.0, `M4b: the pair must actually meet (closest ${r.exactMin.toFixed(2)}m)`);
  assert.ok(r.deepTicks < 8, `M4b: only transient escape-sweep brushes in the boxed meeting (deepTicks ${r.deepTicks}, maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.stuckRun <= 30, `M4b: no stuck episode past 0.5 s (stuckRun ${r.stuckRun})`);
  assert.ok(r.maxPost < 0.2, `M4b: no post-separation violations (maxPost ${r.maxPost.toFixed(3)})`);
  console.log("PASS merge-M4b-boxed-headon");
}

// Rig M3: second latch onto an occupied line declines — two mobs side by
// side touch the same wall on the same tick; the first latch wins and the
// second declines instead of erecting two rides on one body (nose/tail
// discs overlap out to ~2 m, so no abreast latch ever starts clean).
// Unit pins the veto both ways; the live run asserts the outcome (never
// two blues on one line) plus bounded contact while the refused mob
// routes around.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 2);
  const a = blueRide(latchMob(-0.6, 1.5, Math.PI / 2, 405), Math.PI / 2);
  const b = latchMob(0.6, 1.5, Math.PI / 2, 406);
  b.pinWallRide = true; b.entryScanT = 1e9;
  // Unit pins: a rival erected on the same line (as the servo would erect
  // it before the veto runs) reads claimed when overlapping, free when far.
  const u1 = blueRide(latchMob(-0.6, 1.5, Math.PI / 2, 1405), Math.PI / 2);
  const u2 = blueRide(latchMob(0.6, 1.5, Math.PI / 2, 1406), Math.PI / 2);
  assert.equal(lineClaimedByPeer(u2, [u1, u2]), true, "M3: an overlapped line reads claimed");
  u2.pos.x = 9;
  assert.equal(lineClaimedByPeer(u2, [u1, u2]), false, "M3: a clear line reads free");
  a.target = { x: 30, z: 1.5 }; b.target = { x: 30, z: 1.5 };
  const goals = new Map([[a, a.target], [b, b.target]]);
  const list = [a, b];
  const pick = (m) => goals.get(m);
  let shared = 0, maxPre = 0, maxPostLate = 0, contactRun = 0, longestRun = 0;
  let finalD = Infinity;
  for (let t = 0; t < 700; t++) {
    list.forEach((m, i) => { m._peerIdx = i; });
    const grid = buildMobGrid(list, 3);
    planGroup(list, DT, grid);
    for (const m of list) tickFarmMob(m, DT, pick, m.rand, list, grid);
    const pre = maxPen(list);
    if (pre > maxPre) maxPre = pre;
    if (pre > 0.05) { contactRun++; if (contactRun > longestRun) longestRun = contactRun; } else contactRun = 0;
    if (a.lane != null && b.lane != null && b.followLine?.touch === true &&
      Math.abs((b.followLine.line ?? 9) - (a.followLine.line ?? -9)) < 0.05 &&
      Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 3 && pre > 0.02) shared++;
    separateFarmMobs(list, grid);
    const post = maxPen(list);
    if (t >= 60 && post > maxPostLate) maxPostLate = post;
    finalD = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  }
  console.log(`merge-M3 simul-latch: shared ${shared} longestRun ${longestRun} maxPre ${maxPre.toFixed(3)} maxPostLate ${maxPostLate.toFixed(3)} finalD ${finalD.toFixed(2)}`);
  assert.equal(shared, 0, "M3: no second blue ever erects on the occupied line");
  assert.ok(longestRun < 150, `M3: contact must stay bounded (longestRun ${longestRun})`);
  assert.ok(maxPostLate < 0.2, `M3: backstop must converge (maxPostLate ${maxPostLate.toFixed(3)})`);
  console.log("PASS merge-M3-simul-latch");
}

// Rig M4: tip stall file — a file rides east to the wall tip where the
// leader U-turns in place; the box denies every detach wind, so the file
// must hold. The follower paces the leader's real advance (never its
// speed field) instead of grinding through the stall.
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 2, 2);
  wallRow(-8, 8, -1);
  const lead = blueRide(latchMob(-2, 1.5, Math.PI / 2, 407), Math.PI / 2);
  const fol = blueRide(latchMob(-4.5, 1.5, Math.PI / 2, 408), Math.PI / 2);
  const r = runMerge([lead, fol],
    new Map([[lead, { x: 30, z: 1.5 }], [fol, { x: 30, z: 1.5 }]]),
    { name: "M4", ticks: 700, laned: [lead, fol] });
  console.log(`merge-M4 tip-file-stall: closest ${r.exactMin.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} longestRun ${r.longestRun} deepTicks ${r.deepTicks} detached ${r.detached}`);
  assert.ok(r.exactMin < 2.0, `M4: the follower must actually catch up (closest ${r.exactMin.toFixed(2)}m)`);
  assert.ok(r.deepTicks === 0, `M4: no deep contact in the stall (deepTicks ${r.deepTicks}, maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.longestRun < 120, `M4: contact must stay bounded (longestRun ${r.longestRun})`);
  assert.ok(r.maxPost < 0.2, `M4: no post-separation violations (maxPost ${r.maxPost.toFixed(3)})`);
  console.log("PASS merge-M4-tip-file-stall");
}

// Rig M5: dead-end seek into a parked peer — the peer waits at the back
// wall, so the classifier fires the dead-end seek while the peer blocks the
// nose. The drive must stop at contact range and the wedge must release to
// roam instead of walking through the peer or grinding in place.
{
  buildFlat(); clearEntryClaims();
  for (let z = -4; z <= 4; z++) {
    setBlock(-1, 1, z, STONE); setBlock(-1, 2, z, STONE);
    setBlock(1, 1, z, STONE); setBlock(1, 2, z, STONE);
  }
  wallRow(-1, 1, 4);
  const parked = makeMob(0.5, 3.4, Math.PI, 409);
  parked.speed = 0; parked.target = { x: 0.5, z: 3.4 }; parked.wanderT = NO_EXPIRY;
  const seeker = makeMob(0.5, -3.5, 0, 410);
  seeker.pinWallRide = true; seeker.entryScanT = 1e9;
  const r = runMerge([parked, seeker],
    new Map([[parked, parked.target], [seeker, { x: 0.5, z: 30 }]]),
    { name: "M5", ticks: 700 });
  console.log(`merge-M5 seek-into-peer: closest ${r.exactMin.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} longestRun ${r.longestRun} stuckRun ${r.stuckRun} deepTicks ${r.deepTicks}`);
  assert.ok(r.exactMin < 2.5, `M5: the seeker must actually reach the peer (closest ${r.exactMin.toFixed(2)}m — nose-touch range, the exact gate stops at first touch)`);
  assert.ok(r.deepTicks === 0, `M5: no deep contact on the seek (deepTicks ${r.deepTicks}, maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.stuckRun <= 30, `M5: no stuck episode past 0.5 s (stuckRun ${r.stuckRun}, longestRun ${r.longestRun})`);
  assert.ok(r.maxPost < 0.2, `M5: no post-separation violations (maxPost ${r.maxPost.toFixed(3)})`);
  console.log("PASS merge-M5-seek-into-peer");
}

// Rig M6: double-veto notch — two mobs spawned overlapping in a 1 m slot
// where the axial push parks into walls on both sides. The backstop must
// still work them out along the free tangent instead of keeping the
// overlap. Pure backstop unit (no drives): the drives never run here.
{
  buildFlat(); clearEntryClaims();
  wallRow(-1, 1, 1); wallRow(-1, 1, -1);
  const a = makeMob(0.5, 0.65, Math.PI / 2, 411);
  const b = makeMob(0.5, 0.38, Math.PI / 2, 412);
  const list = [a, b];
  list.forEach((m, i) => { m._peerIdx = i; });
  assert.ok(maxPen(list) > 0.15, "M6 setup: the pair must start overlapping");
  let late = 0;
  for (let t = 0; t < 120; t++) {
    separateFarmMobs(list);
    if (t >= 60) late = Math.max(late, maxPen(list));
  }
  const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  console.log(`merge-M6 double-veto: finalD ${d.toFixed(2)}m latePen ${late.toFixed(3)}`);
  assert.ok(d > 0.8, `M6: the notch pair must unstack (finalD ${d.toFixed(2)}m)`);
  assert.ok(late < 0.2, `M6: backstop must converge (latePen ${late.toFixed(3)})`);
  console.log("PASS merge-M6-double-veto");
}

// Rig M7: dense pen with a wall stub — six mobs wander, latch, and meet
// around one stub wall (blue and non-blue mixing). Episodes stay bounded.
{
  buildFlat(7); clearEntryClaims();
  wallRow(-2, 2, 0);
  const list = [];
  const goals = new Map();
  for (let i = 0; i < 6; i++) {
    const m = makeMob(-4 + i * 1.3, -3 + (i % 2) * 5, (i * 1.1) % (Math.PI * 2), 420 + i);
    m.pinWallRide = true; m.entryScanT = 1e9;
    const g = { x: 4 - i * 1.3, z: 3 - (i % 2) * 5 };
    goals.set(m, g); list.push(m);
  }
  const r = runMerge(list, goals, { ticks: 700 });
  console.log(`merge-M7 pen-stub: maxPre ${r.maxPre.toFixed(3)} longestRun ${r.longestRun} deepTicks ${r.deepTicks} contacts ${r.contactTicks}`);
  assert.ok(r.deepTicks === 0, `M7: no deep contact in the pen (deepTicks ${r.deepTicks}, maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.longestRun < 120, `M7: episodes must stay bounded (longestRun ${r.longestRun})`);
  assert.ok(r.maxPost < 0.2, `M7: no post-separation violations (maxPost ${r.maxPost.toFixed(3)})`);
  console.log("PASS merge-M7-pen-stub");
}

// Rig M8: corner pocket — a railed follower grinds a stationary mob nose
// to nose in a 1-wide dead-end pocket (spawned in contact, M1-style: the
// setup overlap is the rig's own fault). The follower must not bulldoze
// the waiter, and no mutual-contact episode may stick past half a second:
// turn away, leave, return — bounded, never parked in contact.
{
  buildFlat(); clearEntryClaims();
  wallRow(0, 4, 1);
  wallRow(0, 4, -1);
  for (let z = -1; z <= 1; z++) { setBlock(4, 1, z, STONE); setBlock(4, 2, z, STONE); }
  const fol = makeMob(0.8, 0.5, Math.PI / 2, 431);
  fol.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: -1, lockZ: -1 };
  const parked = makeMob(2.7, 0.5, -Math.PI / 2, 432);
  parked.speed = 0; parked.target = { x: 2.7, z: 0.5 }; parked.wanderT = NO_EXPIRY;
  const r = runMerge([fol, parked],
    new Map([[fol, { x: 30, z: 0.5 }], [parked, parked.target]]),
    { name: "M8", ticks: 900, laned: [fol] });
  console.log(`merge-M8 corner-pocket: closest ${r.exactMin.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} longestRun ${r.longestRun} stuckRun ${r.stuckRun} deepTicks ${r.deepTicks} contacts ${r.contactTicks} finalD ${r.finalD.toFixed(2)}`);
  assert.ok(r.exactMin < 2.0, `M8: the pair must actually meet in the pocket (closest ${r.exactMin.toFixed(2)}m)`);
  // Escape sweeps brush transiently (an in-place about-face out of nose
  // contact sweeps the snout across the peer for a few ticks): no
  // body-body overlap (0.6+), no sustained grind.
  assert.ok(r.deepTicks < 8, `M8: only transient escape-sweep brushes (deepTicks ${r.deepTicks}, maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.maxPre < 0.6, `M8: no body-body overlap (maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.stuckRun <= 30, `M8: no stuck episode past 0.5 s (stuckRun ${r.stuckRun}, longestRun ${r.longestRun})`);
  assert.ok(r.maxPost < 0.2, `M8: no post-separation violations (maxPost ${r.maxPost.toFixed(3)})`);
  console.log("PASS merge-M8-corner-pocket");
}

// Rig M9: 1-wide corridor, rail vs waiter — same grind in the open:
// the follower rides east into a stationary mob mid-corridor (spawned in
// contact). Episodes stay within half a second and the waiter stops
// travelling (courtesy hold: push a passive peer and the drive holds
// instead of bulldozing it down the corridor).
{
  buildFlat(); clearEntryClaims();
  wallRow(-8, 8, 1);
  wallRow(-8, 8, -1);
  const fol = makeMob(-1.0, 0.5, Math.PI / 2, 433);
  fol.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: -1, lockZ: -1 };
  const parked = makeMob(0.9, 0.5, -Math.PI / 2, 434);
  parked.speed = 0; parked.target = { x: 0.9, z: 0.5 }; parked.wanderT = NO_EXPIRY;
  const r = runMerge([fol, parked],
    new Map([[fol, { x: 30, z: 0.5 }], [parked, parked.target]]),
    { name: "M9", ticks: 900, laned: [fol] });
  console.log(`merge-M9 rail-waiter: closest ${r.exactMin.toFixed(2)}m maxPre ${r.maxPre.toFixed(3)} longestRun ${r.longestRun} stuckRun ${r.stuckRun} deepTicks ${r.deepTicks} contacts ${r.contactTicks} finalD ${r.finalD.toFixed(2)}`);
  assert.ok(r.exactMin < 2.0, `M9: the pair must actually meet (closest ${r.exactMin.toFixed(2)}m)`);
  // Escape sweeps brush transiently (an in-place about-face out of nose
  // contact sweeps the snout across the peer for a few ticks): no
  // body-body overlap (0.6+), no sustained grind.
  assert.ok(r.deepTicks < 8, `M9: only transient escape-sweep brushes (deepTicks ${r.deepTicks}, maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.maxPre < 0.6, `M9: no body-body overlap (maxPre ${r.maxPre.toFixed(3)})`);
  assert.ok(r.stuckRun <= 30, `M9: no stuck episode past 0.5 s (stuckRun ${r.stuckRun}, longestRun ${r.longestRun})`);
  assert.ok(r.maxPost < 0.2, `M9: no post-separation violations (maxPost ${r.maxPost.toFixed(3)})`);
  console.log("PASS merge-M9-rail-waiter");
}

console.log("separation.test.mjs: ALL PASS");
