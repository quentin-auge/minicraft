// Roam: directional locomotion for everything outside servo lanes (rooms,
// fields, pen, open ground). No positional servo anywhere here — only
// committed headings + validated stride targets. Tunnel-entry attraction
// (entry.js) steers through these same commits and primes over them.
// The wall rule also lives here: contact latches a virtual touch line
// (50/50 entry on frontal or flank graze — WALL_ENTRY_P), biasing the
// servo's lateral pull — the probes stay real, so branch visibility
// never degrades.
// A touch ride leaves its wall two ways: one time in five it exits straight
// on an outer turn instead of rounding it; otherwise it keeps the same wall
// end to end (same wall, inner and outer corners taken, true ends U-turned
// in place) until its roam-clock budget (wallSpan, 2–8 s) runs out — then it
// quits to roam in the roomiest of 45° or 90° away from the wall, or keeps
// riding when boxed in; only a genuinely continuing 1-wide corridor hands
// over to the rail.
// Progress is one watchdog (R6, in the mover): no per-mode counters here.
// Three-free: physics come from step.js, the gap scan from corridor.js.
import {
  dirVec, snapCardinal, normYaw, yawDiff, rayDist, PROBE_DIST, ENTRY_STALL_T,
  oppositeYaw, isTwoWideMouth, ENTRY_COOL_T, mobHeadsToCooledMouth, insideCooledMouth,
} from "./corridor.js";
import {
  makeStepOk, makeCellFree, makeCellSolid, turnTo, moveClamped, driveToward, strideTarget,
  dropLane, TURN_RATE, VIRTUAL_W, NO_EXPIRY, SPIN, descendOk, slideDeflect,
  segmentWalkable,
} from "./step.js";

// Wall face within this engages following.
// Touch rides run on a roam-clock budget (wallSpan, sampled per latch),
// then quit to roam — pinned test rigs (mob.pinWallRide) ride forever.
export const FOLLOW_RANGE = 1.2;
export const ARRIVE_D = 0.6;
export const FOLLOW_COOL = 2.0;
// Wall-follow entry: half of all wall contacts (frontal or flank) latch
// a ride; the rest keep roaming. A refusal holds the next latch off for
// FOLLOW_COOL, so each wall visit is one coin flip, not a per-tick flip.
export const WALL_ENTRY_P = 0.5;
// Outer-turn lottery: a ride rounding an outer corner with open front
// exits straight instead, one time in five. Blocked noses always turn;
// pinned rigs always round (no draw).
export const WALL_TURN_EXIT_P = 0.2;
// Every latched decision (commit or wall ride) runs 2–8 s, then re-decides.
export const SPAN_MIN = 2;
export const SPAN_MAX = 8;
export function roamSpan(rand = Math.random) {
  return SPAN_MIN + rand() * (SPAN_MAX - SPAN_MIN);
}
// 8-wind compass for commit headings: cardinals plus diagonals, so roam
// walks oblique lines, not only right angles. Shuffled per decide;
// determinism comes from the injected rand.
export const WINDS8 = [
  0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4,
  Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4,
];

// Body fits at (x, z) in the caller's grounded dry context.
function bodyFits(mob, supported, floating, yaw, x, z) {
  return makeStepOk(mob, supported, floating, 0, yaw, 0)(x, z);
}

// First candidate heading with 3+ blocks free, else the roomiest.
// blockedDir (optional peer gate) vetoes winds aimed into another mob:
// the commit routes around the scrum instead of aiming through it and
// grinding on the gate until the stuck detector fires. Null keeps the
// legacy voxel-only behavior bit-identical (no extra rand draws).
function openHeading(mob, supported, floating, cands, rand = Math.random, blockedDir = null) {
  let roomiest = null, roomiestD = -1;
  for (const h of cands) {
    if (blockedDir && blockedDir(h)) continue;
    const dx = Math.sin(h), dz = Math.cos(h);
    const fit = (x, z) => !bodyFits(mob, supported, floating, h, x, z);
    const d = rayDist(mob.pos.x, mob.pos.z, dx, dz, fit, 3.0, 0.1);
    if (d >= 2.9) return h;
    if (d > roomiestD || (d === roomiestD && rand() < 0.5)) { roomiest = h; roomiestD = d; }
  }
  // Everything open is walled or peer-blocked: fall back to the roomiest
  // wind regardless of peers (a vetoed step still stops at contact range
  // via the commit gate; standing still is never an option).
  if (roomiest != null) return roomiest;
  if (!blockedDir) return null;
  for (const h of cands) {
    const dx = Math.sin(h), dz = Math.cos(h);
    const fit = (x, z) => !bodyFits(mob, supported, floating, h, x, z);
    const d = rayDist(mob.pos.x, mob.pos.z, dx, dz, fit, 3.0, 0.1);
    if (d >= 2.9) return h;
    if (d > roomiestD || (d === roomiestD && rand() < 0.5)) { roomiest = h; roomiestD = d; }
  }
  return roomiestD > 0.5 ? roomiest : null;
}

