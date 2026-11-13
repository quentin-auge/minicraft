// Carried-mob state (grab → hold → release), three-free: no THREE, no store,
// no mob-system imports except the dependency-free type registry.
import { mobType } from "./registry.js";
// The holder (hook/main) positions bodies through
// duck-typed {pos.set, vel.set, root.rotation} and passes an isSolidAt
// predicate for placement, so this module stays headless-testable. Per-mob
// motion resets are generic field clears shared by every mover (farm servo,
// enderman, future kinds); water/fish rules arrive as a later specialization.
export const CARRY_DIST = 1.2;
export const CARRY_DOWN = 0.4;

let held = null;

export function heldMob() {
  return held;
}

// Central freeze check: every mob tick loop (present and future kinds)
// skips mobs while the grab hook owns their frame.
export function isCarried(mob) {
  return !!mob?._carried;
}

// Hull-pin vs grab-hold arbitration: a carried mob is hook-owned — it
// never boards a vehicle hull, and a rider that gets grabbed is released
// to the hold pose instead of staying pinned. Both directions of the
// vehicle rider loop go through this one predicate.
export function staysHullPinned(mob) {
  return mob?._riding === true && !isCarried(mob);
}

export function holdMob(mob) {
  if (held && held !== mob) held._carried = false;
  held = mob;
  if (mob) mob._carried = true;
  return mob;
}

// Latch: the grab head just reached a live body — freeze the movers from
// here on (the head tracked it live until now), without claiming the hand.
// Separate from holdMob so firing never freezes: a falling mob keeps
// falling while the head flies, and only stops at the latch.
export function latchMob(mob) {
  if (!mob) return null;
  mob._carried = true;
  if (mob.vel?.set) mob.vel.set(0, 0, 0);
  return mob;
}

// Silent teardown for teleports (travel, New World, respawn): the mob stays
// where the hold pose left it with motion cleared, and the movers take over
// (gravity lands it). Never a drop, never a fling.
export function severCarry() {
  if (!held) return;
  resetMobMotion(held);
  held._carried = false;
  held = null;
}

// Feet position of a held mob: in front of the eye, below the sight line.
export function holdFeet(eye, dir, h) {
  return {
    x: eye.x + dir.x * CARRY_DIST,
    y: eye.y + dir.y * CARRY_DIST - CARRY_DOWN - h / 2,
    z: eye.z + dir.z * CARRY_DIST,
  };
}

// Per-frame hold: pin the body to the hold pose, face away, freeze motion.
export function tickHeld(eye, dir, yaw) {
  if (!held) return;
  const f = holdFeet(eye, dir, held.h ?? 1);
  held.pos.set(f.x, f.y, f.z);
  if (held.root) held.root.rotation.y = yaw + Math.PI;
  if (held.vel?.set) held.vel.set(0, 0, 0);
}

// Generic motion reset shared by every release path: velocity, steering, and
// stale servo/lane state, so a freed mob never resumes a frozen commit.
export function resetMobMotion(mob) {
  if (mob.vel?.set) mob.vel.set(0, 0, 0);
  mob.target = null;
  mob.path = null;
  mob.pathKey = null;
  mob.blockedT = 0;
  mob.wanderT = 2 + Math.random() * 3;
  mob.lane = null;
  mob._narrow = null;
  mob._passT = 0; mob._passPeer = null; mob._passPreT = 0; mob._passPrePeer = null;
  mob._passSide = 0; mob._lineOff = 0; mob._passSettle = 0; mob.noseTurn = null;
  mob.passage = null;
  mob.inPassage = false;
  mob.oneWide = false;
  mob.tunnelPass = false;
  mob.wallFollow = false;
  mob.blendFrom = null;
  mob.blendT = 0;
  mob.entryScanT = 0;
  mob.roam = null;
}

// Release entry: the same reset, plus unfreezing the movers, plus the
// type's own release hook when it declares one. With a release yaw the mob
// keeps facing the release direction and walks that way (target 6 m ahead,
// validated like any wander stride — unreachable falls back to a re-pick).
export function settleReleased(mob, releaseYaw = null) {
  resetMobMotion(mob);
  mob._carried = false;
  if (releaseYaw != null) {
    mob.yaw = releaseYaw;
    mob.target = {
      x: mob.pos.x + Math.sin(releaseYaw) * 6,
      z: mob.pos.z + Math.cos(releaseYaw) * 6,
    };
  }
  mobType(mob.type)?.release?.(mob);
}

// Abort-protection rule: ENTER-up aborts hook flights (a flying grab frees
// the mob, a flying/ferrying release re-holds it) but never a latched grab
// haul — the haul to the hand always completes, so a quick ENTER tap still
// grabs. Covered by carry.test.mjs.
export function grabHaulProtected(kind, flying) {
  return kind === "mob" && !flying;
}

