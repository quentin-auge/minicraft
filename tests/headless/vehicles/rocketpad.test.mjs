// Rule-based vessels: pads registry (N-ready, disjoint, any size, one look),
// takeoff boxes (black interior inset 1 x 20 rows), 18-connected pilotable
// components (union on pad, intersection off pad), tight-only boxes,
// split-on-removal, steal-with-split. Stub maps, no scene.
import assert from "node:assert/strict";
import { AIR, DIRT, FLOWER, GLASS, GLOWSTONE, HULL, HULL_ACCENT, STONE, THRUSTER, PAD, WATER, PORTAL } from "../../../src/core/blocks.js";
import { isCellProtected, key } from "../../../src/core/store.js";
import {
  ROCKET_SPEC, PAD_SPEC, PAD_TAKEOFF_H, rideBoardable, isFlyableId,
  floodShipCells, floodComponents, takeoffSeed, takeoffAllowed, pickUnderFeet,
  registerVessel, listVessels, resetVessels,
  refreshAllVessels, stealCellsFromVessels, sweptBoxCells, terminalCarveBox, flightCarveBox,
  pads, resetPads, registerPad, listPads, takeoffBox, vesselStraddles, straddlingCells,
  buildRocketGrid, choosePadSite, placeRocketSite, rocketSite,
} from "../../../src/world/rocketpad.js";
import { rectsOverlap, computeLayout, village } from "../../../src/world/village.js";
import {
  GLOW_VARIANTS, glowVariantAt, noteGlowstonePlace, noteGlowstonePlaceShared, resetGlowstoneMemory,
  isPadGhostVariant, padGhostBaseVariant, padGhostOpacityAt,
} from "../../../src/world/glowstone.js";
import { HALO_SOURCES } from "../../../src/render/halobake.js";
import { clusterSpots, resetSpotMemory, GHOST_POOL_FAR } from "../../../src/render/poolspots.js";

function stubMaps() {
  const m = new Map();
  const k = (x, y, z) => x + "," + y + "," + z;
  return {
    setBlock: (x, y, z, id) => { m.set(k(x, y, z), id); },
    getBlock: (x, y, z) => m.get(k(x, y, z)) ?? AIR,
  };
}

// --- staged grid (unrotated): hollow 1-thick shell, centered tip ----------
{
  assert.deepEqual([ROCKET_SPEC.w, ROCKET_SPEC.d, ROCKET_SPEC.h], [7, 7, 18]);
  assert.equal(PAD_TAKEOFF_H, 20, "takeoff column is 20 rows of air");
  const g = buildRocketGrid();
  const at = new Map(g.cells.map((c) => [c.x + "," + c.y + "," + c.z, c.id]));
  const stageWidth = (y) => {
    let lo = 7, hi = -1;
    for (const c of g.cells) if (c.y === y) { lo = Math.min(lo, c.x); hi = Math.max(hi, c.x); }
    return hi - lo + 1;
  };
  // Widths 7/5/3/1 bottom to top.
  assert.equal(stageWidth(3), 7);
  assert.equal(stageWidth(9), 5);
  assert.equal(stageWidth(13), 3);
  assert.equal(stageWidth(16), 1);
  // 5x5 cabin open over y1..5, open top at y6 inside the accent ring.
  for (let y = 1; y <= 5; y++)
    for (let x = 1; x <= 5; x++)
      for (let z = 1; z <= 5; z++)
        assert.equal(at.get(x + "," + y + "," + z), undefined, `cabin cell ${x},${y},${z} open`);
  for (let x = 1; x <= 5; x++)
    for (let z = 1; z <= 5; z++) assert.equal(at.get(x + ",6," + z), undefined, `cabin top open ${x},${z}`);
  assert.equal(at.get("0,6,0"), HULL_ACCENT, "base ring intact (accent top row)");
  // 1-thick walls all the way up.
  assert.equal(at.get("0,5,3"), HULL, "outer wall solid above the glass band");
  assert.equal(at.get("1,7,1"), HULL, "5-wide stage ring corner solid");
  // Upper shells stay hollow through the centered 3x3 taper.
  for (let y = 7; y <= 11; y++)
    for (let x = 2; x <= 4; x++) for (let z = 2; z <= 4; z++)
      assert.equal(at.get(x + "," + y + "," + z), undefined, `5-wide stage void ${x},${y},${z}`);
  for (let y = 12; y <= 14; y++) assert.equal(at.get("3," + y + ",3"), undefined, `3-wide stage void ${y}`);
  assert.equal(at.get("1,11,1"), HULL_ACCENT, "second orange ring above first-stage windows");
  assert.equal(at.get("3,11,1"), HULL_ACCENT, "orange ring runs across the front face");
  assert.equal(at.get("3,14,2"), HULL_ACCENT, "third-level orange ring");
  // All stage windows are glazed, including above the door.
  for (const y of [8, 9]) for (const x of [2, 3, 4]) assert.equal(at.get(x + "," + y + ",1"), GLASS, `front window glazed at ${x},${y}`);
  assert.equal(at.get("1,8,2"), GLASS, "side window remains glazed");
  // Centered 3-wide, 4-high door on the local -Z wall, no glass on that face.
  for (const x of [2, 3, 4]) for (let y = 1; y <= 4; y++) assert.equal(at.get(x + "," + y + ",0"), undefined);
  assert.equal(at.get("1,3,0"), HULL, "door face has no window");
  assert.equal(at.get("3,5,0"), HULL, "door header");
  assert.equal(at.get("3,6,0"), HULL_ACCENT, "accent top row above the door");
  // Floor thrusters at the four corners of the 7-wide base.
  for (const [x, z] of [[0, 0], [6, 0], [0, 6], [6, 6]]) assert.equal(at.get(x + ",0," + z), THRUSTER);
  // Stock-glass bands flank the cabin.
  assert.equal(at.get("0,2,2"), GLASS);
  assert.equal(at.get("6,3,3"), GLASS);
  // One-block centered terminal section is three blocks tall, orange at its tip.
  for (let y = 15; y <= 16; y++) assert.equal(at.get("3," + y + ",3"), HULL, `centered tip ${y}`);
  assert.equal(at.get("3,17,3"), HULL_ACCENT, "third tip block is orange");
  assert.equal(at.get("2,17,3"), undefined, "tip is one block wide");
  // Stand point inside the cabin.
  assert.deepEqual(g.stand, { x: 3, y: 1, z: 3 });
}