function shuffled(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Exact wall-face measurement along a cardinal: cell-stepping (integer
// boundaries, never a fit), unified solid/air-wall predicate. Returns
// {face, dirSign, cell} (face in world lateral coords, dirSign = ±1 toward
// the wall, cell = first solid cell) or null when no wall runs within
// range. origin overrides the measuring point (corner lookahead); cells
// stay absolute. The cell lets touch-ride re-decisions check same-wall
// continuity (see sameWallFace/connectedTake) instead of latching whatever
// wall stands near.
export function measureWallTake(mob, axis, sideDir, origin = null, range = FOLLOW_RANGE + 0.05) {
  const [ax] = dirVec(axis);
  const [sx, sz] = dirVec(sideDir);
  const latIsX = ax === 0;
  const ox = origin ? origin.x : mob.pos.x, oz = origin ? origin.z : mob.pos.z;
  const cx = Math.floor(ox), cz = Math.floor(oz);
  const cellFree = makeCellFree(mob);
  for (let k = 1; k < 4; k++) {
    const bx = cx + sx * k, bz = cz + sz * k;
    if (!cellFree(bx, bz)) {
      const face = sx !== 0 ? (sx > 0 ? bx : bx + 1) : (sz > 0 ? bz : bz + 1);
      const posLat = latIsX ? ox : oz;
      const dirSign = latIsX ? sx : sz;
      if ((face - posLat) * dirSign > range) return null;
      return { face, dirSign, cell: { x: bx, z: bz } };
    }
  }
  return null;
}

// Latch a virtual follow lane: {axis, line, side, rel, virtual, face,
// t, wallSpan} with the lane middle at the adjacent cell centre (0.5
// from the face) and side = ±1 toward the invisible complementary wall.
// face records the followed physical face plane (world lateral coord) so
// ride re-decisions keep the same wall (see sameWallFace/connectedTake
// below). rel records the physical side (+1 wall on the left of travel,
// -1 on the right) so junction choices keep the same wall. Only contact
// latches (frontal or flank): every line is a touch ride, and the servo
// releases it (corner, U-turn, pocket pace, 1-wide handover, or the
// roam-clock budget below). t is seconds ridden, wallSpan the sampled
// budget (game only; pinned rigs leave it unset and ride forever).
// Returns false when no wall runs near along axis, or when the mob stands
// in a true 1-wide corridor (both side mouths walled): the corridor rail
// owns it alone — latching a line there would ping-pong the lateral
// target with the real centre slide and hijack junction draws.
function latchVirtual(mob, axis, sideDir, range = FOLLOW_RANGE + 0.05) {
  const m = measureWallTake(mob, axis, sideDir, null, range);
  if (!m) return false;
  const [lax, laz] = dirVec(axis);
  const cellFree = makeCellFree(mob);
  const lcx = Math.floor(mob.pos.x), lcz = Math.floor(mob.pos.z);
  if (!cellFree(lcx - laz, lcz + lax) && !cellFree(lcx + laz, lcz - lax)) return false;
  const rel = yawDiff(sideDir, normYaw(axis - Math.PI / 2)) < 1e-9 ? 1 : -1;
  mob.followLine = {
    axis, line: m.face - m.dirSign * (VIRTUAL_W / 2), side: -m.dirSign,
    rel, virtual: true, face: m.face,
  };
  return true;
}

// Freshly latched touch lines pull the body onto the line for this many
// ticks, bypassing the slide's stale-line guard: contact latches from up
// to 1.25 away while the body is still turning in, and without the bypass
// the slide would drag toward the cell centre (away from the wall) until
// the ride starves and drops. Same window as the corner turn hold.
export const LATCH_FRESH_TICKS = 30;
// Gentle rides (2-wide passage exits) converge instead of yanking: the
// lateral slide runs at a fraction of stride, so the bypass window runs
// longer to cover the same snap distance (~0.7 m at 0.3× stride ≈ 90
// ticks). Same glue at the end, no visible sideways jump at the start.
export const GENTLE_RATE = 0.3;
export const GENTLE_FRESH_TICKS = 90;
// Head-on tolerance: at or below this gap between the mob's heading and
// the wall normal the touch counts as straight-on (90°) and draws lots;
// past it the touch counts as oblique (<90°) and keeps its direction.
// One place to tune both behaviours.
export const HEADON_TOL = 0.26; // ~15 degrees
// Touch latch (50/50 entry — WALL_ENTRY_P — on real contact, no random
// before the measure, so open-field and true 1-wide ticks draw nothing):
// the way ahead is blocked and the contacted wall is latched as a
// virtual corridor.
// axisProbe is the snapped facing (into the wall); the lane runs along
// one of its two parallels, on the contacted side. Straight-on touches
// (heading within HEADON_TOL of the wall normal) draw lots 50/50 between
// the two parallels — even with a target to one side; oblique touches
// keep their direction (target side first, else the current sense).
// A refused contact holds the next latch off (FOLLOW_COOL) and declines
// to roam. Pinned rigs (mob.pinWallRide) keep the legacy 100% latch with
// no draw, so their streams stay bit-identical. Deterministic per rand
// stream: same seed, same side. Pre-aligns the
// yaw. Returns the lane axis or null (stub end, graze past reach, or a
// refused contact — the caller declines to roam).
export function latchTouchWall(mob, dt, axisProbe, targetHeading = null, rand = Math.random, o = {}) {
  const opts = [normYaw(axisProbe + Math.PI / 2), normYaw(axisProbe - Math.PI / 2)];
  let axis;
  if (o.forcedAxis != null) {
    axis = o.forcedAxis;
  } else if (yawDiff(mob.yaw, axisProbe) <= HEADON_TOL) {
    axis = rand() < 0.5 ? opts[0] : opts[1];
  } else if (targetHeading != null) {
    axis = yawDiff(targetHeading, opts[1]) < yawDiff(targetHeading, opts[0]) ? opts[1] : opts[0];
  } else {
    axis = yawDiff(mob.yaw, opts[1]) < yawDiff(mob.yaw, opts[0]) - 1e-9 ? opts[1] : opts[0];
  }
  if (!latchVirtual(mob, axis, axisProbe)) {
    const other = axis === opts[0] ? opts[1] : opts[0];
    if (!latchVirtual(mob, other, axisProbe)) return null;
    axis = other;
  }
  // Probabilistic entry + ride budget (game only — pinned rigs skip both
  // with no draw; a directed entry latch skips the entry draw — already
  // paid at the mouth — but keeps the budget). The gate rolls only on real
  // contact, so refusals are the only new draw on this path. The budget
  // samples the roam clock (uniform 2–8 s): expiry quits on the same
  // distribution as a roam commit.
  mob.followLine.t = 0;
  if (mob.pinWallRide !== true && !o.skipDraw) {
    if (rand() >= WALL_ENTRY_P) { mob.followLine = null; mob.followCool = FOLLOW_COOL; return null; }
  }
  if (mob.pinWallRide !== true) {
    mob.followLine.wallSpan = roamSpan(rand);
  }
  // Touch rides (and only they) get forced junction exits + corner
  // rounding in the servo: without forced exits a ride would orbit its
  // wall instead of taking arms and rounding tips.
  // Fresh line: pull the body onto it while turning in (see above).
  mob.followLine.touch = true;
  mob.followLine.fresh = LATCH_FRESH_TICKS;
  mob.yawTarget = axis;
  turnTo(mob, dt, TURN_RATE);
  return axis;
}

// Flank touch: walking along an axis with a wall rubbing the flank
// (face within half a block) latches the same touch ride as a frontal
// hit, on the current axis — no direction choice, the mob simply keeps
// going, now glued. Same 50/50 entry gate as frontal contact (refusals
// hold the next latch off; pinned rigs keep 100% with no draw).
// Returns the lane axis or null (no wall rubbing either flank, or a
// refused contact). Deterministic: the nearer flank wins, ties keep the
// current sense.
export const FLANK_TOUCH_D = 0.55;
export function latchFlankTouch(mob, dt, axis, rand = Math.random, o = {}) {
  const latA = normYaw(axis + Math.PI / 2), latB = normYaw(axis - Math.PI / 2);
  const ma = measureWallTake(mob, axis, latA, null, FLANK_TOUCH_D + 0.05);
  const mb = measureWallTake(mob, axis, latB, null, FLANK_TOUCH_D + 0.05);
  if (!ma && !mb) return null;
  // 2-wide mouths thread straight: a flank graze inside one is passage,
  // never contact — declining here instead of yanking the mob onto an edge
  // line.
  if (isTwoWideMouth(
    Math.floor(mob.pos.x), Math.floor(mob.pos.z), axis, makeCellFree(mob), makeCellSolid(mob))) return null;
  // Nearest face wins; ties keep the flank the mob already leans toward.
  const [ax] = dirVec(axis);
  const latIsX = ax === 0;
  const posLat = latIsX ? mob.pos.x : mob.pos.z;
  const gap = (m) => Math.abs(m.face - posLat);
  let sideDir = null;
  if (ma && mb) {
    const ga = gap(ma), gb = gap(mb);
    if (Math.abs(ga - gb) < 1e-9) {
      // Tie: keep the wall on the current sense side — the flank the mob
      // already leans toward stays the followed one.
      const leanA = yawDiff(mob.yaw, latA), leanB = yawDiff(mob.yaw, latB);
      sideDir = leanA < leanB ? latA : latB;
    } else sideDir = ga < gb ? latA : latB;
  } else sideDir = ma ? latA : latB;
  if (!latchVirtual(mob, axis, sideDir, FLANK_TOUCH_D + 0.05)) return null;
  mob.followLine.t = 0;
  if (mob.pinWallRide !== true && !o.skipDraw) {
    if (rand() >= WALL_ENTRY_P) { mob.followLine = null; mob.followCool = FOLLOW_COOL; return null; }
  }
  if (mob.pinWallRide !== true) {
    mob.followLine.wallSpan = roamSpan(rand);
  }
  mob.followLine.touch = true;
  mob.followLine.fresh = LATCH_FRESH_TICKS;
  mob.yawTarget = axis;
  turnTo(mob, dt, TURN_RATE);
  return axis;
}

// Unified mouth exit (exitMouth): 1-wide rail releases draw the five-arm
// table (25% wall-follow left, 25% right, 25% straight, 12.5% ±45° — a drawn
// side with no latchable wall takes the other side when it has one, else
// free roam); kind-2 draws go through twoStageExit below (wall intent or
// straight, never angles). Far from any wall a 1-wide exit roams free
// (straight 50% / ±45° 25% each). Wall rides hug straight out along a
// continuing wall, else turn 90° onto a validated continuing exterior face
// (pen ring) — a lone stub with nothing to hug roams, so freestanding
// mouths always roam out. An erected ride is an ordinary touch ride (roam
// clock budget, junction takes, corner rounding, blue) — it keeps following
// past the mouth like any wall contact. Every exit arms the global entry
// cooldown (ENTRY_COOL_T), so arrivals walk away instead of re-drawing the
// mouth. Returns true when a lane erected (servo owns the tick), false on a
// roam commit (roam steps). Left/right read off the exit axis (rel
// convention: +1 wall on the left of travel). opts carries the passage
// kind (kind 1/2, defaulting to the mouth read) and noSlide (erected rides
// travel parallel without converging onto their line).
export const EXIT_WALL_MARGIN = 0.25;
// Latch grace after an exit roam commit: contact latches stay off this long
// so a drawn straight/diagonal actually walks (~1 m) before anything
// converts it. Rides erecting on contact are unaffected.
export const EXIT_ROAM_GRACE = 0.5;
export function exitMouth(mob, exitAxis, dt, supported, floating, rand = Math.random, pickTarget, sense = null, opts = {}) {
  exitAxis = snapCardinal(exitAxis);
  const cellFree = sense?.cellFree ?? makeCellFree(mob);
  const kind = opts.kind ?? (isTwoWideMouth(
    Math.floor(mob.pos.x), Math.floor(mob.pos.z), exitAxis, cellFree, makeCellSolid(mob)) ? 2 : 1);
  // Every exit arms the entry-cooldown timer. The key travels with it when
  // the caller keys the mouth just left (opts.key, exact cell key from the
  // thread close or the rail-release probe): timer+key together gate the
  // same-mouth re-draw. Callers mid-thread pass no key so the gate of the
  // mouth just left is never erased by the mouth underfoot.
  const done = (v) => {
    mob.entryCoolT = ENTRY_COOL_T;
    if (opts.key != null) mob.entryCoolKey = opts.key;
    return v;
  };
  // Kind 2 exits go through the two-stage rule below (never angles); 1-wide
  // is always wall-close by construction and keeps the five-arm table.
  if (kind === 2) {
    return twoStageExit(mob, exitAxis, dt, supported, floating, rand, pickTarget, sense, cellFree, opts, done);
  }
  {
    const latL = normYaw(exitAxis - Math.PI / 2), latR = normYaw(exitAxis + Math.PI / 2);
    const leftTake = exitArmTake(mob, exitAxis, latL, supported, floating, sense, cellFree);
    const rightTake = exitArmTake(mob, exitAxis, latR, supported, floating, sense, cellFree);
    const r = rand();
    const arm = r < 0.25 ? "L" : r < 0.5 ? "R" : r < 0.75 ? "S" : r < 0.875 ? "D+" : "D-";
    if (arm === "L" || arm === "R") {
      // No wall on the drawn side: the other side when it has one, else
      // free roam (a lone stub never earns a ride).
      let side = arm === "L" ? latL : latR;
      let take = arm === "L" ? leftTake : rightTake;
      if (take == null) {
        side = arm === "L" ? latR : latL;
        take = arm === "L" ? rightTake : leftTake;
      }
      if (take != null) {
        if (erectExitRide(mob, exitAxis, side, take, dt, kind, cellFree, supported, floating, rand, opts)) return done(true);
      }
      return done(freeRoamExit(mob, exitAxis, supported, floating, rand, pickTarget));
    }
    // Roam arms (shared table, see roamTable below).
    return roamTable(mob, exitAxis, arm, supported, floating, rand, pickTarget, done);
  }
}

// Strictly-close flank gap behind the kind-2 wall intent: face distance
// within touch range plus the exit margin — a centered body never qualifies.
function closeFlankGap(mob, exitAxis, side) {
  const m = measureWallTake(mob, exitAxis, side, null, FLANK_TOUCH_D + 0.05 + EXIT_WALL_MARGIN);
  if (!m) return null;
  const [ax] = dirVec(exitAxis);
  return Math.abs(m.face - (ax === 0 ? mob.pos.x : mob.pos.z));
}

// Two-stage exit behind every kind-2 draw, no angles: wall-follow intent
// first (single rand below half → nearest strictly-close flank, restricted
// to that wall's side), then straight.
function twoStageExit(mob, exitAxis, dt, supported, floating, rand, pickTarget, sense, cellFree, opts, done) {
  const latL = normYaw(exitAxis - Math.PI / 2), latR = normYaw(exitAxis + Math.PI / 2);
  if (rand() < 0.5) {
    // Nearest strictly-close flank wins (exact ties, unreachable in a
    // 2-wide, flip a coin).
    const gl = closeFlankGap(mob, exitAxis, latL), gr = closeFlankGap(mob, exitAxis, latR);
    let side = null;
    if (gl != null && gr != null) side = Math.abs(gl - gr) < 1e-9 ? (rand() < 0.5 ? latL : latR) : (gl < gr ? latL : latR);
    else if (gl != null) side = latL;
    else if (gr != null) side = latR;
    if (side != null) {
      const take = exitArmTake(mob, exitAxis, side, supported, floating, sense, cellFree);
      if (take != null &&
        erectExitRide(mob, exitAxis, side, take, dt, 2, cellFree, supported, floating, rand, opts)) {
        return done(true);
      }
    }
  }
  // No close huggable wall, failed erect, or roam intent: straight, period.
  return straightSmooth(mob, exitAxis, supported, floating, rand, done);
}

// Straight-smooth: the single roam shape behind kind-2 exits. A locked
// straight commit (smooth marker, honored by roamStep and the mover: no
// stuck re-pick, no contact-latch conversion, no group-plan override), so
// the crossing reads as one line whatever the nose meets. Nose-blocked at
// the draw holds a short straight stride in place (the step gate stops at
// contact) instead of maneuvering; the span watchdog (roamStep timedOut →
// decide) owns the only release, for liveness.
function straightSmooth(mob, exitAxis, supported, floating, rand, done) {
  if (exitRoamCommit(mob, exitAxis, supported, floating, rand)) {
    mob.roam.smooth = true;
    return done(false);
  }
  const [dx, dz] = dirVec(exitAxis);
  installExitRoam(mob, exitAxis, { x: mob.pos.x + dx, z: mob.pos.z + dz }, rand);
  mob.roam.smooth = true;
  return done(false);
}

// Roam set behind one drawn arm: the arm's headings in priority order
// (diagonals try each other before straight, so a drawn diagonal stays
// diagonal whenever either fits), then the free table as a boxed safety net.
function roamTable(mob, exitAxis, arm, supported, floating, rand, pickTarget, done) {
  const diag = (s) => normYaw(exitAxis + s * Math.PI / 4);
  const seq = arm === "S" ? [exitAxis]
    : arm === "D+" ? [diag(1), diag(-1), exitAxis]
    : [diag(-1), diag(1), exitAxis];
  for (const h of seq) {
    if (exitRoamCommit(mob, h, supported, floating, rand)) return done(false);
  }
  return done(freeRoamExit(mob, exitAxis, supported, floating, rand, pickTarget));
}

// Shared turned-arm geometry behind the precheck and the erect below:
// 90° onto the exterior face when only a mouth flank reads behind but its
// wall continues sideways (pen ring). Measured once, consumed twice.
function turnedMeasure(mob, exitAxis, sideDir, supported, floating, cellFree) {
  const pickLeft = yawDiff(sideDir, normYaw(exitAxis - Math.PI / 2)) < 1e-6;
  const newAxis = sideDir;
  const wallDir = normYaw(newAxis + (pickLeft ? -Math.PI / 2 : Math.PI / 2));
  const [nax, naz] = dirVec(newAxis);
  const ox = mob.pos.x + nax * PROBE_DIST, oz = mob.pos.z + naz * PROBE_DIST;
  const m = measureWallTake(mob, newAxis, wallDir, { x: ox, z: oz });
  if (!m) return null;
  const [wx, wz] = dirVec(wallDir);
  const aheadWalled = !cellFree(Math.floor(ox + nax) + wx, Math.floor(oz + naz) + wz);
  const stepX = mob.pos.x + nax * PROBE_DIST, stepZ = mob.pos.z + naz * PROBE_DIST;
  const walkable = makeStepOk(mob, supported, floating, 0, newAxis, 0)(stepX, stepZ) &&
    descendOk(mob, stepX, stepZ);
  if (!aheadWalled || !walkable) return null;
  return { newAxis, wallDir, m, pickLeft };
}

// Pure precheck for one wall-follow arm: "straight" when the wall continues
// past the drop (the only straight ride that can persist), "turned" with
// its precomputed geometry when only a mouth flank reads behind but its
// wall continues sideways (pen ring), null when nothing huggable stands
// there. Reads only, latches nothing.
function exitArmTake(mob, exitAxis, sideDir, supported, floating, sense, cellFree) {
  if (sense) {
    const hasNow = (d) => sense.walled.some((w) => yawDiff(w, d) < 1e-6);
    if (hasNow(sideDir)) return { kind: "straight" };
  } else if (measureWallTake(mob, exitAxis, sideDir)) {
    return { kind: "straight" };
  }
  const t = turnedMeasure(mob, exitAxis, sideDir, supported, floating, cellFree);
  return t ? { kind: "turned", ...t } : null;
}

// Erect the prechecked wall arm: straight hugs the continuing wall along the
// exit axis, turned rounds 90° onto the exterior face. Gentle glue on 2-wide
// exits (converge, no sideways yank), fresh latch otherwise. The erected
// lane is an ordinary touch ride from here on (budget, takes, rounding) —
// with opts.noSlide the ride travels parallel and never slides laterally
// onto its line (mouth exits: no sideways step while threading).
function erectExitRide(mob, exitAxis, sideDir, take, dt, kind, cellFree, supported, floating, rand, opts = {}) {
  const gentle = kind === 2;
  const kindTake = typeof take === "string" ? take : take?.kind;
  if (kindTake === "straight") {
    if (!latchVirtual(mob, exitAxis, sideDir)) return false;
    mob.lane = { axis: exitAxis, entry: oppositeYaw(exitAxis), lockX: -1, lockZ: -1 };
  } else {
    const t = typeof take === "object" && take?.m ? take :
      turnedMeasure(mob, exitAxis, sideDir, supported, floating, cellFree);
    if (!t) return false;
    const rel = t.pickLeft ? 1 : -1;
    mob.followLine = {
      axis: t.newAxis,
      line: t.m.face - t.m.dirSign * (VIRTUAL_W / 2),
      side: -t.m.dirSign,
      rel, virtual: true, touch: true,
      fresh: gentle ? GENTLE_FRESH_TICKS : LATCH_FRESH_TICKS, face: t.m.face,
      t: 0,
    };
    mob.lane = { axis: t.newAxis, entry: oppositeYaw(t.newAxis), lockX: -1, lockZ: -1 };
  }
  mob.followLine.t = 0;
  if (mob.pinWallRide !== true) mob.followLine.wallSpan = roamSpan(rand);
  mob.followLine.touch = true;
  mob.followLine.fresh = gentle ? GENTLE_FRESH_TICKS : LATCH_FRESH_TICKS;
  if (gentle) mob.followLine.gentle = true;
  if (opts.noSlide === true) mob.followLine.noSlide = true;
  mob.yawTarget = mob.lane.axis;
  turnTo(mob, dt, TURN_RATE);
  mob.stuckT = 0;
  return true;
}

// One roam arm of the exit table: commit along the heading when ~2 blocks of
// room stand there. False when boxed (caller falls back to the free table).
function exitRoamCommit(mob, h, supported, floating, rand) {
  if (!exitRoom(mob, h, supported, floating)) return false;
  const t = strideTarget(mob, h, rand, 1.0, 2.5);
  if (!t) return false;
  installExitRoam(mob, h, t, rand);
  return true;
}

// Shared shape behind every exit roam commit: the latch grace walks with it,
// so a drawn heading expresses itself (~1 m) before contact converts it.
// Callers stamp roam.smooth for locked crossings (straight-smooth kind-2
// exits): the mover and roamStep honor the marker (no stuck re-pick, no
// contact latch, no plan override) until the span watchdog releases it.
function installExitRoam(mob, heading, target, rand) {
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = {
    mode: "commit", heading, target, tgt: target,
    t: 0, span: roamSpan(rand), runT: 0,
  };
  mob.stuckT = 0;
  mob.followCool = Math.max(mob.followCool ?? 0, EXIT_ROAM_GRACE);
}

// Free-roam table shared by every exit without a wall to hug: straight 50%
// of the time, ±45° 25% each, each requiring ~2 blocks of room (validated
// end-to-end anyway), falling back to the roomiest non-backward heading and,
// boxed, to a plain decide — never back inside. Returns false (roam steps).
function freeRoamExit(mob, exitAxis, supported, floating, rand = Math.random, pickTarget) {
  const r = rand();
  const seq = r < 0.5 ? [0, 1, -1] : r < 0.75 ? [1, 0, -1] : [-1, 0, 1];
  for (const s of seq) {
    const h = normYaw(exitAxis + s * Math.PI / 4);
    if (!exitRoom(mob, h, supported, floating)) continue;
    const t = strideTarget(mob, h, rand, 1.0, 2.5);
    if (t) {
      installExitRoam(mob, h, t, rand);
      return false;
    }
  }
  // No exit heading with room: roomiest non-backward heading, then boxed
  // escape (anything goes — no other move exists).
  const back = oppositeYaw(exitAxis);
  const fb = openHeading(mob, supported, floating, WINDS8.filter((h) => yawDiff(h, back) > 1e-9), rand);
  if (fb != null) {
    const t = strideTarget(mob, fb, rand, 1.0, 2.5);
    if (t) {
      installExitRoam(mob, fb, t, rand);
      return false;
    }
  }
  decide(mob, 0, supported, floating, rand, pickTarget);
  return false;
}

// Docking take for a guided (violet) ride: the hole sits within stride
// reach and the straight segment there walks — drop the ride and finish on
// the direct walk (stall re-armed) instead of riding past the mouth. Rides
// can never turn into a hole (no wall to hug past the jamb), so without
// this every alongside approach rides by. Returns true on release (caller
// returns false so roamStep walks this same tick).
export function guidedDock(mob) {
  const c = mob.roam;
  const gl = mob.followLine;
  if (!c?.entry || gl?.guideKey == null || gl.guideKey !== c.passageKey) return false;
  if (!c.target) return false;
  if (Math.hypot(c.target.x - mob.pos.x, c.target.z - mob.pos.z) > 1.5) return false;
  if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, c.target.x, c.target.z)) return false;
  mob.followLine = null;
  dropLane(mob);
  mob.turnHold = 0;
  mob.stuckT = 0;
  mob.servoStall = 0;
  c.stallT = 0;
  c.latchTried = false;
  return true;
}

