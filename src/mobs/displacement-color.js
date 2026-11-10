// Displacement-mode tint (?color=1 only): purple entry approach, orange
// while a live 2-wide passage holds (over any ride — the thread owns the
// inside), blue touch rides, red true 1-wide lanes, natural coats
// otherwise. Debug paint only — steering never reads it; headless rigs
// assert the mover flags (`tunnelPass`/`wallFollow`/`oneWide`/`inPassage`),
// never the paint.
//
// The paint itself belongs to `paint.js` (the one owner of a mob's
// materials): this module only says WHICH colour the mob's mode asks for,
// and the owner applies it — or ignores it, since the gate is `?color=1`.
//
// DELETION RECIPE (no other file holds tint state): delete this file and
// `paint.js`, drop the `applyDisplacementColor` import + its calls in
// `farm.js`, revert the `paint()` wrapper there to plain `part()` calls
// and the `userData` paint fields to `{ kind, legs, tailGroup }`.
import * as THREE from "three";
import { setModePaint } from "./paint.js";

// Single shared opaque mats, applied to the paintable body meshes and
// restored after.
const wallBlueMat = new THREE.MeshStandardMaterial({ color: 0x2255ff, roughness: 0.9 });
const laneRedMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.9 });
const tunnelPurpleMat = new THREE.MeshStandardMaterial({ color: 0x9933ff, roughness: 0.9 });
const passageOrangeMat = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.9 });

// The colour the mob's displacement mode asks for (null: the natural
// coat).
function modeColor(mob) {
  if (mob.tunnelPass) return tunnelPurpleMat;
  if (mob.inPassage) return passageOrangeMat;
  if (mob.wallFollow) return wallBlueMat;
  if (mob.oneWide) return laneRedMat;
  return null;
}

// The paint owner applies it (and gates it on ?color=1).
export function applyDisplacementColor(mob) {
  setModePaint(mob, modeColor(mob));
}
