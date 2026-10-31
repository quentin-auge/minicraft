// Spatial hash for mobs (three-free, pure): one Map built per tick, queried
// by every O(N^2) site instead of scanning the whole herd. Insertion order
// follows the input list (`_peerIdx` order in the farm pipeline), cell
// iteration is fixed, so queries are deterministic run to run. Queries are
// XZ-only with a radius superset of each caller's internal skip distance
// (the caller's own exact checks filter the rest), so results are identical
// to a full scan — only faster. Order-sensitive consumers re-sort by
// `_peerIdx` to also keep legacy processing order bit-identical.
export function buildMobGrid(list, cell = 3) {
  const grid = new Map();
  for (const m of list) {
    if (!m.alive) continue;
    const k = Math.floor(m.pos.x / cell) + "," + Math.floor(m.pos.z / cell);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(m);
  }
  grid.cell = cell;
  return grid;
}

// Fill out (cleared first) with mobs whose cell overlaps the query disc.
// Fixed dx/dz order, insertion order inside buckets: deterministic.
export function queryMobGrid(grid, x, z, radius, out = []) {
  out.length = 0;
  const cell = grid.cell;
  const x0 = Math.floor((x - radius) / cell), x1 = Math.floor((x + radius) / cell);
  const z0 = Math.floor((z - radius) / cell), z1 = Math.floor((z + radius) / cell);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const bucket = grid.get(cx + "," + cz);
      if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
    }
  }
  return out;
}
