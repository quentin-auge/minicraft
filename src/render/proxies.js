// Procedural 3D proxy meshes for far celestial bodies: the exact voxel
// exterior (flat cap + shoreline-true lake insets with riser skirts +
// analytic dome underside, sealed rim) as low-poly meshes mirroring the
// voxel materials — palette rock texture as map + emissiveMap (Lambert +
// emissive 0.9) and palette water texture (Basic), both fog-free. The cap
// and the dome reuse the grain texture per block; the dome adds smooth
// normals, a 1.3× albedo lift, and a tilt normal map that gives it one
// voxel-scale facet per block — the staircase sparkle under the same sun.
// Same sizes, co-located and co-sized with the real body: the crossfade
// only ever swaps geometry density, never color. One body = three draw
// calls at any distance.
import * as THREE from "three";
import { TEX } from "../core/textures.js";
import {
  buildProxyData, buildLiteRock, buildLiteDome, buildLiteQuad,
  liteLakeQuads, liteBodyPlacement, liteGroups, LITE_LAKE_LIFT,
} from "../world/proxydata.js";

const entries = new Map(); // body key -> { group, rockMat, domeMat, waterMat, scene }
const texClones = new Map(); // src texture + collapse flag -> repeat-wrapped clone

function tiled(tex, collapsed = false) {
  const key = collapsed ? tex.uuid + "#flat" : tex.uuid;
  let c = texClones.get(key);
  if (!c) {
    c = tex.clone();
    c.wrapS = THREE.RepeatWrapping;
    c.wrapT = THREE.RepeatWrapping;
    if (collapsed) {
      // Sample the palette average: a sub-texel window whose derivatives
      // bottom mip selection out at the mean, whatever the attribute UVs.
      c.repeat.set(1 / 64, 1 / 64);
      c.offset.set(0.5, 0.5);
    }
    c.anisotropy = 16;
    c.needsUpdate = true;
    texClones.set(key, c);
  }
  return c;
}

// Shared facet-tilt normal map: one voxel-scale facet per block via the
// dome's planar UVs. Deterministic lattice (seeded LCG, independent texels
// so RepeatWrapping stays seamless); tilts stay in the +Z hemisphere around
// the surface normal. Linear (no color space): it encodes directions. The
// dome's albedo UVs run at the voxel texel density (one full texture per
// block), so the tilt map samples at 1/16 of that to keep one facet per
// block — its own repeat, independent of the albedo's.
let tiltCache = null;
function tiltNormalTex() {
  if (tiltCache) return tiltCache;
  const S = 16, MAX_TILT = 0.35;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(S, S);
  let st = 0x9e3779b9;
  const rnd = () => (st = (st * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * MAX_TILT;
      const i = (y * S + x) * 4;
      img.data[i] = (Math.sin(r) * Math.cos(a) * 0.5 + 0.5) * 255;
      img.data[i + 1] = (Math.sin(r) * Math.sin(a) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (Math.cos(r) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 16, 1 / 16);
  tiltCache = t;
  return t;
}

function meshFrom(out, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out.positions), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(out.normals), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(out.colors), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.uvs), 2));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.matrixAutoUpdate = false;
  m.frustumCulled = true;
  return m;
}

