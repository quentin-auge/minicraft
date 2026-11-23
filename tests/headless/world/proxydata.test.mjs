// Proxy geometry data: exact voxel-footprint cap, boundary wall, sealed
// rim stack, shoreline-true lakes, analytic dome; deterministic, bounded.
import assert from "node:assert/strict";
import {
  buildProxyData, bodyDiscLoop, CAP_SEGMENTS, DOME_TINT, LAKE_SEGMENTS, SKIRT_DROP, isLakeCol,
} from "../../../src/world/proxydata.js";
import { bodySpecs, setPlanetSeed } from "../../../src/world/planets.js";
import { bodyLakeParams } from "../../../src/world/moon.js";

setPlanetSeed(7);
const specs = bodySpecs(7);
const p0 = specs.find((b) => b.key === "p0");
const moon = specs[0];

function checkBucket(out, name) {
  assert.equal(out.positions.length % 9, 0, `${name} triangle count`);
  assert.equal(out.normals.length, out.positions.length, `${name} normals match`);
  assert.equal(out.colors.length, out.positions.length, `${name} colors match`);
  assert.equal(out.uvs.length, (out.positions.length / 3) * 2, `${name} uvs match`);
  assert.ok(out.positions.length > 0, `${name} non-empty`);
  assert.ok(out.positions.length < 40000 * 3, `${name} bounded`);
  for (let i = 0; i < out.normals.length; i += 3) {
    const l = Math.hypot(out.normals[i], out.normals[i + 1], out.normals[i + 2]);
    assert.ok(Math.abs(l - 1) < 0.01, `${name} unit normals`);
  }
  // Albedo: white everywhere except the brightness-compensated dome.
  const tints = new Set(out.colors);
  assert.ok(tints.size <= 2, `${name} tint count`);
  // Full texture per block, like the voxel BoxGeometry faces: raw
  // block-coord UVs span many repeats (RepeatWrapping), never collapsed to
  // one texel.
  const span = Math.max(...out.uvs) - Math.min(...out.uvs);
  assert.ok(span > 0.5, `${name} varies (${span})`);
  for (const u of out.uvs) assert.ok(Number.isFinite(u), `${name} finite uvs`);
  // Varied shading: many distinct normals, not one per facet ring. The
  // water bucket is the exception by design: its faces are axis-aligned
  // (up cap discs, down well bottoms) — 2 distinct normals is correct.
  const seen = new Set();
  for (let i = 0; i < out.normals.length; i += 3) {
    seen.add(out.normals[i].toFixed(3) + "," + out.normals[i + 1].toFixed(3) + "," + out.normals[i + 2].toFixed(3));
  }
  const minNormals = name.startsWith("water") ? 2 : 6;
  assert.ok(seen.size >= minNormals, `${name} varied normals (${seen.size})`);
}