// Body-box overlap against an injected solidity predicate (x, y, z) => bool.
export function boxFree(isSolidAt, x, feetY, z, hw, h) {
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
  const y0 = Math.floor(feetY), y1 = Math.floor(feetY + h - 1e-4);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= x - hw || bx >= x + hw) continue;
        if (bz + 1 <= z - hw || bz >= z + hw) continue;
        if (by + 1 <= feetY || by >= feetY + h) continue;
        if (isSolidAt(bx, by, bz)) return false;
      }
  return true;
}

// Shared block-landing rule (player grapple and mob release alike): short
// stacks ride up onto the anchor top, taller faces land in the free cell
// before the hit, feet at its bottom. headOff shifts the rope anchor only,
// never the landing. Pure, three-free, isSolidAt injected.
export function resolveBlockLanding(isSolidAt, bx, by, bz, face, headOff = 0) {
  const fx = face?.[0] ?? 0, fy = face?.[1] ?? 1, fz = face?.[2] ?? 0;
  let q = 0;
  while (isSolidAt(bx, by + q + 1, bz)) q++;
  const topLand = q <= 1;
  if (topLand) {
    const topY = by + q;
    return {
      topLand, topY,
      tx: bx + 0.5, ty: topY + 1.001, tz: bz + 0.5,
      ax: bx + 0.5, ay: topY + 1 + headOff, az: bz + 0.5,
    };
  }
  return {
    topLand, topY: by,
    tx: bx + fx + 0.5, ty: by + fy + 0.001, tz: bz + fz + 0.5,
    ax: bx + 0.5 + fx * (0.5 + headOff),
    ay: by + 0.5 + fy * (0.5 + headOff),
    az: bz + 0.5 + fz * (0.5 + headOff),
  };
}

// Mob arrival gaps, mirroring the player applyArriveGap policy with a body
// instead of an eye: side faces back off along the outward normal, bottom
// faces dangle to a fixed cube-to-top clearance, tops snap exact — applied
// only when the shifted spot fits, else the exact stop is kept.
export function applyMobGap(isSolidAt, hw, h, land, face, arriveGap, hangClear) {
  const free = (x, y, z) => boxFree(isSolidAt, x, y, z, hw, h);
  if (land.topLand) return { x: land.tx, y: land.ty, z: land.tz };
  if (face[1] === -1) {
    const oy = land.ay - h - hangClear;
    if (free(land.tx, oy, land.tz)) return { x: land.tx, y: oy, z: land.tz };
    return { x: land.tx, y: land.ty, z: land.tz };
  }
  const ox = land.tx + face[0] * arriveGap;
  const oy = land.ty + face[1] * arriveGap;
  const oz = land.tz + face[2] * arriveGap;
  if (free(ox, oy, oz)) return { x: ox, y: oy, z: oz };
  return { x: land.tx, y: land.ty, z: land.tz };
}

// Release spot rule: the aimed feet cell, else a 2-ring spiral at the same
// level, riding up to +upMax when occupied (mob release passes 0 — never
// above: a blocked landing re-holds instead of manufacturing support
// overhead). Null when nothing fits — the caller keeps holding instead of
// embedding the mob in a wall. peerFree (optional (x, y, z) => bool)
// extends the fit test to live peers, so a release never stacks one body
// onto another: a peer-held spot reads exactly like a walled one.
export function findReleaseSpot(isSolidAt, hw, h, fx, fy, fz, upMax = 8, peerFree = null) {
  const at = (x, y, z) => boxFree(isSolidAt, x, y, z, hw, h) && (!peerFree || peerFree(x, y, z));
  if (at(fx, fy, fz)) return { x: fx, y: fy, z: fz };
  for (let r = 1; r <= 2; r++) {
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        for (let up = 0; up <= upMax; up++) {
          if (at(fx + dx, fy + up, fz + dz)) return { x: fx + dx, y: fy + up, z: fz + dz };
        }
      }
  }
  return null;
}

// Grapple-equivalent release resolution (player grapple and mob release
// alike): the shared-landing rule, then the arrival gaps when they fit, then
// the same-level ring only — never above. Returns `{x, y, z}` feet or null
// (a blocked landing re-holds instead of manufacturing support overhead).
// Pure, three-free, isSolidAt/peerFree injected: the hook ferry and the
// cheat spawn menu resolve through this one function, so a spawned mob lands
// exactly where the grapple would have ferried it. Headless-tested.
export function mobReleaseSpot(isSolidAt, hw, h, bx, by, bz, face, peerFree = null, opts = {}) {
  const { arriveGap = 0.15, hangClear = 0.6, headOff = 0 } = opts;
  const land = resolveBlockLanding(isSolidAt, bx, by, bz, face, headOff);
  const g = applyMobGap(isSolidAt, hw, h, land, face, arriveGap, hangClear);
  const at = (x, y, z) => boxFree(isSolidAt, x, y, z, hw, h) && (!peerFree || peerFree(x, y, z));
  if (at(g.x, g.y, g.z)) return { x: g.x, y: g.y, z: g.z };
  return findReleaseSpot(isSolidAt, hw, h, land.tx, land.ty, land.tz, 0, peerFree);
}

