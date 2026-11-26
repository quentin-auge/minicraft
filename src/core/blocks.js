// Block ids and static block metadata.
// New dimensions (Nether/End) reuse these ids plus their own additions;
// keep ids stable so future blocks only append.
export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const LOG = 5;
export const LEAVES = 6;
export const WATER = 7;
export const PLANKS = 8;
export const GLASS = 9;
export const TNT = 10;
// Append-only ids: 22 shipped as mega, 23 as ultra (both placeable).
export const MEGA_TNT = 22;
export const ULTRA_TNT = 23;
export const FLOWER = 11;
export const PORTAL = 12;
export const ENDSTONE = 13;
export const CLOUD = 14;
export const OBSIDIAN = 15;
export const LAVA = 16;
export const NETHERRACK = 17;
export const SOULSAND = 18;
export const MOON = 19;
export const GLOWSTONE = 20;
export const MOON_WATER = 21;
// Planets: one rock + one water per glowstone color, shared across every
// planet of that color (per-planet identity is positional — the cylinder a
// voxel sits in — never id-based, so 7 couples cover any planet count).
export const PLANET_ROCKS = [29, 31, 33, 35, 37, 39, 41];
export const PLANET_WATERS = [30, 32, 34, 36, 38, 40, 42];
// Celestial body ids (Moon + planet rocks/waters).
const BODY_IDS = new Set([MOON, MOON_WATER, ...PLANET_ROCKS, ...PLANET_WATERS]);
export function isBodyId(id) {
  return BODY_IDS.has(id);
}
// Rocket family (worldgen only): white/orange hull, dark thruster nozzles,
// and the hazard-plate launch pad. Windows reuse the stock GLASS block.
export const HULL = 24;
export const HULL_ACCENT = 25;
export const THRUSTER = 27;
export const PAD = 28;

export const BLOCK_INFO = {
  [GRASS]: { name: "Grass", solid: true, opaque: true, placeable: true },
  [DIRT]: { name: "Dirt", solid: true, opaque: true, placeable: true },
  [STONE]: { name: "Stone", solid: true, opaque: true, placeable: true },
  [SAND]: { name: "Sand", solid: true, opaque: true, placeable: true },
  [LOG]: { name: "Log", solid: true, opaque: true, placeable: true },
  [LEAVES]: { name: "Leaves", solid: true, opaque: true, placeable: true },
  [WATER]: { name: "Water", solid: false, opaque: false, placeable: true },
  [PLANKS]: { name: "Planks", solid: true, opaque: true, placeable: true },
  [GLASS]: { name: "Glass", solid: true, opaque: false, placeable: true },
  [TNT]: { name: "TNT", solid: true, opaque: true, placeable: true },
  [MEGA_TNT]: { name: "Mega TNT", solid: true, opaque: true, placeable: true },
  [ULTRA_TNT]: { name: "Ultra TNT", solid: true, opaque: true, placeable: true },
  [FLOWER]: { name: "Flower", solid: false, opaque: false, placeable: true },
  // Opaque despite the glow: the texture is fully solid, so meshing must
  // cull neighbor faces and liquid sheets against it like any solid wall —
  // otherwise coplanar sheets shimmer at the contact while moving.
  [PORTAL]: { name: "Portal", solid: true, opaque: true, placeable: true },
  [ENDSTONE]: { name: "End Stone", solid: true, opaque: true, placeable: false },
  [CLOUD]: { name: "Cloud", solid: true, opaque: true, placeable: false },
  [OBSIDIAN]: { name: "Obsidian", solid: true, opaque: true, placeable: true },
  [LAVA]: { name: "Lava", solid: false, opaque: false, placeable: true },
  [NETHERRACK]: { name: "Netherrack", solid: true, opaque: true, placeable: true },
  [SOULSAND]: { name: "Soul Sand", solid: true, opaque: true, placeable: false },
  [MOON]: { name: "Moon", solid: true, opaque: true, placeable: false },
  [MOON_WATER]: { name: "Moon Water", solid: false, opaque: false, placeable: true },
  [GLOWSTONE]: { name: "Glowstone", solid: true, opaque: true, placeable: true },
  ...Object.fromEntries(PLANET_ROCKS.flatMap((id, i) => {
    const c = ["Green", "Red", "Blue", "Yellow", "Orange", "Purple", "Turquoise"][i];
    return [
      [id, { name: c + " Planet", solid: true, opaque: true, placeable: false }],
      [PLANET_WATERS[i], { name: c + " Planet Water", solid: false, opaque: false, placeable: true }],
    ];
  })),
  [HULL]: { name: "Hull", solid: true, opaque: true, placeable: false },
  [HULL_ACCENT]: { name: "Hull Accent", solid: true, opaque: true, placeable: false },
  [THRUSTER]: { name: "Thruster", solid: true, opaque: true, placeable: false },
  [PAD]: { name: "Launch Pad", solid: true, opaque: true, placeable: false },
};

