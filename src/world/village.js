// Village layout and structure placement, ported from master.
// No mobs: houses, pen, and pool are plain structures. Radius and house
// count are parameters so the village can grow later without touching
// terrain code.
import { AIR, GRASS, STONE, LOG, WATER, GLASS, PLANKS, PORTAL, OBSIDIAN } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import { WATER_LEVEL, WORLD_RADIUS } from "../core/store.js";

// Village dimensions as one spec object: a bigger or denser village
// overrides properties here, never the layout code below.
export const VILLAGE_SPEC = {
  radius: 28,
  houses: 8,
  pen: { w: 15, d: 13 },
  pool: { w: 8, d: 6, depth: 2 },
  penPool: { w: 2, d: 2, depth: 1 },
};

export const village = {
  center: { x: 0, z: 0, y: 0 },
  houses: [],
  pen: null,
  pool: null,
  minX: 0, maxX: 0, minZ: 0, maxZ: 0,
  radius: VILLAGE_SPEC.radius,
  houseCount: VILLAGE_SPEC.houses,
};

export function configureVillage({ radius = VILLAGE_SPEC.radius, houses = VILLAGE_SPEC.houses } = {}) {
  village.radius = radius;
  village.houseCount = houses;
}

// Picks a flat-ish site near the world center, then places pen, pool, and
// houses with mutual avoidance. Needs heightAt from the overworld module.
export function computeLayout(seed, heightAt) {
  const R = village.radius;
  village.houses = [];
  village.pen = null;
  village.pool = null;
  let vx = 0, vz = 0, vy = 0;
  for (let t = 0; t < 400; t++) {
    const cx = Math.round((hash2(t, 1, seed + 7100) * 2 - 1) * (WORLD_RADIUS - R - 6));
    const cz = Math.round((hash2(t, 2, seed + 7101) * 2 - 1) * (WORLD_RADIUS - R - 6));
    const h = heightAt(cx, cz);
    if (h > WATER_LEVEL + 1) { vx = cx; vz = cz; vy = h; break; }
    if (t === 0) { vx = cx; vz = cz; vy = h; }
  }
  village.center = { x: vx, z: vz, y: vy };
  village.minX = vx - R; village.maxX = vx + R;
  village.minZ = vz - R; village.maxZ = vz + R;

  for (let t = 0; t < 1200 && !village.pen; t++) {
    const rx = (hash2(t, 10, seed + 7250) * 2 - 1) * (R - Math.max(VILLAGE_SPEC.pen.w, VILLAGE_SPEC.pen.d) / 2 - 4);
    const rz = (hash2(t, 11, seed + 7251) * 2 - 1) * (R - Math.max(VILLAGE_SPEC.pen.w, VILLAGE_SPEC.pen.d) / 2 - 4);
    const cx = Math.round(vx + rx), cz = Math.round(vz + rz);
    const minX = cx - Math.floor(VILLAGE_SPEC.pen.w / 2), maxX = minX + VILLAGE_SPEC.pen.w - 1;
    const minZ = cz - Math.floor(VILLAGE_SPEC.pen.d / 2), maxZ = minZ + VILLAGE_SPEC.pen.d - 1;
    if (Math.hypot(cx - vx, cz - vz) + Math.max(VILLAGE_SPEC.pen.w, VILLAGE_SPEC.pen.d) / 2 + 1 > R) continue;
    village.pen = { cx, cz, vy, minX, maxX, minZ, maxZ };
    village.pen.pool = { minX: minX + 1, minZ: minZ + 1, maxX: minX + VILLAGE_SPEC.penPool.w, maxZ: minZ + VILLAGE_SPEC.penPool.d };
  }
  for (let t = 0; t < 1200 && !village.pool; t++) {
    const rx = (hash2(t, 12, seed + 7260) * 2 - 1) * (R - Math.max(VILLAGE_SPEC.pool.w, VILLAGE_SPEC.pool.d) / 2 - 4);
    const rz = (hash2(t, 13, seed + 7261) * 2 - 1) * (R - Math.max(VILLAGE_SPEC.pool.w, VILLAGE_SPEC.pool.d) / 2 - 4);
    const cx = Math.round(vx + rx), cz = Math.round(vz + rz);
    const minX = cx - Math.floor(VILLAGE_SPEC.pool.w / 2), maxX = minX + VILLAGE_SPEC.pool.w - 1;
    const minZ = cz - Math.floor(VILLAGE_SPEC.pool.d / 2), maxZ = minZ + VILLAGE_SPEC.pool.d - 1;
    if (Math.hypot(cx - vx, cz - vz) + Math.max(VILLAGE_SPEC.pool.w, VILLAGE_SPEC.pool.d) / 2 + 1 > R) continue;
    const p = village.pen;
    if (p && !(maxX + 2 < p.minX || minX - 2 > p.maxX || maxZ + 2 < p.minZ || minZ - 2 > p.maxZ)) continue;
    village.pool = { cx, cz, vy, minX, maxX, minZ, maxZ };
  }
  let tries = 0;
  for (let i = 0; i < village.houseCount;) {
    const rx = (hash2(tries, 0, seed + 7200 + i * 997) * 2 - 1) * (R - 7);
    const rz = (hash2(tries, 1, seed + 7200 + i * 997) * 2 - 1) * (R - 7);
    const cx = Math.round(vx + rx), cz = Math.round(vz + rz);
    tries++;
    if (Math.hypot(cx - vx, cz - vz) + 4 > R) { if (tries > 800) break; continue; }
    let ok = true;
    for (const h of village.houses) if (Math.abs(h.cx - cx) < 9 && Math.abs(h.cz - cz) < 9) { ok = false; break; }
    if (!ok) { if (tries > 800) break; continue; }
    const w = 7, d = 7;
    const minX = cx - Math.floor(w / 2), maxX = minX + w - 1;
    const minZ = cz - Math.floor(d / 2), maxZ = minZ + d - 1;
    const p = village.pen, q = village.pool;
    if (p && !(maxX + 2 < p.minX || minX - 2 > p.maxX || maxZ + 2 < p.minZ || minZ - 2 > p.maxZ)) { if (tries > 800) break; continue; }
    if (q && !(maxX + 2 < q.minX || minX - 2 > q.maxX || maxZ + 2 < q.minZ || minZ - 2 > q.maxZ)) { if (tries > 800) break; continue; }
    const toC = Math.atan2(vz - cz, vx - cx);
    const a = ((toC * 180 / Math.PI) + 360) % 360;
    let side = 0;
    if (a >= 45 && a < 135) side = 1;
    else if (a >= 135 && a < 225) side = 2;
    else if (a >= 225 && a < 315) side = 3;
    let doorX = cx, doorZ = minZ, doorNx = 0, doorNz = -1;
    if (side === 1) { doorX = maxX; doorZ = cz; doorNx = 1; doorNz = 0; }
    else if (side === 2) { doorX = cx; doorZ = maxZ; doorNx = 0; doorNz = 1; }
    else if (side === 3) { doorX = minX; doorZ = cz; doorNx = -1; doorNz = 0; }
    let d0x = doorX, d0z = doorZ, d1x = doorX, d1z = doorZ;
    if (doorNz !== 0) { d1x = doorX + 1; }
    else { d1z = doorZ + 1; }
    const varId = 1 + Math.floor(hash2(i, 9, seed + 7150) * 3);
    const beamMask = Math.floor(hash2(i, 20, seed + 7330) * 16);
    village.houses.push({ id: i, cx, cz, vy, minX, maxX, minZ, maxZ, doorNx, doorNz, d0x, d0z, d1x, d1z, varId, beamMask });
    i++;
  }
}

