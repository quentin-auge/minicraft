// Mob XZ level walls: the per-dimension level edge every ground mob is
// vetoed at (steps, separation shoves) and every blast flight rebounds off.
// Bounded dims wall at the level edge at any altitude (deep space above the
// Moon is empty until planets arrive); the Nether island and the End platform
// square (its level is its floor) wall at any altitude; the floorless TNT sky
// has no walls at all.
// Plain constants re-exported from the owners, so the three-free mob
// machinery (step.js, mover.js, farm.js) reads the same bounds without
// importing the full dimension registry (which drags three in via the
// hotbar textures). Unknown dims read as bounded.
import { dim, WORLD_RADIUS } from "../core/store.js";
import { END_PLATFORM_HALF } from "./end.js";

// The XZ half-extent of a dimension's level, or null = wallless (TNT sky).
export function mobLevelHalf(dimName = dim()) {
  if (dimName === "tnt") return null;
  if (dimName === "end") return END_PLATFORM_HALF;
  return WORLD_RADIUS;
}

// The wall limit for a mob at altitude y, or null = no walls (TNT sky
// anywhere). No altitude ceiling yet: the Moon band runs to +oo until the
// planet band introduces PLANET_MIN_Y.
export function mobXZLimit(dimName = dim(), y = 0) {
  const half = mobLevelHalf(dimName);
  if (half == null) return null;
  return half;
}
