// Selective dynamic pool: a few real PointLights where the baked halo is not
// enough — one per glowstone cluster that fits in a 5x5x5 cube (an isolated
// stone is a cluster of one), one per grid crossing on sprawling chains, and
// one at the middle of every validated Nether portal. Invisible grid planes
// cut space every GRID blocks on x, y and z: a chain stone on a plane burns,
// spaced at least GRID from its chain's other lamps so a chain lying in a
// plane reads as one lamp every GRID blocks instead of a solid bar. Past
// SPOT_BUDGET spots only the nearest burn. Spots carry the stone's block key,
// so a lamp never moves while its stone stands; eligibility has hysteresis
// (enter at range, leave past it) so boundary spots don't flicker. Snap
// only, no glide, no stick: a knocked-out light goes dark instead of moving.
import * as THREE from "three";
import { CHUNK, RENDER_DIST, chunkOf, dim, key, keyXYZ } from "../core/store.js";
import {
  GLOW_VARIANTS, glowstoneBlocks, glowstoneVariantKey,
} from "../world/glowstone.js";
import { portalFrameLights } from "../world/portals.js";
import { isNetherRingCell, netherRingLights } from "../world/nether.js";

const LAMP_INTENSITY = 150; // physical falloff (decay 2) needs a hotter lamp
const LAMP_DECAY = 2; // quadratic falloff, like the halo's own gradient
const REFRESH = 0.5; // assignment re-evaluates at most this often (seconds)
const DIST = Math.ceil(RENDER_DIST * CHUNK * Math.SQRT2); // pool range
const EXIT_FACTOR = 1.2; // spots leave past DIST * EXIT_FACTOR (hysteresis)
const CLUSTER_R = 2; // clusters fit in a (2*R+1)^3 cube: 5x5x5
const GAP = 3; // stones join the same group past a Chebyshev gap of GAP (dotted chains read as one group)
const GRID = 10; // invisible grid planes cut space every GRID blocks on x, y, z
const SPOT_BUDGET = 16; // lights shared by the eligible spots, nearest first
const FRAME_BUDGET = Infinity; // every validated portal and sited ring burns

// Hysteresis memory: spots already lit stay eligible past DIST. Keyed by
// dimension, holding the block key of each lit spot's stone.
const spotSeen = new Map(); // dimName -> Set(spotId)

const POOL_SPECS = [
  { key: "spot", max: SPOT_BUDGET, positions: (name, camera) => clusterSpots(name, camera) },
  {
    key: "frame", max: FRAME_BUDGET,
    positions: (name) => (name === "nether"
      ? [...portalFrameLights(), ...netherRingLights()].map((c) => ({
        ...c,
        id: "f" + key(Math.round(c.x - 0.5), Math.round(c.y - 0.5), Math.round(c.z - 0.5)),
      }))
      : []),
  },
];

let sceneRef = null;
// Per-spec runtime state: live spots, pooled slots, sync cadence.
const pools = new Map(); // key -> { spec, spots, lights, t, cx, cz }

function stateFor(spec) {
  let st = pools.get(spec.key);
  if (!st) {
    st = { spec, spots: [], lights: [], t: 0, cx: Infinity, cz: Infinity };
    pools.set(spec.key, st);
  }
  return st;
}

export function initPoolLights(scene) {
  sceneRef = scene;
}

// Block change: force the next sync now, so placement and blasts re-slot
// without waiting out the cadence. Spots recompute every sync anyway (cheap
// enough to also cover streamed generation and window validation).
export function notePoolEdit() {
  for (const st of pools.values()) {
    st.t = 0;
    st.cx = st.cz = Infinity;
  }
}

