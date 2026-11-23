// Block picking (DDA raycast) and editing: Left click places, Right
// click breaks — same mapping as master. First break-click on TNT lights
// its fuse (block kept, no remesh needed); a second break-click on lit TNT
// detonates it immediately.
import * as THREE from "three";
import { AIR, BLOCK_INFO, FLOWER, GLOWSTONE, TNT, isLiquid, isTntLike } from "../core/blocks.js";
import { dim, dimInfinite, getBlock, setBlock, outOfWorld, isCellProtected, chunkOf, worldRevision } from "../core/store.js";
import { pinTntCellAt } from "../world/tntstream.js";
import { dimFloorY, dimTntTiersUnlocked, dimHasMoon } from "../world/dimensions.js";
import { isTntTierUnlocked } from "../world/tntunlock.js";
import { PLAYER_HW, PLAYER_H, pos } from "./physics.js";
import { igniteTNT, isLitTNT, detonateNow, noteTntPlaced, kindOfBlock, trackMegaPlaced, trackRegularTntPlaced, trackBodyTnt } from "../fx/tnt.js";
import { planetBodyAtPlaced, activeBodySeed, rayBodyHit, bodyReady, bodySurfaceCell, noteBodyInteract } from "../world/planets.js";
import { refreshBlocks, isChunkBuilt, queueCelestialChunks } from "../render/mesher.js";
import { noteGlowstonePlace, noteGlowstonePlaceShared, glowVariantAt, clearGlowstoneAt } from "../world/glowstone.js";
import { noteFlowerPlace, clearFlowerAt } from "../world/flowers.js";
import { armReaction, clearReactionAt } from "../world/reactions.js";
import { notePoolEdit } from "../render/poollights.js";
import { MOON_MIN_Y, MOON_R, markMoonDirty, generateBodySurfaceRows, generateBodyUnderRows, requestBodyFill, keepBodyCell } from "../world/moon.js";
import { notePortalEdit, notePortalEdits, notePortalFramesOnly, toast } from "../world/portals.js";
import { allMobs } from "../mobs/registry.js";
import { cellBlockedByMob } from "../mobs/carry.js";
import { headroomBlocked, listPads, listVessels } from "../world/rocketpad.js";

export let currentBlock = null;
const pickCache = {
  valid: false, hit: null, skip: false, rev: -1,
  ex: 0, ey: 0, ez: 0, dx: 0, dy: 0, dz: 0,
};
// Quantized static-aim comparison: resting contact lets the eye/dir sit
// still up to float noise, so compare at sub-voxel quantum (1e-4 blocks,
// 1e-7 direction). Anything coarser risks a stale cell; anything finer
// misses on idle jitter.
const q4 = (v) => Math.round(v * 1e4);
const q7 = (v) => Math.round(v * 1e7);
const _dir = new THREE.Vector3();

