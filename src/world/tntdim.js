// TNT dimension: clouds-only cube over the overworld XZ footprint.
// One tier per cloud (all TNT or all MEGA_TNT, no ultra — its band radius
// covers the whole level and can never be isolated). Clouds reuse the
// overworld puff math (ellipsoid clusters) in compact form, scattered in 3D.
//
// Core rule: no TNT blast may reach another TNT cloud. Worst-case mega pool
// radius caps at 40 (see fx/tnt.js megaPoolRadius), normal blasts reach 3 —
// so the pairwise edge gap must exceed 40 for any mega-involved pair and 3
// for normal–normal pairs, plus a tier-split per-pair margin from the seed
// hash (flat 1% for mega-involved pairs, 5–20% for normal–normal). The generator enforces this constructively (a candidate center is
// only accepted when it clears every accepted cloud); a post-fill voxel
// sweep throws on any violation, and the headless harness re-asserts the
// rule per seed. Clouds sit as close as the rule allows: spacing uses each
// cloud's own bounding radius, not a global worst case.
import { TNT, MEGA_TNT } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import {
  WORLD_RADIUS, setBlock, getBlock, setDimension, resetWorld,
} from "../core/store.js";

export const TNT_MIN_Y = 1;
export const TNT_MAX_Y = 192;
// Largest blast radius that can touch a neighbour cloud, per pair tiers.
// Mega pools cap at 40 and chain normals caught in the blast, so any
// mega-involved pair needs 40; normal–normal pairs only need 3.
export function blastIsolationNeed(tierA, tierB) {
  return (tierA === MEGA_TNT || tierB === MEGA_TNT) ? 40 : 3;
}
// Per-pair safety margin: mega-involved pairs take a flat 1% (tight,
// consistent packing around megas); normal–normal pairs draw 5–20% from
// the seed hash (order-independent: sorted orders, so generator and
// verifier agree) for sparser red fill.
const MARGIN_SALT = 6337;
export function pairMargin(seed, orderA, orderB, megaInvolved) {
  if (megaInvolved) return 0.01;
  const lo = Math.min(orderA, orderB), hi = Math.max(orderA, orderB);
  return 0.05 + hash2(lo, hi, seed + MARGIN_SALT) * 0.15;
}
// Two-phase scatter: a few megas placed sparsely first (each sterilizes a
// 40+ zone), then regular clouds fill every remaining safe pocket — they only
// need 3+margin from each other, so they pack an order of magnitude denser.
export const TNT_MEGA_COUNT = 8;
export const TNT_MEGA_CANDIDATES = 400;
export const TNT_NORMAL_TARGET = 80;
export const TNT_NORMAL_CANDIDATES = 6000;

// Pale dusty-rose sky the red TNT always reads dark against, at every
// distance; blue mega pops, the cream band partially washes (accepted).
// No space fade: black sky and stars are overworld-private, so the TNT sky
// stays rose at every altitude.
export const TNT_ENV = {
  sky: 0xcaa08f,
  space: false,
  fogNear: 20,
  fogFar: 150,
  sun: 0xfff5e0,
  sunI: 1.1,
  hemiSky: 0xe8c8b8,
  hemiGround: 0x4a2c22,
  hemiI: 0.7,
};

// Cloud records for spawn + headless assertions (center + tier + top +
// measured bounding radius + acceptance order).
let clouds = [];
export function tntClouds() {
  return clouds;
}



// Shared puff layout: one place computes it, placement and the analytical
// bounding radius both consume it, so spacing math can never drift from the
// voxels it spaces. Exported for the infinite streaming lattice, which
// places the same puffs without the legacy cube clips.
export function puffParams(cx, cy, cz, salt) {
  const out = [];
  const puffs = 2 + Math.floor(hash2(cx, cz, salt) * 2);
  const spread = 1 + hash2(cx, cy, salt + 1) * 2.5;
  for (let p = 0; p < puffs; p++) {
    const ox = (hash2(cx, p, salt + 11) * 2 - 1) * spread;
    const oz = (hash2(cz, p, salt + 22) * 2 - 1) * spread;
    const oy = (hash2(cy, p, salt + 33) - 0.5) * spread * 0.5;
    const ra = 1 + Math.round(1 + hash2(cx + Math.round(ox), p, salt + 44) * 2);
    const rb = 1 + Math.round(1 + hash2(cz + Math.round(oz), p, salt + 55) * 2);
    const rh = 1 + Math.round(hash2(cy + Math.round(oy), p, salt + 66) * 1.5);
    out.push({ ox, oz, oy, ra, rb, rh });
  }
  return out;
}

