// Farm-mob kinematics: the 1-wide corridor servo, stepping, falling, and
// separation. Three-free and headless-testable: positions are plain
// {x, y, z} writes, visuals are guarded behind `mob.root` (null headless).
// Shared step physics live in step.js (R0), the directional policy and
// the gap scan in corridor.js; farm.js owns the meshes, spawning,
// and lifecycle. Headless rigs drive this module on live voxels.
import { FARM_WALK_DIVISOR } from "./livestock.js";
import {
  PROBE_DIST, normYaw, yawDiff, dirVec, cellCenter, oppositeYaw, snapCardinal, snap8,
  CARDINALS, classifyExits, updateLane, laneTunneled, isTwoWideMouth, mouthKey,
  ENTRY_COOL_T, LEAVE_FRESH_T, mobHeadsToCooledMouth, insideCooledMouth,
} from "./corridor.js";
import { entryTick, passageTick } from "./entry.js";
import { queryMobGrid, buildMobGrid } from "./grid.js";
import {
  aabbIntersectsSolid, hasSupport,
  liquidSurface, footingOk, headroomOk,
  makeCellFree, makeCellSolid, makeStepOk, descendOk, turnTo,
  moveClamped, moveVector, driveToward, dropLane, spawnRng, stepVertical,
  SERVO_STEP, VIRTUAL_W, NO_EXPIRY, slideDeflect, segmentWalkable,
} from "./step.js";
import {
  upkeepFollowLine, roamStep, roamSpan, ARRIVE_D, FOLLOW_COOL,
  latchTouchWall, latchFlankTouch, measureWallTake, cornerTurn,
  sameWallFace, connectedTake, tipOuterCorner, wallQuitHeading, wallQuitCommit,
  exitMouth, tryGuidedErect, guidedDock, entryStallLatch,
  GENTLE_RATE, GENTLE_FRESH_TICKS,
} from "./roam.js";
// Re-exports: the headless rigs read shared physics through this module.
export { aabbIntersectsSolid, segmentWalkable } from "./step.js";

// Base stride speed straight from master's pig/cow walk; the divisor slows
// it to a farm amble.
const MASTER_WALK = 4.3;
export const FARM_WALK = MASTER_WALK / FARM_WALK_DIVISOR;
// 1-wide servo tuning: tighter yaw for clean corner arcs. The servo drive
// senses with the body box + body column only (nose 0, footNose 0): the
// body (hw 0.32) is already the widest lateral part, and any forward nose
// reach rakes the inner corner of every chicane into micro-stops. Core
// footing + body box keep every drop illegal exactly as elsewhere.
// Yaw tracks the corner blend fast (tight arcs at full stride: a 90° swing
// covers ~0.4 m, inside one cell) — slowing down is never how a turn fits.
export const SERVO_TURN = 7;
// Rotate-in-place past this yaw error (U-turn starts, corner entries); below
// it forward speed scales with cos(error) for arc-while-moving fluidity.
export const SERVO_SPIN = 1.2;
// Corner swing duration: the junction blend turns entry→exit over this
// time, tracked by the fast servo yaw above so the drive never stops.
export const BLEND_T = 0.3;
// Fresh-turn hold: after a touch-ride turn the router holds the new lane
// this many ticks while the blend arc completes (~0.5 s ≈ 1 m of travel
// onto the new line), so it never re-decides mid-arc.
export const TURN_HOLD_TICKS = 30;
// Pushing against a wall toward an unreachable target re-picks this fast
// instead of waiting out wanderT, so a hole gets used instead of missed.
export const STUCK_T = 0.5;
// Push threshold (m): the backstop only corrects penetrations deeper
// than this — a shallower brush is invisible at body scale and resolves
// on its own as the mobs walk past each other. Correcting every
// sub-centimetre touch is exactly what reads as shoving: the drive walks
// in, the backstop shoves back out, every tick.
export const PUSH_T = 0.07;
// Per-side per-iteration correction cap (m): no single shove may move a
// mob more than this in one tick, veto or not — deep overlaps converge
// over a few ticks instead of teleporting once. Combined with the
// threshold above, the backstop is invisible day-to-day and gentle when
// it must work (wall sandwiches, debug spawns).
export const PUSH_CAP = 0.025;
// Separation gap added to every circle-pair need, and vertical gate:
// mobs more than this far apart in Y never interact.
export const SEP_GAP = 0.1;
export const SEP_Y = 1.2;
// Progress watchdog: a mob shuffling without closing on its target is
// stuck even when its feet move — slides and separation shoves reset the
// stillness clock below while the dance goes nowhere. Sample the target
// distance twice a second: two consecutive samples without meaningful
// closing escalate exactly like stillness. Suppressed while a maneuver
// flies (sidesteps legitimately open distance) and without a target.
export const PROG_T = 0.5;
export const PROG_MIN = 0.15;
export const PROG_STRIKES = 4;
// A committed detour never runs longer than this: long enough to sidestep
// one blocker — and to hold it instead of re-deciding every half second —
// but short enough that a stale heading can't drag a mob across the map.
export const DETOUR_SPAN = 1.5;
// Step-gate overlap allowance (m): a step whose worst circle-pair
// penetration stays within this brushes through instead of being refused.
// Mobs hold committed headings through shallow contact instead of
// stopping at nose range and re-picking every tick; the separation
// backstop clears the residue every tick, so nothing ever wedges.
// Picks, block detection, and pushes stay exact (see below).
export const GATE_ALLOW = 0.05;
// Crossing budget (m): how deep two bodies may overlap in passing before
// the step gate refuses like a wall — read everywhere a meeting asks "can
// we cross": the step gate, the detour probe, and the planner's cross test
// (forecast.js). Shipped at 0.15: shoulders brush past, the backstop
// clearing every residue. Turn maneuvers tolerate a small give past it
// (see TURN_GIVE) — bounded, never a walk-through.
export const CROSS_BUDGET = 0.15;
export const TURN_GIVE = 0.05;
// Maneuver turn give (m): how far past the brush budget a turn-away
// escape may sweep while unwinding nose-to-nose contact. Broad snouts
// veto every partial yaw under the strict rule, freezing the escape in
// place; this much deepening unfreezes it. Transient, backstop-cleared,
// an order below body-body overlap.
// Comfort margin (m) added to the picker's blocked check: aim with room
// to spare since bodies keep moving after the pick. The step gate itself
// stays exact — it refuses only true overlaps.
export const PICK_COMFORT = 0.3;
// Peer-grind trip (s): sustained static contact trips this fast — the
// pair-distance leash (see grindAccrue) restamps every passing brush, so
// only grinding in place counts, and a quarter second already separates
// meetings from mayhem. Past the ~0.25 s passing brushes, so brushes
// never trip even at this speed.
export const GRIND_T = 0.25;
// Peer-hold fuse (s): a quiet hold re-polls the escape this often —
// geometry shifts as the peer maneuvers, so a hold that never re-checks
// would freeze a meeting the next sidestep could have resolved.
export const HOLD_FUSE = 0.15;
// Grind-episode window (s): re-grinding the same peer inside this counts
// the next episode (escalating yield); past it the slate is clean.
export const GRIND_WINDOW = 4;
// Turn-away leave: first-episode hop and repeat-episode long yield
// (distance m, span s). The long yield also doubles the latch cooldown so
// the yielder does not re-latch straight back into the same meeting.
export const LEAVE_DIST = 1.6;
export const LEAVE_SPAN = 0.5;
export const YIELD_DIST = 2.4;
export const YIELD_SPAN = 0.9;
// Prediction horizon: ~3 s at farm stride (~6 m). Long enough to
// sequence a pen crossing early, short enough that a latched roam heading
// stays roughly valid.
export const PREDICT_T = 3.0;
// Scratch buffers for grid queries (single-threaded, never reentrant:
// each call fully consumes its buffer before the next begins).
const _sepNear = [];

// Intended heading: the latched roam commit when there is one (2–8 s of
// known direction), else the current yaw. Peers expose the same fields,
// so both sides predict off committed intent, not just nose direction.
function intentHeading(mob) {
  return mob.roam?.mode === "commit" && mob.roam.heading != null ? mob.roam.heading : mob.yaw;
}

// Closest point of approach between two mobs on intended headings at
// current speeds: {t, miss} or null when diverging, near-static, or past
// the horizon. Pure and headless-testable (kept for the unit rigs and as
// the documented intent math; the tick no longer yields off it — speed
// only ever takes the planner's two levels, never a continuous factor).
export function predictCPA(a, b) {
  const ah = intentHeading(a), bh = intentHeading(b);
  const avx = a.speed * Math.sin(ah), avz = a.speed * Math.cos(ah);
  const bvx = (b.speed ?? a.speed) * Math.sin(bh), bvz = (b.speed ?? a.speed) * Math.cos(bh);
  const px = b.pos.x - a.pos.x, pz = b.pos.z - a.pos.z;
  const vx = bvx - avx, vz = bvz - avz;
  const vv = vx * vx + vz * vz;
  if (vv < 1e-6) return null;
  const t = -((px * vx + pz * vz) / vv);
  if (t < 0 || t > PREDICT_T) return null;
  const mx = px + vx * t, mz = pz + vz * t;
  return { t, miss: Math.hypot(mx, mz) };
}

// File-following: a peer ahead in the corridor on the same heading sets
// the pace — match its speed instead of tailgating into it, so files walk
// parallel at constant spacing instead of grinding. Only slows (never
// speeds up), lane-less only, same Y only. Asymmetric by geometry: the
// leader sees the follower behind (outside its cone) and keeps full
// stride. Deterministic, no rand stream. Internal to the tick (lane-less
// slow factor only); no external callers.
const _followNear = [];
// Whether mob paces behind o (the file-following relation): o ahead-close
// on the same heading. The paced peer is exempt from the laned peer gate
// below (pacing owns tailgating; the gate owns meetings) — except an acute
// catch-up at a slight angle (see acuteSameDir in forecast.js): the gate
// still stops the step, the planner still steers, so a follower never walks
// through its leader. The exemption stays for settled files at constant
// spacing; only the closing-angle case re-arms the gate.
const ACUTE_PACE_COS = 0.5;
function followsPace(mob, o) {
  if (o === mob || !o.alive) return false;
  if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) return false;
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  const rx = -Math.cos(mob.yaw), rz = Math.sin(mob.yaw);
  const ox = o.pos.x - mob.pos.x, oz = o.pos.z - mob.pos.z;
  const d2 = ox * ox + oz * oz;
  if (d2 > 3.0 * 3.0 || d2 < 1e-8) return false;
  const d = Math.sqrt(d2);
  if ((ox * fx + oz * fz) / d < 0.9) return false;
  if (Math.abs(ox * rx + oz * rz) > mob.hw + o.hw + SEP_GAP + 0.3) return false;
  const sameDir = Math.sin(mob.yaw) * Math.sin(o.yaw) + Math.cos(mob.yaw) * Math.cos(o.yaw);
  // Pace catch-ups up to ~60° off the leader's heading (acute files meet at
  // a slight angle, never dead astern); settled files (≈0°) pace exactly as
  // before, so existing replays keep their spacing.
  if (sameDir < ACUTE_PACE_COS) return false;
  if (mob.speed <= 1e-9) return false;
  return true;
}
// Whether a live peer already rides mob's latched line overlapping the
// mob's body: a second latch there erects two rides on one body — the
// lateral slide converges both onto the same middle and the pair grinds as
// one (nose/tail discs overlap out to ~1.35 m, far past the core gap, so no
// fixed distance separates cleanly — read the circles themselves). Pure
// reads; grid optional (latches are rare, peer sets small).
export function lineClaimedByPeer(mob, peers, grid = null) {
  const vw = mob.followLine;
  if (!vw || !mob.lane) return false;
  const list = grid ? queryMobGrid(grid, mob.pos.x, mob.pos.z, 3.0, _penNear) : peers;
  for (const o of list) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    if (o.followLine?.touch !== true || o.lane == null) continue;
    const w = worstPairPenAt(mob.pos.x, mob.pos.z, Math.sin(mob.yaw), Math.cos(mob.yaw),
      mob.hw, mob.nose, mob.tail, o, 0, 0);
    if (w != null && w.pen > 0) return true;
  }
  return false;
}
// Exported for headless units (merge rigs pin the file discipline alone).
export function followSlow(mob, peers, grid = null) {
  let slow = 1;
  const list = grid ? queryMobGrid(grid, mob.pos.x, mob.pos.z, 3.0, _followNear) : peers;
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  for (let k = 0; k < list.length; k++) {
    const o = list[k];
    if (!followsPace(mob, o)) continue;
    // Pace the leader's real advance, not its speed field: a leader stalled
    // mid-U-turn (full stride on paper, zero underfoot) must stop its
    // gate-exempt follower — the file exemption hands tailgating to this
    // discipline alone. Falls back to the speed ratio while either advance
    // is unknown (first tick); a standing follower paces a standing leader
    // at zero (never resumes into it) and a walking one at the legacy ratio.
    const oa = o._adv, ma = mob._adv;
    const pace = (oa != null && ma != null)
      ? (ma > 1e-9 ? oa / ma : (oa > 1e-9 ? (o.speed ?? mob.speed) / mob.speed : 0))
      : (o.speed ?? mob.speed) / mob.speed;
    // Gap keeping: pacing alone tailgates into the leader and grinds at
    // contact range — ease off proportionally with live overlap (all body
    // circles, not just core distance: nose/tail discs overlap far past
    // the core gap), so files settle parallel with a gap instead of fused.
    // Smooth (no bang-bang): clear reads full pace, deep reads stop.
    const w = worstPairPenAt(mob.pos.x, mob.pos.z, fx, fz, mob.hw, mob.nose, mob.tail, o, 0, 0);
    slow = Math.min(slow, pace, w == null ? 1 : Math.max(0, 1 - w.pen / 0.3));
  }
  return Math.min(slow, 1);
}

