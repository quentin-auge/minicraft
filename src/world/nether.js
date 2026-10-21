// Nether generation: a great lava sea with big rugged fbm islands under a
// dark sky (master's terrain recipe, capped for fan cooperation), two
// immense hollow volcanoes (one per map corner, fully closed) with a central
// lava column on a flat summit, constant-section falls running down the
// cone and draping over island relief into the sea, and glowstone portal
// tunnels per volcano (10 high fan mouths on the flanks plus 3 ground
// bridges — each landing on a shelf islet in front of the mouth, or right
// on flat island relief).
// Three-free so the headless world-gen harness can run it.
//
// The world is generated one render chunk at a time, on demand: setup derives
// every global feature descriptor (volcano geometry, cascade mask, islets,
// tunnel mouths, the return frame) and a chunk pass materializes only the
// columns it owns. This keeps portal entry instant while the mesher streams
// the rest of the Nether behind its expanding fog.
//
// Each tunnel is one analytic partition: a carved 8-wide walk bore wrapped in
// a rock shell (2 thick while buried, 1 thick where exposed), closed by a
// glowstone ring sized on the carved mouth columns and an open view corridor
// (10 wide to the exit, sill sight row included). Every chunk pass runs three
// phases — clear bores and corridors, seal shells, collars and doorsteps,
// place frames last — so walkways stay open and rings stay exposed.
//
// The volcano shell follows master's hollow result without the fill-then-
// hollow cost: every cone column is filled down to the lowest surface within
// a 2-cell neighbourhood, so risers, lava bands and the world-boundary face
// all stay sealed with at least one rock layer behind the lavas.
import {
  AIR, GLOWSTONE, LAVA, NETHERRACK, OBSIDIAN, SOULSAND,
} from "../core/blocks.js";
import { fbm, hash2 } from "../core/noise.js";
import {
  CHUNK, WORLD_RADIUS, fillColumn, getBlock, isSolid, key, protectCell,
  registerChunkSource, resetWorld, setBlock, setDimension,
} from "../core/store.js";
import { GLOW_VARIANT_COUNT, noteGlowstonePlaceShared } from "./glowstone.js";

export const NETHER_FIRE_LEVEL = 12;
export const NETHER_RETURN_BASE_Y = 30;
export const NETHER_RETURN_Z = 0;
export const NETHER_SPAWN = {
  x: 0, y: NETHER_RETURN_BASE_Y - 1, z: 1, yaw: Math.PI,
};

const NETHER_RIVER_COUNT = 4;
// Shell depth: master keeps two layers around air plus one rock against every
// lava cell. Filling three cells below the local minimum surface gives both
// guarantees without materializing the solid cone.
const SHELL_DEPTH = 3;
// Lava curtain: constant 2-deep section everywhere (one cell anchored in
// the rock, one above); the band half-width starts at CASCADE_BAND_HALF and
// widens slightly downhill via cascadeHalfAt (+1 per 45 blocks of run).
const CASCADE_DEPTH = 2;
const CASCADE_BAND_HALF = 2;
const CASCADE_WIDEN_EVERY = 45;
function cascadeHalfAt(v, d) {
  return CASCADE_BAND_HALF + Math.max(0, Math.floor((d - v.craterR) / CASCADE_WIDEN_EVERY));
}
// Flat summit lip around the crater, at exact rim height.
const SUMMIT_LIP = 3;
// View corridor: open cells past the flank exit, and the scan caps. Tier 1
// seeks a fully open row (open sky over the whole 8-wide footprint) within
// EXIT_CAP; tier 2 accepts a shallow notch (overburden at most EXIT_NOTCH
// over the same footprint) within EXIT_FAR — the corridor construction
// clears both identically, the canyon just runs longer through a hill.
const CORRIDOR_MARGIN = 4;
const EXIT_CAP = 60;
const EXIT_FAR = 120;
const EXIT_NOTCH = 10;
// Approach apron: past the exit the ring-height band keeps clearing until
// open sky holds for APRON_OPEN consecutive columns (capped APRON_CAP past
// the exit), so no rock hill can stand in front of a frame.
const APRON_OPEN = 6;
const APRON_CAP = 40;
const VOLCANO_COUNT = 2;
// 13 tubes per volcano: 10 high fan mouths on the flanks plus 3 ground
// bridges, one per arc sector — each landing on a shelf islet grown jointly
// under the tip, or right on flat island relief up to 10 above the sea.
const FAN_TUNNELS = 10;
const GROUND_BRIDGES = 3;
// Both lava courses sit symmetrically around the platform-facing axis; the
// mouth radials below keep lateral clearance from every band.
const CASCADE_SPLIT = 0.22;
const CASCADE_JITTER = 0.06;
const MOUTH_ARC = 1.85;
const MOUTH_SEP = 0.12;
// Organic mouth layout: arbitrary headings over the facing hemisphere
// (±1.85 rad around the platform axis), minimum angular separation so mouths
// spread instead of clustering, 10 distinct seeded heights above ground
// level (the fan never sits at the ground). Deterministic
// per world seed — random-looking, reproducible.
const S = WORLD_RADIUS;
const SIZE = 2 * S + 1;
const CHUNK_RADIUS = Math.ceil(S / CHUNK);

let netherSeed = 1;
let netherRiverPaths = [];
let volcanoes = [];
let tunnels = [];
// Flat landing shelves under every ground bridge (analytic, opened on the
// lava sea only). Big fbm islands need no registry — topAt reads the
// heightfield directly. Sited before the high fans.
let islets = [];
let returnFrameKeys = [];
let returnPad = null;
let netherReady = false;
const generatedChunks = new Set();
let glowDirty = false;
// Every frame's glowstone cells: shells never fill them, and siting never
// lets a new tube touch them.
let ringCells = new Set();

// Lazy surface caches: full nether generation touches each column once for
// terrain and again for shells, cascades and tunnels, and every chunk pass
// queries its 5x5 neighbourhood.
const landCache = new Float32Array(SIZE * SIZE);
const topCache = new Float32Array(SIZE * SIZE);
// River carve result per column: t = d / w of the segment that cuts deepest
// (master's nearest-river rule), or -1. Rasterized once at setup.
const riverT = new Float32Array(SIZE * SIZE);
const riverScore = new Float32Array(SIZE * SIZE);
// Lava-band ban mask: 1 where a cascade band runs (plus 2 cells of margin),
// rasterized once per setup. Siting vetoes read it O(1) and only pay the
// exact per-column span check where it is set.
const cascadeMask = new Uint8Array(SIZE * SIZE);

function idx(x, z) {
  return (z + S) * SIZE + (x + S);
}
function inWorld(x, z) {
  return x >= -S && x <= S && z >= -S && z <= S;
}

export function netherVolcanoes() {
  return volcanoes;
}

export function netherPortalFrameKeys() {
  return returnFrameKeys.slice();
}

export function findNetherSpawn() {
  // Direct boot can query the spawn before the mesher asks for its chunk.
  // Return the highest solid support at the spawn column so the player never
  // starts in empty air over the void.
  const x = Math.floor(NETHER_SPAWN.x + 0.5);
  const z = Math.floor(NETHER_SPAWN.z + 0.5);
  for (let y = NETHER_SPAWN.y + 2; y >= 0; y--) {
    if (isSolid(x, y, z)) return { ...NETHER_SPAWN, y };
  }
  return { ...NETHER_SPAWN };
}

// The streamed world was reset: drop every derived descriptor and cache. The
// chunk source stays registered but is inert until the next setup.
export function resetNetherDimension() {
  setDimension("nether");
  resetWorld("nether");
  netherSeed = 1;
  netherRiverPaths = [];
  volcanoes = [];
  tunnels = [];
  islets = [];
  returnFrameKeys = [];
  returnPad = null;
  ringCells = new Set();
  netherReady = false;
  generatedChunks.clear();
  glowDirty = false;
  landCache.fill(NaN);
  topCache.fill(NaN);
  riverT.fill(-1);
  riverScore.fill(Infinity);
  cascadeMask.fill(0);
}

