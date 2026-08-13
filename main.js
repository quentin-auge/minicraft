import * as THREE from "three";

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, WATER = 7, PLANKS = 8, GLASS = 9, TNT = 10, FLOWER = 11, PORTAL = 12, ENDSTONE = 13;

const BLOCK_INFO = {
  [GRASS]:   { name: "Grass",    solid: true,  opaque: true,  placeable: true },
  [DIRT]:    { name: "Dirt",     solid: true,  opaque: true,  placeable: true },
  [STONE]:   { name: "Stone",    solid: true,  opaque: true,  placeable: true },
  [SAND]:    { name: "Sand",     solid: true,  opaque: true,  placeable: true },
  [LOG]:     { name: "Log",      solid: true,  opaque: true,  placeable: true },
  [LEAVES]:  { name: "Leaves",   solid: true,  opaque: true,  placeable: true },
  [WATER]:   { name: "Water",    solid: false, opaque: false, placeable: true },
  [PLANKS]:  { name: "Planks",   solid: true,  opaque: true,  placeable: true },
  [GLASS]:   { name: "Glass",    solid: true,  opaque: false, placeable: true },
  [TNT]:     { name: "TNT",      solid: true,  opaque: true,  placeable: true },
  [FLOWER]:  { name: "Flower",   solid: false, opaque: false, placeable: false },
  [PORTAL]:  { name: "Portal",   solid: true,  opaque: false, placeable: true },
  [ENDSTONE]:{ name: "End Stone",solid: true,  opaque: true,  placeable: false },
};

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------
function hash2(x, z, seed) {
  let n = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0;
  n = ((n ^ (n >>> 13)) | 0);
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = fade(xf), v = fade(zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return v * (u * (a - b) + b) + (1 - v) * (u * (c - d) + d);
}
function fbm(x, z, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Procedural textures (16x16 pixel art)
// ---------------------------------------------------------------------------
function canvasTex(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pxNoise(ctx, base, amount, chance = 1) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (Math.random() > chance) continue;
    const d = (Math.random() - 0.5) * amount;
    ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
    ctx.fillRect(x, y, 1, 1);
  }
}
const makeTex = (base, amount = 24) => canvasTex((ctx) => {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, 16, 16);
  pxNoise(ctx, base, amount);
});

const TEX = {
  grass_top: canvasTex((ctx) => {
    ctx.fillStyle = "#6ab04c"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [106, 176, 76], 20);
    for (let x = 0; x < 16; x++) if (Math.random() < 0.2) { ctx.fillStyle = "#8fce6b"; ctx.fillRect(x, 2 + Math.random() * 2, 1, 1); }
  }),
  grass_side: canvasTex((ctx) => {
    ctx.fillStyle = "#8a5a35"; ctx.fillRect(0, 4, 16, 12);
    pxNoise(ctx, [138, 90, 53], 22);
    ctx.fillStyle = "#6ab04c"; ctx.fillRect(0, 0, 16, 4);
    pxNoise(ctx, [106, 176, 76], 18, 0.9);
    for (let x = 0; x < 16; x++) if (Math.random() < 0.35) { ctx.fillStyle = "#8fce6b"; ctx.fillRect(x, 3, 1, 1); }
  }),
  dirt: makeTex([138, 90, 53], 26),
  stone: canvasTex((ctx) => {
    ctx.fillStyle = "#8d8d8d"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [141, 141, 141], 16);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 3, 4, 1); ctx.fillRect(6, 9, 5, 1); ctx.fillRect(11, 1, 3, 1); ctx.fillRect(3, 13, 4, 1);
  }),
  sand: makeTex([222, 207, 142], 14),
  log_side: canvasTex((ctx) => {
    ctx.fillStyle = "#6b4a2f"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [107, 74, 47], 16);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 3, 16, 1); ctx.fillRect(0, 8, 16, 1); ctx.fillRect(0, 13, 16, 1);
  }),
  log_top: canvasTex((ctx) => {
    ctx.fillStyle = "#8f6a3d"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [143, 106, 61], 14);
    ctx.strokeStyle = "#5d4026"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(8, 8, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, 8, 2, 0, Math.PI * 2); ctx.stroke();
  }),
  leaves: canvasTex((ctx) => {
    ctx.fillStyle = "#2e7d32"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [46, 125, 50], 22);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = Math.random() < 0.5 ? "#3f9145" : "#256a2a"; ctx.fillRect(Math.random() * 16, Math.random() * 16, 1, 1); }
  }),
  water: canvasTex((ctx) => {
    ctx.fillStyle = "#3a6fd8"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) if ((x + y * 5) % 6 === 0) ctx.fillRect(x, y * 4 + 2, 1, 1);
  }),
  planks: canvasTex((ctx) => {
    ctx.fillStyle = "#b98a4e"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [185, 138, 78], 12);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let y = 0; y < 4; y++) ctx.fillRect(0, y * 4, 16, 1);
    ctx.fillRect(4, 0, 1, 4); ctx.fillRect(11, 4, 1, 4); ctx.fillRect(6, 8, 1, 4); ctx.fillRect(13, 12, 1, 4);
  }),
  tnt: canvasTex((ctx) => {
    ctx.fillStyle = "#c0392b"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [192, 57, 43], 14);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 6, 16, 4);
    pxNoise(ctx, [236, 230, 208], 8, 0.7);
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 9, 16, 1);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 7px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 8, 8);
    ctx.fillStyle = "#5d2b22";
    ctx.fillRect(8, 0, 2, 2);
  }),
  flower: canvasTex((ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "#4a9c36";
    ctx.fillRect(7, 10, 2, 6);
    ctx.fillRect(4, 12, 3, 2); ctx.fillRect(9, 13, 3, 2);
    ctx.fillStyle = "#e0554a";
    ctx.fillRect(5, 3, 6, 2);
    ctx.fillRect(4, 5, 8, 2);
    ctx.fillRect(3, 7, 10, 2);
    ctx.fillRect(4, 9, 8, 2);
    ctx.fillRect(6, 11, 4, 2);
    ctx.fillStyle = "#ff8a80";
    ctx.fillRect(4, 5, 2, 2); ctx.fillRect(10, 5, 2, 2);
    ctx.fillRect(3, 7, 2, 2); ctx.fillRect(11, 7, 2, 2);
    ctx.fillStyle = "#7a1f18";
    ctx.fillRect(7, 7, 2, 2);
  }),
  glass: canvasTex((ctx) => {
    ctx.fillStyle = "rgba(190,230,255,0.55)"; ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, 14.5, 14.5);
    ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(8, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(15, 8); ctx.stroke();
  }),
  endstone: canvasTex((ctx) => {
    ctx.fillStyle = "#9a9aa2"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [154, 154, 162], 14);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 2 + Math.random() * 3, 2 + Math.random() * 2);
  }),
  portal: canvasTex((ctx) => {
    ctx.fillStyle = "#3a0d6b"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#9b30ff";
    for (let y = 0; y < 16; y += 2) for (let x = ((y / 2) % 2) * 2; x < 16; x += 4) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = "#d9a6ff";
    ctx.fillRect(7, 4, 2, 8);
  }),
};

function material(map, opts = {}) {
  return new THREE.MeshLambertMaterial({ map, ...opts });
}
// BoxGeometry face order: +x, -x, +y, -y, +z, -z
function materialsFor(id) {
  const [px, nx, py, ny, pz, nz] = [
    material(TEX.grass_side), material(TEX.grass_side), material(TEX.grass_top), material(TEX.dirt), material(TEX.grass_side), material(TEX.grass_side),
  ];
  switch (id) {
    case GRASS: return [px, nx, py, ny, pz, nz];
    case DIRT:  return faceTex(TEX.dirt);
    case STONE: return faceTex(TEX.stone);
    case SAND:  return faceTex(TEX.sand);
    case LOG:   return [material(TEX.log_side), material(TEX.log_side), material(TEX.log_top), material(TEX.log_top), material(TEX.log_side), material(TEX.log_side)];
    case LEAVES:return faceTex(TEX.leaves);
    case PLANKS:return faceTex(TEX.planks);
    case GLASS: return faceTex(TEX.glass, { transparent: true, opacity: 0.8, depthWrite: false });
    case WATER: return faceTex(TEX.water, { transparent: true, opacity: 0.65, depthWrite: false });
    case TNT:   return faceTex(TEX.tnt);
    case FLOWER: {
      const m = new THREE.MeshBasicMaterial({ map: TEX.flower, side: THREE.DoubleSide, alphaTest: 0.5 });
      return [m, m, m, m, m, m];
    }
    case PORTAL: return faceTex(TEX.portal, { transparent: false, opacity: 1, side: THREE.DoubleSide });
    case ENDSTONE: return faceTex(TEX.endstone);
    default: return faceTex(TEX.dirt);
  }
}
function faceTex(map, opts = {}) {
  return [material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts)];
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const WORLD_RADIUS = 96;
const WATER_LEVEL = 10;
const CHUNK = 16;
const RENDER_DIST = 8;
const MAX_Y = 120;
const LAND_RAISE = 20.0;
const BASIN_SHORE = 1.5;
const BASIN_DEPTH = 2.2;
const RIVER_COUNT = 3;
const RIVER_STEP = 36;
const RIVER_W = 6.0;
const RIVER_BED = 8;
const END_PLATFORM_TOP = 20;
const END_PLATFORM_R = 24;
const END_RETURN_Z = 16;
let seed = Math.floor(Math.random() * 100000);
let endSeed = Math.floor(Math.random() * 100000);
let waterScale = 1;
let waterDepth = 1;
let basinFreq = 0.007;
let basinThresh = 0;
let basinMax = 1;
let riverPaths = [];
let forestThresh = 0.5;

function key(x, y, z) { return x + "," + y + "," + z; }

const worlds = { over: new Map(), end: new Map() };
let dim = "over";
let world = worlds.over;
const getBlock = (x, y, z) => world.get(key(x, y, z)) || AIR;

function setBlock(x, y, z, id) {
  if (y < 0 || y > MAX_Y) return;
  const k = key(x, y, z);
  if (id === AIR) world.delete(k); else world.set(k, id);
}

function heightAt(x, z) {
  const base = fbm(x * 0.02, z * 0.02, seed) * 2 - 1;
  const hills = fbm(x * 0.008 + 100, z * 0.008 + 100, seed + 7) * 2 - 1;
  const rough = fbm(x * 0.06, z * 0.06, seed + 13) * 1.4;
  let h = 8 + LAND_RAISE + base * 8 + hills * 33 + rough;
  const plat = fbm(x * 0.006 + 400, z * 0.006 + 400, seed + 99);
  if (Math.abs(plat - 0.5) < 0.16) {
    const lvl = Math.round(plat * 7) / 7;
    h = 8 + lvl * 44 + (fbm(x * 0.06, z * 0.06, seed + 123) * 2 - 1) * 0.6;
  }
  h = Math.max(WATER_LEVEL + 1, Math.min(70, h));
  const basin = fbm(x * basinFreq + 200, z * basinFreq + 200, seed + 21) * 2 - 1;
  if (basin > basinThresh) {
    const s = (basin - basinThresh) / (basinMax - basinThresh);
    h = Math.max(1, WATER_LEVEL - BASIN_SHORE - s * (BASIN_DEPTH * waterDepth));
  }
  const rv = nearestRiver(x, z);
  if (rv && rv.d <= rv.w) {
    const t = rv.d / rv.w;
    h = Math.min(h, RIVER_BED + Math.floor(t * 6));
  }
  return Math.floor(h);
}

function growTree(x, y, z) {
  let trunkH = 1 + Math.floor(hash2(x, z, seed + 999) * 100);
  const topMax = MAX_Y - y - 1;
  if (trunkH > topMax) trunkH = Math.max(1, topMax);
  for (let i = 0; i < trunkH; i++) setBlock(x, y + i, z, LOG);
  const topY = y + trunkH;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy >= 0 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r + 0.5) continue;
      if (Math.abs(dx) === r && Math.abs(dz) === r && dy < 1 && Math.random() < 0.5) continue;
      if (getBlock(x + dx, topY + dy, z + dz) !== AIR) continue;
      setBlock(x + dx, topY + dy, z + dz, LEAVES);
    }
  }
  setBlock(x, topY + 1, z, LEAVES);
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = px - (ax + dx * t), ez = pz - (az + dz * t);
  return Math.sqrt(ex * ex + ez * ez);
}