// Worst circle-pair penetration between a body posed at (ax, az) with the
// given yaw-oriented circles and mob b's live body circles: null when
// clear. Lets the step gate test a candidate position without moving
// anything. Exported for the group planner (forecast.js), which poses
// trajectory samples through the same math. i/j feed the deterministic
// coincident-center fallback.
export function worstPairPenAt(ax, az, asx, asz, ahw, anose, atail, b, i, j) {
  const bsx = Math.sin(b.yaw), bsz = Math.cos(b.yaw);
  let wPen = 0, wNx = 0, wNz = 0, wD = 0, wNeed = 0;
  for (let ai = 0; ai < 3; ai++) {
    const aa = ai === 0 ? 0 : ai === 1 ? anose.along : atail.along;
    const ar = ai === 0 ? ahw : ai === 1 ? anose.r : atail.r;
    const cx = ax + asx * aa, cz = az + asz * aa;
    for (let bi = 0; bi < 3; bi++) {
      const ba = bi === 0 ? 0 : bi === 1 ? b.nose.along : b.tail.along;
      const br = bi === 0 ? b.hw : bi === 1 ? b.nose.r : b.tail.r;
      const ox = cx - (b.pos.x + bsx * ba), oz = cz - (b.pos.z + bsz * ba);
      const need = ar + br + SEP_GAP;
      const d2 = ox * ox + oz * oz;
      if (d2 >= need * need) continue;
      // Coincident centers have no normal: deterministic fallback
      // direction from the pair indices (recomputed next tick, so
      // any axis unstacks exact overlaps instead of skipping them).
      if (d2 < 1e-8) {
        const fa = (i * 2.39996 + j * 1.2345) % (Math.PI * 2);
        if (need > wPen) { wPen = need; wNx = Math.sin(fa); wNz = Math.cos(fa); wD = 0; wNeed = need; }
        continue;
      }
      const d = Math.sqrt(d2), pen = need - d;
      if (pen > wPen) { wPen = pen; wNx = ox / d; wNz = oz / d; wD = d; wNeed = need; }
    }
  }
  return wPen <= 0 ? null : { pen: wPen, nx: wNx, nz: wNz, d: wD, need: wNeed };
}
export function worstPairPen(a, b, i = 0, j = 1) {
  if (Math.abs(a.pos.y - b.pos.y) > SEP_Y) return null;
  return worstPairPenAt(a.pos.x, a.pos.z, Math.sin(a.yaw), Math.cos(a.yaw),
    a.hw, a.nose, a.tail, b, i, j);
}

// Max circle-pair penetration between a body posed at (x, z) with the
// given yaw-oriented circles and any live same-level peer: 0 when clear.
// One rule behind the step gate, the laned gate, and the turn gate (same
// budget, same math — only the pose and the verdict differ). extra inflates
// the core half-width (comfort margin for picks); exempt skips peers whose
// spacing another discipline owns (paced file peers, same-direction pairs).
// Pure: reads positions only.
const _penNear = [];
export function peerPenAt(mob, x, z, sx, sz, y, peers, grid = null, extra = 0, exempt = null) {
  // 3.5 m query covers the 3 m skip below (steps move cm per tick), so the
  // same peers are examined. Null grid = legacy scan.
  const list = grid ? queryMobGrid(grid, x, z, 3.5, _penNear) : peers;
  let worst = 0;
  for (const o of list) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - y) > SEP_Y) continue;
    if (exempt != null && exempt(o)) continue;
    const ox = o.pos.x - x, oz = o.pos.z - z;
    if (ox * ox + oz * oz > 3 * 3) continue;
    const w = worstPairPenAt(x, z, sx, sz, mob.hw + extra, mob.nose, mob.tail, o, 0, 0);
    if (w != null && w.pen > worst) worst = w.pen;
  }
  return worst;
}

// Would mob m occupying (x, z) overlap any peer's body circles past the
// allowance? allow is the step-gate brush budget (GATE_ALLOW on real steps,
// 0 for exact detection); skipFollowed exempts paced file peers (their
// spacing is the follow discipline's job, not the gate's). Absolute gate:
// separating steps still read blocked past the budget — unstacking owns
// the backstop, which converges every overlap on its own (escape hatches
// here fight the planner's holds: a drive walking through contact the
// planner sequenced around re-latches holds that never drop).
export function mobBlockedAt(mob, x, z, y, peers, extra = 0, grid = null, allow = 0, skipFollowed = false) {
  const exempt = skipFollowed ? (o) => followsPace(mob, o) : null;
  // allow = 0 keeps the exact gate (any touch blocks); a brush budget only
  // ever lets shallower penetrations through.
  return peerPenAt(mob, x, z, Math.sin(mob.yaw), Math.cos(mob.yaw), y, peers, grid, extra, exempt) > allow;
}

// Turn gate factory (see tickFarmMob): poses the body at a candidate yaw
// through the same circle math as the step gate. A turn landing past the
// brush budget is refused; an already-deep pose stays free so escape turns
// and the stuck path keep working. Same-direction pairs (files, formation
// flight) are exempt — pacing and drift own their spacing — EXCEPT a turn
// that would deepen same-direction contact past the brush budget: the nose
// lever outruns the stride, so a sweep the planner never predicted must not
// grind into a file mate. Settling turns at constant spacing stay frank.
// give relaxes every refusal by that much (maneuver turns only): a
// broad-snount nose-to-nose deadlock vetoes every partial yaw under the
// strict rule, so the escape would freeze in place — bounded deepening
// unfreezes it without ever freeing a real sweep-through.
export function makeTurnGate(mob, peers, grid = null, give = 0) {
  const meetingOnly = (o) => Math.cos(normYaw(o.yaw - mob.yaw)) >= 0.5;
  return (yaw) => {
    const curAll = peerPenAt(mob, mob.pos.x, mob.pos.z,
      Math.sin(mob.yaw), Math.cos(mob.yaw), mob.pos.y, peers, grid);
    if (curAll > CROSS_BUDGET) return true;
    const nextAll = peerPenAt(mob, mob.pos.x, mob.pos.z,
      Math.sin(yaw), Math.cos(yaw), mob.pos.y, peers, grid);
    if (nextAll > CROSS_BUDGET + give) return false;
    const cur = peerPenAt(mob, mob.pos.x, mob.pos.z,
      Math.sin(mob.yaw), Math.cos(mob.yaw), mob.pos.y, peers, grid, 0, meetingOnly);
    if (cur > CROSS_BUDGET) return true;
    const next = peerPenAt(mob, mob.pos.x, mob.pos.z,
      Math.sin(yaw), Math.cos(yaw), mob.pos.y, peers, grid, 0, meetingOnly);
    // Middle band (brush already engaged): rotate out, never in — a sweep
    // the planner never predicted (nose lever outruns the stride) must not
    // deepen contact, while clear-air turns keep the landing budget.
    if (cur > GATE_ALLOW) return next <= cur + give;
    return next <= CROSS_BUDGET + give;
  };
}

// Whether voxel walls stand within snout-sweep range in any direction:
// nose-aware occupancy at the current spot, faced around the compass —
// a wall the snout could sweep while turning in place. Near such walls
// the classic stillness path owns escalation: a progress maneuver fired
// here only rotates the snout along the rock. Open-field shuffles (peer
// scrums) read clear and escalate frank pushes.
function wallNear(mob, supported, floating) {
  for (let k = 0; k < 8; k++) {
    const yaw = (k * Math.PI) / 4;
    if (!makeStepOk(mob, supported, floating, mob.nose.along, yaw)(mob.pos.x, mob.pos.z)) return true;
  }
  return false;
}

// Whether a live peer (not a wall) blocks the nose right now: probe two
// short steps ahead along the current facing with the crossing budget (a
// brush that would pass the gate must not count as blocked). Pure: reads
// positions only.
export function mobBlocksAhead(mob, peers, grid = null) {
  const hx = Math.sin(mob.yaw), hz = Math.cos(mob.yaw);
  for (const d of [0.25, 0.5]) {
    if (mobBlockedAt(mob, mob.pos.x + hx * d, mob.pos.z + hz * d, mob.pos.y, peers, 0, grid, CROSS_BUDGET)) return true;
  }
  return false;
}

// Detour target that routes around a blocking peer: short goal-relative
// sidesteps (1–2.4 m) on the 8-wind, narrow first, each validated
// end-to-end against walls AND other mobs. Short on purpose: a detour only
// needs to clear one body width — a full 4–10 m stride would drag the mob
// metres off its line before the next decision. The first valid one wins.
// Returns {target, heading} or null (caller falls back to a plain re-pick).
export function pickDetourTarget(mob, rand, peers, grid = null) {
  if (!peers || !mob.target) return null;
  const base = snap8(Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z));
  const blocked = (x, z) => mobBlockedAt(mob, x, z, mob.pos.y, peers, PICK_COMFORT, grid);
  const P = Math.PI;
  for (const dh of [0, P / 4, -P / 4, P / 2, -P / 2, (3 * P) / 4, -(3 * P) / 4, P]) {
    const heading = base + dh;
    const sx = Math.sin(heading), cz = Math.cos(heading);
    for (const dist of [1.0, 1.6, 2.4]) {
      const tx = mob.pos.x + sx * dist, tz = mob.pos.z + cz * dist;
      let bad = false;
      const n = Math.max(1, Math.ceil(dist / 0.5));
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        if (blocked(mob.pos.x + (tx - mob.pos.x) * f, mob.pos.z + (tz - mob.pos.z) * f)) {
          bad = true;
          break;
        }
      }
      if (bad) continue;
      if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, tx, tz)) continue;
      // Nose-tip endpoint (see above): no doomed commits the drive
      // would refuse to finish.
      const nx = tx + sx * mob.nose.along, nz = tz + cz * mob.nose.along;
      if (aabbIntersectsSolid(nx, mob.pos.y, nz, mob.nose.r, mob.h)) continue;
      return { target: { x: tx, z: tz }, heading };
    }
  }
  return null;
}

// Stride validation (imported from step.js): destination rules plus the
// whole segment, so fences, house walls, and troughs bound targets
// emergently — no pen fork.
// Permanent 1-path centering: the single lateral pull behind every lane
// event (engage/junction/lock-turn, dead-end seek) and every cruise tick —
// so blend arcs exit centered and turns never slide sideways. Same target
// in both cases (follow-line middle while wall-following, with opposite
// headings sharing the line, else the cell centre); the axisOk probe below
// refuses any slide into a wall, so junction mouths stay honest.
// holdLine selects the stale-line guard: turns and seeks ignore a virtual
// line far from the body (following it would drag the turn into the wall
// it was latched against); cruise holds the latched line unconditionally.
// Returns the applied slide (0 when refused) so the stall guard can credit
// it as progress.
function centerPull(mob, dt, supported, floating, holdLine, peers = null) {
  const [ax, az] = dirVec(mob.lane.axis);
  // Parallel rides (mouth exits) never slide laterally onto their line: the
  // body keeps its threading offset while the ride turns and quits on the
  // real geometry. Probes and takes are unaffected, only the slide is.
  if (mob.followLine?.noSlide === true) return 0;
  let ccx = cellCenter(mob.pos.x), ccz = cellCenter(mob.pos.z);
  const vw = mob.followLine;
  // Sidestepped rides aim at the offset parallel, not the measured line.
  const lineT = vw ? vw.line + (mob._lineOff ?? 0) : 0;
  if (vw) {
    const dd = Math.abs(normYaw(vw.axis - mob.lane.axis));
    if (dd < 1e-6 || dd > Math.PI - 1e-6) {
      const near = (ax === 0 && Math.abs(mob.pos.x - lineT) <= Math.abs(mob.pos.x - ccx)) ||
        (ax !== 0 && Math.abs(mob.pos.z - lineT) <= Math.abs(mob.pos.z - ccz));
      // Same corridor line reads the same middle from either direction.
      // Freshly carried lines (touch latches, corner turns) bypass the
      // stale-line guard: the line is new and measured walkable, the body
      // just hasn't slid onto it yet — upkeep ticks the freshness down.
      if (!holdLine || near || (vw.fresh ?? 0) > 0) {
        if (ax === 0) ccx = lineT; else ccz = lineT;
      }
    }
  }
  const e = (ccx - mob.pos.x) * -az + (ccz - mob.pos.z) * ax;
  // File discipline on touch rides: a follower pacing a leader on the same
  // wall holds its lateral offset instead of converging onto the leader's
  // line (both pulls targeting the same middle is what glued files into one
  // body). Same voxel probe below, just a smaller slide — the leader keeps
  // the full pull, so the file walks parallel instead of merging.
  // Pull-up: a touch ride crabbing far off its line (diagonal placement
  // latch, spawn drop) with open room ahead converges at double rate, so
  // the drive never outruns the pull into a wide arc — the ride re-glues
  // before the corner instead of sliding past it. Only with a real gap:
  // glued takes, threading (noSlide) and hole-ward (guided) lines keep
  // their exact legacy pull, and anything with a wall soon ahead stays
  // untouched. The axisOk probe below still gates every slide, so no pull
  // ever enters a wall.
  let rate = vw?.gentle === true ? GENTLE_RATE : 0.9;
  if (peers && vw?.touch === true && mob.followLine?.touch === true) {
    for (let k = 0; k < peers.length; k++) {
      const o = peers[k];
      if (o !== mob && o.alive && followsPace(mob, o)) { rate *= 0.3; break; }
    }
  }
  let pullScale = 1;
  if (vw?.touch === true && vw.noSlide !== true && vw.guideKey == null && mob.lane) {
    const [tax2] = dirVec(mob.lane.axis);
    const gap = Math.abs(vw.line - (tax2 !== 0 ? mob.pos.z : mob.pos.x));
    if (gap > 0.3) {
      const [lax, laz] = dirVec(mob.lane.axis);
      if (segmentWalkable(mob, mob.pos.x, mob.pos.z,
        mob.pos.x + lax * 2.0, mob.pos.z + laz * 2.0)) pullScale = 2;
    }
  }
  const cap = mob.speed * dt * rate * pullScale;
  let c = Math.max(-cap, Math.min(cap, e));
  if (Math.abs(c) <= 1e-4) return 0;
  const centerBase = makeStepOk(mob, supported, floating, 0, mob.lane.axis, 0);
  const axisOk = wrapStepOk(mob, (nx, nz) => centerBase(nx, nz) && descendOk(mob, nx, nz));
  // Peer-aware slide: the lateral pull converges every ride onto its line —
  // two abreast rides would grind onto one body. Halve the slide down to the
  // largest peer-free lateral (same budget as the step gates), refusing it
  // when even a hair stays overlapped: the file keeps its lateral offset
  // instead of merging. Null grid (legacy scan): slides are rare per tick
  // and the peer set is small; the math matches the gated drives exactly.
  if (peers) {
    const msx = Math.sin(mob.yaw), msz = Math.cos(mob.yaw);
    let guard = 0;
    while (guard++ < 10) {
      const tx = mob.pos.x + -az * c, tz = mob.pos.z + ax * c;
      if (peerPenAt(mob, tx, tz, msx, msz, mob.pos.y, peers, null) <= CROSS_BUDGET) break;
      c /= 2;
      if (Math.abs(c) <= 1e-4) return 0;
    }
  }
  const tx = mob.pos.x + -az * c, tz = mob.pos.z + ax * c;
  if (!axisOk(tx, tz)) return 0;
  mob.pos.x = tx; mob.pos.z = tz;
  return Math.abs(c);
}

// Active guidance: an entry commit riding its own hole-ward line (guide
// key stamped). Pending entries (commit waiting under a plain ride for the
// nose to meet the wall) keep the legacy ride behavior — blue held until
// the guided erect — so only active guides take the never-U-turn paths.
function guidedActive(mob) {
  return mob.roam?.entry === true &&
    (mob.followLine?.guideKey ?? null) === mob.roam.passageKey;
}

// Fresh out of a 1-wide mouth only (keyed `|1:` leave window): the exit
// holder ranks above violet commits (they abort for an exiter coming out)
// and above blue rides and free roam (both yield). 2-wide freshness stays
// a JAUNE holder (see mobRank) with untouched 2-wide steering. Exported
// for headless units.
export function exitFresh1(mob) {
  return (mob.entryCoolT ?? 0) > ENTRY_COOL_T - LEAVE_FRESH_T &&
    (mob.entryCoolKey ?? "").includes("|1:");
}

