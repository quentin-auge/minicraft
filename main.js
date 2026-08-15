import * as THREE from "three";

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, WATER = 7, PLANKS = 8, GLASS = 9, TNT = 10, FLOWER = 11, PORTAL = 12, ENDSTONE = 13, CLOUD = 14, OBSIDIAN = 15, LAVA = 16, NETHERRACK = 17, SOULSAND = 18, GLOWSTONE = 20;

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
  [FLOWER]:  { name: "Flower",   solid: false, opaque: false, placeable: true },
[PORTAL]:  { name: "Portal",    solid: true,  opaque: false, placeable: true },
  [ENDSTONE]:{ name: "End Stone",solid: true,  opaque: true,  placeable: false },
  [CLOUD]:   { name: "Cloud",    solid: true,  opaque: true,  placeable: false },
  [OBSIDIAN]:{ name: "Obsidian", solid: true,  opaque: true,  placeable: true },
  [LAVA]:{ name: "Lava", solid: false, opaque: false, placeable: true },
  [NETHERRACK]:{ name: "Netherrack", solid: true, opaque: true, placeable: true },
  [SOULSAND]:  { name: "Soul Sand",   solid: true, opaque: true, placeable: false },
  [GLOWSTONE]:{ name: "Glowstone",  solid: true, opaque: true, placeable: true },
};

// Glowstone comes in six colours (green, red, blue, yellow, purple,
// turquoise). Each
// palette drives both the block texture and the colour of the light the stone
// casts. The block texture is lifted brighter on purpose (it is drawn unlit,
// so a brighter texture reads as a brighter block); each colour is lifted only
// along its dominant channels so the hue stays pure instead of washing out
// toward white (a pure red stays a vivid red, not pink). Green already pops
// against the grey Nether, so its lift is half the others'; blue and turquoise
// are drawn as-is (`flat`) instead, with hand-picked saturated colours. The
// projected light (glow) is never brightened. Placed stones cluster: a block
// placed within 10 blocks of an existing one inherits its colour, otherwise
// random.
const GLOW_LIFT = 0.8;   // another 2x: all glowstones shine 4x brighter
const GLOW_RAW = [
  { base: [14, 92, 28],  bright: [61, 255, 122], glow: 0x3dff7a, lift: GLOW_LIFT * 0.5 },           // green
  { base: [92, 16, 32],  bright: [255, 61, 92],  glow: 0xff3d5c, lift: GLOW_LIFT },                 // red
  { base: [40, 80, 255], bright: [140, 200, 255], glow: 0x3d8aff, flat: true },          // blue: vivid royal blue, drawn as-is (reworked from scratch)
  { base: [92, 74, 14],  bright: [255, 229, 61], glow: 0xffe53d, lift: GLOW_LIFT },                 // yellow
  { base: [92, 50, 14],  bright: [255, 150, 30], glow: 0xff9620, lift: GLOW_LIFT },                 // orange
  { base: [58, 14, 92],  bright: [178, 61, 255], glow: 0xb23dff, lift: GLOW_LIFT, thresh: 0.7 },    // purple: only blue lifts, so it stays violet not pink
  { base: [0, 190, 215], bright: [150, 250, 255], glow: 0x00cdde, flat: true },         // turquoise: vivid blue-turquoise, drawn as-is
];
const GLOW_PALETTES = GLOW_RAW.map((p) => {
  const lift = (rgb, f) => {
    const max = Math.max(...rgb);
    const thresh = max * (p.thresh ?? 0.6);   // only the dominant channels get lifted
    return rgb.map((v) => (v >= thresh ? Math.min(255, Math.round(v + (255 - v) * f)) : v));
  };
  const base = p.flat ? p.base : lift(p.base, p.lift);
  const bright = p.flat ? p.bright : lift(p.bright, p.lift);
  return {
    base: `rgb(${base[0]},${base[1]},${base[2]})`,
    noise: base,
    bright: `rgb(${bright[0]},${bright[1]},${bright[2]})`,
    dark: `rgba(${Math.round(base[0] * 0.3)},${Math.round(base[1] * 0.3)},${Math.round(base[2] * 0.3)},0.35)`,
    hi: `rgba(${Math.min(255, base[0] + 90)},${Math.min(255, base[1] + 90)},${Math.min(255, base[2] + 90)},0.9)`,
    glow: p.glow,
  };
});
const GLOW_VARIANT_COUNT = GLOW_PALETTES.length;
// Saves from the seven-colour era (orange was briefly removed) map their stored
// variant index onto the current seven: red→red, blue→blue, green→green,
// orange→orange, turquoise→turquoise, yellow→yellow, purple→purple.
const LEGACY_GLOW_MAP = [1, 2, 0, 4, 6, 3, 5];

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
function canvasTex(draw, size = 16) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
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
function drawGlowMesh(ctx, p) {
  ctx.fillStyle = p.bright; ctx.fillRect(0, 0, 16, 16);
  const border = `rgb(${(p.noise[0] * 0.75) | 0},${(p.noise[1] * 0.75) | 0},${(p.noise[2] * 0.75) | 0})`;
  ctx.strokeStyle = border; ctx.lineWidth = 0.5;
  ctx.strokeRect(0, 0, 16, 16);
}

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
  tnt_side: canvasTex((ctx) => {
    ctx.fillStyle = "#c0392b"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 16, 64, 32);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const red = y < 16 || y > 47;
      const base = red ? [192, 57, 43] : [236, 230, 208];
      const d = (Math.random() - 0.5) * (red ? 14 : 8);
      ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 32, 32);
  }, 64),
  tnt_top: canvasTex((ctx) => {
    ctx.fillStyle = "#c0392b"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [192, 57, 43], 12);
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
  cloud: canvasTex((ctx) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [255, 255, 255], 12);
    ctx.fillStyle = "rgba(150,150,160,0.28)";
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.random() * 13, Math.random() * 13, 2 + Math.random() * 2, 1 + Math.random() * 2);
  }),
  obsidian: canvasTex((ctx) => {
    ctx.fillStyle = "#12070f"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [24, 12, 20], 18);
    ctx.fillStyle = "rgba(96,58,132,0.35)";
    for (let i = 0; i < 7; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 1 + Math.random() * 2, 1 + Math.random() * 2);
    ctx.fillStyle = "rgba(24,10,26,0.9)";
    ctx.fillRect(2, 7, 2, 1); ctx.fillRect(6, 12, 1, 1); ctx.fillRect(10, 3, 2, 1); ctx.fillRect(13, 9, 1, 1);
  }),
  lava: canvasTex((ctx) => {
    ctx.fillStyle = "#1d1d5e"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [29, 29, 94], 26);
    ctx.fillStyle = "#3b3bd4";
    for (let i = 0; i < 12; i++) ctx.fillRect(Math.random() * 16, Math.random() * 16, 1, 1);
    ctx.fillStyle = "#57e0ff";
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.random() * 15, Math.random() * 15, 1, 2);
    ctx.fillStyle = "#eaf9ff";
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.random() * 15, Math.random() * 15, 1, 1);
  }),
  netherrack: canvasTex((ctx) => {
    ctx.fillStyle = "#33343a"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [48, 49, 55], 26);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let i = 0; i < 8; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 2 + Math.random() * 2, 2 + Math.random() * 2);
    ctx.fillStyle = "rgba(120,120,130,0.3)";
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.random() * 15, Math.random() * 15, 1, 1);
  }),
  soulsand: canvasTex((ctx) => {
    ctx.fillStyle = "#56575e"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [82, 83, 92], 18);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let i = 0; i < 10; i++) ctx.fillRect(Math.random() * 15, Math.random() * 15, 1, 1);
    ctx.fillStyle = "rgba(30,30,36,0.5)";
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 3, 1);
  }),
  glowstone: canvasTex((ctx) => drawGlowMesh(ctx, GLOW_PALETTES[3])),
  flower: canvasTex((ctx) => {
    const petals = ["rgb(232,30,52)", "rgb(56,106,252)", "rgb(248,188,16)", "rgb(16,204,186)", "rgb(244,132,34)", "rgb(160,80,224)", "rgb(232,30,52)", "rgb(56,106,252)"];
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "#4a9c3a"; ctx.fillRect(7, 9, 2, 6);
    ctx.fillStyle = "#4a9c3a"; ctx.fillRect(3, 12, 2, 1); ctx.fillRect(11, 13, 2, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = 8 + Math.round(Math.cos(a) * 3);
      const py = 4 + Math.round(Math.sin(a) * 3);
      ctx.fillStyle = petals[i];
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    ctx.fillStyle = "#ffd23f"; ctx.fillRect(7, 3, 2, 2);
  }),
  portal: canvasTex((ctx) => {
    ctx.fillStyle = "#3a0d6b"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#9b30ff";
    for (let y = 0; y < 16; y += 2) for (let x = ((y / 2) % 2) * 2; x < 16; x += 4) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = "#d9a6ff";
    ctx.fillRect(7, 4, 2, 8);
  }),
};
const GLOW_TEX = GLOW_PALETTES.map((p) => canvasTex((ctx) => drawGlowMesh(ctx, p)));

function material(map, opts = {}) {
  return new THREE.MeshLambertMaterial({ map, ...opts });
}
function basicMat(map, opts = {}) {
  return new THREE.MeshBasicMaterial({ map, ...opts });
}
function basicFace(map, opts = {}) {
  return [basicMat(map, opts), basicMat(map, opts), basicMat(map, opts), basicMat(map, opts), basicMat(map, opts), basicMat(map, opts)];
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
    case FLOWER: return faceTex(TEX.flower, { transparent: true });
    case TNT:   return [material(TEX.tnt_side), material(TEX.tnt_side), material(TEX.tnt_top), material(TEX.tnt_top), material(TEX.tnt_side), material(TEX.tnt_side)];
    case PORTAL: return faceTex(TEX.portal, { transparent: false, opacity: 1, side: THREE.DoubleSide });
    case ENDSTONE: return faceTex(TEX.endstone);
    case CLOUD: return faceTex(TEX.cloud);
    case OBSIDIAN: return faceTex(TEX.obsidian);
    case LAVA: return basicFace(TEX.lava, { fog: false });
    case NETHERRACK: return faceTex(TEX.netherrack);
    case SOULSAND: return faceTex(TEX.soulsand);
    case GLOWSTONE: return basicFace(TEX.glowstone, { fog: false });
    case PORTAL: return faceTex(TEX.portal);
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
const MAX_Y = 254;
const MAX_TREE_H = 50;
const CLOUD_BASE = 2 * MAX_TREE_H;
const CLOUD_LAYER = 3 * MAX_TREE_H;
const LAND_RAISE = 20.0;
const BASIN_SHORE = 1.5;
const BASIN_DEPTH = 2.2;
const RIVER_COUNT = 3;
const RIVER_STEP = 36;
const RIVER_W = 6.0;
const RIVER_BED = 8;
const TUNNEL_COUNT = 5;
const TUNNEL_STEP = 4;
const TUNNEL_DEPTH = 18;
const TUNNEL_DEPTH_VAR = 9;
const TUNNEL_RAMP = 16;
const STAIR_STEPS = 24;
const ROOM_W = 11;
const ROOM_H = 7;
const ROOMS_PER_TUNNEL = 3;
const END_PLATFORM_TOP = 20;
const END_PLATFORM_R = 24;
const END_RETURN_Z = 16;
let seed = Math.floor(Math.random() * 100000);
let endSeed = Math.floor(Math.random() * 100000);
let netherSeed = Math.floor(Math.random() * 100000);
let waterScale = 1;
let waterDepth = 1;
let basinFreq = 0.007;
let basinThresh = 0;
let basinMax = 1;
let riverPaths = [];
let tunnelPaths = [];
let forestThresh = 0.5;

// Packed integer block key so lookups allocate no strings. Unique for x,z in
// [-1024, 1023] and y in [0, 2047], nowhere near Number's safe integer range.
const KEY_OFF = 1024, KEY_MZ = 2048, KEY_MY = KEY_MZ * KEY_MZ;
function key(x, y, z) { return (x + KEY_OFF) * KEY_MY + y * KEY_MZ + (z + KEY_OFF); }
function keyXYZ(k) {
  const z = (k % KEY_MZ) - KEY_OFF;
  const t = Math.floor(k / KEY_MZ);
  const y = t % KEY_MZ;
  const x = Math.floor(t / KEY_MZ) - KEY_OFF;
  return [x, y, z];
}

const worlds = { over: new Map(), end: new Map(), nether: new Map() };
let dim = "over";
let world = worlds.over;
const getBlock = (x, y, z) => world.get(key(x, y, z)) || AIR;

const placedFlowers = new Map();

// Glowstone colour per block, kept per dimension (block keys don't include the
// dimension, and the Nether/End regenerate on every entry so their variants
// are ephemeral anyway).
const glowVariants = { over: new Map(), end: new Map(), nether: new Map() };
const worldGlowVariants = new WeakMap([
  [worlds.over, glowVariants.over],
  [worlds.end, glowVariants.end],
  [worlds.nether, glowVariants.nether],
]);

// Tracks every PORTAL/OBSIDIAN block so portal scans iterate only real frame
// blocks instead of brute-forcing an 8-block-radius box cell by cell.
const portalBlockSets = { over: new Set(), end: new Set(), nether: new Set() };
const worldPortalSets = new WeakMap([
  [worlds.over, portalBlockSets.over],
  [worlds.end, portalBlockSets.end],
  [worlds.nether, portalBlockSets.nether],
]);

// Same trick for GLOWSTONE blocks so the glowstone light clusters are derived
// from just the glowstone blocks instead of scanning the whole world map.
const glowstoneBlockSets = { over: new Set(), end: new Set(), nether: new Set() };
const worldGlowstoneSets = new WeakMap([
  [worlds.over, glowstoneBlockSets.over],
  [worlds.end, glowstoneBlockSets.end],
  [worlds.nether, glowstoneBlockSets.nether],
]);

let portalDirty = true;   // any block edit forces a portal rescan
let worldDirty = true;    // any block edit marks the world for autosave

function rebuildPortalBlocks() {
  for (const name of ["over", "end", "nether"]) {
    const set = portalBlockSets[name];
    const gs = glowstoneBlockSets[name];
    set.clear();
    gs.clear();
    for (const [k, id] of worlds[name]) {
      if (id === PORTAL || id === OBSIDIAN) set.add(k);
      if (id === GLOWSTONE) gs.add(k);
    }
  }
}

function setBlock(x, y, z, id) {
  if (y < 0 || y > MAX_Y) return;
  const k = key(x, y, z);
  const pb = worldPortalSets.get(world);
  const gs = worldGlowstoneSets.get(world);
  const gv = worldGlowVariants.get(world);
  const wasG = gs.has(k);
  if (id === AIR) {
    world.delete(k);
    pb.delete(k);
    gs.delete(k);
    gv.delete(k);
  } else {
    world.set(k, id);
    if (id === PORTAL || id === OBSIDIAN) pb.add(k); else pb.delete(k);
    if (id === GLOWSTONE) gs.add(k); else gs.delete(k);
    if (id !== GLOWSTONE) gv.delete(k);
  }
  if (id !== FLOWER) placedFlowers.delete(k);
  if (wasG !== gs.has(k)) { recomputeGlowClusters(); syncGlowLights(); }
  endMemo.dim = "";
  netherMemo.dim = "";
  portalDirty = true;
  worldDirty = true;
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
  let trunkH = 1 + Math.floor(hash2(x, z, seed + 999) * MAX_TREE_H);
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

function edgePoint(e, along, S) {
  if (e === 0) return [-S, along];
  if (e === 1) return [S, along];
  if (e === 2) return [along, -S];
  return [along, S];
}

function settleEntrance(a, b) {
  const ax = a[0], az = a[1], bx = b[0], bz = b[1];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const sx = (bx - ax) / len, sz = (bz - az) / len;
  let px = ax, pz = az;
  for (let i = 0; i < len; i++) {
    if (heightAt(Math.round(px), Math.round(pz)) > WATER_LEVEL + 1) return [px, pz];
    px += sx; pz += sz;
  }
  return [ax, az];
}

function generateTunnels() {
  tunnelPaths = [];
  const S = WORLD_RADIUS;
  for (let i = 0; i < TUNNEL_COUNT; i++) {
    const ts = seed + 8899 + i * 997;
    const e1 = Math.floor(hash2(0, 0, ts + 1) * 4);
    const e2 = (e1 + 2 + Math.floor(hash2(0, 0, ts + 2) * 3)) % 4;
    const rawA = edgePoint(e1, (hash2(0, 0, ts + 3) * 2 - 1) * S * 0.5, S);
    const rawB = edgePoint(e2, (hash2(0, 0, ts + 4) * 2 - 1) * S * 0.5, S);
    const A = settleEntrance(rawA, rawB);
    const B = settleEntrance(rawB, rawA);
    const amp = 14 + hash2(0, 0, ts + 5) * 22;
    const wave = 1 + hash2(0, 0, ts + 6) * 2;
    const phase = hash2(0, 0, ts + 7) * Math.PI * 2;
    const dx = B[0] - A[0], dz = B[1] - A[1];
    const len = Math.hypot(dx, dz);
    const px = -dz / len, pz = dx / len;
    const steps = Math.ceil(len / TUNNEL_STEP);
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const off = Math.sin(t * Math.PI * wave + phase) * amp + Math.sin(t * Math.PI * 2 + phase * 1.3) * amp * 0.3;
      let pxn = A[0] + dx * t + px * off;
      let pzn = A[1] + dz * t + pz * off;
      if (s > 0 && s < steps) {
        pxn = Math.max(-S + 8, Math.min(S - 8, pxn));
        pzn = Math.max(-S + 8, Math.min(S - 8, pzn));
      }
      pts.push([pxn, pzn]);
    }
    tunnelPaths.push(pts);
  }
}

function carveTube(cx, cy, cz, topCap) {
  const ix = Math.round(cx), iy = Math.round(cy), iz = Math.round(cz);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const y = iy + dy;
        if (y < 1 || y >= topCap) continue;
        setBlock(ix + dx, y, iz + dz, AIR);
      }
}

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

function tubeDepth(pos, total, cx, cz) {
  const u = pos / total;
  const R = Math.min(0.5, TUNNEL_RAMP / total);
  let f;
  if (u < R) f = smoothstep(u / R);
  else if (u > 1 - R) f = smoothstep((1 - u) / R);
  else f = 1;
  const full = TUNNEL_DEPTH + (fbm(cx * 0.008 + 123, cz * 0.008 + 123, seed + 4567) * 2 - 1) * TUNNEL_DEPTH_VAR;
  return Math.max(1, f * full);
}

