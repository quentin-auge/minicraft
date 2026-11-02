// Roam: directional locomotion for everything outside servo lanes (rooms,
// fields, pen, open ground). No positional servo anywhere here — only two
// decisions: a committed heading + validated stride target (R3/R4), or a
// gap override when the way is blocked (R5, shared scan in corridor.js).
// The wall rule also lives here: contact latches a permanent virtual
// touch line (100% frontal or flank graze), biasing the servo's lateral
// slide — the probes stay real, so branch visibility never degrades.
// A touch ride never leaves its wall for open roam: same wall end to end,
// inner and outer corners taken, true ends U-turned in place; only a
// genuinely continuing 1-wide corridor hands over to the rail.
// Progress is one watchdog (R6, in the mover): no per-mode counters here.
// Three-free: physics come from step.js, the gap scan from corridor.js.
import {
  dirVec, snapCardinal, normYaw, yawDiff, rayDist, PROBE_DIST, scanGap,
} from "./corridor.js";
import {
  makeStepOk, makeCellFree, turnTo, moveClamped, driveToward, strideTarget,
  TURN_RATE, VIRTUAL_W, NO_EXPIRY,
} from "./step.js";

// Wall face within this engages following.
// Touch rides never expire — only the servo releases them (corner
// rounding, in-place U-turn, pocket pace, 1-wide handover).
export const FOLLOW_RANGE = 1.2;
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

// Exact wall-face measurement along a cardinal: cell-stepping (integer
// boundaries, never a fit), unified solid/air-wall predicate. Returns
// {face, dirSign, cell} (face in world lateral coords, dirSign = ±1 toward
// the wall, cell = first solid cell) or null when no wall runs within
// range. origin overrides the measuring point (corner lookahead); cells
// stay absolute. The cell lets touch-ride re-decisions check same-wall
// continuity (see sameWallFace/connectedTake) instead of latching whatever
// wall stands near.
export function measureWallTake(mob, axis, sideDir, origin = null, range = FOLLOW_RANGE + 0.05) {
  const [ax] = dirVec(axis);
  const [sx, sz] = dirVec(sideDir);
  const latIsX = ax === 0;
  const ox = origin ? origin.x : mob.pos.x, oz = origin ? origin.z : mob.pos.z;
  const cx = Math.floor(ox), cz = Math.floor(oz);
  const cellFree = makeCellFree(mob);
  for (let k = 1; k < 4; k++) {
    const bx = cx + sx * k, bz = cz + sz * k;
    if (!cellFree(bx, bz)) {
      const face = sx !== 0 ? (sx > 0 ? bx : bx + 1) : (sz > 0 ? bz : bz + 1);
      const posLat = latIsX ? ox : oz;
      const dirSign = latIsX ? sx : sz;
      if ((face - posLat) * dirSign > range) return null;
      return { face, dirSign, cell: { x: bx, z: bz } };
    }
  }
  return null;
}

// Latch a virtual follow lane: {axis, line, side, rel, virtual, face} with
// the lane middle at the adjacent cell centre (0.5 from the face) and
// side = ±1 toward the invisible complementary wall. face records the
// followed physical face plane (world lateral coord) so ride re-decisions
// keep the same wall (see sameWallFace/connectedTake below). rel records
// the physical side (+1 wall on the left of travel, -1 on the right) so
// junction choices keep the same wall. Only contact latches (frontal or
// flank): every line is a touch ride, and only the servo releases it.
// Returns false when no wall runs near along axis, or when the mob stands
// in a true 1-wide corridor (both side mouths walled): the corridor rail
// owns it alone — latching a line there would ping-pong the lateral
// target with the real centre slide and hijack junction draws.
function latchVirtual(mob, axis, sideDir, range = FOLLOW_RANGE + 0.05) {
  const m = measureWallTake(mob, axis, sideDir, null, range);
  if (!m) return false;
  const [lax, laz] = dirVec(axis);
  const cellFree = makeCellFree(mob);
  const lcx = Math.floor(mob.pos.x), lcz = Math.floor(mob.pos.z);
  if (!cellFree(lcx - laz, lcz + lax) && !cellFree(lcx + laz, lcz - lax)) return false;
  const rel = yawDiff(sideDir, normYaw(axis - Math.PI / 2)) < 1e-9 ? 1 : -1;
  mob.followLine = {
    axis, line: m.face - m.dirSign * (VIRTUAL_W / 2), side: -m.dirSign,
    rel, virtual: true, face: m.face,
  };
  return true;
}

