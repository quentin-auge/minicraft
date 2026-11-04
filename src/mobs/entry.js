// Mouth-entry attraction: proximity detection plus the single 50/50 draw
// behind every mouth visit. Three-free: the mover injects nothing but the
// mob (cell reads go through step.js) and the ambient rand. One rule for
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
// a mouth already underfoot never re-triggers).
import { ENTRY_P, ENTRY_SCAN_T, ENTRY_TIMEOUT, ENTRY_COOL_T, findEntries, dirVec, snapCardinal } from "./corridor.js";
import { makeCellFree, dropLane, NO_EXPIRY, segmentWalkable } from "./step.js";
import { roamSpan, ARRIVE_D, exitPassage } from "./roam.js";

// Deciding mob per passage (mouth cell, or cell pair for 2-wide),
// dimension-scoped: block keys collide across dimensions.
const passageClaims = new Map();
function passageKey(dim, e) {
  if (e.kind === "two") {
    const lox = Math.min(e.bx, e.qx), loz = Math.min(e.bz, e.qz);
    const hix = Math.max(e.bx, e.qx), hiz = Math.max(e.bz, e.qz);
    return `${dim}|2:${lox},${loz}|${hix},${hiz}`;
  }
  return `${dim}|1:${e.bx},${e.bz}`;
}
function passageFree(key, mob) {
  const holder = passageClaims.get(key);
  if (!holder || holder === mob) return true;
  if (!holder.alive) return true;
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
// still walking), false otherwise (nothing in range, cruising a true lane,
// post-threading cooldown, refused draw, taken passage, or closed commit).
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
      return false;
    }
    if (!arrived && !overdue) return true;
    const exitAxis = snapCardinal(r.axis ?? r.heading ?? mob.yaw);
    const hx = r.target?.x, hz = r.target?.z;
    mob.roam = null;
    releasePassage(mob);
    // Violet hold: the arrival closes the commit up to 0.6 short of the
    // aimed slot, so arm a position hold on the slot itself — the tint
    // persists while the mob threads out of the mouth (a sealed-hole
    // timeout arms nothing: nothing gets threaded).
    if (arrived && hx != null && hz != null) {
      mob.tunnelHoldX = hx; mob.tunnelHoldZ = hz;
    }
    // The guided ride (if any) goes plain: the hole is reached or given
    // up — steering unbiased from here on.
    const gl = mob.followLine;
    if (gl && gl.guideKey) {
      gl.guideKey = null; gl.guideTx = null; gl.guideTz = null;
    }
    // Arrival walks out through the exit rule (contact 50/50 wall-follow
    // vs free roam, else free roam) instead of an always-straight stride,
    // so a 2-wide exits with the same probabilities as a rail release. A
    // timeout simply closes with a re-draw cooldown (no instant re-accept
    // loop on the same wedge). Short strides
    // so it fits through the mouth into small pens as well as open field.
    if (!arrived) mob.entryCoolT = ENTRY_COOL_T;
    if (arrived && r.axis != null) {
      exitPassage(mob, exitAxis, dt, ctx.supported ?? true, ctx.floating ?? false, rand, ctx.pickTarget);
    }
    return false;
  }
  // A true corridor lane (non-touch) never re-draws: the mob is already
  // inside, and its own mouth behind stays in range for the whole walk.
  if (mob.lane && mob.followLine?.touch !== true) return false;
  // Post-threading cooldown: a mob that just threaded a mouth walks away
  // instead of instantly re-drawing it (or its neighbour) for ENTRY_COOL_T.
  if ((mob.entryCoolT ?? 0) > 0) return false;
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
  const found = findEntries(mob.pos.x, mob.pos.z, makeCellFree(mob));
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
  if (!pick) return false;
  if (rand() >= ENTRY_P) {
    return false;
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
    t: 0, span: roamSpan(rand), runT: 0, entry: true,
  };
  return true;
}
