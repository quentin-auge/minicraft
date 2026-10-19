// Block picking (DDA raycast) and editing: Left click places, Right
// click breaks — same mapping as master. First break-click on TNT lights
// its fuse (block kept, no remesh needed); a second break-click on lit TNT
// detonates it immediately.
import * as THREE from "three";
import { AIR, BLOCK_INFO, FLOWER, GLOWSTONE, TNT, isLiquid, isTntLike } from "../core/blocks.js";
import { dim, dimInfinite, getBlock, setBlock, outOfWorld, isCellProtected } from "../core/store.js";
import { pinTntCellAt } from "../world/tntstream.js";
import { dimHasBedrock, dimTntTiersUnlocked } from "../world/dimensions.js";
import { isTntTierUnlocked } from "../world/tntunlock.js";
import { PLAYER_HW, PLAYER_H, pos } from "./physics.js";
import { igniteTNT, isLitTNT, detonateNow, noteTntPlaced, kindOfBlock, trackMegaPlaced, trackRegularTntPlaced } from "../fx/tnt.js";
import { noteGlowstonePlace, noteGlowstonePlaceShared, glowVariantAt, clearGlowstoneAt } from "../world/glowstone.js";
import { noteFlowerPlace, clearFlowerAt } from "../world/flowers.js";
import { noteBlockLightEdit } from "../render/blocklights.js";
import { notePortalEdit, notePortalEdits, notePortalFramesOnly } from "../world/portals.js";

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
    // Infinite dimensions keep stepping past the old cube (and below zero);
    // bounded dims keep the exact old bounds.
    if (!outOfWorld(x, y, z)) {
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

// Batched chain path: with opts.batch, tryPlace/breakBlockAt skip the
// per-cell liquid purge, portal fill refresh, and light recompute, and the
// caller flushes once per tick via flushChainBatch. Discrete taps use the
// default unbatched path, unchanged.
const pendingChainGlow = [];
let pendingChainGlowBreak = false;

export function breakBlockAt(x, y, z, opts) {
  const batched = !!opts?.batch;
  // Bedrock floor exists only in dimensions that declare it (overworld);
  // the TNT cube has no floor — nothing to protect at y = 0.
  if (y === 0 && dimHasBedrock(dim)) return [];
  if (isCellProtected(x, y, z)) return [];
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
  if (bid === GLOWSTONE) {
    clearGlowstoneAt(x, y, z);
    if (batched) pendingChainGlowBreak = true;
    else noteBlockLightEdit();
  }
  if (bid === FLOWER) clearFlowerAt(x, y, z);
  setBlock(x, y, z, AIR);
  if (dimInfinite()) pinTntCellAt(x, y, z);
  if (batched) return [[x, y, z]];
  notePortalEdit(x, y, z);
  const purged = purgeFloatingLiquidsAround([[x, y, z]]);
  return [[x, y, z], ...purged];
}

export function tryPlace(id, px, py, pz, opts) {
  const batched = !!opts?.batch;
  if (!BLOCK_INFO[id] || !BLOCK_INFO[id].placeable) return null;
  // Mega/ultra stay locked outside the TNT dimension until their dragon-kill
  // unlocks (or ?unlock_tnt=1); the chain path funnels through here too.
  if (isTntLike(id) && !dimTntTiersUnlocked(dim) && !isTntTierUnlocked(id)) return null;
  // Bounded dims keep the y = 0 floor unplaceable; the infinite sky builds
  // anywhere in the key range.
  if (py < 0 && !dimInfinite()) return null;
  const target = getBlock(px, py, pz);
  if (!(target === AIR || isLiquid(target))) return null;
  if (BLOCK_INFO[id].solid && intersectsPlayer(px, py, pz)) return null;
  setBlock(px, py, pz, id);
  if (id === TNT) trackRegularTntPlaced(px, py, pz);
  // Player content pins its stream cell: edits (and portal frames built
  // from them) never evict within a visit.
  if (dimInfinite()) pinTntCellAt(px, py, pz);
  if (id === GLOWSTONE) {
    // Variant assignment is deferred in batch mode (the remesh drain reads
    // it later); the single light recompute happens in flushChainBatch.
    if (batched) pendingChainGlow.push([px, py, pz]);
    else {
      noteGlowstonePlace(px, py, pz);
      noteBlockLightEdit();
    }
  }
  if (id === FLOWER) noteFlowerPlace(px, py, pz);
  if (kindOfBlock(id).pool) trackMegaPlaced(px, py, pz);
  if (isTntLike(id) && isLiquid(target)) noteTntPlaced(px, py, pz, target);
  if (batched) return [[px, py, pz]];
  notePortalEdit(px, py, pz);
  const purged = purgeFloatingLiquidsAround([[px, py, pz]]);
  return [[px, py, pz], ...purged];
}

// End-of-tick flush for the batched chain path: glowstone variants, one
// light recompute, one liquid purge over the union, one portal frame pass
// (fills heal from the dirty flag via the periodic scanner, like band wipes).
// Adjacent pending stones share the previous variant instead of rescanning
// the whole stone set each (pads stamp neighbours; the shared color is the
// clustering intent); non-adjacent ones roll normally. Returns the purged
// cells so the caller can refresh them too.
export function flushChainBatch(cells) {
  let glow = pendingChainGlowBreak;
  pendingChainGlowBreak = false;
  let last = null;
  for (const [x, y, z] of pendingChainGlow.splice(0)) {
    if (
      last &&
      Math.max(Math.abs(x - last[0]), Math.abs(y - last[1]), Math.abs(z - last[2])) <= 1
    ) {
      // Share last's variant: register directly instead of a fresh roll.
      noteGlowstonePlaceShared(x, y, z, last[3]);
    } else {
      noteGlowstonePlace(x, y, z);
    }
    last = [x, y, z, glowVariantAt(x, y, z)];
    glow = true;
  }
  if (glow) noteBlockLightEdit();
  if (!cells.length) return [];
  const purged = purgeFloatingLiquidsAround(cells);
  notePortalFramesOnly(purged.length ? [...cells, ...purged] : cells);
  return purged;
}

export function placeAtSelection(id) {
  if (!currentBlock) return null;
  const [nx, ny, nz] = currentBlock.face;
  return tryPlace(id, currentBlock.x + nx, currentBlock.y + ny, currentBlock.z + nz);
}
