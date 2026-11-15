// Shared step physics (R0): the single ground truth behind every mover,
// probe, and push. Collision probes, the unified blocked predicate
// (makeStepOk: solid overlap OR illegal ground under the core+nose columns
// OR missing headroom — air walls and physical walls read identically), the
// pit guard (descendOk: a descent with no same-level continuation is a wall),
// stride validation, the two gated moves (vector for the servo, axis-
// separated for the wander), the unified drive (driveToward) behind entry
// commits, the roam commit, and the wander fallback, the vertical plane
// (stepVertical), and the shared lane teardown (dropLane). Three-free;
// positions are plain {x, y, z}.
import { BLOCK_INFO, isLiquid } from "../core/blocks.js";
import { getBlock, dimInfinite } from "../core/store.js";
import { dropAllowed, floatTargetY } from "./livestock.js";
import { mobCanFloat } from "./registry.js";
import { normYaw } from "./corridor.js";
import { GRAVITY, TERMINAL_VELOCITY, applyGravity, clampFall, gravityAt } from "../core/launch.js";
import { MOON_MIN_Y, isMoonGone, moonDimHas } from "../world/moon.js";
import { mobXZLimit } from "../world/level.js";
import { floatVelY } from "../core/floatability.js";

// Base stride speed straight from master's pig/cow walk; the divisor slows
// it to a farm amble (FARM_WALK lives in mover.js beside its tuning).
export const TURN_RATE = 3;
// Rotate-in-place past this yaw error; below it forward speed scales with
// cos(error) for arc-while-moving fluidity. Shared by the servo and roam.
export const SPIN = 1.2;
// Virtual-lane width: wall-following frames a lane exactly one cell wide
// against the real wall — the lane middle is the adjacent cell centre,
// 0.5 from the face — with an invisible complementary wall on the far
// side, so the servo walks it like a true 1-wide corridor (parallel and
// glued, never diagonal, never drifting off).
export const VIRTUAL_W = 1.0;
// Free wander stride: heading + distance from the current position, never
// anchored anywhere. The pen holds mobs by physics (fence collision), not
// by steering — there is no wander center.
export const WANDER_MIN = 4;
export const WANDER_MAX = 10;
// Latched targets never expire on their own (refresh comes from arrival,
// stuck, re-decide, or span timeout — never from this clock).
export const NO_EXPIRY = 1e9;
// One sky, one gravity: the vertical plane falls at the same shared rate
// as the player and every thrown body (core/launch.js) — no mob-specific
// tuning. Mobs steer nothing airborne, so every descent converges to a pure
// vertical drop.
export { GRAVITY, TERMINAL_VELOCITY } from "../core/launch.js";
// Support-scan depth in infinite dimensions (bounded dims scan to the y = 0
// floor instead): outcomes stay identical — the touch rule only reads the
// layer touching the feet, and the first solid below decides the break — at
// bounded cost instead of walking the whole key range in a void.
export const SUPPORT_SCAN = 8;
// Base sim step: the mob tick integrates in exact SERVO_STEP slices, so
// behaviour never depends on the frame's dt (V speed scales dt, never the
// step count) — probes, corner arcs and tick-counted holds read the same
// at any speed. Tall frames recurse (bounded by the 0.05 s dt clamp).
export const SERVO_STEP = 1 / 60;
// How deep a side wall may cut into the soft nose before it reads as a
// block: the snout scrapes the newel post it rounds, it never buries in it.
export const SOFT_NOSE_GRACE = 0.05;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// One gated drive behind entry commits, the roam commit, and the wander
// fallback: face yawTarget at rate, then advance speed·cos(err) through
// the given clamped move (moveVector for the servo — it never stair-steps
// around L corners — moveClamped elsewhere, which slides along walls).
// makeStep is a factory, called after the turn: probes that capture the
// facing read the post-turn yaw exactly like the inline drives did, while
// probes closing over a pre-turn predicate keep it. Returns {err, dist} —
// dist 0 covers refused steps and spin-in-place ticks alike.
export function driveToward(mob, dt, yawTarget, makeStep, move, opts = {}) {
  const { rate = TURN_RATE, gated = true, turnOk = null } = opts;
  mob.yawTarget = yawTarget;
  if (turnOk) {
    // Peer-gated turn: a yaw step that would swing the nose/tail discs
    // into a peer past the brush budget is halved down (translation gates
    // only test positions — a pure rotation deepens contact for free).
    // Partial turns still express, so the dodge never freezes mid-sweep.
    // Bit-identical to turnTo whenever the gate approves (no floor), so
    // the only divergence from legacy is an actual veto.
    let step = clamp(normYaw(yawTarget - mob.yaw), -rate * dt, rate * dt);
    if (step !== 0) {
      let guard = 0;
      while (guard++ < 10 && !turnOk(normYaw(mob.yaw + step))) {
        step /= 2;
        if (Math.abs(step) <= 1e-9) { step = 0; break; }
      }
    }
    mob.yaw += step;
  } else turnTo(mob, dt, rate);
  const err = Math.abs(normYaw(mob.yawTarget - mob.yaw));
  const stride = mob.speed * dt * (gated ? Math.max(0, Math.cos(Math.min(err, Math.PI / 2))) : 1);
  if ((gated && (err >= SPIN || stride <= 1e-6)) || stride <= 0) return { err, dist: 0 };
  const stepOk = makeStep();
  const bx = mob.pos.x, bz = mob.pos.z;
  move(mob, bx + Math.sin(mob.yaw) * stride, bz + Math.cos(mob.yaw) * stride, stepOk);
  return { err, dist: Math.hypot(mob.pos.x - bx, mob.pos.z - bz) };
}

