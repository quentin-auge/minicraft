// Shared ballistics (three-free): gravity, terminal clamp, plus the one
// horizontal bleed for every body, player or mob. Without input the fall
// reads vertical; with input the shared steering adds a look-relative
// component. Thrown arcs (grapple fling, mega launch, fly exit) are just
// initial velocities — no arming, no gates. Pure math,
// no scene, so the headless suite covers the rule without the movers.
//
// The one contract: a thrown body is an initial velocity. Ballistic bodies
// (no navigation: flings, launches, blast flights, free falls) step through
// stepAir — one gravity, one terminal, one bleed. Servo bodies (anything
// navigation-driven: mob walk/roam, player swim/ground/fly-thrust) keep
// their own horizontal drive and share only gravity + terminal. Mega range
// reads 1.5R on both branches: the ground arc compensates AIR_DRAG, the
// fly shove calibrates on KNOCK_DECAY.
export const GRAVITY = 37.44;
// Exponential horizontal bleed (1/s): no-input releases glide into the
// vertical over a few seconds instead of drifting on forever. Below
// AIR_SNAP the fall reads vertical and callers snap the axes to zero.
export const AIR_DRAG = 0.45;
export const AIR_SNAP = 1.0;
// Terminal fall speed (m/s): the one shared floor for every fall, player
// or mob — a bottomless void converges both bodies onto the same drop.
export const TERMINAL_VELOCITY = -40;
// Input accel (m/s^2) for the additive air steering below: the input adds
// a velocity component instead of re-aiming the body, so momentum survives
// steering. The single nervousness knob — higher reacts faster everywhere.
// Browser-tunable.
export const AIR_ACCEL = 14;
// Fast-fall cone: below this vertical speed the horizontal total is
// bounded by the fall rate, so long presses hold a light angle instead of
// carving a diagonal. Jumps never get here; voids live here.
export const AIR_FALL_CAP_VY = -20;
// Horizontal:vertical ratio of the cone (~12° from vertical).
export const AIR_FALL_CAP_SLOPE = 0.21;
// Cone ease-in rate (m/s per s): how fast a fast fall reins horizontal
// speed back to the cone — slow, so a held direction keeps its diagonal
// for a while before rejoining the unified vertical fall.
export const AIR_CONE_EASE = 12;
// Upward steering never becomes climbing: braking a fall bottoms out at
// this sink rate — falls stay falls.
export const STEER_MIN_SINK = -6;
// Launch speed clamp (m/s): the far-travel cap keeps wall-adjacent bodies
// inside the world instead of tunneling through it. Doubles as the
// forward-extension ceiling for the steering below.
export const LAUNCH_VMIN = 4;
export const LAUNCH_VMAX = 40;
// Fly-shove decay (1/s): the mega→player impulse in fly mode bleeds at
// this rate instead of AIR_DRAG, so the same 1.5R travel reads as a brief
// violent punch rather than a long drift. Blast code calibrates the shove
// as travel distance x KNOCK_DECAY. Player-only (mobs never carry the
// impulse), kept here so the shove below stays three-free and testable.
export const KNOCK_DECAY = 2.2;
// Fly-shove snap floor (m/s): below this the impulse reads settled and
// callers zero it — the slow tail is cut instead of glided out.
export const KNOCK_SNAP = 7.0;
// Tail fraction of the shove peak: big-pool punches die below this share
// of their own peak, so the cutoff scales with the violence — small pools
// keep the fixed floor above.
export const KNOCK_TAIL_FRAC = 0.12;
export function knockCutoff(peak) {
  return Math.max(KNOCK_SNAP, KNOCK_TAIL_FRAC * peak);
}

// Gravity scale shared by every body: low gravity near the Moon and above
// (no lunar blocks left, no low-g). Takes dimName + feet Y so mobs read the
// same sky as the player — one sky, one gravity.
export function gravityAt(dimHasMoon, moonGone, y, moonMinY) {
  return dimHasMoon && !moonGone && y >= moonMinY ? GRAVITY * 0.5 : GRAVITY;
}

