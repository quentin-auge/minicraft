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
// Spot selection lives in `poolspots.js` (three-free, headless-covered).
import * as THREE from "three";
import { chunkOf, dim, key } from "../core/store.js";
import { clusterSpots, resetSpotMemory, DIST, EXIT_FACTOR, SPOT_BUDGET } from "./poolspots.js";
import { portalFrameLights } from "../world/portals.js";
import { netherRingLights } from "../world/nether.js";

const LAMP_INTENSITY = 150; // physical falloff (decay 2) needs a hotter lamp
const LAMP_DECAY = 2; // quadratic falloff, like the halo's own gradient
const REFRESH = 0.5; // assignment re-evaluates at most this often (seconds)
const FRAME_BUDGET = Infinity; // every validated portal and sited ring burns

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
  resetSpotMemory();
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
