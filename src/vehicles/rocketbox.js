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

// Stop rule: >= 1 footprint cell with a != air block directly under the
// bbox bottom. Priority over the carve — the ship poses on first contact
// instead of crushing what it would land on. Ascent-exempt by the caller
// (the liftoff pad stays under the hull while it climbs).
export function stopBelow(getBlock, ox, oy, oz, vbox) {
  return footprintTouches(getBlock, ox, oz, vbox, Math.floor(oy + vbox.y0) - 1);
}

// Integer cells intersecting a body AABB (feet px,py,pz, half-width hw,
// height h) — the exact overlap rule behind `intersectsPlayer`
// (player/edit.js), shared so the landing clearance carves the same set
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
