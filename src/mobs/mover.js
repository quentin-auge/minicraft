// Farm-mob kinematics: collision probes, the unified blocked predicate,
// the 1-wide corridor servo, stepping, falling, and separation.
// Three-free and headless-testable: positions are plain {x, y, z} writes,
// visuals are guarded behind `mob.root` (null headless). farm.js owns the
// meshes, spawning, and lifecycle; the policy lives in corridor.js.
import { BLOCK_INFO, isLiquid } from "../core/blocks.js";
import { getBlock } from "../core/store.js";
import {
  dropAllowed, floatTargetY, FARM_WALK_DIVISOR,
} from "./livestock.js";
import {
  PROBE_DIST, normYaw, dirVec, cellCenter, oppositeYaw, snapCardinal,
  classifyExits, updateLane, flanksOpen,
} from "./corridor.js";
import { roamManage, roamStep, roamSpan, ARRIVE_D, FOLLOW_COOL } from "./roam.js";

// Base stride speed straight from master's pig/cow walk; the divisor slows
// it to a farm amble.
const MASTER_WALK = 4.3;
export const FARM_WALK = MASTER_WALK / FARM_WALK_DIVISOR;
export const GRAVITY = 22;
export const TURN_RATE = 3;
// 1-wide servo tuning: tighter yaw for clean corner arcs. The servo drive
// senses with the body box + body column only (nose 0, footNose 0): the
// body (hw 0.32) is already the widest lateral part, and any forward nose
// reach rakes the inner corner of every chicane into micro-stops. Core
// footing + body box keep every drop illegal exactly as elsewhere.
// Yaw tracks the corner blend fast (tight arcs at full stride: a 90° swing
// covers ~0.4 m, inside one cell) — slowing down is never how a turn fits.
export const SERVO_TURN = 7;
// Virtual-lane half width: wall-following frames a lane this wide against
// the real wall (clearance ~0.43 at the middle, no graze).
export const VIRTUAL_W = 1.5;
// Rotate-in-place past this yaw error (U-turn starts, corner entries); below
// it forward speed scales with cos(error) for arc-while-moving fluidity.
export const SERVO_SPIN = 1.2;
// Corner swing duration: the junction blend turns entry→exit over this
// time, tracked by the fast servo yaw above so the drive never stops.
export const BLEND_T = 0.3;
// Gap funnel: forward blocked with a bounded through-hole ahead (offset
// narrowing mouth, door in the end wall). Lateral scan half-width/step at
// the forward distances; a single free offset counts since 1-wide mouths
// read exactly one body-fit offset until aligned; bounded flanks plus a
// through route along the axis reject side alcoves (corners stay blended).
// Give-up + cooldown bound any wedge.
export const FUNNEL_DISTS = [1.0, 1.6];
export const FUNNEL_LAT = 2.5;
export const FUNNEL_STEP = 0.25;
export const FUNNEL_MINW = 0.25;
export const FUNNEL_GIVEUP = 1.0;
export const FUNNEL_COOL = 2.0;
// Free wander step: heading + distance from the current position, never
// anchored anywhere. The pen holds mobs by physics (fence collision), not
// by steering — there is no wander center.
export const WANDER_MIN = 4;
export const WANDER_MAX = 10;
// Pushing against a wall toward an unreachable target re-picks this fast
// instead of waiting out wanderT, so a breach gets used instead of missed.
export const STUCK_T = 0.5;
// Separation gap added to every circle-pair need, and vertical gate:
// mobs more than this far apart in Y never interact.
export const SEP_GAP = 0.1;
export const SEP_Y = 1.2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const isSolidCell = (x, y, z) => !!BLOCK_INFO[getBlock(x, y, z)]?.solid;

export function aabbIntersectsSolid(px, py, pz, hw, h) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const y0 = Math.floor(py), y1 = Math.floor(py + h - 1e-4);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (by + 1 <= py || by >= py + h) continue;
        if (isSolidCell(bx, by, bz)) return true;
      }
  return false;
}

// Destination headroom on the center column only: catches a wall standing
// on the lower ground ahead without overlapping the step being descended
// (a full body box at the lower level always would, rejecting all drops).
export function centerHeadroom(px, feetY, pz, h) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (let by = Math.floor(feetY); by <= Math.floor(feetY + h - 1e-4); by++) {
    if (isSolidCell(bx, by, bz)) return false;
  }
  return true;
}