// Avoidance rank behind the group planner (forecast.js): one total order,
// read live every planning tick (never one tick stale). RED rails are
// moving-wall obstacles only (-1, never planned); JAUNE 2-wide exits and
// threads hold (4, legacy cascade, 2-wide steering untouched); SORTIE-1
// 1-wide exits hold (3, legacy-paced line, never steer/detach/abort);
// BLUE covers every laned touch ride (1) — including entry-carrying guided
// rides, which detach like pure blues instead of holding for their hole;
// VIOLET is the unlaned entry commit only (2, yields to exits and rails);
// FREE roam yields to everyone (0, legacy cascade, never flags). Pure
// reads, no rand stream.
export function mobRank(mob) {
  const laned = mob.lane != null;
  const blue = mob.followLine?.touch === true && laned;
  const red = laned && mob.followLine?.touch !== true;
  if (red) return -1;
  if (mob.passage?.kind === 2 || mob.inPassage === true ||
    mob.roam?.smooth === true || freshFromMouth(mob)) return 4;
  if (exitFresh1(mob)) return 3;
  if (blue || mob.wallFollow === true) return 1;
  if (mob.roam?.entry === true) return 2;
  return 0;
}

// Fresh from a 2-wide: threading one now (held passage) or out of one
// within the fresh window (same-mouth cooldown just armed) — the commit
// through still stands, so a wall loss with open front holds straight
// instead of U-turning back into the mouth. Exported for headless units.
export function freshFromMouth(mob) {
  if (mob.passage?.kind === 2) return true;
  return (mob.entryCoolT ?? 0) > ENTRY_COOL_T - LEAVE_FRESH_T &&
    (mob.entryCoolKey ?? "").includes("|2:");
}

// True when walking toward E would run back into the cooled mouth
// (per-mouth cooldown still armed). Inside the mouth geometry itself this
// reads false — the way out always crosses the mouth center, so vetoing
// from inside would trap the exit walk. Covers the stale window past
// LEAVE_FRESH_T, where the fresh hold lapses but re-draws stay gated: a
// servo flip would stroll straight back in with no draw.
function exitIsCooled(mob, axis) {
  if ((mob.entryCoolT ?? 0) <= 0 || mob.entryCoolKey == null) return false;
  if (insideCooledMouth(makeCellFree(mob), makeCellSolid(mob), mob.dim ?? "over",
    Math.floor(mob.pos.x), Math.floor(mob.pos.z), mob.entryCoolKey)) return false;
  const [ex, ez] = dirVec(axis);
  return mobHeadsToCooledMouth(mob, mob.pos.x + ex * 1.5, mob.pos.z + ez * 1.5);
}

// True when flipping onto the opposite of the travel axis would run back
// into the cooled mouth.
function backIsCooled(mob, prevAxis) {
  return exitIsCooled(mob, oppositeYaw(prevAxis));
}

// Mouth key for a rail release: the mouth underfoot or one cell behind along
// travel (the tunnel just left reads from the cell behind once the mob steps
// out). Probes both travel directions and both widths; null in the open, so
// widenings keep the old timer-only exit. Pure reads, no draws.
export function releaseMouthKey(mob, travelAxis) {
  const dim = mob.dim ?? "over";
  const cellFree = makeCellFree(mob), cellSolid = makeCellSolid(mob);
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const [fx, fz] = dirVec(travelAxis);
  for (const [bx, bz] of [[cx, cz], [cx - fx, cz - fz]]) {
    for (const ax of [travelAxis, oppositeYaw(travelAxis)]) {
      for (const kind of [2, 1]) {
        const k = mouthKey(dim, bx, bz, ax, kind, cellFree, cellSolid);
        if (k != null) return k;
      }
    }
  }
  return null;
}

// Invisible complementary wall: while a virtual follow line rides a real
// lane AND the body stands strictly inside its own corridor (between the
// virtual face and the real face), the far side of the lane reads solid —
// probes see a true 1-wide corridor (one real wall, one virtual), so the
// unchanged servo walks it parallel and glued: yaw locked on the cardinal
// lane axis (no diagonal), lateral slide toward the adjacent cell centre
// (0.5 from the face). Outside its corridor (latch transient from
// mid-space: the virtual face lands on or past the body), the wall stays
// down and real probes rule until the slide pulls the body in — a blind
// mob could neither engage nor drive.
function virtualWall(mob) {
  const vw = mob.followLine;
  if (!vw?.virtual || !mob.lane) return null;
  const dd = Math.abs(normYaw(vw.axis - mob.lane.axis));
  if (dd > 1e-6 && dd < Math.PI - 1e-6) return null;
  const [ax] = dirVec(vw.axis);
  const latIsX = ax === 0;
  const V = vw.line + vw.side * (VIRTUAL_W / 2);
  const face = vw.line - vw.side * (VIRTUAL_W / 2);
  const lat = latIsX ? mob.pos.x : mob.pos.z;
  // Boundary-inclusive on the virtual side (<= with an epsilon): the latch
  // tick erects the corridor while the body still stands on the virtual
  // face, so the very first sense along the lane already reads 1-wide.
  // Own-position probes still read free (the wrap below only blocks
  // strictly past the face), so the lane never blinds its own drive.
  if (!(vw.side * (lat - V) < 1e-9 && vw.side * (lat - face) > 1e-9)) return null;
  return { latIsX, V, side: vw.side };
}

// Wrap a body-fit point probe with the virtual wall: a body centre strictly
// past the virtual face reads blocked, exactly like a real wall face.
// Strictly-past only (no body margin): the wrap applies solely while the
// mob stands inside its own corridor, so the probes at its own lateral
// always read free — a margin would blind the forward probe from inside
// the lane. Lane discipline comes from the pull toward the middle
// (0.5 from the face, past body reach), never from the probes.
function wrapStepOk(mob, stepOk) {
  const v = virtualWall(mob);
  if (!v) return stepOk;
  return (nx, nz) => (v.side * ((v.latIsX ? nx : nz) - v.V) > 1e-9 ? false : stepOk(nx, nz));
}

// Servo tick body. Follow-line state (mob.followLine = {axis, line,
// side, rel, virtual} | null) synthesizes the complementary wall into the
// probes below; motion itself is the unchanged 1-wide servo (engage,
// cruise, junction blend, dead-end seek). Sense, engage, and the lane
// drives run in order; each drive owns its motion.
export function servoTick(mob, dt, supported, floating, rand = Math.random, pickTarget = null, peerGate = null, peers = null, turnGate = null) {
  if (!supported || floating) { mob.lane = null; return false; }
  // R2 upkeep first: the latched line below biases this very tick's pull.
  upkeepFollowLine(mob, dt);
  // A turn-away leave flies lane-less open-loop for its span: re-engaging
  // a rail mid-maneuver would kill the away commit the very next tick and
  // ram the peer again at full stride the tick after.
  if (mob._turnAway > 0 && !mob.lane) return false;
  // Pending guided slide: an entry commit riding its touch line erects the
  // hole-ward touch as soon as the nose meets the wall — no drop to a free
  // commit, no pivot toward the mouth.
  if (mob.lane && mob.roam?.entry) tryGuidedErect(mob, dt, supported, floating, rand);
  let sense = senseLane(mob);
  const pre = tryPreLane(mob, dt, supported, floating, sense, rand);
  if (pre === "touch") {
    // Contact latch erected the lane: sense again along it, virtual wall up.
    sense = senseLane(mob);
    // A peer already rides this exact line close by (abreast latch onto one
    // body): declining the latch routes around instead of grinding onto the
    // peer — the peer-aware slide below would only refuse the convergence,
    // leaving two rides erected on one line. Entry commits never decline
    // (the claim system serializes mouths; see entry.js).
    if (peers && mob.roam?.entry !== true && lineClaimedByPeer(mob, peers)) {
      dropFollowLine(mob);
      dropLane(mob);
      mob.followCool = FOLLOW_COOL;
      return false;
    }
  } else if (pre !== undefined) return pre;
  // Junction draws come from the mob's own stream (seeded once below), not
  // the ambient rand: roam refactors can never reshuffle junction outcomes.
  const jrng = mob.jrng ?? (mob.jrng = spawnRng(rand));
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const prevAxis = mob.lane ? mob.lane.axis : null;
  const res = updateLane(mob.lane, cx, cz, mob.yaw, sense.opens, sense.walled, jrng);
  if (!res.lane) { dropLane(mob); return false; }
  mob.lane = res.lane;
  // Engagement needs true flanks: both adjacent lateral cells blocked.
  // Fat body probes clipping opposite corners (door-jamb corners, terrain
  // slopes, junction mouths) read walled without any flanking wall — an
  // engage there erects a false rail that drops a tick later into an
  // exit-tunnel parade. True 1-wide cells (solid or drop both sides) and
  // dead-end mouths pass unchanged; lone walls and open corners never did.
  if (res.event === "engage") {
    const [gax, gaz] = dirVec(res.lane.axis);
    if (sense.cellFree(cx + gaz, cz - gax) || sense.cellFree(cx - gaz, cz + gax)) {
      dropLane(mob);
      return false;
    }
  }
  // A committed (violet) mob never engages backward: a nose wedged on a
  // hole edge can read forward-blocked with walled flanks, and the raw
  // engage would point the lane back out — a demi-tour while violet. The
  // direct walk (stall → hole-ward ride) owns the mouth instead.
  if (res.event === "engage" && mob.roam?.entry && mob.target) {
    const [gax, gaz] = dirVec(res.lane.axis);
    if (gax * (mob.target.x - mob.pos.x) + gaz * (mob.target.z - mob.pos.z) <= 0) {
      dropLane(mob);
      return false;
    }
  }
  // A rail engage running back into the cooled mouth is refused the same
  // way: the mob just threaded it, and the cooldown gates re-draws but no
  // raw engage — without this an obstacle U-turn re-rails straight back in
  // with no draw at all.
  if (res.event === "engage" && exitIsCooled(mob, res.lane.axis)) {
    dropLane(mob);
    return false;
  }
  const touchRide = mob.followLine?.virtual === true && mob.followLine.touch === true && prevAxis != null;
  // Pinned rigs (tests) ride forever: always latch, never expire. The game
  // budget below only runs unpinned.
  const rideExits = touchRide && mob.pinWallRide !== true;
  // Ride budget expiry (game only; pinned rigs ride forever): the
  // roam-clock span ran out — leave 45° away from the wall, or keep
  // riding with a short extension when boxed in (never quit into a wall).
  // A guided (violet) ride never quits away from its hole: release to the
  // direct entry walk (re-armed) and re-approach instead.
  if (rideExits && (mob.followLine.t ?? 0) >= (mob.followLine.wallSpan ?? Infinity)) {
    if (guidedActive(mob)) {
      dropFollowLine(mob);
      dropLane(mob);
      mob.followCool = FOLLOW_COOL;
      mob.roam.stallT = 0;
      mob.roam.latchTried = false;
      return false;
    }
    let h = wallQuitHeading(mob, supported, floating);
    if (h != null && wallQuitCommit(mob, h, rand, pickTarget)) return false;
    mob.followLine.t = 0; mob.followLine.wallSpan = 2;
  }
  // Single tunnel rule behind every non-touch lane (see laneTunneled):
  // a draw into a room, widening, or field releases to roam instead of
  // locking a red lane into the open. Dead-end seeks and touch rides keep
  // their own hold rules below.
  const tunneledFor = (event, axis) =>
    laneTunneled(event, axis, sense.walled, mob.pos.x, mob.pos.z, sense.cellFree);
  if (!touchRide && (res.event === "engage" || res.event === "cruise" || res.event === "junction" || res.event === "lock-turn")) {
    // Strict 1-wide hold (see above): a lane cruising where neither flank
    // reads blocked (single-wall walks, widenings, room crossings) drops
    // to roam instead of persisting.
    if (!tunneledFor(res.event, res.lane.axis)) {
      dropLane(mob);
      mob.followLine = null;
      // Hold the next latch off so the exit walks clear of the wall
      // ends instead of flank-grazing straight back (mouth oscillation).
      mob.followCool = FOLLOW_COOL;
      // Rail released at a tunnel mouth: the unified mouth exit (wall-follow
      // arms vs free roam, 1-wide and 2-wide alike) — never back inside —
      // unless an entry commit owns the mob (its goal-directed walk survives
      // over the exit draw). The exit runs along the incoming travel (a
      // junction arm points back into the mouth complex — straightening it
      // exits the tunnel instead of shuttling its arms); engages with no
      // incoming lane keep the arm.
      if (mob.roam?.entry) {
        // The stall may re-accrue from the new spot (the hole can be
        // latchable from there), so re-arm the directed touch.
        mob.roam.stallT = 0;
        mob.roam.latchTried = false;
        return false;
      }
      const relAxis = prevAxis ?? res.lane.axis;
      // Refresh the existing gate only: a release never introduces a new
      // mouth key (a mob spawned or railed inside a tunnel never threaded
      // its exit — keying it would veto the way out itself). Threaded
      // mouths already carry their key from the passage close above.
      const relKey = releaseMouthKey(mob, relAxis);
      const keepKey = relKey != null &&
        (relKey === mob.entryCoolKey || relKey === mob.passage?.key) ? relKey : null;
      return exitMouth(mob, relAxis, dt, supported, floating, rand, pickTarget, sense,
        keepKey != null ? { key: keepKey } : undefined);
    }
  }
  if (res.event === "uturn") {
    // A committed mob never flips 180°: convert to a hole-ward guided
    // ride (violet survives on the guide key), else release to the direct
    // walk and keep pushing — the stall path converts it next, the
    // backstop exits forward. Only a boxed mob with no latchable wall
    // falls through to the seek below.
    if (guidedActive(mob)) {
      if (entryStallLatch(mob, dt, supported, floating, rand)) {
        res.lane = mob.lane;
        res.event = "lock-turn";
      } else {
        dropFollowLine(mob);
        dropLane(mob);
        mob.followCool = FOLLOW_COOL;
        mob.roam.stallT = 0;
        mob.roam.latchTried = false;
        return false;
      }
    } else {
    // Inner corner: the nose met the perpendicular arm of
    // the same wall — the phantom-masked side mouth reads shut, so the
    // classifier reports a dead end. Turn into the arm (same wall, same
    // relative side, blue stays on) instead of flipping; true dead ends
    // and pocket backs have no walkable arm and keep the seek below.
    const inner = touchRide ? innerTurn(mob, prevAxis) : null;
    if (inner == null) return seekDeadEnd(mob, dt, supported, floating, peers);
    mob.lane = { axis: inner.axis, entry: oppositeYaw(inner.axis), lockX: cx, lockZ: cz };
    mob.followLine = inner.followLine;
    mob.stuckT = 0;
    mob.turnHold = TURN_HOLD_TICKS;
    res.event = "junction";
    res.lane = mob.lane;
    }
  } else if (mob.turnHold > 0 && mob.followLine?.virtual === true && mob.followLine.touch === true) {
    // Fresh touch-ride turn: hold the new lane while the blend arc
    // completes — the router would otherwise re-decide mid-arc and flip
    // back onto the old wall. U-turns still decide fresh above.
    mob.turnHold--;
    mob.lane = { axis: mob.followLine.axis, entry: oppositeYaw(mob.followLine.axis), lockX: cx, lockZ: cz };
    res.event = "lock-turn";
    res.lane = mob.lane;
  } else if (touchRide && (res.event === "junction" || res.event === "cruise" || res.event === "lock-turn")) {
    // Wall ride through a junction, along a straight, or holding a locked
    // cell: keep the same physical wall instead of the random draw (a
    // locked touch lane re-measures too — holding it blind would grind a
    // blocked nose until the stall guard trips; the measure below decides
    // every tick and is deterministic, so steady geometry holds steady).
    // Every exit is measured on the real wall — the phantom-masked classifier
    // votes never gate the decision, so tips and inner arms resolve the
    // tick the geometry changes under the mob. Wall truly ended: round the
    // corner onto a carried line (same hold as inner corners) and keep
    // following — dropping to a blind roam commit here arcs away from the
    // face and wedges the nose on the tip instead of hugging it. Blocked
    // nose means a corridor situation (jog, notch), so a tunneled lane
    // keeps driving; anything else releases to roam now.
    const keep = followExit(mob, prevAxis);
  if (!keep) {
    let corner = sense.fwdOpen ? cornerTurn(mob, prevAxis) : null;
    // Same wall only: corner rounding onto a disconnected wall (past
    // the tip, across open field) is a switch — refuse it and let the
    // in-place U-turn below keep the ride on its own wall instead.
    if (corner != null && !connectedTake(mob, prevAxis, corner.cell)) corner = null;
    // Fresh out of a 2-wide: refuse an unwalkable take (same rule as the
    // early tip take and the forced exits below — the wall measurement
    // alone can admit a take the body cannot round, like a door-jamb
    // corner the arc clips, wedging the ride instead of turning it). The
    // take falls through to the fresh hold-straight below, which walks
    // clear of the jamb and re-measures the turn with clearance instead
    // of grinding in place. Walkable takes still turn at once; outside
    // the fresh window nothing changes.
    if (corner != null && freshFromMouth(mob) && !takeWalkable(mob, corner.axis)) corner = null;
    if (corner != null) {
      adoptCornerTurn(mob, corner, cx, cz, res);
    } else if (sense.fwdOpen) {
        // A guided (violet) ride that lost its wall never U-turns in
        // place. Rides can never turn into a hole (no wall to hug past the
        // jamb), so a hole within stride reach on a walkable segment docks:
        // drop the ride and finish on the direct walk. Otherwise the hole
        // is still a walk off the line — hold straight along it (the stale
        // face only biases the pull, the virtual wall only applies inside
        // the corridor) until the segment walks or the wall resumes. The
        // direct walk stays out of it until then: releasing early would
        // wedge the nose on the jamb the ride is still aligning past.
        if (guidedActive(mob)) {
          if (guidedDock(mob)) return false;
          mob.lane = { axis: prevAxis, entry: oppositeYaw(prevAxis), lockX: cx, lockZ: cz };
          mob.stuckT = 0;
          res.event = "lock-turn";
          res.lane = mob.lane;
        } else if (freshFromMouth(mob) || backIsCooled(mob, prevAxis)) {
          // Just threaded a 2-wide (committed through it), or the way back
          // runs into the cooled mouth: never U-turn back into it — hold
          // straight along the exit line until the next wall takes over or
          // the budget owns the release (the stale face only biases the
          // pull, like the guided hold above). The per-mouth cooldown still
          // gates re-draws after the fresh window lapses.
          mob.lane = { axis: prevAxis, entry: oppositeYaw(prevAxis), lockX: cx, lockZ: cz };
          mob.stuckT = 0;
          res.event = "lock-turn";
          res.lane = mob.lane;
        } else {
          // No solution with the way ahead open: U-turn in place and keep
          // the line (never drop) — the way back re-measures every tick, so
          // a face back in range turns the ride around again instead of
          // pacing or leaving.
          // The cell lock forces at least one cell of travel before the next
          // decision (no same-tick flip-flop).
          mob.lane = { axis: oppositeYaw(prevAxis), entry: prevAxis, lockX: cx, lockZ: cz };
          mob.stuckT = 0;
          res.event = "uturn";
          res.lane = mob.lane;
        }
      } else {
        dropFollowLine(mob);
        // Handing the corridor back to the rail: the kept lane must itself
        // satisfy the tunnel rule this same tick — otherwise a red lane
        // cruises one tick in the wide before the next tick's hold drops
        // it. Blocked nose means a corridor situation (jog, notch), so a
        // tunneled lane keeps driving; anything else releases to roam now.
        if (!tunneledFor(res.event, mob.lane.axis)) {
          dropLane(mob);
          mob.followCool = FOLLOW_COOL;
          return false;
        }
      }
    } else {
      // Wall ends within lookahead while still alongside: round the tip
      // now (body straddling it) instead of parading to the walkability
      // edge — the straight-keep would otherwise hold until the wall
      // physically ends beside the mob. tipOuterCorner only admits the
      // exact take the late path would adopt (same line, same continuity
      // gates) plus a walkability probe; anything else keeps the legacy
      // straight.
      let corner = null;
      if (keep.axis === prevAxis && wallEndsAhead(mob, prevAxis) && sense.fwdOpen) {
        const early = tipOuterCorner(mob, prevAxis);
        if (early != null && takeWalkable(mob, early.axis)) corner = early;
      }
      if (corner != null) {
        adoptCornerTurn(mob, corner, cx, cz, res);
      } else {
        mob.lane = { axis: keep.axis, entry: oppositeYaw(keep.axis), lockX: cx, lockZ: cz };
        mob.followLine = keep.followLine;
      }
    }
  }
  blendTurn(mob, dt, res);
  return cruiseLane(mob, dt, supported, floating, res, rand, peerGate, peers, turnGate);
}

