// Planets on the shell band: elevation/sep rules, per-body ultra zones,
// free-sky bounds, and per-body gone flags.
import assert from "node:assert/strict";
import { AIR, DIRT, MOON, WATER, MOON_WATER } from "../../../src/core/blocks.js";
import {
  setDimension, resetWorld, setBlock, getBlock, outOfWorld, skyFreeY,
  key, keyXYZ,
} from "../../../src/core/store.js";
import {
  MOON_R, MOON_SURFACE_Y, MOON_CENTER_Y, PLANET_MIN_Y,
  BAND_R0, BAND_R1, BAND_MIN_EL_DEG, BAND_MIN_SEP_RATIO, BAND_COUNT,
  SKY_FREE_Y,
  planetCenters, planetColorIdx, bodySpecs, bodyByKey, planetBodyAt,
  moonSpec, ultraBandOf,
  PLANET_SAFETY_R, nextBodyToStream,
  setPlanetSeed, isBodyGone, anyBodyAlive, markBodiesDirty, resetPlanets, markBodyBuilt,
  voronoiBodyAt, isCelestialBand, noteBodyWiped, bodyWiped, noteBodyInteract, bodyTouched,
  celestialWaterFor,
  rayBodyHit, bodyRepickBudget, bodySurfaceCell,
  CELESTIAL_FADE_Y, CELESTIAL_FADE_END, celestialRevealFactor,
  ANCHOR_Y, SKY_LEAD, SKY_START, SKY_END, SKY_FADE_WIDTH, BLACK_BUFFER, FOG_FAR,
} from "../../../src/world/planets.js";
import { CLOUD_MAX_Y } from "../../../src/world/clouds.js";
import { ULTRA_MARGIN, bodyBall, footprintCols, volumeContains } from "../../../src/world/ultravol.js";
import { generateBody, generateBodySurface, generateBodySurfaceRows, generateBodyUnderRows, joinBodyLakeWaterStart, joinBodyLakeWaterSlice, bodyChunkCenters, bodyChunkKeys } from "../../../src/world/moon.js";

setDimension("over");

const SEEDS = [1, 2, 7, 42, 31337];

// 1. Shell band: BAND_COUNT centers at radius [BAND_R0, BAND_R1] from the
// Moon center with elevation >= BAND_MIN_EL_DEG, pairwise separated,
// deterministic per seed.
{
  const sep = BAND_MIN_SEP_RATIO * 2 * MOON_R;
  for (const seed of SEEDS) {
    const pts = planetCenters(seed);
    assert.equal(pts.length, BAND_COUNT, `seed ${seed} shell holds ${BAND_COUNT} planets`);
    assert.deepEqual(planetCenters(seed), pts, `seed ${seed} layout cached`);
    for (const p of pts) {
      const dx = p.x, dy = p.y - MOON_CENTER_Y, dz = p.z;
      const dist = Math.hypot(dx, dy, dz);
      assert.ok(dist >= BAND_R0 - 1 && dist <= BAND_R1 + 1, `seed ${seed} center in shell (d=${dist.toFixed(1)})`);
      const el = Math.asin(dy / dist) * 180 / Math.PI;
      assert.ok(el >= BAND_MIN_EL_DEG - 0.1, `seed ${seed} center above minEl (el=${el.toFixed(1)})`);
    }
    for (let i = 0; i < pts.length; i++) {
      const c = planetColorIdx(seed, i);
      assert.ok(c >= 0 && c < 7, `seed ${seed} planet ${i} color in palette`);
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
        assert.ok(d >= sep - 2, `seed ${seed} planets ${i}/${j} separated (d=${d.toFixed(0)})`);
      }
    }
    const specs = bodySpecs(seed);
    assert.equal(specs.length, BAND_COUNT + 1, `seed ${seed} moon + planets`);
    assert.equal(specs[0].key, "moon", `seed ${seed} moon first`);
    for (const b of specs.slice(1)) {
      assert.equal(b.top - b.bottom, MOON_R, `${b.key} dome height`);
      assert.ok(b.bottom >= PLANET_MIN_Y, `${b.key} bottom above the floor (${b.bottom})`);
      assert.equal(b.r, MOON_R, `${b.key} moon-sized`);
    }
  }
  assert.equal(
    PLANET_MIN_Y,
    Math.max(
      MOON_SURFACE_Y,
      Math.floor(MOON_CENTER_Y + BAND_R0 * Math.sin(BAND_MIN_EL_DEG * Math.PI / 180) - MOON_R / 2)),
    `floor matches the band (${PLANET_MIN_Y})`);
  assert.ok(JSON.stringify(planetCenters(1)) !== JSON.stringify(planetCenters(2)), "seeds differ");
  console.log("PASS planets-cone-layout");
}

