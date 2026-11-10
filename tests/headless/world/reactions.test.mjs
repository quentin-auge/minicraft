// Block reactions (world/reactions.js) on real voxels (store.js), no scene:
// registry well-formedness, arm/consume rules, settle + absorb, release on
// base change, dimension scoping, and the refuses/onComplete extension hooks.
import assert from "node:assert/strict";
import { AIR, DIRT, STONE, WATER, LAVA, MOON_WATER } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock, getBlock } from "../../../src/core/store.js";
import {
  REACTION_TYPES, VARIANT_LOOKS, reactionFor, armReaction, tickReactions,
  variantAt, activeRuns, clearReactionAt, clearReactionsDim,
  resetReactionMemory, onReaction,
} from "../../../src/world/reactions.js";

function fresh() {
  resetWorld("over");
  resetWorld("nether");
  setDimension("over");
  resetReactionMemory();
}

// --- registry is well-formed: every entry names a base, accepts triggers,
// runs a positive duration, and settles a variant the looks registry knows ---
for (const spec of REACTION_TYPES) {
  assert.ok(spec.key, "reaction needs a stable key");
  assert.ok(spec.base !== undefined, `${spec.key} needs a base`);
  assert.ok(spec.accepts.length, `${spec.key} accepts nothing`);
  assert.ok(spec.duration > 0, `${spec.key} needs a positive duration`);
  assert.equal(typeof spec.variant, "function", `${spec.key} needs a variant picker`);
}
for (const [name, look] of Object.entries(VARIANT_LOOKS)) {
  assert.ok(look.blocks.length, `${name} sits on nothing`);
  assert.ok(look.texture, `${name} needs a texture`);
  for (const part of ["shell", "indicator", "drip"]) assert.ok(look[part], `${name} needs ${part}`);
}
console.log("PASS registry well-formed");

// --- dirt + water arms: trigger consumed, wet_water mark, one run ---
fresh();
setBlock(0, 5, 0, DIRT);
const arm = armReaction(0, 5, 0, WATER);
assert.deepEqual(arm, { armed: true, refused: false, consumed: true, mark: "wet_water" });
assert.equal(activeRuns().length, 1);
console.log("PASS arm consumes");

// --- wrong base or wrong trigger: no reaction ---
fresh();
setBlock(0, 5, 0, STONE);
assert.equal(armReaction(0, 5, 0, WATER), null);
assert.equal(reactionFor(STONE, WATER), null);
setBlock(0, 5, 0, DIRT);
assert.equal(armReaction(0, 5, 0, STONE), null);
assert.equal(activeRuns().length, 0);
console.log("PASS no match");

// --- busy cell never reacts twice: the trigger stays ---
fresh();
setBlock(0, 5, 0, DIRT);
armReaction(0, 5, 0, WATER);
assert.deepEqual(armReaction(0, 5, 0, WATER), { armed: false, refused: false, consumed: false, mark: null });
console.log("PASS busy cell keeps trigger");

// --- settle: variant reads back, framework writes no voxels ---
fresh();
setBlock(0, 5, 0, DIRT);
setBlock(0, 6, 0, WATER); // liquid above to be absorbed
armReaction(0, 5, 0, WATER);
setBlock(0, 6, 0, AIR); // the caller drinks the trigger at arm time
const early = tickReactions(0.2);
assert.deepEqual(early.settled, []);
const done = tickReactions(0.3);
assert.equal(done.settled.length, 1);
assert.equal(done.settled[0].mark, "wet_water");
assert.equal(done.settled[0].absorb, false); // air above: nothing to drink
assert.equal(variantAt(0, 5, 0), "wet_water");
assert.equal(activeRuns().length, 0);
console.log("PASS settle marks variant");

