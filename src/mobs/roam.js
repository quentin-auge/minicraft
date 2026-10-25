// Roam: directional locomotion for everything that isn't a 1-wide
// corridor (lanes, rooms, fields, pen). No positional servo anywhere here
// — only heading/target decisions (commit to a direction, follow a wall
// via a virtual lane, steer to gaps), executed by the mover's stepper.
// The 1-path servo owns any tick with a lane; roam owns the rest.
// Three-free: physics arrive via api (no mover import, no cycle).
import {
  dirVec, snapCardinal, normYaw, yawDiff, rayDist, PROBE_DIST,
} from "./corridor.js";

// Wall face within this engages following; the followed wall counts lost
// past it. Sessions are time-boxed so parades end (re-decide varies them).
export const FOLLOW_RANGE = 1.2;
export const LOST_TICKS = 15;
export const ARRIVE_D = 0.6;
export const ROAM_TURN = 3;
export const ROAM_SPIN = 1.2;
export const FOLLOW_P = 0.65;
export const FOLLOW_COOL = 2.0;
// No-lane hold after a follow session that never engaged a lane: shorter
// than FOLLOW_COOL, since there is no wall to re-latch against yet.
export const NOLANE_COOL = 1.5;
// Same-heading persistence cap: consecutive latched decisions within this
// angle count up (plus their time); past the count or time budget the next
// commit turns for real instead of chaining straight forever in the open.
export const ALIGN_D = Math.PI / 6;
export const ALIGN_N = 2;
export const ALIGN_T = 8;
// Every latched decision (commit or follow) runs 2–8 s, then re-decides.
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
// Gap tiebreak: forward blocked with a bounded hole this wide at ±45°.
const GAP_DISTS = [1.0, 1.6];
const GAP_LAT = 2.5;
const GAP_STEP = 0.25;
const GAP_MINW = 0.5;

// Body fits at (x, z) through api (grounded dry context of the caller).
function bodyFits(api, mob, supported, floating, yaw, x, z) {
  return api.makeStepOk(mob, supported, floating, 0, yaw, 0)(x, z);
}

// Highest blocked-neighbour scan for a door-like gap: widest bounded run
// of body-fit points, or null. Bounded both flanks (a true hole, never an
// open edge). No line state: the commit heading just points at the middle.
function scanGap(api, mob, supported, floating, axisYaw) {
  const [fx, fz] = dirVec(axisYaw);
  const latx = -fz, latz = fx;
  const at = (dist, o) => !api.makeStepOk(mob, supported, floating, 0, axisYaw, 0)(
    mob.pos.x + fx * dist + latx * o, mob.pos.z + fz * dist + latz * o);
  let best = null;
  for (const dist of GAP_DISTS) {
    let runStart = null, prev = 0;
    const close = () => {
      if (runStart == null) return;
      const width = prev - runStart + GAP_STEP;
      const boundedL = runStart > -GAP_LAT + 1e-9 || at(dist, runStart - GAP_STEP);
      const boundedR = prev < GAP_LAT - 1e-9 || at(dist, prev + GAP_STEP);
      const center = (runStart + prev) / 2;
      if (width >= GAP_MINW && boundedL && boundedR &&
          (!best || width > best.width ||
            (width === best.width && Math.abs(center) < Math.abs(best.center)))) {
        best = { width, center };
      }
      runStart = null;
    };
    for (let o = -GAP_LAT; o <= GAP_LAT + 1e-9; o += GAP_STEP) {
      if (!at(dist, o)) { if (runStart == null) runStart = o; prev = o; }
      else close();
    }
    close();
    if (best) {
      const gx = mob.pos.x + fx * (dist + 1.0) + latx * best.center;
      const gz = mob.pos.z + fz * (dist + 1.0) + latz * best.center;
      return Math.atan2(gx - mob.pos.x, gz - mob.pos.z);
    }
  }
  return null;
}

