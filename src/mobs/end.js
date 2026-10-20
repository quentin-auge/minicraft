// End-specific mob types: the flying boss and the gaze-reactive Enderman.
import * as THREE from "three";
import { registerMobType, mobType, createMob } from "./registry.js";
import { registerHomingTarget } from "./homing.js";
import { pickBlock } from "../player/edit.js";
import { spawnBurst } from "../fx/particles.js";
import { END_PLATFORM_RADIUS, END_PLATFORM_TOP, END_RETURN_Z, setEndCleared } from "../world/end.js";
import { noteDragonKill } from "../world/tntunlock.js";
import { hash2 } from "../core/noise.js";

// World seed for deterministic mob draws (spawn spots, phases, timers).
// Set per End entry; per-frame death-shake jitter stays cosmetic Math.random.
let mobSeed = 1;
let mobSpawnCount = 0;
export function setMobSeed(s) {
  mobSeed = s | 0;
  mobSpawnCount = 0;
}
const mobHash = (a, b, salt) => hash2(a | 0, b | 0, mobSeed + salt);

const mobs = new Set();
const HUES = [0x6e2a92, 0x1a5eb8, 0x188844, 0xd8a818, 0xc82828];
const SHADE_GREY = 0x9a9aa0;
const DRAGON_BASE = [0x1a1426, 0x241a36, 0x322248, 0x8c8496, 0x201830, 0x17121d];
const DRAGON_MIN_Y = END_PLATFORM_TOP + 7;
const DRAGON_MAX_Y = END_PLATFORM_TOP + 22;
const DRAGON_HP = 8;
const DRAGON_SPEED_MULT = 1.2;
const randomDragonSpitInterval = () => 2 + mobHash(mobSpawnCount++, 7, 9401) * 4;
let sceneRef = null;
let dragonRef = null;
let endermanBodyMat = null;
let endermanHaloMat = null;
let boxGeo = null;
const dragonMembraneGeometries = new Map();
const dragonRaycaster = new THREE.Raycaster();

const colorScale = (hex, f) => {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return r * 65536 + g * 256 + b;
};
function mixColor(a, b, t) {
  const ch = (shift) => ((((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t) | 0);
  return ch(16) * 65536 + ch(8) * 256 + ch(0);
}

function makeMat(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.6, metalness: 0.05, ...options });
}

