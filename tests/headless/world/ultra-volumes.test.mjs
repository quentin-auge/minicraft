// Ultra wipe volumes: one box per zone plus one ball per celestial body,
// shared margin, membership. Three-free (ultravol + store + clouds only),
// runs headless.
import assert from "node:assert/strict";
import {
  ULTRA_MARGIN, ULTRA_Y_LO, ULTRA_BAND1_HI, ULTRA_BAND2_HI,
  groundBox, cloudBox, tntCube, fixedBox, bodyBall, footprintCols,
  BAND_DRAIN_MODES, bandDrainMode, selectBallInstances,
  ultraVolumeFor, volumeContains, boundingR,
} from "../../../src/world/ultravol.js";

// 1. Shared constants: one margin, boxes reach below the platforms.
assert.equal(ULTRA_MARGIN, 20);
assert.equal(ULTRA_Y_LO, -20);

// 2. Ground box: terrain + tallest trees (70 + 35 + 1) plus margin.
{
  const v = groundBox();
  assert.equal(v.shape, "box");
  assert.deepEqual([v.x0, v.x1, v.z0, v.z1], [-116, 116, -116, 116]);
  assert.deepEqual([v.y0, v.y1], [-20, ULTRA_BAND1_HI + 20]);
  assert.ok(volumeContains(v, 116, 50, -116));
  assert.ok(volumeContains(v, 0, 110, 0));
  assert.ok(volumeContains(v, 0, -20, 0));
  assert.ok(!volumeContains(v, 117, 50, 0));
  assert.ok(!volumeContains(v, 0, 50, -117));
  assert.ok(!volumeContains(v, 0, 111, 0));
  assert.ok(!volumeContains(v, 0, -21, 0));
}

// 3. Cloud box: decks plus spill on XZ and Y.
{
  const v = cloudBox();
  assert.deepEqual([v.x0, v.x1, v.z0, v.z1], [-116, 116, -116, 116]);
  assert.deepEqual([v.y0, v.y1], [ULTRA_BAND1_HI + 1 - 20, ULTRA_BAND2_HI + 20]);
  assert.ok(volumeContains(v, -116, 300, 116));
  assert.ok(volumeContains(v, 0, 71, 0));
  assert.ok(volumeContains(v, 0, 481, 0));
  assert.ok(!volumeContains(v, 0, 70, 0));
  assert.ok(!volumeContains(v, 0, 482, 0));
}

// 4. Celestial balls: disc radius + dome half-height, padded by the margin.
// Moon: r=96, half-height 48 → ceil(hypot) 108 + 20 = 128, center y=898.
{
  const moon = { cx: 0, cz: 0, top: 946, bottom: 850, r: 96 };
  const v = bodyBall(moon);
  assert.equal(v.shape, "ball");
  assert.deepEqual([v.cx, v.cy, v.cz, v.r], [0, 898, 0, 128]);
  assert.ok(volumeContains(v, 0, 898, 0));
  assert.ok(volumeContains(v, 128, 898, 0));
  assert.ok(volumeContains(v, 0, 898 - 128, 0));
  assert.ok(!volumeContains(v, 129, 898, 0));
  assert.ok(!volumeContains(v, 0, 898 + 129, 0));
  assert.equal(boundingR(v), 128);
  // Footprint columns: disc of the ball radius, sorted from the ignition.
  const cols = footprintCols(v, 10, 0, null);
  assert.ok(cols.length > 50000 && cols.length < 60000);
  let prev = -1;
  for (const [d2] of cols) { assert.ok(d2 >= prev); prev = d2; }
  const [, fx, fz] = cols[0];
  assert.ok(Math.hypot(fx - 10, fz) <= Math.hypot(10, 0) + 1);
}

// 5. TNT cube: centered on the ignition, anywhere in the streaming sky.
{
  const v = tntCube(1000, -500, 2000, 276);
  assert.deepEqual([v.x0, v.x1, v.y0, v.y1, v.z0, v.z1],
    [724, 1276, -776, -224, 1724, 2276]);
  assert.ok(volumeContains(v, 1000, -500, 2000));
  assert.ok(volumeContains(v, 724, -776, 1724));
  assert.ok(!volumeContains(v, 723, -500, 2000));
  assert.ok(!volumeContains(v, 1000, -223, 2000));
}

// 6. Fixed level boxes (End/Nether specs pass through untouched).
{
  const v = fixedBox({ half: 56, y0: -20, y1: 100 });
  assert.deepEqual([v.x0, v.x1, v.y0, v.y1, v.z0, v.z1],
    [-56, 56, -20, 100, -56, 56]);
  assert.ok(volumeContains(v, 56, 99, -56));
  assert.ok(!volumeContains(v, 57, 0, 0));
  assert.ok(!volumeContains(v, 0, 101, 0));
}

