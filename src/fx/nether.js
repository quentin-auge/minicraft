// Nether ambience, ported from master: drifting sparks over the lava sea,
// eruption fountains on the volcano rims, and camera-local blue motes while
// the eye is submerged in lava. Points are updated on alternating halves so
// the per-frame integration stays cheap.
import * as THREE from "three";
import { LAVA } from "../core/blocks.js";
import { WORLD_RADIUS, getBlock } from "../core/store.js";
import { NETHER_FIRE_LEVEL, netherVolcanoes } from "../world/nether.js";

const EMBER_COUNT = 220;
const VOLCANO_EMBER_COUNT = 340;
const LAVA_MOTE_COUNT = 900;
const LAVA_MOTE_RANGE = 15;
const LAVA_MOTE_BLUES = [
  [0.10, 0.30, 1.0],
  [0.25, 0.50, 1.0],
  [0.45, 0.85, 1.0],
];

let embers = null;
let volcano = null;
let motes = null;

function makePoints(count, size, fog = true) {
  const posA = new Float32Array(count * 3);
  const colA = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    posA[i * 3] = 0;
    posA[i * 3 + 1] = -100;
    posA[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, opacity: 1,
    fog, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, posA, colA, geo, mat };
}

function disposePoints(s, scene) {
  if (!s) return;
  if (scene) scene.remove(s.pts);
  s.geo.dispose();
  s.mat.dispose();
}

function ensureEmbers(scene) {
  if (embers) return;
  const base = makePoints(EMBER_COUNT, 0.16);
  embers = {
    ...base,
    vel: new Float32Array(EMBER_COUNT * 3),
    life: new Float32Array(EMBER_COUNT),
    stride: 0,
  };
  for (let i = 0; i < EMBER_COUNT; i++) {
    embers.colA[i * 3] = 0.85 + Math.random() * 0.15;
    embers.colA[i * 3 + 1] = 0.9 + Math.random() * 0.1;
    embers.colA[i * 3 + 2] = 1;
  }
  embers.pts.geometry.attributes.color.needsUpdate = true;
  scene.add(embers.pts);
}

function spawnEmber(s, cx, cz) {
  const S = WORLD_RADIUS;
  for (let tries = 0; tries < 8; tries++) {
    const px = cx + (Math.random() * 2 - 1) * 36;
    const pz = cz + (Math.random() * 2 - 1) * 36;
    const bx = Math.floor(px), bz = Math.floor(pz);
    if (bx < -S || bx > S || bz < -S || bz > S) continue;
    if (getBlock(bx, NETHER_FIRE_LEVEL, bz) === LAVA) {
      const i = s.spawnIndex;
      s.posA[i * 3] = bx + 0.5;
      s.posA[i * 3 + 1] = NETHER_FIRE_LEVEL + 0.6;
      s.posA[i * 3 + 2] = bz + 0.5;
      s.vel[i * 3] = (Math.random() * 2 - 1) * 0.8;
      s.vel[i * 3 + 1] = 2.5 + Math.random() * 3.5;
      s.vel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.8;
      s.life[i] = 2.2 + Math.random() * 2.6;
      return;
    }
  }
  // No lava found: kill the slot and park it out of sight, or it freezes
  // mid-air at its last position (retried every half-tick, never hidden).
  s.posA[s.spawnIndex * 3 + 1] = -100;
  s.life[s.spawnIndex] = 0;
}

function tickEmbers(dt, time, camera, scene) {
  ensureEmbers(scene);
  const s = embers;
  s.stride = (s.stride + 1) & 1;
  const sdt = dt * 2;
  for (let i = s.stride; i < EMBER_COUNT; i += 2) {
    if (s.life[i] <= 0 || s.posA[i * 3 + 1] > NETHER_FIRE_LEVEL + 24) {
      s.spawnIndex = i;
      spawnEmber(s, camera.position.x, camera.position.z);
    } else {
      s.life[i] -= sdt;
      s.posA[i * 3] += (s.vel[i * 3] + Math.sin(time * 2 + i) * 0.4) * sdt;
      s.posA[i * 3 + 1] += s.vel[i * 3 + 1] * sdt;
      s.posA[i * 3 + 2] += (s.vel[i * 3 + 2] + Math.cos(time * 1.7 + i) * 0.4) * sdt;
    }
  }
  s.pts.geometry.attributes.position.needsUpdate = true;
}

function ensureVolcano(scene) {
  if (volcano) return;
  const base = makePoints(VOLCANO_EMBER_COUNT, 0.34);
  volcano = {
    ...base,
    vel: new Float32Array(VOLCANO_EMBER_COUNT * 3),
    baseY: new Float32Array(VOLCANO_EMBER_COUNT),
    life: new Float32Array(VOLCANO_EMBER_COUNT),
    stride: 0,
  };
  for (let i = 0; i < VOLCANO_EMBER_COUNT; i++) {
    volcano.colA[i * 3] = 0.85 + Math.random() * 0.15;
    volcano.colA[i * 3 + 1] = 0.9 + Math.random() * 0.1;
    volcano.colA[i * 3 + 2] = 1;
  }
  volcano.pts.geometry.attributes.color.needsUpdate = true;
  scene.add(volcano.pts);
}

