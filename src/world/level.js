// Mob XZ level walls: the per-dimension level edge every ground mob is
// vetoed at (steps, separation shoves) and every blast flight rebounds off.
// Bounded dims wall at the level edge; the overworld only below PLANET_MIN_Y
// (deep space past it is rocket/grapple country — walls off), the Nether
// island and the End platform square (its level is its floor) at any altitude;
// the floorless TNT sky has no walls at all.
// Plain constants re-exported from the owners, so the three-free mob
// machinery (step.js, mover.js, farm.js) reads the same bounds without
// importing the full dimension registry (which drags three in via the
// hotbar textures). Unknown dims read as bounded.
import { dim, WORLD_RADIUS } from "../core/store.js";
import { PLANET_MIN_Y } from "./planets.js";
import { END_PLATFORM_HALF } from "./end.js";

// The XZ half-extent of a dimension's level, or null = wallless (TNT sky).
export function mobLevelHalf(dimName = dim()) {
  if (dimName === "tnt") return null;
  if (dimName === "end") return END_PLATFORM_HALF;
  return WORLD_RADIUS;
}

// The wall limit for a mob at altitude y, or null = no walls (TNT sky
// anywhere; the overworld deep-space band above PLANET_MIN_Y).
export function mobXZLimit(dimName = dim(), y = 0) {
  const half = mobLevelHalf(dimName);
  if (half == null) return null;
  if (dimName === "over" && y >= PLANET_MIN_Y) return null;
  return half;
}
