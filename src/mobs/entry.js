// Mouth-entry attraction: proximity detection, the unified mouth exit
// behind 1-wide arrivals, and the 2-wide crossing state (passageTick: cross
// while the mouth holds, draw the exit at the first hold tick). Three-free: the
// mover injects nothing but the mob (cell reads go through step.js) and the
// ambient rand. One rule for
// every state: an attracted mob quits everything — open roam commit, wall
// ride, wander pick — and walks a plain roam commit to the mouth; a touch
// ride quits for any mouth ahead of it (a corridor genuinely continuing
// takes over). A lane already cruising a true corridor keeps
// it (mid-corridor cells never match findEntries' open-approach clause,
// and re-drawing each tick would ping-pong the mob back onto its own
// mouth). Scans throttle at ENTRY_SCAN_T sim-time: the throttled draw,
// not the 1/60 sub-slice, sets the pace — V speed scales the sim clock,
// never the scan rate.
//
// Entry commits are ordinary roam commits with `entry: true`, the hole
// travel `axis`, and the claimed `passageKey`. Accepting onto a touch ride
// never drops its line: the commit stays pending under the ride (blue held,
// yaw locked — no pivot toward the mouth) and the servo erects the guided
// hole-ward touch once the nose meets the wall (tryGuidedErect). A straight
// lanelless push that wedges past ENTRY_STALL_T touches the blocking wall
// and follows it toward the hole with the existing ride machinery (forced
// hole-ward, no new draw); when no wall is latchable at all it detours via
// the mouth's approach cell (same commit, still violet — a frontal push
// from the approach clips no corner); only a wedged detour gives up (the
// commit closes with a re-draw cooldown).
// The servo takes over naturally when the mob turns tunneled, and a wall
// touched on the way still latches through the usual contact path once
// the commit lands. While one runs, no new draw happens; arrival or span
// timeout closes it outright, and a refused draw simply retries at the
// next scan — no cooldown anywhere, a mob that targets the hole draws
// every scan until it can go. Only facing, reachable mouths draw (see
// entryTick). 1-wide targets
// centre the middle; 2-wide targets take the nearest of left cell, right
// cell, passage middle (ties fall to the middle), so the walk always aims
// at the shortest slot. One mob decides per passage at a time: the latch reserves
// its mouth (or pair), and rivals take the nearest free one or wait for
// the release (arrival/timeout frees at once; handover, death and wipes
// free lazily — a claim only holds while its mob stays alive and passing;
// a mouth already underfoot never re-triggers). A mob already walking
// head-on at a 2-wide with no commit is captured outright (captureTwoWide,
// deterministic backstop after a refused or empty violet scan): the passage
// opens with no approach walk.
import { ENTRY_P, ENTRY_SCAN_T, ENTRY_TIMEOUT, ENTRY_COOL_T, CARDINALS, findEntries, dirVec, snapCardinal, isTwoWideMouth, mouthPairCells, mouthKey, mouthCellKey } from "./corridor.js";
import { makeCellFree, makeCellSolid, dropLane, NO_EXPIRY, segmentWalkable } from "./step.js";
import { roamSpan, ARRIVE_D, SPAN_MAX, exitMouth } from "./roam.js";

// Deciding mob per passage (mouth cell, or cell pair for 2-wide),
// dimension-scoped: block keys collide across dimensions.
const passageClaims = new Map();
function passageKey(dim, e) {
  if (e.kind === "two") return mouthCellKey(dim, 2, e.bx, e.bz, e.qx, e.qz);
  return mouthCellKey(dim, 1, e.bx, e.bz);
}
function passageFree(key, mob) {
  const holder = passageClaims.get(key);
  if (!holder || holder === mob) return true;
  if (!holder.alive) return true;
  // A live capture holds its mouth the same way an in-flight violet does
  // (captures run commit-less, so neither of the lines below reads them).
  if (holder.passage?.key === key) return false;
  return holder.roam?.entry !== true && holder.followLine?.claimKey !== key;
}
// Wipe every claim (new world / dimension wipe): the lazy liveness check
// already frees the dead, this drops the keys outright.
export function clearEntryClaims() {
  passageClaims.clear();
}
function releasePassage(mob) {
  for (const [k, holder] of passageClaims) {
    if (holder === mob) passageClaims.delete(k);
  }
}

