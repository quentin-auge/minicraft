// Contact lottery for air <-> water <-> liquid transitions: weighted draws
// (60/20/20 dry->water and water->low shore, 50/50 water->high wall, 100%
// open-air exit), one draw per contact (rising edge + TRANS_COOL), flank
// graze keeping the legacy latch, water draws dry-approach only, and
// water-filled 1-wide tunnels / 2-wide doors drawing the violet lifecycle.
import assert from "node:assert/strict";
import { AIR, STONE, WATER } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles, floatTargetY } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob } from "../../../src/mobs/mover.js";
import { liquidSurface } from "../../../src/mobs/step.js";
import {
  TRANS_COOL, MAX_REROLLS,
  drawIndex, drawWithRerolls,
  resolveDryWaterContact, resolveShoreLow, resolveShoreHigh,
  coolReady, contactKey, transitionTick, tickTransitionTimers,
  diveVetoed, exitVetoed,
} from "../../../src/mobs/transitions.js";
import { findWaterEntries, findEntries } from "../../../src/mobs/corridor.js";
import { makeCellFree, makeCellSolid } from "../../../src/mobs/step.js";
import { entryTick } from "../../../src/mobs/entry.js";
import { clearEntryClaims } from "../../../src/mobs/entry.js";

const DT = 1 / 60;
const PIG_H = specCircles(LIVESTOCK_SPECS.pig).h;
const SURFACE = 2;

// Scripted rand: consumes the queue, then repeats the tail.
function scripted(seq, tail = 0.5) {
  let i = 0, calls = 0;
  const fn = () => {
    calls++;
    return i < seq.length ? seq[i++] : tail;
  };
  fn.calls = () => calls;
  return fn;
}

