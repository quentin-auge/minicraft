// Shared step physics (R0): the single ground truth behind every mover,
// probe, and push. Collision probes, the unified blocked predicate
// (makeStepOk: solid overlap OR illegal ground under the core+nose columns
// OR missing headroom — air walls and physical walls read identically), the
// pit guard (descendOk: a descent with no same-level continuation is a wall),
// stride validation, the two gated moves (vector for the servo, axis-
// separated for the wander), the unified drive (driveToward) behind the
// funnel, the roam commit, and the wander fallback, the vertical plane
// (stepVertical), and the shared lane teardown (dropLane). Three-free;
// positions are plain {x, y, z}.
import { BLOCK_INFO, isLiquid } from "../core/blocks.js";
import { getBlock } from "../core/store.js";
import { dropAllowed, floatTargetY } from "./livestock.js";
import { normYaw } from "./corridor.js";
import { noseOn, strideMargin } from "./collide.js";

// Turn rate: how fast mobs re-face. Shipped at 3 (measured: calm turns,
// few re-aims in the pen); faster turns cut spin-stall but read twitchy.
export const TURN_RATE = 3;
// Rotate-in-place past this yaw error; below it forward speed scales with
// cos(error) for arc-while-moving fluidity. Shared by the servo and roam.
export const SPIN = 1.2;
// Virtual-lane half width: wall-following frames a lane this wide against
// the real wall (clearance ~0.43 at the middle, no graze).
export const VIRTUAL_W = 1.5;
// Free wander stride: heading + distance from the current position, never
// anchored anywhere. The pen holds mobs by physics (fence collision), not
// by steering — there is no wander center.
export const WANDER_MAX = 10;
// Stride floor: shortest committed stride (pen scale). Reach extends up to
// the measured clearance along the heading, so open ground keeps long
// strides while small enclosures get short fitting ones — no pen fork.
export const STRIDE_FLOOR = 0.8;
// Destination margin lives in the collide.js mode table (A may end at
// nose contact, B stops a body margin short of the first blocking cell).
// Latched targets never expire on their own (refresh comes from arrival,
// stuck, re-decide, or span timeout — never from this clock).
export const NO_EXPIRY = 1e9;
// Gravity for the vertical plane (farm-mob fall speed).
export const GRAVITY = 22;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// One gated drive behind the funnel, the roam commit, and the wander
// fallback: face yawTarget at rate, then advance speed·cos(err) through
// the given clamped move (moveVector for the servo — it never stair-steps
// around L corners — moveClamped elsewhere, which slides along walls).
// makeStep is a factory, called after the turn: probes that capture the
// facing read the post-turn yaw exactly like the inline drives did, while
// probes closing over a pre-turn predicate keep it. Returns {err, dist} —
// dist 0 covers refused steps and spin-in-place ticks alike.
export function driveToward(mob, dt, yawTarget, makeStep, move, opts = {}) {
  const { rate = TURN_RATE, gated = true } = opts;
  mob.yawTarget = yawTarget;
  turnTo(mob, dt, rate);
  const err = Math.abs(normYaw(mob.yawTarget - mob.yaw));
  const stride = mob.speed * dt * (gated ? Math.max(0, Math.cos(Math.min(err, Math.PI / 2))) : 1);
  if ((gated && (err >= SPIN || stride <= 1e-6)) || stride <= 0) return { err, dist: 0 };
  const stepOk = makeStep();
  const bx = mob.pos.x, bz = mob.pos.z;
  move(mob, bx + Math.sin(mob.yaw) * stride, bz + Math.cos(mob.yaw) * stride, stepOk);
  return { err, dist: Math.hypot(mob.pos.x - bx, mob.pos.z - bz) };
}