// ~2 blocks of body-fit room along a heading (margin like openHeading).
function exitRoom(mob, h, supported, floating) {
  const [dx, dz] = dirVec(h);
  const fit = (x, z) => !bodyFits(mob, supported, floating, h, x, z);
  return rayDist(mob.pos.x, mob.pos.z, dx, dz, fit, 2.5, 0.1) >= 1.9;
}

// Corner rounding at a wall end: the ride found no keeping exit but the
// way ahead is open — look one cell ahead for a perpendicular face
// starting on either side (outer corners switch sides first) and head
// into it; the usual touch/upkeep paths latch the new face once
// alongside. Returns the rounding heading plus its face measurement and
// first solid cell (so callers can carry the follow line onto it and
// check same-wall continuity) or null (plain release).
export function cornerTurn(mob, prevAxis) {
  const rel = mob.followLine?.rel ?? 1;
  const [fx, fz] = dirVec(prevAxis);
  const ax = mob.pos.x + fx * 1.0, az = mob.pos.z + fz * 1.0;
  const perps = [normYaw(prevAxis + Math.PI / 2), normYaw(prevAxis - Math.PI / 2)];
  if (rel > 0) perps.reverse(); // wall was left → new face likelier right, and vice versa
  for (const Q of perps) {
    const [qx, qz] = dirVec(Q);
    for (const s of [1, -1]) {
      const sideDir = normYaw(Q + s * Math.PI / 2);
      // Extended reach: the face only shows past the tip, just outside
      // latch range — the commit walks the mob into latch range.
      const m = measureWallTake(mob, Q, sideDir, { x: ax + qx * 1.0, z: az + qz * 1.0 }, 1.75);
      if (m) return { axis: Q, face: m.face, dirSign: m.dirSign, sideDir, cell: m.cell };
    }
  }
  return null;
}

