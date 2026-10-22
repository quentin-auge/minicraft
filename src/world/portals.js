// Registry-driven portals. Each family declares a destination dimension:
// End, Nether, and TNT frames cross to it from anywhere, and return to the
// Overworld when already in it (the End return fill lights only once the
// dragon-cleared gate opens). Families share frame validation, fills, travel
// spiral, grapple interaction, and per-dimension frame indexing. A
// dimension's exits gate (DIMENSIONS exitsGate) closes every portal in it:
// validated windows stay overlap-testable in portalWindows and any touch
// answers the gate message instead of traveling.
//
// Cross-dimension travel remembers the portal left in the source dimension
// (travelLinks, one per dimension). Arriving back in a dimension uses that
// portal when it still validates and places the player where the portal is
// visible: orthogonal spots 4 blocks out first (4,5,3,6,2,7,1,8, with small
// lateral sweeps and height +0/+1/+2 not counted; the portal's own ground
// sweeps every face and side before any other height), then the same sweep
// snapped to each column's real support top, then standing on the frame,
// then any visible spot within 16. Overworld arrivals face the portal,
// every other dimension
// arrives with its back to it; otherwise the destination spawn is used.
//
// Extension shape: PORTAL_TYPES is the registry; the engine below never
// switches on family names, it dispatches through the spec's props —
// destination/anchorsFrom/evaluate/cells/bbox/inside/travel/art/color. New families
// (new frame block, sizes, fill, destination, travel action) register a spec
// and nothing else changes.
import * as THREE from "three";
import { AIR, PORTAL, OBSIDIAN, TNT, MEGA_TNT, ULTRA_TNT, isLiquid } from "../core/blocks.js";
import { materialsFor } from "../core/textures.js";
import { DIMENSION_KEYS, dim, dimBound, key, keyXYZ, getBlock, isSolid } from "../core/store.js";
import { dimFloorY, dimSpec } from "./dimensions.js";
import { registerHaloSource } from "../render/halobake.js";
import {
  pos, yaw, keys,
  PLAYER_HW, PLAYER_H, EYE,
} from "../player/physics.js";

export const PORTAL_TYPES = [
  {
    key: "end", destination: "end", enterMsg: "You entered The End",
    frame: PORTAL, fillColor: 0x000000, tunnel: "#6d28d9",
    *anchorsFrom(px, py, pz) { yield* endVerticalAnchors(px, py, pz); yield* endFlatAnchors(px, py, pz); },
    evaluate(w) { return evalEndWin(w); },
    cells: endFillCells,
    bbox: endBBox,
    inside: insideEndInterior,
    travel: destinationTravel,
    art: { host: "portalArt", cols: 5, rows: 5, stroke: "#7b2ff7", cells: buildSolidFrame(5, 5, PORTAL, true) },
  },
  {
    key: "nether", destination: "nether", enterMsg: "You entered The Nether",
    frame: OBSIDIAN, fillColor: 0x9b30ff, tunnel: "#1e40af",
    *anchorsFrom(px, py, pz) { yield* netherVerticalAnchors(px, py, pz); yield* netherFlatAnchors(px, py, pz); },
    evaluate(w) { return evalNetherWin(w); },
    cells: rectFillCells,
    bbox: rectBBox,
    inside: insideRectInterior,
    travel: destinationTravel,
    art: { host: "netherArt", cols: 5, rows: 4, stroke: "#8b90a0", cells: buildSolidFrame(5, 4, OBSIDIAN, false) },
  },
  {
    // TNT frame: a 4×4 square whose corners are mandatory and whose ring
    // mixes tiers — at least one mega and one ultra among the TNT blocks.
    key: "tnt", destination: "tnt", enterMsg: "You entered the TNT dimension",
    frame: [TNT, MEGA_TNT, ULTRA_TNT], fillColor: 0xd11a1a, tunnel: "#991b1b",
    *anchorsFrom(px, py, pz) { yield* tntVerticalAnchors(px, py, pz); yield* tntFlatAnchors(px, py, pz); },
    evaluate(w) { return evalTntWin(w); },
    cells: rectFillCells,
    bbox: rectBBox,
    inside: insideRectInterior,
    travel: destinationTravel,
    art: { host: "tntArt", cols: 4, rows: 4, width: 128, stroke: "#3a0d0d", cells: buildTntFrame() },
  },
];

const specByKey = new Map(PORTAL_TYPES.map((s) => [s.key, s]));
const specOf = (win) => specByKey.get(win.type);
// A spec's frame may be one id or a set (the TNT family spans its three tiers);
// frameSet indexes every frame block so scans only visit real candidates.
const frameIds = new Set();
for (const s of PORTAL_TYPES) for (const id of Array.isArray(s.frame) ? s.frame : [s.frame]) frameIds.add(id);
const isFrameBlock = (id) => frameIds.has(id);

// Index of every frame block, kept per dimension (block keys don't include
// the dim, and coordinates collide across dimensions).
const frameSets = Object.fromEntries(DIMENSION_KEYS.map((k) => [k, new Set()]));
export let portalDirty = true;

function trackFrame(x, y, z, id) {
  const k = key(x, y, z);
  const set = frameSets[dim];
  if (isFrameBlock(id)) set.add(k);
  else set.delete(k);
}

export function notePortalEdit(x, y, z) {
  trackFrame(x, y, z, getBlock(x, y, z));
  portalDirty = true;
  // Same-frame pop at any distance: placement reach is unlimited, so the
  // player-centered scan would miss a far window until approached.
  refreshPortalFills(x, y, z);
}

// Band-wipe fast path: track frames exactly like notePortalEdits but skip
// the per-cell fill refresh (thousands of redundant R=12 window evaluations
// per carve slice); the periodic scanner heals fills from the dirty flag.
export function notePortalFramesOnly(coords) {
  if (!coords) return;
  for (const [x, y, z] of coords) trackFrame(x, y, z, getBlock(x, y, z));
  portalDirty = true;
}

export function notePortalEdits(coords) {
  if (!coords) return;
  const seen = new Set();
  for (const [x, y, z] of coords) {
    trackFrame(x, y, z, getBlock(x, y, z));
    const k = x + "," + y + "," + z;
    if (seen.has(k)) continue;
    seen.add(k);
    refreshPortalFills(x, y, z);
  }
  portalDirty = true;
}

// Baked-halo source: every portal frame in the Nether tints its neighbors
// with its family color, so all Nether frames read lit with no dynamic light
// involved (see render/halobake.js). Other dimensions keep dark frames —
// the requirement is Nether-only.
const frameColorById = new Map();
for (const s of PORTAL_TYPES) {
  const hex = parseInt(s.tunnel.slice(1), 16);
  for (const id of Array.isArray(s.frame) ? s.frame : [s.frame]) frameColorById.set(id, hex);
}
const NO_FRAMES = new Set();
registerHaloSource({
  key: "portalframe",
  radius: 8, // blocks, Euclidean cutoff (same tune as glowstone)
  gain: 2.0, // adjacent-block lift
  max: 3, // per-channel clamp against overlap blowout
  positions: (name) => (name === "nether" ? frameSets.nether || NO_FRAMES : NO_FRAMES),
  // getBlock reads the active dimension, which is the baked one: the mesher
  // only rebuilds chunks of the dimension being played. Unknown ids (stale
  // index) fall back to white: a neutral lift with no hue.
  colorOf: (name, k) => {
    const [x, y, z] = keyXYZ(k);
    return frameColorById.get(getBlock(x, y, z)) ?? 0xffffff;
  },
});

// Worldgen-placed frames, keyed by the generator (live edits track
// themselves via trackFrame, so a clear plus this list is exact). Scoped to
// the active dimension; dimension switches clear fills and rescan.
export function resetFrameSet(keys) {
  frameSets[dim].clear();
  for (const k of keys) frameSets[dim].add(k);
  portalDirty = true;
  // A fresh world releases any in-flight travel lock with it.
  portalBusy = false;
  portalCd = 0;
}

// --- Window evaluation (shapes from master) ---
//
// A window is edge-valid when its ring matches; its interior must be
// uniformly AIR or uniformly one liquid (a portal filled with water, lava,
// or moon water is legit; a mix, or any solid — including frame blocks —
// is not). Evaluators return null, or true.

function innerCell(id, mix) {
  if (id !== AIR && !isLiquid(id)) return false;
  if (mix.id === null) mix.id = id;
  else if (id !== mix.id) return false;
  return true;
}

function evalEndFlat(minX, minZ, by) {
  const mix = { id: null };
  for (let x = minX; x <= minX + 4; x++)
    for (let z = minZ; z <= minZ + 4; z++) {
      const isCorner = (x === minX || x === minX + 4) && (z === minZ || z === minZ + 4);
      const isEdge = x === minX || x === minX + 4 || z === minZ || z === minZ + 4;
      const id = getBlock(x, by, z);
      if (isCorner) continue;
      if (isEdge) {
        if (id !== PORTAL) return null;
      } else if (!innerCell(id, mix)) return null;
    }
  return true;
}

