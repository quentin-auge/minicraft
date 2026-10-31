// Farm-mob kinematics: the 1-wide corridor servo, stepping, falling, and
// separation. Three-free and headless-testable: positions are plain
// {x, y, z} writes, visuals are guarded behind `mob.root` (null headless).
// Shared step physics live in step.js (R0), the gap scan in gaps.js (R5),
// the directional policy in corridor.js; farm.js owns the meshes, spawning,
// and lifecycle. Headless rigs drive this module on live voxels.
import { FARM_WALK_DIVISOR } from "./livestock.js";
import {
  PROBE_DIST, normYaw, dirVec, cellCenter, oppositeYaw, snapCardinal, snap8,
  classifyExits, updateLane, flanksOpen,
} from "./corridor.js";
import {
  aabbIntersectsSolid, hasSupport,
  liquidSurface, footingOk, headroomOk,
  makeCellFree, descendOk, turnTo,
  moveClamped, moveVector, driveToward, dropLane, spawnRng, stepVertical,
  segmentWalkable, fitsAt,
} from "./step.js";
import { scanGap, FUNNEL_GIVEUP, FUNNEL_COOL } from "./gaps.js";
import { queryMobGrid, buildMobGrid } from "./grid.js";
import { upkeepFollowLine, roamStep, roamSpan, ARRIVE_D, FOLLOW_COOL } from "./roam.js";
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
// Pushing against a wall toward an unreachable target re-picks this fast
// instead of waiting out wanderT, so a breach gets used instead of missed.
export const STUCK_T = 0.5;
// Progress watchdog: a mob shuffling without closing on its target is
// stuck even when its feet move — slides and separation shoves reset the
// stillness clock below while the dance goes nowhere (yaw weaving in a
// scrum, orbiting an unreachable point). Sample the target distance twice
// a second: two consecutive samples without meaningful closing escalate
// exactly like stillness. Suppressed while a maneuver flies (sidesteps
// legitimately open distance) and without a target. Lenient by design
// (0.15 m per 0.5 s vs ~1 m striding) — only true shuffles trip it.
export const PROG_T = 0.5;
export const PROG_MIN = 0.15;
export const PROG_STRIKES = 2;
// A committed detour never runs longer than this (seconds): long enough
// to sidestep one blocker — and to hold it instead of re-deciding every
// half second (measured: 2.5 cuts re-aims 8% and stalls 12% in a dense
// pen vs 1.5; 3.5 adds nothing, the free-lane early release ends detours
// first) — but short enough that a stale heading can't drag a mob across
// the map before the next decision.
export const DETOUR_SPAN = 1.5;
// A wiggle is one short sidestep, not a trip: one stride out, then the
// next tick re-aims. Past this many consecutive wiggles with no motion the
// stuck path escalates to the full detour above instead of dancing.
export const WIGGLE_DIST = 0.5;
export const WIGGLE_SPAN = 0.5;
export const WIGGLE_MAX = 2;
// Step-gate overlap allowance (m): a step whose worst circle-pair
// penetration stays within this brushes through instead of being refused.
// Mobs hold committed headings through shallow contact instead of
// stopping at nose range and re-picking every tick; the separation
// backstop clears the residue every tick, so nothing ever wedges.
// Picks, block detection, and pushes stay exact (see below).
export const GATE_ALLOW = 0.05;
// Crossing budget (m): how deep two bodies may overlap in passing before
// the step gate refuses like a wall — read everywhere a meeting asks "can
// we cross": the step gate, the wiggle probe, and the planner's cross test
// (forecast.js). Shipped at 0.15: shoulders brush past, the backstop
// clearing every residue.
export const CROSS_BUDGET = 0.15;
// Separation gap added to every circle-pair need, and vertical gate:
// mobs more than this far apart in Y never interact.
export const SEP_GAP = 0.1;
export const SEP_Y = 1.2;
// Open-field cooperation (pen scope, lane-less ticks only): temporal
// yield only — ease off early on a collision course, never steer, never
// stop, never shove. Floors stay near full stride (evasion is spatial —
// a sidestep at full speed — not a slowdown); a step that would overlap
// another mob past the gate allowance is refused (like a wall), while
// shallower brushes walk straight through on the committed heading
// instead of stopping the mob into a re-pick every tick.
// All deterministic, no rand stream.
export const AVOID_RANGE = 3.5;
// Anything ahead of this (dot with the nose above the cone) counts as
// "in front": slightly negative so an abreast peer just behind the nose
// line still reads — otherwise only one side of a flank grind reacts.
export const AVOID_CONE = -0.2;
export const YIELD_DIST = 3.0;
export const YIELD_SLOW = 0.7;
// A follower only backs off gently: it must keep enough stride to keep
// moving while the gap resolves instead of tailgating forever.
export const FOLLOW_SLOW = 0.8;
// Comfort margin (m) added to the picker's blocked check: aim with room
// to spare since bodies keep moving after the pick. The step gate itself
// stays exact — it refuses only true overlaps.
export const PICK_COMFORT = 0.3;
// Prediction horizon: ~3 s at farm stride (~6 m). Long enough to
// sequence a pen crossing early, short enough that a latched roam heading
// stays roughly valid. The peer loop scans to PREDICT_RANGE so the glide
// below sees the whole horizon; the reactive gates keep their own ranges.
export const PREDICT_T = 3.0;
export const PREDICT_RANGE = 6.0;
// Scratch buffers for grid queries (single-threaded, never reentrant:
// each call fully consumes its buffer before the next begins).
const _avoidNear = [];
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
// the horizon. Pure and headless-testable.
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
    const baseOk = (nx, nz) => fitsAt(mob, supported, floating, mob.yaw, false, nx, nz);
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
      const baseOk = (nx, nz) => fitsAt(mob, supported, floating, axis, false, nx, nz);
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
      if (!holdLine || near) {
        if (ax === 0) ccx = vw.line; else ccz = vw.line;
      }
    }
  }
  const e = (ccx - mob.pos.x) * -az + (ccz - mob.pos.z) * ax;
  const cap = mob.speed * dt * 0.9;
  const c = Math.max(-cap, Math.min(cap, e));
  if (Math.abs(c) <= 1e-4) return 0;
  const centerBase = (nx, nz) => fitsAt(mob, supported, floating, mob.lane.axis, false, nx, nz);
  const axisOk = (nx, nz) => centerBase(nx, nz) && descendOk(mob, nx, nz);
  const tx = mob.pos.x + -az * c, tz = mob.pos.z + ax * c;
  if (!axisOk(tx, tz)) return 0;
  mob.pos.x = tx; mob.pos.z = tz;
  return Math.abs(c);
}