// True when streamed generation placed glowstone since the last call: the
// block-light index must be rebuilt, since it is not retriggered by meshing.
export function takeNetherGlowDirty() {
  const dirty = glowDirty;
  glowDirty = false;
  return dirty;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// Master's great lava lake: the floor sits under the fire line almost
// everywhere, and only the noise highs rise into small, medium and large
// islands with hilly relief. Capped for fan cooperation: no natural relief
// ever reaches the lowest fan shell, corridor or frame.
const SEA_BED = 10;
// Island tops stop 1 block below the lowest fan shell floor: natural relief
// doubles as bridge ground (up to 10 above the sea) while high tunnels
// still never touch it.
const FBM_TOP_MAX = NETHER_FIRE_LEVEL + 10;
// Land-vs-water tuning knob: added to the fbm base height, so +N grows the
// islands and -N floods them (roughly ±10 ratio points per ∓2 around the
// ~1/3 default; useful range [-4, +4]). Default 0 keeps the current
// rendering exactly. Rivers stay absolute (lava must sit at fire level),
// the FBM_TOP_MAX cap still bounds every island, and siting vetoes are
// unchanged — tuning the mean only, never the per-seed variance.
const NETHER_LAND_OFFSET = 0;
// Flat lava-sea margin along every cascade (5 blocks): no island ever
// touches a lava band — islands may stand anywhere beyond that, including
// between the two courses. Hard carve like master's trenches.
const CASCADE_CLEAR = 5;
function netherLandHeight(x, z) {
  const q = fbm(x * 0.0065, z * 0.0065, netherSeed + 311);
  const q2 = fbm(x * 0.013, z * 0.013, netherSeed + 317);
  const rel = (fbm(x * 0.03, z * 0.03, netherSeed + 313) - 0.5) * 18;
  let h = Math.floor(NETHER_FIRE_LEVEL - 4 + NETHER_LAND_OFFSET + (q - 0.42) * 32 + (q2 - 0.5) * 26 + rel);
  if (inWorld(x, z)) {
    const t = riverT[idx(x, z)];
    if (t >= 0) h = Math.min(h, NETHER_FIRE_LEVEL - 2 + Math.floor(t * 4));
    for (const v of volcanoes) {
      if (v.flowAng === undefined || !v.courses.length) continue;
      const dx = x - v.x, dz = z - v.z;
      const d = Math.hypot(dx, dz);
      if (d < v.craterR) continue;
      for (const c of v.courses) {
        if (d > c.trenchEnd) continue;
        if (Math.abs(-dx * c.sin + dz * c.cos) <= cascadeHalfAt(v, d) + CASCADE_CLEAR) {
          h = Math.min(h, SEA_BED);
          break;
        }
      }
      if (h <= SEA_BED) break;
    }
  }
  return Math.max(1, Math.min(FBM_TOP_MAX, h));
}

// Raw fbm + rivers, without the cascade carve: the trench scan reads the
// natural relief so bands drape over islands instead of stopping at the
// cone foot.
function rawLandHeight(x, z) {
  const q = fbm(x * 0.0065, z * 0.0065, netherSeed + 311);
  const q2 = fbm(x * 0.013, z * 0.013, netherSeed + 317);
  const rel = (fbm(x * 0.03, z * 0.03, netherSeed + 313) - 0.5) * 18;
  let h = Math.floor(NETHER_FIRE_LEVEL - 4 + NETHER_LAND_OFFSET + (q - 0.42) * 32 + (q2 - 0.5) * 26 + rel);
  if (inWorld(x, z)) {
    const t = riverT[idx(x, z)];
    if (t >= 0) h = Math.min(h, NETHER_FIRE_LEVEL - 2 + Math.floor(t * 4));
  }
  return Math.max(1, Math.min(FBM_TOP_MAX, h));
}

function landHeightCached(x, z) {
  if (!inWorld(x, z)) return 1;
  const i = idx(x, z);
  const v = landCache[i];
  if (!Number.isNaN(v)) return v;
  const h = netherLandHeight(x, z);
  landCache[i] = h;
  return h;
}

function generateVolcanoes() {
  volcanoes = [];
  // One immense volcano per map corner (opposite corners, so the two cones
  // always read as distinct landmarks); small seeded jitter keeps the exact
  // footprint reproducible per world seed.
  const corners = [[-1, -1], [1, 1]];
  for (let i = 0; i < VOLCANO_COUNT; i++) {
    const radius = 70 + Math.floor(hash2(i, 2, netherSeed + 913) * 16);
    const [sx, sz] = corners[i % corners.length];
    const jx = Math.floor((hash2(i, 8, netherSeed + 919) - 0.5) * 8);
    const jz = Math.floor((hash2(i, 9, netherSeed + 920) - 0.5) * 8);
    let vx = sx * (S - radius - 2) + jx;
    let vz = sz * (S - radius - 2) + jz;
    if (vx < -S + radius) vx = -S + radius;
    if (vx > S - radius) vx = S - radius;
    if (vz < -S + radius) vz = -S + radius;
    if (vz > S - radius) vz = S - radius;
    // Keep the near edge clear of the spawn pad.
    const dd = Math.hypot(vx, vz);
    if (dd < radius + 6) {
      const a = Math.atan2(vz, vx);
      vx = Math.round(Math.cos(a) * (radius + 6));
      vz = Math.round(Math.sin(a) * (radius + 6));
    }
    const peak = 260 + Math.floor(hash2(i, 3, netherSeed + 914) * 24);
    const craterR = 5 + Math.floor(hash2(i, 4, netherSeed + 915) * 5);
    const craterDepth = 14 + Math.floor(hash2(i, 5, netherSeed + 916) * 14);
    const toCentre = Math.atan2(-vz, -vx);
    // Symmetric central courses: the lava stays in the platform's view while
    // both flanks are left free for the tunnel fans.
    const j1 = (hash2(i, 6, netherSeed + 917) - 0.5) * 2 * CASCADE_JITTER;
    const j2 = (hash2(i, 7, netherSeed + 918) - 0.5) * 2 * CASCADE_JITTER;
    const flowAng = toCentre - CASCADE_SPLIT + j1;
    const flowAng2 = toCentre + CASCADE_SPLIT + j2;
    const baseY = Math.max(NETHER_FIRE_LEVEL, Math.min(96, Math.floor(netherLandHeight(vx, vz))));
    volcanoes.push({
      x: vx, z: vz, radius, peak, rim: peak * 0.85, craterR, craterDepth,
      flowAng, flowAng2, baseY, courses: [],
    });
  }
}

function volcanoHeightAt(v, x, z) {
  const d = Math.hypot(x - v.x, z - v.z);
  if (d >= v.radius) return null;
  const t = 1 - d / v.radius;
  const slope = Math.pow(t, 1.2);
  const rimT = Math.max(0.001, 1 - v.craterR / v.radius);
  const rimSlope = Math.pow(rimT, 1.2);
  if (d <= v.craterR) {
    let h = v.rim;
    const k = 1 - d / v.craterR;
    h -= v.craterDepth * k * k;
    return h;
  }
  // Flat summit lip: an exact rim-height ring around the crater mouth, so
  // the top reads level and the lava lake meets the falls without a step.
  if (d <= v.craterR + SUMMIT_LIP) return v.rim;
  const ridge = 0.9 + 0.2 * (fbm(x * 0.07 + 40, z * 0.07 + 40, netherSeed + 921) - 0.5);
  return v.rim * (slope / rimSlope) * ridge;
}

function topAt(x, z) {
  if (!inWorld(x, z)) return -1;
  const i = idx(x, z);
  const cached = topCache[i];
  if (!Number.isNaN(cached)) return cached;
  let top = landHeightCached(x, z);
  for (const v of volcanoes) {
    const vh = volcanoHeightAt(v, x, z);
    if (vh != null) top = Math.max(top, Math.round(vh));
  }
  const ih = isletHeightAt(x, z);
  if (ih > top) top = ih;
  topCache[i] = top;
  return top;
}

// Lowest surface within Chebyshev radius 2. Out-of-world columns read as -1,
// so the shell closes the volcano face that touches the level edge.
function minTop5(x, z) {
  let min = topAt(x, z);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (!dx && !dz) continue;
      const t = topAt(x + dx, z + dz);
      if (t < min) min = t;
    }
  }
  return min;
}

function generateNetherRivers() {
  netherRiverPaths = [];
  for (let i = 0; i < NETHER_RIVER_COUNT; i++) {
    const rs = netherSeed + 555 + i * 101;
    const edge = Math.floor(hash2(0, 0, rs + 1) * 4);
    const along = (hash2(0, 0, rs + 2) * 2 - 1) * S * 0.6;
    let x, z, head;
    if (edge === 0) { x = -S; z = along; head = 0; }
    else if (edge === 1) { x = S; z = along; head = Math.PI; }
    else if (edge === 2) { x = along; z = -S; head = Math.PI / 2; }
    else { x = along; z = S; head = -Math.PI / 2; }
    const wobA = 0.5 + hash2(0, 0, rs + 3) * 0.4;
    const wobF = 0.1 + hash2(0, 0, rs + 4) * 0.06;
    const phase = hash2(0, 0, rs + 5) * Math.PI * 2;
    const pts = [[x, z]];
    for (let n = 1; n < 80; n++) {
      head += wobA * Math.sin(n * wobF + phase);
      if (x > S * 0.6) head -= 0.12;
      if (x < -S * 0.6) head += 0.12;
      if (z > S * 0.6) head -= 0.12;
      if (z < -S * 0.6) head += 0.12;
      x += Math.cos(head) * 24;
      z += Math.sin(head) * 24;
      pts.push([x, z]);
      if (x > S + 40 || x < -S - 40 || z > S + 40 || z < -S - 40) break;
    }
    if (pts.length > 4) netherRiverPaths.push(pts);
  }
}

// Rasterize the river carve once: a per-column loop over 320 segments was the
// dominant setup + generation cost.
function buildRiverCarve() {
  riverT.fill(-1);
  riverScore.fill(Infinity);
  for (const pts of netherRiverPaths) {
    const n = pts.length - 1;
    for (let k = 0; k < n; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const w = 5 * (0.7 + 0.6 * (k / n));
      const x0 = Math.max(-S, Math.floor(Math.min(ax, bx) - w - 1));
      const x1 = Math.min(S, Math.ceil(Math.max(ax, bx) + w + 1));
      const z0 = Math.max(-S, Math.floor(Math.min(az, bz) - w - 1));
      const z1 = Math.min(S, Math.ceil(Math.max(az, bz) + w + 1));
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const d = distToSegment(x, z, ax, az, bx, bz);
          if (d > w) continue;
          const score = d - w;
          const i = idx(x, z);
          if (score < riverScore[i]) {
            riverScore[i] = score;
            riverT[i] = d / w;
          }
        }
      }
    }
  }
}

// Islets: flat rocky shelves under every ground bridge. Analytic (centre,
// radius, flat top with a hashed fringe), so siting reads them with no
// voxel cost. Big fbm islands need no registry — topAt reads the heightfield
// directly.
const ISLET_TOP_MAX = NETHER_FIRE_LEVEL + 3;
function isletHeightAt(x, z) {
  let top = -1;
  for (const s of islets) {
    const dx = x - s.x, dz = z - s.z;
    const rr = s.r + 1;
    if (dx * dx + dz * dz > rr * rr) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    let h = -1;
    if (d <= s.r) {
      h = s.top;
    } else if (hash2(x, z, netherSeed + 77) < 0.5) {
      h = s.top - 1;
    }
    if (h > top) top = h;
  }
  return top;
}
// The islet list changed: drop the surface cache so the next siting pass
// reads the new relief.
function bumpTopo() {
  topCache.fill(NaN);
}

// True on a lava band (plus 2 cells of margin): the O(1) siting prefilter.
// Exact vertical overlap is still decided per column by courseSpanAt where
// this is set, so a high walkway may honestly thread over a low fall.
function inCascadeBand(x, z) {
  return inWorld(x, z) && cascadeMask[idx(x, z)] === 1;
}

function buildCascadeMask() {
  cascadeMask.fill(0);
  for (const v of volcanoes) {
    for (const c of v.courses) {
      for (let d = v.craterR; d <= c.trenchEnd; d++) {
        const half = cascadeHalfAt(v, d) + 2;
        for (let lat = -half; lat <= half; lat++) {
          const x = Math.round(v.x + c.cos * d - c.sin * lat);
          const z = Math.round(v.z + c.sin * d + c.cos * lat);
          if (inWorld(x, z)) cascadeMask[idx(x, z)] = 1;
        }
      }
    }
  }
}

function buildCourses(v) {
  // Both courses share one geometry: a constant-width band from the crater
  // lip down the cone, then over whatever island relief stands in the way
  // until the lava sea — only the axis differs.
  const courses = [{ ang: v.flowAng }, { ang: v.flowAng2 }];
  for (const c of courses) {
    c.cos = Math.cos(c.ang);
    c.sin = Math.sin(c.ang);
    c.foot = v.radius;
    c.trenchEnd = c.foot;
    for (let d = c.foot + 1; d <= c.foot + 60; d++) {
      const hc = rawLandHeight(
        Math.round(v.x + c.cos * d),
        Math.round(v.z + c.sin * d),
      );
      if (hc <= NETHER_FIRE_LEVEL) break;
      c.trenchEnd = d;
    }
  }
  v.courses = courses;
}

// Band surface at one column, or null outside the lava band: the capped
// cone surface, or the island relief past the foot draped down to the sea
// (the curtain hugs the ground instead of floating over it).
function courseSurfaceAt(v, c, x, z) {
  if (!inWorld(x, z)) return null;
  const dx = x - v.x, dz = z - v.z;
  const d = Math.hypot(dx, dz);
  if (d < v.craterR || d > c.trenchEnd) return null;
  if (Math.abs(-dx * c.sin + dz * c.cos) > cascadeHalfAt(v, d)) return null;
  if (d <= v.radius) {
    const vh = volcanoHeightAt(v, x, z);
    return Math.round(vh == null ? landHeightCached(x, z) : Math.max(vh, landHeightCached(x, z)));
  }
  return Math.max(landHeightCached(x, z), NETHER_FIRE_LEVEL);
}

// One lava band column, or null outside the band: a constant 2-thick lava
// curtain hugging the surface everywhere (capped at the rim near the
// summit, so no lava pokes above the flat top). The section never varies:
// where the ground steps down, this column extends down to the lowest
// neighbouring band top, so the fall drops as a vertical lavafall instead
// of floating or fattening. Lateral cutoff is a hard cell count, so every
// fall is the same width from lip to sea and pure lava edge to edge.
function courseSpanAt(v, c, x, z) {
  const dx = x - v.x, dz = z - v.z;
  const d = Math.hypot(dx, dz);
  if (d < v.craterR || d > c.trenchEnd) return null;
  const lat = -dx * c.sin + dz * c.cos;
  if (Math.abs(lat) > cascadeHalfAt(v, d)) return null;
  const s = courseSurfaceAt(v, c, x, z);
  if (s == null) return null;
  const top = d < v.craterR + 12 ? Math.min(s, Math.round(v.rim)) : s;
  let lo = top - CASCADE_DEPTH + 1;
  for (let nx = -1; nx <= 1; nx++) {
    for (let nz = -1; nz <= 1; nz++) {
      if (!nx && !nz) continue;
      const ns = courseSurfaceAt(v, c, x + nx, z + nz);
      if (ns == null) continue;
      const nt = Math.min(ns, Math.round(v.rim));
      if (nt < lo) lo = nt;
    }
  }
  return [Math.max(1, lo), top];
}

// High-fan floor: no fan walkway, shell, frame or corridor ever drops into
// the low band, so fans and islands coexist by altitude alone (fbm relief
// is capped at FBM_TOP_MAX, shelves lower still).
const FAN_PLAT_MIN = NETHER_FIRE_LEVEL + 12;