function box(parent, material, size, at, rotation = null) {
  const mesh = new THREE.Mesh(boxGeo || (boxGeo = new THREE.BoxGeometry(1, 1, 1)), material);
  mesh.scale.set(...size);
  mesh.position.set(...at);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function dragonPalette(hit) {
  if (!hit) return DRAGON_BASE;
  const accent = HUES[(hit - 1) % HUES.length];
  return [
    colorScale(accent, 0.35),
    colorScale(accent, 0.5),
    mixColor(colorScale(accent, 0.85), SHADE_GREY, 0.35),
    mixColor(accent, SHADE_GREY, 0.35),
    mixColor(colorScale(accent, 0.65), SHADE_GREY, 0.175),
    colorScale(accent, 0.65),
  ];
}

function paintDragon(mob, palette) {
  const colors = dragonPalette(palette);
  mob.materials.forEach((material, i) => {
    material.color.setHex(colors[i]);
    material.emissive.setHex(colors[i]);
  });
  mob.eyeMat.color.setHex(palette ? HUES[(palette - 1) % HUES.length] : 0xc86bff);
}

function dragonMembraneGeometry(side) {
  if (dragonMembraneGeometries.has(side)) return dragonMembraneGeometries.get(side);
  const shape = new THREE.Shape();
  const points = [
    [0, -0.26], [side * 0.72, -0.46], [side * 1.58, -0.57],
    [side * 2.44, -0.44], [side * 3.05, -0.22], [side * 3.22, 0.02],
    [side * 2.91, 0.26], [side * 2.62, 0.57], [side * 2.26, 0.88],
    [side * 1.75, 1.05], [side * 1.32, 0.76], [side * 0.84, 0.57],
    [side * 0.34, 0.45], [0, 0.4],
  ];
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  dragonMembraneGeometries.set(side, geometry);
  return geometry;
}

function dragonModel() {
  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  const body = makeMat(0x0d0d12);
  const belly = makeMat(0x16161e);
  const plates = makeMat(0x20202a);
  const bone = makeMat(0x2a2a36);
  const membrane = new THREE.MeshStandardMaterial({
    color: 0x1c1a22, emissive: 0x100e14, emissiveIntensity: 0.45,
    roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.94,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const wingBone = makeMat(0x17121d);
  const mats = [body, belly, plates, bone, membrane, wingBone];
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc86bff });

  box(root, body, [1.95, 1.45, 3.9], [0, 0, 0]);
  box(root, plates, [1.75, 1.15, 1.8], [0, 0.32, 1.25]);
  box(root, body, [1.35, 1.25, 0.9], [0, -0.05, -2.1]);
  box(root, belly, [1.7, 0.7, 3.4], [0, -0.62, 0.15]);
  for (const [px, pz, rx, rz] of [
    [-0.55, 1.15, 0.25, -0.15], [0.55, 1.15, 0.25, 0.15],
    [-0.55, -1.45, -0.3, -0.1], [0.55, -1.45, -0.3, 0.1],
  ]) box(root, body, [0.28, 0.72, 0.3], [px, -0.95, pz], [rx, 0, rz]);

  const neck = new THREE.Group();
  neck.position.set(0, 0.38, 1.75);
  neck.rotation.x = -0.62;
  root.add(neck);
  for (let k = 0; k < 5; k++)
    box(neck, k % 2 ? plates : body, [0.5 - k * 0.035, 0.62 - k * 0.09, 0.8 - k * 0.03], [0, 0.08 * k + 0.2, 0.5 + k * 0.4]);

  const head = new THREE.Group();
  head.position.set(0, 0.52, 2.75);
  neck.add(head);
  box(head, body, [1.05, 0.85, 1.4], [0, 0.05, 0]);
  box(head, body, [0.72, 0.4, 0.95], [0, 0.12, 1.0]);
  box(head, body, [0.55, 0.3, 0.9], [0, -0.28, 0.95]);
  box(head, plates, [0.95, 0.16, 0.75], [0, 0.52, -0.25]);
  for (const side of [1, -1]) {
    box(head, bone, [0.26, 0.85, 0.26], [side * 0.55, 0.5, -0.4], [0.15, 0, -side * 0.85]);
    box(head, bone, [0.16, 0.6, 0.16], [side * 0.55, 1.0, -0.45], [0.2, 0, -side * 0.85]);
  }
  for (const [sx, sy, sz, px, py, pz, rx] of [
    [0.18, 0.6, 0.18, 0.0, 0.85, -0.3, 0.3],
    [0.14, 0.5, 0.14, -0.45, 0.82, -0.15, 0.4],
    [0.14, 0.5, 0.14, 0.45, 0.82, -0.15, 0.4],
    [0.12, 0.42, 0.12, -0.28, 0.92, -0.05, 0.5],
    [0.12, 0.42, 0.12, 0.28, 0.92, -0.05, 0.5],
  ]) box(head, bone, [sx, sy, sz], [px, py, pz], [rx, 0, 0]);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0.12, 1.5);
  head.add(mouth);
  for (const side of [1, -1]) box(head, eyeMat, [0.2, 0.2, 0.1], [side * 0.4, 0.18, 0.95], [0, side * 0.25, 0]);
  box(head, eyeMat, [0.5, 0.12, 0.12], [0, -0.12, 1.35]);

  const tail = [];
  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, 0.1, -1.85);
  tailRoot.rotation.x = 0.35;
  root.add(tailRoot);
  let tailParent = tailRoot;
  for (let k = 0; k < 6; k++) {
    const segment = new THREE.Group();
    segment.position.set(0, 0.05, k ? -0.5832 : 0);
    tailParent.add(segment);
    box(segment, k % 2 ? body : plates, [0.46 - k * 0.055, 0.42 - k * 0.05, 1.1688 - k * 0.1002], [0, 0, -0.5832]);
    tail.push(segment);
    tailParent = segment;
  }
  for (const side of [1, -1]) box(tail[tail.length - 1], wingBone, [0.14, 0.12, 0.759], [side * 0.12, 0.28, -0.835]);

  const makeWing = (side) => {
    const wing = new THREE.Group();
    wing.position.set(side * 1.2, 0.55, 0.5);
    root.add(wing);
    box(wing, wingBone, [0.34, 0.42, 0.62], [0, 0, 0]);
    for (const [ox, oz] of [[1.65, -0.46], [1.85, 0], [1.65, 0.46]])
      box(wing, wingBone, [0.78, 0.075, 0.095], [side * ox, 0, oz], [0, side * 0.15 * oz, 0]);
    const membraneMesh = new THREE.Mesh(dragonMembraneGeometry(side), membrane);
    membraneMesh.rotation.x = -Math.PI / 2;
    wing.add(membraneMesh);
    return wing;
  };
  const wings = [makeWing(-1), makeWing(1)];

  return { root, wings, neck, head, tail, mouth, materials: mats, eyeMat };
}