export function pickBlock(origin, dir, skipLiquid, maxDist = Infinity, maxSteps = 1024, startT = 0) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? Math.floor(origin.x) + 1 - origin.x : origin.x - Math.floor(origin.x)) / Math.abs(dir.x)) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? Math.floor(origin.y) + 1 - origin.y : origin.y - Math.floor(origin.y)) / Math.abs(dir.y)) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? Math.floor(origin.z) + 1 - origin.z : origin.z - Math.floor(origin.z)) / Math.abs(dir.z)) : Infinity;
  let face = [0, 0, 0];
  // Ray distance of the hit cell (the face the ray entered through): the
  // mob picker uses it for occlusion.
  let t = 0;
  if (startT > 0) {
    // Seeded fast-forward: begin the walk at origin + dir * startT instead
    // of the eye. tMax values become absolute (startT + distance from the
    // advanced point to its next boundary) and t the advanced cell's exact
    // entry, so the returned hit keeps absolute-ray semantics.
    const sx = origin.x + dir.x * startT, sy = origin.y + dir.y * startT, sz = origin.z + dir.z * startT;
    x = Math.floor(sx); y = Math.floor(sy); z = Math.floor(sz);
    let back = Infinity;
    if (dir.x !== 0) {
      const d = (stepX > 0 ? sx - x : x + 1 - sx) / Math.abs(dir.x);
      tMaxX = startT + (stepX > 0 ? (x + 1 - sx) : (sx - x)) / Math.abs(dir.x);
      back = Math.min(back, d);
    }
    if (dir.y !== 0) {
      const d = (stepY > 0 ? sy - y : y + 1 - sy) / Math.abs(dir.y);
      tMaxY = startT + (stepY > 0 ? (y + 1 - sy) : (sy - y)) / Math.abs(dir.y);
      back = Math.min(back, d);
    }
    if (dir.z !== 0) {
      const d = (stepZ > 0 ? sz - z : z + 1 - sz) / Math.abs(dir.z);
      tMaxZ = startT + (stepZ > 0 ? (z + 1 - sz) : (sz - z)) / Math.abs(dir.z);
      back = Math.min(back, d);
    }
    t = startT - (back === Infinity ? 0 : back);
  }
  for (let i = 0; i < maxSteps; i++) {
    // Infinite dimensions keep stepping past the old cube (and below zero);
    // bounded dims keep the exact old bounds.
    if (!outOfWorld(x, y, z)) {
      const id = getBlock(x, y, z);
      if (id !== AIR && !(skipLiquid && isLiquid(id))) return { x, y, z, id, face, t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
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
  // Static-aim cache: a standing player re-picks the identical ray every
  // frame (local DDA + long-range geometric + seeded voxel re-pick). Reuse
  // while eye, direction, skip, and world revision are all identical — any
  // edit bumps the revision and forces a re-pick.
  const p = camera.position;
  if (pickCache.valid && pickCache.skip === skip && pickCache.rev === worldRevision &&
      q4(p.x) === pickCache.ex && q4(p.y) === pickCache.ey && q4(p.z) === pickCache.ez &&
      q7(_dir.x) === pickCache.dx && q7(_dir.y) === pickCache.dy && q7(_dir.z) === pickCache.dz) {
    currentBlock = pickCache.hit;
    return currentBlock;
  }
  currentBlock = pickBlock(camera.position, _dir, skip) ?? pickCelestialBody(camera.position, _dir);
  pickCache.valid = true;
  pickCache.hit = currentBlock;
  pickCache.skip = skip;
  pickCache.rev = worldRevision;
  pickCache.ex = q4(p.x); pickCache.ey = q4(p.y); pickCache.ez = q4(p.z);
  pickCache.dx = q7(_dir.x); pickCache.dy = q7(_dir.y); pickCache.dz = q7(_dir.z);
  return currentBlock;
}

export function breakTarget(camera) {
  camera.getWorldDirection(_dir);
  return pickBlock(camera.position, _dir, true) ?? pickCelestialBody(camera.position, _dir);
}

// Celestial pick fallback: past the DDA range (1024 voxels), aim at a body
// geometrically (same gate as the celestial grapple). Never builds here —
// the write path materializes the body on demand. Returns a DDA-shaped hit
// (voxel + face), real voxels when built, the geometric surface cell plus a
// dominant-axis face when not.
export function pickCelestialBody(origin, dir) {
  if (!dimHasMoon(dim)) return null;
  const hit = rayBodyHit(origin, dir);
  if (!hit) return null;
  // Seeded re-pick (always): the geometric hit is the nearest body on the
  // ray, so the void between eye and body holds no body voxels — start the
  // voxel walk at the geometric entry (minus a margin covering the
  // cylinder-corner air gap) instead of marching thousands of empty cells
  // from the eye. Runs whether or not the body has finished its background
  // fill: built and player-touched columns hold real voxels (the dome
  // shell, placed blocks), and chain digs on a far body must resolve them —
  // the old readiness gate reduced those picks to the geometric AIR cell,
  // so remote digs broke nothing until the whole body streamed in. Voxels
  // within the plain 1024-step DDA range above already resolved exactly;
  // past that, remote picks snap to bodies — mid-void player structures
  // past 1024 do not resolve through this path. A miss (unbuilt column)
  // falls through to the geometric surface cell: aim/placement shape, and
  // an honest no-op for breaks where nothing exists yet.
  const R = hit.spec.r ?? MOON_R;
  const MARGIN = R * 3 + 32;
  const re = pickBlock(origin, dir, true, Infinity, Math.ceil((MARGIN + R * 2) * 2), Math.max(0, hit.t - MARGIN));
  if (re) return { ...re, body: hit.spec };
  const [bx, by, bz] = bodySurfaceCell(hit);
  return {
    x: hit.x, y: hit.y, z: hit.z, id: AIR,
    face: [bx - hit.x, by - hit.y, bz - hit.z], t: hit.t, body: hit.spec,
  };
}

function intersectsPlayer(bx, by, bz) {
  return bx + 1 > pos.x - PLAYER_HW && bx < pos.x + PLAYER_HW &&
         bz + 1 > pos.z - PLAYER_HW && bz < pos.z + PLAYER_HW &&
         by + 1 > pos.y && by < pos.y + PLAYER_H;
}

// Solid blocks never embed a live mob body: same AABB overlap as the
// player check, over the simple hw/h box. The rule itself is pure and
// three-free (cellBlockedByMob in carry.js, headless-tested); here only
// the live list (registry sources, or opts.mobs in tests) is wired in.
function intersectsMob(bx, by, bz, opts) {
  return cellBlockedByMob(opts?.mobs ?? allMobs(), dim, bx, by, bz);
}

// Live edits never leave free-floating liquid: any same-liquid group
// (face-or-edge-connected, corners excluded) left without a solid face-
// or edge-neighbor is purged back to air. Rule + discovery live in
// core/liquid (three-free, headless-tested); this module only applies
// the writes.
import { findFloatingLiquids, createStrokeUnion, noteStrokeCells, takeStrokeUnion } from "../core/liquid.js";

export function purgeFloatingLiquidsAround(coords) {
  const purged = [];
  for (const [x, y, z] of findFloatingLiquids(getBlock, coords)) {
    setBlock(x, y, z, AIR);
    if (y >= MOON_MIN_Y) markMoonDirty();
    notePortalEdit(x, y, z);
    purged.push([x, y, z]);
  }
  return purged;
}

// Batched chain path: with opts.batch, tryPlace/breakBlockAt skip the
// per-cell liquid purge, portal fill refresh, and light recompute, and the
// caller flushes once per tick via flushChainBatch. Discrete taps use the
// default unbatched path, unchanged.
// Stroke rule: chain holds validate liquids once, at release — not per
// tick. Re-flooding the growing stroke mass every tick froze the frame
// (quadratic); solids need no purge at all, and one end-of-stroke flood
// over the union is linear.
const strokeUnion = createStrokeUnion();
const pendingChainGlow = [];
// Liquid-transition cells of the current stroke: tryPlace liquid writes only
// (batched strokes; placement targets are air-or-liquid by construction, so
// a liquid post-state here never came from solid). The chain caller drains
// this once per tick and hands it to the mesher, which rebuilds only chunks
// whose meshes can actually change instead of the full halo fan-out.
const pendingLiquidCells = [];
export function takeLiquidCells() {
  if (!pendingLiquidCells.length) return null;
  const out = pendingLiquidCells.splice(0);
  return out;
}

export function breakBlockAt(x, y, z, opts) {
  const batched = !!opts?.batch;
  // The dimension's floor level (null = floorless) is unbreakable by hand.
  if (y === dimFloorY(dim)) return [];
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
  if (bid === GLOWSTONE) clearGlowstoneAt(x, y, z);
  if (bid === FLOWER) clearFlowerAt(x, y, z);
  // Reaction state is id-agnostic by design (any future base clears through
  // the same call), so unlike the looks above it is dropped unconditionally.
  clearReactionAt(x, y, z);
  setBlock(x, y, z, AIR);
  if (y >= MOON_MIN_Y) markMoonDirty();
  // Breaking a body cell counts as interacting with it (same LOD keep rule
  // as placements).
  {
    const b = planetBodyAtPlaced(x, y, z);
    if (b && dimHasMoon(dim)) noteBodyInteract(activeBodySeed(), b.key);
  }
  if (dimInfinite()) pinTntCellAt(x, y, z);
  notePoolEdit();
  if (batched) return [[x, y, z]];
  notePortalEdit(x, y, z);
  const purged = purgeFloatingLiquidsAround([[x, y, z]]);
  return [[x, y, z], ...purged];
}

export function tryPlace(id, px, py, pz, opts) {
  const batched = !!opts?.batch;
  if (!BLOCK_INFO[id] || !BLOCK_INFO[id].placeable) return null;
  // Mega/ultra stay locked outside the TNT dimension until their dragon-kill
  // unlocks (or ?cheat=1); the chain path funnels through here too.
  if (isTntLike(id) && !dimTntTiersUnlocked(dim) && !isTntTierUnlocked(id)) return null;
  // Bounded dims keep the y = 0 floor unplaceable; the infinite sky builds
  // anywhere in the key range.
  if (py < 0 && !dimInfinite()) return null;
  // Remote builds: a face-adjacent cell of an unbuilt body (picked past DDA
  // range) materializes the body first, or the placement would land in void
  // and the next fill would pave over it.
  {
    const b = planetBodyAtPlaced(px, py, pz);
    if (b && dimHasMoon(dim) && !bodyReady(activeBodySeed(), b.key)) {
      // First touch builds only the target column now (cap + shell + lake
      // shafts for that column); the main-loop slicer completes the rest
      // over frames — no single-frame whole-body hitch on first placing.
      // Remesh the real column chunk when built (sync, so the placed block
      // shows at once); unbuilt far chunks ride the celestial queue — the
      // old call passed chunk coords as voxel coords and refreshed the
      // wrong neighborhood while leaving the placed cell unmeshed.
      const seed = activeBodySeed();
      generateBodySurfaceRows(b, seed, setBlock, px, px + 1);
      generateBodyUnderRows(b, seed, setBlock, px, px + 1, getBlock);
      requestBodyFill(seed, b.key);
      if (isChunkBuilt(chunkOf(px) + "_" + chunkOf(pz))) refreshBlocks([[px, 0, pz]]);
      else queueCelestialChunks([[px, 0, pz]]);
    }
  }
  const target = getBlock(px, py, pz);
  if (!(target === AIR || isLiquid(target))) return null;
  if (BLOCK_INFO[id].solid && intersectsPlayer(px, py, pz)) return null;
  if (BLOCK_INFO[id].solid && intersectsMob(px, py, pz, opts)) return null;
  // Headroom rule (overworld only): no block in 6-face contact with the top
  // of a takeoff box or an independent parked vessel, so a ship can always
  // lift off. Discrete taps toast; chain strokes refuse silently and roll on.
  if (dim === "over" && headroomBlocked(px, py, pz, { pads: listPads(), vessels: listVessels() })) {
    if (!batched) toast("No block on top of ship");
    return null;
  }
  setBlock(px, py, pz, id);
  if (py >= MOON_MIN_Y) markMoonDirty();
  // Player-touched bodies stay meshed at any range (the LOD keeps their real
  // voxels instead of the proxy): note every successful celestial place.
  // Never let a completing body fill pave over this cell: first-touch (and
  // stroke) placements on a still-unbuilt body are skipped by the slicer.
  {
    const b = planetBodyAtPlaced(px, py, pz);
    if (b && dimHasMoon(dim)) {
      noteBodyInteract(activeBodySeed(), b.key);
      if (!bodyReady(activeBodySeed(), b.key)) {
        keepBodyCell(activeBodySeed(), b.key, px, py, pz);
      }
    }
  }
  // Block reactions (world/reactions.js): a liquid trigger placed on a
  // reacting base is drunk at once — before portal/purge/narrow-liquid
  // bookkeeping sees it as liquid, so the drunk cell returns to air with a
  // single purge and never enters the liquid-transition set.
  let drunk = null;
  if (isLiquid(id)) {
    const arm = armReaction(px, py - 1, pz, id);
    if (arm && arm.consumed) {
      setBlock(px, py, pz, AIR);
      drunk = [[px, py, pz], ...purgeFloatingLiquidsAround([[px, py, pz]])];
    }
  }
  if (batched && isLiquid(id) && !drunk) pendingLiquidCells.push([px, py, pz]);
  notePoolEdit();
  if (id === TNT) trackRegularTntPlaced(px, py, pz);
  // Celestial placements feed the remote-detonation index (right-click a
  // body from afar ignites/detonates its nearest TNT); lazy-validated, so
  // no untracking needed on any removal path.
  if (isTntLike(id)) {
    const b = planetBodyAtPlaced(px, py, pz);
    if (b) trackBodyTnt(activeBodySeed(), b.key, px, py, pz);
  }
  // Player content pins its stream cell: edits (and portal frames built
  // from them) never evict within a visit.
  if (dimInfinite()) pinTntCellAt(px, py, pz);
  if (id === GLOWSTONE) {
    // Variant assignment is deferred in batch mode (the remesh drain reads
    // it later); the halo tint follows from the chunk rebuilds.
    if (batched) pendingChainGlow.push([px, py, pz]);
    else {
      noteGlowstonePlace(px, py, pz);
    }
  }
  if (id === FLOWER) noteFlowerPlace(px, py, pz);
  if (kindOfBlock(id).pool) trackMegaPlaced(px, py, pz);
  if (isTntLike(id) && isLiquid(target)) noteTntPlaced(px, py, pz, target);
  if (batched) return drunk ?? [[px, py, pz]];
  notePortalEdit(px, py, pz);
  // A drunk trigger already purged on the way to air: return its cells as
  // they are instead of purging the same neighborhood twice.
  if (drunk) return drunk;
  const purged = purgeFloatingLiquidsAround([[px, py, pz]]);
  return [[px, py, pz], ...purged];
}

// End-of-tick flush for the batched chain path: glowstone variants, stroke
// union bookkeeping (the liquid purge itself waits for release —
// endChainStroke — so holds never re-flood the growing mass), one portal
// frame pass (fills heal from the dirty flag via the periodic scanner,
// like band wipes).
// Adjacent pending stones share the previous variant instead of rescanning
// the whole stone set each (pads stamp neighbours; the shared color is the
// clustering intent); non-adjacent ones roll normally. Returns [] (no
// per-tick purge anymore); the caller remeshes the touched cells as usual.
export function flushChainBatch(cells) {
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
  }
  notePoolEdit();
  if (!cells.length) return [];
  noteStrokeCells(strokeUnion, dim, cells);
  notePortalFramesOnly(cells);
  return [];
}

// Stroke release: the single liquid purge over the whole stroke union.
// Floating water painted mid-stroke stays until now, then returns to air
// at once; anchored strokes purge nothing. Returns the purged cells so the
// caller can refresh and notify them like a discrete edit would.
export function endChainStroke() {
  const union = takeStrokeUnion(strokeUnion);
  if (!union.length) return [];
  return purgeFloatingLiquidsAround(union);
}

// World reset mid-hold: the voxels are rebuilt anyway, so the pending
// union is dropped, never purged (its coordinates are stale).
export function clearChainStroke() {
  takeStrokeUnion(strokeUnion);
}

export function placeAtSelection(id, eyeY) {
  if (!currentBlock) return null;
  const [nx, ny, nz] = currentBlock.face;
  const opts = eyeY == null ? undefined : { eyeY };
  return tryPlace(id, currentBlock.x + nx, currentBlock.y + ny, currentBlock.z + nz, opts);
}
