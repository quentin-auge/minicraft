// Launch-pad extension of the village: corner site selection, flat pads,
// and the cube-built rocket stored as a local block grid. Three-free so the
// headless harness keeps working; the runtime in vehicles/rocket.js consumes
// the registries below and moves the resolved ships.
//
// Rule-based vessels (see ARCHITECTURE.md):
// - Takeoff boxes are per-pad: the black interior (inset 1) x 20 rows above
//   the plate. Pads never overlap (fail-fast at registration) and share one
//   look at any size.
// - Flyable = any non-air block (solids, liquids, flowers, portal frames),
//   connected by the 18-neighbourhood (6 faces + 12 edges, corners join
//   nothing). Pad plates never fly and no longer conduct the flood.
// - Every 18-connected component intersecting a takeoff box is independently
//   pilotable (union on the pad: one fresh record); off-pad each parked
//   vessel keeps its own box and steals overlapping cells (with full split).
// - Boxes are tight 0-margin at takeoff/fusion and only ever shrink
//   (tight auto, origin = min). 0 blocks = record removed.
import {
  AIR, GLASS, HULL, HULL_ACCENT, THRUSTER, PAD, GLOWSTONE, FLOWER, isLiquid,
} from "../core/blocks.js";
import { WORLD_RADIUS, WATER_LEVEL, protectCell } from "../core/store.js";
import { noteGlowstonePlaceShared, PAD_GHOST_VARIANTS } from "./glowstone.js";

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
// Takeoff-area height above the pad plate, in rows: 20 rows of air over the
// black interior (plate excluded). A pad needs w>=3 and d>=3, else its box
// is empty and nothing there is ever pilotable.
export const PAD_TAKEOFF_H = 20;
// Boarding predicate for mob riders, three-free so the headless harness can
// assert it: every mob inside the vessel box boards, whatever it stands on,
// plus mobs standing on the hull (feet on the top face with hull under them).
// Mobs are 1 wide, so the feet cell decides. The runtime boards at countdown
// start (exact standing spots, before any falling tick on the cleared
// floor) and re-checks every frame after (late boarders walk in mid-ride).
export function rideBoardable(lx, ly, lz, solid, bounds) {
  if (lx >= bounds.x0 && lx <= bounds.x1 && ly >= bounds.y0 && ly <= bounds.y1 && lz >= bounds.z0 && lz <= bounds.z1) return true;
  // Standing on the hull: feet one above the box top, inside the footprint,
  // with hull under the feet. Open cabin tops and door voids refuse here —
  // the fall-in boards through the in-box rule a tick later.
  if (ly === bounds.y1 + 1 && lx >= bounds.x0 && lx <= bounds.x1 && lz >= bounds.z0 && lz <= bounds.z1
    && solid?.has(lx + "," + bounds.y1 + "," + lz)) return true;
  return false;
}
// Face-or-edge connectivity (18-neighbourhood): component enumeration and
// flood expansion share it; corner contact (three axes offset) joins nothing.
const SUPPORT_FLOOD_GUARD = 30000;
const SUPPORT_FACE_NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SUPPORT_EDGE_NB = [
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
];
const SUPPORT_NB = SUPPORT_FACE_NB.concat(SUPPORT_EDGE_NB);
// Flyable: any non-air block, with no distinction (solids, liquids, flowers,
// portal frames). Pad plates are not flyable: they arrive via `exclude` and
// are skipped below.
export function isFlyableId(id) {
  return id !== AIR;
}
// The shared 18-neighbourhood expansion: one rule, one implementation, used
// by both floods below. Queue every flyable neighbour of (x,y,z) that is
// inside the box and not excluded. Returns false when the guard trips, so
// the caller stops the flood.
function expandNeighbours(getBlock, queue, seen, inBox, blocked, x, y, z) {
  for (const [dx, dy, dz] of SUPPORT_NB) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (ny < 0 || !inBox(nx, ny, nz)) continue;
    const k = nx + "," + ny + "," + nz;
    if (seen.has(k) || blocked(nx, ny, nz)) continue;
    if (!isFlyableId(getBlock(nx, ny, nz))) continue;
    if (seen.size > SUPPORT_FLOOD_GUARD) return false;
    seen.add(k);
    queue.push([nx, ny, nz]);
  }
  return true;
}
// Connected components, three-free: 18-neighbourhood (6 faces + 12 edges,
// never corners) over flyable cells clamped to the given world box.
// `exclude` (world keys: every pad plate) is wall: excluded cells never ride
// and no longer conduct the flood. Guarded; the guard is the pagination
// point if a future pad ever outgrows it (today's boxes are far below it).
export function floodComponents(getBlock, box, exclude = null) {
  const inBox = (x, y, z) =>
    x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1;
  const blocked = (x, y, z) => exclude?.has(x + "," + y + "," + z) ?? false;
  const seen = new Set();
  const comps = [];
  const visit = (sx, sy, sz) => {
    const comp = [];
    const queue = [[sx, sy, sz]];
    seen.add(sx + "," + sy + "," + sz);
    for (let i = 0; i < queue.length; i++) {
      const [x, y, z] = queue[i];
      comp.push([x, y, z]);
      if (!expandNeighbours(getBlock, queue, seen, inBox, blocked, x, y, z)) return comp;
    }
    return comp;
  };
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++)
      for (let z = box.z0; z <= box.z1; z++) {
        const k = x + "," + y + "," + z;
        if (seen.has(k) || blocked(x, y, z)) continue;
        if (!isFlyableId(getBlock(x, y, z))) continue;
        if (seen.size > SUPPORT_FLOOD_GUARD) return comps;
        comps.push(visit(x, y, z));
      }
  return comps;
}
// Single-component flood: the component holding the seed cells, or [] when
// the seeds stand on nothing flyable.
export function floodShipCells(getBlock, seeds, box, exclude = null) {
  const inBox = (x, y, z) =>
    x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1;
  const blocked = (x, y, z) => exclude?.has(x + "," + y + "," + z) ?? false;
  const seen = new Set();
  const queue = [];
  for (const [sx, sy, sz] of seeds) {
    if (!inBox(sx, sy, sz) || blocked(sx, sy, sz)) continue;
    const k = sx + "," + sy + "," + sz;
    if (seen.has(k)) continue;
    if (!isFlyableId(getBlock(sx, sy, sz))) continue;
    seen.add(k);
    queue.push([sx, sy, sz]);
  }
  const cells = [];
  for (let i = 0; i < queue.length; i++) {
    const [x, y, z] = queue[i];
    if (seen.size > SUPPORT_FLOOD_GUARD) return cells;
    cells.push([x, y, z]);
    if (!expandNeighbours(getBlock, queue, seen, inBox, blocked, x, y, z)) return cells;
  }
  return cells;
}
// Vessel box, three-free: world min/max bounds of the ship cells, or null
// when empty (no takeoff).
export function shipBounds(cells) {
  if (!cells.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, y, z] of cells) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, x1, y0, y1, z0, z1 };
}
// Takeoff gate (three-free): the launch is its own gesture, never a side
// effect of flying or hopping — the pilot must be stopped on a ship, not
// mid-air in fly mode and not mid-jump. The vessel side of the gate stays
// in pickUnderFeet; the rocket wires both halves together.
export function takeoffAllowed({ flying = false, jumping = false } = {}) {
  return !flying && !jumping;
}
// Takeoff seed under the pilot's feet: feet sunk in a solid wall are not
// standing on anything (null); else the support cell below when it is
// flyable (solid, liquid or flower alike); else the feet cell itself when
// the pilot stands inside liquid or flowers. Returns the seed or null.
export function takeoffSeed(getBlock, fx, fy, fz) {
  const fid = getBlock(fx, fy, fz);
  if (fid !== AIR && !isLiquid(fid) && fid !== FLOWER) return null;
  const sid = getBlock(fx, fy - 1, fz);
  if (isFlyableId(sid)) return [fx, fy - 1, fz];
  if (fid !== AIR && isFlyableId(fid)) return [fx, fy, fz];
  return null;
}
// World-space box of a parked vessel (origin + local box).
export function vesselWorldBox(v) {
  return {
    x0: v.ox + v.box.x0, x1: v.ox + v.box.x1,
    y0: v.oy + v.box.y0, y1: v.oy + v.box.y1,
    z0: v.oz + v.box.z0, z1: v.oz + v.box.z1,
  };
}
// Integer cells overlapped by a float-placed box (three-free): the visual
// hull `[o+box, o+box+1)` overlaps `floor`..`ceil-1`, i.e. one extra row
// past the floored box whenever the origin is fractional. The old
// `floor(o)+box` read missed that fringe, leaving wall remnants at speed.
export function sweptBoxCells(ox, oy, oz, box) {
  return {
    x0: Math.floor(ox + box.x0), x1: Math.ceil(ox + box.x1 + 1) - 1,
    y0: Math.floor(oy + box.y0), y1: Math.ceil(oy + box.y1 + 1) - 1,
    z0: Math.floor(oz + box.z0), z1: Math.ceil(oz + box.z1 + 1) - 1,
  };
}
// Terminal descent carve box (three-free): the x/z of the posed integer
// box at floor(o) — the bbox once landed — with the swept y range kept.
// A fractional descending hull visually overlaps one fringe column past its
// landed box; carving it would eat a wall row the posed ship never touches
// (diagonal-low cliff/house landings). Level flight and climbs keep the
// full swept box so fast shafts stay complete; only the descent clamps.
export function terminalCarveBox(ox, oy, oz, box) {
  return {
    x0: Math.floor(ox) + box.x0, x1: Math.floor(ox) + box.x1,
    y0: Math.floor(oy + box.y0), y1: Math.ceil(oy + box.y1 + 1) - 1,
    z0: Math.floor(oz) + box.z0, z1: Math.floor(oz) + box.z1,
  };
}
// Descent-aware flight carve box (three-free): the posed x/z box while
// descending, the full swept box otherwise — one selector behind the
// systematic carve and its blocked-lateral fallback, so the two cannot drift.
export function flightCarveBox(ox, oy, oz, box, descending = false) {
  return descending ? terminalCarveBox(ox, oy, oz, box) : sweptBoxCells(ox, oy, oz, box);
}
// Pad registry, three-free: every landing area is one record
// `{id, minX, maxX, minZ, maxZ, vy, rot, ...}`. Pads never overlap
// (fail-fast at registration); the takeoff box follows each pad's own size.
// Overworld-only, wiped on New World with everything else.
export const pads = new Map();
let nextPadId = 1;
export function resetPads() {
  pads.clear();
  nextPadId = 1;
}
export function registerPad(def) {
  const { minX, maxX, minZ, maxZ, vy } = def;
  for (const p of pads.values()) {
    if (minX <= p.maxX && maxX >= p.minX && minZ <= p.maxZ && maxZ >= p.minZ) {
      throw new Error(`pad overlaps ${p.id}`);
    }
  }
  const id = "p" + (nextPadId++);
  const pad = { id, ...def, minX, maxX, minZ, maxZ, vy, rot: def.rot ?? 0 };
  pads.set(id, pad);
  return pad;
}
export function listPads() {
  return [...pads.values()];
}
// Takeoff box of one pad: the black interior (inset 1) x PAD_TAKEOFF_H rows
// above the plate. Too-narrow pads (w<3 or d<3) yield an empty box: nothing
// there is ever pilotable, by construction instead of by refusal.
export function takeoffBox(pad) {
  const box = {
    x0: pad.minX + 1, x1: pad.maxX - 1,
    y0: pad.vy + 1, y1: pad.vy + PAD_TAKEOFF_H,
    z0: pad.minZ + 1, z1: pad.maxZ - 1,
  };
  if (box.x0 > box.x1 || box.z0 > box.z1) return null;
  return box;
}
// Vessel registry, three-free: every parked ship is one record
// `{id, status, ox, oy, oz, cells:[{lx,ly,lz}], box}`. The original rocket
// registers as v1 at worldgen; takeoffs move their record with the ship,
// pad creations register fresh, landings update origin+box. Overworld-only,
// wiped on New World with everything else.
export const vessels = new Map();
let nextVesselId = 1;
export function resetVessels() {
  vessels.clear();
  nextVesselId = 1;
}
export function registerVessel({ ox, oy, oz, cells, box, status = "parked" }) {
  const id = "v" + (nextVesselId++);
  const v = { id, status, ox, oy, oz, cells, box };
  vessels.set(id, v);
  return v;
}
export function updateVessel(id, patch) {
  const v = vessels.get(id);
  if (v) Object.assign(v, patch);
  return v;
}
export function removeVessel(id) {
  vessels.delete(id);
}
export function listVessels() {
  return [...vessels.values()];
}
// Tight re-box of live world cells under a frame: origin = min, box 0-based.
function reframeCells(worldCells) {
  const wb = shipBounds(worldCells);
  const ox = wb.x0, oy = wb.y0, oz = wb.z0;
  return {
    ox, oy, oz,
    cells: worldCells.map(([x, y, z]) => ({ lx: x - ox, ly: y - oy, lz: z - oz })),
    box: { x0: 0, x1: wb.x1 - ox, y0: 0, y1: wb.y1 - oy, z0: 0, z1: wb.z1 - oz },
  };
}
// Refresh one parked record against live voxels: 0 components remove it,
// 1 tightens it (origin = min), N split it (first keeps the id, the rest
// mint fresh ids). Returns the surviving records.
export function refreshVessel(getBlock, v, exclude = null) {
  const box = vesselWorldBox(v);
  const kept = [];
  for (const comp of floodComponents(getBlock, box, exclude)) {
    const has = comp.filter(([x, y, z]) => getBlock(x, y, z) !== AIR);
    if (has.length) kept.push(has);
  }
  if (!kept.length) {
    vessels.delete(v.id);
    return [];
  }
  const out = [];
  kept.forEach((comp, i) => {
    const r = reframeCells(comp);
    if (i === 0) {
      Object.assign(v, { ox: r.ox, oy: r.oy, oz: r.oz, cells: r.cells, box: r.box });
      out.push(v);
    } else {
      out.push(registerVessel({ ox: r.ox, oy: r.oy, oz: r.oz, cells: r.cells, box: r.box }));
    }
  });
  return out;
}
// Sweep the registry against live voxels (three-free): parked records whose
// cells were eaten (hand mining, blasts, steals, landing carves) shrink to
// survivors, split when cut in two, and vanish when empty. Lazy by design:
// the rocket tick runs it before every gate, so it stays exact at the
// player's reaction scale with no per-edit hook.
export function refreshAllVessels(getBlock, exclude = null) {
  const out = [];
  for (const v of [...vessels.values()]) {
    if (v.status !== "parked") continue;
    out.push(...refreshVessel(getBlock, v, exclude));
  }
  return out;
}
// Steal every live cell of the flying set out of the other parked records:
// the donors shrink (and split when cut). The takeoff record itself keeps
// its resolved cells; the runtime overwrites it right after.
export function stealCellsFromVessels(getBlock, flyingKeys, exceptId = null, exclude = null) {
  for (const v of [...vessels.values()]) {
    if (v.status !== "parked" || v.id === exceptId) continue;
    const before = v.cells.length;
    const worlds = v.cells.map((c) => [v.ox + c.lx, v.oy + c.ly, v.oz + c.lz]);
    if (!worlds.some(([x, y, z]) => flyingKeys.has(x + "," + y + "," + z))) continue;
    const rest = worlds.filter(([x, y, z]) => !flyingKeys.has(x + "," + y + "," + z));
    if (!rest.length) {
      vessels.delete(v.id);
      continue;
    }
    const r = reframeCells(rest.filter(([x, y, z]) => getBlock(x, y, z) !== AIR));
    if (!r.cells.length) { vessels.delete(v.id); continue; }
    Object.assign(v, { ox: r.ox, oy: r.oy, oz: r.oz, cells: r.cells, box: r.box });
    if (r.cells.length < before) refreshVessel(getBlock, v, exclude);
  }
}
// A parked vessel's position against the takeoff boxes: "straddling" means
// the vessel intersects a box without being fully contained by it. Such a
// vessel keeps its own box and id — the pad never cuts it — while a vessel
// fully inside a box unions with the pad and one disjoint from every box
// stays independent. Only the straddling case drives behavior.
export function vesselStraddles(v, tboxes) {
  const b = vesselWorldBox(v);
  let hit = false;
  for (const t of tboxes) {
    if (!t) continue;
    const contained = b.x0 >= t.x0 && b.x1 <= t.x1 && b.y0 >= t.y0 && b.y1 <= t.y1 && b.z0 >= t.z0 && b.z1 <= t.z1;
    if (contained) return false;
    if (!(b.x1 < t.x0 || b.x0 > t.x1 || b.y1 < t.y0 || b.y0 > t.y1 || b.z1 < t.z0 || b.z0 > t.z1)) hit = true;
  }
  return hit;
}
// World keys owned by the straddling parked vessels: walls to the pad
// flood (like plates — never ridden, never conducting), so a pad liftoff
// can never amputate a vessel parked across the boundary.
export function straddlingCells(ctxVessels, tboxes) {
  const out = new Set();
  for (const v of ctxVessels) {
    if (v.status !== "parked" || !vesselStraddles(v, tboxes)) continue;
    for (const c of v.cells) out.add((v.ox + c.lx) + "," + (v.oy + c.ly) + "," + (v.oz + c.lz));
  }
  return out;
}
// Every 18-connected component intersecting a takeoff box is independently
// pilotable. Returns the offers (pad kind, fresh record at liftoff).
export function listPilotables(getBlock, ctx = {}) {
  const { pads: ctxPads = listPads(), vessels: ctxVessels = listVessels(), exclude = null } = ctx;
  const tboxes = ctxPads.map(takeoffBox);
  const walls = straddlingCells(ctxVessels, tboxes);
  const floodExclude = !exclude && !walls.size ? null
    : new Set([...(exclude ?? []), ...walls]);
  const offers = [];
  for (const pad of ctxPads) {
    const box = takeoffBox(pad);
    if (!box) continue;
    for (const comp of floodComponents(getBlock, box, floodExclude)) {
      if (!comp.length) continue;
      const wb = shipBounds(comp);
      offers.push({
        kind: "pad",
        padId: pad.id,
        vesselId: null,
        origin: { x: box.x0, y: box.y0, z: box.z0 },
        ship: comp,
        box: {
          x0: wb.x0 - box.x0, x1: wb.x1 - box.x0,
          y0: wb.y0 - box.y0, y1: wb.y1 - box.y0,
          z0: wb.z0 - box.z0, z1: wb.z1 - box.z0,
        },
      });
    }
  }
  return offers;
}
// The offer a parked vessel makes: its own frame (origin and box kept) and
// the cells it flies. Shared by the straddling and the off-pad paths.
function vesselOffer(v, ship) {
  const wbox = shipBounds(ship);
  return {
    kind: "vessel",
    padId: null,
    vesselId: v.id,
    origin: { x: v.ox, y: v.oy, z: v.oz },
    ship,
    box: {
      x0: wbox.x0 - v.ox, x1: wbox.x1 - v.ox,
      y0: wbox.y0 - v.oy, y1: wbox.y1 - v.oy,
      z0: wbox.z0 - v.oz, z1: wbox.z1 - v.oz,
    },
  };
}
// Overlapping vessels: the smallest box wins the seed.
function byBoxVolume(a, b) {
  const ba = vesselWorldBox(a), bb = vesselWorldBox(b);
  return ((ba.x1 - ba.x0 + 1) * (ba.y1 - ba.y0 + 1) * (ba.z1 - ba.z0 + 1))
    - ((bb.x1 - bb.x0 + 1) * (bb.y1 - bb.y0 + 1) * (bb.z1 - bb.z0 + 1));
}
// Takeoff pick: the component under the pilot's feet — a straddling vessel
// first (intersection: it keeps its box and id, never cut), then a pad
// offer (union), then the remaining parked vessels (intersection, clamped
// to the box, smallest wins overlaps). Returns the offer or null. Feet
// sunk in a solid wall stand on nothing.
export function pickUnderFeet(getBlock, fx, fy, fz, ctx = {}) {
  const { pads: ctxPads = listPads(), vessels: ctxVessels = listVessels(), exclude = null } = ctx;
  const seed = takeoffSeed(getBlock, fx, fy, fz);
  if (!seed) return null;
  const [sx, sy, sz] = seed;
  const tboxes = ctxPads.map(takeoffBox);
  const inBox = (b) => sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1 && sz >= b.z0 && sz <= b.z1;
  const straddlers = [];
  for (const v of ctxVessels) {
    if (v.status !== "parked" || !vesselStraddles(v, tboxes)) continue;
    if (inBox(vesselWorldBox(v))) straddlers.push(v);
  }
  straddlers.sort(byBoxVolume);
  for (const v of straddlers) {
    const ship = floodShipCells(getBlock, [[sx, sy, sz]], vesselWorldBox(v), exclude);
    if (!ship.length) continue;
    return vesselOffer(v, ship);
  }
  for (const offer of listPilotables(getBlock, ctx)) {
    if (offer.ship.some(([x, y, z]) => x === sx && y === sy && z === sz)) return offer;
  }
  const cands = [];
  for (const v of ctxVessels) {
    if (v.status !== "parked") continue;
    const b = vesselWorldBox(v);
    if (sx < b.x0 || sx > b.x1 || sy < b.y0 || sy > b.y1 || sz < b.z0 || sz > b.z1) continue;
    cands.push(v);
  }
  cands.sort(byBoxVolume);
  for (const v of cands) {
    const ship = floodShipCells(getBlock, [[sx, sy, sz]], vesselWorldBox(v), exclude);
    if (!ship.length) continue;
    return vesselOffer(v, ship);
  }
  return null;
}
// Headroom guard, three-free and purely geometric: a placement at
// (px,py,pz) is refused when the cell sits in 6-face contact with the TOP
// of a takeoff box (any pad, even empty — the pad headroom is always kept)
// or of an independent parked vessel (a parked box with no intersection
// with any takeoff box; flying records never count). Building up INSIDE a
// takeoff box stays allowed (it joins the union). Returns the blocking box
// or null. Stale registries fail safe: boxes only ever shrink, so a stale
// box over-refuses instead of leaking.
export function headroomBlocked(px, py, pz, ctx = {}) {
  const { pads: ctxPads = listPads(), vessels: ctxVessels = listVessels() } = ctx;
  const boxes = [];
  for (const pad of ctxPads) {
    const b = takeoffBox(pad);
    if (b) boxes.push(b);
  }
  for (const v of ctxVessels) {
    if (v.status !== "parked") continue;
    const b = vesselWorldBox(v);
    if (boxes.some((t) => !(b.x1 < t.x0 || b.x0 > t.x1 || b.y1 < t.y0 || b.y0 > t.y1 || b.z1 < t.z0 || b.z0 > t.z1))) continue;
    boxes.push({ ...b, vesselId: v.id });
  }
  for (const b of boxes) {
    if (px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1 && py === b.y1 + 1) {
      return b.vesselId ? { kind: "vessel", id: b.vesselId } : { kind: "pad" };
    }
  }
  return null;
}
// Corner lights, clockwise from the minimum/minimum corner: red, yellow,
// red, yellow (ghost variants, distance/fog-fading).
export const PAD_LIGHTS = ["red", "yellow", "red", "yellow"];
const PAD_LIGHT_GHOSTS = PAD_GHOST_VARIANTS;