function evalEndVert(minX, minY, minZ, h, face = "z") {
  const mix = { id: null };
  const top = h === 4 ? minY + 3 : minY + 4;
  if (face === "x") {
    for (let y = minY; y <= top; y++)
      for (let z = minZ; z <= minZ + 4; z++) {
        const isCorner = (z === minZ || z === minZ + 4) && (y === minY || y === top);
        const isEdge = z === minZ || z === minZ + 4 || y === minY || y === top;
        const id = getBlock(minX, y, z);
        if (isCorner) continue;
        if (isEdge) {
          if (id !== PORTAL) return null;
        } else if (!innerCell(id, mix)) return null;
      }
    return true;
  }
  for (let y = minY; y <= top; y++)
  for (let x = minX; x <= minX + 4; x++) {
    const isCorner = (x === minX || x === minX + 4) && (y === minY || y === top);
    const isEdge = x === minX || x === minX + 4 || y === minY || y === top;
    const id = getBlock(x, y, minZ);
    if (isCorner) continue;
    if (isEdge) {
      if (id !== PORTAL) return null;
    } else if (!innerCell(id, mix)) return null;
  }
  return true;
}

function evalNetherVert(minX, minY, minZ, w, h, face) {
  const mix = { id: null };
  for (let y = minY; y < minY + h; y++)
    for (let u = 0; u < w; u++) {
      const isEdge = u === 0 || u === w - 1 || y === minY || y === minY + h - 1;
      const x = face === "x" ? minX : minX + u;
      const z = face === "x" ? minZ + u : minZ;
      const id = getBlock(x, y, z);
      if (isEdge) {
        if (id !== OBSIDIAN) return null;
      } else if (!innerCell(id, mix)) return null;
    }
  return true;
}

function evalNetherFlat(minX, minZ, by, ww, dd) {
  const mix = { id: null };
  for (let x = minX; x <= minX + ww - 1; x++)
    for (let z = minZ; z <= minZ + dd - 1; z++) {
      const isEdge = x === minX || x === minX + ww - 1 || z === minZ || z === minZ + dd - 1;
      const id = getBlock(x, by, z);
      if (isEdge) {
        if (id !== OBSIDIAN) return null;
      } else if (!innerCell(id, mix)) return null;
    }
  return true;
}

function evalEndWin(w) {
  if (w.orient === "v") return evalEndVert(w.minX, w.minY, w.minZ, w.h === 4 ? 4 : 5, w.face === "x" ? "x" : "z");
  return evalEndFlat(w.minX, w.minZ, w.minY);
}

function evalNetherWin(w) {
  if (w.orient === "v") {
    const ww = w.dims === "4x5" || w.dims === "4x4" ? 4 : 5;
    const hh = w.dims === "4x5" ? 5 : 4;
    return evalNetherVert(w.minX, w.minY, w.minZ, ww, hh, w.face === "x" ? "x" : "z");
  }
  const ww = w.dims === "4x5" ? 4 : 5, dd = w.dims === "4x5" ? 5 : 4;
  return evalNetherFlat(w.minX, w.minZ, w.minY, ww, dd);
}

// TNT frame: 4×4 ring of TNT blocks, corners required, interior uniform
// AIR/one liquid, and at least one mega plus one ultra on the ring.
function tntRingCell(id, tally) {
  if (id === MEGA_TNT) tally.mega++;
  else if (id === ULTRA_TNT) tally.ultra++;
  else if (id !== TNT) return false;
  return true;
}

function evalTntVert(minX, minY, minZ, face) {
  const mix = { id: null }, tally = { mega: 0, ultra: 0 };
  for (let y = minY; y < minY + 4; y++)
    for (let u = 0; u < 4; u++) {
      const isEdge = u === 0 || u === 3 || y === minY || y === minY + 3;
      const x = face === "x" ? minX : minX + u;
      const z = face === "x" ? minZ + u : minZ;
      const id = getBlock(x, y, z);
      if (isEdge) { if (!tntRingCell(id, tally)) return null; }
      else if (!innerCell(id, mix)) return null;
    }
  return tally.mega >= 1 && tally.ultra >= 1;
}

function evalTntFlat(minX, minZ, by) {
  const mix = { id: null }, tally = { mega: 0, ultra: 0 };
  for (let x = minX; x < minX + 4; x++)
    for (let z = minZ; z < minZ + 4; z++) {
      const isEdge = x === minX || x === minX + 3 || z === minZ || z === minZ + 3;
      const id = getBlock(x, by, z);
      if (isEdge) { if (!tntRingCell(id, tally)) return null; }
      else if (!innerCell(id, mix)) return null;
    }
  return tally.mega >= 1 && tally.ultra >= 1;
}

function evalTntWin(w) {
  if (w.orient === "v") return evalTntVert(w.minX, w.minY, w.minZ, w.face === "x" ? "x" : "z");
  return evalTntFlat(w.minX, w.minZ, w.minY);
}

function forEachFrameBlockNear(bx, by, bz, R, fn) {
  for (const pk of frameSets[dim]) {
    const [px, py, pz] = keyXYZ(pk);
    if (Math.abs(px - bx) > R || Math.abs(py - by) > R || Math.abs(pz - bz) > R) continue;
    fn(px, py, pz);
  }
}

function* endVerticalAnchors(px, py, pz) {
  for (const h of [5, 4]) {
    for (let wy = py - h + 1; wy <= py; wy++) {
      yield { orient: "v", h, minX: px, minY: wy, minZ: pz };
      yield { orient: "v", h, minX: px - 4, minY: wy, minZ: pz };
    }
    for (let wx = px - 4; wx <= px; wx++) {
      yield { orient: "v", h, minX: wx, minY: py, minZ: pz };
      yield { orient: "v", h, minX: wx, minY: py - (h - 1), minZ: pz };
    }
    for (let wy = py - h + 1; wy <= py; wy++) {
      yield { orient: "v", h, face: "x", minX: px, minY: wy, minZ: pz };
      yield { orient: "v", h, face: "x", minX: px, minY: wy, minZ: pz - 4 };
    }
    for (let wz = pz - 4; wz <= pz; wz++) {
      yield { orient: "v", h, face: "x", minX: px, minY: py, minZ: wz };
      yield { orient: "v", h, face: "x", minX: px, minY: py - (h - 1), minZ: wz };
    }
  }
}

function* endFlatAnchors(px, py, pz) {
  for (let wz = pz - 4; wz <= pz; wz++) {
    yield { orient: "h", minX: px, minY: py, minZ: wz };
    yield { orient: "h", minX: px - 4, minY: py, minZ: wz };
  }
  for (let wx = px - 4; wx <= px; wx++) {
    yield { orient: "h", minX: wx, minY: py, minZ: pz };
    yield { orient: "h", minX: wx, minY: py, minZ: pz - 4 };
  }
}

// Square 4×4 anchors (upright faces z/x + flat), tagged `dims` so the shared
// rectangular-frame geometry helpers size the 2×2 interior.
function* tntVerticalAnchors(px, py, pz) {
  const w = 4, h = 4, dims = "4x4";
  for (let wy = py - h + 1; wy <= py; wy++) {
    yield { orient: "v", face: "z", dims, minX: px, minY: wy, minZ: pz };
    yield { orient: "v", face: "z", dims, minX: px - (w - 1), minY: wy, minZ: pz };
  }
  for (let wx = px - w + 1; wx <= px; wx++) {
    yield { orient: "v", face: "z", dims, minX: wx, minY: py, minZ: pz };
    yield { orient: "v", face: "z", dims, minX: wx, minY: py - (h - 1), minZ: pz };
  }
  for (let wz = pz - w + 1; wz <= pz; wz++) {
    yield { orient: "v", face: "x", dims, minX: px, minY: py, minZ: wz };
    yield { orient: "v", face: "x", dims, minX: px, minY: py - (h - 1), minZ: wz };
  }
  for (let wy = py - h + 1; wy <= py; wy++) {
    yield { orient: "v", face: "x", dims, minX: px, minY: wy, minZ: pz };
    yield { orient: "v", face: "x", dims, minX: px, minY: wy, minZ: pz - (w - 1) };
  }
}

function* tntFlatAnchors(px, py, pz) {
  const w = 4, dims = "4x4";
  for (let wz = pz - w + 1; wz <= pz; wz++) {
    yield { orient: "h", dims, minX: px, minY: py, minZ: wz };
    yield { orient: "h", dims, minX: px - (w - 1), minY: py, minZ: wz };
  }
  for (let wx = px - w + 1; wx <= px; wx++) {
    yield { orient: "h", dims, minX: wx, minY: py, minZ: pz };
    yield { orient: "h", dims, minX: wx, minY: py, minZ: pz - (w - 1) };
  }
}

