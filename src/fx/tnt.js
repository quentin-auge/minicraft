// TNT: breaking a TNT block lights a short fuse, then a spherical blast
// clears terrain and chains neighboring TNT. Blast kinds are data: shared
// properties live in TNT_DEFAULTS, entries override only what differs.
// Differing behavior is a capability flag the framework branches on
// (pool, knockback, light, clearsLiquids) or an optional function prop (carveBlast,
// spawnBlastFx, make/tick/clearLitVisual) that a tier supplies — kind
// strings (key, blastKind, countdownKind, fxKind) are stable identifiers,
// never branch conditions.
// Normal (radius 3, 3 s fuse), mega (pooled radius 15 / 22.5 / 33.75,
// capped at 40, 8 s fuse, simultaneous blasts, player knockback,
// threatening lit look), and ultra (black mega look, 8 s fuse, wipes one
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
import { spawnBurst, spawnFlash, initBandShell, updateBandShell, hideBandShell } from "./particles.js";
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
// the block (no mesher change, no remesh during the countdown).
const megaVeils = new Map(); // "x,y,z" -> { veil, heat }
let megaVeilGeo = null;
function megaVeilGeometry() {
  if (!megaVeilGeo) megaVeilGeo = new THREE.BoxGeometry(1.04, 1.04, 1.04);
  return megaVeilGeo;
}
function veilColorFor(kind) {
  return (kind && kind.countdownColor) ?? MEGA_BLINK;
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
  megaVeils.set(k, { veil, heat });
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
    }
    v.veil.material.dispose();
    v.heat.material.dispose();
  }
  syncMegaLights();
}

