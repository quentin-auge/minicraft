// The Moon: one planet in particular (see world/planets.js registry). Same
// thick rock disc + hashed water lakes as every future planet, ported from
// master (same geometry, same salts). Only the surface (cap + lake shafts)
// builds with the world — spawn stands on it, so tops are final before the
// player exists. The hollow underside shell fills lazily after the reveal
// in row slices: unreachable within its few-second window, so startup never
// pays for it. Overwrites are deterministic, so a resumed or repeated fill
// is identical — no clearing pass needed. Generic body builders take a spec
// ({cx, cz, rock, water, salt, lakeSalt, r}); Moon wrappers fix MOON_SPEC.
import { AIR, MOON, MOON_WATER } from "../core/blocks.js";
import { hasSupport } from "../core/gridwalk.js";
import { hash2 } from "../core/noise.js";
import { CHUNK, chunkOf, getBlock, isSolid, dimInfinite, outOfWorld, key, worlds, colOcc, colTopIdx, dim } from "../core/store.js";
import { AIR_POCKET_CAP } from "../core/airpocket.js";
import {
  MOON_SPEC, MOON_R, MOON_THICK, MOON_MIN_Y, MOON_SURFACE_Y,
  markBodiesDirty, bodyReady, markBodyBuilt, resetPlanets,
} from "./planets.js";

export { MOON_R, MOON_THICK, MOON_MIN_Y, MOON_SURFACE_Y };

// Moon skies per dimension key: registered by world/dimensions.js at spec
// build, so three-free movers (mobs) read the same low-g sky as the player
// without importing the dimension registry. Headless rigs that never
// register read no moon — full gravity everywhere.
const moonDims = new Set();
export function registerMoonDim(k) { moonDims.add(k); }
export function moonDimHas(k) { return moonDims.has(k); }

// Fill state per world seed (shared registry with the planets): underside
// complete (the surface always builds with the world; meshing of the shell
// follows via chunk refresh). resetMoon clears it; every New World
// regenerates from empty.
export function moonReady(seed) {
  return bodyReady(seed, "moon");
}
export function resetMoon() {
  resetPlanets();
  pendingBodyFills.clear();
  markMoonDirty();
}

// Requested body fills: first-touch placements build only their target
// column and register here; the main-loop slicer drains the set one body at
// a time (single-flight, same driver as streaming) and completes the body
// over frames — never a whole-body hitch on first touch.
const pendingBodyFills = new Set();
export function requestBodyFill(seed, key) {
  pendingBodyFills.add(seed + ":" + key);
}
// Cells the player placed on a still-unbuilt body: the completing slicer
// skips them (a first-touch block must never be paved over by its own
// body's fill). Cleared once the body is built; floods treat placed cells
// as ordinary solids.
export function takeBodyFill(seed, key) {
  const k = seed + ":" + key;
  if (!pendingBodyFills.has(k)) return false;
  pendingBodyFills.delete(k);
  return true;
}
const fillKeeps = new Map();
export function keepBodyCell(seed, key, x, y, z) {
  const k = seed + ":" + key;
  let s = fillKeeps.get(k);
  if (!s) {
    s = new Set();
    fillKeeps.set(k, s);
  }
  s.add(x + "," + y + "," + z);
}
function keptBodyCells(spec, seed) {
  const k = seed + ":" + spec.key;
  const s = fillKeeps.get(k);
  if (!s) return null;
  if (bodyReady(seed, spec.key)) {
    fillKeeps.delete(k);
    return null;
  }
  return s;
}
// Post-fill debris purge: placements made while the body was unbuilt may
// float (chords cut the curvature before the shell exists to support them).
// Once the body is built, real support decides — unsupported keeps are
// removed so strokes never leave orbital debris. Returns touched cells.
export function purgeUnsupportedKeeps(spec, seed, setBlock, getBlock) {
  const k = seed + ":" + spec.key;
  const s = fillKeeps.get(k);
  fillKeeps.delete(k);
  if (!s || !s.size) return [];
  const touched = [];
  for (const key of s) {
    const [x, y, z] = key.split(",").map(Number);
    if (getBlock(x, y, z) === AIR) continue;
    if (hasSupport(getBlock, x, y, z)) continue;
    setBlock(x, y, z, AIR);
    touched.push([x, y, z]);
  }
  return touched;
}

