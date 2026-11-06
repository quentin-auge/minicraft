// Pure corridor-policy tests: no voxels, no store, scripted open sets.
// Entry detection (findEntries) is pure here; the kinematic proof (real
// mover + real voxels, attraction draws, cooldowns) is mob-paths.test.mjs.
import assert from "node:assert/strict";
import {
  normYaw, yawDiff, snapCardinal, oppositeYaw, dirVec,
  rayDist, sideBranch, classifyExits, segmentTunneled, isTwoWideMouth, findEntries,
  ENTRY_R_1W, ENTRY_R_2W, ENTRY_P, MIN_FLANK,
  junctionOptions, pickExit, updateLane,
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

// --- classifyExits: axis-aware, sides count only when they branch ---
{
  // 1-wide straight along z at x=0: walls east+west, open north+south.
  const solid = new Set(["1,0", "-1,0", "1,1", "-1,1"]);
  const pointFree = (x, z) => !solid.has(`${Math.floor(x)},${Math.floor(z)}`);
  const cellFree = (bx, bz) => !solid.has(`${bx},${bz}`);
  assert.deepEqual(new Set(classifyExits(0.5, 0.5, N, pointFree, cellFree)), new Set([N, S]));
}
console.log("PASS classifyExits");

// --- sideBranch: mouth + (far or non-continuing) ---
assert.equal(sideBranch(false, false, false), false); // wall
assert.equal(sideBranch(true, true, true), true);     // long/wide arm
assert.equal(sideBranch(true, false, false), true);   // 1-cell arm, doorway
assert.equal(sideBranch(true, false, true), false);   // own corridor lane
assert.equal(sideBranch(true, true, false), true);
console.log("PASS sideBranch");

// --- rayDist: first-blocked distance along a ray ---
{
  const blocked = new Set(["2,0"]);
  const blockedAt = (x) => blocked.has(`${Math.floor(x)},0`);
  assert.ok(Math.abs(rayDist(0.5, 0.5, 1, 0, blockedAt, 4, 0.1) - 1.5) < 0.15);
  assert.equal(rayDist(0.5, 0.5, -1, 0, blockedAt, 4, 0.1), 4);
}
console.log("PASS rayDist");

// --- 2-wide straight: neighbouring lane is not a branch (no pinball) ---
// Mob hugging the west wall (x=0.6): the east point probe is free, but the
// mouth cell continues alongside with a wall beyond — own corridor.
{
  const wall = (x) => x < 0 || x > 1;
  const pointFree = (x) => !wall(Math.floor(x - 0.32)) && !wall(Math.floor(x + 0.32));
  const cellFree = (bx) => !wall(bx);
  const opens = classifyExits(0.6, 2.5, N, pointFree, (bx) => cellFree(bx));
  assert.deepEqual(new Set(opens), new Set([N, S]));
}
console.log("PASS no-pinball-2wide");

// --- segmentTunneled: a junction/lock-turn exit must keep the 1-wide rail ---
// A step C→A is tunneled unless a whole side of the segment stands open.
// 1-cell jogs pass (the bend walls the other half of the segment); room,
// widening, field, and 2-wide steps fail a side and release to roam.
{
  // Zigzag jog east from (0,1) to (1,1): north walled on the ahead half
  // ([1,0]), south walled on the current half ([0,2]) — the bend counts.
  const jog = new Set(["1,0", "0,2", "-1,1", "0,0", "2,1"]);
  const jogFree = (bx, bz) => !jog.has(`${bx},${bz}`);
  assert.equal(segmentTunneled(0.5, 1.5, E, jogFree), true);
  // T arm east from (1,2) to (2,2): both halves walled per side.
  const tee = new Set(["2,1", "2,3", "1,3", "0,2"]);
  const teeFree = (bx, bz) => !tee.has(`${bx},${bz}`);
  assert.equal(segmentTunneled(1.5, 2.5, E, teeFree), true);
  // Room step west from (0,4) to (-1,4): north side fully open.
  const room = new Set(["-2,4", "2,4", "-2,5", "2,5", "-1,6", "0,6", "1,6"]);
  const roomFree = (bx, bz) => !room.has(`${bx},${bz}`);
  assert.equal(segmentTunneled(0.5, 4.5, W, roomFree), false);
  // Field step north from (0,4) to (0,5): west side fully open.
  assert.equal(segmentTunneled(0.5, 4.5, N, () => true), false);
  // 2-wide step north with the parallel lane open both halves: not 1-wide.
  const wide2 = new Set(["-1,2", "-1,3", "2,2", "2,3"]);
  const wide2Free = (bx, bz) => !wide2.has(`${bx},${bz}`);
  assert.equal(segmentTunneled(0.5, 2.5, N, wide2Free), false);
}
console.log("PASS segmentTunneled");

// --- isTwoWideMouth: exit row + 2 free rows ahead, 2+1 solid flanks ---
// Example pattern, travel along N: exit row z=2 (pair x=0,1, west 2-run at
// x=-1,-2, east 1-run at x=2), rows z=3,4 free, behind (z=1) don't-care.
// Free reads walkable, solid reads solid-only (water/drop rims never hold).
{
  const solids = new Set(["-1,2", "-2,2", "2,2"]);
  const free = (bx, bz) => !solids.has(`${bx},${bz}`);
  const solid = (bx, bz) => solids.has(`${bx},${bz}`);
  assert.equal(isTwoWideMouth(0, 2, N, free, solid), true); // left pair cell
  assert.equal(isTwoWideMouth(1, 2, N, free, solid), true); // right pair cell
  // Mirror: run of 1 west, run of 2 east.
  const mirror = new Set(["-1,2", "2,2", "3,2"]);
  const mfree = (bx, bz) => !mirror.has(`${bx},${bz}`);
  const msolid = (bx, bz) => mirror.has(`${bx},${bz}`);
  assert.equal(isTwoWideMouth(0, 2, N, mfree, msolid), true);
  assert.equal(isTwoWideMouth(1, 2, N, mfree, msolid), true);
  // Walled behind: the exit doesn't care, still a mouth.
  const backed = new Set(["-1,2", "-2,2", "2,2", "0,1", "1,1"]);
  assert.equal(isTwoWideMouth(0, 2, N, (bx, bz) => !backed.has(`${bx},${bz}`), (bx, bz) => backed.has(`${bx},${bz}`)), true);
  // Symmetric thin gap (XOOX both sides): not a mouth, plain roam.
  const sym = new Set(["-1,2", "2,2"]);
  assert.equal(isTwoWideMouth(0, 2, N, (bx, bz) => !sym.has(`${bx},${bz}`), (bx, bz) => sym.has(`${bx},${bz}`)), false);
  assert.equal(isTwoWideMouth(1, 2, N, (bx, bz) => !sym.has(`${bx},${bz}`), (bx, bz) => sym.has(`${bx},${bz}`)), false);
  // Broken long run (only 1 east): no mouth.
  const stub = new Set(["-1,2", "-2,2"]);
  assert.equal(isTwoWideMouth(0, 2, N, (bx, bz) => !stub.has(`${bx},${bz}`), (bx, bz) => stub.has(`${bx},${bz}`)), false);
  // Lone wall west, open field east: wall-following latches normally.
  const lone = new Set(["-1,2"]);
  assert.equal(isTwoWideMouth(0, 2, N, (bx, bz) => !lone.has(`${bx},${bz}`), (bx, bz) => lone.has(`${bx},${bz}`)), false);
  // Non-solid flanks (water/drop cells read free, never solid): no mouth.
  const wet = new Set(["-1,2", "-2,2"]);
  const wetFree = () => true;
  assert.equal(isTwoWideMouth(0, 2, N, wetFree, (bx, bz) => wet.has(`${bx},${bz}`)), false);
  // Second row ahead blocked.
  const shut2 = new Set(["-1,2", "-2,2", "2,2", "0,4"]);
  assert.equal(isTwoWideMouth(0, 2, N, (bx, bz) => !shut2.has(`${bx},${bz}`), (bx, bz) => shut2.has(`${bx},${bz}`)), false);
  // First row ahead blocked.
  const shut1 = new Set(["-1,2", "-2,2", "2,2", "1,3"]);
  assert.equal(isTwoWideMouth(0, 2, N, (bx, bz) => !shut1.has(`${bx},${bz}`), (bx, bz) => shut1.has(`${bx},${bz}`)), false);
  // Open field: nothing anywhere.
  assert.equal(isTwoWideMouth(0, 2, N, () => true, () => false), false);
  // Same pattern rotated: travel along E, exit col x=2, pair z=0,1, ahead
  // cols x=3,4, south 1-run at (2,-1), north 2-run at (2,2),(2,3).
  const erot = new Set(["2,-1", "2,2", "2,3"]);
  assert.equal(isTwoWideMouth(2, 0, E, (bx, bz) => !erot.has(`${bx},${bz}`), (bx, bz) => erot.has(`${bx},${bz}`)), true);
  assert.equal(isTwoWideMouth(2, 1, E, (bx, bz) => !erot.has(`${bx},${bz}`), (bx, bz) => erot.has(`${bx},${bz}`)), true);
}
console.log("PASS isTwoWideMouth");

// --- entry tuning constants ---
assert.equal(ENTRY_R_1W, 3.0);
assert.equal(ENTRY_R_2W, 4.0);
assert.equal(ENTRY_P, 0.5);
assert.equal(MIN_FLANK, 2);
console.log("PASS entry-tuning");

// --- findEntries 1-wide: mouth + 2 depth free (entry included), open approach ---
// Corridor (0,2..4) with banks at x=±1 (z=2..4), open field elsewhere.
{
  const bank = new Set(["1,2", "-1,2", "1,3", "-1,3", "1,4", "-1,4"]);
  const cellFree = (bx, bz) => !bank.has(`${bx},${bz}`);
  const found = findEntries(0.5, 5.5, cellFree);
  assert.equal(found.length, 2);
  assert.equal(found[0].kind, "one");
  assert.deepEqual([found[0].bx, found[0].bz], [0, 4]);
  assert.ok(Math.abs(found[0].dist - 1.0) < 1e-9);
  assert.deepEqual([found[0].x, found[0].z], [0.5, 4.5]);
  // Far mouth still in range (dist exactly ENTRY_R_1W = 3.0), sorted second.
  assert.deepEqual([found[1].bx, found[1].bz], [0, 2]);
  // Past it reads out.
  assert.ok(!findEntries(0.5, 5.6, cellFree).some((e) => e.bx === 0 && e.bz === 2));
  // Past 1-wide range the far mouth drops (near one stays).
  assert.ok(!findEntries(0.5, 6.5, cellFree).some((e) => e.bx === 0 && e.bz === 2));
  assert.ok(findEntries(0.5, 6.5, cellFree).some((e) => e.bx === 0 && e.bz === 4));
  // Mouth flank opening kills the mouth (the far one is out of 1-wide range).
  const opened = new Set([...bank].filter((k) => k !== "1,4"));
  const openedFree = (bx, bz) => !opened.has(`${bx},${bz}`);
  assert.ok(!findEntries(0.5, 6.5, openedFree).some((e) => e.bx === 0 && e.bz === 4));
  // Walled-shut depth kills it: behind2 blocked, no run to walk.
  const shallow = new Set([...bank, "0,2"]);
  const shallowFree = (bx, bz) => !shallow.has(`${bx},${bz}`);
  assert.ok(!findEntries(0.5, 6.5, shallowFree).some((e) => e.bx === 0 && e.bz === 4));
  // Depth flanks are NOT required: opening a depth flank keeps the mouth.
  const openDepth = new Set([...bank].filter((k) => k !== "1,3"));
  assert.ok(findEntries(0.5, 6.5, (bx, bz) => !openDepth.has(`${bx},${bz}`))
    .some((e) => e.kind === "one" && e.bx === 0 && e.bz === 4),
    "open depth flank: mouth still lists");
  // Lone pillar flank never holds a mouth: stripping a whole flank file
  // down to the mouth row alone (held 1 < MIN_FLANK) kills it, while a
  // single open depth cell keeps it (held 2).
  const pillar = new Set([...bank].filter((k) => k !== "1,3" && k !== "1,2"));
  assert.ok(!findEntries(0.5, 6.5, (bx, bz) => !pillar.has(`${bx},${bz}`))
    .some((e) => e.kind === "one" && e.bx === 0 && e.bz === 4),
    "pillar flank: no mouth");
  // 1-wide keeps the single-side approach clause: walling one approach
  // flank (corner-door shape) keeps the mouth.
  const oneSide = new Set([...bank, "1,5"]);
  assert.ok(findEntries(0.5, 6.5, (bx, bz) => !oneSide.has(`${bx},${bz}`))
    .some((e) => e.kind === "one" && e.bx === 0 && e.bz === 4),
    "single-open approach: 1-wide still lists");
  // Mid-corridor cells never match (approach itself walled both sides):
  // only the two true mouths list, even standing inside.
  const inside = findEntries(0.5, 3.5, cellFree);
  assert.ok(inside.every((e) => (e.bx === 0 && e.bz === 4) || (e.bx === 0 && e.bz === 2)),
    `only mouths, got ${JSON.stringify(inside)}`);
}
console.log("PASS findEntries-one");

// --- findEntries 2-wide: pair with 2x3 free (entry included), unified rule ---
// Same structural rule as 1-wide: mouth flanks walled and held (MIN_FLANK
// each side), approach free with at least one open side — one edge may
// start while the other runs longer.
{
  // Passage (0,0)+(1,0), banks (-1,0..1),(2,0..1), open field around.
  const wall = new Set(["-1,0", "2,0", "-1,1", "2,1"]);
  const cellFree = (bx, bz) => !wall.has(`${bx},${bz}`);
  const found = findEntries(0.5, -3, cellFree);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "two");
  assert.deepEqual([found[0].x, found[0].z], [1.0, 0.5]);
  assert.ok(Math.abs(found[0].dist - Math.hypot(0.5, 3.5)) < 1e-9);
  assert.deepEqual([found[0].ax, found[0].az], [0.5, 0.5]);
  assert.deepEqual([found[0].bx2, found[0].bz2], [1.5, 0.5]);
  // Out of range: nothing.
  // Range edge: midpoint dist exactly ENTRY_R_2W reads in, past it out.
  // (Other stacked pairs may list too — assert on the (0,0) pair itself.)
  const edgeIn = findEntries(1.0, 4.5, cellFree).filter((e) => e.kind === "two");
  assert.ok(edgeIn.some((e) => e.bx === 0 && e.bz === 0), "edge pair still lists at exactly ENTRY_R_2W");
  assert.ok(!findEntries(1.0, 4.6, cellFree).some((e) => e.kind === "two" && e.bx === 0 && e.bz === 0));
  assert.equal(findEntries(0.5, -4.5, cellFree).length, 0);
  // Missing outer mouth wall: not a passage.
  assert.equal(findEntries(0.5, -3, (bx, bz) => (bx === 2 && bz === 0) || !wall.has(`${bx},${bz}`)).length, 0);
  // Blocked depth row: no 2x3 run.
  const holed = new Set([...wall, "1,1"]);
  assert.equal(findEntries(0.5, -3, (bx, bz) => !holed.has(`${bx},${bz}`)).length, 0);
  // Depth flanks may read walled (unified rule): walls tight on both
  // depth rows still list.
  const tight = new Set([...wall, "-1,2", "2,2"]);
  assert.equal(findEntries(0.5, -3, (bx, bz) => !tight.has(`${bx},${bz}`)).filter((e) => e.kind === "two").length, 1);
  // Walled-shut run kills it: both neighbouring rows blocked, so the pair
  // has neither depth nor approach in either direction.
  const shut = new Set([...wall, "0,-1", "1,-1", "0,1", "1,1"]);
  assert.equal(findEntries(0.5, -3, (bx, bz) => !shut.has(`${bx},${bz}`)).filter((e) => e.kind === "two").length, 0);
  // Long-flank approach: a wall running on past the mouth on one side is
  // still a mouth (one edge starts, the other runs longer) — the 2-wide
  // shares the 1-wide at-least-one-open-side clause. The funneled
  // direction lists like the open side.
  for (const [wx, label] of [["-1,-1", "west"], ["2,-1", "east"]]) {
    const funnel = new Set([...wall, wx]);
    const ff = findEntries(0.5, -3, (bx, bz) => !funnel.has(`${bx},${bz}`)).filter((e) => e.kind === "two");
    assert.ok(ff.length >= 1, `long flank ${label}: mouth still lists`);
    assert.ok(ff.some((e) => e.axis === 0), `long flank ${label}: funneled direction lists`);
  }
  // Pillar flanks never hold a 2-wide mouth: stripping both flank files
  // down to the mouth row alone kills it.
  const stubs = new Set(["-1,0", "2,0"]);
  assert.equal(findEntries(0.5, -3, (bx, bz) => !stubs.has(`${bx},${bz}`)).filter((e) => e.kind === "two").length, 0);
  // Rotated 90°: pair (0,0)+(0,1), banks (0,-1..0),(0,2..3) along +x.
  // (Held banks stack: the run behind reads as a second mouth facing back;
  // assert on the front pair itself.)
  const vwall = new Set(["0,-1", "0,2", "1,-1", "1,2"]);
  const vfree = (bx, bz) => !vwall.has(`${bx},${bz}`);
  const vfound = findEntries(3.5, 1.0, vfree).filter((e) => e.kind === "two");
  assert.ok(vfound.some((e) => e.bx === 0 && e.bz === 0), "rotated pair lists");
  const vfront = vfound.find((e) => e.bx === 0 && e.bz === 0);
  assert.deepEqual([vfront.x, vfront.z], [0.5, 1.0]);
}
console.log("PASS findEntries-two");