function makeDragon() {
  const model = dragonModel();
  const mob = {
    ...model, type: "dragon", dim: "end", pos: model.root.position,
    hw: 1.5, h: 3, alive: true, health: DRAGON_HP, maxHealth: DRAGON_HP,
    hitCount: 0, t: mobHash(mobSpawnCount++, 11, 9402) * 10, dying: 0,
    spitTimer: randomDragonSpitInterval(), spitting: 0, breathEmit: 0,
    homingUnregister: null,
  };
  model.root.position.set(0, DRAGON_MIN_Y + 2, 0);
  paintDragon(mob, 1);
  sceneRef.add(model.root);
  mob.homingUnregister = registerHomingTarget(mob);
  dragonRef = mob;
  return mob;
}

function makeEndermanModel() {
  const root = new THREE.Group();
  const eyesMat = new THREE.MeshBasicMaterial({ color: 0xb44cff });
  const parts = [];
  const addPart = (parent, size, at, halo = true) => {
    const body = box(parent, endermanBodyMat, size, at);
    if (halo && endermanHaloMat) {
      const glow = box(parent, endermanHaloMat, size.map((v) => v * 1.14), at);
      glow.userData.halo = true;
      glow.visible = false;
    }
    parts.push(body);
    return body;
  };
  const legL = new THREE.Group(); legL.position.set(-0.16, 0.6, 0); root.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.16, 0.6, 0); root.add(legR);
  addPart(legL, [0.24, 1.2, 0.24], [0, 0, 0]);
  addPart(legR, [0.24, 1.2, 0.24], [0, 0, 0]);
  addPart(root, [0.62, 1, 0.4], [0, 1.7, 0]);
  const head = new THREE.Group(); head.position.set(0, 2.45, 0); root.add(head);
  addPart(head, [0.52, 0.5, 0.5], [0, 0, 0]);
  for (const side of [-1, 1]) box(head, eyesMat, [0.09, 0.16, 0.05], [side * 0.16, 0.03, 0.26]);
  const armL = new THREE.Group(); armL.position.set(-0.42, 1.95, 0); root.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.42, 1.95, 0); root.add(armR);
  addPart(armL, [0.16, 1.75, 0.16], [0, -0.9, 0]);
  addPart(armR, [0.16, 1.75, 0.16], [0, -0.9, 0]);
  return { root, eyesMat, armL, armR, head, parts };
}

function makeEnderman(index) {
  const model = makeEndermanModel();
  let x = 0, z = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const angle = Math.PI * 2 * (index / 10) + (mobHash(index, attempt, 9403) - 0.5) * 1.2;
    const radius = 7 + mobHash(attempt, index, 9404) * (END_PLATFORM_RADIUS - 11);
    x = Math.round(Math.cos(angle) * radius);
    z = Math.round(Math.sin(angle) * radius);
    if (Math.abs(x) <= 3 && Math.abs(z - END_RETURN_Z) <= 3) continue;
    if (Math.hypot(x, z - (END_RETURN_Z - 3)) < 5) continue;
    if (mobsOfType("enderman").some((other) => Math.hypot(other.pos.x - x, other.pos.z - z) < 3)) continue;
    break;
  }
  const mob = {
    ...model, type: "enderman", dim: "end", pos: model.root.position,
    hw: 0.31, h: 2.7, alive: true, t: mobHash(index, 13, 9405) * 6,
    lookTime: 0, angryTime: 0, redTime: 0,
  };
  model.root.position.set(x, END_PLATFORM_TOP + 1, z);
  model.root.rotation.y = mobHash(index, 17, 9406) * Math.PI * 2;
  sceneRef.add(model.root);
  return mob;
}

