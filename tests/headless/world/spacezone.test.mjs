// Deep-space speed zone + the shared celestial body geometry it reads:
// padded-cylinder ownership, surface distance, nearest-body pick, and the
// buffer→ramp→multiplier curve (three-free, node direct).
import assert from "node:assert/strict";
import { setDimension } from "../../../src/core/store.js";
import {
  MOON_R, MOON_SURFACE_Y,
  bodySpecs, bodyByKey, setPlanetSeed,
  bodyPadContains, bodySurfaceDist, bodyAtCell, nearestBody,
  planetBodyAt, planetBodyAtPlaced,
} from "../../../src/world/planets.js";
import { spaceSpeedMul, spaceMul, spaceFactorFromDist, takeoffDist, landingDistBox, SPACE_MUL, SPACE_BUFFER, SPACE_RAMP } from "../../../src/world/spacezone.js";

setDimension("over");
const SEED = 7;
setPlanetSeed(SEED);

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// 1. bodyPadContains: exact volume, padded box, and boundaries on the Moon.
{
  const moon = bodyByKey("moon");
  assert.equal(bodyPadContains(moon, 0, MOON_SURFACE_Y, 0, 0), true, "cap cell inside");
  assert.equal(bodyPadContains(moon, 0, MOON_SURFACE_Y + 1, 0, 0), false, "one above the cap outside");
  assert.equal(bodyPadContains(moon, 0, MOON_SURFACE_Y + 1, 0, 2), true, "pad 2 keeps face-adjacent cells");
  assert.equal(bodyPadContains(moon, MOON_R, MOON_SURFACE_Y, 0, 0), true, "rim inside");
  assert.equal(bodyPadContains(moon, MOON_R + 1, MOON_SURFACE_Y, 0, 0), false, "one past the rim outside");
  assert.equal(bodyPadContains(moon, MOON_R + 2, MOON_SURFACE_Y, 0, 2), true, "pad 2 keeps the rim ring");
  assert.equal(bodyPadContains(moon, 0, moon.bottom - 1, 0, 0), false, "one below the floor outside");
  assert.equal(bodyPadContains(moon, MOON_R + 3, MOON_SURFACE_Y, 0, 2), false, "pad 2 never reaches +3");
  console.log("PASS spacezone-pad");
}

// 2. bodySurfaceDist: zero on the volume, exact gaps outside.
{
  const moon = bodyByKey("moon");
  assert.equal(bodySurfaceDist(moon, 0, MOON_SURFACE_Y, 0), 0, "cap cell distance 0");
  assert.equal(bodySurfaceDist(moon, 5, MOON_SURFACE_Y - 3, -7), 0, "interior distance 0");
  assert.equal(bodySurfaceDist(moon, 0, MOON_SURFACE_Y + 100, 0), 100, "vertical gap exact");
  assert.equal(bodySurfaceDist(moon, MOON_R + 30, MOON_SURFACE_Y, 0), 30, "radial gap exact");
  assert.ok(near(bodySurfaceDist(moon, MOON_R + 30, MOON_SURFACE_Y + 40, 0), 50), "diagonal gap combines");
  console.log("PASS spacezone-dist");
}

// 3. bodyAtCell matches the refactored lookups on a point sweep.
{
  const pts = [
    [0, 10, 0], [0, MOON_SURFACE_Y, 0], [0, MOON_SURFACE_Y + 1, 0],
    [MOON_R, MOON_SURFACE_Y, 0], [MOON_R + 1, MOON_SURFACE_Y, 0],
    [MOON_R + 2, MOON_SURFACE_Y, 0], [500, 1200, 300], [0, MOON_SURFACE_Y + 500, 0],
  ];
  for (const [x, y, z] of pts) {
    assert.equal(bodyAtCell(x, y, z, 0)?.key ?? null, planetBodyAt(x, y, z)?.key ?? null, `pad 0 matches at ${x},${y},${z}`);
    assert.equal(bodyAtCell(x, y, z, 2)?.key ?? null, planetBodyAtPlaced(x, y, z)?.key ?? null, `pad 2 matches at ${x},${y},${z}`);
  }
  console.log("PASS spacezone-owner");
}

// 4. nearestBody: ownership by surface distance.
{
  const np0 = nearestBody(0, MOON_SURFACE_Y, 0);
  assert.equal(np0.spec.key, "moon", "cap owned by the moon");
  assert.equal(np0.dist, 0, "cap distance 0");
  // Brute-force cross-check against a min over the specs.
  for (const [x, y, z] of [[0, 1200, 0], [1000, 1500, 500], [-700, 2000, 900]]) {
    let d = Infinity, k = null;
    for (const b of bodySpecs(SEED)) {
      const bd = bodySurfaceDist(b, x, y, z);
      if (bd < d) { d = bd; k = b.key; }
    }
    const n = nearestBody(x, y, z);
    assert.equal(n.spec.key, k, `nearest at ${x},${y},${z}`);
    assert.ok(near(n.dist, d), `nearest dist at ${x},${y},${z}`);
  }
  console.log("PASS spacezone-nearest");
}

