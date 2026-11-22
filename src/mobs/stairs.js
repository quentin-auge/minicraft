// Step commits: single drops (or registry-gated jumps) taken straight,
// chained while the stairs continue. A step commit is an ordinary roam
// commit with the `step` marker — no waypoint file, no flight arming, no
// sidestep machinery, no timeout: the mob faces the drop, walks straight
// at it, falls it with gravity, and on landing re-scans for a continuation
// within ±90° of its facing. Chained straight/diagonal stairs therefore
// walk with no repositioning and no parasite rotation (the heading only
// changes where the stairs turn); a spiral turns continuously, one ≤90°
// re-commit per tread. When nothing continues, the commit drops and the
// mob is back to regular movement (roam / wall follow / rails) via decide.
//
// Trigger points (the mob is "free to choose"): the roam decide branch,
// the wall-ride budget exit, and the rail/mouth exit commit — never a
// latched plan, never an entry commit. The draw is 50/50 per scan, off
// the mob's own rand stream (deterministic in headless rigs) — except
// for a drop straight ahead: the descent direction is clear, so the mob
// walks it without a coin (the standing offer, made before the servo,
// takes over a 1-wide rail so the flight is walked instead of ridden).
//
// Three-free: plain cell math over the voxel store.
import {
  groundBelow, centerHeadroom, aabbIntersectsSolid, hasSupport, liquidSurface, spawnRng, NO_EXPIRY,
  cellFitsLevel,
} from "./step.js";
import { dropAllowed } from "./livestock.js";

// The 8 directions a step may take: cardinals first, then diagonals, so
// ties prefer the straight walk.
export const STEP_DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
// How far ahead the mob looks for an eligible drop/jump (cells).
export const STEP_SCAN = 3;
// Chain window (radians): a continuation must lie within ±90° of the
// facing the last step was walked with — stairs turn, never reverse.
export const STEP_TURN_MAX = Math.PI / 2;
// A stalled step drive (blocked target, e.g. a peer parked on the tread)
// releases instead of grinding: the next decide re-scans (maybe a fresh
// 50/50 commit) or walks on.
export const STEP_STALL_T = 1.0;
// A drop straight ahead (radians): the descent direction is clear, so the
// mob takes it without a coin flip — the staircase is walked, not turned
// away from. An oblique drop keeps the 50/50 draw (the mob may prefer to
// walk on).
export const STEP_CLEAR_TURN = 0.35;
// How close the landing of a clear drop must be (metres): the mob is at
// the head of the flight, not merely somewhere down the room.
export const STEP_CLEAR_DIST = 1.5;
// How far below the takeoff level the mob must have fallen to count as
// having left the tread: the shared threshold behind the corner-crossing
// switch (updateStepVia), the roam drive's void-edge flag, and the plan's
// crossing keep — one rule, three readers.
export const VIA_LEAVE_DROP = 0.05;
// How close the mob must walk to the crossing point to count it reached.
export const VIA_REACH_DIST = 0.4;
// How far past a solid corner the body passes when it takes the corner
// wide (metres): the body's own half width plus this hair.
export const CORNER_MARGIN = 0.02;

// The surface level of a cell, searched downward from the reference level:
// the walkable top the mob would stand on.
function surfaceAt(cx, cz, refY) {
  return groundBelow(cx + 0.5, refY + 1, cz + 0.5);
}

// The two cells flanking a diagonal step, with their surface levels: the
// single read behind every corner rule, so the scan and the planner agree.
function flankTops(mob, cx0, cz0, dx, dz, level) {
  const cells = [[cx0 + dx, cz0], [cx0, cz0 + dz]];
  return cells.map(([cx, cz]) => ({ x: cx, z: cz, g: surfaceAt(cx, cz, level) }));
}

// A diagonal step squeezes between its corner cells: the mob walks the
// diagonal straight over the corner, so only a corner sticking up above
// the takeoff blocks the move (the body would grind into it). Void corners
// never block. One rule with cornerCore below: a free diagonal is exactly
// a diagonal with no core.
function cornerFree(mob, ax, az, fromLevel, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  if (!dx || !dz) return true;
  return cornerCore(mob, ax, az, dx, dz, fromLevel) == null;
}

