// Overworld farm livestock: pigs and cows from the generic quadruped plan.
// Types are dimension-agnostic (spawn policy is just a point supplier, the
// pen by default); mob persistence follows the destination dimension's
// `persistence` spec — retain dims keep their mobs across trips, regenerate
// dims wipe them like every other per-dimension side state.
// Kinematics (probes, 1-wide servo, stepping, separation) live in mover.js,
// three-free and headless-tested; this module owns meshes and lifecycle.
import * as THREE from "three";
import { registerMobType, registerMobSource, createMob } from "./registry.js";
import {
  LIVESTOCK_SPECS, PIG_COUNT, COW_COUNT, setFarmSeed, pickPenSpawns,
  specCircles,
} from "./livestock.js";
import {
  FARM_WALK, PICK_COMFORT,
  tickFarmMob, separateFarmMobs, mobBlockedAt,
} from "./mover.js";
import { planGroup } from "./forecast.js";
import { buildMobGrid } from "./grid.js";
import { aabbIntersectsSolid, strideTarget } from "./step.js";
import { getBlockIn } from "../core/store.js";
import { applyDisplacementColor, initPaintState } from "./displacement-color.js";
import { clearEntryClaims } from "./entry.js";
import { village } from "../world/village.js";
import { dimSpec } from "../world/dimensions.js";
import { hash2 } from "../core/noise.js";
import { isCarried } from "./carry.js";

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

// Displacement-mode tint lives in displacement-color.js (debug paint only,
// deletable per its header); headless rigs assert the mover flags.
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
  const paintables = [];
  const paint = (parent, material, size, at) => {
    const mesh = part(parent, material, size, at);
    paintables.push(mesh);
    return mesh;
  };
  paint(g, bodyM, spec.body.size, spec.body.at);
  for (const s of spec.spots ?? []) paint(g, bodyMat(spec.colors.spot), s.size, s.at);
  paint(g, bodyM, spec.head.size, spec.head.at);
  paint(g, bodyMat(spec.colors.snout), spec.snout.size, spec.snout.at);
  for (const at of spec.nostrils?.at ?? []) part(g, nostrilMat, spec.nostrils.size, at);
  for (const at of spec.horns?.at ?? []) part(g, hornMat, spec.horns.size, at);
  for (const at of spec.eyes.at) part(g, eyeMat, spec.eyes.size, at);
  const legs = spec.legs.at.map(([lx, ly, lz]) => {
    const pivot = new THREE.Group();
    pivot.position.set(lx, ly + spec.legs.size[1] / 2, lz);
    g.add(pivot);
    const mesh = paint(pivot, legM, spec.legs.size, [0, -spec.legs.size[1] / 2, 0]);
    return { pivot, mesh };
  });
  const tailGroup = new THREE.Group();
  tailGroup.position.set(...spec.tail.at);
  g.add(tailGroup);
  if (spec.tail.kind === "coil") {
    for (let ti = 0; ti < spec.tail.segs; ti++) {
      const ta = ti * 2.4;
      paint(tailGroup, bodyM, [0.08, 0.08, 0.08],
        [Math.cos(ta) * 0.045, Math.sin(ta) * 0.045, -0.02 - ti * 0.055]);
    }
  } else {
    paint(tailGroup, bodyM, [0.09, 0.55, 0.09], [0, -0.27, -0.03]);
    paint(tailGroup, legM, [0.13, 0.13, 0.13], [0, -0.58, -0.03]);
  }
  g.userData = { kind, legs, tailGroup, ...initPaintState(), paintables };
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
    grabR: shape.grabR, grabH: shape.grabH,
    grabSide: shape.grabSide, grabFront: shape.grabFront, grabBack: shape.grabBack,
    maxDrop: spec.drop ?? 1, alive: true, root,
    yaw, yawTarget: yaw, target: null, wanderT: 1 + rand() * 3,
    legPhase: rand() * Math.PI * 2, speed: FARM_WALK, rand,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    entryScanT: 0, jrng: null,
    wallFollow: false, oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
  };
  mob.target = pickTarget(mob, rand);
  return mob;
}

