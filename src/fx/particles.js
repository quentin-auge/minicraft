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
      transparent: true, opacity: 1, depthWrite: false, depthTest: false,
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

export function spawnFlash(o) {
  if (!sceneRef) return;
  const { x, y, z, color = 0xffdd77, life = 0.28, size = 1, growth = 4.2, maxRadius = null, speed = 30, retractSpeed = null } = o;
  if (maxRadius !== null) {
    // Fireball: expands to maxRadius at constant speed, then retracts at
    // retractSpeed (default: same as expand, symmetric). Bigger fireballs
    // burn longer: life = expand time + retract time.
    const rs = retractSpeed ?? speed;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
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
    new THREE.SphereGeometry(size, 10, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
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
