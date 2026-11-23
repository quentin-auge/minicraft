// Deep-space speed zone: the rocket keeps its base caps near every celestial
// body and ramps to a multiplier in the open void between them. The buffer is
// measured from the nearest body's solid cylinder; below the Moon surface the
// zone is inert (the atmosphere and the ground keep the base speed).
import { MOON_SURFACE_Y, nearestBody } from "./planets.js";

export const SPACE_MUL = 6;
export const SPACE_BUFFER = 200;
export const SPACE_RAMP = 600;

const smooth = (t) => t * t * (3 - 2 * t);

// Speed multiplier at a point: 1 inside a body's buffer, rising smoothly to
// SPACE_MUL once the point is SPACE_RAMP blocks past that buffer.
export function spaceSpeedMul(x, y, z) {
  if (y < MOON_SURFACE_Y) return 1;
  const near = nearestBody(x, y, z);
  if (!near) return SPACE_MUL;
  const t = Math.max(0, Math.min(1, (near.dist - SPACE_BUFFER) / SPACE_RAMP));
  return 1 + (SPACE_MUL - 1) * smooth(t);
}
