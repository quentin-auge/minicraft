// Landing mob veto: the hull never lands on a body and never seals one
// inside itself. A live same-dim body overlapping the landing box holds
// the touchdown (toast, retry every tick, never abandoned); the pilot
// keeps steering so it can steer away. While a body stands under the
// footprint the ship settles to a half-block safety margin above the
// tallest top and holds there, bit-static while the same bodies block (no
// up/down flicker — the hold engages a band above the floor, so the floor
// is a fixed point instead of a sink-then-snap cycle) and following the
// floor both ways at slew pace as the herd changes; Down-held heading +
// strafe glide at walk pace across the herd (mouse steers), sliding around
// bodies that would really overlap; the swept box carves every non-liquid
// it overlaps in level flight and climb — first, even held — while a
// descent clamps x/z to the posed box; the pause (herd hold,
// strictly-descending ground stop) wins over further motion.
// The veto never moves a mob —
// shoving one out could bury it in the pen wall, so the rule is pure
// detection. Pure carry.js rules, three-free, node direct.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { landingBlockers, tallestBlockerTop, boxFree, cellBlockedByMob } from "../../../src/mobs/carry.js";
import { sweptBoxCells, terminalCarveBox } from "../../../src/world/rocketpad.js";
import { aabbIntersectsSolid, moveClamped, setMobExtraSolid } from "../../../src/mobs/step.js";
import { setDimension, resetWorld } from "../../../src/core/store.js";

const box = { x0: 10, x1: 12, y0: 20, y1: 21, z0: 10, z1: 12 };
const mob = (x, y, z, extra = {}) => ({ pos: { x, y, z }, hw: 0.32, h: 1, alive: true, dim: "over", ...extra });

// Band-hold rig: mirrors the flight loop's descent rule. The floor is the
// XZ-overlap tallest top + margin (the shipped carry.js helpers); the hold
// engages a whole band above it (band > the 0.6 max swept substep, so the
// catch lands above the floor), tracks it at HOLD_SLEW in both directions,
// zeroes the descent, and the next tick re-accelerates from rest.
const MARGIN = 0.5, BAND = 0.7, SLEW = 2, ACCEL = 26, DT = 1 / 60;
const rigBox = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
const floorFor = (peers, ox, oy, oz) => {
  const top = tallestBlockerTop(peers, "over", sweptBoxCells(ox, oy, oz, rigBox));
  return Number.isFinite(top) ? top + MARGIN - rigBox.y0 : -Infinity;
};
const descendTick = (peers, o, vyIn) => {
  const vy = vyIn - ACCEL * DT;
  const steps = Math.max(1, Math.ceil((Math.abs(vy) * DT) / 0.6));
  const sy = (vy * DT) / steps;
  let y = o.y;
  for (let i = 0; i < steps; i++) {
    y += sy;
    const f = floorFor(peers, o.x, y, o.z);
    if (Number.isFinite(f) && y <= f + BAND) {
      const d = f - y, maxStep = SLEW * DT;
      y += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
      return { x: o.x, y, z: o.z, vy: 0, held: true };
    }
  }
  return { x: o.x, y, z: o.z, vy, held: false };
};

// --- blockers: who overlaps the landing box --------------------------------
{
  // A standing mob inside the footprint blocks the touchdown.
  assert.equal(landingBlockers([mob(10.5, 20, 10.5)], "over", box).length, 1, "mob inside blocks");
  // A mob whose head reaches the box blocks too (tall body).
  assert.equal(landingBlockers([mob(10.5, 19.6, 10.5, { h: 1.4 })], "over", box).length, 1, "tall body overlapping blocks");
  // Clearance passes: beside the box, above it, or below it.
  assert.equal(landingBlockers([mob(14, 20, 10.5)], "over", box).length, 0, "flanking mob passes");
  assert.equal(landingBlockers([mob(11, 23, 11)], "over", box).length, 0, "mob above passes");
  assert.equal(landingBlockers([mob(11, 18, 11)], "over", box).length, 0, "mob below passes");
  // Edge overlap counts: a body crossing the footprint border is still
  // inside it (the hull's own flood is edge-adjacent too).
  assert.equal(landingBlockers([mob(9.75, 20, 11)], "over", box).length, 1, "flank overlap blocks");
  console.log("PASS landing-blockers");
}

