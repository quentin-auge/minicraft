// Ultra wipe volumes: every ultra blast carves one zone-shaped volume — an
// overworld band box (ground, clouds), one ball per celestial body, a fixed
// level box (End, Nether) or the ignition-centered TNT cube (streaming TNT
// sky). One shared margin pads every natural extent so worldgen spill (tree
// canopies, cloud puffs, volcano bridges and islets) is caught, and every
// fixed box reaches down to ULTRA_Y_LO so nothing hides under a platform.
// y = 0 itself always stays spared — that is the carve rule in tnt.js, in
// every dimension.
// Three-free: the headless suite imports this without three.
import { WORLD_RADIUS } from "../core/store.js";
import { CLOUD_MAX_Y } from "./clouds.js";

// Overworld band ids: 1 ground, 2 clouds (celestial bands resolve to balls
// via the caller, sky gaps to null).
export const ULTRA_BAND1_HI = 90;
export const ULTRA_BAND2_HI = CLOUD_MAX_Y + 1;

// Single margin around every natural extent, in blocks.
export const ULTRA_MARGIN = 20;
// Fixed boxes reach this far down so under-platform blocks are cleaned.
export const ULTRA_Y_LO = -20;

// Volume shapes: level boxes, the ignition-centered TNT cube, and celestial
// balls ({ shape: "ball", cx, cy, cz, r }).
// { shape: "box", x0, x1, y0, y1, z0, z1 }

// Ground band: terrain (clamped to 70 by the generator, trees to ~107)
// plus margin — whole trees go with no overhang pass.
export function groundBox() {
  const H = WORLD_RADIUS + ULTRA_MARGIN;
  return { shape: "box", x0: -H, x1: H, y0: ULTRA_Y_LO, y1: ULTRA_BAND1_HI + ULTRA_MARGIN, z0: -H, z1: H };
}

// Cloud band: decks spill a few blocks past either end, hence the margin
// on both the XZ footprint and the Y range.
export function cloudBox() {
  const H = WORLD_RADIUS + ULTRA_MARGIN;
  return {
    shape: "box",
    x0: -H, x1: H,
    y0: ULTRA_BAND1_HI + 1 - ULTRA_MARGIN, y1: ULTRA_BAND2_HI + ULTRA_MARGIN,
    z0: -H, z1: H,
  };
}

// Streaming TNT sky: no fixed level, so the cube centers on the ignition.
export function tntCube(cx, cy, cz, half) {
  return {
    shape: "box",
    x0: cx - half, x1: cx + half,
    y0: cy - half, y1: cy + half,
    z0: cz - half, z1: cz + half,
  };
}

// Fixed level boxes (End/Nether): extents owned by the dimension modules,
// passed through their registry spec.
export function fixedBox(spec) {
  return {
    shape: "box",
    x0: -spec.half, x1: spec.half,
    y0: spec.y0, y1: spec.y1,
    z0: -spec.half, z1: spec.half,
  };
}

// Celestial ball for one body spec ({ cx, cz, top, bottom, r }): the disc
// plus the dome half-height, padded by the shared margin — face-adjacent
// placements (up to 2 blocks off the voxels) read as inside with room.
export function bodyBall(b) {
  const cy = (b.top + b.bottom) / 2;
  const r = Math.ceil(Math.hypot(b.r, (b.top - b.bottom) / 2)) + ULTRA_MARGIN;
  return { shape: "ball", cx: b.cx, cy, cz: b.cz, r };
}