function nearestRiver(x, z) {
  let best = null;
  for (let i = 0; i < riverPaths.length; i++) {
    const pts = riverPaths[i];
    const n = pts.length - 1;
    for (let k = 0; k < n; k++) {
      const d = distToSegment(x, z, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
      const w = RIVER_W * (0.7 + 0.6 * (k / n));
      if (!best || d - w < best.d - best.w) best = { d, w };
    }
  }
  return best;
}

function generateRivers() {
  riverPaths = [];
  const S = WORLD_RADIUS;
  for (let i = 0; i < RIVER_COUNT; i++) {
    const rs = seed + 777 + i * 101;
    const edge = Math.floor(hash2(0, 0, rs + 1) * 4);
    const along = (hash2(0, 0, rs + 2) * 2 - 1) * S * 0.6;
    let x, z, head;
    if (edge === 0) { x = -S; z = along; head = 0; }
    else if (edge === 1) { x = S; z = along; head = Math.PI; }
    else if (edge === 2) { x = along; z = -S; head = Math.PI / 2; }
    else { x = along; z = S; head = -Math.PI / 2; }
const wobA = 0.4 + hash2(0, 0, rs + 3) * 0.3;
  const wobF = 0.12 + hash2(0, 0, rs + 4) * 0.08;
  const phase = hash2(0, 0, rs + 5) * Math.PI * 2;
  const kink = (hash2(0, 0, rs + 6) * 2 - 1) * 0.3;
  const pts = [[x, z]];
  for (let n = 1; n < 60; n++) {
    head += wobA * Math.sin(n * wobF + phase) + kink * Math.sin(n * 0.19 + phase * 1.3);
    if (x > S * 0.6) head -= 0.12;
    if (x < -S * 0.6) head += 0.12;
    if (z > S * 0.6) head -= 0.12;
    if (z < -S * 0.6) head += 0.12;
    x += Math.cos(head) * RIVER_STEP;
    z += Math.sin(head) * RIVER_STEP;
    pts.push([x, z]);
    if (pts.length >= 10 || x > S + 40 || x < -S - 40 || z > S + 40 || z < -S - 40) break;
  }
    if (pts.length > 4) riverPaths.push(pts);
  }
}

function generateWorld() {
  world = worlds.over;
  worlds.over.clear();
  waterScale = 1 + (hash2(0, 0, seed + 333) * 4 | 0);
  waterDepth = 1 + (hash2(0, 0, seed + 444) * 4 | 0);
  basinFreq = 0.007 / Math.sqrt(waterScale);
  const vals = [];
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 2)
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 2)
      vals.push(fbm(x * basinFreq + 200, z * basinFreq + 200, seed + 21) * 2 - 1);
  vals.sort((a, b) => a - b);
  basinThresh = vals[(vals.length * 0.85) | 0];
  basinMax = vals[vals.length - 1];
  generateRivers();
  const fvals = [];
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 2)
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 2)
      fvals.push(fbm(x * 0.01 + 500, z * 0.01 + 500, seed + 888));
  fvals.sort((a, b) => a - b);
  forestThresh = fvals[(fvals.length * 0.5) | 0];
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z++) {
      const h = heightAt(x, z);
      for (let y = 0; y <= h; y++) {
        let id = STONE;
        if (y === h) id = h <= WATER_LEVEL + 1 ? SAND : GRASS;
        else if (y >= h - 2) id = DIRT;
        else if (y >= h - 5 && Math.random() < 0.3) id = STONE;
        setBlock(x, y, z, id);
      }
      if (h < WATER_LEVEL) for (let y = h + 1; y <= WATER_LEVEL; y++) setBlock(x, y, z, WATER);
      const forest = fbm(x * 0.01 + 500, z * 0.01 + 500, seed + 888);
      if (getBlock(x, h, z) === GRASS && hash2(x, z, seed + 555) < (forest > forestThresh ? 0.006 : 0.002)) {
        growTree(x, h + 1, z);
      } else if (getBlock(x, h, z) === GRASS && getBlock(x, h + 1, z) === AIR && hash2(x, z, seed + 7777) < 0.015) {
        setBlock(x, h + 1, z, FLOWER);
      }
    }
  }
}

function generateEnd() {
  const w = worlds.end;
  w.clear();
  const R = END_PLATFORM_R;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++)
      for (let y = END_PLATFORM_TOP - 2; y <= END_PLATFORM_TOP; y++) w.set(key(x, y, z), ENDSTONE);
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
document.getElementById("game").appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xfff5e0, 1.1);
sun.position.set(60, 90, 40);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a6a4a, 0.75);
scene.add(hemi);

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

// Cross-shaped billboard for plants: two planes crossing at right angles,
// sized to sit inside their block cell (0.05..0.95 tall) on top of the grass.
// Needs a uv attribute so the texture map actually samples per-fragment
// (without it every fragment samples texel (0,0)).
const crossGeo = (() => {
  const hw = 0.45, hh = 0.45;
  const v = [];
  const u = [];
  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
    v.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    v.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
    u.push(0, 0, 1, 0, 1, 1);
    u.push(0, 0, 1, 1, 0, 1);
  };
  quad(-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0);
  quad(0, -hh, -hw, 0, -hh, hw, 0, hh, hw, 0, hh, -hw);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(u, 2));
  geo.computeVertexNormals();
  return geo;
})();

// Chunked streaming renderer: the world (now 2x) is split into CHUNK-chunks
// and only chunks within RENDER_DIST of the player are meshed and drawn.
// Each chunk is one InstancedMesh per block type (only exposed faces), and
// every mesh gets a bounding sphere so Three.js frustum-culls it — blocks
// behind you or off-screen cost nothing, and distant chunks are unloaded.
const chunkMeshes = new Map();   // "cx_cz" -> Map<blockType, InstancedMesh>
const typeMats = new Map();      // blockType -> shared material[6]
let meshCx = 0, meshCz = 0;

function chunkOf(v) { return Math.floor(v / CHUNK); }
function getTypeMats(id) {
  if (!typeMats.has(id)) typeMats.set(id, materialsFor(id));
  return typeMats.get(id);
}
function disposeChunkMeshes(meshes) {
  for (const mesh of meshes.values()) { scene.remove(mesh); mesh.geometry.dispose(); }
}