// Gone flag: true once no MOON rock and no MOON_WATER remain in the
// overworld (ultra band-3 wipe, hand mining, rocket carve — any path).
// Lazy + cached: mutation paths in the moon band mark dirty, the next read
// scans the overworld map with an early exit on the first lunar block, so
// per-frame callers (snow, gravity, hotbar) stay O(1).
let moonGoneCache = false;
let moonGoneDirty = true;
export function markMoonDirty() {
  moonScan = null; // a direct mark aborts any background scan: the next
  moonGoneDirty = true;
  markBodiesDirty();
}
// Deferred gone-flag invalidation for band wipes: a wipe clears six-figure
// cell counts, and every per-cell bump would rescan the full overworld map
// plus every body cylinder on the next frame (gravity, hotbar, snow and the
// reveal read them per frame). While deferred, reads stay cached on the
// pre-wipe state — the wipe reads "alive" throughout, which is also what
// gravity, LOD and the hotbar want. The rescan itself is sliced across
// frames once the carve settles (see beginMoonGoneScan below) instead of
// firing as one frame-hitch at flush.
// Nesting-safe (concurrent planet wipes), and resetMoonDirty covers wipes
// dropped mid-flight (travel/New World): the fresh world rescans once.
let moonDirtyDefer = 0;
let moonDirtyPending = false;
export function deferMoonDirty() {
  moonDirtyDefer++;
}
export function resetMoonDirty() {
  moonDirtyDefer = 0;
  moonDirtyPending = false;
  markMoonDirty();
}
export function noteMoonDirty() {
  if (moonDirtyDefer > 0) moonDirtyPending = true;
  else markMoonDirty();
}
// Background gone-scan: started once the wipe's carve settles, pumped a few
// milliseconds per frame by the blast drain, so the multi-million-entry map
// rescan never lands as one hitch. Reads stay cached (stale-alive) while it
// runs; completion finalizes the cache exactly like a synchronous scan plus
// the per-body version bump. Any new churn restarts it (defer counter or a
// fresh pending note); any direct mark aborts it (sync scan on next read).
let moonScan = null; // { shard, it, defer } while running
export function moonGoneScanActive() {
  return moonScan !== null;
}
export function beginMoonGoneScan() {
  if (!moonDirtyPending) {
    // Nothing noted during the wipe (ground-only bands): no rescan needed.
    moonDirtyDefer = 0;
    return;
  }
  moonScan = { shard: 0, it: null, defer: moonDirtyDefer };
  moonDirtyDefer = 0;
  moonDirtyPending = false;
  moonGoneDirty = true;
}
export function pumpMoonGoneScan(budgetMs = 2) {
  if (!moonScan) return true;
  if (moonScan.defer !== moonDirtyDefer || moonDirtyPending) {
    // Churned mid-scan (chained blast, fresh notes): restart from the top.
    moonScan = { shard: 0, it: null, defer: moonDirtyDefer };
    moonDirtyDefer = 0;
    moonDirtyPending = false;
  }
  const deadline = performance.now() + budgetMs;
  const shards = worlds.over.shards;
  let n = 0;
  while (moonScan.shard < shards.length) {
    const m = shards[moonScan.shard];
    if (!moonScan.it) moonScan.it = m.values();
    for (;;) {
      const r = moonScan.it.next();
      if (r.done) break;
      if (r.value === MOON || r.value === MOON_WATER) {
        moonScan = null;
        moonGoneCache = false;
        moonGoneDirty = false;
        markBodiesDirty();
        return true;
      }
      if ((++n & 1023) === 0 && performance.now() >= deadline) return false;
    }
    moonScan.it = null;
    moonScan.shard++;
  }
  moonScan = null;
  moonGoneCache = true;
  moonGoneDirty = false;
  markBodiesDirty();
  return true;
}
export function isMoonGone() {
  if (moonScan) return moonGoneCache; // background scan running: stay cached
  if (!moonGoneDirty) return moonGoneCache;
  moonGoneDirty = false;
  for (const id of worlds.over.values()) {
    if (id === MOON || id === MOON_WATER) {
      moonGoneCache = false;
      return false;
    }
  }
  moonGoneCache = true;
  return true;
}