// First candidate heading with 3+ blocks free, else the roomiest.
function openHeading(api, mob, supported, floating, cands, rand = Math.random) {
  let roomiest = null, roomiestD = -1;
  for (const h of cands) {
    const dx = Math.sin(h), dz = Math.cos(h);
    const fit = (x, z) => !bodyFits(api, mob, supported, floating, h, x, z);
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
// Returns false when no wall runs near along axis.
function latchVirtual(api, mob, axis, sideDir) {
  const [ax] = dirVec(axis);
  const [sx, sz] = dirVec(sideDir);
  const latIsX = ax === 0;
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const cellFree = api.makeCellFree(mob);
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
  mob.followLine = { axis, line: face - dirSign * (api.virtualW / 2), side: -dirSign };
  return true;
}

// Erect for an axis when a wall runs near on some side (nearest wins,
// random tiebreak) and forward runs open. Never inside a true 1-wide
// corridor (both side mouths walled): there the cell-centre slide rules
// alone — latching a line there would ping-pong the lateral target with
// the both-real drop every tick. Pre-aligns the yaw.
function erectForAxis(api, mob, dt, supported, floating, axis, rand = Math.random) {
  const [ax, az] = dirVec(axis);
  if (!bodyFits(api, mob, supported, floating, axis,
      mob.pos.x + ax * PROBE_DIST, mob.pos.z + az * PROBE_DIST)) return false;
  const cellFree = api.makeCellFree(mob);
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
  if (!latchVirtual(api, mob, axis, best.sideDir)) return false;
  mob.yawTarget = axis;
  api.turnTo(mob, dt, ROAM_TURN);
  return true;
}

function clearRoam(mob) {
  mob.roam = null;
  mob.wanderT = 0;
}

// Management pass: target identity, virtual upkeep. No motion here.
export function roamManage(mob, dt, api) {
  const r = mob.roam;
  if (r && r.mode && mob.target !== r.tgt) {
    mob.roam = null;
    mob.followLine = null;
    return;
  }
  mob.followCool = Math.max(0, (mob.followCool ?? 0) - dt);
  if (!mob.lane) return;
  if (mob.roam?.mode === "commit") mob.roam = null; // servo owns motion now
  const vw = mob.followLine;
  if (!vw) {
    // Guarded latch: wider-than-1 corridor with a wall near (aligned yaw).
    // erectForAxis itself refuses true 1-wide corridors (both mouths
    // walled); open field has no wall near. Runs at most once per lane
    // until dropped.
    if ((mob.followCool ?? 0) <= 0 && yawDiff(mob.yaw, mob.lane.axis) < Math.PI / 4) {
      erectForAxis(api, mob, dt, true, false, mob.lane.axis);
    }
    return;
  }
  // Opposite headings share the corridor line: a U-turn flip keeps the
  // latched wall (same lateral, no re-erect churn). Anything else drops.
  const vwTurn = Math.abs(normYaw(vw.axis - mob.lane.axis));
  if (vwTurn > 1e-6 && vwTurn < Math.PI - 1e-6) {
    // Turned into something else: drop, re-latch when a wall runs near.
    mob.followLine = null;
    erectForAxis(api, mob, dt, true, false, mob.lane.axis);
    return;
  }
  if (r && r.mode === "follow") r.t = (r.t ?? 0) + dt;
  // Both sides really walled: true 1-wide corridor, real servo owns it.
  const [ax, az] = dirVec(mob.lane.axis);
  const cellFree = api.makeCellFree(mob);
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  if (!cellFree(cx - az, cz + ax) && !cellFree(cx + az, cz - ax)) {
    mob.followLine = null;
    return;
  }
  // Followed-side wall lost: count down, then drop (release/commit follow).
  // vw.side is ±1 toward the VIRTUAL wall in world lateral coords, so the
  // real wall reads along the negated side.
  const [wax] = dirVec(vw.axis);
  const sdx = wax === 0 ? -vw.side : 0;
  const sdz = wax === 0 ? 0 : -vw.side;
  const fitS = (x, z) => !api.makeStepOk(mob, true, false, 0, vw.axis, 0)(x, z);
  const d = rayDist(mob.pos.x, mob.pos.z, sdx, sdz, fitS, FOLLOW_RANGE + 0.05, 0.1);
  if (r && r.mode === "follow") {
    if (d > FOLLOW_RANGE) r.lost = (r.lost ?? 0) + 1;
    else r.lost = 0;
    if ((r.lost ?? 0) > LOST_TICKS || (r.t ?? 0) > (r.span ?? SPAN_MAX)) {
      // Follow session over: drop everything and force the next commit to
      // turn away instead of re-latching the same wall.
      mob.followLine = null;
      mob.lane = null;
      mob.followCool = FOLLOW_COOL;
      mob.roam = { mode: null, forceTurnFrom: r.heading };
      mob.wanderT = 0;
    }
  }
}

// Decision + stepping when the servo owns nothing. Returns handled.
export function roamStep(mob, dt, api, supported, floating, rand = Math.random) {
  if (mob.lane) return false;
  let r = mob.roam;
  const broken = r && r.mode && mob.target !== r.tgt;
  const arrived = r && r.mode === "commit" && mob.target &&
    Math.hypot(r.target.x - mob.pos.x, r.target.z - mob.pos.z) < ARRIVE_D;
  const expired = r && r.mode && mob.wanderT <= 0;
  const timedOut = r && r.mode && (r.t ?? 0) > (r.span ?? SPAN_MAX);
  if (!r || !r.mode || broken || arrived || expired || timedOut || !mob.target) {
    const prev = (r && r.mode)
      ? { heading: r.heading, align: r.align ?? 0, alignT: r.alignT ?? 0, t: r.t ?? 0 }
      : (r && r.forceTurnFrom != null
        ? { heading: r.forceTurnFrom, align: ALIGN_N, alignT: ALIGN_T, t: 0 }
        : null);
    mob.roam = null;
    decide(mob, dt, api, supported, floating, rand, prev);
    r = mob.roam;
    if (!r || !r.mode) return false;
  }
  if (r.mode === "follow") {
    // Motion is servo-owned; without a lane hold briefly for engage, then
    // re-decide instead of freezing.
    r.nolane = (r.nolane ?? 0) + 1;
    if (r.nolane > 3) {
      clearRoam(mob);
      mob.followCool = NOLANE_COOL;
      return false;
    }
    return true;
  }
  // Commit step toward the latched target.
  mob.yawTarget = Math.atan2(r.target.x - mob.pos.x, r.target.z - mob.pos.z);
  api.turnTo(mob, dt, ROAM_TURN);
  const err = Math.abs(normYaw(mob.yawTarget - mob.yaw));
  const stride = mob.speed * Math.max(0, Math.cos(Math.min(err, Math.PI / 2))) * dt;
  if (err < ROAM_SPIN && stride > 1e-6) {
    const stepOk = api.makeStepOk(mob, supported, floating, mob.nose.along, mob.yaw);
    api.moveClamped(
      mob, mob.pos.x + Math.sin(mob.yaw) * stride, mob.pos.z + Math.cos(mob.yaw) * stride, stepOk);
  }
  r.t = (r.t ?? 0) + dt;
  return true;
}

function decide(mob, dt, api, supported, floating, rand = Math.random, prev = null) {
  // Same-heading persistence vs the previous decision (any mode): aligned
  // picks count up with their time; the normal commit path forces a real
  // turn past the budgets instead of chaining straight forever.
  const alignOf = (heading) => {
    if (prev && prev.heading != null && yawDiff(heading, prev.heading) < ALIGN_D) {
      return { align: (prev.align ?? 0) + 1, alignT: (prev.alignT ?? 0) + (prev.t ?? 0) };
    }
    return { align: 0, alignT: 0 };
  };
  const yaw = snapCardinal(mob.yaw);
  const [fx, fz] = dirVec(yaw);
  const fwdBlocked = !bodyFits(api, mob, supported, floating, yaw,
    mob.pos.x + fx * PROBE_DIST, mob.pos.z + fz * PROBE_DIST);
  // Gap tiebreak: heading blocked with a bounded hole ahead — steer to it.
  if (fwdBlocked) {
    const gap = scanGap(api, mob, supported, floating, yaw);
    if (gap != null) {
      const past = api.strideTarget(mob, gap);
      const gx = mob.pos.x + Math.sin(gap) * 2.5, gz = mob.pos.z + Math.cos(gap) * 2.5;
      const inside = bodyFits(api, mob, supported, floating, gap, gx, gz);
      // Walkable point past the gap preferred; the farm picker (ground +
      // headroom checked) is the backstop, stuck-bounded like anywhere.
      const target = past ?? (inside ? { x: gx, z: gz } : api.pickTarget(mob));
      if (target) {
        mob.target = target;
        mob.wanderT = 1e9;
        const a = alignOf(gap);
        mob.roam = { mode: "commit", heading: gap, target, tgt: target, t: 0, span: roamSpan(rand), align: a.align, alignT: a.alignT };
        return;
      }
    }
  }
  // Wall nearby and roughly parallel: follow it, else commit straight.
  if (!fwdBlocked && (mob.followCool ?? 0) <= 0 && rand() < FOLLOW_P) {
    if (erectForAxis(api, mob, dt, supported, floating, yaw, rand)) {
      mob.target = { x: mob.pos.x + fx * 5, z: mob.pos.z + fz * 5 };
      mob.wanderT = 1e9;
      const a = alignOf(yaw);
      mob.roam = { mode: "follow", heading: yaw, target: mob.target, tgt: mob.target, t: 0, span: roamSpan(rand), align: a.align, alignT: a.alignT, nolane: 0, lost: 0 };
      return;
    }
  }
  // Commit: current raw heading first (continuity bias, oblique included),
  // then the shuffled 8-wind — unless persistence budgets are spent,
  // forcing a real turn out of the straight.
  const cands = [mob.yaw, ...shuffled(
    WINDS8.filter((dd) => yawDiff(dd, mob.yaw) > 1e-6), rand)];
  let heading = openHeading(api, mob, supported, floating, cands, rand);
  let forced = false;
  if (heading != null && prev && prev.heading != null && yawDiff(heading, prev.heading) < ALIGN_D &&
      ((prev.align ?? 0) + 1 >= ALIGN_N || (prev.alignT ?? 0) + (prev.t ?? 0) >= ALIGN_T)) {
    const turn = openHeading(api, mob, supported, floating, shuffled(
      WINDS8.filter((dd) => yawDiff(dd, prev.heading) > ALIGN_D), rand), rand);
    if (turn != null) { heading = turn; forced = true; }
  }
  if (heading == null) return;
  const target = api.strideTarget(mob, heading) ?? api.pickTarget(mob);
  if (!target) return;
  mob.target = target;
  mob.wanderT = 1e9;
  const a = forced ? { align: 0, alignT: 0 } : alignOf(heading);
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: roamSpan(rand), align: a.align, alignT: a.alignT };
}