// --- findEntries: no thin-wall motif — a 1-thick hole without 3-depth never lists ---
// Wall x=2 (z=-2..2) with the cell (2,0) knocked out, but the run behind
// walled shut at (1,0): no mouth + 2 depth, so nothing lists from either
// side. A mid-corridor cell never reads as a mouth either (approach walled
// both sides on the banks rig).
{
  const wall = new Set(["2,-2", "2,-1", "1,0", "2,1", "2,2"]);
  const free = (bx, bz) => !wall.has(`${bx},${bz}`);
  assert.ok(!findEntries(4.5, 0.5, free).some((e) => e.bx === 2 && e.bz === 0),
    `shut depth: no mouth, got ${JSON.stringify(findEntries(4.5, 0.5, free))}`);
  assert.ok(!findEntries(0.5, 0.5, free).some((e) => e.bx === 2 && e.bz === 0),
    "shut depth: no mouth from inside");
  // Mid-corridor cell (banks rig): approach walled both ways, never a mouth.
  const bank = new Set(["1,2", "-1,2", "1,3", "-1,3", "1,4", "-1,4"]);
  const bankFree = (bx, bz) => !bank.has(`${bx},${bz}`);
  assert.ok(!findEntries(0.5, 3.5, bankFree).some((e) => e.bx === 0 && e.bz === 3),
    "mid-corridor: no mouth");
}
console.log("PASS findEntries-no-thin-hole");

