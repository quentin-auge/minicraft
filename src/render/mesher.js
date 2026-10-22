// Chunked streaming renderer: one InstancedMesh per block id per chunk,
// only for exposed blocks. Rebuilds stay local via refreshBlocks().
import * as THREE from "three";
import { AIR, BLOCK_INFO, FLOWER, GLASS, GLOWSTONE, isLiquid } from "../core/blocks.js";
import { WORLD_RADIUS, CHUNK, renderDist, getBlock, topAt, colTopIdx, colOcc, dim, dimInfinite, chunkOf, isEnclosedAir, ensureChunkSource } from "../core/store.js";
import { materialsFor, liquidSurfaceMat, glowstoneMats } from "../core/textures.js";
import { FLOWER_GEOS, FLOWER_MAT } from "./flowers.js";
import { haloRadius, bakeHaloTint } from "./halobake.js";
import { flowerVariantAt, flowerAngleAt } from "../world/flowers.js";
import { GLOW_VARIANT_COUNT, glowVariantAt } from "../world/glowstone.js";
import { MOON_SURFACE_Y } from "../world/moon.js";
import { regionOf, regionByKey } from "./regions.js";

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
// Chunks load within the dimension's render distance (RENDER_DIST overworld,
// TNT_RENDER_DIST in the infinite sky) but unload three rings later, so fog far
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
      for (const mesh of set) { mesh.userData.veilVisible = vis; refreshVisible(mesh); }
    }
  }
  if ((eyeMedium.type === "air") !== (m.type === "air")) {
    const set = gatedVeils.get("out");
    if (set) for (const mesh of set) { mesh.userData.veilVisible = m.type === "air"; refreshVisible(mesh); }
  }
  eyeMedium = m;
}
function registerVeil(key, mesh, visible) {
  mesh.userData.veilKey = key;
  mesh.userData.veilVisible = visible;
  refreshVisible(mesh);
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
// Rest groups for fog culling: ck -> { group, x0, x1, z0, z1, top }, where
// top is the highest non-region cell of the chunk. Region meshes stay
// scene-level under their own fade gate.
const chunkRest = new Map();
let cullVersion = 0; // bumped on every rebuild/dispose; the cull caches on it
// Reveal regions: per-region mesh groups + their current fade factor, plus
// material clones the region owns (it fades their opacity; an onFade hook can
// do bespoke work). Region meshes default hidden at build so no first frame
// can flash before the first fade.
const regionMeshes = new Map(); // region.key -> Set<InstancedMesh>
const regionFade = new Map(); // region.key -> 0..1
const regionMatCache = new Map(); // region.key -> Map<handle, material | material[]>
const matCache = new Map();
let sceneRef = null;

function getMats(id) {
  if (!matCache.has(id)) matCache.set(id, materialsFor(id));
  return matCache.get(id);
}

// A mesh's visibility is the AND of the two gates that can touch it: its
// region's fade (undefined = no region) and a liquid veil's eye-medium gate
// (undefined = not a veil). Combining them keeps a pocket sheet from flashing
// when the eye medium flips while its region is hidden.
function refreshVisible(mesh) {
  const rv = mesh.userData.regionVisible;
  const vv = mesh.userData.veilVisible;
  mesh.visible = (rv === undefined || rv) && (vv === undefined || vv);
}

function registerRegionMesh(region, mesh) {
  mesh.userData.regionKey = region.key;
  mesh.userData.regionVisible = (regionFade.get(region.key) ?? 0) > 0;
  let set = regionMeshes.get(region.key);
  if (!set) { set = new Set(); regionMeshes.set(region.key, set); }
  set.add(mesh);
  refreshVisible(mesh);
}

// Region-owned material clones, one set per (region, handle). Cloning lets a
// region fade its own materials without touching the shared ones still in use
// by the overworld (a moon glowstone must not fade a ground glowstone).
function regionMaterials(region, handle, factory) {
  if (!region.revealMaterials) return factory();
  let owned = regionMatCache.get(region.key);
  if (!owned) { owned = new Map(); regionMatCache.set(region.key, owned); }
  let mats = owned.get(handle);
  if (!mats) {
    const clone = (m) => {
      const c = m.clone();
      c.userData.baseOpacity = m.opacity;
      c.userData.baseDepth = m.depthWrite;
      c.userData.baseTransparent = m.transparent;
      return c;
    };
    const src = factory();
    mats = Array.isArray(src) ? src.map(clone) : clone(src);
    owned.set(handle, mats);
    // A handle first created after the region settled stays consistent with
    // the current factor instead of flashing at full opacity; the steady-state
    // early-out in setRegionFade skips re-fading, so creation applies it once.
    const o = regionFade.get(region.key) ?? 0;
    if (Array.isArray(mats)) for (const m of mats) applyMatFade(m, o);
    else applyMatFade(mats, o);
  }
  return mats;
}

function applyMatFade(m, o) {
  m.opacity = m.userData.baseOpacity * o;
  m.transparent = o < 0.99 ? true : m.userData.baseTransparent;
  m.depthWrite = o >= 0.99 ? m.userData.baseDepth : false;
}

function ctxFor(region) {
  return {
    mats: (id) => regionMaterials(region, "b:" + id, () => getMats(id)),
    glowMats: (v) => regionMaterials(region, "g:" + v, () => glowstoneMats(v)),
    liquidMat: (id, role, top) =>
      regionMaterials(region, "l:" + id + ":" + role + ":" + top, () => liquidSurfaceMat(id, role, top)),
  };
}

// setRegionFade(key, o, skyColor): toggle the region's mesh group, fade every
// owned material's opacity toward o (so anything in the region — rock, placed
// blocks, glowstone, liquids — reveals smoothly, no micro-pop), then let the
// region's onFade override specifics (the Moon rock tints sky→texture).
export function setRegionFade(key, o, skyColor) {
  o = Math.max(0, Math.min(1, o));
  const prev = regionFade.get(key);
  regionFade.set(key, o);
  const region = regionByKey(key);
  // Steady state (the common case on the Moon: o pinned at 0 or 1): skip the
  // mesh loop and the generic material fade. The bespoke onFade still runs so
  // sky-tinted materials track the background; late-created handles fade at
  // creation (regionMaterials), so skipping never leaves one stale.
  if (prev === o) {
    if (region && region.onFade) region.onFade(o, skyColor, ctxFor(region));
    return;
  }
  const set = regionMeshes.get(key);
  if (set) for (const mesh of set) { mesh.userData.regionVisible = o > 0; refreshVisible(mesh); }
  const owned = regionMatCache.get(key);
  if (owned) {
    for (const mats of owned.values()) {
      if (Array.isArray(mats)) for (const m of mats) applyMatFade(m, o);
      else applyMatFade(mats, o);
    }
  }
  if (region && region.onFade) region.onFade(o, skyColor, ctxFor(region));
}

// Split an instance/quad list by region membership: `rest` stays with the
// shared, always-visible materials; each group becomes a region mesh. Also
// tracks the rest interval (lowest..highest rest cell), which bounds the
// chunk's rest-group cull box (the walk skips the per-cell test, so this
// single pass is the only one). The bottom matters as much as the top:
// infinite dimensions hold geometry at any y, so a floor-based box would
// cull everything around a below-zero eye.
function partitionRegion(id, list) {
  const groups = new Map();
  const rest = [];
  let restTop = -1, restBottom = Infinity;
  for (const c of list) {
    const r = regionOf(id, c[0], c[1], c[2]);
    if (!r) {
      rest.push(c);
      if (c[1] > restTop) restTop = c[1];
      if (c[1] < restBottom) restBottom = c[1];
      continue;
    }
    let g = groups.get(r.key);
    if (!g) { g = { region: r, list: [] }; groups.set(r.key, g); }
    g.list.push(c);
  }
  if (restBottom === Infinity) restBottom = restTop + 1; // empty rest: old behavior
  return { rest, groups, restTop, restBottom };
}

export function initRenderer(scene) {
  sceneRef = scene;
}

// Hoisted neighbor offsets: isExposed runs per occupied cell, so sharing one
// table avoids allocating neighbor arrays on every call.
// Y faces first: surface cells (the majority of meshed blocks) expose upward
// and return on the first test; interior cells pay all six either way.
const EXPOSE_DIRS = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

// Static bounds for chunk meshes: every instance sits inside its chunk
// column, so one conservative sphere replaces per-mesh computation at build
// time. Three culls against it directly; staying conservative keeps culling
// exact (never hides visible geometry). The sphere spans the true instance
// interval [bottom, top + 1] — a floor-based sphere culled everything below
// zero in unbounded dimensions, hiding the whole sky when looking down.
function stampStatic(mesh, x0, x1, z0, z1, top, bottom) {
  const bot = bottom === Infinity ? 0 : bottom;
  const cx = (x0 + x1 + 1) / 2, cy = (top + 1 + bot) / 2, cz = (z0 + z1 + 1) / 2;
  const r = 0.5 * Math.sqrt((x1 - x0 + 1) ** 2 + (top + 1 - bot) ** 2 + (z1 - z0 + 1) ** 2) + 0.01;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
  mesh.matrixAutoUpdate = false;
}

function isExposed(x, y, z) {
  for (let i = 0; i < EXPOSE_DIRS.length; i++) {
    const d = EXPOSE_DIRS[i];
    const n = getBlock(x + d[0], y + d[1], z + d[2]);
    if (n === AIR) return true;
    const info = BLOCK_INFO[n];
    if (!info || !info.opaque) return true;
  }
  return false;
}

export function disposeAll() {
  beginDispose();
  while (disposeSome(Infinity)) { /* drain inline: same end state, one block */ }
}

// Sliced teardown for transitions: a full ring disposed at once reads as its
// own freeze, so the traveler snapshots once and disposes ~80 chunks per
// frame behind the overlay. The build queue clears only with the last slice:
// streamChunks prunes on chunkMeshes.has, so keys for half-torn chunks must
// never drain in between. disposeAll() above keeps its all-at-once behavior
// for existing callers; end state is identical either way.
let disposeKeys = null;
export function beginDispose() {
  disposeKeys = [...new Set([...chunkMeshes.keys(), ...chunkRest.keys()])];
  // Fast non-mesh state clears up front: nothing reads mid-teardown (sim
  // frozen, streaming gated), and every cache below repopulates on build.
  cullVersion++;
  gatedVeils.clear();
  topMaxCache.clear();
  regionMeshes.clear();
  for (const owned of regionMatCache.values()) {
    for (const mats of owned.values()) {
      if (Array.isArray(mats)) for (const m of mats) m.dispose();
      else mats.dispose();
    }
  }
  regionMatCache.clear();
  for (const f of fading) for (const c of f.clones) c.m.dispose();
  fading.length = 0;
}
// Disposes up to `count` snapshotted chunks; returns true while work remains.
export function disposeSome(count) {
  if (!disposeKeys) return false;
  let n = 0;
  while (disposeKeys.length && n < count) {
    const ck = disposeKeys.pop();
    n++;
    const meshes = chunkMeshes.get(ck);
    if (meshes) {
      for (const m of meshes.values()) { sceneRef.remove(m); m.dispose(); }
      chunkMeshes.delete(ck);
    }
    const rest = chunkRest.get(ck);
    if (rest) { sceneRef.remove(rest.group); chunkRest.delete(ck); }
  }
  if (!disposeKeys.length) {
    disposeKeys = null;
    chunkQueue.length = 0;
    return false;
  }
  return true;
}

function disposeChunk(ck) {
  topMaxCache.delete(ck);
  // A chunk rebuilt or evicted mid-fade drops its fade entries: the clones
  // die with the meshes, steady state never holds one.
  for (let i = fading.length - 1; i >= 0; i--) {
    if (fading[i].ck !== ck) continue;
    for (const c of fading[i].clones) c.m.dispose();
    fading.splice(i, 1);
  }
  // Dropping the rest group removes its whole subtree at once; per-mesh
  // dispose below still frees the instance buffers.
  const rest = chunkRest.get(ck);
  if (rest) { sceneRef.remove(rest.group); chunkRest.delete(ck); }
  cullVersion++;
  const meshes = chunkMeshes.get(ck);
  if (!meshes) return;
  for (const m of meshes.values()) {
    // Region meshes are scene-level; rest meshes leave with their group.
    if (m.userData.regionKey) sceneRef.remove(m);
    m.dispose();
    const rk = m.userData.regionKey;
    if (rk) { const set = regionMeshes.get(rk); if (set) { set.delete(m); if (!set.size) regionMeshes.delete(rk); } }
  }
  unregisterVeils(meshes);
  chunkMeshes.delete(ck);
}

export function rebuildChunk(cx, cz, fade = false) {
  const ck = cx + "_" + cz;
  ensureChunkSource(cx, cz);
  topMaxCache.delete(ck);
  disposeChunk(ck);
  const B = clipBound();
  const x0 = Math.max(cx * CHUNK, -B);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, B);
  const z0 = Math.max(cz * CHUNK, -B);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, B);
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
  // Column tops for this build: chunkTop/chunkBottom bound every mesh
  // sphere; restTop (highest rest cell, folded up from each partition
  // below) drives the fog-cull box of the rest group.
  let chunkTop = -1, chunkBottom = Infinity;
  let restTop = -1, restBottom = Infinity;
  // Pocket-test memo per build: neighboring liquid faces re-query the same
  // air cells (lake rims, shaft rims), and each miss used to pay a full
  // bounded flood. Keys pack the column index and y (full key range).
  const enclosedMemo = new Map();
  const hemmedMemo = new Map();
  const memoKey = (x, y, z) => colTopIdx(x, z) * 262144 + (y + 131072);
  const memoEnclosed = (x, y, z) => {
    const k = memoKey(x, y, z);
    let v = enclosedMemo.get(k);
    // Below-cap queries use the bare-tops escape (moon rock excluded): lake
    // bottoms and ground air exit in column height instead of exhausting the
    // budget in the hollow under-cap volume; at- and above-cap queries keep
    // the exact old behavior.
    if (v === undefined) { v = isEnclosedAir(x, y, z, y < MOON_SURFACE_Y); enclosedMemo.set(k, v); }
    return v;
  };
  const memoHemmed = (x, y, z, id) => {
    const k = memoKey(x, y, z) * 32 + id;
    let v = hemmedMemo.get(k);
    if (v === undefined) { v = hemmedAir(x, y, z, id); hemmedMemo.set(k, v); }
    return v;
  };
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      // Sparse column walk: only occupied cells are visited (ascending, as
      // before), so tall builds cost by blocks instead of height.
      const occ = colOcc[dim].get(colTopIdx(x, z));
      if (!occ) continue;
      // Unsorted walk: instance order inside a mesh has no visual effect, so
      // the per-column sort was pure rebuild cost (tall Moon columns worst).
      for (const y of occ) {
        const id = getBlock(x, y, z);
        if (!BLOCK_INFO[id]) continue;
        if (y > chunkTop) chunkTop = y;
        if (y < chunkBottom) chunkBottom = y;
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
              if (getBlock(x, y + 1, z) !== AIR || memoEnclosed(x, y + 1, z)) continue;
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
            const pocketed = n === AIR && (memoHemmed(x + dx, y + dy, z + dz, id) ||
              memoEnclosed(x + dx, y + dy, z + dz));
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
  if (!perId.size && !flowers.length && !glows.length && !liquidMaps.some((m) => m.size)) {
    // Keep empty chunks registered as built so deferred edits can remesh them.
    chunkMeshes.set(ck, new Map());
    return;
  }
  const meshes = new Map();
  // Non-region meshes share one static group per chunk so the whole ground
  // content culls as a unit when it sits past the fog (the Moon case).
  // Region meshes stay scene-level under their own fade gate.
  const restGroup = new THREE.Group();
  restGroup.matrixAutoUpdate = false;
  // Baked halo scratch: one color, reused for every tinted instance (chunk
  // builds are budgeted, so no per-instance allocation here).
  const tintScratch = new THREE.Color();
  const buildBoxes = (list, mats, tintMap) => {
    const mesh = new THREE.InstancedMesh(boxGeo, mats, list.length);
    // Translation-only instances: write the column-major matrix directly
    // instead of composing through the shared dummy Object3D.
    const a = mesh.instanceMatrix.array;
    for (let i = 0; i < list.length; i++) {
      const o = i * 16;
      a[o] = 1; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 1; a[o + 11] = 0;
      a[o + 12] = list[i][0] + 0.5; a[o + 13] = list[i][1] + 0.5; a[o + 14] = list[i][2] + 0.5; a[o + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    // Baked halo: untinted instances read white (no-op multiply), so the
    // color buffer only exists on meshes a source actually reaches. Shared
    // materials stay shared — three keys programs per object state, not per
    // material, so tinted and untinted chunks coexist on one material.
    if (tintMap && tintMap.size) {
      for (let i = 0; i < list.length; i++) {
        const t = tintMap.get(list[i][0] + "," + list[i][1] + "," + list[i][2]);
        if (t) mesh.setColorAt(i, tintScratch.setRGB(t[0], t[1], t[2]));
        else mesh.setColorAt(i, tintScratch.setRGB(1, 1, 1));
      }
      mesh.instanceColor.needsUpdate = true;
    }
    stampStatic(mesh, x0, x1, z0, z1, chunkTop, chunkBottom);
    return mesh;
  };
  // One halo map per chunk build: sources are read R past the chunk in every
  // axis, so border cells pick up their neighbor chunk's sources too. Skipped
  // when the chunk holds no tintable blocks (glowstone-only chunks).
  const tintMap = perId.size ? bakeHaloTint(dim, x0, x1, z0, z1, chunkBottom, chunkTop) : null;
  for (const [id, list] of perId) {
    const { rest, groups, restTop: rt, restBottom: rb } = partitionRegion(id, list);
    if (rt > restTop) restTop = rt;
    if (rb < restBottom) restBottom = rb;
    if (rest.length) {
      const mesh = buildBoxes(rest, getMats(id), tintMap);
      // Glass draws after liquids so it composites over water whether the
      // glass sits behind or in front of the surface.
      if (id === GLASS) mesh.renderOrder = 13;
      restGroup.add(mesh);
      meshes.set(id, mesh);
    }
    for (const g of groups.values()) {
      const mesh = buildBoxes(g.list, regionMaterials(g.region, "b:" + id, () => getMats(id)), tintMap);
      if (id === GLASS) mesh.renderOrder = 13;
      registerRegionMesh(g.region, mesh);
      sceneRef.add(mesh);
      meshes.set(g.region.key + ":" + id, mesh);
    }
  }
  if (flowers.length) {
    const perVariant = FLOWER_GEOS.map(() => []);
    for (const [fx, fy, fz] of flowers) perVariant[flowerVariantAt(fx, fy, fz)].push([fx, fy, fz]);
    const buildFlowers = (list, geo, mats) => {
      const mesh = new THREE.InstancedMesh(geo, mats, list.length);
      for (let i = 0; i < list.length; i++) {
        const [fx, fy, fz] = list[i];
        dummy.position.set(fx + 0.5, fy + 0.5, fz + 0.5);
        dummy.rotation.set(0, flowerAngleAt(fx, fy, fz), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      stampStatic(mesh, x0, x1, z0, z1, chunkTop, chunkBottom);
      return mesh;
    };
    for (let v = 0; v < FLOWER_GEOS.length; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const { rest, groups, restTop: rt, restBottom: rb } = partitionRegion(FLOWER, list);
      if (rt > restTop) restTop = rt;
    if (rb < restBottom) restBottom = rb;
      if (rest.length) {
        const mesh = buildFlowers(rest, FLOWER_GEOS[v], FLOWER_MAT);
        restGroup.add(mesh);
        meshes.set("flower_" + v, mesh);
      }
      for (const g of groups.values()) {
        const mesh = buildFlowers(g.list, FLOWER_GEOS[v], regionMaterials(g.region, "flower", () => FLOWER_MAT));
        registerRegionMesh(g.region, mesh);
        sceneRef.add(mesh);
        meshes.set("flower_" + g.region.key + "_" + v, mesh);
      }
    }
  }
  // Glowstone: one unlit InstancedMesh per color variant (unexposed stones
  // are skipped like every other cube). Overworld stones stay always visible
  // (the unlit texture shines at full strength from any distance); stones
  // inside a reveal region fade with it.
  if (glows.length) {
    const perVariant = [];
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) perVariant.push([]);
    for (const [gx, gy, gz] of glows) perVariant[glowVariantAt(gx, gy, gz)].push([gx, gy, gz]);
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const { rest, groups, restTop: rt, restBottom: rb } = partitionRegion(GLOWSTONE, list);
      if (rt > restTop) restTop = rt;
    if (rb < restBottom) restBottom = rb;
      if (rest.length) {
        const mesh = buildBoxes(rest, glowstoneMats(v));
        restGroup.add(mesh);
        meshes.set("glowstone_" + v, mesh);
      }
      for (const g of groups.values()) {
        const mesh = buildBoxes(g.list, regionMaterials(g.region, "g:" + v, () => glowstoneMats(v)));
        registerRegionMesh(g.region, mesh);
        sceneRef.add(mesh);
        meshes.set("glowstone_" + g.region.key + "_" + v, mesh);
      }
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
    stampStatic(mesh, x0, x1, z0, z1, chunkTop, chunkBottom);
    mesh.renderOrder = order;
    return mesh;
  };
  const gateVeil = (gate, lid, mesh) => {
    if (gate === "in") registerVeil("in:" + lid, mesh, eyeMedium.type === "liquid" && eyeMedium.liquid === lid);
    else if (gate === "out") registerVeil("out", mesh, eyeMedium.type === "air");
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
      const { rest, groups, restTop: rt, restBottom: rb } = partitionRegion(lid, list);
      if (rt > restTop) restTop = rt;
    if (rb < restBottom) restBottom = rb;
      if (rest.length) {
        const mesh = quadMesh(liquidSurfaceMat(lid, role, top), rest, order);
        gateVeil(gate, lid, mesh);
        restGroup.add(mesh);
        meshes.set("liquid_" + lid + suffix, mesh);
      }
      for (const g of groups.values()) {
        const mesh = quadMesh(
          regionMaterials(g.region, "l:" + lid + ":" + role + ":" + top, () => liquidSurfaceMat(lid, role, top)),
          g.list, order);
        gateVeil(gate, lid, mesh);
        registerRegionMesh(g.region, mesh);
        sceneRef.add(mesh);
        meshes.set("liquid_" + g.region.key + "_" + lid + suffix, mesh);
      }
    }
  }
  if (restGroup.children.length) {
    sceneRef.add(restGroup);
    chunkRest.set(ck, { group: restGroup, x0, x1, z0, z1, top: restTop, bottom: restBottom });
    // Streaming builds fade in (see tickChunkFades); edit/band remeshes
    // pass fade=false and stay instant.
    if (fade) fadeChunkIn(ck, cx, cz, restGroup);
  }
  cullVersion++;
  chunkMeshes.set(ck, meshes);
}

// Transient per-chunk fade-in: chunks that materialize inside the visible
// range (clear-bubble sync builds, budget builds landing short of fogFar)
// would otherwise pop at full opacity. Fresh rest meshes get cloned
// materials at opacity 0, ramped to their base over FADE_T, then the shared
// materials are restored and the clones disposed — steady state keeps zero
// clones, and only a few chunks ever fade at once. Region meshes are
// excluded (their reveal owns opacity); gated veils fade like any rest
// mesh (only `visible` gates on the eye medium, never opacity).
const FADE_T = 0.35;
const fading = []; // { ck, cx, cz, mesh, shared, clones:[{m, base}], t }
function fadeChunkIn(ck, cx, cz, group) {
  for (const mesh of group.children) {
    const shared = mesh.material;
    const clones = [];
    const wrap = (m) => {
      const c = m.clone();
      clones.push({ m: c, base: m.opacity });
      c.transparent = true;
      c.opacity = 0;
      return c;
    };
    mesh.material = Array.isArray(shared) ? shared.map(wrap) : wrap(shared);
    fading.push({ ck, cx, cz, mesh, shared, clones, t: 0 });
  }
}
function finishFade(i) {
  const f = fading[i];
  f.mesh.material = f.shared;
  for (const c of f.clones) c.m.dispose();
  fading.splice(i, 1);
}
// Loader-exempt wall clock (see Pause contract): runs in every loop branch
// next to maybeStream, paused or not.
export function tickChunkFades(dt, px, eyeY, pz, fogFar) {
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i];
    // Beyond the fogged range the fade is invisible: snap it shut at once.
    if (chunkDist3(px, eyeY, pz, f.cx, f.cz) > fogFar) { finishFade(i); continue; }
    f.t += dt / FADE_T;
    const t = Math.min(1, f.t);
    const e = t * t * (3 - 2 * t);
    for (const c of f.clones) c.m.opacity = c.base * e;
    if (t >= 1) finishFade(i);
  }
}