// Violet-less capture: a mob walking head-on at a 2-wide with no entry
// commit (refused draws, wander line straight through) gets the 2-wide
// rules anyway — the crossing passage opens outright (no approach walk:
// it is already there) and passageTick hold-draws the exit, tints the
// thread and closes with cooldown. Deterministic, no draw: every
// qualifying mob, every scan. Only head-on walkers inside CAPTURE_R with a
// walkable segment to the mouth middle (facing dot past CAPTURE_COS —
// parallel passers-by never trigger). Respects the same-mouth cooldown
// and live claims (a rival's mouth stays theirs); lanes stay servo-owned.
// Returns true on capture (the tick stands down like an entry hold), false
// otherwise.
export const CAPTURE_R = 1.5;
export const CAPTURE_COS = 0.9;
function captureTwoWide(mob) {
  if (mob.lane || mob.passage) return false;
  const axis = snapCardinal(mob.yaw);
  const cellFree = makeCellFree(mob), cellSolid = makeCellSolid(mob);
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  const mcx = Math.floor(mob.pos.x), mcz = Math.floor(mob.pos.z);
  const [ax, az] = dirVec(axis);
  // Mouth underfoot or one cell ahead along the facing.
  for (const [cx, cz] of [[mcx, mcz], [mcx + ax, mcz + az]]) {
    const key = mouthKey(mob.dim ?? "over", cx, cz, axis, 2, cellFree, cellSolid);
    if (key == null) continue;
    const pair = mouthPairCells(cx, cz, axis, cellFree, cellSolid);
    const mx = (pair[0].x + pair[1].x) / 2 + 0.5, mz = (pair[0].z + pair[1].z) / 2 + 0.5;
    const dx = mx - mob.pos.x, dz = mz - mob.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > CAPTURE_R + 1e-9) continue;
    if (dist > 1e-9 && (dx * fx + dz * fz) / dist < CAPTURE_COS) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, mx, mz)) continue;
    // Same-mouth cooldown: the threaded mouth re-blocks while its timer
    // runs; any other mouth captures through.
    if ((mob.entryCoolT ?? 0) > 0 && key === mob.entryCoolKey) continue;
    if (!passageFree(key, mob)) continue;
    releasePassage(mob);
    passageClaims.set(key, mob);
    mob.passage = { kind: 2, axis, key, t: 0 };
    return true;
  }
  return false;
}

export function pickEntryTarget(entry, px, pz) {
  if (entry.kind === "one") return { x: entry.x, z: entry.z };
  // Nearest slot wins (ties fall to the middle, which any equidistant
  // point favours geometrically); deterministic, no draw consumed.
  const cands = [
    { x: entry.x, z: entry.z },
    { x: entry.ax, z: entry.az },
    { x: entry.bx2, z: entry.bz2 },
  ];
  let best = cands[0], bd = Infinity;
  for (const c of cands) {
    const d = (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz);
    if (d < bd - 1e-9) { bd = d; best = c; }
  }
  return { x: best.x, z: best.z };
}