// Wall-slide deflection for lanelless drives: a direct heading whose full
// stride is nose-blocked but whose single-axis projection walks is re-faced
// along the free axis instead of grinding nose-first with halving
// micro-steps (the 45° scrape stutter: the nose disc vetoes the slide the
// body could take). Both-free (diagonal clip) and both-blocked keep the
// direct goal — moveClamped slides the former, the stall path owns the
// latter. Entry commits skip it (they wedge, stall, and convert to a
// hole-ward guided ride instead). Returns the goal to drive.
// A projection shorter than this share of the stride carries no
// direction: near head-on its sign is float noise, and deriving the slide
// facing from it flips the mob every tick (pirouette against the wall).
const PROJ_SHARE = 0.25;

export function slideDeflect(mob, dt, yawGoal, supported, floating) {
  const stride = mob.speed * dt;
  if (!(stride > 1e-9)) return yawGoal;
  const dx = Math.sin(yawGoal) * stride, dz = Math.cos(yawGoal) * stride;
  const probeAs = (yaw) => makeStepOk(mob, supported, floating, mob.nose.along, yaw);
  if (probeAs(yawGoal)(mob.pos.x + dx, mob.pos.z + dz)) return yawGoal;
  // Each projection is probed facing along its own axis: the slide turns
  // the head out of the wall, so the diagonal nose reach must not veto the
  // axis the body walks. The facing follows the projection's own sign —
  // except near head-on, where the sign is noise: there the current yaw
  // breaks the tie (hysteresis), so the slide holds one side instead of
  // flipping between both every tick.
  const xYaw = Math.abs(dx) >= stride * PROJ_SHARE ? Math.atan2(dx, 0)
    : Math.abs(normYaw(Math.PI / 2 - mob.yaw)) <= Math.abs(normYaw(-Math.PI / 2 - mob.yaw)) ? Math.PI / 2 : -Math.PI / 2;
  const zYaw = Math.abs(dz) >= stride * PROJ_SHARE ? Math.atan2(0, dz)
    : Math.abs(normYaw(0 - mob.yaw)) <= Math.abs(normYaw(Math.PI - mob.yaw)) ? 0 : Math.PI;
  const xOk = probeAs(xYaw)(mob.pos.x + dx, mob.pos.z);
  const zOk = probeAs(zYaw)(mob.pos.x, mob.pos.z + dz);
  if (xOk && !zOk) return xYaw;
  if (zOk && !xOk) return zYaw;
  return yawGoal;
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

// Extra solid for mob movement: a live out-of-store hull (the hovering
// rocket, wired by main.js to rocketSolidAt) reads as rock to every body
// probe below, so no mob ever walks into it. Null headless (legacy voxel
// reads) unless a rig sets a stub. Only the overlap probes consult it —
// support scans keep using voxels, so the hull is a wall, never a floor.
let mobExtraSolid = null;
export function setMobExtraSolid(fn) { mobExtraSolid = fn; }

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
      if (mobExtraSolid && mobExtraSolid(bx, by, bz)) return true;
      }
  return false;
}

// Worst body-vs-rock overlap depth (max intersection volume over the
// overlapped solid cells), or 0 for a free pose. Lets an already-touching
// floating hull hold or ease off a contact without ever deepening it.
export function bodyOverlapDepth(px, py, pz, hw, h) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const y0 = Math.floor(py), y1 = Math.floor(py + h - 1e-4);
  let worst = 0;
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        const ox = Math.min(px + hw, bx + 1) - Math.max(px - hw, bx);
        if (ox <= 0) continue;
        const oz = Math.min(pz + hw, bz + 1) - Math.max(pz - hw, bz);
        if (oz <= 0) continue;
        const oy = Math.min(py + h, by + 1) - Math.max(py, by);
        if (oy <= 0) continue;
        if (isSolidCell(bx, by, bz)) worst = Math.max(worst, ox * oy * oz);
        else if (mobExtraSolid && mobExtraSolid(bx, by, bz)) worst = Math.max(worst, ox * oy * oz);
      }
  return worst;
}

