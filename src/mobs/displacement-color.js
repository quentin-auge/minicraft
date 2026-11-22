// Displacement-mode tint (?color=1 only): purple entry approach, orange
// while a live 2-wide passage holds (over any ride — the thread owns the
// inside), red true 1-wide lanes, yellow while a staircase is walked
// (the step phase), blue touch rides, natural coats otherwise. Debug
// paint only — steering never reads it; headless rigs assert the mover
// flags (`tunnelPass`/`wallFollow`/`oneWide`/`inPassage`/`stepping`),
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
const stepYellowMat = new THREE.MeshStandardMaterial({ color: 0xffdd22, roughness: 0.9 });

// The modes and their order, strongest first: the violet entry commit,
// the orange 2-wide thread, the red 1-wide rail, the yellow staircase
// (the step phase), the blue wall ride. One list, so a new mode is one
// entry — the mover's flags are the only inputs (headless rigs assert
// the flags, never the paint).
const MODE_ORDER = [
  { flag: "tunnelPass", mat: tunnelPurpleMat },
  { flag: "inPassage", mat: passageOrangeMat },
  { flag: "oneWide", mat: laneRedMat },
  { flag: "stepping", mat: stepYellowMat },
  { flag: "wallFollow", mat: wallBlueMat },
];

// The colour the mob's displacement mode asks for (null: the natural
// coat). Red and blue never hold together (a lane is one or the other),
// so the order between them is behaviour-neutral.
function modeColor(mob) {
  for (const mode of MODE_ORDER) if (mob[mode.flag]) return mode.mat;
  return null;
}

// The paint owner applies it (and gates it on ?color=1).
export function applyDisplacementColor(mob) {
  setModePaint(mob, modeColor(mob));
}
