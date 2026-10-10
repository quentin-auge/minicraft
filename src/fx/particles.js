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
  } = o;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = speedMin + Math.random() * (speedMax - speedMin);
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + up;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
    for (let j = 0; j < 3; j++)
      colors[i * 3 + j] = Math.min(1, Math.max(0, color[j] + Math.random() * variance[j]));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  sceneRef.add(pts);
  bursts.push({ pts, vel, life, max: life, gravity });
}

export function spawnFlash(o) {
  if (!sceneRef) return;
  const { x, y, z, color = 0xffdd77, life = 0.28, size = 1, growth = 4.2 } = o;
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
    const s = f.size * (0.4 + t * f.growth);
    f.mesh.scale.set(s, s, s);
    f.mesh.material.opacity = 0.95 * (f.life / f.max);
  }
}
