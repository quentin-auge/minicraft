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
  makeStepOk, makeCellFree, turnTo, moveClamped, driveToward, dropLane, strideTarget,
  TURN_RATE, VIRTUAL_W, NO_EXPIRY,
} from "./step.js";
import { scanGap } from "./gaps.js";

// Wall face within this engages following; the followed wall counts lost
// past it. Sessions are time-boxed so parades end.
export const FOLLOW_RANGE = 1.2;
export const LOST_TICKS = 15;
export const ARRIVE_D = 0.6;
export const FOLLOW_COOL = 2.0;
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

// Body fits at (x, z) in the caller's grounded dry context.
function bodyFits(mob, supported, floating, yaw, x, z) {
  return makeStepOk(mob, supported, floating, 0, yaw, 0)(x, z);
}

// First candidate heading with 3+ blocks free, else the roomiest.
function openHeading(mob, supported, floating, cands, rand = Math.random) {
  let roomiest = null, roomiestD = -1;
  for (const h of cands) {
    const dx = Math.sin(h), dz = Math.cos(h);
    const fit = (x, z) => !bodyFits(mob, supported, floating, h, x, z);
    const d = rayDist(mob.pos.x, mob.pos.z, dx, dz, fit, 3.0, 0.1);
    if (d >= 2.9) return h;
    if (d > roomiestD || (d === roomiestD && rand() < 0.5)) { roomiest = h; roomiestD = d; }
  }
  return roomiestD > 0.5 ? roomiest : null;
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
  const fitS = (x, z) => !makeStepOk(mob, true, false, 0, vw.axis, 0)(x, z);
  const d = rayDist(mob.pos.x, mob.pos.z, sdx, sdz, fitS, FOLLOW_RANGE + 0.05, 0.1);
  mob.followT = (mob.followT ?? 0) + dt;
  if (d > FOLLOW_RANGE) mob.followLost = (mob.followLost ?? 0) + 1;
  else mob.followLost = 0;
  if (mob.followSession && ((mob.followLost ?? 0) > LOST_TICKS || mob.followT > (mob.followSpan ?? SPAN_MAX))) {
    endFollow(mob);
  }
}

// Decision + stepping when the servo owns nothing. Returns handled.
export function roamStep(mob, dt, supported, floating, rand = Math.random, pickTarget) {
  if (mob.lane) return false;
  const r = mob.roam;
  const broken = r && r.mode && mob.target !== r.tgt;
  const arrived = r && r.mode === "commit" && mob.target &&
    Math.hypot(r.target.x - mob.pos.x, r.target.z - mob.pos.z) < ARRIVE_D;
  const expired = r && r.mode && mob.wanderT <= 0;
  const timedOut = r && r.mode && (r.t ?? 0) > (r.span ?? SPAN_MAX);
  if (!r || !r.mode || broken || arrived || expired || timedOut || !mob.target) {
    decide(mob, dt, supported, floating, rand, pickTarget);
    if (!mob.roam?.mode) return false;
  }
  // Commit step toward the latched target.
  const c = mob.roam;
  const makeCommit = () => makeStepOk(mob, supported, floating, mob.nose.along, mob.yaw);
  driveToward(mob, dt,
    Math.atan2(c.target.x - mob.pos.x, c.target.z - mob.pos.z),
    makeCommit, moveClamped);
  c.t = (c.t ?? 0) + dt;
  return true;
}

// Same-heading run budget: chained commits within RUN_ALIGN of the
// previous one accumulate their spans; past RUN_MAX the next commit turns
// for real instead of chaining straight forever in the open. One rule
// (cumulative time) subsumes count- and time-based caps alike.
export const RUN_ALIGN = Math.PI / 6;
export const RUN_MAX = 8;

function latchCommit(mob, heading, target, rand = Math.random, prev = null) {
  // A continuing run accrues the previous span; anything else (arrival,
  // break, release, forced turn) restarts the budget.
  let runT = 0;
  if (prev && prev.heading != null && yawDiff(heading, prev.heading) < RUN_ALIGN) {
    runT = (prev.runT ?? 0) + (prev.t ?? 0);
  }
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: roamSpan(rand), runT };
}

function decide(mob, dt, supported, floating, rand = Math.random, pickTarget) {
  const prev = mob.roam;
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
      const target = strideTarget(mob, gap) ?? pickTarget(mob);
      if (target) {
        latchCommit(mob, gap, target, rand, prev);
        return;
      }
    }
  }
  // R2 wall ride: wall nearby and roughly parallel — latch a session line
  // and walk along it; the servo takes motion over on lane engage, the
  // session release turns away at the span so parades end.
  if (!fwdBlocked && (mob.followCool ?? 0) <= 0 && erectForAxis(mob, dt, yaw, true, rand)) {
    latchCommit(mob, yaw,
      { x: mob.pos.x + fx * 5, z: mob.pos.z + fz * 5 }, rand, prev);
    return;
  }
  // R3/R4 commit: current raw heading first (continuity bias, oblique
  // included), then the shuffled 8-wind — first with 3+ blocks free wins.
  // Past the run budget the commit turns for real (near-prev winds excluded)
  // instead of chaining straight.
  const cands = [mob.yaw, ...shuffled(
    WINDS8.filter((dd) => yawDiff(dd, mob.yaw) > 1e-6), rand)];
  const heading = openHeading(mob, supported, floating, cands, rand);
  if (heading == null) return;
  if (prev?.heading != null && yawDiff(heading, prev.heading) < RUN_ALIGN &&
      (prev.runT ?? 0) + (prev.t ?? 0) >= RUN_MAX) {
    const turned = openHeading(mob, supported, floating, shuffled(
      WINDS8.filter((dd) => yawDiff(dd, prev.heading) > RUN_ALIGN), rand), rand);
    if (turned != null) {
      const turnTarget = strideTarget(mob, turned) ?? pickTarget(mob);
      if (turnTarget) { latchCommit(mob, turned, turnTarget, rand); return; }
    }
  }
  const target = strideTarget(mob, heading) ?? pickTarget(mob);
  if (!target) return;
  latchCommit(mob, heading, target, rand, prev);
}
