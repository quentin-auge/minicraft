// Pooled block lights: emissive blocks (glowstone first) cast steady pools
// of colored light onto surrounding terrain. New emitters register a spec in
// LIGHT_EMITTERS — shared properties live in EMITTER_DEFAULTS, entries
// override only what differs — and the framework dispatches through it:
// bucketing, clustering, pooling, and assignment never switch on block names.
// Blocks opt in with the `light` capability flag in BLOCK_INFO (stable key,
// never an array index), and each spec supplies its live positions plus a
// per-block `colorOf`. Differing behavior is spec data or an optional function
// prop, never a framework fork.
import * as THREE from "three";
import { CHUNK, RENDER_DIST, chunkOf, dim, keyXYZ } from "../core/store.js";
import {
  GLOW_VARIANTS, glowstoneBlocks, glowstoneVariantKey,
} from "../world/glowstone.js";

const EMITTER_DEFAULTS = {
  radius: 0, // PointLight distance (0 = no cutoff; decay alone shapes the pool)
  intensity: 150, // physical falloff (decay 2) needs a hotter lamp than linear
  decay: 2, // quadratic falloff: pools fade smoothly and overlap into mixes
  max: 16, // pooled lights per emitter (nearest blocks win)
  refresh: 0.5, // assignment re-evaluates at most this often (seconds)
};

export const LIGHT_EMITTERS = [
  {
    ...EMITTER_DEFAULTS,
    key: "glowstone",
    dist: Math.ceil(RENDER_DIST * CHUNK * Math.SQRT2),
    blocks: (name) => glowstoneBlocks(name), // Set of voxel keys
    colorOf: (name, k) => GLOW_VARIANTS[glowstoneVariantKey(name, k) ?? 0].glow,
  },
];

let sceneRef = null;
// Per-emitter runtime state, keyed by spec key.
const emitters = new Map(); // key -> { spec, clusters, lights, t, cx, cz }

function stateFor(spec) {
  let st = emitters.get(spec.key);
  if (!st) {
    st = { spec, clusters: [], lights: [], t: 0, cx: Infinity, cz: Infinity };
    emitters.set(spec.key, st);
  }
  return st;
}

export function initBlockLights(scene) {
  sceneRef = scene;
}

// One entry per block (position + own color): adjacent stones of different
// colors keep their own light instead of collapsing to a centroid, so two
// stones one block apart radiate from each place with a natural additive
// overlap between them. The pool cap (`max` nearest) bounds the cost, not
// the entries. Recomputed only when blocks change; the assignment below
// re-evaluates on its own cadence in between.
function recomputeEmitter(st) {
  const { spec } = st;
  st.clusters = [];
  st.t = 0;
  st.cx = st.cz = Infinity;
  for (const L of st.lights) {
    if (!L) continue;
    L.cur = -1;
    L.tcolor = null;
    L.light.visible = false;
  }
  const set = spec.blocks(dim);
  if (!set || !set.size) return;
  for (const k of set) {
    const [x, y, z] = keyXYZ(k);
    st.clusters.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, color: spec.colorOf(dim, k) });
  }
}

function makePooledLight(spec) {
  const light = new THREE.PointLight(0xffffff, spec.intensity, spec.radius, spec.decay);
  if (sceneRef) sceneRef.add(light);
  return { cur: -1, light, tcolor: null, tx: 0, ty: 0, tz: 0 };
}

// Point a light at a cluster: fresh assignments snap (no glide from the pool
// origin), live ones only retarget — the per-frame glide below carries them.
function aimLight(L, x, y, z, hex) {
  if (!L.tcolor) {
    L.light.position.set(x, y, z);
    L.light.color.setHex(hex);
    L.tcolor = new THREE.Color(hex);
  }
  L.tx = x; L.ty = y; L.tz = z;
  L.tcolor.set(hex);
}