// 2. Ultra zones: ground/cloud bands plus one ball per body; sky gaps
// resolve to no volume (tnt.js maps the band through a proximity gate).
{
  const seed = 7;
  setPlanetSeed(seed);
  assert.equal(ultraBandOf(0, 10, 0), 1, "ground band");
  assert.equal(ultraBandOf(0, 100, 0), 2, "cloud band");
  assert.equal(ultraBandOf(0, MOON_SURFACE_Y, 0), "moon", "moon band");
  // The Moon wipes its ball: disc radius + dome half-height, padded.
  const moon = moonSpec();
  const mb = bodyBall(moon);
  assert.equal(mb.shape, "ball", "moon wipes a ball");
  assert.deepEqual([mb.cx, mb.cz], [0, 0], "moon ball centered");
  assert.equal(mb.cy, (moon.top + moon.bottom) / 2, "moon ball mid-shell");
  assert.equal(mb.r, Math.ceil(Math.hypot(moon.r, (moon.top - moon.bottom) / 2)) + ULTRA_MARGIN, "moon ball covers disc+dome+margin");
  const p0 = bodyByKey("p0");
  assert.ok(p0, "p0 spec exists");
  assert.equal(ultraBandOf(p0.cx, p0.top, p0.cz), "body:p0", "ignition on p0 reads p0");
  // Planets wipe their own ball, sized by their own shell — never by the
  // neighbor gap (the gap is empty sky).
  const pb = bodyBall(p0);
  assert.equal(pb.r, mb.r, "same-size bodies share the wipe radius");
  // Gap midpoint between a well-separated pair belongs to no body: with
  // stacked shells the nearest pair may overlap in XZ, so the first pair
  // with daylight between the discs is used.
  const bodies = bodySpecs(seed);
  let gi = null, gj = null;
  outer: for (let i = 1; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
      if (d <= a.r + b.r + 100) continue;
      if (planetBodyAt((a.cx + b.cx) / 2, a.top, (a.cz + b.cz) / 2) !== null) continue;
      gi = a; gj = b;
      break outer;
    }
  }
  assert.ok(gi, "a daylight pair exists");
  const mx = (gi.cx + gj.cx) / 2, mz = (gi.cz + gj.cz) / 2;
  assert.equal(planetBodyAt(mx, gi.top, mz), null, "gap reads no body");
  const gb = bodyBall(gi);
  assert.ok(!volumeContains(gb, mx, gi.top, mz), "gap midpoint outside the wipe ball");
  assert.equal(isCelestialBand(1), false, "ground not celestial");
  assert.equal(isCelestialBand(2), false, "clouds not celestial");
  assert.equal(isCelestialBand("moon"), true, "moon celestial");
  assert.equal(isCelestialBand("body:p0"), true, "planet celestial");
  // Ball footprint: disc of the ball radius, ignition-sorted.
  const cols = footprintCols(pb, p0.cx, p0.cz, null);
  assert.ok(cols.length > Math.PI * pb.r * pb.r * 0.9, `ball disc covered (${cols.length})`);
  assert.ok(cols.length < Math.PI * (pb.r + 1) * (pb.r + 1) + 4 * pb.r, `ball disc restricted (${cols.length})`);
  console.log(`PASS planets-cone-ultra r=${pb.r} mid=${PLANET_MIN_Y}`);
}