function makeMob(kind, x, y, z, yaw, opts = {}) {
  const spec = LIVESTOCK_SPECS[kind];
  const shape = specCircles(spec);
  return {
    type: kind, dim: "over", pos: { x, y, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    floatCapable: opts.floatCapable ?? true,
    yaw, yawTarget: yaw, target: null, wanderT: 1e9,
    legPhase: 0, speed: FARM_WALK, rand: opts.rand ?? (() => 0.5),
    trng: opts.trng ?? null,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: y, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0, entryScanT: 0, jrng: null, wallFollow: false,
    oneWide: false, tunnelPass: false, inPassage: false, passage: null,
    entryCoolT: 0, entryCoolKey: null,
    transCoolT: 0, _transPrev: null, _transDecision: null,
    _transNoDiveT: 0, _transNoExitT: 0,
    pinWallRide: false,
  };
}

function floatMob() {
  return makeMob("pig", 0, floatTargetY(SURFACE, PIG_H), 0, 0);
}

// --- weighted tables ------------------------------------------------------
assert.equal(resolveDryWaterContact(() => 0.1), "dive", "dry 0.1 dives");
assert.equal(resolveDryWaterContact(() => 0.7), "ride", "dry 0.7 rides");
assert.equal(resolveDryWaterContact(() => 0.95), "ignore", "dry 0.95 ignores");
assert.equal(resolveShoreLow(() => 0.1), "exit", "shore 0.1 exits");
assert.equal(resolveShoreLow(() => 0.7), "ride", "shore 0.7 rides");
assert.equal(resolveShoreLow(() => 0.95), "ignore", "shore 0.95 ignores");
assert.equal(resolveShoreHigh(() => 0.1), "ride", "high 0.1 rides");
assert.equal(resolveShoreHigh(() => 0.9), "ignore", "high 0.9 ignores");
console.log("PASS trans-tables");

// --- renormalization + bounded rerolls ------------------------------------
{
  // Dive unavailable: 0.1 rerolls onto 0.7 (ride).
  const r = scripted([0.1, 0.7]);
  const pick = resolveDryWaterContact(r, (k) => k !== "dive");
  assert.equal(pick, "ride", "unavailable dive rerolls to ride");
  assert.equal(r.calls(), 2, "one reroll consumed");
  // Nothing available: exactly MAX_REROLLS + 1 draws, then null fallback.
  const r2 = scripted([0.1, 0.2, 0.3, 0.4]);
  assert.equal(resolveDryWaterContact(r2, () => false), null, "all-unavailable falls back");
  assert.equal(r2.calls(), MAX_REROLLS + 1, "rerolls stay bounded");
}
console.log("PASS trans-rerolls");

// --- drawIndex boundaries ---------------------------------------------------
assert.equal(drawIndex([0.6, 0.2, 0.2], 0), 0, "index at 0");
assert.equal(drawIndex([0.6, 0.2, 0.2], 0.599), 0, "index inside first");
assert.equal(drawIndex([0.6, 0.2, 0.2], 0.6), 1, "index at boundary");
assert.equal(drawIndex([0.6, 0.2, 0.2], 0.999), 2, "index at tail");
console.log("PASS trans-index");

// --- one draw per contact: rising edge + cooldown --------------------------
{
  const mob = floatMob();
  const r = scripted([0.1]);
  const contact = { kind: "dry-water", frontal: true, floating: false };
  const first = transitionTick(mob, contact, r);
  assert.equal(first.intent, "dive", "rising edge draws");
  assert.ok(first.consumed, "rising draw consumes");
  assert.ok((mob.transCoolT ?? 0) > 0, "draw arms the cooldown");
  const held = transitionTick(mob, contact, r);
  assert.equal(held.intent, "dive", "held contact replays");
  assert.ok(!held.consumed, "held contact draws nothing");
  assert.equal(r.calls(), 1, "single draw per contact");
  assert.ok(!coolReady(mob), "cooldown gates fresh draws");
  tickTransitionTimers(mob, TRANS_COOL);
  assert.ok(coolReady(mob), "cooldown runs out");
  // New contact kind draws again once cooled.
  const r2 = scripted([0.95]);
  const other = transitionTick(mob, { kind: "shore-low", frontal: true, floating: true }, r2);
  assert.equal(other.intent, "ignore", "new contact draws fresh");
  // Cooled contact of another kind while cooling draws nothing (legacy).
  const mob2 = floatMob();
  mob2.transCoolT = TRANS_COOL;
  assert.equal(transitionTick(mob2, contact, scripted([0.1])), null, "cooling draws nothing");
  // Broken contact re-arms the edge.
  assert.equal(transitionTick(mob, null), null, "null clears");
  assert.equal(mob._transPrev, null, "edge re-armed");
}
console.log("PASS trans-edge-cool");

// --- gates: capability, flank, dry-only, open -------------------------------
{
  // Non-floaters never draw.
  const mob = makeMob("pig", 0, 2, 0, 0, { floatCapable: false });
  assert.equal(
    transitionTick(mob, { kind: "dry-water", frontal: true, floating: false }, () => 0.1), null,
    "non-floaters keep legacy");
  // Flank graze never draws (legacy latch owns it).
  const flank = floatMob();
  assert.equal(
    transitionTick(flank, { kind: "dry-water", frontal: false, floating: false }, () => 0.1), null,
    "flank keeps legacy");
  assert.equal(flank._transDecision, null, "flank stores no decision");
  // Water draws are dry-approach only.
  const wet = floatMob();
  assert.equal(
    transitionTick(wet, { kind: "dry-water", frontal: true, floating: true }, () => 0.1), null,
    "floating mobs never draw water entries");
  // Open air edges exit outright with no draw.
  const open = floatMob();
  const ro = scripted([0.99]);
  const res = transitionTick(open, { kind: "open", frontal: true, floating: true }, ro);
  assert.equal(res.intent, "exit", "open edge exits");
  assert.ok(!res.consumed, "open edge draws nothing");
  assert.equal(ro.calls(), 0, "open edge consumes no rand");
  assert.equal(contactKey({ kind: "dry-water", frontal: true }), "dry-water:F", "contact key");
  assert.equal(contactKey(null), null, "null key");
}
console.log("PASS trans-gates");

// --- veto timers tick down ---------------------------------------------------
{
  const mob = floatMob();
  mob._transNoDiveT = TRANS_COOL;
  mob._transNoExitT = TRANS_COOL;
  assert.ok(diveVetoed(mob) && exitVetoed(mob), "vetoes hold");
  tickTransitionTimers(mob, TRANS_COOL);
  assert.ok(!diveVetoed(mob) && !exitVetoed(mob), "vetoes run out");
}
console.log("PASS trans-veto");

// --- pool fixture: scripted dive still crosses -------------------------------
function buildPool() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) setBlock(x, 0, z, STONE);
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    if (x >= 4 && x <= 8 && z >= 4 && z <= 8) setBlock(x, 1, z, WATER);
    else setBlock(x, 1, z, STONE);
  }
}

