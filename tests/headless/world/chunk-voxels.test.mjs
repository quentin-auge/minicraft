// Chunk emptiness probe (store.chunkHasVoxels): three-free, node direct.
// Covers empty/floor-only/partial chunks, cross-chunk isolation, and the
// wipe pattern (fill a disc, clear it, probe empty again).
import assert from "node:assert/strict";
import { STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, chunkHasVoxels } from "../../../src/core/store.js";

setDimension("over");

// 1. Fresh world: every chunk probes empty.
{
  resetWorld("over");
  assert.equal(chunkHasVoxels(0, 0), false, "fresh origin chunk empty");
  assert.equal(chunkHasVoxels(-7, 5), false, "fresh far chunk empty");
}

// 2. One block flags its chunk only (negative-safe).
{
  resetWorld("over");
  setBlock(0, 0, 0, STONE);
  assert.equal(chunkHasVoxels(0, 0), true, "home chunk occupied");
  assert.equal(chunkHasVoxels(1, 0), false, "east neighbour empty");
  assert.equal(chunkHasVoxels(0, -1), false, "south neighbour empty");
  assert.equal(chunkHasVoxels(-1, -1), false, "diagonal neighbour empty");
  // Chunk border cell (x=16) belongs to chunk 1, not chunk 0.
  setBlock(16, 0, 0, STONE);
  assert.equal(chunkHasVoxels(1, 0), true, "border cell flags chunk 1");
}

// 3. The spared floor counts: a y=0-only chunk is not empty.
{
  resetWorld("over");
  setBlock(-5, 0, 33, STONE);
  assert.equal(chunkHasVoxels(-1, 2), true, "floor-only chunk occupied");
}

// 4. Wipe pattern: fill then clear a whole chunk, probe flips back.
{
  resetWorld("over");
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) setBlock(x, 900 + ((x + z) & 1), z, STONE);
  }
  assert.equal(chunkHasVoxels(0, 0), true, "filled chunk occupied");
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) setBlock(x, 900 + ((x + z) & 1), z, 0);
  }
  assert.equal(chunkHasVoxels(0, 0), false, "cleared chunk empty again");
  console.log("PASS chunk-voxels");
}
