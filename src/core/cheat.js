// Cheat flag: ?cheat=1 unlocks gated shortcuts for the whole session,
// including across New World rebuilds (loader/UI exemption). Today it
// bypasses the TNT tier locks and enables the Z dimension cycle.
export const CHEAT = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("cheat") === "1";

export function isCheat() {
  return CHEAT;
}
