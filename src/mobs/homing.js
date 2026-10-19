// Generic TNT homing against mobs that expose the homingTnt capability.
import * as THREE from "three";
import { TNT } from "../core/blocks.js";
import { materialsFor } from "../core/textures.js";
import { pickBlock } from "../player/edit.js";
import { mobType } from "./registry.js";
import { spawnBurst, spawnFlash } from "../fx/particles.js";

const HOME_SPEED = 44;
const IMPACT_DISTANCE = 1.2;
const PROJECTILE_LIFETIME = 12;
const LOCK_WINDOW = 1.2;
const MAX_AIM_DISTANCE = 160;
const TARGETS = new Set();
const projectiles = new Set();
let sceneRef = null;
let targetLock = null;
let lockShots = 0;
let lockTime = -Infinity;
let now = 0;
let activeDim = "over";

const blockGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const tntMats = materialsFor(TNT);

export function initHomingTnt(scene) {
  sceneRef = scene;
}

export function registerHomingTarget(mob) {
  TARGETS.add(mob);
  return () => TARGETS.delete(mob);
}

function rayBox(origin, dir, mob) {
  const hw = mob.hw ?? 0.5, h = mob.h ?? 1;
  const lo = [mob.pos.x - hw, mob.pos.y, mob.pos.z - hw];
  const hi = [mob.pos.x + hw, mob.pos.y + h, mob.pos.z + hw];
  let t0 = 0, t1 = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
    const d = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
    if (Math.abs(d) < 1e-8) {
      if (o < lo[axis] || o > hi[axis]) return null;
      continue;
    }
    const a = (lo[axis] - o) / d, b = (hi[axis] - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    if (t0 > t1) return null;
  }
  return t1 >= 0 ? t0 : null;
}

function aimTarget(camera) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const block = pickBlock(camera.position, dir, true, MAX_AIM_DISTANCE, 2048);
  const blockDist = block ? Math.hypot(block.x + 0.5 - camera.position.x, block.y + 0.5 - camera.position.y, block.z + 0.5 - camera.position.z) : Infinity;
  let best = null, bestT = Math.min(MAX_AIM_DISTANCE, blockDist + 0.5);
  for (const mob of TARGETS) {
    const spec = mobType(mob.type);
    if (!mob.alive || mob.dim !== activeDim || !spec?.capabilities.homingTnt) continue;
    const t = spec.aimHitTest
      ? spec.aimHitTest(mob, camera.position, dir)
      : rayBox(camera.position, dir, mob);
    if (t == null || t > bestT) continue;
    best = mob;
    bestT = t;
  }
  return best;
}

function makeSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.5, 0.75, 1);
  sprite.userData = { canvas, texture, ctx: canvas.getContext("2d"), last: null };
  return sprite;
}

function drawFuse(sprite, value) {
  const u = sprite.userData;
  const tenth = Math.ceil(value * 10) / 10;
  if (u.last === tenth) return;
  u.last = tenth;
  u.ctx.clearRect(0, 0, 128, 64);
  u.ctx.font = "bold 52px monospace";
  u.ctx.textAlign = "center"; u.ctx.textBaseline = "middle";
  u.ctx.lineWidth = 10; u.ctx.strokeStyle = "rgba(0,0,0,0.85)";
  u.ctx.strokeText(tenth.toFixed(1), 64, 32);
  u.ctx.fillStyle = tenth <= 1 ? "#ff6a3d" : "#ffffff";
  u.ctx.fillText(tenth.toFixed(1), 64, 32);
  u.texture.needsUpdate = true;
}

export function fireHomingTnt(camera) {
  const target = aimTarget(camera);
  if (!target || !sceneRef) return false;
  const spec = mobType(target.type);
  if (now - lockTime > LOCK_WINDOW || targetLock !== target) {
    targetLock = target;
    lockShots = 0;
  }
  if (lockShots >= spec.homingTntShots) return true;
  const damage = spec.homingTntDamage ?? 1;
  if (Number.isFinite(target.health) && target.health - pendingDamage(target) < damage - 1e-6) return true;
  lockTime = now;
  lockShots++;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone().add(dir);
  const mesh = new THREE.Mesh(blockGeo, tntMats);
  const sprite = makeSprite();
  mesh.position.copy(origin);
  sprite.position.copy(origin).add(new THREE.Vector3(0, 0.85, 0));
  sceneRef.add(mesh, sprite);
  projectiles.add({ target, mesh, sprite, pos: origin, damage, life: PROJECTILE_LIFETIME });
  return true;
}

function pendingDamage(target) {
  let pending = 0;
  for (const projectile of projectiles) if (projectile.target === target) pending += projectile.damage;
  return pending;
}

function removeProjectile(p) {
  sceneRef?.remove(p.mesh, p.sprite);
  p.mesh.geometry = blockGeo;
  p.sprite.material.map?.dispose();
  p.sprite.material.dispose();
  projectiles.delete(p);
}

function detonate(p) {
  const target = p.target;
  const pos = p.pos;
  const spec = mobType(target.type);
  spawnFlash({ x: pos.x, y: pos.y, z: pos.z, color: 0xff7a24, life: 0.24, size: 0.7, growth: 8 });
  spawnBurst({ x: pos.x, y: pos.y, z: pos.z, count: 44, color: [1, 0.45, 0.12], speedMin: 2, speedMax: 8, life: 0.65, size: 0.2 });
  if (target.alive && spec?.damage) spec.damage(target, 1);
  removeProjectile(p);
}

export function tickHomingTnt(dt, activeDimension) {
  activeDim = activeDimension;
  now += dt;
  if (targetLock && (!targetLock.alive || targetLock.dim !== activeDimension)) {
    targetLock = null; lockShots = 0;
  }
  for (const p of [...projectiles]) {
    if (!p.target.alive || p.target.dim !== activeDimension) { removeProjectile(p); continue; }
    p.life -= dt;
    let aim = p.target.pos.clone().add(new THREE.Vector3(0, (p.target.h ?? 1) * 0.5, 0));
    let delta = aim.clone().sub(p.pos);
    let distance = delta.length();
    if (distance <= IMPACT_DISTANCE) {
      p.pos.copy(aim);
      detonate(p);
      continue;
    }
    if (distance > 1e-5) p.pos.addScaledVector(delta, Math.min(distance, HOME_SPEED * dt) / distance);
    aim = p.target.pos.clone().add(new THREE.Vector3(0, (p.target.h ?? 1) * 0.5, 0));
    distance = p.pos.distanceTo(aim);
    if (distance <= IMPACT_DISTANCE) {
      p.pos.copy(aim);
      detonate(p);
      continue;
    }
    p.mesh.position.copy(p.pos);
    p.sprite.position.set(p.pos.x, p.pos.y + 0.85, p.pos.z);
    drawFuse(p.sprite, distance / HOME_SPEED);
    if (p.life <= 0) removeProjectile(p);
  }
}

export function clearHomingTnt() {
  for (const p of [...projectiles]) removeProjectile(p);
  TARGETS.clear();
  targetLock = null; lockShots = 0; lockTime = -Infinity;
}
