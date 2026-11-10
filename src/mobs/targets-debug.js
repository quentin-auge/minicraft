// Target debug (?cheat=1): the C-key flow — aim at a block, hold C to
// grow the selection into the box between that block and the cell under
// the cursor, release to arm the target, then aim at a mob and press C to
// send it there.
//
// The overlay shows the selection — a block, an area on the ground or
// on a wall, a volume — as a single translucent green box in its own
// extent, outlined by its 12 subtle edges, and the planned path in the
// same green — as floor squares while the mob walks, as cubes when it
// moves in 3D. The targeted mob is painted green too. A
// target with no path is refused at once; an arrival clears the overlay;
// a C press while a mob walks cancels everything.
//
// The box is drawn from its bounds, so a selection has no size limit: any
// volume is the same single box, however big it is.
//
// Debug only: the whole module is inert without the C key, and the C key
// itself is gated on ?cheat=1 in main.js.
import * as THREE from "three";
import { pickBlock } from "../player/edit.js";
import { pickMob } from "./pick.js";
import { setGreenPaint } from "./paint.js";
import { allMobs } from "./registry.js";
import { assignNav, clearNav } from "./nav.js";
import { dim } from "../core/store.js";
import { toast } from "../world/portals.js";
import {
  PHASE, createDebugState, startSelection, updateSelection, closeSelection,
  selectionBounds, cancelDebugState, cellChecksum, TINT,
} from "./targets-debug-state.js";

// The overlay: the green cells (the path) and the box (the selection,
// outlined by its edges). The cell mesh grows with the path; the box
// and its edges are single meshes whatever the selection's size.
const OVERLAY_MIN = 8192;
const OVERLAY_MAX = 262144;
// The floor square a walking path is drawn with: a thin slab on the
// cell's floor, so the trail reads on the ground.
const PATH_SLAB = 0.06;
// The path slab and the selection box float a hair off the surfaces they
// sit on: no face is exactly coplanar with the terrain, so none of them
// fights it.
const SHEET_LIFT = 0.002;
// The edges float a hair outside the box's own faces: polygon offset
// does not apply to lines, so this geometric pad is what keeps an edge
// that runs along a terrain face from fighting it.
const EDGE_PAD = 0.004;

let overlay = null;
let capacity = OVERLAY_MIN;
let selBox = null;
let edges = null;
let greenMat = null;
let edgeMat = null;
let tintMat = null;
let boxGeo = null;
let sceneRef = null;
let state = createDebugState();
let signature = "";

function aim(camera) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return { eye: camera.position, dir };
}

// The aimed block (liquids never block the debug aim).
function blockHit(camera) {
  const { eye, dir } = aim(camera);
  return pickBlock(eye, dir, true);
}

// The aimed mob (walls occlude it: the block distance bounds the pick).
function mobHit(camera) {
  const { eye, dir } = aim(camera);
  const hit = pickBlock(eye, dir, true);
  const mobs = allMobs().filter((m) => m.dim === dim);
  const picked = pickMob(mobs, eye, dir, { blockT: hit ? hit.t : Infinity });
  return picked ? picked.mob : null;
}

export function initTargetDebug(scene) {
  if (overlay) return;
  sceneRef = scene;
  // The debug green, one opacity everywhere: the selection box and the
  // path trail share it. The depth offset is the project's coplanar-decal
  // idiom (portals.js): the sheets always win over the terrain faces they
  // sit on, so nothing flickers.
  greenMat = new THREE.MeshBasicMaterial({
    color: TINT.green, transparent: true, opacity: TINT.overlayOpacity,
    depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // The selection's edges: the 12 lines of the box, and only them — no
  // cell borders anywhere. Thin (1 px, the WebGL fixed width) and dim,
  // so the box keeps its relief without shouting.
  edgeMat = new THREE.LineBasicMaterial({
    color: TINT.edgeColor, transparent: true, opacity: TINT.edgeOpacity, depthWrite: false,
  });
  // The targeted mob: fully opaque green (it reads as the one that owns
  // the path).
  tintMat = new THREE.MeshStandardMaterial({
    color: TINT.green, roughness: 0.9, transparent: TINT.mobOpacity < 1, opacity: TINT.mobOpacity,
  });
  boxGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
  overlay = makeOverlay(OVERLAY_MIN);
  scene.add(overlay);
  // The selection box: one unit cube scaled to the selection, whatever
  // its shape — with its edges, which follow it a hair outside.
  selBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), greenMat);
  selBox.visible = false;
  selBox.frustumCulled = false;
  selBox.renderOrder = 997;
  scene.add(selBox);
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), edgeMat);
  edges.visible = false;
  edges.frustumCulled = false;
  edges.renderOrder = 999;
  scene.add(edges);
}

function makeOverlay(n) {
  const m = new THREE.InstancedMesh(boxGeo, greenMat, n);
  m.count = 0;
  m.visible = false;
  m.frustumCulled = false;
  m.renderOrder = 998;
  return m;
}

// The mesh grows with the path: a longer plan needs more instances.
function ensureCapacity(n) {
  if (n <= capacity) return;
  let next = capacity || OVERLAY_MIN;
  while (next < n) next *= 2;
  next = Math.min(next, OVERLAY_MAX);
  if (next === capacity) return;
  const old = overlay;
  overlay = makeOverlay(next);
  capacity = next;
  // The replacement has to join the scene, or the overlay disappears.
  if (sceneRef) sceneRef.add(overlay);
  if (old && sceneRef) sceneRef.remove(old);
  if (old) old.dispose();
  signature = "";
}

