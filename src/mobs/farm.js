// Overworld farm livestock: pigs and cows from the generic quadruped plan.
// Types are dimension-agnostic (spawn policy is just a point supplier, the
// pen by default); mob persistence follows the destination dimension's
// `persistence` spec — retain dims keep their mobs across trips, regenerate
// dims wipe them like every other per-dimension side state.
import * as THREE from "three";
import { registerMobType, createMob } from "./registry.js";
import {
  LIVESTOCK_SPECS, PIG_COUNT, COW_COUNT, setFarmSeed, pickPenSpawns,
  isStrictPenCell, penIntact, floatTargetY, dropAllowed, specCircles, FARM_WALK_DIVISOR,
} from "./livestock.js";
import { BLOCK_INFO, isLiquid } from "../core/blocks.js";
import { getBlock, getBlockIn } from "../core/store.js";
import { village } from "../world/village.js";
import { dimSpec } from "../world/dimensions.js";
import { hash2 } from "../core/noise.js";

const FARM_WALK = 4.3 / FARM_WALK_DIVISOR;
const GRAVITY = 22;
const TURN_RATE = 3;
// Free wander step: heading + distance from the current position, never
// anchored anywhere. The pen holds mobs by physics (fence collision), not
// by steering — there is no wander center.
const WANDER_MIN = 4;
const WANDER_MAX = 10;
// Pushing against a wall toward an unreachable target re-picks this fast
// instead of waiting out wanderT, so a breach gets used instead of missed.
const STUCK_T = 1.5;
// Separation gap added to every circle-pair need, and vertical gate:
// mobs more than this far apart in Y never interact.
const SEP_GAP = 0.1;
const SEP_Y = 1.2;

let sceneRef = null;
let activeDim = "over";
const mobs = new Set();

let boxGeo = null;
const matCache = new Map();
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const nostrilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const hornMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c6, roughness: 0.9 });
const bodyMat = (color) => {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 }); matCache.set(color, m); }
  return m;
};