function* netherVerticalAnchors(px, py, pz) {
  const shapes = [
    { w: 5, h: 4, dims: undefined },
    { w: 4, h: 5, dims: "4x5" },
    { w: 4, h: 4, dims: "4x4" },
  ];
  for (const { w, h, dims } of shapes) {
    for (let wy = py - h + 1; wy <= py; wy++) {
      yield { orient: "v", face: "z", dims, minX: px, minY: wy, minZ: pz, w, h };
      yield { orient: "v", face: "z", dims, minX: px - (w - 1), minY: wy, minZ: pz, w, h };
    }
    for (let wx = px - w + 1; wx <= px; wx++) {
      yield { orient: "v", face: "z", dims, minX: wx, minY: py, minZ: pz, w, h };
      yield { orient: "v", face: "z", dims, minX: wx, minY: py - (h - 1), minZ: pz, w, h };
    }
    for (let wz = pz - w + 1; wz <= pz; wz++) {
      yield { orient: "v", face: "x", dims, minX: px, minY: py, minZ: wz, w, h };
      yield { orient: "v", face: "x", dims, minX: px, minY: py - (h - 1), minZ: wz, w, h };
    }
    for (let wy = py - h + 1; wy <= py; wy++) {
      yield { orient: "v", face: "x", dims, minX: px, minY: wy, minZ: pz, w, h };
      yield { orient: "v", face: "x", dims, minX: px, minY: wy, minZ: pz - (w - 1), w, h };
    }
  }
}

function* netherFlatAnchors(px, py, pz) {
  for (let wz = pz - 3; wz <= pz; wz++) {
    yield { orient: "h", dims: "5x4", minX: px, minY: py, minZ: wz };
    yield { orient: "h", dims: "5x4", minX: px - 4, minY: py, minZ: wz };
  }
  for (let wx = px - 4; wx <= px; wx++) {
    yield { orient: "h", dims: "5x4", minX: wx, minY: py, minZ: pz };
    yield { orient: "h", dims: "5x4", minX: wx, minY: py, minZ: pz - 3 };
  }
  for (let wz = pz - 4; wz <= pz; wz++) {
    yield { orient: "h", dims: "4x5", minX: px, minY: py, minZ: wz };
    yield { orient: "h", dims: "4x5", minX: px - 3, minY: py, minZ: wz };
  }
  for (let wx = px - 3; wx <= px; wx++) {
    yield { orient: "h", dims: "4x5", minX: wx, minY: py, minZ: pz };
    yield { orient: "h", dims: "4x5", minX: wx, minY: py, minZ: pz - 4 };
  }
}

// --- Window collection with support-closure ---
//
// Frames may cross orthogonally: a window's interior may hold frame blocks
// as long as every one of them belongs to another live window's ring.
// Candidates are enumerated from frame blocks (spec dispatch, no family
// switches), then pruned to the support-closed set: a candidate survives
// only while each interior frame cell is still some live candidate's ring
// cell. Breaking either ring of a cross drops both; repairing relights both.

function gatherFrom(px, py, pz, seen, out) {
  for (const spec of PORTAL_TYPES) {
    for (const a of spec.anchorsFrom(px, py, pz)) {
      const ev = spec.evaluate(a);
      if (!ev) continue;
      const win = Object.assign({ type: spec.key }, a);
      const k = fillKey(win);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ win, key: k });
    }
  }
}

function gatherNear(bx, by, bz, R) {
  const out = [];
  const seen = new Set();
  forEachFrameBlockNear(bx, by, bz, R, (px, py, pz) => gatherFrom(px, py, pz, seen, out));
  return out;
}

function gatherAll() {
  const out = [];
  const seen = new Set();
  for (const pk of frameSets[dim]) {
    const [x, y, z] = keyXYZ(pk);
    gatherFrom(x, y, z, seen, out);
  }
  return out;
}

// Interiors hold only AIR or one liquid (enforced per cell by the
// evaluators), so there is nothing left to support-close: every evaluated
// candidate stands on its own ring.
function resolveWindows(cands) {
  return cands;
}

function winNear(win, cx, cy, cz, R) {
  const b = portalFrameBBox(win);
  const dx = cx < b.minX ? b.minX - cx : cx > b.maxX ? cx - b.maxX : 0;
  const dz = cz < b.minZ ? b.minZ - cz : cz > b.maxZ ? cz - b.maxZ : 0;
  const dy = cy < b.baseY ? b.baseY - cy : cy > b.topY ? cy - b.topY : 0;
  return Math.max(dx, dz, dy) <= R;
}

function syncFills(accepted, cx, cy, cz, R) {
  // A closed exits gate is the one active gate: every family in the
  // dimension goes fillless (touched windows answer the gate instead).
  const gated = !!exitGateMsg();
  const active = gated ? []
    : accepted.filter((c) => specOf(c.win).active?.(c.win) !== false);
  const keys = new Set(active.map((c) => c.key));
  for (const [k, f] of portalFills) {
    if (!winNear(f.win, cx, cy, cz, R)) continue;
    if (!keys.has(k)) {
      sceneRef.remove(f.group);
      portalFills.delete(k);
      purgeFillFade(k);
    }
  }
  for (const c of active) {
    if (!winNear(c.win, cx, cy, cz, R)) continue;
    ensurePortalFill(c.win);
  }
  // Every validated window stays overlap-testable here: the active
  // dimension's exits gate answers a touch on any of them.
  const wkeys = new Set(accepted.map((c) => c.key));
  for (const [k, win] of portalWindows) {
    if (winNear(win, cx, cy, cz, R) && !wkeys.has(k)) portalWindows.delete(k);
  }
  for (const c of accepted) {
    if (!winNear(c.win, cx, cy, cz, R)) continue;
    portalWindows.set(c.key, c.win);
  }
}

function collectReturnWins(cx, cy, cz) {
  return resolveWindows(gatherNear(cx, cy, cz, 16)).map((c) => c.win);
}

// --- Fill meshes (one solid-color slab per live window) ---

const portalFillGeo = new THREE.BoxGeometry(1, 1, 1);
const fillMats = new Map();
function fillMat(spec) {
  if (!fillMats.has(spec.key)) {
    fillMats.set(spec.key, new THREE.MeshBasicMaterial({
      color: spec.fillColor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  }
  return fillMats.get(spec.key);
}

const portalFills = new Map(); // key -> { win, nether, group }
// Every validated window, fill-backed or not: while the active dimension's
// exits gate is closed, body overlap answers the gate instead of traveling.
const portalWindows = new Map(); // key -> win
let sceneRef = null;

export function initPortals(scene) {
  sceneRef = scene;
}

export function portalFillCells(win) {
  return specOf(win).cells(win);
}

// Pool-light anchors: one light at the middle of every validated window, so
// each portal reads lit with a single well-placed lamp instead of one per
// frame cell. Vertical windows light the opening's center; flat ones hover a
// cell above the ring (a light in the fill plane would sit inside blocks).
// Color is the family's tunnel color. Anchors are recomputed live, so the
// pool follows validation exactly: gate-closed windows lose fill and light
// together, broken rings go dark with the halo.
export function portalFrameLights() {
  const out = [];
  for (const win of portalWindows.values()) {
    const b = portalFrameBBox(win);
    const hex = parseInt(specOf(win).tunnel.slice(1), 16);
    if (win.orient === "h") {
      out.push({
        x: (b.minX + b.maxX) / 2 + 0.5,
        y: b.baseY + 1.5,
        z: (b.minZ + b.maxZ) / 2 + 0.5,
        color: hex,
      });
    } else {
      out.push({
        x: (b.minX + b.maxX) / 2 + 0.5,
        y: (b.baseY + b.topY) / 2 + 0.5,
        z: (b.minZ + b.maxZ) / 2 + 0.5,
        color: hex,
      });
    }
  }
  return out;
}

function endFillCells(win) {
  const cells = [];
  const push = (x, y, z) => cells.push([x, y, z]);
  if (win.orient === "v") {
    const top = win.h === 4 ? win.minY + 2 : win.minY + 3;
    if (win.face === "x") {
      for (let y = win.minY + 1; y <= top; y++)
        for (let z = win.minZ + 1; z <= win.minZ + 3; z++) push(win.minX, y, z);
    } else {
      for (let y = win.minY + 1; y <= top; y++)
        for (let x = win.minX + 1; x <= win.minX + 3; x++) push(x, y, win.minZ);
    }
  } else {
    for (let x = win.minX + 1; x <= win.minX + 3; x++)
      for (let z = win.minZ + 1; z <= win.minZ + 3; z++) push(x, win.minY, z);
  }
  return cells;
}

function rectFillCells(win) {
  const cells = [];
  const push = (x, y, z) => cells.push([x, y, z]);
  if (win.orient === "v") {
    if (win.face === "x") {
      const cy = { "4x5": 3, "4x4": 2 }[win.dims] || 2;
      const cz = win.dims === "4x5" || win.dims === "4x4" ? 2 : 3;
      for (let y = win.minY + 1; y <= win.minY + cy; y++)
        for (let z = win.minZ + 1; z <= win.minZ + cz; z++) push(win.minX, y, z);
    } else if (win.dims === "4x5") {
      for (let y = win.minY + 1; y <= win.minY + 3; y++)
        for (let x = win.minX + 1; x <= win.minX + 2; x++) push(x, y, win.minZ);
    } else if (win.dims === "4x4") {
      for (let y = win.minY + 1; y <= win.minY + 2; y++)
        for (let x = win.minX + 1; x <= win.minX + 2; x++) push(x, y, win.minZ);
    } else {
      for (let y = win.minY + 1; y <= win.minY + 2; y++)
        for (let x = win.minX + 1; x <= win.minX + 3; x++) push(x, y, win.minZ);
    }
  } else {
    const xw = win.dims === "4x4" ? 2 : win.dims === "4x5" ? 2 : 3;
    const xt = win.dims === "4x5" ? 3 : 2;
    for (let x = win.minX + 1; x <= win.minX + xw; x++)
      for (let z = win.minZ + 1; z <= win.minZ + xt; z++) push(x, win.minY, z);
  }
  return cells;
}

function portalFillBox(win) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [x, y, z] of specOf(win).cells(win)) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
  if (win.orient === "h") return { cx, cy, cz, sx: (x1 - x0 + 1), sy: 1, sz: (z1 - z0 + 1) };
  if (win.face === "x") return { cx, cy, cz, sx: 1, sy: (y1 - y0 + 1), sz: (z1 - z0 + 1) };
  return { cx, cy, cz, sx: (x1 - x0 + 1), sy: (y1 - y0 + 1), sz: 1 };
}

function layoutPortalFill(group, win) {
  const b = portalFillBox(win);
  const m = group.children[0];
  m.position.set(b.cx, b.cy, b.cz);
  m.scale.set(b.sx, b.sy, b.sz);
}

// Ray vs fill-slab box: standard per-axis slab test. Returns the entry
// distance plus the entry face normal (tip visual), or null on a miss.
function raySlabBox(origin, dir, b) {
  const lo = [b.cx - b.sx / 2, b.cy - b.sy / 2, b.cz - b.sz / 2];
  const hi = [b.cx + b.sx / 2, b.cy + b.sy / 2, b.cz + b.sz / 2];
  const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
  let tmin = -Infinity, tmax = Infinity;
  const face = [0, 1, 0];
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    const t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
    const tn = Math.min(t1, t2), tf = Math.max(t1, t2);
    if (tn > tmin) {
      tmin = tn;
      face[0] = 0; face[1] = 0; face[2] = 0;
      face[i] = d[i] > 0 ? -1 : 1;
    }
    if (tf < tmax) tmax = tf;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin === -Infinity) return { t: 0, face }; // origin inside the slab
  return { t: Math.max(tmin, 0), face };
}

