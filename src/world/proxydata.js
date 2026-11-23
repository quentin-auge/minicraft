// Procedural proxy data for celestial bodies: the voxel exterior as low-poly
// triangles — exact voxel-footprint cap + boundary wall + rim shoulder +
// shoreline-true lake insets + analytic dome underside — built from the
// generation rules without touching voxels. Deterministic per (spec, seed).
//
// Fidelity: the cap is the EXACT voxel footprint (per-column bands on the
// block grid, same dx²+dz² ≤ R² rule as generateBodySurfaceRows), so cap
// and voxels share one silhouette with zero slivers; the boundary wall (the
// 5-block slab sides the voxels expose at the rim) and a 1-block shoulder
// ring down to the dome make the rim stack match the voxel wall→sphere
// silhouette. The dome is the analytic hemisphere the voxels staircase
// (≤1.4 voxel deviation, sub-pixel at swap range) with smooth per-vertex
// normals, so it shades as one surface instead of facet rings. Underside
// lake bottoms are per-column exact: every lake column pierces the voxel
// shell down to its staircase height, so the proxy emits one down-facing
// quad per column at exactly that height — the same mask, same heights,
// same shoreline teeth as the voxels.
//
// Texturing mirrors the voxel meshes: every face samples the FULL texture
// per block. Because the materials wrap (RepeatWrapping), raw world-block
// coordinates used directly as UVs tile once per block exactly like the
// voxel instances' 0..1 box faces — with none of the snapped-integer
// collapse the old rim fan suffered (every rim vertex mapped to texel
// (0,0), flattening the whole cap). Cap, wall, lakes, underside well
// bottoms and the pole fan use raw x/z or y; the dome keeps cylindrical
// arc-length UVs at ~1 texel per block (mipmaps + anisotropy average it
// out at range — no grain aliasing, no flat dome). Buckets stay white,
// except the dome rock bucket (DOME_TINT).
import { hash2 } from "../core/noise.js";
import { bodyLakeParams } from "./moon.js";

export const CAP_SEGMENTS = 256;
export const LAKE_SEGMENTS = 48;
export const SKIRT_DROP = 2;
// Same angular grid as the analytic dome (same count, same origin), so the
// shoulder's bottom polyline passes through the dome ring vertices and the
// seal is exact.
const DOME_LON = CAP_SEGMENTS;
const DOME_LAT = 24;
// Dome brightness: the smooth analytic dome catches far less sun than the
// voxel staircase (down-facing normals vs sunlit treads), so the dome would
// read dark without compensation. Vertex tint lifts the albedo before
// lighting (gradient preserved, unlike an emissive bump) — tuned by A/B
// against real voxels.
export const DOME_TINT = [1.33, 1.33, 1.33];

// Voxel-true lake rim: the voxel shoreline lives on the integer lattice
// (isLakeCol is per column), so the proxy rim follows block edges, not a
// radius. Amanatides & Woo traversal from the lake center along the ray:
// the rim is the face between the last lake column and the first rock
// column — exact, no sampling step to skip thin diagonal shores. No
// erosion needed: the peel only ever adds water, so the rule boundary is
// water inside, rock outside.
function lakeRimPoint(spec, seed, lakes, cx, cz, ang) {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  let ix = Math.floor(cx), iz = Math.floor(cz);
  if (!isLakeCol(spec, seed, lakes, ix, iz)) return [cx + dx * 0.5, cz + dz * 0.5];
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? ix + 1 - cx : cx - ix) / Math.abs(dx) : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? iz + 1 - cz : cz - iz) / Math.abs(dz) : Infinity;
  for (let guard = 0; guard < 64; guard++) {
    if (tMaxX < tMaxZ) {
      const te = tMaxX;
      ix += stepX; tMaxX += tDeltaX;
      if (!isLakeCol(spec, seed, lakes, ix, iz)) return [cx + dx * te, cz + dz * te];
    } else {
      const te = tMaxZ;
      iz += stepZ; tMaxZ += tDeltaZ;
      if (!isLakeCol(spec, seed, lakes, ix, iz)) return [cx + dx * te, cz + dz * te];
    }
  }
  return [cx + dx * 40, cz + dz * 40];
}