// --- junctionOptions excludes the entry way (no U-turn at junctions) ---
assert.deepEqual(new Set(junctionOptions([N, S, E, W], S)), new Set([N, E, W]));
assert.deepEqual(junctionOptions([N, S], S), [N]);
assert.deepEqual(junctionOptions([S], S), []);
console.log("PASS junctionOptions");

// --- straight walk: engage once (tunneled), cruise forever, never uturn/release ---
{
  let lane = null, events = [];
  for (let c = 0; c < 6; c++) {
    const r = updateLane(lane, 0, c, N, [N, S], [E, W]);
    lane = r.lane; events.push(r.event);
  }
  assert.equal(events[0], "engage");
  assert.ok(events.slice(1).every((e) => e === "cruise"));
  assert.equal(lane.axis, N);
}
console.log("PASS straight");

// --- tunnel gate: no engage unless both laterals read blocked ---
{
  // Single wall alongside (east open): the walk stays roam.
  assert.equal(updateLane(null, 0, 0, N, [N, S], [W]).lane, null);
  // L-entry (adjacent opens): never engages, whatever the yaw.
  assert.equal(updateLane(null, 0, 0, N, [N, E], [S, W]).lane, null);
  assert.equal(updateLane(null, 0, 0, E, [N, E], [S, W]).lane, null);
  // Dead-end mouth (flanks walled, single opening): still engages.
  const r = updateLane(null, 0, 0, S, [S], [E, W]);
  assert.equal(r.event, "engage");
  assert.equal(r.lane.axis, S);
  // Single opening with the back open (side corridor): roam turns in.
  assert.equal(updateLane(null, 0, 0, E, [E], [N]).lane, null);
}
console.log("PASS tunnel-gate");