// --- blockers: who never counts -------------------------------------------
{
  const inside = mob(11, 20, 11);
  assert.equal(landingBlockers([{ ...inside, alive: false }], "over", box).length, 0, "dead skipped");
  assert.equal(landingBlockers([{ ...inside, dim: "end" }], "over", box).length, 0, "foreign dim skipped");
  assert.equal(landingBlockers([{ ...inside, _riding: true }], "over", box).length, 0, "hull riders never block");
  assert.equal(landingBlockers([{ ...inside, _carried: true }], "over", box).length, 0, "grabbed mobs never block");
  assert.equal(landingBlockers([{ hw: 0.32, h: 1, alive: true, dim: "over" }], "over", box).length, 0, "coordinate-less skipped");
  assert.equal(landingBlockers([], "over", box).length, 0, "empty peers pass");
  console.log("PASS landing-skips");
}

// --- blockers: held, never moved ----------------------------------------
{
  // Several mobs in the box are all reported, so the hold covers the pen.
  const herd = [mob(10.5, 20, 10.5), mob(12, 20, 12), mob(11, 19.5, 11, { h: 1.75 })];
  assert.deepEqual(landingBlockers(herd, "over", box), herd, "all blockers reported");
  // A mob exactly on the box faces still blocks (no off-by-one gap).
  assert.equal(landingBlockers([mob(10, 20, 11)], "over", box).length, 1, "touching border blocks");
  console.log("PASS landing-hold");
}

// --- tallest blocker: XZ overlap only, top below the box still counts ---
{
  const tbox = { x0: 10, x1: 12, y0: 20, y1: 21, z0: 10, z1: 12 };
  // Max over the footprint wins.
  const herd = [mob(10.5, 20, 10.5, { h: 1 }), mob(11, 20, 11, { h: 1.4 }), mob(12, 20, 12, { h: 1.2 })];
  assert.equal(tallestBlockerTop(herd, "over", tbox), 21.4, "tallest top wins");
  // Tallest leaves -> next tallest takes over.
  assert.equal(tallestBlockerTop([herd[0], herd[2]], "over", tbox), 21.2, "next tallest after the tall leaves");
  // Empty peers -> -Infinity (free descent to the ground).
  assert.equal(tallestBlockerTop([], "over", tbox), -Infinity, "empty peers fall to ground");
  // Same filters as the veto: dead, foreign-dim, ridden, carried, and
  // coordinate-less bodies never count.
  const inside = mob(11, 20, 11, { h: 1.4 });
  assert.equal(tallestBlockerTop([{ ...inside, alive: false }], "over", tbox), -Infinity, "dead skipped");
  assert.equal(tallestBlockerTop([{ ...inside, dim: "end" }], "over", tbox), -Infinity, "foreign dim skipped");
  assert.equal(tallestBlockerTop([{ ...inside, _riding: true }], "over", tbox), -Infinity, "riders skipped");
  assert.equal(tallestBlockerTop([{ ...inside, _carried: true }], "over", tbox), -Infinity, "grabbed skipped");
  assert.equal(tallestBlockerTop([{ hw: 0.32, h: 1, alive: true, dim: "over" }], "over", tbox), -Infinity, "coordinate-less skipped");
  // XZ outside the footprint never counts, even when tall.
  assert.equal(tallestBlockerTop([mob(14, 20, 10.5, { h: 1.4 })], "over", tbox), -Infinity, "flanking mob ignored");
  // A body at/above the box top never counts (walks over, not under).
  assert.equal(tallestBlockerTop([mob(11, 22, 11)], "over", tbox), -Infinity, "mob above ignored");
  // A body below the box still counts (the margin target), unlike the veto.
  assert.equal(tallestBlockerTop([mob(11, 18, 11)], "over", tbox), 19, "mob below still counts");
  console.log("PASS landing-tallest");
}