// True when any analytic cell of tube t at or below yTop touches the disc
// (cx, cz, r): bore, corridor, shell, frame and doorstep all count, so a
// bridge envelope and an islet either land together or never meet.
function tubeHitsDisc(t, cx, cz, r, yTop) {
  const r2 = r * r;
  for (const c of frameCells(t)) {
    const [x, y, z] = c.split(",").map(Number);
    if (y > yTop) continue;
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz <= r2) return true;
  }
  if (t.doorstep) {
    for (const c of t.doorstep) {
      const [x, y, z] = c.split(",").map(Number);
      if (y > yTop) continue;
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz <= r2) return true;
    }
  }
  const x0 = Math.max(t.bounds.x0, Math.floor(cx - r)), x1 = Math.min(t.bounds.x1, Math.ceil(cx + r));
  const z0 = Math.max(t.bounds.z0, Math.floor(cz - r)), z1 = Math.min(t.bounds.z1, Math.ceil(cz + r));
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > r2) continue;
      for (let y = SEA_BED + 1; y <= yTop; y++) {
        if (tubeInteriorAt(t, x, y, z) || tubeCorridorAt(t, x, y, z) || tubeShellAt(t, x, y, z)) return true;
      }
    }
  }
  return false;
}

// An islet disc is valid on open sea only: never on a cone, the pad or
// another islet, every lava band beyond its radius plus margin, and no
// bridge envelope touching it — so cascades stay free from lip to sea.
// `extra` holds tubes the global list does not know yet (the volcano's own
// accepted bridges while it is still siting them).
const ISLET_CASCADE_MARGIN = 6;
function isletSpotFree(cx, cz, r, extra, yTop) {
  if (cx - r < -S || cx + r > S || cz - r < -S || cz + r > S) return false;
  for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > r * r) continue;
      if (topAt(x, z) > NETHER_FIRE_LEVEL) return false;
    }
  }
  const m = r + ISLET_CASCADE_MARGIN;
  for (let x = Math.floor(cx - m); x <= Math.ceil(cx + m); x++) {
    for (let z = Math.floor(cz - m); z <= Math.ceil(cz + m); z++) {
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > m * m) continue;
      if (inCascadeBand(x, z)) return false;
    }
  }
  if (inReturnPad(cx, cz, r + 4)) return false;
  for (const s of islets) {
    if (Math.hypot(cx - s.x, cz - s.z) < r + s.r + 4) return false;
  }
  for (const t of tunnels) {
    if (tubeHitsDisc(t, cx, cz, r, yTop)) return false;
  }
  if (extra) {
    for (const t of extra) {
      if (tubeHitsDisc(t, cx, cz, r, yTop)) return false;
    }
  }
  return true;
}

// Push a validated landing shelf, or null. Rolled back when its bridge
// fails, so orphans never clutter the sea.
function tryAddIslet(cx, cz, r, top, extra) {
  if (top > ISLET_TOP_MAX || top <= NETHER_FIRE_LEVEL) return null;
  if (!isletSpotFree(cx, cz, r, extra, top)) return null;
  const s = { x: cx, z: cz, r, top };
  islets.push(s);
  bumpTopo();
  return s;
}
function dropIslet(s) {
  const i = islets.indexOf(s);
  if (i >= 0) islets.splice(i, 1);
  bumpTopo();
}

// A mouth needs no band lava under any ring column — of either volcano —
// or the floor it stands on is liquid. The ban mask prefilters: spans are
// sampled exactly per column only where a band runs nearby, so a high mouth
// may still arch over a low fall while a lava-floored one is always refused.
function courseClearance(v, t) {
  // 8-wide frame footprint: no band lava under any ring column.
  for (let off = -4; off <= 3; off++) {
    const [wx, wz] = planeCell(v, t, t.dOut, off);
    if (!inCascadeBand(wx, wz)) continue;
    for (const vv of volcanoes) {
      for (const c of vv.courses) {
        const span = courseSpanAt(vv, c, wx, wz);
        if (span && span[0] <= t.plat - 1 && t.plat - 1 <= span[1]) return false;
      }
    }
  }
  return true;
}

// Conservative continuous bounds for chunk dispatch: the analytic tube
// (shell band d in [minD-3, farD], lateral in [-7, 7)) covers the bore shell
// and the view corridor, plus one cell of margin.
function tunnelBounds(v, dx, dz, lx, lz, minD, farD) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const d of [minD - 3, farD]) {
    for (const lat of [-7, 7]) {
      const wx = v.x + dx * d + lx * lat;
      const wz = v.z + dz * d + lz * lat;
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wz < z0) z0 = wz;
      if (wz > z1) z1 = wz;
    }
  }
  return {
    x0: Math.floor(x0) - 1, x1: Math.ceil(x1) + 1,
    z0: Math.floor(z0) - 1, z1: Math.ceil(z1) + 1,
  };
}

// Flush siting: outermost distance where the flank surface meets the frame
// base — rock under every frame column, none above its 8-high top — so the
// mouth-sized ring glues onto the wall face on one shared horizontal plane
// instead of burying. Score = burial + 3x float (the corridor clears burial, so
// backing decides); -1 when nothing is backed.
function frameSurfaced(v, r, plat, minD) {
  let best = -1, bestScore = Infinity;
  for (let d = v.radius + 6; d >= minD; d--) {
    let over = 0, under = 0;
    for (let off = -4; off <= 3; off++) {
      const [x, z] = planeCell(v, r, d, off);
      if (!inWorld(x, z)) { over = Infinity; break; }
      const top = topAt(x, z);
      if (top > plat + 7) over = Math.max(over, top - (plat + 7));
      if (top < plat - 1) under = Math.max(under, (plat - 1) - top);
    }
    if (under === 0 && over + 3 * under < bestScore) { best = d; bestScore = over; }
  }
  return best;
}

// View corridor exit: first distance past the frame where the whole ring
// footprint stands under open sky (solid top at or below the ring base),
// so no rock can hide any frame cell from the approach. Past EXIT_CAP, a
// shallow notch (overburden within EXIT_NOTCH) still exits within EXIT_FAR:
// the corridor clears it the same way, as a rock canyon instead of open
// approach. -1 when neither opens (facing a mountain, not a hill).
function findCorridorExit(v, r, dOut, plat) {
  for (let d = dOut + 1; d <= dOut + EXIT_CAP; d++) {
    let open = true;
    for (let off = -4; off <= 3; off++) {
      const [x, z] = planeCell(v, r, d, off);
      if (!inWorld(x, z) || topAt(x, z) > plat) { open = false; break; }
    }
    if (open) return d;
  }
  for (let d = dOut + EXIT_CAP + 1; d <= dOut + EXIT_FAR; d++) {
    let shallow = true;
    for (let off = -4; off <= 3; off++) {
      const [x, z] = planeCell(v, r, d, off);
      if (!inWorld(x, z) || topAt(x, z) > plat + EXIT_NOTCH) { shallow = false; break; }
    }
    if (shallow) return d;
  }
  return -1;
}

// One heading: unit ray and lateral steps from its angle.
function makeHeading(ang) {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  return { ang, dx, dz, mx: -dz, mz: dx };
}

// Deterministic draw in [0,1) for organic layout: seeded, so the same world
// seed always deals the same mouths.
function draw(salt, i) {
  return hash2(i, salt, netherSeed + 4242);
}

function makeTunnel(v, vi, dir, k, minD) {
  const r = makeHeading(dir);
  // High fans only: the low band belongs to the islands and the ground
  // bridges, so no fan envelope ever needs an island veto — altitude alone
  // separates them (fbm relief stays at or below FBM_TOP_MAX).
  const hLo = Math.max(v.baseY + 6, FAN_PLAT_MIN + 4), hHi = v.rim * 0.8;
  const hT = hLo + (hHi - hLo) * (((k * 7) % (FAN_TUNNELS + 2)) / (FAN_TUNNELS + 2));
  const plat = Math.round(hT) - 4;
  const flush = frameSurfaced(v, r, plat, minD);
  if (flush < 0) return null;
  // Glued to the wall face: the frame sits exactly at the flush distance,
  // never recessed, so no niche and no ledge in front of the ring.
  return finishTunnel(v, vi, dir, r, k, minD, plat, flush);
}

// Shared tail: corridor exit, apron, lava-column bore and descriptor.
// thinFrom is the d where the 1-thick exposed shell starts (2-thick while
// buried): backed up from the mouth while no rock rises above the floor, so
// every tunnel wears 1 block where it stands in the open and 2 where it runs
// in rock. The partition stays exact either way.
function finishTunnel(v, vi, dir, r, k, minD, plat, dOut) {
  if (dOut < minD) return null;
  const exitD = findCorridorExit(v, r, dOut, plat);
  if (exitD < 0) return null;
  // Approach apron: past the exit the band keeps clearing until open sky
  // holds for APRON_OPEN consecutive columns, so no hill can wall off the frame.
  let apronEnd = exitD + CORRIDOR_MARGIN;
  let run = 0;
  for (let d = exitD + 1; d <= dOut + EXIT_CAP; d++) {
    let open = true;
    for (let off = -4; off <= 3; off++) {
      const [x, z] = planeCell(v, r, d, off);
      if (!inWorld(x, z)) continue;
      if (topAt(x, z) > plat) { open = false; break; }
    }
    if (open) {
      if (++run >= APRON_OPEN) break;
    } else {
      run = 0;
      apronEnd = d + CORRIDOR_MARGIN;
    }
  }
  // The bore always starts at the central shaft (craterR - 1) and opens
  // onto bare shaft lava. The lava gate lives in boreBlocked below: it
  // vetoes every band crossing the walkway exactly per column, so only the
  // shaft's own lava is ever met (a lateral pre-gate would only add false
  // rejections where a high walkway threads over a low fall).
  const bore0 = v.craterR - 1;
  // Exposed run, if any: 1-thick shell from the first d whose remainder to
  // the mouth stands clear of rock above the floor. Flush mouths stay fully
  // buried (2-thick throughout); protruding pipes go thin where they emerge.
  let thinFrom = dOut + 1;
  for (let d = dOut; d >= bore0 - 3; d--) {
    let back = true;
    for (let off = -4; off <= 3; off++) {
      const [x, z] = planeCell(v, r, d, off);
      if (!inWorld(x, z) || topAt(x, z) > plat - 1) { back = false; break; }
    }
    if (!back) break;
    thinFrom = d;
  }
  const t = {
    v, vi, k, dir,
    dx: r.dx, dz: r.dz, mx: r.mx, mz: r.mz,
    minD, bore0, dOut, plat, exitD, apronEnd, thinFrom,
    doorV: Math.floor(hash2(vi * (FAN_TUNNELS + GROUND_BRIDGES) + k, 31, netherSeed) * GLOW_VARIANT_COUNT),
    bounds: tunnelBounds(v, r.dx, r.dz, r.mx, r.mz, bore0, apronEnd),
  };
  // Precomputed once: every siter and builder below reads the same doorstep
  // keys, including the crossing test. Same for the mouth columns below.
  t.doorstep = new Set(doorstepCells(t));
  t.cols = mouthCols(t);
  return t;
}

// Tip overhang past the cone foot, in blocks: a bridge mouth always stands
// 5..15 blocks clear of the flank, so the pipe reads outside instead of as
// a flush mouth. No clamping — a heading with no room in the band fails and
// the placer retries elsewhere, through annealed separation and a carve
// fallback if needed, until three bridges stand.
const TIP_OVERHANG_MIN = 5;
const TIP_OVERHANG_MAX = 15;
// Ground bridge: a low tube whose tip stands outside the flank — either on
// a landing shelf grown jointly under the tip, or right on flat island
// relief (the island doubles as the floor). The tip sets plat and no
// masonry socle ever paves the sea.
function mouthInBounds(t) {
  const b = t.bounds;
  return b.x0 >= -S && b.x1 <= S && b.z0 >= -S && b.z1 <= S;
}

