// Vessel bbox support geometry (three-free): the pure pose/stop rules the
// flight loop runs every substep, parameterized by a cell reader so the
// headless suite drives them on stub voxel maps. The carve cell sets stay
// `sweptBoxCells` (level flight/climb) and `terminalCarveBox` (descent x/z
// clamp to the posed box) in src/world/rocketpad.js — this module owns the
// contact tests around them, plus the body-overlap cell set behind the
// landing passenger clearance (player + riders).
import { AIR } from "../core/blocks.js";

// Any non-air block in the vessel footprint (tight box, no fringe) at one
// row: the pose contact the flight loop reads. Solids, liquids and flowers
// all count — the stop rule fires on contact, whatever holds the ship.
export function footprintTouches(getBlock, ox, oz, vbox, row) {
  const fx = Math.floor(ox), fz = Math.floor(oz);
  for (let lx = vbox.x0; lx <= vbox.x1; lx++)
    for (let lz = vbox.z0; lz <= vbox.z1; lz++)
      if (getBlock(fx + lx, row, fz + lz) !== AIR) return true;
  return false;
}

// Vertical gap below the bbox over the whole footprint: for each footprint
// column, the distance from the float bottom down to the top of the highest
// non-air cell within maxD below (same non-air rule as the contact tests —
// solids, liquids and flowers all count). Returns the min over columns,
// Infinity when no column finds a surface in range. The flight loop reads it
// on descent so the cap eases back ahead of contact, not on it.
export function gapBelowFootprint(getBlock, ox, oyBottom, oz, vbox, maxD = 50) {
  const fx = Math.floor(ox), fz = Math.floor(oz);
  const base = Math.floor(oyBottom);
  let best = Infinity;
  for (let lx = vbox.x0; lx <= vbox.x1; lx++)
    for (let lz = vbox.z0; lz <= vbox.z1; lz++) {
      const x = fx + lx, z = fz + lz;
      for (let d = 1; d <= maxD; d++) {
        if (getBlock(x, base - d, z) !== AIR) {
          const gap = oyBottom - (base - d + 1);
          if (gap < best) best = gap;
          break;
        }
      }
    }
  return best;
}
// Stop rule: >= 1 footprint cell with a != air block directly under the
// bbox bottom. Priority over the carve — the ship poses on first contact
// instead of crushing what it would land on. Ascent-exempt by the caller
// (the liftoff pad stays under the hull while it climbs).
export function stopBelow(getBlock, ox, oy, oz, vbox) {
  return footprintTouches(getBlock, ox, oz, vbox, Math.floor(oy + vbox.y0) - 1);
}

// Debris spawn box (three-free): the union of the vessel box and a cube of
// half-extent `half` around the player's cell — any hull thinner than the
// debris box still spawns its carve all around the pilot instead of inside
// the camera, big hulls keep their own volume. Hull-local cells, floored
// like the swept box.
export function debrisSpawnBox(vbox, ox, oy, oz, px, py, pz, half) {
  const h = Math.max(0, half);
  const lx = Math.floor(px - ox), ly = Math.floor(py - oy), lz = Math.floor(pz - oz);
  const c = Math.ceil(h);
  return {
    x0: Math.min(vbox.x0, lx - c),
    x1: Math.max(vbox.x1, lx + c),
    y0: Math.min(vbox.y0, ly - c),
    y1: Math.max(vbox.y1, ly + c),
    z0: Math.min(vbox.z0, lz - c),
    z1: Math.max(vbox.z1, lz + c),
  };
}
// The exact overlap rule behind `intersectsPlayer` (player/edit.js),
// shared so the landing clearance carves the same set the physics would
// collide with. Strict inequalities: a body face exactly
// the physics would collide with. Strict inequalities: a body face exactly
// on a cell border does not enter that cell.
export function bodyOverlapCells(px, py, pz, hw, h) {
  const cells = [];
  for (let x = Math.floor(px - hw); x <= Math.ceil(px + hw) - 1; x++)
    for (let y = Math.floor(py); y <= Math.ceil(py + h) - 1; y++)
      for (let z = Math.floor(pz - hw); z <= Math.ceil(pz + hw) - 1; z++) {
        if (x + 1 > px - hw && x < px + hw && z + 1 > pz - hw && z < pz + hw && y + 1 > py && y < py + h)
          cells.push([x, y, z]);
      }
  return cells;
}