// --- safety margin: the hold settles to tallest-top + 0.5 and stays ------
// The flight loop's margin rule, driven through the same shipped
// composition the runtime uses (sweptBoxCells + tallestBlockerTop): the
// hold catches the descent a band above the floor (tallest top + 0.5) and
// tracks it at slew pace, so holding Down settles to the gap and stays
// there while bodies walk under it, lowering/raising as the tallest
// changes.
{
  const tall = mob(10.5, 20, 10.5, { h: 1.4 }); // top 21.4 -> floor 21.9
  const small = mob(10.8, 20, 10.5, { h: 1.2 }); // top 21.2 -> floor 21.7
  let o = { x: 10, y: 24, z: 10 }, vy = 0;
  let minGap = Infinity;
  for (let t = 0; t < 240; t++) {
    const n = descendTick([tall, small], o, vy);
    o = { x: n.x, y: n.y, z: n.z }; vy = n.vy;
    minGap = Math.min(minGap, o.y - (tall.pos.y + tall.h));
  }
  assert.equal(o.y, 21.4 + MARGIN, "settles half a block above the tall top");
  assert.ok(minGap >= MARGIN - 1e-9, `margin never penetrated, min gap ${minGap}`);
  // Steering is kept while held: the hold only owns Y.
  const steer = descendTick([tall], { x: o.x + 0.4, y: o.y, z: o.z }, 0);
  assert.equal(steer.x, 10.4, "lateral kept while held");
  assert.ok(Math.abs(steer.y - o.y) <= SLEW * DT + 1e-9, "Y stays on the floor while steering");
  // The tall cow walks out: the ship settles to the next tallest + margin.
  for (let t = 0; t < 60; t++) {
    const n = descendTick([small], o, vy);
    o = { x: n.x, y: n.y, z: n.z }; vy = n.vy;
  }
  assert.equal(o.y, 21.2 + MARGIN, "settles to the next tallest + margin");
  // A mob walks under the held hull: the margin gap leaves room to pass.
  assert.ok(o.y - (small.pos.y + small.h) >= MARGIN - 1e-9, "held gap fits a walking body");
  // Once the last mob leaves, the hold ends and the descent resumes.
  const gone = descendTick([mob(30, 20, 10.5, { h: 1.4 })], o, 0);
  assert.equal(gone.held, false, "descent resumes after the mobs leave");
  assert.ok(gone.y < o.y, "ship keeps sinking once clear");
  // Steering away from the cow still walks: the floor is footprint-scoped.
  const away = { x: o.x - 1.0, y: o.y, z: o.z };
  assert.equal(landingBlockers([tall], "over", sweptBoxCells(away.x, away.y, away.z, rigBox)).length, 0, "steer-away candidate clear");
  console.log("PASS landing-margin");
}

// --- static hold: no up/down flicker while the same bodies block --------
// The hold engages a band above the floor and tracks it at slew pace, so
// the margin pose is a fixed point — the old sink-then-snap cycle (the
// up/down flicker) is gone. Bit-static while the same bodies block, a
// smooth follow when the tallest changes, never a per-tick jump past the
// slew budget once held.
{
  const herd = [mob(10.5, 20, 10.5, { h: 1.4 }), mob(10.8, 20, 10.5, { h: 1.2 })];
  const floorY = 21.4 + MARGIN;
  let o = { x: 10, y: 26, z: 10 }, vy = 0;
  const ys = [], held = [];
  for (let t = 0; t < 240; t++) {
    const n = descendTick(herd, o, vy);
    o = { x: n.x, y: n.y, z: n.z }; vy = n.vy;
    ys.push(o.y); held.push(n.held);
  }
  assert.equal(o.y, floorY, "settles exactly on the tallest top + margin");
  assert.ok(ys.slice(-30).every((y) => y === o.y), "bit-static once held");
  assert.ok(ys.every((y) => y >= 21.4 - 1e-9), "never sinks under the tallest top");
  // Once caught, every step stays inside the slew budget (plus the input
  // substep) — never the old floor snap.
  const first = held.indexOf(true);
  const budget = SLEW * DT + ACCEL * DT * DT + 1e-9;
  for (let i = first + 1; i < ys.length; i++)
    assert.ok(Math.abs(ys[i] - ys[i - 1]) <= budget, `tick ${i} steps smoothly, got ${ys[i] - ys[i - 1]}`);
  // The herd lowers: the ship follows down smoothly and settles.
  const low = [mob(10.5, 20, 10.5, { h: 1.2 })]; // floor 21.7
  for (let t = 0; t < 60; t++) {
    const n = descendTick(low, o, vy);
    o = { x: n.x, y: n.y, z: n.z }; vy = n.vy;
  }
  assert.equal(o.y, 21.2 + MARGIN, "settles to the lower top + margin");
  // A taller body arrives: a smooth rise, never a pop.
  const tall = [mob(10.5, 20, 10.5, { h: 1.8 })]; // floor 22.3
  const rise = descendTick(tall, o, 0);
  assert.ok(rise.held && rise.y - o.y <= SLEW * DT + 1e-9, "rise starts rate-limited, not snapped");
  // Fast floor oscillation (gliding across mixed tops): the per-tick move
  // stays inside the slew budget, so the floor reads as a swell, never a
  // snap — the flicker signature.
  let g = 21.7, peak = 0;
  for (let t = 0; t < 240; t++) {
    const f = t % 10 < 5 ? 21.9 : 21.5;
    const d = f - g, maxStep = SLEW * DT;
    const ny = g + (d > maxStep ? maxStep : d < -maxStep ? -maxStep : d);
    peak = Math.max(peak, Math.abs(ny - g)); g = ny;
  }
  assert.ok(peak <= SLEW * DT + 1e-9, `fast floor oscillation never snaps, peak ${peak}`);
  console.log("PASS landing-static-hold");
}

