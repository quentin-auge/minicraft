// Pure corridor-policy tests: no voxels, no store, scripted open sets.
// The kinematic proof (real mover + real voxels) is mob-paths.test.mjs.
import assert from "node:assert/strict";
import {
  normYaw, yawDiff, snapCardinal, oppositeYaw, dirVec,
  classifyExits, junctionOptions, pickExit, updateLane,
} from "../../../src/mobs/corridor.js";

const N = 0, E = Math.PI / 2, S = Math.PI, W = -Math.PI / 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- helpers ---
assert.equal(snapCardinal(0.1), N);
assert.equal(snapCardinal(1.7), E);
assert.equal(snapCardinal(Math.PI), S);
assert.equal(snapCardinal(-1.4), W);
assert.ok(Math.abs(normYaw(oppositeYaw(N) - S)) < 1e-9);
assert.ok(Math.abs(normYaw(oppositeYaw(E) - W)) < 1e-9);
assert.deepEqual(dirVec(N), [0, 1]);
assert.deepEqual(dirVec(S), [0, -1]);
assert.deepEqual(dirVec(E), [1, 0]);
assert.deepEqual(dirVec(W), [-1, 0]);
console.log("PASS helpers");

// --- classifyExits delegates to the injected predicate ---
{
  const blocked = new Set(["1,0", "-1,0"]); // walls east+west of origin
  const isBlocked = (x, z) => blocked.has(`${Math.floor(x)},${Math.floor(z)}`);
  const opens = classifyExits(0.5, 0.5, isBlocked);
  assert.deepEqual(new Set(opens), new Set([N, S]));
}
console.log("PASS classifyExits");

// --- junctionOptions excludes the entry way (no U-turn at junctions) ---
assert.deepEqual(new Set(junctionOptions([N, S, E, W], S)), new Set([N, E, W]));
assert.deepEqual(junctionOptions([N, S], S), [N]);
assert.deepEqual(junctionOptions([S], S), []);
console.log("PASS junctionOptions");

// --- straight walk: engage once, cruise forever, never uturn/release ---
{
  let lane = null, events = [];
  for (let c = 0; c < 6; c++) {
    const r = updateLane(lane, 0, c, N, [N, S]);
    lane = r.lane; events.push(r.event);
  }
  assert.equal(events[0], "engage");
  assert.ok(events.slice(1).every((e) => e === "cruise"));
  assert.equal(lane.axis, N);
}
console.log("PASS straight");

// --- L turn: one forced junction, axis flips, entry follows ---
{
  let lane = null;
  let r = updateLane(lane, 0, 0, N, [N, S]); lane = r.lane;
  assert.equal(r.event, "engage");
  r = updateLane(lane, 0, 2, N, [S, E]); lane = r.lane; // corner cell
  assert.equal(r.event, "junction");
  assert.equal(lane.axis, E);
  assert.ok(Math.abs(normYaw(lane.entry - W)) < 1e-9);
  r = updateLane(lane, 0, 2, E, [S, E]); lane = r.lane; // same cell: locked
  assert.equal(r.event, "lock-turn");
  r = updateLane(lane, 1, 2, E, [W, E]); lane = r.lane; // next arm: cruise
  assert.equal(r.event, "cruise");
}
console.log("PASS l-turn");

// --- dead end: single uturn onto the entry way ---
{
  let lane = { axis: N, entry: S, lockX: -1, lockZ: -1, wide: 0 };
  const r = updateLane(lane, 0, 2, N, [S]);
  assert.equal(r.event, "uturn");
  assert.equal(r.lane.axis, S);
  assert.equal(r.lane.entry, N);
}
console.log("PASS dead-end");

// --- T junction: random branch, both taken over trials, entry never ---
{
  const seen = new Set();
  for (let t = 0; t < 60; t++) {
    const lane = { axis: N, entry: S, lockX: -1, lockZ: -1, wide: 0 };
    // Cross cell approached from the south: N/E/W open, S is the entry.
    const r2 = updateLane(lane, 1, 2, N, [N, E, W], mulberry32(1000 + t));
    assert.equal(r2.event, "junction");
    seen.add(r2.lane.axis);
    assert.ok(Math.abs(normYaw(r2.lane.axis - S)) > 0.1, "never back south");
  }
  assert.ok(seen.has(N) && seen.has(E) && seen.has(W), `all branches taken, got ${[...seen]}`);
}
console.log("PASS t-junction-branches");

// --- release: two free-choice cells in a row open onto a field ---
{
  let lane = { axis: N, entry: S, lockX: -1, lockZ: -1, wide: 0 };
  let r = updateLane(lane, 0, 0, N, [N, S, E], mulberry32(7));
  assert.equal(r.event, "junction");
  lane = r.lane;
  r = updateLane(lane, 0, 1, N, [N, S, E, W], mulberry32(8));
  assert.equal(r.event, "release");
  assert.equal(r.lane, null);
}
console.log("PASS release");

// --- pickExit is uniform-ish over many draws ---
{
  const counts = new Map();
  const rand = mulberry32(42);
  for (let t = 0; t < 3000; t++) {
    const e = pickExit([N, E, W], rand);
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  for (const [, c] of counts) assert.ok(c > 800 && c < 1200, `balanced draw, got ${c}`);
}
console.log("PASS pickExit-balance");

console.log("corridor.test.mjs: ALL PASS");