// Surface-defining voxels (cap shell + lake shafts): eager in worldgen,
// before spawn. Column tops are final afterwards, so spawn, lights, and
// portals all agree with the post-fill world. The lake join runs later
// (joinBodyLakeWater, after the shell exists): shell-adjacent pinched air
// only reads as a pocket once the shell is in place.
export function generateBodySurfaceRows(spec, seed, setBlock, x0, x1) {
  const R = spec.r ?? MOON_R;
  const thick = spec.thick ?? MOON_THICK;
  const base = spec.top ?? MOON_SURFACE_Y;
  const R2 = R * R;
  const keep = keptBodyCells(spec, seed);
  for (let x = Math.max(x0, spec.cx - R); x < Math.min(x1, spec.cx + R + 1); x++) {
    for (let z = spec.cz - R; z <= spec.cz + R; z++) {
      const dx = x - spec.cx, dz = z - spec.cz;
      if (dx * dx + dz * dz > R2) continue;
      for (let y = base - thick + 1; y <= base; y++) {
        if (keep && keep.has(x + "," + y + "," + z)) continue;
        setBlock(x, y, z, spec.rock);
      }
    }
  }
  generateBodyLakes(spec, seed, setBlock, x0, x1);
}

export function generateBodySurface(spec, seed, setBlock) {
  const R = spec.r ?? MOON_R;
  generateBodySurfaceRows(spec, seed, setBlock, spec.cx - R, spec.cx + R + 1);
}

export function generateMoonSurface(seed, setBlock) {
  generateBodySurface(MOON_SPEC, seed, setBlock);
}

// Hollow underside shell in x-row slices (lazy background fill): same
// voxels as the eager port, just deferred. Deterministic per geometry
// (no seed hash), so repeats are identical. Never seals the lake shafts:
// existing body water is left in place so the wells stay open below.
export function generateBodyUnderRows(spec, seed, setBlock, x0, x1, getBlock = null) {
  const R = spec.r ?? MOON_R;
  const thick = spec.thick ?? MOON_THICK;
  const base = spec.top ?? MOON_SURFACE_Y;
  const R2 = R * R;
  const inner = (R - thick) * (R - thick);
  const WATER = spec.water, ROCK = spec.rock;
  const keep = keptBodyCells(spec, seed);
  for (let x = Math.max(x0, spec.cx - R); x < Math.min(x1, spec.cx + R + 1); x++) {
    for (let z = spec.cz - R; z <= spec.cz + R; z++) {
      const dx = x - spec.cx, dz = z - spec.cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      const h = Math.floor(Math.sqrt(R2 - d2));
      for (let y = base - h; y < base - thick + 1; y++) {
        const dy = base - y;
        const dist2 = d2 + dy * dy;
        if (dist2 <= R2 && dist2 >= inner) {
          if (getBlock && getBlock(x, y, z) === WATER) continue;
          if (keep && keep.has(x + "," + y + "," + z)) continue;
          setBlock(x, y, z, ROCK);
        }
      }
    }
  }
}

export function generateMoonUnderRows(seed, setBlock, x0, x1, getBlock = null) {
  generateBodyUnderRows(MOON_SPEC, seed, setBlock, x0, x1, getBlock);
}

export function markMoonBuilt(seed) {
  markBodyBuilt(seed, "moon");
}

// Full synchronous fill (underside safety net, headless harness): shell
// first so the lake shafts overwrite it, then surface, then the lake join
// (shell present, so pinched air reads exactly as the mesher will see it).
// Idempotent per seed.
export function generateBody(spec, seed, setBlock, getBlock = null) {
  const R = spec.r ?? MOON_R;
  generateBodyUnderRows(spec, seed, setBlock, spec.cx - R, spec.cx + R + 1, getBlock);
  generateBodySurface(spec, seed, setBlock);
  if (getBlock) joinBodyLakeWater(spec, seed, setBlock, getBlock);
}

export function generateMoon(seed, setBlock, getBlock = null) {
  generateBody(MOON_SPEC, seed, setBlock, getBlock);
  markMoonBuilt(seed);
}

// Detonation-fast body build: underside plus surface, no lake join (lakes
// are vaporized anyway) and no ready marking — the streaming slicer still
// owns completion. Same voxels as generateBody minus the join.
export function generateBodyNoJoin(spec, seed, setBlock, getBlock = null) {
  const R = spec.r ?? MOON_R;
  generateBodyUnderRows(spec, seed, setBlock, spec.cx - R, spec.cx + R + 1, getBlock);
  generateBodySurface(spec, seed, setBlock);
}