// --- Down-held slide: per-axis veto on real overlap ---------------------
// The runtime slide rule (slideVetoAt): a sideways step is refused only
// when the destination column's top stands above the hull bottom — a real
// overlap. Columns within the margin pass (the band hold lifts the hull
// over them at slew pace), so the glide rides the herd instead of stopping
// at every taller body; refusals are per-axis, so steering glides along a
// tall body instead of into it.
{
  const slideVeto = (peers, oy, nx, nz) => {
    const dest = floorFor(peers, nx, oy, nz);
    if (!Number.isFinite(dest)) return false;
    return dest - MARGIN > oy + 1e-9;
  };
  const tall = mob(10.5, 20, 10.5, { h: 1.4 }); // top 21.4
  const small = mob(12.5, 20, 10.5, { h: 1.0 }); // top 21
  const oy = 21.9; // held at the tall margin (hull bottom = 21.9)
  assert.equal(slideVeto([tall, small], oy, 10, 10), false, "same-herd column passes");
  assert.equal(slideVeto([tall, small], oy, 12, 10), false, "lower column passes");
  assert.equal(slideVeto([tall, small], oy, 30, 10), false, "clear column passes");
  const between = mob(13.5, 20, 10.5, { h: 1.3 }); // top 21.3, under the hull
  assert.equal(slideVeto([between], oy, 13, 10), false, "taller-than-current column within the margin passes");
  const taller = mob(14.5, 20, 10.5, { h: 2.0 }); // top 22, above the hull
  assert.equal(slideVeto([tall, taller], oy, 14, 10), true, "overlapping column refused");
  // From clear air above, sliding over a lower mob passes (no overlap).
  assert.equal(slideVeto([small], 24, 12, 10), false, "high slide over a low mob passes");
  // From clear air, sliding into a column the hull would overlap refuses.
  assert.equal(slideVeto([tall], 21, 10, 10), true, "low slide into a tall body refused");
  console.log("PASS landing-slide");
}