// Analytical bound: no placed block sits farther than this from the center.
// Blocks land at round(offset) + cell with |cell| <= ceil(radius), so each
// axis reaches |offset| + 0.5 + ceil(radius); +1 covers the rest.
export function cloudRadius(cx, cy, cz, salt) {
  let ex = 0, ey = 0, ez = 0;
  for (const p of puffParams(cx, cy, cz, salt)) {
    ex = Math.max(ex, Math.abs(p.ox) + 0.5 + Math.ceil(p.ra));
    ey = Math.max(ey, Math.abs(p.oy) + 0.5 + Math.ceil(p.rh));
    ez = Math.max(ez, Math.abs(p.oz) + 0.5 + Math.ceil(p.rb));
  }
  return Math.sqrt(ex * ex + ey * ey + ez * ez) + 1;
}

// Largest possible bounding radius over all salts: the puff sizes and the
// spread are bounded above, so the lattice can prove isolation from the
// cell size alone without measuring every cloud. Puff counts 2..3, spread
// <= 3.5, per-axis |offset| <= 3.5, radii <= 4 (xz) / <= 3 (y): ex,ez <= 8,
// ey <= 5.25, so r <= sqrt(64 + 27.6 + 64) + 1 < 13.5.
export const CLOUD_R_MAX = 14;

// Clip-free cloud placement: the same puffs as placeCloud, but voxels roam
// the full key range (infinite dimensions). Returns { top, r } like above.
// `onBlock` receives every written [x, y, z] (eviction recomputes the same
// set) — null skips the callback.
export function placeCloudAt(cx, cy, cz, id, salt, onBlock = null) {
  let top = -Infinity, topX = cx, topZ = cz, r = 0;
  for (const p of puffParams(cx, cy, cz, salt)) {
    const Px = cx + Math.round(p.ox);
    const Pz = cz + Math.round(p.oz);
    const Py = cy + Math.round(p.oy);
    const mx = Math.ceil(p.ra), mz = Math.ceil(p.rb), my = Math.ceil(p.rh);
    for (let dx = -mx; dx <= mx; dx++)
      for (let dz = -mz; dz <= mz; dz++)
        for (let dy = -my; dy <= my; dy++) {
          if (dx * dx / (p.ra * p.ra) + dz * dz / (p.rb * p.rb) + dy * dy / (p.rh * p.rh) > 1) continue;
          const x = Px + dx, y = Py + dy, z = Pz + dz;
          setBlock(x, y, z, id);
          if (onBlock) onBlock(x, y, z);
          if (y > top) { top = y; topX = x; topZ = z; }
          const d = Math.hypot(x - cx, y - cy, z - cz);
          if (d > r) r = d;
        }
  }
  return { top, topX, topZ, r };
}

function placeCloud(cx, cy, cz, id, salt) {
  let top = -Infinity, r = 0;
  for (const p of puffParams(cx, cy, cz, salt)) {
    const Px = cx + Math.round(p.ox);
    const Pz = cz + Math.round(p.oz);
    const Py = cy + Math.round(p.oy);
    const mx = Math.ceil(p.ra), mz = Math.ceil(p.rb), my = Math.ceil(p.rh);
    for (let dx = -mx; dx <= mx; dx++)
      for (let dz = -mz; dz <= mz; dz++)
        for (let dy = -my; dy <= my; dy++) {
          if (dx * dx / (p.ra * p.ra) + dz * dz / (p.rb * p.rb) + dy * dy / (p.rh * p.rh) > 1) continue;
          const x = Px + dx, y = Py + dy, z = Pz + dz;
          if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS) continue;
          if (y < TNT_MIN_Y || y > TNT_MAX_Y) continue;
          setBlock(x, y, z, id);
          if (y > top) top = y;
          const d = Math.hypot(x - cx, y - cy, z - cz);
          if (d > r) r = d;
        }
  }
  return { top, r };
}

// Greedy 3D scatter for one tier: accept a candidate only when its edge gap
// to every accepted cloud clears the pair's blast need plus its tier-split
// margin.
// The salt stays a pure function of the final order, so the analytical
// radius used here always matches the voxels placed later.
function scatterTier(seed, tier, count, candidates, saltBase, accepted) {
  for (let pass = 0; pass < 4 && accepted.length < count; pass++) {
    const base = saltBase + pass * 7919;
    for (let i = 0; i < candidates && accepted.length < count; i++) {
      const ls = base + i * 17;
      const cx = Math.round((hash2(i, 1, ls) * 2 - 1) * (WORLD_RADIUS - 16));
      const cz = Math.round((hash2(i, 2, ls) * 2 - 1) * (WORLD_RADIUS - 16));
      const cy = 24 + Math.floor(hash2(i, 5, ls) * (168 - 24));
      const order = accepted.length;
      const salt = seed + 5511 + order * 101;
      const r = cloudRadius(cx, cy, cz, salt);
      let ok = true;
      for (const c of accepted) {
        const need = blastIsolationNeed(tier, c.tier) * (1 + pairMargin(seed, order, c.order, tier === MEGA_TNT || c.tier === MEGA_TNT));
        const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
        if (Math.hypot(dx, dy, dz) - (r + c.r) < need) { ok = false; break; }
      }
      if (ok) accepted.push({ x: cx, y: cy, z: cz, order, tier, salt, r });
    }
  }
  return accepted;
}