function carveTunnels() {
  for (const pts of tunnelPaths) {
    const n = pts.length - 1;
    let totalLen = 0;
    for (let k = 0; k < n; k++) totalLen += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    let pos = 0;
    for (let k = 0; k < n; k++) {
      const ax = pts[k][0], az = pts[k][1];
      const bx = pts[k + 1][0], bz = pts[k + 1][1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(segLen / 1.6) + 1;
      for (let s = 0; s <= steps; s++) {
        const cx = ax + (bx - ax) * (s / steps);
        const cz = az + (bz - az) * (s / steps);
        const h = heightAt(Math.round(cx), Math.round(cz));
        if (h > WATER_LEVEL + 1) {
          const depth = tubeDepth(pos, totalLen, cx, cz);
          const raw = h - depth;
          const cy = depth <= 2 ? Math.max(1, raw) : Math.max(2, Math.min(h - 2, raw));
          carveTube(cx, cy, cz, depth <= 2 ? h + 1 : h);
        }
        if (s < steps) pos += segLen / steps;
      }
    }
  }
}

function carveRooms() {
  const rw = (ROOM_W - 1) / 2, rh = (ROOM_H - 1) / 2;
  for (const pts of tunnelPaths) {
    const n = pts.length - 1;
    let totalLen = 0;
    for (let k = 0; k < n; k++) totalLen += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    let placed = 0;
    for (let c = 0; c < ROOMS_PER_TUNNEL * 4 && placed < ROOMS_PER_TUNNEL; c++) {
      const u = 0.15 + 0.7 * ((c + 0.5) / (ROOMS_PER_TUNNEL * 4));
      const target = u * totalLen;
      let pos = 0, cx = 0, cz = 0;
      for (let k = 0; k < n; k++) {
        const ax = pts[k][0], az = pts[k][1];
        const bx = pts[k + 1][0], bz = pts[k + 1][1];
        const segLen = Math.hypot(bx - ax, bz - az);
        if (pos + segLen >= target || k === n - 1) {
          const t = Math.min(1, (target - pos) / segLen);
          cx = ax + (bx - ax) * t;
          cz = az + (bz - az) * t;
          break;
        }
        pos += segLen;
      }
      const h = heightAt(Math.round(cx), Math.round(cz));
      if (h <= WATER_LEVEL + 1) continue;
      const cy = Math.max(rh + 1, Math.min(h - rh - 1, h - tubeDepth(target, totalLen, cx, cz)));
      const iy = Math.round(cy);
      const ix = Math.round(cx), iz = Math.round(cz);
      for (let dx = -rw; dx <= rw; dx++)
        for (let dz = -rw; dz <= rw; dz++)
          for (let dy = -rh; dy <= rh; dy++) {
            if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
            const y = iy + dy;
            if (y < 1 || y >= h) continue;
            setBlock(ix + dx, y, iz + dz, AIR);
          }
      placed++;
    }
  }
}

function stairEntrances() {
  const flights = [];
  for (const pts of tunnelPaths) {
    const n = pts.length - 1;
    let totalLen = 0;
    for (let k = 0; k < n; k++) totalLen += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    const arcLen = (a, b) => {
      let s = 0;
      for (let k = a; k < b; k++) s += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      return s;
    };
    for (const dir of [0, pts.length - 1]) {
      let pi = dir, walked = 0;
      while (pi >= 0 && pi < pts.length && walked < pts.length) {
        if (heightAt(Math.round(pts[pi][0]), Math.round(pts[pi][1])) > WATER_LEVEL + 1) break;
        pi += dir === 0 ? 1 : -1;
        walked++;
      }
      if (pi < 0 || pi >= pts.length) continue;
      const ax = pts[pi][0], az = pts[pi][1];
      if (Math.abs(ax) > WORLD_RADIUS || Math.abs(az) > WORLD_RADIUS) continue;
      const nx = Math.max(0, Math.min(pts.length - 1, dir === 0 ? pi + 1 : pi - 1));
      const bx = pts[nx][0], bz = pts[nx][1];
      const dLen = Math.hypot(bx - ax, bz - az);
      if (dLen < 0.5) continue;
      const dx = (bx - ax) / dLen, dz = (bz - az) / dLen;
      const mx = -dz, mz = dx;
      const pos0 = dir === 0 ? arcLen(0, pi) : totalLen - arcLen(pi, n);
      const cells = [];
      let prevFloor = null, prevCell = null, prevH = null;
      const used = new Set();
      for (let k = 0; k <= STAIR_STEPS; k++) {
        const cx = Math.round(ax + dx * k);
        const cz = Math.round(az + dz * k);
        if (prevCell && cx === prevCell[0] && cz === prevCell[1]) continue;
        prevCell = [cx, cz];
        const h = heightAt(cx, cz);
        if (h <= WATER_LEVEL + 1) break;
        if (prevH !== null && h - prevH > 4) break;
        prevH = h;
        const pos = dir === 0 ? pos0 + k : pos0 - k;
        const depth = tubeDepth(Math.max(0, Math.min(pos, totalLen)), totalLen, cx, cz);
        let floor = Math.max(1, Math.round(h - depth - 1));
        if (prevFloor !== null) {
          floor = Math.max(floor, prevFloor - 1);
          if (floor > prevFloor) floor = prevFloor;
        }
        prevFloor = floor;
        for (let w = -1; w <= 1; w++) {
          const wx = cx + Math.round(mx * w);
          const wz = cz + Math.round(mz * w);
          if (used.has(wx + "," + wz)) continue;
          used.add(wx + "," + wz);
          cells.push({ x: wx, z: wz, h, floor });
        }
      }
      flights.push(cells);
    }
  }
  for (const cells of flights)
    for (const c of cells)
      for (let y = c.h; y > c.floor; y--) setBlock(c.x, y, c.z, AIR);
  for (const cells of flights)
    for (const c of cells) setBlock(c.x, c.floor, c.z, PLANKS);
}

function generateWorld() {
  world = worlds.over;
  worlds.over.clear();
  portalBlockSets.over.clear();
  glowstoneBlockSets.over.clear();
  glowVariants.over.clear();
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
  generateTunnels();
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
  carveTunnels();
  carveRooms();
  stairEntrances();
  generateClouds();
}

// Scatter solid white clouds you can climb on, made of a few overlapping 3D
// ellipsoid puffs so they look like real fluffy cloud clusters. Each cloud
// picks a height on its own; some (~30%) are scaled up to 2x. The band starts
// at 2x max tree height and extends 3x max tree height beyond it.
function generateClouds() {
  const n = Math.round(((WORLD_RADIUS * 2) * (WORLD_RADIUS * 2)) / 1100);
  for (let i = 0; i < n; i++) {
    const cx = Math.round((hash2(i, 1, seed + 4242) * 2 - 1) * (WORLD_RADIUS - 8));
    const cz = Math.round((hash2(i, 2, seed + 4242) * 2 - 1) * (WORLD_RADIUS - 8));
    const scale = hash2(i, 8, seed + 4242) < 0.3 ? 2 : 1;
    const yBase = CLOUD_BASE + Math.floor(hash2(i, 5, seed + 4242) * (CLOUD_LAYER - 8));
    const puffs = 3 + Math.floor(hash2(i, 7, seed + 4242) * 3);
    const spread = (1.5 + hash2(i, 3, seed + 4242) * 4) * scale;
    for (let p = 0; p < puffs; p++) {
      const ox = (hash2(i, p, 111) * 2 - 1) * spread;
      const oz = (hash2(i, p, 222) * 2 - 1) * spread;
      const oy = (hash2(i, p, 333) - 0.5) * spread * 0.5;
      const Px = cx + Math.round(ox);
      const Pz = cz + Math.round(oz);
      const Py = yBase + Math.round(oy);
      const ra = 1 + Math.round((1.5 + hash2(i, p, 444) * 3) * scale);
      const rb = 1 + Math.round((1.5 + hash2(i, p, 555) * 2.5) * scale);
      const rh = 1 + Math.round((hash2(i, p, 666) * 2.5) * scale);
      const mx = Math.ceil(ra), mz = Math.ceil(rb), my = Math.ceil(rh);
      for (let dx = -mx; dx <= mx; dx++)
        for (let dz = -mz; dz <= mz; dz++)
          for (let dy = -my; dy <= my; dy++) {
            if (dx * dx / (ra * ra) + dz * dz / (rb * rb) + dy * dy / (rh * rh) > 1) continue;
            const yy = Py + dy;
            if (yy < 0 || yy > MAX_Y) continue;
            setBlock(Px + dx, yy, Pz + dz, CLOUD);
          }
    }
  }
}

function generateEnd() {
  const w = worlds.end;
  w.clear();
  portalBlockSets.end.clear();
  glowstoneBlockSets.end.clear();
  glowVariants.end.clear();
  const R = END_PLATFORM_R;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++)
      for (let y = END_PLATFORM_TOP - 2; y <= END_PLATFORM_TOP; y++) w.set(key(x, y, z), ENDSTONE);
}

// ---------------------------------------------------------------------------
// The Nether: a hostile lava dimension under a dark grey sky.
// Immense fire-spewing volcanoes rise out of a glowing lava sea; winding
// canyons cut down to the fire, and lava streaks pour down the faces of
// cliffs that drop into the sea.
// ---------------------------------------------------------------------------
const NETHER_FIRE_LEVEL = 12;
const NETHER_RIVER_COUNT = 4;
let netherRiverPaths = [];
let volcanoes = [];

// Great lava lake terrain: the Nether floor sits under the fire line almost
// everywhere, so the lava sea reads as one huge lake; two scales of island
// noise plus relief raise small, medium and large blobs above the fire.
function netherLandHeight(x, z) {
  const q = fbm(x * 0.0065, z * 0.0065, netherSeed + 311);
  const q2 = fbm(x * 0.013, z * 0.013, netherSeed + 317);
  const rel = (fbm(x * 0.03, z * 0.03, netherSeed + 313) - 0.5) * 18;
  let h = Math.floor(NETHER_FIRE_LEVEL - 4 + (q - 0.42) * 32 + (q2 - 0.5) * 26 + rel);
  return Math.max(1, Math.min(96, h));
}

function generateVolcanoes() {
  volcanoes = [];
  const S = WORLD_RADIUS;
  const count = 2;   // exactly two volcanos per Nether map
  const dir0 = hash2(0, 0, netherSeed + 911) * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const radius = 70 + Math.floor(hash2(i, 2, netherSeed + 913) * 16);
    const minDist = radius + 6;
    const maxDist = Math.min(S - 2, Math.max(minDist + 4, S - 6));
    // Second volcano sits on the opposite side of the map so the two cones are
    // always clearly distinct instead of drifting together and merging.
    const ang = i === 1 ? dir0 + Math.PI : dir0;
    const rad = minDist + hash2(i, 1, netherSeed + 912) * (maxDist - minDist);
    let vx = Math.round(Math.cos(ang) * rad);
    let vz = Math.round(Math.sin(ang) * rad);
    if (vx < -S + radius) vx = -S + radius;
    if (vx > S - radius) vx = S - radius;
    if (vz < -S + radius) vz = -S + radius;
    if (vz > S - radius) vz = S - radius;
    // Keep the cone's near edge clear of the spawn pad no matter what.
    const dd = Math.hypot(vx, vz);
    if (dd < radius + 6) {
      const a = Math.atan2(vz, vx);
      vx = Math.round(Math.cos(a) * (radius + 6));
      vz = Math.round(Math.sin(a) * (radius + 6));
    }
    const peak = 260 + Math.floor(hash2(i, 3, netherSeed + 914) * 24);
    const craterR = 5 + Math.floor(hash2(i, 4, netherSeed + 915) * 5);
    const craterDepth = 14 + Math.floor(hash2(i, 5, netherSeed + 916) * 14);
    const toCentre = Math.atan2(-vz, -vx);                        // towards the platform interior
    const flowAng = toCentre + (hash2(i, 6, netherSeed + 917) - 0.5) * 1.4;
    const flowAng2 = toCentre + 0.55 + hash2(i, 7, netherSeed + 918) * 0.5;
    const baseY = Math.max(NETHER_FIRE_LEVEL, Math.min(96, Math.floor(netherLandHeight(vx, vz))));
    volcanoes.push({ x: vx, z: vz, radius, peak, rim: peak * 0.85, craterR, craterDepth, flowAng, flowAng2, baseY });
  }
}

function volcanoHeightAt(v, x, z) {
  const d = Math.hypot(x - v.x, z - v.z);
  if (d >= v.radius) return null;
  const t = 1 - d / v.radius;
  const slope = Math.pow(t, 1.2);
  const rimT = Math.max(0.001, 1 - v.craterR / v.radius);
  const rimSlope = Math.pow(rimT, 1.2);
  if (d <= v.craterR) {
    // Flat plateau with a fire bowl cut into its centre.
    let h = v.rim;
    const k = 1 - d / v.craterR;
    h -= v.craterDepth * k * k;
    return h;
  }
  // Rocky cone slope rising from the terrain to the rim.
  const ridge = 0.9 + 0.2 * (fbm(x * 0.07 + 40, z * 0.07 + 40, netherSeed + 921) - 0.5);
  return v.rim * (slope / rimSlope) * ridge;
}

function fillVolcanoCraters() {
  const w = worlds.nether;
  for (const v of volcanoes) {
    const top = Math.round(v.rim);
    for (let dx = -v.craterR; dx <= v.craterR; dx++)
      for (let dz = -v.craterR; dz <= v.craterR; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > v.craterR) continue;
        const floor = Math.max(1, Math.round(volcanoHeightAt(v, v.x + dx, v.z + dz)));
        for (let y = floor; y <= top; y++) w.set(key(v.x + dx, y, v.z + dz), LAVA);
      }
  }
}

function fillVolcanoShafts() {
  const w = worlds.nether;
  for (const v of volcanoes) {
    const top = Math.round(v.rim);
    for (let dx = -v.craterR; dx <= v.craterR; dx++)
      for (let dz = -v.craterR; dz <= v.craterR; dz++) {
        if (Math.hypot(dx, dz) > v.craterR) continue;
        for (let y = v.baseY; y <= top; y++) w.set(key(v.x + dx, y, v.z + dz), LAVA);
      }
  }
}

// Twelve straight 4x4 tunnels per volcano, one per heading spread across the
// vertical faces of the cone that overlook the platform's interior (towards the
// map centre), never the exterior — at twelve different heights (interleaved so
// neighbouring tunnels are never at the same level). Each runs dead-straight
// from a mouth on the flank in to the central lava shaft. The surface is
// flattened into a level apron at each mouth and every entrance is closed with
// a strict 6x6 glowstone square ring around the 4x4 opening. Tunnels carve rock
// only, so the lava cascades pouring past the mouths are never interrupted.
function volcanoTunnels() {
  const w = worlds.nether;
  const S = WORLD_RADIUS;
  const TUNNELS = 12;
  for (const v of volcanoes) {
    const hLo = v.baseY + 6;
    const hHi = v.rim * 0.8;
    const hRange = hHi - hLo;
    const minD = v.craterR + 1;
    const toCentre = Math.atan2(-v.z, -v.x);   // direction facing the platform interior
    for (let k = 0; k < TUNNELS; k++) {
      const dir = toCentre - Math.PI / 2 + ((k + 0.5) * Math.PI) / TUNNELS;
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const mx = Math.cos(dir + Math.PI / 2), mz = Math.sin(dir + Math.PI / 2);
      const frac = ((k * 7) % TUNNELS) / TUNNELS;
      const hT = hLo + hRange * frac;
      const plat = Math.round(hT) - 4;    // apron level / frame bottom
      // Mouth plane: outermost point on this heading whose flank clears the
      // top of the doorway so the bore stays buried in rock.
      let dOut = v.radius - 1;
      for (let d = v.radius - 1; d >= minD; d--) {
        const vh = volcanoHeightAt(v, v.x + Math.round(dx * d), v.z + Math.round(dz * d));
        if (vh != null && vh >= hT + 5) { dOut = d; break; }
      }
      // 4x4 bore from the lava shaft out to the mouth plane.
      for (let d = minD; d <= dOut; d++) {
        const px = dx * d, pz = dz * d;
        for (let off = -2; off <= 1; off++) {
          const wx = v.x + Math.round(px + mx * off);
          const wz = v.z + Math.round(pz + mz * off);
          if (wx < -S || wx > S || wz < -S || wz > S) continue;
          for (let y = plat + 1; y <= plat + 4; y++) {
            const cur = getBlock(wx, y, wz);
            if (cur === NETHERRACK || cur === SOULSAND) w.set(key(wx, y, wz), AIR);
          }
        }
      }
      // Flatten the volcano surface into a level apron in front of the mouth.
      for (let d = dOut + 1; d <= dOut + 8; d++) {
        const px = dx * d, pz = dz * d;
        for (let off = -8; off <= 8; off++) {
          const wx = v.x + Math.round(px + mx * off);
          const wz = v.z + Math.round(pz + mz * off);
          if (wx < -S || wx > S || wz < -S || wz > S) continue;
          for (let y = plat + 1; y <= plat + 6; y++) {
            const cur = getBlock(wx, y, wz);
            if (cur === NETHERRACK || cur === SOULSAND) w.set(key(wx, y, wz), AIR);
          }
        }
      }
      // Strict 6x6 glowstone square ring (1 thick) around the 4x4 opening.
      // Each ring is one colour so every tunnel mouth glows a single hue.
      const doorV = Math.floor(Math.random() * GLOW_VARIANT_COUNT);
      const pX = v.x + Math.round(dx * dOut);
      const pZ = v.z + Math.round(dz * dOut);
      const frame = (off, yy) => {
        const wx = pX + Math.round(mx * off);
        const wz = pZ + Math.round(mz * off);
        if (wx < -S || wx > S || wz < -S || wz > S) return;
        if (getBlock(wx, yy, wz) === LAVA) return;
        const k = key(wx, yy, wz);
        w.set(k, GLOWSTONE);
        glowstoneBlockSets.nether.add(k);
        glowVariants.nether.set(k, doorV);
      };
      for (let off = -3; off <= 2; off++) { frame(off, plat); frame(off, plat + 5); }
      for (let yy = plat; yy <= plat + 5; yy++) { frame(-3, yy); frame(2, yy); }
    }
  }
}

// Big top-to-bottom lava flows down the interior-facing faces of each volcano:
// a broad main coulee and a narrower side coulee spill out of the crater rim on
// the side that overlooks the platform interior and run the whole way to the
// very base without interruption, thickest right at the top where they burst
// out and tapering as they spread downhill into wide tongues. Carved straight
// off the volcano surface, so they keep flowing over the tunnel mouths. Past
// the cone's foot each course keeps cutting a narrow trench across any island
// in its way until it reaches the great lava lake, so the fires pour into it.
function volcanoCascades() {
  const w = worlds.nether;
  const S = WORLD_RADIUS;
  const courses = (v) => [
    { ang: v.flowAng, half: 0.17, foot: v.radius, mx: 6 },
    { ang: v.flowAng2, half: 0.09, foot: v.radius, mx: 4 },
  ];
  for (const v of volcanoes) {
    for (const course of courses(v)) {
      const x0 = Math.max(-S, v.x - Math.ceil(v.radius) - 1);
      const x1 = Math.min(S, v.x + Math.ceil(v.radius) + 1);
      const z0 = Math.max(-S, v.z - Math.ceil(v.radius) - 1);
      const z1 = Math.min(S, v.z + Math.ceil(v.radius) + 1);
      const len = course.foot - v.craterR + 2;
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const h = volcanoHeightAt(v, x, z);
          if (h == null) continue;
          const dx = x - v.x, dz = z - v.z;
          const d = Math.hypot(dx, dz);
          if (d < v.craterR - 1 || d > course.foot) continue;
          let a = Math.atan2(dz, dx) - course.ang;
          while (a > Math.PI) a -= Math.PI * 2;
          while (a < -Math.PI) a += Math.PI * 2;
          if (Math.abs(a) > course.half) continue;
          const hy = Math.round(h);
          if (hy < 1) continue;
          const t = (d - (v.craterR - 1)) / len;
          let thick = 2 + Math.round(course.mx * (1 - t));
          if (hash2(x, z, 88 + course.mx) < 0.16) thick += 2;
          if (thick > 9) thick = 9;
          for (let y = hy; y > hy - thick; y--) {
            if (y < 1) continue;
            w.set(key(x, y, z), LAVA);
          }
        }
      }
      // Extend the course beyond the cone's foot towards the lake: cut a
      // tapering trench through any island in the way, down to fire level, and
      // flood it, so the coulee keeps flowing all the way to the lava lake.
      const cdx = Math.cos(course.ang), cdz = Math.sin(course.ang);
      const cmx = Math.cos(course.ang + Math.PI / 2), cmz = Math.sin(course.ang + Math.PI / 2);
      for (let d = v.radius + 1; d <= v.radius + 60; d++) {
        const hc = netherLandHeight(v.x + Math.round(cdx * d), v.z + Math.round(cdz * d));
        if (hc <= NETHER_FIRE_LEVEL) break;   // reached the lake
        const wd = Math.max(1, Math.round((course.mx - 2) * Math.max(0.25, 1 - (d - v.radius) / 60)));
        for (let off = -wd; off <= wd; off++) {
          const wx = v.x + Math.round(cdx * d + cmx * off);
          const wz = v.z + Math.round(cdz * d + cmz * off);
          if (wx < -S || wx > S || wz < -S || wz > S) continue;
          const hi = netherLandHeight(wx, wz);
          if (hi <= NETHER_FIRE_LEVEL) continue;
          for (let y = NETHER_FIRE_LEVEL + 1; y <= hi; y++) {
            const cur = getBlock(wx, y, wz);
            if (cur === NETHERRACK || cur === SOULSAND || cur === GLOWSTONE) w.set(key(wx, y, wz), AIR);
          }
          w.set(key(wx, NETHER_FIRE_LEVEL, wz), LAVA);
        }
      }
    }
  }
}

