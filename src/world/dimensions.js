// First-class dimensions: every dimension is a registry entry, never a
// framework fork. Framework code (store maps, portals, main loop, spawn)
// dispatches through these specs: generator, env preset, spawn, persistence
// + respawn policy, bedrock-floor flag. New dimensions register a spec and
// nothing else changes — Nether/End later arrive as entries here.
// Persistence is itself per-dimension data: "retain" reuses voxels across
// entries (overworld, future Nether); "regenerate" rebuilds on every entry
// (TNT — each visit is a fresh throwaway cube).
// Per-dimension properties live here in two channels: gameplay props are
// spec fields read through dim* accessors (moon, ultra, skyGrapple, ...);
// render props ride the env preset (dimEnv: sky, fog, sun, space, ...).
// Convention: if a behavior belongs to a dimension it ships as a spec field
// or env key — never as a `dim ===` fork elsewhere. New-dimension checklist:
// env (sky/fog/sun/space), moon?, ultra mode, hotbar, spawn, persistence,
// respawnY + reseat, bedrock, region `dim` tags, precip `active`s, gravity zones.
import {
  generateOverworld, generateOverworldAsync,
} from "./overworld.js";
import { findSpawn } from "./spawn.js";
import {
  generateTntDimension, findTntSpawn, TNT_ENV,
} from "./tntdim.js";
import { bootTntStream, findTntStreamSpawn, reseatTnt } from "./tntstream.js";
import { TNT, MEGA_TNT, ULTRA_TNT } from "../core/blocks.js";
import { BASE_ITEMS } from "../ui/hotbar.js";
import { registerInfiniteDim } from "../core/store.js";

// The TNT sky is the first infinite dimension: voxels stream around the
// player with no walls (see tntstream.js), so the store lifts its bounds.
registerInfiniteDim("tnt");

export const DIMENSIONS = [
  {
    key: "over",
    persistence: "retain",
    hasBedrockFloor: true,
    respawnY: -20,
    env: null, // overworld keeps the compiled-in day sky/fog (null = default)
    // Overworld-only properties: the moon body (generation, low-grav zone,
    // moon snow, moon-band hotbar), band-sliced ultra wipes, black-above-
    // the-clouds sky with stars (via the null env default).
    moon: true,
    ultra: { bands: true },
    skyGrapple: false,
    generate: (seed) => generateOverworld(seed),
    generateAsync: (seed, abort) => generateOverworldAsync(seed, abort),
    findSpawn: () => findSpawn(1.62),
    hotbar: BASE_ITEMS,
  },
  {
    key: "tnt",
    persistence: "regenerate",
    hasBedrockFloor: false,
    // Infinite sky: falling never ends until the far safety net, and the
    // reseat lands on the nearest streamed cloud (see main.js).
    respawnY: -4096,
    env: TNT_ENV,
    infinite: true,
    // No moon, no space fade (TNT_ENV.space), no bands: ultras wipe an
    // ignition-centered window instead. Sky-grapple allowed (synthesized
    // lattice clouds past the fog).
    moon: false,
    ultra: { bands: false, windowR: 256, windowHalfH: 90 },
    skyGrapple: true,
    generate: (seed) => generateTntDimension(seed),
    generateAsync: (seed) => bootTntStream(seed),
    findSpawn: () => findTntStreamSpawn(null),
    // Legacy cube spawn (headless + reference); the streamed world boots
    // through findTntStreamSpawn above.
    findSpawnLegacy: () => findTntSpawn(),
    // Below-floor recovery: reseat on the nearest streamed cloud instead of
    // teleporting home to spawn.
    reseat: (x, y, z) => {
      const s = reseatTnt(x, y, z);
      return { x: s.x + 0.5, y: s.y + 1.01, z: s.z + 0.5 };
    },
    // TNT tiers only — but all three: a return portal's frame needs at least
    // one mega and one ultra, so dropping ultra would strand visitors.
    hotbar: [TNT, MEGA_TNT, ULTRA_TNT],
  },
];

const byKey = new Map(DIMENSIONS.map((s) => [s.key, s]));
export function dimSpec(key) {
  return byKey.get(key);
}
export function dimHasBedrock(key) {
  return byKey.get(key)?.hasBedrockFloor ?? true;
}
export function dimEnv(key) {
  return byKey.get(key)?.env ?? null;
}

// Moon body present (generation is generator-owned; this gates the low-grav
// zone, moon snow, and the moon-band hotbar swap). Defaults off: the moon
// is overworld-private.
export function dimHasMoon(key) {
  return byKey.get(key)?.moon ?? false;
}

// Ultra wipe mode. Bands slice the overworld by altitude; everywhere else a
// window opens around the ignition (radius + half-height, both tunable per
// dimension). Bands are opt-in.
const DEFAULT_ULTRA = { bands: false, windowR: 256, windowHalfH: 90 };
export function dimUltra(key) {
  return { ...DEFAULT_ULTRA, ...byKey.get(key)?.ultra };
}

// Overworld exit memory: leaving over stashes the live footing; returning
// restores it when the caller finds it still standable, else falls back to
// the dim spawn. TNT never restores (fresh clouds every entry), so no memory
// is kept for it.
let overExit = null;
export function stashOverExit(p) {
  overExit = { x: p.x, y: p.y, z: p.z };
}
export function takeOverExit() {
  return overExit;
}