// Cluster lamps plus grid crossings: connected stones (Chebyshev gap ≤ GAP,
// transitively, so dotted lines read as one group) burn one lamp when the
// whole group fits in a 5x5x5 cube — a lone stone is a cluster of one, so
// isolated glowstones need no special case. The lamp floats at the centroid
// (colored by the centroid-nearest stone) and carries a stable cluster id,
// so it never moves while the group's smallest stone stands. Sprawling groups
// are chains: a stone on an
// invisible grid plane (a block coordinate multiple of GRID on x, y or z)
// burns, spaced at least GRID (Chebyshev) from its chain's other lamps, so a
// chain lying in a plane lights up every GRID blocks instead of all at once.
// Grid lamps sit on their stone and carry its block key.
// Eligibility has hysteresis: a new spot enters at DIST, a lit one only
// leaves past DIST * EXIT_FACTOR. Ring stones read as cluster members here
// but never reach this code: the caller filters them through
// isNetherRingCell first.
function clusterSpots(name, camera) {
  const set = glowstoneBlocks(name);
  if (!set || !set.size) return [];
  const px = [], py = [], pz = [];
  for (const k of set) {
    const [x, y, z] = keyXYZ(k);
    // Ring stones are portal structures with their own centered lamp.
    if (name === "nether" && isNetherRingCell(x, y, z)) continue;
    px.push(x + 0.5); py.push(y + 0.5); pz.push(z + 0.5);
  }
  const n = px.length;
  if (!n) return [];
  // Union-find through a grid: neighbors join within Chebyshev distance GAP.
  // Cell size 4 keeps every neighbor within the 27 surrounding cells.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const CELL = 4;
  const grid = new Map();
  // Gap-tolerant adjacency: stones join within Chebyshev distance GAP, so
  // dotted lines read as one group. CELL = 4 with the ±1 ring covers GAP 3:
  // two block centers within 3 always land at most one cell apart.
  const near = (i, j) =>
    Math.abs(px[i] - px[j]) <= GAP &&
    Math.abs(py[i] - py[j]) <= GAP &&
    Math.abs(pz[i] - pz[j]) <= GAP;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(px[i] / CELL), cy = Math.floor(py[i] / CELL), cz = Math.floor(pz[i] / CELL);
    for (let ax = cx - 1; ax <= cx + 1; ax++) {
      for (let ay = cy - 1; ay <= cy + 1; ay++) {
        for (let az = cz - 1; az <= cz + 1; az++) {
          const arr = grid.get(ax + "," + ay + "," + az);
          if (!arr) continue;
          for (const j of arr) {
            if (!near(i, j)) continue;
            const a = find(i), b = find(j);
            if (a !== b) parent[a] = b;
          }
        }
      }
    }
    const gk = cx + "," + cy + "," + cz;
    let arr = grid.get(gk);
    if (!arr) { arr = []; grid.set(gk, arr); }
    arr.push(i);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(i);
  }
  // Eligible spots: at least one stone in range. A new spot enters at DIST;
  // an already-lit one persists to DIST * EXIT_FACTOR, so boundary spots
  // don't flicker as the player moves. Past SPOT_BUDGET eligible spots only
  // the nearest burn — the rest stay on halo alone.
  const lim2 = DIST * DIST;
  const exit2 = lim2 * EXIT_FACTOR * EXIT_FACTOR;
  let seen = spotSeen.get(name);
  if (!seen) { seen = new Set(); spotSeen.set(name, seen); }
  const spots = [];
  for (const g of groups.values()) {
    let d2 = Infinity;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let sx = 0, sy = 0, sz = 0, minK = null;
    for (const i of g) {
      const vx = Math.round(px[i] - 0.5), vy = Math.round(py[i] - 0.5), vz = Math.round(pz[i] - 0.5);
      const k = key(vx, vy, vz);
      if (minK === null || k < minK) minK = k;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
      sx += px[i]; sy += py[i]; sz += pz[i];
      const dx = px[i] - camera.position.x, dy = py[i] - camera.position.y, dz = pz[i] - camera.position.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d2) d2 = d;
    }
    // Sprawling past the cluster cube: a chain — lamps only on grid planes.
    if (maxX - minX > 2 * CLUSTER_R || maxY - minY > 2 * CLUSTER_R || maxZ - minZ > 2 * CLUSTER_R) {
      // Candidates: stones on an invisible grid plane, lowest coords first
      // (deterministic). Kept lamps stay GRID apart (Chebyshev) so a chain
      // lying in a plane lights up every GRID blocks instead of all at once.
      const onGrid = (v) => ((v % GRID) + GRID) % GRID === 0;
      const cand = [];
      for (const i of g) {
        const vx = Math.round(px[i] - 0.5), vy = Math.round(py[i] - 0.5), vz = Math.round(pz[i] - 0.5);
        if (!onGrid(vx) && !onGrid(vy) && !onGrid(vz)) continue;
        cand.push(i);
      }
      const bxyz = (i) => [Math.round(px[i] - 0.5), Math.round(py[i] - 0.5), Math.round(pz[i] - 0.5)];
      cand.sort((a, b) => {
        const [ax, ay, az] = bxyz(a), [bx, by, bz] = bxyz(b);
        return ax - bx || ay - by || az - bz;
      });
      const keptIdx = [];
      for (const i of cand) {
        let clash = false;
        for (const j of keptIdx) {
          if (Math.abs(px[i] - px[j]) < GRID && Math.abs(py[i] - py[j]) < GRID && Math.abs(pz[i] - pz[j]) < GRID) {
            clash = true; break;
          }
        }
        if (!clash) keptIdx.push(i);
      }
      for (const i of keptIdx) {
        const [vx, vy, vz] = bxyz(i);
        const id = key(vx, vy, vz);
        const dx = px[i] - camera.position.x, dy = py[i] - camera.position.y, dz = pz[i] - camera.position.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > lim2 && !(seen.has(id) && d <= exit2)) continue;
        spots.push({
          x: px[i], y: py[i] - 0.15, z: pz[i],
          color: GLOW_VARIANTS[glowstoneVariantKey(name, id) ?? 0].glow,
          id,
        });
      }
      continue;
    }
    // Lamp at the centroid (ties: lowest coords).
    const cx = sx / g.length, cy = sy / g.length, cz = sz / g.length;
    let best = g[0], bestD = Infinity;
    for (const i of g) {
      const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
      const d = dx * dx + dy * dy + dz * dz;
      const vx = Math.round(px[i] - 0.5), vy = Math.round(py[i] - 0.5), vz = Math.round(pz[i] - 0.5);
      const bv = [Math.round(px[best] - 0.5), Math.round(py[best] - 0.5), Math.round(pz[best] - 0.5)];
      if (d < bestD - 1e-9 ||
          (Math.abs(d - bestD) <= 1e-9 && (vx < bv[0] || (vx === bv[0] && (vy < bv[1] || (vy === bv[1] && vz < bv[2])))))) {
        bestD = d; best = i;
      }
    }
    // Color from the centroid-nearest stone; id from the smallest block key
    // (the lamp floats at the centroid, on no stone in particular).
    const bid = key(Math.round(px[best] - 0.5), Math.round(py[best] - 0.5), Math.round(pz[best] - 0.5));
    const id = "c" + minK;
    if (d2 > lim2 && !(seen.has(id) && d2 <= exit2)) continue;
    spots.push({
      x: cx, y: cy, z: cz,
      color: GLOW_VARIANTS[glowstoneVariantKey(name, bid) ?? 0].glow,
      id,
    });
  }
  // Crowd rule: past SPOT_BUDGET eligible spots, the nearest burn. Ranked by
  // lamp position (what the pool assigns), ties broken by id so the winners
  // are deterministic. Memory keeps exactly the lit spots, so hysteresis only
  // ever protects a lamp that is actually burning.
  const cam = camera.position;
  spots.forEach((s) => {
    const dx = s.x - cam.x, dy = s.y - cam.y, dz = s.z - cam.z;
    s.d2 = dx * dx + dy * dy + dz * dz;
  });
  spots.sort((a, b) => (a.d2 - b.d2) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept = spots.slice(0, SPOT_BUDGET);
  spotSeen.set(name, new Set(kept.map((s) => s.id)));
  return kept;
}

