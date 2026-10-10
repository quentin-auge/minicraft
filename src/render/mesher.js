// Chunked streaming renderer: one InstancedMesh per block id per chunk,
// only for exposed blocks. Rebuilds stay local via refreshBlocks().
import * as THREE from "three";
import { AIR, BLOCK_INFO, FLOWER } from "../core/blocks.js";
import { WORLD_RADIUS, CHUNK, RENDER_DIST, getBlock, colTops, dim, chunkOf } from "../core/store.js";
import { materialsFor } from "../core/textures.js";
import { FLOWER_GEOS, FLOWER_MAT, flowerVariantAt, flowerAngleAt } from "./flowers.js";
import { getSeed } from "../world/overworld.js";

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();
const chunkMeshes = new Map(); // "cx_cz" -> Map<id, InstancedMesh>
const matCache = new Map();
let sceneRef = null;

function getMats(id) {
  if (!matCache.has(id)) matCache.set(id, materialsFor(id));
  return matCache.get(id);
}

export function initRenderer(scene) {
  sceneRef = scene;
}

function isExposed(x, y, z) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, dy, dz] of dirs) {
    const n = getBlock(x + dx, y + dy, z + dz);
    if (n === AIR) return true;
    const info = BLOCK_INFO[n];
    if (!info || !info.opaque) return true;
  }
  return false;
}

export function disposeAll() {
  for (const meshes of chunkMeshes.values()) {
    for (const m of meshes.values()) { sceneRef.remove(m); m.dispose(); }
  }
  chunkMeshes.clear();
  chunkQueue.length = 0;
}

function disposeChunk(ck) {
  const meshes = chunkMeshes.get(ck);
  if (!meshes) return;
  for (const m of meshes.values()) { sceneRef.remove(m); m.dispose(); }
  chunkMeshes.delete(ck);
}