// 3. Free space bounds: symmetric ±100000 on X, Y, and Z.
{
  assert.equal(skyFreeY(), SKY_FREE_Y, "sky gate registered");
  const pt = bodySpecs(7)[1].top; // a real planet height, band-proof
  assert.equal(outOfWorld(0, 100, 0), false, "ground column inside");
  assert.equal(outOfWorld(200, 100, 0), false, "XZ walls lifted everywhere");
  assert.equal(outOfWorld(1200, pt, 0), false, "free sky at planet heights");
  assert.equal(outOfWorld(100000, pt, 0), false, "free sky at the 100k range");
  assert.equal(outOfWorld(0, MOON_SURFACE_Y, 0), false, "free sky over the moon");
  assert.equal(outOfWorld(200000, pt, 0), true, "key range still bounds the sky");
  // Packing round-trips across the symmetric ±100000 3D range.
  for (const [x, y, z] of [[100000, pt, -100000], [-100000, -100000, -100000], [100000, 100000, 100000]]) {
    assert.deepEqual(keyXYZ(key(x, y, z)), [x, y, z], `key round-trip ${x},${y},${z}`);
  }
  console.log("PASS planets-cone-bounds");
}

// 4. One planet builds like the moon; gone flags are per body.
{
  const seed = 7;
  setPlanetSeed(seed);
  resetWorld("over");
  resetPlanets();
  markBodiesDirty();
  assert.equal(isBodyGone("p0"), true, "unbuilt p0 reads gone");
  assert.equal(anyBodyAlive(), false, "empty sky reads dead");
  const p0 = bodyByKey("p0");
  generateBody(p0, seed, setBlock, getBlock);
  markBodyBuilt(seed, "p0");
  markBodiesDirty();
  assert.equal(getBlock(p0.cx, p0.top, p0.cz) !== AIR, true, "p0 cap solid");
  let water = 0;
  for (let x = p0.cx - MOON_R; x <= p0.cx + MOON_R; x++) {
    for (let z = p0.cz - MOON_R; z <= p0.cz + MOON_R; z++) {
      for (let y = p0.bottom; y <= p0.top; y++) {
        if (getBlock(x, y, z) === p0.water) water++;
      }
    }
  }
  assert.ok(water > 0, "p0 holds lake water");
  assert.equal(isBodyGone("p0"), false, "built p0 survives");
  assert.equal(isBodyGone("p1"), true, "unbuilt p1 still gone");
  assert.equal(anyBodyAlive(), true, "one living body keeps the sky alive");
  assert.equal(isBodyGone("moon"), true, "moon untouched");
  // Wiping a built body reads gone.
  for (let x = p0.cx - MOON_R; x <= p0.cx + MOON_R; x++) {
    for (let z = p0.cz - MOON_R; z <= p0.cz + MOON_R; z++) {
      const dx = x - p0.cx, dz = z - p0.cz;
      if (dx * dx + dz * dz > MOON_R * MOON_R) continue;
      for (let y = p0.bottom; y <= p0.top; y++) {
        if (getBlock(x, y, z) !== AIR) setBlock(x, y, z, AIR);
      }
    }
  }
  markBodiesDirty();
  assert.equal(isBodyGone("p0"), true, "wiped p0 reads gone");
  // Moon surface keeps legacy voxels through the generic builder.
  generateBodySurface(bodyByKey("moon"), seed, setBlock);
  markBodiesDirty();
  assert.equal(getBlock(0, MOON_SURFACE_Y, 0), MOON, "moon cap solid");
  assert.equal(isBodyGone("moon"), false, "surfaced moon survives");
  console.log(`PASS planets-cone-build p0water=${water}`);
}

