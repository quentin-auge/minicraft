// Chunked streaming renderer: one InstancedMesh per block id per chunk,
// only for exposed blocks. Rebuilds stay local via refreshBlocks().
import * as THREE from "three";
import { AIR, BLOCK_INFO, FLOWER, GLASS, GLOWSTONE, MOON, MOON_WATER, isLiquid } from "../core/blocks.js";
import { WORLD_RADIUS, CHUNK, RENDER_DIST, getBlock, colTops, colOcc, dim, chunkOf, isEnclosedAir } from "../core/store.js";
import { materialsFor, liquidSurfaceMat, glowstoneMats } from "../core/textures.js";
import { FLOWER_GEOS, FLOWER_MAT, flowerVariantAt, flowerAngleAt } from "./flowers.js";
import { GLOW_VARIANT_COUNT, glowVariantAt } from "../world/glowstone.js";
import { getSeed } from "../world/overworld.js";

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();
// Liquid boundary quads: one base plane, orientation baked per instance so
// all faces of a liquid share a single merged mesh per side (no per-face
// lighting, no per-direction draw splits that re-sort by viewpoint).
const liquidGeo = new THREE.PlaneGeometry(1, 1);
// Rotation (rx, ry) plus outward normal per direction; instance position is
// the cell center pushed half a block along the normal so every face lands
// exactly on the cell bound at full-block height (stacked liquid merges).
// Entry order matches LIQUID_OFF neighbour deltas: -y, +y, -x, +x, +z, -z.
const LIQUID_DIRS = [
  [Math.PI / 2, 0],
  [-Math.PI / 2, 0],
  [0, -Math.PI / 2],
  [0, Math.PI / 2],
  [0, 0],
  [0, Math.PI],
];
const LIQUID_OFF = [
  [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1],
];