// Same-wall continuity for touch rides: a ride never switches walls.
// Straights keep the same face plane (a hole shares the plane, so doors
// and holes ride through; a parallel face further out is another
// wall). Perpendicular takes (turns, corner roundings) must start where
// the old wall ends: touching it (Chebyshev ≤ 1 — inner corners, tips,
// steps), or continuing straight past at most a 1-cell slit on the same
// travel line (setback). Anything lateral or diagonal past that is
// another wall. Refused takes fall back to the in-place U-turn, never to
// a stranger wall.
export const WALL_TAKE_DIST = 2;
export function sameWallFace(mob, m) {
  const f = mob.followLine?.face;
  return f == null || m.face === f;
}
export function connectedTake(mob, travelAxis, cell) {
  const vw = mob.followLine;
  if (vw?.face == null || vw.side == null) return true; // un-faced line: old behaviour
  const tip = wallTip(mob, travelAxis);
  if (!tip) return false;
  const dx = Math.abs(cell.x - tip.x), dz = Math.abs(cell.z - tip.z);
  if (Math.max(dx, dz) <= 1) return true;
  const [tx] = dirVec(travelAxis);
  const axial = tx !== 0 ? dz === 0 : dx === 0;
  return axial && Math.max(dx, dz) <= WALL_TAKE_DIST;
}
// Last solid cell of the followed wall along travel: back up from the mob
// (it may stand past the tip) to the nearest wall-row cell, then forward
// to the last solid one. Null when the row shows no wall (mined away).
function wallTip(mob, travelAxis) {
  const vw = mob.followLine;
  const turn = Math.abs(normYaw(vw.axis - travelAxis));
  if (turn > 1e-6 && turn < Math.PI - 1e-6) return null; // not parallel: no tip
  // side is ±1 toward the virtual wall in world lateral coords (latch and
  // travel share the world lateral axis while parallel), so -side points
  // at the real wall's cell row.
  const s = -vw.side;
  const F = vw.face;
  const [tx] = dirVec(travelAxis);
  const travelIsX = tx !== 0;
  // Signed unit step along travel (lane axes are cardinal): backing up
  // is -k along it whatever the compass direction — an unsigned scan
  // walks forward for west/south travel and plants the tip behind the mob.
  const [ux, uz] = dirVec(travelAxis);
  const rowLat = s > 0 ? Math.floor(F) : Math.ceil(F) - 1;
  // The face must still exist at the tip cell: the neighbour on the
  // mob's side stays open. Past a corridor mouth the bank runs on but
  // the face is gone — without this the tip sails past the mouth and
  // connected takes diverge between open and walled geometries.
  const mobLat = s > 0 ? F - 1 : F;
  const cellFree = makeCellFree(mob);
  const mcx = Math.floor(mob.pos.x), mcz = Math.floor(mob.pos.z);
  const solidAt = (k) => {
    const bx = travelIsX ? mcx + ux * k : rowLat;
    const bz = travelIsX ? rowLat : mcz + uz * k;
    if (cellFree(bx, bz)) return false;
    const mx = travelIsX ? mcx + ux * k : mobLat;
    const mz = travelIsX ? mobLat : mcz + uz * k;
    return cellFree(mx, mz);
  };
  let anchor = null;
  for (let k = 0; k >= -6; k--) {
    if (solidAt(k)) { anchor = k; break; }
  }
  if (anchor == null) return null;
  let tip = anchor;
  for (let k = anchor + 1; k <= anchor + 8; k++) {
    if (!solidAt(k)) break;
    tip = k;
  }
  return {
    x: travelIsX ? mcx + ux * tip : rowLat,
    z: travelIsX ? rowLat : mcz + uz * tip,
  };
}

