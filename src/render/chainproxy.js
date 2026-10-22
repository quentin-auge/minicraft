// Optimistic overlay for chain edits: voxel writes (`setBlock`) are already
// synchronous, but the real mesh may lag behind the budgeted remesh drain,
// so fast strokes show holes that fill in late. The proxy draws each touched
// cell as a transient instance in the block's own shared material the same
// tick, then drops it as soon as its chunk rebuilds (version-checked, so the
// proxy never overlaps the real mesh and never z-fights) or after a sim-time
// TTL backstop sized to outlast a backlogged remesh drain. Cubes and glowstone (per-variant material)
// only — liquids and flowers keep the normal path.
import * as THREE from "three";
import { AIR, FLOWER, GLOWSTONE, isLiquid } from "../core/blocks.js";
import { chunkOf, getBlock } from "../core/store.js";
import { glowstoneMats, materialsFor } from "../core/textures.js";
import { glowVariantAt } from "../world/glowstone.js";
import { chunkVersion } from "./mesher.js";

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const CAP = 512; // instances per transient mesh; oldest cells drop past it
const TTL = 8.0; // sim seconds; version expiry normally fires far earlier.
// Long enough to outlast a backlogged remesh drain under fast held strokes
// (2 ms budget vs halo fan-out per cell), short enough to never haunt: every
// real build path bumps the chunk version, so version-cull stays the normal
// expiry and TTL only sweeps orphaned cells in never-built chunks.

let sceneRef = null;
const cells = new Map(); // "x,y,z" -> { x, y, z, id, v, ck, ver, exp }
const meshes = new Map(); // handle -> { mesh }
let order = []; // insertion order for oldest-drop
let dirty = false;

export function initChainProxy(scene) {
  sceneRef = scene;
}

function handleFor(id, v) {
  return id === GLOWSTONE ? "g" + v : "b" + id;
}
function matsFor(id, v) {
  return id === GLOWSTONE ? glowstoneMats(v) : materialsFor(id);
}

// Record this tick's touched cells (ids read back from live voxels: broken
// cells drop their transient cube at once, re-touched cells refresh their
// expiry). Called for holds and taps alike; tap proxies live a single frame
// and stay invisible.
export function proxyNote(list, now) {
  let added = false;
  for (const [x, y, z] of list) {
    const id = getBlock(x, y, z);
    const k = x + "," + y + "," + z;
    const prev = cells.get(k);
    if (id === AIR || id === FLOWER || isLiquid(id)) {
      // Broken mid-hold: drop the transient cube at once instead of waiting
      // for the chunk rebuild to cull it.
      if (prev) { cells.delete(k); dirty = true; }
      continue;
    }
    const v = id === GLOWSTONE ? glowVariantAt(x, y, z) : 0;
    const ck = chunkOf(x) + "_" + chunkOf(z);
    if (prev) {
      // Re-touched mid-hold (overlapping pads, repeated steps): refresh the
      // expiry so the cell never blinks out while the stroke is still live.
      prev.exp = now + TTL;
      prev.ver = chunkVersion(ck);
      continue;
    }
    cells.set(k, { x, y, z, id, v, ck, ver: chunkVersion(ck), exp: now + TTL });
    order.push(k);
    added = true;
  }
  // Bound memory under a stalled drain: drop the oldest first.
  while (order.length > CAP * 4) cells.delete(order.shift());
  if (added) dirty = true;
}

// Drop every cell whose chunk has rebuilt (or been evicted) since it was
// noted, plus TTL backstop. Runs every frame, paused or not — the drain
// rebuilds behind pause too, so the proxy must follow it there.
export function proxyCull(now) {
  if (cells.size) {
    for (const [k, c] of cells) {
      if (c.exp <= now || chunkVersion(c.ck) !== c.ver) {
        cells.delete(k);
        dirty = true;
      }
    }
    if (dirty) order = order.filter((k) => cells.has(k));
  }
  if (dirty) rebuild();
}

function rebuild() {
  dirty = false;
  const groups = new Map(); // handle -> { id, v, list }
  for (const c of cells.values()) {
    const h = handleFor(c.id, c.v);
    let g = groups.get(h);
    if (!g) { g = { id: c.id, v: c.v, list: [] }; groups.set(h, g); }
    if (g.list.length < CAP) g.list.push(c);
  }
  for (const [h, rec] of meshes) {
    if (groups.has(h)) continue;
    sceneRef.remove(rec.mesh);
    rec.mesh.dispose(); // instance buffers only; shared geo/materials survive
    meshes.delete(h);
  }
  for (const [h, g] of groups) {
    let rec = meshes.get(h);
    if (!rec) {
      const mesh = new THREE.InstancedMesh(boxGeo, matsFor(g.id, g.v), CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // transient positions; skip bounds tracking
      sceneRef.add(mesh);
      rec = { mesh };
      meshes.set(h, rec);
    }
    // Translation-only instances: column-major write, like the mesher.
    const a = rec.mesh.instanceMatrix.array;
    const n = g.list.length;
    for (let i = 0; i < n; i++) {
      const c = g.list[i];
      const o = i * 16;
      a[o] = 1; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 1; a[o + 11] = 0;
      a[o + 12] = c.x + 0.5; a[o + 13] = c.y + 0.5; a[o + 14] = c.z + 0.5; a[o + 15] = 1;
    }
    rec.mesh.count = n;
    rec.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Worlds never inherit another world's overlay: called on every full
// rebuild and every dimension travel (versions reset with the mesher there).
export function proxyClear() {
  cells.clear();
  order = [];
  if (sceneRef) for (const rec of meshes.values()) {
    sceneRef.remove(rec.mesh);
    rec.mesh.dispose();
  }
  meshes.clear();
  dirty = false;
}
