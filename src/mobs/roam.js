// Roam: directional locomotion for everything outside servo lanes (rooms,
// fields, pen, open ground). No positional servo anywhere here — only two
// decisions: a committed heading + validated stride target (R3/R4), or a
// gap override when the way is blocked (R5, shared scan in gaps.js).
// The single wall rule (R2) also lives here: latch a virtual follow line
// when a wall runs near along a lane, biasing the servo's lateral slide —
// the probes stay real, so branch visibility never degrades.
// Progress is one watchdog (R6, in the mover): no per-mode counters here.
// Three-free: physics come from step.js, the gap scan from gaps.js.
import {
  dirVec, snapCardinal, normYaw, yawDiff, rayDist, PROBE_DIST,
} from "./corridor.js";
import {
  makeCellFree, turnTo, moveClamped, driveToward, dropLane, strideTarget,
  fitsAt, TURN_RATE, VIRTUAL_W, NO_EXPIRY,
} from "./step.js";
import { noseOn } from "./collide.js";
import { scanGap } from "./gaps.js";

// Wall face within this engages following; the followed wall counts lost
// past it. Sessions are time-boxed so parades end.
export const FOLLOW_RANGE = 1.2;
export const LOST_TICKS = 15;
export const ARRIVE_D = 0.2;
export const FOLLOW_COOL = 2.0;
export const PASS_LAT = 0.8;
// Lateral pass band (m): a commit whose line carried the mob past the
// target within this reads as arrived — overshooting then U-turning back
// onto a stale point is the classic wobble. Covers the worst
// quantization offset (half cell diagonal ~0.71) with margin, so every
// free cruise arrives instead of timing out on a parallel line.
// Every latched decision (commit or wall ride) runs 2–8 s, then re-decides.
export const SPAN_MIN = 2;
export const SPAN_MAX = 8;
export function roamSpan(rand = Math.random) {
  return SPAN_MIN + rand() * (SPAN_MAX - SPAN_MIN);
}
// 8-wind compass for commit headings: cardinals plus diagonals, so roam
// walks oblique lines, not only right angles. Shuffled per decide;
// determinism comes from the injected rand.
export const WINDS8 = [
  0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4,
  Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4,
];

// Body fits at (x, z) in the caller's grounded dry context, nose included
// in mode A (the O-cycled unification): every decision then sees what the
// drive refuses, so wall approaches turn before the snout touches.
function bodyFits(mob, supported, floating, yaw, x, z) {
  return fitsAt(mob, supported, floating, yaw, noseOn(), x, z);
}

// Free body distance along a heading (voxel + footing + headroom).
function headingClearance(mob, supported, floating, h) {
  const dx = Math.sin(h), dz = Math.cos(h);
  const fit = (x, z) => !bodyFits(mob, supported, floating, h, x, z);
  return rayDist(mob.pos.x, mob.pos.z, dx, dz, fit, 3.0, 0.1);
}

// First candidate heading with body clearance (0.5 m), else the
// roomiest. Commits hug walls instead of demanding ballroom space, so
// mobs use the edges of small enclosures as well as the middle.
function openHeading(mob, supported, floating, cands, rand = Math.random) {
  let roomiest = null, roomiestD = -1;
  for (const h of cands) {
    const d = headingClearance(mob, supported, floating, h);
    if (d >= 0.5) return h;
    if (d > roomiestD || (d === roomiestD && rand() < 0.5)) { roomiest = h; roomiestD = d; }
  }
  return roomiestD > 0.3 ? roomiest : null;
}