export function ensureProxy(scene, spec, seed) {
  let e = entries.get(spec.key);
  if (e) return e;
  const isMoon = spec.key === "moon";
  const rockTex = tiled(isMoon ? TEX.moon : TEX["planetrock" + spec.color]);
  const waterTex = tiled(isMoon ? TEX.moonwater_outside : TEX["planetwater" + spec.color + "_outside"]);
  const domeTex = tiled(isMoon ? TEX.moon : TEX["planetrock" + spec.color]);
  const rockMat = new THREE.MeshLambertMaterial({
    map: rockTex, emissiveMap: rockTex,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9,
    fog: false, transparent: true,
    // Depth-bias contract (standard depth, near=0.1/far=300000: the depth
    // step is ~blocks at LOD range): the proxy rock always WINS depth ties,
    // so converging or still-fog-culled voxels stay covered until the LOD
    // releases it — no pop-in mosaic while chunks build or un-cull — and
    // the release crossfade is a true over-blend (opaque mesh drawn first,
    // proxy composited above it) instead of a depth-fight damier. Real
    // occlusion is untouched: trailing planets sit orders of
    // magnitude past a 2-step bias, and genuinely protruding voxel bumps
    // still render (they are the true surface in front).
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // Dome: same rock look, palette-averaged color, albedo lifted 1.3× via
  // vertex colors, staircase sparkle via the tilt normal map.
  const domeMat = new THREE.MeshLambertMaterial({
    map: domeTex, emissiveMap: domeTex,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9,
    normalMap: tiltNormalTex(),
    vertexColors: true,
    fog: false, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const waterMat = new THREE.MeshBasicMaterial({
    map: waterTex, fog: false, transparent: true,
    // Lakes always win their ties: 3 steps ahead of the -2-biased cap (the
    // 0.03 lift would shimmer past ~50 blocks) and ahead of coplanar voxel
    // water during the crossfade (same texture — deterministic, invisible
    // either way).
    polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
  });
  const data = buildProxyData(spec, seed);
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  if (data.rock.positions.length) group.add(meshFrom(data.rock, rockMat));
  if (data.dome.positions.length) group.add(meshFrom(data.dome, domeMat));
  if (data.water.positions.length) group.add(meshFrom(data.water, waterMat));
  group.visible = false;
  scene.add(group);
  e = { group, rockMat, domeMat, waterMat, scene };
  entries.set(spec.key, e);
  return e;
}

export function setProxyVisible(key, visible) {
  const e = entries.get(key);
  if (e) e.group.visible = visible;
}

export function setProxyOpacity(key, opacity) {
  const e = entries.get(key);
  if (e) {
    e.rockMat.opacity = opacity;
    e.domeMat.opacity = opacity;
    e.waterMat.opacity = opacity;
  }
}

export function hasProxy(key) {
  return entries.has(key);
}

export function dropFullProxy(key) {
  const e = entries.get(key);
  if (!e) return;
  e.scene.remove(e.group);
  for (const m of [...e.group.children]) m.geometry.dispose();
  e.rockMat.dispose();
  e.domeMat.dispose();
  e.waterMat.dispose();
  entries.delete(key);
}

export function resetProxies() {
  for (const { group, rockMat, domeMat, waterMat, scene } of entries.values()) {
    scene.remove(group);
    for (const m of [...group.children]) m.geometry.dispose();
    rockMat.dispose();
    domeMat.dispose();
    waterMat.dispose();
  }
  entries.clear();
  for (const t of texClones.values()) t.dispose();
  texClones.clear();
  dropLiteProxies();
}

// Lite tier: 3 shared InstancedMeshes per palette (rock disc + rim, dome
// blob, lake quads) — every far body is a few instances, so the whole far
// sky is 21 draw calls no matter the body count. Mean-sampled palette
// textures (collapsed `tiled`, same maps + emissive as the full proxy)
// read identically to the mip-averaged full proxy past the swap distance;
// polygonOffset mirrors the full contract in depth units (distance-safe
// where geometric lifts shimmer out). The Moon never takes a lite slot
// (always FULL tier).
const WHITE = new THREE.Color(0xffffff);
const liteMeshes = []; // { mesh, mat } — one entry per (palette, kind)
const liteSlots = new Map(); // body key -> [{ mesh, slot, p:[x,y,z], s:[x,y,z] }]
const liteShown = new Map(); // body key -> bool (skip redundant rewrites)
let liteScene = null;
let liteBuiltSeed = null; // seed the shared lite meshes were built for (null = unbuilt)
const _liteM = new THREE.Matrix4();
const _liteP = new THREE.Vector3();
const _liteQ = new THREE.Quaternion();
const _liteS = new THREE.Vector3();
const _liteZero = new THREE.Matrix4().makeScale(0, 0, 0);

function liteMeshFrom(out, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out.positions), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(out.normals), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(out.colors), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.uvs), 2));
  g.computeBoundingSphere();
  return g;
}