function rebuildChunk(cx, cz) {
  const ck = cx + "_" + cz;
  if (chunkMeshes.has(ck)) {
    disposeChunkMeshes(chunkMeshes.get(ck));
    chunkMeshes.delete(ck);
  }
  const x0 = Math.max(cx * CHUNK, -WORLD_RADIUS);
  const x1 = Math.min(cx * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const z0 = Math.max(cz * CHUNK, -WORLD_RADIUS);
  const z1 = Math.min(cz * CHUNK + CHUNK - 1, WORLD_RADIUS);
  const counts = {};
  const exposed = [];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      for (let y = 0; y <= MAX_Y; y++) {
        const id = getBlock(x, y, z);
        if (id === AIR || !BLOCK_INFO[id] || !isExposed(x, y, z)) continue;
        counts[id] = (counts[id] || 0) + 1;
        exposed.push([x, y, z, id]);
      }
    }
  const meshes = new Map();
  if (exposed.length) {
    for (const idStr in counts) {
      const id = +idStr;
      const n = counts[id];
      const mesh = new THREE.InstancedMesh(id === FLOWER ? crossGeo : boxGeo, getTypeMats(id), n);
      mesh.count = n;
      let i = 0;
      for (const [x, y, z, bid] of exposed) {
        if (bid !== id) continue;
        dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      meshes.set(id, mesh);
    }
  }
  chunkMeshes.set(ck, meshes);
}

// Incremental streaming: build only missing chunks inside the window, unload
// chunks that fell outside it. Called when the player crosses a chunk border.
function streamChunks() {
  const cx = chunkOf(freeCam ? camPos.x : pos.x);
  const cz = chunkOf(freeCam ? camPos.z : pos.z);
  const R = RENDER_DIST;
  const keep = new Set();
  for (let dx = -R; dx <= R; dx++)
    for (let dz = -R; dz <= R; dz++) {
      const wx = cx + dx, wz = cz + dz;
      if (wx * CHUNK > WORLD_RADIUS || wx * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      if (wz * CHUNK > WORLD_RADIUS || wz * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      keep.add(wx + "_" + wz);
    }
  for (const [ck, meshes] of [...chunkMeshes]) {
    if (!keep.has(ck)) { disposeChunkMeshes(meshes); chunkMeshes.delete(ck); }
  }
  for (const ck of keep) {
    if (!chunkMeshes.has(ck)) {
      const [wx, wz] = ck.split("_");
      rebuildChunk(+wx, +wz);
    }
  }
  meshCx = cx; meshCz = cz;
}

function rebuildMeshes() {
  for (const meshes of chunkMeshes.values()) disposeChunkMeshes(meshes);
  chunkMeshes.clear();
  streamChunks();
}

// Rebuild just the chunk(s) holding the given blocks (plus neighbours across
// a chunk border), so editing cost stays tiny even in a 2x world.
function refreshBlocks(coords) {
  const keys = new Set();
  for (const [x, , z] of coords) {
    const cx = chunkOf(x), cz = chunkOf(z);
    keys.add(cx + "_" + cz);
    const rx = ((x % CHUNK) + CHUNK) % CHUNK;
    const rz = ((z % CHUNK) + CHUNK) % CHUNK;
    if (rx === 0) keys.add(cx - 1 + "_" + cz);
    if (rx === CHUNK - 1) keys.add(cx + 1 + "_" + cz);
    if (rz === 0) keys.add(cx + "_" + (cz - 1));
    if (rz === CHUNK - 1) keys.add(cx + "_" + (cz + 1));
  }
  for (const ck of keys) {
    if (!chunkMeshes.has(ck)) continue;
    const [cx, cz] = ck.split("_");
    rebuildChunk(+cx, +cz);
  }
}

function isExposed(x, y, z) {
  const id = getBlock(x, y, z);
  const info = BLOCK_INFO[id];
  if (!info) return false;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const [dx, dy, dz] of dirs) {
    const n = getBlock(x + dx, y + dy, z + dz);
    const ninfo = BLOCK_INFO[n];
    if (!ninfo) return true;
    if (!ninfo.opaque) return true;
    if (!ninfo.solid) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const PLAYER_HW = 0.3;
const PLAYER_H = 1.8;
const EYE = 1.62;
const GRAVITY = 26;
const JUMP = 8.2;
const WALK = 4.4, SPRINT = 7.2, FLY = 10;
const GRAPPLE_SPEED = 26;
const GRAPPLE_THROW = 70;
const GRAPPLE_FLING = 34;

const pos = new THREE.Vector3(0, 20, 0);
let grappleActive = false;
let grappleHooked = false;
let grappleFly = 0;
let grapplingDist = 1;
const grappleTarget = new THREE.Vector3();
const grappleStart = new THREE.Vector3();
let grappleBlock = null;
let flingActive = false;
const vel = new THREE.Vector3();
const camPos = new THREE.Vector3();
let yaw = 0, pitch = 0;
let onGround = false, flying = false, freeCam = false, locked = false;
const keys = {};

function spawnPlayer() {
  for (let y = 60; y > 0; y--) {
    if (getBlock(0, y, 0) !== AIR) {
      pos.set(0.5, y + 1.01, 0.5);
      break;
    }
  }
  vel.set(0, 0, 0);
  flingActive = false;
}

function isSolid(x, y, z) {
  const info = BLOCK_INFO[getBlock(x, y, z)];
  return !!info && info.solid;
}

function tryStep(dirX, dirZ) {
  const nx = dirX !== 0 ? Math.floor(pos.x + dirX * (PLAYER_HW + 0.001)) : Math.floor(pos.x);
  const nz = dirZ !== 0 ? Math.floor(pos.z + dirZ * (PLAYER_HW + 0.001)) : Math.floor(pos.z);
  const feetY = Math.floor(pos.y);
  const standY = feetY + 1;
  if (!isSolid(nx, feetY, nz)) return false;
  if (isSolid(nx, standY, nz) || isSolid(nx, standY + 1, nz)) return false;
  pos.y = standY + 0.001;
  vel.y = 0;
  onGround = true;
  return true;
}

function moveAxisX(dx) {
  pos.x += dx;
  if (dx === 0) return;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.x + PLAYER_HW : pos.x - PLAYER_HW;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (!isSolid(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) {
        if (tryStep(dir, 0)) return;
        pos.x = cellX - PLAYER_HW - 0.001; vel.x = 0; return;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        if (tryStep(dir, 0)) return;
        pos.x = cellX + 1 + PLAYER_HW + 0.001; vel.x = 0; return;
      }
    }
}
function moveAxisZ(dz) {
  pos.z += dz;
  if (dz === 0) return;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.z + PLAYER_HW : pos.z - PLAYER_HW;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++) {
      if (!isSolid(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) {
        if (tryStep(0, dir)) return;
        pos.z = cellZ - PLAYER_HW - 0.001; vel.z = 0; return;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        if (tryStep(0, dir)) return;
        pos.z = cellZ + 1 + PLAYER_HW + 0.001; vel.z = 0; return;
      }
    }
}
function moveAxisY(dy) {
  pos.y += dy;
  onGround = false;
  const top = pos.y + PLAYER_H, feet = pos.y;
  for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (vel.y > 0 && isSolid(bx, Math.floor(top), bz) && top > Math.floor(top)) { pos.y = Math.floor(top) - PLAYER_H - 0.001; vel.y = 0; return; }
      if (vel.y <= 0 && isSolid(bx, Math.floor(feet), bz)) { pos.y = Math.floor(feet) + 1 + 0.001; vel.y = 0; onGround = true; flingActive = false; return; }
    }
}
function collide() {
  moveAxisY(vel.y * dt);
  moveAxisX(vel.x * dt);
  moveAxisZ(vel.z * dt);
}

function fireGrapple() {
  if (freeCam) return;
  if (!currentBlock) return;
  const b = currentBlock;
  const tx = b.x + 0.5, ty = b.y + 1.001, tz = b.z + 0.5;
  const sx = pos.x, sy = pos.y + 0.3, sz = pos.z;
  const distEye = Math.hypot(tx - sx, ty - sy, tz - sz);
  if (distEye < 0.3) return;
  grappleBlock = b;
  grappleTarget.set(tx, ty, tz);
  grappleStart.set(sx, sy, sz);
  grapplingDist = distEye;
  grappleFly = 0;
  grappleHooked = false;
  grappleActive = true;
}

function blockedBody(px, py, pz) {
  const y0 = Math.floor(py + 0.02);
  const y1 = Math.floor(py + PLAYER_H - 0.02);
  for (let bx = Math.floor(px - PLAYER_HW + 0.02); bx <= Math.floor(px + PLAYER_HW - 0.02); bx++)
    for (let bz = Math.floor(pz - PLAYER_HW + 0.02); bz <= Math.floor(pz + PLAYER_HW - 0.02); bz++) {
      const skip = grappleBlock && bx === grappleBlock.x && bz === grappleBlock.z;
      for (let by = y0; by <= y1; by++) {
        if (skip && by === grappleBlock.y) continue;
        if (isSolid(bx, by, bz)) return true;
      }
    }
  return false;
}

function updateGrapple(dt) {
  if (!grappleHooked) {
    grappleFly += (GRAPPLE_THROW * dt) / grapplingDist;
    if (grappleFly >= 1) {
      grappleFly = 1;
      grappleHooked = true;
    }
    return false;
  }
  const dx = grappleTarget.x - pos.x, dy = grappleTarget.y - pos.y, dz = grappleTarget.z - pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const step = GRAPPLE_SPEED * dt;
  if (dist <= step + 0.001) {
    if (blockedBody(grappleTarget.x, grappleTarget.y, grappleTarget.z)) {
      grappleActive = false;
      vel.set(0, 0, 0);
      flingActive = false;
      return true;
    }
    pos.copy(grappleTarget);
    vel.set(0, 0, 0);
    flingActive = false;
    onGround = true;
    grappleActive = false;
    return true;
  }
  const s = step / dist;
  pos.set(pos.x + dx * s, pos.y + dy * s, pos.z + dz * s);
  return true;
}

function updatePlayer(dt) {
  if (grappleActive && updateGrapple(dt)) return;
  if (dim === "end") flying = false;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  const w = keys["ArrowUp"];
  const s = keys["ArrowDown"];
  const d = keys["ArrowRight"];
  const a = keys["ArrowLeft"];
  const sprintKey = keys["ShiftLeft"] || keys["ShiftRight"];

  if (w) move.add(fwd);
  if (s) move.sub(fwd);
  if (d) move.add(right);
  if (a) move.sub(right);

  const inWater = headInWater();

  if (flying) {
    const speed = FLY;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x = move.x; vel.z = move.z;
    vel.y = (keys["Space"] ? speed : 0) - (sprintKey ? speed : 0);
    flingActive = false;
  } else if (inWater) {
    // Buoyancy: automatically float toward the surface, hold Space to swim up.
    const speed = 4.2;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x += (move.x - vel.x) * Math.min(1, dt * 8);
    vel.z += (move.z - vel.z) * Math.min(1, dt * 8);
    const target = keys["Space"] ? 4.0 : 1.8;
    vel.y += (target - vel.y) * Math.min(1, dt * 4);
  } else {
    const sprint = sprintKey && move.lengthSq() > 0;
    const speed = sprint ? SPRINT : WALK;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    if (flingActive) {
      vel.x += move.x * 4.0 * dt;
      vel.z += move.z * 4.0 * dt;
      const damp = Math.max(0, 1 - 0.6 * dt);
      vel.x *= damp; vel.z *= damp;
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > GRAPPLE_FLING) { vel.x *= GRAPPLE_FLING / sp; vel.z *= GRAPPLE_FLING / sp; }
      if (sp < 1) flingActive = false;
    } else {
      vel.x = move.x; vel.z = move.z;
    }
    vel.y -= GRAVITY * dt;
    if (keys["Space"] && onGround) { vel.y = JUMP; onGround = false; }
    if (vel.y < -40) vel.y = -40;
  }
  collide();
}

// Free camera (spectator): detach from the player, fly through anything.
function updateFreeCam(dt) {
  const cp = Math.cos(pitch);
  const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys["ArrowUp"]) move.add(fwd);
  if (keys["ArrowDown"]) move.sub(fwd);
  if (keys["ArrowRight"]) move.add(right);
  if (keys["ArrowLeft"]) move.sub(right);
  const sprint = keys["ShiftLeft"] || keys["ShiftRight"];
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(FLY * (sprint ? 3 : 1) * dt);
  const r = 0.3;
  const tryAxis = (axis, v) => {
    if (v === 0) return;
    const nx = camPos.x + (axis === "x" ? v : 0);
    const ny = camPos.y + (axis === "y" ? v : 0);
    const nz = camPos.z + (axis === "z" ? v : 0);
    if (!freeCamBlocked(nx, ny, nz, r)) camPos.set(nx, ny, nz);
  };
  tryAxis("x", move.x);
  tryAxis("z", move.z);
  tryAxis("y", move.y);
}

function freeCamBlocked(x, y, z, r) {
  for (const ox of [-r, r])
    for (const oy of [-r, r])
      for (const oz of [-r, r])
        if (isSolid(Math.floor(x + ox), Math.floor(y + oy), Math.floor(z + oz))) return true;
  return false;
}

function exitFreeCam() {
  pos.set(camPos.x, Math.max(0, camPos.y), camPos.z);
  vel.set(0, 0, 0);
  flingActive = false;
  const outOfLevel =
    Math.abs(pos.x) > WORLD_RADIUS || Math.abs(pos.z) > WORLD_RADIUS ||
    pos.y < 0 || pos.y > 60;
  if (outOfLevel) spawnPlayer();
}

function headInWater() {
  const hw = PLAYER_HW;
  for (let i = 0; i < 2; i++) {
    const py = pos.y + (i === 0 ? 0.3 : PLAYER_H - 0.4);
    for (let bx = Math.floor(pos.x - hw); bx <= Math.floor(pos.x + hw); bx++)
      for (let bz = Math.floor(pos.z - hw); bz <= Math.floor(pos.z + hw); bz++)
        if (getBlock(bx, Math.floor(py), bz) === WATER) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Raycast (DDA voxel traversal)
// ---------------------------------------------------------------------------
const REACH = Infinity;
function pickBlock(origin, dir) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? Math.floor(origin.x) + 1 - origin.x : origin.x - Math.floor(origin.x)) / Math.abs(dir.x)) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? Math.floor(origin.y) + 1 - origin.y : origin.y - Math.floor(origin.y)) / Math.abs(dir.y)) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? Math.floor(origin.z) + 1 - origin.z : origin.z - Math.floor(origin.z)) / Math.abs(dir.z)) : Infinity;
  let face = [0, 0, 0];

  for (let i = 0; i < 256; i++) {
    const id = getBlock(x, y, z);
    if (id !== AIR && id !== WATER) return { x, y, z, id, face };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
    if (Math.min(tMaxX, tMaxY, tMaxZ) > REACH) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Highlight box
// ---------------------------------------------------------------------------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
);
highlight.visible = false;
scene.add(highlight);

const ropeA = new THREE.Vector3(), ropeB = new THREE.Vector3();
const grappleCubeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const grappleCubeMat = new THREE.MeshBasicMaterial({ color: 0x8a6d3b });
const GRAPPLE_CUBES = 1100;
const grappleCubes = new THREE.InstancedMesh(grappleCubeGeo, grappleCubeMat, GRAPPLE_CUBES);
grappleCubes.frustumCulled = false;
grappleCubes.visible = false;
scene.add(grappleCubes);
const grappleCubeMatrix = new THREE.Matrix4();
const grappleHead = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), new THREE.MeshBasicMaterial({ color: 0x4a3a1e }));
grappleHead.visible = false;
scene.add(grappleHead);

let currentBlock = null;
function updateTarget() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  currentBlock = pickBlock(camera.position, dir);
  if (currentBlock) {
    highlight.visible = true;
    highlight.position.set(currentBlock.x + 0.5, currentBlock.y + 0.5, currentBlock.z + 0.5);
  } else {
    highlight.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------
function breakBlock() {
  if (!currentBlock) return;
  const { x, y, z } = currentBlock;
  if (getBlock(x, y, z) === STONE && y === 0) return;
  if (getBlock(x, y, z) === TNT) { igniteTNT(x, y, z); return; }
  setBlock(x, y, z, AIR);
  refreshBlocks([[x, y, z]]);
  queueSave();
}
function placeBlock(id) {
  if (!currentBlock) return;
  if (!BLOCK_INFO[id] || !BLOCK_INFO[id].placeable) return;
  const [nx, ny, nz] = currentBlock.face;
  const px = currentBlock.x + nx, py = currentBlock.y + ny, pz = currentBlock.z + nz;
  if (getBlock(px, py, pz) !== AIR) return;
  if (intersectsPlayer(px, py, pz)) return;
  setBlock(px, py, pz, id);
  refreshBlocks([[px, py, pz]]);
  queueSave();
}
function intersectsPlayer(bx, by, bz) {
  return (
    bx + 1 > pos.x - PLAYER_HW && bx < pos.x + PLAYER_HW &&
    by + 1 > pos.y && by < pos.y + PLAYER_H &&
    bz + 1 > pos.z - PLAYER_HW && bz < pos.z + PLAYER_HW
  );
}

// ---------------------------------------------------------------------------
// TNT: breaking a TNT block lights a 3s fuse, then it explodes, destroying
// nearby blocks (with particles) and igniting any TNT caught in the blast.
// Re-breaking a lit TNT detonates it immediately.
// ---------------------------------------------------------------------------
const FUSE_TIME = 3;
const BLAST_RADIUS = 3;
const DRAGON_HIT_DIST = 4.5;
const DRAGON_FULL_DMG = 0.125;
const DRAGON_MIN_DMG = 0.05;
const TNT_HOME_SPEED = 11;
const DRAGON_STICK_DIST = 1.2;
const tntBombGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const tntBombMats = materialsFor(TNT);
const tntLit = new Map();
const bursts = [];
const flashes = [];

function makeTNTBomb() {
  return new THREE.Mesh(tntBombGeo, tntBombMats);
}

function clearTNTVisual(t) {
  scene.remove(t.spr);
  t.spr.material.map.dispose();
  t.spr.material.dispose();
  if (t.mesh) { scene.remove(t.mesh); t.mesh = null; }
}

function igniteTNT(bx, by, bz) {
  const k = key(bx, by, bz);
  if (tntLit.has(k)) {
    const t = tntLit.get(k);
    clearTNTVisual(t);
    tntLit.delete(k);
    explodeTNT(bx, by, bz, t.stuck);
    return;
  }
  const spr = makeFuseSprite();
  spr.position.set(bx + 0.5, by + 1.35, bz + 0.5);
  scene.add(spr);
  const t = { bx, by, bz, px: bx + 0.5, py: by + 1.1, pz: bz + 0.5, fuse: FUSE_TIME, spr, mesh: null, stuck: false, ax: 0, ay: 0, az: 0 };
  if (dim === "end" && dragon.mesh) {
    setBlock(bx, by, bz, AIR);
    refreshBlocks([[bx, by, bz]]);
    queueSave();
    const m = makeTNTBomb();
    m.position.set(bx + 0.5, by + 1.1, bz + 0.5);
    scene.add(m);
    t.mesh = m;
  }
  tntLit.set(k, t);
}

function makeFuseSprite() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.5, 0.75, 1);
  spr.userData = { c, ctx, tex };
  return spr;
}
function drawFuseSprite(spr, v) {
  const { c, ctx, tex } = spr.userData;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = "bold 52px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(v.toFixed(1), 64, 32);
  ctx.fillStyle = v <= 1 ? "#ff6a3d" : "#ffffff";
  ctx.fillText(v.toFixed(1), 64, 32);
  tex.needsUpdate = true;
}