// Pooled surrounding lights for lit megas (master: max 8, 5-cell buckets,
// nearest-bucket assignment simplified to insertion order here).
const MEGA_LIGHT_MAX = 8;
const MEGA_LIGHT_CELL = 5;
const megaLights = []; // { light, key }
const megaLightBeats = new Map(); // bucketKey -> { beats, was }
function megaBucket(x, y, z) {
  return Math.floor(x / MEGA_LIGHT_CELL) + "," + Math.floor(y / MEGA_LIGHT_CELL) + "," + Math.floor(z / MEGA_LIGHT_CELL);
}
function syncMegaLights() {
  const groups = new Map(); // bucket -> { sx, sy, sz, n, fuse, total }
  for (const t of lit.values()) {
    if (!kindOf(t.kind).light) continue;
    const bk = megaBucket(t.x, t.y, t.z);
    let g = groups.get(bk);
    if (!g) {
      g = { sx: 0, sy: 0, sz: 0, n: 0, fuse: Infinity, total: t.total };
      groups.set(bk, g);
    }
    g.sx += t.x + 0.5;
    g.sy += t.y + 0.5;
    g.sz += t.z + 0.5;
    g.n++;
    if (t.fuse < g.fuse) {
      g.fuse = t.fuse;
      g.total = t.total;
    }
  }
  for (const bk of [...megaLightBeats.keys()]) {
    if (!groups.has(bk)) megaLightBeats.delete(bk);
  }
  const keys = [...groups.keys()].slice(0, MEGA_LIGHT_MAX);
  keys.forEach((bk, i) => {
    let L = megaLights[i];
    if (!L) {
      L = { light: new THREE.PointLight(MEGA_BLINK, 60, 7, 1), key: null };
      if (sceneRef) sceneRef.add(L.light);
      megaLights[i] = L;
    }
    const g = groups.get(bk);
    const b = megaBlinkSmooth(g.fuse, g.total);
    const eff = megaWhiteEff(g.fuse, g.total);
    const kk = Math.max(0, Math.min(1, (5 - g.fuse) / 4));
    let st = megaLightBeats.get(bk);
    if (!st) {
      st = { beats: 0, was: 0 };
      megaLightBeats.set(bk, st);
    }
    if (b >= 0.5 && st.was < 0.5) st.beats++;
    st.was = b;
    L.key = bk;
    L.light.visible = true;
    L.light.position.set(g.sx / g.n, g.sy / g.n + 1, g.sz / g.n);
    L.light.color.setHex(MEGA_BLINK).lerp(megaWhiteHeat, eff);
    L.light.intensity = 30 + b * (50 + 90 * kk) + eff * 60;
    L.light.distance = Math.min(34, 7 + 1.5 * st.beats + 12 * kk);
  });
  for (let i = keys.length; i < megaLights.length; i++) {
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
// decides the crater and knockback reach. Layered nuclear fireball: a dense
// white-hot core inside an orange halo (both well inside the crater — the
// particle ball stays the star), then the usual burst layers.
function spawnMegaBlastFx(x, y, z, kind, mult = 1) {
  const m = Math.max(1, Math.min(mult, 6));
  const R = megaPoolRadius(kind, mult);
  // Fine, vivid, foreground particles: yellow/red/orange palette on the
  // fire layer, near-white embers, gray smoke — all drawn above everything.
  const FIRE = [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]];
  const fireLife = 1.5; // fire bursts, core and halo all end together here
  const tailLife = 2.0; // gray smoke trails alone afterwards
  // White-hot core: snappy constant expand, retracting to end with the fire.
  const coreR = 1.5 * R, coreExpand = 0.5;
  spawnFlash({ x: x + 0.5, y: y + 0.5, z: z + 0.5, color: 0xfff3d0, maxRadius: coreR, speed: coreR / coreExpand, retractSpeed: coreR / Math.max(0.1, fireLife - coreExpand) });
  // Halo synced to the fire particles' end: fast constant expand
  // (~0.4 s), then a retract lasting fireLife - expand, at any pool size.
  // General rule: retract duration = fire end - expand time.
  const haloR = 1.5 * R;
  const haloExpand = haloR / 0.4;
  spawnFlash({ x: x + 0.5, y: y + 0.5, z: z + 0.5, color: 0xff7a1a, maxRadius: haloR, speed: haloExpand, retractSpeed: haloR / Math.max(0.1, fireLife - haloR / haloExpand) });
  spawnBurst({ x: x + 0.5, y: y + 0.5, z: z + 0.5, count: Math.min(2500, Math.round(400 * m)), life: fireLife, size: 1.1, fillRadius: R, palette: FIRE, foreground: true, speedMin: 2, speedMax: 12 });
  spawnBurst({ x: x + 0.5, y: y + 0.5, z: z + 0.5, count: Math.min(1200, Math.round(200 * m)), life: 1.0, size: 0.9, fillRadius: R, foreground: true, color: [1, 0.95, 0.8], variance: [0, 0.05, 0.1], speedMin: 4, speedMax: 12, up: 4 });
  spawnBurst({ x: x + 0.5, y: y + 0.5, z: z + 0.5, count: Math.min(1200, Math.round(200 * m)), life: tailLife, size: 1.3, fillRadius: R, foreground: true, additive: false, gravity: -2, color: [0.3, 0.25, 0.2], variance: [0.1, 0.1, 0.1], speedMin: 1, speedMax: 6, up: 3 });
}

// Ultra blast FX scales to the whole level: no single fireball (it would
// fill the sky), but band-wide foreground bursts — fire across the full
// radius, near-white embers, a long gray smoke tail — plus small ember
// bursts spawned per drain slice on the advancing front (spawnBandEmbers).
function spawnUltraBlastFx(x, y, z, kind) {
  // The persistent shell carries the ongoing spectacle; the ignition is a
  // single modest band-wide flash, not thousands of CPU-integrated particles.
  const R = ULTRA_FULL_R;
  const FIRE = [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]];
  spawnBurst({ x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 1200, life: 1.2, size: 1.1, fillRadius: R, palette: FIRE, foreground: true, speedMin: 2, speedMax: 8 });
  spawnBurst({ x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 600, life: 1.6, size: 1.2, fillRadius: R, foreground: true, additive: false, gravity: -2, color: [0.25, 0.22, 0.2], variance: [0.1, 0.1, 0.1], speedMin: 1, speedMax: 5, up: 3 });
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
  const R = ULTRA_FULL_R, R2 = R * R;
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
// touched so they remesh with the rest.
function purgeBlastLiquids(touched) {
  if (!onPurge || !touched.length) return touched;
  const purged = onPurge(touched) ?? [];
  for (const c of purged) {
    if (!touched.some(([x, y, z]) => x === c[0] && y === c[1] && z === c[2])) touched.push(c);
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
  for (const k of [...megaVeils.keys()]) clearMegaLitVisual(k);
  for (const L of megaLights) {
    if (sceneRef) sceneRef.remove(L.light);
  }
  megaLights.length = 0;
  megaLightBeats.clear();
  pooling.clear();
  wakeMegas = null;
  bandJobs.length = 0;
  bandPending.clear();
  hideBandShell();
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
      carveSphere(cx, cy, cz, kind, touched);
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
}
function untrackMega(x, y, z) {
  megaIndex.delete(x + "," + y + "," + z);
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
    const touched = [];
    for (let i = 0; i < members.length; i++) {
      carveSphere(members[i].x, members[i].y, members[i].z, kind, touched, true, radii[i]);
    }
    // Each pooled mega restores the liquid it was placed in, if any —
    // unless it clears liquids, in which case its cell stays air.
    for (const m of members) {
      const dk = m.x + "," + m.y + "," + m.z;
      const fill = displaced.get(dk) ?? null;
      displaced.delete(dk);
      if (fill !== null && !kind.clearsLiquids) {
        setBlock(m.x, m.y, m.z, fill);
        if (!touched.some(([x, y, z]) => x === m.x && y === m.y && z === m.z)) touched.push([m.x, m.y, m.z]);
      }
    }
    // Each mega gets its own fireball at its own radius; knockback and
    // shake stay single, from the centroid with the dominant reach.
    for (let i = 0; i < members.length; i++) {
      spawnMegaBlastFx(members[i].x, members[i].y, members[i].z, kind, local[i].k);
    }
    applyMegaKnockback(ax, ay, az, kind, R);
    if (onBlast) onBlast(ax, ay, az, R, kind.key);
    syncGlowAfterBlast();
    return touched;
  } finally {
    for (const m of members) pooling.delete(m.x + "," + m.y + "," + m.z);
  }
}

function carveSphere(cx, cy, cz, kind, touched, pool = false, Reff = kind.radius) {
  const R = Reff, R2 = R * R;
  // Clear the ignited block itself first so its cell refreshes even in air.
  if (isTntLike(getBlock(cx, cy, cz))) clearCell(cx, cy, cz, touched);
  for (let x = Math.max(-WORLD_RADIUS, Math.ceil(cx - R)); x <= Math.min(WORLD_RADIUS, Math.floor(cx + R)); x++) {
    for (let z = Math.max(-WORLD_RADIUS, Math.ceil(cz - R)); z <= Math.min(WORLD_RADIUS, Math.floor(cz + R)); z++) {
      const yLo = Math.max(1, Math.ceil(cy - R));
      let yHi = Math.floor(cy + R);
      // Skip the air above the terrain: only the blast at or below the
      // column top can hit anything (same cells as before, half the scan).
      const top = colTops[dim][colTopIdx(x, z)];
      if (top < yHi) yHi = top;
      if (top < yLo) continue;
      for (let y = yLo; y <= yHi; y++) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        const bid = getBlock(x, y, z);
        if (bid === AIR) continue;
        // Liquids survive blasts unless the kind clears them; otherwise
        // the blast passes through them. Custom carveBlast tiers must keep
        // this guard.
        if (isLiquid(bid) && !kind.clearsLiquids) continue;
      const victimKind = isTntLike(bid) ? kindOfBlock(bid) : null;
      // Ultras never pool and are never consumed: any carve uncovering one
      // queues its own band blast instead.
      if (victimKind && victimKind.band) {
        queueChained(x, y, z, victimKind);
        continue;
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
          continue;
        }
        if (victimKind) {
          if (pool) {
            // Normals inside a mega pool go off with it, no delayed cascade.
            clearCell(x, y, z, touched);
            continue;
          }
          queueChained(x, y, z, victimKind);
          continue;
        }
        clearCell(x, y, z, touched);
      }
    }
  }
}

export function litCount() {
  return lit.size;
}

export function pendingCount() {
  return pendingChain.size;
}
