// Gap finder (R5): the single bounded-hole scan behind the servo funnel
// and the roam gap tiebreak. A run counts only when walled on both flanks
// (a true hole, never an open edge), its middle cell runs on along the axis
// (a through route, never a side alcove), and the lateral transit from the
// axis is itself walkable. Side mouths never qualify, so junction corners
// stay blended and parallel corridors never read as gaps — for roam as for
// the servo, since the session line and the run budget cover what a loose
// scan used to do. Runs touching the scan edge probe one step further to
// check the flank. Returns {axis, line} for the funnel drive plus {center,
// dist, heading} for roam. Give-up + cooldown bound any wedge; the normal
// flow resumes past the constriction.
import { dirVec } from "./corridor.js";
import { fitsAt, makeCellFree, descendOk } from "./step.js";
import { noseOn } from "./collide.js";

// Forward scan distances, lateral half-width/step. Minimum run width reads
// a single body-fit offset (1-wide mouths align to exactly one).
export const FUNNEL_DISTS = [1.0, 1.6];
export const FUNNEL_LAT = 2.5;
export const FUNNEL_STEP = 0.25;
export const FUNNEL_MINW = 0.25;
export const FUNNEL_GIVEUP = 1.0;
export const FUNNEL_COOL = 2.0;

export function scanGap(mob, axisYaw) {
  const [fx, fz] = dirVec(axisYaw);
  const latx = -fz, latz = fx;
  const cellFree = makeCellFree(mob);
  const fitBody = (yaw) => {
    const base = (nx, nz) => fitsAt(mob, true, false, yaw, noseOn(), nx, nz);
    return (nx, nz) => base(nx, nz) && descendOk(mob, nx, nz);
  };
  const blockAt = (x, z) => !fitBody(axisYaw)(x, z);
  const at = (dist, o) => blockAt(
    mob.pos.x + fx * dist + latx * o, mob.pos.z + fz * dist + latz * o);
  for (const dist of FUNNEL_DISTS) {
    let best = null, runStart = null, prev = 0;
    const close = () => {
      if (runStart == null) return;
      const width = prev - runStart + FUNNEL_STEP;
      const boundedL = runStart > -FUNNEL_LAT + 1e-9 || at(dist, runStart - FUNNEL_STEP);
      const boundedR = prev < FUNNEL_LAT - 1e-9 || at(dist, prev + FUNNEL_STEP);
      const center = (runStart + prev) / 2;
      const mcx = Math.floor(mob.pos.x + fx * dist + latx * center);
      const mcz = Math.floor(mob.pos.z + fz * dist + latz * center);
      // Through route + lateral transit: the mob must be able to slide to
      // the mouth and walk on past it — a parallel corridor past solid
      // rock reads as a gap otherwise (mouth walks, through route holds
      // beyond the walls) and the funnel grinds along the wall toward an
      // unreachable line, gives up, and drops the lane. Runs straddling
      // the axis always pass transit.
      let ok = cellFree(mcx + fx, mcz + fz) && cellFree(mcx - fx, mcz - fz);
      const step = center > 0 ? FUNNEL_STEP : -FUNNEL_STEP;
      for (let o = 0; ok && Math.abs(o) <= Math.abs(center) + 1e-9; o += step) {
        if (at(0, o)) ok = false;
      }
      if (width >= FUNNEL_MINW && boundedL && boundedR && ok &&
          (!best || width > best.width ||
            (width === best.width && Math.abs(center) < Math.abs(best.center)))) {
        best = { width, center, mcx, mcz };
      }
      runStart = null;
    };
    for (let o = -FUNNEL_LAT; o <= FUNNEL_LAT + 1e-9; o += FUNNEL_STEP) {
      if (!at(dist, o)) { if (runStart == null) runStart = o; prev = o; }
      else close();
    }
    close();
    if (best) {
      const narrow = best.width < 1.0;
      const line = (fx === 0)
        ? (narrow ? best.mcx + 0.5 : mob.pos.x + latx * best.center)
        : (narrow ? best.mcz + 0.5 : mob.pos.z + latz * best.center);
      const gx = mob.pos.x + fx * (dist + 1.0) + latx * best.center;
      const gz = mob.pos.z + fz * (dist + 1.0) + latz * best.center;
      return {
        axis: axisYaw, line,
        center: best.center, dist,
        heading: Math.atan2(gx - mob.pos.x, gz - mob.pos.z),
      };
    }
  }
  return null;
}