export function intersectsVillage(x, z, margin = 2) {
  if (!village.houses.length && !village.pen && !village.pool) return false;
  return x >= village.minX - margin && x <= village.maxX + margin &&
         z >= village.minZ - margin && z <= village.maxZ + margin;
}

export function isInsideAnyHouse(x, z) {
  for (const h of village.houses) if (x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ) return h;
  return null;
}

function placePool(setBlock, getBlock) {
  const p = village.pool;
  if (!p) return;
  const vy = p.vy;
  for (let x = p.minX; x <= p.maxX; x++) for (let z = p.minZ; z <= p.maxZ; z++) {
    setBlock(x, vy - VILLAGE_SPEC.pool.depth, z, OBSIDIAN);
    for (let y = vy - VILLAGE_SPEC.pool.depth + 1; y <= vy; y++) setBlock(x, y, z, WATER);
    if (getBlock(x, vy + 1, z) !== AIR) setBlock(x, vy + 1, z, AIR);
    if (getBlock(x, vy + 2, z) !== AIR) setBlock(x, vy + 2, z, AIR);
  }
  for (let x = p.minX - 1; x <= p.maxX + 1; x++) for (let z = p.minZ - 1; z <= p.maxZ + 1; z++) {
    const onRim = x === p.minX - 1 || x === p.maxX + 1 || z === p.minZ - 1 || z === p.maxZ + 1;
    if (!onRim) continue;
    for (let y = vy - VILLAGE_SPEC.pool.depth + 1; y <= vy; y++) setBlock(x, y, z, STONE);
  }
}