// Grapple picker: the fills are visual meshes over AIR/liquid, not blocks,
// so the block DDA flies through them — this ray-tests the live slabs
// directly. Nearest slab wins; the descriptor carries the hit point, its
// player-facing normal, and the fill center the pull lands on (inside the
// fill, so the normal touch-travel fires on arrival).
export function pickPortalFill(origin, dir, maxDist = Infinity) {
  let best = null;
  for (const f of portalFills.values()) {
    const b = portalFillBox(f.win);
    const hit = raySlabBox(origin, dir, b);
    if (!hit || hit.t > maxDist) continue;
    const px = origin.x + dir.x * hit.t, py = origin.y + dir.y * hit.t, pz = origin.z + dir.z * hit.t;
    const dist = Math.hypot(px - origin.x, py - origin.y, pz - origin.z);
    if (dist > maxDist || (best && dist >= best.dist)) continue;
    best = { kind: "portal", win: f.win, dist, px, py, pz, cx: b.cx, cy: b.cy, cz: b.cz, face: hit.face };
  }
  return best;
}

// Liveness check for hooks latched onto a fill: a broken frame purges its
// fill from portalFills, and the hook retracts instead of pulling to air.
export function portalWindowLive(win) {
  return portalFills.has(fillKey(win));
}

// Ghost test for portal pulls: the window's frame ring is passable, so a
// pull aimed at the fill slides through the ring into the slab instead of
// stalling on it (top-landing block grapples ghost their anchor column the
// same way). Interior cells keep normal rules — landing there is still real
// collision — and everything outside the frame box collides normally. The
// ring is the frame box minus the fill box, so all families share it.
export function portalGhostCell(win, bx, by, bz) {
  const spec = specOf(win);
  const b = spec.bbox(win);
  if (bx < b.minX || bx > b.maxX || by < b.baseY || by > b.topY || bz < b.minZ || bz > b.maxZ) return false;
  const f = portalFillBox(win);
  const x0 = f.cx - f.sx / 2, x1 = f.cx + f.sx / 2;
  const y0 = f.cy - f.sy / 2, y1 = f.cy + f.sy / 2;
  const z0 = f.cz - f.sz / 2, z1 = f.cz + f.sz / 2;
  if (bx >= x0 && bx < x1 && by >= y0 && by < y1 && bz >= z0 && bz < z1) return false;
  return true;
}

// Fly-step gate: true when the cell is the bottom row of a vertical window
// with a live fill (a gated dimension keeps no fills, so its sills never
// qualify). Vertical windows only — flat frames keep strict collision.
export function isLivePortalSill(bx, by, bz) {
  for (const f of portalFills.values()) {
    const win = f.win;
    if (win.orient !== "v") continue;
    if (by !== win.minY) continue;
    const box = portalFrameBBox(win);
    if (win.face === "x") {
      if (bx !== box.minX || bz < box.minZ || bz > box.maxZ) continue;
    } else if (bz !== box.minZ || bx < box.minX || bx > box.maxX) continue;
    if (isFrameCell(win, bx, by, bz)) return true;
  }
  return false;
}

function fillKey(win) {
  return `${win.type}:${win.orient}:${win.face || "z"}:${win.minX},${win.minY},${win.minZ}${win.dims || ""}${win.h || ""}`;
}

function ensurePortalFill(win) {
  const k = fillKey(win);
  if (portalFills.has(k)) return;
  const spec = specOf(win);
  // Transient fade-in (see tickPortalFillFades): fills validate instantly
  // at full opacity otherwise — high-contrast slabs popping in plain sight.
  const shared = fillMat(spec);
  const clone = shared.clone();
  clone.transparent = true;
  clone.opacity = 0;
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(portalFillGeo, clone);
  group.add(mesh);
  layoutPortalFill(group, win);
  sceneRef.add(group);
  portalFills.set(k, { win, group });
  fillFades.push({ key: k, mesh, shared, clone, base: shared.opacity, t: 0 });
}

// Transient per-fill fade-in: same pattern as the chunk fades in mesher.js
// (fresh clone at opacity 0, ramped to base over FILL_FADE_T, shared spec
// material restored, clone disposed). Ticked from the main loop next to
// tickChunkFades on loader-exempt wall clock, so build-time fills fade
// behind the menu too. Removals purge mid-fade entries with them.
const FILL_FADE_T = 0.35;
const fillFades = []; // { key, mesh, shared, clone, base, t }
function finishFillFade(i) {
  const f = fillFades[i];
  f.mesh.material = f.shared;
  f.clone.dispose();
  fillFades.splice(i, 1);
}
function purgeFillFade(k) {
  for (let i = fillFades.length - 1; i >= 0; i--) {
    if (fillFades[i].key !== k) continue;
    fillFades[i].clone.dispose();
    fillFades.splice(i, 1);
  }
}
export function tickPortalFillFades(dt, px, eyeY, pz, fogFar) {
  const lim2 = fogFar * fogFar;
  for (let i = fillFades.length - 1; i >= 0; i--) {
    const f = fillFades[i];
    // Beyond the fogged range the fade is invisible: snap it shut at once.
    const dx = f.mesh.position.x - px, dy = f.mesh.position.y - eyeY, dz = f.mesh.position.z - pz;
    if (dx * dx + dy * dy + dz * dz > lim2) { finishFillFade(i); continue; }
    f.t += dt / FILL_FADE_T;
    const t = Math.min(1, f.t);
    const e = t * t * (3 - 2 * t);
    f.clone.opacity = f.base * e;
    if (t >= 1) finishFillFade(i);
  }
}

export function clearPortalFills() {
  if (!sceneRef) { portalFills.clear(); portalWindows.clear(); gateInside = false; return; }
  for (const f of portalFills.values()) sceneRef.remove(f.group);
  portalFills.clear();
  portalWindows.clear();
  gateInside = false;
  for (const f of fillFades) f.clone.dispose();
  fillFades.length = 0;
}

function refreshPortalFills(bx, by, bz) {
  if (!sceneRef) return;
  // Support partners always intersect, so an R=12 set covers cascades.
  const R = 12;
  syncFills(resolveWindows(gatherNear(bx, by, bz, R)), bx, by, bz, R);
}

