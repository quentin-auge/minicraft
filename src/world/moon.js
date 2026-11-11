// The Moon: a thick rock disc high above the clouds with hashed water
// lakes, ported from master (same geometry, same salts). Altitudes derive
// from the cloud bounds so the whole sky stacks from one anchor. Only the
// surface (cap + lake shafts) builds with the world — spawn stands on it,
// so tops are final before the player exists. The hollow underside shell
// fills lazily after the reveal in row slices: unreachable within its
// few-second window, so startup never pays for it. Overwrites are
// deterministic, so a resumed or repeated fill is identical — no clearing
// pass needed.
import { AIR, MOON, MOON_WATER } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import { WORLD_RADIUS, CHUNK, getBlock, isSolid, dimInfinite, outOfWorld, key, worlds } from "../core/store.js";
import { AIR_POCKET_CAP } from "../core/airpocket.js";

export const MOON_R = WORLD_RADIUS;
export const MOON_THICK = 5;
// Hand-picked lower end; the surface derives upward from it. The reveal
// region (render/regions.js) reads MOON_MIN_Y as the disc's volume bound.
export const MOON_MIN_Y = 850;
export const MOON_SURFACE_Y = MOON_MIN_Y + MOON_R;

// Fill state per world seed: underside complete (the surface always builds
// with the world; meshing of the shell follows via chunk refresh).
// resetMoon clears it; every New World regenerates from empty.
let builtSeed = null;
export function moonReady(seed) {
  return builtSeed === seed;
}
export function resetMoon() {
  builtSeed = null;
  markMoonDirty();
}

// Gone flag: true once no MOON rock and no MOON_WATER remain in the
// overworld (ultra band-3 wipe, hand mining, rocket carve — any path).
// Lazy + cached: mutation paths in the moon band mark dirty, the next read
// scans the overworld map with an early exit on the first lunar block, so
// per-frame callers (snow, gravity, hotbar) stay O(1).
let moonGoneCache = false;
let moonGoneDirty = true;
export function markMoonDirty() {
  moonGoneDirty = true;
}
export function isMoonGone() {
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
// (joinMoonLakeWater, after the shell exists): shell-adjacent pinched air
// only reads as a pocket once the shell is in place.
export function generateMoonSurface(seed, setBlock) {
  const R = MOON_R;
  const base = MOON_SURFACE_Y;
  const R2 = R * R;
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    if (x * x + z * z > R2) continue;
    for (let y = base - MOON_THICK + 1; y <= base; y++) {
      setBlock(x, y, z, MOON);
    }
  }
  generateMoonLakes(seed, setBlock);
}

// Hollow underside shell in x-row slices (lazy background fill): same
// voxels as the eager port, just deferred. Deterministic per geometry
// (no seed hash), so repeats are identical. Never seals the lake shafts:
// existing moon water is left in place so the wells stay open below.
export function generateMoonUnderRows(seed, setBlock, x0, x1, getBlock = null) {
  const R = MOON_R;
  const base = MOON_SURFACE_Y;
  const R2 = R * R;
  const inner = (R - MOON_THICK) * (R - MOON_THICK);
  for (let x = Math.max(x0, -R); x < Math.min(x1, R + 1); x++) for (let z = -R; z <= R; z++) {
    const d2 = x * x + z * z;
    if (d2 > R2) continue;
    const h = Math.floor(Math.sqrt(R2 - d2));
    for (let y = base - h; y < base - MOON_THICK + 1; y++) {
      const dy = base - y;
      const dist2 = d2 + dy * dy;
      if (dist2 <= R2 && dist2 >= inner) {
        if (getBlock && getBlock(x, y, z) === MOON_WATER) continue;
        setBlock(x, y, z, MOON);
      }
    }
  }
}

export function markMoonBuilt(seed) {
  builtSeed = seed;
}