function placePen(setBlock, getBlock) {
  const p = village.pen;
  if (!p) return;
  const vy = p.vy;
  for (let x = p.minX + 1; x <= p.maxX - 1; x++) for (let z = p.minZ + 1; z <= p.maxZ - 1; z++) {
    setBlock(x, vy, z, GRASS);
    for (let y = vy + 1; y <= vy + 2; y++) setBlock(x, y, z, AIR);
  }
  for (let x = p.minX; x <= p.maxX; x++) for (let z = p.minZ; z <= p.maxZ; z++) {
    const onEdge = x === p.minX || x === p.maxX || z === p.minZ || z === p.maxZ;
    if (!onEdge) continue;
    setBlock(x, vy + 1, z, LOG);
    if (getBlock(x, vy + 2, z) !== AIR) setBlock(x, vy + 2, z, AIR);
  }
  const q = p.pool;
  if (!q) return;
  for (let x = q.minX; x <= q.maxX; x++) for (let z = q.minZ; z <= q.maxZ; z++) {
    setBlock(x, vy + 1 - VILLAGE_SPEC.penPool.depth, z, STONE);
    for (let y = vy + 2 - VILLAGE_SPEC.penPool.depth; y <= vy + 1; y++) setBlock(x, y, z, WATER);
    if (getBlock(x, vy + 2, z) !== AIR) setBlock(x, vy + 2, z, AIR);
    if (getBlock(x, vy + 3, z) !== AIR) setBlock(x, vy + 3, z, AIR);
  }
  for (let z = q.minZ; z <= q.maxZ + 1; z++) {
    setBlock(q.maxX + 1, vy + 1, z, STONE);
    if (getBlock(q.maxX + 1, vy + 2, z) !== AIR) setBlock(q.maxX + 1, vy + 2, z, AIR);
  }
  for (let x = q.minX; x <= q.maxX + 1; x++) {
    setBlock(x, vy + 1, q.maxZ + 1, STONE);
    if (getBlock(x, vy + 2, q.maxZ + 1) !== AIR) setBlock(x, vy + 2, q.maxZ + 1, AIR);
  }
}

function placeHouses(setBlock) {
  for (const h of village.houses) {
    const hh = 5;
    const { minX, maxX, minZ, maxZ, vy } = h;
    for (let y = vy + 1; y <= vy + hh; y++) {
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const wall = x === minX || x === maxX || z === minZ || z === maxZ;
        if (!wall) { if (y <= vy + 4) setBlock(x, y, z, AIR); continue; }
        const isDoor = (x === h.d0x && z === h.d0z) || (x === h.d1x && z === h.d1z);
        const isWin = (h.doorNz !== 0
          ? (z === (h.doorNz === -1 ? maxZ : minZ) && x === h.cx && y === vy + 2)
          : (x === (h.doorNx === 1 ? minX : maxX) && z === h.cz && y === vy + 2));
        if (y <= vy + 3 && isDoor) continue;
        if (isWin) { setBlock(x, y, z, GLASS); continue; }
        let mat = STONE;
        const isCorner = (x === minX && z === minZ) || (x === minX && z === maxZ) || (x === maxX && z === minZ) || (x === maxX && z === maxZ);
        if (isCorner && y <= vy + 4) mat = LOG;
        else if (y === vy + 3) {
          let onBeamWall = false;
          if (x === minX && (h.beamMask & 8)) onBeamWall = true;
          else if (x === maxX && (h.beamMask & 4)) onBeamWall = true;
          else if (z === minZ && (h.beamMask & 2)) onBeamWall = true;
          else if (z === maxZ && (h.beamMask & 1)) onBeamWall = true;
          if (onBeamWall || h.varId === 2) mat = PLANKS;
        } else if (y === vy + hh && isCorner) mat = LOG;
        setBlock(x, y, z, mat);
      }
    }
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const edge = x === minX || x === maxX || z === minZ || z === maxZ;
      setBlock(x, vy + hh, z, edge ? PORTAL : OBSIDIAN);
    }
    for (let x = minX + 1; x <= maxX - 1; x++) for (let z = minZ + 1; z <= maxZ - 1; z++) {
      const edge = x === minX + 1 || x === maxX - 1 || z === minZ + 1 || z === maxZ - 1;
      setBlock(x, vy + hh + 1, z, edge ? PORTAL : OBSIDIAN);
    }
    for (let x = minX + 2; x <= maxX - 2; x++) for (let z = minZ + 2; z <= maxZ - 2; z++) {
      const edge = x === minX + 2 || x === maxX - 2 || z === minZ + 2 || z === maxZ - 2;
      setBlock(x, vy + hh + 2, z, edge ? PORTAL : OBSIDIAN);
    }
    setBlock(h.cx, vy + hh + 3, h.cz, PORTAL);
    for (let x = minX + 1; x <= maxX - 1; x++) for (let z = minZ + 1; z <= maxZ - 1; z++) setBlock(x, vy + 1, z, AIR);
    for (const [dx, dz] of [[h.d0x, h.d0z], [h.d1x, h.d1z]])
      for (let y = vy + 1; y <= vy + 3; y++) setBlock(dx, y, dz, AIR);
  }
}

export function placeVillage(setBlock, getBlock) {
  placePen(setBlock, getBlock);
  placePool(setBlock, getBlock);
  placeHouses(setBlock);
}
