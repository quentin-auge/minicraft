// Moon gone-flag: snow, low gravity and the moon hotbar retire only once
// no MOON rock and no MOON_WATER remain in the overworld — however the moon
// was destroyed (ultra band wipe, hand mining, rocket carve). Lazy + cached:
// mutation paths mark dirty, the next read scans with an early exit.
import assert from "node:assert/strict";
import { AIR, MOON, MOON_WATER } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, worlds, keyXYZ } from "../../../src/core/store.js";
import { generateMoon, isMoonGone, markMoonDirty, resetMoon } from "../../../src/world/moon.js";
import { deferMoonDirty, resetMoonDirty, noteMoonDirty, beginMoonGoneScan, pumpMoonGoneScan, moonGoneScanActive } from "../../../src/world/moon.js";

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

// 6. Deferred invalidation + sliced rescan (band wipes): mutations noted
// while deferred do not rescan; once the carve settles the scan starts and
// pumps to completion without ever hitching a frame. Reads stay cached
// (stale-alive) while it runs.
{
  resetWorld("over");
  resetMoon();
  setBlock(0, 900, 0, MOON);
  markMoonDirty();
  assert.equal(isMoonGone(), false, "lone moon block survives");
  deferMoonDirty();
  deferMoonDirty(); // nesting: two jobs in flight
  setBlock(0, 900, 0, AIR);
  noteMoonDirty();
  noteMoonDirty();
  assert.equal(isMoonGone(), false, "deferred wipe stays cached");
  beginMoonGoneScan();
  assert.equal(moonGoneScanActive(), true, "scan starts on settle");
  assert.equal(isMoonGone(), false, "reads stay cached while scanning");
  let pumps = 0;
  while (!pumpMoonGoneScan(0) && pumps < 100000) pumps++;
  assert.equal(moonGoneScanActive(), false, "scan completes");
  assert.equal(isMoonGone(), true, "completed scan reads gone");
  console.log(`PASS moon-scan pumps=${pumps}`);
  // A live block ends the scan early with an alive verdict.
  setBlock(0, 900, 0, MOON);
  markMoonDirty();
  deferMoonDirty();
  noteMoonDirty();
  beginMoonGoneScan();
  pumps = 0;
  while (!pumpMoonGoneScan(1000) && pumps < 100000) pumps++;
  assert.equal(isMoonGone(), false, "live block reads alive");
  // A direct mark mid-scan aborts it: the next read scans synchronously.
  setBlock(0, 900, 0, AIR);
  deferMoonDirty();
  noteMoonDirty();
  beginMoonGoneScan();
  assert.equal(moonGoneScanActive(), true, "scan running");
  setBlock(1, 900, 0, MOON);
  markMoonDirty(); // player edit path: abort, sync on next read
  assert.equal(moonGoneScanActive(), false, "direct mark aborts the scan");
  assert.equal(isMoonGone(), false, "sync read after abort");
  // A dropped wipe (travel/New World) resets and rescans now.
  setBlock(1, 900, 0, AIR);
  resetMoonDirty();
  assert.equal(isMoonGone(), true, "reset rescans immediately");
  noteMoonDirty(); // counter is back at zero: immediate again
  assert.equal(isMoonGone(), true, "post-reset marks stay immediate");
  console.log("PASS moon-defer-scan");
}

// 7. Sliced scan timing smoke: a synthetic six-figure map completes across
// several zero-budget pumps with the same verdict as the synchronous scan
// (loose bounds — dev-machine smoke, not a perf gate).
{
  resetWorld("over");
  resetMoon();
  for (let i = 0; i < 200000; i++) worlds.over.set(1000000 + i, 1);
  markMoonDirty();
  const t0 = performance.now();
  const syncVerdict = isMoonGone();
  const syncMs = performance.now() - t0;
  deferMoonDirty();
  noteMoonDirty();
  beginMoonGoneScan();
  let pumps = 0;
  const t1 = performance.now();
  while (!pumpMoonGoneScan(0) && pumps < 1000000) pumps++;
  const sliceMs = performance.now() - t1;
  assert.equal(moonGoneScanActive(), false, "synthetic scan completes");
  assert.equal(isMoonGone(), syncVerdict, "sliced verdict matches sync scan");
  assert.ok(pumps > 1, `scan slices across pumps (pumps=${pumps})`);
  console.log(`PASS moon-scan-timing sync=${syncMs.toFixed(1)}ms sliced=${sliceMs.toFixed(1)}ms pumps=${pumps}`);
}
