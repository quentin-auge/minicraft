// Grid ray-walking (three-free): single steps plus capped walks between
// cells. The hold-chain sweeps interpolate between distant aim samples with
// these instead of dotting them, so a far stroke covers every cell along its
// path — a few dozen per tick, never a whole body at once.
import { AIR } from "./blocks.js";

export function lineStep(fx, fy, fz, dx, dy, dz) {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const tMx = ux > 0 ? 0.5 / ux : ux < 0 ? 0.5 / -ux : Infinity;
  const tMy = uy > 0 ? 0.5 / uy : uy < 0 ? 0.5 / -uy : Infinity;
  const tMz = uz > 0 ? 0.5 / uz : uz < 0 ? 0.5 / -uz : Infinity;
  let nx = fx, ny = fy, nz = fz;
  if (tMy < tMx && tMy < tMz) ny += uy > 0 ? 1 : -1;
  else if (tMz < tMx) nz += uz > 0 ? 1 : -1;
  else nx += ux > 0 ? 1 : -1;
  return [nx, ny, nz];
}

// Stroke anchor gate for remote work: a sample passes when it sits near
// the stroke history, or on a celestial body the stroke already touches.
// The range-4 history gate alone drops every sample at planet range (one
// pixel = tens of voxels), while same-body contiguity keeps teleports
// (moon -> planet) gated: crossing the void lifts the pen instead.
export function strokeGatePass(nearHistory, bodyKey, bodyAnchors) {
  if (nearHistory) return true;
  return bodyKey !== null && bodyKey !== undefined && bodyAnchors.has(bodyKey);
}

// Paint support: a walk cell over bare void would place a floater (chords
// cut the body's curvature between distant samples — notably glowstone).
// Supported = a non-air 6-neighbour, or sitting on/inside a body volume
// (near-surface chord cells pass; far void doesn't). Pure + tested; the
// caller injects getBlock.
export function hasSupport(getBlock, x, y, z) {
  return (
    getBlock(x + 1, y, z) !== AIR || getBlock(x - 1, y, z) !== AIR ||
    getBlock(x, y + 1, z) !== AIR || getBlock(x, y - 1, z) !== AIR ||
    getBlock(x, y, z + 1) !== AIR || getBlock(x, y, z - 1) !== AIR
  );
}

// Paint gate for one walk cell: handled or supported cells always pass; the
// body-volume clause only applies while the body is UNBUILT (built bodies
// answer from real voxels — otherwise chords seed floaters that validate
// each other). Teleports stay gated by strokeGatePass upstream.
export function cellPaintable(supported, bodyKey, built, bodyAnchors, handled) {
  if (handled || supported) return true;
  return !built && bodyKey !== null && bodyKey !== undefined && bodyAnchors.has(bodyKey);
}

// Cells from `from` (exclusive) toward `to` (inclusive), at most `max`.
// Stops at `to`; the cap keeps far-apart inputs from running away — the
// caller resumes next tick (progressive growth).
export function walkCells(from, to, max) {
  const out = [];
  let cx = from[0], cy = from[1], cz = from[2];
  let guard = Math.max(0, max | 0);
  while (guard-- > 0) {
    if (cx === to[0] && cy === to[1] && cz === to[2]) break;
    const n = lineStep(cx, cy, cz, to[0] - cx, to[1] - cy, to[2] - cz);
    if (!n) break;
    cx = n[0];
    cy = n[1];
    cz = n[2];
    out.push([cx, cy, cz]);
  }
  return out;
}
