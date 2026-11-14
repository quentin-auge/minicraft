// ?test=1 in-page hook: reactor-cone probe for the browser driver
// (tests/browser/fx/cones.mjs). Loaded by main.js only when the param is
// set; zero game impact otherwise. The engine records every nozzle-layer
// spray into window.__fxProbe (see src/fx/rocketimpact.js) once this
// module arms it; sampling calls the real playFx with fixed nozzles, so
// the numbers the driver asserts are the numbers the renderer got.
import { playFx } from "../../../src/fx/rocketimpact.js";
import { tickFx } from "../../../src/fx/particles.js";
import { ROCKET_FX_DEFAULT_DIAMETER, ROCKET_FX_DEFAULT_DEPTH } from "../../../src/fx/rocketfx.js";
import { pos, yaw, pitch } from "../../../src/player/physics.js";

// Four nozzles in the parked-hull square, like the ship's own grid.
const NOZZLES = [[0, 0.5, 0], [0, 0.5, 1], [1, 0.5, 0], [1, 0.5, 1]];
// The shipped setup: the driver asserts the final cone, not a preset sweep.
const SHIPPED_DEPTH = ROCKET_FX_DEFAULT_DEPTH;

function drain() {
  const s = window.__fxProbe.splice(0, window.__fxProbe.length);
  return s;
}

function sampleAt(fx, diameter, nozzles) {
  drain();
  playFx(fx, fx === "plume"
    ? { nozzles, ramp: { level: 1 }, diameter, depth: SHIPPED_DEPTH }
    : { nozzles, diameter, depth: SHIPPED_DEPTH });
  return drain();
}

export function initFxProbe() {
  window.__fxProbe = [];
  window.__fx = {
    presets() { return [ROCKET_FX_DEFAULT_DIAMETER]; },
    // Deterministic fixture: same nozzles every call, numbers comparable.
    sample(fx, cone) { return sampleAt(fx, cone, NOZZLES); },
    // Nozzles 4 m along the player's gaze: what the screenshots show.
    // Steps the particle clock manually (the menu holds the sim paused),
    // so the shot shows the integrated steady-state cone. Returns the
    // nozzle anchor for framing.
    sampleInView(fx, diameter, puffs = 12, dt = 1 / 12) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const fx0 = -Math.sin(yaw) * cp, fz = -Math.cos(yaw) * cp;
      const cx = pos.x + fx0 * 4, cy = pos.y + sp * 4 + 0.5, cz = pos.z + fz * 4;
      const near = [[cx, cy, cz], [cx + 1, cy, cz], [cx, cy, cz + 1], [cx + 1, cy, cz + 1]];
      drain();
      for (let i = 0; i < puffs; i++) {
        if (fx === "plume") playFx(fx, { nozzles: near, ramp: { level: 1 }, diameter, depth: SHIPPED_DEPTH });
        else playFx(fx, { nozzles: near, diameter, depth: SHIPPED_DEPTH });
        tickFx(dt);
      }
      return { samples: drain(), center: [cx, cy, cz] };
    },
  };
}