function dragonDamage(mob, amount) {
  if (!mob.alive || mob.health <= 0 || mob.dying > 0) return;
  mob.health = Math.max(0, mob.health - amount);
  mob.hitCount++;
  paintDragon(mob, mob.hitCount + 1);
  if (mob.health === 0) {
    mob.dying = 1.5;
    mob.deathFlash = 0;
    mob.deathColorIndex = 0;
    mob.deathOrigin = mob.pos.clone();
    mob.deathRoll = mob.root.rotation.z;
    mob.spitting = 0;
  }
}

function createDragon() { return makeDragon(); }
function createEnderman({ index }) { return makeEnderman(index); }

function dragonAimHit(mob, origin, direction) {
  mob.root.updateMatrixWorld(true);
  dragonRaycaster.set(origin, direction);
  const hits = dragonRaycaster.intersectObject(mob.root, true);
  return hits.length ? hits[0].distance : null;
}

registerMobType({
  key: "dragon",
  capabilities: { flying: true, homingTnt: true },
  homingTntShots: Infinity,
  aimHitTest: dragonAimHit,
  create: createDragon,
  tick: tickDragon,
  damage: dragonDamage,
  dispose: disposeEndMob,
});
registerMobType({
  key: "enderman",
  capabilities: { flying: false, homingTnt: false },
  create: createEnderman,
  tick: tickEnderman,
  dispose: disposeEndMob,
});

function tickDragon(mob, dt, camera) {
  mob.t += dt;
  const root = mob.root;
  if (mob.dying > 0) {
    mob.dying -= dt;
    mob.deathFlash -= dt;
    if (mob.deathFlash <= 0) {
      mob.deathFlash = 0.1;
      mob.deathColorIndex = (mob.deathColorIndex + 1) % (HUES.length + 1);
      paintDragon(mob, mob.deathColorIndex);
    }
    const p = mob.deathOrigin;
    const shake = (Math.sin(mob.t * Math.PI * 2 * 7) * 0.6 + Math.sin(mob.t * Math.PI * 2 * 13.1 + 1.3) * 0.35 + (Math.random() - 0.5) * 0.6) * 1.6;
    root.position.set(p.x + shake, p.y + Math.abs(shake) * 0.5, p.z + shake * 0.6);
    root.rotation.z = mob.deathRoll + shake * 0.8;
    if (mob.dying <= 0) {
      const at = root.position;
      const spectrum = HUES.map((hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);
      spectrum.push([1, 1, 1]);
      spawnBurst({ x: at.x, y: at.y + 1, z: at.z, count: 1600, life: 2, size: 0.44, speedMin: 2, speedMax: 15, up: 7, gravity: 5, fillRadius: 0.8, palette: spectrum });
      spawnBurst({ x: at.x, y: at.y + 1, z: at.z, count: 600, life: 1.25, size: 0.24, speedMin: 5, speedMax: 22, up: 9, gravity: 3, palette: spectrum });
      mob.alive = false;
      mob.homingUnregister?.();
      sceneRef.remove(root);
      setEndCleared(true);
      const unlocked = noteDragonKill();
      onDragonVictory?.(unlocked);
      return;
    }
    mob.pos.copy(root.position);
    return;
  }

  const a = mob.t * 0.22 * DRAGON_SPEED_MULT;
  const radiusX = 24, radiusZ = 21;
  const y = THREE.MathUtils.clamp(END_PLATFORM_TOP + 14.5 + Math.sin(a * 1.7) * 7.5, DRAGON_MIN_Y, DRAGON_MAX_Y);
  root.position.set(Math.cos(a) * radiusX, y, Math.sin(a) * radiusZ);
  const fx = root.position.x - camera.position.x;
  const fy = root.position.y - camera.position.y;
  const fz = root.position.z - camera.position.z;
  const fd = Math.hypot(fx, fy, fz);
  if (fd > 0.001 && fd < 16) {
    const weight = 1 - fd / 16;
    root.position.add(new THREE.Vector3(fx / fd, fy / fd * 0.4, fz / fd).normalize().multiplyScalar(11 * DRAGON_SPEED_MULT * weight * dt));
    root.position.y = THREE.MathUtils.clamp(root.position.y, DRAGON_MIN_Y, DRAGON_MAX_Y);
  }
  mob.pos.copy(root.position);
  root.rotation.y = Math.atan2(-Math.sin(a) * radiusX, Math.cos(a) * radiusZ);
  root.rotation.x = -Math.cos(a * 1.7) * 0.12;
  root.rotation.z = Math.sin(a * 0.8) * 0.13;
  const flap = Math.sin(mob.t * 3.1) * 0.62;
  mob.wings[0].rotation.z = flap;
  mob.wings[1].rotation.z = -flap;
  mob.wings[0].rotation.y = 0.12 + flap * 0.1;
  mob.wings[1].rotation.y = -0.12 - flap * 0.1;
  mob.neck.rotation.z = Math.sin(mob.t * 0.8) * 0.05;
  mob.head.rotation.y = Math.sin(mob.t * 0.55) * 0.12;
  mob.tail.forEach((segment, i) => {
    const k = (i + 1) / mob.tail.length;
    segment.rotation.y = Math.sin(mob.t * 3 - i * 0.7) * 0.25 * k;
    segment.rotation.x = Math.sin(mob.t * 2.2 + i * 0.9) * 0.12 * k;
  });
  mob.spitTimer -= dt;
  if (mob.spitting > 0) mob.spitting = Math.max(0, mob.spitting - dt);
  else if (mob.spitTimer <= 0) {
    mob.spitting = 0.85;
    mob.breathEmit = 0;
    mob.spitTimer = randomDragonSpitInterval();
  }
  if (mob.spitting > 0) {
    mob.breathEmit -= dt;
    if (mob.breathEmit <= 0) {
      mob.breathEmit = 0.1;
      mob.mouth.updateWorldMatrix(true, false);
      const mouthPos = mob.mouth.getWorldPosition(new THREE.Vector3());
      const mouthRotation = mob.mouth.getWorldQuaternion(new THREE.Quaternion());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mouthRotation).normalize();
      const breath = mob.eyeMat.color;
      const base = [breath.r, breath.g, breath.b];
      const bright = base.map((channel) => Math.min(1, channel * 1.4 + 0.08));
      spawnBurst({
        x: mouthPos.x + forward.x * 0.35, y: mouthPos.y + forward.y * 0.35, z: mouthPos.z + forward.z * 0.35,
        count: 32, life: 0.8, size: 0.3, speedMin: 7, speedMax: 14, up: 0.2, gravity: 1.4,
        direction: forward.toArray(), spread: 0.28, palette: [base, bright],
      });
    }
  }
}

