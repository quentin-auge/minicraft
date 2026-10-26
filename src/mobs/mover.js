// Farm-mob kinematics: the 1-wide corridor servo, stepping, falling, and
// separation. Three-free and headless-testable: positions are plain
// {x, y, z} writes, visuals are guarded behind `mob.root` (null headless).
// Shared step physics live in step.js (R0), the gap scan in gaps.js (R5),
// the directional policy in corridor.js; farm.js owns the meshes, spawning,
// and lifecycle. Headless rigs drive this module on live voxels.
import { FARM_WALK_DIVISOR } from "./livestock.js";
import {
  PROBE_DIST, normYaw, dirVec, cellCenter, oppositeYaw, snapCardinal,
  classifyExits, updateLane, flanksOpen,
} from "./corridor.js";
import {
  aabbIntersectsSolid, hasSupport,
  liquidSurface, footingOk, headroomOk,
  makeCellFree, makeStepOk, descendOk, turnTo,
  moveClamped, moveVector, driveToward, dropLane, spawnRng, stepVertical,
} from "./step.js";
import { scanGap, FUNNEL_GIVEUP, FUNNEL_COOL } from "./gaps.js";
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
      if (!holdLine || near) {
        if (ax === 0) ccx = vw.line; else ccz = vw.line;
      }
    }
  }
  const e = (ccx - mob.pos.x) * -az + (ccz - mob.pos.z) * ax;
  const cap = mob.speed * dt * 0.9;
  const c = Math.max(-cap, Math.min(cap, e));
  if (Math.abs(c) <= 1e-4) return 0;
  const centerBase = makeStepOk(mob, supported, floating, 0, mob.lane.axis, 0);
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
function senseLane(mob) {
  const axisProbe = mob.lane ? mob.lane.axis : snapCardinal(mob.yaw);
  const fitBody = (yaw) => {
    const base = makeStepOk(mob, true, false, 0, yaw, 0);
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
    const sdriveBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
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
  const cruiseBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
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

// Full per-mob tick: stuck detection, target refresh, servo/roam/wander
// planes, gravity/float vertical, cosmetic gait (scene only). pickTarget is
// injected (farm.js) so this stays world-free; it now validates whole
// strides, so pen fence and house walls bound it emergently (no pen fork).
export function tickFarmMob(mob, dt, pickTarget, rand = mob.rand ?? Math.random) {
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
  // A forced re-decide (follow session end) re-picks the target first, like
  // arrival or span expiry — wanderT no longer doubles as that signal.
  if (!mob.target || Math.hypot(dx, dz) < ARRIVE_D || mob.wanderT <= 0 || mob.redecide) {
    mob.target = pickTarget(mob, rand);
    mob.wanderT = roamSpan(rand);
    mob.redecide = false;
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
  const servoed = servoTick(mob, dt, supported, floating);
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
