// Reactor setup and nozzle merging (three-free).
//
// The merge rule is permanent: a footprint side of at most `REACTOR_SETUP.merge`
// cells collapses every nozzle's coordinate on that axis to the side's middle,
// so four corner reactors on a thin hull become fewer (a 1x1 cube keeps one).
// `REACTOR_SETUP` is the single shipped look: narrow cone, shorter trail,
// thin-hull merge.
import {
  ROCKET_FX_DEFAULT_DIAMETER,
  ROCKET_FX_DEFAULT_DEPTH,
  ROCKET_FX_DEFAULT_MERGE,
} from "../fx/rocketfx.js";

// The shipped reactor setup: narrow (x2), shorter (x0.3), merge <=2.
export const REACTOR_SETUP = Object.freeze({
  diameter: ROCKET_FX_DEFAULT_DIAMETER,
  depth: ROCKET_FX_DEFAULT_DEPTH,
  merge: ROCKET_FX_DEFAULT_MERGE,
});

// Collapse the nozzles on every thin footprint axis. `bounds` is in the same
// world space as the nozzles: `{ x0, x1, z0, z1 }` are the footprint's cell
// min/max. A side whose extent (in cells) is at most `threshold` puts every
// nozzle on that axis at the side's middle; identical positions then merge
// into one. `y` is never touched, so stacked reactors stay distinct.
export function mergeReactors(nozzles, bounds, threshold) {
  if (!bounds || !(threshold >= 1) || !nozzles?.length) return nozzles;
  const w = bounds.x1 - bounds.x0 + 1;
  const d = bounds.z1 - bounds.z0 + 1;
  const cx = (bounds.x0 + bounds.x1 + 1) / 2;
  const cz = (bounds.z0 + bounds.z1 + 1) / 2;
  const mergeX = w <= threshold;
  const mergeZ = d <= threshold;
  if (!mergeX && !mergeZ) return nozzles;
  const out = [];
  const seen = new Set();
  for (const [x, y, z] of nozzles) {
    const nx = mergeX ? cx : x;
    const nz = mergeZ ? cz : z;
    const key = `${Math.round(nx * 1e6)},${Math.round(y * 1e6)},${Math.round(nz * 1e6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([nx, y, nz]);
  }
  return out;
}
