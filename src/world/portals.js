// Local-loop Nether/End portals: player-built frames only, no dimensions.
// Two frame families (End: PORTAL blocks, Nether: OBSIDIAN), each valid flat
// (horizontal) and upright (vertical). Touching a window's fill plays the
// travel spiral, then drops the player beside the same window, always
// facing the window just crossed.
//
// Extension shape: PORTAL_TYPES is the registry; the engine below never
// switches on family names, it dispatches through the spec's props —
// anchorsFrom/evaluate/cells/bbox/inside/travel/art. New families (new
// frame block, sizes, fill, travel action) register a spec and nothing else
// changes.
import * as THREE from "three";
import { AIR, PORTAL, OBSIDIAN } from "../core/blocks.js";
import { WORLD_RADIUS, key, keyXYZ, getBlock, isSolid } from "../core/store.js";
import {
  pos, vel, yaw, keys, setYaw, setPitch,
  PLAYER_HW, PLAYER_H,
} from "../player/physics.js";

export const PORTAL_TYPES = [
  {
    key: "end", frame: PORTAL, fillColor: 0x000000,
    *anchorsFrom(px, py, pz) { yield* endVerticalAnchors(px, py, pz); yield* endFlatAnchors(px, py, pz); },
    evaluate(w) { return evalEndWin(w); },
    cells: endFillCells,
    bbox: endBBox,
    inside: insideEndInterior,
    travel: (w, dir) => endTravel(w, dir),
    art: { host: "portalArt", cols: 5, rows: 5, corners: "skip", fill: "#5a2da6", stroke: "#7b2ff7" },
  },
  {
    key: "nether", frame: OBSIDIAN, fillColor: 0x9b30ff,
    *anchorsFrom(px, py, pz) { yield* netherVerticalAnchors(px, py, pz); yield* netherFlatAnchors(px, py, pz); },
    evaluate(w) { return evalNetherWin(w); },
    cells: netherFillCells,
    bbox: netherBBox,
    inside: insideNetherInterior,
    travel: (w, dir) => netherTravel(w, dir),
    art: { host: "netherArt", cols: 5, rows: 4, corners: "solid", fill: "#0a0a0a", stroke: "#8b90a0" },
  },
];

const specByKey = new Map(PORTAL_TYPES.map((s) => [s.key, s]));
const specOf = (win) => specByKey.get(win.type);
const frameIds = new Set(PORTAL_TYPES.map((s) => s.frame));
const isFrameBlock = (id) => frameIds.has(id);

// Index of every frame block, so scans only visit real candidates.
const frameSet = new Set();
export let portalDirty = true;

function trackFrame(x, y, z, id) {
  const k = key(x, y, z);
  if (isFrameBlock(id)) frameSet.add(k);
  else frameSet.delete(k);
}

