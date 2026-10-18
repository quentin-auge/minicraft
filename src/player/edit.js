// Block picking (DDA raycast) and editing: Left click places, Right
// click breaks — same mapping as master. First break-click on TNT lights
// its fuse (block kept, no remesh needed); a second break-click on lit TNT
// detonates it immediately.
import * as THREE from "three";
import { AIR, BLOCK_INFO, FLOWER, GLOWSTONE, isLiquid, isTntLike } from "../core/blocks.js";
import { WORLD_RADIUS, dim, getBlock, setBlock } from "../core/store.js";
import { dimHasBedrock } from "../world/dimensions.js";
import { PLAYER_HW, PLAYER_H, pos } from "./physics.js";
import { igniteTNT, isLitTNT, detonateNow, noteTntPlaced, kindOfBlock, trackMegaPlaced } from "../fx/tnt.js";
import { noteGlowstonePlace, clearGlowstoneAt } from "../world/glowstone.js";
import { noteFlowerPlace, clearFlowerAt } from "../world/flowers.js";
import { noteBlockLightEdit } from "../render/blocklights.js";
import { notePortalEdit, notePortalEdits } from "../world/portals.js";

export let currentBlock = null;
const _dir = new THREE.Vector3();

export function pickBlock(origin, dir, skipLiquid, maxDist = Infinity, maxSteps = 1024) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? Math.floor(origin.x) + 1 - origin.x : origin.x - Math.floor(origin.x)) / Math.abs(dir.x)) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? Math.floor(origin.y) + 1 - origin.y : origin.y - Math.floor(origin.y)) / Math.abs(dir.y)) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? Math.floor(origin.z) + 1 - origin.z : origin.z - Math.floor(origin.z)) / Math.abs(dir.z)) : Infinity;
  let face = [0, 0, 0];
  for (let i = 0; i < maxSteps; i++) {
    const out = x < -WORLD_RADIUS || x > WORLD_RADIUS || z < -WORLD_RADIUS || z > WORLD_RADIUS || y < 0;
    if (!out) {
      const id = getBlock(x, y, z);
      if (id !== AIR && !(skipLiquid && isLiquid(id))) return { x, y, z, id, face };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
    if (Math.min(tMaxX, tMaxY, tMaxZ) > maxDist) break;
  }
  return null;
}

export function eyeInLiquid(position) {
  return isLiquid(getBlock(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
}

export function updateTarget(camera, selectedId, eyeLiquid = eyeInLiquid(camera.position)) {
  camera.getWorldDirection(_dir);
  // Placement targeting through liquids: non-liquid selection always
  // passes through; liquid selection passes through only while the eye
  // sits inside liquid, otherwise the ray stops at liquid.
  const skip = !isLiquid(selectedId) || eyeLiquid;
  currentBlock = pickBlock(camera.position, _dir, skip);
  return currentBlock;
}

export function breakTarget(camera) {
  camera.getWorldDirection(_dir);
  return pickBlock(camera.position, _dir, true);
}

function intersectsPlayer(bx, by, bz) {
  return bx + 1 > pos.x - PLAYER_HW && bx < pos.x + PLAYER_HW &&
         bz + 1 > pos.z - PLAYER_HW && bz < pos.z + PLAYER_HW &&
         by + 1 > pos.y && by < pos.y + PLAYER_H;
}

// Live edits never leave free-floating liquid: any same-liquid group left
// without a solid 6-neighbor is purged back to air.
import { key } from "../core/store.js";
const LIQUID_NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function liquidTouchesSolid(x, y, z) {
  for (const [dx, dy, dz] of LIQUID_NB) {
    const id = getBlock(x + dx, y + dy, z + dz);
    if (id !== AIR && BLOCK_INFO[id] && BLOCK_INFO[id].solid) return true;
  }
  return false;
}

export function purgeFloatingLiquidsAround(coords) {
  const seen = new Set();
  const purged = [];
  const seeds = [];
  for (const [x, y, z] of coords) {
    if (isLiquid(getBlock(x, y, z))) seeds.push([x, y, z]);
    for (const [dx, dy, dz] of LIQUID_NB) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (ny < 0) continue;
      if (isLiquid(getBlock(nx, ny, nz))) seeds.push([nx, ny, nz]);
    }
  }
  for (const [sx, sy, sz] of seeds) {
    const lid = getBlock(sx, sy, sz);
    if (!isLiquid(lid)) continue;
    const sk = key(sx, sy, sz);
    if (seen.has(sk)) continue;
    const cells = [];
    const stack = [[sx, sy, sz]];
    seen.add(sk);
    let grounded = false;
    let guard = 0;
    while (stack.length) {
      if (++guard > 60000) { grounded = true; break; }
      const [x, y, z] = stack.pop();
      cells.push([x, y, z]);
      if (liquidTouchesSolid(x, y, z)) { grounded = true; break; }
      for (const [dx, dy, dz] of LIQUID_NB) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0) continue;
        if (getBlock(nx, ny, nz) !== lid) continue;
        const nk = key(nx, ny, nz);
        if (seen.has(nk)) continue;
        seen.add(nk);
        stack.push([nx, ny, nz]);
      }
    }
    if (grounded) continue;
    for (const [x, y, z] of cells) {
      if (y === 0) continue;
      if (getBlock(x, y, z) !== lid) continue;
      setBlock(x, y, z, AIR);
      notePortalEdit(x, y, z);
      purged.push([x, y, z]);
    }
  }
  return purged;
}

