// Snow fade math + field tuning (three-free spec shared with the engine).
// node direct.
import assert from "node:assert";
import {
  SNOW_COUNT, SNOW_RANGE, SNOW_SIZE,
  SNOW_OFF_Y, SNOW_OFF_R, SNOW_FLOOR_BELOW,
  snowAltitudeFade, snowHeightFade, snowRadialFade,
  snowFieldTarget, smoothShown, moonGroundY,
  spawnSnowDrop, stepSnowDrops,
} from "../../../src/fx/snowfade.js";
import { MOON_SURFACE_Y, MOON_R } from "../../../src/world/moon.js";

const S = MOON_SURFACE_Y;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- entry ramp: 0 below the gate, 1 at the surface (no pop-in).
assert.equal(snowAltitudeFade(S - 9), 0, "off below the gate");
assert.equal(snowAltitudeFade(S - 8), 0, "gate edge still off");
assert.equal(snowAltitudeFade(S), 1, "full at the surface");
assert.equal(snowAltitudeFade(S + 400), 1, "no camera fade above (per-flake takes over)");
assert.ok(
  approx(snowAltitudeFade(S - 4), 0.5),
  `mid entry ramp reads half (${snowAltitudeFade(S - 4)})`
);
let prev = -1;
for (let y = S - 8; y <= S; y += 1) {
  const f = snowAltitudeFade(y);
  assert.ok(f >= prev, `entry ramp monotone at ${y}`);
  prev = f;
}

// --- height fade: full below +50, gone at +100.
assert.equal(snowHeightFade(S), 1, "full at the surface");
assert.equal(snowHeightFade(S + 50), 1, "full at the dense-layer top");
assert.equal(snowHeightFade(S + 100), 0, "gone at +100");
assert.equal(snowHeightFade(S + 400), 0, "gone higher up");
assert.ok(
  approx(snowHeightFade(S + 75), 0.5),
  `mid height fade reads half (${snowHeightFade(S + 75)})`
);
prev = 2;
for (let y = S + 50; y <= S + 100; y += 1) {
  const f = snowHeightFade(y);
  assert.ok(f <= prev, `height fade monotone at ${y}`);
  prev = f;
}

// --- radial fade: full to rim + 25, gone at rim + 50.
assert.equal(snowRadialFade(0, 0), 1, "full at the center");
assert.equal(snowRadialFade(MOON_R, 0), 1, "full at the rim");
assert.equal(snowRadialFade(121, 0), 1, "full at the fade edge");
assert.equal(snowRadialFade(146, 0), 0, "gone at rim + 50");
assert.equal(snowRadialFade(400, 0), 0, "gone far out");
assert.ok(
  approx(snowRadialFade(133.5, 0), 0.5),
  `mid rim fade reads half (${snowRadialFade(133.5, 0)})`
);
// Radially symmetric (diagonal included).
assert.ok(
  approx(snowRadialFade(121 / Math.SQRT2, 121 / Math.SQRT2), 1),
  "full on the fade-edge diagonal"
);
assert.equal(snowRadialFade(300, 300), 0, "gone on the far diagonal");

// --- landing floor: rock tops hold, open shafts fall to S-50, never into rock.
assert.equal(moonGroundY(S), S, "surface rock holds");
assert.equal(moonGroundY(S + 200), S + 200, "high rock holds");
assert.equal(moonGroundY(S - 30), S - 30, "sub-surface rock holds");
assert.equal(moonGroundY(S - 50), S - 50, "floor boundary holds");
assert.equal(moonGroundY(0), S - 50, "void falls to the floor");
assert.equal(moonGroundY(-5), S - 50, "empty column falls to the floor");

// --- field target: the camera's own position in the fade volume.
assert.equal(snowFieldTarget(S, 0), 1, "target full at home");
assert.ok(snowFieldTarget(S + 50, 0) > 0.99, "target full at the dense-layer top");
assert.ok(snowFieldTarget(S + 75, 0) < 0.6, "target thins with height");
assert.equal(snowFieldTarget(S + 200, 0), 0, "target gone high up");
assert.equal(snowFieldTarget(S, 300), 0, "target gone far out");
assert.ok(
  snowFieldTarget(S, 0) >= snowFieldTarget(S + 75, 0) &&
  snowFieldTarget(S + 75, 0) >= snowFieldTarget(S + 100, 0),
  "target monotone in height"
);
assert.ok(
  snowFieldTarget(S, 125) >= snowFieldTarget(S, 200),
  "target monotone in radius"
);

