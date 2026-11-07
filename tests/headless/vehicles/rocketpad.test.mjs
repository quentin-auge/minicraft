// Rocket pad + grid spec: the pad sits in a village-square corner (one
// clear cell off the corner), door facing the center. The grid is a staged
// 7/5/3/1 hollow shell (18 total, walls 1 thick) with a 5x5x5 cabin and
// a centered 3x4 door. Stub maps, no scene.
import assert from "node:assert/strict";
import { AIR, GLASS, GLOWSTONE, HULL, HULL_ACCENT, THRUSTER, PAD } from "../../../src/core/blocks.js";
import { isCellProtected } from "../../../src/core/store.js";
import { resetGlowstoneMemory, glowVariantAt, GLOW_VARIANTS } from "../../../src/world/glowstone.js";
import {
  ROCKET_SPEC, PAD_SPEC, PAD_LIGHTS, RIDE_BOX,
  buildRocketGrid, choosePadSite, placeRocketSite, rocketSite,
} from "../../../src/world/rocketpad.js";
import { rectsOverlap, computeLayout, village } from "../../../src/world/village.js";

const red = GLOW_VARIANTS.findIndex((v) => v.key === "red");
const yellow = GLOW_VARIANTS.findIndex((v) => v.key === "yellow");

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
  // Corners glow red/yellow clockwise from min/min.
  const corners = [
    [pad.minX, pad.minZ, PAD_LIGHTS[0]],
    [pad.minX, pad.maxZ, PAD_LIGHTS[1]],
    [pad.maxX, pad.maxZ, PAD_LIGHTS[2]],
    [pad.maxX, pad.minZ, PAD_LIGHTS[3]],
  ];
  for (const [x, z, want] of corners) {
    assert.equal(getBlock(x, pad.vy, z), GLOWSTONE, `corner ${x},${z} glows`);
    assert.equal(glowVariantAt(x, pad.vy, z), want === "red" ? red : yellow, `corner ${x},${z} ${want}`);
  }
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

console.log("rocketpad.test.mjs: ok");
