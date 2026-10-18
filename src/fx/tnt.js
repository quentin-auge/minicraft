// TNT: breaking a TNT block lights a short fuse, then a spherical blast
// clears terrain and chains neighboring TNT. Blast kinds are data: shared
// properties live in TNT_DEFAULTS, entries override only what differs.
// Differing behavior is a capability flag the framework branches on
// (pool, knockback, light, clearsLiquids) or an optional function prop (carveBlast,
// spawnBlastFx, make/tick/clearLitVisual) that a tier supplies — kind
// strings (key, blastKind, countdownKind, fxKind) are stable identifiers,
// never branch conditions.
// Normal (radius 3, 3 s fuse), mega (pooled radius 15 / 22.5 / 33.75,
// capped at 40, 8 s fuse, simultaneous blasts, player knockback, one
// Firestorm Wall style), and ultra (black mega look, 8 s fuse, wipes one
// altitude band of the whole level across frames) ship as entries.
// Bedrock (y=0) is always spared; liquids survive unless the kind sets
// clearsLiquids (mega). A non-clearing TNT placed in liquid restores that
// liquid in its cell after its blast; a clearing kind leaves air behind.
// After every blast, liquids left with no solid 6-neighbor are purged back
// to air through an injected callback (set via onLiquidPurge), so blasts
// never strand floating remnants.
import { AIR, TNT, MEGA_TNT, ULTRA_TNT, FLOWER, GLOWSTONE, LOG, LEAVES, isLiquid, isTntLike } from "../core/blocks.js";
import { WORLD_RADIUS, colTops, colTopIdx, dim, getBlock, setBlock } from "../core/store.js";
import { CLOUD_MAX_Y } from "../world/clouds.js";
import { rebuildChunk, isChunkBuilt, chunkKeysForColumn, refreshBlocks } from "../render/mesher.js";
import { notePortalFramesOnly, clearPortalFills, scanWorldPortals } from "../world/portals.js";
import { GRAVITY, pos, vel, setOnGround, addPlayerKnockback, KNOCK_DECAY } from "../player/physics.js";
import { flyOn } from "../player/fly.js";
import { spawnBurst, spawnFlash, sharedFlashGeo, initBandShell, updateBandShell, hideBandShell, spawnDense, denseCount, noteDenseSpawn, resetDenseFx, flushDense } from "./particles.js";
import { clearGlowstoneAt } from "../world/glowstone.js";
import { clearFlowerAt } from "../world/flowers.js";
import { noteBlockLightEdit } from "../render/blocklights.js";
import * as THREE from "three";

// Master values: normal fuse 3 s, blast 3; mega fuse 8 s, pooled blast
// 15 / 22.5 / 33.75, capped at 40 (cap diameter ~ village diagonal).

const TNT_DEFAULTS = {
  fuse: 3.0,
  radius: 3,
  burst: 64,
  chainDelay: 0.05, // seconds between chained blasts (master: 50 ms)
  blastKind: "sphere", // "pooled" (mega) | "band" (ultra: whole altitude band)
  countdownKind: "sprite", // "bucket" (mega/ultra: veil + lights, no number)
  fxKind: "burst", // "mega" | "ultra" via spawnBlastFx
  pool: false,
  band: false, // true (ultra): carve one altitude band across frames
  countdownColor: null, // bucket-veil tint override (ultra: black)
  light: false,
  knockback: false,
  clearsLiquids: false, // true (mega): the blast clears liquids instead of passing through
};