// --- rotation: door faces the commanded side --------------------------------
{
  // rot1 turns the -Z door onto the +X wall.
  const g = buildRocketGrid(1);
  const at = new Map(g.cells.map((c) => [c.x + "," + c.y + "," + c.z, c.id]));
  for (const z of [2, 3, 4]) for (let y = 1; y <= 4; y++) assert.equal(at.get("6," + y + "," + z), undefined, `rot1 door 6,${y},${z} open`);
  assert.deepEqual([g.door.x0, g.door.x1, g.door.z0, g.door.z1], [6, 6, 2, 4]);
  // rot0 keeps the door on -Z; rot2 mirrors it onto +Z.
  assert.deepEqual((() => { const d = buildRocketGrid(0).door; return [d.x0, d.x1, d.z0, d.z1]; })(), [2, 4, 0, 0]);
  assert.deepEqual((() => { const d = buildRocketGrid(2).door; return [d.x0, d.x1, d.z0, d.z1]; })(), [2, 4, 6, 6]);
  // The centered one-block tip survives rotation.
  for (const rot of [0, 1, 2, 3]) {
    const rg = buildRocketGrid(rot);
    const tg = rg.cells.filter((c) => c.y === 17);
    assert.deepEqual(tg.map(({ x, z }) => [x, z]), [[3, 3]], `rot${rot} tip remains centered`);
    assert.equal(tg[0].id, HULL_ACCENT, `rot${rot} tip block is orange`);
  }
}

// --- site: village-square corners, 1 clear cell, door toward center --------
{
  const flat = () => 20;
  const R = 28;
  assert.deepEqual([PAD_SPEC.w, PAD_SPEC.d], [11, 11]);
  const pad = choosePadSite(flat, 0, 0, R, 20);
  assert.ok(pad, "pad sited");
  assert.deepEqual([pad.maxX - pad.minX + 1, pad.maxZ - pad.minZ + 1], [PAD_SPEC.w, PAD_SPEC.d]);
  // Flat tie breaks on the first corner (+X/+Z): one clear cell off the
  // village-square corner, door facing the center.
  assert.deepEqual([pad.minX, pad.minZ], [R + 2, R + 2]);
  const nx = pad.rot === 1 ? 1 : pad.rot === 3 ? -1 : 0;
  const nz = pad.rot === 2 ? 1 : pad.rot === 0 ? -1 : 0;
  assert.ok(nx * (0 - pad.cx) + nz * (0 - pad.cz) > 0, "door faces the center");
  assert.equal(pad.vy, 20);
}

// --- rect overlap helper -----------------------------------------------------
{
  const a = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };
  assert.ok(rectsOverlap(a, { minX: 3, maxX: 6, minZ: 3, maxZ: 6 }, 2));
  assert.ok(!rectsOverlap(a, { minX: 7, maxX: 9, minZ: 0, maxZ: 4 }, 2));
  assert.ok(!rectsOverlap(a, { minX: 5, maxX: 6, minZ: 5, maxZ: 6 }, 0));
}

// --- layout: pad in a corner slot, clear of structures -----------------------
{
  computeLayout(1, () => 20);
  assert.ok(village.pad, "layout sited a pad");
  const R = 28, cx = village.center.x, cz = village.center.z;
  const corner =
    (village.pad.minX === cx + R + 2 && village.pad.minZ === cz + R + 2) ||
    (village.pad.maxX === cx - R - 2 && village.pad.minZ === cz + R + 2) ||
    (village.pad.minX === cx + R + 2 && village.pad.maxZ === cz - R - 2) ||
    (village.pad.maxX === cx - R - 2 && village.pad.maxZ === cz - R - 2);
  assert.ok(corner, "pad occupies a corner slot with 1-cell margin");
  const rects = [];
  if (village.pen) rects.push(["pen", village.pen]);
  if (village.pool) rects.push(["pool", village.pool]);
  for (const h of village.houses) rects.push(["house" + h.id, { minX: h.minX, maxX: h.maxX, minZ: h.minZ, maxZ: h.maxZ }]);
  for (const [name, r] of rects) assert.ok(!rectsOverlap(r, village.pad, 0), `${name} clear of pad`);
}

