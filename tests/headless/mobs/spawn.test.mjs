// Cheat spawn service: catalog, selection, cycle, and dispatch. Three-free
// (registry + spawn only, no THREE, no voxels) — stub kinds stand in for the
// real farm/end registrations, so the catalog and picker rules stay
// headless-testable. Plain `node` direct.
import assert from "node:assert/strict";
import { registerMobType, mobLabel } from "../../../src/mobs/registry.js";
import {
  spawnCatalog, createSpawnSelection, moveCursor, toggleAtCursor,
  selectedKinds, nextSpawnKey, spawnMobAt,
} from "../../../src/mobs/spawn.js";

const seen = [];
registerMobType({ key: "__spawn_zebra", label: "Zebra", spawn: (ctx) => { seen.push(["zebra", ctx]); return "z"; } });
registerMobType({ key: "__spawn_apple", label: "Apple", spawn: () => "a" });
registerMobType({ key: "__spawn_mango", label: "Mango" });

// --- catalog: only spawn-hooked kinds, alphabetical by label ---
const catalog = spawnCatalog().filter((e) => e.key.startsWith("__spawn_"));
assert.deepEqual(catalog.map((e) => e.key), ["__spawn_apple", "__spawn_zebra"]);
assert.equal(catalog.find((e) => e.key === "__spawn_mango"), undefined);

// --- labels: explicit label wins, else capitalized key ---
assert.equal(mobLabel("__spawn_zebra"), "Zebra");
registerMobType({ key: "__spawn_plain" });
assert.equal(mobLabel("__spawn_plain"), "__spawn_plain"[0].toUpperCase() + "__spawn_plain".slice(1));

// --- selection defaults to the classic farm pair ---
const fresh = createSpawnSelection();
assert.deepEqual([...fresh.keys].sort(), ["cow", "pig"]);
assert.equal(fresh.cursor, 0);

// --- cursor wraps at both ends ---
const sel = createSpawnSelection();
sel.keys = new Set();
sel.cursor = 0;
moveCursor(sel, catalog, -1);
assert.equal(sel.cursor, catalog.length - 1);
moveCursor(sel, catalog, 1);
assert.equal(sel.cursor, 0);

// --- toggle ticks/unticks the kind under the cursor, in catalog order ---
sel.cursor = 0;
toggleAtCursor(sel, catalog);
assert.deepEqual(selectedKinds(sel, catalog).map((e) => e.key), ["__spawn_apple"]);
sel.cursor = 1;
toggleAtCursor(sel, catalog);
assert.deepEqual(selectedKinds(sel, catalog).map((e) => e.key), ["__spawn_apple", "__spawn_zebra"]);
sel.cursor = 0;
toggleAtCursor(sel, catalog);
assert.deepEqual(selectedKinds(sel, catalog).map((e) => e.key), ["__spawn_zebra"]);

// --- cycle walks the ticked kinds in turn, empty selection gives null ---
const cyc = createSpawnSelection();
cyc.keys = new Set(["__spawn_zebra", "__spawn_apple"]);
cyc.cycle = 0;
assert.equal(nextSpawnKey(cyc, catalog), "__spawn_apple");
assert.equal(nextSpawnKey(cyc, catalog), "__spawn_zebra");
assert.equal(nextSpawnKey(cyc, catalog), "__spawn_apple");
const empty = createSpawnSelection();
empty.keys = new Set();
assert.equal(nextSpawnKey(empty, catalog), null);

// --- dispatch owns the model: the hook gets ctx, missing hooks give null ---
const ctx = { scene: null, dim: "over", x: 1, y: 2, z: 3, rand: Math.random };
assert.equal(spawnMobAt("__spawn_zebra", ctx), "z");
assert.deepEqual(seen[0][1], ctx);
assert.equal(spawnMobAt("__spawn_mango", ctx), null);
assert.equal(spawnMobAt("__spawn_missing", ctx), null);

console.log("spawn: all PASS");