// Shared lattice mapping: one voxel column per (distance, offset), used by
// survey, placement and clearing alike, so they agree cell for cell. The
// column is projected back onto its integer plane along the heading normal,
// so ring and opening share the exact cells at every row instead of
// staggering with per-cell rounding.
function planeCell(v, r, d, off) {
  const px = v.x + r.dx * d + r.mx * off;
  const pz = v.z + r.dz * d + r.mz * off;
  const drift = d - ((px - v.x) * r.dx + (pz - v.z) * r.dz);
  return [Math.round(px + r.dx * drift), Math.round(pz + r.dz * drift)];
}

// Mouth columns: the integer columns the bore actually opens through at the
// mouth slice (continuous d within half a block of dOut, f in the 8-wide
// band), ordered laterally. Count varies (7-9) with the heading — the ring is
// sized from these, so jambs always land exactly on the opening edges instead
// of the rounded lattice row beside it. Pure geometry from the descriptor,
// so siting and construction derive the exact same columns.
function mouthCols(t) {
  const v = t.v;
  const seen = new Map();
  const cx = v.x + t.dx * t.dOut, cz = v.z + t.dz * t.dOut;
  for (let x = Math.floor(cx - 9); x <= Math.ceil(cx + 9); x++) {
    for (let z = Math.floor(cz - 9); z <= Math.ceil(cz + 9); z++) {
      const rx = x - v.x, rz = z - v.z;
      const d = rx * t.dx + rz * t.dz;
      if (Math.abs(d - t.dOut) > 0.5) continue;
      const s = rx * t.mx + rz * t.mz;
      if (s < -4 || s >= 4) continue;
      const k = x + "," + z;
      if (!seen.has(k)) seen.set(k, { x, z, s });
    }
  }
  return [...seen.values()].sort((a, b) => a.s - b.s).map(({ x, z }) => [x, z]);
}

// Frame cells: the full mouth-column block (every mouth column, base row on
// the shared horizontal plat). The glowstone ring below is its edge subset —
// jambs on the first/last columns, sill and lintel rows across — so the ring
// hugs the carved opening at any width. Reserving the whole block protects
// the doorway airspace through the same keys construction uses.
function frameCells(t) {
  const cols = t.cols ?? mouthCols(t);
  const cells = [];
  for (const [wx, wz] of cols) {
    for (let yy = t.plat; yy <= t.plat + 7; yy++) cells.push(wx + "," + yy + "," + wz);
  }
  return cells;
}

// Doorstep cells: the lowered floor row just past the frame (continuous d
// past dOut up to dOut + 1.5, f in the 8-wide band, one below sill level).
// Neither bore (ends at dOut) nor corridor (starts at plat + 1) claims them,
// so without this zone a dip in front of the doorway reads as a pit at the
// door — while paving them at sill level would hide the glowstone sill from
// the approach, so they sit one lower and the sill reads over them. Same
// classifier as construction, so siting reservations agree exactly.
function doorstepCells(t) {
  const v = t.v;
  const cells = [];
  const seen = new Set();
  const cx = v.x + t.dx * (t.dOut + 1), cz = v.z + t.dz * (t.dOut + 1);
  for (let x = Math.floor(cx - 9); x <= Math.ceil(cx + 9); x++) {
    for (let z = Math.floor(cz - 9); z <= Math.ceil(cz + 9); z++) {
      const rx = x - v.x, rz = z - v.z;
      const d = rx * t.dx + rz * t.dz;
      if (d <= t.dOut || d > t.dOut + 1.5) continue;
      const f = rx * t.mx + rz * t.mz + 4;
      if (f < 0 || f >= 8) continue;
      const k = x + "," + (t.plat - 1) + "," + z;
      if (!seen.has(k)) { seen.add(k); cells.push(k); }
    }
  }
  return cells;
}

// Rock collar around the ring: every face- and diagonal-neighbour (same
// level) of a frame cell that is not frame, walkway or corridor — at the
// ring plane or behind it, never past it, so the collar never reads as a
// lip in front of the portal. Built from the same integer cells as the ring
// itself (not the continuous projection), so on diagonal headings no
// stair-corner slot survives between the glowstone jambs and the rock shell
// — including corner-touching pinholes the thin lining band misses by a
// fraction of a cell. Above the doorway roof the natural-surface trim
// applies (no floating cap over the opening); at wall level and below the
// collar always closes against lining and ring. Pure geometry from the
// descriptor — siting reservations and construction derive the exact same
// keys.
const COLLAR_DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
];
function frameCollarKeys(t) {
  const own = new Set(frameCells(t));
  const keys = [];
  const seen = new Set();
  for (const c of own) {
    const [x, y, z] = c.split(",").map(Number);
    for (const [dx, dy, dz] of COLLAR_DIRS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const k = nx + "," + ny + "," + nz;
      if (seen.has(k) || own.has(k) || ringCells.has(k)) continue;
      seen.add(k);
      // Backing only: anything past the mouth slice belongs to the cleared
      // approach (corridor), the paved doorstep, or open relief — never to
      // the seal. Keys within the slice sit flush with the ring, never proud.
      const rx = nx - t.v.x, rz = nz - t.v.z;
      if (rx * t.dx + rz * t.dz > t.dOut + 0.5) continue;
      if (tubeInteriorAt(t, nx, ny, nz) || tubeCorridorAt(t, nx, ny, nz)) continue;
      keys.push(k);
    }
  }
  return keys;
}

// Buried next to rock: true when the natural surface reaches y in a
// four-neighbour column, so a rock cell reads attached to the hillside
// instead of floating over the opening.
function touchesRockAt(x, y, z) {
  return topAt(x + 1, z) >= y || topAt(x - 1, z) >= y ||
    topAt(x, z + 1) >= y || topAt(x, z - 1) >= y;
}

// Analytic tube geometry, shared by siting and construction alike: every
// cell is classified from its continuous projection (d along the heading,
// f = lateral + 4) instead of a rounded (d, off) lattice, so carve, shell
// and vetoes agree cell for cell on every heading, diagonals included.
// Interior and shell form a partition: a cell is one or the other, never
// both, never neither — no gap, no overlap, no pillar, no hole.
function tubeInteriorAt(u, x, y, z) {
  if (y < u.plat + 1 || y > u.plat + 6) return false;
  const rx = x - u.v.x, rz = z - u.v.z;
  const d = rx * u.dx + rz * u.dz;
  if (d < u.bore0 || d > u.dOut) return false;
  const f = rx * u.mx + rz * u.mz + 4;
  return f >= 0 && f < 8;
}
function tubeCorridorAt(u, x, y, z) {
  const rx = x - u.v.x, rz = z - u.v.z;
  const d = rx * u.dx + rz * u.dz;
  if (d <= u.dOut || d > u.apronEnd) return false;
  const f = rx * u.mx + rz * u.mz + 4;
  // Ten wide up to the exit (one column of margin per side, so no rock tooth
  // beside a jamb can hide ring cells from the approach), eight past it.
  if (d <= u.exitD) {
    if (f < -1 || f >= 9) return false;
    // Sill sight row past the frame: no rock here ever hides the sill. It
    // starts at the frame plane (the lowered doorstep below it is disjoint
    // by level), so no approach cell facing the sill is left unowned.
    if (y === u.plat) return f >= 0 && f < 8 && d > u.dOut;
    if (y < u.plat + 1 || y > u.plat + 60) return false;
    return true;
  }
  if (f < 0 || f >= 8) return false;
  return y >= u.plat + 1 && y <= u.plat + 8;
}
function tubeShellAt(u, x, y, z) {
  const rx = x - u.v.x, rz = z - u.v.z;
  const d = rx * u.dx + rz * u.dz;
  if (d < u.bore0 - 3 || d > u.dOut) return false;
  // Exposed shell past thinFrom: 1 thick — floor plat, roof plat+7, one
  // column per side. Buried run keeps 2: floor plat-1..plat, roof
  // plat+7..plat+8, two columns per side.
  const thin = d >= u.thinFrom;
  if (y < (thin ? u.plat : u.plat - 1)) return false;
  if (y > (thin ? u.plat + 7 : u.plat + 8)) return false;
  const f = rx * u.mx + rz * u.mz + 4;
  if (thin && (f < -1 || f >= 9)) return false;
  if (!thin && (f < -2 || f >= 10)) return false;
  return !tubeInteriorAt(u, x, y, z);
}
// Central-platform guard: the tube envelope (bore, shell, corridor, frame)
// never touches the return pad. Absolute by footprint, whatever the heights.
function tubeHitsPad(t) {
  if (!returnPad) return false;
  const m = 4;
  return t.bounds.x0 <= returnPad.x1 + m && returnPad.x0 - m <= t.bounds.x1 &&
    t.bounds.z0 <= returnPad.z1 + m && returnPad.z0 - m <= t.bounds.z1;
}
function inReturnPad(x, z, margin = 2) {
  return returnPad &&
    x >= returnPad.x0 - margin && x <= returnPad.x1 + margin &&
    z >= returnPad.z0 - margin && z <= returnPad.z1 + margin;
}
function boxesOverlap(a, b) {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
}
// Exact crossing test between a candidate tube and an accepted one, over
// their bounds overlap: no bore/corridor cell may touch another tube's
// interior, corridor, shell rock or frame, and no shell cell may touch
// another tube's airspace or frame. Decided per cell through the shared
// classifiers (never inline math), so siting vetoes exactly what
// construction builds — widened corridor and sill sight row included.
function tubesCross(t, u) {
  const x0 = Math.max(t.bounds.x0, u.bounds.x0), x1 = Math.min(t.bounds.x1, u.bounds.x1);
  const z0 = Math.max(t.bounds.z0, u.bounds.z0), z1 = Math.min(t.bounds.z1, u.bounds.z1);
  const y0 = Math.min(t.plat, u.plat) - 2, y1 = Math.max(t.plat, u.plat) + 60;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const rtx = x - t.v.x, rtz = z - t.v.z;
      const td = rtx * t.dx + rtz * t.dz, tf = rtx * t.mx + rtz * t.mz + 4;
      // Column prefilter (superset, speed only): exact verdicts come from
      // the classifiers in the y loop below.
      if (td < t.bore0 - 3 || td > t.apronEnd || tf < -3 || tf >= 11) continue;
  // Shared crater chamber: everything merges inside the crater
  // neighbourhood — solid core carved open identically on both sides,
  // shaft lava kept identically, no shell ever stands on void there —
  // so no crossing there is ever a hole. Corridors and frames
  // never reach that deep anyway (mouths, tips and corridors all sit
  // far outside the crater), so the skip only ever meets bore and
  // shell rock.
  if (nearCrater(t, u, x, z)) continue;
      for (let y = y0; y <= y1; y++) {
        const b = tubeInteriorAt(t, x, y, z);
        const c = !b && tubeCorridorAt(t, x, y, z);
        const ck = x + "," + y + "," + z;
        if ((b || c) && (tubeInteriorAt(u, x, y, z) || tubeCorridorAt(u, x, y, z) ||
            tubeShellAt(u, x, y, z) ||
            (u.doorstep && u.doorstep.has(ck)) || ringCells.has(ck))) return true;
        if (!b && !c && tubeShellAt(t, x, y, z) &&
            (tubeInteriorAt(u, x, y, z) || tubeCorridorAt(u, x, y, z) ||
            ringCells.has(ck))) return true;
      }
    }
  }
  return false;
}

// Shared crater chamber: every tube starts at the same ground height inside
// the crater neighbourhood, so their envelopes overlap there by
// construction. The core is solid rock carved open identically (shaft lava
// kept identically), never void — merging there is a doorway, never a hole.
const CRATER_MERGE = 6;
function nearCrater(t, u, x, z) {
  const tdx = x - t.v.x, tdz = z - t.v.z;
  const udx = x - u.v.x, udz = z - u.v.z;
  return tdx * tdx + tdz * tdz <= (t.v.craterR + CRATER_MERGE) * (t.v.craterR + CRATER_MERGE) &&
    udx * udx + udz * udz <= (u.v.craterR + CRATER_MERGE) * (u.v.craterR + CRATER_MERGE);
}

