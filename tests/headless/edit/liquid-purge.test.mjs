// Floating-liquid purge: the real discovery (core/liquid.js) on real voxels
// (store.js), no scene. Anchor = solid face- or edge-neighbor, flood joins
// through faces and edges alike (corners join and anchor nothing);
// y = 0 never purges.
import assert from "node:assert/strict";
import { AIR, STONE, WATER, LAVA } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { touchesSolid, findFloatingLiquids } from "../../../src/core/liquid.js";

function fresh() {
  resetWorld("over");
  setDimension("over");
}

function purgedAt(calls) {
  return findFloatingLiquids(getBlock, calls).map(([x, y, z]) => `${x},${y},${z}`).sort();
}

// --- touchesSolid units ---
fresh();
setBlock(0, 5, 0, WATER);
setBlock(1, 5, 0, STONE);
assert.equal(touchesSolid(getBlock, 0, 5, 0), true); // face
fresh();
setBlock(0, 5, 0, WATER);
setBlock(1, 6, 0, STONE);
assert.equal(touchesSolid(getBlock, 0, 5, 0), true); // edge [1,1,0]
fresh();
setBlock(0, 5, 0, WATER);
setBlock(1, 5, 1, STONE);
assert.equal(touchesSolid(getBlock, 0, 5, 0), true); // edge [1,0,1]
fresh();
setBlock(0, 5, 0, WATER);
setBlock(1, 6, 1, STONE);
assert.equal(touchesSolid(getBlock, 0, 5, 0), false); // corner only: no anchor
fresh();
setBlock(0, 5, 0, WATER);
assert.equal(touchesSolid(getBlock, 0, 5, 0), false); // open air
console.log("PASS touchesSolid");

// --- face-anchored group survives ---
fresh();
setBlock(0, 5, 0, WATER);
setBlock(1, 5, 0, STONE);
assert.deepEqual(purgedAt([[0, 5, 0]]), []);
console.log("PASS face anchored");

// --- edge-anchored cell survives (the rework) ---
for (const s of [[1, 6, 0], [1, 4, 0], [1, 5, 1], [0, 6, 1], [-1, 4, 0]]) {
  fresh();
  setBlock(0, 5, 0, WATER);
  setBlock(s[0], s[1], s[2], STONE);
  assert.deepEqual(purgedAt([[0, 5, 0]]), [], `edge stone at ${s}`);
}
console.log("PASS edge anchored");

// --- corner-touching stone does NOT anchor ---
fresh();
setBlock(0, 5, 0, WATER);
setBlock(1, 6, 1, STONE);
assert.deepEqual(purgedAt([[0, 5, 0]]), ["0,5,0"]);
console.log("PASS corner purged");

// --- isolated liquid purges ---
fresh();
setBlock(0, 5, 0, WATER);
assert.deepEqual(purgedAt([[0, 5, 0]]), ["0,5,0"]);
console.log("PASS isolated purged");

// --- group anchored by one edge cell survives whole ---
fresh();
setBlock(0, 5, 0, WATER);
setBlock(0, 5, 1, WATER);
setBlock(0, 5, 2, WATER);
setBlock(1, 6, 0, STONE); // edge of (0,5,0) only; rest join by faces
assert.deepEqual(purgedAt([[0, 5, 2]]), []);
console.log("PASS group edge anchored");

// --- isolated group purges whole ---
fresh();
setBlock(0, 5, 0, WATER);
setBlock(0, 5, 1, WATER);
assert.deepEqual(purgedAt([[0, 5, 0]]), ["0,5,0", "0,5,1"]);
console.log("PASS isolated group purged");

// --- y = 0 never purges ---
fresh();
setBlock(0, 0, 0, WATER);
assert.deepEqual(purgedAt([[0, 0, 0]]), []);
console.log("PASS floor exempt");

// --- lava follows the same rule, liquids stay separate ---
fresh();
setBlock(0, 5, 0, WATER);
setBlock(0, 7, 0, LAVA);
setBlock(1, 5, 0, STONE);
assert.deepEqual(purgedAt([[0, 5, 0], [0, 7, 0]]), ["0,7,0"]);
assert.equal(getBlock(0, 5, 0), WATER); // discovery is pure: no writes
console.log("PASS lava separate");

// --- diagonal (edge) water chain shares one group: base anchor keeps all ---
fresh();
setBlock(0, 6, 0, WATER); // top of the staircase, edge-only link below
setBlock(1, 5, 0, WATER);
setBlock(0, 4, 0, STONE); // edge anchor of (1,5,0) only
assert.deepEqual(purgedAt([[0, 5, 0]]), []); // 6-flood purged 0,6,0 here
console.log("PASS diagonal chain kept");

// --- breaking the base anchor purges the whole diagonal chain ---
fresh();
setBlock(0, 6, 0, WATER);
setBlock(1, 5, 0, WATER);
setBlock(1, 4, 0, STONE); // face anchor of (1,5,0); break it:
setBlock(1, 4, 0, AIR);
assert.deepEqual(purgedAt([[1, 4, 0]]), ["0,6,0", "1,5,0"]);
console.log("PASS diagonal chain purged with base");

// --- seeds cover edges: breaking an edge-only anchor strands its group ---
fresh();
setBlock(0, 6, 0, WATER);
setBlock(1, 5, 0, STONE); // edge-only anchor, then broken:
setBlock(1, 5, 0, AIR);
assert.deepEqual(purgedAt([[1, 5, 0]]), ["0,6,0"]); // 6-seeds missed it
console.log("PASS edge seeds");

// --- corner (3-axis) contact joins nothing and anchors nothing ---
fresh();
setBlock(0, 6, 0, WATER);
setBlock(1, 5, 1, WATER); // corner of (0,6,0): separate group
setBlock(1, 4, 1, STONE); // face anchor of (1,5,1) only
assert.deepEqual(purgedAt([[0, 5, 0]]), ["0,6,0"]);
assert.equal(getBlock(1, 5, 1), WATER);
console.log("PASS corner separate");

console.log("liquid-purge: all PASS");
