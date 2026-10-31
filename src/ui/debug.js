// Debug HUD, ported from master: `=` toggles a small `fps N | x X  y Y  z Z`
// readout (integer block coords). FPS is an exponential moving average
// (alpha 0.05) of instantaneous FPS, refreshed at most every 0.25 s.
import { started } from "./menu.js";

export let debugHud = false;
let fpsEMA = 60;
let hudT = 0;

const el = () => document.getElementById("debug");

export function toggleDebug() {
  debugHud = !debugHud;
  if (!debugHud) el().style.display = "none";
}

export function tickDebug(dt, x, y, z, extra) {
  if (dt > 0) fpsEMA += (1 / dt - fpsEMA) * 0.05;
  if (!debugHud || !started) {
    if (el().style.display !== "none") el().style.display = "none";
    return;
  }
  hudT += dt;
  if (hudT < 0.25) return;
  hudT = 0;
  let text = "fps " + Math.round(fpsEMA);
  if (x !== undefined && y !== undefined && z !== undefined) {
    text += " | x " + Math.floor(x) + "  y " + Math.floor(y) + "  z " + Math.floor(z);
  }
  if (extra) text += " | " + extra;
  el().textContent = text;
  el().style.display = "block";
}