// Moon spawn for the ?startdim=moon boot alias (overworld, not a dimension):
// nearest-to-origin solid MOON cap outside the lake shafts, with headroom.
// The cap top is flat at MOON_SURFACE_Y, so only the lake check varies.
export function findMoonSpawn() {
  const base = MOON_SURFACE_Y;
  const R2 = MOON_R * MOON_R;
  for (let r = 0; r <= MOON_R; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (dx * dx + dz * dz > R2) continue;
        if (getBlock(dx, base, dz) !== MOON) continue;
        if (isSolid(dx, base + 1, dz) || isSolid(dx, base + 2, dz)) continue;
        const len = Math.hypot(dx, dz);
        const yaw = len > 0 ? Math.atan2(dx, dz) : 0;
        return { x: dx, z: dz, y: base, yaw };
      }
    }
  }
  return { x: 0, z: 0, y: base, yaw: 0 };
}

// Chunk-center block coords overlapping the disc, for post-fill refresh:
// global chunk-grid aligned (chunkOf range), with a 2-cell margin so
// face-adjacent placements on the rim (planetBodyAtPlaced padding) land in
// a covered chunk. Every chunk holding any body voxel is covered, so distant
// bodies mesh whole instead of popping rim chunks on approach.
// Position-keyed cache: the same disc is requested by the pin set, the sky
// gate, the queues and the LOD entries — computed once, copied per caller
// (callers sort in place, so the shared canonical is never handed out).
const chunkCentersCache = new Map();
export function bodyChunkCenters(spec) {
  const ck = spec.cx + "," + spec.cz + "," + (spec.r ?? MOON_R);
  const hit = chunkCentersCache.get(ck);
  if (hit) return hit.slice();
  const R = (spec.r ?? MOON_R) + 2;
  const out = [];
  const R2 = R * R;
  const cx0 = chunkOf(spec.cx - R), cx1 = chunkOf(spec.cx + R);
  const cz0 = chunkOf(spec.cz - R), cz1 = chunkOf(spec.cz + R);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const x0 = cx * CHUNK, z0 = cz * CHUNK;
      const nx = Math.max(x0, Math.min(spec.cx, x0 + CHUNK - 1));
      const nz = Math.max(z0, Math.min(spec.cz, z0 + CHUNK - 1));
      const dx = nx - spec.cx, dz = nz - spec.cz;
      if (dx * dx + dz * dz <= R2) out.push([x0 + (CHUNK >> 1), 0, z0 + (CHUNK >> 1)]);
    }
  }
  chunkCentersCache.set(ck, out);
  return out.slice();
}

export function moonChunkCenters() {
  return bodyChunkCenters(MOON_SPEC);
}

// Chunk keys covering a body's disc, for the mesher pin set: the streaming
// dispose must never evict them, so returns never rebuild. Seed-independent
// (chunk coords), three-free, headless-tested.
export function bodyChunkKeys(spec) {
  const out = new Set();
  for (const [x, , z] of bodyChunkCenters(spec)) {
    out.add(chunkOf(x) + "_" + chunkOf(z));
  }
  return out;
}

// Sky convergence predicate: every chunk holding any body voxel is meshed.
// Pure (the mesh lookup is injected), so the boot wait and the headless
// suite share it — the mesher owns the real lookup (isChunkMeshed).
export function skyConverged(specs, hasMesh) {
  for (const spec of specs) {
    for (const k of bodyChunkKeys(spec)) {
      if (!hasMesh(k)) return false;
    }
  }
  return true;
}

export function lakeParams(seed, salt, cx0, cz0, R) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = hash2(i, 11, seed + salt) * Math.PI * 2;
    const r = Math.sqrt(hash2(i, 12, seed + salt + 1)) * (R * 0.66);
    out.push({
      cx: cx0 + Math.round(Math.cos(a) * r),
      cz: cz0 + Math.round(Math.sin(a) * r),
      cr: 4 + Math.floor(hash2(i, 13, seed + salt + 2) * 4),
      i,
    });
  }
  return out;
}

export function moonLakeParams(seed) {
  return lakeParams(seed, MOON_SPEC.salt, 0, 0, MOON_R);
}

export function bodyLakeParams(spec, seed) {
  return lakeParams(seed, spec.salt, spec.cx, spec.cz, spec.r ?? MOON_R);
}