export function isSolidId(id) {
  const info = BLOCK_INFO[id];
  return !!info && !!info.solid;
}

// sRGB triple to the renderer's linear working space (three r152+ decodes
// SRGBColorSpace textures on sample and lights in linear, so instance
// colors sampled from canvas texels must be converted or they read ~2x too
// bright next to the textured wall). Three-free and pure.
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Debris tint per block id (floats 0..1, matching the shipped textures):
// the carve debris samples the destroyed wall instead of reading gray.
// Liquids never carve, so they need no entry — absent ids fall back to gray.
export const BLOCK_DEBRIS_COLORS = {
  [GRASS]: [0.42, 0.69, 0.30],
  [DIRT]: [0.54, 0.35, 0.21],
  [STONE]: [0.55, 0.55, 0.55],
  [SAND]: [0.56, 0.42, 0.24],
  [LOG]: [0.42, 0.29, 0.18],
  [LEAVES]: [0.18, 0.49, 0.20],
  [PLANKS]: [0.73, 0.54, 0.31],
  [GLASS]: [0.80, 0.90, 0.95],
  [TNT]: [0.75, 0.22, 0.17],
  [MEGA_TNT]: [0.12, 0.25, 0.68],
  [ULTRA_TNT]: [0.06, 0.06, 0.08],
  [FLOWER]: [1.0, 0.82, 0.25],
  [PORTAL]: [0.23, 0.05, 0.42],
  [ENDSTONE]: [0.90, 0.91, 0.93],
  [CLOUD]: [1.0, 1.0, 1.0],
  [OBSIDIAN]: [0.06, 0.09, 0.16],
  [NETHERRACK]: [0.45, 0.20, 0.15],
  [SOULSAND]: [0.35, 0.25, 0.18],
  [MOON]: [0.60, 0.60, 0.63],
  [GLOWSTONE]: [1.0, 0.85, 0.40],
  [HULL]: [0.90, 0.90, 0.92],
  [HULL_ACCENT]: [0.87, 0.42, 0.14],
  [THRUSTER]: [0.17, 0.18, 0.21],
  [PAD]: [0.50, 0.50, 0.55],
  [PLANET_ROCKS[0]]: [0.20, 0.50, 0.29],
  [PLANET_ROCKS[1]]: [0.59, 0.20, 0.23],
  [PLANET_ROCKS[2]]: [0.25, 0.43, 0.78],
  [PLANET_ROCKS[3]]: [0.75, 0.63, 0.24],
  [PLANET_ROCKS[4]]: [0.75, 0.43, 0.17],
  [PLANET_ROCKS[5]]: [0.43, 0.25, 0.66],
  [PLANET_ROCKS[6]]: [0.16, 0.59, 0.63],
};

// Debris shading family: these ids render self-lit at the source (moon and
// planet rocks read Lambert + emissive 0.9, glowstone reads unlit), so their
// debris cubes must skip the Lambert shade and read unlit too — otherwise
// they fall dark where the wall stays readable. Every other carveable id
// shares the plain Lambert path.
export const BLOCK_DEBRIS_UNLIT = new Set([MOON, ...PLANET_ROCKS, GLOWSTONE]);

export function isLiquid(id) {
  return id === WATER || id === LAVA || id === MOON_WATER || PLANET_WATERS.includes(id);
}

export function isTntLike(id) {
  return id === TNT || id === MEGA_TNT || id === ULTRA_TNT;
}

// Highlight gate: the aim box reflects voxels only, never geometry. A
// geometric celestial pick (id AIR on a body cylinder, possibly outside the
// voxel volume entirely) stays fully actionable — remote place, grapple,
// body TNT — but draws no box.
export function shouldShowHighlight(hit) {
  return !!hit && hit.id !== AIR;
}