function shuffled(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Latch a virtual follow lane: {axis, line, side} with the lane middle in
// world lateral coords (x for N/S axes, z for E/W) and side = ±1 toward
// the virtual wall. The wall face comes from cell-stepping (exact
// boundaries); drops count via the unified walkability like solids.
// session marks an exploration ride latched by decide (time-boxed, see
// endFollow); lines re-latched under an active lane are a pure lateral
// bias and live and die with the lane instead.
// Returns false when no wall runs near along axis.
function latchVirtual(mob, axis, sideDir, session) {
  const [ax] = dirVec(axis);
  const [sx, sz] = dirVec(sideDir);
  const latIsX = ax === 0;
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const cellFree = makeCellFree(mob);
  let face = null;
  for (let k = 1; k < 4; k++) {
    const bx = cx + sx * k, bz = cz + sz * k;
    if (!cellFree(bx, bz)) {
      face = sx !== 0 ? (sx > 0 ? bx : bx + 1) : (sz > 0 ? bz : bz + 1);
      break;
    }
  }
  if (face == null) return false;
  const posLat = latIsX ? mob.pos.x : mob.pos.z;
  const dirSign = latIsX ? sx : sz;
  if ((face - posLat) * dirSign > FOLLOW_RANGE + 0.05) return false;
  mob.followLine = { axis, line: face - dirSign * (VIRTUAL_W / 2), side: -dirSign };
  mob.followSession = session;
  mob.followT = 0;
  mob.followSpan = mob.followSpan ?? SPAN_MAX;
  mob.followLost = 0;
  return true;
}

// Erect for an axis when a wall runs near on some side (nearest wins,
// random tiebreak) and forward runs open. Never inside a true 1-wide
// corridor (both side mouths walled): there the cell-centre slide rules
// alone — latching a line there would ping-pong the lateral target with
// the both-real drop every tick. Pre-aligns the yaw.
function erectForAxis(mob, dt, axis, session, rand = Math.random) {
  const [ax, az] = dirVec(axis);
  if (!bodyFits(mob, true, false, axis,
      mob.pos.x + ax * PROBE_DIST, mob.pos.z + az * PROBE_DIST)) return false;
  const cellFree = makeCellFree(mob);
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  if (!cellFree(cx - az, cz + ax) && !cellFree(cx + az, cz - ax)) return false;
  const latA = normYaw(axis + Math.PI / 2), latB = normYaw(axis - Math.PI / 2);
  const order = shuffled([latA, latB], rand);
  let best = null;
  for (const sideDir of order) {
    const [dx, dz] = dirVec(sideDir);
    let dist = Infinity;
    for (let k = 1; k < 4; k++) {
      if (!cellFree(cx + dx * k, cz + dz * k)) { dist = k - 0.5; break; }
    }
    if (dist <= FOLLOW_RANGE && (!best || dist < best.dist)) best = { sideDir, dist };
  }
  if (!best) return false;
  if (!latchVirtual(mob, axis, best.sideDir, session)) return false;
  mob.yawTarget = axis;
  turnTo(mob, dt, TURN_RATE);
  return true;
}

// A finished follow session: drop everything and hold the next commit off
// the same wall (FOLLOW_COOL) so it turns away instead of re-latching.
function endFollow(mob) {
  mob.followLine = null;
  dropLane(mob);
  mob.followCool = FOLLOW_COOL;
  mob.followT = 0;
  mob.followLost = 0;
  mob.roam = null;
  mob.redecide = true;
}

// Follow-line upkeep (R2): the servo owns motion while a lane holds, this
// pass only maintains the lateral bias. Latches when a wall runs near,
// drops on axis turns, in true 1-wide corridors, past lost walls, and at
// the session span. Owned by the servo tick (called at its top): roam.js
// keeps the follow-line mechanics that decide shares, the servo owns the
// per-tick orchestration.
export function upkeepFollowLine(mob, dt) {
  mob.followCool = Math.max(0, (mob.followCool ?? 0) - dt);
  if (!mob.lane) return;
  if (mob.roam?.mode === "commit") mob.roam = null; // servo owns motion now
  const vw = mob.followLine;
  if (!vw) {
    // Guarded latch: wider-than-1 corridor with a wall near (aligned yaw).
    // erectForAxis itself refuses true 1-wide corridors (both mouths
    // walled); open field has no wall near. Runs at most once per lane
    // until dropped. Unmanaged bias: lives and dies with the lane.
    if ((mob.followCool ?? 0) <= 0 && yawDiff(mob.yaw, mob.lane.axis) < Math.PI / 4) {
      erectForAxis(mob, dt, mob.lane.axis, false);
    }
    return;
  }
  // Opposite headings share the corridor line: a U-turn flip keeps the
  // latched wall (same lateral, no re-erect churn). Anything else drops.
  const vwTurn = Math.abs(normYaw(vw.axis - mob.lane.axis));
  if (vwTurn > 1e-6 && vwTurn < Math.PI - 1e-6) {
    // Turned into something else: drop, re-latch when a wall runs near.
    mob.followLine = null;
    erectForAxis(mob, dt, mob.lane.axis, false);
    return;
  }
  // Both sides really walled: true 1-wide corridor, real servo owns it.
  const [ax, az] = dirVec(mob.lane.axis);
  const cellFree = makeCellFree(mob);
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  if (!cellFree(cx - az, cz + ax) && !cellFree(cx + az, cz - ax)) {
    mob.followLine = null;
    mob.followT = 0;
    return;
  }
  // Followed-side wall lost: count down, then release — session rides
  // only (decide-latched exploration). Under-lane biases skip the release:
  // they ride until the lane turns, narrows, or releases, the stale-line
  // guard in the servo slide tolerating the aftermath.
  // vw.side is ±1 toward the VIRTUAL wall in world lateral coords, so the
  // real wall reads along the negated side.
  const [wax] = dirVec(vw.axis);
  const sdx = wax === 0 ? -vw.side : 0;
  const sdz = wax === 0 ? 0 : -vw.side;
  const fitS = (x, z) => !fitsAt(mob, true, false, vw.axis, noseOn(), x, z);
  const d = rayDist(mob.pos.x, mob.pos.z, sdx, sdz, fitS, FOLLOW_RANGE + 0.05, 0.1);
  mob.followT = (mob.followT ?? 0) + dt;
  if (d > FOLLOW_RANGE) mob.followLost = (mob.followLost ?? 0) + 1;
  else mob.followLost = 0;
  if (mob.followSession && ((mob.followLost ?? 0) > LOST_TICKS || mob.followT > (mob.followSpan ?? SPAN_MAX))) {
    endFollow(mob);
  }
}

// Passed the latched target along the committed heading? (pos - target)
// projects ahead of the heading with a small lateral offset: the line did
// its job, re-decide fresh instead of spinning back onto the point.
function passedTarget(mob, r) {
  if (r.heading == null || !r.target) return false;
  const rx = mob.pos.x - r.target.x, rz = mob.pos.z - r.target.z;
  const sh = Math.sin(r.heading), ch = Math.cos(r.heading);
  if (rx * sh + rz * ch <= 0) return false;
  return Math.abs(rx * ch - rz * sh) < PASS_LAT;
}

// Decision + stepping when the servo owns nothing. Returns handled.
// blocked vetoes steps through other mobs (same gate as the wander
// fallback); forceHeading overrides the commit aim while a group plan
// holds (planned headings are already 8-wind snapped). Free commits
// cruise the latched heading open-loop, never the point.
export function roamStep(mob, dt, supported, floating, rand = Math.random, pickTarget, blocked = null, forceHeading = null) {
  if (mob.lane) return false;
  const r = mob.roam;
  const broken = r && r.mode && mob.target !== r.tgt;
  const arrived = r && r.mode === "commit" && mob.target &&
    (Math.hypot(r.target.x - mob.pos.x, r.target.z - mob.pos.z) < ARRIVE_D || passedTarget(mob, r));
  const expired = r && r.mode && mob.wanderT <= 0;
  const timedOut = r && r.mode && (r.t ?? 0) > (r.span ?? SPAN_MAX);
  if (!r || !r.mode || broken || arrived || expired || timedOut || !mob.target) {
    decide(mob, dt, supported, floating, rand, pickTarget);
    if (!mob.roam?.mode) return false;
  }
  // Commit step: cruise the latched heading open-loop, never the point.
  // Re-aiming at the point every tick makes the yaw chase micro-moves
  // (separation pushes, clamp slides, cell-center quantization) into orbit
  // wobbles, 180° overshoot spins, and late terminal nudges that read as
  // mid-slab turns — the heading is fixed, so the cruise walks straight
  // and arrival (or the pass band) catches the crossing. A forced plan
  // heading (evasion) overrides the cruise for the tick — the avoidance
  // keeps its immediate effect without the per-tick aim chase.
  const c = mob.roam;
  const makeCommit = () => {
    const base = (nx, nz) => fitsAt(mob, supported, floating, mob.yaw, true, nx, nz);
    return blocked ? (nx, nz) => base(nx, nz) && !blocked(nx, nz) : base;
  };
  driveToward(mob, dt,
    forceHeading ?? c.heading ?? Math.atan2(c.target.x - mob.pos.x, c.target.z - mob.pos.z),
    makeCommit, moveClamped);
  c.t = (c.t ?? 0) + dt;
  return true;
}

function latchCommit(mob, heading, target, rand = Math.random) {
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: roamSpan(rand) };
}