const chunkQueue = [];

// World clip per dimension: bounded dims clamp to the cube, infinite dims
// roam free (dimInfinite reads the active dimension, never a fork).
function clipBound() {
  return dimInfinite() ? Infinity : WORLD_RADIUS;
}

// Highest surface per chunk bounds, cached: chunkDist3 queries it once per
// candidate chunk per stream pass, and the Moon tops never change between
// edits. Entries drop on rebuild/dispose so edits never read stale heights.
const topMaxCache = new Map(); // "cx_cz" -> top y
// Highest surface in a chunk's bounds (world-clipped), for 3D distances.
function chunkTopMax(cx, cz) {
  const ck = cx + "_" + cz;
  const hit = topMaxCache.get(ck);
  if (hit !== undefined) return hit;
  let top = 0;
  const B = clipBound();
  const x0 = Math.max(cx * CHUNK, -B);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, B);
  const z0 = Math.max(cz * CHUNK, -B);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, B);
  const topsName = dim;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const t = topAt(topsName, x, z);
      if (t > top) top = t;
    }
  topMaxCache.set(ck, top);
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

function parseChunkKey(ck) {
  const sep = ck.lastIndexOf("_");
  return [+ck.slice(0, sep), +ck.slice(sep + 1)];
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
    const [wx, wz] = parseChunkKey(ck);
    ((Math.abs(wx - cx) <= syncRadius && Math.abs(wz - cz) <= syncRadius) ? near : far).push(ck);
  }
  chunkQueue.length = 0;
  chunkQueue.push(...far);
  for (const ck of near) {
    const [wx, wz] = parseChunkKey(ck);
    // No fade here: the spawn disc must stand complete on the first frame
    // (a cut, not a parade) — streaming fades only apply past it.
    rebuildChunk(wx, wz);
  }
  lastStream.cx = cx;
  lastStream.cz = cz;
}