// 5. Geometric ray pick: nearest body cylinder along the normalized ray.
{
  const seed = 7;
  setPlanetSeed(seed);
  const p0 = bodyByKey("p0");
  const norm = (x, y, z) => {
    const l = Math.hypot(x, y, z);
    return { x: x / l, y: y / l, z: z / l };
  };
  // From the Moon surface toward p0's center: p0 wins, entry near the disc.
  const d0 = norm(p0.cx - 0, p0.top - MOON_SURFACE_Y, p0.cz - 0);
  const h0 = rayBodyHit({ x: 0, y: MOON_SURFACE_Y, z: 0 }, d0);
  assert.ok(h0 && h0.spec.key === "p0", "moon-to-p0 ray hits p0");
  const straight = Math.hypot(p0.cx, p0.top - MOON_SURFACE_Y, p0.cz);
  assert.ok(h0.t > straight - 300 && h0.t <= straight, `p0 entry near the disc (t=${h0.t})`);
  // Straight up from the ground: the Moon sits overhead.
  const hu = rayBodyHit({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 });
  assert.ok(hu && hu.spec.key === "moon", "ground up-ray hits the moon");
  // Horizontal ray under every slab: nothing up there.
  assert.equal(rayBodyHit({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }), null, "low horizontal ray hits nothing");
  // Down onto the Moon from high above: the Moon wins.
  const hm = rayBodyHit({ x: 0, y: 2000, z: 0 }, { x: 0, y: -1, z: 0 });
  assert.ok(hm && hm.spec.key === "moon", "high down-ray hits the moon");
  assert.ok(Math.abs(hm.t - (2000 - (MOON_SURFACE_Y + 1))) < 2, `moon entry at the cap (t=${hm.t})`);
  // maxDist cuts farther bodies.
  assert.equal(rayBodyHit({ x: 0, y: MOON_SURFACE_Y, z: 0 }, d0, 100), null, "maxDist cuts p0");
  // Face-adjacent placement cell (dominant axis), mirroring DDA faces.
  assert.deepEqual(bodySurfaceCell({ x: 1, y: 2, z: 3, face: [0, 1, 0] }), [1, 3, 3], "top face goes up");
  assert.deepEqual(bodySurfaceCell({ x: 1, y: 2, z: 3, face: [0, -1, 0] }), [1, 1, 3], "bottom face goes down");
  assert.deepEqual(bodySurfaceCell({ x: 1, y: 2, z: 3, face: [0.7, 0, 0.7] }), [2, 2, 3], "diagonal side snaps to +x");
  assert.deepEqual(bodySurfaceCell({ x: 1, y: 2, z: 3, face: [0.2, 0, -0.9] }), [1, 2, 2], "side snaps to -z");
  // Re-pick budget covers the diagonal DDA cost (t·(|dx|+|dy|+|dz|), exact
  // bound t√3 ≈ 1.732t) plus the in-body traversal, at cone range and at
  // the 100k range.
  for (const t of [Math.round(straight), 100000]) {
    assert.ok(bodyRepickBudget(t) >= Math.ceil((t + 400) * 1.74), `budget covers t=${t}`);
  }
  console.log("PASS planets-cone-raypick");
}