// The crossing point of a diagonal step: the corner the two cells share.
function crossingPoint(cx0, cz0, dx, dz) {
  return { x: cx0 + (dx > 0 ? 1 : 0), z: cz0 + (dz > 0 ? 1 : 0) };
}

// The corner cell that stands above the takeoff: the core the mob has to
// walk around (a newel post, a solid column in the middle of a spiral).
function cornerCore(mob, cx0, cz0, dx, dz, level) {
  return flankTops(mob, cx0, cz0, dx, dz, level).find((c) => c.g != null && c.g > level + 1e-3) ?? null;
}

// The wide crossing point of a diagonal around a core: the crossing corner
// itself, pushed clear of the core by the body's own half width (plus a
// hair). The mob walks there — its body never touches the core — and drops
// onto the tread beyond, exactly as it would walk a stair corner. Null
// when the core leaves no room for the body to pass.
export function cornerVia(mob, cx0, cz0, dx, dz, level) {
  const core = cornerCore(mob, cx0, cz0, dx, dz, level);
  if (!core) return null;
  const p = crossingPoint(cx0, cz0, dx, dz);
  const off = (mob.hw ?? 0.3) + CORNER_MARGIN;
  // Away from the core: the crossing point sits on one of the core's edges.
  const vx = p.x === core.x ? -1 : 1;
  const vz = p.z === core.z ? -1 : 1;
  const via = { x: p.x + vx * off, z: p.z + vz * off };
  // The body must fit the crossing point, and the leg from there to the
  // landing must stay clear of the core too.
  if (aabbIntersectsSolid(via.x, level, via.z, mob.hw, mob.h)) return null;
  if (!centerHeadroom(via.x, level, via.z, mob.h)) return null;
  // The swing cell must be reachable: the mob steps onto it (it stands
  // at the takeoff level) before it drops. A cell two levels down is a
  // hole, not a swing — the diagonal stays refused.
  const g = groundBelow(via.x, level + 1, via.z);
  if (g != null && !dropAllowed(level, g, mob.maxDrop, mob.stepUp ?? 0)) return null;
  return via;
}

// The landing must be clear of the core on the way in: the leg from the
// crossing point to the landing centre may not sweep the core. The leg
// runs at the TAKEOFF level: the mob walks the swing cell (which stands
// at its own level) and drops onto the landing from there.
export function cornerLegFree(mob, via, cx, cz, g) {
  const lx = cx + 0.5, lz = cz + 0.5;
  for (const t of [0.25, 0.5, 0.75]) {
    const px = via.x + (lx - via.x) * t, pz = via.z + (lz - via.z) * t;
    if (aabbIntersectsSolid(px, g, pz, mob.hw, mob.h)) return false;
  }
  return true;
}

// Can this diagonal be taken around a solid corner? The mob walks the
// crossing point clear of the core and drops onto the landing beyond.
// Shared by the step scan and the planner: a staircase that turns around
// a newel post is walkable, and both must agree on it.
export function cornerCrossing(mob, cx0, cz0, dx, dz, level, lcx, lcz) {
  const via = cornerVia(mob, cx0, cz0, dx, dz, level);
  if (!via) return null;
  if (!cornerLegFree(mob, via, lcx, lcz, level)) return null;
  return via;
}

// A diagonal DROP: the body leaves the takeoff cell on the diagonal and
// lands one level down. The two cells flanking the diagonal are its
// corners: a corner sticking up above the takeoff blocks the sweep (the
// body would grind into its flank), and the mob then walks the crossing
// point clear of that core instead.
//
// One rule, shared by the step scan and the planner, so both walk the
// same staircase: `{via}` — `via` is the crossing point to walk (null
// when the body sweeps the diagonal directly) — or null when the
// diagonal cannot be walked at all.
export function stairDiagonal(mob, cx0, cz0, dx, dz, fromLevel) {
  if (!dx || !dz) return null;
  const lcx = cx0 + dx, lcz = cz0 + dz;
  if (!cornerFree(mob, cx0, cz0, fromLevel, lcx, lcz)) {
    // The corner blocks the sweep: the mob walks the crossing point clear
    // of it and drops onto the tread beyond.
    const via = cornerCrossing(mob, cx0, cz0, dx, dz, fromLevel, lcx, lcz);
    return via ? { via } : null;
  }
  return { via: null };
}