function updateTNTTarget(t, dt) {
  if (dim !== "end" || !dragon.mesh) return;
  const p = dragon.mesh.position;
  if (t.stuck) {
    t.px = p.x + t.ax; t.py = p.y + t.ay; t.pz = p.z + t.az;
    return;
  }
  const dx = p.x - t.px, dy = p.y + 1 - t.py, dz = p.z - t.pz;
  const d = Math.hypot(dx, dy, dz);
  if (d <= DRAGON_STICK_DIST) {
    t.stuck = true;
    t.ax = t.px - p.x; t.ay = t.py - p.y; t.az = t.pz - p.z;
    return;
  }
  const sp = Math.min(d, TNT_HOME_SPEED * dt);
  t.px += (dx / d) * sp; t.py += (dy / d) * sp; t.pz += (dz / d) * sp;
}

function tickTNT(dt) {
  for (const [k, t] of [...tntLit]) {
    updateTNTTarget(t, dt);
    t.spr.position.set(t.px, t.py + 0.85, t.pz);
    if (t.mesh) {
      t.mesh.position.set(t.px, t.py, t.pz);
      if (t.stuck) {
        clearTNTVisual(t);
        tntLit.delete(k);
        explodeTNT(t.px, t.py, t.pz, true, true);
      } else if (!dragon.mesh) {
        clearTNTVisual(t);
        tntLit.delete(k);
      }
      continue;
    }
    t.fuse -= dt;
    if (t.fuse <= 0) {
      clearTNTVisual(t);
      tntLit.delete(k);
      explodeTNT(t.bx, t.by, t.bz, t.stuck);
    } else {
      drawFuseSprite(t.spr, t.fuse);
    }
  }
}

function dragonBlastDamage(dist, pointBlank) {
  if (pointBlank) return DRAGON_FULL_DMG;
  return DRAGON_FULL_DMG - (DRAGON_FULL_DMG - DRAGON_MIN_DMG) * Math.min(1, dist / DRAGON_HIT_DIST);
}

function explodeTNT(x, y, z, pointBlank, homing = false) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (pointBlank) spawnDragonBurst(x + 0.5, y + 0.5, z + 0.5);
  else spawnExplosion(x + 0.5, y + 0.5, z + 0.5);
  if (dim === "end" && dragon.mesh) {
    const cd = Math.hypot(dragon.mesh.position.x - (x + 0.5), dragon.mesh.position.y - (y + 0.5), dragon.mesh.position.z - (z + 0.5));
    damageDragon(dragonBlastDamage(cd, pointBlank));
  }
  if (homing) return;
  setBlock(bx, by, bz, AIR);
  const R = BLAST_RADIUS, R2 = R * R;
  const affected = [];
  for (let dx = -R; dx <= R; dx++)
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        const gx = bx + dx, gy = by + dy, gz = bz + dz;
        const id = getBlock(gx, gy, gz);
        if (id === AIR || id === WATER) continue;
        if (id === STONE && gy === 0) continue;
        if (id === TNT) {
          const tk = key(gx, gy, gz);
          if (tntLit.has(tk)) {
            const lt = tntLit.get(tk);
            if (!lt.mesh) {
              clearTNTVisual(lt);
              tntLit.delete(tk);
              explodeTNT(gx, gy, gz, lt.stuck);
            }
          } else {
            igniteTNT(gx, gy, gz);
          }
          continue;
        }
        affected.push([gx, gy, gz]);
      }
  if (affected.length) {
    for (const [axc, ayc, azc] of affected) setBlock(axc, ayc, azc, AIR);
    refreshBlocks([[bx, by, bz], ...affected]);
    queueSave();
  }
}

function spawnDragonDeath(cx, cy, cz) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(4, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xe8d6ff, transparent: true, opacity: 0.95 })
  );
  flash.position.set(cx, cy, cz);
  scene.add(flash);
  flashes.push({ mesh: flash, born: performance.now(), life: 0.6 });

  const N = 220;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    colA[i * 3] = Math.random() * 0.35;
    colA[i * 3 + 1] = Math.random() * 0.3;
    colA[i * 3 + 2] = 0.7 + Math.random() * 0.3;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 9 + Math.random() * 20;
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + 6;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.65, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 2.0, max: 2.0 });

  const N2 = 80;
  const posB = new Float32Array(N2 * 3);
  const colB = new Float32Array(N2 * 3);
  const velB = new Float32Array(N2 * 3);
  for (let i = 0; i < N2; i++) {
    posB[i * 3] = cx; posB[i * 3 + 1] = cy; posB[i * 3 + 2] = cz;
    const near = 0.9 + Math.random() * 0.1;
    colB[i * 3] = near; colB[i * 3 + 1] = near; colB[i * 3 + 2] = 1;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 5 + Math.random() * 10;
    velB[i * 3] = s * Math.sin(ph) * Math.cos(th);
    velB[i * 3 + 1] = s * Math.cos(ph) + 8;
    velB[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
  }
  const geoB = new THREE.BufferGeometry();
  geoB.setAttribute("position", new THREE.BufferAttribute(posB, 3));
  geoB.setAttribute("color", new THREE.BufferAttribute(colB, 3));
  const matB = new THREE.PointsMaterial({
    size: 0.3, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ptsB = new THREE.Points(geoB, matB);
  scene.add(ptsB);
  bursts.push({ pts: ptsB, geo: geoB, mat: matB, vel: velB, life: 1.2, max: 1.2 });
}

function spawnDragonBurst(cx, cy, cz) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xd06bff, transparent: true, opacity: 0.9 })
  );
  flash.position.set(cx, cy, cz);
  scene.add(flash);
  flashes.push({ mesh: flash, born: performance.now(), life: 0.35 });

  const N = 96;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    colA[i * 3] = 0.55 + Math.random() * 0.35;
    colA[i * 3 + 1] = 0.25 + Math.random() * 0.25;
    colA[i * 3 + 2] = 0.85 + Math.random() * 0.25;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 6 + Math.random() * 12;
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + 4;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.42, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 1.1, max: 1.1 });
}

function spawnExplosion(cx, cy, cz) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffdd77, transparent: true, opacity: 0.95 })
  );
  flash.position.set(cx, cy, cz);
  scene.add(flash);
  flashes.push({ mesh: flash, born: performance.now(), life: 0.28 });

  const N = 64;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    colA[i * 3] = 1; colA[i * 3 + 1] = 0.55 + Math.random() * 0.4; colA[i * 3 + 2] = 0.1 + Math.random() * 0.2;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 4 + Math.random() * 8;
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + 3;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.18, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 0.8, max: 0.8 });
}

function tickEffects(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt;
    const attr = b.pts.geometry.attributes.position;
    for (let j = 0; j < attr.count; j++) {
      attr.array[j * 3] += b.vel[j * 3] * dt;
      attr.array[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
      attr.array[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
      b.vel[j * 3 + 1] -= 22 * dt;
    }
    attr.needsUpdate = true;
    if (b.life <= 0) {
      scene.remove(b.pts);
      b.geo.dispose();
      b.mat.dispose();
      bursts.splice(i, 1);
    } else {
      b.mat.opacity = Math.min(1, b.life / b.max);
    }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = (performance.now() - f.born) / 1000;
    if (age >= f.life) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
      flashes.splice(i, 1);
      continue;
    }
    const t = age / f.life;
    f.mesh.scale.setScalar(0.4 + t * 4.2);
    f.mesh.material.opacity = 0.95 * (1 - t);
  }
}

// ---------------------------------------------------------------------------
// Portals & The End dimension
// ---------------------------------------------------------------------------
let portalCd = 0;
let prePortalFly = false;
let overPortalSpawn = { x: 0.5, y: 1.01, z: 0.5 };
let overPortalFace = null;
const END_SPAWN = { x: 0.5, y: END_PLATFORM_TOP + 1.6, z: END_RETURN_Z - 3 };
const END_RETURN_BASE_Y = END_PLATFORM_TOP + 1;

function buildReturnPortal() {
  const coords = [];
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 4; y++) {
      const isCorner = (x === -2 && (y === 0 || y === 4)) || (x === 2 && (y === 0 || y === 4));
      const isEdge = x === -2 || x === 2 || y === 0 || y === 4;
      if (isEdge && !isCorner) { setBlock(x, END_RETURN_BASE_Y + y, END_RETURN_Z, PORTAL); coords.push([x, END_RETURN_BASE_Y + y, END_RETURN_Z]); }
    }
  endReturnWin = { minX: -2, minY: END_RETURN_BASE_Y, minZ: END_RETURN_Z };
  refreshBlocks(coords);
}

function setDimensionEnv() {
  if (dim === "end") {
    scene.background.setHex(0x000000);
    scene.fog.color.setHex(0x000000);
    scene.fog.near = 30; scene.fog.far = 150;
    sun.intensity = 0.35; hemi.intensity = 0.45;
  } else {
    scene.background.setHex(0x87ceeb);
    scene.fog.color.setHex(0x87ceeb);
    scene.fog.near = 60; scene.fog.far = 160;
    sun.intensity = 1.1; hemi.intensity = 0.75;
  }
}

function goToDimension(name, sx, sy, sz) {
  dim = name;
  world = worlds[name];
  if (name === "end") {
    generateEnd();
    endReturnWin = null;
    spawnDragon();
    setDimensionEnv();
    prePortalFly = flying;
    flying = false;
    yaw = 0;
    pitch = 0;
  } else {
    setDimensionEnv();
    if (dragon.mesh) removeDragon();
    flying = prePortalFly;
    if (overPortalFace == null) {
      const w = findPortalWindow(Math.floor(overPortalSpawn.x), Math.floor(overPortalSpawn.y + 0.25), Math.floor(overPortalSpawn.z));
      if (w) yaw = Math.atan2(-(w.minX + 2.5 - overPortalSpawn.x), -(w.minZ + 2.5 - overPortalSpawn.z));
    } else {
      yaw = overPortalFace;
    }
  }
  if (freeCam) { freeCam = false; }
  Object.keys(keys).forEach((k) => { keys[k] = false; });
  pos.set(sx, sy, sz);
  camPos.set(sx, sy, sz);
  vel.set(0, 0, 0);
  rebuildMeshes();
  updateCamera();
  portalCd = 1.5;
  queueSave();
  updateDimLabel();
}

function winOk(minX, minZ, by) {
  for (let x = minX; x <= minX + 4; x++)
    for (let z = minZ; z <= minZ + 4; z++) {
      const isCorner = (x === minX || x === minX + 4) && (z === minZ || z === minZ + 4);
      const isEdge = x === minX || x === minX + 4 || z === minZ || z === minZ + 4;
      if (isCorner) continue;
      const id = getBlock(x, by, z);
      if (isEdge) { if (id !== PORTAL) return false; }
      else { if (id !== AIR) return false; }
    }
  return true;
}

function findPortalWindow(bx, by, bz) {
  for (let wx = -3; wx <= 1; wx++)
    for (let wz = -3; wz <= 1; wz++)
      if (winOk(bx + wx, bz + wz, by)) return { minX: bx + wx, minZ: bz + wz, by };
  return null;
}

function findPortalWindowNear(bx, by, bz, R) {
  for (let dy = -2; dy <= 2; dy++)
    for (let wx = -R; wx <= R; wx++)
      for (let wz = -R; wz <= R; wz++)
        if (winOk(bx + wx, bz + wz, by + dy)) return { minX: bx + wx, minZ: bz + wz, by: by + dy };
  return null;
}

function vWinOk(minX, minY, minZ) {
  for (let y = minY; y <= minY + 4; y++)
    for (let x = minX; x <= minX + 4; x++) {
      const isCorner = (x === minX || x === minX + 4) && (y === minY || y === minY + 4);
      const isEdge = x === minX || x === minX + 4 || y === minY || y === minY + 4;
      if (isCorner) continue;
      const id = getBlock(x, y, minZ);
      if (isEdge) { if (id !== PORTAL) return false; }
      else { if (id !== AIR) return false; }
    }
  return true;
}

function findVPortalWindowNear(bx, by, bz, R) {
  for (let wz = -R; wz <= R; wz++)
    for (let wx = -R; wx <= R; wx++)
      for (let wy = -R; wy <= R; wy++)
        if (vWinOk(bx + wx, by + wy, bz + wz)) return { minX: bx + wx, minY: by + wy, minZ: bz + wz };
  return null;
}

let portalFillGroup = null;
let portalFillKey = null;

function ensurePortalFillGroup() {
  if (portalFillGroup) return;
  portalFillGroup = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (let i = 0; i < 9; i++) portalFillGroup.add(new THREE.Mesh(geo, mat));
  portalFillGroup.visible = false;
  scene.add(portalFillGroup);
}

function showPortalFill(win) {
  ensurePortalFillGroup();
  const key = `${win.minX},${win.minZ},${win.by}`;
  let i = 0;
  for (let x = win.minX + 1; x <= win.minX + 3; x++)
    for (let z = win.minZ + 1; z <= win.minZ + 3; z++)
      portalFillGroup.children[i++].position.set(x + 0.5, win.by + 0.5, z + 0.5);
  portalFillGroup.visible = true;
  portalFillKey = key;
}

