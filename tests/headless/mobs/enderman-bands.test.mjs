// Enderman staged picker with a relaxation ladder, world bands, and the
// pre-contact dodge. Three-free (endspots only: no THREE, no scene) —
// plain `node` direct, deterministic injected rand/probes.
import assert from "node:assert/strict";
import { bandOf, pickSpot, shouldDodge, teleportReady, armTeleportCool, sphereExclude, blastPredicates } from "../../../src/mobs/endspots.js";

// --- world bands: feet-Y decides, teleports never change it before L4 ---
assert.equal(bandOf("over", 64), "ground");
assert.equal(bandOf("over", 99.9), "ground");
assert.equal(bandOf("over", 100), "clouds");
assert.equal(bandOf("over", 460), "clouds");
assert.equal(bandOf("over", 460.1), "none");
assert.equal(bandOf("over", 849.9), "none");
assert.equal(bandOf("over", 850), "moon");
assert.equal(bandOf("over", 1200), "moon");
assert.equal(bandOf("nether", 12), "level");
assert.equal(bandOf("nether", 90), "level");
assert.equal(bandOf("end", 1), "platform");
assert.equal(bandOf("tnt", 100), "clouds");
assert.equal(bandOf("tnt", 0.5), "clouds");
assert.equal(bandOf("void", 64), "none");

const spotOf = (r) => (r.spot ? { x: r.spot.x, y: r.spot.y, z: r.spot.z } : null);

// --- staged picker: flat ground world, deterministic rand ---
// rand 0: shuffled order starts at DIRS16[1] (π/8), first distance d = 5.
const flat = {
  dim: "over", band: "ground", from: { x: 30, y: 64, z: 30 },
  hw: 0.25, h: 2.2,
  groundY: () => 64,
  free: () => true,
  supported: () => true,
  mobBlocked: () => false,
  inBounds: (x, z) => Math.abs(x) <= 94 && Math.abs(z) <= 94,
  inView: () => true,
  los: () => true,
  rand: () => 0,
};
// First candidate wins the draw (r = 0): (32, 35), 5.6 out, same band, L0.
const flatRes = pickSpot(flat);
assert.deepEqual(spotOf(flatRes), { x: 32, y: 64, z: 35 });
assert.equal(flatRes.level, 0);

// --- last candidate wins when the draw runs to the end ---
// Constant rand ≈ 1: identity order, max distances, draw takes the last.
const tail = { ...flat, rand: () => 0.9999 };
const tailRes = pickSpot(tail);
assert.deepEqual(spotOf(tailRes), { x: 26, y: 64, z: 39 });
assert.equal(tailRes.level, 0);

// --- stage 1: the inner ring reads void, the 10–15 ring answers ---
const ringed = { ...flat, groundY: (x, z) => (Math.hypot(x - 30, z - 30) >= 10 ? 64 : null) };
const ringedRes = pickSpot(ringed);
assert.deepEqual(spotOf(ringedRes), { x: 34, y: 64, z: 41 });
assert.equal(ringedRes.level, 0);

// --- stage 2: surface 6 up needs the raised height ceiling ---
const high = { ...flat, groundY: () => 70 };
const highRes = pickSpot(high);
assert.deepEqual(spotOf(highRes), { x: 34, y: 70, z: 39 });
assert.equal(highRes.level, 0);

// --- far flat ring: the search widens until ground reads again ---
const far = { ...flat, groundY: (x, z) => (Math.hypot(x - 30, z - 30) >= 15 ? 64 : null) };
const farRes = pickSpot(far);
assert.deepEqual(spotOf(farRes), { x: 36, y: 64, z: 44 });
assert.equal(farRes.level, 0);

// --- overhead cover is skipped: the column top reads a cloud deck, but the
// plaza floor 12 below validates once the height window covers it ---
const deck = {
  ...flat, from: { x: 30, y: 34, z: 30 },
  groundY: (x, z, yHi) => (Math.abs(22 - 34) <= yHi ? 22 : null),
};
const deckRes = pickSpot(deck);
assert.deepEqual(spotOf(deckRes), { x: 36, y: 22, z: 44 });
assert.equal(deckRes.level, 0);