function generateNetherRivers() {
  netherRiverPaths = [];
  const S = WORLD_RADIUS;
  for (let i = 0; i < NETHER_RIVER_COUNT; i++) {
    const rs = netherSeed + 555 + i * 101;
    const edge = Math.floor(hash2(0, 0, rs + 1) * 4);
    const along = (hash2(0, 0, rs + 2) * 2 - 1) * S * 0.6;
    let x, z, head;
    if (edge === 0) { x = -S; z = along; head = 0; }
    else if (edge === 1) { x = S; z = along; head = Math.PI; }
    else if (edge === 2) { x = along; z = -S; head = Math.PI / 2; }
    else { x = along; z = S; head = -Math.PI / 2; }
    const wobA = 0.5 + hash2(0, 0, rs + 3) * 0.4;
    const wobF = 0.1 + hash2(0, 0, rs + 4) * 0.06;
    const phase = hash2(0, 0, rs + 5) * Math.PI * 2;
    const pts = [[x, z]];
    for (let n = 1; n < 80; n++) {
      head += wobA * Math.sin(n * wobF + phase);
      if (x > S * 0.6) head -= 0.12;
      if (x < -S * 0.6) head += 0.12;
      if (z > S * 0.6) head -= 0.12;
      if (z < -S * 0.6) head += 0.12;
      x += Math.cos(head) * 24;
      z += Math.sin(head) * 24;
      pts.push([x, z]);
      if (x > S + 40 || x < -S - 40 || z > S + 40 || z < -S - 40) break;
    }
    if (pts.length > 4) netherRiverPaths.push(pts);
  }
}

function nearestNetherRiver(x, z) {
  let best = null;
  for (const pts of netherRiverPaths) {
    const n = pts.length - 1;
    for (let k = 0; k < n; k++) {
      const d = distToSegment(x, z, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
      const w = 5 * (0.7 + 0.6 * (k / n));
      if (!best || d - w < best.d - best.w) best = { d, w };
    }
  }
  return best;
}

function generateNether() {
  const w = worlds.nether;
  w.clear();
  portalBlockSets.nether.clear();
  glowstoneBlockSets.nether.clear();
  glowVariants.nether.clear();
  const S = WORLD_RADIUS;
  generateNetherRivers();
  generateVolcanoes();
  const size = 2 * S + 1;
  const heights = new Float32Array(size * size);
  const idx = (x, z) => (z + S) * size + (x + S);
  for (let x = -S; x <= S; x++) {
    for (let z = -S; z <= S; z++) {
      let h = netherLandHeight(x, z);
      const rv = nearestNetherRiver(x, z);
      if (rv && rv.d <= rv.w) {
        const t = rv.d / rv.w;
        h = Math.min(h, NETHER_FIRE_LEVEL - 2 + Math.floor(t * 4));
      }
      h = Math.max(1, Math.min(96, h));
      for (const v of volcanoes) {
        const vh = volcanoHeightAt(v, x, z);
        if (vh != null) h = Math.max(h, Math.round(vh));
      }
      heights[idx(x, z)] = h;
      for (let y = 0; y <= h; y++) w.set(key(x, y, z), NETHERRACK);
      // Soul-sand shores: the top block of columns near the fire line
      // becomes dark soul sand, so the sea has a grim black beach.
      if (h >= NETHER_FIRE_LEVEL && h <= NETHER_FIRE_LEVEL + 2)
        w.set(key(x, h, z), SOULSAND);
      if (h < NETHER_FIRE_LEVEL)
        for (let y = h + 1; y <= NETHER_FIRE_LEVEL; y++) w.set(key(x, y, z), LAVA);
    }
  }
  for (let x = -S; x <= S; x++) {
    for (let z = -S; z <= S; z++) {
      const h = heights[idx(x, z)];
      if (h < NETHER_FIRE_LEVEL + 5) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < -S || nx > S || nz < -S || nz > S) continue;
        const hn = heights[idx(nx, nz)];
        if (hn > NETHER_FIRE_LEVEL) continue;
        const fall = Math.min(5, Math.round((h - NETHER_FIRE_LEVEL) * 0.45));
        for (let y = NETHER_FIRE_LEVEL + 1; y <= NETHER_FIRE_LEVEL + fall; y++)
          w.set(key(nx, y, nz), LAVA);
      }
    }
  }
  fillVolcanoCraters();
  fillVolcanoShafts();
  volcanoCascades();
  volcanoTunnels();
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 900);
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