// Lake join: fill the air the shafts enclose with body water, so the lakes
// read as contiguous water volumes and no water face keeps a pocket
// back. Runs only once the shell exists (sync full fill, lazy-fill tail in
// main.js) — testing earlier would miss the pinches the shell itself
// closes. Scoped to the lake boxes, existing water never touched,
// idempotent. The noisy shoreline leaves rock teeth fully ringed by
// water, so a rock peel runs first: any solid cell with water on all
// four sides converts its whole column (lake bottom to surface) to water,
// peeling to a fixpoint — only truly isolated teeth go, the shore
// stays, and the new water only feeds the air pass below, never the
// reverse. Exact per-cell floods over a dense box snapshot (fresh
// visited set each: a shared cache can hide a truly-trapped notch behind
// neighbouring open air), with the same move set, cap, and floor rule as
// airpocket.js — keep the two in sync. A second all-directions flood then
// splits the verdict: fully sealed components fill with water, while
// hollow-linked pits (reachable upward) fill with rock, so the
// underside never ponds stray water and no water face keeps a pocket back
// either way. Open verdicts propagate forward
// (a cell stepping sideways or down into open air is open itself), so each
// open region pays a single flood no matter how many candidates touch it;
// whole trapped components fill at once, and a fixpoint pass catches
// neighbours a fill newly seals.
const JOIN_DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// Full 6-way set for the sealed check below: a trapped component that still
// escapes upward is hollow-linked, not sealed.
const SEAL_DIRS = [...JOIN_DIRS, [0, 1, 0]];
// Lake-join time budget per slicer call (ms): one slice advances as many
// join phases as fit — snapshot, peel sweeps, scan bands — so a tall moon
// lake never eats a 30 ms frame. Verdicts stay bit-identical: traversal
// order and the shared grid are unchanged, only the resume points are new.
const JOIN_PHASE_MS = 8;
// Lake-join snapshot: sparse occupancy read into a grid, plus the resume
// state the phase pumps below advance (peel cursor, scan cursor, open
// flood stack, accumulators). One snapshot per lake per pass — the driver
// rebuilds it when it moves to the next lake, so passes never reuse a
// stale grid, and the lake resumes across calls (begin + phase pumps
// below), so one call costs a few ms instead of a whole lake.
function beginLakeJoin(spec, readBlock, ctx, lake) {
  const { y0, y1, R2, base, WATER, ROCK } = ctx;
  const { cx, cz, cr } = lake;
  const x0 = cx - cr - 6, x1 = cx + cr + 6;
  const z0 = cz - cr - 6, z1 = cz + cr + 6;
  const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
  const grid = new Uint8Array(sx * sy * sz);
  const st = {
    x0, x1, z0, z1, y0, y1, sx, sy, sz, grid,
    openM: new Uint8Array(sx * sy * sz), openWork: [],
    peelX: x0, peelZ: z0, peelDone: false,
    scanX: x0, scanY: y0, scanZ: z0, scanDone: false, draining: false,
    filled: 0, purged: 0, op: 0,
    specCx: spec.cx, specCz: spec.cz, R2, base, WATER, ROCK,
  };
  // Sparse snapshot through the column-occupancy index: the grid
  // defaults to open air (zeros), so only non-air cells need a voxel
  // read — ~10x fewer reads than the full box scan for the same
  // verdicts. Occupancy tracks every setBlock, so the rows written
  // just above are already indexed.
  const occ = colOcc[dim];
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const set = occ.get(colTopIdx(x, z));
      if (!set) continue;
      for (const y of set) {
        if (y < y0 || y > y1) continue;
        const id = readBlock(x, y, z);
        grid[lakeGi(st, x, y, z)] = id === AIR ? 0 : id === WATER ? 1 : 2;
      }
    }
  }
  return st;
}
const lakeGi = (st, x, y, z) => ((x - st.x0) * st.sz + (z - st.z0)) * st.sy + (y - st.y0);
function lakeInBox(st, x, y, z) {
  return x >= st.x0 && x <= st.x1 && y >= st.y0 && y <= st.y1 && z >= st.z0 && z <= st.z1;
}
function lakeAtCell(st, readBlock, x, y, z) {
  if (lakeInBox(st, x, y, z)) return st.grid[lakeGi(st, x, y, z)];
  const id = readBlock(x, y, z);
  return id === AIR ? 0 : id === st.WATER ? 1 : 2;
}
function markOpenLake(st, x, y, z) {
  if (!lakeInBox(st, x, y, z) || st.grid[lakeGi(st, x, y, z)] !== 0 || st.openM[lakeGi(st, x, y, z)]) return;
  st.openM[lakeGi(st, x, y, z)] = 1;
  st.openWork.push([x, y, z]);
}
// Open-region flood, resumable: the work stack lives in state, so a slice
// can stop mid-cascade and resume with the same order. Bounded by the box
// (every cell is marked once), like the synchronous twin.
function drainOpenLake(st, readBlock, deadline) {
  const work = st.openWork;
  while (work.length) {
    const [px, py, pz] = work.pop();
    // Reverse moves: cells stepping into (px, py, pz) sideways or down.
    if (lakeAtCell(st, readBlock, px + 1, py, pz) === 0) markOpenLake(st, px + 1, py, pz);
    if (lakeAtCell(st, readBlock, px - 1, py, pz) === 0) markOpenLake(st, px - 1, py, pz);
    if (lakeAtCell(st, readBlock, px, py, pz + 1) === 0) markOpenLake(st, px, py, pz + 1);
    if (lakeAtCell(st, readBlock, px, py, pz - 1) === 0) markOpenLake(st, px, py, pz - 1);
    if (lakeAtCell(st, readBlock, px, py + 1, pz) === 0) markOpenLake(st, px, py + 1, pz);
    if ((st.op++ & 255) === 0 && performance.now() > deadline) return false;
  }
  return true;
}
// Rock-tooth peel pump, resumable: one fixpoint sweep per state, restarting
// from the box origin after a peel (original semantics). Resume re-scans
// the saved column from its top — sound because a column with no peel this
// sweep performed reads only (a peel aborts the sweep outright).
function pumpLakePeel(st, spec, setBlock, readBlock, deadline) {
  if (st.peelDone) return true;
  let cx = st.peelX, cz = st.peelZ;
  for (;;) {
    let moved = false;
    for (let x = cx; x <= st.x1 && !moved; x++) {
      for (let z = x === cx ? cz : st.z0; z <= st.z1 && !moved; z++) {
        const dx = x - spec.cx, dz = z - spec.cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > st.R2) continue;
        const h = Math.floor(Math.sqrt(st.R2 - d2));
        if (h === 0) continue;
        const bottom = st.base - h;
        for (let y = st.y0; y <= st.y1; y++) {
          if (st.grid[lakeGi(st, x, y, z)] !== 2) continue;
          if (
            lakeAtCell(st, readBlock, x + 1, y, z) !== 1 || lakeAtCell(st, readBlock, x - 1, y, z) !== 1 ||
            lakeAtCell(st, readBlock, x, y, z + 1) !== 1 || lakeAtCell(st, readBlock, x, y, z - 1) !== 1
          ) continue;
          for (let cy = bottom; cy <= st.base; cy++) {
            if (st.grid[lakeGi(st, x, cy, z)] !== 1) {
              if (lakeInBox(st, x, cy, z)) st.grid[lakeGi(st, x, cy, z)] = 1;
              setBlock(x, cy, z, st.WATER);
            }
          }
          st.purged++;
          moved = true;
          break;
        }
        if (!moved && (st.op++ & 127) === 0 && performance.now() > deadline) {
          st.peelX = x; st.peelZ = z;
          return false;
        }
      }
    }
    if (!moved) {
      st.peelDone = true;
      return true;
    }
    cx = st.x0; cz = st.z0;
  }
}
// Scan pump: the open-mark scan with sealed verdicts, resumable across
// calls (see the cursor contract above). One fixpoint sweep per state.
function pumpLakeScan(st, spec, setBlock, readBlock, deadline) {
  if (st.scanDone) return true;
  // Finish a suspended open-region cascade before resuming the scan: the
  // work stack is order-preserving, so the resumed flood marks exactly
  // what the continuous run would have marked.
  if (st.draining) {
    if (!drainOpenLake(st, readBlock, deadline)) return false;
    st.draining = false;
  }
  // Sound-open marks: forward propagation only (a cell is open when one
  // of its flood moves lands on open air), never flood sharing.
  let x = st.scanX, y = st.scanY, z = st.scanZ;
  for (; x <= st.x1; x++) {
    for (; z <= st.z1; z++) {
      for (; y <= st.y1; y++) {
        // Persist-then-process: resume re-checks at most one candidate,
        // and the pre-checks below make that a no-op (grid written or
        // open-marked by the completed pass).
        st.scanX = x; st.scanY = y; st.scanZ = z;
        if ((st.op++ & 63) === 0 && performance.now() > deadline) return false;
        if (st.grid[lakeGi(st, x, y, z)] !== 0 || st.openM[lakeGi(st, x, y, z)]) continue;
        if (
          lakeAtCell(st, readBlock, x + 1, y, z) !== 1 && lakeAtCell(st, readBlock, x - 1, y, z) !== 1 &&
          lakeAtCell(st, readBlock, x, y + 1, z) !== 1 && lakeAtCell(st, readBlock, x, y - 1, z) !== 1 &&
          lakeAtCell(st, readBlock, x, y, z + 1) !== 1 && lakeAtCell(st, readBlock, x, y, z - 1) !== 1
        ) continue;
        const seenF = new Set([key(x, y, z)]);
        const cells = [];
        const stack = [[x, y, z]];
        let open = false;
        while (stack.length && !open) {
          if (cells.length >= AIR_POCKET_CAP) { open = true; break; }
          const [px, py, pz] = stack.pop();
          cells.push([px, py, pz]);
          for (let d = 0; d < JOIN_DIRS.length; d++) {
            const nx = px + JOIN_DIRS[d][0];
            const ny = py + JOIN_DIRS[d][1];
            const nz = pz + JOIN_DIRS[d][2];
            if (outOfWorld(nx, ny, nz)) {
              if (ny < 0 && !dimInfinite()) continue;
              open = true;
              break;
            }
            if (lakeAtCell(st, readBlock, nx, ny, nz) !== 0) continue;
            const kk = key(nx, ny, nz);
            if (seenF.has(kk)) continue;
            seenF.add(kk);
            stack.push([nx, ny, nz]);
          }
        }
        if (open) {
          markOpenLake(st, x, y, z);
          st.draining = true;
          if (!drainOpenLake(st, readBlock, deadline)) return false;
          st.draining = false;
          continue;
        }
        // Sealed check: a trapped component that still escapes upward is
        // hollow-linked, not sealed. Sealed notches fill with water
        // (uniform inside tint); hollow-linked pits fill with rock,
        // so the underside never ponds stray water while no water face
        // keeps a pocket back either way.
        const seenS = new Set([key(x, y, z)]);
        const sstack = [[x, y, z]];
        let sealed = true;
        while (sstack.length && sealed) {
          if (seenS.size >= AIR_POCKET_CAP) { sealed = false; break; }
          const [px, py, pz] = sstack.pop();
          for (let d = 0; d < SEAL_DIRS.length; d++) {
            const nx = px + SEAL_DIRS[d][0];
            const ny = py + SEAL_DIRS[d][1];
            const nz = pz + SEAL_DIRS[d][2];
            if (outOfWorld(nx, ny, nz)) {
              if (ny < 0 && !dimInfinite()) continue;
              sealed = false;
              break;
            }
            if (lakeAtCell(st, readBlock, nx, ny, nz) !== 0) continue;
            const kk = key(nx, ny, nz);
            if (seenS.has(kk)) continue;
            seenS.add(kk);
            sstack.push([nx, ny, nz]);
          }
        }
        const fillId = sealed ? st.WATER : st.ROCK;
        const fillGrid = sealed ? 1 : 2;
        for (const [fx, fy, fz] of cells) {
          if (lakeInBox(st, fx, fy, fz)) st.grid[lakeGi(st, fx, fy, fz)] = fillGrid;
          setBlock(fx, fy, fz, fillId);
        }
        st.filled += cells.length;
      }
      y = st.y0;
    }
    z = st.z0;
  }
  st.scanDone = true;
  return true;
}

