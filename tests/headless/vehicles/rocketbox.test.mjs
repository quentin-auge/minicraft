// Vessel bbox stop rule: >= 1 footprint cell with a non-air block directly
// under the bbox bottom poses the ship instead of carving. Pure
// rocketbox.js rules on stub voxel maps, node direct.
import assert from "node:assert/strict";
import { AIR, DIRT, FLOWER, STONE, WATER } from "../../../src/core/blocks.js";
import { sweptBoxCells } from "../../../src/world/rocketpad.js";
import { footprintTouches, stopBelow, gapBelowFootprint, debrisSpawnBox, bodyOverlapCells } from "../../../src/vehicles/rocketbox.js";

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

// --- vertical gap below the footprint: min over columns, capped at maxD -
{
  const one = vbox();
  // Hull bottom at 30: ground top at 20 → gap 9 (bottom 30 minus top 21).
  assert.equal(gapBelowFootprint(stubMaps([[10, 20, 10, STONE]]).getBlock, 10, 30, 10, one, 50), 9, "flat ground gap exact");
  // Contact row (support directly below) reads a sub-1 gap, like stopBelow.
  assert.ok(gapBelowFootprint(stubMaps([[10, 29, 10, DIRT]]).getBlock, 10, 30.2, 10, one, 50) < 1, "support row reads near-contact");
  // Liquids and flowers count, air never does.
  assert.equal(gapBelowFootprint(stubMaps([[10, 20, 10, WATER]]).getBlock, 10, 30, 10, one, 50), 9, "liquid counts");
  assert.equal(gapBelowFootprint(stubMaps().getBlock, 10, 30, 10, one, 50), Infinity, "open sky reads void");
  // A surface past maxD is invisible; the default cap is 50.
  assert.equal(gapBelowFootprint(stubMaps([[10, 20, 10, STONE]]).getBlock, 10, 100, 10, one, 50), Infinity, "surface past maxD ignored");
  assert.equal(gapBelowFootprint(stubMaps([[10, 20, 10, STONE]]).getBlock, 10, 100, 10, one), Infinity, "default cap is 50");
  // Wide hull: the highest column wins; a hole column never hides the rest.
  const wide = vbox(2, 0, 0);
  const g = stubMaps([[10, 20, 10, STONE], [12, 25, 10, STONE]]).getBlock;
  assert.equal(gapBelowFootprint(g, 10, 30, 10, wide, 50), 4, "highest column wins");
  const hole = stubMaps([[10, 20, 10, STONE]]).getBlock;
  assert.equal(gapBelowFootprint(hole, 10, 30, 10, wide, 50), 9, "hole columns read void, min kept");
  // Fractional bottom: gap stays float-exact.
  assert.equal(gapBelowFootprint(stubMaps([[10, 20, 10, STONE]]).getBlock, 10, 30.5, 10, one, 50), 9.5, "fractional bottom exact");
  console.log("PASS rocketbox-gap-below");
}

// --- debris spawn box: union of the hull and the tuned half-extent -------
{
  // 1-block hull, pilot inside: the tuned box wins on every axis.
  assert.deepEqual(debrisSpawnBox(vbox(), 10, 20, 10, 10.5, 20.2, 10.5, 1.5),
    { x0: -2, x1: 2, y0: -2, y1: 2, z0: -2, z1: 2 }, "1-block hull inherits the tuned cube");
  // Big hull: untouched (union keeps the hull where it already covers).
  assert.deepEqual(debrisSpawnBox(vbox(6, 6, 6), 10, 20, 10, 13.5, 23.2, 13.5, 1.5),
    { x0: 0, x1: 6, y0: 0, y1: 6, z0: 0, z1: 6 }, "big hull keeps its own volume");
  // Thin hull, pilot off-center: the union stretches only where needed.
  assert.deepEqual(debrisSpawnBox({ x0: 0, x1: 0, y0: 0, y1: 4, z0: 0, z1: 0 }, 10, 20, 10, 10.5, 20.2, 10.5, 1.5),
    { x0: -2, x1: 2, y0: -2, y1: 4, z0: -2, z1: 2 }, "thin mast stretches XZ, keeps its height");
  // Zero half-extent: the vessel box alone.
  assert.deepEqual(debrisSpawnBox(vbox(2, 2, 2), 10, 20, 10, 11.5, 21.2, 11.5, 0),
    { x0: 0, x1: 2, y0: 0, y1: 2, z0: 0, z1: 2 }, "zero half-extent reads the hull");
  console.log("PASS rocketbox-debris-box");
}

console.log("rocketbox.test.mjs: ok");