// 6. Space Voronoi: every cell belongs to the nearest body by 3D distance
// to the body center — Moon included, no floor, no radius gate.
{
  const seed = 7;
  setPlanetSeed(seed);
  const moon = bodyByKey("moon");
  const p0 = bodyByKey("p0");
  const p1 = bodyByKey("p1");
  assert.equal(voronoiBodyAt(0, MOON_SURFACE_Y, 0)?.key, "moon", "moon surface reads the moon");
  assert.equal(voronoiBodyAt(p0.cx, p0.top - 10, p0.cz)?.key, "p0", "inside p0 reads p0");
  assert.equal(voronoiBodyAt(p0.cx, p0.top + 1, p0.cz)?.key, "p0", "standing on p0 reads p0");
  // 3D, not XZ: the midpoint between the Moon center and p0's center reads
  // whichever center is nearer in 3D.
  const mid = { x: (moon.cx + p0.cx) / 2, y: ((moon.top + moon.bottom) / 2 + (p0.top + p0.bottom) / 2) / 2, z: (moon.cz + p0.cz) / 2 };
  let expect = null, hd = Infinity;
  for (const b of bodySpecs(seed)) {
    const c = { x: b.cx, y: (b.top + b.bottom) / 2, z: b.cz };
    const d = Math.hypot(mid.x - c.x, mid.y - c.y, mid.z - c.z);
    if (d < hd) { hd = d; expect = b.key; }
  }
  assert.equal(voronoiBodyAt(mid.x, mid.y, mid.z)?.key, expect, "midpoint reads nearest 3D center");
  // Gap edge between two planets: the nearest 3D center wins.
  const mx = p0.cx + (p1.cx - p0.cx) * 0.49, mz = p0.cz + (p1.cz - p0.cz) * 0.49;
  const my = (p0.top + p0.bottom) / 2;
  let expectGap = null, gd = Infinity;
  for (const b of bodySpecs(seed)) {
    const c = { x: b.cx, y: (b.top + b.bottom) / 2, z: b.cz };
    const d = Math.hypot(mx - c.x, my - c.y, mz - c.z);
    if (d < gd) { gd = d; expectGap = b.key; }
  }
  assert.equal(voronoiBodyAt(mx, my, mz)?.key, expectGap, "gap edge reads nearest 3D center");
  // A planet's own water id rides its spec.
  assert.ok(p0.water !== moon.water, "planet water differs from moon water");
  console.log("PASS planets-cone-hotbar");
}

// 7. Pin keys: chunk keys covering the disc, stable and seed-free.
{
  const spec = bodySpecs(31337)[1];
  const keys = bodyChunkKeys(spec);
  const centers = bodyChunkCenters(spec);
  assert.ok(keys.size > 50 && keys.size <= centers.length, `covers the disc (${keys.size})`);
  for (const k of keys) assert.match(k, /^-?\d+_-?\d+$/, `key shape (${k})`);
  assert.deepEqual([...bodyChunkKeys(spec)], [...keys], "deterministic per spec");
  console.log("PASS planets-cone-pinkeys");
}

// 8. Shared celestial reveal chain (Moon and planets together, after the
// sky's black completes plus a pure-black buffer — never a body on blue).
{
  assert.equal(ANCHOR_Y, CLOUD_MAX_Y + FOG_FAR, "anchor: cloud top plus the fog far");
  assert.equal(SKY_START, ANCHOR_Y - SKY_LEAD, "sky fade starts while the last deck is barely fog-dissolving");
  assert.equal(SKY_LEAD, 20, "20-block lead over the cloud-vanish anchor");
  assert.equal(SKY_END, SKY_START + 20, "20-block sky fade");
  assert.equal(CELESTIAL_FADE_Y, SKY_END + BLACK_BUFFER,
    "reveal starts after the sky fade plus the pure-black buffer");
  assert.equal(BLACK_BUFFER, 5, "5-block pure-black buffer");
  assert.equal(CELESTIAL_FADE_END, CELESTIAL_FADE_Y + 20, "20-block band");
  assert.equal(celestialRevealFactor(CELESTIAL_FADE_Y - 1), 0, "below band: hidden");
  assert.equal(celestialRevealFactor(CELESTIAL_FADE_Y), 0, "band start: hidden");
  const mid = celestialRevealFactor(CELESTIAL_FADE_Y + 10);
  assert.ok(mid > 0.4 && mid < 0.6, `band middle: partial (${mid})`);
  assert.equal(celestialRevealFactor(CELESTIAL_FADE_END), 1, "band end: full visibility");
  console.log("PASS planets-cone-reveal");
}