// Full synchronous fill (underside safety net, headless harness): shell
// first so the lake shafts overwrite it, then surface, then the lake join
// (shell present, so pinched air reads exactly as the mesher will see it).
// Idempotent per seed.
export function generateMoon(seed, setBlock, getBlock = null) {
  generateMoonUnderRows(seed, setBlock, -MOON_R, MOON_R + 1, getBlock);
  generateMoonSurface(seed, setBlock);
  if (getBlock) joinMoonLakeWater(seed, setBlock, getBlock);
  markMoonBuilt(seed);
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
// only built chunks remesh (streaming builds the rest with underside
// voxels already in place, since the fill completes before the refresh
// pass; the surface was meshed at build).
export function moonChunkCenters() {
  const out = [];
  const R = MOON_R;
  const C = Math.ceil(R / CHUNK);
  for (let cx = -C; cx <= C; cx++) for (let cz = -C; cz <= C; cz++) {
    const x0 = cx * CHUNK, x1 = cx * CHUNK + CHUNK - 1;
    const z0 = cz * CHUNK, z1 = cz * CHUNK + CHUNK - 1;
    const nx = Math.max(x0, Math.min(0, x1)), nz = Math.max(z0, Math.min(0, z1));
    if (nx * nx + nz * nz <= R * R) out.push([x0 + (CHUNK >> 1), 0, z0 + (CHUNK >> 1)]);
  }
  return out;
}

export function moonLakeParams(seed) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = hash2(i, 11, seed + 9211) * Math.PI * 2;
    const r = Math.sqrt(hash2(i, 12, seed + 9212)) * (MOON_R * 0.66);
    out.push({
      cx: Math.round(Math.cos(a) * r),
      cz: Math.round(Math.sin(a) * r),
      cr: 4 + Math.floor(hash2(i, 13, seed + 9213) * 4),
      i,
    });
  }
  return out;
}