export function hasSupport(px, py, pz, hw) {
  // Touch rule: support counts only when a solid top touches the feet.
  // Reading a single layer below would report support while hovering up
  // to a full block above it (floor(py) - 1 is still the ground block),
  // freezing falls mid-air and poisoning every later drop read.
  // Footprint rule (any touching column holds): the mob walks clear of
  // a descent lip while still held, then falls it with gravity instead
  // of dropping straight onto the step's flank.
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  for (let bx = x0; bx <= x1; bx++)
    for (let bz = z0; bz <= z1; bz++) {
      if (bx + 1 <= px - hw || bx >= px + hw) continue;
      if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
      for (let by = Math.floor(py + 1e-3); by >= 0; by--) {
        if (isSolidCell(bx, by, bz)) {
          if (by + 1 >= py - 1e-3) return true;
          break;
        }
      }
    }
  return false;
}

// Highest liquid surface overlapping the body, or null when dry.
export function liquidSurface(px, py, pz, hw, h) {
  let top = null;
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const y0 = Math.floor(py), y1 = Math.floor(py + h);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++)
        if (isLiquid(getBlock(bx, by, bz))) top = top == null ? by + 1 : Math.max(top, by + 1);
  return top;
}

export function groundBelow(px, py, pz) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (let y = Math.floor(py); y > Math.floor(py) - 8 && y >= 0; y--) {
    if (isSolidCell(bx, y, bz)) return y + 1;
  }
  return null;
}

// Uniform void rule — the air-wall hitbox: the core + nose columns (the
// body and the leading head) must stand over legal ground (drop within
// maxDrop of refY). The decorative tail never leads a step — mobs turn,
// never reverse — so it stays out of the void probes: otherwise a tail
// overhanging a dead-end back wall would veto the very steps that walk
// out of it. yaw is injectable so corridor probes can test directions
// other than the current facing.
export function footingOkAt(mob, x, z, refY, yaw, noseAlong = null) {
  const nose = noseAlong ?? mob.nose.along;
  for (let i = 0; i < 2; i++) {
    const along = i === 0 ? 0 : nose;
    const g = groundBelow(x + Math.sin(yaw) * along, refY + 1, z + Math.cos(yaw) * along);
    if (g == null || !dropAllowed(refY, g, mob.maxDrop)) return false;
  }
  return true;
}

export function footingOk(mob, x, z, refY) {
  return footingOkAt(mob, x, z, refY, mob.yaw);
}

// Headroom over the core + nose columns at their own ground (tail excluded
// like above): a narrow pillar under the nose on the lower step blocks the
// descent like a wall.
export function headroomOkAt(mob, x, z, refY, yaw, noseAlong = null) {
  const nose = noseAlong ?? mob.nose.along;
  for (let i = 0; i < 2; i++) {
    const along = i === 0 ? 0 : nose;
    const cx = x + Math.sin(yaw) * along, cz = z + Math.cos(yaw) * along;
    if (!centerHeadroom(cx, groundBelow(cx, refY + 1, cz), cz, mob.h)) return false;
  }
  return true;
}

export function headroomOk(mob, x, z, refY) {
  return headroomOkAt(mob, x, z, refY, mob.yaw);
}

// Whole-cell walkability for branch classification: column solid-free over
// the body height, dry feet, legal ground underfoot with headroom above it.
// Same unified rule as the stepper, cell-quantized for neighbourhood tests.
export function makeCellFree(mob) {
  return (bx, bz) => {
    const refY = mob.pos.y;
    for (let by = Math.floor(refY); by <= Math.floor(refY + mob.h - 1e-4); by++) {
      if (isSolidCell(bx, by, bz)) return false;
    }
    if (isLiquid(getBlock(bx, Math.floor(refY), bz))) return false;
    const g = groundBelow(bx + 0.5, refY + 1, bz + 0.5);
    if (g == null || !dropAllowed(refY, g, mob.maxDrop)) return false;
    return centerHeadroom(bx + 0.5, g, bz + 0.5, mob.h);
  };
}

