// Deep-space speed zone: the rocket keeps its base caps near every celestial
// body and ramps to a multiplier in the open void between them. The point
// lookup reads the 3D surface distance to the nearest body; the descent path
// in the flight loop reads the min vertical gap from the bbox bottom over the
// whole footprint — analytic bodies plus the voxel scan below (any surface) —
// so a descent eases back toward the base cap instead of past a flank.
// Below the Moon surface the zone is inert (the atmosphere and the ground
// keep the base speed). All rules live behind the shared ramp helper below.
//
// The void multiplier tracks the band's inner radius: cruise speed grows
// linearly with it, so the Moon-to-planets trip takes the same time at any
// band setting. Only the cruise plateau scales — the acceleration/braking
// ramps, the buffer geometry, and the near-body landing caps are untouched.
import { MOON_SURFACE_Y, BAND_R0, nearestBody, bodySpecs } from "./planets.js";

export const SPACE_MUL = 6;
export const SPACE_BUFFER = 50;
export const SPACE_RAMP = 600;

// Inner band radius the ×6 cruise was tuned for: the live multiplier scales
// with BAND_R0 against this reference (currently 25000/8000, ×18.75).
const CRUISE_REF_R0 = 8000;

// Effective void multiplier for the live band.
export function spaceMul() {
  return SPACE_MUL * Math.max(1, BAND_R0 / CRUISE_REF_R0);
}

const smooth = (t) => t * t * (3 - 2 * t);

// Ramp helper: multiplier for an exact surface distance (single authority
// behind every caller — the point lookup below and the bbox descent path in
// the flight loop). 1 inside the buffer, smooth ramp to the live void
// multiplier SPACE_RAMP blocks past it.
export function spaceFactorFromDist(dist) {
  const mul = spaceMul();
  if (!Number.isFinite(dist)) return mul;
  const t = Math.max(0, Math.min(1, (dist - SPACE_BUFFER) / SPACE_RAMP));
  return 1 + (mul - 1) * smooth(t);
}

// Speed multiplier at a point: 1 inside a body's buffer, rising smoothly to
// the live void multiplier once the point is SPACE_RAMP blocks past that buffer.
export function spaceSpeedMul(x, y, z) {
  if (y < MOON_SURFACE_Y) return 1;
  return spaceFactorFromDist(takeoffDist(x, y, z));
}

// Takeoff distance: 3D surface distance to the nearest body (Infinity = void).
export function takeoffDist(x, y, z) {
  const near = nearestBody(x, y, z);
  return near ? near.dist : Infinity;
}

// Bbox landing distance: the vertical gap to the bodies' XZ footprints,
// measured from the bbox bottom over every footprint column (integer cells,
// like the contact tests), min retained — a wide hull slows as soon as one
// column closes within the band, and a descent past every flank reads void.
export function landingDistBox(ox, yBottom, oz, vbox) {
  const fx = Math.floor(ox), fz = Math.floor(oz);
  let best = Infinity;
  for (let lx = vbox.x0; lx <= vbox.x1; lx++)
    for (let lz = vbox.z0; lz <= vbox.z1; lz++) {
      const x = fx + lx, z = fz + lz;
      for (const b of bodySpecs()) {
        const dx = x - b.cx, dz = z - b.cz;
        if (dx * dx + dz * dz > b.r * b.r) continue;
        const v = Math.max(b.bottom - yBottom, yBottom - b.top, 0);
        if (v < best) best = v;
      }
    }
  return best;
}