// Freshly latched touch lines pull the body onto the line for this many
// ticks, bypassing the slide's stale-line guard: contact latches from up
// to 1.25 away while the body is still turning in, and without the bypass
// the slide would drag toward the cell centre (away from the wall) until
// the ride starves and drops. Same window as the corner turn hold.
export const LATCH_FRESH_TICKS = 30;
// Head-on tolerance: at or below this gap between the mob's heading and
// the wall normal the touch counts as straight-on (90°) and draws lots;
// past it the touch counts as oblique (<90°) and keeps its direction.
// One place to tune both behaviours.
export const HEADON_TOL = 0.26; // ~15 degrees
// Touch latch (100%, no random on the latch itself): the way ahead is
// blocked and the contacted wall is latched as a virtual corridor.
// axisProbe is the snapped facing (into the wall); the lane runs along
// one of its two parallels, on the contacted side. Straight-on touches
// (heading within HEADON_TOL of the wall normal) draw lots 50/50 between
// the two parallels — even with a target to one side; oblique touches
// keep their direction (target side first, else the current sense).
// Deterministic per rand stream: same seed, same side. Pre-aligns the
// yaw. Returns the lane axis or null (stub end, graze past reach — the
// caller declines to roam).
export function latchTouchWall(mob, dt, axisProbe, targetHeading = null, rand = Math.random) {
  const opts = [normYaw(axisProbe + Math.PI / 2), normYaw(axisProbe - Math.PI / 2)];
  let axis;
  if (yawDiff(mob.yaw, axisProbe) <= HEADON_TOL) {
    axis = rand() < 0.5 ? opts[0] : opts[1];
  } else if (targetHeading != null) {
    axis = yawDiff(targetHeading, opts[1]) < yawDiff(targetHeading, opts[0]) ? opts[1] : opts[0];
  } else {
    axis = yawDiff(mob.yaw, opts[1]) < yawDiff(mob.yaw, opts[0]) - 1e-9 ? opts[1] : opts[0];
  }
  if (!latchVirtual(mob, axis, axisProbe)) {
    const other = axis === opts[0] ? opts[1] : opts[0];
    if (!latchVirtual(mob, other, axisProbe)) return null;
    axis = other;
  }
  // Touch rides (and only they) get forced junction exits + corner
  // rounding in the servo: without forced exits a ride would orbit its
  // wall instead of taking arms and rounding tips.
  // Fresh line: pull the body onto it while turning in (see above).
  mob.followLine.touch = true;
  mob.followLine.fresh = LATCH_FRESH_TICKS;
  mob.yawTarget = axis;
  turnTo(mob, dt, TURN_RATE);
  return axis;
}

// Flank touch: walking along an axis with a wall rubbing the flank
// (face within half a block) latches the same permanent touch ride as a
// frontal hit, on the current axis — no direction choice, the mob simply
// keeps going, now glued. Returns the lane axis or null (no wall rubbing
// either flank). Deterministic: the nearer flank wins, ties keep the
// current sense.
export const FLANK_TOUCH_D = 0.55;
export function latchFlankTouch(mob, dt, axis) {
  const latA = normYaw(axis + Math.PI / 2), latB = normYaw(axis - Math.PI / 2);
  const ma = measureWallTake(mob, axis, latA, null, FLANK_TOUCH_D + 0.05);
  const mb = measureWallTake(mob, axis, latB, null, FLANK_TOUCH_D + 0.05);
  if (!ma && !mb) return null;
  // Nearest face wins; ties keep the flank the mob already leans toward.
  const [ax] = dirVec(axis);
  const latIsX = ax === 0;
  const posLat = latIsX ? mob.pos.x : mob.pos.z;
  const gap = (m) => Math.abs(m.face - posLat);
  let sideDir = null;
  if (ma && mb) {
    const ga = gap(ma), gb = gap(mb);
    if (Math.abs(ga - gb) < 1e-9) {
      // Tie: keep the wall on the current sense side — the flank the mob
      // already leans toward stays the followed one.
      const leanA = yawDiff(mob.yaw, latA), leanB = yawDiff(mob.yaw, latB);
      sideDir = leanA < leanB ? latA : latB;
    } else sideDir = ga < gb ? latA : latB;
  } else sideDir = ma ? latA : latB;
  if (!latchVirtual(mob, axis, sideDir, FLANK_TOUCH_D + 0.05)) return null;
  mob.followLine.touch = true;
  mob.followLine.fresh = LATCH_FRESH_TICKS;
  mob.yawTarget = axis;
  turnTo(mob, dt, TURN_RATE);
  return axis;
}