// One unified blocked predicate: solid overlap OR illegal ground under the
// body circles OR missing headroom. Corridor probes and the stepper share
// it, so air walls (drop > maxDrop) and physical walls read identically.
// footNose overrides the circle offset for the void probes: the corridor
// classifier passes 0 (body-only direction sensing, so 1-cell arms ending
// in a wall still read open), the drive passes the real nose reach.
export function makeStepOk(mob, supported, floating, noseAlong, yaw, footNose = null) {
  const foot = footNose ?? noseAlong;
  return (nx, nz) => {
    if (aabbIntersectsSolid(nx, mob.pos.y, nz, mob.hw, mob.h)) return false;
    const gx = nx + Math.sin(yaw) * noseAlong, gz = nz + Math.cos(yaw) * noseAlong;
    if (aabbIntersectsSolid(gx, mob.pos.y, gz, mob.nose.r, mob.h)) return false;
    if (floating) return true;
    // Bounded drift, gated on the takeoff level: legal descents keep
    // their glide, falls over void drop straight from the first tick.
    if (!supported) {
      return mob.fallFrom - mob.pos.y <= mob.maxDrop + 1e-3 && footingOkAt(mob, nx, nz, mob.fallFrom, yaw, foot);
    }
    if (!footingOkAt(mob, nx, nz, mob.pos.y, yaw, foot)) return false;
    return headroomOkAt(mob, nx, nz, mob.pos.y, yaw, foot);
  };
}

export function turnTo(mob, dt, rate = TURN_RATE) {
  const d = normYaw(mob.yawTarget - mob.yaw);
  mob.yaw += clamp(d, -rate * dt, rate * dt);
}

// Facing-first search for a free landing spot at level g: forward steps
// first (the descent direction), then diagonals, sides, back. Supported
// spots win; a merely-free spot still beats hovering (the fall resumes
// next tick). Rare path — only runs when the straight snap below would
// bury the body.
export function landUnwedged(mob, g) {
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  const dirs = [
    [fx, fz],
    [fx * 0.7 + fz * 0.7, fz * 0.7 - fx * 0.7], [fx * 0.7 - fz * 0.7, fz * 0.7 + fx * 0.7],
    [fz, -fx], [-fz, fx], [-fx, -fz],
  ];
  for (let pass = 0; pass < 2; pass++) {
    for (const [dx, dz] of dirs) {
      for (const d of [0.15, 0.3, 0.45]) {
        const cx = mob.pos.x + dx * d, cz = mob.pos.z + dz * d;
        if (aabbIntersectsSolid(cx, g, cz, mob.hw, mob.h)) continue;
        if (pass === 1 || (hasSupport(cx, g, cz, mob.hw) && footingOk(mob, cx, cz, g))) {
          mob.pos.x = cx;
          mob.pos.z = cz;
          if (pass === 0) mob.pos.y = g;
          return;
        }
      }
    }
  }
}

// Axis-separated clamped move: each axis takes the full step when legal,
// else halves toward the blocker. Free moves cost one predicate call;
// only refused steps pay the extra probes.
export function moveClamped(mob, nx, nz, stepOk) {
  let dx = nx - mob.pos.x;
  for (let i = 0; i < 4; i++) {
    const t = mob.pos.x + dx;
    if (stepOk(t, mob.pos.z)) { mob.pos.x = t; break; }
    dx /= 2;
  }
  let dz = nz - mob.pos.z;
  for (let i = 0; i < 4; i++) {
    const t = mob.pos.z + dz;
    if (stepOk(mob.pos.x, t)) { mob.pos.z = t; break; }
    dz /= 2;
  }
}

// Vector clamped move for the corridor servo: the full step is tested as
// one vector, then halved toward the blocker. Unlike the axis-separated
// wander move this never stair-steps around L corners.
export function moveVector(mob, nx, nz, stepOk) {
  const dx = nx - mob.pos.x, dz = nz - mob.pos.z;
  for (let i = 0; i < 5; i++) {
    const s = 1 / 2 ** i;
    const tx = mob.pos.x + dx * s, tz = mob.pos.z + dz * s;
    if (stepOk(tx, tz)) { mob.pos.x = tx; mob.pos.z = tz; return s; }
  }
  return 0;
}