function showVPortalFill(win) {
  ensurePortalFillGroup();
  const key = `${win.minX},${win.minZ},${win.minY}`;
  let i = 0;
  for (let y = win.minY + 1; y <= win.minY + 3; y++)
    for (let x = win.minX + 1; x <= win.minX + 3; x++)
      portalFillGroup.children[i++].position.set(x + 0.5, y + 0.5, win.minZ + 0.5);
  portalFillGroup.visible = true;
  portalFillKey = key;
}

function hidePortalFill() {
  if (portalFillGroup) portalFillGroup.visible = false;
  portalFillKey = null;
}

let endReturnWin = null;
const portalMemo = { dim: "", bx: 0, by: 0, bz: 0, win: null };
let portalScanT = 0;

function scanEndPortal(bx, by, bz) {
  if (endReturnWin && vWinOk(endReturnWin.minX, endReturnWin.minY, endReturnWin.minZ)) return endReturnWin;
  if (portalMemo.dim === "end" && portalMemo.bx === bx && portalMemo.by === by && portalMemo.bz === bz) return portalMemo.win;
  portalMemo.dim = "end"; portalMemo.bx = bx; portalMemo.by = by; portalMemo.bz = bz;
  const w = findVPortalWindowNear(bx, by, bz, 5);
  portalMemo.win = w;
  if (w) endReturnWin = w;
  return w;
}

function scanOverPortal(bx, by, bz) {
  if (portalMemo.dim === "over" && portalMemo.bx === bx && portalMemo.by === by && portalMemo.bz === bz) return portalMemo.win;
  portalMemo.dim = "over"; portalMemo.bx = bx; portalMemo.by = by; portalMemo.bz = bz;
  portalMemo.win = findPortalWindowNear(bx, by, bz, 8);
  return portalMemo.win;
}

function updatePortalVisual() {
  portalScanT -= dt;
  if (portalScanT <= 0) { portalScanT = 0.5; portalMemo.dim = ""; }
  const bx = Math.floor(freeCam ? camPos.x : pos.x);
  const bz = Math.floor(freeCam ? camPos.z : pos.z);
  const by = Math.floor((freeCam ? camPos.y : pos.y) + 0.9);
  if (dim === "end") {
    const win = scanEndPortal(bx, by, bz);
    if (win) { showVPortalFill(win); return; }
    if (portalFillKey) hidePortalFill();
    return;
  }
  const win = scanOverPortal(bx, by, bz);
  if (win) { showPortalFill(win); return; }
  if (portalFillKey) hidePortalFill();
}

function nearPortalSpawn(win, dir) {
  const cx = win.minX + 2, cz = win.minZ + 2;
  const inInterior = (sx, sz) => sx >= win.minX + 1 && sx <= win.minX + 3 && sz >= win.minZ + 1 && sz <= win.minZ + 3;
  const spot = (sx, sz) => {
    if (inInterior(sx, sz)) return null;
    if (isSolid(sx, win.by, sz) || isSolid(sx, win.by + 1, sz)) return null;
    if (!isSolid(sx, win.by - 1, sz)) return null;
    return { x: sx + 0.5, y: win.by, z: sz + 0.5 };
  };
  const n = Math.hypot(dir.x, dir.z) || 1;
  const dx = dir.x / n, dz = dir.z / n;
  for (let d = 6; d <= 9; d++) {
    const cands = [
      { x: cx + Math.round(dx * d), z: cz + Math.round(dz * d) },
      { x: cx - Math.round(dx * d), z: cz - Math.round(dz * d) },
      { x: cx - Math.round(dz * d), z: cz + Math.round(dx * d) },
      { x: cx + Math.round(dz * d), z: cz - Math.round(dx * d) },
    ];
    for (const c of cands) {
      const s = spot(c.x, c.z);
      if (s) return s;
    }
  }
  for (let r = 6; r <= 12; r++)
    for (let ox = -r; ox <= r; ox++)
      for (let oz = -r; oz <= r; oz++) {
        if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
        const s = spot(cx + ox, cz + oz);
        if (s) return s;
      }
  return { x: win.minX + 0.5, y: win.by, z: win.minZ - 0.5 };
}

function checkPortal() {
  if (portalCd > 0) return;
  const bx = Math.floor(freeCam ? camPos.x : pos.x);
  const bz = Math.floor(freeCam ? camPos.z : pos.z);
  if (dim === "over") {
    const by = Math.floor((freeCam ? camPos.y : pos.y) + 0.9);
    const win = scanOverPortal(bx, by, bz);
    if (!win) return;
    if (bx < win.minX + 1 || bx > win.minX + 3 || bz < win.minZ + 1 || bz > win.minZ + 3) return;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let ddx = 0, ddz = 0;
    if (keys["ArrowUp"]) { ddx += forward.x; ddz += forward.z; }
    if (keys["ArrowDown"]) { ddx -= forward.x; ddz -= forward.z; }
    if (keys["ArrowRight"]) { ddx += right.x; ddz += right.z; }
    if (keys["ArrowLeft"]) { ddx -= right.x; ddz -= right.z; }
    if (ddx === 0 && ddz === 0) { ddx = forward.x; ddz = forward.z; }
    overPortalSpawn = nearPortalSpawn(win, { x: ddx, z: ddz });
    overPortalFace = Math.atan2(-(win.minX + 2.5 - overPortalSpawn.x), -(win.minZ + 2.5 - overPortalSpawn.z));
    goToDimension("end", END_SPAWN.x, END_SPAWN.y, END_SPAWN.z);
    showMsg("You arrived in The End");
  } else {
    const by = Math.floor(pos.y + EYE);
    const win = scanEndPortal(bx, by, bz);
    if (!win) return;
    if (bx < win.minX + 1 || bx > win.minX + 3) return;
    if (by < win.minY + 1 || by > win.minY + 3) return;
    if (bz !== win.minZ) return;
    goToDimension("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z);
    showMsg("You returned to the Overworld");
  }
}

// ---------------------------------------------------------------------------
// Ender Dragon (ambient)
// ---------------------------------------------------------------------------
const dragon = {
  mesh: null, wingL: null, wingR: null, neck: null, neckBaseX: 0, head: null, tail: null,
  path: null, s: 0, seg: 0, yaw: 0, pitch: 0, bank: 0, prevYaw: 0, t: 0, nextRun: 0,
  mouth: null, fx: null, parts: [], spitTimer: 0, spitting: 0,
  surgeT: 0, surge: 1, speedMul: 1, hp: 0,
};
const dragonMat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.08 }, opts));
let dragonUnitGeo = null;
let dragonMemGeo = null;
const dragonVec = new THREE.Vector3();
const dragonA = new THREE.Vector3();
const dragonB = new THREE.Vector3();
const DRAGON_SPEED = 8;
const DRAGON_SKIM_Y = END_PLATFORM_TOP + 2.2;
const DRAGON_SOAR_Y = END_PLATFORM_TOP + 10;