// Spread layout: bridges and their landing shelves first on every volcano,
// fans last and high above it all — island relief never reaches them, while
// low bridges route around it through the terrain veto. Exit tubes contend
// only with rock, lava and other bridges — never with the other volcano's
// long view corridors — while every fan still routes around all bridges
// through the same vetoes. Rejection filters (separation, siting, corridor,
// lava clearance, bounds, reservations) keep every accepted mouth clean.
function buildTunnelDescriptors() {
  tunnels = [];
  ringCells = new Set();
  const ctxs = volcanoes.map((v, vi) => ({
    v, vi, minD: v.craterR + 1, toCentre: Math.atan2(-v.z, -v.x),
    usedH: new Set(), usedCells: new Set(), usedAir: new Set(),
    dirs: [], list: [], groundCount: 0,
  }));
  for (const ctx of ctxs) siteBridges(ctx);
  for (const ctx of ctxs) { tunnels.push(...ctx.list); ctx.list.length = 0; }
  for (const ctx of ctxs) {
    siteFans(ctx);
    tunnels.push(...ctx.list);
    ctx.list.length = 0;
  }
}

// Sliced twin of buildTunnelDescriptors: identical trials in identical order
// (see siteBridgesAsync), only the attempt sweeps yield. Returns false on
// abort, true otherwise.
async function buildTunnelDescriptorsAsync(isAborted) {
  const tick = () => new Promise((r) => requestAnimationFrame(r));
  tunnels = [];
  ringCells = new Set();
  const ctxs = volcanoes.map((v, vi) => ({
    v, vi, minD: v.craterR + 1, toCentre: Math.atan2(-v.z, -v.x),
    usedH: new Set(), usedCells: new Set(), usedAir: new Set(),
    dirs: [], list: [], groundCount: 0,
  }));
  for (const ctx of ctxs) {
    if (!await siteBridgesAsync(ctx, tick, isAborted)) return false;
  }
  for (const ctx of ctxs) { tunnels.push(...ctx.list); ctx.list.length = 0; }
  for (const ctx of ctxs) {
    if (!await siteFansAsync(ctx, tick, isAborted)) return false;
    tunnels.push(...ctx.list);
    ctx.list.length = 0;
  }
  return !(isAborted && isAborted());
}

function volcanoHelpers(ctx) {
    const { v, vi, minD, usedH, usedCells, usedAir, dirs, list } = ctx;
    const angDiff = (a, b) => {
      let d = Math.abs(a - b);
      while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
      return d;
    };
    const inPad = (x, z) => inReturnPad(x, z);
    const tryMouth = (dir, h) => {
      if (usedH.has(h)) return false;
      for (const d of dirs) if (angDiff(d, dir) < MOUTH_SEP) return false;
      const t = makeTunnel(v, vi, dir, h, minD);
      if (!t || !mouthInBounds(t) || !courseClearance(v, t)) return false;
      if (boreBlocked(t, list)) return false;
      // The frame must own distinct cells: a collision would narrow it and
      // stick a glowstone pier into its own doorway.
      const cells = frameCells(t);
      if (new Set(cells).size !== cells.length) return false;
      if (!checkReservations(t, cells)) return false;
      addReservations(t, cells);
      usedH.add(h);
      dirs.push(dir);
      list.push(t);
      for (const c of frameCells(t)) ringCells.add(c);
      return true;
    };
    // Shared footprint checks, generic over any accepted tube.
    const checkReservations = (t, cells) => {
      for (const c of cells) {
        if (usedCells.has(c)) return false;
        const [x, y, z] = c.split(",").map(Number);
        // No frame in reserved airspace or on the pad.
        if (usedAir.has(x + "," + y + "," + z) || inPad(x, z)) return false;
      }
      for (let d = t.bore0; d <= t.dOut; d++) {
        for (let off = -4; off <= 3; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          for (let y = t.plat + 1; y <= t.plat + 6; y++) {
            if (usedCells.has(wx + "," + y + "," + wz)) return false;
          }
        }
      }
      for (let d = t.dOut + 1; d <= t.exitD + CORRIDOR_MARGIN; d++) {
        for (let off = -5; off <= 4; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          for (let y = t.plat + 1; y <= t.plat + 7; y++) {
            if (usedCells.has(wx + "," + y + "," + wz)) return false;
          }
        }
      }
      // Sill sight row from the frame plane: the same lattice rows at sill
      // level, so no later frame lands where the sill reads from.
      for (let d = t.dOut + 1; d <= t.exitD; d++) {
        for (let off = -4; off <= 3; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          if (usedCells.has(wx + "," + t.plat + "," + wz)) return false;
        }
      }
      for (let d = t.dOut - 2; d <= t.dOut + 2; d++) {
        for (let off = -4; off <= 3; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          for (let y = t.plat; y <= t.plat + 9; y++) {
            if (usedCells.has(wx + "," + y + "," + wz)) return false;
          }
        }
      }
      return true;
    };
    const addReservations = (t, cells) => {
      for (const c of cells) usedCells.add(c);
      // The paved doorstep reads as built rock: later bores, corridors and
      // frames veto any touch, like any reserved cell.
      for (const k of t.doorstep) usedCells.add(k);
      for (const c of cells) {
        const [x, y, z] = c.split(",").map(Number);
        usedCells.add(x + "," + (y - 1) + "," + z);
      }
      // The rock collar reads as built rock: later mouths veto any
      // bore, corridor or frame touching it, like any reserved cell.
      for (const k of frameCollarKeys(t)) usedCells.add(k);
      for (let d = t.bore0; d <= t.dOut; d++) {
        for (let off = -4; off <= 3; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          for (let y = t.plat + 1; y <= t.plat + 6; y++) usedAir.add(wx + "," + y + "," + wz);
        }
      }
      for (let d = t.dOut + 1; d <= t.exitD + CORRIDOR_MARGIN; d++) {
        for (let off = -5; off <= 4; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          for (let y = t.plat + 1; y <= t.plat + 7; y++) usedAir.add(wx + "," + y + "," + wz);
        }
      }
      for (let d = t.dOut + 1; d <= t.exitD; d++) {
        for (let off = -4; off <= 3; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          usedAir.add(wx + "," + t.plat + "," + wz);
        }
      }
      for (let d = t.dOut - 2; d <= t.dOut + 2; d++) {
        for (let off = -4; off <= 3; off++) {
          const [wx, wz] = planeCell(v, t, d, off);
          for (let y = t.plat; y <= t.plat + 9; y++) usedAir.add(wx + "," + y + "," + wz);
        }
      }
    };
    // Ground bridges: three low tubes per volcano, one per arc sector
    // (left, centre, right) — each landing on a shelf islet grown jointly
    // under the tip, or right on flat island relief. Placed before the fan
    // so the fan routes around them.
    const acceptBridge = (t, own, carve = false) => {
      if (!t || !mouthInBounds(t) || !courseClearance(v, t)) return false;
      // Own territory only: no bridge envelope may cross into another
      // volcano's half. The return pad is inviolable: no envelope may touch
      // it, so neither carve, corridor clearing nor masonry can reach it.
      const [tx, tz] = planeCell(v, t, t.dOut, 0);
      for (const u of volcanoes) {
        if (u === v) continue;
        if (Math.hypot(tx - u.x, tz - u.z) < Math.hypot(tx - v.x, tz - v.z)) return false;
      }
      if (tubeHitsPad(t)) return false;
      // Outside the cone the walkway and corridor never touch island rock:
      // low bridges route around fbm relief instead of carving it. (Inside
      // the cone the bore carves through by design.) The own shelf reads at
      // plat - 1, so it passes. Carve fallback only: the corridor may slice
      // island rock to guarantee the third bridge — lava, pad, bands and
      // frames stay untouched either way.
      if (!carve) {
        for (let d = Math.max(t.bore0, v.radius + 1); d <= t.apronEnd; d++) {
          for (let off = -5; off <= 4; off++) {
            const [wx, wz] = planeCell(v, t, d, off);
            if (!inWorld(wx, wz)) continue;
            if (topAt(wx, wz) > t.plat - 1) return false;
          }
        }
      } else {
        t.carvedCorridor = true;
      }
      if (boreBlocked(t, list)) return false;
      // A bridge touches only its own shelf islet, never another's rock.
      for (const s of islets) {
        if (s === own) continue;
        if (tubeHitsDisc(t, s.x, s.z, s.r, s.top)) return false;
      }
      const cells = frameCells(t);
      if (new Set(cells).size !== cells.length) return false;
      if (!checkReservations(t, cells)) return false;
      addReservations(t, cells);
      dirs.push(t.dir);
      list.push(t);
      for (const c of frameCells(t)) ringCells.add(c);
      ctx.groundCount++;
      return true;
    };
  return { angDiff, tryMouth, acceptBridge };
}

function siteBridges(ctx) {
  const { v, vi, minD, toCentre, dirs, list } = ctx;
  const { angDiff, acceptBridge } = volcanoHelpers(ctx);
  const kOf = () => FAN_TUNNELS + GROUND_BRIDGES + ctx.groundCount;
  // One attempt: the pipe lands either on a jointly grown shelf (open sea)
  // or right on flat island relief (0..10 above the sea, no shelf needed).
  // A failed shelf is rolled back, so orphans never clutter the sea.
  // Separation anneals to zero across phases; the exact vetoes (crossings,
  // reservations, distinct frame cells) still forbid any real overlap.
  const tryDir = (dir, salt, att, sep, carve = false) => {
    for (const d of dirs) if (angDiff(d, dir) < sep) return false;
    const k = kOf();
    const tipD = Math.round(v.radius + TIP_OVERHANG_MIN + draw(salt + 11, att) * (TIP_OVERHANG_MAX - TIP_OVERHANG_MIN));
    const r = makeHeading(dir);
    let tMin = Infinity, tMax = -Infinity;
    for (let off = -4; off <= 3; off++) {
      const [wx, wz] = planeCell(v, r, tipD, off);
      if (!inWorld(wx, wz)) return false;
      const top = topAt(wx, wz);
      if (top < tMin) tMin = top;
      if (top > tMax) tMax = top;
    }
    if (tMax <= NETHER_FIRE_LEVEL) {
      // Open water: grow a shelf under the tip.
      const plat = NETHER_FIRE_LEVEL + 2 + Math.floor(draw(salt + 13, att) * 2);
      const sr = 6 + Math.floor(draw(salt + 17, att) * 6);
      const cx = Math.round(v.x + Math.cos(dir) * (tipD + 1));
      const cz = Math.round(v.z + Math.sin(dir) * (tipD + 1));
      const s = tryAddIslet(cx, cz, sr, plat - 1, list);
      if (!s) return false;
      const t = finishTunnel(v, vi, dir, r, k, minD, plat, tipD);
      if (!t || !acceptBridge(t, s, carve)) { dropIslet(s); return false; }
      return true;
    }
    // Natural landing: flat island relief doubles as the floor.
    if (tMax - tMin > 2 || tMax > NETHER_FIRE_LEVEL + 10) return false;
    const t = finishTunnel(v, vi, dir, r, k, minD, tMax + 1, tipD);
    return t ? acceptBridge(t, null, carve) : false;
  };
  for (let slot = 0; slot < GROUND_BRIDGES && ctx.groundCount < GROUND_BRIDGES; slot++) {
    const sector = (slot - (GROUND_BRIDGES - 1) / 2) * (2 / GROUND_BRIDGES);
    const salt = vi * 701 + 3 + slot * 50;
    for (let att = 0; att < 200 && ctx.groundCount < GROUND_BRIDGES; att++) {
      const dir = toCentre + (sector + (draw(salt, att) - 0.5) * (2 / GROUND_BRIDGES)) * MOUTH_ARC;
      if (tryDir(dir, salt, att, MOUTH_SEP)) break;
    }
  }
  // Full-arc sweeps until three bridges stand: strict re-site only, never
  // clamped — separation anneals (half, then none) so crowded seas still
  // fill all three slots through the exact vetoes alone.
  for (let att = 0; att < 2000 && ctx.groundCount < GROUND_BRIDGES; att++) {
    const dir = toCentre + (draw(vi * 701 + 999, att) * 2 - 1) * MOUTH_ARC;
    tryDir(dir, vi * 701 + 999, att, MOUTH_SEP / 2);
  }
  for (let att = 0; att < 2000 && ctx.groundCount < GROUND_BRIDGES; att++) {
    const dir = toCentre + (draw(vi * 701 + 977, att) * 2 - 1) * MOUTH_ARC;
    tryDir(dir, vi * 701 + 977, att, 0);
  }
  // Last resort: carve a corridor through island rock (lava, pad, bands,
  // frames and other tubes stay vetoed exactly as before) so no volcano
  // ever stands fewer than three bridges.
  for (let att = 0; att < 2000 && ctx.groundCount < GROUND_BRIDGES; att++) {
    const dir = toCentre + (draw(vi * 701 + 955, att) * 2 - 1) * MOUTH_ARC;
    tryDir(dir, vi * 701 + 955, att, 0, true);
  }
}