// A liquid face renders only against a non-opaque, different block, so
// adjacent same-liquid blocks merge into one volume and solid walls (well,
// shore) show their own faces instead of a liquid skin.
function liquidFaceVisible(x, y, z, id, dx, dy, dz) {
  const n = getBlock(x + dx, y + dy, z + dz);
  if (n === id) return false;
  const info = BLOCK_INFO[n];
  if (!info) return true;
  return !info.opaque;
}
// A surface liquid cell with a broken sheet around it (player bump, edge:
// open air above, air sitting on liquid on at least one side) seals its
// underside with a blue BackSide shutter so the bump reads solid from above
// instead of showing the depths through the transparent stack. Air sitting on
// solid (shores) or continuing down (shafts) gets no floor: shores read like
// open sea, shafts read hollow. Unbroken sheet water stays merged. Companion
// of the pocket rule below: floors key on what sits beneath the side air
// (liquid), veils on what hems it laterally. The shutter goes at the foot
// of the exposed run (deepest same-liquid cell below the surface that
// still sees lateral air), so N-high bumps cap exactly the plane 1-high
// ones do instead of floating mid-column.
function hasAirSide(x, y, z) {
  return getBlock(x + 1, y, z) === AIR || getBlock(x - 1, y, z) === AIR ||
    getBlock(x, y, z + 1) === AIR || getBlock(x, y, z - 1) === AIR;
}
// Foot test half of the seal: a lateral air column starting at (x, yy, z)
// footing on liquid. The caller judges open sky on the surface cell and
// walks yy down to the exposed foot first; the air is followed down to its
// own foot, so the test holds at any height. Floored by y > 0.
function sealFootAt(x, yy, z) {
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, , dz] of sides) {
    if (getBlock(x + dx, yy, z + dz) !== AIR) continue;
    let sy = yy;
    while (sy > 0 && getBlock(x + dx, sy, z + dz) === AIR) sy--;
    if (isLiquid(getBlock(x + dx, sy, z + dz))) return true;
  }
  return false;
}
// Pocket air is hemmed-in air: the same liquid on two *opposite* same-level
// sides (east+west or north+south), or on 3+ sides. Two merely adjacent
// sides (an L corner, e.g. the air cells between diagonally placed liquid
// blocks) read as open air and stay plain blue. Shafts and bubbles qualify
// from every ring; bumps, shores, diagonals, and open sky stay plain blue.
function hemmedAir(x, y, z, id) {
  const e = getBlock(x + 1, y, z) === id;
  const w = getBlock(x - 1, y, z) === id;
  const pz = getBlock(x, y, z + 1) === id;
  const nz = getBlock(x, y, z - 1) === id;
  if ((e && w) || (pz && nz)) return true;
  return (e ? 1 : 0) + (w ? 1 : 0) + (pz ? 1 : 0) + (nz ? 1 : 0) >= 3;
}
// Liquid rendering follows three rules with one mechanism each. (1) Water
// reads regular blue from everywhere: every liquid bound carries the full
// blue pair (FrontSide + BackSide), pocket bounds included — the original
// material is never replaced, veils only overlay. (2) Pockets read white
// for divers and light blue through water: a plain white BackSide veil shows
// only while the eye sits inside the same liquid, always over its unchanged
// blue backing, so every ring composites identically (uniform water filter,
// never bare white on bright backdrops); a tinted DoubleSide veil shows only
// while the eye sits in open air. (3) Water reads regular blue from
// inside pockets: both veils hide there, leaving pure blue. Pocket-bound
// sheets write depth (open-sea sheets do not), so the near wall occludes the
// far wall and each pocket shows exactly one face. Veil flips happen only
// when the eye medium changes (`setEyeMedium`, fed per frame), so
// steady-state cost is zero.
// Chunks load within RENDER_DIST but unload three rings later, so fog far
// stays inside the nearest evictable slab and border crossings never
// dispose a visible row before its replacement streams in. The rings clip
// to the finite world, so the extra margin costs no extra chunks.
export const UNLOAD_MARGIN = 3;
// A chunk past the loose ring still renders while its slab sits inside the
// fogged range, so eviction additionally waits until it clears fog far.
const DISPOSE_MARGIN = 10;
// Terrain reference height for 3D chunk distances: chunks are ground slabs,
// so a high camera's distance to one is horizontal offset plus vertical drop
// below the eye. Column tops refine it per chunk; this floors the estimate.
const TERRAIN_REF_Y = 20;
const gatedVeils = new Map(); // "in:"+lid -> Set<diver white>, "out" -> Set<open-air tint>
let eyeMedium = { type: "air", liquid: 0 };
export function setEyeMedium(m) {
  const prevIn = eyeMedium.type === "liquid" ? eyeMedium.liquid : 0;
  const nextIn = m.type === "liquid" ? m.liquid : 0;
  if (prevIn !== nextIn) {
    for (const [key, set] of gatedVeils) {
      if (!key.startsWith("in:")) continue;
      const vis = Number(key.slice(3)) === nextIn;
      for (const mesh of set) mesh.visible = vis;
    }
  }
  if ((eyeMedium.type === "air") !== (m.type === "air")) {
    const set = gatedVeils.get("out");
    if (set) for (const mesh of set) mesh.visible = m.type === "air";
  }
  eyeMedium = m;
}
function registerVeil(key, mesh, visible) {
  mesh.userData.veilKey = key;
  mesh.visible = visible;
  let set = gatedVeils.get(key);
  if (!set) { set = new Set(); gatedVeils.set(key, set); }
  set.add(mesh);
}
function unregisterVeils(meshes) {
  for (const m of meshes.values()) {
    const k = m.userData.veilKey;
    if (k === undefined) continue;
    const set = gatedVeils.get(k);
    if (set) { set.delete(m); if (!set.size) gatedVeils.delete(k); }
  }
}
const chunkMeshes = new Map(); // "cx_cz" -> Map<id, InstancedMesh>
// Moon meshes (rock + lake sheets): toggled visible only above the fade
// band, default-hidden at build so no first frame can flash.
const moonMeshes = new Set();
let moonFade = 0;
const matCache = new Map();
let sceneRef = null;

