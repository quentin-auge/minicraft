// In-fill debris purge: placements made on a still-unbuilt body that end up
// floating (chords cut the curvature before the shell exists) are removed
// at fill completion; supported keeps survive. Three-free, node direct.
import assert from "node:assert/strict";
import { AIR, STONE, MOON } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { keepBodyCell, purgeUnsupportedKeeps, resetMoon } from "../../../src/world/moon.js";

setDimension("over");
resetWorld("over");
resetMoon();

const seed = 424242;
const spec = { key: "purge-test", cx: 0, cz: 0, r: 6, top: 20, bottom: 0, rock: MOON, water: 21 };
// Supported keep: rock on stone.
setBlock(6, 0, 6, STONE);
setBlock(6, 1, 6, MOON);
keepBodyCell(seed, spec.key, 6, 1, 6);
// Floating keep: rock over air.
setBlock(5, 2, 5, MOON);
keepBodyCell(seed, spec.key, 5, 2, 5);
// Unrelated voxel: never touched (not kept).
setBlock(7, 3, 7, MOON);

const touched = purgeUnsupportedKeeps(spec, seed, setBlock, getBlock);
assert.equal(getBlock(5, 2, 5), AIR);
assert.equal(getBlock(6, 1, 6), MOON);
assert.equal(getBlock(7, 3, 7), MOON);
assert.deepEqual(touched, [[5, 2, 5]]);
// Keep-set drained: a second purge is a no-op.
assert.deepEqual(purgeUnsupportedKeeps(spec, seed, setBlock, getBlock), []);
console.log("PASS body purge");
