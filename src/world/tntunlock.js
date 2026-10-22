// TNT tier progression: mega and ultra stay locked outside the TNT dimension
// until enough Ender Dragon kills. ?cheat=1 bypasses the gate for every
// tier. Kills reset with a New World; the URL bypass does not.
import { MEGA_TNT, ULTRA_TNT } from "../core/blocks.js";
import { isCheat } from "../core/cheat.js";

const UNLOCK_KILLS = new Map([
  [MEGA_TNT, 2],
  [ULTRA_TNT, 3],
]);

// Wall-clock boot config (loader/UI exemption): the cheat flag is fixed for
// the whole session, including across New World rebuilds.
const forced = isCheat();

let dragonKills = 0;

export function isLockedTntTier(blockId) {
  return UNLOCK_KILLS.has(blockId);
}

export function isTntTierUnlocked(blockId) {
  const need = UNLOCK_KILLS.get(blockId);
  return need == null || forced || dragonKills >= need;
}

// Returns the tier this kill unlocked (for the hotbar pop), else null.
// The URL bypass already showed every tier, so it never reports an unlock.
export function noteDragonKill() {
  dragonKills++;
  if (forced) return null;
  for (const [id, need] of UNLOCK_KILLS) {
    if (dragonKills === need) return id;
  }
  return null;
}

export function resetTntUnlocks() {
  dragonKills = 0;
}