// Descent gate for servo steps: the unified probe allows legal drops, but
// a descent the mob can never climb back out of (no step-up) is a trap —
// refuse steps down into a local minimum (pit) while letting ramps
// (walkable continuation at the lower level) and liquid entries
// (swim/float takes over) through. Flat ground short-circuits untouched.
function descendOk(mob, nx, nz) {
  const g = groundBelow(nx, mob.pos.y + 1, nz);
  if (g == null || g >= mob.pos.y - 1e-3) return true;
  for (let by = Math.floor(g); by <= Math.floor(mob.pos.y); by++) {
    if (isLiquid(getBlock(Math.floor(nx), by, Math.floor(nz)))) return true;
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const cx = Math.floor(nx) + dx + 0.5, cz = Math.floor(nz) + dz + 0.5;
    if (aabbIntersectsSolid(cx, g, cz, mob.hw, mob.h)) continue;
    const gg = groundBelow(cx, g + 1, cz);
    if (gg == null || Math.abs(gg - g) > 1e-3) continue;
    if (!centerHeadroom(cx, gg, cz, mob.h)) continue;
    return true;
  }
  return false;
}
// Doorway scan: facing a wall, look for a contiguous free run across the
// forward distances. A run counts only when walled on both flanks — a true
// hole, never an open edge — and when its middle cell runs on along the
// axis (a through route, never a side alcove). Runs touching the scan edge
// probe one step further to check the flank. Returns {axis, line}: the
// committed lateral line (through-cell middle for narrow mouths, run
// middle for true 2-wide gaps), or null.
export function scanGap(mob, axisYaw, blockAt) {
  const [fx, fz] = dirVec(axisYaw);
  const latx = -fz, latz = fx;
  const cellFree = makeCellFree(mob);
  const at = (dist, o) => blockAt(
    mob.pos.x + fx * dist + latx * o, mob.pos.z + fz * dist + latz * o);
  for (const dist of FUNNEL_DISTS) {
    let best = null, runStart = null, prev = 0;
    const close = () => {
      if (runStart == null) return;
      const width = prev - runStart + FUNNEL_STEP;
      const boundedL = runStart > -FUNNEL_LAT + 1e-9 || at(dist, runStart - FUNNEL_STEP);
      const boundedR = prev < FUNNEL_LAT - 1e-9 || at(dist, prev + FUNNEL_STEP);
      const center = (runStart + prev) / 2;
      const mcx = Math.floor(mob.pos.x + fx * dist + latx * center);
      const mcz = Math.floor(mob.pos.z + fz * dist + latz * center);
      const through = cellFree(mcx + fx, mcz + fz) && cellFree(mcx - fx, mcz - fz);
      // Transit: the mob must be able to slide to the mouth — every
      // lateral sample from the axis to the run centre, taken on the mob's
      // own row (where the slide happens), must itself fit. Without this a
      // parallel corridor past solid rock reads as a gap (mouth walks,
      // through route holds beyond the walls) and the funnel grinds along
      // the wall toward an unreachable line, gives up, and drops the lane.
      // Runs straddling the axis always pass.
      let transit = true;
      const step = center > 0 ? FUNNEL_STEP : -FUNNEL_STEP;
      for (let o = 0; transit && Math.abs(o) <= Math.abs(center) + 1e-9; o += step) {
        if (at(0, o)) transit = false;
      }
      if (width >= FUNNEL_MINW && boundedL && boundedR && through && transit &&
          (!best || width > best.width ||
            (width === best.width && Math.abs(center) < Math.abs(best.center)))) {
        best = { width, center, mcx, mcz };
      }
      runStart = null;
    };
    for (let o = -FUNNEL_LAT; o <= FUNNEL_LAT + 1e-9; o += FUNNEL_STEP) {
      if (!at(dist, o)) { if (runStart == null) runStart = o; prev = o; }
      else close();
    }
    close();
    if (best) {
      const narrow = best.width < 1.0;
      const line = (fx === 0)
        ? (narrow ? best.mcx + 0.5 : mob.pos.x + latx * best.center)
        : (narrow ? best.mcz + 0.5 : mob.pos.z + latz * best.center);
      return { axis: axisYaw, line };
    }
  }
  return null;
}

