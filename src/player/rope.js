// Rope-render backend: master-style instanced cube rope with a slight sag.
// A future line-rope implements the same interface (init/show/hide) and
// hook.js needs no changes.
import * as THREE from "three";

const CUBE = 0.3;
const CAP = 800;

let sceneRef = null;
let mesh = null;
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
  const n = Math.min(CAP, Math.max(2, Math.ceil(dist / CUBE)));
  if (!mesh) {
    mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x8a6d3b }),
      CAP
    );
    mesh.frustumCulled = false;
    sceneRef.add(mesh);
  }
  if (!head) {
    head = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.17, 0.17),
      new THREE.MeshLambertMaterial({ color: 0x4a3a1e })
    );
    head.frustumCulled = false;
    sceneRef.add(head);
  }
  const sag = Math.min(1.5, dist * 0.05);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    _dummy.position.set(ax + dx * t, ay + dy * t - Math.sin(t * Math.PI) * sag, az + dz * t);
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

export function hideRope() {
  if (mesh) mesh.visible = false;
  if (head) head.visible = false;
}