// Green tint on the targeted mob's paintable body meshes (the farm
// quadrupeds expose `paintables`). The paint owner applies it — and gates
// it on `?color=1`, like every other debug colour — so the tint can
// never outlive the target.
function tintMob(mob, on) {
  if (!mob) return;
  setGreenPaint(mob, on ? tintMat : null);
}

// What the overlay shows: the selection box (its bounds) and the planned
// path.
function overlayContent() {
  const box = state.phase === PHASE.IDLE ? null : selectionBounds(state);
  const path = state.phase === PHASE.ACTIVE && state.path ? state.path : [];
  return { box, path };
}

// The selection: one box in the selection's own extent, a hair bigger
// than its cells — so no face is exactly coplanar with the terrain, and
// none of them fights it. The edges ride the same box a second hair
// outside it.
function drawBox(box) {
  const { lo, hi } = box;
  const w = { x: hi.x - lo.x + 1, y: hi.y - lo.y + 1, z: hi.z - lo.z + 1 };
  const c = { x: (lo.x + hi.x + 1) / 2, y: (lo.y + hi.y + 1) / 2, z: (lo.z + hi.z + 1) / 2 };
  selBox.scale.set(w.x + SHEET_LIFT * 2, w.y + SHEET_LIFT * 2, w.z + SHEET_LIFT * 2);
  selBox.position.set(c.x, c.y, c.z);
  selBox.visible = true;
  edges.scale.set(w.x + EDGE_PAD * 2, w.y + EDGE_PAD * 2, w.z + EDGE_PAD * 2);
  edges.position.set(c.x, c.y, c.z);
  edges.visible = true;
}

function refreshOverlay() {
  if (!overlay) return;
  const { box, path } = overlayContent();
  ensureCapacity(path.length);
  const sig = `${state.phase}|${path.length}|${state.pathFlat ? "flat" : "cube"}`
    + `|${box ? `${box.lo.x},${box.lo.y},${box.lo.z},${box.hi.x},${box.hi.y},${box.hi.z}` : "none"}`
    + `|${cellChecksum(path)}`;
  if (sig === signature) return;
  signature = sig;
  const m = new THREE.Matrix4();
  let n = 0;
  // The path: floor squares for a mob that walks, cubes for a 3D one.
  for (const c of path) {
    if (n >= capacity) break;
    if (state.pathFlat) {
      m.makeScale(1, PATH_SLAB, 1);
      // The slab floats a hair above the cell's floor: its own bottom
      // face never shares the terrain's.
      m.setPosition(c.x + 0.5, c.y + SHEET_LIFT + PATH_SLAB / 2, c.z + 0.5);
    } else {
      m.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5);
    }
    overlay.setMatrixAt(n++, m);
  }
  overlay.count = n;
  overlay.instanceMatrix.needsUpdate = true;
  overlay.visible = n > 0;
  // The selection: one box, whatever its shape.
  if (box) drawBox(box);
  else {
    selBox.visible = false;
    edges.visible = false;
  }
}

function cancelAll() {
  if (state.mob) {
    clearNav(state.mob);
    tintMob(state.mob, false);
  }
  cancelDebugState(state);
  refreshOverlay();
}

// C press: cancel while a mob walks, pick a mob while a target is armed,
// otherwise start a selection on the aimed block.
export function targetDebugKeyDown(camera) {
  if (state.phase === PHASE.ACTIVE) {
    cancelAll();
    return;
  }
  if (state.phase === PHASE.ARMED) {
    const mob = mobHit(camera);
    if (mob) {
      const plan = assignNav(mob, state.target);
      if (!plan) {
        toast("No path");
        cancelAll();
        return;
      }
      state.phase = PHASE.ACTIVE;
      state.mob = mob;
      state.path = plan.cells;
      state.pathFlat = !plan.moves3D;
      tintMob(mob, true);
      refreshOverlay();
      toast("Target set");
      return;
    }
  }
  const hit = blockHit(camera);
  if (!hit) return;
  startSelection(state, hit);
  refreshOverlay();
}

// C release: the selection becomes the target.
export function targetDebugKeyUp() {
  if (state.phase !== PHASE.SELECTING) return;
  if (!closeSelection(state)) {
    cancelAll();
    return;
  }
  refreshOverlay();
}

// Per-frame: the selection follows the aim while C is held, and an
// active target ends when its plan does.
export function tickTargetDebug(camera) {
  if (state.phase === PHASE.SELECTING) {
    const hit = blockHit(camera);
    if (hit) {
      updateSelection(state, hit);
      refreshOverlay();
    }
    return;
  }
  if (state.phase !== PHASE.ACTIVE) return;
  const mob = state.mob;
  if (!mob || mob.alive === false || !mob.nav) {
    // Arrived, gave up, or the mob died: the overlay and the tint go.
    tintMob(mob, false);
    state.mob = null;
    state.path = null;
    state.pathFlat = true;
    state.phase = PHASE.IDLE;
    state.target = null;
    refreshOverlay();
    return;
  }
  state.path = mob.nav.path;
  state.pathFlat = !mob.nav.moves3D;
  refreshOverlay();
}

// World reset or dimension travel: drop the target and the overlay.
export function resetTargetDebug() {
  cancelAll();
  if (overlay) {
    overlay.count = 0;
    overlay.visible = false;
  }
  signature = "";
}