function rayAabb(origin, dir, mob) {
  let near = 0, far = Infinity;
  const lo = [mob.pos.x - mob.hw, mob.pos.y, mob.pos.z - mob.hw];
  const hi = [mob.pos.x + mob.hw, mob.pos.y + mob.h, mob.pos.z + mob.hw];
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? origin.x : i === 1 ? origin.y : origin.z;
    const d = i === 0 ? dir.x : i === 1 ? dir.y : dir.z;
    if (Math.abs(d) < 1e-8) { if (o < lo[i] || o > hi[i]) return null; continue; }
    const a = (lo[i] - o) / d, b = (hi[i] - o) / d;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return far >= 0 ? near : null;
}

function endermanLookedAt(mob, camera) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const distance = rayAabb(camera.position, dir, mob);
  if (distance == null || distance > 80) return false;
  const block = pickBlock(camera.position, dir, true, distance, Math.ceil(distance * 2) + 8);
  if (block) {
    const d = Math.hypot(block.x + 0.5 - camera.position.x, block.y + 0.5 - camera.position.y, block.z + 0.5 - camera.position.z);
    if (d < distance - 0.2) return false;
  }
  return true;
}

function teleportEnderman(mob, camera) {
  const from = mob.pos;
  spawnBurst({ x: from.x, y: from.y + 1.2, z: from.z, count: 24, color: [0.55, 0.12, 0.9], speedMin: 1, speedMax: 5, life: 0.45, size: 0.12, gravity: 0 });
  let pick = null;
  for (let i = 0; i < 32; i++) {
    const a = mobHash(i, mobSpawnCount, 9407) * Math.PI * 2;
    const r = 5 + mobHash(mobSpawnCount, i, 9408) * 13;
    const x = Math.max(-END_PLATFORM_RADIUS + 1, Math.min(END_PLATFORM_RADIUS - 1, Math.round(from.x + Math.cos(a) * r)));
    const z = Math.max(-END_PLATFORM_RADIUS + 1, Math.min(END_PLATFORM_RADIUS - 1, Math.round(from.z + Math.sin(a) * r)));
    if (Math.abs(x) <= 3 && Math.abs(z - END_RETURN_Z) <= 3) continue;
    if (mobsOfType("enderman").some((other) => other !== mob && Math.hypot(other.pos.x - x, other.pos.z - z) < 2.5)) continue;
    if (Math.hypot(camera.position.x - x, camera.position.z - z) < 4) continue;
    pick = { x, z }; break;
  }
  if (!pick) pick = { x: -Math.sign(from.x || 1) * 26, z: from.z };
  mob.root.position.set(pick.x, END_PLATFORM_TOP + 1, pick.z);
  mob.pos.copy(mob.root.position);
  mob.lookTime = 0; mob.angryTime = 0.5; mob.redTime = 0.5;
  spawnBurst({ x: pick.x, y: mob.pos.y + 1.2, z: pick.z, count: 24, color: [0.55, 0.12, 0.9], speedMin: 1, speedMax: 5, life: 0.45, size: 0.12, gravity: 0 });
}

