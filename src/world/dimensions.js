// First-class dimensions: every dimension is a registry entry, never a
// framework fork. Framework code (store maps, portals, main loop, spawn)
// dispatches through these specs: generator, env preset, spawn, persistence
// + respawn policy, bedrock-floor flag. New dimensions register a spec and
// their world generator; the shared travel/boot pipeline dispatches by key.
// Persistence is itself per-dimension data: "retain" reuses voxels across
// entries; "regenerate" rebuilds on every entry (TNT and End are fresh worlds).
// `arrival` is the portal-return policy: "portal" resolves the window last
// left in this dimension (facing it in the Overworld, facing away in the End),
// "spawn" always uses findSpawn (the TNT sky has no fixed portal).
// Per-dimension properties live here in two channels: gameplay props are
// spec fields read through dim* accessors (moon, ultra, skyGrapple, ...);
// render props ride the env preset (dimEnv: sky, fog, sun, space, ...).
// Convention: if a behavior belongs to a dimension it ships as a spec field
// or env key — never as a `dim ===` fork elsewhere. Each spec key is also its
// `?startdim=<key>` boot key. Ask the user for that key when adding a dimension.
// New-dimension checklist:
// env (sky/fog/sun/space), moon?, ultra mode, hotbar, spawn, arrival,
// persistence, respawnY floor (null = none), bedrock, region `dim` tags,
// precip `active`s, gravity zones.
import {
  generateOverworld, generateOverworldAsync,
} from "./overworld.js";
import { findSpawn } from "./spawn.js";
import {
  generateTntDimension, findTntSpawn, TNT_ENV,
} from "./tntdim.js";
import { bootTntStream, findTntStreamSpawn } from "./tntstream.js";
import { TNT, MEGA_TNT, ULTRA_TNT, WATER, MOON_WATER, FLOWER, GLOWSTONE } from "../core/blocks.js";
import { BASE_ITEMS } from "../ui/hotbar.js";
import { dim, registerInfiniteDim } from "../core/store.js";
import { generateEndDimension, findEndSpawn, isEndCleared } from "./end.js";
import { isLockedTntTier, isTntTierUnlocked } from "./tntunlock.js";

// The TNT sky is the first infinite dimension: voxels stream around the
// player with no walls (see tntstream.js), so the store lifts its bounds.
registerInfiniteDim("tnt");

export const DIMENSIONS = [
  {
    key: "over",
    persistence: "retain",
    arrival: { mode: "portal", facing: "face" },
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
    arrival: { mode: "spawn" },
    hasBedrockFloor: false,
    // Infinite sky, no floor (respawnY: null): the fall never ends.
    respawnY: null,
    env: TNT_ENV,
    infinite: true,
    // No moon, no space fade (TNT_ENV.space), no bands: ultras wipe an
    // ignition-centered window instead (256-disc, ±256: height matches the
    // radius). Sky-grapple allowed (synthesized lattice clouds past the fog).
    moon: false,
    ultra: { bands: false, windowR: 256, windowHalfH: 256 },
    skyGrapple: true,
    generate: (seed) => generateTntDimension(seed),
    generateAsync: (seed) => bootTntStream(seed),
    findSpawn: () => findTntStreamSpawn(null),
    // Legacy cube spawn (headless + reference); the streamed world boots
    // through findTntStreamSpawn above.
    findSpawnLegacy: () => findTntSpawn(),
    // TNT tiers only — but all three: a return portal's frame needs at least
    // one mega and one ultra, so dropping ultra would strand visitors. This
    // dimension also keeps every tier usable before the dragon-kill unlocks.
    tntTiersUnlocked: true,
    hotbar: [TNT, MEGA_TNT, ULTRA_TNT],
  },
  {
    key: "end",
    persistence: "regenerate",
    arrival: { mode: "portal", facing: "away" },
    hasBedrockFloor: false,
    respawnY: -20,
    // No portal may ferry the player out of the End while the dragon lives;
    // every window touch answers this message instead of traveling.
    exitsGate: () => !isEndCleared(),
    exitsGateMsg: "The exit is sealed — defeat the Ender Dragon!",
    env: {
      sky: 0x000000, fogNear: 30, fogFar: 150,
      sun: 0xfff5e0, sunI: 0.35, hemiSky: 0xbfd4ff, hemiI: 0.45,
      space: false,
    },
    moon: false,
    ultra: { bands: false, windowR: 256, windowHalfH: 90 },
    skyGrapple: false,
    generate: () => generateEndDimension(),
    generateAsync: async (_seed, aborted) => {
      if (aborted && aborted()) return false;
      generateEndDimension();
      return !(aborted && aborted());
    },
    findSpawn: findEndSpawn,
    hotbar: BASE_ITEMS.map((id) => id === WATER ? MOON_WATER : id === FLOWER ? GLOWSTONE : id),
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

// TNT-dimension exemption: its bar and placement rules ignore the dragon-kill
// locks (the sky is where the tiers live before the unlocks).
export function dimTntTiersUnlocked(name = dim) {
  return !!byKey.get(name)?.tntTiersUnlocked;
}

// Dimension bar with locked TNT tiers removed unless this dimension keeps
// them available or their unlock threshold (or the URL bypass) is met.
export function dimHotbar(name = dim) {
  const spec = byKey.get(name);
  const list = spec?.hotbar ?? BASE_ITEMS;
  if (spec?.tntTiersUnlocked) return list.slice();
  return list.filter((id) => !isLockedTntTier(id) || isTntTierUnlocked(id));
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