// Tiny deterministic PRNG (mulberry32): junction randomness gets its own
// stream per mob, seeded once from the ambient rand, so roam refactors
// never reshuffle junction outcomes. Trial seeds still drive variation
// (each trial seeds a different stream); the stream itself is then stable.
export function spawnRng(rand = Math.random) {
  let a = (rand() * 4294967296) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isSolidCell = (x, y, z) => !!BLOCK_INFO[getBlock(x, y, z)]?.solid;

// Lane teardown shared by the servo releases: clears the lane and its
// blend state (blend is only ever read under a lane, so resetting it here
// is invisible everywhere else).
export function dropLane(mob) {
  mob.lane = null; mob.blendFrom = null; mob.blendT = 0;
}

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
  for (let by = Math.floor(py); by > Math.floor(py) - 8 && by >= 0; by--) {
    if (isSolidCell(bx, by, bz)) return by + 1;
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

// THE point predicate: the mob can occupy (x, z) facing yaw — body box,
// support, footing, headroom, plus the nose circle when noseOn (footing
// and headroom then cover the nose column too, exactly like the drives).
// noseOn=false is the legacy body-only probe, bit-identical; noseOn=true
// is the drive predicate exactly. Use this for every yes/no occupancy
// question; distances raycast it.
export function fitsAt(mob, supported, floating, yaw, noseOn, x, z) {
  const along = noseOn ? mob.nose.along : 0;
  const foot = noseOn ? mob.nose.along : 0;
  return makeStepOk(mob, supported, floating, along, yaw, foot)(x, z);
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

// Descent gate for servo steps (R0b pit guard): the unified probe allows
// legal drops, but a descent the mob can never climb back out of (no
// step-up) is a trap — refuse steps down into a local minimum (pit) while
// letting ramps (walkable continuation at the lower level) and liquid
// entries (swim/float takes over) through. Flat ground short-circuits
// untouched.
export function descendOk(mob, nx, nz) {
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

// Shared stride target: random heading (or the given one) + stride length,
// first validating (destination rules plus the whole segment). Single pick
// path for the farm picker and roam commits. Reach follows the measured
// body clearance along the heading (short in pens, long in open ground),
// so targets fit the enclosure instead of overshooting its walls.
// Optional blocked(x, z) vetoes strides ending on another mob's body
// exactly like walls (mob-aware picks); passing near peers stays legal,
// only the destination cell is refused. Null keeps voxel-only validation.
export function strideTarget(mob, heading = null, rand = Math.random, blocked = null) {
  for (let t = 0; t < 12; t++) {
    const h = heading ?? rand() * Math.PI * 2;
    // Clearance probe: body box along the heading in 0.5 m steps (cheap
    // overlap checks only — the full voxel/drop/headroom validation runs
    // once below on the chosen target).
    const shx = Math.sin(h), shz = Math.cos(h);
    let clear = 0;
    for (let d = 0.5; d <= WANDER_MAX + 1e-9; d += 0.5) {
      if (aabbIntersectsSolid(mob.pos.x + shx * d, mob.pos.y, mob.pos.z + shz * d, mob.hw, mob.h)) break;
      clear = d;
    }
    const reach = Math.min(clear - strideMargin(), WANDER_MAX);
    if (reach < STRIDE_FLOOR) continue;
    const dist = STRIDE_FLOOR + rand() * (reach - STRIDE_FLOOR);
    const sx = Math.floor(mob.pos.x + shx * dist) + 0.5;
    const sz = Math.floor(mob.pos.z + shz * dist) + 0.5;
    const gy = groundBelow(sx, mob.pos.y + 1, sz);
    if (gy == null) continue;
    if (!dropAllowed(mob.pos.y, gy, mob.maxDrop ?? 1)) continue;
    if (isLiquid(getBlock(Math.floor(sx), gy, Math.floor(sz)))) continue;
    if (!centerHeadroom(sx, gy, sz, mob.h)) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, sx, sz)) continue;
    // Mode A: the destination must take the nose too — strides may end at
    // nose contact but never past it. Mode B keeps the body-only
    // destination with the table margin above.
    if (noseOn()) {
      const nx = sx + Math.sin(h) * mob.nose.along, nz = sz + Math.cos(h) * mob.nose.along;
      if (aabbIntersectsSolid(nx, mob.pos.y, nz, mob.nose.r, mob.h)) continue;
    }
    if (blocked && blocked(sx, sz)) continue;
    return { x: sx, z: sz };
  }
  return null;
}

// Vertical plane: float on liquids (2/3 out), stand when supported,
// otherwise gravity — every descent falls, including legal 1-block steps.
// Landing snaps to the support top so feet stay exact: without it mobs
// would hover after a fall and every later drop would read too deep.
// Takes the pre-move support state (surface/floating/supported computed
// before the horizontal drives): a mob walking into water this tick floats
// next tick, exactly like the inline block did.
// Landing contact: refused moves hover, so settle onto the support top —
// landing only, never lifting (embedded spawns are the debug spawner's own
// guard, not the mover's). Snap only onto a free spot: snapping into the
// step's flank is exactly how mobs get buried in the block they descend
// from.
export function stepVertical(mob, dt, surface, floating, supported) {
  if (floating) {
    mob.pos.y += (floatTargetY(surface, mob.h) - mob.pos.y) * Math.min(1, dt * 4);
    mob.vel.y = 0;
  } else if (supported) {
    mob.vel.y = 0;
  } else {
    mob.vel.y = Math.max(-30, mob.vel.y - GRAVITY * dt);
    const ny = mob.pos.y + mob.vel.y * dt;
    if (!aabbIntersectsSolid(mob.pos.x, ny, mob.pos.z, mob.hw, mob.h)) {
      mob.pos.y = ny;
    } else {
      mob.vel.y = 0;
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
}