// Eligibility of one landing cell: the body fits it standing on its own
// level with headroom, the feet stay dry, and it is not a trap — a
// same-level fitting neighbour walks on, or another eligible drop/jump
// lies within scan range of the landing (the staircase continues). The
// level change itself is checked by the caller.
//
// `allowEnd` releases the trap rule: the bottom of a flight is a dead end
// by nature (nothing continues below it), and a mob already walking the
// flight must be able to step onto it. The caller only allows it for a
// continuation straight ahead, so a mob never turns onto a side pocket.
// Whether the landing continues the flight: a fitting same-level neighbour
// walks on, or another eligible drop/jump lies within scan range of it.
// The level change itself is checked by the caller.
function flightContinues(mob, cx, cz, g, climbs) {
  for (const [dx, dz] of STEP_DIRS) {
    const nx = cx + dx, nz = cz + dz;
    const ng = surfaceAt(nx, nz, g);
    if (ng == null) continue;
    if (Math.abs(ng - g) <= 1e-3) {
      if (cellFitsLevel(mob, nx, ng, nz)) return true;
      continue;
    }
    if (ng < g - 1e-3 && Math.abs(g - ng - 1) <= 1e-3) {
      if (cellFitsLevel(mob, nx, ng, nz)) return true;
      continue;
    }
    if (climbs && ng > g + 1e-3 && Math.abs(ng - g - 1) <= 1e-3) {
      if (cellFitsLevel(mob, nx, ng, nz)) return true;
    }
  }
  return false;
}

function landingOk(mob, cx, cz, g, climbs, allowEnd = false) {
  if (!cellFitsLevel(mob, cx, g, cz)) return false;
  if (flightContinues(mob, cx, cz, g, climbs)) return true;
  return allowEnd;
}

// Yaw error from a heading to an 8-wind step.
function turnToDir(yaw, dx, dz) {
  const dirYaw = Math.atan2(dx, dz);
  return Math.abs(Math.atan2(Math.sin(dirYaw - yaw), Math.cos(dirYaw - yaw)));
}

// The nearest of the eight directions to a heading: the flight's axis.
function nearestDir(yaw) {
  let best = STEP_DIRS[0], bestTurn = Infinity;
  for (const d of STEP_DIRS) {
    const turn = turnToDir(yaw, d[0], d[1]);
    if (turn < bestTurn) { bestTurn = turn; best = d; }
  }
  return best;
}

// The walk to the lip stays flat: every intermediate cell stands at the
// mob's level and fits the body, and every intermediate diagonal never
// squeezes through a sticking-up corner.
function walkFlatTo(mob, cx0, cz0, dx, dz, k, L) {
  for (let j = 1; j < k; j++) {
    const ix = cx0 + dx * j, iz = cz0 + dz * j;
    const jx = cx0 + dx * (j - 1), jz = cz0 + dz * (j - 1);
    const ig = surfaceAt(ix, iz, L);
    if (ig == null || Math.abs(ig - L) > 1e-3 || !cellFitsLevel(mob, ix, L, iz)) return false;
    if (!cornerFree(mob, jx, jz, L, ix, iz)) return false;
  }
  return true;
}

// The flight's own axis: the heading the mob walks. When the flight can
// continue straight ahead (a same-level tread on), the mob walks ON
// rather than turning onto a dead-end drop: a side pocket is a hole,
// never the flight's next tread.
function flightAxisBlocked(mob, cx0, cz0, yaw, L) {
  const ahead = nearestDir(yaw);
  const aheadSurf = surfaceAt(cx0 + ahead[0], cz0 + ahead[1], L);
  return !(aheadSurf != null && Math.abs(aheadSurf - L) <= 1e-3 &&
    cellFitsLevel(mob, cx0 + ahead[0], L, cz0 + ahead[1]));
}

// The flight may end on a dead-end landing: the bottom of a flight is a
// dead end by nature, and a mob already walking the flight must be able
// to step onto its last tread — even where the flight TURNED to reach it
// (a spiral's last tread is a lone block). Only when the flight cannot
// continue straight ahead, so a side pocket off the flight stays refused.
function mayEndFlight(turn, via, aheadBlocked, allowEnd) {
  if (!allowEnd) return false;
  return turn <= STEP_CLEAR_TURN || via != null || (turn <= STEP_TURN_MAX && aheadBlocked);
}

