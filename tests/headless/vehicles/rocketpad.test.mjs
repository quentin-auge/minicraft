// Rocket pad + grid spec: the pad sits in a village-square corner (one
// clear cell off the corner), door facing the center. The grid is a staged
// 7/5/3/1 hollow shell (18 total, walls 1 thick) with a 5x5x5 cabin and
// a centered 3x4 door. Stub maps, no scene.
import assert from "node:assert/strict";
import { AIR, GLASS, GLOWSTONE, HULL, HULL_ACCENT, THRUSTER, PAD } from "../../../src/core/blocks.js";
import { isCellProtected, key } from "../../../src/core/store.js";
import {
  resetGlowstoneMemory, glowVariantAt, GLOW_VARIANTS, noteGlowstonePlace,
  noteGlowstonePlaceShared, isPadGhostVariant, padGhostBaseVariant, padGhostOpacityAt,
} from "../../../src/world/glowstone.js";
import { HALO_SOURCES } from "../../../src/render/halobake.js";
import { clusterSpots, resetSpotMemory, GHOST_POOL_FAR } from "../../../src/render/poolspots.js";
import {
  ROCKET_SPEC, PAD_SPEC, RIDE_BOX, rideBoardable,
  partitionStampCells,
  buildRocketGrid, choosePadSite, placeRocketSite, rocketSite,
} from "../../../src/world/rocketpad.js";
import { rectsOverlap, computeLayout, village } from "../../../src/world/village.js";

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
  assert.deepEqual([RIDE_BOX.x1 - RIDE_BOX.x0 + 1, RIDE_BOX.y1 - RIDE_BOX.y0 + 1], [9, 19]);
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
  assert.ok(isCellProtected(o.x, o.y, o.z));
  assert.equal(getBlock(o.x + 3, o.y + 2, o.z + 3), AIR, "cabin stays open");
  assert.equal(getBlock(o.x + 3, o.y + 18, o.z + 3), AIR, "headroom clear above the tip");
  assert.equal(getBlock(o.x + 3, o.y + 17, o.z + 3), HULL_ACCENT, "orange centered tip stamped");
  // Rocket + pad fully protected (indestructible).
  for (const [x, y, z] of rocketSite.worldCells) assert.ok(isCellProtected(x, y, z), `cell ${x},${y},${z} protected`);
  assert.ok(isCellProtected(pad.minX, pad.vy, pad.minZ), "pad corner protected");
}

// --- rider boarding: feet cell in the box with air underfoot ---------------
{
  // Live-hull solid set, as the runtime's moving model carries it.
  const g = buildRocketGrid();
  const solid = new Set(g.cells.map((c) => c.x + "," + c.y + "," + c.z));
  // Cabin stand + corners board (feet exactly on the floor top read air).
  assert.ok(rideBoardable(3, 1, 3, solid), "cabin stand boards");
  assert.ok(rideBoardable(1, 1, 1, solid), "cabin corner boards");
  assert.ok(rideBoardable(5, 3, 5, solid), "mid-cabin boards");
  // Open door cells board; pad-margin air inside the box boards too.
  assert.ok(rideBoardable(3, 1, 0, solid), "doorway boards");
  assert.ok(rideBoardable(-1, 0, 2, solid), "pad-margin air boards");
  assert.ok(rideBoardable(7, 1, 2, solid), "far margin air boards");
  // Hull cells never board: floor row, walls, glass band, tip.
  assert.ok(!rideBoardable(3, 0, 3, solid), "floor row stays behind");
  assert.ok(!rideBoardable(0, 0, 0, solid), "thruster corner stays behind");
  assert.ok(!rideBoardable(0, 2, 2, solid), "glass wall stays behind");
  assert.ok(!rideBoardable(3, 17, 3, solid), "tip stays behind");
  // Nothing travels outside the box: all six faces, plus below/above.
  assert.ok(!rideBoardable(-2, 1, 3, solid), "west of box stays");
  assert.ok(!rideBoardable(8, 1, 3, solid), "east of box stays");
  assert.ok(!rideBoardable(3, 1, -2, solid), "north of box stays");
  assert.ok(!rideBoardable(3, 1, 8, solid), "south of box stays");
  assert.ok(!rideBoardable(3, -1, 3, solid), "below the box stays");
  assert.ok(!rideBoardable(3, 19, 3, solid), "above the box stays");
  // A first falling tick that drops feet into the voxel-less floor row
  // reads solid and refuses boarding forever — the countdown-start
  // boarding exists so cabin mobs never reach that state.
  assert.ok(!rideBoardable(3, 0, 3, solid), "sunk-to-plate feet stay behind");
}

// --- landing stamp: only structural hull comes back protected ------------
{
  const g = buildRocketGrid();
  const structural = new Set(g.cells.map((c) => c.x + "," + c.y + "," + c.z));
  const cell = (lx, ly, lz, id, extra = false) => ({ lx, ly, lz, id, v: -1, extra });
  // Structural hull cells keep protection (indestructible).
  const hull = cell(0, 0, 0, HULL);
  // A pre-takeoff player build scanned into the box stamps back plain.
  const prebuilt = cell(3, 2, 3, HULL);
  // Flight extras stay plain even on structural coordinates.
  const extra = cell(0, 0, 0, GLASS, true);
  const { keep, plain } = partitionStampCells([hull, prebuilt, extra], structural);
  assert.deepEqual(keep, [hull], "structural hull only");
  assert.deepEqual(plain, [prebuilt, extra], "player builds stay deletable");
  // Empty structural set (site lost): nothing protected, nothing lost.
  const all = partitionStampCells([hull, prebuilt], new Set());
  assert.deepEqual(all.keep, []);
  assert.deepEqual(all.plain, [hull, prebuilt]);
  // Full-grid scan: every grid cell keeps, nothing else qualifies.
  const scanned = g.cells.map((c) => cell(c.x, c.y, c.z, c.id));
  const full = partitionStampCells(scanned, structural);
  assert.equal(full.keep.length, scanned.length);
  assert.equal(full.plain.length, 0);
}

console.log("rocketpad.test.mjs: ok");