// Last placed site, read by the runtime every tick while parked. `version`
// changes on every world build so the runtime can resync after a New World.
// The pad plate stays protected infrastructure; every hull is destructible
// (hand breaks and blasts eat it like any block). Compat view of pads p1:
// multi-pad code reads listPads()/takeoffBox() instead.
export const rocketSite = {
  placed: false,
  version: 0,
  origin: { x: 0, y: 0, z: 0 },
  rotation: 0,
  pad: null,
  grid: null,
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
// Returns null when no corner fits inside the world. Size follows PAD_SPEC
// (w/d overridable for future pads).
export function choosePadSite(heightAt, cx, cz, radius, vy, w = PAD_SPEC.w, d = PAD_SPEC.d) {
  const cands = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const minX = sx > 0 ? cx + radius + 2 : cx - radius - 2 - w + 1;
    const minZ = sz > 0 ? cz + radius + 2 : cz - radius - 2 - d + 1;
    cands.push({ minX, maxX: minX + w - 1, minZ, maxZ: minZ + d - 1 });
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

// Place one flat pad with the shared look at any size: orange accent frame
// all around with red/yellow ghost-glowstone corners (distance/fog-fading,
// no halo; pool-lit in the base colors while near), black interior,
// protected plate. Clears headroom for a full hull height plus the takeoff
// column.
export function placePadSite(setBlock, getBlock, pad) {
  if (!pad) return null;
  const vy = pad.vy;
  for (let x = pad.minX; x <= pad.maxX; x++) {
    for (let z = pad.minZ; z <= pad.maxZ; z++) {
      const edge = x === pad.minX || x === pad.maxX || z === pad.minZ || z === pad.maxZ;
      const corner = (x === pad.minX || x === pad.maxX) && (z === pad.minZ || z === pad.maxZ);
      const cornerV = corner
        ? (x === pad.minX ? (z === pad.minZ ? 0 : 1) : (z === pad.maxZ ? 2 : 3))
        : -1;
      const id = corner ? GLOWSTONE : edge ? HULL_ACCENT : PAD;
      setBlock(x, vy, z, id);
      if (corner) noteGlowstonePlaceShared(x, vy, z, PAD_LIGHT_GHOSTS[cornerV]);
      protectCell(x, vy, z);
      for (let y = vy + 1; y <= vy + PAD_TAKEOFF_H; y++) if (getBlock(x, y, z) !== AIR) setBlock(x, y, z, AIR);
    }
  }
  return pad;
}

// Place the flat pad and the parked rocket. The pad plate stays protected
// infrastructure and the rocket registers as vessel v1; every hull is
// destructible. Runs after terrain fill; clears headroom for the full hull
// height.
export function placeRocketSite(setBlock, getBlock, pad) {
  if (!pad) return;
  rocketSite.placed = false;
  resetVessels();
  resetPads();
  const reg = registerPad({ ...pad });
  const vy = pad.vy;
  placePadSite(setBlock, getBlock, reg);
  const grid = buildRocketGrid(pad.rot ?? 0);
  // Rocket centered on the plate (7-wide hull, 2-cell margins on p1).
  const w = pad.maxX - pad.minX + 1, d = pad.maxZ - pad.minZ + 1;
  const marginX = Math.floor((w - ROCKET_SPEC.w) / 2);
  const marginZ = Math.floor((d - ROCKET_SPEC.d) / 2);
  const origin = {
    x: pad.minX + marginX,
    y: vy + 1,
    z: pad.minZ + marginZ,
  };
  for (const c of grid.cells) {
    const x = origin.x + c.x, y = origin.y + c.y, z = origin.z + c.z;
    setBlock(x, y, z, c.id);
  }
  rocketSite.placed = true;
  rocketSite.version++;
  rocketSite.origin = origin;
  rocketSite.rotation = pad.rot ?? 0;
  rocketSite.pad = reg;
  rocketSite.grid = grid;
  registerVessel({
    ox: origin.x, oy: origin.y, oz: origin.z,
    cells: grid.cells.map((c) => ({ lx: c.x, ly: c.y, lz: c.z })),
    box: { x0: 0, x1: ROCKET_SPEC.w - 1, y0: 0, y1: ROCKET_SPEC.h - 1, z0: 0, z1: ROCKET_SPEC.d - 1 },
  });
}