// --- R1: player hugging the mob, ground only nearby ---
// Every near candidate is inside 10 m and the far field reads void, so
// rung 0 dies on the standoff; rung 1 (standoff dropped, view + LoS kept)
// lands at (32, 35): a visible same-room spot beats every invisible one.
const hugged = {
  ...flat,
  player: { x: 30, z: 30 },
  groundY: (x, z) => (Math.hypot(x - 30, z - 30) >= 10 ? null : 64),
};
const huggedRes = pickSpot(hugged);
assert.deepEqual(spotOf(huggedRes), { x: 32, y: 64, z: 35 });
assert.equal(huggedRes.level, 1);
assert.ok(huggedRes.stats.near > 0);

// --- R2: nothing in view at all, the frustum gate drops (LoS kept) ---
const blind = { ...flat, inView: () => false };
const blindRes = pickSpot(blind);
assert.deepEqual(spotOf(blindRes), { x: 32, y: 64, z: 35 });
assert.equal(blindRes.level, 2);
assert.ok(blindRes.stats.view > 0);

// --- R3: out of view AND line-of-sight blocked, the LoS gate drops ---
// Rungs 0–2 die on view then LoS; rung 3 lands at (32, 35): an occluded
// spot only wins once no sight-clear spot exists at any range.
const blindNoLos = { ...flat, inView: () => false, los: () => false };
const blindNoLosRes = pickSpot(blindNoLos);
assert.deepEqual(spotOf(blindNoLosRes), { x: 32, y: 64, z: 35 });
assert.equal(blindNoLosRes.level, 3);
assert.ok(blindNoLosRes.stats.view > 0);
assert.ok(blindNoLosRes.stats.los > 0);

// --- R4: the only footing sits in another band ---
// From y = 99 (ground), the sole surface is a cloud deck at 105: rungs 0–3
// die on the band gate, rung 4 takes it.
const cloudbound = {
  ...flat, from: { x: 30, y: 99, z: 30 },
  groundY: () => 105,
};
const cloudRes = pickSpot(cloudbound);
assert.deepEqual(spotOf(cloudRes), { x: 34, y: 105, z: 39 });
assert.equal(cloudRes.level, 4);
assert.ok(cloudRes.stats.band > 0);

// --- R5: no column reads at all, the last-resort spiral lands adjacent ---
const novel = pickSpot({ ...flat, groundY: () => null, kmax: 0 });
assert.deepEqual(spotOf(novel), { x: 30, y: 64, z: 31 });
assert.equal(novel.level, 5);

// --- true void: nothing to stand on anywhere, stay in place ---
const voided = pickSpot({ ...flat, groundY: () => null, free: () => false, supported: () => false, kmax: 0 });
assert.equal(voided.spot, null);
assert.equal(voided.level, null);

// --- near stages sample dense: 16 bearings × 3 distances per stage ---
// (Covered implicitly above: the (32,35)-style first hits are the diagonal
// half-wind samples, impossible on an 8-wind grid.)

// --- no-mob arrival: a blocked column is skipped, the ring walks on ---
// Everything within 5 m of (34,34) reads occupied; (37,30) is the first
// free stage-0 candidate.
const crowded = {
  ...flat,
  mobBlocked: (x, y, z) => Math.hypot(x - 34, z - 34) < 5,
};
const crowdedRes = pickSpot(crowded);
assert.deepEqual(spotOf(crowdedRes), { x: 37, y: 64, z: 30 });
assert.ok(crowdedRes.stats.mob > 0);
assert.equal(crowdedRes.level, 0);

// --- two endermen side by side: bodies clear, arrival allowed ---
const nearEnderman = {
  ...flat,
  mobBlocked: (x, y, z, hw, h) => {
    const o = { x: 36, z: 34, hw: 0.25, y: 64, h: 2.2 };
    return x + hw > o.x - o.hw && x - hw < o.x + o.hw &&
      z + hw > o.z - o.hw && z - hw < o.z + o.hw &&
      y + h > o.y && y < o.y + o.h;
  },
};
const nearRes = pickSpot(nearEnderman);
assert.deepEqual(spotOf(nearRes), { x: 32, y: 64, z: 35 });
assert.equal(nearRes.level, 0);

// --- the player keeps a 10 m standoff: near ring reads void for him ---
// Player at (34,64,34) staring from the south: everything inside 10 m is
// refused, (36,24) at 10.2 m is the first valid stage-0 candidate.
const stared = { ...flat, player: { x: 34, z: 34 } };
const staredRes = pickSpot(stared);
assert.deepEqual(spotOf(staredRes), { x: 36, y: 64, z: 24 });
assert.ok(staredRes.stats.near > 0);
assert.equal(staredRes.level, 0);