// Single-column lake test: mirrors eachBodyLakeCol's inner rule exactly.
// Exported for the headless rim-exactness test.
export function isLakeCol(spec, seed, lakes, x, z) {
  const ox = x - spec.cx, oz = z - spec.cz;
  if (ox * ox + oz * oz > spec.r * spec.r) return false;
  for (const { cx, cz, cr, i } of lakes) {
    const dx = x - cx, dz = z - cz;
    const ang = Math.atan2(dz, dx);
    const noise = (hash2(x, z, seed + spec.lakeSalt) - 0.5) * 1.8;
    const rr = cr + noise + Math.sin(ang * 3 + i) * 0.7;
    if (dx * dx + dz * dz <= rr * rr) return true;
  }
  return false;
}

function newBucket() {
  return { positions: [], normals: [], colors: [], uvs: [] };
}

// Counter-clockwise winding viewed from the normal side (three.js FrontSide).
// Vertex colors stay white: the palette texture carries the albedo, exactly
// like untinted voxel instances.
function pushTri(out, a, b, c, n, uva, uvb, uvc) {
  out.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let k = 0; k < 3; k++) out.normals.push(n[0], n[1], n[2]);
  for (let k = 0; k < 3; k++) out.colors.push(1, 1, 1);
  out.uvs.push(uva[0], uva[1], uvb[0], uvb[1], uvc[0], uvc[1]);
}
// Same triangle with per-vertex normals: the dome shades smoothly (no facet
// banding), while the voxel-true silhouette still comes from the geometry.
// Tint lifts the albedo (dome brightness compensation).
function pushTriN(out, a, b, c, na, nb, nc, uva, uvb, uvc, tint) {
  out.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  out.normals.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
  for (let k = 0; k < 3; k++) out.colors.push(tint[0], tint[1], tint[2]);
  out.uvs.push(uva[0], uva[1], uvb[0], uvb[1], uvc[0], uvc[1]);
}

// Per-column half-heights of the voxel disc: column dx holds dz ∈
// [−zhi, zhi] with zhi = floor(√(R²−dx²)) — the same dx²+dz² ≤ R² rule as
// generateBodySurfaceRows (dz = 0 always included, so every run contains
// the equator and consecutive runs overlap: the union stays contiguous).
// Radius-only, shared by every body with the same R: computed once.
const runsCache = new Map();
function discRuns(spec) {
  const R = spec.r;
  const hit = runsCache.get(R);
  if (hit) return hit;
  const runs = [];
  for (let dx = -R; dx <= R; dx++) runs.push(Math.floor(Math.sqrt(R * R - dx * dx)));
  runsCache.set(R, runs);
  return runs;
}