// Sliced twin of siteBridges: the trial bodies below are verbatim copies —
// same draws, same order, same acceptances (failures mutate nothing: a failed
// shelf is rolled back, vetoes only record on success). Only the sweep loops
// yield (every 200 attempts) and check the abort. Returns false on abort.
async function siteBridgesAsync(ctx, tick, isAborted) {
  const { v, vi, minD, toCentre, dirs, list } = ctx;
  const { angDiff, acceptBridge } = volcanoHelpers(ctx);
  const kOf = () => FAN_TUNNELS + GROUND_BRIDGES + ctx.groundCount;
  const tryDir = (dir, salt, att, sep, carve = false) => {
    for (const d of dirs) if (angDiff(d, dir) < sep) return false;
    const k = kOf();
    const tipD = Math.round(v.radius + TIP_OVERHANG_MIN + draw(salt + 11, att) * (TIP_OVERHANG_MAX - TIP_OVERHANG_MIN));
    const r = makeHeading(dir);
    let tMin = Infinity, tMax = -Infinity;
    for (let off = -4; off <= 3; off++) {
      const [wx, wz] = planeCell(v, r, tipD, off);
      if (!inWorld(wx, wz)) return false;
      const top = topAt(wx, wz);
      if (top < tMin) tMin = top;
      if (top > tMax) tMax = top;
    }
    if (tMax <= NETHER_FIRE_LEVEL) {
      // Open water: grow a shelf under the tip.
      const plat = NETHER_FIRE_LEVEL + 2 + Math.floor(draw(salt + 13, att) * 2);
      const sr = 6 + Math.floor(draw(salt + 17, att) * 6);
      const cx = Math.round(v.x + Math.cos(dir) * (tipD + 1));
      const cz = Math.round(v.z + Math.sin(dir) * (tipD + 1));
      const s = tryAddIslet(cx, cz, sr, plat - 1, list);
      if (!s) return false;
      const t = finishTunnel(v, vi, dir, r, k, minD, plat, tipD);
      if (!t || !acceptBridge(t, s, carve)) { dropIslet(s); return false; }
      return true;
    }
    // Natural landing: flat island relief doubles as the floor.
    if (tMax - tMin > 2 || tMax > NETHER_FIRE_LEVEL + 10) return false;
    const t = finishTunnel(v, vi, dir, r, k, minD, tMax + 1, tipD);
    return t ? acceptBridge(t, null, carve) : false;
  };
  let slice = 0;
  for (let slot = 0; slot < GROUND_BRIDGES && ctx.groundCount < GROUND_BRIDGES; slot++) {
    const sector = (slot - (GROUND_BRIDGES - 1) / 2) * (2 / GROUND_BRIDGES);
    const salt = vi * 701 + 3 + slot * 50;
    for (let att = 0; att < 200 && ctx.groundCount < GROUND_BRIDGES; att++) {
      const dir = toCentre + (sector + (draw(salt, att) - 0.5) * (2 / GROUND_BRIDGES)) * MOUTH_ARC;
      if (tryDir(dir, salt, att, MOUTH_SEP)) break;
      if (++slice % 200 === 0) {
        if (isAborted && isAborted()) return false;
        await tick();
      }
    }
  }
  // Full-arc sweeps until three bridges stand: strict re-site only, never
  // clamped — separation anneals (half, then none) so crowded seas still
  // fill all three slots through the exact vetoes alone.
  for (let att = 0; att < 2000 && ctx.groundCount < GROUND_BRIDGES; att++) {
    const dir = toCentre + (draw(vi * 701 + 999, att) * 2 - 1) * MOUTH_ARC;
    tryDir(dir, vi * 701 + 999, att, MOUTH_SEP / 2);
    if (++slice % 200 === 0) {
      if (isAborted && isAborted()) return false;
      await tick();
    }
  }
  for (let att = 0; att < 2000 && ctx.groundCount < GROUND_BRIDGES; att++) {
    const dir = toCentre + (draw(vi * 701 + 977, att) * 2 - 1) * MOUTH_ARC;
    tryDir(dir, vi * 701 + 977, att, 0);
    if (++slice % 200 === 0) {
      if (isAborted && isAborted()) return false;
      await tick();
    }
  }
  // Last resort: carve a corridor through island rock (lava, pad, bands,
  // frames and other tubes stay vetoed exactly as before) so no volcano
  // ever stands fewer than three bridges.
  for (let att = 0; att < 2000 && ctx.groundCount < GROUND_BRIDGES; att++) {
    const dir = toCentre + (draw(vi * 701 + 955, att) * 2 - 1) * MOUTH_ARC;
    tryDir(dir, vi * 701 + 955, att, 0, true);
    if (++slice % 200 === 0) {
      if (isAborted && isAborted()) return false;
      await tick();
    }
  }
  return true;
}

