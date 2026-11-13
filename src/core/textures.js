// Procedural canvas textures and per-block materials, ported from master.
import * as THREE from "three";
import {
  GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, PLANKS, GLASS,
  TNT, MEGA_TNT, ULTRA_TNT, FLOWER, PORTAL, ENDSTONE, OBSIDIAN, CLOUD, MOON, MOON_WATER,
  GLOWSTONE, LAVA, NETHERRACK, SOULSAND,
  HULL, HULL_ACCENT, THRUSTER, PAD,
} from "./blocks.js";
import { GLOW_VARIANTS, GLOW_ICON_VARIANT, isPadGhostVariant, padGhostBaseVariant } from "../world/glowstone.js";

export function canvasTex(draw, size = 16) {
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

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Moon painter (base grey 160): pale disc, voxel data never touched.
function paintMoonLight(ctx, base) {
  ctx.fillStyle = `rgb(${base},${base + 4},${base + 8})`; ctx.fillRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = (Math.random() * 2 - 1) * 16 + (Math.random() * 2 - 1) * 8;
    const v = base + n;
    ctx.fillStyle = `rgb(${v | 0},${(v + 1) | 0},${(v + 2) | 0})`;
    if (Math.random() < 0.58) ctx.fillRect(x, y, 1, 1);
  }
  const crater = (x, y, r, shade) => {
    const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.12, x, y, r);
    g.addColorStop(0, `rgba(${shade[0] + 14},${shade[1] + 14},${shade[2] + 14},0.92)`);
    g.addColorStop(0.30, `rgba(${shade[0]},${shade[1]},${shade[2]},0.95)`);
    g.addColorStop(0.62, `rgba(${shade[0] - 8},${shade[1] - 8},${shade[2] - 8},0.96)`);
    g.addColorStop(0.85, `rgba(${shade[0] - 14},${shade[1] - 14},${shade[2] - 14},0.97)`);
    g.addColorStop(1, `rgba(${shade[0] + 8},${shade[1] + 8},${shade[2] + 8},0.88)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.beginPath(); ctx.arc(x + r * 0.20, y + r * 0.22, r * 0.48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.arc(x - r * 0.26, y - r * 0.28, r * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${base - 20},${base - 18},${base - 16},0.30)`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  };
  const sh = (d) => [base + d, base + d + 2, base + d + 4];
  const shades = [sh(-6), sh(-10), sh(-3), sh(-14)];
  crater(4.4, 4.7, 3.2, shades[0]);
  crater(12.0, 5.1, 2.7, shades[1]);
  crater(8.6, 11.0, 3.5, shades[2]);
  crater(3.0, 12.4, 2.0, shades[3]);
  crater(13.4, 11.8, 1.8, shades[0]);
  crater(6.4, 8.4, 1.5, shades[1]);
  crater(9.2, 3.4, 1.2, shades[2]);
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * 16, y = Math.random() * 16;
    const v = (base - 36) + Math.random() * 32;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 1) | 0},${0.14 + Math.random() * 0.16})`;
    ctx.fillRect(x | 0, y | 0, 1, 1);
  }
}
// Diver's-window style for the open-air backs (role "inside"): opacity,
// transparency and fog come from the entry's insideRole override when
// present, color and texture always stay the outside sheet's. Lets the eye
// inside the liquid see out through open water faces while the exterior
// reads solid.
function insideRoleStyle(id) {
  const entry = liquidSpecById.get(id) || {};
  return entry.insideRole || {};
}
// Runtime fog override per liquid (eye-medium driver in main.js): consulted
// at material creation so streamed chunks follow the live state; null clears
// back to the spec default. Existing shared materials flip in place with a
// recompile (one program per fog variant, then cached); region clones flip
// through mesher.setRegionLiquidFog.
const liquidFogOverride = new Map();
export function setLiquidFogOverride(id, on) {
  if (on == null) liquidFogOverride.delete(id);
  else liquidFogOverride.set(id, on);
  for (const [k, m] of liquidMatCache) {
    if (!k.startsWith(id + ":")) continue;
    const want = roleFog(id, k.slice((id + ":").length), on);
    if (m.fog !== want) { m.fog = want; m.needsUpdate = true; }
  }
}
// Effective fog flag for one liquid role: eye override first, then the
// inside-role window override, then the spec default.
function roleFog(id, role, on) {
  const style = ROLE_STYLE[role];
  const spec = liquidSpec(id, style.spec);
  const roleOver = role === "inside" ? insideRoleStyle(id) : {};
  return on ?? roleOver.fog ?? spec.fog ?? true;
}


// Glowstone palettes: lift the registry's base/bright triples brighter along
// their dominant channels only (thresholded per entry), so each hue stays
// pure instead of washing toward white. `flat` entries skip the lift with
// hand-picked saturated colors.
function liftGlow(rgb, f, thresh = 0.6) {
  const max = Math.max(...rgb);
  const t = max * thresh;
  return rgb.map((v) => (v >= t ? Math.min(255, Math.round(v + (255 - v) * f)) : v));
}

function drawGlowMesh(ctx, p) {
  ctx.fillStyle = p.bright;
  ctx.fillRect(0, 0, 16, 16);
  const border = `rgb(${(p.noise[0] * 0.75) | 0},${(p.noise[1] * 0.75) | 0},${(p.noise[2] * 0.75) | 0}`;
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0, 0, 16, 16);
}



export const TEX = {
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
  mega_side: canvasTex((ctx) => {
    ctx.fillStyle = "#1e3fae"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 16, 64, 32);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const blue = y < 16 || y > 47;
      const base = blue ? [30, 63, 174] : [236, 230, 208];
      const d = (Math.random() - 0.5) * (blue ? 14 : 8);
      ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = "#101828";
    ctx.font = "bold 24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 32, 32);
  }, 64),
  mega_top: canvasTex((ctx) => {
    ctx.fillStyle = "#1e3fae"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [30, 63, 174], 12);
  }),
  ultra_side: canvasTex((ctx) => {
    ctx.fillStyle = "#101014"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 16, 64, 32);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const black = y < 16 || y > 47;
      const base = black ? [16, 16, 20] : [236, 230, 208];
      const d = (Math.random() - 0.5) * (black ? 14 : 8);
      ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = "#101014";
    ctx.font = "bold 24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 32, 32);
  }, 64),
  ultra_top: canvasTex((ctx) => {
    ctx.fillStyle = "#101014"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [16, 16, 20], 12);
  }),
  glass: canvasTex((ctx) => {
    ctx.fillStyle = "rgba(190,230,255,0.55)"; ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, 14.5, 14.5);
    ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(8, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(15, 8); ctx.stroke();
  }),
  cloud: canvasTex((ctx) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [255, 255, 255], 12);
    ctx.fillStyle = "rgba(150,150,160,0.28)";
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.random() * 13, Math.random() * 13, 2 + Math.random() * 2, 1 + Math.random() * 2);
  }),
  moon: canvasTex((ctx) => paintMoonLight(ctx, 160)),
  obsidian: canvasTex((ctx) => {
    ctx.fillStyle = "#12070f"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [24, 12, 20], 18);
    ctx.fillStyle = "rgba(96,58,132,0.35)";
    for (let i = 0; i < 7; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 1 + Math.random() * 2, 1 + Math.random() * 2);
    ctx.fillStyle = "rgba(24,10,26,0.9)";
    ctx.fillRect(2, 7, 2, 1); ctx.fillRect(6, 12, 1, 1); ctx.fillRect(10, 3, 2, 1); ctx.fillRect(13, 9, 1, 1);
  }),
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
  endstone: canvasTex((ctx) => {
    const base = [154, 154, 162];
    ctx.fillStyle = "#9a9aa2"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, base, 14);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.random() * 14, Math.random() * 14, 2 + Math.random() * 3, 2 + Math.random() * 2);
  }),
  hull: canvasTex((ctx) => {
    ctx.fillStyle = "#e6e9ee"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [230, 233, 238], 10);
    ctx.fillStyle = "rgba(120,130,145,0.55)";
    ctx.fillRect(0, 0, 16, 1); ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(0, 0, 1, 16); ctx.fillRect(15, 0, 1, 16);
    ctx.fillStyle = "rgba(160,170,185,0.45)";
    for (const [x, y] of [[2, 3], [13, 3], [2, 12], [13, 12]]) ctx.fillRect(x, y, 1, 1);
  }),
  hull_orange: canvasTex((ctx) => {
    ctx.fillStyle = "#dd6b24"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [221, 107, 36], 14);
    ctx.fillStyle = "rgba(90,35,10,0.45)";
    ctx.fillRect(0, 0, 16, 2); ctx.fillRect(0, 14, 16, 2);
    ctx.fillStyle = "rgba(255,180,110,0.35)";
    ctx.fillRect(2, 5, 12, 1); ctx.fillRect(2, 10, 12, 1);
  }),
  thruster: canvasTex((ctx) => {
    ctx.fillStyle = "#2b2f36"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [43, 47, 54], 14);
    ctx.strokeStyle = "#14161a"; ctx.lineWidth = 1;
    for (const r of [2, 4, 6]) { ctx.beginPath(); ctx.arc(8, 8, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = "#dd6b24"; ctx.fillRect(7, 7, 2, 2);
    ctx.fillStyle = "#4a505a"; ctx.fillRect(0, 0, 16, 1); ctx.fillRect(0, 15, 16, 1);
  }),
  pad: canvasTex((ctx) => {
    ctx.fillStyle = "#3a3f47"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [58, 63, 71], 16);
    ctx.fillStyle = "#d8a31d";
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(i * 4, 0);
      ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(4, 12); ctx.lineTo(4, 16); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 15, 15);
    ctx.fillStyle = "rgba(190,200,215,0.35)";
    for (const [x, y] of [[3, 4], [12, 4], [3, 9], [12, 9]]) ctx.fillRect(x, y, 1, 1);
  }),
};

export function material(map, opts = {}) {
  return new THREE.MeshLambertMaterial({ map, ...opts });
}

// Liquid surfaces: every bound emits the coplanar pair. The air-side sheet
// is always the liquid's outside color (surface from outside, well rim
// look-down, detached cubes); the liquid-side sheet keeps the outside color
// except when the air side is a pocket (airpocket.js: bubbles, wells, mixed
// liquid + solid cavities — the diver's read), where it reads the inside
// color (water light blue, moon water ash gray) — lava excepted, whose
// pockets reuse the surface fire motif at 0.8 (entry `pocket` override).
// Backface culling shows exactly one sheet per viewpoint. Both sheets write
// depth, so the nearest interface occludes block undersides and far walls.
// New liquids register a spec; the mesher dispatches through it without forks.
const LIQUID_DEFAULTS = {
  outside: { color: "#2f66cc", opacity: 0.9, grain: 16 },
  // Trapped-air backs read almost solid: the pocket occludes its far walls
  // instead of showing through them (hollow/hole read).
  inside: { color: "#6fa9e7", opacity: 0.8, grain: 16 },
};
export const LIQUID_SURFACE = [
  {
    liquid: WATER, key: "water",
    // Baked pick: surface sheets read slightly under opaque.
    outside: { opacity: 0.95 },
  },
  {
    liquid: MOON_WATER, key: "moonwater",
    // Fog-free opaque walls (no black columns at distance); the open-air
    // backs stay a 0.93 see-through window for the submerged eye.
    outside: { color: "#95999d", opacity: 1, transparent: false, fog: false },
    insideRole: { opacity: 0.93, transparent: true, fog: false },
    inside: { color: "#b0b4b9", opacity: 0.8, transparent: true, fog: false },
  },
  {
    liquid: LAVA, key: "lava",
    // Blue fire: fully opaque so the sea reads as a glowing surface, and
    // fog-free so it stays vivid past the dark haze.
    outside: { color: "#1d1d5e", opacity: 1, grain: 26, fog: false },
    inside: { color: "#5e8fd4", opacity: 1, grain: 12, fog: false },
    // Trapped-air backs read the surface motif instead of the inside
    // grain, only more transparent: same fire, alpha 0.4.
    pocket: { tex: "outside", opacity: 0.4 },
  },
];
const liquidSpecById = new Map(LIQUID_SURFACE.map((s) => [s.liquid, s]));
// One table maps every visual role to its look: which side renders, which
// registry spec supplies color/opacity (`spec`), and which painted texture
// (`tex`, keyed `<liquid>_<tex>` below). Fronts and open-air backs read the
// outside color; only trapped-air backs read the inside color — new liquids
// register a spec without framework forks. The open-air backs additionally
// honor an entry-level `insideRole` {opacity, transparent, fog} override
// (the diver's window; color and texture stay the outside sheet's), so the
// eye inside the liquid can see out while the exterior reads solid.
const ROLE_STYLE = {
  outside: { side: THREE.FrontSide, spec: "outside", tex: "outside", depthWrite: true },
  inside: { side: THREE.BackSide, spec: "outside", tex: "outside", depthWrite: true },
  pocket: { side: THREE.BackSide, spec: "inside", tex: "inside", depthWrite: true },
};
function liquidSpec(id, specKey) {
  const entry = liquidSpecById.get(id) || liquidSpecById.get(WATER);
  return { ...LIQUID_DEFAULTS[specKey], ...(entry[specKey] || {}) };
}
// Paint one texture per liquid × role from the registry above, keyed
// `<key>_<role>`.
for (const entry of LIQUID_SURFACE) {
  const outSpec = { ...LIQUID_DEFAULTS.outside, ...(entry.outside || {}) };
  const inSpec = { ...LIQUID_DEFAULTS.inside, ...(entry.inside || {}) };
  TEX[entry.key + "_outside"] = makeTex(hexToRgb(outSpec.color), outSpec.grain);
  TEX[entry.key + "_inside"] = makeTex(hexToRgb(inSpec.color), inSpec.grain);
}
// Blue lava keeps its speckled fire texture instead of flat grain.
TEX.lava_outside = canvasTex((ctx) => {
  ctx.fillStyle = "#1d1d5e"; ctx.fillRect(0, 0, 16, 16);
  pxNoise(ctx, [29, 29, 94], 26);
  ctx.fillStyle = "#3b3bd4";
  for (let i = 0; i < 12; i++) ctx.fillRect(Math.random() * 16, Math.random() * 16, 1, 1);
  ctx.fillStyle = "#57e0ff";
  for (let i = 0; i < 6; i++) ctx.fillRect(Math.random() * 15, Math.random() * 15, 1, 2);
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 5; i++) ctx.fillRect(Math.random() * 15, Math.random() * 15, 1, 1);
});
TEX.lava = TEX.lava_outside;
TEX.water = TEX.water_outside;

// One unlit canvas per glowstone variant, derived from the registry above;
// the shared `glowstone` texture (hotbar icon) is the icon variant.
export const GLOW_TEX = GLOW_VARIANTS.map((spec) => {
  const base = spec.flat ? spec.base : liftGlow(spec.base, spec.lift, spec.thresh);
  const bright = spec.flat ? spec.bright : liftGlow(spec.bright, spec.lift, spec.thresh);
  return canvasTex((ctx) => drawGlowMesh(ctx, {
    bright: `rgb(${bright[0]},${bright[1]},${bright[2]})`,
    noise: base,
  }));
});
TEX.glowstone = GLOW_TEX[GLOW_ICON_VARIANT];
const liquidMatCache = new Map();
export function liquidSurfaceMat(id, role) {
  const k = id + ":" + role;
  if (!liquidMatCache.has(k)) {
    const entry = liquidSpecById.get(id) || liquidSpecById.get(WATER);
    const style = ROLE_STYLE[role];
    const spec = liquidSpec(id, style.spec);
    const roleOver = role === "inside" ? insideRoleStyle(id) : {};
    // Per-liquid pocket override (lava only): trapped-air backs may reuse
    // another role's motif at their own opacity instead of the inside
    // grain — same texture object, so shared, region and veil materials
    // follow with no per-material walk.
    const pock = role === "pocket" ? entry.pocket || {} : {};
    const texKey = entry.key + "_" + (pock.tex ?? style.tex);
    liquidMatCache.set(k, new THREE.MeshBasicMaterial({
      map: TEX[texKey],
      transparent: roleOver.transparent ?? spec.transparent ?? true,
      opacity: roleOver.opacity ?? pock.opacity ?? spec.opacity,
      depthWrite: style.depthWrite,
      side: style.side,
      fog: liquidFogOverride.has(id) ? liquidFogOverride.get(id) : roleFog(id, role, null),
    }));
  }
  return liquidMatCache.get(k);
}

// One shared unlit material set per glowstone variant (MeshBasicMaterial,
// fog-free: the stone shines at full strength from any distance). The mesher fans glowstone blocks out by variant; the default
// icon variant below doubles as the hotbar icon and the materialsFor fallback.
const glowMatCache = new Map();
export function glowstoneMats(v) {
  if (!glowMatCache.has(v)) glowMatCache.set(v, basicFace(GLOW_TEX[v], { fog: false }));
  return glowMatCache.get(v);
}

// Pad-corner ghost materials: one shared unlit set per ghost variant, reusing
// the red/yellow look (same canvas texture as the base variant) but fogged
// (fog:true) and transparent so the distance fade reads — full strength up
// close, gone with distance/fog. Only ever built for ghost variants (every
// caller gates on isPadGhostVariant); normal variants keep glowstoneMats.
const ghostMatCache = new Map();
export function ghoststoneMats(v) {
  if (!isPadGhostVariant(v)) return glowstoneMats(v); // normals never take the ghost branch
  if (!ghostMatCache.has(v)) {
    ghostMatCache.set(v, basicFace(GLOW_TEX[padGhostBaseVariant(v)], { fog: true, transparent: true }));
  }
  return ghostMatCache.get(v);
}
// Per-frame distance fade: the mesher drives the shared ghost materials from
// the camera distance (see tickPadGhostFade). Depth writes stay on at full
// opacity so near ghosts composite like opaque cubes, off once fading.
export function setGhostOpacity(v, o) {
  const m = ghostMatCache.get(v);
  if (!m) return;
  for (const mm of m) {
    mm.opacity = o;
    mm.depthWrite = o >= 0.99;
  }
}

// Moon rock: lit Lambert so glowstone pools read on it, plus an emissive
// copy of the same texture (0.9) so faces away from the sun (notably the
// underside) stay readable instead of going black.
let moonMatsCache = null;
export function moonMats() {
  if (!moonMatsCache) {
    const m = new THREE.MeshLambertMaterial({
      map: TEX.moon, emissiveMap: TEX.moon,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9, fog: false,
    });
    moonMatsCache = [m, m, m, m, m, m];
  }
  return moonMatsCache;
}

export function faceTex(map, opts = {}) {  return [material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts)];
}

function basicFace(map, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ map, ...opts });
  return [m, m, m, m, m, m];
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z
export function materialsFor(id) {
  switch (id) {
    case GRASS: {
      const side = material(TEX.grass_side);
      return [side, side, material(TEX.grass_top), material(TEX.dirt), side, side];
    }
    case DIRT: return faceTex(TEX.dirt);
    case STONE: return faceTex(TEX.stone);
    case SAND: return faceTex(TEX.sand);
    case LOG: {
      const s = material(TEX.log_side), t = material(TEX.log_top);
      return [s, s, t, t, s, s];
    }
    case LEAVES: return faceTex(TEX.leaves);
    case PLANKS: return faceTex(TEX.planks);
    case GLASS: return faceTex(TEX.glass, { transparent: true, opacity: 0.8, depthWrite: false });
    case WATER: return faceTex(TEX.water, { transparent: true, opacity: 0.65, depthWrite: false });
    case FLOWER: return faceTex(TEX.flower, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    case TNT:
      return [material(TEX.tnt_side), material(TEX.tnt_side), material(TEX.tnt_top), material(TEX.tnt_top), material(TEX.tnt_side), material(TEX.tnt_side)];
    case MEGA_TNT:
      return [material(TEX.mega_side), material(TEX.mega_side), material(TEX.mega_top), material(TEX.mega_top), material(TEX.mega_side), material(TEX.mega_side)];
    case ULTRA_TNT:
      return [material(TEX.ultra_side), material(TEX.ultra_side), material(TEX.ultra_top), material(TEX.ultra_top), material(TEX.ultra_side), material(TEX.ultra_side)];
    case PORTAL: return faceTex(TEX.portal);
    case ENDSTONE: return faceTex(TEX.endstone);
    case CLOUD: return faceTex(TEX.cloud);
    case MOON: return moonMats();
    case MOON_WATER: return basicFace(TEX.moonwater_outside, { fog: false });
    case GLOWSTONE: return glowstoneMats(GLOW_ICON_VARIANT);
    case OBSIDIAN: return faceTex(TEX.obsidian);
    case LAVA: return basicFace(TEX.lava, { fog: false });
    case NETHERRACK: return faceTex(TEX.netherrack);
    case SOULSAND: return faceTex(TEX.soulsand);
    case HULL: return faceTex(TEX.hull);
    case HULL_ACCENT: return faceTex(TEX.hull_orange);
    case THRUSTER: return faceTex(TEX.thruster);
    case PAD: return faceTex(TEX.pad);
    default: return faceTex(TEX.dirt);
  }
}