// One gravity line, shared by every vertical chain (mover blast flight,
// mob step, player controller — each applies it exactly once).
export function applyGravity(v, dt, G = GRAVITY) {
  v.y -= G * dt;
}

// One terminal clamp, shared by every fall: no body outruns the same sky.
export function clampFall(v) {
  if (v.y < TERMINAL_VELOCITY) v.y = TERMINAL_VELOCITY;
  return v.y;
}

// Horizontal bleed only, no gravity: the player controller applies gravity
// once in its own vertical chain, so it shares just this. Returns true
// while horizontal speed survives (false: settled — the caller snaps the
// horizontal axes to zero).
export function dragAir(v, dt) {
  const k = Math.exp(-AIR_DRAG * dt);
  v.x *= k;
  v.z *= k;
  return Math.hypot(v.x, v.z) >= AIR_SNAP;
}

// Additive air steering, in place on a {x, y, z}-like velocity with a
// unit-scale input direction (ix, iy, iz): W/S fly the look direction —
// level mouse steers like a strafe, mouse-down dives, mouse-up brakes the
// fall — while A/D stay horizontal. The input ADDS a velocity component
// instead of re-aiming the body, so inertia survives steering. The law only
// knows geometry, never keys: the horizontal part is decomposed on the
// movement itself — the aligned part extends (tapered toward LAUNCH_VMAX)
// or brakes (floored at zero, so it never reverses), the perpendicular part
// adds sideways (tapered by total speed with a floor); the vertical part
// dives or brakes along the look, floored at STEER_MIN_SINK and capped at
// the entry velocity so steering redistributes falling speed but never
// creates climb. In a fast fall the horizontal total is coned to the fall
// rate (light angle on long presses, eased in slow — never a
// snap). The horizontal total never exceeds LAUNCH_VMAX. Thrown arcs
// (grapple fling, mega launch, fly exit) and free falls all step through
// this one rule — no per-case forks.
export function steerAir(v, ix, iy, iz, dt) {
  const im = Math.hypot(ix, iy, iz);
  if (!(im > 1e-9) || !(dt > 0)) return;
  const ux = ix / im, uy = iy / im, uz = iz / im;
  const acc = AIR_ACCEL;
  const s0 = Math.hypot(v.x, v.z);
  // Horizontal frame: the motion direction, or the input's horizontal part
  // from a hover. A purely vertical input skips the horizontal add.
  let fx = 0, fz = 0, s = s0, hasH = false;
  if (s0 > 0.5) { fx = v.x / s0; fz = v.z / s0; s = s0; hasH = true; }
  else {
    const hm = Math.hypot(ux, uz);
    if (hm > 1e-9) { fx = ux / hm; fz = uz / hm; s = s0; hasH = true; }
  }
  let nx = v.x, nz = v.z;
  if (hasH) {
    const a = ux * fx + uz * fz;
    const lx = ux - fx * a, lz = uz - fz * a;
    const m = Math.hypot(lx, lz);
    if (a >= 0) s = Math.min(s + acc * a * dt * Math.max(0, 1 - s / LAUNCH_VMAX), LAUNCH_VMAX);
    else s = Math.max(s + acc * a * dt, 0);
    nx = fx * s; nz = fz * s;
    if (m > 1e-9) {
      const lat = acc * Math.max(0.2, 1 - s0 / LAUNCH_VMAX) * dt;
      nx += (lx / m) * lat;
      nz += (lz / m) * lat;
    }
  }
  v.x = nx; v.z = nz;
  // Vertical channel: dive or brake along the look. Never raises vy past
  // its entry value (no pumping arcs or jumps into the sky) and never
  // brakes past a slow sink (no hover-climb), while the terminal always
  // bounds the dive.
  if (uy !== 0) {
    v.y = Math.min(Math.max(v.y + uy * acc * dt, TERMINAL_VELOCITY), Math.max(v.y, STEER_MIN_SINK));
  }
  // Fall cone: bound the horizontal total by the fall rate, eased in.
  if (v.y < AIR_FALL_CAP_VY) {
    const cap = -v.y * AIR_FALL_CAP_SLOPE;
    const h = Math.hypot(v.x, v.z);
    if (h > cap) {
      const nh = Math.max(cap, h - AIR_CONE_EASE * dt); // ease, never snap
      v.x *= nh / h; v.z *= nh / h;
    }
  }
  const total = Math.hypot(v.x, v.z);
  if (total > LAUNCH_VMAX) { v.x *= LAUNCH_VMAX / total; v.z *= LAUNCH_VMAX / total; }
}

