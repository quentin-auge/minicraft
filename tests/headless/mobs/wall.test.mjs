// Touch wall-following: the REAL mover on REAL voxels, headless.
// A wall touch latches a virtual 1-wide corridor (real wall + invisible
// complementary wall) with 50/50 probability — admit or keep roaming —
// and the unchanged servo walks it parallel and glued: yaw locked on the
// cardinal lane axis (never diagonal), lateral glued at 0.5 from the face.
// Rides run on a roam-clock budget (uniform 2–8 s, like roam commits),
// then quit to roam at a deflected heading (or keep riding when boxed in).
// The legacy rigs below pin the pre-budget ride (mob.pinWallRide: always
// latch, never expire) so they assert geometry, not probability; the
// entry/budget/keep-riding rigs at the end run unpinned. Junctions keep
// the same physical wall (forced, straights first); wall ends round the
// corner (inner and outer, all four directions) or U-turn in place. A ride
// never switches walls (same face plane on straights, tip-connected takes
// on turns — refused takes U-turn, never a stranger wall) and only a
// genuinely continuing 1-wide corridor hands over to the rail.
// Blue = touch ride (wallFollow).
import assert from "node:assert/strict";
import { AIR, STONE } from "../../../src/core/blocks.js";
import { setDimension, resetWorld, setBlock } from "../../../src/core/store.js";
import { LIVESTOCK_SPECS, specCircles } from "../../../src/mobs/livestock.js";
import { FARM_WALK, tickFarmMob, aabbIntersectsSolid } from "../../../src/mobs/mover.js";
import { NO_EXPIRY } from "../../../src/mobs/step.js";
import { makeCellFree } from "../../../src/mobs/step.js";
import { FOLLOW_RANGE, SPAN_MIN, SPAN_MAX, latchTouchWall, latchFlankTouch, wallQuitHeading } from "../../../src/mobs/roam.js";

const FEET = 1;
const DT = 1 / 60;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 0xf) | 0, 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flat(x0, x1, z0, z1) {
  resetWorld("over");
  setDimension("over");
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) setBlock(x, 0, z, STONE);
}

function wall(x, z) {
  setBlock(x, 1, z, STONE);
  setBlock(x, 2, z, STONE);
}

function makeMob(x, z, yaw, rand) {
  const spec = LIVESTOCK_SPECS["pig"];
  const shape = specCircles(spec);
  return {
    type: "pig", dim: "over", pos: { x, y: FEET, z }, vel: { y: 0 },
    hw: shape.hw, h: shape.h, nose: shape.nose, tail: shape.tail,
    maxDrop: spec.drop ?? 1, alive: true, root: null,
    yaw, yawTarget: yaw, target: null, wanderT: NO_EXPIRY,
    legPhase: 0, speed: FARM_WALK, rand,
    stuckT: 0, lastX: x, lastZ: z, fallFrom: FEET, lane: null, servoStall: 0,
    blendFrom: null, blendT: 0, roam: null, followLine: null, followCool: 0,
    turnHold: 0,
    funnelT: 0, funnelCool: 0, jrng: null, wallFollow: false, oneWide: false,
    pinWallRide: true, // legacy rigs: always latch, never expire
  };
}

// Drive a mob with a fixed far target; record blue (touch ride) ticks.
function run(mob, target, ticks) {
  const trace = [];
  for (let t = 0; t < ticks; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    trace.push({
      x: mob.pos.x, z: mob.pos.z, yaw: mob.yaw,
      lane: mob.lane ? mob.lane.axis : null,
      fl: mob.followLine ? { ...mob.followLine } : null,
      blue: mob.wallFollow === true,
    });
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `body in wall @tick${t} (${mob.pos.x.toFixed(2)},${mob.pos.z.toFixed(2)})`);
  }
  return trace;
}

function yawDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// Real wall within latch range on the followed side (anti-phantom: a
// blue tick with only void or open field around is a phantom ride).
function realWallNear(mob, fl) {
  const latIsX = fl.axis === 0 || fl.axis === Math.PI;
  const dir = -fl.side; // world-lateral sign toward the real wall
  const lat = latIsX ? mob.pos.x : mob.pos.z;
  const cellFree = makeCellFree(mob);
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  for (let k = 1; k < 4; k++) {
    const bx = latIsX ? cx + dir * k : cx, bz = latIsX ? cz : cz + dir * k;
    if (!cellFree(bx, bz)) {
      const face = latIsX ? (dir > 0 ? bx : bx + 1) : (dir > 0 ? bz : bz + 1);
      return (face - lat) * dir <= FOLLOW_RANGE + 0.05;
    }
  }
  return false;
}

// Blue ticks outside corner-blend windows (30 ticks after each lane- or
// line-change): the entry sweep and the servo blend legitimately pass
// through oblique yaws for ~0.5 s, exactly like 1-wide corridor turns —
// steady diagonal cruising outside those windows is the bug.
function steadyBlue(trace) {
  let lastChange = -100, prevKey = null;
  return trace.filter((p, i) => {
    const key = `${p.lane}|${p.fl ? `${p.fl.axis}:${p.fl.line}` : ""}`;
    if (key !== prevKey) { lastChange = i; prevKey = key; }
    return p.blue && i - lastChange >= 30;
  });
}

// --- touch latches every time when pinned (legacy 100%: no gate draw,
// no budget — geometry asserts below run unpinned in the entry rigs).
// Straight-on touches (heading within HEADON_TOL of the wall normal)
// draw lots between both parallels; oblique touches keep their sense
// (target side, else the yaw tiebreak). Either way the ride is
// permanent while pinned: still blue at the end. ---
for (let seed = 1; seed <= 6; seed++) {
  flat(-8, 8, -4, 8);
  for (let x = -4; x <= 4; x++) wall(x, 2);
  const oblique = seed % 2 === 0;
  const mob = makeMob(-3.5, 1.0, oblique ? 0.5 : 0, mulberry32(seed));
  const trace = run(mob, { x: -3.5, z: 30 }, 400);
  const latched = trace.findIndex((p) => p.fl);
  assert.ok(latched >= 0 && latched < 300, `seed${seed}: touch latches (first ${latched})`);
  const fl = trace[latched].fl;
  assert.ok(Math.abs(fl.line - 1.5) < 1e-9, `seed${seed}: glued line at cell centre (${fl.line})`);
  assert.ok(trace[latched].blue, `seed${seed}: blue on latch`);
  if (oblique) {
    assert.ok(trace[latched].lane === Math.PI / 2, `seed${seed}: oblique keeps its sense (east)`);
  } else {
    assert.ok(trace[latched].lane === Math.PI / 2 || trace[latched].lane === -Math.PI / 2,
      `seed${seed}: straight-on draws a parallel (lane=${trace[latched].lane})`);
  }
  assert.ok(fl.touch === true, `seed${seed}: permanent touch ride`);
  assert.ok(trace[trace.length - 1].blue, `seed${seed}: still glued at the end (no clock expiry)`);
}
console.log("PASS touch-latch-pinned");