function dragonBox(parent, mat, sx, sy, sz, px, py, pz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(dragonUnitGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(px, py, pz);
  if (rx !== 0) m.rotation.x = rx;
  if (ry !== 0) m.rotation.y = ry;
  if (rz !== 0) m.rotation.z = rz;
  parent.add(m);
  return m;
}

function makeDragonMembraneGeo() {
  const s = new THREE.Shape();
  const pts = [
    [0, 0], [0.1, 0.4], [0.25, 0.9], [0.45, 1.4], [0.62, 2.0],
    [0.75, 2.6], [0.8, 3.1], [0.72, 3.6], [0.55, 3.95], [0.3, 4.1],
    [0.12, 4.12], [0.15, 3.85], [0.35, 3.7], [0.28, 3.3], [0.5, 3.0],
    [0.38, 2.6], [0.55, 2.2], [0.42, 1.8], [0.5, 1.35], [0.35, 1.0],
    [0.18, 0.6], [0.12, 0.25],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function spawnDragon() {
  if (dragon.mesh) return;
  const g = new THREE.Group();
  g.rotation.order = "YXZ";
  dragonUnitGeo = new THREE.BoxGeometry(1, 1, 1);
  dragonMemGeo = makeDragonMembraneGeo();
  const bodyMat = dragonMat(0x17171f);
  const bellyMat = dragonMat(0x1f1f2c);
  const plateMat = dragonMat(0x34344a);
  const boneMat = dragonMat(0x24242f);
  const memMat = new THREE.MeshStandardMaterial({
    color: 0x2a2050, roughness: 0.9, metalness: 0.02,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc86bff });

  dragonBox(g, bodyMat, 1.95, 1.45, 3.9, 0, 0, 0);
  dragonBox(g, plateMat, 1.75, 1.15, 1.8, 0, 0.32, 1.25);
  dragonBox(g, bodyMat, 1.35, 1.25, 0.9, 0, -0.05, -2.1);
  dragonBox(g, bellyMat, 1.7, 0.7, 3.4, 0, -0.62, 0.15);

  for (const [px, pz, rx, rz] of [
    [-0.55, 1.15, 0.25, -0.15], [0.55, 1.15, 0.25, 0.15],
    [-0.55, -1.45, -0.3, -0.1], [0.55, -1.45, -0.3, 0.1],
  ]) dragonBox(g, bodyMat, 0.28, 0.72, 0.3, px, -0.95, pz, rx, 0, rz);

  const neck = new THREE.Group();
  neck.position.set(0, 0.38, 1.75);
  neck.rotation.x = -0.62;
  g.add(neck);
  for (let k = 0; k < 5; k++)
    dragonBox(neck, k % 2 ? plateMat : bodyMat, 0.5 - k * 0.035, 0.62 - k * 0.09, 0.8 - k * 0.03, 0, 0.08 * k + 0.2, 0.5 + k * 0.4);

  const head = new THREE.Group();
  head.position.set(0, 0.52, 2.75);
  neck.add(head);
  dragonBox(head, bodyMat, 1.05, 0.85, 1.4, 0, 0.05, 0);
  dragonBox(head, bodyMat, 0.72, 0.4, 0.95, 0, 0.12, 1.0);
  dragonBox(head, bodyMat, 0.55, 0.3, 0.9, 0, -0.28, 0.95);
  dragonBox(head, plateMat, 0.95, 0.16, 0.75, 0, 0.52, -0.25);
  for (const hsx of [1, -1]) {
    dragonBox(head, boneMat, 0.26, 0.85, 0.26, hsx * 0.55, 0.5, -0.4, 0.15, 0, -hsx * 0.85);
    dragonBox(head, boneMat, 0.16, 0.6, 0.16, hsx * 0.55, 1.0, -0.45, 0.2, 0, -hsx * 0.85);
  }
  for (const [sx, sy, sz, px, py, pz, rx] of [
    [0.18, 0.6, 0.18, 0.0, 0.85, -0.3, 0.3],
    [0.14, 0.5, 0.14, -0.45, 0.82, -0.15, 0.4],
    [0.14, 0.5, 0.14, 0.45, 0.82, -0.15, 0.4],
    [0.12, 0.42, 0.12, -0.28, 0.92, -0.05, 0.5],
    [0.12, 0.42, 0.12, 0.28, 0.92, -0.05, 0.5],
  ]) dragonBox(head, boneMat, sx, sy, sz, px, py, pz, rx, 0, 0);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0.12, 1.5);
  head.add(mouth);
  for (const esx of [1, -1]) {
    dragonBox(head, eyeMat, 0.2, 0.2, 0.1, esx * 0.4, 0.18, 0.95, 0, esx * 0.25, 0);
  }
  dragonBox(head, eyeMat, 0.5, 0.12, 0.12, 0, -0.12, 1.35);

  const tail = new THREE.Group();
  tail.position.set(0, 0.1, -3.0);
  tail.rotation.x = 0.35;
  g.add(tail);
  const tailSegs = [];
  for (let k = 0; k < 6; k++) {
    const seg = new THREE.Group();
    seg.position.set(0, 0.05 * k, -0.35 * k);
    tail.add(seg);
    dragonBox(seg, k % 2 ? bodyMat : plateMat, 0.46 - k * 0.055, 0.42 - k * 0.05, 0.7 - k * 0.06, 0, 0, -0.35);
    tailSegs.push(seg);
  }
  for (const tsx of [1, -1]) dragonBox(tail, boneMat, 0.14, 0.12, 0.5, tsx * 0.12, 0.28, -2.35);

  function makeWing(side) {
    const wing = new THREE.Group();
    wing.position.set(side * 1.2, 0.55, 0.5);
    g.add(wing);
    dragonBox(wing, boneMat, 0.34, 0.42, 0.62, 0, 0, 0);
    for (const [ox, oz] of [[1.7, -0.5], [1.95, 0], [1.7, 0.5]])
      dragonBox(wing, boneMat, 0.85, 0.09, 0.11, side * ox, 0, oz, 0, side * 0.15 * oz, 0);
    const align = new THREE.Group();
    align.rotation.y = -side * Math.PI / 2;
    wing.add(align);
    const mem = new THREE.Mesh(dragonMemGeo, memMat);
    mem.rotation.x = -Math.PI / 2;
    if (side === 1) mem.geometry = dragonMemGeo.clone().scale(-1, 1, 1);
    align.add(mem);
    return wing;
  }
  const wL = makeWing(-1);
  const wR = makeWing(1);

  scene.add(g);
  dragon.mesh = g;
  dragon.wingL = wL; dragon.wingR = wR;
  dragon.neck = neck; dragon.neckBaseX = neck.rotation.x; dragon.head = head; dragon.tail = tailSegs;
  dragon.mouth = mouth;

  const fx = new THREE.Group();
  const breathGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const breathMat = new THREE.MeshBasicMaterial({ color: 0xd06bff, transparent: true, opacity: 0 });
  const parts = [];
  for (let i = 0; i < 110; i++) {
    const m = new THREE.Mesh(breathGeo, breathMat.clone());
    m.visible = false;
    fx.add(m);
    parts.push({ m, vel: new THREE.Vector3(), life: 1, ttl: 1, size: 0.5 });
  }
  scene.add(fx);
  dragon.fx = fx;
  dragon.parts = parts;

  dragon.path = null; dragon.yaw = 0; dragon.pitch = 0; dragon.bank = 0; dragon.prevYaw = 0; dragon.t = 0;
  dragon.mesh.position.set(0, END_PLATFORM_TOP + 3, 0);
  dragon.s = 0;
  dragon.nextRun = 2 + Math.random() * 3;
  dragon.spitTimer = 3 + Math.random() * 4;
  dragon.spitting = 0;
  dragon.surgeT = 0; dragon.surge = 1; dragon.speedMul = 1;
  dragon.hp = 1;
  updateBossBar();
  buildDragonPath();
}

function removeDragon() {
  if (!dragon.mesh) return;
  scene.remove(dragon.mesh);
  dragon.mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  dragon.mesh = null;
  if (dragon.fx) {
    scene.remove(dragon.fx);
    dragon.fx.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    dragon.fx = null;
  }
  dragon.parts = [];
  dragon.mouth = null;
  dragon.wingL = null; dragon.wingR = null;
  dragon.neck = null; dragon.head = null; dragon.tail = null;
  dragon.path = null;
  updateBossBar();
}

function dragonCatmull(p0, p1, p2, p3, u, out) {
  const u2 = u * u, u3 = u2 * u;
  out.set(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3)
  );
}

function dragonPlayerFocus() {
  if (dim !== "end") return null;
  const m = END_PLATFORM_R - 1;
  if (Math.abs(pos.x) > m || Math.abs(pos.z) > m) return null;
  const low = Math.random() < 0.5;
  return new THREE.Vector3(
    THREE.MathUtils.clamp(pos.x, -m, m),
    THREE.MathUtils.clamp(pos.y + (low ? 1.5 : 4.5) + Math.random() * 1.5, DRAGON_SKIM_Y, DRAGON_SOAR_Y + 3),
    THREE.MathUtils.clamp(pos.z, -m, m)
  );
}

function buildDragonPath(aim) {
  const N = 6 + (Math.random() * 3 | 0);
  const base = Math.random() * Math.PI * 2;
  const lowBias = Math.random() < 0.3 ? 0.5 : 0.18;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = base + (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    const wide = i % 2 === 0;
    const r = wide ? 16 + Math.random() * 7 : 4 + Math.random() * 5;
    pts.push(new THREE.Vector3(
      Math.cos(a) * r,
      Math.random() < lowBias ? DRAGON_SKIM_Y + Math.random() * 1.2 : DRAGON_SOAR_Y + Math.random() * 6,
      Math.sin(a) * r
    ));
  }
  pts[0].copy(dragon.mesh.position);
  const focus = dragonPlayerFocus();
  if (focus) {
    if (aim) {
      const dx = focus.x - pts[0].x, dz = focus.z - pts[0].z;
      const h = Math.hypot(dx, dz) || 1;
      const ahead = 7 + Math.random() * 3;
      pts[1].set(pts[0].x + (dx / h) * ahead, focus.y, pts[0].z + (dz / h) * ahead);
      pts[2] = focus;
    } else if (Math.random() < 0.6) {
      pts[2 + Math.floor(Math.random() * (N - 3))] = focus;
    }
  }
  const n = 180, pos = new Array(n), tmp = new THREE.Vector3();
  const RMAX2 = (END_PLATFORM_R - 1) ** 2;
  for (let k = 0; k < n; k++) {
    const u = (k / n) * N, i = Math.floor(u), t = u - i;
    dragonCatmull(pts[(i - 1 + N) % N], pts[i % N], pts[(i + 1) % N], pts[(i + 2) % N], t, tmp);
    tmp.y = Math.max(tmp.y, DRAGON_SKIM_Y);
    const r2 = tmp.x * tmp.x + tmp.z * tmp.z;
    if (r2 > RMAX2) { const sc = Math.sqrt(RMAX2 / r2); tmp.x *= sc; tmp.z *= sc; }
    pos[k] = tmp.clone();
  }
  const dist = new Array(n);
  dist[0] = 0;
  let len = 0;
  for (let k = 1; k < n; k++) { len += pos[k].distanceTo(pos[k - 1]); dist[k] = len; }
  len += pos[0].distanceTo(pos[n - 1]);
  dragon.path = { pos, dist, len };
  dragon.s = 0;
  dragon.seg = 0;
}

function dragonPathPoint(d, out) {
  const P = dragon.path, n = P.pos.length;
  d = ((d % P.len) + P.len) % P.len;
  let i = dragon.seg;
  while (i > 0 && d < P.dist[i]) i--;
  while (i < n - 1 && d > P.dist[i + 1]) i++;
  dragon.seg = i;
  const i1 = i + 1 < n ? i + 1 : 0;
  const span = i1 > i ? P.dist[i1] - P.dist[i] : P.len - P.dist[i];
  const t = span > 1e-6 ? (d - P.dist[i]) / span : 0;
  out.lerpVectors(P.pos[i], P.pos[i1], t);
}

function dragonBreathDir() {
  const fwd = new THREE.Vector3(0, 0, 1.6);
  dragon.head.updateWorldMatrix(true, true);
  fwd.transformDirection(dragon.head.matrixWorld);
  return fwd;
}

function spawnBreathPart() {
  let q = null;
  for (const p of dragon.parts) if (p.life >= p.ttl) { q = p; break; }
  if (!q) return;
  const mouthPos = new THREE.Vector3();
  dragon.mouth.getWorldPosition(mouthPos);
  const fwd = dragonBreathDir();
  q.m.visible = true;
  q.m.position.copy(mouthPos);
  q.size = 0.4 + Math.random() * 0.6;
  q.m.scale.setScalar(q.size);
  q.vel.set(
    fwd.x * (9 + Math.random() * 5) + (Math.random() - 0.5) * 0.6,
    fwd.y * (6 + Math.random() * 4) + 0.6 + Math.random() * 0.6,
    fwd.z * (9 + Math.random() * 5) + (Math.random() - 0.5) * 0.6
  );
  q.life = 0;
  q.ttl = 0.9 + Math.random() * 0.7;
  q.m.material.opacity = 1;
}

function updateDragonBreath(dt) {
  if (dragon.spitting > 0) {
    dragon.spitting -= dt;
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) spawnBreathPart();
  } else {
    dragon.spitTimer -= dt;
    if (dragon.spitTimer <= 0) {
      dragon.spitting = 1.2 + Math.random() * 0.9;
      dragon.spitTimer = 6 + Math.random() * 5;
    }
  }
  for (const q of dragon.parts) {
    if (q.life >= q.ttl) { q.m.visible = false; continue; }
    q.life += dt;
    q.vel.y -= 2.2 * dt;
    q.m.position.addScaledVector(q.vel, dt);
    const k = q.life / q.ttl;
    q.m.material.opacity = Math.max(0, 1 - k * k);
    if (q.life >= q.ttl) q.m.visible = false;
  }
}

function updateDragon(dt) {
  if (!dragon.mesh) return;
  const M = dragon.mesh;
  dt = Math.min(0.05, dt);
  const t = (dragon.t += dt);

  updateDragonBreath(dt);

  if (!dragon.path) buildDragonPath();
  const P = dragon.path;

  dragon.s += DRAGON_SPEED * ((0.85 + Math.sin(t * 0.4) * 0.15) * dragon.speedMul) * dt;
  dragon.nextRun -= dt;
  if (dragon.surgeT <= 0) {
    dragon.surgeT = 2 + Math.random() * 3.5;
    dragon.surge = 0.85 + Math.random() * 0.6;
  } else dragon.surgeT -= dt;
  dragon.speedMul += (dragon.surge - dragon.speedMul) * Math.min(1, dt * 2.5);
  if (dragon.s >= P.len || dragon.nextRun <= 0) {
    const dive = dragon.nextRun <= 0;
    if (dive) {
      dragon.nextRun = 4 + Math.random() * 5;
      if (Math.random() < 0.6) {
        dragon.spitting = Math.max(dragon.spitting, 1.2 + Math.random() * 0.9);
        dragon.spitTimer = 6 + Math.random() * 5;
      }
    }
    buildDragonPath(dive);
  }

  dragonPathPoint(dragon.s, dragonA);
  dragonPathPoint(dragon.s + 0.9, dragonB);
  const fwd = dragonVec.subVectors(dragonB, dragonA).normalize();

  const targetYaw = Math.atan2(fwd.x, fwd.z);
  let d = targetYaw - dragon.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  dragon.yaw += d * Math.min(1, dt * 5);
  dragon.pitch += (-Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) * 0.8 - dragon.pitch) * Math.min(1, dt * 6);
  let turn = dragon.yaw - dragon.prevYaw;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  dragon.prevYaw = dragon.yaw;
  dragon.bank += (THREE.MathUtils.clamp(-turn / Math.max(dt, 1e-4) * 0.35, -0.65, 0.65) - dragon.bank) * Math.min(1, dt * 3.5);

  M.position.copy(dragonA);
  M.position.y += Math.sin(t * 1.9) * 0.1;
  if (M.position.y < DRAGON_SKIM_Y) M.position.y = DRAGON_SKIM_Y;
  M.rotation.y = dragon.yaw;
  M.rotation.x = dragon.pitch;
  M.rotation.z = dragon.bank;

  const flapRate = (2.4 + Math.sin(t * 0.35) * 0.8) * (0.65 + 0.4 * dragon.speedMul);
  const amp = Math.max(0.2, 0.8 - Math.abs(fwd.y) * 0.9);
  const f = Math.sin(t * flapRate) * (0.5 + amp * 0.5);
  dragon.wingL.rotation.z = f;
  dragon.wingR.rotation.z = -f;
  dragon.wingL.rotation.y = 0.12 + f * 0.1;
  dragon.wingR.rotation.y = -0.12 - f * 0.1;

  if (dragon.neck) {
    dragon.neck.rotation.z = Math.sin(t * 0.8) * 0.05;
    dragon.neck.rotation.x = dragon.neckBaseX + fwd.y * 0.35;
    dragon.head.rotation.y = Math.sin(t * 0.55) * 0.12;
    dragon.head.rotation.x = Math.cos(t * 0.7) * 0.05;
  }
  if (dragon.tail)
    for (let i = 0; i < dragon.tail.length; i++) {
      const seg = dragon.tail[i];
      const k = (i + 1) / dragon.tail.length;
      seg.rotation.y = Math.sin(t * 3 - i * 0.7) * 0.25 * k;
      seg.rotation.x = Math.sin(t * 2.2 + i * 0.9) * 0.12 * k;
    }
}

