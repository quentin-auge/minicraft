// First-class dimensions: every dimension is a registry entry, never a
// framework fork. Framework code (store maps, portals, main loop, spawn)
// dispatches through these specs: generator, env preset, spawn, persistence
// + respawn policy, bedrock-floor flag. New dimensions register a spec and
// nothing else changes — Nether/End later arrive as entries here.
// Persistence is itself per-dimension data: "retain" reuses voxels across
// entries (overworld, future Nether); "regenerate" rebuilds on every entry
// (TNT — each visit is a fresh throwaway cube).
import {
  generateOverworld, generateOverworldAsync,
} from "./overworld.js";
import { findSpawn } from "./spawn.js";
import {
  generateTntDimension, generateTntDimensionAsync, findTntSpawn, TNT_ENV,
} from "./tntdim.js";
import { TNT, MEGA_TNT, ULTRA_TNT } from "../core/blocks.js";
import { BASE_ITEMS } from "../ui/hotbar.js";

export const DIMENSIONS = [
  {
    key: "over",
    persistence: "retain",
    hasBedrockFloor: true,
    respawnY: -20,
    env: null, // overworld keeps the compiled-in day sky/fog (null = default)
    generate: (seed) => generateOverworld(seed),
    generateAsync: (seed, abort) => generateOverworldAsync(seed, abort),
    findSpawn: () => findSpawn(1.62),
    hotbar: BASE_ITEMS,
  },
  {
    key: "tnt",
    persistence: "regenerate",
    hasBedrockFloor: false,
    respawnY: -20,
    env: TNT_ENV,
    generate: (seed) => generateTntDimension(seed),
    generateAsync: (seed, abort) => generateTntDimensionAsync(seed, abort),
    findSpawn: () => findTntSpawn(),
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
