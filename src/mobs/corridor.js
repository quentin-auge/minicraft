// 1-wide path servo policy: corridor classifier + junction decisions.
// Three-free and store-free: the mover injects `isBlocked(x, z, yaw)` — one
// unified solid/air-wall predicate — this module only decides. Straights
// cruise, L/T/cross pick a random exit excluding the entry way, zigzags are
// chained L turns, dead ends U-turn. No global precompute: every decision is
// local to the current cell, so player edits just work.
export const PROBE_DIST = 1.0;

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

// Four-direction probe through the mover's unified predicate: a direction
// is open when the body fits one cell ahead along it. Solid walls and
// air walls (illegal drops) both read blocked — the equivalence lives in
// the injected predicate, never here.
export function classifyExits(px, pz, isBlocked) {
  const opens = [];
  for (const dir of CARDINALS) {
    const [dx, dz] = dirVec(dir);
    if (!isBlocked(px + dx * PROBE_DIST, pz + dz * PROBE_DIST, dir)) opens.push(dir);
  }
  return opens;
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

// Lane state: null in the open, else {axis, entry, lockX, lockZ, wide}.
// axis = forward cardinal heading, entry = backward cardinal heading,
// lock = junction cell already decided (no re-pick inside it), wide =
// consecutive free-choice junctions (release to wander when the path
// mouth opens onto a field instead of narrowing again).
// Events: engage | cruise | junction (forced L or free choice) |
// lock-turn | uturn | release | null (open field, no lane).
export function updateLane(lane, cx, cz, yaw, opens, rand = Math.random) {
  if (!lane) {
    if (opens.length === 2) {
      const axis = closestDir(yaw, opens);
      const entry = opens[0] === axis ? opens[1] : opens[0];
      return { lane: { axis, entry, lockX: -1, lockZ: -1, wide: 0 }, event: "engage" };
    }
    if (opens.length === 1) {
      const axis = opens[0];
      return { lane: { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1, wide: 0 }, event: "engage" };
    }
    return { lane: null, event: null };
  }
  if (lane.lockX === cx && lane.lockZ === cz) return { lane, event: "lock-turn" };
  const options = junctionOptions(opens, lane.entry);
  if (options.length === 0) {
    return { lane: { axis: lane.entry, entry: lane.axis, lockX: -1, lockZ: -1, wide: 0 }, event: "uturn" };
  }
  if (options.length === 1 && yawDiff(options[0], lane.axis) < 1e-6) {
    if (lane.wide === 0) return { lane, event: "cruise" };
    return { lane: { ...lane, wide: 0 }, event: "cruise" };
  }
  if (options.length > 1) {
    if (lane.wide >= 1) return { lane: null, event: "release" };
    const exit = pickExit(options, rand);
    return { lane: { axis: exit, entry: oppositeYaw(exit), lockX: cx, lockZ: cz, wide: lane.wide + 1 }, event: "junction" };
  }
  // Forced L turn: deterministic, never counts toward the field release.
  const exit = options[0];
  return { lane: { axis: exit, entry: oppositeYaw(exit), lockX: cx, lockZ: cz, wide: lane.wide }, event: "junction" };
}
