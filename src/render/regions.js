// Reveal regions: named world volumes whose meshes are gated by a visibility
// factor (0..1) driven each frame — hidden below it, faded in as it rises.
// The Moon is entry #1; any future far body or occluded structure registers a
// spec instead of forking the mesher. A region declares its own membership
// (blocks + contains) and factor; the mesher splits instance lists by
// regionOf() and applies the generic opacity fade, with an optional onFade
// hook for bespoke material work (the Moon rock tints sky-colour→texture).
import * as THREE from "three";
import { MOON, MOON_WATER } from "../core/blocks.js";
import { CLOUD_MAX_Y } from "../world/clouds.js";
import { dim } from "../core/store.js";
import { MOON_MIN_Y } from "../world/moon.js";

const WHITE = new THREE.Color(0xffffff);
const _tintBase = new THREE.Color();
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// Fade band: the disc ramps invisible→solid from 620 to 640. The start is
// CLOUD_MAX_Y plus the steady-state fog far (160: overworld env is null, so
// the compiled-in scene fog caps it and the altitude-based horizon never
// binds): at 620 even a puff right underfoot is fully fog color, everything
// else vanished earlier. Puff spill past CLOUD_MAX_Y and view direction are
// absorbed — the start itself is invisible (factor 0 tints sky-color) and
// visible emergence lags it by several blocks. Driven every frame — no
// remeshing, so nothing can pop in chunk by chunk. Exported: the moon
// hotbar follows the same gate instead of duplicating the threshold.
export const MOON_FADE_Y = CLOUD_MAX_Y + 160;
const MOON_FADE_END = 640;

export const REGIONS = [
  {
    key: "moon",
    dim: "over",
    // Intrinsically lunar blocks; also the fast path so no volume test runs
    // for the common case.
    blocks: [MOON, MOON_WATER],
    // Anything at or above the disc's lower end belongs to the Moon — placed
    // stones, dirt, flowers, liquids included — so blue sky never reveals a
    // stray silhouette on descent.
    contains: (id, x, y, z) => y >= MOON_MIN_Y,
    factor: (p) => smooth((p.y - MOON_FADE_Y) / (MOON_FADE_END - MOON_FADE_Y)),
    // Owns material clones (the mesher fades their opacity generically); the
    // rock additionally crossfades sky-colour→texture while staying opaque
    // (depth-writing) so stars never show through the emerging body.
    revealMaterials: true,
    onFade(o, skyColor, ctx) {
      for (const m of ctx.mats(MOON)) {
        m.opacity = 1;
        m.transparent = false;
        m.depthWrite = true;
        m.color.copy(skyColor).lerp(WHITE, o);
        if (m.emissive) m.emissive.copy(skyColor).lerp(WHITE, o);
      }
      // The opaque outside sheet mirrors the rock (staying depth-writing,
      // sky-tinted), the inside/pocket sheets keep their generic opacity
      // but get the same tint. The floor lifts the tint base off pure
      // black, so the exterior never reads black at distance while the
      // factor ramps (no-op at factor 1). The floor weight is zero at
      // factor 0 and ramps in fast, so the lakes stay invisible with the
      // rock instead of popping dark against the sky before the disc.
      _tintBase.copy(skyColor).lerp(MOON_WATER_FLOOR, (1 - o) * smooth(o / 0.25));
      for (const m of [ctx.liquidMat(MOON_WATER, "outside")].flat()) {
        m.opacity = 1;
        m.transparent = false;
        m.depthWrite = true;
        m.color.copy(_tintBase).lerp(WHITE, o);
      }
      for (const m of [ctx.liquidMat(MOON_WATER, "inside"), ctx.liquidMat(MOON_WATER, "pocket")].flat()) {
        m.color.copy(_tintBase).lerp(WHITE, o);
      }
    },
  },
];

// Tint floor for the moonwater reveal: the tint base eases from this dark
// grey (never pure black) to the sky color as the factor ramps to 1.
const MOON_WATER_FLOOR = new THREE.Color(0x2e3236);

const byKey = new Map(REGIONS.map((r) => [r.key, r]));
export function regionByKey(key) {
  return byKey.get(key) || null;
}

// First region whose dimension matches and whose membership accepts the cell;
// regions are few, so a linear scan per occupied cell is trivial.
export function regionOf(id, x, y, z) {
  for (const r of REGIONS) {
    if (r.dim && r.dim !== dim) continue;
    if (r.blocks && r.blocks.includes(id)) return r;
    if (r.contains && r.contains(id, x, y, z)) return r;
  }
  return null;
}

// Push every region's current factor to the renderer. Called once per frame
// after the sky colour is up to date (the crossfade reads it).
export function applyRegions(camPos, skyColor, setFade) {
  for (const r of REGIONS) setFade(r.key, r.factor(camPos), skyColor);
}