// ---------------------------------------------------------------------------
// Save / load
// Normal mode (run `python3 server.py`, open http://localhost:8383): every world is a
// .sav file in save/ on disk, named when you press New World.
// Fallback when opened straight from disk or a plain static server:
// Chromium saves to a user-picked file; Firefox/Safari keep it in IndexedDB,
// J exports it as .sav, Load imports one. Same binary format either way.
// ---------------------------------------------------------------------------
const SAVE_MAGIC = [0x4d, 0x49, 0x4e, 0x49, 0x43, 0x52, 0x41, 0x46, 0x54]; // "MINICRAFT"
const fileMode = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
const fileDirOK = typeof window.showDirectoryPicker === "function";
const hasIDB = typeof indexedDB !== "undefined";
const apiOkPromise = fetch("api/worlds").then((r) => r.ok).catch(() => false);
let apiOk = false;
apiOkPromise.then((v) => { apiOk = v; });
let saveHandle = null;
let saveName = "";
let started = false;
let lastManualSave = 0;
const autosaveEl = document.getElementById("autosave");

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("minicraft", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saves");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function storageSave(buf) {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("saves", "readwrite");
    tx.objectStore("saves").put(buf, "autosave");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function storageLoad() {
  const db = await dbOpen();
  const buf = await new Promise((resolve, reject) => {
    const req = db.transaction("saves", "readonly").objectStore("saves").get("autosave");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return buf;
}
async function storageClear() {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("saves", "readwrite");
    tx.objectStore("saves").delete("autosave");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function serialize() {
  const writeBlocks = (map) => {
    const arr = [];
    map.forEach((id, k) => { const s = k.split(","); arr.push([+s[0], +s[1], +s[2], id]); });
    return arr;
  };
  const over = writeBlocks(worlds.over);
  const end = writeBlocks(worlds.end);
  const n = over.length + end.length;
  const buf = new ArrayBuffer(93 + n * 4);
  const dv = new DataView(buf);
  let o = 0;
  new Uint8Array(buf, o, 9).set(SAVE_MAGIC); o += 9;
  dv.setUint8(o++, 2); // format version
  dv.setUint8(o++, dim === "end" ? 1 : 0);
  dv.setInt32(o, seed, true); o += 4;
  dv.setInt32(o, endSeed, true); o += 4;
  dv.setFloat64(o, pos.x, true); o += 8;
  dv.setFloat64(o, pos.y, true); o += 8;
  dv.setFloat64(o, pos.z, true); o += 8;
  dv.setFloat64(o, yaw, true); o += 8;
  dv.setFloat64(o, pitch, true); o += 8;
  dv.setUint8(o++, flying ? 1 : 0);
  dv.setUint8(o++, selected);
  dv.setFloat64(o, overPortalSpawn.x, true); o += 8;
  dv.setFloat64(o, overPortalSpawn.y, true); o += 8;
  dv.setFloat64(o, overPortalSpawn.z, true); o += 8;
  dv.setUint32(o, over.length, true); o += 4;
  for (const [x, y, z, id] of over) {
    dv.setUint8(o++, x + 128);
    dv.setUint8(o++, y);
    dv.setUint8(o++, z + 128);
    dv.setUint8(o++, id);
  }
  dv.setUint32(o, end.length, true); o += 4;
  for (const [x, y, z, id] of end) {
    dv.setUint8(o++, x + 128);
    dv.setUint8(o++, y);
    dv.setUint8(o++, z + 128);
    dv.setUint8(o++, id);
  }
  return buf;
}

function deserialize(buf) {
  const dv = new DataView(buf);
  let o = 0;
  for (let i = 0; i < 9; i++) if (new Uint8Array(buf, o, 9)[i] !== SAVE_MAGIC[i]) throw new Error("Not a MiniCraft save");
  o += 9;
  const ver = dv.getUint8(o++);
  if (ver !== 1 && ver !== 2) throw new Error("Unsupported save version");
  let dimFlag = 0, endSeedVal = endSeed;
  if (ver >= 2) { dimFlag = dv.getUint8(o++); endSeedVal = dv.getInt32(o, true); o += 4; }
  seed = dv.getInt32(o, true); o += 4;
  if (ver >= 2) endSeed = endSeedVal;
  pos.x = dv.getFloat64(o, true); o += 8;
  pos.y = dv.getFloat64(o, true); o += 8;
  pos.z = dv.getFloat64(o, true); o += 8;
  yaw = dv.getFloat64(o, true); o += 8;
  pitch = dv.getFloat64(o, true); o += 8;
  flying = dv.getUint8(o++) === 1;
  selected = dv.getUint8(o++);
  overPortalSpawn = { x: dv.getFloat64(o, true), y: dv.getFloat64(o, true), z: dv.getFloat64(o, true) };
  o += 24;
  const n = dv.getUint32(o, true); o += 4;
  worlds.over.clear();
  for (let i = 0; i < n; i++) {
    const x = dv.getUint8(o++) - 128;
    const y = dv.getUint8(o++);
    const z = dv.getUint8(o++) - 128;
    worlds.over.set(key(x, y, z), dv.getUint8(o++));
  }
  if (ver >= 2) {
    const ne = dv.getUint32(o, true); o += 4;
    worlds.end.clear();
    for (let i = 0; i < ne; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = dv.getUint8(o++);
      const z = dv.getUint8(o++) - 128;
      worlds.end.set(key(x, y, z), dv.getUint8(o++));
    }
  }
  dim = dimFlag ? "end" : "over";
  world = worlds[dim];
}

function canSave() {
  if (apiOk && saveName) return true;
  return fileMode ? !!saveHandle : hasIDB;
}

function updateAutosaveEl() {
  if (!autosaveEl) return;
  if (apiOk) {
    autosaveEl.textContent = saveName
      ? "World: " + saveName + (lastManualSave ? " · saved " + new Date(lastManualSave).toLocaleTimeString() : "")
      : "Start a world with New World";
    return;
  }
  if (!fileMode && !hasIDB) autosaveEl.textContent = "Autosave: not supported in this browser";
  else if (!canSave()) autosaveEl.textContent = started ? "No save file (press J)" : fileMode ? "Pick a save file when you start" : "Autosave: kept in your browser";
  else if (lastManualSave) autosaveEl.textContent = "Saved " + new Date(lastManualSave).toLocaleTimeString();
  else autosaveEl.textContent = fileMode ? "Save file: " + saveHandle.name : "Autosave: on (in browser)";
}

function updateCamera() {
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(pitch, yaw, 0);
}

// ---------------------------------------------------------------------------
// HUD (dimension label, toast)
// ---------------------------------------------------------------------------
const dimEl = document.getElementById("dim");
const toastEl = document.getElementById("toast");
const bossBarEl = document.getElementById("bossbar");
const bossFillEl = document.getElementById("bossfill");
let toastTimer = 0;

function updateBossBar() {
  if (!dragon.mesh || dragon.hp <= 0) { bossBarEl.style.display = "none"; return; }
  bossFillEl.style.width = Math.max(0, Math.round(dragon.hp * 100)) + "%";
  bossBarEl.style.display = "block";
}

function damageDragon(amount) {
  if (!dragon.mesh || dragon.hp <= 0) return;
  dragon.hp = Math.max(0, dragon.hp - amount);
  updateBossBar();
  if (dragon.hp <= 0) {
    const dx = dragon.mesh.position.x, dy = dragon.mesh.position.y + 1, dz = dragon.mesh.position.z;
    removeDragon();
    buildReturnPortal();
    queueSave();
    spawnDragonDeath(dx, dy, dz);
    showMsg("Ender Dragon is defeated");
  }
}

function updateDimLabel() {
  if (!started) { dimEl.style.display = "none"; return; }
  dimEl.textContent = dim === "end" ? "The End" : "Overworld";
  dimEl.style.display = "block";
}
function showMsg(text) {
  toastEl.textContent = text;
  toastEl.style.opacity = "1";
  toastTimer = 2.6;
}

function downloadSave(buf) {
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "minicraft.sav";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function apiList() {
  const res = await fetch("api/worlds");
  return res.ok ? await res.json() : [];
}
async function apiLoad(name) {
  const res = await fetch("api/worlds/" + encodeURIComponent(name));
  if (!res.ok) throw new Error("Save not found");
  return await res.arrayBuffer();
}
function normalizeWorldName(raw) {
  let n = (raw || "").trim().replace(/[\\/]/g, "_");
  n = n.replace(/\.\.+/g, "_").replace(/^\.+/, "").trim();
  if (!n) return null;
  if (!n.toLowerCase().endsWith(".sav")) n += ".sav";
  return n;
}
function dialogEl() {
  const dlg = document.createElement("div");
  dlg.className = "dlg";
  const box = document.createElement("div");
  box.className = "dlg-box";
  dlg.appendChild(box);
  document.body.appendChild(dlg);
  return { dlg, box };
}
function askName(title, initial) {
  return new Promise((resolve) => {
    const { dlg, box } = dialogEl();
    box.innerHTML = "<h2>" + title + "</h2>" +
      '<input class="dlg-input" type="text" value="" spellcheck="false" placeholder="world name"/>' +
      '<div class="dlg-actions"><button class="dlg-cancel">Cancel</button><button class="dlg-ok">Create</button></div>';
    const input = box.querySelector(".dlg-input");
    const finish = (v) => { dlg.remove(); resolve(v); };
    const ok = () => { const n = normalizeWorldName(input.value); if (n) finish(n); };
    box.querySelector(".dlg-ok").onclick = ok;
    box.querySelector(".dlg-cancel").onclick = () => finish(null);
    input.onkeydown = (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") finish(null); };
    dlg.onmousedown = (e) => { if (e.target === dlg) finish(null); };
    box.onmousedown = (e) => e.stopPropagation();
    input.value = initial;
    input.focus();
    input.select();
  });
}

// Firefox/Safari have no File System Access API, so the OS picker can't be
// dropped into save/. Show the folder contents instead; click a row to load.
function pickWorld(entries) {
  return new Promise((resolve) => {
    const names = entries.map((e) => (typeof e === "string" ? e : e.name));
    const { dlg, box } = dialogEl();
    let html = "<h2>Load save</h2>" +
      '<div class="dlg-path">~/projects/tech/minicraft/save/</div>';
    if (!names.length) {
      html += '<div class="dlg-empty">No saves in save/ yet. Create one with New World.</div>' +
        '<div class="dlg-actions"><button class="dlg-cancel">Close</button></div>';
    } else {
      html += '<ul class="dlg-list">' + names.map((n) =>
        '<li data-name="' + n + '"><span class="w">' + n.replace(/\.sav$/i, "") +
        '</span></li>').join("") +
        '</ul><div class="dlg-actions"><button class="dlg-cancel">Cancel</button></div>';
    }
    box.innerHTML = html;
    const finish = (v) => { dlg.remove(); resolve(v); };
    dlg.onmousedown = (e) => { if (e.target === dlg) finish(null); };
    box.onmousedown = (e) => e.stopPropagation();
    box.querySelector(".dlg-cancel").onclick = () => finish(null);
    box.querySelectorAll("li").forEach((li) => {
      li.onclick = () => finish(li.dataset.name);
    });
  });
}

// Saving the whole save/ directory handle (Chrome/Edge File System Access)
// so loaders start straight inside save/ instead of asking every time.
function idbPut(key, val) {
  return new Promise((resolve, reject) => {
    dbOpen().then((db) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put(val, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  });
}
function idbGet(key) {
  return new Promise((resolve, reject) => {
    dbOpen().then((db) => {
      const req = db.transaction("saves", "readonly").objectStore("saves").get(key);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => reject(req.error);
    });
  });
}
let saveDirPromise = null;
function getSaveDir() {
  if (!fileDirOK) return Promise.resolve(null);
  if (!saveDirPromise) {
    saveDirPromise = (async () => {
      let h = await idbGet("savedir").catch(() => null);
      if (h) {
        try {
          if (await h.queryPermission({ mode: "read" }) !== "granted") {
            await h.requestPermission({ mode: "read" });
          }
        } catch { h = null; }
      }
      if (!h) {
        try {
          h = await window.showDirectoryPicker({ id: "minicraft-save-dir", mode: "read" });
          await idbPut("savedir", h).catch(() => {});
        } catch { return null; }
      }
      return h;
    })();
    saveDirPromise.then((h) => { if (!h) saveDirPromise = null; });
  }
  return saveDirPromise;
}

async function pickSaveFile() {
  apiOk = await apiOkPromise;
  if (apiOk) {
    if (saveName) await saveToFile();
    return;
  }
  if (fileMode) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "minicraft.sav",
        types: [{ description: "MiniCraft save", accept: { "application/octet-stream": [".sav"] } }],
      });
      try { await handle.requestPermission({ mode: "readwrite" }); } catch {}
      saveHandle = handle;
      await saveToFile();
      updateAutosaveEl();
    } catch {}
  } else if (hasIDB) {
    try { await storageSave(serialize()); } catch {}
    downloadSave(serialize());
    lastManualSave = Date.now();
    updateAutosaveEl();
  }
}

async function saveToFile(opts = {}) {
  if (apiOk && saveName) {
    try {
      const res = await fetch("api/worlds/" + encodeURIComponent(saveName), {
        method: "PUT", body: serialize(), keepalive: !!opts.keepalive,
      });
      if (res.ok) { lastManualSave = Date.now(); updateAutosaveEl(); }
      else throw new Error("save failed");
    } catch {
      if (autosaveEl) autosaveEl.textContent = "Save failed — run `python3 server.py` and open http://localhost:8383";
    }
    return;
  }
  if (!canSave()) return;
  const buf = serialize();
  try {
    if (fileMode) {
      const writable = await saveHandle.createWritable();
      await writable.write(buf);
      await writable.close();
    } else {
      await storageSave(buf);
    }
    lastManualSave = Date.now();
    updateAutosaveEl();
  } catch (e) {
    if (autosaveEl) autosaveEl.textContent = fileMode
      ? "Autosave failed (file deleted or permission revoked) — press J to pick a new file"
      : "Autosave failed (storage unavailable)";
  }
}

function importSaveFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sav,application/octet-stream";
    input.style.display = "none";
    let done = false;
    const finish = (v) => { if (done) return; done = true; removeEventListener("focus", onFocus); resolve(v); };
    const onFocus = () => setTimeout(() => finish(null), 400);
    input.onchange = async () => {
      const file = input.files && input.files[0];
      finish(file ? { name: file.name, buf: await file.arrayBuffer() } : null);
    };
    document.body.appendChild(input);
    input.click();
    input.remove();
    addEventListener("focus", onFocus);
  });
}

function restoreSave(buf) {
  deserialize(buf);
  rebuildMeshes();
  select(selected);
  updateCamera();
  setDimensionEnv();
  updateDimLabel();
  if (dim === "end") { buildReturnPortal(); spawnDragon(); }
  lastManualSave = Date.now();
  return true;
}

async function loadSave() {
  apiOk = await apiOkPromise;
  if (apiOk) {
    if (fileDirOK) {
      const dir = await getSaveDir();
      if (!dir) return false;
      const opts = {
        startIn: dir,
        types: [{ description: "MiniCraft save", accept: { "application/octet-stream": [".sav"] } }],
        multiple: false,
      };
      try {
        const [handle] = await window.showOpenFilePicker(opts);
        const file = await handle.getFile();
        saveName = normalizeWorldName(file.name) || file.name;
        restoreSave(await file.arrayBuffer());
        await saveToFile();
        updateAutosaveEl();
        return true;
      } catch { return false; }
    }
    const list = await apiList();
    const name = await pickWorld(list);
    if (!name) return false;
    try {
      saveName = name;
      restoreSave(await apiLoad(name));
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch {
      if (autosaveEl) autosaveEl.textContent = "That file isn't a valid MiniCraft save.";
      return false;
    }
  }
  if (fileMode) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "MiniCraft save", accept: { "application/octet-stream": [".sav"] } }],
      });
      saveHandle = handle;
      const file = await handle.getFile();
      restoreSave(await file.arrayBuffer());
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch { return false; }
  }
  const picked = await importSaveFile();
  if (picked) {
    try {
      restoreSave(picked.buf);
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch {
      if (autosaveEl) autosaveEl.textContent = "That file isn't a valid MiniCraft save.";
      return false;
    }
  }
  const cached = await storageLoad();
  if (cached) {
    try {
      restoreSave(cached);
      updateAutosaveEl();
      return true;
    } catch { return false; }
  }
  if (autosaveEl) autosaveEl.textContent = "No save found.";
  return false;
}

