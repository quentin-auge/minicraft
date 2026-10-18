// Generic particle/flash effects: burst point clouds plus expanding flash
// spheres, integrated and auto-disposed by tickFx. TNT countdown and
// explosion is the first specialization; future effects reuse these spawners.
import * as THREE from "three";

let sceneRef = null;
const bursts = [];
const flashes = [];

export function initFx(scene) {
  sceneRef = scene;
}

export function spawnBurst(o) {
  if (!sceneRef) return;
  const {
    x, y, z, count, life = 0.8, size = 0.18, gravity = 22, additive = true,
    color = [1, 0.6, 0.15], variance = [0, 0.4, 0.2],
    speedMin = 4, speedMax = 12, up = 3,
    // Fill ball: initial positions spread uniformly through this radius
    // (0 = all at the center, as before). Same particles, same per-frame
    // cost — only the spawn layout changes.
    fillRadius = 0,
    // Palette: [[r,g,b], ...] picked uniformly per particle (plus a small
    // jitter), replacing color/variance when set.
    palette = null,
    // Foreground: skip depth testing and draw above everything (below the
    // block highlight), for bursts that must read through terrain.
    foreground = false,
  } = o;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let px = x, py = y, pz = z;
    if (fillRadius > 0) {
      const rr = fillRadius * Math.cbrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      px += rr * Math.sin(ph) * Math.cos(th);
      py += rr * Math.cos(ph);
      pz += rr * Math.sin(ph) * Math.sin(th);
    }
    positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = speedMin + Math.random() * (speedMax - speedMin);
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + up;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
    if (palette) {
      const pc = palette[(Math.random() * palette.length) | 0];
      for (let j = 0; j < 3; j++)
        colors[i * 3 + j] = Math.min(1, Math.max(0, pc[j] + (Math.random() - 0.5) * 0.08));
    } else {
      for (let j = 0; j < 3; j++)
        colors[i * 3 + j] = Math.min(1, Math.max(0, color[j] + Math.random() * variance[j]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, depthWrite: false,
    depthTest: !foreground,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  if (foreground) pts.renderOrder = 998;
  sceneRef.add(pts);
  bursts.push({ pts, vel, life, max: life, gravity });
}

// Persistent band-wipe shell (master's ultraShell recipe): one Points cloud
// with fixed per-particle directions, repositioned in place from the current
// front radius — a single draw call, zero per-frame allocation, however big
// the band gets. Respawn a small fraction per update so the wall shimmers
// instead of flickering.
const BAND_SHELL_N = 8000;
let bandShell = null; // { pts, dir, off, n }
export function initBandShell() {
  if (!sceneRef) return;
  if (!bandShell) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(BAND_SHELL_N * 3);
    const col = new Float32Array(BAND_SHELL_N * 3);
    const dir = new Float32Array(BAND_SHELL_N * 3);
    const off = new Float32Array(BAND_SHELL_N);
    for (let i = 0; i < BAND_SHELL_N; i++) {
      seedBandDir(dir, off, i);
      const r = Math.random();
      let c;
      if (r < 0.55) c = [1, 0.42 + Math.random() * 0.16, 0.05]; // embers
      else if (r < 0.8) c = [1, 0.7 + Math.random() * 0.2, 0.12]; // hot sparks
      else { const g = 0.22 + Math.random() * 0.16; c = [g + 0.12, g * 0.9, g * 0.7]; } // smoke
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 3, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 1, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 997;
    pts.visible = false;
    sceneRef.add(pts);
    bandShell = { pts, dir, off, n: BAND_SHELL_N };
  }
  bandShell.pts.visible = true;
}
function seedBandDir(dir, off, i) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  dir[i * 3] = s * Math.cos(a);
  dir[i * 3 + 1] = u;
  dir[i * 3 + 2] = s * Math.sin(a);
  off[i] = -Math.random() * 15;
}
export function updateBandShell(cx, cy, cz, front, yLo, yHi) {
  if (!bandShell) return;
  const { pts, dir, off, n } = bandShell;
  const arr = pts.geometry.attributes.position.array;
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.04) seedBandDir(dir, off, i);
    const r = Math.max(0, front + off[i]);
    let py = cy + dir[i * 3 + 1] * r;
    if (py < yLo) py = yLo;
    else if (yHi !== null && yHi !== undefined && py > yHi) py = yHi;
    arr[i * 3] = cx + dir[i * 3] * r;
    arr[i * 3 + 1] = py;
    arr[i * 3 + 2] = cz + dir[i * 3 + 2] * r;
  }
  pts.geometry.attributes.position.needsUpdate = true;
  pts.visible = true;
}
export function hideBandShell() {
  if (bandShell) bandShell.pts.visible = false;
}

