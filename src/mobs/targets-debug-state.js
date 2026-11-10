// Target debug state: the C-key flow, three-free (no THREE), so the
// selection math and the transitions are headless-testable.
//
// Flow: idle -> selecting (C held on a block) -> armed (the target is
// built) -> active (a mob walks the plan). A C press while active
// cancels everything and starts over; the next press picks a new target.
//
// The selection is a CORNER-TO-CORNER box: the block the C press landed
// on is the first corner, the cell under the cursor is the second, and
// the selection is the axis-aligned box between them. It grows with the
// cursor in every direction, from any first aim (a floor, a wall, a
// ceiling), and there is no per-axis rule.
//
// The target kind follows the SHAPE of the box: one cell is a block, a
// flat box (one axis without extent) is an area on that axis, anything
// thicker is a volume.
import { createTarget } from "./targets.js";

export const PHASE = {
  IDLE: "idle",
  SELECTING: "selecting",
  ARMED: "armed",
  ACTIVE: "active",
};

// The debug greens: every selection (a block, an area, a volume) is one
// translucent green box at the overlay opacity, outlined by its 12
// subtle edges, the path keeps the same translucent green, and the mob
// itself is painted opaque so it reads as "this one".
export const TINT = {
  green: 0x33ff66,
  overlayOpacity: 0.45,
  edgeColor: 0x33ff66,
  edgeOpacity: 0.6,
  mobOpacity: 1,
};

export function createDebugState() {
  return {
    phase: PHASE.IDLE,
    start: null,
    hit: null,
    target: null,
    mob: null,
    path: null,
    // The path is drawn as floor squares while the mob walks, and as
    // cubes when it moves in 3D (the plan says which).
    pathFlat: true,
  };
}

// Start a selection on the aimed block: it is the first corner.
export function startSelection(state, hit) {
  if (!hit) return false;
  state.phase = PHASE.SELECTING;
  state.start = { x: hit.x, y: hit.y, z: hit.z };
  state.hit = { x: hit.x, y: hit.y, z: hit.z };
  state.target = null;
  state.mob = null;
  state.path = null;
  return true;
}

// Move the second corner to the aimed cell.
export function updateSelection(state, hit) {
  if (state.phase !== PHASE.SELECTING || !hit) return false;
  state.hit = { x: hit.x, y: hit.y, z: hit.z };
  return true;
}

// The bounds of the box between the two corners.
export function selectionBounds(state) {
  if (!state.start || !state.hit) return null;
  const { lo, hi } = bounds(state);
  return { lo, hi };
}

// The bounds of the box between the two corners.
function bounds(state) {
  const a = state.start;
  const b = state.hit;
  return {
    lo: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    hi: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

// A checksum over a cell list: the overlay change detection has to catch
// a reshape that keeps the cell count and the first cell.
export function cellChecksum(cells) {
  let h = 2166136261;
  for (const c of cells) {
    h = Math.imul(h ^ c.x, 16777619);
    h = Math.imul(h ^ c.y, 16777619);
    h = Math.imul(h ^ c.z, 16777619);
  }
  return h >>> 0;
}

// The selected cells: the whole box between the two corners. There is no
// size limit — a selection is never refused, however big the box.
export function selectionCells(state) {
  if (!state.start || !state.hit) return [];
  const { lo, hi } = bounds(state);
  const cells = [];
  for (let x = lo.x; x <= hi.x; x++) {
    for (let y = lo.y; y <= hi.y; y++) {
      for (let z = lo.z; z <= hi.z; z++) {
        cells.push({ x, y, z });
      }
    }
  }
  return cells;
}

// The kind the selection builds: a block (one cell), an area (a flat box
// on one axis) or a volume (a box with depth).
export function selectionKind(state) {
  if (!state.start || !state.hit) return null;
  const { lo, hi } = bounds(state);
  const span = { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z };
  if (!span.x && !span.y && !span.z) return "block";
  if (!span.x || !span.y || !span.z) return "area";
  return "volume";
}

// Close the selection: the target follows the shape of the box.
// Returns the target, or null when there is nothing selected.
export function closeSelection(state) {
  if (state.phase !== PHASE.SELECTING) return null;
  const cells = selectionCells(state);
  if (!cells.length) return null;
  const kind = selectionKind(state);
  if (kind === "block") {
    const c = cells[0];
    state.target = createTarget("block", { x: c.x, y: c.y, z: c.z });
  } else if (kind === "area") {
    const { lo, hi } = bounds(state);
    // The flat axis: the one the box has no extent on.
    const axis = lo.x === hi.x ? "x" : (lo.y === hi.y ? "y" : "z");
    state.target = createTarget("area", {
      axis,
      x0: lo.x, y0: lo.y, z0: lo.z,
      x1: hi.x, y1: hi.y, z1: hi.z,
    });
  } else {
    state.target = createTarget("volume", { cells });
  }
  state.phase = PHASE.ARMED;
  return state.target;
}

// Cancel everything: no target, no mob, no plan.
export function cancelDebugState(state) {
  state.phase = PHASE.IDLE;
  state.start = null;
  state.hit = null;
  state.target = null;
  state.mob = null;
  state.path = null;
  return state;
}