// Sliced lake join driver: same 20-pass fixpoint as the synchronous twin
// below. Each call advances the current lake as many phases (peel, scan)
// as fit the time budget, then resumes next call — one call costs a few
// ms instead of a whole lake. Returns true when the join is fully done.
export function joinBodyLakeWaterStart() {
  return { pass: 0, li: 0, filled: 0, purged: 0, cur: null };
}
// One lake to completion through the phase pumps (same verdicts as the
// sliced driver — the pumps share its state and order).
function pumpLakeJoin(st, spec, setBlock, readBlock, deadline) {
  if (!st.peelDone && !pumpLakePeel(st, spec, setBlock, readBlock, deadline)) return false;
  st.peelDone = true;
  if (!st.scanDone && !pumpLakeScan(st, spec, setBlock, readBlock, deadline)) return false;
  st.scanDone = true;
  return true;
}
export function joinBodyLakeWaterSlice(spec, seed, setBlock, readBlock, st) {
  const R = spec.r ?? MOON_R;
  const base = spec.top ?? MOON_SURFACE_Y;
  const bottom0 = spec.bottom ?? MOON_MIN_Y;
  const lakes = bodyLakeParams(spec, seed);
  if (!lakes.length) return true;
  if (!st.cur || st.cur.li !== st.li || st.cur.pass !== st.pass) {
    const ctx = { y0: bottom0 - 1, y1: base + 1, R2: R * R, base, WATER: spec.water, ROCK: spec.rock };
    st.cur = beginLakeJoin(spec, readBlock, ctx, lakes[st.li]);
    st.cur.li = st.li;
    st.cur.pass = st.pass;
  }
  const deadline = performance.now() + JOIN_PHASE_MS;
  for (;;) {
    if (pumpLakeJoin(st.cur, spec, setBlock, readBlock, deadline)) break;
    return false;
  }
  st.filled += st.cur.filled;
  st.purged += st.cur.purged;
  st.cur = null;
  if (++st.li >= lakes.length) {
    if (!st.filled && !st.purged) return true;
    if (++st.pass >= 20) return true;
    st.li = 0; st.filled = 0; st.purged = 0;
  }
  return false;
}
export function joinBodyLakeWater(spec, seed, setBlock, readBlock) {
  const st = joinBodyLakeWaterStart();
  let guard = 4096;
  while (!joinBodyLakeWaterSlice(spec, seed, setBlock, readBlock, st) && guard-- > 0);
}