export function scanWorldPortals() {
  syncFills(resolveWindows(gatherAll()), 0, 0, 0, Infinity);
}

let portalScanT = 0;
const lastScanCell = { bx: -9999, by: -9999, bz: -9999 };

function updatePortalVisual(dt) {
  const bx = Math.floor(pos.x), by = Math.floor(pos.y + 0.9), bz = Math.floor(pos.z);
  portalScanT -= dt;
  if (portalDirty || (portalScanT <= 0 &&
      (bx !== lastScanCell.bx || by !== lastScanCell.by || bz !== lastScanCell.bz))) {
    portalScanT = 0.5;
    portalDirty = false;
    lastScanCell.bx = bx; lastScanCell.by = by; lastScanCell.bz = bz;
    refreshPortalFills(bx, by, bz);
  }
}

// Only fires when the body overlaps the fill: jumping over a flat portal
// never grabs, the fill slab sits at win.minY while the body hovers above.
function touchesPortalFill(f) {
  for (const [x, y, z] of portalFillCells(f.win)) {
    if (pos.x + PLAYER_HW > x && pos.x - PLAYER_HW < x + 1 &&
        pos.y + PLAYER_H > y && pos.y < y + 1 &&
        pos.z + PLAYER_HW > z && pos.z - PLAYER_HW < z + 1) return true;
  }
  return false;
}

function insideEndInterior(win, bx, by, bz) {
  if (win.orient === "v") {
    const top = win.h === 4 ? win.minY + 2 : win.minY + 3;
    if (win.face === "x") {
      return bx === win.minX && by >= win.minY + 1 && by <= top && bz >= win.minZ + 1 && bz <= win.minZ + 3;
    }
    return bx >= win.minX + 1 && bx <= win.minX + 3 && by >= win.minY + 1 && by <= top && bz === win.minZ;
  }
  // Flat interiors are the single fill layer: a body at any other height
  // never overlaps the slab (the travel trigger reads fill cells, not this).
  // An unbounded column here would reject standable cells high above or deep
  // below a neighbouring flat window.
  if (by !== win.minY) return false;
  return bx >= win.minX + 1 && bx <= win.minX + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 3;
}

function insideRectInterior(win, bx, by, bz) {
  if (win.orient === "v") {
    if (win.face === "x") {
      if (win.dims === "4x5") return bx === win.minX && by >= win.minY + 1 && by <= win.minY + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
      if (win.dims === "4x4") return bx === win.minX && by >= win.minY + 1 && by <= win.minY + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
      return bx === win.minX && by >= win.minY + 1 && by <= win.minY + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 3;
    }
    if (win.dims === "4x5") return bx >= win.minX + 1 && bx <= win.minX + 2 && by >= win.minY + 1 && by <= win.minY + 3 && bz === win.minZ;
    if (win.dims === "4x4") return bx >= win.minX + 1 && bx <= win.minX + 2 && by >= win.minY + 1 && by <= win.minY + 2 && bz === win.minZ;
    return bx >= win.minX + 1 && bx <= win.minX + 3 && by >= win.minY + 1 && by <= win.minY + 2 && bz === win.minZ;
  }
  // Flat interiors are the single fill layer (see insideEndInterior).
  if (by !== win.minY) return false;
  if (win.dims === "4x5") return bx >= win.minX + 1 && bx <= win.minX + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 3;
  if (win.dims === "4x4") return bx >= win.minX + 1 && bx <= win.minX + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
  return bx >= win.minX + 1 && bx <= win.minX + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
}

function endBBox(w) {
  const topY = w.h === 4 ? w.minY + 3 : w.minY + 4;
  if (w.orient === "h") return { minX: w.minX, maxX: w.minX + 4, minZ: w.minZ, maxZ: w.minZ + 4, baseY: w.minY, topY: w.minY };
  if (w.face === "x") return { minX: w.minX, maxX: w.minX, minZ: w.minZ, maxZ: w.minZ + 4, baseY: w.minY, topY };
  return { minX: w.minX, maxX: w.minX + 4, minZ: w.minZ, maxZ: w.minZ, baseY: w.minY, topY };
}

function rectBBox(w) {
  if (w.orient === "v") {
    const ww = w.dims === "4x5" || w.dims === "4x4" ? 4 : 5;
    const hh = w.dims === "4x5" ? 5 : 4;
    if (w.face === "x") return { minX: w.minX, maxX: w.minX, minZ: w.minZ, maxZ: w.minZ + ww - 1, baseY: w.minY, topY: w.minY + hh - 1 };
    return { minX: w.minX, maxX: w.minX + ww - 1, minZ: w.minZ, maxZ: w.minZ, baseY: w.minY, topY: w.minY + hh - 1 };
  }
  const ww = w.dims === "4x5" || w.dims === "4x4" ? 4 : 5, dd = w.dims === "4x5" ? 5 : 4;
  return { minX: w.minX, maxX: w.minX + ww - 1, minZ: w.minZ, maxZ: w.minZ + dd - 1, baseY: w.minY, topY: w.minY };
}

function portalFrameBBox(w) {
  return specOf(w).bbox(w);
}

// --- Arrival spots (visibility first, orthogonal preference) ---

function returnBodyClear(px, py, pz) {
  for (let bx = Math.floor(px - PLAYER_HW + 0.02); bx <= Math.floor(px + PLAYER_HW - 0.02); bx++)
    for (let by = Math.floor(py + 0.02); by <= Math.floor(py + PLAYER_H - 0.02); by++)
      for (let bz = Math.floor(pz - PLAYER_HW + 0.02); bz <= Math.floor(pz + PLAYER_HW - 0.02); bz++)
        if (isSolid(bx, by, bz)) return false;
  return true;
}

function inReturnPortalBody(wins, px, py, pz) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (const w of wins) {
    const inside = specOf(w).inside;
    for (let by = Math.floor(py); by <= Math.floor(py + PLAYER_H); by++)
      if (inside(w, bx, by, bz)) return true;
  }
  return false;
}

function facePortalFrom(win, px, pz, preferredDir = null) {
  const c = portalFacePoint(win);
  const dx = c.x - px, dz = c.z - pz;
  if (Math.hypot(dx, dz) < 1e-3) {
    if (preferredDir && Math.hypot(preferredDir.x, preferredDir.z) > 1e-6)
      return Math.atan2(-preferredDir.x, -preferredDir.z);
    return 0;
  }
  return Math.atan2(-dx, -dz);
}

// Distance ladder: the preferred 4-block ring, then alternating outward
// (5,3 / 6,2 / 7,1 / 8). Per distance, the portal's own ground level sweeps
// every face and side before any other height; going to the other side
// beats climbing. Each orthogonal target also sweeps small lateral offsets
// so a blocked centre column does not hide a free neighbour cell.
// A second pass snaps the same sweep to each column's real support top for
// sunk, raised or sloped portals. Frame placement (0) and the general
// visible search follow in findArrivalSpot.
const ARRIVAL_DISTS = [4, 5, 3, 6, 2, 7, 1, 8];
const ARRIVAL_LATERAL = [0, -1, 1, -2, 2];
// Height tolerance above the frame base; it never counts in the distance.
const ARRIVAL_HEIGHTS = [0, 1, 2];
// Support snap (second pass): the same sweep snapped to the column's real
// standable top, for portals sunk into or raised above the local relief.
// Nearest-to-base offsets first; the exact heights above already ran.
const ARRIVAL_SNAP_DY = [-1, -2, 3, -3, 4];
const ARRIVAL_SEARCH_R = 16;
const LOS_STEP = 0.2;

function isFrameCell(win, x, y, z) {
  const f = specOf(win).frame;
  const id = getBlock(x, y, z);
  return Array.isArray(f) ? f.includes(id) : id === f;
}

// Horizontal outward normals. The exit direction wins the ordering when the
// player came through a linked portal; otherwise the stable +axis-first order
// applies.
function arrivalAxes(win, preferredDir) {
  const axes = win.orient === "v"
    ? (win.face === "x"
      ? [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }]
      : [{ nx: 0, nz: 1 }, { nx: 0, nz: -1 }])
    : [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 }];
  const dx = preferredDir?.x ?? 0, dz = preferredDir?.z ?? 0;
  if (Math.hypot(dx, dz) < 1e-6) return axes;
  return axes
    .map((a) => ({ ...a, dot: a.nx * dx + a.nz * dz }))
    .sort((a, b) => b.dot - a.dot);
}

// Orthogonal target at `dist` from the frame plane. Upright portals offset
// from the face centre; flat portals offset from the middle of the chosen
// side (the side plane passes through the outer frame block centre).
function arrivalTarget(win, axis, dist) {
  const box = portalFrameBBox(win);
  const fill = portalFillBox(win);
  if (win.orient === "v") return { x: fill.cx + axis.nx * dist, z: fill.cz + axis.nz * dist };
  const sx = axis.nx > 0 ? box.maxX + 0.5 : box.minX + 0.5;
  const sz = axis.nz > 0 ? box.maxZ + 0.5 : box.minZ + 0.5;
  return {
    x: axis.nx !== 0 ? sx + axis.nx * dist : fill.cx,
    z: axis.nz !== 0 ? sz + axis.nz * dist : fill.cz,
  };
}