function liteMats(color) {
  // spec.color is a palette index (same convention as TEX["planetrock" + i]).
  // Collapsed palette sampling: a sub-texel window whose derivatives bottom
  // mip selection out at the texture mean — the exact albedo the full proxy
  // mip-averages to at range, so lite and full read identically. Flat
  // THREE.Color albedos are banned here: canvas textures are sRGB-decoded
  // on sample while Color(r/255) stays linear, a ~3-6× brightness mismatch.
  const rTex = tiled(TEX["planetrock" + color], true);
  const wTex = tiled(TEX["planetwater" + color + "_outside"], true);
  const rockMat = new THREE.MeshLambertMaterial({
    map: rTex, emissiveMap: rTex,
    emissive: WHITE.clone(), emissiveIntensity: 0.9,
    fog: false, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const domeMat = new THREE.MeshLambertMaterial({
    map: rTex, emissiveMap: rTex,
    emissive: WHITE.clone(), emissiveIntensity: 0.9,
    vertexColors: true, fog: false, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const waterMat = new THREE.MeshBasicMaterial({
    map: wTex, fog: false, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
  });
  return { rockMat, domeMat, waterMat };
}

function liteMesh(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(count, 1));
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.visible = false;
  m.matrixAutoUpdate = false;
  // Park every slot at zero scale until decide() assigns visibility: an
  // untouched instance must never rasterize.
  for (let i = 0; i < Math.max(count, 1); i++) m.setMatrixAt(i, _liteZero);
  m.instanceMatrix.needsUpdate = true;
  return m;
}

export function buildLiteProxies(scene, specs, seed) {
  dropLiteProxies();
  liteScene = scene;
  // Geometries are world-scale (R baked): radius varies per spec in
  // principle, so they are cached per radius — one set today (R = 96).
  const geoCache = new Map();
  const geoFor = (R, thick) => {
    const k = R + ":" + (thick ?? 5);
    let g = geoCache.get(k);
    if (!g) {
      g = {
        rock: liteMeshFrom(buildLiteRock(R, thick ?? 5)),
        dome: liteMeshFrom(buildLiteDome(R, thick ?? 5)),
        quad: liteMeshFrom(buildLiteQuad()),
      };
      geoCache.set(k, g);
    }
    return g;
  };
  // Group first so each (palette, kind) mesh allocates exactly its slots.
  const specByKey = new Map(specs.map((s) => [s.key, s]));
  for (const { color, r: R, thick, keys } of liteGroups(specs)) {
    const { rockMat, domeMat, waterMat } = liteMats(color);
    let lakes = 0;
    const quads = new Map();
    for (const key of keys) {
      const q = liteLakeQuads(specByKey.get(key), seed);
      quads.set(key, q);
      lakes += q.length;
    }
    const g = geoFor(R, thick);
    const rockM = liteMesh(g.rock, rockMat, keys.length);
    const domeM = liteMesh(g.dome, domeMat, keys.length);
    const waterM = liteMesh(g.quad, waterMat, lakes);
    scene.add(rockM); scene.add(domeM); scene.add(waterM);
    liteMeshes.push(
      { mesh: rockM, mat: rockMat },
      { mesh: domeM, mat: domeMat },
      { mesh: waterM, mat: waterMat },
    );
    let wi = 0;
    keys.forEach((key, i) => {
      const at = liteBodyPlacement(specByKey.get(key));
      const slots = [
        { mesh: rockM, slot: i, p: [at.x, at.y, at.z], s: [1, 1, 1] },
        { mesh: domeM, slot: i, p: [at.x, at.y, at.z], s: [1, 1, 1] },
      ];
      for (const q of quads.get(key)) {
        slots.push({
          mesh: waterM, slot: wi++,
          p: [q.x, at.y + LITE_LAKE_LIFT, q.z], s: [q.half * 2, 1, q.half * 2],
        });
      }
      liteSlots.set(key, slots);
    });
  }
  liteBuiltSeed = seed;
}

// Lazy lite build: the shared impostor meshes only exist after a moon-boot
// prewarm — any other entry (overworld boot, travel, New World) stages lite
// tiers with no meshes behind setLiteBodyVisible (a silent no-op). Building
// on first need covers every path; the guard is two comparisons once built.
export function ensureLiteProxies(scene, specs, seed) {
  if (liteBuiltSeed === seed && liteMeshes.length) return;
  buildLiteProxies(scene, specs, seed);
}

function writeLiteSlot(mesh, slot, p, s) {
  _liteP.set(p[0], p[1], p[2]);
  _liteS.set(s[0], s[1], s[2]);
  _liteM.compose(_liteP, _liteQ, _liteS);
  mesh.setMatrixAt(slot, _liteM);
  mesh.instanceMatrix.needsUpdate = true;
}

// Show or hide a body's lite instances (zero-scale park). Full-tier bodies
// stay parked (their exact proxy owns the view); wiped bodies stay parked
// until re-touched. Redundant calls are free (no buffer re-upload).
export function setLiteBodyVisible(key, visible) {
  if (liteShown.get(key) === visible) return;
  liteShown.set(key, visible);
  const slots = liteSlots.get(key);
  if (!slots) return;
  for (const { mesh, slot, p, s } of slots) {
    if (visible) writeLiteSlot(mesh, slot, p, s);
    else mesh.setMatrixAt(slot, _liteZero);
  }
  for (const { mesh } of slots) mesh.instanceMatrix.needsUpdate = true;
}

export function setLiteOpacity(f) {
  for (const { mesh, mat } of liteMeshes) {
    mat.opacity = f;
    mesh.visible = f > 0.003;
  }
}

function dropLiteProxies() {
  if (liteScene) {
    // Geometries are shared across the palette meshes: dispose unique ones.
    const geos = new Set();
    for (const { mesh, mat } of liteMeshes) {
      liteScene.remove(mesh);
      geos.add(mesh.geometry);
      mat.dispose();
    }
    for (const g of geos) g.dispose();
  }
  liteMeshes.length = 0;
  liteSlots.clear();
  liteShown.clear();
  liteScene = null;
  liteBuiltSeed = null;
}