// Nose box against the voxels, with the passing grace on the SIDE walls
// only. A wall in front of the nose blocks it exactly as before — the head
// must stop before it enters the wall ahead, dead ends included. A wall
// BESIDE the nose is a graze: the passing offset pushes the nose against
// the corridor wall the same way it pushes the shoulder, so it is
// tolerated up to `grace` deep. Without that, a legal passing pose reads
// as a dead end and the lane flips under it.
export function noseHitsSolid(px, py, pz, box, h, dx, dz, grace) {
  const x0 = Math.floor(px - box), x1 = Math.floor(px + box);
  const z0 = Math.floor(pz - box), z1 = Math.floor(pz + box);
  const y0 = Math.floor(py), y1 = Math.floor(py + h - 1e-4);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        const ox = Math.min(px + box, bx + 1) - Math.max(px - box, bx);
        if (ox <= 0) continue;
        const oz = Math.min(pz + box, bz + 1) - Math.max(pz - box, bz);
        if (oz <= 0) continue;
        if (by + 1 <= py || by >= py + h) continue;
        if (!isSolidCell(bx, by, bz)) continue;
        // Lateral offset of the cell from the nose's line: beside the nose
        // means a graze, in front of it means a block.
        const lat = Math.abs(-(bz + 0.5 - pz) * dx + (bx + 0.5 - px) * dz);
        if (lat > box) {
          if (Math.min(ox, oz) > grace) return true;
          continue;
        }
        return true;
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
  // Vertical datum (see ARCHITECTURE.md): bounded dims stop at the y = 0
  // floor; infinite dims scan SUPPORT_SCAN below the feet, so platforms
  // under y = 0 hold exactly like ground-level ones.
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const top = Math.floor(py + 1e-3);
  const stop = dimInfinite() ? top - SUPPORT_SCAN : 0;
  for (let bx = x0; bx <= x1; bx++)
    for (let bz = z0; bz <= z1; bz++) {
      if (bx + 1 <= px - hw || bx >= px + hw) continue;
      if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
      for (let by = top; by >= stop; by--) {
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

// Highest liquid surface top under a footprint, scanning down from topY.
// Unlike liquidSurface (which only reads liquid overlapping the body),
// this finds the surface a move would float on, including water beside or
// just below the current feet level.
export function waterSurfaceTopAt(px, pz, hw, topY, depth = 8) {
  let top = null;
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const start = Math.floor(topY);
  for (let by = start; by > start - depth; by--)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (isLiquid(getBlock(bx, by, bz))) top = top == null ? by + 1 : Math.max(top, by + 1);
      }
  return top;
}

// True liquid surface above a footprint: scans upward from the feet through
// the continuous liquid column to its top (tall Nether lava columns
// included). Unlike liquidSurface (body overlap only) or waterSurfaceTopAt
// (downward scan from a guess), this is the surface the shared buoyancy law
// rises toward — the same surface the player reads through colLiqTop.
export function trueLiquidSurfaceTopAt(px, pz, hw, py, maxScan = 96) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const layerWet = (by) => {
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (isLiquid(getBlock(bx, by, bz))) return true;
      }
    return false;
  };
  const start = Math.floor(py);
  if (!layerWet(start)) return null;
  let top = start + 1;
  for (let by = start + 1; by <= start + maxScan; by++) {
    if (!layerWet(by)) break;
    top = by + 1;
  }
  return top;
}

// Floating locomotion is active when the body overlaps liquid and the mob
// has the float capability. Callers may pass the precomputed floating
// state; otherwise it is read from the current pose.
export function mobFloatDrive(mob, floating = null) {
  const wet = floating ?? (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null);
  return wet && mobCanFloat(mob);
}

// Tolerance when comparing a liquid surface against ground level: feet and
// surfaces are integer tops, this only absorbs float dust — never a drop.
export const SWIM_LEVEL_EPS = 0.05;

// Expected floating feet level over a cell, or null when there is no
// swimmable surface there. One rule everywhere: the surface must sit at the
// reference level or at most a block above it — never below. No floor is
// ever read: buoyancy is the support, for every liquid alike.
export function floatLevelAt(mob, x, z, refY) {
  const surface = waterSurfaceTopAt(x, z, mob.hw, refY + mob.h + 1);
  if (surface == null) return null;
  if (surface < refY - SWIM_LEVEL_EPS || surface > refY + 1 + SWIM_LEVEL_EPS) return null;
  return { surface, y: floatTargetY(surface, mob.h) };
}

// Exact shore-height tolerance for floating exits: the shore top may touch
// the water surface level, but never stand above it.
export const SHORE_EXIT_EPS = 1e-3;

// Ballistic hop duration: a leap is a burst, not a cruise — horizontal
// speed runs well above walk pace and the arc stays short, so the peak
// clears the shore with the minimum the physics demands, never a moon
// jump. Longer exits simply leap faster, not longer.
export function shoreHopDuration(dist) {
  return Math.max(0.25, Math.min(0.5, dist / 4.0));
}

