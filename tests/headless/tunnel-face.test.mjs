// Flat lava face at each tunnel's inner end (Nether): the walkway ends on
// the tunnel-frame plane — every uncontested face-slice cell reads lava
// strictly behind the plane over a dry rock sill, open walkway plus rock
// sill/lintel ahead of it (flat on cardinal headings, regular
// crenellation on diagonals, never lava on the ground). Shaft columns are
// never touched: inside the lava cylinder the mouth follows the natural
// rock relief. Cells claimed by another tube defer to it (the shared
// crater chamber merges bores by design), so contested cells only assert
// survival, never content. Pins the voxel contract of squareInnerFace
// (src/world/nether.js) without three.js.
import assert from "node:assert/strict";
import { AIR, LAVA, NETHERRACK } from "../../src/core/blocks.js";
import { getBlock } from "../../src/core/store.js";
import { generateNetherDimension, __test } from "../../src/world/nether.js";

generateNetherDimension(7);
const tunnels = __test.tunnels;
assert.ok(tunnels.length >= 20, `expected both volcanoes sited, got ${tunnels.length}`);

// Ownership mirror of squareInnerFace's clearOf: "air" for another tube's
// walkway/corridor (sacrosanct airspace), "masonry" for its shell rock or
// any frame cell, null when the face owns the cell outright.
function contested(t, x, y, z) {
  for (const u of tunnels) {
    if (u === t) continue;
    if (__test.tubeInteriorAt(u, x, y, z) || __test.tubeCorridorAt(u, x, y, z)) return "air";
  }
  for (const u of tunnels) {
    if (u === t) continue;
    if (__test.tubeShellAt(u, x, y, z)) return "masonry";
  }
  if (__test.ringCells.has(x + "," + y + "," + z)) return "masonry";
  return null;
}

let faces = 0, owned = 0, deferred = 0;
for (const t of tunnels) {
  const { v, plat, dPlane } = t;
  assert.ok(Number.isFinite(dPlane), "face plane derived at siting");
  let lava = 0, open = 0;
  for (let wx = t.bounds.x0; wx <= t.bounds.x1; wx++) {
    for (let wz = t.bounds.z0; wz <= t.bounds.z1; wz++) {
      const rx = wx - v.x, rz = wz - v.z;
      if (rx * rx + rz * rz <= v.craterR * v.craterR) continue;
      const d = rx * t.dx + rz * t.dz;
      if (Math.abs(d - dPlane) > 1.5) continue;
      const f = rx * t.mx + rz * t.mz + 4;
      if (f < 0 || f >= 8) continue;
      const behind = d < dPlane;
      // Dry sill across the whole slice, both sides: never lava on the ground.
      {
        const c = contested(t, wx, plat, wz);
        if (!c) { owned++; assert.equal(getBlock(wx, plat, wz), NETHERRACK, `dry sill at ${wx},${plat},${wz}`); }
        else deferred++;
      }
      if (behind) {
        for (let y = plat + 1; y <= plat + 8; y++) {
          const c = contested(t, wx, y, wz);
          if (!c) { owned++; assert.equal(getBlock(wx, y, wz), LAVA, `face lava at ${wx},${y},${wz}`); }
          else deferred++;
          lava++;
        }
      } else {
        for (let y = plat + 1; y <= plat + 6; y++) {
          const c = contested(t, wx, y, wz);
          const cur = getBlock(wx, y, wz);
          if (!c) { owned++; assert.equal(cur, AIR, `walkway open at ${wx},${y},${wz}`); }
          else { deferred++; assert.ok(cur === AIR || cur === LAVA || cur === NETHERRACK, `deferred walkway survives at ${wx},${y},${wz}`); }
        }
        open++;
        for (let y = plat + 7; y <= plat + 8; y++) {
          const c = contested(t, wx, y, wz);
          if (!c) { owned++; assert.equal(getBlock(wx, y, wz), NETHERRACK, `lintel at ${wx},${y},${wz}`); }
          else deferred++;
        }
      }
    }
  }
  assert.ok(lava > 0, "face has lava cells");
  assert.ok(open > 0, "face has open walkway cells");
  faces++;
}
assert.equal(faces, tunnels.length, "every tunnel ends on a flat face");
console.log(`ALL TUNNEL-FACE PASS (${faces} faces, ${owned} owned cells, ${deferred} deferred)`);