// Follow-line upkeep: the servo owns motion while a lane holds, this
// pass only maintains the lateral bias. Latches when a wall runs near,
// drops on axis turns, hands true 1-wide corridors to the rail, and drops
// past lost walls. Touch rides persist until released: the servo owns
// their release (corner rounding, in-place U-turn, pocket pace) plus the
// roam-clock budget (the mover quits expired rides) — this pass only
// mirrors the line on U-turn flips, ticks the corner freshness and the
// ride clock down, and hands over where a corridor genuinely continues. Owned by the servo tick
// (called at its top): roam.js keeps the follow-line mechanics that decide
// shares, the servo owns the per-tick orchestration.
export function upkeepFollowLine(mob, dt) {
  mob.followCool = Math.max(0, (mob.followCool ?? 0) - dt);
  if (!mob.lane) return;
  // A guided stall slide keeps its entry commit: the ride is a means to
  // the hole, not a conversion — target, clock and claim survive until
  // arrival/timeout closes them. Anything else: servo owns motion now.
  const guided = mob.roam?.entry === true &&
    mob.followLine?.guideKey === mob.roam.passageKey;
  if (mob.roam?.mode === "commit" && !guided) mob.roam = null;
  const vw = mob.followLine;
  if (!vw) return;
  // Opposite headings share the corridor line: a U-turn flip keeps the
  // latched wall (same lateral, no re-erect churn) — realign the latch on
  // the flipped axis and mirror the relative side (the wall that was left
  // is now right). Anything else drops.
  const vwTurn = Math.abs(normYaw(vw.axis - mob.lane.axis));
  if (vwTurn > Math.PI - 1e-6) {
    vw.axis = mob.lane.axis;
    vw.rel = -(vw.rel ?? 1);
  } else if (vwTurn > 1e-6) {
    // Turned into something else (a stall dropped the lane and the
    // classifier re-engaged elsewhere): drop with a cooldown holding the
    // next latch off, so the mob walks clear instead of re-latching a
    // stranger. New walls only ever latch from open motion.
    mob.followLine = null;
    mob.followCool = FOLLOW_COOL;
    return;
  }
  // Touch rides persist until released: the servo owns their release
  // (corner rounding, pocket pace, roam-clock budget). Only mirror the
  // line on U-turn flips and tick the corner freshness down. Every line
  // is a touch line (contact is the only latch left), so no other case
  // remains below.
  // Core rule: a 1-wide tunneled cell belongs to the rail — the touch line
  // drops the tick the ride threads one, whether the tunnel continues or
  // opens ahead (a fence hole reads tunneled here and open past it). The
  // rail cruises while tunneled and releases to roam past the mouth, so a
  // wall-follower passing through a pen hole runs red, never blue.
  if ((vw.fresh ?? 0) > 0) vw.fresh--;
  if (vw.touch === true) vw.t = (vw.t ?? 0) + dt;
  const [bax, baz] = dirVec(mob.lane.axis); const cellFree = makeCellFree(mob);
  const bcx = Math.floor(mob.pos.x), bcz = Math.floor(mob.pos.z);
  if (!cellFree(bcx - baz, bcz + bax) && !cellFree(bcx + baz, bcz - bax)) {
    mob.followLine = null;
  }
}

