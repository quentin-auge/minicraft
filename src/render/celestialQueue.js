// Pending celestial chunk builds (Moon + planet discs), three-free.
// Bodies sit far past the stream window, so their meshes converge through
// this queue instead of the proximity window: entries survive window
// crossings (the mesher prune exemption) and drain nearest-first under a
// reserved per-frame cap, so a rocket ascent builds the whole sky instead
// of losing progress at every crossing — with zero extra frame budget.
import { CHUNK, chunkOf } from "../core/store.js";

export function chunkKeyOf(wx, wz) {
  return wx + "_" + wz;
}

export function parseQueueKey(ck) {
  const i = ck.lastIndexOf("_");
  return [+ck.slice(0, i), +ck.slice(i + 1)];
}

// Squared XZ distance from the player to a chunk's center (ordering only;
// far bodies never need the height-aware drop term of chunkDist3).
export function queueDist2(px, pz, ck) {
  const [wx, wz] = parseQueueKey(ck);
  const dx = wx * CHUNK + CHUNK / 2 - px;
  const dz = wz * CHUNK + CHUNK / 2 - pz;
  return dx * dx + dz * dz;
}

// Queue body-center block coords as chunk keys, skipping built chunks and
// keys already pending in either queue. Returns the newly added count.
export function queueCelestialKeys(pending, chunkQueued, builtHas, coords) {
  let added = 0;
  for (const [x, , z] of coords) {
    const ck = chunkOf(x) + "_" + chunkOf(z);
    if (builtHas(ck) || pending.has(ck) || chunkQueued.has(ck)) continue;
    pending.add(ck);
    added++;
  }
  return added;
}

// Up to `cap` pending keys, nearest-first, removed from the set and
// skipping built chunks. The caller rebuilds each returned key.
export function takeCelestialBatch(pending, builtHas, px, pz, cap) {
  if (!pending.size || cap <= 0) return [];
  const scored = [];
  for (const ck of pending) {
    if (builtHas(ck)) { pending.delete(ck); continue; }
    scored.push([queueDist2(px, pz, ck), ck]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let i = 0; i < scored.length && out.length < cap; i++) {
    pending.delete(scored[i][1]);
    out.push(scored[i][1]);
  }
  return out;
}

// Prune predicate for the shared build queue: drop built entries and
// entries outside the stream window — unless pinned (celestial bodies keep
// converging across crossings instead of restarting every time).
export function dropQueued(ck, keep, pinnedHas, builtHas) {
  if (builtHas(ck)) return true;
  return !keep.has(ck) && !pinnedHas(ck);
}
