// Corridor policy: 1-wide servo decisions plus width-aware branch and
// release rules for everything else (2-wide lanes, rooms, fields). Three-
// free and store-free: the mover injects `pointFree(nx, nz, dirYaw)` (the
// body fits at a point) and `cellFree(bx, bz)` (a whole cell walks) — one
// unified solid/air-wall predicate behind both — this module only decides.
// Straights cruise, L/T/cross pick a random exit excluding the entry way,
// zigzags are chained L turns, dead ends U-turn. No global precompute:
// every decision is local, so player edits just work.
import { makeStepOk, makeCellFree, descendOk } from "./step.js";
export const PROBE_DIST = 1.0;
// Free-distance raycast: first t where blockedAt fails, else max. Used for
// wall-face measurement (virtual-lane latching) and open-heading checks.
export function rayDist(px, pz, dx, dz, blockedAt, max = 2.0, step = 0.1) {
  for (let t = step; t <= max + 1e-9; t += step) {
    if (blockedAt(px + dx * t, pz + dz * t)) return t;
  }
  return max;
}

// Yaw convention (shared with the mover): x = sin(yaw), z = cos(yaw).
export const CARDINALS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export function normYaw(y) {
  while (y > Math.PI) y -= Math.PI * 2;
  while (y < -Math.PI) y += Math.PI * 2;
  return y;
}

export function yawDiff(a, b) {
  return Math.abs(normYaw(a - b));
}

export function snapCardinal(yaw) {
  let best = CARDINALS[0], bd = yawDiff(yaw, CARDINALS[0]);
  for (let i = 1; i < CARDINALS.length; i++) {
    const d = yawDiff(yaw, CARDINALS[i]);
    if (d < bd) { bd = d; best = CARDINALS[i]; }
  }
  return best;
}

// Exact integer step for a cardinal yaw (never trig drift).
export function dirVec(yaw) {
  const s = snapCardinal(yaw);
  if (s === 0) return [0, 1];
  if (s === Math.PI / 2) return [1, 0];
  if (s === -Math.PI / 2) return [-1, 0];
  return [0, -1];
}

// Backward direction of a cardinal heading (the way we came from).
export function oppositeYaw(yaw) {
  return normYaw(snapCardinal(yaw) + Math.PI);
}

export function cellCenter(v) {
  return Math.floor(v) + 0.5;
}

// A side opening is a branch choice iff its mouth cell walks and it either
// runs on (far cell walks: long arm, wide arm, room) or breaks the corridor
// wall (mouth doesn't continue along the axis: 1-cell arm, doorway,
// breach). The corridor's own neighbour lane continues alongside with a
// wall beyond, so 2-wide straights never read as junctions.
export function sideBranch(mouthFree, farFree, contFree) {
  return mouthFree && (farFree || !contFree);
}

// Width-aware exits: forward/backward are raw body-fit openings (going
// straight is always legal when free); sides count only when they branch
// out of the corridor. Solid and air walls read identically — the
// equivalence lives in the injected predicates, never here.
export function classifyExits(px, pz, axis, pointFree, cellFree) {
  const opens = [];
  for (const dir of CARDINALS) {
    const [dx, dz] = dirVec(dir);
    if (pointFree(px + dx * PROBE_DIST, pz + dz * PROBE_DIST, dir)) {
      if (yawDiff(dir, axis) < 1e-6 || yawDiff(dir, oppositeYaw(axis)) < 1e-6) {
        opens.push(dir);
        continue;
      }
      const mx = Math.floor(px) + dx, mz = Math.floor(pz) + dz;
      const [afx, afz] = dirVec(axis);
      const near = cellFree(mx, mz);
      const far = near && cellFree(mx + dx, mz + dz);
      const cont = near && cellFree(mx + afx, mz + afz) && cellFree(mx - afx, mz - afz);
      if (sideBranch(near, far, cont)) opens.push(dir);
    }
  }
  return opens;
}

// True open space on both flanks of an axis: near AND far cells walk and
// the mouth row continues both ways (field, room middle, wide hall —
// never a corridor, whose far wall or broken continuity fails some clause).
// The mover releases the lane on this (commit straight out, no random
// spins); 1-wide and 2-wide corridors never match it.
export function flanksOpen(px, pz, axis, cellFree) {
  const [fx, fz] = dirVec(axis);
  for (const s of [1, -1]) {
    const mx = Math.floor(px) + fz * s, mz = Math.floor(pz) - fx * s;
    if (!cellFree(mx, mz)) return false;
    if (!cellFree(mx + fz * s, mz - fx * s)) return false;
    if (!cellFree(mx + fx, mz + fz) || !cellFree(mx - fx, mz - fz)) return false;
  }
  return true;
}

// Mouth opening onto a field: both flanks open wide (mouth + far cells
// walk) with the corridor bank still behind (mouth row broken backward),
// and no tunnel continuing ahead (the forward cell's own flanks are not
// both walled). True junctions (bars, crosses: arms continue, backward
// rows walk) never match it: their backward continuity holds, and a turn
// into an arm keeps a tunnel ahead. The mover exits to roam on this
// instead of junction-picking an arm into the field.
export function mouthOpen(px, pz, axis, cellFree) {
  const [fx, fz] = dirVec(axis);
  const cx = Math.floor(px), cz = Math.floor(pz);
  for (const s of [1, -1]) {
    const mx = cx + fz * s, mz = cz - fx * s;
    if (!cellFree(mx, mz)) return false;
    if (!cellFree(mx + fz * s, mz - fx * s)) return false;
    if (cellFree(mx - fx, mz - fz)) return false;
  }
  const nx = cx + fx, nz = cz + fz;
  if (!cellFree(nx + fz, nz - fx) && !cellFree(nx - fz, nz + fx)) return false;
  return true;
}

