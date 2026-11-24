// Deep-space speed zone: the rocket keeps its base caps near every celestial
// body and ramps to a multiplier in the open void between them. The buffer is
// measured from the nearest body's solid cylinder; below the Moon surface the
// zone is inert (the atmosphere and the ground keep the base speed).
//
// The void multiplier tracks the band's inner radius: cruise speed grows
// linearly with it, so the Moon-to-planets trip takes the same time at any
// band setting. Only the cruise plateau scales — the acceleration/braking
// ramps, the buffer geometry, and the near-body landing caps are untouched.
import { MOON_SURFACE_Y, BAND_R0, nearestBody } from "./planets.js";

export const SPACE_MUL = 6;
export const SPACE_BUFFER = 200;
export const SPACE_RAMP = 600;

// Inner band radius the ×6 cruise was tuned for: the live multiplier scales
// with BAND_R0 against this reference (currently 25000/8000, ×18.75).
const CRUISE_REF_R0 = 8000;

// Effective void multiplier for the live band.
export function spaceMul() {
  return SPACE_MUL * Math.max(1, BAND_R0 / CRUISE_REF_R0);
}

const smooth = (t) => t * t * (3 - 2 * t);

// Speed multiplier at a point: 1 inside a body's buffer, rising smoothly to
// the live void multiplier once the point is SPACE_RAMP blocks past that buffer.
export function spaceSpeedMul(x, y, z) {
  if (y < MOON_SURFACE_Y) return 1;
  const near = nearestBody(x, y, z);
  const mul = spaceMul();
  if (!near) return mul;
  const t = Math.max(0, Math.min(1, (near.dist - SPACE_BUFFER) / SPACE_RAMP));
  return 1 + (mul - 1) * smooth(t);
}
