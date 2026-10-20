// Registry-driven portals. Each family declares a destination dimension:
// End and TNT frames cross to it from anywhere, and return to the Overworld
// when already in it (the End return fill lights only once the
// dragon-cleared gate opens). The Nether is a temporary local loop until
// its dimension ships. Families share frame validation, fills, travel
// spiral, grapple interaction, and per-dimension frame indexing. A
// dimension's exits gate (DIMENSIONS exitsGate) closes every portal in it:
// validated windows stay overlap-testable in portalWindows and any touch
// answers the gate message instead of traveling.
//
// Cross-dimension travel remembers the portal left in the source dimension
// (travelLinks, one per dimension). Arriving back in a dimension uses that
// portal when it still validates, with master's safe-spot search and the
// destination's arrival facing (Overworld faces the portal, End faces away);
// otherwise the destination spawn is used.
//
// Extension shape: PORTAL_TYPES is the registry; the engine below never
// switches on family names, it dispatches through the spec's props —
// destination/anchorsFrom/evaluate/cells/bbox/inside/travel/art. New families
// (new frame block, sizes, fill, destination, travel action) register a spec
// and nothing else changes.
import * as THREE from "three";
import { AIR, PORTAL, OBSIDIAN, TNT, MEGA_TNT, ULTRA_TNT, isLiquid } from "../core/blocks.js";
import { materialsFor } from "../core/textures.js";
import { DIMENSION_KEYS, dim, dimBound, key, keyXYZ, getBlock, isSolid } from "../core/store.js";
import { dimSpec } from "./dimensions.js";
import {
  pos, vel, yaw, keys, setYaw, setPitch,
  PLAYER_HW, PLAYER_H,
} from "../player/physics.js";

