// Snow field tuning + fade math (three-free): shared by the precip engine
// (`precip.js`, which owns the THREE points) and the headless suite, so the
// numbers below are asserted, never just written. Visibility is 100% flake
// world-position: full below +50 and inside rim + 25, gone past +100 in
// altitude and rim + 50 radially (smoothstep ramps).
import { MOON_R, MOON_SURFACE_Y } from "../world/moon.js";
import { MOON_SPEC } from "../world/planets.js";

// Full force over the whole moon disc: the camera-following box covers the
// diameter (range 100 > R 96), 20000 drops keep the legacy volumetric
// density over the taller birth column below.
export const SNOW_COUNT = 20000;
export const SNOW_RANGE = 100;
export const SNOW_SIZE = 0.144;
export const SNOW_OPACITY = 0.9;
// Birth band near the top of the visible column: point-ish injection at
// the fade top falls into a uniform column below (a wide band would pile
// drops at the bottom — every level would see only the births above it).
export const SNOW_TOP_LO = 100;
export const SNOW_TOP_HI = 130;
// Fade volume (absolute): full below +50 and inside rim + 25, gone past
// +100 in altitude and rim + 50 radially (mirrored ramps).
export const SNOW_FADE_R0 = MOON_R + 25;
export const SNOW_FADE_RW = 25;
export const SNOW_FULL_HI = MOON_SURFACE_Y + 50;
export const SNOW_FADE_TOP = MOON_SURFACE_Y + 100;
// Landing floor: flakes may fall through open shafts down to 50 below the
// surface, but never into rock — groundY below resolves rock tops first.
export const SNOW_FLOOR_BELOW = 50;
export function moonGroundY(top) {
  return top > MOON_SURFACE_Y ? top : Math.max(top, MOON_SURFACE_Y - SNOW_FLOOR_BELOW);
}
// Early-out bounds: past these, no flake in the camera slab can stay
// visible — skip integration and the draw call entirely.
export const SNOW_OFF_Y = MOON_SURFACE_Y + 220;
export const SNOW_OFF_R = SNOW_FADE_R0 + SNOW_FADE_RW + SNOW_RANGE + 4;
// Visible slab below the camera: flakes leaving it respawn at the top
// instead of falling for tens of seconds toward a far-below ground (the
// density collapse on fast ascents). Unreachable near the surface: the
// ground catch fires first.
export const SNOW_SLAB_BELOW = 120;

const SNOW_FADE_Y0 = MOON_SURFACE_Y - 8;
const SNOW_FADE_Y1 = MOON_SURFACE_Y;

function smooth01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function snowAltitudeFade(y) {
  return smooth01((y - SNOW_FADE_Y0) / (SNOW_FADE_Y1 - SNOW_FADE_Y0));
}

// Temporal field fade (symmetric leave/return): the camera's own position
// in the fade volume gives the whole field's 0..1 target, smoothed
// asymmetrically — fast out (leaving reads as one uniform fade), slow in
// (returning reads as a progressive fade-in, never a pop).
export const SNOW_FADE_OUT_T = 0.25;
export const SNOW_FADE_IN_T = 0.8;
export function snowFieldTarget(camY, camR) {
  return snowHeightFade(camY) * radialFadeD(camR, SNOW_FADE_R0, SNOW_FADE_RW);
}
export function smoothShown(shown, target, dt) {
  if (dt <= 0) return shown;
  const rate = target < shown ? 1 / SNOW_FADE_OUT_T : 1 / SNOW_FADE_IN_T;
  const next = shown + Math.sign(target - shown) * Math.min(Math.abs(target - shown), rate * dt);
  return Math.max(0, Math.min(1, next));
}
// Per-flake height fade (mirrored verbatim in the vertex shader): full below
// the dense layer, gone at the fade top.
export function snowHeightFade(y) {
  return 1 - smooth01((y - SNOW_FULL_HI) / (SNOW_FADE_TOP - SNOW_FULL_HI));
}

export function snowRadialFade(x, z, cx = MOON_SPEC.cx, cz = MOON_SPEC.cz, r0 = SNOW_FADE_R0, w = SNOW_FADE_RW) {
  return radialFadeD(Math.hypot(x - cx, z - cz), r0, w);
}
function radialFadeD(d, r0, w) {
  return 1 - smooth01((d - r0) / w);
}

const SNOW_SIN = new Float32Array(256);
for (let i = 0; i < 256; i++) SNOW_SIN[i] = Math.sin((i / 256) * Math.PI * 2);

// Pure flake simulation (three-free): positions, velocities and cached
// ground heights as plain arrays, deterministic for a fixed seed stream.
// `spec` carries the tuning (range, topMin/topMax, slabBelow, sway, drift,
// fallMin/Max, step) plus the groundY/landed/seedY callbacks. `tick`
// counts flushed steps (drives the staggered ground refresh), `time` the
// sway clock. The engine (`precip.js`) only wraps this with THREE objects.
export function spawnSnowDrop(spec, pos, vel, ground, i, ex, ey, ez, initial = false) {
  const lo = spec.topMin ?? SNOW_TOP_LO, hi = spec.topMax ?? SNOW_TOP_HI;
  const top = ey + lo + Math.random() * (hi - lo);
  pos[i * 3] = ex + (Math.random() * 2 - 1) * spec.range;
  pos[i * 3 + 1] = initial ? spec.seedY(top) : top;
  pos[i * 3 + 2] = ez + (Math.random() * 2 - 1) * spec.range;
  vel[i * 3] = (Math.random() * 2 - 1) * spec.drift;
  vel[i * 3 + 1] = spec.fallMin + Math.random() * (spec.fallMax - spec.fallMin);
  vel[i * 3 + 2] = (Math.random() * 2 - 1) * spec.drift;
  ground[i] = spec.groundY(Math.floor(pos[i * 3]), Math.floor(pos[i * 3 + 2]));
}

export function stepSnowDrops(spec, pos, vel, ground, count, tick, ex, ey, ez, time, dt) {
  const phase = (time * 19) | 0;
  for (let i = 0; i < count; i++) {
    const swayX = SNOW_SIN[(phase + i * 7) & 255] * spec.sway;
    const swayZ = SNOW_SIN[(phase + i * 13 + 64) & 255] * spec.sway;
    let x = pos[i * 3] + (vel[i * 3] + swayX) * dt;
    let y = pos[i * 3 + 1] - vel[i * 3 + 1] * dt;
    let z = pos[i * 3 + 2] + (vel[i * 3 + 2] + swayZ) * dt;
    let wrapped = false;
    if (x - ex > spec.range) { x -= 2 * spec.range; wrapped = true; }
    else if (x - ex < -spec.range) { x += 2 * spec.range; wrapped = true; }
    if (z - ez > spec.range) { z -= 2 * spec.range; wrapped = true; }
    else if (z - ez < -spec.range) { z += 2 * spec.range; wrapped = true; }
    if (y > ey + (spec.topMax ?? SNOW_TOP_HI) || y < ey - (spec.slabBelow ?? SNOW_SLAB_BELOW)) {
      spawnSnowDrop(spec, pos, vel, ground, i, ex, ey, ez);
      continue;
    }
    let landY = ground[i];
    // Staggered landing-height refresh: each drop re-reads every 8th step,
    // so movement-time wrap storms cost a fraction of the column lookups.
    if (wrapped || (i & 7) === (tick & 7)) {
      landY = spec.groundY(Math.floor(x), Math.floor(z));
      ground[i] = landY;
    }
    if (spec.landed(x, y, z, landY)) { spawnSnowDrop(spec, pos, vel, ground, i, ex, ey, ez); continue; }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }
}