// Corner rounding at a wall end: the ride found no keeping exit but the
// way ahead is open — look one cell ahead for a perpendicular face
// starting on either side (outer corners switch sides first) and head
// into it; the usual touch/upkeep paths latch the new face once
// alongside. Returns the rounding heading plus its face measurement and
// first solid cell (so callers can carry the follow line onto it and
// check same-wall continuity) or null (plain release).
export function cornerTurn(mob, prevAxis) {
  const rel = mob.followLine?.rel ?? 1;
  const [fx, fz] = dirVec(prevAxis);
  const ax = mob.pos.x + fx * 1.0, az = mob.pos.z + fz * 1.0;
  const perps = [normYaw(prevAxis + Math.PI / 2), normYaw(prevAxis - Math.PI / 2)];
  if (rel > 0) perps.reverse(); // wall was left → new face likelier right, and vice versa
  for (const Q of perps) {
    const [qx, qz] = dirVec(Q);
    for (const s of [1, -1]) {
      const sideDir = normYaw(Q + s * Math.PI / 2);
      // Extended reach: the face only shows past the tip, just outside
      // latch range — the commit walks the mob into latch range.
      const m = measureWallTake(mob, Q, sideDir, { x: ax + qx * 1.0, z: az + qz * 1.0 }, 1.75);
      if (m) return { axis: Q, face: m.face, dirSign: m.dirSign, sideDir, cell: m.cell };
    }
  }
  return null;
}

// Same-wall continuity for touch rides: a ride never switches walls.
// Straights keep the same face plane (a hole shares the plane, so doors
// and breaches ride through; a parallel face further out is another
// wall). Perpendicular takes (turns, corner roundings) must start where
// the old wall ends: touching it (Chebyshev ≤ 1 — inner corners, tips,
// steps), or continuing straight past at most a 1-cell slit on the same
// travel line (setback). Anything lateral or diagonal past that is
// another wall. Refused takes fall back to the in-place U-turn, never to
// a stranger wall.
export const WALL_TAKE_DIST = 2;
export function sameWallFace(mob, m) {
  const f = mob.followLine?.face;
  return f == null || m.face === f;
}
export function connectedTake(mob, travelAxis, cell) {
  const vw = mob.followLine;
  if (vw?.face == null || vw.side == null) return true; // un-faced line: old behaviour
  const tip = wallTip(mob, travelAxis);
  if (!tip) return false;
  const dx = Math.abs(cell.x - tip.x), dz = Math.abs(cell.z - tip.z);
  if (Math.max(dx, dz) <= 1) return true;
  const [tx] = dirVec(travelAxis);
  const axial = tx !== 0 ? dz === 0 : dx === 0;
  return axial && Math.max(dx, dz) <= WALL_TAKE_DIST;
}
// Last solid cell of the followed wall along travel: back up from the mob
// (it may stand past the tip) to the nearest wall-row cell, then forward
// to the last solid one. Null when the row shows no wall (mined away).
function wallTip(mob, travelAxis) {
  const vw = mob.followLine;
  const turn = Math.abs(normYaw(vw.axis - travelAxis));
  if (turn > 1e-6 && turn < Math.PI - 1e-6) return null; // not parallel: no tip
  // side is ±1 toward the virtual wall in world lateral coords (latch and
  // travel share the world lateral axis while parallel), so -side points
  // at the real wall's cell row.
  const s = -vw.side;
  const F = vw.face;
  const [tx] = dirVec(travelAxis);
  const travelIsX = tx !== 0;
  // Signed unit step along travel (lane axes are cardinal): backing up
  // is -k along it whatever the compass direction — an unsigned scan
  // walks forward for west/south travel and plants the tip behind the mob.
  const [ux, uz] = dirVec(travelAxis);
  const rowLat = s > 0 ? Math.floor(F) : Math.ceil(F) - 1;
  // The face must still exist at the tip cell: the neighbour on the
  // mob's side stays open. Past a corridor mouth the bank runs on but
  // the face is gone — without this the tip sails past the mouth and
  // connected takes diverge between open and walled geometries.
  const mobLat = s > 0 ? F - 1 : F;
  const cellFree = makeCellFree(mob);
  const mcx = Math.floor(mob.pos.x), mcz = Math.floor(mob.pos.z);
  const solidAt = (k) => {
    const bx = travelIsX ? mcx + ux * k : rowLat;
    const bz = travelIsX ? rowLat : mcz + uz * k;
    if (cellFree(bx, bz)) return false;
    const mx = travelIsX ? mcx + ux * k : mobLat;
    const mz = travelIsX ? mobLat : mcz + uz * k;
    return cellFree(mx, mz);
  };
  let anchor = null;
  for (let k = 0; k >= -6; k--) {
    if (solidAt(k)) { anchor = k; break; }
  }
  if (anchor == null) return null;
  let tip = anchor;
  for (let k = anchor + 1; k <= anchor + 8; k++) {
    if (!solidAt(k)) break;
    tip = k;
  }
  return {
    x: travelIsX ? mcx + ux * tip : rowLat,
    z: travelIsX ? rowLat : mcz + uz * tip,
  };
}

