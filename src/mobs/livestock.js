// Farm-livestock specs and pen-spawn policy, three-free (headless-testable).
// Visuals (farm.js) build meshes from LIVESTOCK_SPECS; movement dispatches
// on the registry capability flags (walk + float for pigs and cows).
// Anticipated kinds reuse the same shape: chicken/wolf/cat add jump,
// fish swaps walk+float for swim, birds add fly.
import { AIR, LOG, BLOCK_INFO } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";

export const PIG_COUNT = 4;
export const COW_COUNT = 4;
// Float rule: 2/3 of the body out of the water — the submerged fraction of
// the body height below the liquid surface (master used 1/2).
export const MOB_FLOAT_FRAC = 1 / 3;
export const FARM_WALK_DIVISOR = 2.2;

// Quadruped body plan, in body-length units straight from master's pig/cow
// builders: a new farm animal is data here, never a builder fork.
export const LIVESTOCK_SPECS = {
  pig: {
    hw: 0.32, h: 0.92, drop: 1,
    body: { size: [0.86, 0.62, 1.16], at: [0, 0.6, 0] },
    head: { size: [0.52, 0.52, 0.46], at: [0, 0.76, 0.68] },
    snout: { size: [0.3, 0.2, 0.14], at: [0, 0.68, 0.94] },
    eyes: { size: [0.08, 0.08, 0.02], at: [[-0.16, 0.86, 0.92], [0.16, 0.86, 0.92]] },
    legs: { size: [0.22, 0.34, 0.22], at: [[-0.3, 0.17, -0.38], [0.3, 0.17, -0.38], [-0.3, 0.17, 0.38], [0.3, 0.17, 0.38]] },
    tail: { kind: "coil", at: [0, 0.66, -0.58], segs: 5 },
    colors: { body: 0xf2aeb2, leg: 0x8f5a5e, snout: 0xd98286 },
  },
  cow: {
    hw: 0.32, h: 1.3, drop: 1,
    body: { size: [0.9, 0.72, 1.26], at: [0, 0.78, 0] },
    spots: [
      { size: [0.28, 0.02, 0.32], at: [0.12, 1.15, -0.18] },
      { size: [0.22, 0.02, 0.26], at: [-0.18, 1.15, 0.24] },
    ],
    head: { size: [0.56, 0.56, 0.48], at: [0, 0.96, 0.74] },
    snout: { size: [0.32, 0.18, 0.14], at: [0, 0.84, 1.0] },
    nostrils: { size: [0.06, 0.06, 0.02], at: [[-0.08, 0.84, 1.08], [0.08, 0.84, 1.08]] },
    horns: { size: [0.08, 0.14, 0.08], at: [[-0.28, 1.18, 0.68], [0.28, 1.18, 0.68]] },
    eyes: { size: [0.08, 0.08, 0.02], at: [[-0.18, 1.04, 0.99], [0.18, 1.04, 0.99]] },
    legs: { size: [0.24, 0.46, 0.24], at: [[-0.32, 0.23, -0.42], [0.32, 0.23, -0.42], [-0.32, 0.23, 0.42], [0.32, 0.23, 0.42]] },
    tail: { kind: "strand", at: [0, 1.02, -0.63] },
    colors: { body: 0xf5f0eb, spot: 0x3b342f, leg: 0x6b5a48, snout: 0xde9aa0 },
  },
};

// Body circles derived from the visual spec: core half-width plus nose
// and tail circles placed along the body axis (so the mover and the
// separation pass cover the protruding head and tail without widening
// the flanks), and the top of the highest part (so headroom covers
// heads and horns, not just the body box). Pure and headless-testable.
const CIRCLE_PARTS = ["body", "head", "snout", "eyes", "nostrils", "horns", "legs", "spots"];
// Rearward slack for the tail group origin: exact for backward tails
// (pig coil), a conservative overestimate for hanging ones (cow strand)
// — stopping earlier near walls behind is always the safe direction.
const TAIL_BACK_EXTRA = 0.3;
export function specCircles(spec) {
  const hw = spec.hw ?? 0.3;
  let top = spec.h ?? 1, front = hw, back = -hw, noseW = 0;
  for (const k of CIRCLE_PARTS) {
    const p = spec[k];
    if (!p || !p.size || !p.at) continue;
    const ats = Array.isArray(p.at[0]) ? p.at : [p.at];
    for (const a of ats) {
      front = Math.max(front, a[2] + p.size[2] / 2);
      back = Math.min(back, a[2] - p.size[2] / 2);
      top = Math.max(top, a[1] + p.size[1] / 2);
      if (k === "head" || k === "snout") noseW = Math.max(noseW, p.size[0] / 2);
    }
  }
  if (spec.tail?.at) back = Math.min(back, spec.tail.at[2] - TAIL_BACK_EXTRA);
  const noseR = Math.min(hw, noseW || hw);
  const tailR = Math.min(hw * 0.7, 0.22);
  return { hw, h: top, nose: { along: front - noseR, r: noseR }, tail: { along: back + tailR, r: tailR } };
}