// --- absorb: a liquid standing above at settle time is reported, not written ---
fresh();
setBlock(0, 5, 0, DIRT);
setBlock(0, 6, 0, WATER);
armReaction(0, 5, 0, LAVA); // lava trigger still soaks blue (master parity)
setBlock(0, 6, 0, AIR);
setBlock(0, 6, 0, MOON_WATER); // ...but the liquid above is what gets drunk
const soak = tickReactions(0.5);
assert.equal(soak.settled[0].absorb, true);
assert.equal(getBlock(0, 6, 0), MOON_WATER); // the caller applies the drink
assert.equal(variantAt(0, 5, 0), "wet_water");
console.log("PASS absorb reported, voxels untouched");

// --- moon water soaks pale ---
fresh();
setBlock(0, 5, 0, DIRT);
assert.equal(armReaction(0, 5, 0, MOON_WATER).mark, "wet_moon");
tickReactions(0.5);
assert.equal(variantAt(0, 5, 0), "wet_moon");
console.log("PASS moon variant");

// --- broken base mid-run releases the reaction, settled mark drops on break ---
fresh();
setBlock(0, 5, 0, DIRT);
armReaction(0, 5, 0, WATER);
setBlock(0, 5, 0, AIR);
const rel = tickReactions(0.5);
assert.deepEqual(rel.released, [[0, 5, 0]]);
assert.deepEqual(rel.settled, []);
assert.equal(variantAt(0, 5, 0), null);
fresh();
setBlock(0, 5, 0, DIRT);
armReaction(0, 5, 0, WATER);
tickReactions(0.5);
assert.equal(variantAt(0, 5, 0), "wet_water");
clearReactionAt(0, 5, 0); // break path
assert.equal(variantAt(0, 5, 0), null);
console.log("PASS release + clear");

// --- state is dimension-scoped ---
fresh();
setBlock(0, 5, 0, DIRT);
armReaction(0, 5, 0, WATER);
setDimension("nether");
assert.equal(activeRuns().length, 0);
assert.equal(variantAt(0, 5, 0), null);
setDimension("over");
assert.equal(activeRuns().length, 1); // retain dims keep their runs
clearReactionsDim("over");
assert.equal(activeRuns().length, 0);
console.log("PASS dimension scoping");

// --- refuses hook: a veto eats the trigger and reports, arming nothing ---
// (The test row takes a base no shipped row matches, so reactionFor can
// only find it.)
fresh();
setBlock(1, 5, 0, STONE);
REACTION_TYPES.push({
  key: "test_refuse", base: STONE, accepts: [WATER], duration: 0.5,
  consume: true, absorbsAbove: false,
  variant: () => "wet_water", refuses: () => true, onComplete: null,
});
try {
  const events = [];
  const off = onReaction((ev) => events.push(ev.type));
  const veto = armReaction(1, 5, 0, WATER);
  off();
  assert.deepEqual(veto, { armed: false, refused: true, consumed: true, mark: null });
  assert.deepEqual(events, ["refused"]);
  assert.equal(activeRuns().length, 0);
} finally {
  REACTION_TYPES.pop();
}
console.log("PASS refuses hook");

// --- onComplete hook: the spec's extra cells come back as touched ---
fresh();
setBlock(3, 5, 0, STONE);
REACTION_TYPES.push({
  key: "test_complete", base: STONE, accepts: [LAVA], duration: 0.5,
  consume: true, absorbsAbove: false, variant: null, refuses: null,
  onComplete: (ctx) => [[ctx.x, ctx.y + 1, ctx.z]],
});
try {
  const events = [];
  const off = onReaction((ev) => events.push(ev.type));
  armReaction(3, 5, 0, LAVA);
  const fin = tickReactions(0.5);
  off();
  assert.deepEqual(events, ["armed", "settled"]);
  assert.deepEqual(fin.settled[0].touched, [[3, 6, 0]]);
  assert.equal(fin.settled[0].mark, null);
  assert.equal(variantAt(3, 5, 0), null); // no mark: no variant
} finally {
  REACTION_TYPES.pop();
}
console.log("PASS onComplete hook");

console.log("reactions: all PASS");
