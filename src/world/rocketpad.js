// Launch-pad extension of the village: corner site selection in the
// village square, flat pad, and the cube-built rocket stored as a local
// block grid. Three-free so the headless harness keeps working; the runtime
// in vehicles/rocket.js consumes `rocketSite` and moves the same grid.
import {
  AIR, GLASS, HULL, HULL_ACCENT, THRUSTER, PAD, GLOWSTONE,
} from "../core/blocks.js";
import { WORLD_RADIUS, WATER_LEVEL, protectCell } from "../core/store.js";
import { GLOW_VARIANTS, noteGlowstonePlace, noteGlowstonePlaceShared } from "./glowstone.js";

// Centered odd-width stages let the rocket taper to a true central voxel.
// The 7-wide base has a 5x5 cabin (5-high interior, floor y0, 1-thick
// walls y1..y6), an open top inside its orange perimeter ring, and a
// centered 3x4 door. The upper shell has
// glazed window bands and accent rings before its solid 1x1 tip.
// Stage coordinates are local and inclusive.
export const ROCKET_SPEC = {
  w: 7,
  d: 7,
  h: 18,
  cabin: { x0: 1, x1: 5, z0: 1, z1: 5, y0: 1, y1: 5 },
  capY: 6,
  stages: [
    { width: 5, y0: 7, y1: 11, glassY: [8, 9], accentY: [11] },
    { width: 3, y0: 12, y1: 14, accentY: [14] },
    { width: 1, y0: 15, y1: 17, solid: true, accentY: [17] },
  ],
  // Door on the local -Z wall, three blocks wide and four high, centered.
  // It always faces the village (see choosePadSite rotation).
  door: { x0: 2, x1: 4, y0: 1, y1: 4 },
};

export const PAD_SPEC = { w: 11, d: 11 };
// Ride box, derived from the hull spec (never hardcoded): hull + 1 margin
// cell in XZ, +1 cell on top, nothing below (9x19 for the 7x18 hull).
// Everything non-air inside travels with the rocket; side overhangs outside
// stay; the column above the box is destroyed at liftoff. Inclusive local
// bounds. Lives here (three-free) so the headless harness can assert it.
export const RIDE_BOX = {
  x0: -1, x1: ROCKET_SPEC.w, y0: 0, y1: ROCKET_SPEC.h, z0: -1, z1: ROCKET_SPEC.d,
};
// Boarding predicate for mob riders, three-free so the headless harness can
// assert it: local feet cell inside the ride box with air underfoot — a
// solid feet cell means hull wall, and the mob stays behind. Mobs are 1
// wide, so the single feet cell decides. The runtime boards at countdown
// start (exact standing spots, before any falling tick on the cleared
// floor) and re-checks every frame after (late boarders walk in mid-ride).
export function rideBoardable(lx, ly, lz, solid) {
  if (lx < RIDE_BOX.x0 || lx > RIDE_BOX.x1 || ly < RIDE_BOX.y0 || ly > RIDE_BOX.y1 || lz < RIDE_BOX.z0 || lz > RIDE_BOX.z1) return false;
  return !solid.has(lx + "," + ly + "," + lz);
}
// Corner lights, clockwise from the minimum/minimum corner.
export const PAD_LIGHTS = ["red", "yellow", "red", "yellow"];
const PAD_LIGHT_VARIANTS = PAD_LIGHTS.map((name) =>
  GLOW_VARIANTS.findIndex((v) => v.key === name));

// Last placed site, read by the runtime every tick while parked. `version`
// changes on every world build so the runtime can resync after a New World.
export const rocketSite = {
  placed: false,
  version: 0,
  origin: { x: 0, y: 0, z: 0 },
  rotation: 0,
  pad: null,
  grid: null,
  worldCells: [],
};

function rotatePoint(x, z, rot) {
  let rx = x, rz = z;
  for (let i = 0; i < rot; i++) {
    const nx = ROCKET_SPEC.w - 1 - rz;
    const nz = rx;
    rx = nx; rz = nz;
  }
  return [rx, rz];
}

function rotateBox(box, rot) {
  const pts = [
    rotatePoint(box.x0, box.z0, rot),
    rotatePoint(box.x1, box.z0, rot),
    rotatePoint(box.x0, box.z1, rot),
    rotatePoint(box.x1, box.z1, rot),
  ];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return {
    ...box,
    x0: Math.min(...xs), x1: Math.max(...xs),
    z0: Math.min(...zs), z1: Math.max(...zs),
  };
}