// Directed wall touch for a stalled entry commit: the straight push is
// blocked, so touch the blocking wall and follow it toward the hole with
// the existing ride machinery (virtual line, followExit, corner turns,
// rail handover) instead of grinding. Direction is forced hole-ward and
// the entry draw is skipped (already paid at the mouth — only the ride
// budget draws, pinned rigs draw nothing, exactly like a normal latch).
// The ride stays guided: guideKey (+hole coords) stamps the line so the
// upkeep preserves the entry commit while this key matches, and followExit
// steers hole-ward with the coords below — the slide never degrades into
// a plain wall ride. Erects the lane like tryPreLane and returns true;
// null when no wall is latchable (the caller reroutes via the approach
// cell, and gives up past a second stall).
export function entryStallLatch(mob, dt, supported, floating, rand) {
  const c = mob.roam;
  const yawTo = Math.atan2(c.target.x - mob.pos.x, c.target.z - mob.pos.z);
  const probe = snapCardinal(yawTo);
  const [px, pz] = dirVec(probe);
  const aheadX = mob.pos.x + px * PROBE_DIST, aheadZ = mob.pos.z + pz * PROBE_DIST;
  const fitBody = makeStepOk(mob, supported, floating, 0, probe, 0);
  const fwdBlocked = !fitBody(aheadX, aheadZ) || !descendOk(mob, aheadX, aheadZ);
  let axis = null;
  if (!fwdBlocked) {
    // Nose-only wedge: the body fits ahead, the visual head does not — a
    // flank wall within reach owns the slide toward the hole.
    axis = latchFlankTouch(mob, dt, probe, rand, { skipDraw: true });
  } else {
    // Frontal block: try the parallels hole-side first, no fallback to
    // the far side (riding away from the hole is never the answer).
    const toTx = c.target.x - mob.pos.x, toTz = c.target.z - mob.pos.z;
    const cands = [normYaw(probe + Math.PI / 2), normYaw(probe - Math.PI / 2)];
    cands.sort((x, y) => {
      const dx = toTx * (Math.sin(y) - Math.sin(x)) + toTz * (Math.cos(y) - Math.cos(x));
      if (Math.abs(dx) > 1e-9) return dx > 0 ? 1 : -1;
      return yawDiff(x, mob.yaw) - yawDiff(y, mob.yaw);
    });
    axis = latchTouchWall(mob, dt, probe, null, rand, { forcedAxis: cands[0], skipDraw: true });
  }
  if (axis == null) return false;
  mob.lane = { axis, entry: oppositeYaw(axis), lockX: -1, lockZ: -1 };
  mob.stuckT = 0;
  if (mob.followLine) {
    mob.followLine.claimKey = c.passageKey;
    // Guided slide: the upkeep preserves the entry commit while this key
    // matches, and followExit steers hole-ward with the coords below.
    mob.followLine.guideKey = c.passageKey;
    mob.followLine.guideTx = c.target.x;
    mob.followLine.guideTz = c.target.z;
    // Gentle glue like passage exits: converge onto the line instead of
    // yanking — the ride still aligns (forward stride is full), only the
    // sideways jump disappears.
    mob.followLine.gentle = true;
    mob.followLine.fresh = GENTLE_FRESH_TICKS;
  }
  return true;
}