// One commit install behind the opportunistic draw and the chain: a step
// commit owns a lane-less mob (a rail would otherwise keep the servo
// driving and starve the commit).
function installStepCommit(mob, found, heading) {
  const target = { x: found.x, z: found.z };
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.stuckT = 0;
  mob.lane = null;
  mob.followLine = null;
  mob.turnHold = 0;
  mob.roam = {
    mode: "commit", heading, target, tgt: target, stepY: found.y,
    t: 0, span: NO_EXPIRY, runT: 0, step: true, stallT: 0,
  };
  applyVia(mob, found);
}

// The best eligible drop/jump from (cx0, cz0, level L): nearest first,
// tie-break smallest turn from refYaw. A diagonal target refuses a corner
// sticking up above the takeoff — unless the corner is a core the mob can
// walk around (the crossing point), which the candidate then carries as
// its `via`. Intermediate cells walk flat at L.
export function scanStep(mob, maxDist = STEP_SCAN, maxTurn = Infinity, refYaw = null, allowEnd = false) {
  const cx0 = Math.floor(mob.pos.x), cz0 = Math.floor(mob.pos.z);
  // The stance level, not the raw feet: a supported mob stands up to 1e-3
  // above its tread (the support touch tolerance), and measuring an
  // exact one-block drop from the fractional feet refuses it at a float
  // epsilon — the staircase then reads as un-walkable at any height. All
  // callers scan from a supported stance, so the floor is the tread.
  const L = Math.floor(mob.pos.y + 1e-3);
  const yaw = refYaw ?? mob.yaw;
  const climbs = (mob.stepUp ?? 0) >= 1;
  const aheadBlocked = flightAxisBlocked(mob, cx0, cz0, yaw, L);
  let best = null;
  for (const [dx, dz] of STEP_DIRS) {
    const dirYaw = Math.atan2(dx, dz);
    const turn = turnToDir(yaw, dx, dz);
    if (turn > maxTurn + 1e-9) continue;
    for (let k = 1; k <= maxDist; k++) {
      const cx = cx0 + dx * k, cz = cz0 + dz * k;
      if (k > 1 && !walkFlatTo(mob, cx0, cz0, dx, dz, k, L)) break;
      const g = surfaceAt(cx, cz, L);
      if (g == null) break;
      if (Math.abs(g - L) <= 1e-3) continue;
      const dl = g - L;
      const isDrop = dl < -1e-3 && Math.abs(dl + 1) <= 1e-3;
      const isJump = dl > 1e-3 && Math.abs(dl - 1) <= 1e-3 && climbs;
      if (!isDrop && !isJump) break;
      // A diagonal around a core: the body cannot sweep the corner, so the
      // mob takes it wide (the crossing point clear of the core) and drops
      // onto the tread beyond. The planner reads the same rule.
      let via = null;
      if (dx !== 0 && dz !== 0) {
        const stair = stairDiagonal(mob, cx0, cz0, dx, dz, L);
        if (!stair) break;
        via = stair.via;
      }
      const endOk = mayEndFlight(turn, via, aheadBlocked, allowEnd);
      if (!landingOk(mob, cx, cz, g, climbs, endOk)) break;
      if (via && !cornerLegFree(mob, via, cx, cz, L)) break;
      const d = Math.hypot(cx + 0.5 - mob.pos.x, cz + 0.5 - mob.pos.z);
      if (!best || d < best.d - 1e-9 ||
        (Math.abs(d - best.d) <= 1e-9 && turn < best.turn - 1e-9)) {
        best = { x: cx + 0.5, z: cz + 0.5, y: g, yaw: dirYaw, d, turn, via };
      }
      break;
    }
  }
  return best;
}