// Funnel drive toward the committed lateral line: face the axis, advance
// forward and slide sideways as two independently gated moves (never one
// diagonal — diagonals wedge into step-wall pockets). Give-up + cooldown
// bound any wedge; the normal flow resumes past the constriction.
export function funnelDrive(mob, dt, funnel, supported, floating) {
  const { axis, line } = funnel;
  const [ax, az] = dirVec(axis);
  mob.yawTarget = axis;
  turnTo(mob, dt, SERVO_TURN);
  const err = Math.abs(normYaw(mob.yawTarget - mob.yaw));
  // Level routes only (see descendOk): a funnel that descends into a pit
  // strands the mob below with no way back up.
  const driveOk = (nx, nz) =>
    makeStepOk(mob, supported, floating, 0, mob.yaw, 0)(nx, nz) && descendOk(mob, nx, nz);
  let moved = false;
  if (err < SERVO_SPIN) {
    const stride = mob.speed * Math.max(0, Math.cos(Math.min(err, Math.PI / 2))) * dt;
    if (stride > 1e-6) {
      const bx = mob.pos.x, bz = mob.pos.z;
      moveVector(mob, bx + Math.sin(mob.yaw) * stride, bz + Math.cos(mob.yaw) * stride, driveOk);
      moved = moved || Math.hypot(mob.pos.x - bx, mob.pos.z - bz) > 1e-6;
    }
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
  if (!moved && err < SERVO_SPIN) mob.funnelT = (mob.funnelT ?? 0) + dt;
  else if (moved) mob.funnelT = 0;
  if ((mob.funnelT ?? 0) > FUNNEL_GIVEUP) {
    mob.funnelT = 0; mob.funnelCool = FUNNEL_COOL;
    return false;
  }
  mob.stuckT = 0;
  return true;
}

// Segment walkability: the whole heading+dist strides legal — body fits
// at 0.5 m samples (overlapping coverage: 0.5 step < 0.64 body, no blind
// spots at voxel scale) with chained legal steps (never up, down at most
// maxDrop per sample, same dropAllowed as the stepper), dry feet at the
// destination (water en route stays swimmable for float walkers). One
// shared validation behind the farm picker and roam commits: picked
// targets never aim through walls, over cliffs, or uphill, so fences,
// house walls, and troughs bound targets emergently — no pen fork.
export function segmentWalkable(mob, x0, z0, x1, z1) {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  let prevG = groundBelow(x0, mob.pos.y + 1, z0);
  if (prevG == null) return false;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    if (aabbIntersectsSolid(x, mob.pos.y, z, mob.hw, mob.h)) return false;
    const g = groundBelow(x, mob.pos.y + 1, z);
    if (g == null) return false;
    if (g > prevG + 1e-3 || prevG - g > mob.maxDrop + 1e-3) return false;
    prevG = g;
    if (!centerHeadroom(x, g, z, mob.h)) return false;
  }
  return true;
}

// Shared stride target: random heading (or the given one) + 4–10 m, first
// validating (destination rules + whole segment). Single pick path for the
// farm picker and roam commits.
export function strideTarget(mob, heading = null, rand = Math.random) {
  for (let t = 0; t < 12; t++) {
    const h = heading ?? rand() * Math.PI * 2;
    const dist = WANDER_MIN + rand() * (WANDER_MAX - WANDER_MIN);
    const sx = Math.floor(mob.pos.x + Math.sin(h) * dist) + 0.5;
    const sz = Math.floor(mob.pos.z + Math.cos(h) * dist) + 0.5;
    const gy = groundBelow(sx, mob.pos.y + 1, sz);
    if (gy == null) continue;
    if (!dropAllowed(mob.pos.y, gy, mob.maxDrop ?? 1)) continue;
    if (isLiquid(getBlock(Math.floor(sx), gy, Math.floor(sz)))) continue;
    if (!centerHeadroom(sx, gy, sz, mob.h)) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, sx, sz)) continue;
    return { x: sx, z: sz };
  }
  return null;
}