// --- straight-on draws lots: both parallels come out across seeds ---
{
  let east = 0, west = 0;
  for (let seed = 1; seed <= 24; seed++) {
    flat(-8, 8, -4, 8);
    for (let x = -4; x <= 4; x++) wall(x, 2);
    const mob = makeMob(-3.5, 1.0, 0, mulberry32(seed));
    const trace = run(mob, { x: -3.5, z: 30 }, 400);
    const latched = trace.findIndex((p) => p.fl);
    assert.ok(latched >= 0, `draw seed${seed}: latched`);
    // Even with a target due north, a straight-on touch ignores it.
    if (trace[latched].lane === Math.PI / 2) east++;
    else if (trace[latched].lane === -Math.PI / 2) west++;
    else assert.fail(`draw seed${seed}: lane=${trace[latched].lane}`);
  }
  assert.ok(east >= 4 && west >= 4, `draw: both sides come out (east=${east} west=${west})`);
}
console.log("PASS headon-draw");

// --- oblique touches keep their sense on every seed, both lean sides
// (target offset to the leaning side, as in game) ---
for (const [yaw, tx, want, name] of [[0.5, 1.0, Math.PI / 2, "right"], [-0.5, -8.0, -Math.PI / 2, "left"]]) {
  for (let seed = 1; seed <= 6; seed++) {
    flat(-8, 8, -4, 8);
    for (let x = -4; x <= 4; x++) wall(x, 2);
    const mob = makeMob(-3.5, 1.0, yaw, mulberry32(seed));
    const trace = run(mob, { x: tx, z: 30 }, 400);
    const latched = trace.findIndex((p) => p.fl);
    assert.ok(latched >= 0 && latched < 300, `oblique-${name} seed${seed}: latches`);
    assert.ok(trace[latched].lane === want, `oblique-${name} seed${seed}: keeps its sense`);
    assert.ok(trace[trace.length - 1].blue, `oblique-${name} seed${seed}: still glued`);
  }
}
console.log("PASS oblique-keeps-sense");

// --- flank graze: walking parallel with the wall rubbing the side
// latches at once (contact is contact, whatever the angle), then glued ---
{
  flat(-10, 10, -4, 8);
  for (let x = -6; x <= 6; x++) wall(x, 2);
  const mob = makeMob(-5.5, 1.6, Math.PI / 2, mulberry32(31));
  const trace = run(mob, { x: 10, z: 1.6 }, 600);
  const latched = trace.findIndex((p) => p.fl);
  assert.ok(latched >= 0 && latched < 50, `graze: flank contact latches (first ${latched})`);
  assert.ok(trace[latched].fl.touch === true, `graze: permanent touch ride`);
  const ride = steadyBlue(trace).filter((p) => p.fl.axis === Math.PI / 2);
  assert.ok(ride.length > 40, `graze: glued ride holds (${ride.length} ticks)`);
  for (const p of ride) {
    assert.ok(Math.abs(p.z - 1.5) < 0.12, `graze: 0.5 off the face (z=${p.z.toFixed(2)})`);
    assert.ok(yawDiff(p.yaw, Math.PI / 2) < 0.06, `graze: cardinal yaw`);
  }
}
console.log("PASS flank-graze");

// --- lone wall walk: parallel at 1.5 m (past graze range) never engages
// a lane — open roam owns every tick, the 1-wide rail stays out ---
{
  flat(-24, 24, -8, 8);
  for (let x = -20; x <= 20; x++) wall(x, 2);
  const mob = makeMob(0.5, 0.5, Math.PI / 2, mulberry32(15));
  const trace = run(mob, { x: 30, z: 0.5 }, 600);
  assert.ok(trace.every((p) => p.lane == null), `nograb: never a lane alongside a lone wall`);
  assert.ok(trace.every((p) => !p.blue), `nograb: never a ride without contact`);
  assert.ok(mob.pos.x > 8, `nograb: roam makes progress (x=${mob.pos.x.toFixed(1)})`);
  assert.ok(trace.every((p) => p.z < 2), `nograb: never through the wall`);
}
console.log("PASS no-grab-lone-wall");

