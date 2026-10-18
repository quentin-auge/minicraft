// Spawn selection on finished voxel data: firm open ground near the origin
// with a frustum-wide clear vista. Pure math over the voxel store, no THREE
// dependency, so the headless world-gen harness asserts it directly;
// physics.js applies the result to the player body.
import { isLiquid, CLOUD, MOON, LOG, LEAVES } from "../core/blocks.js";
import { getBlock, isSolid, topAt, dim, WATER_LEVEL } from "../core/store.js";
import { MOON_MIN_Y } from "./moon.js";
import { village } from "./village.js";

// Spawn spec: feet stay inside this disc; the vista must be clear this far
// ahead across the whole checked swath, this many rows above the eye row.
export const SPAWN_SEARCH_R = 48;
export const VIEW_DIRS = 8;
export const VIEW_DIST = 50;
export const VIEW_UP = 12;
// Half-angle of the checked swath: matches the in-game FOV, so trunks,
// walls, and hillsides at the frame edges fail a facing just like centered
// ones. A trunk just off the center ray fills the frame up close; the
// corridor below keeps it out of view.
const VIEW_HALF_TAN = Math.tan((75 / 2) * Math.PI / 180);
// Pen margin: feet never inside the pen or leaning on its walls.
const PEN_MARGIN = 1;

// Highest standable ground in a column: solid dry land, never tree matter,
// with open headroom. Null for water, tree columns, roofed, or empty columns.
// Starts below the moon band (moon rock never qualifies for footing, so
// scanning it is pure cost once the lazy fill lands).
function groundHeightAt(x, z) {
  const top = Math.min(topAt(dim, x, z), MOON_MIN_Y - 1);
  for (let y = top; y >= 0; y--) {
    const id = getBlock(x, y, z);
    if (id === CLOUD || id === MOON) continue;
    if (id === LOG || id === LEAVES) return null;
    if (isSolid(x, y, z)) {
      if (isLiquid(id) || y <= WATER_LEVEL) return null;
      if (isSolid(x, y + 1, z) || isSolid(x, y + 2, z)) return null;
      return y;
    }
  }
  return null;
}

function inPen(x, z) {
  const p = village.pen;
  if (!p) return false;
  return x >= p.minX - PEN_MARGIN && x <= p.maxX + PEN_MARGIN &&
    z >= p.minZ - PEN_MARGIN && z <= p.maxZ + PEN_MARGIN;
}

// Clearance across the visible swath, not just the center ray: every solid
// cell inside the corridor fails the facing, so no vertical surface — wall,
// trunk, hillside, canopy — stands anywhere in the frame. Eye row first, in
// its own march (the common blocker, cheapest to test); the window above
// only marches for swaths the eye row clears. Marching at absolute eye
// height fails rising ground.
function viewScore(ex, ey, ez, facing) {
  const dx = -Math.sin(facing), dz = -Math.cos(facing);
  const px = -dz, pz = dx;
  const by = Math.floor(ey);
  for (let t = 1; t <= VIEW_DIST; t++) {
    const w = Math.ceil(t * VIEW_HALF_TAN);
    const cx = ex + dx * t, cz = ez + dz * t;
    for (let k = -w; k <= w; k++) {
      if (isSolid(Math.floor(cx + px * k), by, Math.floor(cz + pz * k))) return t - 1;
    }
  }
  for (let t = 1; t <= VIEW_DIST; t++) {
    const w = Math.ceil(t * VIEW_HALF_TAN);
    const cx = ex + dx * t, cz = ez + dz * t;
    for (let k = -w; k <= w; k++) {
      const bx = Math.floor(cx + px * k), bz = Math.floor(cz + pz * k);
      for (let dy = 1; dy <= VIEW_UP; dy++) {
        if (isSolid(bx, by + dy, bz)) return t - 1;
      }
    }
  }
  return VIEW_DIST;
}

function bestFacing(ex, ey, ez) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < VIEW_DIRS; i++) {
    const facing = (i / VIEW_DIRS) * Math.PI * 2;
    const s = viewScore(ex, ey, ez, facing);
    if (s > bestScore) { bestScore = s; best = facing; }
    if (s >= VIEW_DIST) break;
  }
  return [best, bestScore];
}

// Nearest-to-origin firm open ground with a guaranteed-clear vista when one
// exists inside the search disc. Never in the pen, never wet. Falls back to
// the best vista found, loudly, on pathological seeds. Eye height is a
// parameter so this module never imports player state.
export function findSpawn(eyeHeight) {
  let fx = 0, fz = 0, fy = 0, ff = 0, bestScore = -1;
  for (let r = 0; r <= SPAWN_SEARCH_R; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (inPen(dx, dz)) continue;
        const gy = groundHeightAt(dx, dz);
        if (gy === null) continue;
        let open = true;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ng = groundHeightAt(dx + ox, dz + oz);
          if (ng === null || Math.abs(ng - gy) > 2) { open = false; break; }
        }
        if (!open) continue;
        const [f, s] = bestFacing(dx + 0.5, gy + 1 + eyeHeight, dz + 0.5);
        if (s > bestScore) { bestScore = s; fx = dx; fz = dz; fy = gy; ff = f; }
        if (s >= VIEW_DIST) return { x: dx, z: dz, y: gy, yaw: f };
      }
    }
  }
  if (bestScore < 0) {
    const top = Math.min(topAt(dim, 0, 0), MOON_MIN_Y - 1);
    for (let y = top; y >= 0; y--) {
      if (isSolid(0, y, 0)) { fy = y; break; }
    }
    ff = bestFacing(0.5, fy + 1 + eyeHeight, 0.5)[0];
  } else if (bestScore < VIEW_DIST) {
    console.warn(`findSpawn: no ${VIEW_DIST}-clear vista in radius ${SPAWN_SEARCH_R}, best ${bestScore}`);
  }
  return { x: fx, z: fz, y: fy, yaw: ff };
}