export const PORTAL_TYPES = [
  {
    key: "end", destination: "end", enterMsg: "You entered The End",
    frame: PORTAL, fillColor: 0x000000,
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
    frame: OBSIDIAN, fillColor: 0x9b30ff,
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
    frame: [TNT, MEGA_TNT, ULTRA_TNT], fillColor: 0xd11a1a,
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

// Worldgen-placed frames, keyed by the generator (live edits track
// themselves via trackFrame, so a clear plus this list is exact). Scoped to
// the active dimension; dimension switches clear fills and rescan.
export function resetFrameSet(keys) {
  frameSets[dim].clear();
  for (const k of keys) frameSets[dim].add(k);
  portalDirty = true;
  // A fresh world never inherits a pending teleport from the last one.
  pendingTravel = null;
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

// --- Arrival spots (master return rules, local loop) ---

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

function chebDistToBox(ix, iz, box) {
  const dx = ix < box.minX ? box.minX - ix : ix > box.maxX ? ix - box.maxX : 0;
  const dz = iz < box.minZ ? box.minZ - iz : iz > box.maxZ ? iz - box.maxZ : 0;
  return Math.max(dx, dz);
}

function findReturnSpot(win, dir, wins) {
  const box = portalFrameBBox(win);
  const c = winCenter(win);
  const px = c.x + 0.5, pz = c.z + 0.5;
  const n = dir ? Math.hypot(dir.x, dir.z) : 0;
  const dx = n ? dir.x / n : 0, dz = n ? dir.z / n : 0;
  // Start two rings farther out than master's nearest spot so returns never
  // land right beside the frame; fall back outward only when those fail.
  for (let r = 3; r <= 5; r++) {
    for (const dy of [0, 1, -1, 2, -2]) {
      const feetY = box.baseY + dy;
      if (feetY < 1) continue;
      const ring = [];
      for (let ix = box.minX - r; ix <= box.maxX + r; ix++)
        for (let iz = box.minZ - r; iz <= box.maxZ + r; iz++) {
          if (chebDistToBox(ix, iz, box) !== r) continue;
          if (ix < -dimBound() || ix > dimBound() || iz < -dimBound() || iz > dimBound()) continue;
          ring.push([ix, iz]);
        }
      if (n) ring.sort((a, b) => ((b[0] + 0.5 - px) * dx + (b[1] + 0.5 - pz) * dz) - ((a[0] + 0.5 - px) * dx + (a[1] + 0.5 - pz) * dz));
      for (const [ix, iz] of ring) {
        if (!isSolid(ix, feetY - 1, iz)) continue;
        if (!returnBodyClear(ix + 0.5, feetY, iz + 0.5)) continue;
        if (inReturnPortalBody(wins, ix + 0.5, feetY, iz + 0.5)) continue;
        return { x: ix + 0.5, y: feetY, z: iz + 0.5 };
      }
    }
  }
  return null;
}

function frameTopSpot(win, wins) {
  const box = portalFrameBBox(win);
  const cols = [];
  if (win.orient === "v") {
    if (win.face === "x") {
      for (let z = box.minZ; z <= box.maxZ; z++) cols.push([box.minX, box.topY, z]);
    } else {
      for (let x = box.minX; x <= box.maxX; x++) cols.push([x, box.topY, box.minZ]);
    }
  } else {
    for (let x = box.minX; x <= box.maxX; x++)
      for (let z = box.minZ; z <= box.maxZ; z++) {
        const edge = x === box.minX || x === box.maxX || z === box.minZ || z === box.maxZ;
        if (edge) cols.push([x, box.topY, z]);
      }
  }
  const c = winCenter(win);
  cols.sort((a, b) => (Math.abs(a[0] - c.x) + Math.abs(a[2] - c.z)) - (Math.abs(b[0] - c.x) + Math.abs(b[2] - c.z)));
  for (const [fx, fy, fz] of cols) {
    if (!isSolid(fx, fy, fz)) continue;
    for (let feetY = fy + 1; feetY <= fy + 30; feetY++) {
      if (!isSolid(fx, feetY - 1, fz)) continue;
      if (!returnBodyClear(fx + 0.5, feetY, fz + 0.5)) continue;
      if (inReturnPortalBody(wins, fx + 0.5, feetY, fz + 0.5)) continue;
      return { x: fx + 0.5, y: feetY, z: fz + 0.5 };
    }
  }
  return null;
}

function winCenter(win) {
  if (win.orient === "h") {
    if (win.dims === "4x4") return { x: win.minX + 1.5, z: win.minZ + 1.5 };
    return { x: win.minX + 2, z: win.minZ + 2 };
  }
  if (win.face === "x") return { x: win.minX, z: win.minZ + (win.dims === "4x5" || win.dims === "4x4" ? 1.5 : 2) };
  return { x: win.minX + (win.dims === "4x5" || win.dims === "4x4" ? 1.5 : 2), z: win.minZ };
}

function facePortalFrom(win, px, pz) {
  const c = winCenter(win);
  return Math.atan2(-(c.x + 0.5 - px), -(c.z + 0.5 - pz));
}

function nearPortalSpawn(win, dir) {
  const c = winCenter(win);
  const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
  return findReturnSpot(win, dir, wins) || frameTopSpot(win, wins) || { x: c.x + 0.5, y: win.minY, z: c.z + 0.5 };
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
// regenerated) the anchor finds the nearest live window (End return frame),
// else the caller falls back to the dimension spawn.
export function resolveTravelArrival(dest, anchor = null) {
  const arrival = dimSpec(dest)?.arrival;
  if (!arrival || arrival.mode !== "portal") return null;
  const link = travelLinks.get(dest);
  let win = link?.win ?? null;
  if (win && specOf(win)?.evaluate(win) !== true) win = null;
  const linked = !!win;
  if (!win && anchor) win = nearestReturnWin(anchor.x, anchor.y, anchor.z);
  if (!win) return null;
  const c = winCenter(win);
  const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
  const spot = findReturnSpot(win, linked ? (link?.dir ?? null) : null, wins) || frameTopSpot(win, wins)
    || resolveSpawn(c.x + 0.5, win.minY, c.z + 0.5);
  const face = facePortalFrom(win, spot.x, spot.z);
  return { spot, yaw: arrival.facing === "away" ? face + Math.PI : face };
}

// Safe landing near (sx, sy, sz): body clearance, solid ground, never inside
// a portal interior (no arriving embedded, no instant re-trigger).
function resolveSpawn(sx, sy, sz) {
  const cx = Math.floor(sx), cz = Math.floor(sz), cy = Math.floor(sy);
  const wins = collectReturnWins(cx, cy, cz);
  // Try the exact cell first, then the master rings outward.
  for (let r = 0; r <= 3; r++) {
    for (const dy of [0, 1, -1, 2, -2, -3, 3]) {
      const feetY = cy + dy;
      if (feetY < 1) continue;
      for (let ix = cx - r; ix <= cx + r; ix++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (r > 0 && Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          if (ix < -dimBound() || ix > dimBound() || iz < -dimBound() || iz > dimBound()) continue;
          if (!isSolid(ix, feetY - 1, iz)) continue;
          if (!returnBodyClear(ix + 0.5, feetY, iz + 0.5)) continue;
          if (inReturnPortalBody(wins, ix + 0.5, feetY, iz + 0.5)) continue;
          return { x: ix + 0.5, y: feetY, z: iz + 0.5 };
        }
    }
  }
  return { x: sx, y: sy, z: sz };
}

// --- Travel (local loop: same window, spiral, cooldown) ---

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

function showPortalSpiral() {
  const el = document.getElementById("portalSpiral");
  if (!el) return;
  spiralGen++;
  el.style.display = "flex";
  void el.offsetWidth;
  el.classList.add("show");
}

function hidePortalSpiral() {
  const el = document.getElementById("portalSpiral");
  if (!el) return;
  const g = spiralGen;
  el.classList.remove("show");
  setTimeout(() => { if (spiralGen === g) el.style.display = "none"; }, PORTAL_FADE_OUT + 80);
}

// Pause contract: the spiral wait is a sim-time pending, decremented in
// tickPortals — never a wall-clock setTimeout — so pausing mid-spiral
// freezes it and the travel completes after unpausing.
let pendingTravel = null; // { spot?, yawV?, msg?, dim?, t }
function travelTo(plan) {
  if (portalBusy) return;
  portalBusy = true;
  portalCd = 1.5;
  showPortalSpiral();
  pendingTravel = { ...plan, t: (PORTAL_FADE_IN + 80) / 1000 };
}

function completeTravel() {
  const plan = pendingTravel;
  pendingTravel = null;
  // Cross-dimension plans carry dim: the main.js hook switches worlds and
  // resolves the arrival, then positions the player itself. Busy + spiral
  // stay held until main.js calls completeDimTravel() after the rebuild.
  if (plan.dim && plan.dim !== dim) {
    if (onTravelHook) onTravelHook(plan);
    if (plan.msg) toast(plan.msg);
    return;
  }
  if (onTravelHook) onTravelHook(plan);
  pos.set(plan.spot.x, plan.spot.y, plan.spot.z);
  vel.set(0, 0, 0);
  setYaw(plan.yawV ?? plan.yaw);
  setPitch(0);
  Object.keys(keys).forEach((k) => { keys[k] = false; });
  if (plan.msg || plan.toast) toast(plan.msg ?? plan.toast);
  portalBusy = false;
  hidePortalSpiral();
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
// switch (destination solidity differs), so this carries only the
// destination — completeTravel hands it to the dimension hook in main.js.
function destinationTravel(win) {
  const spec = specOf(win);
  const dest = dim === spec.destination ? "over" : spec.destination;
  return { dim: dest, toast: dest === "over" ? "You returned to the Overworld" : spec.enterMsg };
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
    if (raw.dim && raw.dim !== dim) {
      travelLinks.set(dim, { win: { ...f.win }, dir: { x: dir.x, z: dir.z } });
    }
    const plan = {
      spot: raw.spot, yaw: raw.yaw, yawV: raw.yawV ?? raw.yaw,
      msg: raw.msg ?? raw.toast ?? null, dim: raw.dim ?? null,
    };
    travelTo(plan);
    return;
  }
}

export function tickPortals(dt, canTravel) {
  // Fully frozen while paused: cooldown, fill scans, and the pending travel
  // all wait for the sim to run again.
  if (!canTravel) return;
  if (portalCd > 0) portalCd -= dt;
  if (pendingTravel) {
    pendingTravel.t -= dt;
    if (pendingTravel.t <= 0) completeTravel();
  }
  if (sceneRef) updatePortalVisual(dt);
  checkPortal();
  checkGatedWindows();
}

// --- Help diagrams + travel spiral art (master visuals) ---

const SVGNS = "http://www.w3.org/2000/svg";

function buildSpiralArms(svg, arms, turns, rOut, rIn, angHalf, gradId) {
  if (!svg) return;
  const steps = 64;
  for (let a = 0; a < arms; a++) {
    const base = (a / arms) * Math.PI * 2;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = rIn + (rOut - rIn) * t;
      const th = base + t * turns * Math.PI * 2;
      d += (i === 0 ? "M " : " L ") + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const r = rIn + (rOut - rIn) * t;
      const th = base + t * turns * Math.PI * 2 + angHalf;
      d += " L " + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
    }
    d += " Z";
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", gradId ? "url(#" + gradId + ")" : "#9b30ff");
    path.setAttribute("opacity", "0.92");
    svg.appendChild(path);
  }
}

function buildPortalSpiral() {
  const front = document.getElementById("portalSpiralFront");
  const back = document.getElementById("portalSpiralBack");
  if (front && !front.children.length) {
    const defs = document.createElementNS(SVGNS, "defs");
    const grad = document.createElementNS(SVGNS, "radialGradient");
    grad.setAttribute("id", "spiralGrad");
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("cx", "0"); grad.setAttribute("cy", "0"); grad.setAttribute("r", "100");
    for (const [off, col] of [["0%", "#eab4ff"], ["55%", "#9b30ff"], ["100%", "#2b0a4d"]]) {
      const s = document.createElementNS(SVGNS, "stop");
      s.setAttribute("offset", off); s.setAttribute("stop-color", col);
      grad.appendChild(s);
    }
    defs.appendChild(grad);
    front.appendChild(defs);
  }
  if (front && front.querySelectorAll("path").length === 0) {
    buildSpiralArms(front, 6, 1.5, 98, 6, 16 * Math.PI / 180, "spiralGrad");
  }
  if (back && back.querySelectorAll("path").length === 0) {
    buildSpiralArms(back, 4, 2.2, 82, 4, 24 * Math.PI / 180, null);
  }
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