// --- retry gate: a failed attempt cools the mob down ---
const mob = {};
assert.equal(teleportReady(mob, 100), true);
armTeleportCool(mob, 100);
assert.equal(teleportReady(mob, 100), false);
assert.equal(teleportReady(mob, 101.4), false);
assert.equal(teleportReady(mob, 101.5), true);

// --- dodge: neutral-anatomy self, farm-shaped peer ---
const self = {
  pos: { x: 0, y: 64, z: 0 }, yaw: 0, hw: 0.25,
  nose: { along: 0, r: 0 }, tail: { along: 0, r: 0 },
  alive: true, dim: "over", type: "enderman", speed: 0,
};
const peer = (x, z, yaw, speed, extra = {}) => ({
  pos: { x, y: 64, z }, yaw, hw: 0.32,
  nose: { along: 0.2, r: 0.2 }, tail: { along: -0.2, r: 0.2 },
  alive: true, dim: "over", type: "pig", speed, ...extra,
});

// far + static: nothing
assert.deepEqual(shouldDodge({ self, peers: [peer(5, 5, Math.PI, 0)] }), { dodge: false, immediate: false });
// on top: immediate contact
assert.deepEqual(shouldDodge({ self, peers: [peer(0, 0.5, Math.PI, 2)] }), { dodge: true, immediate: true });
// closing inside the horizon: dodge just before contact
assert.deepEqual(shouldDodge({ self, peers: [peer(0, 2.5, Math.PI, 4)] }), { dodge: true, immediate: false });
// walking away: nothing (gap opens)
assert.deepEqual(shouldDodge({ self, peers: [peer(0, 2.5, 0, 4)] }), { dodge: false, immediate: false });
// foreign dim, holder rank, dragon kind, other level: never trigger
assert.deepEqual(shouldDodge({ self, peers: [peer(0, 0.5, Math.PI, 4, { dim: "nether" })] }), { dodge: false, immediate: false });
assert.deepEqual(shouldDodge({ self, peers: [peer(0, 0.5, Math.PI, 4)], mobRank: () => 4 }), { dodge: false, immediate: false });
assert.deepEqual(shouldDodge({ self, peers: [peer(0, 0.5, Math.PI, 4, { type: "dragon" })] }), { dodge: false, immediate: false });
assert.deepEqual(shouldDodge({ self, peers: [{ ...peer(0, 0.5, Math.PI, 4), pos: { x: 0, y: 66, z: 0.5 } }] }), { dodge: false, immediate: false });

// --- dodge: the player runs on velocity, gated like a mob ---
assert.deepEqual(
  shouldDodge({ self, peers: [], player: { x: 0, y: 64, z: 2, vx: 0, vz: -4 }, playerHw: 0.3 }),
  { dodge: true, immediate: false },
);
assert.deepEqual(
  shouldDodge({ self, peers: [], player: { x: 0, y: 64, z: 2, vx: 0, vz: 0 }, playerHw: 0.3 }),
  { dodge: false, immediate: false },
);
assert.deepEqual(
  shouldDodge({ self, peers: [], player: { x: 0, y: 64, z: 30, vx: 0, vz: -4 }, playerHw: 0.3 }),
  { dodge: false, immediate: false },
);

console.log("enderman-bands: all PASS");

// --- crater exclusion: blast geometry bans arrivals, never relaxed ---
// Closed ball on the mid-body (same convention as the pool union).
const crater = sphereExclude([{ x: 0, y: 60, z: 0, r: 15 }]);
assert.equal(crater(0.5, 63, 0.5), true, 'feet under the sphere read inside');
assert.equal(crater(20.5, 63, 0.5), false, 'past the rim reads outside');
assert.equal(crater(15.5, 59.5, 0.5), true, 'closed ball: the rim itself is banned');
// The picker lands outside the crater and counts the rejections.
const cratered = {
  ...flat,
  from: { x: 0, y: 64, z: 0 },
  exclude: sphereExclude([{ x: -8, y: 60, z: 0, r: 15 }]),
};
const craterRes = pickSpot(cratered);
assert.ok(craterRes.spot, 'an excluded neighbourhood still lands');
assert.equal(cratered.exclude(craterRes.spot.x, craterRes.spot.y, craterRes.spot.z), false,
  'the winning spot sits outside the crater');