function decide(mob, dt, supported, floating, rand = Math.random, pickTarget) {
  mob.roam = null;
  const yaw = snapCardinal(mob.yaw);
  const [fx, fz] = dirVec(yaw);
  const fwdBlocked = !bodyFits(mob, supported, floating, yaw,
    mob.pos.x + fx * PROBE_DIST, mob.pos.z + fz * PROBE_DIST);
  // R5 gap override: heading blocked with a through hole ahead — steer to
  // it. The target is a validated stride past the gap, else the farm picker.
  if (fwdBlocked) {
    const gap = scanGap(mob, yaw)?.heading ?? null;
    if (gap != null) {
      const target = strideTarget(mob, gap, rand) ?? pickTarget(mob, rand);
      if (target) {
        latchCommit(mob, gap, target, rand);
        return;
      }
    }
  }
  // R2 wall ride: wall nearby and roughly parallel — latch a session line
  // and walk along it; the servo takes motion over on lane engage, the
  // session release turns away at the span so parades end.
  if (!fwdBlocked && (mob.followCool ?? 0) <= 0 && erectForAxis(mob, dt, yaw, true, rand)) {
    latchCommit(mob, yaw,
      { x: mob.pos.x + fx * 5, z: mob.pos.z + fz * 5 }, rand);
    return;
  }
  // R3/R4 commit: raw continuity heading first, then the shuffled 8-wind
  // — first with 0.5 m free wins. Free way ahead keeps the heading:
  // nothing here turns without an obstacle (gap, wall, and plan/stuck
  // maneuvers own their own turns elsewhere). When the winning heading
  // takes no stride (no ground along it), the siblings are tried in order
  // before the picker — the commit stays obstacle-driven instead of
  // random, and a null picker can never freeze the mob in place.
  const cands = [mob.yaw, ...shuffled(
    WINDS8.filter((dd) => yawDiff(dd, mob.yaw) > 1e-6), rand)];
  let heading = openHeading(mob, supported, floating, cands, rand);
  if (heading == null) return;
  let target = strideTarget(mob, heading, rand);
  if (!target) {
    for (const h of cands) {
      if (h === heading) continue;
      if (headingClearance(mob, supported, floating, h) < 0.5) continue;
      target = strideTarget(mob, h, rand);
      if (target) { heading = h; break; }
    }
  }
  target ??= pickTarget(mob, rand);
  if (!target) return;
  latchCommit(mob, heading, target, rand);
}