// Pure local grid builder. Rotation is a multiple of 90 degrees so the hull
// stays axis-aligned; rot0 keeps the door on -Z, rot1 faces +X, rot2 +Z,
// rot3 -X.
export function buildRocketGrid(rotation = 0) {
  const cells = new Map();
  const put = (x, y, z, id, flags = {}) => {
    if (x < 0 || x >= ROCKET_SPEC.w || z < 0 || z >= ROCKET_SPEC.d || y < 0 || y >= ROCKET_SPEC.h) return;
    cells.set(x + "," + y + "," + z, { x, y, z, id, ...flags });
  };

  // Cabin floor with four flush thruster nozzles at the base corners.
  for (let x = 0; x < ROCKET_SPEC.w; x++)
    for (let z = 0; z < ROCKET_SPEC.d; z++) put(x, 0, z, HULL, {});
  const last = ROCKET_SPEC.w - 1;
  for (const [x, z] of [[0, 0], [last, 0], [0, last], [last, last]]) put(x, 0, z, THRUSTER, {});

  // Cabin walls, leaving the 5x5x5 interior open; top row accent. No ceiling
  // slab, no glass floor: above the cabin only centered shell rings remain.
  const { x0, x1, z0, z1 } = ROCKET_SPEC.cabin;
  for (let y = 1; y <= ROCKET_SPEC.capY; y++)
    for (let x = 0; x < ROCKET_SPEC.w; x++)
      for (let z = 0; z < ROCKET_SPEC.d; z++) {
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) continue;
        put(x, y, z, y === ROCKET_SPEC.capY ? HULL_ACCENT : HULL, {});
      }

  // Stock-glass bands on every wall facing the cabin except the door face;
  // the door wall (z0) stays plain hull and the door stays open.
  for (let y = 2; y <= 4; y++) {
    for (let z = z0; z <= z1; z++) {
      put(0, y, z, GLASS, {});
      put(last, y, z, GLASS, {});
    }
    for (let x = x0; x <= x1; x++) put(x, y, last, GLASS, {});
  }
  for (let x = ROCKET_SPEC.door.x0; x <= ROCKET_SPEC.door.x1; x++)
    for (let y = ROCKET_SPEC.door.y0; y <= ROCKET_SPEC.door.y1; y++)
      cells.delete(x + "," + y + ",0");

  // Centered shell stages share one ring builder; only the 1x1 tip is solid.
  for (const stage of ROCKET_SPEC.stages) {
    const lo = (ROCKET_SPEC.w - stage.width) / 2;
    const hi = lo + stage.width - 1;
    for (let y = stage.y0; y <= stage.y1; y++)
      for (let x = lo; x <= hi; x++)
        for (let z = lo; z <= hi; z++) {
          const xEdge = x === lo || x === hi;
          const zEdge = z === lo || z === hi;
          if (!stage.solid && !xEdge && !zEdge) continue;
          const face = xEdge !== zEdge
            ? (xEdge ? (x === lo ? "-x" : "+x") : (z === lo ? "-z" : "+z"))
            : null;
          const window = stage.glassY?.includes(y) && face;
          const id = window ? GLASS : stage.accentY?.includes(y) ? HULL_ACCENT : HULL;
          put(x, y, z, id, {});
        }
  }

  const out = [...cells.values()].map((c) => {
    const [x, z] = rotatePoint(c.x, c.z, rotation);
    return { x, y: c.y, z, id: c.id };
  });
  const center = (ROCKET_SPEC.w - 1) / 2;
  const [sx, sz] = rotatePoint(center, center, rotation);
  return {
    rotation,
    cells: out,
    cabin: rotateBox(ROCKET_SPEC.cabin, rotation),
    door: rotateBox({ ...ROCKET_SPEC.door, z0: 0, z1: 0 }, rotation),
    stand: { x: sx, y: 1, z: sz },
  };
}

