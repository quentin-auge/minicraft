// Three-free spot selection for the dynamic pool: which glowstone clusters
// and chain grid-crossings burn, and in what color. Split out of
// `poollights.js` (which owns the THREE lamp pool) so the headless harness
// can cover the selection rules with plain node.
import { CHUNK, RENDER_DIST, key, keyXYZ } from "../core/store.js";
import {
  GLOW_VARIANTS, glowstoneBlocks, glowstoneVariantKey, isPadGhostVariant,
  padGhostBaseVariant,
} from "../world/glowstone.js";
import { isNetherRingCell } from "../world/nether.js";

export const DIST = Math.ceil(RENDER_DIST * CHUNK * Math.SQRT2); // pool range
export const EXIT_FACTOR = 1.2; // spots leave past DIST * EXIT_FACTOR (hysteresis)
export const CLUSTER_R = 2; // clusters fit in a (2*R+1)^3 cube: 5x5x5
export const GAP = 3; // stones join the same group past a Chebyshev gap of GAP (dotted chains read as one group)
export const GRID = 10; // invisible grid planes cut space every GRID blocks on x, y and z
export const SPOT_BUDGET = 16; // lights shared by the eligible spots, nearest first
// Pad-corner ghosts burn through the pool in their base red/yellow, but only
// while the fog lets the mesh show them: the pool has no live fog import, so
// this mirrors the compiled-in overworld fog far (main.js readyFog.far), the
// same default padGhostOpacityAt fades against. A ghost lamp past the fog
// would float on invisible stone, so ghosts get a hard cap here — no exit
// hysteresis, inclusive so the lamp dies exactly where the mesh does
// (padGhostOpacityAt hits zero at fogFar). Normal stones keep the DIST enter / DIST*EXIT_FACTOR leave rule
// exactly as before.
export const GHOST_POOL_FAR = 160;

// Hysteresis memory: spots already lit stay eligible past DIST. Keyed by
// dimension, holding the block key of each lit spot's stone.
const spotSeen = new Map(); // dimName -> Set(spotId)

export function resetSpotMemory() {
  spotSeen.clear();
}

// A stone's pool color: pad-corner ghosts have no entry in GLOW_VARIANTS, so
// they resolve through their base red/yellow look first (else the read
// crashes) — and a spot counts as ghost-driven when its color stone is one.
function spotColor(name, id) {
  const raw = glowstoneVariantKey(name, id) ?? 0;
  const ghost = isPadGhostVariant(raw);
  return { color: GLOW_VARIANTS[ghost ? padGhostBaseVariant(raw) : raw].glow, ghost };
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
export function clusterSpots(name, camera) {
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
  // don't flicker as the player moves. Ghost-driven spots instead die at
  // min(DIST, GHOST_POOL_FAR) with no hysteresis, where the mesh fade takes
  // them. Past SPOT_BUDGET eligible spots only
  // the nearest burn — the rest stay on halo alone.
  const lim2 = DIST * DIST;
  const exit2 = lim2 * EXIT_FACTOR * EXIT_FACTOR;
  const ghostLim2 = Math.min(DIST, GHOST_POOL_FAR) ** 2;
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
        const sc = spotColor(name, id);
        if (sc.ghost ? d >= ghostLim2 : (d > lim2 && !(seen.has(id) && d <= exit2))) continue;
        spots.push({
          x: px[i], y: py[i] - 0.15, z: pz[i],
          color: sc.color,
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
    const sc = spotColor(name, bid);
    const id = "c" + minK;
    if (sc.ghost ? d2 >= ghostLim2 : (d2 > lim2 && !(seen.has(id) && d2 <= exit2))) continue;
    spots.push({
      x: cx, y: cy, z: cz,
      color: sc.color,
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
