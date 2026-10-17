// The Moon: a thick rock disc high above the clouds with hashed water
// lakes, ported from master (same geometry, same salts). Altitudes derive
// from the cloud bounds so the whole sky stacks from one anchor. Lakes
// generate eagerly with the shell: the sparse mesher makes master's
// near-moon visibility gate obsolete.
import { MOON, MOON_WATER } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import { WORLD_RADIUS } from "../core/store.js";

export const MOON_R = WORLD_RADIUS;
export const MOON_THICK = 5;
// Hand-picked lower end; the surface derives upward from it.
export const MOON_MIN_Y = 850;
export const MOON_SURFACE_Y = MOON_MIN_Y + MOON_R;
// Fade band, hand-picked: the disc ramps from invisible to solid between
// 495 and 515, starting once the sky is fully black. Driven every
// frame — no remeshing, so nothing can pop in chunk by chunk.
export const MOON_FADE_Y = 495;
export const MOON_FADE_END = 515;

export function generateMoon(seed, setBlock) {
  const R = MOON_R;
  const base = MOON_SURFACE_Y;
  const R2 = R * R;
  const inner = (R - MOON_THICK) * (R - MOON_THICK);
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d2 = x * x + z * z;
    if (d2 > R2) continue;
    const h = Math.floor(Math.sqrt(R2 - d2));
    for (let y = base - MOON_THICK + 1; y <= base; y++) {
      if (y < 0) continue;
      setBlock(x, y, z, MOON);
    }
    for (let y = base - h; y < base - MOON_THICK + 1; y++) {
      const dy = base - y;
      const dist2 = d2 + dy * dy;
      if (dist2 <= R2 && dist2 >= inner) {
        if (y < 0) continue;
        setBlock(x, y, z, MOON);
      }
    }
  }
  generateMoonLakes(seed, setBlock);
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