function pinCommit(mob, heading, target) {
  mob.target = target;
  mob.wanderT = 1e9;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: 99, runT: 0 };
}

{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  // Scripted lottery stream: dive in, exit out, then neutral.
  const trng = scripted([0.1, 0.1]);
  const mob = makeMob("pig", 2.5, 2, 6.5, Math.PI / 2, { rand: () => 0.5, trng });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let done = false, hops = 0, wasHop = false;
  for (let t = 0; t < 1500; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.hop && !wasHop) hops++;
    wasHop = mob.hop != null;
    if (mob.pos.x > 10.5) { done = true; break; }
  }
  assert.ok(done, `scripted lottery crosses (x=${mob.pos.x.toFixed(2)})`);
  assert.equal(hops, 1, `scripted lottery hops once (got ${hops})`);
  assert.ok(trng.calls() >= 2, "lottery drew dive + exit");
}
console.log("PASS trans-scripted-cross");

// --- scripted ignore: the mob holds the bank ---------------------------------
{
  buildPool();
  // Every draw refuses: the first approach ignores and holds the bank.
  const trng = scripted([0.95], 0.95);
  const mob = makeMob("pig", 2.5, 2, 6.5, Math.PI / 2, { rand: () => 0.5, trng });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawWet = false, sawIgnore = false;
  for (let t = 0; t < 120; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null) sawWet = true;
    if (mob._transDecision === "ignore") sawIgnore = true;
  }
  assert.ok(!sawWet, "ignore holds the bank dry");
  assert.ok(sawIgnore, "ignore decision stored");
}
console.log("PASS trans-ignore-holds");

// --- scripted ride: the edge ride latches without diving ----------------------
{
  buildPool();
  // Every draw rides: the mob works the edge without diving — a rail only
  // erects where a real wall stands, so open water reads as a dry slide
  // along the bank instead.
  const trng = scripted([0.7], 0.7);
  const mob = makeMob("pig", 2.5, 2, 6.5, Math.PI / 2, { rand: () => 0.5, trng });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawWet = false, sawRide = false, lateral = 0;
  for (let t = 0; t < 240; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null) sawWet = true;
    if (mob._transDecision === "ride") sawRide = true;
    lateral = Math.max(lateral, Math.abs(mob.pos.z - 6.5));
  }
  assert.ok(!sawWet, "ride stays dry");
  assert.ok(sawRide, "ride decision stored");
  assert.ok(lateral > 1.0, `ride works the edge (dz=${lateral.toFixed(2)})`);
}
console.log("PASS trans-ride-latches");

// --- floating ignore: no hop while the veto holds ------------------------------
{
  buildPool();
  const feet = floatTargetY(SURFACE, PIG_H);
  // Every draw ignores: the veto holds and no hop ever fires.
  const trng = scripted([0.95], 0.95);
  const mob = makeMob("pig", 7.5, feet, 6.5, Math.PI / 2, { rand: () => 0.5, trng });
  pinCommit(mob, Math.PI / 2, { x: 11.5, z: 6.5 });
  let sawHop = false, sawIgnore = false;
  for (let t = 0; t < 200; t++) {
    tickFarmMob(mob, DT, (m) => m.target, mob.rand);
    if (mob.hop) sawHop = true;
    if (mob._transDecision === "ignore") sawIgnore = true;
    assert.ok(Math.abs(mob.pos.y - feet) < 0.3, `ignore keeps swimming (y=${mob.pos.y.toFixed(3)})`);
    assert.ok(mob.pos.y < 1.95, `ignore never leaves the water (y=${mob.pos.y.toFixed(3)})`);
  }
  assert.ok(!sawHop, "ignore never hops");
  assert.ok(sawIgnore, "ignore decision stored afloat");
}
console.log("PASS trans-afloat-ignore");

// --- water tunnel: 1-wide water mouth draws the violet commit -------------------
// Two-deep water run through a wall: the dry scan refuses the 2-drop, only
// the water scan lists the mouth.
function buildWaterTunnel() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    setBlock(x, 0, z, STONE); setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
  // Wall at x=6 (one above the ground), gap at z=6 with a 2-deep water run.
  for (let z = 0; z <= 12; z++) {
    if (z === 6) continue;
    setBlock(6, 3, z, STONE);
  }
  for (let x = 6; x <= 8; x++) { setBlock(x, 1, 6, WATER); setBlock(x, 2, 6, WATER); }
  // Solid flanks around the mouth row + support runs down the depth file.
  for (const z of [5, 7]) {
    setBlock(6, 3, z, STONE);
    setBlock(7, 3, z, STONE);
    setBlock(8, 3, z, STONE);
  }
  assert.equal(getBlock(6, 2, 6), WATER, "mouth reads water");
}

