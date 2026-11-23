// Reveal regions: named world volumes whose meshes are gated by a visibility
// factor (0..1) driven each frame — hidden below it, faded in as it rises.
// The Moon is entry #1, the planets entry #2; any future far body or occluded
// structure registers a spec instead of forking the mesher. A region declares
// its own membership (blocks + contains) and factor; the mesher splits
// instance lists by regionOf() and applies the generic opacity fade, with an
// optional onFade hook for bespoke material work (celestial rock crossfades
// sky-colour→texture while staying opaque).
import * as THREE from "three";
import { MOON, MOON_WATER, PLANET_ROCKS, PLANET_WATERS } from "../core/blocks.js";
import { dim } from "../core/store.js";
import { MOON_MIN_Y } from "../world/moon.js";
import { PLANET_MIN_Y, CELESTIAL_FADE_Y, celestialRevealFactor, planetBodyAtPlaced } from "../world/planets.js";

const WHITE = new THREE.Color(0xffffff);
const _tintBase = new THREE.Color();
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// Fade band: the Moon disc and the planets ramp invisible→solid over the
// shared celestial band in planets.js — the 20 blocks after the sky turned
// black (sky.js rides the same chain) plus its pure-black buffer. The sky
// starts fading SKY_LEAD below the fog anchor, as soon as the last cloud
// deck is barely fog-dissolving: at the anchor itself even a puff right
// underfoot is fully fog color, everything else vanished earlier. Puff
// spill past CLOUD_MAX_Y and view direction are absorbed — the start
// itself is invisible (factor 0 tints sky-color) and visible emergence
// lags it by several blocks. Driven every frame — no remeshing, so
// nothing can pop in chunk by chunk.

// Tint floor for the celestial-water reveal: the tint base eases from this
// dark grey (never pure black) to the sky color as the factor ramps to 1.
const MOON_WATER_FLOOR = new THREE.Color(0x2e3236);

// Shared celestial reveal: rock crossfades sky-colour→texture while staying
// opaque (depth-writing) so stars never show through the emerging body; the
// opaque outside water sheets mirror the rock off a dark-grey tint floor
// (never pure black at distance), and the inside/pocket sheets keep their
// generic opacity with the same tint. Identical for the Moon and the planets.
function applyCelestialFade(rockIds, waterIds, o, skyColor, ctx) {
  for (const id of rockIds) {
    for (const m of ctx.mats(id)) {
      m.opacity = 1;
      m.transparent = false;
      m.depthWrite = true;
      m.color.copy(skyColor).lerp(WHITE, o);
      if (m.emissive) m.emissive.copy(skyColor).lerp(WHITE, o);
    }
  }
  _tintBase.copy(skyColor).lerp(MOON_WATER_FLOOR, (1 - o) * smooth(o / 0.25));
  for (const id of waterIds) {
    for (const m of [ctx.liquidMat(id, "outside")].flat()) {
      m.opacity = 1;
      m.transparent = false;
      m.depthWrite = true;
      m.color.copy(_tintBase).lerp(WHITE, o);
    }
    for (const m of [ctx.liquidMat(id, "inside"), ctx.liquidMat(id, "pocket")].flat()) {
      m.color.copy(_tintBase).lerp(WHITE, o);
    }
  }
}

// Planet volume test for placed cells: the padded planet cylinders. Body
// voxels never reach here (their block ids take the fast path), so this
// only classifies player-placed blocks — and only matters for bands whose
// Voronoi floor dips near the Moon, where the plane alone would misfile
// cells inside a low planet.
function inPlanetVolume(x, y, z) {
  return planetBodyAtPlaced(x, y, z) !== null;
}

export const REGIONS = [
  {
    key: "moon",
    dim: "over",
    // Intrinsically lunar blocks; also the fast path so no volume test runs
    // for the common case.
    blocks: [MOON, MOON_WATER],
    // Anything at or above the disc's lower end (and below the planet Voronoi
    // mid-plane, outside every planet cylinder) belongs to the Moon — placed
    // stones, dirt, flowers, liquids included — so blue sky never reveals a
    // stray silhouette on descent. The volume test only runs for bands whose
    // mid-plane dips into the Moon's altitude range.
    contains: (id, x, y, z) => y >= MOON_MIN_Y && y < PLANET_MIN_Y && !inPlanetVolume(x, y, z),
    factor: (p) => celestialRevealFactor(p.y),
    revealMaterials: true,
    onFade(o, skyColor, ctx) {
      applyCelestialFade([MOON], [MOON_WATER], o, skyColor, ctx);
    },
  },
  {
    key: "planets",
    dim: "over",
    // Intrinsically planet blocks; same fast path as the Moon.
    blocks: [...PLANET_ROCKS, ...PLANET_WATERS],
    // Anything inside a planet cylinder (padded) or at/above the Voronoi
    // mid-plane belongs to the planets — placed stones, dirt, flowers,
    // liquids included. The volume term keeps low-band planets whole even
    // where their cylinders dip below the clamped mid-plane.
    contains: (id, x, y, z) => y >= PLANET_MIN_Y || inPlanetVolume(x, y, z),
    // Fade in on the shared celestial band, together with the Moon: the
    // whole sky appears at once, on the black sky above the clouds.
    factor: (p) => celestialRevealFactor(p.y),
    revealMaterials: true,
    onFade(o, skyColor, ctx) {
      applyCelestialFade(PLANET_ROCKS, PLANET_WATERS, o, skyColor, ctx);
    },
  },
];

const byKey = new Map(REGIONS.map((r) => [r.key, r]));
export function regionByKey(key) {
  return byKey.get(key) || null;
}

// Back-compat alias.
byKey.set("celestial", byKey.get("moon"));

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