// Lane sensing: body-only direction probes (footNose 0, no nose disc — the
// classifier asks which cells fit the body, so 1-cell arms ending in a wall
// still read open), the width-aware exit set, and the forward opening.
// The virtual wall (when a line rides along) synthesizes the far side, so
// an open wall reads exactly like a 1-wide corridor.
// descendOk gates pit mouths: a legal drop into a local minimum reads as a
// wall (the drives below refuse it too), so the lane U-turns at the lip
// instead of cruising in. The drives keep the real nose reach.
function senseLane(mob) {
  const axisProbe = mob.lane ? mob.lane.axis : snapCardinal(mob.yaw);
  const fitBody = (yaw) => {
    const base = makeStepOk(mob, true, false, 0, yaw, 0);
    return wrapStepOk(mob, (nx, nz) => base(nx, nz) && descendOk(mob, nx, nz));
  };
  const pointFree = (nx, nz, dirYaw) => fitBody(dirYaw)(nx, nz);
  const cellFreeReal = makeCellFree(mob);
  const v = virtualWall(mob);
  const cellFree = v
    ? (bx, bz) => (v.side * ((v.latIsX ? bx : bz) + 0.5 - v.V) > 0 ? false : cellFreeReal(bx, bz))
    : cellFreeReal;
  const opens = classifyExits(mob.pos.x, mob.pos.z, axisProbe, pointFree, cellFree);
  const [pax, paz] = dirVec(axisProbe);
  const fwdOpen = pointFree(mob.pos.x + pax * PROBE_DIST, mob.pos.z + paz * PROBE_DIST, axisProbe);
  // Blocked cardinals through the wrapped probes (virtual wall counts):
  // the tunnel gate behind lane engagement, and the strict hold below.
  const walled = [];
  for (const d of CARDINALS) {
    const [dx, dz] = dirVec(d);
    if (!pointFree(mob.pos.x + dx * PROBE_DIST, mob.pos.z + dz * PROBE_DIST, d)) walled.push(d);
  }
  return { axisProbe, cellFree, opens, fwdOpen, walled };
}

// Pre-lane flow: a 50/50 touch latch on a plain wall when the way ahead is
// blocked (contact may stick or keep roaming — straight-on draws lots 50/50,
// oblique keeps its direction; refusals hold the next latch off), else a
// 50/50 flank-touch latch when a wall rubs the side while the way ahead
// runs free (parallel graze, diagonal contact: contact is contact, whatever
// the angle). Entry commits walk undisturbed (no latch steals them) until
// they stall: a wedged entry touches the blocking wall through the directed
// latch in roamStep instead, reusing this same machinery hole-ward. Smooth
// crossing commits likewise walk undisturbed (locked straight lines never
// convert, whatever the nose meets).
// Returns true/false when it handles the tick, "touch" when a contact latch
// erected the lane (sense again along it), undefined when a lane update
// is due.
function tryPreLane(mob, dt, supported, floating, sense, rand = Math.random) {
  if (mob.roam?.entry || mob.roam?.smooth) return undefined;
  if (!mob.lane && (mob.followCool ?? 0) <= 0) {
    if (!sense.fwdOpen) {
      const th = mob.target ? Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z) : null;
      const axis = latchTouchWall(mob, dt, sense.axisProbe, th, rand);
      if (axis != null) {
        mob.lane = { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1 };
        mob.stuckT = 0;
        return "touch";
      }
    } else {
      const axis = latchFlankTouch(mob, dt, sense.axisProbe, rand);
      if (axis != null) {
        mob.lane = { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1 };
        mob.stuckT = 0;
        return "touch";
      }
    }
  }
  return undefined;
}

// Inner-corner turn on a touch ride: the nose is stopped by the
// perpendicular arm of the same wall (a phantom-masked side mouth fakes a
// dead end). Probe both perpendiculars for a continuing face on the same
// relative side — inner corners keep the wall on the same side, so the
// away-from-wall perpendicular comes first — from the current cell and one
// cell ahead along the arm (a 1-bloc jog only shows past the step), and
// turn into the first walkable arm, carrying the line so the ride (and the
// blue) continues uninterrupted. Returns null for true dead ends and
// pocket backs (faces without a walkable arm), which keep the dead-end
// seek.
function innerTurn(mob, prevAxis) {
  const rel = mob.followLine.rel ?? 1;
  const order = [normYaw(prevAxis + rel * Math.PI / 2), normYaw(prevAxis - rel * Math.PI / 2)];
  for (const Q of order) {
    const check = normYaw(Q - rel * Math.PI / 2);
    const [qx, qz] = dirVec(Q);
    // A 1-bloc jog blinds the scan from the current cell (the stepped arm
    // only shows past the step): retry one cell ahead along the arm, like
    // the exit takes below.
    const m = measureWallTake(mob, Q, check)
      ?? measureWallTake(mob, Q, check, { x: mob.pos.x + qx * 1.0, z: mob.pos.z + qz * 1.0 });
    if (!m) continue;
    // Same wall only: the arm must start at the old wall's tip — a nose
    // blocked by a stranger wall keeps the seek (U-turn) instead.
    if (!connectedTake(mob, prevAxis, m.cell)) continue;
    const nx = mob.pos.x + qx * 1.0, nz = mob.pos.z + qz * 1.0;
    if (!makeStepOk(mob, true, false, 0, Q, 0)(nx, nz) || !descendOk(mob, nx, nz)) continue;
    // Hole-ward lines round gently like exit rides (see followExit below).
    // Parallel rides keep their offset across the rounding, never sliding.
    const gentle = mob.followLine.gentle === true || mob.followLine.guideKey != null;
    const noSlide = mob.followLine.noSlide === true;
    return {
      axis: Q,
      followLine: {
        axis: Q, line: m.face - m.dirSign * (VIRTUAL_W / 2), side: -m.dirSign,
        rel, virtual: true, touch: true,
        fresh: gentle ? GENTLE_FRESH_TICKS : TURN_HOLD_TICKS, face: m.face,
        t: mob.followLine.t ?? 0, wallSpan: mob.followLine.wallSpan,
        gentle, noSlide,
      },
    };
  }
  return null;
}

// Corner-rounding adoption shared by the late tip release and the early
// tip take: carry the line onto the perpendicular and hold the new lane
// while the blend arc completes (the router would otherwise re-decide
// mid-arc and flip back onto the old wall).
function adoptCornerTurn(mob, corner, cx, cz, res) {
  const { axis, face, dirSign, sideDir } = corner;
  const rel = yawDiff(sideDir, normYaw(axis - Math.PI / 2)) < 1e-9 ? 1 : -1;
  mob.lane = { axis, entry: oppositeYaw(axis), lockX: cx, lockZ: cz };
  // Gentle rides stay gentle across the rounding (a full fresh here
  // would reintroduce mid-ride the yank the latch softened), and so do
  // hole-ward (guide-carrying) lines mid-commit.
  const cornerGentle = mob.followLine.gentle === true || mob.followLine.guideKey != null;
  mob.followLine = {
    axis, line: face - dirSign * (VIRTUAL_W / 2), side: -dirSign,
    rel, virtual: true, touch: true,
    fresh: cornerGentle ? GENTLE_FRESH_TICKS : TURN_HOLD_TICKS, face,
    ...carriedRide(mob),
    gentle: cornerGentle,
  };
  mob.stuckT = 0;
  mob.turnHold = TURN_HOLD_TICKS;
  res.event = "junction";
  res.lane = mob.lane;
}

// Take walkability behind every touch-ride exit (also the early tip take
// below): the body fits a step ahead with no pit drop — the wall
// measurement alone can keep a straight the nose is already grinding into,
// wedging the ride instead of turning.
function takeWalkable(mob, E) {
  const [ex, ez] = dirVec(E);
  const nx = mob.pos.x + ex * PROBE_DIST, nz = mob.pos.z + ez * PROBE_DIST;
  return makeStepOk(mob, true, false, 0, E, 0)(nx, nz) && descendOk(mob, nx, nz);
}

// The followed wall ends within lookahead: the straight reads nothing from
// the current cell nor one cell ahead. A wall resuming two cells ahead is
// a door or gap to parade, not a true end — but only when it is a real
// wall: a void or pit lip reads as a wall for the lateral scan while
// nothing stands there to hug past the tip.
function wallEndsAhead(mob, axis) {
  const rel = mob.followLine?.rel ?? 1;
  const check = normYaw(axis - rel * Math.PI / 2);
  const [ax, az] = dirVec(axis);
  const m0 = measureWallTake(mob, axis, check,
    { x: mob.pos.x, z: mob.pos.z });
  if (m0 != null) return false;
  const m1 = measureWallTake(mob, axis, check,
    { x: mob.pos.x + ax * 1.0, z: mob.pos.z + az * 1.0 });
  if (m1 != null) return false;
  const m2 = measureWallTake(mob, axis, check,
    { x: mob.pos.x + ax * 2.0, z: mob.pos.z + az * 2.0 });
  if (m2 == null) return true;
  const solidAt = makeCellSolid(mob);
  return !solidAt(m2.cell.x, m2.cell.z);
}