// Pending guided erect for an entry commit still riding its touch line:
// the nose meets the wall toward the hole, so erect the hole-ward touch
// now instead of dropping to a free commit that pivots toward the mouth
// first (the dip). Runs in the servo tick (roamStep never runs laned).
// True once per episode (guided flag); the ride owns the slide after.
export function tryGuidedErect(mob, dt, supported, floating, rand = Math.random) {
  const c = mob.roam;
  if (!c?.entry || c.guided) return false;
  if (!mob.lane || mob.followLine?.guideKey !== c.passageKey) return false;
  const yawTo = Math.atan2(c.target.x - mob.pos.x, c.target.z - mob.pos.z);
  const probe = snapCardinal(yawTo);
  const [px, pz] = dirVec(probe);
  const aheadX = mob.pos.x + px * PROBE_DIST, aheadZ = mob.pos.z + pz * PROBE_DIST;
  const fitBody = makeStepOk(mob, supported, floating, 0, probe, 0);
  if (fitBody(aheadX, aheadZ) && descendOk(mob, aheadX, aheadZ)) return false;
  if (!entryStallLatch(mob, dt, supported, floating, rand)) return false;
  c.guided = true;
  return true;
}

// Decision + stepping when the servo owns nothing. Returns handled.
export function roamStep(mob, dt, supported, floating, rand = Math.random, pickTarget, blocked = null, forceHeading = null) {
  if (mob.lane) return false;
  const r = mob.roam;
  const broken = r && r.mode && mob.target !== r.tgt;
  const arrived = r && r.mode === "commit" && mob.target &&
    Math.hypot(r.target.x - mob.pos.x, r.target.z - mob.pos.z) < ARRIVE_D;
  const expired = r && r.mode && mob.wanderT <= 0;
  // Entry commits never time out into a decide (that U-turns a committed
  // mob): arrival or the ENTRY_TIMEOUT backstop in entryTick closes them.
  const timedOut = r && r.mode && !r.entry && (r.t ?? 0) > (r.span ?? SPAN_MAX);
  if (!r || !r.mode || broken || arrived || expired || timedOut || !mob.target) {
    decide(mob, dt, supported, floating, rand, pickTarget, blocked);
    if (!mob.roam?.mode) return false;
  }
  // Commit step toward the latched target. Entry commits drive straight at
  // the claimed slot — no lateral pull toward the travel line (a 2-wide
  // walks through, never rabats). An entry whose straight push wedges
  // (aligned but blocked past ENTRY_STALL_T) touches the blocking wall and
  // follows it toward the hole with the existing ride machinery; when no
  // wall is latchable at all it detours via the mouth's approach cell
  // (still violet, still hole-ward — a frontal push from the approach clips
  // no corner) instead of grinding in place; only a wedged detour gives up
  // (the commit closes with a re-draw cooldown). Same rate-limited drive
  // throughout, so every turn reads natural. Arrival still reads against
  // the mouth centre itself.
  const c = mob.roam;
  const makeCommit = () => {
    const base = makeStepOk(mob, supported, floating, mob.nose.along, mob.yaw);
    return blocked ? (nx, nz) => base(nx, nz) && !blocked(nx, nz) : base;
  };
  // Detour arrival: reached the approach cell — drop the waypoint and push
  // frontal (re-armed, so a latch fires from the new spot if still wedged).
  if (c.entry && c.axis != null && c.detour) {
    const [fax, faz] = dirVec(c.axis);
    if (Math.hypot(c.target.x - fax - mob.pos.x, c.target.z - faz - mob.pos.z) < ARRIVE_D) {
      c.detour = false; c.stallT = 0; c.latchTried = false;
    }
  }
  let yawGoal;
  if (c.detour) {
    const [fax, faz] = dirVec(c.axis);
    yawGoal = Math.atan2(c.target.x - fax - mob.pos.x, c.target.z - faz - mob.pos.z);
  } else if (forceHeading != null && !c.entry && !c.smooth) {
    // Group-plan override (forecast.js): the latched evasion heading wins
    // over the point re-aim for the tick. Entry commits ignore it — guided
    // hole-ward lines are never yanked — and smooth crossings ignore it too
    // (locked lines stay locked even in a crowd).
    yawGoal = forceHeading;
  } else {
    yawGoal = Math.atan2(c.target.x - mob.pos.x, c.target.z - mob.pos.z);
  }
  // Entries drive straight at the slot so the stall path converts wedges
  // to a hole-ward ride first; once the latch fails (no wall in reach —
  // open-field corner wedge, posed illegal by millimetres) they detour via
  // the approach cell; detours and post-latch walks deflect like any roam
  // instead of grinding in place. Progress re-arms the latch, so
  // wall-following stays preferred wherever a wall exists.
  if (!c.entry || c.latchTried || c.detour) yawGoal = slideDeflect(mob, dt, yawGoal, supported, floating);
  const yawBefore = mob.yaw;
  const { err, dist } = driveToward(mob, dt, yawGoal, makeCommit, moveClamped);
  // Anti-orbit guard: a lane-less open commit that rotates past ~1.6 turns
  // without arriving is lost (sidewalk-dance with a peer, orbit around a
  // pushed-off line) — drop it so decide re-aims fresh instead of grinding
  // out the pirouette. Entries exempt (their stall latch owns wedges);
  // detours included (a lost sidestep re-decides too). Well under the
  // headless pirouette bound, far above any frank turn (turnarounds,
  // detour reversals).
  if (!c.entry) {
    c.rot = (c.rot ?? 0) + Math.abs(normYaw(mob.yaw - yawBefore));
    if (c.rot > 5.0) { mob.roam = null; return true; }
  }
  if (c.entry && c.axis != null) {
    // Spin-in-place ticks are turning, not stuck: only a gated-aligned
    // refusal accrues the stall. Past the threshold the stall turns into
    // a directed wall touch (retried whenever the stall re-accrues after a
    // lane release — the hole may be latchable from the new spot).
    if (dist > 1e-6 || err >= SPIN) { c.stallT = 0; c.latchTried = false; }
    else c.stallT = (c.stallT ?? 0) + dt;
    if (!c.latchTried && (c.stallT ?? 0) > ENTRY_STALL_T) {
      c.latchTried = true;
      if (entryStallLatch(mob, dt, supported, floating, rand)) {
        c.t = (c.t ?? 0) + dt;
        return true;
      }
      // Latch failed: first stall reroutes via the approach cell (same
      // commit, still violet); a stalled detour gives up instead — the
      // commit is unworkable, entryTick closes it with a cooldown.
      if (!c.detour) {
        c.detour = true; c.stallT = 0; c.latchTried = false;
      } else {
        c.giveUp = true;
      }
    }
  }
  c.t = (c.t ?? 0) + dt;
  return true;
}