// Megas first (few, sparse), then regulars fill every safe pocket — they only
// need 3+margin from each other, so the cube ends up densely packed with TNT.
function pickCenters(seed) {
  const accepted = [];
  scatterTier(seed, MEGA_TNT, TNT_MEGA_COUNT, TNT_MEGA_CANDIDATES, seed + 9182, accepted);
  scatterTier(seed, TNT, TNT_MEGA_COUNT + TNT_NORMAL_TARGET, TNT_NORMAL_CANDIDATES, seed + 27791, accepted);
  return accepted;
}

function setupTnt(newSeed) {
  setDimension("tnt");
  resetWorld("tnt");
  return newSeed;
}

// Post-fill backstop for the core rule: re-checks every pair on measured
// voxel radii. Throws loudly — a violation must never ship silently.
function verifyIsolation(seed) {
  for (let i = 0; i < clouds.length; i++) {
    for (let j = i + 1; j < clouds.length; j++) {
      const a = clouds[i], b = clouds[j];
      const need = blastIsolationNeed(a.tier, b.tier) * (1 + pairMargin(seed, a.order, b.order, a.tier === MEGA_TNT || b.tier === MEGA_TNT));
      const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - (a.r + b.r);
      if (gap < need) {
        throw new Error(
          `tnt isolation violated: clouds ${a.order}/${b.order} gap ${gap.toFixed(2)} < need ${need.toFixed(2)}`);
      }
    }
  }
}

function fillTnt(seed) {
  clouds = [];
  for (const c of pickCenters(seed)) {
    const { top, r } = placeCloud(c.x, c.y, c.z, c.tier, c.salt);
    if (top > -Infinity) clouds.push({ ...c, top, r });
  }
  if (clouds.length < 2) console.warn(`tnt: only ${clouds.length} cloud(s) for seed ${seed}`);
  else verifyIsolation(seed);
  return clouds;
}

export function generateTntDimension(newSeed) {
  setupTnt(newSeed);
  fillTnt(newSeed);
}

export async function generateTntDimensionAsync(newSeed, isAborted) {
  setupTnt(newSeed);
  // Centers are cheap; slice the cloud placements so entry never freezes.
  clouds = [];
  const centers = pickCenters(newSeed);
  for (let idx = 0; idx < centers.length; idx++) {
    const c = centers[idx];
    const { top, r } = placeCloud(c.x, c.y, c.z, c.tier, c.salt);
    if (top > -Infinity) clouds.push({ ...c, top, r });
    if (idx % 4 === 3) {
      if (isAborted && isAborted()) return false;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  if (clouds.length < 2) {
    console.warn(`tnt: only ${clouds.length} cloud(s) for seed ${newSeed}`);
  } else verifyIsolation(newSeed);
  if (isAborted && isAborted()) return false;
  return true;
}

// Spawn: stand on the first regular-TNT cloud near the volume center.
// Clouds-only world: no ground search, no vista, no pen — footing is TNT.
// The center column itself may be air (puffs are offset), so the top is
// found by scanning a small footprint around the center for TNT with
// two blocks of headroom.
export function findTntSpawn() {
  const regs = clouds.filter((c) => c.tier === TNT);
  const ordered = [...regs, ...clouds.filter((c) => c.tier !== TNT)]
    .sort((a, b) => (Math.abs(a.x) + Math.abs(a.z)) - (Math.abs(b.x) + Math.abs(b.z)));
  for (const c of ordered) {
    for (let y = Math.min(c.top + 2, TNT_MAX_Y); y > TNT_MIN_Y; y--) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (getBlock(c.x + dx, y, c.z + dz) !== TNT) continue;
          if (getBlock(c.x + dx, y + 1, c.z + dz) !== 0) continue;
          if (getBlock(c.x + dx, y + 2, c.z + dz) !== 0) continue;
          return { x: c.x + dx, y, z: c.z + dz, yaw: Math.atan2(-c.x, -c.z) };
        }
      }
    }
  }
  return { x: 0, y: 96, z: 0, yaw: 0 };
}

export const __test = { pickCenters, blastIsolationNeed, pairMargin, cloudRadius };