export function rebuildChunk(cx, cz) {
  const ck = cx + "_" + cz;
  disposeChunk(ck);
  const x0 = Math.max(cx * CHUNK, -WORLD_RADIUS);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const z0 = Math.max(cz * CHUNK, -WORLD_RADIUS);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const perId = new Map();
  const flowers = [];
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const top = colTops[dim][(x + 1024) * 2048 + (z + 1024)];
      if (top === 0 && getBlock(x, 0, z) === AIR) continue;
      for (let y = 0; y <= top; y++) {
        const id = getBlock(x, y, z);
        if (id === AIR || !BLOCK_INFO[id]) continue;
        if (id === FLOWER) { flowers.push([x, y, z]); continue; }
        if (!isExposed(x, y, z)) continue;
        let arr = perId.get(id);
        if (!arr) { arr = []; perId.set(id, arr); }
        arr.push([x, y, z]);
      }
    }
  }
  if (!perId.size && !flowers.length) return;
  const meshes = new Map();
  for (const [id, list] of perId) {
    const mesh = new THREE.InstancedMesh(boxGeo, getMats(id), list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, y, z] = list[i];
      dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    sceneRef.add(mesh);
    meshes.set(id, mesh);
  }
  if (flowers.length) {
    const seed = getSeed();
    const perVariant = FLOWER_GEOS.map(() => []);
    for (const [fx, fy, fz] of flowers) perVariant[flowerVariantAt(fx, fz, seed)].push([fx, fy, fz]);
    for (let v = 0; v < FLOWER_GEOS.length; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(FLOWER_GEOS[v], FLOWER_MAT, list.length);
      for (let i = 0; i < list.length; i++) {
        const [fx, fy, fz] = list[i];
        dummy.position.set(fx + 0.5, fy + 0.5, fz + 0.5);
        dummy.rotation.set(0, flowerAngleAt(fx, fz, seed), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      sceneRef.add(mesh);
      meshes.set("flower_" + v, mesh);
    }
  }
  chunkMeshes.set(ck, meshes);
}

const chunkQueue = [];

export function rebuildAll(px, pz, syncRadius = 3) {
  disposeAll();
  streamChunks(px, pz);
  // Build the neighborhood synchronously so the spawn area is solid on the
  // first frame; the rest streams in over following frames.
  const cx = chunkOf(px), cz = chunkOf(pz);
  const near = [];
  const far = [];
  for (const ck of chunkQueue) {
    const [wx, wz] = ck.split("_").map(Number);
    ((Math.abs(wx - cx) <= syncRadius && Math.abs(wz - cz) <= syncRadius) ? near : far).push(ck);
  }
  chunkQueue.length = 0;
  chunkQueue.push(...far);
  for (const ck of near) {
    const [wx, wz] = ck.split("_").map(Number);
    rebuildChunk(wx, wz);
  }
  lastStream.cx = cx;
  lastStream.cz = cz;
}

export function streamChunks(px, pz) {
  const cx = chunkOf(px), cz = chunkOf(pz);
  const keep = new Set();
  for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++)
    for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
      const wx = cx + dx, wz = cz + dz;
      if (wx * CHUNK > WORLD_RADIUS || wx * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      if (wz * CHUNK > WORLD_RADIUS || wz * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      keep.add(wx + "_" + wz);
    }
  for (const ck of [...chunkMeshes.keys()]) {
    if (!keep.has(ck)) disposeChunk(ck);
  }
  for (let i = chunkQueue.length - 1; i >= 0; i--) {
    if (!keep.has(chunkQueue[i]) || chunkMeshes.has(chunkQueue[i])) chunkQueue.splice(i, 1);
  }
  const queued = new Set(chunkQueue);
  const missing = [];
  for (const ck of keep) {
    if (chunkMeshes.has(ck) || queued.has(ck)) continue;
    const [wx, wz] = ck.split("_").map(Number);
    missing.push([ck, (wx - cx) ** 2 + (wz - cz) ** 2]);
  }
  missing.sort((a, b) => a[1] - b[1]);
  for (const [ck] of missing) chunkQueue.push(ck);
  lastStream.cx = cx;
  lastStream.cz = cz;
}

const lastStream = { cx: Infinity, cz: Infinity };

export function maybeStream(px, pz) {
  const cx = chunkOf(px), cz = chunkOf(pz);
  if (lastStream.cx === cx && lastStream.cz === cz) {
    if (chunkQueue.length) drainChunkQueue(false);
    return;
  }
  lastStream.cx = cx;
  lastStream.cz = cz;
  streamChunks(px, pz);
  drainChunkQueue(false);
}

const CHUNK_BUDGET_MS = 6;

export function drainChunkQueue(all) {
  if (!chunkQueue.length) return;
  const deadline = all ? Infinity : performance.now() + CHUNK_BUDGET_MS;
  while (chunkQueue.length && (all || performance.now() < deadline)) {
    const ck = chunkQueue.shift();
    if (chunkMeshes.has(ck)) continue;
    const [wx, wz] = ck.split("_").map(Number);
    rebuildChunk(wx, wz);
  }
}

export function hasPendingChunks() {
  return chunkQueue.length > 0;
}

function columnKeys(x, z) {
  const cx = chunkOf(x), cz = chunkOf(z);
  const out = [cx + "_" + cz];
  const rx = ((x % CHUNK) + CHUNK) % CHUNK;
  const rz = ((z % CHUNK) + CHUNK) % CHUNK;
  if (rx === 0) out.push(cx - 1 + "_" + cz);
  if (rx === CHUNK - 1) out.push(cx + 1 + "_" + cz);
  if (rz === 0) out.push(cx + "_" + (cz - 1));
  if (rz === CHUNK - 1) out.push(cx + "_" + (cz + 1));
  return out;
}

export function refreshBlocks(coords) {
  const keys = new Set();
  for (const [x, , z] of coords) {
    for (const ck of columnKeys(x, z)) keys.add(ck);
  }
  for (const ck of keys) {
    if (!chunkMeshes.has(ck) && !chunkQueue.includes(ck)) continue;
    if (chunkMeshes.has(ck)) {
      const [cx, cz] = ck.split("_").map(Number);
      rebuildChunk(cx, cz);
    }
  }
}

export function chunkCount() {
  return chunkMeshes.size;
}