export function joinMoonLakeWater(seed, setBlock, readBlock) {
  joinBodyLakeWater(MOON_SPEC, seed, setBlock, readBlock);
}

// Lake-mask column iterator: every lake-shaft column with its sphere
// bottom, shared by the surface writer and the well restore below so the
// mask math exists exactly once.
export function eachBodyLakeCol(spec, seed, x0, x1, cb) {
  const R = spec.r ?? MOON_R;
  const base = spec.top ?? MOON_SURFACE_Y;
  const R2 = R * R;
  for (const { cx, cz, cr, i } of bodyLakeParams(spec, seed)) {
    for (let dx = -cr - 1; dx <= cr + 1; dx++) {
      if (cx + dx < x0 || cx + dx >= x1) continue;
      for (let dz = -cr - 1; dz <= cr + 1; dz++) {
        const ang = Math.atan2(dz, dx);
        const noise = (hash2(cx + dx, cz + dz, seed + spec.lakeSalt) - 0.5) * 1.8;
        const rr = cr + noise + Math.sin(ang * 3 + i) * 0.7;
        if (dx * dx + dz * dz > rr * rr) continue;
        const x = cx + dx, z = cz + dz;
        const ox = x - spec.cx, oz = z - spec.cz;
        const d2 = ox * ox + oz * oz;
        if (d2 > R2) continue;
        const h = Math.floor(Math.sqrt(R2 - d2));
        if (h === 0) continue;
        cb(x, z, base - h);
      }
    }
  }
}