function arrivalSpotAt(win, axis, dist, lat, dy) {
  const t = arrivalTarget(win, axis, dist);
  const x = axis.nx !== 0 ? t.x : t.x + lat;
  const z = axis.nx !== 0 ? t.z + lat : t.z;
  return { x: Math.floor(x) + 0.5, y: win.minY + dy, z: Math.floor(z) + 0.5 };
}

function portalFacePoint(win) {
  const b = portalFillBox(win);
  return { x: b.cx, y: b.cy, z: b.cz };
}

// Real frame blocks around the window (perimeter of its bbox, filtered by the
// spec's frame ids so omitted End corners never count).
function frameRingCells(win) {
  const box = portalFrameBBox(win);
  const out = [];
  const push = (x, y, z) => { if (isFrameCell(win, x, y, z)) out.push([x, y, z]); };
  if (win.orient === "v") {
    if (win.face === "x") {
      for (let y = box.baseY; y <= box.topY; y++)
        for (let z = box.minZ; z <= box.maxZ; z++) {
          if (y !== box.baseY && y !== box.topY && z !== box.minZ && z !== box.maxZ) continue;
          push(box.minX, y, z);
        }
    } else {
      for (let y = box.baseY; y <= box.topY; y++)
        for (let x = box.minX; x <= box.maxX; x++) {
          if (y !== box.baseY && y !== box.topY && x !== box.minX && x !== box.maxX) continue;
          push(x, y, box.minZ);
        }
    }
  } else {
    for (let x = box.minX; x <= box.maxX; x++)
      for (let z = box.minZ; z <= box.maxZ; z++) {
        if (x !== box.minX && x !== box.maxX && z !== box.minZ && z !== box.maxZ) continue;
        push(x, box.baseY, z);
      }
  }
  return out;
}

// "Seeing the portal": upright windows look at their fill face centre first,
// then at every fill cell nearest-first (a rock tooth, jamb or tree may hide
// the centre while another part of the slab stays visible), then at the
// nearest ring faces (a floating portal's own bottom row hides its fill
// from a low angle; the frame face is still the portal, seen head-on);
// flat windows look at their nearest ring cells, side face then top face
// (a horizontal side view cannot see the fill past the frame, but the ring
// top reads over any single-step obstacle).
function arrivalLosTargets(win, from) {
  if (win.orient !== "v") return flatLosTargets(win, from);
  const center = portalFacePoint(win);
  const cells = [];
  for (const [x, y, z] of specOf(win).cells(win)) {
    const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    const dx = px - from.x, dy = py - from.y, dz = pz - from.z;
    cells.push({ p: { x: px, y: py, z: pz }, d: dx * dx + dy * dy + dz * dz });
  }
  cells.sort((a, b) => a.d - b.d);
  const out = [center];
  for (const { p } of cells) {
    if (Math.abs(p.x - center.x) < 1e-6 && Math.abs(p.y - center.y) < 1e-6 && Math.abs(p.z - center.z) < 1e-6)
      continue;
    out.push(p);
  }
  // Last resort: the ring itself. A floating portal's fill is genuinely
  // hidden from a low grazing angle by its own bottom row; the frame face
  // is still the portal, seen head-on. Fill targets always win first.
  const ring = [];
  for (const [x, y, z] of frameRingCells(win)) {
    const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    const dx = px - from.x, dy = py - from.y, dz = pz - from.z;
    ring.push({ x, y, z, d: dx * dx + dy * dy + dz * dz });
  }
  ring.sort((a, b) => a.d - b.d);
  for (const c of ring.slice(0, 4)) {
    out.push({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
    out.push({ x: c.x + 0.5, y: c.y + 1.0, z: c.z + 0.5 });
  }
  return out;
}

// Flat windows are seen from the side at standing eye height: the visible
// cue is the ring's side face and, over any single-step obstacle, its top.
// Test both on the nearest ring cells so one low wall does not blind a whole
// direction.
function flatLosTargets(win, from) {
  const ring = [];
  for (const [x, y, z] of frameRingCells(win)) {
    const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    const dx = px - from.x, dy = py - from.y, dz = pz - from.z;
    ring.push({ x, y, z, d: dx * dx + dy * dy + dz * dz });
  }
  ring.sort((a, b) => a.d - b.d);
  const out = [];
  for (const c of ring.slice(0, 4)) {
    out.push({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
    out.push({ x: c.x + 0.5, y: c.y + 1.0, z: c.z + 0.5 });
  }
  return out;
}

function losClear(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  const steps = Math.ceil(len / LOS_STEP);
  let last = null;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(from.x + dx * t);
    const y = Math.floor(from.y + dy * t);
    const z = Math.floor(from.z + dz * t);
    const k = x + "," + y + "," + z;
    if (k === last) continue;
    last = k;
    if (isSolid(x, y, z)) return false;
  }
  return true;
}

// Every arrival candidate shares the anti-collision contract: standable
// ground, body clear of every solid block, outside any portal interior, and
// an unobstructed view of the portal.
function validArrivalSpot(win, spot, wins) {
  const bx = Math.floor(spot.x), by = Math.floor(spot.y), bz = Math.floor(spot.z);
  // Feet stay above the dimension's floor (null floor coerces to the same 1).
  if (by < dimFloorY(dim) + 1) return false;
  if (bx < -dimBound() || bx > dimBound() || bz < -dimBound() || bz > dimBound()) return false;
  if (!isSolid(bx, by - 1, bz)) return false;
  if (!returnBodyClear(spot.x, spot.y, spot.z)) return false;
  if (inReturnPortalBody(wins, spot.x, spot.y, spot.z)) return false;
  const eye = { x: spot.x, y: spot.y + EYE, z: spot.z };
  const targets = arrivalLosTargets(win, eye);
  return targets.some((target) => losClear(eye, target));
}

// Step 0: stand on the closest real frame block where the body fits.
function frameArrivalSpot(win, wins) {
  const c = portalFacePoint(win);
  let best = null, bestD = Infinity;
  for (const [x, y, z] of frameRingCells(win)) {
    const spot = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    if (!returnBodyClear(spot.x, spot.y, spot.z)) continue;
    if (inReturnPortalBody(wins, spot.x, spot.y, spot.z)) continue;
    const dx = spot.x - c.x, dy = spot.y - c.y, dz = spot.z - c.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = spot; }
  }
  return best;
}

// Step C: any standable cell within ARRIVAL_SEARCH_R of the frame bbox that
// sees the portal, nearest first.
function generalArrivalSpot(win, wins) {
  const box = portalFrameBBox(win);
  const c = portalFacePoint(win);
  const B = dimBound();
  let best = null, bestD = Infinity, bestD2 = Infinity;
  const x0 = Math.max(-B, box.minX - ARRIVAL_SEARCH_R), x1 = Math.min(B, box.maxX + ARRIVAL_SEARCH_R);
  const z0 = Math.max(-B, box.minZ - ARRIVAL_SEARCH_R), z1 = Math.min(B, box.maxZ + ARRIVAL_SEARCH_R);
  const y0 = Math.max(1, box.baseY - ARRIVAL_SEARCH_R), y1 = box.topY + ARRIVAL_SEARCH_R;
  for (let x = x0; x <= x1; x++) {
    const dx = x < box.minX ? box.minX - x : x > box.maxX ? x - box.maxX : 0;
    for (let z = z0; z <= z1; z++) {
      const dz = z < box.minZ ? box.minZ - z : z > box.maxZ ? z - box.maxZ : 0;
      for (let y = y0; y <= y1; y++) {
        const dy = y < box.baseY ? box.baseY - y : y > box.topY ? y - box.topY : 0;
        const d = Math.max(dx, dy, dz);
        if (d > ARRIVAL_SEARCH_R || d > bestD) continue;
        const spot = { x: x + 0.5, y, z: z + 0.5 };
        const d2 = (spot.x - c.x) ** 2 + (spot.y - c.y) ** 2 + (spot.z - c.z) ** 2;
        if (d === bestD && d2 >= bestD2) continue;
        if (!validArrivalSpot(win, spot, wins)) continue;
        best = spot; bestD = d; bestD2 = d2;
      }
    }
  }
  return best;
}

function findArrivalSpot(win, preferredDir) {
  const c = portalFacePoint(win);
  const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
  const axes = arrivalAxes(win, preferredDir);
  // Per distance, the portal's own ground (dy 0) wins on every face and
  // side before any other height; going to the other side beats climbing.
  for (const dist of ARRIVAL_DISTS) {
    for (const dy of ARRIVAL_HEIGHTS)
      for (const axis of axes)
        for (const lat of ARRIVAL_LATERAL) {
          const spot = arrivalSpotAt(win, axis, dist, lat, dy);
          if (validArrivalSpot(win, spot, wins)) return spot;
        }
  }
  // Same sweep snapped to each column's real support top, so a sunk, raised
  // or sloped portal still lands at the preferred distance. Same height
  // ordering: nearest-to-base offsets sweep every face and side first.
  // Frame placement (0) and the general visible search follow.
  for (const dist of ARRIVAL_DISTS) {
    for (const dy of ARRIVAL_SNAP_DY)
      for (const axis of axes)
        for (const lat of ARRIVAL_LATERAL) {
          const spot = arrivalSpotAt(win, axis, dist, lat, dy);
          if (validArrivalSpot(win, spot, wins)) return spot;
        }
  }
  return frameArrivalSpot(win, wins) || generalArrivalSpot(win, wins);
}

// --- Cross-dimension arrival links ---
//
// Leaving a dimension through a portal records that window under the source
// dimension. A later arrival in that dimension resolves the same window when
// it still validates, so A -> B -> A returns to the exact portal left in A,
// whatever portal carried the player back. Reset only for a fresh world (not
// on dimension switches).
const travelLinks = new Map(); // source dimension -> { win, dir }

export function resetTravelLinks() {
  travelLinks.clear();
}

function nearestReturnWin(sx, sy, sz) {
  const cx = Math.floor(sx), cy = Math.floor(sy), cz = Math.floor(sz);
  let best = null, bestD = Infinity;
  for (const win of collectReturnWins(cx, cy, cz)) {
    const box = portalFrameBBox(win);
    const dx = cx < box.minX ? box.minX - cx : cx > box.maxX ? cx - box.maxX : 0;
    const dz = cz < box.minZ ? box.minZ - cz : cz > box.maxZ ? cz - box.maxZ : 0;
    const dy = cy < box.baseY ? box.baseY - cy : cy > box.topY ? cy - box.topY : 0;
    const d = Math.max(dx, dz, dy);
    if (d < bestD) { bestD = d; best = win; }
  }
  return best;
}

// Placement for an arrival in the now-active dimension. The recorded link is
// the portal left in that dimension; if it no longer validates (destroyed or
// regenerated) the anchor finds the nearest live window (the generated
// return frame when spawning in fresh). The anchor must use destination
// coordinates, never the pre-switch source position, else the caller falls
// back to the dimension spawn.
export function resolveTravelArrival(dest, anchor = null) {
  const arrival = dimSpec(dest)?.arrival;
  if (!arrival || arrival.mode !== "portal") return null;
  const link = travelLinks.get(dest);
  let win = link?.win ?? null;
  if (win && specOf(win)?.evaluate(win) !== true) win = null;
  const linked = !!win;
  if (!win && anchor) win = nearestReturnWin(anchor.x, anchor.y, anchor.z);
  if (!win) return null;
  const preferredDir = linked ? (link?.dir ?? null) : null;
  const spot = findArrivalSpot(win, preferredDir);
  if (!spot) return null;
  const face = facePortalFrom(win, spot.x, spot.z, preferredDir);
  return { spot, yaw: arrival.facing === "away" ? face + Math.PI : face };
}

// --- Travel (spiral, cooldown) ---

let portalCd = 0;
let portalBusy = false;
let onTravelHook = null;
export function setPortalTravelHook(fn) {
  onTravelHook = fn;
}

const PORTAL_FADE_IN = 450;
const PORTAL_FADE_OUT = 600;
let spiralGen = 0;
let toastT = 0;

export function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.opacity = "0"; }, 2200);
}

