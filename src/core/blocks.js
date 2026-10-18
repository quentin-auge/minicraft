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
// Append-only ids: 22 shipped as mega (placeable), 23 reserved for ultra.
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
  [GLOWSTONE]: { name: "Glowstone", solid: true, opaque: true, placeable: true, light: "glowstone" },
};

export function isSolidId(id) {
  const info = BLOCK_INFO[id];
  return !!info && info.solid;
}

export function isLiquid(id) {
  return id === WATER || id === LAVA || id === MOON_WATER;
}

export function isTntLike(id) {
  return id === TNT || id === MEGA_TNT;
}
