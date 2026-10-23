// Fly mode, ported from master freeCam (KeyF): pitch-aware thrust at FLY
// speed (3x with sprint), per-axis slide collision through the shared axis
// movers with a 1-block instant step-up onto live portal sills (bottom
// frames of windows with an active fill — plain ledges still stall),
// no gravity or swimming.
import { thrustMove } from "./physics.js";

export const FLY = 10;

export let flyOn = false;
export function setFly(v) {
  flyOn = v;
}

export function updateFly(dt) {
  thrustMove(dt, FLY, FLY * 3, true);
}