// Well restore: rewrite lake-mask columns below the cap to body water,
// healing sealed-era rock (the seal paved wells the slicer never rewrites:
// the moon path skips surface rows to preserve player mining, and the
// water-skip guard passes sealed rock by). Only ROCK cells convert, only
// below the cap (cap-level player edits are untouched), keeps respected.
// Runs inside every sliced fill after the under-rows, before the join;
// idempotent once converged.
export function restoreBodyLakeWells(spec, seed, setBlock, getBlock = null) {
  const thick = spec.thick ?? MOON_THICK;
  const base = spec.top ?? MOON_SURFACE_Y;
  const capFloor = base - thick;
  const keep = keptBodyCells(spec, seed);
  const R = spec.r ?? MOON_R;
  eachBodyLakeCol(spec, seed, spec.cx - R, spec.cx + R + 1, (x, z, bottom) => {
    for (let y = bottom; y <= capFloor; y++) {
      if (y < 0) continue;
      if (keep && keep.has(x + "," + y + "," + z)) continue;
      if (getBlock && getBlock(x, y, z) !== spec.rock) continue;
      setBlock(x, y, z, spec.water);
    }
  });
}

function generateBodyLakes(spec, seed, setBlock, x0 = -Infinity, x1 = Infinity) {
  const base = spec.top ?? MOON_SURFACE_Y;
  const keep = keptBodyCells(spec, seed);
  eachBodyLakeCol(spec, seed, x0, x1, (x, z, bottom) => {
    // Open wells: the shafts pierce the hollow underside down to the
    // sphere bottom so the lakes read as water columns from below too
    // (master behavior — visible, swimmable, hand-unbreakable like all
    // liquids since the DDA skips them).
    for (let y = bottom; y <= base; y++) {
      if (y < 0) continue;
      if (keep && keep.has(x + "," + y + "," + z)) continue;
      setBlock(x, y, z, spec.water);
    }
  });
}

function generateMoonLakes(seed, setBlock) {
  generateBodyLakes(MOON_SPEC, seed, setBlock);
}
