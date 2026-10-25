// Corridor policy: 1-wide servo decisions plus width-aware branch and
// release rules for everything else (2-wide lanes, rooms, fields). Three-
// free and store-free: the mover injects `pointFree(nx, nz, dirYaw)` (the
// body fits at a point) and `cellFree(bx, bz)` (a whole cell walks) — one
// unified solid/air-wall predicate behind both — this module only decides.
// Straights cruise, L/T/cross pick a random exit excluding the entry way,
// zigzags are chained L turns, dead ends U-turn. No global precompute:
// every decision is local, so player edits just work.
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

export function cellOf(v) {
  return Math.floor(v);
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

export function closestDir(yaw, dirs) {
  let best = dirs[0], bd = yawDiff(yaw, dirs[0]);
  for (let i = 1; i < dirs.length; i++) {
    const d = yawDiff(yaw, dirs[i]);
    if (d < bd) { bd = d; best = dirs[i]; }
  }
  return best;
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
// never counted here: consecutive junctions (bars, cross mazes) keep
// picking, which is correct exploration.
// Events: engage | cruise | junction (forced L or free choice) |
// lock-turn | uturn | null (open field, no lane).
export function updateLane(lane, cx, cz, yaw, opens, rand = Math.random) {
  if (!lane) {
    if (opens.length === 2) {
      const axis = closestDir(yaw, opens);
      const entry = opens[0] === axis ? opens[1] : opens[0];
      return { lane: { axis, entry, lockX: -1, lockZ: -1 }, event: "engage" };
    }
    if (opens.length === 1) {
      const axis = opens[0];
      return { lane: { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1 }, event: "engage" };
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