// The caller ticks `entryScanT` down every slice; this function only reads
// it. One attraction tick. Returns true while an entry (freshly latched or
// still walking) or a violet-less capture, false otherwise (nothing in
// range, cruising a true lane, same-mouth cooldown, refused draw far from
// any 2-wide, taken passage, or closed commit).
// One draw per scan until accept — no cooldown before the first accept, a
// mob that targets the hole keeps drawing every scan until it can go — so
// same seed, same target. ctx carries the mover's grounded context
// ({supported, floating, pickTarget}) for the arrival/backstop exit.
export function entryTick(mob, dt, rand = Math.random, ctx = {}) {
  const r = mob.roam;
  if (r?.entry) {
    // While a guided stall slide rides, roamStep never runs (the servo
    // owns those ticks) — tick the commit clock here so arrival/backstop
    // still close the commit. Lane-less walks tick it in roamStep.
    if (mob.lane) r.t = (r.t ?? 0) + dt;
    const arrived = mob.target &&
      Math.hypot(r.target.x - mob.pos.x, r.target.z - mob.pos.z) < ARRIVE_D;
    // No span timeout into a backward decide: a commit walks until it
    // arrives (turning hole-ward, riding the wall on collisions, or
    // detouring via the approach cell when no wall is latchable). Only a
    // sealed hole (player edit mid-walk) ever reaches the backstop, which
    // exits forward — never back inside.
    const overdue = (r.t ?? 0) > ENTRY_TIMEOUT;
    // Give-up: the detour itself wedged — the commit is unworkable. Close
    // it with a re-draw cooldown so the mob walks on instead of grinding;
    // a later scan retries from a better spot. Arrival always wins over a
    // pending give-up (the hole got threaded anyway).
    if (!arrived && r.giveUp) {
      mob.roam = null;
      releasePassage(mob);
      const gl0 = mob.followLine;
      if (gl0 && gl0.guideKey) {
        gl0.guideKey = null; gl0.guideTx = null; gl0.guideTz = null;
      }
      mob.entryCoolT = ENTRY_COOL_T;
      if (r.passageKey != null) mob.entryCoolKey = r.passageKey;
      return false;
    }
    if (!arrived && !overdue) return true;
    const exitAxis = snapCardinal(r.axis ?? r.heading ?? mob.yaw);
    const kind = r.passageKind ?? 1;
    mob.roam = null;
    releasePassage(mob);
    // Passage record: only 2-wide arrivals open a crossing state (passageTick
    // maintains it while the mouth holds); 1-wide arrivals thread straight
    // into the rail through the exit below. A sealed-hole timeout arms
    // nothing: nothing gets threaded.
    if (arrived && kind === 2) {
      mob.passage = { kind, axis: exitAxis, key: r.passageKey ?? null, t: 0 };
    }
    // The guided ride (if any) goes plain: the hole is reached or given
    // up — steering unbiased from here on.
    const gl = mob.followLine;
    if (gl && gl.guideKey) {
      gl.guideKey = null; gl.guideTx = null; gl.guideTz = null;
    }
    // Arrival walks out: a 1-wide threads into the rail through the unified
    // mouth exit (wall-follow arms vs free roam); a 2-wide opens a crossing
    // commit toward the visible end (the inside draw owns the wall decision
    // while walls stand lateral). Short strides so 1-wide fits through the
    // mouth into small pens as well as open field.
    if (!arrived) {
      mob.entryCoolT = ENTRY_COOL_T;
      if (r.passageKey != null) mob.entryCoolKey = r.passageKey;
    }
    if (arrived && r.axis != null) {
      // Thread first for 2-wide (crossing commit toward the visible end —
      // the inside draw owns the wall decision while walls stand lateral);
      // a 1-wide and a degenerate 2-wide (nothing walks past the mouth)
      // thread straight into the rail through the unified exit. One draw,
      // one keying: the exit arms the timer and the key names the exact
      // mouth — a live crossing keys nothing, its leave will.
      if (kind !== 2 || !installCrossing(mob, exitAxis, rand)) {
        exitMouth(mob, exitAxis, dt, ctx.supported ?? true, ctx.floating ?? false, rand, ctx.pickTarget, null, { kind });
        if (r.passageKey != null) mob.entryCoolKey = r.passageKey;
      }
    }
    return false;
  }
  // A true corridor lane (non-touch) never re-draws: the mob is already
  // inside, and its own mouth behind stays in range for the whole walk.
  if (mob.lane && mob.followLine?.touch !== true) return false;
  // Post-threading cooldown is per mouth (entryCoolKey): a mob that just
  // threaded one walks away instead of instantly re-drawing it, while
  // neighbours stay drawable — the per-candidate gate below owns it, so no
  // global gate here.
  // Throttled area scan: the mover ticks this every 1/60 slice (dozens of
  // slices per frame at high V speed), but mouths barely move — one scan
  // per ENTRY_SCAN_T, draws excluded. The timer ticks down in the mover.
  if ((mob.entryScanT ?? 0) > 0) return false;
  mob.entryScanT = ENTRY_SCAN_T;
  // A touch ride owns its wall only behind the facing: a riding mob turns
  // into any hole ahead of it — nose-meets-wall reads head-on to the ride
  // axis, otherwise head-on to the facing is enough (the facing filter
  // below re-checks it for every pick). Mouths preempt
  // unconditionally (a corridor genuinely continuing takes over).
  // Wanderers and roam commits take both.
  const found = findEntries(mob.pos.x, mob.pos.z, makeCellFree(mob), makeCellSolid(mob));
  if (found.length === 0) return false;
  // Head-on only: a mouth behind the facing is never drawn — this is what
  // lets a mob walk out of a mouth instead of instantly turning back in
  // (plus the post-threading cooldown above): a mob still facing its hole
  // redraws every scan until it gets there.
  const fx = Math.sin(mob.yaw), fz = Math.cos(mob.yaw);
  const facing = found.filter((e) => (e.x - mob.pos.x) * fx + (e.z - mob.pos.z) * fz > 0);
  if (facing.length === 0) return false;
  // One deciding mob per passage: take the nearest free mouth (or pair),
  // else wait for a release — no draw, the next scan retries. Mouths
  // already underfoot never re-trigger, so an arrival never ping-pongs.
  // Reachability: the mouth must read reachable from the mob's side —
  // the aimed slot or the approach cell ahead of it (on the mob's travel
  // side, after the thin-hole axis flip-through) has to be straight-walkable.
  // A mouth across an uncrossable wall (pen fence between the mob and a
  // far-side slot) never draws, so mobs never grind violet against a
  // barrier they cannot thread — while a commit that only clips a jamb on
  // its final stretch still draws (the stall slide owns that last metre).
  // Blocked candidates simply fall through to the next facing one with no
  // draw consumed.
  const dim = mob.dim ?? "over";
  let pick = null, pickKey = null, target = null, sax = 0, saz = 1;
  for (const e of facing) {
    if (e.dist <= ARRIVE_D + 1e-9) continue;
    const key = passageKey(dim, e);
    // Same-mouth cooldown: the threaded mouth re-blocks while its timer
    // runs; any other mouth draws through. The held mouth (if any) never
    // re-draws either — the mob is already inside it.
    if ((mob.entryCoolT ?? 0) > 0 && key === mob.entryCoolKey) continue;
    if (key === mob.passage?.key) continue;
    if (!passageFree(key, mob)) continue;
    const slot = pickEntryTarget(e, mob.pos.x, mob.pos.z);
    // Oriented travel axis: corridor-ward, flipped through when the mob
    // stands past the mouth (thin holes match both ways — the discovery
    // order must never send the arrival back toward the mob's side). The
    // same axis below steers the commit and picks the mob-side approach.
    const [fax, faz] = dirVec(e.axis);
    let ax = fax, az = faz;
    if ((mob.pos.x - slot.x) * fax + (mob.pos.z - slot.z) * faz > 0) {
      ax = -fax; az = -faz;
    }
    const near = segmentWalkable(mob, mob.pos.x, mob.pos.z, slot.x, slot.z) ||
      segmentWalkable(mob, mob.pos.x, mob.pos.z, e.x - ax, e.z - az);
    if (!near) continue;
    pick = e; pickKey = key; target = slot; sax = ax; saz = az;
    break;
  }
  if (!pick) return captureTwoWide(mob);
  if (rand() >= ENTRY_P) {
    // Refused draw: the violet walk waits for the next scan, but a mob
    // already on top of a 2-wide is captured outright (see above).
    return captureTwoWide(mob);
  }
  releasePassage(mob);
  passageClaims.set(pickKey, mob);
  if (mob.followLine?.touch === true) {
    // Pending guided slide: keep the line (no drop, no free pivot toward
    // the mouth) — the servo erects the hole-ward touch once the nose
    // meets the wall (tryGuidedErect). The commit clock still runs under
    // the ride, and arrival closes it outright.
    mob.followLine.guideKey = pickKey;
    mob.followLine.guideTx = target.x;
    mob.followLine.guideTz = target.z;
  } else {
    dropLane(mob);
    mob.followLine = null;
  }
  mob.turnHold = 0;
  mob.servoStall = 0;
  mob.stuckT = 0;
  const heading = Math.atan2(target.x - mob.pos.x, target.z - mob.pos.z);
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = {
    mode: "commit", heading, target, tgt: target,
    axis: Math.atan2(sax, saz), stallT: 0, passageKey: pickKey,
    passageKind: pick.kind === "two" ? 2 : 1,
    t: 0, span: roamSpan(rand), runT: 0, entry: true,
  };
  return true;
}