// --- placement ----------------------------------------------------------------
{
  resetGlowstoneMemory();
  const { setBlock, getBlock } = stubMaps();
  const pad = choosePadSite(() => 20, 0, 0, 28, 20);
  placeRocketSite(setBlock, getBlock, pad);
  assert.ok(rocketSite.placed);
  // Corners are glowstones — distance/fog-fading ghosts reading red/yellow
  // up close (clockwise from min/min: red, yellow, red, yellow).
  for (const [x, z, want] of [
    [pad.minX, pad.minZ, "red"], [pad.minX, pad.maxZ, "yellow"],
    [pad.maxX, pad.maxZ, "red"], [pad.maxX, pad.minZ, "yellow"],
  ]) {
    assert.equal(getBlock(x, pad.vy, z), GLOWSTONE, `corner ${x},${z} is glowstone`);
    const v = glowVariantAt(x, pad.vy, z);
    assert.ok(isPadGhostVariant(v), `corner ${x},${z} is ghost-flagged`);
    assert.equal(GLOW_VARIANTS[padGhostBaseVariant(v)].key, want, `corner ${x},${z} reads ${want} up close`);
  }
  // Ghosts emit no baked halo; the 7 normal variants are untouched.
  const halo = HALO_SOURCES.find((s) => s.key === "glowstone");
  assert.ok(halo, "glowstone halo source registered");
  for (const [x, z] of [
    [pad.minX, pad.minZ], [pad.minX, pad.maxZ],
    [pad.maxX, pad.maxZ], [pad.maxX, pad.minZ],
  ]) {
    assert.equal(halo.colorOf("over", key(x, pad.vy, z)), 0x000000, `corner ${x},${z} bakes no halo`);
  }
  // Normal-glowstone control: a fresh stone far from the pad rolls a normal
  // variant (never ghost) and keeps its halo color.
  noteGlowstonePlace(500, 20, 500);
  const nv = glowVariantAt(500, 20, 500);
  assert.ok(nv >= 0 && nv < GLOW_VARIANTS.length && !isPadGhostVariant(nv), "normal stone keeps a normal variant");
  assert.equal(halo.colorOf("over", key(500, 20, 500)), GLOW_VARIANTS[nv].glow, "normal stone keeps its halo color");
  // Pad-corner ghosts burn pool lamps in their base red/yellow while near:
  // the four isolated corners read as four centroid lamps (lone stones) in
  // the base colors, floating at the stone centers.
  const RED = GLOW_VARIANTS[1].glow, YELLOW = GLOW_VARIANTS[3].glow;
  const sortHex = (a, b) => a - b;
  const pcx = (pad.minX + pad.maxX) / 2 + 0.5, pcz = (pad.minZ + pad.maxZ) / 2 + 0.5;
  const lit = clusterSpots("over", { position: { x: pcx, y: pad.vy + 3.5, z: pcz } });
  assert.equal(lit.length, 4, "four ghost corners burn four lamps up close");
  assert.deepEqual(lit.map((s) => s.color).sort(sortHex), [RED, RED, YELLOW, YELLOW].sort(sortHex), "ghost lamps read base red/yellow");
  for (const s of lit) {
    const hit = [[pad.minX, pad.minZ], [pad.minX, pad.maxZ], [pad.maxX, pad.maxZ], [pad.maxX, pad.minZ]]
      .some(([x, z]) => Math.abs(s.x - (x + 0.5)) < 1e-9 && Math.abs(s.z - (z + 0.5)) < 1e-9);
    assert.ok(hit, "ghost lamp floats on its corner stone");
  }
  // Ghost lamps die with the fog: past GHOST_POOL_FAR no corner burns, even
  // though the pool range still reaches — while a normal stone at the same
  // distance keeps its lamp (DIST enter rule unchanged).
  const c0 = { x: pad.minX + 0.5, y: pad.vy + 0.5, z: pad.minZ + 0.5 };
  const inside = clusterSpots("over", { position: { x: c0.x + 100, y: c0.y, z: c0.z } });
  assert.equal(inside.length, 4, "ghost corners still burn inside the fog");
  assert.deepEqual(
    clusterSpots("over", { position: { x: c0.x + GHOST_POOL_FAR + 10, y: c0.y, z: c0.z } }),
    [], "no ghost lamp past the fog far");
  noteGlowstonePlaceShared(1000, 20, 1000, 2); // blue, far from everything
  assert.deepEqual(
    clusterSpots("over", { position: { x: 1000.5 + 190, y: 20.5, z: 1000.5 } }),
    [], "normal stone past DIST stays dark (enter rule)");
  const blue = clusterSpots("over", { position: { x: 1000.5 + GHOST_POOL_FAR + 10, y: 20.5, z: 1000.5 } });
  assert.equal(blue.length, 1, "normal stone still burns past the ghost fog cap");
  assert.equal(blue[0].color, GLOW_VARIANTS[2].glow, "normal lamp keeps its own color");
  resetSpotMemory();
  // Distance fade: full strength up close, gone by fog far, monotonic.
  assert.equal(padGhostOpacityAt(0), 1, "ghost opaque up close");
  assert.equal(padGhostOpacityAt(1000), 0, "ghost gone far away");
  assert.ok(padGhostOpacityAt(10) >= padGhostOpacityAt(60) && padGhostOpacityAt(60) >= padGhostOpacityAt(159), "ghost fade monotonic");
  resetGlowstoneMemory();
  // Frame accent, interior plate, rocket centered (2-cell margins).
  assert.equal(getBlock(pad.minX, pad.vy, pad.minZ + 1), HULL_ACCENT);
  assert.equal(getBlock(pad.minX + 3, pad.vy, pad.minZ + 3), PAD);
  const o = rocketSite.origin;
  assert.deepEqual([o.x, o.z], [pad.minX + 2, pad.minZ + 2]);
  assert.deepEqual([
    o.x - pad.minX,
    pad.maxX - (o.x + ROCKET_SPEC.w - 1),
    o.z - pad.minZ,
    pad.maxZ - (o.z + ROCKET_SPEC.d - 1),
  ], [2, 2, 2, 2], "rocket has symmetric 2-cell pad margins");
  assert.ok(isCellProtected(o.x, o.y, o.z) === false, "hull is destructible");
  assert.equal(getBlock(o.x + 3, o.y + 2, o.z + 3), AIR, "cabin stays open");
  assert.equal(getBlock(o.x + 3, o.y + 19, o.z + 3), AIR, "headroom clear through the 20-row column");
  assert.equal(getBlock(o.x + 3, o.y + 17, o.z + 3), HULL_ACCENT, "orange centered tip stamped");
  // Pad stays protected infrastructure; the hull does not.
  assert.ok(isCellProtected(pad.minX, pad.vy, pad.minZ), "pad corner protected");
  assert.ok(isCellProtected(pad.minX + 3, pad.vy, pad.minZ + 3), "pad plate protected");
  // The original rocket registers as vessel v1 with the hull box.
  const vs = listVessels();
  assert.equal(vs.length, 1, "one vessel registered");
  assert.equal(vs[0].id, "v1", "first vessel is v1");
  assert.deepEqual([vs[0].ox, vs[0].oy, vs[0].oz], [o.x, o.y, o.z], "v1 frame is the pad origin");
  assert.deepEqual(vs[0].box, { x0: 0, x1: 6, y0: 0, y1: 17, z0: 0, z1: 6 }, "v1 box is the hull");
  assert.ok(vs[0].cells.some((c) => c.lx === 3 && c.ly === 0 && c.lz === 3), "v1 carries the cabin floor");
  assert.ok(vs[0].cells.some((c) => c.lx === 3 && c.ly === 17 && c.lz === 3), "v1 carries the tip");
  // Takeoff box: black interior inset 1 x 20 rows.
  const tb = takeoffBox(listPads()[0]);
  assert.deepEqual(tb, { x0: pad.minX + 1, x1: pad.maxX - 1, y0: pad.vy + 1, y1: pad.vy + 20, z0: pad.minZ + 1, z1: pad.maxZ - 1 }, "takeoff box is the interior x 20");
}

