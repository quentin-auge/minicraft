// Vessel bbox stop rule: >= 1 footprint cell with a non-air block directly
// under the bbox bottom poses the ship instead of carving. Pure
// rocketbox.js rules on stub voxel maps, node direct.
import assert from "node:assert/strict";
import { AIR, DIRT, FLOWER, STONE, WATER } from "../../../src/core/blocks.js";
import { sweptBoxCells } from "../../../src/world/rocketpad.js";
import { footprintTouches, stopBelow, bodyOverlapCells } from "../../../src/vehicles/rocketbox.js";

const vbox = (x1 = 0, y1 = 0, z1 = 0) => ({ x0: 0, x1, y0: 0, y1, z0: 0, z1 });

function stubMaps(cells = []) {
  const m = new Map(cells.map(([x, y, z, id]) => [x + "," + y + "," + z, id]));
  return {
    setBlock: (x, y, z, id) => { m.set(x + "," + y + "," + z, id); },
    getBlock: (x, y, z) => m.get(x + "," + y + "," + z) ?? AIR,
  };
}

// --- footprint contact: any non-air in the tight footprint row ------------
{
  const one = vbox();
  assert.equal(footprintTouches(stubMaps([[10, 20, 10, STONE]]).getBlock, 10, 10, one, 20), true, "solid touches");
  assert.equal(footprintTouches(stubMaps([[10, 20, 10, WATER]]).getBlock, 10, 10, one, 20), true, "liquid touches");
  assert.equal(footprintTouches(stubMaps([[10, 20, 10, FLOWER]]).getBlock, 10, 10, one, 20), true, "flower touches");
  assert.equal(footprintTouches(stubMaps().getBlock, 10, 10, one, 20), false, "air never touches");
  assert.equal(footprintTouches(stubMaps([[10, 21, 10, STONE]]).getBlock, 10, 10, one, 20), false, "other rows ignored");
  // A single supporting column in a wide footprint still counts, and a
  // fractional origin reads the floored footprint.
  const wide = vbox(6, 17, 6);
  const ground = [];
  for (let x = 10; x <= 16; x++) for (let z = 10; z <= 16; z++) ground.push([x, 9, z, DIRT]);
  ground.push([12, 10, 12, STONE]);
  const g = stubMaps(ground).getBlock;
  assert.equal(footprintTouches(g, 10, 10, wide, 9), true, "full ground row touches");
  assert.equal(footprintTouches(g, 10, 10, wide, 10), true, "single column touches");
  assert.equal(footprintTouches(g, 10, 10, wide, 11), false, "air row above passes");
  assert.equal(footprintTouches(g, 10.7, 10.2, wide, 9), true, "fractional origin floors to the footprint");
  console.log("PASS rocketbox-footprint");
}

// --- stop rule: non-air directly under the bbox bottom --------------------
{
  const one = vbox();
  // Hull bottom at 10.2: the row below the bottom row is 9.
  assert.equal(stopBelow(stubMaps([[10, 9, 10, STONE]]).getBlock, 10, 10.2, 10, one), true, "ground under the hull stops");
  assert.equal(stopBelow(stubMaps([[10, 9, 10, WATER]]).getBlock, 10, 10.2, 10, one), true, "water under the hull stops");
  assert.equal(stopBelow(stubMaps([[10, 9, 10, FLOWER]]).getBlock, 10, 10.2, 10, one), true, "flower under the hull stops");
  assert.equal(stopBelow(stubMaps().getBlock, 10, 10.2, 10, one), false, "air under the hull carves on");
  assert.equal(stopBelow(stubMaps([[10, 10, 10, STONE]]).getBlock, 10, 10.2, 10, one), false, "belly block alone never stops");
  // Integer pose: hull bottom exactly at 10, support at 9.
  assert.equal(stopBelow(stubMaps([[10, 9, 10, DIRT]]).getBlock, 10, 10, 10, one), true, "integer pose reads the support row");
  // Box with a y offset (vbox.y0 != 0): the bottom floats at oy + y0.
  const off = { x0: 0, x1: 0, y0: 2, y1: 3, z0: 0, z1: 0 };
  assert.equal(stopBelow(stubMaps([[10, 11, 10, STONE]]).getBlock, 10, 10, 10, off), true, "offset box stops on its own bottom");
  assert.equal(stopBelow(stubMaps([[10, 10, 10, STONE]]).getBlock, 10, 10, 10, off), false, "row inside an offset box never stops");
  console.log("PASS rocketbox-stop");
}

