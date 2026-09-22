import * as THREE from "three";

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, WATER = 7, PLANKS = 8, GLASS = 9, TNT = 10, FLOWER = 11, PORTAL = 12, ENDSTONE = 13, CLOUD = 14, OBSIDIAN = 15, LAVA = 16, NETHERRACK = 17, SOULSAND = 18, MOON = 19, GLOWSTONE = 20, MOON_WATER = 21;

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
  [MOON]:     { name: "Moon",     solid: true,  opaque: true,  placeable: false },
  [MOON_WATER]:{ name: "Moon Water", solid: false, opaque: false, placeable: true },
  [GLOWSTONE]:{ name: "Glowstone",  solid: true, opaque: true, placeable: true },
};
function isLiquid(id) { return id === WATER || id === LAVA || id === MOON_WATER; }

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

// Moon-pine tree-top star: single Diamant style on the Classic 5-branch base
// (stepped 3D pyramids, symmetric). One global style, no selection key: every
// finished planted pine wears it.
const STAR_STYLES = [
  { name: "Diamant", cube: 0.07, grid: 8, R: 8.4, r: 3.5, points: 5, relief: "diamond" },
];
const STAR_STYLE_NAMES = STAR_STYLES.map((s) => s.name);
const STAR_STYLE_COUNT = STAR_STYLES.length;
// Shade ids: 0 rim, 1 slopeL (lit), 2 slopeR (shaded), 3 ridge, 4 core, 5 stem.
const STAR_YELLOW = [
  [0.70, 0.48, 0.04],
  [1.00, 0.95, 0.00],
  [0.95, 0.76, 0.00],
  [1.00, 0.97, 0.50],
  [1.00, 0.98, 0.85],
  [0.55, 0.38, 0.05],
];

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
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
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
  dirtWet: makeTex([76, 49, 29], 26),
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
  moon: canvasTex((ctx) => {
    ctx.fillStyle = "#7a7e82"; ctx.fillRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (Math.random() * 2 - 1) * 16 + (Math.random() * 2 - 1) * 8;
      const v = 122 + n;
      ctx.fillStyle = `rgb(${v | 0},${(v + 1) | 0},${(v + 2) | 0})`;
      if (Math.random() < 0.58) ctx.fillRect(x, y, 1, 1);
    }
    const crater = (x, y, r, shade) => {
      const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.12, x, y, r);
      g.addColorStop(0, `rgba(${shade[0] + 14},${shade[1] + 14},${shade[2] + 14},0.92)`);
      g.addColorStop(0.30, `rgba(${shade[0]},${shade[1]},${shade[2]},0.95)`);
      g.addColorStop(0.62, `rgba(${shade[0] - 16},${shade[1] - 16},${shade[2] - 16},0.96)`);
      g.addColorStop(0.85, `rgba(${shade[0] - 28},${shade[1] - 28},${shade[2] - 28},0.97)`);
      g.addColorStop(1, `rgba(${shade[0] + 8},${shade[1] + 8},${shade[2] + 8},0.88)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.arc(x + r * 0.20, y + r * 0.22, r * 0.48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.arc(x - r * 0.26, y - r * 0.28, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(70,72,74,0.42)"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    };
    const shades = [[110,112,114],[104,106,108],[116,118,120],[98,100,102]];
    crater(4.4, 4.7, 3.2, shades[0]);
    crater(12.0, 5.1, 2.7, shades[1]);
    crater(8.6, 11.0, 3.5, shades[2]);
    crater(3.0, 12.4, 2.0, shades[3]);
    crater(13.4, 11.8, 1.8, shades[0]);
    crater(6.4, 8.4, 1.5, shades[1]);
    crater(9.2, 3.4, 1.2, shades[2]);
    for (let i = 0; i < 22; i++) {
      const x = Math.random() * 16, y = Math.random() * 16;
      const v = 86 + Math.random() * 32;
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 1) | 0},${0.14 + Math.random() * 0.16})`;
      ctx.fillRect(x | 0, y | 0, 1, 1);
    }
  }),
  moonwater: canvasTex((ctx) => {
    ctx.fillStyle = "#7a7e82"; ctx.fillRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (Math.random() * 2 - 1) * 9;
      const v = 122 + n;
      ctx.fillStyle = `rgb(${v | 0},${(v + 1) | 0},${(v + 2) | 0})`;
      if (Math.random() < 0.54) ctx.fillRect(x, y, 1, 1);
    }
    const craterLake = (x, y, r, s) => {
      const g = ctx.createRadialGradient(x - r * 0.28, y - r * 0.28, r * 0.10, x, y, r);
      g.addColorStop(0, `rgba(${s[0] - 8},${s[1] - 8},${s[2] - 6},0.95)`);
      g.addColorStop(0.45, `rgba(${s[0] - 14},${s[1] - 14},${s[2] - 12},0.96)`);
      g.addColorStop(0.78, `rgba(${s[0] + 6},${s[1] + 6},${s[2] + 8},0.96)`);
      g.addColorStop(1, `rgba(${s[0] + 12},${s[1] + 12},${s[2] + 14},0.92)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(88,92,98,0.38)"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    };
    craterLake(8, 8, 4.2, [110, 112, 114]);
    craterLake(4.5, 12.5, 2.0, [104, 106, 108]);
    craterLake(12.8, 4.2, 1.7, [112, 114, 116]);
    for (let i = 0; i < 12; i++) {
      const v = 108 + Math.random() * 20;
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 1) | 0},0.13)`;
      ctx.fillRect(Math.random() * 16 | 0, Math.random() * 16 | 0, 1, 1);
    }
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
    case MOON: return basicFace(TEX.moon, { fog: false });
    case MOON_WATER: return basicFace(TEX.moonwater, { fog: false });
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
const MAX_Y = 999;
const MAX_TREE_H = 50;
const CLOUD_BASE = 2 * MAX_TREE_H;
const CLOUD_LAYER = 2.4 * MAX_TREE_H;
const CLOUD_LAYERS = 3;
const CLOUD_TOP = CLOUD_BASE + CLOUD_LAYERS * CLOUD_LAYER;
const CLOUD_SPAN = CLOUD_TOP - CLOUD_BASE;
const MOON_THICK = 5;
const MOON_Y = Math.min(MAX_Y - 1, CLOUD_TOP + CLOUD_SPAN);
const MOON_R = WORLD_RADIUS;
const MOON_FADE_START = CLOUD_BASE + CLOUD_SPAN * 5 / 6;
const MOON_FADE_END = CLOUD_BASE + CLOUD_SPAN * 7 / 8;
const MOON_BOTTOM = MOON_Y - MOON_R;
const LAKES_FADE_START = MOON_FADE_END;
const LAKES_FADE_END = MOON_Y;
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
const END_PLATFORM_TOP = 0;
const END_PLATFORM_R = 36;
const END_RETURN_Z = 16;
const END_MOB_R = END_PLATFORM_R;
function endMobInEnd(m) { return (m && m.dim !== undefined ? m.dim : dim) === "end"; }
function endClampXZPos(p) {
  p.x = endSquareCoord(p.x);
  p.z = endSquareCoord(p.z);
  return p;
}
function endSquareCoord(v) {
  return Math.max(-END_PLATFORM_R + 0.5, Math.min(END_PLATFORM_R + 0.5, v));
}
function endClampYFlying(y) { return Math.max(DRAGON_MIN_Y, Math.min(DRAGON_MAX_Y, y)); }
function endClampTargetVec(v) {
  v.x = endSquareCoord(v.x);
  v.z = endSquareCoord(v.z);
  v.y = endClampYFlying(v.y);
  return v;
}
function endBlockOutsidePlatform(px, pz) {
  return px < -END_PLATFORM_R || px > END_PLATFORM_R || pz < -END_PLATFORM_R || pz > END_PLATFORM_R;
}
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
const colTops = {
  over: new Uint16Array(KEY_MZ * KEY_MZ),
  end: new Uint16Array(KEY_MZ * KEY_MZ),
  nether: new Uint16Array(KEY_MZ * KEY_MZ),
};
const colTopIdx = (x, z) => (x + KEY_OFF) * KEY_MZ + (z + KEY_OFF);
function rebuildColTops(only) {
  for (const name of only ? [only] : ["over", "end", "nether"]) {
    const ct = colTops[name];
    ct.fill(0);
    worlds[name].forEach((id, k) => {
      const [x, y, z] = keyXYZ(k);
      const ci = colTopIdx(x, z);
      if (y > ct[ci]) ct[ci] = y;
    });
  }
}
function key(x, y, z) { return (x + KEY_OFF) * KEY_MY + y * KEY_MZ + (z + KEY_OFF); }
function keyXYZ(k) {
  const z = (k % KEY_MZ) - KEY_OFF;
  const t = Math.floor(k / KEY_MZ);
  const y = t % KEY_MZ;
  const x = Math.floor(t / KEY_MZ) - KEY_OFF;
  return [x, y, z];
}

const worlds = { over: new Map(), end: new Map(), nether: new Map() };
// DEV ONLY: start dimension for new worlds. Set back to "over" to restore
// the normal spawn behaviour.
const DEV_START_DIM = "over";
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

let portalDirty = true;
let worldDirty = true;
let glowDefer = 0;
let glowDirtyDeferred = false;
let placeBatch = null;

// Villager-planted pines (Overworld, anywhere including the Moon). Pouring
// WATER or MOON_WATER directly on top of any DIRT block soaks in over 0.5s: the water is
// absorbed and the soil turns wet. Only wet soil amid 8 solid neighbours
// (same y, incl. diagonals and DIRT itself) or sitting on solid ground
// (solid block below, 8 solid neighbours at y-1) attracts a nearby adult
// villager, which walks over, bows the neck 40deg toward it while a 2.5s
// TNT-style timer ticks above the block, then the timer vanishes and a pine
// grows at PINE_RATE/s.
const growableSoils = new Map();
const wetSoilSet = new Set(); // keys of growableSoils entries with wet=true
const plantClaims = new Map();
const pineGrowths = [];
const soilTimerSprites = new Map();
const GROWABLE_DIST = 100; // detection radius, not tied to VILLAGE_RADIUS (declared below)
const PLANT_STEAL_D = 2;
const PLANT_NECK = 40 * Math.PI / 180;
const PLANT_NECK_Y = 1.45;
const SOIL_TIMER = 2.5;
const SOIL_SOAK_TIME = 0.5;
const PLANT_BEND_TIME = 1.5;
const PLANT_LEAVE_DIST = 8;
function soilSameY(m, g) { return Math.abs(Math.floor(m.pos.y) - (g.y + 1)) <= 1; }
function setVillagerNeck(m, on) {
  const mesh = m.mesh;
  const parts = mesh && mesh.userData ? [mesh.userData.neck, mesh.userData.head, mesh.userData.nose].filter(Boolean) : [];
  if (!mesh || !parts.length) return;
  const ud = mesh.userData;
  if (on) {
    if (!ud.neckBase || ud.neckBase.mesh !== mesh) {
      ud.neckBase = { mesh, parts: parts.map((p) => ({ p, pos: p.position.clone(), rot: p.rotation.x })) };
    }
    const sc = ud.sc || 1;
    const px = 0, py = PLANT_NECK_Y * sc, pz = 0;
    const c = Math.cos(PLANT_NECK), s = Math.sin(PLANT_NECK);
    for (const e of ud.neckBase.parts) {
      e.p.rotation.x = e.rot + PLANT_NECK;
      const dx = e.pos.x - px, dy = e.pos.y - py, dz = e.pos.z - pz;
      e.p.position.set(px + dx, py + dy * c - dz * s, pz + dy * s + dz * c);
    }
  } else if (ud.neckBase && ud.neckBase.mesh === mesh) {
    for (const e of ud.neckBase.parts) { e.p.rotation.x = e.rot; e.p.position.copy(e.pos); }
    ud.neckBase = null;
  }
}
const PINE_RATE = 40;
const PINE_PHASE_TIME = 0.5;
const PINE_MIN_M = 1;
const PINE_MAX_M = 6;
  const MOON_PINE_MAX_M = 8;   // moon soils draw crown levels 3..8 instead of 3..6
const PINE_LIFT_MAX = 24;
// Villager-planted pines are cones: each foliage layer is a Euclidean disc in
// checkerboard parity, crowned with a two-block tip (apex + one block above).
function isSolidId(id) { return !!BLOCK_INFO[id] && BLOCK_INFO[id].solid; }
function isSoilHole(x, y, z) {
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      if (!isSolidId(getBlock(x + dx, y, z + dz))) return false;
    }
  return true;
}
function isSoilFloor(x, y, z) {
  if (y <= 0 || !isSolidId(getBlock(x, y - 1, z))) return false;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      if (!isSolidId(getBlock(x + dx, y - 1, z + dz))) return false;
    }
  return true;
}
function soilTimerSprite(k, g) {
  let spr = soilTimerSprites.get(k);
  if (!spr) {
    spr = makeFuseSprite();
    spr.position.set(g.x + 0.5, g.y + 2.3, g.z + 0.5);
    scene.add(spr);
    soilTimerSprites.set(k, spr);
  }
  return spr;
}
function clearSoilTimerSprite(k) {
  const spr = soilTimerSprites.get(k);
  if (spr) {
    soilTimerSprites.delete(k);
    scene.remove(spr);
    if (spr.material) {
      if (spr.material.map) spr.material.map.dispose();
      spr.material.dispose();
    }
  }
}
function clearAllSoilTimerSprites() {
  for (const k of [...soilTimerSprites.keys()]) clearSoilTimerSprite(k);
}
function releaseGrowable(k) {
  growableSoils.delete(k);
  wetSoilSet.delete(k);
  releasePineCells(k);
  if (plantedPines.delete(k)) garlandDirty = true;
  for (const bk of [...brokenPineCells]) if (bk.startsWith(k + "|")) brokenPineCells.delete(bk);
  clearSoakMesh(k);
  clearSoilTimerSprite(k);
  const holder = plantClaims.get(k);
  if (holder != null) {
    plantClaims.delete(k);
    const hm = typeof mobById !== "undefined" ? mobById.get(holder) : null;
    if (hm && hm.plantKey === k) {
      hm.mode = "wander"; hm.speed = WALK / 2;
      hm.plantKey = null;
      hm.plantTarget = null;
      hm.plantGoal = null;
      hm.plantPhase = null;
      setVillagerNeck(hm, false);
    }
  }
}
const soakMeshes = new Map(); // soil key -> sinking water mesh (wet look "soak")
let soakMeshGeo = null, soakMeshMat = null, soakMeshMatMoon = null;
function clearSoakMesh(k) {
  const m = soakMeshes.get(k);
  if (m) { soakMeshes.delete(k); scene.remove(m); }
}
function clearAllSoakMeshes() { for (const k of [...soakMeshes.keys()]) clearSoakMesh(k); }
function syncSoakMesh(k, g) {
  if (g.soak == null) { clearSoakMesh(k); return; }
  if (!soakMeshGeo) soakMeshGeo = new THREE.BoxGeometry(0.9, 1, 0.9);
  if (!soakMeshMat) soakMeshMat = new THREE.MeshLambertMaterial({ color: 0x3a6fd8, transparent: true, opacity: 0.75 });
  if (!soakMeshMatMoon) soakMeshMatMoon = new THREE.MeshLambertMaterial({ color: 0x7a7e82, transparent: true, opacity: 0.75 });
  const mat = g.liq === MOON_WATER ? soakMeshMatMoon : soakMeshMat;
  let m = soakMeshes.get(k);
  if (!m) {
    m = new THREE.Mesh(soakMeshGeo, mat);
    scene.add(m);
    soakMeshes.set(k, m);
  } else if (m.material !== mat) m.material = mat;
  const p = Math.max(0, Math.min(1, g.soak / SOIL_SOAK_TIME));
  m.position.set(g.x + 0.5, g.y + 1 + p / 2, g.z + 0.5);
  m.scale.set(1, Math.max(0.001, p), 1);
}
function spawnSoakDrips(cx, cy, cz, liq) {
  const N = 14;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const moon = liq === MOON_WATER;
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    if (moon) {
      colA[i * 3] = 0.45 + Math.random() * 0.15;
      colA[i * 3 + 1] = 0.46 + Math.random() * 0.15;
      colA[i * 3 + 2] = 0.48 + Math.random() * 0.15;
    } else {
      colA[i * 3] = 0.25 + Math.random() * 0.2;
      colA[i * 3 + 1] = 0.45 + Math.random() * 0.2;
      colA[i * 3 + 2] = 0.85 + Math.random() * 0.15;
    }
    const th = Math.random() * Math.PI * 2;
    const s = 0.5 + Math.random() * 1.5;
    vel[i * 3] = s * Math.cos(th);
    vel[i * 3 + 1] = -1 - Math.random() * 2;
    vel[i * 3 + 2] = s * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.22, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 0.5, max: 0.5, tag: 4, fx: cx, fy: cy, fz: cz });
}
function armSoak(x, y, z, liq) {
  if (dim !== "over" || world !== worlds.over) return false;
  if (getBlock(x, y, z) !== DIRT) return false;
  if (liq !== MOON_WATER && liq !== WATER) liq = WATER;
  const k = key(x, y, z);
  if (pineFailBlinks.has(k)) {
    setBlock(x, y + 1, z, AIR);
    refreshBlocks([[x, y + 1, z]]);
    queueSave();
    return false;
  }
  if (pineSpotBlocked(x, y, z)) {
    setBlock(x, y + 1, z, AIR);
    refreshBlocks([[x, y + 1, z]]);
    startPineFailBlink(x, y, z);
    queueSave();
    return false;
  }
  const soakDims = pickPineDims(x, y, z, k);
  if (!soakDims) {
    setBlock(x, y + 1, z, AIR);
    refreshBlocks([[x, y + 1, z]]);
    startPineFailBlink(x, y, z);
    queueSave();
    return false;
  }
  reservePineCells(k, pineCellsFor(x, y, z, soakDims.m, soakDims.e));
  let g = growableSoils.get(k);
  if (!g) { g = { x, y, z, timer: null, wet: false, soak: null, liq }; growableSoils.set(k, g); }
  if (g.wet || g.soak != null) return false;
  g.soak = SOIL_SOAK_TIME;
  g.liq = liq;
  setBlock(x, y + 1, z, AIR);
  refreshBlocks([[x, y + 1, z]]);
  spawnSoakDrips(x + 0.5, y + 1.5, z + 0.5, liq);
  syncSoakMesh(k, g);
  queueSave();
  return true;
}
function absorbSoak(k, g) {
  g.soak = null;
  g.wet = true;
  wetSoilSet.add(k);
  clearSoakMesh(k);
  const above = getBlock(g.x, g.y + 1, g.z);
  if (above === WATER || above === MOON_WATER) setBlock(g.x, g.y + 1, g.z, AIR);
  spawnSoakDrips(g.x + 0.5, g.y + 1.2, g.z + 0.5, g.liq);
  refreshBlocks([[g.x, g.y, g.z], [g.x, g.y + 1, g.z]]);
  queueSave();
}
const PINE_FAIL_BLINKS = 3;
const PINE_FAIL_BLINK_STEP = 0.2;
const pineFailBlinks = new Map();
let pineFailGeo = null, pineFailMat = null;
function startPineFailBlink(x, y, z) {
  const k = key(x, y, z);
  if (pineFailBlinks.has(k)) return;
  if (!pineFailGeo) pineFailGeo = new THREE.BoxGeometry(1.06, 1.06, 1.06);
  if (!pineFailMat) pineFailMat = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.55, depthWrite: false });
  const mesh = new THREE.Mesh(pineFailGeo, pineFailMat);
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
  pineFailBlinks.set(k, { x, y, z, t: 0, mesh });
}
function clearPineFailBlink(k) {
  const b = pineFailBlinks.get(k);
  if (b) { pineFailBlinks.delete(k); scene.remove(b.mesh); }
}
function clearAllPineFailBlinks() { for (const k of [...pineFailBlinks.keys()]) clearPineFailBlink(k); }
const reservedPineCells = new Map();
function reservePineCells(owner, cells) {
  for (const c of cells) reservedPineCells.set(key(c.x, c.y, c.z), { o: owner, f: c.id !== LOG });
}
function releasePineCells(owner) {
  for (const [ck, rec] of reservedPineCells) if (rec.o === owner) reservedPineCells.delete(ck);
}
function clearAllPineReservations() { reservedPineCells.clear(); }
function pineCellReserved(x, y, z, owner) {
  const rec = reservedPineCells.get(key(x, y, z));
  return rec !== undefined && rec.o !== owner;
}
function pineFolReserved(x, y, z, owner) {
  const rec = reservedPineCells.get(key(x, y, z));
  return rec !== undefined && rec.o !== owner && rec.f;
}
function tickPineFailBlinks(dt) {
  if (dim !== "over" || world !== worlds.over) return;
  for (const [k, b] of pineFailBlinks) {
    if (getBlock(b.x, b.y, b.z) !== DIRT) { clearPineFailBlink(k); continue; }
    b.t += dt;
    if (Math.floor(b.t / (PINE_FAIL_BLINK_STEP * 2)) >= PINE_FAIL_BLINKS) {
      clearPineFailBlink(k);
      continue;
    }
    b.mesh.visible = Math.floor(b.t / PINE_FAIL_BLINK_STEP) % 2 === 0;
  }
}
function claimFree(k, m) {
  const holder = plantClaims.get(k);
  if (holder == null || holder === m.id) return true;
  const hm = typeof mobById !== "undefined" ? mobById.get(holder) : null;
  if (!hm || hm.mode !== "goPlant" || hm.plantKey !== k) { plantClaims.delete(k); return true; }
  return false;
}
function pineLayerWidths(m) {
  if (m <= 1) return [1, 3, 3];
  const ws = [1];
  for (let k = 1; k <= m; k++) {
    const w = 2 * k + 1;
    const n = 3 + Math.floor((m - k) / 2);
    for (let i = 0; i < n; i++) ws.push(w);
  }
  return ws;
}
function pineTrunkE0(m) {
  if (m <= 1) return 2;
  return Math.max(1, Math.round((pineLayerWidths(m).length - 1) / 4));
}
function pineSpiralOrder(h) {
  const cells = [];
  const seen = new Set();
  const total = (2 * h + 1) * (2 * h + 1);
  let x = 0, z = 0;
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const take = (px, pz) => {
    if (Math.abs(px) > h || Math.abs(pz) > h) return;
    const k = px + "," + pz;
    if (seen.has(k)) return;
    seen.add(k);
    cells.push([px, pz]);
  };
  take(0, 0);
  for (let leg = 0; cells.length < total; leg++) {
    const d = dirs[leg % 4], len = (leg >> 1) + 1;
    for (let i = 0; i < len && cells.length < total; i++) { x += d[0]; z += d[1]; take(x, z); }
  }
  return cells;
}
function pineSummit(y, m, e) {
  return y + e + pineLayerWidths(m).length + 1;
}
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function pineFits(x, y, z, m, e, owner) {
  const summit = pineSummit(y, m, e);
  if (summit > MAX_Y) return false;
  const cells = pineCellsFor(x, y, z, m, e);
  const own = new Set();
  for (const c of cells) own.add(key(c.x, c.y, c.z));
  for (const c of cells) {
    if (c.id === LOG) {
      if (getBlock(c.x, c.y, c.z) === LEAVES) return false;
      if (pineFolReserved(c.x, c.y, c.z, owner)) return false;
      continue;
    }
    if (getBlock(c.x, c.y, c.z) !== AIR) return false;
    if (pineCellReserved(c.x, c.y, c.z, owner)) return false;
    for (const [dx, dy, dz] of DIRS6) {
      const nx = c.x + dx, ny = c.y + dy, nz = c.z + dz;
      const nk = key(nx, ny, nz);
      if (own.has(nk)) continue;
      if (getBlock(nx, ny, nz) !== AIR) return false;
      if (pineCellReserved(nx, ny, nz, owner)) return false;
    }
  }
  return true;
}
function pineSpotBlocked(x, y, z) {
  for (const g of growableSoils.values()) {
    if (g.x === x && g.y === y && g.z === z) continue;
    if (Math.abs(g.x - x) <= 1 && Math.abs(g.z - z) <= 1 && Math.abs(g.y - y) <= 1) return true;
  }
  for (const g of pineGrowths) {
    if (Math.abs(g.sx - x) <= 1 && Math.abs(g.sz - z) <= 1 && Math.abs(g.sy - y) <= 1) return true;
  }
  return false;
}
function pineCellsFor(x, y, z, m, e) {
  const cells = [];
  const ws = pineLayerWidths(m);
  const summit = pineSummit(y, m, e);
  const lMax = ws.length - 1;
  for (let cy = y + 1; cy <= y + e; cy++) cells.push({ x, y: cy, z, id: LOG, s: 0 });
  const layerCells = (l, rMin, rMax, s) => {
    const out = [];
    const h = (ws[l] - 1) / 2, ly = summit - 1 - l;
    for (const [ox, oz] of pineSpiralOrder(h)) {
      const r = Math.hypot(ox, oz);
      if (rMax <= 1) { if (r > rMax + 0.5) continue; }
      else if (r < rMin - 0.5 || r > rMax + 0.5) continue;
      if (((ox + oz) & 1) !== (l % 2)) continue;
      out.push({ x: x + ox, y: ly, z: z + oz, id: LEAVES, s });
    }
    return out;
  };
  for (let l = lMax; l >= 1; l--) cells.push(...layerCells(l, 0, 1, 3));
  cells.push({ x, y: summit - 1, z, id: LEAVES, s: 3 });
  cells.push({ x, y: summit, z, id: LEAVES, s: 3 });
  let topDown = true;
  for (let s = 5; s <= 2 * m + 1; s += 2) {
    const hs = (s - 1) / 2, ls = [];
    for (let l = 1; l <= lMax; l++) if (ws[l] >= s) ls.push(l);
    if (!topDown) ls.reverse();
    for (const l of ls) cells.push(...layerCells(l, hs, hs, s));
    topDown = !topDown;
  }
  return cells;
}
function pinePhaseCounts(cells) {
  const counts = {};
  for (const c of cells) counts[c.s] = (counts[c.s] || 0) + 1;
  return counts;
}
function fitTrunkRange(x, y, z, m, eFrom, eMax, owner) {
  for (let e = eFrom; e <= eMax; e++) {
    if (pineSummit(y, m, e) > MAX_Y) break;
    if (pineFits(x, y, z, m, e, owner)) {
      const eb = e + 2;
      if (eb <= eMax && pineSummit(y, m, eb) <= MAX_Y && pineFits(x, y, z, m, eb, owner)) return { m, e: eb };
      return { m, e };
    }
  }
  return null;
}
function pickPineDims(x, y, z, owner) {
  const maxM = moonZoneGeo(x, y, z) ? MOON_PINE_MAX_M : PINE_MAX_M;
  // Main draw: 3..maxM (2 is reserved for cramped spots, 1 for last resort).
  const ms = [];
  for (let m = PINE_MIN_M + 2; m <= maxM; m++) ms.push(m);
  for (let i = ms.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ms[i]; ms[i] = ms[j]; ms[j] = tmp;
  }
  for (const m of ms) {
    const e0 = pineTrunkE0(m);
    if (pineFits(x, y, z, m, e0, owner)) return { m, e: e0 };
  }
  for (const m of ms) {
    const e0 = pineTrunkE0(m);
    for (let e = e0 - 1; e >= 1; e--) {
      if (pineFits(x, y, z, m, e, owner)) return { m, e };
    }
  }
  for (const m of ms) {
    const e0 = pineTrunkE0(m);
    const fit = fitTrunkRange(x, y, z, m, e0 + 1, e0 + PINE_LIFT_MAX, owner);
    if (fit) return fit;
  }
  // No room for 3..maxM: fall back to a small m=2 pine before the minimum.
  {
    const m = PINE_MIN_M + 1;
    const e0 = pineTrunkE0(m);
    if (pineFits(x, y, z, m, e0, owner)) return { m, e: e0 };
    for (let e = e0 - 1; e >= 1; e--) {
      if (pineFits(x, y, z, m, e, owner)) return { m, e };
    }
    const fit = fitTrunkRange(x, y, z, m, e0 + 1, e0 + PINE_LIFT_MAX, owner);
    if (fit) return fit;
  }
  for (let m = PINE_MIN_M; m <= maxM; m++) {
    const e0 = pineTrunkE0(m);
    const eMax = MAX_Y - y - pineLayerWidths(m).length - 1;
    if (m === PINE_MIN_M) {
      if (pineFits(x, y, z, m, e0, owner)) return { m, e: e0 };
      for (let e = e0 - 1; e >= 1; e--) {
        if (pineFits(x, y, z, m, e, owner)) return { m, e };
      }
      const fit = fitTrunkRange(x, y, z, m, e0 + 1, eMax, owner);
      if (fit) return fit;
    } else {
      if (eMax <= e0 + PINE_LIFT_MAX) continue;
      const fit = fitTrunkRange(x, y, z, m, e0 + PINE_LIFT_MAX + 1, eMax, owner);
      if (fit) return fit;
    }
  }
  return null;
}
function startPineGrowth(x, y, z) {
  if (dim !== "over" || world !== worlds.over) return false;
  growableSoils.delete(key(x, y, z));
  wetSoilSet.delete(key(x, y, z));
  const k = key(x, y, z);
  releasePineCells(k);
  const hm = soilClaimant(k);
  if (hm) {
    if (plantClaims.get(k) === hm.id) plantClaims.delete(k);
    setVillagerNeck(hm, false);
    hm.plantKey = null; hm.plantTarget = null; hm.plantGoal = null; hm.plantPhase = null;
    hm.mode = "wander"; hm.speed = WALK / 2; hm.wanderT = 2 + Math.random() * 2;
    if (soilOutsideClamp(x + 0.5, z + 0.5, hm.hw)) hm.villageBound = false;
    hm.target = hm.villageBound === false ? wanderNear(hm) : wanderGoalFor(hm);
    hm.path = null; hm.pathKey = null;
  }
  if (getBlock(x, y, z) !== DIRT) return false;
  if (pineSpotBlocked(x, y, z)) return false;
  const dims = pickPineDims(x, y, z, k);
  if (!dims) return false;
  const cells = pineCellsFor(x, y, z, dims.m, dims.e);
  if (!cells.length) return false;
  reservePineCells(k, cells);
  setBlock(x, y, z, LOG);
  refreshBlocks([[x, y, z]]);
  pineGrowths.push({ cells, idx: 0, acc: 0, dims, sx: x, sy: y, sz: z, phaseCounts: pinePhaseCounts(cells) });
  queueSave();
  return true;
}
function soilClaimant(k) {
  const holder = plantClaims.get(k);
  if (holder == null) return null;
  const hm = typeof mobById !== "undefined" ? mobById.get(holder) : null;
  if (!hm || hm.mode !== "goPlant" || hm.plantKey !== k) return null;
  return hm;
}
function tickSoilTimers(dt) {
  if (dim !== "over" || world !== worlds.over) return;
  if (wetShellMat || wetShellMatMoon) {
    const wetOp = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(performance.now() / 300));
    if (wetShellMat) wetShellMat.opacity = wetOp;
    if (wetShellMatMoon) wetShellMatMoon.opacity = wetOp;
  }
  for (const [k, g] of growableSoils) {
    if (g.soak != null) {
      if (getBlock(g.x, g.y, g.z) !== DIRT) { releaseGrowable(k); continue; }
      g.soak -= dt;
      if (g.soak <= 0) absorbSoak(k, g);
      else syncSoakMesh(k, g);
      continue;
    }
    if (g.timer == null) continue;
    if (getBlock(g.x, g.y, g.z) !== DIRT) { releaseGrowable(k); continue; }
    g.timer -= dt;
    if (g.timer <= 0) {
      clearSoilTimerSprite(k);
      growableSoils.delete(k);
      wetSoilSet.delete(k);
      if (!startPineGrowth(g.x, g.y, g.z)) {
        startPineFailBlink(g.x, g.y, g.z);
      }
    } else {
      drawFuseSprite(soilTimerSprite(k, g), Math.max(0, g.timer));
    }
  }
}
const GROWTH_PUSH_SPEED = 8;
let growthSettlePasses = 0;
function growthExitTarget(px, py, pz, hw, h, over) {
  let bx = 0, by = 0, bz = 0, bd = Infinity;
  const consider = (tx, ty, tz) => {
    const cx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, tx));
    const cz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, tz));
    if (aabbCollidesWorld(cx, ty, cz, hw, h)) return;
    const d = Math.hypot(tx - px, ty - py, tz - pz);
    if (d < bd) { bd = d; bx = cx; by = ty; bz = cz; }
  };
  for (const c of over) {
    consider(c[0] - hw - 0.002, py, pz);
    consider(c[0] + 1 + hw + 0.002, py, pz);
    consider(px, py, c[2] - hw - 0.002);
    consider(px, py, c[2] + 1 + hw + 0.002);
    consider(px, c[1] - h - 0.002, pz);
    consider(px, c[1] + 1 + 0.002, pz);
  }
  return bd < Infinity ? [bx, by, bz] : null;
}
function growthCollidesExcept(px, py, pz, hw, h, ignore) {
  for (let by = Math.floor(py + 0.001); by <= Math.floor(py + h - 0.001); by++)
    for (let bx = Math.floor(px - hw + 0.001); bx <= Math.floor(px + hw - 0.001); bx++)
      for (let bz = Math.floor(pz - hw + 0.001); bz <= Math.floor(pz + hw - 0.001); bz++) {
        if (ignore.has(bx + "," + by + "," + bz)) continue;
        if (isSolid(bx, by, bz)) return true;
      }
  return false;
}
function growthSlide(px, py, pz, hw, h, tx, ty, tz, maxStep, over) {
  let dx = tx - px, dy = ty - py, dz = tz - pz;
  const d = Math.hypot(dx, dy, dz);
  if (d <= 0.0001) return [px, py, pz];
  const s = Math.min(d, maxStep) / d;
  dx *= s; dy *= s; dz *= s;
  const ignore = new Set();
  for (const c of over) ignore.add(c[0] + "," + c[1] + "," + c[2]);
  const steps = Math.min(60, Math.ceil(d / 0.05));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const sx = px + (tx - px) * f, sy = py + (ty - py) * f, sz = pz + (tz - pz) * f;
    for (let by = Math.floor(sy + 0.001); by <= Math.floor(sy + h - 0.001); by++)
      for (let bx = Math.floor(sx - hw + 0.001); bx <= Math.floor(sx + hw - 0.001); bx++)
        for (let bz = Math.floor(sz - hw + 0.001); bz <= Math.floor(sz + hw - 0.001); bz++)
          ignore.add(bx + "," + by + "," + bz);
  }
  let nx = px, ny = py, nz = pz;
  if (dx && !growthCollidesExcept(px + dx, py, pz, hw, h, ignore)) nx = px + dx;
  if (dz && !growthCollidesExcept(nx, py, pz + dz, hw, h, ignore)) nz = pz + dz;
  if (dy && !growthCollidesExcept(nx, py + dy, nz, hw, h, ignore)) ny = py + dy;
  return [nx, ny, nz];
}
function growthSolidOverlap(px, py, pz, hw, h) {
  const out = [];
  for (let by = Math.floor(py + 0.001); by <= Math.floor(py + h - 0.001); by++)
    for (let bx = Math.floor(px - hw + 0.001); bx <= Math.floor(px + hw - 0.001); bx++)
      for (let bz = Math.floor(pz - hw + 0.001); bz <= Math.floor(pz + hw - 0.001); bz++)
        if (isSolid(bx, by, bz)) out.push([bx, by, bz]);
  return out;
}
function pushOutOfGrowth(touched, dt) {
  if (dim !== "over" || world !== worlds.over) return 0;
  if (!pineGrowths.length && !touched.length) return 0;
  const maxStep = GROWTH_PUSH_SPEED * Math.min(Math.max(dt, 0), 0.1);
  if (maxStep <= 0) return 0;
  const anchors = [];
  for (const g of pineGrowths) {
    const a = { sx: g.sx, sz: g.sz, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const c of g.cells) {
      if (c.x < a.minX) a.minX = c.x;
      if (c.x > a.maxX) a.maxX = c.x;
      if (c.y < a.minY) a.minY = c.y;
      if (c.y > a.maxY) a.maxY = c.y;
      if (c.z < a.minZ) a.minZ = c.z;
      if (c.z > a.maxZ) a.maxZ = c.z;
    }
    anchors.push(a);
  }
  const nearGrowth = (px, py, pz, hw, h) => {
    for (const a of anchors) {
      if (px + hw >= a.minX - 3 && px - hw <= a.maxX + 3 &&
          pz + hw >= a.minZ - 3 && pz - hw <= a.maxZ + 3 &&
          py <= a.maxY + 3 && py + h >= a.minY - 3) return a;
    }
    return null;
  };
  const freshKey = new Set();
  for (const c of touched) freshKey.add(c[0] + "," + c[1] + "," + c[2]);
  const pushOne = (px, py, pz, hw, h) => {
    const over = growthSolidOverlap(px, py, pz, hw, h);
    if (!over.length) return null;
    let anchor = nearGrowth(px, py, pz, hw, h);
    if (!anchor) {
      let fresh = false;
      for (const c of over) if (freshKey.has(c[0] + "," + c[1] + "," + c[2])) { fresh = true; break; }
      if (!fresh) return null;
    }
    const exit = growthExitTarget(px, py, pz, hw, h, over);
    if (exit) return growthSlide(px, py, pz, hw, h, exit[0], exit[1], exit[2], maxStep, over);
    const a = anchor || nearGrowth(px, py, pz, hw, h);
    let ox = 0.5, oz = 0;
    if (a) { ox = px - (a.sx + 0.5); oz = pz - (a.sz + 0.5); }
    if (ox * ox + oz * oz < 0.0001) { ox = 1; oz = 0; }
    const rl = Math.hypot(ox, oz);
    return growthSlide(px, py, pz, hw, h, px + ox / rl * 2, py, pz + oz / rl * 2, maxStep, over);
  };
  let moved = 0;
  if (freeCam) {
    const pr = pushOne(camPos.x, camPos.y - 0.3, camPos.z, 0.3, 0.6);
    if (pr) {
      if (Math.hypot(pr[0] - camPos.x, pr[1] - (camPos.y - 0.3), pr[2] - camPos.z) > 0.0001) moved++;
      camPos.set(pr[0], pr[1] + 0.3, pr[2]);
    }
  } else {
    const pr = pushOne(pos.x, pos.y, pos.z, PLAYER_HW, PLAYER_H);
    if (pr) {
      if (Math.hypot(pr[0] - pos.x, pr[1] - pos.y, pr[2] - pos.z) > 0.0001) moved++;
      pos.x = pr[0]; pos.y = pr[1]; pos.z = pr[2];
    }
  }
  for (const m of mobs) {
    if (!m || m.pos == null) continue;
    if (isFlyingKind(m.kind)) continue;
    if (isMobHeld(m) || isChained(m) || isMobFrozenByGrapple(m)) continue;
    if (isArrivalFrozen(m)) continue;
    if (mobDimOf(m) !== "over") continue;
    const hw = m.hw != null ? m.hw : villagerHW(m);
    const h = m.h != null ? m.h : villagerH(m);
    const r = pushOne(m.pos.x, m.pos.y, m.pos.z, hw, h);
    if (r) {
      if (Math.hypot(r[0] - m.pos.x, r[1] - m.pos.y, r[2] - m.pos.z) > 0.0001) moved++;
      m.pos.x = r[0]; m.pos.y = r[1]; m.pos.z = r[2];
      if (m.mesh) m.mesh.position.copy(m.pos);
    }
  }
  return moved;
}
function tickPineGrowths(dt) {
  if (!pineGrowths.length || dim !== "over" || world !== worlds.over) return;
  const touched = [];
  for (let gi = pineGrowths.length - 1; gi >= 0; gi--) {
    const g = pineGrowths[gi];
    if (!g.phaseCounts) g.phaseCounts = pinePhaseCounts(g.cells);
    const cur = g.cells[g.idx];
    const rate = !cur || cur.s === 0 ? PINE_RATE : (g.phaseCounts[cur.s] || 1) / PINE_PHASE_TIME;
    g.acc += dt * rate;
    let n = Math.floor(g.acc);
    g.acc -= n;
    while (n-- > 0 && g.idx < g.cells.length) {
      const c = g.cells[g.idx++];
      if (c.y < 0 || c.y > MAX_Y) continue;
      if (protectedBlocks.has(protKey(c.x, c.y, c.z))) continue;
      if (c.id === LOG) {
        if (getBlock(c.x, c.y, c.z) === LEAVES) continue;
        if (pineFolReserved(c.x, c.y, c.z, key(g.sx, g.sy, g.sz))) continue;
      } else if (getBlock(c.x, c.y, c.z) !== AIR) continue;
      setBlock(c.x, c.y, c.z, c.id);
      touched.push([c.x, c.y, c.z, g.sx, g.sz]);
    }
    if (g.idx >= g.cells.length) {
      releasePineCells(key(g.sx, g.sy, g.sz));
      for (let k = 0; k < 40 && pushOutOfGrowth([], dt) > 0; k++) growthSettlePasses++;
      registerPlantedPine(g.sx, g.sy, g.sz, g.dims.m, g.dims.e);
      pineGrowths.splice(gi, 1);
    }
  }
  if (touched.length) { refreshBlocks(touched); queueSave(); pushOutOfGrowth(touched, dt); }
}

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
    const ct = colTops[dim];
    const ci = colTopIdx(x, z);
    if (y > ct[ci]) ct[ci] = y;
    if (id === PORTAL || id === OBSIDIAN) pb.add(k); else pb.delete(k);
    if (id === GLOWSTONE) gs.add(k); else gs.delete(k);
    if (id !== GLOWSTONE) gv.delete(k);
  }
  if (id !== FLOWER) placedFlowers.delete(k);
  if (dim === "over" && world === worlds.over && id !== DIRT && growableSoils.has(k)) releaseGrowable(k);
  if (wasG !== gs.has(k)) {
    if (glowDefer > 0) glowDirtyDeferred = true;
    else { recomputeGlowClusters(); syncGlowLights(); }
  }
  endMemo.dim = "";
  netherMemo.dim = "";
  if (id === PORTAL || id === OBSIDIAN) {
    if (!(dim === "end" && !endCleared)) {
      for (const w of collectEndWins(x, y, z, 6)) ensurePortalFill(w, false);
      for (const w of collectNetherWins(x, y, z, 6)) ensurePortalFill(w, true);
    }
  }
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
  if (villageHouses.length && intersectsVillage(ix, iz)) return;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (villageHouses.length && intersectsVillage(ix + dx, iz + dz)) continue;
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
        if (villageHouses.length && intersectsVillage(Math.round(cx), Math.round(cz))) { if (s < steps) pos += segLen / steps; continue; }
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
      if (villageHouses.length && intersectsVillage(Math.round(cx), Math.round(cz))) continue;
      const h = heightAt(Math.round(cx), Math.round(cz));
      if (h <= WATER_LEVEL + 1) continue;
      const cy = Math.max(rh + 1, Math.min(h - rh - 1, h - tubeDepth(target, totalLen, cx, cz)));
      const iy = Math.round(cy);
      const ix = Math.round(cx), iz = Math.round(cz);
      if (villageHouses.length && intersectsVillage(ix, iz)) continue;
      for (let dx = -rw; dx <= rw; dx++)
        for (let dz = -rw; dz <= rw; dz++)
          for (let dy = -rh; dy <= rh; dy++) {
            if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
            if (villageHouses.length && intersectsVillage(ix + dx, iz + dz)) continue;
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
      if (villageHouses.length && intersectsVillage(Math.round(ax), Math.round(az))) continue;
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
    for (const c of cells) {
      if (villageHouses.length && intersectsVillage(c.x, c.z)) continue;
      for (let y = c.h; y > c.floor; y--) setBlock(c.x, y, c.z, AIR);
    }
  for (const cells of flights)
    for (const c of cells) {
      if (villageHouses.length && intersectsVillage(c.x, c.z)) continue;
      setBlock(c.x, c.floor, c.z, PLANKS);
    }
}

const VILLAGE_RADIUS = 28;
const VILLAGE_HOUSES = 8;
const VILLAGE_PEN_W = 14;
const VILLAGE_PEN_D = 12;
const VILLAGE_POOL_W = 8;
const VILLAGE_POOL_D = 6;
const VILLAGE_POOL_DEPTH = 2;
const VILLAGE_PEN_POOL_W = 2;
const VILLAGE_PEN_POOL_D = 2;
const VILLAGE_PEN_POOL_DEPTH = 1;
const PIG_COUNT = 4;
const COW_COUNT = 4;
const WOLF_COUNT = 20;
const GOLEM_COUNT = 1;
const GOLEM_HW = 0.6;
const GOLEM_HH = 3.6;
const CAT_COUNT = 8;
const CAT_HW = 0.16;
const CAT_HH = 0.98;
const CAT_ROBES = [0xdd8a3c, 0x1a1a1a, 0xf5f0e6];
const CAT_ROBE_WEIGHTS = [2, 1, 1];
const FOLLOW_TRAIL_D = 1.125;
const FOLLOW_ENGAGE_D = 1.5;
const FOLLOW_HOLD_D = 0.9;
const FOLLOW_MILL_R = 0.75;
const FOLLOW_LEASH_D = 12;
const BIRD_COUNT = 50;
const BIRD_MIN_Y = 50;
const BIRD_SEP_DIST = 2.5;
const BIRD_PROBE_DIST = 3;
const BIRD_SPEED = 8.8;
const BIRD_PERCH_CHANCE = 0.65;
const BIRD_END_PERCH_CHANCE = 0.1;
const BIRD_END_PERCH_MIN_T = 2;
const BIRD_END_PERCH_MAX_T = 4;
const BIRD_PERCH_SNAP_D = 0.3;
const BIRD_PERCH_FINAL_D = 6;
const BIRD_NOPERCH_T = 10;
const BIRD_HOP_CHANCE = 0.9;
const BIRD_HOP_R = 30;
const BIRD_HOP_RETRY = 2;
const BIRD_PERCH_MIN_T = 2;
const BIRD_PERCH_MAX_T = 10;
const BIRD_PERCH_JOIN_R = 50;
const BIRD_PERCH_SEP = 1.3;
const BIRD_COL_HW = 0.18;
const BIRD_COL_H = 0.5;
const BIRD_BODY_Y = 0.28;
const BIRD_CARRY_SCALE = 0.7;
const BIRD_TUNNEL_SCALE = 0.7;
const BIRD_NARROW_SCALE = 0.7;
const BIRD_SKY_CLEAR = 20;
const PARROT_FRACTION = 0.8;
const PARROT_COLORS = [
  { name: "red", hex: 0xc02020 },
  { name: "green", hex: 0x2e9e44 },
  { name: "blue", hex: 0x246bff },
  { name: "yellow", hex: 0xd8a820 },
];
const PARROT_COMBOS = [];
const PARROT_COMBO_INDEX = new Map();
for (let b = 0; b < PARROT_COLORS.length; b++) {
  for (let h = 0; h < PARROT_COLORS.length; h++) {
    for (let wb = 0; wb < PARROT_COLORS.length; wb++) {
      if (wb === b || wb === h) continue;
      for (let wt = 0; wt < PARROT_COLORS.length; wt++) {
        if (wt === b || wt === h || wt === wb) continue;
        PARROT_COMBO_INDEX.set(b + "," + h + "," + wb + "," + wt, PARROT_COMBOS.length);
        PARROT_COMBOS.push({ body: b, head: h, wing: wb, wingTip: wt });
      }
    }
  }
}
const PARROT_VARIANT_COUNT = PARROT_COMBOS.length;
const PARROT_SAME_HEAD = 0.8;
const PARROT_BEAK_UPPER = 0x141414;
const PARROT_BEAK_LOWER = 0xd8b89a;
const PARROT_FEET = 0xd8b89a;
function parrotPaletteFor(variant) {
  const c = PARROT_COMBOS[variant] || PARROT_COMBOS[0];
  return {
    body: PARROT_COLORS[c.body].hex,
    head: PARROT_COLORS[c.head].hex,
    chest: PARROT_COLORS[c.wing].hex,
    wing: PARROT_COLORS[c.wing].hex,
    wingTip: PARROT_COLORS[c.wingTip].hex,
    tail: PARROT_COLORS[c.wingTip].hex,
    crest: PARROT_COLORS[c.body].hex,
  };
}
function pickParrotVariant() {
  const n = PARROT_COLORS.length;
  const b = Math.floor(Math.random() * n);
  let h;
  if (Math.random() < PARROT_SAME_HEAD) {
    h = b;
  } else {
    h = Math.floor(Math.random() * (n - 1));
    if (h >= b) h++;
  }
  const wbPool = [];
  for (let c = 0; c < n; c++) if (c !== b && c !== h) wbPool.push(c);
  const wb = wbPool[Math.floor(Math.random() * wbPool.length)];
  const wtPool = [];
  for (let c = 0; c < n; c++) if (c !== b && c !== h && c !== wb) wtPool.push(c);
  const wt = wtPool[Math.floor(Math.random() * wtPool.length)];
  const idx = PARROT_COMBO_INDEX.get(b + "," + h + "," + wb + "," + wt);
  return idx != null ? idx : 0;
}
function birdNarrow(m) {
  if (!m) return false;
  if (m._narrow) return true;
  if (m === carryMob && playerSqueezed()) return true;
  return false;
}
function birdColHW(m) {
  return BIRD_COL_HW * (birdNarrow(m) ? BIRD_NARROW_SCALE : 1);
}
function birdColH(m) {
  return BIRD_COL_H * (birdNarrow(m) ? BIRD_NARROW_SCALE : 1);
}
function birdSkyClear(x, y, z, h) {
  const n = h == null ? BIRD_SKY_CLEAR : h;
  const bx = Math.floor(x), bz = Math.floor(z);
  const y0 = Math.floor(y) + 1;
  const yTop = Math.min(MAX_Y - 1, y0 + n);
  for (let sy = y0; sy <= yTop; sy++) {
    if (isSolid(bx, sy, bz)) return false;
  }
  return true;
}
function birdSidestep(m) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  const hw = birdColHW(m), hh = birdColH(m);
  let best = null, bestD = Infinity;
  for (const [dx, dy, dz] of dirs) {
    const nx = m.pos.x + dx * 1.2, ny = m.pos.y + dy * 1.2, nz = m.pos.z + dz * 1.2;
    if (ny < 1 || ny > MAX_Y - 1) continue;
    if (aabbCollidesWorld(nx, ny, nz, hw, hh)) continue;
    const vl = Math.hypot(m.vel.x, m.vel.y, m.vel.z);
    let dot = -1;
    if (vl > 0.1) dot = (m.vel.x * dx + m.vel.y * dy + m.vel.z * dz) / vl;
    if (dot > 0.5) continue;
    const d = Math.hypot(nx - m.pos.x, ny - m.pos.y, nz - m.pos.z);
    if (d < bestD) { bestD = d; best = { x: nx, y: ny, z: nz, dx, dy, dz }; }
  }
  return best;
}
function birdUTurn(m) {
  const now = performance.now() / 1000;
  const avoid = m._tAvoid || (m._tAvoid = new Map());
  const cx = Math.floor(m.pos.x), cy = Math.floor(m.pos.y + 0.25), cz = Math.floor(m.pos.z);
  const vl = Math.hypot(m.vel.x, m.vel.y, m.vel.z);
  let ax = 0, ay = 0, az = 0;
  if (vl > 0.1) {
    ax = Math.abs(m.vel.x) >= Math.abs(m.vel.z) && Math.abs(m.vel.x) >= Math.abs(m.vel.y) ? Math.sign(m.vel.x) : 0;
    az = ax === 0 && Math.abs(m.vel.z) >= Math.abs(m.vel.y) ? Math.sign(m.vel.z) : 0;
    ay = ax === 0 && az === 0 ? Math.sign(m.vel.y) : 0;
  }
  avoid.set((cx + ax) + "," + (cy + ay) + "," + (cz + az), now + 6);
  m._tPath = null; m._tPlanT = 0; m._tGoal = null;
  m._tGoalCell = null; m._tGoalKind = null;
  m.vel.x *= -0.3; m.vel.y *= -0.3; m.vel.z *= -0.3;
}
function playerSqueezed() {
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
  for (const by of [Math.floor(pos.y + 0.3), Math.floor(pos.y + 1.5)]) {
    if (isSolid(bx - 1, by, bz) && isSolid(bx + 1, by, bz)) return true;
    if (isSolid(bx, by, bz - 1) && isSolid(bx, by, bz + 1)) return true;
  }
  return false;
}
const BIRD_TUNNEL_REPLAN = 0.4;
const BIRD_TUNNEL_BFS_CELLS = 1000;
const BIRD_TUNNEL_PATH_CELLS = 50;
const BIRD_TUNNEL_EXIT_NEAR = 60;
const BIRD_TUNNEL_DIG_NEAR = 30;
const BIRD_VISIT_MEM = 1400;
const BIRD_TUNNEL_SEP_DIST = 1.2;
const BIRD_ALIGN_SPEED = 4.0;
const BIRD_ALIGN_GAIN = 8;
const BIRD_ALIGN_ENTER = 0.18;
const BIRD_ALIGN_EXIT = 0.10;
const BIRD_POP_R = 0.55;
const BIRD_TURN_BRAKE_DIST = 2.0;
const BIRD_HOLE_SPEED = 2.2;
const CHAIN_THREAD_MAX_T = 4;
function birdHoleCell(cx, cy, cz, m) {
  if (!birdProbeFree(cx + 0.5, cy + 0.5, cz + 0.5, m)) return false;
  let n = 0;
  if (birdProbeFree(cx + 1.5, cy + 0.5, cz + 0.5, m)) n++;
  if (birdProbeFree(cx - 0.5, cy + 0.5, cz + 0.5, m)) n++;
  if (birdProbeFree(cx + 0.5, cy + 1.5, cz + 0.5, m)) n++;
  if (birdProbeFree(cx + 0.5, cy - 0.5, cz + 0.5, m)) n++;
  if (birdProbeFree(cx + 0.5, cy + 0.5, cz + 1.5, m)) n++;
  if (birdProbeFree(cx + 0.5, cy + 0.5, cz - 1.5, m)) n++;
  return n <= 2;
}
function chainSegmentFree(m, ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(2, Math.ceil(d * 2));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (aabbCollidesWorld(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, m.hw, m.h)) return false;
  }
  return true;
}
function chainThreadRide(link, carrier, child, dt) {
  if ((link.threadT || 0) > CHAIN_THREAD_MAX_T) return false;
  const trail = carrier._trail;
  if (!trail || trail.length < 2) return false;
  if (chainSegmentFree(child, child.pos.x, child.pos.y, child.pos.z, carrier.pos.x, carrier.pos.y, carrier.pos.z)) return false;
  let bi = -1, bd = Infinity;
  for (let i = 0; i < trail.length; i++) {
    const c = trail[i];
    const d = Math.hypot(c.x - child.pos.x, c.y - child.pos.y, c.z - child.pos.z);
    if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0 || bd > 2.5) return false;
  let tgt = null;
  for (let i = bi + 1; i < trail.length; i++) {
    const c = trail[i];
    if (Math.hypot(c.x - child.pos.x, c.y - child.pos.y, c.z - child.pos.z) > 0.35) { tgt = c; break; }
  }
  if (!tgt) {
    const last = trail[trail.length - 1];
    if (Math.hypot(last.x - child.pos.x, last.y - child.pos.y, last.z - child.pos.z) < 0.4) return false;
    tgt = last;
  }
  const dx = tgt.x - child.pos.x, dy = tgt.y - child.pos.y, dz = tgt.z - child.pos.z;
  const dl = Math.hypot(dx, dy, dz) || 1;
  const spd = Math.min(WALK * 2, Math.max(1.2, dl * 4));
  if (!child.vel) child.vel = new THREE.Vector3();
  child.vel.set(dx / dl * spd, dy / dl * spd, dz / dl * spd);
  chainSlideToward(child, tgt.x, tgt.y, tgt.z, Math.min(dl, spd * dt));
  return true;
}
function birdIsConfined(m) {
  const d = 1.2;
  let free = 0;
  if (birdProbeFree(m.pos.x + d, m.pos.y, m.pos.z, m)) free++;
  if (birdProbeFree(m.pos.x - d, m.pos.y, m.pos.z, m)) free++;
  if (birdProbeFree(m.pos.x, m.pos.y, m.pos.z + d, m)) free++;
  if (birdProbeFree(m.pos.x, m.pos.y, m.pos.z - d, m)) free++;
  if (birdProbeFree(m.pos.x, m.pos.y + d, m.pos.z, m)) free++;
  if (birdProbeFree(m.pos.x, m.pos.y - d, m.pos.z, m)) free++;
  if (free <= 4) return true;
  // a clear climb to the open sky means the bird is on the surface, not trapped —
  // brief contact with a cloud or a build must never lock it into tunnel mode
  const bx = Math.floor(m.pos.x), bz = Math.floor(m.pos.z);
  const yTop = Math.min(MAX_Y - 1, Math.floor(m.pos.y) + BIRD_SKY_CLEAR);
  let openAbove = true;
  for (let sy = Math.floor(m.pos.y) + 1; sy <= yTop; sy++) {
    if (isSolid(bx, sy, bz)) { openAbove = false; break; }
  }
  if (openAbove) return false;
  const vl = Math.hypot(m.vel.x, m.vel.y, m.vel.z);
  if (vl > 0.5) {
    const dx = m.vel.x / vl, dy = m.vel.y / vl, dz = m.vel.z / vl;
    if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.pos.x + dx * 1.5, m.pos.y + dy * 1.5, m.pos.z + dz * 1.5, m)) return true;
  }
  return false;
}
function birdTunnelLiveDigKeys(m) {
  const now = performance.now() / 1000;
  const seen = m._seenBreaks || (m._seenBreaks = {});
  for (const k of Object.keys(seen)) {
    let live = false;
    for (const n of birdNotices) if (n.id === +k) { live = true; break; }
    if (!live) delete seen[k];
  }
  const set = new Set();
  for (const n of birdNotices) {
    if (now - n.t > 8) continue;
    if (seen[n.id]) continue;
    if (isSolid(n.bx, n.by, n.bz)) continue;
    set.add(n.bx + "," + n.by + "," + n.bz);
  }
  return set;
}
function birdTunnelPlan(m, now) {
  if (m._tPath && now < (m._tPlanT || 0)) return m._tPath;
  const avoid = m._tAvoid || (m._tAvoid = new Map());
  for (const [ak, exp] of avoid) if (exp <= now) avoid.delete(ak);
  const sx = Math.floor(m.pos.x), sy = Math.floor(m.pos.y + 0.25), sz = Math.floor(m.pos.z);
  const key = (x, y, z) => x + "," + y + "," + z;
  const freeCell = (x, y, z) => {
    if (x < -WORLD_RADIUS + 1 || x > WORLD_RADIUS - 1 || z < -WORLD_RADIUS + 1 || z > WORLD_RADIUS - 1) return false;
    if (y < 1 || y > MAX_Y - 1) return false;
    if (avoid.has(key(x, y, z))) return false;
    return birdProbeFree(x + 0.5, y + 0.5, z + 0.5, m);
  };
  let start = null;
  if (freeCell(sx, sy, sz)) start = [sx, sy, sz];
  else {
    let found = null;
    for (let r = 1; r <= 2 && !found; r++)
      for (let dx = -r; dx <= r && !found; dx++)
        for (let dy = -r; dy <= r && !found; dy++)
          for (let dz = -r; dz <= r && !found; dz++) {
            if (freeCell(sx + dx, sy + dy, sz + dz)) found = [sx + dx, sy + dy, sz + dz];
          }
    if (!found) { m._tPath = null; m._tPlanT = now + BIRD_TUNNEL_REPLAN; return null; }
    start = found;
  }
  const digKeys = birdTunnelLiveDigKeys(m);
  const visits = m._visits;
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const prev = new Map();
  const depth = new Map();
  const sk0 = key(start[0], start[1], start[2]);
  const seen = new Set([sk0]);
  depth.set(sk0, 0);
  const q = [start];
  let digCell = null, exitCell = null, exitDepth = Infinity;
  let skyCell = null, skyDepth = Infinity;
  const reachable = [];
  const unvisited = [];
  const openCount = (x, y, z) => {
    let n = 0;
    for (const [ax, ay, az] of DIRS) if (freeCell(x + ax, y + ay, z + az)) n++;
    return n;
  };
  while (q.length && seen.size < BIRD_TUNNEL_BFS_CELLS) {
    const [cx, cy, cz] = q.shift();
    const ck = key(cx, cy, cz);
    const cd = depth.get(ck) || 0;
    const isStart = cx === start[0] && cy === start[1] && cz === start[2];
    if (!isStart) {
      reachable.push([cx, cy, cz]);
      if (!digCell && digKeys.has(ck)) digCell = [cx, cy, cz];
      const vt = visits ? visits.get(ck) : undefined;
      if (vt === undefined) unvisited.push([cx, cy, cz]);
      const oc = openCount(cx, cy, cz);
      if (!exitCell && oc >= 3) {
        // a real exit leads through a narrower opening — a room's interior cells
        // all have oc>=3, so a cell only counts as an exit when one of its free
        // neighbours opens into a tighter passage (tunnel mouth, 1-block hole).
        let narrow = false;
        for (const [ax, ay, az] of DIRS) {
          if (!freeCell(cx + ax, cy + ay, cz + az)) continue;
          if (openCount(cx + ax, cy + ay, cz + az) < 3) { narrow = true; break; }
        }
        if (narrow) { exitCell = [cx, cy, cz]; exitDepth = cd; }
      }
      if (!skyCell && getBlock(cx, cy + 1, cz) === AIR && getBlock(cx, cy - 1, cz) !== AIR) {
        let openAbove = true;
        for (let sy = cy + 2; sy <= Math.min(cy + 24, MAX_Y - 1); sy++) {
          if (isSolid(cx, sy, cz)) { openAbove = false; break; }
        }
        if (openAbove) { skyCell = [cx, cy, cz]; skyDepth = cd; }
      }
    }
    for (const [ax, ay, az] of DIRS) {
      const nx = cx + ax, ny = cy + ay, nz = cz + az;
      const nk = key(nx, ny, nz);
      if (seen.has(nk)) continue;
      if (!freeCell(nx, ny, nz)) continue;
      seen.add(nk);
      prev.set(nk, [cx, cy, cz]);
      depth.set(nk, cd + 1);
      q.push([nx, ny, nz]);
      if (seen.size >= BIRD_TUNNEL_BFS_CELLS) break;
    }
  }
  let goal = null, goalKind = null;
  // never goal onto the bird's own cell: goal==start builds an empty path, which
  // used to loop the planner (empty path → mill → replan → same sticky goal)
  const isStartCell = (c) => c[0] === start[0] && c[1] === start[1] && c[2] === start[2];
  if (digCell && Math.hypot(digCell[0] + 0.5 - m.pos.x, digCell[1] + 0.5 - m.pos.y, digCell[2] + 0.5 - m.pos.z) <= BIRD_TUNNEL_DIG_NEAR) { goal = digCell; goalKind = "dig"; }
  else if ((skyCell && skyDepth <= BIRD_TUNNEL_EXIT_NEAR) || (exitCell && exitDepth <= BIRD_TUNNEL_EXIT_NEAR)) {
    // holes and sky outrank exploring the interior: leave immediately, and hold
    // the same exit across replans instead of oscillating between candidates
    const pg = m._tGoalCell;
    if (m._tGoalKind === "exit" && pg && !isStartCell(pg) && now < (m._tGoalT || 0) &&
        seen.has(key(pg[0], pg[1], pg[2])) && freeCell(pg[0], pg[1], pg[2])) {
      goal = [pg[0], pg[1], pg[2]];
      goalKind = "exit";
    } else if (skyCell && skyDepth <= BIRD_TUNNEL_EXIT_NEAR) {
      goal = skyCell; goalKind = "exit";
      m._tGoalCell = [goal[0], goal[1], goal[2]];
      m._tGoalT = now + 6;
      m._tGoalKind = "exit";
    } else {
      goal = exitCell; goalKind = "exit";
      m._tGoalCell = [goal[0], goal[1], goal[2]];
      m._tGoalT = now + 6;
      m._tGoalKind = "exit";
    }
  }
  else if (unvisited.length) {
    // no hole or sky in range: tour the not-yet-visited cells nearest-first (a
    // shallow random band around the closest unvisited depth) so the bird keeps
    // wandering the whole space — house interiors included — while blocked.
    // The pick is sticky: mid-flight replans keep pursuing the same cell instead
    // of re-rolling, so the bird commits to each leg and never oscillates.
    const pg = m._tGoalCell;
    if (pg && !isStartCell(pg) && now < (m._tGoalT || 0) && seen.has(key(pg[0], pg[1], pg[2])) && !(visits && visits.has(key(pg[0], pg[1], pg[2])))) {
      goal = [pg[0], pg[1], pg[2]];
      goalKind = "explore";
    } else {
      let minD = Infinity;
      for (const c of unvisited) { const d = depth.get(key(c[0], c[1], c[2])) || 0; if (d < minD) minD = d; }
      const band = [];
      for (const c of unvisited) { if ((depth.get(key(c[0], c[1], c[2])) || 0) <= minD + 4) band.push(c); }
      goal = band[(Math.random() * band.length) | 0];
      goalKind = "explore";
      m._tGoalCell = [goal[0], goal[1], goal[2]];
      m._tGoalT = now + 6;
      m._tGoalKind = "explore";
    }
  }
  else if (reachable.length) {
    // everything nearby seen — wander at random, but keep each pick long enough
    // to actually fly there instead of re-rolling every replan
    const pg = m._tGoalCell;
    if (pg && !isStartCell(pg) && now < (m._tGoalT || 0) && seen.has(key(pg[0], pg[1], pg[2]))) {
      goal = [pg[0], pg[1], pg[2]];
      goalKind = "explore";
    } else {
      goal = reachable[(Math.random() * reachable.length) | 0];
      goalKind = "explore";
      m._tGoalCell = [goal[0], goal[1], goal[2]];
      m._tGoalT = now + 6;
      m._tGoalKind = "explore";
    }
  }
  if (!goal) { m._tPath = null; m._tGoal = null; m._tPlanT = now + BIRD_TUNNEL_REPLAN; return null; }
  const cells = [goal];
  let cur = goal, ck = key(goal[0], goal[1], goal[2]);
  const sk = key(start[0], start[1], start[2]);
  while (ck !== sk) {
    const p = prev.get(ck);
    if (!p) break;
    cells.push(p);
    cur = p;
    ck = key(cur[0], cur[1], cur[2]);
  }
  cells.reverse();
  if (cells.length && cells[0][0] === start[0] && cells[0][1] === start[1] && cells[0][2] === start[2]) cells.shift();
  if (!cells.length) {
    // goal resolved to the bird's own cell — nothing to walk: drop the sticky
    // goal so the next plan picks elsewhere, and let the caller mill this frame
    m._tGoalCell = null;
    m._tGoalKind = null;
    m._tPath = null; m._tGoal = null;
    m._tPlanT = now + BIRD_TUNNEL_REPLAN;
    return null;
  }
  const path = cells.slice(0, BIRD_TUNNEL_PATH_CELLS).map(([bx, by, bz]) => new THREE.Vector3(bx + 0.5, by + (1 - birdColH(m)) / 2, bz + 0.5));
  m._tPath = path;
  m._tGoal = goalKind;
  m._tPlanT = now + BIRD_TUNNEL_REPLAN;
  if (goalKind === "dig") {
    for (const n of birdNotices) {
      if (n.bx === goal[0] && n.by === goal[1] && n.bz === goal[2]) { m._digGoal = n.id; m._digT0 = now; break; }
    }
  }
  return path;
}
function birdUnblock(m) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]];
  let best = null, bestD = Infinity;
  for (let d = 0.3; d <= 2.1; d += 0.3) {
    for (const [dx, dy, dz] of dirs) {
      const nx = m.pos.x + dx * d, ny = m.pos.y + dy * d, nz = m.pos.z + dz * d;
      if (ny < 1 || ny > MAX_Y - 1) continue;
      if (aabbCollidesWorld(nx, ny, nz, BIRD_COL_HW, BIRD_COL_H)) continue;
      const dist = Math.hypot(nx - m.pos.x, ny - m.pos.y, nz - m.pos.z);
      if (dist < bestD) { bestD = dist; best = { x: nx, y: ny, z: nz }; }
    }
  }
  if (best) { m.pos.set(best.x, best.y, best.z); m.vel.set(0, 0, 0); }
}
function updateTunnelBird(m, dt, now) {
  dt = Math.min(0.05, dt);
  if (!m._tEnterT) { m._tEnterT = now; m._tSteps = 0; }
  m._narrow = true;
  birdTouchVisit(m, now);
  // Rule 1 — sky first: +20 air above means fly straight up, never blocked.
  // Centered on the column so 1-block shafts are climbed dead-centre.
  if (birdSkyClear(m.pos.x, m.pos.y, m.pos.z)) {
    const sp = WALK;
    const tx = Math.floor(m.pos.x) + 0.5, tz = Math.floor(m.pos.z) + 0.5;
    let vx = (tx - m.pos.x) * BIRD_ALIGN_GAIN;
    let vz = (tz - m.pos.z) * BIRD_ALIGN_GAIN;
    vx = Math.max(-BIRD_ALIGN_SPEED, Math.min(BIRD_ALIGN_SPEED, vx));
    vz = Math.max(-BIRD_ALIGN_SPEED, Math.min(BIRD_ALIGN_SPEED, vz));
    let vy = sp;
    const k = Math.min(1, dt * 6);
    vx = m.vel.x + (vx - m.vel.x) * k;
    vz = m.vel.z + (vz - m.vel.z) * k;
    vy = m.vel.y + (vy - m.vel.y) * k;
    const vel = { x: vx, y: vy, z: vz };
    birdTunnelSeparate(m, dt, vel);
    const slid = birdMoveSlide(m, vel.x, vel.y, vel.z, dt);
    if (slid.blocked > 0) {
      const side = birdSidestep(m);
      if (side) {
        m.pos.x = side.x; m.pos.y = side.y; m.pos.z = side.z;
        m.vel.set(side.dx * 1.5, side.dy * 1.5, side.dz * 1.5);
      } else {
        birdUTurn(m);
      }
    } else {
      m.vel.set(slid.vx, slid.vy, slid.vz);
    }
    m._tPath = null; m._tGoal = null; m._tPlanT = 0;
    birdAnimate(m, dt, m.vel.x, m.vel.y, m.vel.z, sp);
    return;
  }
  // Rule 6 — blocked-only dig chase: any fresh player break (BFS-reachable,
  // no line-of-sight needed) forces a replan. Free birds never reach this
  // function, so they ignore digs. One visit each via _seenBreaks; the popped
  // cells join _visits so the new hole becomes regular wandering ground.
  if (m._tGoal !== "dig" && birdNotices.length) {
    const keys = birdTunnelLiveDigKeys(m);
    if (keys.size) m._tPlanT = 0;
  }
  let path = birdTunnelPlan(m, now);
  const visits = m._visits || (m._visits = new Map());
  while (path && path.length && Math.hypot(path[0].x - m.pos.x, path[0].y - m.pos.y, path[0].z - m.pos.z) < BIRD_POP_R
       && Math.floor(m.pos.x) === Math.floor(path[0].x)
       && Math.floor(m.pos.y + 0.25) === Math.floor(path[0].y + 0.25)
       && Math.floor(m.pos.z) === Math.floor(path[0].z)) {
    const done = path.shift();
    const vk = birdCellKey(done.x, done.y, done.z);
    // commit the cell to _visits only once the bird's centre is actually inside it,
    // so the popped cell is never marked ahead of the bird (that used to open a
    // "hole" behind it that the BFS would pick as the next frontier, reversing it)
    if (visits.has(vk)) visits.delete(vk);
    visits.set(vk, now);
    if (visits.size > BIRD_VISIT_MEM) visits.delete(visits.keys().next().value);
    m._tSteps = (m._tSteps || 0) + 1;
    const dg = birdDigLive(m, now);
    if (dg && Math.hypot(dg.x - m.pos.x, dg.y - m.pos.y, dg.z - m.pos.z) < 1.2) birdDigGiveUp(m);
  }
  // line-of-sight smoothing: when the waypoint after the next is directly
  // reachable, drop the intermediate cell — straight full-speed legs down
  // corridors and across rooms instead of cell-by-cell hopping. Never skip
  // into a hole cell: the intermediate waypoint is what centers the bird on it.
  const wpCellOf = (w) => [Math.floor(w.x), Math.floor(w.y + 0.25), Math.floor(w.z)];
  if (path && path.length > 1) {
    const c1 = wpCellOf(path[1]);
    if (!birdHoleCell(c1[0], c1[1], c1[2], m) &&
        birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, path[1].x, path[1].y, path[1].z, m)) path.shift();
  }
  // popping the goal empties the path — extend it in the same frame so the
  // bird cruises on instead of milling randomly for a frame at every tip
  if (path && !path.length) { m._tPlanT = 0; path = birdTunnelPlan(m, now); }
  if (m._tGoal === "dig") {
    const dg = birdDigLive(m, now);
    if (!dg) { m._tGoal = null; }
    else if (now - (m._digT0 || 0) > 8) { birdDigGiveUp(m); m._tGoal = null; }
  }
  // if the next waypoint's cell just got filled in, avoid it and reroute (go around)
  if (path && path.length && isSolid(Math.floor(path[0].x), Math.floor(path[0].y + 0.25), Math.floor(path[0].z))) {
    const avoid = m._tAvoid || (m._tAvoid = new Map());
    avoid.set(Math.floor(path[0].x) + "," + Math.floor(path[0].y + 0.25) + "," + Math.floor(path[0].z), now + 6);
    m._tPath = null; m._tPlanT = 0;
    path = birdTunnelPlan(m, now);
  }
  const wp = path && path.length ? path[0] : null;
  let threading = false;
  if (wp) {
    const c0 = wpCellOf(wp);
    threading = birdHoleCell(c0[0], c0[1], c0[2], m);
  }
  m._threading = threading;
  const sp = WALK;
  let vx = m.vel.x, vy = m.vel.y, vz = m.vel.z;
  if (!wp) {
    const keys = birdTunnelLiveDigKeys(m);
    if (keys.size) {
      m._tPlanT = 0;
      m._tGoal = null;
    }
    m._millT = (m._millT || 0) - dt;
    if (!m._millTarget || m._millT <= 0 || Math.hypot(m._millTarget.x - m.pos.x, m._millTarget.y - m.pos.y, m._millTarget.z - m.pos.z) < 0.6) {
      m._millTarget = m._inHouse ? birdCoopTarget(m._inHouse) : birdMillHop(m);
      m._millT = 2;
    }
    const k0 = Math.min(1, dt * 4);
    if (m._millTarget) {
      const mx = m._millTarget.x - m.pos.x, my = m._millTarget.y - m.pos.y, mz = m._millTarget.z - m.pos.z;
      const ml = Math.hypot(mx, my, mz) || 1;
      const eff = Math.min(sp, Math.max(1.6, ml * 4));
      vx += ((mx / ml) * eff - vx) * k0;
      vy += ((my / ml) * eff - vy) * k0;
      vz += ((mz / ml) * eff - vz) * k0;
    } else {
      vx += (0 - vx) * k0; vy += (0.4 - vy) * k0; vz += (0 - vz) * k0;
    }
    const vel0 = { x: vx, y: vy, z: vz };
    birdTunnelSeparate(m, dt, vel0);
    const px0 = m.pos.x, py0 = m.pos.y, pz0 = m.pos.z;
    const slid = birdMoveSlide(m, vel0.x, vel0.y, vel0.z, dt);
    const moved = Math.hypot(m.pos.x - px0, m.pos.y - py0, m.pos.z - pz0);
    if (moved < 0.05 * dt) {
      m._tStallT = (m._tStallT || 0) + dt;
      if (m._tStallT > 0.3) {
        m._tStallT = 0;
        birdUTurn(m);
        m._millTarget = null; m._millT = 0;
      }
    } else m._tStallT = 0;
    m.vel.set(slid.vx, slid.vy, slid.vz);
    birdAnimate(m, dt, slid.vx, slid.vy, slid.vz, sp);
    return;
  }
  const nwp = path.length > 1 ? path[1] : null;
  const dx = wp.x - m.pos.x, dy = wp.y - m.pos.y, dz = wp.z - m.pos.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-6;
  // travel axis = dominant axis of the waypoint direction (legs are axis-aligned)
  const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
  const fwd = adx >= ady && adx >= adz ? "x" : (adz >= ady && adz >= adx ? "z" : "y");
  const fs = fwd === "x" ? Math.sign(dx) : (fwd === "z" ? Math.sign(dz) : Math.sign(dy));
  const perpA = fwd === "x" ? ["y", "z"] : (fwd === "z" ? ["x", "y"] : ["x", "z"]);
  const dOf = (a) => a === "x" ? dx : (a === "y" ? dy : dz);
  const velOf = (a) => a === "x" ? vx : (a === "y" ? vy : vz);
  const setVel = (a, v) => { if (a === "x") vx = v; else if (a === "y") vy = v; else vz = v; };
  const perpOff = Math.hypot(dOf(perpA[0]), dOf(perpA[1]));
  const kFwd = Math.min(1, dt * 8);
  const kCruise = Math.min(1, dt * 6);
  // hysteresis on the align/cruise split so the phase never flaps at a boundary
  let aligning = m._tAlign;
  if (aligning) { if (perpOff < BIRD_ALIGN_EXIT) aligning = false; }
  else if (perpOff > BIRD_ALIGN_ENTER) aligning = true;
  m._tAlign = aligning;
  // dead-centre on the leg line: perp velocity is a pure proportional (set, not
  // lerped) so the offset converges exponentially with zero overshoot/oscillation
  const centerVel = (a) => Math.max(-BIRD_ALIGN_SPEED, Math.min(BIRD_ALIGN_SPEED, dOf(a) * BIRD_ALIGN_GAIN));
  if (aligning) {
    // ALIGN phase: brake the travel axis, snap perpendicular onto the leg line
    // (always heads into the free corridor centre, so it never cuts a corner).
    setVel(fwd, velOf(fwd) + (0 - velOf(fwd)) * kFwd);
    for (const a of perpA) setVel(a, centerVel(a));
  } else {
    // CRUISE phase: spring forward along the leg, perps hold the corridor centre.
    // Through a hole cell the pace drops to a careful funnel speed instead.
    let effSp = threading ? Math.min(sp, BIRD_HOLE_SPEED) : sp;
    if (nwp) {
      const lx = nwp.x - wp.x, ly = nwp.y - wp.y, lz = nwp.z - wp.z;
      const ll = Math.hypot(lx, ly, lz) || 1;
      const turnCos = Math.abs((fwd === "x" ? lx : (fwd === "z" ? lz : ly)) / ll);
      const prox = Math.max(0, Math.min(1, (dist - BIRD_POP_R) / BIRD_TURN_BRAKE_DIST));
      effSp *= (1 - prox) + prox * (0.5 + 0.5 * turnCos);
    }
    const curSpd = Math.hypot(vx, vy, vz);
    if (curSpd > 0.1) {
      const legX = fwd === "x" ? fs : 0, legY = fwd === "y" ? fs : 0, legZ = fwd === "z" ? fs : 0;
      const align = (vx * legX + vy * legY + vz * legZ) / curSpd;
      if (align < 0.2) effSp *= 0.15 + 0.85 * Math.max(0, align);
    }
    if (path.length === 1) effSp = Math.min(effSp, Math.max(1.2, dist * 4));
    effSp = Math.max(1.2, effSp);
    setVel(fwd, velOf(fwd) + (fs * effSp - velOf(fwd)) * kCruise);
    for (const a of perpA) setVel(a, centerVel(a));
  }
  const totalSpd = Math.hypot(vx, vy, vz);
  if (totalSpd > sp) {
    const s = sp / totalSpd;
    vx *= s; vy *= s; vz *= s;
  }
  const vel = { x: vx, y: vy, z: vz };
  birdTunnelSeparate(m, dt, vel);
  const px0 = m.pos.x, py0 = m.pos.y, pz0 = m.pos.z;
  const slid = birdMoveSlide(m, vel.x, vel.y, vel.z, dt);
  const moved = Math.hypot(m.pos.x - px0, m.pos.y - py0, m.pos.z - pz0);
  // NEVER stay blocked: stall means go around via avoid+replan, dead-end means
  // U-turn via the same path (BFS routes back out). No teleport anywhere here:
  // threading/exit just hold and replan so the precision approach is kept.
  // A slow crawl just gets a fresh plan (the path was likely stale).
  if (moved < 0.05 * dt) {
    m._tStallT = (m._tStallT || 0) + dt;
    m._tCrawlT = 0;
    if (m._tStallT > 0.3) {
      m._tStallT = 0;
      if (!threading && m._tGoal !== "exit") {
        const side = birdSidestep(m);
        if (side) {
          m.pos.x = side.x; m.pos.y = side.y; m.pos.z = side.z;
          m.vel.set(side.dx * 1.5, side.dy * 1.5, side.dz * 1.5);
        } else {
          birdUTurn(m);
        }
      } else {
        m._tPath = null; m._tPlanT = 0;
      }
      m.vel.set(m.vel.x * 0.3, m.vel.y * 0.3, m.vel.z * 0.3);
    }
  } else if (moved < 0.5 * dt) {
    m._tCrawlT = (m._tCrawlT || 0) + dt;
    m._tStallT = 0;
    if (m._tCrawlT > 1.0) {
      m._tCrawlT = 0;
      m._tPath = null; m._tPlanT = 0;
    }
  } else {
    m._tStallT = 0;
    m._tCrawlT = 0;
  }
  m.vel.set(slid.vx, slid.vy, slid.vz);
  birdAnimate(m, dt, slid.vx, slid.vy, slid.vz, sp, wp);
}
function birdTunnelSeparate(m, dt, vel) {
  const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 1);
  for (const o of nearby) {
    if (o === m || !isBirdKind(o.kind)) continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    if (birdSameChain(m, o)) continue;
    const ox = m.pos.x - o.pos.x, oy = m.pos.y - o.pos.y, oz = m.pos.z - o.pos.z;
    const d2 = ox * ox + oy * oy + oz * oz;
    if (d2 < BIRD_TUNNEL_SEP_DIST * BIRD_TUNNEL_SEP_DIST && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (BIRD_TUNNEL_SEP_DIST - d) * 2 * dt;
      vel.x += (ox / d) * push;
      vel.y += (oy / d) * push;
      vel.z += (oz / d) * push;
    }
  }
}
let birdPerchGroup = 1;
const WOLF_FUR = 0xc8cdd2;
const WOLF_COLLAR_COLORS = [0xe53935, 0x2ecc40, 0x246bff, 0xffd600, 0x00bfa5];
const WOLF_SHOW_COLLAR = false;
let villageCenter = { x: 0, z: 0, y: 0 };
let villageHouses = [];
let villagePen = null;
let villagePool = null;
let villageMinX = 0, villageMaxX = 0, villageMinZ = 0, villageMaxZ = 0;
function computeVillageLayout() {
  villageHouses = [];
  const ang = hash2(0, 0, seed + 7001) * Math.PI * 2;
  const rad = 36 + hash2(0, 0, seed + 7002) * 18;
  let vx = Math.round(Math.cos(ang) * rad);
  let vz = Math.round(Math.sin(ang) * rad);
  vx = Math.max(-WORLD_RADIUS + VILLAGE_RADIUS + 4, Math.min(WORLD_RADIUS - VILLAGE_RADIUS - 4, vx));
  vz = Math.max(-WORLD_RADIUS + VILLAGE_RADIUS + 4, Math.min(WORLD_RADIUS - VILLAGE_RADIUS - 4, vz));
  let vy = heightAt(vx, vz);
  let bestVar = Infinity;
  for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) {
    const cx = vx + dx, cz = vz + dz;
    let sum = 0, n = 0, mn = 99, mx = -99;
    for (let x = cx - VILLAGE_RADIUS; x <= cx + VILLAGE_RADIUS; x += 2) for (let z = cz - VILLAGE_RADIUS; z <= cz + VILLAGE_RADIUS; z += 2) {
      const h = heightAt(x, z);
      sum += h; n++; if (h < mn) mn = h; if (h > mx) mx = h;
    }
    const v = mx - mn;
    if (v < bestVar) { bestVar = v; vx = cx; vz = cz; vy = Math.round(sum / n); }
  }
  vy = Math.max(WATER_LEVEL + 2, vy);
  villageCenter = { x: vx, z: vz, y: vy };
  villageMinX = vx - VILLAGE_RADIUS; villageMaxX = vx + VILLAGE_RADIUS;
  villageMinZ = vz - VILLAGE_RADIUS; villageMaxZ = vz + VILLAGE_RADIUS;
  // — pig/cow pen first to guarantee a slot (14×12) —
  villagePen = null;
  let _penTries = 0;
  for (let _pt = 0; _pt < 1200 && !villagePen; _pt++) {
    _penTries++;
    const rx = (hash2(_penTries, 10, seed + 7250) * 2 - 1) * (VILLAGE_RADIUS - Math.max(VILLAGE_PEN_W, VILLAGE_PEN_D) / 2 - 4);
    const rz = (hash2(_penTries, 11, seed + 7251) * 2 - 1) * (VILLAGE_RADIUS - Math.max(VILLAGE_PEN_W, VILLAGE_PEN_D) / 2 - 4);
    const cx = Math.round(vx + rx), cz = Math.round(vz + rz);
    const minX = cx - Math.floor(VILLAGE_PEN_W / 2), maxX = minX + VILLAGE_PEN_W - 1;
    const minZ = cz - Math.floor(VILLAGE_PEN_D / 2), maxZ = minZ + VILLAGE_PEN_D - 1;
    if (Math.hypot(cx - vx, cz - vz) + Math.max(VILLAGE_PEN_W, VILLAGE_PEN_D) / 2 + 1 > VILLAGE_RADIUS) continue;
    const _toC = Math.atan2(vz - cz, vx - cx);
    const _a = ((_toC * 180 / Math.PI) + 360) % 360;
    let _gateSide = 0;
    if (_a >= 45 && _a < 135) _gateSide = 1;
    else if (_a >= 135 && _a < 225) _gateSide = 2;
    else if (_a >= 225 && _a < 315) _gateSide = 3;
    villagePen = { cx, cz, vy, minX, maxX, minZ, maxZ, gateSide: _gateSide };
    villagePen.pool = { minX: minX + 1, minZ: minZ + 1, maxX: minX + VILLAGE_PEN_POOL_W, maxZ: minZ + VILLAGE_PEN_POOL_D };
  }
  // — 8x6 swimming pool, 2 deep, at floor level; avoids the pen, houses avoid it —
  villagePool = null;
  let _poolTries = 0;
  for (let _pt = 0; _pt < 1200 && !villagePool; _pt++) {
    _poolTries++;
    const rx = (hash2(_poolTries, 12, seed + 7260) * 2 - 1) * (VILLAGE_RADIUS - Math.max(VILLAGE_POOL_W, VILLAGE_POOL_D) / 2 - 4);
    const rz = (hash2(_poolTries, 13, seed + 7261) * 2 - 1) * (VILLAGE_RADIUS - Math.max(VILLAGE_POOL_W, VILLAGE_POOL_D) / 2 - 4);
    const cx = Math.round(vx + rx), cz = Math.round(vz + rz);
    const minX = cx - Math.floor(VILLAGE_POOL_W / 2), maxX = minX + VILLAGE_POOL_W - 1;
    const minZ = cz - Math.floor(VILLAGE_POOL_D / 2), maxZ = minZ + VILLAGE_POOL_D - 1;
    if (Math.hypot(cx - vx, cz - vz) + Math.max(VILLAGE_POOL_W, VILLAGE_POOL_D) / 2 + 1 > VILLAGE_RADIUS) continue;
    if (villagePen && !(maxX + 2 < villagePen.minX || minX - 2 > villagePen.maxX || maxZ + 2 < villagePen.minZ || minZ - 2 > villagePen.maxZ)) continue;
    villagePool = { cx, cz, vy, minX, maxX, minZ, maxZ };
  }
  let tries = 0;
  for (let i = 0; i < VILLAGE_HOUSES; ) {
    const rx = (hash2(tries, 0, seed + 7200 + i * 997) * 2 - 1) * (VILLAGE_RADIUS - 7);
    const rz = (hash2(tries, 1, seed + 7200 + i * 997) * 2 - 1) * (VILLAGE_RADIUS - 7);
    const cx = Math.round(vx + rx), cz = Math.round(vz + rz);
    tries++;
    if (Math.hypot(cx - vx, cz - vz) + 4 > VILLAGE_RADIUS) { if (tries > 800) break; continue; }
    let ok = true;
    for (const h of villageHouses) if (Math.abs(h.cx - cx) < 9 && Math.abs(h.cz - cz) < 9) { ok = false; break; }
    if (!ok) { if (tries > 800) break; continue; }
    const w = 7, d = 7;
    const minX = cx - Math.floor(w / 2), maxX = minX + w - 1;
    const minZ = cz - Math.floor(d / 2), maxZ = minZ + d - 1;
    // avoid the pen and the pool
    if (villagePen && !(maxX + 2 < villagePen.minX || minX - 2 > villagePen.maxX || maxZ + 2 < villagePen.minZ || minZ - 2 > villagePen.maxZ)) { if (tries > 800) break; continue; }
    if (villagePool && !(maxX + 2 < villagePool.minX || minX - 2 > villagePool.maxX || maxZ + 2 < villagePool.minZ || minZ - 2 > villagePool.maxZ)) { if (tries > 800) break; continue; }
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
    if (doorNz !== 0) { d0x = doorX; d1x = doorX + 1; }
    else { d0z = doorZ; d1z = doorZ + 1; }
    const doorCx = (d0x + d1x) / 2 + 0.5;
    const doorCz = (d0z + d1z) / 2 + 0.5;
    const apronX = doorCx + doorNx * 1.6;
    const apronZ = doorCz + doorNz * 1.6;
    const padOff = 1.2;
    const padX = doorCx - doorNx * padOff;
    const padZ = doorCz - doorNz * padOff;
    const varId = 1 + Math.floor(hash2(i, 9, seed + 7150) * 3);
    const beamMask = Math.floor(hash2(i, 20, seed + 7330) * 16);
    const roofIsPlank = hash2(i, 21, seed + 7340) > 0.5;
    villageHouses.push({ id: i, cx, cz, vy, minX, maxX, minZ, maxZ, doorX, doorZ, doorNx, doorNz, d0x, d0z, d1x, d1z, doorCx, doorCz, apronX, apronZ, padX, padZ, ix: cx, iz: cz, varId, beamMask, roofIsPlank, doorQueue: [], doorLock: null, lockUntil: 0 });
    i++;
  }
}
function intersectsVillage(x, z) {
  return x >= villageMinX - 2 && x <= villageMaxX + 2 && z >= villageMinZ - 2 && z <= villageMaxZ + 2;
}
function isInsideAnyHouse(x, z) {
  for (const h of villageHouses) if (x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ) return h;
  return null;
}
function mobOnRoofLevel(y) {
  return villageHouses.length && y >= villageCenter.y + 5.5 && y <= villageCenter.y + 12;
}
function houseAtRoof(x, z) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) return h;
  return null;
}
function isMobOnRoof(m) {
  if (dim !== "over") return false;
  if (!m || !m.pos) return false;
  if (!mobOnRoofLevel(m.pos.y)) return false;
  return !!houseAtRoof(m.pos.x, m.pos.z);
}
function houseInteriorFor(x, y, z) {
  const h = isInsideAnyHouse(x, z);
  if (!h) return null;
  if (y < h.vy + 1 || y >= h.vy + 5) return null;
  return h;
}
function houseMouths(h) {
  const now = performance.now() / 1000;
  if (h._mouths && now - h._mouthsT < 0.25) return h._mouths;
  const isDoor = (x, z) => (x === h.d0x && z === h.d0z) || (x === h.d1x && z === h.d1z);
  const list = [];
  for (let y = h.vy + 1; y <= h.vy + 4; y++) {
    for (let x = h.minX; x <= h.maxX; x++) for (const z of [h.minZ, h.maxZ]) {
      if (y <= h.vy + 3 && isDoor(x, z)) continue;
      if (isSolid(x, y, z)) continue;
      list.push({ x, y, z });
    }
    for (let z = h.minZ + 1; z <= h.maxZ - 1; z++) for (const x of [h.minX, h.maxX]) {
      if (y <= h.vy + 3 && isDoor(x, z)) continue;
      if (isSolid(x, y, z)) continue;
      list.push({ x, y, z });
    }
  }
  for (let y = h.vy + 5; y <= h.vy + 8; y++) {
    const inset = houseRoofInset(h, y);
    for (let x = h.minX + inset; x <= h.maxX - inset; x++) for (let z = h.minZ + inset; z <= h.maxZ - inset; z++) {
      if (isSolid(x, y, z)) continue;
      list.push({ x, y, z });
    }
  }
  if (h._mouthSet) {
    for (const c of list) {
      if (!h._mouthSet.has(c.x + "," + c.y + "," + c.z)) {
        h._breakX = c.x + 0.5; h._breakY = c.y + 0.5; h._breakZ = c.z + 0.5; h._breakT = now;
        break;
      }
    }
  }
  h._mouthSet = new Set(list.map((c) => c.x + "," + c.y + "," + c.z));
  h._mouths = list;
  h._mouthsT = now;
  return list;
}
function birdLavaAt(x, y, z, m) {
  const hw = birdColHW(m), hh = birdColH(m);
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
  const y0 = Math.floor(y), y1 = Math.floor(y + hh);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
  for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++)
    if (getBlock(bx, by, bz) === LAVA) return true;
  return false;
}
function birdSegmentFree(ax, ay, az, bx, by, bz, m) {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(2, Math.ceil(d * 2));
  const hw = birdColHW(m), hh = birdColH(m);
  const lava = dim === "nether";
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
    if (aabbCollidesWorld(px, py, pz, hw, hh)) return false;
    if (lava && birdLavaAt(px, py, pz, m)) return false;
  }
  return true;
}
function bandReturnTarget(pos, m) {
  if ((m && endMobInEnd(m)) || (!m && dim === "end")) {
    let x = endSquareCoord(pos.x), z = endSquareCoord(pos.z);
    const y = Math.max(DRAGON_MIN_Y, Math.min(DRAGON_MAX_Y, pos.y < DRAGON_MIN_Y ? DRAGON_MIN_Y + 2 : DRAGON_MAX_Y - 2));
    return new THREE.Vector3(x, y, z);
  }
  const loB = birdBandMin(m), hiB = birdBandMax(m);
  const y = pos.y < loB ? loB + 10 : hiB - 10;
  return new THREE.Vector3(
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, pos.x)),
    y,
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, pos.z)));
}
function birdCellKey(x, y, z) { return Math.floor(x) + "," + Math.floor(y) + "," + Math.floor(z); }
function birdTouchVisit(m, now) {
  const k = birdCellKey(m.pos.x, m.pos.y + 0.25, m.pos.z);
  let visits = m._visits;
  if (!visits) visits = m._visits = new Map();
  if (visits.has(k)) visits.delete(k);
  visits.set(k, now);
  if (visits.size > BIRD_VISIT_MEM) visits.delete(visits.keys().next().value);
  if (m._visitKey !== k) {
    m._visitKey = k;
    const trail = m._trail || (m._trail = []);
    trail.push([+m.pos.x.toFixed(1), +m.pos.y.toFixed(1), +m.pos.z.toFixed(1)]);
    if (trail.length > 300) trail.splice(0, trail.length - 300);
  }
}
function birdDetourTarget(m) {
  const best = birdBestSteer(m, m.yaw, 0);
  if (!best || best.clear <= 0) return null;
  const d = Math.min(best.clear, 6);
  let x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.x + best.x * d));
  let y = Math.max(1.5, Math.min(MAX_Y - 1, m.pos.y + best.y * d));
  let z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.z + best.z * d));
  if (endMobInEnd(m)) {
    x = endSquareCoord(x); z = endSquareCoord(z);
    y = Math.max(DRAGON_MIN_Y, Math.min(DRAGON_MAX_Y, y));
  }
  if (!birdProbeFree(x, y, z)) return null;
  return new THREE.Vector3(x, y, z);
}
let birdNotices = [];
let birdNoticeSeq = 0;
function birdNoticeBreak(bx, by, bz) {
  const now = performance.now() / 1000;
  birdNotices = birdNotices.filter((n) => now - n.t < 15);
  birdNotices.push({ x: bx + 0.5, y: by + 0.5, z: bz + 0.5, bx, by, bz, t: now, id: ++birdNoticeSeq });
  if (birdNotices.length > 6) birdNotices.splice(0, birdNotices.length - 6);
}
function birdDigReachable(m, n) {
  if (birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, n.x, n.y, n.z)) return true;
  if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.pos.x, n.y, m.pos.z)) return false;
  return birdSegmentFree(m.pos.x, n.y, m.pos.z, n.x, n.y, n.z);
}
function birdDigLive(m, now) {
  if (m._digGoal == null) return null;
  for (const n of birdNotices) {
    if (n.id !== m._digGoal) continue;
    if (now - n.t > 8 || isSolid(n.bx, n.by, n.bz)) { m._digGoal = null; return null; }
    return n;
  }
  m._digGoal = null;
  return null;
}
function birdDigGiveUp(m) {
  if (m._digGoal != null) {
    (m._seenBreaks || (m._seenBreaks = {}))[m._digGoal] = true;
    m._digGoal = null;
  }
}
function birdFreshDigFor(m, now, range) {
  const seen = m._seenBreaks || (m._seenBreaks = {});
  for (const k of Object.keys(seen)) {
    let live = false;
    for (const n of birdNotices) if (n.id === +k) { live = true; break; }
    if (!live) delete seen[k];
  }
  let best = null, bestD2 = Infinity;
  for (const n of birdNotices) {
    if (now - n.t > 8 || seen[n.id]) continue;
    if (isSolid(n.bx, n.by, n.bz)) continue;
    const dx = n.x - m.pos.x, dy = n.y - m.pos.y, dz = n.z - m.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > range * range) continue;
    if (!birdDigReachable(m, n)) continue;
    if (d2 < bestD2) { bestD2 = d2; best = n; }
  }
  return best;
}
function birdCloudTopAt(cx, cz, loY, hiY) {
  const bx = Math.floor(cx), bz = Math.floor(cz);
  if (bx < -WORLD_RADIUS + 1 || bx > WORLD_RADIUS - 1 || bz < -WORLD_RADIUS + 1 || bz > WORLD_RADIUS - 1) return null;
  const lo = loY == null ? BIRD_MIN_Y : loY, hi = hiY == null ? BIRD_MAX_Y : hiY;
  let top = colTops.over[colTopIdx(bx, bz)];
  if (top > hi) top = Math.floor(hi);
  if (top < lo) return null;
  for (let y = top; y >= lo; y--) {
    if (getBlock(bx, y, bz) !== CLOUD) continue;
    const spot = new THREE.Vector3(bx + 0.5, y + 1, bz + 0.5);
    if (!aabbCollidesWorld(spot.x, spot.y, spot.z, BIRD_COL_HW, BIRD_COL_H)) return spot;
  }
  return null;
}
function birdTreeTopAt(cx, cz) {
  const bx = Math.floor(cx), bz = Math.floor(cz);
  if (bx < -WORLD_RADIUS + 1 || bx > WORLD_RADIUS - 1 || bz < -WORLD_RADIUS + 1 || bz > WORLD_RADIUS - 1) return null;
  let top = colTops.over[colTopIdx(bx, bz)];
  if (top > 135) top = 135;
  for (let y = top; y >= 8; y--) {
    const id = getBlock(bx, y, bz);
    if (id !== LOG && id !== LEAVES) continue;
    const spot = new THREE.Vector3(bx + 0.5, y + 1, bz + 0.5);
    if (!aabbCollidesWorld(spot.x, spot.y, spot.z, BIRD_COL_HW, BIRD_COL_H)) return spot;
  }
  return null;
}
function houseRoofInset(h, y) {
  return y - (h.vy + 5);
}
function houseRoofCell(h, bx, by, bz) {
  if (by < h.vy + 5 || by > h.vy + 8) return false;
  const inset = houseRoofInset(h, by);
  return bx >= h.minX + inset && bx <= h.maxX - inset && bz >= h.minZ + inset && bz <= h.maxZ - inset;
}
function birdPerchSupports(x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y) - 1, bz = Math.floor(z);
  const id = getBlock(bx, by, bz);
  if (dim === "end") {
    if (id === PORTAL && bz === END_RETURN_Z && bx >= -2 && bx <= 2 &&
        by >= END_RETURN_BASE_Y && by <= END_RETURN_BASE_Y + 4) return true;
    return false;
  }
  if (id === CLOUD || id === LOG || id === LEAVES) return true;
  if ((id === STONE || id === PLANKS || id === PORTAL || id === OBSIDIAN) && villageHouses.length) {
    const h = houseAtRoof(bx + 0.5, bz + 0.5);
    if (h && houseRoofCell(h, bx, by, bz)) return true;
  }
  return false;
}
function birdRoofTopAt(cx, cz) {
  if (!villageHouses.length) return null;
  const h = houseAtRoof(cx, cz);
  if (!h) return null;
  const bx = Math.floor(cx), bz = Math.floor(cz);
  for (let y = h.vy + 8; y >= h.vy + 5; y--) {
    if (!houseRoofCell(h, bx, y, bz)) continue;
    const id = getBlock(bx, y, bz);
    if (id !== STONE && id !== PLANKS && id !== LOG && id !== PORTAL && id !== OBSIDIAN) continue;
    const spot = new THREE.Vector3(bx + 0.5, y + 1, bz + 0.5);
    if (aabbCollidesWorld(spot.x, spot.y, spot.z, BIRD_COL_HW, BIRD_COL_H)) return null;
    return spot;
  }
  return null;
}
function birdEndPortalTopAt(cx, cz) {
  let best = null, bestD = Infinity;
  for (let bx = -2; bx <= 2; bx++) {
    for (let y = END_RETURN_BASE_Y + 4; y >= END_RETURN_BASE_Y; y--) {
      if (getBlock(bx, y, END_RETURN_Z) !== PORTAL) continue;
      const spot = new THREE.Vector3(bx + 0.5, y + 1, END_RETURN_Z + 0.5);
      if (aabbCollidesWorld(spot.x, spot.y, spot.z, BIRD_COL_HW, BIRD_COL_H)) break;
      const d = Math.hypot(spot.x - cx, spot.z - cz);
      if (d < bestD) { bestD = d; best = spot; }
      break;
    }
  }
  return best;
}
function birdPerchBand(y) {
  if (y < CLOUD_BASE) return 0;
  if (y < CLOUD_BASE + (BIRD_MAX_Y - CLOUD_BASE) / 2) return 1;
  return 2;
}
function birdJoinSlotAt(x, z, refY) {
  if (dim === "end") {
    const s = birdEndPortalTopAt(x, z);
    if (s && Math.abs(s.y - refY) <= 2) return s;
    return null;
  }
  const t = birdTreeTopAt(x, z), c = birdCloudTopAt(x, z), r = birdRoofTopAt(x, z);
  const ok = (s) => s && Math.abs(s.y - refY) <= 2;
  let best = null, bestD = Infinity;
  for (const s of [t, c, r]) {
    if (!ok(s)) continue;
    const d = Math.abs(s.y - refY);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
function birdPerchSpotTaken(x, y, z, self) {
  const md = self && self.dim !== undefined ? self.dim : dim;
  for (const o of mobs) {
    if (o === self || !isBirdKind(o.kind)) continue;
    const od = o.dim !== undefined ? o.dim : dim;
    if (od !== md) continue;
    const t = (o.mode === "toPerch" && o.perchSpot) ? o.perchSpot : (o.mode === "perch" ? o.pos : null);
    if (!t) continue;
    if (Math.hypot(t.x - x, t.y - y, t.z - z) < BIRD_PERCH_SEP) return true;
  }
  return false;
}
function birdFindPerchSpot(m, nearMax = 0) {
  const md = m.dim !== undefined ? m.dim : dim;
  if (md === "nether") return null;
  if (md === "end") {
    const groupCounts = new Map();
    for (const o of mobs) {
      if (o === m || !isBirdKind(o.kind) || o.perchGroup == null) continue;
      const od = o.dim !== undefined ? o.dim : dim;
      if (od !== "end") continue;
      if (o.mode !== "perch" && o.mode !== "toPerch") continue;
      if (!o.perchSpot) continue;
      groupCounts.set(o.perchGroup, (groupCounts.get(o.perchGroup) || 0) + 1);
    }
    let join = null, joinD = Infinity;
    for (const o of mobs) {
      if (o === m || !isBirdKind(o.kind) || o.perchGroup == null || !o.perchSpot) continue;
      const od = o.dim !== undefined ? o.dim : dim;
      if (od !== "end") continue;
      if (o.mode !== "perch" && o.mode !== "toPerch") continue;
      if ((groupCounts.get(o.perchGroup) || 0) >= 3) continue;
      const d = Math.hypot(o.perchSpot.x - m.pos.x, o.perchSpot.y - m.pos.y, o.perchSpot.z - m.pos.z);
      if (d > BIRD_PERCH_JOIN_R || d >= joinD) continue;
      joinD = d; join = o;
    }
    if (join) {
      const offs = [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]];
      const s0 = Math.floor(Math.random() * offs.length);
      for (let k = 0; k < offs.length; k++) {
        const off = offs[(s0 + k) % offs.length];
        const spot = birdEndPortalTopAt(join.perchSpot.x + off[0], join.perchSpot.z + off[1]);
        if (!spot || Math.abs(spot.y - join.perchSpot.y) > 2) continue;
        if (birdPerchSpotTaken(spot.x, spot.y, spot.z, m)) continue;
        if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, spot.x, spot.y, spot.z)) continue;
        return { spot, group: join.perchGroup };
      }
    }
    for (let t = 0; t < 8; t++) {
      const spot = birdEndPortalTopAt(m.pos.x + (Math.random() - 0.5) * 12, m.pos.z + (Math.random() - 0.5) * 12);
      if (!spot) continue;
      if (birdPerchSpotTaken(spot.x, spot.y, spot.z, m)) continue;
      if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, spot.x, spot.y, spot.z)) continue;
      return { spot, group: birdPerchGroup++ };
    }
    return null;
  }
  const counts = [0, 0, 0];
  const groupCounts = new Map();
  for (const o of mobs) {
    if (o === m || !isBirdKind(o.kind) || o.perchGroup == null) continue;
    const od = o.dim !== undefined ? o.dim : dim;
    if (od !== md) continue;
    if (o.mode !== "perch" && o.mode !== "toPerch") continue;
    if (!o.perchSpot) continue;
    counts[birdPerchBand(o.perchSpot.y)]++;
    groupCounts.set(o.perchGroup, (groupCounts.get(o.perchGroup) || 0) + 1);
  }
  let band;
  if (nearMax || Math.random() < 0.25) band = Math.floor(Math.random() * 3);
  else {
    band = 0;
    for (let b = 1; b < 3; b++)
      if (counts[b] < counts[band] || (counts[b] === counts[band] && Math.random() < 0.5)) band = b;
  }
  const inBand = (s) => s && birdPerchBand(s.y) === band;
  let join = null, joinD = Infinity;
  for (const o of mobs) {
    if (o === m || !isBirdKind(o.kind) || o.perchGroup == null || !o.perchSpot) continue;
    const od = o.dim !== undefined ? o.dim : dim;
    if (od !== md) continue;
    if (o.mode !== "perch" && o.mode !== "toPerch") continue;
    if (!inBand(o.perchSpot)) continue;
    if ((groupCounts.get(o.perchGroup) || 0) >= 3) continue;
    const d = Math.hypot(o.perchSpot.x - m.pos.x, o.perchSpot.y - m.pos.y, o.perchSpot.z - m.pos.z);
    if (d > BIRD_PERCH_JOIN_R || d >= joinD) continue;
    joinD = d; join = o;
  }
  if (join) {
    const offs = [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]];
    const s0 = Math.floor(Math.random() * offs.length);
    for (let k = 0; k < offs.length; k++) {
      const off = offs[(s0 + k) % offs.length];
      const spot = birdJoinSlotAt(join.perchSpot.x + off[0], join.perchSpot.z + off[1], join.perchSpot.y);
      if (!spot) continue;
      if (birdPerchSpotTaken(spot.x, spot.y, spot.z, m)) continue;
      if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, spot.x, spot.y, spot.z)) continue;
      return { spot, group: join.perchGroup };
    }
  }
  const rMax = nearMax || 90;
  const trySpot = (spot) => {
    if (!inBand(spot)) return null;
    if (birdPerchSpotTaken(spot.x, spot.y, spot.z, m)) return null;
    if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, spot.x, spot.y, spot.z)) return null;
    return { spot, group: birdPerchGroup++ };
  };
  if (band === 0) {
    const wantRoofFirst = Math.random() < 0.5;
    const roofTries = wantRoofFirst ? 24 : 8, treeTries = wantRoofFirst ? 8 : 24;
    for (let t = 0; t < roofTries; t++) {
      let spot = null;
      if (!nearMax && villageHouses.length && Math.random() < 0.6) {
        const h = villageHouses[Math.floor(Math.random() * villageHouses.length)];
        const bx = h.minX + Math.floor(Math.random() * (h.maxX - h.minX + 1));
        const bz = h.minZ + Math.floor(Math.random() * (h.maxZ - h.minZ + 1));
        spot = birdRoofTopAt(bx + 0.5, bz + 0.5);
      } else {
        const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * Math.max(8, rMax - 8);
        spot = birdRoofTopAt(m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d);
      }
      const got = spot && trySpot(spot);
      if (got) return got;
    }
    for (let t = 0; t < treeTries; t++) {
      const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * Math.max(8, rMax - 8);
      const spot = birdTreeTopAt(m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d);
      if (!spot) continue;
      const got = trySpot(spot);
      if (got) return got;
    }
    return null;
  }
  const mid = CLOUD_BASE + (BIRD_MAX_Y - CLOUD_BASE) / 2;
  const lo = band === 1 ? CLOUD_BASE : mid, hi = band === 1 ? mid : BIRD_MAX_Y;
  for (let t = 0; t < 24; t++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * Math.max(8, rMax - 8);
    const spot = birdCloudTopAt(m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d, lo, hi);
    if (!spot) continue;
    const got = trySpot(spot);
    if (got) return got;
  }
  return null;
}
function birdNextLeg(m) {
  m._decideT = 1.2;
  if ((m._noPerchT || 0) <= 0 && birdDimOf(m) !== "nether" && !birdOnMoon(m) && !(m._panicUntil && performance.now() / 1000 < m._panicUntil) && Math.random() < (birdDimOf(m) === "end" ? BIRD_END_PERCH_CHANCE : BIRD_PERCH_CHANCE) && !chainChild.has(m.id)) {
    const found = birdFindPerchSpot(m);
    if (found && !(performance.now() / 1000 < villagePanicUntil && villageSqContains(found.spot.x, found.spot.z))) {
      m.mode = "toPerch";
      m.arc = null;
      m.perchSpot = found.spot;
      m.perchGroup = found.group;
      m.perchTimeout = 30;
      m.target = found.spot;
      m.targetMode = "perch";
      return;
    }
  }
  const confined = birdIsConfined(m);
  if (confined) {
    m.mode = "straight"; m.arc = null;
    m.target = null; m.targetMode = null;
    m._decideT = 0.4;
    m._tPlanT = 0;
    return;
  }
  if (Math.random() < (birdDimOf(m) === "nether" ? 0.7 : 0.45)) {
    let arcOk = !chainLiveFollower(m);
    if (!arcOk) {
      const vl = Math.hypot(m.vel.x, m.vel.z);
      arcOk = vl >= 0.5 && !chainLeadConeDeflect(m, m.vel.x / vl, m.vel.z / vl);
    }
    if (arcOk) { birdNewArc(m); return; }
  }
  m.mode = "straight"; m.arc = null;
  m.target = birdDimOf(m) === "nether" ? birdReachableTarget(m, 12, 30) : birdReachableTarget(m, 40, 90);
  const leadFol = chainLiveFollower(m);
  if (leadFol && m.target) {
    const tx = m.target.x - m.pos.x, tz = m.target.z - m.pos.z;
    const tl = Math.hypot(tx, tz);
    const fx = leadFol.pos.x - m.pos.x, fz = leadFol.pos.z - m.pos.z;
    const fl = Math.hypot(fx, fz);
    if (tl > 1e-6 && fl > 1e-6 && (tx * fx + tz * fz) / (tl * fl) > Math.cos(CHAIN_LEAD_CONE)) {
      const fang = Math.atan2(fx, fz);
      let rel = Math.atan2(tx, tz) - fang;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      let side;
      if (rel > 0) side = 1;
      else if (rel < 0) side = -1;
      else { m._turnSide = !m._turnSide; side = m._turnSide ? 1 : -1; }
      for (const s of [side, -side]) {
        const ex = Math.sin(fang + s * CHAIN_LEAD_CONE), ez = Math.cos(fang + s * CHAIN_LEAD_CONE);
        const px = m.pos.x + ex * tl, pz = m.pos.z + ez * tl;
        if (birdProbeFree(px, m.target.y, pz) && birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, px, m.target.y, pz)) {
          m.target.set(px, m.target.y, pz);
          break;
        }
      }
    }
  }
  m.targetMode = null;
}
function birdTakeoff(m) {
  const yaw2 = m.yaw + (Math.random() - 0.5) * 1.2;
  m.vel.set(Math.cos(yaw2) * BIRD_SPEED, 1.5, Math.sin(yaw2) * BIRD_SPEED);
  m.perchSpot = null;
  m.perchGroup = null;
  m.perchT = 0;
  m.perchWander = null;
  m.perchWanderT = 0;
  m.perchTimeout = 0;
  m.perchRetry = 0;
  m._decideT = 1.2;
  m._noPerchT = BIRD_NOPERCH_T;
  if (birdDimOf(m) !== "nether" && birdDimOf(m) !== "end" && !birdOnMoon(m) && !(m._panicUntil && performance.now() / 1000 < m._panicUntil) && Math.random() < BIRD_HOP_CHANCE && !chainChild.has(m.id)) {
    const found = birdFindPerchSpot(m, BIRD_HOP_R);
    if (found && Math.hypot(found.spot.x - m.pos.x, found.spot.y - m.pos.y, found.spot.z - m.pos.z) >= 1.5) {
      m.mode = "toPerch";
      m.arc = null;
      m.perchSpot = found.spot;
      m.perchGroup = found.group;
      m.perchTimeout = 30;
      m.target = found.spot;
      m.targetMode = "perch";
      return;
    }
    m.perchRetry = BIRD_HOP_RETRY;
    m.mode = "straight";
    m.arc = null;
    m.target = birdRandomTarget(m.pos, 10, 25);
    m.targetMode = null;
    return;
  }
  m.mode = "straight";
  m.arc = null;
  if (birdDimOf(m) === "end") m.target = birdReachableTarget(m) || birdRandomTarget(m.pos);
  else m.target = birdDimOf(m) === "nether" ? birdRandomTarget(m.pos, 12, 30) : birdRandomTarget(m.pos);
  m.targetMode = null;
}
function isInsidePen(x, z) {
  if (!villagePen) return false;
  return x >= villagePen.minX && x < villagePen.maxX + 1 && z >= villagePen.minZ && z < villagePen.maxZ + 1;
}
function isInsidePenPool(x, z) {
  if (!villagePen || !villagePen.pool) return false;
  const q = villagePen.pool;
  return x >= q.minX && x < q.maxX + 1 && z >= q.minZ && z < q.maxZ + 1;
}
function penPoolExitTarget(x, z, hx, hz) {
  if (!villagePen || !villagePen.pool) return null;
  const q = villagePen.pool, p = villagePen;
  const dL = x - q.minX, dR = (q.maxX + 1) - x, dT = z - q.minZ, dB = (q.maxZ + 1) - z;
  const cx = Math.max(p.minX + 1, Math.min(p.maxX - 1, x));
  const cz = Math.max(p.minZ + 1, Math.min(p.maxZ - 1, z));
  const hl = hx !== undefined && hz !== undefined ? Math.hypot(hx, hz) : 0;
  const nx = hl > 1e-6 ? hx / hl : 0, nz = hl > 1e-6 ? hz / hl : 0;
  const sides = [
    { x: q.minX - 1.5, z: cz, d: dL },
    { x: q.maxX + 2.5, z: cz, d: dR },
    { x: cx, z: q.minZ - 1.5, d: dT },
    { x: cx, z: q.maxZ + 2.5, d: dB },
  ];
  let best = null, bestScore = Infinity;
  for (const s of sides) {
    if (s.x <= p.minX + 0.7 || s.x >= p.maxX - 0.7 || s.z <= p.minZ + 0.7 || s.z >= p.maxZ - 0.7) continue;
    if (s.x < villageMinX + 1 || s.x > villageMaxX - 1 || s.z < villageMinZ + 1 || s.z > villageMaxZ - 1) continue;
    if (isInsideAnyHouse(s.x, s.z)) continue;
    const dx = s.x - x, dz = s.z - z;
    const dl = Math.hypot(dx, dz) || 1;
    const dot = hl > 1e-6 ? (dx * nx + dz * nz) / dl : 0;
    const score = s.d - dot * 2;
    if (score < bestScore) { bestScore = score; best = { x: s.x, z: s.z }; }
  }
  return best;
}
function isInsidePool(x, z) {
  if (!villagePool) return false;
  return x >= villagePool.minX && x < villagePool.maxX + 1 && z >= villagePool.minZ && z < villagePool.maxZ + 1;
}
function poolExitTarget(x, z, hx, hz) {
  if (!villagePool) return null;
  const p = villagePool;
  const dL = x - p.minX, dR = (p.maxX + 1) - x, dT = z - p.minZ, dB = (p.maxZ + 1) - z;
  const cz = Math.max(villageMinZ + 1, Math.min(villageMaxZ - 1, z));
  const cx = Math.max(villageMinX + 1, Math.min(villageMaxX - 1, x));
  const hl = hx !== undefined && hz !== undefined ? Math.hypot(hx, hz) : 0;
  const nx = hl > 1e-6 ? hx / hl : 0, nz = hl > 1e-6 ? hz / hl : 0;
  const sides = [
    { x: p.minX - 1.5, z: cz, d: dL },
    { x: p.maxX + 2.5, z: cz, d: dR },
    { x: cx, z: p.minZ - 1.5, d: dT },
    { x: cx, z: p.maxZ + 2.5, d: dB },
  ];
  let best = null, bestScore = Infinity;
  for (const s of sides) {
    if (s.x < villageMinX + 1 || s.x > villageMaxX - 1 || s.z < villageMinZ + 1 || s.z > villageMaxZ - 1) continue;
    if (isInsideAnyHouse(s.x, s.z)) continue;
    const dx = s.x - x, dz = s.z - z;
    const dl = Math.hypot(dx, dz) || 1;
    const dot = hl > 1e-6 ? (dx * nx + dz * nz) / dl : 0;
    const score = s.d - dot * 2;
    if (score < bestScore) { bestScore = score; best = { x: s.x, z: s.z }; }
  }
  return best;
}
const BATH_MIN_T = 1, BATH_MAX_T = 5;
function isMobInPoolWater(m) {
  return !!villagePool && isInsidePool(m.pos.x, m.pos.z) && mobInWater(m);
}
function isMobInMoonLake(m) {
  if (m.kind === "enderman" || isFlyingKind(m.kind)) return false;
  if (dim !== "over") return false;
  if (!mobInWater(m)) return false;
  const hw = m.hw, hh = m.h;
  const y0 = Math.floor(m.pos.y + 0.01), y1 = Math.floor(m.pos.y + hh - 0.01);
  let moonWet = false;
  for (let y = y0; y <= y1 && !moonWet; y++)
    for (let bx = Math.floor(m.pos.x - hw); bx <= Math.floor(m.pos.x + hw) && !moonWet; bx++)
      for (let bz = Math.floor(m.pos.z - hw); bz <= Math.floor(m.pos.z + hw); bz++) {
        if (getBlock(bx, y, bz) === MOON_WATER) { moonWet = true; break; }
      }
  if (!moonWet) return false;
  return inMoonZone(m.pos.x, m.pos.y, m.pos.z);
}
function moonLakeExitTarget(m) {
  const feet = m.pos.y;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let best = null, bestD = Infinity;
  for (const [dx, dz] of dirs) {
    for (let d = 1; d <= 20; d++) {
      const x = m.pos.x + dx * d, z = m.pos.z + dz * d;
      if (Math.hypot(x, z) > MOON_R) break;
      const bx = Math.floor(x), bz = Math.floor(z);
      let wet = false;
      for (let yy = MOON_Y - 2; yy <= MOON_Y + 1; yy++) {
        if (getBlock(bx, yy, bz) === MOON_WATER) { wet = true; break; }
      }
      if (wet) continue;
      let standY = null;
      for (let yy = MOON_Y + 2; yy >= MOON_Y - 6; yy--) {
        if (Math.abs(yy + 1 - feet) > 3) continue;
        if (!isSolid(bx, yy, bz)) continue;
        if (aabbCollidesWorld(x, yy + 1 + 0.001, z, m.hw, m.h)) continue;
        if (!hasMobGround(x, z, m.hw, yy + 1)) continue;
        standY = yy + 1;
        break;
      }
      if (standY == null) continue;
      const dist = Math.hypot(dx * d, dz * d);
      if (dist < bestD) { bestD = dist; best = { x, z }; }
      break;
    }
  }
  return best;
}
function placeVillagePool() {
  if (!villagePool) return;
  const p = villagePool, vy = p.vy;
  for (let x = p.minX; x <= p.maxX; x++) for (let z = p.minZ; z <= p.maxZ; z++) {
    setBlock(x, vy - VILLAGE_POOL_DEPTH, z, OBSIDIAN);
    for (let y = vy - VILLAGE_POOL_DEPTH + 1; y <= vy; y++) setBlock(x, y, z, WATER);
    if (getBlock(x, vy + 1, z) !== AIR) setBlock(x, vy + 1, z, AIR);
    if (getBlock(x, vy + 2, z) !== AIR) setBlock(x, vy + 2, z, AIR);
  }
  for (let x = p.minX - 1; x <= p.maxX + 1; x++) for (let z = p.minZ - 1; z <= p.maxZ + 1; z++) {
    const onRim = x === p.minX - 1 || x === p.maxX + 1 || z === p.minZ - 1 || z === p.maxZ + 1;
    if (!onRim) continue;
    for (let y = vy - VILLAGE_POOL_DEPTH + 1; y <= vy; y++) setBlock(x, y, z, STONE);
  }
}
function placeVillagePen() {
  if (!villagePen) return;
  const p = villagePen, vy = p.vy;
  // pen floor in grass (instead of stone) and interior cleared to height 1
  for (let x = p.minX + 1; x <= p.maxX - 1; x++) for (let z = p.minZ + 1; z <= p.maxZ - 1; z++) {
    setBlock(x, vy, z, GRASS);
    for (let y = vy + 1; y <= vy + 2; y++) setBlock(x, y, z, AIR);
  }
  // LOG fence — 1 block high, closed (physics alone blocks pig/cow mobs)
  for (let x = p.minX; x <= p.maxX; x++) for (let z = p.minZ; z <= p.maxZ; z++) {
    const onEdge = x === p.minX || x === p.maxX || z === p.minZ || z === p.maxZ;
    if (!onEdge) continue;
    setBlock(x, vy + 1, z, LOG);
    if (getBlock(x, vy + 2, z) !== AIR) setBlock(x, vy + 2, z, AIR);
  }
}
function placeVillagePenPool() {
  if (!villagePen || !villagePen.pool) return;
  const p = villagePen, q = p.pool, vy = p.vy;
  for (let x = q.minX; x <= q.maxX; x++) for (let z = q.minZ; z <= q.maxZ; z++) {
    setBlock(x, vy + 1 - VILLAGE_PEN_POOL_DEPTH, z, STONE);
    for (let y = vy + 2 - VILLAGE_PEN_POOL_DEPTH; y <= vy + 1; y++) setBlock(x, y, z, WATER);
    if (getBlock(x, vy + 2, z) !== AIR) setBlock(x, vy + 2, z, AIR);
    if (getBlock(x, vy + 3, z) !== AIR) setBlock(x, vy + 3, z, AIR);
  }
  // stone L on the two inner sides; the pen's own LOG fence frames the two corner sides
  for (let z = q.minZ; z <= q.maxZ + 1; z++) {
    setBlock(q.maxX + 1, vy + 1, z, STONE);
    if (getBlock(q.maxX + 1, vy + 2, z) !== AIR) setBlock(q.maxX + 1, vy + 2, z, AIR);
    if (getBlock(q.maxX + 1, vy + 3, z) !== AIR) setBlock(q.maxX + 1, vy + 3, z, AIR);
  }
  for (let x = q.minX; x <= q.maxX + 1; x++) {
    setBlock(x, vy + 1, q.maxZ + 1, STONE);
    if (getBlock(x, vy + 2, q.maxZ + 1) !== AIR) setBlock(x, vy + 2, q.maxZ + 1, AIR);
    if (getBlock(x, vy + 3, q.maxZ + 1) !== AIR) setBlock(x, vy + 3, q.maxZ + 1, AIR);
  }
}
function placeVillageHouses() {
  for (const h of villageHouses) {
    const w = 7, d = 7, hh = 5;
    const minX = h.minX, maxX = h.maxX, minZ = h.minZ, maxZ = h.maxZ;
    const vy = h.vy;
    for (let y = vy + 1; y <= vy + hh; y++) {
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const wall = x === minX || x === maxX || z === minZ || z === maxZ;
        if (!wall) { if (y <= vy + 4) setBlock(x, y, z, AIR); continue; }
        const isDoor = (x === h.d0x && z === h.d0z) || (x === h.d1x && z === h.d1z);
        const isWin = (h.doorNz !== 0 ? (z === (h.doorNz === -1 ? maxZ : minZ) && x === h.cx && y === vy + 2) : (x === (h.doorNx === 1 ? minX : maxX) && z === h.cz && y === vy + 2));
        if (y <= vy + 3 && isDoor) continue;
        if (isWin) { setBlock(x, y, z, GLASS); continue; }
        let mat = STONE;
        const isCorner = (x === minX && z === minZ) || (x === minX && z === maxZ) || (x === maxX && z === minZ) || (x === maxX && z === maxZ);
        if (isCorner && y <= vy + 4) mat = LOG;
        else if (y === vy + 3 && !isDoor && !isWin) {
          let onBeamWall = false;
          if (x === minX && (h.beamMask & 8)) onBeamWall = true;
          else if (x === maxX && (h.beamMask & 4)) onBeamWall = true;
          else if (z === minZ && (h.beamMask & 2)) onBeamWall = true;
          else if (z === maxZ && (h.beamMask & 1)) onBeamWall = true;
          if (onBeamWall) mat = PLANKS;
          else if (h.varId === 2) mat = PLANKS;
        } else if (y === vy + hh && isCorner) mat = LOG;
        setBlock(x, y, z, mat);
      }
    }
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const isRoofEdge = x === minX || x === maxX || z === minZ || z === maxZ;
      setBlock(x, vy + hh, z, isRoofEdge ? PORTAL : OBSIDIAN);
    }
    for (let x = minX + 1; x <= maxX - 1; x++) for (let z = minZ + 1; z <= maxZ - 1; z++) {
      const isStepEdge = x === minX + 1 || x === maxX - 1 || z === minZ + 1 || z === maxZ - 1;
      setBlock(x, vy + hh + 1, z, isStepEdge ? PORTAL : OBSIDIAN);
    }
    for (let x = minX + 2; x <= maxX - 2; x++) for (let z = minZ + 2; z <= maxZ - 2; z++) {
      const isTopEdge = x === minX + 2 || x === maxX - 2 || z === minZ + 2 || z === maxZ - 2;
      setBlock(x, vy + hh + 2, z, isTopEdge ? PORTAL : OBSIDIAN);
    }
    setBlock(h.cx, vy + hh + 3, h.cz, PORTAL);
    for (let x = minX + 1; x <= maxX - 1; x++) for (let z = minZ + 1; z <= maxZ - 1; z++) setBlock(x, vy + 1, z, AIR);
    setBlock(h.d0x, vy + 1, h.d0z, AIR); setBlock(h.d1x, vy + 1, h.d1z, AIR);
    setBlock(h.d0x, vy + 2, h.d0z, AIR); setBlock(h.d1x, vy + 2, h.d1z, AIR);
    setBlock(h.d0x, vy + 3, h.d0z, AIR); setBlock(h.d1x, vy + 3, h.d1z, AIR);
    const ax = Math.round(h.apronX), az = Math.round(h.apronZ);
    for (let dx = -1; dx <= 0; dx++) for (let dz = -1; dz <= 0; dz++) setBlock(ax + dx, vy, az + dz, STONE);
  }
}

// ---------------------------------------------------------------------------
// Village mobs (villagers) — real AABB physics like player without stepping
// ---------------------------------------------------------------------------
let mobs = [];
const mobById = new Map();
const MOB_GRID = 8;
const mobGrid = new Map();
let mobTick = 0;
const VISIT_CELL = 8;
const visitGrid = new Map();
function visitKey(x, z){ return (Math.floor(x/VISIT_CELL)+512)*1024 + Math.floor(z/VISIT_CELL)+512; }
function addVisit(x, z){ const k=visitKey(x,z); visitGrid.set(k, (visitGrid.get(k)||0)+1); }
function getVisit(x, z){ return visitGrid.get(visitKey(x,z))||0; }
function buildMobGrid() {
  mobGrid.clear();
  for (const m of mobs) {
    const k = (Math.floor(m.pos.x / MOB_GRID) + 512) * 1024 + Math.floor(m.pos.z / MOB_GRID) + 512;
    let arr = mobGrid.get(k);
    if (!arr) { arr = []; mobGrid.set(k, arr); }
    arr.push(m);
  }
}
function nearbyMobsFor(x, z, rCells = 1) {
  const cx = Math.floor(x / MOB_GRID), cz = Math.floor(z / MOB_GRID);
  const out = [];
  for (let dx = -rCells; dx <= rCells; dx++) for (let dz = -rCells; dz <= rCells; dz++) {
    const arr = mobGrid.get((cx + dx + 512) * 1024 + cz + dz + 512);
    if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
  }
  return out;
}
let villagerGeo = null;
let _villagerFace = null;
let mobStats = { worldCol: 0, mobCol: 0, playerCol: 0, stuck: 0, falls: 0, frames: 0, invariants: 0 };
let mobInvariantsViolated = 0;
const VILLAGER_PALETTES = [
  { robe: 0x8b5e3c, dark: 0x5a3b26 },
  { robe: 0x824a6e, dark: 0x4e2e42 },
  { robe: 0xf0ece2, dark: 0x9e9e9e },
  { robe: 0x6e4e36, dark: 0x4a3324, apron: 0xd9d9d9 },
  { robe: 0x3d3d3d, dark: 0x252525 },
  { robe: 0x5b7d3a, dark: 0x3b5426 },
];
const villagerMatCache = VILLAGER_PALETTES.map(p => ({
  robe: new THREE.MeshStandardMaterial({ color: p.robe, roughness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: p.dark, roughness: 0.9 }),
  apron: p.apron ? new THREE.MeshStandardMaterial({ color: p.apron, roughness: 0.9 }) : null,
  skin: new THREE.MeshStandardMaterial({ color: 0xc19a78 }),
  nose: new THREE.MeshStandardMaterial({ color: 0xb0805a }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 }),
}));
let villagerHeadMatCache = null;
function villagerFaceTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c19a78"; ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#3e2a1a"; ctx.fillRect(2, 4, 12, 2);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(3, 7, 4, 3); ctx.fillRect(9, 7, 4, 3);
  ctx.fillStyle = "#1a8a1a"; ctx.fillRect(4, 8, 2, 2); ctx.fillRect(10, 8, 2, 2);
  ctx.fillStyle = "#0f2f0f"; ctx.fillRect(5, 9, 1, 1); ctx.fillRect(11, 9, 1, 1);
  ctx.fillStyle = "#a67c52"; ctx.fillRect(7, 10, 2, 3);
  ctx.fillStyle = "#8a5f3d"; ctx.fillRect(7, 13, 2, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function villagerHeadMats(tex) {
  if (!villagerHeadMatCache) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc19a78 });
    const faceMat = new THREE.MeshStandardMaterial({ map: tex });
    villagerHeadMatCache = [skin, skin, skin, skin, faceMat, skin];
  }
  return villagerHeadMatCache;
}
function makeVillagerMesh(isBaby, palIdxOrNull) {
  const g = new THREE.Group();
  const sc = isBaby ? 0.52 : 1;
  if (!_villagerFace) _villagerFace = villagerFaceTex();
  if (!villagerHeadMatCache) villagerHeadMats(_villagerFace);
  const headMats = villagerHeadMatCache;
  const palIdx = (palIdxOrNull != null && palIdxOrNull >= 0 && palIdxOrNull < VILLAGER_PALETTES.length)
    ? palIdxOrNull : Math.floor(Math.random() * VILLAGER_PALETTES.length);
  const pal = VILLAGER_PALETTES[palIdx];
  const cache = villagerMatCache[palIdx];
  const robeMat = cache.robe;
  const robeDarkMat = cache.dark;
  const noseMat = cache.nose;
  const shoeMat = cache.shoe;
  const skinMat = cache.skin;
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  else if (villagerGeo.attributes.position.getY(0) > -0.4) {
    villagerGeo.dispose();
    villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  }
  const body = new THREE.Mesh(villagerGeo, robeMat);
  body.scale.set(0.64 * sc, 1.12 * sc, 0.38 * sc);
  body.position.set(0, 0.74 * sc, 0);
  g.add(body);
  if (pal.apron != null) {
    const apron = new THREE.Mesh(villagerGeo, cache.apron);
    apron.scale.set(0.40 * sc, 0.62 * sc, 0.02 * sc);
    apron.position.set(0, 0.68 * sc, 0.20 * sc);
    g.add(apron);
  }
  const collar = new THREE.Mesh(villagerGeo, robeDarkMat);
  collar.scale.set(0.36 * sc, 0.10 * sc, 0.02 * sc);
  collar.position.set(0, 1.32 * sc, 0.20 * sc);
  g.add(collar);
  const neck = new THREE.Mesh(villagerGeo, skinMat);
  neck.scale.set(0.24 * sc, 0.12 * sc, 0.24 * sc);
  neck.position.set(0, 1.40 * sc, 0);
  g.add(neck);
  const head = new THREE.Mesh(villagerGeo, headMats);
  head.scale.set(0.66 * sc, 0.62 * sc, 0.66 * sc);
  head.position.set(0, 1.79 * sc, 0);
  g.add(head);
  const nose = new THREE.Mesh(villagerGeo, noseMat);
  nose.scale.set(0.20 * sc, 0.22 * sc, 0.32 * sc);
  nose.position.set(0, 1.70 * sc, 0.49 * sc);
  g.add(nose);
  const armGeo = villagerGeo;
  const armGroup = new THREE.Group();
  const armL = new THREE.Mesh(armGeo, robeDarkMat);
  armL.scale.set(0.14 * sc, 0.42 * sc, 0.14 * sc);
  armL.position.set(-0.31 * sc, 0, 0);
  armGroup.add(armL);
  const armR = new THREE.Mesh(armGeo, robeDarkMat);
  armR.scale.set(0.14 * sc, 0.42 * sc, 0.14 * sc);
  armR.position.set(0.31 * sc, 0, 0);
  armGroup.add(armR);
  const armBottom = new THREE.Mesh(armGeo, robeDarkMat);
  armBottom.scale.set(0.76 * sc, 0.13 * sc, 0.14 * sc);
  armBottom.position.set(0, -0.21 * sc, 0);
  armGroup.add(armBottom);
  armGroup.position.set(0, 1.12 * sc, 0.18 * sc);
  armGroup.rotation.x = -0.47;
  g.add(armGroup);
  const legL = new THREE.Mesh(armGeo, shoeMat);
  legL.scale.set(0.22 * sc, 0.16 * sc, 0.24 * sc);
  legL.position.set(-0.15 * sc, 0.08 * sc, 0);
  g.add(legL);
  const legR = new THREE.Mesh(armGeo, shoeMat);
  legR.scale.set(0.22 * sc, 0.16 * sc, 0.24 * sc);
  legR.position.set(0.15 * sc, 0.08 * sc, 0);
  g.add(legR);
  g.userData = { isBaby, sc, legL, legR, armL, armR, armGroup, body, head, neck, nose, palette: pal, palIdx };
  return g;
}
// — Pigs and cows — same physics as villagers, boxy mesh —
const pigMat = new THREE.MeshStandardMaterial({ color: 0xf2aeb2, roughness: 0.9 });
const pigDarkMat = new THREE.MeshStandardMaterial({ color: 0x8f5a5e, roughness: 0.9 });
const pigNoseMat = new THREE.MeshStandardMaterial({ color: 0xd98286, roughness: 0.9 });
const cowMat = new THREE.MeshStandardMaterial({ color: 0xf5f0eb, roughness: 0.9 });
const cowSpotMat = new THREE.MeshStandardMaterial({ color: 0x3b342f, roughness: 0.9 });
const cowDarkMat = new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9 });
const cowPinkMat = new THREE.MeshStandardMaterial({ color: 0xde9aa0, roughness: 0.9 });
function makePigMesh() {
  const g = new THREE.Group();
  const sc = 1;
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const body = new THREE.Mesh(geo, pigMat);
  body.scale.set(0.86 * sc, 0.62 * sc, 1.16 * sc);
  body.position.set(0, 0.60 * sc, 0);
  g.add(body);
  const head = new THREE.Mesh(geo, pigMat);
  head.scale.set(0.52 * sc, 0.52 * sc, 0.46 * sc);
  head.position.set(0, 0.76 * sc, 0.68 * sc);
  g.add(head);
  const snout = new THREE.Mesh(geo, pigNoseMat);
  snout.scale.set(0.30 * sc, 0.20 * sc, 0.14 * sc);
  snout.position.set(0, 0.68 * sc, 0.94 * sc);
  g.add(snout);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const eyeL = new THREE.Mesh(geo, eyeMat);
  eyeL.scale.set(0.08 * sc, 0.08 * sc, 0.02 * sc);
  eyeL.position.set(-0.16 * sc, 0.86 * sc, 0.92 * sc);
  g.add(eyeL);
  const eyeR = new THREE.Mesh(geo, eyeMat);
  eyeR.scale.set(0.08 * sc, 0.08 * sc, 0.02 * sc);
  eyeR.position.set(0.16 * sc, 0.86 * sc, 0.92 * sc);
  g.add(eyeR);
  const legGeo = geo;
  const legBL = new THREE.Mesh(legGeo, pigDarkMat);
  legBL.scale.set(0.22 * sc, 0.34 * sc, 0.22 * sc);
  legBL.position.set(-0.30 * sc, 0.17 * sc, -0.38 * sc);
  g.add(legBL);
  const legBR = new THREE.Mesh(legGeo, pigDarkMat);
  legBR.scale.set(0.22 * sc, 0.34 * sc, 0.22 * sc);
  legBR.position.set(0.30 * sc, 0.17 * sc, -0.38 * sc);
  g.add(legBR);
  const legFL = new THREE.Mesh(legGeo, pigDarkMat);
  legFL.scale.set(0.22 * sc, 0.34 * sc, 0.22 * sc);
  legFL.position.set(-0.30 * sc, 0.17 * sc, 0.38 * sc);
  g.add(legFL);
  const legFR = new THREE.Mesh(legGeo, pigDarkMat);
  legFR.scale.set(0.22 * sc, 0.34 * sc, 0.22 * sc);
  legFR.position.set(0.30 * sc, 0.17 * sc, 0.38 * sc);
  g.add(legFR);
  g.userData = { sc, legBL, legBR, legFL, legFR, body, head, kind: "pig" };
  return g;
}
function makeCowMesh() {
  const g = new THREE.Group();
  const sc = 1;
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const body = new THREE.Mesh(geo, cowMat);
  body.scale.set(0.90 * sc, 0.72 * sc, 1.26 * sc);
  body.position.set(0, 0.78 * sc, 0);
  g.add(body);
  // spots
  const spot1 = new THREE.Mesh(geo, cowSpotMat);
  spot1.scale.set(0.28 * sc, 0.02 * sc, 0.32 * sc);
  spot1.position.set(0.12 * sc, 1.15 * sc, -0.18 * sc);
  g.add(spot1);
  const spot2 = new THREE.Mesh(geo, cowSpotMat);
  spot2.scale.set(0.22 * sc, 0.02 * sc, 0.26 * sc);
  spot2.position.set(-0.18 * sc, 1.15 * sc, 0.24 * sc);
  g.add(spot2);
  const head = new THREE.Mesh(geo, cowMat);
  head.scale.set(0.56 * sc, 0.56 * sc, 0.48 * sc);
  head.position.set(0, 0.96 * sc, 0.74 * sc);
  g.add(head);
  const snout = new THREE.Mesh(geo, cowPinkMat);
  snout.scale.set(0.32 * sc, 0.18 * sc, 0.14 * sc);
  snout.position.set(0, 0.84 * sc, 1.00 * sc);
  g.add(snout);
  const nostMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const nostL = new THREE.Mesh(geo, nostMat);
  nostL.scale.set(0.06 * sc, 0.06 * sc, 0.02 * sc);
  nostL.position.set(-0.08 * sc, 0.84 * sc, 1.08 * sc);
  g.add(nostL);
  const nostR = new THREE.Mesh(geo, nostMat);
  nostR.scale.set(0.06 * sc, 0.06 * sc, 0.02 * sc);
  nostR.position.set(0.08 * sc, 0.84 * sc, 1.08 * sc);
  g.add(nostR);
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c6 });
  const hornL = new THREE.Mesh(geo, hornMat);
  hornL.scale.set(0.08 * sc, 0.14 * sc, 0.08 * sc);
  hornL.position.set(-0.28 * sc, 1.18 * sc, 0.68 * sc);
  g.add(hornL);
  const hornR = new THREE.Mesh(geo, hornMat);
  hornR.scale.set(0.08 * sc, 0.14 * sc, 0.08 * sc);
  hornR.position.set(0.28 * sc, 1.18 * sc, 0.68 * sc);
  g.add(hornR);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const eyeL = new THREE.Mesh(geo, eyeMat);
  eyeL.scale.set(0.08 * sc, 0.08 * sc, 0.02 * sc);
  eyeL.position.set(-0.18 * sc, 1.04 * sc, 0.99 * sc);
  g.add(eyeL);
  const eyeR = new THREE.Mesh(geo, eyeMat);
  eyeR.scale.set(0.08 * sc, 0.08 * sc, 0.02 * sc);
  eyeR.position.set(0.18 * sc, 1.04 * sc, 0.99 * sc);
  g.add(eyeR);
  const legBL = new THREE.Mesh(geo, cowDarkMat);
  legBL.scale.set(0.24 * sc, 0.46 * sc, 0.24 * sc);
  legBL.position.set(-0.32 * sc, 0.23 * sc, -0.42 * sc);
  g.add(legBL);
  const legBR = new THREE.Mesh(geo, cowDarkMat);
  legBR.scale.set(0.24 * sc, 0.46 * sc, 0.24 * sc);
  legBR.position.set(0.32 * sc, 0.23 * sc, -0.42 * sc);
  g.add(legBR);
  const legFL = new THREE.Mesh(geo, cowDarkMat);
  legFL.scale.set(0.24 * sc, 0.46 * sc, 0.24 * sc);
  legFL.position.set(-0.32 * sc, 0.23 * sc, 0.42 * sc);
  g.add(legFL);
  const legFR = new THREE.Mesh(geo, cowDarkMat);
  legFR.scale.set(0.24 * sc, 0.46 * sc, 0.24 * sc);
  legFR.position.set(0.32 * sc, 0.23 * sc, 0.42 * sc);
  g.add(legFR);
  g.userData = { sc, legBL, legBR, legFL, legFR, body, head, kind: "cow" };
  return g;
}
const golemIronMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.85 });
const golemIronDarkMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc1, roughness: 0.9 });
const golemBrowMat = new THREE.MeshStandardMaterial({ color: 0x6e6a63, roughness: 0.9 });
const golemNoseMat = new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 });
const golemMossMat = new THREE.MeshStandardMaterial({ color: 0x5d8a3c, roughness: 0.95 });
const golemMossLightMat = new THREE.MeshStandardMaterial({ color: 0x8aa83e, roughness: 0.95 });
const golemEyeMat = new THREE.MeshBasicMaterial({ color: 0x8b0000 });
function makeIronGolemMesh() {
  const g = new THREE.Group();
  const sc = 1;
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const legL = new THREE.Mesh(geo, golemIronDarkMat);
  legL.scale.set(0.44 * sc, 1.0 * sc, 0.52 * sc);
  legL.position.set(-0.30 * sc, 0.5 * sc, 0);
  g.add(legL);
  const legR = new THREE.Mesh(geo, golemIronDarkMat);
  legR.scale.set(0.44 * sc, 1.0 * sc, 0.52 * sc);
  legR.position.set(0.30 * sc, 0.5 * sc, 0);
  g.add(legR);
  const body = new THREE.Mesh(geo, golemIronMat);
  body.scale.set(1.5 * sc, 1.5 * sc, 0.95 * sc);
  body.position.set(0, 1.75 * sc, 0);
  g.add(body);
  const moss1 = new THREE.Mesh(geo, golemMossMat);
  moss1.scale.set(0.55 * sc, 0.8 * sc, 0.04 * sc);
  moss1.position.set(-0.3 * sc, 1.7 * sc, 0.49 * sc);
  g.add(moss1);
  const moss2 = new THREE.Mesh(geo, golemMossMat);
  moss2.scale.set(0.4 * sc, 0.5 * sc, 0.04 * sc);
  moss2.position.set(0.38 * sc, 1.35 * sc, 0.49 * sc);
  g.add(moss2);
  const moss3 = new THREE.Mesh(geo, golemMossMat);
  moss3.scale.set(0.04 * sc, 0.9 * sc, 0.5 * sc);
  moss3.position.set(0.76 * sc, 1.8 * sc, 0);
  g.add(moss3);
  const mossDot = new THREE.Mesh(geo, golemMossLightMat);
  mossDot.scale.set(0.2 * sc, 0.2 * sc, 0.04 * sc);
  mossDot.position.set(-0.05 * sc, 2.15 * sc, 0.49 * sc);
  g.add(mossDot);
  const armL = new THREE.Group();
  armL.position.set(-1.02 * sc, 2.45 * sc, 0);
  const armLMesh = new THREE.Mesh(geo, golemIronMat);
  armLMesh.scale.set(0.5 * sc, 2.1 * sc, 0.5 * sc);
  armLMesh.position.set(0, -1.0 * sc, 0);
  armL.add(armLMesh);
  const armLMoss = new THREE.Mesh(geo, golemMossMat);
  armLMoss.scale.set(0.52 * sc, 0.5 * sc, 0.52 * sc);
  armLMoss.position.set(0, -0.55 * sc, 0);
  armL.add(armLMoss);
  g.add(armL);
  const armR = new THREE.Group();
  armR.position.set(1.02 * sc, 2.45 * sc, 0);
  const armRMesh = new THREE.Mesh(geo, golemIronMat);
  armRMesh.scale.set(0.5 * sc, 2.1 * sc, 0.5 * sc);
  armRMesh.position.set(0, -1.0 * sc, 0);
  armR.add(armRMesh);
  const armRMoss = new THREE.Mesh(geo, golemMossMat);
  armRMoss.scale.set(0.52 * sc, 0.5 * sc, 0.52 * sc);
  armRMoss.position.set(0, -1.3 * sc, 0);
  armR.add(armRMoss);
  g.add(armR);
  const head = new THREE.Mesh(geo, golemIronMat);
  head.scale.set(1.0 * sc, 1.0 * sc, 1.0 * sc);
  head.position.set(0, 3.0 * sc, 0);
  g.add(head);
  const brow = new THREE.Mesh(geo, golemBrowMat);
  brow.scale.set(1.02 * sc, 0.2 * sc, 1.02 * sc);
  brow.position.set(0, 3.18 * sc, 0);
  g.add(brow);
  const nose = new THREE.Mesh(geo, golemNoseMat);
  nose.scale.set(0.24 * sc, 0.5 * sc, 0.2 * sc);
  nose.position.set(0, 2.82 * sc, 0.55 * sc);
  g.add(nose);
  const eyeL = new THREE.Mesh(geo, golemEyeMat);
  eyeL.scale.set(0.14 * sc, 0.18 * sc, 0.04 * sc);
  eyeL.position.set(-0.22 * sc, 3.02 * sc, 0.51 * sc);
  g.add(eyeL);
  const eyeR = new THREE.Mesh(geo, golemEyeMat);
  eyeR.scale.set(0.14 * sc, 0.18 * sc, 0.04 * sc);
  eyeR.position.set(0.22 * sc, 3.02 * sc, 0.51 * sc);
  g.add(eyeR);
  const headMoss = new THREE.Mesh(geo, golemMossMat);
  headMoss.scale.set(0.04 * sc, 0.5 * sc, 0.4 * sc);
  headMoss.position.set(0.51 * sc, 2.9 * sc, 0.1 * sc);
  g.add(headMoss);
  g.userData = { sc, legL, legR, armL, armR, body, head, kind: "iron_golem" };
  return g;
}
function makeWolfMesh(furHex, collarHex) {
  const g = new THREE.Group();
  const sc = 1;
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const hexToRgb = (h) => [(h>>16)&255,(h>>8)&255,h&255];
  const rgbToHex = (r,g,b) => (r<<16)|(g<<8)|b;
  const darken = (h, f) => { const [r,g,b]=hexToRgb(h); return rgbToHex(Math.round(r*f),Math.round(g*f),Math.round(b*f)); };
  const fur = furHex != null ? furHex : 0xc8cdd2;
  const furMat = new THREE.MeshStandardMaterial({ color: fur, roughness: 0.92 });
  const furDarkMat = new THREE.MeshStandardMaterial({ color: darken(fur, 0.72), roughness: 0.92 });
  const furDarkerMat = new THREE.MeshStandardMaterial({ color: darken(fur, 0.58), roughness: 0.92 });
  const snoutMat = new THREE.MeshStandardMaterial({ color: 0xd9c1a5, roughness: 0.9 });
  const snoutDarkMat = new THREE.MeshStandardMaterial({ color: 0xb89f84, roughness: 0.9 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const earCol = fur === 0x1a1a1a ? 0x000000 : fur === 0xffffff ? 0x1a1a1a : 0x1a1a1a;
  const earMat = new THREE.MeshStandardMaterial({ color: earCol, roughness: 0.9 });
  const body = new THREE.Mesh(geo, furMat);
  body.scale.set(0.92 * sc, 0.58 * sc, 1.18 * sc);
  body.position.set(0, 0.62 * sc, 0);
  g.add(body);
  const belly = new THREE.Mesh(geo, furDarkMat);
  belly.scale.set(0.72 * sc, 0.14 * sc, 0.82 * sc);
  belly.position.set(0, 0.34 * sc, 0.05 * sc);
  g.add(belly);
  const head = new THREE.Mesh(geo, furMat);
  head.scale.set(0.54 * sc, 0.52 * sc, 0.56 * sc);
  head.position.set(0, 0.82 * sc, 0.74 * sc);
  g.add(head);
  const snout = new THREE.Mesh(geo, snoutMat);
  snout.scale.set(0.34 * sc, 0.24 * sc, 0.44 * sc);
  snout.position.set(0, 0.74 * sc, 1.08 * sc);
  g.add(snout);
  const snoutTip = new THREE.Mesh(geo, snoutDarkMat);
  snoutTip.scale.set(0.22 * sc, 0.10 * sc, 0.06 * sc);
  snoutTip.position.set(0, 0.68 * sc, 1.30 * sc);
  g.add(snoutTip);
  const nose = new THREE.Mesh(geo, noseMat);
  nose.scale.set(0.14 * sc, 0.10 * sc, 0.08 * sc);
  nose.position.set(0, 0.78 * sc, 1.30 * sc);
  g.add(nose);
  const eyeCol = fur === 0xffffff ? 0x222222 : 0x111111;
  const eyeMat = new THREE.MeshStandardMaterial({ color: eyeCol });
  const eyeL = new THREE.Mesh(geo, eyeMat);
  eyeL.scale.set(0.08 * sc, 0.08 * sc, 0.02 * sc);
  eyeL.position.set(-0.16 * sc, 0.92 * sc, 1.02 * sc);
  g.add(eyeL);
  const eyeR = new THREE.Mesh(geo, eyeMat);
  eyeR.scale.set(0.08 * sc, 0.08 * sc, 0.02 * sc);
  eyeR.position.set(0.16 * sc, 0.92 * sc, 1.02 * sc);
  g.add(eyeR);
  const earL = new THREE.Mesh(geo, earMat);
  earL.scale.set(0.16 * sc, 0.20 * sc, 0.12 * sc);
  earL.position.set(-0.18 * sc, 1.14 * sc, 0.72 * sc);
  g.add(earL);
  const earR = new THREE.Mesh(geo, earMat);
  earR.scale.set(0.16 * sc, 0.20 * sc, 0.12 * sc);
  earR.position.set(0.18 * sc, 1.14 * sc, 0.72 * sc);
  g.add(earR);
  const tail = new THREE.Mesh(geo, furDarkerMat);
  tail.scale.set(0.20 * sc, 0.20 * sc, 0.42 * sc);
  tail.position.set(0, 0.60 * sc, -0.72 * sc);
  tail.rotation.x = 0.35;
  g.add(tail);
  const legBL = new THREE.Mesh(geo, furMat);
  legBL.scale.set(0.18 * sc, 0.38 * sc, 0.18 * sc);
  legBL.position.set(-0.28 * sc, 0.19 * sc, -0.40 * sc);
  g.add(legBL);
  const legBR = new THREE.Mesh(geo, furMat);
  legBR.scale.set(0.18 * sc, 0.38 * sc, 0.18 * sc);
  legBR.position.set(0.28 * sc, 0.19 * sc, -0.40 * sc);
  g.add(legBR);
  const legFL = new THREE.Mesh(geo, furMat);
  legFL.scale.set(0.18 * sc, 0.38 * sc, 0.18 * sc);
  legFL.position.set(-0.28 * sc, 0.19 * sc, 0.40 * sc);
  g.add(legFL);
  const legFR = new THREE.Mesh(geo, furMat);
  legFR.scale.set(0.18 * sc, 0.38 * sc, 0.18 * sc);
  legFR.position.set(0.28 * sc, 0.19 * sc, 0.40 * sc);
  g.add(legFR);
  const collar = collarHex != null ? collarHex : WOLF_COLLAR_COLORS[Math.floor(Math.random() * WOLF_COLLAR_COLORS.length)];
  const collarMat = new THREE.MeshStandardMaterial({ color: collar, roughness: 0.75 });
  const colW = 0.62 * sc, colH = 0.38 * sc, colT = 0.08 * sc, colY = 0.69 * sc, colZ = 0.64 * sc;
  if (WOLF_SHOW_COLLAR) {
  const cBot = new THREE.Mesh(geo, collarMat);
  cBot.scale.set(colW, colT, colT);
  cBot.position.set(0, colY - colH / 2 + colT / 2, colZ);
  g.add(cBot);
  const sideH = colH - colT;
  const sideY = colY + colT / 2;
  const cLeft = new THREE.Mesh(geo, collarMat);
  cLeft.scale.set(colT, sideH, colT);
  cLeft.position.set(-colW / 2 + colT / 2, sideY, colZ);
  g.add(cLeft);
  const cRight = new THREE.Mesh(geo, collarMat);
  cRight.scale.set(colT, sideH, colT);
  cRight.position.set(colW / 2 - colT / 2, sideY, colZ);
  g.add(cRight);
  }
  g.userData = { sc, legBL, legBR, legFL, legFR, body, head, tail, furHex: fur, collarHex: collar, kind: "wolf" };
  return g;
}
function pickCatRobe() {
  let total = 0;
  for (const w of CAT_ROBE_WEIGHTS) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < CAT_ROBES.length; i++) {
    r -= CAT_ROBE_WEIGHTS[i];
    if (r < 0) return i;
  }
  return 0;
}
function makeCatMesh(variant = 0) {
  if (variant == null || variant < 0 || variant >= CAT_ROBES.length) variant = 0;
  const g = new THREE.Group();
  const sc = 1;
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const hexToRgb = (h) => [(h>>16)&255,(h>>8)&255,h&255];
  const rgbToHex = (r,gg,b) => (r<<16)|(gg<<8)|b;
  const shade = (h, f) => { const [r,gg,b]=hexToRgb(h); return rgbToHex(Math.round(Math.min(255,r*f)),Math.round(Math.min(255,gg*f)),Math.round(Math.min(255,b*f))); };
  const fur = CAT_ROBES[variant];
  const furMat = new THREE.MeshStandardMaterial({ color: fur, roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: shade(fur, 0.62), roughness: 0.9 });
  const lightMat = new THREE.MeshStandardMaterial({ color: variant === 2 ? shade(fur, 0.82) : 0xf5f0e6, roughness: 0.9 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xd98a94, roughness: 0.9 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const body = new THREE.Mesh(geo, furMat);
  body.scale.set(0.30 * sc, 0.28 * sc, 0.55 * sc);
  body.position.set(0, 0.42 * sc, 0);
  g.add(body);
  const belly = new THREE.Mesh(geo, lightMat);
  belly.scale.set(0.22 * sc, 0.10 * sc, 0.40 * sc);
  belly.position.set(0, 0.30 * sc, 0.02 * sc);
  g.add(belly);
  for (let i = 0; i < 3; i++) {
    const stripe = new THREE.Mesh(geo, darkMat);
    stripe.scale.set(0.32 * sc, 0.06 * sc, 0.07 * sc);
    stripe.position.set(0, 0.55 * sc, (-0.15 + i * 0.15) * sc);
    g.add(stripe);
  }
  const head = new THREE.Mesh(geo, furMat);
  head.scale.set(0.30 * sc, 0.28 * sc, 0.28 * sc);
  head.position.set(0, 0.68 * sc, 0.36 * sc);
  g.add(head);
  const muzzle = new THREE.Mesh(geo, lightMat);
  muzzle.scale.set(0.16 * sc, 0.10 * sc, 0.10 * sc);
  muzzle.position.set(0, 0.63 * sc, 0.52 * sc);
  g.add(muzzle);
  const nose = new THREE.Mesh(geo, noseMat);
  nose.scale.set(0.06 * sc, 0.05 * sc, 0.04 * sc);
  nose.position.set(0, 0.67 * sc, 0.57 * sc);
  g.add(nose);
  for (const sx of [1, -1]) {
    const eye = new THREE.Mesh(geo, eyeMat);
    eye.scale.set(0.06 * sc, 0.07 * sc, 0.02 * sc);
    eye.position.set(sx * 0.09 * sc, 0.72 * sc, 0.50 * sc);
    g.add(eye);
    const ear = new THREE.Mesh(geo, furMat);
    ear.scale.set(0.10 * sc, 0.12 * sc, 0.05 * sc);
    ear.position.set(sx * 0.10 * sc, 0.86 * sc, 0.32 * sc);
    g.add(ear);
  }
  const tail = new THREE.Mesh(geo, furMat);
  tail.scale.set(0.08 * sc, 0.45 * sc, 0.08 * sc);
  tail.position.set(0, 0.74 * sc, -0.30 * sc);
  tail.rotation.x = -0.15;
  g.add(tail);
  const tailTip = new THREE.Mesh(geo, lightMat);
  tailTip.scale.set(0.085 * sc, 0.10 * sc, 0.085 * sc);
  tailTip.position.set(0, 0.94 * sc, -0.335 * sc);
  tailTip.rotation.x = -0.15;
  g.add(tailTip);
  const legBL = new THREE.Mesh(geo, furMat);
  legBL.scale.set(0.11 * sc, 0.30 * sc, 0.11 * sc);
  legBL.position.set(-0.10 * sc, 0.15 * sc, -0.18 * sc);
  g.add(legBL);
  const legBR = new THREE.Mesh(geo, furMat);
  legBR.scale.set(0.11 * sc, 0.30 * sc, 0.11 * sc);
  legBR.position.set(0.10 * sc, 0.15 * sc, -0.18 * sc);
  g.add(legBR);
  const legFL = new THREE.Mesh(geo, furMat);
  legFL.scale.set(0.11 * sc, 0.30 * sc, 0.11 * sc);
  legFL.position.set(-0.10 * sc, 0.15 * sc, 0.18 * sc);
  g.add(legFL);
  const legFR = new THREE.Mesh(geo, furMat);
  legFR.scale.set(0.11 * sc, 0.30 * sc, 0.11 * sc);
  legFR.position.set(0.10 * sc, 0.15 * sc, 0.18 * sc);
  g.add(legFR);
  g.userData = { sc, legBL, legBR, legFL, legFR, body, head, tail, catVar: variant, kind: "cat" };
  return g;
}
const birdBodyMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9 });
const birdDarkMat = new THREE.MeshStandardMaterial({ color: 0x6b7076, roughness: 0.9 });
const birdHeadMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.9 });
const birdBeakMat = new THREE.MeshStandardMaterial({ color: 0xe8930c, roughness: 0.9 });
const birdEyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
function makeBirdMesh() {
  const g = new THREE.Group();
  g.rotation.order = "YXZ";
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const body = new THREE.Mesh(geo, birdBodyMat);
  body.scale.set(0.34, 0.30, 0.52);
  body.position.set(0, 0.28, 0);
  g.add(body);
  const head = new THREE.Mesh(geo, birdHeadMat);
  head.scale.set(0.24, 0.24, 0.24);
  head.position.set(0, 0.48, 0.30);
  g.add(head);
  const beak = new THREE.Mesh(geo, birdBeakMat);
  beak.scale.set(0.10, 0.08, 0.12);
  beak.position.set(0, 0.46, 0.46);
  g.add(beak);
  for (const sx of [1, -1]) {
    const eye = new THREE.Mesh(geo, birdEyeMat);
    eye.scale.set(0.05, 0.05, 0.02);
    eye.position.set(sx * 0.10, 0.52, 0.42);
    g.add(eye);
  }
  const tail = new THREE.Mesh(geo, birdDarkMat);
  tail.scale.set(0.22, 0.08, 0.30);
  tail.position.set(0, 0.28, -0.38);
  g.add(tail);
  const wingL = new THREE.Group();
  wingL.position.set(-0.18, 0.34, 0);
  g.add(wingL);
  const wingLM = new THREE.Mesh(geo, birdDarkMat);
  wingLM.scale.set(0.44, 0.06, 0.30);
  wingLM.position.set(-0.22, 0, 0);
  wingL.add(wingLM);
  const wingR = new THREE.Group();
  wingR.position.set(0.18, 0.34, 0);
  g.add(wingR);
  const wingRM = new THREE.Mesh(geo, birdDarkMat);
  wingRM.scale.set(0.44, 0.06, 0.30);
  wingRM.position.set(0.22, 0, 0);
  wingR.add(wingRM);
  g.userData = { wingL, wingR, body, head, kind: "pigeon" };
  return g;
}
const parrotMatCache = new Map();
function parrotMat(hex) {
  let m = parrotMatCache.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 });
    parrotMatCache.set(hex, m);
  }
  return m;
}
function makeParrotMesh(variant = 0) {
  if (variant == null || variant < 0 || variant >= PARROT_VARIANT_COUNT) variant = 0;
  const pal = parrotPaletteFor(variant);
  const g = new THREE.Group();
  g.rotation.order = "YXZ";
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const body = new THREE.Mesh(geo, parrotMat(pal.body));
  body.scale.set(0.34, 0.30, 0.52);
  body.position.set(0, 0.28, 0);
  g.add(body);
  const chest = new THREE.Mesh(geo, parrotMat(pal.chest));
  chest.scale.set(0.26, 0.20, 0.06);
  chest.position.set(0, 0.24, 0.26);
  g.add(chest);
  const head = new THREE.Mesh(geo, parrotMat(pal.head));
  head.scale.set(0.24, 0.24, 0.24);
  head.position.set(0, 0.48, 0.30);
  g.add(head);
  const crest1 = new THREE.Mesh(geo, parrotMat(pal.crest));
  crest1.scale.set(0.10, 0.16, 0.08);
  crest1.position.set(0, 0.66, 0.22);
  g.add(crest1);
  const crest2 = new THREE.Mesh(geo, parrotMat(pal.crest));
  crest2.scale.set(0.08, 0.14, 0.06);
  crest2.position.set(0, 0.76, 0.14);
  g.add(crest2);
  const beakUp = new THREE.Mesh(geo, parrotMat(PARROT_BEAK_UPPER));
  beakUp.scale.set(0.12, 0.08, 0.12);
  beakUp.position.set(0, 0.48, 0.46);
  g.add(beakUp);
  const beakLo = new THREE.Mesh(geo, parrotMat(PARROT_BEAK_LOWER));
  beakLo.scale.set(0.08, 0.05, 0.08);
  beakLo.position.set(0, 0.42, 0.44);
  g.add(beakLo);
  for (const sx of [1, -1]) {
    const eye = new THREE.Mesh(geo, birdEyeMat);
    eye.scale.set(0.05, 0.05, 0.02);
    eye.position.set(sx * 0.10, 0.52, 0.42);
    g.add(eye);
    const foot = new THREE.Mesh(geo, parrotMat(PARROT_FEET));
    foot.scale.set(0.08, 0.06, 0.14);
    foot.position.set(sx * 0.08, 0.03, 0.05);
    g.add(foot);
  }
  const tail = new THREE.Mesh(geo, parrotMat(pal.tail));
  tail.scale.set(0.22, 0.08, 0.42);
  tail.position.set(0, 0.26, -0.44);
  g.add(tail);
  const wingL = new THREE.Group();
  wingL.position.set(-0.18, 0.34, 0);
  g.add(wingL);
  const wingLM = new THREE.Mesh(geo, parrotMat(pal.wing));
  wingLM.scale.set(0.26, 0.06, 0.30);
  wingLM.position.set(-0.13, 0, 0);
  wingL.add(wingLM);
  const wingLT = new THREE.Mesh(geo, parrotMat(pal.wingTip));
  wingLT.scale.set(0.20, 0.06, 0.28);
  wingLT.position.set(-0.36, 0, 0);
  wingL.add(wingLT);
  const wingR = new THREE.Group();
  wingR.position.set(0.18, 0.34, 0);
  g.add(wingR);
  const wingRM = new THREE.Mesh(geo, parrotMat(pal.wing));
  wingRM.scale.set(0.26, 0.06, 0.30);
  wingRM.position.set(0.13, 0, 0);
  wingR.add(wingRM);
  const wingRT = new THREE.Mesh(geo, parrotMat(pal.wingTip));
  wingRT.scale.set(0.20, 0.06, 0.28);
  wingRT.position.set(0.36, 0, 0);
  wingR.add(wingRT);
  g.userData = { wingL, wingR, body, head, kind: "parrot", parrotVar: variant };
  return g;
}
function moonZoneGeo(x, y, z) {
  if (y > MOON_Y) return true;
  const hd = Math.hypot(x, z);
  const dy = MOON_Y - y;
  return Math.sqrt(hd * hd + dy * dy) <= MOON_R - 2.5;
}
function inMoonZone(x, y, z) {
  if (dim !== "over") return false;
  return moonZoneGeo(x, y, z);
}
function flyingMobOnMoon(m) {
  return !!m && isFlyingKind(m.kind) && inMoonZone(m.pos.x, m.pos.y, m.pos.z);
}
function birdOnMoon(m) {
  return flyingMobOnMoon(m);
}
function birdMoonY(from) {
  return Math.max(MOON_BOTTOM, Math.min(MAX_Y - 1, from.y + (Math.random() - 0.5) * 12));
}
function birdMoonTarget(from, minDist = 10, maxDist = 40) {
  for (let t = 0; t < 12; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * (maxDist - minDist);
    const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.x + Math.cos(a) * d));
    const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.z + Math.cos(a + 1.7) * d));
    const y = birdMoonY(from);
    if (Math.hypot(x - from.x, z - from.z) < 8) continue;
    if (!inMoonZone(x, y, z)) continue;
    if (!birdProbeFree(x, y, z)) continue;
    if (!birdSegmentFree(from.x, from.y, from.z, x, y, z)) continue;
    return new THREE.Vector3(x, y, z);
  }
  return null;
}
function birdRandomTarget(from, minDist = 40, maxDist = 90) {
  const moon = dim === "over" && inMoonZone(from.x, from.y, from.z);
  if (moon) {
    const t = birdMoonTarget(from, Math.min(minDist, 10), Math.min(Math.max(maxDist, 20), 40));
    if (t) return t;
    return new THREE.Vector3(from.x, from.y, from.z);
  }
  if (dim === "end") {
    for (let t = 0; t < 12; t++) {
      const a = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 24;
      let x = endSquareCoord(from.x + Math.cos(a) * d), z = endSquareCoord(from.z + Math.sin(a) * d);
      const y = DRAGON_MIN_Y + Math.random() * (DRAGON_MAX_Y - DRAGON_MIN_Y);
      if (Math.hypot(x - from.x, z - from.z) < 4) continue;
      return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(from.x * 0.5, (DRAGON_MIN_Y + DRAGON_MAX_Y) / 2, from.z * 0.5);
  }
  for (let t = 0; t < 12; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * (maxDist - minDist);
    const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.x + Math.cos(a) * d));
    const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.z + Math.cos(a + 1.7) * d));
    const y = birdDimOf() === "nether"
      ? birdNetherLegY(from.y, maxDist > 30)
      : birdBandMin() + 5 + Math.random() * (birdBandMax() - birdBandMin() - 10);
    if (Math.hypot(x - from.x, z - from.z) < 12) continue;
    return new THREE.Vector3(x, y, z);
  }
  return new THREE.Vector3(
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.x + (Math.random() - 0.5) * 80)),
    birdDimOf() === "nether"
      ? birdNetherLegY(from.y, maxDist > 30)
      : birdBandMin() + 5 + Math.random() * (birdBandMax() - birdBandMin() - 10),
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.z + (Math.random() - 0.5) * 80)));
}
function birdReachableTarget(m, minDist = 40, maxDist = 90) {
  let best = null, bestScore = -Infinity;
  const moon = birdOnMoon(m);
  const inEnd = endMobInEnd(m);
  for (let t = 0; t < 12; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = moon ? 10 + Math.random() * 30 : inEnd ? 8 + Math.random() * 24 : minDist + Math.random() * (maxDist - minDist);
    let x = m.pos.x + Math.cos(a) * d;
    let z = m.pos.z + Math.sin(a + 1.7) * d;
    if (!moon && !inEnd) {
      x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, x));
      z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, z));
    }
    if (inEnd) {
      x = endSquareCoord(x); z = endSquareCoord(z);
    }
    const y = moon
      ? Math.max(MOON_BOTTOM, Math.min(MAX_Y - 1, m.pos.y + (Math.random() - 0.5) * 12))
      : inEnd
      ? DRAGON_MIN_Y + Math.random() * (DRAGON_MAX_Y - DRAGON_MIN_Y)
      : birdDimOf(m) === "nether"
      ? birdNetherLegY(m.pos.y, maxDist > 30)
      : Math.max(1.5, Math.min(MAX_Y - 1, birdBandMin(m) + 5 + Math.random() * (birdBandMax(m) - birdBandMin(m) - 10)));
    if (moon && !inMoonZone(x, y, z)) continue;
    if (!birdProbeFree(x, y, z)) continue;
    if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, x, y, z)) continue;
    const dx = x - m.pos.x, dy = y - m.pos.y, dz = z - m.pos.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const clear = birdClearance(m.pos.x, m.pos.y, m.pos.z, dx / dl, dy / dl, dz / dl);
    const score = dl + clear * 8;
    if (score > bestScore) { bestScore = score; best = new THREE.Vector3(x, y, z); }
  }
  if (!best) {
    const y0 = m.yaw || 0;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI]) {
      const yaw = y0 + off;
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      const d = 10 + Math.random() * 30;
      let x = m.pos.x + dx * d;
      let z = m.pos.z + dz * d;
      if (!inEnd) {
        x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, x));
        z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, z));
      } else {
        x = endSquareCoord(x); z = endSquareCoord(z);
      }
      const y = inEnd
        ? Math.max(DRAGON_MIN_Y, Math.min(DRAGON_MAX_Y, m.pos.y + (Math.random() - 0.5) * 6))
        : Math.max(1.5, Math.min(MAX_Y - 1, m.pos.y + (Math.random() - 0.5) * 6));
      if (moon && !inMoonZone(x, y, z)) continue;
      if (!birdProbeFree(x, y, z)) continue;
      if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, x, y, z)) continue;
      const dl = Math.hypot(x - m.pos.x, y - m.pos.y, z - m.pos.z) || 1;
      const clear = birdClearance(m.pos.x, m.pos.y, m.pos.z, (x - m.pos.x) / dl, (y - m.pos.y) / dl, (z - m.pos.z) / dl);
      const score = dl + clear * 8;
      if (score > bestScore) { bestScore = score; best = new THREE.Vector3(x, y, z); }
    }
  }
  if (!best && moon) return new THREE.Vector3(m.pos.x, m.pos.y, m.pos.z);
  return best;
}
function birdNewArc(m) {
  const moonCy = birdOnMoon(m);
  const inEnd = endMobInEnd(m);
  const side = Math.random() < 0.5 ? 1 : -1;
  const r = moonCy ? 4 + Math.random() * 6 : inEnd ? 4 + Math.random() * 8 : 6 + Math.random() * 14;
  const v = m.vel.length() || BIRD_SPEED;
  const fwd = v > 0.01 ? m.vel.clone().normalize() : new THREE.Vector3(Math.cos(m.yaw), 0, Math.sin(m.yaw));
  let cx = m.pos.x - fwd.z * side * r + (Math.random() - 0.5) * 8;
  let cz = m.pos.z + fwd.x * side * r + (Math.random() - 0.5) * 8;
  const cy = moonCy
    ? Math.max(MOON_BOTTOM, Math.min(MAX_Y - 1, m.pos.y + (Math.random() - 0.5) * 12))
    : inEnd
    ? Math.max(DRAGON_MIN_Y, Math.min(DRAGON_MAX_Y, m.pos.y + (Math.random() - 0.5) * 12))
    : birdDimOf(m) === "nether"
    ? Math.max(birdBandMin(m) + 3, Math.min(birdBandMax(m) - 3, m.pos.y + (Math.random() - 0.5) * 60))
    : Math.max(birdBandMin(m) + 3, Math.min(birdBandMax(m) - 3, m.pos.y + (Math.random() - 0.5) * 12));
  if (inEnd) {
    cx = endSquareCoord(cx); cz = endSquareCoord(cz);
  } else {
    cx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cx));
    cz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cz));
  }
  m.arc = {
    cx,
    cz,
    cy, r, side,
    swept: 0,
    total: 1.5 + Math.random() * 3.0,
  };
  m.mode = "arc";
}
function rollBirdKind() {
  return Math.random() < PARROT_FRACTION ? "parrot" : "pigeon";
}
function makeBirdMeshFor(kind, parrotVar = 0) {
  if (kind === "parrot") return makeParrotMesh(parrotVar);
  return makeBirdMesh();
}
function spawnSingleBird(outOfView = false, sx = null, sy = null, sz = null, kind = null, parrotVar = null) {
  if (!isBirdKind(kind)) kind = rollBirdKind();
  if (kind === "parrot" && (parrotVar == null || parrotVar < 0 || parrotVar >= PARROT_VARIANT_COUNT)) parrotVar = pickParrotVariant();
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  let px, py, pz;
  if (sx != null && sy != null && sz != null) {
    px = sx; py = sy; pz = sz;
  } else if (outOfView) {
    const spot = birdSpotOutOfView();
    px = spot.x; py = spot.y; pz = spot.z;
  } else {
    px = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    pz = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    py = birdBandMin() + 5 + Math.random() * (birdBandMax() - birdBandMin() - 10);
  }
  py = dim === "end"
    ? Math.max(DRAGON_MIN_Y, Math.min(DRAGON_MAX_Y, py))
    : Math.max(birdBandMin() + 1, Math.min(birdBandMax() - 1, py));
  if (dim === "end") {
    px = endSquareCoord(px); pz = endSquareCoord(pz);
  }
  if (aabbCollidesWorld(px, py, pz, BIRD_COL_HW, BIRD_COL_H)) {
    for (let t = 0; t < 10 && aabbCollidesWorld(px, py, pz, BIRD_COL_HW, BIRD_COL_H); t++) {
      if (dim === "end") {
        px = (Math.random() * 2 - 1) * (END_PLATFORM_R - 2);
        pz = (Math.random() * 2 - 1) * (END_PLATFORM_R - 2);
        py = DRAGON_MIN_Y + Math.random() * (DRAGON_MAX_Y - DRAGON_MIN_Y);
      } else {
        px = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
        pz = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
        py = birdBandMin() + 5 + Math.random() * (birdBandMax() - birdBandMin() - 10);
      }
    }
    if (aabbCollidesWorld(px, py, pz, BIRD_COL_HW, BIRD_COL_H)) return null;
  }
  if (dim === "nether") {
    for (let t = 0; t < 12 && birdLavaAt(px, py, pz, null); t++) {
      px = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
      pz = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
      py = birdBandMin() + 1 + Math.random() * (birdBandMax() - birdBandMin() - 2);
    }
    if (birdLavaAt(px, py, pz, null)) return null;
  }
  const mesh = makeBirdMeshFor(kind, parrotVar);
  mesh.position.set(px, py, pz);
  const yaw = Math.random() * Math.PI * 2;
  mesh.rotation.y = yaw;
  scene.add(mesh);
  const m = {
    id: gid++, kind, canStep: false, homeId: -1, isBaby: false, parentId: -1, dim,
    pos: new THREE.Vector3(px, py, pz),
    vel: new THREE.Vector3(Math.cos(yaw) * BIRD_SPEED, 0, Math.sin(yaw) * BIRD_SPEED),
    hw: 0.25, h: 0.5, mesh, onGround: false,
    target: null, arc: null, mode: "straight", wanderT: 0,
    perchSpot: null, perchGroup: null, perchT: 0, perchWander: null, perchWanderT: 0, perchTimeout: 0, perchRetry: 0,
    legPhase: Math.random() * Math.PI * 2, speed: BIRD_SPEED,
    blockedT: 0, yaw, yawTarget: yaw, villageBound: false,
    _stuckT: 0, _prevX: px, _prevZ: pz,
    path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
  };
  if (kind === "parrot") m.parrotVar = parrotVar;
  m.target = birdRandomTarget(m.pos);
  stampSpawn(m);
  mobs.push(m);
  mobById.set(m.id, m);
  return m;
}
function spawnBirds() {
  const cur = mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && isBirdKind(m.kind)).length;
  for (let i = cur; i < BIRD_COUNT; i++) spawnSingleBird(false);
}
function removeBirds() {
  const keepCarry = carryMob && mobs.includes(carryMob) ? carryMob : null;
  const survivors = [];
  for (const m of mobs) {
    if (!isBirdKind(m.kind)) { survivors.push(m); continue; }
    if (m === keepCarry) { survivors.push(m); continue; }
    if (m.mesh) scene.remove(m.mesh);
    mobById.delete(m.id);
  }
  mobs.length = 0;
  for (const s of survivors) mobs.push(s);
  birdLock = null;
  birdLockT = 0;
  birdLockShots = 0;
  pruneChains();
}
const CHAIN_SPAWN_KINDS = ["villager", "pig", "cow", "wolf", "cat"];
function spawnChainMob(kind, sx, sy, sz) {
  let mesh, hw, hh, canStep = false, speed = WALK / 2, extra = null;
  if (kind === "pig") { mesh = makePigMesh(); hw = 0.32; hh = 0.92; speed = WALK / 2.2; }
  else if (kind === "cow") { mesh = makeCowMesh(); hw = 0.32; hh = 1.30; speed = WALK / 2.2; }
  else if (kind === "wolf") {
    mesh = makeWolfMesh(WOLF_FUR, WOLF_COLLAR_COLORS[Math.floor(Math.random() * WOLF_COLLAR_COLORS.length)]);
    hw = 0.30; hh = 0.90; canStep = true;
    extra = { fur: WOLF_FUR, collar: mesh.userData.collarHex, wolfStepUp: false, wolfStepUpClearY: 0, wolfInWater: false, wasOnGroundWolf: false };
  }
  else if (isBirdKind(kind)) {
    mesh = makeBirdMeshFor(kind, pickParrotVariant()); hw = 0.25; hh = 0.5; speed = BIRD_SPEED;
    extra = {
      arc: null, targetMode: null, perchSpot: null, perchGroup: null, perchT: 0,
      perchWander: null, perchWanderT: 0, perchTimeout: 0, perchRetry: 0,
    };
    if (kind === "parrot") extra.parrotVar = mesh.userData.parrotVar;
  }
  else { mesh = makeVillagerMesh(false); hw = 0.27; hh = 1.82; }
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  const yaw = Math.random() * Math.PI * 2;
  mesh.position.set(sx, sy, sz);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  const m = {
    id: gid++, kind, canStep, homeId: -1, isBaby: false, parentId: -1, dim,
    pos: new THREE.Vector3(sx, sy, sz),
    vel: new THREE.Vector3(0, 0, 0),
    hw, h: hh, mesh, onGround: false,
    target: null, mode: "wander", wanderT: 3 + Math.random() * 4, insideT: 0,
    legPhase: Math.random() * Math.PI * 2, speed,
    blockedT: 0, yaw, yawTarget: yaw, villageBound: false, penBound: false,
    _stuckT: 0, _prevX: sx, _prevZ: sz,
    path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
    ...(extra || {}),
  };
  if (kind === "villager") m.palIdx = mesh.userData.palIdx != null ? mesh.userData.palIdx : 0;
  stampSpawn(m);
  mobs.push(m);
  mobById.set(m.id, m);
  return m;
}
function spawnBirdChain() {
  if (dim !== "over" && dim !== "end" && dim !== "nether") { showMsg("Bird chains can't take off here"); return false; }
  const total = 3 + Math.floor(Math.random() * 6);
  const kinds = [];
  for (let i = 1; i < total; i++) kinds.push(CHAIN_SPAWN_KINDS[Math.floor(Math.random() * CHAIN_SPAWN_KINDS.length)]);
  const sizes = { villager: [0.27, 1.82], pig: [0.32, 0.92], cow: [0.32, 1.30], wolf: [0.30, 0.90], cat: [CAT_HW, CAT_HH], pigeon: [0.25, 0.5], parrot: [0.25, 0.5] };
  const aimDir = new THREE.Vector3();
  camera.getWorldDirection(aimDir);
  const aimHit = pickBlock(camera.position, aimDir, true);
  const aimX = aimHit ? aimHit.x + aimHit.face[0] + 0.5 : null;
  const aimZ = aimHit ? aimHit.z + aimHit.face[2] + 0.5 : null;
  for (let attempt = 0; attempt < 12; attempt++) {
    let ax, az, dx, dz;
    if (aimX !== null && attempt < 8) {
      const jx = attempt === 0 ? 0 : (Math.random() - 0.5) * 4;
      const jz = attempt === 0 ? 0 : (Math.random() - 0.5) * 4;
      ax = aimX + jx; az = aimZ + jz;
      const rx = ax - pos.x, rz = az - pos.z;
      const rl = Math.hypot(rx, rz);
      if (rl > 0.5) { dx = rx / rl; dz = rz / rl; }
      else { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dz = Math.sin(ang); }
      if (attempt > 0) { const tw = (Math.random() - 0.5) * 1.2; const cx = Math.cos(tw), sx = Math.sin(tw); const ndx = dx * cx - dz * sx; dz = dx * sx + dz * cx; dx = ndx; }
    } else {
      const ang = Math.random() * Math.PI * 2;
      dx = Math.cos(ang); dz = Math.sin(ang);
      ax = pos.x + dx * 5; az = pos.z + dz * 5;
    }
    const spots = [];
    let clear = true;
    const leadKind = rollBirdKind();
    const allKinds = [leadKind, ...kinds];
    for (let i = 0; i < total; i++) {
      const px = ax - dx * 2.6 * i, pz = az - dz * 2.6 * i;
      if (Math.abs(px) > WORLD_RADIUS - 2 || Math.abs(pz) > WORLD_RADIUS - 2) { clear = false; break; }
      const [hw, hh] = sizes[allKinds[i]];
      if (isInsidePenPool(px, pz) || isInsidePool(px, pz)) { clear = false; break; }
      const gy = groundYDown(px, pz, (aimHit ? aimHit.y : pos.y) + 2, hw);
      if (gy == null || gy < 1) { clear = false; break; }
      if (aabbCollidesWorld(px, gy, pz, hw, hh) || !hasMobGround(px, pz, hw, gy)) { clear = false; break; }
      if (mobs.some((o) => (o.pos.x - px) ** 2 + (o.pos.z - pz) ** 2 < 1.44 && Math.abs(o.pos.y - gy) < 2.5)) { clear = false; break; }
      spots.push([px, gy, pz]);
    }
    if (!clear) continue;
    const lead = spawnChainMob(leadKind, spots[0][0], spots[0][1], spots[0][2]);
    lead.vel.set(0, 0, 0);
    lead.mode = "sit";
    lead.target = null;
    lead.targetMode = null;
    lead.arc = null;
    const spawned = [lead];
    let front = lead, ok = true;
    for (let i = 1; i < total; i++) {
      const m = spawnChainMob(kinds[i - 1], spots[i][0], spots[i][1], spots[i][2]);
      spawned.push(m);
      if (!linkChain(front, m)) { ok = false; break; }
      front = m;
    }
    if (!ok) {
      for (const m of spawned) {
        dropChainFrom(m);
        if (m.mesh) scene.remove(m.mesh);
        mobById.delete(m.id);
        const ix = mobs.indexOf(m);
        if (ix >= 0) mobs.splice(ix, 1);
      }
      showMsg("No room for a bird chain here");
      return false;
    }
    showMsg("Bird chain assembled — takeoff!");
    setTimeout(() => {
      if (mobs.includes(lead) && chainChild.has(lead.id)) birdTakeoff(lead);
    }, 2000);
    queueSave();
    return true;
  }
  showMsg("No room for a bird chain here");
  return false;
}
function birdSpotOutOfView() {
  if (dim === "nether") {
    const lo = NETHER_BIRD_MIN_Y, hi = netherBirdCeiling();
    for (let t = 0; t < 24; t++) {
      const x = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
      const z = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
      const y = lo + 5 + Math.random() * (hi - lo - 10);
      if (aabbCollidesWorld(x, y, z, BIRD_COL_HW, BIRD_COL_H)) continue;
      return { x, y, z };
    }
    return { x: 0, y: (lo + hi) / 2, z: 0 };
  }
  if (dim === "end") {
    for (let t = 0; t < 24; t++) {
      const x = (Math.random() * 2 - 1) * (END_PLATFORM_R - 2), z = (Math.random() * 2 - 1) * (END_PLATFORM_R - 2);
      const y = DRAGON_MIN_Y + Math.random() * (DRAGON_MAX_Y - DRAGON_MIN_Y);
      if (aabbCollidesWorld(x, y, z, BIRD_COL_HW, BIRD_COL_H)) continue;
      return { x, y, z };
    }
    return { x: 0, y: (DRAGON_MIN_Y + DRAGON_MAX_Y) / 2, z: 0 };
  }
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  let best = null, bestScore = -Infinity;
  for (let t = 0; t < 24; t++) {
    const x = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    const z = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    const y = BIRD_MIN_Y + 5 + Math.random() * (BIRD_MAX_Y - BIRD_MIN_Y - 10);
    if (aabbCollidesWorld(x, y, z, BIRD_COL_HW, BIRD_COL_H)) continue;
    const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const dot = (dx / d) * fwd.x + (dy / d) * fwd.y + (dz / d) * fwd.z;
    const score = d - dot * 200;
    if (d > 130 && dot < 0.5 && score > bestScore) { bestScore = score; best = { x, y, z }; }
  }
  if (best) return best;
  const a = Math.random() * Math.PI * 2;
  return {
    x: Math.max(-WORLD_RADIUS + 4, Math.min(WORLD_RADIUS - 4, camera.position.x - fwd.x * 150 + Math.cos(a) * 30)),
    y: BIRD_MIN_Y + 10 + Math.random() * (BIRD_MAX_Y - BIRD_MIN_Y - 20),
    z: Math.max(-WORLD_RADIUS + 4, Math.min(WORLD_RADIUS - 4, camera.position.z - fwd.z * 150 + Math.sin(a) * 30)),
  };
}
function killBird(m) {
  const i = mobs.indexOf(m);
  if (i < 0) return;
  if (m === carryMob) return;
  if (birdLock === m) birdLock = null;
  if (m.mesh) scene.remove(m.mesh);
  mobById.delete(m.id);
  mobs.splice(i, 1);
  spawnSingleBird(true, null, null, null, m.kind, m.parrotVar);
}
function chainRespawnFree(x, y, z, hw, h, selfId) {
  if (aabbCollidesWorld(x, y, z, hw, h)) return false;
  for (const o of mobs) {
    if (o.id === selfId) continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    if (Math.abs(y - o.pos.y) > 1.2) continue;
    const dx = x - o.pos.x, dz = z - o.pos.z;
    const need = hw + (o.hw || 0.27) + 0.1;
    if (dx * dx + dz * dz < need * need) return false;
  }
  return true;
}
function killChainMob(m) {
  const i = mobs.indexOf(m);
  if (i < 0) return;
  if (m === carryMob || m === carryGrappleMob) return;
  const snap = {
    hw: m.hw, h: m.h,
    ox: m.spawnX !== undefined ? m.spawnX : m.pos.x,
    oy: m.spawnY !== undefined ? m.spawnY : m.pos.y,
    oz: m.spawnZ !== undefined ? m.spawnZ : m.pos.z,
    dim: m.dim,
    kind: m.kind,
    parrotVar: m.parrotVar,
  };
  const carrierId = chainParent.get(m.id);
  const childId = chainChild.get(m.id);
  const front = carrierId === PLAYER_CHAIN_ID ? playerChainAvatar : mobById.get(carrierId);
  const back = childId !== undefined ? mobById.get(childId) : null;
  const backLive = !!(back && mobs.includes(back) && back !== m && !isMobHeld(back));
  const frontLive = carrierId === PLAYER_CHAIN_ID ? playerInChain() : !!(front && mobs.includes(front));
  if (carrierId !== undefined) {
    if (carrierId === PLAYER_CHAIN_ID) chainChild.delete(PLAYER_CHAIN_ID);
    else if (front && chainChild.get(carrierId) === m.id) chainChild.delete(carrierId);
    chainParent.delete(m.id);
  }
  chainChild.delete(m.id);
  const self = chainLinks.get(m.id);
  if (self) {
    scene.remove(self.rope);
    scene.remove(self.head);
    if (self.rope.dispose) self.rope.dispose();
    chainLinks.delete(m.id);
  }
  if (back && mobs.includes(back) && back !== m) {
    if (isMobHeld(back)) {
      const bl = chainLinks.get(back.id);
      if (bl) {
        scene.remove(bl.rope);
        scene.remove(bl.head);
        if (bl.rope.dispose) bl.rope.dispose();
        chainLinks.delete(back.id);
      }
      chainParent.delete(back.id);
    } else {
      freeChainRoot(back);
    }
  }
  if (birdLock === m) birdLock = null;
  if (grappleMob === m) detachDisplacementGrapple();
  if (m.mesh) scene.remove(m.mesh);
  if (m.fallMesh) scene.remove(m.fallMesh);
  mobById.delete(m.id);
  mobs.splice(i, 1);
  const ei = endermen.indexOf(m);
  if (ei >= 0) endermen.splice(ei, 1);
  respawnChainMob(snap);
}
function unchainMob(m, fizzleKey) {
  if (!mobs.includes(m)) return;
  if (m === carryMob || m === carryGrappleMob) return;
  if (m.kind === "dragon") return;
  severChainMob(m);
  resumeChainedMob(m);
  if (m.isBaby) rebindBabyBounds(m); else m.villageBound = false;
  m.penBound = false;
  if (birdLock === m) birdLock = null;
  if (grappleMob === m) detachDisplacementGrapple();
  for (const [k, t] of [...tntLit]) {
    if (k === fizzleKey || t.bird !== m || !t.mesh) continue;
    clearTNTVisual(t);
    tntLit.delete(k);
    explodeBird(t.px, t.py, t.pz, false);
  }
  tntSyncClear(m);
}
function severGroundedChainVictim(m, fizzleKey) {
  if (!mobs.includes(m)) return;
  if (m === carryMob || m === carryGrappleMob) return;
  if (m.kind === "dragon") return;
  severChainMob(m);
  resumeChainedMob(m);
  if (m.isBaby) rebindBabyBounds(m); else m.villageBound = false;
  m.penBound = false;
  if (birdLock === m) birdLock = null;
  if (grappleMob === m) detachDisplacementGrapple();
  for (const [k, t] of [...tntLit]) {
    if (k === fizzleKey || t.bird !== m || !t.mesh) continue;
    clearTNTVisual(t);
    tntLit.delete(k);
    explodeBird(t.px, t.py, t.pz, false);
  }
  tntSyncClear(m);
}
function respawnChainMob(snap) {
  const hw = snap.hw || 0.27, h = snap.h || 1.82;
  const rdim = snap.dim || "over";
  let px = snap.ox, py = snap.oy, pz = snap.oz;
  let placed = false;
  {
    py = Math.max(birdBandMinFor(rdim) + 1, Math.min(birdBandMaxFor(rdim) - 1, py));
    if (birdProbeFree(px, py, pz)) placed = true;
    if (!placed) {
      for (let r = 1; r <= 4 && !placed; r++) {
        for (let dx = -r; dx <= r && !placed; dx++) for (let dz = -r; dz <= r && !placed; dz++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          for (const dy of [0, 3, -3, 6, -6]) {
            const tx = px + dx * 2, ty = py + dy, tz = pz + dz * 2;
            if (ty < birdBandMinFor(rdim) + 1 || ty > birdBandMaxFor(rdim) - 1) continue;
            if (birdProbeFree(tx, ty, tz) && chainRespawnFree(tx, ty, tz, hw, h, -1)) {
              px = tx; py = ty; pz = tz; placed = true; break;
            }
          }
        }
      }
    }
    if (!placed) {
      const spot = birdSpotOutOfView();
      px = spot.x; py = spot.y; pz = spot.z;
    }
  }
  let gid = mobs.length ? Math.max(...mobs.map((o) => o.id)) + 1 : 0;
  const yaw = Math.random() * Math.PI * 2;
  let mesh, m;
  {
    const rkind = isBirdKind(snap.kind) ? snap.kind : "pigeon";
    const rvar = rkind === "parrot" ? snap.parrotVar : null;
    mesh = makeBirdMeshFor(rkind, rvar);
    mesh.position.set(px, py, pz);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    m = {
      id: gid++, kind: rkind, canStep: false, homeId: -1, isBaby: false, parentId: -1, dim: rdim,
      pos: new THREE.Vector3(px, py, pz),
      vel: new THREE.Vector3(Math.cos(yaw) * BIRD_SPEED, 0, Math.sin(yaw) * BIRD_SPEED),
      hw, h, mesh, onGround: false,
      target: null, arc: null, mode: "straight", wanderT: 0,
      perchSpot: null, perchGroup: null, perchT: 0, perchWander: null, perchWanderT: 0, perchTimeout: 0, perchRetry: 0,
      legPhase: Math.random() * Math.PI * 2, speed: BIRD_SPEED,
      blockedT: 0, yaw, yawTarget: yaw, villageBound: false,
      _stuckT: 0, _prevX: px, _prevZ: pz,
      path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
    };
    if (rkind === "parrot") m.parrotVar = mesh.userData.parrotVar;
    m.target = birdRandomTarget(m.pos);
  }
  m.spawnX = snap.ox;
  m.spawnY = snap.oy;
  m.spawnZ = snap.oz;
  mobs.push(m);
  mobById.set(m.id, m);
  return m;
}
function birdProbeFree(x, y, z, m) {
  if (x < -WORLD_RADIUS + 1 || x > WORLD_RADIUS - 1 || z < -WORLD_RADIUS + 1 || z > WORLD_RADIUS - 1) return false;
  if (y < 1 || y > MAX_Y - 1) return false;
  if (aabbCollidesWorld(x, y, z, birdColHW(m), birdColH(m))) return false;
  if (dim === "nether" && birdLavaAt(x, y, z, m)) return false;
  return true;
}
function birdClearance(px, py, pz, dx, dy, dz) {
  if (birdSegmentFree(px, py, pz, px + dx * 6, py + dy * 6, pz + dz * 6)) return 6;
  if (birdSegmentFree(px, py, pz, px + dx * 3, py + dy * 3, pz + dz * 3)) return 3;
  return 0;
}
function birdBestSteer(m, baseYaw, dyHint) {
  const yaws = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
  const verts = [dyHint * 0.5, 0.25, -0.25, 0];
  let best = null;
  for (const off of yaws) {
    for (const vy2 of verts) {
      const nx = Math.sin(baseYaw + off), nz = Math.cos(baseYaw + off);
      const nl = Math.hypot(nx, vy2, nz) || 1;
      const sx = nx / nl, sy = vy2 / nl, sz = nz / nl;
      const clear = birdClearance(m.pos.x, m.pos.y, m.pos.z, sx, sy, sz);
      const turn = Math.abs(off) + Math.abs(vy2 - dyHint) * 0.5;
      if (!best || clear > best.clear || (clear === best.clear && turn < best.turn)) {
        best = { x: sx, y: sy, z: sz, clear, turn };
        if (clear === 6 && turn === 0) return best;
      }
    }
  }
  return best;
}
function birdMillHop(m) {
  const axes = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (let i = axes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = axes[i]; axes[i] = axes[j]; axes[j] = t;
  }
  for (const [ax, ay, az] of axes) {
    for (const d of [1.5, 3]) {
      const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.x + ax * d));
      const y = Math.max(1.5, Math.min(MAX_Y - 1, m.pos.y + ay * d));
      const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.z + az * d));
      if (!birdProbeFree(x, y, z, m)) continue;
      if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, x, y, z, m)) continue;
      return new THREE.Vector3(x, y, z);
    }
  }
  for (let t = 0; t < 10; t++) {
    const dx = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
    const dy = (Math.random() - 0.35) * 2;
    const raw = Math.hypot(dx, dy, dz);
    if (raw < 0.3) continue;
    const d = 1 + Math.random() * 2.5;
    const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.x + dx / raw * d));
    const y = Math.max(1.5, Math.min(MAX_Y - 1, m.pos.y + dy / raw * d));
    const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.z + dz / raw * d));
    if (!birdProbeFree(x, y, z, m)) continue;
    if (!birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, x, y, z, m)) continue;
    return new THREE.Vector3(x, y, z);
  }
  return null;
}
function birdDigSteer(m, dig) {
  const dx = dig.x - m.pos.x, dy = dig.y - m.pos.y, dz = dig.z - m.pos.z;
  const levelStep = () => {
    const hx = dig.x - m.pos.x, hz = dig.z - m.pos.z;
    const hl = Math.hypot(hx, hz);
    if (hl < 0.01) return null;
    const ux = hx / hl, uz = hz / hl;
    if (birdProbeFree(m.pos.x + ux * 1.2, m.pos.y, m.pos.z + uz * 1.2)) return [ux, 0, uz];
    if (birdProbeFree(m.pos.x + ux * 1.2, m.pos.y, m.pos.z)) return [ux, 0, 0];
    if (birdProbeFree(m.pos.x, m.pos.y, m.pos.z + uz * 1.2)) return [0, 0, uz];
    return null;
  };
  if (Math.abs(dy) > 0.6
    && birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.pos.x, dig.y, m.pos.z)
    && birdSegmentFree(m.pos.x, dig.y, m.pos.z, dig.x, dig.y, dig.z)) {
    if (birdProbeFree(m.pos.x, m.pos.y + Math.sign(dy) * 1.2, m.pos.z)) return [0, Math.sign(dy), 0];
    return levelStep() || [0, 0, 0];
  }
  if (birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, dig.x, dig.y, dig.z)) {
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  }
  if (Math.abs(dy) > 0.6 && birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.pos.x, dig.y, m.pos.z)) {
    if (birdProbeFree(m.pos.x, m.pos.y + Math.sign(dy) * 1.2, m.pos.z)) return [0, Math.sign(dy), 0];
  }
  return levelStep() || [0, 0, 0];
}
function birdConfinedSteer(m, dt) {
  m._confinedT = (m._confinedT || 0) + dt;
  const now = performance.now() / 1000;
  let dg = birdDigLive(m, now);
  if (!dg) {
    dg = birdFreshDigFor(m, now, 12);
    if (dg) {
      m._digGoal = dg.id;
      m._digT0 = now;
      m._millTarget = new THREE.Vector3(dg.x, dg.y, dg.z);
      m._millT = 2;
    }
  }
  if (dg) {
    if (now - (m._digT0 || 0) > 6 || Math.hypot(dg.x - m.pos.x, dg.y - m.pos.y, dg.z - m.pos.z) < 0.6) {
      birdDigGiveUp(m);
      m._millTarget = null;
      dg = null;
    } else {
      const ds = birdDigSteer(m, dg);
      if (Math.hypot(ds[0], ds[1], ds[2]) > 0.01) {
        m._millTarget = new THREE.Vector3(dg.x, dg.y, dg.z);
        m._millT = 2;
        return ds;
      }
      dg = null;
    }
  }
  if (!dg) {
    m._millT = (m._millT || 0) - dt;
    if (!m._millTarget || m._millT <= 0 || Math.hypot(m._millTarget.x - m.pos.x, m._millTarget.y - m.pos.y, m._millTarget.z - m.pos.z) < 0.6) {
      m._millTarget = birdMillHop(m);
      m._millT = 2;
    }
  }
  if (!m._millTarget) return [0, 0.05, 0];
  const mx = m._millTarget.x - m.pos.x, my = m._millTarget.y - m.pos.y, mz = m._millTarget.z - m.pos.z;
  const ml = Math.hypot(mx, my, mz) || 1;
  return [mx / ml, my / ml, mz / ml];
}
function birdMoveSlide(m, vx, vy, vz, dt) {
  let blocked = 0;
  const hw = birdColHW(m), hh = birdColH(m);
  const ox = m.pos.x, oy = m.pos.y, oz = m.pos.z;
  m.pos.x += vx * dt;
  m.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.x));
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, hw, hh)) { m.pos.x = ox; vx = 0; blocked++; }
  m.pos.z += vz * dt;
  m.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.z));
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, hw, hh)) { m.pos.z = oz; vz = 0; blocked++; }
  m.pos.y += vy * dt;
  m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, hw, hh)) { m.pos.y = oy; vy = 0; blocked++; }
  return { vx, vy, vz, blocked };
}
function birdResolvePenetration(m) {
  const hw = birdColHW(m), hh = birdColH(m);
  if (!aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, hw, hh)) return;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]];
  for (let d = 0.15; d <= 2.0; d += 0.15) {
    for (const [dx, dy, dz] of dirs) {
      const nx = m.pos.x + dx * d, ny = m.pos.y + dy * d, nz = m.pos.z + dz * d;
      if (ny < 1 || ny > MAX_Y - 1) continue;
      if (!aabbCollidesWorld(nx, ny, nz, hw, hh)) { m.pos.set(nx, ny, nz); return; }
    }
  }
  for (let y = m.pos.y + 1; y < Math.min(MAX_Y - 1, m.pos.y + 64); y++) {
    if (!aabbCollidesWorld(m.pos.x, y, m.pos.z, hw, hh)) { m.pos.y = y; return; }
  }
}
function birdSameChain(a, b) {
  if (!a || !b || a === b) return false;
  if (!isBirdKind(a.kind) || !isBirdKind(b.kind)) return false;
  if (!isChained(a) && !isChainCarrier(a)) return false;
  if (!isChained(b) && !isChainCarrier(b)) return false;
  const ra = chainRootOf(a), rb = chainRootOf(b);
  return !!ra && ra === rb;
}
function birdSeparate(m, dt, vel, sp) {
  const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 1);
  for (const o of nearby) {
    if (o === m || !isBirdKind(o.kind)) continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    if (birdSameChain(m, o)) continue;
    const ox = m.pos.x - o.pos.x, oy = m.pos.y - o.pos.y, oz = m.pos.z - o.pos.z;
    const d2 = ox * ox + oy * oy + oz * oz;
    if (d2 < BIRD_SEP_DIST * BIRD_SEP_DIST && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (BIRD_SEP_DIST - d) * 6 * dt;
      vel.x += (ox / d) * push * sp * 0.12;
      vel.y += (oy / d) * push * sp * 0.12;
      vel.z += (oz / d) * push * sp * 0.12;
    }
  }
}
function birdAnimate(m, dt, vx, vy, vz, sp, wp) {
  let targetYaw = Math.atan2(vx, vz);
  let targetPitch = Math.max(-0.45, Math.min(0.45, -vy / sp * 0.9));
  if (wp && m._tunnel) {
    const dx = wp.x - m.pos.x, dy = wp.y - m.pos.y, dz = wp.z - m.pos.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz > 0.05) targetYaw = Math.atan2(dx, dz);
    targetPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, -Math.atan2(dy, Math.max(horiz, 0.001))));
  }
  let dyaw = targetYaw - m.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  m.yaw += dyaw * Math.min(1, dt * 3.5);
  m.yawTarget = targetYaw;
  m.mesh.rotation.y = m.yaw;
  if (m._pitch == null) m._pitch = targetPitch;
  m._pitch += (targetPitch - m._pitch) * Math.min(1, dt * 5);
  m.mesh.rotation.x = m._pitch;
  m.mesh.rotation.z = m._tunnel ? 0 : Math.max(-0.5, Math.min(0.5, -dyaw * 1.2));
  // The mesh pivots on its feet, so a vertical pitch swings the body sideways.
  // In a 1-block shaft that reads as off-centre: cancel the swing so the body
  // stays dead-centre (and at its normal height) while climbing/diving.
  if (m._tunnel) {
    const s = m.mesh.scale.x || 1;
    const bodyY = BIRD_BODY_Y * s;
    const sp = Math.sin(m._pitch), cp = Math.cos(m._pitch);
    const sy = Math.sin(m.yaw), cy = Math.cos(m.yaw);
    m.mesh.position.set(
      m.pos.x - bodyY * sp * sy,
      m.pos.y + bodyY * (1 - cp),
      m.pos.z - bodyY * sp * cy);
  } else {
    m.mesh.position.copy(m.pos);
  }
  m.legPhase += dt * 11;
  const f = Math.sin(m.legPhase) * 0.65;
  if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = f;
  if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -f;
}
function birdCoopTarget(h) {
  const y = h.vy + 1.5 + Math.random() * 2;
  if (Math.random() < 0.6) {
    const side = Math.floor(Math.random() * 4);
    const off = 0.2 + Math.random() * 0.8;
    if (side === 0) return new THREE.Vector3(h.minX + off, y, h.minZ + 1 + Math.random() * (h.maxZ - h.minZ - 2));
    if (side === 1) return new THREE.Vector3(h.maxX - off, y, h.minZ + 1 + Math.random() * (h.maxZ - h.minZ - 2));
    if (side === 2) return new THREE.Vector3(h.minX + 1 + Math.random() * (h.maxX - h.minX - 2), y, h.minZ + off);
    return new THREE.Vector3(h.minX + 1 + Math.random() * (h.maxX - h.minX - 2), y, h.maxZ - off);
  }
  return new THREE.Vector3(
    h.minX + 1.5 + Math.random() * (h.maxX - h.minX - 3),
    y,
    h.minZ + 1.5 + Math.random() * (h.maxZ - h.minZ - 3));
}
function updatePerchedBird(m, dt) {
  dt = Math.min(0.05, dt);
  if (grappleMob === m) { birdTakeoff(m); return; }
  if (m.perchSpot && villageSqContains(m.perchSpot.x, m.perchSpot.z) && performance.now() / 1000 < villagePanicUntil) {
    m._panicUntil = Math.max(m._panicUntil || 0, villagePanicUntil);
    birdTakeoff(m); return;
  }
  if (!m.perchSpot || !birdPerchSupports(m.perchSpot.x, m.perchSpot.y, m.perchSpot.z)) { birdTakeoff(m); return; }
  m.perchT -= dt;
  if (m.perchT <= 0) { birdTakeoff(m); return; }
  m.perchWanderT -= dt;
  if (!m.perchWander || m.perchWanderT <= 0) {
    const a = Math.random() * Math.PI * 2, d = 0.3 + Math.random() * 0.4;
    const nx = m.perchSpot.x + Math.cos(a) * d, nz = m.perchSpot.z + Math.sin(a) * d;
    if (birdPerchSupports(nx, m.perchSpot.y, nz) &&
        !birdPerchSpotTaken(nx, m.pos.y, nz, m) &&
        !aabbCollidesWorld(nx, m.pos.y, nz, BIRD_COL_HW, BIRD_COL_H)) {
      m.perchWander = { x: nx, z: nz };
    } else {
      m.perchWander = { x: m.perchSpot.x, z: m.perchSpot.z };
    }
    m.perchWanderT = 0.5 + Math.random() * 1.2;
  }
  let vx = 0, vz = 0;
  const dx = m.perchWander.x - m.pos.x, dz = m.perchWander.z - m.pos.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.05) { const s = Math.min(1.2, dl * 4); vx = dx / dl * s; vz = dz / dl * s; }
  const vel = { x: vx, y: 0, z: vz };
  birdSeparate(m, dt, vel, 1.2);
  vx = vel.x; vz = vel.z;
  const ox = m.pos.x, oz = m.pos.z;
  m.pos.x += vx * dt;
  m.pos.z += vz * dt;
  m.pos.y += (m.perchSpot.y - m.pos.y) * Math.min(1, dt * 8);
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, BIRD_COL_HW, BIRD_COL_H)) { m.pos.x = ox; m.pos.z = oz; vx = 0; vz = 0; }
  m.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.x));
  m.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.z));
  m.vel.set(vx, 0, vz);
  if (dl > 0.1) {
    const ty = Math.atan2(vx, vz);
    let dy = ty - m.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    m.yaw += dy * Math.min(1, dt * 3);
  }
  m.mesh.position.copy(m.pos);
  m.mesh.rotation.y = m.yaw;
  m.mesh.rotation.x = 0;
  m.mesh.rotation.z = 0;
  if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = 0.12;
  if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -0.12;
}
function updateToPerchBird(m, dt) {
  dt = Math.min(0.05, dt);
  const s = m.perchSpot;
  if (grappleMob === m) { birdTakeoff(m); return; }
  if (s && villageSqContains(s.x, s.z) && performance.now() / 1000 < villagePanicUntil) {
    m._panicUntil = Math.max(m._panicUntil || 0, villagePanicUntil);
    birdTakeoff(m); return;
  }
  if (!s || !birdPerchSupports(s.x, s.y, s.z)) { birdTakeoff(m); return; }
  if (birdPerchSpotTaken(s.x, s.y, s.z, m)) { birdTakeoff(m); return; }
  m.perchTimeout -= dt;
  if (m.perchTimeout <= 0) { birdTakeoff(m); return; }
  const dx = s.x - m.pos.x, dy = s.y - m.pos.y, dz = s.z - m.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < BIRD_PERCH_SNAP_D) {
    m.pos.set(s.x, s.y, s.z);
    m.vel.set(0, 0, 0);
    m.mode = "perch";
    m.target = null; m.targetMode = null; m.arc = null;
    m.perchT = birdDimOf(m) === "end"
      ? BIRD_END_PERCH_MIN_T + Math.random() * (BIRD_END_PERCH_MAX_T - BIRD_END_PERCH_MIN_T)
      : BIRD_PERCH_MIN_T + Math.random() * (BIRD_PERCH_MAX_T - BIRD_PERCH_MIN_T);
    m.perchWander = null; m.perchWanderT = 0;
    m.mesh.position.copy(m.pos);
    if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = 0.12;
    if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -0.12;
    return;
  }
  const sp = BIRD_SPEED;
  const spd = dist < 6 ? sp * Math.max(0.06, dist / 6) : sp;
  let sx = dx / dist, sy = dy / dist, sz = dz / dist;
  let pClear = birdClearance(m.pos.x, m.pos.y, m.pos.z, sx, sy, sz);
  const final = dist < BIRD_PERCH_FINAL_D;
  if (!final && pClear === 0) {
    const best = birdBestSteer(m, Math.atan2(sx, sz), sy);
    if (best && best.clear > 0) { sx = best.x; sy = best.y; sz = best.z; pClear = best.clear; }
    else if (dist > 4) { birdTakeoff(m); return; }
  }
  const k = Math.min(1, dt * (dist < 12 ? 3.5 : 2.5));
  const effSpd = pClear === 0 ? spd * 0.5 : spd * (0.5 + 0.5 * Math.min(1, pClear / 6));
  let vx = m.vel.x + (sx * effSpd - m.vel.x) * k;
  let vy = m.vel.y + (sy * effSpd - m.vel.y) * k;
  let vz = m.vel.z + (sz * effSpd - m.vel.z) * k;
  const vel = { x: vx, y: vy, z: vz };
  if (!final) birdSeparate(m, dt, vel, sp);
  vx = vel.x; vy = vel.y; vz = vel.z;
  const slid = birdMoveSlide(m, vx, vy, vz, dt);
  vx = slid.vx; vy = slid.vy; vz = slid.vz;
  if (slid.blocked > 0) {
    m._perchBlockT = (m._perchBlockT || 0) + dt;
    if (m._perchBlockT > (dist > 4 ? 1.2 : 2.5)) { m._perchBlockT = 0; birdTakeoff(m); return; }
  } else {
    m._perchBlockT = 0;
  }
  m.vel.set(vx, vy, vz);
  if (endMobInEnd(m)) {
    endClampXZPos(m.pos);
    m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
  }
  birdAnimate(m, dt, vx, vy, vz, sp);
}
function updateBird(m, dt) {
  dt = Math.min(0.05, dt);
  const nowP = performance.now() / 1000;
  birdTouchVisit(m, nowP);
  const inHouse = dim === "over" && houseInteriorFor(m.pos.x, m.pos.y, m.pos.z);
  m._inHouse = inHouse;
  const confined = inHouse || birdIsConfined(m);
  m._narrow = !!confined;
  birdResolvePenetration(m);
  const targetScale = confined ? BIRD_NARROW_SCALE : 1;
  if (Math.abs(m.mesh.scale.x - targetScale) > 0.001) {
    m.mesh.scale.setScalar(m.mesh.scale.x + (targetScale - m.mesh.scale.x) * Math.min(1, dt / 0.15));
  }
  if ((m._panicT || 0) > 0) {
    m._panicT -= dt;
    if (!m.target || m.targetMode !== "panic" || m._panicT <= 0) {
      m._panicT = 0;
      if (m.targetMode === "panic") { m.target = null; m.targetMode = null; }
    } else {
      let pt = m.target;
      let pd = Math.hypot(pt.x - m.pos.x, pt.y - m.pos.y, pt.z - m.pos.z);
      if (pd < 2 && m._panicT > 0.5) {
        m.target = panicBirdTarget(m, m._panicSrcX != null ? m._panicSrcX : m.pos.x, m._panicSrcZ != null ? m._panicSrcZ : m.pos.z);
        m.targetMode = "panic";
        pt = m.target;
        pd = Math.hypot(pt.x - m.pos.x, pt.y - m.pos.y, pt.z - m.pos.z);
      }
      if (pd < 2) {
        m._panicT = 0;
        m.target = null; m.targetMode = null;
      } else {
      const sp2 = BIRD_SPEED * 2;
      const tl = pd || 1;
      const slid = birdMoveSlide(m, (pt.x - m.pos.x) / tl * sp2, (pt.y - m.pos.y) / tl * sp2, (pt.z - m.pos.z) / tl * sp2, dt);
      m.vel.set(slid.vx, slid.vy, slid.vz);
      if (endMobInEnd(m)) {
        endClampXZPos(m.pos);
        m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
      }
      m.mesh.position.copy(m.pos);
      const hv = Math.hypot(slid.vx, slid.vz);
      if (hv > 0.5) { m.yaw = Math.atan2(slid.vx, slid.vz); m.yawTarget = m.yaw; m.mesh.rotation.y = m.yaw; }
      birdAnimate(m, dt, slid.vx, slid.vy, slid.vz, sp2);
      return;
      }
    }
  }
  if (m.mode === "sit") {
    birdResolvePenetration(m);
    m.vel.set(0, 0, 0);
    m.mesh.position.copy(m.pos);
    m.mesh.rotation.y = m.yaw;
    m.mesh.rotation.x = 0;
    m.mesh.rotation.z = 0;
    if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = 0.12;
    if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -0.12;
    return;
  }
  if (m.mode === "perch" || m.mode === "toPerch") {
    if (birdDimOf(m) === "nether") { birdTakeoff(m); return; }
    if (birdOnMoon(m)) { birdTakeoff(m); }
    else if (m.mode === "perch") { updatePerchedBird(m, dt); return; }
    else { updateToPerchBird(m, dt); return; }
  }
  if (m.mode !== "straight" && m.mode !== "arc") { m.mode = "straight"; m.target = null; m.targetMode = null; m.perchRetry = 0; }
  if (confined) {
    m._tunnel = true; m._tFree = 0;
    updateTunnelBird(m, dt, nowP);
    return;
  }
  if (m._tunnel) {
    m._tFree = (m._tFree || 0) + 1;
    if (m._tFree < 5) { m._narrow = true; updateTunnelBird(m, dt, nowP); return; }
    m._tunnel = false; m._tFree = 0;
    m._narrow = false;
    m._tPath = null; m._tGoal = null; m._tEnterT = 0; m._tSteps = 0; m._tPlanT = 0; m._tStallT = 0; m._tCrawlT = 0;
    m.target = null; m.targetMode = null; m._decideT = 0;
  }
  m._decideT = Math.max(0, (m._decideT || 0) - dt);
  m._noPerchT = Math.max(0, (m._noPerchT || 0) - dt);
  const moon = birdOnMoon(m);
  const inEnd = endMobInEnd(m);
  const loB = birdBandMin(m), hiB = birdBandMax(m);
  const outBand = inEnd
    ? (m.pos.y < DRAGON_MIN_Y || m.pos.y > DRAGON_MAX_Y || endBlockOutsidePlatform(Math.floor(m.pos.x), Math.floor(m.pos.z)))
    : !moon && (m.pos.y < loB || m.pos.y > hiB);
  const sp = BIRD_SPEED;
  let vx = m.vel.x, vy = m.vel.y, vz = m.vel.z;
  const vl = Math.hypot(vx, vy, vz) || 1;
  let dx = vx / vl, dy = vy / vl, dz = vz / vl;
  if (inEnd) {
    if (m.pos.y < DRAGON_MIN_Y + 2) dy += (DRAGON_MIN_Y + 2 - m.pos.y) * 0.08;
    else if (m.pos.y > DRAGON_MAX_Y - 2) dy -= (m.pos.y - (DRAGON_MAX_Y - 2)) * 0.08;
    const er = END_PLATFORM_R - Math.max(Math.abs(m.pos.x), Math.abs(m.pos.z));
    if (er < 4) {
      dx += (0 - m.pos.x) * 0.05;
      dz += (0 - m.pos.z) * 0.05;
      if (m.mode === "arc") { m.arc = null; m.mode = "straight"; }
    }
  } else if (!moon) {
    if (m.pos.y < loB + 5) dy += (loB + 5 - m.pos.y) * 0.08;
    else if (m.pos.y > hiB - 5) dy -= (m.pos.y - (hiB - 5)) * 0.08;
  }
  const edge = WORLD_RADIUS - 6;
  if (m.pos.x < -edge || m.pos.x > edge || m.pos.z < -edge || m.pos.z > edge) {
    // near the world boundary: steer back in, and never circle — the arc tangent
    // ignores this push and used to press the bird against the edge clamp
    dx += (0 - m.pos.x) * 0.05;
    dz += (0 - m.pos.z) * 0.05;
    if (m.mode === "arc") { m.arc = null; m.mode = "straight"; }
  }
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  let steerX = dx, steerY = dy, steerZ = dz;
  let boxed = false;
  let steerClear = birdClearance(m.pos.x, m.pos.y, m.pos.z, dx, dy, dz);
  if (steerClear === 0) {
    const best = birdBestSteer(m, Math.atan2(dx, dz), dy);
    if (best && best.clear > 0) {
      steerX = best.x; steerY = best.y; steerZ = best.z; steerClear = best.clear;
    } else {
      boxed = true;
      [steerX, steerY, steerZ] = birdConfinedSteer(m, dt);
      steerClear = 0;
    }
  } else if (m.mode === "straight") {
    if (outBand && m.targetMode !== "detour" && (m._decideT || 0) <= 0) {
      if (!m.target || !birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.target.x, m.target.y, m.target.z)) {
        m.target = bandReturnTarget(m.pos, m);
        m.targetMode = "return";
      }
      m._decideT = 0.5;
    }
    if (m.targetMode === "detour") {
      m.detourT -= dt;
      if (m.detourT <= 0 || (m.target && Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z) < 2)) {
        m.target = null;
        m.targetMode = null;
      }
    }
    if (m.targetMode === "explore" && m.target && !birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.target.x, m.target.y, m.target.z)) {
      birdNextLeg(m);
    }
    if (m.targetMode === "explore" && m.target && (m._exploreFuse || 0) > 0 && performance.now() / 1000 >= m._exploreFuse) {
      const nowF = performance.now() / 1000;
      const vs = m._visits || (m._visits = new Map());
      const k = birdCellKey(m.target.x, m.target.y, m.target.z);
      if (vs.has(k)) vs.delete(k);
      vs.set(k, nowF);
      m.target = null; m.targetMode = null; m._exploreFuse = 0;
    }
    if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z) < 2.5) {
      if (outBand) { m.target = bandReturnTarget(m.pos, m); m.targetMode = "return"; m.perchRetry = 0; }
      else if (m.perchRetry > 0 && (m._noPerchT || 0) <= 0) {
        m.perchRetry--;
        const found = birdFindPerchSpot(m, BIRD_HOP_R);
        if (found) {
          m.mode = "toPerch";
          m.arc = null;
          m.perchSpot = found.spot;
          m.perchGroup = found.group;
          m.perchTimeout = 30;
          m.target = found.spot;
          m.targetMode = "perch";
        }
        else if (m.perchRetry > 0) m.target = birdRandomTarget(m.pos, 10, 25);
        else birdNextLeg(m);
      }
      else birdNextLeg(m);
    }
    if (m.mode === "straight" && m.target) {
      const tx = m.target.x - m.pos.x, ty = m.target.y - m.pos.y, tz = m.target.z - m.pos.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const gx = tx / tl, gy = ty / tl, gz = tz / tl;
      if (tl < 3 && birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.target.x, m.target.y, m.target.z)) {
        steerX = gx; steerY = gy; steerZ = gz; steerClear = 1;
      } else {
        const gClear = birdClearance(m.pos.x, m.pos.y, m.pos.z, gx, gy, gz);
        if (gClear > 0) {
          steerX = gx; steerY = gy; steerZ = gz; steerClear = gClear;
        } else {
          const best = birdBestSteer(m, Math.atan2(gx, gz), gy);
          if (best && best.clear > 0) {
            steerX = best.x; steerY = best.y; steerZ = best.z; steerClear = best.clear;
          } else {
            boxed = true;
            [steerX, steerY, steerZ] = birdConfinedSteer(m, dt);
            steerClear = 0;
          }
          if ((m._decideT || 0) <= 0) {
            if (m.target && birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.target.x, m.target.y, m.target.z)) m._decideT = 1.2;
            else birdNextLeg(m);
          }
          else if (m.targetMode !== "detour" && birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, m.pos.x + gx * 10, m.pos.y + gy * 10, m.pos.z + gz * 10)) {
            const nowR2 = performance.now() / 1000;
            if (nowR2 >= (m._reachT || 0)) {
              m._reachT = nowR2 + 0.5;
              const r = birdReachableTarget(m, 10, 40);
              if (r) { m.target = r; m.targetMode = null; }
            }
          }
          else { const det = birdDetourTarget(m); if (det) { m.target = det; m.targetMode = "detour"; m.detourT = 2.5; } }
        }
      }
    }
  } else if (m.mode === "arc" && m.arc) {
    const a = m.arc;
    const rx = m.pos.x - a.cx, rz = m.pos.z - a.cz;
    const rl = Math.hypot(rx, rz) || 1;
    const tx = -rz / rl * a.side, tz = rx / rl * a.side;
    const ty = Math.max(-0.3, Math.min(0.3, (a.cy - m.pos.y) * 0.05));
    const tl = Math.hypot(tx, ty, tz) || 1;
    const ax = tx / tl, ay = ty / tl, az = tz / tl;
    if (birdClearance(m.pos.x, m.pos.y, m.pos.z, ax, ay, az) === 0) {
      const best = birdBestSteer(m, Math.atan2(ax, az), ay);
      if (best && best.clear > 0) { steerX = best.x; steerY = best.y; steerZ = best.z; steerClear = best.clear; }
      else {
        boxed = true;
        [steerX, steerY, steerZ] = birdConfinedSteer(m, dt);
        steerClear = 0;
      }
      m.arc = null; m.mode = "straight";
    } else {
      steerX = ax; steerY = ay; steerZ = az; steerClear = 3;
      a.swept += (sp / Math.max(4, a.r)) * dt;
      if (a.swept >= a.total) { m.arc = null; m.mode = "straight"; birdNextLeg(m); }
    }
  }
  if (!boxed && (m._stillT || 0) > 1.5) {
    boxed = true;
    [steerX, steerY, steerZ] = birdConfinedSteer(m, dt);
    steerClear = 0;
  }
  if (!boxed) { m._confinedT = 0; m._millTarget = null; m._millT = 0; }
  const slowF = 0.35 + 0.65 * Math.min(1, steerClear / 6);
  let effSp = boxed ? Math.min(sp * slowF, WALK * 0.5) : sp * slowF;
  if (!boxed && m.targetMode === "explore" && m.target) {
    const ed = Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z);
    effSp = Math.min(effSp, 2 + ed * 4);
  }
  const k = Math.min(1, dt * (steerClear === 0 && !boxed ? 4 : 2.2));
  vx += (steerX * effSp - vx) * k;
  vy += (steerY * effSp - vy) * k;
  vz += (steerZ * effSp - vz) * k;
  const vel = { x: vx, y: vy, z: vz };
  birdSeparate(m, dt, vel, sp);
  vx = vel.x; vy = vel.y; vz = vel.z;
  const raw = Math.hypot(vx, vy, vz);
  const nvl = raw || 1;
  let minSp = effSp * 0.6;
  if (raw > 0.001 && birdClearance(m.pos.x, m.pos.y, m.pos.z, vx / nvl, vy / nvl, vz / nvl) === 0) minSp = 0;
  if (nvl < minSp) {
    const sl = Math.hypot(steerX, steerY, steerZ) || 1;
    vx = (steerX / sl) * minSp; vy = (steerY / sl) * minSp; vz = (steerZ / sl) * minSp;
  } else {
    const cl = Math.min(sp * 1.3, nvl);
    vx = (vx / nvl) * cl; vy = (vy / nvl) * cl; vz = (vz / nvl) * cl;
  }
  const px0 = m.pos.x, py0 = m.pos.y, pz0 = m.pos.z;
  const slid = birdMoveSlide(m, vx, vy, vz, dt);
  vx = slid.vx; vy = slid.vy; vz = slid.vz;
  const movedNow = Math.hypot(m.pos.x - px0, m.pos.y - py0, m.pos.z - pz0);
  m._stillT = movedNow < 0.6 * dt ? (m._stillT || 0) + dt : 0;
  // NEVER stay blocked: hop to the nearest free air cell when wedged against
  // terrain while trying to fly (sealed pockets just keep milling)
  if (movedNow < 0.6 * dt && !boxed) {
    m._freeStallT = (m._freeStallT || 0) + dt;
    if (m._freeStallT > 0.5) {
      m._freeStallT = 0;
      birdUnblock(m);
      m._blockT = 0; m._millTarget = null; m._millT = 0;
      m._digGoal = null;
      birdNextLeg(m);
    }
  } else {
    m._freeStallT = 0;
  }
  const stalled = slid.blocked > 0 && movedNow < 0.6 * dt;
  if (stalled) {
    if (boxed) { m._millTarget = null; m._millT = 0; m._blockT = 0; }
    else {
      m._blockT = (m._blockT || 0) + dt;
      if (m._blockT > 0.6) {
        m._blockT = 0;
        const det = birdDetourTarget(m);
        if (det) { m.target = det; m.targetMode = "detour"; m.detourT = 2.5; }
        else birdNextLeg(m);
        m.arc = null; if (m.mode === "arc") m.mode = "straight";
      }
    }
  } else {
    m._blockT = 0;
  }
  m.vel.set(vx, vy, vz);
  if (inEnd) {
    endClampXZPos(m.pos);
    m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
    if (m.target) {
      m.target.x = endSquareCoord(m.target.x); m.target.z = endSquareCoord(m.target.z);
      m.target.y = Math.max(1, Math.min(MAX_Y - 1, m.target.y));
    }
  }
  birdAnimate(m, dt, vx, vy, vz, sp);
}
function villagerHW(m) {
  if (m.kind === "dragon") return 1.5;
  if (m.kind === "enderman") return 0.31;
  if (isBirdKind(m.kind)) return 0.25;
  if (m.kind === "wolf") return 0.30;
  if (m.kind === "cat") return CAT_HW;
  if (m.kind === "pig" || m.kind === "cow") return 0.32;
  if (m.kind === "iron_golem") return GOLEM_HW;
  return m.isBaby ? 0.16 : 0.27;
}
function villagerH(m) {
  if (m.kind === "dragon") return 3;
  if (m.kind === "enderman") return 2.7;
  if (isBirdKind(m.kind)) return 0.5;
  if (m.kind === "wolf") return 0.90;
  if (m.kind === "cat") return CAT_HH;
  if (m.kind === "pig") return 0.92;
  if (m.kind === "cow") return 1.30;
  if (m.kind === "iron_golem") return GOLEM_HH;
  return m.isBaby ? 0.98 : 1.82;
}
function doorBlocked(h) {
  const y = h.vy;
  return isSolid(h.d0x, y + 1, h.d0z) || isSolid(h.d0x, y + 2, h.d0z) || isSolid(h.d1x, y + 1, h.d1z) || isSolid(h.d1x, y + 2, h.d1z);
}
function isInsideHome(mob) {
  const h = villageHouses[mob.homeId];
  if (!h) return false;
  const x = mob.pos.x, z = mob.pos.z;
  return x > h.minX + 0.2 && x < h.maxX - 0.2 && z > h.minZ + 0.2 && z < h.maxZ - 0.2;
}
function groundYForMob(x, z, hintY, hw) {
  const h = Math.floor(hintY);
  for (let y = h + 4; y >= h - 24; y--) {
    if (y < 0 || y > MAX_Y) continue;
    if (!mobBlockedAt(x, z, hw, y)) return y;
  }
  for (let y = h - 25; y >= 0; y--) {
    if (!mobBlockedAt(x, z, hw, y)) return y;
  }
  return h;
}
function groundYDown(x, z, hintY, hw) {
  for (let y = Math.min(MAX_Y, Math.floor(hintY) + 1); y >= 0; y--) {
    if (!mobBlockedAt(x, z, hw, y)) return y;
  }
  return null;
}
function mobInWater(m) {
  const hw = m.hw, hh = m.h;
  const y0 = Math.floor(m.pos.y + 0.01), y1 = Math.floor(m.pos.y + hh - 0.01);
  for (let y = y0; y <= y1; y++) for (let bx = Math.floor(m.pos.x - hw); bx <= Math.floor(m.pos.x + hw); bx++) for (let bz = Math.floor(m.pos.z - hw); bz <= Math.floor(m.pos.z + hw); bz++) {
    const id = getBlock(bx, y, bz);
    if (id === WATER || id === LAVA || id === MOON_WATER) return true;
  }
  return false;
}
function wolfInWater(m){ return mobInWater(m); }
function waterSurfaceForMob(m) {
  let top = -Infinity;
  const yTop = Math.floor(m.pos.y + m.h);
  for (let bx = Math.floor(m.pos.x - m.hw); bx <= Math.floor(m.pos.x + m.hw); bx++) for (let bz = Math.floor(m.pos.z - m.hw); bz <= Math.floor(m.pos.z + m.hw); bz++) {
    const ct = colTops[dim][colTopIdx(bx, bz)];
    for (let y = Math.min(ct, yTop); y >= 0; y--) {
      const id = getBlock(bx, y, bz);
      if (id === WATER || id === LAVA || id === MOON_WATER) { if (y + 1 > top) top = y + 1; break; }
    }
  }
  return top;
}
const MOB_FLOAT_FRAC = 0.5;
function mobFloatTargetY(surface, h) { return surface - h * MOB_FLOAT_FRAC; }
function mobWaterExitJump(mob, bx, by, bz) {
  if (!mobInWater(mob)) return false;
  const fy = Math.floor(mob.pos.y);
  if (by !== fy && by !== fy + 1) return false;
  if (isSolid(bx, by + 1, bz)) return false;
  if (aabbCollidesWorld(mob.pos.x, by + 1 + 0.001, mob.pos.z, mob.hw, mob.h)) return false;
  mob.vel.y = JUMP_MIN + 2.5;
  mob.onGround = false;
  mob.wolfStepUp = false;
  return true;
}

function setMobTransparent(m, alpha) {
  const trans = alpha < 1;
  const a = alpha;
  if (!m.mesh.userData.matsCloned) {
    m.mesh.userData.matsCloned = true;
    m.mesh.traverse((obj) => {
      if (obj.isMesh && obj.material && !obj.userData.halo) {
        if (Array.isArray(obj.material)) obj.material = obj.material.map((mm) => mm.clone());
        else obj.material = obj.material.clone();
      }
    });
  }
  m.mesh.traverse((obj) => {
    if (obj.isMesh && obj.material && !obj.userData.halo) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        mat.transparent = trans;
        mat.opacity = a;
        mat.depthWrite = !trans;
        mat.needsUpdate = true;
      });
    }
  });
}

function pickMob(dir, maxDist = 1000) {
  const eye = camera.position;
  let best = null, bestT = Infinity;
  for (const m of mobs) {
    if (m.dim !== undefined && m.dim !== dim) continue;
    if (isMobHeld(m)) continue;
    const falling = !m.onGround || (m.vel && Math.abs(m.vel.y) > 1);
    const expand = falling ? 0.45 : 0;
    const minX = m.pos.x - m.hw - expand, maxX = m.pos.x + m.hw + expand;
    const minY = m.pos.y - expand, maxY = m.pos.y + m.h + expand;
    const minZ = m.pos.z - m.hw - expand, maxZ = m.pos.z + m.hw + expand;
    let tmin = -Infinity, tmax = Infinity;
    if (Math.abs(dir.x) < 1e-6) {
      if (eye.x < minX || eye.x > maxX) continue;
    } else {
      const tx1 = (minX - eye.x) / dir.x, tx2 = (maxX - eye.x) / dir.x;
      const t1 = Math.min(tx1, tx2), t2 = Math.max(tx1, tx2);
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dir.y) < 1e-6) {
      if (eye.y < minY || eye.y > maxY) continue;
    } else {
      const ty1 = (minY - eye.y) / dir.y, ty2 = (maxY - eye.y) / dir.y;
      const t1 = Math.min(ty1, ty2), t2 = Math.max(ty1, ty2);
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dir.z) < 1e-6) {
      if (eye.z < minZ || eye.z > maxZ) continue;
    } else {
      const tz1 = (minZ - eye.z) / dir.z, tz2 = (maxZ - eye.z) / dir.z;
      const t1 = Math.min(tz1, tz2), t2 = Math.max(tz1, tz2);
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmax < 0) continue;
    const t = tmin >= 0 ? tmin : tmax;
    if (t < 0 || t > maxDist) continue;
    if (t < bestT) { bestT = t; best = m; }
  }
  return best;
}
function getMobHitOffset(eye, dir, mob) {
  const minX = mob.pos.x - mob.hw, maxX = mob.pos.x + mob.hw;
  const minY = mob.pos.y, maxY = mob.pos.y + mob.h;
  const minZ = mob.pos.z - mob.hw, maxZ = mob.pos.z + mob.hw;
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dir.x) < 1e-6) {
    if (eye.x < minX || eye.x > maxX) return null;
  } else {
    const tx1 = (minX - eye.x) / dir.x, tx2 = (maxX - eye.x) / dir.x;
    const t1 = Math.min(tx1, tx2), t2 = Math.max(tx1, tx2);
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dir.y) < 1e-6) {
    if (eye.y < minY || eye.y > maxY) return null;
  } else {
    const ty1 = (minY - eye.y) / dir.y, ty2 = (maxY - eye.y) / dir.y;
    const t1 = Math.min(ty1, ty2), t2 = Math.max(ty1, ty2);
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dir.z) < 1e-6) {
    if (eye.z < minZ || eye.z > maxZ) return null;
  } else {
    const tz1 = (minZ - eye.z) / dir.z, tz2 = (maxZ - eye.z) / dir.z;
    const t1 = Math.min(tz1, tz2), t2 = Math.max(tz1, tz2);
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin >= 0 ? tmin : tmax;
  if (t < 0) return null;
  const hitX = eye.x + dir.x * t, hitY = eye.y + dir.y * t, hitZ = eye.z + dir.z * t;
  return new THREE.Vector3(hitX - mob.pos.x, hitY - mob.pos.y, hitZ - mob.pos.z);
}

// Carry grapple (red) — from scratch, inspired by normal grapple
let carryGrappleActive = false;
let carryGrappleMode = null;
const carryGrappleStart = new THREE.Vector3();
const carryGrappleTarget = new THREE.Vector3();
let carryGrappleDist = 1;
let carryGrappleMob = null;
let carryGrappleBlock = null;
const carryGrappleHookPos = new THREE.Vector3();
const carryGrappleOffset = new THREE.Vector3();
let carryGrappleRetracting = false;
let carryGrapplePulling = false;
let carryGrappleChainTarget = null;
let mobPortalTx = null;
const MOB_PORTAL_TX_TIME = 0.3;
const MOB_PORTAL_TX_STANDOFF = 2.0;
const MOB_PORTAL_ARRIVAL_R = 5;
const PORTAL_ARRIVAL_FREEZE = 2;
const FILL_SLIDE_TRIGGER_T = 0.2;
const FILL_SLIDE_SPEED = 12;
function isArrivalFrozen(m) {
  if (!m || m._frozenUntil == null) return false;
  if (performance.now() / 1000 >= m._frozenUntil) { delete m._frozenUntil; return false; }
  return true;
}
let chainAttachMode = "behind";
let carryGrappleAttachMode = "behind";
function isMobFrozenByGrapple(m) {
  if (m && m._portalTx) return true;
  if (m !== carryGrappleMob) return false;
  if (carryGrappleMode === "release") return carryGrappleActive || carryGrapplePulling || carryGrappleRetracting;
  if (carryGrappleMode === "attach") return carryGrappleActive || carryGrapplePulling || carryGrappleRetracting;
  return carryGrapplePulling;
}

// Mob chains: bird-rooted linked lists. A carried mob can be attached onto
// a bird (or onto the tail of an existing chain) with ENTER. Each persistent
// link is a regular displacement hook (brown rope, tow-behind spring).
// Session-only: cleared on world rebuild / dimension trips.
const chainChild = new Map();
const chainParent = new Map();
const chainLinks = new Map();
const CHAIN_LINK_CUBES = 128;
const chainLinkGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const chainLinkMat = new THREE.MeshBasicMaterial({ color: 0x8a6d3b });
const chainLinkMatNoFog = new THREE.MeshBasicMaterial({ color: 0x8a6d3b, fog: false });
const chainLinkHeadGeo = new THREE.BoxGeometry(0.17, 0.17, 0.17);
const chainLinkHeadMat = new THREE.MeshBasicMaterial({ color: 0x4a3a1e });
const chainLinkHeadMatNoFog = new THREE.MeshBasicMaterial({ color: 0x4a3a1e, fog: false });
let chainLinkDragonMat = null;
let chainLinkDragonHeadMat = null;
let chainLinkDragonMatNoFog = null;
let chainLinkDragonHeadMatNoFog = null;
// When the eye is inside a liquid the murk fog would wash fogged ropes to the
// fog color (near-invisible in lava), so ropes swap to fog-ignoring variants
// with identical colors. Air keeps the fogged variants for distance fading.
let ropeNoFog = false;
function ensureChainDragonMats() {
  if (!chainLinkDragonMat) {
    chainLinkDragonMat = new THREE.MeshBasicMaterial({ color: DRAGON_FINISH.eye });
    chainLinkDragonHeadMat = new THREE.MeshBasicMaterial({ color: DRAGON_FINISH.eye });
  }
  if (!chainLinkDragonMatNoFog) {
    chainLinkDragonMatNoFog = new THREE.MeshBasicMaterial({ color: DRAGON_FINISH.eye, fog: false });
    chainLinkDragonHeadMatNoFog = new THREE.MeshBasicMaterial({ color: DRAGON_FINISH.eye, fog: false });
  }
}
function syncChainLinkColor(childId) {
  const link = chainLinks.get(childId);
  if (!link) return;
  const child = mobById.get(childId);
  const root = child ? chainRootOf(child) : null;
  if (root && root.kind === "dragon") {
    ensureChainDragonMats();
    link.rope.material = ropeNoFog ? chainLinkDragonMatNoFog : chainLinkDragonMat;
    link.head.material = ropeNoFog ? chainLinkDragonHeadMatNoFog : chainLinkDragonHeadMat;
  } else {
    link.rope.material = ropeNoFog ? chainLinkMatNoFog : chainLinkMat;
    link.head.material = ropeNoFog ? chainLinkHeadMatNoFog : chainLinkHeadMat;
  }
}
function syncChainLinkColors() {
  ensureChainDragonMats();
  if (dragon && dragon.mats && dragon.mats.eye) {
    chainLinkDragonMat.color.copy(dragon.mats.eye.color);
    chainLinkDragonHeadMat.color.copy(dragon.mats.eye.color).multiplyScalar(0.6);
    chainLinkDragonMatNoFog.color.copy(dragon.mats.eye.color);
    chainLinkDragonHeadMatNoFog.color.copy(dragon.mats.eye.color).multiplyScalar(0.6);
  }
  for (const childId of chainLinks.keys()) syncChainLinkColor(childId);
  syncGrappleColor();
}
function syncGrappleColor() {
  const isDragon = !!grappleMob && grappleMob.kind === "dragon";
  if (isDragon) {
    ensureChainDragonMats();
    grappleCubes.material = ropeNoFog ? chainLinkDragonMatNoFog : chainLinkDragonMat;
    grappleHead.material = ropeNoFog ? chainLinkDragonHeadMatNoFog : chainLinkDragonHeadMat;
  } else {
    grappleCubes.material = ropeNoFog ? grappleCubeMatNoFog : grappleCubeMat;
    grappleHead.material = ropeNoFog ? grappleHeadMatNoFog : grappleHeadMat;
  }
}
const chainLinkMatrix = new THREE.Matrix4();
const CHAIN_TAUT_TIME = 0.5;
const CHAIN_SPLIT_DY = 3, CHAIN_SPLIT_STRAIN_T = 1;
const CHAIN_FLY_SPLIT_DY = 8;
const CHAIN_CONVERGE_SPEED = 4.0;
const CHAIN_TOW_KP = 5.0;
const CHAIN_FLY_SNAP_MAX = 2.2, CHAIN_FLY_LEASH = 2.5, CHAIN_FLY_LEASH_T = 1.0;
const CHAIN_PLAYER_SNAP_T = 2.0;
const PLAYER_CHAIN_ID = "player";
const playerChainAvatar = {
  id: PLAYER_CHAIN_ID,
  kind: "player",
  mesh: null,
  get pos() { return pos; },
  get vel() { return vel; },
  get dim() { return dim; },
  get h() { return PLAYER_H; },
  get hw() { return PLAYER_HW; },
  get speed() { return (grappleMob && grappleMob.speed) || BIRD_SPEED; },
  get onGround() { return onGround; },
};
function playerInChain() {
  return grappleActive && !grappleRetracting && grappleHooked && !!grappleMob;
}
function isFlyingKind(kind) {
  return kind === "pigeon" || kind === "parrot" || kind === "dragon";
}
function isBirdKind(kind) {
  return kind === "pigeon" || kind === "parrot";
}
function isJumpingKind(kind) {
  return kind === "wolf" || kind === "cat";
}
function chainAttachModeFor(carriedKind, target) {
  if (target && target.kind === "iron_golem") return "behind";
  if (isFlyingKind(carriedKind) && !isFlyingKind(target.kind) && chainRootOf(target) === target) {
    return "prepend";
  }
  return "behind";
}
function chainMobById(id) {
  return id === PLAYER_CHAIN_ID ? playerChainAvatar : mobById.get(id);
}
function chainFollowDist(carrier) {
  if (carrier === playerChainAvatar) {
    return grappleMob && grappleMob.kind === "dragon" ? DRAGON_FOLLOW_DIST : BIRD_FOLLOW_DIST;
  }
  return carrier.kind === "dragon" ? DRAGON_FOLLOW_DIST : BIRD_FOLLOW_DIST;
}
function chainMidY(m) {
  return m.pos.y + m.h * 0.5;
}
const DRAGON_ANCHOR_DY = 0.36;
function chainAnchorY(m) {
  return chainMidY(m);
}
function isMobHeld(m) {
  return !!m && (m === carryMob || m === carryGrappleMob);
}
function isChained(m) {
  return !!m && chainParent.has(m.id);
}
function isChainCarrier(m) {
  return !!m && chainChild.has(m.id);
}
const CHAIN_LEAD_CONE = Math.PI / 4;
function chainLiveFollower(m) {
  if (!m || m === playerChainAvatar) return null;
  if (!chainChild.has(m.id)) return null;
  const f = mobById.get(chainChild.get(m.id));
  if (!f || !mobs.includes(f) || isMobHeld(f)) return null;
  if (f.dim !== undefined && m.dim !== undefined && f.dim !== m.dim) return null;
  return f;
}
function chainLeadConeDeflect(m, dx, dz) {
  const f = chainLiveFollower(m);
  if (!f) return null;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-6) return null;
  const fx = f.pos.x - m.pos.x, fz = f.pos.z - m.pos.z;
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-6) return null;
  if ((dx * fx + dz * fz) / (dl * fl) <= Math.cos(CHAIN_LEAD_CONE)) return null;
  const fang = Math.atan2(fx, fz);
  let rel = Math.atan2(dx, dz) - fang;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  let side;
  if (rel > 0) side = 1;
  else if (rel < 0) side = -1;
  else side = stickyTurnSide(m);
  const edge = fang + side * CHAIN_LEAD_CONE;
  return { x: Math.sin(edge), z: Math.cos(edge) };
}
function isGroundedChainVictim(m) {
  if (!m || (!isChained(m) && !isChainCarrier(m))) return false;
  if (!isFlyingKind(m.kind)) return true;
  if (!isBirdKind(m.kind)) return false;
  return m.onGround === true || m.mode === "perch" || m.mode === "toPerch" || m.mode === "sit" || m.mode === "cooped";
}
function chainRootOf(m) {
  if (!m) return null;
  let cur = m;
  const seen = new Set([cur.id]);
  while (chainParent.has(cur.id)) {
    const pid = chainParent.get(cur.id);
    if (pid === PLAYER_CHAIN_ID) {
      if (!playerInChain() || seen.has(PLAYER_CHAIN_ID)) break;
      seen.add(PLAYER_CHAIN_ID);
      if (!grappleMob || seen.has(grappleMob.id)) break;
      seen.add(grappleMob.id);
      cur = grappleMob;
      continue;
    }
    const p = mobById.get(pid);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    cur = p;
  }
  return cur;
}
function chainHasJumping(m) {
  let cur = m;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (isJumpingKind(cur.kind)) return true;
    const pid = chainParent.get(cur.id);
    if (pid === undefined) return false;
    if (pid === PLAYER_CHAIN_ID) {
      if (!playerInChain() || !grappleMob) return false;
      cur = grappleMob;
      continue;
    }
    cur = mobById.get(pid);
  }
  return false;
}
function chainJumpLed(m) {
  const r = chainRootOf(m);
  return !!r && isJumpingKind(r.kind);
}
function chainPushCrumb(m) {
  if (!m || !m.pos) return;
  let t = m._trail;
  if (!t) t = m._trail = [];
  const last = t[t.length - 1];
  if (last) {
    const dx = m.pos.x - last.x, dy = m.pos.y - last.y, dz = m.pos.z - last.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 64) t.length = 0;
    else if (d2 < 0.16) return;
  }
  t.push({ x: m.pos.x, y: m.pos.y, z: m.pos.z });
  if (t.length > 80) t.splice(0, t.length - 80);
}
function chainTrailTarget(m, dist) {
  const t = m._trail;
  if (!t || t.length < 2) return null;
  let acc = 0, px = m.pos.x, py = m.pos.y, pz = m.pos.z;
  for (let i = t.length - 1; i >= 0; i--) {
    const c = t[i];
    const seg = Math.hypot(c.x - px, c.y - py, c.z - pz);
    if (acc + seg >= dist) {
      const f = seg > 1e-6 ? (dist - acc) / seg : 0;
      return { x: px + (c.x - px) * f, y: py + (c.y - py) * f, z: pz + (c.z - pz) * f };
    }
    acc += seg;
    px = c.x; py = c.y; pz = c.z;
  }
  return null;
}
function chainHeadingAxisOf(m) {
  if (!m) return null;
  if (m.vel) {
    const sp = m.vel.length();
    if (sp >= 0.5) {
      let nx = m.vel.x / sp, ny = Math.max(-0.6, Math.min(0.6, m.vel.y / sp)), nz = m.vel.z / sp;
      const nl = Math.hypot(nx, ny, nz) || 1;
      if (!m._flyAxis) m._flyAxis = { x: 0, y: 0, z: 1 };
      m._flyAxis.x = nx / nl; m._flyAxis.y = ny / nl; m._flyAxis.z = nz / nl;
    }
  }
  return m._flyAxis || null;
}
function chainFlyVel(child, sx, sy, sz, ax, ay, az, leadSpd, ref, tautFrac, latMax, dt) {
  const hx = child.pos.x, hy = child.pos.y + child.h * 0.5, hz = child.pos.z;
  const gcx = sx - hx, gcy = sy - hy, gcz = sz - hz;
  const gcd = Math.hypot(gcx, gcy, gcz) || 1;
  const ePar = gcx * ax + gcy * ay + gcz * az;
  const qx = gcx - ax * ePar, qy = gcy - ay * ePar, qz = gcz - az * ePar;
  const qd = Math.hypot(qx, qy, qz);
  let latX = 0, latY = 0, latZ = 0;
  if (qd > 1e-6 && dt > 1e-4) {
    const s = Math.min(latMax, qd / dt) / qd;
    latX = qx * s; latY = qy * s; latZ = qz * s;
  }
  const stretch = gcd / (ref || 1) - 1.5;
  const catchUp = Math.max(0, Math.min(leadSpd + 8 - 2.5, stretch * 12));
  const longMax = 2.5 + 1.5 * tautFrac + catchUp;
  const longCorr = Math.max(-longMax, Math.min(longMax, ePar * 3));
  child.vel.x = ax * (leadSpd + longCorr) + latX;
  child.vel.y = ay * (leadSpd + longCorr) + latY;
  child.vel.z = az * (leadSpd + longCorr) + latZ;
}
function chainLeadSpeedOf(m, dt) {
  if (!m) return 0;
  const inst = m.vel ? m.vel.length() : 0;
  if (m._leadSpd === undefined) m._leadSpd = inst;
  m._leadSpd += (inst - m._leadSpd) * Math.min(1, dt * 3);
  return m._leadSpd;
}
function chainFlyingAxisSource(carrier, child) {
  if (carrier === playerChainAvatar) return grappleMob || null;
  const root = chainRootOf(child);
  if (root === playerChainAvatar) {
    if (grappleMob && isFlyingKind(grappleMob.kind)) return grappleMob;
    return carrier;
  }
  if (root && isFlyingKind(root.kind)) return root;
  return carrier;
}
function chainStationFromRoot(child, root) {
  if (!child || !root) return null;
  if (child === root) return 0;
  const carriers = [];
  let cur = child;
  const seen = new Set([cur.id]);
  let guard = 0;
  while (cur && cur !== root && guard++ < 64) {
    let front = null;
    const pid = chainParent.get(cur.id);
    if (pid !== undefined) front = chainMobById(pid);
    else if (cur === playerChainAvatar && playerInChain() && grappleMob) front = grappleMob;
    if (!front || seen.has(front.id)) return null;
    carriers.push(front);
    seen.add(front.id);
    cur = front;
  }
  if (cur !== root) return null;
  let station = 0;
  for (let i = carriers.length - 1; i >= 0; i--) station += chainFollowDist(carriers[i]);
  return station;
}
function chainTailOf(m) {
  const root = chainRootOf(m);
  if (!root) return null;
  let cur = root;
  const seen = new Set([cur.id]);
  for (;;) {
    if (chainChild.has(cur.id)) {
      const c = chainMobById(chainChild.get(cur.id));
      if (!c || seen.has(c.id)) break;
      seen.add(c.id);
      cur = c;
      continue;
    }
    if (cur !== playerChainAvatar && cur === grappleMob && playerInChain() &&
        chainChild.has(PLAYER_CHAIN_ID) && !seen.has(PLAYER_CHAIN_ID)) {
      seen.add(PLAYER_CHAIN_ID);
      cur = playerChainAvatar;
      continue;
    }
    break;
  }
  return cur;
}
function stampSpawn(m) {
  if (!m || !m.pos) return m;
  if (m.spawnX === undefined) {
    m.spawnX = m.pos.x;
    m.spawnY = m.pos.y;
    m.spawnZ = m.pos.z;
  }
  return m;
}
function seatChainChildOnCarrierSurface(carrier, child) {
  const baseY = carrier.pos.y;
  const spots = [
    [child.pos.x, baseY, child.pos.z],
    [carrier.pos.x + 0.9, baseY, carrier.pos.z],
    [carrier.pos.x - 0.9, baseY, carrier.pos.z],
    [carrier.pos.x, baseY, carrier.pos.z + 0.9],
    [carrier.pos.x, baseY, carrier.pos.z - 0.9],
    [child.pos.x, baseY + 1, child.pos.z],
  ];
  for (const s of spots) {
    const sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, s[0]));
    const sy = Math.max(1, Math.min(MAX_Y - 1, s[1]));
    const sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, s[2]));
    if (!aabbCollidesWorld(sx, sy, sz, child.hw, child.h)) {
      child.pos.set(sx, sy, sz);
      child.mesh.position.copy(child.pos);
      return true;
    }
  }
  return false;
}
function linkChain(carrier, child) {
  if (!carrier || !child || carrier === child) return false;
  const carrierIsPlayer = carrier === playerChainAvatar;
  if (!carrierIsPlayer && !mobs.includes(carrier)) return false;
  if (!mobs.includes(child)) return false;
  if (child.kind === "dragon") return false;
  if (child.kind === "iron_golem") return false;
  if (isChained(child) || (chainChild.has(child.id) && chainParent.has(child.id))) return false;
  if (child === carryMob || child === carryGrappleMob) return false;
  if (carrier === carryMob || carrier === carryGrappleMob) return false;
  if (chainChild.has(carrier.id)) return false;
  if (!carrierIsPlayer && carrier.kind === "enderman" && chainRootOf(carrier) === carrier) return false;
  if (aabbCollidesWorld(carrier.pos.x, carrier.pos.y, carrier.pos.z, carrier.hw, carrier.h)) return false;
  if (aabbCollidesWorld(child.pos.x, child.pos.y, child.pos.z, child.hw, child.h) &&
      !seatChainChildOnCarrierSurface(carrier, child) &&
      !seatChainChildNearCarrier(carrier, child)) return false;
  const root = carrierIsPlayer ? (playerInChain() ? chainRootOf(grappleMob) : null) : chainRootOf(carrier);
  if (!root) return false;
  const cd = carrier.dim || "over", chd = child.dim || "over";
  if (cd !== chd) return false;
  if (root.kind === "dragon") {
    if (cd !== "end") return false;
  } else if (cd !== "over" && cd !== "end" && cd !== "nether") return false;
  chainChild.set(carrier.id, child.id);
  chainParent.set(child.id, carrier.id);
  const rope = new THREE.InstancedMesh(chainLinkGeo, chainLinkMat, CHAIN_LINK_CUBES);
  rope.frustumCulled = false;
  rope.visible = true;
  scene.add(rope);
  const head = new THREE.Mesh(chainLinkHeadGeo, chainLinkHeadMat);
  head.visible = true;
  scene.add(head);
  chainLinks.set(child.id, { carrierId: carrier.id, rope, head, towDir: new THREE.Vector3(0, 0, 1), towPos: new THREE.Vector3(), towInit: false, playerFrontId: carrierIsPlayer ? grappleMob.id : null, taut: 0, strained: false, strainT: 0, carrierAirT: 0, hopT: 0, farT: 0, flySplitT: 0, snapT: carrierIsPlayer ? CHAIN_PLAYER_SNAP_T : 0.4, loiter: false, freeT: 0 });
  syncChainLinkColor(child.id);
  syncEndermanHalo(child);
  if (child.vel) child.vel.set(0, 0, 0);
  child.mode = "chained";
  child.path = null;
  child.target = null;
  child.perchSpot = null;
  child.perchGroup = null;
  child.wanderT = 0;
  child.blockedT = 0;
  child._stuckT = 0;
  setMobTransparent(child, 1);
  return true;
}
function spliceChainLink(front, back) {
  if (!front || !back || !mobs.includes(back) || !chainLinks.has(back.id)) return false;
  if (front !== playerChainAvatar && !mobs.includes(front)) return false;
  if (front === playerChainAvatar && !playerInChain()) return false;
  let f = front;
  let guard = 0;
  while (chainChild.has(f.id) && chainChild.get(f.id) !== back.id && guard++ < 64) {
    const nxt = chainMobById(chainChild.get(f.id));
    if (!nxt || !mobs.includes(nxt) || nxt === back || nxt === front) break;
    f = nxt;
  }
  const link = chainLinks.get(back.id);
  chainParent.set(back.id, f.id);
  chainChild.set(f.id, back.id);
  link.carrierId = f.id;
  link.playerFrontId = f === playerChainAvatar ? (grappleMob ? grappleMob.id : null) : null;
  link.towInit = false;
  link.taut = 0;
  link.towPos.set(0, 0, 0);
  link.hoverY = undefined;
  link.snapT = f === playerChainAvatar ? CHAIN_PLAYER_SNAP_T : 0.4;
  link.scvX = undefined;
  link.scvZ = undefined;
  link.faceYaw = undefined;
  link.loiter = false;
  link.freeT = 0;
  link.prevAx = undefined;
  link.farT = 0;
  link.flySplitT = 0;
  syncChainLinkColor(back.id);
  syncEndermanHalo(back);
  return true;
}
function seatChainChildNearCarrier(carrier, child) {
  const spots = [];
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (const d of [1.0, 1.6]) {
      for (const dy of [0, 1, 2]) {
        spots.push([carrier.pos.x + ox * d, carrier.pos.y + dy, carrier.pos.z + oz * d]);
      }
    }
  }
  for (const s of spots) {
    const sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, s[0]));
    const sy = Math.max(1, Math.min(MAX_Y - 1, s[1]));
    const sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, s[2]));
    if (!aabbCollidesWorld(sx, sy, sz, child.hw, child.h)) {
      child.pos.set(sx, sy, sz);
      child.mesh.position.copy(child.pos);
      return true;
    }
  }
  return false;
}
function seatNewLeadNear(root, mob) {
  const spots = [];
  for (let dy = 1; dy <= 3; dy++) spots.push([root.pos.x, root.pos.y + dy, root.pos.z]);
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (const d of [1.2, 2.0]) {
      spots.push([root.pos.x + ox * d, root.pos.y + 1, root.pos.z + oz * d]);
      spots.push([root.pos.x + ox * d, root.pos.y, root.pos.z + oz * d]);
    }
  }
  for (const s of spots) {
    const sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, s[0]));
    const sy = Math.max(1, Math.min(MAX_Y - 1, s[1]));
    const sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, s[2]));
    if (!aabbCollidesWorld(sx, sy, sz, mob.hw, mob.h)) {
      mob.pos.set(sx, sy, sz);
      mob.mesh.position.copy(mob.pos);
      return true;
    }
  }
  return false;
}
function prependChainLead(root, mob) {
  if (!root || !mob || root === mob) return false;
  if (!mobs.includes(root) || !mobs.includes(mob)) return false;
  if (mob === carryMob || mob === carryGrappleMob) return false;
  if (root === carryMob || root === carryGrappleMob) return false;
  if (root.kind === "dragon") return false;
  if ((mob.dim || "over") !== dim || (root.dim || "over") !== dim) return false;
  if (chainParent.get(root.id) === PLAYER_CHAIN_ID) {
    const rl = chainLinks.get(root.id);
    if (!(rl && rl.playerLead) || playerInChain()) return false;
    dropPlayerLeadEntry();
  }
  if (aabbCollidesWorld(root.pos.x, root.pos.y, root.pos.z, root.hw, root.h)) return false;
  if (!seatNewLeadNear(root, mob)) return false;
  if (!linkChain(mob, root)) return false;
  if (isBirdKind(mob.kind)) birdTakeoff(mob);
  return true;
}
function insertChainBefore(aimed, mob) {
  if (!aimed || !mob || aimed === mob) return false;
  if (aimed.kind === "dragon") return insertChainBehind(aimed, mob);
  if (!mobs.includes(aimed) || !mobs.includes(mob)) return false;
  if (mob === carryMob || mob === carryGrappleMob) return false;
  if (aimed === carryMob || aimed === carryGrappleMob) return false;
  if ((mob.dim || "over") !== dim || (aimed.dim || "over") !== dim) return false;
  const pid = chainParent.get(aimed.id);
  const F = pid === PLAYER_CHAIN_ID ? playerChainAvatar : (pid !== undefined ? mobById.get(pid) : null);
  const fLive = F === playerChainAvatar ? playerInChain() : !!(F && mobs.includes(F));
  if (!fLive) {
    if (chainChild.has(aimed.id)) return prependChainLead(aimed, mob);
    return linkChain(aimed, mob);
  }
  if (pid === PLAYER_CHAIN_ID) chainChild.delete(PLAYER_CHAIN_ID);
  else if (F && chainChild.get(F.id) === aimed.id) chainChild.delete(F.id);
  chainParent.delete(aimed.id);
  const seatOk = !aabbCollidesWorld(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) ||
    seatChainChildOnCarrierSurface(F, mob) || seatChainChildNearCarrier(F, mob);
  if (!seatOk || !linkChain(F, mob)) {
    if (!spliceChainLink(F, aimed)) {
      const al = chainLinks.get(aimed.id);
      if (al) {
        scene.remove(al.rope);
        scene.remove(al.head);
        if (al.rope.dispose) al.rope.dispose();
        chainLinks.delete(aimed.id);
      }
      resumeChainedMob(aimed);
    }
    return false;
  }
  if (!spliceChainLink(mob, aimed)) {
    const al = chainLinks.get(aimed.id);
    if (al) {
      scene.remove(al.rope);
      scene.remove(al.head);
      if (al.rope.dispose) al.rope.dispose();
      chainLinks.delete(aimed.id);
    }
    resumeChainedMob(aimed);
    return true;
  }
  if (F !== playerChainAvatar && isBirdKind(F.kind) && (F.mode === "perch" || F.mode === "toPerch")) birdTakeoff(F);
  return true;
}
function insertChainBehind(aimed, mob) {
  if (!aimed || !mob || aimed === mob) return false;
  if (!mobs.includes(aimed) || !mobs.includes(mob)) return false;
  if (mob === carryMob || mob === carryGrappleMob) return false;
  if (aimed === carryMob || aimed === carryGrappleMob) return false;
  if ((mob.dim || "over") !== dim || (aimed.dim || "over") !== dim) return false;
  const bid = chainChild.get(aimed.id);
  const B = bid !== undefined ? mobById.get(bid) : null;
  const bLive = !!(B && mobs.includes(B) && B !== mob && !isMobHeld(B));
  if (bid !== undefined) {
    chainChild.delete(aimed.id);
    chainParent.delete(bid);
  }
  const seatOk = !aabbCollidesWorld(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) ||
    seatChainChildOnCarrierSurface(aimed, mob) || seatChainChildNearCarrier(aimed, mob);
  if (!seatOk || !linkChain(aimed, mob)) {
    if (bLive) spliceChainLink(aimed, B);
    return false;
  }
  if (bLive) {
    if (!spliceChainLink(mob, B)) {
      const bl = chainLinks.get(B.id);
      if (bl) {
        scene.remove(bl.rope);
        scene.remove(bl.head);
        if (bl.rope.dispose) bl.rope.dispose();
        chainLinks.delete(B.id);
      }
      resumeChainedMob(B);
    }
  }
  if (isBirdKind(aimed.kind) && (aimed.mode === "perch" || aimed.mode === "toPerch")) birdTakeoff(aimed);
  return true;
}
function insertBehindRide(bird, mob) {
  if (!bird || !mob || bird === mob) return false;
  if (!mobs.includes(bird) || !mobs.includes(mob)) return false;
  if (mob === carryMob || mob === carryGrappleMob) return false;
  if (bird === carryMob || bird === carryGrappleMob) return false;
  if ((mob.dim || "over") !== dim || (bird.dim || "over") !== dim) return false;
  const cid = chainChild.get(bird.id);
  const C = cid !== undefined ? mobById.get(cid) : null;
  if (cid !== undefined) {
    if (C && mobs.includes(C) && C !== mob && !isMobHeld(C)) return insertChainBefore(C, mob);
    if (C && isMobHeld(C)) return false;
    chainChild.delete(bird.id);
    chainParent.delete(cid);
  }
  return linkChain(bird, mob);
}
function dropChainFrom(m) {
  if (!m) return;
  let cur = mobs.includes(m) ? m : null;
  if (cur && chainChild.has(cur.id)) {
    const ids = [];
    let c = mobById.get(chainChild.get(cur.id));
    const seen = new Set([cur.id]);
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      ids.push(c);
      c = chainChild.has(c.id) ? mobById.get(chainChild.get(c.id)) : null;
    }
    chainChild.delete(cur.id);
    for (const d of ids) {
      chainParent.delete(d.id);
      const link = chainLinks.get(d.id);
      if (link) {
        scene.remove(link.rope);
        scene.remove(link.head);
        if (link.rope.dispose) link.rope.dispose();
        chainLinks.delete(d.id);
      }
      if (mobs.includes(d)) resumeChainedMob(d);
    }
  }
  if (cur && chainParent.has(cur.id)) {
    const p = mobById.get(chainParent.get(cur.id));
    if (p && chainChild.get(p.id) === cur.id) chainChild.delete(p.id);
    chainParent.delete(cur.id);
    const link = chainLinks.get(cur.id);
    if (link) {
      scene.remove(link.rope);
      scene.remove(link.head);
      if (link.rope.dispose) link.rope.dispose();
      chainLinks.delete(cur.id);
    }
  }
}
function resumeChainedMob(m) {
  if (!mobs.includes(m)) return;
  m.mode = isFlyingKind(m.kind) ? "straight" : "wander";
  m.path = null;
  m.pathKey = null;
  m.blockedT = 0;
  m._panicT = 0;
  m._panicUntil = 0;
  m._panicSrcX = null;
  m._panicSrcZ = null;
  m._panicVillage = false;
  m._stuckT = 0;
  m.perchSpot = null;
  m.perchGroup = null;
  m.perchT = 0;
  m.perchWander = null;
  m.perchWanderT = 0;
  m.perchTimeout = 0;
  m.perchRetry = 0;
  if (m.vel) {
    if (isFlyingKind(m.kind)) {
      const yaw2 = Math.random() * Math.PI * 2;
      m.vel.set(Math.cos(yaw2) * BIRD_SPEED, 0, Math.sin(yaw2) * BIRD_SPEED);
      m.target = birdRandomTarget(m.pos);
      m.yaw = yaw2;
      m.yawTarget = yaw2;
    } else m.vel.set(0, 0, 0);
  }
  if (m.kind === "enderman") { m.falling = true; m.fallV = 0; }
  syncEndermanHalo(m);
  if (m._chainStep) { m.canStep = isJumpingKind(m.kind); delete m._chainStep; }
  m._chainJumpT = 0;
  m._wasInWater = false;
  m.onGround = false;
  if (m.mesh) m.mesh.rotation.x = 0;
  setMobTransparent(m, 1);
}
function rebindBabyBounds(m) {
  if (!m || !m.isBaby) return;
  m.villageBound = dim === "over" && m.pos.x >= villageMinX && m.pos.x <= villageMaxX && m.pos.z >= villageMinZ && m.pos.z <= villageMaxZ;
}
function babyParentFor(m) {
  const p = mobById.get(m.parentId);
  if (!p || mobDimOf(p) !== dim || Math.abs(m.pos.y - p.pos.y) >= 1) return null;
  return p;
}
function babyTrailSpot(m, p) {
  const yaw = (p.mesh ? p.mesh.rotation.y : 0) || 0;
  const bx = p.pos.x - Math.sin(yaw) * FOLLOW_TRAIL_D, bz = p.pos.z - Math.cos(yaw) * FOLLOW_TRAIL_D;
  const inWater = dim === "over" && (isInsidePool(bx, bz) || isInsidePenPool(bx, bz));
  if (!inWater && !aabbCollidesWorld(bx, m.pos.y, bz, m.hw, m.h) && hasMobGround(bx, bz, m.hw, m.pos.y)) return { x: bx, z: bz };
  return { x: p.pos.x, z: p.pos.z };
}
function catParentFor(m) {
  const p = mobById.get(m.parentId);
  if (!p || mobDimOf(p) !== dim || Math.abs(m.pos.y - p.pos.y) >= 1) return null;
  return p;
}
function catTrailSpot(m, p) {
  return babyTrailSpot(m, p);
}
function mobBondedPair(a, b) {
  if (!a || !b) return false;
  return ((a.isBaby || a.kind === "cat") && b.id === a.parentId) || ((b.isBaby || b.kind === "cat") && a.id === b.parentId);
}
function followParentOf(m) {
  if (!m || m.mode !== "follow") return null;
  if (m.fleeUntil != null && performance.now() / 1000 < m.fleeUntil) return null;
  return m.isBaby ? babyParentFor(m) : (m.kind === "cat" ? catParentFor(m) : null);
}
function isStrictFollower(m) {
  const p = followParentOf(m);
  if (!p) return false;
  return Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) <= FOLLOW_LEASH_D;
}
function chainTakeForCarry(mob) {
  if (!mob || !mobs.includes(mob)) return;
  if (mob.kind === "dragon") return;
  const carrierId = chainParent.get(mob.id);
  const childId = chainChild.get(mob.id);
  const front = carrierId === PLAYER_CHAIN_ID ? playerChainAvatar : mobById.get(carrierId);
  const back = childId !== undefined ? mobById.get(childId) : null;
  if (front === mob) return;
  const wasLead = carrierId === PLAYER_CHAIN_ID && !!((chainLinks.get(mob.id) || {}).playerLead);
  if (mob._chainStep) { mob.canStep = isJumpingKind(mob.kind); delete mob._chainStep; }
  if (carrierId !== undefined) {
    chainChild.delete(carrierId);
    chainParent.delete(mob.id);
  }
  chainChild.delete(mob.id);
  const link = chainLinks.get(mob.id);
  if (link) {
    scene.remove(link.rope);
    scene.remove(link.head);
    if (link.rope.dispose) link.rope.dispose();
    chainLinks.delete(mob.id);
  }
  if (back && mobs.includes(back) && !isMobHeld(back)) {
    if (front === playerChainAvatar && wasLead && !playerInChain()) {
      chainParent.set(back.id, PLAYER_CHAIN_ID);
      chainChild.set(PLAYER_CHAIN_ID, back.id);
      const bl = chainLinks.get(back.id);
      if (bl) {
        bl.carrierId = PLAYER_CHAIN_ID;
        bl.playerLead = true;
        bl.playerFrontId = null;
        bl.strainT = 0; bl.farT = 0; bl.flySplitT = 0; bl.threadT = 0; bl.loiter = false; bl.snapT = 0;
      }
      return;
    }
    if (front && spliceChainLink(front, back)) {
      const se = chainLinks.get(back.id);
      if (se) se.taut = CHAIN_TAUT_TIME;
      return;
    }
    freeChainRoot(back);
  }
}
function groundChainFrom(back) {
  const ids = [];
  const seen = new Set();
  let c = back && mobs.includes(back) ? back : null;
  while (c && !seen.has(c.id)) {
    seen.add(c.id);
    if (isMobHeld(c)) break;
    ids.push(c);
    const nxt = chainChild.has(c.id) ? mobById.get(chainChild.get(c.id)) : null;
    c = nxt && mobs.includes(nxt) ? nxt : null;
  }
  for (const d of ids) {
    chainParent.delete(d.id);
    chainChild.delete(d.id);
    const link = chainLinks.get(d.id);
    if (link) {
      scene.remove(link.rope);
      scene.remove(link.head);
      if (link.rope.dispose) link.rope.dispose();
      chainLinks.delete(d.id);
    }
    resumeChainedMob(d);
    d.villageBound = false;
    d.penBound = false;
    if (isBirdKind(d.kind)) {
      if (d.vel) d.vel.set(0, -1, 0);
      d._chainFall = true;
    }
  }
  if (c && isMobHeld(c)) {
    const hl = chainLinks.get(c.id);
    if (hl) {
      scene.remove(hl.rope);
      scene.remove(hl.head);
      if (hl.rope.dispose) hl.rope.dispose();
      chainLinks.delete(c.id);
    }
    chainParent.delete(c.id);
  }
}
function freeChainRoot(back) {
  if (!back || !mobs.includes(back)) return;
  if (back.kind === "enderman") {
    const nextId = chainChild.get(back.id);
    const next = nextId !== undefined ? mobById.get(nextId) : null;
    const bl = chainLinks.get(back.id);
    if (bl) {
      scene.remove(bl.rope);
      scene.remove(bl.head);
      if (bl.rope.dispose) bl.rope.dispose();
      chainLinks.delete(back.id);
    }
    chainParent.delete(back.id);
    chainChild.delete(back.id);
    resumeChainedMob(back);
    if (back.isBaby) rebindBabyBounds(back); else back.villageBound = false;
    back.penBound = false;
    if (next && mobs.includes(next) && next !== back && !isMobHeld(next)) freeChainRoot(next);
    else if (next && mobs.includes(next) && isMobHeld(next)) {
      const nl = chainLinks.get(next.id);
      if (nl) {
        scene.remove(nl.rope);
        scene.remove(nl.head);
        if (nl.rope.dispose) nl.rope.dispose();
        chainLinks.delete(next.id);
      }
      chainParent.delete(next.id);
    }
    return;
  }
  const bl = chainLinks.get(back.id);
  if (bl) {
    scene.remove(bl.rope);
    scene.remove(bl.head);
    if (bl.rope.dispose) bl.rope.dispose();
    chainLinks.delete(back.id);
  }
  chainParent.delete(back.id);
  resumeChainedMob(back);
  if (back.isBaby) rebindBabyBounds(back); else back.villageBound = false;
  back.penBound = false;
}
function severChainMob(m) {
  if (!m || !mobs.includes(m)) return;
  if (m.kind === "dragon") return;
  const carrierId = chainParent.get(m.id);
  const childId = chainChild.get(m.id);
  const front = carrierId === PLAYER_CHAIN_ID ? playerChainAvatar : mobById.get(carrierId);
  const back = childId !== undefined ? mobById.get(childId) : null;
  if (carrierId !== undefined) {
    if (carrierId === PLAYER_CHAIN_ID) chainChild.delete(PLAYER_CHAIN_ID);
    else if (front && chainChild.get(carrierId) === m.id) chainChild.delete(carrierId);
    chainParent.delete(m.id);
  }
  chainChild.delete(m.id);
  const self = chainLinks.get(m.id);
  if (self) {
    scene.remove(self.rope);
    scene.remove(self.head);
    if (self.rope.dispose) self.rope.dispose();
    chainLinks.delete(m.id);
  }
  if (!back || !mobs.includes(back)) return;
  if (isMobHeld(back)) {
    const bl = chainLinks.get(back.id);
    if (bl) {
      scene.remove(bl.rope);
      scene.remove(bl.head);
      if (bl.rope.dispose) bl.rope.dispose();
      chainLinks.delete(back.id);
    }
    chainParent.delete(back.id);
    return;
  }
  freeChainRoot(back);
}
// True when (x, y, z) holds a LOG/LEAVES cell of a villager-planted pine.
function pineCellAt(x, y, z) {
  if (getBlock(x, y, z) !== LOG && getBlock(x, y, z) !== LEAVES) return false;
  return pineAt(x, y, z) !== null;
}
// Owning planted pine whose grown cells contain (x, y, z), or null.
function pineAt(x, y, z) {
  for (const p of plantedPines.values()) {
    if (Math.abs(x - p.x) > p.m + 2 || Math.abs(z - p.z) > p.m + 2) continue;
    if (y < p.y || y > pineSummit(p.y, p.m, p.e)) continue;
    for (const c of pineCellsFor(p.x, p.y, p.z, p.m, p.e)) {
      if (c.x === x && c.y === y && c.z === z) return p;
    }
  }
  return null;
}
function chainComponentFrom(root) {
  const out = [];
  const seen = new Set();
  let cur = root;
  while (cur && mobs.includes(cur) && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    const cid = chainChild.get(cur.id);
    cur = cid !== undefined ? mobById.get(cid) : null;
  }
  return out;
}
// Silent removal: no respawn, no resume (unlike killChainMob).
function despawnChainMob(m) {
  if (!m || !mobs.includes(m)) return;
  if (m === carryMob || m === carryGrappleMob || m === grappleMob) return;
  if (m.kind === "dragon") return;
  chainParent.delete(m.id);
  chainChild.delete(m.id);
  const self = chainLinks.get(m.id);
  if (self) {
    scene.remove(self.rope);
    scene.remove(self.head);
    if (self.rope.dispose) self.rope.dispose();
    chainLinks.delete(m.id);
  }
  if (m.mesh) scene.remove(m.mesh);
  if (m.fallMesh) scene.remove(m.fallMesh);
  mobById.delete(m.id);
  mobs.splice(mobs.indexOf(m), 1);
  const ei = endermen.indexOf(m);
  if (ei >= 0) endermen.splice(ei, 1);
}
// When pine blocks break (by hand or blast), small orphan chains lingering
// nearby go down with them: every live chain component of <= maxMembers with
// a member within `radius` of (x, y, z) despawns. Components touching the
// player, a held/hook-frozen mob or the dragon are spared.
function cullSmallChainsNear(x, y, z, maxMembers, radius) {
  const r2 = radius * radius;
  const comps = [];
  for (const m of mobs) {
    if (!chainChild.has(m.id) || chainParent.has(m.id)) continue;
    if (m.kind === "dragon") continue;
    comps.push(chainComponentFrom(m));
  }
  for (const comp of comps) {
    if (!comp.length || comp.length > maxMembers) continue;
    let skip = false, near = false;
    for (const m of comp) {
      if (!mobs.includes(m) || !m.pos) { skip = true; break; }
      if (m === carryMob || m === carryGrappleMob || m === grappleMob) { skip = true; break; }
      if (m.kind === "dragon" || isMobFrozenByGrapple(m)) { skip = true; break; }
      const dx = m.pos.x - x, dy = m.pos.y - y, dz = m.pos.z - z;
      if (dx * dx + dy * dy + dz * dz <= r2) near = true;
    }
    if (skip || !near) continue;
    for (const m of [...comp]) despawnChainMob(m);
  }
}
function pruneChains() {
  for (const [childId, link] of [...chainLinks]) {
    if (link.carrierId === PLAYER_CHAIN_ID) {
      const child = mobById.get(childId);
      if (child && mobs.includes(child) && ((playerInChain() && mobs.includes(grappleMob)) || link.playerLead)) continue;
      const front = mobById.get(link.playerFrontId);
      chainChild.delete(PLAYER_CHAIN_ID);
      if (child && mobs.includes(child)) {
        if (front && mobs.includes(front) && spliceChainLink(front, child)) continue;
        dropChainFrom(child);
        resumeChainedMob(child);
      } else {
        scene.remove(link.rope);
        scene.remove(link.head);
        if (link.rope.dispose) link.rope.dispose();
        chainLinks.delete(childId);
        chainParent.delete(childId);
      }
      continue;
    }
    const child = mobById.get(childId);
    const carrier = mobById.get(link.carrierId);
    if (!child || !carrier || !mobs.includes(child) || !mobs.includes(carrier)) {
      scene.remove(link.rope);
      scene.remove(link.head);
      if (link.rope.dispose) link.rope.dispose();
      chainLinks.delete(childId);
      chainParent.delete(childId);
      if (carrier && chainChild.get(carrier.id) === childId) chainChild.delete(carrier.id);
      if (child && mobs.includes(child) && child.mode === "chained") resumeChainedMob(child);
    }
  }
  for (const [c, ch] of [...chainChild]) {
    if (!chainLinks.has(ch)) chainChild.delete(c);
  }
  for (const [ch, c] of [...chainParent]) {
    if (!chainLinks.has(ch)) chainParent.delete(ch);
  }
  syncEndermanHalos();
  syncChainLinkColors();
}
function clearChains() {
  for (const [, link] of chainLinks) {
    scene.remove(link.rope);
    scene.remove(link.head);
    if (link.rope.dispose) link.rope.dispose();
  }
  chainLinks.clear();
  chainChild.clear();
  chainParent.clear();
  syncEndermanHalos();
}
function chainMoveAxis(m, dx, dy, dz) {
  const blocked = { x: false, y: false, z: false };
  const nx = m.pos.x + dx, ny = m.pos.y + dy, nz = m.pos.z + dz;
  if (!aabbCollidesWorld(nx, ny, nz, m.hw, m.h)) {
    m.pos.set(nx, ny, nz);
    return blocked;
  }
  if (dx && !aabbCollidesWorld(m.pos.x + dx, m.pos.y, m.pos.z, m.hw, m.h)) m.pos.x += dx;
  else if (dx) blocked.x = true;
  if (dz && !aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z + dz, m.hw, m.h)) m.pos.z += dz;
  else if (dz) blocked.z = true;
  if (dy && !aabbCollidesWorld(m.pos.x, m.pos.y + dy, m.pos.z, m.hw, m.h)) m.pos.y += dy;
  else if (dy) blocked.y = true;
  return blocked;
}
function chainDepthOfId(childId) {
  let depth = 0, cur = childId, guard = 0;
  while (guard++ < 64) {
    const pid = chainParent.get(cur);
    if (pid === undefined) break;
    depth++;
    if (pid === PLAYER_CHAIN_ID) break;
    cur = pid;
  }
  return depth;
}
function updateChains(dt) {
  pruneChains();
  if (dim !== "over" && dim !== "end" && dim !== "nether") return;
  dt = Math.min(0.05, dt);
  const chainOrder = [...chainLinks];
  chainOrder.sort((a, b) => chainDepthOfId(a[0]) - chainDepthOfId(b[0]));
  for (const [childId, link] of chainOrder) {
    const child = mobById.get(childId);
    const carrier = chainMobById(link.carrierId);
    if (!child || !carrier) continue;
    if (child.dim !== undefined && child.dim !== dim) continue;
    if (carrier === carryMob || carrier === carryGrappleMob) {
      chainTakeForCarry(carrier);
      continue;
    }
    const followDist = chainFollowDist(carrier);
    const towRoot = chainRootOf(child);
    const towRootFlying = !!towRoot && towRoot !== playerChainAvatar && isFlyingKind(towRoot.kind);
    const towAvatarFlying = carrier === playerChainAvatar && !!grappleMob && isFlyingKind(grappleMob.kind);
    const legacyTow = towRootFlying || towAvatarFlying;
    const linkLen = followDist;
    const cvl = carrier.vel ? carrier.vel.length() : 0;
    if (cvl > 1e-3) {
      chainLinkTmp.set(carrier.vel.x / cvl, carrier.vel.y / cvl, carrier.vel.z / cvl);
      chainLinkTmp.y = Math.max(-0.6, Math.min(0.6, chainLinkTmp.y));
      chainLinkTmp.normalize();
      if (!link.towInit) link.towDir.copy(chainLinkTmp);
      else {
        link.towDir.lerp(chainLinkTmp, Math.min(1, dt * 2.2));
        if (link.towDir.lengthSq() < 1e-6) link.towDir.set(0, 0, 1);
        link.towDir.normalize();
      }
      link.towInit = true;
    } else if (!link.towInit) {
      link.towDir.set(0, 0, 1);
      link.towInit = true;
    }
    const desX = carrier.pos.x - link.towDir.x * followDist;
    const desY = chainAnchorY(carrier) - link.towDir.y * followDist - child.h * 0.5;
    const desZ = carrier.pos.z - link.towDir.z * followDist;
    const crumb = chainTrailTarget(carrier, followDist);
    const directSlot = !legacyTow && isFlyingKind(child.kind);
    const wantX = crumb && !directSlot ? crumb.x : desX;
    const wantY = crumb && !directSlot ? crumb.y + carrier.h * 0.5 - child.h * 0.5 : desY;
    const wantZ = crumb && !directSlot ? crumb.z : desZ;
    if (link.towPos.lengthSq() < 1e-6) link.towPos.set(wantX, wantY, wantZ);
    else link.towPos.lerp(chainLinkTmp.set(wantX, wantY, wantZ), Math.min(1, dt * 6));
    if (!legacyTow) {
      updateChainGroundLink(link, carrier, child, followDist, dt);
    } else {
    if (!child.vel) child.vel = new THREE.Vector3();
    let lead = chainRootOf(child);
    if (!lead || lead === playerChainAvatar || !isFlyingKind(lead.kind)) lead = carrier;
    if (lead === playerChainAvatar) lead = (grappleMob && isFlyingKind(grappleMob.kind)) ? grappleMob : carrier;
    if (!lead._chAx) {
      lead._chAx = new THREE.Vector3(0, 0, 1);
      lead._chAxP = new THREE.Vector3(0, 0, 1);
      lead._chAxV = new THREE.Vector3();
      lead._chFF = new THREE.Vector3();
    }
    const lvx = lead.vel ? lead.vel.x : 0;
    const lvy = lead.vel ? lead.vel.y : 0;
    const lvz = lead.vel ? lead.vel.z : 0;
    const lspd = Math.hypot(lvx, lvy, lvz);
    if (lspd > 0.5) {
      const inx = lvx / lspd, iny = Math.max(-0.6, Math.min(0.6, lvy / lspd)), inz = lvz / lspd;
      const inl = Math.hypot(inx, iny, inz) || 1;
      lead._chAx.lerp(chainLinkTmp.set(inx / inl, iny / inl, inz / inl), Math.min(1, dt * 8));
      if (lead._chAx.lengthSq() < 1e-6) lead._chAx.set(0, 0, 1);
      lead._chAx.normalize();
    }
    if (dt > 1e-4) {
      chainLinkTmp.set(
        (lead._chAx.x - lead._chAxP.x) / dt,
        (lead._chAx.y - lead._chAxP.y) / dt,
        (lead._chAx.z - lead._chAxP.z) / dt);
      lead._chAxV.lerp(chainLinkTmp, Math.min(1, dt * 3));
      lead._chAxP.copy(lead._chAx);
    }
    let ffx = lvx, ffy = lvy, ffz = lvz;
    if (lspd > 1e-3) {
      const cny = Math.max(-0.6, Math.min(0.6, lvy / lspd));
      const cnl = Math.hypot(lvx / lspd, cny, lvz / lspd) || 1;
      ffx = lvx / lspd / cnl * lspd;
      ffy = cny / cnl * lspd;
      ffz = lvz / lspd / cnl * lspd;
    }
    lead._chFF.lerp(chainLinkTmp.set(ffx, ffy, ffz), Math.min(1, dt * 3));
    const cvx = carrier.vel ? carrier.vel.x : 0;
    const cvy = carrier.vel ? carrier.vel.y : 0;
    const cvz = carrier.vel ? carrier.vel.z : 0;
    const cvSpd = Math.hypot(cvx, cvy, cvz);
    let csx = cvx, csy = cvy, csz = cvz;
    if (cvSpd > 1e-3) {
      const cny = Math.max(-0.6, Math.min(0.6, cvy / cvSpd));
      const cnl = Math.hypot(cvx / cvSpd, cny, cvz / cvSpd) || 1;
      csx = cvx / cvSpd / cnl * cvSpd;
      csy = cny / cnl * cvSpd;
      csz = cvz / cvSpd / cnl * cvSpd;
    }
    const ax = lead._chAx.x, ay = lead._chAx.y, az = lead._chAx.z;
    const tx = carrier.pos.x - ax * followDist;
    const ty = chainAnchorY(carrier) - ay * followDist - child.h * 0.5;
    const tz = carrier.pos.z - az * followDist;
    const svx = csx - lead._chAxV.x * followDist;
    const svy = csy - lead._chAxV.y * followDist;
    const svz = csz - lead._chAxV.z * followDist;
    const ex = tx - child.pos.x, ey = ty - child.pos.y, ez = tz - child.pos.z;
    let dvx = svx + ex * CHAIN_TOW_KP;
    let dvy = svy + ey * CHAIN_TOW_KP;
    let dvz = svz + ez * CHAIN_TOW_KP;
    const leadSpd = chainLeadSpeedOf(lead, dt);
    const maxSp = Math.max(12, leadSpd + 8);
    const dl = Math.hypot(dvx, dvy, dvz);
    if (dl > maxSp) {
      const s = maxSp / dl;
      dvx *= s; dvy *= s; dvz *= s;
    }
    const threadSep = chainLinkDelta(carrier, child);
    const threading = !isFlyingKind(child.kind) && threadSep.d > linkLen * 1.5 && chainThreadRide(link, carrier, child, dt);
    link.threadT = threading ? (link.threadT || 0) + dt : 0;
    if (threading) {
      link.farT = 0;
      link.flySplitT = 0;
    } else {
    child.vel.copy(chainLinkTmp.set(dvx, dvy, dvz));
    const hit = chainMoveAxis(child, child.vel.x * dt, child.vel.y * dt, child.vel.z * dt);
    if (hit.x) child.vel.x = 0;
    if (hit.y) child.vel.y = 0;
    if (hit.z) child.vel.z = 0;
    if ((hit.x || hit.z) && chainHasJumping(child) && !mobInWater(child) && child.vel.y < 1) {
      const by = Math.floor(child.pos.y);
      let headroom = true;
      for (let hbx = Math.floor(child.pos.x - child.hw + 0.001); headroom && hbx <= Math.floor(child.pos.x + child.hw - 0.001); hbx++)
        for (let hbz = Math.floor(child.pos.z - child.hw + 0.001); headroom && hbz <= Math.floor(child.pos.z + child.hw - 0.001); hbz++)
          if (isSolid(hbx, by + 1, hbz)) headroom = false;
      if (headroom && !aabbCollidesWorld(child.pos.x, by + 1 + 0.001, child.pos.z, child.hw, child.h)) child.vel.y = JUMP_MIN + 2.5;
    }
    }
    child.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, child.pos.x));
    child.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, child.pos.z));
    child.pos.y = Math.max(1, Math.min(MAX_Y - 1, child.pos.y));
    if (dim === "end") {
      endClampXZPos(child.pos);
      if (!isFlyingKind(child.kind)) child.pos.y = Math.max(1, Math.min(DRAGON_MAX_Y, child.pos.y));
    }
    const linkAx = carrier.pos.x, linkAy = chainAnchorY(carrier), linkAz = carrier.pos.z;
    const linkDx = child.pos.x - linkAx, linkDy = chainAnchorY(child) - linkAy, linkDz = child.pos.z - linkAz;
    const linkD = Math.hypot(linkDx, linkDy, linkDz);
    const dyF = chainAnchorY(child) - chainAnchorY(carrier);
    const isPlayerLink = carrier === playerChainAvatar;
    const playerGrace = isPlayerLink && (link.snapT || 0) > 0;
    link.flySplitT = playerGrace ? 0 : (Math.abs(dyF) > CHAIN_FLY_SPLIT_DY ? (link.flySplitT || 0) + dt : 0);
    if (!threading && !playerGrace && link.flySplitT > CHAIN_SPLIT_STRAIN_T) {
      freeChainRoot(child);
      continue;
    }
    link.farT = playerGrace ? 0 : (linkD > linkLen * CHAIN_FLY_LEASH ? (link.farT || 0) + dt : 0);
    if (!threading && !playerGrace && link.farT > CHAIN_FLY_LEASH_T) {
      freeChainRoot(child);
      continue;
    }
    link.snapT = Math.max(0, (link.snapT || 0) - dt);
    const snapMax = isPlayerLink ? Infinity : linkLen * CHAIN_FLY_SNAP_MAX;
    if (!threading && (link.snapT || 0) > 0 && linkD > linkLen * 1.5 && linkD <= snapMax) {
      let sx2 = tx, sy2 = ty, sz2 = tz;
      if (dim === "end") {
        sx2 = endSquareCoord(sx2); sz2 = endSquareCoord(sz2);
        if (isFlyingKind(child.kind)) sy2 = Math.max(1, Math.min(MAX_Y - 1, sy2));
      }
      if (!aabbCollidesWorld(sx2, sy2, sz2, child.hw, child.h) &&
          birdSegmentFree(child.pos.x, child.pos.y, child.pos.z, sx2, sy2, sz2)) {
        chainSlideToward(child, sx2, sy2, sz2, 1.5);
        child.vel.set(svx, svy, svz);
      }
    }
    child.onGround = aabbCollidesWorld(child.pos.x, child.pos.y - 0.05, child.pos.z, child.hw, child.h);
    }
    chainPushCrumb(carrier);
    chainPushCrumb(child);
    child.mesh.position.copy(child.pos);
    const faceSpd = Math.hypot(child.vel.x, child.vel.z);
    const faceFlying = isFlyingKind(child.kind);
    if (faceSpd > (faceFlying ? 1.0 : 0.5)) {
      const targetYaw = Math.atan2(child.vel.x, child.vel.z);
      if (faceFlying) {
        if (link.faceYaw === undefined) link.faceYaw = child.mesh.rotation.y;
        let dface = targetYaw - link.faceYaw;
        while (dface > Math.PI) dface -= Math.PI * 2;
        while (dface < -Math.PI) dface += Math.PI * 2;
        link.faceYaw += dface * Math.min(1, dt * 5);
        let dm = link.faceYaw - child.mesh.rotation.y;
        while (dm > Math.PI) dm -= Math.PI * 2;
        while (dm < -Math.PI) dm += Math.PI * 2;
        child.mesh.rotation.y += dm * Math.min(1, dt * 10);
      } else {
        let dyaw = targetYaw - child.mesh.rotation.y;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const faceDead = (child.h >= 2 && faceSpd < 2) ? 0.08 : 0;
        if (Math.abs(dyaw) > faceDead) child.mesh.rotation.y += dyaw * Math.min(1, dt * 10);
      }
    }
    renderChainLink(link, carrier, child);
  }
}
function chainLinkDelta(carrier, child) {
  const dx = child.pos.x - carrier.pos.x;
  const dy = chainAnchorY(child) - chainAnchorY(carrier);
  const dz = child.pos.z - carrier.pos.z;
  return { dx, dy, dz, d: Math.hypot(dx, dy, dz) };
}
function chainSlideToward(m, tx, ty, tz, maxTravel) {
  const sx = tx - m.pos.x, sy = ty - m.pos.y, sz = tz - m.pos.z;
  const dist = Math.hypot(sx, sy, sz);
  if (dist < 1e-6) return 0;
  const travel = Math.min(dist, maxTravel);
  const steps = Math.max(1, Math.ceil(travel / 0.5));
  for (let i = 0; i < steps; i++) {
    const f = travel / steps / dist;
    chainMoveAxis(m, sx * f, sy * f, sz * f);
  }
  return Math.hypot(tx - m.pos.x, ty - m.pos.y, tz - m.pos.z);
}
function updateChainGroundLink(link, carrier, child, followDist, dt) {
  if (!child.vel) child.vel = new THREE.Vector3();
  const floats = isFlyingKind(child.kind);
  if (floats) { if (child._chainStep) { child.canStep = isJumpingKind(child.kind); delete child._chainStep; } }
  else if (chainJumpLed(child)) {
    if (child._chainStep === "suppress") delete child._chainStep;
    if (!child.canStep) { child.canStep = true; child._chainStep = "grant"; }
  } else {
    if (child._chainStep === "grant") { child.canStep = isJumpingKind(child.kind); delete child._chainStep; }
    else if (isJumpingKind(child.kind) && child.canStep && child._chainStep === undefined) { child.canStep = false; child._chainStep = "suppress"; }
  }
  const isAvatar = carrier === playerChainAvatar;
  const baseLen = followDist;
  const lo = baseLen * 0.5, hi = baseLen * 1.5, leash = baseLen * 2;
  let sep = chainLinkDelta(carrier, child);
  const hdOf = () => Math.hypot(sep.dx, sep.dz);
  const vSep = () => Math.abs(child.pos.y - carrier.pos.y) > CHAIN_SPLIT_DY;
  if (hdOf() >= leash && sep.d > 1e-6) {
    const nx = sep.dx / sep.d, ny = sep.dy / sep.d, nz = sep.dz / sep.d;
    const sc = child.vel.x * nx + child.vel.y * ny + child.vel.z * nz;
    if (sc > 0) { child.vel.x -= nx * sc; child.vel.y -= ny * sc; child.vel.z -= nz * sc; }
    if (!isAvatar && carrier.vel) {
      const sr = -(carrier.vel.x * nx + carrier.vel.y * ny + carrier.vel.z * nz);
      if (sr > 0) { carrier.vel.x += nx * sr; carrier.vel.y += ny * sr; carrier.vel.z += nz * sr; }
    }
  }
  if (!link.prevTow) link.prevTow = { x: link.towPos.x, y: link.towPos.y, z: link.towPos.z };
  let ffX = (link.towPos.x - link.prevTow.x) / dt, ffZ = (link.towPos.z - link.prevTow.z) / dt;
  const ffL = Math.hypot(ffX, ffZ);
  if (ffL > 12) { ffX *= 12 / ffL; ffZ *= 12 / ffL; }
  link.prevTow.x = link.towPos.x; link.prevTow.y = link.towPos.y; link.prevTow.z = link.towPos.z;
  const noProgress = (link.strainD === undefined) || (hdOf() >= link.strainD - 0.05);
  link.strainD = hdOf();
  link.strainT = ((hdOf() > hi * 0.9 || vSep()) && noProgress) ? (link.strainT || 0) + dt : 0;
  link.snapT = Math.max(0, (link.snapT || 0) - dt);
  const inWater = mobInWater(child);
  link.carrierAirT = (carrier.onGround === false) ? (link.carrierAirT || 0) + dt : 0;
  let threading = !floats && hdOf() > hi && chainThreadRide(link, carrier, child, dt);
  if (threading) {
    link.strainT = 0;
    link.threadT = (link.threadT || 0) + dt;
  } else link.threadT = 0;
  if (!threading && link.carrierAirT < 0.5 && vSep() && link.strainT > CHAIN_SPLIT_STRAIN_T) {
    freeChainRoot(child);
    return;
  }
  if (threading) {
    child.onGround = aabbCollidesWorld(child.pos.x, child.pos.y - 0.05, child.pos.z, child.hw, child.h);
  } else {
      const strained = hdOf() > hi;
      const spd = strained ? WALK * 2 : WALK / 2;
      const sx = link.towPos.x - child.pos.x, sz = link.towPos.z - child.pos.z;
      const sd = Math.hypot(sx, sz);
      const evx = child.vel.x, evy = child.vel.y, evz = child.vel.z;
      link.freeT = hdOf() <= hi ? 0.5 : Math.max(0, (link.freeT || 0) - dt);
      let loiter = false;
      if (floats && strained && (hdOf() > hi) &&
          !chainSegmentFree(child, child.pos.x, child.pos.y, child.pos.z, carrier.pos.x, carrier.pos.y, carrier.pos.z))
        loiter = (link.freeT || 0) > 0 || !!link.loiter;
      link.loiter = loiter;
      if (floats && loiter) {
        const kl = Math.min(1, dt * 2.5);
        child.vel.x += (0 - child.vel.x) * kl;
        child.vel.z += (0 - child.vel.z) * kl;
      } else if (floats) {
        const cvx = carrier.vel ? carrier.vel.x : 0;
        const cvz = carrier.vel ? carrier.vel.z : 0;
        if (link.scvX === undefined) { link.scvX = cvx; link.scvZ = cvz; }
        const sc = Math.min(1, dt * 3);
        link.scvX += (cvx - link.scvX) * sc;
        link.scvZ += (cvz - link.scvZ) * sc;
        let dvx = sx * 1.6 + link.scvX, dvz = sz * 1.6 + link.scvZ;
        const fcap = (strained ? WALK * 2 : WALK) + 2;
        const fdl = Math.hypot(dvx, dvz);
        if (fdl > fcap) { dvx *= fcap / fdl; dvz *= fcap / fdl; }
        const kf = Math.min(1, dt * 2.5);
        child.vel.x += (dvx - child.vel.x) * kf;
        child.vel.z += (dvz - child.vel.z) * kf;
      } else {
        let desX = 0, desZ = 0;
        if (sd > 0.25) { const s = Math.min(spd, sd * 3); desX = sx / sd * s; desZ = sz / sd * s; }
        const k = Math.min(1, dt * (strained ? 2.5 : 5));
        child.vel.x += (desX + ffX * 0.6 - child.vel.x) * k;
        child.vel.z += (desZ + ffZ * 0.6 - child.vel.z) * k;
      }
      if (strained && !link.loiter) {
        if (link.taut > 0) link.taut = Math.max(0, link.taut - dt);
        const taut = link.taut > 0;
        const stiff = floats ? 6 : (taut ? 36 : 18), damp = floats ? 7 : (taut ? 14 : 11);
        const ex = link.towPos.x - child.pos.x, ey = link.towPos.y - child.pos.y, ez = link.towPos.z - child.pos.z;
        const exl = Math.hypot(ex, ey, ez) || 1, ecl = Math.min(exl, 3);
        const cvx = carrier.vel ? carrier.vel.x : 0, cvy = carrier.vel ? carrier.vel.y : 0, cvz = carrier.vel ? carrier.vel.z : 0;
        child.vel.x += ((ex / exl * ecl) * stiff - (child.vel.x - cvx) * damp) * dt;
        child.vel.y += ((ey / exl * ecl) * stiff - (child.vel.y - cvy) * damp) * dt;
        child.vel.z += ((ez / exl * ecl) * stiff - (child.vel.z - cvz) * damp) * dt;
        const airFollowCap = (link.carrierAirT || 0) > 0.2;
        const maxSp = (airFollowCap ? BIRD_SPEED : (carrier.speed || BIRD_SPEED)) * 2.2 * (taut ? 1.5 : 1);
        const spdNow = Math.hypot(child.vel.x, child.vel.y, child.vel.z);
        if (spdNow > maxSp) { child.vel.x *= maxSp / spdNow; child.vel.y *= maxSp / spdNow; child.vel.z *= maxSp / spdNow; }
        link.hopT = Math.max(0, (link.hopT || 0) - dt);
        if (!floats && child.onGround && !inWater && link.hopT <= 0 && sd > 0.4) {
          const px = child.pos.x + (sx / sd) * 0.6, pz = child.pos.z + (sz / sd) * 0.6;
          if (aabbCollidesWorld(px, child.pos.y + 0.2, pz, child.hw, child.h) && !aabbCollidesWorld(child.pos.x, child.pos.y + 1.2, child.pos.z, child.hw, child.h)) {
            child.vel.y = JUMP_MIN + 2.5;
            child.onGround = false;
            link.hopT = 0.8;
          }
        }
      }
      if (floats) {
        const hoverTgt = carrier.pos.y + 0.9;
        if (link.hoverY === undefined) link.hoverY = hoverTgt;
        else link.hoverY += (hoverTgt - link.hoverY) * Math.min(1, dt * 5);
        const feetY = Math.max(link.towPos.y, link.hoverY);
        const inWaterF = mobInWater(child);
        if (inWaterF && !child._wasInWater && child.vel.y < 0) child.vel.y *= 0.3;
        child._wasInWater = inWaterF;
        if (inWaterF) {
          const surface = waterSurfaceForMob(child);
          if (surface === -Infinity) {
            if (!child.onGround) child.vel.y -= GRAVITY * dt;
          } else {
            const err = mobFloatTargetY(surface, child.h) - child.pos.y;
            if (err > SWIM_AREA) child.vel.y += SWIM_ACCEL * dt;
            else child.vel.y += (err * 4 - child.vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
          }
          child.vel.y = Math.min(Math.max(child.vel.y, -SWIM_MAX), SWIM_MAX);
        } else if (child._chainJumpT > 0) {
          child._chainJumpT -= dt;
          child.vel.y -= GRAVITY * dt;
        } else {
          const ferr = feetY - child.pos.y;
          const vyT = Math.abs(ferr) < 0.12 ? 0 : Math.max(-6, Math.min(6, ferr * 4));
          child.vel.y += (vyT - child.vel.y) * Math.min(1, dt * 4.5);
        }
        {
          const msl = 12 * dt;
          const qx = child.vel.x - evx, qy = child.vel.y - evy, qz = child.vel.z - evz;
          const ql = Math.hypot(qx, qy, qz);
          if (ql > msl) {
            const qs = msl / ql;
            child.vel.x = evx + qx * qs;
            child.vel.y = evy + qy * qs;
            child.vel.z = evz + qz * qs;
          }
        }
        const mv = chainMoveAxis(child, child.vel.x * dt, child.vel.y * dt, child.vel.z * dt);
        child.onGround = aabbCollidesWorld(child.pos.x, child.pos.y - 0.05, child.pos.z, child.hw, child.h);
        if (inWaterF && (mv.x || mv.z)) {
          const hl = Math.hypot(sx, sz) || 1;
          const px = child.pos.x + (sx / hl) * 0.6, pz = child.pos.z + (sz / hl) * 0.6;
          const fy = Math.floor(child.pos.y);
          let jumped = false;
          for (let by = Math.floor(child.pos.y + child.h); by >= fy && !jumped; by--) {
            for (let bz = Math.floor(pz - child.hw); bz <= Math.floor(pz + child.hw) && !jumped; bz++) {
              if (isSolid(Math.floor(px), by, bz) && (by === fy || by === fy + 1) && mobWaterExitJump(child, Math.floor(px), by, bz)) {
                child._chainJumpT = 0.6;
                jumped = true;
              }
            }
          }
        }
      }
      else if (child.canStep) wolfPhysicsStep(child, dt);
      else mobPhysicsStep(child, dt);
  }
  child.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, child.pos.x));
  child.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, child.pos.z));
  child.pos.y = Math.max(1, Math.min(MAX_Y - 1, child.pos.y));
  if (dim === "end") {
    endClampXZPos(child.pos);
    if (!isFlyingKind(child.kind)) child.pos.y = Math.max(1, Math.min(DRAGON_MAX_Y, child.pos.y));
  }
  sep = chainLinkDelta(carrier, child);
  link.strained = hdOf() > hi + 0.15;
  const cmx = carrier.pos.x, cmy = chainAnchorY(carrier), cmz = carrier.pos.z;
  const hdBand = () => Math.hypot(child.pos.x - cmx, child.pos.z - cmz);
  const airFollow = (link.carrierAirT || 0) > 0.2;
  if (!floats && (airFollow ? sep.d > hi : hdOf() > hi) && (airFollow || hdBand() > hi)) {
    if (airFollow) {
      const nx = sep.dx / sep.d, ny = sep.dy / sep.d, nz = sep.dz / sep.d;
      chainSlideToward(child, cmx + nx * hi, cmy + ny * hi - child.h * 0.5, cmz + nz * hi, 1);
    } else {
      const hd = hdBand(), s = hi / hd;
      chainSlideToward(child, cmx + (child.pos.x - cmx) * s, child.pos.y, cmz + (child.pos.z - cmz) * s, 1);
    }
    sep = chainLinkDelta(carrier, child);
  }
  if (!floats && hdOf() < lo && hdOf() > 1e-6) {
    const nx = sep.dx / sep.d, ny = sep.dy / sep.d, nz = sep.dz / sep.d;
    chainSlideToward(child, cmx + nx * lo, cmy + ny * lo - child.h * 0.5, cmz + nz * lo, 1.5);
    sep = chainLinkDelta(carrier, child);
  }
  if ((airFollow ? sep.d > leash : hdOf() > leash) && (airFollow || hdBand() > leash)) {
    if (airFollow) {
      const nx = sep.dx / sep.d, ny = sep.dy / sep.d, nz = sep.dz / sep.d;
      chainSlideToward(child, cmx + nx * leash, cmy + ny * leash - child.h * 0.5, cmz + nz * leash, 1.5);
    } else {
      const hd = hdBand(), s = leash / hd;
      chainSlideToward(child, cmx + (child.pos.x - cmx) * s, child.pos.y, cmz + (child.pos.z - cmz) * s, 1.5);
    }
    sep = chainLinkDelta(carrier, child);
  }
  if (sep.d > 1e-6 && (link.snapT || 0) > 0) {
    const hd = Math.hypot(sep.dx, sep.dz);
    if (hd > 1e-6 && Math.abs(hd - followDist) > 0.05) {
      const s = followDist / hd;
      const px = carrier.pos.x + sep.dx * s, pz = carrier.pos.z + sep.dz * s;
      if (!aabbCollidesWorld(px, child.pos.y, pz, child.hw, child.h) &&
          birdSegmentFree(child.pos.x, child.pos.y, child.pos.z, px, child.pos.y, pz)) {
        chainSlideToward(child, px, child.pos.y, pz, 1.5);
        sep = chainLinkDelta(carrier, child);
      }
    }
  }
  if (!isAvatar && !isChained(carrier) && !isFlyingKind(carrier.kind) && carrier.vel) {
    if (hdOf() >= leash) {
      const f = Math.max(0, 1 - dt * 10);
      carrier.vel.x *= f;
      carrier.vel.z *= f;
    } else if (link.strained) {
      const f = Math.max(0, 1 - dt * 2.5);
      carrier.vel.x *= f;
      carrier.vel.z *= f;
    }
  }
}
const chainLinkTmp = new THREE.Vector3();

function renderChainLink(link, carrier, child) {
    const ax = carrier.pos.x, ay = chainAnchorY(carrier), az = carrier.pos.z;
    const bx = child.pos.x, by = chainAnchorY(child), bz = child.pos.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    const n = Math.max(4, Math.min(CHAIN_LINK_CUBES, Math.round(dist / 0.15)));
    link.rope.count = n;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;
    let vx = Math.abs(uy) < 0.99 ? uz : 1, vy = Math.abs(uy) < 0.99 ? 0 : 0, vz = Math.abs(uy) < 0.99 ? -ux : 0;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    const baseLen = chainFollowDist(carrier);
    const sag = Math.min(1, Math.max(0, 1 - dist / baseLen) * baseLen * 0.35);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      chainLinkMatrix.setPosition(
        ax + dx * f + vx * Math.sin(f * Math.PI * 4) * 0.15 + wx * Math.sin(f * Math.PI * 2) * 0.15,
        ay + dy * f + vy * Math.sin(f * Math.PI * 4) * 0.15 + wy * Math.sin(f * Math.PI * 2) * 0.15 - Math.sin(f * Math.PI) * sag,
        az + dz * f + vz * Math.sin(f * Math.PI * 4) * 0.15 + wz * Math.sin(f * Math.PI * 2) * 0.15
      );
      link.rope.setMatrixAt(i, chainLinkMatrix);
    }
    link.rope.instanceMatrix.needsUpdate = true;
    link.head.position.set(bx, by, bz);
}

function releaseCarriedMobAt(px, py, pz) {
  if (!carryMob) return;
  if (dim === "end" && endBlockOutsidePlatform(px, pz)) return;
  const m = carryMob;
  const hw = m.hw;
  if (isBirdKind(m.kind) || (isFlyingKind(m.kind) && inMoonZone(px + 0.5, py, pz + 0.5))) {
    let nx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, px + 0.5));
    let nz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, pz + 0.5));
    let ny = Math.max(1, Math.min(MAX_Y - 2, Math.round(py)));
    if (dim === "end") {
      nx = endSquareCoord(nx); nz = endSquareCoord(nz);
    }
    for (let t = 0; t < 8 && aabbCollidesWorld(nx, ny, nz, hw, m.h); t++) ny++;
    if (dim === "nether") { for (let t = 0; t < 12 && birdLavaAt(nx, ny, nz, m); t++) ny++; }
    if (aabbCollidesWorld(nx, ny, nz, hw, m.h)) { nx = m.pos.x; ny = m.pos.y; nz = m.pos.z; }
    m.pos.set(nx, ny, nz);
    m.mesh.position.copy(m.pos);
    m.mesh.rotation.z = 0;
    m.mesh.rotation.x = 0;
    if (m.dim !== undefined) m.dim = dim;
    const yaw2 = Math.random() * Math.PI * 2;
    m.vel.set(Math.cos(yaw2) * BIRD_SPEED, 0, Math.sin(yaw2) * BIRD_SPEED);
    m.onGround = false;
    m.villageBound = false;
    m.speed = BIRD_SPEED;
    m.mode = "straight";
    m.arc = null;
    m.target = birdRandomTarget(m.pos);
    m.perchSpot = null;
    m.perchGroup = null;
    m.perchT = 0;
    m.perchWander = null;
    m.perchWanderT = 0;
  m.perchTimeout = 0;
  m.perchRetry = 0;
  m._decideT = 1.2;
    m.yaw = yaw2;
    m.yawTarget = yaw2;
    m.mesh.visible = true;
    setMobTransparent(m, 1);
    carryMob = null;
    return;
  }
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
  let nx = px + 0.5, nz = pz + 0.5, hintY = py;
  const relStar = starPlatformAt(nx, nz, STAR_PLATFORM_R + 1);
  if (relStar && Math.abs(hintY - relStar.top) < 3) { nx = relStar.x; nz = relStar.z; hintY = relStar.top; }
  if (dim === "end") hintY = Math.max(hintY, END_PLATFORM_TOP + 1);
  const insideVillagePre = dim === "over" && nx >= villageMinX && nx <= villageMaxX && nz >= villageMinZ && nz <= villageMaxZ;
  if (aabbCollidesWorld(nx, hintY, nz, hw, m.h) || mobCollidesOther(m, nx, nz)) {
    let found = false;
    for (let r = 1; r <= 2 && !found; r++) for (let dx = -r; dx <= r && !found; dx++) for (let dz = -r; dz <= r && !found; dz++) {
      if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
      const tx = nx + dx * 0.9, tz = nz + dz * 0.9;
      const th = insideVillagePre ? hintY : groundYForMob(tx, tz, hintY, hw);
      if (!aabbCollidesWorld(tx, th, tz, hw, m.h) && !mobCollidesOther(m, tx, tz)) { nx = tx; nz = tz; hintY = th; found = true; }
    }
    if (!found) hintY += 1;
  }
  m.pos.set(nx, hintY, nz);
  m.mesh.position.copy(m.pos);
  m.mesh.rotation.z = 0;
  m.mesh.rotation.x = 0;
  if (m.dim !== undefined) m.dim = dim;
  if (m.kind === "enderman") {
    m.baseY = hintY;
    m.teleportT = 3 + Math.random() * 7;
    m.lookT = 0;
    m.angry = 0;
    if (!endermen.includes(m)) endermen.push(m);
  }
  m.vel.set(0, 0, 0);
  m.onGround = false;
  const insideVillage = dim === "over" && nx >= villageMinX && nx <= villageMaxX && nz >= villageMinZ && nz <= villageMaxZ;
  m.villageBound = insideVillage;
  if (dim !== "over") m.penBound = false;
  m.speed = WALK / 2;
  if (dim === "over" && mobOnRoofLevel(hintY) && houseAtRoof(nx, nz)) {
    m.mode = "wander";
    m.target = wanderGoalForRoof(m);
  } else if (insideVillage) {
    m.mode = "wander";
    let sx = nx + fwdX * 6, sz = nz + fwdZ * 6;
    sx = Math.max(villageMinX + 1, Math.min(villageMaxX - 1, sx));
    sz = Math.max(villageMinZ + 1, Math.min(villageMaxZ - 1, sz));
    const py2 = villageCenter.y + 1;
    if (mobBlockedAt(sx, sz, hw, py2) || aabbCollidesWorld(sx, py2, sz, hw, m.h)) {
      let ox = nx - fwdX * 6, oz = nz - fwdZ * 6;
      ox = Math.max(villageMinX + 1, Math.min(villageMaxX - 1, ox));
      oz = Math.max(villageMinZ + 1, Math.min(villageMaxZ - 1, oz));
      if (!mobBlockedAt(ox, oz, hw, py2) && !aabbCollidesWorld(ox, py2, oz, hw, m.h)) { sx = ox; sz = oz; }
    }
    m.target = { x: sx, z: sz };
  } else {
    m.mode = "wander";
    let sx = nx + fwdX * 6, sz = nz + fwdZ * 6;
    let gy = groundYForMob(sx, sz, hintY, hw);
    if (aabbCollidesWorld(sx, gy, sz, hw, m.h) || !hasMobGround(sx, sz, hw, gy)) {
      let ox = nx - fwdX * 6, oz = nz - fwdZ * 6;
      let gy2 = groundYForMob(ox, oz, hintY, hw);
      if (!aabbCollidesWorld(ox, gy2, oz, hw, m.h) && hasMobGround(ox, oz, hw, gy2)) { sx = ox; sz = oz; }
    }
    m.target = { x: sx, z: sz };
  }
  m.wanderT = 3 + Math.random() * 3;
  m.path = null; m.pathKey = null; m.blockedT = 0; m._stuckT = 0;
  if (dim === "end" && !isBirdKind(m.kind)) {
    endClampXZPos(m.pos); m.mesh.position.copy(m.pos);
    if (m.target) {
      m.target.x = endSquareCoord(m.target.x); m.target.z = endSquareCoord(m.target.z);
    }
  }
  if (m.isBaby) m._followDetourUntil = 0;
  m.mesh.visible = true;
  setMobTransparent(m, 1);
  carryMob = null;
  worldDirty = true;
}

function releaseCarriedMob() {
  if (!carryMob || !currentBlock) return;
  const px = currentBlock.x + currentBlock.face[0];
  const py = currentBlock.y + currentBlock.face[1];
  const pz = currentBlock.z + currentBlock.face[2];
  releaseCarriedMobAt(px, py, pz);
}

function updateCarry(dt) {
  const canHold = started && !loading && !helpOpen;
  const holding = !!carryMob;
  playerArms.visible = holding && canHold;
  if (playerArms.visible) {
    const left = playerArms.getObjectByName("leftArm");
    const right = playerArms.getObjectByName("rightArm");
    if (left && right) {
      left.position.set(-0.22, -0.30, -0.48);
      right.position.set(0.22, -0.30, -0.48);
      left.rotation.set(-0.35, 0.35, -0.25);
      right.rotation.set(-0.35, -0.35, 0.25);
    }
  }
  if (!canHold) {
    if (carryMob) releaseCarriedMob();
    return;
  }
  if (holding && carryMob) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const eye = camera.position;
    const hh = carryMob.h * 0.5;
    const cx = eye.x + fwd.x * CARRY_DIST;
    const cy = eye.y + fwd.y * CARRY_DIST - CARRY_DOWN;
    const cz = eye.z + fwd.z * CARRY_DIST;
    carryMob.pos.set(cx, cy - hh, cz);
    carryMob.mesh.position.copy(carryMob.pos);
    carryMob.mesh.rotation.y = yaw + Math.PI;
    carryMob.mesh.rotation.z = 0;
    carryMob.mesh.rotation.x = 0;
    if (isBirdKind(carryMob.kind)) {
      const squeezed = playerSqueezed();
      carryMob._narrow = squeezed;
      const target = squeezed ? BIRD_NARROW_SCALE : 1;
      const cur = carryMob.mesh.scale.x;
      carryMob.mesh.scale.setScalar(cur + (target - cur) * Math.min(1, dt / 0.05));
    }
    if (carryMob.mesh.userData.legL) {
      carryMob.mesh.userData.legL.rotation.x = 0;
      carryMob.mesh.userData.legR.rotation.x = 0;
    }
  }
}

function startCarryGrabGrapple() {
  if (carryGrappleActive || carryGrappleRetracting || carryGrapplePulling) return false;
  if (carryMob) return false;
  if (!started || loading || helpOpen) return false;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const mob = pickMob(dir);
  if (!mob) return false;
  if (mob.kind === "dragon") { showMsg("The dragon is too powerful to grab"); return false; }
  if (mob.kind === "iron_golem") { showMsg("The iron golem refuses to be carried"); return false; }
  const eye = camera.position;
  const off = getMobHitOffset(eye, dir, mob);
  if (mob.kind === "enderman") carryGrappleOffset.set(0, mob.h * 0.5, 0);
  else if (off) carryGrappleOffset.copy(off);
  else carryGrappleOffset.set(0, mob.h * 0.5, 0);
  const mx = mob.pos.x + carryGrappleOffset.x;
  const my = mob.pos.y + carryGrappleOffset.y;
  const mz = mob.pos.z + carryGrappleOffset.z;
  carryGrappleMob = mob;
  carryGrappleMode = "grab";
  carryGrappleStart.copy(eye);
  carryGrappleTarget.set(mx, my, mz);
  carryGrappleDist = Math.hypot(mx - eye.x, my - eye.y, mz - eye.z);
  if (carryGrappleDist < 0.3) { carryGrappleMob = null; return false; }
  carryGrappleHookPos.copy(eye);
  carryGrappleActive = true;
  carryGrappleRetracting = false;
  carryGrapplePulling = false;
  return true;
}

function startCarryReleaseGrapple() {
  if (carryGrappleActive || carryGrappleRetracting || carryGrapplePulling) return false;
  if (!carryMob) return false;
  if (!started || loading || helpOpen) return false;
  const b = currentBlock;
  const eye = camera.position;
  const fdir = new THREE.Vector3();
  camera.getWorldDirection(fdir);
  const fl = pickFill(camera.position, fdir);
  let useFill = false;
  if (fl) {
    const fd = Math.hypot(fl.x + 0.5 - eye.x, fl.y + 0.5 - eye.y, fl.z + 0.5 - eye.z);
    let bd = Infinity;
    if (b) bd = Math.hypot(b.x + 0.5 - eye.x, b.y + 0.5 - eye.y, b.z + 0.5 - eye.z);
    if (fd < bd) useFill = true;
  }
  if (!b && !useFill) return false;
  let px, py, pz, tx, ty, tz;
  if (useFill) {
    px = fl.x; py = fl.y; pz = fl.z;
    const cx0 = fl.x + 0.5, cy0 = fl.y + 0.5, cz0 = fl.z + 0.5;
    let dx = eye.x - cx0, dy = eye.y - cy0, dz = eye.z - cz0;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    tx = cx0 + dx * MOB_PORTAL_TX_STANDOFF;
    ty = cy0 + dy * MOB_PORTAL_TX_STANDOFF;
    tz = cz0 + dz * MOB_PORTAL_TX_STANDOFF;
    ty = Math.max(1, Math.min(MAX_Y - 1, ty));
    const mh = carryMob ? carryMob.h : 1;
    const mw = carryMob ? carryMob.hw : 0.3;
    for (let t = 0; t < 8 && aabbCollidesWorld(tx, ty - mh * 0.5, tz, mw, mh); t++) {
      tx += dx * 0.5; ty += dy * 0.5; tz += dz * 0.5;
      ty = Math.max(1, Math.min(MAX_Y - 1, ty));
    }
  } else {
    let h = 0;
    while (isSolid(b.x, b.y + h + 1, b.z)) h++;
    if (h <= 1) {
      px = b.x; py = b.y + h + 1; pz = b.z;
      tx = b.x + 0.5; ty = b.y + h + 1.5; tz = b.z + 0.5;
    } else {
      px = b.x + b.face[0]; py = b.y + b.face[1]; pz = b.z + b.face[2];
      tx = px + 0.5; ty = py + 0.5; tz = pz + 0.5;
    }
  }
  if (dim === "end" && endBlockOutsidePlatform(px, pz)) return false;
  carryGrappleBlock = { x: px, y: py, z: pz };
  carryGrappleMode = "release";
  if (carryMob.dim !== undefined) carryMob.dim = dim;
  carryGrappleStart.copy(eye);
  carryGrappleTarget.set(tx, ty, tz);
  carryGrappleDist = Math.hypot(tx - eye.x, ty - eye.y, tz - eye.z);
  if (carryGrappleDist < 0.3) return false;
  carryGrappleHookPos.copy(eye);
  const mob = carryMob;
  carryGrappleMob = mob;
  carryMob = null;
  carryGrappleActive = true;
  carryGrapplePulling = false;
  carryGrappleRetracting = false;
  setMobTransparent(mob, 1);
  return true;
}

function mobPortalCacheFor(d) {
  if (d === "end") { if (!endMobCache) endMobCache = []; return endMobCache; }
  if (d === "nether") { if (!netherMobCache) netherMobCache = []; return netherMobCache; }
  if (!overworldMobCache) overworldMobCache = [];
  return overworldMobCache;
}

function mobPortalDestCells() {
  const banned = new Set();
  if (dim === "end" && !endCleared) return banned;
  for (const pk of worldPortalSets.get(world)) {
    const [px, py, pz] = keyXYZ(pk);
    for (const w of collectEndWins(px, py, pz, 6))
      for (const [x, y, z] of portalFillCells(w, false)) banned.add(x + "," + y + "," + z);
    for (const w of collectNetherWins(px, py, pz, 6))
      for (const [x, y, z] of portalFillCells(w, true)) banned.add(x + "," + y + "," + z);
  }
  return banned;
}

function mobPortalAnchorWin(spot, targetDim) {
  if (targetDim === "end") {
    return findEndWinNear(spot.x, spot.y, spot.z, 24) || endReturnWin || null;
  }
  if (targetDim === "nether") {
    const w = findNetherWinNear(spot.x, spot.y, spot.z, 24);
    if (w) return Object.assign({ nether: true }, w);
    if (netReturnWin) return Object.assign({ orient: "v", face: "z", nether: true }, netReturnWin);
    return null;
  }
  if (typeof overPortalWin !== "undefined" && overPortalWin && portalWinValid(overPortalWin)) return overPortalWin;
  return nearestReturnWin(spot.x, spot.y, spot.z);
}

function mobPortalArrival(mob, spot, targetDim) {
  const hw = mob.hw, h = mob.h;
  const cx = Math.floor(spot.x), cz = Math.floor(spot.z);
  const banned = mobPortalDestCells();
  const inFill = (ix, feetY, iz) => {
    for (let by = Math.floor(feetY); by <= Math.floor(feetY + h - 0.001); by++) {
      if (banned.has(ix + "," + by + "," + iz)) return true;
    }
    return false;
  };
  const win = mobPortalAnchorWin(spot, targetDim);
  const box = win ? portalFrameBBox(win) : null;
  if (isBirdKind(mob.kind)) {
    const lo = birdBandMinFor(targetDim) + 1, hi = birdBandMaxFor(targetDim) - 1;
    let nx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, spot.x));
    let nz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, spot.z));
    if (box) {
      nx = Math.max(box.minX - MOB_PORTAL_ARRIVAL_R, Math.min(box.maxX + MOB_PORTAL_ARRIVAL_R, nx));
      nz = Math.max(box.minZ - MOB_PORTAL_ARRIVAL_R, Math.min(box.maxZ + MOB_PORTAL_ARRIVAL_R, nz));
      nx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, nx));
      nz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, nz));
    }
    let ny = Math.max(lo, Math.min(hi, Math.round(spot.y) + 2));
    if (targetDim === "end") { nx = endSquareCoord(nx); nz = endSquareCoord(nz); }
    for (let t = 0; t < 12 && (aabbCollidesWorld(nx, ny, nz, hw, h) || inFill(Math.floor(nx), ny, Math.floor(nz)) || (targetDim === "nether" && birdLavaAt(nx, ny, nz, null))); t++) ny++;
    ny = Math.max(lo, Math.min(hi, ny));
    return { x: nx, y: ny, z: nz };
  }
  const baseGy = groundYForMob(spot.x, spot.z, spot.y, hw);
  const inR = [], outR = [];
  const x0 = box ? box.minX - 10 : cx - 5, x1 = box ? box.maxX + 10 : cx + 5;
  const z0 = box ? box.minZ - 10 : cz - 5, z1 = box ? box.maxZ + 10 : cz + 5;
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      if (ix < -WORLD_RADIUS + 1 || ix > WORLD_RADIUS - 1 || iz < -WORLD_RADIUS + 1 || iz > WORLD_RADIUS - 1) continue;
      if (ix === Math.floor(spot.x) && iz === Math.floor(spot.z)) continue;
      const gy = groundYForMob(ix + 0.5, iz + 0.5, spot.y, hw);
      if (Math.abs(gy - baseGy) > 1) continue;
      if (box && (gy < box.baseY - MOB_PORTAL_ARRIVAL_R || gy > box.topY + MOB_PORTAL_ARRIVAL_R)) continue;
      if (aabbCollidesWorld(ix + 0.5, gy, iz + 0.5, hw, h)) continue;
      if (inFill(ix, gy, iz)) continue;
      const d = box ? chebDistToBox(ix, iz, box) : 0;
      const cand = { x: ix + 0.5, y: gy, z: iz + 0.5, d };
      if (d <= MOB_PORTAL_ARRIVAL_R) inR.push(cand);
      else outR.push(cand);
    }
  }
  if (inR.length) {
    const c = inR[(Math.random() * inR.length) | 0];
    return { x: c.x, y: c.y, z: c.z };
  }
  if (outR.length) {
    outR.sort((a, b) => a.d - b.d);
    return { x: outR[0].x, y: outR[0].y, z: outR[0].z };
  }
  const down = groundYDown(cx + 0.5, cz + 0.5, spot.y - 1, hw);
  if (down != null && !aabbCollidesWorld(cx + 0.5, down, cz + 0.5, hw, h) && !inFill(cx, down, cz)) {
    let dx = cx + 0.5, dz = cz + 0.5;
    if (targetDim === "end") { dx = endSquareCoord(dx); dz = endSquareCoord(dz); }
    return { x: dx, y: down, z: dz };
  }
  return { x: spot.x, y: spot.y, z: spot.z };
}

function mobPortalPlan(mob, fl) {
  const srcDim = dim;
  const targetDim = srcDim === "over" ? (fl.nether ? "nether" : "end")
    : srcDim === "nether" ? (fl.nether ? "over" : "end")
    : (fl.nether ? "nether" : "over");
  const keepDim = dim, keepWorld = world;
  dim = targetDim; world = worlds[targetDim];
  let arrival;
  try {
    if (targetDim === "end" && !worlds.end.size) { generateEnd(); buildReturnPortal(true); }
    else if (targetDim === "nether" && !worlds.nether.size) { generateNether(); buildNetherPortal(true); }
    let spot;
    if (targetDim === "end") {
      spot = resolveDimArrival(endExit, { spot: { x: END_SPAWN.x, y: END_SPAWN.y, z: END_SPAWN.z }, yaw: 0 }).spot;
    } else if (targetDim === "nether") {
      spot = resolveDimArrival(netherExit, { spot: { x: NETHER_SPAWN.x, y: NETHER_SPAWN.y, z: NETHER_SPAWN.z }, yaw: Math.PI }).spot;
    } else {
      spot = resolveOverworldReturn().spot;
    }
    arrival = mobPortalArrival(mob, spot, targetDim);
  } finally {
    dim = keepDim; world = keepWorld;
  }
  worldDirty = true;
  portalDirty = true;
  return { targetDim, arrival };
}

function startMobPortalTx(mob, b, fl) {
  const plan = mobPortalPlan(mob, fl);
  if (!plan || !plan.arrival) return false;
  mob._portalTx = true;
  mobPortalTx = {
    mob, t: 0, srcDim: dim,
    fromScale: (mob.mesh && mob.mesh.scale.x) || 1,
    basePos: mob.pos.clone(),
    targetDim: plan.targetDim, arrival: plan.arrival,
  };
  setMobTransparent(mob, 1);
  if (carryGrappleCubes) carryGrappleCubes.visible = false;
  if (carryGrappleHead) carryGrappleHead.visible = false;
  return true;
}

function abortMobPortalTx() {
  const tx = mobPortalTx;
  mobPortalTx = null;
  if (!tx) return;
  const mob = tx.mob;
  if (!mob || !mobs.includes(mob)) return;
  mob._portalTx = false;
  if (mob.mesh) mob.mesh.scale.setScalar(tx.fromScale);
  if (tx.basePos) {
    mob.pos.copy(tx.basePos);
    if (mob.mesh) mob.mesh.position.copy(mob.pos);
  }
  if (dim !== tx.srcDim && mob !== carryMob && mob !== carryGrappleMob) {
    carryGrappleMob = null;
    carryMob = mob;
    mob.mode = "carried";
    mob.vel.set(0, 0, 0);
    mob.target = null;
    mob.path = null;
    mob.blockedT = 0; mob._stuckT = 0;
    if (mob.isBaby) mob._followDetourUntil = 0;
    mob.mesh.visible = true;
    setMobTransparent(mob, 0.35);
    playerArms.visible = true;
    worldDirty = true;
  }
}

function tickMobPortalTx(dt) {
  const tx = mobPortalTx;
  const mob = tx && tx.mob;
  if (!mob || !mobs.includes(mob) || mob === carryMob || carryGrappleMob !== mob || carryGrappleMode !== "release" || dim !== tx.srcDim) {
    abortMobPortalTx();
    return;
  }
  tx.t += dt;
  const k = Math.min(1, tx.t / MOB_PORTAL_TX_TIME);
  if (mob.mesh) mob.mesh.scale.setScalar(Math.max(0.001, tx.fromScale * (1 - k * k)));
  if (k >= 1) finishMobPortalTx();
}

function finishMobPortalTx() {
  const tx = mobPortalTx;
  mobPortalTx = null;
  const mob = tx && tx.mob;
  if (!mob || !mobs.includes(mob)) return;
  mob._portalTx = false;
  const kindCode = mobKindCode(mob);
  const look = mobLookIndex(mob);
  const isBaby = !!mob.isBaby && mob.kind === "villager";
  if (mob.mesh) scene.remove(mob.mesh);
  if (mob.fallMesh) scene.remove(mob.fallMesh);
  mobById.delete(mob.id);
  const mi = mobs.indexOf(mob);
  if (mi >= 0) mobs.splice(mi, 1);
  const ei = endermen.indexOf(mob);
  if (ei >= 0) endermen.splice(ei, 1);
  if (birdLock === mob) { birdLock = null; birdLockT = 0; birdLockShots = 0; }
  if (carryGrappleMob === mob) carryGrappleMob = null;
  let cache = mobPortalCacheFor(tx.targetDim);
  if (tx.targetDim === "over" && !cache.length && !mobs.some((m) => mobDimOf(m) === "over")) {
    const keepDim = dim, keepWorld = world;
    dim = "over"; world = worlds.over;
    try {
      const before = mobs.length;
      spawnVillagers();
      spawnBirds();
      for (let i = before; i < mobs.length; i++) mobs[i].mesh.visible = false;
      overworldMobCache = snapshotMobsForDim("over", false);
      cache = overworldMobCache;
    } finally {
      dim = keepDim; world = keepWorld;
    }
  }
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  for (const c of [overworldMobCache, endMobCache, netherMobCache]) {
    if (!c) continue;
    for (const e of c) if (e.id != null && e.id >= gid) gid = e.id + 1;
  }
  const entry = {
    id: gid, kind: kindCode, isBaby, homeId: -1, parentIdx: -1,
    x: tx.arrival.x, y: tx.arrival.y, z: tx.arrival.z,
    yaw: Math.random() * Math.PI * 2, look,
    villageBound: false, penBound: false,
  };
  stripPanicEntries([entry]);
  entry.portalSent = true;
  cache.push(entry);
  worldDirty = true;
}

function chainAttachTarget() {
  chainAttachMode = "behind";
  if ((dim !== "over" && dim !== "end" && dim !== "nether") || !started || loading || helpOpen) return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const mob = pickMob(dir);
  if (!mob || mob === carryMob || mob === carryGrappleMob) return null;
  if ((mob.dim || "over") !== dim) return null;
  const ck = (carryMob && carryMob.kind) || null;
  if (playerInChain() && (mob === grappleMob || chainRootOf(mob) === chainRootOf(grappleMob))) {
    if (mob === grappleMob) {
      if (chainAttachModeFor(ck, mob) === "prepend") {
        chainAttachMode = "prepend";
        return grappleMob;
      }
      chainAttachMode = "playerAhead";
      return playerChainAvatar;
    }
    if (chainParent.get(mob.id) === PLAYER_CHAIN_ID) {
      chainAttachMode = "playerBehind";
      return mob;
    }
    if (!ck) {
      if (mob.kind !== "dragon" && chainRootOf(mob) === mob && chainChild.has(mob.id)) chainAttachMode = "prepend";
      else chainAttachMode = "before";
    } else chainAttachMode = chainAttachModeFor(ck, mob);
    return mob;
  }
  if (mob.kind === "dragon") {
    if (dim !== "end") return null;
    if (!mobs.includes(mob)) return null;
    if (mob === carryMob || mob === carryGrappleMob) return null;
    chainAttachMode = ck ? chainAttachModeFor(ck, mob) : "behind";
    return mob;
  }
  if (mob.kind === "enderman" && !isChained(mob) && !isChainCarrier(mob)) return null;
  if (!ck) {
    if (mob.kind !== "dragon" && chainRootOf(mob) === mob && chainChild.has(mob.id)) chainAttachMode = "prepend";
    else chainAttachMode = "before";
  } else chainAttachMode = chainAttachModeFor(ck, mob);
  return mob;
}

function startCarryAttachGrapple(tail) {
  if (carryGrappleActive || carryGrappleRetracting || carryGrapplePulling) return false;
  if (!carryMob || !tail) return false;
  if (!started || loading || helpOpen) return false;
  const eye = camera.position;
  const mob = carryMob;
  carryGrappleOffset.set(0, mob.h * 0.5, 0);
  carryGrappleMob = mob;
  carryMob = null;
  carryGrappleChainTarget = tail;
  carryGrappleAttachMode = chainAttachMode;
  carryGrappleMode = "attach";
  carryGrappleBlock = null;
  carryGrappleStart.copy(eye);
  carryGrappleTarget.set(tail.pos.x, tail.pos.y + tail.h * 0.5, tail.pos.z);
  carryGrappleDist = Math.hypot(carryGrappleTarget.x - eye.x, carryGrappleTarget.y - eye.y, carryGrappleTarget.z - eye.z);
  if (carryGrappleDist < 0.3) {
    carryMob = mob;
    carryGrappleMob = null;
    carryGrappleChainTarget = null;
    carryGrappleAttachMode = "behind";
    return false;
  }
  carryGrappleHookPos.copy(eye);
  carryGrappleActive = true;
  carryGrapplePulling = false;
  carryGrappleRetracting = false;
  setMobTransparent(mob, 1);
  return true;
}

function updateCarryGrapple(dt) {
  if (carryGrappleRetracting) {
    const eye = new THREE.Vector3(pos.x, pos.y + 0.3, pos.z);
    if (carryGrappleMode === "release" && carryGrappleMob) {
      const mob = carryGrappleMob;
      const dx = eye.x - carryGrappleHookPos.x, dy = eye.y - carryGrappleHookPos.y, dz = eye.z - carryGrappleHookPos.z;
      const d = Math.hypot(dx, dy, dz);
      const step = GRAPPLE_RETRACT * dt;
      if (d <= step + 0.05) {
        carryGrappleHookPos.copy(eye);
        mob.pos.set(eye.x, eye.y - mob.h * 0.5 - 0.4, eye.z);
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 0.35);
        mob.mode = "carried";
        mob.path = null; mob.target = null;
        if (mob.vel) mob.vel.set(0, 0, 0);
        mob.blockedT = 0; mob._stuckT = 0;
        if (mob.isBaby) mob._followDetourUntil = 0;
        carryGrappleMob = null;
        carryMob = mob;
        worldDirty = true;
        carryGrappleRetracting = false;
        carryGrappleCubes.visible = false;
        carryGrappleHead.visible = false;
        carryGrappleBlock = null;
      } else {
        carryGrappleHookPos.x += dx / d * step;
        carryGrappleHookPos.y += dy / d * step;
        carryGrappleHookPos.z += dz / d * step;
        mob.pos.set(carryGrappleHookPos.x - carryGrappleOffset.x, carryGrappleHookPos.y - carryGrappleOffset.y, carryGrappleHookPos.z - carryGrappleOffset.z);
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 1);
      }
      return;
    }
    const dx = eye.x - carryGrappleHookPos.x, dy = eye.y - carryGrappleHookPos.y, dz = eye.z - carryGrappleHookPos.z;
    const d = Math.hypot(dx, dy, dz);
    const step = GRAPPLE_RETRACT * dt;
    if (d <= step + 0.05) {
      carryGrappleRetracting = false;
      carryGrappleCubes.visible = false;
      carryGrappleHead.visible = false;
    } else {
      carryGrappleHookPos.x += dx / d * step;
      carryGrappleHookPos.y += dy / d * step;
      carryGrappleHookPos.z += dz / d * step;
    }
    return;
  }
  if (!carryGrappleActive && !carryGrapplePulling) {
    if (mobPortalTx) tickMobPortalTx(dt);
    return;
  }
  if (!carryGrapplePulling) {
    if (carryGrappleMode === "grab") {
      const mob = carryGrappleMob;
      if (!mob || (mob.dim !== undefined && mob.dim !== dim)) {
        carryGrappleActive = false;
        carryGrappleRetracting = true;
        carryGrappleHookPos.copy(carryGrappleTarget);
        carryGrappleMob = null;
        return;
      }
      const mx = mob.pos.x + carryGrappleOffset.x, my = mob.pos.y + carryGrappleOffset.y, mz = mob.pos.z + carryGrappleOffset.z;
      carryGrappleTarget.set(mx, my, mz);
      const dx0 = mx - carryGrappleHookPos.x, dy0 = my - carryGrappleHookPos.y, dz0 = mz - carryGrappleHookPos.z;
      const dist0 = Math.hypot(dx0, dy0, dz0);
      const hitR = (mob.hw || 0.27) + 0.35;
      const b = grappleVertBoost(pos.y);
      const isVert = Math.abs(carryGrappleTarget.y - carryGrappleStart.y) > 2 * Math.abs(carryGrappleTarget.x - carryGrappleStart.x);
      const tb = isVert ? b : 1;
      const step = MOB_GRAPPLE_THROW * tb * dt;
      if (dist0 <= hitR) {
        carryGrappleHookPos.set(mx, my, mz);
        carryGrappleActive = false;
        carryGrapplePulling = true;
        setMobTransparent(mob, 1);
        if (grappleMob === mob) grabRideForCarry(mob);
        else chainTakeForCarry(mob);
      } else {
        const move = Math.min(step, dist0);
        const s = move / dist0;
        carryGrappleHookPos.x += dx0 * s;
        carryGrappleHookPos.y += dy0 * s;
        carryGrappleHookPos.z += dz0 * s;
      }
      return;
    }
    if (carryGrappleMode === "attach") {
      const mob = carryGrappleMob;
      const tail = carryGrappleChainTarget;
      if (!mob || !tail || !mobs.includes(mob) || (tail !== playerChainAvatar && !mobs.includes(tail))) {
        carryGrappleActive = false;
        carryGrappleRetracting = true;
        carryGrappleHookPos.copy(carryGrappleTarget);
        if (mob && mobs.includes(mob)) {
          carryGrappleMob = null;
          carryMob = mob;
          setMobTransparent(mob, 0.35);
          mob.mode = "carried";
        } else carryGrappleMob = null;
        carryGrappleChainTarget = null;
        carryGrappleAttachMode = "behind";
        return;
      }
      const tx = tail.pos.x, ty = tail.pos.y + tail.h * 0.5, tz = tail.pos.z;
      carryGrappleTarget.set(tx, ty, tz);
      const dx = tx - carryGrappleHookPos.x, dy = ty - carryGrappleHookPos.y, dz = tz - carryGrappleHookPos.z;
      const dist = Math.hypot(dx, dy, dz);
      const b = grappleVertBoost(pos.y);
      const isVert = Math.abs(ty - carryGrappleStart.y) > 2 * Math.abs(tx - carryGrappleStart.x);
      const step = MOB_GRAPPLE_THROW * (isVert ? b : 1) * dt;
      if (dist <= step + 0.05) {
        carryGrappleHookPos.set(tx, ty, tz);
        carryGrappleActive = false;
        carryGrapplePulling = false;
        carryGrappleRetracting = false;
        carryGrappleCubes.visible = false;
        carryGrappleHead.visible = false;
        carryGrappleMob = null;
        carryGrappleChainTarget = null;
        const mode = carryGrappleAttachMode;
        carryGrappleAttachMode = "behind";
        if (mob.dim !== undefined) mob.dim = dim;
        let linked = false;
        if (mode === "playerAhead") linked = insertChainAheadOfPlayer(mob);
        else if (mode === "playerBehind") linked = insertChainBehindPlayer(tail, mob);
        else if (tail === playerChainAvatar) linked = linkChain(tail, mob);
        else if (mode === "prepend") linked = prependChainLead(tail, mob);
        else if (mode === "before") linked = insertChainBefore(tail, mob);
        else linked = insertChainBehind(tail, mob);
        if (!linked) {
          carryMob = mob;
          setMobTransparent(mob, 0.35);
          mob.mode = "carried";
          mob.path = null;
          mob.target = null;
        }
      } else {
        const s = step / dist;
        carryGrappleHookPos.x += dx * s;
        carryGrappleHookPos.y += dy * s;
        carryGrappleHookPos.z += dz * s;
        mob.pos.set(carryGrappleHookPos.x - carryGrappleOffset.x, carryGrappleHookPos.y - carryGrappleOffset.y, carryGrappleHookPos.z - carryGrappleOffset.z);
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 1);
      }
      return;
    }
    if (carryGrappleMode === "release") {
      const mob = carryGrappleMob;
      if (!mob || !carryGrappleBlock || (mob.dim !== undefined && mob.dim !== dim)) {
        carryGrappleActive = false;
        carryGrappleRetracting = true;
        carryGrappleHookPos.copy(carryGrappleTarget);
        if (mob) {
          carryGrappleMob = null;
          carryMob = mob;
          setMobTransparent(mob, 0.35);
        }
        carryGrappleBlock = null;
        return;
      }
      const tx = carryGrappleTarget.x, ty = carryGrappleTarget.y, tz = carryGrappleTarget.z;
      const dx = tx - carryGrappleHookPos.x, dy = ty - carryGrappleHookPos.y, dz = tz - carryGrappleHookPos.z;
      const dist = Math.hypot(dx, dy, dz);
      const b2 = grappleVertBoost(pos.y);
      const isVert2 = Math.abs(carryGrappleTarget.y - carryGrappleStart.y) > 2 * Math.abs(carryGrappleTarget.x - carryGrappleStart.x);
      const tb2 = isVert2 ? b2 : 1;
      const step = MOB_GRAPPLE_THROW * tb2 * dt;
      if (dist <= step + 0.05) {
        carryGrappleHookPos.set(tx, ty, tz);
        mob.pos.set(tx, ty - mob.h * 0.5, tz);
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 1);
        carryGrappleActive = false;
        carryGrapplePulling = true;
      } else {
        const s = step / dist;
        carryGrappleHookPos.x += dx * s;
        carryGrappleHookPos.y += dy * s;
        carryGrappleHookPos.z += dz * s;
        mob.pos.set(carryGrappleHookPos.x - carryGrappleOffset.x, carryGrappleHookPos.y - carryGrappleOffset.y, carryGrappleHookPos.z - carryGrappleOffset.z);
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 1);
      }
      return;
    }
  } else {
    const mob = carryGrappleMob;
    if (!mob) {
      carryGrapplePulling = false;
      carryGrappleActive = false;
      carryGrappleRetracting = true;
      carryGrappleHookPos.copy(carryGrappleTarget);
      return;
    }
    if (carryGrappleMode === "grab") {
      if (mob.dim !== undefined && mob.dim !== dim) {
        carryGrappleMob = null;
        carryGrapplePulling = false;
        carryGrappleActive = false;
        carryGrappleRetracting = true;
        carryGrappleHookPos.copy(carryGrappleTarget);
        return;
      }
      const eye = new THREE.Vector3(pos.x, pos.y + 0.3, pos.z);
      const dx = eye.x - mob.pos.x, dy = eye.y - mob.pos.y, dz = eye.z - mob.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = MOB_GRAPPLE_RETRACT * dt;
      if (dist <= step + 0.15) {
        mob.pos.copy(eye);
        mob.pos.y -= mob.h * 0.5 + 0.4;
        mob.mesh.position.copy(mob.pos);
        setMobTransparent(mob, 0.35);
        carryMob = mob;
        mob.mode = "carried";
        mob.path = null; mob.target = null;
        if (mob.vel) mob.vel.set(0, 0, 0);
        mob.blockedT = 0; mob._stuckT = 0;
        if (mob.isBaby) mob._followDetourUntil = 0;
        carryGrapplePulling = false;
        carryGrappleActive = false;
        carryGrappleCubes.visible = false;
        carryGrappleHead.visible = false;
        carryGrappleMob = null;
      } else {
        const s = step / dist;
        mob.pos.x += dx * s;
        mob.pos.y += dy * s;
        mob.pos.z += dz * s;
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 1);
        carryGrappleHookPos.set(mob.pos.x + carryGrappleOffset.x, mob.pos.y + carryGrappleOffset.y, mob.pos.z + carryGrappleOffset.z);
      }
    } else {
      if (mob.dim !== undefined && mob.dim !== dim) {
        carryGrappleMob = null;
        carryGrapplePulling = false;
        carryGrappleActive = false;
        carryGrappleRetracting = false;
        carryGrappleBlock = null;
        carryMob = mob;
        setMobTransparent(mob, 0.35);
        mob.mode = "carried"; mob.path = null; mob.target = null;
        if (mob.vel) mob.vel.set(0, 0, 0);
        mob.blockedT = 0; mob._stuckT = 0;
        if (mob.isBaby) mob._followDetourUntil = 0;
        carryGrappleCubes.visible = false;
        carryGrappleHead.visible = false;
        return;
      }
      const tx = carryGrappleTarget.x, ty = carryGrappleTarget.y, tz = carryGrappleTarget.z;
      const dx = tx - mob.pos.x, dy = ty - mob.pos.y, dz = tz - mob.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = MOB_GRAPPLE_RETRACT * dt;
      if (dist <= step + 0.15) {
        const b = carryGrappleBlock;
        carryGrappleMob = null;
        carryGrapplePulling = false;
        carryGrappleActive = false;
        carryMob = mob;
        setMobTransparent(mob, 1);
        if (b) {
          carryGrappleBlock = null;
          carryGrappleHookPos.copy(carryGrappleTarget);
          const fl = fillAt(b.x, b.y, b.z);
          if (fl && !(dim === "end" && !endCleared) && startMobPortalTx(mob, b, fl)) {
            carryGrappleMob = mob;
            carryMob = null;
          } else {
            releaseCarriedMobAt(b.x, b.y, b.z);
            carryGrappleRetracting = true;
          }
        } else {
          mob.pos.set(tx, ty - mob.h * 0.5, tz);
          mob.mesh.position.copy(mob.pos);
          setMobTransparent(mob, 1);
          carryGrappleRetracting = true;
        }
      } else {
        const s = step / dist;
        mob.pos.x += dx * s;
        mob.pos.y += dy * s;
        mob.pos.z += dz * s;
        mob.mesh.position.copy(mob.pos);
        mob.mesh.rotation.y = yaw + Math.PI;
        setMobTransparent(mob, 1);
        carryGrappleHookPos.set(mob.pos.x + carryGrappleOffset.x, mob.pos.y + carryGrappleOffset.y, mob.pos.z + carryGrappleOffset.z);
      }
    }
  }
}

function handleCarryEnterDown() {
  if (carryGrappleActive || carryGrapplePulling || carryGrappleRetracting) return;
  if (carryMob) {
    const tail = chainAttachTarget();
    if (tail) {
      if (!startCarryAttachGrapple(tail)) startCarryReleaseGrapple();
    } else {
      startCarryReleaseGrapple();
    }
  } else {
    startCarryGrabGrapple();
  }
}

function handleCarryEnterUp() {
  if (carryGrappleRetracting) return;
  if (carryGrappleActive && !carryGrapplePulling) {
    if (carryGrappleMode === "grab") {
      carryGrappleActive = false;
      carryGrappleRetracting = true;
      carryGrappleMob = null;
    } else if (carryGrappleMode === "release") {
      carryGrappleActive = false;
      carryGrappleRetracting = true;
      carryGrappleBlock = null;
      const mob = carryGrappleMob;
      if (mob) setMobTransparent(mob, 1);
    } else if (carryGrappleMode === "attach") {
      const mob = carryGrappleMob;
      carryGrappleActive = false;
      carryGrappleRetracting = true;
      carryGrappleChainTarget = null;
      carryGrappleAttachMode = "behind";
      if (mob) {
        carryGrappleMob = null;
        carryMob = mob;
        setMobTransparent(mob, 0.35);
        mob.mode = "carried";
        mob.path = null;
        mob.target = null;
      }
    }
  } else if (carryGrapplePulling) {
    const mob = carryGrappleMob;
    if (!mob) {
      carryGrapplePulling = false;
      carryGrappleRetracting = true;
      return;
    }
    if (carryGrappleMode === "grab") {
      return;
    } else if (carryGrappleMode === "release") {
      carryGrapplePulling = false;
      carryGrappleActive = false;
      carryGrappleRetracting = true;
      carryGrappleHookPos.set(mob.pos.x + carryGrappleOffset.x, mob.pos.y + carryGrappleOffset.y, mob.pos.z + carryGrappleOffset.z);
      carryGrappleBlock = null;
      setMobTransparent(mob, 1);
    }
  }
}

function randomVillagePoint() {
  for (let t = 0; t < 30; t++) {
    const x = villageMinX + 2 + Math.random() * (villageMaxX - villageMinX - 4);
    const z = villageMinZ + 2 + Math.random() * (villageMaxZ - villageMinZ - 4);
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (isInsidePenPool(x, z)) continue;
    if (mobBlockedAt(x, z, 0.27, villageCenter.y + 1)) continue;
    if (x < villageMinX + 1 || x > villageMaxX - 1 || z < villageMinZ + 1 || z > villageMaxZ - 1) continue;
    return { x, z };
  }
  return { x: villageCenter.x, z: villageCenter.z };
}
function randomInsidePoint(homeId) {
  const h = villageHouses[homeId];
  if (!h) return randomVillagePoint();
  for (let t = 0; t < 30; t++) {
    const x = h.minX + 1.2 + Math.random() * (h.maxX - h.minX - 2.4);
    const z = h.minZ + 1.2 + Math.random() * (h.maxZ - h.minZ - 2.4);
    if (mobBlockedAt(x, z, 0.27, villageCenter.y + 1)) continue;
    return { x, z };
  }
  return { x: h.cx, z: h.cz };
}
function wanderNear(m) {
  for (let t = 0; t < 8; t++) {
    const ax = m.pos.x + (Math.random() - 0.5) * 10;
    const az = m.pos.z + (Math.random() - 0.5) * 10;
    if (aabbCollidesWorld(ax, m.pos.y, az, m.hw, m.h)) continue;
    if (!hasMobGround(ax, az, m.hw, m.pos.y)) continue;
    return { x: ax, z: az };
  }
  return { x: m.pos.x + (Math.random() - 0.5) * 4, z: m.pos.z + (Math.random() - 0.5) * 4 };
}
function settleNearBonus(m, dCur) {
  if (!m || !m._settleUntil) return 0;
  if (performance.now() / 1000 >= m._settleUntil) return 0;
  return dCur * 1.5;
}
function wanderGoalFor(m) {
  if (dim !== "over") return wanderNear(m);
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 30; t++) {
    const x = villageMinX + 2 + Math.random() * (villageMaxX - villageMinX - 4);
    const z = villageMinZ + 2 + Math.random() * (villageMaxZ - villageMinZ - 4);
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (isInsidePenPool(x, z)) continue;
    if (x < villageMinX + 1 || x > villageMaxX - 1 || z < villageMinZ + 1 || z > villageMaxZ - 1) continue;
    if (mobBlockedAt(x, z, m.hw, villageCenter.y + 1, m.h)) continue;
    if (aabbCollidesWorld(x, villageCenter.y + 1, z, m.hw, m.h)) continue;
    const ix = Math.floor(x), iz = Math.floor(z);
    const dCur = Math.hypot(ix - m.pos.x, iz - m.pos.z);
    if (dCur < 2) continue;
    if (m.lastTarget && Math.hypot(ix - m.lastTarget.x, iz - m.lastTarget.z) < 4) continue;
    const v = getVisit(ix, iz);
    let mobPenalty = 0;
    for (const o of mobs) {
      if (o === m || (o.dim !== undefined && o.dim !== dim)) continue;
      if (o.kind === "pig" || o.kind === "cow" || o.kind === "wolf") continue;
      const d = Math.hypot(ix - o.pos.x, iz - o.pos.z);
      if (d < 1.8) mobPenalty += (1.8 - d) * 7;
      if (o.target) {
        const td = Math.hypot(ix - o.target.x, iz - o.target.z);
        if (td < 1.4) mobPenalty += (1.4 - td) * 5;
      }
    }
    const score = v * 10 - dCur * 0.15 + mobPenalty + settleNearBonus(m, dCur);
    if (score < bestScore) { bestScore = score; best = { x, z }; }
  }
  if (best) { m.lastTarget = { x: best.x, z: best.z }; return best; }
  for (let t = 0; t < 30; t++) {
    const x = villageMinX + 2 + Math.random() * (villageMaxX - villageMinX - 4);
    const z = villageMinZ + 2 + Math.random() * (villageMaxZ - villageMinZ - 4);
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (isInsidePenPool(x, z)) continue;
    if (mobBlockedAt(x, z, 0.27, villageCenter.y + 1)) continue;
    return { x, z };
  }
  return { x: villageCenter.x, z: villageCenter.z };
}
function wanderGoalForRoof(m) {
  const h = houseAtRoof(m.pos.x, m.pos.z);
  if (!h) return wanderGoalFor(m);
  const roofY = h.vy + 6;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 30; t++) {
    const x = h.minX + Math.random() * (h.maxX - h.minX + 1);
    const z = h.minZ + Math.random() * (h.maxZ - h.minZ + 1);
    const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
    if (houseAtRoof(cx, cz) !== h) continue;
    const bx = Math.floor(cx), bz = Math.floor(cz);
    if (bx !== h.minX && bx !== h.maxX && bz !== h.minZ && bz !== h.maxZ) continue;
    if (cx - m.hw < h.minX || cx + m.hw > h.maxX + 1 || cz - m.hw < h.minZ || cz + m.hw > h.maxZ + 1) continue;
    if (aabbCollidesWorld(cx, roofY, cz, m.hw, m.h)) continue;
    if (!hasMobGround(cx, cz, m.hw, roofY)) continue;
    const dCur = Math.hypot(cx - m.pos.x, cz - m.pos.z);
    if (dCur < 1.2) continue;
    if (m.lastTarget && Math.hypot(cx - m.lastTarget.x, cz - m.lastTarget.z) < 2) continue;
    const v = getVisit(cx | 0, cz | 0);
    let mobPenalty = 0;
    for (const o of mobs) {
      if (o === m || (o.dim !== undefined && o.dim !== dim)) continue;
      if (houseAtRoof(o.pos.x, o.pos.z) !== h) continue;
      const d = Math.hypot(cx - o.pos.x, cz - o.pos.z);
      if (d < 1.9) mobPenalty += (1.9 - d) * 8;
      if (o.target && houseAtRoof(o.target.x, o.target.z) === h) {
        const td = Math.hypot(cx - o.target.x, cz - o.target.z);
        if (td < 1.6) mobPenalty += (1.6 - td) * 6;
      }
    }
    const score = v * 10 - dCur * 0.15 + mobPenalty;
    if (score < bestScore) { bestScore = score; best = { x: cx, z: cz }; }
  }
  if (best) { m.lastTarget = { x: best.x, z: best.z }; return best; }
  for (let t = 0; t < 20; t++) {
    const x = h.minX + Math.random() * (h.maxX - h.minX + 1);
    const z = h.minZ + Math.random() * (h.maxZ - h.minZ + 1);
    const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
    if (houseAtRoof(cx, cz) !== h) continue;
    const bx = Math.floor(cx), bz = Math.floor(cz);
    if (bx !== h.minX && bx !== h.maxX && bz !== h.minZ && bz !== h.maxZ) continue;
    if (cx - m.hw < h.minX || cx + m.hw > h.maxX + 1 || cz - m.hw < h.minZ || cz + m.hw > h.maxZ + 1) continue;
    if (aabbCollidesWorld(cx, roofY, cz, m.hw, m.h)) continue;
    if (!hasMobGround(cx, cz, m.hw, roofY)) continue;
    return { x: cx, z: cz };
  }
  return { x: m.pos.x, z: m.pos.z };
}
function randomPenPoint() {
  if (!villagePen) return randomVillagePoint();
  const p = villagePen;
  for (let t = 0; t < 30; t++) {
    const x = p.minX + 1.5 + Math.random() * (p.maxX - p.minX - 3);
    const z = p.minZ + 1.5 + Math.random() * (p.maxZ - p.minZ - 3);
    const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
    if (isInsidePenPool(cx, cz)) continue;
    if (isInsidePen(cx, cz) && !mobBlockedAt(cx, cz, 0.32, villageCenter.y + 1) && !aabbCollidesWorld(cx, villageCenter.y + 1, cz, 0.32, 1.1)) return { x: cx, z: cz };
  }
  return { x: villagePen.cx + 0.5, z: villagePen.cz + 0.5 };
}
function wanderGoalForPen(m) {
  if (dim !== "over" || !villagePen) return dim !== "over" ? wanderNear(m) : wanderGoalFor(m);
  const p = villagePen;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 30; t++) {
    const x = p.minX + 1.5 + Math.random() * (p.maxX - p.minX - 3);
    const z = p.minZ + 1.5 + Math.random() * (p.maxZ - p.minZ - 3);
    const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
    if (isInsidePenPool(cx, cz)) continue;
    if (isInsidePen(cx, cz) && mobBlockedAt(cx, cz, m.hw, villageCenter.y + 1)) continue;
    if (aabbCollidesWorld(cx, villageCenter.y + 1, cz, m.hw, m.h)) continue;
    // keep strictly inside fence interior (1 block inset)
    if (cx <= p.minX + 0.7 || cx >= p.maxX - 0.7 || cz <= p.minZ + 0.7 || cz >= p.maxZ - 0.7) continue;
    const dCur = Math.hypot(cx - m.pos.x, cz - m.pos.z);
    if (dCur < 1.2) continue;
    if (m.lastTarget && Math.hypot(cx - m.lastTarget.x, cz - m.lastTarget.z) < 2) continue;
    const v = getVisit(cx | 0, cz | 0);
    let mobPenalty = 0;
    for (const o of mobs) {
      if (o === m || (o.dim !== undefined && o.dim !== dim)) continue;
      if (o.kind !== "pig" && o.kind !== "cow") continue;
      const d = Math.hypot(cx - o.pos.x, cz - o.pos.z);
      if (d < 1.9) mobPenalty += (1.9 - d) * 8;
      if (o.target) {
        const td = Math.hypot(cx - o.target.x, cz - o.target.z);
        if (td < 1.6) mobPenalty += (1.6 - td) * 6;
      }
    }
    const score = v * 10 - dCur * 0.15 + mobPenalty + settleNearBonus(m, dCur);
    if (score < bestScore) { bestScore = score; best = { x: cx, z: cz }; }
  }
  if (best) { m.lastTarget = { x: best.x, z: best.z }; return best; }
  for (let t = 0; t < 20; t++) {
    const x = p.minX + 1.5 + Math.random() * (p.maxX - p.minX - 3);
    const z = p.minZ + 1.5 + Math.random() * (p.maxZ - p.minZ - 3);
    const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
    if (isInsidePenPool(cx, cz)) continue;
    if (mobBlockedAt(cx, cz, m.hw, villageCenter.y + 1)) continue;
    if (aabbCollidesWorld(cx, villageCenter.y + 1, cz, m.hw, m.h)) continue;
    return { x: cx, z: cz };
  }
  return { x: p.cx + 0.5, z: p.cz + 0.5 };
}
function findPenGaps() {
  if (!villagePen) return [];
  const p = villagePen, vy = p.vy, gaps = [];
  for (let x = p.minX; x <= p.maxX; x++) for (let z = p.minZ; z <= p.maxZ; z++) {
    const onEdge = x === p.minX || x === p.maxX || z === p.minZ || z === p.maxZ;
    if (!onEdge) continue;
    if (getBlock(x, vy + 1, z) === AIR) gaps.push({ x, z });
  }
  return gaps;
}
function nearestPenGap(x, z) {
  const gaps = findPenGaps();
  if (!gaps.length) return null;
  let best = null, bestD2 = Infinity;
  for (const g of gaps) {
    const dx = g.x + 0.5 - x, dz = g.z + 0.5 - z;
    const d2 = dx*dx + dz*dz;
    if (d2 < bestD2) { bestD2 = d2; best = g; }
  }
  return best;
}
function penGapInside(gap) {
  if (!gap || !villagePen) return null;
  const p = villagePen;
  // one block inside the pen just behind the gap
  let ix = gap.x, iz = gap.z;
  if (gap.x === p.minX) ix = gap.x + 1;
  else if (gap.x === p.maxX) ix = gap.x - 1;
  else if (gap.z === p.minZ) iz = gap.z + 1;
  else if (gap.z === p.maxZ) iz = gap.z - 1;
  return { x: ix + 0.5, z: iz + 0.5 };
}
function penGapOutside(gap) {
  if (!gap || !villagePen) return null;
  const p = villagePen;
  let ox = gap.x, oz = gap.z;
  if (gap.x === p.minX) ox = gap.x - 1;
  else if (gap.x === p.maxX) ox = gap.x + 1;
  else if (gap.z === p.minZ) oz = gap.z - 1;
  else if (gap.z === p.maxZ) oz = gap.z + 1;
  return { x: ox + 0.5, z: oz + 0.5 };
}
function randomAroundPenPoint(m) {
  if (!villagePen) return wanderGoalFor(m);
  const p = villagePen;
  for (let t = 0; t < 24; t++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.max(VILLAGE_PEN_W, VILLAGE_PEN_D) / 2 + 2.5 + Math.random() * 3;
    const cx = p.cx + 0.5 + Math.cos(ang) * rad;
    const cz = p.cz + 0.5 + Math.sin(ang) * rad;
    const x = Math.floor(cx) + 0.5, z = Math.floor(cz) + 0.5;
    if (x < villageMinX + 1 || x > villageMaxX - 1 || z < villageMinZ + 1 || z > villageMaxZ - 1) continue;
    if (isInsidePen(x, z)) continue;
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (mobBlockedAt(x, z, m ? m.hw : 0.32, villageCenter.y + 1)) continue;
    if (aabbCollidesWorld(x, villageCenter.y + 1, z, m ? m.hw : 0.32, m ? m.h : 1.0)) continue;
    return { x, z };
  }
  // fallback: random point outside pen but nearby
  for (let t = 0; t < 16; t++) {
    const x = p.minX - 3 + Math.random() * (p.maxX - p.minX + 6);
    const z = p.minZ - 3 + Math.random() * (p.maxZ - p.minZ + 6);
    const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
    if (isInsidePen(cx, cz)) continue;
    if (isInsidePool(cx, cz)) continue;
    if (mobBlockedAt(cx, cz, 0.32, villageCenter.y + 1)) continue;
    return { x: cx, z: cz };
  }
  return wanderGoalFor(m);
}
function fleePointAway(mob, cx, cz) {
  let dx = mob.pos.x - cx, dz = mob.pos.z - cz;
  let len = Math.hypot(dx, dz);
  if (len < 0.15) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); len = 1; } else { dx /= len; dz /= len; }
  const probeFree = mob.canStep ? wolfProbeFree : mobProbeFree;
  const hasGround = mob.canStep ? wolfHasMobGround : hasMobGround;
  const baseAng = Math.atan2(dz, dx);
  for (let attempt = 0; attempt < 10; attempt++) {
    const angOff = (Math.random() - 0.5) * 1.0;
    const ang = baseAng + angOff;
    const dist = 7 + Math.random() * 7;
    const tx = mob.pos.x + Math.cos(ang) * dist;
    const tz = mob.pos.z + Math.sin(ang) * dist;
    if (Math.abs(tx) > WORLD_RADIUS - 1 || Math.abs(tz) > WORLD_RADIUS - 1) continue;
    if (dim === "over") {
      if (isInsideAnyHouse(tx, tz)) continue;
      if (isInsidePool(tx, tz)) continue;
      if (isInsidePenPool(tx, tz)) continue;
    }
    const py = mob.pos.y;
    if (aabbCollidesWorld(tx, py, tz, mob.hw, mob.h)) continue;
    let okGround = hasGround(tx, tz, mob.hw, py);
    if (!okGround) {
      if (hasGround(tx, tz, mob.hw, py + 1) || hasGround(tx, tz, mob.hw, py - 1)) okGround = true;
      else continue;
    }
    const d = Math.hypot(tx - mob.pos.x, tz - mob.pos.z);
    const free = probeFree(mob.pos.x, mob.pos.z, (tx - mob.pos.x) / d, (tz - mob.pos.z) / d, Math.min(d, 7), mob.hw, py);
    if (free < d * 0.55) continue;
    return { x: tx, z: tz };
  }
  const tx2 = mob.pos.x + dx * 6, tz2 = mob.pos.z + dz * 6;
  const py2 = mob.pos.y;
  const hasGround2 = mob.canStep ? wolfHasMobGround : hasMobGround;
  if ((dim !== "over" || (!isInsidePool(tx2, tz2) && !isInsidePenPool(tx2, tz2))) && Math.abs(tx2) <= WORLD_RADIUS - 1 && Math.abs(tz2) <= WORLD_RADIUS - 1 && !aabbCollidesWorld(tx2, py2, tz2, mob.hw, mob.h) && (hasGround2(tx2, tz2, mob.hw, py2) || hasGround2(tx2, tz2, mob.hw, py2 + 1) || hasGround2(tx2, tz2, mob.hw, py2 - 1))) return { x: tx2, z: tz2 };
  return { x: mob.pos.x + dx * 3 + (Math.random() - 0.5), z: mob.pos.z + dz * 3 + (Math.random() - 0.5) };
}
function hasMobGround(x, z, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const gy = Math.floor(py) - 1;
  if (gy < 0) return false;
  const onRoof = mobOnRoofLevel(py) && !!houseAtRoof(x, z);
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
  for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
    const ox0 = Math.max(x - hw, bx), ox1 = Math.min(x + hw, bx + 1);
    const oz0 = Math.max(z - hw, bz), oz1 = Math.min(z + hw, bz + 1);
    if (ox1 - ox0 > 0.02 && oz1 - oz0 > 0.02) {
      const gyBlock = getBlock(bx, gy, bz);
      const gyIsWater = gyBlock === WATER || gyBlock === LAVA || gyBlock === MOON_WATER;
      if (isSolid(bx, gy, bz)) {
        if (villagePen && gyBlock === LOG && (bx === villagePen.minX || bx === villagePen.maxX || bz === villagePen.minZ || bz === villagePen.maxZ)) return false;
        if (dim === "over" && !onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) return false;
        }
      } else if (!gyIsWater) {
        return false;
      } else {
        if (dim === "over" && !onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) return false;
        }
      }
    }
  }
  return true;
}
function mobBlockedAt(x, z, hw, y, h) {
  const py = y != null ? y : villageCenter.y + 1;
  const hh = h != null ? h : (hw <= 0.18 ? 0.98 : 1.82);
  if (aabbCollidesWorld(x, py, z, hw, hh)) return true;
  if (!hasMobGround(x, z, hw, py)) return true;
  return false;
}
function mobProbeFree(x, z, dirX, dirZ, maxDist, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const h = hw >= GOLEM_HW ? GOLEM_HH : (hw <= 0.18 ? 0.98 : 1.82);
  const startInside = x >= villageMinX && x <= villageMaxX && z >= villageMinZ && z <= villageMaxZ;
  const startHasGround = hasMobGround(x, z, hw, py);
  const steps = Math.ceil(maxDist / 0.28);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps * maxDist;
    const px = x + dirX * t, pz = z + dirZ * t;
    if (aabbCollidesWorld(px, py, pz, hw, h)) return (s - 1) / steps * maxDist;
    if (!hasMobGround(px, pz, hw, py)) {
      if (startHasGround) return (s - 1) / steps * maxDist;
    }
    if (startInside && (px < villageMinX + 0.7 || px > villageMaxX - 0.7 || pz < villageMinZ + 0.7 || pz > villageMaxZ - 0.7)) return (s - 1) / steps * maxDist;
  }
  return maxDist;
}
function wolfHasMobGround(x, z, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const gy = Math.floor(py) - 1;
  if (gy < 0) return false;
  const onRoof = mobOnRoofLevel(py) && !!houseAtRoof(x, z);
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
  for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
    const ox0 = Math.max(x - hw, bx), ox1 = Math.min(x + hw, bx + 1);
    const oz0 = Math.max(z - hw, bz), oz1 = Math.min(z + hw, bz + 1);
    if (ox1 - ox0 > 0.02 && oz1 - oz0 > 0.02) {
      const gyBlock = getBlock(bx, gy, bz);
      const gyIsWater = gyBlock === WATER || gyBlock === LAVA || gyBlock === MOON_WATER;
      if (isSolid(bx, gy, bz)) {
        if (dim === "over" && !onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        return true;
      } else if (gyIsWater) {
        if (dim === "over" && !onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        return true;
      }
    }
  }
  return false;
}
function wolfBlockedAt(x, z, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const hh = 0.90;
  const blocked = aabbCollidesWorld(x, py, z, hw, hh);
  const hasGround = wolfHasMobGround(x, z, hw, py);
  if (!blocked && hasGround) return false;
  if (blocked) {
    if (!aabbCollidesWorld(x, py + 1, z, hw, hh) && wolfHasMobGround(x, z, hw, py + 1)) return false;
    if (villagePen && py === villagePen.vy + 1) {
      const bx = Math.floor(x), bz = Math.floor(z);
      if (getBlock(bx, py, bz) === LOG) {
        if (!aabbCollidesWorld(x, py + 1, z, hw, hh) && wolfHasMobGround(x, z, hw, py + 1)) return false;
      }
    }
  } else if (!hasGround) {
    if (wolfHasMobGround(x, z, hw, py - 1) && !aabbCollidesWorld(x, py - 1, z, hw, hh)) return false;
  }
  return true;
}
function wolfProbeFree(x, z, dirX, dirZ, maxDist, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const steps = Math.ceil(maxDist / 0.28);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps * maxDist;
    const px = x + dirX * t, pz = z + dirZ * t;
    if (px < -WORLD_RADIUS + 1 || px > WORLD_RADIUS - 1 || pz < -WORLD_RADIUS + 1 || pz > WORLD_RADIUS - 1) return (s - 1) / steps * maxDist;
    if (wolfBlockedAt(px, pz, hw, py)) return (s - 1) / steps * maxDist;
  }
  return maxDist;
}
function mobCanStep(m){ return !!m.canStep; }
function mobHasGroundFor(m,x,z,hw,y){ return m.canStep ? wolfHasMobGround(x,z,hw,y) : hasMobGround(x,z,hw,y); }
function mobBlockedAtFor(m,x,z,hw,y){ return m.canStep ? wolfBlockedAt(x,z,hw,y) : mobBlockedAt(x,z,hw,y); }
function mobProbeFreeFor(m,x,z,dx,dz,d,hw,y){ return m.canStep ? wolfProbeFree(x,z,dx,dz,d,hw,y) : mobProbeFree(x,z,dx,dz,d,hw,y); }
function isPigCow(m){ return m.kind === "pig" || m.kind === "cow"; }
function pigOverlapsFence(x,z,hw){
  if(!villagePen) return false;
  const vy=villagePen.vy+1;
  for(let bx=Math.floor(x-hw); bx<=Math.floor(x+hw); bx++){
    for(let bz=Math.floor(z-hw); bz<=Math.floor(z+hw); bz++){
      const onBorder=(bx===villagePen.minX || bx===villagePen.maxX || bz===villagePen.minZ || bz===villagePen.maxZ);
      if(!onBorder) continue;
      if(bx < villagePen.minX || bx > villagePen.maxX || bz < villagePen.minZ || bz > villagePen.maxZ) continue;
      if(getBlock(bx, vy, bz) !== LOG) continue;
      if(x+hw > bx && x-hw < bx+1 && z+hw > bz && z-hw < bz+1) return true;
    }
  }
  return false;
}
function pigFenceSlideOut(mob) {
  const pen = villagePen;
  if (!pen) return false;
  const dx = (pen.cx + 0.5) - mob.pos.x, dz = (pen.cz + 0.5) - mob.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  for (let s = 0.1; s <= 2.0; s += 0.1) {
    const nx = mob.pos.x + ux * s, nz = mob.pos.z + uz * s;
    if (!pigOverlapsFence(nx, nz, mob.hw) && !aabbCollidesWorld(nx, mob.pos.y, nz, mob.hw, mob.h)) {
      mob.pos.x = nx; mob.pos.z = nz;
      mob.vel.x = 0; mob.vel.z = 0; mob.vel.y = 0;
      mob.onGround = true;
      if (mobStats) mobStats.worldCol++;
      return true;
    }
  }
  mob.pos.x = pen.cx + 0.5;
  mob.pos.z = pen.cz + 0.5;
  mob.pos.y = pen.vy + 1;
  mob.vel.x = 0; mob.vel.z = 0; mob.vel.y = 0;
  mob.onGround = true;
  if (mobStats) mobStats.worldCol++;
  return true;
}
function wolfFindPath(sx, sz, tx, tz, hw, pyHint) {
  if (hw == null) hw = 0.30;
  const py = pyHint != null ? pyHint : villageCenter.y + 1;
  const toKey = (x, z) => x + "," + z;
  const s = [Math.floor(sx), Math.floor(sz)], g = [Math.floor(tx), Math.floor(tz)];
  if (s[0] === g[0] && s[1] === g[1]) return [[tx, tz]];
  const isOutsideGoal = !isInsideAnyHouse(tx, tz);
  const q = [s], came = new Map([[toKey(s[0], s[1]), null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  while (q.length) {
    const [cx, cz] = q.shift();
    if (cx === g[0] && cz === g[1]) { found = true; break; }
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < -WORLD_RADIUS + 1 || nx > WORLD_RADIUS - 1 || nz < -WORLD_RADIUS + 1 || nz > WORLD_RADIUS - 1) continue;
      const k = toKey(nx, nz);
      if (came.has(k)) continue;
      if (isOutsideGoal && isInsideAnyHouse(nx + 0.5, nz + 0.5)) continue;
      if (villagePool && isInsidePool(nx + 0.5, nz + 0.5)) continue;
      if (isInsidePenPool(nx + 0.5, nz + 0.5)) continue;
      if (wolfBlockedAt(nx + 0.5, nz + 0.5, hw, py)) continue;
      came.set(k, [cx, cz]);
      q.push([nx, nz]);
    }
    if (came.size > 4000) break;
  }
  if (!found) return null;
  const path = [];
  let cur = g;
  while (cur) { path.push([cur[0] + 0.5, cur[1] + 0.5]); cur = came.get(toKey(cur[0], cur[1])); }
  path.reverse();
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) if (Math.hypot(path[i][0]-out[out.length-1][0], path[i][1]-out[out.length-1][1]) > 0.9) out.push(path[i]);
  if (out.length) out[out.length-1] = [tx, tz];
  return out;
}
function wolfFlatSpot() {
  for (let t = 0; t < 400; t++) {
    const x = Math.round((Math.random() * 2 - 1) * (WORLD_RADIUS - 3));
    const z = Math.round((Math.random() * 2 - 1) * (WORLD_RADIUS - 3));
    if (x >= villageMinX - 2 && x <= villageMaxX + 2 && z >= villageMinZ - 2 && z <= villageMaxZ + 2) continue;
    let h = -1;
    for (let y = 80; y >= 1; y--) if (isSolid(x, y, z)) { h = y; break; }
    if (h < 1) continue;
    const top = getBlock(x, h, z);
    if (top !== GRASS && top !== SAND && top !== STONE && top !== DIRT) continue;
    if (getBlock(x, h + 1, z) !== AIR || getBlock(x, h + 2, z) !== AIR) continue;
    let flat = true;
    for (let dx = -1; dx <= 1 && flat; dx++) for (let dz = -1; dz <= 1 && flat; dz++) {
      if (!dx && !dz) continue;
      let nh = -1;
      for (let y = 80; y >= 1; y--) if (isSolid(x + dx, y, z + dz)) { nh = y; break; }
      if (nh !== h) { flat = false; break; }
      const nt = getBlock(x + dx, nh, z + dz);
      if (nt !== GRASS && nt !== SAND && nt !== STONE && nt !== DIRT) { flat = false; break; }
      if (getBlock(x + dx, nh + 1, z + dz) !== AIR) { flat = false; break; }
    }
    if (!flat) continue;
    return { x: x + 0.5, z: z + 0.5, y: h + 1 };
  }
  return null;
}
function wanderGoalForWolf(m) {
  if (dim !== "over") return wanderNear(m);
  const py = m.pos.y;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 30; t++) {
    const ang = Math.random() * Math.PI * 2, dist = 15 + Math.random() * 35;
    const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.x + Math.cos(ang) * dist));
    const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.z + Math.sin(ang) * dist));
    if (wolfBlockedAt(x, z, m.hw, py) && wolfBlockedAt(x, z, m.hw, py + 1) && wolfBlockedAt(x, z, m.hw, py - 1)) continue;
    if (aabbCollidesWorld(x, py, z, m.hw, m.h)) continue;
    const ix = Math.floor(x), iz = Math.floor(z);
    const dCur = Math.hypot(ix - m.pos.x, iz - m.pos.z);
    if (dCur < 2) continue;
    if (m.lastTarget && Math.hypot(ix - m.lastTarget.x, iz - m.lastTarget.z) < 4) continue;
    const v = getVisit(ix, iz);
    let mobPenalty = 0;
    for (const o of mobs) {
      if (o === m || (o.dim !== undefined && o.dim !== dim)) continue;
      if (o.kind !== "wolf") continue;
      const d = Math.hypot(ix - o.pos.x, iz - o.pos.z);
      if (d < 1.9) mobPenalty += (1.9 - d) * 7;
      if (o.target) {
        const td = Math.hypot(ix - o.target.x, iz - o.target.z);
        if (td < 1.5) mobPenalty += (1.5 - td) * 5;
      }
    }
    const score = v * 10 - dCur * 0.15 + mobPenalty + settleNearBonus(m, dCur);
    if (score < bestScore) { bestScore = score; best = { x, z }; }
  }
  if (best) { m.lastTarget = { x: best.x, z: best.z }; return best; }
  for (let t = 0; t < 30; t++) {
    const ang = Math.random() * Math.PI * 2, dist = 8 + Math.random() * 20;
    const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.x + Math.cos(ang) * dist));
    const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.z + Math.sin(ang) * dist));
    if (wolfBlockedAt(x, z, 0.30, py)) continue;
    return { x, z };
  }
  return wanderNear(m);
}
function findVillagePath(sx, sz, tx, tz, hw, pyHint) {
  if (hw == null) hw = 0.27;
  const py = pyHint != null ? pyHint : villageCenter.y + 1;
  const hh = hw <= 0.18 ? 0.98 : 1.82;
  const toKey = (x, z) => x + "," + z;
  const s = [Math.floor(sx), Math.floor(sz)], g = [Math.floor(tx), Math.floor(tz)];
  if (s[0] === g[0] && s[1] === g[1]) return [[tx, tz]];
  const isOutsideGoal = !isInsideAnyHouse(tx, tz);
  const q = [s], came = new Map([[toKey(s[0], s[1]), null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  while (q.length) {
    const [cx, cz] = q.shift();
    if (cx === g[0] && cz === g[1]) { found = true; break; }
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < villageMinX + 1 || nx > villageMaxX - 1 || nz < villageMinZ + 1 || nz > villageMaxZ - 1) continue;
      const k = toKey(nx, nz);
      if (came.has(k)) continue;
      if (isOutsideGoal && isInsideAnyHouse(nx + 0.5, nz + 0.5)) continue;
      if (villagePool && isInsidePool(nx + 0.5, nz + 0.5)) continue;
      if (isInsidePenPool(nx + 0.5, nz + 0.5)) continue;
      if (mobBlockedAt(nx + 0.5, nz + 0.5, hw, py)) continue;
      came.set(k, [cx, cz]);
      q.push([nx, nz]);
    }
    if (came.size > 4000) break;
  }
  if (!found) return null;
  const path = [];
  let cur = g;
  while (cur) { path.push([cur[0] + 0.5, cur[1] + 0.5]); cur = came.get(toKey(cur[0], cur[1])); }
  path.reverse();
  // simplify collinear
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) if (Math.hypot(path[i][0]-out[out.length-1][0], path[i][1]-out[out.length-1][1]) > 0.9) out.push(path[i]);
  if (out.length) out[out.length-1] = [tx, tz];
  return out;
}
// Village-agnostic BFS for pine planting: same walkability as findVillagePath
// but bounded only by the map edge instead of the village, so soils are
// reachable anywhere in the Overworld (clouds, Moon, remote spots).
const PLANT_PATH_R = 105;
// A soil the mob can never stand on while village-bound (outside the clamp
// rectangle enforced by mobPhysicsStep) unbinds its planter at claim time,
// so the trip isn't snapped back mid-walk and the planter mills locally
// afterwards instead of hiking home across the map (e.g. the Moon).
function soilOutsideClamp(x, z, hw) {
  if (typeof villageMinX === "undefined") return false;
  return x < villageMinX + hw + 0.5 || x > villageMaxX - hw - 0.5 ||
    z < villageMinZ + hw + 0.5 || z > villageMaxZ - hw - 0.5;
}
// Walk goal for a soil: the soil center when standable at the mob's feet
// level (soil sunk in a hole); otherwise the nearest standable orthogonal
// neighbour (soil sitting on the ground, whose own cell is a wall at feet
// level); null when nothing is reachable at feet level.
function plantWalkGoal(m, best) {
  const feetY = Math.floor(m.pos.y);
  if (!mobBlockedAt(best.x + 0.5, best.z + 0.5, m.hw, feetY)) return { x: best.x + 0.5, z: best.z + 0.5 };
  let bx = null, bz = null, bd = Infinity;
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = best.x + ox, nz = best.z + oz;
    if (Math.abs(nx) > WORLD_RADIUS || Math.abs(nz) > WORLD_RADIUS) continue;
    if (mobBlockedAt(nx + 0.5, nz + 0.5, m.hw, feetY)) continue;
    const d = Math.hypot(nx + 0.5 - m.pos.x, nz + 0.5 - m.pos.z);
    if (d < bd) { bd = d; bx = nx + 0.5; bz = nz + 0.5; }
  }
  if (bx == null) return null;
  return { x: bx, z: bz };
}
// Wander target straight away from the soil (fallback: null): the planter
// leaves opposite the dirt block unless no validated spot exists.
function plantLeaveTarget(m, g) {
  let dx = m.pos.x - (g.x + 0.5), dz = m.pos.z - (g.z + 0.5);
  let len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) { dx = 1; dz = 0; len = 1; }
  dx /= len; dz /= len;
  for (const a of [0, 35, -35, 70, -70]) {
    const rad = a * Math.PI / 180;
    const ux = Math.cos(rad) * dx - Math.sin(rad) * dz;
    const uz = Math.sin(rad) * dx + Math.cos(rad) * dz;
    const tx = m.pos.x + ux * PLANT_LEAVE_DIST, tz = m.pos.z + uz * PLANT_LEAVE_DIST;
    if (Math.abs(tx) > WORLD_RADIUS - 1 || Math.abs(tz) > WORLD_RADIUS - 1) continue;
    if (aabbCollidesWorld(tx, m.pos.y, tz, m.hw, m.h)) continue;
    if (hasMobGround(tx, tz, m.hw, m.pos.y) || hasMobGround(tx, tz, m.hw, m.pos.y + 1) || hasMobGround(tx, tz, m.hw, m.pos.y - 1)) {
      return { x: tx, z: tz };
    }
  }
  return null;
}
function findPlantPath(sx, sz, tx, tz, hw, pyHint) {
  if (hw == null) hw = 0.27;
  const py = pyHint != null ? pyHint : 1;
  // House/pool/pen avoidances are village-floor features: skip them far above
  // or below the village (pads, clouds, Moon), where the XZ footprints below
  // must not veto walking.
  const nearVillage = typeof villageCenter !== "undefined" && villageCenter && Math.abs(py - (villageCenter.y + 1)) < 12;
  const toKey = (x, z) => x + "," + z;
  const s = [Math.floor(sx), Math.floor(sz)], g = [Math.floor(tx), Math.floor(tz)];
  if (s[0] === g[0] && s[1] === g[1]) return [[tx, tz]];
  const isOutsideGoal = !isInsideAnyHouse(tx, tz);
  const q = [s], came = new Map([[toKey(s[0], s[1]), null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  while (q.length) {
    const [cx, cz] = q.shift();
    if (cx === g[0] && cz === g[1]) { found = true; break; }
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (Math.abs(nx) > WORLD_RADIUS || Math.abs(nz) > WORLD_RADIUS) continue;
      const k = toKey(nx, nz);
      if (came.has(k)) continue;
      if (nearVillage && isOutsideGoal && isInsideAnyHouse(nx + 0.5, nz + 0.5)) continue;
      if (nearVillage && villagePool && isInsidePool(nx + 0.5, nz + 0.5)) continue;
      if (nearVillage && isInsidePenPool(nx + 0.5, nz + 0.5)) continue;
      if (mobBlockedAt(nx + 0.5, nz + 0.5, hw, py)) continue;
      came.set(k, [cx, cz]);
      q.push([nx, nz]);
    }
    if (came.size > 60000) break;
  }
  if (!found) return null;
  const path = [];
  let cur = g;
  while (cur) { path.push([cur[0] + 0.5, cur[1] + 0.5]); cur = came.get(toKey(cur[0], cur[1])); }
  path.reverse();
  const out2 = [path[0]];
  for (let i = 1; i < path.length; i++) if (Math.hypot(path[i][0]-out2[out2.length-1][0], path[i][1]-out2[out2.length-1][1]) > 0.9) out2.push(path[i]);
  if (out2.length) out2[out2.length-1] = [tx, tz];
  return out2;
}
function mobCollidesOther(mob, nx, nz) {
  if (isMobHeld(mob)) return null;
  if (mob.dim !== undefined && mob.dim !== dim) return null;
  const hw = villagerHW(mob);
  const y = mob.pos.y;
  const nearby = nearbyMobsFor(nx, nz, 1);
  const fleeing = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
  for (const o of nearby) {
    if (o === mob || isMobHeld(o)) continue;
    if (isChained(o)) continue;
    if (o.kind === "dragon" || o.kind === "enderman") continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    let need = hw + villagerHW(o) + 0.04;
    if (!fleeing) {
      const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
      if (!oflee && mobBondedPair(mob, o)) {
        need = (hw + villagerHW(o)) * 0.62 + 0.06;
      }
    }
    if (Math.abs(y - o.pos.y) > 1.2) continue;
    const dx = nx - o.pos.x, dz = nz - o.pos.z;
    if (dx * dx + dz * dz < need * need) return o;
  }
  return null;
}
function mobHitsPlayer(nx, nz, hw, y) {
  if (Math.abs(y - pos.y) > 1.5) return false;
  const dx = pos.x - nx, dz = pos.z - nz;
  return dx * dx + dz * dz < (hw + PLAYER_HW + 0.04) * (hw + PLAYER_HW + 0.04);
}
function spawnVillagers() {
  const villagerTarget = VILLAGE_HOUSES * 3;
  const livestockTarget = (PIG_COUNT + COW_COUNT);
  const villagerCount = () => mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && (!m.kind || m.kind === "villager")).length;
  const livestockCount = () => mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && (m.kind === "pig" || m.kind === "cow")).length;
  const wolfCount = () => mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && m.kind === "wolf").length;
  const golemCount = () => mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && m.kind === "iron_golem").length;
  const babyCount = () => mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && (!m.kind || m.kind === "villager") && m.isBaby).length;
  const catCount = () => mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && m.kind === "cat").length;
  const overCount = () => mobs.filter((m) => m.dim === "over" || m.dim === undefined).length;
  if (villagerCount() >= villagerTarget && (!villagePen || livestockCount() >= livestockTarget) && wolfCount() >= WOLF_COUNT && golemCount() >= GOLEM_COUNT && catCount() >= Math.min(CAT_COUNT, babyCount())) return;
  if (!villageHouses.length) computeVillageLayout();
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  else if (villagerGeo.attributes.position.getY(0) > -0.4) { villagerGeo.dispose(); villagerGeo = new THREE.BoxGeometry(1, 1, 1); }
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  const preExisting = new Set(mobs.map((m) => m.id));
  const used = mobs.filter((m) => m.dim === "over" || m.dim === undefined).map((m) => [m.pos.x, m.pos.z]);
  const usedBlocks = new Set(mobs.filter((m) => m.dim === "over" || m.dim === undefined).map((m) => `${Math.floor(m.pos.x)},${Math.floor(m.pos.y)},${Math.floor(m.pos.z)}`));
  for (const h of villageHouses) {
    if (villagerCount() >= villagerTarget) break;
    for (let k = 0; k < 3; k++) {
      if (villagerCount() >= villagerTarget) break;
      const isBaby = k === 2;
      const mesh = makeVillagerMesh(isBaby);
      let sx, sz, tries = 0;
      const hw = isBaby ? 0.16 : 0.27, hh = isBaby ? 0.98 : 1.82;
      do {
        const ang = Math.random() * Math.PI * 2, rad = Math.random() * 7 + 2;
        sx = h.cx + Math.cos(ang) * rad;
        sz = h.cz + Math.sin(ang) * rad;
        sx = Math.max(villageMinX + 1.5, Math.min(villageMaxX - 1.5, sx));
        sz = Math.max(villageMinZ + 1.5, Math.min(villageMaxZ - 1.5, sz));
        sx = Math.floor(sx) + 0.5;
        sz = Math.floor(sz) + 0.5;
        const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
        if (usedBlocks.has(blockKey)) { tries++; continue; }
        if (isInsideAnyHouse(sx, sz) || isInsidePool(sx, sz) || isInsidePenPool(sx, sz) || mobBlockedAt(sx, sz, hw, villageCenter.y + 1) || used.some((u) => (u[0] - sx) ** 2 + (u[1] - sz) ** 2 < 1.6)) { tries++; continue; }
        break;
      } while (tries < 30);
      // final snap center
      sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
      const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
      if (usedBlocks.has(blockKey) || isInsidePenPool(sx, sz)) {
        // fallback to random village point centered
        let alt = wanderGoalFor({ pos: new THREE.Vector3(sx, villageCenter.y+1, sz), hw, h: hh, lastTarget: null });
        if (alt) { sx = Math.floor(alt.x)+0.5; sz = Math.floor(alt.z)+0.5; }
        if (isInsidePenPool(sx, sz)) {
          const retry = randomVillagePoint();
          sx = Math.floor(retry.x)+0.5; sz = Math.floor(retry.z)+0.5;
        }
      }
      used.push([sx, sz]);
      usedBlocks.add(`${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`);
      mesh.position.set(sx, villageCenter.y + 1, sz);
      const yaw = Math.random() * Math.PI * 2;
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const m = {
        id: gid++, kind: "villager", canStep: false, homeId: h.id, isBaby, parentId: -1, dim: "over",
        palIdx: mesh.userData.palIdx != null ? mesh.userData.palIdx : 0,
        pos: new THREE.Vector3(sx, villageCenter.y + 1, sz),
        vel: new THREE.Vector3(0, 0, 0),
        hw, h: hh, mesh, onGround: false,
        target: null, mode: "wander", wanderT: 2 + Math.random() * 3, insideT: 0,
        legPhase: Math.random() * Math.PI * 2, speed: WALK / 2,
        blockedT: 0, yaw, yawTarget: yaw, villageBound: true,
        _stuckT: 0, _prevX: sx, _prevZ: sz,
        path: null, pathIdx: 0, pathKey: null, sc: isBaby ? 0.52 : 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false
      };
      stampSpawn(m);
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
  for (const m of mobs) {
    if (isMobHeld(m)) continue;
    if (preExisting.has(m.id)) continue;
    if (m.isBaby && mobById.get(m.parentId) == null) {
      const sibs = mobs.filter((o) => o.homeId === m.homeId && !o.isBaby);
      if (sibs.length) m.parentId = sibs[Math.floor(Math.random() * sibs.length)].id;
      const p = mobById.get(m.parentId);
      const pp = p && p.mesh && p.mesh.userData ? p.mesh.userData.palIdx : null;
      if (pp != null && pp !== m.palIdx) {
        const mesh = makeVillagerMesh(true, pp);
        mesh.position.copy(m.mesh.position);
        mesh.rotation.y = m.mesh.rotation.y;
        scene.remove(m.mesh);
        scene.add(mesh);
        m.mesh = mesh;
        m.palIdx = pp;
      }
    }
  }
  for (const m of mobs) {
    if (isMobHeld(m)) continue;
    if (preExisting.has(m.id)) continue;
    if (m.isBaby) {
      const p = mobById.get(m.parentId);
      if (p) m.target = { x: p.pos.x, z: p.pos.z };
      else m.target = randomVillagePoint();
    } else if (!m.kind || m.kind === "villager") {
      m.target = randomVillagePoint();
    }
    m.mode = "wander";
    m.wanderT = 3 + Math.random() * 4;
  }
  // — pigs and cows in the pen (same physics as villagers) —
  if (villagePen) {
    const curPig = mobs.filter((m) => m.kind === "pig" && (m.dim === "over" || m.dim === undefined)).length;
    const curCow = mobs.filter((m) => m.kind === "cow" && (m.dim === "over" || m.dim === undefined)).length;
    const needPig = Math.max(0, PIG_COUNT - curPig);
    const needCow = Math.max(0, COW_COUNT - curCow);
    const penMobsToSpawn = [];
    for (let i = 0; i < needPig; i++) penMobsToSpawn.push("pig");
    for (let i = 0; i < needCow; i++) penMobsToSpawn.push("cow");
    for (const kind of penMobsToSpawn) {
      const mesh = kind === "pig" ? makePigMesh() : makeCowMesh();
      const hw = 0.32, hh = kind === "pig" ? 0.92 : 1.30;
      let sx, sz, tries = 0;
      do {
        const rx = (Math.random() * (villagePen.maxX - villagePen.minX - 3)) + villagePen.minX + 1.5;
        const rz = (Math.random() * (villagePen.maxZ - villagePen.minZ - 3)) + villagePen.minZ + 1.5;
        sx = Math.floor(rx) + 0.5; sz = Math.floor(rz) + 0.5;
        const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
        if (usedBlocks.has(blockKey)) { tries++; continue; }
        if (isInsidePenPool(sx, sz)) { tries++; continue; }
        if (mobBlockedAt(sx, sz, hw, villageCenter.y + 1) || aabbCollidesWorld(sx, villageCenter.y + 1, sz, hw, hh)) { tries++; continue; }
        // keep strictly inside fence interior
        if (sx <= villagePen.minX + 0.7 || sx >= villagePen.maxX - 0.7 || sz <= villagePen.minZ + 0.7 || sz >= villagePen.maxZ - 0.7) { tries++; continue; }
        if (used.some((u) => (u[0] - sx) ** 2 + (u[1] - sz) ** 2 < 1.5)) { tries++; continue; }
        break;
      } while (tries < 30);
      sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
      const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
      if (usedBlocks.has(blockKey) || isInsidePenPool(sx, sz)) {
        const alt = randomPenPoint();
        sx = Math.floor(alt.x) + 0.5; sz = Math.floor(alt.z) + 0.5;
        if (isInsidePenPool(sx, sz)) { sx = Math.floor(villagePen.cx) + 0.5; sz = Math.floor(villagePen.cz) + 0.5; }
      }
      used.push([sx, sz]);
      usedBlocks.add(`${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`);
      mesh.position.set(sx, villageCenter.y + 1, sz);
      const yaw = Math.random() * Math.PI * 2;
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const m = {
        id: gid++, kind, canStep: false, homeId: -1, isBaby: false, parentId: -1, dim: "over",
        pos: new THREE.Vector3(sx, villageCenter.y + 1, sz),
        vel: new THREE.Vector3(0, 0, 0),
        hw, h: hh, mesh, onGround: false,
        target: randomPenPoint(), mode: "wander", wanderT: 3 + Math.random() * 4, insideT: 0,
        legPhase: Math.random() * Math.PI * 2, speed: WALK / 2.2,
        blockedT: 0, yaw, yawTarget: yaw, villageBound: false, penBound: true, penId: 0,
        _stuckT: 0, _prevX: sx, _prevZ: sz,
        path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false
      };
      stampSpawn(m);
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
  // — 20 wolves roam the whole map (spawned outside the village on firm flat ground) —
  {
    const curWolf = mobs.filter((m) => m.kind === "wolf" && (m.dim === "over" || m.dim === undefined)).length;
    const needWolf = Math.max(0, WOLF_COUNT - curWolf);
    const existingFurs = new Set(mobs.filter((m) => m.kind === "wolf").map((m) => m.mesh?.userData?.furHex));
    const wolfSpots = mobs.filter((m) => m.kind === "wolf").map((m) => [m.pos.x, m.pos.z]);
    for (let i = 0; i < needWolf; i++) {
      const fur = WOLF_FUR;
      existingFurs.add(fur);
      const collar = WOLF_COLLAR_COLORS[Math.floor(Math.random() * WOLF_COLLAR_COLORS.length)];
      const mesh = makeWolfMesh(fur, collar);
      const hw = 0.30, hh = 0.90;
      let spot = null, fallback = null;
      for (let tries = 0; tries < 60 && !spot; tries++) {
        const c = wolfFlatSpot();
        if (!c) break;
        if (used.some((u) => (u[0] - c.x) ** 2 + (u[1] - c.z) ** 2 < 1.4)) continue;
        if (!fallback) fallback = c;
        const minD = tries < 20 ? 20 : 8;
        if (wolfSpots.some((w) => (w[0] - c.x) ** 2 + (w[1] - c.z) ** 2 < minD * minD)) continue;
        spot = c;
      }
      if (!spot) spot = fallback;
      if (!spot) continue;
      const sx = spot.x, sz = spot.z, sy = spot.y;
      used.push([sx, sz]);
      usedBlocks.add(`${Math.floor(sx)},${sy},${Math.floor(sz)}`);
      wolfSpots.push([sx, sz]);
      mesh.position.set(sx, sy, sz);
      const yaw = Math.random() * Math.PI * 2;
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const m = {
        id: gid++, kind: "wolf", canStep: true, fur, collar, homeId: -1, isBaby: false, parentId: -1, dim: "over",
        pos: new THREE.Vector3(sx, sy, sz),
        vel: new THREE.Vector3(0, 0, 0),
        hw, h: hh, mesh, onGround: false,
        target: null, mode: "wander", wanderT: 3 + Math.random() * 4, insideT: 0,
        legPhase: Math.random() * Math.PI * 2, speed: WALK / 2,
        blockedT: 0, yaw, yawTarget: yaw, villageBound: false,
        _stuckT: 0, _prevX: sx, _prevZ: sz,
        path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null,
        wolfStepUp: false, wolfStepUpClearY: 0, wolfInWater: false, wasOnGroundWolf: false, _wasInWater: false
      };
      m.target = wanderGoalForWolf(m);
      stampSpawn(m);
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
  // — 1 iron golem (villager-like wander, chain lead only, never panics) —
  {
    const curGolem = mobs.filter((m) => m.kind === "iron_golem" && (m.dim === "over" || m.dim === undefined)).length;
    const needGolem = Math.max(0, GOLEM_COUNT - curGolem);
    for (let i = 0; i < needGolem; i++) {
      const mesh = makeIronGolemMesh();
      const hw = GOLEM_HW, hh = GOLEM_HH;
      let sx, sz, tries = 0;
      do {
        const ang = Math.random() * Math.PI * 2, rad = Math.random() * (VILLAGE_RADIUS - 8) + 4;
        sx = villageCenter.x + Math.cos(ang) * rad;
        sz = villageCenter.z + Math.sin(ang) * rad;
        sx = Math.max(villageMinX + 2, Math.min(villageMaxX - 2, sx));
        sz = Math.max(villageMinZ + 2, Math.min(villageMaxZ - 2, sz));
        sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
        const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
        if (usedBlocks.has(blockKey)) { tries++; continue; }
        if (isInsideAnyHouse(sx, sz) || isInsidePool(sx, sz) || isInsidePenPool(sx, sz) || isInsidePen(sx, sz)) { tries++; continue; }
        if (mobBlockedAt(sx, sz, hw, villageCenter.y + 1, hh) || aabbCollidesWorld(sx, villageCenter.y + 1, sz, hw, hh)) { tries++; continue; }
        if (used.some((u) => (u[0] - sx) ** 2 + (u[1] - sz) ** 2 < 6)) { tries++; continue; }
        break;
      } while (tries < 40);
      sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
      if (usedBlocks.has(`${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`) || isInsidePenPool(sx, sz) || isInsidePen(sx, sz) || mobBlockedAt(sx, sz, hw, villageCenter.y + 1, hh)) {
        const alt = wanderGoalFor({ pos: new THREE.Vector3(sx, villageCenter.y + 1, sz), hw, h: hh, lastTarget: null });
        if (alt && !isInsidePen(alt.x, alt.z)) { sx = Math.floor(alt.x) + 0.5; sz = Math.floor(alt.z) + 0.5; }
        else { sx = Math.floor(villageCenter.x) + 0.5; sz = Math.floor(villageCenter.z) + 0.5; }
      }
      used.push([sx, sz]);
      usedBlocks.add(`${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`);
      mesh.position.set(sx, villageCenter.y + 1, sz);
      const yaw = Math.random() * Math.PI * 2;
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const m = {
        id: gid++, kind: "iron_golem", canStep: false, homeId: -1, isBaby: false, parentId: -1, dim: "over",
        pos: new THREE.Vector3(sx, villageCenter.y + 1, sz),
        vel: new THREE.Vector3(0, 0, 0),
        hw, h: hh, mesh, onGround: false,
        target: null, mode: "wander", wanderT: 3 + Math.random() * 4, insideT: 0,
        legPhase: Math.random() * Math.PI * 2, speed: WALK / 2,
        blockedT: 0, yaw, yawTarget: yaw, villageBound: true,
        _stuckT: 0, _prevX: sx, _prevZ: sz,
        path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false
      };
      m.target = wanderGoalFor(m);
      stampSpawn(m);
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
  // — 1 cat per baby villager (follows its baby, jumps like a wolf, rallies home on TNT panic) —
  {
    const babies = mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && (!m.kind || m.kind === "villager") && m.isBaby);
    const cats = mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && m.kind === "cat");
    const orphans = babies.filter((b) => !cats.some((c) => c.parentId === b.id));
    const needCat = Math.min(CAT_COUNT, babies.length) - cats.length;
    for (let i = 0; i < needCat && i < orphans.length; i++) {
      const baby = orphans[i];
      const robe = pickCatRobe();
      const mesh = makeCatMesh(robe);
      const hw = CAT_HW, hh = CAT_HH;
      let sx = Math.floor(baby.pos.x) + 0.5, sz = Math.floor(baby.pos.z) + 0.5, tries = 0;
      const babyKey = `${Math.floor(sx)},${Math.floor(baby.pos.y)},${Math.floor(sz)}`;
      if (usedBlocks.has(babyKey) || mobBlockedAt(sx, sz, hw, baby.pos.y, hh) || aabbCollidesWorld(sx, baby.pos.y, sz, hw, hh)) {
        do {
          const ang = Math.random() * Math.PI * 2, rad = Math.random() * 6 + 1;
          sx = baby.pos.x + Math.cos(ang) * rad;
          sz = baby.pos.z + Math.sin(ang) * rad;
          sx = Math.max(villageMinX + 1.5, Math.min(villageMaxX - 1.5, sx));
          sz = Math.max(villageMinZ + 1.5, Math.min(villageMaxZ - 1.5, sz));
          sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
          const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
          if (usedBlocks.has(blockKey)) { tries++; continue; }
          if (isInsideAnyHouse(sx, sz) || isInsidePool(sx, sz) || isInsidePenPool(sx, sz) || mobBlockedAt(sx, sz, hw, villageCenter.y + 1, hh) || aabbCollidesWorld(sx, villageCenter.y + 1, sz, hw, hh)) { tries++; continue; }
          if (used.some((u) => (u[0] - sx) ** 2 + (u[1] - sz) ** 2 < 1.4)) { tries++; continue; }
          break;
        } while (tries < 30);
      }
      sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
      const sy = groundYForMob(sx, sz, villageCenter.y + 1, hw);
      used.push([sx, sz]);
      usedBlocks.add(`${Math.floor(sx)},${sy},${Math.floor(sz)}`);
      mesh.position.set(sx, sy, sz);
      const yaw = Math.random() * Math.PI * 2;
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const m = {
        id: gid++, kind: "cat", canStep: true, catVar: robe, homeId: baby.homeId, isBaby: false, parentId: baby.id, dim: "over",
        pos: new THREE.Vector3(sx, sy, sz),
        vel: new THREE.Vector3(0, 0, 0),
        hw, h: hh, mesh, onGround: false,
        target: { x: baby.pos.x, z: baby.pos.z }, mode: "follow", wanderT: 3 + Math.random() * 4, insideT: 0,
        legPhase: Math.random() * Math.PI * 2, speed: WALK / 2,
        blockedT: 0, yaw, yawTarget: yaw, villageBound: true,
        _stuckT: 0, _prevX: sx, _prevZ: sz,
        path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false
      };
      stampSpawn(m);
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
}
function removeVillagers() {
  const keepCarry = carryMob && mobs.includes(carryMob) ? carryMob : null;
  const keepHook = carryGrappleMob && mobs.includes(carryGrappleMob) ? carryGrappleMob : null;
  const survivors = [];
  for (const m of mobs) {
    if (m === keepCarry || m === keepHook) { survivors.push(m); continue; }
    if (m.dim !== undefined && m.dim !== "over") { survivors.push(m); continue; }
    if (m.mesh) scene.remove(m.mesh);
    if (m.fallMesh) scene.remove(m.fallMesh);
    mobById.delete(m.id);
  }
  mobs.length = 0;
  for (const s of survivors) { mobs.push(s); mobById.set(s.id, s); }
  for (let i = endermen.length - 1; i >= 0; i--) if (!mobs.includes(endermen[i])) endermen.splice(i, 1);
  if (!mobs.length) { mobGrid.clear(); visitGrid.clear(); }
  else { buildMobGrid(); }
  for (const h of villageHouses) { h.doorQueue = []; h.doorLock = null; h.lockUntil = 0; }
  if (!mobs.length && villagerGeo) { /* keep geo for reuse */ }
  mobStats = { worldCol: 0, mobCol: 0, playerCol: 0, stuck: 0, falls: 0, frames: 0, invariants: 0 };
  if (!keepCarry) playerArms.visible = false;
  pruneChains();
}
let overworldMobCache = null;
let pendingOverworldMobs = null;
let pendingChainLinks = null;
let pendingCarriedIdx = null;
let endMobCache = null;
let netherMobCache = null;
let pendingEndMobs = null;
let pendingNetherMobs = null;
let pendingChainLinksEnd = null;
let pendingChainLinksNether = null;
let pendingCarriedDim = 0;
let netherExit = null;
let endExit = null;
let pendingDragon = null;
let pendingTNTBombs = null;
let pendingTNTQueue = null;
let pendingTNTEta = null;
let pendingFx = null;
let pendingVillagePanic = 0;
function mobDimOf(m) { return (m && m.dim !== undefined ? m.dim : "over"); }
function snapshotMobsForDim(dimName, includeCarried) {
  const olds = mobs.filter((m) => mobDimOf(m) === dimName && m.kind !== "dragon");
  const list = olds.filter((m) => {
    if (m === carryMob) return includeCarried;
    if (m === carryGrappleMob && !includeCarried && carryGrappleMode === "release") return false;
    return true;
  });
  if (!list.length) return [];
  const idxById = new Map();
  list.forEach((m, i) => idxById.set(m.id, i));
  const now = performance.now() / 1000;
  return list.map((m) => Object.assign({
    id: m.id,
    kind: mobKindCode(m),
    isBaby: !!m.isBaby,
    homeId: m.homeId != null ? m.homeId : -1,
    parentIdx: m.parentId != null ? (idxById.get(m.parentId) != null ? idxById.get(m.parentId) : -1) : -1,
    x: m.pos.x, y: m.pos.y, z: m.pos.z,
    yaw: liveMobYaw(m),
    look: mobLookIndex(m),
    villageBound: m.villageBound !== false,
    penBound: !!m.penBound,
    portalSent: m._frozenUntil != null && m._frozenUntil > now,
  }, mobPanicSnapshot(m, now)));
}
const DRAGON_CHAIN_CARRIER = 65535;
function snapshotChainPairsForDim(dimName, mobList, includeDragon = false) {
  if (!mobList || !mobList.length) return [];
  const idxById = new Map();
  mobList.forEach((e, i) => { if (e.id != null) idxById.set(e.id, i); });
  const pairs = [];
  for (const [carrierId, childId] of chainChild) {
    let a = idxById.get(carrierId);
    const b = idxById.get(childId);
    if (carrierId === PLAYER_CHAIN_ID) {
      if (dimName !== dim) continue;
      const link = chainLinks.get(childId);
      if (link && link.playerLead) continue;
      const front = (playerInChain() && grappleMob) ? grappleMob : (link ? mobById.get(link.playerFrontId) : null);
      if (!front || mobDimOf(front) !== dimName) continue;
      a = front ? idxById.get(front.id) : null;
    } else {
      const carrier = mobById.get(carrierId);
      const child = mobById.get(childId);
      if (!carrier || !child || mobDimOf(carrier) !== dimName || mobDimOf(child) !== dimName) continue;
      if (a == null && includeDragon && carrier.kind === "dragon" && mobDimOf(child) === "end") a = DRAGON_CHAIN_CARRIER;
    }
    if (a == null || b == null || a > DRAGON_CHAIN_CARRIER || b >= DRAGON_CHAIN_CARRIER) continue;
    pairs.push([a, b]);
  }
  return pairs;
}
function purgeProtectedForDim(prefix) {
  for (const k of [...protectedBlocks]) if (k.startsWith(prefix + ":")) protectedBlocks.delete(k);
}
function recordDimExit(win, dir) {
  const full = Object.assign({ nether: false }, win);
  const spot = nearPortalSpawn(full, dir);
  return { x: spot.x, y: spot.y, z: spot.z, yaw: faceAwayFromPortal(full, spot.x, spot.z) };
}
function resolveDimArrival(exit, fallback) {
  if (exit && isFinite(exit.x) && isFinite(exit.y) && isFinite(exit.z)) {
    const spot = resolveSpawn(exit.x, exit.y, exit.z);
    return { spot, yaw: isFinite(exit.yaw) ? exit.yaw : fallback.yaw };
  }
  return fallback;
}
const MOB_SAVE_BYTES = 43;
function mobKindCode(m) {
  if (m.kind === "pig") return 1;
  if (m.kind === "cow") return 2;
  if (m.kind === "wolf") return 3;
  if (m.kind === "pigeon") return 4;
  if (m.kind === "enderman") return 5;
  if (m.kind === "iron_golem") return 6;
  if (m.kind === "parrot") return 7;
  if (m.kind === "cat") return 8;
  return 0;
}
function mobKindFromCode(c) {
  if (c === 1) return "pig";
  if (c === 2) return "cow";
  if (c === 3) return "wolf";
  if (c === 4) return "pigeon";
  if (c === 5) return "enderman";
  if (c === 6) return "iron_golem";
  if (c === 7) return "parrot";
  if (c === 8) return "cat";
  return "villager";
}
function mobLookIndex(m) {
  if (!m.kind || m.kind === "villager") {
    if (m.palIdx != null && m.palIdx >= 0 && m.palIdx < VILLAGER_PALETTES.length) return m.palIdx;
    const ui = m.mesh && m.mesh.userData ? m.mesh.userData.palIdx : null;
    if (ui != null && ui >= 0 && ui < VILLAGER_PALETTES.length) return ui;
    return 0;
  }
  if (m.kind === "wolf") {
    const hex = m.collar != null ? m.collar : (m.mesh && m.mesh.userData ? m.mesh.userData.collarHex : null);
    const i = WOLF_COLLAR_COLORS.indexOf(hex);
    return i >= 0 ? i : 0;
  }
  if (m.kind === "parrot") {
    if (m.parrotVar != null && m.parrotVar >= 0 && m.parrotVar < PARROT_VARIANT_COUNT) return m.parrotVar;
    const uv = m.mesh && m.mesh.userData ? m.mesh.userData.parrotVar : null;
    if (uv != null && uv >= 0 && uv < PARROT_VARIANT_COUNT) return uv;
    return 0;
  }
  if (m.kind === "cat") {
    if (m.catVar != null && m.catVar >= 0 && m.catVar < CAT_ROBES.length) return m.catVar;
    const cv = m.mesh && m.mesh.userData ? m.mesh.userData.catVar : null;
    if (cv != null && cv >= 0 && cv < CAT_ROBES.length) return cv;
    return 0;
  }
  return 0;
}
function encodeMobYaw(yaw) {
  const t = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(t / (Math.PI * 2) * 255) & 255;
}
function decodeMobYaw(b) {
  return (b / 255) * Math.PI * 2;
}
function liveMobYaw(m) {
  const y = (m.mesh ? m.mesh.rotation.y : null);
  if (y != null && isFinite(y)) return y;
  return m.yaw != null ? m.yaw : 0;
}
function snapshotOverworldMobs(includeCarried) {
  const overs = mobs.filter((m) => (m.dim === "over" || m.dim === undefined));
  const list = overs.filter((m) => {
    if (m === carryMob) return includeCarried;
    if (m === carryGrappleMob && !includeCarried && carryGrappleMode === "release") return false;
    return true;
  });
  if (!list.length) return [];
  const idxById = new Map();
  list.forEach((m, i) => idxById.set(m.id, i));
  const now = performance.now() / 1000;
  return list.map((m) => Object.assign({
    id: m.id,
    kind: mobKindCode(m),
    isBaby: !!m.isBaby,
    homeId: m.homeId != null ? m.homeId : -1,
    parentIdx: m.parentId != null ? (idxById.get(m.parentId) != null ? idxById.get(m.parentId) : -1) : -1,
    x: m.pos.x, y: m.pos.y, z: m.pos.z,
    yaw: liveMobYaw(m),
    look: mobLookIndex(m),
    villageBound: m.villageBound !== false,
    penBound: !!m.penBound,
    portalSent: m._frozenUntil != null && m._frozenUntil > now,
  }, mobPanicSnapshot(m, now)));
}
function mobRestoreOverlapsPlaced(x, y, z, hw, hh, placed) {
  if (!placed || !placed.length) return false;
  for (const p of placed) {
    if (isFlyingKind(p.kind)) continue;
    if (Math.abs(y - p.pos.y) > 1.2) continue;
    if (aabbOverlaps(x, y, z, hw, hh, p.pos.x, p.pos.y, p.pos.z, p.hw, p.h)) return true;
  }
  return false;
}
function placeMobExact(sx, sy, sz, hw, hh, placed, isWolf, isFlying) {
  const cx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, sx));
  const cz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, sz));
  const cy = Math.max(1, Math.min(MAX_Y - 2, sy));
  if (!aabbCollidesWorld(cx, cy, cz, hw, hh) && !mobRestoreOverlapsPlaced(cx, cy, cz, hw, hh, placed)) return { x: cx, y: cy, z: cz };
  for (const lift of [0.02, 0.05]) {
    const ly = Math.max(1, Math.min(MAX_Y - 2, cy + lift));
    if (!aabbCollidesWorld(cx, ly, cz, hw, hh) && !mobRestoreOverlapsPlaced(cx, ly, cz, hw, hh, placed)) return { x: cx, y: ly, z: cz };
  }
  if (isFlying) {
    for (let r = 0.3; r <= 2.1; r += 0.3) {
      for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]]) {
        const nx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cx + ox));
        const nz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cz + oz));
        if (!aabbCollidesWorld(nx, cy, nz, hw, hh) && !mobRestoreOverlapsPlaced(nx, cy, nz, hw, hh, placed)) return { x: nx, y: cy, z: nz };
      }
    }
    return { x: cx, y: cy, z: cz };
  }
  const settled = settleMobSpot(cx, cy, cz, hw, hh, isWolf);
  if (!mobRestoreOverlapsPlaced(settled.x, settled.y, settled.z, hw, hh, placed)) return settled;
  for (let r = 0.3; r <= 2.1; r += 0.3) {
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]]) {
      const nx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, settled.x + ox));
      const nz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, settled.z + oz));
      if (aabbCollidesWorld(nx, settled.y, nz, hw, hh)) continue;
      if (mobRestoreOverlapsPlaced(nx, settled.y, nz, hw, hh, placed)) continue;
      return { x: nx, y: settled.y, z: nz };
    }
  }
  return settled;
}
function settleMobSpot(sx, sy, sz, hw, h, isWolf) {
  const cx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, sx));
  const cz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, sz));
  const cy = Math.max(1, Math.min(MAX_Y - 2, sy));
  const blockedAt = (x, y, z) => isWolf ? wolfBlockedAt(x, z, hw, y) : mobBlockedAt(x, z, hw, y, h);
  const hasGround = (x, z, y) => isWolf ? wolfHasMobGround(x, z, hw, y) : hasMobGround(x, z, hw, y);
  if (!aabbCollidesWorld(cx, cy, cz, hw, h) && !blockedAt(cx, cy, cz)) return { x: cx, y: cy, z: cz };
  for (let r = 1; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
      const nx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cx + dx));
      const nz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cz + dz));
      const gy = groundYForMob(nx, nz, cy, hw);
      const fy = Math.max(1, Math.min(MAX_Y - 2, gy));
      if (aabbCollidesWorld(nx, fy, nz, hw, h) || blockedAt(nx, fy, nz)) continue;
      if (!hasGround(nx, nz, fy)) continue;
      return { x: nx, y: fy, z: nz };
    }
  }
  const gy = groundYForMob(cx, cz, cy, hw);
  return { x: cx, y: Math.max(1, Math.min(MAX_Y - 2, gy)), z: cz };
}
function restoreInitialTarget(m) {
  if (dim === "over" && m.kind === "villager" && !m.isBaby && houseAtRoof(m.pos.x, m.pos.z)) return wanderGoalForRoof(m);
  if (dim === "over" && (m.kind === "pig" || m.kind === "cow") && m.penBound !== false && villagePen && isInsidePen(m.pos.x, m.pos.z)) return wanderGoalForPen(m);
  if (m.kind === "cat") {
    const p = catParentFor(m);
    if (p) {
      if (Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) > FOLLOW_ENGAGE_D) return catTrailSpot(m, p);
      return { x: p.pos.x + (Math.random() - 0.5) * 2, z: p.pos.z + (Math.random() - 0.5) * 2 };
    }
  }
  if (isJumpingKind(m.kind)) return wanderGoalForWolf(m);
  if (m.kind === "villager" && m.isBaby) {
    const p = babyParentFor(m);
    if (p) {
      if (Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) > FOLLOW_ENGAGE_D) return babyTrailSpot(m, p);
      return { x: p.pos.x + (Math.random() - 0.5) * 2, z: p.pos.z + (Math.random() - 0.5) * 2 };
    }
  }
  if (dim === "over" && villageHouses.length && Math.abs(m.pos.y - (villageCenter.y + 1)) < 3.5) return wanderGoalFor(m);
  return restoreFirstTarget(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h, isJumpingKind(m.kind));
}
function restoreFirstTarget(x, y, z, hw, h, isWolf) {
  const self = { x, z };
  const groundAt = (px, pz) => isWolf ? wolfHasMobGround(px, pz, hw, y) : hasMobGround(px, pz, hw, y);
  for (let t = 0; t < 12; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = 2 + Math.random() * 3;
    let px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (dim === "end") {
      const r = Math.hypot(px, pz);
      if (r > END_MOB_R - 1) continue;
    } else {
      if (Math.abs(px) > WORLD_RADIUS - 2 || Math.abs(pz) > WORLD_RADIUS - 2) continue;
    }
    if (dim === "over" && (isInsidePool(px, pz) || isInsidePenPool(px, pz))) continue;
    if (aabbCollidesWorld(px, y, pz, hw, h)) continue;
    if (!groundAt(px, pz)) continue;
    return { x: px, z: pz };
  }
  return self;
}
function restoreOverworldMobs(list, opts) {
  const keepCarried = !opts || opts.keepCarried !== false;
  const topUp = !opts || opts.topUp !== false;
  const applyPanic = !!opts && opts.applyPanic === true;
  let carriedIdx = (opts && opts.carriedIdx != null) ? opts.carriedIdx : pendingCarriedIdx;
  pendingCarriedIdx = null;
  if (!Number.isInteger(carriedIdx) || carriedIdx < 0 || !list || carriedIdx >= list.length) carriedIdx = -1;
  if (!list || !list.length) return 0;
  if (!villageHouses.length) computeVillageLayout();
  if (!keepCarried && carryMob) {
    if (carryMob.mesh) scene.remove(carryMob.mesh);
    mobById.delete(carryMob.id);
    const ci = mobs.indexOf(carryMob);
    if (ci >= 0) mobs.splice(ci, 1);
    carryMob = null;
    playerArms.visible = false;
  }
  removeVillagers();
  if (keepCarried && carryMob && mobs.includes(carryMob)) carriedIdx = -1;
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  const idByListIdx = new Array(list.length).fill(null);
  const created = [];
  const chainedIdx = new Set();
  if (pendingChainLinks && pendingChainLinks.length) {
    for (const [a, b] of pendingChainLinks) {
      if (a === carriedIdx || b === carriedIdx) continue;
      if (a < 0 || b < 0 || a >= list.length || b >= list.length) continue;
      chainedIdx.add(a);
      chainedIdx.add(b);
    }
  }
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const kind = mobKindFromCode(e.kind);
    const isBaby = !!e.isBaby && kind === "villager";
    const hw = isBirdKind(kind) ? 0.25 : kind === "wolf" ? 0.30 : kind === "cat" ? CAT_HW : (kind === "pig" || kind === "cow") ? 0.32 : kind === "enderman" ? ENDERMAN_HW : kind === "iron_golem" ? GOLEM_HW : (isBaby ? 0.16 : 0.27);
    const hh = isBirdKind(kind) ? 0.5 : kind === "wolf" ? 0.90 : kind === "cat" ? CAT_HH : kind === "pig" ? 0.92 : kind === "cow" ? 1.30 : kind === "enderman" ? ENDERMAN_H : kind === "iron_golem" ? GOLEM_HH : (isBaby ? 0.98 : 1.82);
    const isWolf = isJumpingKind(kind);
    let sx = e.x, sy = e.y, sz = e.z;
    if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz)) continue;
    let spot = null;
    if (i === carriedIdx) {
      spot = {
        x: Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sx)),
        y: Math.max(1, Math.min(MAX_Y - 2, sy)),
        z: Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sz)),
      };
    } else if (isFlyingKind(kind)) {
      sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sx));
      sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sz));
      sy = Math.max(1, Math.min(MAX_Y - 2, isFinite(sy) ? sy : BIRD_MIN_Y + 20));
      spot = placeMobExact(sx, sy, sz, hw, hh, created, isWolf, true);
    } else if (chainedIdx.has(i)) {
      sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sx));
      sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sz));
      sy = Math.max(1, Math.min(MAX_Y - 2, isFinite(sy) ? sy : BIRD_MIN_Y + 20));
      spot = placeMobExact(sx, sy, sz, hw, hh, created, isWolf, false);
      for (let n = 0; spot && n < 3 && isInsidePenPool(spot.x, spot.z); n++) {
        const moved = placeMobExact(spot.x + 2.5, spot.y, spot.z + 2.5, hw, hh, created, isWolf, false);
        if (!moved) break;
        spot = moved;
      }
    } else {
    if (isInsidePenPool(sx, sz)) {
      sx += 1.5; sz += 1.5;
    }
    spot = placeMobExact(sx, sy, sz, hw, hh, created, isWolf, false);
    for (let n = 0; n < 3 && isInsidePenPool(spot.x, spot.z); n++) {
      spot = placeMobExact(spot.x + 2.5, spot.y, spot.z + 2.5, hw, hh, created, isWolf, false);
    }
    }
    let homeId = e.homeId;
    if ((kind === "villager" || kind === "cat") && (homeId == null || homeId < 0 || homeId >= villageHouses.length)) homeId = villageHouses.length ? 0 : -1;
    if (kind !== "villager" && kind !== "cat") homeId = -1;
    const ryaw = isFinite(e.yaw) ? e.yaw : 0;
    let mesh = null;
    let palIdx = 0, collar = WOLF_COLLAR_COLORS[0], catVar = 0;
    let endermanVis = null;
    if (kind === "villager") {
      palIdx = (e.look >= 0 && e.look < VILLAGER_PALETTES.length) ? e.look : 0;
      mesh = makeVillagerMesh(isBaby, palIdx);
    } else if (kind === "pig") mesh = makePigMesh();
    else if (kind === "cow") mesh = makeCowMesh();
    else if (kind === "pigeon") mesh = makeBirdMesh();
    else if (kind === "parrot") mesh = makeParrotMesh((e.look >= 0 && e.look < PARROT_VARIANT_COUNT) ? e.look : 0);
    else if (kind === "cat") {
      catVar = (e.look >= 0 && e.look < CAT_ROBES.length) ? e.look : 0;
      mesh = makeCatMesh(catVar);
    } else if (kind === "enderman") {
      ensureEndermanAssets();
      endermanVis = makeEndermanMesh();
      mesh = endermanVis.g;
    } else if (kind === "iron_golem") {
      mesh = makeIronGolemMesh();
    } else {
      collar = WOLF_COLLAR_COLORS[(e.look >= 0 && e.look < WOLF_COLLAR_COLORS.length) ? e.look : 0];
      mesh = makeWolfMesh(WOLF_FUR, collar);
    }
    mesh.position.set(spot.x, spot.y, spot.z);
    mesh.rotation.y = ryaw;
    scene.add(mesh);
    const base = {
      id: gid++, kind, homeId, isBaby, parentId: -1, dim: "over",
      pos: new THREE.Vector3(spot.x, spot.y, spot.z),
      vel: new THREE.Vector3(0, 0, 0),
      hw, h: hh, mesh, onGround: false,
      target: null, mode: "wander", wanderT: 0.5 + Math.random() * 1.5, insideT: 0,
      legPhase: Math.random() * Math.PI * 2,
      blockedT: 0, yaw: ryaw, yawTarget: ryaw, villageBound: true,
      _stuckT: 0, _prevX: spot.x, _prevZ: spot.z,
      path: null, pathIdx: 0, pathKey: null, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
    };
    if (kind === "villager") {
      base.canStep = false;
      base.speed = WALK / 2;
      base.sc = isBaby ? 0.52 : 1;
      base.palIdx = palIdx;
    } else if (kind === "pig" || kind === "cow") {
      base.canStep = false;
      base.speed = WALK / 2.2;
      base.villageBound = false;
      base.penBound = true;
      base.penId = 0;
      base.sc = 1;
    } else if (kind === "iron_golem") {
      base.canStep = false;
      base.speed = WALK / 2;
      base.sc = 1;
    } else if (kind === "cat") {
      base.canStep = true;
      base.speed = WALK / 2;
      base.catVar = catVar;
      base.sc = 1;
      base.wolfStepUp = false;
      base.wolfStepUpClearY = 0;
      base.wolfInWater = false;
      base.wasOnGroundWolf = false;
    } else if (isBirdKind(kind)) {
      base.canStep = false;
      base.speed = BIRD_SPEED;
      base.villageBound = false;
      base.sc = 1;
      if (kind === "parrot") base.parrotVar = mesh.userData.parrotVar;
      base.arc = null;
      base.mode = "straight";
      base.perchSpot = null;
      base.perchGroup = null;
      base.perchT = 0;
      base.perchWander = null;
      base.perchWanderT = 0;
      base.perchTimeout = 0;
      base.perchRetry = 0;
      const yaw2 = isFinite(e.yaw) ? e.yaw : Math.random() * Math.PI * 2;
      base.yaw = yaw2;
      base.yawTarget = yaw2;
      base.vel.set(Math.cos(yaw2) * BIRD_SPEED, 0, Math.sin(yaw2) * BIRD_SPEED);
    } else if (kind === "enderman") {
      base.canStep = false;
      base.speed = WALK / 2;
      base.villageBound = false;
      base.sc = 1;
      base.g = endermanVis.g;
      base.eyeMat = endermanVis.eyeMat;
      base.eyes = endermanVis.eyes;
      base.armL = endermanVis.armL;
      base.armR = endermanVis.armR;
      base.head = endermanVis.head;
      base.haloMeshes = endermanVis.haloMeshes;
      base.t = 0;
      base.angry = 0;
      base.teleportT = 3 + Math.random() * 7;
      base.lookT = 0;
      base.baseY = spot.y;
      base.mesh.rotation.y = base.yaw;
      endermen.push(base);
    } else {
      base.canStep = true;
      base.speed = WALK / 2;
      base.fur = WOLF_FUR;
      base.collar = collar;
      base.sc = 1;
      base.wolfStepUp = false;
      base.wolfStepUpClearY = 0;
      base.wolfInWater = false;
      base.wasOnGroundWolf = false;
    }
    if (e.villageBound != null) base.villageBound = !!e.villageBound;
    else if (kind === "pig" || kind === "cow") base.villageBound = false;
    if (kind === "wolf") base.villageBound = false;
    if (e.penBound != null) base.penBound = !!e.penBound;
    mobs.push(base);
    mobById.set(base.id, base);
    idByListIdx[i] = base.id;
    created.push(base);
    if (e.portalSent || ((e.panicFlags & 4) !== 0)) base._frozenUntil = performance.now() / 1000 + PORTAL_ARRIVAL_FREEZE;
  }
  list.forEach((e, i) => {
    const nid = idByListIdx[i];
    if (nid == null) return;
    const cm = mobById.get(nid);
    if (!cm || e.parentIdx == null || e.parentIdx < 0 || e.parentIdx >= list.length) return;
    if (!((cm.kind === "villager" && cm.isBaby) || cm.kind === "cat")) return;
    const pid = idByListIdx[e.parentIdx];
    if (pid == null) return;
    cm.parentId = pid;
  });
  if (pendingChainLinks && pendingChainLinks.length) {
    for (const [a, b] of pendingChainLinks) {
      if (a === carriedIdx || b === carriedIdx) continue;
      if (a < 0 || b < 0 || a >= list.length || b >= list.length) continue;
      const ca = mobById.get(idByListIdx[a]), cb = mobById.get(idByListIdx[b]);
      if (!ca || !cb) continue;
      linkChain(ca, cb);
    }
  }
  pendingChainLinks = null;
  const panicResumed = new Set();
  if (applyPanic) {
    const idxByMobId = new Map();
    idByListIdx.forEach((nid, li) => { if (nid != null) idxByMobId.set(nid, li); });
    for (const m of created) {
      if (isChained(m) || m === carryMob) continue;
      const li = idxByMobId.get(m.id);
      if (li == null || !list[li]) continue;
      if (resumeMobPanic(m, list[li])) panicResumed.add(m.id);
    }
  }
  for (const m of created) {
    if (isChained(m)) continue;
    if (panicResumed.has(m.id)) {
      if (!isFlyingKind(m.kind)) m._settleUntil = performance.now() / 1000 + 12 + Math.random() * 8;
      continue;
    }
    if (isFlyingKind(m.kind)) {
      if (!m.target) m.target = birdRandomTarget(m.pos);
      m.wanderT = 2 + Math.random() * 4;
    } else {
      m.target = restoreInitialTarget(m);
      m.path = null;
      m.pathKey = null;
      m.wanderT = 2 + Math.random() * 4;
      delete m._settleUntil;
      if (dim === "over" && m.kind === "villager" && !m.isBaby && m.homeId >= 0) {
        const h = villageHouses[m.homeId];
        if (h && m.pos.x > h.minX && m.pos.x < h.maxX && m.pos.z > h.minZ && m.pos.z < h.maxZ) {
          m.mode = "inside";
          m.insideT = 4 + Math.random() * 6;
          m.target = randomInsidePoint(m.homeId);
          m.path = null;
          m.pathKey = null;
        }
      }
    }
  }
  if (carriedIdx >= 0 && idByListIdx[carriedIdx] != null) {
    const held = mobById.get(idByListIdx[carriedIdx]);
    if (held) {
      held.mode = "carried";
      held.vel.set(0, 0, 0);
      held.target = null;
      held.path = null;
      held.pathKey = null;
      held.blockedT = 0;
      held._stuckT = 0;
      if (held.isBaby) held._followDetourUntil = 0;
      held.mesh.visible = true;
      setMobTransparent(held, 0.35);
      carryMob = held;
      playerArms.visible = true;
    }
  }
  buildMobGrid();
  if (topUp) {
    spawnVillagers();
    spawnBirds();
  }
  return created.length;
}
function purgeDimMobs(dimName, keepHeld) {
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    if (mobDimOf(m) !== dimName || m.kind === "dragon") continue;
    if (keepHeld && (m === carryMob || m === carryGrappleMob)) continue;
    dropChainFrom(m);
    if (m.mesh) scene.remove(m.mesh);
    if (m.fallMesh) scene.remove(m.fallMesh);
    mobById.delete(m.id);
    mobs.splice(i, 1);
  }
  for (let i = endermen.length - 1; i >= 0; i--) if (!mobs.includes(endermen[i])) endermen.splice(i, 1);
  pruneChains();
  buildMobGrid();
}
function relinkDimChainsByIds(idByListIdx, pairs) {
  if (!pairs || !pairs.length || !idByListIdx) return;
  for (const [a, b] of pairs) {
    if (b < 0 || b >= idByListIdx.length) continue;
    const cb = idByListIdx[b] != null ? mobById.get(idByListIdx[b]) : null;
    if (!cb) continue;
    if (a === DRAGON_CHAIN_CARRIER) {
      const dm = dragon && dragon.mob;
      if (!dm || !mobs.includes(dm) || mobDimOf(dm) !== mobDimOf(cb)) continue;
      linkChain(dm, cb);
      continue;
    }
    if (a < 0 || a >= idByListIdx.length) continue;
    const ca = idByListIdx[a] != null ? mobById.get(idByListIdx[a]) : null;
    if (!ca) continue;
    linkChain(ca, cb);
  }
}
function restoreDimMobs(list, dimName, opts) {
  if (!list || !list.length) return { n: 0, ids: [] };
  const applyPanic = !!opts && opts.applyPanic === true;
  purgeDimMobs(dimName, true);
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  const created = [];
  const idByListIdx = new Array(list.length).fill(null);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const kind = mobKindFromCode(e.kind);
    if (kind === "dragon") continue;
    const isBaby = !!e.isBaby && kind === "villager";
    const hw = isBirdKind(kind) ? 0.25 : kind === "wolf" ? 0.30 : kind === "cat" ? CAT_HW : (kind === "pig" || kind === "cow") ? 0.32 : kind === "enderman" ? ENDERMAN_HW : kind === "iron_golem" ? GOLEM_HW : (isBaby ? 0.16 : 0.27);
    const hh = isBirdKind(kind) ? 0.5 : kind === "wolf" ? 0.90 : kind === "cat" ? CAT_HH : kind === "pig" ? 0.92 : kind === "cow" ? 1.30 : kind === "enderman" ? ENDERMAN_H : kind === "iron_golem" ? GOLEM_HH : (isBaby ? 0.98 : 1.82);
    let sx = e.x, sy = e.y, sz = e.z;
    if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz)) continue;
    sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sx));
    sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sz));
    sy = Math.max(1, Math.min(MAX_Y - 2, isFinite(sy) ? sy : 30));
    if (dimName === "end") {
      sx = endSquareCoord(sx); sz = endSquareCoord(sz);
      if (!isFlyingKind(kind)) sy = Math.max(END_PLATFORM_TOP + 1, Math.min(DRAGON_MAX_Y, sy));
    }
    if (aabbCollidesWorld(sx, sy, sz, hw, hh) || mobRestoreOverlapsPlaced(sx, sy, sz, hw, hh, created)) {
      const fixed = placeMobExact(sx, sy, sz, hw, hh, created, isJumpingKind(kind), isFlyingKind(kind));
      sx = fixed.x; sy = fixed.y; sz = fixed.z;
    }
    const ryaw = isFinite(e.yaw) ? e.yaw : 0;
    let mesh = null, palIdx = 0, collar = WOLF_COLLAR_COLORS[0], endermanVis = null, catVar = 0;
    if (kind === "villager") {
      palIdx = (e.look >= 0 && e.look < VILLAGER_PALETTES.length) ? e.look : 0;
      mesh = makeVillagerMesh(isBaby, palIdx);
    } else if (kind === "pig") mesh = makePigMesh();
    else if (kind === "cow") mesh = makeCowMesh();
    else if (kind === "pigeon") mesh = makeBirdMesh();
    else if (kind === "parrot") mesh = makeParrotMesh((e.look >= 0 && e.look < PARROT_VARIANT_COUNT) ? e.look : 0);
    else if (kind === "cat") {
      catVar = (e.look >= 0 && e.look < CAT_ROBES.length) ? e.look : 0;
      mesh = makeCatMesh(catVar);
    } else if (kind === "enderman") {
      ensureEndermanAssets();
      endermanVis = makeEndermanMesh();
      mesh = endermanVis.g;
    } else if (kind === "iron_golem") {
      mesh = makeIronGolemMesh();
    } else {
      collar = WOLF_COLLAR_COLORS[(e.look >= 0 && e.look < WOLF_COLLAR_COLORS.length) ? e.look : 0];
      mesh = makeWolfMesh(WOLF_FUR, collar);
    }
    mesh.position.set(sx, sy, sz);
    mesh.rotation.y = ryaw;
    scene.add(mesh);
    const base = {
      id: gid++, kind, homeId: ((kind === "villager" || kind === "cat") && e.homeId != null && e.homeId >= 0) ? e.homeId : -1, isBaby, parentId: -1, dim: dimName,
      pos: new THREE.Vector3(sx, sy, sz),
      vel: new THREE.Vector3(0, 0, 0),
      hw, h: hh, mesh, onGround: false,
      target: null, mode: "wander", wanderT: 0.5 + Math.random() * 1.5, insideT: 0,
      legPhase: Math.random() * Math.PI * 2,
      blockedT: 0, yaw: ryaw, yawTarget: ryaw, villageBound: e.villageBound != null ? !!e.villageBound : false,
      _stuckT: 0, _prevX: sx, _prevZ: sz,
      path: null, pathIdx: 0, pathKey: null, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
    };
    if (e.penBound != null) base.penBound = !!e.penBound;
    if (kind === "wolf") base.villageBound = false;
    if (kind === "villager") { base.canStep = false; base.speed = WALK / 2; base.sc = isBaby ? 0.52 : 1; base.palIdx = palIdx; }
    else if (kind === "pig" || kind === "cow") { base.canStep = false; base.speed = WALK / 2.2; if (e.penBound == null) base.penBound = false; base.sc = 1; }
    else if (kind === "iron_golem") { base.canStep = false; base.speed = WALK / 2; base.sc = 1; }
    else if (kind === "cat") { base.canStep = true; base.speed = WALK / 2; base.catVar = catVar; base.sc = 1; base.wolfStepUp = false; base.wolfStepUpClearY = 0; base.wolfInWater = false; base.wasOnGroundWolf = false; }
  else if (kind === "cat") {
    mesh = makeCatMesh(pickCatRobe());
    hw = CAT_HW; hh = CAT_HH; canStep = true;
    extra = { catVar: mesh.userData.catVar, wolfStepUp: false, wolfStepUpClearY: 0, wolfInWater: false, wasOnGroundWolf: false };
  }
  else if (isBirdKind(kind)) {
      base.canStep = false; base.speed = BIRD_SPEED; base.sc = 1; base.arc = null; base.mode = "straight";
      if (kind === "parrot") base.parrotVar = mesh.userData.parrotVar;
      base.perchSpot = null; base.perchGroup = null; base.perchT = 0; base.perchWander = null; base.perchWanderT = 0;
      base.perchTimeout = 0; base.perchRetry = 0;
      base.vel.set(Math.cos(ryaw) * BIRD_SPEED, 0, Math.sin(ryaw) * BIRD_SPEED);
    } else if (kind === "enderman") {
      base.canStep = false; base.speed = WALK / 2; base.sc = 1;
      base.g = endermanVis.g; base.eyeMat = endermanVis.eyeMat; base.eyes = endermanVis.eyes;
      base.armL = endermanVis.armL; base.armR = endermanVis.armR; base.head = endermanVis.head;
      base.haloMeshes = endermanVis.haloMeshes;
      base.t = 0; base.angry = 0; base.teleportT = 3 + Math.random() * 7; base.lookT = 0;
      base.baseY = sy; base.mesh.rotation.y = base.yaw;
      endermen.push(base);
    } else { base.canStep = true; base.speed = WALK / 2; base.fur = WOLF_FUR; base.collar = collar; base.sc = 1; base.wolfStepUp = false; base.wolfStepUpClearY = 0; base.wolfInWater = false; base.wasOnGroundWolf = false; }
    mobs.push(base);
    mobById.set(base.id, base);
    idByListIdx[i] = base.id;
    created.push(base);
    if (e.portalSent || ((e.panicFlags & 4) !== 0)) base._frozenUntil = performance.now() / 1000 + PORTAL_ARRIVAL_FREEZE;
  }
  list.forEach((e, i) => {
    const nid = idByListIdx[i];
    if (nid == null) return;
    const cm = mobById.get(nid);
    if (!cm || e.parentIdx == null || e.parentIdx < 0 || e.parentIdx >= list.length) return;
    if (!((cm.kind === "villager" && cm.isBaby) || cm.kind === "cat")) return;
    const pid = idByListIdx[e.parentIdx];
    if (pid == null) return;
    cm.parentId = pid;
  });
  const panicResumedDim = new Set();
  if (applyPanic) {
    const idxByMobId = new Map();
    idByListIdx.forEach((nid, li) => { if (nid != null) idxByMobId.set(nid, li); });
    for (const m of created) {
      if (isChained(m) || m === carryMob) continue;
      const li = idxByMobId.get(m.id);
      if (li == null || !list[li]) continue;
      if (resumeMobPanic(m, list[li])) panicResumedDim.add(m.id);
    }
  }
  for (const m of created) {
    if (isChained(m)) continue;
    if (panicResumedDim.has(m.id)) {
      if (!isFlyingKind(m.kind)) m._settleUntil = performance.now() / 1000 + 12 + Math.random() * 8;
      continue;
    }
    if (isFlyingKind(m.kind)) { if (!m.target) m.target = birdRandomTarget(m.pos); m.wanderT = 2 + Math.random() * 4; }
    else {
      m.target = restoreInitialTarget(m);
      m.path = null;
      m.pathKey = null;
      m.wanderT = 2 + Math.random() * 4;
      delete m._settleUntil;
      if (dim === "over" && m.kind === "villager" && !m.isBaby && m.homeId >= 0) {
        const h = villageHouses[m.homeId];
        if (h && m.pos.x > h.minX && m.pos.x < h.maxX && m.pos.z > h.minZ && m.pos.z < h.maxZ) {
          m.mode = "inside";
          m.insideT = 4 + Math.random() * 6;
          m.target = randomInsidePoint(m.homeId);
          m.path = null;
          m.pathKey = null;
        }
      }
    }
  }
  buildMobGrid();
  return { n: created.length, ids: idByListIdx };
}
function intersectsMob(bx, by, bz, ignoreBirds) {
  const nearby = nearbyMobsFor(bx + 0.5, bz + 0.5, 1);
  for (const m of nearby) {
    if (isFlyingKind(m.kind) && m.kind !== "dragon" && ignoreBirds) continue;
    if (isMobHeld(m)) continue;
    if (isChained(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    const hw = villagerHW(m) + 0.05, hh = villagerH(m);
    const mx = m.pos.x, my = m.pos.y, mz = m.pos.z;
    if (bx + 1 > mx - hw && bx < mx + hw && by + 1 > my && by < my + hh && bz + 1 > mz - hw && bz < mz + hw) return true;
  }
  return false;
}
function isMobStandingOn(bx, by, bz, ignoreBirds) {
  const nearby = nearbyMobsFor(bx + 0.5, bz + 0.5, 1);
  for (const m of nearby) {
    if (isFlyingKind(m.kind) && m.kind !== "dragon" && ignoreBirds) continue;
    if (isMobHeld(m)) continue;
    if (isChained(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    const hw = villagerHW(m);
    const mx = m.pos.x, my = m.pos.y, mz = m.pos.z;
    const ox0 = Math.max(mx - hw, bx), ox1 = Math.min(mx + hw, bx + 1);
    const oz0 = Math.max(mz - hw, bz), oz1 = Math.min(mz + hw, bz + 1);
    if (ox1 - ox0 <= 0.02 || oz1 - oz0 <= 0.02) continue;
    if (Math.abs(my - (by + 1)) < 0.35) return true;
  }
  return false;
}
function separateMobs() {
  for (let iter = 0; iter < 3; iter++) {
    let anyMoved = false;
    for (const m of mobs) {
      if (isMobHeld(m)) continue;
      if (isChained(m)) continue;
      if (isFlyingKind(m.kind) || m.kind === "enderman") continue;
      if (isMobFrozenByGrapple(m)) continue;
      if (isArrivalFrozen(m)) continue;
      if (m._fillSlide) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      let sx = 0, sz = 0, cnt = 0;
      const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 1);
      const fleeingSelf = m.fleeUntil && performance.now() / 1000 < m.fleeUntil;
      for (const o of nearby) {
        if (o === m || isMobHeld(o)) continue;
        if (isChained(o)) continue;
        if (isFlyingKind(o.kind) || o.kind === "enderman") continue;
        if (isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(m) + villagerHW(o) + 0.18;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && mobBondedPair(m, o)) {
            need = (villagerHW(m) + villagerHW(o)) * 0.62 + 0.10;
          }
        }
        const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < need * need && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const overlap = need - d;
          const push = overlap * (fleeingSelf ? 0.92 : 0.68);
          sx += (dx / d) * push; sz += (dz / d) * push; cnt++;
        } else if (d2 < (need + 0.45) * (need + 0.45) && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const w = (need + 0.45 - d) / 0.45;
          const push = w * 0.05;
          sx += (dx / d) * push; sz += (dz / d) * push; cnt++;
        }
      }
      if (cnt) {
        let nx = m.pos.x + sx, nz = m.pos.z + sz;
        const hg = m.canStep ? wolfHasMobGround : hasMobGround;
        const pigBlocked = (x,z)=> isPigCow(m) && pigOverlapsFence(x,z,m.hw);
        if (!aabbCollidesWorld(nx, m.pos.y, nz, m.hw, m.h) && hg(nx, nz, m.hw, m.pos.y) && !pigBlocked(nx,nz)) {
          m.pos.x = nx; m.pos.z = nz; anyMoved = true;
          if (mobStats) mobStats.mobCol++;
        } else {
          const tryX = m.pos.x + sx, tryZ = m.pos.z;
          if (Math.abs(sx) > 0.001 && !aabbCollidesWorld(tryX, m.pos.y, tryZ, m.hw, m.h) && hg(tryX, tryZ, m.hw, m.pos.y) && !pigBlocked(tryX,tryZ)) {
            m.pos.x = tryX; anyMoved = true; if (mobStats) mobStats.mobCol++;
          } else {
            const tryX2 = m.pos.x, tryZ2 = m.pos.z + sz;
            if (Math.abs(sz) > 0.001 && !aabbCollidesWorld(tryX2, m.pos.y, tryZ2, m.hw, m.h) && hg(tryX2, tryZ2, m.hw, m.pos.y) && !pigBlocked(tryX2,tryZ2)) {
              m.pos.z = tryZ2; anyMoved = true; if (mobStats) mobStats.mobCol++;
            } else {
              const s = 0.14 * Math.sign(sx || (Math.random() - 0.5));
              const t2 = 0.14 * Math.sign(sz || (Math.random() - 0.5));
              const px = m.pos.x + s, pz = m.pos.z + t2;
              if (!aabbCollidesWorld(px, m.pos.y, pz, m.hw, m.h) && hg(px, pz, m.hw, m.pos.y) && !pigBlocked(px,pz)) {
                m.pos.x = px; m.pos.z = pz; anyMoved = true; if (mobStats) mobStats.mobCol++;
              }
            }
          }
        }
      }
    }
    if (!anyMoved) break;
    if (iter < 2) buildMobGrid();
  }
}
function pushMobsFromPlayer() {
  if (dim === "over") {
    const y = villageCenter.y + 1;
    if (Math.abs(pos.y - y) > 1.8) return;
  }
  const nearby = nearbyMobsFor(pos.x, pos.z, 2);
  for (const m of nearby) {
    if (isMobHeld(m)) continue;
    if (isChained(m)) continue;
    if (m.kind === "dragon" || m.kind === "enderman") continue;
    if (isMobFrozenByGrapple(m)) continue;
    if (isArrivalFrozen(m)) continue;
    if (m._fillSlide) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    const fleeing = m.fleeUntil && performance.now() / 1000 < m.fleeUntil;
    const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z;
    const d2 = dx * dx + dz * dz;
    const need = (PLAYER_HW + villagerHW(m) + 0.08);
    if (d2 < need * need && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (need - d) * (fleeing ? 0.22 : 0.30);
      const nx = m.pos.x + (dx / d) * push, nz = m.pos.z + (dz / d) * push;
      const hg2 = m.canStep ? wolfHasMobGround : hasMobGround;
      if (!aabbCollidesWorld(nx, m.pos.y, nz, m.hw, m.h) && !mobCollidesOther(m, nx, nz) && hg2(nx, nz, m.hw, m.pos.y) && !(isPigCow(m) && pigOverlapsFence(nx,nz,m.hw))) {
        m.pos.x += (nx - m.pos.x) * (fleeing ? 0.55 : 0.50);
        m.pos.z += (nz - m.pos.z) * (fleeing ? 0.55 : 0.50);
        if (mobStats) mobStats.playerCol++;
      }
      const pPush = (need - d) * 0.15;
      const px = pos.x - (dx / d) * pPush, pz = pos.z - (dz / d) * pPush;
      if (!aabbCollidesWorld(px, pos.y, pz, PLAYER_HW, PLAYER_H)) { pos.x = px; pos.z = pz; }
    }
  }
}
function mobWouldCollide(mob, nx, nz) {
  if (isMobHeld(mob)) return false;
  const hw = villagerHW(mob);
  const y = mob.pos.y;
  const nearby = nearbyMobsFor(nx, nz, 1);
  const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
  for (const o of nearby) {
    if (o === mob || isMobHeld(o) || isMobFrozenByGrapple(o)) continue;
    if (isChained(o)) continue;
    if (o.kind === "dragon" || o.kind === "enderman") continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    let need = hw + villagerHW(o) + 0.04;
    if (!fleeingSelf) {
      const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
      if (!oflee && mobBondedPair(mob, o)) {
        need = (hw + villagerHW(o)) * 0.62 + 0.06;
      }
    }
    if (Math.abs(y - o.pos.y) > 1.2) continue;
    const dx = nx - o.pos.x, dz = nz - o.pos.z;
    if (dx * dx + dz * dz < need * need) return true;
  }
  return false;
}
function stickyTurnSide(m) {
  const nowS = performance.now() / 1000;
  if (m._turnT === undefined || nowS - m._turnT > 0.8) { m._turnSide = !m._turnSide; m._turnT = nowS; }
  return m._turnSide ? 1 : -1;
}
function obstacleTurnDir(m, probeFree, dist) {
  const d = dist || 2.2;
  let hx = m.vel ? m.vel.x : 0, hz = m.vel ? m.vel.z : 0;
  if (Math.hypot(hx, hz) < 0.3) {
    const yaw = m.mesh ? m.mesh.rotation.y : 0;
    hx = Math.sin(yaw); hz = Math.cos(yaw);
  }
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const fl = probeFree(m.pos.x, m.pos.z, hz, -hx, d, m.hw, m.pos.y);
  const fr = probeFree(m.pos.x, m.pos.z, -hz, hx, d, m.hw, m.pos.y);
  if (fl >= 0.35 || fr >= 0.35) {
    if (fl > fr + 0.05) return { x: hz, z: -hx };
    if (fr > fl + 0.05) return { x: -hz, z: hx };
    const s = stickyTurnSide(m);
    return s > 0 ? { x: hz, z: -hx } : { x: -hz, z: hx };
  }
  return { x: -hx, z: -hz };
}
const HEADON_DIST = 2.4;
const HEADON_FREE_MIN = 1.0;
const HEADON_FREE_PROBE = 2.2;
const HEADON_FREEZE_T = 1.0;
function mobHeadonHeading(m) {
  let hx = m.vel ? m.vel.x : 0, hz = m.vel ? m.vel.z : 0;
  if (Math.hypot(hx, hz) < 0.3) {
    const yaw = m.mesh ? m.mesh.rotation.y : (m.yaw || 0);
    hx = Math.sin(yaw); hz = Math.cos(yaw);
  }
  const l = Math.hypot(hx, hz) || 1;
  return { x: hx / l, z: hz / l };
}
function isHeadonWalker(m) {
  if (!m || isMobHeld(m) || isChained(m) || isMobFrozenByGrapple(m)) return false;
  if (isStrictFollower(m)) return false;
  if (m.dim !== undefined && m.dim !== dim) return false;
  if (isFlyingKind(m.kind) || m.kind === "dragon" || m.kind === "enderman") return false;
  return !m.kind || m.kind === "villager" || m.kind === "pig" || m.kind === "cow" || m.kind === "wolf" || m.kind === "cat";
}
function headonSidestepOk(m, tx, tz) {
  if (aabbCollidesWorld(tx, m.pos.y, tz, m.hw, m.h)) return false;
  if (!mobHasGroundFor(m, tx, tz, m.hw, m.pos.y)) return false;
  if (isPigCow(m) && pigOverlapsFence(tx, tz, m.hw)) return false;
  if (typeof isInsidePool === "function" && isInsidePool(tx, tz)) return false;
  if (typeof isInsidePenPool === "function" && isInsidePenPool(tx, tz)) return false;
  if (dim === "over" && (m.kind === "pig" || m.kind === "cow") && typeof isInsidePen === "function" && isInsidePen(m.pos.x, m.pos.z) && !isInsidePen(tx, tz)) return false;
  if (dim === "over" && villageHouses.length && m.villageBound !== false) {
    if (tx < villageMinX + 1 || tx > villageMaxX - 1 || tz < villageMinZ + 1 || tz > villageMaxZ - 1) return false;
  }
  if (m.homeId != null && m.homeId >= 0 && villageHouses[m.homeId]) {
    const h = villageHouses[m.homeId];
    const inHome = m.pos.x > h.minX && m.pos.x < h.maxX && m.pos.z > h.minZ && m.pos.z < h.maxZ;
    if (inHome && (tx <= h.minX + 0.4 || tx >= h.maxX - 0.4 || tz <= h.minZ + 0.4 || tz >= h.maxZ - 0.4)) return false;
  }
  return true;
}
function applyHeadonSidestep(m, dx, dz, free) {
  const sp = m.speed || WALK / 2;
  const step = Math.min(2.5, Math.max(1.5, free));
  const tx = m.pos.x + dx * step, tz = m.pos.z + dz * step;
  if (headonSidestepOk(m, tx, tz)) {
    m._headonTX = tx; m._headonTZ = tz;
    m._headonSteerT = 0.6;
    m.steerX = dx * sp; m.steerZ = dz * sp; m.steerCooldown = 0.6;
    m.path = null; m.pathKey = null;
  } else {
    m._headonTX = null; m._headonTZ = null;
    m._headonSteerT = 0.45;
    m.steerX = dx * sp; m.steerZ = dz * sp; m.steerCooldown = 0.45;
  }
}
function resolveHeadOn() {
  const nowS = performance.now() / 1000;
  for (const a of mobs) {
    if (!isHeadonWalker(a)) continue;
    if ((a._headonFreezeT || 0) > 0 || (a._headonSteerT || 0) > 0) continue;
    if (nowS < (a._headonCooldown || 0)) continue;
    if (Math.hypot(a.vel.x, a.vel.z) < 0.5) continue;
    const nearby = nearbyMobsFor(a.pos.x, a.pos.z, 2);
    for (const b of nearby) {
      if (b === a || b.id < a.id) continue;
      if (!isHeadonWalker(b)) continue;
      if ((b._headonFreezeT || 0) > 0 || (b._headonSteerT || 0) > 0) continue;
      if (nowS < (b._headonCooldown || 0)) continue;
      if (Math.hypot(b.vel.x, b.vel.z) < 0.5) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
      if (mobBondedPair(a, b)) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > HEADON_DIST || d < 0.0001) continue;
      const closing = (dx * (b.vel.x - a.vel.x) + dz * (b.vel.z - a.vel.z)) / d;
      if (closing > -0.2) continue;
      const ha = mobHeadonHeading(a), hb = mobHeadonHeading(b);
      if ((ha.x * dx + ha.z * dz) / d < 0.3) continue;
      if ((hb.x * -dx + hb.z * -dz) / d < 0.3) continue;
      for (const m of [a, b]) {
        const h = mobHeadonHeading(m);
        const fl = mobProbeFreeFor(m, m.pos.x, m.pos.z, h.z, -h.x, HEADON_FREE_PROBE, m.hw, m.pos.y);
        const fr = mobProbeFreeFor(m, m.pos.x, m.pos.z, -h.z, h.x, HEADON_FREE_PROBE, m.hw, m.pos.y);
        if (fl <= HEADON_FREE_MIN && fr <= HEADON_FREE_MIN && !isChainCarrier(m)) {
          m._headonFreezeT = HEADON_FREEZE_T;
          m._headonSteerT = 0; m._headonTX = null; m._headonTZ = null;
          m._headonCooldown = nowS + 1.5;
          m.vel.x = 0; m.vel.z = 0;
        } else {
          let dx2, dz2, free;
          if (fl > fr + 0.05) { dx2 = h.z; dz2 = -h.x; free = fl; }
          else if (fr > fl + 0.05) { dx2 = -h.z; dz2 = h.x; free = fr; }
          else { m._turnSide = !m._turnSide; dx2 = m._turnSide ? h.z : -h.z; dz2 = m._turnSide ? -h.x : h.x; free = Math.max(fl, fr); }
          m._headonCooldown = nowS + 1.5;
          applyHeadonSidestep(m, dx2, dz2, free);
        }
      }
      break;
    }
  }
}
let liveFillCells = null;
let liveFillWin = null;
function rebuildLiveFillCells() {
  liveFillCells = new Set();
  liveFillWin = new Map();
  for (const f of portalFills.values()) {
    if (f.dim !== dim) continue;
    if (f.dim === "end" && !endCleared) continue;
    if (!portalFillValid(f)) continue;
    for (const [x, y, z] of portalFillCells(f.win, f.nether)) {
      const k = x + "," + y + "," + z;
      liveFillCells.add(k);
      if (!liveFillWin.has(k)) liveFillWin.set(k, f);
    }
  }
}
function mobBodyFillCells(m) {
  const out = [];
  if (!liveFillCells || !liveFillCells.size || !m) return out;
  const x0 = Math.floor(m.pos.x - m.hw), x1 = Math.floor(m.pos.x + m.hw);
  const y0 = Math.floor(m.pos.y), y1 = Math.floor(m.pos.y + m.h - 0.001);
  const z0 = Math.floor(m.pos.z - m.hw), z1 = Math.floor(m.pos.z + m.hw);
  for (let bx = x0; bx <= x1; bx++)
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        if (liveFillCells.has(bx + "," + by + "," + bz)) out.push([bx, by, bz]);
  return out;
}
function fillSlideGroundSpot(m, sx, sy, sz, boxes) {
  for (let r = 1; r <= 16; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8]) {
        const ix = Math.floor(sx) + dx, iz = Math.floor(sz) + dz;
        if (ix < -WORLD_RADIUS + 1 || ix > WORLD_RADIUS - 1 || iz < -WORLD_RADIUS + 1 || iz > WORLD_RADIUS - 1) continue;
        if (boxes) {
          let framed = false;
          for (const box of boxes) {
            if (chebDistToBox(ix, iz, box) < 1) { framed = true; break; }
          }
          if (framed) continue;
        }
        const gy = groundYForMob(ix + 0.5, iz + 0.5, sy + dy, m.hw);
        if (!isFinite(gy) || gy < 1 || gy > MAX_Y - 2) continue;
        if (aabbCollidesWorld(ix + 0.5, gy, iz + 0.5, m.hw, m.h)) continue;
        if (!hasMobGround(ix + 0.5, iz + 0.5, m.hw, gy)) continue;
        let bad = false;
        for (let by = Math.floor(gy); by <= Math.floor(gy + m.h - 0.001); by++) {
          if (liveFillCells.has(ix + "," + by + "," + iz)) { bad = true; break; }
        }
        if (bad) continue;
        return { x: ix + 0.5, y: gy, z: iz + 0.5 };
      }
    }
  }
  return null;
}
function startFillSlide(m) {
  m._fillOverlapT = 0;
  if (!liveFillCells || !liveFillCells.size) return;
  const overlap = mobBodyFillCells(m);
  const boxes = [];
  const seenBox = new Set();
  for (const [bx, by, bz] of overlap) {
    const f = liveFillWin ? liveFillWin.get(bx + "," + by + "," + bz) : null;
    if (!f || seenBox.has(f)) continue;
    seenBox.add(f);
    boxes.push(portalFrameBBox(f.win));
  }
  let sx = m.pos.x, sy = m.pos.y, sz = m.pos.z;
  let bestD = Infinity, best = null;
  const seen = new Set();
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [bx, by, bz] of overlap) {
    for (const [ox, oy, oz] of DIRS) {
      const nx = bx + ox, ny = by + oy, nz = bz + oz;
      const k = nx + "," + ny + "," + nz;
      if (seen.has(k)) continue;
      seen.add(k);
      if (ny < 1 || ny > MAX_Y - 2) continue;
      if (liveFillCells.has(k)) continue;
      if (isSolid(nx, ny, nz)) continue;
      const d = (nx + 0.5 - m.pos.x) ** 2 + (ny - m.pos.y) ** 2 + (nz + 0.5 - m.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = [nx, ny, nz]; }
    }
  }
  if (best) { sx = best[0] + 0.5; sy = best[1]; sz = best[2] + 0.5; }
  const pts = [[sx, sy, sz]];
  const g = fillSlideGroundSpot(m, sx, sy, sz, boxes.length ? boxes : null);
  if (g) pts.push([g.x, g.y, g.z]);
  else {
    const down = groundYDown(sx, sz, sy, m.hw);
    let downOk = down != null && down >= 1 && down <= MAX_Y - 2;
    if (downOk && boxes.length) {
      const ix = Math.floor(sx), iz = Math.floor(sz);
      for (const box of boxes) {
        if (chebDistToBox(ix, iz, box) < 1) { downOk = false; break; }
      }
    }
    if (downOk) pts.push([sx, down, sz]);
  }
  m._fillSlide = { pts, i: 0 };
  if (isBirdKind(m.kind)) { m.perchSpot = null; m.perchGroup = null; }
}
function updateMobs(dt) {
  if (!mobs.length) return;
  rebuildLiveFillCells();
  const over = (dim === "over" && villageHouses.length) || dim === "nether";
  if (over) {
    mobTick++;
    buildMobGrid();
    separateMobs();
    pushMobsFromPlayer();
    resolveHeadOn();
  } else {
    buildMobGrid();
    resolveHeadOn();
  }
  if (mobStats) mobStats.frames++;
  const g = GRAVITY;
  for (let idx = mobs.length - 1; idx >= 0; idx--) {
    const m = mobs[idx];
    if (m.kind === "enderman" && (m === carryMob || isMobFrozenByGrapple(m))) { updateEnderman(m, dt); continue; }
    if (isMobHeld(m)) continue;
    if (isChained(m)) { m.mesh.position.copy(m.pos); continue; }
    if (isMobFrozenByGrapple(m)) continue;
    if (isArrivalFrozen(m)) {
      if (m.vel) m.vel.set(0, 0, 0);
      if (m.mesh) m.mesh.position.copy(m.pos);
      continue;
    }
    if (starRideMob(m, dt)) continue;
    if (m.kind !== "dragon" && mobDimOf(m) === dim) {
      if (m._fillSlide) {
        const s = m._fillSlide;
        const t = s.pts[s.i];
        if (t) {
          const dx = t[0] - m.pos.x, dy = t[1] - m.pos.y, dz = t[2] - m.pos.z;
          const dist = Math.hypot(dx, dy, dz);
          const step = FILL_SLIDE_SPEED * dt;
          if (dist <= step + 0.02) {
            m.pos.set(t[0], t[1], t[2]);
            s.i++;
            if (s.i >= s.pts.length) {
              delete m._fillSlide;
              if (m.vel) m.vel.set(0, 0, 0);
              if (m.kind === "enderman") m.baseY = m.pos.y;
            }
          } else {
            m.pos.x += dx / dist * step;
            m.pos.y += dy / dist * step;
            m.pos.z += dz / dist * step;
          }
        } else delete m._fillSlide;
        if (m.vel) m.vel.set(0, 0, 0);
        if (m.mesh) m.mesh.position.copy(m.pos);
        continue;
      }
      if (mobBodyFillCells(m).length) {
        m._fillOverlapT = (m._fillOverlapT || 0) + dt;
        if (m._fillOverlapT > FILL_SLIDE_TRIGGER_T && !m._fillSlide) startFillSlide(m);
      } else if (m._fillOverlapT) m._fillOverlapT = 0;
    }
    if (m.dim !== undefined && m.dim !== dim) {
      if (isFlyingKind(m.kind) || m.kind === "enderman") { m.mesh.position.copy(m.pos); continue; }
      if (m.pos.y < -15) { scene.remove(m.mesh); mobById.delete(m.id); mobs.splice(idx, 1); continue; }
      if (m.vel == null) m.vel = new THREE.Vector3(0,0,0);
      const footY2 = Math.floor(m.pos.y);
      const hasG2 = isSolid(Math.floor(m.pos.x), footY2 - 1, Math.floor(m.pos.z));
      if (!hasG2) {
        m.vel.y -= GRAVITY * dt;
        m.pos.y += m.vel.y * dt;
        const nf = Math.floor(m.pos.y);
        if (isSolid(Math.floor(m.pos.x), nf - 1, Math.floor(m.pos.z))) {
          let gg = nf - 1;
          while (gg > 0 && !isSolid(Math.floor(m.pos.x), gg, Math.floor(m.pos.z))) gg--;
          m.pos.y = gg + 1;
          m.vel.y = 0;
        }
        m.mesh.position.copy(m.pos);
      } else {
        m.vel.y = 0;
        m.mesh.position.copy(m.pos);
      }
      continue;
    }
    const now = performance.now() / 1000;
    if (m.kind === "dragon") continue;
    if (m.kind === "enderman") { updateEnderman(m, dt); continue; }
    if (isBirdKind(m.kind)) {
      if (dim !== "over" && dim !== "end" && dim !== "nether") { m.mesh.position.copy(m.pos); continue; }
      if (m._chainFall) {
        if (m.vel == null) m.vel = new THREE.Vector3(0, 0, 0);
        m.vel.y -= GRAVITY * dt;
        m.pos.y += m.vel.y * dt;
        const fb = Math.floor(m.pos.y);
        if (isSolid(Math.floor(m.pos.x), fb - 1, Math.floor(m.pos.z))) {
          let gg = fb - 1;
          while (gg > 0 && !isSolid(Math.floor(m.pos.x), gg, Math.floor(m.pos.z))) gg--;
          m.pos.y = gg + 1;
          m.vel.y = 0;
          m._chainFall = false;
          resumeChainedMob(m);
        } else if (m.pos.y < -15) {
          const gy = groundYForMob(m.pos.x, m.pos.z, 30, m.hw);
          m.pos.set(m.pos.x, gy, m.pos.z);
          m.vel.set(0, 0, 0);
          m._chainFall = false;
          resumeChainedMob(m);
        }
        m.mesh.position.copy(m.pos);
        continue;
      }
      updateBird(m, dt);
      continue;
    }
    if (m.pos.y < -15) {
      if (m.villageBound === false) {
        const gy = groundYForMob(m.pos.x, m.pos.z, 30, m.hw);
        m.pos.set(m.pos.x, gy, m.pos.z);
        m.vel.set(0, 0, 0);
        m.onGround = true;
      } else {
        scene.remove(m.mesh);
        mobById.delete(m.id);
        mobs.splice(idx, 1);
        if (mobStats) mobStats.falls++;
        continue;
      }
    }
    // Physics step will be done after AI sets vel
    const prevX = m.pos.x, prevZ = m.pos.z;
    if ((m._headonFreezeT || 0) > 0) {
      m._headonFreezeT -= dt;
      if (m._headonFreezeT < 0) m._headonFreezeT = 0;
      m.vel.x = 0; m.vel.z = 0;
      if (m.canStep) wolfPhysicsStep(m, dt, g);
      else mobPhysicsStep(m, dt, g);
      m.mesh.position.copy(m.pos);
      continue;
    }
    addVisit(m.pos.x, m.pos.z);
    if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) { mobInvariantsViolated++; if (mobStats) mobStats.invariants++; }
    // Step-capable mobs (wolves) — instant step, no block feeling (leave the village when panicking inside it, or flee away outside)
    if (m.canStep && m.kind !== "cat") {
      if (m.fleeUntil != null && now < m.fleeUntil) {
        if (m._outsideFlee || m._villageFlee) {
          m.speed = WALK * 2;
          m.wanderT -= dt;
          if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.7 || m.wanderT <= 0) {
            m.target = m._villageFlee ? wolfLeaveTarget(m, m._fleeSrcX, m._fleeSrcZ) : fleePointAway(m, m._fleeSrcX, m._fleeSrcZ);
            m.wanderT = 1.2 + Math.random() * 0.8;
            m.steerCooldown = 0; m.path = null; m.pathKey = null;
          }
        } else {
          m.speed = WALK * 2;
          m.wanderT -= dt;
          if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6 || m.wanderT <= 0) {
            m.target = wanderGoalForWolf(m);
            m.wanderT = 2 + Math.random() * 2;
            m.steerCooldown = 0; m.path = null; m.pathKey = null;
          }
        }
      } else {
        if (m._outsideFlee || m._villageFlee) { delete m._outsideFlee; delete m._villageFlee; delete m._fleeSrcX; delete m._fleeSrcZ; m.fleeUntil = 0; m.speed = WALK / 2; }
        else if (m.fleeUntil) { m.fleeUntil = 0; m.speed = WALK / 2; } else m.speed = WALK / 2;
        m.wanderT -= dt;
        if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6 || m.wanderT <= 0) {
          m.target = wanderGoalForWolf(m);
          m.wanderT = 3 + Math.random() * 4; m.path = null; m.pathKey = null; m.steerCooldown = 0;
        }
      }
    } else if (m.kind === "pig" || m.kind === "cow") {
      if (m.target && !isInsidePen(m.target.x, m.target.z)) {
        // debug
        // console.log("pig outside target", m.id, m.pos.x.toFixed(2), m.pos.z.toFixed(2), m.target.x.toFixed(2), m.target.z.toFixed(2), m.vel.x.toFixed(2), m.onGround);
      }
      const insidePen = dim === "over" && isInsidePen(m.pos.x, m.pos.z);
      if (m.fleeUntil != null && now < m.fleeUntil) {
        if (m._outsideFlee) {
          m.speed = WALK * 2;
          m.wanderT -= dt;
          if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.7 || m.wanderT <= 0) {
            m.target = fleePointAway(m, m._fleeSrcX, m._fleeSrcZ);
            m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
          }
        } else {
          m.speed = WALK * 2;
          if (!insidePen) {
            const gap = nearestPenGap(m.pos.x, m.pos.z);
            if (gap) {
              const inside = penGapInside(gap);
              if (!m.target || Math.hypot(m.target.x - inside.x, m.target.z - inside.z) > 0.5) {
                const d = Math.hypot(inside.x - m.pos.x, inside.z - m.pos.z);
                const probe = mobProbeFree(m.pos.x, m.pos.z, (inside.x - m.pos.x)/(d||1), (inside.z - m.pos.z)/(d||1), Math.min(d, 8), m.hw, m.pos.y);
                if (probe < d * 0.4) {
                  if (!m.target || m._aroundT === undefined || m.wanderT <= 0 || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.8) {
                    m.target = randomAroundPenPoint(m); m.wanderT = 0.35 + Math.random()*0.35; m.steerCooldown = 0; m._aroundT = (m._aroundT||0)+1;
                  }
                } else {
                  m.target = inside; m.wanderT = 2 + Math.random()*1; m.steerCooldown = 0; m.path = null; m.pathKey = null;
                }
              }
            } else {
              m.wanderT -= dt;
              if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.8 || m.wanderT <= 0) {
                m.target = randomAroundPenPoint(m); m.wanderT = 0.35 + Math.random()*0.35; m.steerCooldown = 0; m.path = null; m.pathKey = null;
              }
            }
          } else {
            m.wanderT -= dt;
            if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6 || m.wanderT <= 0) { m.target = wanderGoalForPen(m); m.wanderT = 0.3 + Math.random()*0.3; m.steerCooldown = 0; m.path=null; m.pathKey=null; }
          }
        }
        } else {
          if (m._outsideFlee) { delete m._outsideFlee; delete m._fleeSrcX; delete m._fleeSrcZ; m.fleeUntil = 0; m.speed = WALK / 2.2; }
          else if (m.fleeUntil) { m.fleeUntil = 0; m.speed = WALK / 2.2; } else m.speed = WALK / 2.2;
          // when not panicking: 1.5% per frame to exit freely if a gap exists
          if (insidePen && findPenGaps().length && Math.random() < 0.015) {
            const gap = nearestPenGap(m.pos.x, m.pos.z);
            if (gap) {
              m.target = penGapOutside(gap);
              m.wanderT = 3 + Math.random()*4; m.steerCooldown = 0; m.path = null; m.pathKey = null;
            }
          }
          m.wanderT -= dt;
          // inside → stay inside unless gap → 45% chance to exit freely (panic stays inside)
          let wantsPen = insidePen;
          let wantsExit = false;
          if (insidePen) {
            const gaps = findPenGaps();
            if (gaps.length && Math.random() < 0.45) wantsExit = true;
            if (wantsExit) wantsPen = false;
          }
          if (wantsPen && m.target && !isInsidePen(m.target.x, m.target.z)) {
            const isGapOutside = findPenGaps().some(g=> { const o=penGapOutside(g); return o && Math.abs(o.x - m.target.x)<0.1 && Math.abs(o.z - m.target.z)<0.1; });
            if (!isGapOutside) m.target = null;
          }
          if (!wantsPen && m.target && isInsidePen(m.target.x, m.target.z)) m.target = null;
          if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6 || m.wanderT <= 0) {
            if (wantsExit) {
              const gap = nearestPenGap(m.pos.x, m.pos.z);
              if (gap) {
                const inside = penGapInside(gap);
                const dInside = Math.hypot(inside.x - m.pos.x, inside.z - m.pos.z);
                if (dInside < 1.2) {
                  m.target = penGapOutside(gap);
                } else {
                  m.target = inside;
                }
              } else {
                m.target = randomAroundPenPoint(m);
              }
            } else {
              m.target = (m.penBound === false || dim !== "over") ? wanderNear(m) : (wantsPen ? wanderGoalForPen(m) : wanderGoalFor(m));
            }
            m.wanderT = 3 + Math.random() * 4; m.path = null; m.pathKey = null; m.steerCooldown = 0;
          }
        }
    } else if (m.mode === "inside") {
      m.insideT -= dt;
      if (m.insideT <= 0) {
        m.mode = "goOut";
        m.target = { x: villageHouses[m.homeId].apronX, z: villageHouses[m.homeId].apronZ };
      } else {
        if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.5) {
          m.target = randomInsidePoint(m.homeId);
        }
      }
    } else if (m.mode === "goOut" || m.mode === "goHome") {
      const house = villageHouses[m.homeId];
      const isOut = m.mode === "goOut";
      const fleeing = m.fleeUntil != null && now < m.fleeUntil;
      const dest = isOut ? { x: house.apronX, z: house.apronZ } : { x: house.padX, z: house.padZ };
      if (fleeing) {
        const centre = { x: house.cx + 0.5, z: house.cz + 0.5 };
        m.target = centre;
      } else if (Math.hypot(dest.x - m.pos.x, dest.z - m.pos.z) < 0.6) {
        if (isOut) { m.mode = "wander"; m.wanderT = 3 + Math.random() * 3; m.target = wanderGoalFor(m); }
        else { m.mode = "inside"; m.insideT = 8 + Math.random() * 8; m.target = randomInsidePoint(m.homeId); }
      } else {
        m.target = dest;
      }
    } else {
      // wander / follow — babies and cats without an available parent wander like adults
      const followKind = m.isBaby || m.kind === "cat";
      if (followKind && now >= (m.fleeUntil || 0)) {
        const p = m.isBaby ? babyParentFor(m) : catParentFor(m);
        if (p) {
          const pd = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
          const ph = villageHouses[p.homeId], mh = villageHouses[m.homeId];
          const pInside = ph ? p.pos.x>ph.minX&&p.pos.x<ph.maxX&&p.pos.z>ph.minZ&&p.pos.z<ph.maxZ : false;
          const meInside = mh ? m.pos.x>mh.minX&&m.pos.x<mh.maxX&&m.pos.z>mh.minZ&&m.pos.z<mh.maxZ : false;
          if (pInside !== meInside && ph && mh && dim === "over") {
            const house = pInside ? ph : mh;
            m.mode = pInside ? "goHome" : "goOut";
            m.speed = WALK / 2;
            m.target = pInside ? { x: house.padX, z: house.padZ } : { x: house.apronX, z: house.apronZ };
          } else if (pd > FOLLOW_ENGAGE_D || (m.mode === "follow" && pd > FOLLOW_HOLD_D)) {
            m.mode = "follow";
            m.speed = WALK / 2 * 1.3;
            m.target = m.isBaby ? babyTrailSpot(m, p) : catTrailSpot(m, p);
            m.path = null; m.pathKey = null;
            m._headonSteerT = 0; m._headonTX = null; m._headonTZ = null;
          } else if (pd < FOLLOW_HOLD_D && m.target && Math.hypot(m.target.x - p.pos.x, m.target.z - p.pos.z) < FOLLOW_MILL_R) {
            // stay near parent
            if (m.mode === "follow") m.mode = "wander";
            m.speed = WALK / 2;
          } else if (m.wanderT <= 0) {
            if (m.mode === "follow") m.mode = "wander";
            m.speed = WALK / 2;
            m.target = { x: p.pos.x + (Math.random()-0.5)*2*FOLLOW_MILL_R, z: p.pos.z + (Math.random()-0.5)*2*FOLLOW_MILL_R };
          } else if (m.mode === "follow") {
            m.target = m.isBaby ? babyTrailSpot(m, p) : catTrailSpot(m, p);
          }
        } else if (m.mode === "follow") {
          m.mode = "wander";
          m.speed = WALK / 2;
        }
      }
      m.wanderT -= dt;
      if (m.wanderT <= 0 && m.mode === "wander" && (m.villageBound === false || !m.isBaby)) {
        if (m.villageBound === false) {
          // outside village: wander near current pos
          m.target = wanderNear(m);
          m.wanderT = 3 + Math.random() * 4;
        } else if (m.homeId >= 0 && Math.random() < 0.25) {
          m.mode = "goHome";
          m.target = { x: villageHouses[m.homeId].apronX, z: villageHouses[m.homeId].apronZ };
        } else {
          m.target = wanderGoalFor(m);
          m.wanderT = 3 + Math.random() * 4;
        }
      }
      if (m.target && Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6) {
        if (m.mode === "wander") {
          const bp = m.isBaby ? babyParentFor(m) : (m.kind === "cat" ? catParentFor(m) : null);
          if (bp && Math.hypot(bp.pos.x - m.pos.x, bp.pos.z - m.pos.z) < 6) {
            m.target = { x: bp.pos.x + (Math.random()-0.5)*2, z: bp.pos.z + (Math.random()-0.5)*2 };
          } else if (m.villageBound === false) {
            m.target = wanderNear(m);
          } else {
            m.target = wanderGoalFor(m);
          }
          m.wanderT = 3 + Math.random() * 3;
        }
      }
    }
    // TNT panic override — fleeing takes precedence over mode dispatch
    // Hardcoded: fleeing villagers hard-converge to the CENTRE of their house
    if ((!m.kind || m.kind === "villager" || m.kind === "cat") && m.fleeUntil != null && now < m.fleeUntil) {
      m.speed = WALK * 2;
      if (dim !== "over") {
        m.wanderT -= dt;
        if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.7 || m.wanderT <= 0) {
          m.target = fleePointAway(m, m._fleeSrcX != null ? m._fleeSrcX : m.pos.x, m._fleeSrcZ != null ? m._fleeSrcZ : m.pos.z);
          m.wanderT = 1.2 + Math.random() * 0.8;
          m.steerCooldown = 0; m.path = null; m.pathKey = null;
        }
      } else {
      if (m._outsideFlee) {
        m.speed = WALK * 2;
        m.wanderT -= dt;
        if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.7 || m.wanderT <= 0) {
          m.target = fleePointAway(m, m._fleeSrcX != null ? m._fleeSrcX : m.pos.x, m._fleeSrcZ != null ? m._fleeSrcZ : m.pos.z);
          m.wanderT = 1.2 + Math.random() * 0.8;
          m.steerCooldown = 0; m.path = null; m.pathKey = null;
        }
      } else {
      const house = villageHouses[m.homeId];
      const inHome = house && m.pos.x > house.minX && m.pos.x < house.maxX && m.pos.z > house.minZ && m.pos.z < house.maxZ;
      const centre = { x: house.cx + 0.5, z: house.cz + 0.5 };
      if (inHome) {
        m.insideT = Math.max(m.insideT, m.fleeUntil - now);
        if (m.mode !== "inside") m.mode = "inside";
        m.target = centre;
      } else {
        // Outside: dash straight to centre (BFS through door)
        m.mode = "goOut";
        m.target = centre;
        m.path = null; m.pathKey = null; m.wanderT = 99;
      }
      }
      }
    } else if ((!m.kind || m.kind === "villager" || m.kind === "cat") && m.fleeUntil) { m.fleeUntil = 0; m.speed = WALK / 2; delete m._outsideFlee; delete m._fleeSrcX; delete m._fleeSrcZ; }

    // Pine planting task (Overworld adult villagers only): walk to a claimed
    // growable soil, bow the neck 40deg toward it for 1.5s while the 2.5s
    // TNT-style timer ticks above the block, leave away from the soil, then
    // the timer vanishes and a pine grows (or the dirt is removed when
    // nothing fits).
    const plantFleeing = m.fleeUntil != null && now < m.fleeUntil;
    if ((!m.kind || m.kind === "villager") && !m.isBaby && m.homeId >= 0 && dim === "over" && mobDimOf(m) === "over" && !isMobHeld(m) && !isChained(m) && !isMobOnRoof(m)) {
      if (m.mode === "goPlant") {
        const g = m.plantKey != null ? growableSoils.get(m.plantKey) : null;
        if (plantFleeing || !g || getBlock(g.x, g.y, g.z) !== DIRT) {
          if (m.plantKey != null && plantClaims.get(m.plantKey) === m.id) plantClaims.delete(m.plantKey);
          m.plantKey = null; m.plantTarget = null; m.plantGoal = null; m.plantPhase = null;
          setVillagerNeck(m, false);
          if (!plantFleeing) { m.mode = "wander"; m.speed = WALK / 2; m.wanderT = 2 + Math.random() * 2; m.target = wanderGoalFor(m); }
          m.path = null; m.pathKey = null;
        } else if (m.plantPhase === "bend") {
          // Bow for 1.5s, then leave while the soil timer runs on alone.
          m.bendT -= dt;
          m.vel.x = 0; m.vel.z = 0;
          m.target = { x: g.x + 0.5, z: g.z + 0.5 };
          if (m.bendT <= 0 || plantClaims.get(m.plantKey) !== m.id) {
            setVillagerNeck(m, false);
            if (m.plantKey != null && plantClaims.get(m.plantKey) === m.id) plantClaims.delete(m.plantKey);
            m.plantKey = null; m.plantTarget = null; m.plantGoal = null; m.plantPhase = null;
            m.mode = "wander"; m.speed = WALK / 2; m.wanderT = 2 + Math.random() * 2;
            if (soilOutsideClamp(g.x + 0.5, g.z + 0.5, m.hw)) m.villageBound = false;
            m.target = plantLeaveTarget(m, g) || (m.villageBound === false ? wanderNear(m) : wanderGoalFor(m));
            m.path = null; m.pathKey = null;
          } else {
            setVillagerNeck(m, true);
          }
        } else {
          const dx = (g.x + 0.5) - m.pos.x, dz = (g.z + 0.5) - m.pos.z;
          const dXZ = Math.hypot(dx, dz);
          const sameY = soilSameY(m, g);
          if (dXZ < 1.15 && sameY) {
            m.plantPhase = "bend";
            m.bendT = PLANT_BEND_TIME;
            m.vel.x = 0; m.vel.z = 0;
            m.target = { x: g.x + 0.5, z: g.z + 0.5 };
            m.path = null; m.pathKey = null;
            if (m.mesh) m.mesh.rotation.y = Math.atan2(dx, dz);
            if (g.timer == null) g.timer = SOIL_TIMER;
            setVillagerNeck(m, true);
          } else {
            // Re-validate reachability once a second: a holder that fell a
            // level or got walled in can never arrive and would squat the
            // claim forever, so release it for a better-placed rival.
            m._plantReT = (m._plantReT == null ? 1 : m._plantReT) - dt;
            if (m._plantReT <= 0) {
              m._plantReT = 1;
              const gg = plantWalkGoal(m, g);
              if (!gg || !findPlantPath(m.pos.x, m.pos.z, gg.x, gg.z, m.hw, Math.floor(m.pos.y))) {
                if (m.plantKey != null && plantClaims.get(m.plantKey) === m.id) plantClaims.delete(m.plantKey);
                m.plantKey = null; m.plantTarget = null; m.plantGoal = null; m.plantPhase = null;
                setVillagerNeck(m, false);
                m.mode = "wander"; m.speed = WALK / 2; m.wanderT = 2 + Math.random() * 2; m.target = wanderGoalFor(m);
                m.path = null; m.pathKey = null;
              } else {
                m.plantGoal = { x: gg.x, z: gg.z };
              }
            }
            if (m.mode === "goPlant" && m.plantGoal) {
              m.target = { x: m.plantGoal.x, z: m.plantGoal.z };
              if (dXZ < 2.2 && sameY) {
                m._plantMile = true;
                m.speed = WALK / 2;
                m.path = null; m.pathKey = null; m.steerCooldown = 0;
                m._headonSteerT = 0; m._headonTX = null; m._headonTZ = null;
              } else {
                m._plantMile = false;
                m.speed = WALK * 2;
              }
            } else {
              m.path = null; m.pathKey = null;
            }
          }
        }
      } else if ((m.mode === "wander" || m.mode === "inside") && !plantFleeing) {
        m._plantScanT = (m._plantScanT || 0) - dt;
        if (m._plantScanT <= 0 && growableSoils.size) {
          m._plantScanT = 0;
          let best = null, bestD = Infinity;
          for (const g of growableSoils.values()) {
            if (g.timer != null || !g.wet) continue;
            if (!isSoilHole(g.x, g.y, g.z) && !isSoilFloor(g.x, g.y, g.z)) continue;
            const d = Math.hypot(g.x + 0.5 - m.pos.x, (g.y + 1) - m.pos.y, g.z + 0.5 - m.pos.z);
            if (d < bestD) { bestD = d; best = g; }
          }
          if (best && soilSameY(m, best)) {
            const k = key(best.x, best.y, best.z);
            // Nearest capable villager wins: a live holder walking to the soil
            // loses the claim to a strictly closer rival (hysteresis avoids
            // flip-flops); a bending holder always finishes.
            let take = claimFree(k, m);
            if (!take) {
              const holder = plantClaims.get(k);
              const hm = holder != null && typeof mobById !== "undefined" ? mobById.get(holder) : null;
              if (hm && hm !== m && hm.mode === "goPlant" && hm.plantKey === k && hm.plantPhase !== "bend") {
                const hd = Math.hypot(best.x + 0.5 - hm.pos.x, (best.y + 1) - hm.pos.y, best.z + 0.5 - hm.pos.z);
                if (bestD < hd - PLANT_STEAL_D) {
                  hm.mode = "wander"; hm.speed = WALK / 2; hm.wanderT = 2 + Math.random() * 2;
                  hm.plantKey = null; hm.plantTarget = null; hm.plantGoal = null; hm.plantPhase = null;
                  setVillagerNeck(hm, false);
                  hm.target = wanderGoalFor(hm);
                  hm.path = null; hm.pathKey = null;
                  plantClaims.delete(k);
                  take = true;
                }
              }
            }
            if (take) {
              const gg0 = plantWalkGoal(m, best);
              const p = gg0 && findPlantPath(m.pos.x, m.pos.z, gg0.x, gg0.z, m.hw, Math.floor(m.pos.y));
              if (p) {
                plantClaims.set(k, m.id);
                if (soilOutsideClamp(best.x + 0.5, best.z + 0.5, m.hw)) m.villageBound = false;
                m.mode = "goPlant";
                m.plantKey = k;
                m.plantTarget = { x: best.x, y: best.y, z: best.z };
                m.plantGoal = { x: gg0.x, z: gg0.z };
                m.plantPhase = "walk";
                m.target = { x: gg0.x, z: gg0.z };
                m.speed = WALK * 2;
                m.path = null; m.pathKey = null;
              }
            }
          }
        }
      }
    } else if (m.mode === "goPlant" || (m.plantKey != null && (isMobHeld(m) || isChained(m)))) {
      if (m.plantKey != null && plantClaims.get(m.plantKey) === m.id) plantClaims.delete(m.plantKey);
      m.plantKey = null; m.plantTarget = null; m.plantGoal = null; m.plantPhase = null;
      setVillagerNeck(m, false);
      if (m.mode === "goPlant") { m.mode = "wander"; m.speed = WALK / 2; m.path = null; m.pathKey = null; }
    }

    // Roof mobs: stay and wander locally on the same roof, never walk off alone (panic in place at WALKx2)
    if (isMobOnRoof(m)) {
      const rh = houseAtRoof(m.pos.x, m.pos.z);
      const fleeing = m.fleeUntil != null && now < m.fleeUntil;
      m.mode = "wander";
      m.speed = fleeing ? WALK * 2 : ((m.kind === "pig" || m.kind === "cow") ? WALK / 2.2 : WALK / 2);
      m.wanderT -= dt;
      const onSameRoof = m.target && houseAtRoof(m.target.x, m.target.z) === rh;
      if (!m.target || !onSameRoof || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6 || m.wanderT <= 0) {
        m.target = wanderGoalForRoof(m);
        m.wanderT = fleeing ? 0.8 + Math.random() * 0.8 : 3 + Math.random() * 4;
        m.path = null; m.pathKey = null; m.steerCooldown = 0;
      }
    }

    // Steering towards target — BFS path for 1-block corridors + smart wall avoidance
    const canStep = !!m.canStep;
    const probeFree = canStep ? wolfProbeFree : mobProbeFree;
    const hasGround = canStep ? wolfHasMobGround : hasMobGround;
    const findPath = m.mode === "goPlant" ? findPlantPath : (canStep ? wolfFindPath : findVillagePath);
    const goalFor = canStep ? wanderGoalForWolf : wanderGoalFor;
    let poolEx = null;
    const pHead = mobHeadonHeading(m);
    const bathable = m.kind !== "enderman" && !isFlyingKind(m.kind);
    let inBath = false;
    if (bathable && !isMobHeld(m) && !isMobFrozenByGrapple(m)) {
      if (isMobInPoolWater(m) || isMobInMoonLake(m)) inBath = true;
    }
    if (inBath) {
      if (!(m._bathMax > 0)) { m._bathT = 0; m._bathMax = BATH_MIN_T + Math.random() * (BATH_MAX_T - BATH_MIN_T); }
      else m._bathT = (m._bathT || 0) + dt;
    } else { m._bathT = 0; m._bathMax = 0; }
    const bathDue = bathable && inBath && (m._bathT || 0) >= (m._bathMax || Infinity);
    if (m._poolEx && m._poolExKind) {
      if (m._poolExKind === "moon") {
        const arrived = Math.hypot(m.pos.x - m._poolEx.x, m.pos.z - m._poolEx.z) < 0.8;
        if (arrived || !isMobInMoonLake(m)) { m._poolEx = null; m._poolExKind = null; }
        else poolEx = m._poolEx;
      } else {
      const q = m._poolExKind === "pen" ? (villagePen && villagePen.pool) : villagePool;
      const arrived = q && Math.hypot(m.pos.x - m._poolEx.x, m.pos.z - m._poolEx.z) < 0.8;
      const outside = q && (m.pos.x < q.minX - 1 || m.pos.x > q.maxX + 1 || m.pos.z < q.minZ - 1 || m.pos.z > q.maxZ + 1);
      if (!q || arrived || outside) { m._poolEx = null; m._poolExKind = null; }
      else poolEx = m._poolEx;
      }
    }
    if (!poolEx && bathDue && isMobInPoolWater(m)) {
      poolEx = poolExitTarget(m.pos.x, m.pos.z, pHead.x, pHead.z);
      if (poolEx) { m.path = null; m.pathKey = null; m._poolEx = poolEx; m._poolExKind = "pool"; }
    }
    if (!poolEx && bathDue && isMobInMoonLake(m)) {
      poolEx = moonLakeExitTarget(m);
      if (poolEx) { m.path = null; m.pathKey = null; m._poolEx = poolEx; m._poolExKind = "moon"; }
    }
    if (!poolEx && villagePen && villagePen.pool && isInsidePenPool(m.pos.x, m.pos.z) && mobInWater(m)) {
      poolEx = penPoolExitTarget(m.pos.x, m.pos.z, pHead.x, pHead.z);
      if (poolEx) { m.path = null; m.pathKey = null; m._poolEx = poolEx; m._poolExKind = "pen"; }
    }
    let tx = poolEx ? poolEx.x : (m.target ? m.target.x : m.pos.x);
    let tz = poolEx ? poolEx.z : (m.target ? m.target.z : m.pos.z);
    const strictParent = !poolEx ? followParentOf(m) : null;
    const strictFollow = !!strictParent && Math.hypot(strictParent.pos.x - m.pos.x, strictParent.pos.z - m.pos.z) <= FOLLOW_LEASH_D;
    if (strictFollow) { m.path = null; m.pathKey = null; }
    if (dim === "end") {
      tx = endSquareCoord(tx); tz = endSquareCoord(tz);
    }
    if ((m._headonSteerT || 0) > 0) {
      m._headonSteerT -= dt;
      if (m._headonSteerT <= 0) { m._headonSteerT = 0; m._headonTX = null; m._headonTZ = null; }
      else if (m._headonTX != null && m._headonTZ != null) { tx = m._headonTX; tz = m._headonTZ; }
    }
    let hasPath = false;
    const plantMile = m.mode === "goPlant" && m.plantPhase === "walk" && m._plantMile;
    const toTarOverall = Math.hypot(tx - m.pos.x, tz - m.pos.z);
    const insideNow = (()=>{ if (m.kind === "pig" || m.kind === "cow") return isInsidePen(m.pos.x, m.pos.z); if (canStep) return false; const h=villageHouses[m.homeId]; return h && m.pos.x>h.minX&&m.pos.x<h.maxX&&m.pos.z>h.minZ&&m.pos.z<h.maxZ; })();
    const needPath = (poolEx || plantMile || strictFollow) ? false : (!insideNow && m.mode !== "inside" && (toTarOverall > 1.8 || probeFree(m.pos.x, m.pos.z, (tx - m.pos.x)/(toTarOverall||1), (tz - m.pos.z)/(toTarOverall||1), Math.min(1.2, toTarOverall), m.hw, m.pos.y) < 0.55));
    if (needPath) {
      const pk = Math.round(tx) + "," + Math.round(tz);
      if (!m.path || m.pathKey !== pk) {
        const p = findPath(m.pos.x, m.pos.z, tx, tz, m.hw, m.pos.y);
        if (p && p.length > 1) { m.path = p; m.pathIdx = 1; m.pathKey = pk; hasPath = true; tx = p[1][0]; tz = p[1][1]; }
        else { m.path = null; m.pathKey = null; }
      } else if (m.path && m.pathIdx < m.path.length) {
        hasPath = true;
        const le = m.path[m.path.length - 1];
        const ldx0 = le[0] - m.pos.x, ldz0 = le[1] - m.pos.z;
        const ldd = Math.hypot(ldx0, ldz0);
        if (ldd > 0.6) {
          const lf = probeFree(m.pos.x, m.pos.z, ldx0 / ldd, ldz0 / ldd, ldd, m.hw, m.pos.y);
          if (lf >= ldd - 0.05) {
            m.path = null; m.pathKey = null; hasPath = false; tx = le[0]; tz = le[1];
          }
        }
        if (hasPath) {
          if ((m._skipT = (m._skipT || 0) - dt) <= 0) {
            m._skipT = 0.25;
            const maxK = Math.min(m.path.length - 1, m.pathIdx + 10);
            for (let k = maxK; k > m.pathIdx; k--) {
              const wx = m.path[k][0], wz = m.path[k][1];
              const wd = Math.hypot(wx - m.pos.x, wz - m.pos.z);
              if (wd < 0.45) { m.pathIdx = k + 1; break; }
              if (wd > 3.0) continue;
              const dx = (wx - m.pos.x) / wd, dz = (wz - m.pos.z) / wd;
              if (probeFree(m.pos.x, m.pos.z, dx, dz, wd, m.hw, m.pos.y) >= wd - 0.05) { m.pathIdx = k; break; }
            }
            if (m.pathIdx > m.path.length - 1) {
              const le2 = m.path[m.path.length - 1];
              m.path = null; m.pathKey = null; hasPath = false; tx = le2[0]; tz = le2[1];
            }
          }
        }
        if (hasPath) {
          tx = m.path[m.pathIdx][0]; tz = m.path[m.pathIdx][1];
          if (Math.hypot(m.pos.x - tx, m.pos.z - tz) < 0.45) {
            m.pathIdx++; if (m.pathIdx < m.path.length) { tx = m.path[m.pathIdx][0]; tz = m.path[m.pathIdx][1]; }
            else { m.path = null; m.pathKey = null; hasPath = false; }
          }
        }
      }
      if (hasPath && probeFree(m.pos.x, m.pos.z, (tx - m.pos.x)/Math.hypot(tx - m.pos.x, tz - m.pos.z || 1), (tz - m.pos.z)/Math.hypot(tx - m.pos.x, tz - m.pos.z || 1), 0.6, m.hw, m.pos.y) < 0.15) {
        m.path = null; m.pathKey = null; hasPath = false; tx = poolEx ? poolEx.x : m.target.x; tz = poolEx ? poolEx.z : m.target.z;
      }
    } else {
      m.path = null; m.pathKey = null;
    }
    const toTx = tx - m.pos.x, toTz = tz - m.pos.z;
    const dist = Math.hypot(toTx, toTz);
    let wantX = 0, wantZ = 0;
    if (dist > 0.05) {
      wantX = (toTx / dist) * m.speed;
      wantZ = (toTz / dist) * m.speed;
      if (poolEx) {
        m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.2;
      } else if (plantMile) {
        m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.15;
      } else if (!hasPath) {
        const hwh = mobHeadonHeading(m);
        const tdx0 = (tx - m.pos.x) / (dist || 1), tdz0 = (tz - m.pos.z) / (dist || 1);
        if (dist > 0.6 && (hwh.x * tdx0 + hwh.z * tdz0) > 0.5 &&
            probeFree(m.pos.x, m.pos.z, hwh.x, hwh.z, 1.4, m.hw, m.pos.y) > 1.2) {
          wantX = hwh.x * m.speed; wantZ = hwh.z * m.speed;
          m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.5;
        } else {
        if (m.steerCooldown > 0) {
          m.steerCooldown -= dt;
          const sx = m.steerX / (m.speed || 1), sz = m.steerZ / (m.speed || 1);
          const steerFree = (Math.abs(sx) > 0.01 || Math.abs(sz) > 0.01) ? probeFree(m.pos.x, m.pos.z, sx, sz, 1.4, m.hw, m.pos.y) : 0;
          if (steerFree > 0.6) {
            wantX = m.steerX; wantZ = m.steerZ;
          } else {
            m.steerCooldown = 0;
          }
        }
        if (m.steerCooldown <= 0) {
          const dirX = wantX / m.speed, dirZ = wantZ / m.speed;
          const probe = probeFree(m.pos.x, m.pos.z, dirX, dirZ, 1.4, m.hw, m.pos.y);
          if (probe < 0.7) {
            let bestScore = -1, bx = wantX, bz = wantZ, bestFree = probe;
            const angles = probe < 0.35 ? [0,30,-30,60,-60,90,-90,120,-120,150,-150,180] : [0,35,-35,70,-70,110,-110];
            for (const a of angles) {
              const rad = a * Math.PI / 180;
              const cx = Math.cos(rad) * dirX - Math.sin(rad) * dirZ;
              const cz = Math.sin(rad) * dirX + Math.cos(rad) * dirZ;
              const free = probeFree(m.pos.x, m.pos.z, cx, cz, 1.4, m.hw, m.pos.y);
              const dot = cx * dirX + cz * dirZ;
              const score = free * (0.55 + 0.45 * Math.max(0, dot));
              if (free < 0.25) continue;
              if (score > bestScore) { bestScore = score; bestFree = free; bx = cx * m.speed; bz = cz * m.speed; }
            }
            if (bestScore >= 0 && bestFree > probe + 0.05) { wantX = bx; wantZ = bz; m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.45; }
            else if (probe < 0.25) { wantX *= 0.3; wantZ *= 0.3; m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.35; }
            else { m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.25; }
          } else {
            m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.3;
          }
          }
        }
      } else {
        m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.2;
      }
    }
    if (strictFollow && !poolEx && dist > 0.05) {
      wantX = (toTx / dist) * m.speed;
      wantZ = (toTz / dist) * m.speed;
      m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0;
    }
    if (wantX === 0 && wantZ === 0 && dist > 0.6) {
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
        const free = probeFree(m.pos.x, m.pos.z, dx, dz, 1.4, m.hw, m.pos.y);
        if (free > 0.5) {
          const nx = m.pos.x + dx, nz = m.pos.z + dz;
          const canStand = hasGround(nx, nz, m.hw, m.pos.y) || hasGround(nx, nz, m.hw, m.pos.y+1) || hasGround(nx, nz, m.hw, m.pos.y-1);
          if (canStand && !aabbCollidesWorld(nx, m.pos.y, nz, m.hw, m.h) && !aabbCollidesWorld(nx, m.pos.y+1, nz, m.hw, m.h)) {
            wantX = dx * m.speed * 0.6;
            wantZ = dz * m.speed * 0.6;
            m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.6;
            break;
          }
        }
      }
    }
    const wantDeflected = (m._headonSteerT || 0) > 0;
    if (!strictFollow) {
      let repX = 0, repZ = 0, cnt = 0;
      const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 2);
      for (const o of nearby) {
        if (o === m || isMobHeld(o) || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(m) + villagerHW(o) + 0.50;
        const fleeingSelf = m.fleeUntil && performance.now() / 1000 < m.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && mobBondedPair(m, o)) need = (villagerHW(m) + villagerHW(o)) * 0.62 + 0.22;
        }
        if (Math.abs(m.pos.y - o.pos.y) > 1.2) continue;
        const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < need * need && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const w = (need - d) / need;
          repX += (dx / d) * w;
          repZ += (dz / d) * w;
          cnt++;
        }
      }
      if (cnt && !wantDeflected) {
        repX /= cnt; repZ /= cnt;
        const len = Math.hypot(repX, repZ);
        if (len > 0.001) {
          repX /= len; repZ /= len;
          const str = Math.min(1, cnt * 0.55) * m.speed * 0.85;
          wantX += repX * str;
          wantZ += repZ * str;
          const wlen = Math.hypot(wantX, wantZ);
          const cap = m.speed * 1.30;
          if (wlen > cap) { wantX *= cap / wlen; wantZ *= cap / wlen; }
        }
      }
    }
    if (!wantDeflected && isChainCarrier(m) && !isFlyingKind(m.kind) && (wantX || wantZ)) {
      const wl = Math.hypot(wantX, wantZ);
      const f = wl > 1e-6 ? chainLiveFollower(m) : null;
      if (f) {
        const fx = f.pos.x - m.pos.x, fz = f.pos.z - m.pos.z;
        const fl = Math.hypot(fx, fz);
        if (fl > 1e-6 && (wantX * fx + wantZ * fz) / (wl * fl) > Math.cos(CHAIN_LEAD_CONE)) {
          const fang = Math.atan2(fx, fz);
          let rel = Math.atan2(wantX, wantZ) - fang;
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          let side;
          if (rel > 0) side = 1;
          else if (rel < 0) side = -1;
          else side = stickyTurnSide(m);
          const edgeFree = (s) => {
            const ex = Math.sin(fang + s * CHAIN_LEAD_CONE), ez = Math.cos(fang + s * CHAIN_LEAD_CONE);
            if (probeFree(m.pos.x, m.pos.z, ex, ez, 1.4, m.hw, m.pos.y) < 0.35) return null;
            if (!headonSidestepOk(m, m.pos.x + ex * 1.5, m.pos.z + ez * 1.5)) return null;
            return { x: ex, z: ez };
          };
          const edge = edgeFree(side) || edgeFree(-side);
          if (edge) {
            wantX = edge.x * wl; wantZ = edge.z * wl;
            m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = Math.max(m.steerCooldown, 0.3);
          }
        }
      }
    }
    // lerp vel towards want (like player)
    if (m.mode === "goPlant" && m.plantPhase === "bend") { wantX = 0; wantZ = 0; }
    m.vel.x += (wantX - m.vel.x) * Math.min(1, dt * 6);
    m.vel.z += (wantZ - m.vel.z) * Math.min(1, dt * 6);
    if (dist < 0.1 && !poolEx) { m.vel.x *= 0.85; m.vel.z *= 0.85; }
    // handle inside house wall clamp: if trying to go out of house interior via wall, pick new inside point
    if (m.mode === "inside") {
      const h = villageHouses[m.homeId];
      const nx = m.pos.x + m.vel.x * dt, nz = m.pos.z + m.vel.z * dt;
      const hitWall = nx <= h.minX + 0.4 || nx >= h.maxX - 0.4 || nz <= h.minZ + 0.4 || nz >= h.maxZ - 0.4;
      // allow door gap
      const nearDoor = (Math.abs(nx - (h.d0x+0.5))<1 || Math.abs(nx - (h.d1x+0.5))<1) && (Math.abs(nz - (h.d0z+0.5))<1 || Math.abs(nz - (h.d1z+0.5))<1);
      if (hitWall && !nearDoor && aabbCollidesWorld(nx, m.pos.y, nz, m.hw, m.h)) {
        m.target = randomInsidePoint(m.homeId);
        m.vel.x *= 0.5; m.vel.z *= 0.5;
      }
    }
    // physics step — canStep (wolves) use player-like smooth step + swim, others classic
    if (canStep) wolfPhysicsStep(m, dt, g);
    else mobPhysicsStep(m, dt, g);
    if (dim === "end") {
      const lo = -END_PLATFORM_R + 0.5, hi = END_PLATFORM_R + 0.5;
      if (m.pos.x < lo) { m.pos.x = lo; if (m.vel.x < 0) m.vel.x = 0; }
      else if (m.pos.x > hi) { m.pos.x = hi; if (m.vel.x > 0) m.vel.x = 0; }
      if (m.pos.z < lo) { m.pos.z = lo; if (m.vel.z < 0) m.vel.z = 0; }
      else if (m.pos.z > hi) { m.pos.z = hi; if (m.vel.z > 0) m.vel.z = 0; }
      if (m.pos.y > DRAGON_MAX_Y) { m.pos.y = DRAGON_MAX_Y; m.vel.y = Math.min(m.vel.y, 0); }
    }
    if(isPigCow(m) && villagePen && pigOverlapsFence(m.pos.x, m.pos.z, m.hw)){
      pigFenceSlideOut(m);
    }
    // mob-mob / player already in separate/push, but also check immediate collision after move
    // stuck detection — 1-block corner: never stay stuck
    const moved = Math.hypot(m.pos.x - prevX, m.pos.z - prevZ);
    const wantMove = Math.hypot(wantX, wantZ) * dt;
    if (wantMove > 0.05 && moved < wantMove * 0.20) m._stuckT += dt; else m._stuckT = Math.max(0, m._stuckT - dt * 2);
    if (m._stuckT > 0.55) {
      if (isStrictFollower(m)) { m._stuckT = 0; }
      else if (m.mode === "inside") {
        m.target = randomInsidePoint(m.homeId);
      } else if ((m.kind === "pig" || m.kind === "cow") && isInsidePen(m.pos.x, m.pos.z)) {
        m.target = wanderGoalForPen(m);
        m.path = null; m.pathKey = null;
        const td = obstacleTurnDir(m, probeFree);
        m.vel.x = td.x * (WALK / 2) * 0.6; m.vel.z = td.z * (WALK / 2) * 0.6;
        m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.6;
      } else if (m.canStep && isJumpingKind(m.kind)) {
        m.target = m.kind === "cat" ? wanderGoalFor(m) : wanderGoalForWolf(m);
        m.path = null; m.pathKey = null;
        const td = obstacleTurnDir(m, probeFree);
        m.vel.x = td.x * (WALK / 2) * 0.6; m.vel.z = td.z * (WALK / 2) * 0.6;
        m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.6;
      } else {
        const td = obstacleTurnDir(m, probeFree);
        const bestF = probeFree(m.pos.x, m.pos.z, td.x, td.z, 2.2, m.hw, m.pos.y);
        const bx = td.x, bz = td.z;
        if (bestF > 0.35) {
          const tx2 = m.pos.x + bx * (1.5 + Math.random()*2.5);
          const tz2 = m.pos.z + bz * (1.5 + Math.random()*2.5);
          const cx = m.villageBound === false ? tx2 : Math.max(villageMinX+1, Math.min(villageMaxX-1, tx2));
          const cz = m.villageBound === false ? tz2 : Math.max(villageMinZ+1, Math.min(villageMaxZ-1, tz2));
          const canStand = (!aabbCollidesWorld(cx, m.pos.y, cz, m.hw, m.h) && hasGround(cx, cz, m.hw, m.pos.y)) || (!aabbCollidesWorld(cx, m.pos.y+1, cz, m.hw, m.h) && hasGround(cx, cz, m.hw, m.pos.y+1)) || (!aabbCollidesWorld(cx, m.pos.y-1, cz, m.hw, m.h) && hasGround(cx, cz, m.hw, m.pos.y-1));
          if (canStand && !isInsideAnyHouse(cx, cz)) {
            m.target = { x: cx, z: cz };
            m.lastTarget = { x: cx, z: cz };
          } else {
            if (m.villageBound === false) {
              m.target = { x: tx2, z: tz2 };
            } else {
              m.target = goalFor(m);
            }
          }
          m.path = null; m.pathKey = null;
          m.vel.x = bx * (WALK/2) * 0.7; m.vel.z = bz * (WALK/2) * 0.7;
          m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.5;
        } else {
          m.target = goalFor(m);
          m.path = null; m.pathKey = null;
          m.vel.x = bx * (WALK / 2) * 0.5; m.vel.z = bz * (WALK / 2) * 0.5;
          m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.5;
        }
      }
      m.wanderT = 2 + Math.random() * 2;
      m._stuckT = 0;
      if (mobStats) mobStats.stuck++;
    } else if (wantMove > 0.05 && moved < 0.02 && probeFree(m.pos.x, m.pos.z, wantX/(m.speed||1), wantZ/(m.speed||1), 0.5, m.hw, m.pos.y) < 0.15) {
      const td = obstacleTurnDir(m, probeFree, 1.4);
      const bestF = probeFree(m.pos.x, m.pos.z, td.x, td.z, 1.4, m.hw, m.pos.y);
      if (bestF > 0.35) {
        m.vel.x = td.x * (WALK/2) * 0.5; m.vel.z = td.z * (WALK/2) * 0.5;
        m.mesh.rotation.y = Math.atan2(td.x, td.z);
        m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.5;
      }
    }
    // sync mesh
    m.mesh.position.copy(m.pos);
    // yaw
    if (Math.hypot(m.vel.x, m.vel.z) > 0.1) {
      const yawWant = Math.atan2(m.vel.x, m.vel.z);
      let dd = yawWant - m.mesh.rotation.y; while (dd > Math.PI) dd -= Math.PI*2; while (dd < -Math.PI) dd += Math.PI*2;
      m.mesh.rotation.y += dd * Math.min(1, dt * 7);
    }
    // leg anim (frozen while bowed over a growable soil)
    const bending = m.mode === "goPlant" && m.plantPhase === "bend";
    const moving = !bending && Math.hypot(m.vel.x, m.vel.z) > 0.15 && m.onGround;
    if (moving) m.legPhase += dt * 9;
    else if (!bending) m.legPhase += dt * 2;
    if (m.mesh.userData.legL && !bending) {
      m.mesh.userData.legL.rotation.x = Math.sin(m.legPhase) * 0.55;
      m.mesh.userData.legR.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.55;
    } else if (bending && m.mesh.userData.legL) {
      m.mesh.userData.legL.rotation.x = 0;
      m.mesh.userData.legR.rotation.x = 0;
    }
    if (m.mesh.userData.legBL) {
      m.mesh.userData.legBL.rotation.x = Math.sin(m.legPhase) * 0.65;
      m.mesh.userData.legBR.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.65;
      m.mesh.userData.legFL.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.65;
      m.mesh.userData.legFR.rotation.x = Math.sin(m.legPhase) * 0.65;
    }
    if (m.kind === "iron_golem" && m.mesh.userData.armL) {
      m.mesh.userData.armL.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.4;
      m.mesh.userData.armR.rotation.x = Math.sin(m.legPhase) * 0.4;
    }
    // ensure not embedded
    if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) {
      // nudge out: try small random
      for (let k=0;k<4;k++){ const nx=m.pos.x + (Math.random()-0.5)*0.6, nz=m.pos.z + (Math.random()-0.5)*0.6; if(!aabbCollidesWorld(nx,m.pos.y,nz,m.hw,m.h)){ m.pos.x=nx; m.pos.z=nz; break; } }
    }
  }
  if (over) { buildMobGrid(); separateMobs(); }
}
const PANIC_TIME = 3;
const OUTSIDE_PANIC_DIST = 10;
const VILLAGE_PANIC_TIME = 5;
const VILLAGER_PANIC_TIME = 8;
let villagePanicUntil = 0;
function mobPanicSnapshot(m, now) {
  const t = isFinite(now) ? now : performance.now() / 1000;
  let fleeRemain = 0, panicT = 0, panicUntilRemain = 0, srcX = 0, srcZ = 0, flags = 0;
  if (m && m.kind !== "dragon" && !isMobHeld(m) && !isChained(m)) {
    if (m.fleeUntil != null && isFinite(m.fleeUntil) && m.fleeUntil > t) {
      fleeRemain = Math.min(Math.max(0, m.fleeUntil - t), VILLAGER_PANIC_TIME);
    }
    if ((m._panicT || 0) > 0) panicT = Math.min(m._panicT, PANIC_TIME);
    if (m._panicUntil != null && isFinite(m._panicUntil) && m._panicUntil > t) {
      panicUntilRemain = Math.min(Math.max(0, m._panicUntil - t), VILLAGE_PANIC_TIME);
    }
    if (fleeRemain > 0 || panicT > 0 || panicUntilRemain > 0) {
      if (m._fleeSrcX != null && m._fleeSrcZ != null) { srcX = m._fleeSrcX; srcZ = m._fleeSrcZ; }
      else if (m._panicSrcX != null && m._panicSrcZ != null) { srcX = m._panicSrcX; srcZ = m._panicSrcZ; }
      else { srcX = m.pos.x; srcZ = m.pos.z; }
      if (m._outsideFlee || m._villageFlee) flags |= 1;
      if (m._panicVillage) flags |= 2;
    }
  }
  return { fleeRemain, panicT, panicUntilRemain, panicSrcX: srcX, panicSrcZ: srcZ, panicFlags: flags };
}
function clearMobPanic(m) {
  if (!m) return;
  m.fleeUntil = 0;
  delete m._outsideFlee; delete m._villageFlee; delete m._fleeSrcX; delete m._fleeSrcZ;
  m._panicT = 0;
  m._panicUntil = 0;
  m._panicSrcX = null;
  m._panicSrcZ = null;
  m._panicVillage = false;
  if (m.targetMode === "panic") { m.target = null; m.targetMode = null; }
}
function stripPanicEntries(list) {
  if (!list) return;
  for (const e of list) {
    e.fleeRemain = 0; e.panicT = 0; e.panicUntilRemain = 0; e.panicFlags = 0;
  }
}
function resumeMobPanic(m, e) {
  if (!m || !e || m.kind === "dragon") return false;
  const now = performance.now() / 1000;
  const fleeRemain = isFinite(e.fleeRemain) ? Math.min(Math.max(0, e.fleeRemain), VILLAGER_PANIC_TIME) : 0;
  const pT = isFinite(e.panicT) ? Math.min(Math.max(0, e.panicT), PANIC_TIME) : 0;
  const pUntil = isFinite(e.panicUntilRemain) ? Math.min(Math.max(0, e.panicUntilRemain), VILLAGE_PANIC_TIME) : 0;
  const sx = isFinite(e.panicSrcX) ? e.panicSrcX : m.pos.x;
  const sz = isFinite(e.panicSrcZ) ? e.panicSrcZ : m.pos.z;
  const flags = (e.panicFlags & 255) || 0;
  if (isBirdKind(m.kind)) {
    if (pT <= 0.05 && pUntil <= 0.05) return false;
    m.perchSpot = null; m.perchGroup = null; m.perchT = 0; m.perchWander = null; m.perchWanderT = 0; m.perchTimeout = 0; m.perchRetry = 0;
    m.mode = "straight"; m.arc = null;
    m._tunnel = false; m._tFree = 0; m._tPath = null; m._tGoal = null;
    m.target = (flags & 2) ? panicBirdLeaveTarget(m, sx, sz) : panicBirdTarget(m, sx, sz);
    m.targetMode = "panic";
    m._panicSrcX = sx; m._panicSrcZ = sz;
    m._panicVillage = !!(flags & 2);
    m._panicT = Math.max(pT, 0.05);
    m._panicUntil = now + Math.max(pUntil, 0.05);
    return true;
  }
  if (m.kind === "enderman") return false;
  if (fleeRemain <= 0.05) return false;
  m.fleeUntil = now + fleeRemain;
  m.speed = WALK * 2;
  if (flags & 1) { m._outsideFlee = true; m._fleeSrcX = sx; m._fleeSrcZ = sz; }
  else { delete m._outsideFlee; delete m._fleeSrcX; delete m._fleeSrcZ; }
  m.steerCooldown = 0; m.path = null; m.pathKey = null;
  if (dim === "over" && !(flags & 1)) {
    if ((!m.kind || m.kind === "villager" || m.kind === "cat")) {
      const house = villageHouses[m.homeId];
      if (house) {
        const centre = { x: house.cx + 0.5, z: house.cz + 0.5 };
        const inHome = m.pos.x > house.minX && m.pos.x < house.maxX && m.pos.z > house.minZ && m.pos.z < house.maxZ;
        if (inHome) { m.mode = "inside"; m.insideT = Math.max(m.insideT, fleeRemain); m.target = centre; }
        else { m.mode = "goOut"; m.target = centre; m.wanderT = 99; }
        return true;
      }
    } else if (m.kind === "pig" || m.kind === "cow") {
      if (villagePen && isInsidePen(m.pos.x, m.pos.z)) { m.target = wanderGoalForPen(m); m.wanderT = 0.25 + Math.random() * 0.25; }
      else { m.target = fleePointAway(m, sx, sz); m.wanderT = 1.2 + Math.random() * 0.8; }
      return true;
    } else if (m.kind === "wolf") {
      if (villagePen) { const p = randomPenPoint(); m.target = { x: p.x, z: p.z }; }
      else m.target = fleePointAway(m, sx, sz);
      m.wanderT = 1 + Math.random();
      return true;
    }
  }
  m.target = fleePointAway(m, sx, sz);
  m.wanderT = 1.2 + Math.random() * 0.8;
  return true;
}
let simPauseStart = 0;
function shiftPausedTimers(d) {
  if (!(d > 0) || !(simPauseStart > 0)) return;
  for (const m of mobs) {
    if (m.fleeUntil != null && m.fleeUntil > simPauseStart) m.fleeUntil += d;
    if (m._panicUntil != null && m._panicUntil > simPauseStart) m._panicUntil += d;
    if (m._frozenUntil != null && m._frozenUntil > simPauseStart) m._frozenUntil += d;
  }
  if (villagePanicUntil > simPauseStart) villagePanicUntil += d;
  if (explosionQueue && explosionQueue.length) {
    const psMs = simPauseStart * 1000, dMs = d * 1000;
    for (const q of explosionQueue) if (q.due && q.due > psMs) q.due += dMs;
  }
}
function villageSqContains(x, z) {
  return x >= villageMinX - 10 && x <= villageMaxX + 10 && z >= villageMinZ - 10 && z <= villageMaxZ + 10;
}
function blastInVillageSq(cx, cy, cz) {
  if (dim !== "over" || !villageHouses.length) return false;
  if (Math.abs(cy - villageCenter.y) > CLOUD_BASE / 2) return false;
  return cx >= villageMinX - 10 && cx <= villageMaxX + 10 && cz >= villageMinZ - 10 && cz <= villageMaxZ + 10;
}
function mobInVillageSq(m) {
  if (dim !== "over") return false;
  return villageSqContains(m.pos.x, m.pos.z);
}
function panicVillagers(cx, cy, cz) {
  if (!mobs.length) return;
  if (dim === "over" && !villageHouses.length) return;
  if (dim === "over" && !blastInVillageSq(cx, cy, cz)) return;
  const now = performance.now() / 1000;
  for (const m of mobs) {
    if (isMobHeld(m)) continue;
    if (isChained(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    if (m.homeId < 0) continue;
    if (dim === "over" && !mobInVillageSq(m)) continue;
    if (dim !== "over") {
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) continue;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + PANIC_TIME);
      m.speed = WALK * 2;
      m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = fleePointAway(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
      continue;
    }
    m.fleeUntil = Math.max(m.fleeUntil || 0, now + VILLAGER_PANIC_TIME);
    const house = villageHouses[m.homeId];
    const centre = { x: house.cx + 0.5, z: house.cz + 0.5 };
    const inHome = m.pos.x > house.minX && m.pos.x < house.maxX && m.pos.z > house.minZ && m.pos.z < house.maxZ;
    if (inHome) {
      m.insideT = Math.max(m.insideT, VILLAGER_PANIC_TIME);
      m.mode = "inside";
      m.target = centre;
    } else {
      m.mode = "goOut";
      m.target = centre;
      m.path = null; m.pathKey = null; m.wanderT = 99;
    }
  }
}
function panicCats(cx, cy, cz) {
  if (!mobs.length) return;
  if (dim === "over" && !villageHouses.length) return;
  if (dim === "over" && !blastInVillageSq(cx, cy, cz)) return;
  const now = performance.now() / 1000;
  for (const m of mobs) {
    if (isMobHeld(m)) continue;
    if (isChained(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    if (m.kind !== "cat") continue;
    if (dim === "over" && !mobInVillageSq(m)) continue;
    if (dim !== "over") {
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) continue;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + PANIC_TIME);
      m.speed = WALK * 2;
      m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = fleePointAway(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
      continue;
    }
    const stagger = Math.random() * 3;
    m.fleeUntil = Math.max(m.fleeUntil || 0, now + VILLAGER_PANIC_TIME + stagger);
    m.speed = WALK * 2;
    const house = villageHouses[m.homeId];
    if (!house) continue;
    const centre = { x: house.cx + 0.5, z: house.cz + 0.5 };
    const inHome = m.pos.x > house.minX && m.pos.x < house.maxX && m.pos.z > house.minZ && m.pos.z < house.maxZ;
    if (inHome) {
      m.insideT = Math.max(m.insideT, VILLAGER_PANIC_TIME + stagger);
      m.mode = "inside";
      m.target = centre;
    } else {
      m.mode = "goOut";
      m.target = centre;
      m.path = null; m.pathKey = null; m.wanderT = 99;
    }
  }
}
function panicPenMobs(cx, cy, cz) {
  if (!mobs.length) return;
  if (dim === "over" && !villagePen) return;
  if (dim === "over" && Math.abs(cy - villageCenter.y) > CLOUD_BASE / 2) return;
  const now = performance.now() / 1000;
  const insideVillage = dim === "over" && blastInVillageSq(cx, cy, cz);
  if (insideVillage) {
    for (const m of mobs) {
      if (isMobHeld(m)) continue;
      if (isChained(m)) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "pig" && m.kind !== "cow") continue;
      if (!mobInVillageSq(m)) continue;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + VILLAGE_PANIC_TIME);
      m.speed = WALK * 2;
      delete m._outsideFlee; delete m._fleeSrcX; delete m._fleeSrcZ;
      const insidePen = isInsidePen(m.pos.x, m.pos.z);
      if (insidePen) {
        m.target = wanderGoalForPen(m);
        m.wanderT = 0.25 + Math.random()*0.25; m.steerCooldown = 0; m.path = null; m.pathKey = null;
      } else {
        const gap = nearestPenGap(m.pos.x, m.pos.z);
        if (gap) {
          const inside = penGapInside(gap);
          const d = Math.hypot(inside.x - m.pos.x, inside.z - m.pos.z);
          const probe = mobProbeFree(m.pos.x, m.pos.z, (inside.x - m.pos.x)/(d||1), (inside.z - m.pos.z)/(d||1), Math.min(d, 6), m.hw, m.pos.y);
          if (probe > d * 0.6 || d < 3) {
            m.target = inside; m.wanderT = 1.2 + Math.random()*0.6; m.steerCooldown = 0;
          } else {
            m.target = randomAroundPenPoint(m); m.wanderT = 0.35 + Math.random()*0.35; m.steerCooldown = 0;
          }
        } else {
          m.target = randomAroundPenPoint(m); m.wanderT = 0.35 + Math.random()*0.35; m.steerCooldown = 0;
        }
        m.path = null; m.pathKey = null;
      }
    }
  } else {
    for (const m of mobs) {
      if (isMobHeld(m)) continue;
      if (isChained(m)) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "pig" && m.kind !== "cow") continue;
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) continue;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + PANIC_TIME);
      m.speed = WALK * 2;
      m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = fleePointAway(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
    }
  }
}
function panicWolves(cx, cy, cz) {
  if (!mobs.length) return;
  if (dim === "over" && Math.abs(cy - villageCenter.y) > CLOUD_BASE / 2) return;
  const now = performance.now() / 1000;
  const insideVillage = dim === "over" && blastInVillageSq(cx, cy, cz);
  if (insideVillage) {
    for (const m of mobs) {
      if (isMobHeld(m)) continue;
      if (isChained(m)) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "wolf") continue;
      if (!mobInVillageSq(m)) continue;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + VILLAGE_PANIC_TIME);
      m.speed = WALK * 2;
      delete m._outsideFlee;
      m._villageFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = wolfLeaveTarget(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8;
      m.steerCooldown = 0; m.path = null; m.pathKey = null;
    }
  } else {
    for (const m of mobs) {
      if (isMobHeld(m)) continue;
      if (isChained(m)) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "wolf") continue;
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) continue;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + PANIC_TIME);
      m.speed = WALK * 2;
      m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = fleePointAway(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
    }
  }
}
function groundFlee2s(m, cx, cz, now, dur) {
  m.fleeUntil = Math.max(m.fleeUntil || 0, now + dur);
  m.speed = WALK * 2;
  m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
  m.target = fleePointAway(m, cx, cz);
  m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
}
function panicLeaveDir(mx, mz, cx, cz) {
  const dx = mx - cx, dz = mz - cz;
  if (Math.hypot(dx, dz) < 0.15) { const a = Math.random() * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; }
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
}
function wolfLeaveTarget(m, cx, cz) {
  const [bdx, bdz] = panicLeaveDir(m.pos.x, m.pos.z, cx, cz);
  const baseAng = Math.atan2(bdz, bdx);
  const py = m.pos.y;
  for (let t = 0; t < 10; t++) {
    const ang = baseAng + (Math.random() - 0.5) * 0.9;
    const dist = 20 + Math.random() * 15;
    const tx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.x + Math.cos(ang) * dist));
    const tz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.z + Math.sin(ang) * dist));
    if (villageSqContains(tx, tz)) continue;
    if (aabbCollidesWorld(tx, py, tz, m.hw, m.h)) continue;
    let okGround = wolfHasMobGround(tx, tz, m.hw, py);
    if (!okGround) {
      if (wolfHasMobGround(tx, tz, m.hw, py + 1) || wolfHasMobGround(tx, tz, m.hw, py - 1)) okGround = true;
      else continue;
    }
    const d = Math.hypot(tx - m.pos.x, tz - m.pos.z);
    if (d < 1) continue;
    const free = wolfProbeFree(m.pos.x, m.pos.z, (tx - m.pos.x) / d, (tz - m.pos.z) / d, Math.min(d, 7), m.hw, py);
    if (free < d * 0.55) continue;
    return { x: tx, z: tz };
  }
  return fleePointAway(m, cx, cz);
}
function panicBirdTarget(m, cx, cz) {
  let dx = m.pos.x - cx, dz = m.pos.z - cz;
  let len = Math.hypot(dx, dz);
  if (len < 0.15) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); len = 1; }
  else { dx /= len; dz /= len; }
  const inEnd = endMobInEnd(m);
  const loB = inEnd ? DRAGON_MIN_Y : birdBandMin(m);
  const hiB = inEnd ? DRAGON_MAX_Y : birdBandMax(m);
  for (let t = 0; t < 8; t++) {
    const ang = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.2;
    const dist = 15 + Math.random() * 10;
    let tx = m.pos.x + Math.cos(ang) * dist;
    let tz = m.pos.z + Math.sin(ang) * dist;
    let ty = Math.max(loB, Math.min(hiB, m.pos.y + (Math.random() - 0.5) * 6));
    if (inEnd) { tx = endSquareCoord(tx); tz = endSquareCoord(tz); }
    else { tx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, tx)); tz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, tz)); ty = Math.max(1.5, Math.min(MAX_Y - 1, ty)); }
    if (birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, tx, ty, tz, m)) return new THREE.Vector3(tx, ty, tz);
  }
  return new THREE.Vector3(
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.x + dx * 10)),
    Math.max(loB, Math.min(hiB, m.pos.y)),
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, m.pos.z + dz * 10)));
}
function panicBirdLeaveTarget(m, cx, cz) {
  const [bdx, bdz] = panicLeaveDir(m.pos.x, m.pos.z, cx, cz);
  const baseAng = Math.atan2(bdz, bdx);
  const inEnd = endMobInEnd(m);
  const loB = inEnd ? DRAGON_MIN_Y : birdBandMin(m);
  const hiB = inEnd ? DRAGON_MAX_Y : birdBandMax(m);
  for (let t = 0; t < 10; t++) {
    const ang = baseAng + (Math.random() - 0.5) * 0.9;
    const dist = 20 + Math.random() * 15;
    let tx = m.pos.x + Math.cos(ang) * dist;
    let tz = m.pos.z + Math.sin(ang) * dist;
    let ty = Math.max(loB, Math.min(hiB, Math.max(m.pos.y, loB + 2) + Math.random() * 4));
    if (inEnd) { tx = endSquareCoord(tx); tz = endSquareCoord(tz); }
    else {
      tx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, tx));
      tz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, tz));
      ty = Math.max(1.5, Math.min(MAX_Y - 1, ty));
      if (tx >= villageMinX - 10 && tx <= villageMaxX + 10 && tz >= villageMinZ - 10 && tz <= villageMaxZ + 10) continue;
    }
    if (birdSegmentFree(m.pos.x, m.pos.y, m.pos.z, tx, ty, tz, m)) return new THREE.Vector3(tx, ty, tz);
  }
  return panicBirdTarget(m, cx, cz);
}
function panicBird(m, cx, cy, cz, villageBlast, force) {
  if (!force) {
    if (villageBlast) {
      if (dim !== "over" || !mobInVillageSq(m) || Math.abs(m.pos.y - villageCenter.y) > 20) return;
    } else {
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) return;
    }
  }
  m.perchSpot = null; m.perchGroup = null; m.perchT = 0; m.perchWander = null; m.perchWanderT = 0; m.perchTimeout = 0; m.perchRetry = 0;
  m.mode = "straight"; m.arc = null;
  m._tunnel = false; m._tFree = 0; m._tPath = null; m._tGoal = null;
  m.target = villageBlast ? panicBirdLeaveTarget(m, cx, cz) : panicBirdTarget(m, cx, cz);
  m.targetMode = "panic";
  m._panicSrcX = cx; m._panicSrcZ = cz;
  m._panicVillage = !!villageBlast;
  m._panicT = PANIC_TIME;
  m._panicUntil = performance.now() / 1000 + (villageBlast ? VILLAGE_PANIC_TIME : PANIC_TIME);
}
function panicEnderman(m, cx, cy, cz, villageBlast, force) {
  if (m.falling) return;
  if (m === carryGrappleMob && (carryGrappleActive || carryGrapplePulling)) return;
  if (!force) {
    if (villageBlast) {
      if (!mobInVillageSq(m)) return;
    } else {
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) return;
    }
  }
  const dx = m.pos.x - cx, dz = m.pos.z - cz;
  let hx = dx, hz = dz;
  if (Math.hypot(hx, hz) < 0.15) { const a = Math.random() * Math.PI * 2; hx = Math.cos(a); hz = Math.sin(a); }
  const spot = endermanSpotFor(m, Math.round(cx), Math.round(cz), ENDERMAN_BLINK_DIST, hx, hz, ENDERMAN_BLINK_FAR);
  if (!spot) return;
  m.lookT = 0;
  m.angry = ENDERMAN_ANGRY_TIME;
  m.eyeRedT = ENDERMAN_RED_TIME;
  endermanTeleport(m, spot.x, spot.z, spot.y);
}
function panicGeneric(cx, cy, cz) {
  if (!mobs.length) return;
  const now = performance.now() / 1000;
  const villageBlast = blastInVillageSq(cx, cy, cz);
  for (const m of mobs) {
    if (!m || m.kind === "dragon" || m.kind === "iron_golem") continue;
    if (isMobHeld(m)) continue;
    if (isChained(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    if (isBirdKind(m.kind)) { panicBird(m, cx, cy, cz, villageBlast); continue; }
    if (m.kind === "enderman") { panicEnderman(m, cx, cy, cz, villageBlast); continue; }
    if (villageBlast) {
      if (!mobInVillageSq(m)) continue;
    } else {
      const dx = m.pos.x - cx, dy = m.pos.y - cy, dz = m.pos.z - cz;
      if (Math.hypot(dx, dy, dz) > OUTSIDE_PANIC_DIST) continue;
    }
    if (m.fleeUntil != null && m.fleeUntil > now + PANIC_TIME) continue;
    groundFlee2s(m, cx, cz, now, villageBlast ? VILLAGE_PANIC_TIME : PANIC_TIME);
  }
}
function chainDownstreamOf(v) {
  const out = [];
  if (!v || v.kind === "dragon") return out;
  const seen = new Set();
  let c = v;
  while (c && !seen.has(c.id)) {
    seen.add(c.id);
    out.push(c);
    const nid = chainChild.get(c.id);
    const n = nid !== undefined ? mobById.get(nid) : null;
    c = n && mobs.includes(n) ? n : null;
  }
  return out;
}
function panicSingleMob(m, cx, cy, cz, force) {
  if (!m || !mobs.includes(m)) return;
  if (m.kind === "dragon" || m.kind === "iron_golem") return;
  if (isMobHeld(m)) return;
  if (isChained(m)) return;
  if (m.dim !== undefined && m.dim !== dim) return;
  const vb = blastInVillageSq(cx, cy, cz);
  if (isBirdKind(m.kind)) { panicBird(m, cx, cy, cz, vb, force); return; }
  if (m.kind === "enderman") { panicEnderman(m, cx, cy, cz, vb, force); return; }
  const now = performance.now() / 1000;
  if (!force && m.fleeUntil != null && m.fleeUntil > now + PANIC_TIME) return;
  groundFlee2s(m, cx, cz, now, vb && mobInVillageSq(m) ? VILLAGE_PANIC_TIME : PANIC_TIME);
  if (m.kind === "wolf" && vb && mobInVillageSq(m)) {
    delete m._outsideFlee;
    m._villageFlee = true;
    m.target = wolfLeaveTarget(m, cx, cz);
    m.steerCooldown = 0; m.path = null; m.pathKey = null;
  }
}
function handleMobExplosion(cx, cy, cz) {
  if (blastInVillageSq(cx, cy, cz)) villagePanicUntil = performance.now() / 1000 + VILLAGE_PANIC_TIME;
  if (dim === "over" || dim === "nether") { panicVillagers(cx, cy, cz); panicCats(cx, cy, cz); panicPenMobs(cx, cy, cz); panicWolves(cx, cy, cz); }
  panicGeneric(cx, cy, cz);
}

function generateWorld() {
  dim = "over"; // setBlock records column tops per dim, so pin it while generating
  world = worlds.over;
  worlds.over.clear();
  colTops.over.fill(0);
  portalBlockSets.over.clear();
  glowstoneBlockSets.over.clear();
  glowVariants.over.clear();
  visitGrid.clear();
  waterScale = 1 + (hash2(0, 0, seed + 333) * 4 | 0);
  waterDepth = 1 + (hash2(0, 0, seed + 444) * 3 | 0);
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
  computeVillageLayout();
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z++) {
      const inVillage = x >= villageMinX && x <= villageMaxX && z >= villageMinZ && z <= villageMaxZ;
      let h = heightAt(x, z);
      if (inVillage) h = villageCenter.y;
      for (let y = 0; y <= h; y++) {
        let id = STONE;
        if (y === h) id = inVillage ? STONE : (h <= WATER_LEVEL + 1 ? SAND : GRASS);
        else if (y >= h - 2) id = DIRT;
        else if (y >= h - 5 && Math.random() < 0.3) id = STONE;
        setBlock(x, y, z, id);
      }
      if (!inVillage && h < WATER_LEVEL) for (let y = h + 1; y <= WATER_LEVEL; y++) setBlock(x, y, z, WATER);
      if (inVillage) continue;
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
  placeVillageHouses();
  placeVillagePen();
  placeVillagePenPool();
  placeVillagePool();
  generateClouds();
  generateMoon();
}

// Scatter solid white clouds you can climb on, made of a few overlapping 3D
// ellipsoid puffs so they look like real fluffy cloud clusters. Each cloud
// picks a height on its own; some (~30%) are scaled up to 2x. The band starts
// at 2x max tree height and extends 3x beyond it, and CLOUD_LAYERS copies of
// that band are stacked on top of each other (reseeded per layer) up the sky.
function generateClouds() {
  const n = Math.round(((WORLD_RADIUS * 2) * (WORLD_RADIUS * 2)) / 1100);
  for (let l = 0; l < CLOUD_LAYERS; l++) {
    const lo = CLOUD_BASE + l * CLOUD_LAYER;
    const ls = seed + 4242 + l * 131;
    for (let i = 0; i < n; i++) {
      const cx = Math.round((hash2(i, 1, ls) * 2 - 1) * (WORLD_RADIUS - 8));
      const cz = Math.round((hash2(i, 2, ls) * 2 - 1) * (WORLD_RADIUS - 8));
      const scale = hash2(i, 8, ls) < 0.3 ? 2 : 1;
      const yBase = lo + Math.floor(hash2(i, 5, ls) * (CLOUD_LAYER - 8));
      const puffs = 3 + Math.floor(hash2(i, 7, ls) * 3);
      const spread = (1.5 + hash2(i, 3, ls) * 4) * scale;
      for (let p = 0; p < puffs; p++) {
        const ox = (hash2(i, p, 111 + l) * 2 - 1) * spread;
        const oz = (hash2(i, p, 222 + l) * 2 - 1) * spread;
        const oy = (hash2(i, p, 333 + l) - 0.5) * spread * 0.5;
        const Px = cx + Math.round(ox);
        const Pz = cz + Math.round(oz);
        const Py = yBase + Math.round(oy);
        const ra = 1 + Math.round((1.5 + hash2(i, p, 444 + l) * 3) * scale);
        const rb = 1 + Math.round((1.5 + hash2(i, p, 555 + l) * 2.5) * scale);
        const rh = 1 + Math.round((hash2(i, p, 666 + l) * 2.5) * scale);
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
}

let moonLakesGenerated = false;
function generateMoon() {
  const R = MOON_R;
  const base = MOON_Y;
  const R2 = R * R;
  const inner = (R - MOON_THICK) * (R - MOON_THICK);
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d2 = x * x + z * z;
    if (d2 > R2) continue;
    const h = Math.floor(Math.sqrt(R2 - d2));
    for (let y = base - MOON_THICK + 1; y <= base; y++) {
      if (y < 0 || y > MAX_Y) continue;
      setBlock(x, y, z, MOON);
    }
    for (let y = base - h; y < base - MOON_THICK + 1; y++) {
      const dy = base - y;
      const dist2 = d2 + dy * dy;
      if (dist2 <= R2 && dist2 >= inner) {
        if (y < 0 || y > MAX_Y) continue;
        setBlock(x, y, z, MOON);
      }
    }
  }
  moonLakesGenerated = false;
}
function generateMoonLakes() {
  if (moonLakesGenerated) return;
  const R = MOON_R;
  const base = MOON_Y;
  const R2 = R * R;
  const lakeN = 6;
  const w = worlds.over;
  const ct = colTops.over;
  moonLakesChunkSet.clear();
  for (let i = 0; i < lakeN; i++) {
    const a = hash2(i, 11, seed + 9211) * Math.PI * 2;
    const r = Math.sqrt(hash2(i, 12, seed + 9212)) * (R * 0.66);
    const cx = Math.round(Math.cos(a) * r);
    const cz = Math.round(Math.sin(a) * r);
    const cr = 4 + Math.floor(hash2(i, 13, seed + 9213) * 4);
    for (let dx = -cr - 1; dx <= cr + 1; dx++) for (let dz = -cr - 1; dz <= cr + 1; dz++) {
      const ang = Math.atan2(dz, dx);
      const noise = (hash2(cx + dx, cz + dz, seed + 9220) - 0.5) * 1.8;
      const rr = cr + noise + Math.sin(ang * 3 + i) * 0.7;
      if (dx * dx + dz * dz > rr * rr) continue;
      const x = cx + dx, z = cz + dz;
      const d2 = x * x + z * z;
      if (d2 > R2) continue;
      const h = Math.floor(Math.sqrt(R2 - d2));
      if (h === 0) continue;
      const bottom = base - h;
      const ci = colTopIdx(x, z);
      if (base > ct[ci]) ct[ci] = base;
      moonLakesChunkSet.add(chunkOf(x) + "_" + chunkOf(z));
      for (let y = bottom; y <= base; y++) {
        if (y < 0 || y > MAX_Y) continue;
        w.set(key(x, y, z), MOON_WATER);
      }
    }
  }
  portalDirty = true;
  worldDirty = true;
  moonLakesGenerated = true;
}
function removeMoonLakes() {
  if (!moonLakesGenerated) return;
  const R = MOON_R;
  const base = MOON_Y;
  const R2 = R * R;
  const inner = (R - MOON_THICK) * (R - MOON_THICK);
  const w = worlds.over;
  for (let i = 0; i < 6; i++) {
    const a = hash2(i, 11, seed + 9211) * Math.PI * 2;
    const r = Math.sqrt(hash2(i, 12, seed + 9212)) * (R * 0.66);
    const cx = Math.round(Math.cos(a) * r);
    const cz = Math.round(Math.sin(a) * r);
    const cr = 4 + Math.floor(hash2(i, 13, seed + 9213) * 4);
    for (let dx = -cr - 1; dx <= cr + 1; dx++) for (let dz = -cr - 1; dz <= cr + 1; dz++) {
      const ang = Math.atan2(dz, dx);
      const noise = (hash2(cx + dx, cz + dz, seed + 9220) - 0.5) * 1.8;
      const rr = cr + noise + Math.sin(ang * 3 + i) * 0.7;
      if (dx * dx + dz * dz > rr * rr) continue;
      const x = cx + dx, z = cz + dz;
      const d2 = x * x + z * z;
      if (d2 > R2) continue;
      const h = Math.floor(Math.sqrt(R2 - d2));
      if (h === 0) continue;
      const bottom = base - h;
      for (let y = bottom; y <= base; y++) {
        if (y < 0 || y > MAX_Y) continue;
        const k = key(x, y, z);
        if (y >= base - MOON_THICK + 1) w.set(k, MOON);
        else {
          const dy = base - y;
          const dist2 = d2 + dy * dy;
          if (dist2 <= R2 && dist2 >= inner) w.set(k, MOON);
          else w.delete(k);
        }
      }
    }
  }
  portalDirty = true;
  worldDirty = true;
  rebuildColTops("over");
  moonLakesGenerated = false;
}

function generateEnd() {
  const w = worlds.end;
  w.clear();
  colTops.end.fill(0);
  portalBlockSets.end.clear();
  glowstoneBlockSets.end.clear();
  glowVariants.end.clear();
  const R = END_PLATFORM_R;
  const ct = colTops.end;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      for (let y = END_PLATFORM_TOP; y <= END_PLATFORM_TOP; y++) w.set(key(x, y, z), ENDSTONE);
      const ci = colTopIdx(x, z);
      if (END_PLATFORM_TOP > ct[ci]) ct[ci] = END_PLATFORM_TOP;
    }
}

// ---------------------------------------------------------------------------
// The Nether: a hostile lava dimension under a dark grey sky.
// Immense fire-spewing volcanoes rise out of a glowing lava sea; winding
// canyons cut down to the fire, and lava streaks pour down the faces of
// cliffs that drop into the sea.
// ---------------------------------------------------------------------------
const NETHER_FIRE_LEVEL = 12;
const NETHER_BIRD_MIN_Y = NETHER_FIRE_LEVEL + 5;
const NETHER_BIRD_MAX_Y = 300;
function birdDimOf(m) { return (m && m.dim !== undefined ? m.dim : dim); }
function birdBandMinFor(d) { return d === "nether" ? NETHER_BIRD_MIN_Y : BIRD_MIN_Y; }
function birdBandMaxFor(d) { return d === "nether" ? netherBirdCeiling() : BIRD_MAX_Y; }
function netherBirdCeiling() {
  let top = 0;
  for (const v of volcanoes) if (v && v.rim > top) top = v.rim;
  return top > 0 ? top + 8 : NETHER_BIRD_MAX_Y;
}
function birdBandMin(m) { return birdBandMinFor(birdDimOf(m)); }
function birdBandMax(m) { return birdBandMaxFor(birdDimOf(m)); }
function birdNetherLegY(aroundY, wide) {
  const lo = birdBandMinFor("nether") + 1, hi = birdBandMaxFor("nether") - 1;
  if (Math.random() < 0.25) {
    const span = wide ? Math.max(1, hi - lo) : 150;
    const c = wide ? (lo + hi) / 2 : aroundY;
    return Math.max(lo, Math.min(hi, c + (Math.random() - 0.5) * span));
  }
  return Math.max(lo, Math.min(hi, aroundY + (Math.random() - 0.5) * 60));
}
const NETHER_RIVER_COUNT = 4;
const HOLLOW_SHELL = 2;             // cone wall / tunnel envelope thickness kept when hollowing
const CASCADE_THICK = 5;            // lava cascade depth: 1 block sunk + 4 proud of the flank
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

// A cell counts as air for the hollowing when it is missing from the world map
// or stored as AIR (the generators leave 0-valued entries behind, e.g. bores).
function volcanoAir(w, x, y, z) {
  const id = w.get(key(x, y, z));
  return id === undefined || id === AIR;
}

// Hollow out the volcano cone: strip the deep rock so each volcano is one big
// walkable interior chamber while the exterior surface, the central lava
// column and the 4x4 tunnel corridors are untouched. The cone keeps a thick
// wall shell (`HOLLOW_SHELL`) and every tunnel/coulee keeps a thick rock
// envelope: a solid cell is carved only when it lies more than `HOLLOW_SHELL`
// steps of solid rock away from any air, so no exterior face is exposed and
// the tunnels read exactly as they were, and only outside the protected core
// cylinder that keeps the crater bowl, the lava shaft and the tunnel mouths
// intact. Any rock cell touching a LAVA cell is kept as a 1-block wall, so
// the thick lava cascades and pours are hidden from the chamber interior.
// The player must dig through the thick wall to reach the chamber.
function hollowVolcanoes() {
  const w = worlds.nether;
  const S = WORLD_RADIUS;
  for (const v of volcanoes) {
    const minX = Math.max(-S, v.x - v.radius);
    const maxX = Math.min(S, v.x + v.radius);
    const minZ = Math.max(-S, v.z - v.radius);
    const maxZ = Math.min(S, v.z + v.radius);
    const R2 = v.radius * v.radius;
    const coreR2 = (v.craterR + 3) * (v.craterR + 3);
    const topAt = (x, z) =>
      Math.min(MAX_Y, Math.max(1, Math.round(Math.max(netherLandHeight(x, z), volcanoHeightAt(v, x, z)))));
    const solid = (x, y, z) => {
      const id = w.get(key(x, y, z));
      return id === NETHERRACK || id === SOULSAND;
    };
    const inRing = (dx, dz) => {
      const d2 = dx * dx + dz * dz;
      return d2 < R2 && d2 > coreR2;
    };
    // First pass: collect every solid ring cell; the ones that touch air (all
    // exterior faces, tunnel bores and the like) seed the shell.
    const cells = [];
    const seeds = [];
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const dx = x - v.x, dz = z - v.z;
        if (!inRing(dx, dz)) continue;
        const top = topAt(x, z);
        for (let y = 1; y <= top; y++) {
          if (!solid(x, y, z)) continue;
          const k = key(x, y, z);
          cells.push(k);
          if (volcanoAir(w, x - 1, y, z) || volcanoAir(w, x + 1, y, z) ||
              volcanoAir(w, x, y - 1, z) || volcanoAir(w, x, y + 1, z) ||
              volcanoAir(w, x, y, z - 1) || volcanoAir(w, x, y, z + 1)) seeds.push(k);
        }
      }
    }
    // Bounded flood from the shell: everything the flood reaches within
    // HOLLOW_SHELL steps of air is kept, the remaining deep rock is hollowed.
    const keep = new Set(seeds);
    let layer = seeds;
    for (let d = 0; d < HOLLOW_SHELL - 1 && layer.length; d++) {
      const next = [];
      for (const k of layer) {
        const [x, y, z] = keyXYZ(k);
        if (solid(x - 1, y, z) && !keep.has(key(x - 1, y, z))) keep.add(key(x - 1, y, z)), next.push(key(x - 1, y, z));
        if (solid(x + 1, y, z) && !keep.has(key(x + 1, y, z))) keep.add(key(x + 1, y, z)), next.push(key(x + 1, y, z));
        if (solid(x, y - 1, z) && !keep.has(key(x, y - 1, z))) keep.add(key(x, y - 1, z)), next.push(key(x, y - 1, z));
        if (solid(x, y + 1, z) && !keep.has(key(x, y + 1, z))) keep.add(key(x, y + 1, z)), next.push(key(x, y + 1, z));
        if (solid(x, y, z - 1) && !keep.has(key(x, y, z - 1))) keep.add(key(x, y, z - 1)), next.push(key(x, y, z - 1));
        if (solid(x, y, z + 1) && !keep.has(key(x, y, z + 1))) keep.add(key(x, y, z + 1)), next.push(key(x, y, z + 1));
      }
      layer = next;
    }
    for (const k of cells) {
      if (keep.has(k)) continue;
      const [x, y, z] = keyXYZ(k);
      // Keep a 1-block wall of rock against every lava cell (cascades, crater
      // and shaft pours), so the thick flows are hidden from the chamber.
      if (w.get(key(x - 1, y, z)) === LAVA || w.get(key(x + 1, y, z)) === LAVA ||
          w.get(key(x, y - 1, z)) === LAVA || w.get(key(x, y + 1, z)) === LAVA ||
          w.get(key(x, y, z - 1)) === LAVA || w.get(key(x, y, z + 1)) === LAVA) continue;
      w.set(k, AIR);
    }
  }
}

// Big top-to-bottom lava flows down the interior-facing faces of each volcano:
// a broad main coulee and a narrower side coulee spill out of the crater rim on
// the side that overlooks the platform interior and run the whole way to the
// very base without interruption. Each course is a CASCADE_THICK-thick tongue
// down the visible surface (volcano flank where the cone rises, island terrain
// where it doesn't) — 1 block sinks below the surface so the flow reads as
// carved into the volcano wall, the rest stand proud so it reads thick from the
// outside, so every run is an unbroken sheet of lava from the rim to the fire.
// `hollowVolcanoes` keeps a 1-block shell of rock
// against every lava cell, so the flow never breaches into the hollow chamber.
// Past the cone's foot each course keeps cutting a narrow trench across any
// island in its way until it reaches the great lava lake, so the fires pour
// into it.
function volcanoCascades() {
  const w = worlds.nether;
  const S = WORLD_RADIUS;
  const courses = (v) => [
    { ang: v.flowAng, half: 0.17, foot: v.radius, mx: 6 },
    { ang: v.flowAng2, half: 0.09, foot: v.radius, mx: 4 },
  ];
  for (const v of volcanoes) {
    for (const course of courses(v)) {
      const x0 = Math.max(-S, v.x - Math.ceil(course.foot) - 1);
      const x1 = Math.min(S, v.x + Math.ceil(course.foot) + 1);
      const z0 = Math.max(-S, v.z - Math.ceil(course.foot) - 1);
      const z1 = Math.min(S, v.z + Math.ceil(course.foot) + 1);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const dx = x - v.x, dz = z - v.z;
          const d = Math.hypot(dx, dz);
          if (d < v.craterR - 1 || d > course.foot) continue;
          let a = Math.atan2(dz, dx) - course.ang;
          while (a > Math.PI) a -= Math.PI * 2;
          while (a < -Math.PI) a += Math.PI * 2;
          if (Math.abs(a) > course.half) continue;
          // Follow the actual surface: the cone flank where it stands tall, the
          // island terrain where the cone is buried, so the coulee keeps running
          // downhill all the way to the foot instead of clipping into the rock.
          const vh = volcanoHeightAt(v, x, z);
          const surf = vh == null ? netherLandHeight(x, z) : Math.max(vh, netherLandHeight(x, z));
          const hy = Math.round(surf);
          if (hy < 1) continue;
          // A CASCADE_THICK-thick tongue down the surface: 1 block sunk below
          // the surface so the flow digs a little into the volcano wall, the
          // rest standing proud so the flow reads thick from the outside.
          for (let y = hy - 1; y <= hy + (CASCADE_THICK - 2); y++)
            if (y >= 1 && y <= MAX_Y) w.set(key(x, y, z), LAVA);
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
  hollowVolcanoes();
  rebuildColTops("nether");
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1500);
camera.rotation.order = "YXZ";

const playerArms = new THREE.Group();
let carryMob = null;
const CARRY_FWD = 1.0;
const CARRY_SIDE = 1.0;
const CARRY_DIST = 1.2;
const CARRY_DOWN = 0.40;
(function makePlayerArms() {
  const armGeo = new THREE.BoxGeometry(0.13, 0.42, 0.13);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc19a78, roughness: 0.85 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.9 });
  const handMat = new THREE.MeshStandardMaterial({ color: 0xc19a78, roughness: 0.85 });
  function makeArm(side) {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(armGeo, skinMat);
    upper.position.set(0, -0.14, 0);
    g.add(upper);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.15), sleeveMat);
    sleeve.position.set(0, 0.08, 0);
    g.add(sleeve);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), handMat);
    hand.position.set(0, -0.36, 0);
    g.add(hand);
    g.position.set(side * 0.34, -0.32, -0.52);
    g.rotation.set(-0.55, 0, side * 0.18);
    return g;
  }
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  leftArm.name = "leftArm";
  rightArm.name = "rightArm";
  playerArms.add(leftArm);
  playerArms.add(rightArm);
  playerArms.visible = false;
  camera.add(playerArms);
})();

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

// High-altitude night sky: as the player climbs toward the top cloud decks,
// the day sky/fog colour fades to near-black and a sphere of stars (following
// the camera, like the Nether dome) fades in. Purely cosmetic — driven from
// the main loop in the Overworld only.
const skyStars = (() => {
  const N = 520;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1;
    const ph = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    arr[i * 3] = Math.cos(ph) * r * 820;
    arr[i * 3 + 1] = u * 820;
    arr[i * 3 + 2] = Math.sin(ph) * r * 820;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const m = new THREE.PointsMaterial({
    color: 0xffffff, size: 2.2, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.visible = false;
  scene.add(p);
  return p;
})();
const DAY_SKY = new THREE.Color(0x87ceeb);
const SPACE_SKY = new THREE.Color(0x05070f);
const SKY_SPACE_START = CLOUD_BASE + CLOUD_SPAN * 3 / 8;
const SKY_SPACE_END = CLOUD_BASE + CLOUD_SPAN * 5 / 8;
const SKY_STAR_START = SKY_SPACE_START, SKY_STAR_FULL = SKY_SPACE_END;
const BIRD_MAX_Y = SKY_SPACE_START;

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

// Liquid rendering: liquids are drawn as edge-free boundary faces (only faces
// against air or another transparent block; liquid/liquid and liquid/solid
// faces are culled) instead of full cubes, so adjacent liquid blocks no longer
// show seams. Top faces get a per-column depth bucket (deeper = more opaque)
// while sides/bottom use one body opacity. Underwater, the main loop fades the
// fog/background toward the liquid tint. Face geometries are shared exactly
// like boxGeo.
const liquidFaceGeos = {
  px: new THREE.PlaneGeometry(1, 1).rotateY( Math.PI / 2).translate( 0.5, 0, 0),
  nx: new THREE.PlaneGeometry(1, 1).rotateY(-Math.PI / 2).translate(-0.5, 0, 0),
  py: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0,  0.5, 0),
  ny: new THREE.PlaneGeometry(1, 1).rotateX( Math.PI / 2).translate(0, -0.5, 0),
  pz: new THREE.PlaneGeometry(1, 1).translate(0, 0,  0.5),
  nz: new THREE.PlaneGeometry(1, 1).rotateY( Math.PI).translate(0, 0, -0.5),
};

const WATER_BUCKETS     = [0.60, 0.75, 0.88, 0.96];
const WATER_BODY        = 0.70;
const LAVA_BUCKETS      = [1, 1, 1, 1];
const LAVA_BODY         = 1;
const MOONWATER_BUCKETS = [0.45, 0.60, 0.70, 0.80];
const MOONWATER_BODY    = 0.85;
const LIQUID_INSIDE = 0.06;
const WATER_INSIDE_EMISSIVE = 0x8fc3ff;
const LIQUID_TINT = { [WATER]: 0x0d3b7a, [LAVA]: 0x14145a, [MOON_WATER]: 0x7a7e82 };
const liquidTintColors = {
  [WATER]: new THREE.Color(LIQUID_TINT[WATER]),
  [LAVA]: new THREE.Color(LIQUID_TINT[LAVA]),
  [MOON_WATER]: new THREE.Color(LIQUID_TINT[MOON_WATER]),
};
const UNDERWATER_FOG_NEAR = 1.0;
const LIQUID_FOG_FAR = { [WATER]: 14, [LAVA]: 1.5, [MOON_WATER]: 6 };
const WATER_FOG_DEPTH = 0.01;
const UNDERWATER_TINT = 0.45;
let envFogNear = 60, envFogFar = 160;
const envBackground = new THREE.Color(0x87ceeb);
const envFogColor = new THREE.Color(0x87ceeb);
let underSubSmooth = 0;
let underTintId = WATER;

const liquidBodyMats = new Map();    // id -> material
const liquidBucketMats = new Map();  // id -> material[4]
const liquidBucketMatsIn = new Map(); // id -> material[4] (BackSide, seen from inside)

function makeLiquidMat(id, opacity, side) {
  const opaqueLava = id === LAVA && side !== THREE.BackSide;
  const opts = opaqueLava
    ? { transparent: false, opacity: 1, depthWrite: true, side: side || THREE.DoubleSide }
    : { transparent: true, opacity, depthWrite: false, side: side || THREE.DoubleSide };
  let m;
  if (id === WATER) m = new THREE.MeshLambertMaterial({ map: TEX.water, ...opts });
  else if (id === LAVA) m = new THREE.MeshBasicMaterial({ map: TEX.lava, fog: false, ...opts });
  else m = new THREE.MeshBasicMaterial({ map: TEX.moonwater, fog: false, ...opts });
  m.userData.baseOpacity = opacity;
  return m;
}
function liquidBodyMat(id) {
  if (!liquidBodyMats.has(id)) {
    const body = id === WATER ? WATER_BODY : (id === LAVA ? LAVA_BODY : MOONWATER_BODY);
    liquidBodyMats.set(id, makeLiquidMat(id, body));
  }
  return liquidBodyMats.get(id);
}
function liquidBucketMat(id, bucket) {
  if (!liquidBucketMats.has(id)) liquidBucketMats.set(id, []);
  const arr = liquidBucketMats.get(id);
  if (!arr[bucket]) {
    const b = id === WATER ? WATER_BUCKETS : (id === LAVA ? LAVA_BUCKETS : MOONWATER_BUCKETS);
    arr[bucket] = makeLiquidMat(id, b[bucket], THREE.FrontSide);
  }
  return arr[bucket];
}
function liquidBucketMatIn(id, bucket) {
  if (!liquidBucketMatsIn.has(id)) liquidBucketMatsIn.set(id, []);
  const arr = liquidBucketMatsIn.get(id);
  if (!arr[bucket]) {
    const b = id === WATER ? WATER_BUCKETS : (id === LAVA ? LAVA_BUCKETS : MOONWATER_BUCKETS);
    arr[bucket] = makeLiquidMat(id, b[bucket] * LIQUID_INSIDE, THREE.BackSide);
    if (id === WATER) arr[bucket].emissive.setHex(WATER_INSIDE_EMISSIVE);
  }
  return arr[bucket];
}
function liquidFaceVisible(x, y, z, id, dx, dy, dz) {
  const n = getBlock(x + dx, y + dy, z + dz);
  if (n === id) return false;
  const info = BLOCK_INFO[n];
  if (!info) return true;
  if (info.opaque || info.solid) return false;
  return true;
}
function liquidColumnDepth(x, y, z, id) {
  let d = 0;
  for (let yy = y; yy >= 0; yy--) {
    if (getBlock(x, yy, z) === id) d++; else break;
  }
  return d;
}
function eyeLiquidId(ex, ey, ez) {
  const id = getBlock(Math.floor(ex), Math.floor(ey), Math.floor(ez));
  return isLiquid(id) ? id : 0;
}
function liquidTopAbove(bx, by, bz, id) {
  let top = by;
  let guard = 0;
  while (guard++ < 160 && top + 1 <= MAX_Y && getBlock(bx, top + 1, bz) === id) top++;
  return top + 1;
}

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
// onto the terrain around it. Glowstones are bucketed into stable grid cells
// whose centroids are recomputed only when blocks change
// (`recomputeGlowClusters`: stones are bucketed into `GLOW_LIGHT_CELL`-wide
// grid cells, one centroid + majority colour per occupied cell, so a long row
// spans several cells and gets several overlapping pools instead of one), and
// a fixed pool of `PointLight`s is assigned to
// the clusters nearest the player. The assignment re-evaluates at most every
// `GLOW_LIGHT_REFRESH` seconds and only when the player crosses a chunk, and a
// light keeps its current cluster while that cluster stays among the nearest
// lit ones — so the glow never jumps between the stones of a ring, never
// flickers while you walk toward a cluster, and costs nothing in between.
// Kept lights snap to the live centroid on every re-assignment, and a block
// change drops all assignments so the next sync re-slots by distance — a
// light can never sit frozen at a stale spot while its stones moved on.
const GLOW_LIGHT_RADIUS = 12;
const GLOW_LIGHT_DIST = Math.ceil(RENDER_DIST * CHUNK * Math.SQRT2);
const GLOW_LIGHT_MAX = 16;
const GLOW_LIGHT_CELL = 5;
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
  for (const L of glowLights) if (L) { L.cur = -1; L.light.visible = false; }
  if (!set || !set.size) return;
  const groups = new Map();
  for (const k of set) {
    const [x, y, z] = keyXYZ(k);
    const ck = Math.floor(x / GLOW_LIGHT_CELL) + "," + Math.floor(y / GLOW_LIGHT_CELL) + "," + Math.floor(z / GLOW_LIGHT_CELL);
    let g = groups.get(ck);
    if (!g) { g = { n: 0, sx: 0, sy: 0, sz: 0, votes: {} }; groups.set(ck, g); }
    g.n++; g.sx += x; g.sy += y; g.sz += z;
    const v = gv.get(k);
    if (v !== undefined) g.votes[v] = (g.votes[v] || 0) + 1;
  }
  for (const g of groups.values()) {
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
  // Kept lights snap to the live centroid: the cluster may have moved since
  // the light was assigned (blocks added/removed), and holding a stale spot
  // is exactly the frozen-pool bug.
  for (let i = 0; i < glowLights.length; i++) {
    const L = glowLights[i];
    if (!L || L.cur < 0 || L.cur >= glowClusters.length) continue;
    for (let j = 0; j < want; j++) {
      if (ranked[j][1] === L.cur) {
        active[L.cur] = 1;
        L.light.color.setHex(GLOW_PALETTES[glowClusters[L.cur].v].glow);
        L.light.position.set(glowClusters[L.cur].x, glowClusters[L.cur].y - 0.15, glowClusters[L.cur].z);
        L.light.visible = true;
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

// Tree-top voxel stars crowning moon pines. One global InstancedMesh of small
// opaque cubes (like garland bulbs) draws every star; each star slowly spins
// on itself and doubles as a rotating platform riders stand on. The style is
// global (cycled live with G): every star follows it, future pines included.
const STAR_SPIN = 0.5;   // rad/s, one turn in ~12s
const STAR_PLATFORM_R = 0.75;
const STAR_CY = 5.0;     // star centre above the foliage summit (spire tops ~+4.35)
const STAR_TOP = 0.65;   // platform surface above the star centre
const STAR_MAX = 40000;
let starAngle = 0;
let starStyleIdx = 0;
let starMesh = null;
const starRecs = [];       // {x, y, z, phase, base} render records, rebuilt live
const starPlatforms = [];  // {x, top, z} ride surfaces, rebuilt live
const starDummy = new THREE.Object3D();
const starColor = new THREE.Color();
let starShape = null;      // [{dx, dy, dz, shade}] local cubes of current style
let starShapeKey = -1;
function buildStarShape(st) {
  const seg = Math.PI * 2 / 5;
  const G = st.grid, c = st.cube;
  const R2 = st.R * 0.72, r2 = st.r * 0.72;
  const relOf = (x, y) => {
    let rel = (Math.atan2(y, x) - Math.PI / 2) % seg;
    if (rel < 0) rel += seg;
    return rel;
  };
  const inside = (x, y, R, r) => {
    const d = Math.hypot(x, y);
    if (d > R) return false;
    const rel = relOf(x, y);
    const tri = 1 - Math.abs(rel - seg / 2) / (seg / 2);
    return d <= r + (R - r) * (1 - tri);
  };
  const cells = [];
  const put = (i, j, h, shade) => {
    for (let k = 1; k <= h; k++) {
      const s = k >= 3 ? 4 : k === 2 ? 3 : shade;
      cells.push({ dx: i * c, dy: j * c, dz: k * c, shade: s });
      cells.push({ dx: i * c, dy: j * c, dz: -k * c, shade: s });
    }
  };
  for (let i = -G; i <= G; i++) for (let j = -G; j <= G; j++) {
    if (!inside(i, j, st.R, st.r)) continue;
    const d = Math.hypot(i, j);
    const rel = relOf(i, j);
    const tri = 1 - Math.abs(rel - seg / 2) / (seg / 2);
    const axis = Math.min(rel, seg - rel);
    const side = rel < seg / 2 ? 1 : 2;
    const border = !inside(i + 1, j, st.R, st.r) || !inside(i - 1, j, st.R, st.r) ||
                   !inside(i, j + 1, st.R, st.r) || !inside(i, j - 1, st.R, st.r);
    const mid = inside(i, j, R2, r2);
    const ctr = (i === 0 && j === 0);
    cells.push({ dx: i * c, dy: j * c, dz: 0, shade: ctr ? 4 : border ? 0 : side });
    if (st.relief === "flat") continue;
    switch (st.relief) {
      case "boss":
        if (d <= 1.6) put(i, j, 1, 3);
        break;
      case "pyramid":
        if (d <= 1.6) put(i, j, 2, 4);
        else if (d <= 2.6) put(i, j, 1, side);
        break;
      case "ridges":
        if (mid && axis < seg * 0.10) put(i, j, 2, 3);
        break;
      case "ring":
        if (Math.abs(d - 3) <= 0.8) put(i, j, 1, side);
        break;
      case "branchPyr": {
        if (!mid) break;
        const edge = r2 + (R2 - r2) * (1 - tri);
        const t = Math.min(1, d / edge);
        put(i, j, Math.max(0, Math.round(3 * (1 - t) * (1 - axis / (seg / 2)))), side);
        break;
      }
      case "diamond":
        if (d <= 1.6) put(i, j, 3, 4);
        else if (d <= 2.6) put(i, j, 2, side);
        else if (mid && axis < seg * 0.10) put(i, j, 2, 3);
        else if (mid) put(i, j, 1, side);
        break;
      case "chunky3d":
        if (d <= 1.6) put(i, j, 2, 4);
        else if (mid && axis < seg * 0.10) put(i, j, 2, 3);
        else if (mid) put(i, j, 1, side);
        break;
    }
  }
  return cells;
}
function starShadeColor(shade, out) {
  const t = STAR_YELLOW[shade] || STAR_YELLOW[0];
  return out.setRGB(t[0], t[1], t[2]);
}
let starCubeSize = 0;
let starBase = null, starPhase = null, starPulseT = 0, starCubeCount = 0;
function ensureStarMesh(cube) {
  if (!starMesh) {
    starMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(cube, cube, cube), new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }), STAR_MAX);
    starMesh.frustumCulled = false;
    starMesh.visible = false;
    starMesh.count = 0;
    scene.add(starMesh);
    starCubeSize = cube;
  } else if (cube !== starCubeSize) {
    starMesh.geometry.dispose();
    starMesh.geometry = new THREE.BoxGeometry(cube, cube, cube);
    starCubeSize = cube;
  }
}
function rebuildStars() {
  starRecs.length = 0;
  starPlatforms.length = 0;
  const st = STAR_STYLES[starStyleIdx];
  ensureStarMesh(st.cube);
  if (starShapeKey !== starStyleIdx) { starShape = buildStarShape(st); starShapeKey = starStyleIdx; }
  let n = 0;
  if (dim === "over" && world === worlds.over && starShape && decorVisible) {
    for (const p of plantedPines.values()) {
      if (!moonZoneGeo(p.x, p.y, p.z)) continue;   // moon pines only: ground pines stay bare
      if (performance.now() / 1000 - (p.bornAt || -1e9) < 1) continue;   // star spawns once garlands are up
      const summit = pineSummit(p.y, p.m, p.e);
      // The star hangs on the 4 top spire chunks only: it stays while at
      // least one run keeps a visible spire bulb above summit + 0.2, and
      // drops only once all 4 terminal chunks are broken. Each tail drops
      // atomically via its own anchor block (span rule); nothing else —
      // summit breaks, helix breaks, closure, float — can touch it.
      const up = pineUpperVis.get(key(p.x, p.y, p.z));
      if (!up || !up.some((c) => c > 0)) continue;   // all 4 spire chunks gone: no star
      const cx = p.x + 0.5, cy = summit + STAR_CY, cz = p.z + 0.5;
      starPlatforms.push({ x: cx, top: cy + STAR_TOP, z: cz });
      const rec = { x: cx, y: cy, z: cz, phase: p.seed / 255 * Math.PI * 2, base: n };
      for (const c of starShape) {
        if (n >= STAR_MAX) break;
        starDummy.position.set(cx + c.dx, cy + c.dy, cz + c.dz);
        starDummy.rotation.set(0, 0, 0);
        starDummy.updateMatrix();
        starMesh.setMatrixAt(n, starDummy.matrix);
        starMesh.setColorAt(n, starShadeColor(c.shade, starColor));
        if (!starBase || starBase.length < STAR_MAX * 3) {
          starBase = new Float32Array(STAR_MAX * 3);
          starPhase = new Float32Array(STAR_MAX);
        }
        starBase[n * 3] = starColor.r; starBase[n * 3 + 1] = starColor.g; starBase[n * 3 + 2] = starColor.b;
        starPhase[n] = rec.phase;
        n++;
      }
      if (n >= STAR_MAX) break;
      starRecs.push(rec);
    }
  }
  starMesh.count = n;
  starCubeCount = n;
  starMesh.instanceMatrix.needsUpdate = true;
  if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;
  starMesh.visible = n > 0;
  starPulseT = 0;
}
function starTick(dt, active) {
  if (!starMesh) return;
  const show = starRecs.length > 0 && dim === "over" && world === worlds.over && decorVisible;
  starMesh.visible = show;
  if (!show) return;
  if (active) starAngle += STAR_SPIN * dt;
  for (const r of starRecs) {
    const a = starAngle + r.phase;
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < starShape.length; i++) {
      const o = starShape[i];
      starDummy.position.set(r.x + o.dx * c + o.dz * s, r.y + o.dy, r.z - o.dx * s + o.dz * c);
      starDummy.rotation.set(0, 0, 0);
      starDummy.updateMatrix();
      starMesh.setMatrixAt(r.base + i, starDummy.matrix);
    }
  }
  starMesh.instanceMatrix.needsUpdate = true;
  // Glowing pulse in sync with the garlands.
  starPulseT += dt;
  if (starPulseT >= 0.15 && starBase) {
    starPulseT = 0;
    const t = performance.now() / 1000;
    for (let i = 0; i < starCubeCount; i++) {
      const k = 1 + 0.25 * Math.sin(t * 3.0 - starPhase[i] * 0.55);
      starMesh.setColorAt(i, starColor.setRGB(starBase[i * 3] * k, starBase[i * 3 + 1] * k, starBase[i * 3 + 2] * k));
    }
    if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;
  }
}
function starPlatformAt(x, z, r) {
  for (const sp of starPlatforms) {
    const dx = x - sp.x, dz = z - sp.z;
    if (dx * dx + dz * dz <= r * r) return sp;
  }
  return null;
}
function rotXZ(ox, oz, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [ox * c + oz * s, -ox * s + oz * c];
}
// A ground mob whose feet land on a star platform sticks to it and twirls
// (normal steering resumes on panic, which walks it off the rim). Held,
// chained, frozen and flying mobs never pin; endermen keep their stare blinks.
function starRideMob(m, dt) {
  if (!m || !m.pos || dim !== "over" || !starPlatforms.length || !m.vel || m.vel.y > 0.5 || m._fillSlide) {
    if (m) m.starRide = null;
    return false;
  }
  if (isFlyingKind(m.kind) || m.kind === "enderman") { m.starRide = null; return false; }
  if (m.fleeUntil && m.fleeUntil > performance.now() / 1000) { m.starRide = null; return false; }
  const sp = starPlatformAt(m.pos.x, m.pos.z, m.starRide ? STAR_PLATFORM_R + 0.25 : STAR_PLATFORM_R);
  if (!sp) { m.starRide = null; return false; }
  if (m.pos.y < sp.top - (m.starRide ? 0.5 : 3.0) || m.pos.y > sp.top + 0.6) { m.starRide = null; return false; }
  const a = STAR_SPIN * dt;
  const [rx, rz] = rotXZ(m.pos.x - sp.x, m.pos.z - sp.z, a);
  m.pos.x = sp.x + rx; m.pos.z = sp.z + rz;
  m.pos.y = sp.top; m.vel.set(0, 0, 0);
  m.onGround = true;
  if (typeof m.yaw === "number" && isFinite(m.yaw)) m.yaw += a;
  if (m.mesh) { m.mesh.rotation.y += a; m.mesh.position.copy(m.pos); }
  m.starRide = sp;
  return true;
}

// Pine garlands: glowing multicolor bulb ropes draped around villager-planted
// pines, complete by default. Each bulb maps 1:1 to a strict anchor block
// (trunk/apex as-is, rim parity-snapped so checkerboard foliage is hit);
// breaking the block removes its bulbs, and dangling orphan groups of 5 or
// fewer hide while bigger sections float. Visual only: one global InstancedMesh
// (unlit, fog-free, like glowstone), no blocks. The style is fixed: four
// counter-winding spirale strands (two clockwise, two counter-clockwise,
// crossing each other) in blue, red, green and yellow.
const GARLAND_BLUE = [0.1, 0.35, 1];
const GARLAND_RED = [1, 0.08, 0.08];
const GARLAND_GREEN = [0.05, 1, 0.25];
const GARLAND_YELLOW = [1, 0.95, 0];
const GARLAND_STEP = 0.22;
const GARLAND_MAX = 40000;
const GARLAND_PER_PINE = 15000;
const plantedPines = new Map();
// Pine cells broken by hand or blast, as "soilKey|x,y,z" (soilKey = key of the
// owning pine's soil). Bulbs anchored to one of these always hide, however many
// share the cell; session-only, never saved.
const brokenPineCells = new Set();
let garlandMesh = null;
let garlandDirty = true;
const pineUpperVis = new Map();   // soilKey -> visible upper-spiral bulbs per run
let garlandRevealUntil = 0;   // wall-clock: while now is below, rebuild every frame
// Garland + star visibility, toggled live with B (applies to every planted pine).
let decorVisible = true;
let garlandBulbCount = 0;
const garlandMatrix = new THREE.Matrix4();
const garlandColor = new THREE.Color();
function ensureGarlandMesh() {
  if (garlandMesh) return;
  garlandMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }), GARLAND_MAX);
  garlandMesh.frustumCulled = false;
  garlandMesh.visible = false;
  garlandMesh.count = 0;
  scene.add(garlandMesh);
}
function garlandRadiusAt(p, Y) {
  const summit = pineSummit(p.y, p.m, p.e);
  const ws = pineLayerWidths(p.m);
  const f = summit - 1 - Y;   // foliage layers hang off summit - 1 (tip sits above)
  if (f >= 1 && f < ws.length) {
    const l0 = Math.min(Math.floor(f), ws.length - 2);
    const t = Math.max(0, Math.min(1, f - l0));
    // Helix floats ~0.6 off the foliage so it reads clearly; strict touches
    // only happen at edge/corner grazes, keeping chunks long and visible.
    return ((ws[l0] - 1) / 2) * (1 - t) + ((ws[l0 + 1] - 1) / 2) * t + 0.6;
  }
  return 1.2;
}
function garlandAnchor(p, bx, by, bz) {
  const summit = pineSummit(p.y, p.m, p.e);
  if (by > summit + 0.5) return [p.x, summit, p.z];
  const trunkTop = p.y + p.e;
  if (by <= trunkTop + 0.5) return [p.x, Math.floor(by), p.z];
  const dx = bx - (p.x + 0.5), dz = bz - (p.z + 0.5);
  const d = Math.hypot(dx, dz) || 1;
  const r = garlandRadiusAt(p, by) - 0.4;
  return [Math.floor(p.x + 0.5 + dx / d * r), Math.floor(by), Math.floor(p.z + 0.5 + dz / d * r)];
}
// Strict anchor: a pure function of the pine geometry, never of live world
// state, so a broken anchor stays broken (no re-gluing). Trunk/apex cells are
// used as-is; rim anchors snap one cell toward the trunk when their parity
// (ax+az)&1 mismatches the foliage parity of the layer ((p.x+p.z+l)&1,
// l = summit-1-ay) — parity-matched cells are placed leaves, so garlands are
// born complete and break 1:1 with their blocks.
function garlandAnchorStrict(p, bx, by, bz) {
  const [ax, ay, az] = garlandAnchor(p, bx, by, bz);
  if (ax === p.x && az === p.z) return [ax, ay, az];   // trunk/apex column: solid
  const summit = pineSummit(p.y, p.m, p.e);
  const l = summit - 1 - ay;   // foliage layers hang off summit - 1 (tip sits above)
  const par = (v) => ((v % 2) + 2) % 2;
  if (par(ax + az) !== par(p.x + p.z + l)) {
    const dx = bx - (p.x + 0.5), dz = bz - (p.z + 0.5);
    if (Math.abs(dx) >= Math.abs(dz)) return [ax + (dx >= 0 ? -1 : 1), ay, az];
    return [ax, ay, az + (dz >= 0 ? -1 : 1)];
  }
  return [ax, ay, az];
}
function garlandPathFor(p) {
  const pts = [];
  const summit = pineSummit(p.y, p.m, p.e);
  const yBase = p.y + p.e + 1;
  const a0 = p.seed / 255 * Math.PI * 2;
  const push = (bx, by, bz, rgb, ph, run) => {
    if (pts.length >= GARLAND_PER_PINE) return;
    const [ax, ay, az] = garlandAnchorStrict(p, bx, by, bz);
    pts.push({ x: bx, y: by, z: bz, ax, ay, az, r: rgb[0], g: rgb[1], b: rgb[2], ph, run });
  };
  const k = Math.PI * 2 / 3, phi = Math.PI / 4;
  const strands = [
    { dir: 1, off: 0, rgb: GARLAND_BLUE, ph0: 0 },
    { dir: 1, off: Math.PI, rgb: GARLAND_RED, ph0: 2.4 },
    { dir: -1, off: phi, rgb: GARLAND_GREEN, ph0: 4.8 },
    { dir: -1, off: phi + Math.PI, rgb: GARLAND_YELLOW, ph0: 7.2 },
  ];
  const at = (s, Y) => {
    const a = a0 + s.off + s.dir * Y * k;
    const r = garlandRadiusAt(p, Y);
    return [p.x + 0.5 + Math.cos(a) * r, Y + 0.15, p.z + 0.5 + Math.sin(a) * r];
  };
  // Strand starts tuck into the bottom foliage: march inward from the floating
  // start until strictly inside a live LEAVES block, pushing bulbs every 0.22
  // of arc (deepest first). Falls back to the floating start when the bottom
  // offers no containment (holes, stripped crown).
  const tuckStart = (s) => {
    const p0 = at(s, yBase);
    const dx = (p.x + 0.5) - p0[0], dz = (p.z + 0.5) - p0[2];
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    const inside = (x, y, z) => {
      const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        if (getBlock(cx + ox, cy + oy, cz + oz) !== LEAVES) continue;
        if (Math.abs(x - (cx + ox + 0.5)) <= GARLAND_TOUCH_D &&
          Math.abs(y - (cy + oy + 0.5)) <= GARLAND_TOUCH_D &&
          Math.abs(z - (cz + oz + 0.5)) <= GARLAND_TOUCH_D) return true;
      }
      return false;
    };
    let found = -1;
    for (let step = 1; step <= 18; step++) {
      const dd = step * 0.11;
      if (inside(p0[0] + ux * dd, p0[1], p0[2] + uz * dd)) { found = dd; break; }
    }
    if (found < 0) return [];
    const out = [];
    for (let dd = found; dd > 0.05; dd -= 0.22) out.push([p0[0] + ux * dd, p0[1], p0[2] + uz * dd]);
    return out;
  };
  const SPIRE_H = 4.0, SPIRE_TURNS = 2;
  const Y0 = summit + 0.2;
  const r0 = garlandRadiusAt(p, Y0);
  for (let si = 0; si < strands.length; si++) {
    const s = strands[si];
    for (const q of tuckStart(s)) push(q[0], q[1], q[2], s.rgb, s.ph0, si);
    let prev = at(s, yBase);
    let arc = 0, next = GARLAND_STEP;
    push(prev[0], prev[1], prev[2], s.rgb, s.ph0, si);
    for (let Y = yBase + 0.1; Y <= summit + 0.2; Y += 0.1) {
      const cur = at(s, Y);
      const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
      if (d > 1e-9) {
        while (next <= arc + d) {
          const f = (next - arc) / d;
          push(prev[0] + (cur[0] - prev[0]) * f, prev[1] + (cur[1] - prev[1]) * f, prev[2] + (cur[2] - prev[2]) * f, s.rgb, s.ph0 + next * 0.9, si);
          next += GARLAND_STEP;
        }
        arc += d;
      }
      prev = cur;
      if (pts.length >= GARLAND_PER_PINE) break;
    }
    const aStart = a0 + s.off + s.dir * Y0 * k;
    const tw = s.dir * SPIRE_TURNS * Math.PI * 2 / SPIRE_H;
    for (let h = 0.1; h <= SPIRE_H + 1e-6; h += 0.1) {
      const a = aStart + tw * h;
      const r = r0 + (0.2 - r0) * (h / SPIRE_H);
      const cur = [p.x + 0.5 + Math.cos(a) * r, Y0 + 0.15 + h, p.z + 0.5 + Math.sin(a) * r];
      const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
      if (d > 1e-9) {
        while (next <= arc + d) {
          const f = (next - arc) / d;
          push(prev[0] + (cur[0] - prev[0]) * f, prev[1] + (cur[1] - prev[1]) * f, prev[2] + (cur[2] - prev[2]) * f, s.rgb, s.ph0 + next * 0.9, si);
          next += GARLAND_STEP;
        }
        arc += d;
      }
      prev = cur;
      if (pts.length >= GARLAND_PER_PINE) break;
    }
    if (pts.length >= GARLAND_PER_PINE) break;
  }
  return pts;
}
function registerPlantedPine(x, y, z, m, e) {
  const k = key(x, y, z);
  const nowS = performance.now() / 1000;
  plantedPines.set(k, { x, y, z, m, e, seed: Math.floor(hash2(x, z, seed + 4242) * 255), bornAt: nowS });
  garlandDirty = true;
  garlandRevealUntil = nowS + 1.15;
}
// Trim set: strict intersection (a 0.14 bulb fully inside a live LEAVES block,
// i.e. per-axis centre distance <= 0.43) defines touch; strictly-contained
// bulbs are chunk extremities. Removing a touched block drops every bulb
// strictly inside it plus the non-contained bulbs to the left and right, up
// to (excluding) the next strictly-contained bulb, dropping at once.
// Removing an untouched block has no effect at all: no span matches it and
// its anchored floating bulbs are left floating. Other dangling bulbs (cells the growth
// skipped) group by anchor-cell adjacency and hide only in groups of 5 or
// fewer, bigger sections float.
const GARLAND_TOUCH_D = 0.43;   // strict box containment per axis
function garlandTrimSet(p, pts, skipFloat) {
  const soil = key(p.x, p.y, p.z) + "|";
  const nowS = performance.now() / 1000;
  for (const bk of [...brokenPineCells]) {
    if (!bk.startsWith(soil)) continue;
    const [cx, cy, cz] = bk.slice(soil.length).split(",").map(Number);
    if (getBlock(cx, cy, cz) !== AIR) brokenPineCells.delete(bk);
  }
  const leaves = [];
  const brokenLive = new Set();
  for (const bk of brokenPineCells) {
    if (bk.startsWith(soil)) brokenLive.add(bk.slice(soil.length));
  }
  for (const c of pineCellsFor(p.x, p.y, p.z, p.m, p.e)) {
    if (c.id !== LEAVES) continue;
    const k = c.x + "," + c.y + "," + c.z;
    // Broken cells are AIR by now but still count as touch candidates, so
    // spans keyed on the removed block actually match.
    if (getBlock(c.x, c.y, c.z) === LEAVES || brokenLive.has(k)) leaves.push(c);
  }
  // Strict touch per bulb: first live leaf fully containing it, else null.
  const touch = new Array(pts.length).fill(null);
  for (let i = 0; i < pts.length; i++) {
    const b = pts[i];
    for (const c of leaves) {
      if (Math.abs(b.x - (c.x + 0.5)) <= GARLAND_TOUCH_D &&
        Math.abs(b.y - (c.y + 0.5)) <= GARLAND_TOUCH_D &&
        Math.abs(b.z - (c.z + 0.5)) <= GARLAND_TOUCH_D) {
        touch[i] = c.x + "," + c.y + "," + c.z;
        break;
      }
    }
  }
  const hide = new Set();
  const byAnchor = new Map();
  const tipSourced = new Set();
  const summit = pineSummit(p.y, p.m, p.e);
  const tipKeys = new Set();
  for (const bk of brokenPineCells) {
    if (!bk.startsWith(soil)) continue;
    const [bx, by, bz] = bk.slice(soil.length).split(",").map(Number);
    if (bx === p.x && bz === p.z && by >= summit - 1) tipKeys.add(bx + "," + by + "," + bz);
  }
  const anchorKeyOf = (b) => b.ax + "," + b.ay + "," + b.az;
  // Anchor grouping only governs floating bulbs (touch null) whose anchor cell
  // was never solid (growth gaps): a strictly-contained bulb lives and dies
  // with its containing block through the atomic span rule below, and a
  // floating bulb anchored to a broken cell is left to the span/closure — so
  // breaking a block it merely floats past or projects onto (trunk, summit,
  // centre column under the summit) never notches a chunk owned by another
  // block. Breaking an untouched block hence has no garland effect at all.
  // The top spire tail of each run (y above summit + 0.2) is inseverable: its
  // bulbs never enter this loop, so breaking the shared apex cannot wipe all
  // four spires at once. Each tail drops only through the atomic span rule
  // below keyed on its own last-touched block.
  for (let i = 0; i < pts.length; i++) {
    const b = pts[i];
    if (b.y > summit + 0.2) continue;
    if (touch[i] !== null) continue;
    if (getBlock(b.ax, b.ay, b.az) !== AIR) continue;
    const k = anchorKeyOf(b);
    if (brokenPineCells.has(soil + k)) continue;
    if (!byAnchor.has(k)) byAnchor.set(k, []);
    byAnchor.get(k).push(i);
  }
  // Compress each run into consecutive same-touch segments; a broken touched
  // block drops every bulb strictly inside it plus the non-contained bulbs to
  // the left and right, up to (excluding) the next strictly-contained bulb —
  // its two incident chunks, dropping at once. Masks sourced from tip/apex
  // breaks are tracked separately: the closure flood below never starts from
  // them, so summit breaks can't strip the upper spirals.
  const brokenKeys = new Set();
  for (const bk of brokenPineCells) {
    if (bk.startsWith(soil)) brokenKeys.add(bk.slice(soil.length));
  }
  if (brokenKeys.size) {
    let runStart = 0;
    const flushRun = (s, e) => {
      if (s > e || !pts.length) return;
      const segs = [];
      let cs = s, ck = touch[s];
      for (let i = s + 1; i <= e; i++) {
        if (touch[i] !== ck) { segs.push({ k: ck, s: cs, e: i - 1 }); cs = i; ck = touch[i]; }
      }
      segs.push({ k: ck, s: cs, e });
      for (let gi = 0; gi < segs.length; gi++) {
        const Bkey = segs[gi].k;
        if (Bkey === null || Bkey === undefined || !brokenKeys.has(Bkey)) continue;
        let lo = segs[gi].s, hi = segs[gi].e;
        while (lo - 1 >= s) {
          const tk = touch[lo - 1];
          if (tk !== null && tk !== Bkey) break;
          lo--;
        }
        while (hi + 1 <= e) {
          const tk = touch[hi + 1];
          if (tk !== null && tk !== Bkey) break;
          hi++;
        }
        for (let i = lo; i <= hi; i++) {
          hide.add(i);
          if (tipKeys.has(Bkey)) tipSourced.add(i);
        }
      }
    };
    for (let i = 1; i <= pts.length; i++) {
      if (i === pts.length || pts[i].run !== pts[runStart].run) {
        flushRun(runStart, i - 1);
        runStart = i;
      }
    }
  }
  // Closure: no removed bulb may border a surviving non-intersecting neighbour
  // on its run — sweep both directions, hiding null-touch bulbs next to hidden
  // ones. Strict bulbs are never added, so they stop the flood as extremities.
  // Never seeded from summit breaks (tipSourced): the summit is blind to the
  // closure, so its removal can't strip the upper spirals.
  // The top spire tail (y above summit + 0.2) is excluded both ways: its nulls
  // never hide via the flood, and a hidden tail never seeds it back into the
  // helix. Each tail is the terminal chunk of its run — from its last
  // strictly-contained bulb up to the very top — and drops only atomically
  // when its own anchor block breaks (span rule above), like any other chunk.
  // Runs BEFORE the float rule on purpose: float kills are growth-gap
  // cosmetics (<=5 bulbs) and must not seed floods; spans and directs
  // (break-caused) do. Covers break removals transitively, in O(n).
  if (hide.size && pts.length) {
    let vs = 0;
    const isSpire = (idx) => pts[idx].y > summit + 0.2;
    const flushClose = (s, e) => {
      for (let i = s + 1; i <= e; i++) {
        if (!hide.has(i) && touch[i] === null && !isSpire(i) && !isSpire(i - 1) && hide.has(i - 1) && !tipSourced.has(i - 1)) hide.add(i);
      }
      for (let i = e - 1; i >= s; i--) {
        if (!hide.has(i) && touch[i] === null && !isSpire(i) && !isSpire(i + 1) && hide.has(i + 1) && !tipSourced.has(i + 1)) hide.add(i);
      }
    };
    for (let i = 1; i <= pts.length; i++) {
      if (i === pts.length || pts[i].run !== pts[vs].run) { flushClose(vs, i - 1); vs = i; }
    }
  }
  if (byAnchor.size && !skipFloat) {
  const keyOf = (x, y, z) => x + "," + y + "," + z;
  const visited = new Set();
  for (const [ak] of byAnchor) {
    if (visited.has(ak)) continue;
    const [ax, ay, az] = ak.split(",").map(Number);
    const comp = [];
    const stack = [[ax, ay, az]];
    visited.add(ak);
    while (stack.length) {
      const [cx, cy, cz] = stack.pop();
      const members = byAnchor.get(keyOf(cx, cy, cz));
      if (members) for (const i of members) comp.push(i);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const nk = keyOf(cx + dx, cy + dy, cz + dz);
        if (!visited.has(nk) && byAnchor.has(nk)) { visited.add(nk); stack.push([cx + dx, cy + dy, cz + dz]); }
      }
    }
    if (comp.length && comp.length <= 5) for (const i of comp) hide.add(i);
  }
  }
  return hide.size ? hide : null;
}
function rebuildGarlands() {
  garlandDirty = false;
  ensureGarlandMesh();
  garlandBulbCount = 0;
  if (dim !== "over" || world !== worlds.over || !plantedPines.size || !decorVisible) {
    garlandMesh.count = 0;
    garlandMesh.visible = false;
    return;
  }
  let n = 0;
  pineUpperVis.clear();
  // Flicker guard: skip any bulb within a bulb-size of an accepted one, so
  // intersecting bulbs never z-fight. Grid hash keeps it O(n); the mesh is
  // fully rebuilt each time, so the result stays deterministic.
  const keptGrid = new Map();
  const put = (x, y, z, r, g, b) => {
    if (n >= GARLAND_MAX) return;
    const cx = Math.floor(x / 0.5), cy = Math.floor(y / 0.5), cz = Math.floor(z / 0.5);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = keptGrid.get((cx + dx) + "," + (cy + dy) + "," + (cz + dz));
      if (cell) for (const q of cell) {
        const ddx = q[0] - x, ddy = q[1] - y, ddz = q[2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz < 0.13 * 0.13) return;
      }
    }
    const k = cx + "," + cy + "," + cz;
    if (!keptGrid.has(k)) keptGrid.set(k, []);
    keptGrid.get(k).push([x, y, z]);
    garlandMatrix.setPosition(x, y, z);
    garlandMesh.setMatrixAt(n, garlandMatrix);
    garlandMesh.setColorAt(n, garlandColor.setRGB(r, g, b));
    n++;
  };
  for (const p of plantedPines.values()) {
    // Garlands dress moon pines only: ground pines grow bare.
    if (!moonZoneGeo(p.x, p.y, p.z)) { pineUpperVis.set(key(p.x, p.y, p.z), [0, 0, 0, 0]); continue; }
    const pts = garlandPathFor(p);
    const hide = garlandTrimSet(p, pts);
    // Birth reveal: garlands wrap bottom-up over 1 s after the foliage lands.
    const nowS = performance.now() / 1000;
    const rt = (nowS - (p.bornAt || -1e9)) / 1;
    const summitP = pineSummit(p.y, p.m, p.e);
    const revealY = rt >= 1 ? Infinity : (p.y + p.e + 1) + (summitP + 4.5 - (p.y + p.e + 1)) * Math.max(0, rt);
    // Upper spiral presence per run (visible bulbs in the top spire tail above
    // summit + 0.2, the 4 terminal chunks): the star stays while at least one
    // is visible and drops only once all 4 are broken.
    pineUpperVis.set(key(p.x, p.y, p.z), countUpperVisible(p, pts, hide));
    for (let i = 0; i < pts.length; i++) {
      if (n >= GARLAND_MAX) break;
      if (hide && hide.has(i)) continue;
      if (pts[i].y > revealY) continue;
      const b = pts[i];
      put(b.x, b.y, b.z, b.r, b.g, b.b);
    }
    if (n >= GARLAND_MAX) break;
  }
  garlandBulbCount = n;
  garlandMesh.count = n;
  garlandMesh.instanceMatrix.needsUpdate = true;
  if (garlandMesh.instanceColor) garlandMesh.instanceColor.needsUpdate = true;
  garlandMesh.visible = n > 0;
}
function garlandTick(dt) {
  if (!garlandMesh) return;
  garlandMesh.visible = garlandBulbCount > 0 && dim === "over" && world === worlds.over && decorVisible;
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
let wetDirtMatsCache = null;
function getWetDirtMats() {
  if (!wetDirtMatsCache) wetDirtMatsCache = faceTex(TEX.dirtWet);
  return wetDirtMatsCache;
}
let wetShellMat = null, wetShellMatMoon = null, wetShellGeo = null;
function getWetShellMat() {
  if (!wetShellMat) wetShellMat = new THREE.MeshBasicMaterial({ color: 0x2a5fd0, transparent: true, opacity: 0.22, depthWrite: false });
  return wetShellMat;
}
function getWetShellMatMoon() {
  if (!wetShellMatMoon) wetShellMatMoon = new THREE.MeshBasicMaterial({ color: 0xeef1f4, transparent: true, opacity: 0.22, depthWrite: false });
  return wetShellMatMoon;
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
  const wetDirts = [];
  const liquidSkip = [];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const ct = colTops[dim][colTopIdx(x, z)];
      if (ct === 0 && getBlock(x, 0, z) === AIR) continue;
      const yRanges = dim !== "over" ? [[0, ct]] : (() => {
        const rs = [[0, Math.min(ct, 120)]];
        if (ct > 120) rs.push([121, Math.min(ct, MOON_BOTTOM - 1)]);
        if (ct >= MOON_BOTTOM) rs.push([MOON_BOTTOM, ct]);
        return rs;
      })();
      for (const [y0r, y1r] of yRanges) for (let y = y0r; y <= y1r; y++) {
        const id = getBlock(x, y, z);
        if (id === AIR || !BLOCK_INFO[id]) continue;
        if (id === FLOWER) { flowers.push([x, y, z]); continue; }
        if (id === GLOWSTONE) {
          if (isExposed(x, y, z)) glows.push([x, y, z]);
          continue;
        }
        if (id === DIRT && wetSoilSet.has(key(x, y, z))) {
          if (isExposed(x, y, z)) wetDirts.push([x, y, z]);
          continue;
        }
        if (isLiquid(id)) { liquidSkip.push([x, y, z, id]); continue; }
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
  if (liquidSkip.length) {
    const liquidFaces = { px: [], nx: [], py: [], ny: [], pz: [], nz: [] };
    const faceDirs = [["px",1,0,0],["nx",-1,0,0],["py",0,1,0],["ny",0,-1,0],["pz",0,0,1],["nz",0,0,-1]];
    for (const [lx, ly, lz, lid] of liquidSkip) {
      for (const [d, dx, dy, dz] of faceDirs)
        if (liquidFaceVisible(lx, ly, lz, lid, dx, dy, dz))
          liquidFaces[d].push([lx, ly, lz, lid]);
    }
    const placeLiquid = (geo, mat, list, key) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.count = list.length;
      for (let i = 0; i < list.length; i++) {
        const [lx, ly, lz] = list[i];
        dummy.position.set(lx + 0.5, ly + 0.5, lz + 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      meshes.set(key, mesh);
    };
    for (const d of ["px", "nx", "ny", "pz", "nz"]) {
      const perId = {};
      for (const [, , , lid] of liquidFaces[d]) perId[lid] = (perId[lid] || 0) + 1;
      for (const idStr in perId) {
        const lid = +idStr;
        const list = liquidFaces[d].filter((f) => f[3] === lid);
        placeLiquid(liquidFaceGeos[d], liquidBodyMat(lid), list, "liquid_" + lid + "_" + d);
      }
    }
    const topPerIdBucket = {};
    for (const [lx, ly, lz, lid] of liquidFaces.py) {
      const bucket = Math.max(0, Math.min(3, liquidColumnDepth(lx, ly, lz, lid) - 1));
      topPerIdBucket[lid] = topPerIdBucket[lid] || [[], [], [], []];
      topPerIdBucket[lid][bucket].push([lx, ly, lz]);
    }
    for (const idStr in topPerIdBucket) {
      const lid = +idStr;
      for (let b = 0; b < 4; b++) {
        const list = topPerIdBucket[lid][b];
        if (!list.length) continue;
        placeLiquid(liquidFaceGeos.py, liquidBucketMat(lid, b), list, "liquid_" + lid + "_top_" + b);
        placeLiquid(liquidFaceGeos.py, liquidBucketMatIn(lid, b), list, "liquid_" + lid + "_topin_" + b);
      }
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
  if (wetDirts.length) {
    const cube = new THREE.InstancedMesh(boxGeo, getWetDirtMats(), wetDirts.length);
    cube.count = wetDirts.length;
    let i = 0;
    for (const [wx, wy, wz] of wetDirts) {
      dummy.position.set(wx + 0.5, wy + 0.5, wz + 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      cube.setMatrixAt(i++, dummy.matrix);
    }
    cube.instanceMatrix.needsUpdate = true;
    cube.computeBoundingSphere();
    scene.add(cube);
    meshes.set("wetdirt", cube);
    if (!wetShellGeo) wetShellGeo = new THREE.BoxGeometry(1.06, 1.06, 1.06);
    const wetBlue = [], wetGrey = [];
    for (const [wx, wy, wz] of wetDirts) {
      const sg = growableSoils.get(key(wx, wy, wz));
      if (sg && sg.liq === MOON_WATER) wetGrey.push([wx, wy, wz]);
      else wetBlue.push([wx, wy, wz]);
    }
    const placeShell = (list, mat, meshKey) => {
      const shell = new THREE.InstancedMesh(wetShellGeo, mat, list.length);
      shell.count = list.length;
      let j = 0;
      for (const [wx, wy, wz] of list) {
        dummy.position.set(wx + 0.5, wy + 0.5, wz + 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        shell.setMatrixAt(j++, dummy.matrix);
      }
      shell.instanceMatrix.needsUpdate = true;
      shell.computeBoundingSphere();
      scene.add(shell);
      meshes.set(meshKey, shell);
    };
    if (wetBlue.length) placeShell(wetBlue, getWetShellMat(), "wetshell");
    if (wetGrey.length) placeShell(wetGrey, getWetShellMatMoon(), "wetshellMoon");
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
  if (dim === "over") {
    const minC = Math.floor(-WORLD_RADIUS / CHUNK), maxC = Math.floor(WORLD_RADIUS / CHUNK);
    for (let wx = minC; wx <= maxC; wx++) for (let wz = minC; wz <= maxC; wz++) {
      if (wx * CHUNK > WORLD_RADIUS || wx * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      if (wz * CHUNK > WORLD_RADIUS || wz * CHUNK + CHUNK - 1 < -WORLD_RADIUS) continue;
      const x0 = wx * CHUNK, x1 = x0 + CHUNK - 1, z0 = wz * CHUNK, z1 = z0 + CHUNK - 1;
      const cx0 = x0 <= 0 && 0 <= x1 ? 0 : (x0 > 0 ? x0 : x1);
      const cz0 = z0 <= 0 && 0 <= z1 ? 0 : (z0 > 0 ? z0 : z1);
      if (cx0 * cx0 + cz0 * cz0 > MOON_R * MOON_R) continue;
      keep.add(wx + "_" + wz);
    }
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
let refreshDefer = null;
function refreshBlocks(coords) {
  if (refreshDefer) { for (const c of coords) refreshDefer.push(c); return; }
  if (placeBatch) { for (const c of coords) placeBatch.push(c); return; }
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

let moonLakesVisible = false;
let moonLakesRebuildQueue = [];
let moonLakesChunkSet = new Set();
function isExposed(x, y, z) {
  const id = getBlock(x, y, z);
  const info = BLOCK_INFO[id];
  if (!info) return false;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const [dx, dy, dz] of dirs) {
    const n = getBlock(x + dx, y + dy, z + dz);
    if ((id === MOON && n === MOON_WATER) || (id === MOON_WATER && n === MOON)) {
      if (!moonLakesVisible) continue;
    }
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
const GRAVITY = 37.44;
const WALK = 4.4, SPRINT = 7.2, FLY = 10;
const JUMP_MIN = 8.2;
const JUMP_HOLD_TIME = 0.7;
const JUMP_THRUST = 45;
const JUMP_RAMP = 0.25;
const JUMP_BOOST_ACCEL = 40;
const JUMP_BOOST_TIME = 0.15;
const JUMP_BUFFER = 0.2;
const JUMP_FLING_DAMP = 6;
const AIR_SPRINT = 1.35;
const AIR_STEER = 2.5;
const STEP_SPEED = 9.5;
const STEP_UP = 12;
const STEP_UP_EASE = 0.03;
const STEP_UP_MIN = 4;
const AUTO_JUMP = 8.2;
const GRAPPLE_SPEED = 26;
const GRAPPLE_THROW = 70;
const GRAPPLE_RETRACT = 275;
const GRAPPLE_FLING = 34;
const BIRD_FOLLOW_DIST = 2.5;
const DRAGON_FOLLOW_DIST = 8;
const MOB_GRAPPLE_THROW = GRAPPLE_THROW * 1.25;
const MOB_GRAPPLE_RETRACT = MOB_GRAPPLE_THROW * 1.25;
const FLOAT_SPEED = 3.6;
const SWIM_ACCEL = 8;
const SWIM_AREA = 10;
const SWIM_BRAKE = 2.0;
const SWIM_MAX = 64;
// Deep-water fast-descent brake (player only): below this sink speed water
// drag eases vel.y back toward it, so a kept inertia visibly slows before
// buoyancy reverses it. Normal swim speeds never reach it.
const SWIM_SOFT_CAP = 4;

const pos = new THREE.Vector3(0, 20, 0);
let grappleActive = false;
let grappleHooked = false;
let grappleFly = 0;
let grapplingDist = 1;
const grappleTarget = new THREE.Vector3();
const grappleStart = new THREE.Vector3();
let grappleBlock = null;
let grappleFill = null;
let grappleMob = null;
const grappleMobOffset = new THREE.Vector3();
let grappleArrived = false;
let grapplePulling = false;
let grapplePass = true;
let grappleTopY = 0;
let grappleRetracting = false;
const grappleHookPos = new THREE.Vector3();
const grappleTowDir = new THREE.Vector3(0, 0, 1);
const grappleTowPos = new THREE.Vector3();
let grappleTowInit = false;
const grappleTowTmp = new THREE.Vector3();
const grappleRideAx = new THREE.Vector3(0, 0, 1);
const grappleRideAxP = new THREE.Vector3(0, 0, 1);
const grappleRideAxV = new THREE.Vector3();
let grapplePendingInsert = null;
let flingActive = false;
const LIQUID_INERTIA_TIME = 0.7;
let liquidInertiaT = 0;
const LIQUID_BRAKE_TIME = 0.65;
let liquidBrakeT = 0;
const liquidBrakeV = new THREE.Vector3();
const vel = new THREE.Vector3();
const camPos = new THREE.Vector3();
let yaw = 0, pitch = 0;
let onGround = false, flying = false, freeCam = false, locked = false;
let starRide = null;   // star platform {x, top, z} the player currently twirls on
let stepDown = false, wasOnGround = false;
let stepUp = false, stepUpClearY = 0;
let stepFromWater = false, stepHop = false;
let wasInWater = false;
let airT = 0;
let jumpBoost = 1;
let jumpCount = 0;
let jumpIdle = 0;
let jumpBuffer = 0;
let jumpOriginY = null;
let jumpPeakY = null;
let jumpHoldContinuous = false;
let lastSpaceDownY = null;
let prevSpace = false;
let waterDipActive = false;
let waterDipTimer = 0;
let waterDipTarget = null;
const keys = {};

function spawnPlayer() {
  for (let y = MAX_Y; y >= 0; y--) {
    const b = getBlock(0, y, 0);
    if (b === CLOUD || b === MOON) continue;
    if (isSolid(0, y, 0)) {
      pos.set(0.5, y + 1.01, 0.5);
      break;
    }
  }
  vel.set(0, 0, 0);
  flingActive = false;
  stepDown = false;
  grappleRetracting = false;
}

function isSolid(x, y, z) {
  const info = BLOCK_INFO[getBlock(x, y, z)];
  return !!info && info.solid;
}

// Generic AABB vs world, same as player but parameterized
function aabbCollidesWorld(px, py, pz, hw, h) {
  const y0 = Math.floor(py + 0.001);
  const y1 = Math.floor(py + h - 0.001);
  for (let by = y0; by <= y1; by++)
    for (let bx = Math.floor(px - hw + 0.001); bx <= Math.floor(px + hw - 0.001); bx++)
      for (let bz = Math.floor(pz - hw + 0.001); bz <= Math.floor(pz + hw - 0.001); bz++)
        if (isSolid(bx, by, bz)) return true;
  return false;
}
function aabbOverlaps(ax, ay, az, ahw, ah, bx, by, bz, bhw, bh) {
  return ax + ahw > bx - bhw && ax - ahw < bx + bhw &&
         az + ahw > bz - bhw && az - ahw < bz + bhw &&
         ay + ah > by && ay < by + bh;
}

// Mob physics: same gravity/collision as player but no tryStep (no stepping)
function moveMobAxisX(mob, dx) {
  const oldX = mob.pos.x;
  mob.pos.x += dx;
  if (dx === 0) return false;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? mob.pos.x + mob.hw : mob.pos.x - mob.hw;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(mob.pos.y + mob.h); by >= Math.floor(mob.pos.y); by--)
    for (let bz = Math.floor(mob.pos.z - mob.hw); bz <= Math.floor(mob.pos.z + mob.hw); bz++) {
      if (!isSolid(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) {
        if (tryMobWaterStep(mob, cellX, by, bz)) return false;
        const canStep = mob.canStep && !aabbCollidesWorld(mob.pos.x, mob.pos.y+1, mob.pos.z, mob.hw, mob.h) && mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y+1);
        if (canStep) {
          mob.pos.y += 1;
          mob.onGround = true;
          return false;
        }
        mob.pos.x = cellX - mob.hw - 0.001; mob.vel.x = 0; if (mobStats) mobStats.worldCol++; return true;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        if (tryMobWaterStep(mob, cellX, by, bz)) return false;
        const canStep = mob.canStep && !aabbCollidesWorld(mob.pos.x, mob.pos.y+1, mob.pos.z, mob.hw, mob.h) && mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y+1);
        if (canStep) {
          mob.pos.y += 1;
          mob.onGround = true;
          return false;
        }
        mob.pos.x = cellX + 1 + mob.hw + 0.001; mob.vel.x = 0; if (mobStats) mobStats.worldCol++; return true;
      }
    }
  if(isPigCow(mob) && pigOverlapsFence(mob.pos.x, mob.pos.z, mob.hw)){
    mob.pos.x = oldX; mob.vel.x = 0; if(mobStats) mobStats.worldCol++; return true;
  }
  if (mobWouldCollide(mob, mob.pos.x, mob.pos.z)) {
    const wouldOld = mobWouldCollide(mob, oldX, mob.pos.z);
    let block = !wouldOld;
    if (wouldOld) {
      const nearby = nearbyMobsFor(mob.pos.x, mob.pos.z, 1);
      for (const o of nearby) {
        if (o === mob || isMobHeld(o) || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && mobBondedPair(mob, o)) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
        }
        if (Math.abs(mob.pos.y - o.pos.y) > 1.2) continue;
        const dNew = Math.hypot(mob.pos.x - o.pos.x, mob.pos.z - o.pos.z);
        const dOld = Math.hypot(oldX - o.pos.x, mob.pos.z - o.pos.z);
        if (dNew < need && dNew < dOld - 0.001) { block = true; break; }
        if (dNew < need && !wouldOld) { block = true; break; }
      }
      if (!block) {
        // moving away - allow
      } else {
        mob.pos.x = oldX; mob.vel.x = 0; if (mobStats) mobStats.mobCol++; return true;
      }
    } else {
      mob.pos.x = oldX; mob.vel.x = 0; if (mobStats) mobStats.mobCol++; return true;
    }
  }
  if (mob.onGround && !mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y)) {
    if (mob.canStep && mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y-1) && !aabbCollidesWorld(mob.pos.x, mob.pos.y-1, mob.pos.z, mob.hw, mob.h)) {
      mob.pos.y -= 1;
      return false;
    }
    mob.pos.x -= dx; mob.vel.x = 0; return true;
  }
  return false;
}
function moveMobAxisZ(mob, dz) {
  const oldZ = mob.pos.z;
  mob.pos.z += dz;
  if (dz === 0) return false;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? mob.pos.z + mob.hw : mob.pos.z - mob.hw;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(mob.pos.y + mob.h); by >= Math.floor(mob.pos.y); by--)
    for (let bx = Math.floor(mob.pos.x - mob.hw); bx <= Math.floor(mob.pos.x + mob.hw); bx++) {
      if (!isSolid(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) {
        if (tryMobWaterStep(mob, bx, by, cellZ)) return false;
        const canStep = mob.canStep && !aabbCollidesWorld(mob.pos.x, mob.pos.y+1, mob.pos.z, mob.hw, mob.h) && mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y+1);
        if (canStep) {
          mob.pos.y += 1;
          mob.onGround = true;
          return false;
        }
        mob.pos.z = cellZ - mob.hw - 0.001; mob.vel.z = 0; if (mobStats) mobStats.worldCol++; return true;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        if (tryMobWaterStep(mob, bx, by, cellZ)) return false;
        const canStep = mob.canStep && !aabbCollidesWorld(mob.pos.x, mob.pos.y+1, mob.pos.z, mob.hw, mob.h) && mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y+1);
        if (canStep) {
          mob.pos.y += 1;
          mob.onGround = true;
          return false;
        }
        mob.pos.z = cellZ + 1 + mob.hw + 0.001; mob.vel.z = 0; if (mobStats) mobStats.worldCol++; return true;
      }
    }
  if(isPigCow(mob) && pigOverlapsFence(mob.pos.x, mob.pos.z, mob.hw)){
    mob.pos.z = oldZ; mob.vel.z = 0; if(mobStats) mobStats.worldCol++; return true;
  }
  if (mobWouldCollide(mob, mob.pos.x, mob.pos.z)) {
    const wouldOld = mobWouldCollide(mob, mob.pos.x, oldZ);
    let block = !wouldOld;
    if (wouldOld) {
      const nearby = nearbyMobsFor(mob.pos.x, mob.pos.z, 1);
      for (const o of nearby) {
        if (o === mob || isMobHeld(o) || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && mobBondedPair(mob, o)) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
        }
        if (Math.abs(mob.pos.y - o.pos.y) > 1.2) continue;
        const dNew = Math.hypot(mob.pos.x - o.pos.x, mob.pos.z - o.pos.z);
        const dOld = Math.hypot(mob.pos.x - o.pos.x, oldZ - o.pos.z);
        if (dNew < need && dNew < dOld - 0.001) { block = true; break; }
        if (dNew < need && !wouldOld) { block = true; break; }
      }
      if (!block) {
      } else { mob.pos.z = oldZ; mob.vel.z = 0; if (mobStats) mobStats.mobCol++; return true; }
    } else { mob.pos.z = oldZ; mob.vel.z = 0; if (mobStats) mobStats.mobCol++; return true; }
  }
  if (mob.onGround && !mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y)) {
    if (mob.canStep && mobHasGroundFor(mob, mob.pos.x, mob.pos.z, mob.hw, mob.pos.y-1) && !aabbCollidesWorld(mob.pos.x, mob.pos.y-1, mob.pos.z, mob.hw, mob.h)) {
      mob.pos.y -= 1;
      return false;
    }
    mob.pos.z -= dz; mob.vel.z = 0; return true;
  }
  return false;
}
function moveMobAxisY(mob, dy) {
  mob.pos.y += dy;
  mob.onGround = false;
  const onRoof = isMobOnRoof(mob);
  const top = mob.pos.y + mob.h, feet = mob.pos.y;
  for (let bx = Math.floor(mob.pos.x - mob.hw + 0.001); bx <= Math.floor(mob.pos.x + mob.hw - 0.001); bx++)
    for (let bz = Math.floor(mob.pos.z - mob.hw + 0.001); bz <= Math.floor(mob.pos.z + mob.hw - 0.001); bz++) {
      if (mob.vel.y > 0 && isSolid(bx, Math.floor(top), bz) && top > Math.floor(top)) {
        if ((mob.kind === "pig" || mob.kind === "cow") && villagePen && getBlock(bx, Math.floor(top), bz) === LOG && (bx === villagePen.minX || bx === villagePen.maxX || bz === villagePen.minZ || bz === villagePen.maxZ)) continue;
        if (!onRoof && villageHouses.length && Math.floor(top) >= villageCenter.y + 1 && Math.floor(top) <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        mob.pos.y = Math.floor(top) - mob.h - 0.001; mob.vel.y = 0; return true;
      }
      if (mob.vel.y <= 0 && isSolid(bx, Math.floor(feet), bz)) {
        if ((mob.kind === "pig" || mob.kind === "cow") && villagePen && getBlock(bx, Math.floor(feet), bz) === LOG && (bx === villagePen.minX || bx === villagePen.maxX || bz === villagePen.minZ || bz === villagePen.maxZ)) continue;
        if (!onRoof && villageHouses.length && Math.floor(feet) >= villageCenter.y + 1 && Math.floor(feet) <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        mob.pos.y = Math.floor(feet) + 1 + 0.001; mob.vel.y = 0; mob.onGround = true; return true;
      }
    }
  return false;
}
function mobPhysicsStep(mob, dt, g) {
  const grav = g != null ? g : GRAVITY;
  const useGrav = mob.pos.y >= MOON_Y - MOON_R ? grav * 0.5 : grav;
  const inWater = mobInWater(mob);
  const wasInWater = mob._wasInWater || false;
  if (inWater && !wasInWater && mob.vel.y < 0) mob.vel.y *= 0.3;
  mob._wasInWater = inWater;
  mob.wolfInWater = inWater;
  if (inWater) {
    const surface = waterSurfaceForMob(mob);
    if (surface === -Infinity) {
      if (!mob.onGround) mob.vel.y -= useGrav * dt;
    } else {
      const targetY = mobFloatTargetY(surface, mob.h);
      const err = targetY - mob.pos.y;
      if (err > SWIM_AREA) mob.vel.y += SWIM_ACCEL * dt;
      else {
        const want = err * 4;
        mob.vel.y += (want - mob.vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
      }
    }
    mob.vel.y = Math.min(Math.max(mob.vel.y, -SWIM_MAX), SWIM_MAX);
  } else {
    if (!mob.onGround) mob.vel.y -= useGrav * dt;
    if (mob.vel.y < -40) mob.vel.y = -40;
  }
  moveMobAxisY(mob, mob.vel.y * dt);
  moveMobAxisX(mob, mob.vel.x * dt);
  moveMobAxisZ(mob, mob.vel.z * dt);
  if (mob.villageBound) {
    const minX = villageMinX + mob.hw + 0.5, maxX = villageMaxX - mob.hw - 0.5;
    const minZ = villageMinZ + mob.hw + 0.5, maxZ = villageMaxZ - mob.hw - 0.5;
    if (mob.pos.x < minX) { mob.pos.x = minX; mob.vel.x = 0; }
    if (mob.pos.x > maxX) { mob.pos.x = maxX; mob.vel.x = 0; }
    if (mob.pos.z < minZ) { mob.pos.z = minZ; mob.vel.z = 0; }
    if (mob.pos.z > maxZ) { mob.pos.z = maxZ; mob.vel.z = 0; }
  }
  if(isPigCow(mob) && villagePen && pigOverlapsFence(mob.pos.x, mob.pos.z, mob.hw)){
    pigFenceSlideOut(mob);
  }
}
function tryWolfStep(mob, bx, by, bz) {
  if (mobInWater(mob)) return mobWaterExitJump(mob, bx, by, bz);
  if (!mob.onGround) return false;
  if (by !== Math.floor(mob.pos.y)) return false;
  if (isSolid(bx, by + 1, bz)) return false;
  if (aabbCollidesWorld(mob.pos.x, by + 1 + 0.001, mob.pos.z, mob.hw, mob.h)) return false;
  mob.vel.y = JUMP_MIN + 2.5;
  mob.onGround = false;
  mob.wolfStepUp = false;
  return true;
}
function tryMobWaterStep(mob, bx, by, bz) {
  return mobWaterExitJump(mob, bx, by, bz);
}
function wolfMoveAxisY(mob, dy) {
  mob.pos.y += dy;
  mob.onGround = false;
  const onRoof = isMobOnRoof(mob);
  const top = mob.pos.y + mob.h, feet = mob.pos.y;
  for (let bx = Math.floor(mob.pos.x - mob.hw + 0.001); bx <= Math.floor(mob.pos.x + mob.hw - 0.001); bx++)
    for (let bz = Math.floor(mob.pos.z - mob.hw + 0.001); bz <= Math.floor(mob.pos.z + mob.hw - 0.001); bz++) {
      if (mob.vel.y > 0 && isSolid(bx, Math.floor(top), bz) && top > Math.floor(top)) {
        if (!onRoof && villageHouses.length && Math.floor(top) >= villageCenter.y + 1 && Math.floor(top) <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        mob.pos.y = Math.floor(top) - mob.h - 0.001; mob.vel.y = 0; return true;
      }
      if (mob.vel.y <= 0 && isSolid(bx, Math.floor(feet - 0.001), bz)) {
        if (!onRoof && villageHouses.length && Math.floor(feet - 0.001) >= villageCenter.y + 1 && Math.floor(feet - 0.001) <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        mob.pos.y = Math.floor(feet - 0.001) + 1 + 0.001; mob.vel.y = 0; mob.onGround = true; mob.wolfStepUp = false; return true;
      }
    }
  if (!mob.onGround && (mob.pos.y % 1) < 0.05 && wolfHasMobGround(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y) && !aabbCollidesWorld(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h)) mob.onGround = true;
  return false;
}
function wolfMoveAxisX(mob, dx) {
  const oldX = mob.pos.x;
  mob.pos.x += dx;
  if (dx === 0) return false;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? mob.pos.x + mob.hw : mob.pos.x - mob.hw;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(mob.pos.y + mob.h); by >= Math.floor(mob.pos.y); by--)
    for (let bz = Math.floor(mob.pos.z - mob.hw); bz <= Math.floor(mob.pos.z + mob.hw); bz++) {
      if (!isSolid(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) {
        if (tryWolfStep(mob, cellX, by, bz)) return false;
        mob.vel.x = 0;
        mob.pos.x = cellX - mob.hw - 0.001; return true;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        if (tryWolfStep(mob, cellX, by, bz)) return false;
        mob.vel.x = 0;
        mob.pos.x = cellX + 1 + mob.hw + 0.001; return true;
      }
    }
  if (mobWouldCollide(mob, mob.pos.x, mob.pos.z)) {
    const wouldOld = mobWouldCollide(mob, oldX, mob.pos.z);
    let block = !wouldOld;
    if (wouldOld) {
      const nearby = nearbyMobsFor(mob.pos.x, mob.pos.z, 1);
      for (const o of nearby) {
        if (o === mob || isMobHeld(o) || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && mobBondedPair(mob, o)) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
        }
        if (Math.abs(mob.pos.y - o.pos.y) > 1.2) continue;
        const dNew = Math.hypot(mob.pos.x - o.pos.x, mob.pos.z - o.pos.z);
        const dOld = Math.hypot(oldX - o.pos.x, mob.pos.z - o.pos.z);
        if (dNew < need && dNew < dOld - 0.001) { block = true; break; }
        if (dNew < need && !wouldOld) { block = true; break; }
      }
      if (!block) {} else { mob.pos.x = oldX; mob.vel.x = 0; if (mobStats) mobStats.mobCol++; return true; }
    } else { mob.pos.x = oldX; mob.vel.x = 0; if (mobStats) mobStats.mobCol++; return true; }
  }
  return false;
}
function wolfMoveAxisZ(mob, dz) {
  const oldZ = mob.pos.z;
  mob.pos.z += dz;
  if (dz === 0) return false;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? mob.pos.z + mob.hw : mob.pos.z - mob.hw;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(mob.pos.y + mob.h); by >= Math.floor(mob.pos.y); by--)
    for (let bx = Math.floor(mob.pos.x - mob.hw); bx <= Math.floor(mob.pos.x + mob.hw); bx++) {
      if (!isSolid(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) {
        if (tryWolfStep(mob, bx, by, cellZ)) return false;
        mob.vel.z = 0;
        mob.pos.z = cellZ - mob.hw - 0.001; return true;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        if (tryWolfStep(mob, bx, by, cellZ)) return false;
        mob.vel.z = 0;
        mob.pos.z = cellZ + 1 + mob.hw + 0.001; return true;
      }
    }
  if (mobWouldCollide(mob, mob.pos.x, mob.pos.z)) {
    const wouldOld = mobWouldCollide(mob, mob.pos.x, oldZ);
    let block = !wouldOld;
    if (wouldOld) {
      const nearby = nearbyMobsFor(mob.pos.x, mob.pos.z, 1);
      for (const o of nearby) {
        if (o === mob || isMobHeld(o) || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && mobBondedPair(mob, o)) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
        }
        if (Math.abs(mob.pos.y - o.pos.y) > 1.2) continue;
        const dNew = Math.hypot(mob.pos.x - o.pos.x, mob.pos.z - o.pos.z);
        const dOld = Math.hypot(mob.pos.x - o.pos.x, oldZ - o.pos.z);
        if (dNew < need && dNew < dOld - 0.001) { block = true; break; }
        if (dNew < need && !wouldOld) { block = true; break; }
      }
      if (!block) {} else { mob.pos.z = oldZ; mob.vel.z = 0; if (mobStats) mobStats.mobCol++; return true; }
    } else { mob.pos.z = oldZ; mob.vel.z = 0; if (mobStats) mobStats.mobCol++; return true; }
  }
  return false;
}
function wolfPhysicsStep(mob, dt, g) {
  const grav = g != null ? g : GRAVITY;
  const useGrav = mob.pos.y >= MOON_Y - MOON_R ? grav * 0.5 : grav;
  const inWater = mobInWater(mob);
  const wasInWater = mob._wasInWater || false;
  if (inWater && !wasInWater && mob.vel.y < 0) mob.vel.y *= 0.3;
  mob._wasInWater = inWater;
  mob.wolfInWater = inWater;
  mob.wasOnGroundWolf = wolfHasMobGround(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y) || mob.onGround;
  if (mob.wolfStepUp) {
    const glide = Math.max(STEP_UP_MIN, Math.min(STEP_UP, (mob.wolfStepUpClearY - mob.pos.y) / STEP_UP_EASE));
    mob.vel.y = glide;
    if (mob.pos.y + glide * dt >= mob.wolfStepUpClearY) {
      mob.pos.y = mob.wolfStepUpClearY;
      mob.vel.y = 0;
      mob.wolfStepUp = false;
      mob.onGround = true;
    }
  } else if (inWater) {
    const surface = waterSurfaceForMob(mob);
    if (surface === -Infinity) {
      if (!mob.onGround) mob.vel.y -= useGrav * dt;
    } else {
      const targetY = mobFloatTargetY(surface, mob.h);
      const err = targetY - mob.pos.y;
      if (err > SWIM_AREA) mob.vel.y += SWIM_ACCEL * dt;
      else {
        const want = err * 4;
        mob.vel.y += (want - mob.vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
      }
    }
    mob.vel.y = Math.min(Math.max(mob.vel.y, -SWIM_MAX), SWIM_MAX);
  } else {
    if (!mob.onGround) mob.vel.y -= useGrav * dt;
    if (mob.vel.y < -40) mob.vel.y = -40;
  }
  wolfMoveAxisY(mob, mob.vel.y * dt);
  wolfMoveAxisX(mob, mob.vel.x * dt);
  wolfMoveAxisZ(mob, mob.vel.z * dt);
  if (mob.villageBound) {
    const minX = villageMinX + mob.hw + 0.5, maxX = villageMaxX - mob.hw - 0.5;
    const minZ = villageMinZ + mob.hw + 0.5, maxZ = villageMaxZ - mob.hw - 0.5;
    if (mob.pos.x < minX) { mob.pos.x = minX; mob.vel.x = 0; }
    if (mob.pos.x > maxX) { mob.pos.x = maxX; mob.vel.x = 0; }
    if (mob.pos.z < minZ) { mob.pos.z = minZ; mob.vel.z = 0; }
    if (mob.pos.z > maxZ) { mob.pos.z = maxZ; mob.vel.z = 0; }
  }
}

function tryStep(bx, by, bz) {
  if (stepDown) return false;
  if (!stepFromWater) {
    if (!onGround) return false;
    if (by !== Math.floor(pos.y)) return false;
    if (isSolid(bx, by + 1, bz)) return false;
    stepUp = true;
    stepUpClearY = by + 1;
    vel.y = STEP_UP;
  } else {
    const fy = Math.floor(pos.y);
    if (by !== fy && by !== fy + 1) return false;
    if (isSolid(bx, by + 1, bz)) return false;
    stepUp = true;
    stepUpClearY = by + 1;
    vel.y = STEP_UP;
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
  for (let by = Math.floor(pos.y + PLAYER_H); by >= Math.floor(pos.y); by--)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (!isSolid(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) {
        if (!tryStep(cellX, by, bz)) vel.x = 0;
        pos.x = cellX - PLAYER_HW - 0.001; return;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        if (!tryStep(cellX, by, bz)) vel.x = 0;
        pos.x = cellX + 1 + PLAYER_HW + 0.001; return;
      }
    }
  const nearX = mobGrid.size ? nearbyMobsFor(pos.x, pos.z, 1) : mobs;
  for (const m of nearX) {
    if (isMobHeld(m)) continue;
    if (isMobFrozenByGrapple(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    const hw = villagerHW(m), hh = villagerH(m);
    if (pos.y + PLAYER_H <= m.pos.y || pos.y >= m.pos.y + hh) continue;
    if (pos.z + PLAYER_HW <= m.pos.z - hw || pos.z - PLAYER_HW >= m.pos.z + hw) continue;
    const mx = m.pos.x;
    if (dir > 0 && pos.x + PLAYER_HW > mx - hw && pos.x + PLAYER_HW - dx <= mx - hw) {
      const push = (pos.x + PLAYER_HW) - (mx - hw) + 0.02;
      const nx = m.pos.x + push * 0.6;
      const hg = m.canStep ? wolfHasMobGround : hasMobGround;
      if (!aabbCollidesWorld(nx, m.pos.y, m.pos.z, hw, hh) && !mobCollidesOther(m, nx, m.pos.z) && hg(nx, m.pos.z, hw, m.pos.y)) m.pos.x = nx;
      pos.x = mx - hw - PLAYER_HW - 0.002; vel.x = Math.min(vel.x, 0); if (mobStats) mobStats.playerCol++; return;
    }
    if (dir < 0 && pos.x - PLAYER_HW < mx + hw && pos.x - PLAYER_HW - dx >= mx + hw) {
      const push = (mx + hw) - (pos.x - PLAYER_HW) + 0.02;
      const nx = m.pos.x - push * 0.6;
      const hg = m.canStep ? wolfHasMobGround : hasMobGround;
      if (!aabbCollidesWorld(nx, m.pos.y, m.pos.z, hw, hh) && !mobCollidesOther(m, nx, m.pos.z) && hg(nx, m.pos.z, hw, m.pos.y)) m.pos.x = nx;
      pos.x = mx + hw + PLAYER_HW + 0.002; vel.x = Math.max(vel.x, 0); if (mobStats) mobStats.playerCol++; return;
    }
  }
}
function moveAxisZ(dz) {
  pos.z += dz;
  if (dz === 0) return;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.z + PLAYER_HW : pos.z - PLAYER_HW;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(pos.y + PLAYER_H); by >= Math.floor(pos.y); by--)
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++) {
      if (!isSolid(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) {
        if (!tryStep(bx, by, cellZ)) vel.z = 0;
        pos.z = cellZ - PLAYER_HW - 0.001; return;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        if (!tryStep(bx, by, cellZ)) vel.z = 0;
        pos.z = cellZ + 1 + PLAYER_HW + 0.001; return;
      }
    }
  const nearZ = mobGrid.size ? nearbyMobsFor(pos.x, pos.z, 1) : mobs;
  for (const m of nearZ) {
    if (isMobHeld(m)) continue;
    if (isMobFrozenByGrapple(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    const hw = villagerHW(m), hh = villagerH(m);
    if (pos.y + PLAYER_H <= m.pos.y || pos.y >= m.pos.y + hh) continue;
    if (pos.x + PLAYER_HW <= m.pos.x - hw || pos.x - PLAYER_HW >= m.pos.x + hw) continue;
    const mz = m.pos.z;
    if (dir > 0 && pos.z + PLAYER_HW > mz - hw && pos.z + PLAYER_HW - dz <= mz - hw) {
      const push = (pos.z + PLAYER_HW) - (mz - hw) + 0.02;
      const nz = m.pos.z + push * 0.6;
      const hg = m.canStep ? wolfHasMobGround : hasMobGround;
      if (!aabbCollidesWorld(m.pos.x, m.pos.y, nz, hw, hh) && !mobCollidesOther(m, m.pos.x, nz) && hg(m.pos.x, nz, hw, m.pos.y)) m.pos.z = nz;
      pos.z = mz - hw - PLAYER_HW - 0.002; vel.z = Math.min(vel.z, 0); if (mobStats) mobStats.playerCol++; return;
    }
    if (dir < 0 && pos.z - PLAYER_HW < mz + hw && pos.z - PLAYER_HW - dz >= mz + hw) {
      const push = (mz + hw) - (pos.z - PLAYER_HW) + 0.02;
      const nz = m.pos.z - push * 0.6;
      const hg = m.canStep ? wolfHasMobGround : hasMobGround;
      if (!aabbCollidesWorld(m.pos.x, m.pos.y, nz, hw, hh) && !mobCollidesOther(m, m.pos.x, nz) && hg(m.pos.x, nz, hw, m.pos.y)) m.pos.z = nz;
      pos.z = mz + hw + PLAYER_HW + 0.002; vel.z = Math.max(vel.z, 0); if (mobStats) mobStats.playerCol++; return;
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
      if (vel.y <= 0 && isSolid(bx, Math.floor(feet), bz)) { pos.y = Math.floor(feet) + 1 + 0.001; vel.y = 0; onGround = true; stepDown = false; stepUp = false; flingActive = false; return; }
    }
  if (vel.y < 0 && wasOnGround && !stepDown && !flingActive) {
    const fy = Math.floor(pos.y) - 1;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !stepDown; bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
        if (isSolid(bx, fy, bz)) { stepDown = true; break; }
  }
  if (stepDown) {
    const fy = Math.floor(pos.y) - 1;
    let supp = false;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !supp; bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
        if (isSolid(bx, fy, bz)) supp = true;
    if (!supp) stepDown = false;
  }
}
function collide() {
  moveAxisY(vel.y * dt);
  moveAxisX(vel.x * dt);
  moveAxisZ(vel.z * dt);
}

function detachDisplacementGrapple() {
  if (!grappleActive) return;
  grapplePendingInsert = null;
  grappleFill = null;
  grappleRetracting = true;
  grappleTowInit = false;
  grappleTowPos.set(0, 0, 0);
  if (grappleMob) {
    if (grappleMob.kind !== "dragon" && grappleMob !== carryMob && grappleMob !== carryGrappleMob) setMobTransparent(grappleMob, 1);
  } else if (grappleHooked) grappleHookPos.copy(grappleTarget);
  else grappleHookPos.copy(grappleStart).lerp(grappleTarget, grappleFly);
  grappleActive = false;
  grappleArrived = false;
  grapplePulling = false;
}

function fireGrapple() {
  if (freeCam) return;
  liquidInertiaT = 0;
  liquidBrakeT = 0;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const b = pickBlock(camera.position, dir, true);
  const f = pickFill(camera.position, dir);
  const eye = camera.position;
  const sx = pos.x, sy = pos.y + 0.3, sz = pos.z;
  let blockDist = Infinity, tx = 0, ty = 0, tz = 0;
  if (b) {
    if ((b.id === MOON || b.id === MOON_WATER) && eye.y < MOON_FADE_START) {
    } else {
      tx = b.x + 0.5; ty = b.y + 1.001; tz = b.z + 0.5;
      blockDist = Math.hypot(tx - sx, ty - sy, tz - sz);
    }
  }
  let fillDist = Infinity;
  if (f) fillDist = Math.hypot(f.x + 0.5 - sx, f.y + 0.5 - sy, f.z + 0.5 - sz);
  const mob0 = pickMob(dir, Math.min(blockDist, fillDist));
  const mob = mob0;
  if (mob && mob.kind === "enderman" && !isChained(mob) && !isChainCarrier(mob)) return;
  if (mob && readyLeadForLatch(mob) === false) return;
  if (mob) {
    const isDragon = mob.kind === "dragon";
    const off = isDragon ? null : getMobHitOffset(eye, dir, mob);
    const mx = off ? mob.pos.x + off.x : mob.pos.x;
    const my = off ? mob.pos.y + off.y : (isDragon ? mob.pos.y + DRAGON_ANCHOR_DY : mob.pos.y + mob.h + 0.001);
    const mz = off ? mob.pos.z + off.z : mob.pos.z;
    if (off) grappleMobOffset.copy(off);
    else if (isDragon) grappleMobOffset.set(0, DRAGON_ANCHOR_DY, 0);
    else grappleMobOffset.set(0, mob.h + 0.001, 0);
    const distMob = Math.hypot(mx - sx, my - sy, mz - sz);
    if (distMob < 0.3) return;
    if ((!b && !f) || distMob < Math.min(blockDist, fillDist)) {
      if (mob === carryMob || mob === carryGrappleMob) return;
      grapplePendingInsert = (isChainCarrier(mob) || playerInChain()) ? mob.id : null;
      grappleMob = mob;
      grappleBlock = null;
      grappleFill = null;
      if (mob.kind !== "dragon" && mob !== carryMob && mob !== carryGrappleMob) setMobTransparent(mob, 1);
      grappleTarget.set(mx, my, mz);
      grappleStart.set(sx, sy, sz);
      grapplingDist = distMob;
      grappleFly = 0;
      grappleHookPos.set(sx, sy, sz);
      grappleHooked = false;
      grappleArrived = false;
      grapplePulling = false;
      grapplePass = true;
      grappleActive = true;
      grappleRetracting = false;
      grappleTowInit = false;
      grappleTowPos.set(0, 0, 0);
      syncGrappleColor();
      jumpCount = 1;
      jumpIdle = 0;
      stepDown = false;
      return;
    }
  }
  if (!b && !f) return;
  if (f && fillDist < blockDist) {
    if (fillDist < 0.3) return;
    grapplePendingInsert = null;
    grappleMob = null;
    grappleBlock = null;
    grappleFill = { x: f.x, y: f.y, z: f.z, frame: portalFrameSkip(f.win, f.nether) };
    grappleTarget.set(f.x + 0.5, f.y + 0.5, f.z + 0.5);
    grappleStart.set(sx, sy, sz);
    grapplingDist = fillDist;
    grappleFly = 0;
    grappleHookPos.set(sx, sy, sz);
    grappleHooked = false;
    grappleArrived = false;
    grapplePulling = false;
    grapplePass = true;
    grappleActive = true;
    grappleRetracting = false;
    grappleTowInit = false;
    grappleTowPos.set(0, 0, 0);
    syncGrappleColor();
    jumpCount = 1;
    jumpIdle = 0;
    stepDown = false;
    return;
  }
  if (!b) return;
  if ((b.id === MOON || b.id === MOON_WATER) && eye.y < MOON_FADE_START) return;
  if (blockDist < 0.3) return;
  grapplePendingInsert = null;
  grappleMob = null;
  grappleBlock = b;
  grappleFill = null;
  grappleTarget.set(tx, ty, tz);
  grappleStart.set(sx, sy, sz);
  grapplingDist = blockDist;
  grappleFly = 0;
  grappleHookPos.set(sx, sy, sz);
  grappleHooked = false;
  grappleArrived = false;
  grapplePulling = false;
  grapplePass = true;
  grappleActive = true;
  grappleRetracting = false;
  grappleTowInit = false;
  grappleTowPos.set(0, 0, 0);
  syncGrappleColor();
  jumpCount = 1;
  jumpIdle = 0;
  stepDown = false;
}

function latchPlayerTo(mob) {
  if (!mob || !mobs.includes(mob) || freeCam) return false;
  if (readyLeadForLatch(mob) === false) return false;
  grapplePendingInsert = null;
  grappleMob = mob;
  grappleBlock = null;
  if (mob.kind === "dragon") grappleMobOffset.set(0, DRAGON_ANCHOR_DY, 0);
  else grappleMobOffset.set(0, mob.h + 0.001, 0);
  grappleTarget.set(mob.pos.x, mob.pos.y + grappleMobOffset.y, mob.pos.z);
  grappleStart.set(pos.x, pos.y + 0.3, pos.z);
  grapplingDist = 1;
  grappleHookPos.copy(grappleTarget);
  grappleFly = 1;
  grappleHooked = true;
  grappleArrived = false;
  grapplePulling = false;
  grapplePass = true;
  grappleActive = true;
  grappleRetracting = false;
  grappleTowInit = false;
  grappleTowPos.set(0, 0, 0);
  syncGrappleColor();
  const keptLead = playerLeadLink();
  if (keptLead) keptLead.link.playerFrontId = mob.id;
  return true;
}

function playerLeadLink() {
  const backId = chainChild.get(PLAYER_CHAIN_ID);
  if (backId === undefined) return null;
  const link = chainLinks.get(backId);
  if (!link || !link.playerLead) return null;
  const back = mobById.get(backId);
  if (!back || !mobs.includes(back)) return null;
  return { backId, back, link };
}
function dropPlayerLeadEntry() {
  const lead = playerLeadLink();
  if (!lead) return null;
  chainChild.delete(PLAYER_CHAIN_ID);
  chainParent.delete(lead.backId);
  const l = chainLinks.get(lead.backId);
  if (l) {
    scene.remove(l.rope);
    scene.remove(l.head);
    if (l.rope.dispose) l.rope.dispose();
    chainLinks.delete(lead.backId);
  }
  return lead.back;
}
function leadContains(mob) {
  if (!mob || playerInChain()) return false;
  let cur = mob, guard = 0;
  const seen = new Set();
  while (cur && guard++ < 64 && !seen.has(cur.id)) {
    seen.add(cur.id);
    const pid = chainParent.get(cur.id);
    if (pid === undefined) return false;
    if (pid === PLAYER_CHAIN_ID) {
      const link = chainLinks.get(cur.id);
      return !!(link && link.playerLead);
    }
    cur = mobById.get(pid);
  }
  return false;
}
function readyLeadForLatch(mob) {
  const lead = playerLeadLink();
  if (!lead) return true;
  if (!mob || !leadContains(mob)) return true;
  if (mob === lead.back) {
    dropPlayerLeadEntry();
    resumeChainedMob(lead.back);
    return true;
  }
  return false;
}
function appendCutFollowerBehindLeadTail(backId) {
  const lead = playerLeadLink();
  const back = backId !== undefined ? mobById.get(backId) : null;
  if (!lead || !back || !mobs.includes(back)) return false;
  const T = chainTailOf(lead.back);
  if (!T) return false;
  chainParent.set(backId, T.id);
  chainChild.set(T.id, backId);
  const fl = chainLinks.get(backId);
  if (fl) {
    fl.carrierId = T.id;
    fl.playerFrontId = null;
    fl.strainT = 0; fl.farT = 0; fl.flySplitT = 0; fl.threadT = 0; fl.loiter = false;
  }
  return true;
}
function leadAwareLatchInsert(mob) {
  if (!mob || !mobs.includes(mob) || !playerLeadLink()) return false;
  const fid = chainChild.get(mob.id);
  const F = fid !== undefined ? mobById.get(fid) : null;
  if (!F || !mobs.includes(F) || F === mob || isMobHeld(F)) return true;
  chainChild.delete(mob.id);
  chainParent.delete(fid);
  if (!appendCutFollowerBehindLeadTail(fid)) spliceChainLink(mob, F);
  return true;
}
function grabRideForCarry(mob) {
  const fid = chainParent.get(mob.id);
  const front = (fid !== undefined && fid !== PLAYER_CHAIN_ID) ? mobById.get(fid) : null;
  chainTakeForCarry(mob);
  const frontLive = front && mobs.includes(front) && !isMobHeld(front);
  if (frontLive) {
    grappleMob = front;
    if (front.kind === "dragon") grappleMobOffset.set(0, DRAGON_ANCHOR_DY, 0);
    else grappleMobOffset.set(0, front.h + 0.001, 0);
    grappleTarget.set(front.pos.x, front.pos.y + grappleMobOffset.y, front.pos.z);
    grappleHookPos.copy(grappleTarget);
    grappleTowInit = false;
    grappleTowPos.set(0, 0, 0);
    syncGrappleColor();
    if (isBirdKind(front.kind) && (front.mode === "perch" || front.mode === "toPerch")) birdTakeoff(front);
    const backId = chainChild.get(PLAYER_CHAIN_ID);
    const pl = backId !== undefined ? chainLinks.get(backId) : null;
    if (pl) pl.playerFrontId = front.id;
    return;
  }
  if (mob.vel) vel.copy(mob.vel);
  detachDisplacementGrapple();
  const backId = chainChild.get(PLAYER_CHAIN_ID);
  const pl = backId !== undefined ? chainLinks.get(backId) : null;
  if (pl) { pl.playerLead = true; pl.playerFrontId = null; }
}

function playerInsertCutAndLink(mob) {
  if (!mob || !mobs.includes(mob)) return false;
  if (grappleMob !== mob || !playerInChain()) return false;
  const backId = chainChild.get(mob.id);
  const back = backId !== undefined ? mobById.get(backId) : null;
  if (!back || !mobs.includes(back) || back === mob || isMobHeld(back)) return true;
  chainChild.delete(mob.id);
  chainParent.delete(backId);
  const bl = chainLinks.get(backId);
  if (bl) {
    scene.remove(bl.rope);
    scene.remove(bl.head);
    if (bl.rope.dispose) bl.rope.dispose();
    chainLinks.delete(backId);
  }
  if (!linkChain(playerChainAvatar, back)) {
    if (!spliceChainLink(mob, back)) freeChainRoot(back);
  }
  return true;
}

function latchPlayerInMiddle(mob) {
  if (!mob || !mobs.includes(mob) || freeCam) return false;
  if (isMobHeld(mob)) return false;
  if (mob.kind === "enderman" && !isChained(mob) && !isChainCarrier(mob)) return false;
  if (playerInChain() && grappleMob === mob) return true;
  if (readyLeadForLatch(mob) === false) return false;
  const keptLead = playerLeadLink();
  if (playerInChain() && grappleMob) {
    const oldBackId = chainChild.get(PLAYER_CHAIN_ID);
    const oldBack = oldBackId !== undefined ? mobById.get(oldBackId) : null;
    const oldFront = grappleMob;
    if (oldBackId !== undefined) {
      chainChild.delete(PLAYER_CHAIN_ID);
      chainParent.delete(oldBackId);
      const ol = chainLinks.get(oldBackId);
      if (ol) {
        scene.remove(ol.rope);
        scene.remove(ol.head);
        if (ol.rope.dispose) ol.rope.dispose();
        chainLinks.delete(oldBackId);
      }
      if (oldBack && mobs.includes(oldBack) && !isMobHeld(oldBack) &&
          oldFront && mobs.includes(oldFront) &&
          !chainChild.has(oldFront.id)) {
        linkChain(oldFront, oldBack);
      } else if (oldBack && mobs.includes(oldBack)) {
        freeChainRoot(oldBack);
      }
    }
  }
  const backId = chainChild.get(mob.id);
  const back = backId !== undefined ? mobById.get(backId) : null;
  const backLive = !!(back && mobs.includes(back) && back !== mob && !isMobHeld(back));
  if (backId !== undefined && backLive) {
    chainChild.delete(mob.id);
    chainParent.delete(backId);
    const bl = chainLinks.get(backId);
    if (bl && !keptLead) {
      scene.remove(bl.rope);
      scene.remove(bl.head);
      if (bl.rope.dispose) bl.rope.dispose();
      chainLinks.delete(backId);
    }
  }
  if (!latchPlayerTo(mob)) {
    if (backLive) spliceChainLink(mob, back);
    return false;
  }
  if (backLive) {
    if (keptLead && playerLeadLink()) {
      if (!appendCutFollowerBehindLeadTail(backId)) spliceChainLink(mob, back);
    } else if (!linkChain(playerChainAvatar, back)) {
      if (!spliceChainLink(mob, back)) freeChainRoot(back);
    }
  }
  return true;
}

function insertChainAheadOfPlayer(mob) {
  if (!mob || !mobs.includes(mob) || !playerInChain() || !grappleMob) return false;
  if (isMobHeld(mob)) return false;
  const ride = grappleMob;
  if ((mob.dim || "over") !== dim || (ride.dim || "over") !== dim) return false;
  if (chainChild.has(ride.id)) {
    if (!insertChainBehind(ride, mob)) return false;
  } else if (!linkChain(ride, mob)) return false;
  if (isBirdKind(ride.kind) && (ride.mode === "perch" || ride.mode === "toPerch")) birdTakeoff(ride);
  grappleMob = mob;
  if (mob.kind === "dragon") grappleMobOffset.set(0, DRAGON_ANCHOR_DY, 0);
  else grappleMobOffset.set(0, mob.h + 0.001, 0);
  grappleTarget.set(mob.pos.x, mob.pos.y + grappleMobOffset.y, mob.pos.z);
  grappleHookPos.copy(grappleTarget);
  grappleTowInit = false;
  grappleTowPos.set(0, 0, 0);
  syncGrappleColor();
  const backId = chainChild.get(PLAYER_CHAIN_ID);
  const pl = backId !== undefined ? chainLinks.get(backId) : null;
  if (pl) pl.playerFrontId = mob.id;
  return true;
}

function insertChainBehindPlayer(aimed, mob) {
  if (!aimed || !mob || aimed === mob) return false;
  if (!mobs.includes(aimed) || !mobs.includes(mob)) return false;
  if (!playerInChain()) return false;
  if (chainParent.get(aimed.id) !== PLAYER_CHAIN_ID || chainChild.get(PLAYER_CHAIN_ID) !== aimed.id)
    return insertChainBehind(aimed, mob);
  if (isMobHeld(mob)) return false;
  if ((mob.dim || "over") !== dim || (aimed.dim || "over") !== dim) return false;
  chainChild.delete(PLAYER_CHAIN_ID);
  chainParent.delete(aimed.id);
  seatChainChildNearCarrier(playerChainAvatar, mob);
  if (linkChain(playerChainAvatar, mob) && spliceChainLink(mob, aimed)) return true;
  const ml = chainLinks.get(mob.id);
  if (ml) {
    scene.remove(ml.rope);
    scene.remove(ml.head);
    if (ml.rope.dispose) ml.rope.dispose();
    chainLinks.delete(mob.id);
  }
  chainParent.delete(mob.id);
  if (chainChild.get(PLAYER_CHAIN_ID) === mob.id) chainChild.delete(PLAYER_CHAIN_ID);
  if (!spliceChainLink(playerChainAvatar, aimed) && !linkChain(playerChainAvatar, aimed)) freeChainRoot(aimed);
  return false;
}

function blockedBody(px, py, pz) {
  const y0 = Math.floor(py + 0.02);
  const y1 = Math.floor(py + PLAYER_H - 0.02);
  for (let bx = Math.floor(px - PLAYER_HW + 0.02); bx <= Math.floor(px + PLAYER_HW - 0.02); bx++)
    for (let bz = Math.floor(pz - PLAYER_HW + 0.02); bz <= Math.floor(pz + PLAYER_HW - 0.02); bz++) {
      const skip = grappleBlock && bx === grappleBlock.x && bz === grappleBlock.z;
      for (let by = y0; by <= y1; by++) {
        if (skip && by === grappleBlock.y) continue;
        if (isGrappleFillFrame(bx, by, bz)) continue;
        if (isSolid(bx, by, bz)) return true;
      }
    }
  return false;
}

function isGrappleBlock(bx, by, bz) {
  return grapplePass && !!grappleBlock && bx === grappleBlock.x && bz === grappleBlock.z &&
    by >= grappleBlock.y && by <= grappleTopY;
}

function isGrappleFillFrame(bx, by, bz) {
  return !!grappleFill && grappleFill.frame.has(bx + "," + by + "," + bz);
}

function grappleMoveX(dx) {
  pos.x += dx;
  if (dx === 0) return false;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.x + PLAYER_HW : pos.x - PLAYER_HW;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (!isSolid(cellX, by, bz) || isGrappleBlock(cellX, by, bz) || isGrappleFillFrame(cellX, by, bz)) continue;
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
      if (!isSolid(bx, by, cellZ) || isGrappleBlock(bx, by, cellZ) || isGrappleFillFrame(bx, by, cellZ)) continue;
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
        if (isSolid(bx, by, bz) && !isGrappleBlock(bx, by, bz) && !isGrappleFillFrame(bx, by, bz) && top > by) { pos.y = by - PLAYER_H - 0.001; return true; }
      } else {
        const by = Math.floor(feet);
        if (isSolid(bx, by, bz) && !isGrappleBlock(bx, by, bz) && !isGrappleFillFrame(bx, by, bz)) { pos.y = by + 1 + 0.001; return true; }
      }
    }
  return false;
}

function grappleVertBoost(y) {
  const lo = CLOUD_BASE, hi = CLOUD_BASE + CLOUD_SPAN * 0.5, e = 18;
  if (y < lo - e || y > hi + e) return 1;
  if (y < lo) return 1 + smoothstep((y - (lo - e)) / e);
  if (y > hi) return 1 + smoothstep((hi + e - y) / e);
  return 2;
}
function updateGrapple(dt) {
  if (pos.y < 0) { detachDisplacementGrapple(); return false; }
  if (grappleArrived) { grapplePulling = false; return false; }
  if (grappleMob) {
    if (!mobs.includes(grappleMob) || (grappleMob.dim !== undefined && grappleMob.dim !== dim)) {
      grappleActive = false;
      grappleMob = null;
      grapplePendingInsert = null;
      grappleRetracting = true;
      grappleHookPos.copy(grappleTarget);
      syncGrappleColor();
      return false;
    }
    if (grappleMob.kind === "dragon") {
      grappleMobOffset.set(0, DRAGON_ANCHOR_DY, 0);
      grappleTarget.set(grappleMob.pos.x, grappleMob.pos.y + DRAGON_ANCHOR_DY, grappleMob.pos.z);
    } else {
      grappleTarget.set(grappleMob.pos.x + grappleMobOffset.x, grappleMob.pos.y + grappleMobOffset.y, grappleMob.pos.z + grappleMobOffset.z);
    }
    if (grappleHooked) grappleHookPos.copy(grappleTarget);
  }
  if (!grappleHooked) {
    if (grappleMob) {
      const dx0 = grappleTarget.x - grappleHookPos.x, dy0 = grappleTarget.y - grappleHookPos.y, dz0 = grappleTarget.z - grappleHookPos.z;
      const dist0 = Math.hypot(dx0, dy0, dz0);
      const hitR = (grappleMob.hw || 0.27) + 0.35;
      const b = grappleVertBoost(pos.y);
      const isVert = Math.abs(grappleTarget.y - grappleStart.y) > 2 * Math.abs(grappleTarget.x - grappleStart.x);
      const tb = isVert ? b : 1;
      const step = GRAPPLE_THROW * tb * dt;
      if (dist0 <= hitR) {
        grappleHookPos.copy(grappleTarget);
        grappleHooked = true;
        const lead = playerLeadLink();
        if (lead) lead.link.playerFrontId = grappleMob.id;
      } else {
        const move = Math.min(step, dist0);
        const s = move / dist0;
        grappleHookPos.x += dx0 * s;
        grappleHookPos.y += dy0 * s;
        grappleHookPos.z += dz0 * s;
      }
      grapplePulling = false;
      return false;
    }
    const b = grappleVertBoost(pos.y);
    const isVert = Math.abs(grappleTarget.y - grappleStart.y) > 2 * Math.abs(grappleTarget.x - grappleStart.x);
    const tb = isVert ? b : 1;
    grappleFly += (GRAPPLE_THROW * tb * dt) / grapplingDist;
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
  const grappleChainTail = grappleMob && grappleHooked && !chainChild.has(grappleMob.id) && (isChained(grappleMob) || isChainCarrier(grappleMob));
  if (grappleMob && grappleHooked) {
    const pm = grappleMob;
    const followDist = pm.kind === "dragon" ? DRAGON_FOLLOW_DIST : BIRD_FOLLOW_DIST;
    const pdx = grappleTarget.x - pos.x, pdy = grappleTarget.y - pos.y, pdz = grappleTarget.z - pos.z;
    const pvl = pm.vel.length();
    const followR = (grappleTowInit ? followDist + 2 : followDist) + pvl * 0.25;
    if (Math.hypot(pdx, pdy, pdz) <= followR) {
      grappleHookPos.copy(grappleTarget);
      if (grapplePendingInsert !== null) {
        const im = mobById.get(grapplePendingInsert);
        grapplePendingInsert = null;
        if (im) {
          if (playerLeadLink()) {
            playerLeadLink().link.playerFrontId = grappleMob.id;
            leadAwareLatchInsert(im);
          } else playerInsertCutAndLink(im);
        }
      }
      const dirRate = 2.2 + pvl * 0.2, posRate = 6 + pvl * 0.5;
      if (pvl > 1e-3) {
        grappleTowTmp.set(pm.vel.x / pvl, pm.vel.y / pvl, pm.vel.z / pvl);
        grappleTowTmp.y = Math.max(-0.6, Math.min(0.6, grappleTowTmp.y));
        const tl = grappleTowTmp.length() || 1;
        grappleTowTmp.divideScalar(tl);
        if (!grappleTowInit) { grappleTowDir.copy(grappleTowTmp); grappleTowInit = true; grappleRideAx.copy(grappleTowTmp); grappleRideAxP.copy(grappleTowTmp); grappleRideAxV.set(0, 0, 0); }
        else { grappleTowDir.lerp(grappleTowTmp, Math.min(1, dt * dirRate)); if (grappleTowDir.lengthSq() < 1e-6) grappleTowDir.set(0, 0, 1); grappleTowDir.normalize(); grappleRideAx.lerp(grappleTowTmp, Math.min(1, dt * 8)); if (grappleRideAx.lengthSq() < 1e-6) grappleRideAx.set(0, 0, 1); grappleRideAx.normalize(); }
      } else {
        if (!grappleTowInit) { grappleTowDir.set(0, 0, 1); grappleTowInit = true; grappleRideAx.set(0, 0, 1); grappleRideAxP.set(0, 0, 1); }
        grappleRideAxV.multiplyScalar(Math.max(0, 1 - dt * 3));
      }
      if (pvl > 1e-3 && dt > 1e-4) {
        grappleTowTmp.set((grappleRideAx.x - grappleRideAxP.x) / dt, (grappleRideAx.y - grappleRideAxP.y) / dt, (grappleRideAx.z - grappleRideAxP.z) / dt);
        grappleRideAxV.lerp(grappleTowTmp, Math.min(1, dt * 3));
        grappleRideAxP.copy(grappleRideAx);
      }
      const leadT = 1 / posRate;
      const desX = pm.pos.x + pm.vel.x * leadT - grappleTowDir.x * followDist, desY = chainAnchorY(pm) + pm.vel.y * leadT - grappleTowDir.y * followDist - PLAYER_H * 0.5, desZ = pm.pos.z + pm.vel.z * leadT - grappleTowDir.z * followDist;
      if (grappleTowPos.lengthSq() < 1e-6) grappleTowPos.set(desX, desY, desZ);
      else grappleTowPos.lerp(grappleTowTmp.set(desX, desY, desZ), Math.min(1, dt * posRate));
    const stiff = 18, damp = 11;
      const ex = grappleTowPos.x - pos.x, ey = grappleTowPos.y - pos.y, ez = grappleTowPos.z - pos.z;
      const exl = Math.hypot(ex, ey, ez) || 1;
      const ecl = Math.min(exl, 3);
      const svx = pm.vel.x - grappleRideAxV.x * followDist;
      const svy = pm.vel.y - grappleRideAxV.y * followDist;
      const svz = pm.vel.z - grappleRideAxV.z * followDist;
      vel.x += ((ex / exl * ecl) * stiff - (vel.x - svx) * damp) * dt;
      vel.y += ((ey / exl * ecl) * stiff - (vel.y - svy) * damp) * dt;
      vel.z += ((ez / exl * ecl) * stiff - (vel.z - svz) * damp) * dt;
      const spd = Math.hypot(vel.x, vel.y, vel.z);
      const rideSpd = chainLeadSpeedOf(pm, dt);
      const maxSp = Math.max((pm.speed || BIRD_SPEED) * 2.2, pvl * 1.5, rideSpd + 8 + grappleRideAxV.length() * followDist);
      if (spd > maxSp) { vel.x *= maxSp / spd; vel.y *= maxSp / spd; vel.z *= maxSp / spd; }
      let remaining = Math.min(Math.hypot(vel.x, vel.y, vel.z) * dt, 1.2);
      let blockedX = false, blockedY = false, blockedZ = false;
      let guard = 0;
      while (remaining > 1e-4 && guard++ < 8) {
        const move = Math.min(remaining, 0.4);
        const vl2 = Math.hypot(vel.x, vel.y, vel.z) || 1;
        const s = move / vl2;
        if (grappleMoveY(vel.y * s)) blockedY = true;
        if (grappleMoveX(vel.x * s)) blockedX = true;
        if (grappleMoveZ(vel.z * s)) blockedZ = true;
        remaining -= move;
        if (blockedX || blockedY || blockedZ) break;
      }
      if (blockedY) vel.y = 0;
      if (blockedX) vel.x = 0;
      if (blockedZ) vel.z = 0;
      if ((blockedX || blockedZ) && pm && !isFlyingKind(pm.kind)) {
        const by = Math.floor(pos.y);
        let headroom = true;
        for (let hbx = Math.floor(pos.x - PLAYER_HW + 0.001); headroom && hbx <= Math.floor(pos.x + PLAYER_HW - 0.001); hbx++)
          for (let hbz = Math.floor(pos.z - PLAYER_HW + 0.001); headroom && hbz <= Math.floor(pos.z + PLAYER_HW - 0.001); hbz++)
            if (isSolid(hbx, by + 1, hbz)) headroom = false;
        if (headroom && !aabbCollidesWorld(pos.x, by + 1 + 0.001, pos.z, PLAYER_HW, PLAYER_H)) {
          if (isJumpingKind(pm.kind)) vel.y = JUMP_MIN + 2.5;
          else pos.y = by + 1 + 0.001;
        }
      }
      if (grappleChainTail) {
        const tAx = pm.pos.x, tAy = chainAnchorY(pm), tAz = pm.pos.z;
        const eDx = pos.x - tAx, eDy = pos.y + PLAYER_H * 0.5 - tAy, eDz = pos.z - tAz;
        const eD = Math.hypot(eDx, eDy, eDz);
        if (eD > 1e-6) {
          const qx = tAx + (eDx / eD) * followDist;
          const qy = tAy + (eDy / eD) * followDist - PLAYER_H * 0.5;
          const qz = tAz + (eDz / eD) * followDist;
          const ox = pos.x, oy = pos.y, oz = pos.z;
          pos.set(qx, qy, qz);
          if (blockedBody(pos.x, pos.y, pos.z)) pos.set(ox, oy, oz);
        }
      }
      onGround = false;
      stepDown = false;
      grapplePulling = true;
      return true;
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
    stepDown = false;
    return false;
  }
  grapplePulling = true;
  return true;
}

function updatePlayer(dt) {
  if (grappleActive && updateGrapple(dt)) return;
  const g = (dim === "over" && pos.y >= MOON_Y - MOON_R) ? GRAVITY * 0.5 : GRAVITY;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  const w = keys["KeyW"] || keys["ArrowUp"];
  const s = keys["KeyS"] || keys["ArrowDown"];
  const d = keys["KeyD"] || keys["ArrowRight"];
  const a = keys["KeyA"] || keys["ArrowLeft"];
  const sprintKey = !!(keys["Slash"] || keys["/"]);

  if (w) move.add(fwd);
  if (s) move.sub(fwd);
  if (d) move.add(right);
  if (a) move.sub(right);

  let inWater = headInWater();
  if (!inWater) { liquidInertiaT = 0; liquidBrakeT = 0; }
  const enteredWater = inWater && !wasInWater;
  const spaceNow = !!(keys["ShiftLeft"] || keys["ShiftRight"] || keys["Space"] || keys[" "]);
  const spaceJustPressed = spaceNow && !prevSpace;
  const spaceJustReleased = !spaceNow && prevSpace;
  jumpBuffer = Math.max(0, jumpBuffer - dt);
  if (spaceJustPressed) {
    jumpBuffer = Math.max(jumpBuffer, JUMP_BUFFER + dt);
    lastSpaceDownY = pos.y;
    if (!onGround && !flying && !inWater) {
      jumpPeakY = pos.y;
      if (jumpOriginY === null) jumpOriginY = pos.y;
      jumpHoldContinuous = true;
    }
  }
  if (spaceJustReleased && vel.y > 0 && !onGround && !flying) { vel.y *= 0.45; airT = JUMP_HOLD_TIME; }
  prevSpace = spaceNow;
  if (!onGround && !flying && !spaceNow) jumpHoldContinuous = false;
  if (onGround) { jumpOriginY = null; jumpPeakY = null; waterDipActive = false; if (!spaceNow) jumpHoldContinuous = false; }
  if (jumpOriginY !== null && !onGround && !flying) jumpPeakY = Math.max(jumpPeakY, pos.y);
  let bounced = false;
  if (enteredWater && spaceNow && (jumpOriginY !== null || lastSpaceDownY !== null)) {
    const surface = waterSurfaceTop();
    let isLiquid = false;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
        const lid = getBlock(bx, surface - 1, bz);
        if (lid === WATER || lid === LAVA || lid === MOON_WATER) isLiquid = true;
      }
    if (isLiquid && surface !== -Infinity) {
      let target = null;
      if (jumpHoldContinuous && jumpPeakY !== null) target = jumpPeakY;
      else if (lastSpaceDownY !== null) target = lastSpaceDownY;
      else target = jumpOriginY;
      if (target !== null && pos.y < target - 0.5) {
        const delta = target - (surface + 0.1);
        if (delta > 0) {
          const bv = Math.sqrt(2 * GRAVITY * delta);
          vel.y = bv;
          if (sprintKey) {
            if (move.lengthSq() > 0) {
              const s = SPRINT * 2;
              const mn = move.clone().normalize().multiplyScalar(s);
              vel.x = mn.x; vel.z = mn.z;
            } else { vel.x *= 2; vel.z *= 2; }
          }
          airT = JUMP_HOLD_TIME;
          pos.y = surface + 0.1;
          inWater = false;
          wasInWater = false;
          onGround = false;
          stepUp = false; stepDown = false; stepFromWater = false; stepHop = false;
          bounced = true;
        }
      }
    }
  }
  if (!bounced) {
    if (inWater && !wasInWater && vel.y < 0) vel.y *= 0.3;
    wasInWater = inWater;
  }

  if (flying) {
    stepDown = false;
    stepUp = false;
    stepFromWater = false;
    stepHop = false;
    const speed = FLY;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x = move.x; vel.z = move.z;
    vel.y = (spaceNow ? speed : 0) - (sprintKey ? speed : 0);
    flingActive = false;
  } else if (bounced) {
  } else if (inWater) {
    if (jumpBoost > 1) { jumpBoost = 1; jumpCount = 0; jumpIdle = 0; }
    stepDown = false;
    stepFromWater = true;
    // Buoyancy: a linear speed-up deep underwater (SWIM_ACCEL) that keeps
    // building the whole way up, then SWIM_AREA blocks before the surface a
    // steady deceleration (SWIM_BRAKE) settles you back to a calm FLOAT_SPEED
    // drift. Both the deep accel and the surface drift are doubled speed.
    // Shift does nothing in water.
    if (liquidInertiaT > 0) {
      // Grapple-release inertia: coast at the kept velocity, no swim forces.
      liquidInertiaT -= dt;
      if (liquidInertiaT <= 0) {
        liquidInertiaT = 0;
        liquidBrakeV.copy(vel);
        liquidBrakeT = LIQUID_BRAKE_TIME;
      }
    } else if (liquidBrakeT > 0) {
      // Constant deceleration: linear ramp of the snapshotted velocity to
      // zero over LIQUID_BRAKE_TIME, then buoyancy takes over.
      const step = Math.min(liquidBrakeT, dt);
      vel.x -= liquidBrakeV.x * (step / LIQUID_BRAKE_TIME);
      vel.y -= liquidBrakeV.y * (step / LIQUID_BRAKE_TIME);
      vel.z -= liquidBrakeV.z * (step / LIQUID_BRAKE_TIME);
      liquidBrakeT -= step;
      if (liquidBrakeT <= 0) { liquidBrakeT = 0; vel.set(0, 0, 0); }
    } else {
    const speed = (sprintKey && move.lengthSq() > 0) ? SPRINT : 4.2;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x += (move.x - vel.x) * Math.min(1, dt * 8);
    vel.z += (move.z - vel.z) * Math.min(1, dt * 8);
    // A block-hooked grapple (arrived or blocked, rope still attached) beats
    // liquid buoyancy: the player hangs on the rope and can still swim
    // horizontally, but never drifts up while hooked.
    const anchored = grappleActive && grappleHooked && !grappleMob;
    if (stepUp) {
      const glide = Math.max(STEP_UP_MIN, Math.min(STEP_UP, (stepUpClearY - pos.y) / STEP_UP_EASE));
      vel.y = glide;
      if (pos.y + glide * dt >= stepUpClearY) {
        pos.y = stepUpClearY;
        vel.y = 0;
        stepUp = false;
        onGround = true;
      }
    } else if (stepHop) {
      vel.y -= g * dt;
      if (vel.y <= 0 || onGround) stepHop = false;
      } else if (anchored) {
        vel.y = 0;
      } else {
        const surface = waterSurfaceTop();
        if (surface === -Infinity) {
          vel.y -= g * dt;
        } else {
          const targetY = surface - 1.17;
          const err = targetY - pos.y;
          if (err > SWIM_AREA) {
            vel.y += SWIM_ACCEL * dt;
            if (vel.y < -SWIM_SOFT_CAP) vel.y += (-SWIM_SOFT_CAP - vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
          } else {
            const want = err * 4;
            vel.y += (want - vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
          }
        }
      vel.y = Math.min(Math.max(vel.y, -SWIM_MAX), SWIM_MAX);
      }
    }
  } else {
    stepFromWater = false;
    stepHop = false;
    const sprint = sprintKey && move.lengthSq() > 0;
    const baseSpeed = sprint ? SPRINT : WALK;
    const speed = Math.min(baseSpeed * jumpBoost, WALK * 3);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    if (flingActive) {
      vel.x += move.x * 4.0 * dt;
      vel.z += move.z * 4.0 * dt;
      const damp = Math.max(0, 1 - 0.6 * dt);
      vel.x *= damp; vel.z *= damp;
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > GRAPPLE_FLING) { vel.x *= GRAPPLE_FLING / sp; vel.z *= GRAPPLE_FLING / sp; }
      if (sp < 1) { flingActive = false; }
    } else if (!onGround && !stepUp) {
      if (move.lengthSq() > 0) {
        const k = Math.min(1, AIR_STEER * dt);
        const curSpd = Math.hypot(vel.x, vel.z);
        const airTarget = Math.max(curSpd, Math.min(baseSpeed * AIR_SPRINT * jumpBoost, WALK * 3));
        vel.x += (move.x * (airTarget / speed) - vel.x) * k;
        vel.z += (move.z * (airTarget / speed) - vel.z) * k;
      } else {
        const dampVal = jumpBoost > 1 ? 0.08 : JUMP_FLING_DAMP;
        const damp = Math.max(0, 1 - dampVal * dt);
        vel.x *= damp; vel.z *= damp;
      }
    } else {
      airT = 0;
      if (move.lengthSq() > 0) {
        vel.x += (move.x - vel.x) * Math.min(1, dt * 12);
        vel.z += (move.z - vel.z) * Math.min(1, dt * 12);
      } else {
        const fr = jumpBoost > 1 ? 0.9 : 5;
        const friction = Math.max(0, 1 - dt * fr);
        vel.x *= friction; vel.z *= friction;
      }
    }
    if (stepUp) {
      const glide = Math.max(STEP_UP_MIN, Math.min(STEP_UP, (stepUpClearY - pos.y) / STEP_UP_EASE));
      vel.y = glide;
      if (pos.y + glide * dt >= stepUpClearY) {
        pos.y = stepUpClearY;
        vel.y = 0;
        stepUp = false;
        onGround = true;
      }
    } else if (stepDown) {
      if (flingActive) { stepDown = false; vel.y -= g * dt; }
      else {
        const fy = Math.floor(pos.y) - 1;
        let supp = false;
        for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !supp; bx++)
          for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
            if (isSolid(bx, fy, bz)) supp = true;
        if (!supp) { stepDown = false; vel.y -= g * dt; }
        else vel.y = -STEP_SPEED;
      }
    } else {
      vel.y -= g * dt;
      // Hold Shift to keep climbing: the thrust fades in smoothly from takeoff
      // (no hard threshold), so a quick tap barely climbs while a hold engages
      // immediately instead of after a dead delay.
      if (!onGround && spaceNow && airT < JUMP_HOLD_TIME && vel.y > 0) {
        airT += dt;
        vel.y += JUMP_THRUST * Math.min(1, airT / JUMP_RAMP) * dt;
        // Boost: extra upward acceleration for the first JUMP_BOOST_TIME of a
        // jump, so takeoff kicks you up clearly instead of sagging.
        if (airT <= JUMP_BOOST_TIME) vel.y += JUMP_BOOST_ACCEL * dt;
      }
    }
    if (jumpBuffer > 0 && onGround) {
      jumpBuffer = 0;
      if (starRide) {
        // Jumping off a twirling star keeps its tangential velocity.
        const ox = pos.x - starRide.x, oz = pos.z - starRide.z;
        vel.x += oz * STAR_SPIN; vel.z += -ox * STAR_SPIN;
      }
      vel.y = JUMP_MIN; onGround = false; stepDown = false; stepUp = false;
      jumpOriginY = pos.y; jumpPeakY = pos.y; jumpHoldContinuous = true; lastSpaceDownY = pos.y; airT = 0;
      jumpIdle = 0;
      const hasHInput = keys["KeyW"] || keys["KeyS"] || keys["KeyD"] || keys["KeyA"] ||
                        keys["ArrowUp"] || keys["ArrowDown"] || keys["ArrowRight"] || keys["ArrowLeft"];
      if (hasHInput) {
        jumpCount++;
        if (jumpCount >= 2) jumpBoost = 3 - (3 - jumpBoost) * 0.625;
      } else {
        jumpCount = 0;
        jumpBoost = 1;
      }
    }
    if (vel.y < -40) vel.y = -40;
  }
  wasOnGround = onGround;
  const preX = pos.x, preZ = pos.z;
  collide();
  // Star twirl: standing on a moon-pine star pins the feet to its top and
  // revolves the player around it (yaw follows, like a merry-go-round).
  // Walking past the rim or jumping detaches; gravity resumes below.
  const prevRide = starRide;
  starRide = null;
  if (!flying && !grappleActive && !inWater && vel.y <= 0.5 && dim === "over" && starPlatforms.length) {
    const sp = starPlatformAt(pos.x, pos.z, prevRide ? STAR_PLATFORM_R + 0.25 : STAR_PLATFORM_R);
    if (sp && pos.y >= sp.top - 3 && pos.y <= sp.top + 0.6) starRide = sp;
  }
  if (starRide) {
    const a = STAR_SPIN * dt;
    const [rx, rz] = rotXZ(pos.x - starRide.x, pos.z - starRide.z, a);
    pos.x = starRide.x + rx; pos.z = starRide.z + rz;
    pos.y = starRide.top; vel.y = 0; onGround = true;
    yaw += a;
  }
  if (!flying && !grappleActive) {
    if (onGround && jumpBoost > 1) jumpIdle += dt;
    const moved = Math.hypot(pos.x - preX, pos.z - preZ);
    const expected = Math.hypot(vel.x, vel.z) * dt;
    const hasInput = keys["KeyW"] || keys["KeyS"] || keys["KeyD"] || keys["KeyA"] ||
                     keys["ArrowUp"] || keys["ArrowDown"] || keys["ArrowRight"] || keys["ArrowLeft"];
    const hSpd = Math.hypot(vel.x, vel.z);
    if (jumpBoost > 1 && onGround && expected > 0.05 && moved < expected * 0.5) {
      jumpBoost = 1; jumpCount = 0; jumpIdle = 0;
    } else if (jumpBoost > 1 && onGround && hSpd < WALK * 0.6) {
      jumpBoost = 1; jumpCount = 0; jumpIdle = 0;
    } else if (jumpBoost > 1 && onGround && jumpIdle > 0.12) {
      jumpBoost = 1; jumpCount = 0; jumpIdle = 0;
    } else if (jumpBoost > 1 && onGround && !hasInput) {
      jumpBoost = 1; jumpCount = 0; jumpIdle = 0;
    } else if (jumpBoost > 1 && onGround) {
      if (!hasInput) {
        jumpBoost = Math.max(1, jumpBoost - dt * 8);
      }
      if (jumpBoost <= 1.01) { jumpCount = 0; jumpIdle = 0; }
    }
  }
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
  const sprint = !!(keys["Slash"] || keys["/"]);
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
}

function headInWater() {
  const hw = PLAYER_HW;
  const y0 = Math.floor(pos.y + 0.01);
  const y1 = Math.floor(pos.y + PLAYER_H - 0.01);
  for (let y = y0; y <= y1; y++)
    for (let bx = Math.floor(pos.x - hw); bx <= Math.floor(pos.x + hw); bx++)
      for (let bz = Math.floor(pos.z - hw); bz <= Math.floor(pos.z + hw); bz++) {
        const id = getBlock(bx, y, bz);
        if (id === WATER || id === LAVA || id === MOON_WATER) return true;
      }
  return false;
}

function waterSurfaceTop() {
  let top = -Infinity;
  for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      const ct = colTops[dim][colTopIdx(bx, bz)];
      for (let y = ct; y >= 0; y--) {
        const id = getBlock(bx, y, bz);
        if (id === WATER || id === LAVA || id === MOON_WATER) {
          if (y + 1 > top) top = y + 1;
          break;
        }
      }
    }
  return top;
}

// ---------------------------------------------------------------------------
// Raycast (DDA voxel traversal)
// ---------------------------------------------------------------------------
const REACH = Infinity;
function pickFill(origin, dir) {
  const cells = new Set();
  const owners = new Map();
  for (const f of portalFills.values()) {
    if (f.dim !== dim) continue;
    for (const [x, y, z] of portalFillCells(f.win, f.nether)) {
      const k = x + "," + y + "," + z;
      cells.add(k);
      owners.set(k, f);
    }
  }
  if (!cells.size) return null;
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? Math.floor(origin.x) + 1 - origin.x : origin.x - Math.floor(origin.x)) / Math.abs(dir.x)) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? Math.floor(origin.y) + 1 - origin.y : origin.y - Math.floor(origin.y)) / Math.abs(dir.y)) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? Math.floor(origin.z) + 1 - origin.z : origin.z - Math.floor(origin.z)) / Math.abs(dir.z)) : Infinity;
  for (let i = 0; i < 1024; i++) {
    const outOfBounds = x < -WORLD_RADIUS || x > WORLD_RADIUS || z < -WORLD_RADIUS || z > WORLD_RADIUS || y < 0 || y > MAX_Y;
    if (!outOfBounds && cells.has(x + "," + y + "," + z)) {
      const o = owners.get(x + "," + y + "," + z);
      return { x, y, z, win: o.win, nether: o.nether };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY; tMaxY += tDeltaY;
    } else {
      z += stepZ; tMaxZ += tDeltaZ;
    }
    if (Math.min(tMaxX, tMaxY, tMaxZ) > REACH) break;
  }
  return null;
}

function portalFrameSkip(win, nether) {
  const cells = portalFillCells(win, nether);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [x, y, z] of cells) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const skip = new Set();
  for (let x = x0 - 1; x <= x1 + 1; x++)
    for (let y = y0 - 1; y <= y1 + 1; y++)
      for (let z = z0 - 1; z <= z1 + 1; z++) {
        const id = getBlock(x, y, z);
        if (id === PORTAL || id === OBSIDIAN) skip.add(x + "," + y + "," + z);
      }
  return skip;
}

function fillAt(x, y, z) {
  for (const f of portalFills.values()) {
    if (f.dim !== dim) continue;
    for (const [cx, cy, cz] of portalFillCells(f.win, f.nether)) {
      if (cx === x && cy === y && cz === z) return { win: f.win, nether: f.nether };
    }
  }
  return null;
}

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

  for (let i = 0; i < 1024; i++) {
    const outOfBounds = x < -WORLD_RADIUS || x > WORLD_RADIUS || z < -WORLD_RADIUS || z > WORLD_RADIUS || y < 0 || y > MAX_Y;
    if (!outOfBounds) {
      const id = getBlock(x, y, z);
      if (id !== AIR && !(skipLiquid && (id === WATER || id === LAVA || id === MOON_WATER))) return { x, y, z, id, face };
    }
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
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false })
);
highlight.visible = false;
highlight.renderOrder = 999;
scene.add(highlight);

const ropeA = new THREE.Vector3(), ropeB = new THREE.Vector3();
const grappleCubeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const grappleCubeMat = new THREE.MeshBasicMaterial({ color: 0x8a6d3b });
const grappleCubeMatNoFog = new THREE.MeshBasicMaterial({ color: 0x8a6d3b, fog: false });
const GRAPPLE_CUBES = 2600;
const grappleCubes = new THREE.InstancedMesh(grappleCubeGeo, grappleCubeMat, GRAPPLE_CUBES);
grappleCubes.frustumCulled = false;
grappleCubes.visible = false;
scene.add(grappleCubes);
const grappleCubeMatrix = new THREE.Matrix4();
const grappleHeadMat = new THREE.MeshBasicMaterial({ color: 0x4a3a1e });
const grappleHeadMatNoFog = new THREE.MeshBasicMaterial({ color: 0x4a3a1e, fog: false });
const grappleHead = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), grappleHeadMat);
grappleHead.visible = false;
scene.add(grappleHead);
const carryGrappleCubeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const carryGrappleCubeMat = new THREE.MeshBasicMaterial({ color: 0x870000, transparent: true, opacity: 1 });
const carryGrappleCubeMatNoFog = new THREE.MeshBasicMaterial({ color: 0x870000, transparent: true, opacity: 1, fog: false });
const CARRY_GRAPPLE_CUBES = 2600;
const carryGrappleCubes = new THREE.InstancedMesh(carryGrappleCubeGeo, carryGrappleCubeMat, CARRY_GRAPPLE_CUBES);
carryGrappleCubes.frustumCulled = false;
carryGrappleCubes.visible = false;
scene.add(carryGrappleCubes);
const carryGrappleHeadMat = new THREE.MeshBasicMaterial({ color: 0x5a0000, transparent: true, opacity: 1 });
const carryGrappleHead = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), carryGrappleHeadMat);
const carryGrappleHeadMatNoFog = new THREE.MeshBasicMaterial({ color: 0x5a0000, transparent: true, opacity: 1, fog: false });
carryGrappleHead.visible = false;
scene.add(carryGrappleHead);
const carryGrappleCubeMatrix = new THREE.Matrix4();
function updateRopeFog(submerged) {
  if (submerged === ropeNoFog) return;
  ropeNoFog = submerged;
  carryGrappleCubeMatNoFog.opacity = carryGrappleCubeMat.opacity;
  carryGrappleHeadMatNoFog.opacity = carryGrappleHeadMat.opacity;
  carryGrappleCubes.material = submerged ? carryGrappleCubeMatNoFog : carryGrappleCubeMat;
  carryGrappleHead.material = submerged ? carryGrappleHeadMatNoFog : carryGrappleHeadMat;
  syncGrappleColor();
  for (const childId of chainLinks.keys()) syncChainLinkColor(childId);
}

let currentBlock = null;
function updateTarget() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const sel = hotbarList()[selected];
  currentBlock = pickBlock(camera.position, dir, sel !== WATER && sel !== LAVA && sel !== MOON_WATER);
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
  if (aimOnMob()) return;
  const { x, y, z } = currentBlock;
  if (protectedBlocks.has(protKey(x, y, z))) return;
  if ((getBlock(x, y, z) === STONE || getBlock(x, y, z) === NETHERRACK) && y === 0) return;
  if (isMobStandingOn(x, y, z, true) || intersectsMob(x, y, z, true)) return;
  if (getBlock(x, y, z) === TNT) { igniteTNT(x, y, z); return; }
  const bid = getBlock(x, y, z);
  if (bid === WATER || bid === LAVA || bid === MOON_WATER) return;
  const pineOwner = (bid === LOG || bid === LEAVES) ? pineAt(x, y, z) : null;
  const wasPine = pineOwner !== null;
  setBlock(x, y, z, AIR);
  birdNoticeBreak(x, y, z);
  if (pineOwner) {
    const bk = key(pineOwner.x, pineOwner.y, pineOwner.z) + "|" + x + "," + y + "," + z;
    brokenPineCells.add(bk);
  }
  birdNoticeBreak(x, y, z);
  if (plantedPines.size) garlandDirty = true;
  if (wasPine) cullSmallChainsNear(x, y, z, 3, 8);
  if (placeBatch) placeBatch.push([x, y, z]);
  else { refreshBlocks([[x, y, z]]); queueSave(); }
}
function placeBlock(id) {
  if (!currentBlock) return false;
  if (aimOnMob()) return false;
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
  const liquid = target === WATER || target === LAVA || target === MOON_WATER;
  if (liquid || target === AIR) {
    if (BLOCK_INFO[id].solid && intersectsPlayer(px, py, pz)) return false;
    if (BLOCK_INFO[id].solid && intersectsMob(px, py, pz, true)) return false;
  } else if (!(target === id && (id === WATER || id === LAVA || id === MOON_WATER))) return false;
  if (id === FLOWER) placedFlowers.set(key(px, py, pz), { v: randomFlowerVariant(), a: Math.random() * Math.PI * 2 });
  if (id === GLOWSTONE) worldGlowVariants.get(world).set(key(px, py, pz), glowVariantNear(px, py, pz));
  setBlock(px, py, pz, id);
  if ((id === WATER || id === MOON_WATER) && getBlock(px, py - 1, pz) === DIRT) armSoak(px, py - 1, pz, id);
  if (placeBatch) placeBatch.push([px, py, pz]);
  else { refreshBlocks([[px, py, pz]]); queueSave(); }
  return true;
}
function beginPlaceBatch() { placeBatch = []; glowDefer++; }
function endPlaceBatch() {
  if (!placeBatch) { glowDefer = Math.max(0, glowDefer - 1); return; }
  const batch = placeBatch;
  placeBatch = null;
  glowDefer = Math.max(0, glowDefer - 1);
  if (glowDefer === 0 && glowDirtyDeferred) { glowDirtyDeferred = false; recomputeGlowClusters(); syncGlowLights(); }
  if (batch.length) { refreshBlocks(batch); queueSave(); }
}

// Holding left/right click for a moment chains actions, accelerating smoothly
// with each second the button stays held.
const CHAIN_HOLD = 1.0;
const CHAIN_RATE = 10;
const CHAIN_ACCEL = 10;
const MAX_CHAIN_RATE = 60;
const editHold = {
  0: { down: false, t: 0, acc: 0 },
  2: { down: false, t: 0, acc: 0 },
};
let chainBreaking = false;
let chainHome = null;
let chainPlat = null;
let chainSpin = 0;
// Hold-left-click phases: moving the mouse paints blocks where aimed; after
// 1s without moving, the hold latches into bridge (staircase) mode.
let leftMoved = false;
let leftTimer = 0;
let leftStairs = false;
let leftEverMoved = false;
let leftNoPlace = false;
let rightMoved = false;
// Accumulated pointer-lock pixels since right press: the hold only skips the
// 1s gate once this passes RIGHT_MOVE_PX, so tiny jitter never starts a dig.
let rightMoveAcc = 0;
const RIGHT_MOVE_PX = 15;
// Positions of every block placed/removed during the current click hold:
// chained edits are only allowed within CHAIN_RANGE blocks of any of them.
let clickAnchors = [];
const CHAIN_RANGE = 4;
// The landing cell for the chain staircase: the grid cell exactly one step
// ahead of the player at feet level. Over a cliff edge that prolongs the
// terrain straight out at foot level instead of diving after the ground below.
// If that cell is solid, no build (the terrain is already there); liquids are
// free cells, so the flight builds through water/lava/moon water too. The
// cell always lands one block in front of the player's feet, on the ground.
function feetDest() {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  const cx = Math.round(pos.x + dx);
  const cz = Math.round(pos.z + dz);
  if (Math.abs(cx) > WORLD_RADIUS || Math.abs(cz) > WORLD_RADIUS) return null;
  const fy = Math.floor(pos.y);
  const c = getBlock(cx, fy, cz);
  if (c !== AIR && c !== WATER && c !== LAVA && c !== MOON_WATER) return null;
  return [cx, fy - 1, cz];
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
  let nx = chainHome[0], ny = chainHome[1], nz = chainHome[2];
  const dx = dest[0] - nx, dy = dest[1] - ny, dz = dest[2] - nz;
  const horiz = Math.hypot(dx, dz);
  const vert = Math.abs(dy);
  const id = hotbarList()[selected];
  if (horiz <= 1 && vert <= 1) {
    chainPad(id, nx, ny, nz);
    if (ny > dest[1]) for (let y = ny - 1; y >= dest[1]; y--) chainPad(id, dest[0], y, dest[2]);
    else if (ny < dest[1]) for (let y = ny + 1; y <= dest[1]; y++) chainPad(id, dest[0], y, dest[2]);
    chainPad(id, dest[0], dest[1], dest[2]);
    chainHome = [dest[0], dest[1], dest[2]];
    return;
  }
  if (vert > 0 && horiz / vert < 1) {
    chainSpiral(dest, nx, ny, nz);
    return;
  }
  const avg = vert > 0 ? horiz / vert : 1;
  if (chainPlat == null) chainPlat = avg;
  else chainPlat = Math.min(chainPlat, avg);
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
  const oldY = ny;
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
  if (oldY !== ny) chainPad(id, nx, oldY, nz);
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
  const perps = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  const idx = chainSpin % 4;
  chainSpin = (chainSpin + 1) % 4;
  const d = dirs[idx], p = perps[idx];
  if (ny > dest[1]) ny--;
  else if (ny < dest[1]) ny++;
  if (ny < 0 || ny > MAX_Y) return;
  if (nx < -WORLD_RADIUS || nx > WORLD_RADIUS || nz < -WORLD_RADIUS || nz > WORLD_RADIUS) return;
  chainHome = [nx, ny, nz];
  const id = hotbarList()[selected];
  tryPlace(id, nx, ny, nz);
  const offs = [[d[0], d[1]], [d[0] * 2, d[1] * 2], [d[0] + p[0], d[1] + p[1]], [d[0] * 2 + p[0], d[1] * 2 + p[1]], [d[0] + p[0] * 2, d[1] + p[1] * 2], [d[0] * 2 + p[0] * 2, d[1] * 2 + p[1] * 2]];
  for (const o of offs) {
    const x = nx + o[0], z = nz + o[1];
    if (x < -WORLD_RADIUS || x > WORLD_RADIUS || z < -WORLD_RADIUS || z > WORLD_RADIUS) continue;
    tryPlace(id, x, ny, z);
  }
  const wallOffs = [[d[0] * 3, d[1] * 3], [d[0] * 3 + p[0], d[1] * 3 + p[1]], [d[0] * 3 + p[0] * 2, d[1] * 3 + p[1] * 2], [d[0] + p[0] * 3, d[1] + p[1] * 3], [d[0] * 2 + p[0] * 3, d[1] * 2 + p[1] * 3]];
  for (const o of wallOffs) {
    const x = nx + o[0], z = nz + o[1];
    if (x < -WORLD_RADIUS || x > WORLD_RADIUS || z < -WORLD_RADIUS || z > WORLD_RADIUS) continue;
    if (ny <= MAX_Y) tryPlace(id, x, ny, z);
    if (ny + 1 <= MAX_Y) tryPlace(id, x, ny + 1, z);
  }
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
const DRAGON_FULL_DMG = 0.125;
const TNT_HOME_SPEED = 11;
const DRAGON_STICK_DIST = 1.2;
const tntBombGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const tntBombMats = materialsFor(TNT);
const tntLit = new Map();
const tntEta = new Map();
function tntBombDist(px, py, pz, m) {
  return Math.hypot(m.pos.x - px, m.pos.y + m.h * 0.5 - py, m.pos.z - pz);
}
function tntSyncOnFire(mob, sx, sy, sz) {
  const need = tntBombDist(sx, sy, sz, mob) / (TNT_HOME_SPEED * 4);
  const cur = tntEta.get(mob);
  const eta = cur === undefined ? need : Math.max(cur, need);
  tntEta.set(mob, eta);
  for (const t of tntLit.values()) if (t.bird === mob && t.mesh && !t.stuck) t.life = Math.max(t.life, eta + 0.5);
  return eta;
}
function tntSyncClear(mob) {
  for (const t of tntLit.values()) if (t.bird === mob && t.mesh && !t.stuck) return;
  tntEta.delete(mob);
}
const bursts = [];
const flashes = [];
const explosionQueue = [];
let explosionBudgetMs = 7;
let explosionsPerFrame = 64;
const chainPending = new Set();

function makeTNTBomb() {
  return new THREE.Mesh(tntBombGeo, tntBombMats);
}

function clearTNTVisual(t) {
  scene.remove(t.spr);
  t.spr.material.map.dispose();
  t.spr.material.dispose();
  if (t.mesh) { scene.remove(t.mesh); t.mesh = null; }
}

function purgeLiveTNT() {
  for (const t of tntLit.values()) clearTNTVisual(t);
  tntLit.clear();
  tntEta.clear();
  explosionQueue.length = 0;
}

function purgeLiveEffects() {
  for (const b of bursts) {
    scene.remove(b.pts);
    b.geo.dispose();
    b.mat.dispose();
  }
  bursts.length = 0;
  for (const f of flashes) {
    scene.remove(f.mesh);
    f.mesh.geometry.dispose();
    f.mesh.material.dispose();
  }
  flashes.length = 0;
}

const FX_SNAPSHOT_MAX = 24;
function snapshotLiveFx() {
  const fx = [];
  for (const b of bursts) {
    if (b.tag === undefined || b.tag > 3 || !(b.life > 0)) continue;
    if (![b.fx, b.fy, b.fz].every(isFinite)) continue;
    fx.push({ tag: b.tag, x: b.fx, y: b.fy, z: b.fz, hex: b.hex || 0 });
    if (fx.length >= FX_SNAPSHOT_MAX) break;
  }
  return fx;
}

function replayLiveFx(list) {
  if (!list) return;
  for (const e of list) {
    if (![e.x, e.y, e.z].every(isFinite)) continue;
    if (e.tag === 0) spawnExplosion(e.x, e.y, e.z);
    else if (e.tag === 1) spawnBirdBurst(e.x, e.y, e.z);
    else if (e.tag === 2) spawnDragonBurst(e.x, e.y, e.z, e.hex || 0xd06bff);
    else if (e.tag === 3) spawnDragonDeath(e.x, e.y, e.z);
  }
}

function dragonSaveable() {
  return dim === "end" && !endCleared && dragon.mesh && dragon.hp > 0 && !(dragon.dying > 0);
}

function snapshotLiveTNT() {
  const bombs = [];
  for (const t of tntLit.values()) {
    let targetKind = 0;
    let tx = 0, ty = 0, tz = 0, tkind = 0;
    if (t.bird) {
      if (t.bird.kind === "dragon") targetKind = 1;
      else if (mobs.includes(t.bird)) {
        targetKind = 2;
        tx = t.bird.pos.x; ty = t.bird.pos.y; tz = t.bird.pos.z;
        tkind = mobKindCode(t.bird);
      } else continue;
    }
    bombs.push({ t, targetKind, tx, ty, tz, tkind });
  }
  const queue = [];
  for (const q of explosionQueue) {
    let qKind = 0;
    let qx = 0, qy = 0, qz = 0, qk = 0;
    if (q.bird) {
      if (q.bird === true) qKind = 3;
      else if (q.bird.kind === "dragon") qKind = 1;
      else if (mobs.includes(q.bird)) {
        qKind = 2;
        qx = q.bird.pos.x; qy = q.bird.pos.y; qz = q.bird.pos.z;
        qk = mobKindCode(q.bird);
      } else continue;
    }
    queue.push({ q, qKind, qx, qy, qz, qk });
  }
  const etas = [];
  for (const [mob, eta] of tntEta) {
    if (!(eta > 0)) continue;
    let hasBomb = false;
    for (const t of tntLit.values()) {
      if (t.bird === mob && t.mesh && !t.stuck) { hasBomb = true; break; }
    }
    if (!hasBomb) continue;
    if (mob.kind === "dragon") {
      if (!mobs.includes(mob)) continue;
      etas.push({ eta, targetKind: 1, tx: 0, ty: 0, tz: 0, tkind: 0 });
    } else {
      if (!mobs.includes(mob)) continue;
      etas.push({ eta, targetKind: 2, tx: mob.pos.x, ty: mob.pos.y, tz: mob.pos.z, tkind: mobKindCode(mob) });
    }
  }
  return { bombs, queue, etas };
}

function findSavedTargetMob(dimName, kindCode, x, y, z) {
  let best = null, bestD = 0.001;
  for (const m of mobs) {
    if (mobDimOf(m) !== dimName || mobKindCode(m) !== kindCode) continue;
    const d = Math.hypot(m.pos.x - x, m.pos.y - y, m.pos.z - z);
    if (d <= bestD) { bestD = d; best = m; }
  }
  if (best) return best;
  bestD = 3.5;
  for (const m of mobs) {
    if (mobDimOf(m) !== dimName || mobKindCode(m) !== kindCode) continue;
    if (isMobHeld(m)) continue;
    const d = Math.hypot(m.pos.x - x, m.pos.y - y, m.pos.z - z);
    if (d <= bestD) { bestD = d; best = m; }
  }
  return best;
}

function restoreLiveTNT(savedBombs, savedQueue, savedEtas) {
  if (!savedBombs && !savedQueue && !savedEtas) return;
  const now = performance.now();
  if (savedQueue) {
    for (const e of savedQueue) {
      let bird = null;
      if (e.qKind === 1) {
        if (dragon.mob && mobs.includes(dragon.mob)) bird = dragon.mob;
        else continue;
      } else if (e.qKind === 3) {
        bird = true;
      } else if (e.qKind === 2) {
        bird = findSavedTargetMob(dim, e.qk, e.qx, e.qy, e.qz);
        if (!bird) continue;
      }
      explosionQueue.push({
        x: e.x, y: e.y, z: e.z,
        pointBlank: !!e.pointBlank, homing: !!e.homing,
        due: e.remain > 0.01 ? now + e.remain * 1000 : 0,
        ...(bird ? { bird } : {}),
      });
    }
  }
  if (savedBombs) {
    for (const e of savedBombs) {
      let bird = null;
      if (e.targetKind === 1) {
        if (dragon.mob && mobs.includes(dragon.mob)) bird = dragon.mob;
        else continue;
      } else if (e.targetKind === 2) {
        bird = findSavedTargetMob(dim, e.tkind, e.tx, e.ty, e.tz);
        if (!bird) continue;
      }
      const spr = makeFuseSprite();
      spr.position.set(e.px, e.py + 0.85, e.pz);
      scene.add(spr);
      drawFuseSprite(spr, Math.max(0, bird ? e.life : e.fuse));
      let mesh = null;
      if (e.hasMesh) {
        mesh = makeTNTBomb();
        mesh.position.set(e.px, e.py, e.pz);
        scene.add(mesh);
      }
      const t = {
        bx: e.bx, by: e.by, bz: e.bz,
        px: e.px, py: e.py, pz: e.pz,
        fuse: e.fuse, life: e.life,
        spr, mesh, stuck: !!e.stuck,
        ax: e.ax, ay: e.ay, az: e.az,
        bird,
      };
      tntLit.set(e.fly ? ("fly" + (tntFlySeq++)) : key(e.bx, e.by, e.bz), t);
    }
  }
  if (savedEtas) {
    for (const e of savedEtas) {
      let mob = null;
      if (e.targetKind === 1) {
        if (dragon.mob && mobs.includes(dragon.mob)) mob = dragon.mob;
        else continue;
      } else if (e.targetKind === 2) {
        mob = findSavedTargetMob(dim, e.tkind, e.tx, e.ty, e.tz);
        if (!mob) continue;
      } else continue;
      let hasBomb = false;
      for (const t of tntLit.values()) {
        if (t.bird === mob && t.mesh && !t.stuck) { hasBomb = true; break; }
      }
      if (!hasBomb) continue;
      tntEta.set(mob, e.eta);
    }
  }
}

const CHAIN_FUSE = 0.05;
function tntFizzleAim(bx, by, bz) {
  if (dim !== "over" && dim !== "end" && dim !== "nether" || chainBreaking) return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;
  const mob = pickMob(dir, BIRD_AIM_DIST);
  if (!mob) return null;
  if (mob.kind === "dragon") {
    if (dim !== "end" || !dragon.mesh || !dragon.mob) return null;
  } else if (!isFlyingKind(mob.kind) && !isChained(mob) && !isChainCarrier(mob)) return null;
  const off = getMobHitOffset(eye, dir, mob);
  const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
  const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
  const blockT = Math.hypot(bx + 0.5 - eye.x, by + 0.5 - eye.y, bz + 0.5 - eye.z);
  if (mobT > blockT + 0.5) return null;
  return mob;
}
function fizzleTNT(bx, by, bz) {
  setBlock(bx, by, bz, AIR);
  refreshBlocks([[bx, by, bz]]);
  queueSave();
  spawnBirdBurst(bx + 0.5, by + 0.5, bz + 0.5);
}
function igniteTNT(bx, by, bz, fuse = FUSE_TIME) {
  const k = key(bx, by, bz);
  if (tntLit.has(k)) {
    const t = tntLit.get(k);
    clearTNTVisual(t);
    tntLit.delete(k);
    if (tntFizzleAim(bx, by, bz)) {
      fizzleTNT(bx, by, bz);
      return;
    }
    explodeTNT(bx, by, bz, t.stuck);
    return;
  }
  const spr = makeFuseSprite();
  spr.position.set(bx + 0.5, by + 1.35, bz + 0.5);
  scene.add(spr);
  const t = { bx, by, bz, px: bx + 0.5, py: by + 1.1, pz: bz + 0.5, fuse, life: fuse + 2, spr, mesh: null, stuck: false, ax: 0, ay: 0, az: 0, bird: null };
  let aimed = null;
  if ((dim === "over" || dim === "end" || dim === "nether") && !chainBreaking) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const eye = camera.position;
    const mob = pickMob(dir, BIRD_AIM_DIST);
    if (mob && (isFlyingKind(mob.kind) || isChained(mob) || isChainCarrier(mob)) && (dim === "over" || mob.kind !== "dragon")) {
      const off = getMobHitOffset(eye, dir, mob);
      const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
      const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
      const blockT = Math.hypot(bx + 0.5 - eye.x, by + 0.5 - eye.y, bz + 0.5 - eye.z);
      if (mobT <= blockT + 0.5) {
        const nowI = performance.now() / 1000;
        const freshI = birdLock === mob && nowI - birdLockT < BIRD_LOCK_TIME;
        if (freshI ? birdLockShots < 3 : !tntTargeted(mob)) {
          t.bird = mob;
          birdLock = mob;
          birdLockT = nowI;
          if (!freshI) birdLockShots = 0;
          birdLockShots++;
        } else aimed = mob;
      }
    }
  }
  if (dim === "end" && dragon.mesh && dragon.mob && !chainBreaking && !t.bird) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const eye = camera.position;
    const mob = pickMob(dir, BIRD_AIM_DIST);
    if (mob && mob.kind === "dragon") {
      const off = getMobHitOffset(eye, dir, mob);
      const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
      const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
      const blockT = Math.hypot(bx + 0.5 - eye.x, by + 0.5 - eye.y, bz + 0.5 - eye.z);
      if (mobT <= blockT + 0.5) {
        const cap = dragonShotsCap();
        const nowI = performance.now() / 1000;
        const freshI = birdLock === mob && nowI - birdLockT < BIRD_LOCK_TIME;
        if (cap > 0 && (freshI ? birdLockShots < cap : !tntTargeted(mob))) {
          t.bird = mob;
          birdLock = mob;
          birdLockT = nowI;
          if (!freshI) birdLockShots = 0;
          birdLockShots++;
        } else aimed = mob;
      }
    }
  }
  if (t.bird) {
    const syncEta = tntSyncOnFire(t.bird, bx + 0.5, by + 1.1, bz + 0.5);
    t.life = Math.max(t.life, syncEta + 0.5);
    setBlock(bx, by, bz, AIR);
    refreshBlocks([[bx, by, bz]]);
    queueSave();
    const m = makeTNTBomb();
    m.position.set(bx + 0.5, by + 1.1, bz + 0.5);
    scene.add(m);
    t.mesh = m;
  } else if (aimed) {
    clearTNTVisual(t);
    fizzleTNT(bx, by, bz);
    return;
  }
  tntLit.set(k, t);
}

let tntFlySeq = 0;
const BIRD_AIM_DIST = 200;
const BIRD_LOCK_TIME = 0.5;
const BIRD_LOCK_BURST_DIST = 30;
let birdLock = null;
let birdLockT = 0;
let birdLockShots = 0;
function aimedBird() {
  if (dim !== "over" && dim !== "end" && dim !== "nether") return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;
  const mob = pickMob(dir, BIRD_AIM_DIST);
  if (!mob) return null;
  if (dim === "end") {
    if (mob.kind === "dragon" || (!isFlyingKind(mob.kind) && !isChained(mob) && !isChainCarrier(mob))) return null;
  } else if (!isFlyingKind(mob.kind) && !isChained(mob) && !isChainCarrier(mob)) return null;
  const off = getMobHitOffset(eye, dir, mob);
  const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
  const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
  if (currentBlock) {
    const blockT = Math.hypot(currentBlock.x + 0.5 - eye.x, currentBlock.y + 0.5 - eye.y, currentBlock.z + 0.5 - eye.z);
    if (mobT > blockT + 0.5) return null;
  }
  return mob;
}
function liveBirdLock() {
  if (birdLock && mobs.includes(birdLock)) return birdLock;
  birdLock = null;
  return null;
}
function tntChainAimMob() {
  if (dim !== "over" && dim !== "end" && dim !== "nether") return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const mob = pickMob(dir, BIRD_AIM_DIST);
  if (!mob || !mobs.includes(mob) || mob.kind === "dragon") return null;
  if (isGroundedChainVictim(mob)) return mob;
  if (liveBirdLock() === mob) return mob;
  if (!isFlyingKind(mob.kind) && tntTargeted(mob)) return mob;
  return null;
}
function aimOnMob() {
  if (!currentBlock) return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;
  const mob = pickMob(dir, BIRD_AIM_DIST);
  if (!mob || !mobs.includes(mob)) return null;
  const off = getMobHitOffset(eye, dir, mob);
  const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
  const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
  const blockT = Math.hypot(currentBlock.x + 0.5 - eye.x, currentBlock.y + 0.5 - eye.y, currentBlock.z + 0.5 - eye.z);
  if (mobT > blockT + 0.5) return null;
  return mob;
}
function tntTargeted(mob) {
  for (const t of tntLit.values()) if (t.bird === mob) return true;
  return false;
}
function dragonShotsCap() {
  if (dim !== "end" || !dragon.mesh || dragon.hp <= 0) return 0;
  return Math.max(1, Math.ceil(dragon.hp / DRAGON_FULL_DMG));
}
function aimedDragon() {
  if (dim !== "end" || !dragon.mesh || !dragon.mob) return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;
  const mob = pickMob(dir, BIRD_AIM_DIST);
  if (!mob || mob.kind !== "dragon") return null;
  const off = getMobHitOffset(eye, dir, mob);
  const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
  const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
  if (currentBlock) {
    const blockT = Math.hypot(currentBlock.x + 0.5 - eye.x, currentBlock.y + 0.5 - eye.y, currentBlock.z + 0.5 - eye.z);
    if (mobT > blockT + 0.5) return null;
  }
  return mob;
}
function tryFireLockedTNT() {
  const now = performance.now() / 1000;
  const mob = aimedBird();
  if (mob) {
    const fresh = birdLock === mob && now - birdLockT < BIRD_LOCK_TIME;
    if (!fresh) {
      if (tntTargeted(mob)) return false;
      birdLock = mob;
      birdLockShots = 0;
    }
    if (birdLockShots >= 3) return false;
    fireTNTAtBird(mob);
    birdLock = mob;
    birdLockT = now;
    birdLockShots++;
    return true;
  }
  const dr = aimedDragon();
  if (dr) {
    const cap = dragonShotsCap();
    if (cap <= 0) return false;
    const fresh = birdLock === dr && now - birdLockT < BIRD_LOCK_TIME;
    if (!fresh) {
      if (tntTargeted(dr)) return false;
      birdLock = dr;
      birdLockShots = 0;
    }
    if (birdLockShots >= cap) return false;
    fireTNTAtBird(dr);
    birdLock = dr;
    birdLockT = now;
    birdLockShots++;
    return true;
  }
  const lock = liveBirdLock();
  if (lock && lock.dim !== undefined && lock.dim !== dim) { birdLock = null; return false; }
  if (lock && now - birdLockT < BIRD_LOCK_TIME) {
    const cap = lock.kind === "dragon" ? dragonShotsCap() : 3;
    if (cap <= 0 || birdLockShots >= cap) return false;
    if (lock.kind === "dragon" && !aimedDragon()) return false;
    let blockT = Infinity;
    if (currentBlock) {
      const eye = camera.position;
      blockT = Math.hypot(currentBlock.x + 0.5 - eye.x, currentBlock.y + 0.5 - eye.y, currentBlock.z + 0.5 - eye.z);
    }
    if (blockT > BIRD_LOCK_BURST_DIST) {
      fireTNTAtBird(lock);
      birdLockT = now;
      birdLockShots++;
      return true;
    }
  }
  return false;
}
function fireTNTAtBird(mob) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;
  const sx = eye.x + dir.x, sy = eye.y + dir.y, sz = eye.z + dir.z;
  const spr = makeFuseSprite();
  spr.position.set(sx, sy + 0.85, sz);
  scene.add(spr);
  const m = makeTNTBomb();
  m.position.set(sx, sy, sz);
  scene.add(m);
  const t = { bx: 0, by: -1, bz: 0, px: sx, py: sy, pz: sz, fuse: FUSE_TIME, life: FUSE_TIME + 2, spr, mesh: m, stuck: false, ax: 0, ay: 0, az: 0, bird: mob };
  t.life = Math.max(t.life, tntSyncOnFire(mob, sx, sy, sz) + 0.5);
  tntLit.set("fly" + (tntFlySeq++), t);
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
  if (t.bird) {
    const m = t.bird;
    if (!mobs.includes(m)) return;
    if (t.stuck) {
      t.px = m.pos.x + t.ax; t.py = m.pos.y + t.ay; t.pz = m.pos.z + t.az;
      return;
    }
    const dx = m.pos.x - t.px, dy = m.pos.y + m.h * 0.5 - t.py, dz = m.pos.z - t.pz;
    const d = Math.hypot(dx, dy, dz);
    if (d <= DRAGON_STICK_DIST) {
      t.stuck = true;
      t.ax = t.px - m.pos.x; t.ay = t.py - m.pos.y; t.az = t.pz - m.pos.z;
      return;
    }
    if (d < 1e-6) return;
    const rem = tntEta.get(m);
    let sp;
    if (rem === undefined) sp = Math.min(d, TNT_HOME_SPEED * 4 * dt);
    else if (!(rem > 1e-3)) sp = d;
    else sp = Math.min(d, ((d - DRAGON_STICK_DIST) / rem) * dt);
    t.px += (dx / d) * sp; t.py += (dy / d) * sp; t.pz += (dz / d) * sp;
    return;
  }
}

function tickTNT(dt) {
  for (const [mob, v] of [...tntEta]) {
    let live = false;
    for (const t of tntLit.values()) if (t.bird === mob && t.mesh && !t.stuck) { live = true; break; }
    if (!live) tntEta.delete(mob);
    else tntEta.set(mob, v - dt);
  }
  for (const [k, t] of [...tntLit]) {
    updateTNTTarget(t, dt);
    t.spr.position.set(t.px, t.py + 0.85, t.pz);
    if (t.mesh) {
      t.mesh.position.set(t.px, t.py, t.pz);
      if (t.stuck) {
        clearTNTVisual(t);
        tntLit.delete(k);
        tntSyncClear(t.bird);
        const v = t.bird;
        const victimChained = v && v.kind !== "dragon" && (!isFlyingKind(v.kind) || isChained(v) || isChainCarrier(v));
        const downstream = victimChained && mobs.includes(v) ? chainDownstreamOf(v) : null;
        const frontId = victimChained && mobs.includes(v) ? chainParent.get(v.id) : undefined;
        const front = frontId !== undefined && frontId !== PLAYER_CHAIN_ID ? mobById.get(frontId) : null;
        if (victimChained && mobs.includes(v) && isGroundedChainVictim(v)) {
          severGroundedChainVictim(v, k);
          explodeBird(t.px, t.py, t.pz, true);
        } else {
          if (victimChained && mobs.includes(v)) {
            if (isFlyingKind(v.kind)) killChainMob(v);
            else unchainMob(v, k);
          }
          else {
            const isBirdBomb = t.bird && isFlyingKind(t.bird.kind) && t.bird.kind !== "dragon";
            if (isBirdBomb && mobs.includes(t.bird)) killBird(t.bird);
          }
          if (t.bird && t.bird.kind !== "dragon") explodeBird(t.px, t.py, t.pz, true);
          else enqueueExplosion(t.px, t.py, t.pz, true, true);
        }
        if (downstream) for (const d of downstream) panicSingleMob(d, t.px, t.py, t.pz);
        if (front) panicSingleMob(front, t.px, t.py, t.pz);
      } else if (t.bird) {
        const v = t.bird;
        const victimChained = v.kind !== "dragon" && (!isFlyingKind(v.kind) || isChained(v) || isChainCarrier(v));
        const downstream = victimChained && mobs.includes(v) ? chainDownstreamOf(v) : null;
        const frontId = victimChained && mobs.includes(v) ? chainParent.get(v.id) : undefined;
        const front = frontId !== undefined && frontId !== PLAYER_CHAIN_ID ? mobById.get(frontId) : null;
        if (!mobs.includes(v) || (t.life -= dt) <= 0) {
          clearTNTVisual(t);
          tntLit.delete(k);
          tntSyncClear(v);
          if (victimChained && mobs.includes(v) && isGroundedChainVictim(v)) {
            severGroundedChainVictim(v, k);
            explodeBird(t.px, t.py, t.pz, false);
          } else {
            if (victimChained && mobs.includes(v)) {
              if (isFlyingKind(v.kind)) killChainMob(v);
              else unchainMob(v, k);
            }
            if (v.kind === "dragon") enqueueExplosion(t.px, t.py, t.pz, false, true);
            else explodeBird(t.px, t.py, t.pz, false);
          }
          if (downstream) for (const d of downstream) panicSingleMob(d, t.px, t.py, t.pz);
          if (front) panicSingleMob(front, t.px, t.py, t.pz);
        } else {
          drawFuseSprite(t.spr, Math.max(0, t.life));
        }
      } else if (!dragon.mesh) {
        clearTNTVisual(t);
        tntLit.delete(k);
      } else if ((t.life -= dt) <= 0) {
        clearTNTVisual(t);
        tntLit.delete(k);
        enqueueExplosion(t.px, t.py, t.pz, false, true);
      }
      continue;
    }
    t.fuse -= dt;
    if (t.fuse <= 0) {
      clearTNTVisual(t);
      tntLit.delete(k);
      enqueueExplosion(t.bx, t.by, t.bz, t.stuck, false);
    } else {
      drawFuseSprite(t.spr, t.fuse);
    }
  }
}

const CHAIN_DELAY = 50;
function enqueueExplosion(x, y, z, pointBlank, homing = false, delay = 0) {
  const due = delay ? performance.now() + delay : 0;
  explosionQueue.push({ x, y, z, pointBlank, homing, due });
}
function explodeTNT(x, y, z, pointBlank, homing = false) {
  enqueueExplosion(x, y, z, pointBlank, homing);
}
function explodeBird(x, y, z, pointBlank) {
  explosionQueue.push({ x, y, z, pointBlank, homing: true, due: 0, bird: true });
}
function processExplosionQueue() {
  if (!explosionQueue.length) return;
  const t0 = performance.now();
  let processed = 0;
  refreshDefer = [];
  glowDefer++;
  const batchKeys = new Set();
  while (explosionQueue.length && processed < explosionsPerFrame && (performance.now() - t0) < explosionBudgetMs) {
    const peek = explosionQueue[0];
    if (peek.due && peek.due > performance.now()) break;
    const { x, y, z, pointBlank, homing, bird } = explosionQueue.shift();
    const kShift = key(Math.floor(x), Math.floor(y), Math.floor(z));
    if (chainPending.has(kShift)) chainPending.delete(kShift);
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    let brokePine = false;
    const dragonHit = dim === "end" && dragon.mesh && homing && pointBlank && !bird;
    if (dragonHit) damageDragon(DRAGON_FULL_DMG);
    if (bird) spawnBirdBurst(cx, cy, cz);
    else if (pointBlank && dragonHit) spawnDragonBurst(cx, cy, cz, dragonBurstColor());
    else if (pointBlank) spawnDragonBurst(cx, cy, cz);
    else spawnExplosion(cx, cy, cz);
    if (mobs.length) handleMobExplosion(cx, cy, cz);
    if (homing) { processed++; continue; }
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const k0 = key(bx, by, bz);
    if (!protectedBlocks.has(dim + ":" + k0) && !batchKeys.has(k0)) {
      const id0 = getBlock(bx, by, bz);
      if (id0 === TNT || (!isMobStandingOn(bx, by, bz) && !intersectsMob(bx, by, bz))) {
        if (id0 !== WATER && id0 !== LAVA && !((id0 === STONE || id0 === NETHERRACK) && by === 0)) {
          if ((id0 === LOG || id0 === LEAVES) && pineCellAt(bx, by, bz)) brokePine = true;
          batchKeys.add(k0);
          setBlock(bx, by, bz, AIR);
          refreshDefer.push([bx, by, bz]);
        }
      }
    }
    const R = BLAST_RADIUS, R2 = R * R;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      const gx = bx + dx, gy = by + dy, gz = bz + dz;
      if (gy < 0 || gy > MAX_Y) continue;
      if (gx < -WORLD_RADIUS || gx > WORLD_RADIUS || gz < -WORLD_RADIUS || gz > WORLD_RADIUS) continue;
      const kk = key(gx, gy, gz);
      if (batchKeys.has(kk)) continue;
      const id = getBlock(gx, gy, gz);
      if (id !== TNT && (isMobStandingOn(gx, gy, gz) || intersectsMob(gx, gy, gz))) continue;
      if (id === AIR || id === WATER || id === LAVA) continue;
      if ((id === STONE || id === NETHERRACK) && gy === 0) continue;
      if (protectedBlocks.has(dim + ":" + kk)) continue;
      if (id === TNT) {
        if (tntLit.has(kk)) {
          const lt = tntLit.get(kk);
          if (!lt.mesh) {
            if (chainPending.has(kk)) continue;
            clearTNTVisual(lt);
            tntLit.delete(kk);
            chainPending.add(kk);
            enqueueExplosion(gx, gy, gz, lt.stuck, false, CHAIN_DELAY);
          }
        } else {
          if (chainPending.has(kk)) continue;
          chainPending.add(kk);
          enqueueExplosion(gx, gy, gz, false, false, CHAIN_DELAY);
        }
        continue;
      }
      batchKeys.add(kk);
      const blastPineOwner = (id === LOG || id === LEAVES) ? pineAt(gx, gy, gz) : null;
      if (blastPineOwner) {
        brokePine = true;
        const bk = key(blastPineOwner.x, blastPineOwner.y, blastPineOwner.z) + "|" + gx + "," + gy + "," + gz;
        brokenPineCells.add(bk);
      }
      setBlock(gx, gy, gz, AIR);
      refreshDefer.push([gx, gy, gz]);
    }
    if (brokePine) cullSmallChainsNear(bx, by, bz, 3, 8);
    processed++;
  }
  glowDefer--;
  if (glowDefer === 0 && glowDirtyDeferred) { glowDirtyDeferred = false; recomputeGlowClusters(); syncGlowLights(); }
  const toRefresh = refreshDefer;
  refreshDefer = null;
  if (toRefresh.length) {
    refreshBlocks(toRefresh);
    if (plantedPines.size) garlandDirty = true;
    queueSave();
  }
}

function spawnDragonDeath(cx, cy, cz) {
  const SPECTRUM_BURST = [0x6e2a92, 0x1a5eb8, 0x188844, 0xd8a818, 0xc82828, 0xffffff];
  const pickBurst = () => SPECTRUM_BURST[(Math.random() * SPECTRUM_BURST.length) | 0];
  const N = 420;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    const c = pickBurst();
    colA[i * 3] = Math.min(1.15, ((c >> 16) & 255) / 255 + (Math.random() - 0.5) * 0.2);
    colA[i * 3 + 1] = Math.min(1.15, ((c >> 8) & 255) / 255 + (Math.random() - 0.5) * 0.2);
    colA[i * 3 + 2] = Math.min(1.15, (c & 255) / 255 + (Math.random() - 0.5) * 0.2);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 9 + Math.random() * 24;
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
  bursts.push({ pts, geo, mat, vel, life: 2.0, max: 2.0, tag: 3, fx: cx, fy: cy, fz: cz });

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
  bursts.push({ pts: ptsB, geo: geoB, mat: matB, vel: velB, life: 1.2, max: 1.2, tag: 3, fx: cx, fy: cy, fz: cz });
}

function dragonBurstColor() {
  return DRAGON_HUES[Math.max(0, dragon.hitCount - 1) % DRAGON_HUES.length];
}
function spawnDragonBurst(cx, cy, cz, hex = 0xd06bff) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 14, 10),
    new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9 })
  );
  flash.position.set(cx, cy, cz);
  scene.add(flash);
  flashes.push({ mesh: flash, born: performance.now(), life: 0.35 });

  const N = 96;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const br = ((hex >> 16) & 255) / 255, bg = ((hex >> 8) & 255) / 255, bb = (hex & 255) / 255;
  const jit = () => (Math.random() - 0.5) * 0.24;
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    colA[i * 3] = Math.min(1.15, Math.max(0, br + jit()));
    colA[i * 3 + 1] = Math.min(1.15, Math.max(0, bg + jit()));
    colA[i * 3 + 2] = Math.min(1.15, Math.max(0, bb + jit()));
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
  bursts.push({ pts, geo, mat, vel, life: 1.1, max: 1.1, tag: 2, fx: cx, fy: cy, fz: cz, hex });
}

function spawnBirdBurst(cx, cy, cz) {
  const N = 96;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    const pick = Math.random();
    if (pick < 0.4) {
      colA[i * 3] = 0.9 + Math.random() * 0.1;
      colA[i * 3 + 1] = 0.08 + Math.random() * 0.1;
      colA[i * 3 + 2] = 0.05 + Math.random() * 0.07;
    } else if (pick < 0.7) {
      colA[i * 3] = 1;
      colA[i * 3 + 1] = 0.45 + Math.random() * 0.15;
      colA[i * 3 + 2] = 0.05 + Math.random() * 0.07;
    } else {
      colA[i * 3] = 1;
      colA[i * 3 + 1] = 0.8 + Math.random() * 0.15;
      colA[i * 3 + 2] = 0.15 + Math.random() * 0.15;
    }
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
    size: 0.5, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 1.1, max: 1.1, tag: 1, fx: cx, fy: cy, fz: cz });
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
  bursts.push({ pts, geo, mat, vel, life: 0.8, max: 0.8, tag: 0, fx: cx, fy: cy, fz: cz });
}

function tickEffects(dt, active) {
  if (performance.now() / 1000 < garlandRevealUntil) garlandDirty = true;
  if (garlandDirty) { rebuildGarlands(); rebuildStars(); }
  else { garlandTick(dt); starTick(dt, active); }
  updateNetherEmbers(dt, performance.now() / 1000);
  updateVolcanoEmbers(dt, performance.now() / 1000);
  updateLavaMotes(dt, performance.now() / 1000);
  updateMoonSnow(dt, performance.now() / 1000);
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
    colA[i * 3] = 0.85 + Math.random() * 0.15; colA[i * 3 + 1] = 0.9 + Math.random() * 0.1; colA[i * 3 + 2] = 1;
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

// Lava motes: camera-local ember sparks visible while submerged in lava.
// World-space embers are fully fogged out inside the murk, so this field
// rides with the camera and is gated on the eye cell holding lava. Small
// points in declinations of blue fill the visible range into the fog;
// white is reserved for the exterior embers above the surface.
const LAVA_MOTE_COUNT = 900;
const LAVA_MOTE_RANGE = 15;
const LAVA_MOTE_BLUES = [
  [0.10, 0.30, 1.0],
  [0.25, 0.50, 1.0],
  [0.45, 0.85, 1.0],
];
let lavaMotes = null;

function seedLavaMote(cloud, i) {
  const e = camera.position;
  const R = cloud.range;
  const posA = cloud.pts.geometry.attributes.position.array;
  posA[i * 3] = e.x + (Math.random() * 2 - 1) * R;
  posA[i * 3 + 1] = e.y + (Math.random() * 2 - 1) * R;
  posA[i * 3 + 2] = e.z + (Math.random() * 2 - 1) * R;
  cloud.vel[i * 3] = (Math.random() * 2 - 1) * 0.4;
  cloud.vel[i * 3 + 1] = 0.5 + Math.random() * 1.0;
  cloud.vel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.4;
}

function makeLavaMoteCloud(count, range, size, bright) {
  const posA = new Float32Array(count * 3);
  const colA = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, opacity: 1, fog: false,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.visible = false;
  pts.frustumCulled = false;
  scene.add(pts);
  const cloud = { pts, vel, count, range };
  for (let i = 0; i < count; i++) {
    seedLavaMote(cloud, i);
    const b = LAVA_MOTE_BLUES[(Math.random() * LAVA_MOTE_BLUES.length) | 0];
    colA[i * 3] = b[0] * bright;
    colA[i * 3 + 1] = b[1] * bright;
    colA[i * 3 + 2] = b[2] * bright;
  }
  return cloud;
}

function ensureLavaMotes() {
  if (!lavaMotes) lavaMotes = makeLavaMoteCloud(LAVA_MOTE_COUNT, LAVA_MOTE_RANGE, 0.07, 0.55);
}

function stepLavaMotes(cloud, dt, time) {
  const e = camera.position;
  const attr = cloud.pts.geometry.attributes.position;
  const R = cloud.range;
  for (let i = 0; i < cloud.count; i++) {
    let x = attr.array[i * 3] + (cloud.vel[i * 3] + Math.sin(time * 2 + i) * 0.3) * dt;
    let y = attr.array[i * 3 + 1] + cloud.vel[i * 3 + 1] * dt;
    let z = attr.array[i * 3 + 2] + (cloud.vel[i * 3 + 2] + Math.cos(time * 1.7 + i) * 0.3) * dt;
    if (x - e.x > R) x -= 2 * R; else if (x - e.x < -R) x += 2 * R;
    if (y - e.y > R) y -= 2 * R; else if (y - e.y < -R) y += 2 * R;
    if (z - e.z > R) z -= 2 * R; else if (z - e.z < -R) z += 2 * R;
    if (getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== LAVA) {
      seedLavaMote(cloud, i);
      continue;
    }
    attr.array[i * 3] = x;
    attr.array[i * 3 + 1] = y;
    attr.array[i * 3 + 2] = z;
  }
  attr.needsUpdate = true;
}

function updateLavaMotes(dt, time) {
  ensureLavaMotes();
  const e = camera.position;
  const inside = eyeLiquidId(e.x, e.y, e.z) === LAVA;
  lavaMotes.pts.visible = inside;
  if (!inside) return;
  stepLavaMotes(lavaMotes, dt, time);
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
    colA[i * 3] = 0.85 + Math.random() * 0.15; colA[i * 3 + 1] = 0.9 + Math.random() * 0.1; colA[i * 3 + 2] = 1;
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

// Moon snow: white flakes falling from the sky anywhere in the Overworld above
// moon-surface altitude. Camera-following Points field like the ember systems:
// flakes fill the whole column from above the camera down to the ground, wrap
// around the camera in XZ so flight never leaves them behind, and vanish on
// landing before respawning at the top. Cheap by design: integration runs at
// 30 Hz (invisible at these fall speeds), sway reads a precomputed sine table,
// and landing heights are cached per flake (one typed-array read, refreshed
// staggered plus on wrap) with a single getBlock confirm only near the ground,
// instead of trig plus a Map lookup per flake per frame.
const MOON_SNOW_COUNT = 700;
const MOON_SNOW_RANGE = 36;
const MOON_SNOW_SIZE = 0.18;
const MOON_SNOW_STEP = 1 / 30;
let moonSnowPts = null;
let moonSnowVel = null;
let moonSnowGround = null;
let moonSnowAcc = 0;
let moonSnowTick = 0;
const MOON_SNOW_SIN = new Float32Array(256);
for (let i = 0; i < 256; i++) MOON_SNOW_SIN[i] = Math.sin(i / 256 * Math.PI * 2);

function moonSnowLandY(bx, bz) {
  if (bx < -KEY_OFF || bx >= KEY_OFF || bz < -KEY_OFF || bz >= KEY_OFF) return MOON_Y;
  const ct = colTops.over[colTopIdx(bx, bz)];
  return ct > MOON_Y ? ct : MOON_Y;
}

function isMoonSnowActive() {
  if (dim !== "over") return false;
  return camera.position.y >= MOON_Y - 8;
}

function ensureMoonSnow() {
  if (moonSnowPts) return;
  const posA = new Float32Array(MOON_SNOW_COUNT * 3);
  for (let i = 0; i < MOON_SNOW_COUNT; i++) {
    posA[i * 3] = 0; posA[i * 3 + 1] = -100; posA[i * 3 + 2] = 0;
  }
  moonSnowVel = new Float32Array(MOON_SNOW_COUNT * 3);
  moonSnowGround = new Float32Array(MOON_SNOW_COUNT);
  moonSnowAcc = 0;
  moonSnowTick = 0;
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posA, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: MOON_SNOW_SIZE, transparent: true, opacity: 0.9,
    depthWrite: false, fog: false,
  });
  moonSnowPts = new THREE.Points(geo, mat);
  moonSnowPts.frustumCulled = false;
  scene.add(moonSnowPts);
  for (let i = 0; i < MOON_SNOW_COUNT; i++) spawnMoonSnow(i, true);
}

function removeMoonSnow() {
  if (moonSnowPts) {
    scene.remove(moonSnowPts);
    moonSnowPts.geometry.dispose();
    moonSnowPts.material.dispose();
    moonSnowPts = null;
    moonSnowVel = null;
    moonSnowGround = null;
    moonSnowAcc = 0;
  }
}

function spawnMoonSnow(i, initial = false) {
  const e = camera.position;
  const attr = moonSnowPts.geometry.attributes.position;
  const top = Math.min(MAX_Y - 1, e.y + 8 + Math.random() * 14);
  attr.array[i * 3] = e.x + (Math.random() * 2 - 1) * MOON_SNOW_RANGE;
  attr.array[i * 3 + 1] = initial
    ? Math.min(top, MOON_Y + 1 + Math.random() * Math.max(1, top - MOON_Y - 1))
    : top;
  attr.array[i * 3 + 2] = e.z + (Math.random() * 2 - 1) * MOON_SNOW_RANGE;
  moonSnowVel[i * 3] = (Math.random() * 2 - 1) * 0.5;
  moonSnowVel[i * 3 + 1] = 2.5 + Math.random() * 3;
  moonSnowVel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.5;
  moonSnowGround[i] = moonSnowLandY(Math.floor(attr.array[i * 3]), Math.floor(attr.array[i * 3 + 2]));
}

function updateMoonSnow(dt, time) {
  if (!isMoonSnowActive()) { removeMoonSnow(); return; }
  ensureMoonSnow();
  moonSnowAcc += dt;
  if (moonSnowAcc < MOON_SNOW_STEP) return;
  const step = moonSnowAcc;
  moonSnowAcc = 0;
  const tick = ++moonSnowTick;
  const phase = (time * 19) | 0;
  const e = camera.position;
  const attr = moonSnowPts.geometry.attributes.position;
  for (let i = 0; i < MOON_SNOW_COUNT; i++) {
    const swayX = MOON_SNOW_SIN[(phase + i * 7) & 255] * 0.5;
    const swayZ = MOON_SNOW_SIN[(phase + i * 13 + 64) & 255] * 0.5;
    let x = attr.array[i * 3] + (moonSnowVel[i * 3] + swayX) * step;
    let y = attr.array[i * 3 + 1] - moonSnowVel[i * 3 + 1] * step;
    let z = attr.array[i * 3 + 2] + (moonSnowVel[i * 3 + 2] + swayZ) * step;
    let wrapped = false;
    if (x - e.x > MOON_SNOW_RANGE) { x -= 2 * MOON_SNOW_RANGE; wrapped = true; }
    else if (x - e.x < -MOON_SNOW_RANGE) { x += 2 * MOON_SNOW_RANGE; wrapped = true; }
    if (z - e.z > MOON_SNOW_RANGE) { z -= 2 * MOON_SNOW_RANGE; wrapped = true; }
    else if (z - e.z < -MOON_SNOW_RANGE) { z += 2 * MOON_SNOW_RANGE; wrapped = true; }
    if (y > e.y + 24) { spawnMoonSnow(i); continue; }
    let landY = moonSnowGround[i];
    if (wrapped || (i & 3) === (tick & 3)) {
      landY = moonSnowLandY(Math.floor(x), Math.floor(z));
      moonSnowGround[i] = landY;
    }
    if (y <= landY + 2 && (y <= MOON_Y || getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== AIR)) {
      spawnMoonSnow(i);
      continue;
    }
    attr.array[i * 3] = x;
    attr.array[i * 3 + 1] = y;
    attr.array[i * 3 + 2] = z;
  }
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Portals & The End dimension
// ---------------------------------------------------------------------------
let portalCd = 0;
let overPortalSpawn = { x: 0.5, y: 1.01, z: 0.5 };
let overPortalFace = null;
let overPortalWin = null;
let overPortalDir = null;
const END_SPAWN = { x: 0.5, y: END_PLATFORM_TOP + 1.6, z: END_RETURN_Z - 3 };
const END_RETURN_BASE_Y = END_PLATFORM_TOP + 1;
const protectedBlocks = new Set();
const protKey = (x, y, z) => dim + ":" + key(x, y, z);
let endCleared = false;
let dormantMsgAt = 0;

function buildReturnPortal(skipMesh = false) {
  purgeProtectedForDim("end");
  const coords = [];
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 4; y++) {
      const isCorner = (x === -2 && (y === 0 || y === 4)) || (x === 2 && (y === 0 || y === 4));
      const isEdge = x === -2 || x === 2 || y === 0 || y === 4;
      if (isEdge && !isCorner) {
        setBlock(x, END_RETURN_BASE_Y + y, END_RETURN_Z, PORTAL);
        coords.push([x, END_RETURN_BASE_Y + y, END_RETURN_Z]);
        protectedBlocks.add(protKey(x, END_RETURN_BASE_Y + y, END_RETURN_Z));
      }
    }
  for (let x = -END_PLATFORM_R; x <= END_PLATFORM_R; x++)
    for (let z = -END_PLATFORM_R; z <= END_PLATFORM_R; z++)
      for (let y = END_PLATFORM_TOP; y <= END_PLATFORM_TOP; y++)
        protectedBlocks.add(protKey(x, y, z));
  endReturnWin = { orient: "v", minX: -2, minY: END_RETURN_BASE_Y, minZ: END_RETURN_Z };
  if (!skipMesh) refreshBlocks(coords);
}

const NETHER_RETURN_BASE_Y = 30;
const NETHER_RETURN_Z = 0;
let netReturnWin = null;
const NETHER_SPAWN = { x: 0.5, y: NETHER_RETURN_BASE_Y + 1.01, z: 1.5 };

function buildNetherPortal(skipMesh = false) {
  purgeProtectedForDim("nether");
  const coords = [];
  const base = NETHER_RETURN_BASE_Y;
  for (let x = -5; x <= 5; x++)
    for (let z = -4; z <= 4; z++)
      for (let y = base - 2; y < base; y++) setBlock(x, y, z, NETHERRACK);
  for (let x = -5; x <= 5; x++)
    for (let z = -4; z <= 4; z++)
      for (let y = base - 2; y < base; y++) protectedBlocks.add(protKey(x, y, z));
  for (let x = -5; x <= 5; x++)
    for (let z = -4; z <= 4; z++)
      for (let y = base; y <= base + 4; y++)
        if (worlds.nether.has(key(x, y, z))) worlds.nether.delete(key(x, y, z));
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 3; y++) {
      const isEdge = x === -2 || x === 2 || y === 0 || y === 3;
      if (!isEdge) continue;
      setBlock(x, base + y, NETHER_RETURN_Z, OBSIDIAN);
      coords.push([x, base + y, NETHER_RETURN_Z]);
      protectedBlocks.add(protKey(x, base + y, NETHER_RETURN_Z));
    }
  netReturnWin = { minX: -2, minY: base, minZ: NETHER_RETURN_Z };
  if (!skipMesh) refreshBlocks(coords);
}

function returnPortalFrameMissing() {
  const w = worlds.end;
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 4; y++) {
      const isCorner = (x === -2 && (y === 0 || y === 4)) || (x === 2 && (y === 0 || y === 4));
      const isEdge = x === -2 || x === 2 || y === 0 || y === 4;
      if (isEdge && !isCorner && w.get(key(x, END_RETURN_BASE_Y + y, END_RETURN_Z)) !== PORTAL) return true;
    }
  return false;
}

function ensureReturnPortal() {
  if (worlds.end.size && !returnPortalFrameMissing()) {
    endReturnWin = { orient: "v", minX: -2, minY: END_RETURN_BASE_Y, minZ: END_RETURN_Z };
    const coords = [];
    for (let x = -2; x <= 2; x++)
      for (let y = 0; y <= 4; y++) {
        const isCorner = (x === -2 && (y === 0 || y === 4)) || (x === 2 && (y === 0 || y === 4));
        const isEdge = x === -2 || x === 2 || y === 0 || y === 4;
        if (isEdge && !isCorner) {
          protectedBlocks.add("end:" + key(x, END_RETURN_BASE_Y + y, END_RETURN_Z));
          coords.push([x, END_RETURN_BASE_Y + y, END_RETURN_Z]);
        }
      }
    for (let x = -END_PLATFORM_R; x <= END_PLATFORM_R; x++)
      for (let z = -END_PLATFORM_R; z <= END_PLATFORM_R; z++)
        protectedBlocks.add("end:" + key(x, END_PLATFORM_TOP, z));
    return;
  }
  buildReturnPortal();
}

function netherPortalFrameMissing() {
  const w = worlds.nether;
  const base = NETHER_RETURN_BASE_Y;
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 3; y++) {
      const isEdge = x === -2 || x === 2 || y === 0 || y === 3;
      if (isEdge && w.get(key(x, base + y, NETHER_RETURN_Z)) !== OBSIDIAN) return true;
    }
  return false;
}

function ensureNetherPortal() {
  if (worlds.nether.size && !netherPortalFrameMissing()) {
    const base = NETHER_RETURN_BASE_Y;
    for (let x = -2; x <= 2; x++)
      for (let y = 0; y <= 3; y++) {
        const isEdge = x === -2 || x === 2 || y === 0 || y === 3;
        if (isEdge) protectedBlocks.add("nether:" + key(x, base + y, NETHER_RETURN_Z));
      }
    for (let x = -5; x <= 5; x++)
      for (let z = -4; z <= 4; z++)
        for (let y = base - 2; y < base; y++) protectedBlocks.add("nether:" + key(x, y, z));
    netReturnWin = { minX: -2, minY: base, minZ: NETHER_RETURN_Z };
    return;
  }
  buildNetherPortal();
}

function setDimensionEnv() {
  if (dim === "end") {
    skyDome.visible = false;
    skyStars.visible = false;
    scene.background.setHex(0x000000);
    scene.fog.color.setHex(0x000000);
    scene.fog.near = 30; scene.fog.far = 150;
    envFogNear = 30; envFogFar = 150;
    sun.color.setHex(0xfff5e0); sun.intensity = 0.35;
    hemi.color.setHex(0xbfd4ff); hemi.intensity = 0.45;
  } else if (dim === "nether") {
    skyDome.visible = true;
    skyStars.visible = false;
    scene.background.setHex(0x111114);
    scene.fog.color.setHex(0x1c1c21);
    scene.fog.near = 20; scene.fog.far = 110;
    envFogNear = 20; envFogFar = 110;
    sun.color.setHex(0xe8e8ea); sun.intensity = 0.6;
    hemi.color.setHex(0x85858c); hemi.intensity = 0.55;
  } else {
    skyDome.visible = false;
    scene.background.setHex(0x87ceeb);
    scene.fog.color.setHex(0x87ceeb);
    scene.fog.near = 60; scene.fog.far = 160;
    envFogNear = 60; envFogFar = 160;
    sun.color.setHex(0xfff5e0); sun.intensity = 1.1;
    hemi.color.setHex(0xbfd4ff); hemi.intensity = 0.75;
  }
  envBackground.copy(scene.background);
  envFogColor.copy(scene.fog.color);
  underSubSmooth = 0;
  underTintId = WATER;
}

function suspendLiveDim() {
  if (carryGrappleActive || carryGrapplePulling || carryGrappleRetracting) {
    if (carryGrappleMode === "release" && carryGrappleMob && !carryMob) {
      carryMob = carryGrappleMob;
      carryMob.mode = "carried";
      setMobTransparent(carryMob, 0.35);
      playerArms.visible = true;
    }
    carryGrappleActive = false;
    carryGrapplePulling = false;
    carryGrappleRetracting = false;
    carryGrappleMob = null;
    carryGrappleBlock = null;
    if (carryGrappleCubes) carryGrappleCubes.visible = false;
    if (carryGrappleHead) carryGrappleHead.visible = false;
  }
  if (dim === "over") {
    overworldMobCache = snapshotMobsForDim("over", false);
    stripPanicEntries(overworldMobCache);
    pendingChainLinks = snapshotChainPairsForDim("over", overworldMobCache);
  } else if (dim === "end") {
    endMobCache = snapshotMobsForDim("end", false);
    stripPanicEntries(endMobCache);
    pendingChainLinksEnd = snapshotChainPairsForDim("end", endMobCache);
  } else if (dim === "nether") {
    netherMobCache = snapshotMobsForDim("nether", false);
    stripPanicEntries(netherMobCache);
    pendingChainLinksNether = snapshotChainPairsForDim("nether", netherMobCache);
  }
  for (const m of mobs) if (mobDimOf(m) === dim) clearMobPanic(m);
  purgeDimMobs(dim, true);
  villagePanicUntil = 0;
  pendingCarriedIdx = null;
}

function goToDimension(name, sx, sy, sz) {
  suspendLiveDim();
  purgeLiveTNT();
  birdLock = null; birdLockT = 0; birdLockShots = 0;
  clearChains();
  if (playerInChain()) detachDisplacementGrapple();
  if (grappleFill) {
    grappleActive = false;
    grapplePulling = false;
    grappleRetracting = false;
    grappleArrived = false;
    grappleFill = null;
    if (grappleCubes) grappleCubes.visible = false;
    if (grappleHead) grappleHead.visible = false;
  }
  dim = name;
  world = worlds[name];
  clearGlowLights();
  rebuildHotbar();
  portalDirty = true;
  worldDirty = true;
  clearPortalFills();
  if (!villageHouses.length) computeVillageLayout();
  const liveCount = (d) => mobs.filter((m) => mobDimOf(m) === d && m.kind !== "dragon").length;
  for (const m of mobs) m.mesh.visible = (mobDimOf(m) === dim) || m === carryMob || m === carryGrappleMob;
  for (const m of mobs) if (mobDimOf(m) === dim) clearMobPanic(m);
  villagePanicUntil = 0;
  if (name === "end") {
    if (!worlds.end.size) {
      generateEnd();
      endCleared = false;
      buildReturnPortal();
    } else {
      removeDragon();
      endCleared = false;
      ensureReturnPortal();
    }
    spawnDragon();
    spawnEndermen();
    const arr = resolveDimArrival(endExit, { spot: { x: END_SPAWN.x, y: END_SPAWN.y, z: END_SPAWN.z }, yaw: 0 });
    sx = arr.spot.x; sy = arr.spot.y; sz = arr.spot.z;
    setDimensionEnv();
    yaw = arr.yaw;
    pitch = 0;
    if (endMobCache && endMobCache.length) {
      const saved = endMobCache;
      endMobCache = null;
      const pairs = pendingChainLinksEnd;
      pendingChainLinksEnd = null;
      const res = restoreDimMobs(saved, "end", { topUp: false });
      relinkDimChainsByIds(res.ids, pairs);
    } else pendingChainLinksEnd = null;
  } else if (name === "nether") {
    if (!worlds.nether.size) {
      generateNether();
      buildNetherPortal();
    } else {
      ensureNetherPortal();
    }
    const arr = resolveDimArrival(netherExit, { spot: { x: NETHER_SPAWN.x, y: NETHER_SPAWN.y, z: NETHER_SPAWN.z }, yaw: Math.PI });
    sx = arr.spot.x; sy = arr.spot.y; sz = arr.spot.z;
    setDimensionEnv();
    yaw = arr.yaw;
    pitch = 0;
    if (netherMobCache && netherMobCache.length) {
      const saved = netherMobCache;
      netherMobCache = null;
      const pairs = pendingChainLinksNether;
      pendingChainLinksNether = null;
      const res = restoreDimMobs(saved, "nether", { topUp: false });
      relinkDimChainsByIds(res.ids, pairs);
    } else pendingChainLinksNether = null;
  } else {
    setDimensionEnv();
    const liveOver = liveCount("over");
    if (overworldMobCache && overworldMobCache.length) {
      const saved = overworldMobCache;
      overworldMobCache = null;
      if (!restoreOverworldMobs(saved, { keepCarried: true, topUp: false })) spawnVillagers();
    } else {
      pendingChainLinks = null;
      if (!liveOver) spawnVillagers();
    }
    pendingCarriedIdx = null;
    const ret = resolveOverworldReturn();
    yaw = ret.yaw;
    sx = ret.spot.x; sy = ret.spot.y; sz = ret.spot.z;
  }
  for (const m of mobs) m.mesh.visible = (mobDimOf(m) === dim) || m === carryMob || m === carryGrappleMob;
  Object.keys(keys).forEach((k) => { keys[k] = false; });
  pos.set(sx, freeCam ? sy + EYE : sy, sz);
  camPos.set(sx, freeCam ? sy + EYE : sy, sz);
  vel.set(0, 0, 0);
  rebuildMeshes();
  scanWorldPortals();
  garlandDirty = true;
  recomputeGlowClusters();
  syncGlowLights();
  if (freeCam) { camera.position.copy(camPos); camera.rotation.set(pitch, yaw, 0); }
  else updateCamera();
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
const portalFillGeo = new THREE.BoxGeometry(1, 1, 1);
const portalFillMatBlack = new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const portalFillMatPurple = new THREE.MeshBasicMaterial({ color: 0x9b30ff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

function portalFillCells(win, nether) {
  const cells = [];
  const push = (x, y, z) => cells.push([x, y, z]);
  if (win.orient === "v") {
    if (nether) {
      if (win.face === "x") {
        const cy = { "4x5": 3, "4x4": 2 }[win.dims] || 2;
        const cz = win.dims === "4x5" || win.dims === "4x4" ? 2 : 3;
        for (let y = win.minY + 1; y <= win.minY + cy; y++)
          for (let z = win.minZ + 1; z <= win.minZ + cz; z++) push(win.minX, y, z);
      } else if (win.dims === "4x5") {
        for (let y = win.minY + 1; y <= win.minY + 3; y++)
          for (let x = win.minX + 1; x <= win.minX + 2; x++) push(x, y, win.minZ);
      } else if (win.dims === "4x4") {
        for (let y = win.minY + 1; y <= win.minY + 2; y++)
          for (let x = win.minX + 1; x <= win.minX + 2; x++) push(x, y, win.minZ);
      } else {
        for (let y = win.minY + 1; y <= win.minY + 2; y++)
          for (let x = win.minX + 1; x <= win.minX + 3; x++) push(x, y, win.minZ);
      }
    } else {
      const top = win.h === 4 ? win.minY + 2 : win.minY + 3;
      if (win.face === "x") {
        for (let y = win.minY + 1; y <= top; y++)
          for (let z = win.minZ + 1; z <= win.minZ + 3; z++) push(win.minX, y, z);
      } else {
        for (let y = win.minY + 1; y <= top; y++)
          for (let x = win.minX + 1; x <= win.minX + 3; x++) push(x, y, win.minZ);
      }
    }
  } else {
    if (nether) {
      const xw = win.dims === "4x5" ? 2 : 3;
      const xt = win.dims === "4x5" ? 3 : 2;
      for (let x = win.minX + 1; x <= win.minX + xw; x++)
        for (let z = win.minZ + 1; z <= win.minZ + xt; z++) push(x, win.minY, z);
    } else {
      for (let x = win.minX + 1; x <= win.minX + 3; x++)
        for (let z = win.minZ + 1; z <= win.minZ + 3; z++) push(x, win.minY, z);
    }
  }
  return cells;
}

function portalFillBox(win, nether) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [x, y, z] of portalFillCells(win, nether)) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
  if (win.orient === "h") return { cx, cy, cz, sx: (x1 - x0 + 1), sy: 1, sz: (z1 - z0 + 1) };
  if (win.face === "x") return { cx, cy, cz, sx: 1, sy: (y1 - y0 + 1), sz: (z1 - z0 + 1) };
  return { cx, cy, cz, sx: (x1 - x0 + 1), sy: (y1 - y0 + 1), sz: 1 };
}

function layoutPortalFill(group, win, nether) {
  const b = portalFillBox(win, nether);
  const m = group.children[0];
  m.visible = true;
  m.position.set(b.cx, b.cy, b.cz);
  m.scale.set(b.sx, b.sy, b.sz);
  for (let i = 1; i < group.children.length; i++) group.children[i].visible = false;
}

// A portal only fires when the player's actual body touches its fill blocks —
// a ground (flat) portal never grabs you just because you jump over it, since
// the fill is a thin slab at `win.minY` while the body hovers above it.
function touchesPortalFill(f) {
  const px = freeCam ? camPos.x : pos.x;
  const py = freeCam ? camPos.y : pos.y;
  const pz = freeCam ? camPos.z : pos.z;
  for (const [x, y, z] of portalFillCells(f.win, f.nether)) {
    if (px + PLAYER_HW > x && px - PLAYER_HW < x + 1 &&
        py + PLAYER_H > y && py < y + 1 &&
        pz + PLAYER_HW > z && pz - PLAYER_HW < z + 1) return true;
  }
  return false;
}

function ensurePortalFill(win, nether) {
  const key = `${nether ? "n" : "e"}:${win.orient}:${win.face || "z"}:${win.minX},${win.minY},${win.minZ}${win.dims || ""}`;
  if (portalFills.has(key)) return;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(portalFillGeo, nether ? portalFillMatPurple : portalFillMatBlack));
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
      if (endReturnWin) ensurePortalFill(endReturnWin, false);
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
  const showD2 = (PORTAL_FILL_DIST - 4) * (PORTAL_FILL_DIST - 4);
  for (const f of portalFills.values()) {
    if (f.dim !== dim) { f.group.visible = false; f.shown = false; continue; }
    const dx = f.cx - px, dy = f.cy - py, dz = f.cz - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (f.shown) f.shown = d2 <= maxD2;
    else f.shown = d2 <= showD2;
    f.group.visible = f.shown;
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

function portalWinValid(w) {
  if (!w) return false;
  if (w.orient === "v") {
    if (w.nether) {
      const ww = w.dims === "4x5" || w.dims === "4x4" ? 4 : 5;
      const hh = w.dims === "4x5" ? 5 : 4;
      return nWinOk(w.minX, w.minY, w.minZ, ww, hh, w.face === "x" ? "x" : "z");
    }
    return w.h === 4 ? vWinOk4(w.minX, w.minY, w.minZ) : vWinOk(w.minX, w.minY, w.minZ);
  }
  if (w.nether) {
    const ww = w.dims === "4x5" ? 4 : 5, dd = w.dims === "4x5" ? 5 : 4;
    return nFlatWinOk(w.minX, w.minZ, w.minY, ww, dd);
  }
  return winOk(w.minX, w.minZ, w.minY);
}

function portalFrameBBox(w) {
  if (w.orient === "v") {
    if (w.nether) {
      const ww = w.dims === "4x5" || w.dims === "4x4" ? 4 : 5;
      const hh = w.dims === "4x5" ? 5 : 4;
      if (w.face === "x") return { minX: w.minX, maxX: w.minX, minZ: w.minZ, maxZ: w.minZ + ww - 1, baseY: w.minY, topY: w.minY + hh - 1 };
      return { minX: w.minX, maxX: w.minX + ww - 1, minZ: w.minZ, maxZ: w.minZ, baseY: w.minY, topY: w.minY + hh - 1 };
    }
    const topY = w.h === 4 ? w.minY + 3 : w.minY + 4;
    if (w.face === "x") return { minX: w.minX, maxX: w.minX, minZ: w.minZ, maxZ: w.minZ + 4, baseY: w.minY, topY };
    return { minX: w.minX, maxX: w.minX + 4, minZ: w.minZ, maxZ: w.minZ, baseY: w.minY, topY };
  }
  if (w.nether) {
    const ww = w.dims === "4x5" ? 4 : 5, dd = w.dims === "4x5" ? 5 : 4;
    return { minX: w.minX, maxX: w.minX + ww - 1, minZ: w.minZ, maxZ: w.minZ + dd - 1, baseY: w.minY, topY: w.minY };
  }
  return { minX: w.minX, maxX: w.minX + 4, minZ: w.minZ, maxZ: w.minZ + 4, baseY: w.minY, topY: w.minY };
}

function returnBodyClear(px, py, pz) {
  for (let bx = Math.floor(px - PLAYER_HW + 0.02); bx <= Math.floor(px + PLAYER_HW - 0.02); bx++)
    for (let by = Math.floor(py + 0.02); by <= Math.floor(py + PLAYER_H - 0.02); by++)
      for (let bz = Math.floor(pz - PLAYER_HW + 0.02); bz <= Math.floor(pz + PLAYER_HW - 0.02); bz++)
        if (isSolid(bx, by, bz)) return false;
  return true;
}

function collectReturnWins(cx, cy, cz) {
  return [...collectEndWins(cx, cy, cz, 16), ...collectNetherWins(cx, cy, cz, 16)];
}

function inReturnPortalBody(wins, px, py, pz) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (const w of wins)
    for (let by = Math.floor(py); by <= Math.floor(py + PLAYER_H); by++)
      if (insideEndInterior(w, bx, by, bz) || insideNetherInterior(w, bx, by, bz)) return true;
  return false;
}

function chebDistToBox(ix, iz, box) {
  const dx = ix < box.minX ? box.minX - ix : ix > box.maxX ? ix - box.maxX : 0;
  const dz = iz < box.minZ ? box.minZ - iz : iz > box.maxZ ? iz - box.maxZ : 0;
  return Math.max(dx, dz);
}

function findReturnSpot(win, dir, wins) {
  const box = portalFrameBBox(win);
  const c = winCenter(win);
  const px = c.x + 0.5, pz = c.z + 0.5;
  const n = dir ? Math.hypot(dir.x, dir.z) : 0;
  const dx = n ? dir.x / n : 0, dz = n ? dir.z / n : 0;
  for (let r = 1; r <= 3; r++) {
    for (const dy of [0, 1, -1, 2, -2]) {
      const feetY = box.baseY + dy;
      if (feetY < 1 || feetY + 1 > MAX_Y) continue;
      const ring = [];
      for (let ix = box.minX - r; ix <= box.maxX + r; ix++)
        for (let iz = box.minZ - r; iz <= box.maxZ + r; iz++) {
          if (chebDistToBox(ix, iz, box) !== r) continue;
          if (ix < -WORLD_RADIUS || ix > WORLD_RADIUS || iz < -WORLD_RADIUS || iz > WORLD_RADIUS) continue;
          ring.push([ix, iz]);
        }
      if (n) ring.sort((a, b) => ((b[0] + 0.5 - px) * dx + (b[1] + 0.5 - pz) * dz) - ((a[0] + 0.5 - px) * dx + (a[1] + 0.5 - pz) * dz));
      for (const [ix, iz] of ring) {
        if (!isSolid(ix, feetY - 1, iz)) continue;
        if (!returnBodyClear(ix + 0.5, feetY, iz + 0.5)) continue;
        if (inReturnPortalBody(wins, ix + 0.5, feetY, iz + 0.5)) continue;
        return { x: ix + 0.5, y: feetY, z: iz + 0.5 };
      }
    }
  }
  return null;
}

function frameTopSpot(win, wins) {
  const box = portalFrameBBox(win);
  const cols = [];
  if (win.orient === "v") {
    if (win.face === "x") {
      for (let z = box.minZ; z <= box.maxZ; z++) cols.push([box.minX, box.topY, z]);
    } else {
      for (let x = box.minX; x <= box.maxX; x++) cols.push([x, box.topY, box.minZ]);
    }
  } else {
    for (let x = box.minX; x <= box.maxX; x++)
      for (let z = box.minZ; z <= box.maxZ; z++) {
        const edge = x === box.minX || x === box.maxX || z === box.minZ || z === box.maxZ;
        if (edge) cols.push([x, box.topY, z]);
      }
  }
  const c = winCenter(win);
  cols.sort((a, b) => (Math.abs(a[0] - c.x) + Math.abs(a[2] - c.z)) - (Math.abs(b[0] - c.x) + Math.abs(b[2] - c.z)));
  for (const [fx, fy, fz] of cols) {
    if (!isSolid(fx, fy, fz)) continue;
    for (let feetY = fy + 1; feetY <= Math.min(fy + 30, MAX_Y - 1); feetY++) {
      if (!isSolid(fx, feetY - 1, fz)) continue;
      if (!returnBodyClear(fx + 0.5, feetY, fz + 0.5)) continue;
      if (inReturnPortalBody(wins, fx + 0.5, feetY, fz + 0.5)) continue;
      return { x: fx + 0.5, y: feetY, z: fz + 0.5 };
    }
  }
  return null;
}

function facePortalFrom(win, px, pz) {
  const c = winCenter(win);
  return Math.atan2(-(c.x + 0.5 - px), -(c.z + 0.5 - pz));
}

function faceAwayFromPortal(win, px, pz) {
  return facePortalFrom(win, px, pz) + Math.PI;
}

function nearestReturnWin(sx, sy, sz) {
  const cx = Math.floor(sx), cy = Math.floor(sy), cz = Math.floor(sz);
  let best = null;
  for (const w of collectEndWins(cx, cy, cz, 16)) {
    const d = windowDist(w, cx, cy, cz);
    if (!best || d < best.d) best = { win: Object.assign({ nether: false }, w), d };
  }
  for (const w of collectNetherWins(cx, cy, cz, 16)) {
    const d = windowDist(w, cx, cy, cz);
    if (!best || d < best.d) best = { win: Object.assign({ nether: true }, w), d };
  }
  return best ? best.win : null;
}

function recordOverPortal(win, nether, dir) {
  overPortalWin = Object.assign({ nether }, win);
  overPortalDir = dir && (dir.x || dir.z) ? { x: dir.x, z: dir.z } : null;
  const c = winCenter(win);
  const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
  const spot = findReturnSpot(overPortalWin, overPortalDir, wins) || frameTopSpot(overPortalWin, wins);
  if (spot) {
    overPortalSpawn = { x: spot.x, y: spot.y, z: spot.z };
    overPortalFace = facePortalFrom(win, spot.x, spot.z);
  } else {
    overPortalSpawn = { x: c.x + 0.5, y: win.minY, z: c.z + 0.5 };
    overPortalFace = null;
  }
}

function resolveOverworldReturn() {
  let win = portalWinValid(overPortalWin) ? overPortalWin : null;
  if (!win && overPortalSpawn) win = nearestReturnWin(overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z);
  if (win && !portalWinValid(win)) win = null;
  if (win) {
    const c = winCenter(win);
    const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
    const spot = findReturnSpot(win, overPortalDir, wins) || frameTopSpot(win, wins);
    if (spot) return { spot, yaw: facePortalFrom(win, spot.x, spot.z) };
  }
  const spot = resolveSpawn(overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z);
  let fallbackYaw = overPortalFace;
  if (win) fallbackYaw = facePortalFrom(win, spot.x, spot.z);
  else if (fallbackYaw == null) {
    const w = findPortalWindow(Math.floor(overPortalSpawn.x), Math.floor(overPortalSpawn.y + 0.25), Math.floor(overPortalSpawn.z));
    if (w) fallbackYaw = Math.atan2(-(w.minX + 2.5 - overPortalSpawn.x), -(winCenter(w).z + 0.5 - overPortalSpawn.z));
    else fallbackYaw = yaw;
  }
  return { spot, yaw: fallbackYaw };
}

function nearPortalSpawn(win, dir) {
  const full = Object.assign({ nether: false }, win);
  const c = winCenter(win);
  const wins = collectReturnWins(Math.floor(c.x), win.minY, Math.floor(c.z));
  return findReturnSpot(full, dir, wins) || frameTopSpot(full, wins) || { x: c.x + 0.5, y: win.minY, z: c.z + 0.5 };
}

// Find a safe landing spot near (sx, sy, sz) on live terrain: full body
// clearance (no walls), solid ground under the feet, and not inside any
// portal interior so you never arrive embedded in rock or standing in a
// frame that would instantly re-teleport you.
function resolveSpawn(sx, sy, sz) {
  const cx = Math.floor(sx), cz = Math.floor(sz), cy = Math.floor(sy);
  const wins = collectReturnWins(cx, cy, cz);
  for (let r = 0; r <= 3; r++) {
    for (const dy of [0, 1, -1, 2, -2, -3, 3]) {
      const feetY = cy + dy;
      if (feetY < 1 || feetY + 1 > MAX_Y) continue;
      for (let ix = cx - r; ix <= cx + r; ix++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (r > 0 && Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          if (ix < -WORLD_RADIUS || ix > WORLD_RADIUS || iz < -WORLD_RADIUS || iz > WORLD_RADIUS) continue;
          if (!isSolid(ix, feetY - 1, iz)) continue;
          if (!returnBodyClear(ix + 0.5, feetY, iz + 0.5)) continue;
          if (inReturnPortalBody(wins, ix + 0.5, feetY, iz + 0.5)) continue;
          return { x: ix + 0.5, y: feetY, z: iz + 0.5 };
        }
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
    const touched = (w, nether) => w && touchesPortalFill({ win: w, nether });
    if (touched(wE, false) || touched(wN, true)) {
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
    if (!touchesPortalFill(f)) continue;
    if (f.nether) {
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      let ddx = 0, ddz = 0;
      if (keys["KeyW"] || keys["ArrowUp"]) { ddx += forward.x; ddz += forward.z; }
      if (keys["KeyS"] || keys["ArrowDown"]) { ddx -= forward.x; ddz -= forward.z; }
      if (keys["KeyD"] || keys["ArrowRight"]) { ddx += right.x; ddz += right.z; }
      if (keys["KeyA"] || keys["ArrowLeft"]) { ddx -= right.x; ddz -= right.z; }
      if (ddx === 0 && ddz === 0) { ddx = forward.x; ddz = forward.z; }
      if (dim === "over") recordOverPortal(f.win, true, { x: ddx, z: ddz });
      if (dim === "nether") {
        netherExit = recordDimExit(Object.assign({ nether: true }, f.win), { x: ddx, z: ddz });
        portalTrigger("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z, "You returned to the Overworld");
      } else if (dim === "end") {
        endExit = recordDimExit(Object.assign({ nether: true }, f.win), { x: ddx, z: ddz });
        const dst = netherExit || NETHER_SPAWN;
        portalTrigger("nether", dst.x, dst.y, dst.z, "You entered The Nether");
      } else {
        const dst = netherExit || NETHER_SPAWN;
        portalTrigger("nether", dst.x, dst.y, dst.z, "You entered The Nether");
      }
      return;
    } else {
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      let ddx = 0, ddz = 0;
      if (keys["KeyW"] || keys["ArrowUp"]) { ddx += forward.x; ddz += forward.z; }
      if (keys["KeyS"] || keys["ArrowDown"]) { ddx -= forward.x; ddz -= forward.z; }
      if (keys["KeyD"] || keys["ArrowRight"]) { ddx += right.x; ddz += right.z; }
      if (keys["KeyA"] || keys["ArrowLeft"]) { ddx -= right.x; ddz -= right.z; }
      if (ddx === 0 && ddz === 0) { ddx = forward.x; ddz = forward.z; }
      if (dim === "over") recordOverPortal(f.win, false, { x: ddx, z: ddz });
      if (dim === "end") {
        endExit = recordDimExit(Object.assign({ nether: false }, f.win), { x: ddx, z: ddz });
        portalTrigger("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z, "You returned to the Overworld");
      } else if (dim === "nether") {
        netherExit = recordDimExit(Object.assign({ nether: false }, f.win), { x: ddx, z: ddz });
        const dst = endExit || END_SPAWN;
        portalTrigger("end", dst.x, dst.y, dst.z, "You arrived in The End");
      } else {
        const dst = endExit || END_SPAWN;
        portalTrigger("end", dst.x, dst.y, dst.z, "You arrived in The End");
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
  mats: null, hitCount: 0, flee: null, mob: null,
  dying: 0, deathFlash: 0, deathIdx: 0,
};
const dragonMat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial(Object.assign({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.08 }, opts));
let dragonUnitGeo = null;
let dragonMemGeo = null;
const dragonVec = new THREE.Vector3();
const dragonA = new THREE.Vector3();
const dragonB = new THREE.Vector3();
const dragonFlee = new THREE.Vector3();
const DRAGON_SPEED = 8;
const DRAGON_MIN_Y = END_PLATFORM_TOP + 7;
const DRAGON_MAX_Y = END_PLATFORM_TOP + 22;
const DRAGON_FLEE_DIST = 16;
const DRAGON_FLEE_SPEED = 11;
const DRAGON_BASE = [0x1a1426, 0x241a36, 0x322248, 0x8c8496, 0x201830]; // body, belly, plate, bone, membrane
const DRAGON_FINISH = { rough: 0.6, metal: 0.05, emiBody: 0.45, emiMem: 0.5, memOpacity: 0.94, eye: 0xc86bff, breath: 0xb04dff };
const DRAGON_HUES = [0x6e2a92, 0x1a5eb8, 0x188844, 0xd8a818, 0xc82828]; // violet, blue, green, yellow, red
const DRAGON_SHADE_GREY = 0x9a9aa0;
function dragonShade(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return r * 65536 + g * 256 + b;
}
function dragonMix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (((ar + (br - ar) * t) | 0) * 65536 + ((ag + (bg - ag) * t) | 0) * 256 + ((ab + (bb - ab) * t) | 0));
}
function dragonHitPalette(k) {
  if (k <= 0) return DRAGON_BASE;
  const acc = DRAGON_HUES[(k - 1) % DRAGON_HUES.length];
  return [
    dragonShade(acc, 0.35),
    dragonShade(acc, 0.5),
    dragonMix(dragonShade(acc, 0.85), DRAGON_SHADE_GREY, 0.35),
    dragonMix(acc, DRAGON_SHADE_GREY, 0.35),
    dragonMix(dragonShade(acc, 0.65), DRAGON_SHADE_GREY, 0.175),
  ];
}
function applyDragonBase() {
  if (!dragon.mesh || !dragon.mats) return;
  const f = DRAGON_FINISH;
  paintDragonPalette(DRAGON_BASE);
  for (const key of ["bodyMat", "bellyMat", "plateMat", "boneMat"]) {
    const mt = dragon.mats[key];
    mt.roughness = f.rough; mt.metalness = f.metal; mt.emissiveIntensity = f.emiBody;
  }
  dragon.mats.memMat.roughness = f.rough; dragon.mats.memMat.metalness = f.metal;
  dragon.mats.memMat.emissiveIntensity = f.emiMem; dragon.mats.memMat.opacity = f.memOpacity;
  if (dragon.mats.eye) dragon.mats.eye.color.setHex(f.eye);
  if (dragon.parts) for (const q of dragon.parts) q.m.material.color.setHex(f.breath);
}

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
    color: 0x100f1a, emissive: 0x100f1a, emissiveIntensity: 0.5, roughness: 0.9, metalness: 0.02,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc86bff });
  dragon.mats = { bodyMat, bellyMat, plateMat, boneMat, memMat, eye: eyeMat };
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
  dragon.mesh.position.set(0, DRAGON_MIN_Y + 2, 0);
  dragon.s = 0;
  dragon.nextRun = 2 + Math.random() * 3;
  dragon.spitTimer = 3 + Math.random() * 4;
  dragon.spitting = 0;
  dragon.surgeT = 0; dragon.surge = 1; dragon.speedMul = 1;
  dragon.maxHp = 8 * DRAGON_FULL_DMG;
  dragon.hp = dragon.maxHp;
  dragon.dying = 0; dragon.deathFlash = 0; dragon.deathIdx = 0;
  if (!dragon.mob || !mobs.includes(dragon.mob)) {
    let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
    const dm = {
      id: gid, kind: "dragon", canStep: false, homeId: -1, isBaby: false, parentId: -1, dim: "end",
      pos: dragon.mesh.position.clone(),
      vel: new THREE.Vector3(),
      hw: 1.5, h: 3, mesh: dragon.mesh, onGround: false,
      target: null, mode: "straight", wanderT: 0,
      yaw: 0, yawTarget: 0, villageBound: false, speed: DRAGON_SPEED,
      _stuckT: 0, _prevX: 0, _prevZ: 0,
      path: null, pathIdx: 0, pathKey: null, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
    };
    mobs.push(dm);
    mobById.set(dm.id, dm);
    dragon.mob = dm;
  } else {
    dragon.mob.pos.copy(dragon.mesh.position);
    dragon.mob.vel.set(0, 0, 0);
    dragon.mob.mesh = dragon.mesh;
    if (!mobById.has(dragon.mob.id)) mobById.set(dragon.mob.id, dragon.mob);
  }
  updateBossBar();
  dragon.hitCount = 1;
  applyDragonBase();
  paintDragon();
  buildDragonPath();
}

function paintDragonPalette(c) {
  if (!dragon.mesh || !dragon.mats) return;
  dragon.mats.bodyMat.color.setHex(c[0]); dragon.mats.bodyMat.emissive.setHex(c[0]);
  dragon.mats.bellyMat.color.setHex(c[1]); dragon.mats.bellyMat.emissive.setHex(c[1]);
  dragon.mats.plateMat.color.setHex(c[2]); dragon.mats.plateMat.emissive.setHex(c[2]);
  dragon.mats.boneMat.color.setHex(c[3]); dragon.mats.boneMat.emissive.setHex(c[3]);
  dragon.mats.memMat.color.setHex(c[4]); dragon.mats.memMat.emissive.setHex(c[4]);
}

function paintDragon() {
  if (!dragon.mesh || !dragon.mats) return;
  const k = ((dragon.hitCount - 1) % DRAGON_HUES.length) + 1;
  paintDragonPalette(dragonHitPalette(k));
  const acc = DRAGON_HUES[k - 1];
  if (dragon.mats.eye) dragon.mats.eye.color.setHex(acc);
  if (dragon.parts) for (const q of dragon.parts) q.m.material.color.setHex(acc);
}

function removeDragon() {
  if (!dragon.mesh) return;
  if (dragon.mob) {
    const freed = [];
    {
      const seen = new Set();
      let c = chainMobById(chainChild.get(dragon.mob.id));
      while (c && !seen.has(c.id)) {
        seen.add(c.id);
        if (c !== playerChainAvatar) freed.push(c);
        const nid = chainChild.get(c.id);
        c = nid !== undefined ? chainMobById(nid) : null;
      }
    }
    const dx = dragon.mesh.position.x, dy = dragon.mesh.position.y, dz = dragon.mesh.position.z;
    const childId = chainChild.get(dragon.mob.id);
    const back = childId !== undefined && childId !== PLAYER_CHAIN_ID ? mobById.get(childId) : null;
    const backLive = !!(back && mobs.includes(back) && back !== dragon.mob && !isMobHeld(back));
    chainChild.delete(dragon.mob.id);
    if (grappleMob === dragon.mob) detachDisplacementGrapple();
    if (birdLock === dragon.mob) { birdLock = null; birdLockT = 0; birdLockShots = 0; }
    mobById.delete(dragon.mob.id);
    const mi = mobs.indexOf(dragon.mob);
    if (mi >= 0) mobs.splice(mi, 1);
    dragon.mob = null;
    if (backLive) freeChainRoot(back);
    else if (back && mobs.includes(back)) {
      const bl = chainLinks.get(back.id);
      if (bl) {
        scene.remove(bl.rope);
        scene.remove(bl.head);
        if (bl.rope.dispose) bl.rope.dispose();
        chainLinks.delete(back.id);
      }
      chainParent.delete(back.id);
    }
    for (const f of freed) panicSingleMob(f, dx, dy, dz, true);
  }
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
  const dfol = dragon.mob ? chainLiveFollower(dragon.mob) : null;
  for (let i = 0; i < N; i++) {
    let a = base + (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
    const wide = i % 2 === 0;
    let r = wide ? 26 + Math.random() * 10 : 10 + Math.random() * 10;
    if (dfol) {
      for (let t = 0; t < 4; t++) {
        const cx = Math.cos(a) * r - dragon.mesh.position.x, cz = Math.sin(a) * r - dragon.mesh.position.z;
        const cl = Math.hypot(cx, cz);
        const fx = dfol.pos.x - dragon.mesh.position.x, fz = dfol.pos.z - dragon.mesh.position.z;
        const fl = Math.hypot(fx, fz);
        if (cl < 1e-6 || fl < 1e-6) break;
        if ((cx * fx + cz * fz) / (cl * fl) <= Math.cos(CHAIN_LEAD_CONE)) break;
        a += 0.6;
        r = wide ? 26 + Math.random() * 10 : 10 + Math.random() * 10;
      }
    }
    let wx = Math.cos(a) * r, wz = Math.sin(a) * r;
    if (wide) {
      const wm = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) || 1;
      wx /= wm; wz /= wm;
    }
    pts.push(new THREE.Vector3(
      endSquareCoord(wx),
      Math.random() < lowBias ? DRAGON_MIN_Y + Math.random() * 2 : DRAGON_MAX_Y - 6 + Math.random() * 6,
      endSquareCoord(wz)
    ));
  }
  pts[0].copy(dragon.mesh.position);
  const n = 180, pos = new Array(n), tmp = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const u = (k / n) * N, i = Math.floor(u), t = u - i;
    dragonCatmull(pts[(i - 1 + N) % N], pts[i % N], pts[(i + 1) % N], pts[(i + 2) % N], t, tmp);
    tmp.y = Math.min(DRAGON_MAX_Y, Math.max(DRAGON_MIN_Y, tmp.y));
    endClampXZPos(tmp);
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
      dragon.deathFlash = 0.1;
      dragon.deathIdx = (dragon.deathIdx + 1) % dragon.deathTotal;
      paintDragonPalette(dragonHitPalette(dragon.deathIdx));
    }
    const w = (Math.sin(dragon.t * Math.PI * 2 * 7) * 0.6 + Math.sin(dragon.t * Math.PI * 2 * 13.1 + 1.3) * 0.35 + (Math.random() - 0.5) * 0.6) * 0.8;
    M.position.x = dragon.deathX + w;
    M.position.z = dragon.deathZ + w * 0.6;
    M.position.y = dragon.deathY + Math.abs(w) * 0.5;
    M.rotation.z = dragon.bank + w * 0.8;
    if (dragon.mob) { dragon.mob.pos.copy(M.position); dragon.mob.vel.set(0, 0, 0); }
    if (dragon.dying <= 0) {
      const dx = M.position.x, dy = M.position.y + 1, dz = M.position.z;
      removeDragon();
      endCleared = true;
      buildReturnPortal();
      portalDirty = true;
      if (endReturnWin) ensurePortalFill(endReturnWin, false);
      updatePortalVisual();
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
  endClampXZPos(M.position);
  if (M.position.y < DRAGON_MIN_Y) M.position.y = DRAGON_MIN_Y;
  if (M.position.y > DRAGON_MAX_Y) M.position.y = DRAGON_MAX_Y;
  M.rotation.y = dragon.yaw;
  M.rotation.x = dragon.pitch;
  M.rotation.z = dragon.bank;
  if (dragon.mob) {
    dragon.mob.pos.copy(M.position);
    dragon.mob.vel.copy(fwd).multiplyScalar(DRAGON_SPEED * dragon.speedMul);
    if (dragon.flee && dragon.flee.lengthSq() > 0.0001) dragon.mob.vel.addScaledVector(dragon.flee, DRAGON_FLEE_SPEED);
    dragon.mob.yaw = dragon.yaw;
    dragon.mob.yawTarget = dragon.yaw;
  }

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
let endermanHaloMat = null;
let endermanHaloFlyMat = null;
const ENDERMAN_ANGRY_TIME = 0.5;
const ENDERMAN_STARE_TIME = 0.3;
const ENDERMAN_HW = 0.31;
const ENDERMAN_H = 2.7;

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
  const haloMeshes = [];
  const endermanHalo = (parent, sx, sy, sz, px, py, pz) => {
    if (!endermanHaloMat) return null;
    const m = new THREE.Mesh(endermanGeo, endermanHaloMat);
    m.scale.set(sx * 1.18, sy * 1.06, sz * 1.18);
    m.position.set(px, py, pz);
    m.visible = false;
    m.userData.halo = true;
    parent.add(m);
    haloMeshes.push(m);
    return m;
  };
  const legL = new THREE.Group();
  legL.position.set(-0.16, 0.6, 0);
  g.add(legL);
  endermanBox(legL, endermanBodyMat, 0.24, 1.2, 0.24, 0, 0, 0);
  endermanHalo(legL, 0.24, 1.2, 0.24, 0, 0, 0);
  const legR = new THREE.Group();
  legR.position.set(0.16, 0.6, 0);
  g.add(legR);
  endermanBox(legR, endermanBodyMat, 0.24, 1.2, 0.24, 0, 0, 0);
  endermanHalo(legR, 0.24, 1.2, 0.24, 0, 0, 0);
  endermanBox(g, endermanBodyMat, 0.62, 1.0, 0.4, 0, 1.7, 0);
  endermanHalo(g, 0.62, 1.0, 0.4, 0, 1.7, 0);
  const head = new THREE.Group();
  head.position.set(0, 2.45, 0);
  g.add(head);
  endermanBox(head, endermanBodyMat, 0.52, 0.5, 0.5, 0, 0, 0);
  endermanHalo(head, 0.52, 0.5, 0.5, 0, 0, 0);
  const eyes = [];
  for (const sx of [1, -1]) eyes.push(endermanBox(head, eyeMat, 0.09, 0.16, 0.05, sx * 0.16, 0.03, 0.26));
  const armL = new THREE.Group();
  armL.position.set(-0.42, 1.95, 0);
  g.add(armL);
  endermanBox(armL, endermanBodyMat, 0.16, 1.75, 0.16, 0, -0.9, 0);
  endermanHalo(armL, 0.16, 1.75, 0.16, 0, -0.9, 0);
  const armR = new THREE.Group();
  armR.position.set(0.42, 1.95, 0);
  g.add(armR);
  endermanBox(armR, endermanBodyMat, 0.16, 1.75, 0.16, 0, -0.9, 0);
  endermanHalo(armR, 0.16, 1.75, 0.16, 0, -0.9, 0);
  return { g, eyeMat, eyes, armL, armR, head, haloMeshes, t: 0, angry: 0, teleportT: 0, lookT: 0 };
}

function setEndermanEyeColor(e, hex) {
  if (e.eyeMat) e.eyeMat.color.setHex(hex);
  if (e.eyes) for (const m of e.eyes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) if (mm && mm.color) mm.color.setHex(hex);
  }
}

function endermanHaloMode(m) {
  if (!m || m.kind !== "enderman") return null;
  if (isMobHeld(m)) return null;
  if (!isChained(m)) return null;
  const root = chainRootOf(m);
  if (!root) return null;
  if (root.kind === "dragon") return "dragon";
  if (m.dim === "end" && isFlyingKind(root.kind)) return "fly";
  return null;
}
function endermanChainHaloVisible(m) {
  return endermanHaloMode(m) !== null;
}
function syncEndermanHalo(m) {
  if (!m || m.kind !== "enderman" || !m.haloMeshes) return;
  const mode = endermanHaloMode(m);
  for (const h of m.haloMeshes) {
    h.visible = mode !== null;
    if (mode === "fly" && endermanHaloFlyMat) h.material = endermanHaloFlyMat;
    else if (mode === "dragon" && endermanHaloMat) h.material = endermanHaloMat;
  }
}
function syncEndermanHalos() {
  if (endermanHaloMat && dragon && dragon.mats && dragon.mats.eye) endermanHaloMat.color.copy(dragon.mats.eye.color);
  for (const e of endermen) syncEndermanHalo(e);
}

function ensureEndermanAssets() {
  if (!endermanGeo) endermanGeo = new THREE.BoxGeometry(1, 1, 1);
  if (!endermanBodyMat) endermanBodyMat = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.85, metalness: 0.05 });
  if (!endermanHaloMat) endermanHaloMat = new THREE.MeshBasicMaterial({ color: DRAGON_FINISH.eye, transparent: true, opacity: 0.35, side: THREE.BackSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
  if (!endermanHaloFlyMat) endermanHaloFlyMat = new THREE.MeshBasicMaterial({ color: 0xd8a818, transparent: true, opacity: 0.35, side: THREE.BackSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
}

function spawnEndermen() {
  const freeEnd = (e) => mobs.includes(e) && (e.dim === undefined || e.dim === "end") && e !== carryMob && e !== carryGrappleMob;
  if (endermen.some(freeEnd)) return;
  ensureEndermanAssets();
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  const liveEnd = endermen.filter(freeEnd).length;
  for (let i = liveEnd; i < ENDERMEN_COUNT; i++) {
    const v = makeEndermanMesh();
    const spot = endermanPickSpot(0, 0, 6, endermen);
    v.g.position.set(spot.x, END_PLATFORM_TOP + 1, spot.z);
    v.g.rotation.y = Math.random() * Math.PI * 2;
    v.teleportT = 3 + Math.random() * 7;
    scene.add(v.g);
    const e = {
      id: gid++, kind: "enderman", canStep: false, homeId: -1, isBaby: false, parentId: -1, dim: "end",
      pos: v.g.position.clone(),
      vel: new THREE.Vector3(),
      hw: ENDERMAN_HW, h: ENDERMAN_H, mesh: v.g, onGround: false,
      target: null, mode: "wander", wanderT: 0,
      yaw: v.g.rotation.y, yawTarget: v.g.rotation.y, villageBound: false, speed: WALK / 2,
      _stuckT: 0, _prevX: spot.x, _prevZ: spot.z,
      path: null, pathIdx: 0, pathKey: null, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
      g: v.g, eyeMat: v.eyeMat, eyes: v.eyes, armL: v.armL, armR: v.armR, head: v.head,
      haloMeshes: v.haloMeshes,
      t: 0, angry: 0, teleportT: v.teleportT, lookT: 0, eyeRedT: 0, baseY: END_PLATFORM_TOP + 1,
    };
    stampSpawn(e);
    mobs.push(e);
    mobById.set(e.id, e);
    endermen.push(e);
  }
}

function removeEndermen() {
  if (!endermen.length) return;
  const keep = [];
  for (const e of endermen) {
    if (e === carryMob || e === carryGrappleMob || (e.dim !== undefined && e.dim !== "end")) { keep.push(e); continue; }
    scene.remove(e.g);
    e.eyeMat.dispose();
    mobById.delete(e.id);
    const mi = mobs.indexOf(e);
    if (mi >= 0) mobs.splice(mi, 1);
  }
  endermen.length = 0;
  for (const k of keep) endermen.push(k);
  pruneChains();
  if (!endermen.length) {
    if (endermanGeo) { endermanGeo.dispose(); endermanGeo = null; }
    if (endermanBodyMat) { endermanBodyMat.dispose(); endermanBodyMat = null; }
    if (endermanHaloMat) { endermanHaloMat.dispose(); endermanHaloMat = null; }
    if (endermanHaloFlyMat) { endermanHaloFlyMat.dispose(); endermanHaloFlyMat = null; }
  }
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
  bursts.push({ pts, geo, mat, vel, life: 0.7, max: 0.7, tag: 4, fx: cx, fy: cy, fz: cz });
}

function endermanPickSpot(cx, cz, minDist, others = [], maxDist = END_MOB_R, px = null, pz = null) {
  const preferAng = (px != null && pz != null && (px || pz)) ? Math.atan2(pz, px) : null;
  for (let tries = 0; tries < 24; tries++) {
    const a = preferAng != null ? preferAng + (Math.random() * 2 - 1) * Math.PI * 0.5 : Math.random() * Math.PI * 2;
    const r = minDist + Math.sqrt(Math.random()) * Math.max(0.5, maxDist - minDist);
    const x = Math.round(cx + Math.cos(a) * r);
    const z = Math.round(cz + Math.sin(a) * r);
    if (endBlockOutsidePlatform(x, z)) continue;
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
    const a = preferAng != null ? preferAng + (Math.random() * 2 - 1) * Math.PI * 0.5 : Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * Math.min(5, Math.max(0.5, maxDist - 2));
    let x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
    x = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, x));
    z = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, z));
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) >= minDist * minDist) return { x, z };
  }
  let fx0 = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, Math.round(cx)));
  let fz0 = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, Math.round(cz)));
  return { x: fx0, z: fz0 };
}

function endermanTeleport(e, x, z, baseY) {
  const M = e.g;
  if (dim === "end" && (e.dim === undefined || e.dim === "end")) {
    x = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, Math.round(x)));
    z = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, Math.round(z)));
  }
  spawnEndermanBurst(M.position.x, M.position.y + 1.35, M.position.z);
  M.position.x = x;
  M.position.z = z;
  let y = baseY != null ? baseY : END_PLATFORM_TOP + 1;
  if (baseY != null) {
    const isLiq = (id) => id === WATER || id === LAVA || id === MOON_WATER;
    let surf = null;
    if (isLiq(getBlock(x, Math.floor(y) - 1, z))) surf = Math.floor(y);
    else if (isLiq(getBlock(x, Math.floor(y), z))) {
      let s = Math.floor(y);
      while (s + 1 <= MAX_Y && isLiq(getBlock(x, s + 1, z))) s++;
      surf = s + 1;
    }
    if (surf != null) y = mobFloatTargetY(surf, ENDERMAN_H);
  }
  M.position.y = y;
  if (baseY != null) e.baseY = y;
  e.pos.copy(M.position);
  spawnEndermanBurst(M.position.x, M.position.y + 1.35, M.position.z);
}

const ENDERMAN_BLINK_DIST = 5;
const ENDERMAN_BLINK_FAR = 10;
const ENDERMAN_BLINK_UP = 5;
const ENDERMAN_RED_TIME = 0.5;
const ENDERMAN_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function endermanShuffled8() {
  const o = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = o[i]; o[i] = o[j]; o[j] = t;
  }
  return o;
}

const endermanViewTmp = new THREE.Vector3();

function endermanViewFrac(x, y, z) {
  camera.getWorldDirection(endermanViewTmp);
  const dx = x - pos.x, dy = (y + 1.35) - (pos.y + EYE), dz = z - pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  let dyaw = Math.atan2(dx, dz) - Math.atan2(endermanViewTmp.x, endermanViewTmp.z);
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const pitchT = Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1));
  const pitchC = Math.asin(THREE.MathUtils.clamp(endermanViewTmp.y, -1, 1));
  return { yaw: Math.abs(dyaw) / hHalf, pitch: Math.abs(pitchT - pitchC) / vHalf };
}

function endermanPeripheral(x, y, z) {
  const f = endermanViewFrac(x, y, z);
  const m = Math.max(f.yaw, f.pitch);
  return m >= 2 / 3 && m <= 1;
}

function endermanWalkable(x0, y0, z0, x1, y1, z1, vmax) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
  let py = y0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const sx = x0 + (x1 - x0) * t, sz = z0 + (z1 - z0) * t;
    const g = groundYForMob(sx, sz, py, ENDERMAN_HW);
    if (g < 1 || g > MAX_Y - 3) return false;
    if (Math.abs(g - py) > vmax) return false;
    if (aabbCollidesWorld(sx, g, sz, ENDERMAN_HW, ENDERMAN_H)) return false;
    py = g;
  }
  return true;
}

function endermanRingCells(cx, cz, d) {
  const out = [];
  for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
    out.push({ x: cx + dx, z: cz + dz });
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

function endermanSeparated(others, x, z) {
  for (const o of others) {
    const ox = x - o.pos.x, oz = z - o.pos.z;
    if (ox * ox + oz * oz < 9) return false;
  }
  return true;
}

function endermanSegmentFree(x0, y0, z0, x1, y1, z1, hw, h) {
  const dist = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = Math.max(1, Math.ceil(dist / 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (aabbCollidesWorld(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, hw, h)) return false;
  }
  return true;
}

const ENDERMAN_LAST_RESORT_R = 48;

function endermanSurfaceY(x, z, refY) {
  const gy = groundYDown(x, z, refY, ENDERMAN_HW);
  if (gy == null || gy < 1 || gy > MAX_Y - 3) return null;
  if (aabbCollidesWorld(x, gy, z, ENDERMAN_HW, ENDERMAN_H)) return null;
  return gy;
}

function endermanRelaxedSpot(e, others, landY, rMin, rMax) {
  const ex = Math.round(e.pos.x), ez = Math.round(e.pos.z);
  const ey = e.pos.y;
  let pool = [];
  let best = Infinity;
  for (let d = rMin; d <= rMax; d++) {
    if (d > best + 10) break;
    for (const c of endermanRingCells(ex, ez, d)) {
      const y = landY(c.x, c.z);
      if (y == null) continue;
      if (!endermanSeparated(others, c.x, c.z)) continue;
      const dist = Math.hypot(c.x - ex, y - ey, c.z - ez);
      if (dist > best + 10) continue;
      if (dist < best) {
        best = dist;
        pool = pool.filter((s) => s.dist <= best + 10);
      }
      pool.push({ x: c.x, z: c.z, y, dist });
    }
  }
  if (!pool.length) return null;
  const s = pool[(Math.random() * pool.length) | 0];
  return { x: s.x, z: s.z, y: s.y };
}

function endermanPickSpotOutside(e, cx, cz, px, pz) {
  const others = endermanOthers(e).filter((o) => o.dim === e.dim);
  const B = WORLD_RADIUS - 2;
  const ex = e.pos.x, ez = e.pos.z;
  const farFromPlayer = (x, z) => Math.hypot(x - pos.x, z - pos.z) >= 10;
  const landY = (x, z) => {
    if (x < -B || x > B || z < -B || z > B) return null;
    return endermanSurfaceY(x, z, e.pos.y);
  };
  for (const i of endermanShuffled8()) {
    const dl = Math.hypot(ENDERMAN_DIRS[i][0], ENDERMAN_DIRS[i][1]);
    const d = ENDERMAN_BLINK_DIST + Math.random() * (ENDERMAN_BLINK_FAR - ENDERMAN_BLINK_DIST);
    const x = Math.round(ex + ENDERMAN_DIRS[i][0] / dl * d);
    const z = Math.round(ez + ENDERMAN_DIRS[i][1] / dl * d);
    if (Math.hypot(x - ex, z - ez) < ENDERMAN_BLINK_DIST || !farFromPlayer(x, z)) continue;
    const y = landY(x, z);
    if (y == null || Math.abs(y - e.pos.y) > ENDERMAN_BLINK_UP) continue;
    if (!endermanPeripheral(x, y, z)) continue;
    if (!endermanWalkable(ex, e.pos.y, ez, x, y, z, ENDERMAN_BLINK_UP)) continue;
    if (!endermanSeparated(others, x, z)) continue;
    return { x, z, y };
  }
  return endermanRelaxedSpot(e, others, landY, ENDERMAN_BLINK_DIST, ENDERMAN_LAST_RESORT_R)
    || { x: THREE.MathUtils.clamp(Math.round(ex), -B, B), z: THREE.MathUtils.clamp(Math.round(ez), -B, B), y: endermanSurfaceY(Math.round(ex), Math.round(ez), e.pos.y) || Math.round(e.pos.y) };
}

function endermanPickSpotEnd(e, cx, cz, px, pz) {
  const others = endermanOthers(e).filter((o) => o.dim === e.dim);
  const R = END_MOB_R;
  const ex = e.pos.x, ez = e.pos.z;
  const farFromPlayer = (x, z) => Math.hypot(x - pos.x, z - pos.z) >= 10;
  const landY = (x, z) => {
    if (endBlockOutsidePlatform(x, z)) return null;
    if (Math.abs(x) <= 3 && Math.abs(z - END_RETURN_Z) <= 3) return null;
    if (isSolid(x, END_PLATFORM_TOP + 1, z) || isSolid(x, END_PLATFORM_TOP + 2, z)) return null;
    return END_PLATFORM_TOP + 1;
  };
  for (const i of endermanShuffled8()) {
    const dl = Math.hypot(ENDERMAN_DIRS[i][0], ENDERMAN_DIRS[i][1]);
    const d = ENDERMAN_BLINK_DIST + Math.random() * (ENDERMAN_BLINK_FAR - ENDERMAN_BLINK_DIST);
    const x = Math.round(ex + ENDERMAN_DIRS[i][0] / dl * d);
    const z = Math.round(ez + ENDERMAN_DIRS[i][1] / dl * d);
    if (Math.hypot(x - ex, z - ez) < ENDERMAN_BLINK_DIST || !farFromPlayer(x, z)) continue;
    const y = landY(x, z);
    if (y == null) continue;
    if (!endermanSegmentFree(ex, e.pos.y, ez, x, y, z, ENDERMAN_HW, ENDERMAN_H)) continue;
    if (!endermanPeripheral(x, y, z)) continue;
    if (!endermanSeparated(others, x, z)) continue;
    return { x, z, y };
  }
  const relaxed = endermanRelaxedSpot(e, others, landY, ENDERMAN_BLINK_DIST, R);
  if (relaxed) return relaxed;
  let fx = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, Math.round(ex)));
  let fz = Math.max(-END_PLATFORM_R, Math.min(END_PLATFORM_R, Math.round(ez)));
  return { x: fx, z: fz, y: END_PLATFORM_TOP + 1 };
}

function endermanSpotFor(e, cx, cz, minDist, px, pz, maxDist) {
  if (dim === "end" && (e.dim === undefined || e.dim === "end")) {
    return endermanPickSpotEnd(e, cx, cz, px, pz);
  }
  return endermanPickSpotOutside(e, cx, cz, px, pz);
}

function endermanOthers(e) {
  return endermen.filter((o) => o !== e && o !== carryMob && o !== carryGrappleMob);
}

const endermanFwd = new THREE.Vector3();

function endermanAimed(e, dir) {
  const eye = camera.position;
  const minX = e.pos.x - e.hw, maxX = e.pos.x + e.hw;
  const minY = e.pos.y, maxY = e.pos.y + e.h;
  const minZ = e.pos.z - e.hw, maxZ = e.pos.z + e.hw;
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dir.x) < 1e-6) {
    if (eye.x < minX || eye.x > maxX) return false;
  } else {
    const tx1 = (minX - eye.x) / dir.x, tx2 = (maxX - eye.x) / dir.x;
    tmin = Math.max(tmin, Math.min(tx1, tx2)); tmax = Math.min(tmax, Math.max(tx1, tx2));
    if (tmin > tmax) return false;
  }
  if (Math.abs(dir.y) < 1e-6) {
    if (eye.y < minY || eye.y > maxY) return false;
  } else {
    const ty1 = (minY - eye.y) / dir.y, ty2 = (maxY - eye.y) / dir.y;
    tmin = Math.max(tmin, Math.min(ty1, ty2)); tmax = Math.min(tmax, Math.max(ty1, ty2));
    if (tmin > tmax) return false;
  }
  if (Math.abs(dir.z) < 1e-6) {
    if (eye.z < minZ || eye.z > maxZ) return false;
  } else {
    const tz1 = (minZ - eye.z) / dir.z, tz2 = (maxZ - eye.z) / dir.z;
    tmin = Math.max(tmin, Math.min(tz1, tz2)); tmax = Math.min(tmax, Math.max(tz1, tz2));
    if (tmin > tmax) return false;
  }
  if (tmax < 0) return false;
  const tHit = Math.max(tmin, 0);
  const steps = Math.max(1, Math.ceil(tHit / 0.25));
  for (let k = 1; k < steps; k++) {
    const t = tHit * k / steps;
    if (isSolid(Math.floor(eye.x + dir.x * t), Math.floor(eye.y + dir.y * t), Math.floor(eye.z + dir.z * t))) return false;
  }
  return true;
}

function updateEndermen(dt) {
  for (let i = 0; i < endermen.length; i++) {
    if (isChained(endermen[i])) continue;
    updateEnderman(endermen[i], dt);
  }
}

function updateEnderman(e, dt) {
  if (e === carryMob || isMobFrozenByGrapple(e)) { e.lookT = 0; e.eyeRedT = ENDERMAN_RED_TIME; setEndermanEyeColor(e, 0xff2222); return; }
  if (e.dim !== undefined && e.dim !== dim) return;
  const inboundGrab = e === carryGrappleMob && carryGrappleMode === "grab" && (carryGrappleActive || carryGrapplePulling);
  const M = e.g;
  const t = (e.t += dt);
  if (e.falling) {
    if (mobInWater(e)) { e.falling = false; e.fallV = 0; }
    else {
      e.fallV = Math.max(-20, (e.fallV || 0) - GRAVITY * dt);
      M.position.y += e.fallV * dt;
      let landed = false;
      try {
        const gy = groundYDown(M.position.x, M.position.z, M.position.y + 0.5, ENDERMAN_HW);
        if (gy != null && M.position.y <= gy + 0.02) { M.position.y = Math.max(1, gy); landed = true; }
      } catch {}
      if (M.position.y < -15) { e.falling = false; e.fallV = 0; }
      else if (landed) { e.falling = false; e.fallV = 0; e.baseY = M.position.y; }
    }
  }
  const baseY = e.baseY != null ? e.baseY : END_PLATFORM_TOP + 1;
  let hoverY = baseY + Math.sin(t * 1.3) * 0.02;
  if (mobInWater(e)) {
    const surf = waterSurfaceForMob(e);
    if (surf > -Infinity) {
      hoverY = mobFloatTargetY(surf, ENDERMAN_H);
      e.baseY = hoverY;
    }
  }
  if (!e.falling) M.position.y += (hoverY - M.position.y) * Math.min(1, dt * 8);

  const dx = pos.x - M.position.x;
  const dz = pos.z - M.position.z;
  const distToPlayer = Math.hypot(dx, dz);
  if (distToPlayer > 0.001) {
    let d = Math.atan2(dx, dz) - M.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    M.rotation.y += d * Math.min(1, dt * 6);
  }
  e.yaw = M.rotation.y;
  e.yawTarget = M.rotation.y;

  const shaking = e.angry > 0;
  const amp = shaking ? 0.45 : 0.06;
  const phase = shaking ? t * 16 : t * 1.8;
  e.armL.rotation.x = Math.sin(phase) * amp;
  e.armR.rotation.x = Math.sin(phase + 0.6) * amp;
  setEndermanEyeColor(e, e.lookT > 0 || e.eyeRedT > 0 ? 0xff2222 : 0xb44cff);
  if (e.eyeRedT > 0) e.eyeRedT -= dt;
  const hsp = Math.hypot(vel.x, vel.z);
  let headX = Math.sin(yaw), headZ = Math.cos(yaw);
  if (hsp > 5) { headX = vel.x / hsp; headZ = vel.z / hsp; }

  if (e.angry > 0) {
    e.angry -= dt;
    e.pos.copy(M.position);
    return;
  }

  camera.getWorldDirection(endermanFwd);
  if (!inboundGrab && !e.falling && endermanAimed(e, endermanFwd)) {
    e.lookT += dt;
    if (e.lookT > ENDERMAN_STARE_TIME) {
      e.lookT = 0;
      e.angry = ENDERMAN_ANGRY_TIME;
      e.eyeRedT = ENDERMAN_RED_TIME;
      const px = Math.floor(pos.x), pz = Math.floor(pos.z);
      const spot = endermanSpotFor(e, px, pz, ENDERMAN_BLINK_DIST, headX, headZ, ENDERMAN_BLINK_DIST);
      endermanTeleport(e, spot.x, spot.z, spot.y);
      showMsg("An Enderman is angered — stop staring!");
    }
  } else {
    e.lookT = Math.max(0, e.lookT - dt * 2);
  }
  e.pos.copy(M.position);
}

// ---------------------------------------------------------------------------
// Save / load
// World saves always go to disk: with `python3 server.py` running, every world
// is a .sav file in save/ on disk, named when you press New World; otherwise
// Chromium writes to a user-picked file via the File System Access API. Same
// binary format either way.
// ---------------------------------------------------------------------------
const SAVE_MAGIC = [0x4d, 0x49, 0x4e, 0x49, 0x43, 0x52, 0x41, 0x46, 0x54]; // "MINICRAFT"
const fileMode = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
const fileDirOK = typeof window.showDirectoryPicker === "function";
const apiOkPromise = fetch("api/worlds").then((r) => r.ok).catch(() => false);
let apiOk = false;
apiOkPromise.then((v) => { apiOk = v; });
const serverSaveDirPromise = fetch("api/save-dir").then((r) => (r.ok ? r.json() : null)).catch(() => null);
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
let saveHandle = null;
let saveName = "";
let started = false;
let lastManualSave = 0;
let loading = false;
let menuBusy = false;
const loadingEl = document.getElementById("loading");
function setLoading(on) {
  loading = on;
  if (on) simPauseStart = 0;
  if (loadingEl) loadingEl.style.display = on ? "flex" : "none";
}

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("minicraft", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saves");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Upper spiral presence per run (visible bulbs in the top spire tail above
// summit + 0.2), shared by the live star gate and the save flag. Each run's
// tail is its terminal chunk: from its last strictly-contained bulb up to the
// very top. Only breaking a tail's anchor block hides it (atomic span); the
// closure and float rules never touch it.
function countUpperVisible(p, pts, hide) {
  const summit = pineSummit(p.y, p.m, p.e);
  const up = [0, 0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    if (hide && hide.has(i)) continue;
    const b = pts[i];
    if (b.y > summit + 0.2) up[b.run]++;
  }
  return up;
}
// Star presence derived live (at least one top spire chunk still visible: the
// star drops only once all 4 terminal chunks are broken),
// dim-safe via a temporary overworld switch (same pattern as deserialize).
function pineStarOk(p) {
  if (!moonZoneGeo(p.x, p.y, p.z)) return false;   // moon pines only
  const liveDim = dim, liveWorld = world;
  dim = "over"; world = worlds.over;
  let ok = false;
  try {
    const pts = garlandPathFor(p);
    const hide = garlandTrimSet(p, pts);
    ok = countUpperVisible(p, pts, hide).some((c) => c > 0);
  } finally {
    dim = liveDim; world = liveWorld;
  }
  return ok;
}
function serialize() {
  const count = (map) => { let n = 0; map.forEach(() => n++); return n; };
  const over = worlds.over, end = worlds.end, nether = worlds.nether;
  const on = count(over), en = count(end), nn = count(nether);
  const m = placedFlowers.size;
  const gov = glowVariants.over.size, gev = glowVariants.end.size, gnv = glowVariants.nether.size;
  const winLen = overPortalWin ? 12 : 1;
  const mergeSuspendedMobs = (dimName, cache) => {
    const base = (cache && cache.length ? cache : []).map((e) => Object.assign({}, e));
    const ids = new Set(base.map((e) => e.id));
    for (const e of snapshotMobsForDim(dimName, true)) if (!ids.has(e.id)) { ids.add(e.id); base.push(e); }
    return base;
  };
  let overMobs = dim === "over" ? snapshotMobsForDim("over", true) : mergeSuspendedMobs("over", overworldMobCache);
  let endMobs = dim === "end" ? snapshotMobsForDim("end", true) : mergeSuspendedMobs("end", endMobCache);
  let netherMobs = dim === "nether" ? snapshotMobsForDim("nether", true) : mergeSuspendedMobs("nether", netherMobCache);
  let carriedDim = 0;
  let carriedIdx = -1;
  if (carryMob && mobs.includes(carryMob)) {
    const hd = mobDimOf(carryMob);
    carriedDim = hd === "end" ? 1 : hd === "nether" ? 2 : 0;
    const li = [overMobs, endMobs, netherMobs][carriedDim].findIndex((e) => e.id === carryMob.id);
    if (li >= 0) carriedIdx = li;
    else carriedDim = 0;
  }
  if (dim === "over") overworldMobCache = snapshotMobsForDim("over", false);
  else if (dim === "end") endMobCache = snapshotMobsForDim("end", false);
  else if (dim === "nether") netherMobCache = snapshotMobsForDim("nether", false);
  pendingCarriedIdx = null;
  const mobN = overMobs.length, endMobN = endMobs.length, netherMobN = netherMobs.length;
  const chainPairs = dim === "over" ? snapshotChainPairsForDim("over", overMobs) : (pendingChainLinks || []);
  const chainPairsEnd = dim === "end" ? snapshotChainPairsForDim("end", endMobs, true) : (pendingChainLinksEnd || []);
  const chainPairsNether = dim === "nether" ? snapshotChainPairsForDim("nether", netherMobs) : (pendingChainLinksNether || []);
  const exitBytes = (netherExit ? 33 : 1) + (endExit ? 33 : 1);
  const liveTNTSize = snapshotLiveTNT();
  const dragonPresent = dragonSaveable() || (dim === "end" && !endCleared && dragon.mesh && dragon.dying > 0);
  let tntBytes = 1 + 4 + 4 + 4;
  if (dragonPresent) tntBytes += 43;
  for (const b of liveTNTSize.bombs) tntBytes += b.targetKind === 2 ? 55 : 42;
  for (const e of liveTNTSize.queue) tntBytes += e.qKind === 2 ? 32 : 19;
  for (const e of liveTNTSize.etas) tntBytes += e.targetKind === 2 ? 18 : 5;
  const liveFx = snapshotLiveFx();
  const fxBytes = 4 + liveFx.length * 17;
  const villagePanicRemain = villagePanicUntil > 0 ? Math.min(Math.max(0, villagePanicUntil - performance.now() / 1000), VILLAGE_PANIC_TIME) : 0;
  const growN = growableSoils.size;
  const growthN = pineGrowths.length;
  const pineN = plantedPines.size;
  const brokenCells = [];
  for (const p of plantedPines.values()) {
    const soil = key(p.x, p.y, p.z) + "|";
    for (const bk of brokenPineCells) {
      if (!bk.startsWith(soil)) continue;
      const [cx, cy, cz] = bk.slice(soil.length).split(",").map(Number);
      if (![cx, cy, cz].every(Number.isFinite)) continue;
      if (cx < -128 || cx > 127 || cz < -128 || cz > 127 || cy < 0 || cy > 65535) continue;
      brokenCells.push([p.x, p.y, p.z, cx, cy, cz]);
    }
  }
  const brokenN = brokenCells.length;
  const buf = new ArrayBuffer(117 + 18 + (on + en + nn) * 5 + m * 6 + (gov + gev + gnv) * 5 + 1 + 4 + growN * 14 + 4 + growthN * 16 + 5 + pineN * 10 + winLen + 16 + 4 + (mobN + endMobN + netherMobN) * MOB_SAVE_BYTES + 24 + 4 + (chainPairs.length + chainPairsEnd.length + chainPairsNether.length) * 4 + 4 + 1 + 1 + 4 + exitBytes + tntBytes + fxBytes + 2 + 4 + brokenN * 8);
  const dv = new DataView(buf);
  let o = 0;
  new Uint8Array(buf, o, 9).set(SAVE_MAGIC); o += 9;
  dv.setUint8(o++, 38); // format version
  dv.setUint8(o++, dim === "end" ? 1 : dim === "nether" ? 2 : 0);
  dv.setInt32(o, seed, true); o += 4;
  dv.setInt32(o, endSeed, true); o += 4;
  dv.setInt32(o, netherSeed, true); o += 4;
  dv.setFloat64(o, pos.x, true); o += 8;
  dv.setFloat64(o, pos.y, true); o += 8;
  dv.setFloat64(o, pos.z, true); o += 8;
  dv.setFloat64(o, yaw, true); o += 8;
  dv.setFloat64(o, pitch, true); o += 8;
  dv.setUint8(o++, freeCam ? 1 : 0);
  dv.setUint8(o++, selected);
  dv.setFloat64(o, overPortalSpawn.x, true); o += 8;
  dv.setFloat64(o, overPortalSpawn.y, true); o += 8;
  dv.setFloat64(o, overPortalSpawn.z, true); o += 8;
  if (overPortalWin) {
    dv.setUint8(o++, 1);
    dv.setUint8(o++, overPortalWin.nether ? 1 : 0);
    dv.setUint8(o++, overPortalWin.orient === "v" ? 1 : 0);
    dv.setUint8(o++, overPortalWin.face === "x" ? 1 : 0);
    dv.setUint8(o++, overPortalWin.dims === "4x5" ? 1 : overPortalWin.dims === "4x4" ? 2 : overPortalWin.dims === "5x4" ? 3 : 0);
    dv.setUint8(o++, overPortalWin.h === 4 ? 1 : 0);
    dv.setInt16(o, overPortalWin.minX, true); o += 2;
    dv.setUint16(o, overPortalWin.minY, true); o += 2;
    dv.setInt16(o, overPortalWin.minZ, true); o += 2;
  } else {
    dv.setUint8(o++, 0);
  }
  dv.setFloat64(o, overPortalDir ? overPortalDir.x : 0, true); o += 8;
  dv.setFloat64(o, overPortalDir ? overPortalDir.z : 0, true); o += 8;
  const writeMap = (map, n) => {
    dv.setUint32(o, n, true); o += 4;
    map.forEach((id, k) => {
      const [x, y, z] = keyXYZ(k);
      dv.setUint8(o++, x + 128);
      dv.setUint16(o, y, true); o += 2;
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
    dv.setUint16(o, fy, true); o += 2;
    dv.setUint8(o++, fz + 128);
    dv.setUint8(o++, p.v);
    dv.setUint8(o++, Math.round(p.a / (Math.PI * 2) * 255));
  });
  const writeVariants = (map, n) => {
    dv.setUint32(o, n, true); o += 4;
    map.forEach((v, k) => {
      const [x, y, z] = keyXYZ(k);
      dv.setUint8(o++, x + 128);
      dv.setUint16(o, y, true); o += 2;
      dv.setUint8(o++, z + 128);
      dv.setUint8(o++, v);
    });
  };
  writeVariants(glowVariants.over, gov);
  writeVariants(glowVariants.end, gev);
  writeVariants(glowVariants.nether, gnv);
  dv.setUint32(o, growN, true); o += 4;
  growableSoils.forEach((g) => {
    dv.setUint8(o++, g.x + 128);
    dv.setUint16(o, g.y, true); o += 2;
    dv.setUint8(o++, g.z + 128);
    dv.setFloat32(o, g.timer != null ? g.timer : -1, true); o += 4;
    dv.setUint8(o++, g.wet ? 1 : 0);
    dv.setFloat32(o, g.soak != null ? g.soak : -1, true); o += 4;
    dv.setUint8(o++, g.liq === MOON_WATER ? 1 : 0);
  });
  dv.setUint32(o, growthN, true); o += 4;
  for (const pg of pineGrowths) {
    dv.setUint8(o++, pg.sx + 128);
    dv.setUint16(o, pg.sy, true); o += 2;
    dv.setUint8(o++, pg.sz + 128);
    dv.setUint8(o++, pg.dims.m);
    dv.setUint16(o, pg.dims.e, true); o += 2;
    dv.setUint32(o, pg.idx, true); o += 4;
    dv.setFloat32(o, pg.acc, true); o += 4;
    dv.setUint8(o++, 1);   // retired pine shape, cone only now
  }
  dv.setUint8(o++, 1);   // garland style, fixed spirale
  dv.setUint32(o, pineN, true); o += 4;
  for (const p of plantedPines.values()) {
    dv.setUint8(o++, p.x + 128);
    dv.setUint16(o, p.y, true); o += 2;
    dv.setUint8(o++, p.z + 128);
    dv.setUint8(o++, p.m);
    dv.setUint16(o, p.e, true); o += 2;
    dv.setUint8(o++, p.seed & 255);
    dv.setUint8(o++, 1);   // retired pine shape, cone only now
    dv.setUint8(o++, pineStarOk(p) ? 1 : 0);   // star shown now (v38)
  }
  dv.setUint32(o, brokenN, true); o += 4;
  for (const [sx, sy, sz, cx, cy, cz] of brokenCells) {
    dv.setUint8(o++, sx + 128);
    dv.setUint16(o, sy, true); o += 2;
    dv.setUint8(o++, sz + 128);
    dv.setUint8(o++, cx + 128);
    dv.setUint16(o, cy, true); o += 2;
    dv.setUint8(o++, cz + 128);
  }
  dv.setUint8(o++, starStyleIdx);
  dv.setUint8(o++, 0);   // retired pine choice, cone only now
  dv.setUint8(o++, decorVisible ? 1 : 0);
  const writeMob = (em) => {
    dv.setUint8(o++, em.kind & 255);
    let mfl = em.isBaby ? 1 : 0;
    if (em.villageBound !== false) mfl |= 2;
    if (em.penBound) mfl |= 4;
    dv.setUint8(o++, mfl);
    dv.setInt8(o++, Math.max(-128, Math.min(127, em.homeId)));
    dv.setInt16(o, Math.max(-1, Math.min(32767, em.parentIdx)), true); o += 2;
    dv.setFloat32(o, em.x, true); o += 4;
    dv.setFloat32(o, em.y, true); o += 4;
    dv.setFloat32(o, em.z, true); o += 4;
    dv.setFloat32(o, isFinite(em.yaw) ? em.yaw : 0, true); o += 4;
    dv.setUint8(o++, em.look & 255);
    dv.setFloat32(o, isFinite(em.fleeRemain) ? Math.max(0, em.fleeRemain) : 0, true); o += 4;
    dv.setFloat32(o, isFinite(em.panicT) ? Math.max(0, em.panicT) : 0, true); o += 4;
    dv.setFloat32(o, isFinite(em.panicUntilRemain) ? Math.max(0, em.panicUntilRemain) : 0, true); o += 4;
    dv.setFloat32(o, isFinite(em.panicSrcX) ? em.panicSrcX : 0, true); o += 4;
    dv.setFloat32(o, isFinite(em.panicSrcZ) ? em.panicSrcZ : 0, true); o += 4;
    let pf = (em.panicFlags & 255) || 0;
    if (em.portalSent) pf |= 4;
    dv.setUint8(o++, pf);
  };
  dv.setUint32(o, mobN, true); o += 4;
  for (const em of overMobs) writeMob(em);
  dv.setFloat64(o, vel.x, true); o += 8;
  dv.setFloat64(o, vel.y, true); o += 8;
  dv.setFloat64(o, vel.z, true); o += 8;
  dv.setUint32(o, chainPairs.length, true); o += 4;
  for (const [a, b] of chainPairs) {
    dv.setUint16(o, a, true); o += 2;
    dv.setUint16(o, b, true); o += 2;
  }
  dv.setInt32(o, carriedIdx, true); o += 4;
  dv.setUint32(o, endMobN, true); o += 4;
  for (const em of endMobs) writeMob(em);
  dv.setUint32(o, chainPairsEnd.length, true); o += 4;
  for (const [a, b] of chainPairsEnd) {
    dv.setUint16(o, a, true); o += 2;
    dv.setUint16(o, b, true); o += 2;
  }
  dv.setUint32(o, netherMobN, true); o += 4;
  for (const em of netherMobs) writeMob(em);
  dv.setUint32(o, chainPairsNether.length, true); o += 4;
  for (const [a, b] of chainPairsNether) {
    dv.setUint16(o, a, true); o += 2;
    dv.setUint16(o, b, true); o += 2;
  }
  dv.setUint8(o++, carriedDim & 255);
  dv.setUint8(o++, endCleared ? 1 : 0);
  dv.setFloat32(o, villagePanicRemain, true); o += 4;
  const writeExit = (ex) => {
    if (!ex) { dv.setUint8(o++, 0); return; }
    dv.setUint8(o++, 1);
    dv.setFloat64(o, ex.x, true); o += 8;
    dv.setFloat64(o, ex.y, true); o += 8;
    dv.setFloat64(o, ex.z, true); o += 8;
    dv.setFloat64(o, ex.yaw || 0, true); o += 8;
  };
  writeExit(netherExit);
  writeExit(endExit);
  if (dragonPresent) {
    const mp = dragon.mesh.position;
    dv.setUint8(o++, 1);
    dv.setFloat32(o, dragon.hp, true); o += 4;
    dv.setUint16(o, dragon.hitCount & 65535, true); o += 2;
    dv.setFloat32(o, mp.x, true); o += 4;
    dv.setFloat32(o, mp.y, true); o += 4;
    dv.setFloat32(o, mp.z, true); o += 4;
    dv.setFloat32(o, dragon.yaw || 0, true); o += 4;
    dv.setFloat32(o, dragon.pitch || 0, true); o += 4;
    const wasDying = dragon.dying > 0;
    dv.setFloat32(o, wasDying ? dragon.dying : 0, true); o += 4;
    dv.setUint8(o++, wasDying ? dragon.deathIdx & 255 : 0);
    dv.setFloat32(o, wasDying ? dragon.deathX : mp.x, true); o += 4;
    dv.setFloat32(o, wasDying ? dragon.deathY : mp.y, true); o += 4;
    dv.setFloat32(o, wasDying ? dragon.deathZ : mp.z, true); o += 4;
  } else {
    dv.setUint8(o++, 0);
  }
  const liveTNT = liveTNTSize;
  dv.setUint32(o, liveTNT.bombs.length, true); o += 4;
  for (const b of liveTNT.bombs) {
    const t = b.t;
    dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(t.bx))), true); o += 2;
    dv.setUint16(o, Math.max(0, Math.min(65535, Math.round(t.by))), true); o += 2;
    dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(t.bz))), true); o += 2;
    dv.setFloat32(o, t.px, true); o += 4;
    dv.setFloat32(o, t.py, true); o += 4;
    dv.setFloat32(o, t.pz, true); o += 4;
    dv.setFloat32(o, t.fuse, true); o += 4;
    dv.setFloat32(o, t.life, true); o += 4;
    dv.setUint8(o++, t.stuck ? 1 : 0);
    dv.setFloat32(o, t.ax || 0, true); o += 4;
    dv.setFloat32(o, t.ay || 0, true); o += 4;
    dv.setFloat32(o, t.az || 0, true); o += 4;
    dv.setUint8(o++, t.mesh ? 1 : 0);
    dv.setUint8(o++, t.by < 0 ? 1 : 0);
    dv.setUint8(o++, b.targetKind & 255);
    if (b.targetKind === 2) {
      dv.setUint8(o++, b.tkind & 255);
      dv.setFloat32(o, b.tx, true); o += 4;
      dv.setFloat32(o, b.ty, true); o += 4;
      dv.setFloat32(o, b.tz, true); o += 4;
    }
  }
  dv.setUint32(o, liveTNT.queue.length, true); o += 4;
  for (const e of liveTNT.queue) {
    const q = e.q;
    dv.setFloat32(o, q.x, true); o += 4;
    dv.setFloat32(o, q.y, true); o += 4;
    dv.setFloat32(o, q.z, true); o += 4;
    dv.setUint8(o++, q.pointBlank ? 1 : 0);
    dv.setUint8(o++, q.homing ? 1 : 0);
    dv.setUint8(o++, e.qKind & 255);
    if (e.qKind === 2) {
      dv.setUint8(o++, e.qk & 255);
      dv.setFloat32(o, e.qx, true); o += 4;
      dv.setFloat32(o, e.qy, true); o += 4;
      dv.setFloat32(o, e.qz, true); o += 4;
    }
    const remain = q.due ? Math.max(0, (q.due - performance.now()) / 1000) : 0;
    dv.setFloat32(o, remain, true); o += 4;
  }
  dv.setUint32(o, liveTNT.etas.length, true); o += 4;
  for (const e of liveTNT.etas) {
    dv.setUint8(o++, e.targetKind & 255);
    if (e.targetKind === 2) {
      dv.setUint8(o++, e.tkind & 255);
      dv.setFloat32(o, e.tx, true); o += 4;
      dv.setFloat32(o, e.ty, true); o += 4;
      dv.setFloat32(o, e.tz, true); o += 4;
    }
    dv.setFloat32(o, e.eta, true); o += 4;
  }
  dv.setUint32(o, liveFx.length, true); o += 4;
  for (const f of liveFx) {
    dv.setUint8(o++, f.tag & 255);
    dv.setFloat32(o, f.x, true); o += 4;
    dv.setFloat32(o, f.y, true); o += 4;
    dv.setFloat32(o, f.z, true); o += 4;
    dv.setUint32(o, f.hex >>> 0, true); o += 4;
  }
  return buf;
}

function deserialize(buf) {
  const dv = new DataView(buf);
  let o = 0;
  for (let i = 0; i < 9; i++) if (new Uint8Array(buf, o, 9)[i] !== SAVE_MAGIC[i]) throw new Error("Not a MiniCraft save");
  o += 9;
  const ver = dv.getUint8(o++);
  if (ver !== 1 && ver !== 2 && ver !== 3 && ver !== 4 && ver !== 5 && ver !== 6 && ver !== 7 && ver !== 8 && ver !== 9 && ver !== 10 && ver !== 11 && ver !== 12 && ver !== 13 && ver !== 14 && ver !== 15 && ver !== 16 && ver !== 17 && ver !== 18 && ver !== 19 && ver !== 20 && ver !== 21 && ver !== 22 && ver !== 23 && ver !== 24 && ver !== 25 && ver !== 26 && ver !== 27 && ver !== 28 && ver !== 29 && ver !== 30 && ver !== 31 && ver !== 32 && ver !== 33 && ver !== 34 && ver !== 35 && ver !== 36 && ver !== 37 && ver !== 38) throw new Error("Unsupported save version");
  const yWidth = ver >= 8 ? 2 : 1;
  const readY = () => { const y = yWidth === 2 ? dv.getUint16(o, true) : dv.getUint8(o); o += yWidth; return y; };
  placedFlowers.clear();
  growableSoils.clear();
  plantedPines.clear();
  brokenPineCells.clear();
  garlandDirty = true;
  wetSoilSet.clear();
  clearAllSoakMeshes();
  clearAllPineFailBlinks();
  plantClaims.clear();
  pineGrowths.length = 0;
  clearAllPineReservations();
  clearAllSoilTimerSprites();
  glowVariants.over.clear();
  glowVariants.end.clear();
  glowVariants.nether.clear();
  pendingOverworldMobs = null;
  overworldMobCache = null;
  pendingChainLinks = null;
  pendingCarriedIdx = null;
  pendingEndMobs = null;
  pendingNetherMobs = null;
  endMobCache = null;
  netherMobCache = null;
  pendingChainLinksEnd = null;
  pendingChainLinksNether = null;
  pendingCarriedDim = 0;
  netherExit = null;
  endExit = null;
  endCleared = false;
  pendingDragon = null;
  pendingTNTBombs = null;
  pendingTNTQueue = null;
  pendingTNTEta = null;
  pendingFx = null;
  pendingVillagePanic = 0;
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
  const flyFlag = dv.getUint8(o++) === 1;
  selected = dv.getUint8(o++);
  overPortalSpawn = { x: dv.getFloat64(o, true), y: dv.getFloat64(o, true), z: dv.getFloat64(o, true) };
  o += 24;
  overPortalWin = null;
  overPortalDir = null;
  overPortalFace = null;
  if (ver >= 9) {
    const hasWin = dv.getUint8(o++);
    if (hasWin) {
      const nether = dv.getUint8(o++) === 1;
      const orient = dv.getUint8(o++) === 1 ? "v" : "h";
      const face = dv.getUint8(o++) === 1 ? "x" : "z";
      const dimsCode = dv.getUint8(o++);
      const hCode = dv.getUint8(o++);
      const minX = dv.getInt16(o, true); o += 2;
      const minY = dv.getUint16(o, true); o += 2;
      const minZ = dv.getInt16(o, true); o += 2;
      overPortalWin = {
        nether, orient, face,
        dims: dimsCode === 1 ? "4x5" : dimsCode === 2 ? "4x4" : dimsCode === 3 ? "5x4" : undefined,
        minX, minY, minZ,
      };
      if (orient === "v" && !nether && hCode === 1) overPortalWin.h = 4;
    }
    const dx = dv.getFloat64(o, true); o += 8;
    const dz = dv.getFloat64(o, true); o += 8;
    if (dx || dz) overPortalDir = { x: dx, z: dz };
  }
  const n = dv.getUint32(o, true); o += 4;
  worlds.over.clear();
  for (let i = 0; i < n; i++) {
    const x = dv.getUint8(o++) - 128;
    const y = readY();
    const z = dv.getUint8(o++) - 128;
    worlds.over.set(key(x, y, z), dv.getUint8(o++));
  }
  if (ver >= 2) {
    const ne = dv.getUint32(o, true); o += 4;
    worlds.end.clear();
    for (let i = 0; i < ne; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = readY();
      const z = dv.getUint8(o++) - 128;
      worlds.end.set(key(x, y, z), dv.getUint8(o++));
    }
  }
  if (ver >= 4) {
    const nn = dv.getUint32(o, true); o += 4;
    worlds.nether.clear();
    for (let i = 0; i < nn; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = readY();
      const z = dv.getUint8(o++) - 128;
      worlds.nether.set(key(x, y, z), dv.getUint8(o++));
    }
  }
  if (ver >= 3) {
    const m = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < m; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = readY();
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
        const y = readY();
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
  if (ver >= 22) {
    const gn = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < gn; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = readY();
      const z = dv.getUint8(o++) - 128;
      let timer = null;
      if (ver >= 23) {
        const tr = dv.getFloat32(o, true); o += 4;
        if (isFinite(tr) && tr > 0) timer = tr;
      }
      let wet = false, soak = null, liq = WATER;
      if (ver >= 27) {
        wet = dv.getUint8(o++) === 1;
        const sr = dv.getFloat32(o, true); o += 4;
        if (isFinite(sr) && sr > 0) soak = sr;
      }
      if (ver >= 28) liq = dv.getUint8(o++) === 1 ? MOON_WATER : WATER;
      const gk = key(x, y, z);
      growableSoils.set(gk, { x, y, z, timer, wet, soak, liq });
      if (wet) wetSoilSet.add(gk);
      if (soak != null) syncSoakMesh(gk, growableSoils.get(gk));
    }
  }
  if (ver >= 23) {
    const pgn = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < pgn; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = readY();
      const z = dv.getUint8(o++) - 128;
      if (ver >= 26) {
        const mm = dv.getUint8(o++);
        const ee = dv.getUint16(o, true); o += 2;
        const idx = dv.getUint32(o, true); o += 4;
        const acc = dv.getFloat32(o, true); o += 4;
        if (ver >= 36) dv.getUint8(o++);   // retired pine shape, cone only now
      if (mm < PINE_MIN_M || mm > MOON_PINE_MAX_M || ee < 1 || y + ee + pineLayerWidths(mm).length + 1 > MAX_Y) continue;
        const cells = pineCellsFor(x, y, z, mm, ee);
        if (!cells.length || idx > cells.length) continue;
        pineGrowths.push({ cells, idx, acc: isFinite(acc) ? Math.max(0, acc) : 0, dims: { m: mm, e: ee }, sx: x, sy: y, sz: z, phaseCounts: pinePhaseCounts(cells) });
      } else if (ver >= 24) {
        o += 1 + 2 + 4 + 4;
      } else {
        o += 2 + 1 + 4 + 4;
      }
    }
  }
  if (ver >= 33) {
    dv.getUint8(o++);   // garland style byte, fixed spirale
    const pn = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < pn; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = readY();
      const z = dv.getUint8(o++) - 128;
      const mm = dv.getUint8(o++);
      const ee = dv.getUint16(o, true); o += 2;
      const sd = dv.getUint8(o++);
      if (ver >= 36) dv.getUint8(o++);   // retired pine shape, cone only now
      const sf = ver >= 38 ? dv.getUint8(o++) : 1;   // star shown (v38)
      if (mm < PINE_MIN_M || mm > MOON_PINE_MAX_M || ee < 1 || y + ee + pineLayerWidths(mm).length + 1 > MAX_Y) continue;
      const entry = { x, y, z, m: mm, e: ee, seed: sd, bornAt: -1e9 };
      plantedPines.set(key(x, y, z), entry);
      if (sf === 0 && pineStarOk(entry)) entry.bornAt = performance.now() / 1000;   // replay birth
    }
  }
  if (ver >= 38) {
    const bn = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < bn; i++) {
      const sx = dv.getUint8(o++) - 128;
      const sy = readY();
      const sz = dv.getUint8(o++) - 128;
      const cx = dv.getUint8(o++) - 128;
      const cy = readY();
      const cz = dv.getUint8(o++) - 128;
      const sk = key(sx, sy, sz);
      if (!plantedPines.has(sk)) continue;
      if (worlds.over.has(key(cx, cy, cz))) continue;   // rebuilt solid: drop
      brokenPineCells.add(sk + "|" + cx + "," + cy + "," + cz);
    }
  }
  garlandDirty = true;
  starStyleIdx = 0;
  decorVisible = true;
  if (ver === 34) {
    // v34 carried per-star style entries; styles are global now, so the choice
    // is kept and the per-block entries are skipped.
    starStyleIdx = dv.getUint8(o++) % STAR_STYLE_COUNT;
    for (let s = 0; s < 3; s++) {
      const n = dv.getUint32(o, true); o += 4;
      o += n * 5;
    }
  } else if (ver >= 35) {
    starStyleIdx = dv.getUint8(o++) % STAR_STYLE_COUNT;
    if (ver >= 36) dv.getUint8(o++);   // retired pine choice, cone only now
    if (ver >= 37) decorVisible = dv.getUint8(o++) !== 0;
  }
  dim = dimFlag === 2 ? "nether" : dimFlag === 1 ? "end" : "over";
  world = worlds[dim];
  if (ver >= 10) {
    const mobN = dv.getUint32(o, true); o += 4;
    const arr = [];
    for (let i = 0; i < mobN; i++) {
      const kind = dv.getUint8(o++);
      const flags = dv.getUint8(o++);
      const homeId = dv.getInt8(o++);
      const parentIdx = dv.getInt16(o, true); o += 2;
      const x = dv.getFloat32(o, true); o += 4;
      const y = dv.getFloat32(o, true); o += 4;
      const z = dv.getFloat32(o, true); o += 4;
      let yaw = 0;
      if (ver >= 30) { yaw = dv.getFloat32(o, true); o += 4; }
      else { yaw = decodeMobYaw(dv.getUint8(o++)); }
      const look = dv.getUint8(o++);
      let fleeRemain = 0, panicT = 0, panicUntilRemain = 0, panicSrcX = 0, panicSrcZ = 0, panicFlags = 0;
      if (ver >= 21) {
        fleeRemain = dv.getFloat32(o, true); o += 4;
        panicT = dv.getFloat32(o, true); o += 4;
        panicUntilRemain = dv.getFloat32(o, true); o += 4;
        panicSrcX = dv.getFloat32(o, true); o += 4;
        panicSrcZ = dv.getFloat32(o, true); o += 4;
        panicFlags = dv.getUint8(o++);
      }
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      const e10 = { kind, isBaby: (flags & 1) !== 0, homeId, parentIdx, x, y, z, yaw: isFinite(yaw) ? yaw : 0, look, fleeRemain: isFinite(fleeRemain) ? Math.max(0, fleeRemain) : 0, panicT: isFinite(panicT) ? Math.max(0, panicT) : 0, panicUntilRemain: isFinite(panicUntilRemain) ? Math.max(0, panicUntilRemain) : 0, panicSrcX: isFinite(panicSrcX) ? panicSrcX : 0, panicSrcZ: isFinite(panicSrcZ) ? panicSrcZ : 0, panicFlags: panicFlags & 255 };
      if (ver >= 11) { e10.villageBound = (flags & 2) !== 0; e10.penBound = (flags & 4) !== 0; }
      arr.push(e10);
    }
    pendingOverworldMobs = arr;
    overworldMobCache = arr.map((e) => ({ ...e }));
  }
  if (ver >= 14) {
    vel.set(dv.getFloat64(o, true), dv.getFloat64(o + 8, true), dv.getFloat64(o + 16, true)); o += 24;
    const cn = dv.getUint32(o, true); o += 4;
    pendingChainLinks = [];
    for (let i = 0; i < cn; i++) {
      const a = dv.getUint16(o, true); o += 2;
      const b = dv.getUint16(o, true); o += 2;
      pendingChainLinks.push([a, b]);
    }
  }
  if (ver >= 15) {
    const ci = dv.getInt32(o, true); o += 4;
    pendingCarriedIdx = (ci >= 0 && pendingOverworldMobs && ci < pendingOverworldMobs.length) ? ci : null;
  }
  if (ver >= 16) {
    const readMobList = () => {
      const n = dv.getUint32(o, true); o += 4;
      const arr = [];
      for (let i = 0; i < n; i++) {
        const kind = dv.getUint8(o++);
        const flags = dv.getUint8(o++);
        const homeId = dv.getInt8(o++);
        const parentIdx = dv.getInt16(o, true); o += 2;
        const x = dv.getFloat32(o, true); o += 4;
        const y = dv.getFloat32(o, true); o += 4;
        const z = dv.getFloat32(o, true); o += 4;
        let yawR = 0;
        if (ver >= 30) { yawR = dv.getFloat32(o, true); o += 4; }
        else { yawR = decodeMobYaw(dv.getUint8(o++)); }
        const look = dv.getUint8(o++);
        let fleeRemain = 0, panicT = 0, panicUntilRemain = 0, panicSrcX = 0, panicSrcZ = 0, panicFlags = 0;
        if (ver >= 21) {
          fleeRemain = dv.getFloat32(o, true); o += 4;
          panicT = dv.getFloat32(o, true); o += 4;
          panicUntilRemain = dv.getFloat32(o, true); o += 4;
          panicSrcX = dv.getFloat32(o, true); o += 4;
          panicSrcZ = dv.getFloat32(o, true); o += 4;
          panicFlags = dv.getUint8(o++);
        }
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
        arr.push({ kind, isBaby: (flags & 1) !== 0, homeId, parentIdx, x, y, z, yaw: isFinite(yawR) ? yawR : 0, look, villageBound: (flags & 2) !== 0, penBound: (flags & 4) !== 0, fleeRemain: isFinite(fleeRemain) ? Math.max(0, fleeRemain) : 0, panicT: isFinite(panicT) ? Math.max(0, panicT) : 0, panicUntilRemain: isFinite(panicUntilRemain) ? Math.max(0, panicUntilRemain) : 0, panicSrcX: isFinite(panicSrcX) ? panicSrcX : 0, panicSrcZ: isFinite(panicSrcZ) ? panicSrcZ : 0, panicFlags: panicFlags & 255 });
      }
      return arr;
    };
    const readPairs = () => {
      const cn = dv.getUint32(o, true); o += 4;
      const pairs = [];
      for (let i = 0; i < cn; i++) {
        const a = dv.getUint16(o, true); o += 2;
        const b = dv.getUint16(o, true); o += 2;
        pairs.push([a, b]);
      }
      return pairs;
    };
    pendingEndMobs = readMobList();
    endMobCache = pendingEndMobs.map((e) => ({ ...e }));
    pendingChainLinksEnd = readPairs();
    pendingNetherMobs = readMobList();
    netherMobCache = pendingNetherMobs.map((e) => ({ ...e }));
    pendingChainLinksNether = readPairs();
    const cd = dv.getUint8(o++);
    pendingCarriedDim = cd === 1 ? 1 : cd === 2 ? 2 : 0;
    endCleared = dv.getUint8(o++) === 1;
    if (ver >= 21) {
      const vp = dv.getFloat32(o, true); o += 4;
      pendingVillagePanic = isFinite(vp) ? Math.min(Math.max(0, vp), VILLAGE_PANIC_TIME) : 0;
    }
    const readExit = () => {
      if (!dv.getUint8(o++)) return null;
      const x = dv.getFloat64(o, true); o += 8;
      const y = dv.getFloat64(o, true); o += 8;
      const z = dv.getFloat64(o, true); o += 8;
      const yawE = dv.getFloat64(o, true); o += 8;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
      return { x, y, z, yaw: yawE };
    };
    netherExit = readExit();
    endExit = readExit();
    if (pendingCarriedDim !== 0) {
      const list = pendingCarriedDim === 1 ? pendingEndMobs : pendingNetherMobs;
      if (!(pendingCarriedIdx >= 0 && list && pendingCarriedIdx < list.length)) pendingCarriedIdx = null;
    } else if (!(pendingCarriedIdx >= 0 && pendingOverworldMobs && pendingCarriedIdx < pendingOverworldMobs.length)) {
      pendingCarriedIdx = null;
    }
  }
  if (ver >= 17) {
    if (dv.getUint8(o++)) {
      const hp = dv.getFloat32(o, true); o += 4;
      const hitCount = ver >= 18 ? dv.getUint16(o, true) : dv.getUint8(o++);
      if (ver >= 18) o += 2;
      const dx = dv.getFloat32(o, true); o += 4;
      const dy = dv.getFloat32(o, true); o += 4;
      const dz = dv.getFloat32(o, true); o += 4;
      const dyaw = dv.getFloat32(o, true); o += 4;
      const dpitch = dv.getFloat32(o, true); o += 4;
      let dying = 0, deathIdx = 0, deathX = dx, deathY = dy, deathZ = dz;
      if (ver >= 20) {
        dying = dv.getFloat32(o, true); o += 4;
        deathIdx = dv.getUint8(o++);
        deathX = dv.getFloat32(o, true); o += 4;
        deathY = dv.getFloat32(o, true); o += 4;
        deathZ = dv.getFloat32(o, true); o += 4;
      }
      const alive = isFinite(hp) && hp > 0;
      const agonizing = isFinite(dying) && dying > 0 && [deathX, deathY, deathZ].every(isFinite);
      pendingDragon = ((alive || agonizing) && [dx, dy, dz].every(isFinite))
        ? { hp: alive ? hp : 0, hitCount, x: dx, y: dy, z: dz, yaw: dyaw, pitch: dpitch, dying: agonizing ? dying : 0, deathIdx, deathX, deathY, deathZ } : null;
    }
    const readBombs = () => {
      const n = dv.getUint32(o, true); o += 4;
      const arr = [];
      for (let i = 0; i < n; i++) {
        const bx = dv.getInt16(o, true); o += 2;
        const by = dv.getUint16(o, true); o += 2;
        const bz = dv.getInt16(o, true); o += 2;
        const px = dv.getFloat32(o, true); o += 4;
        const py = dv.getFloat32(o, true); o += 4;
        const pz = dv.getFloat32(o, true); o += 4;
        const fuse = dv.getFloat32(o, true); o += 4;
        const life = dv.getFloat32(o, true); o += 4;
        const stuck = dv.getUint8(o++) === 1;
        const ax = dv.getFloat32(o, true); o += 4;
        const ay = dv.getFloat32(o, true); o += 4;
        const az = dv.getFloat32(o, true); o += 4;
        const hasMesh = dv.getUint8(o++) === 1;
        const flyFlag = ver >= 18 ? dv.getUint8(o++) === 1 : by < 0;
        const targetKind = dv.getUint8(o++);
        let tkind = 0, tx = 0, ty = 0, tz = 0;
        if (targetKind === 2) {
          tkind = dv.getUint8(o++);
          tx = dv.getFloat32(o, true); o += 4;
          ty = dv.getFloat32(o, true); o += 4;
          tz = dv.getFloat32(o, true); o += 4;
        }
        if (![px, py, pz, fuse, life].every(isFinite)) continue;
        arr.push({ bx, by, bz, px, py, pz, fuse, life, stuck, ax, ay, az, hasMesh, fly: flyFlag, targetKind, tkind, tx, ty, tz });
      }
      return arr;
    };
    const readQueue = () => {
      const n = dv.getUint32(o, true); o += 4;
      const arr = [];
      for (let i = 0; i < n; i++) {
        const x = dv.getFloat32(o, true); o += 4;
        const y = dv.getFloat32(o, true); o += 4;
        const z = dv.getFloat32(o, true); o += 4;
        const pointBlank = dv.getUint8(o++) === 1;
        const homing = dv.getUint8(o++) === 1;
        const qKind = dv.getUint8(o++);
        let qk = 0, qx = 0, qy = 0, qz = 0;
        if (qKind === 2) {
          qk = dv.getUint8(o++);
          qx = dv.getFloat32(o, true); o += 4;
          qy = dv.getFloat32(o, true); o += 4;
          qz = dv.getFloat32(o, true); o += 4;
        }
        const remain = dv.getFloat32(o, true); o += 4;
        if (![x, y, z].every(isFinite)) continue;
        arr.push({ x, y, z, pointBlank, homing, qKind, qk, qx, qy, qz, remain: isFinite(remain) ? remain : 0 });
      }
      return arr;
    };
    pendingTNTBombs = readBombs();
    pendingTNTQueue = readQueue();
    if (ver >= 18) {
      const n = dv.getUint32(o, true); o += 4;
      pendingTNTEta = [];
      for (let i = 0; i < n; i++) {
        const targetKind = dv.getUint8(o++);
        let tkind = 0, tx = 0, ty = 0, tz = 0;
        if (targetKind === 2) {
          tkind = dv.getUint8(o++);
          tx = dv.getFloat32(o, true); o += 4;
          ty = dv.getFloat32(o, true); o += 4;
          tz = dv.getFloat32(o, true); o += 4;
        }
        const eta = dv.getFloat32(o, true); o += 4;
        if (targetKind !== 1 && targetKind !== 2) continue;
        if (!isFinite(eta) || eta <= 0) continue;
        pendingTNTEta.push({ targetKind, tkind, tx, ty, tz, eta });
      }
    }
    if (ver >= 19) {
      const n = dv.getUint32(o, true); o += 4;
      pendingFx = [];
      for (let i = 0; i < n; i++) {
        const tag = dv.getUint8(o++);
        const x = dv.getFloat32(o, true); o += 4;
        const y = dv.getFloat32(o, true); o += 4;
        const z = dv.getFloat32(o, true); o += 4;
        const hex = dv.getUint32(o, true); o += 4;
        if (tag > 3 || ![x, y, z].every(isFinite)) continue;
        pendingFx.push({ tag, x, y, z, hex });
      }
    }
  }
  freeCam = flyFlag;
  if (freeCam) camPos.copy(pos);
  worldDirty = true;
  rebuildColTops();
  {
    const liveDim = dim, liveWorld = world;
    dim = "over"; world = worlds.over;
    for (const g of pineGrowths) reservePineCells(key(g.sx, g.sy, g.sz), g.cells);
    for (const [gk, g] of growableSoils) {
      if (getBlock(g.x, g.y, g.z) !== DIRT) continue;
      const dims = pickPineDims(g.x, g.y, g.z, gk);
      if (dims) reservePineCells(gk, pineCellsFor(g.x, g.y, g.z, dims.m, dims.e));
    }
    dim = liveDim; world = liveWorld;
  }
  rebuildPortalBlocks();
  rebuildHotbar();
  recomputeGlowClusters();
  syncGlowLights();
  moonLakesGenerated = false;
  moonLakesChunkSet.clear();
  for (const [k, id] of worlds.over) if (id === MOON_WATER) {
    moonLakesGenerated = true;
    const [x, , z] = keyXYZ(k);
    moonLakesChunkSet.add(chunkOf(x) + "_" + chunkOf(z));
  }
  moonLakesVisible = false;
}

function canSave() {
  if (apiOk && saveName) return true;
  return fileMode && !!saveHandle;
}

function updateCamera() {
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(pitch, yaw, 0);
}

// ---------------------------------------------------------------------------
// HUD (dimension label, toast)
// ---------------------------------------------------------------------------
const dimEl = document.getElementById("dim");
const pineEl = document.getElementById("pine");
const toastEl = document.getElementById("toast");
const bossBarEl = document.getElementById("bossbar");
const bossFillEl = document.getElementById("bossfill");
let toastTimer = 0;

function updateBossBar() {
  if (!dragon.mesh || dragon.hp <= 0) { bossBarEl.style.display = "none"; return; }
  bossFillEl.style.width = Math.max(0, Math.round(dragon.hp / (dragon.maxHp || 1) * 100)) + "%";
  bossBarEl.style.display = "block";
}

function removeEndEntities() {
  if (dragon.mesh) removeDragon();
  if (endermen.length) removeEndermen();
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    if (m.dim !== "end" || m.kind === "dragon" || m.kind === "enderman") continue;
    if (m === carryMob || m === carryGrappleMob) continue;
    if (m.mesh) scene.remove(m.mesh);
    if (m.fallMesh) scene.remove(m.fallMesh);
    mobById.delete(m.id);
    mobs.splice(i, 1);
  }
  bossBarEl.style.display = "none";
}

function damageDragon(amount) {
  if (!dragon.mesh || dragon.hp <= 0) return;
  dragon.hp = Math.max(0, dragon.hp - amount);
  dragon.hitCount++;
  paintDragon();
  updateBossBar();
  if (dragon.hp <= 0) {
    dragon.deathTotal = DRAGON_HUES.length + 1;
    dragon.dying = 1.5;
    dragon.deathFlash = 0;
    dragon.deathIdx = 0;
    dragon.deathX = dragon.mesh.position.x;
    dragon.deathY = dragon.mesh.position.y;
    dragon.deathZ = dragon.mesh.position.z;
    dragon.spitting = 0;
    if (dragon.parts) for (const q of dragon.parts) { q.life = q.ttl; q.m.visible = false; }
  }
}

function updateDimLabel() {
  if (!started) { dimEl.style.display = "none"; pineEl.style.display = "none"; return; }
  dimEl.textContent = dim === "end" ? "The End" : dim === "nether" ? "The Nether" : "Overworld";
  dimEl.style.display = "block";
  if (!decorVisible) { pineEl.textContent = "Decor: off"; pineEl.style.display = "block"; }
  else pineEl.style.display = "none";
}
function showMsg(text) {
  toastEl.textContent = text;
  toastEl.style.opacity = "1";
  toastTimer = 2.6;
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
function askName(title, initial, saveDir) {
  return new Promise((resolve) => {
    const { dlg, box } = dialogEl();
    box.innerHTML = "<h2>" + title + "</h2>" +
      (saveDir && saveDir.display ? '<div class="dlg-path">' + escHtml(saveDir.display) + "</div>" : "") +
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
function pickWorld(entries, saveDir) {
  return new Promise((resolve) => {
    const names = entries.map((e) => (typeof e === "string" ? e : e.name));
    const { dlg, box } = dialogEl();
    let html = "<h2>Load save</h2>" +
      '<div class="dlg-path">' + escHtml((saveDir && saveDir.display) || "~/projects/tech/minicraft/save/") + "</div>";
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
    } catch {}
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
    }
    lastManualSave = Date.now();
  } catch (e) {
    worldDirty = true;
    showMsg(apiOk
      ? "Save failed — run `python3 server.py` and open http://localhost:8383"
      : "Save failed (file deleted or permission revoked) — pick a new save file");
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
    const liveDim = dim;
    clearChains();
    purgeLiveTNT();
    purgeLiveEffects();
    if (playerInChain()) detachDisplacementGrapple();
    for (const m of [...mobs]) {
      if (m.mesh) scene.remove(m.mesh);
      if (m.fallMesh) scene.remove(m.fallMesh);
    }
    mobs.length = 0;
    mobById.clear();
    endermen.length = 0;
    mobGrid.clear();
    visitGrid.clear();
    if (dragon.mesh) removeDragon();
    carryMob = null;
    carryGrappleMob = null;
    carryGrappleActive = false;
    carryGrapplePulling = false;
    carryGrappleRetracting = false;
    if (carryGrappleCubes) carryGrappleCubes.visible = false;
    if (carryGrappleHead) carryGrappleHead.visible = false;
    playerArms.visible = false;
    if (!worlds.end.size) {
      dim = "end"; world = worlds.end;
      generateEnd();
    }
    if (!worlds.nether.size) {
      dim = "nether"; world = worlds.nether;
      generateNether();
    } else {
      generateNetherRivers();
      generateVolcanoes();
    }
    dim = liveDim; world = worlds[liveDim];
    clearPortalFills();
    dim = "end"; world = worlds.end;
    ensureReturnPortal();
    rebuildColTops("end");
    dim = "nether"; world = worlds.nether;
    ensureNetherPortal();
    rebuildColTops("nether");
    dim = liveDim; world = worlds[liveDim];
    rebuildMeshes();
    select(selected);
    updateCamera();
    setDimensionEnv();
    updateDimLabel();
    clearPortalFills();
    if (liveDim === "end") {
      if (endCleared) spawnEndermen();
      else if (pendingDragon) {
        spawnDragon();
        dragon.hp = Math.min(dragon.maxHp, pendingDragon.hp);
        dragon.hitCount = pendingDragon.hitCount || 1;
        paintDragon();
        dragon.mesh.position.set(pendingDragon.x, pendingDragon.y, pendingDragon.z);
        dragon.yaw = pendingDragon.yaw || 0;
        dragon.pitch = pendingDragon.pitch || 0;
        dragon.prevYaw = dragon.yaw;
        buildDragonPath();
        updateBossBar();
        if (pendingDragon.dying > 0) {
          dragon.hp = 0;
          dragon.deathTotal = DRAGON_HUES.length + 1;
          dragon.dying = pendingDragon.dying;
          dragon.deathFlash = 0.1;
          dragon.deathIdx = pendingDragon.deathIdx || 0;
          dragon.deathX = pendingDragon.deathX;
          dragon.deathY = pendingDragon.deathY;
          dragon.deathZ = pendingDragon.deathZ;
          dragon.spitting = 0;
          if (dragon.parts) for (const q of dragon.parts) { q.life = q.ttl; q.m.visible = false; }
          updateBossBar();
        }
        pendingDragon = null;
        spawnEndermen();
      } else { spawnDragon(); spawnEndermen(); }
    } else pendingDragon = null;
    computeVillageLayout();
    const heldDim = pendingCarriedDim;
    const heldIdx = pendingCarriedIdx;
    if (heldDim !== 0) pendingCarriedIdx = null;
    dim = "over"; world = worlds.over;
    if (pendingOverworldMobs && pendingOverworldMobs.length) {
      const saved = pendingOverworldMobs;
      pendingOverworldMobs = null;
      overworldMobCache = null;
      if (!restoreOverworldMobs(saved, { keepCarried: false, applyPanic: true })) { spawnVillagers(); spawnBirds(); }
      overworldMobCache = snapshotOverworldMobs(true);
    } else {
      pendingOverworldMobs = null;
      removeVillagers();
      spawnVillagers();
      spawnBirds();
      overworldMobCache = snapshotOverworldMobs(true);
    }
    pendingChainLinks = null;
    let endIds = null, netherIds = null;
    dim = "end"; world = worlds.end;
    if (pendingEndMobs && pendingEndMobs.length) {
      const saved = pendingEndMobs;
      pendingEndMobs = null;
      const pairs = (pendingChainLinksEnd || []).filter(([a, b]) => !(heldDim === 1 && (a === heldIdx || b === heldIdx)));
      pendingChainLinksEnd = null;
      const res = restoreDimMobs(saved, "end", { applyPanic: true });
      endIds = res.ids;
      relinkDimChainsByIds(endIds, pairs);
      endMobCache = snapshotMobsForDim("end", true);
    } else {
      pendingEndMobs = null;
      pendingChainLinksEnd = null;
      if (liveDim === "end") spawnEndermen();
      endMobCache = snapshotMobsForDim("end", true);
    }
    dim = "nether"; world = worlds.nether;
    if (pendingNetherMobs && pendingNetherMobs.length) {
      const saved = pendingNetherMobs;
      pendingNetherMobs = null;
      const pairs = (pendingChainLinksNether || []).filter(([a, b]) => !(heldDim === 2 && (a === heldIdx || b === heldIdx)));
      pendingChainLinksNether = null;
      const res = restoreDimMobs(saved, "nether", { applyPanic: true });
      netherIds = res.ids;
      relinkDimChainsByIds(netherIds, pairs);
      netherMobCache = snapshotMobsForDim("nether", true);
    } else {
      pendingNetherMobs = null;
      pendingChainLinksNether = null;
      netherMobCache = snapshotMobsForDim("nether", true);
    }
    if (pendingVillagePanic > 0.05) villagePanicUntil = performance.now() / 1000 + pendingVillagePanic;
    pendingVillagePanic = 0;
    dim = liveDim; world = worlds[liveDim];
    if (heldDim !== 0 && heldIdx != null && heldIdx >= 0) {
      const ids = heldDim === 1 ? endIds : netherIds;
      const hid = ids && heldIdx < ids.length ? ids[heldIdx] : null;
      const held = hid != null ? mobById.get(hid) : null;
      if (held) {
        held.mode = "carried";
        held.vel.set(0, 0, 0);
        held.target = null;
        held.path = null;
        held.pathKey = null;
        held.blockedT = 0;
        held._stuckT = 0;
        if (held.isBaby) held._followDetourUntil = 0;
        held.mesh.visible = true;
        setMobTransparent(held, 0.35);
        carryMob = held;
        playerArms.visible = true;
      }
      pendingCarriedIdx = null;
      pendingCarriedDim = 0;
    }
    for (const m of mobs) m.mesh.visible = (mobDimOf(m) === liveDim) || m === carryMob || m === carryGrappleMob;
    restoreLiveTNT(pendingTNTBombs, pendingTNTQueue, pendingTNTEta);
    pendingTNTBombs = null;
    pendingTNTQueue = null;
    pendingTNTEta = null;
    replayLiveFx(pendingFx);
    pendingFx = null;
    scanWorldPortals();
    if (liveDim === "end" && endCleared && endReturnWin) {
      ensurePortalFill(endReturnWin, false);
      updatePortalVisual();
    }
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
        return true;
      } catch { setLoading(false); return false; }
    }
    const list = await apiList();
    const name = await pickWorld(list, await serverSaveDirPromise);
    if (!name) return false;
    try {
      saveName = name;
      setLoading(true);
      await restoreSave(await apiLoad(name));
      await saveToFile();
      return true;
    } catch {
      setLoading(false);
      showMsg("That file isn't a valid MiniCraft save.");
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
      return true;
    } catch { setLoading(false); return false; }
  }
  const picked = await importSaveFile();
  if (picked) {
    try {
      setLoading(true);
      await restoreSave(picked.buf);
      await saveToFile();
      return true;
    } catch {
      setLoading(false);
      showMsg("That file isn't a valid MiniCraft save.");
      return false;
    }
  }
  showMsg("No save found.");
  return false;
}

function resetDims() {
  dim = DEV_START_DIM;
  world = worlds[DEV_START_DIM];
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
  overPortalWin = null;
  overPortalDir = null;
  endCleared = false;
  netReturnWin = null;
  endReturnWin = null;
  netherExit = null;
  endExit = null;
  protectedBlocks.clear();
  clearChains();
  removeEndEntities();
  removeVillagers();
  overworldMobCache = null;
  pendingOverworldMobs = null;
  pendingCarriedIdx = null;
  pendingCarriedDim = 0;
  endMobCache = null;
  netherMobCache = null;
  pendingEndMobs = null;
  pendingNetherMobs = null;
  pendingChainLinksEnd = null;
  pendingChainLinksNether = null;
  pendingDragon = null;
  pendingTNTBombs = null;
  pendingTNTQueue = null;
  pendingTNTEta = null;
  pendingFx = null;
  setDimensionEnv();
  updateDimLabel();
}

async function buildWorld() {
  setLoading(true);
  requestLock();
  await new Promise((r) => setTimeout(r, 30));
  try {
    carryGrappleActive = false;
    carryGrapplePulling = false;
    carryGrappleRetracting = false;
    carryGrappleBlock = null;
    carryGrappleChainTarget = null;
    carryGrappleAttachMode = "behind";
    abortMobPortalTx();
    if (carryGrappleCubes) carryGrappleCubes.visible = false;
    if (carryGrappleHead) carryGrappleHead.visible = false;
    for (const gm of [carryMob, carryGrappleMob]) {
      if (gm && mobs.includes(gm)) {
        if (gm.mesh) scene.remove(gm.mesh);
        if (gm.fallMesh) scene.remove(gm.fallMesh);
        if (gm.eyeMat) gm.eyeMat.dispose();
        const ei = endermen.indexOf(gm);
        if (ei >= 0) endermen.splice(ei, 1);
        mobById.delete(gm.id);
        const gi = mobs.indexOf(gm);
        if (gi >= 0) mobs.splice(gi, 1);
        if (birdLock === gm) { birdLock = null; birdLockT = 0; birdLockShots = 0; }
      }
    }
    carryMob = null;
    carryGrappleMob = null;
    playerArms.visible = false;
    resetDims();
    seed = Math.floor(Math.random() * 100000);
    endSeed = Math.floor(Math.random() * 100000);
    netherSeed = Math.floor(Math.random() * 100000);
    placedFlowers.clear();
    growableSoils.clear();
    plantedPines.clear();
    brokenPineCells.clear();
    garlandDirty = true;
    decorVisible = true;
    starStyleIdx = 0;
    wetSoilSet.clear();
    clearAllSoakMeshes();
    clearAllPineFailBlinks();
    plantClaims.clear();
    pineGrowths.length = 0;
    clearAllPineReservations();
    clearAllSoilTimerSprites();
    generateWorld();
    flying = false;
    freeCam = false;
    if (DEV_START_DIM === "end") {
      let oy = 1.01;
      for (let y = MAX_Y; y > 0; y--) {
        const b = getBlock(0, y, 0);
        if (b === CLOUD || b === MOON) continue;
        if (isSolid(0, y, 0)) { oy = y + 1.01; break; }
      }
      overPortalSpawn = { x: 0.5, y: oy, z: 0.5 };
      dim = "end";
      world = worlds.end;
      generateEnd();
      endCleared = false;
      buildReturnPortal();
      spawnDragon();
      spawnEndermen();
      setDimensionEnv();
      pos.set(0.5, END_PLATFORM_TOP + 2.01, 4.5);
      vel.set(0, 0, 0);
      yaw = 0;
      pitch = 0;
    } else {
      spawnPlayer();
    }
    camPos.copy(pos);
    scanWorldPortals();
    rebuildMeshes();
    rebuildHotbar();
    recomputeGlowClusters();
    syncGlowLights();
    if (DEV_START_DIM === "end") {
      overworldMobCache = snapshotOverworldMobs(false);
      removeVillagers();
    } else {
      removeVillagers(); spawnVillagers(); spawnBirds();
    }
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
  overlay.style.display = "none";
  crosshair.style.display = "block";
  hotbarEl.style.display = "flex";
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

setInterval(() => { if (canSave() && started && (worldDirty || carryMob || chainLinks.size)) saveToFile(); }, 3000);
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
// flowers and water — unless the player climbs high enough for the Moon to
// start appearing, where the Water slot swaps to moon water and the Flower
// slot to glowstone (back to water and flowers below).
let hotbarMoon = false;
function onMoon() {
  return dim === "over" && pos.y >= MOON_FADE_START;
}
function hotbarList() {
  if (dim === "nether" || dim === "end")
    return [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, LAVA, GLOWSTONE, TNT, PORTAL, OBSIDIAN];
  if (hotbarMoon)
    return [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, MOON_WATER, GLOWSTONE, TNT, PORTAL, OBSIDIAN];
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
let lastWheelT = 0;
const WHEEL_COOLDOWN = 50;
document.addEventListener("wheel", (e) => {
  if (loading) return;
  const now = performance.now();
  if (now - lastWheelT < WHEEL_COOLDOWN) return;
  lastWheelT = now;
  select(selected + (e.deltaY > 0 ? -1 : 1));
}, { passive: true });

// ---------------------------------------------------------------------------
// Input / pointer lock
// ---------------------------------------------------------------------------
const overlay = document.getElementById("overlay");
const crosshair = document.getElementById("crosshair");
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
  if (wasLocked && !locked && started) saveToFile();
  if (suppressMenu) { suppressMenu = false; return; }
  if (helpOpen) return;
  if (!locked && Date.now() - helpCloseTime < 2000) return;
  if (loading) return;
  overlay.style.display = locked ? "none" : "flex";
  crosshair.style.display = locked ? "block" : "none";
  hotbarEl.style.display = locked ? "flex" : "none";
  resumeBtn.style.display = (!locked && started) ? "block" : "none";
});

document.addEventListener("mousemove", (e) => {
  if (!locked || loading) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  leftMoved = true;
  leftEverMoved = true;
  leftTimer = 0;
  if (editHold[2].down) {
    rightMoveAcc += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (rightMoveAcc >= RIGHT_MOVE_PX) rightMoved = true;
  }
});

document.addEventListener("mousedown", (e) => {
  if (!locked || helpOpen || loading) return;
  if (e.button === 0 || e.button === 2) {
    const h = editHold[e.button];
    h.down = true;
    h.t = 0;
    h.acc = 0;
    if (e.button === 0) {
      leftMoved = false; leftTimer = 0; leftStairs = false; leftEverMoved = false; leftNoPlace = false; clickAnchors = [];
      const sel = hotbarList()[selected];
      if (sel === TNT) {
        const fired = tryFireLockedTNT();
        leftNoPlace = fired || !!tntChainAimMob();
        if (!fired && !leftNoPlace && placeBlock(sel)) clickAnchors.push([currentBlock.x + currentBlock.face[0], currentBlock.y + currentBlock.face[1], currentBlock.z + currentBlock.face[2]]);
      } else if (placeBlock(sel)) clickAnchors.push([currentBlock.x + currentBlock.face[0], currentBlock.y + currentBlock.face[1], currentBlock.z + currentBlock.face[2]]);
    } else {
      rightMoved = false; rightMoveAcc = 0; clickAnchors = [];
      if (currentBlock) { const b = [currentBlock.x, currentBlock.y, currentBlock.z]; breakBlock(); clickAnchors.push(b); }
      else if (hotbarList()[selected] === TNT) tryFireLockedTNT();
    }
  }
  if (e.button === 1) { e.preventDefault(); fireGrapple(); }
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0 || e.button === 2) {
    const h = editHold[e.button];
    h.down = false;
    h.t = 0;
    h.acc = 0;
    if (e.button === 0) { chainHome = null; chainPlat = null; chainSpin = 0; leftStairs = false; leftTimer = 0; leftNoPlace = false; clickAnchors = []; }
    else { rightMoved = false; rightMoveAcc = 0; clickAnchors = []; }
  }
  if (e.button !== 1 || loading) return;
  if (!grappleActive) return;
  if (grapplePulling) {
    const fdx = grappleTarget.x - pos.x, fdy = grappleTarget.y - pos.y, fdz = grappleTarget.z - pos.z;
    const mob = grappleMob;
    const followDist = !mob ? 0 : mob.kind === "dragon" ? DRAGON_FOLLOW_DIST : BIRD_FOLLOW_DIST;
    const mobFollow = mob && grappleHooked &&
      (grappleTowInit || Math.hypot(fdx, fdy, fdz) <= followDist + 0.5);
    if (mobFollow) {
      if (mob.vel) vel.copy(mob.vel);
      flingActive = false;
      stepDown = false;
      wasOnGround = false;
      onGround = false;
    } else if (headInWater()) {
      // Releasing mid-pull inside a liquid: the pull velocity is kept as-is
      // (inertia) for LIQUID_INERTIA_TIME, then a constant deceleration ramp
      // over LIQUID_BRAKE_TIME, then buoyancy takes over. No flingActive.
      const dx = grappleTarget.x - grappleStart.x, dy = grappleTarget.y - grappleStart.y, dz = grappleTarget.z - grappleStart.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      vel.set((dx / dist) * GRAPPLE_SPEED, (dy / dist) * GRAPPLE_SPEED, (dz / dist) * GRAPPLE_SPEED);
      liquidInertiaT = LIQUID_INERTIA_TIME;
      liquidBrakeT = 0;
      flingActive = false;
      stepDown = false;
      wasOnGround = false;
      onGround = false;
    } else {
      const dx = grappleTarget.x - grappleStart.x, dy = grappleTarget.y - grappleStart.y, dz = grappleTarget.z - grappleStart.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      vel.set((dx / dist) * GRAPPLE_FLING, (dy / dist) * GRAPPLE_FLING, (dz / dist) * GRAPPLE_FLING);
      flingActive = true;
      stepDown = false;
      wasOnGround = false;
      onGround = false;
    }
  } else {
    stepDown = false;
  }
  grappleRetracting = true;
  grapplePendingInsert = null;
  grappleFill = null;
  grappleTowInit = false;
  grappleTowPos.set(0, 0, 0);
  if (grappleMob) {
    if (grappleMob.kind !== "dragon" && grappleMob !== carryMob && grappleMob !== carryGrappleMob) setMobTransparent(grappleMob, 1);
  } else if (grappleHooked) grappleHookPos.copy(grappleTarget);
  else grappleHookPos.copy(grappleStart).lerp(grappleTarget, grappleFly);
  grappleActive = false;
  grappleArrived = false;
  grapplePulling = false;
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
let escLockPending = false;
function resumeLockAfterEscape() {
  if (escLockPending) return;
  escLockPending = true;
  const onUp = (e) => {
    if (e.code !== "Escape") return;
    escLockPending = false;
    document.removeEventListener("keyup", onUp);
    requestLock();
  };
  document.addEventListener("keyup", onUp);
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
    if (e.code === "Escape") {
      closeHelp();
      helpCloseTime = Date.now();
      if (started) resumeLockAfterEscape();
      e.preventDefault();
    }
    return;
  }
  if (e.code === "KeyH" && !keys[e.code]) { openHelp(); e.preventDefault(); return; }
  if (e.code === "Enter" || e.code === "NumpadEnter" || e.key === "Enter") {
    if (e.repeat) { e.preventDefault(); return; }
    handleCarryEnterDown();
    keys[e.code] = true; keys[e.key] = true;
    e.preventDefault();
    return;
  }
  if (keys[e.code] || keys[e.key]) { e.preventDefault(); return; }
  keys[e.code] = true;
  keys[e.key] = true;
  if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "Space" || e.key === " ") jumpBuffer = Math.max(jumpBuffer, JUMP_BUFFER + 0.02);
  if (e.code === "KeyK" && !loading) select(selected - 1);
  if (e.code === "KeyL" && !loading) select(selected + 1);
  if (e.code === "KeyF") { freeCam = !freeCam; if (freeCam) camPos.copy(camera.position); else exitFreeCam(); }
  if (e.code === "KeyV" && !loading) { spawnBirdChain(); }
  if (e.code === "KeyB" && !loading && !e.repeat) {
    decorVisible = !decorVisible;
    garlandDirty = true;
    updateDimLabel();
    queueSave();
    showMsg("Decorations: " + (decorVisible ? "on" : "off"));
  }
  if (e.code === "Escape") {
    if (started) {
      saveToFile();
      if (!locked && !loading) resumeLockAfterEscape();
    }
  }
  if (["Space", "Slash", "Tab", "ArrowUp", "ArrowDown"].includes(e.code) || ["/", "?", " "].includes(e.key)) e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  keys[e.code] = false; keys[e.key] = false;
  if (e.code === "Enter" || e.code === "NumpadEnter" || e.key === "Enter") handleCarryEnterUp();
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.getElementById("btnNew").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (menuBusy || loading) return;
  menuBusy = true;
  try {
    apiOk = await apiOkPromise;
    if (apiOk) {
      const name = await askName("New World", "world", await serverSaveDirPromise);
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
    if (await loadSave()) { enterGame(); }
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
let simActivePrev = true;
function loop(now) {
  requestAnimationFrame(loop);
  dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!loading) {
    // Freeze gameplay simulation while the pause menu (or help panel) is open:
    // same condition that already freezes mobs and chains below, so Resume
    // finds the player exactly where ESC left them.
    const simActive = !started || (locked && !helpOpen);
    const nowS = performance.now() / 1000;
    if (simActivePrev && !simActive) simPauseStart = nowS;
    else if (!simActivePrev && simActive && simPauseStart > 0) {
      shiftPausedTimers(nowS - simPauseStart);
      simPauseStart = 0;
    }
    simActivePrev = simActive;
    if (freeCam) {
      if (simActive) updateFreeCam(dt);
      camera.position.copy(camPos);
      // While flying, the build anchor follows the camera, so placing and
      // breaking target live terrain and the hold-chain builds from where you
      // actually are instead of the stale ground position.
      pos.copy(camPos);
    } else {
      if (simActive) {
        updatePlayer(dt);
        if (pos.y < -20) { vel.set(0, 0, 0); spawnPlayer(); detachDisplacementGrapple(); grappleRetracting = false; }
      }
      camera.position.set(pos.x, pos.y + EYE, pos.z);
    }
    camera.rotation.set(pitch, yaw, 0);
    const moon = onMoon();
    if (moon !== hotbarMoon) { hotbarMoon = moon; rebuildHotbar(); }
    updateTarget();
    updateCarry(dt);
    if (simActive) updateCarryGrapple(dt);
    if (locked) {
      if (editHold[0].down) {
        if (!leftStairs && !leftEverMoved) {
          if (!leftMoved) {
            leftTimer += dt;
            if (leftTimer >= 1) {
              leftStairs = true;
              editHold[0].t = CHAIN_HOLD;
              editHold[0].acc = 0;
            }
          } else {
            leftTimer = 0;
          }
        }
        if (leftStairs && !leftNoPlace) {
          let didChain = false;
          const h = editHold[0];
          h.t += dt;
          const chained = h.t - CHAIN_HOLD;
          if (chained >= 0) {
            const step = 1 / Math.min(MAX_CHAIN_RATE, CHAIN_RATE + CHAIN_ACCEL * chained);
            h.acc += dt;
            while (h.acc >= step) {
              h.acc -= step;
              if (!didChain) { beginPlaceBatch(); didChain = true; }
              chainStep();
            }
          }
          if (didChain) endPlaceBatch();
        } else if (!leftNoPlace && leftMoved && currentBlock && currentBlock.id !== hotbarList()[selected]) {
          // Paint phase: place where aimed, only onto a block of a different
          // kind, within CHAIN_RANGE of the last block placed on this click.
          const wx = currentBlock.x + currentBlock.face[0];
          const wy = currentBlock.y + currentBlock.face[1];
          const wz = currentBlock.z + currentBlock.face[2];
          const near = !clickAnchors.length || clickAnchors.some(([ax, ay, az]) =>
            (wx - ax) ** 2 + (wy - ay) ** 2 + (wz - az) ** 2 <= CHAIN_RANGE * CHAIN_RANGE);
          if (near && !aimOnMob() && tryPlace(hotbarList()[selected], wx, wy, wz)) {
            clickAnchors.push([wx, wy, wz]);
            if (!chainHome) chainHome = [wx, wy, wz];
          }
          leftMoved = false; // one block per movement event
        } else {
          leftMoved = false;
        }
      }
      // Holding right click chains digging: only after 1s still held, or once
      // ~15px of deliberate mouse travel skipped the wait (rightMoved).
      if (editHold[2].down) {
        const h = editHold[2];
        if (rightMoved) h.t = Math.max(h.t, CHAIN_HOLD);
        let didChain = false;
        h.t += dt;
        const chained = h.t - CHAIN_HOLD;
        if (chained >= 0) {
          const step = 1 / Math.min(MAX_CHAIN_RATE, CHAIN_RATE + CHAIN_ACCEL * chained);
          h.acc += dt;
          while (h.acc >= step) {
            h.acc -= step;
            if (!didChain) { beginPlaceBatch(); didChain = true; }
            if (currentBlock) {
              const { x, y, z } = currentBlock;
              const near = !clickAnchors.length || clickAnchors.some(([ax, ay, az]) =>
                (x - ax) ** 2 + (y - ay) ** 2 + (z - az) ** 2 <= CHAIN_RANGE * CHAIN_RANGE);
              if (near) {
                chainBreaking = true;
                try { breakBlock(); } finally { chainBreaking = false; }
                clickAnchors.push([x, y, z]);
              }
            }
          }
          if (didChain) endPlaceBatch();
        }
      }
    } else {
      editHold[0].down = editHold[2].down = false;
      editHold[0].t = editHold[2].t = 0;
      editHold[0].acc = editHold[2].acc = 0;
      chainHome = null;
      chainPlat = null;
      chainSpin = 0;
      leftStairs = false;
      leftTimer = 0;
      rightMoved = false;
      rightMoveAcc = 0;
      clickAnchors = [];
    }
    let showRope = false;
    if (grappleActive) {
      showRope = true;
      ropeA.set(pos.x, pos.y + 0.3, pos.z);
      if (grappleMob) ropeB.copy(grappleHookPos);
      else {
        ropeB.copy(grappleStart).lerp(grappleTarget, grappleFly);
        if (grappleHooked) ropeB.copy(grappleTarget);
      }
    } else if (grappleRetracting && !loading) {
      const ex = pos.x, ey = pos.y + 0.3, ez = pos.z;
      const dhx = ex - grappleHookPos.x, dhy = ey - grappleHookPos.y, dhz = ez - grappleHookPos.z;
      const dh = Math.sqrt(dhx * dhx + dhy * dhy + dhz * dhz);
      const stepH = GRAPPLE_RETRACT * dt;
      if (dh <= stepH + 0.05) {
        grappleRetracting = false;
      } else {
        grappleHookPos.x += dhx / dh * stepH;
        grappleHookPos.y += dhy / dh * stepH;
        grappleHookPos.z += dhz / dh * stepH;
        ropeA.set(ex, ey, ez);
        ropeB.copy(grappleHookPos);
        showRope = true;
      }
    }
    if (showRope) {
      grappleCubes.visible = true;
      grappleHead.visible = true;
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
    // Carry grapple (red) — same animation as grapple, red rope
    let showCarryRope = false;
    const carryRopeA = new THREE.Vector3(), carryRopeB = new THREE.Vector3();
    if (carryGrappleActive) {
      showCarryRope = true;
      carryRopeA.set(pos.x, pos.y + 0.3, pos.z);
      carryRopeB.copy(carryGrappleHookPos);
    } else if (carryGrapplePulling) {
      showCarryRope = true;
      carryRopeA.set(pos.x, pos.y + 0.3, pos.z);
      if (carryGrappleMob) carryRopeB.set(carryGrappleMob.pos.x, carryGrappleMob.pos.y + carryGrappleMob.h * 0.5, carryGrappleMob.pos.z);
      else carryRopeB.copy(carryGrappleTarget);
    } else if (carryGrappleRetracting) {
      showCarryRope = true;
      carryRopeA.set(pos.x, pos.y + 0.3, pos.z);
      carryRopeB.copy(carryGrappleHookPos);
    }
    if (showCarryRope) {
      carryGrappleCubeMat.opacity = 0.3;
      carryGrappleCubeMat.transparent = true;
      carryGrappleCubeMatNoFog.opacity = 0.3;
      carryGrappleCubeMatNoFog.transparent = true;
      carryGrappleHeadMat.opacity = 0.3;
      carryGrappleHeadMat.transparent = true;
      carryGrappleHeadMatNoFog.opacity = 0.3;
      carryGrappleHeadMatNoFog.transparent = true;
      carryGrappleCubes.visible = true;
      carryGrappleHead.visible = true;
      const cdx = carryRopeB.x - carryRopeA.x, cdy = carryRopeB.y - carryRopeA.y, cdz = carryRopeB.z - carryRopeA.z;
      const cdist = Math.hypot(cdx, cdy, cdz) || 0.001;
      const cn = Math.max(4, Math.min(CARRY_GRAPPLE_CUBES, Math.round(cdist / 0.15)));
      carryGrappleCubes.count = cn;
      const cux = cdx / cdist, cuy = cdy / cdist, cuz = cdz / cdist;
      let cvx = Math.abs(cuy) < 0.99 ? cuz : 1, cvy = Math.abs(cuy) < 0.99 ? 0 : 0, cvz = Math.abs(cuy) < 0.99 ? -cux : 0;
      const cvl = Math.hypot(cvx, cvy, cvz) || 1;
      cvx /= cvl; cvy /= cvl; cvz /= cvl;
      const cwx = cuy * cvz - cuz * cvy, cwy = cuz * cvx - cux * cvz, cwz = cux * cvy - cuy * cvx;
      for (let i = 0; i < cn; i++) {
        const f = (i + 0.5) / cn;
        const ax = Math.sin(f * Math.PI * 4), ay = Math.sin(f * Math.PI * 2);
        carryGrappleCubeMatrix.setPosition(
          carryRopeA.x + cdx * f + cvx * ax * 0.15 + cwx * ay * 0.15,
          carryRopeA.y + cdy * f + cvy * ax * 0.15 + cwy * ay * 0.15,
          carryRopeA.z + cdz * f + cvz * ax * 0.15 + cwz * ay * 0.15
        );
        carryGrappleCubes.setMatrixAt(i, carryGrappleCubeMatrix);
      }
      carryGrappleCubes.instanceMatrix.needsUpdate = true;
      carryGrappleHead.position.copy(carryRopeB);
    } else if (carryGrappleCubes.visible) {
      carryGrappleCubes.visible = false;
      carryGrappleHead.visible = false;
    }
    if (simActive) {
      tickTNT(dt);
      processExplosionQueue();
    }
    tickEffects(dt, simActive);
    syncGlowLights(dt);
    if (portalCd > 0) portalCd -= dt;
    updatePortalVisual();
    if (simActive) checkPortal();
    if (dim === "end" && simActive) updateDragon(dt);
    if (locked && started && !helpOpen) updateMobs(dt);
    if (simActive) { tickSoilTimers(dt); tickPineGrowths(dt); tickPineFailBlinks(dt); }
    if (locked && started && !helpOpen) updateChains(dt);
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }

    if (dim === "over") {
      const y = camera.position.y;
      let ts = (y - SKY_SPACE_START) / (SKY_SPACE_END - SKY_SPACE_START);
      ts = Math.max(0, Math.min(1, ts));
      const s = ts * ts * (3 - 2 * ts);
      scene.background.copy(DAY_SKY).lerp(SPACE_SKY, s);
      scene.fog.color.copy(scene.background);
      envBackground.copy(scene.background);
      envFogColor.copy(scene.fog.color);
      sun.intensity = 1.1 * (1 - 0.55 * s);
      hemi.intensity = 0.75 * (1 - 0.55 * s);
      skyStars.material.opacity = s;
      skyStars.position.copy(camera.position);
      skyStars.visible = s > 0.01;
      const moonSpan = MOON_FADE_END - MOON_FADE_START;
      let ms = (y - MOON_FADE_START) / (moonSpan * 0.9);
      ms = Math.max(0, Math.min(1, ms));
      ms = ms * ms * (3 - 2 * ms);
      if (typeMats.has(MOON)) for (const mm of typeMats.get(MOON)) { mm.opacity = ms; mm.transparent = ms < 0.99; mm.depthWrite = ms >= 0.99; }
      if (!moonLakesGenerated && y >= MOON_FADE_END) {
        generateMoonLakes();
        for (const ck of moonLakesChunkSet) {
          if (chunkMeshes.has(ck)) {
            const [cx, cz] = ck.split("_").map(Number);
            moonLakesRebuildQueue.push([cx, cz]);
          }
        }
      } else if (moonLakesGenerated && y < MOON_FADE_END) {
        const toRebuild = new Set(moonLakesChunkSet);
        removeMoonLakes();
        moonLakesVisible = false;
        moonLakesRebuildQueue = [];
        for (const ck of toRebuild) {
          if (chunkMeshes.has(ck)) {
            const [cx, cz] = ck.split("_").map(Number);
            moonLakesRebuildQueue.push([cx, cz]);
          }
        }
      }
      if (liquidBodyMats.has(MOON_WATER) || liquidBucketMats.has(MOON_WATER) || liquidBucketMatsIn.has(MOON_WATER)) {
        let ls = (y - LAKES_FADE_START) / (LAKES_FADE_END - LAKES_FADE_START);
        ls = Math.max(0, Math.min(1, ls));
        ls = ls * ls * (3 - 2 * ls);
        const wantLakes = ls >= 0.01;
        if (wantLakes !== moonLakesVisible) {
          moonLakesVisible = wantLakes;
          for (const ck of moonLakesChunkSet) {
            if (chunkMeshes.has(ck)) {
              const [cx, cz] = ck.split("_").map(Number);
              moonLakesRebuildQueue.push([cx, cz]);
            }
          }
        }
        const useMoon = !wantLakes;
        const moonMats = [];
        if (liquidBodyMats.has(MOON_WATER)) moonMats.push(liquidBodyMats.get(MOON_WATER));
        const moonTopMats = [];
        if (liquidBucketMats.has(MOON_WATER)) for (const mm of liquidBucketMats.get(MOON_WATER)) if (mm) moonTopMats.push(mm);
        if (liquidBucketMatsIn.has(MOON_WATER)) for (const mm of liquidBucketMatsIn.get(MOON_WATER)) if (mm) moonTopMats.push(mm);
        for (const mm of moonMats) {
          if (mm.map !== (useMoon ? TEX.moon : TEX.moonwater)) { mm.map = useMoon ? TEX.moon : TEX.moonwater; mm.needsUpdate = true; }
          const o = useMoon ? ms : (mm.userData.baseOpacity || 0.85) * ls;
          mm.opacity = o; mm.transparent = o < 0.99; mm.depthWrite = o >= 0.99;
        }
        // Lake shafts show black sky through the dome from far below: keep tops
        // opaque until the camera approaches under the surface, then relax to
        // their buckets (subtle see-through up close, never from afar).
        let lt = (y - 550) / 150;
        lt = Math.max(0, Math.min(1, lt));
        const lakeSee = lt * lt * (3 - 2 * lt);
        for (const mm of moonTopMats) {
          if (mm.map !== (useMoon ? TEX.moon : TEX.moonwater)) { mm.map = useMoon ? TEX.moon : TEX.moonwater; mm.needsUpdate = true; }
          let o = useMoon ? ms : (mm.userData.baseOpacity || 0.85) * ls;
          if (wantLakes) o = o + (1 - o) * (1 - lakeSee);
          mm.opacity = o; mm.transparent = o < 0.99; mm.depthWrite = o >= 0.99;
        }
      }
      if (moonLakesRebuildQueue.length) {
        for (let i = 0; i < 4 && moonLakesRebuildQueue.length; i++) {
          const [cx, cz] = moonLakesRebuildQueue.shift();
          rebuildChunk(cx, cz);
        }
      }
    }

    // Underwater murk: eye-gated, fast bite, per-liquid distances. Fog colour
    // always equals background (both partially tinted together), so far
    // clouds/terrain dissolve into it like air — never silhouettes.
    const eye = camera.position;
    const ebx = Math.floor(eye.x), eby = Math.floor(eye.y), ebz = Math.floor(eye.z);
    const eid = eyeLiquidId(eye.x, eye.y, eye.z);
    let underSub = 0;
    if (eid) {
      const stop = liquidTopAbove(ebx, eby, ebz, eid);
      const d = Math.max(0, stop - eye.y);
      underSub = 1 - Math.exp(-d / WATER_FOG_DEPTH);
      underTintId = eid;
    }
    underSubSmooth += (underSub - underSubSmooth) * (1 - Math.exp(-dt * 45));
    if (Math.abs(underSubSmooth - underSub) < 0.001) underSubSmooth = underSub;
    const tint = liquidTintColors[underTintId];
    const fogFar = LIQUID_FOG_FAR[underTintId] || 14;
    const k = underSubSmooth * UNDERWATER_TINT;
    updateRopeFog(!!eid);
    scene.background.copy(envBackground).lerp(tint, k);
    scene.fog.color.copy(scene.background);
    scene.fog.near = THREE.MathUtils.lerp(envFogNear, UNDERWATER_FOG_NEAR, underSubSmooth);
    scene.fog.far = THREE.MathUtils.lerp(envFogFar, fogFar, underSubSmooth);

    // Glowing lava flicker
    if (liquidBodyMats.has(LAVA) || liquidBucketMats.has(LAVA) || liquidBucketMatsIn.has(LAVA)) {
      const k = 1.1 + 0.15 * Math.sin(now * 0.005) * Math.sin(now * 0.0013 + 1);
      const lavaMats = [];
      if (liquidBodyMats.has(LAVA)) lavaMats.push(liquidBodyMats.get(LAVA));
      if (liquidBucketMats.has(LAVA)) for (const m of liquidBucketMats.get(LAVA)) if (m) lavaMats.push(m);
      if (liquidBucketMatsIn.has(LAVA)) for (const m of liquidBucketMatsIn.get(LAVA)) if (m) lavaMats.push(m);
      for (const m of lavaMats) m.color.setScalar(k);
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
if (location.search.includes('test')) {
  window._test = {
    get world(){ return world; }, get worlds(){ return worlds; }, get mobs(){ return mobs; },
    getBlock, setBlock, handleMobExplosion, processExplosionQueue, isMobStandingOn, intersectsMob, key, BLAST_RADIUS, TNT, STONE, AIR, get SAND(){ return SAND; }, get WATER(){ return WATER; }, get VILLAGE_POOL_W(){ return VILLAGE_POOL_W; }, get VILLAGE_POOL_D(){ return VILLAGE_POOL_D; }, get VILLAGE_POOL_DEPTH(){ return VILLAGE_POOL_DEPTH; }, get VILLAGE_PEN_POOL_W(){ return VILLAGE_PEN_POOL_W; }, get VILLAGE_PEN_POOL_D(){ return VILLAGE_PEN_POOL_D; }, get VILLAGE_PEN_POOL_DEPTH(){ return VILLAGE_PEN_POOL_DEPTH; },
    get villageCenter(){ return villageCenter; }, get villageHouses(){ return villageHouses; }, get villagePen(){ return villagePen; }, get villagePool(){ return villagePool; }, get isInsidePen(){ return isInsidePen; }, get isInsidePool(){ return isInsidePool; }, get isInsidePenPool(){ return isInsidePenPool; }, get poolExitTarget(){ return poolExitTarget; }, get penPoolExitTarget(){ return penPoolExitTarget; }, get LOG(){ return LOG; }, findPenGaps, nearestPenGap, penGapInside, penGapOutside, hasMobGround, mobBlockedAt, aabbCollidesWorld, mobProbeFree, randomPenPoint, randomAroundPenPoint, groundYForMob, get CLOUD_BASE(){ return CLOUD_BASE; }, get CLOUD_TOP(){ return CLOUD_TOP; }, get MAX_Y(){ return MAX_Y; },
    getTypeMats, get typeMats(){ return typeMats; }, buildWorld, generateWorld, generateMoonLakes, get moonLakesGenerated(){ return moonLakesGenerated; }, computeVillageLayout, spawnVillagers, refreshBlocks, rebuildMeshes, get chunkMeshes(){ return chunkMeshes; }, get boxGeo(){ return boxGeo; }, THREE,
    get pos(){ return pos; }, get vel(){ return vel; }, get camera(){ return camera; }, get scene(){ return scene; }, get freeCam(){ return freeCam; }, set freeCam(v){ freeCam = v; }, get camPos(){ return camPos; }, get yaw(){ return yaw; }, set yaw(v){ yaw=v; }, get pitch(){ return pitch; }, set pitch(v){ pitch=v; },
    get carryMob(){ return carryMob; }, set carryMob(v){ carryMob = v; }, handleCarryEnterDown, handleCarryEnterUp, pickMob, get carryGrappleActive(){ return carryGrappleActive; }, get carryGrapplePulling(){ return carryGrapplePulling; }, get carryGrappleMob(){ return carryGrappleMob; }, get carryGrappleBlock(){ return carryGrappleBlock; }, get carryGrappleHookPos(){ return carryGrappleHookPos; }, get carryGrappleOffset(){ return carryGrappleOffset; }, get carryGrappleMode(){ return carryGrappleMode; }, get isMobFrozenByGrapple(){ return isMobFrozenByGrapple; }, isChained, isChainCarrier, chainRootOf, chainTailOf, linkChain, dropChainFrom, chainTakeForCarry, severChainMob, groundChainFrom, insertChainBefore, insertChainBehind, insertBehindRide, prependChainLead, clearChains, pruneChains, updateChains, syncChainLinkColor, syncChainLinkColors, syncGrappleColor, stampSpawn, get mobById(){ return mobById; }, chainAttachTarget, startCarryAttachGrapple, killChainMob, respawnChainMob, unchainMob, severGroundedChainVictim, isGroundedChainVictim, get chainLinks(){ return chainLinks; }, get chainParent(){ return chainParent; }, get chainChild(){ return chainChild; }, playerChainAvatar, playerInChain, PLAYER_CHAIN_ID, spliceChainLink, chainHasJumping, chainPushCrumb, chainTrailTarget, latchPlayerTo, latchPlayerInMiddle, playerInsertCutAndLink, insertChainAheadOfPlayer, insertChainBehindPlayer, playerLeadLink, dropPlayerLeadEntry, readyLeadForLatch, leadAwareLatchInsert, appendCutFollowerBehindLeadTail, grabRideForCarry, fireGrapple, detachDisplacementGrapple, get grappleActive(){ return grappleActive; }, get grappleHooked(){ return grappleHooked; }, get grappleRetracting(){ return grappleRetracting; }, get grappleMob(){ return grappleMob; }, get grappleMobOffset(){ return grappleMobOffset; }, get grappleHookPos(){ return grappleHookPos; }, get grappleTarget(){ return grappleTarget; }, updateCarryGrapple, updateCarry, get currentBlock(){ return currentBlock; }, updateTarget, hotbarList, placeBlock, breakBlock, get selected(){ return selected; }, set selected(v){ selected=v; }, toggleCarry: handleCarryEnterDown, findNearestMobForGrab: (...a)=>{ const d=new THREE.Vector3(); camera.getWorldDirection(d); return pickMob(d); }, get playerArms(){ return playerArms; }, get started(){ return started; }, set started(v){ started=v; }, get loading(){ return loading; }, get freeCam(){ return freeCam; }, set freeCam(v){ freeCam=v; }, get helpOpen(){ return helpOpen; },
    get WOLF_COUNT(){ return WOLF_COUNT; }, get GOLEM_COUNT(){ return GOLEM_COUNT; }, get GOLEM_HW(){ return GOLEM_HW; }, get GOLEM_HH(){ return GOLEM_HH; }, get CAT_COUNT(){ return CAT_COUNT; }, get CAT_HW(){ return CAT_HW; }, get CAT_HH(){ return CAT_HH; }, makeWolfMesh, makeCatMesh, pickCatRobe, catParentFor, catTrailSpot, panicCats, makeIronGolemMesh, villagerHW, villagerH, wolfHasMobGround, wolfBlockedAt, wolfProbeFree, wanderGoalForWolf, wolfFindPath, wolfFlatSpot, wolfLeaveTarget, panicLeaveDir, panicWolves, wolfInWater, mobInWater, waterSurfaceForMob, mobPhysicsStep, wolfPhysicsStep, updateMobs, obstacleTurnDir, buildMobGrid,     get isPigCow(){ return isPigCow; }, get pigOverlapsFence(){ return pigOverlapsFence; }, pigFenceSlideOut, get MOB_FLOAT_FRAC(){ return MOB_FLOAT_FRAC; }, mobFloatTargetY, mobWaterExitJump, poolExitTarget, penPoolExitTarget, isInsidePenPool, moonLakeExitTarget, isMobInPoolWater, isMobInMoonLake, get BATH_MIN_T(){ return BATH_MIN_T; }, get BATH_MAX_T(){ return BATH_MAX_T; },
    get BIRD_COUNT(){ return BIRD_COUNT; }, get BIRD_MIN_Y(){ return BIRD_MIN_Y; }, get BIRD_MAX_Y(){ return BIRD_MAX_Y; }, get BIRD_SPEED(){ return BIRD_SPEED; }, get TNT_HOME_SPEED(){ return TNT_HOME_SPEED; }, get BIRD_AIM_DIST(){ return BIRD_AIM_DIST; }, get BIRD_LOCK_TIME(){ return BIRD_LOCK_TIME; }, get birdLock(){ return birdLock; }, get birdLockT(){ return birdLockT; }, set birdLockT(v){ birdLockT = v; }, get birdLockShots(){ return birdLockShots; }, liveBirdLock, tntTargeted, tryFireLockedTNT, tntChainAimMob, aimOnMob, get chainBreaking(){ return chainBreaking; }, set chainBreaking(v){ chainBreaking = v; },     makeBirdMesh, spawnBirds, spawnSingleBird, removeBirds, spawnBirdChain, updateBird, updatePerchedBird, updateToPerchBird, birdTakeoff, birdNextLeg, birdFindPerchSpot, birdCloudTopAt, birdTreeTopAt, birdRoofTopAt, birdPerchBand, birdPerchSupports, killBird, birdSpotOutOfView, birdProbeFree, birdRandomTarget, birdSeparate,     houseInteriorFor, houseMouths, birdCoopTarget,     birdSegmentFree, birdClearance, birdBestSteer, birdMillHop, birdConfinedSteer, birdMoveSlide, bandReturnTarget, birdNoticeBreak, setMobTransparent, birdIsConfined, birdHoleCell, chainSegmentFree, chainThreadRide, birdTunnelPlan, updateTunnelBird, birdTunnelSeparate, birdSkyClear, birdSidestep, birdUTurn, birdNarrow, birdColHW, birdColH,     get BIRD_NARROW_SCALE(){ return BIRD_NARROW_SCALE; }, get BIRD_SKY_CLEAR(){ return BIRD_SKY_CLEAR; }, get NETHER_BIRD_MIN_Y(){ return NETHER_BIRD_MIN_Y; }, get NETHER_BIRD_MAX_Y(){ return NETHER_BIRD_MAX_Y; }, birdDimOf, birdBandMinFor, birdBandMaxFor, birdBandMin, birdBandMax, birdNetherLegY, netherBirdCeiling, birdLavaAt, get BIRD_TUNNEL_SCALE(){ return BIRD_TUNNEL_SCALE; }, get BIRD_COL_HW(){ return BIRD_COL_HW; }, get BIRD_COL_H(){ return BIRD_COL_H; },     get tntLit(){ return tntLit; }, get explosionQueue(){ return explosionQueue; }, get tntEta(){ return tntEta; }, get pendingTNTBombs(){ return pendingTNTBombs; }, get pendingTNTEta(){ return pendingTNTEta; }, get bursts(){ return bursts; }, get flashes(){ return flashes; }, snapshotLiveFx, replayLiveFx, spawnExplosion, igniteTNT, fireTNTAtBird, purgeLiveTNT, tickTNT, snapshotLiveTNT, restoreLiveTNT, get pendingDragon(){ return pendingDragon; }, get tntEta(){ return tntEta; }, igniteTNT, aimedBird, fireTNTAtBird, explodeBird, spawnBirdBurst, get bursts(){ return bursts; }, get flashes(){ return flashes; }, updateTNTTarget, tickTNT, fireGrapple, updateGrapple, updatePlayer, get grappleActive(){ return grappleActive; }, get grapplePulling(){ return grapplePulling; }, get grappleHooked(){ return grappleHooked; },
    get overPortalWin(){ return overPortalWin; }, get overPortalDir(){ return overPortalDir; }, get overPortalSpawn(){ return overPortalSpawn; }, get overPortalFace(){ return overPortalFace; },
    portalWinValid, portalFrameBBox, findReturnSpot, frameTopSpot, facePortalFrom, faceAwayFromPortal, recordOverPortal, recordDimExit, resolveDimArrival, nearestReturnWin, resolveOverworldReturn, nearPortalSpawn, resolveSpawn, collectEndWins, collectNetherWins, collectReturnWins, insideEndInterior, insideNetherInterior, winCenter, windowDist, isSolid,
    get PORTAL(){ return PORTAL; }, get OBSIDIAN(){ return OBSIDIAN; }, get WORLD_RADIUS(){ return WORLD_RADIUS; }, get PLAYER_HW(){ return PLAYER_HW; }, get PLAYER_H(){ return PLAYER_H; },     get MOON(){ return MOON; }, get MOON_WATER(){ return MOON_WATER; }, get MOON_Y(){ return MOON_Y; }, get MOON_R(){ return MOON_R; }, inMoonZone, get CLOUD(){ return CLOUD; }, get GRASS(){ return GRASS; }, get STONE(){ return STONE; }, get ENDSTONE(){ return ENDSTONE; }, get NETHERRACK(){ return NETHERRACK; }, get dim(){ return dim; },
    serialize, deserialize, restoreSave, snapshotOverworldMobs, restoreOverworldMobs, get overworldMobCache(){ return overworldMobCache; }, get pendingOverworldMobs(){ return pendingOverworldMobs; }, get pendingChainLinks(){ return pendingChainLinks; }, get pendingCarriedIdx(){ return pendingCarriedIdx; },
    snapshotMobsForDim, snapshotChainPairsForDim, DRAGON_CHAIN_CARRIER, restoreDimMobs, relinkDimChainsByIds, mobDimOf, suspendLiveDim, placeMobExact, mobRestoreOverlapsPlaced, settleMobSpot, restoreInitialTarget, aabbOverlaps,
    get endMobCache(){ return endMobCache; }, get netherMobCache(){ return netherMobCache; }, get pendingEndMobs(){ return pendingEndMobs; }, get pendingNetherMobs(){ return pendingNetherMobs; }, get netherExit(){ return netherExit; }, get endExit(){ return endExit; }, get endCleared(){ return endCleared; },
    goToDimension, removeVillagers,
    get DEV_START_DIM(){ return DEV_START_DIM; },
    get dragon(){ return dragon; }, spawnDragon, removeDragon, updateDragon, paintDragon, damageDragon, dragonShotsCap, aimedDragon, get DRAGON_FULL_DMG(){ return DRAGON_FULL_DMG; }, get DRAGON_SPEED(){ return DRAGON_SPEED; }, get DRAGON_FOLLOW_DIST(){ return DRAGON_FOLLOW_DIST; },
    get endermen(){ return endermen; }, get mobPortalTx(){ return mobPortalTx; }, startMobPortalTx, tickMobPortalTx, finishMobPortalTx, abortMobPortalTx,     get PORTAL_ARRIVAL_FREEZE(){ return PORTAL_ARRIVAL_FREEZE; }, isArrivalFrozen, get FILL_SLIDE_TRIGGER_T(){ return FILL_SLIDE_TRIGGER_T; }, get FILL_SLIDE_SPEED(){ return FILL_SLIDE_SPEED; }, mobBodyFillCells, startFillSlide, get ENDERMEN_COUNT(){ return ENDERMEN_COUNT; }, get END_PLATFORM_R(){ return END_PLATFORM_R; }, get END_MOB_R(){ return END_MOB_R; }, get END_RETURN_Z(){ return END_RETURN_Z; }, get END_RETURN_BASE_Y(){ return END_RETURN_BASE_Y; }, get DRAGON_MIN_Y(){ return DRAGON_MIN_Y; }, get DRAGON_MAX_Y(){ return DRAGON_MAX_Y; }, endMobInEnd, endClampXZPos, endClampYFlying, birdEndPortalTopAt, get ENDERMAN_STARE_TIME(){ return ENDERMAN_STARE_TIME; }, get ENDERMAN_ANGRY_TIME(){ return ENDERMAN_ANGRY_TIME; }, spawnEndermen, removeEndermen, updateEnderman, updateEndermen, endermanTeleport, endermanPickSpot, endermanSpotFor, ensureEndermanAssets, makeEndermanMesh, syncEndermanHalo, syncEndermanHalos,     endermanChainHaloVisible, endermanHaloMode,
  };
  Object.assign(window._test, {
    get growableSoils(){ return growableSoils; }, get plantClaims(){ return plantClaims; }, get pineGrowths(){ return pineGrowths; }, get soilTimerSprites(){ return soilTimerSprites; }, get wetSoilSet(){ return wetSoilSet; }, get soakMeshes(){ return soakMeshes; }, get pineFailBlinks(){ return pineFailBlinks; }, get reservedPineCells(){ return reservedPineCells; },
    get DIRT(){ return DIRT; }, get LEAVES(){ return LEAVES; },
    get GROWABLE_DIST(){ return GROWABLE_DIST; }, get PLANT_NECK(){ return PLANT_NECK; }, get PINE_RATE(){ return PINE_RATE; }, get PINE_PHASE_TIME(){ return PINE_PHASE_TIME; }, get SOIL_TIMER(){ return SOIL_TIMER; }, get SOIL_SOAK_TIME(){ return SOIL_SOAK_TIME; }, get PLANT_BEND_TIME(){ return PLANT_BEND_TIME; }, get PLANT_LEAVE_DIST(){ return PLANT_LEAVE_DIST; },     get PINE_MIN_M(){ return PINE_MIN_M; }, get PINE_MAX_M(){ return PINE_MAX_M; },     get PINE_LIFT_MAX(){ return PINE_LIFT_MAX; }, get PLANT_STEAL_D(){ return PLANT_STEAL_D; }, get GROWTH_PUSH_SPEED(){ return GROWTH_PUSH_SPEED; }, get growthSettlePasses(){ return growthSettlePasses; },
    get MOON_PINE_MAX_M(){ return MOON_PINE_MAX_M; }, get STAR_STYLE_COUNT(){ return STAR_STYLE_COUNT; }, get STAR_STYLE_NAMES(){ return STAR_STYLE_NAMES; }, get STAR_STYLES(){ return STAR_STYLES; },     getStarStyleIdx(){ return starStyleIdx; }, getStarAngle(){ return starAngle; }, get STAR_SPIN(){ return STAR_SPIN; }, get STAR_PLATFORM_R(){ return STAR_PLATFORM_R; }, get starPlatforms(){ return starPlatforms; }, getStarRide(){ return starRide; }, starPlatformAt, rotXZ, rebuildStars, starTick, buildStarShape, pineCellAt, chainComponentFrom, despawnChainMob, cullSmallChainsNear,
    isSoilHole, isSoilFloor, releaseGrowable, armSoak, absorbSoak, spawnSoakDrips, plantWalkGoal, soilSameY, pickPineDims, fitTrunkRange, pineCellsFor, pineFits, pineSpotBlocked, pineLayerWidths, pineSpiralOrder, pineSummit, pineTrunkE0, pineFolReserved, reservePineCells, releasePineCells, clearAllPineReservations, pushOutOfGrowth, growthSolidOverlap, growthExitTarget, growthSlide, startPineGrowth, tickPineGrowths, tickSoilTimers, startPineFailBlink, clearPineFailBlink, clearAllPineFailBlinks, tickPineFailBlinks, setVillagerNeck, findPlantPath, soilClaimant, plantLeaveTarget,
    get plantedPines(){ return plantedPines; }, get brokenPineCells(){ return brokenPineCells; }, getGarlandBulbCount(){ return garlandBulbCount; }, garlandPathFor, garlandRadiusAt, garlandAnchor, garlandAnchorStrict, garlandTrimSet, pineAt, registerPlantedPine, rebuildGarlands, garlandTick, getDecorVisible(){ return decorVisible; }, setDecorVisible(v){ decorVisible = !!v; garlandDirty = true; updateDimLabel(); }, pineCellsFor, pineLayerWidths, pineSummit, countUpperVisible,
  });
  Object.assign(window._test, {
    get PIGEON_COUNT(){ return BIRD_COUNT; }, get PIGEON_MIN_Y(){ return BIRD_MIN_Y; }, get PIGEON_MAX_Y(){ return BIRD_MAX_Y; },
    get PIGEON_SPEED(){ return BIRD_SPEED; }, get PIGEON_AIM_DIST(){ return BIRD_AIM_DIST; }, get PIGEON_LOCK_TIME(){ return BIRD_LOCK_TIME; },
    get pigeonLock(){ return birdLock; }, get pigeonLockT(){ return birdLockT; }, set pigeonLockT(v){ birdLockT = v; },
    get pigeonLockShots(){ return birdLockShots; }, get PIGEON_NARROW_SCALE(){ return BIRD_NARROW_SCALE; },
    get PIGEON_SKY_CLEAR(){ return BIRD_SKY_CLEAR; }, get PIGEON_TUNNEL_SCALE(){ return BIRD_TUNNEL_SCALE; },
    get PIGEON_COL_HW(){ return BIRD_COL_HW; }, get PIGEON_COL_H(){ return BIRD_COL_H; },
    get NETHER_PIGEON_MIN_Y(){ return NETHER_BIRD_MIN_Y; }, get NETHER_PIGEON_MAX_Y(){ return NETHER_BIRD_MAX_Y; },
    makePigeonMesh: makeBirdMesh, spawnPigeons: spawnBirds, spawnSinglePigeon: spawnSingleBird, removePigeons: removeBirds,
    spawnPigeonChain: spawnBirdChain, updatePigeon: updateBird, updatePerchedPigeon: updatePerchedBird,
    updateToPerchPigeon: updateToPerchBird, pigeonTakeoff: birdTakeoff, pigeonNextLeg: birdNextLeg,
    pigeonFindPerchSpot: birdFindPerchSpot, pigeonCloudTopAt: birdCloudTopAt, pigeonTreeTopAt: birdTreeTopAt,
    pigeonRoofTopAt: birdRoofTopAt, pigeonPerchBand: birdPerchBand, pigeonPerchSupports: birdPerchSupports,
    killPigeon: killBird, pigeonSpotOutOfView: birdSpotOutOfView, pigeonProbeFree: birdProbeFree,
    pigeonRandomTarget: birdRandomTarget, pigeonSeparate: birdSeparate, pigeonSegmentFree: birdSegmentFree,
    pigeonClearance: birdClearance, pigeonBestSteer: birdBestSteer, pigeonMillHop: birdMillHop,
    pigeonConfinedSteer: birdConfinedSteer, pigeonMoveSlide: birdMoveSlide,
    pigeonNoticeBreak: birdNoticeBreak, pigeonIsConfined: birdIsConfined, pigeonHoleCell: birdHoleCell,
    pigeonTunnelPlan: birdTunnelPlan, updateTunnelPigeon: updateTunnelBird, pigeonTunnelSeparate: birdTunnelSeparate,
    pigeonSkyClear: birdSkyClear, pigeonSidestep: birdSidestep, pigeonUTurn: birdUTurn, pigeonNarrow: birdNarrow,
    pigeonColHW: birdColHW, pigeonColH: birdColH, pigeonDimOf: birdDimOf, pigeonBandMinFor: birdBandMinFor,
    pigeonBandMaxFor: birdBandMaxFor, pigeonBandMin: birdBandMin, pigeonBandMax: birdBandMax,
    pigeonNetherLegY: birdNetherLegY, netherPigeonCeiling: netherBirdCeiling, pigeonLavaAt: birdLavaAt,
    pigeonOnMoon: birdOnMoon, pigeonMoonY: birdMoonY, pigeonMoonTarget: birdMoonTarget,
    pigeonReachableTarget: birdReachableTarget, pigeonNewArc: birdNewArc, pigeonDetourTarget: birdDetourTarget,
    pigeonCoopTarget: birdCoopTarget, pigeonTouchVisit: birdTouchVisit, pigeonCellKey: birdCellKey,
    pigeonDigSteer: birdDigSteer, pigeonDigReachable: birdDigReachable, pigeonDigLive: birdDigLive,
    pigeonDigGiveUp: birdDigGiveUp, pigeonFreshDigFor: birdFreshDigFor, pigeonTunnelLiveDigKeys: birdTunnelLiveDigKeys,
    pigeonUnblock: birdUnblock, pigeonJoinSlotAt: birdJoinSlotAt, pigeonPerchSpotTaken: birdPerchSpotTaken,
    pigeonEndPortalTopAt: birdEndPortalTopAt, pigeonSameChain: birdSameChain,
    livePigeonLock: liveBirdLock, aimedPigeon: aimedBird, fireTNTAtPigeon: fireTNTAtBird,
    explodePigeon: explodeBird, spawnPigeonBurst: spawnBirdBurst,
    makeParrotMesh, pickParrotVariant, rollBirdKind, isBirdKind, isFlyingKind,
  });
}

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
