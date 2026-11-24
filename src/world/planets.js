// Celestial bodies: the Moon (white entry) plus color planets on a shell
// band around the Moon center. Same aspect as the Moon (cratered rock disc +
// water lakes, same build via moon.js generic builders), with per-color
// rock/water ids. Only the Moon's surface builds with the world (spawn stands
// on it); planets stream in lazily in the background (see main.js), so
// startup pays for one body only. Planet colors are a seeded draw per index;
// positions are a seeded shell sample (deterministic per world seed).
import { AIR, MOON, MOON_WATER, PLANET_ROCKS, PLANET_WATERS, WATER } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import {
  WORLD_RADIUS, colOcc, colTopIdx, worlds, key,
  registerSkyFreeY,
} from "../core/store.js";
import { CLOUD_MAX_Y } from "./clouds.js";
import { ULTRA_BAND1_HI, ULTRA_BAND2_HI } from "./ultravol.js";

// Legacy Moon geometry, unchanged (same voxels as master, same salts).
export const MOON_R = WORLD_RADIUS;
export const MOON_THICK = 5;
export const MOON_MIN_Y = 850;
export const MOON_SURFACE_Y = MOON_MIN_Y + MOON_R;

// Planet shell band (fixed): centers sit at radius [BAND_R0, BAND_R1] from
// the Moon center with elevation >= BAND_MIN_EL_DEG degrees (upper sky only
// — regions, the Moon ultra cap, and the stream gate all assume planets
// live above the Moon). BAND_MIN_SEP_RATIO × planet diameter is the minimum
// center-to-center distance the sampler enforces; past the shell's
// separation capacity the sampler keeps placing best-effort (see
// sampleShellCenters).
export const MOON_CENTER_Y = Math.floor((MOON_MIN_Y + MOON_SURFACE_Y) / 2);
export const PLANET_R = MOON_R;
export const PLANET_THICK = MOON_THICK;
export const BAND_R0 = 8000;
export const BAND_R1 = 40000;
export const BAND_MIN_EL_DEG = 2;
export const BAND_MIN_SEP_RATIO = 10;
export const BAND_COUNT = 200;
// Planet band floor: the lowest a planet bottom can sit under the band (inner
// radius at minEl, minus the half-height dome), clamped to the Moon surface
// — every consumer (regions, the Moon ultra cap, the hotbar split, and the
// overworld mob XZ clamp ceiling) assumes
// the split plane stays above the Moon. Planet cylinders that poke below the
// clamp are classified by the regions' volume membership, never by the
// plane alone.
export const PLANET_MIN_Y = Math.max(
  MOON_SURFACE_Y,
  Math.floor(
    MOON_CENTER_Y + BAND_R0 * Math.sin(BAND_MIN_EL_DEG * Math.PI / 180) - PLANET_R / 2));
// Free sky: registered into store.js (space is open at all altitudes).
export const SKY_FREE_Y = MOON_SURFACE_Y - 4;
registerSkyFreeY(SKY_FREE_Y);
// Background celestial streaming starts above this eye altitude only: at
// ground level (y ~ 20) neither the Moon shell nor the planets are visible,
// so streaming them during boot burns the first seconds for nothing. The
// ascent from here to the Moon surface (~450 blocks) still leaves ~15 s to
// converge all bodies one by one at 60 fps. Explicit first-touch fills
// (aim/click/grapple) bypass the gate — only background work waits.
export const CELESTIAL_STREAM_Y = 500;
// Bodies complete in the background, nearest first and range-free; closer
// than this the fill is synchronous (the safety net before touch).
export const PLANET_SAFETY_R = 150;

// Palette registry: one rock triple + water triples + halo glow per
// glowstone color. Textures, water fog, and reaction looks all derive from
// this table, so a new color is one row.
export const PLANET_COLORS = [
  { key: "green", rock: [52, 128, 74], water: [69, 165, 101], waterIn: [168, 217, 184], glow: 0x3dff7a },
  { key: "red", rock: [150, 52, 58], water: [176, 74, 82], waterIn: [223, 169, 173], glow: 0xff3d5c },
  { key: "blue", rock: [64, 110, 200], water: [74, 125, 208], waterIn: [174, 198, 232], glow: 0x3d8aff },
  { key: "yellow", rock: [190, 160, 60], water: [194, 161, 60], waterIn: [232, 217, 160], glow: 0xffe53d },
  { key: "orange", rock: [190, 110, 44], water: [196, 122, 46], waterIn: [232, 193, 148], glow: 0xff9620 },
  { key: "purple", rock: [110, 64, 168], water: [125, 79, 192], waterIn: [196, 174, 228], glow: 0xb23dff },
  { key: "turquoise", rock: [40, 150, 160], water: [47, 168, 181], waterIn: [168, 223, 227], glow: 0x00cdde },
];

