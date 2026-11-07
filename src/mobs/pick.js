// Mob ray picking, three-free (headless-testable): ray-vs-AABB hit offsets,
// nearest-pick with solid occlusion, no store/THREE imports. Voxel occlusion
// arrives as a plain blockT distance from the caller (edit.js DDA), so this
// module never touches voxels. Positions/directions are plain {x, y, z}.
// Mob contract (duck-typed, no per-kind code — future kinds inherit it):
// {pos, alive} + {hw, h} physics box, optional {grabR, grabH} visual box
// (default hw/h) or axial {grabSide, grabFront, grabBack, yaw} for the
// oriented test (default grabR, yaw 0 = facing +z), grab eligibility via
// the registry `grabbable` flag. dir must be unit (t reads as a distance
// for the distance scale).
export function rayAabbT(eye, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const ax of ["x", "y", "z"]) {
    const d = dir[ax];
    if (Math.abs(d) < 1e-9) {
      if (eye[ax] < min[ax] || eye[ax] > max[ax]) return null;
    } else {
      const t1 = (min[ax] - eye[ax]) / d, t2 = (max[ax] - eye[ax]) / d;
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if (lo > tmin) tmin = lo;
      if (hi < tmax) tmax = hi;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

// Hit offset of the aim ray against a mob body box (feet at mob.pos),
// widened by pad on every side. This is the pick surface, not the hook
// anchor: the grab hook latches the body middle (mobCenterOffset below).
// Oriented test when the mob carries axial extents (grabSide/grabFront/
// grabBack: flanks = torso, front = head): eye and dir rotate into the
// mob's yaw frame, so flanks stay tight while the head still latches
// head-on. Falls back to the yaw-independent grab box (grabR/grabH),
// else the tight physics box. Null on miss.
export function mobHitOffset(eye, dir, mob, pad = 0) {
  const px = mob.pos.x, py = mob.pos.y, pz = mob.pos.z;
  const yaw = mob.yaw ?? 0;
  const side = mob.grabSide ?? mob.grabR ?? mob.hw ?? 0.3;
  const front = mob.grabFront ?? mob.grabR ?? mob.hw ?? 0.3;
  const back = mob.grabBack ?? mob.grabR ?? mob.hw ?? 0.3;
  const h = (mob.grabH ?? mob.h ?? 1) + pad;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ox = eye.x - px, oz = eye.z - pz;
  const t = rayAabbT(
    { x: ox * c - oz * s, y: eye.y, z: ox * s + oz * c },
    { x: dir.x * c - dir.z * s, y: dir.y, z: dir.x * s + dir.z * c },
    { x: -side - pad, y: py - pad, z: -back - pad },
    { x: side + pad, y: py + h, z: front + pad },
  );
  if (t == null || t < 0) return null;
  return {
    x: eye.x + dir.x * t - px,
    y: eye.y + dir.y * t - py,
    z: eye.z + dir.z * t - pz,
    t,
  };
}

// Centered grab anchor: the middle of the grab volume (origin x/z, half
// height), yaw-independent so mid-flight facing changes cannot shift it.
// Prefers the visual grab height (grabH) with physics fallbacks. Pure,
// three-free.
export function mobCenterOffset(mob) {
  return { x: 0, y: (mob.grabH ?? mob.h ?? 1) / 2, z: 0 };
}

// Distance-scaled pick box: exact up close, wider far away, bounded above
// so it never degenerates. Feet-anchored (the y range stays
// [feet, feet + h·s]) — unlike an additive pad it never floats
// the box off the feet nor sinks it. The floor is the exact box (scale
// 1.0): the pick box never shrinks below the mob's own volume. Pure,
// three-free.
export const GRAB_SCALE_RATE = 0.005;
export const GRAB_SCALE_T0 = 10;
export const GRAB_SCALE_MIN = 1.0;
export const GRAB_SCALE_MAX = 5.0;
export function grabScale(t) {
  return Math.min(GRAB_SCALE_MAX, Math.max(GRAB_SCALE_MIN, 1 + GRAB_SCALE_RATE * (t - GRAB_SCALE_T0)));
}

// Occlusion rule (master: a mob further than the first solid surface + 0.5
// reads as behind a wall and never draws the grab).
export function mobBlockedBySolid(mobT, blockT) {
  return mobT > blockT + 0.5;
}

// Nearest grabbable-candidate along the ray. mobs carry {pos, hw, h, alive};
// exclude(m) vetoes (held, wrong dim, ...); padFor(m) widens per mob
// (future: immersed fish tolerance); boxScale(t) rescales the pick box
// with distance (opt-in; exact up close, wider far away, bounded above —
// without it, exact boxes only). blockT is the DDA solid-surface
// distance (Infinity on miss). Returns {mob, offset, t}
// or null.
export function pickMob(mobs, eye, dir, opts = {}) {
  const { maxDist = Infinity, blockT = Infinity, exclude = null, padFor = null, boxScale = null } = opts;
  let best = null, bestT = Infinity, bestOff = null;
  for (const m of mobs) {
    if (!m || m.alive === false) continue;
    if (exclude && exclude(m)) continue;
    const basePad = padFor ? padFor(m) : 0;
    const base = {
      side: m.grabSide ?? m.grabR ?? m.hw ?? 0.3,
      front: m.grabFront ?? m.grabR ?? m.hw ?? 0.3,
      back: m.grabBack ?? m.grabR ?? m.hw ?? 0.3,
      h: m.grabH ?? m.h ?? 1,
    };
    const boxHit = (s) => mobHitOffset(eye, dir, { ...m, grabSide: base.side * s, grabFront: base.front * s, grabBack: base.back * s, grabH: base.h * s }, basePad);
    let off = boxHit(1);
    // Distance-scaled box: exact below the neutral range, grown far away.
    // The max-scale probe yields a t-guess for rays the exact box misses
    // outright.
    if (boxScale) {
      const tGuess = off?.t ?? boxHit(GRAB_SCALE_MAX)?.t;
      if (tGuess != null) off = boxHit(boxScale(tGuess));
    }
    if (!off || off.t > maxDist || off.t >= bestT) continue;
    if (mobBlockedBySolid(off.t, blockT)) continue;
    best = m;
    bestT = off.t;
    bestOff = off;
  }
  return best ? { mob: best, offset: bestOff, t: bestT } : null;
}
