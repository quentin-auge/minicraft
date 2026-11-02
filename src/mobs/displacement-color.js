// Displacement-mode tint (?color=1 only): blue touch rides, red true
// 1-wide lanes, natural coats otherwise. Debug paint only — steering never
// reads it; headless rigs assert the mover flags (`wallFollow`/`oneWide`),
// never the paint.
//
// DELETION RECIPE (no other file holds tint state): delete this file, drop
// the `applyDisplacementColor` import + its calls in `farm.js`, revert the
// `paint()` wrapper there to plain `part()` calls and the `userData`
// paint fields to `{ kind, legs, tailGroup }`.
import * as THREE from "three";

// Single shared opaque mats, applied to the paintable body meshes and
// restored after.
const wallBlueMat = new THREE.MeshStandardMaterial({ color: 0x2255ff, roughness: 0.9 });
const laneRedMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.9 });

// Cached ?color=1 read (this module never loads headless).
let colorGate = null;
export function colorEnabled() {
  if (colorGate == null) {
    colorGate = typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("color") === "1";
  }
  return colorGate;
}

// Paint state for one quadruped root: the paintable meshes plus the
// saved materials to restore.
export function initPaintState() {
  return { paintables: [], paintOn: false, paintMat: null, origMats: null };
}

export function applyDisplacementColor(mob) {
  if (!colorEnabled()) return;
  const root = mob.root;
  if (!root) return;
  const ud = root.userData;
  const want = mob.wallFollow ? wallBlueMat : mob.oneWide ? laneRedMat : null;
  if (want && ud.paintMat !== want) {
    if (!ud.paintOn) {
      ud.origMats = ud.paintables.map((m) => m.material);
      ud.paintOn = true;
    }
    for (const m of ud.paintables) m.material = want;
    ud.paintMat = want;
  } else if (!want && ud.paintOn) {
    ud.paintables.forEach((m, i) => { m.material = ud.origMats[i]; });
    ud.origMats = null;
    ud.paintOn = false;
    ud.paintMat = null;
  }
}