// Servo tick body. Follow-line state (mob.followLine = {axis, line,
// side} | null) only biases the cruise slide target; all probes read real
// voxels, so branch visibility and ground truth stay exact. Sense, engage,
// and the four lane drives below run in order; each drive owns its motion.
export function servoTick(mob, dt, supported, floating, rand = Math.random) {
  if (!supported || floating) { mob.lane = null; return false; }
  // R2 upkeep first: the latched line below biases this very tick's slide.
  upkeepFollowLine(mob, dt);
  if ((mob.funnelCool ?? 0) > 0) mob.funnelCool -= dt;
  const sense = senseLane(mob);
  const pre = tryPreLane(mob, dt, supported, floating, sense);
  if (pre !== undefined) return pre;
  // Junction draws come from the mob's own stream (seeded once below), not
  // the ambient rand: roam refactors can never reshuffle junction outcomes.
  const jrng = mob.jrng ?? (mob.jrng = spawnRng(rand));
  const res = updateLane(mob.lane, Math.floor(mob.pos.x), Math.floor(mob.pos.z), mob.yaw, sense.opens, jrng);
  if (!res.lane) { dropLane(mob); return false; }
  mob.lane = res.lane;
  if (res.event === "uturn") return seekDeadEnd(mob, dt, supported, floating);
  blendTurn(mob, dt, res);
  return cruiseLane(mob, dt, supported, floating, res);
}

// Lane sensing: body-only direction probes (footNose 0, no nose disc — the
// classifier asks which cells fit the body, so 1-cell arms ending in a wall
// still read open), the width-aware exit set, and the forward opening.
// descendOk gates pit mouths: a legal drop into a local minimum reads as a
// wall (the drives below refuse it too), so the lane U-turns at the lip
// instead of funneling or cruising in. The drives keep the real nose reach.
// Deliberately body-only (fitsAt noseOn=false): in a true 1-wide the nose
// overhang reads through the side walls, so nose-aware sensing would seal
// every corridor mouth. Corridor rigs pin this.
function senseLane(mob) {
  const axisProbe = mob.lane ? mob.lane.axis : snapCardinal(mob.yaw);
  const fitBody = (yaw) => {
    const base = (nx, nz) => fitsAt(mob, true, false, yaw, false, nx, nz);
    return (nx, nz) => base(nx, nz) && descendOk(mob, nx, nz);
  };
  const pointFree = (nx, nz, dirYaw) => fitBody(dirYaw)(nx, nz);
  const cellFree = makeCellFree(mob);
  const opens = classifyExits(mob.pos.x, mob.pos.z, axisProbe, pointFree, cellFree);
  const [pax, paz] = dirVec(axisProbe);
  const fwdOpen = pointFree(mob.pos.x + pax * PROBE_DIST, mob.pos.z + paz * PROBE_DIST, axisProbe);
  return { axisProbe, cellFree, opens, fwdOpen };
}

