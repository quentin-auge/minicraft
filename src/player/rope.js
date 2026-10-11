// Rope-render backend: master-style instanced cube rope with a lateral
// wobble (no sag) for flight/pull/retract, the same S-wobble rope clamped
// above its segment for pinned moves, plus the pinned mark (dark head cube
// + 4 rope squares in a cross lying on the face). A future line-rope
// implements the same interface (init/show/hide) and hook.js needs no changes.
import * as THREE from "three";

const CUBE = 0.3;
const CAP = 2600;
const WOBBLE = 0.15;
// Mark cross: 4 rope-brown squares around the head in the face plane,
// center-to-center spacing, centered on the surface plane so half of each
// square sits buried like the head cube.
const TIP_N = 4;
const TIP_D = 0.16;
const TIP_LIFT = 0;

let sceneRef = null;
let mesh = null;
let tipMesh = null;
let head = null;
const _dummy = new THREE.Object3D();

export function initRope(scene) {
  sceneRef = scene;
}

export function showRope(ax, ay, az, bx, by, bz) {
  if (!sceneRef) return;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return;
  const n = Math.max(4, Math.min(CAP, Math.round(dist / CUBE)));
  ensureRope();
  ensureHead();
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  let vx = Math.abs(uy) < 0.99 ? uz : 1, vy = 0, vz = Math.abs(uy) < 0.99 ? -ux : 0;
  const vl = Math.hypot(vx, vy, vz) || 1;
  vx /= vl; vy /= vl; vz /= vl;
  const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const ox = Math.sin(f * Math.PI * 4) * WOBBLE, oy = Math.sin(f * Math.PI * 2) * WOBBLE;
    _dummy.position.set(ax + dx * f + vx * ox + wx * oy, ay + dy * f + vy * ox + wy * oy, az + dz * f + vz * ox + wz * oy);
    _dummy.rotation.set(0, 0, 0);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = true;
  head.position.set(bx, by, bz);
  head.visible = true;
}

// Pinned-move rope: the usual S-wobble cube rope, clamped above the
// eye→anchor segment — dips never dive under the line, so level walks read
// clean with no voxel queries. Drops and bumps off the segment may clip:
// allowed, the rope is not a drape.
export function showPinnedRope(ax, ay, az, bx, by, bz) {
  if (!sceneRef) return;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return;
  const n = Math.max(4, Math.min(CAP, Math.round(dist / CUBE)));
  ensureRope();
  ensureHead();
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  let vx = Math.abs(uy) < 0.99 ? uz : 1, vy = 0, vz = Math.abs(uy) < 0.99 ? -ux : 0;
  const vl = Math.hypot(vx, vy, vz) || 1;
  vx /= vl; vy /= vl; vz /= vl;
  const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const ox = Math.sin(f * Math.PI * 4) * WOBBLE, oy = Math.sin(f * Math.PI * 2) * WOBBLE;
    const px = ax + dx * f + vx * ox + wx * oy;
    const pz = az + dz * f + vz * ox + wz * oy;
    // Clamp above the segment: the S keeps its upward and lateral waves,
    // never its underground dips.
    const py = Math.max(ay + dy * f + vy * ox + wy * oy, ay + dy * f);
    _dummy.position.set(px, py, pz);
    _dummy.rotation.set(0, 0, 0);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = true;
  head.position.set(bx, by, bz);
  head.visible = true;
}

// Pinned-arrival mark: the dark head cube on the anchor + 4 rope squares
// in a cross lying on the face around it. Depth-tested: occluded by walls
// like the rest of the world, always visible on its own surface.
export function showTip(hx, hy, hz, nx, ny, nz) {
  if (!sceneRef) return;
  ensureTip();
  ensureHead();
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // Tangent basis of the face plane.
  let tx = 0, ty = 1, tz = 0;
  if (Math.abs(ny) > 0.99) { tx = 1; ty = 0; tz = 0; }
  let ux = ny * tz - nz * ty, uy = nz * tx - nx * tz, uz = nx * ty - ny * tx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const offs = [[ux, uy, uz, 1], [ux, uy, uz, -1], [vx, vy, vz, 1], [vx, vy, vz, -1]];
  for (let i = 0; i < TIP_N; i++) {
    const o = offs[i];
    _dummy.position.set(
      hx + o[0] * o[3] * TIP_D + nx * TIP_LIFT,
      hy + o[1] * o[3] * TIP_D + ny * TIP_LIFT,
      hz + o[2] * o[3] * TIP_D + nz * TIP_LIFT
    );
    _dummy.rotation.set(0, 0, 0);
    _dummy.updateMatrix();
    tipMesh.setMatrixAt(i, _dummy.matrix);
  }
  tipMesh.count = TIP_N;
  tipMesh.instanceMatrix.needsUpdate = true;
  tipMesh.visible = true;
  head.position.set(hx, hy, hz);
  head.visible = true;
}

function ensureRope() {
  if (!mesh) {
    mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x8a6d3b }),
      CAP
    );
    mesh.frustumCulled = false;
    sceneRef.add(mesh);
  }
}

function ensureHead() {
  if (!head) {
    head = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.17, 0.17),
      // Depth-tested like everything else: walls occlude the mark
      // properly, and the face offset keeps it visible on its surface.
      new THREE.MeshBasicMaterial({ color: 0x4a3a1e })
    );
    head.frustumCulled = false;
    sceneRef.add(head);
  }
}

function ensureTip() {
  if (!tipMesh) {
    tipMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x8a6d3b }),
      TIP_N
    );
    tipMesh.frustumCulled = false;
    sceneRef.add(tipMesh);
  }
}

export function hideRope() {
  if (mesh) mesh.visible = false;
  if (tipMesh) tipMesh.visible = false;
  if (head) head.visible = false;
}

// Hide only the rope line (head cube and mark stay visible).
export function hideLine() {
  if (mesh) mesh.visible = false;
}

// Hide the pinned mark (cross + dark head cube); the rope line is untouched.
// Retract calls this so nothing stays welded to the anchor behind the head.
export function hideTip() {
  if (tipMesh) tipMesh.visible = false;
  if (head) head.visible = false;
}