// Pad site: systematically in a village-square corner, one clear cell off
// the corner, scored flat like the village center pick (flattest of the
// four wins). The door faces the village center along the dominant axis.
// Returns null when no corner fits inside the world.
export function choosePadSite(heightAt, cx, cz, radius, vy) {
  const cands = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const minX = sx > 0 ? cx + radius + 2 : cx - radius - 2 - PAD_SPEC.w + 1;
    const minZ = sz > 0 ? cz + radius + 2 : cz - radius - 2 - PAD_SPEC.d + 1;
    cands.push({ minX, maxX: minX + PAD_SPEC.w - 1, minZ, maxZ: minZ + PAD_SPEC.d - 1 });
  }
  const B = WORLD_RADIUS - 2;
  let best = null;
  for (const c of cands) {
    if (c.minX < -B || c.maxX > B || c.minZ < -B || c.maxZ > B) continue;
    const pcx = Math.round((c.minX + c.maxX) / 2), pcz = Math.round((c.minZ + c.maxZ) / 2);
    const h = heightAt(pcx, pcz);
    let lo = h, hi = h;
    for (const [x, z] of [[c.minX, c.minZ], [c.maxX, c.minZ], [c.minX, c.maxZ], [c.maxX, c.maxZ]]) {
      const v = heightAt(x, z);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const wet = h <= WATER_LEVEL ? 30 : 0;
    const score = Math.abs(h - vy) * 2 + (hi - lo) * 3 + wet;
    if (!best || score < best.score) best = { ...c, cx: pcx, cz: pcz, vy, score };
  }
  if (!best) return null;
  const dx = cx - best.cx, dz = cz - best.cz;
  let rot = 0;
  if (Math.abs(dx) > Math.abs(dz)) rot = dx > 0 ? 1 : 3;
  else rot = dz > 0 ? 2 : 0;
  return { ...best, rot };
}

// Place the flat pad and the parked rocket, remembering every cell so the
// runtime can snapshot/unprotect it on liftoff. Runs after terrain fill;
// clears headroom for the full hull height.
export function placeRocketSite(setBlock, getBlock, pad) {
  if (!pad) return;
  rocketSite.placed = false;
  rocketSite.worldCells.length = 0;
  const vy = pad.vy;
  // Hazard plate: accent frame with red/yellow corner glowstones.
  for (let x = pad.minX; x <= pad.maxX; x++) {
    for (let z = pad.minZ; z <= pad.maxZ; z++) {
      const edge = x === pad.minX || x === pad.maxX || z === pad.minZ || z === pad.maxZ;
      const corner = (x === pad.minX || x === pad.maxX) && (z === pad.minZ || z === pad.maxZ);
      const cornerV = corner
        ? (x === pad.minX ? (z === pad.minZ ? 0 : 1) : (z === pad.maxZ ? 2 : 3))
        : -1;
      const id = corner ? GLOWSTONE : edge ? HULL_ACCENT : PAD;
      setBlock(x, vy, z, id);
      if (corner) noteGlowstonePlaceShared(x, vy, z, PAD_LIGHT_VARIANTS[cornerV]);
      else if (id === GLOWSTONE) noteGlowstonePlace(x, vy, z);
      protectCell(x, vy, z);
      for (let y = vy + 1; y <= vy + ROCKET_SPEC.h + 1; y++) if (getBlock(x, y, z) !== AIR) setBlock(x, y, z, AIR);
    }
  }
  const grid = buildRocketGrid(pad.rot ?? 0);
  // Rocket centered on the 11x11 plate (7-wide hull, 2-cell margins).
  const marginX = Math.floor((PAD_SPEC.w - ROCKET_SPEC.w) / 2);
  const marginZ = Math.floor((PAD_SPEC.d - ROCKET_SPEC.d) / 2);
  const origin = {
    x: pad.minX + marginX,
    y: vy + 1,
    z: pad.minZ + marginZ,
  };
  for (const c of grid.cells) {
    const x = origin.x + c.x, y = origin.y + c.y, z = origin.z + c.z;
    setBlock(x, y, z, c.id);
    if (c.id === GLOWSTONE) noteGlowstonePlace(x, y, z);
    protectCell(x, y, z);
    rocketSite.worldCells.push([x, y, z]);
  }
  rocketSite.placed = true;
  rocketSite.version++;
  rocketSite.origin = origin;
  rocketSite.rotation = pad.rot ?? 0;
  rocketSite.pad = pad;
  rocketSite.grid = grid;
}
