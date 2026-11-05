// Corridor policy: 1-wide servo decisions plus proximity entry detection
// for tunnel mouths (1-wide and 2-wide). Three-free and store-free: the
// mover injects `pointFree(nx, nz, dirYaw)` (the body fits at a point) and
// `cellFree(bx, bz)` (a whole cell walks) — one unified solid/air-wall
// predicate behind both — this module only decides. Straights cruise,
// L/T/cross pick a random exit excluding the entry way, zigzags are
// chained L turns, dead ends U-turn. Tunnel entries attract from the open
// (see findEntries): no funnel, no gap scan. No global precompute: every
// decision is local, so player edits just work.
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

// 8-wind snap for forced detours (mover): meetings read off a discrete
// set, so crossings resolve instead of chasing raw headings.
export function snap8(yaw) {
  return Math.round(yaw / (Math.PI / 4)) * (Math.PI / 4);
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
// wall (mouth doesn't continue along the axis: 1-cell arm, doorway). The corridor's own neighbour lane continues alongside with a
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

// Proximity entry detection: tunnel mouths attracting mobs from the open.
// One rule, two widths, orientation-free (all four cardinals scanned):
//
// A mouth is a hole of width 1 (one cell) or 2 (two laterally adjacent
// cells) with 3 blocks of free depth of the same width, entry included:
// the mouth row plus the two rows behind it all walk. One rule for both
// widths: the mouth row reads walled on its outer flanks (solid or drop
// through the injected cellFree), each flank backed by a walled run of at
// least MIN_FLANK cells (an ended wall tip, a bank, or both — so a lone
// pillar never counts, while the opening stays held by the other side),
// and the row in front walks with at least one open side. A wall running
// on past the mouth on one side is still a mouth (one edge starts, the
// other may run longer) — so a field, room, or open ground, never
// mid-corridor (approach walled both sides), which is what makes this a
// boundary detector: cells deep inside a corridor never match, so a
// cruising mob never re-detects its own lane.
//
// Only mouths whose target point (mouth centre, passage midpoint) reads
// within range (Euclidean) of the mob are returned, nearest first.
// 1-wide holes read closer than 2-wide
// passages: mobs notice a person-sized gap later than a wide one.
// Distance is tested before any voxel read and every cell evaluates once
// per scan (lazy memo below), so the cost is one small grid, never
// motifs × probes. The attraction draw (ENTRY_P) repeats every scan until
// one accepts; this module only lists candidates. Pure and headless-tested.
export const ENTRY_R_1W = 3.0;
export const ENTRY_R_2W = 4.0;
export const ENTRY_P = 0.5;
// Flank support: each outer mouth flank must read walled on the mouth row
// and be backed by a run of at least MIN_FLANK cells — down its depth file
// or along the mouth row. See flanksWalled.
export const MIN_FLANK = 2;
// Scan throttle: the area scan below runs at most this often per mob
// (sim-time). The per-slice mover calls entryTick every 1/60 slice —
// dozens of slices per frame at high V speed — but a mouth a few blocks
// away never needs a 60 Hz refresh; the in-flight entry commit and the
// refusal cooldown already bridge the gaps.
export const ENTRY_SCAN_T = 0.25;
// Centering stall: an entry walk that pushes aligned-but-blocked (nose
// wedged on the hole edge) touches the blocking wall past this many
// sim-seconds and follows it toward the hole with the existing ride
// machinery instead of grinding — six fully-stuck 1/60 slices read as
// stuck, brief grazes never accrue that long.
export const ENTRY_STALL_T = 0.1;
// Entry backstop: a commit that never arrives (hole sealed mid-walk by a
// player edit) releases to a forward exit past this many sim-seconds —
// never a backward decide. Genuine walks convert to a guided ride within
// ENTRY_STALL_T, so only sealed holes ever reach it.
export const ENTRY_TIMEOUT = 15;
// Violet hold: after an arrival closes the entry commit, the pass tint
// stays on until the mob walks this far past the aimed slot (mouth
// half-width plus body plus margin — about one block past the mouth), so
// the physical threading reads violet, not just the approach.
// Entry cooldown: once the hold clears (mob out of the mouth), no new
// entry draw for this many sim-seconds — arrivals walk away instead of
// instantly re-drawing the mouth they just threaded.
export const VIOLET_HOLD_D = 1.0;
export const ENTRY_COOL_T = 5;

function entryDist(px, pz, x, z) {
  return Math.hypot(x - px, z - pz);
}

// Lazy memoized cell reader for one scan: every pattern probes the same
// cells over and over (mouth, flanks, depth, approach, pair rows), so each
// (bx, bz) evaluates cellFree once and later probes read the cache. Cells
// outside the covered square fall through to the live predicate (patterns
// only reach two cells past an in-range mouth, always inside).
// Sized by the widest radius (2-wide).
const CACHE_R = Math.ceil(ENTRY_R_2W) + 3;
function makeCache(cellFree, cx, cz) {
  const W = CACHE_R * 2 + 1;
  const m = new Map();
  return (bx, bz) => {
    const ox = bx - cx + CACHE_R, oz = bz - cz + CACHE_R;
    if (ox < 0 || oz < 0 || ox >= W || oz >= W) return cellFree(bx, bz);
    const k = ox * W + oz;
    let v = m.get(k);
    if (v === undefined) {
      v = cellFree(bx, bz) ? 1 : 0;
      m.set(k, v);
    }
    return v === 1;
  };
}

export function findEntries(px, pz, cellFree) {
  const out = [];
  const seen = new Set();
  const cf = makeCache(cellFree, Math.floor(px), Math.floor(pz));
  const cx = Math.floor(px), cz = Math.floor(pz);
  const R = Math.ceil(ENTRY_R_2W) + 1;
  // Prefilter on the widest radius plus the pair half-step: a 2-wide
  // midpoint can read in range while its cells sit up to half a cell past
  // it. Per-motif rechecks below apply the exact radii.
  const R2 = (ENTRY_R_2W + 0.5 + 1e-9) * (ENTRY_R_2W + 0.5 + 1e-9);
  // One mouth rule for both widths, parametrized by the cell span: outer
  // flanks of the mouth row blocked and held (MIN_FLANK support each
  // side); approach row free with at least one open side (a wall running
  // on past the mouth on one side is still a mouth — one edge starts, the
  // other may run longer).
  const pairSign = (bx, bz, qx, qz, lx, lz) => (qx === bx + lx && qz === bz + lz) ? 1 : -1;
  // Span cells: the mouth row as a list (single cell or lateral pair), so
  // the row/depth/approach checks below never branch on the width.
  const spanCells = (bx, bz, w, qx, qz) => (w === 1 ? [[bx, bz]] : [[bx, bz], [qx, qz]]);
  // Outer flank cells of the span: the two cells past each end of the
  // mouth row (single cell: both laterals; pair: one past each end).
  const outerCells = (bx, bz, lx, lz, w, qx, qz) => {
    if (w === 1) return [[bx + lx, bz + lz], [bx - lx, bz - lz]];
    const s = pairSign(bx, bz, qx, qz, lx, lz);
    return [[bx - lx * s, bz - lz * s], [qx + lx * s, qz + lz * s]];
  };
  // Flank support: each outer mouth flank must read walled on the mouth
  // row and be backed by a walled run of at least MIN_FLANK cells — either
  // down its depth file (a bank, notches tolerated) or along the mouth row
  // (an ended wall tip: the setback gap). A lone pillar is neither and
  // never holds an opening.
  const flanksWalled = (bx, bz, fx, fz, lx, lz, w, qx, qz) => {
    for (const [ox, oz] of outerCells(bx, bz, lx, lz, w, qx, qz)) {
      if (cf(ox, oz)) return false;
      let file = 0;
      for (let k = 0; k <= 2; k++) {
        if (!cf(ox + fx * k, oz + fz * k)) file++;
      }
      let row = 1;
      for (const s of [1, -1]) {
        for (let k = 1; row < MIN_FLANK && !cf(ox + lx * k * s, oz + lz * k * s); k++) row++;
      }
      if (file < MIN_FLANK && row < MIN_FLANK) return false;
    }
    return true;
  };
  const approachOpen = (bx, bz, fx, fz, lx, lz, w, qx, qz) => {
    // Every approach cell walks, with at least one outer side open. The
    // outer sides are the span's outer flanks shifted one row forward, so
    // the 1-wide and 2-wide clauses are the same test.
    for (const [cx, cz] of spanCells(bx, bz, w, qx, qz)) {
      if (!cf(cx - fx, cz - fz)) return false;
    }
    return outerCells(bx, bz, lx, lz, w, qx, qz)
      .some(([ox, oz]) => cf(ox - fx, oz - fz));
  };
  const mouthMatch = (bx, bz, fx, fz, lx, lz, w, qx, qz) => {
    const cells = spanCells(bx, bz, w, qx, qz);
    // Mouth row.
    for (const [cx, cz] of cells) if (!cf(cx, cz)) return false;
    if (!flanksWalled(bx, bz, fx, fz, lx, lz, w, qx, qz)) return false;
    // Two depth rows behind the mouth, same width, just free.
    for (let k = 1; k <= 2; k++) {
      for (const [cx, cz] of cells) if (!cf(cx + fx * k, cz + fz * k)) return false;
    }
    // Open approach: the row in front walks with at least one open side.
    return approachOpen(bx, bz, fx, fz, lx, lz, w, qx, qz);
  };
  for (let bx = cx - R; bx <= cx + R; bx++) {
    for (let bz = cz - R; bz <= cz + R; bz++) {
      // Distance first: voxel reads only happen for in-range mouths.
      const mx = bx + 0.5 - px, mz = bz + 0.5 - pz;
      if (mx * mx + mz * mz > R2) continue;
      for (const axis of CARDINALS) {
        const [fx, fz] = dirVec(axis);
        const lx = -fz, lz = fx;
        // --- 1-wide mouth at (bx, bz), corridor toward +axis ---
        {
          const key = `1:${bx},${bz},${axis}`;
          if (!seen.has(key) && mouthMatch(bx, bz, fx, fz, lx, lz, 1)) {
            const x = bx + 0.5, z = bz + 0.5;
            const dist = entryDist(px, pz, x, z);
            if (dist <= ENTRY_R_1W + 1e-9) {
              seen.add(key);
              out.push({ kind: "one", bx, bz, x, z, axis, dist });
            }
          }
        }
        // --- 2-wide passage: pair (bx, bz) + lateral neighbour ---
        for (const s of [1, -1]) {
          const qx = bx + lx * s, qz = bz + lz * s;
          const lox = Math.min(bx, qx), loz = Math.min(bz, qz);
          const hix = Math.max(bx, qx), hiz = Math.max(bz, qz);
          // One key per pair + travel line (both approach sides attract).
          const lineAxis = fx === 0 ? "ns" : "ew";
          const key = `2:${lox},${loz}|${hix},${hiz}|${lineAxis}`;
          if (seen.has(key)) continue;
          if (!mouthMatch(bx, bz, fx, fz, lx, lz, 2, qx, qz)) continue;
          const x = (bx + 0.5 + qx + 0.5) / 2, z = (bz + 0.5 + qz + 0.5) / 2;
          const dist = entryDist(px, pz, x, z);
          if (dist > ENTRY_R_2W + 1e-9) continue;
          seen.add(key);
          out.push({
            kind: "two", bx, bz, qx, qz, x, z, axis, dist,
            ax: bx + 0.5, az: bz + 0.5, bx2: qx + 0.5, bz2: qz + 0.5,
          });
        }
      }
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// Turn-tunnel gate: a non-touch lane may only turn onto an exit whose first
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
export function segmentTunneled(px, pz, exitAxis, cellFree) {
  const [fx, fz] = dirVec(exitAxis);
  const cx = Math.floor(px), cz = Math.floor(pz);
  const nx = cx + fx, nz = cz + fz;
  for (const s of [1, -1]) {
    if (cellFree(cx + fz * s, cz - fx * s) && cellFree(nx + fz * s, nz - fx * s)) return false;
  }
  return true;
}

// Single tunnel rule behind every non-touch lane: straights hold both
// flanks walled here (block or drop, virtual wall included); junction and
// lock-turn exits hold the first step's segment tunneled instead.
export function laneTunneled(event, axis, walled, px, pz, cellFree) {
  if (event === "junction" || event === "lock-turn") {
    return segmentTunneled(px, pz, axis, cellFree);
  }
  const walledDir = (d) => walled.some((w) => yawDiff(w, d) < 1e-6);
  return walledDir(normYaw(axis + Math.PI / 2)) && walledDir(normYaw(axis - Math.PI / 2));
}

// 2-wide lane motif (XOOX around the mob cell): the travel run reads free
// fore and aft, exactly one adjacent lateral cell stands blocked (the near
// edge), and the cell two over past the open side stands blocked (the far
// edge). The mob threads a 2-wide passage and must walk it straight —
// flank grazes inside one are passage, never contact, so the flank latch
// declines them instead of yanking the mob onto an edge line. Lone walls
// (far side open), L corners (run blocked) and true 1-wide cells (both
// flanks blocked) all fail the motif and latch normally. Pure.
export function isTwoWideLane(bcx, bcz, axis, cellFree) {
  const [fx, fz] = dirVec(axis);
  const [lx, lz] = dirVec(normYaw(axis + Math.PI / 2));
  if (!cellFree(bcx + fx, bcz + fz) || !cellFree(bcx - fx, bcz - fz)) return false;
  const leftBlocked = !cellFree(bcx + lx, bcz + lz);
  const rightBlocked = !cellFree(bcx - lx, bcz - lz);
  if (leftBlocked === rightBlocked) return false;
  const open = leftBlocked ? -1 : 1;
  return !cellFree(bcx + lx * 2 * open, bcz + lz * 2 * open);
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
// lock = junction cell already decided (no re-pick inside it). A lane
// cruising where neither flank reads blocked (single-wall walks,
// widenings, room crossings) drops to roam in the mover — never counted
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