// 5. spaceSpeedMul from the Moon column: inert below the surface, 1 in the
// buffer, smooth mid-ramp, full boost past the ramp, monotonic. The Moon
// owns the zenith column (every planet sits 25000+ blocks out in XZ).
{
  assert.deepEqual(
    { mul: SPACE_MUL, buffer: SPACE_BUFFER, ramp: SPACE_RAMP },
    { mul: 6, buffer: 50, ramp: 600 }, "shipped constants");
  assert.equal(spaceSpeedMul(0, 10, 0), 1, "ground always 1");
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y - 1, 0), 1, "below the surface always 1");
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y, 0), 1, "surface 1");
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y + 49, 0), 1, "inside the buffer 1");
  const mid = spaceSpeedMul(0, MOON_SURFACE_Y + 50 + 300, 0);
  assert.ok(mid > 1 && mid < spaceMul(), `mid-ramp partial (${mid.toFixed(2)})`);
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y + 50 + 600 + 1, 0), spaceMul(), "past the ramp full boost");
  let prev = 1;
  for (let d = 0; d <= 1000; d += 25) {
    const f = spaceSpeedMul(0, MOON_SURFACE_Y + d, 0);
    assert.ok(f >= prev - 1e-12, `monotonic at ${d}`);
    assert.ok(f >= 1 && f <= spaceMul(), `bounded at ${d}`);
    prev = f;
  }
  assert.equal(spaceSpeedMul(5000, MOON_SURFACE_Y, 0), spaceMul(), "far sideways full boost");
  console.log("PASS spacezone-curve-moon");
}

// 6. spaceSpeedMul with a planet: the buffer belongs to the nearest body
// (bodies sit 50 diameters apart, so p0 owns its own column).
{
  const p0 = bodyByKey("p0");
  assert.ok(p0, "a planet exists");
  assert.equal(nearestBody(p0.cx, p0.top + 50, p0.cz).spec.key, "p0", "50 above p0 owned by p0");
  assert.equal(spaceSpeedMul(p0.cx, p0.top + 25, p0.cz), 1, "25 above p0 still 1");
  assert.equal(spaceSpeedMul(p0.cx, p0.top, p0.cz), 1, "p0 surface 1");
  assert.equal(nearestBody(p0.cx, p0.top + 50 + 600 + 5, p0.cz).spec.key, "p0", "655 above p0 still owned by p0");
  assert.equal(spaceSpeedMul(p0.cx, p0.top + 50 + 600 + 5, p0.cz), spaceMul(), "past the p0 ramp full boost");
  console.log("PASS spacezone-curve-planets");
}

// 7. Bbox descent distance: min analytic gap over the footprint columns —
// a hull past the rim reads void even at cap altitude, so a descent past
// a flank never slows down. Combined with the voxel gap through the shared
// ramp helper (flight loop takes the min of both).
{
  const one = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  assert.equal(landingDistBox(0, MOON_SURFACE_Y + 100, 0, one), 100, "footprint vertical gap exact");
  assert.equal(landingDistBox(0, MOON_SURFACE_Y, 0, one), 0, "bbox bottom on the cap reads 0");
  assert.equal(landingDistBox(MOON_R + 10, MOON_SURFACE_Y + 100, 0, one), Infinity, "past the rim no landing body");
  assert.equal(landingDistBox(MOON_R + 10, MOON_SURFACE_Y + 25, 0, one), Infinity, "single column past the rim reads void");
  // Wide hull straddling the rim: the inside column wins.
  const wide = { x0: 0, x1: 20, y0: 0, y1: 0, z0: 0, z1: 0 };
  assert.equal(landingDistBox(MOON_R - 5, MOON_SURFACE_Y + 25, 0, wide), 25, "straddling hull reads the inside column");
  assert.equal(landingDistBox(MOON_R + 1, MOON_SURFACE_Y + 25, 0, wide), Infinity, "fully outside hull reads void");
  const p0 = bodyByKey("p0");
  assert.equal(landingDistBox(p0.cx + p0.r + 10, p0.top + 25, p0.cz, one), Infinity, "descent past a planet flank reads void");
  assert.ok(takeoffDist(p0.cx + p0.r + 10, p0.top + 50, p0.cz) < Infinity, "takeoff still sees the 3D flank");
  // Shared ramp: a voxel gap under the band pins the factor at 1 even when
  // the analytic gap reads void (descent past a flank over a built tower).
  assert.equal(spaceFactorFromDist(25), 1, "voxel gap inside the band reads 1");
  assert.ok(spaceFactorFromDist(50 + 300) > 1, "mid-ramp voxel gap reads partial");
  assert.equal(spaceFactorFromDist(Infinity), spaceMul(), "void gap reads full boost");
  assert.equal(spaceFactorFromDist(Math.min(Infinity, 25)), 1, "min(void body, 25 voxel) eases back");
  console.log("PASS spacezone-landing-footprint");
}