// Crossing stride toward the visible end of a 2-wide: the farthest point
// along the passage axis (up to 6 m) whose whole segment walks —
// destination rules plus the segment, like strideTarget, but continuous
// (cell-snapped short targets can land inside arrival range and stall the
// crossing: arrival is positional, so the mob would decide on the spot).
// Same commit shape as any roam stride. False when nothing beyond arrival
// range walks (caller leaves through the exit table).
function installCrossing(mob, axis, rand) {
  const dx = Math.sin(axis), dz = Math.cos(axis);
  for (let d = 6.0; d >= 1.0; d -= 0.5) {
    const x = mob.pos.x + dx * d, z = mob.pos.z + dz * d;
    if (Math.hypot(x - mob.pos.x, z - mob.pos.z) <= ARRIVE_D) continue;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, x, z)) continue;
    const t = { x, z };
    mob.target = t;
    mob.wanderT = NO_EXPIRY;
    mob.roam = {
      mode: "commit", heading: axis, target: t, tgt: t,
      t: 0, span: roamSpan(rand), runT: 0,
    };
    mob.stuckT = 0;
    return true;
  }
  return false;
}

// Single close behind every 2-wide passage end (timeout, nose-blocked
// inside, leave): release the claim, arm the per-mouth cooldown keyed on
// the exact mouth.
function closePassage(mob, p) {
  mob.passage = null;
  releasePassage(mob);
  mob.entryCoolT = ENTRY_COOL_T;
  if (p.key != null) mob.entryCoolKey = p.key;
}