// Spiral acceleration: the two swirls carry data-spin="degPerSec dir" and a
// rAF loop turns them with a ramp multiplier (x0.5 -> x6 over the 1.5 s ride),
// so the spiral visibly accelerates into the jump from the first frame:
// steady x0.5 at entry, ramping to the x6 cap by ride end.
// Transform-only writes on two nodes: no layout, no paint. Angles persist
// on dataset across travels.
const SPIN_DELAY = 0;
const SPIN_BASE = 0.5;
let tunnelRAF = 0, tunnelT0 = 0, tunnelLast = 0;
let tunnelSpinners = [];
function collectTunnelSpinners() {
  tunnelSpinners = [];
  const root = document.getElementById("portalSpiral");
  if (!root) return;
  root.querySelectorAll("#portalSpiralFront, #portalSpiralBack").forEach((n) => {
    const parts = (n.getAttribute("data-spin") || "").split(" ");
    tunnelSpinners.push({
      el: n,
      base: Number(parts[0]) || 0,
      dir: Number(parts[1]) || 1,
      angle: parseFloat(n.dataset.ang || "0"),
    });
  });
}
function tunnelTick(now) {
  tunnelRAF = 0;
  const t = (now - tunnelT0) / 1000;
  const dt = Math.min(0.05, Math.max(0, (now - tunnelLast) / 1000));
  tunnelLast = now;
  const te = Math.max(0, t - SPIN_DELAY);
  const m = Math.min(6, SPIN_BASE + ((6 - SPIN_BASE) / (TRAVEL_MIN_MS / 1000 - SPIN_DELAY)) * te);
  for (const s of tunnelSpinners) {
    s.angle = (s.angle + s.base * s.dir * m * dt) % 360;
    s.el.dataset.ang = s.angle.toFixed(2);
    s.el.style.transform = "rotate(" + s.angle.toFixed(2) + "deg)";
  }
  tunnelRAF = requestAnimationFrame(tunnelTick);
}
function startTunnelSpin() {
  stopTunnelSpin();
  collectTunnelSpinners();
  if (!tunnelSpinners.length) return;
  tunnelT0 = performance.now();
  tunnelLast = tunnelT0;
  tunnelRAF = requestAnimationFrame(tunnelTick);
}
function stopTunnelSpin() {
  if (tunnelRAF) cancelAnimationFrame(tunnelRAF);
  tunnelRAF = 0;
}

function showPortalSpiral() {
  const el = document.getElementById("portalSpiral");
  if (!el) return;
  spiralGen++;
  el.classList.remove("jump");
  el.style.display = "flex";
  void el.offsetWidth;
  el.classList.add("show");
  startTunnelSpin();
}

// Lift sequencing: a fixed jump burst (spiral stretches out + flash) plays at
// full opacity first, then the regular fade-out runs. Generation-guarded
// throughout, so a rapid re-travel never hides the new spiral.
const TUNNEL_JUMP_MS = 300;
function hidePortalSpiral() {
  const el = document.getElementById("portalSpiral");
  if (!el) return;
  const g = spiralGen;
  el.classList.add("jump");
  setTimeout(() => { if (spiralGen === g) el.classList.remove("show"); }, TUNNEL_JUMP_MS);
  setTimeout(() => { if (spiralGen === g) { el.style.display = "none"; el.classList.remove("jump"); stopTunnelSpin(); } }, TUNNEL_JUMP_MS + PORTAL_FADE_OUT + 80);
}

// Travel handoff: the spiral shows at once and the main.js hook starts the
// transition load immediately, so destination voxels generate behind the
// fade-in instead of after it. Busy + spiral stay held until main.js calls
// completeDimTravel() once the arrival is ready to render. The transition
// pipeline enforces the minimum spiral time itself and runs on loader clock
// (rAF slices, like boot) — never a sim-time pending — so pausing mid-spiral
// never stalls the load behind it.
// Minimum spiral display, in ms: 1.5 s here, then the ~1 s lift sequence
// (jump burst + fade-out), so the full animation lasts a constant 2.5 s. The
// pipeline waits for it when the load finishes early (retained dimensions).
export const TRAVEL_MIN_MS = 1500;
function travelTo(plan) {
  if (portalBusy) return;
  portalBusy = true;
  portalCd = 1.5;
  const el = document.getElementById("portalSpiral");
  if (el) el.style.setProperty("--tunnel", tunnelForDest(plan.dim));
  showPortalSpiral();
  if (onTravelHook) onTravelHook(plan);
}

// Called by main.js once a cross-dimension switch finishes (or aborts):
// releases the travel lock and drops the spiral overlay.
export function completeDimTravel() {
  portalBusy = false;
  hidePortalSpiral();
}

function moveDir() {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let dx = 0, dz = 0;
  if (keys["KeyW"] || keys["ArrowUp"]) { dx += fx; dz += fz; }
  if (keys["KeyS"] || keys["ArrowDown"]) { dx -= fx; dz -= fz; }
  if (keys["KeyD"] || keys["ArrowRight"]) { dx += rx; dz += rz; }
  if (keys["KeyA"] || keys["ArrowLeft"]) { dx -= rx; dz -= rz; }
  if (dx === 0 && dz === 0) { dx = fx; dz = fz; }
  return { x: dx, z: dz };
}