// Shared unit-sphere geometry for flashes: one allocation reused by every
// fireball (scale carries the radius), so megas never pay geometry churn.
// Exported for the mega countdown telegraph shell (same recipe).
let flashGeo = null;
export function sharedFlashGeo() {
  if (!flashGeo) flashGeo = new THREE.SphereGeometry(1, 20, 14);
  return flashGeo;
}

// Dense GPU particle pools: preallocated once, zero per-blast allocation,
// zero per-frame CPU integration. Each particle stores base position,
// velocity, color, and (birth, life, gravity, size); the vertex shader
// integrates motion from the uTime uniform, so a 50k blast costs one
// uniform update per frame plus a single attribute upload at spawn.
const DENSE_VERT = `
attribute vec3 aVel;
attribute vec3 aCol;
attribute vec4 aPrm; // birth, life, gravity, size
uniform float uTime;
varying vec3 vCol;
varying float vFade;
void main() {
  float age = uTime - aPrm.x;
  float life = max(0.001, aPrm.y);
  float t = clamp(age / life, 0.0, 1.0);
  float g = aPrm.z;
  vec3 p = position + aVel * max(age, 0.0);
  p.y -= 0.5 * g * age * age;
  vCol = aCol;
  vFade = (age < 0.0 || age > life) ? 0.0 : (1.0 - t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aPrm.w * vFade;
  gl_PointSize = sz * (240.0 / max(1.0, -mv.z));
}
`;
const DENSE_FRAG = `
varying vec3 vCol;
varying float vFade;
void main() {
  if (vFade <= 0.003) discard;
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.08, d) * vFade;
  gl_FragColor = vec4(vCol, a);
}
`;
function makeDensePool(n, additive, depthTest = false) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const velA = new Float32Array(n * 3);
  const colA = new Float32Array(n * 3);
  const prmA = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) prmA[i * 4] = -1e9; // dead until seeded
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aVel", new THREE.BufferAttribute(velA, 3));
  geo.setAttribute("aCol", new THREE.BufferAttribute(colA, 3));
  geo.setAttribute("aPrm", new THREE.BufferAttribute(prmA, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: DENSE_VERT, fragmentShader: DENSE_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, depthTest,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 996 : 995;
  pts.visible = false;
  return { pts, n, cursor: 0, time: 0, maxLife: 0, dStart: -1, dLen: 0, dFull: false };
}
const denseFire = makeDensePool(49152, true, false);
const denseEmber = makeDensePool(12288, true, false);
const denseSmoke = makeDensePool(16384, false, false);
// Occluded twins: same engine, depth-tested so blasts hide behind terrain.
// Blast layers go here; only around-the-lens furnace bursts keep the
// foreground (depth-ignoring) pools above.
const denseFireOcc = makeDensePool(49152, true, true);
const denseEmberOcc = makeDensePool(12288, true, true);
const denseSmokeOcc = makeDensePool(16384, false, true);
const DENSE_POOLS = [denseFire, denseEmber, denseSmoke, denseFireOcc, denseEmberOcc, denseSmokeOcc];
// Precomputed sample tables: unit sphere directions + radius factors with
// ball (cbrt) and disc (sqrt) distributions, shuffled so sequential reads
// stay uniform. Seeding becomes indexed lookups instead of acos/cbrt/sin/cos
// per particle — the dominant single-frame JS cost of a mass blast.
const SAMPLE_N = 4096;
const UNIT = new Float32Array(SAMPLE_N * 3);
const RADB = new Float32Array(SAMPLE_N); // cbrt: uniform ball fill
const RADD = new Float32Array(SAMPLE_N); // sqrt: uniform disc fill
for (let i = 0; i < SAMPLE_N; i++) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  UNIT[i * 3] = s * Math.cos(a);
  UNIT[i * 3 + 1] = u;
  UNIT[i * 3 + 2] = s * Math.sin(a);
  RADB[i] = Math.cbrt((i + 0.5) / SAMPLE_N);
  RADD[i] = Math.sqrt((i + 0.5) / SAMPLE_N);
}
for (let i = SAMPLE_N - 1; i > 0; i--) {
  const j = (Math.random() * (i + 1)) | 0;
  let t = RADB[i]; RADB[i] = RADB[j]; RADB[j] = t;
  t = RADD[i]; RADD[i] = RADD[j]; RADD[j] = t;
}
let densePoolsLive = false;
function densePoolFor(role, occ = true) {
  if (occ) return role === "smoke" ? denseSmokeOcc : role === "ember" ? denseEmberOcc : denseFireOcc;
  return role === "smoke" ? denseSmoke : role === "ember" ? denseEmber : denseFire;
}
function ensureDenseInScene() {
  if (!sceneRef || densePoolsLive) return;
  for (const p of DENSE_POOLS) {
    sceneRef.add(p.pts);
    p.pts.visible = true;
  }
  densePoolsLive = true;
}
// Count scales with crater volume so big pools get denser, capped by pool.
export function denseCount(R, density, min, max) {
  return Math.max(min, Math.min(max, Math.round(density * R * R * R)));
}
// shapes: ball (uniform volume), shell (surface), column, ring (flat),
// rain (disc above, falling), inward (surface rushing to center).
export function spawnDense(o) {
  if (!sceneRef) return 0;
  ensureDenseInScene();
  const {
    x, y, z, R, role = "fire", count = 4000, life = 1.5,
    palette = null, color = [1, 0.6, 0.15], variance = [0, 0.4, 0.2],
    speedMin = 2, speedMax = 10, up = 4, gravity = 22, size = 26,
    shape = "ball", delay = 0, birthJitter = 0.15, defer = false, vSpread = 1,
    // Occluded pools (depth-tested, hidden behind terrain) are the default:
    // blast layers disappear behind rock. Around-the-lens furnace bursts
    // pass occlude:false to keep burning whatever is nearby.
    occlude = true,
  } = o;
  const pool = densePoolFor(role, occlude);
  const n = Math.min(count, pool.n);
  const posA = pool.pts.geometry.attributes.position.array;
  const velA = pool.pts.geometry.attributes.aVel.array;
  const colA = pool.pts.geometry.attributes.aCol.array;
  const prmA = pool.pts.geometry.attributes.aPrm.array;
  const t0 = pool.time + delay;
  let start = pool.cursor;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % pool.n;
    let px = x, py = y, pz = z, vx, vy, vz;
    if (shape === "shell" || shape === "inward") {
      const si = (Math.random() * SAMPLE_N) | 0;
      const dx = UNIT[si * 3], dy = UNIT[si * 3 + 1], dz = UNIT[si * 3 + 2];
      const rr = R * (0.92 + Math.random() * 0.08);
      px += rr * dx;
      py += rr * dy;
      pz += rr * dz;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      const inv = shape === "inward" ? -1 : 1;
      vx = inv * s * dx;
      vy = inv * s * dy + up;
      vz = inv * s * dz;
    } else if (shape === "column") {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = R * 0.42 * RADD[(Math.random() * SAMPLE_N) | 0];
      const h = (Math.random() - 0.3) * R * 1.6;
      px += ca * rr; py += h; pz += sa * rr;
      const sw = 6 + Math.random() * 10;
      vx = -sa * sw + (Math.random() - 0.5) * 3;
      vy = 14 + Math.random() * 22;
      vz = ca * sw + (Math.random() - 0.5) * 3;
    } else if (shape === "ring") {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = R * (0.85 + Math.random() * 0.3);
      px += ca * rr; py += (Math.random() - 0.5) * 3 * vSpread; pz += sa * rr;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      vx = ca * s; vy = up * (Math.random() - 0.3) * vSpread; vz = sa * s;
    } else if (shape === "rain") {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = R * RADD[(Math.random() * SAMPLE_N) | 0];
      px += ca * rr; py += R * (0.4 + Math.random() * 0.9); pz += sa * rr;
      vx = (Math.random() - 0.5) * 3;
      vy = -(4 + Math.random() * 10);
      vz = (Math.random() - 0.5) * 3;
    } else { // ball: uniform volume fill, outward drift (table lookups)
      const pi = (Math.random() * SAMPLE_N) | 0;
      const rr = R * RADB[pi];
      px += rr * UNIT[pi * 3];
      py += rr * UNIT[pi * 3 + 1] * 0.9;
      pz += rr * UNIT[pi * 3 + 2];
      const vi = (Math.random() * SAMPLE_N) | 0;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      vx = s * UNIT[vi * 3];
      vy = s * UNIT[vi * 3 + 1] + up;
      vz = s * UNIT[vi * 3 + 2];
    }
    posA[i * 3] = px; posA[i * 3 + 1] = py; posA[i * 3 + 2] = pz;
    velA[i * 3] = vx; velA[i * 3 + 1] = vy; velA[i * 3 + 2] = vz;
    if (palette) {
      const pc = palette[(Math.random() * palette.length) | 0];
      for (let j = 0; j < 3; j++)
        colA[i * 3 + j] = Math.min(1, Math.max(0, pc[j] + (Math.random() - 0.5) * 0.08));
    } else {
      for (let j = 0; j < 3; j++)
        colA[i * 3 + j] = Math.min(1, Math.max(0, color[j] + Math.random() * variance[j]));
    }
    prmA[i * 4] = t0 + Math.random() * birthJitter;
    prmA[i * 4 + 1] = life * (0.7 + Math.random() * 0.6);
    prmA[i * 4 + 2] = gravity;
    prmA[i * 4 + 3] = size * (0.7 + Math.random() * 0.6);
  }
  pool.cursor = (start + n) % pool.n;
  // Dirty-range tracking: batched uploads flush once per pooled blast
  // (flushDense) and only re-upload the written slice, not whole buffers.
  if (pool.dStart < 0) { pool.dStart = start; pool.dLen = n; }
  else pool.dLen += n;
  if (start + n > pool.n) pool.dFull = true;
  pool.maxLife = Math.max(pool.maxLife, t0 + life + birthJitter - pool.time + 0.1);
  pool.pts.visible = true;
  if (!defer) flushDense();
  return n;
}
// Upload-once barrier for a pooled blast: every layer above wrote with
// defer:true, so one partial upload per pool covers the whole blast.
export function flushDense() {
  for (const pool of DENSE_POOLS) {
    if (pool.dStart < 0) continue;
    const attrs = pool.pts.geometry.attributes;
    const full = pool.dFull || pool.dLen >= pool.n;
    const list = [
      [attrs.position, pool.dStart * 3, pool.dLen * 3],
      [attrs.aVel, pool.dStart * 3, pool.dLen * 3],
      [attrs.aCol, pool.dStart * 3, pool.dLen * 3],
      [attrs.aPrm, pool.dStart * 4, pool.dLen * 4],
    ];
    for (const [at, s, c] of list) {
      if (!full) {
        try {
          if (typeof at.addUpdateRange === "function") at.addUpdateRange(s, c);
          else if (at.updateRange) { at.updateRange.offset = s; at.updateRange.count = c; }
        } catch { /* fall through to full upload */ }
      }
      at.needsUpdate = true;
    }
    pool.dStart = -1; pool.dLen = 0; pool.dFull = false;
  }
}
// Instanced voxel debris: one small pool, cheap at 384 boxes.
let debris = null; // { mesh, vel, spin, birth, life, n, active }
export function spawnDebris(o) {
  if (!sceneRef) return;
  // One debris burst at a time: mass pooled blasts keep the first member's
  // cubes instead of paying per-member matrix streams.
  if (debris?.active && denseFire.time - debris.birth < debris.life * 0.5) return;
  const { x, y, z, R, count = 260, life = 1.6 } = o;
  if (!debris) {
    const n = 384;
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    mesh.visible = false;
    const dummy = new THREE.Object3D();
    dummy.position.set(0, -9999, 0);
    dummy.updateMatrix();
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    sceneRef.add(mesh);
    debris = { mesh, vel: new Float32Array(n * 3), spin: new Float32Array(n * 2), birth: 0, life: 0, n, active: false, rot: new Float32Array(n * 2) };
  }
  const m = Math.min(count, debris.n);
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  for (let i = 0; i < m; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const rr = R * 0.5 * Math.cbrt(Math.random());
    dummy.position.set(x + rr * Math.sin(ph) * Math.cos(th), y + rr * Math.cos(ph), z + rr * Math.sin(ph) * Math.sin(th));
    const s = 10 + Math.random() * 22;
    debris.vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    debris.vel[i * 3 + 1] = Math.abs(s * Math.cos(ph)) + 14 + Math.random() * 10;
    debris.vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
    debris.spin[i * 2] = (Math.random() - 0.5) * 12;
    debris.spin[i * 2 + 1] = (Math.random() - 0.5) * 12;
    debris.rot[i * 2] = Math.random() * Math.PI;
    debris.rot[i * 2 + 1] = Math.random() * Math.PI;
    dummy.rotation.set(debris.rot[i * 2], debris.rot[i * 2 + 1], 0);
    dummy.updateMatrix();
    debris.mesh.setMatrixAt(i, dummy.matrix);
    const g = 0.25 + Math.random() * 0.3;
    debris.mesh.setColorAt(i, c.setRGB(g + 0.25, g * 0.8, g * 0.6));
  }
  debris.mesh.instanceMatrix.needsUpdate = true;
  if (debris.mesh.instanceColor) debris.mesh.instanceColor.needsUpdate = true;
  debris.birth = denseFire.time;
  debris.life = life;
  debris.active = true;
  debris.count = m;
  debris.ox = x; debris.oy = y; debris.oz = z;
  debris.mesh.visible = true;
}
const _dd = new THREE.Object3D();
const _dm = new THREE.Matrix4();
export function tickDenseFx(dt) {
  if (!densePoolsLive && !debris?.active) {
    // Still advance clocks so births stay valid once pools exist.
    for (const p of DENSE_POOLS) p.time += dt;
    return;
  }
  for (const p of DENSE_POOLS) {
    p.time += dt;
    p.pts.material.uniforms.uTime.value = p.time;
  }
  // Pools sleep again once the last particle dies: zero dense draw calls
  // in steady state until the next blast re-shows them on spawn.
  if (lastDenseEnd >= 0 && denseFire.time > lastDenseEnd + 0.2) {
    for (const p of DENSE_POOLS) p.pts.visible = false;
    lastDenseEnd = -1;
  }
  if (debris?.active) {
    const age = denseFire.time - debris.birth;
    if (age > debris.life) {
      debris.active = false;
      debris.mesh.visible = false;
    } else {
      // Integrate from current matrices (cheap at 384).
      for (let i = 0; i < debris.count; i++) {
        debris.vel[i * 3 + 1] -= 42 * dt;
        debris.mesh.getMatrixAt(i, _dm);
        _dd.position.setFromMatrixPosition(_dm);
        _dd.position.x += debris.vel[i * 3] * dt;
        _dd.position.y += debris.vel[i * 3 + 1] * dt;
        _dd.position.z += debris.vel[i * 3 + 2] * dt;
        if (_dd.position.y < 1) { _dd.position.y = 1; debris.vel[i * 3 + 1] *= -0.35; }
        debris.rot[i * 2] += debris.spin[i * 2] * dt;
        debris.rot[i * 2 + 1] += debris.spin[i * 2 + 1] * dt;
        _dd.rotation.set(debris.rot[i * 2], debris.rot[i * 2 + 1], 0);
        _dd.updateMatrix();
        debris.mesh.setMatrixAt(i, _dd.matrix);
      }
      debris.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
export function denseFxActive() {
  if (!densePoolsLive) return false;
  const t = denseFire.time;
  // Active if any pool still has live particles (approx via recent spawn).
  return (denseFire.pts.visible && t < lastDenseEnd);
}
// First-blast warmup: get the pools into the scene and their programs
// compiled before anything explodes, so blast #1 never pays scene-add +
// shader compile + first upload in a single frame. Called behind the menu;
// resetDenseFx() right after clears the seed particles (and re-hides).
export function prewarmDenseFx() {
  if (!sceneRef) return;
  ensureDenseInScene();
  spawnDense({ x: 0.5, y: -100, z: 0.5, R: 2, count: 300, life: 0.5, size: 20, shape: "ball" });
  flushDense();
}
let lastDenseEnd = -1;
export function noteDenseSpawn(life) {
  lastDenseEnd = Math.max(lastDenseEnd, denseFire.time + life);
}
export function resetDenseFx() {
  for (const p of DENSE_POOLS) {
    p.time = 0;
    p.cursor = 0;
    p.maxLife = 0;
    p.dStart = -1; p.dLen = 0; p.dFull = false;
    p.pts.visible = false;
    const prm = p.pts.geometry.attributes.aPrm.array;
    for (let i = 0; i < p.n; i++) prm[i * 4] = -1e9;
    p.pts.geometry.attributes.aPrm.needsUpdate = true;
    if (p.pts.material.uniforms) p.pts.material.uniforms.uTime.value = 0;
  }
  lastDenseEnd = -1;
  if (debris) { debris.active = false; debris.mesh.visible = false; }
}

export function spawnFlash(o) {
  if (!sceneRef) return;
  const { x, y, z, color = 0xffdd77, life = 0.28, size = 1, growth = 4.2, maxRadius = null, speed = 30, retractSpeed = null, doubleside = false, fogOff = false } = o;
  if (maxRadius !== null) {
    // Fireball: expands to maxRadius at constant speed, then retracts at
    // retractSpeed (default: same as expand, symmetric). Bigger fireballs
    // burn longer: life = expand time + retract time. Giant fireballs
    // surround the camera, so they render double-sided (visible from
    // inside) and optionally ignore fog (a glow must not wash to sky-blue).
    const rs = retractSpeed ?? speed;
    const mesh = new THREE.Mesh(
      sharedFlashGeo(),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: doubleside ? THREE.DoubleSide : THREE.FrontSide, fog: !fogOff })
    );
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.001);
    sceneRef.add(mesh);
    const tGrow = Math.max(0.001, maxRadius / speed);
    const tShrink = Math.max(0.001, maxRadius / rs);
    flashes.push({ mesh, life: tGrow + tShrink, max: tGrow + tShrink, fireball: true, maxRadius, speed, tGrow, retractSpeed: rs, tShrink });
    return;
  }
  const mesh = new THREE.Mesh(
    sharedFlashGeo(),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, fog: !fogOff })
  );
  mesh.position.set(x, y, z);
  sceneRef.add(mesh);
  flashes.push({ mesh, life, max: life, size, growth });
}