function pickTarget(mob, rand = Math.random, peers = null, grid = null) {
  // Single unified path: random stride validated end-to-end (destination
  // rules plus the whole segment via strideTarget). Pen fence, house walls,
  // and troughs bound targets emergently — no pen fork: a stride through a
  // wall simply fails validation, so only walkable targets come back.
  // Mob-aware picking adds the blocked check: strides ending on another
  // mob's body (with a comfort margin) are refused exactly like steps into
  // walls; passing near peers stays legal. Deliberate routing around a
  // blocker lives in pickDetourTarget (mover), used by the stuck path when
  // random picks keep failing.
  if (!peers) return strideTarget(mob, null, rand);
  // Mob-aware retries: strides ending on another mob's body (with a
  // comfort margin) are refused exactly like steps into walls; passing
  // near peers stays legal, only the destination cell is vetoed.
  const blocked = (x, z) => mobBlockedAt(mob, x, z, mob.pos.y, peers, PICK_COMFORT, grid);
  for (let t = 0; t < 4; t++) {
    const s = strideTarget(mob, null, rand);
    if (!s) return null;
    if (!blocked(s.x, s.z)) return s;
  }
  return strideTarget(mob, null, rand);
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
    capabilities: { walk: true, float: true, grabbable: true },
    create: (ctx) => makeFarmMob(kind, ctx),
    tick: (mob, dt) => {
      tickFarmMob(mob, dt, pickTarget);
      applyDisplacementColor(mob);
    },
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
// anywhere in this system — under the standard persistence rule. Peer-aware
// like the grab release: never stacks the newborn onto a live mob (the
// separation backstop would unstack it, but spawning clean beats resolving).
export function spawnFarmMobAt(scene, x, z, y, rand = Math.random) {
  sceneRef = scene;
  const kind = rand() < 0.5 ? "cow" : "pig";
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  const hw = shape.hw, h = shape.h;
  const probe = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, hw, nose: shape.nose, tail: shape.tail, alive: true };
  const peers = [...mobs].filter((m) => m.alive && m.dim === activeDim);
  const peerFree = (sx, sy, sz, syaw) => {
    probe.yaw = syaw;
    return !mobBlockedAt(probe, sx, sz, sy, peers, 0, null, 0);
  };
  const baseYaw = rand() * Math.PI * 2;
  let sy = y, yaw = baseYaw;
  for (let t = 0; t < 5; t++) {
    let placed = false;
    for (let k = 0; k < 4 && !placed; k++) {
      yaw = baseYaw + k * Math.PI / 2;
      placed = spotFree(x, sy, z, yaw, hw, h, shape.nose) && peerFree(x, sy, z, yaw);
    }
    if (placed) break;
    sy++;
  }
  if (!spotFree(x, sy, z, yaw, hw, h, shape.nose) || !peerFree(x, sy, z, yaw)) return null;
  const mob = createMob(kind, { x, z, y: sy, dim: activeDim, yaw, rand });
  if (mob) {
    mobs.add(mob);
    syncVisibility();
  }
  return mob;
}

export function clearFarmDim(name) {
  for (const mob of [...mobs]) if (mob.dim === name) disposeFarmMob(mob);
  clearEntryClaims();
}

export function clearFarmMobs() {
  for (const mob of [...mobs]) disposeFarmMob(mob);
  clearEntryClaims();
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

export function listFarmMobs() {
  return [...mobs];
}

registerMobSource("farm", listFarmMobs);

export function tickFarmMobs(dt, dimName) {
  activeDim = dimName;
  sepBuf.length = 0;
  for (const mob of mobs) {
    if (!mob.alive) continue;
    mob.root.visible = mob.dim === dimName;
    // Riding mobs are frozen statues pinned by the vehicle, carried mobs
    // are owned by the grab hook: skip the whole tick (mover, entry,
    // separation planning) so nothing can drift them mid-flight.
    if (mob.dim !== dimName || mob._riding) continue;
    if (isCarried(mob)) continue; // grab hook owns the frame: frozen, unplanned
    mob._peerIdx = sepBuf.length;
    sepBuf.push(mob);
  }
  // Three-phase tick: group plan off live positions (most-blocked first),
  // per-mob ticks consuming one-tick plans, then the hard separation
  // backstop. One spatial hash per tick (cell 3 m) feeds every O(N^2) peer
  // scan — same neighbor sets as a full scan, only faster (see grid.js).
  const grid = buildMobGrid(sepBuf, 3);
  planGroup(sepBuf, dt, grid);
  for (const mob of sepBuf) {
    tickFarmMob(mob, dt, pickTarget, mob.rand ?? Math.random, sepBuf, grid);
    applyDisplacementColor(mob);
  }
  if (sepBuf.length > 1) separateFarmMobs(sepBuf, grid);
}

export { setFarmSeed };
