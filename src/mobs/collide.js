// Collision anatomy (three-free, pure): the nose reach ahead of the body
// centre (snout protrusion + nose radius) — the single anatomy number every
// forward distance consumes. Per mob, so long-snouted species inherit
// correct lookahead with no magic constants. No imports (no cycles by
// construction): noseReach reads plain mob fields.
export function noseReach(mob) { return mob.nose.along + mob.nose.r; }

export const SEP_GAP = 0.1;
export const CROSS_BUDGET = 0.15;
export const PASS_OFF = 0.26;
export const PASS_BUDGET = 0.5;
export const WALL_ALLOW = 0.1;

// Body parts, in the order the circle pairs walk them.
export const PART_CORE = 0, PART_NOSE = 1, PART_TAIL = 2;
// Radius of one body part.
export function partRadius(mob, part) {
  return part === PART_CORE ? mob.hw : part === PART_NOSE ? mob.nose.r : mob.tail.r;
}

// Worst circle-pair penetration between a body posed at (ax, az) with the
// given yaw-oriented circles and mob b's live body circles: null when
// clear. Lets the step gate test a candidate position without moving
// anything. Exported for the group planner (forecast.js), which poses
// trajectory samples through the same math. i/j feed the deterministic
// coincident-center fallback.
//
// `parts`, when given, collects each part-pair's own worst penetration
// (indexed PART_* * 3 + PART_*): a head sweeping past a core is a
// different event from two cores merging, so the narrow corridor gate
// budgets them apart.
export function worstPairPenAt(ax, az, asx, asz, ahw, anose, atail, b, i, j, parts = null) {
  const bsx = Math.sin(b.yaw), bsz = Math.cos(b.yaw);
  let wPen = 0, wNx = 0, wNz = 0, wD = 0, wNeed = 0;
  for (let ai = 0; ai < 3; ai++) {
    const aa = ai === 0 ? 0 : ai === 1 ? anose.along : atail.along;
    const ar = ai === 0 ? ahw : ai === 1 ? anose.r : atail.r;
    const cx = ax + asx * aa, cz = az + asz * aa;
    for (let bi = 0; bi < 3; bi++) {
      const ba = bi === 0 ? 0 : bi === 1 ? b.nose.along : b.tail.along;
      const br = bi === 0 ? b.hw : bi === 1 ? b.nose.r : b.tail.r;
      const ox = cx - (b.pos.x + bsx * ba), oz = cz - (b.pos.z + bsz * ba);
      const need = ar + br + SEP_GAP;
      const d2 = ox * ox + oz * oz;
      if (d2 >= need * need) continue;
      // Coincident centers have no normal: deterministic fallback
      // direction from the pair indices (recomputed next tick, so
      // any axis unstacks exact overlaps instead of skipping them).
      if (d2 < 1e-8) {
        const fa = (i * 2.39996 + j * 1.2345) % (Math.PI * 2);
        if (parts && need > parts[ai * 3 + bi]) parts[ai * 3 + bi] = need;
        if (need > wPen) { wPen = need; wNx = Math.sin(fa); wNz = Math.cos(fa); wD = 0; wNeed = need; }
        continue;
      }
      const d = Math.sqrt(d2), pen = need - d;
      if (parts && pen > parts[ai * 3 + bi]) parts[ai * 3 + bi] = pen;
      if (pen > wPen) { wPen = pen; wNx = ox / d; wNz = oz / d; wD = d; wNeed = need; }
    }
  }
  return wPen <= 0 ? null : { pen: wPen, nx: wNx, nz: wNz, d: wD, need: wNeed };
}