// --- temporal smoothing: fast uniform fade-out, progressive fade-in.
assert.ok(
  approx(smoothShown(0, 1, 0.4), 0.5),
  `fade-in advances (${smoothShown(0, 1, 0.4)})`
);
assert.ok(
  approx(smoothShown(1, 0, 0.1), 0.6),
  `fade-out advances (${smoothShown(1, 0, 0.1)})`
);
{
  const out = 0.5 - smoothShown(0.5, 0, 0.1);
  const inn = smoothShown(0.5, 1, 0.1) - 0.5;
  assert.ok(out > inn * 2, `fade-out faster than fade-in (${out.toFixed(3)} vs ${inn.toFixed(3)})`);
}
assert.equal(smoothShown(0.9, 1, 10), 1, "no overshoot up");
assert.equal(smoothShown(0.1, 0, 10), 0, "no overshoot down");
assert.equal(smoothShown(0.3, 0.9, 0), 0.3, "frozen without dt");
assert.equal(smoothShown(0.3, 0.9, -1), 0.3, "frozen on negative dt");

// --- leaving fades everything out: past the off bounds every flake in
// the camera slab reads ~zero combined alpha (what the engine culls on).
{
  const combined = (x, y, z) => snowRadialFade(x, z) * snowHeightFade(y);
  // High above the layer: the whole slab sits past the fade top.
  let worst = 0;
  for (let dx = -100; dx <= 100; dx += 25) {
    for (let dy = -120; dy <= 130; dy += 25) {
      worst = Math.max(worst, combined(dx, SNOW_OFF_Y + dy, 0));
    }
  }
  assert.ok(worst < 0.01, `nothing visible past OFF_Y (${worst.toFixed(4)})`);
  // Far out radially at surface level: the whole slab sits past the rim.
  worst = 0;
  for (let dx = -100; dx <= 100; dx += 25) {
    for (let dy = -4; dy <= 20; dy += 6) {
      worst = Math.max(worst, combined(SNOW_OFF_R + dx, S + dy, 0));
    }
  }
  assert.ok(worst < 0.01, `nothing visible past OFF_R (${worst.toFixed(4)})`);
  // Sanity: the same sweep at home shows a live field.
  assert.ok(combined(0, S + 10, 0) > 0.99, "live field at home");
}

// --- field tuning the engine reads (uniform coverage, volumetric parity).
assert.equal(SNOW_COUNT, 20000, "full-disc drop count keeps volumetric parity");
assert.ok(SNOW_RANGE > MOON_R, `box covers the diameter (${SNOW_RANGE} > ${MOON_R})`);
assert.equal(SNOW_SIZE, 0.144, "flake size -20%");

console.log("PASS snow fade math + field tuning");

// --- simulation: slab uniformity under a fast ascent, wrap on a jump.
{
  // Flat-moon stub world: ground at the surface everywhere, drops land on
  // it, initial fill spans surface..top like the engine's seedY.
  const G = MOON_SURFACE_Y;
  const spec = {
    count: SNOW_COUNT, range: SNOW_RANGE, topMin: 100, topMax: 130, slabBelow: 120,
    sway: 0.5, drift: 0.5, fallMin: 2.5, fallMax: 5.5, step: 1 / 60,
    groundY: () => G,
    landed: (x, y, z, landY) => y <= landY + 2,
    seedY: (top) => G + Math.random() * Math.max(1, top - G),
  };
  const pos = new Float32Array(spec.count * 3);
  const vel = new Float32Array(spec.count * 3);
  const ground = new Float32Array(spec.count);
  const DT = 1 / 60;
  let tick = 0;
  let ex = 0, ey = S + 4, ez = 0, time = 0;
  for (let i = 0; i < spec.count; i++) {
    spawnSnowDrop(spec, pos, vel, ground, i, ex, ey, ez, true);
  }
  const slabFrac = (lo, hi) => {
    let n = 0;
    for (let i = 0; i < spec.count; i++) {
      const y = pos[i * 3 + 1];
      if (y >= ey + lo && y <= ey + hi) n++;
    }
    return n / spec.count;
  };
  // Settle past the slowest full transit (132 m at 2.5 blocks/s), then
  // climb 200 blocks at 10 blocks/s: the slab-bottom recycle must keep the
  // field uniform instead of draining it below the camera (the old
  // land-only recycle took tens of seconds per drop to return).
  for (let s = 0; s < 3600; s++) {
    stepSnowDrops(spec, pos, vel, ground, spec.count, ++tick, ex, ey, ez, time, DT);
    time += DT;
  }
  assert.ok(slabFrac(-120, 130) > 0.95, `slab full at rest (${slabFrac(-120, 130).toFixed(3)})`);
  // Birth column reaches the fade-out: most drops live above the old +22
  // ceiling (looking up from the surface used to show an empty sky).
  assert.ok(slabFrac(22, 130) > 0.6, `upper column populated (${slabFrac(22, 130).toFixed(3)})`);
  // Uniform fall: equal-height bands hold equal shares (steady state past
  // one full transit — every drop was born in the top band).
  const bandA = slabFrac(-4, 40); // y in [946, 990]
  const bandB = slabFrac(40, 84); // y in [990, 1034]
  assert.ok(bandA > 0.22 && bandA < 0.44, `low band share (${bandA.toFixed(3)})`);
  assert.ok(bandB > 0.22 && bandB < 0.44, `mid band share (${bandB.toFixed(3)})`);
  let worst = 1;
  for (let s = 0; s < 1200; s++) {
    ey += 10 * DT; // 10 blocks/s rocket-ish climb, 950 -> 1150
    stepSnowDrops(spec, pos, vel, ground, spec.count, ++tick, ex, ey, ez, time, DT);
    time += DT;
    if (s % 60 === 0) worst = Math.min(worst, slabFrac(-120, 130));
  }
  assert.ok(worst > 0.9, `slab stays uniform while ascending (worst ${worst.toFixed(3)})`);
  // Coverage: flakes spread over the whole XZ box, not clumped.
  let quads = [0, 0, 0, 0];
  for (let i = 0; i < spec.count; i++) {
    const q = (pos[i * 3] > ex ? 1 : 0) + (pos[i * 3 + 2] > ez ? 2 : 0);
    quads[q]++;
  }
  for (let q = 0; q < 4; q++) {
    const f = quads[q] / spec.count;
    assert.ok(f > 0.15 && f < 0.35, `quadrant ${q} balanced (${f.toFixed(3)})`);
  }
  // Horizontal jump: every drop wraps back inside the box at once.
  ex += 300;
  for (let s = 0; s < 3; s++) {
    stepSnowDrops(spec, pos, vel, ground, spec.count, ++tick, ex, ey, ez, time, DT);
    time += DT;
  }
  let maxDx = 0, maxDz = 0;
  for (let i = 0; i < spec.count; i++) {
    maxDx = Math.max(maxDx, Math.abs(pos[i * 3] - ex));
    maxDz = Math.max(maxDz, Math.abs(pos[i * 3 + 2] - ez));
  }
  assert.ok(maxDx <= spec.range + 1, `wrap holds in x (${maxDx.toFixed(2)})`);
  assert.ok(maxDz <= spec.range + 1, `wrap holds in z (${maxDz.toFixed(2)})`);
  console.log("PASS snow slab uniformity + wrap");

  // --- bench: cost of one 60 Hz step over the full field (printed only).
  const t0 = performance.now();
  const N = 120;
  for (let s = 0; s < N; s++) {
    stepSnowDrops(spec, pos, vel, ground, spec.count, ++tick, ex, ey, ez, time, DT);
  }
  const ms = (performance.now() - t0) / N;
  console.log(`bench snow step x${spec.count}: ${ms.toFixed(3)} ms/step`);
}