function resetDims() {
  dim = "over";
  world = worlds.over;
  worlds.end.clear();
  overPortalSpawn = { x: 0.5, y: 1.01, z: 0.5 };
  overPortalFace = null;
  if (dragon.mesh) removeDragon();
  setDimensionEnv();
  updateDimLabel();
}

async function regenerate() {
  if (fileMode && !saveHandle) await pickSaveFile();
  resetDims();
  seed = Math.floor(Math.random() * 100000);
  generateWorld();
  spawnPlayer();
  rebuildMeshes();
  select(0);
  updateCamera();
  queueSave();
}

function queueSave() {
  if (!canSave()) return;
  const now = Date.now();
  if (now - lastManualSave > 3000) { lastManualSave = now; saveToFile(); }
}

function enterGame() {
  started = true;
  updateAutosaveEl();
  renderer.domElement.requestPointerLock();
}

setInterval(() => { if (canSave() && started) saveToFile(); }, 10000);
addEventListener("pagehide", () => { if (canSave()) saveToFile({ keepalive: true }); });
document.addEventListener("visibilitychange", () => { if (document.hidden && canSave()) saveToFile({ keepalive: true }); });

// ---------------------------------------------------------------------------
// UI / hotbar
// ---------------------------------------------------------------------------
const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, WATER, TNT, PORTAL];
let selected = 0;
const hotbarEl = document.getElementById("hotbar");

function iconSrc(id) {
  const texs = materialsFor(id);
  const map = texs[0].map;
  return map.image.toDataURL();
}
function buildHotbar() {
  hotbarEl.innerHTML = "";
  HOTBAR.forEach((id, i) => {
    const slot = document.createElement("div");
    slot.className = "slot" + (i === selected ? " selected" : "");
    const img = document.createElement("img");
    img.src = iconSrc(id);
    slot.appendChild(img);
    slot.addEventListener("click", () => select(i));
    hotbarEl.appendChild(slot);
  });
}
function select(i) {
  selected = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  [...hotbarEl.children].forEach((c, j) => c.classList.toggle("selected", j === selected));
}
document.addEventListener("wheel", (e) => select(selected + (e.deltaY > 0 ? -1 : 1)), { passive: true });

// ---------------------------------------------------------------------------
// Input / pointer lock
// ---------------------------------------------------------------------------
const overlay = document.getElementById("overlay");
const crosshair = document.getElementById("crosshair");
const info = document.getElementById("info");
const resumeBtn = document.getElementById("btnResume");

overlay.addEventListener("click", () => {
  if (!started) return;
  renderer.domElement.requestPointerLock();
});
resumeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (started) renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener("click", () => {
  if (started && !locked && !helpOpen) renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  const wasLocked = locked;
  locked = document.pointerLockElement === renderer.domElement;
  if (suppressMenu) { suppressMenu = false; return; }
  if (helpOpen) return;
  if (!locked && Date.now() - helpCloseTime < 2000) return;
  if (wasLocked && !locked && started) saveToFile();
  overlay.style.display = locked ? "none" : "flex";
  crosshair.style.display = locked ? "block" : "none";
  hotbarEl.style.display = locked ? "flex" : "none";
  info.style.display = locked ? "block" : "none";
  resumeBtn.style.display = (!locked && started) ? "block" : "none";
});

document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});

document.addEventListener("mousedown", (e) => {
  if (!locked || helpOpen) return;
  if (e.button === 0) placeBlock(HOTBAR[selected]);
  if (e.button === 1) { e.preventDefault(); fireGrapple(); }
  if (e.button === 2) breakBlock();
});
document.addEventListener("mouseup", (e) => {
  if (e.button !== 1) return;
  if (grappleActive) {
    if (grappleHooked) {
      const dx = grappleTarget.x - grappleStart.x, dy = grappleTarget.y - grappleStart.y, dz = grappleTarget.z - grappleStart.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      vel.set((dx / dist) * GRAPPLE_FLING, (dy / dist) * GRAPPLE_FLING, (dz / dist) * GRAPPLE_FLING);
    }
    flingActive = true;
    grappleActive = false;
  }
});

const helpEl = document.getElementById("help");
let helpOpen = false;
let suppressMenu = false;
let helpCloseTime = 0;
function openHelp() {
  helpOpen = true;
  helpEl.style.display = "flex";
  if (document.pointerLockElement === renderer.domElement) {
    suppressMenu = true;
    document.exitPointerLock();
  }
}
function closeHelp() {
  helpOpen = false;
  helpEl.style.display = "none";
}
function closeHelpAndResume() {
  closeHelp();
  helpCloseTime = Date.now();
  if (!started) return;
  const tryLock = (attempt) => {
    if (document.pointerLockElement === renderer.domElement) return;
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => { if (attempt < 5) setTimeout(() => tryLock(attempt + 1), 400); });
  };
  tryLock(0);
}
helpEl.addEventListener("click", (e) => { if (e.target === helpEl) closeHelpAndResume(); });
helpEl.querySelector("#btnHelpClose").addEventListener("click", closeHelpAndResume);

document.addEventListener("keydown", (e) => {
  if (helpOpen) {
    if (e.code === "Escape") { closeHelpAndResume(); e.preventDefault(); }
    return;
  }
  if (e.code === "KeyH" && !keys[e.code]) { openHelp(); e.preventDefault(); return; }
  if (keys[e.code]) { e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === "KeyF" && dim !== "end") { freeCam = !freeCam; if (freeCam) camPos.copy(camera.position); else exitFreeCam(); }
  if (e.code === "Escape") { if (saveName) saveToFile(); }
  if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.getElementById("btnNew").addEventListener("click", async (e) => {
  e.stopPropagation();
  apiOk = await apiOkPromise;
  if (apiOk) {
    const name = await askName("New World", "world");
    if (!name) return;
    const existing = await apiList();
    if (existing.some((w) => w.name === name) && !confirm("Overwrite existing save '" + name.replace(/\.sav$/i, "") + "'?")) return;
    saveName = name;
    resetDims();
    seed = Math.floor(Math.random() * 100000);
    generateWorld();
    spawnPlayer();
    rebuildMeshes();
    select(0);
    updateCamera();
    enterGame();
    await saveToFile();
    return;
  }
  if (fileMode) await pickSaveFile();
  resetDims();
  seed = Math.floor(Math.random() * 100000);
  generateWorld();
  spawnPlayer();
  rebuildMeshes();
  select(0);
  updateCamera();
  enterGame();
});
document.getElementById("btnLoad").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (await loadSave()) enterGame();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (freeCam) {
    updateFreeCam(dt);
    camera.position.copy(camPos);
  } else {
    updatePlayer(dt);
    camera.position.set(pos.x, pos.y + EYE, pos.z);
    if (pos.y < -20) { vel.set(0, 0, 0); spawnPlayer(); }
  }
  camera.rotation.set(pitch, yaw, 0);
  updateTarget();
  if (grappleActive) {
    grappleCubes.visible = true;
    grappleHead.visible = true;
    ropeA.set(pos.x, pos.y + 0.3, pos.z);
    ropeB.copy(grappleStart).lerp(grappleTarget, grappleFly);
    if (grappleHooked) ropeB.copy(grappleTarget);
    const dx = ropeB.x - ropeA.x, dy = ropeB.y - ropeA.y, dz = ropeB.z - ropeA.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const n = Math.max(4, Math.min(GRAPPLE_CUBES, Math.round(dist / 0.15)));
    grappleCubes.count = n;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;
    let vx = Math.abs(uy) < 0.99 ? uz : 1, vy = Math.abs(uy) < 0.99 ? 0 : 0, vz = Math.abs(uy) < 0.99 ? -ux : 0;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const ax = Math.sin(f * Math.PI * 4), ay = Math.sin(f * Math.PI * 2);
      grappleCubeMatrix.setPosition(
        ropeA.x + dx * f + vx * ax * 0.15 + wx * ay * 0.15,
        ropeA.y + dy * f + vy * ax * 0.15 + wy * ay * 0.15,
        ropeA.z + dz * f + vz * ax * 0.15 + wz * ay * 0.15
      );
      grappleCubes.setMatrixAt(i, grappleCubeMatrix);
    }
    grappleCubes.instanceMatrix.needsUpdate = true;
    grappleHead.position.copy(ropeB);
  } else if (grappleCubes.visible) {
    grappleCubes.visible = false;
    grappleHead.visible = false;
  }
  tickTNT(dt);
  tickEffects(dt);
  if (portalCd > 0) portalCd -= dt;
  updatePortalVisual();
  checkPortal();
  if (dim === "end") updateDragon(dt);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }

  // Gentle water shimmer
  if (typeMats.has(WATER)) {
    const o = 0.55 + 0.1 * Math.sin(now * 0.002);
    for (const m of typeMats.get(WATER)) m.opacity = o;
  }

  const pcx = chunkOf(freeCam ? camPos.x : pos.x);
  const pcz = chunkOf(freeCam ? camPos.z : pos.z);
  if (pcx !== meshCx || pcz !== meshCz) streamChunks();

  renderer.render(scene, camera);
}

const SVGNS = "http://www.w3.org/2000/svg";
let dt = 0.016;
buildHotbar();
buildPortalArt();
requestAnimationFrame(loop);

function buildPortalArt() {
  const host = document.getElementById("portalArt");
  if (!host) return;
  const N = 5, cell = 19, size = 15, off = 6;
  const w = off * 2 + (N - 1) * cell + size;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${w}`);
  svg.setAttribute("width", "150");
  svg.setAttribute("height", "150");
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const isCorner = (r === 0 && c === 0) || (r === 0 && c === N - 1) || (r === N - 1 && c === 0) || (r === N - 1 && c === N - 1);
      const isEdge = r === 0 || r === N - 1 || c === 0 || c === N - 1;
      if (!isEdge || isCorner) continue;
      const x = off + c * cell, y = off + r * cell;
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", size); rect.setAttribute("height", size); rect.setAttribute("rx", 3);
      rect.setAttribute("fill", "#5a2da6");
      rect.setAttribute("stroke", "#7b2ff7"); rect.setAttribute("stroke-width", "1.5");
      svg.appendChild(rect);
    }
  host.appendChild(svg);
}