// One airborne step, in place on any {x, y, z}-like velocity: gravity,
// terminal clamp, then the shared bleed. Mobs (never any input) step
// through this; the player steers with input through steerAir above and
// shares the no-input bleed here — one drag constant, one sky, no gates.
export function stepAir(v, dt, G = GRAVITY) {
  applyGravity(v, dt, G);
  clampFall(v);
  return dragAir(v, dt);
}

// Body-center launch off a pool centroid (cx/cy/cz are block coords, hence
// the +0.5). Returns {vx, vy, vz} or null when the body starts outside R.
// V0 is drag-compensated (range = V0 * (1 - e^-DRAG·airT) / DRAG), so the
// arc still travels the uniform 1.5R from the center despite the bleed.
export function computeMegaLaunch(px, py, pz, cx, cy, cz, R) {
  const dx0 = px - (cx + 0.5), dy0 = py - (cy + 0.5), dz0 = pz - (cz + 0.5);
  if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 >= R * R) return null;
  let dx = px - (cx + 0.5), dz = pz - (cz + 0.5);
  let d0 = Math.hypot(dx, dz);
  if (d0 < 0.001) { dx = 1; dz = 0; d0 = 0.001; } else { dx /= d0; dz /= d0; }
  const f = Math.max(0, 1 - d0 / (R * 2));
  const Vup = 22 + 8 * f;
  const airT = (2 * Vup) / GRAVITY;
  // Ballistic arc with uniform 1.5R travel from the center.
  const need = 1.5 * R;
  const V0 = Math.min(LAUNCH_VMAX, Math.max(LAUNCH_VMIN,
    (need * AIR_DRAG) / Math.max(1e-6, 1 - Math.exp(-AIR_DRAG * Math.max(0.5, airT)))));
  return { vx: dx * V0, vy: Vup, vz: dz * V0 };
}

// Straight-line fly shove off a pool centroid (same +0.5 block coords as
// above). Returns {vx, vy, vz} or null when the body starts outside R.
// Calibrated like the arc — uniform 1.5R travel from the center — but on
// KNOCK_DECAY, so the ride reads as a brief punch: the peak grows with the
// pool (1.5*R*KNOCK_DECAY) while the speed cap derives from LAUNCH_VMAX,
// never a second literal. Wall tunneling at that speed is absorbed by the
// 0.5-substepped movers.
export function megaFlyShove(px, py, pz, cx, cy, cz, R) {
  const dx0 = px - (cx + 0.5), dy0 = py - (cy + 0.5), dz0 = pz - (cz + 0.5);
  if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 >= R * R) return null;
  let dx = dx0, dy = dy0, dz = dz0;
  let d = Math.hypot(dx, dy, dz);
  if (d < 0.001) { dx = 1; dy = 0; dz = 0; d = 0.001; }
  const spd = Math.min(1.5 * LAUNCH_VMAX * KNOCK_DECAY, 1.5 * R * KNOCK_DECAY);
  return { vx: (dx / d) * spd, vy: (dy / d) * spd, vz: (dz / d) * spd };
}
