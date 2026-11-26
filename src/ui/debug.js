// Debug HUD, ported from master: `=` toggles a small `fps N | x X  y Y  z Z`
// readout (integer block coords), plus a trailing `extra` string from the
// caller — the live scalar speed (`| v = N` blocks/s, velocity magnitude,
// always on: hull speed while flying, player speed otherwise).
// FPS is an exponential moving average (alpha 0.2, deliberately faster than
// master's 0.05) of instantaneous FPS, refreshed at most every 0.25 s: a
// post-entry hitch must read as recovered within ~0.3 s, not as a
// multi-second climb — the loading gate already guarantees entry at 60,
// so a slow readout would be the only thing still climbing.
import { started } from "./menu.js";

export let debugHud = false;
let fpsEMA = 60;
let hudT = 0;

let elCache = null;
const el = () => elCache ?? (elCache = document.getElementById("debug"));

export function toggleDebug() {
  debugHud = !debugHud;
  if (!debugHud) el().style.display = "none";
}

export function tickDebug(dt, x, y, z, extra) {
  if (dt > 0) fpsEMA += (1 / dt - fpsEMA) * 0.2;
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
  if (extra) text += extra;
  el().textContent = text;
  el().style.display = "block";
}
