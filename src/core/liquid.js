// Floating-liquid anchor rule (three-free): which solid neighbors keep a
// same-liquid group alive, plus the pure discovery pass over it.
// edit.js wraps discovery with the voxel writes + portal notifies; the TNT
// blast purge reuses the same rule through the injected onLiquidPurge
// callback, so blasts never strand floating remnants.
import { AIR, BLOCK_INFO, isLiquid } from "./blocks.js";
import { key } from "./store.js";

// Face-or-edge connectivity (18-neighborhood): seed collection, flood
// expansion, and anchor test share it. Edge contact (exactly two axes
// offset) joins the flood and anchors; corner contact (three axes offset)
// does neither — kept deliberately narrow.
export const LIQUID_FACE_NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const LIQUID_EDGE_NB = [
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
];
// Flood + anchor order: faces first (cheap early-out on the common
// face-anchored case), edges only after.
export const LIQUID_ALL_NB = [...LIQUID_FACE_NB, ...LIQUID_EDGE_NB];
export const PURGE_GUARD = 60000;

function isSolidId(id) {
  return id !== AIR && !!BLOCK_INFO[id] && BLOCK_INFO[id].solid;
}

// Anchor test: any face- or edge-neighbor solid (faces checked first).
export function touchesSolid(getBlock, x, y, z) {
  for (const [dx, dy, dz] of LIQUID_FACE_NB) {
    if (isSolidId(getBlock(x + dx, y + dy, z + dz))) return true;
  }
  for (const [dx, dy, dz] of LIQUID_EDGE_NB) {
    if (isSolidId(getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

// Pure discovery: cells that would return to air (no writes here, so the
// headless suite can run the real rule on real voxels). One fused 18-pass
// per cell, faces first: one getBlock per neighbor serves the anchor test
// and the flood expansion alike. The per-cell scan always completes (no
// mid-scan break), then a solid grounds the whole group with an immediate
// break. Candidates join `seen` only when actually pushed: a break must
// strand nothing in `seen`, or later seeds would skip unjudged cells and
// wrongly purge their branch.
// Early breaks split true components, so every grounded group's cells
// (popped and leftover) join a `kept` bridge, and a rescue pass un-purges
// any purged cell 18-connected (same liquid) to a kept one: joining and
// anchoring through edges only ever rescues (new purges ⊆ old purges on
// identical seeds), and breaking an edge-only anchor seeds the group it
// strands (seeds cover the same 18 neighborhood).
export function findFloatingLiquids(getBlock, coords) {
  const seen = new Set();
  const kept = new Set();
  const purged = [];
  const lidOf = new Map();
  const seeds = [];
  for (const [x, y, z] of coords) {
    if (isLiquid(getBlock(x, y, z))) seeds.push([x, y, z]);
    for (const [dx, dy, dz] of LIQUID_ALL_NB) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (ny < 0) continue;
      if (isLiquid(getBlock(nx, ny, nz))) seeds.push([nx, ny, nz]);
    }
  }
  for (const [sx, sy, sz] of seeds) {
    const lid = getBlock(sx, sy, sz);
    if (!isLiquid(lid)) continue;
    const sk = key(sx, sy, sz);
    if (seen.has(sk)) continue;
    const cells = [];
    const stack = [[sx, sy, sz]];
    seen.add(sk);
    let grounded = false;
    let guard = 0;
    while (stack.length) {
      if (++guard > PURGE_GUARD) { grounded = true; break; }
      const [x, y, z] = stack.pop();
      cells.push([x, y, z]);
      let solid = false;
      const hits = [];
      for (const [dx, dy, dz] of LIQUID_ALL_NB) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const nid = getBlock(nx, ny, nz);
        if (isSolidId(nid)) solid = true;
        else {
          if (ny < 0) continue;
          if (nid !== lid) continue;
          hits.push([nx, ny, nz]);
        }
      }
      if (solid) { grounded = true; break; }
      for (const [nx, ny, nz] of hits) {
        const nk = key(nx, ny, nz);
        if (seen.has(nk)) continue;
        seen.add(nk);
        stack.push([nx, ny, nz]);
      }
    }
    if (grounded) {
      for (const [x, y, z] of cells) kept.add(key(x, y, z));
      for (const [x, y, z] of stack) kept.add(key(x, y, z));
      continue;
    }
    for (const [x, y, z] of cells) {
      if (y === 0) continue;
      if (getBlock(x, y, z) !== lid) continue;
      const pk = key(x, y, z);
      lidOf.set(pk, lid);
      purged.push([x, y, z]);
    }
  }
  if (purged.length && kept.size) {
    const purgedSet = new Set(purged.map(([x, y, z]) => key(x, y, z)));
    const queue = [];
    for (const [x, y, z] of purged) {
      const lid = lidOf.get(key(x, y, z));
      for (const [dx, dy, dz] of LIQUID_ALL_NB) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0) continue;
        const nk = key(nx, ny, nz);
        if (purgedSet.has(nk) || !kept.has(nk)) continue;
        if (getBlock(nx, ny, nz) !== lid) continue;
        queue.push([x, y, z]);
        break;
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y, z] = queue[i];
      const kk = key(x, y, z);
      if (!purgedSet.has(kk)) continue;
      purgedSet.delete(kk);
      const lid = lidOf.get(kk);
      for (const [dx, dy, dz] of LIQUID_ALL_NB) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0) continue;
        const nk = key(nx, ny, nz);
        if (!purgedSet.has(nk)) continue;
        if (getBlock(nx, ny, nz) !== lid) continue;
        queue.push([nx, ny, nz]);
      }
    }
    return purged.filter(([x, y, z]) => purgedSet.has(key(x, y, z)));
  }
  return purged;
}

// Per-stroke cell union for the deferred liquid purge (three-free).
// Chain holds accumulate every tick's touched cells and validate once, at
// release: re-flooding the growing stroke mass every tick froze the frame
// (quadratic), while one end-of-stroke flood over the union is linear.
// One stroke at a time; a dimension change mid-stroke drops the union
// (coordinates are meaningless across dimensions — same leak profile as
// the old per-tick purge after travel, but never a corrupt write).
export function createStrokeUnion() {
  return { dim: null, seen: new Set(), cells: [] };
}
export function noteStrokeCells(u, dim, cells) {
  if (u.dim === null) u.dim = dim;
  if (u.dim !== dim) {
    u.dim = dim;
    u.seen = new Set();
    u.cells = [];
  }
  for (const [x, y, z] of cells) {
    const k = key(x, y, z);
    if (u.seen.has(k)) continue;
    u.seen.add(k);
    u.cells.push([x, y, z]);
  }
}
// Drains the union (release or world reset); the caller purges it — or
// drops it on reset, when the voxels are rebuilt anyway.
export function takeStrokeUnion(u) {
  const out = u.cells;
  u.cells = [];
  u.seen = new Set();
  u.dim = null;
  return out;
}