// --- floor in the sim: rock holds at the surface, void fills down to S-50.
{
  // Half rock (x <= 0, ground at the surface), half void (x > 0, open shaft
  // down through the floor): the storm's ground callback is the real one.
  const spec = {
    count: SNOW_COUNT, range: SNOW_RANGE, topMin: 100, topMax: 130, slabBelow: 120,
    sway: 0.5, drift: 0.5, fallMin: 2.5, fallMax: 5.5, step: 1 / 60,
    groundY: (bx) => (bx > 0 ? moonGroundY(-5) : MOON_SURFACE_Y),
    landed: (x, y, z, landY) => y <= landY + 2,
    seedY: (top) => (MOON_SURFACE_Y - SNOW_FLOOR_BELOW) + Math.random() * Math.max(1, top - (MOON_SURFACE_Y - SNOW_FLOOR_BELOW)),
  };
  const pos = new Float32Array(spec.count * 3);
  const vel = new Float32Array(spec.count * 3);
  const ground = new Float32Array(spec.count);
  const DT = 1 / 60;
  let tick = 0, time = 0;
  const ex = 0, ey = S + 4, ez = 0;
  for (let i = 0; i < spec.count; i++) {
    spawnSnowDrop(spec, pos, vel, ground, i, ex, ey, ez, true);
  }
  for (let s = 0; s < 3600; s++) {
    stepSnowDrops(spec, pos, vel, ground, spec.count, ++tick, ex, ey, ez, time, DT);
    time += DT;
  }
  let minAll = Infinity, voidBelow = 0, voidN = 0, rockMin = Infinity;
  for (let i = 0; i < spec.count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    if (y < minAll) minAll = y;
    if (x > ex) {
      voidN++;
      if (y < S) voidBelow++;
    } else if (y < rockMin) {
      rockMin = y;
    }
  }
  assert.ok(minAll >= S - SNOW_FLOOR_BELOW - 2, `nothing below the floor (${minAll.toFixed(1)})`);
  assert.ok(voidN > 0 && voidBelow / voidN > 0.1, `void side populates below the surface (${(voidBelow / Math.max(1, voidN)).toFixed(2)})`);
  assert.ok(rockMin > S, `rock side never sinks (${rockMin.toFixed(1)})`);
  console.log("PASS snow floor: open shafts fill to S-50, rock holds the surface");
}
