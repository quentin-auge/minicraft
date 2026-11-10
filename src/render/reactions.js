// Render side of the block reactions: the look a settled variant draws
// with, the translucent shell around it, and the run visuals (the trigger
// sinking into the cell, the droplets it throws up). The state lives in
// world/reactions.js (three-free); this module only draws it.
//
// The shell material is shared by every chunk (one per variant), so the
// breathing opacity is a single write per frame — the same trick the moon
// region uses for its crossfade. Shells inside a reveal region use
// region-owned clones instead (tracked below): they breathe the same way,
// composed with their region's fade factor.
import * as THREE from "three";
import { TEX, faceTex } from "../core/textures.js";
import { spawnBurst } from "../fx/particles.js";
import { VARIANT_LOOKS, activeRuns, onReaction } from "../world/reactions.js";

const matsCache = new Map();
const shellCache = new Map();

// Materials for a settled variant: the block faces in the variant's own
// texture (wet soil reads darker than dry soil).
export function variantMaterials(variant) {
  let m = matsCache.get(variant);
  if (!m) {
    const look = VARIANT_LOOKS[variant];
    m = faceTex(TEX[look.texture]);
    matsCache.set(variant, m);
  }
  return m;
}

// The translucent shell drawn around a settled cell, shared by every chunk.
export function shellMaterial(variant) {
  let m = shellCache.get(variant);
  if (!m) {
    const look = VARIANT_LOOKS[variant];
    m = new THREE.MeshBasicMaterial({
      color: look.shell.color,
      transparent: true,
      opacity: look.shell.base,
      depthWrite: false,
    });
    shellCache.set(variant, m);
  }
  return m;
}

// Slightly larger than the block, so the shell wraps the cell.
let shellGeo = null;
export function shellGeometry() {
  if (!shellGeo) shellGeo = new THREE.BoxGeometry(1.06, 1.06, 1.06);
  return shellGeo;
}

// Breathing shell: the opacity swells and fades on sim time (the pause
// contract — no wall clock in a tick path).
let lastSimTime = 0;
const lastPulse = new Map(); // variant -> opacity at lastSimTime
function pulseOp(variant, simTime) {
  const s = VARIANT_LOOKS[variant].shell;
  return s.base + s.amp * (0.5 + 0.5 * Math.sin((simTime * Math.PI * 2) / s.period));
}
export function pulseReactionShells(simTime) {
  lastSimTime = simTime;
  lastPulse.clear();
  for (const [variant, mat] of shellCache) {
    const op = pulseOp(variant, simTime);
    lastPulse.set(variant, op);
    mat.opacity = op;
  }
  for (const c of shellClones) applyShellFade(c, shellFade.get(c.regionKey) ?? 1);
}

// Region-owned shell clones: the mesher routes them through
// trackShellMaterial at creation, so they breathe with the shared shells —
// composed with their region's fade factor instead of fighting it (the
// generic fade loop in setRegionFade skips tagged materials, so one opacity
// has exactly one writer per path: pulse here, fade via syncShellFade).
const shellClones = []; // { mats, variant, regionKey }
const shellFade = new Map(); // regionKey -> last fade factor (default 1)
function applyShellFade(c, fade) {
  let op = lastPulse.get(c.variant);
  if (op === undefined) {
    op = pulseOp(c.variant, lastSimTime);
    lastPulse.set(c.variant, op);
  }
  const list = Array.isArray(c.mats) ? c.mats : [c.mats];
  for (const m of list) m.opacity = op * fade;
}
export function trackShellMaterial(mats, variant, regionKey) {
  // Rebuilds re-resolve the same cached clone: register once (identity),
  // but always recompose — the fade may have moved since creation.
  let entry = shellClones.find((c) => c.mats === mats);
  if (!entry) {
    const list = Array.isArray(mats) ? mats : [mats];
    for (const m of list) m.userData.shellPulse = { variant, regionKey };
    entry = { mats, variant, regionKey };
    shellClones.push(entry);
  }
  applyShellFade(entry, shellFade.get(regionKey) ?? 1);
  return mats;
}
// The region fade factor for a clone's region: stored and applied at once,
// so fades stay exact even while the sim (and the pulse tick) is frozen.
export function syncShellFade(regionKey, o) {
  shellFade.set(regionKey, o);
  for (const c of shellClones) {
    if (c.regionKey !== regionKey) continue;
    applyShellFade(c, o);
  }
}
// Drop every tracked clone: their region cache died with them in
// beginDispose (region-owned materials outlive chunk eviction by design, so
// no entry can go stale in between). Shared materials live for the session.
export function untrackShellMaterials() {
  shellClones.length = 0;
  shellFade.clear();
}

// Run visuals: one sinking cube per running reaction, plus the droplets
// thrown up when a reaction arms and when it settles.
let sceneRef = null;
const cubes = new Map();   // cell key -> mesh
const cubeGeo = new THREE.BoxGeometry(0.9, 1, 0.9);
const cubeMats = new Map();

function cubeMaterial(variant) {
  let m = cubeMats.get(variant);
  if (!m) {
    const look = VARIANT_LOOKS[variant];
    m = new THREE.MeshLambertMaterial({
      color: look.indicator.color,
      transparent: true,
      opacity: look.indicator.opacity,
    });
    cubeMats.set(variant, m);
  }
  return m;
}

function drips(x, y, z, variant) {
  const look = VARIANT_LOOKS[variant];
  if (!look) return;
  spawnBurst({
    x, y, z,
    count: look.drip.count,
    life: look.drip.life,
    size: look.drip.size,
    gravity: 22,
    additive: true,
    palette: look.drip.palette,
    direction: [0, -1, 0],
    speedMin: 1,
    speedMax: 3,
    up: 0,
  });
}

export function initReactionFx(scene) {
  sceneRef = scene;
  onReaction((ev) => {
    if (ev.type === "armed") drips(ev.x + 0.5, ev.y + 1.5, ev.z + 0.5, ev.mark);
    else if (ev.type === "settled") drips(ev.x + 0.5, ev.y + 1.2, ev.z + 0.5, ev.mark);
  });
}

// Sync the sinking cubes with the live reaction list and breathe the shells.
export function tickReactionFx(simTime) {
  if (!sceneRef) return;
  const live = new Set();
  for (const run of activeRuns()) {
    const k = `${run.x},${run.y},${run.z}`;
    live.add(k);
    let mesh = cubes.get(k);
    if (!mesh) {
      mesh = new THREE.Mesh(cubeGeo, cubeMaterial(run.mark));
      sceneRef.add(mesh);
      cubes.set(k, mesh);
    } else if (mesh.material !== cubeMaterial(run.mark)) {
      mesh.material = cubeMaterial(run.mark);
    }
    // The trigger sinks into the cell as the reaction runs.
    const p = Math.max(0.001, Math.min(1, run.t / run.duration));
    mesh.position.set(run.x + 0.5, run.y + 1 + p / 2, run.z + 0.5);
    mesh.scale.set(1, p, 1);
  }
  for (const [k, mesh] of cubes) {
    if (live.has(k)) continue;
    sceneRef.remove(mesh);
    cubes.delete(k);
  }
  pulseReactionShells(simTime);
}

// Drop every cube (new world / dimension travel).
export function clearReactionFx() {
  if (!sceneRef) return;
  for (const mesh of cubes.values()) sceneRef.remove(mesh);
  cubes.clear();
}