function siteFans(ctx) {
  const { vi, toCentre } = ctx;
  const { tryMouth } = volcanoHelpers(ctx);
  const shuffle = (arr, salt) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(draw(vi * 131 + salt, i) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const heights = shuffle([...Array(FAN_TUNNELS + 2).keys()].slice(2), 77);
  // Stratified fan: one mouth per arc tenth, round-robin over shuffled
  // heights — uniform spread without the full-arc rejection budget.
  const order = shuffle([...Array(FAN_TUNNELS).keys()], 913);
  let hi = 0, fanCount = 0;
  for (const sector of order) {
    for (let att = 0; att < 60 && fanCount < FAN_TUNNELS; att++) {
      const dir = toCentre + ((sector + draw(vi * 101 + 11, sector * 60 + att)) / FAN_TUNNELS * 2 - 1) * MOUTH_ARC;
      const h = heights[hi % heights.length];
      if (tryMouth(dir, h)) { hi++; fanCount++; break; }
    }
    if (fanCount >= FAN_TUNNELS) break;
  }
  // Full-arc top-up: strict re-site only, so short sectors still fill to ten.
  for (let att = 0; att < 1500 && fanCount < FAN_TUNNELS; att++) {
    const dir = toCentre + (draw(vi * 101 + 977, att) * 2 - 1) * MOUTH_ARC;
    const h = heights[hi % heights.length];
    if (tryMouth(dir, h)) { hi++; fanCount++; }
  }
}

// Sliced twin of siteFans: same trials in the same order (failures mutate
// nothing: reservations record on success only), yielding every 200 attempts.
// Returns false on abort, true otherwise.
async function siteFansAsync(ctx, tick, isAborted) {
  const { vi, toCentre } = ctx;
  const { tryMouth } = volcanoHelpers(ctx);
  const shuffle = (arr, salt) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(draw(vi * 131 + salt, i) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const heights = shuffle([...Array(FAN_TUNNELS + 2).keys()].slice(2), 77);
  // Stratified fan: one mouth per arc tenth, round-robin over shuffled
  // heights — uniform spread without the full-arc rejection budget.
  const order = shuffle([...Array(FAN_TUNNELS).keys()], 913);
  let hi = 0, fanCount = 0, slice = 0;
  for (const sector of order) {
    for (let att = 0; att < 60 && fanCount < FAN_TUNNELS; att++) {
      const dir = toCentre + ((sector + draw(vi * 101 + 11, sector * 60 + att)) / FAN_TUNNELS * 2 - 1) * MOUTH_ARC;
      const h = heights[hi % heights.length];
      if (tryMouth(dir, h)) { hi++; fanCount++; break; }
      if (++slice % 200 === 0) {
        if (isAborted && isAborted()) return false;
        await tick();
      }
    }
    if (fanCount >= FAN_TUNNELS) break;
  }
  // Full-arc top-up: strict re-site only, so short sectors still fill to ten.
  for (let att = 0; att < 1500 && fanCount < FAN_TUNNELS; att++) {
    const dir = toCentre + (draw(vi * 101 + 977, att) * 2 - 1) * MOUTH_ARC;
    const h = heights[hi % heights.length];
    if (tryMouth(dir, h)) { hi++; fanCount++; }
    if (++slice % 200 === 0) {
      if (isAborted && isAborted()) return false;
      await tick();
    }
  }
  return true;
}

// The new mouth must not touch accepted works: no lava in its walkway, no
// bore, corridor, shell or glowstone cell shared with another tube, and no
// frame cell inside another tube's airspace. `rest` holds the current
// volcano's accepted list (not yet merged into `tunnels`).
function boreBlocked(t, rest) {
  const v = t.v;
  // Lava-free walkway from the crater edge to the mouth: no band may cross
  // the full-width walk box anywhere on the path, so the bore extension
  // always reaches bare shaft lava (the shaft itself is not a band and never
  // vetoes).
  for (let d = v.craterR; d <= t.dOut; d++) {
    for (let off = -4; off <= 3; off++) {
      const [wx, wz] = planeCell(v, t, d, off);
      for (let y = t.plat + 1; y <= t.plat + 6; y++) {
        if (ringCells.has(wx + "," + y + "," + wz)) return true;
      }
      if (!inCascadeBand(wx, wz)) continue;
      for (const vv of volcanoes) {
        for (const c of vv.courses) {
          const span = courseSpanAt(vv, c, wx, wz);
          if (span && span[0] <= t.plat + 6 && t.plat + 1 <= span[1]) return true;
        }
      }
    }
  }
  // Exact crossing veto, same classifier as construction: a new bore,
  // corridor or shell cell never touches another tube's interior, corridor,
  // shell rock or frame, so shells are never skipped and walkways never
  // cross. Box overlap first, exact cells only on contact.
  for (const u of tunnels) {
    if (u === t) continue;
    if (boxesOverlap(t.bounds, u.bounds) && tubesCross(t, u)) return true;
  }
  for (const u of rest) {
    if (u === t) continue;
    if (boxesOverlap(t.bounds, u.bounds) && tubesCross(t, u)) return true;
  }
  for (const c of frameCells(t)) {
    const [x, y, z] = c.split(",").map(Number);
    if (y < t.plat || y > t.plat + 7) continue;
    // Mouth-sized ring lands as glowstone: never punch another tube's shell,
    // airspace or frame.
    for (const u of tunnels) {
      if (u !== t && (tubeInteriorAt(u, x, y, z) || tubeCorridorAt(u, x, y, z) ||
          tubeShellAt(u, x, y, z))) return true;
    }
    for (const u of rest) {
      if (u !== t && (tubeInteriorAt(u, x, y, z) || tubeCorridorAt(u, x, y, z) ||
          tubeShellAt(u, x, y, z))) return true;
    }
  }
  // The doorstep paves rock: never narrow another tube's walkway or corridor.
  for (const c of t.doorstep) {
    const [x, y, z] = c.split(",").map(Number);
    for (const u of tunnels) {
      if (u !== t && (tubeInteriorAt(u, x, y, z) || tubeCorridorAt(u, x, y, z))) return true;
    }
    for (const u of rest) {
      if (u !== t && (tubeInteriorAt(u, x, y, z) || tubeCorridorAt(u, x, y, z))) return true;
    }
  }
  return false;
}

function buildReturnPlatform() {
  const base = NETHER_RETURN_BASE_Y;
  returnPad = { base, x0: -5, x1: 5, z0: -5, z1: 5 };
  for (let x = returnPad.x0; x <= returnPad.x1; x++) {
    for (let z = returnPad.z0; z <= returnPad.z1; z++) {
      for (let y = base - 2; y < base; y++) protectCell(x, y, z, "nether");
    }
  }
  returnFrameKeys = [];
  for (let x = -2; x <= 2; x++) {
    for (let y = 0; y <= 3; y++) {
      const edge = Math.abs(x) === 2 || y === 0 || y === 3;
      if (!edge) continue;
      const by = base + y;
      protectCell(x, by, NETHER_RETURN_Z, "nether");
      returnFrameKeys.push(key(x, by, NETHER_RETURN_Z));
    }
  }
}

function resetNetherState(newSeed) {
  setDimension("nether");
  resetWorld("nether");
  netherSeed = newSeed;
  netherRiverPaths = [];
  volcanoes = [];
  tunnels = [];
  islets = [];
  returnFrameKeys = [];
  returnPad = null;
  ringCells = new Set();
  netherReady = false;
  generatedChunks.clear();
  glowDirty = false;
  landCache.fill(NaN);
  topCache.fill(NaN);
  riverT.fill(-1);
  riverScore.fill(Infinity);
  cascadeMask.fill(0);
}

// Setup as one entry per pass, shared by the sync reference and the sliced
// paths so every entry builds identical voxels. Sliced callers yield between
// stages (first-visit travel would otherwise freeze the spiral mid-spin on
// this single block); the tunnel-siting entry additionally slices within its
// attempt sweeps via the async twin below (the draw RNG is pure-hash, so
// interspersed yields cannot change a single trial outcome).
function netherSetupStages() {
  return [
    { key: "rivers", run: generateNetherRivers },
    { key: "carve", run: buildRiverCarve },
    { key: "volcanoes", run: generateVolcanoes },
    { key: "courses", run: () => { for (const v of volcanoes) buildCourses(v); } },
    { key: "cascade", run: buildCascadeMask },
    { key: "platform", run: buildReturnPlatform },
    { key: "tunnels", run: buildTunnelDescriptors, runAsync: (abort) => buildTunnelDescriptorsAsync(abort) },
    // Materialize the return pad immediately: direct boot spawns on it before
    // the mesher requests a single chunk, so the floor must not depend on chunk
    // generation order. Per-chunk applies below remain idempotent.
    { key: "pad", run: () => applyReturnPlatform(-5, 5, -5, 5) },
  ];
}

function setupNether(newSeed) {
  resetNetherState(newSeed);
  for (const stage of netherSetupStages()) stage.run();
  netherReady = true;
}

// Staged async driver for the sliced paths (prepare + full async twin):
// same stages, same order as setupNether, yielding between them.
async function runSetupStagesAsync(isAborted) {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  for (const stage of netherSetupStages()) {
    if (isAborted && isAborted()) return false;
    if (stage.runAsync) {
      if (!await stage.runAsync(isAborted)) return false;
    } else stage.run();
    await raf();
  }
  netherReady = true;
  return true;
}

const sameChunk = (wx, wz, x0, x1, z0, z1) =>
  wx >= x0 && wx <= x1 && wz >= z0 && wz <= z1;

function generateNetherChunk(cx, cz) {
  const x0 = Math.max(cx * CHUNK, -S);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, S);
  const z0 = Math.max(cz * CHUNK, -S);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, S);
  if (x0 > x1 || z0 > z1) return;

  // Terrain, closed cone shell, lava sea and soul-sand shores.
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const h = landHeightCached(x, z);
      const top = topAt(x, z);
      fillColumn(x, z, 0, h, NETHERRACK);
      if (top > h) {
        // The shell reaches down to the lowest nearby surface; three layers
        // leave one rock behind every cascade lava cell and close the boundary.
        const sb = Math.max(h + 1, minTop5(x, z) - (SHELL_DEPTH - 1));
        fillColumn(x, z, sb, top, NETHERRACK);
      }
      if (top < NETHER_FIRE_LEVEL) {
        fillColumn(x, z, top + 1, NETHER_FIRE_LEVEL, LAVA);
        // Lava streaks down sea cliffs: a tall 4-neighbour pours a short
        // fall onto this water column. Per-column rule (reads only), so
        // chunk order never matters.
        let nb = -1;
        if (inWorld(x + 1, z)) nb = Math.max(nb, topAt(x + 1, z));
        if (inWorld(x - 1, z)) nb = Math.max(nb, topAt(x - 1, z));
        if (inWorld(x, z + 1)) nb = Math.max(nb, topAt(x, z + 1));
        if (inWorld(x, z - 1)) nb = Math.max(nb, topAt(x, z - 1));
        if (nb >= NETHER_FIRE_LEVEL + 5) {
          const n = Math.min(5, Math.round((nb - NETHER_FIRE_LEVEL) * 0.45));
          fillColumn(x, z, NETHER_FIRE_LEVEL + 1, NETHER_FIRE_LEVEL + n, LAVA);
        }
      } else if (top <= NETHER_FIRE_LEVEL + 2) {
        setBlock(x, top, z, SOULSAND);
      }
    }
  }

  // Central solid cores, their lava shafts, and the lava crown: a flush
  // lava lip all around the crater mouth, so lava pours from the top at
  // every angle and the bands start without a rock step.
  for (const v of volcanoes) {
    const coreR = v.craterR + 3;
    const rim = Math.round(v.rim);
    const cx0 = Math.max(x0, v.x - coreR), cx1 = Math.min(x1, v.x + coreR);
    const cz0 = Math.max(z0, v.z - coreR), cz1 = Math.min(z1, v.z + coreR);
    if (cx0 > cx1 || cz0 > cz1) continue;
    for (let x = cx0; x <= cx1; x++) {
      for (let z = cz0; z <= cz1; z++) {
        const dx = x - v.x, dz = z - v.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > coreR * coreR) continue;
        fillColumn(x, z, 1, rim, NETHERRACK);
        if (d2 <= v.craterR * v.craterR) fillColumn(x, z, v.baseY, rim, LAVA);
        else fillColumn(x, z, rim - 1, rim, LAVA);
      }
    }
  }

  // Lava bands: constant-section curtains down the cone, pouring two cells
  // into the sea at lava level.
  for (const v of volcanoes) {
    const bx0 = Math.max(x0, v.x - v.radius - 60), bx1 = Math.min(x1, v.x + v.radius + 60);
    const bz0 = Math.max(z0, v.z - v.radius - 60), bz1 = Math.min(z1, v.z + v.radius + 60);
    if (bx0 > bx1 || bz0 > bz1) continue;
    for (let x = bx0; x <= bx1; x++) {
      for (let z = bz0; z <= bz1; z++) {
        for (const c of v.courses) {
          const span = courseSpanAt(v, c, x, z);
          if (span) fillColumn(x, z, span[0], span[1], LAVA);
        }
      }
    }
  }

  // Return platform before the tunnels: corridors clear pad rock from their
  // path in the same pass. Tunnel envelopes never reach the pad (see
  // tubeHitsPad), so the pad never refills a corridor.
  applyReturnPlatform(x0, x1, z0, z1);

  // Tunnels in three phases per chunk: first every bore and corridor is
  // cleared, then every shell, rock collar and doorstep is sealed, then
  // every frame is placed last. Shells only fill air or lava outside the shaft (never an
  // interior, a frame, the pad or another tube's interior), so the last
  // word is always open walkways, solid 2-thick (1-thick exposed) shells
  // and fully exposed rings. The frame sits glued at the wall face, rock
  // tight everywhere but its cleared front face.
  for (const t of tunnels) {
    if (x1 < t.bounds.x0 || x0 > t.bounds.x1 || z1 < t.bounds.z0 || z0 > t.bounds.z1) continue;
    carveTunnelBore(t, x0, x1, z0, z1);
    clearTunnelCorridor(t, x0, x1, z0, z1);
  }
  for (const t of tunnels) {
    if (x1 < t.bounds.x0 || x0 > t.bounds.x1 || z1 < t.bounds.z0 || z0 > t.bounds.z1) continue;
    sealTunnelShell(t, x0, x1, z0, z1);
    sealFrameCollar(t, x0, x1, z0, z1);
    sealDoorstep(t, x0, x1, z0, z1);
  }
  for (const t of tunnels) {
    if (x1 < t.bounds.x0 || x0 > t.bounds.x1 || z1 < t.bounds.z0 || z0 > t.bounds.z1) continue;
    placeFrame(t, x0, x1, z0, z1);
  }
}

// Shared frame writer (idempotent: same cells, same hue): the glowstone edge
// of the mouth-column block — full-height jambs on the first/last columns,
// sill and lintel rows across — plus a one-cell rock threshold under the
// sill so the glued frame never floats when the natural ground dips in
// front of the wall.
function placeFrame(t, x0, x1, z0, z1) {
  const cols = t.cols ?? mouthCols(t);
  const frame = (wx, wz, yy) => {
    if (!sameChunk(wx, wz, x0, x1, z0, z1)) return;
    setBlock(wx, yy, wz, GLOWSTONE);
    noteGlowstonePlaceShared(wx, yy, wz, t.doorV);
    glowDirty = true;
  };
  cols.forEach(([wx, wz], i) => {
    const jamb = i === 0 || i === cols.length - 1;
    for (let yy = t.plat; yy <= t.plat + 7; yy++) {
      if (jamb || yy === t.plat || yy === t.plat + 7) frame(wx, wz, yy);
    }
  });
  for (const [wx, wz] of cols) {
    if (!sameChunk(wx, wz, x0, x1, z0, z1)) continue;
    if (getBlock(wx, t.plat - 1, wz) === AIR) setBlock(wx, t.plat - 1, wz, NETHERRACK);
  }
}

// Bore: carve the analytic interior band world column by world column, so
// nothing — stone or liquid — can ever block the walkway, and no rock fin
// survives inside it on any heading. Glowstone (other frames) and obsidian
// stay untouched, so neighbouring features survive the carve. Inside the
// central shaft the column's own lava is kept: the bore opens onto bare
// lava instead of quarrying through it.
function carveTunnelBore(t, x0, x1, z0, z1) {
  const v = t.v;
  const { bore0, dOut, plat } = t;
  const lx0 = Math.max(x0, t.bounds.x0), lx1 = Math.min(x1, t.bounds.x1);
  const lz0 = Math.max(z0, t.bounds.z0), lz1 = Math.min(z1, t.bounds.z1);
  for (let wx = lx0; wx <= lx1; wx++) {
    for (let wz = lz0; wz <= lz1; wz++) {
      const rx = wx - v.x, rz = wz - v.z;
      const d = rx * t.dx + rz * t.dz;
      if (d < bore0 || d > dOut) continue;
      const f = rx * t.mx + rz * t.mz + 4;
      if (f < 0 || f >= 8) continue;
      const inShaft = rx * rx + rz * rz <= v.craterR * v.craterR;
      for (let y = plat + 1; y <= plat + 6; y++) {
        const cur = getBlock(wx, y, wz);
        if (cur === GLOWSTONE || cur === OBSIDIAN) continue;
        if (cur === LAVA && inShaft) continue;
        if (cur !== AIR) setBlock(wx, y, wz, AIR);
      }
    }
  }
}