// Player-style water exit for a floating mover: the first solid column
// ahead whose top is at most the water surface level, with dry support and
// headroom for the body. Returns a ballistic hop descriptor (constant
// horizontal velocity plus gravity, solved to land exactly on the shore)
// or null.
export function shoreExitTarget(mob, dx, dz) {
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len, nz = dz / len;
  const surface = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h)
    ?? waterSurfaceTopAt(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y + mob.h + 1);
  if (surface == null) return null;
  const feetY = mob.pos.y;
  const maxDrop = mob.maxDrop ?? 1;
  for (let t = mob.hw + 0.05; t <= mob.hw + 1.5; t += 0.15) {
    const px = mob.pos.x + nx * t, pz = mob.pos.z + nz * t;
    let top = null;
    for (let by = Math.ceil(surface + 0.1); by >= Math.floor(surface - 2); by--) {
      if (isSolidCell(Math.floor(px), by, Math.floor(pz))) { top = by + 1; break; }
    }
    if (top == null) continue;
    // The first solid column ahead decides: a shore standing above the
    // surface is a wall, never an exit — the scan ends here instead of
    // looking past it for land further out.
    if (top > surface + SHORE_EXIT_EPS) return null;
    if (top < feetY - maxDrop - 1e-3) continue;
    const tx = Math.floor(px) + 0.5, tz = Math.floor(pz) + 0.5, ty = top + 0.01;
    if (aabbIntersectsSolid(tx, ty, tz, mob.hw, mob.h)) continue;
    const gx = tx + Math.sin(mob.yaw) * mob.nose.along;
    const gz = tz + Math.cos(mob.yaw) * mob.nose.along;
    if (aabbIntersectsSolid(gx, ty, gz, mob.nose.r, mob.h)) continue;
    if (liquidSurface(tx, ty, tz, mob.hw, mob.h) != null) continue;
    if (!centerHeadroom(tx, ty, tz, mob.h)) continue;
    // Ballistic clearance: solve the arc first, then require the body to
    // clear the mid-flight column at the arc's own predicted peak.
    const dist = Math.hypot(tx - mob.pos.x, tz - mob.pos.z);
    const dur = shoreHopDuration(dist);
    const vy0 = (ty - feetY + 0.5 * GRAVITY * dur * dur) / Math.max(1e-3, dur);
    const peak = (vy0 * vy0) / (2 * GRAVITY);
    const vx = (tx - mob.pos.x) / Math.max(1e-3, dur);
    const vz = (tz - mob.pos.z) / Math.max(1e-3, dur);
    // Ballistic clearance along the whole arc, not just its peak: a hop
    // starting nose-close to the rim must not graze the rim's top corner
    // on the way up. Sampled poses reject what the midpoint alone misses.
    let clear = true;
    for (const k of [0.15, 0.35, 0.6, 0.85]) {
      const tt = k * dur;
      const ax = mob.pos.x + vx * tt, az = mob.pos.z + vz * tt;
      const ay = feetY + vy0 * tt - 0.5 * GRAVITY * tt * tt;
      if (aabbIntersectsSolid(ax, ay, az, mob.hw, mob.h)) { clear = false; break; }
    }
    if (!clear) continue;
    return { fromX: mob.pos.x, fromY: feetY, fromZ: mob.pos.z, toX: tx, toY: ty, toZ: tz, t: 0, dur, vx, vz, vy0, peak };
  }
  return null;
}

// Advance a floating shore-hop: constant horizontal velocity plus gravity —
// a true parabolic jump solved to land exactly on the shore top.
// Returns true on touchdown.
export function stepShoreHop(mob, dt) {
  const hp = mob.hop;
  hp.t += dt;
  const t = Math.min(hp.t, hp.dur);
  mob.pos.x = hp.fromX + hp.vx * t;
  mob.pos.z = hp.fromZ + hp.vz * t;
  mob.pos.y = hp.fromY + hp.vy0 * t - 0.5 * GRAVITY * t * t;
  mob.vel.x = hp.vx;
  mob.vel.z = hp.vz;
  mob.vel.y = hp.vy0 - GRAVITY * t;
  if (hp.t >= hp.dur) {
    mob.hop = null;
    mob.hopCd = 1.0;
    mob.pos.x = hp.toX;
    mob.pos.z = hp.toZ;
    mob.pos.y = hp.toY;
    mob.vel.y = 0;
    mob.fallFrom = hp.toY;
    return true;
  }
  return false;
}