const waterColorIdx = new Map(PLANET_WATERS.map((id, i) => [id, i]));
export function planetWaterColorIdx(id) {
  return waterColorIdx.get(id) ?? -1;
}

// Every celestial water (Moon + palette), for eye-fog and hotbar dispatch.
export const CELESTIAL_WATERS = [MOON_WATER, ...PLANET_WATERS];

// Mesh LOD range: bodies past MESH_DIST render as a procedural proxy mesh
// instead of thousands of chunk meshes (three.js traverses every scene
// object per frame — the mesh count, not the voxels, is the fps ceiling).
// Background voxel fill shares the same range: out-of-range bodies
// materialize on demand (first touch, grapple fill, safety net, ultra
// slicer) instead of costing frame budget and voxel memory for nothing —
// at grapple speed the slicers still win the race, and the proxy covers the
// convergence. Hysteresis keeps a meshed body meshed until 1.2× range so
// border crossings never flap.
export const MESH_DIST = 2500;
export const MESH_OUT = 1.2;
// Crossfade duration (seconds) for the proxy→voxel reveal. Slow enough to
// stay progressive at grapple speed: both are co-located 3D, so the zoom
// during the fade stays registered.
export const REVEAL_TIME = 1.5;
// Proxy tiers: FULL is the exact proxy (cap, lakes, dome) for near bodies —
// crossfade duty and close inspection. LITE is 3 shared instanced meshes
// (rock disc + rim, dome blob, lake quads) for everything farther: same
// silhouette, same palette, sub-pixel deltas at the swap distance, O(1)
// draws and kilobytes no matter how many planets the sky holds. The Moon is
// always FULL (pinned entry, never a lite slot); touched bodies stay FULL
// at any range (voxels own the view, the proxy covers convergence).
export const PROXY_FULL_DIST = 3600;
export const PROXY_LITE_DIST = 4320; // ×1.2 hysteresis, mirrors MESH_OUT
// Pure proxy-tier decision (headless-tested; lod.js applies the effects):
// hard swap, no crossfade — every delta is sub-pixel at FULL_DIST, so the
// swap is invisible and flapping is impossible by construction.
export function proxyTierFor(dist, current, { touched = false, isMoon = false } = {}) {
  if (isMoon || touched) return "full";
  if (dist <= PROXY_FULL_DIST) return "full";
  if (dist >= PROXY_LITE_DIST) return "lite";
  return current;
}
// Player-touched bodies stay meshed at any range: painting, mining, or
// detonating a far body must keep showing the real voxels, not the stale
// proxy. Permanent per world (bounded by the body count); cleared with
// everything else on reset.
const touchedBodies = new Set();
export function noteBodyInteract(seed, key) {
  touchedBodies.add((seed | 0) + ":" + key);
  wipedBodies.delete((seed | 0) + ":" + key); // re-touched: alive again
}
export function bodyTouched(seed, key) {
  return touchedBodies.has((seed | 0) + ":" + key);
}
// Wiped bodies: an ultra band wipe drained the whole body. The LOD drops its
// meshes and proxy at once (they were remeshed empty, so the drop is cheap)
// instead of fading the proxy out over the void. Re-touching clears the flag
// (a rebuilt body is alive again); resets clear everything.
const wipedBodies = new Set();
export function noteBodyWiped(seed, key) {
  wipedBodies.add((seed | 0) + ":" + key);
}
export function bodyWiped(seed, key) {
  return wipedBodies.has((seed | 0) + ":" + key);
}
export function bodyCenter(spec) {
  return { x: spec.cx, y: (spec.top + spec.bottom) / 2, z: spec.cz };
}
export function bodyDist(spec, px, py, pz) {
  const c = bodyCenter(spec);
  return Math.hypot(c.x - px, c.y - py, c.z - pz);
}
// Mesh-want rule (voxels + meshes share it): touched bodies and everything
// inside the mesh range. Below the Moon fade band the LOD stages proxies
// only (no queue, no dispose — the legacy streaming owns the ground), so
// this only takes effect once something celestial can be visible.
export function bodyMeshWant(seed, key, px, py, pz) {
  if (bodyTouched(seed, key)) return true;
  const b = bodyByKey(key);
  if (!b) return true;
  return bodyDist(b, px, py, pz) <= MESH_DIST;
}
// Pure per-body LOD decision (headless-tested; lod.js applies the effects):
// queue while wanted-but-incomplete, dispose when unwanted-but-meshed, and
// two proxy states around the voxel handoff. The handoff distance is the
// mesh range itself, not the fog: celestial meshes are region meshes —
// scene-level, never fog-culled — so they are drawn at any distance once
// built, and the swap happens where the voxel staircase is still sub-pixel
// (~0.5 px/block at the default range). Releasing at the fog distance
// instead would hand off at ~120 surface blocks, where impostor and voxels
// can never read identically.
// - release (the body's meshes own the view): fully meshed AND either
//   touched (touched bodies stay meshed at any range) or inside the mesh
//   range. The proxy crossfades out over the drawn voxels.
// - cover (the proxy owns the view): meshes missing (arrival pop-in cover)
//   or a meshed body inside the dispose hysteresis band (departure cover:
//   the proxy fades back in over the drawn meshes before the drop, so
//   leaving never snaps and a return never flaps).
// Hysteresis: a meshed body stays wanted to range × out so border crossings
// never flap. Queueing uses the mesh range only — queuing past it would
// build meshes the dispose rule drops on the next tick (build-then-dispose
// churn); voxels lead separately through the background fill.
export function lodAction({ dist, range, out = MESH_OUT, touched, hasMesh, fullMesh }) {
  const want = touched || dist <= (hasMesh ? range * out : range);
  return {
    queue: want && !fullMesh,
    release: fullMesh && (touched || dist <= range),
    cover: !fullMesh || (!touched && hasMesh && dist > range),
    dispose: !want && hasMesh,
  };
}
// Pure departure step (headless-tested): released hands the frame to the
// meshes (proxy off, cancels any pending cover); otherwise ordering cover
// keeps the proxy over the meshes, and the drop lands only once the cover
// is complete AND the dispose range is reached — leaving never snaps and
// a return never flaps.
export function departureStep(pending, fade, coverOrdered, dropOrdered, released) {
  if (released) return { pending: false, target: 0, drop: false };
  if (!pending) return coverOrdered ? { pending: true, target: 1, drop: false } : null;
  if (dropOrdered && fade >= 0.999) return { pending: false, target: 1, drop: true };
  return { pending: true, target: 1, drop: false };
}
// Moon as a planet in particular: the white palette entry, fixed at the
// origin. Future planets reuse the same spec shape with their own center,
// rock/water ids, and salts.
export const MOON_SPEC = {
  key: "moon",
  cx: 0, cz: 0, bottom: MOON_MIN_Y, top: MOON_SURFACE_Y,
  r: MOON_R, thick: MOON_THICK,
  rock: MOON, water: MOON_WATER,
  rockRgb: [160, 164, 168],
  waterRgb: [149, 153, 157],
  color: -1,
  salt: 9211, lakeSalt: 9220,
  snow: true,
};

