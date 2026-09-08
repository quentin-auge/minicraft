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
const MOON_FADE_START = CLOUD_BASE + CLOUD_SPAN * 5 / 8;
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
const DEV_START_DIM = "end";
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
  if (wasG !== gs.has(k)) {
    if (glowDefer > 0) glowDirtyDeferred = true;
    else { recomputeGlowClusters(); syncGlowLights(); }
  }
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
const WOLF_COUNT = 5;
const PIGEON_COUNT = 50;
const PIGEON_MIN_Y = 50;
const PIGEON_SEP_DIST = 2.5;
const PIGEON_PROBE_DIST = 3;
const PIGEON_SPEED = 8.8;
const PIGEON_PERCH_CHANCE = 0.65;
const PIGEON_HOP_CHANCE = 0.9;
const PIGEON_HOP_R = 30;
const PIGEON_HOP_RETRY = 2;
const PIGEON_PERCH_MIN_T = 2;
const PIGEON_PERCH_MAX_T = 10;
const PIGEON_PERCH_JOIN_R = 50;
const PIGEON_PERCH_SEP = 1.3;
let pigeonPerchGroup = 1;
const WOLF_FUR = 0xc8cdd2;
const WOLF_COLLAR_COLORS = [0xe53935, 0x2ecc40, 0x246bff, 0xffd600, 0x00bfa5];
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
  return villageHouses.length && y >= villageCenter.y + 5.5;
}
function houseAtRoof(x, z) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) return h;
  return null;
}
function isMobOnRoof(m) {
  if (!m || !m.pos) return false;
  if (!mobOnRoofLevel(m.pos.y)) return false;
  return !!houseAtRoof(m.pos.x, m.pos.z);
}
function houseInteriorFor(x, y, z) {
  const h = isInsideAnyHouse(x, z);
  if (!h) return null;
  if (y < h.vy + 1 || y > h.vy + 4) return null;
  return h;
}
function houseSealState(h) {
  const now = performance.now() / 1000;
  if (h._seal && now - h._seal.t < 1) return h._seal;
  const isDoor = (x, z) => (x === h.d0x && z === h.d0z) || (x === h.d1x && z === h.d1z);
  let sealed = true, hole = null;
  const cells = [];
  for (let x = h.minX; x <= h.maxX; x++) { cells.push([x, h.minZ]); cells.push([x, h.maxZ]); }
  for (let z = h.minZ + 1; z <= h.maxZ - 1; z++) { cells.push([h.minX, z]); cells.push([h.maxX, z]); }
  for (let y = h.vy + 1; y <= h.vy + 4 && sealed; y++)
    for (const [x, z] of cells) {
      if (!sealed) break;
      if (y <= h.vy + 3 && isDoor(x, z)) continue;
      if (!isSolid(x, y, z)) { sealed = false; hole = { x, y, z }; }
    }
  if (sealed)
    for (let x = h.minX; x <= h.maxX && sealed; x++)
      for (let z = h.minZ; z <= h.maxZ && sealed; z++)
        if (!isSolid(x, h.vy + 5, z)) { sealed = false; hole = { x, y: h.vy + 5, z }; }
  h._seal = { t: now, sealed, hole };
  return h._seal;
}
function holeFaceNormal(h, hole) {
  if (hole.y > h.vy + 4) return { x: 0, y: 1, z: 0 };
  if (hole.x === h.minX) return { x: -1, y: 0, z: 0 };
  if (hole.x === h.maxX) return { x: 1, y: 0, z: 0 };
  if (hole.z === h.minZ) return { x: 0, y: 0, z: -1 };
  if (hole.z === h.maxZ) return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 0, z: 0 };
}
function pigeonSegmentFree(ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(2, Math.ceil(d));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (aabbCollidesWorld(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 0.25, 0.5)) return false;
  }
  return true;
}
function bandReturnTarget(pos) {
  const y = pos.y < PIGEON_MIN_Y ? PIGEON_MIN_Y + 10 : PIGEON_MAX_Y - 10;
  return new THREE.Vector3(
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, pos.x)),
    y,
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, pos.z)));
}
function pigeonDetourTarget(m) {
  for (let t = 0; t < 10; t++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 8;
    const x = m.pos.x + Math.cos(a) * d, z = m.pos.z + Math.sin(a) * d;
    const y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y + (Math.random() - 0.5) * 10));
    if (pigeonProbeFree(x, y, z)) return new THREE.Vector3(x, y, z);
  }
  return null;
}
function pigeonCloudTopAt(cx, cz, loY, hiY) {
  const bx = Math.floor(cx), bz = Math.floor(cz);
  if (bx < -WORLD_RADIUS + 1 || bx > WORLD_RADIUS - 1 || bz < -WORLD_RADIUS + 1 || bz > WORLD_RADIUS - 1) return null;
  const lo = loY == null ? PIGEON_MIN_Y : loY, hi = hiY == null ? PIGEON_MAX_Y : hiY;
  let top = colTops.over[colTopIdx(bx, bz)];
  if (top > hi) top = Math.floor(hi);
  if (top < lo) return null;
  for (let y = top; y >= lo; y--) {
    if (getBlock(bx, y, bz) !== CLOUD) continue;
    const spot = new THREE.Vector3(bx + 0.5, y + 1, bz + 0.5);
    if (!aabbCollidesWorld(spot.x, spot.y, spot.z, 0.25, 0.5)) return spot;
  }
  return null;
}
function pigeonTreeTopAt(cx, cz) {
  const bx = Math.floor(cx), bz = Math.floor(cz);
  if (bx < -WORLD_RADIUS + 1 || bx > WORLD_RADIUS - 1 || bz < -WORLD_RADIUS + 1 || bz > WORLD_RADIUS - 1) return null;
  let top = colTops.over[colTopIdx(bx, bz)];
  if (top > 135) top = 135;
  for (let y = top; y >= 8; y--) {
    const id = getBlock(bx, y, bz);
    if (id !== LOG && id !== LEAVES) continue;
    const spot = new THREE.Vector3(bx + 0.5, y + 1, bz + 0.5);
    if (!aabbCollidesWorld(spot.x, spot.y, spot.z, 0.25, 0.5)) return spot;
  }
  return null;
}
function pigeonPerchSupports(x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y) - 1, bz = Math.floor(z);
  const id = getBlock(bx, by, bz);
  if (id === CLOUD || id === LOG || id === LEAVES) return true;
  if ((id === STONE || id === PLANKS) && villageHouses.length) {
    const h = houseAtRoof(bx + 0.5, bz + 0.5);
    if (h && by === h.vy + 5) return true;
  }
  return false;
}
function pigeonRoofTopAt(cx, cz) {
  if (!villageHouses.length) return null;
  const h = houseAtRoof(cx, cz);
  if (!h) return null;
  const bx = Math.floor(cx), bz = Math.floor(cz);
  const id = getBlock(bx, h.vy + 5, bz);
  if (id !== STONE && id !== PLANKS && id !== LOG) return null;
  const spot = new THREE.Vector3(bx + 0.5, h.vy + 6, bz + 0.5);
  if (aabbCollidesWorld(spot.x, spot.y, spot.z, 0.25, 0.5)) return null;
  return spot;
}
function pigeonPerchBand(y) {
  if (y < CLOUD_BASE) return 0;
  if (y < CLOUD_BASE + (PIGEON_MAX_Y - CLOUD_BASE) / 2) return 1;
  return 2;
}
function pigeonJoinSlotAt(x, z, refY) {
  const t = pigeonTreeTopAt(x, z), c = pigeonCloudTopAt(x, z), r = pigeonRoofTopAt(x, z);
  const ok = (s) => s && Math.abs(s.y - refY) <= 2;
  let best = null, bestD = Infinity;
  for (const s of [t, c, r]) {
    if (!ok(s)) continue;
    const d = Math.abs(s.y - refY);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
function pigeonPerchSpotTaken(x, y, z, self) {
  for (const o of mobs) {
    if (o === self || o.kind !== "pigeon") continue;
    if (o.dim !== undefined && o.dim !== "over") continue;
    const t = (o.mode === "toPerch" && o.perchSpot) ? o.perchSpot : (o.mode === "perch" ? o.pos : null);
    if (!t) continue;
    if (Math.hypot(t.x - x, t.y - y, t.z - z) < PIGEON_PERCH_SEP) return true;
  }
  return false;
}
function pigeonFindPerchSpot(m, nearMax = 0) {
  const counts = [0, 0, 0];
  const groupCounts = new Map();
  for (const o of mobs) {
    if (o === m || o.kind !== "pigeon" || o.perchGroup == null) continue;
    if (o.dim !== undefined && o.dim !== "over") continue;
    if (o.mode !== "perch" && o.mode !== "toPerch") continue;
    if (!o.perchSpot) continue;
    counts[pigeonPerchBand(o.perchSpot.y)]++;
    groupCounts.set(o.perchGroup, (groupCounts.get(o.perchGroup) || 0) + 1);
  }
  let band;
  if (nearMax || Math.random() < 0.25) band = Math.floor(Math.random() * 3);
  else {
    band = 0;
    for (let b = 1; b < 3; b++)
      if (counts[b] < counts[band] || (counts[b] === counts[band] && Math.random() < 0.5)) band = b;
  }
  const inBand = (s) => s && pigeonPerchBand(s.y) === band;
  let join = null, joinD = Infinity;
  for (const o of mobs) {
    if (o === m || o.kind !== "pigeon" || o.perchGroup == null || !o.perchSpot) continue;
    if (o.dim !== undefined && o.dim !== "over") continue;
    if (o.mode !== "perch" && o.mode !== "toPerch") continue;
    if (!inBand(o.perchSpot)) continue;
    if ((groupCounts.get(o.perchGroup) || 0) >= 3) continue;
    const d = Math.hypot(o.perchSpot.x - m.pos.x, o.perchSpot.y - m.pos.y, o.perchSpot.z - m.pos.z);
    if (d > PIGEON_PERCH_JOIN_R || d >= joinD) continue;
    joinD = d; join = o;
  }
  if (join) {
    const offs = [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]];
    const s0 = Math.floor(Math.random() * offs.length);
    for (let k = 0; k < offs.length; k++) {
      const off = offs[(s0 + k) % offs.length];
      const spot = pigeonJoinSlotAt(join.perchSpot.x + off[0], join.perchSpot.z + off[1], join.perchSpot.y);
      if (!spot) continue;
      if (pigeonPerchSpotTaken(spot.x, spot.y, spot.z, m)) continue;
      if (!pigeonSegmentFree(m.pos.x, m.pos.y, m.pos.z, spot.x, spot.y, spot.z)) continue;
      return { spot, group: join.perchGroup };
    }
  }
  const rMax = nearMax || 90;
  const trySpot = (spot) => {
    if (!inBand(spot)) return null;
    if (pigeonPerchSpotTaken(spot.x, spot.y, spot.z, m)) return null;
    if (!pigeonSegmentFree(m.pos.x, m.pos.y, m.pos.z, spot.x, spot.y, spot.z)) return null;
    return { spot, group: pigeonPerchGroup++ };
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
        spot = pigeonRoofTopAt(bx + 0.5, bz + 0.5);
      } else {
        const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * Math.max(8, rMax - 8);
        spot = pigeonRoofTopAt(m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d);
      }
      const got = spot && trySpot(spot);
      if (got) return got;
    }
    for (let t = 0; t < treeTries; t++) {
      const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * Math.max(8, rMax - 8);
      const spot = pigeonTreeTopAt(m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d);
      if (!spot) continue;
      const got = trySpot(spot);
      if (got) return got;
    }
    return null;
  }
  const mid = CLOUD_BASE + (PIGEON_MAX_Y - CLOUD_BASE) / 2;
  const lo = band === 1 ? CLOUD_BASE : mid, hi = band === 1 ? mid : PIGEON_MAX_Y;
  for (let t = 0; t < 24; t++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * Math.max(8, rMax - 8);
    const spot = pigeonCloudTopAt(m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d, lo, hi);
    if (!spot) continue;
    const got = trySpot(spot);
    if (got) return got;
  }
  return null;
}
function pigeonNextLeg(m) {
  m._decideT = 1.2;
  if (Math.random() < PIGEON_PERCH_CHANCE) {
    const found = pigeonFindPerchSpot(m);
    if (found) {
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
  if (Math.random() < 0.55) { m.target = pigeonRandomTarget(m.pos); m.targetMode = null; }
  else pigeonNewArc(m);
}
function pigeonTakeoff(m) {
  const yaw2 = m.yaw + (Math.random() - 0.5) * 1.2;
  m.vel.set(Math.cos(yaw2) * PIGEON_SPEED, 1.5, Math.sin(yaw2) * PIGEON_SPEED);
  m.perchSpot = null;
  m.perchGroup = null;
  m.perchT = 0;
  m.perchWander = null;
  m.perchWanderT = 0;
  m.perchTimeout = 0;
  m.perchRetry = 0;
  if (Math.random() < PIGEON_HOP_CHANCE) {
    const found = pigeonFindPerchSpot(m, PIGEON_HOP_R);
    if (found) {
      m.mode = "toPerch";
      m.arc = null;
      m.perchSpot = found.spot;
      m.perchGroup = found.group;
      m.perchTimeout = 30;
      m.target = found.spot;
      m.targetMode = "perch";
      return;
    }
    m.perchRetry = PIGEON_HOP_RETRY;
    m.mode = "straight";
    m.arc = null;
    m.target = pigeonRandomTarget(m.pos, 10, 25);
    m.targetMode = null;
    return;
  }
  m.mode = "straight";
  m.arc = null;
  m.target = pigeonRandomTarget(m.pos);
  m.targetMode = null;
}
function isInsidePen(x, z) {
  if (!villagePen) return false;
  return x >= villagePen.minX && x <= villagePen.maxX && z >= villagePen.minZ && z <= villagePen.maxZ;
}
function isInsidePenPool(x, z) {
  if (!villagePen || !villagePen.pool) return false;
  const q = villagePen.pool;
  return x >= q.minX && x <= q.maxX && z >= q.minZ && z <= q.maxZ;
}
function penPoolExitTarget(x, z) {
  if (!villagePen || !villagePen.pool) return null;
  const q = villagePen.pool, p = villagePen;
  const dL = x - q.minX, dR = (q.maxX + 1) - x, dT = z - q.minZ, dB = (q.maxZ + 1) - z;
  const cx = Math.max(p.minX + 1, Math.min(p.maxX - 1, x));
  const cz = Math.max(p.minZ + 1, Math.min(p.maxZ - 1, z));
  const cands = [];
  if (dL <= dR && dL <= dT && dL <= dB) cands.push(0);
  if (dR <= dL && dR <= dT && dR <= dB) cands.push(1);
  if (dT <= dB && dT <= dL && dT <= dR) cands.push(2);
  if (dB <= dT && dB <= dL && dB <= dR) cands.push(3);
  for (let i = 0; i < 4; i++) if (!cands.includes(i)) cands.push(i);
  for (const side of cands) {
    let ex = null;
    if (side === 0) ex = { x: q.minX - 1.5, z: cz };
    else if (side === 1) ex = { x: q.maxX + 2.5, z: cz };
    else if (side === 2) ex = { x: cx, z: q.minZ - 1.5 };
    else ex = { x: cx, z: q.maxZ + 2.5 };
    if (ex.x <= p.minX + 0.7 || ex.x >= p.maxX - 0.7 || ex.z <= p.minZ + 0.7 || ex.z >= p.maxZ - 0.7) continue;
    if (ex.x < villageMinX + 1 || ex.x > villageMaxX - 1 || ex.z < villageMinZ + 1 || ex.z > villageMaxZ - 1) continue;
    if (isInsideAnyHouse(ex.x, ex.z)) continue;
    return ex;
  }
  return null;
}
function isInsidePool(x, z) {
  if (!villagePool) return false;
  return x >= villagePool.minX && x <= villagePool.maxX && z >= villagePool.minZ && z <= villagePool.maxZ;
}
function poolExitTarget(x, z) {
  if (!villagePool) return null;
  const p = villagePool;
  const dL = x - p.minX, dR = (p.maxX + 1) - x, dT = z - p.minZ, dB = (p.maxZ + 1) - z;
  const cz = Math.max(villageMinZ + 1, Math.min(villageMaxZ - 1, z));
  const cx = Math.max(villageMinX + 1, Math.min(villageMaxX - 1, x));
  const cands = [];
  if (dL <= dR && dL <= dT && dL <= dB) cands.push(0);
  if (dR <= dL && dR <= dT && dR <= dB) cands.push(1);
  if (dT <= dB && dT <= dL && dT <= dR) cands.push(2);
  if (dB <= dT && dB <= dL && dB <= dR) cands.push(3);
  for (let i = 0; i < 4; i++) if (!cands.includes(i)) cands.push(i);
  for (const side of cands) {
    let ex = null;
    if (side === 0) ex = { x: p.minX - 1.5, z: cz };
    else if (side === 1) ex = { x: p.maxX + 2.5, z: cz };
    else if (side === 2) ex = { x: cx, z: p.minZ - 1.5 };
    else ex = { x: cx, z: p.maxZ + 2.5 };
    if (ex.x < villageMinX + 1 || ex.x > villageMaxX - 1 || ex.z < villageMinZ + 1 || ex.z > villageMaxZ - 1) continue;
    if (isInsideAnyHouse(ex.x, ex.z)) continue;
    return ex;
  }
  return null;
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
      let roofMat = STONE;
      if (isRoofEdge) roofMat = LOG;
      else roofMat = h.roofIsPlank ? PLANKS : STONE;
      if (h.varId === 1) roofMat = PLANKS;
      setBlock(x, vy + hh, z, roofMat);
    }
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
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
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
  g.userData = { isBaby, sc, legL, legR, armL, armR, body, head, palette: pal, palIdx };
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
  g.userData = { sc, legBL, legBR, legFL, legFR, body, head, tail, furHex: fur, collarHex: collar, kind: "wolf" };
  return g;
}
const pigeonBodyMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9 });
const pigeonDarkMat = new THREE.MeshStandardMaterial({ color: 0x6b7076, roughness: 0.9 });
const pigeonHeadMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.9 });
const pigeonBeakMat = new THREE.MeshStandardMaterial({ color: 0xe8930c, roughness: 0.9 });
const pigeonEyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
function makePigeonMesh() {
  const g = new THREE.Group();
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  const geo = villagerGeo;
  const body = new THREE.Mesh(geo, pigeonBodyMat);
  body.scale.set(0.34, 0.30, 0.52);
  body.position.set(0, 0.28, 0);
  g.add(body);
  const head = new THREE.Mesh(geo, pigeonHeadMat);
  head.scale.set(0.24, 0.24, 0.24);
  head.position.set(0, 0.48, 0.30);
  g.add(head);
  const beak = new THREE.Mesh(geo, pigeonBeakMat);
  beak.scale.set(0.10, 0.08, 0.12);
  beak.position.set(0, 0.46, 0.46);
  g.add(beak);
  for (const sx of [1, -1]) {
    const eye = new THREE.Mesh(geo, pigeonEyeMat);
    eye.scale.set(0.05, 0.05, 0.02);
    eye.position.set(sx * 0.10, 0.52, 0.42);
    g.add(eye);
  }
  const tail = new THREE.Mesh(geo, pigeonDarkMat);
  tail.scale.set(0.22, 0.08, 0.30);
  tail.position.set(0, 0.28, -0.38);
  g.add(tail);
  const wingL = new THREE.Group();
  wingL.position.set(-0.18, 0.34, 0);
  g.add(wingL);
  const wingLM = new THREE.Mesh(geo, pigeonDarkMat);
  wingLM.scale.set(0.44, 0.06, 0.30);
  wingLM.position.set(-0.22, 0, 0);
  wingL.add(wingLM);
  const wingR = new THREE.Group();
  wingR.position.set(0.18, 0.34, 0);
  g.add(wingR);
  const wingRM = new THREE.Mesh(geo, pigeonDarkMat);
  wingRM.scale.set(0.44, 0.06, 0.30);
  wingRM.position.set(0.22, 0, 0);
  wingR.add(wingRM);
  g.userData = { wingL, wingR, body, head, kind: "pigeon" };
  return g;
}
function pigeonRandomTarget(from, minDist = 40, maxDist = 90) {
  for (let t = 0; t < 12; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * (maxDist - minDist);
    const x = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.x + Math.cos(a) * d));
    const z = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.z + Math.cos(a + 1.7) * d));
    const y = PIGEON_MIN_Y + 5 + Math.random() * (PIGEON_MAX_Y - PIGEON_MIN_Y - 10);
    if (Math.hypot(x - from.x, z - from.z) < 12) continue;
    return new THREE.Vector3(x, y, z);
  }
  return new THREE.Vector3(
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.x + (Math.random() - 0.5) * 80)),
    PIGEON_MIN_Y + 5 + Math.random() * (PIGEON_MAX_Y - PIGEON_MIN_Y - 10),
    Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, from.z + (Math.random() - 0.5) * 80)));
}
function pigeonNewArc(m) {
  const side = Math.random() < 0.5 ? 1 : -1;
  const r = 6 + Math.random() * 14;
  const v = m.vel.length() || PIGEON_SPEED;
  const fwd = v > 0.01 ? m.vel.clone().normalize() : new THREE.Vector3(Math.cos(m.yaw), 0, Math.sin(m.yaw));
  const cx = m.pos.x - fwd.z * side * r + (Math.random() - 0.5) * 8;
  const cz = m.pos.z + fwd.x * side * r + (Math.random() - 0.5) * 8;
  const cy = Math.max(PIGEON_MIN_Y + 3, Math.min(PIGEON_MAX_Y - 3, m.pos.y + (Math.random() - 0.5) * 12));
  m.arc = {
    cx: Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cx)),
    cz: Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, cz)),
    cy, r, side,
    swept: 0,
    total: 1.5 + Math.random() * 3.0,
  };
  m.mode = "arc";
}
function spawnSinglePigeon(outOfView = false, sx = null, sy = null, sz = null) {
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  let px, py, pz;
  if (sx != null && sy != null && sz != null) {
    px = sx; py = sy; pz = sz;
  } else if (outOfView) {
    const spot = pigeonSpotOutOfView();
    px = spot.x; py = spot.y; pz = spot.z;
  } else {
    px = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    pz = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    py = PIGEON_MIN_Y + 5 + Math.random() * (PIGEON_MAX_Y - PIGEON_MIN_Y - 10);
  }
  py = Math.max(PIGEON_MIN_Y + 1, Math.min(PIGEON_MAX_Y - 1, py));
  if (aabbCollidesWorld(px, py, pz, 0.25, 0.5)) {
    for (let t = 0; t < 10 && aabbCollidesWorld(px, py, pz, 0.25, 0.5); t++) {
      px = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
      pz = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
      py = PIGEON_MIN_Y + 5 + Math.random() * (PIGEON_MAX_Y - PIGEON_MIN_Y - 10);
    }
    if (aabbCollidesWorld(px, py, pz, 0.25, 0.5)) return null;
  }
  const mesh = makePigeonMesh();
  mesh.position.set(px, py, pz);
  const yaw = Math.random() * Math.PI * 2;
  mesh.rotation.y = yaw;
  scene.add(mesh);
  const m = {
    id: gid++, kind: "pigeon", canStep: false, homeId: -1, isBaby: false, parentId: -1, dim: "over",
    pos: new THREE.Vector3(px, py, pz),
    vel: new THREE.Vector3(Math.cos(yaw) * PIGEON_SPEED, 0, Math.sin(yaw) * PIGEON_SPEED),
    hw: 0.25, h: 0.5, mesh, onGround: false,
    target: null, arc: null, mode: "straight", wanderT: 0,
    perchSpot: null, perchGroup: null, perchT: 0, perchWander: null, perchWanderT: 0, perchTimeout: 0, perchRetry: 0,
    legPhase: Math.random() * Math.PI * 2, speed: PIGEON_SPEED,
    blockedT: 0, yaw, yawTarget: yaw, villageBound: false,
    _stuckT: 0, _prevX: px, _prevZ: pz,
    path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null, _wasInWater: false, wolfInWater: false,
  };
  m.target = pigeonRandomTarget(m.pos);
  mobs.push(m);
  mobById.set(m.id, m);
  return m;
}
function spawnPigeons() {
  const cur = mobs.filter((m) => (m.dim === "over" || m.dim === undefined) && m.kind === "pigeon").length;
  for (let i = cur; i < PIGEON_COUNT; i++) spawnSinglePigeon(false);
}
function removePigeons() {
  const keepCarry = carryMob && mobs.includes(carryMob) ? carryMob : null;
  const survivors = [];
  for (const m of mobs) {
    if (m.kind !== "pigeon") { survivors.push(m); continue; }
    if (m === keepCarry) { survivors.push(m); continue; }
    if (m.mesh) scene.remove(m.mesh);
    mobById.delete(m.id);
  }
  mobs.length = 0;
  for (const s of survivors) mobs.push(s);
  pigeonLock = null;
  pigeonLockT = 0;
  pigeonLockShots = 0;
}
function pigeonSpotOutOfView() {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  let best = null, bestScore = -Infinity;
  for (let t = 0; t < 24; t++) {
    const x = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    const z = (Math.random() * 2 - 1) * (WORLD_RADIUS - 4);
    const y = PIGEON_MIN_Y + 5 + Math.random() * (PIGEON_MAX_Y - PIGEON_MIN_Y - 10);
    if (aabbCollidesWorld(x, y, z, 0.25, 0.5)) continue;
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
    y: PIGEON_MIN_Y + 10 + Math.random() * (PIGEON_MAX_Y - PIGEON_MIN_Y - 20),
    z: Math.max(-WORLD_RADIUS + 4, Math.min(WORLD_RADIUS - 4, camera.position.z - fwd.z * 150 + Math.sin(a) * 30)),
  };
}
function killPigeon(m) {
  const i = mobs.indexOf(m);
  if (i < 0) return;
  if (m === carryMob) return;
  if (pigeonLock === m) pigeonLock = null;
  if (m.mesh) scene.remove(m.mesh);
  mobById.delete(m.id);
  mobs.splice(i, 1);
  spawnSinglePigeon(true);
}
function pigeonProbeFree(x, y, z) {
  if (x < -WORLD_RADIUS + 1 || x > WORLD_RADIUS - 1 || z < -WORLD_RADIUS + 1 || z > WORLD_RADIUS - 1) return false;
  if (y < 1 || y > MAX_Y - 1) return false;
  return !aabbCollidesWorld(x, y, z, 0.25, 0.5);
}
function pigeonSeparate(m, dt, vel, sp) {
  const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 1);
  for (const o of nearby) {
    if (o === m || o.kind !== "pigeon") continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    const ox = m.pos.x - o.pos.x, oy = m.pos.y - o.pos.y, oz = m.pos.z - o.pos.z;
    const d2 = ox * ox + oy * oy + oz * oz;
    if (d2 < PIGEON_SEP_DIST * PIGEON_SEP_DIST && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (PIGEON_SEP_DIST - d) * 6 * dt;
      vel.x += (ox / d) * push * sp * 0.12;
      vel.y += (oy / d) * push * sp * 0.12;
      vel.z += (oz / d) * push * sp * 0.12;
    }
  }
}
function pigeonAnimate(m, dt, vx, vy, vz, sp) {
  const targetYaw = Math.atan2(vx, vz);
  let dyaw = targetYaw - m.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  m.yaw += dyaw * Math.min(1, dt * 3.5);
  m.yawTarget = targetYaw;
  m.mesh.position.copy(m.pos);
  m.mesh.rotation.y = m.yaw;
  m.mesh.rotation.x = Math.max(-0.45, Math.min(0.45, -vy / sp * 0.9));
  m.mesh.rotation.z = Math.max(-0.5, Math.min(0.5, -dyaw * 1.2));
  m.legPhase += dt * 11;
  const f = Math.sin(m.legPhase) * 0.65;
  if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = f;
  if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -f;
}
function pigeonCoopTarget(h) {
  return new THREE.Vector3(
    h.minX + 1.5 + Math.random() * (h.maxX - h.minX - 3),
    h.vy + 1.5 + Math.random() * 2,
    h.minZ + 1.5 + Math.random() * (h.maxZ - h.minZ - 3));
}
function updateHoleExitPigeon(m, dt, h, hole) {
  dt = Math.min(0.05, dt);
  const sp = WALK;
  const n = holeFaceNormal(h, hole);
  const cx = hole.x + 0.5, cy = hole.y + 0.5, cz = hole.z + 0.5;
  let rx = m.pos.x - cx, ry = m.pos.y - cy, rz = m.pos.z - cz;
  let s = rx * n.x + ry * n.y + rz * n.z;
  let lx = rx - s * n.x, ly = ry - s * n.y, lz = rz - s * n.z;
  if (s > -3 && s < 1.5) {
    const snap = Math.min(1, dt * 6);
    const nx = m.pos.x - lx * snap, ny = m.pos.y - ly * snap, nz = m.pos.z - lz * snap;
    if (!aabbCollidesWorld(nx, ny, nz, m.hw, m.h)) { m.pos.x = nx; m.pos.y = ny; m.pos.z = nz; }
    rx = m.pos.x - cx; ry = m.pos.y - cy; rz = m.pos.z - cz;
    s = rx * n.x + ry * n.y + rz * n.z;
    lx = rx - s * n.x; ly = ry - s * n.y; lz = rz - s * n.z;
  }
  const lat = Math.hypot(lx, ly, lz);
  const fwd = sp * (0.3 + 0.7 * Math.min(1, lat / 0.5));
  const k = Math.min(1, dt * 3);
  const vel = { x: m.vel.x, y: m.vel.y, z: m.vel.z };
  vel.x += ((n.x * fwd - lx * 5) - vel.x) * k;
  vel.y += ((n.y * fwd - ly * 5) - vel.y) * k;
  vel.z += ((n.z * fwd - lz * 5) - vel.z) * k;
  pigeonSeparate(m, dt, vel, sp);
  const nvl = Math.hypot(vel.x, vel.y, vel.z) || 1;
  const cl = Math.max(sp * 0.6, Math.min(sp * 1.3, nvl));
  vel.x = (vel.x / nvl) * cl; vel.y = (vel.y / nvl) * cl; vel.z = (vel.z / nvl) * cl;
  m.pos.x += vel.x * dt;
  m.pos.y += vel.y * dt;
  m.pos.z += vel.z * dt;
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) {
    m.pos.x -= vel.x * dt;
    m.pos.y -= vel.y * dt;
    m.pos.z -= vel.z * dt;
    vel.x *= 0.3; vel.y *= 0.3; vel.z *= 0.3;
  }
  m.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.x));
  m.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.z));
  m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
  m.vel.set(vel.x, vel.y, vel.z);
  m.mode = "straight";
  m.arc = null;
  m.target = null;
  m.targetMode = null;
  pigeonAnimate(m, dt, vel.x, vel.y, vel.z, sp);
}
function updateCoopedPigeon(m, dt, h) {
  dt = Math.min(0.05, dt);
  const sp = WALK / 2;
  if (!m.target || m.targetMode !== "coop" || Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z) < 0.8) {
    m.target = pigeonCoopTarget(h);
    m.targetMode = "coop";
  }
  const tx = m.target.x - m.pos.x, ty = m.target.y - m.pos.y, tz = m.target.z - m.pos.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  const k = Math.min(1, dt * 2.2);
  const vel = { x: m.vel.x, y: m.vel.y, z: m.vel.z };
  vel.x += ((tx / tl) * sp - vel.x) * k;
  vel.y += ((ty / tl) * sp - vel.y) * k;
  vel.z += ((tz / tl) * sp - vel.z) * k;
  pigeonSeparate(m, dt, vel, sp);
  const nvl = Math.hypot(vel.x, vel.y, vel.z) || 1;
  const cl = Math.max(sp * 0.6, Math.min(sp * 1.3, nvl));
  vel.x = (vel.x / nvl) * cl; vel.y = (vel.y / nvl) * cl; vel.z = (vel.z / nvl) * cl;
  m.pos.x += vel.x * dt;
  m.pos.y += vel.y * dt;
  m.pos.z += vel.z * dt;
  if (!houseInteriorFor(m.pos.x, m.pos.y, m.pos.z) || aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) {
    m.pos.x -= vel.x * dt;
    m.pos.y -= vel.y * dt;
    m.pos.z -= vel.z * dt;
    m.target = pigeonCoopTarget(h);
  }
  m.pos.y = Math.max(h.vy + 1, Math.min(h.vy + 4, m.pos.y));
  m.vel.set(vel.x, vel.y, vel.z);
  pigeonAnimate(m, dt, vel.x, vel.y, vel.z, sp);
}
function updatePerchedPigeon(m, dt) {
  dt = Math.min(0.05, dt);
  if (grappleMob === m) { pigeonTakeoff(m); return; }
  if (!m.perchSpot || !pigeonPerchSupports(m.perchSpot.x, m.perchSpot.y, m.perchSpot.z)) { pigeonTakeoff(m); return; }
  m.perchT -= dt;
  if (m.perchT <= 0) { pigeonTakeoff(m); return; }
  m.perchWanderT -= dt;
  if (!m.perchWander || m.perchWanderT <= 0) {
    const a = Math.random() * Math.PI * 2, d = 0.3 + Math.random() * 0.4;
    const nx = m.perchSpot.x + Math.cos(a) * d, nz = m.perchSpot.z + Math.sin(a) * d;
    if (pigeonPerchSupports(nx, m.perchSpot.y, nz) &&
        !pigeonPerchSpotTaken(nx, m.pos.y, nz, m) &&
        !aabbCollidesWorld(nx, m.pos.y, nz, m.hw, m.h)) {
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
  pigeonSeparate(m, dt, vel, 1.2);
  vx = vel.x; vz = vel.z;
  const ox = m.pos.x, oz = m.pos.z;
  m.pos.x += vx * dt;
  m.pos.z += vz * dt;
  m.pos.y += (m.perchSpot.y - m.pos.y) * Math.min(1, dt * 8);
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) { m.pos.x = ox; m.pos.z = oz; vx = 0; vz = 0; }
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
function updateToPerchPigeon(m, dt) {
  dt = Math.min(0.05, dt);
  const s = m.perchSpot;
  if (grappleMob === m) { pigeonTakeoff(m); return; }
  if (!s || !pigeonPerchSupports(s.x, s.y, s.z)) { pigeonTakeoff(m); return; }
  m.perchTimeout -= dt;
  if (m.perchTimeout <= 0) { pigeonTakeoff(m); return; }
  const dx = s.x - m.pos.x, dy = s.y - m.pos.y, dz = s.z - m.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1.5) {
    m.pos.set(s.x, s.y, s.z);
    m.vel.set(0, 0, 0);
    m.mode = "perch";
    m.target = null; m.targetMode = null; m.arc = null;
    m.perchT = PIGEON_PERCH_MIN_T + Math.random() * (PIGEON_PERCH_MAX_T - PIGEON_PERCH_MIN_T);
    m.perchWander = null; m.perchWanderT = 0;
    m.mesh.position.copy(m.pos);
    if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = 0.12;
    if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -0.12;
    return;
  }
  const sp = PIGEON_SPEED;
  const spd = dist < 6 ? sp * Math.max(0.35, dist / 6) : sp;
  let sx = dx / dist, sy = dy / dist, sz = dz / dist;
  if (dist > 12 && !pigeonProbeFree(m.pos.x + sx * PIGEON_PROBE_DIST, m.pos.y + sy * PIGEON_PROBE_DIST, m.pos.z + sz * PIGEON_PROBE_DIST)) {
    const baseYaw = Math.atan2(sx, sz);
    const yaws = [0, 0.6, -0.6, 1.2, -1.2];
    let found = false;
    for (const off of yaws) {
      for (const vy2 of [sy, 0.2, -0.2, 0]) {
        const nx = Math.sin(baseYaw + off), nz = Math.cos(baseYaw + off);
        const nl = Math.hypot(nx, vy2, nz) || 1;
        if (pigeonProbeFree(m.pos.x + (nx / nl) * PIGEON_PROBE_DIST, m.pos.y + (vy2 / nl) * PIGEON_PROBE_DIST, m.pos.z + (nz / nl) * PIGEON_PROBE_DIST)) {
          sx = nx / nl; sy = vy2 / nl; sz = nz / nl;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) { pigeonTakeoff(m); return; }
  }
  const k = Math.min(1, dt * (dist < 12 ? 3.5 : 2.5));
  let vx = m.vel.x + (sx * spd - m.vel.x) * k;
  let vy = m.vel.y + (sy * spd - m.vel.y) * k;
  let vz = m.vel.z + (sz * spd - m.vel.z) * k;
  const vel = { x: vx, y: vy, z: vz };
  pigeonSeparate(m, dt, vel, sp);
  vx = vel.x; vy = vel.y; vz = vel.z;
  m.pos.x += vx * dt;
  m.pos.y += vy * dt;
  m.pos.z += vz * dt;
  m.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.x));
  m.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.z));
  m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) {
    m.pos.x -= vx * dt;
    m.pos.y -= vy * dt;
    m.pos.z -= vz * dt;
    pigeonTakeoff(m);
    return;
  }
  m.vel.set(vx, vy, vz);
  pigeonAnimate(m, dt, vx, vy, vz, sp);
}
function updatePigeon(m, dt) {
  dt = Math.min(0.05, dt);
  const inHouse = houseInteriorFor(m.pos.x, m.pos.y, m.pos.z);
  if (inHouse) {
    const st = houseSealState(inHouse);
    if (st.sealed) { updateCoopedPigeon(m, dt, inHouse); return; }
    if (st.hole) { updateHoleExitPigeon(m, dt, inHouse, st.hole); return; }
  } else if (m.targetMode === "coop") {
    m.targetMode = null;
    m.target = null;
  }
  if (m.mode === "perch") { updatePerchedPigeon(m, dt); return; }
  if (m.mode === "toPerch") { updateToPerchPigeon(m, dt); return; }
  if (m.mode !== "straight" && m.mode !== "arc") { m.mode = "straight"; m.target = null; m.targetMode = null; m.perchRetry = 0; }
  m._decideT = Math.max(0, (m._decideT || 0) - dt);
  const outBand = !inHouse && (m.pos.y < PIGEON_MIN_Y || m.pos.y > PIGEON_MAX_Y);
  const sp = PIGEON_SPEED;
  let vx = m.vel.x, vy = m.vel.y, vz = m.vel.z;
  const vl = Math.hypot(vx, vy, vz) || 1;
  let dx = vx / vl, dy = vy / vl, dz = vz / vl;
  if (!inHouse) {
  if (m.pos.y < PIGEON_MIN_Y + 5) dy += (PIGEON_MIN_Y + 5 - m.pos.y) * 0.08;
  else if (m.pos.y > PIGEON_MAX_Y - 5) dy -= (m.pos.y - (PIGEON_MAX_Y - 5)) * 0.08;
  }
  const edge = WORLD_RADIUS - 6;
  if (m.pos.x < -edge || m.pos.x > edge || m.pos.z < -edge || m.pos.z > edge) {
    dx += (0 - m.pos.x) * 0.02;
    dz += (0 - m.pos.z) * 0.02;
  }
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  let steerX = dx, steerY = dy, steerZ = dz;
  if (!pigeonProbeFree(m.pos.x + dx * PIGEON_PROBE_DIST, m.pos.y + dy * PIGEON_PROBE_DIST, m.pos.z + dz * PIGEON_PROBE_DIST)) {
    const baseYaw = Math.atan2(dx, dz);
    const yaws = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
    let found = false;
    for (const off of yaws) {
      for (const vy2 of [dy * 0.5, 0.25, -0.25, 0]) {
        const nx = Math.sin(baseYaw + off), nz = Math.cos(baseYaw + off);
        const nl = Math.hypot(nx, vy2, nz) || 1;
        if (pigeonProbeFree(m.pos.x + (nx / nl) * PIGEON_PROBE_DIST, m.pos.y + (vy2 / nl) * PIGEON_PROBE_DIST, m.pos.z + (nz / nl) * PIGEON_PROBE_DIST)) {
          steerX = nx / nl; steerY = vy2 / nl; steerZ = nz / nl;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      steerX = -dx; steerY = 0.1; steerZ = -dz;
      if (outBand && m.targetMode !== "detour") {
        const det = pigeonDetourTarget(m);
        if (det) { m.target = det; m.targetMode = "detour"; m.detourT = 2.5; }
      }
    }
  } else if (m.mode === "straight") {
    if (outBand && m.targetMode !== "detour") {
      m.target = bandReturnTarget(m.pos);
      m.targetMode = "return";
    }
    if (m.targetMode === "detour") {
      m.detourT -= dt;
      if (m.detourT <= 0 || (m.target && Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z) < 2)) {
        m.target = null;
        m.targetMode = null;
      }
    }
    if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z) < 2.5) {
      if (outBand) { m.target = bandReturnTarget(m.pos); m.targetMode = "return"; m.perchRetry = 0; }
      else if (m.perchRetry > 0) {
        m.perchRetry--;
        const found = pigeonFindPerchSpot(m, PIGEON_HOP_R);
        if (found) {
          m.mode = "toPerch";
          m.arc = null;
          m.perchSpot = found.spot;
          m.perchGroup = found.group;
          m.perchTimeout = 30;
          m.target = found.spot;
          m.targetMode = "perch";
        }
        else if (m.perchRetry > 0) m.target = pigeonRandomTarget(m.pos, 10, 25);
        else pigeonNextLeg(m);
      }
      else pigeonNextLeg(m);
    }
    if (m.mode === "straight" && m.target) {
      const tx = m.target.x - m.pos.x, ty = m.target.y - m.pos.y, tz = m.target.z - m.pos.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      steerX = tx / tl; steerY = ty / tl; steerZ = tz / tl;
      if (!pigeonProbeFree(m.pos.x + steerX * PIGEON_PROBE_DIST, m.pos.y + steerY * PIGEON_PROBE_DIST, m.pos.z + steerZ * PIGEON_PROBE_DIST)) {
        if ((m._decideT || 0) <= 0) pigeonNextLeg(m);
        else m.target = pigeonRandomTarget(m.pos);
      }
    }
  } else if (m.mode === "arc" && m.arc) {
    const a = m.arc;
    const rx = m.pos.x - a.cx, rz = m.pos.z - a.cz;
    const rl = Math.hypot(rx, rz) || 1;
    const tx = -rz / rl * a.side, tz = rx / rl * a.side;
    const ty = Math.max(-0.3, Math.min(0.3, (a.cy - m.pos.y) * 0.05));
    const tl = Math.hypot(tx, ty, tz) || 1;
    steerX = tx / tl; steerY = ty / tl; steerZ = tz / tl;
    a.swept += (sp / Math.max(4, a.r)) * dt;
    if (a.swept >= a.total) { m.arc = null; m.mode = "straight"; pigeonNextLeg(m); }
  }
  const k = Math.min(1, dt * 2.2);
  vx += (steerX * sp - vx) * k;
  vy += (steerY * sp - vy) * k;
  vz += (steerZ * sp - vz) * k;
  const vel = { x: vx, y: vy, z: vz };
  pigeonSeparate(m, dt, vel, sp);
  vx = vel.x; vy = vel.y; vz = vel.z;
  const nvl = Math.hypot(vx, vy, vz) || 1;
  const cl = Math.max(sp * 0.6, Math.min(sp * 1.3, nvl));
  vx = (vx / nvl) * cl; vy = (vy / nvl) * cl; vz = (vz / nvl) * cl;
  m.pos.x += vx * dt;
  m.pos.y += vy * dt;
  m.pos.z += vz * dt;
  m.pos.x = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.x));
  m.pos.z = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, m.pos.z));
  m.pos.y = Math.max(1, Math.min(MAX_Y - 1, m.pos.y));
  if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) {
    m.pos.x -= vx * dt;
    m.pos.y -= vy * dt;
    m.pos.z -= vz * dt;
    vx = -vx * 0.5; vy = 0.5; vz = -vz * 0.5;
    if (outBand) {
      const det = pigeonDetourTarget(m);
      if (det) { m.target = det; m.targetMode = "detour"; m.detourT = 2.5; }
    } else {
      pigeonNextLeg(m);
    }
    m.arc = null; m.mode = "straight";
  }
  m.vel.set(vx, vy, vz);
  const targetYaw = Math.atan2(vx, vz);
  let dyaw = targetYaw - m.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  m.yaw += dyaw * Math.min(1, dt * 3.5);
  m.yawTarget = targetYaw;
  m.mesh.position.copy(m.pos);
  m.mesh.rotation.y = m.yaw;
  m.mesh.rotation.x = Math.max(-0.45, Math.min(0.45, -vy / sp * 0.9));
  m.mesh.rotation.z = Math.max(-0.5, Math.min(0.5, -dyaw * 1.2));
  m.legPhase += dt * 11;
  const f = Math.sin(m.legPhase) * 0.65;
  if (m.mesh.userData.wingL) m.mesh.userData.wingL.rotation.z = f;
  if (m.mesh.userData.wingR) m.mesh.userData.wingR.rotation.z = -f;
}
function villagerHW(m) {
  if (m.kind === "dragon") return 1.5;
  if (m.kind === "enderman") return 0.31;
  if (m.kind === "pigeon") return 0.25;
  if (m.kind === "wolf") return 0.30;
  if (m.kind === "pig" || m.kind === "cow") return 0.32;
  return m.isBaby ? 0.16 : 0.27;
}
function villagerH(m) {
  if (m.kind === "dragon") return 3;
  if (m.kind === "enderman") return 2.7;
  if (m.kind === "pigeon") return 0.5;
  if (m.kind === "wolf") return 0.90;
  if (m.kind === "pig") return 0.92;
  if (m.kind === "cow") return 1.30;
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
  for (let y = Math.floor(hintY) + 4; y >= Math.floor(hintY) - 24; y--) {
    if (y < 0 || y > MAX_Y) continue;
    if (!mobBlockedAt(x, z, hw, y)) return y;
  }
  for (let y = MAX_Y; y >= 0; y--) if (!mobBlockedAt(x, z, hw, y)) return y;
  return Math.floor(hintY);
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
      if (obj.isMesh && obj.material) {
        if (Array.isArray(obj.material)) obj.material = obj.material.map((mm) => mm.clone());
        else obj.material = obj.material.clone();
      }
    });
  }
  m.mesh.traverse((obj) => {
    if (obj.isMesh && obj.material) {
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
    if (m === carryMob || m === carryGrappleMob) continue;
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
function isMobFrozenByGrapple(m) {
  if (m !== carryGrappleMob) return false;
  if (carryGrappleMode === "release") return carryGrappleActive || carryGrapplePulling || carryGrappleRetracting;
  return carryGrapplePulling;
}

function releaseCarriedMobAt(px, py, pz) {
  if (!carryMob) return;
  const m = carryMob;
  const hw = m.hw;
  if (m.kind === "pigeon") {
    let nx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, px + 0.5));
    let nz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, pz + 0.5));
    let ny = Math.max(1, Math.min(MAX_Y - 2, Math.round(py)));
    for (let t = 0; t < 8 && aabbCollidesWorld(nx, ny, nz, hw, m.h); t++) ny++;
    if (aabbCollidesWorld(nx, ny, nz, hw, m.h)) { nx = m.pos.x; ny = m.pos.y; nz = m.pos.z; }
    m.pos.set(nx, ny, nz);
    m.mesh.position.copy(m.pos);
    m.mesh.rotation.z = 0;
    m.mesh.rotation.x = 0;
    if (m.dim !== undefined) m.dim = dim;
    const yaw2 = Math.random() * Math.PI * 2;
    m.vel.set(Math.cos(yaw2) * PIGEON_SPEED, 0, Math.sin(yaw2) * PIGEON_SPEED);
    m.onGround = false;
    m.villageBound = false;
    m.speed = PIGEON_SPEED;
    m.mode = "straight";
    m.arc = null;
    m.target = pigeonRandomTarget(m.pos);
    m.perchSpot = null;
    m.perchGroup = null;
    m.perchT = 0;
    m.perchWander = null;
    m.perchWanderT = 0;
    m.perchTimeout = 0;
    m.perchRetry = 0;
    m.yaw = yaw2;
    m.yawTarget = yaw2;
    m.mesh.visible = true;
    setMobTransparent(m, 1);
    carryMob = null;
    return;
  }
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
  let nx = px + 0.5, nz = pz + 0.5, hintY = py;
  const insideVillagePre = nx >= villageMinX && nx <= villageMaxX && nz >= villageMinZ && nz <= villageMaxZ;
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
  const insideVillage = nx >= villageMinX && nx <= villageMaxX && nz >= villageMinZ && nz <= villageMaxZ;
  m.villageBound = insideVillage;
  m.speed = WALK / 2;
  if (mobOnRoofLevel(hintY) && houseAtRoof(nx, nz)) {
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
  if (m.isBaby) m._followDetourUntil = 0;
  m.mesh.visible = true;
  setMobTransparent(m, 1);
  carryMob = null;
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
  const eye = camera.position;
  const off = getMobHitOffset(eye, dir, mob);
  const mx = off ? mob.pos.x + off.x : mob.pos.x;
  const my = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5;
  const mz = off ? mob.pos.z + off.z : mob.pos.z;
  if (off) carryGrappleOffset.copy(off);
  else carryGrappleOffset.set(0, mob.h * 0.5, 0);
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
  if (!currentBlock) return false;
  const b = currentBlock;
  const eye = camera.position;
  let px, py, pz, tx, ty, tz;
  let h = 0;
  while (isSolid(b.x, b.y + h + 1, b.z)) h++;
  if (h <= 1) {
    px = b.x; py = b.y + h + 1; pz = b.z;
    tx = b.x + 0.5; ty = b.y + h + 1.5; tz = b.z + 0.5;
  } else {
    px = b.x + b.face[0]; py = b.y + b.face[1]; pz = b.z + b.face[2];
    tx = px + 0.5; ty = py + 0.5; tz = pz + 0.5;
  }
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
  if (!carryGrappleActive && !carryGrapplePulling) return;
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
        if (grappleMob === mob) detachDisplacementGrapple();
      } else {
        const move = Math.min(step, dist0);
        const s = move / dist0;
        carryGrappleHookPos.x += dx0 * s;
        carryGrappleHookPos.y += dy0 * s;
        carryGrappleHookPos.z += dz0 * s;
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
          releaseCarriedMobAt(b.x, b.y, b.z);
        } else {
          mob.pos.set(tx, ty - mob.h * 0.5, tz);
          mob.mesh.position.copy(mob.pos);
          setMobTransparent(mob, 1);
        }
        carryGrappleRetracting = true;
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
    startCarryReleaseGrapple();
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
function wanderGoalFor(m) {
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 30; t++) {
    const x = villageMinX + 2 + Math.random() * (villageMaxX - villageMinX - 4);
    const z = villageMinZ + 2 + Math.random() * (villageMaxZ - villageMinZ - 4);
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (isInsidePenPool(x, z)) continue;
    if (x < villageMinX + 1 || x > villageMaxX - 1 || z < villageMinZ + 1 || z > villageMaxZ - 1) continue;
    if (mobBlockedAt(x, z, m.hw, villageCenter.y + 1)) continue;
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
    const score = v * 10 - dCur * 0.15 + mobPenalty;
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
  if (!villagePen) return wanderGoalFor(m);
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
    const score = v * 10 - dCur * 0.15 + mobPenalty;
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
    if (isInsideAnyHouse(tx, tz)) continue;
    if (isInsidePool(tx, tz)) continue;
    if (isInsidePenPool(tx, tz)) continue;
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
  if (!isInsidePool(tx2, tz2) && !isInsidePenPool(tx2, tz2) && Math.abs(tx2) <= WORLD_RADIUS - 1 && Math.abs(tz2) <= WORLD_RADIUS - 1 && !aabbCollidesWorld(tx2, py2, tz2, mob.hw, mob.h) && (hasGround2(tx2, tz2, mob.hw, py2) || hasGround2(tx2, tz2, mob.hw, py2 + 1) || hasGround2(tx2, tz2, mob.hw, py2 - 1))) return { x: tx2, z: tz2 };
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
        if (!onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) return false;
        }
      } else if (!gyIsWater) {
        return false;
      } else {
        if (!onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) return false;
        }
      }
    }
  }
  return true;
}
function mobBlockedAt(x, z, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const hh = hw <= 0.18 ? 0.98 : 1.82;
  if (aabbCollidesWorld(x, py, z, hw, hh)) return true;
  if (!hasMobGround(x, z, hw, py)) return true;
  return false;
}
function mobProbeFree(x, z, dirX, dirZ, maxDist, hw, y) {
  const py = y != null ? y : villageCenter.y + 1;
  const h = hw <= 0.18 ? 0.98 : 1.82;
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
        if (!onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
          let overHouse = false; for (const h of villageHouses) if (bx >= h.minX && bx <= h.maxX && bz >= h.minZ && bz <= h.maxZ) { overHouse = true; break; }
          if (overHouse) continue;
        }
        return true;
      } else if (gyIsWater) {
        if (!onRoof && villageHouses.length && gy >= villageCenter.y + 1 && gy <= villageCenter.y + 5) {
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
  const startInside = x >= villageMinX && x <= villageMaxX && z >= villageMinZ && z <= villageMaxZ;
  const steps = Math.ceil(maxDist / 0.28);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps * maxDist;
    const px = x + dirX * t, pz = z + dirZ * t;
    if (wolfBlockedAt(px, pz, hw, py)) return (s - 1) / steps * maxDist;
    if (startInside && (px < villageMinX + 0.7 || px > villageMaxX - 0.7 || pz < villageMinZ + 0.7 || pz > villageMaxZ - 0.7)) return (s - 1) / steps * maxDist;
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
      if (nx < villageMinX + 1 || nx > villageMaxX - 1 || nz < villageMinZ + 1 || nz > villageMaxZ - 1) continue;
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
function wanderGoalForWolf(m) {
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 30; t++) {
    const x = villageMinX + 2 + Math.random() * (villageMaxX - villageMinX - 4);
    const z = villageMinZ + 2 + Math.random() * (villageMaxZ - villageMinZ - 4);
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (isInsidePenPool(x, z)) continue;
    if (x < villageMinX + 1 || x > villageMaxX - 1 || z < villageMinZ + 1 || z > villageMaxZ - 1) continue;
    if (wolfBlockedAt(x, z, m.hw, villageCenter.y + 1)) continue;
    if (aabbCollidesWorld(x, villageCenter.y + 1, z, m.hw, m.h)) continue;
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
    const score = v * 10 - dCur * 0.15 + mobPenalty;
    if (score < bestScore) { bestScore = score; best = { x, z }; }
  }
  if (best) { m.lastTarget = { x: best.x, z: best.z }; return best; }
  for (let t = 0; t < 30; t++) {
    const x = villageMinX + 2 + Math.random() * (villageMaxX - villageMinX - 4);
    const z = villageMinZ + 2 + Math.random() * (villageMaxZ - villageMinZ - 4);
    if (isInsideAnyHouse(x, z)) continue;
    if (isInsidePool(x, z)) continue;
    if (isInsidePenPool(x, z)) continue;
    if (wolfBlockedAt(x, z, 0.30, villageCenter.y + 1)) continue;
    return { x, z };
  }
  return { x: villageCenter.x, z: villageCenter.z };
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
function mobCollidesOther(mob, nx, nz) {
  if (mob === carryMob) return null;
  if (mob.dim !== undefined && mob.dim !== dim) return null;
  const hw = villagerHW(mob);
  const y = mob.pos.y;
  const nearby = nearbyMobsFor(nx, nz, 1);
  const fleeing = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
  for (const o of nearby) {
    if (o === mob || o === carryMob || o === carryGrappleMob) continue;
    if (o.kind === "dragon" || o.kind === "enderman") continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    let need = hw + villagerHW(o) + 0.04;
    if (!fleeing) {
      const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
      if (!oflee && ((mob.isBaby && o.id === mob.parentId) || (o.isBaby && o.parentId === mob.id))) {
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
  const overCount = () => mobs.filter((m) => m.dim === "over" || m.dim === undefined).length;
  if (villagerCount() >= villagerTarget && (!villagePen || livestockCount() >= livestockTarget) && wolfCount() >= WOLF_COUNT) return;
  if (!villageHouses.length) computeVillageLayout();
  if (!villagerGeo) villagerGeo = new THREE.BoxGeometry(1, 1, 1);
  else if (villagerGeo.attributes.position.getY(0) > -0.4) { villagerGeo.dispose(); villagerGeo = new THREE.BoxGeometry(1, 1, 1); }
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
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
      if (usedBlocks.has(blockKey)) {
        // fallback to random village point centered
        let alt = wanderGoalFor({ pos: new THREE.Vector3(sx, villageCenter.y+1, sz), hw, h: hh, lastTarget: null });
        if (alt) { sx = Math.floor(alt.x)+0.5; sz = Math.floor(alt.z)+0.5; }
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
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
  for (const m of mobs) if (m.isBaby) {
    const sibs = mobs.filter((o) => o.homeId === m.homeId && !o.isBaby);
    if (sibs.length) m.parentId = sibs[Math.floor(Math.random() * sibs.length)].id;
  }
  for (const m of mobs) {
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
      if (usedBlocks.has(blockKey)) {
        const alt = randomPenPoint();
        sx = Math.floor(alt.x) + 0.5; sz = Math.floor(alt.z) + 0.5;
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
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
  // — 5 wolves (player-like step+swim, no jump) —
  {
    const curWolf = mobs.filter((m) => m.kind === "wolf" && (m.dim === "over" || m.dim === undefined)).length;
    const needWolf = Math.max(0, WOLF_COUNT - curWolf);
    const existingFurs = new Set(mobs.filter((m) => m.kind === "wolf").map((m) => m.mesh?.userData?.furHex));
    for (let i = 0; i < needWolf; i++) {
      const fur = WOLF_FUR;
      existingFurs.add(fur);
      const collar = WOLF_COLLAR_COLORS[Math.floor(Math.random() * WOLF_COLLAR_COLORS.length)];
      const mesh = makeWolfMesh(fur, collar);
      const hw = 0.30, hh = 0.90;
      let sx, sz, tries = 0;
      do {
        const ang = Math.random() * Math.PI * 2, rad = Math.random() * (VILLAGE_RADIUS - 6) + 2;
        sx = villageCenter.x + Math.cos(ang) * rad;
        sz = villageCenter.z + Math.sin(ang) * rad;
        sx = Math.max(villageMinX + 1.5, Math.min(villageMaxX - 1.5, sx));
        sz = Math.max(villageMinZ + 1.5, Math.min(villageMaxZ - 1.5, sz));
        sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
        const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
        if (usedBlocks.has(blockKey)) { tries++; continue; }
        if (isInsideAnyHouse(sx, sz) || isInsidePool(sx, sz) || isInsidePenPool(sx, sz) || wolfBlockedAt(sx, sz, hw, villageCenter.y + 1) || aabbCollidesWorld(sx, villageCenter.y + 1, sz, hw, hh)) { tries++; continue; }
        if (isInsidePen(sx, sz)) { tries++; continue; }
        if (used.some((u) => (u[0] - sx) ** 2 + (u[1] - sz) ** 2 < 1.4)) { tries++; continue; }
        break;
      } while (tries < 40);
      sx = Math.floor(sx) + 0.5; sz = Math.floor(sz) + 0.5;
      const blockKey = `${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`;
      if (usedBlocks.has(blockKey)) {
        const alt = wanderGoalForWolf({ pos: new THREE.Vector3(sx, villageCenter.y+1, sz), hw, h: hh, lastTarget: null });
        if (alt) { sx = Math.floor(alt.x)+0.5; sz = Math.floor(alt.z)+0.5; }
      }
      used.push([sx, sz]);
      usedBlocks.add(`${Math.floor(sx)},${villageCenter.y + 1},${Math.floor(sz)}`);
      mesh.position.set(sx, villageCenter.y + 1, sz);
      const yaw = Math.random() * Math.PI * 2;
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const m = {
        id: gid++, kind: "wolf", canStep: true, fur, collar, homeId: -1, isBaby: false, parentId: -1, dim: "over",
        pos: new THREE.Vector3(sx, villageCenter.y + 1, sz),
        vel: new THREE.Vector3(0, 0, 0),
        hw, h: hh, mesh, onGround: false,
        target: null, mode: "wander", wanderT: 3 + Math.random() * 4, insideT: 0,
        legPhase: Math.random() * Math.PI * 2, speed: WALK / 2,
        blockedT: 0, yaw, yawTarget: yaw, villageBound: true,
        _stuckT: 0, _prevX: sx, _prevZ: sz,
        path: null, pathIdx: 0, pathKey: null, sc: 1, steerX: 0, steerZ: 0, steerCooldown: 0, lastTarget: null,
        wolfStepUp: false, wolfStepUpClearY: 0, wolfInWater: false, wasOnGroundWolf: false, _wasInWater: false
      };
      m.target = wanderGoalForWolf(m);
      mobs.push(m);
      mobById.set(m.id, m);
    }
  }
}
function removeVillagers() {
  const keepCarry = carryMob && mobs.includes(carryMob) ? carryMob : null;
  const survivors = [];
  for (const m of mobs) {
    if (m === keepCarry) { survivors.push(m); continue; }
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
}
let overworldMobCache = null;
let pendingOverworldMobs = null;
const MOB_SAVE_BYTES = 19;
function mobKindCode(m) {
  if (m.kind === "pig") return 1;
  if (m.kind === "cow") return 2;
  if (m.kind === "wolf") return 3;
  if (m.kind === "pigeon") return 4;
  if (m.kind === "enderman") return 5;
  return 0;
}
function mobKindFromCode(c) {
  if (c === 1) return "pig";
  if (c === 2) return "cow";
  if (c === 3) return "wolf";
  if (c === 4) return "pigeon";
  if (c === 5) return "enderman";
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
  return 0;
}
function encodeMobYaw(yaw) {
  const t = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(t / (Math.PI * 2) * 255) & 255;
}
function decodeMobYaw(b) {
  return (b / 255) * Math.PI * 2;
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
  return list.map((m) => ({
    kind: mobKindCode(m),
    isBaby: !!m.isBaby,
    homeId: m.homeId != null ? m.homeId : -1,
    parentIdx: m.parentId != null ? (idxById.get(m.parentId) != null ? idxById.get(m.parentId) : -1) : -1,
    x: m.pos.x, y: m.pos.y, z: m.pos.z,
    yaw: m.yaw != null ? m.yaw : 0,
    look: mobLookIndex(m),
    villageBound: m.villageBound !== false,
    penBound: !!m.penBound,
  }));
}
function settleMobSpot(sx, sy, sz, hw, h, isWolf) {
  const cx = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, sx));
  const cz = Math.max(-WORLD_RADIUS + 2, Math.min(WORLD_RADIUS - 2, sz));
  const cy = Math.max(1, Math.min(MAX_Y - 2, sy));
  const blockedAt = (x, y, z) => isWolf ? wolfBlockedAt(x, z, hw, y) : mobBlockedAt(x, z, hw, y);
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
function restoreOverworldMobs(list, opts) {
  const keepCarried = !opts || opts.keepCarried !== false;
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
  let gid = mobs.length ? Math.max(...mobs.map((m) => m.id)) + 1 : 0;
  const usedXZ = mobs.map((m) => [m.pos.x, m.pos.z]);
  const idByListIdx = new Array(list.length).fill(null);
  const created = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const kind = mobKindFromCode(e.kind);
    const isBaby = !!e.isBaby && kind === "villager";
    const hw = kind === "pigeon" ? 0.25 : kind === "wolf" ? 0.30 : (kind === "pig" || kind === "cow") ? 0.32 : kind === "enderman" ? ENDERMAN_HW : (isBaby ? 0.16 : 0.27);
    const hh = kind === "pigeon" ? 0.5 : kind === "wolf" ? 0.90 : kind === "pig" ? 0.92 : kind === "cow" ? 1.30 : kind === "enderman" ? ENDERMAN_H : (isBaby ? 0.98 : 1.82);
    const isWolf = kind === "wolf";
    let sx = e.x, sy = e.y, sz = e.z;
    if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz)) continue;
    let spot = null;
    if (kind === "pigeon") {
      sx = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sx));
      sz = Math.max(-WORLD_RADIUS + 1, Math.min(WORLD_RADIUS - 1, sz));
      sy = Math.max(1, Math.min(MAX_Y - 2, isFinite(sy) ? sy : PIGEON_MIN_Y + 20));
      if (aabbCollidesWorld(sx, sy, sz, hw, hh)) {
        const alt = pigeonSpotOutOfView();
        sx = alt.x; sy = alt.y; sz = alt.z;
      }
      spot = { x: sx, y: sy, z: sz };
    } else {
    if (usedXZ.some((u) => (u[0] - sx) * (u[0] - sx) + (u[1] - sz) * (u[1] - sz) < 1.4)) {
      const fixed = settleMobSpot(sx + 1.5, sy, sz + 1.5, hw, hh, isWolf);
      sx = fixed.x; sy = fixed.y; sz = fixed.z;
    }
    spot = settleMobSpot(sx, sy, sz, hw, hh, isWolf);
    }
    let homeId = e.homeId;
    if (kind === "villager" && (homeId == null || homeId < 0 || homeId >= villageHouses.length)) homeId = villageHouses.length ? 0 : -1;
    if (kind !== "villager") homeId = -1;
    const ryaw = isFinite(e.yaw) ? e.yaw : 0;
    let mesh = null;
    let palIdx = 0, collar = WOLF_COLLAR_COLORS[0];
    let endermanVis = null;
    if (kind === "villager") {
      palIdx = (e.look >= 0 && e.look < VILLAGER_PALETTES.length) ? e.look : 0;
      mesh = makeVillagerMesh(isBaby, palIdx);
    } else if (kind === "pig") mesh = makePigMesh();
    else if (kind === "cow") mesh = makeCowMesh();
    else if (kind === "pigeon") mesh = makePigeonMesh();
    else if (kind === "enderman") {
      ensureEndermanAssets();
      endermanVis = makeEndermanMesh();
      mesh = endermanVis.g;
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
      target: null, mode: "wander", wanderT: 3 + Math.random() * 4, insideT: 0,
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
    } else if (kind === "pigeon") {
      base.canStep = false;
      base.speed = PIGEON_SPEED;
      base.villageBound = false;
      base.sc = 1;
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
      base.vel.set(Math.cos(yaw2) * PIGEON_SPEED, 0, Math.sin(yaw2) * PIGEON_SPEED);
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
    if (e.penBound != null) base.penBound = !!e.penBound;
    mobs.push(base);
    mobById.set(base.id, base);
    idByListIdx[i] = base.id;
    created.push(base);
    usedXZ.push([spot.x, spot.z]);
  }
  list.forEach((e, i) => {
    const nid = idByListIdx[i];
    if (nid == null) return;
    const cm = mobById.get(nid);
    if (!cm || e.parentIdx == null || e.parentIdx < 0 || e.parentIdx >= list.length) return;
    if (cm.kind !== "villager" || !cm.isBaby) return;
    const pid = idByListIdx[e.parentIdx];
    if (pid == null) return;
    cm.parentId = pid;
  });
  for (const m of created) {
    if (m.kind === "pigeon") {
      m.target = pigeonRandomTarget(m.pos);
    } else {
      m.target = { x: m.pos.x, z: m.pos.z };
    }
    m.wanderT = 3 + Math.random() * 4;
  }
  buildMobGrid();
  spawnVillagers();
  spawnPigeons();
  return created.length;
}
function intersectsMob(bx, by, bz) {
  const nearby = nearbyMobsFor(bx + 0.5, bz + 0.5, 1);
  for (const m of nearby) {
    if (m === carryMob || m === carryGrappleMob) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    const hw = villagerHW(m) + 0.05, hh = villagerH(m);
    const mx = m.pos.x, my = m.pos.y, mz = m.pos.z;
    if (bx + 1 > mx - hw && bx < mx + hw && by + 1 > my && by < my + hh && bz + 1 > mz - hw && bz < mz + hw) return true;
  }
  return false;
}
function isMobStandingOn(bx, by, bz) {
  const nearby = nearbyMobsFor(bx + 0.5, bz + 0.5, 1);
  for (const m of nearby) {
    if (m === carryMob || m === carryGrappleMob) continue;
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
      if (m === carryMob) continue;
      if (m.kind === "pigeon" || m.kind === "dragon" || m.kind === "enderman") continue;
      if (isMobFrozenByGrapple(m)) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      let sx = 0, sz = 0, cnt = 0;
      const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 1);
      const fleeingSelf = m.fleeUntil && performance.now() / 1000 < m.fleeUntil;
      for (const o of nearby) {
        if (o === m || o === carryMob) continue;
        if (o.kind === "pigeon" || o.kind === "dragon" || o.kind === "enderman") continue;
        if (isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(m) + villagerHW(o) + 0.18;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && ((m.isBaby && o.id === m.parentId) || (o.isBaby && o.parentId === m.id))) {
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
  const y = villageCenter.y + 1;
  if (Math.abs(pos.y - y) > 1.8) return;
  const nearby = nearbyMobsFor(pos.x, pos.z, 2);
  for (const m of nearby) {
    if (m === carryMob) continue;
    if (m.kind === "dragon" || m.kind === "enderman") continue;
    if (isMobFrozenByGrapple(m)) continue;
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
  if (mob === carryMob) return false;
  const hw = villagerHW(mob);
  const y = mob.pos.y;
  const nearby = nearbyMobsFor(nx, nz, 1);
  const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
  for (const o of nearby) {
    if (o === mob || o === carryMob || isMobFrozenByGrapple(o)) continue;
    if (o.kind === "dragon" || o.kind === "enderman") continue;
    if (o.dim !== undefined && o.dim !== dim) continue;
    let need = hw + villagerHW(o) + 0.04;
    if (!fleeingSelf) {
      const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
      if (!oflee && ((mob.isBaby && o.id === mob.parentId) || (o.isBaby && o.parentId === mob.id))) {
        need = (hw + villagerHW(o)) * 0.62 + 0.06;
      }
    }
    if (Math.abs(y - o.pos.y) > 1.2) continue;
    const dx = nx - o.pos.x, dz = nz - o.pos.z;
    if (dx * dx + dz * dz < need * need) return true;
  }
  return false;
}
function updateMobs(dt) {
  if (!mobs.length) return;
  const over = dim === "over" && villageHouses.length;
  if (over) {
    mobTick++;
    buildMobGrid();
    separateMobs();
    pushMobsFromPlayer();
  } else {
    buildMobGrid();
  }
  if (mobStats) mobStats.frames++;
  const g = GRAVITY;
  for (let idx = mobs.length - 1; idx >= 0; idx--) {
    const m = mobs[idx];
    if (m.kind === "enderman" && (m === carryMob || isMobFrozenByGrapple(m))) { updateEnderman(m, dt); continue; }
    if (m === carryMob) continue;
    if (isMobFrozenByGrapple(m)) continue;
    if (m.dim !== undefined && m.dim !== dim) {
      if (m.kind === "pigeon" || m.kind === "enderman") { m.mesh.position.copy(m.pos); continue; }
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
    if (m.kind === "pigeon") {
      if (dim !== "over") { m.mesh.position.copy(m.pos); continue; }
      updatePigeon(m, dt);
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
    addVisit(m.pos.x, m.pos.z);
    if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) { mobInvariantsViolated++; if (mobStats) mobStats.invariants++; }
    // Step-capable mobs (wolves) — instant step, no block feeling (converge to pen when panicking, or flee away outside)
    if (m.canStep) {
      if (m.fleeUntil != null && now < m.fleeUntil) {
        if (m._outsideFlee) {
          m.speed = WALK * 2;
          m.wanderT -= dt;
          if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.7 || m.wanderT <= 0) {
            m.target = fleePointAway(m, m._fleeSrcX, m._fleeSrcZ);
            m.wanderT = 1.2 + Math.random() * 0.8;
            m.steerCooldown = 0; m.path = null; m.pathKey = null;
          }
        } else {
          m.speed = WALK * 2;
          m.wanderT -= dt;
          if (!m.target || Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6 || m.wanderT <= 0) {
            if (villagePen) {
              const jitter = () => (Math.random() - 0.5) * 2;
              m.target = { x: villagePen.cx + 0.5 + jitter(), z: villagePen.cz + 0.5 + jitter() };
            } else m.target = wanderGoalForWolf(m);
            m.wanderT = 2 + Math.random() * 2;
            m.steerCooldown = 0; m.path = null; m.pathKey = null;
          }
        }
      } else {
        if (m._outsideFlee) { delete m._outsideFlee; delete m._fleeSrcX; delete m._fleeSrcZ; m.fleeUntil = 0; m.speed = WALK / 2; }
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
      const insidePen = isInsidePen(m.pos.x, m.pos.z);
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
              m.target = wantsPen ? wanderGoalForPen(m) : wanderGoalFor(m);
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
      // wander / follow — outside village babies behave like adults
      if (m.isBaby && m.villageBound !== false && now >= (m.fleeUntil || 0)) {
        const p = mobById.get(m.parentId);
        if (p) {
          const pd = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
          const pInside = (()=>{ const h=villageHouses[p.homeId]; return p.pos.x>h.minX&&p.pos.x<h.maxX&&p.pos.z>h.minZ&&p.pos.z<h.maxZ; })();
          const meInside = (()=>{ const h=villageHouses[m.homeId]; return m.pos.x>h.minX&&m.pos.x<h.maxX&&m.pos.z>h.minZ&&m.pos.z<h.maxZ; })();
          if (pInside !== meInside) {
            const house = pInside ? villageHouses[p.homeId] : villageHouses[m.homeId];
            m.mode = pInside ? "goHome" : "goOut";
            m.target = pInside ? { x: house.padX, z: house.padZ } : { x: house.apronX, z: house.apronZ };
          } else if (pd > 3.0) {
            m.target = { x: p.pos.x, z: p.pos.z };
          } else if (pd < 1.2 && m.target && Math.hypot(m.target.x - p.pos.x, m.target.z - p.pos.z) < 1) {
            // stay near parent
          } else if (m.wanderT <= 0) {
            m.target = { x: p.pos.x + (Math.random()-0.5)*2, z: p.pos.z + (Math.random()-0.5)*2 };
          }
        }
      }
      m.wanderT -= dt;
      if (m.wanderT <= 0 && m.mode === "wander" && (m.villageBound === false || !m.isBaby)) {
        if (m.villageBound === false) {
          // outside village: wander near current pos
          let near = null;
          for (let t = 0; t < 8; t++) {
            const ax = m.pos.x + (Math.random() - 0.5) * 10;
            const az = m.pos.z + (Math.random() - 0.5) * 10;
            if (aabbCollidesWorld(ax, m.pos.y, az, m.hw, m.h)) continue;
            if (!hasMobGround(ax, az, m.hw, m.pos.y)) continue;
            near = { x: ax, z: az };
            break;
          }
          m.target = near || { x: m.pos.x + (Math.random() - 0.5) * 4, z: m.pos.z + (Math.random() - 0.5) * 4 };
          m.wanderT = 3 + Math.random() * 4;
        } else if (Math.random() < 0.25) {
          m.mode = "goHome";
          m.target = { x: villageHouses[m.homeId].apronX, z: villageHouses[m.homeId].apronZ };
        } else {
          m.target = wanderGoalFor(m);
          m.wanderT = 3 + Math.random() * 4;
        }
      }
      if (m.target && Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) < 0.6) {
        if (m.mode === "wander") {
          if (m.villageBound === false) {
            let near = null;
            for (let t = 0; t < 8; t++) {
              const ax = m.pos.x + (Math.random() - 0.5) * 10;
              const az = m.pos.z + (Math.random() - 0.5) * 10;
              if (aabbCollidesWorld(ax, m.pos.y, az, m.hw, m.h)) continue;
              if (!hasMobGround(ax, az, m.hw, m.pos.y)) continue;
              near = { x: ax, z: az };
              break;
            }
            m.target = near || wanderGoalFor(m);
          } else {
            m.target = wanderGoalFor(m);
          }
          m.wanderT = 3 + Math.random() * 3;
        }
      }
    }
    // TNT panic override — fleeing takes precedence over mode dispatch
    // Hardcoded: fleeing villagers hard-converge to the CENTRE of their house
    if ((!m.kind || m.kind === "villager") && m.fleeUntil != null && now < m.fleeUntil) {
      m.speed = WALK * 2;
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
    } else if ((!m.kind || m.kind === "villager") && m.fleeUntil) { m.fleeUntil = 0; m.speed = WALK / 2; }

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
    const findPath = canStep ? wolfFindPath : findVillagePath;
    const goalFor = canStep ? wanderGoalForWolf : wanderGoalFor;
    let poolEx = null;
    if (villagePool && isInsidePool(m.pos.x, m.pos.z) && mobInWater(m)) {
      poolEx = poolExitTarget(m.pos.x, m.pos.z);
      if (poolEx) { m.path = null; m.pathKey = null; }
    }
    if (!poolEx && villagePen && villagePen.pool && isInsidePenPool(m.pos.x, m.pos.z) && mobInWater(m)) {
      poolEx = penPoolExitTarget(m.pos.x, m.pos.z);
      if (poolEx) { m.path = null; m.pathKey = null; }
    }
    let tx = poolEx ? poolEx.x : (m.target ? m.target.x : m.pos.x);
    let tz = poolEx ? poolEx.z : (m.target ? m.target.z : m.pos.z);
    let hasPath = false;
    const toTarOverall = Math.hypot(tx - m.pos.x, tz - m.pos.z);
    const insideNow = (()=>{ if (m.kind === "pig" || m.kind === "cow") return isInsidePen(m.pos.x, m.pos.z); if (canStep) return false; const h=villageHouses[m.homeId]; return h && m.pos.x>h.minX&&m.pos.x<h.maxX&&m.pos.z>h.minZ&&m.pos.z<h.maxZ; })();
    const needPath = poolEx ? false : (!insideNow && m.mode !== "inside" && (toTarOverall > 1.8 || probeFree(m.pos.x, m.pos.z, (tx - m.pos.x)/(toTarOverall||1), (tz - m.pos.z)/(toTarOverall||1), Math.min(1.2, toTarOverall), m.hw, m.pos.y) < 0.55));
    if (needPath) {
      const pk = Math.round(tx) + "," + Math.round(tz);
      if (!m.path || m.pathKey !== pk) {
        const p = findPath(m.pos.x, m.pos.z, tx, tz, m.hw, m.pos.y);
        if (p && p.length > 1) { m.path = p; m.pathIdx = 1; m.pathKey = pk; hasPath = true; tx = p[1][0]; tz = p[1][1]; }
        else { m.path = null; m.pathKey = null; }
      } else if (m.path && m.pathIdx < m.path.length) {
        hasPath = true;
        tx = m.path[m.pathIdx][0]; tz = m.path[m.pathIdx][1];
        if (Math.hypot(m.pos.x - tx, m.pos.z - tz) < 0.45) {
          m.pathIdx++; if (m.pathIdx < m.path.length) { tx = m.path[m.pathIdx][0]; tz = m.path[m.pathIdx][1]; }
          else { m.path = null; m.pathKey = null; hasPath = false; }
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
      } else if (!hasPath) {
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
      } else {
        m.steerX = wantX; m.steerZ = wantZ; m.steerCooldown = 0.2;
      }
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
    {
      let repX = 0, repZ = 0, cnt = 0;
      const nearby = nearbyMobsFor(m.pos.x, m.pos.z, 2);
      for (const o of nearby) {
        if (o === m || o === carryMob || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(m) + villagerHW(o) + 0.50;
        const fleeingSelf = m.fleeUntil && performance.now() / 1000 < m.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && ((m.isBaby && o.id === m.parentId) || (o.isBaby && o.parentId === m.id))) need = (villagerHW(m) + villagerHW(o)) * 0.62 + 0.22;
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
      if (cnt) {
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
    // lerp vel towards want (like player)
    m.vel.x += (wantX - m.vel.x) * Math.min(1, dt * 6);
    m.vel.z += (wantZ - m.vel.z) * Math.min(1, dt * 6);
    if (dist < 0.1) { m.vel.x *= 0.85; m.vel.z *= 0.85; }
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
    if(isPigCow(m) && villagePen && pigOverlapsFence(m.pos.x, m.pos.z, m.hw)){
      const pen=villagePen;
      m.pos.x = pen.cx+0.5;
      m.pos.z = pen.cz+0.5;
      m.pos.y = pen.vy+1;
      m.vel.x=0; m.vel.z=0; m.vel.y=0;
      m.onGround=true;
    }
    // mob-mob / player already in separate/push, but also check immediate collision after move
    // stuck detection — 1-block corner: never stay stuck
    const moved = Math.hypot(m.pos.x - prevX, m.pos.z - prevZ);
    const wantMove = Math.hypot(wantX, wantZ) * dt;
    if (wantMove > 0.05 && moved < wantMove * 0.20) m._stuckT += dt; else m._stuckT = Math.max(0, m._stuckT - dt * 2);
    if (m._stuckT > 0.55) {
      if (m.mode === "inside") {
        m.target = randomInsidePoint(m.homeId);
      } else if ((m.kind === "pig" || m.kind === "cow") && isInsidePen(m.pos.x, m.pos.z)) {
        m.target = wanderGoalForPen(m);
        m.path = null; m.pathKey = null;
        const ang = Math.random() * Math.PI * 2;
        m.vel.x = Math.cos(ang) * (WALK / 2) * 0.6; m.vel.z = Math.sin(ang) * (WALK / 2) * 0.6;
        m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.6;
      } else if (m.canStep && m.kind === "wolf") {
        m.target = wanderGoalForWolf(m);
        m.path = null; m.pathKey = null;
        const ang = Math.random() * Math.PI * 2;
        m.vel.x = Math.cos(ang) * (WALK / 2) * 0.6; m.vel.z = Math.sin(ang) * (WALK / 2) * 0.6;
        m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.6;
      } else {
        let bestF = -1, bx = 0, bz = 0;
        for (let a = 0; a < 360; a += 45) {
          const rad = a * Math.PI / 180;
          const cx = Math.cos(rad), cz = Math.sin(rad);
          const free = probeFree(m.pos.x, m.pos.z, cx, cz, 2.2, m.hw, m.pos.y);
          // penalize directions crowded with mobs
          let mobFactor = 0;
          const testX = m.pos.x + cx * 1.1, testZ = m.pos.z + cz * 1.1;
          for (const o of mobs) {
            if (o === m || (o.dim !== undefined && o.dim !== dim)) continue;
            const d2 = (testX - o.pos.x) * (testX - o.pos.x) + (testZ - o.pos.z) * (testZ - o.pos.z);
            if (d2 < 1.2 * 1.2) mobFactor += 0.5;
          }
          const eff = free - mobFactor * 0.6;
          if (eff > bestF) { bestF = eff; bx = cx; bz = cz; }
          else if (free > bestF) { bestF = free; bx = cx; bz = cz; }
        }
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
          const ang = Math.random()*Math.PI*2;
          m.vel.x = Math.cos(ang)*(WALK/2)*0.5; m.vel.z = Math.sin(ang)*(WALK/2)*0.5;
          m.steerX = m.vel.x; m.steerZ = m.vel.z; m.steerCooldown = 0.5;
        }
      }
      m.wanderT = 2 + Math.random() * 2;
      m._stuckT = 0;
      if (mobStats) mobStats.stuck++;
    } else if (wantMove > 0.05 && moved < 0.02 && probeFree(m.pos.x, m.pos.z, wantX/(m.speed||1), wantZ/(m.speed||1), 0.5, m.hw, m.pos.y) < 0.15) {
      let bestF = -1, bx = 0, bz = 0;
      for (let a = 0; a < 360; a += 45) {
        const rad = a * Math.PI / 180;
        const cx = Math.cos(rad), cz = Math.sin(rad);
        const free = probeFree(m.pos.x, m.pos.z, cx, cz, 1.4, m.hw, m.pos.y);
        if (free > bestF) { bestF = free; bx = cx; bz = cz; }
      }
      if (bestF > 0.35) {
        m.vel.x = bx * (WALK/2) * 0.5; m.vel.z = bz * (WALK/2) * 0.5;
        m.mesh.rotation.y = Math.atan2(bx, bz);
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
    // leg anim
    const moving = Math.hypot(m.vel.x, m.vel.z) > 0.15 && m.onGround;
    if (moving) m.legPhase += dt * 9;
    else m.legPhase += dt * 2;
    if (m.mesh.userData.legL) {
      m.mesh.userData.legL.rotation.x = Math.sin(m.legPhase) * 0.55;
      m.mesh.userData.legR.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.55;
    }
    if (m.mesh.userData.legBL) {
      m.mesh.userData.legBL.rotation.x = Math.sin(m.legPhase) * 0.65;
      m.mesh.userData.legBR.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.65;
      m.mesh.userData.legFL.rotation.x = Math.sin(m.legPhase + Math.PI) * 0.65;
      m.mesh.userData.legFR.rotation.x = Math.sin(m.legPhase) * 0.65;
    }
    // ensure not embedded
    if (aabbCollidesWorld(m.pos.x, m.pos.y, m.pos.z, m.hw, m.h)) {
      // nudge out: try small random
      for (let k=0;k<4;k++){ const nx=m.pos.x + (Math.random()-0.5)*0.6, nz=m.pos.z + (Math.random()-0.5)*0.6; if(!aabbCollidesWorld(nx,m.pos.y,nz,m.hw,m.h)){ m.pos.x=nx; m.pos.z=nz; break; } }
    }
  }
  if (over) { buildMobGrid(); separateMobs(); }
}
function panicVillagers(cx, cy, cz) {
  if (!villageHouses.length || !mobs.length) return;
  if (dim === "over" && ((cx - villageCenter.x) ** 2 + (cz - villageCenter.z) ** 2 > (VILLAGE_RADIUS + 15) ** 2)) return;
  if (Math.abs(cy - villageCenter.y) > CLOUD_BASE / 2) return;
  const now = performance.now() / 1000;
  for (const m of mobs) {
    if (m === carryMob || m === carryGrappleMob) continue;
    if (m.dim !== undefined && m.dim !== dim) continue;
    if (m.homeId < 0) continue;
    const stagger = Math.random() * 3;
    m.fleeUntil = Math.max(m.fleeUntil || 0, now + 10 + stagger);
    const house = villageHouses[m.homeId];
    const centre = { x: house.cx + 0.5, z: house.cz + 0.5 };
    const inHome = m.pos.x > house.minX && m.pos.x < house.maxX && m.pos.z > house.minZ && m.pos.z < house.maxZ;
    if (inHome) {
      m.insideT = Math.max(m.insideT, 10 + stagger);
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
  if (!villagePen || !mobs.length) return;
  if (Math.abs(cy - villageCenter.y) > CLOUD_BASE / 2) return;
  const now = performance.now() / 1000;
  const insideVillage = dim !== "over" || ((cx - villageCenter.x) ** 2 + (cz - villageCenter.z) ** 2 <= (VILLAGE_RADIUS + 15) ** 2);
  if (insideVillage) {
    for (const m of mobs) {
      if (m === carryMob || m === carryGrappleMob) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "pig" && m.kind !== "cow") continue;
      const stagger = Math.random() * 3;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + 10 + stagger);
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
      if (m === carryMob || m === carryGrappleMob) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "pig" && m.kind !== "cow") continue;
      const dx = m.pos.x - cx, dz = m.pos.z - cz;
      if (dx * dx + dz * dz > 20 * 20) continue;
      if (Math.abs(m.pos.y - cy) > 12) continue;
      const stagger = Math.random() * 1;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + 5 + stagger);
      m.speed = WALK * 2;
      m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = fleePointAway(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
    }
  }
}
function panicWolves(cx, cy, cz) {
  if (!mobs.length) return;
  if (Math.abs(cy - villageCenter.y) > CLOUD_BASE / 2) return;
  const now = performance.now() / 1000;
  const insideVillage = dim !== "over" || ((cx - villageCenter.x) ** 2 + (cz - villageCenter.z) ** 2 <= (VILLAGE_RADIUS + 15) ** 2);
  if (insideVillage) {
    for (const m of mobs) {
      if (m === carryMob || m === carryGrappleMob) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "wolf") continue;
      const stagger = Math.random() * 3;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + 10 + stagger);
      m.speed = WALK * 2;
      delete m._outsideFlee; delete m._fleeSrcX; delete m._fleeSrcZ;
      if (villagePen) {
        const gaps = findPenGaps();
        let tx, tz;
        if (gaps.length) {
          const gap = nearestPenGap(m.pos.x, m.pos.z);
          if (gap) {
            const inside = penGapInside(gap);
            tx = inside.x + (Math.random() - 0.5) * 0.8;
            tz = inside.z + (Math.random() - 0.5) * 0.8;
          } else {
            const p = randomPenPoint();
            tx = p.x; tz = p.z;
          }
        } else {
          const p = randomPenPoint();
          tx = p.x + (Math.random() - 0.5) * 1.2;
          tz = p.z + (Math.random() - 0.5) * 1.2;
        }
        m.target = { x: tx, z: tz };
      } else {
        m.target = wanderGoalForWolf(m);
      }
      m.wanderT = 1 + Math.random() * 1;
      m.steerCooldown = 0; m.path = null; m.pathKey = null;
    }
  } else {
    for (const m of mobs) {
      if (m === carryMob || m === carryGrappleMob) continue;
      if (m.dim !== undefined && m.dim !== dim) continue;
      if (m.kind !== "wolf") continue;
      const dx = m.pos.x - cx, dz = m.pos.z - cz;
      if (dx * dx + dz * dz > 20 * 20) continue;
      if (Math.abs(m.pos.y - cy) > 12) continue;
      const stagger = Math.random() * 1;
      m.fleeUntil = Math.max(m.fleeUntil || 0, now + 5 + stagger);
      m.speed = WALK * 2;
      m._outsideFlee = true; m._fleeSrcX = cx; m._fleeSrcZ = cz;
      m.target = fleePointAway(m, cx, cz);
      m.wanderT = 1.2 + Math.random() * 0.8; m.steerCooldown = 0; m.path = null; m.pathKey = null;
    }
  }
}
function handleMobExplosion(cx, cy, cz) {
  if (dim === "over") { panicVillagers(cx, cy, cz); panicPenMobs(cx, cy, cz); panicWolves(cx, cy, cz); }
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
      for (let y = END_PLATFORM_TOP - 2; y <= END_PLATFORM_TOP; y++) w.set(key(x, y, z), ENDSTONE);
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
const PIGEON_MAX_Y = SKY_SPACE_START;

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
  const ax = freeCam ? camPos.x : pos.x, ay = freeCam ? camPos.y : pos.y, az = freeCam ? camPos.z : pos.z;
  const nearMoon = dim === "over" && (() => {
    const dx = ax, dy = ay - MOON_Y, dz = az;
    return dx * dx + dy * dy + dz * dz < (MOON_R + 120) * (MOON_R + 120);
  })();
  if (nearMoon) {
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
const PIGEON_FOLLOW_DIST = 3.5;
const MOB_GRAPPLE_THROW = GRAPPLE_THROW * 1.25;
const MOB_GRAPPLE_RETRACT = MOB_GRAPPLE_THROW * 1.25;
const FLOAT_SPEED = 3.6;
const SWIM_ACCEL = 2.0;
const SWIM_AREA = 10;
const SWIM_BRAKE = 1.5;
const SWIM_MAX = 64;

const pos = new THREE.Vector3(0, 20, 0);
let grappleActive = false;
let grappleHooked = false;
let grappleFly = 0;
let grapplingDist = 1;
const grappleTarget = new THREE.Vector3();
const grappleStart = new THREE.Vector3();
let grappleBlock = null;
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
let flingActive = false;
const vel = new THREE.Vector3();
const camPos = new THREE.Vector3();
let yaw = 0, pitch = 0;
let onGround = false, flying = false, freeCam = false, locked = false;
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
  for (let y = MAX_Y; y > 0; y--) {
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
        if (o === mob || o === carryMob || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && ((mob.isBaby && o.id === mob.parentId) || (o.isBaby && o.parentId === mob.id))) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
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
        if (o === mob || o === carryMob || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && ((mob.isBaby && o.id === mob.parentId) || (o.isBaby && o.parentId === mob.id))) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
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
    const pen=villagePen;
    mob.pos.x = pen.cx+0.5;
    mob.pos.z = pen.cz+0.5;
    mob.pos.y = pen.vy+1;
    mob.vel.x=0; mob.vel.z=0; mob.vel.y=0;
    mob.onGround = true;
    if(mobStats) mobStats.worldCol++;
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
        if (o === mob || o === carryMob || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && ((mob.isBaby && o.id === mob.parentId) || (o.isBaby && o.parentId === mob.id))) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
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
        if (o === mob || o === carryMob || isMobFrozenByGrapple(o)) continue;
        if (o.dim !== undefined && o.dim !== dim) continue;
        let need = villagerHW(mob) + villagerHW(o) + 0.04;
        const fleeingSelf = mob.fleeUntil && performance.now() / 1000 < mob.fleeUntil;
        if (!fleeingSelf) {
          const oflee = o.fleeUntil && performance.now() / 1000 < o.fleeUntil;
          if (!oflee && ((mob.isBaby && o.id === mob.parentId) || (o.isBaby && o.parentId === mob.id))) need = (villagerHW(mob) + villagerHW(o)) * 0.62 + 0.06;
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
    if (m === carryMob) continue;
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
    if (m === carryMob) continue;
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
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const b = pickBlock(camera.position, dir, true);
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
  const mob = pickMob(dir, blockDist);
  if (mob) {
    const off = getMobHitOffset(eye, dir, mob);
    const mx = off ? mob.pos.x + off.x : mob.pos.x;
    const my = off ? mob.pos.y + off.y : mob.pos.y + mob.h + 0.001;
    const mz = off ? mob.pos.z + off.z : mob.pos.z;
    if (off) grappleMobOffset.copy(off);
    else grappleMobOffset.set(0, mob.h + 0.001, 0);
    const distMob = Math.hypot(mx - sx, my - sy, mz - sz);
    if (distMob < 0.3) return;
    if (!b || distMob < blockDist) {
      grappleMob = mob;
      grappleBlock = null;
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
      jumpCount = 1;
      jumpIdle = 0;
      stepDown = false;
      return;
    }
  }
  if (!b) return;
  if ((b.id === MOON || b.id === MOON_WATER) && eye.y < MOON_FADE_START) return;
  if (blockDist < 0.3) return;
  grappleMob = null;
  grappleBlock = b;
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
  jumpCount = 1;
  jumpIdle = 0;
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

function grappleVertBoost(y) {
  const lo = CLOUD_BASE, hi = CLOUD_BASE + CLOUD_SPAN * 0.5, e = 18;
  if (y < lo - e || y > hi + e) return 1;
  if (y < lo) return 1 + smoothstep((y - (lo - e)) / e);
  if (y > hi) return 1 + smoothstep((hi + e - y) / e);
  return 2;
}
function updateGrapple(dt) {
  if (grappleArrived) { grapplePulling = false; return false; }
  if (grappleMob) {
    if (!mobs.includes(grappleMob) || (grappleMob.dim !== undefined && grappleMob.dim !== dim)) {
      grappleActive = false;
      grappleMob = null;
      grappleRetracting = true;
      grappleHookPos.copy(grappleTarget);
      return false;
    }
    grappleTarget.set(grappleMob.pos.x + grappleMobOffset.x, grappleMob.pos.y + grappleMobOffset.y, grappleMob.pos.z + grappleMobOffset.z);
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
  if (grappleMob && (grappleMob.kind === "pigeon" || grappleMob.kind === "dragon") && grappleHooked) {
    const pm = grappleMob;
    const pdx = grappleTarget.x - pos.x, pdy = grappleTarget.y - pos.y, pdz = grappleTarget.z - pos.z;
    const followR = grappleTowInit ? PIGEON_FOLLOW_DIST + 2 : PIGEON_FOLLOW_DIST;
    if (Math.hypot(pdx, pdy, pdz) <= followR) {
      grappleHookPos.copy(grappleTarget);
      const pvl = pm.vel.length();
      if (pvl > 1e-3) {
        grappleTowTmp.set(pm.vel.x / pvl, pm.vel.y / pvl, pm.vel.z / pvl);
        grappleTowTmp.y = Math.max(-0.6, Math.min(0.6, grappleTowTmp.y));
        const tl = grappleTowTmp.length() || 1;
        grappleTowTmp.divideScalar(tl);
        if (!grappleTowInit) { grappleTowDir.copy(grappleTowTmp); grappleTowInit = true; }
        else { grappleTowDir.lerp(grappleTowTmp, Math.min(1, dt * 2.2)); if (grappleTowDir.lengthSq() < 1e-6) grappleTowDir.set(0, 0, 1); grappleTowDir.normalize(); }
      } else if (!grappleTowInit) { grappleTowDir.set(0, 0, 1); grappleTowInit = true; }
      const desX = pm.pos.x - grappleTowDir.x * 3, desY = pm.pos.y - grappleTowDir.y * 3 - 0.4, desZ = pm.pos.z - grappleTowDir.z * 3;
      if (grappleTowPos.lengthSq() < 1e-6) grappleTowPos.set(desX, desY, desZ);
      else grappleTowPos.lerp(grappleTowTmp.set(desX, desY, desZ), Math.min(1, dt * 6));
      const stiff = 18, damp = 11;
      const ex = grappleTowPos.x - pos.x, ey = grappleTowPos.y - pos.y, ez = grappleTowPos.z - pos.z;
      const exl = Math.hypot(ex, ey, ez) || 1;
      const ecl = Math.min(exl, 3);
      vel.x += ((ex / exl * ecl) * stiff - (vel.x - pm.vel.x) * damp) * dt;
      vel.y += ((ey / exl * ecl) * stiff - (vel.y - pm.vel.y) * damp) * dt;
      vel.z += ((ez / exl * ecl) * stiff - (vel.z - pm.vel.z) * damp) * dt;
      const spd = Math.hypot(vel.x, vel.y, vel.z);
      const maxSp = (pm.speed || PIGEON_SPEED) * 2.2;
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
  if (dim === "end") flying = false;
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
    const speed = (sprintKey && move.lengthSq() > 0) ? SPRINT : 4.2;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x += (move.x - vel.x) * Math.min(1, dt * 8);
    vel.z += (move.z - vel.z) * Math.min(1, dt * 8);
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
      } else {
        const surface = waterSurfaceTop();
        if (surface === -Infinity) {
          vel.y -= g * dt;
        } else {
          const targetY = surface - 1.17;
          const err = targetY - pos.y;
          if (err > SWIM_AREA) {
            vel.y += SWIM_ACCEL * dt;
          } else {
            const want = err * 4;
            vel.y += (want - vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
          }
        }
      vel.y = Math.min(Math.max(vel.y, -SWIM_MAX), SWIM_MAX);
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
  const outOfLevel =
    Math.abs(pos.x) > WORLD_RADIUS || Math.abs(pos.z) > WORLD_RADIUS ||
    pos.y < 0 || pos.y > MAX_Y;
  if (outOfLevel) spawnPlayer();
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
    if (x < -WORLD_RADIUS || x > WORLD_RADIUS || z < -WORLD_RADIUS || z > WORLD_RADIUS || y < 0 || y > MAX_Y) break;
    const id = getBlock(x, y, z);
    if (id !== AIR && !(skipLiquid && (id === WATER || id === LAVA || id === MOON_WATER))) return { x, y, z, id, face };
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
const GRAPPLE_CUBES = 2600;
const grappleCubes = new THREE.InstancedMesh(grappleCubeGeo, grappleCubeMat, GRAPPLE_CUBES);
grappleCubes.frustumCulled = false;
grappleCubes.visible = false;
scene.add(grappleCubes);
const grappleCubeMatrix = new THREE.Matrix4();
const grappleHead = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), new THREE.MeshBasicMaterial({ color: 0x4a3a1e }));
grappleHead.visible = false;
scene.add(grappleHead);
const carryGrappleCubeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const carryGrappleCubeMat = new THREE.MeshBasicMaterial({ color: 0x870000, transparent: true, opacity: 1 });
const CARRY_GRAPPLE_CUBES = 2600;
const carryGrappleCubes = new THREE.InstancedMesh(carryGrappleCubeGeo, carryGrappleCubeMat, CARRY_GRAPPLE_CUBES);
carryGrappleCubes.frustumCulled = false;
carryGrappleCubes.visible = false;
scene.add(carryGrappleCubes);
const carryGrappleHead = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), new THREE.MeshBasicMaterial({ color: 0x5a0000, transparent: true, opacity: 1 }));
carryGrappleHead.visible = false;
scene.add(carryGrappleHead);
const carryGrappleCubeMatrix = new THREE.Matrix4();

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
  const { x, y, z } = currentBlock;
  if (protectedBlocks.has(protKey(x, y, z))) return;
  if (getBlock(x, y, z) === STONE && y === 0) return;
  if (isMobStandingOn(x, y, z) || intersectsMob(x, y, z)) return;
  if (getBlock(x, y, z) === TNT) { igniteTNT(x, y, z); return; }
  const bid = getBlock(x, y, z);
  if (bid === WATER || bid === LAVA || bid === MOON_WATER) return;
  setBlock(x, y, z, AIR);
  if (placeBatch) placeBatch.push([x, y, z]);
  else { refreshBlocks([[x, y, z]]); queueSave(); }
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
  const liquid = target === WATER || target === LAVA || target === MOON_WATER;
  if (liquid || target === AIR) {
    if (BLOCK_INFO[id].solid && intersectsPlayer(px, py, pz)) return false;
    if (BLOCK_INFO[id].solid && intersectsMob(px, py, pz)) return false;
  } else if (!(target === id && (id === WATER || id === LAVA))) return false;
  if (id === FLOWER) placedFlowers.set(key(px, py, pz), { v: randomFlowerVariant(), a: Math.random() * Math.PI * 2 });
  if (id === GLOWSTONE) worldGlowVariants.get(world).set(key(px, py, pz), glowVariantNear(px, py, pz));
  setBlock(px, py, pz, id);
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

const CHAIN_FUSE = 0.05;
function igniteTNT(bx, by, bz, fuse = FUSE_TIME) {
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
  const t = { bx, by, bz, px: bx + 0.5, py: by + 1.1, pz: bz + 0.5, fuse, life: fuse + 2, spr, mesh: null, stuck: false, ax: 0, ay: 0, az: 0, pigeon: null };
  if (dim === "over" && !chainBreaking) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const eye = camera.position;
    const mob = pickMob(dir, PIGEON_AIM_DIST);
    if (mob && mob.kind === "pigeon") {
      const off = getMobHitOffset(eye, dir, mob);
      const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
      const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
      const blockT = Math.hypot(bx + 0.5 - eye.x, by + 0.5 - eye.y, bz + 0.5 - eye.z);
      if (mobT <= blockT + 0.5) {
        const nowI = performance.now() / 1000;
        const freshI = pigeonLock === mob && nowI - pigeonLockT < PIGEON_LOCK_TIME;
        if (freshI ? pigeonLockShots < 3 : !tntTargeted(mob)) {
          t.pigeon = mob;
          pigeonLock = mob;
          pigeonLockT = nowI;
          if (!freshI) pigeonLockShots = 0;
          pigeonLockShots++;
        }
      }
    }
  }
  if (dim === "end" && dragon.mesh && dragon.mob && !chainBreaking && !t.pigeon) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const eye = camera.position;
    const mob = pickMob(dir, PIGEON_AIM_DIST);
    if (mob && mob.kind === "dragon") {
      const off = getMobHitOffset(eye, dir, mob);
      const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
      const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
      const blockT = Math.hypot(bx + 0.5 - eye.x, by + 0.5 - eye.y, bz + 0.5 - eye.z);
      if (mobT <= blockT + 0.5) {
        const cap = dragonShotsCap();
        const nowI = performance.now() / 1000;
        const freshI = pigeonLock === mob && nowI - pigeonLockT < PIGEON_LOCK_TIME;
        if (cap > 0 && (freshI ? pigeonLockShots < cap : !tntTargeted(mob))) {
          t.pigeon = mob;
          pigeonLock = mob;
          pigeonLockT = nowI;
          if (!freshI) pigeonLockShots = 0;
          pigeonLockShots++;
        }
      }
    }
  }
  if (t.pigeon) {
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

let tntFlySeq = 0;
const PIGEON_AIM_DIST = 200;
const PIGEON_LOCK_TIME = 0.5;
const PIGEON_LOCK_BURST_DIST = 30;
let pigeonLock = null;
let pigeonLockT = 0;
let pigeonLockShots = 0;
function aimedPigeon() {
  if (dim !== "over") return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;
  const mob = pickMob(dir, PIGEON_AIM_DIST);
  if (!mob || mob.kind !== "pigeon") return null;
  const off = getMobHitOffset(eye, dir, mob);
  const hx = off ? mob.pos.x + off.x : mob.pos.x, hy = off ? mob.pos.y + off.y : mob.pos.y + mob.h * 0.5, hz = off ? mob.pos.z + off.z : mob.pos.z;
  const mobT = Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z);
  if (currentBlock) {
    const blockT = Math.hypot(currentBlock.x + 0.5 - eye.x, currentBlock.y + 0.5 - eye.y, currentBlock.z + 0.5 - eye.z);
    if (mobT > blockT + 0.5) return null;
  }
  return mob;
}
function livePigeonLock() {
  if (pigeonLock && mobs.includes(pigeonLock)) return pigeonLock;
  pigeonLock = null;
  return null;
}
function tntTargeted(mob) {
  for (const t of tntLit.values()) if (t.pigeon === mob) return true;
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
  const mob = pickMob(dir, PIGEON_AIM_DIST);
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
  const mob = aimedPigeon();
  if (mob) {
    const fresh = pigeonLock === mob && now - pigeonLockT < PIGEON_LOCK_TIME;
    if (!fresh) {
      if (tntTargeted(mob)) return false;
      pigeonLock = mob;
      pigeonLockShots = 0;
    }
    if (pigeonLockShots >= 3) return false;
    fireTNTAtPigeon(mob);
    pigeonLock = mob;
    pigeonLockT = now;
    pigeonLockShots++;
    return true;
  }
  const dr = aimedDragon();
  if (dr) {
    const cap = dragonShotsCap();
    if (cap <= 0) return false;
    const fresh = pigeonLock === dr && now - pigeonLockT < PIGEON_LOCK_TIME;
    if (!fresh) {
      if (tntTargeted(dr)) return false;
      pigeonLock = dr;
      pigeonLockShots = 0;
    }
    if (pigeonLockShots >= cap) return false;
    fireTNTAtPigeon(dr);
    pigeonLock = dr;
    pigeonLockT = now;
    pigeonLockShots++;
    return true;
  }
  const lock = livePigeonLock();
  if (lock && lock.dim !== undefined && lock.dim !== dim) { pigeonLock = null; return false; }
  if (lock && now - pigeonLockT < PIGEON_LOCK_TIME) {
    const cap = lock.kind === "dragon" ? dragonShotsCap() : 3;
    if (cap <= 0 || pigeonLockShots >= cap) return false;
    let blockT = Infinity;
    if (currentBlock) {
      const eye = camera.position;
      blockT = Math.hypot(currentBlock.x + 0.5 - eye.x, currentBlock.y + 0.5 - eye.y, currentBlock.z + 0.5 - eye.z);
    }
    if (blockT > PIGEON_LOCK_BURST_DIST) {
      fireTNTAtPigeon(lock);
      pigeonLockT = now;
      pigeonLockShots++;
      return true;
    }
  }
  return false;
}
function fireTNTAtPigeon(mob) {
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
  tntLit.set("fly" + (tntFlySeq++), { bx: 0, by: -1, bz: 0, px: sx, py: sy, pz: sz, fuse: FUSE_TIME, life: FUSE_TIME + 2, spr, mesh: m, stuck: false, ax: 0, ay: 0, az: 0, pigeon: mob });
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
  if (t.pigeon) {
    const m = t.pigeon;
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
    const sp = Math.min(d, TNT_HOME_SPEED * 4 * dt);
    t.px += (dx / d) * sp; t.py += (dy / d) * sp; t.pz += (dz / d) * sp;
    return;
  }
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
        const isPigeonBomb = t.pigeon && t.pigeon.kind === "pigeon";
        if (isPigeonBomb && mobs.includes(t.pigeon)) killPigeon(t.pigeon);
        if (isPigeonBomb) explodePigeon(t.px, t.py, t.pz, true);
        else enqueueExplosion(t.px, t.py, t.pz, true, true);
      } else if (t.pigeon) {
        const isPigeonBomb = t.pigeon.kind === "pigeon";
        if (!mobs.includes(t.pigeon) || (t.life -= dt) <= 0) {
          clearTNTVisual(t);
          tntLit.delete(k);
          if (isPigeonBomb) explodePigeon(t.px, t.py, t.pz, false);
          else enqueueExplosion(t.px, t.py, t.pz, false, true);
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
function explodePigeon(x, y, z, pointBlank) {
  explosionQueue.push({ x, y, z, pointBlank, homing: true, due: 0, pigeon: true });
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
    const { x, y, z, pointBlank, homing, pigeon } = explosionQueue.shift();
    const kShift = key(Math.floor(x), Math.floor(y), Math.floor(z));
    if (chainPending.has(kShift)) chainPending.delete(kShift);
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    if (pigeon) spawnPigeonBurst(cx, cy, cz);
    else if (pointBlank) spawnDragonBurst(cx, cy, cz);
    else spawnExplosion(cx, cy, cz);
    if (mobs.length) handleMobExplosion(cx, cy, cz);
    if (dim === "end" && dragon.mesh && homing && pointBlank && !pigeon) damageDragon(DRAGON_FULL_DMG);
    if (homing) { processed++; continue; }
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const k0 = key(bx, by, bz);
    if (!protectedBlocks.has(dim + ":" + k0) && !batchKeys.has(k0)) {
      const id0 = getBlock(bx, by, bz);
      if (id0 === TNT || (!isMobStandingOn(bx, by, bz) && !intersectsMob(bx, by, bz))) {
        if (id0 !== WATER && id0 !== LAVA && !(id0 === STONE && by === 0)) {
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
      if (id === STONE && gy === 0) continue;
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
      setBlock(gx, gy, gz, AIR);
      refreshDefer.push([gx, gy, gz]);
    }
    processed++;
  }
  glowDefer--;
  if (glowDefer === 0 && glowDirtyDeferred) { glowDirtyDeferred = false; recomputeGlowClusters(); syncGlowLights(); }
  const toRefresh = refreshDefer;
  refreshDefer = null;
  if (toRefresh.length) {
    refreshBlocks(toRefresh);
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

function spawnPigeonBurst(cx, cy, cz) {
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
let overPortalWin = null;
let overPortalDir = null;
const END_SPAWN = { x: 0.5, y: END_PLATFORM_TOP + 1.6, z: END_RETURN_Z - 3 };
const END_RETURN_BASE_Y = END_PLATFORM_TOP + 1;
const protectedBlocks = new Set();
const protKey = (x, y, z) => dim + ":" + key(x, y, z);
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
        protectedBlocks.add(protKey(x, END_RETURN_BASE_Y + y, END_RETURN_Z));
      }
    }
  for (let x = -END_PLATFORM_R; x <= END_PLATFORM_R; x++)
    for (let z = -END_PLATFORM_R; z <= END_PLATFORM_R; z++)
      for (let y = END_PLATFORM_TOP - 2; y <= END_PLATFORM_TOP; y++)
        protectedBlocks.add(protKey(x, y, z));
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
      protectedBlocks.add(protKey(x, base + y, NETHER_RETURN_Z));
    }
  netReturnWin = { minX: -2, minY: base, minZ: NETHER_RETURN_Z };
  refreshBlocks(coords);
}

function setDimensionEnv() {
  if (dim === "end") {
    skyDome.visible = false;
    skyStars.visible = false;
    scene.background.setHex(0x000000);
    scene.fog.color.setHex(0x000000);
    scene.fog.near = 30; scene.fog.far = 150;
    sun.color.setHex(0xfff5e0); sun.intensity = 0.35;
    hemi.color.setHex(0xbfd4ff); hemi.intensity = 0.45;
  } else if (dim === "nether") {
    skyDome.visible = true;
    skyStars.visible = false;
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
  if (dim !== "over") {
    overworldMobCache = snapshotOverworldMobs(false);
    removeVillagers();
  }
  else {
    if (!villageHouses.length) computeVillageLayout();
    const liveOver = mobs.filter((m) => m.dim === "over" || m.dim === undefined).length;
    if (overworldMobCache && overworldMobCache.length && liveOver < overworldMobCache.length) {
      restoreOverworldMobs(overworldMobCache, { keepCarried: true });
    } else if (!liveOver) spawnVillagers();
    spawnPigeons();
  }
  for (const m of mobs) m.mesh.visible = (m.dim === dim || m.dim === undefined) || m === carryMob || m === carryGrappleMob;
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
    const ret = resolveOverworldReturn();
    yaw = ret.yaw;
    sx = ret.spot.x; sy = ret.spot.y; sz = ret.spot.z;
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

function layoutPortalFill(group, win, nether) {
  let i = 0;
  const set = (x, y, z) => {
    const m = group.children[i++];
    m.visible = true;
    m.position.set(x + 0.5, y + 0.5, z + 0.5);
  };
  for (const [x, y, z] of portalFillCells(win, nether)) set(x, y, z);
  for (; i < group.children.length; i++) group.children[i].visible = false;
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
        portalTrigger("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z, "You returned to the Overworld");
      } else {
        portalTrigger("nether", NETHER_SPAWN.x, NETHER_SPAWN.y, NETHER_SPAWN.z, "You entered The Nether");
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
const DRAGON_SKIM_Y = END_PLATFORM_TOP + 2.2;
const DRAGON_SOAR_Y = END_PLATFORM_TOP + 10;
const DRAGON_FLEE_DIST = 16;
const DRAGON_FLEE_SPEED = 11;
const DRAGON_PAINT = [
  [0x0d0d12, 0x16161e, 0x20202a, 0x2a2a36, 0x100f1a], // black (base)
  [0x8c1851, 0x8c315c, 0x8c4163, 0x8c5870, 0x8c3c65], // dark pink
  [0x217931, 0x2e7f3d, 0x40874d, 0x558c5f, 0x367f44], // dark green
  [0x8c7219, 0x8c7831, 0x8c7d40, 0x8c8356, 0x8c7836], // dark gold
  [0x215b8c, 0x32648c, 0x446e8c, 0x5a788c, 0x36668c], // dark blue
  [0x8c5619, 0x8c602f, 0x8c6a40, 0x8c7456, 0x8c6336], // dark orange
  [0x8c2131, 0x8c313f, 0x8c444f, 0x8c5a61, 0x8c3645], // dark crimson
  [0x5b218c, 0x66328c, 0x70448c, 0x7b5a8c, 0x69368c], // dark violet
  [0x197e76, 0x2f817c, 0x46857f, 0x608884, 0x36817b], // dark cyan
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
    color: 0x100f1a, emissive: 0x100f1a, emissiveIntensity: 0.5, roughness: 0.9, metalness: 0.02,
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
  paintDragonPalette(DRAGON_PAINT[1 + (dragon.hitCount % (DRAGON_PAINT.length - 1))]);
}

function removeDragon() {
  if (!dragon.mesh) return;
  if (dragon.mob) {
    if (pigeonLock === dragon.mob) { pigeonLock = null; pigeonLockT = 0; pigeonLockShots = 0; }
    mobById.delete(dragon.mob.id);
    const mi = mobs.indexOf(dragon.mob);
    if (mi >= 0) mobs.splice(mi, 1);
    dragon.mob = null;
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
    if (dragon.mob) { dragon.mob.pos.copy(M.position); dragon.mob.vel.set(0, 0, 0); }
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
  if (dragon.mob) {
    dragon.mob.pos.copy(M.position);
    dragon.mob.vel.copy(fwd).multiplyScalar(DRAGON_SPEED * dragon.speedMul);
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
  const eyes = [];
  for (const sx of [1, -1]) eyes.push(endermanBox(head, eyeMat, 0.09, 0.16, 0.05, sx * 0.16, 0.03, 0.26));
  const armL = new THREE.Group();
  armL.position.set(-0.42, 1.95, 0);
  g.add(armL);
  endermanBox(armL, endermanBodyMat, 0.16, 1.75, 0.16, 0, -0.9, 0);
  const armR = new THREE.Group();
  armR.position.set(0.42, 1.95, 0);
  g.add(armR);
  endermanBox(armR, endermanBodyMat, 0.16, 1.75, 0.16, 0, -0.9, 0);
  return { g, eyeMat, eyes, armL, armR, head, t: 0, angry: 0, teleportT: 0, lookT: 0 };
}

function setEndermanEyeColor(e, hex) {
  if (e.eyeMat) e.eyeMat.color.setHex(hex);
  if (e.eyes) for (const m of e.eyes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) if (mm && mm.color) mm.color.setHex(hex);
  }
}

function ensureEndermanAssets() {
  if (!endermanGeo) endermanGeo = new THREE.BoxGeometry(1, 1, 1);
  if (!endermanBodyMat) endermanBodyMat = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.85, metalness: 0.05 });
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
      t: 0, angry: 0, teleportT: v.teleportT, lookT: 0, eyeRedT: 0, baseY: END_PLATFORM_TOP + 1,
    };
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
  if (!endermen.length) {
    if (endermanGeo) { endermanGeo.dispose(); endermanGeo = null; }
    if (endermanBodyMat) { endermanBodyMat.dispose(); endermanBodyMat = null; }
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
  bursts.push({ pts, geo, mat, vel, life: 0.7, max: 0.7 });
}

function endermanPickSpot(cx, cz, minDist, others = [], maxDist = END_PLATFORM_R - 4, px = null, pz = null) {
  const R = END_PLATFORM_R - 4;
  const preferAng = (px != null && pz != null && (px || pz)) ? Math.atan2(pz, px) : null;
  for (let tries = 0; tries < 24; tries++) {
    const a = preferAng != null ? preferAng + (Math.random() * 2 - 1) * Math.PI * 0.5 : Math.random() * Math.PI * 2;
    const r = minDist + Math.sqrt(Math.random()) * Math.max(0.5, maxDist - minDist);
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
    const a = preferAng != null ? preferAng + (Math.random() * 2 - 1) * Math.PI * 0.5 : Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * Math.min(5, Math.max(0.5, maxDist - 2));
    const x = THREE.MathUtils.clamp(Math.round(cx + Math.cos(a) * r), -R, R);
    const z = THREE.MathUtils.clamp(Math.round(cz + Math.sin(a) * r), -R, R);
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) >= minDist * minDist) return { x, z };
  }
  return { x: THREE.MathUtils.clamp(cx, -R, R), z: THREE.MathUtils.clamp(cz, -R, R) };
}

function endermanTeleport(e, x, z, baseY) {
  const M = e.g;
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
  const gy = groundYForMob(x, z, refY, ENDERMAN_HW);
  if (gy < 1 || gy > MAX_Y - 3) return null;
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
  const R = END_PLATFORM_R - 4;
  const ex = e.pos.x, ez = e.pos.z;
  const farFromPlayer = (x, z) => Math.hypot(x - pos.x, z - pos.z) >= 10;
  const landY = (x, z) => {
    if (Math.abs(x) > R || Math.abs(z) > R) return null;
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
  return endermanRelaxedSpot(e, others, landY, ENDERMAN_BLINK_DIST, R)
    || { x: THREE.MathUtils.clamp(Math.round(ex), -R, R), z: THREE.MathUtils.clamp(Math.round(ez), -R, R), y: END_PLATFORM_TOP + 1 };
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
  for (let i = 0; i < endermen.length; i++) updateEnderman(endermen[i], dt);
}

function updateEnderman(e, dt) {
  if (e === carryMob || isMobFrozenByGrapple(e)) { e.lookT = 0; e.eyeRedT = ENDERMAN_RED_TIME; setEndermanEyeColor(e, 0xff2222); return; }
  if (e.dim !== undefined && e.dim !== dim) return;
  const inboundGrab = e === carryGrappleMob && carryGrappleMode === "grab" && (carryGrappleActive || carryGrapplePulling);
  const M = e.g;
  const t = (e.t += dt);
  const baseY = e.baseY != null ? e.baseY : END_PLATFORM_TOP + 1;
  let hoverY = baseY + Math.sin(t * 1.3) * 0.02;
  if (mobInWater(e)) {
    const surf = waterSurfaceForMob(e);
    if (surf > -Infinity) {
      hoverY = mobFloatTargetY(surf, ENDERMAN_H);
      e.baseY = hoverY;
    }
  }
  M.position.y += (hoverY - M.position.y) * Math.min(1, dt * 8);

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
  if (!inboundGrab && endermanAimed(e, endermanFwd)) {
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

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("minicraft", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saves");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function serialize() {
  const count = (map) => { let n = 0; map.forEach(() => n++); return n; };
  const over = worlds.over, end = worlds.end, nether = worlds.nether;
  const on = count(over), en = count(end), nn = count(nether);
  const m = placedFlowers.size;
  const gov = glowVariants.over.size, gev = glowVariants.end.size, gnv = glowVariants.nether.size;
  const winLen = overPortalWin ? 12 : 1;
  const overMobs = dim === "over" ? snapshotOverworldMobs(true) : (overworldMobCache || []);
  const mobN = overMobs.length;
  const buf = new ArrayBuffer(117 + (on + en + nn) * 5 + m * 6 + (gov + gev + gnv) * 5 + winLen + 16 + 4 + mobN * MOB_SAVE_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  new Uint8Array(buf, o, 9).set(SAVE_MAGIC); o += 9;
  dv.setUint8(o++, 13); // format version
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
  dv.setUint32(o, mobN, true); o += 4;
  for (const em of overMobs) {
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
    dv.setUint8(o++, encodeMobYaw(em.yaw || 0));
    dv.setUint8(o++, em.look & 255);
  }
  return buf;
}

function deserialize(buf) {
  const dv = new DataView(buf);
  let o = 0;
  for (let i = 0; i < 9; i++) if (new Uint8Array(buf, o, 9)[i] !== SAVE_MAGIC[i]) throw new Error("Not a MiniCraft save");
  o += 9;
  const ver = dv.getUint8(o++);
  if (ver !== 1 && ver !== 2 && ver !== 3 && ver !== 4 && ver !== 5 && ver !== 6 && ver !== 7 && ver !== 8 && ver !== 9 && ver !== 10 && ver !== 11 && ver !== 12 && ver !== 13) throw new Error("Unsupported save version");
  const yWidth = ver >= 8 ? 2 : 1;
  const readY = () => { const y = yWidth === 2 ? dv.getUint16(o, true) : dv.getUint8(o); o += yWidth; return y; };
  placedFlowers.clear();
  glowVariants.over.clear();
  glowVariants.end.clear();
  glowVariants.nether.clear();
  pendingOverworldMobs = null;
  overworldMobCache = null;
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
      const yb = dv.getUint8(o++);
      const look = dv.getUint8(o++);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      const e10 = { kind, isBaby: (flags & 1) !== 0, homeId, parentIdx, x, y, z, yaw: decodeMobYaw(yb), look };
      if (ver >= 11) { e10.villageBound = (flags & 2) !== 0; e10.penBound = (flags & 4) !== 0; }
      arr.push(e10);
    }
    pendingOverworldMobs = arr;
    overworldMobCache = arr.map((e) => ({ ...e }));
  }
  freeCam = flyFlag && dim !== "end";
  if (freeCam) camPos.copy(pos);
  worldDirty = true;
  rebuildColTops();
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
const boostEl = document.getElementById("boost");
const toastEl = document.getElementById("toast");
const bossBarEl = document.getElementById("bossbar");
const bossFillEl = document.getElementById("bossfill");
let hudEnabled = false;
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
    rebuildMeshes();
    select(selected);
    updateCamera();
    setDimensionEnv();
    updateDimLabel();
    clearPortalFills();
    removeEndEntities();
    if (dim === "end") { endCleared = false; buildReturnPortal(); spawnDragon(); spawnEndermen(); }
    if (dim === "nether") { netReturnWin = null; buildNetherPortal(); }
    computeVillageLayout();
    if (dim === "over") {
      if (pendingOverworldMobs && pendingOverworldMobs.length) {
        const saved = pendingOverworldMobs;
        pendingOverworldMobs = null;
        overworldMobCache = null;
        if (!restoreOverworldMobs(saved, { keepCarried: false })) { spawnVillagers(); spawnPigeons(); }
        else overworldMobCache = snapshotOverworldMobs(true);
      } else {
        pendingOverworldMobs = null;
        removeVillagers();
        spawnVillagers();
        spawnPigeons();
      }
    } else {
      removeVillagers();
    }
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
  protectedBlocks.clear();
  removeEndEntities();
  removeVillagers();
  overworldMobCache = null;
  pendingOverworldMobs = null;
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
      removeVillagers(); spawnVillagers(); spawnPigeons();
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

setInterval(() => { if (canSave() && started && worldDirty) saveToFile(); }, 3000);
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
  if (suppressMenu) { suppressMenu = false; return; }
  if (helpOpen) return;
  if (!locked && Date.now() - helpCloseTime < 2000) return;
  if (wasLocked && !locked && started) saveToFile();
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
      leftMoved = false; leftTimer = 0; leftStairs = false; leftEverMoved = false; clickAnchors = [];
      const sel = hotbarList()[selected];
      if (sel === TNT) {
        if (!tryFireLockedTNT() && placeBlock(sel)) clickAnchors.push([currentBlock.x + currentBlock.face[0], currentBlock.y + currentBlock.face[1], currentBlock.z + currentBlock.face[2]]);
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
    if (e.button === 0) { chainHome = null; chainPlat = null; chainSpin = 0; leftStairs = false; leftTimer = 0; clickAnchors = []; }
    else { rightMoved = false; rightMoveAcc = 0; clickAnchors = []; }
  }
  if (e.button !== 1 || loading) return;
  if (!grappleActive) return;
  if (grapplePulling) {
    const fdx = grappleTarget.x - pos.x, fdy = grappleTarget.y - pos.y, fdz = grappleTarget.z - pos.z;
    if (grappleMob && (grappleMob.kind === "pigeon" || grappleMob.kind === "dragon") && grappleHooked &&
        (grappleTowInit || Math.hypot(fdx, fdy, fdz) <= PIGEON_FOLLOW_DIST + 0.5)) {
      const sp = Math.hypot(vel.x, vel.y, vel.z) || 1;
      if (sp > GRAPPLE_FLING) { vel.x *= GRAPPLE_FLING / sp; vel.y *= GRAPPLE_FLING / sp; vel.z *= GRAPPLE_FLING / sp; }
      flingActive = true;
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
  if (e.code === "Equal" && !isTyping(e)) {
    hudEnabled = !hudEnabled;
    if (!hudEnabled) boostEl.style.display = "none";
    e.preventDefault();
  }
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
  if (e.code === "KeyF" && dim !== "end") { freeCam = !freeCam; if (freeCam) camPos.copy(camera.position); else exitFreeCam(); }
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
      const name = await askName("New World", "world");
      if (!name) return;
      const existing = await apiList();
      if (existing.some((w) => w.name === name) && !confirm("Overwrite existing save '" + name.replace(/\.sav$/i, "") + "'?")) return;
      saveName = name;
      await buildWorld();
      hudEnabled = false; boostEl.style.display = "none";
      enterGame();
      await saveToFile();
      return;
    }
    if (fileMode) await pickSaveFile();
    await buildWorld();
    hudEnabled = false; boostEl.style.display = "none";
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
    if (await loadSave()) { hudEnabled = false; boostEl.style.display = "none"; enterGame(); }
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
      // While flying, the build anchor follows the camera, so placing and
      // breaking target live terrain and the hold-chain builds from where you
      // actually are instead of the stale ground position.
      pos.copy(camPos);
    } else {
      updatePlayer(dt);
      camera.position.set(pos.x, pos.y + EYE, pos.z);
      if (pos.y < -20) { vel.set(0, 0, 0); spawnPlayer(); }
    }
    camera.rotation.set(pitch, yaw, 0);
    const moon = onMoon();
    if (moon !== hotbarMoon) { hotbarMoon = moon; rebuildHotbar(); }
    updateTarget();
    updateCarry(dt);
    updateCarryGrapple(dt);
    if (hudEnabled && jumpBoost > 1.01) { boostEl.textContent = "Speed x" + jumpBoost.toFixed(1); boostEl.style.display = "block"; }
    else boostEl.style.display = "none";
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
        if (leftStairs) {
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
        } else if (leftMoved && currentBlock && currentBlock.id !== hotbarList()[selected]) {
          // Paint phase: place where aimed, only onto a block of a different
          // kind, within CHAIN_RANGE of the last block placed on this click.
          const wx = currentBlock.x + currentBlock.face[0];
          const wy = currentBlock.y + currentBlock.face[1];
          const wz = currentBlock.z + currentBlock.face[2];
          const near = !clickAnchors.length || clickAnchors.some(([ax, ay, az]) =>
            (wx - ax) ** 2 + (wy - ay) ** 2 + (wz - az) ** 2 <= CHAIN_RANGE * CHAIN_RANGE);
          if (near && tryPlace(hotbarList()[selected], wx, wy, wz)) {
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
      carryGrappleHead.material.opacity = 0.3;
      carryGrappleHead.material.transparent = true;
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
    tickTNT(dt);
    processExplosionQueue();
    tickEffects(dt);
    syncGlowLights(dt);
    if (portalCd > 0) portalCd -= dt;
    updatePortalVisual();
    checkPortal();
    if (dim === "end") updateDragon(dt);
    if (locked && started && !helpOpen) updateMobs(dt);
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }

    if (dim === "over") {
      const y = camera.position.y;
      let ts = (y - SKY_SPACE_START) / (SKY_SPACE_END - SKY_SPACE_START);
      ts = Math.max(0, Math.min(1, ts));
      const s = ts * ts * (3 - 2 * ts);
      scene.background.copy(DAY_SKY).lerp(SPACE_SKY, s);
      scene.fog.color.copy(scene.background);
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
      if (typeMats.has(MOON_WATER)) {
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
        for (const mm of typeMats.get(MOON_WATER)) {
          if (mm.map !== (useMoon ? TEX.moon : TEX.moonwater)) { mm.map = useMoon ? TEX.moon : TEX.moonwater; mm.needsUpdate = true; }
          const o = useMoon ? ms : ls;
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
if (location.search.includes('test')) {
  window._test = {
    get world(){ return world; }, get worlds(){ return worlds; }, get mobs(){ return mobs; },
    getBlock, setBlock, handleMobExplosion, processExplosionQueue, isMobStandingOn, intersectsMob, key, BLAST_RADIUS, TNT, STONE, AIR, get SAND(){ return SAND; }, get WATER(){ return WATER; }, get VILLAGE_POOL_W(){ return VILLAGE_POOL_W; }, get VILLAGE_POOL_D(){ return VILLAGE_POOL_D; }, get VILLAGE_POOL_DEPTH(){ return VILLAGE_POOL_DEPTH; }, get VILLAGE_PEN_POOL_W(){ return VILLAGE_PEN_POOL_W; }, get VILLAGE_PEN_POOL_D(){ return VILLAGE_PEN_POOL_D; }, get VILLAGE_PEN_POOL_DEPTH(){ return VILLAGE_PEN_POOL_DEPTH; },
    get villageCenter(){ return villageCenter; }, get villageHouses(){ return villageHouses; }, get villagePen(){ return villagePen; }, get villagePool(){ return villagePool; }, get isInsidePen(){ return isInsidePen; }, get isInsidePool(){ return isInsidePool; }, get isInsidePenPool(){ return isInsidePenPool; }, get poolExitTarget(){ return poolExitTarget; }, get penPoolExitTarget(){ return penPoolExitTarget; }, get LOG(){ return LOG; }, findPenGaps, nearestPenGap, penGapInside, penGapOutside, hasMobGround, mobBlockedAt, aabbCollidesWorld, mobProbeFree, randomPenPoint, randomAroundPenPoint, groundYForMob, get CLOUD_BASE(){ return CLOUD_BASE; }, get CLOUD_TOP(){ return CLOUD_TOP; }, get MAX_Y(){ return MAX_Y; },
    getTypeMats, get typeMats(){ return typeMats; }, buildWorld, generateWorld, computeVillageLayout, spawnVillagers, refreshBlocks, get boxGeo(){ return boxGeo; }, THREE,
    get pos(){ return pos; }, get vel(){ return vel; }, get camera(){ return camera; }, get yaw(){ return yaw; }, set yaw(v){ yaw=v; }, get pitch(){ return pitch; }, set pitch(v){ pitch=v; },
    get carryMob(){ return carryMob; }, handleCarryEnterDown, handleCarryEnterUp, pickMob, get carryGrappleActive(){ return carryGrappleActive; }, get carryGrapplePulling(){ return carryGrapplePulling; }, get carryGrappleMob(){ return carryGrappleMob; }, get carryGrappleBlock(){ return carryGrappleBlock; }, get carryGrappleHookPos(){ return carryGrappleHookPos; }, get carryGrappleOffset(){ return carryGrappleOffset; }, get carryGrappleMode(){ return carryGrappleMode; }, get isMobFrozenByGrapple(){ return isMobFrozenByGrapple; }, get grappleMob(){ return grappleMob; }, get grappleMobOffset(){ return grappleMobOffset; }, get grappleHookPos(){ return grappleHookPos; }, get grappleTarget(){ return grappleTarget; }, updateCarryGrapple, get currentBlock(){ return currentBlock; }, updateTarget, hotbarList, placeBlock, breakBlock, get selected(){ return selected; }, set selected(v){ selected=v; }, toggleCarry: handleCarryEnterDown, findNearestMobForGrab: (...a)=>{ const d=new THREE.Vector3(); camera.getWorldDirection(d); return pickMob(d); }, get playerArms(){ return playerArms; }, get started(){ return started; }, set started(v){ started=v; }, get loading(){ return loading; }, get freeCam(){ return freeCam; }, set freeCam(v){ freeCam=v; }, get helpOpen(){ return helpOpen; },
    get WOLF_COUNT(){ return WOLF_COUNT; }, makeWolfMesh, villagerHW, villagerH, wolfHasMobGround, wolfBlockedAt, wolfProbeFree, wanderGoalForWolf, wolfFindPath, wolfInWater, mobInWater, waterSurfaceForMob, mobPhysicsStep, wolfPhysicsStep, updateMobs,     get isPigCow(){ return isPigCow; }, get pigOverlapsFence(){ return pigOverlapsFence; }, get MOB_FLOAT_FRAC(){ return MOB_FLOAT_FRAC; }, mobFloatTargetY, mobWaterExitJump, poolExitTarget, penPoolExitTarget, isInsidePenPool,
    get PIGEON_COUNT(){ return PIGEON_COUNT; }, get PIGEON_MIN_Y(){ return PIGEON_MIN_Y; }, get PIGEON_MAX_Y(){ return PIGEON_MAX_Y; }, get PIGEON_SPEED(){ return PIGEON_SPEED; }, get TNT_HOME_SPEED(){ return TNT_HOME_SPEED; }, get PIGEON_AIM_DIST(){ return PIGEON_AIM_DIST; }, get PIGEON_LOCK_TIME(){ return PIGEON_LOCK_TIME; }, get pigeonLock(){ return pigeonLock; }, get pigeonLockT(){ return pigeonLockT; }, set pigeonLockT(v){ pigeonLockT = v; }, get pigeonLockShots(){ return pigeonLockShots; }, livePigeonLock, tntTargeted, tryFireLockedTNT, get chainBreaking(){ return chainBreaking; }, set chainBreaking(v){ chainBreaking = v; }, makePigeonMesh, spawnPigeons, spawnSinglePigeon, removePigeons, updatePigeon, updateCoopedPigeon, updatePerchedPigeon, updateToPerchPigeon, pigeonTakeoff, pigeonNextLeg, pigeonFindPerchSpot, pigeonCloudTopAt, pigeonTreeTopAt, pigeonRoofTopAt, pigeonPerchBand, pigeonPerchSupports, killPigeon, pigeonSpotOutOfView, pigeonProbeFree, pigeonRandomTarget, pigeonSeparate,     houseInteriorFor, houseSealState, holeFaceNormal, updateHoleExitPigeon, pigeonSegmentFree, bandReturnTarget, setMobTransparent,     get tntLit(){ return tntLit; }, igniteTNT, aimedPigeon, fireTNTAtPigeon, explodePigeon, spawnPigeonBurst, get bursts(){ return bursts; }, get flashes(){ return flashes; }, updateTNTTarget, tickTNT, fireGrapple, updateGrapple, updatePlayer, get grappleActive(){ return grappleActive; }, get grapplePulling(){ return grapplePulling; }, get grappleHooked(){ return grappleHooked; },
    get overPortalWin(){ return overPortalWin; }, get overPortalDir(){ return overPortalDir; }, get overPortalSpawn(){ return overPortalSpawn; }, get overPortalFace(){ return overPortalFace; },
    portalWinValid, portalFrameBBox, findReturnSpot, frameTopSpot, facePortalFrom, recordOverPortal, nearestReturnWin, resolveOverworldReturn, nearPortalSpawn, resolveSpawn, collectEndWins, collectNetherWins, collectReturnWins, insideEndInterior, insideNetherInterior, winCenter, windowDist, isSolid,
    get PORTAL(){ return PORTAL; }, get OBSIDIAN(){ return OBSIDIAN; }, get WORLD_RADIUS(){ return WORLD_RADIUS; }, get PLAYER_HW(){ return PLAYER_HW; }, get PLAYER_H(){ return PLAYER_H; }, get MOON(){ return MOON; }, get CLOUD(){ return CLOUD; }, get GRASS(){ return GRASS; }, get STONE(){ return STONE; }, get ENDSTONE(){ return ENDSTONE; }, get NETHERRACK(){ return NETHERRACK; }, get dim(){ return dim; },
    serialize, deserialize, snapshotOverworldMobs, restoreOverworldMobs, get overworldMobCache(){ return overworldMobCache; }, get pendingOverworldMobs(){ return pendingOverworldMobs; },
    goToDimension, removeVillagers,
    get DEV_START_DIM(){ return DEV_START_DIM; },
    get dragon(){ return dragon; }, spawnDragon, removeDragon, updateDragon, paintDragon, damageDragon, dragonShotsCap, aimedDragon, get DRAGON_FULL_DMG(){ return DRAGON_FULL_DMG; }, get DRAGON_SPEED(){ return DRAGON_SPEED; },
    get endermen(){ return endermen; }, get ENDERMEN_COUNT(){ return ENDERMEN_COUNT; }, get ENDERMAN_STARE_TIME(){ return ENDERMAN_STARE_TIME; }, get ENDERMAN_ANGRY_TIME(){ return ENDERMAN_ANGRY_TIME; }, spawnEndermen, removeEndermen, updateEnderman, updateEndermen, endermanTeleport, endermanPickSpot, endermanSpotFor, ensureEndermanAssets, makeEndermanMesh,
  };
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
