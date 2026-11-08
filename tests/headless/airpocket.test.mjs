// Static air-pocket test: trapped air (bubble, well, mixed cavity) is a
// pocket, open air (surface, detached cube surroundings) is not. Same rule
// for every liquid; the mesher picks the face color through it at build.
import assert from "node:assert/strict";
import { WATER, LAVA, STONE } from "../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../src/core/store.js";
import { createPocketCache, isPocketAir } from "../../src/core/airpocket.js";

setDimension("over");

// 1. Closed bubble fully surrounded by water.
{
  resetWorld("over");
  const cache = createPocketCache();
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
    if (x === 0 && y === 0 && z === 0) continue;
    setBlock(x, y, z, WATER);
  }
  assert.equal(isPocketAir(0, 0, 0, cache), true, "bubble is a pocket");
  console.log("PASS bubble");
}

// 2. Well shaft open to the sky but walled with water stays a pocket;
// surface air beside it stays open.
{
  resetWorld("over");
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (x === 0 && z === 0) continue; // 1-wide air shaft at origin
    setBlock(x, 0, z, WATER);
  }
  const cache = createPocketCache();
  assert.equal(isPocketAir(0, 0, 0, cache), true, "shaft is a pocket");
  assert.equal(isPocketAir(0, 1, 0, createPocketCache()), false, "sky above is open");
  assert.equal(isPocketAir(10, 1, 10, createPocketCache()), false, "surface air is open");
  console.log("PASS well");
}

// 3. Detached water cube in air: the surrounding air is open, faces stay dark.
{
  resetWorld("over");
  setBlock(0, 0, 0, WATER);
  const cache = createPocketCache();
  assert.equal(isPocketAir(1, 0, 0, cache), false, "cube neighbour air is open");
  assert.equal(isPocketAir(0, 1, 0, cache), false, "air above cube is open");
  console.log("PASS cube");
}

// 4. Mixed water + stone cavity traps.
{
  resetWorld("over");
  const cache = createPocketCache();
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (x === 0 && y === 0 && z === 0) continue;
    setBlock(x, y, z, (x + y + z) % 2 === 0 ? WATER : STONE);
  }
  assert.equal(isPocketAir(0, 0, 0, cache), true, "mixed cavity is a pocket");
  console.log("PASS mixed");
}

// 5. Same rule in lava: closed lava bubble traps.
{
  resetWorld("over");
  const cache = createPocketCache();
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (x === 0 && y === 0 && z === 0) continue;
    setBlock(x, y, z, LAVA);
  }
  assert.equal(isPocketAir(0, 0, 0, cache), true, "lava bubble is a pocket");
  assert.equal(isPocketAir(20, 5, 20, createPocketCache()), false, "far air stays open");
  console.log("PASS lava");
}

// 6. Non-air cells never count; open flood hits the cap and reads open.
{
  resetWorld("over");
  setBlock(0, 0, 0, WATER);
  const cache = createPocketCache();
  assert.equal(isPocketAir(0, 0, 0, cache), false, "water cell is not a pocket");
  console.log("PASS nonair");
}
console.log("ALL AIRPOCKET PASS");