function makePooledLight() {
  const light = new THREE.PointLight(0xffffff, LAMP_INTENSITY, 0, LAMP_DECAY);
  if (sceneRef) sceneRef.add(light);
  return { cur: null, light };
}

// Point a light at a spot: always snap (position and color land at once).
// Spots are stable targets — a light is born on its spot and dies with it —
// so nothing ever travels: lights only pop in and out at assignment range.
function aimLight(L, x, y, z, hex) {
  L.light.position.set(x, y, z);
  L.light.color.setHex(hex);
}

export function tickPoolLights(dt, camera) {
  for (const spec of POOL_SPECS) syncSpec(stateFor(spec), spec, dt, camera);
}

// A fixed pool of PointLights is assigned to the spots nearest the player.
// The assignment re-evaluates at most every REFRESH seconds and only when
// the player crosses a chunk; spots carry stable block ids, so a light keeps
// its stone while that stone stays wanted — camera motion alone never moves
// a lamp. Knocked-out lights go dark instead of stealing a visible pool, and
// newcomers wait for a genuinely free slot. Everything costs nothing in
// between, and a block change forces the next sync now (see notePoolEdit).
function syncSpec(st, spec, dt, camera) {
  if (st.t > 0) st.t -= dt;
  const pcx = chunkOf(camera.position.x), pcz = chunkOf(camera.position.z);
  if (st.t > 0 || (pcx === st.cx && pcz === st.cz)) return;
  st.t = REFRESH;
  st.cx = pcx;
  st.cz = pcz;
  st.spots = spec.positions(dim, camera);
  if (!st.spots.length) {
    for (const L of st.lights) {
      if (!L) continue;
      L.light.visible = false;
      L.cur = null;
    }
    return;
  }
  const cam = camera.position;
  // Bounded nearest-N in one pass, up to the hysteresis exit radius so
  // spots kept by clusterSpots past DIST still receive their lamps. Order
  // among equidistant spots may differ from a full sort; light assignment
  // there is invisible.
  const lim2 = DIST * DIST * EXIT_FACTOR * EXIT_FACTOR;
  const ranked = [];
  for (let i = 0; i < st.spots.length; i++) {
    const c = st.spots[i];
    const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > lim2) continue;
    let k = ranked.length;
    while (k > 0 && ranked[k - 1][0] > d2) k--;
    if (k < spec.max) {
      ranked.splice(k, 0, [d2, i]);
      if (ranked.length > spec.max) ranked.pop();
    }
  }
  const byId = new Map();
  for (let i = 0; i < st.spots.length; i++) byId.set(st.spots[i].id, i);
  const active = new Set();
  // First keep every light that already sits on a still-wanted stone.
  for (const L of st.lights) {
    if (!L || L.cur == null || !byId.has(L.cur)) continue;
    let wanted = false;
    for (let j = 0; j < ranked.length; j++) {
      if (st.spots[ranked[j][1]].id === L.cur) { wanted = true; break; }
    }
    if (!wanted) continue;
    active.add(L.cur);
    const c = st.spots[byId.get(L.cur)];
    aimLight(L, c.x, c.y, c.z, c.color);
    L.light.visible = true;
  }
  // Then hand the remaining lights to the nearest unlit spots.
  for (let j = 0; j < ranked.length; j++) {
    const id = st.spots[ranked[j][1]].id;
    if (active.has(id)) continue;
    let slot = -1;
    for (let i = 0; i < spec.max; i++) {
      const L = st.lights[i];
      if (!L || L.cur == null || !active.has(L.cur)) { slot = i; break; }
    }
    if (slot < 0) break;
    const L = st.lights[slot] || (st.lights[slot] = makePooledLight());
    L.cur = id;
    const nc = st.spots[ranked[j][1]];
    aimLight(L, nc.x, nc.y, nc.z, nc.color);
    L.light.visible = true;
    active.add(id);
  }
  for (const L of st.lights) {
    if (L && (L.cur == null || !active.has(L.cur))) {
      L.light.visible = false;
      L.cur = null;
    }
  }
}

// New worlds never inherit another world's spots or assignments; the light
// pool itself persists (the scene outlives worlds).
export function resetPoolLightMemory() {
  spotSeen.clear();
  for (const st of pools.values()) {
    st.spots = [];
    st.t = 0;
    st.cx = st.cz = Infinity;
    for (const L of st.lights) {
      if (!L) continue;
      L.cur = null;
      L.light.visible = false;
    }
  }
}