assert.ok((craterRes.stats.crater ?? 0) > 0, 'crater rejections counted');
// Fully excluded world: even the R5 spiral finds nothing — a clean fail,
// never a crater arrival.
const voidedCrater = pickSpot({ ...flat, exclude: () => true });
assert.equal(voidedCrater.spot, null, 'total exclusion fails instead of landing inside');
assert.equal(voidedCrater.level, null, 'total exclusion wins no rung');
assert.ok(voidedCrater.stats.crater > 0, 'spiral rejections counted as crater');

console.log("enderman-bands crater: all PASS");

// --- blast descriptors: trigger and landing derive from one geometry ---
{
  // Balls: the caught set IS the carved void — bystanders stay put.
  const p = blastPredicates({ spheres: [{ x: 0, y: 60, z: 0, r: 15 }] });
  assert.equal(p.caught(0.5, 63, 0.5), true, 'inside the union is caught');
  assert.equal(p.caught(20.5, 63, 0.5), false, 'outside the union is a bystander');
  assert.equal(p.exclude(0.5, 63, 0.5), true, 'arrivals avoid the carved void');
  assert.equal(p.exclude(20.5, 63, 0.5), false, 'arrivals allow intact ground');
}
{
  // Wiped band: feet in range are caught (the new floor at y = 1 too — it
  // re-places locally), arrivals need no exclusion (voxels are final).
  const p = blastPredicates({ yLo: 1, yHi: 90 });
  assert.equal(p.caught(0, 64, 0), true, 'band feet are caught');
  assert.equal(p.caught(0, 1, 0), true, 'new-floor feet are caught');
  assert.equal(p.caught(0, 120, 0), false, 'feet above the band are bystanders');
  assert.equal(p.exclude, null, 'band arrivals read final voxels, no exclusion');
  const open = blastPredicates({ yLo: 101, yHi: null });
  assert.equal(open.caught(0, 500, 0), true, 'open top catches everything above');
  assert.equal(open.caught(0, 64, 0), false, 'below the band stays put');
}

console.log("enderman-bands blast descriptors: all PASS");

// --- post-wipe placement: ultra teleports fire once voxels are final, so
// the probes alone land on what remains — no exclusion needed ---
// Ground-band wipe: the new floor (feet y = 1) wins the first ring, same band.
{
  const wipedGround = {
    ...flat,
    from: { x: 0, y: 1, z: 0 },
    groundY: () => 1,
  };
  const res = pickSpot(wipedGround);
  assert.ok(res.spot, 'wiped ground band still lands');
  assert.equal(res.spot.y, 1, 'the new floor wins');
  assert.equal(res.level, 0, 'first ring, no relaxation');
}
// Window wipe with a surviving platform (End shape): same band, shuffle.
{
  const remains = {
    dim: 'end', band: 'platform', from: { x: 0, y: 72, z: 0 },
    hw: 0.25, h: 2.2,
    groundY: (x, z) => (Math.abs(x) <= 36 && Math.abs(z) <= 36 ? 71 : null),
    free: () => true,
    supported: () => true,
    mobBlocked: () => false,
    inBounds: (x, z) => Math.abs(x) <= 36 && Math.abs(z) <= 36,
    inView: () => true,
    los: () => true,
    rand: () => 0,
  };
  const res = pickSpot(remains);
  assert.ok(res.spot, 'surviving platform still lands');
  assert.ok(Math.abs(res.spot.x) <= 36 && Math.abs(res.spot.z) <= 36, 'shuffle stays on the platform');
}
// Window wipe with nothing left: clean fail, never a void arrival.
{
  const gone = {
    dim: 'end', band: 'platform', from: { x: 0, y: 72, z: 0 },
    hw: 0.25, h: 2.2,
    groundY: () => null,
    free: () => false,
    supported: () => false,
    mobBlocked: () => false,
    inBounds: (x, z) => Math.abs(x) <= 36 && Math.abs(z) <= 36,
    inView: () => true,
    los: () => true,
    rand: () => 0,
  };
  const res = pickSpot(gone);
  assert.equal(res.spot, null, 'total wipe fails instead of landing in the void');
}

console.log("enderman-bands post-wipe: all PASS");