// Forced exit choice on a touch ride: keep the same physical wall.
// Every open direction but the entry way is measured on the real wall
// (never the phantom-masked classifier votes) — straights first for
// smooth parades, then the away-from-wall perpendicular (inner arms keep
// the wall on the same side), then the toward-wall one. Each exit is
// measured from the current cell and from one and two cells ahead along
// it (an L-arm wall only shows past the corner, a 1-bloc jog past the
// step). A kept exit must also be
// walkable (body fits a step ahead, no pit drop): the wall measurement
// alone can keep a straight the nose is already grinding into, wedging
// the ride instead of turning. Same-wall continuity gates every take:
// straights keep the same face plane (holes share it; a parallel face
// further out is another wall), perpendiculars must start at the old
// wall's tip (see connectedTake). A true wall end returns null
// (release, corner rounding, or cruise out).
function followExit(mob, prevAxis) {
  const rel = mob.followLine.rel ?? 1;
  const entry = oppositeYaw(prevAxis);
  const options = [prevAxis,
    normYaw(prevAxis + rel * Math.PI / 2), normYaw(prevAxis - rel * Math.PI / 2)]
    .filter((d) => yawDiff(d, entry) > 1e-6);
  const measure = (E, origin) => {
    const check = normYaw(E - rel * Math.PI / 2);
    const m = measureWallTake(mob, E, check, origin);
    return m ? { E, check, m } : null;
  };
  const ahead = (E) => {
    const [ex, ez] = dirVec(E);
    return { x: mob.pos.x + ex * 1.0, z: mob.pos.z + ez * 1.0 };
  };
  // Two cells ahead: a 2-wide gap blinds the lateral scan (no wall within
  // reach from the current cell or one ahead), but the wall resumes past
  // it — exits look through so doors parade like setbacks instead of
  // U-turning. sameWallFace / connectedTake below still verify the
  // plane and the tip, so true ends and rooms keep releasing.
  const ahead2 = (E) => {
    const [ex, ez] = dirVec(E);
    return { x: mob.pos.x + ex * 2.0, z: mob.pos.z + ez * 2.0 };
  };
  const straight = [], turns = [];
  for (const E of options) (E === prevAxis ? straight : turns).push(E);
  // A guided stall slide prefers the hole-ward take among the legal ones
  // (same-wall/connected gates still apply — it never jumps walls, it
  // just picks the side the hole is on). Plain rides keep straight-first.
  const gl0 = mob.followLine;
  const ggx = gl0?.guideTx, ggz = gl0?.guideTz;
  const guidedTake = gl0?.guideKey != null && ggx != null && ggz != null;
  const takes = [];
  for (const E of [...straight, ...turns]) {
    // Every exit looks from the current cell, one cell ahead, and two
    // cells ahead along it (a 1-cell jog or gap blinds the nearer scans,
    // but the stepped wall resumes on a neighbouring plane past it —
    // chained 1-bloc zigzags turn instead of U-turning). sameWallFace /
    // connectedTake below still verify the plane and the tip, so true ends
    // and rooms keep releasing.
    const win = measure(E, null) ?? measure(E, ahead(E)) ?? measure(E, ahead2(E));
    if (!win || !takeWalkable(mob, E)) continue;
    // Cooled mouth: never TURN back into it (the entry-draw gate alone would
    // let a servo turn stroll straight back in). Straight continuations stay
    // exempt: the arrival's own exit threads through on the same line, and a
    // return always requires a turn, a flip, or a fresh commit — all gated
    // elsewhere.
    if (E !== prevAxis && exitIsCooled(mob, E)) continue;
    if (E === prevAxis) {
      if (!sameWallFace(mob, win.m)) continue;
    } else if (!connectedTake(mob, prevAxis, win.m.cell)) continue;
    takes.push({ E, win });
  }
  if (guidedTake && takes.length > 1) {
    const gx = ggx - mob.pos.x, gz = ggz - mob.pos.z;
    const gh = Math.hypot(gx, gz) || 1;
    takes.sort((a, b) => {
      const [aax, aaz] = dirVec(a.E), [bbx, bbz] = dirVec(b.E);
      return ((bbx * gx + bbz * gz) - (aax * gx + aaz * gz)) / gh;
    });
  }
  for (const { E, win } of takes) {
    // Gentle exit rides stay gentle across takes (a full fresh window here
    // would reintroduce the yank mid-ride the exit softened at the latch).
    // Hole-ward (guide-carrying) lines converge gently too: a take mid-commit
    // must never yank the mob sideways off its hole-ward slide.
    const gentle = mob.followLine.gentle === true || mob.followLine.guideKey != null;
    return {
      axis: E,
      followLine: {
        axis: E,
        line: win.m.face - win.m.dirSign * (VIRTUAL_W / 2),
        side: -win.m.dirSign,
        rel, virtual: true,
        touch: mob.followLine.touch === true,
        fresh: gentle ? GENTLE_FRESH_TICKS : TURN_HOLD_TICKS,
        face: win.m.face,
        ...carriedRide(mob),
        gentle,
      },
    };
  }
  return null;
}

// Fields a rebuilt touch line carries over: ride clock, budgets, claims,
// guides, and the parallel flag. Freshness and geometry are re-measured per
// take.
function carriedRide(mob) {
  const vw = mob.followLine ?? {};
  return {
    t: vw.t ?? 0, wallSpan: vw.wallSpan,
    claimKey: vw.claimKey,
    guideKey: vw.guideKey, guideTx: vw.guideTx, guideTz: vw.guideTz,
    noSlide: vw.noSlide,
  };
}

// Release the virtual wall, keep the real lane: the ride is over (wall
// truly ended), the corridor — if any — continues on real probes.
function dropFollowLine(mob) {
  mob.followLine = null;
  mob.turnHold = 0;
}

// Dead-end seek: the classifier reads a wall 1.3 m out, but up to 0.6 m
// of corridor may remain. Walk nose-to-the-end first, flip only when the
// drive itself refuses — the mob touches the back wall, then U-turns.
function seekDeadEnd(mob, dt, supported, floating, peers = null) {
  const forward = mob.lane.entry; // pre-flip axis: updateLane already swapped
  // Recentre first (no corridor gate: a corner wedge is never a true
  // 1-wide cell, and that is exactly when the seek needs centring —
  // the axisOk probe below refuses any slide into a wall, and a stale
  // flipped follow line still pins the lateral via modulo-π).
  const recentered = centerPull(mob, dt, supported, floating, true, peers);
  // Dead-end seek refuses pit descents (see descendOk): the pit lip is
  // the end of the line — touch it, turn, leave. Peer-gated like every
  // other drive: the seek walks nose-to-the-end, so without the gate it
  // walks nose-through-the-peer standing there.
  const makeSeek = () => {
    const sdriveBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
    const wrapped = wrapStepOk(mob, sdriveBase);
    return (nx, nz) => wrapped(nx, nz) && descendOk(mob, nx, nz) &&
      (!peers || !mobBlockedAt(mob, nx, nz, mob.pos.y, peers, 0, null, CROSS_BUDGET));
  };
  const seek = driveToward(mob, dt, forward, makeSeek, moveVector, { rate: SERVO_TURN });
  if (seek.dist > 0) {
    // Still advancing: keep seeking with the forward axis restored.
    mob.lane = { axis: forward, entry: oppositeYaw(forward), lockX: -1, lockZ: -1 };
    mob.stuckT = 0;
    return true;
  }
  // Wedged seek (a peer hard-blocks the nose): release like a stalled
  // cruise instead of grinding in place — the roam routes around the
  // blocker where the rail never could. Strictly additive: without a peer
  // ahead servoStall passes through untouched (legacy voxel dynamics).
  if (recentered === 0 && seek.err < SERVO_SPIN && peers && mobBlocksAhead(mob, peers, null)) {
    mob.servoStall = (mob.servoStall ?? 0) + dt;
  }
  if (mob.servoStall > 0.75) return releaseStalledLane(mob);
  // Nose contact: keep the flipped lane, rotate in place below (gated: the
  // flip must not sweep the nose discs through an adjacent peer).
  mob.yawTarget = mob.lane.axis;
  driveToward(mob, dt, mob.lane.axis, () => () => false, moveVector, {
    rate: SERVO_TURN, turnOk: peers ? makeTurnGate(mob, peers, null) : null,
  });
  mob.stuckT = 0;
  return true;
}

// Junction turning: timed blend swinging from the entry heading toward the
// exit axis over BLEND_T, starting exactly at the current yaw — never a
// snap, so the drive never spins in place. Distance-based blending
// deadlocks (the target converges only as the mob nears the cell centre,
// but the nose-footing probe can refuse that very approach); time
// converges regardless of position, and the drive probes keep every arc
// honest. Every other tick holds the lane axis directly.
function blendTurn(mob, dt, res) {
  if (res.event === "junction" || res.event === "lock-turn") {
    // Restart the swing only for a fresh junction (blend finished or never
    // started): re-resetting from the live yaw every tick turns the 0.3 s
    // ease into a permanent creep, so the drive marches diagonally instead
    // of turning — open-field wall rides would parade instead of rounding.
    // A persistent junction rides out one single blend, like a one-tick one.
    if (res.event === "junction" && ((mob.blendT ?? 0) >= 1 || mob.blendFrom == null)) {
      mob.blendFrom = mob.yaw; mob.blendT = 0;
    }
    const from = mob.blendFrom ?? mob.yaw;
    const t = Math.min(1, (mob.blendT ?? 0) + dt / BLEND_T);
    mob.blendT = t;
    const s = t * t * (3 - 2 * t);
    mob.yawTarget = from + normYaw(mob.lane.axis - from) * s;
  } else {
    mob.blendFrom = null;
    mob.blendT = 0;
    mob.yawTarget = mob.lane.axis;
  }
}


// In-place lane flip (shared by the stall release and the turn-away
// escape): reverse the lane axis keeping the line, reset the stall
// clocks. The turn below expresses it (gated); the escape arms its
// maneuver flag on top.
function flipLaneInPlace(mob) {
  mob.lane = { axis: oppositeYaw(mob.lane.axis), entry: mob.lane.axis, lockX: -1, lockZ: -1 };
  mob.servoStall = 0;
  mob.stuckT = 0;
}

// Lane release to roam (shared by the stall release branches): drop the
// virtual wall and the lane, arm the latch cooldown. Entry commits re-arm
// their directed touch from the new spot (see callers).
function releaseLaneToRoam(mob) {
  mob.servoStall = 0;
  dropFollowLine(mob);
  dropLane(mob);
  mob.followCool = FOLLOW_COOL;
}

// Stalled-lane release (shared by the cruise and dead-end-seek stall
// guards): a lane that cannot advance, slide, or turn releases instead of
// grinding peers forever — touch rides U-turn in place keeping the line
// (guided violet rides release to the direct entry walk, cooled-mouth flips
// release to roam), red rails release to roam. Returns the servo verdict.
function releaseStalledLane(mob) {
  // A fully stalled lane (wedged nose, refused slide, aligned yaw) always
  // releases — touch rides included: nose contact leads body contact by a
  // few ticks, so genuine dead ends and inner corners U-turn long before
  // the 0.75 s trip, while a peer grind trips the mutual turn-away first
  // (see grindWatchTick) instead of freezing in place. The in-place
  // U-turn pace keeps moving, so it never trips it.
  {
    if (mob.followLine?.touch === true && mob.lane) {
      // A guided (violet) ride never U-turns in place: release to the
      // direct entry walk (re-armed — dock, stall latch, or hold take it
      // from the new spot).
      if (guidedActive(mob)) {
        mob.roam.stallT = 0;
        mob.roam.latchTried = false;
        releaseLaneToRoam(mob);
        return false;
      }
      // Stalled touch ride: U-turn in place and keep the line (never
      // drop) — same rule as the no-solution U-turn above — unless the flip
      // runs back into the cooled mouth: release to roam instead (the roam
      // veto walks the cooldown out rather than strolling back in).
      if (backIsCooled(mob, mob.lane.axis)) {
        releaseLaneToRoam(mob);
        return false;
      }
      flipLaneInPlace(mob);
      return true;
    }
    mob.lane = null; mob.servoStall = 0; mob.followCool = FOLLOW_COOL;
    mob.turnHold = 0;
    // A released entry re-arms its directed touch from the new spot.
    if (mob.roam?.entry) { mob.roam.stallT = 0; mob.roam.latchTried = false; }
    return false;
  }
}

// Sidestep offset for a peer-stalled wall ride: hold a validated parallel
// instead of grinding nose-to-nose on one line. The offset lives beside
// the follow line (never in it: takes re-erect the measured line every
// tick and would wipe a rebased one) and biases only the lateral slide
// target — probes, takes, and the virtual wall keep reading the real
// corridor. The slide converges gradually (no hop); gates let the pair
// walk past each other abreast. Roles break the mirror grind
// deterministically: the higher peer index sidesteps, the lower holds its
// line — no rand, no negotiation, no line-swapping loop (live-peer
// validation refuses a sidestep back onto the holder). Guided entries keep
// their claimed slots and mouth exits keep their threading offset; red
// rails recentre instead. Cleared once no peer holds the line nearby.
function tryLaneSidestep(mob, supported, floating, peers) {
  const vw = mob.followLine;
  if (!vw || vw.touch !== true || vw.noSlide === true) return false;
  if (guidedActive(mob) || mob.roam?.entry === true) return false;
  if ((mob._peerIdx ?? 0) % 2 === 0) return false;
  const [ax, az] = dirVec(mob.lane.axis);
  const msx = Math.sin(mob.yaw), msz = Math.cos(mob.yaw);
  for (const s of [1, -1]) {
    const px = mob.pos.x + -az * s * 0.8, pz = mob.pos.z + ax * s * 0.8;
    // Unwrapped voxel probe: the sidestep leaves the virtual corridor on
    // purpose, so the complementary wall must not veto it — only real
    // walls, pits, and live peers gate the escape.
    const base = makeStepOk(mob, supported, floating, 0, mob.lane.axis, 0);
    if (!base(px, pz)) continue;
    if (!descendOk(mob, px, pz)) continue;
    const pen = peerPenAt(mob, px, pz, msx, msz, mob.pos.y, peers, null);
    if (pen > CROSS_BUDGET) continue;
    mob._lineOff = (mob._lineOff ?? 0) + (ax === 0 ? -az : ax) * s * 0.8;
    mob._lineOffAxis = mob.lane.axis;
    return true;
  }
  return false;
}