// --- systematic carve: the bbox carves every direction, pause wins ------
// The flight rule: the swept box is carved whatever the dy (non-liquids
// only) — unconditionally first, even held or paused — then the pause wins
// over further motion (herd hold position-based, ground stop strictly
// descending with support below): a held glide into a wall carves through
// it instead of merging into it. A belly already inside a block snaps up
// one row before the landing decision.
{
  const vbox = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  // The carve box starts at the hull bottom, so the support row under it is
  // outside the carve set — the stop support always survives.
  const b = sweptBoxCells(10, 21.9, 10, vbox);
  assert.equal(b.y0, 21, "box bottom row is the hull bottom cell");
  const grid = new Set(["10,21,10", "10,22,10", "10,20,10"]);
  const cleared = [];
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++)
      for (let z = b.z0; z <= b.z1; z++)
        if (grid.delete(x + "," + y + "," + z)) cleared.push([x, y, z]);
  assert.equal(cleared.length, 2, "the swept box clears, whatever the dy");
  assert.ok(grid.has("10,20,10"), "the cell below the box survives");
  // Wiring pins: the single carve primitive returns cleared + exhausted,
  // the loop carves unconditionally at its own pose before either pause,
  // and the pure stop rule gates the pose after it. Descent clamps x/z
  // to the posed box (terminalCarveBox); level flight keeps the swept box.
  const rocketSrc = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(rocketSrc.includes("function carveBoxAt(o, b)"), "the carve primitive takes the box");
  assert.ok(rocketSrc.includes("return { cleared, exhausted };"), "the carve reports cleared + exhausted");
  assert.ok(rocketSrc.includes("flightCarveBox(o.x, o.y, o.z, vesselBox, descending)"), "carveAt delegates to the descent-aware selector");
  assert.ok(rocketSrc.includes("flightCarveBox(origin.x, origin.y, origin.z, vesselBox, descending)"), "the blocked fallback reads the same box");
  assert.ok(rocketSrc.includes("const { exhausted } = carveAt(origin, sy < 0);"), "the loop carves at its own pose, descent-aware");
  assert.ok(rocketSrc.includes('from "./rocketbox.js"'), "the stop rule is the pure module");
  assert.ok(rocketSrc.includes("if (sy < 0 && groundBelowTouch()) {"), "the ground stop is strictly descending");
  assert.ok(rocketSrc.includes("if (sy <= 0 && holdZoneAt(origin.x, origin.z)) {"), "the herd hold stays position-based");
  // Carve-first: the unconditional carve runs before either pause, so a
  // held glide carves instead of merging.
  assert.ok(rocketSrc.indexOf("const { exhausted } = carveAt(origin, sy < 0);") < rocketSrc.indexOf("if (sy < 0 && groundBelowTouch()) {"), "the carve runs before the pause");
  assert.ok(rocketSrc.includes("function holdZoneAt(ox, oz)"), "the mob hold probe stays");
  // Diagonal-low landing: the fringe column past the posed box survives a
  // descent but not a level glide.
  {
    const hull = { x0: 0, x1: 6, y0: 0, y1: 17, z0: 0, z1: 6 };
    const swept = sweptBoxCells(10.42, 20.42, 10.42, hull);
    const term = terminalCarveBox(10.42, 20.42, 10.42, hull);
    assert.equal(swept.x1, 17, "swept covers the fringe");
    assert.equal(term.x1, 16, "descent clamps to the posed box");
    assert.equal(term.x1, 10 + hull.x1, "posed x1 is floor(ox) + box");
    assert.equal(term.z1, 10 + hull.z1, "posed z1 is floor(oz) + box");
    assert.equal(term.y1, swept.y1, "descent keeps the swept y range");
  }
  // Passenger clearance: the stamp carves what the pilot and riders would
  // overlap at their final spots (same guards as the hull), and every
  // destroyed TNT cell drops its index records point-exact.
  assert.ok(rocketSrc.includes("bodyOverlapCells"), "the stamp reads body-overlap cells");
  assert.ok(rocketSrc.includes("for (const [mob] of riders)"), "riders join the clearance");
  assert.ok(rocketSrc.includes("for (const [x, y, z] of tntCells) clearTNTBox(x, y, z, x, y, z);"), "destroyed TNT purges point-exact");
  console.log("PASS landing-systematic-carve");
}

// --- mobs never walk into the hovering hull --------------------------------
// The hull's live solids read as rock to every mob body probe (the same
// extra-solid the player physics uses), so a cow driven at the hovering
// hull stops at contact instead of merging into the floor/sides.
{
  setDimension("over");
  resetWorld("over");
  const hull = new Set(["10,20,10"]);
  setMobExtraSolid((bx, by, bz) => hull.has(bx + "," + by + "," + bz));
  try {
    assert.equal(aabbIntersectsSolid(10.5, 20, 10.5, 0.32, 1), true, "body inside hull solid reads blocked");
    assert.equal(aabbIntersectsSolid(8.5, 20, 10.5, 0.32, 1), false, "body clear of the hull reads free");
    assert.equal(aabbIntersectsSolid(10.5, 21, 10.5, 0.32, 1), false, "body in cabin air reads free");
    // Driven straight at the hull flank: the clamped step stops at contact.
    const cow = { pos: { x: 8.5, y: 20, z: 10.5 } };
    const stepOk = (nx, nz) => !aabbIntersectsSolid(nx, cow.pos.y, nz, 0.32, 1);
    for (let t = 0; t < 30; t++) moveClamped(cow, cow.pos.x + 0.5, cow.pos.z, stepOk);
    assert.ok(cow.pos.x + 0.32 <= 10, `cow stops at the hull flank, got x=${cow.pos.x}`);
    assert.equal(aabbIntersectsSolid(cow.pos.x, 20, cow.pos.z, 0.32, 1), false, "stopped cow never overlaps hull solids");
  } finally {
    setMobExtraSolid(null);
  }
  console.log("PASS landing-hull-solid");
}