// Exit-tunnel gate: a non-touch lane may only turn onto an exit whose first
// step stays tunneled — neither side of the C→A segment fully open (on each
// side at least one of the two segment-flanking cells, current or ahead, is
// unwalkable). True 1-wide arms pass, including 1-cell jogs whose bend opens
// one flank of the ahead cell (the bend itself is the wall on the other
// half of the segment); room, widening, and field steps fail a whole side
// and release to roam instead of locking a turn into the open — the cruise
// hold above only covers straights, so without this gate a junction draw
// into a wide space would servo for hundreds of ticks outside any tunnel.
// Solid and drop walls read alike through the injected cellFree.
// Pure and headless-tested.
export function exitTunneled(px, pz, exitAxis, cellFree) {
  const [fx, fz] = dirVec(exitAxis);
  const cx = Math.floor(px), cz = Math.floor(pz);
  const nx = cx + fx, nz = cz + fz;
  for (const s of [1, -1]) {
    if (cellFree(cx + fz * s, cz - fx * s) && cellFree(nx + fz * s, nz - fx * s)) return false;
  }
  return true;
}

export function closestDir(yaw, dirs) {
  let best = dirs[0], bd = yawDiff(yaw, dirs[0]);
  for (let i = 1; i < dirs.length; i++) {
    const d = yawDiff(yaw, dirs[i]);
    if (d < bd) { bd = d; best = dirs[i]; }
  }
  return best;
}

// Bounded-hole scan (R5): the single scan behind the servo funnel and
// the roam gap override. A run counts only when walled on both flanks
// (a true hole, never an open edge), its middle cell runs on along the
// axis (a through route, never a side alcove), and the lateral transit
// from the axis is itself walkable. Side mouths never qualify, so
// junction corners stay blended and parallel corridors never read as
// gaps. Returns {axis, line} for the funnel drive plus {center, dist,
// heading} for roam. Give-up + cooldown bound any wedge; the normal
// flow resumes past the constriction.
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
    const base = makeStepOk(mob, true, false, 0, yaw, 0);
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

// Every open direction except the way we came from (no U-turn at junctions).
// Entry is always a cardinal, so the equality gate is exact.
export function junctionOptions(opens, entryYaw) {
  return opens.filter((d) => yawDiff(d, entryYaw) > 1e-6);
}

export function pickExit(options, rand = Math.random) {
  return options[Math.floor(rand() * options.length)];
}

// Lane state: null in the open, else {axis, entry, lockX, lockZ}.
// axis = forward cardinal heading, entry = backward cardinal heading,
// lock = junction cell already decided (no re-pick inside it). Open-space
// release is decided in the mover via flanksOpen (both flanks truly open),
// and the mover drops any non-touch lane cruising untunneled — never
// counted here: consecutive junctions (bars, cross mazes) keep picking,
// which is correct exploration.
// Engagement is tunnel-gated: the engaged axis must read blocked on both
// laterals (the injected `walled` set: solid or drop, virtual wall
// included) — single walls, room corners and L-entries never engage,
// dead-end mouths (flanks walled) still do. Junction turns, dead-end
// seeks and touch rides keep their own hold rules in the mover.
// Events: engage | cruise | junction (forced L or free choice) |
// lock-turn | uturn | null (open field, no lane).
export function updateLane(lane, cx, cz, yaw, opens, walled = [], rand = Math.random) {
  if (!lane) {
    if (opens.length === 2 || opens.length === 1) {
      const axis = opens.length === 2 ? closestDir(yaw, opens) : opens[0];
      const latA = normYaw(axis + Math.PI / 2), latB = normYaw(axis - Math.PI / 2);
      const walledDir = (d) => walled.some((w) => yawDiff(w, d) < 1e-6);
      if (!walledDir(latA) || !walledDir(latB)) return { lane: null, event: null };
      const entry = opens.length === 2
        ? (opens[0] === axis ? opens[1] : opens[0])
        : oppositeYaw(axis);
      return { lane: { axis, entry, lockX: -1, lockZ: -1 }, event: "engage" };
    }
    return { lane: null, event: null };
  }
  // A locked junction cell still U-turns when nothing stays open besides
  // the entry way (dead end right past the turn): the lock only suppresses
  // re-picks, never the dead-end flip — otherwise the blend would grind
  // into the end wall instead of turning around.
  const options = junctionOptions(opens, lane.entry);
  if (options.length === 0) {
    return { lane: { axis: lane.entry, entry: lane.axis, lockX: -1, lockZ: -1 }, event: "uturn" };
  }
  if (lane.lockX === cx && lane.lockZ === cz) {
    return { lane, event: "lock-turn" };
  }
  if (options.length === 1 && yawDiff(options[0], lane.axis) < 1e-6) {
    // Straight cruise: heal a stale entry (turn-then-straight) back to the
    // way behind, so a later straight cell never coin-flips a backtrack —
    // only true junctions randomize. The lock (same-cell re-pick guard) is
    // kept as-is; only the entry is refreshed.
    return {
      lane: { axis: lane.axis, entry: oppositeYaw(lane.axis), lockX: lane.lockX, lockZ: lane.lockZ },
      event: "cruise",
    };
  }
  // Junction: free choice randomizes, a single non-straight exit is a
  // forced L turn (deterministic — pickExit of one returns it).
  const exit = pickExit(options, rand);
  return { lane: { axis: exit, entry: oppositeYaw(exit), lockX: cx, lockZ: cz }, event: "junction" };
}