// Grinding-peer scan (shared by the courtesy hold, the grind watch, and
// the escape): one pass reads the live same-level peers — the deepest
// current circle-pair penetration (who grinds, how deep) and the closest
// center distance (the grind-window leash). Never three separate scans.
const _grindNear = [];
function grindScan(mob, peers, grid = null) {
  let best = null, worst = 0, nearest = Infinity;
  const msx = Math.sin(mob.yaw), msz = Math.cos(mob.yaw);
  const list = grid ? queryMobGrid(grid, mob.pos.x, mob.pos.z, 3.5, _grindNear) : (peers ?? []);
  for (const o of list) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    const d2 = dx * dx + dz * dz;
    const d = Math.sqrt(d2);
    if (d < nearest) nearest = d;
    if (d2 > 3 * 3) continue;
    const w = worstPairPenAt(mob.pos.x, mob.pos.z, msx, msz,
      mob.hw, mob.nose, mob.tail, o, 0, 0);
    if (w != null && w.pen > worst) { worst = w.pen; best = o; }
  }
  return { peer: best, pen: worst, dist: nearest };
}

// A validated heading away from the grinder: 8 winds ordered by turn
// cost from the current yaw (narrowest first), each probed end-to-end
// against voxels (segment) and live peers — the same strictness as the
// stuck detour, so a leave never walks into a wall, a pit, or the next
// mob. The endpoint must gain separation from the grinder, so every
// validating wind actually leaves. Cheapest turn wins: a lateral sidestep
// out of nose contact sweeps shallow (the nose moves off the peer instead
// of orbiting through it); the full about-face only deals when boxed in.
// Null when boxed in (the caller holds instead). No nose-tip endpoint
// probe: a committed detour drives nose-first into its endpoint, but a
// leave turns en route and the per-tick drive probes own wall clearance —
// grazing the snout disc on a jamb must not veto the only way out.
function pickAwayHeading(mob, peer, supported, floating, peers, grid, dist) {
  const nowD = Math.hypot(mob.pos.x - peer.pos.x, mob.pos.z - peer.pos.z);
  const P = Math.PI;
  const winds = [0, P / 4, -P / 4, P / 2, -P / 2, (3 * P) / 4, -(3 * P) / 4, P];
  for (const dh of winds) {
    const h = normYaw(mob.yaw + dh);
    const sx = Math.sin(h), cz = Math.cos(h);
    const tx = mob.pos.x + sx * dist, tz = mob.pos.z + cz * dist;
    if (Math.hypot(tx - peer.pos.x, tz - peer.pos.z) < nowD - 1e-6) continue;
    if (mobBlockedAt(mob, tx, tz, mob.pos.y, peers, PICK_COMFORT, grid)) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, tx, tz)) continue;
    return h;
  }
  return null;
}

// Directed leave: drop any rail, commit a validated away heading open-loop
// (the roam ignore-plan flag below keeps the planner from yanking it back
// into the peer for the span), and — on repeats — double the latch
// cooldown so the yielder does not re-latch straight back in. Returns
// false when no away heading validates (boxed: the caller holds).
function leaveAndYield(mob, dt, supported, floating, peers, grid, peer, extended) {
  const dist = extended ? YIELD_DIST : LEAVE_DIST;
  const span = extended ? YIELD_SPAN : LEAVE_SPAN;
  const away = pickAwayHeading(mob, peer, supported, floating, peers, grid, dist);
  if (away == null) return false;
  mob.lane = null; mob.followLine = null; mob.turnHold = 0;
  mob.servoStall = 0; mob.stuckT = 0;
  mob.followCool = extended ? FOLLOW_COOL * 2 : Math.max(mob.followCool ?? 0, FOLLOW_COOL);
  const t = { x: mob.pos.x + Math.sin(away) * dist, z: mob.pos.z + Math.cos(away) * dist };
  mob.target = t; mob.wanderT = span;
  mob.roam = { mode: "commit", heading: away, target: t, tgt: t, t: 0, span };
  mob._detour = true; mob._planHold = null; mob._prevForce = null; mob._rebase = false;
  mob._turnAway = span;
  mob._progTgt = null; mob._progBad = 0; mob._progAge = 0;
  return true;
}

// Mutual turn-away escape for a sustained peer grind: both parties turn
// and leave in appropriate directions instead of parking in contact, so
// every episode breaks within the stuck budget. Roles are generic
// (committed line vs free seek), never one-off kinds:
// - touch ride: sidestep onto a validated parallel when one opens (a pass,
//   not a retreat); else flip in place keeping the line — the follower
//   keeps its line — unless the way back runs into a cooled mouth, which
//   releases to a directed leave instead;
// - red rail: release to a directed leave (no line to keep);
// - lane-less: directed away leave, long with latch cooldown on repeats;
// - both touch on a repeat: the higher peer index yields fully (drop + long
//   leave) while the lower holds its line — deterministic, no negotiation;
// - priority: against a free peer the touch ride holds its line (the peer's
//   own episode yields it); against a peer that cannot maneuver (parked,
//   guided, holder) the touch ride yields by flipping again.
// Guided entries, holders, smooth crossings, and stationary mobs never
// maneuver (caller gates them); their peers' episodes yield instead.
// Returns true when a maneuver or hold started (the tick is done),
// false on a clean sidestep (the drive below resumes) or when boxed.
function peerGrindEscape(mob, dt, supported, floating, peers, grid, knownGrinder = null) {
  const grinder = knownGrinder ?? grindScan(mob, peers, grid).peer;
  if (!grinder) { mob._peerStall = 0; return false; }
  const touch = mob.followLine?.touch === true && mob.lane != null;
  if (touch && tryLaneSidestep(mob, supported, floating, peers)) {
    mob._peerStall = 0; mob.servoStall = 0;
    return false;
  }
  // Episode memory: re-grinding the same peer inside the window escalates;
  // past it the slate is clean. Sidestep passes (above) never count.
  let ep = 1;
  if (mob._grindPeer === grinder && (mob._grindCool ?? 0) > 0) ep = (mob._grindEp ?? 1) + 1;
  mob._grindPeer = grinder; mob._grindEp = ep; mob._grindCool = GRIND_WINDOW;
  mob._peerStall = 0; mob.servoStall = 0; mob._peerHold = false; mob._holdTurn = false;
  mob._planHold = null; mob._prevForce = null;
  const peerTouch = grinder.followLine?.touch === true;
  const peerMovable = (grinder.speed ?? 0) > 0 && !guidedActive(grinder) &&
    grinder.roam?.entry !== true && mobRank(grinder) < 3;
  const extended = ep >= 2;
  if (!touch) {
    // Red rail or lane-less: the free party yields, long on repeats.
    if (leaveAndYield(mob, dt, supported, floating, peers, grid, grinder, extended)) return true;
    return false;
  }
  // Turn away: flip in place keeping the line — unless the previous flip
  // has not expressed yet (yaw still off the lane axis): flipping again
  // reverses a turn in progress and ping-pongs in place, so hold and let
  // the turn finish instead. A piled-up episode count yields fully instead
  // of holding forever: drop the line and leave like the free party.
  const yawErr = Math.abs(normYaw(mob.yaw - mob.lane.axis));
  if (ep >= 3) {
    if (leaveAndYield(mob, dt, supported, floating, peers, grid, grinder, true)) return true;
  }
  if (yawErr > 0.5) {
    mob._peerHold = true; mob._peerHoldAxis = mob.lane.axis; mob._peerHoldT = 0;
    mob._holdTurn = true;
    mob.stuckT = 0;
    return true;
  }
  if (extended && peerTouch && peerMovable) {
    if ((mob._peerIdx ?? 0) > (grinder._peerIdx ?? 0)) {
      if (leaveAndYield(mob, dt, supported, floating, peers, grid, grinder, true)) return true;
    }
    // Lower index holds its line: the higher peer yields fully instead.
    mob._peerHold = true; mob._peerHoldAxis = mob.lane.axis; mob._peerHoldT = 0;
    mob.stuckT = 0;
    return true;
  }
  if (extended && !peerTouch) {
    // Priority: the line holder keeps its line, the free peer yields via
    // its own episode — unless the peer cannot maneuver at all (parked,
    // guided, holder), in which case flip again rather than hold forever.
    if (peerMovable) {
      mob._peerHold = true; mob._peerHoldAxis = mob.lane.axis; mob._peerHoldT = 0;
      mob.stuckT = 0;
      return true;
    }
  }
  // Turn away: flip in place keeping the line; a cooled way back releases
  // to a directed leave instead of flipping into the mouth. The flip arms
  // the maneuver flag too: the turn below is the resolution (bounded,
  // open-loop), not a new grind.
  if (backIsCooled(mob, mob.lane.axis)) {
    if (leaveAndYield(mob, dt, supported, floating, peers, grid, grinder, extended)) return true;
    return false;
  }
  flipLaneInPlace(mob);
  mob._turnAway = Math.max(mob._turnAway ?? 0, 0.5);
  return true;
}

// Grind-window accrual (shared by the laned and lane-less watches):
// contact — or a backstop-confirmed overlap — opens a window keyed on the
// closest peer distance; closing by more than the leash restamps it (an
// approach walks through), while grinding in place accrues to the trip.
// Self displacement lies here (the push-apart/walk-back sawtooth moves
// every tick, shared shoves move both), the snout reads far, but the pair
// distance only closes on a real approach.
function grindAccrue(mob, dt, penPeak, pushed, minD) {
  if (penPeak > 0.03 || pushed) {
    if (mob._grindD == null) { mob._grindD = minD; }
    else if (mob._grindD - minD > 0.2) {
      mob._grindD = minD; mob._peerStall = 0;
      return;
    }
    mob._peerStall = (mob._peerStall ?? 0) + dt;
  } else if (penPeak <= 0.01) {
    mob._grindD = null;
    mob._peerStall = Math.max(0, (mob._peerStall ?? 0) - dt * 4);
  } else {
    mob._peerStall = Math.max(0, (mob._peerStall ?? 0) - dt);
  }
}

// Grind watch (shared by the laned cruise and the lane-less tick): accrue
// live contact over the pair-distance leash, trip the mutual turn-away
// escape past GRIND_T. Returns the escape verdict (true = the tick is
// done). The caller gates eligibility — the lane-less path skips holders,
// smooth crossings, entries, and active maneuvers; the laned path always
// watches (holders never maneuver — their peers' episodes yield instead,
// enforced inside the escape).
function grindWatchTick(mob, dt, supported, floating, peers, grid) {
  const pushed = mob._pushed === true;
  mob._pushed = false;
  if (peers == null) { mob._peerStall = 0; return false; }
  const s = grindScan(mob, peers, grid);
  grindAccrue(mob, dt, s.pen, pushed, s.dist);
  if ((mob._peerStall ?? 0) > GRIND_T) {
    mob._peerStall = 0;
    return peerGrindEscape(mob, dt, supported, floating, peers, grid, s.peer);
  }
  return false;
}

// A passive peer blocking the nose: real body contact now, the peer
// roughly ahead and close, and advancing nowhere itself (parked, wedged,
// waiting its own turn). Pushing it shoves it down the corridor (the
// backstop clears every overlap), so the drive holds at brush range
// instead — the grind pipeline below owns the escape, the waiter stops
// travelling. Movers (displacing peers) and side brushes never hold:
// files pace, crossers pass. Measured at the current pose, never on
// forward probes: the metre-long snout reads brushes two metres out,
// while only established contact may freeze the drive.
function passiveAhead(mob, peers, dt) {
  const msx = Math.sin(mob.yaw), msz = Math.cos(mob.yaw);
  const s = grindScan(mob, peers, null);
  if (s.pen <= 0.03 || s.dist >= 1.0) return false;
  const g = s.peer;
  if (!g) return false;
  const dx = g.pos.x - mob.pos.x, dz = g.pos.z - mob.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  if ((dx * msx + dz * msz) / d < 0.3) return false;
  const osp = g.speed ?? mob.speed;
  return osp <= 0 || (g._adv ?? 0) < osp * dt * 0.1;
}