function tunnelMob(x, y) {
  return makeMob("pig", x, y, 6.5, Math.PI / 2, { rand: () => 0 });
}

{
  buildWaterTunnel();
  const mob = tunnelMob(4.5, 3);
  const waterCell = (bx, bz) => getBlock(bx, 2, bz) === WATER;
  const wet = findWaterEntries(mob.pos.x, mob.pos.z, makeCellFree(mob), makeCellSolid(mob), waterCell);
  assert.ok(wet.length > 0, "water tunnel mouth detected");
  const one = wet.find((e) => e.kind === "one");
  assert.ok(one && one.water === true, "1-wide water mouth listed");
  assert.ok(one.dist <= 3.0 + 1e-9, `mouth in range (d=${one.dist.toFixed(2)})`);
  // The dry scan refuses the 2-drop: only the water scan lists it.
  assert.equal(
    findEntries(mob.pos.x, mob.pos.z, makeCellFree(mob), makeCellSolid(mob)).length, 0,
    "dry scan misses the deep mouth");
  // No water predicate finds nothing.
  assert.equal(findWaterEntries(mob.pos.x, mob.pos.z, makeCellFree(mob), makeCellSolid(mob), null).length, 0,
    "no water predicate finds nothing");
  // Violet draw on dry approach.
  mob.entryScanT = 0;
  assert.ok(entryTick(mob, DT, () => 0, { supported: true, floating: false }), "water mouth draws");
  assert.equal(mob.roam?.entry, true, "violet commit latched");
  assert.equal(mob.roam?.passageKind, 1, "1-wide passage kind");
  assert.ok(mob.target, "commit aims at the mouth");
  // A floating mob never scans water mouths.
  clearEntryClaims();
  const wet2 = tunnelMob(4.5, 3);
  wet2.entryScanT = 0;
  assert.equal(
    entryTick(wet2, DT, () => 0, { supported: false, floating: true }), false,
    "floating mobs draw no water entries");
  assert.equal(wet2.roam?.entry ?? null, null, "no commit afloat");
}
console.log("PASS trans-water-tunnel");

// --- water door: 2-wide water pair draws a crossing commit -----------------------
function buildWaterDoor() {
  resetWorld("over");
  setDimension("over");
  clearEntryClaims();
  for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) {
    setBlock(x, 0, z, STONE); setBlock(x, 1, z, STONE); setBlock(x, 2, z, STONE);
  }
  for (let z = 0; z <= 12; z++) {
    if (z === 6 || z === 7) continue;
    setBlock(6, 3, z, STONE);
  }
  for (let x = 6; x <= 8; x++) for (let z = 6; z <= 7; z++) {
    setBlock(x, 1, z, WATER); setBlock(x, 2, z, WATER);
  }
  for (const z of [5, 8]) {
    setBlock(6, 3, z, STONE);
    setBlock(7, 3, z, STONE);
    setBlock(8, 3, z, STONE);
  }
}

{
  buildWaterDoor();
  const mob = tunnelMob(4.5, 3);
  const waterCell = (bx, bz) => getBlock(bx, 2, bz) === WATER;
  const wet = findWaterEntries(mob.pos.x, mob.pos.z, makeCellFree(mob), makeCellSolid(mob), waterCell);
  const two = wet.find((e) => e.kind === "two");
  assert.ok(two && two.water === true, "2-wide water door listed");
  assert.equal(
    findEntries(mob.pos.x, mob.pos.z, makeCellFree(mob), makeCellSolid(mob)).length, 0,
    "dry scan misses the deep door");
  mob.entryScanT = 0;
  entryTick(mob, DT, () => 0, { supported: true, floating: false });
  assert.equal(mob.roam?.entry, true, "2-wide violet commit latched");
  assert.equal(mob.roam?.passageKind, 2, "crossing passage kind");
}
console.log("PASS trans-water-door");

console.log("transitions.test.mjs: ALL PASS");