// Pre-lane flow: gap funnel when free walking is impossible with no lane
// (facing a wall with a through gap: offset narrowing mouth, house door,
// pen breach — mid-corridor turns stay blended, dead ends funnel inside
// the seek below), then open-space release (forward open and both flanks
// truly open — field, room middle, wide hall, never a corridor: commit
// straight out with the current heading bias instead of random spins, roam
// owns the next tick). Returns true/false when it handles the tick,
// undefined when a lane update is due.
function tryPreLane(mob, dt, supported, floating, sense) {
  if (!sense.fwdOpen && (mob.funnelCool ?? 0) <= 0 && !mob.lane) {
    const gap = scanGap(mob, sense.axisProbe);
    if (gap) return funnelDrive(mob, dt, gap, supported, floating);
  }
  if (mob.lane && sense.fwdOpen && flanksOpen(mob.pos.x, mob.pos.z, mob.lane.axis, sense.cellFree)) {
    dropLane(mob); mob.stuckT = 0;
    return false;
  }
  return undefined;
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
    const sdriveBase = (nx, nz) => fitsAt(mob, supported, floating, mob.yaw, false, nx, nz);
    return (nx, nz) => sdriveBase(nx, nz) && descendOk(mob, nx, nz);
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
  const cruiseBase = (nx, nz) => fitsAt(mob, supported, floating, mob.yaw, false, nx, nz);
  const { err, dist } = driveToward(mob, dt, mob.yawTarget, () => {
    return (nx, nz) => cruiseBase(nx, nz) && descendOk(mob, nx, nz);
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
  if (mob.servoStall > 0.75) {
    mob.lane = null; mob.servoStall = 0; mob.followCool = FOLLOW_COOL;
    return false;
  }
  if (res.event === "cruise") slideLateral(mob, dt, supported, floating, false);
  mob.stuckT = 0;
  return true;
}

// Corridor half-width for sequencing: peer straight ahead and close,
// sized past nose reach — a nose brushing a flank counts as a meeting
// even when both body centers stay clear. Slightly wider than the body
// sum so the yield engages before discs touch, not as they graze.
function corridorNeed(a, b) {
  return a.hw + b.hw + SEP_GAP + 0.65;
}

// Open-field cooperation: temporal yield only, for lane-less ticks only
// (the corridor servo keeps exact legacy behavior). Legal moves only:
// forward at stride speed, turning, slowing. Nothing here writes a
// position and nothing here stops a mob: a step that would overlap
// another mob is refused outright by the gate in tickFarmMob (like a
// wall), while this pass only eases off early on a collision course —
// proportionally to distance and time-to-CPA, so meets sequence smoothly
// instead of grinding. All deterministic, no rand stream.
export function avoidMobs(mob, peers, grid = null) {
  let slow = 1;
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  // Grid query is a radius superset of the PREDICT_RANGE skip below, so
  // the same peers are examined — only faster. Null grid = legacy scan.
  const list = grid
    ? queryMobGrid(grid, mob.pos.x, mob.pos.z, PREDICT_RANGE + 0.5, _avoidNear)
    : peers;
  for (let k = 0; k < list.length; k++) {
    const o = list[k];
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const ox = o.pos.x - mob.pos.x, oz = o.pos.z - mob.pos.z;
    const d2 = ox * ox + oz * oz;
    // The scan reaches the prediction horizon; every rule below keeps
    // its own tighter range.
    if (d2 > PREDICT_RANGE * PREDICT_RANGE || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    const ahead = (ox * fx + oz * fz) / d;
    if (ahead < AVOID_CONE) continue;
    const ofx = Math.sin(o.yaw), ofz = Math.cos(o.yaw);
    // Whether the peer sees me back: mutual pairs sequence by index (lower
    // holds its line, higher yields early), a follower always yields.
    const aheadO = -(ox * ofx + oz * ofz) / d;
    const oSees = aheadO > 0.2;
    if (oSees && (mob._peerIdx ?? 0) < (o._peerIdx ?? 0)) continue;
    const need = corridorNeed(mob, o);
    const floor = oSees ? YIELD_SLOW : FOLLOW_SLOW;
    // Close-range sequencing, continuous in distance and lateral offset —
    // no binary slam at a corridor edge.
    if (ahead > 0.5 && d < YIELD_DIST) {
      const rx = -Math.cos(mob.yaw), rz = Math.sin(mob.yaw);
      const lat = ox * rx + oz * rz;
      if (Math.abs(lat) < need) {
        slow = Math.min(slow, 1 - (1 - floor) * (1 - d / YIELD_DIST) * (1 - Math.abs(lat) / need));
      }
    }
    // Long-range CPA glide on committed intent: ease off up to PREDICT_T
    // ahead, proportionally to time-to-CPA. No corridor needed — the
    // miss distance is the corridor.
    if (ahead > 0.5) {
      const cpa = predictCPA(mob, o);
      if (cpa && cpa.miss < need) {
        slow = Math.min(slow, 1 - (1 - floor) * (1 - cpa.t / PREDICT_T));
      }
    }
  }
  return slow;
}

// Full per-mob tick: stuck detection, target refresh, servo/roam/wander
// planes, gravity/float vertical, cosmetic gait (scene only). pickTarget is
// injected (farm.js) so this stays world-free; it now validates whole
// strides, so pen fence and house walls bound it emergently (no pen fork).
// peers enables open-field cooperation (farm.js passes the dimension list;
// headless rigs pass their own pair or null for legacy solo behavior).
// grid (optional, same tick's buildMobGrid) accelerates every peer scan
// inside; null grid scans the full list with identical results.
export function tickFarmMob(mob, dt, pickTarget, rand = mob.rand ?? Math.random, peers = null, grid = null) {
  mob.wanderT -= dt;
  const dx = mob.target ? mob.target.x - mob.pos.x : 0;
  const dz = mob.target ? mob.target.z - mob.pos.z : 0;
  // Support state: the stuck watchdogs below probe voxels, and both
  // planes run on it — floating bodies are carried by water (drop gate
  // bypassed); airborne bodies keep walking while the fall stays within
  // maxDrop (spawn drops and void edges still make progress instead of
  // freezing mid-air), then fall straight and resume walking on landing;
  // grounded bodies obey the legal-step gate below.
  const surface = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h);
  const floating = surface != null;
  const supported = floating || hasSupport(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw);
  if (supported) mob.fallFrom = mob.pos.y;
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
    else { mob.stuckT = 0; mob._wiggles = 0; }
    // Progress watchdog: sample the target distance twice a second; two
    // samples without meaningful closing escalate like stillness. A fresh
    // target re-stamps the reference; a flying maneuver suppresses the
    // sampling outright (sidesteps legitimately open distance).
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
      // Blocked by another mob (a live peer overlaps the nose probe below —
      // a wall never reads here): wiggle first — re-face to an adjacent
      // wind and take one short step — then escalate to the full detour
      // after WIGGLE_MAX consecutive wiggles. Walls fall straight through
      // to a plain re-pick. Every commit turns at rate (spinning in place
      // past SPIN), so avoidance reads as left-right sidesteps, and any
      // real motion re-arms the wiggle above.
      let t = null, heading = null, wiggle = false;
      if (peers && mobBlocksAhead(mob, peers, grid) && (mob._wiggles ?? 0) < WIGGLE_MAX) {
        const w = pickWiggleTarget(mob, rand, peers, grid);
        if (w) { t = w.target; heading = w.heading; wiggle = true; mob._wiggles = (mob._wiggles ?? 0) + 1; }
      }
      if (!t) {
        const detour = peers ? pickDetourTarget(mob, rand, peers, grid) : null;
        t = detour ? detour.target : pickTarget(mob, rand, peers, grid);
        // Forced maneuver headings stay 8-wind so meetings read off a
        // discrete set (wiggle/detour already are); a plain re-pick keeps
        // the free-roam raw heading. The drive turns onto them at rate,
        // never jumping. t can still be null (wedged: nothing validates) —
        // the else below then just waits out a fresh span instead of
        // crashing on t.x.
        if (t) {
          heading = detour ? detour.heading
            : Math.atan2(t.x - mob.pos.x, t.z - mob.pos.z);
        }
        if (!detour) mob._wiggles = 0;
      }
      // Identical re-pick: the picker returned the very target we are
      // stuck on (pinned rig picker or repeated cell) — re-latching it
      // spins forever, since the same step refusal re-fires. Drop it so
      // the refresh below hands decide a fresh commit instead.
      if (t && mob.target && t.x === mob.target.x && t.z === mob.target.z) t = null;
      mob.target = t;
      if (t) {
        // Commit the maneuver like a roam stride: decide would otherwise
        // overwrite the fresh heading on the very next tick. Spans stay
        // short — a wiggle is one sidestep, a detour clears one blocker —
        // and a stale heading is how mobs wander off instead of passing.
        // A fresh maneuver voids any latched plan: the planner re-reads
        // the new commit next tick instead of fighting it.
        const span = wiggle ? WIGGLE_SPAN : Math.min(roamSpan(rand), DETOUR_SPAN);
        mob.roam = { mode: "commit", heading, target: t, tgt: t, t: 0, span };
        mob.wanderT = span;
        mob._detour = true;
        mob._planHold = null;
      } else {
        mob.wanderT = roamSpan(rand);
      }
      mob.stuckT = 0;
      } // end maneuver branch (wall-near soft refresh above skips it)
    }
  } else {
    mob.stuckT = 0;
    mob._progTgt = null; mob._progBad = 0; mob._progAge = 0;
  }
  mob.lastX = mob.pos.x;
  mob.lastZ = mob.pos.z;
  // A forced re-decide (follow session end) re-picks the target first, like
  // arrival or span expiry — wanderT no longer doubles as that signal.
  if (!mob.target || Math.hypot(dx, dz) < ARRIVE_D || mob.wanderT <= 0 || mob.redecide) {
    mob._detour = false;
    mob._planHold = null;
    mob.target = pickTarget(mob, rand, peers, grid);
    mob.wanderT = roamSpan(rand);
    mob.redecide = false;
  }
  // Roam stepping owns lane-less ticks the servo declines (the R2 upkeep
  // above already ran inside the servo tick). Lane-less ticks cooperate:
  // the avoidance pass returns a speed factor (yield) — slowing only,
  // never strafing — consumed by the roam commit below.
  const servoed = servoTick(mob, dt, supported, floating, rand);
  let roamed = false;
  let savedSpeed = 0;
  // Mob bodies count as obstacles for lane-less stepping (same Y level
  // only): a refused step stops at contact range instead of overlapping
  // past the brush budget, and the stuck re-pick below routes around true
  // blockers. Picks and detection stay exact; only real steps may brush.
  const blockedByMob = peers && !mob.lane
    ? (nx, nz) => mobBlockedAt(mob, nx, nz, mob.pos.y, peers, 0, grid, CROSS_BUDGET)
    : null;
  if (!servoed && supported && !floating) {
    let slow = 1;
    if (peers && !mob.lane) slow = avoidMobs(mob, peers, grid);
    // Group plan (forecast.js, latched): a forced heading overrides the
    // commit target while the hold lasts, and its slow factor floors the
    // pairwise yield — except on a committed maneuver (wiggle/detour),
    // which flies its own validated line undisturbed: yanking a sidestep
    // mid-flight is the left-right dance. The slowdown still applies, so
    // maneuvers sequence temporally with the group. Null plan (or lane
    // motion) keeps legacy behavior.
    const plan = peers && !mob.lane && mob._plan?.forced ? mob._plan : null;
    if (plan) slow = Math.min(slow, plan.slow);
    if (slow !== 1) { savedSpeed = mob.speed; mob.speed *= slow; }
    roamed = roamStep(mob, dt, supported, floating, rand, pickTarget, blockedByMob,
      plan && !mob._detour ? plan.heading : null);
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
      const base = (nx, nz) => fitsAt(mob, supported, floating, mob.yaw, true, nx, nz);
      return blockedByMob ? (nx, nz) => base(nx, nz) && !blockedByMob(nx, nz) : base;
    };
    // Forced plans are already snapped at plan time; free wander keeps
    // the raw heading.
    const planYaw = mob._plan?.forced && !mob.lane ? mob._plan.heading : null;
    driveToward(mob, dt,
      planYaw ?? Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z),
      makeWander, moveClamped, { gated: false });
  }
  // One-tick plan: consumed above (roam or wander) or ignored (servo) —
  // never carried over, the planner re-runs (and re-latches holds) every
  // tick off live positions.
  mob._plan = null;
  if (savedSpeed) mob.speed = savedSpeed;
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
    const nose = mob.nose, tail = mob.tail;
    const w = worstPairPenAt(x, z, sx, sz, mob.hw + extra, nose, tail, o, 0, 0);
    // allow = 0 keeps the legacy exact gate (any touch blocks); a brush
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
    if (!fitsAt(mob, supported, floating, yaw, true, mob.pos.x, mob.pos.z)) return true;
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