// 7. Dispatch: overworld band boxes win over the fallback cube (dimension
// defaults carry a cubeR that must never shadow an explicit band box),
// fixed specs win for levels, cube for the TNT sky; celestial bands resolve
// through the caller (bodies) or to null (sky gaps).
{
  const box = { half: 40, y0: -20, y1: 30 };
  assert.deepEqual(ultraVolumeFor({ u: { box }, band: 0, cx: 0, cy: 0, cz: 0 }).x1, 40);
  const cube = ultraVolumeFor({ u: { cubeR: 276 }, band: 0, cx: 10, cy: 20, cz: 30 });
  assert.deepEqual([cube.x0, cube.y0, cube.z0], [-266, -256, -246]);
  const g = ultraVolumeFor({ u: { bands: true }, band: 1, cx: 0, cy: 10, cz: 0 });
  assert.equal(g.y1, 110);
  const c = ultraVolumeFor({ u: { bands: true }, band: 2, cx: 0, cy: 200, cz: 0 });
  assert.equal(c.y0, 71);
  // The live overworld spec merges the dimension default ({ cubeR }) with
  // { bands: true } — a ground/cloud ignition resolves to its band box.
  const over = { bands: true, cubeR: 276 };
  const gb = ultraVolumeFor({ u: over, band: 1, cx: 0, cy: 10, cz: 0 });
  assert.equal(gb.shape, "box");
  assert.deepEqual([gb.x1, gb.y0, gb.y1], [116, -20, 110]);
  const cb = ultraVolumeFor({ u: over, band: 2, cx: 30, cy: 200, cz: -40 });
  assert.equal(cb.shape, "box");
  assert.deepEqual([cb.x1, cb.y0, cb.y1], [116, 71, 481]);
  // Unknown bands (sky gaps) resolve to no volume — no wipe.
  assert.equal(ultraVolumeFor({ u: { bands: true }, band: "moon", cx: 0, cy: 500, cz: 0 }), null);
  // Celestial bodies resolve to their ball through the caller.
  const b = ultraVolumeFor({ u: { bands: true }, band: "body:p0", body: { cx: 8000, cz: 0, top: 1000, bottom: 904, r: 96 } });
  assert.equal(b.shape, "ball");
}

// 8. Footprints: same set as the unpruned enumeration, radially sorted
// from the ignition, empties dropped.
{
  const occ = new Set(["0,0", "5,0", "0,5", "116,116", "-116,-116"]);
  const has = (x, z) => occ.has(x + "," + z);
  const box = { shape: "box", x0: -116, x1: 116, y0: -20, y1: 110, z0: -116, z1: 116 };
  const cols = footprintCols(box, 0, 0, has);
  assert.deepEqual(cols.map(([, x, z]) => x + "," + z).sort(), [...occ].sort(), "keeps exactly the occupied columns");
  let prev = -1;
  for (const [d2] of cols) { assert.ok(d2 >= prev); prev = d2; }
  assert.deepEqual([cols[0][1], cols[0][2]], [0, 0], "nearest column first");
  // Without a predicate nothing is pruned.
  const full = footprintCols(box, 0, 0, null);
  assert.ok(full.length > cols.length, "pruning drops empties");
  // Balls enumerate the disc only.
  const ball = { shape: "ball", cx: 0, cy: 898, cz: 0, r: 10 };
  const bc = footprintCols(ball, 0, 0, null);
  assert.ok(bc.length > 0 && bc.length < 21 * 21, "ball footprint is disc-bounded");
  for (const [, x, z] of bc) assert.ok(x * x + z * z <= 100, "no out-of-disc columns");
}

// 9. Drain pacing: a single max path (no live switch).
{
  const keys = ["colFloor", "colCap", "ms", "jumpChunks", "jumpMs"];
  assert.deepEqual(BAND_DRAIN_MODES.map((m) => m.key), ["max"], "single max drain path");
  assert.equal(bandDrainMode().key, "max", "max is the only mode");
  for (const k of keys) assert.ok(bandDrainMode()[k] !== undefined, "mode carries " + k);
}

// 10. Bounding radius of a box: half the space diagonal.
{
  const v = groundBox();
  const want = Math.sqrt(232 * 232 + 130 * 130 + 232 * 232) / 2;
  assert.ok(Math.abs(boundingR(v) - want) < 1e-9);
}

// 11. Instance filtering for celestial wipes: inside cells drop, the rest
// stays, and adjacency near the surface falls back to rebuild.
{
  const ball = { shape: "ball", cx: 0, cy: 898, cz: 0, r: 128 };
  // Moon-like column: cap cells inside, ground column far below outside.
  const cells = [];
  for (let y = 890; y <= 900; y++) cells.push([0, y, 0]);
  for (let y = 0; y <= 70; y++) cells.push([0, y, 0]);
  const r = selectBallInstances(cells, ball);
  assert.deepEqual(r.keep, cells.map((_, i) => i).slice(11), "ground cells kept");
  assert.equal(r.exact, true, "sky-isolated: exact");
  // All inside: nothing kept, still exact.
  const allIn = [[0, 898, 0], [128, 898, 0], [0, 898 - 128, 0]];
  const r2 = selectBallInstances(allIn, ball);
  assert.deepEqual(r2.keep, [], "all inside removed");
  assert.equal(r2.exact, true, "no kept cells: exact");
  // Tower touching the ball: kept cell within r+2 forces fallback.
  const tower = [[0, 898, 0], [130, 898, 0]];
  const r3 = selectBallInstances(tower, ball);
  assert.deepEqual(r3.keep, [1], "tower cell kept");
  assert.equal(r3.exact, false, "adjacent survivor: rebuild fallback");
}

console.log("ultra-volumes.test.mjs: ok");
