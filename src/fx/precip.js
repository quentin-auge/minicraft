// Falling-precipitation backend: camera-following Points fields integrated
// at 30 Hz (invisible at fall speeds). Drops fill the column above the
// camera, wrap around it in XZ so flight never leaves them behind, and
// vanish on landing before respawning at the top. Sway reads a precomputed
// sine table and landing heights are cached per drop (one typed-array read,
// refreshed staggered plus on wrap) with a single getBlock confirm only near
// the ground, instead of trig plus a Map lookup per drop per frame.
//
// Extension shape: PRECIP_TYPES is the registry; the engine below never
// branches on kind names. Snow registers first with master's numbers;
// rain later is one entry (faster fall, no sway, own active/groundY).
import * as THREE from "three";
import { AIR } from "../core/blocks.js";
import { getBlock, topAt, dim } from "../core/store.js";
import { MOON_SURFACE_Y } from "../world/moon.js";

const PRECIP_DEFAULTS = {
  count: 700,
  range: 36,
  size: 0.18,
  step: 1 / 30,
  color: 0xffffff,
  opacity: 0.9,
  fallMin: 2.5,
  fallMax: 5.5,
  drift: 0.5,
  sway: 0.5,
  topMargin: 24,
  // Material fades from invisible to full over this camera-altitude span,
  // so the field never pops at its activation gate.
  fadeIn: null,
};

export const PRECIP_TYPES = [
  {
    key: "snow",
    ...PRECIP_DEFAULTS,
    // Snow falls anywhere in the Overworld above moon-surface altitude.
    active: (e) => dim === "over" && e.y >= MOON_SURFACE_Y - 8,
    // Drops land on the highest surface or the moon band, whichever is up.
    groundY: (bx, bz) => {
      const ct = topAt(dim, bx, bz);
      return ct > MOON_SURFACE_Y ? ct : MOON_SURFACE_Y;
    },
    // Initial fill spans the moon band up to the spawn top.
    seedY: (top) => Math.min(top, MOON_SURFACE_Y + 1 + Math.random() * Math.max(1, top - MOON_SURFACE_Y - 1)),
    // Below the moon band a drop only lands on a real block.
    landed: (x, y, z, landY) => y <= landY + 2 &&
      (y <= MOON_SURFACE_Y || getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== AIR),
    fadeIn: [MOON_SURFACE_Y - 8, MOON_SURFACE_Y],
  },
];

const specByKey = new Map(PRECIP_TYPES.map((s) => [s.key, s]));
const states = new Map();
let sceneRef = null;

const SIN = new Float32Array(256);
for (let i = 0; i < 256; i++) SIN[i] = Math.sin((i / 256) * Math.PI * 2);

export function initPrecip(scene) {
  sceneRef = scene;
}

function spawnDrop(spec, st, i, e, initial = false) {
  const attr = st.pts.geometry.attributes.position;
  const top = e.y + 8 + Math.random() * 14;
  attr.array[i * 3] = e.x + (Math.random() * 2 - 1) * spec.range;
  attr.array[i * 3 + 1] = initial ? spec.seedY(top) : top;
  attr.array[i * 3 + 2] = e.z + (Math.random() * 2 - 1) * spec.range;
  st.vel[i * 3] = (Math.random() * 2 - 1) * spec.drift;
  st.vel[i * 3 + 1] = spec.fallMin + Math.random() * (spec.fallMax - spec.fallMin);
  st.vel[i * 3 + 2] = (Math.random() * 2 - 1) * spec.drift;
  st.ground[i] = spec.groundY(Math.floor(attr.array[i * 3]), Math.floor(attr.array[i * 3 + 2]));
}

function ensureState(spec) {
  let st = states.get(spec.key);
  if (st) return st;
  const posA = new Float32Array(spec.count * 3);
  for (let i = 0; i < spec.count; i++) {
    posA[i * 3] = 0; posA[i * 3 + 1] = -100; posA[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posA, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setDrawRange(0, spec.count);
  const mat = new THREE.PointsMaterial({
    color: spec.color, size: spec.size, transparent: true, opacity: spec.opacity,
    depthWrite: false, fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  sceneRef.add(pts);
  st = {
    pts,
    vel: new Float32Array(spec.count * 3),
    ground: new Float32Array(spec.count),
    acc: 0,
    tick: 0,
    fresh: true,
  };
  states.set(spec.key, st);
  return st;
}

function removeState(spec) {
  const st = states.get(spec.key);
  if (!st) return;
  sceneRef.remove(st.pts);
  st.pts.geometry.dispose();
  st.pts.material.dispose();
  states.delete(spec.key);
}

export function tickPrecip(key, dt, time, camera) {
  const spec = specByKey.get(key);
  if (!spec) return;
  if (!spec.active(camera.position)) { removeState(spec); return; }
  const st = ensureState(spec);
  if (spec.fadeIn) {
    const t = (camera.position.y - spec.fadeIn[0]) / (spec.fadeIn[1] - spec.fadeIn[0]);
    const f = Math.max(0, Math.min(1, t));
    st.pts.material.opacity = spec.opacity * f * f * (3 - 2 * f);
    // Fully faded out: skip the draw call entirely (no visual change).
    st.pts.visible = f > 0;
  }
  if (st.fresh) { st.fresh = false; for (let i = 0; i < spec.count; i++) spawnDrop(spec, st, i, camera.position, true); }
  st.acc += dt;
  if (st.acc < spec.step) return;
  const step = st.acc;
  st.acc = 0;
  const tick = ++st.tick;
  const phase = (time * 19) | 0;
  const e = camera.position;
  const attr = st.pts.geometry.attributes.position;
  for (let i = 0; i < spec.count; i++) {
    const swayX = SIN[(phase + i * 7) & 255] * spec.sway;
    const swayZ = SIN[(phase + i * 13 + 64) & 255] * spec.sway;
    let x = attr.array[i * 3] + (st.vel[i * 3] + swayX) * step;
    let y = attr.array[i * 3 + 1] - st.vel[i * 3 + 1] * step;
    let z = attr.array[i * 3 + 2] + (st.vel[i * 3 + 2] + swayZ) * step;
    let wrapped = false;
    if (x - e.x > spec.range) { x -= 2 * spec.range; wrapped = true; }
    else if (x - e.x < -spec.range) { x += 2 * spec.range; wrapped = true; }
    if (z - e.z > spec.range) { z -= 2 * spec.range; wrapped = true; }
    else if (z - e.z < -spec.range) { z += 2 * spec.range; wrapped = true; }
    if (y > e.y + spec.topMargin) { spawnDrop(spec, st, i, e); continue; }
    let landY = st.ground[i];
    // Staggered landing-height refresh: each drop re-reads every 8th step, so
    // movement-time wrap storms cost a quarter of the column lookups. Drops
    // keep last known heights in between; landings lag at most ~0.27 s.
    if (wrapped || (i & 7) === (tick & 7)) {
      landY = spec.groundY(Math.floor(x), Math.floor(z));
      st.ground[i] = landY;
    }
    if (spec.landed(x, y, z, landY)) { spawnDrop(spec, st, i, e); continue; }
    attr.array[i * 3] = x;
    attr.array[i * 3 + 1] = y;
    attr.array[i * 3 + 2] = z;
  }
  attr.needsUpdate = true;
}

export function tickSnow(dt, time, camera) {
  tickPrecip("snow", dt, time, camera);
}
