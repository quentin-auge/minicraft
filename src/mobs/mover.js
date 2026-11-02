// Farm-mob kinematics: the 1-wide corridor servo, stepping, falling, and
// separation. Three-free and headless-testable: positions are plain
// {x, y, z} writes, visuals are guarded behind `mob.root` (null headless).
// Shared step physics live in step.js (R0), the directional policy and
// the gap scan in corridor.js; farm.js owns the meshes, spawning,
// and lifecycle. Headless rigs drive this module on live voxels.
import { FARM_WALK_DIVISOR } from "./livestock.js";
import {
  PROBE_DIST, normYaw, yawDiff, dirVec, cellCenter, oppositeYaw, snapCardinal,
  CARDINALS,   classifyExits, updateLane, flanksOpen, mouthOpen, exitTunneled, scanGap, FUNNEL_GIVEUP, FUNNEL_COOL,
} from "./corridor.js";
import {
  aabbIntersectsSolid, hasSupport,
  liquidSurface, footingOk, headroomOk,
  makeCellFree, makeStepOk, descendOk, turnTo,
  moveClamped, moveVector, driveToward, dropLane, spawnRng, stepVertical,
  SERVO_STEP, VIRTUAL_W,
} from "./step.js";
import {
  upkeepFollowLine, roamStep, roamSpan, ARRIVE_D, FOLLOW_COOL,
  latchTouchWall, latchFlankTouch, measureWallTake, cornerTurn,
  sameWallFace, connectedTake,
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
// instead of waiting out wanderT, so a breach gets used instead of missed.
export const STUCK_T = 0.5;
// Separation gap added to every circle-pair need, and vertical gate:
// mobs more than this far apart in Y never interact.
export const SEP_GAP = 0.1;
export const SEP_Y = 1.2;

// R0b pit guard (imported from step.js): a descent the mob can never climb
// back out of reads as a wall; ramps and liquid entries pass through.
// Doorway scan: facing a wall, look for a contiguous free run across the
// forward distances. A run counts only when walled on both flanks — a true
// hole, never an open edge — and when its middle cell runs on along the
// Funnel drive toward the committed lateral line: face the axis, advance
// forward and slide sideways as two independently gated moves (never one
// diagonal — diagonals wedge into step-wall pockets). Give-up + cooldown
// bound any wedge; the normal flow resumes past the constriction.
export function funnelDrive(mob, dt, funnel, supported, floating) {
  const { axis, line } = funnel;
  const [ax, az] = dirVec(axis);
  // Level routes only (see descendOk): a funnel that descends into a pit
  // strands the mob below with no way back up.
  const makeDrive = () => {
    const baseOk = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
    return (nx, nz) => baseOk(nx, nz) && descendOk(mob, nx, nz);
  };
  const fwd = driveToward(mob, dt, axis, makeDrive, moveVector, { rate: SERVO_TURN });
  let moved = fwd.dist > 1e-6;
  if (fwd.err < SERVO_SPIN) {
    const cur = ax === 0 ? mob.pos.x : mob.pos.z;
    const e = line - cur;
    const cap = mob.speed * dt * 0.9;
    const c = Math.max(-cap, Math.min(cap, e));
    if (Math.abs(c) > 1e-4) {
      const baseOk = makeStepOk(mob, supported, floating, 0, axis, 0);
      const axisOk = (nx, nz) => baseOk(nx, nz) && descendOk(mob, nx, nz);
      const tx = ax === 0 ? mob.pos.x + c : mob.pos.x;
      const tz = ax === 0 ? mob.pos.z : mob.pos.z + c;
      if (axisOk(tx, tz)) {
        moved = moved || Math.abs(c) > 1e-6;
        mob.pos.x = tx; mob.pos.z = tz;
      }
    }
  }
  if (!moved && fwd.err < SERVO_SPIN) mob.funnelT = (mob.funnelT ?? 0) + dt;
  else if (moved) mob.funnelT = 0;
  if ((mob.funnelT ?? 0) > FUNNEL_GIVEUP) {
    mob.funnelT = 0; mob.funnelCool = FUNNEL_COOL;
    return false;
  }
  mob.stuckT = 0;
  return true;
}

// Stride validation (imported from step.js): destination rules plus the
// whole segment, so fences, house walls, and troughs bound targets
// emergently — no pen fork.
// Permanent 1-path centering: the single lateral slide behind every lane
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
function slideLateral(mob, dt, supported, floating, holdLine) {
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
  const cap = mob.speed * dt * 0.9;
  const c = Math.max(-cap, Math.min(cap, e));
  if (Math.abs(c) <= 1e-4) return 0;
  const centerBase = makeStepOk(mob, supported, floating, 0, mob.lane.axis, 0);
  const axisOk = wrapStepOk(mob, (nx, nz) => centerBase(nx, nz) && descendOk(mob, nx, nz));
  const tx = mob.pos.x + -az * c, tz = mob.pos.z + ax * c;
  if (!axisOk(tx, tz)) return 0;
  mob.pos.x = tx; mob.pos.z = tz;
  return Math.abs(c);
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
// the lane. Lane discipline comes from the slide pulling to the middle
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
export function servoTick(mob, dt, supported, floating, rand = Math.random) {
  if (!supported || floating) { mob.lane = null; return false; }
  // R2 upkeep first: the latched line below biases this very tick's slide.
  upkeepFollowLine(mob, dt);
  if ((mob.funnelCool ?? 0) > 0) mob.funnelCool -= dt;
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
  const touchRide = mob.followLine?.virtual === true && mob.followLine.touch === true && prevAxis != null;
  // Single tunnel rule behind every non-touch lane: engage and cruise hold
  // both flanks walled (block or drop, virtual wall included); junction
  // and lock-turn exits hold their arm tunneled instead (exitTunneled) —
  // a draw into a room, widening, or field releases to roam instead of
  // locking a red lane into the open. Dead-end seeks and touch rides keep
  // their own hold rules below.
  const tunneledFor = (event, axis) => {
    if (event === "junction" || event === "lock-turn") {
      return exitTunneled(mob.pos.x, mob.pos.z, axis, sense.cellFree);
    }
    const latA = normYaw(axis + Math.PI / 2), latB = normYaw(axis - Math.PI / 2);
    const walledDir = (d) => sense.walled.some((w) => yawDiff(w, d) < 1e-6);
    return walledDir(latA) && walledDir(latB);
  };
  if (!touchRide && (res.event === "engage" || res.event === "cruise" || res.event === "junction" || res.event === "lock-turn")) {
    // Strict 1-wide hold (see above): a lane cruising where neither flank
    // reads blocked (single-wall walks, widenings, room crossings) drops
    // to roam instead of persisting.
    if (!tunneledFor(res.event, res.lane.axis)) {
      dropLane(mob);
      // Hold the next latch off so the commit walks clear of the wall
      // ends instead of flank-grazing straight back (mouth oscillation).
      mob.followCool = FOLLOW_COOL;
      return false;
    }
  }
  if (res.event === "uturn") {
    // Inner corner on a touch ride: the nose met the perpendicular arm of
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
    // nose means a corridor situation (jog, notch): drop instead and let
    // the 1-wide logic own it.
    const keep = followExit(mob, prevAxis);
    if (!keep) {
      let corner = sense.fwdOpen ? cornerTurn(mob, prevAxis) : null;
      // Same wall only: corner rounding onto a disconnected wall (past
      // the tip, across open field) is a switch — refuse it and let the
      // in-place U-turn below keep the ride on its own wall instead.
      if (corner != null && !connectedTake(mob, prevAxis, corner.cell)) corner = null;
      if (corner != null) {
        const { axis, face, dirSign, sideDir } = corner;
        const rel = yawDiff(sideDir, normYaw(axis - Math.PI / 2)) < 1e-9 ? 1 : -1;
        mob.lane = { axis, entry: oppositeYaw(axis), lockX: cx, lockZ: cz };
        mob.followLine = {
          axis, line: face - dirSign * (VIRTUAL_W / 2), side: -dirSign,
          rel, virtual: true, touch: true, fresh: TURN_HOLD_TICKS, face,
        };
        mob.stuckT = 0;
        mob.turnHold = TURN_HOLD_TICKS;
        res.event = "junction";
        res.lane = mob.lane;
      } else if (sense.fwdOpen) {
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
      mob.lane = { axis: keep.axis, entry: oppositeYaw(keep.axis), lockX: cx, lockZ: cz };
      mob.followLine = keep.followLine;
    }
  }
  blendTurn(mob, dt, res);
  return cruiseLane(mob, dt, supported, floating, res);
}

// Lane sensing: body-only direction probes (footNose 0, no nose disc — the
// classifier asks which cells fit the body, so 1-cell arms ending in a wall
// still read open), the width-aware exit set, and the forward opening.
// The virtual wall (when a line rides along) synthesizes the far side, so
// an open wall reads exactly like a 1-wide corridor.
// descendOk gates pit mouths: a legal drop into a local minimum reads as a
// wall (the drives below refuse it too), so the lane U-turns at the lip
// instead of funneling or cruising in. The drives keep the real nose reach.
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

// Pre-lane flow: gap funnel when free walking is impossible with no lane
// (facing a wall with a through gap: offset narrowing mouth, house door,
// pen breach — mid-corridor turns stay blended, dead ends funnel inside
// the seek below), else 100% touch latch on a plain wall (contact always
// sticks; straight-on draws lots 50/50, oblique keeps its direction),
// else flank-touch latch when a wall rubs the side while the way ahead
// runs free (parallel graze, diagonal slide: contact is contact,
// whatever the angle). Then open-space release (forward open and both
// flanks truly open — field, room middle, wide hall — or a tunnel mouth
// opening onto a field: commit straight out with the current heading
// bias instead of random spins, roam owns the next tick) — never while a
// touch ride holds (the ride only ends at a true wall end via corner
// rounding, U-turn pacing, or 1-wide handover). Returns true/false when
// it handles the tick, "touch" when a contact latch erected the lane
// (sense again along it), undefined when a lane update is due.
function tryPreLane(mob, dt, supported, floating, sense, rand = Math.random) {
  if (!mob.lane && (mob.followCool ?? 0) <= 0) {
    if (!sense.fwdOpen) {
      if ((mob.funnelCool ?? 0) <= 0) {
        const gap = scanGap(mob, sense.axisProbe);
        if (gap) return funnelDrive(mob, dt, gap, supported, floating);
      }
      const th = mob.target ? Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z) : null;
      const axis = latchTouchWall(mob, dt, sense.axisProbe, th, rand);
      if (axis != null) {
        mob.lane = { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1 };
        mob.stuckT = 0;
        return "touch";
      }
    } else {
      const axis = latchFlankTouch(mob, dt, sense.axisProbe);
      if (axis != null) {
        mob.lane = { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1 };
        mob.stuckT = 0;
        return "touch";
      }
    }
  }
  // Open-field exits (never while a touch ride holds): true fields via
  // flanksOpen, tunnel mouths via mouthOpen (the mouth reads as a
  // junction — exiting here beats randomizing an arm into the field).
  // Both hold the next latch off so the commit walks clear of the wall
  // ends instead of grazing straight back.
  if (mob.lane && mob.followLine?.touch !== true && sense.fwdOpen &&
      (flanksOpen(mob.pos.x, mob.pos.z, mob.lane.axis, sense.cellFree) ||
       mouthOpen(mob.pos.x, mob.pos.z, mob.lane.axis, sense.cellFree))) {
    dropLane(mob); mob.stuckT = 0; mob.followCool = FOLLOW_COOL;
    return false;
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
    return {
      axis: Q,
      followLine: {
        axis: Q, line: m.face - m.dirSign * (VIRTUAL_W / 2), side: -m.dirSign,
        rel, virtual: true, touch: true, fresh: TURN_HOLD_TICKS, face: m.face,
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
  for (const E of [...straight, ...turns]) {
    const win = measure(E, null) ?? measure(E, ahead(E));
    if (!win || !walkable(E)) continue;
    if (E === prevAxis) {
      if (!sameWallFace(mob, win.m)) continue;
    } else if (!connectedTake(mob, prevAxis, win.m.cell)) continue;
    return {
      axis: E,
      followLine: {
        axis: E,
        line: win.m.face - win.m.dirSign * (VIRTUAL_W / 2),
        side: -win.m.dirSign,
        rel, virtual: true,
        touch: mob.followLine.touch === true,
        fresh: TURN_HOLD_TICKS,
        face: win.m.face,
      },
    };
  }
  return null;
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
// A dead end facing a through gap (offset narrowing mouth, door in the end
// wall) funnels into it instead, dropping the flipped lane so the funnel
// re-fires every tick until through (a kept flip would cruise back). Side
// mouths never qualify (no through route along the axis), so junction
// corners stay blended.
function seekDeadEnd(mob, dt, supported, floating) {
  const forward = mob.lane.entry; // pre-flip axis: updateLane already swapped
  if ((mob.funnelCool ?? 0) <= 0) {
    const gap = scanGap(mob, forward);
    if (gap) {
      dropLane(mob);
      return funnelDrive(mob, dt, gap, supported, floating);
    }
  }
  // Recentre first (no corridor gate: a corner wedge is never a true
  // 1-wide cell, and that is exactly when the seek needs centring —
  // the axisOk probe below refuses any slide into a wall, and a stale
  // flipped follow line still pins the lateral via modulo-π).
  slideLateral(mob, dt, supported, floating, true);
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
function cruiseLane(mob, dt, supported, floating, res) {
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
  // while wall-following. Turns and seeks centre through slideLateral above.
  const recentered = res.event === "cruise"
    ? 0
    : slideLateral(mob, dt, supported, floating, true);
  if (dist === 0 && recentered === 0 && err < SERVO_SPIN) mob.servoStall = (mob.servoStall ?? 0) + dt;
  else mob.servoStall = 0;
  // A fully stalled lane (wedged nose, refused slide, aligned yaw) always
  // releases — touch rides included: nose contact leads body contact by a
  // few ticks, so genuine dead ends and inner corners U-turn long before
  // the 0.75 s trip, while a lock-held grind would otherwise freeze
  // forever. The in-place U-turn pace keeps moving, so it never trips it.
  if (mob.servoStall > 0.75) {
    if (mob.followLine?.touch === true && mob.lane) {
      // Stalled touch ride: U-turn in place and keep the line (never
      // drop) — same rule as the no-solution U-turn above.
      mob.lane = { axis: oppositeYaw(mob.lane.axis), entry: mob.lane.axis, lockX: -1, lockZ: -1 };
      mob.servoStall = 0;
      mob.stuckT = 0;
      return true;
    }
    mob.lane = null; mob.servoStall = 0; mob.followCool = FOLLOW_COOL;
    mob.turnHold = 0;
    return false;
  }
  if (res.event === "cruise") slideLateral(mob, dt, supported, floating, false);
  mob.stuckT = 0;
  return true;
}

// Full per-mob tick: stuck detection, target refresh, servo/roam/wander
// planes, gravity/float vertical, cosmetic gait (scene only). pickTarget is
// injected (farm.js) so this stays world-free; it now validates whole
// strides, so pen fence and house walls bound it emergently (no pen fork).
export function tickFarmMob(mob, dt, pickTarget, rand = mob.rand ?? Math.random) {
  // Fixed-step integration: tall frames (V speed) run exact SERVO_STEP
  // slices plus one tail below 1.5 steps, so probes, arcs, holds and
  // random draws read identically per sim-second at any speed. Plain
  // recursion, no body re-indent (keeps later diffs clean).
  if (dt > SERVO_STEP * 1.5) {
    tickFarmMob(mob, SERVO_STEP, pickTarget, rand);
    tickFarmMob(mob, dt - SERVO_STEP, pickTarget, rand);
    return;
  }
  mob.wanderT -= dt;
  const dx = mob.target ? mob.target.x - mob.pos.x : 0;
  const dz = mob.target ? mob.target.z - mob.pos.z : 0;
  // Stuck pushing a wall (e.g. fence between us and an outside target):
  // re-pick instead of grinding until wanderT runs out. Stillness is
  // relative to a normal step (speed*dt), not an absolute distance.
  if (mob.target) {
    const stepped = Math.hypot(mob.pos.x - mob.lastX, mob.pos.z - mob.lastZ);
    if (stepped < mob.speed * dt * 0.2) mob.stuckT += dt;
    else mob.stuckT = 0;
    if (mob.stuckT >= STUCK_T) {
      mob.target = pickTarget(mob, rand);
      mob.wanderT = roamSpan(rand);
      mob.stuckT = 0;
    }
  } else {
    mob.stuckT = 0;
  }
  mob.lastX = mob.pos.x;
  mob.lastZ = mob.pos.z;
  // Target refresh on arrival or span expiry — wanderT never doubles as
  // another signal.
  if (!mob.target || Math.hypot(dx, dz) < ARRIVE_D || mob.wanderT <= 0) {
    mob.target = pickTarget(mob, rand);
    mob.wanderT = roamSpan(rand);
  }
  // Support state drives both planes: floating bodies are carried by
  // water (drop gate bypassed); airborne bodies keep walking while the
  // fall stays within maxDrop (spawn drops and void edges still make
  // progress instead of freezing mid-air), then fall straight and
  // resume walking on landing; grounded bodies obey the legal-step
  // gate below.
  const surface = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h);
  const floating = surface != null;
  const supported = floating || hasSupport(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw);
  if (supported) mob.fallFrom = mob.pos.y;
  // Roam stepping owns lane-less ticks the servo declines (the R2 upkeep
  // above already ran inside the servo tick).
  const servoed = servoTick(mob, dt, supported, floating, rand);
  let roamed = false;
  if (!servoed && supported && !floating) roamed = roamStep(mob, dt, supported, floating, rand, pickTarget);
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
    // (Mob-vs-mob distance is a post-tick pass, not a steering push.)
    const makeWander = () => makeStepOk(mob, supported, floating, mob.nose.along, mob.yaw);
    driveToward(mob, dt,
      Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z),
      makeWander, moveClamped, { gated: false });
  }
  // Displacement-mode flags for the ?color=1 tint (farm.js paints,
  // headless rigs assert): derived every tick, never branched on by
  // steering. A touch ride on a lane follows a wall (blue), a lane
  // alone runs a true 1-wide corridor (red).
  mob.wallFollow = mob.followLine?.touch === true && mob.lane != null;
  mob.oneWide = mob.lane != null && mob.followLine?.touch !== true;
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

// Hard separation pass over one dimension's mobs: positional
// depenetration on the yaw-oriented body circles (core + nose + tail),
// worst circle pair first, 3 iterations. A vetoed side stays put and
// the other side takes the full correction; both vetoed keeps the
// overlap for this tick (rare — wall sandwich — and retried next tick).
// Y-gated so a faller never shoves a walker below. Alloc-free: circle
// centers stay in locals, pairs share one scratch-free loop.
export function separateFarmMobs(list) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      const asx = Math.sin(a.yaw), asz = Math.cos(a.yaw);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > SEP_Y) continue;
        const bsx = Math.sin(b.yaw), bsz = Math.cos(b.yaw);
        let wPen = 0, wNx = 0, wNz = 0;
        for (let ai = 0; ai < 3; ai++) {
          const aa = ai === 0 ? 0 : ai === 1 ? a.nose.along : a.tail.along;
          const ar = ai === 0 ? a.hw : ai === 1 ? a.nose.r : a.tail.r;
          const ax = a.pos.x + asx * aa, az = a.pos.z + asz * aa;
          for (let bi = 0; bi < 3; bi++) {
            const ba = bi === 0 ? 0 : bi === 1 ? b.nose.along : b.tail.along;
            const br = bi === 0 ? b.hw : bi === 1 ? b.nose.r : b.tail.r;
            const ox = ax - (b.pos.x + bsx * ba), oz = az - (b.pos.z + bsz * ba);
            const need = ar + br + SEP_GAP;
            const d2 = ox * ox + oz * oz;
            if (d2 >= need * need) continue;
            // Coincident centers have no normal: deterministic fallback
            // direction from the pair indices (recomputed next tick, so
            // any axis unstacks exact overlaps instead of skipping them).
            if (d2 < 1e-8) {
              const fa = (i * 2.39996 + j * 1.2345) % (Math.PI * 2);
              const pen = need;
              if (pen > wPen) { wPen = pen; wNx = Math.sin(fa); wNz = Math.cos(fa); }
              continue;
            }
            const d = Math.sqrt(d2), pen = need - d;
            if (pen > wPen) { wPen = pen; wNx = ox / d; wNz = oz / d; }
          }
        }
        if (wPen <= 0) continue;
        let da = wPen / 2, db = wPen / 2;
        if (!sepSpotFree(a, a.pos.x + wNx * da, a.pos.z + wNz * da)) { da = 0; db = wPen; }
        if (!sepSpotFree(b, b.pos.x - wNx * db, b.pos.z - wNz * db)) {
          db = 0;
          if (da === 0) continue;
        }
        a.pos.x += wNx * da;
        a.pos.z += wNz * da;
        b.pos.x -= wNx * db;
        b.pos.z -= wNz * db;
        moved = true;
      }
    }
    if (!moved) break;
  }
}
