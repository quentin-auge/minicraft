// Proxy tiers: FULL exact proxy near, shared lite impostors far. The tier
// decision is pure (headless-tested here); the lite geometry covers the
// full silhouette with sub-pixel deltas at the swap distance, so the hard
// swap is invisible. Deterministic per (spec, seed).
import assert from "node:assert/strict";
import {
  buildProxyData, buildLiteRock, buildLiteDome, buildLiteQuad,
  liteLakeQuads, liteBodyPlacement, liteGroups,
  LITE_DOME_LON,
  LITE_LAKE_LIFT, LITE_LAKE_MARGIN, LITE_DISC_PAD, DOME_TINT,
} from "../../../src/world/proxydata.js";
import {
  bodySpecs, setPlanetSeed, proxyTierFor, PLANET_COLORS,
  PROXY_FULL_DIST, PROXY_LITE_DIST,
} from "../../../src/world/planets.js";
import { bodyLakeParams } from "../../../src/world/moon.js";
import { isLakeCol } from "../../../src/world/proxydata.js";

setPlanetSeed(7);
const specs = bodySpecs(7);
const p0 = specs.find((b) => b.key === "p0");
const moon = specs[0];
assert.ok(p0 && moon, "planet + moon specs");

// --- tier decision: hysteresis band, moon + touched always full.
assert.equal(proxyTierFor(PROXY_FULL_DIST, "lite", {}), "full", "at full edge");
assert.equal(proxyTierFor(PROXY_FULL_DIST + 1, "full", {}), "full", "holds below lite edge");
assert.equal(proxyTierFor(PROXY_FULL_DIST + 1, "lite", {}), "lite", "lite above full edge");
assert.equal(proxyTierFor(PROXY_LITE_DIST - 1, "full", {}), "full", "holds above full edge");
assert.equal(proxyTierFor(PROXY_LITE_DIST - 1, "lite", {}), "lite", "lite below lite edge");
assert.equal(proxyTierFor(PROXY_LITE_DIST, "full", {}), "lite", "drops at lite edge");
assert.equal(proxyTierFor(0, "lite", {}), "full", "contact is full");
assert.equal(proxyTierFor(1e9, "full", { touched: true }), "full", "touched stays full");
assert.equal(proxyTierFor(1e9, "lite", { isMoon: true }), "full", "moon stays full");
assert.equal(proxyTierFor(1e9, "full", {}), "lite", "far is lite");
assert.equal(proxyTierFor(PROXY_FULL_DIST), "full", "default current is full");
assert.ok(PROXY_LITE_DIST > PROXY_FULL_DIST, "hysteresis band non-empty");

// --- lite slot grouping: stable, moon excluded, every planet exactly once.
{
  const g1 = liteGroups(specs);
  const g2 = liteGroups(specs);
  assert.equal(JSON.stringify(g1), JSON.stringify(g2), "grouping deterministic");
  const keys = g1.flatMap((g) => g.keys);
  assert.equal(keys.length, specs.length - 1, "every non-moon body slotted");
  assert.ok(!keys.includes("moon"), "moon never lite");
  assert.equal(new Set(keys).size, keys.length, "no double slot");
  assert.ok(g1.every((g) => g.keys.length > 0), "no empty mesh");
  // Every group resolves to a real palette (spec.color is a palette index,
  // same convention as TEX["planetrock" + i]) — the engine reads colors
  // straight off these entries.
  for (const g of g1) {
    const pal = PLANET_COLORS[g.color];
    assert.ok(pal && pal.rock && pal.water, `group ${g.color} resolves to a palette`);
  }
  // Slot order follows spec order within each group (stable across
  // rebuilds/seeds — slot indices never shuffle under a body).
  const rank = new Map(specs.map((s, i) => [s.key, i]));
  for (const g of g1) {
    const rs = g.keys.map((k) => rank.get(k));
    assert.deepEqual([...rs].sort((a, b) => a - b), rs, `group ${g.color} keeps spec order`);
  }
  const lakes = liteLakeQuads(p0, 7);
  assert.equal(JSON.stringify(lakes), JSON.stringify(liteLakeQuads(p0, 7)), "quads deterministic");
  assert.equal(lakes.length, bodyLakeParams(p0, 7).length, "one quad per lake");
}