// World seed for deterministic pen draws. Movements wander freely; only the
// spawn layout is seeded so worlds reproduce.
let farmSeed = 1;
let farmDraw = 0;
export function setFarmSeed(s) {
  farmSeed = s | 0;
  farmDraw = 0;
}
const farmHash = (a, b, salt) => hash2(a | 0, b | 0, farmSeed + salt);

const isSolidId = (id) => !!BLOCK_INFO[id]?.solid;

// Strict pen-interior test: inside the fence ring, never on the fence wall,
// never in the trough water, never on the trough rim. (x, z) are feet coords.
export function isStrictPenCell(pen, x, z, cellAt) {
  const bx = Math.floor(x), bz = Math.floor(z);
  if (bx < pen.minX + 1 || bx > pen.maxX - 1 || bz < pen.minZ + 1 || bz > pen.maxZ - 1) return false;
  const q = pen.pool;
  if (q && bx >= q.minX && bx <= q.maxX + 1 && bz >= q.minZ && bz <= q.maxZ + 1) return false;
  if (!isSolidId(cellAt(bx, pen.vy, bz))) return false;
  if (cellAt(bx, pen.vy + 1, bz) !== AIR) return false;
  if (cellAt(bx, pen.vy + 2, bz) !== AIR) return false;
  return true;
}

// The fence ring is intact while every edge cell still holds its LOG post.
export function penIntact(pen, cellAt) {
  for (let x = pen.minX; x <= pen.maxX; x++) {
    if (cellAt(x, pen.vy + 1, pen.minZ) !== LOG) return false;
    if (cellAt(x, pen.vy + 1, pen.maxZ) !== LOG) return false;
  }
  for (let z = pen.minZ + 1; z <= pen.maxZ - 1; z++) {
    if (cellAt(pen.minX, pen.vy + 1, z) !== LOG) return false;
    if (cellAt(pen.maxX, pen.vy + 1, z) !== LOG) return false;
  }
  return true;
}

// Deterministic pen layout: PIG_COUNT + COW_COUNT feet spots (.5-centered),
// strictly inside, pairwise separated. cellAt(x, y, z) is injected so the
// headless world-gen check runs this with no scene and no store import.
export function pickPenSpawns(pen, cellAt) {
  const total = PIG_COUNT + COW_COUNT;
  const spots = [];
  const w = pen.maxX - pen.minX - 1, d = pen.maxZ - pen.minZ - 1;
  for (let i = 0; i < total; i++) {
    let pick = null;
    for (let t = 0; t < 40 && !pick; t++) {
      const rx = pen.minX + 1 + farmHash(farmDraw++, t, 5101) * w;
      const rz = pen.minZ + 1 + farmHash(farmDraw++, t, 5102) * d;
      const sx = Math.floor(rx) + 0.5, sz = Math.floor(rz) + 0.5;
      if (!isStrictPenCell(pen, sx, sz, cellAt)) continue;
      if (spots.some(([ox, oz]) => (ox - sx) ** 2 + (oz - sz) ** 2 < 1.5)) continue;
      pick = [sx, sz];
    }
    if (!pick) {
      outer: for (let bz = pen.minZ + 1; bz <= pen.maxZ - 1; bz++)
        for (let bx = pen.minX + 1; bx <= pen.maxX - 1; bx++) {
          const sx = bx + 0.5, sz = bz + 0.5;
          if (!isStrictPenCell(pen, sx, sz, cellAt)) continue;
          if (spots.some(([ox, oz]) => (ox - sx) ** 2 + (oz - sz) ** 2 < 1.5)) continue;
          pick = [sx, sz];
          break outer;
        }
    }
    if (pick) spots.push(pick);
  }
  return spots;
}

// Legal-step predicate for non-jumping walkers: never up, down at most
// maxDrop (per mob type; jumpers will add stepUp/jumpV beside it). A deeper
// drop is a vertical air wall — impassable like solid, treated as such by
// the mover. Pure and headless-testable.
export function dropAllowed(fromY, groundY, maxDrop) {
  return groundY <= fromY + 1e-3 && fromY - groundY <= maxDrop + 1e-3;
}

// Buoyancy target: 2/3 of the body above the liquid surface.
export function floatTargetY(surfaceTop, h) {
  return surfaceTop - h * MOB_FLOAT_FRAC;
}