// --- long straight: glued 0.5, cardinal yaw (never diagonal), no U-turn,
// then the tip is rounded (never marched past, never released): the ride
// stays blue around the end face and back along the other side ---
{
  flat(-10, 24, -4, 8);
  for (let x = -6; x <= 6; x++) wall(x, 2);
  const mob = makeMob(-5.5, 1.0, 0.5, mulberry32(7));
  const target = { x: -5.5, z: 30 };
  const trace = [];
  for (let t = 0; t < 1500 && mob.pos.x < 5.5; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    trace.push({
      x: mob.pos.x, z: mob.pos.z, yaw: mob.yaw,
      lane: mob.lane ? mob.lane.axis : null,
      fl: mob.followLine ? { ...mob.followLine } : null,
      blue: mob.wallFollow === true,
      ph: 1,
    });
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `glued: body in wall @tick${t}`);
  }
  assert.ok(mob.pos.x >= 5.5, `glued: traversed the wall (x=${mob.pos.x.toFixed(1)})`);
  const blue = steadyBlue(trace);
  assert.ok(blue.length > 200, `glued: follow holds (${blue.length} steady blue ticks)`);
  for (const p of blue) {
    assert.ok(Math.abs(p.z - 1.5) < 0.12, `glued: 0.5 off the face (z=${p.z.toFixed(2)})`);
    assert.ok(yawDiff(p.yaw, Math.PI / 2) < 0.06, `glued: cardinal yaw (yaw=${p.yaw.toFixed(2)})`);
    assert.ok(p.lane === Math.PI / 2, `glued: never U-turns while blue`);
  }
  for (let t = 0; t < 400; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    trace.push({
      x: mob.pos.x, z: mob.pos.z, yaw: mob.yaw,
      lane: mob.lane ? mob.lane.axis : null,
      fl: mob.followLine ? { ...mob.followLine } : null,
      blue: mob.wallFollow === true,
      ph: 2,
    });
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `glued tip: body in wall @tick${t}`);
  }
  // Rounded the tip instead of marching past: swung around the end (past
  // the last wall cell, off the south face) and still blue — the wall is
  // followed, not left, and never phantom-marched east into the void.
  const phase2 = trace.filter((p) => p.ph === 2);
  assert.ok(phase2.some((p) => p.blue && p.x > 6.4 && p.z > 1.6),
    `glued: rounded the tip instead of marching past`);
  assert.ok(phase2[phase2.length - 1].blue, `glued: still glued at the end`);
  assert.ok(Math.max(...phase2.map((p) => p.x)) < 12,
    `glued: no runaway east march`);
  // Anti-phantom over the whole ride: every steady blue tick has a real
  // wall face in latch range (grace on fresh lines still pulling in).
  for (const p of blue) {
    assert.ok((p.fl.fresh ?? 0) > 0 || realWallNear({ pos: { x: p.x, y: FEET, z: p.z }, h: 1.3, maxDrop: 1 }, p.fl),
      `glued: no phantom ride (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
}
console.log("PASS glued-parallel");

// --- inner corner: L wall, turn in and keep the wall, still glued ---
{
  flat(-8, 10, -4, 10);
  for (let z = 0; z <= 1; z++) wall(2, z); // east stem wall (continuity breaker)
  for (let x = 2; x <= 5; x++) wall(x, 1); // arm south wall (lane z=2 glued)
  const mob = makeMob(1.0, 0.5, Math.PI / 2 - 0.5, mulberry32(11));
  const trace = run(mob, { x: 1.3, z: 30 }, 1200);
  const blue = trace.filter((p) => p.blue);
  assert.ok(blue.length > 100, `inner: follow holds (${blue.length} blue ticks)`);
  const turned = trace.findIndex((p) => p.fl && p.fl.axis === Math.PI / 2);
  assert.ok(turned >= 0, `inner: turned east into the arm`);
  const arm = steadyBlue(trace.slice(turned))
    .filter((p) => p.fl.axis === Math.PI / 2 && Math.abs(p.fl.line - 2.5) < 1e-9);
  assert.ok(arm.length > 40, `inner: keeps following in the arm (${arm.length} ticks)`);
  for (const p of arm) {
    assert.ok(Math.abs(p.z - 2.5) < 0.15, `inner: glued in the arm (z=${p.z.toFixed(2)})`);
    assert.ok(yawDiff(p.yaw, Math.PI / 2) < 0.06, `inner: cardinal yaw in the arm`);
  }
  assert.ok(trace.some((p) => p.blue && Math.abs((p.fl?.line ?? 0) - 2.5) < 1e-9 && p.x > 4),
    `inner: cruised the arm (reached x>4 glued)`);
}
console.log("PASS inner-corner");

// --- outer corner: wall tip rounds onto the perpendicular face ---
{
  flat(-8, 10, -4, 10);
  for (let x = -4; x <= 2; x++) wall(x, 2); // row ends at x=2
  for (let z = 2; z <= 6; z++) wall(2, z); // column rises north from the tip
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(13));
  const trace = run(mob, { x: -3.5, z: 30 }, 1700);
  const blue = trace.filter((p) => p.blue);
  assert.ok(blue.length > 100, `outer: follow holds (${blue.length} blue ticks)`);
  const north = steadyBlue(trace)
    .filter((p) => p.fl && p.fl.axis === 0 && p.x > 2.5 && p.x < 5 && p.z > 2);
  assert.ok(north.length > 30, `outer: glued north along the column (${north.length} ticks)`);
  for (const p of north.slice(-30)) {
    assert.ok(Math.abs(p.x - 3.5) < 0.15, `outer: glued 0.5 off the column (x=${p.x.toFixed(2)})`);
  }
  assert.ok(trace.some((p) => p.blue && p.fl && p.fl.axis === 0 &&
    Math.abs(p.fl.line - 3.5) < 1e-9 && p.z > 6),
    `outer: rounded the tip onto the column face`);
}
console.log("PASS outer-corner");

// --- inner corner, nose blocked: the perpendicular arm stops the ride,
// turn into it (same wall, same side) instead of U-turning ---
{
  flat(-8, 10, -4, 10);
  for (let x = -4; x <= 2; x++) wall(x, 2); // row, south face z=2
  for (let z = -2; z <= 2; z++) wall(3, z); // blocking column: nose hits it
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(21));
  const trace = run(mob, { x: -3.5, z: 30 }, 1500);
  const blue = trace.filter((p) => p.blue);
  assert.ok(blue.length > 100, `inner-nose: follow holds (${blue.length} blue ticks)`);
  const turned = trace.findIndex((p) => p.fl && p.fl.axis === Math.PI);
  assert.ok(turned >= 0, `inner-nose: turned south into the arm, no U-turn`);
  const arm = steadyBlue(trace.slice(turned))
    .filter((p) => p.fl.axis === Math.PI && Math.abs(p.fl.line - 2.5) < 1e-9);
  assert.ok(arm.length > 40, `inner-nose: keeps following in the arm (${arm.length} ticks)`);
  for (const p of arm) {
    assert.ok(Math.abs(p.x - 2.5) < 0.15, `inner-nose: glued in the arm (x=${p.x.toFixed(2)})`);
    assert.ok(yawDiff(p.yaw, Math.PI) < 0.06, `inner-nose: cardinal yaw in the arm`);
  }
  assert.ok(trace.some((p) => p.blue && p.fl && Math.abs(p.fl.line - 2.5) < 1e-9 && p.z < -1),
    `inner-nose: cruised the arm (reached z<-1 glued)`);
}
console.log("PASS inner-nose-blocked");

// --- outer corner westbound: mirror of outer-corner — ride west, round
// the west tip south onto the column (no U-turn); the tip scan walks
// signed steps so west/south travel finds the true tip ---
{
  flat(-10, 8, -4, 10);
  for (let x = -2; x <= 4; x++) wall(x, 2); // row ends at x=-2
  for (let z = -4; z <= 2; z++) wall(-2, z); // column descends south from the tip
  const mob = makeMob(3.5, 1.0, -0.5, mulberry32(13));
  const trace = run(mob, { x: -30, z: 30 }, 1700);
  const blue = trace.filter((p) => p.blue);
  assert.ok(blue.length > 100, `outer-west: follow holds (${blue.length} blue ticks)`);
  const south = (p) => p.fl && Math.abs(Math.abs(p.fl.axis) - Math.PI) < 1e-9;
  assert.ok(trace.some((p) => p.blue && south(p) && p.x < 0 && p.x > -2 && p.z < 1),
    `outer-west: turned south onto the column face, no U-turn`);
  const leg = steadyBlue(trace)
    .filter((p) => south(p) && Math.abs(p.fl.line - -0.5) < 1e-9);
  assert.ok(leg.length > 30, `outer-west: glued south along the column (${leg.length} ticks)`);
  for (const p of leg.slice(-30)) {
    assert.ok(Math.abs(p.x - -0.5) < 0.15, `outer-west: glued 0.5 off the column (x=${p.x.toFixed(2)})`);
  }
  assert.ok(trace.some((p) => p.blue && south(p) &&
    Math.abs(p.fl.line - -0.5) < 1e-9 && p.z < -3),
    `outer-west: cruised down the column face`);
}
console.log("PASS outer-corner-west");

// --- inner corner southbound: mirror of inner-nose-blocked — ride west,
// nose blocked by the column, turn south into the arm (no U-turn) ---
{
  flat(-10, 8, -6, 10);
  for (let x = -2; x <= 4; x++) wall(x, 2); // row, south face z=2
  for (let z = -2; z <= 2; z++) wall(-3, z); // blocking column: nose hits it
  const mob = makeMob(3.5, 1.0, -0.5, mulberry32(21));
  const trace = run(mob, { x: -30, z: 30 }, 1500);
  const blue = trace.filter((p) => p.blue);
  assert.ok(blue.length > 100, `inner-south: follow holds (${blue.length} blue ticks)`);
  const south = (p) => p.fl && Math.abs(Math.abs(p.fl.axis) - Math.PI) < 1e-9;
  const turned = trace.findIndex((p) => p.fl && south(p));
  assert.ok(turned >= 0, `inner-south: turned south into the arm, no U-turn`);
  const arm = steadyBlue(trace.slice(turned))
    .filter((p) => south(p) && Math.abs(p.fl.line - -1.5) < 1e-9);
  assert.ok(arm.length > 40, `inner-south: keeps following in the arm (${arm.length} ticks)`);
  for (const p of arm) {
    assert.ok(Math.abs(p.x - -1.5) < 0.15, `inner-south: glued in the arm (x=${p.x.toFixed(2)})`);
    assert.ok(yawDiff(p.yaw, Math.PI) < 0.06 || yawDiff(p.yaw, -Math.PI) < 0.06,
      `inner-south: cardinal yaw in the arm`);
  }
  assert.ok(trace.some((p) => p.blue && p.fl && Math.abs(p.fl.line - -1.5) < 1e-9 && p.z < -1),
    `inner-south: cruised the arm (reached z<-1 glued)`);
}
console.log("PASS inner-corner-south");

// --- freestanding tip: no perpendicular wall, the ride rounds the end
// face (carried line, still blue) and keeps following back along the
// wall — never phantom-marches straight past it, never releases ---
{
  flat(-10, 24, -4, 8);
  for (let x = -6; x <= 2; x++) wall(x, 2); // row ends at x=2, open field past
  const mob = makeMob(-5.5, 1.0, 0.5, mulberry32(7));
  const trace = run(mob, { x: -5.5, z: 30 }, 900);
  assert.ok(trace.some((p) => p.blue), `tip: follow engaged`);
  const hook = trace.findIndex((p) => p.blue && p.fl && p.fl.axis === 0 &&
    Math.abs(p.fl.line - 3.5) < 1e-9 && p.x > 2.5 && p.x < 5);
  assert.ok(hook >= 0, `tip: rounded the end face instead of marching past`);
  assert.ok(trace[trace.length - 1].blue, `tip: still glued at the end`);
  assert.ok(trace.slice(hook).some((p) => p.blue && p.x < 1.5),
    `tip: came back along the wall after the hook`);
  assert.ok(Math.max(...trace.map((p) => p.x)) < 9, `tip: no east runaway`);
}
console.log("PASS freestanding-tip");

// --- staircase: chained offset segments thread through without weaving ---
{
  flat(-8, 12, -4, 10);
  for (let x = -4; x <= 0; x++) wall(x, 2);
  wall(0, 3);
  for (let x = 0; x <= 4; x++) wall(x, 3);
  wall(4, 4);
  for (let x = 4; x <= 8; x++) wall(x, 4);
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(17));
  const trace = run(mob, { x: 8, z: 30 }, 2200);
  const blue = steadyBlue(trace);
  assert.ok(blue.length > 60, `stairs: follow engages (${blue.length} steady blue ticks)`);
  for (const p of blue) {
    const card = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
      .some((c) => yawDiff(p.yaw, c) < 0.06);
    assert.ok(card, `stairs: never diagonal (yaw=${p.yaw.toFixed(2)})`);
  }
  assert.ok(trace.some((p) => p.blue && p.fl && p.fl.axis === 0 && p.z > 1.6),
    `stairs: turned north up step 1 (forced corner)`);
}
console.log("PASS staircase");

// --- stub tip head-on: latch in front of a 1-wide stub end, ride to the
// tip, round it onto the flank (still blue, never straight through),
// and orbit back along the other face ---
{
  flat(-10, 12, -6, 12);
  for (let z = 2; z <= 6; z++) wall(0, z);
  const mob = makeMob(0.5, 1.0, 0.5, mulberry32(41));
  const trace = run(mob, { x: 5, z: 30 }, 900);
  assert.ok(trace.some((p) => p.blue), `stub: follow engaged`);
  const hook = trace.findIndex((p) => p.blue && p.fl && p.fl.axis === 0 &&
    Math.abs(p.fl.line - 1.5) < 1e-9 && p.x > 1 && p.x < 2.5 && p.z > 2);
  assert.ok(hook >= 0, `stub: hooked the east face instead of pushing through`);
  assert.ok(trace.slice(hook).some((p) => p.blue && p.x < 0 && p.z > 2),
    `stub: came back along the west face after the tip`);
  assert.ok(trace[trace.length - 1].blue, `stub: still glued at the end`);
}
console.log("PASS stub-tip");

// --- head-on into an inner corner: latch on the row, ride glued into the
// corner pocket, take the column arm (no grind, no drop, no U-turn) ---
{
  flat(-10, 12, -6, 12);
  for (let x = -4; x <= 0; x++) wall(x, 2);
  for (let z = 2; z <= 6; z++) wall(0, z);
  const mob = makeMob(-0.5, 1.0, 0.5, mulberry32(41));
  const trace = run(mob, { x: 5, z: 30 }, 900);
  assert.ok(trace.some((p) => p.blue), `corner-pocket: follow engaged`);
  assert.ok(trace.some((p) => p.blue && p.fl && p.fl.axis === 0 &&
    Math.abs(p.fl.line - 1.5) < 1e-9 && p.z > 2.5),
    `corner-pocket: turned up the column arm, still glued`);
  assert.ok(trace[trace.length - 1].blue, `corner-pocket: still glued at the end`);
}
console.log("PASS corner-pocket");

// --- setback arm: the wall ends, resumes one cell over — ride to the tip,
// round onto the column, down the slit (kept: the slit is still the wall,
// not a corridor), out and back along the row, blue end to end ---
{
  flat(-12, 14, -8, 14);
  for (let x = -4; x <= 2; x++) wall(x, 2);
  for (let z = 2; z <= 6; z++) wall(4, z);
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(41));
  const trace = run(mob, { x: -3.5, z: 30 }, 1500);
  assert.ok(trace.every((p) => p.blue), `setback: blue never breaks`);
  assert.ok(trace.some((p) => p.blue && p.fl && Math.abs(p.fl.line - 5.5) < 1e-9),
    `setback: rounded onto the column face`);
}
console.log("PASS setback-arm");

// --- no switch: a decoy wall past the tip never captures the ride —
// the mob U-turns at the decoy tip and paces its own wall (never the
// decoy face) instead of rounding onto the stranger ---
{
  flat(-10, 24, -4, 8);
  for (let x = -6; x <= 2; x++) wall(x, 2); // followed row, tip x=2
  for (let z = 0; z <= 4; z++) wall(5, z); // decoy column, 2 cells past the tip
  const mob = makeMob(-5.5, 1.0, 0.5, mulberry32(7));
  const trace = run(mob, { x: -5.5, z: 30 }, 1500);
  assert.ok(trace.some((p) => p.blue), `noswitch: follow engaged`);
  assert.ok(trace.every((p) => p.blue), `noswitch: blue never breaks`);
  for (const p of trace) {
    // Own faces only (south face, own tip roundings) — the decoy west
    // face (line 4.5) is never latched.
    assert.ok(Math.abs(p.fl.line - 4.5) > 1e-9,
      `noswitch: never on the decoy face (line=${p.fl.line})`);
  }
  assert.ok(trace.some((p) => p.x > 2), `noswitch: reached the tip`);
  assert.ok(trace.some((p) => p.x < -4), `noswitch: paced back instead of leaving`);
  assert.ok(trace.every((p) => p.x < 5), `noswitch: never reached the decoy`);
}
console.log("PASS no-switch-decoy");

// --- doorway ride: a 1-cell hole in the followed wall shares its face
// plane, so the ride crosses it (lookahead) without breaking or
// switching — blue and face continuous across the hole ---
{
  flat(-10, 24, -4, 8);
  for (let x = -6; x <= 6; x++) { if (x !== 0) wall(x, 2); } // hole at x=0
  const mob = makeMob(-5.5, 1.0, 0.5, mulberry32(7));
  const target = { x: -5.5, z: 30 };
  const trace = [];
  for (let t = 0; t < 1200 && mob.pos.x < 1.5; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    trace.push({
      x: mob.pos.x, z: mob.pos.z, yaw: mob.yaw,
      lane: mob.lane ? mob.lane.axis : null,
      fl: mob.followLine ? { ...mob.followLine } : null,
      blue: mob.wallFollow === true,
    });
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `doorride: body in wall @tick${t}`);
  }
  assert.ok(mob.pos.x >= 1.5, `doorride: crossed the hole (x=${mob.pos.x.toFixed(1)})`);
  assert.ok(trace.every((p) => p.blue), `doorride: blue never breaks across the hole`);
  for (const p of trace) {
    assert.ok(Math.abs((p.fl?.face ?? -1) - 2) < 1e-9,
      `doorride: same face across the hole (face=${p.fl?.face})`);
  }
}
console.log("PASS doorway-ride");

// --- mined wall: the followed wall vanishes mid-ride — U-turn in place
// and keep the line instead of wandering off ---
{
  flat(-10, 24, -4, 8);
  for (let x = -4; x <= 6; x++) wall(x, 2);
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(53));
  const target = { x: -3.5, z: 30 };
  for (let t = 0; t < 300 && mob.pos.x < 0; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `mined: clean before mining @${t}`);
  }
  assert.ok(mob.wallFollow, `mined: glued before mining`);
  for (let x = -1; x <= 6; x++) { setBlock(x, 1, 2, AIR); setBlock(x, 2, 2, AIR); }
  let flipped = false, minX = 1e9, maxX = -1e9, blueAfter = 0;
  for (let t = 0; t < 400; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `mined: clean after mining @${t}`);
    if (mob.wallFollow) blueAfter++;
    if (mob.lane && mob.lane.axis === -Math.PI / 2) flipped = true;
    minX = Math.min(minX, mob.pos.x); maxX = Math.max(maxX, mob.pos.x);
  }
  assert.ok(blueAfter === 400, `mined: blue never breaks (blue ${blueAfter}/400)`);
  assert.ok(flipped, `mined: U-turned instead of leaving`);
  assert.ok(maxX - minX < 10, `mined: stayed near the wall (span ${(maxX - minX).toFixed(1)})`);
}
console.log("PASS mined-wall");

// --- pocket pace: a U-shaped dead end never releases the ride — the mob
// enters through the mouth, touches the back wall (blue from the frontal
// contact on), U-turns at the arms, and paces the U (blue unbroken,
// contained) instead of leaving for open roam ---
{
  flat(-6, 6, -4, 10);
  for (let x = -2; x <= 2; x++) wall(x, 4);
  for (let z = 0; z <= 4; z++) { wall(-2, z); wall(2, z); }
  const mob = makeMob(0.5, 0.5, 0, mulberry32(23));
  const trace = run(mob, { x: 0.5, z: 30 }, 1500);
  const enteredAt = trace.findIndex((p) => p.z > 1.2);
  assert.ok(enteredAt >= 0, `pocket: entered the mouth`);
  const firstBlue = trace.findIndex((p) => p.blue);
  assert.ok(firstBlue >= 0, `pocket: ride latched on the back wall`);
  assert.ok(trace.slice(firstBlue).every((p) => p.blue), `pocket: blue never breaks after latch`);
  let flips = 0;
  for (let i = firstBlue + 1; i < trace.length; i++) {
    if (trace[i].lane !== trace[i - 1].lane) flips++;
  }
  assert.ok(flips >= 4, `pocket: paces the U instead of leaving (${flips} lane turns)`);
  assert.ok(trace.slice(firstBlue).every((p) => Math.abs(p.x) < 4 && p.z < 7 && p.z > -4),
    `pocket: contained near the walls`);
}
console.log("PASS pocket-pace");

// --- doorway: a through hole funnels past, no touch latch blocks it ---
// Proved by a crossing inside the hole column (not around the wall ends).
{
  flat(-6, 6, -4, 8);
  for (let x = -4; x <= 4; x++) { if (x !== 0) wall(x, 2); }
  const mob = makeMob(0.5, 0.5, 0, mulberry32(21));
  const trace = run(mob, { x: 0.5, z: 30 }, 600);
  assert.ok(trace.some((p) => p.z > 2.2 && Math.abs(p.x - 0.5) < 0.6),
    `doorway: funneled through the hole`);
}
console.log("PASS doorway");

// --- entry gate: oblique frontal contact admits or refuses on one draw
// (stub rand), refusals hold the next latch off; admits sample the
// roam-clock budget ---
{
  flat(-8, 8, -4, 8);
  for (let x = -4; x <= 4; x++) wall(x, 2);
  const refused = makeMob(-3.5, 1.0, 0.5, mulberry32(7));
  refused.pinWallRide = false;
  assert.ok(latchTouchWall(refused, DT, 0, null, () => 0.9) === null, `gate: stub 0.9 refuses`);
  assert.ok(refused.followLine == null, `gate: no line on refusal`);
  assert.ok(refused.followCool > 0, `gate: refusal holds the next latch off`);
  const admitted = makeMob(-3.5, 1.0, 0.5, mulberry32(7));
  admitted.pinWallRide = false;
  const axis = latchTouchWall(admitted, DT, 0, null, () => 0.1);
  assert.ok(axis === Math.PI / 2, `gate: stub 0.1 admits, oblique keeps its sense`);
  assert.ok(admitted.followLine.touch === true, `gate: touch ride on admit`);
  assert.ok(admitted.followLine.wallSpan >= SPAN_MIN &&
    admitted.followLine.wallSpan <= SPAN_MAX,
    `gate: budget samples the roam clock (${admitted.followLine.wallSpan})`);
  assert.ok(admitted.followLine.t === 0, `gate: ride clock starts at zero`);
}
console.log("PASS entry-gate-unit");

// --- entry rate: first-contact oblique latches land near half over seeds ---
{
  let firstTry = 0;
  for (let seed = 1; seed <= 40; seed++) {
    flat(-8, 8, -4, 8);
    for (let x = -4; x <= 4; x++) wall(x, 2);
    const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(seed));
    mob.pinWallRide = false;
    tickFarmMob(mob, DT, () => ({ x: -3.5, z: 30 }), mob.rand);
    if (mob.followLine) firstTry++;
  }
  assert.ok(firstTry >= 12 && firstTry <= 28, `gate: first-contact admits near half (${firstTry}/40)`);
}
console.log("PASS entry-gate-rate");

// --- flank gate: a parallel graze admits or refuses the same way ---
{
  flat(-10, 10, -4, 8);
  for (let x = -6; x <= 6; x++) wall(x, 2);
  const refused = makeMob(-5.5, 1.6, Math.PI / 2, mulberry32(31));
  refused.pinWallRide = false;
  assert.ok(latchFlankTouch(refused, DT, Math.PI / 2, () => 0.9) === null, `flank-gate: stub 0.9 refuses`);
  assert.ok(refused.followLine == null && refused.followCool > 0, `flank-gate: refusal holds latch off`);
  const admitted = makeMob(-5.5, 1.6, Math.PI / 2, mulberry32(31));
  admitted.pinWallRide = false;
  assert.ok(latchFlankTouch(admitted, DT, Math.PI / 2, () => 0.1) === Math.PI / 2, `flank-gate: stub 0.1 admits`);
  assert.ok(admitted.followLine.touch === true, `flank-gate: touch ride on admit`);
}
console.log("PASS flank-gate");

// --- corner rounding unpinned: same wall and seed as the pinned
// outer-corner rig, but the ride may expire — the mob rounds the tip
// onto the column (still blue), rides it, then quits on its budget ---
{
  flat(-8, 10, -4, 10);
  for (let x = -4; x <= 2; x++) wall(x, 2); // row ends at x=2
  for (let z = 2; z <= 6; z++) wall(2, z); // column rising north from the tip
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(7));
  mob.pinWallRide = false;
  const target = { x: -3.5, z: 30 };
  let latchTick = -1, span = 0, quitTick = -1;
  let rounded = false, northLeg = 0;
  for (let t = 0; t < 1200; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `corner-unpinned: body in wall @tick${t}`);
    if (latchTick < 0 && mob.followLine) { latchTick = t; span = mob.followLine.wallSpan; }
    if (latchTick >= 0 && mob.wallFollow && mob.followLine &&
        mob.followLine.axis === 0 && Math.abs(mob.followLine.line - 3.5) < 1e-9 && mob.pos.z > 2) {
      rounded = true;
      if (Math.abs(mob.pos.x - 3.5) < 0.15) northLeg++;
    }
    if (latchTick >= 0 && quitTick < 0 && !mob.lane && mob.roam?.mode === "commit") quitTick = t;
    if (quitTick >= 0 && t > quitTick + 30) break;
  }
  assert.ok(latchTick >= 0 && latchTick < 120, `corner-unpinned: latched (tick ${latchTick})`);
  assert.ok(rounded, `corner-unpinned: rounded the tip onto the column face`);
  assert.ok(northLeg > 30, `corner-unpinned: glued north along the column (${northLeg} ticks)`);
  assert.ok(quitTick > latchTick, `corner-unpinned: budget ended the ride (latch ${latchTick}, quit ${quitTick})`);
  assert.ok(quitTick - latchTick === Math.ceil(span * 60),
    `corner-unpinned: quit delay matches the span (${quitTick - latchTick} ticks for ${span.toFixed(2)} s)`);
  assert.ok(mob.followCool > 0, `corner-unpinned: quit holds the next latch off`);
}
console.log("PASS corner-rounding-unpinned");

// --- outer-turn lottery: seed 17 exits straight at the tip (no rounding
// at all), same geometry pinned rounds — one draw decides, both pinned ---
{
  flat(-8, 10, -4, 10);
  for (let x = -4; x <= 2; x++) wall(x, 2); // row ends at x=2
  for (let z = 2; z <= 6; z++) wall(2, z); // column
  const mob = makeMob(-3.5, 1.0, 0.5, mulberry32(17));
  mob.pinWallRide = false;
  const target = { x: -3.5, z: 30 };
  let latchTick = -1, quitTick = -1, quitYaw = 0, qx = 0, rounded = false;
  for (let t = 0; t < 1200; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `lottery: body in wall @tick${t}`);
    if (latchTick < 0 && mob.followLine) latchTick = t;
    if (latchTick >= 0 && mob.wallFollow && mob.followLine &&
        Math.abs(mob.followLine.axis) < 1e-9) rounded = true;
    if (latchTick >= 0 && quitTick < 0 && !mob.lane && mob.roam?.mode === "commit") {
      quitTick = t; quitYaw = mob.roam.heading; qx = mob.pos.x;
    }
    if (quitTick >= 0 && t > quitTick + 30) break;
  }
  assert.ok(latchTick >= 0 && latchTick < 120, `lottery: latched (tick ${latchTick})`);
  assert.ok(!rounded, `lottery: never rounded (seed 17 exits)`);
  assert.ok(quitTick > latchTick, `lottery: left the wall (latch ${latchTick}, quit ${quitTick})`);
  assert.ok(yawDiff(quitYaw, Math.PI / 2) < 0.05, `lottery: straight on the pre-turn axis (qyaw=${quitYaw.toFixed(2)})`);
  assert.ok(qx > 2.2, `lottery: past the tip (x=${qx.toFixed(1)})`);
  assert.ok(mob.followCool > 0, `lottery: quit holds the next latch off`);
  // Same seed pinned: the lottery never fires, the tip rounds.
  flat(-8, 10, -4, 10);
  for (let x = -4; x <= 2; x++) wall(x, 2);
  for (let z = 2; z <= 6; z++) wall(2, z);
  const pinned = makeMob(-3.5, 1.0, 0.5, mulberry32(17));
  let pinnedRound = false;
  for (let t = 0; t < 1200 && !pinnedRound; t++) {
    tickFarmMob(pinned, DT, () => target, pinned.rand);
    if (pinned.wallFollow && pinned.followLine && Math.abs(pinned.followLine.axis) < 1e-9) pinnedRound = true;
  }
  assert.ok(pinnedRound, `lottery: pinned seed 17 rounds`);
}
console.log("PASS outer-turn-lottery");

// --- long straight wall unpinned: the ride parades to the tip, U-turns
// in place and paces back (legacy geometry), until the budget quits it ---
{
  flat(-10, 24, -4, 8);
  for (let x = -6; x <= 6; x++) wall(x, 2);
  const mob = makeMob(-5.5, 1.0, 0.5, mulberry32(7));
  mob.pinWallRide = false;
  const target = { x: -5.5, z: 30 };
  let latchTick = -1, quitTick = -1, span = 0;
  let flipped = false, maxX = -1e9, blueUntilQuit = true;
  for (let t = 0; t < 900; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `tip-pace: body in wall @tick${t}`);
    if (latchTick < 0 && mob.followLine) { latchTick = t; span = mob.followLine.wallSpan; }
    if (latchTick >= 0 && quitTick < 0) {
      if (!mob.lane && mob.roam?.mode === "commit") quitTick = t;
      else {
        if (!mob.wallFollow) blueUntilQuit = false;
        if (mob.lane && mob.lane.axis === -Math.PI / 2) flipped = true;
        maxX = Math.max(maxX, mob.pos.x);
      }
    }
    if (latchTick >= 0 && t === latchTick + 100) {
      assert.ok(mob.wallFollow, `tip-pace: no quit before any exit (still blue @+100 ticks)`);
    }
    if (quitTick >= 0 && t > quitTick + 30) break;
  }
  assert.ok(latchTick >= 0 && latchTick < 120, `tip-pace: latched (tick ${latchTick})`);
  assert.ok(maxX > 6.2, `tip-pace: reached the tip (maxX=${maxX.toFixed(1)})`);
  assert.ok(flipped, `tip-pace: U-turned at the tip instead of leaving`);
  assert.ok(blueUntilQuit, `tip-pace: blue unbroken until the budget`);
  assert.ok(quitTick > latchTick, `tip-pace: budget ended the ride (latch ${latchTick}, quit ${quitTick})`);
  assert.ok(quitTick - latchTick === Math.ceil(span * 60),
    `tip-pace: quit delay matches the span (${quitTick - latchTick} ticks for ${span.toFixed(2)} s)`);
  assert.ok(mob.followCool > 0, `tip-pace: quit holds the next latch off`);
}
console.log("PASS tip-pace-unpinned");

// --- budget exit: an expired ride leaves 45 degrees away from the wall
// (hand-set short span on a straight ride, so the budget fires) ---
{
  flat(-10, 24, -4, 8);
  for (let x = -6; x <= 6; x++) wall(x, 2);
  const mob = makeMob(-5.5, 1.0, 0.5, mulberry32(1));
  mob.pinWallRide = false;
  const target = { x: -5.5, z: 30 };
  let latchTick = -1, quitTick = -1, quitYaw = 0, axis = 0;
  for (let t = 0; t < 400 && quitTick < 0; t++) {
    tickFarmMob(mob, DT, () => target, mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `budget: body in wall @tick${t}`);
    if (latchTick < 0 && mob.followLine) {
      latchTick = t; axis = mob.lane.axis;
      mob.followLine.wallSpan = 0.2; // fire the budget on the straight, now
    }
    if (latchTick >= 0 && !mob.lane && mob.roam?.mode === "commit") {
      quitTick = t; quitYaw = mob.roam.heading;
    }
  }
  assert.ok(latchTick >= 0, `budget: latched`);
  assert.ok(quitTick > latchTick, `budget: quit after expiry`);
  assert.ok(quitTick - latchTick < 120, `budget: quit follows the span promptly (${quitTick - latchTick} ticks)`);
  assert.ok(yawDiff(quitYaw, axis + Math.PI / 4) < 0.05,
    `budget: quits 45 degrees away from the wall (qyaw=${quitYaw.toFixed(2)})`);
  assert.ok(mob.followCool > 0, `budget: quit holds the next latch off`);
}
console.log("PASS ride-budget-quit");

// --- pocket visit: an unpinned ride paces the U briefly, then leaves
// (no eternal pacing) and ends outside roaming ---
{
  flat(-6, 6, -4, 10);
  for (let x = -2; x <= 2; x++) wall(x, 4);
  for (let z = 0; z <= 4; z++) { wall(-2, z); wall(2, z); }
  const mob = makeMob(0.5, 0.5, 0, mulberry32(23));
  mob.pinWallRide = false;
  let latchTick = -1, quitTick = -1;
  for (let t = 0; t < 2500; t++) {
    tickFarmMob(mob, DT, () => ({ x: 0.5, z: 30 }), mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `pocket-visit: body in wall @tick${t}`);
    if (latchTick < 0 && mob.followLine) latchTick = t;
    if (latchTick >= 0 && quitTick < 0 && !mob.lane) quitTick = t;
    if (quitTick >= 0 && t > quitTick + 30) break;
  }
  assert.ok(latchTick >= 0, `pocket-visit: ride latched on the back wall`);
  assert.ok(quitTick > latchTick, `pocket-visit: ride left (latch ${latchTick}, quit ${quitTick})`);
  assert.ok(Math.abs(mob.pos.x) > 4 || mob.pos.z < 0 || mob.pos.z > 7,
    `pocket-visit: outside roaming ((${mob.pos.x.toFixed(1)},${mob.pos.z.toFixed(1)}))`);
  assert.ok(mob.roam?.mode === "commit", `pocket-visit: roam owns the mob after`);
}
console.log("PASS pocket-visit");

// --- keep riding when boxed: both quit headings (45° away, perpendicular)
// blocked extends the short retry clock instead of quitting (hand-set
// expired ride over a stub wall whose cell is the only walled flank
// ahead-cell gap) ---
{
  flat(-4, 4, -4, 4);
  for (let x = -2; x <= 2; x++) wall(x, 2); // followed row, south face z=2
  wall(0, 0); // single stub cell south of the ride line
  const mob = makeMob(0.2, 1.5, Math.PI / 2, mulberry32(3));
  mob.pinWallRide = false;
  mob.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: 0, lockZ: 1 };
  mob.followLine = {
    axis: Math.PI / 2, line: 1.5, side: -1, rel: 1,
    virtual: true, touch: true, fresh: 0, face: 2, t: 999, wallSpan: 1,
  };
  mob.yawTarget = Math.PI / 2;
  assert.ok(wallQuitHeading(mob, true, false) === null, `boxed: no quit heading with the stub near`);
  // Same ride without the stub quits 45° away.
  const open = makeMob(0.2, 1.5, Math.PI / 2, mulberry32(3));
  open.pinWallRide = false;
  open.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: 0, lockZ: 1 };
  open.followLine = {
    axis: Math.PI / 2, line: 1.5, side: -1, rel: 1,
    virtual: true, touch: true, fresh: 0, face: 2, t: 0, wallSpan: 99,
  };
  setBlock(0, 1, 0, AIR); setBlock(0, 2, 0, AIR);
  assert.ok(Math.abs(wallQuitHeading(open, true, false) - (Math.PI / 2 + Math.PI / 4)) < 1e-9,
    `boxed: open ground quits 45° away`);
  setBlock(0, 1, 0, STONE); setBlock(0, 2, 0, STONE);
  tickFarmMob(mob, DT, () => ({ x: 30, z: 1.5 }), mob.rand);
  assert.ok(mob.wallFollow && mob.lane != null, `boxed: ride holds past expiry`);
  assert.ok(mob.followLine.wallSpan === 2, `boxed: short retry clock, not quit (${mob.followLine.wallSpan})`);
  assert.ok(mob.roam == null, `boxed: no roam commit while boxed`);
  for (let t = 0; t < 4; t++) {
    tickFarmMob(mob, DT, () => ({ x: 30, z: 1.5 }), mob.rand);
    assert.ok(!aabbIntersectsSolid(mob.pos.x, mob.pos.y, mob.pos.z, 0.32, 1.3),
      `boxed: clean @${t}`);
  }
  assert.ok(mob.wallFollow, `boxed: still riding, never quit into the stub`);
}
console.log("PASS keep-riding-boxed");

// --- budget picks the roomiest of 45° and 90° away (never straight):
// a stub clipping the diagonal leaves the perpendicular, open field
// ties to the 45° (first max wins) ---
{
  const rig = (stub) => {
    flat(-4, 4, -4, 4);
    for (let x = -2; x <= 2; x++) wall(x, 2); // followed row, south face z=2
    if (stub) wall(...stub);
    const mob = makeMob(0.2, 1.5, Math.PI / 2, mulberry32(3));
    mob.pinWallRide = false;
    mob.lane = { axis: Math.PI / 2, entry: -Math.PI / 2, lockX: 0, lockZ: 1 };
    mob.followLine = {
      axis: Math.PI / 2, line: 1.5, side: -1, rel: 1,
      virtual: true, touch: true, fresh: 0, face: 2, t: 0, wallSpan: 99,
    };
    return wallQuitHeading(mob, true, false);
  };
  assert.ok(Math.abs(rig([1, 0]) - Math.PI) < 1e-9, `roomiest: stubbed diagonal quits perpendicular`);
  assert.ok(Math.abs(rig(null) - (Math.PI / 2 + Math.PI / 4)) < 1e-9, `roomiest: open field quits 45°`);
}
console.log("PASS budget-roomiest");

// --- same seed, identical ride ---
{
  const ride = (seed) => {
    flat(-8, 8, -4, 8);
    for (let x = -4; x <= 4; x++) wall(x, 2);
    const mob = makeMob(-3.5, 1.0, 0, mulberry32(seed));
    return run(mob, { x: -3.5, z: 30 }, 400).map((p) => [p.x, p.z, p.yaw, p.blue ? 1 : 0]);
  };
  const a = ride(99), b = ride(99);
  assert.deepEqual(a, b, `determinism: same seed, same ride`);
}
console.log("PASS determinism");

console.log("wall.test.mjs: ALL PASS");
