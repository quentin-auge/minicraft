// TNT: breaking or clicking a TNT block ignites a short fuse, then a
// spherical blast clears terrain and chains neighboring TNT. Blast kinds
// are data: shared properties live in TNT_DEFAULTS, entries override only
// what differs — a new tier (mega, ultra, ...) is one registry entry with
// its own fuse, radius, behavior mode, and effects, never a fork. Only
// "normal" ships. Bedrock (y=0) and village houses are spared.
import { AIR, TNT } from "../core/blocks.js";
import { WORLD_RADIUS, MAX_Y, getBlock, setBlock } from "../core/store.js";
import { isInsideAnyHouse } from "../world/village.js";
import { spawnBurst, spawnFlash } from "./particles.js";
import * as THREE from "three";

const TNT_DEFAULTS = {
  fuse: 2.0,
  radius: 4,
  mode: "sphere",
  chainDepth: 4,
  burst: 64,
};

export const TNT_TYPES = [
  { ...TNT_DEFAULTS, key: "normal" },
];

function kindOf(key) {
  return TNT_TYPES.find((t) => t.key === key) ?? TNT_TYPES[0];
}

const lit = new Map(); // "x,y,z" -> { x, y, z, id, fuse, total, kind }
const sprites = new Map(); // "x,y,z" -> THREE.Sprite countdown
let sceneRef = null;
let onBlast = null;

export function initTNTFx(scene) {
  sceneRef = scene;
}

export function onExplode(fn) {
  onBlast = fn;
}

export function igniteTNT(x, y, z, kindKey = "normal") {
  const k = x + "," + y + "," + z;
  if (lit.has(k)) return;
  const id = getBlock(x, y, z);
  if (id !== TNT) return;
  const kind = kindOf(kindKey);
  lit.set(k, { x, y, z, id, fuse: kind.fuse, total: kind.fuse, kind: kind.key });
  if (sceneRef && !sprites.has(k)) {
    const spr = makeFuseSprite();
    spr.position.set(x + 0.5, y + 1.35, z + 0.5);
    drawFuseSprite(spr, kind.fuse);
    sceneRef.add(spr);
    sprites.set(k, spr);
  }
}

function makeFuseSprite() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(1.5, 0.75, 1);
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
  ctx.lineWidth = 10; ctx.strokeStyle = "#000";
  const label = tenth.toFixed(1);
  ctx.strokeText(label, 64, 34);
  ctx.fillStyle = tenth <= 1 ? "#ff6a3d" : "#fff";
  ctx.fillText(label, 64, 34);
  spr.userData.tex.needsUpdate = true;
}

function removeSprite(k) {
  const spr = sprites.get(k);
  if (!spr) return;
  sprites.delete(k);
  if (sceneRef) sceneRef.remove(spr);
  spr.material.map.dispose();
  spr.material.dispose();
}

export function cancelTNT(x, y, z) {
  const k = x + "," + y + "," + z;
  lit.delete(k);
  removeSprite(k);
}

export function tickTNT(dt, refresh) {
  if (!lit.size) return;
  const done = [];
  const now = performance.now() / 1000;
  for (const [k, t] of lit) {
    // Fuse dies with its block if the player breaks it mid-burn.
    if (getBlock(t.x, t.y, t.z) !== t.id) { done.push(k); removeSprite(k); continue; }
    t.fuse -= dt;
    const spr = sprites.get(k);
    if (spr) {
      drawFuseSprite(spr, t.fuse);
      // Blink accelerates as the fuse runs out.
      const f = 2 + (1 - Math.max(0, t.fuse) / t.total) * 12;
      spr.material.opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now * f * Math.PI * 2));
    }
    if (t.fuse <= 0) {
      done.push(k);
      explode(t.x, t.y, t.z, kindOf(t.kind), refresh);
    }
  }
  for (const k of done) lit.delete(k);
}

function explode(cx, cy, cz, kind, refresh) {
  const R = kind.radius, R2 = R * R;
  const touched = [];
  removeSprite(cx + "," + cy + "," + cz);
  spawnFlash({ x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 });
  spawnBurst({ x: cx + 0.5, y: cy + 0.5, z: cz + 0.5, count: kind.burst });
  // Clear the ignited block itself first so chained fuses see air.
  if (getBlock(cx, cy, cz) === TNT) {
    setBlock(cx, cy, cz, AIR);
    touched.push([cx, cy, cz]);
  }
  for (let x = Math.max(-WORLD_RADIUS, Math.ceil(cx - R)); x <= Math.min(WORLD_RADIUS, Math.floor(cx + R)); x++) {
    for (let y = Math.max(1, Math.ceil(cy - R)); y <= Math.min(MAX_Y, Math.floor(cy + R)); y++) {
      for (let z = Math.max(-WORLD_RADIUS, Math.ceil(cz - R)); z <= Math.min(WORLD_RADIUS, Math.floor(cz + R)); z++) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        if (isInsideAnyHouse(x, z)) continue;
        const bid = getBlock(x, y, z);
        if (bid === AIR) continue;
        if (bid === TNT) {
          setBlock(x, y, z, AIR);
          touched.push([x, y, z]);
          igniteTNTBlast(x, y, z, kind, refresh, touched);
          continue;
        }
        setBlock(x, y, z, AIR);
        touched.push([x, y, z]);
      }
    }
  }
  if (refresh) refresh(touched);
  if (onBlast) onBlast(cx, cy, cz, kind.radius);
}

// Chain-detonated TNT explodes immediately with the same blast.
const chainDepth = { n: 0 };
function igniteTNTBlast(x, y, z, kind, refresh, touched) {
  if (chainDepth.n > kind.chainDepth) return;
  const R = kind.radius;
  chainDepth.n++;
  try {
    const R2 = R * R;
    for (let ax = Math.max(-WORLD_RADIUS, Math.ceil(x - R)); ax <= Math.min(WORLD_RADIUS, Math.floor(x + R)); ax++) {
      for (let ay = Math.max(1, Math.ceil(y - R)); ay <= Math.min(MAX_Y, Math.floor(y + R)); ay++) {
        for (let az = Math.max(-WORLD_RADIUS, Math.ceil(z - R)); az <= Math.min(WORLD_RADIUS, Math.floor(z + R)); az++) {
          const dx = ax - x, dy = ay - y, dz = az - z;
          if (dx * dx + dy * dy + dz * dz > R2) continue;
          if (isInsideAnyHouse(ax, az)) continue;
          const bid = getBlock(ax, ay, az);
          if (bid === AIR) continue;
          if (bid === TNT) {
            lit.delete(ax + "," + ay + "," + az);
            setBlock(ax, ay, az, AIR);
            touched.push([ax, ay, az]);
            igniteTNTBlast(ax, ay, az, kind, null, touched);
            continue;
          }
          setBlock(ax, ay, az, AIR);
          touched.push([ax, ay, az]);
        }
      }
    }
  } finally {
    chainDepth.n--;
  }
}

export function litCount() {
  return lit.size;
}