// A fixed pool of PointLights is assigned to the clusters nearest the
// player. The assignment re-evaluates at most every `refresh` seconds and
// only when the player crosses a chunk, and a light keeps its current cluster
// while that cluster stays among the nearest lit ones — so the glow never
// jumps between neighboring clusters or flickers while walking toward one,
// and costs nothing in between. Assignment only retargets; the per-frame
// glide in tickBlockLights carries the motion, so walking reads continuous.
// Kept lights snap to the live centroid on reassignment only when freshly
// slotted; a block change drops all assignments so the next sync re-slots by
// distance — a light can never sit frozen at a stale spot.
function syncEmitter(st, dt, camera) {
  const { spec } = st;
  if (st.t > 0) st.t -= dt;
  const pcx = chunkOf(camera.position.x), pcz = chunkOf(camera.position.z);
  if (st.t > 0 || (pcx === st.cx && pcz === st.cz)) return;
  st.t = spec.refresh;
  st.cx = pcx;
  st.cz = pcz;
  if (!st.clusters.length) {
    for (const L of st.lights) {
      if (!L) continue;
      L.light.visible = false;
      L.cur = -1;
      L.tcolor = null;
    }
    return;
  }
  const cam = camera.position;
  const ranked = [];
  for (let i = 0; i < st.clusters.length; i++) {
    const c = st.clusters[i];
    const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= spec.dist * spec.dist) ranked.push([d2, i]);
  }
  ranked.sort((a, b) => a[0] - b[0]);
  const want = Math.min(spec.max, ranked.length);
  const active = new Uint8Array(st.clusters.length);
  // First keep every light that already sits on a still-ranked cluster, so
  // the pool never hops between clusters while the player walks around —
  // retarget only, the glide carries the motion.
  for (let i = 0; i < st.lights.length; i++) {
    const L = st.lights[i];
    if (!L || L.cur < 0 || L.cur >= st.clusters.length) continue;
    for (let j = 0; j < want; j++) {
      if (ranked[j][1] === L.cur) {
        active[L.cur] = 1;
        const c = st.clusters[L.cur];
        aimLight(L, c.x, c.y - 0.15, c.z, c.color);
        L.light.visible = true;
        break;
      }
    }
  }
  // Then hand the remaining lights to the nearest unlit clusters.
  for (let j = 0; j < want; j++) {
    const ci = ranked[j][1];
    if (active[ci]) continue;
    let slot = -1;
    for (let i = 0; i < spec.max; i++) {
      const L = st.lights[i];
      if (!L || L.cur < 0 || (L.cur < st.clusters.length && !active[L.cur])) { slot = i; break; }
    }
    if (slot < 0) break;
    const L = st.lights[slot] || (st.lights[slot] = makePooledLight(spec));
    L.cur = ci;
    const nc = st.clusters[ci];
    L.light.intensity = spec.intensity;
    L.light.distance = spec.radius;
    L.light.decay = spec.decay;
    aimLight(L, nc.x, nc.y - 0.15, nc.z, nc.color);
    L.light.visible = true;
    active[ci] = 1;
  }
  for (let i = 0; i < st.lights.length; i++) {
    const L = st.lights[i];
    if (L && (L.cur < 0 || L.cur >= st.clusters.length || !active[L.cur])) {
      L.light.visible = false;
      L.cur = -1;
      L.tcolor = null;
    }
  }
}

// Glide rate: lights ease toward their assigned cluster target this fast;
// the slot decisions above only retarget, motion stays continuous.
const GLIDE = 8;

export function tickBlockLights(dt, camera) {
  for (const spec of LIGHT_EMITTERS) syncEmitter(stateFor(spec), dt, camera);
  const k = 1 - Math.exp(-GLIDE * dt);
  for (const st of emitters.values()) {
    for (const L of st.lights) {
      if (!L || !L.light.visible || !L.tcolor) continue;
      const p = L.light.position;
      p.x += (L.tx - p.x) * k;
      p.y += (L.ty - p.y) * k;
      p.z += (L.tz - p.z) * k;
      L.light.color.lerp(L.tcolor, k);
    }
  }
}

// Block change: drop every assignment and recluster now, so the next sync
// re-slots by distance instead of holding stale spots.
export function noteBlockLightEdit() {
  for (const spec of LIGHT_EMITTERS) recomputeEmitter(stateFor(spec));
}

export function rebuildBlockLightIndexes() {
  noteBlockLightEdit();
}

// New worlds never inherit another world's clusters or assignments; the
// light pool itself persists (the scene outlives worlds).
export function resetBlockLightMemory() {
  for (const spec of LIGHT_EMITTERS) {
    const st = stateFor(spec);
    st.clusters = [];
    st.t = 0;
    st.cx = st.cz = Infinity;
    for (const L of st.lights) {
      if (!L) continue;
      L.cur = -1;
      L.light.visible = false;
    }
  }
}
