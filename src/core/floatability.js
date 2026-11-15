// Shared buoyancy law (three-free): the one vertical rule for every body
// floating on liquid — the player and any float-capable mob. One dynamics,
// per-body float depth: callers pass their own submerge (player 0.95,
// mobs h * MOB_FLOAT_FRAC), so float levels stay body-specific while the
// rise acceleration, the near-surface spring, and the overshoot pop read
// identically everywhere, in every liquid alike (water, lava, moon water).
// "swim" stays reserved for directed underwater locomotion (fish); this is
// passive buoyancy only.
export const FLOAT_ACCEL = 8;
export const FLOAT_AREA = 10;
export const FLOAT_BRAKE = 2.0;
export const FLOAT_MAX = 64;

// Float feet level for a given liquid surface top and submerge depth.
export function floatTargetY(surface, submerge) {
  return surface - submerge;
}

// One buoyancy velocity step, in place on a scalar vy: far below the target
// the body accelerates upward at FLOAT_ACCEL; near the target a spring
// chases want = err * 4 at rate dt * FLOAT_BRAKE * 2. Momentum is kept, so
// a fast rise overshoots the target — the pop — before gravity takes over
// once the body leaves the liquid. Mirrors the player swim exactly.
export function floatVelY(vy, err, dt) {
  let v = vy;
  if (err > FLOAT_AREA) {
    v += FLOAT_ACCEL * dt;
  } else {
    const want = err * 4;
    v += (want - v) * Math.min(1, dt * FLOAT_BRAKE * 2);
  }
  if (v > FLOAT_MAX) v = FLOAT_MAX;
  else if (v < -FLOAT_MAX) v = -FLOAT_MAX;
  return v;
}

// Water-entry damping: a falling body entering liquid keeps 30% of its
// downward velocity, exactly like the player controller.
export function dampFloatEntryVelY(vy) {
  return vy * 0.3;
}
