// Chunk-border liquid seam (Nether): a lava-lava boundary must emit no face
// once the neighbour chunk voxels exist. rebuildChunk (mesher) guarantees
// this by ensuring the 3x3 area before reading borders (see mesher.js
// rebuildChunk + store.js ensureChunkArea); this rig pins the voxel-level
// contract without three.js: neighbour missing reads AIR (seam), neighbour
// ensured reads LAVA. Scoped to the Nether, the only dimension with a lazy
// chunk source in production.
import assert from "node:assert/strict";
import { AIR, LAVA, BLOCK_INFO } from "../../src/core/blocks.js";
import {
  CHUNK, setDimension, resetWorld, setBlock, getBlock,
  registerChunkSource, ensureChunkSource, ensureChunkArea, rimRefreshKeys,
} from "../../src/core/store.js";

// Mirror of liquidFaceVisible (src/render/mesher.js): a face renders only
// against a non-opaque, different block.
function faceVisible(id, n) {
  if (n === id) return false;
  const info = BLOCK_INFO[n];
  if (!info) return true;
  return !info.opaque;
}

setDimension("nether");
resetWorld("nether");

// Fake lazy source: each chunk materializes a flat lava sheet at y=0 once.
const seen = [];
registerChunkSource("nether", (cx, cz) => {
  const ck = cx + "_" + cz;
  if (seen.includes(ck)) return false;
  seen.push(ck);
  for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
    for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) setBlock(x, 0, z, LAVA);
  }
  return true;
});

// Border cell: last column of chunk (0,0); its +x neighbour lives in (1,0).
const bx = CHUNK - 1, bz = 0;

// 1. Old order repro: home chunk only — the lava-lava side reads AIR, seam on.
assert.equal(ensureChunkSource(0, 0, "nether"), true, "home chunk generates");
assert.equal(getBlock(bx, 0, bz), LAVA, "border cell is lava");
assert.equal(getBlock(bx + 1, 0, bz), AIR, "neighbour reads AIR before ensure");
assert.equal(faceVisible(LAVA, getBlock(bx + 1, 0, bz)), true, "seam face emitted");
console.log("PASS seam-repro");

// 2. New order: ensuring the 3x3 materializes the neighbour first.
{
  const fresh = ensureChunkArea(0, 0, 1, "nether");
  assert.deepEqual(fresh.sort(), ["-1_-1", "-1_0", "-1_1", "0_-1", "0_1", "1_-1", "1_0", "1_1"].sort(), "fresh keys reported");
  assert.equal(seen.length, 9, "full 3x3 visited");
}
assert.equal(getBlock(bx + 1, 0, bz), LAVA, "neighbour is lava after ensure");
assert.equal(faceVisible(LAVA, getBlock(bx + 1, 0, bz)), false, "lava-lava hides");
console.log("PASS seam-hidden");

// 3. Liquid-air faces subsist: the sheet top still renders.
assert.equal(faceVisible(LAVA, getBlock(bx, 1, bz)), true, "lava-air top stays");
console.log("PASS air-kept");

// 4. Idempotent: nothing fresh twice.
assert.deepEqual(ensureChunkArea(0, 0, 1, "nether"), [], "second ensure is clean");
assert.deepEqual(ensureChunkArea(5, 5, 1, "nope"), [], "unknown dim is a no-op");
console.log("PASS idempotent");

// 5. Surgical rim: only built neighbours of fresh voxels refresh, never self,
// and a fresh self still stales its older built neighbours.
{
  const built = new Set(["0_0", "1_0", "9_9"]);
  const hasBuilt = (k) => built.has(k);
  // Fresh self with a built neighbour: the neighbour refreshes, self doesn't.
  assert.deepEqual(rimRefreshKeys(["0_0"], "0_0", hasBuilt).sort(), ["1_0"], "fresh self stales built neighbour");
  // Fresh neighbour, nothing built around except self: no refresh at all.
  assert.deepEqual(rimRefreshKeys(["1_1"], "0_0", () => false), [], "unbuilt rim refreshes nothing");
  // Fresh far chunk: out-of-range built chunks never refresh.
  assert.deepEqual(rimRefreshKeys(["5_5"], "0_0", hasBuilt), [], "far fresh touches nothing built");
  // Self excluded even when built and adjacent to another fresh chunk.
  const r = rimRefreshKeys(["1_0"], "0_0", hasBuilt);
  assert.ok(!r.includes("0_0"), "self never requeued");
  assert.ok(!r.includes("9_9"), "non-adjacent never requeued");
  console.log("PASS rim-surgical");
}
console.log("ALL CHUNK-AREA PASS");
