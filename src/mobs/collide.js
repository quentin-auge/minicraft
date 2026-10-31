// Collision unification: one predicate, two nose policies. Mode A puts
// the nose in every decision (fitsAt noseOn, strides may end at nose
// contact); mode B keeps the body rule with the centralized nose lookahead
// added to the planner's voxel read (shipped default; the headless rigs pin
// modes directly to cover both). No imports (no cycles by construction):
// noseReach reads plain mob fields.
const MODES = [
  { id: "A nose", nose: true, strideMargin: 0.0 },
  { id: "B lookahead", nose: false, strideMargin: 0.2 },
];
let _mode = 1;
export function collideMode() { return _mode; }
export function setCollide(i) { _mode = i; }
// Nose reach ahead of the body centre (snout protrusion + nose radius):
// the single anatomy number every forward distance consumes. Per mob, so
// long-snouted species inherit correct lookahead with no magic constants.
export function noseReach(mob) { return mob.nose.along + mob.nose.r; }
export function noseOn() { return MODES[_mode].nose; }
export function strideMargin() { return MODES[_mode].strideMargin; }
