// The Moon: a thick rock disc high above the clouds with hashed water
// lakes, ported from master (same geometry, same salts). Altitudes derive
// from the cloud bounds so the whole sky stacks from one anchor. Only the
// surface (cap + lake shafts) builds with the world — spawn stands on it,
// so tops are final before the player exists. The hollow underside shell
// fills lazily after the reveal in row slices: unreachable within its
// few-second window, so startup never pays for it. Overwrites are
// deterministic, so a resumed or repeated fill is identical — no clearing
// pass needed.
import { MOON, MOON_WATER } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import { WORLD_RADIUS, CHUNK, getBlock, isSolid } from "../core/store.js";

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
}

// Surface-defining voxels (cap shell + lake shafts): eager in worldgen,
// before spawn. Column tops are final afterwards, so spawn, lights, and
// portals all agree with the post-fill world.
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
// first so the lake shafts overwrite it, then surface. Idempotent per seed.
export function generateMoon(seed, setBlock, getBlock = null) {
  generateMoonUnderRows(seed, setBlock, -MOON_R, MOON_R + 1, getBlock);
  generateMoonSurface(seed, setBlock);
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

function generateMoonLakes(seed, setBlock) {
  const R = MOON_R;
  const base = MOON_SURFACE_Y;
  const R2 = R * R;
  for (let i = 0; i < 6; i++) {
    const a = hash2(i, 11, seed + 9211) * Math.PI * 2;
    const r = Math.sqrt(hash2(i, 12, seed + 9212)) * (R * 0.66);
    const cx = Math.round(Math.cos(a) * r);
    const cz = Math.round(Math.sin(a) * r);
    const cr = 4 + Math.floor(hash2(i, 13, seed + 9213) * 4);
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