// Column footprint of a volume, sorted from (ox, oz) so the wipe reads as
// an expanding front. Empty columns are pruned through `has` (a placed block
// landing in a pruned column mid-wipe survives — negligible): it drops the
// world-border fringe and ball rims that would otherwise eat drain quota,
// dirty tracking and remeshes for nothing.
export function footprintCols(vol, ox, oz, has) {
  const cols = [];
  if (vol.shape === "ball") {
    const rr = Math.ceil(vol.r);
    const R2 = vol.r * vol.r;
    for (let x = Math.floor(vol.cx - rr); x <= Math.ceil(vol.cx + rr); x++) {
      for (let z = Math.floor(vol.cz - rr); z <= Math.ceil(vol.cz + rr); z++) {
        const dx = x - vol.cx, dz = z - vol.cz;
        if (dx * dx + dz * dz > R2) continue;
        if (has && !has(x, z)) continue;
        cols.push([(x - ox) * (x - ox) + (z - oz) * (z - oz), x, z]);
      }
    }
  } else {
    for (let x = vol.x0; x <= vol.x1; x++) {
      for (let z = vol.z0; z <= vol.z1; z++) {
        if (has && !has(x, z)) continue;
        const dx = x - ox, dz = z - oz;
        cols.push([dx * dx + dz * dz, x, z]);
      }
    }
  }
  cols.sort((a, b) => a[0] - b[0]);
  return cols;
}

// Band-drain pacing, single fast path: column floor + cap, no cell budget,
// hard ms deadline, and jump-start size (nearest chunks carved + remeshed
// synchronously at detonation, mega-pool style). Tuned once here instead
// of a live switch: wipes always spend frames to finish fast.
export const BAND_DRAIN_MODES = [
  { key: "max", colFloor: 2048, colCap: 8192, cellBudget: Infinity, ms: 48, jumpChunks: 32, jumpMs: 1000 },
];
export function bandDrainMode() {
  return BAND_DRAIN_MODES[0];
}

// Instance filtering for celestial wipes (three-free, headless-tested):
// split instance cells into kept/removed against a wipe ball. Removing
// exactly the inside cells reproduces the rebuild bit-for-bit when no kept
// cell can gain a newly-exposed face, pocket or tint — guaranteed when every
// kept cell sits more than 2 blocks past the ball surface (celestial balls
// are sky-isolated; ground bands and level boxes never qualify). Callers
// fall back to a full rebuild when exact is false.
export function selectBallInstances(cells, ball) {
  const r2 = ball.r * ball.r;
  const pad = ball.r + 2;
  const pad2 = pad * pad;
  const keep = [];
  let exact = true;
  for (let i = 0; i < cells.length; i++) {
    const dx = cells[i][0] - ball.cx, dy = cells[i][1] - ball.cy, dz = cells[i][2] - ball.cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) {
      keep.push(i);
      if (d2 <= pad2) exact = false;
    }
  }
  return { keep, exact };
}

// Central dispatch: celestial balls (resolved by the caller, which owns the
// body lookup), overworld band boxes, fixed level boxes (spec), or the TNT
// ignition cube. Bands win over the fallback cube: dimension defaults carry
// a cubeR that must never shadow an explicit band box. Unknown celestial
// bands (sky gaps) resolve to null — no wipe.
export function ultraVolumeFor({ u, band, body, cx, cy, cz }) {
  if (body) return bodyBall(body);
  if (u.bands && (band === 1 || band === 2)) return band === 2 ? cloudBox() : groundBox();
  if (typeof band === "string") return null;
  if (u.box) return fixedBox(u.box);
  if (u.cubeR != null) return tntCube(cx, cy, cz, u.cubeR);
  return null;
}

export function volumeContains(vol, x, y, z) {
  if (vol.shape === "ball") {
    const dx = x - vol.cx, dy = y - vol.cy, dz = z - vol.cz;
    return dx * dx + dy * dy + dz * dz <= vol.r * vol.r;
  }
  return x >= vol.x0 && x <= vol.x1 && y >= vol.y0 && y <= vol.y1 && z >= vol.z0 && z <= vol.z1;
}

// Bounding radius for lights, shells and shake: half the box diagonal,
// the ball radius.
export function boundingR(vol) {
  if (vol.shape === "ball") return vol.r;
  return Math.sqrt(
    (vol.x1 - vol.x0) * (vol.x1 - vol.x0) +
    (vol.y1 - vol.y0) * (vol.y1 - vol.y0) +
    (vol.z1 - vol.z0) * (vol.z1 - vol.z0)
  ) / 2;
}