export function tickFx(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt;
    if (b.life <= 0) {
      sceneRef.remove(b.pts);
      b.pts.geometry.dispose();
      b.pts.material.dispose();
      bursts.splice(i, 1);
      continue;
    }
    const p = b.pts.geometry.attributes.position.array;
    for (let j = 0; j < b.vel.length; j += 3) {
      b.vel[j + 1] -= b.gravity * dt;
      p[j] += b.vel[j] * dt;
      p[j + 1] += b.vel[j + 1] * dt;
      p[j + 2] += b.vel[j + 2] * dt;
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.opacity = Math.min(1, b.life / b.max);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.life -= dt;
    if (f.life <= 0) {
      sceneRef.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
      flashes.splice(i, 1);
      continue;
    }
    const t = 1 - f.life / f.max;
    if (f.fireball) {
      const age = f.max - f.life;
      const r = age < f.tGrow
        ? Math.min(f.maxRadius, f.speed * age)
        : Math.max(0.001, f.maxRadius - f.retractSpeed * (age - f.tGrow));
      f.mesh.scale.set(r, r, r);
      // Full brightness while expanding, linear fade while retracting.
      f.mesh.material.opacity = age < f.tGrow ? 0.95 : 0.95 * Math.max(0, f.life / f.tShrink);
    } else {
      const s = f.size * (0.4 + t * f.growth);
      f.mesh.scale.set(s, s, s);
      f.mesh.material.opacity = 0.95 * (f.life / f.max);
    }
  }
}