// Active world seed for the positional lookups (layout is seed-dependent).
// Set by the overworld generator and by the headless harness; every runtime
// body query below runs post-worldgen, so the seed is always current.
let activeSeed = 1;
export function setPlanetSeed(seed) {
  activeSeed = seed | 0;
}
// Seed behind the positional lookups (layout is seed-dependent; see above).
export function activeBodySeed() {
  return activeSeed;
}
// Face-adjacent cell for a geometric body hit (dominant axis), mirroring
// voxel placement on a DDA face (placeAtSelection).
export function bodySurfaceCell(hit) {
  const [fx, fy, fz] = hit.face;
  const ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz);
  if (ay >= ax && ay >= az) return [hit.x, hit.y + (fy > 0 ? 1 : -1), hit.z];
  if (ax >= az) return [hit.x + (fx > 0 ? 1 : -1), hit.y, hit.z];
  return [hit.x, hit.y, hit.z + (fz > 0 ? 1 : -1)];
}

// Planet shell sampler: rejection over seeded hash draws — uniform sphere
// direction (rejected below minEl), uniform radius in [BAND_R0, BAND_R1] —
// keeping the min-separation rule. Deterministic per seed: same ?seed, same
// sky. Budget exhausted for a planet: keep the best candidate tried (max of
// the min-distance, still deterministic) — the sky always completes with
// BAND_COUNT bodies; placements beyond the shell's separation capacity are
// the expected best-effort behavior at the fixed band, never an error.
const centersCache = new Map();
const PACK_ATTEMPTS = 100000;
export function planetCenters(seed) {
  const k = seed | 0;
  if (centersCache.has(k)) return centersCache.get(k);
  const pts = sampleShellCenters(k);
  centersCache.set(k, pts);
  return pts;
}
function sampleShellCenters(seed) {
  const minEl = BAND_MIN_EL_DEG * Math.PI / 180;
  const sep = BAND_MIN_SEP_RATIO * 2 * PLANET_R;
  const pts = [];
  for (let i = 0; i < BAND_COUNT; i++) {
    let best = null, bestD = -1;
    for (let a = 0; a < PACK_ATTEMPTS; a++) {
      const z = hash2(i, a * 2 + 1, (seed ^ 0x5f3d) | 0) * 2 - 1;
      const el = Math.asin(Math.max(-1, Math.min(1, z)));
      if (el < minEl) continue;
      const phi = hash2(i, a * 2 + 2, (seed ^ 0x9e37) | 0) * Math.PI * 2;
      const rr = BAND_R0 + hash2(i, a * 2 + 3, (seed ^ 0x51f3) | 0) * (BAND_R1 - BAND_R0);
      const cp = Math.cos(el);
      const p = {
        x: Math.round(rr * cp * Math.cos(phi)),
        y: Math.round(MOON_CENTER_Y + rr * z),
        z: Math.round(rr * cp * Math.sin(phi)),
      };
      let d = Infinity;
      for (const q of pts) d = Math.min(d, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
      if (d >= sep) { best = p; bestD = d; break; }
      if (d > bestD) { best = p; bestD = d; }
    }
    if (!best) {
      // Unreachable while minEl < 90° (positive acceptance probability per
      // draw), but never hang: deterministic fallback at BAND_R0/minEl, due
      // east.
      best = {
        x: Math.round(BAND_R0 * Math.cos(minEl)),
        y: Math.round(MOON_CENTER_Y + BAND_R0 * Math.sin(minEl)),
        z: 0,
      };
      bestD = -1;
    }
    pts.push(best);
  }
  return pts;
}

export function planetColorIdx(seed, i) {
  return Math.floor(hash2(i, 77, seed + 9300) * PLANET_COLORS.length);
}

// Body specs: the Moon (fixed center, white special) plus the shell planets
// (positional identity; colors repeat across planets freely).
const specsCache = new Map();
export function bodySpecs(seed) {
  if (specsCache.has(seed)) return specsCache.get(seed);
  const out = [{ ...MOON_SPEC }];
  const centers = planetCenters(seed);
  for (let i = 0; i < centers.length; i++) {
    const c = planetColorIdx(seed, i);
    out.push({
      key: "p" + i, cx: centers[i].x, cz: centers[i].z,
      bottom: centers[i].y - PLANET_R / 2, top: centers[i].y + PLANET_R / 2, r: PLANET_R, thick: PLANET_THICK,
      rock: PLANET_ROCKS[c], water: PLANET_WATERS[c], color: c,
      rockRgb: PLANET_COLORS[c].rock, waterRgb: PLANET_COLORS[c].water,
      salt: 9400 + i * 131, lakeSalt: 9500 + i * 137, snow: false,
    });
  }
  specsCache.set(seed, out);
  return out;
}

export function moonSpec() {
  return bodySpecs(activeSeed)[0];
}

export function bodyByKey(key) {
  for (const b of bodySpecs(activeSeed)) if (b.key === key) return b;
  return null;
}

// Padded cylinder test: the shared body-volume rule behind placement,
// render regions, ultra bands and the body-disc enumeration.
export function bodyPadContains(b, x, y, z, pad = 0) {
  if (y < b.bottom - pad || y > b.top + pad) return false;
  const dx = x - b.cx, dz = z - b.cz, rr = b.r + pad;
  return dx * dx + dz * dz <= rr * rr;
}
// Distance from a point to the body's solid cylinder (0 inside). Continuous
// counterpart of bodyPadContains, used by the deep-space speed zone.
export function bodySurfaceDist(b, x, y, z) {
  const dx = x - b.cx, dz = z - b.cz;
  const horiz = Math.max(0, Math.hypot(dx, dz) - b.r);
  const vert = Math.max(b.bottom - y, y - b.top, 0);
  return Math.hypot(horiz, vert);
}
// Body owning a cell: pad 0 is the exact volume, pad 2 the placed-cell box
// (face-adjacent placements sit just outside the voxel range).
export function bodyAtCell(x, y, z, pad = 0, seed = activeSeed) {
  for (const b of bodySpecs(seed)) {
    if (bodyPadContains(b, x, y, z, pad)) return b;
  }
  return null;
}
// Nearest body by surface distance (the body whose buffer zone owns a point).
export function nearestBody(x, y, z, seed = activeSeed) {
  let best = null, bestD = Infinity;
  for (const b of bodySpecs(seed)) {
    const d = bodySurfaceDist(b, x, y, z);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best ? { spec: best, dist: bestD } : null;
}

// Point-in-body test: the positional identity behind ultra wipes, gravity,
// teleport bands, and the gone flags (shared rock ids can never do this).
export function planetBodyAt(x, y, z) {
  return bodyAtCell(x, y, z, 0);
}
// Body owning a placed cell: face-adjacent placements sit up to 2 blocks
// outside the voxel range by construction (slab generosity + face step),
// so the padded box, not the exact volume, decides.
export function planetBodyAtPlaced(x, y, z) {
  return bodyAtCell(x, y, z, 2);
}

// Ultra bands: the overworld resolves one wipe per blast — ground/code box,
// cloud box (see ultravol.js), or one celestial ball per ignition point, so
// bodies explode independently. Sky gaps (ignition outside every ball plus
// margin) resolve to no volume and wipe nothing. Band ids feed the lookup;
// the carve reads balls, never cylinders.
export function ultraBandOf(x, y, z) {
  if (y < ULTRA_BAND1_HI + 1) return 1;
  if (y <= ULTRA_BAND2_HI) return 2;
  // Padded lookup: face-adjacent fuses (placed ultra sits just outside
  // the voxel range) still belong to the body, never to the Moon band.
  const b = planetBodyAtPlaced(x, y, z);
  return b && b.key !== "moon" ? "body:" + b.key : "moon";
}

// Celestial band predicate: the Moon band plus every planet cylinder.
// Ground and cloud bands are never celestial.
export function isCelestialBand(band) {
  return band === "moon" || (typeof band === "string" && band.startsWith("body:"));
}

// Fill state per world seed + body: the lunar surface always builds with
// the world (spawn stands on it); planets stream in on approach. Resets
// clear.
// Fill version: bump when the slicer output changes so live worlds converge
// once. v1 fills predate the lake-well restore (sealed-era wells may persist
// as rock below the cap); v2 adds the under-cap lake-water restore. The
// registry stores the version each body was completed with; readiness means
// current version, so a stale body refills (and heals) exactly once.
export const BODY_FILL_VERSION = 2;
const readySeeds = new Map();
export function bodyReady(seed, key) {
  return (readySeeds.get(seed + ":" + key) ?? 0) >= BODY_FILL_VERSION;
}
export function markBodyBuilt(seed, key) {
  readySeeds.set(seed + ":" + key, BODY_FILL_VERSION);
}
export function resetPlanets() {
  readySeeds.clear();
  touchedBodies.clear();
  wipedBodies.clear();
  markBodiesDirty();
}

// Background-stream selector (three-free, headless-tested): which unbuilt
// body the slicer should complete next from the player's position. The
// safety net wins (a body within safetyR must complete synchronously before
// the player can touch its shell), otherwise the nearest unbuilt body —
// range-free, so standing on the Moon completes the planets one by one
// instead of never. First-touch requests (`takeBodyFill` in moon.js) keep
// priority and stay with the caller, which consumes them. `readyFn` answers
// readiness per body key (the caller's seed-bound registry lookup).
export function nextBodyToStream(specs, px, py, pz, readyFn, safetyR = PLANET_SAFETY_R) {
  let best = null, bestD = Infinity;
  for (const spec of specs) {
    if (readyFn(spec.key)) continue;
    const dx = px - spec.cx, dy = py - spec.top, dz = pz - spec.cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < safetyR) return { spec, sync: true };
    if (d < bestD) { best = spec; bestD = d; }
  }
  return best ? { spec: best, sync: false } : null;
}

// Gone flags: true once a body holds no rock and no water of its own kind
// (ultra wipe, hand mining, rocket carve — any path). Lazy + cached: sky
// edits mark dirty, the next read scans each body cylinder through the
// sparse column-occupancy index (bounded work, never a full-map sweep), so
// per-frame callers stay O(1).
let goneVersion = 0;
const goneCache = new Map(); // key -> { v, gone }
export function markBodiesDirty() {
  goneVersion++;
}
function isBodyGoneCached(b) {
  const e = goneCache.get(b.key);
  if (e && e.v === goneVersion) return e.gone;
  return null;
}
function noteBodyGone(b, gone) {
  goneCache.set(b.key, { v: goneVersion, gone });
}
function bodyGoneScan(b) {
  const occ = colOcc.over;
  const R2 = b.r * b.r;
  for (let x = b.cx - b.r; x <= b.cx + b.r; x++) {
    for (let z = b.cz - b.r; z <= b.cz + b.r; z++) {
      const dx = x - b.cx, dz = z - b.cz;
      if (dx * dx + dz * dz > R2) continue;
      const set = occ.get(colTopIdx(x, z));
      if (!set) continue;
      for (const y of set) {
        if (y < b.bottom || y > b.top) continue;
        const id = worlds.over.get(key(x, y, z));
        if (id === b.rock || id === b.water) return false;
      }
    }
  }
  return true;
}
export function isBodyGone(bkey) {
  const specs = bodySpecs(activeSeed);
  const b = bkey === "moon" ? specs[0] : specs.find((s) => s.key === bkey);
  if (!b) return true;
  const hit = isBodyGoneCached(b);
  if (hit !== null) return hit;
  const gone = bodyGoneScan(b);
  noteBodyGone(b, gone);
  return gone;
}
// True while any body still holds rock or water: short-circuits on the
// first living body (the Moon first), so dirty frames never pay the full
// sweep unless everything is actually gone.
export function anyBodyAlive() {
  for (const b of bodySpecs(activeSeed)) {
    const hit = isBodyGoneCached(b);
    if (hit === false) return true;
    if (hit === null) {
      const gone = bodyGoneScan(b);
      noteBodyGone(b, gone);
      if (!gone) return true;
    }
  }
  return false;
}

// Space Voronoi: every point belongs to the nearest body by 3D distance to
// the body center — Moon included, no radius gate, no floor. The hotbar reads
// the cell of the aimed voxel through this; the default (no voxel aimed) is
// Moon water. O(n) over bodies — trivial per frame.
export function voronoiBodyAt(x, y, z, seed = activeSeed) {
  let best = null, bestD2 = Infinity, bestKey = null;
  for (const b of bodySpecs(seed)) {
    const c = bodyCenter(b);
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2 || (d2 === bestD2 && (bestKey === null || b.key < bestKey))) {
      bestD2 = d2; best = b; bestKey = b.key;
    }
  }
  return best;
}

