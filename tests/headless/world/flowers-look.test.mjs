// Flower look memory: exact-look restore for flowers that leave the world
// and come back (a vessel stamping its own blooms). Three-free, node direct.
import assert from "node:assert/strict";
import {
  noteFlowerPlace, noteFlowerPlaceShared, flowerVariantAt, flowerAngleAt,
  clearFlowerAt, resetFlowerMemory,
} from "../../../src/world/flowers.js";

{
  resetFlowerMemory();
  // Shared write stores the given look verbatim, no roll.
  noteFlowerPlaceShared(10, 20, 30, 4, 1.25);
  assert.equal(flowerVariantAt(10, 20, 30), 4, "shared write keeps the variant");
  assert.equal(flowerAngleAt(10, 20, 30), 1.25, "shared write keeps the angle");
  // Overwriting with a shared look replaces the rolled one exactly.
  noteFlowerPlace(10, 20, 30);
  const rolledV = flowerVariantAt(10, 20, 30);
  noteFlowerPlaceShared(10, 20, 30, 2, 0.5);
  assert.equal(flowerVariantAt(10, 20, 30), 2, "shared write replaces the variant");
  assert.equal(flowerAngleAt(10, 20, 30), 0.5, "shared write replaces the angle");
  assert.ok(rolledV >= 0, "rolled variant in range");
  // Clear drops both channels; reads fall back to 0, never compute.
  clearFlowerAt(10, 20, 30);
  assert.equal(flowerVariantAt(10, 20, 30), 0, "cleared variant falls back to 0");
  assert.equal(flowerAngleAt(10, 20, 30), 0, "cleared angle falls back to 0");
  resetFlowerMemory();
}

console.log("flowers-look.test.mjs: ok");