export function breakBlockAt(x, y, z) {
  // Bedrock floor exists only in dimensions that declare it (overworld);
  // the TNT cube has no floor — nothing to protect at y = 0.
  if (y === 0 && dimHasBedrock(dim)) return [];
  const bid = getBlock(x, y, z);
  if (bid === AIR) return [];
  if (isLiquid(bid)) return [];
  if (isTntLike(bid)) {
    // Second click detonates at once with no refresh callback in play, so
    // the blast itself must notify the portal index — otherwise destroyed
    // frames keep stale fills until the player walks within scanner range.
    // (Ultra returns [] here; its band path owns fills end-to-end.)
    if (isLitTNT(x, y, z)) {
      const touched = detonateNow(x, y, z);
      notePortalEdits(touched);
      return touched;
    }
    igniteTNT(x, y, z);
    return [];
  }
  if (bid === GLOWSTONE) clearGlowstoneAt(x, y, z);
  if (bid === FLOWER) clearFlowerAt(x, y, z);
  setBlock(x, y, z, AIR);
  if (bid === GLOWSTONE) noteBlockLightEdit();
  notePortalEdit(x, y, z);
  const purged = purgeFloatingLiquidsAround([[x, y, z]]);
  return [[x, y, z], ...purged];
}

export function tryPlace(id, px, py, pz) {
  if (!BLOCK_INFO[id] || !BLOCK_INFO[id].placeable) return null;
  if (py < 0) return null;
  const target = getBlock(px, py, pz);
  if (!(target === AIR || isLiquid(target))) return null;
  if (BLOCK_INFO[id].solid && intersectsPlayer(px, py, pz)) return null;
  setBlock(px, py, pz, id);
  if (id === GLOWSTONE) {
    noteGlowstonePlace(px, py, pz);
    noteBlockLightEdit();
  }
  if (id === FLOWER) noteFlowerPlace(px, py, pz);
  if (kindOfBlock(id).pool) trackMegaPlaced(px, py, pz);
  notePortalEdit(px, py, pz);
  if (isTntLike(id) && isLiquid(target)) noteTntPlaced(px, py, pz, target);
  const purged = purgeFloatingLiquidsAround([[px, py, pz]]);
  return [[px, py, pz], ...purged];
}

export function placeAtSelection(id) {
  if (!currentBlock) return null;
  const [nx, ny, nz] = currentBlock.face;
  return tryPlace(id, currentBlock.x + nx, currentBlock.y + ny, currentBlock.z + nz);
}