// Corridor cruise: locked-yaw drive with the lateral centre slide, plus
// the stall guard (a latched lane that cannot advance — nose wedged where
// the body fits — releases to the wander instead of freezing in place; a
// successful 1-wide recentre counts as progress, not a stall).
function cruiseLane(mob, dt, supported, floating, res, rand = Math.random, peerGate = null, peers = null, turnGate = null) {
  // Cruise never descends into a pit (see descendOk): ramps with a
  // walkable continuation pass through, local minima read as walls. The
  // probe below captures the pre-turn facing exactly like the inline drive
  // did; the move itself runs post-turn.
  const cruiseBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
  const cruiseOk = wrapStepOk(mob, cruiseBase);
  // Peer-stall discipline: a sustained grind breaks into the mutual
  // turn-away below instead of parking in contact (see peerGrindEscape);
  // the stall below owns the state after the maneuver. Measured on the
  // post-drive pose (the contact peak: the pre-drive pose reads the
  // backstop's trough and flickers the signal).
  // Courtesy hold first: never push a passive peer down the corridor —
  // skip the forward drive (slide only) while one blocks the nose. The
  // stall below still accrues (dist reads 0) and trips the escape, so a
  // wait never parks forever, and the waiter stops travelling. No state:
  // the quiet hold below owns persistence, this only refuses the push.
  const held = peers != null && passiveAhead(mob, peers, dt);
  // Quiet hold from a previous trip: skip the forward drive while a peer
  // still touches the body, keep sliding laterally. Clears the tick the
  // body reads free or the lane axis changes (flip/release). A turn still
  // expressing (held mid-flip below) clears once the yaw lands on the lane
  // instead — the drive below then walks out of the meeting. Fused: past
  // the fuse the escape re-polls instead of holding forever — geometry
  // shifts as the peer maneuvers, and a hold that never re-checks would
  // freeze a meeting the next sidestep could have resolved.
  if (mob._peerHold === true) {
    if ((mob._peerHoldAxis ?? mob.lane.axis) !== mob.lane.axis ||
      peerPenAt(mob, mob.pos.x, mob.pos.z, Math.sin(mob.yaw), Math.cos(mob.yaw), mob.pos.y, peers ?? [], null) <= 0 ||
      (mob._holdTurn === true && Math.abs(normYaw(mob.yaw - mob.lane.axis)) < 0.3)) {
      mob._peerHold = false; mob._holdTurn = false;
    } else {
      mob._peerHoldT = (mob._peerHoldT ?? 0) + dt;
      if (mob._peerHoldT > HOLD_FUSE && peers) {
        mob._peerHold = false; mob._peerStall = 0;
        if (peerGrindEscape(mob, dt, supported, floating, peers, null)) return true;
      } else {
        centerPull(mob, dt, supported, floating, false, peers);
        mob.stuckT = 0;
        return true;
      }
    }
  }
  // Sidestep offset expiry: a turn onto a new axis drops it outright; once
  // no peer holds the line nearby the ride re-converges onto its measured
  // line instead of parading a stale parallel.
  if (mob._lineOff) {
    const [lax, laz] = dirVec(mob.lane.axis);
    if ((mob._lineOffAxis ?? mob.lane.axis) !== mob.lane.axis) mob._lineOff = 0;
    else {
      let near = false;
      for (const o of peers ?? []) {
        if (o === mob || !o.alive || Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
        const ox = o.pos.x - mob.pos.x, oz = o.pos.z - mob.pos.z;
        if (Math.abs(ox * lax + oz * laz) < 2.5 && Math.abs(ox * -laz + oz * lax) < 1.5) { near = true; break; }
      }
      if (!near) mob._lineOff = 0;
      else mob._lineOffAxis = mob.lane.axis;
    }
  }
  const driveRes = held ? null : driveToward(mob, dt, mob.yawTarget, () => {
    // Peer gate (same budget as the lane-less step gate): laned drives
    // stop at deep peer contact instead of grinding through — brushes walk
    // through, paced files are exempt (followSlow paces them), and the
    // stall path owns the escape (U-turn/release), exactly like the
    // lane-less stuck path. No freeze: the drive only ever refuses, never
    // reverses by itself.
    return (nx, nz) => cruiseOk(nx, nz) && descendOk(mob, nx, nz) &&
      (peerGate == null || !peerGate(nx, nz));
  }, moveVector, { rate: SERVO_TURN, turnOk: turnGate });
  const err = driveRes ? driveRes.err : Math.abs(normYaw(mob.yawTarget - mob.yaw));
  const dist = driveRes ? driveRes.dist : 0;
  // Lateral centering on straights: yaw stays locked on the corridor
  // axis (no hunting), the body slides toward the lane middle when free —
  // the cell centre in a true 1-wide corridor, the virtual-lane middle
  // while wall-following. Turns and seeks centre through centerPull above.
  const recentered = res.event === "cruise"
    ? 0
    : centerPull(mob, dt, supported, floating, true, peers);
  if (dist === 0 && recentered === 0 && err < SERVO_SPIN) mob.servoStall = (mob.servoStall ?? 0) + dt;
  else mob.servoStall = 0;
  if (mob.servoStall > 0.75) return releaseStalledLane(mob);
  // Peer grind past the trip (see grindWatchTick): both parties turn away
  // and leave in appropriate directions instead of parking in contact —
  // the shared escape owns the maneuver, the stall below owns the state
  // after it.
  if (grindWatchTick(mob, dt, supported, floating, peers, null)) return true;
  if (res.event === "cruise") centerPull(mob, dt, supported, floating, false, peers);
  mob.stuckT = 0;
  return true;
}

// Full per-mob tick: entry attraction, stuck detection, target refresh,
// servo/roam/wander planes, gravity/float vertical, cosmetic gait (scene
// only). pickTarget is injected (farm.js) so this stays world-free; it now
// validates whole strides, so pen fence and house walls bound it emergently
// (no pen fork).
export function tickFarmMob(mob, dt, pickTarget, rand = mob.rand ?? Math.random, peers = null, grid = null, _top = true) {
  // Fixed-step integration: tall frames (V speed) run exact SERVO_STEP
  // slices plus one tail below 1.5 steps, so probes, arcs, holds and
  // random draws read identically per sim-second at any speed. Plain
  // recursion, no body re-indent (keeps later diffs clean). Sub-slices
  // share the one-tick group plan; only the outer tick clears it.
  if (dt > SERVO_STEP * 1.5) {
    tickFarmMob(mob, SERVO_STEP, pickTarget, rand, peers, grid, false);
    tickFarmMob(mob, dt - SERVO_STEP, pickTarget, rand, peers, grid, false);
    if (_top) mob._plan = null;
    return;
  }
  // Support state first: entry attraction only walks on dry ground.
  const surface = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h);
  const floating = surface != null;
  const supported = floating || hasSupport(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw);
  if (supported) mob.fallFrom = mob.pos.y;
  // Tunnel-entry attraction primes over everything (open roam, wall rides,
  // wander picks): draws repeat every scan until one accepts, steered as a
  // plain roam commit. While one runs, the picks below pause (stuck/refresh
  // would steal its target); peer avoidance stays live (the tiered planner
  // slows, sidesteps hole-ward, or aborts entries — only the backstop ran
  // before, which shoved precise maneuvers).
  mob.entryScanT = Math.max(0, (mob.entryScanT ?? 0) - dt);
  mob.entryCoolT = Math.max(0, (mob.entryCoolT ?? 0) - dt);
  mob._grindCool = Math.max(0, (mob._grindCool ?? 0) - dt);
  mob._turnAway = Math.max(0, (mob._turnAway ?? 0) - dt);
  const entryHold = supported && !floating ? entryTick(mob, dt, rand, { supported, floating, pickTarget }) : false;
  // 2-wide crossing state: maintained while the mouth holds, draws the exit
  // at the first hold tick and closes with cooldown at the leave
  // (passageTick owns it; lane owners and entry commits are exempt).
  if (supported && !floating) passageTick(mob, dt, supported, floating, rand, pickTarget);
  const peersEff = peers;
  if (!entryHold) {
    mob.wanderT -= dt;
    const dx = mob.target ? mob.target.x - mob.pos.x : 0;
    const dz = mob.target ? mob.target.z - mob.pos.z : 0;
    // Stuck pushing a wall (e.g. fence between us and an outside target)
    // or blocked by another mob (the gate below refuses the step): re-pick
    // instead of grinding until wanderT runs out. Stillness is relative to
    // a normal step (speed*dt), not an absolute distance — and shuffling
    // without closing trips the progress watchdog below, since slides and
    // shoves move the feet while the dance goes nowhere. The re-pick
    // commits to a full roam stride, so a detour around a mob (or wall)
    // survives next tick's decide instead of dying after one step.
    if (mob.target) {
      const stepped = Math.hypot(mob.pos.x - mob.lastX, mob.pos.z - mob.lastZ);
      // Real advance this slice (drives only — the separation backstop runs
      // after the tick): the file discipline paces it, not the speed field.
      mob._adv = stepped;
      if (stepped < mob.speed * dt * 0.2) mob.stuckT += dt;
      else { mob.stuckT = 0; }
      // Solo legacy path (peers == null: headless rigs, registry ticks):
      // stillness-only re-pick, bit-identical draw stream to before the
      // cooperation port. The watchdog + maneuvers below own the peer
      // path only, so existing pinned seeds never shift.
      if (peers == null) {
        // Smooth crossings hold in place instead of re-picking: the span
        // watchdog (roamStep timedOut → decide) owns the only release.
        if (mob.stuckT >= STUCK_T && mob.roam?.smooth !== true) {
          mob.target = pickTarget(mob, rand);
          mob.wanderT = roamSpan(rand);
          mob.stuckT = 0;
        }
      } else {
      // Progress watchdog: sample the target distance twice a second; four
      // samples without meaningful closing escalate like stillness (slow
      // herds need patience — shuffling that still advances is not stuck).
      // A fresh target re-stamps the reference; a flying maneuver
      // suppresses the sampling outright (sidesteps legitimately open
      // distance).
      const distT = Math.hypot(dx, dz);
      mob._progAge = (mob._progAge ?? 0) + dt;
      if (mob.target !== mob._progTgt || mob._detour) {
        mob._progTgt = mob.target; mob._progD = distT; mob._progAge = 0; mob._progBad = 0;
      } else if (mob._progAge >= PROG_T) {
        if (mob._progD - distT < PROG_MIN) mob._progBad = (mob._progBad ?? 0) + 1;
        else mob._progBad = 0;
        mob._progD = distT; mob._progAge = 0;
      }
      const progStuck = (mob._progBad ?? 0) >= PROG_STRIKES;
      // Smooth crossings never maneuver (same single release as solo).
      // Holders never maneuver either (rank >= 3: exiting or threading —
      // walls forbid sidesteps, so a frank detour would shove the hold —
      // keep the slowed line and let the backstop clear residue instead).
      if ((mob.stuckT >= STUCK_T || progStuck) && mob.roam?.smooth !== true && mobRank(mob) < 3) {
        // Shuffle within snout-sweep range of walls: no forced maneuver —
        // its turn would sweep the snout along the rock — hand decide a
        // fresh wall-aware commit instead (open headings read clearance),
        // like an early arrival. Open-field shuffles commit frank pushes.
        if (progStuck && mob.stuckT < STUCK_T && wallNear(mob, supported, floating)) {
          mob.target = null;
          mob.stuckT = 0; mob._progBad = 0;
        } else {
          // Fallback detour (tard + franc): only when a live peer
          // hard-blocks the nose right now (a wall never reads here) —
          // otherwise a plain re-pick, no forced maneuver: slow herds
          // that still advance must never earn sidesteps. The detour
          // commits a short validated line that survives next tick's
          // decide; plain re-picks hand decide a fresh commit instead.
          // Lane mobs never commit maneuvers (the servo owns their
          // heading): they fall through to a plain re-pick instead.
          let t = null, heading = null;
          const hardBlocked = !mob.lane && peersEff && mobBlocksAhead(mob, peersEff, grid);
          const detour = hardBlocked ? pickDetourTarget(mob, rand, peersEff, grid) : null;
          t = detour ? detour.target : pickTarget(mob, rand, peersEff, grid);
          // The detour heading stays 8-wind so meetings read off a
          // discrete set; a plain re-pick keeps the free-roam raw
          // heading. t can still be null (wedged: nothing validates) —
          // the else below then just waits out a fresh span instead of
          // crashing on t.x.
          if (t) {
            heading = detour ? detour.heading
              : Math.atan2(t.x - mob.pos.x, t.z - mob.pos.z);
          }
          // Identical re-pick: the picker returned the very target we are
          // stuck on (pinned rig picker or repeated cell) — re-latching it
          // spins forever, since the same step refusal re-fires. Drop it so
          // the refresh below hands decide a fresh commit instead.
          if (t && mob.target && t.x === mob.target.x && t.z === mob.target.z) t = null;
          mob.target = t;
          if (t && !mob.lane && detour) {
            // Commit the detour like a roam stride: decide would otherwise
            // overwrite the fresh heading on the very next tick. Spans stay
            // short — a detour clears one blocker — and a stale heading is
            // how mobs wander off instead of passing. A fresh maneuver
            // voids any latched plan: the planner re-reads the new commit
            // next tick instead of fighting it.
            mob.roam = { mode: "commit", heading, target: t, tgt: t, t: 0, span: Math.min(roamSpan(rand), DETOUR_SPAN) };
            mob.wanderT = mob.roam.span;
            mob._detour = true;
            mob._planHold = null;
            mob._rebase = false;
          } else {
            // Plain re-pick: no commit, decide owns the next heading. The
            // drive keeps the current line instead of jerking onto a fresh
            // one mid-stride.
            mob.wanderT = roamSpan(rand);
          }
          mob.stuckT = 0;
        } // end maneuver branch (wall-near soft refresh above skips it)
      }
      } // end peer path (solo legacy above keeps the old draw stream)
    } else {
      mob.stuckT = 0;
      mob._adv = 0;
      mob._progTgt = null; mob._progBad = 0; mob._progAge = 0;
    }
    mob.lastX = mob.pos.x;
    mob.lastZ = mob.pos.z;
    // Target refresh on arrival or span expiry — wanderT never doubles as
    // another signal.
    if (!mob.target || Math.hypot(dx, dz) < ARRIVE_D || mob.wanderT <= 0) {
      mob._detour = false;
      mob._planHold = null;
      mob._rebase = false;
      mob.target = pickTarget(mob, rand, peersEff, grid);
      mob.wanderT = roamSpan(rand);
    }
  } else {
    mob.lastX = mob.pos.x;
    mob.lastZ = mob.pos.z;
    mob.stuckT = 0;
  }
  // Roam stepping owns lane-less ticks the servo declines (the R2 upkeep
  // above already ran inside the servo tick). Speed only ever takes the
  // planner's two levels (full or PLAN_SLOW) — no continuous yield factor,
  // so meets never judder. Tiers plan every mode now (slow for laned wall
  // rides, steer/abort for entries); red rails stay unplanned.
  // Mob bodies count as obstacles for lane-less stepping (same Y level
  // only): a refused step stops at contact range instead of overlapping
  // past the brush budget, and the stuck re-pick below routes around true
  // blockers. Picks and detection stay exact; only real steps may brush.
  const blockedByMob = peersEff && !mob.lane
    ? (nx, nz) => mobBlockedAt(mob, nx, nz, mob.pos.y, peersEff, 0, grid, CROSS_BUDGET)
    : null;
  // Laned peer gate (same budget as above): a rail never overlaps a peer
  // past the brush budget either — the drive stops at contact range and
  // the stall path owns the escape (U-turn/release), exactly like the
  // lane-less stuck path. Settled files are exempt (followSlow paces them);
  // acute catch-ups at a yaw angle re-arm the gate (same circles, same
  // budget — only the exemption narrows), so a follower arriving at ~20°
  // stops at contact range instead of walking through its leader.
  const lanePeerGate = peersEff && mob.lane
    ? (nx, nz) => peerPenAt(mob, nx, nz, Math.sin(mob.yaw), Math.cos(mob.yaw),
      mob.pos.y, peersEff, grid, 0,
      (o) => followsPace(mob, o) && Math.abs(normYaw(o.yaw - mob.yaw)) < 0.3) > CROSS_BUDGET
    : null;
  // Turn gate (same budget as the step gates): a yaw step that would swing
  // the nose/tail discs into a peer past the brush budget is refused —
  // translation gates only test positions, so a pure rotation deepens
  // contact for free (outer-tip grind: the dodger turns in place into the
  // holder). Already-deep contact stays free (escape turns and the stuck
  // path own it); shallow turns walk through like shallow steps.
  // Lane-less maneuver turns carry a small give (see makeTurnGate): bounded
  // deepening unfreezes broad-snount deadlocks without freeing sweeps.
  // Laned flip turns stay strict — the line re-measures every tick, so a
  // strict turn converges instead of freezing, and the sweep stays clean.
  const turnGate = peersEff
    ? makeTurnGate(mob, peersEff, grid, 0)
    : null;
  const turnGiveGate = peersEff && mob._turnAway > 0
    ? makeTurnGate(mob, peersEff, grid, TURN_GIVE)
    : turnGate;
  // Group plan (forecast.js, latched): slow applies to every planned mob
  // (laned wall rides pace on their servo line, never re-aimed); a forced
  // heading overrides the commit target only lane-less — except locked
  // smooth crossings, which slow but never steer — and never on a committed
  // detour, which flies its own validated line open-loop instead: re-aiming
  // the point every tick would wobble the escape. Null plan (or lane
  // motion) keeps legacy behavior. Detach (blue → free roam) and abort
  // (wedged 1-wide committer → giveUp path) flags land here, the tick the
  // plan deals them, so the drive below already flies the new mode.
  // Every blue ride detaches — including entry-carrying guided rides: the
  // claimed slot survives (stall re-armed), so the commit re-approaches
  // after the dodge expresses itself instead of losing the hole.
  const slowPlan = peersEff && mob._plan?.forced ? mob._plan : null;
  // Detach (blue → free roam) lands the tick the plan deals it, so the drive
  // below already flies the new mode. Guided entry rides keep their claimed
  // slot (stall re-armed) and re-approach after the dodge; pure blues open
  // a free-roam commit along the dodge wind.
  if (mob._wantDetach && mob.lane) {
    const h = slowPlan ? slowPlan.heading : mob.yaw;
    mob.lane = null; mob.followLine = null; mob.turnHold = 0;
    mob.followCool = FOLLOW_COOL; mob.stuckT = 0; mob.servoStall = 0;
    mob._detour = false; mob._rebase = false;
    if (mob.roam?.entry === true) {
      mob.roam.stallT = 0; mob.roam.latchTried = false;
    } else {
      // Dodge commit past the meeting, not just off the line: a short hop
      // expires right back inside the crowd (arrival → blind wander →
      // re-meeting), so walk the dodge wind until voxel-clear (2.4 m when
      // the whole segment walks, 1.6 m otherwise).
      const reach = segmentWalkable(mob, mob.pos.x, mob.pos.z,
        mob.pos.x + Math.sin(h) * 2.4, mob.pos.z + Math.cos(h) * 2.4) ? 2.4 : 1.6;
      const t = { x: mob.pos.x + Math.sin(h) * reach, z: mob.pos.z + Math.cos(h) * reach };
      mob.target = t;
      mob.wanderT = NO_EXPIRY;
      mob.roam = { mode: "commit", heading: h, target: t, tgt: t, t: 0, span: roamSpan(rand), runT: 0 };
    }
  }
  mob._wantDetach = false;
  const plan = !mob.lane && slowPlan && mob.roam?.smooth !== true ? slowPlan : null;
  if (mob._wantAbort && mob.roam?.entry === true) mob.roam.giveUp = true;
  mob._wantAbort = false;
  const cruise = mob._detour && !plan && mob.roam?.heading != null ? mob.roam.heading : null;
  // Line rebase (forecast.js flagged the stand-down): the sidestep episode
  // adopted a parallel line — move the goal onto it instead of swinging
  // back onto the old line. Validated end-to-end (falls back to the old
  // goal if the new parallel doesn't walk); commit identity kept so the
  // stride survives (tgt follows target). Free roam commits only: entries
  // fly claimed slots, smooth crossings fly locked lines, detours fly
  // validated lines, lanes fly rails.
  if (mob._rebase && !mob.lane && !mob._detour && mob.roam && !mob.roam.entry && !mob.roam.smooth && mob.target) {
    mob._rebase = false;
    const dx = mob.target.x - mob.pos.x, dz = mob.target.z - mob.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.5) {
      const gx = mob.pos.x + Math.sin(mob.yaw) * d, gz = mob.pos.z + Math.cos(mob.yaw) * d;
      // Validate the new parallel against voxels AND peers: rebasing onto
      // another mob just moves the meeting. Falls back to the old goal
      // (the resume logic re-aims at it) when the parallel doesn't walk.
      const voxOk = segmentWalkable(mob, mob.pos.x, mob.pos.z, gx, gz);
      const peerOk = !blockedByMob || (!blockedByMob((mob.pos.x + gx) / 2, (mob.pos.z + gz) / 2) && !blockedByMob(gx, gz));
      if (voxOk && peerOk) {
        const g = { x: gx, z: gz };
        mob.target = g;
        mob.roam.tgt = g;
        mob.roam.target = g;
      }
    }
  }
  let slow = slowPlan ? slowPlan.slow : 1;
  // File discipline: match a same-direction peer's pace ahead in the
  // corridor instead of tailgating into it — the file walks parallel at
  // constant spacing instead of grinding. Slow-only, any mode (laned wall
  // rides pace on their servo line).
  if (peersEff) slow = Math.min(slow, followSlow(mob, peersEff, grid));
  let savedSpeed = 0;
  if (slow !== 1) { savedSpeed = mob.speed; mob.speed *= slow; }
  const servoed = servoTick(mob, dt, supported, floating, rand, pickTarget, lanePeerGate, peersEff, turnGate);
  let roamed = false;
  if (!servoed && supported && !floating) {
    roamed = roamStep(mob, dt, supported, floating, rand, pickTarget, blockedByMob,
      plan ? plan.heading : cruise, turnGiveGate);
  }
  // Lane-less peer-grind watch (same discipline as the laned cruise,
  // see grindWatchTick): sustained body contact with no escape breaks into
  // the mutual turn-away instead of churning release/re-pick forever.
  // Stationary mobs, holders, smooth crossings, and entry commits never
  // maneuver — their peers' episodes yield instead.
  if (!mob.lane && peersEff && supported && !floating && (mob.speed ?? 0) > 0 &&
    mobRank(mob) < 3 && mob.roam?.smooth !== true && mob.roam?.entry !== true &&
    !(mob._turnAway > 0)) {
    grindWatchTick(mob, dt, supported, floating, peersEff, grid);
  } else if (!mob.lane) mob._peerStall = 0;
  if (mob.target && !servoed && !roamed) {
    // Legal-step gate (non-jumping walkers): never up, down at most
    // maxDrop. A deeper drop is a vertical air wall — rejected exactly
    // like solid, so the stuck detector re-picks instead of cliff walking.
    // The destination test is passage-at-current-height plus headroom on
    // the center column: a full body box posed at the lower level would
    // overlap the very step being descended and reject every descent.
    // Plus a nose-circle probe ahead along the facing: the visual head
    // sticks out past hw, so the body test alone would let it grind
    // into walls. Unlike every other drive this one never gates on the
    // yaw error (last-resort chase keeps full stride while turning).
    // Clamp by halving: a refused step retries at half distance, so the
    // mob slides up against the blocker (wall or nose contact) instead
    // of stopping a full step away or grinding from afar.
    // The gate refuses any step that would overlap another mob's body past
    // the brush budget — walls stay exact, bodies may graze: mobs walk
    // through shallow contact on the committed heading (the backstop clears
    // the residue), and only true blockers earn a stuck re-pick below.
    const makeWander = () => {
      const base = makeStepOk(mob, supported, floating, mob.nose.along, mob.yaw);
      return blockedByMob ? (nx, nz) => base(nx, nz) && !blockedByMob(nx, nz) : base;
    };
    // Forced headings cruise open-loop (plan or detour alike); free
    // wander keeps the raw heading. Last-resort chase slides along walls
    // instead of grinding into them (same deflection as roam commits,
    // full stride while turning).
    const goal = plan ? plan.heading : cruise ?? Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z);
    driveToward(mob, dt, slideDeflect(mob, dt, goal, supported, floating),
      makeWander, moveClamped, { gated: false, turnOk: turnGiveGate });
  }
  // One-tick plan: consumed above (roam or wander) or ignored (servo) —
  // never carried over, the planner re-runs (and re-latches holds) every
  // tick off live positions. Sub-slices share it; only the outer tick
  // clears it.
  if (_top) mob._plan = null;
  if (savedSpeed) mob.speed = savedSpeed;
  // Displacement-mode flags for the ?color=1 tint (farm.js paints,
  // headless rigs assert): derived every tick, never branched on by
  // steering. An entry commit approaches a mouth (purple); a touch ride on
  // a lane follows a wall (blue); a lane alone runs a true 1-wide corridor
  // (red); threading a 2-wide reads orange — with a live crossing, or
  // wall-following inside 2-wide geometry with none (nose-blocked or
  // timed-out close, same-mouth-cooldown re-entry: the lifecycle is gone
  // but the body is still in the mouth). Paint ranks orange over any ride,
  // so the thread shows orange until the leave.
  mob.wallFollow = mob.followLine?.touch === true && mob.lane != null;
  mob.oneWide = mob.lane != null && mob.followLine?.touch !== true;
  const cellFree = makeCellFree(mob), cellSolid = makeCellSolid(mob);
  const heldInside = mob.passage?.kind === 2 && isTwoWideMouth(
    Math.floor(mob.pos.x), Math.floor(mob.pos.z),
    snapCardinal(mob.passage.axis), cellFree, cellSolid);
  const ridingInside = mob.wallFollow === true && CARDINALS.some((a) => isTwoWideMouth(
    Math.floor(mob.pos.x), Math.floor(mob.pos.z), a, cellFree, cellSolid));
  mob.inPassage = !mob.oneWide && (heldInside || ridingInside);
  mob.tunnelPass = mob.roam?.entry === true;
  // Vertical plane (support state computed above, pre-move).
  stepVertical(mob, dt, surface, floating, supported);
  // Cosmetic: alternating leg swing + tail sway while walking (scene only).
  mob.legPhase += dt * mob.speed * 4;
  if (mob.root) {
    const legs = mob.root.userData.legs;
    for (let i = 0; i < legs.length; i++) {
      legs[i].pivot.rotation.x = Math.sin(mob.legPhase + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.5;
    }
    mob.root.userData.tailGroup.rotation.y = Math.sin(mob.legPhase * 0.5) * 0.3;
    mob.root.rotation.y = mob.yaw;
  }
}