// --- pads registry: N-ready, disjoint, any size, one look -------------------
{
  resetPads();
  const a = registerPad({ minX: 0, maxX: 10, minZ: 0, maxZ: 10, vy: 5 });
  assert.equal(a.id, "p1", "first pad is p1");
  const b = registerPad({ minX: 100, maxX: 106, minZ: 100, maxZ: 108, vy: 7 });
  assert.equal(b.id, "p2", "second pad is p2");
  assert.equal(listPads().length, 2, "two pads registered");
  assert.deepEqual(takeoffBox(b), { x0: 101, x1: 105, y0: 8, y1: 27, z0: 101, z1: 107 }, "box follows the pad size");
  assert.throws(() => registerPad({ minX: 5, maxX: 9, minZ: 5, maxZ: 9, vy: 5 }), /overlaps p1/, "overlap fails fast");
  // Too-narrow pads yield no box: nothing pilotable, by construction.
  const thin = registerPad({ minX: 200, maxX: 201, minZ: 200, maxZ: 210, vy: 5 });
  assert.equal(takeoffBox(thin), null, "w<3 pad has no box");
  resetPads();
  assert.deepEqual(listPads(), [], "registry resets");
}

// --- rider boarding: in-box plus standing on the hull ---------------------
{
  const B = { x0: 0, x1: 6, y0: 0, y1: 17, z0: 0, z1: 6 };
  const solid = new Set(["3,0,3"]);
  assert.ok(rideBoardable(3, 1, 3, solid, B), "cabin air boards");
  assert.ok(rideBoardable(3, 0, 3, solid, B), "wall cells board too now");
  assert.ok(rideBoardable(3, 17, 3, solid, B), "tip boards too now");
  assert.ok(!rideBoardable(7, 1, 2, solid, B), "outside the box stays behind");
  assert.ok(!rideBoardable(3, -1, 3, solid, B), "below the box stays");
  assert.ok(!rideBoardable(3, 19, 3, solid, B), "two above the box stays");
  assert.ok(!rideBoardable(3, 18, 3, solid, B), "atop air (no hull under feet) stays");
  assert.ok(rideBoardable(3, 18, 3, new Set(["3,17,3"]), B), "standing on the hull boards");
  // 1x2x2 vessel with a cow on top: feet on the top face, hull under them.
  const S = { x0: 0, x1: 0, y0: 0, y1: 1, z0: 0, z1: 1 };
  const roof = new Set(["0,1,0"]);
  assert.ok(rideBoardable(0, 2, 0, roof, S), "cow on the roof boards");
  assert.ok(!rideBoardable(0, 2, 1, roof, S), "open top (no hull under feet) refuses");
  assert.ok(!rideBoardable(1, 2, 0, roof, S), "feet outside the footprint refuse");
  assert.ok(rideBoardable(0, 0, 0, new Set(), S), "in-box needs no hull under feet");
}

