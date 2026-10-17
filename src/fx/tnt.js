// TNT: breaking a TNT block lights a short fuse, then a spherical blast
// clears terrain and chains neighboring TNT. Blast kinds are data: shared
// properties live in TNT_DEFAULTS, entries override only what differs.
// Differing behavior is a capability flag the framework branches on
// (blastKind, countdownKind, fxKind, veil/halo/light/knockback) or an
// optional function prop (carveBlast, spawnBlastFx, make/tick/clearLitVisual)
// that a tier supplies — framework code never switches on kind names.
// Only "normal" ships; mega ("pooled" blast, "bucket" countdown, "mega" fx)
// and ultra ("band" blast, halo, lights) arrive as entries reusing ids 22/23.
// Bedrock (y=0) and liquids are spared; a TNT placed in
// liquid restores that liquid in its cell after its blast.
import { AIR, TNT, isLiquid } from "../core/blocks.js";
import { WORLD_RADIUS, MAX_Y, getBlock, setBlock } from "../core/store.js";
import { spawnBurst, spawnFlash } from "./particles.js";
import * as THREE from "three";

const TNT_DEFAULTS = {
  fuse: 3.0,
  radius: 3,
  burst: 64,
  chainDelay: 0.05, // seconds between chained blasts (master: 50 ms)
  blastKind: "sphere", // "pooled" (mega) | "band" (ultra) later via carveBlast
  countdownKind: "sprite", // "bucket" (mega/ultra) later via *LitVisual hooks
  fxKind: "burst", // "mega" | "ultra" later via spawnBlastFx
  veil: false,
  halo: false,
  light: false,
  knockback: false,
};

export const TNT_TYPES = [
  { ...TNT_DEFAULTS, key: "normal", blockId: TNT },
];

function kindOf(key) {
  return TNT_TYPES.find((t) => t.key === key) ?? TNT_TYPES[0];
}

function kindOfBlock(id) {
  return TNT_TYPES.find((t) => t.blockId === id) ?? TNT_TYPES[0];
}

const lit = new Map(); // "x,y,z" -> { x, y, z, id, fuse, total, kind }
const sprites = new Map(); // "x,y,z" -> THREE.Sprite countdown
const pendingChain = new Map(); // "x,y,z" -> { x, y, z, kind, due } delayed blasts
// Liquid displaced when a TNT was placed ("x,y,z" -> liquid id), restored
// in that cell after its blast. TNT placed in air leaves air behind.
const displaced = new Map();
let sceneRef = null;
let onBlast = null;

export function initTNTFx(scene) {
  sceneRef = scene;
}

export function onExplode(fn) {
  onBlast = fn;
}

// Records the liquid a placed TNT replaced; called once per placement.
export function noteTntPlaced(x, y, z, id) {
  displaced.set(x + "," + y + "," + z, id);
}

// New worlds never inherit another world's placements.
export function resetTNTMemory() {
  displaced.clear();
}

export function igniteTNT(x, y, z, kindKey = "normal") {
  const k = x + "," + y + "," + z;
  if (lit.has(k)) return;
  const id = getBlock(x, y, z);
  if (id !== TNT) return;
  const kind = kindOf(kindKey);
  lit.set(k, { x, y, z, id, fuse: kind.fuse, total: kind.fuse, kind: kind.key });
  if (sceneRef && !sprites.has(k)) {
    if (typeof kind.makeLitVisual === "function") {
      kind.makeLitVisual(x, y, z, kind);
    } else {
      const spr = makeFuseSprite();
      spr.position.set(x + 0.5, y + 1.35, z + 0.5);
      drawFuseSprite(spr, kind.fuse, false);
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
  spr.userData = { canvas: c, tex, shown: null, red: null };
  return spr;
}

// Redrawn per tenth of a second or color change; white, orange-red under 1 s.
function drawFuseSprite(spr, v, red = false) {
  const tenth = Math.max(0, Math.ceil(v * 10) / 10);
  if (spr.userData.shown === tenth && spr.userData.red === red) return;
  spr.userData.shown = tenth;
  spr.userData.red = red;
  const ctx = spr.userData.canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = "bold 52px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 10; ctx.strokeStyle = "rgba(0,0,0,0.85)";
  const label = tenth.toFixed(1);
  ctx.strokeText(label, 64, 34);
  ctx.fillStyle = red ? "#ff2222" : tenth <= 1 ? "#ff6a3d" : "#fff";
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
  const now = performance.now() / 1000;
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
        if (spr) drawFuseSprite(spr, t.fuse, false);
      }
      if (t.fuse <= 0) {
        done.push(k);
        explode(t.x, t.y, t.z, kind, refresh);
      }
    }
    for (const k of done) lit.delete(k);
  }
  tickChain(now, refresh);
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
  const touched = [];
  removeSprite(cx + "," + cy + "," + cz, kind);
  spawnBlastFx(cx, cy, cz, kind);
  const dk = cx + "," + cy + "," + cz;
  const fill = displaced.get(dk) ?? null;
  displaced.delete(dk);
  if (typeof kind.carveBlast === "function") {
    kind.carveBlast(cx, cy, cz, kind, queueChained, touched);
  } else {
    carveSphere(cx, cy, cz, kind, touched);
  }
  // A record exists only while its TNT stands (TNT is manually unremovable,
  // records die at blast or world build), so fill needs no extra guard.
  if (fill !== null) {
    setBlock(cx, cy, cz, fill);
    if (!touched.some(([x, y, z]) => x === cx && y === cy && z === cz)) touched.push([cx, cy, cz]);
  }
  if (refresh) refresh(touched);
  if (onBlast) onBlast(cx, cy, cz, kind.radius);
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
  pendingChain.set(k, { x, y, z, kind: kind.key, due: performance.now() / 1000 + kind.chainDelay });
}

function carveSphere(cx, cy, cz, kind, touched) {
  const R = kind.radius, R2 = R * R;
  // Clear the ignited block itself first so its cell refreshes even in air.
  if (getBlock(cx, cy, cz) === kind.blockId || getBlock(cx, cy, cz) === TNT) {
    setBlock(cx, cy, cz, AIR);
    touched.push([cx, cy, cz]);
  }
  for (let x = Math.max(-WORLD_RADIUS, Math.ceil(cx - R)); x <= Math.min(WORLD_RADIUS, Math.floor(cx + R)); x++) {
    for (let y = Math.max(1, Math.ceil(cy - R)); y <= Math.min(MAX_Y, Math.floor(cy + R)); y++) {
      for (let z = Math.max(-WORLD_RADIUS, Math.ceil(cz - R)); z <= Math.min(WORLD_RADIUS, Math.floor(cz + R)); z++) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        const bid = getBlock(x, y, z);
        if (bid === AIR) continue;
        // Liquids survive blasts; the blast passes through them.
        // Custom carveBlast tiers must keep this guard.
        if (isLiquid(bid)) continue;
        if (bid === kind.blockId || bid === TNT) {
          queueChained(x, y, z, kindOfBlock(bid));
          continue;
        }
        setBlock(x, y, z, AIR);
        touched.push([x, y, z]);
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