// --- lite coverage: same silhouette as the full proxy.
{
  const full = buildProxyData(p0, 7);
  const rock = buildLiteRock(p0.r);
  const dome = buildLiteDome(p0.r, p0.thick);
  const quad = buildLiteQuad();
  for (const [out, name] of [[rock, "lite rock"], [dome, "lite dome"], [quad, "lite quad"]]) {
    assert.equal(out.positions.length % 9, 0, `${name} triangle count`);
    assert.equal(out.normals.length, out.positions.length, `${name} normals match`);
    assert.equal(out.colors.length, out.positions.length, `${name} colors match`);
    assert.equal(out.uvs.length, (out.positions.length / 3) * 2, `${name} uvs match`);
    for (const u of out.uvs) assert.ok(Number.isFinite(u), `${name} finite uvs`);
    assert.ok(out.positions.length > 0 && out.positions.length < 20000 * 3, `${name} bounded`);
    for (let i = 0; i < out.normals.length; i += 3) {
      const l = Math.hypot(out.normals[i], out.normals[i + 1], out.normals[i + 2]);
      assert.ok(Math.abs(l - 1) < 0.01, `${name} unit normals`);
    }
  }
  // World-scale UVs (same conventions as the full proxy — the engine
  // samples the collapsed palette mean through them).
  assert.ok(Math.max(...rock.uvs) - Math.min(...rock.uvs) > 1, "rock uvs span blocks");
  // White verts on rock/water (palette via material), tint on the dome.
  assert.ok(rock.colors.every((c) => c === 1), "rock verts white");
  assert.ok(quad.colors.every((c) => c === 1), "quad verts white");
  assert.ok(dome.colors.every((c) => c === DOME_TINT[0]), "dome tint baked");
  const at = liteBodyPlacement(p0);
  assert.deepEqual(at, { x: p0.cx, y: p0.top + 1, z: p0.cz }, "cap-plane placement");
  // Disc covers the exact footprint: full cap spans dx ∈ [-R, R+1].
  let fullR = 0;
  for (let i = 0; i < full.rock.positions.length; i += 3) {
    const dx = full.rock.positions[i] - p0.cx, dz = full.rock.positions[i + 2] - p0.cz;
    const y = full.rock.positions[i + 1] - at.y;
    if (Math.abs(y) < 0.001) fullR = Math.max(fullR, Math.hypot(dx, dz));
  }
  let liteR = 0;
  for (let i = 0; i < rock.positions.length; i += 3) {
    liteR = Math.max(liteR, Math.hypot(rock.positions[i], rock.positions[i + 2]));
  }
  assert.ok(Math.abs(liteR - (p0.r + LITE_DISC_PAD)) < 1e-9, `disc radius R+pad (${liteR})`);
  assert.ok(liteR >= fullR, `disc covers cap (${liteR} >= ${fullR})`);
  // Dome vertical range identical (same ring formula, fewer segments).
  const ys = (out) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < out.positions.length; i += 3) {
      lo = Math.min(lo, out.positions[i]);
      hi = Math.max(hi, out.positions[i]);
    }
    return [lo, hi];
  };
  const [fLo, fHi] = ys(full.dome);
  const [lLo, lHi] = ys(dome);
  assert.ok(Math.abs((lLo + at.y) - fLo) < 1e-6, `dome bottom matches (${lLo + at.y} vs ${fLo})`);
  assert.ok(Math.abs((lHi + at.y) - fHi) < 1e-6, `dome pole matches (${lHi + at.y} vs ${fHi})`);
  // Rim band depth mirrors the voxel slab (thick rows below the cap).
  let bandLo = 0;
  for (let i = 1; i < rock.positions.length; i += 3) bandLo = Math.min(bandLo, rock.positions[i]);
  assert.equal(bandLo, -(p0.thick ?? 5), "skirt depth mirrors slab");
  // Quads cover the whole lake mask: every lake column inside a quad.
  for (const spec of [p0, moon]) {
    const qs = liteLakeQuads(spec, 7);
    for (let x = spec.cx - spec.r - 1; x <= spec.cx + spec.r + 1; x++) {
      for (let z = spec.cz - spec.r - 1; z <= spec.cz + spec.r + 1; z++) {
        if (!isLakeCol(spec, 7, bodyLakeParams(spec, 7), x, z)) continue;
        const inside = qs.some((q) => Math.abs(x - q.x) <= q.half && Math.abs(z - q.z) <= q.half);
        assert.ok(inside, `lake col (${x},${z}) covered`);
      }
    }
  }
}

// --- swap invisibility: every lite-vs-full delta is sub-pixel at FULL_DIST.
// Pixels per block at d for 1080p/75°: 1080 / (2·d·tan 37.5°) ≈ 704/d.
{
  const px = (blocks) => (blocks * 704) / PROXY_FULL_DIST;
  assert.ok(px(2) < 1, `lake riser invisible (${px(2).toFixed(2)} px)`);
  assert.ok(px(p0.r * (1 - Math.cos(Math.PI / LITE_DOME_LON))) < 1, "dome facet sagitta invisible");
  assert.ok(px(1) < 1, "cap stair invisible");
  assert.ok(px(LITE_DISC_PAD) < 1, "disc pad invisible");
  assert.ok(LITE_LAKE_MARGIN > 0.9 + 0.7, "quad margin covers noise + teeth");
  assert.ok(LITE_LAKE_LIFT > 0 && LITE_LAKE_LIFT < 1, "quad lift sub-block");
}

console.log("PASS proxy tiers: decision, coverage, sub-pixel swap");