// Boundary loop of the voxel disc footprint: an ordered walk of unit block
// edges with the disc on the right, starting at the westernmost column's
// southwest corner heading north. The center-test rasterization is
// coordinate-monotone (two diagonal included columns always bring both
// orthogonal neighbours in), so the loop is simple — no diagonal pinches —
// and the walk is deterministic. Offsets are relative to (spec.cx, spec.cz);
// block (dx, dz) occupies corners [dx, dx+1] × [dz, dz+1].
// Radius-only, shared by every body with the same R: walked once (shared
// read-only reference, never mutated by callers).
const discLoopCache = new Map();
export function bodyDiscLoop(spec) {
  const R = spec.r;
  const hit = discLoopCache.get(R);
  if (hit) return hit;
  const R2 = R * R;
  const inc = (dx, dz) => dx * dx + dz * dz <= R2;
  // The two cells sharing the directed unit edge P→P+h.
  const edgeCells = (X, Z, ax, az) => {
    if (ax !== 0) {
      const cxx = X + (ax < 0 ? -1 : 0);
      return [[cxx, Z - 1], [cxx, Z]]; // [south, north]
    }
    const czz = Z + (az < 0 ? -1 : 0);
    return [[X - 1, czz], [X, czz]]; // [west, east]
  };
  let X = -R, Z = 0, hx = 0, hz = 1;
  const loop = [];
  const maxLen = 8 * (2 * R + 2) * (2 * R + 2);
  for (let n = 0; n < maxLen; n++) {
    loop.push([X, Z]);
    // Inside-on-right priority at each corner: right turn, straight, left
    // turn (right of h = rotcw(h) = (hz, −hx)). A heading qualifies when the
    // cell on its right is included and the cell on its left is excluded.
    let stepped = false;
    for (const [ax, az] of [[hz, -hx], [hx, hz], [-hz, hx]]) {
      const cells = edgeCells(X, Z, ax, az);
      const ri = ax !== 0 ? (ax > 0 ? 0 : 1) : (az > 0 ? 1 : 0);
      if (inc(cells[ri][0], cells[ri][1]) && !inc(cells[1 - ri][0], cells[1 - ri][1])) {
        X += ax; Z += az; hx = ax; hz = az;
        stepped = true;
        break;
      }
    }
    if (!stepped) throw new Error("disc boundary walk lost the wall");
    // The loop is simple (one in-edge, one out-edge per corner), so arriving
    // back at the start corner closes it — the heading is necessarily the
    // start heading then.
    if (X === -R && Z === 0) {
      discLoopCache.set(R, loop);
      return loop;
    }
  }
  throw new Error("disc boundary walk never closed");
}

