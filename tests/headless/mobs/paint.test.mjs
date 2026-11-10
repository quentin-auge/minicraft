// The paint owner: the one owner of a mob's materials. The gate is
// `?color=1` (without it no debug colour reaches a mob), the target
// debug's green beats the displacement mode colour, and the natural coat
// is captured once — so a style can never be restored over another.
//
// Three-free, `node` direct.
import assert from "node:assert/strict";
import { paintEnabled, setGreenPaint, setModePaint } from "../../../src/mobs/paint.js";

// The gate reads the URL: the rigs drive it by swapping the stub.
globalThis.location = { search: "" };

const coat = { name: "coat" };
const spot = { name: "spot" };
const green = { name: "green" };
const blue = { name: "blue" };
const purple = { name: "purple" };

function makeMob() {
  const body = { material: coat };
  const head = { material: spot };
  return { root: { userData: { paintables: [body, head] } }, body, head };
}

function materials(m) {
  return m.body.material.name + "/" + m.head.material.name;
}

// --- the gate: without ?color=1 no debug colour reaches a mob.
assert.equal(paintEnabled(), false, "the paint gate is closed without ?color=1");
{
  const m = makeMob();
  setGreenPaint(m, green);
  setModePaint(m, blue);
  assert.equal(materials(m), "coat/spot", "no colour without the gate");
}

// --- with the gate open the styles apply.
globalThis.location = { search: "?color=1" };
assert.equal(paintEnabled(), true, "the paint gate opens with ?color=1");

{
  // The mode colour paints the mob.
  const m = makeMob();
  setModePaint(m, blue);
  assert.equal(materials(m), "blue/blue", "the mode colour paints the mob");
  // The mode colour off restores the natural coat.
  setModePaint(m, null);
  assert.equal(materials(m), "coat/spot", "the natural coat comes back");
}

{
  // The green (the target debug) beats the mode colour.
  const m = makeMob();
  setModePaint(m, blue);
  setGreenPaint(m, green);
  assert.equal(materials(m), "green/green", "the green beats the mode colour");
  // The green off hands the mob back to the mode colour.
  setGreenPaint(m, null);
  assert.equal(materials(m), "blue/blue", "the mode colour returns");
  setModePaint(m, null);
  assert.equal(materials(m), "coat/spot", "the natural coat comes back");
}

{
  // The natural coat is captured once: a style change never poisons it.
  const m = makeMob();
  setModePaint(m, blue);
  setModePaint(m, purple);
  setModePaint(m, null);
  assert.equal(materials(m), "coat/spot", "a mode change never poisons the natural coat");
}

{
  // The green never leaks into the natural coat: the green, then the mode
  // colour, then both off — the mob keeps its own coats.
  const m = makeMob();
  setGreenPaint(m, green);
  setModePaint(m, blue);
  setGreenPaint(m, null);
  setModePaint(m, null);
  assert.equal(materials(m), "coat/spot", "the green never becomes the natural coat");
}

console.log("paint.test.mjs: ALL PASS");
