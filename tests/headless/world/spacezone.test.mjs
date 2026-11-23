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
import { spaceSpeedMul, SPACE_MUL, SPACE_BUFFER, SPACE_RAMP } from "../../../src/world/spacezone.js";

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
// owns the zenith column (every planet sits 8000+ blocks out in XZ).
{
  assert.deepEqual(
    { mul: SPACE_MUL, buffer: SPACE_BUFFER, ramp: SPACE_RAMP },
    { mul: 6, buffer: 200, ramp: 600 }, "shipped constants");
  assert.equal(spaceSpeedMul(0, 10, 0), 1, "ground always 1");
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y - 1, 0), 1, "below the surface always 1");
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y, 0), 1, "surface 1");
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y + 199, 0), 1, "inside the buffer 1");
  const mid = spaceSpeedMul(0, MOON_SURFACE_Y + 200 + 300, 0);
  assert.ok(mid > 1 && mid < 6, `mid-ramp partial (${mid.toFixed(2)})`);
  assert.equal(spaceSpeedMul(0, MOON_SURFACE_Y + 200 + 600 + 1, 0), 6, "past the ramp full boost");
  let prev = 1;
  for (let d = 0; d <= 1000; d += 25) {
    const f = spaceSpeedMul(0, MOON_SURFACE_Y + d, 0);
    assert.ok(f >= prev - 1e-12, `monotonic at ${d}`);
    assert.ok(f >= 1 && f <= 6, `bounded at ${d}`);
    prev = f;
  }
  assert.equal(spaceSpeedMul(5000, MOON_SURFACE_Y, 0), 6, "far sideways full boost");
  console.log("PASS spacezone-curve-moon");
}

// 6. spaceSpeedMul with a planet: the buffer belongs to the nearest body
// (bodies sit 10 diameters apart, so p0 owns its own column).
{
  const p0 = bodyByKey("p0");
  assert.ok(p0, "a planet exists");
  assert.equal(nearestBody(p0.cx, p0.top + 100, p0.cz).spec.key, "p0", "100 above p0 owned by p0");
  assert.equal(spaceSpeedMul(p0.cx, p0.top + 100, p0.cz), 1, "100 above p0 still 1");
  assert.equal(spaceSpeedMul(p0.cx, p0.top, p0.cz), 1, "p0 surface 1");
  assert.equal(nearestBody(p0.cx, p0.top + 200 + 600 + 5, p0.cz).spec.key, "p0", "805 above p0 still owned by p0");
  assert.equal(spaceSpeedMul(p0.cx, p0.top + 200 + 600 + 5, p0.cz), 6, "past the p0 ramp full boost");
  console.log("PASS spacezone-curve-planets");
}
