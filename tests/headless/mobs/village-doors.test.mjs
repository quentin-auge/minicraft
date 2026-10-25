// Village doorway passability: houses sit on sloped terrain while walls
// start at the village height, so levelHouse must level every sill, apron,
// and interior floor to vy with 3-high headroom — on every seed, even with
// an adversarial slope. placeVillage runs on injected voxel maps (no
// overworld, no scene); terrain fill is simulated by pre-filling stone to
// the stub heights, like the overworld fill does.
import assert from "node:assert/strict";
import { AIR, STONE, LOG, BLOCK_INFO } from "../../../src/core/blocks.js";
import { village, computeLayout, placeVillage } from "../../../src/world/village.js";

// Adversarial slope across any village site (±3 over a house footprint).
const slopeHeight = (x, z) => 14 + Math.floor(x / 3) + Math.floor(z / 4);

function floorAt(get, x, vy, z) {
  for (let y = vy; y >= 0; y--) {
    if (BLOCK_INFO[get(x, y, z)]?.solid) return y;
  }
  return -1;
}

for (const seed of [7, 99, 1234, 55555]) {
  const vox = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  const setBlock = (x, y, z, id) => {
    if (id === AIR) vox.delete(k(x, y, z));
    else vox.set(k(x, y, z), id);
  };
  const getBlock = (x, y, z) => vox.get(k(x, y, z)) ?? AIR;
  computeLayout(seed, slopeHeight);
  const { y: vy } = village.center;
  // Simulate the overworld terrain fill: stone up to the stub height.
  for (let x = village.minX - 4; x <= village.maxX + 4; x++) {
    for (let z = village.minZ - 4; z <= village.maxZ + 4; z++) {
      const h = slopeHeight(x, z);
      for (let y = 0; y <= h; y++) setBlock(x, y, z, STONE);
    }
  }
  placeVillage(setBlock, getBlock);
  assert.ok(village.houses.length > 0, `seed ${seed}: houses placed`);
  for (const h of village.houses) {
    assert.equal(h.vy, vy, `seed ${seed} house ${h.id}: village height`);
    const doorCells = [[h.d0x, h.d0z], [h.d1x, h.d1z]];
    for (const [dx, dz] of doorCells) {
      assert.equal(floorAt(getBlock, dx, vy, dz), vy,
        `seed ${seed} house ${h.id}: sill level at (${dx},${dz})`);
      for (let i = 1; i <= 2; i++) {
        const ax = dx + h.doorNx * i, az = dz + h.doorNz * i;
        const inOther = village.houses.some((o) =>
          o !== h && ax >= o.minX && ax <= o.maxX && az >= o.minZ && az <= o.maxZ);
        if (inOther) continue;
        assert.equal(floorAt(getBlock, ax, vy, az), vy,
          `seed ${seed} house ${h.id}: apron level at (${ax},${az})`);
      }
      for (let y = vy + 1; y <= vy + 3; y++) {
        assert.ok(!BLOCK_INFO[getBlock(dx, y, dz)]?.solid,
          `seed ${seed} house ${h.id}: door headroom at (${dx},${y},${dz})`);
      }
    }
    // Interior floor level (mobs never step up).
    for (let x = h.minX + 1; x <= h.maxX - 1; x++) {
      for (let z = h.minZ + 1; z <= h.maxZ - 1; z++) {
        const inOther = village.houses.some((o) =>
          o !== h && x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ);
        if (inOther) continue;
        assert.equal(floorAt(getBlock, x, vy, z), vy,
          `seed ${seed} house ${h.id}: interior floor at (${x},${z})`);
      }
    }
    // Wall rings stay intact: leveling must never punch holes (own walls
    // and neighbours alike — every house is checked).
    const win = h.doorNz !== 0
      ? [h.cx, h.doorNz === -1 ? h.maxZ : h.minZ]
      : [(h.doorNx === 1 ? h.minX : h.maxX), h.cz];
    const isDoor = (x, z) => (x === h.d0x && z === h.d0z) || (x === h.d1x && z === h.d1z);
    for (let x = h.minX; x <= h.maxX; x++) {
      for (let z = h.minZ; z <= h.maxZ; z++) {
        if (!(x === h.minX || x === h.maxX || z === h.minZ || z === h.maxZ)) continue;
        for (let y = vy + 1; y <= vy + 4; y++) {
          if (isDoor(x, z) && y <= vy + 3) continue;
          if (x === win[0] && z === win[1] && y === vy + 2) continue;
          assert.ok(getBlock(x, y, z) !== AIR,
            `seed ${seed} house ${h.id}: wall kept at (${x},${y},${z})`);
        }
      }
    }
  }
  // Pen ring intact wherever no house apron was allowed near it.
  if (village.pen) {
    const p = village.pen;
    for (let x = p.minX; x <= p.maxX; x++) {
      for (const z of [p.minZ, p.maxZ]) {
        const nearHouse = village.houses.some((h) =>
          x >= h.minX - 2 && x <= h.maxX + 2 && z >= h.minZ - 2 && z <= h.maxZ + 2);
        if (nearHouse) continue;
        assert.equal(getBlock(x, p.vy + 1, z), LOG, `seed ${seed}: pen post at (${x},${z})`);
      }
    }
  }
}
console.log("village-doors.test.mjs: ALL PASS");