// --- boarding gap: no rider is ever pinned inside hull solids --------------
// Boarding reads the whole body against the hull solids (boxFree), not just
// the feet point in the box: a mid-hold boarder overlapping the floor or a
// wall is refused and keeps vetoing as a live body, so the stamp can never
// seal a rider inside the stamped solids.
{
  const hullSolidAt = (bx, by, bz) =>
    (bx === 5 && by === 10 && bz === 5) || (bx === 6 && by === 11 && bz === 5);
  assert.equal(boxFree(hullSolidAt, 5.5, 11, 5.5, 0.32, 1), true, "clean cabin boarder passes");
  assert.equal(boxFree(hullSolidAt, 5.5, 10.2, 5.5, 0.32, 1), false, "boarder merged in the floor refused");
  assert.equal(boxFree(hullSolidAt, 5.8, 11, 5.5, 0.32, 1), false, "boarder leaning into the wall refused");
  // Stamp safety follows from the veto: a body overlapping a would-be
  // stamped solid always holds the landing first.
  const vbox = { x0: 0, x1: 2, y0: 0, y1: 1, z0: 0, z1: 0 };
  const box = sweptBoxCells(10, 20, 10, vbox);
  const stamped = [];
  for (let x = box.x0; x <= box.x1; x++) stamped.push([x, 20, 10]);
  const buried = mob(10.5, 20, 10.5, { h: 1.4 });
  assert.ok(stamped.some(([x, y, z]) => cellBlockedByMob([buried], "over", x, y, z)), "buried body overlaps a stamped solid");
  assert.equal(landingBlockers([buried], "over", box).length, 1, "buried body holds the stamp first");
  const clear = mob(14, 20, 10.5, { h: 1.4 });
  assert.ok(!stamped.some(([x, y, z]) => cellBlockedByMob([clear], "over", x, y, z)), "clear cow touches no stamped solid");
  assert.equal(landingBlockers([clear], "over", box).length, 0, "clear cow lets the stamp through");
  console.log("PASS landing-boarding-gap");
}

// --- Down-held glide: heading + strafe share a walk-pace floor ---------
// The runtime rule (tickFlight): while ArrowDown is held the vector keeps
// a walk-pace floor instead of dying with |vy|, so the mouse heading and
// a deliberate strafe glide the hull in XZ over the herd. Free descent
// keeps the climb-slaved vector, so the flight model is one rule.
// Pure vector composition, no THREE.
{
  const DOWN_SLIDE = 4.4; // mirrors src/vehicles/rocket.js (WALK)
  const norm = (x, z, s) => {
    const l = Math.hypot(x, z);
    return l > 0 ? [(x / l) * s, (z / l) * s] : [0, 0];
  };
  // Down held, climb near zero, mouse north + strafe right: diagonal
  // glide at full walk pace (the old |vy|-coupled vector read ~0 here).
  const [gx, gz] = norm(0 + 1, -1 + 0, Math.max(0.01, DOWN_SLIDE));
  assert.ok(Math.abs(Math.hypot(gx, gz) - DOWN_SLIDE) < 1e-9, "glide holds walk pace at zero climb");
  assert.ok(gx > 0 && gz < 0, "glide follows heading + strafe");
  // Mouse north alone: full walk pace forward (the heading glides).
  assert.deepEqual(norm(0, -1, DOWN_SLIDE), [0, -4.4], "mouse heading glides without strafe");
  // Free descent (Down released) keeps the climb-slaved vector.
  const hBase = 26 * (1 / 60);
  const [hx, hz] = norm(0, -1, hBase);
  assert.ok(Math.abs(hx) < 1e-9 && Math.abs(hz + hBase) < 1e-9, "free descent keeps heading drift");
  console.log("PASS landing-glide");
}

// --- wiring pins: glide floor + rate-limited hold in the flight loop -----
{
  const rocketSrc = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(rocketSrc.includes("const DOWN_SLIDE = WALK"), "glide floor tracks walk pace");
  assert.ok(rocketSrc.includes("Math.max(hBase, DOWN_SLIDE)"), "Down-held vector keeps the floor");
  assert.ok(rocketSrc.includes("const HOLD_SLEW = 2"), "hold tracks the floor rate-limited");
  assert.ok(rocketSrc.includes("function holdAtMargin(dt)"), "the hold takes the tick step");
  assert.ok(rocketSrc.includes("tryStartLanding(dt)"), "landing decisions funnel through the hold");
  console.log("PASS landing-glide-wiring");
}

console.log("landing-mobs.test.mjs: ok");