// Lake join: fill the air the shafts enclose with moon water, so the lakes
// read as contiguous water volumes and no moon-water face keeps a pocket
// back. Runs only once the shell exists (sync full fill, lazy-fill tail in
// main.js) — testing earlier would miss the pinches the shell itself
// closes. Scoped to the lake boxes, existing water never touched,
// idempotent. The noisy shoreline leaves moon-rock teeth fully ringed by
// water, so a rock peel runs first: any solid cell with moon water on all
// four sides converts its whole column (lake bottom to surface) to moon
// water, peeling to a fixpoint — only truly isolated teeth go, the shore
// stays, and the new water only feeds the air pass below, never the
// reverse. Exact per-cell floods over a dense box snapshot (fresh
// visited set each: a shared cache can hide a truly-trapped notch behind
// neighbouring open air), with the same move set, cap, and floor rule as
// airpocket.js — keep the two in sync. A second all-directions flood then
// splits the verdict: fully sealed components fill with moon water, while
// hollow-linked pits (reachable upward) fill with moon rock, so the
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
export function joinMoonLakeWater(seed, setBlock, readBlock) {
  const base = MOON_SURFACE_Y;
  const R2 = MOON_R * MOON_R;
  const y0 = MOON_MIN_Y - 1, y1 = base + 1;
  for (let pass = 0; pass < 20; pass++) {
    let filled = 0, purged = 0;
    for (const { cx, cz, cr } of moonLakeParams(seed)) {
      const x0 = cx - cr - 6, x1 = cx + cr + 6;
      const z0 = cz - cr - 6, z1 = cz + cr + 6;
      const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
      const grid = new Uint8Array(sx * sy * sz);
      const gi = (x, y, z) => ((x - x0) * sz + (z - z0)) * sy + (y - y0);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++)
          for (let y = y0; y <= y1; y++) {
            const id = readBlock(x, y, z);
            grid[gi(x, y, z)] = id === AIR ? 0 : id === MOON_WATER ? 1 : 2;
          }
      const inBox = (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
      const atCell = (x, y, z) => {
        if (inBox(x, y, z)) return grid[gi(x, y, z)];
        const id = readBlock(x, y, z);
        return id === AIR ? 0 : id === MOON_WATER ? 1 : 2;
      };
      // Rock-tooth peel: a solid cell with moon water on all four sides is
      // a shoreline tooth, so its whole column becomes lake water, from the
      // sphere bottom (same formula as the lake fill) to the surface.
      // Shore rock always keeps a solid neighbour, so it never peels.
      let moved = true;
      while (moved) {
        moved = false;
        for (let x = x0; x <= x1 && !moved; x++)
          for (let z = z0; z <= z1 && !moved; z++) {
            const d2 = x * x + z * z;
            if (d2 > R2) continue;
            const h = Math.floor(Math.sqrt(R2 - d2));
            if (h === 0) continue;
            const bottom = base - h;
            for (let y = y0; y <= y1; y++) {
              if (grid[gi(x, y, z)] !== 2) continue;
              if (
                atCell(x + 1, y, z) !== 1 || atCell(x - 1, y, z) !== 1 ||
                atCell(x, y, z + 1) !== 1 || atCell(x, y, z - 1) !== 1
              ) continue;
              for (let cy = bottom; cy <= base; cy++) {
                if (grid[gi(x, cy, z)] !== 1) {
                  if (inBox(x, cy, z)) grid[gi(x, cy, z)] = 1;
                  setBlock(x, cy, z, MOON_WATER);
                }
              }
              purged++;
              moved = true;
              break;
            }
          }
      }
      // Sound-open marks: forward propagation only (a cell is open when one
      // of its flood moves lands on open air), never flood sharing.
      const openM = new Uint8Array(sx * sy * sz);
      const openWork = [];
      const markOpen = (x, y, z) => {
        if (!inBox(x, y, z) || grid[gi(x, y, z)] !== 0 || openM[gi(x, y, z)]) return;
        openM[gi(x, y, z)] = 1;
        openWork.push([x, y, z]);
      };
      const drainOpen = () => {
        while (openWork.length) {
          const [px, py, pz] = openWork.pop();
          // Reverse moves: cells stepping into (px, py, pz) sideways or down.
          if (atCell(px + 1, py, pz) === 0) markOpen(px + 1, py, pz);
          if (atCell(px - 1, py, pz) === 0) markOpen(px - 1, py, pz);
          if (atCell(px, py, pz + 1) === 0) markOpen(px, py, pz + 1);
          if (atCell(px, py, pz - 1) === 0) markOpen(px, py, pz - 1);
          if (atCell(px, py + 1, pz) === 0) markOpen(px, py + 1, pz);
        }
      };
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++)
          for (let y = y0; y <= y1; y++) {
            if (grid[gi(x, y, z)] !== 0 || openM[gi(x, y, z)]) continue;
            if (
              atCell(x + 1, y, z) !== 1 && atCell(x - 1, y, z) !== 1 &&
              atCell(x, y + 1, z) !== 1 && atCell(x, y - 1, z) !== 1 &&
              atCell(x, y, z + 1) !== 1 && atCell(x, y, z - 1) !== 1
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
                if (atCell(nx, ny, nz) !== 0) continue;
                const kk = key(nx, ny, nz);
                if (seenF.has(kk)) continue;
                seenF.add(kk);
                stack.push([nx, ny, nz]);
              }
            }
            if (open) {
              markOpen(x, y, z);
              drainOpen();
              continue;
            }
            // Sealed check: a trapped component that still escapes upward is
            // hollow-linked, not sealed. Sealed notches fill with moon water
            // (uniform inside tint); hollow-linked pits fill with moon rock,
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
                if (atCell(nx, ny, nz) !== 0) continue;
                const kk = key(nx, ny, nz);
                if (seenS.has(kk)) continue;
                seenS.add(kk);
                sstack.push([nx, ny, nz]);
              }
            }
            const fillId = sealed ? MOON_WATER : MOON;
            const fillGrid = sealed ? 1 : 2;
            for (const [fx, fy, fz] of cells) {
              if (inBox(fx, fy, fz)) grid[gi(fx, fy, fz)] = fillGrid;
              setBlock(fx, fy, fz, fillId);
            }
            filled += cells.length;
          }
    }
    if (!filled && !purged) break;
  }
}

function generateMoonLakes(seed, setBlock) {
  const R = MOON_R;
  const base = MOON_SURFACE_Y;
  const R2 = R * R;
  for (const { cx, cz, cr, i } of moonLakeParams(seed)) {
    for (let dx = -cr - 1; dx <= cr + 1; dx++) for (let dz = -cr - 1; dz <= cr + 1; dz++) {
      const ang = Math.atan2(dz, dx);
      const noise = (hash2(cx + dx, cz + dz, seed + 9220) - 0.5) * 1.8;
      const rr = cr + noise + Math.sin(ang * 3 + i) * 0.7;
      if (dx * dx + dz * dz > rr * rr) continue;
      const x = cx + dx, z = cz + dz;
      const d2 = x * x + z * z;
      if (d2 > R2) continue;
      const h = Math.floor(Math.sqrt(R2 - d2));
      if (h === 0) continue;
      const bottom = base - h;
      for (let y = bottom; y <= base; y++) {
        if (y < 0) continue;
        setBlock(x, y, z, MOON_WATER);
      }
    }
  }
}
