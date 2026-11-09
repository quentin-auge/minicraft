// Placement vs mobs: a solid cell overlapping a live same-dim body box is
// refused (the tryPlace guard in player/edit.js delegates here). Pure
// three-free rule (mobs/carry.js cellBlockedByMob), duck-typed mobs, no
// voxels, no store, no THREE — plain `node` direct.
import assert from "node:assert/strict";
import { cellBlockedByMob } from "../../../src/mobs/carry.js";

// Feet-centered pig body: hw 0.32, h 0.92, standing on y = 5.
const pig = { pos: { x: 0.5, y: 5, z: 0.5 }, hw: 0.32, h: 0.92, alive: true, dim: "over" };

// --- occupied cells block ---
assert.equal(cellBlockedByMob([pig], "over", 0, 5, 0), true, "feet cell blocked");
assert.equal(cellBlockedByMob([pig], "over", 0, 4, 0), false, "feet exactly on the ceiling face of the cell below is free");
assert.equal(cellBlockedByMob([pig], "over", 0, 6, 0), false, "cell above the head is free");

// --- touching but not overlapping cells stay free ---
const edge = { pos: { x: 1 + 0.32, y: 5, z: 0.5 }, hw: 0.32, h: 1, alive: true, dim: "over" };
assert.equal(cellBlockedByMob([edge], "over", 0, 5, 0), false, "flank exactly touching the face is free");
assert.equal(cellBlockedByMob([edge], "over", 1, 5, 0), true, "the cell the body stands in is blocked");
const capped = { pos: { x: 0.5, y: 5, z: 0.5 }, hw: 0.32, h: 1, alive: true, dim: "over" };
assert.equal(cellBlockedByMob([capped], "over", 0, 6, 0), false, "head exactly at the ceiling face is free");
assert.equal(cellBlockedByMob([capped], "over", 0, 5, 0), true, "head below the ceiling blocks");

// --- tall bodies (cow h 1.3, enderman h 2.7) block their whole column ---
const cow = { pos: { x: 0.5, y: 5, z: 0.5 }, hw: 0.32, h: 1.3, alive: true, dim: "over" };
assert.equal(cellBlockedByMob([cow], "over", 0, 5, 0), true);
assert.equal(cellBlockedByMob([cow], "over", 0, 6, 0), true, "cow head reaches into the cell above");
assert.equal(cellBlockedByMob([cow], "over", 0, 7, 0), false);
const enderman = { pos: { x: 0.5, y: 5, z: 0.5 }, hw: 0.31, h: 2.7, alive: true, dim: "end" };
assert.equal(cellBlockedByMob([enderman], "end", 0, 7, 0), true, "tall body blocks two cells up");
assert.equal(cellBlockedByMob([enderman], "end", 0, 8, 0), false);

// --- dead, foreign-dim, and carried mobs never block ---
assert.equal(cellBlockedByMob([{ ...pig, alive: false }], "over", 0, 5, 0), false, "dead mob is free");
assert.equal(cellBlockedByMob([pig], "end", 0, 5, 0), false, "other-dim placement ignores the mob");
assert.equal(cellBlockedByMob([{ ...pig, dim: "end" }], "over", 0, 5, 0), false, "other-dim mob never blocks");
assert.equal(cellBlockedByMob([{ ...pig, _carried: true }], "over", 0, 5, 0), false, "hook-held mob never blocks");

// --- defaults and robustness ---
assert.equal(cellBlockedByMob([], "over", 0, 5, 0), false, "no mobs: free");
assert.equal(cellBlockedByMob([{ pos: { x: 0.5, y: 5, z: 0.5 }, alive: true }], "over", 0, 5, 0), true, "missing hw/h falls back to 0.32/1");
assert.equal(cellBlockedByMob([{ pos: { x: 0.5, y: 5, z: 0.5 }, alive: true, dim: undefined }], "over", 0, 5, 0), true, "missing dim reads as over");
assert.equal(cellBlockedByMob([{ hw: 0.32, h: 1, alive: true }], "over", 0, 5, 0), false, "body without coordinates is skipped");
assert.equal(cellBlockedByMob([null, undefined, pig], "over", 0, 5, 0), true, "null entries are skipped");

// --- one blocker among many is enough; distant peers never block ---
const far = { pos: { x: 50.5, y: 5, z: 50.5 }, hw: 0.32, h: 1, alive: true, dim: "over" };
assert.equal(cellBlockedByMob([far], "over", 0, 5, 0), false, "distant peer never blocks");
assert.equal(cellBlockedByMob([far, pig], "over", 0, 5, 0), true, "one overlapping body blocks");

console.log("place-mob-block: all PASS");