function tickEnderman(mob, dt, camera) {
  mob.t += dt;
  if (mob.angryTime > 0) mob.angryTime = Math.max(0, mob.angryTime - dt);
  if (mob.redTime > 0) mob.redTime = Math.max(0, mob.redTime - dt);
  const dx = camera.position.x - mob.pos.x, dz = camera.position.z - mob.pos.z;
  if (Math.hypot(dx, dz) > 0.001) mob.root.rotation.y = Math.atan2(dx, dz);
  const shaking = mob.angryTime > 0;
  const amp = shaking ? 0.45 : 0.06;
  const phase = mob.t * (shaking ? 16 : 1.8);
  mob.armL.rotation.x = Math.sin(phase) * amp;
  mob.armR.rotation.x = Math.sin(phase + 0.6) * amp;
  mob.eyesMat.color.setHex(mob.redTime > 0 || mob.lookTime > 0 ? 0xff2222 : 0xb44cff);
  if (mob.angryTime > 0) return;
  if (endermanLookedAt(mob, camera)) {
    mob.lookTime += dt;
    if (mob.lookTime >= 0.3) teleportEnderman(mob, camera);
  } else mob.lookTime = Math.max(0, mob.lookTime - dt * 2);
  mob.pos.copy(mob.root.position);
}

function mobsOfType(type) { return [...mobs].filter((m) => m.type === type && m.alive); }

function disposeEndMob(mob) {
  mob.homingUnregister?.();
  if (mob.root) sceneRef?.remove(mob.root);
  mob.alive = false;
  mobs.delete(mob);
  if (mob === dragonRef) dragonRef = null;
}

let onDragonVictory = null;
export function setDragonVictoryHook(fn) { onDragonVictory = fn; }

export function enterEndMobs(scene) {
  sceneRef = scene;
  if (!endermanBodyMat) endermanBodyMat = makeMat(0x0c0a12, { emissive: 0x000000, roughness: 0.85, metalness: 0.05 });
  if (!endermanHaloMat) endermanHaloMat = new THREE.MeshBasicMaterial({ color: 0x8b32c7, transparent: true, opacity: 0.22, side: THREE.BackSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
  clearEndMobs();
  setEndCleared(false);
  dragonRef = createMob("dragon");
  mobs.add(dragonRef);
  for (let i = 0; i < 10; i++) {
    const mob = createMob("enderman", { index: i });
    mobs.add(mob);
  }
  return dragonRef;
}

export function clearEndMobs() {
  for (const mob of [...mobs]) mobType(mob.type)?.dispose?.(mob);
  mobs.clear();
  dragonRef = null;
}

export function tickEndMobs(dt, camera) {
  for (const mob of mobs) {
    if (!mob.alive) continue;
    mobType(mob.type)?.tick?.(mob, dt, camera);
  }
}

export function dragonHealth() {
  return dragonRef?.alive && dragonRef.dying <= 0 ? dragonRef.health / dragonRef.maxHealth : 0;
}