export function groundBelow(px, py, pz) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  const top = Math.floor(py);
  // Vertical datum (see ARCHITECTURE.md): bounded dims stop at the y = 0
  // floor; infinite dims scan below it — the 8-deep cap already bounds the
  // cost either way.
  const stop = dimInfinite() ? top - 8 : 0;
  for (let by = top; by > top - 8 && by >= stop; by--) {
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
//
// The head reads against the level the BODY lands on, not against the
// takeoff. A staircase is one tread deep, so the snout reaches the next
// tread — one level below the tread the body steps onto — long before
// the body gets there. Bounding the head by the takeoff made every
// staircase read as a cliff two levels down: the stair walker stalled on
// the first tread, and the deflection that guards the drive slid it
// sideways instead (the left/right parasite turns). Bounding the head by
// the landing level keeps it hanging over the next tread, exactly as it
// does when a body walks down a flight. The body itself still obeys
// maxDrop from the takeoff, so a cliff, a pit and a ledge still refuse.
export function footingOkAt(mob, x, z, refY, yaw, noseAlong = null, edge = false) {
  const nose = noseAlong ?? mob.nose.along;
  const gCore = groundBelow(x, refY + 1, z);
  if (gCore == null) {
    // A corner crossing steps off the tread: the void under the body is
    // the way down, not a wall.
    if (!edge) return false;
    return true;
  }
  if (!dropAllowed(refY, gCore, mob.maxDrop, mob.stepUp ?? 0)) return false;
  if (!nose) return true;
  const nx = x + Math.sin(yaw) * nose, nz = z + Math.cos(yaw) * nose;
  const gNose = groundBelow(nx, refY + 1, nz);
  if (gNose == null) return edge;
  if (gNose > refY + (mob.stepUp ?? 0) + 1e-3) return false;
  // At most maxDrop below the level the body lands on: one tread further.
  if (refY - gNose > mob.maxDrop + (refY - gCore) + 1e-3) return false;
  return true;
}

// Does the snout hang over a drop? The servo reads the same way: a nose
// over a drop must not turn the air-wall guard into a solid wall.
export function noseOverDrop(mob, x, z, yaw) {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  const reach = mob.nose.along;
  const steps = Math.max(1, Math.ceil(reach / 0.25));
  for (let i = 1; i <= steps; i++) {
    const t = reach * i / steps;
    if (groundBelow(x + dx * t, mob.pos.y + 1, z + dz * t) !== mob.pos.y) return true;
  }
  return false;
}

export function footingOk(mob, x, z, refY) {
  return footingOkAt(mob, x, z, refY, mob.yaw);
}

// Headroom over the core + nose columns at their own ground (tail excluded
// like above): a narrow pillar under the nose on the lower step blocks the
// descent like a wall.
export function headroomOkAt(mob, x, z, refY, yaw, noseAlong = null, edge = false) {
  const nose = noseAlong ?? mob.nose.along;
  for (let i = 0; i < 2; i++) {
    const along = i === 0 ? 0 : nose;
    const cx = x + Math.sin(yaw) * along, cz = z + Math.cos(yaw) * along;
    const g = groundBelow(cx, refY + 1, cz);
    // A corner crossing hangs over the void: there is no floor to clear.
    if (g == null) { if (edge) continue; return false; }
    if (!centerHeadroom(cx, g, cz, mob.h)) return false;
  }
  return true;
}

export function headroomOk(mob, x, z, refY) {
  return headroomOkAt(mob, x, z, refY, mob.yaw);
}

// Diagonal sweep clearance: a body driven straight oblique from one cell
// centre to a diagonal neighbour's crosses the shared corner point, so
// either corner square can flank the body at body height — a corner cell
// that reads walkable at its own ground level (a lower tread, a standable
// top) may still carry a solid flank inside the swept band (the spiral's
// central column beside lower treads). Refuse the diagonal when any solid
// overlaps the swept band [min(levelA, levelB), max + h] along the
// diagonal, sampled at quarter points with the body box (the midpoint is
// exactly the shared corner). Wide treads never sweep: they walk
// axis-separated, row then column at the takeoff level, so only corner
// (lone-tread, vector-driven) diagonals read this — callers gate on
// treadWide below. Body only, like walkable; the nose stays out the same
// way. Pure, fixed sample order: plans stay deterministic.
export function diagonalSweepFree(mob, ax, az, levelA, bx, bz, levelB) {
  const dx = bx - ax, dz = bz - az;
  if (!dx || !dz) return true;
  const lo = Math.min(levelA, levelB), hi = Math.max(levelA, levelB);
  for (const t of [0.25, 0.5, 0.75]) {
    const px = ax + 0.5 + dx * t, pz = az + 0.5 + dz * t;
    for (let py = Math.floor(lo); py <= Math.floor(hi); py++) {
      if (aabbIntersectsSolid(px, py, pz, mob.hw, mob.h)) return false;
    }
  }
  return true;
}

// Whole-step water entry for a float-capable mover still on dry land: each
// of the core and nose columns validates either dry (ground within drop,
// headroom clear) or floating (surface at the feet level or at most a block
// above — never below — with headroom fit at the float level). Deep water
// needs no floor: buoyancy is the support, and a dry pit beside water keeps
// reading as a pit since each column keeps its own rule. The hull itself
// stays checked at the current dry level by the caller, so walking onto
// the edge never clips: the descent below the bank top happens through the
// vertical plane once the body overlaps water.
export function floatEntryOkAt(mob, x, z, refY, yaw, noseAlong = null) {
  const nose = noseAlong ?? mob.nose.along;
  for (let i = 0; i < 2; i++) {
    const along = i === 0 ? 0 : nose;
    const cx = x + Math.sin(yaw) * along, cz = z + Math.cos(yaw) * along;
    const surface = waterSurfaceTopAt(cx, cz, 0.05, refY + mob.h + 1);
    if (surface != null && surface >= refY - SWIM_LEVEL_EPS && surface <= refY + 1 + SWIM_LEVEL_EPS) {
      if (!centerHeadroom(cx, floatTargetY(surface, mob.h), cz, mob.h)) return false;
      continue;
    }
    const g = groundBelow(cx, refY + 1, cz);
    if (g == null || !dropAllowed(refY, g, mob.maxDrop ?? 1)) return false;
    if (!centerHeadroom(cx, g, cz, mob.h)) return false;
  }
  return true;
}

// A whole cell walks at its own level: the body fits, the head has room,
// the feet are dry. One rule behind the step scan (stairs.js) and the
// tread-width read below, so both agree on what fits.
export function cellFitsLevel(mob, cx, cy, cz) {
  const x = cx + 0.5, z = cz + 0.5;
  if (aabbIntersectsSolid(x, cy, z, mob.hw, mob.h)) return false;
  if (!centerHeadroom(x, cy, z, mob.h)) return false;
  if (isLiquid(getBlock(cx, Math.floor(cy), cz))) return false;
  return true;
}

// Tread width across the travel axis: a tread flanked at the same level
// by at least one fitting neighbour cell is WIDE (two blocks or more) —
// the mob turns to take it perpendicularly and walks it axis-separated, so
// it never sweeps a corner. A lone tread is a corner tread — driven
// straight oblique, never blocked on the corner. Shared by the flight
// builder (stairs.js) and the planner (nav.js) so both agree on which
// diagonals sweep.
export function treadWide(mob, cx, cz, level, yaw) {
  const px = Math.cos(yaw), pz = -Math.sin(yaw);
  for (const s of [1, -1]) {
    const nx = Math.round(cx + px * s), nz = Math.round(cz + pz * s);
    if (nx === cx && nz === cz) continue;
    const g = groundBelow(nx + 0.5, level + 1, nz + 0.5);
    if (g == null || Math.abs(g - level) > 1e-3) continue;
    if (!cellFitsLevel(mob, nx, g, nz)) continue;
    return true;
  }
  return false;
}

// Whole-cell walkability for branch classification: column solid-free over
// the body height, dry feet, legal ground underfoot with headroom above it.
// Same unified rule as the stepper, cell-quantized for neighbourhood tests.
// Floating movers may pass floating = true: reachable water counts as free
// here, while mouth classification keeps calling the dry default.
export function makeCellFree(mob, floating = false) {
  const floatDrive = floating && mobCanFloat(mob);
  return (bx, bz) => {
    const refY = mob.pos.y;
    for (let by = Math.floor(refY); by <= Math.floor(refY + mob.h - 1e-4); by++) {
      if (isSolidCell(bx, by, bz)) return false;
    }
    if (isLiquid(getBlock(bx, Math.floor(refY), bz))) {
      if (!floatDrive) return false;
      const fl = floatLevelAt(mob, bx + 0.5, bz + 0.5, refY);
      if (!fl) return false;
      if (aabbIntersectsSolid(bx + 0.5, fl.y, bz + 0.5, mob.hw, mob.h)) return false;
      return centerHeadroom(bx + 0.5, fl.y, bz + 0.5, mob.h);
    }
    const g = groundBelow(bx + 0.5, refY + 1, bz + 0.5);
    if (g == null) return false;
    // The cell rule stays strict: a cell one level below the feet reads
    // as unwalkable, so a staircase never passes for a tunnel mouth (the
    // entry scan would draw the stairs as a hole to walk into).
    if (!dropAllowed(refY, g, mob.maxDrop, mob.stepUp ?? 0)) return false;
    return centerHeadroom(bx + 0.5, g, bz + 0.5, mob.h);
  };
}

// Solid-only wall test over the body column (no liquid/ground clauses): a
// 1-high fence reads as a wall, water and drops never do. Feeds the 2-wide
// mouth detector, whose flanks must be solid, never merely unwalkable.
export function makeCellSolid(mob) {
  return (bx, bz) => {
    const refY = mob.pos.y;
    for (let by = Math.floor(refY); by <= Math.floor(refY + mob.h - 1e-4); by++) {
      if (isSolidCell(bx, by, bz)) return true;
    }
    return false;
  };
}

// One unified blocked predicate: solid overlap OR illegal ground under the
// body circles OR missing headroom. Corridor probes and the stepper share
// it, so air walls (drop > maxDrop) and physical walls read identically.
// footNose overrides the circle offset for the void probes: the corridor
// classifier passes 0 (body-only direction sensing, so 1-cell arms ending
// in a wall still read open), the drive passes the real nose reach.
// soft turns the nose into a soft probe (the step commit only): a snout
// hanging over a drop never vetoes, and a wall BESIDE it is a graze, not
// a block — so a mob rounds a newel post instead of stalling on its
// snout. A wall straight ahead still stops the body.
// edge lets the body columns pass over a VOID (no ground at all) instead
// of reading it as an air wall: the corner crossing of a staircase
// (stairs.js) steps off the tread and drops onto the next one, so the
// void under the crossing is the way, not a wall. Only the void is
// relaxed — solids stay exact, and the drop limit still applies to the
// columns that do have ground.
export function makeStepOk(mob, supported, floating, noseAlong, yaw, footNose = null, hwShrink = 0, soft = false, edge = false) {
  const foot = footNose ?? noseAlong;
  const hw = hwShrink > 0 ? Math.max(0.05, mob.hw - hwShrink) : mob.hw;
  // Same shrink on the nose disc (passing only): at noseAlong 0 the disc
  // sits inside the body box, so an unshrunk nose would veto the very
  // shoulder graze the shrunk body allows. shrink 0 keeps legacy exact.
  const nr = hwShrink > 0 ? Math.max(0.05, mob.nose.r - hwShrink) : mob.nose.r;
  const floatDrive = floating && mobCanFloat(mob);
  return (nx, nz) => {
    const wallLim = mobXZLimit(mob.dim ?? "over", mob.pos.y);
    if (wallLim != null) {
      const lim = wallLim - hw;
      if (nx < -lim || nx > lim || nz < -lim || nz > lim) return false;
    }
    // Floating movers keep every physical check: bodies and noses never
    // enter rock. Only the support rule changes from dry ground to a
    // reachable float level.
    let y = mob.pos.y;
    if (floatDrive) {
      const fl = floatLevelAt(mob, nx, nz, mob.pos.y);
      if (!fl) return false;
      y = fl.y;
    }
    if (aabbIntersectsSolid(nx, y, nz, hw, mob.h)) return false;
    const gx = nx + Math.sin(yaw) * noseAlong, gz = nz + Math.cos(yaw) * noseAlong;
    // Soft nose (the step commit): a snout hanging over a drop never vetoes
    // and a wall BESIDE it is a graze, not a block — the mob rounds a newel
    // post instead of stalling on its snout. A wall straight ahead still
    // stops the body. Probed at the step level (the float level afloat),
    // like every other disc check here.
    if (soft) {
      if (!noseOverDrop(mob, nx, nz, yaw) &&
        noseHitsSolid(gx, y, gz, nr + 0.03, mob.h, Math.sin(yaw), Math.cos(yaw), SOFT_NOSE_GRACE)) return false;
    } else if (aabbIntersectsSolid(gx, y, gz, nr, mob.h)) return false;
    if (floatDrive) {
      if (centerHeadroom(nx, y, nz, mob.h)) return true;
      // Contact slide: an already-touching floating hull may hold its line
      // or ease off the contact, never deepen it — the swimmer walks
      // itself off a grazed bank instead of beaching there.
      const cur = bodyOverlapDepth(mob.pos.x, y, mob.pos.z, hw, mob.h);
      if (cur <= 1e-9) return false;
      const cand = bodyOverlapDepth(nx, y, nz, hw, mob.h);
      if (cand > cur + 1e-9) return false;
      return centerHeadroom(nx, y, nz, mob.h);
    }
    // Water entry for float-capable movers still on dry land: validate the
    // whole step (core + nose columns) with buoyancy as support, so deep
    // water reads as swimmable instead of a floor-depth air wall. The hull
    // itself stays checked at the current dry level above, so walking onto
    // the edge never clips: the descent below the bank top happens through
    // the vertical plane once the body overlaps water.
    if (!floating && mobCanFloat(mob) && (mob._transNoDiveT ?? 0) <= 0 && floatEntryOkAt(mob, nx, nz, mob.pos.y, yaw, foot)) return true;
    // Vetoed dive (lottery ignore): the mob never steps onto liquid — a
    // shallow pool reads as a wall, not a staircase, until stuck re-picks
    // it away. Covers the core and nose columns alike.
    if (!floating && (mob._transNoDiveT ?? 0) > 0) {
      const wetBelow = (x, z) => {
        const bx = Math.floor(x), bz = Math.floor(z);
        for (let by = Math.floor(mob.pos.y); by >= Math.floor(mob.pos.y) - (mob.maxDrop ?? 1) - 1; by--) {
          if (isLiquid(getBlock(bx, by, bz))) return true;
        }
        return false;
      };
      if (wetBelow(nx, nz)) return false;
      const gx = nx + Math.sin(yaw) * foot, gz = nz + Math.cos(yaw) * foot;
      if (wetBelow(gx, gz)) return false;
    }
    // Bounded drift, gated on the takeoff level: legal descents keep
    // their glide, falls over void drop straight from the first tick.
    if (!supported) {
      return mob.fallFrom - mob.pos.y <= mob.maxDrop + 1e-3 && footingOkAt(mob, nx, nz, mob.fallFrom, yaw, foot, edge);
    }
    if (!footingOkAt(mob, nx, nz, mob.pos.y, yaw, foot, edge)) return false;
    return headroomOkAt(mob, nx, nz, mob.pos.y, yaw, foot, edge);
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
//
// Float-capable movers additionally validate mixed dry/water segments:
// water samples must hold a continuous reachable float level, dry-to-water
// entries must stay within the buoyant transition, and water-to-dry steps
// must land on a shore at most at the water surface level.
export function segmentWalkable(mob, x0, z0, x1, z1) {
  const floatCapable = mobCanFloat(mob);
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  let prevG = groundBelow(x0, mob.pos.y + 1, z0);
  const startFloat = floatCapable ? floatLevelAt(mob, x0, z0, mob.pos.y) : null;
  if (prevG == null && !startFloat) return false;
  let prevWet = startFloat != null;
  let prevSurface = startFloat?.surface ?? null;
  let prevY = startFloat?.y ?? mob.pos.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const fl = floatCapable ? floatLevelAt(mob, x, z, prevY) : null;
    if (fl && prevWet && Math.abs(fl.surface - prevSurface) > 1e-3) return false;
    if (fl) {
      // Water en route only needs a continuous level surface with headroom:
      // the hull may graze a bank while crossing (the drive's contact slide
      // resolves it), so no body-fit veto here.
      if (!centerHeadroom(x, fl.y, z, mob.h)) return false;
      prevWet = true;
      prevSurface = fl.surface;
      prevY = fl.y;
      continue;
    }
    if (aabbIntersectsSolid(x, mob.pos.y, z, mob.hw, mob.h)) return false;
    const g = groundBelow(x, mob.pos.y + 1, z);
    if (g == null) return false;
    if (prevWet) {
      // Water-to-dry exit: only a shore at most at the water surface level
      // is plannable; the executor performs the physical hop onto it.
      if (prevSurface == null || g > prevSurface + SHORE_EXIT_EPS) return false;
    } else if (g > prevG + (mob.stepUp ?? 0) + 1e-3 || prevG - g > mob.maxDrop + 1e-3) {
      return false;
    }
    prevG = g;
    prevWet = false;
    prevSurface = null;
    prevY = g;
    if (!centerHeadroom(x, g, z, mob.h)) return false;
  }
  return true;
}

// Shared stride target: random heading (or the given one) + stride length,
// first validating (destination rules plus the whole segment). Single pick
// path for the farm picker and roam commits. The range defaults to the
// wander stride (4–10 m); lane-drop follow-throughs pass a shorter one so
// a mob can commit a step or two out of a mouth instead of re-deciding.
export function strideTarget(mob, heading = null, rand = Math.random, minD = WANDER_MIN, maxD = WANDER_MAX) {
  const floatCapable = mobCanFloat(mob);
  for (let t = 0; t < 12; t++) {
    const h = heading ?? rand() * Math.PI * 2;
    const dist = minD + rand() * (maxD - minD);
    const sx = Math.floor(mob.pos.x + Math.sin(h) * dist) + 0.5;
    const sz = Math.floor(mob.pos.z + Math.cos(h) * dist) + 0.5;
    const gy = groundBelow(sx, mob.pos.y + 1, sz);
    let destOk = gy != null
      && dropAllowed(mob.pos.y, gy, mob.maxDrop ?? 1, mob.stepUp ?? 0)
      && !isLiquid(getBlock(Math.floor(sx), gy, Math.floor(sz)))
      && centerHeadroom(sx, gy, sz, mob.h);
    if (!destOk && floatCapable) {
      // Wet destinations validate through the floating rules; dry
      // destinations that fail the dry drop rule are left to the mixed
      // segment validator, which admits only legal shore exits.
      const fl = floatLevelAt(mob, sx, sz, mob.pos.y);
      if (fl && !aabbIntersectsSolid(sx, fl.y, sz, mob.hw, mob.h)
        && centerHeadroom(sx, fl.y, sz, mob.h)) {
        destOk = true;
      } else if (gy != null && !isLiquid(getBlock(Math.floor(sx), gy, Math.floor(sz)))
        && centerHeadroom(sx, gy, sz, mob.h)) {
        destOk = true;
      }
    }
    if (!destOk) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, sx, sz)) continue;
    return { x: sx, z: sz };
  }
  return null;
}

// Vertical plane: shared buoyancy on liquids (core/floatability.js — the
// same rise acceleration, near-surface spring, and overshoot pop as the
// player swim), stand when supported, otherwise gravity — every descent
// falls, including legal 1-block steps.
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
    // Same law as the player swim: rise toward the TRUE surface (tall
    // columns included), keep the velocity so a fast rise overshoots the
    // float level — the pop — before gravity takes over once dry.
    // Per-body depth only (mobs ride h/3 under the surface).
    const ts = trueLiquidSurfaceTopAt(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y) ?? surface;
    const target = floatTargetY(ts, mob.h);
    mob.vel.y = floatVelY(mob.vel.y ?? 0, target - mob.pos.y, dt);
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
  } else if (supported) {
    mob.vel.y = 0;
  } else {
    // One sky, one gravity: plain falls read the same lunar rule as blast
    // flights and the player — no lunar blocks left, no low-g.
    applyGravity(mob.vel, dt, gravityAt(moonDimHas(mob.dim ?? "over"), isMoonGone(), mob.pos.y, MOON_MIN_Y));
    clampFall(mob.vel);
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
