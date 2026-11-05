// Farm-mob kinematics: the 1-wide corridor servo, stepping, falling, and
// separation. Three-free and headless-testable: positions are plain
// {x, y, z} writes, visuals are guarded behind `mob.root` (null headless).
// Shared step physics live in step.js (R0), the directional policy and
// the gap scan in corridor.js; farm.js owns the meshes, spawning,
// and lifecycle. Headless rigs drive this module on live voxels.
import { FARM_WALK_DIVISOR } from "./livestock.js";
import {
  PROBE_DIST, normYaw, yawDiff, dirVec, cellCenter, oppositeYaw, snapCardinal, snap8,
  CARDINALS, classifyExits, updateLane, laneTunneled,
  VIOLET_HOLD_D, ENTRY_COOL_T,
} from "./corridor.js";
import { entryTick } from "./entry.js";
import { queryMobGrid, buildMobGrid } from "./grid.js";
import {
  aabbIntersectsSolid, hasSupport,
  liquidSurface, footingOk, headroomOk,
  makeCellFree, makeStepOk, descendOk, turnTo,
  moveClamped, moveVector, driveToward, dropLane, spawnRng, stepVertical,
  SERVO_STEP, VIRTUAL_W, slideDeflect, segmentWalkable,
} from "./step.js";
import {
  upkeepFollowLine, roamStep, roamSpan, ARRIVE_D, FOLLOW_COOL,
  latchTouchWall, latchFlankTouch, measureWallTake, cornerTurn,
  sameWallFace, connectedTake, wallQuitHeading, wallQuitCommit, WALL_TURN_EXIT_P,
  exitTunnel, exitRideOut, tryGuidedErect, guidedDock, entryStallLatch,
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
// clearing every residue.
export const CROSS_BUDGET = 0.15;
// Comfort margin (m) added to the picker's blocked check: aim with room
// to spare since bodies keep moving after the pick. The step gate itself
// stays exact — it refuses only true overlaps.
export const PICK_COMFORT = 0.3;
// Prediction horizon: ~3 s at farm stride (~6 m). Long enough to
// sequence a pen crossing early, short enough that a latched roam heading
// stays roughly valid.
export const PREDICT_T = 3.0;
// Scratch buffers for grid queries (single-threaded, never reentrant:
// each call fully consumes its buffer before the next begins).
const _blockNear = [];
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
function followSlow(mob, peers, grid = null) {
  let slow = 1;
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  const rx = -Math.cos(mob.yaw), rz = Math.sin(mob.yaw);
  const list = grid ? queryMobGrid(grid, mob.pos.x, mob.pos.z, 3.0, _followNear) : peers;
  for (let k = 0; k < list.length; k++) {
    const o = list[k];
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const ox = o.pos.x - mob.pos.x, oz = o.pos.z - mob.pos.z;
    const d2 = ox * ox + oz * oz;
    if (d2 > 3.0 * 3.0 || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    if ((ox * fx + oz * fz) / d < 0.9) continue;
    if (Math.abs(ox * rx + oz * rz) > mob.hw + o.hw + SEP_GAP + 0.3) continue;
    const sameDir = Math.sin(mob.yaw) * Math.sin(o.yaw) + Math.cos(mob.yaw) * Math.cos(o.yaw);
    if (sameDir < 0.7) continue;
    if (mob.speed <= 1e-9) continue;
    slow = Math.min(slow, (o.speed ?? mob.speed) / mob.speed);
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

// Would mob m occupying (x, z) overlap any peer's body circles past the
// allowance? extra inflates m's own core half-width (comfort margin for
// picks); allow is the step-gate brush budget (GATE_ALLOW on real steps,
// 0 for exact detection). Pure: reads positions only.
export function mobBlockedAt(mob, x, z, y, peers, extra = 0, grid = null, allow = 0) {
  const sx = Math.sin(mob.yaw), sz = Math.cos(mob.yaw);
  // 3.5 m query covers the 3 m skip below (steps move cm per tick), so the
  // same peers are examined. Null grid = legacy scan.
  const list = grid ? queryMobGrid(grid, x, z, 3.5, _blockNear) : peers;
  for (const o of list) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - y) > SEP_Y) continue;
    const ox = o.pos.x - x, oz = o.pos.z - z;
    if (ox * ox + oz * oz > 3 * 3) continue;
    const w = worstPairPenAt(x, z, sx, sz, mob.hw + extra, mob.nose, mob.tail, o, 0, 0);
    // allow = 0 keeps the exact gate (any touch blocks); a brush
    // budget only ever lets shallower penetrations through.
    if (w != null && w.pen > allow) return true;
  }
  return false;
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
function centerPull(mob, dt, supported, floating, holdLine) {
  const [ax, az] = dirVec(mob.lane.axis);
  let ccx = cellCenter(mob.pos.x), ccz = cellCenter(mob.pos.z);
  const vw = mob.followLine;
  if (vw) {
    const dd = Math.abs(normYaw(vw.axis - mob.lane.axis));
    if (dd < 1e-6 || dd > Math.PI - 1e-6) {
      const near = (ax === 0 && Math.abs(mob.pos.x - vw.line) <= Math.abs(mob.pos.x - ccx)) ||
        (ax !== 0 && Math.abs(mob.pos.z - vw.line) <= Math.abs(mob.pos.z - ccz));
      // Same corridor line reads the same middle from either direction.
      // Freshly carried lines (touch latches, corner turns) bypass the
      // stale-line guard: the line is new and measured walkable, the body
      // just hasn't slid onto it yet — upkeep ticks the freshness down.
      if (!holdLine || near || (vw.fresh ?? 0) > 0) {
        if (ax === 0) ccx = vw.line; else ccz = vw.line;
      }
    }
  }
  const e = (ccx - mob.pos.x) * -az + (ccz - mob.pos.z) * ax;
  // Gentle exit rides converge instead of yanking: same line target, a
  // fraction of the stride per tick (see GENTLE_RATE in roam.js).
  const cap = mob.speed * dt * (vw?.gentle === true ? GENTLE_RATE : 0.9);
  const c = Math.max(-cap, Math.min(cap, e));
  if (Math.abs(c) <= 1e-4) return 0;
  const centerBase = makeStepOk(mob, supported, floating, 0, mob.lane.axis, 0);
  const axisOk = wrapStepOk(mob, (nx, nz) => centerBase(nx, nz) && descendOk(mob, nx, nz));
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
export function servoTick(mob, dt, supported, floating, rand = Math.random, pickTarget = null) {
  if (!supported || floating) { mob.lane = null; return false; }
  // R2 upkeep first: the latched line below biases this very tick's pull.
  upkeepFollowLine(mob, dt);
  // Pending guided slide: an entry commit riding its touch line erects the
  // hole-ward touch as soon as the nose meets the wall — no drop to a free
  // commit, no pivot toward the mouth.
  if (mob.lane && mob.roam?.entry) tryGuidedErect(mob, dt, supported, floating, rand);
  let sense = senseLane(mob);
  const pre = tryPreLane(mob, dt, supported, floating, sense, rand);
  if (pre === "touch") {
    // Contact latch erected the lane: sense again along it, virtual wall up.
    sense = senseLane(mob);
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
    // Exit rides never turn back: a backward quit heading keeps riding
    // instead (the wall-end outward quit handles the ending).
    const ex = mob.followLine.exitRide;
    if (ex != null && h != null) {
      const [hx, hz] = dirVec(h), [exx, exz] = dirVec(ex);
      if (hx * exx + hz * exz < -1e-9) h = null;
    }
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
      // Rail released at a tunnel mouth: 50/50 wall-follow vs free roam,
      // never back inside — unless an entry commit owns the mob (its
      // goal-directed walk survives over the exit draw). The exit runs
      // along the incoming travel (a junction arm points back into the
      // mouth complex — straightening it exits the tunnel instead of
      // shuttling its arms); engages with no incoming lane keep the arm.
      if (mob.roam?.entry) {
        // The stall may re-accrue from the new spot (the hole can be
        // latchable from there), so re-arm the directed touch.
        mob.roam.stallT = 0;
        mob.roam.latchTried = false;
        return false;
      }
      return exitTunnel(mob, prevAxis ?? res.lane.axis, sense, dt, supported, floating, rand, pickTarget);
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
    // Exit rides never turn back into the mouth: quit outward instead of
    // seeking the dead end (boxed falls back to the seek below).
    if (touchRide && exitRideOut(mob, rand)) return false;
    // Inner corner: the nose met the perpendicular arm of
    // the same wall — the phantom-masked side mouth reads shut, so the
    // classifier reports a dead end. Turn into the arm (same wall, same
    // relative side, blue stays on) instead of flipping; true dead ends
    // and pocket backs have no walkable arm and keep the seek below.
    const inner = touchRide ? innerTurn(mob, prevAxis) : null;
    if (inner == null) return seekDeadEnd(mob, dt, supported, floating);
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
    // Exit rides skip corner rounding (see followExit): a wall end quits
    // outward at the U-turn site below instead of hooking the mouth tip.
    let corner = sense.fwdOpen && mob.followLine?.exitRide == null ? cornerTurn(mob, prevAxis) : null;
      // Same wall only: corner rounding onto a disconnected wall (past
      // the tip, across open field) is a switch — refuse it and let the
      // in-place U-turn below keep the ride on its own wall instead.
      if (corner != null && !connectedTake(mob, prevAxis, corner.cell)) corner = null;
        if (corner != null) {
          // Outer-turn lottery: one time in five the ride exits straight on
          // the pre-turn axis instead of rounding (game only — pinned rigs
          // always round; commit failure rounds too). A guided slide never
          // lotteries out: rounding keeps it hole-ward.
          if (mob.pinWallRide !== true && mob.followLine.guideKey == null &&
              rand() < WALL_TURN_EXIT_P &&
              wallQuitCommit(mob, prevAxis, rand, pickTarget)) return false;
        const { axis, face, dirSign, sideDir } = corner;
        const rel = yawDiff(sideDir, normYaw(axis - Math.PI / 2)) < 1e-9 ? 1 : -1;
        mob.lane = { axis, entry: oppositeYaw(axis), lockX: cx, lockZ: cz };
        // Gentle rides stay gentle across the rounding (a full fresh here
        // would reintroduce mid-ride the yank the latch softened).
        const cornerGentle = mob.followLine.gentle === true;
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
        } else {
        // No solution with the way ahead open: U-turn in place and keep
        // the line (never drop) — the way back re-measures every tick, so
        // a face back in range turns the ride around again instead of
        // pacing or leaving. Exit rides never turn back: quit outward
        // instead (boxed falls back to the U-turn below).
        // The cell lock forces at least one cell of travel before the next
        // decision (no same-tick flip-flop).
        if (mob.followLine?.exitRide != null && exitRideOut(mob, rand)) return false;
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
        // Exit rides never turn back: quit outward first (boxed falls back
        // to the release below).
        if (!tunneledFor(res.event, mob.lane.axis)) {
          if (exitRideOut(mob, rand)) return false;
          dropLane(mob);
          mob.followCool = FOLLOW_COOL;
          return false;
        }
      }
    } else {
      // Same lottery on a measured turn take with open front: exit straight
      // one time in five instead of taking the turn. Guided slides skip it.
      if (mob.pinWallRide !== true && mob.followLine.guideKey == null &&
          sense.fwdOpen && yawDiff(keep.axis, prevAxis) > 1e-6 &&
          rand() < WALL_TURN_EXIT_P && wallQuitCommit(mob, prevAxis, rand, pickTarget)) return false;
      mob.lane = { axis: keep.axis, entry: oppositeYaw(keep.axis), lockX: cx, lockZ: cz };
      mob.followLine = keep.followLine;
    }
  }
  blendTurn(mob, dt, res);
  return cruiseLane(mob, dt, supported, floating, res, rand);
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
// latch in roamStep instead, reusing this same machinery hole-ward.
// Returns true/false when it handles the tick, "touch" when a contact latch
// erected the lane (sense again along it), undefined when a lane update
// is due.
function tryPreLane(mob, dt, supported, floating, sense, rand = Math.random) {
  if (mob.roam?.entry) return undefined;
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
// away-from-wall perpendicular comes first — and turn into the first
// walkable arm, carrying the line so the ride (and the blue) continues
// uninterrupted. Returns null for true dead ends and pocket backs (faces
// without a walkable arm), which keep the dead-end seek.
function innerTurn(mob, prevAxis) {
  const rel = mob.followLine.rel ?? 1;
  const order = [normYaw(prevAxis + rel * Math.PI / 2), normYaw(prevAxis - rel * Math.PI / 2)];
  for (const Q of order) {
    const check = normYaw(Q - rel * Math.PI / 2);
    const m = measureWallTake(mob, Q, check);
    if (!m) continue;
    // Same wall only: the arm must start at the old wall's tip — a nose
    // blocked by a stranger wall keeps the seek (U-turn) instead.
    if (!connectedTake(mob, prevAxis, m.cell)) continue;
    const [qx, qz] = dirVec(Q);
    const nx = mob.pos.x + qx * 1.0, nz = mob.pos.z + qz * 1.0;
    if (!makeStepOk(mob, true, false, 0, Q, 0)(nx, nz) || !descendOk(mob, nx, nz)) continue;
    const gentle = mob.followLine.gentle === true;
    return {
      axis: Q,
      followLine: {
        axis: Q, line: m.face - m.dirSign * (VIRTUAL_W / 2), side: -m.dirSign,
        rel, virtual: true, touch: true,
        fresh: gentle ? GENTLE_FRESH_TICKS : TURN_HOLD_TICKS, face: m.face,
        t: mob.followLine.t ?? 0, wallSpan: mob.followLine.wallSpan,
        exitRide: mob.followLine.exitRide,
        gentle,
      },
    };
  }
  return null;
}

// Forced exit choice on a touch ride: keep the same physical wall.
// Every open direction but the entry way is measured on the real wall
// (never the phantom-masked classifier votes) — straights first for
// smooth parades, then the away-from-wall perpendicular (inner arms keep
// the wall on the same side), then the toward-wall one. Each exit is
// measured from the current cell and from one cell ahead along it (an
// L-arm wall only shows past the corner). A kept exit must also be
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
  const walkable = (E) => {
    const [ex, ez] = dirVec(E);
    const nx = mob.pos.x + ex * PROBE_DIST, nz = mob.pos.z + ez * PROBE_DIST;
    return makeStepOk(mob, true, false, 0, E, 0)(nx, nz) && descendOk(mob, nx, nz);
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
    // Exit rides never turn at the mouth: straight out along the wall, and
    // the wall-end U-turn site below quits outward instead of rounding
    // the mouth tip into a hook.
    if (E !== prevAxis && mob.followLine?.exitRide != null) continue;
    const win = measure(E, null) ?? measure(E, ahead(E));
    if (!win || !walkable(E)) continue;
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
    const gentle = mob.followLine.gentle === true;
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
// guides, and exit marks. Freshness and geometry are re-measured per take.
function carriedRide(mob) {
  const vw = mob.followLine ?? {};
  return {
    t: vw.t ?? 0, wallSpan: vw.wallSpan,
    claimKey: vw.claimKey,
    guideKey: vw.guideKey, guideTx: vw.guideTx, guideTz: vw.guideTz,
    exitRide: vw.exitRide,
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
function seekDeadEnd(mob, dt, supported, floating) {
  const forward = mob.lane.entry; // pre-flip axis: updateLane already swapped
  // Recentre first (no corridor gate: a corner wedge is never a true
  // 1-wide cell, and that is exactly when the seek needs centring —
  // the axisOk probe below refuses any slide into a wall, and a stale
  // flipped follow line still pins the lateral via modulo-π).
  centerPull(mob, dt, supported, floating, true);
  // Dead-end seek refuses pit descents (see descendOk): the pit lip is
  // the end of the line — touch it, turn, leave.
  const makeSeek = () => {
    const sdriveBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
    const wrapped = wrapStepOk(mob, sdriveBase);
    return (nx, nz) => wrapped(nx, nz) && descendOk(mob, nx, nz);
  };
  const seek = driveToward(mob, dt, forward, makeSeek, moveVector, { rate: SERVO_TURN });
  if (seek.dist > 0) {
    // Still advancing: keep seeking with the forward axis restored.
    mob.lane = { axis: forward, entry: oppositeYaw(forward), lockX: -1, lockZ: -1 };
    mob.stuckT = 0;
    return true;
  }
  // Nose contact: keep the flipped lane, rotate in place below.
  mob.yawTarget = mob.lane.axis;
  turnTo(mob, dt, SERVO_TURN);
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
    if (res.event === "junction") { mob.blendFrom = mob.yaw; mob.blendT = 0; }
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

// Corridor cruise: locked-yaw drive with the lateral centre slide, plus
// the stall guard (a latched lane that cannot advance — nose wedged where
// the body fits — releases to the wander instead of freezing in place; a
// successful 1-wide recentre counts as progress, not a stall).
function cruiseLane(mob, dt, supported, floating, res, rand = Math.random) {
  // Cruise never descends into a pit (see descendOk): ramps with a
  // walkable continuation pass through, local minima read as walls. The
  // probe below captures the pre-turn facing exactly like the inline drive
  // did; the move itself runs post-turn.
  const cruiseBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
  const cruiseOk = wrapStepOk(mob, cruiseBase);
  const { err, dist } = driveToward(mob, dt, mob.yawTarget, () => {
    return (nx, nz) => cruiseOk(nx, nz) && descendOk(mob, nx, nz);
  }, moveVector, { rate: SERVO_TURN });
  // Lateral centering on straights: yaw stays locked on the corridor
  // axis (no hunting), the body slides toward the lane middle when free —
  // the cell centre in a true 1-wide corridor, the virtual-lane middle
  // while wall-following. Turns and seeks centre through centerPull above.
  const recentered = res.event === "cruise"
    ? 0
    : centerPull(mob, dt, supported, floating, true);
  if (dist === 0 && recentered === 0 && err < SERVO_SPIN) mob.servoStall = (mob.servoStall ?? 0) + dt;
  else mob.servoStall = 0;
  // A fully stalled lane (wedged nose, refused slide, aligned yaw) always
  // releases — touch rides included: nose contact leads body contact by a
  // few ticks, so genuine dead ends and inner corners U-turn long before
  // the 0.75 s trip, while a lock-held grind would otherwise freeze
  // forever. The in-place U-turn pace keeps moving, so it never trips it.
  if (mob.servoStall > 0.75) {
    if (mob.followLine?.touch === true && mob.lane) {
      // A guided (violet) ride never U-turns in place: release to the
      // direct entry walk (re-armed — dock, stall latch, or hold take it
      // from the new spot).
      if (guidedActive(mob)) {
        mob.servoStall = 0;
        mob.roam.stallT = 0;
        mob.roam.latchTried = false;
        dropFollowLine(mob);
        dropLane(mob);
        mob.followCool = FOLLOW_COOL;
        return false;
      }
      // Stalled touch ride: U-turn in place and keep the line (never
      // drop) — same rule as the no-solution U-turn above. Exit rides
      // never turn back: quit outward instead (boxed keeps the U-turn).
      if (mob.followLine.exitRide != null && exitRideOut(mob, rand)) return false;
      mob.lane = { axis: oppositeYaw(mob.lane.axis), entry: mob.lane.axis, lockX: -1, lockZ: -1 };
      mob.servoStall = 0;
      mob.stuckT = 0;
      return true;
    }
    mob.lane = null; mob.servoStall = 0; mob.followCool = FOLLOW_COOL;
    mob.turnHold = 0;
    // A released entry re-arms its directed touch from the new spot.
    if (mob.roam?.entry) { mob.roam.stallT = 0; mob.roam.latchTried = false; }
    return false;
  }
  if (res.event === "cruise") centerPull(mob, dt, supported, floating, false);
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
  // would steal its target) and peer steering stands down (entries are
  // short precise maneuvers; the backstop still separates).
  mob.entryScanT = Math.max(0, (mob.entryScanT ?? 0) - dt);
  mob.entryCoolT = Math.max(0, (mob.entryCoolT ?? 0) - dt);
  const entryHold = supported && !floating ? entryTick(mob, dt, rand, { supported, floating, pickTarget }) : false;
  const peersEff = entryHold ? null : peers;
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
      if (stepped < mob.speed * dt * 0.2) mob.stuckT += dt;
      else { mob.stuckT = 0; }
      // Solo legacy path (peers == null: headless rigs, registry ticks):
      // stillness-only re-pick, bit-identical draw stream to before the
      // cooperation port. The watchdog + maneuvers below own the peer
      // path only, so existing pinned seeds never shift.
      if (peers == null) {
        if (mob.stuckT >= STUCK_T) {
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
      if (mob.stuckT >= STUCK_T || progStuck) {
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
  // so meets never judder. Lane mobs and entries run legacy full speed.
  // Mob bodies count as obstacles for lane-less stepping (same Y level
  // only): a refused step stops at contact range instead of overlapping
  // past the brush budget, and the stuck re-pick below routes around true
  // blockers. Picks and detection stay exact; only real steps may brush.
  const blockedByMob = peersEff && !mob.lane
    ? (nx, nz) => mobBlockedAt(mob, nx, nz, mob.pos.y, peersEff, 0, grid, CROSS_BUDGET)
    : null;
  // Group plan (forecast.js, latched): a forced heading overrides the
  // commit target while the hold lasts — except on a committed detour,
  // which flies its own validated line open-loop instead: re-aiming the
  // point every tick would wobble the escape. Null plan (or lane motion)
  // keeps legacy behavior; lanes never take a heading override.
  const plan = peersEff && !mob.lane && mob._plan?.forced ? mob._plan : null;
  const cruise = mob._detour && !plan && mob.roam?.heading != null ? mob.roam.heading : null;
  // Line rebase (forecast.js flagged the stand-down): the sidestep episode
  // adopted a parallel line — move the goal onto it instead of swinging
  // back onto the old line. Validated end-to-end (falls back to the old
  // goal if the new parallel doesn't walk); commit identity kept so the
  // stride survives (tgt follows target). Free roam commits only: entries
  // fly claimed slots, detours fly validated lines, lanes fly rails.
  if (mob._rebase && !mob.lane && !mob._detour && mob.roam && !mob.roam.entry && mob.target) {
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
  let slow = plan ? plan.slow : 1;
  // File discipline: match a same-direction peer's pace ahead in the
  // corridor instead of tailgating into it — the file walks parallel at
  // constant spacing instead of grinding. Slow-only, lane-less only.
  if (peersEff && !mob.lane) slow = Math.min(slow, followSlow(mob, peersEff, grid));
  let savedSpeed = 0;
  if (slow !== 1) { savedSpeed = mob.speed; mob.speed *= slow; }
  const servoed = servoTick(mob, dt, supported, floating, rand, pickTarget);
  let roamed = false;
  if (!servoed && supported && !floating) {
    roamed = roamStep(mob, dt, supported, floating, rand, pickTarget, blockedByMob,
      plan ? plan.heading : cruise);
  }
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
      makeWander, moveClamped, { gated: false });
  }
  // One-tick plan: consumed above (roam or wander) or ignored (servo) —
  // never carried over, the planner re-runs (and re-latches holds) every
  // tick off live positions. Sub-slices share it; only the outer tick
  // clears it.
  if (_top) mob._plan = null;
  if (savedSpeed) mob.speed = savedSpeed;
  // Displacement-mode flags for the ?color=1 tint (farm.js paints,
  // headless rigs assert): derived every tick, never branched on by
  // steering. A touch ride on a lane follows a wall (blue), a lane
  // alone runs a true 1-wide corridor (red), an entry commit passes a
  // tunnel mouth (purple, reads over both while it runs) and the tint
  // holds until the mob walks clear of the aimed slot past arrival
  // (VIOLET_HOLD_D), then re-arms attraction only after ENTRY_COOL_T.
  let holdViolet = false;
  if (mob.tunnelHoldX != null && mob.tunnelHoldZ != null) {
    const hd = Math.hypot(mob.pos.x - mob.tunnelHoldX, mob.pos.z - mob.tunnelHoldZ);
    if (hd <= VIOLET_HOLD_D) holdViolet = true;
    else {
      mob.tunnelHoldX = null; mob.tunnelHoldZ = null;
      mob.entryCoolT = ENTRY_COOL_T;
    }
  }
  mob.wallFollow = mob.followLine?.touch === true && mob.lane != null;
  mob.oneWide = mob.lane != null && mob.followLine?.touch !== true;
  mob.tunnelPass = mob.roam?.entry === true || holdViolet;
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
// the veto still parks heads out of walls. A vetoed side stays put and
// the other side takes the damped correction; both vetoed keeps the
// overlap for this tick (rare — wall sandwich — and retried next tick).
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
        if (!sepSpotFree(a, a.pos.x + w.nx * da, a.pos.z + w.nz * da)) { da = 0; db = Math.min(w.pen / 4, PUSH_CAP - (spent.get(b) ?? 0)); if (db < 0) db = 0; }
        if (!sepSpotFree(b, b.pos.x - w.nx * db, b.pos.z - w.nz * db)) {
          db = 0;
          if (da === 0) continue;
        }
        a.pos.x += w.nx * da;
        a.pos.z += w.nz * da;
        b.pos.x -= w.nx * db;
        b.pos.z -= w.nz * db;
        if (da > 0) spent.set(a, (spent.get(a) ?? 0) + da);
        if (db > 0) spent.set(b, (spent.get(b) ?? 0) + db);
        if (da > 0 || db > 0) moved = true;
      }
    }
    if (!moved) break;
  }
}