// --- the support survives the carve set -----------------------------------
// The runtime carves the swept box but never the row below it: the stop
// support is outside the carve set, the belly row inside it.
{
  const wide = vbox(6, 17, 6);
  const b = sweptBoxCells(10, 10.2, 10, wide);
  assert.equal(b.y0, 10, "box bottom row is the hull belly");
  const inSet = (x, y, z) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;
  assert.ok(inSet(12, 10, 12), "belly row carved");
  assert.ok(inSet(10, 27, 16), "top row carved");
  assert.ok(!inSet(10, 9, 10), "support row below never carved");
  assert.ok(!inSet(16, 9, 16), "support row below never carved at the fringe");
  console.log("PASS rocketbox-support-survives");
}

// --- flight-rule mirror: carve always, pause after ------------------------
// The tickFlight decision on stub maps: the swept box carves every
// non-liquid whatever the dy — even held or paused — then the pause wins
// over further motion (strictly descending with support below). The stop
// never suppresses the carve.
{
  const flightSubstep = (getBlock, setBlock, ox, oy, oz, box, sy) => {
    const b = sweptBoxCells(ox, oy, oz, box);
    const cleared = [];
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++)
        for (let z = b.z0; z <= b.z1; z++) {
          const id = getBlock(x, y, z);
          if (id === AIR) continue;
          if (id === WATER) continue; // liquids never carve
          setBlock(x, y, z, AIR);
          cleared.push([x, y, z]);
        }
    const paused = sy < 0 && stopBelow(getBlock, ox, oy, oz, box);
    return { cleared, paused };
  };
  const one = vbox();
  // Descent onto flat ground: belly air, support below — nothing to carve,
  // pause wins.
  {
    const { getBlock, setBlock } = stubMaps([[10, 9, 10, STONE]]);
    const r = flightSubstep(getBlock, setBlock, 10, 10.2, 10, one, -0.2);
    assert.equal(r.paused, true, "support below pauses the descent");
    assert.deepEqual(r.cleared, [], "belly air: nothing to carve");
    assert.equal(getBlock(10, 9, 10), STONE, "support survives");
  }
  // Held glide into a grounded wall: carves AND pauses — the pause never
  // suppresses the carve (the runtime herd hold then keeps Y while the
  // carve eats the wall).
  {
    const { getBlock, setBlock } = stubMaps([[10, 9, 10, STONE], [10, 10, 10, STONE], [10, 11, 10, STONE]]);
    const r = flightSubstep(getBlock, setBlock, 10, 10.2, 10, one, -0.2);
    assert.equal(getBlock(10, 10, 10), AIR, "belly flank carved while paused");
    assert.equal(getBlock(10, 11, 10), AIR, "upper flank carved while paused");
    assert.equal(getBlock(10, 9, 10), STONE, "support below the carve survives");
    assert.equal(r.paused, true, "pause still wins over further motion");
  }
  // Level glide into a wall flank over support: carves, never pauses at
  // dy = 0.
  {
    const { getBlock, setBlock } = stubMaps([[10, 9, 10, STONE], [10, 10, 10, STONE]]);
    const r = flightSubstep(getBlock, setBlock, 10, 10.2, 10, one, 0);
    assert.equal(getBlock(10, 10, 10), AIR, "flank block carved at level");
    assert.equal(r.paused, false, "no pause at dy = 0");
  }
  // Descent into a lake: the water is never carved, the lake bed pauses.
  {
    const { getBlock, setBlock } = stubMaps([[10, 9, 10, DIRT], [10, 10, 10, WATER]]);
    const r = flightSubstep(getBlock, setBlock, 10, 10.2, 10, one, -0.2);
    assert.equal(r.paused, true, "lake bed under the hull pauses");
    assert.equal(getBlock(10, 10, 10), WATER, "water survives");
  }
  console.log("PASS rocketbox-flight-rule");
}

// --- body overlap cells: the exact AABB set the landing clearance carves --
{
  // Player box (hw 0.3, h 1.8) centered in a cell: own row + headroom row.
  assert.deepEqual(bodyOverlapCells(10.5, 20, 10.5, 0.3, 1.8), [[10, 20, 10], [10, 21, 10]], "centered body spans feet + head");
  // Straddling a border: both columns read.
  assert.deepEqual(bodyOverlapCells(10, 20, 10.5, 0.3, 1.8).map(([x]) => x).sort((a, b) => a - b), [9, 9, 10, 10], "border-straddling body spans both columns");
  // Faces exactly on cell borders never enter those cells (strict rule).
  assert.deepEqual(bodyOverlapCells(10.5, 20, 10.5, 0.5, 1.8), [[10, 20, 10], [10, 21, 10]], "exact-border faces stay out");
  // Short mob body (h 1): single row.
  assert.deepEqual(bodyOverlapCells(10.5, 20, 10.5, 0.32, 1), [[10, 20, 10]], "1-high body reads one row");
  console.log("PASS rocketbox-body-overlap");
}

console.log("rocketbox.test.mjs: ok");