// 9. Stream selector: range-free background completion, nearest first,
// safety-net sync up close, ready bodies skipped.
{
  const seed = 7;
  setPlanetSeed(seed);
  resetPlanets();
  const specs = bodySpecs(seed);
  // Moon already built (the eager worldgen surface): from the Moon surface
  // the nearest unbuilt planet streams in background mode — no range gate.
  const ready = new Set(["moon"]);
  const dist = (s) => Math.hypot(s.cx - 0, s.top - MOON_SURFACE_Y, s.cz - 0);
  let expect = null, expectD = Infinity;
  for (const s of specs.slice(1)) {
    const d = dist(s);
    if (d < expectD) { expect = s; expectD = d; }
  }
  const pick = nextBodyToStream(specs, 0, MOON_SURFACE_Y, 0, (k) => ready.has(k));
  assert.ok(pick, "an unbuilt planet is picked from the moon");
  assert.equal(pick.spec.key, expect.key, `nearest planet streams (${expect.key}, d=${Math.round(expectD)})`);
  assert.equal(pick.sync, false, "far bodies stream in background mode");
  assert.ok(expectD > PLANET_SAFETY_R, "the moon is past the safety net (the old range bug)");
  // Standing on a planet cap reads sync: the shell must exist before touch.
  const p0 = bodyByKey("p0");
  const near = nextBodyToStream(specs, p0.cx, p0.top + 1, p0.cz, (k) => ready.has(k));
  assert.equal(near.spec.key, "p0", "close body wins");
  assert.equal(near.sync, true, "close body completes synchronously");
  // Everything built: nothing to stream.
  for (const s of specs) ready.add(s.key);
  assert.equal(nextBodyToStream(specs, 0, MOON_SURFACE_Y, 0, (k) => ready.has(k)), null, "built sky streams nothing");
  // Only the moon unbuilt (interrupted fill): the moon streams too.
  ready.delete("moon");
  const moonPick = nextBodyToStream(specs, 0, MOON_SURFACE_Y, 0, (k) => ready.has(k));
  assert.equal(moonPick.spec.key, "moon", "unbuilt moon streams");
  console.log("PASS planets-cone-stream");
}

// 10. Sliced lake join reaches the sync fixpoint: same voxels either way.
{
  const seed = 99;
  setPlanetSeed(seed);
  resetWorld("over");
  resetPlanets();
  markBodiesDirty();
  const spec = bodySpecs(seed)[1];
  const snap = () => {
    const out = [];
    for (let x = spec.cx - spec.r; x <= spec.cx + spec.r; x++) {
      for (let z = spec.cz - spec.r; z <= spec.cz + spec.r; z++) {
        const dx = x - spec.cx, dz = z - spec.cz;
        if (dx * dx + dz * dz > spec.r * spec.r) continue;
        for (let y = spec.bottom; y <= spec.top; y++) {
          const id = getBlock(x, y, z);
          if (id !== AIR) out.push([x, y, z, id]);
        }
      }
    }
    return out;
  };
  generateBody(spec, seed, setBlock, getBlock); // sync reference (surface + shell + join)
  const ref = snap();
  assert.ok(ref.length > 1000, `reference body has voxels (${ref.length})`);
  resetWorld("over");
  generateBodyUnderRows(spec, seed, setBlock, spec.cx - spec.r, spec.cx + spec.r + 1, getBlock);
  generateBodySurfaceRows(spec, seed, setBlock, spec.cx - spec.r, spec.cx + spec.r + 1);
  const st = joinBodyLakeWaterStart();
  let slices = 0, guard = 4096;
  while (!joinBodyLakeWaterSlice(spec, seed, setBlock, getBlock, st) && guard-- > 0) slices++;
  assert.ok(guard > 0, "sliced join terminates");
  assert.deepEqual(snap(), ref, "sliced join matches the sync fixpoint");
  console.log(`PASS planets-cone-slicejoin slices=${slices + 1}`);
}

