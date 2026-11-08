// Static air-pocket test: trapped air (bubble, well, mixed cavity) is a
// pocket, open air (surface, detached cube surroundings) is not. Same rule
// for every liquid; the mesher picks the face color through it at build.
// Moon fringe: joined lake shafts keep no pocket-air neighbor of moon water.
import assert from "node:assert/strict";
import { WATER, LAVA, STONE, MOON, MOON_WATER, AIR } from "../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../src/core/store.js";
import { createPocketCache, isPocketAir } from "../../src/core/airpocket.js";
import { generateMoon, moonLakeParams, MOON_R, MOON_SURFACE_Y, MOON_MIN_Y } from "../../src/world/moon.js";

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

// 7. Joined moon fringe: no air neighbor of moon water reads as a pocket.
for (const seed of [7, 999, 4242]) {
  resetWorld("over");
  generateMoon(seed, setBlock, getBlock);
  const cache = createPocketCache();
  let pockets = 0;
  for (let x = -MOON_R; x <= MOON_R; x++) {
    for (let z = -MOON_R; z <= MOON_R; z++) {
      if (x * x + z * z > MOON_R * MOON_R) continue;
      for (let y = MOON_MIN_Y - 1; y <= MOON_SURFACE_Y + 1; y++) {
        if (getBlock(x, y, z) !== MOON_WATER) continue;
        const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (const [dx, dy, dz] of nb) {
          if (getBlock(x + dx, y + dy, z + dz) !== AIR) continue;
          if (isPocketAir(x + dx, y + dy, z + dz, cache)) pockets++;
        }
      }
    }
  }
  assert.equal(pockets, 0, `seed ${seed} keeps no moon pocket air`);
  console.log(`PASS moon-fringe ${seed}`);
}

// 8. Joined moon lakes: no moon-rock cell fully ringed by moon water.
for (const seed of [7, 999, 4242]) {
  resetWorld("over");
  generateMoon(seed, setBlock, getBlock);
  let ringed = 0;
  for (const { cx, cz, cr } of moonLakeParams(seed)) {
    for (let x = cx - cr - 2; x <= cx + cr + 2; x++) {
      for (let z = cz - cr - 2; z <= cz + cr + 2; z++) {
        for (let y = MOON_SURFACE_Y - 6; y <= MOON_SURFACE_Y; y++) {
          if (getBlock(x, y, z) !== MOON) continue;
          if (
            getBlock(x + 1, y, z) === MOON_WATER && getBlock(x - 1, y, z) === MOON_WATER &&
            getBlock(x, y, z + 1) === MOON_WATER && getBlock(x, y, z - 1) === MOON_WATER
          ) ringed++;
        }
      }
    }
  }
  assert.equal(ringed, 0, `seed ${seed} keeps no ringed moon rock`);
  console.log(`PASS moon-norock ${seed}`);
}
console.log("ALL AIRPOCKET PASS");