// Peer-occupancy test for a release candidate: true when no live same-dim
// peer's body box (plus a comfort gap) intersects the candidate's box.
// Duck-typed peers ({pos, yaw?, hw, h, alive, dim}), pure, headless-testable.
export function releasePeerFree(peers, mob, x, y, z, gap = 0.1) {
  const hw = mob.hw ?? 0.32, h = mob.h ?? 1;
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if ((o.dim ?? "over") !== (mob.dim ?? "over")) continue;
    const ox = o.pos.x ?? o.x ?? 0, oy = o.pos.y ?? o.y ?? 0, oz = o.pos.z ?? o.z ?? 0;
    const ohw = o.hw ?? 0.32, oh = o.h ?? 1;
    if (Math.abs(ox - x) >= hw + ohw + gap) continue;
    if (Math.abs(oz - z) >= hw + ohw + gap) continue;
    if (oy >= y + h || oy + oh <= y) continue;
    return false;
  }
  return true;
}

// Placement rule: true when the solid 1x1x1 cell [bx,bx+1[×[by,by+1[×[bz,bz+1[
// overlaps a live same-dim body box (simple hw/h AABB, same overlap as the
// player-place guard in edit.js). Dead, other-dim, and carried (hook-owned,
// glued to the eye) mobs never block; bodies without coordinates are
// skipped. Duck-typed mobs, pure, headless-testable — tryPlace wires the
// live registry list through this.
export function cellBlockedByMob(peers, dimName, bx, by, bz) {
  for (const m of peers) {
    if (!m?.alive || m._carried) continue;
    if ((m.dim ?? "over") !== dimName) continue;
    const p = m.pos ?? m;
    const x = p.x, y = p.y, z = p.z;
    if (x == null || y == null || z == null) continue;
    const hw = m.hw ?? 0.32, h = m.h ?? 1;
    if (bx + 1 > x - hw && bx < x + hw &&
        bz + 1 > z - hw && bz < z + hw &&
        by + 1 > y && by < y + h) return true;
  }
  return false;
}

// Landing rule: the live same-dim bodies overlapping the hull's landing
// box (integer cells, inclusive — the swept hull at the landing pose).
// Riders pinned to the hull and hook-carried mobs never block (they ride
// along); dead, other-dim, and coordinate-less bodies are skipped. Same
// AABB test as cellBlockedByMob, generalized from one cell to the whole
// swept box — pure, headless-testable.
// Landing margin rule: the tallest live body under the hull footprint,
// XZ overlap only — bodies below the box still count so the ship can hold
// a half-block safety gap above them. Same filters as landingBlockers
// (riders pinned to the hull and hook-carried mobs never count; dead,
// other-dim, and coordinate-less bodies skipped); a body at/above the box
// top never counts. Returns max(pos.y + h), -Infinity when none — pure,
// headless-testable.
export function tallestBlockerTop(peers, dimName, box) {
  let top = -Infinity;
  for (const m of peers) {
    if (!m?.alive || m._carried || m._riding) continue;
    if ((m.dim ?? "over") !== dimName) continue;
    const p = m.pos ?? m;
    const x = p.x, y = p.y, z = p.z;
    if (x == null || y == null || z == null) continue;
    const hw = m.hw ?? 0.32, h = m.h ?? 1;
    if (x + hw <= box.x0 || x - hw >= box.x1 + 1) continue;
    if (z + hw <= box.z0 || z - hw >= box.z1 + 1) continue;
    if (box.y1 != null && y >= box.y1 + 1) continue;
    const t = y + h;
    if (t > top) top = t;
  }
  return top;
}

export function landingBlockers(peers, dimName, box) {
  const out = [];
  for (const m of peers) {
    if (!m?.alive || m._carried || m._riding) continue;
    if ((m.dim ?? "over") !== dimName) continue;
    const p = m.pos ?? m;
    const x = p.x, y = p.y, z = p.z;
    if (x == null || y == null || z == null) continue;
    const hw = m.hw ?? 0.32, h = m.h ?? 1;
    if (x + hw <= box.x0 || x - hw >= box.x1 + 1) continue;
    if (z + hw <= box.z0 || z - hw >= box.z1 + 1) continue;
    if (y + h <= box.y0 || y >= box.y1 + 1) continue;
    out.push(m);
  }
  return out;
}