// Systematic crossing note: geometry-only 2-wide detection, independent of
// any violet commit. A mob standing in live 2-wide geometry with no passage
// opens one outright (no approach walk, no draw — it is already inside), so
// every threading reads orange and closes with cooldown at the leave, even
// lane owners (the servo keeps the lane, only the lifecycle is noted) and
// oblique walkers the head-on capture misses. Lifecycle-only: the mob keeps
// its own line (never hijacked onto a crossing commit), the note only owns
// the orange flag and the leave cooldown. Skips live claims entirely (no set,
// no check — threading mobs never steal a violet draw) but respects the
// same-mouth cooldown; entry commits own their own lifecycle and skip this.
// Deterministic, no rand stream.
// Returns true on open, false otherwise.
export function noteCrossing(mob) {
  if (mob.passage != null || mob.roam?.entry === true) return false;
  const cellFree = makeCellFree(mob), cellSolid = makeCellSolid(mob);
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const dim = mob.dim ?? "over";
  const yawAxis = snapCardinal(mob.lane?.axis ?? mob.yaw);
  const axes = [yawAxis, ...CARDINALS.filter((a) => a !== yawAxis)];
  for (const axis of axes) {
    const pair = mouthPairCells(cx, cz, axis, cellFree, cellSolid);
    if (!pair) continue;
    const key = mouthCellKey(dim, 2, pair[0].x, pair[0].z, pair[1].x, pair[1].z);
    // Same-mouth cooldown: the threaded mouth re-blocks while its timer
    // runs (lets the vetoed mob walk out without re-threading orange);
    // any other mouth opens through.
    if ((mob.entryCoolT ?? 0) > 0 && key === mob.entryCoolKey) continue;
    mob.passage = { kind: 2, axis, key, t: 0, held: true, systematic: true };
    return true;
  }
  return false;
}