// Triangle coverage test in XZ at a given plane.
function triCovered(px, pz, tris) {
  for (const [ax, az, bx, bz, cx, cz] of tris) {
    const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
    const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
    const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

function trisAt(out, yTest) {
  const tris = [];
  for (let i = 0; i < out.positions.length; i += 9) {
    const ys = [out.positions[i + 1], out.positions[i + 4], out.positions[i + 7]];
    if (!yTest(ys)) continue;
    tris.push([
      out.positions[i], out.positions[i + 2],
      out.positions[i + 3], out.positions[i + 5],
      out.positions[i + 6], out.positions[i + 8],
    ]);
  }
  return tris;
}

{
  const d = buildProxyData(p0, 7);
  checkBucket(d.rock, "rock");
  checkBucket(d.dome, "dome");
  checkBucket(d.water, "water");
  // Dome tint: DOME_TINT on rock quads, white on the well bottoms.
  {
    const domeTint = new Set(d.dome.colors);
    assert.ok(domeTint.has(DOME_TINT[0]) || domeTint.has(1), "dome tint present");
  }
  // Cap = the EXACT voxel footprint: every included column's center is
  // covered by a cap triangle, no excluded near-rim column center is.
  {
    const capTris = trisAt(d.rock, (ys) => ys.every((y) => Math.abs(y - (p0.top + 1)) < 1e-6));
    assert.ok(capTris.length >= 2 * (2 * p0.r - 1), `cap bands present (${capTris.length})`);
    const R = p0.r;
    let included = 0;
    for (let dx = -R; dx <= R; dx++) {
      const zhi = Math.floor(Math.sqrt(R * R - dx * dx));
      for (let dz = -zhi; dz <= zhi; dz++) {
        const px = p0.cx + dx + 0.5, pz = p0.cz + dz + 0.5;
        assert.ok(triCovered(px, pz, capTris), `column (${dx},${dz}) covered`);
        included++;
      }
    }
    // Excluded columns just past the rim (the footprint's own staircase)
    // must stay uncovered: sample the ring of cells at Chebyshev distance
    // R+1..R+2 whose centers sit outside the disc.
    for (let dx = -R - 2; dx <= R + 2; dx++) {
      for (let dz = -R - 2; dz <= R + 2; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) <= R) continue;
        if (dx * dx + dz * dz <= R * R) continue;
        const px = p0.cx + dx + 0.5, pz = p0.cz + dz + 0.5;
        if (Math.hypot(dx, dz) > R + 2.5) continue; // far field, not rim staircase
        assert.ok(!triCovered(px, pz, capTris), `excluded (${dx},${dz}) uncovered`);
      }
    }
    void included;
  }
  // Boundary wall: the exposed slab sides (top capY, bottom wallBot) sit
  // exactly on the footprint boundary edges.
  {
    const wallBot = p0.top - (p0.thick ?? 5) + 1;
    const got = new Set();
    for (let i = 0; i < d.rock.positions.length; i += 9) {
      const ys = [d.rock.positions[i + 1], d.rock.positions[i + 4], d.rock.positions[i + 7]];
      const atCap = ys.filter((y) => Math.abs(y - (p0.top + 1)) < 1e-6).length;
      const atBot = ys.filter((y) => Math.abs(y - wallBot) < 1e-6).length;
      if (atCap !== 2 || atBot !== 1) continue; // wall quads only
      // Top edge: the two capY verts, keyed undirected on integer column
      // offsets (the want set below is built in offset space too).
      const vs = [];
      for (let k = 0; k < 3; k++) {
        const x = d.rock.positions[i + k * 3], z = d.rock.positions[i + k * 3 + 2];
        if (Math.abs(ys[k] - (p0.top + 1)) < 1e-6) vs.push([x - p0.cx, z - p0.cz]);
      }
      const [a, b] = vs;
      const k1 = a[0] + "," + a[1] + "|" + b[0] + "," + b[1];
      const k2 = b[0] + "," + b[1] + "|" + a[0] + "," + a[1];
      got.add(k1 < k2 ? k1 : k2);
    }
    // Expected: every included/excluded side pair of the footprint.
    const want = new Set();
    const R = p0.r;
    const inc = (dx, dz) => dx * dx + dz * dz <= R * R;
    for (let dx = -R; dx <= R; dx++) {
      const zhi = Math.floor(Math.sqrt(R * R - dx * dx));
      for (let dz = -zhi; dz <= zhi; dz++) {
        const sides = [
          [[dx, dz], [dx + 1, dz]], [[dx + 1, dz], [dx + 1, dz + 1]],
          [[dx + 1, dz + 1], [dx, dz + 1]], [[dx, dz + 1], [dx, dz]],
        ];
        const nbrs = [[dx, dz - 1], [dx + 1, dz], [dx, dz + 1], [dx - 1, dz]];
        for (let s = 0; s < 4; s++) {
          if (!inc(nbrs[s][0], nbrs[s][1])) {
            const [a, b] = sides[s];
            const k1 = a[0] + "," + a[1] + "|" + b[0] + "," + b[1];
            const k2 = b[0] + "," + b[1] + "|" + a[0] + "," + a[1];
            want.add(k1 < k2 ? k1 : k2);
          }
        }
      }
    }
    assert.equal(got.size, want.size, `wall edge count (${got.size} vs ${want.size})`);
    for (const k of want) assert.ok(got.has(k), `boundary edge present ${k}`);
  }
  // Shoulder seal: the shoulder bottoms (rock verts at the slab bottom)
  // and the dome ring verts (water/rock dome verts at the same y) name the
  // same point set — no slit at the wall→dome step.
  {
    const slabBottom = p0.top - (p0.thick ?? 5);
    const shoulderPts = new Set();
    for (let i = 0; i < d.rock.positions.length; i += 3) {
      if (Math.abs(d.rock.positions[i + 1] - slabBottom) < 1e-6) {
        shoulderPts.add(d.rock.positions[i].toFixed(4) + "," + d.rock.positions[i + 2].toFixed(4));
      }
    }
    const ringPts = new Set();
    for (let i = 0; i < d.dome.positions.length; i += 3) {
      if (Math.abs(d.dome.positions[i + 1] - slabBottom) < 1e-6) {
        ringPts.add(d.dome.positions[i].toFixed(4) + "," + d.dome.positions[i + 2].toFixed(4));
      }
    }
    assert.equal(ringPts.size, CAP_SEGMENTS, `dome ring complete (${ringPts.size})`);
    for (const k of ringPts) assert.ok(shoulderPts.has(k), `ring vert sealed ${k}`);
  }
  // Boundary loop: unit axis edges, simple (no repeated vertices), closed.
  {
    const loop = bodyDiscLoop(p0);
    assert.ok(loop.length > 4 * p0.r, `loop perimeter (${loop.length})`);
    const seenV = new Set(loop.map(([x, z]) => x + "," + z));
    assert.equal(seenV.size, loop.length, "loop simple");
    for (let i = 0; i < loop.length; i++) {
      const [ax, az] = loop[i];
      const [bx, bz] = loop[(i + 1) % loop.length];
      const dx = bx - ax, dz = bz - az;
      assert.ok((Math.abs(dx) === 1 && dz === 0) || (dx === 0 && Math.abs(dz) === 1), "unit edge");
    }
  }
  // Dome reaches the pole.
  let botY = Infinity;
  for (let i = 1; i < d.dome.positions.length; i += 3) {
    const y = d.dome.positions[i];
    if (y < botY) botY = y;
  }
  assert.ok(Math.abs(botY - (p0.top - p0.r)) < 0.01, `dome reaches the pole (${botY})`);
  // Horizontal bounds: rock within the footprint's outer corners (the
  // min-corner columns extend one block past the radius on the + sides);
  // dome stays inside the analytic radius.
  for (const [out, lim] of [[d.rock, p0.r + 1.5], [d.dome, p0.r + 0.01]]) {
    for (let i = 0; i < out.positions.length; i += 3) {
      const dx = out.positions[i] - p0.cx, dz = out.positions[i + 2] - p0.cz;
      assert.ok(Math.hypot(dx, dz) <= lim, `inside the disc (+${lim})`);
    }
  }
  // Lakes read as water on the cap.
  let lakeVerts = 0;
  for (let i = 0; i < d.water.positions.length; i += 3) {
    if (Math.abs(d.water.positions[i + 1] - (p0.top + 1.03)) < 0.02) lakeVerts++;
  }
  assert.ok(lakeVerts > 100, `lake fans present (${lakeVerts})`);
  // Shoreline-exact rims: every disc rim vertex sits on the voxel
  // shoreline. Checks, overlap-proof and float-dust-proof:
  // - rim verts lie on integer grid lines (DDA exits are cell faces);
  // - per lake (assigned by disc lift, exact), along every non-lattice
  //   construction ray, an independent 0.05-step march finds the last
  //   inside column within 0.3 of the vertex (axis/diagonal rays excluded:
  //   an ulp of direction picks the marched column there);
  // - rims vary (no perfect circles).
  {
    const lakes = bodyLakeParams(p0, 7);
    assert.ok(lakes.length > 0, "lakes to rim");
    const byLake = lakes.map(() => []);
    for (let i = 0; i < d.water.positions.length; i += 3) {
      const x = d.water.positions[i], y = d.water.positions[i + 1], z = d.water.positions[i + 2];
      if (Math.abs(y - (p0.top + 1.03)) > 0.015) continue;
      const li = Math.round((y - (p0.top + 1.03)) / 0.002);
      assert.ok(li >= 0 && li < lakes.length, `disc lift names a lake (${y})`);
      const C = lakes[li];
      const rr = Math.hypot(x - C.cx, z - C.cz);
      if (rr < 1) continue; // fan centers, not rim
      byLake[li].push({ x, z, rr });
    }
    const radii = [];
    lakes.forEach((C, li) => {
      assert.equal(byLake[li].length, LAKE_SEGMENTS * 2, `rim verts per lake (${byLake[li].length})`);
      for (const v of byLake[li]) {
        radii.push(v.rr);
        const ang = Math.atan2(v.z - C.cz, v.x - C.cx);
        let k = Math.round(ang / (Math.PI * 2) * LAKE_SEGMENTS);
        k = ((k % LAKE_SEGMENTS) + LAKE_SEGMENTS) % LAKE_SEGMENTS;
        if (k % 6 === 0) continue; // axis/diagonal: dust picks the column
        const a = (k / LAKE_SEGMENTS) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        // First water→rock flip along the ray (the DDA stops at the first
        // shore too — a rock gap between overlapping discs belongs to
        // neither fan, like the voxels).
        let exit = -1;
        for (let t = 0; t <= C.cr + 24; t += 0.05) {
          if (!isLakeCol(p0, 7, lakes, Math.floor(C.cx + dx * t), Math.floor(C.cz + dz * t))) { exit = t; break; }
        }
        assert.ok(exit > 0.5, "ray crosses a shore");
        assert.ok(Math.abs(exit - v.rr) <= 0.35, `rim on the voxel shore (${v.rr.toFixed(2)} vs ${exit.toFixed(2)})`);
      }
    });
    const rmin = Math.min(...radii), rmax = Math.max(...radii);
    assert.ok(rmax - rmin > 1, `rims not circular (${rmin.toFixed(2)}..${rmax.toFixed(2)})`);
    // Skirt: rock verts hanging under a lake rim (well inside the disc —
    // the rim wall/shoulder verts near the boundary are excluded), flat
    // horizontal normals, 2 deep.
    let skirt = 0;
    for (let i = 0; i < d.rock.positions.length; i += 3) {
      const x = d.rock.positions[i], y = d.rock.positions[i + 1], z = d.rock.positions[i + 2];
      const rad = Math.hypot(x - p0.cx, z - p0.cz);
      if (y >= p0.top + 0.99 || rad > p0.r - 5) continue;
      skirt++;
      assert.ok(Math.abs(d.rock.normals[i + 1]) < 0.01, "skirt normals horizontal");
      assert.ok(y >= p0.top + 1.04 - SKIRT_DROP - 0.02, "skirt depth");
    }
    assert.ok(skirt > lakes.length * 10, `skirt present (${skirt})`);
  }
  // Determinism.
  const d2 = buildProxyData(p0, 7);
  assert.deepEqual(d.dome.positions, d2.dome.positions, "deterministic positions");
  assert.deepEqual(d.dome.colors, d2.dome.colors, "deterministic colors");
  // Underside wells: EXACT per-column parity with the voxels. Every lake
  // column pierces the shell in the voxels (generateBodyLakes rewrites the
  // whole column down to base − floor(√(R²−d2))), so the proxy must cover
  // every column of the isLakeCol mask with a water quad — corner heights
  // hug the analytic dome (dome-depth class, within the approved ≤1-block
  // staircase deviation) — and nothing else below the cap.
  {
    const lakes = bodyLakeParams(p0, 7);
    const wtris = [];
    for (let i = 0; i < d.water.positions.length; i += 9) {
      const ys = [d.water.positions[i + 1], d.water.positions[i + 4], d.water.positions[i + 7]];
      if (Math.max(...ys) > p0.top + 0.5) continue;
      wtris.push({
        t: [
          d.water.positions[i], d.water.positions[i + 2],
          d.water.positions[i + 3], d.water.positions[i + 5],
          d.water.positions[i + 6], d.water.positions[i + 8],
        ],
        y: ys[0],
      });
    }
    assert.ok(wtris.length > 0, "underside well quads exist");
    let cols = 0, hit = 0;
    for (const L of lakes) {
      const R = L.cr + 3;
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          if (!isLakeCol(p0, 7, lakes, L.cx + dx, L.cz + dz)) continue;
          cols++;
          const x = L.cx + dx, z = L.cz + dz;
          const ox = x - p0.cx, oz = z - p0.cz;
          const h = Math.floor(Math.sqrt(p0.r * p0.r - ox * ox - oz * oz));
          // The column's quad: covered in XZ, heights in the dome-depth
          // class (analytic dome minus the 0.06 dip, so within 1.5 of the
          // voxel staircase bottom).
          const local = wtris.filter((w) =>
            w.y >= p0.top - h - 2 && w.y <= p0.top - h + 0.5);
          const covered = triCovered(x + 0.5, z + 0.5, local.map((w) => w.t));
          if (covered) hit++;
        }
      }
    }
    assert.ok(cols > 0, "lake columns to cover");
    console.log(`well coverage: ${hit}/${cols} exact`);
    assert.equal(hit, cols, "every lake column has its underside quad");
    // Nothing below the cap outside the lake mask: every underside water
    // triangle's XZ footprint center is a lake column.
    for (const { t } of wtris) {
      const px = (t[0] + t[2] + t[4]) / 3, pz = (t[1] + t[3] + t[5]) / 3;
      assert.ok(
        isLakeCol(p0, 7, lakes, Math.floor(px), Math.floor(pz)),
        `underside water only over lake columns (${px.toFixed(1)},${pz.toFixed(1)})`);
    }
  }
  console.log(`PASS proxy-data p0 verts=${d.rock.positions.length / 3 + d.dome.positions.length / 3 + d.water.positions.length / 3}`);
}
{
  // Moon proxy: same contracts.
  const d = buildProxyData(moon, 7);
  checkBucket(d.rock, "moon rock");
  checkBucket(d.dome, "moon dome");
  const capTris = trisAt(d.rock, (ys) => ys.every((y) => Math.abs(y - (moon.top + 1)) < 1e-6));
  let included = 0;
  for (let dx = -moon.r; dx <= moon.r; dx++) {
    const zhi = Math.floor(Math.sqrt(moon.r * moon.r - dx * dx));
    for (let dz = -zhi; dz <= zhi; dz++) {
      assert.ok(triCovered(moon.cx + dx + 0.5, moon.cz + dz + 0.5, capTris), `moon column (${dx},${dz}) covered`);
      included++;
    }
  }
  assert.ok(included > 20000, `moon columns covered (${included})`);
  console.log("PASS proxy-data moon");
}
