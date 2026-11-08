// Static air-pocket test: an air cell counts as a pocket when its air is
// trapped laterally and below by non-air (solid or any liquid). The flood
// never steps +y, so a well shaft open to the sky still traps while the open
// surface (connected sideways) never does. Mixed liquid + solid walls trap;
// the face keeps its own liquid's inside color on its liquid-side sheet
// (the air-side sheet keeps the outside color). Three-free: decision only,
// the mesher splits quads through it at build time.
import { AIR } from "./blocks.js";
import { dimInfinite, getBlock, key, outOfWorld } from "./store.js";

// Sideways + downward steps only: upward escape never disqualifies a shaft.
const DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// Wells are tiny; open air hits the cap fast and shares the per-build cache.
export const AIR_POCKET_CAP = 1024;

export function createPocketCache() {
  return new Map();
}

// cache: per-chunk-build Map (key -> bool), shared across the chunk's quads.
export function isPocketAir(ax, ay, az, cache) {
  if (getBlock(ax, ay, az) !== AIR) return false;
  const start = key(ax, ay, az);
  if (cache) {
    const hit = cache.get(start);
    if (hit !== undefined) return hit;
  }
  const seen = [start];
  const seenSet = new Set([start]);
  const stack = [[ax, ay, az]];
  while (stack.length) {
    if (seen.length >= AIR_POCKET_CAP) {
      if (cache) for (const k of seen) cache.set(k, false);
      return false;
    }
    const [x, y, z] = stack.pop();
    for (let i = 0; i < DIRS.length; i++) {
      const nx = x + DIRS[i][0], ny = y + DIRS[i][1], nz = z + DIRS[i][2];
      if (outOfWorld(nx, ny, nz)) {
        // Bounded dims stand on the y = 0 floor: below it blocks like
        // solid instead of reading as open air (floorless dims stay open).
        if (ny < 0 && !dimInfinite()) continue;
        if (cache) for (const k of seen) cache.set(k, false);
        return false;
      }
      if (getBlock(nx, ny, nz) !== AIR) continue;
      const k = key(nx, ny, nz);
      if (cache) {
        const known = cache.get(k);
        if (known === false) {
          for (const s of seen) cache.set(s, false);
          return false;
        }
        if (known === true) continue;
      }
      if (seenSet.has(k)) continue;
      seenSet.add(k);
      seen.push(k);
      stack.push([nx, ny, nz]);
    }
  }
  if (cache) for (const k of seen) cache.set(k, true);
  return true;
}