export function buildProxyData(spec, seed) {
  const R = spec.r, base = spec.top, thick = spec.thick ?? 5;
  const lakes = bodyLakeParams(spec, seed);
  const rockOut = newBucket(), domeOut = newBucket(), waterOut = newBucket();
  const capY = base + 1; // top-face plane of the cap blocks
  const wallBot = base - thick + 1; // bottom face of the cap slab
  // Cap: exact voxel footprint as per-column strips. Column dx holds the
  // contiguous run dz ∈ [−zhi, zhi] (zhi = floor(√(R²−dx²)), same rule as
  // generateBodySurfaceRows), so its x-strip [cx+dx, cx+dx+1] is one
  // rectangle — two triangles tile it, and the strips union to the exact
  // footprint, silhouette included. Raw world coords as UVs tile once per
  // block (RepeatWrapping), matching the voxel box faces. Consecutive
  // strips overlap only along their shared edge (coplanar, exact).
  const runs = discRuns(spec);
  for (let i = 0; i < runs.length; i++) {
    const X = spec.cx - R + i;
    const zl = spec.cz - runs[i], zu = spec.cz + runs[i] + 1;
    pushTri(rockOut,
      [X, capY, zu], [X + 1, capY, zu], [X + 1, capY, zl], [0, 1, 0],
      [X, zu], [X + 1, zu], [X + 1, zl]);
    pushTri(rockOut,
      [X, capY, zu], [X + 1, capY, zl], [X, capY, zl], [0, 1, 0],
      [X, zu], [X + 1, zl], [X, zl]);
  }
  // Boundary loop: the footprint silhouette the wall and shoulder hang on.
  const loop = bodyDiscLoop(spec);
  // Dome underside: analytic hemisphere starting at the slab bottom
  // (t0 = asin(thick/R), ring radius R·cos t0 at y = base−thick), so the
  // shoulder ring closes the wall→sphere step exactly. UVs run at the
  // voxel texel density (one full texture per block: u = arc blocks, v =
  // depth blocks), exactly like the voxel box faces — the tilt normal map
  // compensates with its own 1/16 repeat to keep one facet per block.
  // The pole is a planar-UV fan (no cylindrical pinch under the eye).
  const t0 = Math.asin(Math.min(1, thick / R));
  const domeUv = (p, t) => [(p / (Math.PI * 2)) * (Math.PI * 2 * R), ((t - t0) * R)];
  const ring = (t, p) => {
    const cp = Math.cos(t);
    return [spec.cx + R * cp * Math.cos(p), base - R * Math.sin(t), spec.cz + R * cp * Math.sin(p)];
  };
  const nrm = (t, p) => [Math.cos(t) * Math.cos(p), -Math.sin(t), Math.cos(t) * Math.sin(p)];
  const tPole = t0 + ((Math.PI / 2 - t0) * (DOME_LAT - 1)) / DOME_LAT;
  for (let la = 0; la < DOME_LAT - 1; la++) {
    const ta = t0 + ((Math.PI / 2 - t0) * la) / DOME_LAT;
    const tb = t0 + ((Math.PI / 2 - t0) * (la + 1)) / DOME_LAT;
    for (let lo = 0; lo < DOME_LON; lo++) {
      const p0 = (lo / DOME_LON) * Math.PI * 2;
      const p1 = ((lo + 1) / DOME_LON) * Math.PI * 2;
      const A = ring(ta, p0), B = ring(ta, p1);
      const C = ring(tb, p0), D = ring(tb, p1);
      const uA = domeUv(p0, ta), uB = domeUv(p1, ta);
      const uC = domeUv(p0, tb), uD = domeUv(p1, tb);
      // (A,B,C),(B,D,C): counter-clockwise from outside (verified: at the
      // equator the first triangle's normal is +X, the outward direction).
      // Smooth per-vertex normals: the dome reads as one surface, not rings.
      // Underside water is per-column exact (see below), so the dome is
      // rock everywhere.
      pushTriN(domeOut, A, B, C,
        nrm(ta, p0), nrm(ta, p1), nrm(tb, p0), uA, uB, uC, DOME_TINT);
      pushTriN(domeOut, B, D, C,
        nrm(ta, p1), nrm(tb, p1), nrm(tb, p0), uB, uD, uC, DOME_TINT);
    }
  }
  // Pole fan: the lat/lon grid converges at the pole (UV pinch + radial
  // smear), so the last band is a planar-UV fan from the tPole ring to
  // the pole point — raw world UVs, same square grain as the cap. Rim verts
  // are the ring formula verbatim, so the fan edge matches the last quad
  // row exactly (no T-junction slits).
  {
    const P0 = [spec.cx, base - R, spec.cz];
    for (let lo = 0; lo < DOME_LON; lo++) {
      const p0 = (lo / DOME_LON) * Math.PI * 2;
      const p1 = ((lo + 1) / DOME_LON) * Math.PI * 2;
      const R0 = ring(tPole, p0), R1 = ring(tPole, p1);
      pushTriN(domeOut, P0, R0, R1,
        [0, -1, 0], nrm(tPole, p0), nrm(tPole, p1),
        [P0[0], P0[2]], [R0[0], R0[2]], [R1[0], R1[2]], DOME_TINT);
    }
  }
    // Underside lake bottoms: per-column EXACT well bottoms. In the voxels
  // every lake column pierces the shell (generateBodyLakes rewrites the
  // whole column down to base − floor(√(R²−d2))), so the underside reads
  // the lake mask column by column — the same mask this module already
  // mirrors (isLakeCol). One down-facing quad per column, corner heights
  // hugging the analytic dome minus a 0.06 dip toward the below-eye: the
  // dome (slope >45° at lake radii) would otherwise poke flat quads in
  // bright wedges, and the dip makes the water win unconditionally at any
  // depth precision (the cap lakes' 0.03 lift, mirrored). Deviation from
  // the voxel staircase bottoms stays in the dome's approved ≤1-block
  // class; the shoreline is column-exact. Columns claimed by two
  // overlapping lakes emit once (both are the same water face in the
  // voxels).
  {
    const seen = new Set();
    const domeY = (px, pz) => {
      const dx = px - spec.cx, dz = pz - spec.cz;
      const d2 = Math.min(R * R, dx * dx + dz * dz);
      return base - Math.sqrt(R * R - d2) - 0.06;
    };
    for (const { cx, cz, cr } of lakes) {
      for (let dx = -cr - 1; dx <= cr + 1; dx++) {
        const x = cx + dx;
        for (let dz = -cr - 1; dz <= cr + 1; dz++) {
          const z = cz + dz;
          const ck = x + "," + z;
          if (seen.has(ck)) continue;
          seen.add(ck);
          if (!isLakeCol(spec, seed, lakes, x, z)) continue;
          const ox = x - spec.cx, oz = z - spec.cz;
          if (ox * ox + oz * oz > R * R) continue;
          const A = [x, domeY(x, z), z], B = [x + 1, domeY(x + 1, z), z];
          const C = [x + 1, domeY(x + 1, z + 1), z + 1], D = [x, domeY(x, z + 1), z + 1];
          // Down-facing: (B−A)×(C−B) points below the patch — seen from
          // below the triangles wind counter-clockwise (FrontSide); the
          // per-corner warp keeps the XZ winding of the flat quad.
          pushTri(waterOut, A, B, C, [0, -1, 0],
            [x, z], [x + 1, z], [x + 1, z + 1]);
          pushTri(waterOut, A, C, D, [0, -1, 0],
            [x, z], [x + 1, z + 1], [x, z + 1]);
        }
      }
    }
  }
  // Boundary wall + shoulder: for every loop edge (unit, axis-aligned),
  // one wall quad spanning the exposed slab sides (wallBot..capY, outward
  // horizontal normal = left of the walk heading) and one shoulder strip
  // (wallBot down to the dome's t0 ring, subdivided at every dome sample
  // angle the edge spans, so its bottom polyline reuses the dome ring
  // vertices verbatim — the seal is exact). Arc-length u runs along the
  // loop (one block per unit edge, per-block tiling); v is raw y.
  let arc = 0;
  for (let i = 0; i < loop.length; i++) {
    const [ax, az] = loop[i];
    const [bx, bz] = loop[(i + 1) % loop.length];
    const hx = bx - ax, hz = bz - az;
    const n = [-hz, 0, hx]; // outward = left of the heading (disc on the right)
    const A = [spec.cx + ax, capY, spec.cz + az];
    const B = [spec.cx + bx, capY, spec.cz + bz];
    const Ab = [A[0], wallBot, A[2]], Bb = [B[0], wallBot, B[2]];
    const ua = arc;
    arc += 1;
    // Wall: (A_top, A_bot, B_bot),(A_top, B_bot, B_top) — CCW from outside.
    pushTri(rockOut, A, Ab, Bb, n,
      [ua, A[1]], [ua, Ab[1]], [ua + 1, Bb[1]]);
    pushTri(rockOut, A, Bb, B, n,
      [ua, A[1]], [ua + 1, Bb[1]], [ua + 1, B[1]]);
    // Shoulder: descend from the loop edge to the t0 ring. The bottom
    // polyline is the edge's radial projection onto the ring circle: it
    // runs the SHORT arc between the endpoints' angles (radial edges
    // degenerate to a point), passing through every dome sample angle on
    // the way, so it reuses the dome ring vertices verbatim — the seal is
    // exact and the strip never wraps the long way around.
    const tA = Math.atan2(A[2] - spec.cz, A[0] - spec.cx);
    const tB = Math.atan2(B[2] - spec.cz, B[0] - spec.cx);
    let dAng = tB - tA;
    dAng = ((dAng + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const tEnd = tA + dAng;
    const step = (Math.PI * 2) / DOME_LON;
    const bottomAt = (ang) => ring(t0, ang);
    const emit = (Ti, fi, Pi, Pj, fj) => {
      const Tj = [A[0] + hx * fj, wallBot, A[2] + hz * fj];
      if (Math.hypot(Pi[0] - Pj[0], Pi[2] - Pj[2]) > 1e-9) {
        pushTri(rockOut, Ti, Pi, Pj, n,
          [ua + fi, Ti[1]], [ua + fi, Pi[1]], [ua + fj, Pj[1]]);
      }
      pushTri(rockOut, Ti, Pj, Tj, n,
        [ua + fi, Ti[1]], [ua + fj, Pj[1]], [ua + fj, Tj[1]]);
    };
    let T0 = Ab, f0 = 0, P0 = bottomAt(tA);
    if (Math.abs(dAng) > 1e-9) {
      const k0 = dAng > 0 ? Math.ceil(tA / step - 1e-9) : Math.floor(tA / step + 1e-9);
      const k1 = dAng > 0 ? Math.floor(tEnd / step + 1e-9) : Math.ceil(tEnd / step - 1e-9);
      const kStep = dAng > 0 ? 1 : -1;
      for (let k = k0; dAng > 0 ? k <= k1 : k >= k1; k += kStep) {
        const ang = k * step;
        const f = (ang - tA) / dAng;
        emit(T0, f0, P0, bottomAt(ang), f);
        T0 = [A[0] + hx * f, wallBot, A[2] + hz * f];
        f0 = f;
        P0 = bottomAt(ang);
      }
    }
    emit(T0, f0, P0, bottomAt(tEnd), 1);
  }
  // Lakes: water discs flush on the cap, rims following the voxel
  // shoreline to the column (no perfect circles — the ±2-block noise and
  // the teeth are the visible shape at swap range). Overlapping lakes
  // lift a hair per index (2 mm steps — sub-pixel everywhere) instead of
  // coplanar-fighting. A 2-block rock skirt ring hangs under each rim
  // (flat radial normals, like voxel risers): sunlit on one side, shaded
  // on the other, so lakes read even where albedos match.
  lakes.forEach(({ cx, cz }, li) => {
    const ly = capY + 0.03 + li * 0.002;
    const rim = [];
    for (let i = 0; i < LAKE_SEGMENTS; i++) {
      rim.push(lakeRimPoint(spec, seed, lakes, cx, cz, (i / LAKE_SEGMENTS) * Math.PI * 2));
    }
    for (let i = 0; i < LAKE_SEGMENTS; i++) {
      const a0 = (i / LAKE_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / LAKE_SEGMENTS) * Math.PI * 2;
      const p0 = [rim[i][0], ly, rim[i][1]], p1 = [rim[(i + 1) % LAKE_SEGMENTS][0], ly, rim[(i + 1) % LAKE_SEGMENTS][1]];
      pushTri(waterOut,
        [cx, ly, cz], p1, p0, [0, 1, 0],
        [cx, cz], [p1[0], p1[2]], [p0[0], p0[2]]);
      // Skirt: vertical wall under the rim, normals facing the lake
      // interior (visible from above through the shaft opening).
      // Winding (P0, B0, B1)/(P0, B1, P1) reads counter-clockwise from
      // the center, i.e. FrontSide toward the interior.
      const am = (a0 + a1) / 2;
      const n = [-Math.cos(am), 0, -Math.sin(am)];
      const inset = 0.06;
      const q0 = [p0[0] - Math.cos(a0) * inset, ly, p0[2] - Math.sin(a0) * inset];
      const q1 = [p1[0] - Math.cos(a1) * inset, ly, p1[2] - Math.sin(a1) * inset];
      const b0 = [q0[0], ly - SKIRT_DROP, q0[2]], b1 = [q1[0], ly - SKIRT_DROP, q1[2]];
      const uq0 = [a0 * 8, 0], uq1 = [a1 * 8, 0];
      pushTri(rockOut, q0, b0, b1, n,
        [uq0[0], ly], [uq0[0], b0[1]], [uq1[0], b1[1]]);
      pushTri(rockOut, q0, b1, q1, n,
        [uq0[0], ly], [uq1[0], b1[1]], [uq1[0], q1[1]]);
    }
  });
  return { rock: rockOut, dome: domeOut, water: waterOut };
}