// Hotbar water for a celestial aim (three-free, headless-tested): below the
// reveal plain water owns the slot; inside it a real aimed voxel reads its
// Voronoi cell's water, a geometric far/proxy body pick carries the body and
// reads that body's own water, and a bare aim defaults to Moon water.
export function celestialWaterFor(hit, revealed) {
  if (!revealed) return WATER;
  if (hit && hit.id !== AIR) return voronoiBodyAt(hit.x, hit.y, hit.z).water;
  return hit?.body?.water ?? MOON_WATER;
}

// Voxel re-pick budget after a geometric body hit at ray distance t: the
// DDA crosses one voxel boundary per iteration, so walking distance t costs
// t·(|dx|+|dy|+|dz|) steps with |dx|+|dy|+|dz| <= √3 (a linear cap in t
// always starves on diagonals — the shell planets need ~2900 steps for a
// ~1700 entry). Factor 2 covers √3 plus the in-body traversal for any t,
// including the 100k range; click-only cost, never per frame.
export function bodyRepickBudget(t) {
  return Math.ceil((t + 512) * 2);
}

// Ray vs body cylinders: the nearest body volume the normalized ray enters
// within maxDist. The entry cell seeds a geometric grapple target (and the
// highlight) long before voxels stream; the caller builds the body, then
// re-picks voxels for the real latch. O(n) over bodies — trivial per click
// and per frame.
export function rayBodyHit(origin, dir, maxDist = Infinity, seed = activeSeed) {
  let best = null;
  for (const b of bodySpecs(seed)) {
    const ox = origin.x - b.cx, oz = origin.z - b.cz;
    // Embedded origin (inside the tight volume): skip — the eye never sits
    // in solid, and a stuck-inside ray must not self-latch at t=0.
    if (ox * ox + oz * oz <= b.r * b.r && origin.y >= b.bottom && origin.y <= b.top) continue;
    const dx = dir.x, dz = dir.z;
    // XZ ray vs disc (entry/exit distances along the ray).
    const aa = dx * dx + dz * dz;
    let tInCyl, tOutCyl;
    if (aa < 1e-12) {
      if (ox * ox + oz * oz > b.r * b.r) continue;
      tInCyl = -Infinity; tOutCyl = Infinity;
    } else {
      const half = ox * dx + oz * dz;
      const cc = ox * ox + oz * oz - b.r * b.r;
      const disc = half * half - aa * cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(Math.max(0, disc));
      tInCyl = (-half - sq) / aa; tOutCyl = (-half + sq) / aa;
    }
    // Y slab (generous by one cell so grazing tops still latch).
    const lo = b.bottom - 1, hi = b.top + 1;
    let tInY, tOutY;
    if (Math.abs(dir.y) < 1e-12) {
      if (origin.y < lo || origin.y > hi) continue;
      tInY = -Infinity; tOutY = Infinity;
    } else {
      const t1 = (lo - origin.y) / dir.y, t2 = (hi - origin.y) / dir.y;
      tInY = Math.min(t1, t2); tOutY = Math.max(t1, t2);
    }
    const tE = Math.max(tInCyl, tInY), tX = Math.min(tOutCyl, tOutY);
    const t = Math.max(tE, 0);
    if (tX < Math.max(tE, 0) || t > maxDist) continue;
    if (best && t >= best.t) continue;
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    // Entry face: the boundary crossed last (side vs slab plane).
    let face;
    if (tInCyl >= tInY) {
      const nx = px - b.cx, nz = pz - b.cz;
      const l = Math.hypot(nx, nz) || 1;
      face = [nx / l, 0, nz / l];
    } else {
      face = dir.y < 0 ? [0, 1, 0] : [0, -1, 0];
    }
    best = { spec: b, t, x: Math.floor(px), y: Math.floor(py), z: Math.floor(pz), face };
  }
  return best;
}

