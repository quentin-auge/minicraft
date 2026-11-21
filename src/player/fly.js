// Fly mode, ported from master freeCam (KeyF): pitch-aware thrust at FLY
// speed (3x with sprint), per-axis slide collision through the shared axis
// movers with a 1-block instant step-up onto live portal sills (bottom
// frames of windows with an active fill — plain ledges still stall),
// no gravity or swimming.
import { thrustMove } from "./physics.js";

export const FLY = 10;

// Session multiplier on the player's fly speed (?flymul=<factor>): the
// base and sprint fly speeds both read it — the rocket caps keep reading
// the bare FLY (rocket.js), so deep-space speed stays untouched.
let flyMul = 1;
export function setFlyMul(v) {
  if (Number.isFinite(v) && v > 0) flyMul = v;
}

export let flyOn = false;
export function setFly(v) {
  // Leaving fly keeps the last fly velocity: the one airborne rule shapes
  // the drop from there like every other thrown body.
  flyOn = v;
}

export function updateFly(dt) {
  thrustMove(dt, FLY * flyMul, FLY * 3 * flyMul, true);
}