function spawnVolcanoEmber(s, i) {
  const list = netherVolcanoes();
  // No live crater to erupt from: park hidden instead of freezing mid-air.
  if (!list.length) { s.posA[i * 3 + 1] = -100; s.life[i] = 0; return; }
  const v = list[(Math.random() * list.length) | 0];
  for (let tries = 0; tries < 8; tries++) {
    const ox = (Math.random() * 2 - 1) * v.craterR * 0.9;
    const oz = (Math.random() * 2 - 1) * v.craterR * 0.9;
    if (ox * ox + oz * oz > v.craterR * v.craterR) continue;
    const base = v.rim - v.craterDepth * (0.2 + Math.random() * 0.5);
    // The crater lava is the fountain's fuel: a blasted-out crater spawns
    // nothing, so eruptions die with the volcano instead of firing from air.
    if (getBlock(Math.floor(v.x + ox), Math.floor(base), Math.floor(v.z + oz)) !== LAVA) continue;
    s.posA[i * 3] = v.x + ox + 0.5;
    s.posA[i * 3 + 1] = base;
    s.posA[i * 3 + 2] = v.z + oz + 0.5;
    s.vel[i * 3] = (Math.random() * 2 - 1) * 7;
    s.vel[i * 3 + 1] = 22 + Math.random() * 20;
    s.vel[i * 3 + 2] = (Math.random() * 2 - 1) * 7;
    s.baseY[i] = base;
    s.life[i] = 1.8 + Math.random() * 1.6;
    return;
  }
  // Crater blasted out (no lava at any tried cell): park hidden, same as above.
  s.posA[i * 3 + 1] = -100;
  s.life[i] = 0;
}

function tickVolcano(dt, time, scene) {
  ensureVolcano(scene);
  const s = volcano;
  s.stride = (s.stride + 1) & 1;
  const sdt = dt * 2;
  for (let i = s.stride; i < VOLCANO_EMBER_COUNT; i += 2) {
    if (s.life[i] <= 0) {
      spawnVolcanoEmber(s, i);
    } else {
      s.life[i] -= sdt;
      s.posA[i * 3] += (s.vel[i * 3] + Math.sin(time * 3 + i) * 0.9) * sdt;
      s.posA[i * 3 + 1] += s.vel[i * 3 + 1] * sdt;
      s.posA[i * 3 + 2] += (s.vel[i * 3 + 2] + Math.cos(time * 2.4 + i) * 0.9) * sdt;
      s.vel[i * 3 + 1] -= 30 * sdt;
      if (s.posA[i * 3 + 1] < s.baseY[i] - 3) s.life[i] = 0;
    }
  }
  s.pts.geometry.attributes.position.needsUpdate = true;
}

function seedMote(s, i, camera) {
  const R = LAVA_MOTE_RANGE;
  s.posA[i * 3] = camera.position.x + (Math.random() * 2 - 1) * R;
  s.posA[i * 3 + 1] = camera.position.y + (Math.random() * 2 - 1) * R;
  s.posA[i * 3 + 2] = camera.position.z + (Math.random() * 2 - 1) * R;
  s.vel[i * 3] = (Math.random() * 2 - 1) * 0.4;
  s.vel[i * 3 + 1] = 0.5 + Math.random();
  s.vel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.4;
}

function ensureMotes(scene, camera) {
  if (motes) return;
  const base = makePoints(LAVA_MOTE_COUNT, 0.07, false);
  motes = {
    ...base,
    vel: new Float32Array(LAVA_MOTE_COUNT * 3),
    stride: 0,
  };
  for (let i = 0; i < LAVA_MOTE_COUNT; i++) {
    seedMote(motes, i, camera);
    const c = LAVA_MOTE_BLUES[(Math.random() * LAVA_MOTE_BLUES.length) | 0];
    motes.colA[i * 3] = c[0] * 0.55;
    motes.colA[i * 3 + 1] = c[1] * 0.55;
    motes.colA[i * 3 + 2] = c[2] * 0.55;
  }
  motes.pts.geometry.attributes.color.needsUpdate = true;
  motes.pts.visible = false;
  scene.add(motes.pts);
}

function tickMotes(dt, time, camera, scene) {
  ensureMotes(scene, camera);
  const s = motes;
  const inside = getBlock(
    Math.floor(camera.position.x),
    Math.floor(camera.position.y),
    Math.floor(camera.position.z)
  ) === LAVA;
  s.pts.visible = inside;
  if (!inside) return;
  s.stride = (s.stride + 1) & 1;
  const sdt = dt * 2;
  const R = LAVA_MOTE_RANGE;
  const ex = camera.position.x, ey = camera.position.y, ez = camera.position.z;
  for (let i = s.stride; i < LAVA_MOTE_COUNT; i += 2) {
    let x = s.posA[i * 3] + (s.vel[i * 3] + Math.sin(time * 2 + i) * 0.3) * sdt;
    let y = s.posA[i * 3 + 1] + s.vel[i * 3 + 1] * sdt;
    let z = s.posA[i * 3 + 2] + (s.vel[i * 3 + 2] + Math.cos(time * 1.7 + i) * 0.3) * sdt;
    if (x - ex > R) x -= 2 * R; else if (x - ex < -R) x += 2 * R;
    if (y - ey > R) y -= 2 * R; else if (y - ey < -R) y += 2 * R;
    if (z - ez > R) z -= 2 * R; else if (z - ez < -R) z += 2 * R;
    if (getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== LAVA) {
      seedMote(s, i, camera);
      continue;
    }
    s.posA[i * 3] = x;
    s.posA[i * 3 + 1] = y;
    s.posA[i * 3 + 2] = z;
  }
  s.pts.geometry.attributes.position.needsUpdate = true;
}

export function init() {}

export function tick(dt, time, camera, scene) {
  if (!scene) return;
  tickEmbers(dt, time, camera, scene);
  tickVolcano(dt, time, scene);
  tickMotes(dt, time, camera, scene);
}

export function exit(scene) {
  if (embers) { disposePoints(embers, scene); embers = null; }
  if (volcano) { disposePoints(volcano, scene); volcano = null; }
  if (motes) { disposePoints(motes, scene); motes = null; }
}