export function notePortalEdit(x, y, z) {
  trackFrame(x, y, z, getBlock(x, y, z));
  portalDirty = true;
  // Same-frame pop at any distance: placement reach is unlimited, so the
  // player-centered scan would miss a far window until approached.
  refreshPortalFills(x, y, z);
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
// themselves via trackFrame, so a clear plus this list is exact).
export function resetFrameSet(keys) {
  frameSet.clear();
  for (const k of keys) frameSet.add(k);
  portalDirty = true;
}

// --- Window evaluation (shapes from master) ---
//
// A window is edge-valid when its ring matches; its interior may hold AIR
// or frame blocks (PORTAL/OBSIDIAN) of a crossing window — anything else
// fails. Evaluators return null, or the interior frame cells plus the ring
// cells for the support-closure pass below.

function innerCell(id, inner, x, y, z) {
  if (id === AIR) return true;
  if (isFrameBlock(id)) { inner.push([x, y, z]); return true; }
  return false;
}

function evalEndFlat(minX, minZ, by) {
  const inner = [], frame = [];
  for (let x = minX; x <= minX + 4; x++)
    for (let z = minZ; z <= minZ + 4; z++) {
      const isCorner = (x === minX || x === minX + 4) && (z === minZ || z === minZ + 4);
      const isEdge = x === minX || x === minX + 4 || z === minZ || z === minZ + 4;
      const id = getBlock(x, by, z);
      if (isCorner) {
        if (isFrameBlock(id)) frame.push([x, by, z]);
        continue;
      }
      if (isEdge) {
        if (id !== PORTAL) return null;
        frame.push([x, by, z]);
      } else if (!innerCell(id, inner, x, by, z)) return null;
    }
  return { inner, frame };
}

function evalEndVert(minX, minY, minZ, h, face = "z") {
  const inner = [], frame = [];
  const top = h === 4 ? minY + 3 : minY + 4;
  if (face === "x") {
    for (let y = minY; y <= top; y++)
      for (let z = minZ; z <= minZ + 4; z++) {
        const isCorner = (z === minZ || z === minZ + 4) && (y === minY || y === top);
        const isEdge = z === minZ || z === minZ + 4 || y === minY || y === top;
        const id = getBlock(minX, y, z);
        if (isCorner) {
          if (isFrameBlock(id)) frame.push([minX, y, z]);
          continue;
        }
        if (isEdge) {
          if (id !== PORTAL) return null;
          frame.push([minX, y, z]);
        } else if (!innerCell(id, inner, minX, y, z)) return null;
      }
    return { inner, frame };
  }
  for (let y = minY; y <= top; y++)
    for (let x = minX; x <= minX + 4; x++) {
      const isCorner = (x === minX || x === minX + 4) && (y === minY || y === top);
      const isEdge = x === minX || x === minX + 4 || y === minY || y === top;
      const id = getBlock(x, y, minZ);
      if (isCorner) {
        if (isFrameBlock(id)) frame.push([x, y, minZ]);
        continue;
      }
      if (isEdge) {
        if (id !== PORTAL) return null;
        frame.push([x, y, minZ]);
      } else if (!innerCell(id, inner, x, y, minZ)) return null;
    }
  return { inner, frame };
}

function evalNetherVert(minX, minY, minZ, w, h, face) {
  const inner = [], frame = [];
  for (let y = minY; y < minY + h; y++)
    for (let u = 0; u < w; u++) {
      const isEdge = u === 0 || u === w - 1 || y === minY || y === minY + h - 1;
      const x = face === "x" ? minX : minX + u;
      const z = face === "x" ? minZ + u : minZ;
      const id = getBlock(x, y, z);
      if (isEdge) {
        if (id !== OBSIDIAN) return null;
        frame.push([x, y, z]);
      } else if (!innerCell(id, inner, x, y, z)) return null;
    }
  return { inner, frame };
}

function evalNetherFlat(minX, minZ, by, ww, dd) {
  const inner = [], frame = [];
  for (let x = minX; x <= minX + ww - 1; x++)
    for (let z = minZ; z <= minZ + dd - 1; z++) {
      const isEdge = x === minX || x === minX + ww - 1 || z === minZ || z === minZ + dd - 1;
      const id = getBlock(x, by, z);
      if (isEdge) {
        if (id !== OBSIDIAN) return null;
        frame.push([x, by, z]);
      } else if (!innerCell(id, inner, x, by, z)) return null;
    }
  return { inner, frame };
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

function forEachFrameBlockNear(bx, by, bz, R, fn) {
  for (const pk of frameSet) {
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
      out.push({ win, inner: ev.inner, frame: ev.frame, key: k });
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
  for (const pk of frameSet) {
    const [x, y, z] = keyXYZ(pk);
    gatherFrom(x, y, z, seen, out);
  }
  return out;
}

function resolveWindows(cands) {
  const alive = new Set(cands.map((_, i) => i));
  const ringUsers = new Map(); // "x,y,z" -> candidate indices whose ring holds it
  cands.forEach((c, i) => {
    for (const [x, y, z] of c.frame) {
      const k = x + "," + y + "," + z;
      let s = ringUsers.get(k);
      if (!s) { s = new Set(); ringUsers.set(k, s); }
      s.add(i);
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...alive]) {
      let ok = true;
      for (const [x, y, z] of cands[i].inner) {
        if (getBlock(x, y, z) === AIR) continue;
        const users = ringUsers.get(x + "," + y + "," + z);
        if (!users || ![...users].some((j) => j !== i && alive.has(j))) { ok = false; break; }
      }
      if (!ok) { alive.delete(i); changed = true; }
    }
  }
  return cands.filter((_, i) => alive.has(i));
}

function winNear(win, cx, cy, cz, R) {
  const b = portalFrameBBox(win);
  const dx = cx < b.minX ? b.minX - cx : cx > b.maxX ? cx - b.maxX : 0;
  const dz = cz < b.minZ ? b.minZ - cz : cz > b.maxZ ? cz - b.maxZ : 0;
  const dy = cy < b.baseY ? b.baseY - cy : cy > b.topY ? cy - b.topY : 0;
  return Math.max(dx, dz, dy) <= R;
}

function syncFills(accepted, cx, cy, cz, R) {
  const keys = new Set(accepted.map((c) => c.key));
  for (const [k, f] of portalFills) {
    if (!winNear(f.win, cx, cy, cz, R)) continue;
    if (!keys.has(k)) {
      sceneRef.remove(f.group);
      portalFills.delete(k);
    }
  }
  for (const c of accepted) {
    if (!winNear(c.win, cx, cy, cz, R)) continue;
    ensurePortalFill(c.win);
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

function netherFillCells(win) {
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
    const xw = win.dims === "4x5" ? 2 : 3;
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

function fillKey(win) {
  return `${win.type}:${win.orient}:${win.face || "z"}:${win.minX},${win.minY},${win.minZ}${win.dims || ""}${win.h || ""}`;
}

function ensurePortalFill(win) {
  const k = fillKey(win);
  if (portalFills.has(k)) return;
  const spec = specOf(win);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(portalFillGeo, fillMat(spec)));
  layoutPortalFill(group, win);
  sceneRef.add(group);
  portalFills.set(k, { win, group });
}

export function clearPortalFills() {
  if (!sceneRef) { portalFills.clear(); return; }
  for (const f of portalFills.values()) sceneRef.remove(f.group);
  portalFills.clear();
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

function insideNetherInterior(win, bx, by, bz) {
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
  return bx >= win.minX + 1 && bx <= win.minX + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
}

function endBBox(w) {
  const topY = w.h === 4 ? w.minY + 3 : w.minY + 4;
  if (w.orient === "h") return { minX: w.minX, maxX: w.minX + 4, minZ: w.minZ, maxZ: w.minZ + 4, baseY: w.minY, topY: w.minY };
  if (w.face === "x") return { minX: w.minX, maxX: w.minX, minZ: w.minZ, maxZ: w.minZ + 4, baseY: w.minY, topY };
  return { minX: w.minX, maxX: w.minX + 4, minZ: w.minZ, maxZ: w.minZ, baseY: w.minY, topY };
}

function netherBBox(w) {
  if (w.orient === "v") {
    const ww = w.dims === "4x5" || w.dims === "4x4" ? 4 : 5;
    const hh = w.dims === "4x5" ? 5 : 4;
    if (w.face === "x") return { minX: w.minX, maxX: w.minX, minZ: w.minZ, maxZ: w.minZ + ww - 1, baseY: w.minY, topY: w.minY + hh - 1 };
    return { minX: w.minX, maxX: w.minX + ww - 1, minZ: w.minZ, maxZ: w.minZ, baseY: w.minY, topY: w.minY + hh - 1 };
  }
  const ww = w.dims === "4x5" ? 4 : 5, dd = w.dims === "4x5" ? 5 : 4;
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
  // Prefer landing ~3 blocks out; fall back farther, then closer.
  for (const r of [3, 4, 5, 2, 1]) {
    for (const dy of [0, 1, -1, 2, -2]) {
      const feetY = box.baseY + dy;
      if (feetY < 1) continue;
      const ring = [];
      for (let ix = box.minX - r; ix <= box.maxX + r; ix++)
        for (let iz = box.minZ - r; iz <= box.maxZ + r; iz++) {
          if (chebDistToBox(ix, iz, box) !== r) continue;
          if (ix < -WORLD_RADIUS || ix > WORLD_RADIUS || iz < -WORLD_RADIUS || iz > WORLD_RADIUS) continue;
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
  if (win.orient === "h") return { x: win.minX + 2, z: win.minZ + 2 };
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

// Safe landing near (sx, sy, sz): body clearance, solid ground, never inside
// a portal interior (no arriving embedded, no instant re-trigger).
function resolveSpawn(sx, sy, sz) {
  const cx = Math.floor(sx), cz = Math.floor(sz), cy = Math.floor(sy);
  const wins = collectReturnWins(cx, cy, cz);
  // Prefer landing ~3 blocks out; fall back farther, then closer.
  for (const r of [3, 4, 2, 1, 0]) {
    for (const dy of [0, 1, -1, 2, -2, -3, 3]) {
      const feetY = cy + dy;
      if (feetY < 1) continue;
      for (let ix = cx - r; ix <= cx + r; ix++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (r > 0 && Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          if (ix < -WORLD_RADIUS || ix > WORLD_RADIUS || iz < -WORLD_RADIUS || iz > WORLD_RADIUS) continue;
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

function showToast(msg) {
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

function travelTo(spot, yawV, msg) {
  if (portalBusy) return;
  portalBusy = true;
  portalCd = 1.5;
  showPortalSpiral();
  setTimeout(() => {
    if (onTravelHook) onTravelHook();
    pos.set(spot.x, spot.y, spot.z);
    vel.set(0, 0, 0);
    setYaw(yawV);
    setPitch(0);
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    if (msg) showToast(msg);
    portalBusy = false;
    hidePortalSpiral();
  }, PORTAL_FADE_IN + 80);
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

function endTravel(win, dir) {
  // Loop back beside the same window, facing it.
  const c = winCenter(win);
  const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
  const spot = findReturnSpot(win, dir, wins) || frameTopSpot(win, wins)
    || resolveSpawn(c.x + 0.5, win.minY, c.z + 0.5);
  return { spot, yaw: facePortalFrom(win, spot.x, spot.z), toast: null };
}

function netherTravel(win, dir) {
  // Loop back beside the same window, facing it.
  const near = nearPortalSpawn(win, dir);
  const spot = resolveSpawn(near.x, near.y, near.z);
  return { spot, yaw: facePortalFrom(win, spot.x, spot.z), toast: "You entered The Nether" };
}

function checkPortal() {
  if (portalCd > 0 || portalBusy) return;
  // First touched fill wins: crossing fills share cells, but entering along
  // a window's plane always touches its own slab first.
  for (const f of portalFills.values()) {
    if (!touchesPortalFill(f)) continue;
    const plan = specOf(f.win).travel(f.win, moveDir());
    travelTo(plan.spot, plan.yaw, plan.toast);
    return;
  }
}

export function tickPortals(dt, canTravel) {
  if (portalCd > 0) portalCd -= dt;
  if (sceneRef) updatePortalVisual(dt);
  if (canTravel) checkPortal();
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

function paintFrameArt(hostId, art) {
  const host = document.getElementById(hostId);
  if (!host || host.children.length) return;
  const { cols, rows, corners, fill, stroke } = art;
  const cell = 19, size = 15, off = 6;
  const w = off * 2 + (cols - 1) * cell + size;
  const h = off * 2 + (rows - 1) * cell + size;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "150");
  svg.setAttribute("height", String(Math.round(150 * h / w)));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const isCorner = (r === 0 && c === 0) || (r === 0 && c === cols - 1) || (r === rows - 1 && c === 0) || (r === rows - 1 && c === cols - 1);
      const isEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      if (!isEdge || (corners === "skip" && isCorner)) continue;
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", off + c * cell); rect.setAttribute("y", off + r * cell);
      rect.setAttribute("width", size); rect.setAttribute("height", size); rect.setAttribute("rx", 3);
      rect.setAttribute("fill", fill);
      rect.setAttribute("stroke", stroke); rect.setAttribute("stroke-width", "1.5");
      svg.appendChild(rect);
    }
  host.appendChild(svg);
}

export function buildPortalDom() {
  buildPortalSpiral();
  for (const spec of PORTAL_TYPES) paintFrameArt(spec.art.host, spec.art);
}