// The Nether sky: a big back-side dome painted with a dark dusk gradient
// (deep navy-blue zenith with stars, purple band, red/orange glow at the
// horizon) plus a glowing orange sun disc, all following the camera so the
// horizon never moves. It's only visible in the Nether; the other dimensions
// keep flat background colours.
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(620, 32, 24),
  new THREE.MeshBasicMaterial({
    map: (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const ctx = c.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0.0, "#0a1230");
      g.addColorStop(0.38, "#1a1c5c");
      g.addColorStop(0.58, "#3a2a92");
      g.addColorStop(0.72, "#5a3a80");
      g.addColorStop(0.84, "#b04a4a");
      g.addColorStop(0.92, "#ff7a3a");
      g.addColorStop(1.0, "#101a38");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 110; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.6})`;
        ctx.fillRect(Math.random() * 512, Math.random() * 130, 1.5, 1.5);
      }
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  })
);
skyDome.visible = false;
scene.add(skyDome);
const netherSun = new THREE.Mesh(
  new THREE.CircleGeometry(55, 28),
  new THREE.MeshBasicMaterial({ color: 0xff8a2e, fog: false, depthWrite: false, transparent: true, opacity: 0.95 })
);
netherSun.position.set(0, 170, 500);
skyDome.add(netherSun);

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

// Blocky flowers: each FLOWER block is a cluster of 1/30-size cubes in a
// 30x30x30 grid filling exactly one block cell, geometry centered on the cell
// so it sits on the ground (base flush with the grass top). A thin green stem
// with two leaves hugging it holds a flat round 2D bloom — a vertical disc of
// petals (eight scalloped tips standing out past the rim) around a darker
// center, like a real flower face-on. Five color variants (red, green, blue,
// yellow, and multicolor quadrants) share
// per-variant geometries with baked vertex colors.
const FLOWER_STEM = [20, 66, 30];
const FLOWER_LEAF = [36, 94, 42];
const FLOWER_PETALS = [
  [232, 30, 52],
  [56, 106, 252],
  [248, 188, 16],
  [16, 204, 186],
  [252, 112, 10],
  [176, 66, 250],
];
const FLOWER_MULTI = [
  [232, 30, 52],
  [252, 112, 10],
  [248, 188, 16],
  [78, 210, 64],
  [16, 204, 186],
  [56, 106, 252],
  [176, 80, 250],
  [252, 90, 196],
];
const FLOWER_CENTERS = [
  [156, 16, 32],
  [30, 62, 180],
  [176, 124, 6],
  [8, 120, 112],
  [186, 66, 4],
  [110, 32, 176],
  [120, 84, 34],
];
const FLOWER_VARIANT_COUNT = 7;
const FLOWER_WEIGHTS = [1, 1, 1, 1, 1, 1, 2];
const FLOWER_WEIGHT_SUM = FLOWER_WEIGHTS.reduce((a, b) => a + b, 0);
const FLOWER_GRID = 30;
const FLOWER_CUBES = [];
const usedCells = new Set();
const FCELL = (cx, cy, cz, role) => {
  const k = cx + "," + cy + "," + cz;
  if (usedCells.has(k)) return;
  usedCells.add(k);
  FLOWER_CUBES.push([cx, cy, cz, role]);
};
const fc = (FLOWER_GRID - 1) / 2;
for (let cy = 0; cy < 14; cy++)
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++)
    FCELL(14 + dx, cy, 14 + dz, "stem");
for (let cx = 0; cx < FLOWER_GRID; cx++)
  for (let cz = 0; cz < FLOWER_GRID; cz++) {
    if (cx <= 15) {
      const d = Math.pow((cx - 8) / 6.5, 2) + Math.pow((cz - fc) / 3, 2);
      if (d <= 1) FCELL(cx, 11, cz, "leaf");
    }
    if (cx >= 14) {
      const d = Math.pow((cx - 21) / 6.5, 2) + Math.pow((cz - fc) / 3, 2);
      if (d <= 1) FCELL(cx, 11, cz, "leaf");
    }
  }
const FLOWER_BLOOM_R = 7;
const FLOWER_BLOOM_CY = 20.5;
const FLOWER_CORE_R = 3.4;
const FLOWER_TIP_R = 8.6;
const FLOWER_PETAL_COUNT = 8;
const FLOWER_TIP_WEDGE = 0.07;
for (let cx = 0; cx < FLOWER_GRID; cx++)
  for (let cy = 0; cy < FLOWER_GRID; cy++)
    for (const cz of [14, 15]) {
      const d = Math.hypot(cx - fc, cy - FLOWER_BLOOM_CY);
      if (d > FLOWER_TIP_R) continue;
      if (d > FLOWER_BLOOM_R) {
        const step = Math.PI / FLOWER_PETAL_COUNT;
        let w = Math.atan2(cy - FLOWER_BLOOM_CY, cx - fc) % step;
        if (w < 0) w += step;
        if (Math.min(w, step - w) > FLOWER_TIP_WEDGE) continue;
      }
      FCELL(cx, cy, cz, d <= FLOWER_CORE_R ? "center" : "petal");
    }
function flowerColorOf(variant) {
  if (variant === FLOWER_VARIANT_COUNT - 1) {
    return (role, cx, cy) => {
      if (role === "stem") return FLOWER_STEM;
      if (role === "leaf") return FLOWER_LEAF;
      if (role === "center") return FLOWER_CENTERS[FLOWER_VARIANT_COUNT - 1];
      const a = Math.atan2(cy - FLOWER_BLOOM_CY, cx - fc) + Math.PI;
      return FLOWER_MULTI[Math.floor(a / Math.PI * (FLOWER_MULTI.length / 2)) % FLOWER_MULTI.length];
    };
  }
  return (role) => {
    if (role === "stem") return FLOWER_STEM;
    if (role === "leaf") return FLOWER_LEAF;
    if (role === "center") return FLOWER_CENTERS[variant];
    return FLOWER_PETALS[variant];
  };
}
function buildCubeGeometry(grid, cubes, colorOf) {
  const h = 1 / (grid * 2);
  const faces = [
    { n: [1, 0, 0], c: [[h, -h, -h], [h, -h, h], [h, h, h], [h, h, -h]] },
    { n: [-1, 0, 0], c: [[-h, -h, h], [-h, -h, -h], [-h, h, -h], [-h, h, h]] },
    { n: [0, 1, 0], c: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], c: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] },
    { n: [0, 0, 1], c: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], c: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
  ];
  const positions = [], normals = [], colors = [], indices = [];
  for (const [cx, cy, cz, role] of cubes) {
    const [r, g, b] = colorOf(role, cx, cy, cz);
    const ox = (cx + 0.5) / grid - 0.5, oy = (cy + 0.5) / grid - 0.5, oz = (cz + 0.5) / grid - 0.5;
    for (const f of faces) {
      for (const [x, y, z] of f.c) {
        positions.push(x + ox, y + oy, z + oz);
        normals.push(f.n[0], f.n[1], f.n[2]);
        colors.push(r / 255, g / 255, b / 255);
      }
      const b0 = positions.length / 3 - 4;
      indices.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}
const FLOWER_GEOS = [];
for (let v = 0; v < FLOWER_VARIANT_COUNT; v++) FLOWER_GEOS.push(buildCubeGeometry(FLOWER_GRID, FLOWER_CUBES, flowerColorOf(v)));
const FLOWER_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// The glowstone block glows by itself — it is drawn with an unlit texture
// (`basicFace`) so it shines at full strength no matter how far
// away you stand — and it casts a steady pool of light in its own colour
// onto the terrain around it. Glowstones are merged into stable clusters (a whole volcano-door
// ring is one cluster) whose centroids are recomputed only when blocks change
// (`recomputeGlowClusters`), and a fixed pool of `PointLight`s is assigned to
// the clusters nearest the player. The assignment re-evaluates at most every
// `GLOW_LIGHT_REFRESH` seconds and only when the player crosses a chunk, and a
// light keeps its current cluster while that cluster stays among the nearest
// lit ones — so the glow never jumps between the stones of a ring, never
// flickers while you walk toward a cluster, and costs nothing in between.
const GLOW_LIGHT_RADIUS = 12;
const GLOW_LIGHT_DIST = Math.ceil(RENDER_DIST * CHUNK * Math.SQRT2);
const GLOW_LIGHT_MAX = 16;
const GLOW_LIGHT_CLUSTER = GLOW_LIGHT_RADIUS * 0.7;
const GLOW_LIGHT_REFRESH = 0.5;
let glowClusters = [];      // [{x, y, z, v}] centroid + dominant colour of each cluster
let glowLights = [];        // pooled PointLights, each { cur: clusterIdx|-1, light }
let glowLightT = 0;         // countdown until the next light re-assignment
let glowLightCx = 0, glowLightCz = 0;  // chunk the assignment was last made for

function recomputeGlowClusters() {
  const set = worldGlowstoneSets.get(world);
  const gv = worldGlowVariants.get(world);
  glowClusters = [];
  glowLightT = 0;
  glowLightCx = glowLightCz = Infinity;
  if (!set || !set.size) return;
  const groups = [];
  for (const k of set) {
    const [x, y, z] = keyXYZ(k);
    let gi = -1;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const mx = g.sx / g.n - x, my = g.sy / g.n - y, mz = g.sz / g.n - z;
      if (mx * mx + my * my + mz * mz < GLOW_LIGHT_CLUSTER * GLOW_LIGHT_CLUSTER) { gi = i; break; }
    }
    if (gi < 0) { groups.push({ n: 0, sx: 0, sy: 0, sz: 0, votes: {} }); gi = groups.length - 1; }
    const g = groups[gi];
    g.n++; g.sx += x; g.sy += y; g.sz += z;
    const v = gv.get(k);
    if (v !== undefined) g.votes[v] = (g.votes[v] || 0) + 1;
  }
  for (const g of groups) {
    let best = 0, bestN = -1;   // default to green on ties
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) {
      const n = g.votes[v] || 0;
      if (n > bestN) { bestN = n; best = v; }
    }
    glowClusters.push({ x: g.sx / g.n + 0.5, y: g.sy / g.n + 0.5, z: g.sz / g.n + 0.5, v: best });
  }
}

function syncGlowLights(dt = 0) {
  if (glowLightT > 0) glowLightT -= dt;
  const pcx = chunkOf(camera.position.x), pcz = chunkOf(camera.position.z);
  if (glowLightT > 0 || (pcx === glowLightCx && pcz === glowLightCz)) return;
  glowLightT = GLOW_LIGHT_REFRESH;
  glowLightCx = pcx;
  glowLightCz = pcz;
  if (!glowClusters.length) {
    for (const L of glowLights) if (L) { L.light.visible = false; L.cur = -1; }
    return;
  }
  const cam = camera.position;
  const ranked = [];
  for (let i = 0; i < glowClusters.length; i++) {
    const c = glowClusters[i];
    const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= GLOW_LIGHT_DIST * GLOW_LIGHT_DIST) ranked.push([d2, i]);
  }
  ranked.sort((a, b) => a[0] - b[0]);
  const want = Math.min(GLOW_LIGHT_MAX, ranked.length);
  const active = new Uint8Array(glowClusters.length);
  // First keep every light that already sits on a still-ranked cluster, so the
  // pool never hops between clusters while the player walks around.
  for (let i = 0; i < glowLights.length; i++) {
    const L = glowLights[i];
    if (!L || L.cur < 0 || L.cur >= glowClusters.length) continue;
    for (let j = 0; j < want; j++) {
      if (ranked[j][1] === L.cur) {
        active[L.cur] = 1;
        L.light.color.setHex(GLOW_PALETTES[glowClusters[L.cur].v].glow);
        break;
      }
    }
  }
  // Then hand the remaining lights to the nearest unlit clusters.
  for (let j = 0; j < want; j++) {
    const ci = ranked[j][1];
    if (active[ci]) continue;
    let slot = -1;
    for (let i = 0; i < GLOW_LIGHT_MAX; i++) {
      const L = glowLights[i];
      if (!L || L.cur < 0 || (L.cur < glowClusters.length && !active[L.cur])) { slot = i; break; }
    }
    if (slot < 0) break;
    const L = glowLights[slot] || (glowLights[slot] = makeGlowLight());
    L.cur = ci;
    L.light.color.setHex(GLOW_PALETTES[glowClusters[ci].v].glow);
    L.light.position.set(glowClusters[ci].x, glowClusters[ci].y - 0.15, glowClusters[ci].z);
    L.light.visible = true;
    active[ci] = 1;
  }
  for (let i = 0; i < glowLights.length; i++) {
    const L = glowLights[i];
    if (L && (L.cur < 0 || L.cur >= glowClusters.length || !active[L.cur])) {
      L.light.visible = false;
      L.cur = -1;
    }
  }
}
function makeGlowLight() {
  const light = new THREE.PointLight(0x3dff7a, 60, GLOW_LIGHT_RADIUS, 1);
  scene.add(light);
  return { cur: -1, light };
}
function clearGlowLights() {
  for (const L of glowLights) if (L) scene.remove(L.light);
  glowLights = [];
}
function flowerVariant(x, z) {
  let r = hash2(x, z, seed + 99999) * FLOWER_WEIGHT_SUM;
  for (let v = 0; v < FLOWER_VARIANT_COUNT; v++) {
    if (r < FLOWER_WEIGHTS[v]) return v;
    r -= FLOWER_WEIGHTS[v];
  }
  return FLOWER_VARIANT_COUNT - 1;
}
function flowerAngle(x, z) {
  return hash2(x, z, seed + 77777) * Math.PI * 2;
}
function randomFlowerVariant() {
  let r = Math.random() * FLOWER_WEIGHT_SUM;
  for (let v = 0; v < FLOWER_VARIANT_COUNT; v++) {
    if (r < FLOWER_WEIGHTS[v]) return v;
    r -= FLOWER_WEIGHTS[v];
  }
  return FLOWER_VARIANT_COUNT - 1;
}
function flowerVariantAt(x, y, z) {
  const p = placedFlowers.get(key(x, y, z));
  return p ? p.v : flowerVariant(x, z);
}
function flowerAngleAt(x, y, z) {
  const p = placedFlowers.get(key(x, y, z));
  return p ? p.a : flowerAngle(x, z);
}

// A placed glowstone inherits the colour of the nearest glowstone within 10
// blocks (so builds cluster by colour); otherwise it rolls a fresh random one.
function glowVariantNear(x, y, z) {
  const set = worldGlowstoneSets.get(world);
  const gv = worldGlowVariants.get(world);
  let best = -1, bestD = 100;
  for (const k of set) {
    const [ox, oy, oz] = keyXYZ(k);
    const dx = ox - x, dy = oy - y, dz = oz - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD) {
      const v = gv.get(k);
      if (v !== undefined) { best = v; bestD = d2; }
    }
  }
  return best >= 0 ? best : Math.floor(Math.random() * GLOW_VARIANT_COUNT);
}
function glowVariantAt(x, y, z) {
  const v = worldGlowVariants.get(world).get(key(x, y, z));
  return v === undefined ? 0 : v;   // default to green
}

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
const glowMats = new Map();   // glowstone variant -> shared material[6]
function getGlowMats(v) {
  if (!glowMats.has(v)) glowMats.set(v, basicFace(GLOW_TEX[v], { fog: false }));
  return glowMats.get(v);
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
  const flowers = [];
  const glows = [];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      for (let y = 0; y <= MAX_Y; y++) {
        const id = getBlock(x, y, z);
        if (id === AIR || !BLOCK_INFO[id]) continue;
        if (id === FLOWER) { flowers.push([x, y, z]); continue; }
        if (id === GLOWSTONE) {
          if (isExposed(x, y, z)) glows.push([x, y, z]);
          continue;
        }
        if (!isExposed(x, y, z)) continue;
        counts[id] = (counts[id] || 0) + 1;
        exposed.push([x, y, z, id]);
      }
    }
  const meshes = new Map();
  if (exposed.length) {
    for (const idStr in counts) {
      const id = +idStr;
      const n = counts[id];
      const mesh = new THREE.InstancedMesh(boxGeo, getTypeMats(id), n);
      mesh.count = n;
      let i = 0;
      for (const [x, y, z, bid] of exposed) {
        if (bid !== id) continue;
        dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      meshes.set(id, mesh);
    }
  }
  if (flowers.length) {
    const perVariant = [];
    for (let v = 0; v < FLOWER_VARIANT_COUNT; v++) perVariant.push([]);
    for (const [fx, fy, fz] of flowers) perVariant[flowerVariantAt(fx, fy, fz)].push([fx, fy, fz]);
    for (let v = 0; v < FLOWER_VARIANT_COUNT; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(FLOWER_GEOS[v], FLOWER_MAT, list.length);
      for (let i = 0; i < list.length; i++) {
        const [fx, fy, fz] = list[i];
        dummy.position.set(fx + 0.5, fy + 0.5, fz + 0.5);
        dummy.rotation.set(0, flowerAngleAt(fx, fy, fz), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      meshes.set("flower_" + v, mesh);
    }
  }
  if (glows.length) {
    const perVariant = [];
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) perVariant.push([]);
    for (const [gx, gy, gz] of glows) perVariant[glowVariantAt(gx, gy, gz)].push([gx, gy, gz]);
    for (let v = 0; v < GLOW_VARIANT_COUNT; v++) {
      const list = perVariant[v];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(boxGeo, getGlowMats(v), list.length);
      let i = 0;
      for (const [gx, gy, gz] of list) {
        dummy.position.set(gx + 0.5, gy + 0.5, gz + 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      meshes.set("glowstone_" + v, mesh);
    }
  }
  chunkMeshes.set(ck, meshes);
}

// Incremental streaming: build only missing chunks inside the window, unload
// chunks that fell outside it. Called when the player crosses a chunk border;
// the actual building is staggered across frames (drainChunkQueue) so a border
// cross never rebuilds ~17 chunks in one frame.
const chunkQueue = [];
const CHUNK_BUDGET_MS = 4;
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
  for (let i = chunkQueue.length - 1; i >= 0; i--)
    if (!keep.has(chunkQueue[i])) chunkQueue.splice(i, 1);
  const queued = new Set(chunkQueue);
  const missing = [];
  for (const ck of keep) {
    if (chunkMeshes.has(ck) || queued.has(ck)) continue;
    const [wx, wz] = ck.split("_");
    missing.push([ck, +wx, +wz]);
  }
  missing.sort((a, b) => {
    const da = (a[1] - cx) * (a[1] - cx) + (a[2] - cz) * (a[2] - cz);
    const db = (b[1] - cx) * (b[1] - cx) + (b[2] - cz) * (b[2] - cz);
    return da - db;
  });
  for (const [ck] of missing) chunkQueue.push(ck);
}

function drainChunkQueue(all) {
  if (!chunkQueue.length) return;
  const deadline = all ? Infinity : performance.now() + CHUNK_BUDGET_MS;
  while (chunkQueue.length && (all || performance.now() < deadline)) {
    const ck = chunkQueue.shift();
    if (chunkMeshes.has(ck)) continue;
    const [wx, wz] = ck.split("_");
    rebuildChunk(+wx, +wz);
  }
  if (!chunkQueue.length) {
    meshCx = chunkOf(freeCam ? camPos.x : pos.x);
    meshCz = chunkOf(freeCam ? camPos.z : pos.z);
  }
}

function rebuildMeshes() {
  for (const meshes of chunkMeshes.values()) disposeChunkMeshes(meshes);
  chunkMeshes.clear();
  chunkQueue.length = 0;
  streamChunks();
  drainChunkQueue(true);
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
const STEP_SPEED = 5.5;
const AUTO_JUMP = 7.5;
const GRAPPLE_SPEED = 26;
const GRAPPLE_THROW = 70;
const GRAPPLE_FLING = 34;
const FLOAT_SPEED = 1.8;
const SWIM_SPEED = 4.0;
const SWIM_MAX = 100 * FLOAT_SPEED;

const pos = new THREE.Vector3(0, 20, 0);
let grappleActive = false;
let grappleHooked = false;
let grappleFly = 0;
let grapplingDist = 1;
const grappleTarget = new THREE.Vector3();
const grappleStart = new THREE.Vector3();
let grappleBlock = null;
let grappleArrived = false;
let grapplePulling = false;
let grapplePass = true;
let grappleTopY = 0;
let flingActive = false;
const vel = new THREE.Vector3();
const camPos = new THREE.Vector3();
let yaw = 0, pitch = 0;
let onGround = false, flying = false, freeCam = false, locked = false;
let stepDown = false, wasOnGround = false;
let stepFromWater = false, stepHop = false;
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
  stepDown = false;
}

function isSolid(x, y, z) {
  const info = BLOCK_INFO[getBlock(x, y, z)];
  return !!info && info.solid;
}

function tryStep(bx, by, bz) {
  if (stepDown) return false;
  if (!stepFromWater) {
    if (!onGround) return false;
    if (by !== Math.floor(pos.y)) return false;
    if (isSolid(bx, by + 1, bz) || isSolid(bx, by + 2, bz)) return false;
    vel.y = AUTO_JUMP;
  } else {
    if (by !== Math.floor(pos.y) && by !== Math.floor(pos.y) + 1) return false;
    if (isSolid(bx, by + 1, bz) || isSolid(bx, by + 2, bz)) return false;
    vel.y = Math.max(AUTO_JUMP, Math.sqrt(2 * GRAVITY * Math.max(0.1, by + 1.05 - pos.y)));
    stepHop = true;
  }
  onGround = false;
  stepDown = false;
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
        tryStep(cellX, by, bz);
        pos.x = cellX - PLAYER_HW - 0.001; vel.x = 0; return;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        tryStep(cellX, by, bz);
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
        tryStep(bx, by, cellZ);
        pos.z = cellZ - PLAYER_HW - 0.001; vel.z = 0; return;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        tryStep(bx, by, cellZ);
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
      if (vel.y <= 0 && isSolid(bx, Math.floor(feet), bz)) { pos.y = Math.floor(feet) + 1 + 0.001; vel.y = 0; onGround = true; stepDown = false; flingActive = false; return; }
    }
  if (vel.y < 0 && wasOnGround && !stepDown && !flingActive) {
    const fy = Math.floor(pos.y) - 1;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !stepDown; bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
        if (isSolid(bx, fy, bz)) { stepDown = true; break; }
  }
}
function collide() {
  moveAxisY(vel.y * dt);
  moveAxisX(vel.x * dt);
  moveAxisZ(vel.z * dt);
}

function fireGrapple() {
  if (freeCam) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const b = pickBlock(camera.position, dir, true);
  if (!b) return;
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
  grappleArrived = false;
  grapplePulling = false;
  grapplePass = true;
  grappleActive = true;
  stepDown = false;
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

function isGrappleBlock(bx, by, bz) {
  return grapplePass && !!grappleBlock && bx === grappleBlock.x && bz === grappleBlock.z &&
    by >= grappleBlock.y && by <= grappleTopY;
}

function grappleMoveX(dx) {
  pos.x += dx;
  if (dx === 0) return false;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.x + PLAYER_HW : pos.x - PLAYER_HW;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (!isSolid(cellX, by, bz) || isGrappleBlock(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) { pos.x = cellX - PLAYER_HW - 0.001; return true; }
      if (dir < 0 && edge < cellX + 0.999) { pos.x = cellX + 1 + PLAYER_HW + 0.001; return true; }
    }
  return false;
}

function grappleMoveZ(dz) {
  pos.z += dz;
  if (dz === 0) return false;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.z + PLAYER_HW : pos.z - PLAYER_HW;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++) {
      if (!isSolid(bx, by, cellZ) || isGrappleBlock(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) { pos.z = cellZ - PLAYER_HW - 0.001; return true; }
      if (dir < 0 && edge < cellZ + 0.999) { pos.z = cellZ + 1 + PLAYER_HW + 0.001; return true; }
    }
  return false;
}

function grappleMoveY(dy) {
  pos.y += dy;
  if (dy === 0) return false;
  const top = pos.y + PLAYER_H, feet = pos.y;
  for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (dy > 0) {
        const by = Math.floor(top);
        if (isSolid(bx, by, bz) && !isGrappleBlock(bx, by, bz) && top > by) { pos.y = by - PLAYER_H - 0.001; return true; }
      } else {
        const by = Math.floor(feet);
        if (isSolid(bx, by, bz) && !isGrappleBlock(bx, by, bz)) { pos.y = by + 1 + 0.001; return true; }
      }
    }
  return false;
}

function updateGrapple(dt) {
  if (grappleArrived) { grapplePulling = false; return false; }
  if (!grappleHooked) {
    grappleFly += (GRAPPLE_THROW * dt) / grapplingDist;
    if (grappleFly >= 1) {
      grappleFly = 1;
      grappleHooked = true;
    }
    grapplePulling = false;
    return false;
  }
  if (grappleBlock) {
    let h = 0;
    while (isSolid(grappleBlock.x, grappleBlock.y + h + 1, grappleBlock.z)) h++;
    if (h <= 1) {
      grappleTopY = grappleBlock.y + h;
      grappleTarget.y = grappleTopY + 1.001;
    } else {
      grappleTopY = grappleBlock.y;
    }
  }
  const dx = grappleTarget.x - pos.x, dy = grappleTarget.y - pos.y, dz = grappleTarget.z - pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const step = GRAPPLE_SPEED * dt;
  grapplePass = !blockedBody(grappleTarget.x, grappleTarget.y, grappleTarget.z);
  if (dist <= step + 0.001) {
    if (!grapplePass) {
      grapplePulling = false;
      return false;
    }
    pos.copy(grappleTarget);
    vel.set(0, 0, 0);
    flingActive = false;
    onGround = true;
    grappleArrived = true;
    grapplePulling = false;
    return false;
  }
  let remaining = step;
  let blocked = false;
  while (remaining > 1e-4) {
    const cdx = grappleTarget.x - pos.x, cdy = grappleTarget.y - pos.y, cdz = grappleTarget.z - pos.z;
    const cdist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
    if (cdist <= 1e-4) break;
    const move = Math.min(remaining, 0.4, cdist);
    const s = move / cdist;
    if (grappleMoveY(cdy * s)) blocked = true;
    if (grappleMoveX(cdx * s)) blocked = true;
    if (grappleMoveZ(cdz * s)) blocked = true;
    remaining -= move;
  }
  if (blocked) {
    vel.set(0, 0, 0);
    grapplePulling = false;
    return false;
  }
  grapplePulling = true;
  return true;
}

function updatePlayer(dt) {
  if (grappleActive && updateGrapple(dt)) return;
  if (dim === "end") flying = false;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  const w = keys["KeyW"] || keys["ArrowUp"];
  const s = keys["KeyS"] || keys["ArrowDown"];
  const d = keys["KeyD"] || keys["ArrowRight"];
  const a = keys["KeyA"] || keys["ArrowLeft"];
  const sprintKey = keys["ShiftLeft"] || keys["ShiftRight"];

  if (w) move.add(fwd);
  if (s) move.sub(fwd);
  if (d) move.add(right);
  if (a) move.sub(right);

  const inWater = headInWater();

  if (flying) {
    stepDown = false;
    stepFromWater = false;
    stepHop = false;
    const speed = FLY;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x = move.x; vel.z = move.z;
    vel.y = (keys["Space"] ? speed : 0) - (sprintKey ? speed : 0);
    flingActive = false;
  } else if (inWater) {
    stepDown = false;
    stepFromWater = true;
    // Buoyancy: automatically float toward the surface, hold Space to swim up.
    // The depth bonus applies only while Space is held: +20% speed per 10 blocks
    // below the surface, capped at SWIM_MAX (100x base float speed). Releasing Space drops you back to float speed.
    const speed = 4.2;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x += (move.x - vel.x) * Math.min(1, dt * 8);
    vel.z += (move.z - vel.z) * Math.min(1, dt * 8);
    if (stepHop) {
      vel.y -= GRAVITY * dt;
      if (vel.y <= 0 || onGround) stepHop = false;
    } else {
      const surface = waterSurfaceTop();
      const depth = surface === -Infinity ? 0 : Math.max(0, surface - (pos.y + 0.3));
      const rise = Math.min(1 + 0.2 * (depth / 10), SWIM_MAX / SWIM_SPEED);
      const target = keys["Space"] ? SWIM_SPEED * rise : FLOAT_SPEED;
      if (keys["Space"]) {
        vel.y += (target - vel.y) * Math.min(1, dt * 4);
      } else if (vel.y > FLOAT_SPEED) {
        vel.y = FLOAT_SPEED;
      } else {
        vel.y += (FLOAT_SPEED - vel.y) * Math.min(1, dt * 4);
      }
    }
  } else {
    stepFromWater = false;
    stepHop = false;
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
    if (stepDown) {
      vel.y = -STEP_SPEED;
    } else {
      vel.y -= GRAVITY * dt;
    }
    if (keys["Space"] && onGround) { vel.y = JUMP; onGround = false; stepDown = false; }
    if (vel.y < -40) vel.y = -40;
  }
  wasOnGround = onGround;
  collide();
}

// Free camera (spectator): detach from the player, fly through anything.
function updateFreeCam(dt) {
  const cp = Math.cos(pitch);
  const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys["KeyW"] || keys["ArrowUp"]) move.add(fwd);
  if (keys["KeyS"] || keys["ArrowDown"]) move.sub(fwd);
  if (keys["KeyD"] || keys["ArrowRight"]) move.add(right);
  if (keys["KeyA"] || keys["ArrowLeft"]) move.sub(right);
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
    pos.y < 0 || pos.y > MAX_Y;
  if (outOfLevel) spawnPlayer();
}

function headInWater() {
  const hw = PLAYER_HW;
  for (let i = 0; i < 2; i++) {
    const py = pos.y + (i === 0 ? 0.3 : PLAYER_H - 0.4);
    for (let bx = Math.floor(pos.x - hw); bx <= Math.floor(pos.x + hw); bx++)
      for (let bz = Math.floor(pos.z - hw); bz <= Math.floor(pos.z + hw); bz++)
        if (getBlock(bx, Math.floor(py), bz) === WATER || getBlock(bx, Math.floor(py), bz) === LAVA) return true;
  }
  return false;
}

function waterSurfaceTop() {
  let top = -Infinity;
  for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
      for (let y = MAX_Y; y >= 0; y--) {
        const id = getBlock(bx, y, bz);
        if (id === WATER || id === LAVA) {
          if (y + 1 > top) top = y + 1;
          break;
        }
      }
  return top;
}

// ---------------------------------------------------------------------------
// Raycast (DDA voxel traversal)
// ---------------------------------------------------------------------------
const REACH = Infinity;
function pickBlock(origin, dir, skipLiquid) {
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
    if (id !== AIR && !(skipLiquid && (id === WATER || id === LAVA))) return { x, y, z, id, face };
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
  if (protectedBlocks.has(key(x, y, z))) return;
  if (getBlock(x, y, z) === STONE && y === 0) return;
  if (getBlock(x, y, z) === TNT) { igniteTNT(x, y, z); return; }
  if (getBlock(x, y, z) === WATER || getBlock(x, y, z) === LAVA) return;
  setBlock(x, y, z, AIR);
  refreshBlocks([[x, y, z]]);
  queueSave();
}
function placeBlock(id) {
  if (!currentBlock) return false;
  const [nx, ny, nz] = currentBlock.face;
  const px = currentBlock.x + nx, py = currentBlock.y + ny, pz = currentBlock.z + nz;
  if (!tryPlace(id, px, py, pz)) return false;
  chainHome = [px, py, pz];
  chainPlat = null;
  chainSpin = 0;
  return true;
}
function tryPlace(id, px, py, pz) {
  if (!BLOCK_INFO[id] || !BLOCK_INFO[id].placeable) return false;
  const target = getBlock(px, py, pz);
  if (target !== AIR && !(target === id && (id === WATER || id === LAVA))) return false;
  if (target === AIR) {
    if (intersectsPlayer(px, py, pz)) return false;
    const under = getBlock(px, py - 1, pz);
    if ((under === WATER || under === LAVA) && id !== under) return false;
  }
  if (id === FLOWER) placedFlowers.set(key(px, py, pz), { v: randomFlowerVariant(), a: Math.random() * Math.PI * 2 });
  if (id === GLOWSTONE) worldGlowVariants.get(world).set(key(px, py, pz), glowVariantNear(px, py, pz));
  setBlock(px, py, pz, id);
  refreshBlocks([[px, py, pz]]);
  queueSave();
  return true;
}

// Holding left/right click for a moment chains actions, accelerating smoothly
// with each second the button stays held.
const CHAIN_HOLD = 1.0;
const CHAIN_RATE = 10;
const CHAIN_ACCEL = 10;
const MAX_CHAIN_RATE = 60;
const CHAIN_SCAN = 3;
const editHold = {
  0: { down: false, t: 0, acc: 0 },
  2: { down: false, t: 0, acc: 0 },
};
let chainHome = null;
let chainPlat = null;
let chainSpin = 0;
// Closest empty cell at the player's own feet level, straight ahead.
function feetDest() {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  const feetY = Math.floor(pos.y);
  for (let i = 1; i <= CHAIN_SCAN; i++) {
    const cx = Math.round(pos.x + dx * i);
    const cz = Math.round(pos.z + dz * i);
    if (Math.abs(cx) > WORLD_RADIUS || Math.abs(cz) > WORLD_RADIUS) continue;
    if (getBlock(cx, feetY, cz) !== AIR) continue;
    if (intersectsPlayer(cx, feetY, cz)) continue;
    return [cx, feetY, cz];
  }
  return null;
}
// Next grid cell along the straight ray from cell (fx,fy,fz) toward (dx,dy,dz).
function lineStep(fx, fy, fz, dx, dy, dz) {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const tDx = ux === 0 ? Infinity : Math.abs(1 / ux);
  const tDy = uy === 0 ? Infinity : Math.abs(1 / uy);
  const tDz = uz === 0 ? Infinity : Math.abs(1 / uz);
  let tMx = ux > 0 ? 0.5 / ux : ux < 0 ? 0.5 / -ux : Infinity;
  let tMy = uy > 0 ? 0.5 / uy : uy < 0 ? 0.5 / -uy : Infinity;
  let tMz = uz > 0 ? 0.5 / uz : uz < 0 ? 0.5 / -uz : Infinity;
  let nx = fx, ny = fy, nz = fz;
  if (tMy < tMx && tMy < tMz) ny += uy > 0 ? 1 : -1;
  else if (tMz < tMx) nz += uz > 0 ? 1 : -1;
  else nx += ux > 0 ? 1 : -1;
  return [nx, ny, nz];
}
// Plateau staircase from the anchor toward the feet. Instead of climbing or
// descending on every block, the flight splits into flat plateaus: the average
// run of a plateau is the horizontal distance divided by the vertical
// distance (averaged per flight and recomputed each repeat as the feet move).
// The cursor advances one cell per repeat along the straight line to the feet
// cell, staying level for a run of ~avg blocks, then rising/falling one block
// per plateau edge, so every hop is the walkable 1-block rise/fall of the
// auto-step; the final block always lands at the feet cell (even when a cell
// along the way is blocked — the cursor skips on and the stairs re-form). Every
// placed cell lays its whole 2x2 `chainPad` (the cell plus its `+x`/`+z`
// neighbours) so the staircase is a solid 2x2 footprint with no holes
// anywhere. If the average plateau would come out shorter than 1 block (the
// flight is too steep — more vertical than horizontal), it builds a spiral
// staircase instead (`chainSpiral`): the cursor circles the anchor column
// clockwise, dropping one block per turn, until the slope to the feet
// flattens and chainStep resumes normal plateauing.
function chainStep() {
  if (!chainHome) return;
  const dest = feetDest();
  if (!dest) return;
  if (chainHome[0] === dest[0] && chainHome[1] === dest[1] && chainHome[2] === dest[2]) return;
  let nx = chainHome[0], ny = chainHome[1], nz = chainHome[2];
  const dx = dest[0] - nx, dy = dest[1] - ny, dz = dest[2] - nz;
  const horiz = Math.hypot(dx, dz);
  const vert = Math.abs(dy);
  if (vert > 0 && horiz / vert < 1) {
    chainSpiral(dest, nx, ny, nz);
    return;
  }
  const avg = vert > 0 ? horiz / vert : 1;
  if (chainPlat == null) chainPlat = avg;
  else chainPlat = Math.min(chainPlat, avg);
  const id = hotbarList()[selected];
  const diag = dx !== 0 && dz !== 0;
  if (diag) {
    nx += dx > 0 ? 1 : -1;
    nz += dz > 0 ? 1 : -1;
  } else {
    const px = nx, pz = nz;
    if (dx !== 0 || dz !== 0) {
      const h = lineStep(nx, ny, nz, dx, 0, dz);
      nx = h[0];
      nz = h[2];
    }
    if (nx === px && nz === pz) return;
  }
  if (vert > 0) {
    chainPlat -= 1;
    if (chainPlat < 1) {
      if (ny > dest[1]) ny--;
      else if (ny < dest[1]) ny++;
      chainPlat += avg;
    }
  }
  if (ny < 0 || ny > MAX_Y) return;
  if (nx < -WORLD_RADIUS || nx > WORLD_RADIUS || nz < -WORLD_RADIUS || nz > WORLD_RADIUS) return;
  chainHome = [nx, ny, nz];
  chainPad(id, nx, ny, nz);
  if (dx !== 0 && dz !== 0 && nx === dest[0] && nz === dest[2]) chainPad(id, nx - 1, ny, nz - 1);
}
// Lay the 2x2 footprint of the cell at (nx,ny,nz): the cell plus its +x and +z
// neighbours, so every step is a solid 2x2 pad and consecutive pads overlap
// into a hole-free staircase.
function chainPad(id, nx, ny, nz) {
  if (nx >= -WORLD_RADIUS && nx <= WORLD_RADIUS) {
    if (nz >= -WORLD_RADIUS && nz <= WORLD_RADIUS) tryPlace(id, nx, ny, nz);
    if (nz + 1 <= WORLD_RADIUS) tryPlace(id, nx, ny, nz + 1);
  }
  if (nx + 1 <= WORLD_RADIUS) {
    if (nz >= -WORLD_RADIUS && nz <= WORLD_RADIUS) tryPlace(id, nx + 1, ny, nz);
    if (nz + 1 <= WORLD_RADIUS) tryPlace(id, nx + 1, ny, nz + 1);
  }
}
// Spiral staircase fallback: circle the anchor column clockwise, dropping one
// block per turn, until the direct slope to the feet is gentle enough that
// chainStep resumes normal plateauing.
function chainSpiral(dest, nx, ny, nz) {
  const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const d = dirs[chainSpin % 4];
  chainSpin = (chainSpin + 1) % 4;
  nx += d[0];
  nz += d[1];
  if (ny > dest[1]) ny--;
  else if (ny < dest[1]) ny++;
  if (ny < 0 || ny > MAX_Y) return;
  if (nx < -WORLD_RADIUS || nx > WORLD_RADIUS || nz < -WORLD_RADIUS || nz > WORLD_RADIUS) return;
  chainHome = [nx, ny, nz];
  chainPad(hotbarList()[selected], nx, ny, nz);
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
  const t = { bx, by, bz, px: bx + 0.5, py: by + 1.1, pz: bz + 0.5, fuse: FUSE_TIME, life: FUSE_TIME + 2, spr, mesh: null, stuck: false, ax: 0, ay: 0, az: 0 };
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
      } else if ((t.life -= dt) <= 0) {
        clearTNTVisual(t);
        tntLit.delete(k);
        explodeTNT(t.px, t.py, t.pz, false, true);
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
        if (id === AIR || id === WATER || id === LAVA) continue;
        if (id === STONE && gy === 0) continue;
        if (protectedBlocks.has(key(gx, gy, gz))) continue;
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
  for (const [axc, ayc, azc] of affected) setBlock(axc, ayc, azc, AIR);
  refreshBlocks([[bx, by, bz], ...affected]);
  queueSave();
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
  updateNetherEmbers(dt, performance.now() / 1000);
  updateVolcanoEmbers(dt, performance.now() / 1000);
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

const EMBER_COUNT = 220;
let emberPts = null;
let emberVel = null;
let emberLife = null;
let emberMaxLife = null;

function ensureEmbers() {
  if (emberPts) return;
  const posA = new Float32Array(EMBER_COUNT * 3);
  const colA = new Float32Array(EMBER_COUNT * 3);
  emberVel = new Float32Array(EMBER_COUNT * 3);
  emberLife = new Float32Array(EMBER_COUNT);
  emberMaxLife = new Float32Array(EMBER_COUNT);
  for (let i = 0; i < EMBER_COUNT; i++) {
    posA[i * 3] = 0; posA[i * 3 + 1] = -100; posA[i * 3 + 2] = 0;
    colA[i * 3] = 0.35 + Math.random() * 0.25; colA[i * 3 + 1] = 0.7 + Math.random() * 0.3; colA[i * 3 + 2] = 1;
    emberLife[i] = 0; emberMaxLife[i] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  emberPts = new THREE.Points(geo, mat);
  scene.add(emberPts);
}

function removeEmbers() {
  if (emberPts) {
    scene.remove(emberPts);
    emberPts.geometry.dispose();
    emberPts.material.dispose();
    emberPts = null;
    emberVel = null; emberLife = null; emberMaxLife = null;
  }
}

function spawnEmber(i) {
  const S = WORLD_RADIUS;
  for (let tries = 0; tries < 8; tries++) {
    const px = pos.x + (Math.random() * 2 - 1) * 36;
    const pz = pos.z + (Math.random() * 2 - 1) * 36;
    const bx = Math.floor(px), bz = Math.floor(pz);
    if (bx < -S || bx > S || bz < -S || bz > S) continue;
    if (getBlock(bx, NETHER_FIRE_LEVEL, bz) === LAVA) {
      const attr = emberPts.geometry.attributes.position;
      attr.array[i * 3] = bx + 0.5;
      attr.array[i * 3 + 1] = NETHER_FIRE_LEVEL + 0.6;
      attr.array[i * 3 + 2] = bz + 0.5;
      attr.needsUpdate = true;
      emberVel[i * 3] = (Math.random() * 2 - 1) * 0.8;
      emberVel[i * 3 + 1] = 2.5 + Math.random() * 3.5;
      emberVel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.8;
      emberMaxLife[i] = 2.2 + Math.random() * 2.6;
      emberLife[i] = emberMaxLife[i];
      return;
    }
  }
  emberLife[i] = 0;
}

function updateNetherEmbers(dt, time) {
  if (dim !== "nether") { removeEmbers(); return; }
  ensureEmbers();
  const attr = emberPts.geometry.attributes.position;
  for (let i = 0; i < EMBER_COUNT; i++) {
    if (emberLife[i] <= 0 || attr.array[i * 3 + 1] > NETHER_FIRE_LEVEL + 24) {
      spawnEmber(i);
    } else {
      emberLife[i] -= dt;
      attr.array[i * 3] += (emberVel[i * 3] + Math.sin(time * 2 + i) * 0.4) * dt;
      attr.array[i * 3 + 1] += emberVel[i * 3 + 1] * dt;
      attr.array[i * 3 + 2] += (emberVel[i * 3 + 2] + Math.cos(time * 1.7 + i) * 0.4) * dt;
    }
  }
  attr.needsUpdate = true;
}

// Volcano eruption fountains: lava blobs belched from each volcano's
// crater, arcing high into the sky then splashing back down into the fire.
const VOLCANO_EMBER_COUNT = 340;
let volcanoPts = null;
let volcanoVel = null;
let volcanoBase = null;
let volcanoLife = null;
let volcanoMaxLife = null;

function ensureVolcanoEmbers() {
  if (volcanoPts) return;
  const posA = new Float32Array(VOLCANO_EMBER_COUNT * 3);
  const colA = new Float32Array(VOLCANO_EMBER_COUNT * 3);
  volcanoVel = new Float32Array(VOLCANO_EMBER_COUNT * 3);
  volcanoBase = new Float32Array(VOLCANO_EMBER_COUNT);
  volcanoLife = new Float32Array(VOLCANO_EMBER_COUNT);
  volcanoMaxLife = new Float32Array(VOLCANO_EMBER_COUNT);
  for (let i = 0; i < VOLCANO_EMBER_COUNT; i++) {
    posA[i * 3] = 0; posA[i * 3 + 1] = -100; posA[i * 3 + 2] = 0;
    colA[i * 3] = 0.5 + Math.random() * 0.3; colA[i * 3 + 1] = 0.8 + Math.random() * 0.2; colA[i * 3 + 2] = 1;
    volcanoLife[i] = 0; volcanoMaxLife[i] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.34, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  volcanoPts = new THREE.Points(geo, mat);
  scene.add(volcanoPts);
}

function removeVolcanoEmbers() {
  if (volcanoPts) {
    scene.remove(volcanoPts);
    volcanoPts.geometry.dispose();
    volcanoPts.material.dispose();
    volcanoPts = null;
    volcanoVel = null; volcanoBase = null; volcanoLife = null; volcanoMaxLife = null;
  }
}

function spawnVolcanoEmber(i) {
  if (!volcanoes.length) { volcanoLife[i] = 0; return; }
  const v = volcanoes[(Math.random() * volcanoes.length) | 0];
  for (let tries = 0; tries < 8; tries++) {
    const ox = (Math.random() * 2 - 1) * v.craterR * 0.9;
    const oz = (Math.random() * 2 - 1) * v.craterR * 0.9;
    if (ox * ox + oz * oz > v.craterR * v.craterR) continue;
    const base = v.rim - v.craterDepth * (0.2 + Math.random() * 0.5);
    const attr = volcanoPts.geometry.attributes.position;
    attr.array[i * 3] = v.x + ox + 0.5;
    attr.array[i * 3 + 1] = base;
    attr.array[i * 3 + 2] = v.z + oz + 0.5;
    attr.needsUpdate = true;
    volcanoVel[i * 3] = (Math.random() * 2 - 1) * 7;
    volcanoVel[i * 3 + 1] = 22 + Math.random() * 20;
    volcanoVel[i * 3 + 2] = (Math.random() * 2 - 1) * 7;
    volcanoBase[i] = base;
    volcanoMaxLife[i] = 1.8 + Math.random() * 1.6;
    volcanoLife[i] = volcanoMaxLife[i];
    return;
  }
  volcanoLife[i] = 0;
}

function updateVolcanoEmbers(dt, time) {
  if (dim !== "nether") { removeVolcanoEmbers(); return; }
  ensureVolcanoEmbers();
  const attr = volcanoPts.geometry.attributes.position;
  for (let i = 0; i < VOLCANO_EMBER_COUNT; i++) {
    if (volcanoLife[i] <= 0) {
      spawnVolcanoEmber(i);
    } else {
      volcanoLife[i] -= dt;
      attr.array[i * 3] += (volcanoVel[i * 3] + Math.sin(time * 3 + i) * 0.9) * dt;
      attr.array[i * 3 + 1] += volcanoVel[i * 3 + 1] * dt;
      attr.array[i * 3 + 2] += (volcanoVel[i * 3 + 2] + Math.cos(time * 2.4 + i) * 0.9) * dt;
      volcanoVel[i * 3 + 1] -= 30 * dt;
      if (attr.array[i * 3 + 1] < volcanoBase[i] - 3) volcanoLife[i] = 0;
    }
  }
  attr.needsUpdate = true;
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
const protectedBlocks = new Set();
let endCleared = false;
let dormantMsgAt = 0;

function buildReturnPortal() {
  protectedBlocks.clear();
  const coords = [];
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 4; y++) {
      const isCorner = (x === -2 && (y === 0 || y === 4)) || (x === 2 && (y === 0 || y === 4));
      const isEdge = x === -2 || x === 2 || y === 0 || y === 4;
      if (isEdge && !isCorner) {
        setBlock(x, END_RETURN_BASE_Y + y, END_RETURN_Z, PORTAL);
        coords.push([x, END_RETURN_BASE_Y + y, END_RETURN_Z]);
        protectedBlocks.add(key(x, END_RETURN_BASE_Y + y, END_RETURN_Z));
      }
    }
  endReturnWin = { orient: "v", minX: -2, minY: END_RETURN_BASE_Y, minZ: END_RETURN_Z };
  refreshBlocks(coords);
}

const NETHER_RETURN_BASE_Y = 30;
const NETHER_RETURN_Z = 0;
let netReturnWin = null;
const NETHER_SPAWN = { x: 0.5, y: NETHER_RETURN_BASE_Y + 1.01, z: 2.5 };

function buildNetherPortal() {
  protectedBlocks.clear();
  const coords = [];
  const base = NETHER_RETURN_BASE_Y;
  for (let x = -4; x <= 3; x++)
    for (let z = -1; z <= 4; z++)
      for (let y = base - 2; y < base; y++) setBlock(x, y, z, NETHERRACK);
  for (let x = -3; x <= 3; x++)
    for (let z = -1; z <= 4; z++)
      for (let y = base; y <= base + 4; y++)
        if (worlds.nether.has(key(x, y, z))) worlds.nether.delete(key(x, y, z));
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 3; y++) {
      const isEdge = x === -2 || x === 2 || y === 0 || y === 3;
      if (!isEdge) continue;
      setBlock(x, base + y, NETHER_RETURN_Z, OBSIDIAN);
      coords.push([x, base + y, NETHER_RETURN_Z]);
      protectedBlocks.add(key(x, base + y, NETHER_RETURN_Z));
    }
  netReturnWin = { minX: -2, minY: base, minZ: NETHER_RETURN_Z };
  refreshBlocks(coords);
}

function setDimensionEnv() {
  if (dim === "end") {
    skyDome.visible = false;
    scene.background.setHex(0x000000);
    scene.fog.color.setHex(0x000000);
    scene.fog.near = 30; scene.fog.far = 150;
    sun.color.setHex(0xfff5e0); sun.intensity = 0.35;
    hemi.color.setHex(0xbfd4ff); hemi.intensity = 0.45;
  } else if (dim === "nether") {
    skyDome.visible = true;
    scene.background.setHex(0x111114);
    scene.fog.color.setHex(0x1c1c21);
    scene.fog.near = 20; scene.fog.far = 110;
    sun.color.setHex(0xe8e8ea); sun.intensity = 0.6;
    hemi.color.setHex(0x85858c); hemi.intensity = 0.55;
  } else {
    skyDome.visible = false;
    scene.background.setHex(0x87ceeb);
    scene.fog.color.setHex(0x87ceeb);
    scene.fog.near = 60; scene.fog.far = 160;
    sun.color.setHex(0xfff5e0); sun.intensity = 1.1;
    hemi.color.setHex(0xbfd4ff); hemi.intensity = 0.75;
  }
}

function goToDimension(name, sx, sy, sz) {
  dim = name;
  world = worlds[name];
  clearGlowLights();
  rebuildHotbar();
  portalDirty = true;
  worldDirty = true;
  clearPortalFills();
  removeEndEntities();
  if (name === "end") {
    generateEnd();
    endReturnWin = null;
    endCleared = false;
    buildReturnPortal();
    spawnDragon();
    spawnEndermen();
    setDimensionEnv();
    prePortalFly = flying;
    flying = false;
    yaw = 0;
    pitch = 0;
  } else if (name === "nether") {
    generateNether();
    netReturnWin = null;
    buildNetherPortal();
    setDimensionEnv();
    yaw = Math.PI;
    pitch = 0;
  } else {
    setDimensionEnv();
    flying = prePortalFly;
    if (overPortalFace == null) {
      const w = findPortalWindow(Math.floor(overPortalSpawn.x), Math.floor(overPortalSpawn.y + 0.25), Math.floor(overPortalSpawn.z));
      if (w) yaw = Math.atan2(-(w.minX + 2.5 - overPortalSpawn.x), -(winCenter(w).z + 0.5 - overPortalSpawn.z));
    } else {
      yaw = overPortalFace;
    }
    const s = resolveSpawn(overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z);
    sx = s.x; sy = s.y; sz = s.z;
  }
  if (freeCam) { freeCam = false; }
  Object.keys(keys).forEach((k) => { keys[k] = false; });
  pos.set(sx, sy, sz);
  camPos.set(sx, sy, sz);
  vel.set(0, 0, 0);
  rebuildMeshes();
  scanWorldPortals();
  recomputeGlowClusters();
  syncGlowLights();
  updateCamera();
  portalCd = 1.5;
  queueSave();
  updateDimLabel();
}

// Fullscreen portal-travel spiral. Fades in (fade-in + buffer complete BEFORE
// the synchronous world-gen freeze), stays fully opaque and spinning through
// it (opacity/transform are compositor-driven, so the spiral survives the
// main-thread stall), then fades out over the freshly generated dimension.
const PORTAL_FADE_IN = 450;
const PORTAL_FADE_OUT = 600;
const portalSpiralEl = document.getElementById("portalSpiral");
let portalBusy = false;
let spiralGen = 0;

function showPortalSpiral() {
  spiralGen++;
  portalSpiralEl.style.display = "flex";
  void portalSpiralEl.offsetWidth;
  portalSpiralEl.classList.add("show");
}
function hidePortalSpiral() {
  const g = spiralGen;
  portalSpiralEl.classList.remove("show");
  setTimeout(() => { if (spiralGen === g) portalSpiralEl.style.display = "none"; }, PORTAL_FADE_OUT + 80);
}
function portalTrigger(target, sx, sy, sz, msg) {
  if (portalBusy) return;
  portalBusy = true;
  portalCd = 1.5;
  showPortalSpiral();
  setTimeout(() => {
    goToDimension(target, sx, sy, sz);
    if (msg) showMsg(msg);
    portalBusy = false;
    hidePortalSpiral();
  }, PORTAL_FADE_IN + 80);
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

function vWinOk4(minX, minY, minZ) {
  for (let y = minY; y <= minY + 3; y++)
    for (let x = minX; x <= minX + 4; x++) {
      const isCorner = (x === minX || x === minX + 4) && (y === minY || y === minY + 3);
      const isEdge = x === minX || x === minX + 4 || y === minY || y === minY + 3;
      if (isCorner) continue;
      const id = getBlock(x, y, minZ);
      if (isEdge) { if (id !== PORTAL) return false; }
      else { if (id !== AIR) return false; }
    }
  return true;
}

function nWinOk(minX, minY, minZ, w = 5, h = 4, face = "z") {
  for (let y = minY; y < minY + h; y++)
    for (let u = 0; u < w; u++) {
      const isEdge = u === 0 || u === w - 1 || y === minY || y === minY + h - 1;
      const x = face === "x" ? minX : minX + u;
      const z = face === "x" ? minZ + u : minZ;
      const id = getBlock(x, y, z);
      if (isEdge) { if (id !== OBSIDIAN) return false; }
      else { if (id !== AIR) return false; }
    }
  return true;
}

function nFlatWinOk(minX, minZ, by, ww, dd) {
  for (let x = minX; x <= minX + ww - 1; x++)
    for (let z = minZ; z <= minZ + dd - 1; z++) {
      const isEdge = x === minX || x === minX + ww - 1 || z === minZ || z === minZ + dd - 1;
      const id = getBlock(x, by, z);
      if (isEdge) { if (id !== OBSIDIAN) return false; }
      else { if (id !== AIR) return false; }
    }
  return true;
}

function findPortalWindow(bx, by, bz) {
  for (let wz = -3; wz <= 1; wz++)
    for (let wx = -3; wx <= 1; wx++)
      if (winOk(bx + wx, bz + wz, by)) return { orient: "h", minX: bx + wx, minY: by, minZ: bz + wz };
  return null;
}

function windowDist(w, bx, by, bz) {
  if (w.orient === "v" && w.face === "x") {
    const zTop = w.dims === "4x5" || w.dims === "4x4" ? w.minZ + 3 : w.minZ + 4;
    const dz = Math.max(w.minZ - bz, 0, bz - zTop);
    const dx = Math.abs(w.minX - bx);
    let top;
    if (w.dims === "4x5") top = w.minY + 4;
    else if (w.dims === "4x4") top = w.minY + 3;
    else top = w.minY + 3;
    const dy = Math.max(w.minY - by, 0, by - top);
    return dx * dx + dy * dy + dz * dz;
  }
  const dxTop = w.orient === "v" && w.dims === "4x5" ? w.minX + 3 : w.minX + 4;
  const dx = Math.max(w.minX - bx, 0, bx - dxTop);
  let top;
  if (w.orient === "v" && w.dims === "4x5") top = w.minY + 4;
  else if (w.orient === "v" && (w.dims === "4x4" || w.h === 4)) top = w.minY + 3;
  else top = w.minY + 4;
  const dy = Math.max(w.minY - by, 0, by - top);
  const dz = Math.max(w.minZ - bz, 0, bz - (w.minZ + 4));
  return dx * dx + dy * dy + dz * dz;
}

function forEachPortalBlockNear(bx, by, bz, R, fn) {
  for (const pk of worldPortalSets.get(world)) {
    const [px, py, pz] = keyXYZ(pk);
    if (Math.abs(px - bx) > R || Math.abs(py - by) > R || Math.abs(pz - bz) > R) continue;
    fn(px, py, pz);
  }
}

// Candidate window anchors where a portal block sits on the frame's mandatory
// edge (corners are optional for End frames, always required for Nether ones).
// Validating each candidate with the existing winOk checks keeps the window
// layouts identical to before — only the scan is anchored to real blocks.
function* endVerticalAnchors(px, py, pz) {
  for (const h of [5, 4]) {
    for (let wy = py - h + 2; wy <= py - 1; wy++) {
      yield { orient: "v", h, minX: px, minY: wy, minZ: pz };
      yield { orient: "v", h, minX: px - 4, minY: wy, minZ: pz };
    }
    for (let wx = px - 3; wx <= px - 1; wx++) {
      yield { orient: "v", h, minX: wx, minY: py, minZ: pz };
      yield { orient: "v", h, minX: wx, minY: py - (h - 1), minZ: pz };
    }
  }
}
function* endFlatAnchors(px, py, pz) {
  for (let wz = pz - 3; wz <= pz - 1; wz++) {
    yield { orient: "h", minX: px, minY: py, minZ: wz };
    yield { orient: "h", minX: px - 4, minY: py, minZ: wz };
  }
  for (let wx = px - 3; wx <= px - 1; wx++) {
    yield { orient: "h", minX: wx, minY: py, minZ: pz };
    yield { orient: "h", minX: wx, minY: py, minZ: pz - 4 };
  }
}
function* netherVerticalAnchors(px, py, pz) {
  const shapes = [
    { w: 5, h: 4, dims: undefined },
    { w: 4, h: 5, dims: "4x5" },
    { w: 4, h: 4, dims: "4x4" },
  ];
  for (const { w, h, dims } of shapes) {
    for (let wy = py - h + 1; wy <= py; wy++) {
      yield { orient: "v", face: "z", dims, minX: px, minY: wy, minZ: pz, w, h };
      yield { orient: "v", face: "z", dims, minX: px - (w - 1), minY: wy, minZ: pz, w, h };
    }
    for (let wx = px - w + 1; wx <= px; wx++) {
      yield { orient: "v", face: "z", dims, minX: wx, minY: py, minZ: pz, w, h };
      yield { orient: "v", face: "z", dims, minX: wx, minY: py - (h - 1), minZ: pz, w, h };
    }
    for (let wz = pz - w + 1; wz <= pz; wz++) {
      yield { orient: "v", face: "x", dims, minX: px, minY: py, minZ: wz, w, h };
      yield { orient: "v", face: "x", dims, minX: px, minY: py - (h - 1), minZ: wz, w, h };
    }
    for (let wy = py - h + 1; wy <= py; wy++) {
      yield { orient: "v", face: "x", dims, minX: px, minY: wy, minZ: pz, w, h };
      yield { orient: "v", face: "x", dims, minX: px, minY: wy, minZ: pz - (w - 1), w, h };
    }
  }
}
function* netherFlatAnchors(px, py, pz) {
  for (let wz = pz - 3; wz <= pz; wz++) {
    yield { orient: "h", dims: "5x4", minX: px, minY: py, minZ: wz };
    yield { orient: "h", dims: "5x4", minX: px - 4, minY: py, minZ: wz };
  }
  for (let wx = px - 4; wx <= px; wx++) {
    yield { orient: "h", dims: "5x4", minX: wx, minY: py, minZ: pz };
    yield { orient: "h", dims: "5x4", minX: wx, minY: py, minZ: pz - 3 };
  }
  for (let wz = pz - 4; wz <= pz; wz++) {
    yield { orient: "h", dims: "4x5", minX: px, minY: py, minZ: wz };
    yield { orient: "h", dims: "4x5", minX: px - 3, minY: py, minZ: wz };
  }
  for (let wx = px - 3; wx <= px; wx++) {
    yield { orient: "h", dims: "4x5", minX: wx, minY: py, minZ: pz };
    yield { orient: "h", dims: "4x5", minX: wx, minY: py, minZ: pz - 4 };
  }
}

function collectEndWins(bx, by, bz, R) {
  const wins = [];
  const seen = new Set();
  forEachPortalBlockNear(bx, by, bz, R, (px, py, pz) => {
    for (const a of endVerticalAnchors(px, py, pz)) {
      const ok = a.h === 4 ? vWinOk4(a.minX, a.minY, a.minZ) : vWinOk(a.minX, a.minY, a.minZ);
      if (!ok) continue;
      const k = "v:" + a.minX + "," + a.minY + "," + a.minZ;
      if (seen.has(k)) continue;
      seen.add(k);
      wins.push({ orient: "v", h: a.h, minX: a.minX, minY: a.minY, minZ: a.minZ });
    }
    for (const a of endFlatAnchors(px, py, pz)) {
      if (!winOk(a.minX, a.minZ, a.minY)) continue;
      const k = "h:" + a.minX + "," + a.minY + "," + a.minZ;
      if (seen.has(k)) continue;
      seen.add(k);
      wins.push({ orient: "h", minX: a.minX, minY: a.minY, minZ: a.minZ });
    }
  });
  return wins;
}

function collectNetherWins(bx, by, bz, R) {
  const wins = [];
  const seen = new Set();
  forEachPortalBlockNear(bx, by, bz, R, (px, py, pz) => {
    for (const a of netherVerticalAnchors(px, py, pz)) {
      if (!nWinOk(a.minX, a.minY, a.minZ, a.w, a.h, a.face)) continue;
      const k = "v:" + a.face + ":" + (a.dims || "") + ":" + a.minX + "," + a.minY + "," + a.minZ;
      if (seen.has(k)) continue;
      seen.add(k);
      wins.push({ orient: "v", face: a.face, dims: a.dims, minX: a.minX, minY: a.minY, minZ: a.minZ });
    }
    for (const a of netherFlatAnchors(px, py, pz)) {
      const ww = a.dims === "4x5" ? 4 : 5, dd = a.dims === "4x5" ? 5 : 4;
      if (!nFlatWinOk(a.minX, a.minZ, a.minY, ww, dd)) continue;
      const k = "h:" + a.dims + ":" + a.minX + "," + a.minY + "," + a.minZ;
      if (seen.has(k)) continue;
      seen.add(k);
      wins.push({ orient: "h", dims: a.dims, minX: a.minX, minY: a.minY, minZ: a.minZ });
    }
  });
  return wins;
}

function findEndWinNear(bx, by, bz, R) {
  let best = null;
  for (const w of collectEndWins(bx, by, bz, R)) {
    const d = windowDist(w, bx, by, bz);
    if (!best || d < best.d) best = { w, d };
  }
  return best ? best.w : null;
}

function findNetherWinNear(bx, by, bz, R) {
  let best = null;
  for (const w of collectNetherWins(bx, by, bz, R)) {
    const d = windowDist(w, bx, by, bz);
    if (!best || d < best.d) best = { w, d };
  }
  return best ? best.w : null;
}

const PORTAL_FILL_DIST = Math.ceil(RENDER_DIST * CHUNK * Math.SQRT2);
const portalFills = new Map();
const portalFillGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
const portalFillMatBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });
const portalFillMatPurple = new THREE.MeshBasicMaterial({ color: 0x9b30ff });

function layoutPortalFill(group, win, nether) {
  let i = 0;
  const set = (x, y, z) => {
    const m = group.children[i++];
    m.visible = true;
    m.position.set(x + 0.5, y + 0.5, z + 0.5);
  };
  if (win.orient === "v") {
    if (nether) {
      if (win.face === "x") {
        const cy = { "4x5": 3, "4x4": 2 }[win.dims] || 2;
        const cz = win.dims === "4x5" || win.dims === "4x4" ? 2 : 3;
        for (let y = win.minY + 1; y <= win.minY + cy; y++)
          for (let z = win.minZ + 1; z <= win.minZ + cz; z++) set(win.minX, y, z);
      } else if (win.dims === "4x5") {
        for (let y = win.minY + 1; y <= win.minY + 3; y++)
          for (let x = win.minX + 1; x <= win.minX + 2; x++) set(x, y, win.minZ);
      } else if (win.dims === "4x4") {
        for (let y = win.minY + 1; y <= win.minY + 2; y++)
          for (let x = win.minX + 1; x <= win.minX + 2; x++) set(x, y, win.minZ);
      } else {
        for (let y = win.minY + 1; y <= win.minY + 2; y++)
          for (let x = win.minX + 1; x <= win.minX + 3; x++) set(x, y, win.minZ);
      }
    } else {
      const top = win.h === 4 ? win.minY + 2 : win.minY + 3;
      if (win.face === "x") {
        for (let y = win.minY + 1; y <= top; y++)
          for (let z = win.minZ + 1; z <= win.minZ + 3; z++) set(win.minX, y, z);
      } else {
        for (let y = win.minY + 1; y <= top; y++)
          for (let x = win.minX + 1; x <= win.minX + 3; x++) set(x, y, win.minZ);
      }
    }
  } else {
    if (nether) {
      const xw = win.dims === "4x5" ? 2 : 3;
      const xt = win.dims === "4x5" ? 3 : 2;
      for (let x = win.minX + 1; x <= win.minX + xw; x++)
        for (let z = win.minZ + 1; z <= win.minZ + xt; z++) set(x, win.minY, z);
    } else {
      for (let x = win.minX + 1; x <= win.minX + 3; x++)
        for (let z = win.minZ + 1; z <= win.minZ + 3; z++) set(x, win.minY, z);
    }
  }
  for (; i < group.children.length; i++) group.children[i].visible = false;
}

function ensurePortalFill(win, nether) {
  const key = `${nether ? "n" : "e"}:${win.orient}:${win.face || "z"}:${win.minX},${win.minY},${win.minZ}${win.dims || ""}`;
  if (portalFills.has(key)) return;
  const group = new THREE.Group();
  for (let i = 0; i < 9; i++) group.add(new THREE.Mesh(portalFillGeo, nether ? portalFillMatPurple : portalFillMatBlack));
  layoutPortalFill(group, win, nether);
  group.visible = false;
  scene.add(group);
  const c = winCenter(win);
  portalFills.set(key, { dim, win, nether, group, cx: c.x + 0.5, cy: win.minY + 2, cz: c.z + 0.5 });
}

function portalFillValid(f) {
  const w = f.win;
  if (w.orient === "v") return f.nether ? nWinOk(w.minX, w.minY, w.minZ, w.dims === "4x5" ? 4 : (w.dims === "4x4" ? 4 : 5), w.dims === "4x5" ? 5 : (w.dims === "4x4" ? 4 : 4), w.face) : (w.h === 4 ? vWinOk4(w.minX, w.minY, w.minZ) : vWinOk(w.minX, w.minY, w.minZ));
  if (f.nether) return nFlatWinOk(w.minX, w.minZ, w.minY, w.dims === "4x5" ? 4 : 5, w.dims === "4x5" ? 5 : 4);
  return winOk(w.minX, w.minZ, w.minY);
}

function clearPortalFills() {
  for (const f of portalFills.values()) scene.remove(f.group);
  portalFills.clear();
}

function refreshPortalFills(bx, by, bz) {
  const R = 8;
  if (dim === "end") {
    if (!endCleared) {
      for (const [key, f] of portalFills) {
        if (f.dim !== "end") continue;
        scene.remove(f.group);
        portalFills.delete(key);
      }
    } else {
      for (const w of collectEndWins(bx, by, bz, R)) ensurePortalFill(w, false);
      for (const w of collectNetherWins(bx, by, bz, R)) ensurePortalFill(w, true);
    }
  } else if (dim === "nether") {
    for (const w of collectNetherWins(bx, by, bz, R)) ensurePortalFill(w, true);
    for (const w of collectEndWins(bx, by, bz, R)) ensurePortalFill(w, false);
  } else {
    for (const w of collectEndWins(bx, by, bz, R)) ensurePortalFill(w, false);
    for (const w of collectNetherWins(bx, by, bz, R)) ensurePortalFill(w, true);
  }
  for (const [key, f] of portalFills) {
    if (f.dim !== dim) continue;
    if (!portalFillValid(f)) {
      scene.remove(f.group);
      portalFills.delete(key);
    }
  }
}

function scanWorldPortals() {
  for (const pk of worldPortalSets.get(world)) {
    const [x, y, z] = keyXYZ(pk);
    for (const w of collectEndWins(x, y, z, 6)) ensurePortalFill(w, false);
    for (const w of collectNetherWins(x, y, z, 6)) ensurePortalFill(w, true);
  }
}

let endReturnWin = null;
const endMemo = { dim: "", bx: -9999, by: -9999, bz: -9999, win: null };
const netherMemo = { dim: "", bx: -9999, by: -9999, bz: -9999, win: null };
let portalScanT = 0;
const lastScanCell = { dim: "", bx: -9999, by: -9999, bz: -9999 };

function scanEndPortal(bx, by, bz) {
  if (endReturnWin && vWinOk(endReturnWin.minX, endReturnWin.minY, endReturnWin.minZ) &&
      insideEndInterior(endReturnWin, bx, by, bz)) return endReturnWin;
  if (endMemo.dim === "end" && endMemo.bx === bx && endMemo.by === by && endMemo.bz === bz) return endMemo.win;
  endMemo.dim = "end"; endMemo.bx = bx; endMemo.by = by; endMemo.bz = bz;
  endMemo.win = findEndWinNear(bx, by, bz, 5);
  return endMemo.win;
}

function scanNetherPortal(bx, by, bz) {
  if (netherMemo.dim === dim && netherMemo.bx === bx && netherMemo.by === by && netherMemo.bz === bz) return netherMemo.win;
  netherMemo.dim = dim; netherMemo.bx = bx; netherMemo.by = by; netherMemo.bz = bz;
  netherMemo.win = findNetherWinNear(bx, by, bz, 8);
  return netherMemo.win;
}

function winCenter(win) {
  if (win.orient === "h") return { x: win.minX + 2, z: win.minZ + 2 };
  if (win.face === "x") return { x: win.minX, z: win.minZ + (win.dims === "4x5" || win.dims === "4x4" ? 1.5 : 2) };
  return { x: win.minX + (win.dims === "4x5" || win.dims === "4x4" ? 1.5 : 2), z: win.minZ };
}

function updatePortalVisual() {
  const px = freeCam ? camPos.x : pos.x;
  const py = freeCam ? camPos.y : pos.y;
  const pz = freeCam ? camPos.z : pos.z;
  const bx = Math.floor(px), by = Math.floor(py + 0.9), bz = Math.floor(pz);
  portalScanT -= dt;
  if (portalDirty || (portalScanT <= 0 &&
      (dim !== lastScanCell.dim || bx !== lastScanCell.bx || by !== lastScanCell.by || bz !== lastScanCell.bz))) {
    portalScanT = 0.5;
    portalDirty = false;
    lastScanCell.dim = dim; lastScanCell.bx = bx; lastScanCell.by = by; lastScanCell.bz = bz;
    refreshPortalFills(bx, by, bz);
  }
  const maxD2 = PORTAL_FILL_DIST * PORTAL_FILL_DIST;
  for (const f of portalFills.values()) {
    if (f.dim !== dim) { f.group.visible = false; continue; }
    const dx = f.cx - px, dy = f.cy - py, dz = f.cz - pz;
    f.group.visible = dx * dx + dy * dy + dz * dz <= maxD2;
  }
}

function insideEndInterior(win, bx, by, bz) {
  if (win.orient === "v") {
    const top = win.h === 4 ? win.minY + 2 : win.minY + 3;
    return bx >= win.minX + 1 && bx <= win.minX + 3 && by >= win.minY + 1 && by <= top && bz === win.minZ;
  }
  return bx >= win.minX + 1 && bx <= win.minX + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 3;
}

function insideNetherInterior(win, bx, by, bz) {
  if (win.orient === "v") {
    if (win.face === "x") {
      if (win.dims === "4x5") return bx === win.minX && by >= win.minY + 1 && by <= win.minY + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
      if (win.dims === "4x4") return bx === win.minX && by >= win.minY + 1 && by <= win.minY + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
      return bx === win.minX && by >= win.minY + 1 && by <= win.minY + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 3;
    }
    if (win.dims === "4x5") return bx >= win.minX + 1 && bx <= win.minX + 2 && by >= win.minY + 1 && by <= win.minY + 3 && bz === win.minZ;
    if (win.dims === "4x4") return bx >= win.minX + 1 && bx <= win.minX + 2 && by >= win.minY + 1 && by <= win.minY + 2 && bz === win.minZ;
    return bx >= win.minX + 1 && bx <= win.minX + 3 && by >= win.minY + 1 && by <= win.minY + 2 && bz === win.minZ;
  }
  if (win.dims === "4x5") return bx >= win.minX + 1 && bx <= win.minX + 2 && bz >= win.minZ + 1 && bz <= win.minZ + 3;
  return bx >= win.minX + 1 && bx <= win.minX + 3 && bz >= win.minZ + 1 && bz <= win.minZ + 2;
}

function nearPortalSpawn(win, dir) {
  const c = winCenter(win);
  const cx = c.x, cz = c.z;
  const by = win.minY;
  const inInterior = (sx, sz) => {
    if (win.orient === "h") {
      if (sx < win.minX + 1 || sx > win.minX + 3) return false;
      if (win.dims === "4x5") return sz >= win.minZ + 1 && sz <= win.minZ + 3;
      return sz >= win.minZ + 1 && sz <= win.minZ + 2;
    }
    if (win.face === "x") {
      if (sx !== win.minX) return false;
      if (win.dims === "4x5" || win.dims === "4x4") return sz >= win.minZ + 1 && sz <= win.minZ + 2;
      return sz >= win.minZ + 1 && sz <= win.minZ + 3;
    }
    if (sx < win.minX + 1 || sx > win.minX + 3) return false;
    return sz === win.minZ;
  };
  const spot = (sx, sz) => {
    if (inInterior(sx, sz)) return null;
    if (isSolid(sx, by, sz) || isSolid(sx, by + 1, sz)) return null;
    if (!isSolid(sx, by - 1, sz)) return null;
    return { x: sx + 0.5, y: by, z: sz + 0.5 };
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
  return { x: win.minX + 0.5, y: by, z: win.minZ - 0.5 };
}

// Find a safe landing spot near (sx, sy, sz) on live terrain: full body
// clearance (no walls), solid ground under the feet, and not inside any
// portal interior so you never arrive embedded in rock or standing in a
// frame that would instantly re-teleport you.
function resolveSpawn(sx, sy, sz) {
  const cx = Math.floor(sx), cz = Math.floor(sz), cy = Math.floor(sy);
  const wins = [...collectEndWins(cx, cy, cz, 16), ...collectNetherWins(cx, cy, cz, 16)];
  const inPortalBody = (px, py, pz) => {
    const bx = Math.floor(px), bz = Math.floor(pz);
    for (const w of wins)
      for (let by = Math.floor(py); by <= Math.floor(py + PLAYER_H); by++)
        if (insideEndInterior(w, bx, by, bz) || insideNetherInterior(w, bx, by, bz)) return true;
    return false;
  };
  const bodyClear = (px, py, pz) => {
    for (let bx = Math.floor(px - PLAYER_HW + 0.02); bx <= Math.floor(px + PLAYER_HW - 0.02); bx++)
      for (let by = Math.floor(py + 0.02); by <= Math.floor(py + PLAYER_H - 0.02); by++)
        for (let bz = Math.floor(pz - PLAYER_HW + 0.02); bz <= Math.floor(pz + PLAYER_HW - 0.02); bz++)
          if (isSolid(bx, by, bz)) return false;
    return true;
  };
  const groundTop = (ix, iz) => {
    for (let y = cy + 8; y > cy - 40; y--)
      if (isSolid(ix, y, iz)) return y + 1;
    return null;
  };
  for (let r = 0; r <= 14; r++) {
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++) {
        if (r > 0 && ix > cx - r && ix < cx + r && iz > cz - r && iz < cz + r) continue;
        const top = groundTop(ix, iz);
        if (top == null) continue;
        const px = ix + 0.5, py = top, pz = iz + 0.5;
        if (!bodyClear(px, py, pz)) continue;
        if (inPortalBody(px, py, pz)) continue;
        return { x: px, y: py, z: pz };
      }
  }
  return { x: sx, y: sy, z: sz };
}

function checkPortal() {
  if (portalCd > 0) return;
  if (portalBusy) return;
  const bx = Math.floor(freeCam ? camPos.x : pos.x);
  const by = Math.floor((freeCam ? camPos.y : pos.y) + EYE);
  const bz = Math.floor(freeCam ? camPos.z : pos.z);
  if (dim === "end" && !endCleared) {
    const wE = scanEndPortal(bx, by, bz);
    const wN = scanNetherPortal(bx, by, bz);
    if ((wE && insideEndInterior(wE, bx, by, bz)) || (wN && insideNetherInterior(wN, bx, by, bz))) {
      const now = performance.now();
      if (now - dormantMsgAt > 3000) {
        dormantMsgAt = now;
        showMsg("The End is sealed — slay the Ender Dragon to open its portals");
      }
    }
    return;
  }
  for (const f of portalFills.values()) {
    if (f.dim !== dim) continue;
    if (f.nether) {
      if (!insideNetherInterior(f.win, bx, by, bz)) continue;
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      let ddx = 0, ddz = 0;
      if (keys["KeyW"] || keys["ArrowUp"]) { ddx += forward.x; ddz += forward.z; }
      if (keys["KeyS"] || keys["ArrowDown"]) { ddx -= forward.x; ddz -= forward.z; }
      if (keys["KeyD"] || keys["ArrowRight"]) { ddx += right.x; ddz += right.z; }
      if (keys["KeyA"] || keys["ArrowLeft"]) { ddx -= right.x; ddz -= right.z; }
      if (ddx === 0 && ddz === 0) { ddx = forward.x; ddz = forward.z; }
      overPortalSpawn = nearPortalSpawn(f.win, { x: ddx, z: ddz });
      const c = winCenter(f.win);
      overPortalFace = Math.atan2(-(c.x + 0.5 - overPortalSpawn.x), -(c.z + 0.5 - overPortalSpawn.z));
      if (dim === "nether") {
        portalTrigger("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z, "You returned to the Overworld");
      } else {
        portalTrigger("nether", NETHER_SPAWN.x, NETHER_SPAWN.y, NETHER_SPAWN.z, "You entered The Nether");
      }
      return;
    } else {
      if (!insideEndInterior(f.win, bx, by, bz)) continue;
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      let ddx = 0, ddz = 0;
      if (keys["KeyW"] || keys["ArrowUp"]) { ddx += forward.x; ddz += forward.z; }
      if (keys["KeyS"] || keys["ArrowDown"]) { ddx -= forward.x; ddz -= forward.z; }
      if (keys["KeyD"] || keys["ArrowRight"]) { ddx += right.x; ddz += right.z; }
      if (keys["KeyA"] || keys["ArrowLeft"]) { ddx -= right.x; ddz -= right.z; }
      if (ddx === 0 && ddz === 0) { ddx = forward.x; ddz = forward.z; }
      overPortalSpawn = nearPortalSpawn(f.win, { x: ddx, z: ddz });
      const c = winCenter(f.win);
      overPortalFace = Math.atan2(-(c.x + 0.5 - overPortalSpawn.x), -(c.z + 0.5 - overPortalSpawn.z));
      if (dim === "end") {
        portalTrigger("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z, "You returned to the Overworld");
      } else {
        portalTrigger("end", END_SPAWN.x, END_SPAWN.y, END_SPAWN.z, "You arrived in The End");
      }
      return;
    }
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
  mats: null, hitCount: 0, flee: null,
  dying: 0, deathFlash: 0, deathIdx: 0,
};
const dragonMat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.08 }, opts));
let dragonUnitGeo = null;
let dragonMemGeo = null;
const dragonVec = new THREE.Vector3();
const dragonA = new THREE.Vector3();
const dragonB = new THREE.Vector3();
const dragonFlee = new THREE.Vector3();
const DRAGON_SPEED = 8;
const DRAGON_SKIM_Y = END_PLATFORM_TOP + 2.2;
const DRAGON_SOAR_Y = END_PLATFORM_TOP + 10;
const DRAGON_FLEE_DIST = 16;
const DRAGON_FLEE_SPEED = 11;
const DRAGON_PAINT = [
  [0x0d0d12, 0x16161e, 0x20202a, 0x2a2a36, 0x100f1a], // black (base)
  [0xff2d95, 0xff5aa8, 0xff77b5, 0xffa1cc, 0xff6eb8], // hot pink
  [0x3ddc5a, 0x55e86f, 0x76f68c, 0x9bffad, 0x63e87c], // neon green
  [0xffd12e, 0xffdb5a, 0xffe475, 0xffef9e, 0xffdb63], // gold
  [0x3da6ff, 0x5bb7ff, 0x7cc8ff, 0xa4dbff, 0x63baff], // sky blue
  [0xff9d2e, 0xffb057, 0xffc175, 0xffd49e, 0xffb563], // orange
  [0xff3d5a, 0xff5a74, 0xff7c91, 0xffa4b2, 0xff637f], // crimson
  [0xa63dff, 0xba5bff, 0xcd7cff, 0xe0a4ff, 0xc063ff], // violet
  [0x2ee6d8, 0x57ece2, 0x80f2e8, 0xb0f8f0, 0x63ece0], // cyan
];

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
  const bodyMat = dragonMat(0x0d0d12);
  const bellyMat = dragonMat(0x16161e);
  const plateMat = dragonMat(0x20202a);
  const boneMat = dragonMat(0x2a2a36);
  const memMat = new THREE.MeshStandardMaterial({
    color: 0x100f1a, roughness: 0.9, metalness: 0.02,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc86bff });
  dragon.mats = { bodyMat, bellyMat, plateMat, boneMat, memMat };
  dragon.hitCount = 0;
  dragon.flee = new THREE.Vector3();

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
  dragon.dying = 0; dragon.deathFlash = 0; dragon.deathIdx = 0;
  updateBossBar();
  buildDragonPath();
}

function paintDragonPalette(c) {
  if (!dragon.mesh || !dragon.mats) return;
  dragon.mats.bodyMat.color.setHex(c[0]);
  dragon.mats.bellyMat.color.setHex(c[1]);
  dragon.mats.plateMat.color.setHex(c[2]);
  dragon.mats.boneMat.color.setHex(c[3]);
  dragon.mats.memMat.color.setHex(c[4]);
}

function paintDragon() {
  if (!dragon.mesh || !dragon.mats) return;
  paintDragonPalette(DRAGON_PAINT[1 + (dragon.hitCount % (DRAGON_PAINT.length - 1))]);
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

function buildDragonPath() {
  const N = 7 + (Math.random() * 2 | 0);
  const base = Math.random() * Math.PI * 2;
  const lowBias = Math.random() < 0.3 ? 0.5 : 0.18;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = base + (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
    const wide = i % 2 === 0;
    const r = wide ? 24 + Math.random() * 6 : 12 + Math.random() * 9;
    pts.push(new THREE.Vector3(
      Math.cos(a) * r,
      Math.random() < lowBias ? DRAGON_SKIM_Y + Math.random() * 1.2 : DRAGON_SOAR_Y + Math.random() * 6,
      Math.sin(a) * r
    ));
  }
  pts[0].copy(dragon.mesh.position);
  const n = 180, pos = new Array(n), tmp = new THREE.Vector3();
  const RMAX2 = (END_PLATFORM_R + 6) ** 2;
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

  if (dragon.dying > 0) {
    dragon.dying -= dt;
    dragon.deathFlash -= dt;
    if (dragon.deathFlash <= 0) {
      dragon.deathFlash = 0.08;
      dragon.deathIdx = (dragon.deathIdx + 1) % DRAGON_PAINT.length;
      paintDragonPalette(DRAGON_PAINT[dragon.deathIdx]);
    }
    M.position.x += (Math.random() - 0.5) * 0.3;
    M.position.y += (Math.random() - 0.5) * 0.3;
    M.position.z += (Math.random() - 0.5) * 0.3;
    M.rotation.z = dragon.bank + (Math.random() - 0.5) * 0.5;
    if (dragon.dying <= 0) {
      const dx = M.position.x, dy = M.position.y + 1, dz = M.position.z;
      removeDragon();
      endCleared = true;
      buildReturnPortal();
      queueSave();
      spawnDragonDeath(dx, dy, dz);
      showMsg("Ender Dragon is defeated");
    }
    return;
  }

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
      dragon.nextRun = 2.5 + Math.random() * 3;
      if (Math.random() < 0.6) {
        dragon.spitting = Math.max(dragon.spitting, 1.2 + Math.random() * 0.9);
        dragon.spitTimer = 6 + Math.random() * 5;
      }
    }
    buildDragonPath();
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
  dragonFlee.set(0, 0, 0);
  for (const f of tntLit.values()) {
    if (!f.mesh || f.stuck) continue;
    const dx = M.position.x - f.px, dy = M.position.y - f.py, dz = M.position.z - f.pz;
    const d = Math.hypot(dx, dy, dz);
    if (d < DRAGON_FLEE_DIST && d > 0.001) {
      const w = 1 - d / DRAGON_FLEE_DIST;
      dragonFlee.x += (dx / d) * w;
      dragonFlee.y += (dy / d) * w * 0.4;
      dragonFlee.z += (dz / d) * w;
    }
  }
  if (dragonFlee.lengthSq() > 0.0001) {
    dragonFlee.normalize();
    if (!dragon.flee) dragon.flee = new THREE.Vector3();
    dragon.flee.lerp(dragonFlee, Math.min(1, dt * 3));
    M.position.addScaledVector(dragon.flee, DRAGON_FLEE_SPEED * dt);
  } else if (dragon.flee && dragon.flee.lengthSq() > 0.0001) {
    dragon.flee.multiplyScalar(Math.max(0, 1 - dt * 4));
    M.position.addScaledVector(dragon.flee, DRAGON_FLEE_SPEED * dt);
  }
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
// Endermen (ambient teleporters)
// ---------------------------------------------------------------------------
const ENDERMEN_COUNT = 10;
const endermen = [];
let endermanGeo = null;
let endermanBodyMat = null;
const ENDERMAN_RANGE = 55;
const ENDERMAN_ANGRY_TIME = 4;

function endermanBox(parent, mat, sx, sy, sz, px, py, pz) {
  const m = new THREE.Mesh(endermanGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(px, py, pz);
  parent.add(m);
  return m;
}

function makeEndermanMesh() {
  const g = new THREE.Group();
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xb44cff });
  const legL = new THREE.Group();
  legL.position.set(-0.16, 0.6, 0);
  g.add(legL);
  endermanBox(legL, endermanBodyMat, 0.24, 1.2, 0.24, 0, 0, 0);
  const legR = new THREE.Group();
  legR.position.set(0.16, 0.6, 0);
  g.add(legR);
  endermanBox(legR, endermanBodyMat, 0.24, 1.2, 0.24, 0, 0, 0);
  endermanBox(g, endermanBodyMat, 0.62, 1.0, 0.4, 0, 1.7, 0);
  const head = new THREE.Group();
  head.position.set(0, 2.45, 0);
  g.add(head);
  endermanBox(head, endermanBodyMat, 0.52, 0.5, 0.5, 0, 0, 0);
  for (const sx of [1, -1]) endermanBox(head, eyeMat, 0.09, 0.16, 0.05, sx * 0.16, 0.03, 0.26);
  const armL = new THREE.Group();
  armL.position.set(-0.42, 1.95, 0);
  g.add(armL);
  endermanBox(armL, endermanBodyMat, 0.16, 1.75, 0.16, 0, -0.9, 0);
  const armR = new THREE.Group();
  armR.position.set(0.42, 1.95, 0);
  g.add(armR);
  endermanBox(armR, endermanBodyMat, 0.16, 1.75, 0.16, 0, -0.9, 0);
  return { g, eyeMat, armL, armR, head, t: 0, angry: 0, teleportT: 0, lookT: 0 };
}

function spawnEndermen() {
  if (endermen.length) return;
  endermanGeo = new THREE.BoxGeometry(1, 1, 1);
  endermanBodyMat = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.85, metalness: 0.05 });
  for (let i = 0; i < ENDERMEN_COUNT; i++) {
    const e = makeEndermanMesh();
    const spot = endermanPickSpot(0, 0, 6, endermen);
    e.g.position.set(spot.x, END_PLATFORM_TOP + 1, spot.z);
    e.g.rotation.y = Math.random() * Math.PI * 2;
    e.teleportT = 3 + Math.random() * 7;
    scene.add(e.g);
    endermen.push(e);
  }
}

function removeEndermen() {
  if (!endermen.length) return;
  for (const e of endermen) {
    scene.remove(e.g);
    e.eyeMat.dispose();
  }
  endermen.length = 0;
  if (endermanGeo) { endermanGeo.dispose(); endermanGeo = null; }
  if (endermanBodyMat) { endermanBodyMat.dispose(); endermanBodyMat = null; }
}

function spawnEndermanBurst(cx, cy, cz) {
  const N = 26;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    colA[i * 3] = 0.5 + Math.random() * 0.3;
    colA[i * 3 + 1] = 0.2 + Math.random() * 0.2;
    colA[i * 3 + 2] = 0.75 + Math.random() * 0.25;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 2.5 + Math.random() * 3.5;
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + 1.5;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.3, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 0.7, max: 0.7 });
}

function endermanPickSpot(cx, cz, minDist, others = []) {
  const R = END_PLATFORM_R - 4;
  for (let tries = 0; tries < 24; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = Math.round(cx + Math.cos(a) * r);
    const z = Math.round(cz + Math.sin(a) * r);
    if (Math.abs(x) > R || Math.abs(z) > R) continue;
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < minDist * minDist) continue;
    if (Math.abs(x) <= 3 && Math.abs(z - END_RETURN_Z) <= 3) continue;
    if (isSolid(x, END_PLATFORM_TOP + 1, z) || isSolid(x, END_PLATFORM_TOP + 2, z)) continue;
    let far = true;
    for (const o of others) {
      const ox = o.g ? o.g.position.x : o.x;
      const oz = o.g ? o.g.position.z : o.z;
      if ((x - ox) * (x - ox) + (z - oz) * (z - oz) < 9) { far = false; break; }
    }
    if (!far) continue;
    return { x, z };
  }
  for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 5;
    const x = THREE.MathUtils.clamp(Math.round(cx + Math.cos(a) * r), -R, R);
    const z = THREE.MathUtils.clamp(Math.round(cz + Math.sin(a) * r), -R, R);
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) >= minDist * minDist) return { x, z };
  }
  return { x: THREE.MathUtils.clamp(cx, -R, R), z: THREE.MathUtils.clamp(cz, -R, R) };
}

function endermanTeleport(e, x, z) {
  const M = e.g;
  spawnEndermanBurst(M.position.x, M.position.y + 1.35, M.position.z);
  M.position.x = x;
  M.position.z = z;
  M.position.y = END_PLATFORM_TOP + 1;
  spawnEndermanBurst(M.position.x, M.position.y + 1.35, M.position.z);
}

function endermanOthers(e) {
  return endermen.filter((o) => o !== e);
}

const endermanFwd = new THREE.Vector3();

function updateEndermen(dt) {
  for (let i = 0; i < endermen.length; i++) updateEnderman(endermen[i], dt);
}

function updateEnderman(e, dt) {
  const M = e.g;
  const t = (e.t += dt);
  M.position.y = END_PLATFORM_TOP + 1 + Math.sin(t * 1.3) * 0.02;

  const dx = pos.x - M.position.x;
  const dz = pos.z - M.position.z;
  const distToPlayer = Math.hypot(dx, dz);
  if (distToPlayer > 0.001) {
    let d = Math.atan2(dx, dz) - M.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    M.rotation.y += d * Math.min(1, dt * 6);
  }

  const shaking = e.angry > 0;
  const amp = shaking ? 0.45 : 0.06;
  const phase = shaking ? t * 16 : t * 1.8;
  e.armL.rotation.x = Math.sin(phase) * amp;
  e.armR.rotation.x = Math.sin(phase + 0.6) * amp;
  e.eyeMat.color.setHex(shaking ? 0xff2d95 : 0xb44cff);

  if (e.angry > 0) {
    e.angry -= dt;
    if (e.angry <= 0) {
      const spot = endermanPickSpot(Math.floor(pos.x), Math.floor(pos.z), 8, endermanOthers(e));
      endermanTeleport(e, spot.x, spot.z);
    }
    return;
  }

  e.teleportT -= dt;
  if (e.teleportT <= 0) {
    e.teleportT = 4 + Math.random() * 6;
    const spot = endermanPickSpot(Math.floor(pos.x), Math.floor(pos.z), 5, endermanOthers(e));
    endermanTeleport(e, spot.x, spot.z);
    return;
  }
  if (distToPlayer < 2.5) {
    e.teleportT = 1.5;
    const spot = endermanPickSpot(Math.floor(pos.x), Math.floor(pos.z), 6, endermanOthers(e));
    endermanTeleport(e, spot.x, spot.z);
    return;
  }

  camera.getWorldDirection(endermanFwd);
  const ex = M.position.x, ey = M.position.y + 1.35, ez = M.position.z;
  const vx = ex - pos.x, vy = ey - (pos.y + EYE), vz = ez - pos.z;
  const dist = Math.hypot(vx, vy, vz);
  if (dist < ENDERMAN_RANGE) {
    const dot = (vx * endermanFwd.x + vy * endermanFwd.y + vz * endermanFwd.z) / dist;
    if (dot > 0.995) {
      e.lookT += dt;
      if (e.lookT > 0.35) {
        e.lookT = 0;
        e.angry = ENDERMAN_ANGRY_TIME;
        const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
        const spot = endermanPickSpot(bx + Math.sin(yaw) * 4, bz + Math.cos(yaw) * 4, 2, endermanOthers(e));
        endermanTeleport(e, spot.x, spot.z);
        showMsg("An Enderman is angered — stop staring!");
      }
    } else {
      e.lookT = Math.max(0, e.lookT - dt * 2);
    }
  } else {
    e.lookT = 0;
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
let loading = false;
let menuBusy = false;
const loadingEl = document.getElementById("loading");
function setLoading(on) {
  loading = on;
  if (loadingEl) loadingEl.style.display = on ? "flex" : "none";
}
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
  const count = (map) => { let n = 0; map.forEach(() => n++); return n; };
  const over = worlds.over, end = worlds.end, nether = worlds.nether;
  const on = count(over), en = count(end), nn = count(nether);
  const m = placedFlowers.size;
  const gov = glowVariants.over.size, gev = glowVariants.end.size, gnv = glowVariants.nether.size;
  const buf = new ArrayBuffer(117 + (on + en + nn) * 4 + m * 5 + (gov + gev + gnv) * 4);
  const dv = new DataView(buf);
  let o = 0;
  new Uint8Array(buf, o, 9).set(SAVE_MAGIC); o += 9;
  dv.setUint8(o++, 7); // format version
  dv.setUint8(o++, dim === "end" ? 1 : dim === "nether" ? 2 : 0);
  dv.setInt32(o, seed, true); o += 4;
  dv.setInt32(o, endSeed, true); o += 4;
  dv.setInt32(o, netherSeed, true); o += 4;
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
  const writeMap = (map, n) => {
    dv.setUint32(o, n, true); o += 4;
    map.forEach((id, k) => {
      const [x, y, z] = keyXYZ(k);
      dv.setUint8(o++, x + 128);
      dv.setUint8(o++, y);
      dv.setUint8(o++, z + 128);
      dv.setUint8(o++, id);
    });
  };
  writeMap(over, on);
  writeMap(end, en);
  writeMap(nether, nn);
  dv.setUint32(o, m, true); o += 4;
  placedFlowers.forEach((p, k) => {
    const [fx, fy, fz] = keyXYZ(k);
    dv.setUint8(o++, fx + 128);
    dv.setUint8(o++, fy);
    dv.setUint8(o++, fz + 128);
    dv.setUint8(o++, p.v);
    dv.setUint8(o++, Math.round(p.a / (Math.PI * 2) * 255));
  });
  const writeVariants = (map, n) => {
    dv.setUint32(o, n, true); o += 4;
    map.forEach((v, k) => {
      const [x, y, z] = keyXYZ(k);
      dv.setUint8(o++, x + 128);
      dv.setUint8(o++, y);
      dv.setUint8(o++, z + 128);
      dv.setUint8(o++, v);
    });
  };
  writeVariants(glowVariants.over, gov);
  writeVariants(glowVariants.end, gev);
  writeVariants(glowVariants.nether, gnv);
  return buf;
}

function deserialize(buf) {
  const dv = new DataView(buf);
  let o = 0;
  for (let i = 0; i < 9; i++) if (new Uint8Array(buf, o, 9)[i] !== SAVE_MAGIC[i]) throw new Error("Not a MiniCraft save");
  o += 9;
  const ver = dv.getUint8(o++);
  if (ver !== 1 && ver !== 2 && ver !== 3 && ver !== 4 && ver !== 5 && ver !== 6 && ver !== 7) throw new Error("Unsupported save version");
  placedFlowers.clear();
  glowVariants.over.clear();
  glowVariants.end.clear();
  glowVariants.nether.clear();
  let dimFlag = 0, endSeedVal = endSeed;
  if (ver >= 2) dimFlag = dv.getUint8(o++);
  if (ver >= 4) {
    seed = dv.getInt32(o, true); o += 4;
    endSeed = dv.getInt32(o, true); o += 4;
    netherSeed = dv.getInt32(o, true); o += 4;
  } else {
    seed = dv.getInt32(o, true); o += 4;
    if (ver >= 2) { endSeedVal = dv.getInt32(o, true); o += 4; }
    if (ver >= 2) endSeed = endSeedVal;
  }
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
  if (ver >= 4) {
    const nn = dv.getUint32(o, true); o += 4;
    worlds.nether.clear();
    for (let i = 0; i < nn; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = dv.getUint8(o++);
      const z = dv.getUint8(o++) - 128;
      worlds.nether.set(key(x, y, z), dv.getUint8(o++));
    }
  }
  if (ver >= 3) {
    const m = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < m; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = dv.getUint8(o++);
      const z = dv.getUint8(o++) - 128;
      const v = dv.getUint8(o++);
      const a = dv.getUint8(o++) / 255 * Math.PI * 2;
      placedFlowers.set(key(x, y, z), { v, a });
    }
  }
  if (ver === 5) {
    // v5 saves carried per-torch color entries; torches are gone now, so the
    // entries are skipped (the v5 stream is still parsed and tolerated).
    const t = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < t; i++) { o += 5; }
  }
  if (ver >= 6) {
    const readVariants = (map, legacy) => {
      const g = dv.getUint32(o, true); o += 4;
      for (let i = 0; i < g; i++) {
        const x = dv.getUint8(o++) - 128;
        const y = dv.getUint8(o++);
        const z = dv.getUint8(o++) - 128;
        const v = dv.getUint8(o++);
        const m = legacy ? LEGACY_GLOW_MAP[v] : (v < GLOW_VARIANT_COUNT ? v : undefined);
        if (m !== undefined) map.set(key(x, y, z), m);
      }
    };
    const legacy = ver < 7;   // v6 is the seven-colour era; remap its indices
    readVariants(glowVariants.over, legacy);
    readVariants(glowVariants.end, legacy);
    readVariants(glowVariants.nether, legacy);
  } else {
    // Old saves have no glowstone colours: give every glowstone a clustered
    // colour so pre-built and placed stones don't all revert to green.
    for (const name of ["over", "end", "nether"]) {
      const w = worlds[name];
      const gv = glowVariants[name];
      const assigned = new Map();
      for (const [k, id] of w) {
        if (id !== GLOWSTONE) continue;
        const [x, y, z] = keyXYZ(k);
        let v = -1;
        for (const [ok, ov] of assigned) {
          const [ox, oy, oz] = keyXYZ(ok);
          const dx = ox - x, dy = oy - y, dz = oz - z;
          if (dx * dx + dy * dy + dz * dz < 100) { v = ov; break; }
        }
        if (v < 0) v = Math.floor(Math.random() * GLOW_VARIANT_COUNT);
        gv.set(k, v);
        assigned.set(k, v);
      }
    }
  }
  dim = dimFlag === 2 ? "nether" : dimFlag === 1 ? "end" : "over";
  world = worlds[dim];
  worldDirty = true;
  rebuildPortalBlocks();
  rebuildHotbar();
  recomputeGlowClusters();
  syncGlowLights();
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

function removeEndEntities() {
  if (dragon.mesh) removeDragon();
  if (endermen.length) removeEndermen();
  bossBarEl.style.display = "none";
}

function damageDragon(amount) {
  if (!dragon.mesh || dragon.hp <= 0) return;
  dragon.hp = Math.max(0, dragon.hp - amount);
  dragon.hitCount++;
  paintDragon();
  updateBossBar();
  if (dragon.hp <= 0) {
    dragon.dying = 1;
    dragon.deathFlash = 0;
    dragon.deathIdx = 0;
  }
}

function updateDimLabel() {
  if (!started) { dimEl.style.display = "none"; return; }
  dimEl.textContent = dim === "end" ? "The End" : dim === "nether" ? "The Nether" : "Overworld";
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
      li.onclick = () => { requestLock(); finish(li.dataset.name); };
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
  if (!canSave()) return;
  const buf = serialize();
  worldDirty = false;
  try {
    if (apiOk && saveName) {
      const res = await fetch("api/worlds/" + encodeURIComponent(saveName), {
        method: "PUT", body: buf, keepalive: !!opts.keepalive,
      });
      if (!res.ok) throw new Error("save failed");
    } else if (fileMode) {
      const writable = await saveHandle.createWritable();
      await writable.write(buf);
      await writable.close();
    } else {
      await storageSave(buf);
    }
    lastManualSave = Date.now();
    updateAutosaveEl();
  } catch (e) {
    worldDirty = true;
    if (autosaveEl) autosaveEl.textContent = apiOk
      ? "Save failed — run `python3 server.py` and open http://localhost:8383"
      : fileMode
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
      if (file) requestLock();
      finish(file ? { name: file.name, buf: await file.arrayBuffer() } : null);
    };
    document.body.appendChild(input);
    input.click();
    input.remove();
    addEventListener("focus", onFocus);
  });
}

async function restoreSave(buf) {
  setLoading(true);
  requestLock();
  await new Promise((r) => setTimeout(r, 30));
  try {
    deserialize(buf);
    rebuildMeshes();
    select(selected);
    updateCamera();
    setDimensionEnv();
    updateDimLabel();
    clearPortalFills();
    removeEndEntities();
    if (dim === "end") { endCleared = false; buildReturnPortal(); spawnDragon(); spawnEndermen(); }
    if (dim === "nether") { netReturnWin = null; buildNetherPortal(); }
    scanWorldPortals();
    lastManualSave = Date.now();
    return true;
  } finally {
    setLoading(false);
  }
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
        requestLock();
        setLoading(true);
        const file = await handle.getFile();
        saveName = normalizeWorldName(file.name) || file.name;
        await restoreSave(await file.arrayBuffer());
        await saveToFile();
        updateAutosaveEl();
        return true;
      } catch { setLoading(false); return false; }
    }
    const list = await apiList();
    const name = await pickWorld(list);
    if (!name) return false;
    try {
      saveName = name;
      setLoading(true);
      await restoreSave(await apiLoad(name));
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch {
      setLoading(false);
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
      requestLock();
      setLoading(true);
      const file = await handle.getFile();
      await restoreSave(await file.arrayBuffer());
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch { setLoading(false); return false; }
  }
  const picked = await importSaveFile();
  if (picked) {
    try {
      setLoading(true);
      await restoreSave(picked.buf);
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch {
      setLoading(false);
      if (autosaveEl) autosaveEl.textContent = "That file isn't a valid MiniCraft save.";
      return false;
    }
  }
  const cached = await storageLoad();
  if (cached) {
    try {
      await restoreSave(cached);
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
  clearPortalFills();
  worlds.end.clear();
  worlds.nether.clear();
  portalBlockSets.end.clear();
  portalBlockSets.nether.clear();
  glowstoneBlockSets.end.clear();
  glowstoneBlockSets.nether.clear();
  glowVariants.end.clear();
  glowVariants.nether.clear();
  portalDirty = true;
  worldDirty = true;
  overPortalSpawn = { x: 0.5, y: 1.01, z: 0.5 };
  overPortalFace = null;
  endCleared = false;
  netReturnWin = null;
  protectedBlocks.clear();
  removeEndEntities();
  setDimensionEnv();
  updateDimLabel();
}

async function buildWorld() {
  setLoading(true);
  requestLock();
  await new Promise((r) => setTimeout(r, 30));
  try {
    resetDims();
    seed = Math.floor(Math.random() * 100000);
    endSeed = Math.floor(Math.random() * 100000);
    netherSeed = Math.floor(Math.random() * 100000);
    placedFlowers.clear();
    generateWorld();
    spawnPlayer();
    scanWorldPortals();
    rebuildMeshes();
    rebuildHotbar();
    recomputeGlowClusters();
    syncGlowLights();
    select(0);
    updateCamera();
  } finally {
    setLoading(false);
  }
}

async function regenerate() {
  if (fileMode && !saveHandle) await pickSaveFile();
  await buildWorld();
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
  overlay.style.display = "none";
  crosshair.style.display = "block";
  hotbarEl.style.display = "flex";
  info.style.display = "block";
  resumeBtn.style.display = "none";
  requestLock();
  startLockPoll();
}

let lockPoll = null;
function startLockPoll() {
  if (lockPoll) clearInterval(lockPoll);
  let tries = 0;
  lockPoll = setInterval(() => {
    if (locked || loading || ++tries > 12) {
      clearInterval(lockPoll);
      lockPoll = null;
      return;
    }
    if (!document.pointerLockElement) requestLock();
  }, 400);
}

function requestLock() {
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

setInterval(() => { if (canSave() && started && worldDirty) saveToFile(); }, 10000);
addEventListener("pagehide", () => { if (canSave()) saveToFile({ keepalive: true }); });
document.addEventListener("visibilitychange", () => { if (document.hidden && canSave()) saveToFile({ keepalive: true }); });

// ---------------------------------------------------------------------------
// UI / hotbar
// ---------------------------------------------------------------------------
const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, WATER, FLOWER, TNT, PORTAL, OBSIDIAN];
let selected = 0;
const hotbarEl = document.getElementById("hotbar");

// The hotbar is dimension-aware: in the Nether and the End the Flower slot
// holds GLOWSTONE and the Water slot holds lava; the Overworld keeps
// flowers and water.
function hotbarList() {
  if (dim === "nether" || dim === "end")
    return [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, LAVA, GLOWSTONE, TNT, PORTAL, OBSIDIAN];
  return HOTBAR;
}
function rebuildHotbar() {
  selected = Math.min(selected, hotbarList().length - 1);
  buildHotbar();
}

function iconSrc(id) {
  const texs = materialsFor(id);
  const map = texs[0].map;
  return map.image.toDataURL();
}
function buildHotbar() {
  hotbarEl.innerHTML = "";
  hotbarList().forEach((id, i) => {
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
  selected = ((i % hotbarList().length) + hotbarList().length) % hotbarList().length;
  [...hotbarEl.children].forEach((c, j) => c.classList.toggle("selected", j === selected));
}
document.addEventListener("wheel", (e) => { if (!loading) select(selected + (e.deltaY > 0 ? -1 : 1)); }, { passive: true });

// ---------------------------------------------------------------------------
// Input / pointer lock
// ---------------------------------------------------------------------------
const overlay = document.getElementById("overlay");
const crosshair = document.getElementById("crosshair");
const info = document.getElementById("info");
const resumeBtn = document.getElementById("btnResume");

overlay.addEventListener("click", () => {
  if (!started || loading) return;
  requestLock();
});
resumeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (started && !loading) requestLock();
});
renderer.domElement.addEventListener("click", () => {
  if (started && !locked && !helpOpen && !loading) requestLock();
});

document.addEventListener("pointerlockchange", () => {
  const wasLocked = locked;
  locked = document.pointerLockElement === renderer.domElement;
  if (wasLocked && !locked && lockPoll) { clearInterval(lockPoll); lockPoll = null; }
  if (suppressMenu) { suppressMenu = false; return; }
  if (helpOpen) return;
  if (!locked && Date.now() - helpCloseTime < 2000) return;
  if (wasLocked && !locked && started) saveToFile();
  if (loading) return;
  overlay.style.display = locked ? "none" : "flex";
  crosshair.style.display = locked ? "block" : "none";
  hotbarEl.style.display = locked ? "flex" : "none";
  info.style.display = locked ? "block" : "none";
  resumeBtn.style.display = (!locked && started) ? "block" : "none";
});

document.addEventListener("mousemove", (e) => {
  if (!locked || loading) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});

document.addEventListener("mousedown", (e) => {
  if (!locked || helpOpen || loading) return;
  if (e.button === 0 || e.button === 2) {
    const h = editHold[e.button];
    h.down = true;
    h.t = 0;
    h.acc = 0;
    if (e.button === 0) placeBlock(hotbarList()[selected]);
    else breakBlock();
  }
  if (e.button === 1) { e.preventDefault(); fireGrapple(); }
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0 || e.button === 2) {
    const h = editHold[e.button];
    h.down = false;
    h.t = 0;
    h.acc = 0;
    if (e.button === 0) { chainHome = null; chainPlat = null; chainSpin = 0; }
  }
  if (e.button !== 1 || loading) return;
  if (!grappleActive) return;
  if (grapplePulling) {
    const dx = grappleTarget.x - grappleStart.x, dy = grappleTarget.y - grappleStart.y, dz = grappleTarget.z - grappleStart.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    vel.set((dx / dist) * GRAPPLE_FLING, (dy / dist) * GRAPPLE_FLING, (dz / dist) * GRAPPLE_FLING);
    flingActive = true;
  }
  grappleActive = false;
  grappleArrived = false;
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

const isTyping = (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return true;
  if (t && t.isContentEditable) return true;
  return false;
};
document.addEventListener("keydown", (e) => {
  if (loading || isTyping(e)) return;
  if (helpOpen) {
    if (e.code === "Escape") { closeHelpAndResume(); e.preventDefault(); }
    return;
  }
  if (e.code === "KeyH" && !keys[e.code]) { openHelp(); e.preventDefault(); return; }
  if (keys[e.code]) { e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === "KeyK" && !loading) select(selected - 1);
  if (e.code === "KeyL" && !loading) select(selected + 1);
  if (e.code === "KeyF" && dim !== "end") { freeCam = !freeCam; if (freeCam) camPos.copy(camera.position); else exitFreeCam(); }
  if (e.code === "Escape") { if (saveName) saveToFile(); }
  if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.getElementById("btnNew").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (menuBusy || loading) return;
  menuBusy = true;
  try {
    apiOk = await apiOkPromise;
    if (apiOk) {
      const name = await askName("New World", "world");
      if (!name) return;
      const existing = await apiList();
      if (existing.some((w) => w.name === name) && !confirm("Overwrite existing save '" + name.replace(/\.sav$/i, "") + "'?")) return;
      saveName = name;
      await buildWorld();
      enterGame();
      await saveToFile();
      return;
    }
    if (fileMode) await pickSaveFile();
    await buildWorld();
    enterGame();
  } finally {
    menuBusy = false;
  }
});
document.getElementById("btnLoad").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (menuBusy || loading) return;
  menuBusy = true;
  try {
    if (await loadSave()) enterGame();
  } finally {
    menuBusy = false;
  }
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

  if (!loading) {
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
    if (locked) {
      for (const b of [0, 2]) {
        const h = editHold[b];
        if (!h.down) continue;
        h.t += dt;
        const chained = h.t - CHAIN_HOLD;
        if (chained < 0) continue;
        const step = 1 / Math.min(MAX_CHAIN_RATE, CHAIN_RATE + CHAIN_ACCEL * chained);
        h.acc += dt;
        while (h.acc >= step) {
          h.acc -= step;
          if (b === 0) chainStep();
          else breakBlock();
        }
      }
    } else {
      editHold[0].down = editHold[2].down = false;
      editHold[0].t = editHold[2].t = 0;
      editHold[0].acc = editHold[2].acc = 0;
      chainHome = null;
      chainPlat = null;
      chainSpin = 0;
    }
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
    syncGlowLights(dt);
    if (portalCd > 0) portalCd -= dt;
    updatePortalVisual();
    checkPortal();
    if (dim === "end") updateDragon(dt);
    if (dim === "end") updateEndermen(dt);
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }

    // Gentle water shimmer
    if (typeMats.has(WATER)) {
      const o = 0.55 + 0.1 * Math.sin(now * 0.002);
      for (const m of typeMats.get(WATER)) m.opacity = o;
    }

    // Glowing lava flicker
    if (typeMats.has(LAVA)) {
      const k = 1.1 + 0.15 * Math.sin(now * 0.005) * Math.sin(now * 0.0013 + 1);
      for (const m of typeMats.get(LAVA)) m.color.setScalar(k);
    }

    const pcx = chunkOf(freeCam ? camPos.x : pos.x);
    const pcz = chunkOf(freeCam ? camPos.z : pos.z);
    if (pcx !== meshCx || pcz !== meshCz) streamChunks();
    drainChunkQueue();
  }

  if (skyDome.visible) {
    skyDome.position.copy(camera.position);
    skyDome.rotation.y += dt * 0.01;
  }

  renderer.render(scene, camera);
}

const SVGNS = "http://www.w3.org/2000/svg";
let dt = 0.016;
buildHotbar();
buildPortalArt();
buildNetherPortalArt();
buildPortalSpiral();
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

// Builds tapered winding spiral arms on the given SVG (shared radial gradient
// so the swirl is brightest at the centre). Each arm is a closed curved strip
// sweeping outward while winding around the origin.
function buildSpiralArms(svg, arms, turns, rOut, rIn, angHalf, gradId) {
  if (!svg) return;
  const steps = 64;
  for (let a = 0; a < arms; a++) {
    const base = (a / arms) * Math.PI * 2;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = rIn + (rOut - rIn) * t;
      const th = base + t * turns * Math.PI * 2;
      d += (i === 0 ? "M " : " L ") + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const r = rIn + (rOut - rIn) * t;
      const th = base + t * turns * Math.PI * 2 + angHalf;
      d += " L " + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
    }
    d += " Z";
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", gradId ? "url(#" + gradId + ")" : "#9b30ff");
    path.setAttribute("opacity", "0.92");
    svg.appendChild(path);
  }
}

function buildPortalSpiral() {
  const front = document.getElementById("portalSpiralFront");
  const back = document.getElementById("portalSpiralBack");
  if (front) {
    const defs = document.createElementNS(SVGNS, "defs");
    const grad = document.createElementNS(SVGNS, "radialGradient");
    grad.setAttribute("id", "spiralGrad");
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("cx", "0"); grad.setAttribute("cy", "0"); grad.setAttribute("r", "100");
    const stops = [["0%", "#eab4ff"], ["55%", "#9b30ff"], ["100%", "#2b0a4d"]];
    for (const [off, col] of stops) {
      const s = document.createElementNS(SVGNS, "stop");
      s.setAttribute("offset", off); s.setAttribute("stop-color", col);
      grad.appendChild(s);
    }
    defs.appendChild(grad);
    front.appendChild(defs);
  }
  buildSpiralArms(front, 6, 1.5, 98, 6, 16 * Math.PI / 180, "spiralGrad");
  buildSpiralArms(back, 4, 2.2, 82, 4, 24 * Math.PI / 180, null);
}

function buildNetherPortalArt() {
  const host = document.getElementById("netherArt");
  if (!host) return;
  const nw = 5, nh = 4, cell = 19, size = 15, off = 6;
  const w = off * 2 + (nw - 1) * cell + size;
  const h = off * 2 + (nh - 1) * cell + size;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "150");
  svg.setAttribute("height", String(Math.round(150 * h / w)));
  for (let r = 0; r < nh; r++)
    for (let c = 0; c < nw; c++) {
      if (r !== 0 && r !== nh - 1 && c !== 0 && c !== nw - 1) continue;
      const x = off + c * cell, y = off + r * cell;
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", size); rect.setAttribute("height", size); rect.setAttribute("rx", 3);
      rect.setAttribute("fill", "#0a0a0a");
      rect.setAttribute("stroke", "#8b90a0"); rect.setAttribute("stroke-width", "1.5");
      svg.appendChild(rect);
    }
  host.appendChild(svg);
}