// --- components: 18-neighbourhood, plates are walls -------------------------
{
  const ox = 200, oy = 20, oz = 200;
  const g = buildRocketGrid();
  const hull = new Map(g.cells.map((c) => [(c.x + ox) + "," + (c.y + oy) + "," + (c.z + oz), c.id]));
  const extra = new Map();
  const getBlock = (x, y, z) => extra.get(x + "," + y + "," + z) ?? hull.get(x + "," + y + "," + z) ?? AIR;
  const BOX = { x0: ox - 1, x1: ox + 7, y0: oy, y1: oy + 18, z0: oz - 1, z1: oz + 7 };
  const comps = (box = BOX, exclude = null) => floodComponents(getBlock, box, exclude);
  const keys = (comp) => new Set(comp.map(([x, y, z]) => x + "," + y + "," + z));
  // The whole parked rocket is one component from any hull seed.
  const all = comps();
  assert.equal(all.length, 1, "hull is one component");
  assert.deepEqual(keys(all[0]), new Set([...hull.keys()]), "floor seed takes the whole rocket");
  // Isolated dirt in the cabin void is its own component.
  extra.set((ox + 3) + "," + (oy + 3) + "," + (oz + 3), DIRT);
  assert.equal(comps().length, 2, "disconnected dirt splits off");
  // Edge-touching dirt joins: edges connect, corners don't.
  extra.set((ox + 2) + "," + (oy + 6) + "," + (oz + 2), DIRT);
  assert.ok(keys(comps().find((c) => c.some(([x, y, z]) => x === ox + 3 && y === oy && z === oz + 3))).has((ox + 2) + "," + (oy + 6) + "," + (oz + 2)), "edge-touching dirt rides");
  extra.set((ox + 6) + "," + (oy + 17) + "," + (oz + 6), STONE);
  assert.ok(!keys(comps().find((c) => c.some(([x, y, z]) => x === ox + 5 && y === oy + 18 && z === oz + 5)) ?? []).has((ox + 6) + "," + (oy + 17) + "," + (oz + 6)), "corner-only stays split");
  // Flowers fly like any block.
  extra.set((ox + 4) + "," + (oy + 3) + "," + (oz + 4), FLOWER);
  assert.ok(floodShipCells(getBlock, [[ox + 4, oy + 3, oz + 4]], BOX).length >= 1, "flower seeds a component");
  // Excluded plates are walls now: they neither ride nor conduct.
  extra.set((ox + 3) + "," + (oy + 6) + "," + (oz + 3), DIRT);
  const bridge = new Set([(ox + 3) + "," + (oy + 6) + "," + (oz + 3)]);
  assert.ok(!keys(comps(BOX, bridge).find((c) => c.some(([x, y, z]) => x === ox + 3 && y === oy && z === oz + 3)) ?? []).has((ox + 3) + "," + (oy + 6) + "," + (oz + 3)), "excluded cell neither rides nor conducts");
  // Portal frames fly as ordinary blocks.
  assert.ok(isFlyableId(PORTAL), "portal frames are flyable");
  assert.ok(!isFlyableId(AIR), "air never flies");
}

// --- takeoff seed: support below, else liquid/flower feet, never sunk -----
{
  const m = new Map();
  const gb = (x, y, z) => m.get(x + "," + y + "," + z) ?? AIR;
  m.set("0,-1,0", STONE);
  assert.deepEqual(takeoffSeed(gb, 0, 0, 0), [0, -1, 0], "support below seeds");
  m.set("1,-1,1", FLOWER);
  assert.deepEqual(takeoffSeed(gb, 1, 0, 1), [1, -1, 1], "flower support seeds");
  m.set("2,0,2", WATER);
  assert.deepEqual(takeoffSeed(gb, 2, 0, 2), [2, 0, 2], "treading water seeds the feet");
  m.set("3,0,3", STONE);
  assert.equal(takeoffSeed(gb, 3, 0, 3), null, "feet sunk in solid seed nothing");
  assert.equal(takeoffSeed(gb, 9, 9, 9), null, "mid-air hover seeds nothing");
}

// --- takeoff gate: never fly, never jump ------------------------------------
{
  assert.equal(takeoffAllowed(), true, "still pilot may launch");
  assert.equal(takeoffAllowed({}), true, "empty pilot state launches");
  assert.equal(takeoffAllowed({ flying: false, jumping: false }), true, "grounded pilot launches");
  assert.equal(takeoffAllowed({ flying: true }), false, "fly mode refuses the takeoff");
  assert.equal(takeoffAllowed({ jumping: true }), false, "a jump is not a launch");
  assert.equal(takeoffAllowed({ flying: true, jumping: true }), false, "both vetoes hold together");
}