// --- L turn: one forced junction, axis flips, entry follows ---
{
  let lane = null;
  let r = updateLane(lane, 0, 0, N, [N, S], [E, W]); lane = r.lane;
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

// --- lock-turn still U-turns on a fresh dead end (stub right past a turn):
// the lock only suppresses re-picks, never the dead-end flip ---
{
  const lane = { axis: E, entry: W, lockX: 3, lockZ: 3 };
  const r = updateLane(lane, 3, 3, E, [W]);
  assert.equal(r.event, "uturn");
  assert.ok(Math.abs(normYaw(r.lane.axis - W)) < 1e-9);
  assert.ok(Math.abs(normYaw(r.lane.entry - E)) < 1e-9);
}
console.log("PASS lock-dead-end");

// --- straight cruise heals a stale entry (turn-then-straight): the next
// straight cell never coin-flips a backtrack, only true junctions pick ---
{
  const lane = { axis: N, entry: W, lockX: -1, lockZ: -1 };
  const r = updateLane(lane, 0, 2, N, [W, N]);
  assert.equal(r.event, "cruise");
  assert.ok(Math.abs(normYaw(r.lane.axis - N)) < 1e-9);
  assert.ok(Math.abs(normYaw(r.lane.entry - S)) < 1e-9);
}
console.log("PASS cruise-heals-entry");

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

// --- consecutive junctions keep picking (bars, cross mazes): open-space
// release lives in the mover's tunnel hold, never here ---
{
  let lane = { axis: N, entry: S, lockX: -1, lockZ: -1 };
  let r = updateLane(lane, 0, 0, N, [N, S, E], mulberry32(7));
  assert.equal(r.event, "junction");
  lane = r.lane;
  r = updateLane(lane, 0, 1, N, [N, S, E, W], mulberry32(8));
  assert.equal(r.event, "junction");
  assert.ok(r.lane);
}
console.log("PASS consecutive-junctions");

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