// Follow-line upkeep: the servo owns motion while a lane holds, this
// pass only maintains the lateral bias. Latches when a wall runs near,
// drops on axis turns, hands true 1-wide corridors to the rail, and drops
// past lost walls. Touch rides are permanent: the servo owns their release
// (corner rounding, in-place U-turn, pocket pace) — this pass only mirrors
// the line on U-turn flips, ticks the corner freshness down, and hands
// over where a corridor genuinely continues. Owned by the servo tick
// (called at its top): roam.js keeps the follow-line mechanics that decide
// shares, the servo owns the per-tick orchestration.
export function upkeepFollowLine(mob, dt) {
  mob.followCool = Math.max(0, (mob.followCool ?? 0) - dt);
  if (!mob.lane) return;
  if (mob.roam?.mode === "commit") mob.roam = null; // servo owns motion now
  const vw = mob.followLine;
  if (!vw) return;
  // Opposite headings share the corridor line: a U-turn flip keeps the
  // latched wall (same lateral, no re-erect churn) — realign the latch on
  // the flipped axis and mirror the relative side (the wall that was left
  // is now right). Anything else drops.
  const vwTurn = Math.abs(normYaw(vw.axis - mob.lane.axis));
  if (vwTurn > Math.PI - 1e-6) {
    vw.axis = mob.lane.axis;
    vw.rel = -(vw.rel ?? 1);
  } else if (vwTurn > 1e-6) {
    // Turned into something else (a stall dropped the lane and the
    // classifier re-engaged elsewhere): drop with a cooldown holding the
    // next latch off, so the mob walks clear instead of re-latching a
    // stranger. New walls only ever latch from open motion.
    mob.followLine = null;
    mob.followCool = FOLLOW_COOL;
    return;
  }
  // Touch rides are permanent: the servo owns their release (corner
  // rounding, pocket pace). Only mirror the line on U-turn flips and tick
  // the corner freshness down. Every line is a touch line (contact is the
  // only latch left), so no other case remains below.
  // Both sides really walled hands over to the 1-wide rail — unless the
  // corridor doesn't continue (a 1-cell slit is still the wall ride, and
  // dropping there strands the exit on a random draw instead of the wall).
  if ((vw.fresh ?? 0) > 0) vw.fresh--;
  const [bax, baz] = dirVec(mob.lane.axis); const cellFree = makeCellFree(mob);
  const bcx = Math.floor(mob.pos.x), bcz = Math.floor(mob.pos.z);
  if (!cellFree(bcx - baz, bcz + bax) && !cellFree(bcx + baz, bcz - bax)) {
    const nx = Math.floor(mob.pos.x + bax), nz = Math.floor(mob.pos.z + baz);
    if (!cellFree(nx - baz, nz + bax) && !cellFree(nx + baz, nz - bax)) {
      mob.followLine = null;
    }
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
  // Open commit: current raw heading first (continuity bias, oblique
  // included), then the shuffled 8-wind — first with 3+ blocks free wins.
  // Walls never latch here: contact alone (frontal or flank graze) enters
  // wall-following through the servo, so open roam stays open.
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