// --- pick: pad union vs vessel intersection ----------------------------------
{
  resetVessels();
  resetPads();
  const ox = 400, oy = 30, oz = 400;
  const g = buildRocketGrid();
  const live = new Map(g.cells.map((c) => [(c.x + ox) + "," + (c.y + oy) + "," + (c.z + oz), c.id]));
  const getBlock = (x, y, z) => live.get(x + "," + y + "," + z) ?? AIR;
  const pad = registerPad({ minX: ox - 2, maxX: ox + 8, minZ: oz - 2, maxZ: oz + 8, vy: oy - 1 });
  const plate = new Set();
  for (let x = pad.minX; x <= pad.maxX; x++)
    for (let z = pad.minZ; z <= pad.maxZ; z++) plate.add(x + "," + pad.vy + "," + z);
  const ctx = () => ({ vessels: listVessels(), pads: listPads(), exclude: plate });
  // Standing in the cabin resolves the whole rocket as a pad offer (union,
  // fresh record at liftoff).
  let offer = pickUnderFeet(getBlock, ox + 3, oy + 1, oz + 3, ctx());
  assert.ok(offer, "cabin stand takes off");
  assert.equal(offer.kind, "pad", "unregistered ship resolves as pad creation");
  assert.equal(offer.vesselId, null, "creation has no vessel yet");
  assert.equal(offer.ship.length, g.cells.length, "ship is every hull cell");
  // Two separate piles on the pad: the seed picks its own component only.
  // (Separate map: a clod next to the hull would edge-join it.)
  const solo = new Map();
  solo.set((pad.minX + 1) + "," + (pad.vy + 1) + "," + (pad.minZ + 1), DIRT);
  const getSolo = (x, y, z) => solo.get(x + "," + y + "," + z) ?? AIR;
  const soloCtx = () => ({ vessels: [], pads: listPads(), exclude: plate });
  const lone = pickUnderFeet(getSolo, pad.minX + 1, pad.vy + 2, pad.minZ + 1, soloCtx());
  assert.ok(lone, "pad clod takes off");
  assert.deepEqual(lone.ship, [[pad.minX + 1, pad.vy + 1, pad.minZ + 1]], "ship is the lone clod");
  // Bare plate never flies.
  assert.equal(pickUnderFeet(getBlock, pad.minX + 1, pad.vy + 1, pad.minZ + 1, ctx()), null, "bare plate stays parked");
  // Feet sunk in a solid wall stand on nothing.
  assert.equal(pickUnderFeet(getBlock, ox, oy + 2, oz, ctx()), null, "sunk feet refuse");
  // Hovering mid-cabin refuses.
  assert.equal(pickUnderFeet(getBlock, ox + 3, oy + 3, oz + 3, ctx()), null, "mid-air hover refuses");
  // A parked vessel off the pad resolves by intersection, keeping its id.
  resetPads();
  const v = registerVessel({
    ox: 500, oy: 30, oz: 500,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 0 }, { lx: 0, ly: 1, lz: 0 }],
    box: { x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 0 },
  });
  const m2 = new Map([["500,30,500", STONE], ["501,30,500", STONE], ["500,31,500", STONE]]);
  const gb2 = (x, y, z) => m2.get(x + "," + y + "," + z) ?? AIR;
  const off = pickUnderFeet(gb2, 500, 32, 500, { vessels: listVessels(), pads: [], exclude: null });
  assert.ok(off, "parked vessel resolves off pad");
  assert.equal(off.kind, "vessel", "off-pad resolves as vessel");
  assert.equal(off.vesselId, v.id, "takeoff vessel identified");
  assert.equal(off.ship.length, 3, "intersection keeps the connected cells");
  resetVessels();
  resetPads();
}