// Separation destination veto: a side moves only onto a free body with
// supported feet (nose circle included, so pushes never park a head in
// a wall), legal ground under every body circle, and headroom over
// each: drops deeper than maxDrop are air walls for pushes exactly as
// for steps, so herds never shove each other off cliffs.
export function sepSpotFree(mob, x, z) {
  if (aabbIntersectsSolid(x, mob.pos.y, z, mob.hw, mob.h)) return false;
  const gx = x + Math.sin(mob.yaw) * mob.nose.along, gz = z + Math.cos(mob.yaw) * mob.nose.along;
  if (aabbIntersectsSolid(gx, mob.pos.y, gz, mob.nose.r, mob.h)) return false;
  if (!hasSupport(x, mob.pos.y, z, mob.hw)) return false;
  if (!footingOk(mob, x, z, mob.pos.y)) return false;
  return headroomOk(mob, x, z, mob.pos.y);
}

// Hard separation safety net over one dimension's mobs: positional
// depenetration on the yaw-oriented body circles (core + nose + tail),
// worst circle pair first, up to 8 iterations (dense pen pileups cascade:
// clearing one pair can press another, so 3 iterations leave residue).
// Shallow brushes at or under PUSH_T are left alone (invisible, and the
// drives walk them out on their own) — correcting those is the visible
// shove. Deeper overlaps correct fractionally, so a single tick never
// teleports a mob: the residue converges over the following ticks, and
// the veto still parks heads out of walls. Separation runs center to
// center (never along the worst pair's own axis): competing circle pairs
// would otherwise ping-pong the correction between their normals and hold
// a steady overlap forever. Coincident centers fall back to the worst
// pair's deterministic axis. A vetoed side stays put and the other side
// takes the damped correction; both vetoed slides tangentially instead of
// keeping the overlap (wall sandwiches unstack sideways, never into rock).
// Y-gated so a faller never shoves a walker below.
// Alloc-free: circle centers stay in locals, pairs share one loop.
// grid (optional, same tick's buildMobGrid) restricts each mob to neighbors
// within 2.5 m — a superset of every circle-pair reach — re-sorted to legacy
// index order with the same i/j pair indices, so results are bit-identical.
// The grid is rebuilt every iteration: depenetration moves bodies, and a
// stale grid would miss pairs formed by an earlier cascade. Null grid =
// legacy all-pairs scan.
export function separateFarmMobs(list, grid = null) {
  // Position index for legacy i/j order under the grid path (farm and rigs
  // keep _peerIdx == position, but the index map is exact regardless).
  let idx = null;
  if (grid) { idx = new Map(); for (let k = 0; k < list.length; k++) idx.set(list[k], k); }
  // Per-tick correction budget per mob: no mob ever moves more than
  // PUSH_CAP in one tick, however many pairs and iterations touch it.
  // Corrections past the budget wait for the next tick — a deep overlap
  // resolves as a short glide, never a teleport.
  const spent = new Map();
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    const g = grid ? buildMobGrid(list, grid.cell) : null;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      let mates = null;
      if (g) {
        queryMobGrid(g, a.pos.x, a.pos.z, 2.5, _sepNear);
        mates = _sepNear.filter((b) => b !== a && b.alive && (idx.get(b) ?? -1) > i);
        mates.sort((p, q) => (idx.get(p) ?? 0) - (idx.get(q) ?? 0));
      }
      const inner = mates ?? null;
      const n = inner ? inner.length : 0;
      for (let k = 0; k < (inner ? n : list.length - i - 1); k++) {
        const b = inner ? inner[k] : list[i + 1 + k];
        if (!b.alive) continue;
        const w = worstPairPen(a, b, i, inner ? (idx.get(b) ?? 0) : i + 1 + k);
        if (!w || w.pen <= PUSH_T) continue;
        // Center-to-center axis (see header): strictly grows body distance.
        let nx = w.nx, nz = w.nz;
        const ox = a.pos.x - b.pos.x, oz = a.pos.z - b.pos.z;
        const od2 = ox * ox + oz * oz;
        if (od2 >= 1e-8) { const od = Math.sqrt(od2); nx = ox / od; nz = oz / od; }
        // Damped and capped: each side takes a quarter of the penetration
        // per iteration, never more than PUSH_CAP per tick total — deep
        // overlaps converge geometrically instead of teleporting, and a
        // vetoed side never dumps its full share onto the other side
        // (that full transfer is the visible directional shove: one mob
        // shoved in the other's direction).
        let da = Math.min(w.pen / 4, PUSH_CAP - (spent.get(a) ?? 0));
        let db = Math.min(w.pen / 4, PUSH_CAP - (spent.get(b) ?? 0));
        if (da < 0) da = 0;
        if (db < 0) db = 0;
        if (!sepSpotFree(a, a.pos.x + nx * da, a.pos.z + nz * da)) { da = 0; db = Math.min(w.pen / 4, PUSH_CAP - (spent.get(b) ?? 0)); if (db < 0) db = 0; }
        if (!sepSpotFree(b, b.pos.x - nx * db, b.pos.z - nz * db)) {
          db = 0;
          if (da === 0) {
            // Double veto (wall sandwich): slide tangentially instead of
            // keeping the overlap — walls veto the axis, the tangent stays
            // inside the corridor. Deterministic side order, capped share.
            let ta = Math.min(w.pen / 4, PUSH_CAP - (spent.get(a) ?? 0));
            let tb = Math.min(w.pen / 4, PUSH_CAP - (spent.get(b) ?? 0));
            if (ta < 0) ta = 0;
            if (tb < 0) tb = 0;
            const tx = -nz, tz = nx;
            if (ta > 0 && sepSpotFree(a, a.pos.x + tx * ta, a.pos.z + tz * ta) &&
              sepSpotFree(b, b.pos.x - tx * tb, b.pos.z - tz * tb)) {
              da = ta; db = tb; nx = tx; nz = tz;
            } else if (ta > 0 && sepSpotFree(a, a.pos.x - tx * ta, a.pos.z - tz * ta) &&
              sepSpotFree(b, b.pos.x + tx * tb, b.pos.z + tz * tb)) {
              da = ta; db = tb; nx = -tx; nz = -tz;
            } else continue;
          }
        }
        a.pos.x += nx * da;
        a.pos.z += nz * da;
        b.pos.x -= nx * db;
        b.pos.z -= nz * db;
        if (da > 0) { spent.set(a, (spent.get(a) ?? 0) + da); a._pushed = true; }
        if (db > 0) { spent.set(b, (spent.get(b) ?? 0) + db); b._pushed = true; }
        if (da > 0 || db > 0) moved = true;
      }
    }
    if (!moved) break;
  }
}