// Passage lifecycle for a 2-wide arrival: while the mouth holds the mob is
// inside — keep a forward crossing commit (never decide backward, never
// re-draw: no mouth matches in here and the facing filter covers the mouth
// behind). The first tick inside draws the unified exit (walls stand
// lateral here — the only spot a wall arm can latch): no lane, ride the
// drawn arm out or cross straight on; a lane already held keeps riding
// (never yanked by a draw). The thread paints orange over any ride until
// the leave. Once the mouth held and breaks the mob leaves: close plus
// cooldown, no draw (a walk that finished without ever holding is
// degenerate and leaves through the table at once). A sealed hole (player
// edit mid-crossing) times out the same way, with cooldown and no draw.
// Every close arms the cooldown, so a walk-out never re-draws the mouth
// behind. Runs in the mover tick right after entryTick.
export function passageTick(mob, dt, supported, floating, rand = Math.random, pickTarget) {
  // Systematic note first: any threading without a passage (lane owners,
  // oblique walkers, capture misses) opens one — cooldown-gated, so a mob
  // walking out of its just-left mouth never re-threads orange.
  if (mob.passage == null && mob.roam?.entry !== true) noteCrossing(mob);
  const p = mob.passage;
  if (p == null || p.kind !== 2 || mob.roam?.entry === true) return;
  p.t = (p.t ?? 0) + dt;
  if (p.t > ENTRY_TIMEOUT) {
    closePassage(mob, p);
    return;
  }
  const axis = snapCardinal(p.axis);
  const mouth = isTwoWideMouth(Math.floor(mob.pos.x), Math.floor(mob.pos.z), axis, makeCellFree(mob), makeCellSolid(mob));
  const r = mob.roam;
  const broken = r && r.mode && mob.target !== r.tgt;
  const arrivedC = r && r.mode === "commit" && mob.target &&
    Math.hypot(r.target.x - mob.pos.x, r.target.z - mob.pos.z) < ARRIVE_D;
  const expired = r && r.mode && mob.wanderT <= 0;
  const timedOut = r && r.mode && (r.t ?? 0) > (r.span ?? SPAN_MAX);
  const needsCommit = !r || !r.mode || broken || arrivedC || expired || timedOut || !mob.target;
  if (!mouth) {
    // Outside the 2-wide: leave once held (walked through it) — close plus
    // cooldown, no draw — or at once through the table when the crossing
    // walk finished without ever holding (degenerate mouth); otherwise keep
    // walking in on the current commit. Lane owners keep their ride (never
    // yanked by a draw).
    if (p.held || needsCommit) {
      if (!p.held) {
        exitMouth(mob, axis, dt, supported, floating, rand, pickTarget, null, { kind: 2 });
      }
      closePassage(mob, p);
    }
    return;
  }
  if (!p.held) {
    p.held = true;
    // First tick inside: walls stand lateral by construction (the range test
    // would miss a centered body), so the draw runs close unconditionally.
    // Lane owners keep their ride (never yanked by a draw). The thread
    // paints orange over any ride until the leave.
    if (!mob.lane) {
      exitMouth(mob, axis, dt, supported, floating, rand, pickTarget, null, { kind: 2, noSlide: true });
    }
    return;
  }
  if (mob.lane) return;
  // Systematic notes never steer: the mob threads on its own line (a room
  // interior matching the predicate must not hijack the wanderer onto a
  // crossing commit) — the note only owns orange + the leave cooldown.
  if (p.systematic === true) return;
  if (needsCommit && !installCrossing(mob, axis, rand)) {
    // Nothing beyond arrival range walks (the end wall is at the nose):
    // close plus cooldown, no draw. The nose-blocked walk still latches
    // frontally through the natural contact path when it refuses nothing.
    closePassage(mob, p);
  }
}