// --- straddling vessels: intersection, never cut --------------------------------
{
  resetVessels();
  resetPads();
  // Pad 11x11: plate 0..10, takeoff box 1..9 x vy+1..vy+20 x 1..9.
  const pad = registerPad({ minX: 0, maxX: 10, minZ: 0, maxZ: 10, vy: 5 });
  const tb = takeoffBox(pad);
  assert.deepEqual([tb.x0, tb.x1, tb.y1], [1, 9, 25]);
  const plate = new Set();
  for (let x = pad.minX; x <= pad.maxX; x++)
    for (let z = pad.minZ; z <= pad.maxZ; z++) plate.add(x + "," + pad.vy + "," + z);
  const ctx = () => ({ pads: listPads(), vessels: listVessels(), exclude: plate });
  // Straddle units: only the straddling case drives behavior — a vessel
  // crossing a box boundary keeps its own box and id, while a contained
  // one unions with the pad and a far one stays independent.
  const mkV = (ox, oz, x1) => ({ status: "parked", ox, oy: 6, oz, cells: [], box: { x0: 0, x1, y0: 0, y1: 0, z0: 0, z1: 0 } });
  assert.equal(vesselStraddles(mkV(2, 2, 2), [tb]), false, "contained does not straddle");
  assert.equal(vesselStraddles(mkV(8, 2, 3), [tb]), true, "overflowing straddles");
  assert.equal(vesselStraddles(mkV(50, 50, 1), [tb]), false, "far does not straddle");
  assert.equal(vesselStraddles(mkV(2, 2, 2), [null]), false, "boxless pad counts as no box");
  // A vessel parked across the boundary: 3 stones, one in, two out.
  const m = new Map();
  m.set("0,6,5", STONE);
  m.set("1,6,5", STONE);
  m.set("2,6,5", STONE);
  const gb = (x, y, z) => m.get(x + "," + y + "," + z) ?? AIR;
  const v = registerVessel({
    ox: 0, oy: 6, oz: 5,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 0 }, { lx: 2, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 2, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  assert.equal(vesselStraddles(v, [tb]), true, "setup straddles");
  assert.deepEqual([...straddlingCells(listVessels(), [tb])].sort(), ["0,6,5", "1,6,5", "2,6,5"], "straddling cells enumerated");
  // Seed on the inside stone: the WHOLE vessel flies, same id, no cut.
  const offer = pickUnderFeet(gb, 1, 7, 5, ctx());
  assert.ok(offer, "straddling vessel takes off");
  assert.equal(offer.kind, "vessel", "straddling resolves as vessel, not pad union");
  assert.equal(offer.vesselId, v.id, "takeoff vessel identified");
  assert.equal(offer.ship.length, 3, "ship is the whole vessel, in and out");
  // Seed on the outside stone: same vessel, same whole ship.
  const offerOut = pickUnderFeet(gb, 0, 7, 5, ctx());
  assert.ok(offerOut && offerOut.vesselId === v.id && offerOut.ship.length === 3, "outside seed flies the same whole vessel");
  // Fresh blocks touching the inside flank: their component carries no
  // vessel cells — the vessel is never amputated, the fresh pile flies alone.
  m.set("1,7,5", DIRT);
  const fresh = pickUnderFeet(gb, 1, 8, 5, ctx());
  assert.ok(fresh, "fresh flank pile takes off");
  assert.equal(fresh.kind, "pad", "fresh pile resolves as pad creation");
  assert.deepEqual(fresh.ship, [[1, 7, 5]], "ship is the lone clod, vessel cells untouched");
  // A contained vessel still unions with fresh blocks on the pad.
  m.set("4,6,5", STONE);
  const w = registerVessel({
    ox: 4, oy: 6, oz: 5,
    cells: [{ lx: 0, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  m.set("5,6,5", DIRT);
  const union = pickUnderFeet(gb, 4, 7, 5, ctx());
  assert.ok(union, "contained vessel takes off");
  assert.equal(union.kind, "pad", "contained resolves as pad union");
  assert.ok(union.ship.some(([x, y, z]) => x === 4 && y === 6 && z === 5), "union carries the vessel cell");
  assert.ok(union.ship.some(([x, y, z]) => x === 5 && y === 6 && z === 5), "union carries the fresh block");
  assert.equal(vesselStraddles(w, [tb]), false, "setup contained");
  resetVessels();
  resetPads();
}

// --- registry refresh: shrink, split, vanish --------------------------------
{
  resetVessels();
  const v = registerVessel({
    ox: 300, oy: 20, oz: 300,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 0 }, { lx: 2, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 2, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  assert.equal(v.id, "v1", "first id is v1");
  const m = new Map();
  const gb = (x, y, z) => m.get(x + "," + y + "," + z) ?? AIR;
  m.set("300,20,300", STONE);
  m.set("301,20,300", STONE);
  m.set("302,20,300", STONE);
  // Eating the middle block splits the record in two (first keeps the id).
  m.delete("301,20,300");
  const out = refreshAllVessels(gb);
  assert.equal(out.length, 2, "cut vessel splits in two");
  assert.ok(out.some((r) => r.id === "v1"), "first split keeps the id");
  assert.ok(out.some((r) => r.id !== "v1"), "second split mints a fresh id");
  for (const r of out) assert.deepEqual(r.box, { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }, "splits re-box tight");
  // Emptying everything removes the records.
  m.clear();
  refreshAllVessels(gb);
  assert.deepEqual(listVessels(), [], "fully emptied registry is empty");
  // A single record refresh keeps the record shape: the survivor stays,
  // its eaten cells drop and it re-boxes tight; emptied, it is removed.
  const w = registerVessel({
    ox: 300, oy: 20, oz: 300,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 1, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  m.set("300,20,300", STONE);
  assert.deepEqual(refreshAllVessels(gb), [w], "non-empty refresh keeps the record");
  assert.deepEqual([w.cells, w.box], [[{ lx: 0, ly: 0, lz: 0 }], { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }], "refresh drops eaten cells and re-boxes");
  m.delete("300,20,300");
  assert.deepEqual(refreshAllVessels(gb), [], "empty refresh removes the record");
  assert.deepEqual(listVessels(), [], "empty refresh removes the record");
  resetVessels();
}

// --- steal: donors shrink (and split) around the flying set ------------------
{
  resetVessels();
  const donor = registerVessel({
    ox: 500, oy: 30, oz: 500,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 0 }, { lx: 2, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 2, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  const m = new Map([["500,30,500", STONE], ["501,30,500", STONE], ["502,30,500", STONE]]);
  const gb = (x, y, z) => m.get(x + "," + y + "," + z) ?? AIR;
  m.delete("501,30,500"); // liftoff cleared it from the store first
  stealCellsFromVessels(gb, new Set(["501,30,500"]), null, null);
  const rest = listVessels().filter((v) => v.id === donor.id || v.cells.length);
  assert.ok(!listVessels().some((v) => v.cells.some((c) => v.ox + c.lx === 501 && v.oy + c.ly === 30 && v.oz + c.lz === 500)), "stolen cell leaves every donor");
  assert.equal(listVessels().length, 2, "cut donor splits in two");
  assert.ok(rest.length === 2, "survivors re-boxed");
  resetVessels();
}

// --- ghost purge: emptied vessels vanish ------------------------------------
{
  resetVessels();
  registerVessel({
    ox: 500, oy: 30, oz: 500,
    cells: [{ lx: 0, ly: 0, lz: 0 }],
    box: { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 },
  });
  const ghost = registerVessel({
    ox: 499, oy: 30, oz: 499,
    cells: [{ lx: 0, ly: 0, lz: 0 }, { lx: 1, ly: 0, lz: 1 }],
    box: { x0: 0, x1: 2, y0: 0, y1: 0, z0: 0, z1: 2 },
  });
  const m = new Map();
  const k = (x, y, z) => x + "," + y + "," + z;
  const gb = (x, y, z) => m.get(k(x, y, z)) ?? AIR;
  m.set(k(500, 30, 500), STONE);
  refreshAllVessels(gb);
  assert.equal(listVessels().length, 2, "partial ghost shrinks but survives");
  assert.deepEqual([ghost.ox, ghost.oy, ghost.oz], [500, 30, 500], "ghost reframes on the survivor");
  assert.deepEqual(ghost.cells, [{ lx: 0, ly: 0, lz: 0 }], "ghost keeps live cells only");
  assert.deepEqual(ghost.box, { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }, "ghost re-boxes tight");
  m.delete(k(500, 30, 500));
  refreshAllVessels(gb);
  assert.deepEqual(listVessels(), [], "fully emptied registry is empty");
  resetVessels();
  resetPads();
}

// --- sweptBoxCells: fractional fringe covered, aligned stays tight --------
{
  const b1 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  assert.deepEqual(sweptBoxCells(10, 20, 30, b1), { x0: 10, x1: 10, y0: 20, y1: 20, z0: 30, z1: 30 }, "aligned 1-block stays tight");
  assert.deepEqual(sweptBoxCells(10.42, 20.42, 30.42, b1), { x0: 10, x1: 11, y0: 20, y1: 21, z0: 30, z1: 31 }, "fractional 1-block covers the fringe");
  const hull = { x0: 0, x1: 6, y0: 0, y1: 17, z0: 0, z1: 6 };
  assert.deepEqual(sweptBoxCells(5, 9, 7, hull).x1 - sweptBoxCells(5, 9, 7, hull).x0, 6, "aligned hull keeps its width");
  assert.deepEqual(sweptBoxCells(5.5, 9, 7.5, hull), { x0: 5, x1: 12, y0: 9, y1: 26, z0: 7, z1: 14 }, "fractional hull grows one fringe row per axis");
}

// --- terminalCarveBox: descent clamps x/z to the posed box, y stays swept --
{
  const b1 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  assert.deepEqual(terminalCarveBox(10, 20, 30, b1), { x0: 10, x1: 10, y0: 20, y1: 20, z0: 30, z1: 30 }, "aligned 1-block stays tight");
  assert.deepEqual(terminalCarveBox(10.42, 20.42, 30.42, b1), { x0: 10, x1: 10, y0: 20, y1: 21, z0: 30, z1: 30 }, "fractional 1-block clamps x/z, keeps swept y");
  const hull = { x0: 0, x1: 6, y0: 0, y1: 17, z0: 0, z1: 6 };
  assert.deepEqual(terminalCarveBox(10.42, 20.42, 10.42, hull), { x0: 10, x1: 16, y0: 20, y1: 38, z0: 10, z1: 16 }, "fractional hull clamps one fringe column per x/z");
  assert.deepEqual(terminalCarveBox(10, 20, 10, hull), sweptBoxCells(10, 20, 10, hull), "aligned hull matches the swept box");
}

// --- flightCarveBox: one descent-aware selector behind carve and fallback --
{
  const hull = { x0: 0, x1: 6, y0: 0, y1: 17, z0: 0, z1: 6 };
  assert.deepEqual(flightCarveBox(10.42, 20.42, 10.42, hull, true), terminalCarveBox(10.42, 20.42, 10.42, hull), "descent reads the posed box");
  assert.deepEqual(flightCarveBox(10.42, 20.42, 10.42, hull, false), sweptBoxCells(10.42, 20.42, 10.42, hull), "level flight keeps the swept box");
  assert.deepEqual(flightCarveBox(10.42, 20.42, 10.42, hull), sweptBoxCells(10.42, 20.42, 10.42, hull), "climb is the default");
}

console.log("rocketpad.test.mjs: ok");