function part(parent, material, size, at) {
  if (!boxGeo) boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(boxGeo, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(at[0], at[1], at[2]);
  parent.add(mesh);
  return mesh;
}

// Generic quadruped builder: every body part is spec data, so future farm
// animals (sheep, goats) register a LIVESTOCK_SPECS entry and nothing else.
function buildQuadruped(kind) {
  const spec = LIVESTOCK_SPECS[kind];
  const g = new THREE.Group();
  const bodyM = bodyMat(spec.colors.body);
  const legM = bodyMat(spec.colors.leg);
  part(g, bodyM, spec.body.size, spec.body.at);
  for (const s of spec.spots ?? []) part(g, bodyMat(spec.colors.spot), s.size, s.at);
  part(g, bodyM, spec.head.size, spec.head.at);
  part(g, bodyMat(spec.colors.snout), spec.snout.size, spec.snout.at);
  for (const at of spec.nostrils?.at ?? []) part(g, nostrilMat, spec.nostrils.size, at);
  for (const at of spec.horns?.at ?? []) part(g, hornMat, spec.horns.size, at);
  for (const at of spec.eyes.at) part(g, eyeMat, spec.eyes.size, at);
  const legs = spec.legs.at.map(([lx, ly, lz]) => {
    const pivot = new THREE.Group();
    pivot.position.set(lx, ly + spec.legs.size[1] / 2, lz);
    g.add(pivot);
    const mesh = part(pivot, legM, spec.legs.size, [0, -spec.legs.size[1] / 2, 0]);
    return { pivot, mesh };
  });
  const tailGroup = new THREE.Group();
  tailGroup.position.set(...spec.tail.at);
  g.add(tailGroup);
  if (spec.tail.kind === "coil") {
    for (let ti = 0; ti < spec.tail.segs; ti++) {
      const ta = ti * 2.4;
      part(tailGroup, bodyM, [0.08, 0.08, 0.08],
        [Math.cos(ta) * 0.045, Math.sin(ta) * 0.045, -0.02 - ti * 0.055]);
    }
  } else {
    part(tailGroup, bodyM, [0.09, 0.55, 0.09], [0, -0.27, -0.03]);
    part(tailGroup, legM, [0.13, 0.13, 0.13], [0, -0.58, -0.03]);
  }
  g.userData = { kind, legs, tailGroup };
  return g;
}

const isSolidCell = (x, y, z) => !!BLOCK_INFO[getBlock(x, y, z)]?.solid;

function aabbIntersectsSolid(px, py, pz, hw, h) {
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
function centerHeadroom(px, feetY, pz, h) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (let by = Math.floor(feetY); by <= Math.floor(feetY + h - 1e-4); by++) {
    if (isSolidCell(bx, by, bz)) return false;
  }
  return true;
}

function hasSupport(px, py, pz, hw) {
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
function liquidSurface(px, py, pz, hw, h) {
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

function groundBelow(px, py, pz) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (let y = Math.floor(py); y > Math.floor(py) - 8 && y >= 0; y--) {
    if (isSolidCell(bx, y, bz)) return y + 1;
  }
  return null;
}

function circleAlong(mob, i) {
  return i === 0 ? 0 : i === 1 ? mob.nose.along : mob.tail.along;
}

// Uniform void rule — the air-wall hitbox: every body-circle column
// (core + nose + tail, yaw-oriented) must stand over legal ground (drop
// within maxDrop of refY). Same core+nose+tail extent as the solid
// probes and the separation pass, so no anatomy ever hangs over an
// illegal drop. Pure and headless-testable.
function footingOk(mob, x, z, refY) {
  for (let i = 0; i < 3; i++) {
    const along = circleAlong(mob, i);
    const g = groundBelow(x + Math.sin(mob.yaw) * along, refY + 1, z + Math.cos(mob.yaw) * along);
    if (g == null || !dropAllowed(refY, g, mob.maxDrop)) return false;
  }
  return true;
}

// Headroom over every circle column at its own ground: a narrow pillar
// under the nose on the lower step blocks the descent like a wall.
function headroomOk(mob, x, z, refY) {
  for (let i = 0; i < 3; i++) {
    const along = circleAlong(mob, i);
    const cx = x + Math.sin(mob.yaw) * along, cz = z + Math.cos(mob.yaw) * along;
    if (!centerHeadroom(cx, groundBelow(cx, refY + 1, cz), cz, mob.h)) return false;
  }
  return true;
}

function makeFarmMob(kind, { x, z, y, dim, yaw, rand = Math.random }) {
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  const root = buildQuadruped(kind);
  root.position.set(x, y, z);
  root.rotation.y = yaw;
  sceneRef.add(root);
  const mob = {
    type: kind, dim, pos: root.position, vel: new THREE.Vector3(),
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root,
    yaw, yawTarget: yaw, target: null, wanderT: 1 + rand() * 3,
    legPhase: rand() * Math.PI * 2, speed: FARM_WALK,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y,
  };
  mob.target = pickTarget(mob, rand);
  return mob;
}

function penCellAt(x, y, z) {
  return getBlockIn(activeDim, x, y, z);
}

function inPen(mob) {
  const p = village.pen;
  return !!p && activeDim === "over" &&
    mob.pos.x >= p.minX && mob.pos.x < p.maxX + 1 &&
    mob.pos.z >= p.minZ && mob.pos.z < p.maxZ + 1;
}

function pickTarget(mob, rand = Math.random) {
  const p = village.pen;
  // Boundary, not an anchor: inside an intact pen targets stay in the
  // strict interior so mobs don't grind against the posts; everything else
  // is a free random step from the current position.
  if (p && inPen(mob) && penIntact(p, penCellAt)) {
    for (let t = 0; t < 12; t++) {
      const sx = p.minX + 1 + Math.floor(rand() * (p.maxX - p.minX - 1)) + 0.5;
      const sz = p.minZ + 1 + Math.floor(rand() * (p.maxZ - p.minZ - 1)) + 0.5;
      if (!isStrictPenCell(p, sx, sz, penCellAt)) continue;
      return { x: sx, z: sz };
    }
    return null;
  }
  for (let t = 0; t < 12; t++) {
    const heading = rand() * Math.PI * 2;
    const dist = WANDER_MIN + rand() * (WANDER_MAX - WANDER_MIN);
    const sx = Math.floor(mob.pos.x + Math.sin(heading) * dist) + 0.5;
    const sz = Math.floor(mob.pos.z + Math.cos(heading) * dist) + 0.5;
    const gy = groundBelow(sx, mob.pos.y + 1, sz);
    if (gy == null) continue;
    // Same legal-step rule as the mover: never up, down at most maxDrop —
    // plus dry feet. A cheap center-column pre-filter (the mover re-gates
    // every step on all three body circles); walls on the way still
    // resolve through the stuck re-pick.
    if (!dropAllowed(mob.pos.y, gy, mob.maxDrop ?? 1)) continue;
    if (isLiquid(getBlock(Math.floor(sx), gy, Math.floor(sz)))) continue;
    if (!centerHeadroom(sx, gy, sz, mob.h)) continue;
    return { x: sx, z: sz };
  }
  return null;
}

function turnTo(mob, dt) {
  let d = mob.yawTarget - mob.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  mob.yaw += THREE.MathUtils.clamp(d, -TURN_RATE * dt, TURN_RATE * dt);
}

// Facing-first search for a free landing spot at level g: forward steps
// first (the descent direction), then diagonals, sides, back. Supported
// spots win; a merely-free spot still beats hovering (the fall resumes
// next tick). Rare path — only runs when the straight snap below would
// bury the body.
function landUnwedged(mob, g) {
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
function moveClamped(mob, nx, nz, stepOk) {
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

function tickFarmMob(mob, dt, rand = Math.random) {
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
      mob.wanderT = 3 + rand() * 4;
      mob.stuckT = 0;
    }
  } else {
    mob.stuckT = 0;
  }
  mob.lastX = mob.pos.x;
  mob.lastZ = mob.pos.z;
  if (!mob.target || Math.hypot(dx, dz) < 0.6 || mob.wanderT <= 0) {
    mob.target = pickTarget(mob, rand);
    mob.wanderT = 3 + rand() * 4;
  }
  if (mob.target) {
    mob.yawTarget = Math.atan2(mob.target.x - mob.pos.x, mob.target.z - mob.pos.z);
    turnTo(mob, dt);
    const fx = Math.sin(mob.yaw) * mob.speed * dt;
    const fz = Math.cos(mob.yaw) * mob.speed * dt;
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
    // Legal-step gate (non-jumping walkers): never up, down at most
    // maxDrop. A deeper drop is a vertical air wall — rejected exactly
    // like solid, so the stuck detector re-picks instead of cliff walking.
    // The destination test is passage-at-current-height plus headroom on
    // the center column: a full body box posed at the lower level would
    // overlap the very step being descended and reject every descent.
    // Plus a nose-circle probe ahead along the facing: the visual head
    // sticks out past hw, so the body test alone would let it grind
    // into walls.
    const stepOk = (nx, nz) => {
      if (aabbIntersectsSolid(nx, mob.pos.y, nz, mob.hw, mob.h)) return false;
      const gx = nx + Math.sin(mob.yaw) * mob.nose.along, gz = nz + Math.cos(mob.yaw) * mob.nose.along;
      if (aabbIntersectsSolid(gx, mob.pos.y, gz, mob.nose.r, mob.h)) return false;
      if (floating) return true;
      // Bounded drift, gated on the takeoff level: legal descents keep
      // their glide, falls over void drop straight from the first tick.
      if (!supported) {
        return mob.fallFrom - mob.pos.y <= mob.maxDrop + 1e-3 && footingOk(mob, nx, nz, mob.fallFrom);
      }
      if (!footingOk(mob, nx, nz, mob.pos.y)) return false;
      return headroomOk(mob, nx, nz, mob.pos.y);
    };
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
  const surface = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h);
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
  // Cosmetic: alternating leg swing + tail sway while walking.
  mob.legPhase += dt * mob.speed * 4;
  const legs = mob.root.userData.legs;
  for (let i = 0; i < legs.length; i++) {
    legs[i].pivot.rotation.x = Math.sin(mob.legPhase + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.5;
  }
  mob.root.userData.tailGroup.rotation.y = Math.sin(mob.legPhase * 0.5) * 0.3;
  mob.root.rotation.y = mob.yaw;
}

// Separation destination veto: a side moves only onto a free body with
// supported feet (nose circle included, so pushes never park a head in
// a wall), legal ground under every body circle, and headroom over
// each: drops deeper than maxDrop are air walls for pushes exactly as
// for steps, so herds never shove each other off cliffs.
function sepSpotFree(mob, x, z) {
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
function separateFarmMobs(list) {
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

const sepBuf = [];

function disposeFarmMob(mob) {
  if (mob.root) sceneRef?.remove(mob.root);
  mob.alive = false;
  mobs.delete(mob);
}

for (const kind of ["pig", "cow"]) {
  registerMobType({
    key: kind,
    capabilities: { walk: true, float: true },
    create: (ctx) => makeFarmMob(kind, ctx),
    tick: (mob, dt) => tickFarmMob(mob, dt),
    dispose: disposeFarmMob,
  });
}

export function enterFarmMobs(scene, dimName = "over") {
  sceneRef = scene;
  activeDim = dimName;
  const p = village.pen;
  if (!p) return;
  const cellAt = (x, y, z) => getBlockIn(dimName, x, y, z);
  const spots = pickPenSpawns(p, cellAt);
  const kinds = [...Array(PIG_COUNT).fill("pig"), ...Array(COW_COUNT).fill("cow")];
  spots.forEach(([x, z], i) => {
    const kind = kinds[i];
    if (!kind) return;
    const yaw = hash2(i, 7, 5103) * Math.PI * 2;
    const mob = createMob(kind, { x, z, y: p.vy + 1, dim: dimName, yaw });
    if (mob) mobs.add(mob);
  });
  syncVisibility();
}

// Spawn guard: body box plus nose circle free along the given yaw, so
// newborn mobs satisfy the same no-head-in-wall invariant the mover
// enforces every tick.
function spotFree(x, y, z, yaw, hw, h, nose) {
  if (aabbIntersectsSolid(x, y, z, hw, h)) return false;
  const gx = x + Math.sin(yaw) * nose.along, gz = z + Math.cos(yaw) * nose.along;
  return !aabbIntersectsSolid(gx, y, gz, nose.r, h);
}

// Debug spawn (cheat only, B key): drops a random pig/cow at an arbitrary
// point in the active dimension. Free-roaming — no pen attachment exists
// anywhere in this system — under the standard persistence rule.
export function spawnFarmMobAt(scene, x, z, y, rand = Math.random) {
  sceneRef = scene;
  const kind = rand() < 0.5 ? "pig" : "cow";
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  const hw = shape.hw, h = shape.h;
  const baseYaw = rand() * Math.PI * 2;
  let sy = y, yaw = baseYaw;
  for (let t = 0; t < 5; t++) {
    let placed = false;
    for (let k = 0; k < 4 && !placed; k++) {
      yaw = baseYaw + k * Math.PI / 2;
      placed = spotFree(x, sy, z, yaw, hw, h, shape.nose);
    }
    if (placed) break;
    sy++;
  }
  if (!spotFree(x, sy, z, yaw, hw, h, shape.nose)) return null;
  const mob = createMob(kind, { x, z, y: sy, dim: activeDim, yaw });
  if (mob) {
    mobs.add(mob);
    syncVisibility();
  }
  return mob;
}

export function clearFarmDim(name) {
  for (const mob of [...mobs]) if (mob.dim === name) disposeFarmMob(mob);
}

export function clearFarmMobs() {
  for (const mob of [...mobs]) disposeFarmMob(mob);
}

function syncVisibility() {
  for (const mob of mobs) mob.root.visible = mob.dim === activeDim;
}

// Portal-travel hook: the destination spec's `persistence` alone decides.
// Retain dims keep their mobs (hidden while away); regenerate dims wipe
// that dim's mobs exactly like their voxels, glowstone, flowers, and TNT.
export function handleFarmTravel(scene, dest) {
  sceneRef = scene;
  activeDim = dest;
  if (dimSpec(dest)?.persistence === "regenerate") clearFarmDim(dest);
  if (dest === "over" && village.pen && ![...mobs].some((m) => m.dim === "over")) {
    enterFarmMobs(scene, "over");
  }
  syncVisibility();
}

export function tickFarmMobs(dt, dimName) {
  activeDim = dimName;
  sepBuf.length = 0;
  for (const mob of mobs) {
    if (!mob.alive) continue;
    mob.root.visible = mob.dim === dimName;
    if (mob.dim !== dimName) continue;
    tickFarmMob(mob, dt);
    sepBuf.push(mob);
  }
  if (sepBuf.length > 1) separateFarmMobs(sepBuf);
}

export { setFarmSeed };
