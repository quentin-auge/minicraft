// Collision anatomy (three-free, pure): the nose reach ahead of the body
// centre (snout protrusion + nose radius) — the single anatomy number every
// forward distance consumes. Per mob, so long-snouted species inherit
// correct lookahead with no magic constants. No imports (no cycles by
// construction): noseReach reads plain mob fields.
export function noseReach(mob) { return mob.nose.along + mob.nose.r; }