export function streamChunks(px, pz, eyeY = TERRAIN_REF_Y, fogFar = Infinity) {
  const cx = chunkOf(px), cz = chunkOf(pz);
  const RD = renderDist();
  const keep = new Set();
  const keepLoose = new Set();
  for (let dx = -RD - UNLOAD_MARGIN; dx <= RD + UNLOAD_MARGIN; dx++)
    for (let dz = -RD - UNLOAD_MARGIN; dz <= RD + UNLOAD_MARGIN; dz++) {
      const wx = cx + dx, wz = cz + dz;
      if (!dimInfinite()) {
        if (wx * CHUNK > WORLD_RADIUS || wx * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
        if (wz * CHUNK > WORLD_RADIUS || wz * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      }
      const ck = wx + "_" + wz;
      keepLoose.add(ck);
      if (Math.abs(dx) <= RD && Math.abs(dz) <= RD) keep.add(ck);
    }
  // Dispose only outside the loose ring, and only once the slab also clears
  // the fogged range: border crossings never flicker a row while its
  // replacement streams in, and high flight never exposes an eviction.
  for (const ck of [...chunkMeshes.keys()]) {
    if (keepLoose.has(ck)) continue;
    const [wx, wz] = parseChunkKey(ck);
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
    const [wx, wz] = parseChunkKey(ck);
    missing.push([ck, chunkDist3(px, eyeY, pz, wx, wz)]);
  }
  missing.sort((a, b) => a[1] - b[1]);
  for (const [ck] of missing) chunkQueue.push(ck);
  lastStream.cx = cx;
  lastStream.cz = cz;
}

const lastStream = { cx: Infinity, cz: Infinity };

// Rest-group fog culling: a group whose whole box sits past fog far renders
// pure fog color (the background), so hiding it is invisible. On the Moon
// this skips the entire ground content sharing the same chunk columns; in
// transit it skips both ends. Conservative by construction: the box bounds
// every rest fragment, so a visible group always contains something closer.
// Region meshes keep their own fade gate and stay scene-level.
const CULL_MARGIN = 2;
let lastCull = { v: -1, px: Infinity, eyeY: Infinity, pz: Infinity, far: Infinity };
export function updateChunkCulling(px, eyeY, pz, fogFar) {
  const L = lastCull;
  if (L.v === cullVersion && L.px === px && L.eyeY === eyeY && L.pz === pz && L.far === fogFar) return;
  lastCull = { v: cullVersion, px, eyeY, pz, far: fogFar };
  const lim = fogFar + CULL_MARGIN, lim2 = lim * lim;
  for (const r of chunkRest.values()) {
    const dx = px < r.x0 ? r.x0 - px : px > r.x1 + 1 ? px - (r.x1 + 1) : 0;
    const dz = pz < r.z0 ? r.z0 - pz : pz > r.z1 + 1 ? pz - (r.z1 + 1) : 0;
    // Interval distance: geometry fills [bottom, top], so a surrounded eye
    // counts as near. The old floor-based form culled everything around a
    // below-zero eye in unbounded dimensions.
    const dy = eyeY > r.top + 1 ? eyeY - (r.top + 1) : eyeY < r.bottom ? r.bottom - eyeY : 0;
    r.group.visible = dx * dx + dy * dy + dz * dz <= lim2;
  }
}

export function maybeStream(px, pz, eyeY = TERRAIN_REF_Y, fogNear = 0, fogFar = Infinity) {
  const cx = chunkOf(px), cz = chunkOf(pz);
  if (lastStream.cx !== cx || lastStream.cz !== cz) {
    lastStream.cx = cx;
    lastStream.cz = cz;
    streamChunks(px, pz, eyeY, fogFar);
  }
  // Deficit-driven drain: missing geometry inside the visible range borrows
  // frame time (falling faster than the base budget builds); anything
  // farther out waits its turn, and the fog guard still caps visibility on
  // whatever remains missing. Streaming remesh requests drain first under
  // their own sub-budget (steady frames keep the old 6 ms total).
  const behind = (chunkQueue.length + pendingRefresh.size) > 0 &&
    nearestMissingDist(px, eyeY, pz) <= fogFar;
  // Single-point tuning: behind splits the 16 ms total, steady the 6 ms.
  if (pendingRefresh.size) drainPendingRefresh(px, eyeY, pz, behind ? CHUNK_BEHIND_BUDGET_MS / 2 : 2);
  if (chunkQueue.length) drainChunkQueue(false, behind ? CHUNK_BEHIND_BUDGET_MS / 2 : CHUNK_BUDGET_MS - 2);
  // Clear-bubble guard: anything still queued inside the clear bubble would
  // pop in plain sight, so it builds synchronously no matter the budget.
  // Nearest first, so the closest hole always fills even if more remain.
  // Scored once up front: the old loop re-split every key on every pass.
  if (fogNear > 0 && chunkQueue.length) {
    const scored = [];
    for (const ck of chunkQueue) {
      const [wx, wz] = parseChunkKey(ck);
      scored.push([chunkDist3(px, eyeY, pz, wx, wz), ck, wx, wz]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    chunkQueue.length = 0;
    let k = 0;
    while (k < scored.length && scored[k][0] < fogNear) k++;
    for (let i = 0; i < k; i++) {
      if (chunkMeshes.has(scored[i][1])) continue;
      rebuildChunk(scored[i][2], scored[i][3], true);
    }
    // The rest keeps its nearest-first order from streamChunks.
    for (let i = k; i < scored.length; i++) chunkQueue.push(scored[i][1]);
  }
  // Fog-cull the rest groups against the current visibility range; cheap
  // enough to run every frame (early-outs when nothing moved).
  updateChunkCulling(px, eyeY, pz, fogFar);
}

const CHUNK_BUDGET_MS = 6;
// Borrowed frame time while visibly behind: a 2x-gravity dive (80 b/s)
// needs ~1,200 chunk builds/s to hold the mesh horizon, past what 6 ms
// covers. The loan only triggers while missing geometry sits inside the
// fog range — steady movement never pays it.
export const CHUNK_BEHIND_BUDGET_MS = 16;

export function drainChunkQueue(all, budgetMs = CHUNK_BUDGET_MS) {
  if (!chunkQueue.length) return;
  const deadline = all ? Infinity : performance.now() + budgetMs;
  while (chunkQueue.length && (all || performance.now() < deadline)) {
    const ck = chunkQueue.shift();
    if (chunkMeshes.has(ck)) continue;
    const [wx, wz] = parseChunkKey(ck);
    rebuildChunk(wx, wz, true);
  }
}

export function hasPendingChunks() {
  return chunkQueue.length > 0;
}

// Nearest queued (missing) chunk to the eye: the fog controller caps its
// far plane on this so streaming always debuts fully fogged, however slow
// the loader is. Infinity when nothing is queued.
export function nearestMissingDist(px, eyeY, pz) {
  let best = Infinity;
  for (const ck of chunkQueue) {
    const [wx, wz] = parseChunkKey(ck);
    const d = chunkDist3(px, eyeY, pz, wx, wz);
    if (d < best) best = d;
  }
  return best;
}

export function pendingCount() {
  return chunkQueue.length;
}

// Chunk keys touched by editing column (x, z), for remesh scheduling
// outside the mesher (band-wipe frontier gating accumulates these).
export function chunkKeysForColumn(x, z) {
  return columnKeys(x, z);
}

export function isChunkBuilt(ck) {
  return chunkMeshes.has(ck);
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
    // Halo range, not just the edited column: a source add/remove re-tints
    // neighbor chunks up to haloRadius() past their border, so they rebuild
    // too. Interior edits still map to exactly their own chunk (R < CHUNK);
    // border edits fan out to at most 2x2. This superset covers the old
    // adjacent-chunk exposure rule, so columnKeys stays only for the
    // band-wipe frontier gating below.
    for (const ck of haloKeys(x, z)) keys.add(ck);
  }
  for (const ck of keys) {
    if (chunkMeshes.has(ck)) {
      const [cx, cz] = parseChunkKey(ck);
      rebuildChunk(cx, cz);
      continue;
    }
    // Edit outside the built set (long-range sniping past the stream window):
    // queue it for the budgeted build instead of dropping it — the chunk
    // builds from live voxels so the placed block appears, and streamChunks
    // prunes the entry if it never enters the window.
    if (!chunkQueue.includes(ck)) chunkQueue.push(ck);
  }
}

// Budgeted remesh requests for the streaming path (tnt lattice): same
// column-key mapping as refreshBlocks, but queued instead of rebuilt inline —
// a fall plants dozens of touched columns per tick and sync-rebuilding all
// of them inside the tick is the frame-busting spiral (tall columns re-walk
// hundreds of occupancy entries each). Drained nearest-first under its own
// sub-budget in maybeStream; unbuilt keys resolve through the normal build
// queue, out-of-range keys drop when the stream window moves on.
const pendingRefresh = new Set();
export function queueRefreshBlocks(coords) {
  for (const [x, , z] of coords) {
    // Same halo range as refreshBlocks: the budgeted drain covers the rim.
    for (const ck of haloKeys(x, z)) pendingRefresh.add(ck);
  }
}
// Chunk range touched by an edit's baked halo: sources up to haloRadius()
// away re-tint this chunk's border cells, so every chunk intersecting the R
// square around (x, z) rebuilds. R < CHUNK keeps this at 1..4 chunks.
// Unioned with the old adjacent-chunk exposure rule, so border edits keep
// their neighbor refresh even if no halo source is registered.
function haloKeys(x, z) {
  const R = haloRadius();
  const cx0 = chunkOf(x - R), cx1 = chunkOf(x + R);
  const cz0 = chunkOf(z - R), cz1 = chunkOf(z + R);
  const out = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) out.push(cx + "_" + cz);
  }
  for (const ck of columnKeys(x, z)) if (!out.includes(ck)) out.push(ck);
  return out;
}
function drainPendingRefresh(px, eyeY, pz, budgetMs) {
  if (!pendingRefresh.size) return;
  const deadline = performance.now() + budgetMs;
  const scored = [];
  for (const ck of pendingRefresh) {
    const [wx, wz] = parseChunkKey(ck);
    scored.push([chunkDist3(px, eyeY, pz, wx, wz), ck, wx, wz]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  pendingRefresh.clear();
  for (const [, ck, wx, wz] of scored) {
    if (performance.now() > deadline) {
      pendingRefresh.add(ck); // over budget: back to the queue, order be damned
      continue;
    }
    // Built → rebuild now; queued → the build drain covers it; unknown →
    // drop (streamChunks re-queues if it enters the window).
    if (chunkMeshes.has(ck)) rebuildChunk(wx, wz);
  }
}

export function chunkCount() {
  return chunkMeshes.size;
}
