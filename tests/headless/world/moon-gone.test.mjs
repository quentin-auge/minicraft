// Moon gone-flag: snow, low gravity and the moon hotbar retire only once
// no MOON rock and no MOON_WATER remain in the overworld — however the moon
// was destroyed (ultra band wipe, hand mining, rocket carve). Lazy + cached:
// mutation paths mark dirty, the next read scans with an early exit.
import assert from "node:assert/strict";
import { AIR, MOON, MOON_WATER } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, worlds, keyXYZ } from "../../../src/core/store.js";
import { generateMoon, isMoonGone, markMoonDirty, resetMoon } from "../../../src/world/moon.js";

setDimension("over");

function clearIds(...ids) {
  const targets = [];
  for (const [k, v] of worlds.over) {
    if (ids.includes(v)) targets.push(keyXYZ(k));
  }
  for (const [x, y, z] of targets) setBlock(x, y, z, AIR);
  return targets.length;
}

// 1. A generated moon is not gone.
{
  resetWorld("over");
  resetMoon();
  generateMoon(7, setBlock);
  assert.equal(isMoonGone(), false, "generated moon survives");
  console.log("PASS moon-present");
}

// 2. Wiping every lunar block (rock + water) marks the moon gone.
{
  const n = clearIds(MOON, MOON_WATER);
  assert.ok(n > 0, "wipe removes lunar blocks");
  markMoonDirty();
  assert.equal(isMoonGone(), true, "fully wiped moon is gone");
  assert.equal(isMoonGone(), true, "cached read stays gone");
  console.log(`PASS moon-gone ${n}`);
}

// 3. The flag is lazy: a silent restore stays cached until marked dirty.
{
  setBlock(0, 900, 0, MOON);
  assert.equal(isMoonGone(), true, "unmarked restore stays cached");
  markMoonDirty();
  assert.equal(isMoonGone(), false, "marked restore revives the moon");
  setBlock(0, 900, 0, AIR);
  markMoonDirty();
  assert.equal(isMoonGone(), true, "re-wipe is gone again");
  console.log("PASS moon-lazy");
}

// 4. Water alone still counts as moon: rock-only wipe is not gone.
{
  resetWorld("over");
  resetMoon();
  generateMoon(999, setBlock);
  const rock = clearIds(MOON);
  assert.ok(rock > 0, "rock wipe removes blocks");
  markMoonDirty();
  assert.equal(isMoonGone(), false, "lone moon water still counts");
  const water = clearIds(MOON_WATER);
  assert.ok(water > 0, "water wipe removes blocks");
  markMoonDirty();
  assert.equal(isMoonGone(), true, "rock + water wipe is gone");
  console.log(`PASS moon-water ${rock}/${water}`);
}

// 5. An empty world (fresh reset) reads as gone.
{
  resetWorld("over");
  resetMoon();
  assert.equal(isMoonGone(), true, "empty world has no moon");
  console.log("PASS moon-empty");
}