// Mega-only blink choreography (master: exponential chirp 1 Hz -> ~14 Hz
// over the 8 s fuse). Normal TNT keeps its steady sprite; this drives only
// the mega veil, white heat, and lights.
const MEGA_BLINK = 0x2255ff;
const megaWhiteHeat = new THREE.Color(0xffffff);
const MEGA_BLINK_FMIN = 1, MEGA_BLINK_FMAX = 14;
const MEGA_BLINK_RATIO = MEGA_BLINK_FMAX / MEGA_BLINK_FMIN;
const MEGA_BLINK_LR = Math.log(MEGA_BLINK_RATIO);
function sstep01(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
function megaBlinkPhase(fuse, total) {
  const e = Math.min(Math.max(0, total - fuse), total * 1.5);
  return ((MEGA_BLINK_FMIN * total) / MEGA_BLINK_LR) * (Math.pow(MEGA_BLINK_RATIO, e / total) - 1);
}
function megaBlinkSmooth(fuse, total) {
  const p = megaBlinkPhase(fuse, total) % 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
}
// White heat ramps in during the last 5 s, snapping faster under 1.2 s.
function megaBlinkWhite(fuse) {
  if (fuse >= 5) return 0;
  if (fuse <= 1) return 1;
  return sstep01((5 - fuse) / 4);
}
function megaWhiteEff(fuse, total) {
  const w = megaBlinkWhite(fuse);
  const f = fuse >= 1.2 ? 0.3 : 0.3 + 0.7 * sstep01((1.2 - fuse) / 1.2);
  return w * (f + (1 - f) * megaBlinkSmooth(fuse, total));
}

// Lit-mega overlays: an additive blue veil box plus a white-heat box hugging
// the block (no mesher change, no remesh during the countdown), plus one
// telegraph shell per lit mega: it grows as the fuse burns down, so a field
// of lit megas reads as rising balls BEFORE anything explodes.
const megaVeils = new Map(); // "x,y,z" -> { veil, heat, shell }
let megaVeilGeo = null;
function megaVeilGeometry() {
  if (!megaVeilGeo) megaVeilGeo = new THREE.BoxGeometry(1.04, 1.04, 1.04);
  return megaVeilGeo;
}
function veilColorFor(kind) {
  return (kind && kind.countdownColor) ?? MEGA_BLINK;
}
// One transient light per pooled member blast (not per countdown bucket).
const blastLights = []; // { light, life, max }
function tickBlastLights(dt) {
  for (let i = blastLights.length - 1; i >= 0; i--) {
    const b = blastLights[i];
    b.life -= dt;
    if (b.life <= 0) {
      if (sceneRef) sceneRef.remove(b.light);
      blastLights.splice(i, 1);
      continue;
    }
    const f = b.life / b.max;
    b.light.intensity = 900 * f * f;
  }
}
function makeMegaLitVisual(x, y, z, kind) {
  const k = x + "," + y + "," + z;
  if (!sceneRef || megaVeils.has(k)) return;
  const veil = new THREE.Mesh(
    megaVeilGeometry(),
    new THREE.MeshBasicMaterial({ color: veilColorFor(kind), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  veil.position.set(x + 0.5, y + 0.5, z + 0.5);
  const heat = new THREE.Mesh(
    megaVeilGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
  );
  heat.position.copy(veil.position);
  sceneRef.add(veil);
  sceneRef.add(heat);
  const shell = new THREE.Mesh(
    sharedFlashGeo(),
    new THREE.MeshBasicMaterial({ color: veilColorFor(kind), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  shell.position.copy(veil.position);
  shell.scale.setScalar(0.001);
  sceneRef.add(shell);
  megaVeils.set(k, { veil, heat, shell });
  syncMegaLights();
}
function tickMegaLitVisual(k, t, kind) {
  const v = megaVeils.get(k);
  if (v) {
    const eff = megaWhiteEff(t.fuse, kind.fuse);
    const w = megaBlinkWhite(t.fuse);
    const b = megaBlinkSmooth(t.fuse, kind.fuse);
    v.veil.material.color.setHex(veilColorFor(kind)).lerp(megaWhiteHeat, eff);
    v.veil.material.opacity = 0.05 + 0.45 * b * w + 0.1 * eff;
    v.heat.material.opacity = Math.min(0.9, eff);
    // Telegraph ball: grows 0.3 -> 1.2 blocks over the last 3 s of fuse.
    const g = Math.max(0, Math.min(1, (3 - Math.max(0, t.fuse)) / 3));
    v.shell.scale.setScalar(Math.max(0.001, 0.3 + 0.9 * g));
    v.shell.material.color.setHex(veilColorFor(kind));
    v.shell.material.opacity = 0.45 * g;
  }
  syncMegaLights();
}
function clearMegaLitVisual(k) {
  const v = megaVeils.get(k);
  if (v) {
    megaVeils.delete(k);
    if (sceneRef) {
      sceneRef.remove(v.veil);
      sceneRef.remove(v.heat);
      sceneRef.remove(v.shell);
    }
    v.veil.material.dispose();
    v.heat.material.dispose();
    v.shell.material.dispose();
  }
  syncMegaLights();
}

// Pooled surrounding lights for lit megas (max 8, one per crater sphere).
const MEGA_LIGHT_MAX = 8;
const megaLights = []; // { light, key }
const megaLightBeats = new Map(); // spotKey -> { beats, was }
// Pool clustering for countdown lights: each lit mega maps to the crater
// radius its pool will actually carve (same clustering as detonation), so
// the light swell ends exactly at the crater edge — 15 for a solo mega,
// never a flat 44 over everything. Placement version: bumped whenever the
// mega index changes, so the light spots below recompute. Never ticked per
// frame.
let clusterVersion = 0;
function markClusterDirty() { clusterVersion++; }
// Countdown swell: how the pre-blast lights reach the full crater radius.
// Arrival is driven by fuse time (ease-out, locking on R exactly at
// detonation with a fixed white hold for the last 0.2 s), never by the
// blink phase. Applies to mega and ultra alike (ultra rides the same
// bucket path with whole-level range); band spots step on fuse time
// instead of white heat, so the sweep visibly crosses the whole level
// with a near-black off-gate for full-level contrast.
// Arrival progress 0→1 across the whole fuse (0 at ignition, 1 exactly at
// detonation), eased-out downstream. Unlike eff (white heat, blink-gated),
// this never stutters: the swell below always lands smoothly on R.
function arrivalProgress(fuse, total) {
  const t = Math.max(0, Math.min(1, (total - fuse) / Math.max(0.001, total)));
  return t * t * (3 - 2 * t);
}
// Light spots, recomputed only when placements or the lit set change
// (version + lit signature); fuses are read live every frame. One spot per
// crater sphere — including unlit stragglers, which detonate with the pool
// — so the lit union matches the carved union exactly.
let spotCache = { sig: null, spots: [] };
function computeLightSpots() {
  const spots = [];
  const seen = new Set();
  for (const t of lit.values()) {
    const tk = kindOf(t.kind);
    if (!tk.light) continue;
    const k = t.x + "," + t.y + "," + t.z;
    if (seen.has(k)) continue;
    if (tk.band) {
      spots.push({ x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5, band: true, R: ULTRA_FULL_R, kind: t.kind, fminKey: k, total: t.total, key: "band:" + k });
      seen.add(k);
      continue;
    }
    const { members, sized } = collectMegaCluster(t.x, t.y, t.z, tk);
    if (!members.length) continue;
    // Cluster fuse = earliest lit member (stragglers have no fuse of their
    // own but detonate with the pool, flickering in sync).
    let fminKey = null, fmin = Infinity, tot = t.total;
    for (const m of members) {
      const lt = lit.get(m.key);
      if (lt && lt.fuse < fmin) { fmin = lt.fuse; fminKey = m.key; tot = lt.total; }
    }
    if (fminKey === null) continue;
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (seen.has(m.key)) continue;
      seen.add(m.key);
      spots.push({ x: m.x + 0.5, y: m.y + 0.5, z: m.z + 0.5, band: false, R: sized[i]?.r ?? tk.radius, kind: t.kind, fminKey, total: tot, key: m.key });
    }
  }
  // Largest craters first so the 8-light cap covers the most ground.
  spots.sort((a, b) => b.R - a.R);
  return spots;
}
function syncMegaLights() {
  let sig = clusterVersion + "|";
  const lk = [...lit.keys()].sort();
  sig += lk.join(";");
  if (spotCache.sig !== sig) spotCache = { sig, spots: computeLightSpots() };
  const use = spotCache.spots.slice(0, MEGA_LIGHT_MAX);
  const useKeys = new Set(use.map((s) => s.key));
  for (const k of [...megaLightBeats.keys()]) {
    if (!useKeys.has(k)) megaLightBeats.delete(k);
  }
  use.forEach((s, i) => {
    let L = megaLights[i];
    if (!L) {
      L = { light: new THREE.PointLight(MEGA_BLINK, 60, 7, 1), key: null };
      if (sceneRef) sceneRef.add(L.light);
      megaLights[i] = L;
    }
    const lt = lit.get(s.fminKey);
    if (!lt) {
      L.light.visible = false;
      L.key = null;
      return;
    }
    const b = megaBlinkSmooth(lt.fuse, s.total);
    const eff = megaWhiteEff(lt.fuse, s.total);
    const kk = Math.max(0, Math.min(1, (5 - lt.fuse) / 4));
    let st = megaLightBeats.get(s.key);
    if (!st) {
      st = { beats: 0, was: 0 };
      megaLightBeats.set(s.key, st);
    }
    if (b >= 0.5 && st.was < 0.5) st.beats++;
    st.was = b;
    L.key = s.key;
    L.light.visible = true;
    L.light.position.set(s.x, s.y + 1, s.z);
    // Range swells with the white heat to this member's own carved radius
    // (ultra bands cover the whole level). Edge brightness scales with R so
    // big pools stay readable at their rim. Physical falloff (decay 1) kills
    // the rim well inside the cutoff, so the cutoff is pushed 60 % past the
    // crater: the bright disc still reads out to R, fading to zero just
    // outside instead of dying visibly short of it. Band spots covering the
    // whole level get a stronger edge factor and intensity cap — same
    // formula, rescaled for R271 instead of a 15 crater.
    const Rcover = s.band ? ULTRA_FULL_R : Math.max(s.R, 12);
    let base = 60 + b * (80 + 140 * kk) + eff * 120;
    const edge = s.band ? Math.min(16, Rcover / 15) : Math.min(8, Rcover / 15);
    // Arrival progress 0→1 across the whole fuse (1 exactly at detonation):
    // the swell eases out onto R and never overshoots, then locks on with
    // a fixed white hold for the last 0.2 s.
    const arr = arrivalProgress(lt.fuse, s.total);
    let dist, mult;
    // Hard gate on the chirp + stepped range: full R by quarter-steps.
    // Band spots (whole level) step on fuse time instead of white heat, so
    // the sweep visibly crosses the level instead of jumping at the
    // end; their off-gate runs near-black for full-level contrast.
    if (lt.fuse <= 0.2) {
      dist = Rcover;
      mult = 2.5;
      base = Math.max(base, 500);
      L.light.color.setHex(0xffffff);
    } else {
      const gate = b > 0.5 ? 1 : (s.band ? 0.05 : 0.15);
      const prog = s.band ? arr : eff;
      dist = 12 + (Rcover - 12) * Math.min(1, Math.floor(prog * 4.999) / 4);
      mult = 3 * gate;
      L.light.color.setHex(MEGA_BLINK).lerp(megaWhiteHeat, eff);
    }
    L.light.intensity = Math.min(s.band ? 24000 : 6000, base * mult * edge);
    L.light.distance = dist * 1.6;
  });
  for (let i = use.length; i < megaLights.length; i++) {
    megaLights[i].light.visible = false;
    megaLights[i].key = null;
  }
}

// Pooled mega geometry: members link within blast distance (R = 15),
// transitively; each member's blast radius compounds +50% per neighbour
// within its current R/2, capped at 40 (Ø80 ~= village diagonal):
// 15 / 22.5 / 33.75 / 40 / ...
const MEGA_POOL_RADIUS_MAX = 40;
function megaPoolRadius(kind, n) {
  return Math.min(MEGA_POOL_RADIUS_MAX, kind.radius * Math.pow(1.5, Math.max(0, n - 1)));
}

// Mega blast FX scales with the member count; the pooled radius above
// decides the crater and knockback reach. One dense GPU engine
// (spawnDense): counts scale with R^3 so big pools get denser, and the
// fireball fills the full crater.
const FIRE = [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]];
const EMBERW = [1, 0.95, 0.8];
function D(R, per, min, max) { return denseCount(R, per, min, max); }
// Single post-detonation clock for every mega/ultra visual: recipes stay
// authored in base seconds, and the shared clock paces them.
export const MEGA_BLAST_TIME_SCALE = 1;
export const MEGA_BLAST_T = 2.2 * MEGA_BLAST_TIME_SCALE;
// Pooled and ultra union shells share one cap: a full-level sphere would be
// screens of overdraw, while R64 already reads as enormous.
export const MEGA_UNION_SHELL_R = 64;
function blastSeconds(s) { return s * MEGA_BLAST_TIME_SCALE; }
function blastSpeed(v) {
  if (!Number.isFinite(v) || v >= 1e8) return v; // pops stay instant
  return v / MEGA_BLAST_TIME_SCALE;
}
// Base lives per mega recipe family. Ultra phases reuse the same bases, so
// staging a mega component never changes its authored duration.
function megaBaseLives(key) {
  return {
    fire: key === "smoke" ? 1.2 : 1.6,
    smoke: key === "smoke" ? 4.0 : 2.4,
  };
}
// Rolling-ignition base delay, set while draining queued FX members so one
// member's layers all share its stagger offset (snapshot per job).
let fxBaseDelay = 0;
function shell2(cx, cy, cz, R, c1, c2, t1, e1, t2, e2) {
  // Pops, never retracting spheres: expand at the staged speed, then vanish
  // in a frame instead of visibly shrinking back.
  spawnFlash({ x: cx, y: cy, z: cz, color: c1, maxRadius: R, speed: blastSpeed(R / t1), retractSpeed: 1e9, doubleside: true, fogOff: true });
  spawnFlash({ x: cx, y: cy, z: cz, color: c2, maxRadius: 0.55 * R, speed: blastSpeed((0.55 * R) / t2), retractSpeed: 1e9, doubleside: true, fogOff: true });
}
// Reusable mega phase builder helper. Ultra schedules whole canonical
// phases as sim-time FX jobs, so each phase seeds alone and needs no quota:
// volumes scale with R^3 via denseCount, hard-capped by the GPU pools.
function phaseLayer(h, o, role, per, min, max, rest = {}) {
  const { delay = 0, life = 1.5, R = h.R, ...props } = rest;
  // Per-phase life scale (ultra trims the Titan smoke tail without touching
  // the canonical recipes; mega never sets it, so its visuals stay exact).
  const scaledLife = life * (h.lifeScale ?? 1);
  const start = delay + (h.baseDelay ?? 0) + (o.delay ?? 0);
  h.maxEnd = Math.max(h.maxEnd ?? 0, start + scaledLife);
  return spawnDense({
    x: h.cx, y: h.cy, z: h.cz, R, role,
    count: D(R, per, min, max),
    defer: true, ...props, life: blastSeconds(scaledLife), delay: blastSeconds(start),
  });
}
// Shell scope for one phase. Mega burns with "full" shells; ultra passes
// shells:false + shellMode:"off", keeping full-level density in particles
// only.
function shellScope(h, mode) {
  const m = mode ?? h.shellMode ?? (h.shells ? "full" : "off");
  const on = m !== "off" && h.shells !== false;
  return {
    shell: (c1, c2, t1, e1, t2, e2) => { if (on) shell2(h.cx, h.cy, h.cz, h.R, c1, c2, t1, e1, t2, e2); },
    flash: (o) => {
      if (!on) return;
      spawnFlash({ ...o, retractSpeed: 1e9 });
    },
  };
}
// Single mega style: Firestorm Wall. The V-cycled style registry is gone;
// the canonical phase builders below serve it and the ultra mix directly.
const MEGA_STYLE_KEY = "wall";
// Canonical mega phase builders. Mega and ultra compose them, so the same
// recipe cannot drift between tiers.
function buildWallBurst(h, o = {}) {
  const s = shellScope(h, o.shell);
  s.flash({ x: h.cx, y: h.cy, z: h.cz, color: 0xff7a1a, maxRadius: h.R, speed: h.R / 0.9, doubleside: true, fogOff: true });
  phaseLayer(h, o, "fire", 0.7 * h.boost, 5000, 20000, { life: 1.5, palette: FIRE, speedMin: 8, speedMax: 20, up: 5, gravity: 4, size: 28, shape: "shell" });
  phaseLayer(h, o, "ember", 0.3 * h.boost, 2000, 9000, { life: 1.2, palette: FIRE, speedMin: 4, speedMax: 12, up: 8, gravity: -2, size: 22, shape: "ball" });
  phaseLayer(h, o, "smoke", 0.25 * h.boost, 1500, 9000, { life: h.lives.smoke, color: [0.25, 0.22, 0.2], variance: [0.1, 0.1, 0.1], speedMin: 1, speedMax: 6, up: 10, gravity: -3, size: 42, shape: "ball" });
}
function buildTornadoColumn(h, o = {}) {
  const s = shellScope(h, o.shell);
  s.flash({ x: h.cx, y: h.cy, z: h.cz, color: 0xfff3d0, maxRadius: 0.6 * h.R, speed: (0.6 * h.R) / 0.5, doubleside: true, fogOff: true });
  phaseLayer(h, o, "fire", 0.75 * h.boost, 5000, 22000, { life: 2.0, palette: FIRE, speedMin: 2, speedMax: 8, up: 10, gravity: -8, size: 28, shape: "column" });
  phaseLayer(h, o, "ember", 0.3 * h.boost, 2000, 9000, { life: 1.4, color: EMBERW, variance: [0, 0.05, 0.1], speedMin: 4, speedMax: 14, up: 16, gravity: -6, size: 22, shape: "column" });
  phaseLayer(h, o, "smoke", 0.2 * h.boost, 1500, 8000, { life: h.lives.smoke, color: [0.25, 0.22, 0.2], variance: [0.1, 0.1, 0.1], speedMin: 1, speedMax: 5, up: 14, gravity: -4, shape: "column", size: 42 });
}
function buildShockRings(h, o = {}) {
  const s = shellScope(h, o.shell);
  // Fat centered shock rings: no offsets, ×4 vertical thickness.
  for (let i = 0; i < 3; i++)
    s.flash({ x: h.cx, y: h.cy, z: h.cz, color: [0xfff3d0, 0xff7a1a, 0xc22400][i], maxRadius: (0.6 + 0.2 * i) * h.R, speed: h.R / (0.4 + 0.25 * i), doubleside: true, fogOff: true });
  phaseLayer(h, o, "fire", 0.7 * h.boost, 5000, 20000, { life: 1.4, palette: FIRE, speedMin: 14, speedMax: 30, up: 2, gravity: 6, size: 24, shape: "ring", vSpread: 4 });
  phaseLayer(h, o, "smoke", 0.25 * h.boost, 1500, 9000, { life: h.lives.smoke, color: [0.25, 0.22, 0.2], variance: [0.1, 0.1, 0.1], speedMin: 2, speedMax: 7, up: 8, gravity: -3, size: 40, shape: "ball" });
}
function buildTitanSmoke(h, o = {}) {
  const s = shellScope(h, o.shell);
  s.flash({ x: h.cx, y: h.cy, z: h.cz, color: 0xff7a1a, maxRadius: 0.6 * h.R, speed: (0.6 * h.R) / 0.5 });
  phaseLayer(h, o, "fire", 0.35 * h.boost, 2500, 10000, { life: h.lives.fire, palette: FIRE, speedMin: 3, speedMax: 10, up: 7, gravity: -4, size: 28, shape: "ball" });
  phaseLayer(h, o, "smoke", 0.95 * h.boost, 6500, 24000, { life: h.lives.smoke, color: [0.32, 0.28, 0.24], variance: [0.1, 0.1, 0.1], speedMin: 2, speedMax: 9, up: 11, gravity: -3, size: 48, shape: "ball" });
  phaseLayer(h, o, "smoke", 0.4 * h.boost, 3000, 12000, { life: h.lives.smoke, color: [0.16, 0.14, 0.13], variance: [0.06, 0.06, 0.06], speedMin: 1, speedMax: 5, up: 13, gravity: -2, size: 52, shape: "ball", delay: 0.3 });
}
// Shared dispatch for the phases mega and ultra stage.
const MEGA_PHASES = {
  wall: buildWallBurst,
  tornado: buildTornadoColumn,
  rings: buildShockRings,
  smoke: buildTitanSmoke,
};
function spawnMegaBlastFx(x, y, z, kind, mult = 1, fx = null) {
  const m = Math.max(1, Math.min(mult, 6));
  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  const key = fx?.key ?? MEGA_STYLE_KEY;
  // Explicit-R override (ultra phases burn at full-level diameter);
  // otherwise the pooled radius from member count and linkage.
  const R = fx?.R ?? megaPoolRadius(kind, mult);
  // Density grows slightly with member count (boost), hard-capped by the
  // GPU pools so looots of megas never freeze the frame.
  const share = fx?.share ?? 1;
  const shells = fx?.shells ?? true;
  fxBaseDelay = fx?.delay ?? 0;
  const boost = (1 + 0.15 * (m - 1)) * share;
  const lives = megaBaseLives(key);
  const h = { cx, cy, cz, R, boost, lives, shells, shellMode: fx?.shellMode ?? null, baseDelay: fxBaseDelay, maxEnd: 0, m, lifeScale: fx?.lifeScale ?? 1 };
  // One union fireball per pooled blast (single fx job at the centroid),
  // so shells never multiply. Pops vanish instead
  // of retracting (see shell2) — no shrinking sphere anywhere.
  MEGA_PHASES[key]?.(h);
  // No per-member uploads or lights here: the pooled blast flushes once and
  // owns a single light (see explodePool), so mass detonations stay flat.
  noteDenseSpawn(Math.max(blastSeconds(h.maxEnd), blastSeconds(Math.max(lives.fire, lives.smoke))) + 0.5);
}
// Single pooled-blast light, shared by all members (uploads flush in
// drainFxJobs, so queued members never pay per-member re-uploads).
function poolLight(ax, ay, az, R, key, color = null) {
  if (sceneRef) {
    const col = color ?? 0xff8a2a;
    const L = new THREE.PointLight(col, 900, Math.max(60, R * 3), 1.6);
    L.position.set(ax + 0.5, ay + 2.5, az + 0.5);
    sceneRef.add(L);
    const life = blastSeconds(1.2);
    blastLights.push({ light: L, life, max: life });
  }
}

// Single ultra mix: tornado, fat shock rings, wall, trimmed Titan smoke —
// one sim-time FX job per phase: each canonical style spawns alone through
// the shared mega dispatcher (full recipe, particles only — no mesh shells
// or flash spheres at full-level radius), so phases never evict each other
// from the pools. The rings burn fat and centered: ×1.4 radius, ×4
// thickness, ×1.2 duration. The band carve underneath is unchanged.
const ULTRA_PHASES = [
  { style: "tornado", delay: 0 },
  { style: "rings", delay: 0.25 },
  { style: "wall", delay: 0.5 },
  { style: "smoke", delay: 0.5, lifeScale: 0.5 },
];
const ULTRA_RING_R = 1.4, ULTRA_RING_DUR = 1.2;
function spawnUltraBlastFx(x, y, z, kind) {
  // lifeScale is applied when each job drains (see spawnMegaBlastFx): the
  // queued job only carries the authored phase options.
  for (const phase of ULTRA_PHASES) {
    const isRing = phase.style === "rings";
    fxJobs.push({
      x, y, z, kind, k: 1, share: 1, shells: false, shellMode: "off",
      key: phase.style, delay: 0,
      R: isRing ? ULTRA_FULL_R * ULTRA_RING_R : ULTRA_FULL_R,
      lifeScale: (phase.lifeScale ?? 1) * (isRing ? ULTRA_RING_DUR : 1),
      due: simNow + blastSeconds(phase.delay ?? 0),
    });
  }
  poolLight(x, y, z, ULTRA_FULL_R, "ultra", 0xff7a1a);
}

// Ultra bands: the overworld is wiped one altitude band per blast — ground
// (1..90), cloud (91..CLOUD_MAX_Y + 1), moon (above, to the column top).
// The bounds derive from the cloud module so the sky stack never drifts.
export const ULTRA_BAND1_HI = 90;
export const ULTRA_BAND2_HI = CLOUD_MAX_Y + 1;
export const ULTRA_FULL_R = WORLD_RADIUS * 2 * Math.SQRT2;
export function ultraBandOf(y) {
  if (y < ULTRA_BAND1_HI + 1) return 1;
  if (y <= ULTRA_BAND2_HI) return 2;
  return 3;
}
export function ultraBandRange(band) {
  if (band === 1) return [1, ULTRA_BAND1_HI];
  if (band === 2) return [ULTRA_BAND1_HI + 1, ULTRA_BAND2_HI];
  return [ULTRA_BAND2_HI + 1, null]; // to the column top
}

// Tree canopies rooted in the ground band can overhang above it: flood up
// from LOG cells at the band ceiling through LOG/LEAVES (capped), so band 1
// takes the whole tree, not a floating canopy.
function ultraOverhangCells() {
  const out = [];
  const seen = new Set();
  const stack = [];
  for (let gx = -WORLD_RADIUS; gx <= WORLD_RADIUS; gx++)
    for (let gz = -WORLD_RADIUS; gz <= WORLD_RADIUS; gz++)
      if (getBlock(gx, ULTRA_BAND1_HI, gz) === LOG) stack.push([gx, ULTRA_BAND1_HI, gz]);
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (stack.length && out.length < 20000) {
    const [x, y, z] = stack.pop();
    const kk = x + "," + y + "," + z;
    if (seen.has(kk)) continue;
    seen.add(kk);
    // Seeds sit at the ceiling itself; only below-ceiling cells are out of
    // scope (the band carve already takes them).
    if (y < ULTRA_BAND1_HI) continue;
    const id = getBlock(x, y, z);
    if (id !== LOG && id !== LEAVES) continue;
    out.push([x, y, z]);
    for (const [dx, dy, dz] of NB) stack.push([x + dx, y + dy, z + dz]);
  }
  return out;
}

// Sliced band carve: columns sorted radially from the ignition so the wipe
// reads as an expanding front; drained under a fixed per-tick column budget
// (deterministic, pause-safe). Carving only mutates voxels and records dirty
// chunk keys — remeshing happens separately in drainBandRemesh under its own
// millisecond budget, gated on the carve frontier, so no chunk rebuilds
// twice and no tick pays an unbounded rebuild avalanche.
const BAND_COLS_PER_TICK = 2048;
const REMESH_BUDGET_MS = 6;
const bandJobs = []; // { cx..cz, band, yLo, yHi, kind, cols, ci, cells, celli, front2, dirty, fxAcc, carveDone }
// Non-band blasts detonating mid-wipe: their chunks queue here instead of
// rebuilding synchronously, so they share the remesh budget.
const bandPending = new Set(); // chunk keys
export function bandActive() {
  return bandJobs.length > 0;
}
// Current front for the sustained camera shake in main.js (null when idle).
export function bandFront() {
  const j = bandJobs[0];
  if (!j) return null;
  return { x: j.cx + 0.5, y: j.cy + 0.5, z: j.cz + 0.5, r: Math.sqrt(j.front2) };
}
// Chunks touched by non-band blasts while a band carves: queue for the
// budgeted remesh drain instead of rebuilding inline.
export function accumulateBandRefresh(coords) {
  if (!coords) return;
  for (const [x, , z] of coords) {
    for (const ck of chunkKeysForColumn(x, z)) bandPending.add(ck);
  }
}
// Dirty-chunk frontier: columns carve in radial order, so a chunk whose last
// touching column index sits behind the carve cursor is fully carved and
// safe to remesh; chunks ahead of the front stay queued (never rebuilt
// twice). Overhang cells mark -1: ready once their pass finishes.
function markBandDirty(job, gx, gz, idx) {
  for (const ck of chunkKeysForColumn(gx, gz)) {
    const prev = job.dirty.get(ck);
    if (prev === undefined || idx > prev) job.dirty.set(ck, idx);
  }
}
function cellsDone(job) {
  return !job.cells || job.celli >= job.cells.length;
}
// Budgeted remesh drain, called every sim frame from main.js: pending
// non-band chunks first (ungated), then frontier-ready band chunks
// nearest-first. Unbuilt chunks drop out — streaming builds them with the
// voxels already in place. Finishes the job (end-of-job purge, shell hide)
// once the carve and the dirty set both drain.
export function drainBandRemesh(px, pz) {
  if (!bandPending.size && !bandJobs.length) return;
  const deadline = performance.now() + REMESH_BUDGET_MS;
  const dist2 = (ck) => {
    const u = ck.indexOf("_");
    const dx = (+ck.slice(0, u)) * 16 + 8 - px, dz = (+ck.slice(u + 1)) * 16 + 8 - pz;
    return dx * dx + dz * dz;
  };
  const rebuildWithin = (cks) => {
    cks.sort((a, b) => dist2(a) - dist2(b));
    let i = 0;
    for (; i < cks.length; i++) {
      if (performance.now() >= deadline) break;
      const u = cks[i].indexOf("_");
      rebuildChunk(+cks[i].slice(0, u), +cks[i].slice(u + 1));
    }
    return cks.slice(i); // leftovers stay dirty
  };
  if (bandPending.size) {
    const rest = [];
    for (const ck of bandPending) {
      if (isChunkBuilt(ck)) rest.push(ck);
    }
    bandPending.clear();
    for (const ck of rebuildWithin(rest)) bandPending.add(ck);
  }
  const job = bandJobs[0];
  if (!job) return;
  if (job.dirty.size) {
    const ready = [];
    for (const [ck, m] of job.dirty) {
      if (!cellsDone(job) || m >= job.ci) continue; // frontier hasn't passed
      job.dirty.delete(ck);
      if (isChunkBuilt(ck)) ready.push(ck);
    }
    // Unbuilt chunks never need a refresh: streaming builds them current.
    for (const [ck] of job.dirty) {
      if (!isChunkBuilt(ck)) job.dirty.delete(ck);
    }
    for (const ck of rebuildWithin(ready)) job.dirty.set(ck, -1);
  }
  if (job.carveDone && job.dirty.size === 0) finishBandJob(job);
}
// End of a band wipe, once carve and remesh both drain: one floating-liquid
// purge seeded from the band boundary (in-band liquids were cleared; only
// neighbors above/below can strand), then the job leaves and the shell hides.
// Per-slice purging would repeat the same floods ~50x for an identical result.
function finishBandJob(job) {
  bandJobs.shift();
  hideBandShell();
  const seeds = [];
  const seen = new Set();
  const pushSeed = (x, y, z) => {
    if (y < 1 || seeds.length > 30000) return;
    const k = x + "," + y + "," + z;
    if (seen.has(k)) return;
    if (!isLiquid(getBlock(x, y, z))) return;
    seen.add(k);
    seeds.push([x, y, z]);
  };
  for (const [, gx, gz] of job.cols) {
    pushSeed(gx, job.yHi === null ? colTops[dim][colTopIdx(gx, gz)] : job.yHi + 1, gz);
    pushSeed(gx, job.yLo - 1, gz);
  }
  if (job.cells) {
    for (const [gx, gy, gz] of job.cells) {
      pushSeed(gx + 1, gy, gz); pushSeed(gx - 1, gy, gz);
      pushSeed(gx, gy + 1, gz); pushSeed(gx, gy - 1, gz);
      pushSeed(gx, gy, gz + 1); pushSeed(gx, gy, gz - 1);
    }
  }
  const purged = onPurge ? onPurge(seeds) ?? [] : [];
  syncGlowAfterBlast();
  if (purged.length) {
    notePortalFramesOnly(purged);
    refreshBlocks(purged);
  }
  // Full-world fill resync: the only healer that reaches past the player's
  // 12-block scanner range, so no destroyed window anywhere keeps its fill.
  scanWorldPortals();
}
function carveBandCell(job, kind, gx, gy, gz, touched) {
  const bid = getBlock(gx, gy, gz);
  if (bid === AIR) return;
  if (gy === 0) return; // bedrock
  const victimKind = isTntLike(bid) ? kindOfBlock(bid) : null;
  if (victimKind) {
    // Other-band ultras survive for their own blast; everything else in the
    // band (normals, megas, same-band ultras) is consumed silently — the
    // whole band goes anyway, so nothing cascades.
    if (victimKind.band && ultraBandOf(gy) !== job.band) return;
    const k = gx + "," + gy + "," + gz;
    const t = lit.get(k);
    if (t) {
      lit.delete(k);
      removeSprite(k, kindOf(t.kind));
    }
    pendingChain.delete(k);
    displaced.delete(k);
    clearCell(gx, gy, gz, touched);
    return;
  }
  if (isLiquid(bid) && !kind.clearsLiquids) return;
  clearCell(gx, gy, gz, touched);
}
function carveBandColumn(job, kind, gx, gz, touched) {
  let yHi = job.yHi;
  const top = colTops[dim][colTopIdx(gx, gz)];
  if (yHi === null || top < yHi) yHi = top;
  if (top < job.yLo) return;
  for (let gy = job.yLo; gy <= yHi; gy++) carveBandCell(job, kind, gx, gy, gz, touched);
}
function drainBandJobs(dt) {
  if (!bandJobs.length) return;
  const job = bandJobs[0];
  const kind = kindOf(job.kind);
  const cleared = [];
  let n = 0;
  while (job.ci < job.cols.length && n < BAND_COLS_PER_TICK) {
    const idx = job.ci;
    const [d2, gx, gz] = job.cols[idx];
    job.ci = idx + 1;
    carveBandColumn(job, kind, gx, gz, cleared);
    markBandDirty(job, gx, gz, idx);
    if (d2 > job.front2) job.front2 = d2;
    n++;
  }
  if (job.cells) {
    while (job.celli < job.cells.length && n < BAND_COLS_PER_TICK) {
      const [gx, gy, gz] = job.cells[job.celli++];
      if (getBlock(gx, gy, gz) !== AIR) carveBandCell(job, kind, gx, gy, gz, cleared);
      markBandDirty(job, gx, gz, -1);
      n++;
    }
  }
  // Portal frames track the cleared cells only (cheap Set ops); fills heal
  // from the dirty flag in the periodic scanner — never a per-cell refresh.
  if (cleared.length) notePortalFramesOnly(cleared);
  syncGlowAfterBlast();
  // Throttled shell advance on sim-time: the wall glides with the front
  // instead of paying a full 8k-particle rewrite every frame.
  job.fxAcc = (job.fxAcc || 0) + dt;
  if (job.fxAcc > 0.12) {
    job.fxAcc = 0;
    updateBandShell(job.cx + 0.5, job.cy + 0.5, job.cz + 0.5, Math.sqrt(job.front2), job.yLo, job.yHi);
  }
  if (job.ci >= job.cols.length && cellsDone(job)) job.carveDone = true;
}

// One band wipe: same-band lit fuses and queued blasts die with the band
// (cross-band lit ultras keep burning for their own band), then the columns
// carve across frames. Shake fires once at full reach; main.js sustains it
// while the camera sits inside the front via bandFront().
function explodeBand(cx, cy, cz, kind, refresh) {
  removeSprite(cx + "," + cy + "," + cz, kind);
  const band = ultraBandOf(cy);
  const [yLo, yHi] = ultraBandRange(band);
  for (const [k, t] of lit) {
    if (ultraBandOf(t.y) !== band) continue;
    lit.delete(k);
    removeSprite(k, kindOf(t.kind));
  }
  for (const [k, c] of pendingChain) {
    if (ultraBandOf(c.y) !== band) continue;
    pendingChain.delete(k);
  }
  const R = ULTRA_FULL_R;
  const R2 = R * R;
  const cols = [];
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z++) {
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      cols.push([d2, x, z]);
    }
  }
  cols.sort((a, b) => a[0] - b[0]);
  bandJobs.push({
    cx, cy, cz, band, yLo, yHi, kind: kind.key,
    cols, ci: 0,
    cells: band === 1 ? ultraOverhangCells() : null, celli: 0,
    front2: 0, dirty: new Map(), fxAcc: 1, carveDone: false,
  });
  // A clearing kind leaves air behind instead of restoring the displaced
  // liquid at its own cell (carve clears it like every other cell).
  displaced.delete(cx + "," + cy + "," + cz);
  // No stale fill may outlive its window: hide every fill up front (the
  // carve only tracks frames), and the final full rescan restores survivors.
  clearPortalFills();
  initBandShell();
  spawnBlastFx(cx, cy, cz, kind);
  if (onBlast) onBlast(cx, cy, cz, R, kind.key);
  return [];
}

// Master player launch, generalized to a pooled radius. On the ground the
// player is thrown up and outward fast enough to clear the crater rim; in
// fly mode the shove follows the straight mega->player line outward, as a
// decaying impulse (fly overwrites vel every frame, so a vel.set would die
// on the next frame).
function applyMegaKnockback(cx, cy, cz, kind, R = kind.radius) {
  const px = pos.x, py = pos.y + 0.9, pz = pos.z;
  const dx0 = px - (cx + 0.5), dy0 = py - (cy + 0.5), dz0 = pz - (cz + 0.5);
  if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 >= R * R) return;
  if (flyOn) {
    let dx = dx0, dy = dy0, dz = dz0;
    let d = Math.hypot(dx, dy, dz);
    if (d < 0.001) { dx = 1; dy = 0; dz = 0; d = 0.001; }
    // Straight-line shove: uniform 1.5R travel from the center, always —
    // the decaying impulse travels v0 / KNOCK_DECAY. Capped against wall
    // tunneling (master threw at 70); bigger clusters land slightly short.
    const spd = Math.min(75, 1.5 * R * KNOCK_DECAY);
    addPlayerKnockback((dx / d) * spd, (dy / d) * spd, (dz / d) * spd);
    setOnGround(false);
    return;
  }
  let dx = px - (cx + 0.5), dz = pz - (cz + 0.5);
  let d0 = Math.hypot(dx, dz);
  if (d0 < 0.001) { dx = 1; dz = 0; d0 = 0.001; } else { dx /= d0; dz /= d0; }
  const f = Math.max(0, 1 - d0 / (R * 2));
  const Vup = 22 + 8 * f;
  const airT = (2 * Vup) / GRAVITY;
  // Ballistic arc with uniform 1.5R travel from the center (V0 cap guards walls).
  const need = 1.5 * R;
  const V0 = Math.min(40, Math.max(4, need / Math.max(0.5, airT)));
  vel.set(dx * V0, Vup, dz * V0);
  setOnGround(false);
}

export const TNT_TYPES = [
  { ...TNT_DEFAULTS, key: "normal", blockId: TNT },
  {
    ...TNT_DEFAULTS, key: "mega", blockId: MEGA_TNT,
    fuse: 8.0, radius: 15,
    blastKind: "pooled", countdownKind: "bucket", fxKind: "mega",
    pool: true, light: true, knockback: true, clearsLiquids: true,
    shake: { range: 3, knee: 0.4, max: 1.5 },
    spawnBlastFx: spawnMegaBlastFx,
    makeLitVisual: makeMegaLitVisual,
    tickLitVisual: tickMegaLitVisual,
    clearLitVisual: clearMegaLitVisual,
  },
  {
    // Black mega: same 8 s fuse and bucket countdown (black veil), but one
    // blast wipes a whole altitude band (ground / cloud / moon by ignition
    // height) across frames. No knockback — the shake carries it.
    ...TNT_DEFAULTS, key: "ultra", blockId: ULTRA_TNT,
    fuse: 8.0, radius: ULTRA_FULL_R,
    blastKind: "band", countdownKind: "bucket", fxKind: "ultra",
    band: true, light: true, knockback: false, clearsLiquids: true,
    countdownColor: 0x000000,
    shake: { range: 3, knee: 0.4, max: 1.5 },
    spawnBlastFx: spawnUltraBlastFx,
    makeLitVisual: makeMegaLitVisual,
    tickLitVisual: tickMegaLitVisual,
    clearLitVisual: clearMegaLitVisual,
  },
];

function kindOf(key) {
  return TNT_TYPES.find((t) => t.key === key) ?? TNT_TYPES[0];
}

export function kindOfBlock(id) {
  return TNT_TYPES.find((t) => t.blockId === id) ?? TNT_TYPES[0];
}

// Per-kind camera-shake spec (null = no shake); mega and ultra each carry one.
export function shakeSpecFor(kindKey) {
  const t = kindOf(kindKey);
  return t.shake ?? null;
}

const lit = new Map(); // "x,y,z" -> { x, y, z, id, fuse, total, kind }
const sprites = new Map(); // "x,y,z" -> THREE.Sprite countdown
// Pause contract: chain dues are sim-time (advanced by tickTNT's dt), never
// wall-clock, so a pause freezes the cascade instead of firing it on resume.
let simNow = 0;
const pendingChain = new Map(); // "x,y,z" -> { x, y, z, kind, due } delayed blasts
// Liquid displaced when a TNT was placed ("x,y,z" -> liquid id), restored
// in that cell after its blast unless the kind clears liquids.
// TNT placed in air leaves air behind.
const displaced = new Map();
let sceneRef = null;
let onBlast = null;
let onPurge = null;

export function initTNTFx(scene) {
  sceneRef = scene;
}

export function onExplode(fn) {
  onBlast = fn;
}

// Floating-liquid purge, injected by the caller (edit.js already depends on
// this module, so a static import would cycle). Runs after every blast over
// its touched cells; skipped silently when unset (e.g. headless use).
export function onLiquidPurge(fn) {
  onPurge = fn;
}

// Purges blast-stranded floating liquids and folds the purged cells into
// touched so they remesh with the rest. Keyed-set merge (not .some scans)
// so 100k-cell mega craters never go quadratic.
function purgeBlastLiquids(touched) {
  if (!onPurge || !touched.length) return touched;
  const purged = onPurge(touched) ?? [];
  if (!purged.length) return touched;
  const seen = new Set();
  for (const [x, y, z] of touched) seen.add(x + "," + y + "," + z);
  for (const c of purged) {
    const k = c[0] + "," + c[1] + "," + c[2];
    if (seen.has(k)) continue;
    seen.add(k);
    touched.push(c);
  }
  return touched;
}

// Records the liquid a placed TNT replaced; called once per placement.
export function noteTntPlaced(x, y, z, id) {
  displaced.set(x + "," + y + "," + z, id);
}

// New worlds never inherit another world's placements, fuses, or lights.
export function resetTNTMemory() {
  simNow = 0;
  pendingChain.clear();
  displaced.clear();
  megaIndex.clear();
  markClusterDirty();
  for (const k of [...megaVeils.keys()]) clearMegaLitVisual(k);
  for (const L of megaLights) {
    if (sceneRef) sceneRef.remove(L.light);
  }
  megaLights.length = 0;
  megaLightBeats.clear();
  for (const b of blastLights) {
    if (sceneRef) sceneRef.remove(b.light);
  }
  blastLights.length = 0;
  pooling.clear();
  wakeMegas = null;
  bandJobs.length = 0;
  bandPending.clear();
  hideBandShell();
  resetDenseFx();
  fxJobs.length = 0;
  carveJobs.length = 0;
  fxBaseDelay = 0;
}

// Mass-blast pipeline: one FX job per pooled blast (single union fireball
// at the centroid), carve in column slices, so looots of megas read as one
// simultaneous explosion instead of N fireballs or one frozen frame.
// Solo/small blasts keep the instant carve path.
const fxJobs = []; // { x,y,z,kind,k,share,shells,shellMode,key,delay,R,due,lifeScale }
const FX_SEED_PER_TICK = 30000;
function fxJobCost(j) {
  const R = j.R ?? megaPoolRadius(j.kind, j.k);
  return Math.min(47000, Math.round(2.2 * j.share * R * R * R));
}
export function megaFxActive() { return fxJobs.length > 0; }
function drainFxJobs() {
  if (!fxJobs.length) return;
  // Adaptive budget: the queue always drains in ~8 ticks whatever its size,
  // so a pool of 20 ends at the same time as a solo blast. Jobs may carry a
  // sim-time `due`: ultra mix phases wait their turn while due mega jobs
  // still drain around them (scan, never head-blocked).
  let est = 0;
  for (const j of fxJobs) est += fxJobCost(j);
  let budget = Math.max(FX_SEED_PER_TICK, Math.ceil(est / 8));
  let flushed = false;
  let i = 0;
  while (i < fxJobs.length && budget > 0) {
    const j = fxJobs[i];
    if (j.due != null && j.due > simNow) { i++; continue; }
    const cost = fxJobCost(j);
    if (flushed && cost > budget) break;
    fxJobs.splice(i, 1);
    budget -= cost;
    flushed = true;
    spawnMegaBlastFx(j.x, j.y, j.z, j.kind, j.k, { share: j.share, shells: j.shells, shellMode: j.shellMode, key: j.key, delay: j.delay, R: j.R, lifeScale: j.lifeScale });
  }
  if (flushed) {
    flushDense();
    noteDenseSpawn(3.0);
  }
}
// Sliced pooled carve: members carve in x-column slices under a per-tick
// budget (same shape as the band-wipe drain). FX/knockback/shake/overlay
// fire instantly; the crater lands within ~0.25 s. Completion reuses the
// budgeted remesh drain (bandPending) instead of synchronous rebuilds.
const carveJobs = []; // { members, radii, kind, mi, x0, touched }
const CARVE_COLS_PER_TICK = 1536;
export function megaCarveActive() { return carveJobs.length > 0; }
  // Rolling-ignition base delay, set while draining queued FX members so one
  // member's layers all share its stagger offset (snapshot per job).
function drainCarveJobs() {
  if (!carveJobs.length) return;
  // Adaptive budget: every pool finishes carving in ~15 ticks whatever its
  // size, so craters land on the same beat at R=15 and R=40.
  let cols = CARVE_COLS_PER_TICK;
  {
    const job0 = carveJobs[0];
    let rem = 0;
    for (let mi = job0.mi; mi < job0.members.length; mi++) {
      const m0 = job0.members[mi], R0 = job0.radii[mi];
      const cur = (mi === job0.mi && job0.x0 !== -Infinity) ? job0.x0 : Math.max(-WORLD_RADIUS, Math.ceil(m0.x - R0));
      rem += Math.max(0, Math.min(WORLD_RADIUS, Math.floor(m0.x + R0)) - cur + 1);
    }
    if (rem > 0) cols = Math.max(cols, Math.ceil(rem / 15));
  }
  while (carveJobs.length && cols > 0) {
    const job = carveJobs[0];
    const m = job.members[job.mi];
    if (!m) {
      carveJobs.shift();
      finishCarveJob(job);
      continue;
    }
    const R = job.radii[job.mi];
    if (job.x0 === -Infinity) job.x0 = Math.max(-WORLD_RADIUS, Math.ceil(m.x - R));
    const x1 = Math.min(WORLD_RADIUS, Math.floor(m.x + R));
    while (job.x0 <= x1 && cols > 0) {
      carvePoolColumn(job.x0, m, R, job.kind, job.touched);
      job.x0++;
      cols--;
    }
    if (job.x0 > x1) { job.mi++; job.x0 = -Infinity; }
  }
}
function finishCarveJob(job) {
  const touched = job.touched;
  // Displaced-liquid restore per member (clearing kinds leave air behind).
  if (touched.length) {
    const seen = new Set();
    for (const [x, y, z] of touched) seen.add(x + "," + y + "," + z);
    for (const m of job.members) {
      const dk = m.x + "," + m.y + "," + m.z;
      const fill = displaced.get(dk) ?? null;
      displaced.delete(dk);
      if (fill !== null && !job.kind.clearsLiquids) {
        setBlock(m.x, m.y, m.z, fill);
        if (!seen.has(dk)) { seen.add(dk); touched.push([m.x, m.y, m.z]); }
      }
    }
  } else {
    for (const m of job.members) displaced.delete(m.x + "," + m.y + "," + m.z);
  }
  purgeBlastLiquids(touched);
  syncGlowAfterBlast();
  // Cheap frame tracking only; chunk rebuilds drain under the 6 ms budget
  // in drainBandRemesh and portal fills heal from the dirty-flag scanner.
  if (touched.length) {
    notePortalFramesOnly(touched);
    accumulateBandRefresh(touched);
  }
}
// A lit mega or ultra within 0.6 s of detonation: main.js dips DPR early so
// the resize hitch lands before the blast frame instead of on top of it.
export function megaImminent() {
  for (const t of lit.values()) {
    const kind = kindOf(t.kind);
    if ((kind.pool || kind.band) && t.fuse < 0.6) return true;
  }
  return false;
}

// Simultaneous mega pool: every mega within blast distance of another mega,
// transitively, detonates in the same blast. Normals caught inside go off
// with the pool instead of cascading. Guarded against re-entry while a pool
// carves, and woken up after normal blasts that uncover megas.
const pooling = new Set(); // "x,y,z" keys consumed by the running pool
let wakeMegas = null; // mega victims found by a normal carve, pooled after it

export function igniteTNT(x, y, z, kindKey = null) {
  const k = x + "," + y + "," + z;
  if (lit.has(k)) return;
  const id = getBlock(x, y, z);
  const kind = kindKey ? kindOf(kindKey) : kindOfBlock(id);
  if (id !== kind.blockId) return;
  lit.set(k, { x, y, z, id, fuse: kind.fuse, total: kind.fuse, kind: kind.key });
  if (sceneRef && !sprites.has(k)) {
    if (typeof kind.makeLitVisual === "function") {
      kind.makeLitVisual(x, y, z, kind);
    } else {
      const spr = makeFuseSprite();
      spr.position.set(x + 0.5, y + 1.35, z + 0.5);
      drawFuseSprite(spr, kind.fuse);
      sceneRef.add(spr);
      sprites.set(k, spr);
    }
  }
}

export function isLitTNT(x, y, z) {
  return lit.has(x + "," + y + "," + z);
}

// Second click on lit TNT: cancel the fuse and detonate immediately.
export function detonateNow(x, y, z, refresh) {
  const k = x + "," + y + "," + z;
  const t = lit.get(k);
  if (!t) return [];
  const kind = kindOf(t.kind);
  lit.delete(k);
  removeSprite(k, kind);
  return explode(x, y, z, kind, refresh);
}

function makeFuseSprite() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(1.5, 0.75, 1);
  // Above liquid sheets (10-13), below the block highlight (999): no sort flicker.
  spr.renderOrder = 20;
  spr.userData = { canvas: c, tex, shown: null };
  return spr;
}

// Redrawn per tenth of a second; white, orange-red under 1 s.
function drawFuseSprite(spr, v) {
  const tenth = Math.max(0, Math.ceil(v * 10) / 10);
  if (spr.userData.shown === tenth) return;
  spr.userData.shown = tenth;
  const ctx = spr.userData.canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = "bold 52px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 10; ctx.strokeStyle = "rgba(0,0,0,0.85)";
  const label = tenth.toFixed(1);
  ctx.strokeText(label, 64, 34);
  ctx.fillStyle = tenth <= 1 ? "#ff6a3d" : "#fff";
  ctx.fillText(label, 64, 34);
  spr.userData.tex.needsUpdate = true;
}

function removeSprite(k, kind) {
  if (kind && typeof kind.clearLitVisual === "function") {
    kind.clearLitVisual(k);
    return;
  }
  const spr = sprites.get(k);
  if (!spr) return;
  sprites.delete(k);
  if (sceneRef) sceneRef.remove(spr);
  spr.material.map.dispose();
  spr.material.dispose();
}

export function cancelTNT(x, y, z) {
  const k = x + "," + y + "," + z;
  const t = lit.get(k);
  lit.delete(k);
  removeSprite(k, t ? kindOf(t.kind) : null);
  pendingChain.delete(k);
}

export function tickTNT(dt, refresh) {
  simNow += dt;
  if (lit.size) {
    const done = [];
    for (const [k, t] of lit) {
      const kind = kindOf(t.kind);
      // Fuse dies with its block if the player breaks it mid-burn.
      if (getBlock(t.x, t.y, t.z) !== t.id) { done.push(k); removeSprite(k, kind); continue; }
      t.fuse -= dt;
      if (typeof kind.tickLitVisual === "function") {
        kind.tickLitVisual(k, t, kind);
      } else {
        const spr = sprites.get(k);
        if (spr) drawFuseSprite(spr, t.fuse);
      }
      if (t.fuse <= 0) {
        done.push(k);
        explode(t.x, t.y, t.z, kind, refresh);
      }
    }
    for (const k of done) lit.delete(k);
  }
  tickChain(simNow, refresh);
  drainBandJobs(dt);
  drainCarveJobs();
  drainFxJobs();
  tickBlastLights(dt);
}

// Delayed chained blasts: each queued TNT detonates with its own full
// explosion (flash + burst + sphere), cascading as blasts uncover more TNT.
export function tickChain(now, refresh) {
  if (!pendingChain.size) return;
  const due = [];
  for (const [k, c] of pendingChain) {
    if (c.due <= now) due.push(k);
  }
  for (const k of due) {
    const c = pendingChain.get(k);
    pendingChain.delete(k);
    if (!c) continue;
    const kind = kindOf(c.kind);
    lit.delete(k);
    removeSprite(k, kind);
    explode(c.x, c.y, c.z, kind, refresh);
  }
}

function spawnBlastFx(x, y, z, kind) {
  if (typeof kind.spawnBlastFx === "function") {
    kind.spawnBlastFx(x, y, z, kind);
    return;
  }
  spawnFlash({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  spawnBurst({ x: x + 0.5, y: y + 0.5, z: z + 0.5, count: kind.burst });
}

function explode(cx, cy, cz, kind, refresh) {
  if (kind.band) {
    return explodeBand(cx, cy, cz, kind, refresh);
  }
  if (kind.pool) {
    const pooled = explodePool(cx, cy, cz, kind);
    purgeBlastLiquids(pooled);
    syncGlowAfterBlast();
    if (refresh) refresh(pooled);
    return pooled;
  }
  const touched = [];
  removeSprite(cx + "," + cy + "," + cz, kind);
  spawnBlastFx(cx, cy, cz, kind);
  const dk = cx + "," + cy + "," + cz;
  const fill = displaced.get(dk) ?? null;
  displaced.delete(dk);
  // Mega victims uncovered by a normal blast never cascade: they are pooled
  // after this carve, so the blocks stay in place until the pool consumes
  // them.
  wakeMegas = [];
  try {
    if (typeof kind.carveBlast === "function") {
      kind.carveBlast(cx, cy, cz, kind, queueChained, touched);
    } else {
      // Normal blast: open ball (strict sphere test) for a round crater at
      // the same radius; pools keep the closed ball below.
      carveSphere(cx, cy, cz, kind, touched, false, kind.radius, true);
    }
  } finally {
    const wake = wakeMegas;
    wakeMegas = null;
    for (const [wx, wy, wz] of wake) {
      if (pooling.has(wx + "," + wy + "," + wz)) continue;
      const wid = getBlock(wx, wy, wz);
      if (wid === AIR || !kindOfBlock(wid).pool) continue;
      const pt = explodePool(wx, wy, wz, kindOfBlock(wid));
      for (const c of pt) {
        if (!touched.some(([x, y, z]) => x === c[0] && y === c[1] && z === c[2])) touched.push(c);
      }
    }
  }
  // A record exists only while its TNT stands (TNT is manually unremovable,
  // records die at blast or world build), so fill needs no extra guard.
  // Clearing kinds (mega) leave air behind instead of restoring.
  if (fill !== null && !kind.clearsLiquids) {
    setBlock(cx, cy, cz, fill);
    if (!touched.some(([x, y, z]) => x === cx && y === cy && z === cz)) touched.push([cx, cy, cz]);
  }
  purgeBlastLiquids(touched);
  syncGlowAfterBlast();
  if (refresh) refresh(touched);
  if (kind.knockback) applyMegaKnockback(cx, cy, cz, kind);
  if (onBlast) onBlast(cx, cy, cz, kind.radius, kind.key);
  return touched;
}

// Neighboring TNT is queued with a short delay instead of detonating
// synchronously, so chains read as a cascade with one flash/burst per block.
// The block is left in place until its delayed blast clears it.
function queueChained(x, y, z, kind) {
  const k = x + "," + y + "," + z;
  if (pendingChain.has(k)) return;
  const victim = lit.get(k);
  if (victim) {
    lit.delete(k);
    removeSprite(k, kindOf(victim.kind));
  }
  pendingChain.set(k, { x, y, z, kind: kind.key, due: simNow + kind.chainDelay });
}

// Live mega-position index: every placed mega block, removed as blasts
// consume it. The pool closure below walks this index (no voxel box scans),
// so clustering stays instant at any radius. Stale keys are harmless: every
// join revalidates through getBlock.
const megaIndex = new Set(); // "x,y,z"
export function trackMegaPlaced(x, y, z) {
  megaIndex.add(x + "," + y + "," + z);
  markClusterDirty();
}
function untrackMega(x, y, z) {
  megaIndex.delete(x + "," + y + "," + z);
  markClusterDirty();
}
// Single choke point for blast deletions: keeps the indexes in sync.
// Glowstone variants clear cheaply here (map deletes only); the light
// clusters re-sync once per blast via syncGlowAfterBlast below, not per cell.
let glowBlasted = false;
function syncGlowAfterBlast() {
  if (!glowBlasted) return;
  glowBlasted = false;
  noteBlockLightEdit();
}
function clearCell(x, y, z, touched) {
  if (getBlock(x, y, z) === GLOWSTONE) {
    clearGlowstoneAt(x, y, z);
    glowBlasted = true;
  }
  if (getBlock(x, y, z) === FLOWER) clearFlowerAt(x, y, z);
  if (kindOfBlock(getBlock(x, y, z)).pool) untrackMega(x, y, z);
  setBlock(x, y, z, AIR);
  touched.push([x, y, z]);
}

// Upfront neighbor search over the mega index (no voxel scans). Growth via
// counted neighbours within the member's current R/2 (+50% compound each,
// capped at 40); linkage within its current R, transitively, until radii and
// membership stabilize. Terminates: membership and counted sets only grow
// (bounded by placed megas) and radii are capped.
function collectMegaCluster(sx, sy, sz, kind) {
  const members = []; // { x, y, z, key, counted: Set, r }
  const seen = new Set();
  const take = (x, y, z) => {
    const k = x + "," + y + "," + z;
    if (seen.has(k) || pooling.has(k)) return false;
    if (getBlock(x, y, z) !== kind.blockId) return false;
    seen.add(k);
    megaIndex.add(k);
    members.push({ x, y, z, key: k, counted: new Set(), r: kind.radius });
    return true;
  };
  if (!take(sx, sy, sz)) return { members: [], sized: [] };
  // Live positions this search: parsed once, stale keys purged.
  const census = () => {
    const out = [];
    for (const key of megaIndex) {
      const [px, py, pz] = key.split(",").map(Number);
      if (getBlock(px, py, pz) !== kind.blockId) {
        megaIndex.delete(key);
        continue;
      }
      out.push([key, px, py, pz]);
    }
    return out;
  };
  for (let grew = true; grew;) {
    grew = false;
    const pop = census();
    // Growth: uncounted megas within R/2 widen their member.
    for (const m of members) {
      const hR = m.r / 2, hR2 = hR * hR;
      for (const [key, ox, oy, oz] of pop) {
        if (key === m.key || m.counted.has(key)) continue;
        const dx = ox - m.x, dy = oy - m.y, dz = oz - m.z;
        if (dx * dx + dy * dy + dz * dz > hR2) continue;
        m.counted.add(key);
        m.r = megaPoolRadius(kind, 1 + m.counted.size);
        grew = true;
      }
    }
    // Linkage: unjoined megas within a member's current radius join the pool.
    for (const m of [...members]) {
      const R2 = m.r * m.r;
      for (const [key, ox, oy, oz] of pop) {
        if (seen.has(key)) continue;
        const dx = ox - m.x, dy = oy - m.y, dz = oz - m.z;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        if (take(ox, oy, oz)) grew = true;
      }
    }
  }
  const sized = members.map((m) => ({ k: 1 + m.counted.size, r: m.r }));
  return { members, sized };
}

// One simultaneous blast for the whole cluster: every member carves its
// own crater and throws its own fireball, widened by neighbours within
// R/2 (7.5) through the 15 / 22.5 / 33.75 / capped-40 curve. One knockback
// and one shake at the centroid, reaching the widest member crater.
function explodePool(cx, cy, cz, kind) {
  const { members, sized: local } = collectMegaCluster(cx, cy, cz, kind);
  if (!members.length) return [];
  const mult = members.length;
  const radii = local.map((e) => e.r);
  const R = Math.max(...radii);
  for (const m of members) pooling.add(m.x + "," + m.y + "," + m.z);
  try {
    let ax = 0, ay = 0, az = 0;
    for (const m of members) {
      ax += m.x;
      ay += m.y;
      az += m.z;
    }
    ax /= mult;
    ay /= mult;
    az /= mult;
    // Single union fireball: smallest sphere around the centroid covering
    // every member crater, capped so spread-out pools never fill the sky.
    let Rfx = 0;
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const d = Math.hypot(m.x - ax, m.y - ay, m.z - az) + radii[i];
      if (d > Rfx) Rfx = d;
    }
    Rfx = Math.min(MEGA_UNION_SHELL_R, Rfx);
    const inRegion = (x, y, z) => members.some((m, i) => {
      const dx = x - m.x, dy = y - m.y, dz = z - m.z;
      return dx * dx + dy * dy + dz * dz <= radii[i] * radii[i];
    });
    // Lit fuses and queued blasts inside the region go off with the pool —
    // except ultras, which always detonate as their own band blast instead.
    for (const [k, t] of lit) {
      if (!inRegion(t.x, t.y, t.z)) continue;
      const tk = kindOf(t.kind);
      if (tk.band) {
        queueChained(t.x, t.y, t.z, tk);
        continue;
      }
      lit.delete(k);
      removeSprite(k, tk);
    }
    for (const [k, c] of pendingChain) {
      if (kindOf(c.kind).band) continue;
      if (inRegion(c.x, c.y, c.z)) pendingChain.delete(k);
    }
    // Small pools carve synchronously (snappy solo megas); big ones slice
    // across frames. Column estimate: one R=22.5 member is ~2k columns.
    let totalCols = 0;
    for (let i = 0; i < members.length; i++) totalCols += (2 * Math.ceil(radii[i]) + 1) ** 2;
    const styleKey = MEGA_STYLE_KEY;
    // Knockback stays on R (max member crater): launch physics unchanged,
    // whatever the visual union looks like.
    applyMegaKnockback(ax, ay, az, kind, R);
    // Shake, overlays, furnace and LoS follow the single visible fireball.
    if (onBlast) onBlast(ax, ay, az, Rfx, kind.key);
    if (totalCols <= 2600) {
      const touched = [];
      for (let i = 0; i < members.length; i++) {
        carveSphere(members[i].x, members[i].y, members[i].z, kind, touched, true, radii[i]);
      }
      // Each pooled mega restores the liquid it was placed in, if any —
      // unless it clears liquids, in which case its cell stays air.
      const seen = new Set();
      for (const [x, y, z] of touched) seen.add(x + "," + y + "," + z);
      for (const m of members) {
        const dk = m.x + "," + m.y + "," + m.z;
        const fill = displaced.get(dk) ?? null;
        displaced.delete(dk);
        if (fill !== null && !kind.clearsLiquids) {
          setBlock(m.x, m.y, m.z, fill);
          if (!seen.has(dk)) { seen.add(dk); touched.push([m.x, m.y, m.z]); }
        }
      }
      // Instant carve for the small path; the single union fireball queues
      // and drains end-of-tick (same frame). Remesh goes through the budgeted
      // drain (1–2 frames, hidden under the fireball) instead of freezing on
      // synchronous rebuilds.
      fxJobs.push({ x: ax, y: ay, z: az, kind, k: mult, share: 1, shells: true, key: styleKey, delay: 0, R: Rfx });
      poolLight(ax, ay, az, Rfx, styleKey);
      syncGlowAfterBlast();
      purgeBlastLiquids(touched);
      notePortalFramesOnly(touched);
      accumulateBandRefresh(touched);
      return [];
    }
    // Big-pool path: one light up front, one simultaneous union fireball,
    // carve drains in column slices. Same total power and same timeline
    // at any size.
    fxJobs.push({ x: ax, y: ay, z: az, kind, k: mult, share: 1, shells: true, key: styleKey, delay: 0, R: Rfx });
    carveJobs.push({ members: [...members], radii: [...radii], kind, mi: 0, x0: -Infinity, touched: [] });
    poolLight(ax, ay, az, Rfx, styleKey);
    syncGlowAfterBlast();
    return [];
  } finally {
    for (const m of members) pooling.delete(m.x + "," + m.y + "," + m.z);
  }
}

function carveSphere(cx, cy, cz, kind, touched, pool = false, Reff = kind.radius, open = false) {
  const R = Reff;
  // Clear the ignited block itself first so its cell refreshes even in air.
  if (isTntLike(getBlock(cx, cy, cz))) clearCell(cx, cy, cz, touched);
  for (let x = Math.max(-WORLD_RADIUS, Math.ceil(cx - R)); x <= Math.min(WORLD_RADIUS, Math.floor(cx + R)); x++) {
    carvePoolColumn(x, { x: cx, y: cy, z: cz }, R, kind, touched, pool, open);
  }
}
// One x-column of a pooled carve (shared by the sync sphere above and the
// sliced carve jobs): column-top clamp first, sphere test per cell. The
// normal blast uses the open ball (strict test) so its small crater reads
// round instead of square; mega pools keep the closed ball.
function carvePoolColumn(x, m, R, kind, touched, pool = true, open = false) {
  const R2 = R * R;
  for (let z = Math.max(-WORLD_RADIUS, Math.ceil(m.z - R)); z <= Math.min(WORLD_RADIUS, Math.floor(m.z + R)); z++) {
    const yLo = Math.max(1, Math.ceil(m.y - R));
    let yHi = Math.floor(m.y + R);
    // Skip the air above the terrain: only the blast at or below the
    // column top can hit anything (same cells as before, half the scan).
    const top = colTops[dim][colTopIdx(x, z)];
    if (top < yHi) yHi = top;
    if (top < yLo) continue;
    for (let y = yLo; y <= yHi; y++) {
      carvePoolCell(x, y, z, m.x, m.y, m.z, R2, kind, touched, pool, open);
    }
  }
}
function carvePoolCell(x, y, z, cx, cy, cz, R2, kind, touched, pool, open = false) {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > R2) return;
  if (open && d2 >= R2 - 1 && dx * dx !== R2 && dy * dy !== R2 && dz * dz !== R2) {
    // Open ball: trim the corner shell just inside R (it voxelizes as a
    // square at this radius) but keep the six axis tips, so the crater
    // reads round at the same reach and depth.
    return;
  }
  const bid = getBlock(x, y, z);
  if (bid === AIR) return;
  // Liquids survive blasts unless the kind clears them; otherwise
  // the blast passes through them. Custom carveBlast tiers must keep
  // this guard.
  if (isLiquid(bid) && !kind.clearsLiquids) return;
  const victimKind = isTntLike(bid) ? kindOfBlock(bid) : null;
  // Ultras never pool and are never consumed: any carve uncovering one
  // queues its own band blast instead.
  if (victimKind && victimKind.band) {
    queueChained(x, y, z, victimKind);
    return;
  }
  if (victimKind && victimKind.pool) {
    if (pool) {
      // Pool carve consumes megas silently, members and stragglers alike.
      clearCell(x, y, z, touched);
    } else if (wakeMegas) {
      // Normal carve leaves mega victims standing for the pool.
      wakeMegas.push([x, y, z]);
    } else {
      clearCell(x, y, z, touched);
    }
    return;
  }
  if (victimKind) {
    if (pool) {
      // Normals inside a mega pool go off with it, no delayed cascade.
      clearCell(x, y, z, touched);
      return;
    }
    queueChained(x, y, z, victimKind);
    return;
  }
  clearCell(x, y, z, touched);
}

export function litCount() {
  return lit.size;
}

export function pendingCount() {
  return pendingChain.size;
}