// Same-heading run budget: chained commits within RUN_ALIGN of the
// previous one accumulate their spans; past RUN_MAX the next commit turns
// for real instead of chaining straight forever in the open. One rule
// (cumulative time) subsumes count- and time-based caps alike.
export const RUN_ALIGN = Math.PI / 6;
export const RUN_MAX = 8;

function latchCommit(mob, heading, target, rand = Math.random, prev = null) {
  // A continuing run accrues the previous span; anything else (arrival,
  // break, release, forced turn) restarts the budget.
  let runT = 0;
  if (prev && prev.heading != null && yawDiff(heading, prev.heading) < RUN_ALIGN) {
    runT = (prev.runT ?? 0) + (prev.t ?? 0);
  }
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: roamSpan(rand), runT };
}

// Wall-ride budget exit: leave the wall in the roomiest of 45° or 90°
// away from the travel heading — never straight along it (straight exits
// go through the outer-turn lottery). Null when both headings are boxed
// in under a metre: the caller keeps riding and retries later.
// The wall sits toward axis−rel·π/2 (rel = +1 wall left of travel), so
// away is the +rel side. Ties keep the 45° (first max wins).
export function wallQuitHeading(mob, supported, floating) {
  const axis = mob.lane ? mob.lane.axis : snapCardinal(mob.yaw);
  const away = mob.followLine?.rel ?? 1;
  const cands = [normYaw(axis + away * Math.PI / 4), normYaw(axis + away * Math.PI / 2)];
  let best = null, bestD = 1.0;
  for (const h of cands) {
    const dx = Math.sin(h), dz = Math.cos(h);
    const blockedAt = (x, z) => !bodyFits(mob, supported, floating, h, x, z);
    const d = rayDist(mob.pos.x, mob.pos.z, dx, dz, blockedAt, 6.0, 0.1);
    if (d > bestD) { best = h; bestD = d; }
  }
  return best;
}

// Commit the budget exit to roam: drop lane + line, hold the next latch
// off, and install an open commit on the heading (same shape as decide).
export function wallQuitCommit(mob, heading, rand = Math.random, pickTarget) {
  const target = strideTarget(mob, heading, rand) ?? (pickTarget ? pickTarget(mob, rand) : null);
  if (!target) return false;
  mob.lane = null; mob.followLine = null; mob.turnHold = 0;
  mob.followCool = FOLLOW_COOL; mob.stuckT = 0; mob.servoStall = 0;
  latchCommit(mob, heading, target, rand, mob.roam);
  return true;
}

function decide(mob, dt, supported, floating, rand = Math.random, pickTarget, blocked = null) {
  const prev = mob.roam;
  mob.roam = null;
  const yaw = snapCardinal(mob.yaw);
  // Peer-aware winds (optional): veto headings whose ray runs into another
  // body, so the commit routes around the scrum instead of aiming through
  // it. Sampled every metre out to the stride range with the comfort
  // margin — passing near peers stays legal, only blocked winds are
  // vetoed. Pure reads, no rand draws: null keeps solo replays
  // bit-identical.
  const blockedDir = blocked ? (h) => {
    for (const d of [1.0, 2.0, 3.0]) {
      if (blocked(mob.pos.x + Math.sin(h) * d, mob.pos.z + Math.cos(h) * d)) return true;
    }
    return false;
  } : null;
  // Open commit: current raw heading first (continuity bias, oblique
  // included), then the shuffled 8-wind — first with 3+ blocks free wins.
  // Walls never latch here: contact alone (frontal or flank graze) enters
  // wall-following through the servo, so open roam stays open.
  // Past the run budget the commit turns for real (near-prev winds excluded)
  // instead of chaining straight.
  // Cooled-mouth veto (only while a per-mouth cooldown runs, so idle streams
  // stay bit-identical): winds and targets running back into the mouth just
  // left are skipped — the mob waits the cooldown out instead of ping-ponging
  // straight back in (plain roam would otherwise bypass the entry-draw gate).
  // Gated on being outside the mouth geometry: the way out always crosses the
  // mouth center, so vetoing from inside would trap the exit walk itself.
  const cooled = (mob.entryCoolT ?? 0) > 0 && mob.entryCoolKey != null &&
    !insideCooledMouth(makeCellFree(mob), makeCellSolid(mob), mob.dim ?? "over",
      Math.floor(mob.pos.x), Math.floor(mob.pos.z), mob.entryCoolKey);
  const vetoDir = cooled ? (h) => mobHeadsToCooledMouth(
    mob, mob.pos.x + Math.sin(h) * 2.5, mob.pos.z + Math.cos(h) * 2.5) : null;
  const dirGate = (blockedDir || vetoDir) ? (h) =>
    (blockedDir ? blockedDir(h) : false) || (vetoDir ? vetoDir(h) : false) : blockedDir;
  const cands = [mob.yaw, ...shuffled(
    WINDS8.filter((dd) => yawDiff(dd, mob.yaw) > 1e-6), rand)];
  const heading = openHeading(mob, supported, floating, cands, rand, dirGate);
  if (heading == null) return;
  if (prev?.heading != null && yawDiff(heading, prev.heading) < RUN_ALIGN &&
      (prev.runT ?? 0) + (prev.t ?? 0) >= RUN_MAX) {
    const turned = openHeading(mob, supported, floating, shuffled(
      WINDS8.filter((dd) => yawDiff(dd, prev.heading) > RUN_ALIGN), rand), rand, dirGate);
    if (turned != null) {
      const turnTarget = strideTarget(mob, turned, rand) ?? pickTarget(mob, rand);
      if (turnTarget) {
        if (cooled && mobHeadsToCooledMouth(mob, turnTarget.x, turnTarget.z)) return;
        latchCommit(mob, turned, turnTarget, rand); return;
      }
    }
  }
  const target = strideTarget(mob, heading, rand) ?? pickTarget(mob, rand);
  if (!target) return;
  if (cooled && mobHeadsToCooledMouth(mob, target.x, target.z)) return;
  latchCommit(mob, heading, target, rand, prev);
}