// Shared celestial reveal chain. The anchor is where the cloud top
// vanishes behind the fog (the overworld steady fog far — main.js builds
// its Fog from FOG_FAR, so the two can never drift): the sky starts fading
// blue→black SKY_LEAD below it, as soon as the last cloud deck is barely
// fog-dissolving. From there the sky fades over SKY_FADE_WIDTH, holds pure
// black for BLACK_BUFFER, and only then the Moon + planets fade in
// together over CELESTIAL_FADE_WIDTH — whole sky, black sky behind it,
// never a body against the blue.
export const FOG_FAR = 160;
export const SKY_LEAD = 20;
export const SKY_FADE_WIDTH = 20;
export const BLACK_BUFFER = 5;
export const CELESTIAL_FADE_WIDTH = 20;
export const ANCHOR_Y = CLOUD_MAX_Y + FOG_FAR;
export const SKY_START = ANCHOR_Y - SKY_LEAD;
export const SKY_END = SKY_START + SKY_FADE_WIDTH;
export const CELESTIAL_FADE_Y = SKY_END + BLACK_BUFFER;
export const CELESTIAL_FADE_END = CELESTIAL_FADE_Y + CELESTIAL_FADE_WIDTH;
export function celestialRevealFactor(y) {
  const t = (y - CELESTIAL_FADE_Y) / (CELESTIAL_FADE_END - CELESTIAL_FADE_Y);
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