// 11. Hotbar celestial rule: below the reveal plain water owns the slot;
// inside the reveal the flower slot reads glowstone and the water slot
// defaults to Moon water, a real aimed voxel taking the water of its
// Voronoi cell (any block kind — the cell is positional) and a geometric
// far/proxy body pick taking that body's own water. The reveal alone
// drives both slots: wiped bodies change nothing.
{
  const seed = 7;
  setPlanetSeed(seed);
  const moon = bodyByKey("moon");
  const p0 = bodyByKey("p0");
  const skyFor = (camY) => celestialRevealFactor(camY) > 0;
  const waterFor = (camY, hit) => celestialWaterFor(hit, skyFor(camY));
  assert.equal(skyFor(CELESTIAL_FADE_Y - 1), false, "below the reveal: flower slot stays flower");
  assert.equal(skyFor(CELESTIAL_FADE_END), true, "inside the reveal: flower slot reads glowstone");
  assert.equal(waterFor(CELESTIAL_FADE_Y - 1, null), WATER, "below the reveal reads plain water");
  assert.equal(waterFor(20, { x: p0.cx, y: p0.top, z: p0.cz, id: p0.rock }), WATER, "planet voxel below the reveal stays plain water");
  assert.equal(waterFor(CELESTIAL_FADE_END, null), MOON_WATER, "reveal with no aim reads moon water");
  assert.equal(waterFor(CELESTIAL_FADE_END, { x: 0, y: 0, z: 0, id: AIR }), MOON_WATER, "bare geometric pick keeps moon water");
  const pc = { x: p0.cx, y: Math.floor((p0.top + p0.bottom) / 2), z: p0.cz };
  assert.equal(waterFor(CELESTIAL_FADE_END, { ...pc, id: p0.rock }) , p0.water, "aimed planet rock reads planet water");
  assert.equal(waterFor(CELESTIAL_FADE_END, { ...pc, id: DIRT }), p0.water, "placed block in the cell reads planet water");
  assert.equal(
    waterFor(CELESTIAL_FADE_END, { ...pc, id: AIR, body: p0 }),
    p0.water, "geometric far-body pick reads planet water");
  assert.equal(
    waterFor(CELESTIAL_FADE_END, { x: moon.cx, y: Math.floor((moon.top + moon.bottom) / 2), z: moon.cz, id: moon.rock }),
    MOON_WATER, "aimed moon rock reads moon water");
  assert.equal(
    waterFor(CELESTIAL_FADE_END, { x: moon.cx, y: Math.floor((moon.top + moon.bottom) / 2), z: moon.cz, id: AIR, body: moon }),
    MOON_WATER, "geometric moon pick reads moon water");
  // Wiped sky: no body holds voxels, yet the reveal still owns both slots.
  resetWorld("over");
  resetPlanets();
  assert.equal(anyBodyAlive(), false, "empty sky reads dead");
  assert.equal(skyFor(CELESTIAL_FADE_END), true, "wiped sky: flower slot still reads glowstone");
  assert.equal(waterFor(CELESTIAL_FADE_END, null), MOON_WATER, "wiped sky: water slot still reads moon water");
  console.log("PASS planets-cone-aimhotbar");
}


// 12. Wiped bodies: an ultra wipe flags the body so the LOD drops meshes +
// proxy at once; re-touching (rebuild) clears the flag, resets clear all.
{
  const seed = 7, key = "p1";
  assert.equal(bodyWiped(seed, key), false, "fresh body not wiped");
  noteBodyWiped(seed, key);
  assert.equal(bodyWiped(seed, key), true, "wipe flags the body");
  assert.equal(bodyWiped(seed, "p2"), false, "flag is per body");
  noteBodyInteract(seed, key); // rebuild touch: alive again
  assert.equal(bodyWiped(seed, key), false, "re-touch clears the flag");
  assert.equal(bodyTouched(seed, key), true, "touch still registered");
  noteBodyWiped(seed, key);
  resetPlanets();
  assert.equal(bodyWiped(seed, key), false, "reset clears wiped flags");
  console.log("PASS planets-cone-wiped");
}