function getMats(id) {
  if (!matCache.has(id)) matCache.set(id, materialsFor(id));
  return matCache.get(id);
}

// Moon fade (driven by sky.js): the visible rock face crossfades from the
// current sky color to full texture — the body stays solid (opaque, depth
// writing) throughout, so it never turns translucent and stars never show
// through it. Lake sheets keep their opacity ramp off memorized bases:
// faint water over an emerging face reads coherently.
const MOON_WHITE = new THREE.Color(0xffffff);
const MOON_SHEET_ROLES = ["outside", "inner", "pocketblue", "pocketblueback", "pocket-out", "pocket-in"];
export function setMoonFade(m, skyColor) {
  const o = Math.max(0, Math.min(1, m));
  moonFade = o;
  for (const mesh of moonMeshes) mesh.visible = o > 0;
  const moon = matCache.get(MOON);
  if (moon) {
    for (const mt of moon) {
      mt.opacity = 1;
      mt.transparent = false;
      mt.depthWrite = true;
      mt.color.copy(skyColor).lerp(MOON_WHITE, o);
    }
  }
  for (const role of MOON_SHEET_ROLES) {
    for (const top of [false, true]) {
      const lm = liquidSurfaceMat(MOON_WATER, role, top);
      if (lm.userData.baseOpacity === undefined) {
        lm.userData.baseOpacity = lm.opacity;
        lm.userData.baseDepth = lm.depthWrite;
      }
      lm.opacity = lm.userData.baseOpacity * o;
      lm.transparent = lm.opacity < 0.99;
      lm.depthWrite = o >= 0.99 ? lm.userData.baseDepth : false;
    }
  }
}

export function initRenderer(scene) {
  sceneRef = scene;
}

function isExposed(x, y, z) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, dy, dz] of dirs) {
    const n = getBlock(x + dx, y + dy, z + dz);
    if (n === AIR) return true;
    const info = BLOCK_INFO[n];
    if (!info || !info.opaque) return true;
  }
  return false;
}

export function disposeAll() {
  for (const meshes of chunkMeshes.values()) {
    for (const m of meshes.values()) { sceneRef.remove(m); m.dispose(); }
  }
  chunkMeshes.clear();
  gatedVeils.clear();
  moonMeshes.clear();
  chunkQueue.length = 0;
}

function disposeChunk(ck) {
  const meshes = chunkMeshes.get(ck);
  if (!meshes) return;
  for (const m of meshes.values()) { sceneRef.remove(m); m.dispose(); moonMeshes.delete(m); }
  unregisterVeils(meshes);
  chunkMeshes.delete(ck);
}

