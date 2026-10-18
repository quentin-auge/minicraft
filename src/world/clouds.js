// Climbable cloud decks, ported from master (frozen band, same math).
// Solid white ellipsoid-puff clusters scattered per layer; ~30% scaled 2x.
// The Y bounds are exported so other systems (spawn, sky) reuse them
// instead of hard-coding altitudes. They anchor the layer bases; puff
// offsets and ellipsoid radii spill a few blocks past either end,
// exactly as on master.
import { CLOUD } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import { WORLD_RADIUS } from "../core/store.js";

export const CLOUD_MIN_Y = 100;
export const CLOUD_LAYER_H = 120;
export const CLOUD_LAYERS = 3;
export const CLOUD_MAX_Y = CLOUD_MIN_Y + CLOUD_LAYERS * CLOUD_LAYER_H;

// Generic puff-cluster scatter: overworld clouds are one specialization
// (layered decks of CLOUD), the TNT dimension another (3D lattice of TNT).
// Block choice is injected via blockFor(l, i), so tiers stay data, not forks.
export function generateCloudClusters(seed, setBlock, opts) {
  const { layers, layerH, minY, count, salt, blockFor, puffMin, puffSpan, allowScale2 } = opts;
  for (let l = 0; l < layers; l++) {
    const lo = minY + l * layerH;
    const ls = seed + salt + l * 131;
    for (let i = 0; i < count; i++) {
      const id = blockFor(l, i, ls);
      if (id === null || id === undefined) continue;
      const cx = Math.round((hash2(i, 1, ls) * 2 - 1) * (WORLD_RADIUS - 8));
      const cz = Math.round((hash2(i, 2, ls) * 2 - 1) * (WORLD_RADIUS - 8));
      const scale = allowScale2 && hash2(i, 8, ls) < 0.3 ? 2 : 1;
      const yBase = lo + Math.floor(hash2(i, 5, ls) * (layerH - 8));
      const puffs = puffMin + Math.floor(hash2(i, 7, ls) * puffSpan);
      const spread = (1.5 + hash2(i, 3, ls) * 4) * scale;
      for (let p = 0; p < puffs; p++) {
        const ox = (hash2(i, p, 111 + l) * 2 - 1) * spread;
        const oz = (hash2(i, p, 222 + l) * 2 - 1) * spread;
        const oy = (hash2(i, p, 333 + l) - 0.5) * spread * 0.5;
        const Px = cx + Math.round(ox);
        const Pz = cz + Math.round(oz);
        const Py = yBase + Math.round(oy);
        const ra = 1 + Math.round((1.5 + hash2(i, p, 444 + l) * 3) * scale);
        const rb = 1 + Math.round((1.5 + hash2(i, p, 555 + l) * 2.5) * scale);
        const rh = 1 + Math.round((hash2(i, p, 666 + l) * 2.5) * scale);
        const mx = Math.ceil(ra), mz = Math.ceil(rb), my = Math.ceil(rh);
        for (let dx = -mx; dx <= mx; dx++)
          for (let dz = -mz; dz <= mz; dz++)
            for (let dy = -my; dy <= my; dy++) {
              if (dx * dx / (ra * ra) + dz * dz / (rb * rb) + dy * dy / (rh * rh) > 1) continue;
              const yy = Py + dy;
              if (yy < 0) continue;
              setBlock(Px + dx, yy, Pz + dz, id);
            }
      }
    }
  }
}

export function generateClouds(seed, setBlock) {
  const n = Math.round(((WORLD_RADIUS * 2) * (WORLD_RADIUS * 2)) / 1100);
  generateCloudClusters(seed, setBlock, {
    layers: CLOUD_LAYERS, layerH: CLOUD_LAYER_H, minY: CLOUD_MIN_Y,
    count: n, salt: 4242, blockFor: () => CLOUD,
    puffMin: 3, puffSpan: 3, allowScale2: true,
  });
}