// View corridor: clear every rock cell above the ring base from the frame to
// open sky (plus the approach apron past the exit), so the whole ring reads
// from the approach. Ten wide up to the exit with the sill sight row, so no
// rock tooth beside a jamb and no ground hiding the sill survives facing the
// doorway. Lava and glowstone are never touched; the sweep reads the actual
// stacked column, so shells, cores and neighbour envelopes cannot leave rock
// above the corridor.
function clearTunnelCorridor(t, x0, x1, z0, z1) {
  const v = t.v;
  const { dOut, exitD, apronEnd, plat } = t;
  const lx0 = Math.max(x0, t.bounds.x0), lx1 = Math.min(x1, t.bounds.x1);
  const lz0 = Math.max(z0, t.bounds.z0), lz1 = Math.min(z1, t.bounds.z1);
  for (let wx = lx0; wx <= lx1; wx++) {
    for (let wz = lz0; wz <= lz1; wz++) {
      if (!inWorld(wx, wz)) continue;
      const rx = wx - v.x, rz = wz - v.z;
      const d = rx * t.dx + rz * t.dz;
      if (d <= dOut || d > apronEnd) continue;
      const f = rx * t.mx + rz * t.mz + 4;
      const wide = d <= exitD;
      if (wide ? (f < -1 || f >= 9) : (f < 0 || f >= 8)) continue;
      // Inside the flank clear up to the surface (open-topped shaft); past
      // the exit only the 8-ring-height band needs to stay open.
      let top = d <= exitD ? topAt(wx, wz) : plat + 8;
      if (returnPad && wx >= returnPad.x0 && wx <= returnPad.x1 && wz >= returnPad.z0 && wz <= returnPad.z1) {
        top = Math.max(top, returnPad.base + 4);
      }
      let yTop = Math.max(top, plat + 7);
      if (d <= exitD) {
        let y = yTop + 1;
        while (y <= plat + 60) {
          const b = getBlock(wx, y, wz);
          if (b !== NETHERRACK && b !== SOULSAND) break;
          y++;
        }
        yTop = y - 1;
      }
      // Sill sight row from the frame plane: clear down to plat so no ground
      // hides the sill from the approach. Disjoint by level from the lowered
      // doorstep (plat - 1) below, which stays paved.
      const yStart = d > dOut && d <= exitD && f >= 0 && f < 8 ? plat : plat + 1;
      for (let y = yStart; y <= yTop; y++) {
        const cur = getBlock(wx, y, wz);
        if (cur === NETHERRACK || cur === SOULSAND) setBlock(wx, y, wz, AIR);
      }
    }
  }
}

// Shell: 2-thick rock while buried (solid floor, no void in any wall or
// roof), 1-thick past thinFrom (floor plat, roof plat+7, one column per
// side). Only air or lava outside the shaft is ever filled; glowstone,
// obsidian, frames, the pad, the shaft and other tubes' interiors are never
// touched. Interior and shell are one partition, so no rock ever lands inside
// the walkway and no gap ever survives beside it. Past the frame the approach
// keeps its natural ground. The only openings are the frame doorway itself
// and the lava face.
function sealTunnelShell(t, x0, x1, z0, z1) {
  const v = t.v;
  const { bore0, dOut, plat } = t;
  const lx0 = Math.max(x0, t.bounds.x0), lx1 = Math.min(x1, t.bounds.x1);
  const lz0 = Math.max(z0, t.bounds.z0), lz1 = Math.min(z1, t.bounds.z1);
  for (let wx = lx0; wx <= lx1; wx++) {
    for (let wz = lz0; wz <= lz1; wz++) {
      if (!inWorld(wx, wz) || inReturnPad(wx, wz, 0)) continue;
      const rx = wx - v.x, rz = wz - v.z;
      if (rx * rx + rz * rz <= v.craterR * v.craterR) continue;
      const d = rx * t.dx + rz * t.dz;
      if (d < bore0 - 3 || d > dOut) continue;
      const thin = d >= t.thinFrom;
      const f = rx * t.mx + rz * t.mz + 4;
      if (thin && (f < -1 || f >= 9)) continue;
      if (!thin && (f < -2 || f >= 10)) continue;
      // Partition: interior columns own floor + roof bands only, side walls
      // run full height (floor to roof, corners included). The second layer
      // (outer floor row, outer roof row, outer wall columns) is only laid
      // where buried — never a rock cap floating over the doorway, never a
      // side wing in open air — except where rock stands within one cell
      // sideways, which closes the slot between lining and hillside.
      const interior = f >= 0 && f < 8;
      const top = topAt(wx, wz);
      const clearOf = (wx, y, wz) => {
        if (ringCells.has(wx + "," + y + "," + wz)) return false;
        for (const u of tunnels) {
          // Airspace always wins: no shell rock ever lands in any tube's
          // walkway or view corridor (including the sill sight row).
          if (u !== t && (tubeInteriorAt(u, wx, y, wz) || tubeCorridorAt(u, wx, y, wz))) return false;
        }
        return true;
      };
      const yLo = thin ? plat : plat - 1;
      const yTop = interior ? plat : (thin ? plat + 7 : plat + 8);
      for (let y = yLo; y <= yTop; y++) {
        if (!clearOf(wx, y, wz)) continue;
        if ((y === plat - 1 || y === plat + 8 || f === -2 || f === 9) && y > top &&
            !touchesRockAt(wx, y, wz)) continue;
        const cur = getBlock(wx, y, wz);
        if (cur === AIR || cur === LAVA) setBlock(wx, y, wz, NETHERRACK);
      }
      if (interior) {
        for (let y = plat + 7; y <= (thin ? plat + 7 : plat + 8); y++) {
          if (!clearOf(wx, y, wz)) continue;
          if (y === plat + 8 && y > top && !touchesRockAt(wx, y, wz)) continue;
          const cur = getBlock(wx, y, wz);
          if (cur === AIR || cur === LAVA) setBlock(wx, y, wz, NETHERRACK);
        }
      }
    }
  }
}

// Rock collar around the ring: seal every face- and diagonal-neighbour of
// the frame that the shell trim may have skipped (stair corners on diagonal
// headings, outer layer above the analytic surface), so no vertical slot
// survives between the glowstone jambs and the rock. Above the doorway roof
// the natural-surface trim applies like the shell's (no floating cap over
// the opening). Only air or lava is ever filled — frames, walkways,
// corridors, the pad, the shaft and other tubes' airspace are never touched,
// and the doorway front stays open by construction.
function sealFrameCollar(t, x0, x1, z0, z1) {
  const v = t.v;
  for (const k of frameCollarKeys(t)) {
    const [wx, y, wz] = k.split(",").map(Number);
    if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
    if (!inWorld(wx, wz) || inReturnPad(wx, wz, 0)) continue;
    const rx = wx - v.x, rz = wz - v.z;
    if (rx * rx + rz * rz <= v.craterR * v.craterR) continue;
    if (ringCells.has(k)) continue;
    if (y > t.plat + 7 && y > topAt(wx, wz) && !touchesRockAt(wx, y, wz)) continue;
    let blocked = false;
    for (const u of tunnels) {
      if (u !== t && (tubeInteriorAt(u, wx, y, wz) || tubeCorridorAt(u, wx, y, wz))) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const cur = getBlock(wx, y, wz);
    // Shelf mouths stand on rock: the collar seals air and lava alike, so
    // the ring sits rock-tight on any heading.
    if (cur === AIR || cur === LAVA) setBlock(wx, y, wz, NETHERRACK);
  }
}

// Doorstep paving: the lowered floor row past the frame is always walkable
// rock, never a pit at the door — one below sill level so the glowstone sill
// reads over it from the approach. Only air is ever filled — frames,
// walkways, corridors, the pad, the shaft and other tubes' airspace are
// never touched.
function sealDoorstep(t, x0, x1, z0, z1) {
  const v = t.v;
  for (const k of t.doorstep) {
    const [wx, y, wz] = k.split(",").map(Number);
    if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
    if (!inWorld(wx, wz) || inReturnPad(wx, wz, 0)) continue;
    const rx = wx - v.x, rz = wz - v.z;
    if (rx * rx + rz * rz <= v.craterR * v.craterR) continue;
    if (ringCells.has(k)) continue;
    let blocked = false;
    for (const u of tunnels) {
      if (u !== t && (tubeInteriorAt(u, wx, y, wz) || tubeCorridorAt(u, wx, y, wz))) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    if (getBlock(wx, y, wz) === AIR) setBlock(wx, y, wz, NETHERRACK);
  }
}

function applyReturnPlatform(x0, x1, z0, z1) {
  if (!returnPad) return;
  const base = returnPad.base;
  const px0 = Math.max(x0, returnPad.x0), px1 = Math.min(x1, returnPad.x1);
  const pz0 = Math.max(z0, returnPad.z0), pz1 = Math.min(z1, returnPad.z1);
  if (px0 > px1 || pz0 > pz1) return;
  for (let x = px0; x <= px1; x++) {
    for (let z = pz0; z <= pz1; z++) {
      fillColumn(x, z, base - 2, base - 1, NETHERRACK);
      for (let y = base; y <= base + 4; y++) setBlock(x, y, z, AIR);
    }
  }
  for (let x = Math.max(px0, -2); x <= Math.min(px1, 2); x++) {
    for (let y = 0; y <= 3; y++) {
      if (Math.abs(x) !== 2 && y !== 0 && y !== 3) continue;
      setBlock(x, base + y, NETHER_RETURN_Z, OBSIDIAN);
    }
  }
}

// Called by the mesher before a chunk is built. The generated set makes the
// pass idempotent and keeps player edits intact across visits.
function ensureNetherChunk(cx, cz) {
  if (!netherReady) return false;
  const ck = cx + "_" + cz;
  if (generatedChunks.has(ck)) return false;
  generatedChunks.add(ck);
  generateNetherChunk(cx, cz);
  return true;
}

registerChunkSource("nether", ensureNetherChunk);

export function generateNetherDimension(newSeed) {
  setupNether(newSeed);
  for (let cz = -CHUNK_RADIUS; cz <= CHUNK_RADIUS; cz++) {
    for (let cx = -CHUNK_RADIUS; cx <= CHUNK_RADIUS; cx++) ensureNetherChunk(cx, cz);
  }
  return true;
}

// Full sliced twin, kept for the headless harness: same voxels as the sync
// reference, generated in the same chunk order.
export async function generateNetherDimensionAsync(newSeed, isAborted) {
  resetNetherState(newSeed);
  if (!await runSetupStagesAsync(isAborted)) return false;
  let done = 0;
  for (let cz = -CHUNK_RADIUS; cz <= CHUNK_RADIUS; cz++) {
    for (let cx = -CHUNK_RADIUS; cx <= CHUNK_RADIUS; cx++) {
      ensureNetherChunk(cx, cz);
      if (++done % 8 === 0) {
        if (isAborted && isAborted()) return false;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
  }
  if (isAborted && isAborted()) return false;
  return true;
}

// Boot path: derive the descriptors and materialize only the chunks around
// the return platform. The rest streams in through the chunk source. Setup
// stages yield between passes (same voxels as the sync reference, same
// order), so a first visit never holds one long block behind the spiral.
export async function prepareNetherDimensionAsync(newSeed, isAborted) {
  resetNetherState(newSeed);
  if (!await runSetupStagesAsync(isAborted)) return false;
  if (isAborted && isAborted()) return false;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  let n = 0;
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      ensureNetherChunk(cx, cz);
      if (++n % 3 === 0) {
        if (isAborted && isAborted()) return false;
        await raf();
      }
    }
  }
  return true;
}

export const __test = {
  netherLandHeight,
  volcanoHeightAt,
  get volcanoes() { return volcanoes; },
  get tunnels() { return tunnels; },
  get islets() { return islets; },
  get generatedChunks() { return generatedChunks; },
  get ringCells() { return ringCells; },
  courseSurfaceAt,
  courseSpanAt,
  tubeInteriorAt,
  tubeCorridorAt,
  tubeShellAt,
  frameCells,
  planeCell,
};