// Wiggle target: minimal in-place avoidance — re-face to an adjacent wind
// and take one short step, keeping the same side while it gains ground so
// consecutive sidesteps read as one frank maneuver instead of a dance.
// The side flips only when the last wiggle bought no motion (a wedge the
// other side must break). The drive turns onto the wind at rate (spinning
// in place past SPIN), so no motion is wasted walking around a peer that
// only needs a sidestep.
// Returns {target, heading} or null (caller escalates to the detour).
export function pickWiggleTarget(mob, rand, peers, grid = null) {
  if (!peers || !mob.target) return null;
  if (mob._wiggleSide == null) mob._wiggleSide = rand() < 0.5 ? 1 : -1;
  else if (mob._wiggleFrom) {
    const gained = Math.hypot(mob.pos.x - mob._wiggleFrom.x, mob.pos.z - mob._wiggleFrom.z);
    if (gained < 0.1) mob._wiggleSide = -mob._wiggleSide;
  } else mob._wiggleSide = -mob._wiggleSide;
  const cur = snap8(mob.yaw);
  const blocked = (x, z) => mobBlockedAt(mob, x, z, mob.pos.y, peers, PICK_COMFORT, grid);
  for (const dh of [mob._wiggleSide * Math.PI / 4, -mob._wiggleSide * Math.PI / 4]) {
    const heading = normYaw(cur + dh);
    const tx = mob.pos.x + Math.sin(heading) * WIGGLE_DIST;
    const tz = mob.pos.z + Math.cos(heading) * WIGGLE_DIST;
    if (blocked((mob.pos.x + tx) / 2, (mob.pos.z + tz) / 2) || blocked(tx, tz)) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, tx, tz)) continue;
    // Nose-tip endpoint: the commit drive refuses nose contact in every
    // mode, so a sidestep must not commit where the drive won't go — a
    // doomed commit stalls mid-flight and re-fires into churn (and snout
    // grazes along walls). Mirrors the free-stride nose check in step.js.
    const nx = tx + Math.sin(heading) * mob.nose.along;
    const nz = tz + Math.cos(heading) * mob.nose.along;
    if (aabbIntersectsSolid(nx, mob.pos.y, nz, mob.nose.r, mob.h)) continue;
    mob._wiggleFrom = { x: mob.pos.x, z: mob.pos.z };
    return { target: { x: tx, z: tz }, heading };
  }
  return null;
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
      // Nose-tip endpoint (see wiggle above): no doomed commits the drive
      // would refuse to finish.
      const nx = tx + sx * mob.nose.along, nz = tz + cz * mob.nose.along;
      if (aabbIntersectsSolid(nx, mob.pos.y, nz, mob.nose.r, mob.h)) continue;
      return { target: { x: tx, z: tz }, heading };
    }
  }
  return null;
}

// Hard separation safety net over one dimension's mobs: positional
// depenetration on the yaw-oriented body circles (core + nose + tail),
// worst circle pair first, up to 8 iterations (dense pen pileups cascade:
// clearing one pair can press another, so 3 iterations leave residue).
// A vetoed side stays put and the other side takes the full correction;
// both vetoed keeps the overlap for this tick (rare — wall sandwich — and
// retried next tick). This is the last resort only: open-field avoidance
// (yield + step gate + stuck wiggle/detour) keeps pairs apart before
// contact, so the pass usually finds nothing to do. Y-gated so a faller never shoves
// a walker below.
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
        if (!w) continue;
        let da = w.pen / 2, db = w.pen / 2;
        if (!sepSpotFree(a, a.pos.x + w.nx * da, a.pos.z + w.nz * da)) { da = 0; db = w.pen; }
        if (!sepSpotFree(b, b.pos.x - w.nx * db, b.pos.z - w.nz * db)) {
          db = 0;
          if (da === 0) continue;
        }
        a.pos.x += w.nx * da;
        a.pos.z += w.nz * da;
        b.pos.x -= w.nx * db;
        b.pos.z -= w.nz * db;
        moved = true;
      }
    }
    if (!moved) break;
  }
}