// Cross-dimension destination: own dimension returns to the Overworld, any
// other dimension heads to the family's target. Arrival resolves after the
// switch (destination solidity differs), so this carries only the destination
// and its toast — travelTo hands it to the dimension hook in main.js.
function destinationTravel(win) {
  const spec = specOf(win);
  const dest = dim === spec.destination ? "over" : spec.destination;
  return { dim: dest, msg: dest === "over" ? "You returned to the Overworld" : spec.enterMsg };
}

// Spiral color theme, by destination: overworld green, Nether dark blue,
// End violet, TNT dark red. Families declare their own color on the spec;
// the Overworld has no family (it is the return), so its green lives here.
const OVER_TUNNEL = "#15803d";
function tunnelForDest(dest) {
  if (dest === "over") return OVER_TUNNEL;
  return PORTAL_TYPES.find((s) => s.destination === dest)?.tunnel ?? "#6d28d9";
}

// Cheat travel (Z key cycle, requires ?cheat=1): an explicit destination
// with no portal behind it. Same toast and destination spiral color as a
// real trip, same busy/cooldown guards through travelTo — but it bypasses
// the exits gate and records no return link, so the way back falls to the
// nearest/spawn fallback.
export function debugTravelTo(dest) {
  const spec = PORTAL_TYPES.find((s) => s.destination === dest);
  travelTo({
    dim: dest,
    msg: dest === "over" ? "You returned to the Overworld" : spec?.enterMsg ?? null,
  });
}

// A dimension's exits gate (End: sealed while the dragon lives) closes every
// portal in it: no family may ferry the player out. Gated windows fire no
// fill and no travel, so touching one is a silent no-op otherwise — ask the
// gate instead, once per entry (re-arms after leaving the interior). Runs
// outside the travel cooldown: the message answers a different act than
// arrival protection does.
function exitGateMsg() {
  return dimSpec(dim)?.exitsGate?.() ? dimSpec(dim).exitsGateMsg : null;
}

let gateInside = false;
function checkGatedWindows() {
  const msg = exitGateMsg();
  if (!msg) { gateInside = false; return; }
  let touched = false;
  for (const win of portalWindows.values()) {
    if (touchesPortalFill({ win })) { touched = true; break; }
  }
  if (touched && !gateInside) toast(msg);
  gateInside = touched;
}

function checkPortal() {
  if (portalCd > 0 || portalBusy) return;
  // Gated dimension: windows never travel, whatever family they belong to.
  if (exitGateMsg()) return;
  // First touched fill wins: crossing fills share cells, but entering along
  // a window's plane always touches its own slab first.
  for (const f of portalFills.values()) {
    if (specOf(f.win).active?.(f.win) === false) continue;
    if (!touchesPortalFill(f)) continue;
    const dir = moveDir();
    const raw = specOf(f.win).travel(f.win, dir);
    // Cross-dimension exits remember this window for the trip back.
    travelLinks.set(dim, { win: { ...f.win }, dir: { x: dir.x, z: dir.z } });
    const plan = { msg: raw.msg ?? null, dim: raw.dim };
    travelTo(plan);
    return;
  }
}

export function tickPortals(dt, canTravel) {
  // Fully frozen while paused: cooldown and fill scans wait for the sim to
  // run again. Travel itself is loader-driven (see travelTo): once the hook
  // fires, the transition pipeline owns the timing behind the spiral.
  if (!canTravel) return;
  if (portalCd > 0) portalCd -= dt;
  if (sceneRef) updatePortalVisual(dt);
  checkPortal();
  checkGatedWindows();
}

// --- Help diagrams + travel spiral art ---

const SVGNS = "http://www.w3.org/2000/svg";

// Travel spiral art, built once at boot: filled ribbon arms on two swirls
// (front 6 arms, back 4 counter-rotating) in the destination spiral color —
// fills come from CSS (see index.html), this builds geometry only. The rAF
// loop turns both swirls with an accelerating ramp.
function buildSpiralArms(svg, arms, turns, rOut, angHalf, depth) {
  if (!svg || svg.querySelectorAll("path").length) return;
  // Cone projection: each arm winds around a cone pointing away from the
  // viewer, so the spiral reads as a funnel you fly into. t = 0 is the wide
  // near rim (screen edge), t = 1 the narrow far end (vanishing point). The
  // world ring radius shrinks linearly while depth grows, and the screen
  // radius is ring / depth — ribbons taper naturally toward the center.
  const steps = 64;
  const cone = (t) => {
    const ring = rOut * (1 - 0.75 * t);
    const z = 1 + depth * t;
    return ring / z;
  };
  for (let a = 0; a < arms; a++) {
    const base = (a / arms) * Math.PI * 2;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = cone(t);
      const th = base + t * turns * Math.PI * 2;
      d += (i === 0 ? "M " : " L ") + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const r = cone(t);
      const th = base + t * turns * Math.PI * 2 + angHalf;
      d += " L " + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
    }
    d += " Z";
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("opacity", "0.92");
    svg.appendChild(path);
  }
}

function buildPortalSpiral() {
  // Front cone is deep, back cone shallower: the parallax between both
  // layers sells the 3D funnel.
  buildSpiralArms(document.getElementById("portalSpiralFront"), 6, 1.5, 98, 16 * Math.PI / 180, 20);
  buildSpiralArms(document.getElementById("portalSpiralBack"), 4, 2.2, 82, 24 * Math.PI / 180, 5);
}

// Single-tier help art: a cols×rows ring of one block id (`skipCorners`
// leaves the corners empty, like the End diagram). Runs once at boot.
function buildSolidFrame(cols, rows, id, skipCorners) {
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const isEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      const isCorner = (r === 0 || r === rows - 1) && (c === 0 || c === cols - 1);
      if (isEdge && !(skipCorners && isCorner)) cells[r][c] = id;
    }
  return cells;
}

// TNT help art: the 12-cell 4×4 ring draws 4 of each tier, shuffled with a
// rejection loop that forbids adjacent repeats (including the wrap-around),
// so reds/blues/blacks stay spread out. Runs once at boot.
function buildTntFrame() {
  const ring = [
    [0, 0], [0, 1], [0, 2], [0, 3],
    [1, 3], [2, 3], [3, 3],
    [3, 2], [3, 1], [3, 0],
    [2, 0], [1, 0],
  ];
  const pool = [TNT, TNT, TNT, TNT, MEGA_TNT, MEGA_TNT, MEGA_TNT, MEGA_TNT, ULTRA_TNT, ULTRA_TNT, ULTRA_TNT, ULTRA_TNT];
  const hasAdjacent = (a) => {
    for (let i = 0; i < a.length; i++) if (a[i] === a[(i + 1) % a.length]) return true;
    return false;
  };
  let order = pool;
  for (let tries = 0; tries < 200; tries++) {
    order = pool.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    if (!hasAdjacent(order)) break;
  }
  const cells = Array.from({ length: 4 }, () => Array(4).fill(null));
  ring.forEach(([r, c], i) => { cells[r][c] = order[i]; });
  return cells;
}

// Block icon data URLs for mixed-frame help art (same source as hotbar icons).
const artIconCache = new Map();
function artBlockIcon(id) {
  if (!artIconCache.has(id)) artIconCache.set(id, materialsFor(id)[0].map.image.toDataURL());
  return artIconCache.get(id);
}

function paintFrameArt(hostId, art) {
  const host = document.getElementById(hostId);
  if (!host || host.children.length) return;
  const { cols, rows, width, stroke, cells } = art;
  const cell = 19, size = 15, off = 6;
  const w = off * 2 + (cols - 1) * cell + size;
  const h = off * 2 + (rows - 1) * cell + size;
  // One shared px-per-unit scale (150px over the 103-unit 5-wide viewBox),
  // so cubes render identically in every diagram; overrides stay explicit.
  const px = width || Math.round(150 * w / 103);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(px));
  svg.setAttribute("height", String(Math.round(px * h / w)));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = off + c * cell, y = off + r * cell;
      const id = cells[r] && cells[r][c];
      if (id == null) continue;
      const img = document.createElementNS(SVGNS, "image");
      img.setAttribute("x", x + 1); img.setAttribute("y", y + 1);
      img.setAttribute("width", size - 2); img.setAttribute("height", size - 2);
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      img.setAttribute("href", artBlockIcon(id));
      img.setAttribute("style", "image-rendering: pixelated");
      svg.appendChild(img);
      const border = document.createElementNS(SVGNS, "rect");
      border.setAttribute("x", x); border.setAttribute("y", y);
      border.setAttribute("width", size); border.setAttribute("height", size); border.setAttribute("rx", 3);
      border.setAttribute("fill", "none");
      border.setAttribute("stroke", stroke); border.setAttribute("stroke-width", "1.5");
      svg.appendChild(border);
    }
  host.appendChild(svg);
}

export function buildPortalDom() {
  buildPortalSpiral();
  for (const spec of PORTAL_TYPES) paintFrameArt(spec.art.host, spec.art);
}