export function rebuildChunk(cx, cz) {
  const ck = cx + "_" + cz;
  disposeChunk(ck);
  const x0 = Math.max(cx * CHUNK, -WORLD_RADIUS);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const z0 = Math.max(cz * CHUNK, -WORLD_RADIUS);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const perId = new Map();
  const flowers = [];
  const glows = [];
  const liquids = new Map();
  const liquidsTop = new Map();
  const liquidsPocket = new Map();
  const liquidsPocketBlue = new Map();
  const liquidsPocketBlueTop = new Map();
  const liquidsPocketBlueBack = new Map();
  const liquidsSeal = new Map();
  const liquidMaps = [liquids, liquidsTop, liquidsPocket, liquidsPocketBlue, liquidsPocketBlueTop, liquidsPocketBlueBack, liquidsSeal];
  const pushQuad = (map, id, quad) => {
    let arr = map.get(id);
    if (!arr) { arr = []; map.set(id, arr); }
    arr.push(quad);
  };
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      // Sparse column walk: only occupied cells are visited (ascending, as
      // before), so tall builds cost by blocks instead of height.
      const occ = colOcc[dim].get((x + 1024) * 2048 + (z + 1024));
      if (!occ) continue;
      const ys = [...occ].sort((a, b) => a - b);
      for (const y of ys) {
        const id = getBlock(x, y, z);
        if (!BLOCK_INFO[id]) continue;
        if (id === FLOWER) { flowers.push([x, y, z]); continue; }
        if (id === GLOWSTONE) {
          if (isExposed(x, y, z)) glows.push([x, y, z]);
          continue;
        }
        if (isLiquid(id)) {
          for (let d = 0; d < LIQUID_DIRS.length; d++) {
            const [dx, dy, dz] = LIQUID_OFF[d];
            if (!liquidFaceVisible(x, y, z, id, dx, dy, dz)) {
              // Seal floor: same-liquid underside capping a surface column
              // that stands on a broken sheet. One-sided shutter facing up
              // (inner sheet only): bumps read solid from above, while
              // divers below see the uniform surface backs with no
              // doubling rectangles. The shutter goes at the foot of the
              // exposed run (deepest same-liquid cell below the surface
              // that still sees lateral air), so N-high bumps cap exactly
              // the plane 1-high ones do instead of floating mid-column.
              if (dy !== -1) continue;
              if (getBlock(x, y - 1, z) !== id) continue;
              if (getBlock(x, y + 1, z) !== AIR || isEnclosedAir(x, y + 1, z)) continue;
              let sealY = y;
              while (getBlock(x, sealY - 1, z) === id && hasAirSide(x, sealY - 1, z)) sealY--;
              if (!sealFootAt(x, sealY, z)) continue;
              pushQuad(liquidsSeal, id, [x, sealY, z, d]);
              continue;
            }
            // Every bound keeps its blue pair (original material, never
            // replaced): regular bounds feed the FrontSide outside sheet and
            // the coplanar blue BackSide sheet, pocket bounds their
            // depth-writing variants. Top faces split off for the stronger
            // tone. Pocket bounds (hemmed-in shaft air or enclosed bubbles)
            // additionally feed the gated white veils, which overlay without
            // replacing: white for divers, tint for open-air eyes.
            // Pocket-bound sheets write depth so the near wall occludes the
            // far wall and each pocket shows exactly one face; open-sea sheets
            // stay depthless to keep see-through shallows.
            const quad = [x, y, z, d];
            // Pocket bound: opposite-hemmed shaft air (full column top ring
            // included) or enclosed air (bubbles). Open air — sky, bump
            // surroundings, shores, diagonal L corners — stays plain blue.
            // Opposite pairs first; the flood runs only when that falls
            // short and fast-paths sky itself.
            const n = getBlock(x + dx, y + dy, z + dz);
            const pocketed = n === AIR && (hemmedAir(x + dx, y + dy, z + dz, id) ||
              isEnclosedAir(x + dx, y + dy, z + dz));
            if (pocketed) {
              pushQuad(dy === 1 ? liquidsPocketBlueTop : liquidsPocketBlue, id, quad);
              pushQuad(liquidsPocketBlueBack, id, quad);
              pushQuad(liquidsPocket, id, quad);
              continue;
            }
            pushQuad(dy === 1 ? liquidsTop : liquids, id, quad);
          }
          continue;
        }
        if (!isExposed(x, y, z)) continue;
        let arr = perId.get(id);
        if (!arr) { arr = []; perId.set(id, arr); }
        arr.push([x, y, z]);
      }
    }
  }
  if (!perId.size && !flowers.length && !glows.length && !liquidMaps.some((m) => m.size)) return;
  const meshes = new Map();
  for (const [id, list] of perId) {
    const mesh = new THREE.InstancedMesh(boxGeo, getMats(id), list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, y, z] = list[i];
      dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Glass draws after liquids so it composites over water whether the
    // glass sits behind or in front of the surface.
    if (id === GLASS) mesh.renderOrder = 13;
    if (id === MOON) { moonMeshes.add(mesh); mesh.visible = moonFade > 0; }
    sceneRef.add(mesh);
    meshes.set(id, mesh);
  }
  if (flowers.length) {
    const seed = getSeed();
    const perVariant = FLOWER_GEOS.map(() => []);
    for (const [fx, fy, fz] of flowers) perVariant[flowerVariantAt(fx, fz, seed)].push([fx, fy, fz]);
    for (let v = 0; v < FLOWER_GEOS.length; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(FLOWER_GEOS[v], FLOWER_MAT, list.length);
      for (let i = 0; i < list.length; i++) {
        const [fx, fy, fz] = list[i];
        dummy.position.set(fx + 0.5, fy + 0.5, fz + 0.5);
        dummy.rotation.set(0, flowerAngleAt(fx, fz, seed), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      sceneRef.add(mesh);
      meshes.set("flower_" + v, mesh);
    }
  }
  // Glowstone: one unlit InstancedMesh per color variant (unexposed stones
  // are skipped like every other cube). Always visible: the unlit texture
  // shines at full strength from any distance, independent of the moon fade.
  if (glows.length) {
    const perVariant = [];
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) perVariant.push([]);
    for (const [gx, gy, gz] of glows) perVariant[glowVariantAt(gx, gy, gz)].push([gx, gy, gz]);
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(boxGeo, glowstoneMats(v), list.length);
      for (let i = 0; i < list.length; i++) {
        const [gx, gy, gz] = list[i];
        dummy.position.set(gx + 0.5, gy + 0.5, gz + 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      sceneRef.add(mesh);
      meshes.set("glowstone_" + v, mesh);
    }
  }
  // Boundary faces only: every bound emits the blue pair — an outside
  // FrontSide quad (renderOrder 10) plus a coplanar blue BackSide quad
  // (renderOrder 11). Each viewpoint sees exactly one blue sheet per quad
  // (backface culling), so the pair never z-fights; stacked boundaries
  // compose through blending in a fixed, deterministic order instead of
  // re-sorting by viewpoint, so nothing flickers. Pocket bounds (hemmed shaft
  // air, enclosed bubbles) use depth-writing blue variants plus gated white
  // veils (renderOrder 12, after the blue): the near wall depth-occludes the
  // far wall, so each pocket shows exactly one face, always over its unchanged
  // blue backing — every ring composites identically. Seal floors
  // (same-liquid undersides under broken surface sheets) emit only the blue
  // BackSide shutter, so bumps read solid from above while divers see no
  // doubling rectangles. Pocket veils gate on the eye medium: plain white
  // only for divers in the same liquid, tinted veil only for open-air eyes;
  // pocket interiors see pure blue. Glass draws last (renderOrder 13).
  const quadMesh = (mat, quads, order) => {
    const mesh = new THREE.InstancedMesh(liquidGeo, mat, quads.length);
    for (let i = 0; i < quads.length; i++) {
      const [lx, ly, lz, d] = quads[i];
      const [rx, ry] = LIQUID_DIRS[d];
      const [ox, oy, oz] = LIQUID_OFF[d];
      dummy.position.set(lx + 0.5 + ox * 0.5, ly + 0.5 + oy * 0.5, lz + 0.5 + oz * 0.5);
      dummy.rotation.set(rx, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = order;
    sceneRef.add(mesh);
    return mesh;
  };
  for (const { map, role, top, order, suffix, gate } of [
    { map: liquids, role: "outside", top: false, order: 10, suffix: "_out" },
    { map: liquidsTop, role: "outside", top: true, order: 10, suffix: "_top" },
    { map: liquids, role: "inner", top: false, order: 11, suffix: "_bin" },
    { map: liquidsTop, role: "inner", top: true, order: 11, suffix: "_btp" },
    { map: liquidsSeal, role: "inner", top: false, order: 11, suffix: "_seal" },
    { map: liquidsPocketBlue, role: "pocketblue", top: false, order: 10, suffix: "_pb" },
    { map: liquidsPocketBlueTop, role: "pocketblue", top: true, order: 10, suffix: "_pbt" },
    { map: liquidsPocketBlueBack, role: "pocketblueback", top: false, order: 11, suffix: "_pbb" },
    { map: liquidsPocket, role: "pocket-out", top: false, order: 12, suffix: "_pout", gate: "out" },
    { map: liquidsPocket, role: "pocket-in", top: false, order: 12, suffix: "_pin", gate: "in" },
  ]) {
    for (const [lid, list] of map) {
      const mesh = quadMesh(liquidSurfaceMat(lid, role, top), list, order);
      if (gate === "in") registerVeil("in:" + lid, mesh, eyeMedium.type === "liquid" && eyeMedium.liquid === lid);
      else if (gate === "out") registerVeil("out", mesh, eyeMedium.type === "air");
      if (lid === MOON_WATER) { moonMeshes.add(mesh); mesh.visible = moonFade > 0; }
      meshes.set("liquid_" + lid + suffix, mesh);
    }
  }
  chunkMeshes.set(ck, meshes);
}

const chunkQueue = [];

// Highest surface in a chunk's bounds (world-clipped), for 3D distances.
function chunkTopMax(cx, cz) {
  let top = 0;
  const x0 = Math.max(cx * CHUNK, -WORLD_RADIUS);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const z0 = Math.max(cz * CHUNK, -WORLD_RADIUS);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const tops = colTops[dim];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const t = tops[(x + 1024) * 2048 + (z + 1024)];
      if (t > top) top = t;
    }
  return top;
}

// 3D distance from the eye to a chunk's ground slab: horizontal distance to
// the chunk center, plus the drop when the eye flies above its surface.
function chunkDist3(px, eyeY, pz, wx, wz) {
  const dx = wx * CHUNK + CHUNK / 2 - px;
  const dz = wz * CHUNK + CHUNK / 2 - pz;
  const drop = Math.max(0, eyeY - Math.max(chunkTopMax(wx, wz), TERRAIN_REF_Y));
  return Math.sqrt(dx * dx + dz * dz + drop * drop);
}

export function rebuildAll(px, pz, syncRadius = 3) {
  disposeAll();
  streamChunks(px, pz);
  // Build the neighborhood synchronously so the spawn area is solid on the
  // first frame; the rest streams in over following frames.
  const cx = chunkOf(px), cz = chunkOf(pz);
  const near = [];
  const far = [];
  for (const ck of chunkQueue) {
    const [wx, wz] = ck.split("_").map(Number);
    ((Math.abs(wx - cx) <= syncRadius && Math.abs(wz - cz) <= syncRadius) ? near : far).push(ck);
  }
  chunkQueue.length = 0;
  chunkQueue.push(...far);
  for (const ck of near) {
    const [wx, wz] = ck.split("_").map(Number);
    rebuildChunk(wx, wz);
  }
  lastStream.cx = cx;
  lastStream.cz = cz;
}

export function streamChunks(px, pz, eyeY = TERRAIN_REF_Y, fogFar = Infinity) {
  const cx = chunkOf(px), cz = chunkOf(pz);
  const keep = new Set();
  const keepLoose = new Set();
  for (let dx = -RENDER_DIST - UNLOAD_MARGIN; dx <= RENDER_DIST + UNLOAD_MARGIN; dx++)
    for (let dz = -RENDER_DIST - UNLOAD_MARGIN; dz <= RENDER_DIST + UNLOAD_MARGIN; dz++) {
      const wx = cx + dx, wz = cz + dz;
      if (wx * CHUNK > WORLD_RADIUS || wx * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      if (wz * CHUNK > WORLD_RADIUS || wz * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      const ck = wx + "_" + wz;
      keepLoose.add(ck);
      if (Math.abs(dx) <= RENDER_DIST && Math.abs(dz) <= RENDER_DIST) keep.add(ck);
    }
  // Dispose only outside the loose ring, and only once the slab also clears
  // the fogged range: border crossings never flicker a row while its
  // replacement streams in, and high flight never exposes an eviction.
  for (const ck of [...chunkMeshes.keys()]) {
    if (keepLoose.has(ck)) continue;
    const [wx, wz] = ck.split("_").map(Number);
    if (chunkDist3(px, eyeY, pz, wx, wz) <= fogFar + DISPOSE_MARGIN) continue;
    disposeChunk(ck);
  }
  for (let i = chunkQueue.length - 1; i >= 0; i--) {
    if (!keep.has(chunkQueue[i]) || chunkMeshes.has(chunkQueue[i])) chunkQueue.splice(i, 1);
  }
  const queued = new Set(chunkQueue);
  const missing = [];
  for (const ck of keep) {
    if (chunkMeshes.has(ck) || queued.has(ck)) continue;
    const [wx, wz] = ck.split("_").map(Number);
    missing.push([ck, chunkDist3(px, eyeY, pz, wx, wz)]);
  }
  missing.sort((a, b) => a[1] - b[1]);
  for (const [ck] of missing) chunkQueue.push(ck);
  lastStream.cx = cx;
  lastStream.cz = cz;
}

const lastStream = { cx: Infinity, cz: Infinity };

export function maybeStream(px, pz, eyeY = TERRAIN_REF_Y, fogNear = 0, fogFar = Infinity) {
  const cx = chunkOf(px), cz = chunkOf(pz);
  if (lastStream.cx !== cx || lastStream.cz !== cz) {
    lastStream.cx = cx;
    lastStream.cz = cz;
    streamChunks(px, pz, eyeY, fogFar);
  }
  if (chunkQueue.length) drainChunkQueue(false);
  // Clear-bubble guard: anything still queued inside the clear bubble would
  // pop in plain sight, so it builds synchronously no matter the budget.
  // Nearest first, so the closest hole always fills even if more remain.
  if (fogNear > 0) {
    for (;;) {
      let best = -1, bestD = fogNear;
      for (let i = 0; i < chunkQueue.length; i++) {
        const [wx, wz] = chunkQueue[i].split("_").map(Number);
        const d = chunkDist3(px, eyeY, pz, wx, wz);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) break;
      const [ck] = chunkQueue.splice(best, 1);
      if (chunkMeshes.has(ck)) continue;
      const [wx, wz] = ck.split("_").map(Number);
      rebuildChunk(wx, wz);
    }
  }
}

const CHUNK_BUDGET_MS = 6;

export function drainChunkQueue(all) {
  if (!chunkQueue.length) return;
  const deadline = all ? Infinity : performance.now() + CHUNK_BUDGET_MS;
  while (chunkQueue.length && (all || performance.now() < deadline)) {
    const ck = chunkQueue.shift();
    if (chunkMeshes.has(ck)) continue;
    const [wx, wz] = ck.split("_").map(Number);
    rebuildChunk(wx, wz);
  }
}

export function hasPendingChunks() {
  return chunkQueue.length > 0;
}

export function pendingCount() {
  return chunkQueue.length;
}

function columnKeys(x, z) {
  const cx = chunkOf(x), cz = chunkOf(z);
  const out = [cx + "_" + cz];
  const rx = ((x % CHUNK) + CHUNK) % CHUNK;
  const rz = ((z % CHUNK) + CHUNK) % CHUNK;
  if (rx === 0) out.push(cx - 1 + "_" + cz);
  if (rx === CHUNK - 1) out.push(cx + 1 + "_" + cz);
  if (rz === 0) out.push(cx + "_" + (cz - 1));
  if (rz === CHUNK - 1) out.push(cx + "_" + (cz + 1));
  return out;
}

export function refreshBlocks(coords) {
  const keys = new Set();
  for (const [x, , z] of coords) {
    for (const ck of columnKeys(x, z)) keys.add(ck);
  }
  for (const ck of keys) {
    if (!chunkMeshes.has(ck) && !chunkQueue.includes(ck)) continue;
    if (chunkMeshes.has(ck)) {
      const [cx, cz] = ck.split("_").map(Number);
      rebuildChunk(cx, cz);
    }
  }
}

export function chunkCount() {
  return chunkMeshes.size;
}