// Opportunistic draw at a free-choice point: 50/50 off the mob's own step
// stream (seeded once off the ambient rand, like the junction stream — step
// rolls never shift the ambient draw sequence, so rigs with no stairs
// around stay bit-identical). Only on solid ground (never mid-air, never
// floating — the drive below only runs supported). Commits face the drop
// (perpendicular for a straight drop, diagonal for a corner one) and walk
// it in a straight line. Installing drops any held lane/line: a step
// commit owns a lane-less mob (a rail would otherwise keep the servo
// driving and starve the commit).
//
// A drop straight ahead is not a draw at all: the descent direction is
// clear, so the mob walks it (no turn, no parasite rotation, no coin that
// keeps the flight from ever being taken). `clearOnly` restricts the
// offer to that case — the standing offer, made before the servo, where
// an oblique drop would pull the mob off its line.
//
// A corner crossing (a diagonal around a core, the head of a spiral) is
// such a head too: the mob walks it wide and drops onto the tread beyond.
// The standing offer takes it as well — the flight is walked, not ridden
// as a rail — but it keeps the coin out of it, so the offer never pulls
// the mob off its line.
export function maybeStepCommit(mob, rand = Math.random, clearOnly = false) {
  if (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null) return false;
  if (!hasSupport(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw)) return false;
  const found = scanStep(mob);
  if (!found) return false;
  const clear = found.turn <= STEP_CLEAR_TURN && found.d <= STEP_CLEAR_DIST;
  const head = found.via != null && found.d <= STEP_CLEAR_DIST;
  if (clearOnly && !clear && !head) return false;
  if (!clear) {
    const srng = mob.stepRng ?? (mob.stepRng = spawnRng(rand));
    if (srng() >= 0.5) return false;
  }
  installStepCommit(mob, found, found.yaw);
  return true;
}

// Chain on arrival: another eligible drop/jump within scan range and the
// ±90° window re-commits (deterministic — the stairs own the walk until
// they run out). A continuation straight ahead keeps the heading: no
// re-facing, no parasite rotation — straight and diagonal stairs walk
// without ever turning. Returns false when nothing continues (the caller
// drops the commit back to regular movement).
export function chainStepCommit(mob) {
  const found = scanStep(mob, STEP_SCAN, STEP_TURN_MAX, mob.yaw, true);
  if (!found) return false;
  // Same profile straight ahead: keep walking the line we are on. A face
  // change here would read as a stutter step mid-flight.
  const keep = found.turn <= 0.15;
  installStepCommit(mob, found, keep ? mob.yaw : found.yaw);
  return true;
}

// One predicate behind every step guard (mover, roam): a step commit owns
// the mob until the stairs run out, and nobody yanks it off them.
export const isStepCommit = (mob) => mob.roam?.step === true;

// A corner crossing walks the crossing point clear of the core, then the
// mob leaves the tread and drops onto the landing beyond — from there it
// aims at the landing, so the fall carries it onto the tread. Read by the
// roam drive every tick; the mover fallback (airborne only) aims at the
// landing directly instead.
export function updateStepVia(mob) {
  const r = mob.roam;
  if (!r?.via) return false;
  if (!(mob.pos.y < r.viaY - VIA_LEAVE_DROP ||
      Math.hypot(r.via.x - mob.pos.x, r.via.z - mob.pos.z) < VIA_REACH_DIST)) return false;
  // The crossing point is reached (or the mob has left the tread): it
  // aims at the tread beyond and steps down onto it.
  r.target = r.land;
  r.tgt = r.land;
  mob.target = r.land;
  return true;
}

// A corner crossing: the drop is diagonal around a solid corner, so the
// body cannot sweep it — the mob walks the crossing point clear of the
// core instead and drops onto the tread beyond. The commit then carries
// the crossing point (`via`), the landing it must end on (`land`) and the
// level it leaves from (`viaY`): the drive walks the crossing point, and
// once the mob has left the tread it aims at the landing.
export function applyVia(mob, found) {
  const c = mob.roam;
  if (!c) return;
  if (!found.via) {
    c.via = null; c.land = null; c.viaY = null;
    return;
  }
  c.via = { x: found.via.x, z: found.via.z };
  c.land = { x: found.x, z: found.z };
  c.viaY = mob.pos.y;
  c.target = c.via;
  c.tgt = c.via;
  c.heading = Math.atan2(c.via.x - mob.pos.x, c.via.z - mob.pos.z);
  mob.target = c.via;
}