// Permanent 1-path centering: the cruise-path lateral slide, callable on
// every lane event (engage/junction/lock-turn, dead-end seek) — never
// straights-only — so blend arcs exit centered and turns never slide
// sideways. Same target as the cruise path (follow-line middle while
// wall-following, with opposite headings sharing the line, else the cell
// centre); the axisOk probe below refuses any slide into a wall, so
// junction mouths stay honest. Returns the applied slide (0 when refused)
// so the stall guard can credit it as progress.
function center1Wide(mob, dt, supported, floating) {
  const [ax, az] = dirVec(mob.lane.axis);
  let ccx = cellCenter(mob.pos.x), ccz = cellCenter(mob.pos.z);
  const vw = mob.followLine;
  if (vw) {
    const dd = Math.abs(normYaw(vw.axis - mob.lane.axis));
    if (dd < 1e-6 || dd > Math.PI - 1e-6) {
      // Hold a virtual line the body is already riding; a stale line far
      // from the body is ignored in favour of the centre (following it
      // would drag the turn into the wall it was latched against).
      if (ax === 0 && Math.abs(mob.pos.x - vw.line) <= Math.abs(mob.pos.x - ccx)) ccx = vw.line;
      if (ax !== 0 && Math.abs(mob.pos.z - vw.line) <= Math.abs(mob.pos.z - ccz)) ccz = vw.line;
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
// voxels, so branch visibility and ground truth stay exact.
export function servoTick(mob, dt, supported, floating, rand = Math.random) {
  if (!supported || floating) { mob.lane = null; return false; }
  if ((mob.funnelCool ?? 0) > 0) mob.funnelCool -= dt;
  // Body-only direction sensing (footNose 0, no nose disc): the classifier
  // asks which cells fit the body, so 1-cell arms ending in a wall still
  // read open. descendOk gates pit mouths: a legal drop into a local
  // minimum reads as a wall (the drives below refuse it too), so the lane
  // U-turns at the lip instead of funneling or cruising in.
  // The drive below keeps the real nose reach.
  const axisProbe = mob.lane ? mob.lane.axis : snapCardinal(mob.yaw);
  const fitBody = (yaw) => {
    const base = makeStepOk(mob, true, false, 0, yaw, 0);
    return (nx, nz) => base(nx, nz) && descendOk(mob, nx, nz);
  };
  const blockAt = (x, z) => !fitBody(axisProbe)(x, z);
  const pointFree = (nx, nz, dirYaw) => fitBody(dirYaw)(nx, nz);
  const cellFree = makeCellFree(mob);
  const opens = classifyExits(mob.pos.x, mob.pos.z, axisProbe, pointFree, cellFree);
  // Open-space release: forward open and both flanks truly open (near and
  // far cells walk with continuity — field, room middle, wide hall; never
  // a corridor). Commit straight out with the current heading bias instead
  // of random spins; roam owns the next tick.
  const [pax, paz] = dirVec(axisProbe);
  const fwdOpen = pointFree(mob.pos.x + pax * PROBE_DIST, mob.pos.z + paz * PROBE_DIST, axisProbe);
  // Gap funnel when free walking is impossible with no lane (facing a wall
  // with a through gap: offset narrowing mouth, house door, pen breach).
  // Mid-corridor turns stay blended; dead ends funnel inside uturn below.
  if (!fwdOpen && (mob.funnelCool ?? 0) <= 0 && !mob.lane) {
    const gap = scanGap(mob, axisProbe, blockAt);
    if (gap) return funnelDrive(mob, dt, gap, supported, floating);
  }
  if (mob.lane && fwdOpen && flanksOpen(mob.pos.x, mob.pos.z, mob.lane.axis, cellFree)) {
    mob.lane = null; mob.blendFrom = null; mob.blendT = 0; mob.stuckT = 0;
    return false;
  }
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const res = updateLane(mob.lane, cx, cz, mob.yaw, opens, rand);
  if (!res.lane) { mob.lane = null; return false; }
  mob.lane = res.lane;
  // Dead-end seek: the classifier reads a wall 1.3 m out, but up to 0.6 m
  // of corridor may remain. Walk nose-to-the-end first, flip only when the
  // drive itself refuses — the mob touches the back wall, then U-turns.
  if (res.event === "uturn") {
    const forward = mob.lane.entry; // pre-flip axis: updateLane already swapped
    // Dead end facing a through gap (offset narrowing mouth, door in the
    // end wall): funnel into it, dropping the flipped lane so the funnel
    // re-fires every tick until through (a kept flip would cruise back).
    // Side mouths never qualify (no through route along the axis), so
    // junction corners stay blended.
    if ((mob.funnelCool ?? 0) <= 0) {
      const gap = scanGap(mob, forward, blockAt);
      if (gap) {
        mob.lane = null; mob.blendFrom = null; mob.blendT = 0;
        return funnelDrive(mob, dt, gap, supported, floating);
      }
    }
    mob.yawTarget = forward;
    turnTo(mob, dt, SERVO_TURN);
    const serr = Math.abs(normYaw(mob.yawTarget - mob.yaw));
    // Recentre first (no corridor gate: a corner wedge is never a true
    // 1-wide cell, and that is exactly when the seek needs centring —
    // the axisOk probe below refuses any slide into a wall, and a stale
    // flipped follow line still pins the lateral via modulo-π).
    center1Wide(mob, dt, supported, floating);
    const sstride = mob.speed * Math.max(0, Math.cos(Math.min(serr, Math.PI / 2))) * dt;
    // Dead-end seek refuses pit descents (see descendOk): the pit lip is
    // the end of the line — touch it, turn, leave.
    const sdriveBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
    const sdrive = (nx, nz) => sdriveBase(nx, nz) && descendOk(mob, nx, nz);
    let sscale = 0;
    if (serr < SERVO_SPIN && sstride > 1e-6) {
      sscale = moveVector(
        mob,
        mob.pos.x + Math.sin(mob.yaw) * sstride,
        mob.pos.z + Math.cos(mob.yaw) * sstride,
        sdrive,
      );
    }
    if (sscale > 0) {
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
  if (res.event === "junction" || res.event === "lock-turn") {
    // Timed blend: swing from the entry heading toward the exit axis over
    // BLEND_T, starting exactly at the current yaw — never a snap, so the
    // drive never spins in place. Distance-based blending deadlocks (the
    // target converges only as the mob nears the cell centre, but the
    // nose-footing probe can refuse that very approach); time converges
    // regardless of position, and the drive probes keep every arc honest.
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
  turnTo(mob, dt, SERVO_TURN);
  const err = Math.abs(normYaw(mob.yawTarget - mob.yaw));
  const stride = mob.speed * Math.max(0, Math.cos(Math.min(err, Math.PI / 2))) * dt;
  // Cruise never descends into a pit (see descendOk): ramps with a
  // walkable continuation pass through, local minima read as walls.
  const cruiseBase = makeStepOk(mob, supported, floating, 0, mob.yaw, 0);
  const driveOk = (nx, nz) => cruiseBase(nx, nz) && descendOk(mob, nx, nz);
  let scale = 1;
  if (err < SERVO_SPIN && stride > 1e-6) {
    scale = moveVector(
      mob,
      mob.pos.x + Math.sin(mob.yaw) * stride,
      mob.pos.z + Math.cos(mob.yaw) * stride,
      driveOk,
    );
  }
  // Stall guard: a latched lane that cannot advance (nose wedged where the
  // body fits) releases to the wander instead of freezing in place. A
  // successful 1-wide recentre counts as progress, not a stall.
  const recentered = res.event === "cruise"
    ? 0
    : center1Wide(mob, dt, supported, floating);
  if (scale === 0 && recentered === 0 && err < SERVO_SPIN) mob.servoStall = (mob.servoStall ?? 0) + dt;
  else mob.servoStall = 0;
  if (mob.servoStall > 0.75) {
    mob.lane = null; mob.servoStall = 0; mob.followCool = FOLLOW_COOL;
    return false;
  }
  // Lateral centering on straights: yaw stays locked on the corridor
  // axis (no hunting), the body slides toward the lane middle when free —
  // the cell centre in a true 1-wide corridor, the virtual-lane middle
  // while wall-following. Turns and seeks centre through center1Wide above.
  if (res.event === "cruise") {
    const [ax, az] = dirVec(mob.lane.axis);
    let ccx = cellCenter(mob.pos.x), ccz = cellCenter(mob.pos.z);
    const vw = mob.followLine;
    if (vw) {
      // Same corridor line reads the same middle from either direction.
      const vdd = Math.abs(normYaw(vw.axis - mob.lane.axis));
      if (vdd < 1e-6 || vdd > Math.PI - 1e-6) {
        if (ax === 0) ccx = vw.line; else ccz = vw.line;
      }
    }
    const e = (ccx - mob.pos.x) * -az + (ccz - mob.pos.z) * ax;
    const cap = mob.speed * dt * 0.9;
    const c = Math.max(-cap, Math.min(cap, e));
    if (Math.abs(c) > 1e-4) {
      const cruiseAxisBase = makeStepOk(mob, supported, floating, 0, mob.lane.axis, 0);
      const axisOk = (nx, nz) => cruiseAxisBase(nx, nz) && descendOk(mob, nx, nz);
      const tx = mob.pos.x + -az * c, tz = mob.pos.z + ax * c;
      if (axisOk(tx, tz)) { mob.pos.x = tx; mob.pos.z = tz; }
    }
  }
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
  // Roam management (virtual upkeep, target identity) runs gated like the
  // servo; roam stepping owns lane-less ticks the servo declines.
  const api = {
    turnTo, moveClamped, makeStepOk, makeCellFree,
    pickTarget, strideTarget, virtualW: VIRTUAL_W,
  };
  if (supported && !floating) roamManage(mob, dt, api);
  // 1-wide servo first: grounded dry mobs on walled paths cruise their
  // corridor instead of chasing the wander target through walls.
  const servoed = servoTick(mob, dt, supported, floating);
  let roamed = false;
  if (!servoed && supported && !floating) roamed = roamStep(mob, dt, api, supported, floating);
  if (mob.target && !servoed && !roamed) {
    mob.yawTarget = Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z);
    turnTo(mob, dt);
    const fx = Math.sin(mob.yaw) * mob.speed * dt;
    const fz = Math.cos(mob.yaw) * mob.speed * dt;
    // Legal-step gate (non-jumping walkers): never up, down at most
    // maxDrop. A deeper drop is a vertical air wall — rejected exactly
    // like solid, so the stuck detector re-picks instead of cliff walking.
    // The destination test is passage-at-current-height plus headroom on
    // the center column: a full body box posed at the lower level would
    // overlap the very step being descended and reject every descent.
    // Plus a nose-circle probe ahead along the facing: the visual head
    // sticks out past hw, so the body test alone would let it grind
    // into walls.
    const stepOk = makeStepOk(mob, supported, floating, mob.nose.along, mob.yaw);
    const nx = mob.pos.x + fx;
    const nz = mob.pos.z + fz;
    // Clamp by halving: a refused step retries at half distance, so the
    // mob slides up against the blocker (wall or nose contact) instead
    // of stopping a full step away or grinding from afar.
    // (Mob-vs-mob distance is a post-tick pass, not a steering push.)
    moveClamped(mob, nx, nz, stepOk);
  }
  // Vertical: float on liquids (2/3 out), stand when supported, otherwise
  // gravity — every descent falls, including legal 1-block steps. Landing
  // snaps to the support top so feet stay exact: without it mobs would
  // hover after a fall and every later drop would read too deep.
  // (surface/supported computed above drive the planes; reused here.)
  if (surface != null) {
    const ty = floatTargetY(surface, mob.h);
    mob.pos.y += (ty - mob.pos.y) * Math.min(1, dt * 4);
    mob.vel.y = 0;
  } else if (hasSupport(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw)) {
    mob.vel.y = 0;
  } else {
    mob.vel.y = Math.max(-30, mob.vel.y - GRAVITY * dt);
    const ny = mob.pos.y + mob.vel.y * dt;
    if (!aabbIntersectsSolid(mob.pos.x, ny, mob.pos.z, mob.hw, mob.h)) {
      mob.pos.y = ny;
    } else {
      mob.vel.y = 0;
      // Landing contact: refused moves hover, so settle onto the support
      // top — landing only, never lifting (embedded spawns are the debug
      // spawner's own guard, not the mover's). Snap only onto a free
      // spot: snapping into the step's flank is exactly how mobs get
      // buried in the block they descend from.
      const g = groundBelow(mob.pos.x, mob.pos.y, mob.pos.z);
      if (g != null && g <= mob.pos.y + 1e-3) {
        if (!aabbIntersectsSolid(mob.pos.x, g, mob.pos.z, mob.hw, mob.h)) {
          mob.pos.y = g;
        } else {
          landUnwedged(mob, g);
        }
      }
    }
  }
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
