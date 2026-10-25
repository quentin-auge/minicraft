// Overworld farm livestock: pigs and cows from the generic quadruped plan.
// Types are dimension-agnostic (spawn policy is just a point supplier, the
// pen by default); mob persistence follows the destination dimension's
// `persistence` spec — retain dims keep their mobs across trips, regenerate
// dims wipe them like every other per-dimension side state.
// Kinematics (probes, 1-wide servo, stepping, separation) live in mover.js,
// three-free and headless-tested; this module owns meshes and lifecycle.
import * as THREE from "three";
import { registerMobType, createMob } from "./registry.js";
import {
  LIVESTOCK_SPECS, PIG_COUNT, COW_COUNT, setFarmSeed, pickPenSpawns,
  isStrictPenCell, penIntact, dropAllowed, specCircles,
} from "./livestock.js";
import {
  FARM_WALK, WANDER_MIN, WANDER_MAX,
  aabbIntersectsSolid, centerHeadroom, groundBelow,
  tickFarmMob, separateFarmMobs,
} from "./mover.js";
import { isLiquid } from "../core/blocks.js";
import { getBlock, getBlockIn } from "../core/store.js";
import { village } from "../world/village.js";
import { dimSpec } from "../world/dimensions.js";
import { hash2 } from "../core/noise.js";

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
    legPhase: rand() * Math.PI * 2, speed: FARM_WALK, rand,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    funnelT: 0, funnelCool: 0,
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
    tick: (mob, dt) => tickFarmMob(mob, dt, pickTarget),
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
  const mob = createMob(kind, { x, z, y: sy, dim: activeDim, yaw, rand });
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
    tickFarmMob(mob, dt, pickTarget);
    sepBuf.push(mob);
  }
  if (sepBuf.length > 1) separateFarmMobs(sepBuf);
}

export { setFarmSeed };
