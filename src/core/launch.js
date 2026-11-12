// Shared mega-launch ballistics (three-free): the exact ground-branch
// replica of the player knockback, so mobs caught in a mega pool fly the
// same arc as the player and land the same 1.5R out. Pure math, no scene:
// both the player path (fx/tnt.js) and the mob flight (mobs/mover.js)
// dispatch through computeMegaLaunch, so the two trajectories cannot drift.
export const PLAYER_GRAVITY = 37.44;
// Launch speed clamp (m/s): the far-travel cap keeps wall-adjacent bodies
// inside the world instead of tunneling through it.
export const LAUNCH_VMIN = 4;
export const LAUNCH_VMAX = 40;

// Body-center launch off a pool centroid (cx/cy/cz are block coords, hence
// the +0.5). Returns {vx, vy, vz} or null when the body starts outside R.
export function computeMegaLaunch(px, py, pz, cx, cy, cz, R) {
  const dx0 = px - (cx + 0.5), dy0 = py - (cy + 0.5), dz0 = pz - (cz + 0.5);
  if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 >= R * R) return null;
  let dx = px - (cx + 0.5), dz = pz - (cz + 0.5);
  let d0 = Math.hypot(dx, dz);
  if (d0 < 0.001) { dx = 1; dz = 0; d0 = 0.001; } else { dx /= d0; dz /= d0; }
  const f = Math.max(0, 1 - d0 / (R * 2));
  const Vup = 22 + 8 * f;
  const airT = (2 * Vup) / PLAYER_GRAVITY;
  // Ballistic arc with uniform 1.5R travel from the center.
  const need = 1.5 * R;
  const V0 = Math.min(LAUNCH_VMAX, Math.max(LAUNCH_VMIN, need / Math.max(0.5, airT)));
  return { vx: dx * V0, vy: Vup, vz: dz * V0 };
}
