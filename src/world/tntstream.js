// Infinite TNT sky: a deterministic 3D cell lattice streamed around the
// player. Every cloud center is a pure function of (cell, entry seed), so
// evicted cells regenerate identically and nothing is stored per cell —
// only a small resident set of what is currently materialized.
//
// Layout (proved in the module, not hoped):
// - Normal lattice: pitch 48, one cloud per cell, center jitter ±6, always
//   normal TNT. Neighbouring centers sit >= 36 apart; with the largest
//   possible cloud radius (14, see CLOUD_R_MAX) the edge gap is >= 8,
//   clearing the normal-normal need (3 + 20% margin = 3.6) by construction.
// - Mega lattice: aligned pitch 96 (2x2x2 normal cells), one mega per
//   super-cell that rolls under MEGA_PROB (1.0 = every super-cell, the
//   structural maximum), jitter ±4, except the spawn's own super-cell
//   (origin hole). Neighbouring megas sit >= 88 apart for an
//   edge gap >= 60, clearing the mega need (40 + 1% = 40.4).
// - Mega-normal pairs are checked explicitly: each normal candidate is
//   measured against the deterministic mega centers of its 27 neighbouring
//   super-cells (recomputed, never stored) with the same blastIsolationNeed
//   + pairMargin pair rule as the legacy cube; conflicts re-jitter twice,
//   then the cell stays a hole.
// - Sky-grapple synth clouds and any later deterministic cloud check each
//   other through the resident set, so the core rule (no blast may reach
//   another cloud) holds without any global pass. The legacy O(n^2)
//   verifyIsolation stays a test-only backstop over sampled neighborhoods.
import { TNT, MEGA_TNT } from "../core/blocks.js";
import { hash2 } from "../core/noise.js";
import {
  dim, setDimension, resetWorld, getBlock, setBlock, chunkOf, CHUNK, TNT_RENDER_DIST,
} from "../core/store.js";
import {
  placeCloudAt, cloudRadius, blastIsolationNeed, pairMargin, CLOUD_R_MAX, TNT_ENV,
} from "./tntdim.js";
import { dimSpec } from "./dimensions.js";
import { clearTNTBox } from "../fx/tnt.js";

export const TNT_CELL = 48;
export const TNT_MEGA_PITCH = 96; // 2x2x2 normal cells, aligned
// Generation horizon is twice the fog distance (derived, not magic: retunes
// track automatically) — every cloud that could show through the fog always
// exists, so the sky reads pre-existing from every angle and speed.
export const TNT_GEN_R = 2 * TNT_ENV.fogFar;
export const TNT_EVICT_R = TNT_GEN_R + 2 * TNT_CELL;
export const TNT_EVICT_DELAY_MS = 15000; // wall clock: eviction is loading
// Entry pre-fill covers the mesh horizon ((8+3) chunk rings), sliced.
export const TNT_PREFILL_R = TNT_RENDER_DIST * CHUNK;
// Per-tick generation budget: enough cells to outpace a full sprint, cheap
// enough to never hitch (far cells cost voxels only — their chunks are
// unbuilt, so the mesher refresh no-ops). Sized for 2x-gravity dives.
export const TNT_GEN_PER_TICK = 4;
export const TNT_GEN_MS = 5;
// Fall shaft: extra cells straight down per tick while diving (the sphere
// scan already covers below, but the fall line deserves its own budget so
// peripheral misses never starve arrival space).
export const TNT_SHAFT_PER_TICK = 3;
export const TNT_SKY_GRAPPLE_MAX = 800;

const NORMAL_JITTER = 6;
const MEGA_JITTER = 4;

let streamSeed = 0;
// Resident cells: key -> { cx, cy, cz, tier, salt, top, r, hole, synth, seen }.
const resident = new Map();
// Player-pinned cells (edits, portal frames): never evicted within a visit.
const pinned = new Set();

const cellKey = (ix, iy, iz) => ix + "," + iy + "," + iz;

export function setTntStreamSeed(s) {
  streamSeed = s;
}
export function residentCount() {
  return resident.size;
}
export { resident };
export function resetTntStream() {
  resident.clear();
  pinned.clear();
}
export function pinTntCellAt(x, y, z) {
  pinned.add(cellKey(Math.floor(x / TNT_CELL), Math.floor(y / TNT_CELL), Math.floor(z / TNT_CELL)));
}

// Deterministic salt per cell (eviction recomputes the identical cloud).
function saltFor(ix, iy, iz) {
  const n = streamSeed * 31 + ix * 104729 + iy * 1299709 + iz * 15485863;
  return ((n % 2147483647) + 2147483647) % 2147483647;
}
function jitter(h, amt) {
  return (h * 2 - 1) * amt;
}

// Raw normal center (no conflict check): base + hash jitter.
function rawNormal(ix, iy, iz) {
  const s = saltFor(ix, iy, iz);
  return {
    cx: Math.round(ix * TNT_CELL + TNT_CELL / 2 + jitter(hash2(ix, iy, s + 1), NORMAL_JITTER)),
    cy: Math.round(iy * TNT_CELL + TNT_CELL / 2 + jitter(hash2(iy, iz, s + 2), NORMAL_JITTER)),
    cz: Math.round(iz * TNT_CELL + TNT_CELL / 2 + jitter(hash2(ix, iz, s + 3), NORMAL_JITTER)),
    tier: TNT,
    salt: s,
  };
}

// Mega super-cell of a normal cell (pitches align: super = cell / 2, floored).
function superOf(ix, iy, iz) {
  return [Math.floor(ix / 2), Math.floor(iy / 2), Math.floor(iz / 2)];
}
// Origin hole: the spawn's own super-cell stays mega-free so the spawn
// cloud usually places first try; neighbours may still hole it on unlucky
// seeds (see findTntStreamSpawn's hunt). Kept to one cell — a wider hole
// would swallow the whole spawn fog sphere.
function isOriginSuper(sx, sy, sz) {
  return sx === 0 && sy === 0 && sz === 0;
}
// Mega rarity rate (tune 0..1): fraction of super-cells carrying a mega,
// deterministic per entry seed. 1.0 fills every eligible super-cell — the
// structural maximum under the 96-pitch proof (~16 megas per fog sphere
// typically, ~125 in the gen sphere). Lower values trade megas for
// surviving reds: every mega sterilizes ~20 normal cells (40-blast core
// rule), so 0.2 reads as rare blue accents (~3/sphere), 0.5 as ~8, 0.7 as
// ~11 typical, and 1.0 flips the sky mega-dominated with only a handful
// of normals surviving (~1% of cells). Mega-mega isolation is structural at any rate
// (neighbors sit >= 88 apart for an edge gap >= 60 vs 40.4 needed);
// mega-normal pairs resolve through explicit checks plus holes.
export const MEGA_PROB = 0.6;
function rawMega(sx, sy, sz) {
  if (isOriginSuper(sx, sy, sz)) return null;
  const s = saltFor(sx * 2, sy * 2, sz * 2) + 5011;
  if (hash2(sx, sy, s + 9) >= MEGA_PROB) return null;
  return {
    cx: Math.round(sx * TNT_MEGA_PITCH + TNT_MEGA_PITCH / 2 + jitter(hash2(sx, sy, s + 1), MEGA_JITTER)),
    cy: Math.round(sy * TNT_MEGA_PITCH + TNT_MEGA_PITCH / 2 + jitter(hash2(sy, sz, s + 2), MEGA_JITTER)),
    cz: Math.round(sz * TNT_MEGA_PITCH + TNT_MEGA_PITCH / 2 + jitter(hash2(sx, sz, s + 3), MEGA_JITTER)),
    tier: MEGA_TNT,
    salt: s,
  };
}

function edgeGap(a, rA, b, rB) {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy, a.cz - b.cz) - (rA + rB);
}
// Pair rule, same shape as the legacy cube: need + tier-split margin (flat
// 1% mega-involved, 5-20% normal-normal). Salts stand in for orders here
// (sorted, so generator and verifier agree without a global order).
function pairNeed(tierA, saltA, rA, tierB, saltB, rB, ax, ay, az, bx, by, bz) {
  const need = blastIsolationNeed(tierA, tierB) * (1 + pairMargin(streamSeed, saltA, saltB, tierA === MEGA_TNT || tierB === MEGA_TNT));
  return Math.hypot(ax - bx, ay - by, az - bz) - (rA + rB) < need;
}

// Normal center with mega conflicts resolved: re-jitter twice, else hole.
function normalCenterFor(ix, iy, iz) {
  const [sx, sy, sz] = superOf(ix, iy, iz);
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = saltFor(ix, iy, iz) + attempt * 7919;
    const c = {
      cx: Math.round(ix * TNT_CELL + TNT_CELL / 2 + jitter(hash2(ix, iy, s + 1), NORMAL_JITTER)),
      cy: Math.round(iy * TNT_CELL + TNT_CELL / 2 + jitter(hash2(iy, iz, s + 2), NORMAL_JITTER)),
      cz: Math.round(iz * TNT_CELL + TNT_CELL / 2 + jitter(hash2(ix, iz, s + 3), NORMAL_JITTER)),
      tier: TNT,
      salt: s,
    };
    const rN = cloudRadius(c.cx, c.cy, c.cz, s);
    let ok = true;
    for (let ax = sx - 1; ax <= sx + 1 && ok; ax++) {
      for (let ay = sy - 1; ay <= sy + 1 && ok; ay++) {
        for (let az = sz - 1; az <= sz + 1 && ok; az++) {
          const m = rawMega(ax, ay, az);
          if (!m) continue;
          const rM = cloudRadius(m.cx, m.cy, m.cz, m.salt);
          if (pairNeed(TNT, s, rN, MEGA_TNT, m.salt, rM, c.cx, c.cy, c.cz, m.cx, m.cy, m.cz)) ok = false;
        }
      }
    }
    // Resident synth clouds (sky-grapple pads): explicit check both ways.
    if (ok) {
      for (let ox = -1; ox <= 1 && ok; ox++) {
        for (let oy = -1; oy <= 1 && ok; oy++) {
          for (let oz = -1; oz <= 1 && ok; oz++) {
            const r = resident.get(cellKey(ix + ox, iy + oy, iz + oz));
            if (!r || r.hole || r.synth !== true) continue;
            if (pairNeed(TNT, s, rN, r.tier, r.salt, r.r, c.cx, c.cy, c.cz, r.cx, r.cy, r.cz)) ok = false;
          }
        }
      }
    }
    if (ok) return { ...c, r: rN };
  }
  return null;
}

// Full center decision for a cell: mega first (skip on synth conflict),
// then normal (null = hole). Deterministic except for resident synths,
// which are player-caused content anyway.
function centerForCell(ix, iy, iz) {
  const [sx, sy, sz] = superOf(ix, iy, iz);
  const m = rawMega(sx, sy, sz);
  // One mega per super-cell: only the super-cell's lowest normal cell places
  // it (super spans 2x2x2 normal cells; cell (even,even,even) owns it).
  if (m && ix % 2 === 0 && iy % 2 === 0 && iz % 2 === 0) {
    const rM = cloudRadius(m.cx, m.cy, m.cz, m.salt);
    let ok = true;
    for (let ox = -1; ox <= 1 && ok; ox++) {
      for (let oy = -1; oy <= 1 && ok; oy++) {
        for (let oz = -1; oz <= 1 && ok; oz++) {
          const r = resident.get(cellKey(ix + ox, iy + oy, iz + oz));
          if (!r || r.hole || r.synth !== true) continue;
          if (pairNeed(MEGA_TNT, m.salt, rM, r.tier, r.salt, r.r, m.cx, m.cy, m.cz, r.cx, r.cy, r.cz)) ok = false;
        }
      }
    }
    if (ok) return { ...m, r: rM };
  }
  return normalCenterFor(ix, iy, iz);
}

// Materialize one cell: place voxels, record the resident entry, collect one
// sample block per touched render chunk. `out` gathers the samples for a
// batched refresh (one remesh per tick, not per cell); `refresh` keeps the
// immediate single-cell behavior for boot/spawn/grapple paths.
function ensureTntCellInto(ix, iy, iz, out) {
  const k = cellKey(ix, iy, iz);
  if (resident.has(k)) return false;
  const c = centerForCell(ix, iy, iz);
  if (!c) {
    resident.set(k, { hole: true, seen: performance.now() });
    return false;
  }
  const placed = placeCloudAt(c.cx, c.cy, c.cz, c.tier, c.salt, (x, y, z) => {
    const ck = chunkOf(x) + "," + chunkOf(z);
    if (!out.has(ck)) out.set(ck, [x, y, z]);
  });
  resident.set(k, { ...c, top: placed.top, topX: placed.topX, topZ: placed.topZ, r: placed.r, synth: false, seen: performance.now() });
  return true;
}
export function ensureTntCell(ix, iy, iz, refresh) {
  const chunks = new Map();
  const made = ensureTntCellInto(ix, iy, iz, chunks);
  if (refresh && made && chunks.size) refresh([...chunks.values()]);
  return made;
}

// Drop one resident cell: recompute its voxels as AIR from the resident
// record (never re-derive — the record is the truth), clear queued fuses.
function evictCell(k, r, refresh) {
  const chunks = new Map();
  placeCloudAt(r.cx, r.cy, r.cz, 0, r.salt, (x, y, z) => {
    const ck = chunkOf(x) + "," + chunkOf(z);
    if (!chunks.has(ck)) chunks.set(ck, [x, y, z]);
  });
  resident.delete(k);
  const x0 = r.cx - CLOUD_R_MAX - 1, x1 = r.cx + CLOUD_R_MAX + 1;
  const y0 = r.cy - CLOUD_R_MAX - 1, y1 = r.cy + CLOUD_R_MAX + 1;
  const z0 = r.cz - CLOUD_R_MAX - 1, z1 = r.cz + CLOUD_R_MAX + 1;
  clearTNTBox(x0, y0, z0, x1, y1, z1);
  if (refresh && chunks.size) refresh([...chunks.values()]);
}

// Cell offsets walk nearest-first (precomputed once, sorted by length).
const OFFSETS = (() => {
  const n = Math.ceil((TNT_EVICT_R + TNT_CELL) / TNT_CELL);
  const out = [];
  for (let dx = -n; dx <= n; dx++) {
    for (let dy = -n; dy <= n; dy++) {
      for (let dz = -n; dz <= n; dz++) {
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len * TNT_CELL <= TNT_EVICT_R + TNT_CELL) out.push([dx, dy, dz, len]);
      }
    }
  }
  out.sort((a, b) => a[3] - b[3]);
  return out;
})();

// Streaming tick: generate nearest-missing cells under the per-tick budget
// and evict far, long-unseen cells (two per tick). Loader-exempt wall clock —
// eviction hides behind the fog either way. `refresh` is refreshBlocks;
// `pin` is an optional {ix,iy,iz} cell (hook anchor) that never evicts.
// `speed` (blocks/s) scales the cell cap: a 2x-gravity dive (80 b/s)
// sweeps new cells into the 2x-fog sphere at ~205/s, so the cap tracks
// demand = pi*R^2*v/cell^3 per second and the ms budget stays the backstop.
// Touched chunks batch into one refresh per tick. `vy` (signed vertical
// velocity) drives the fall shaft below.
export function tickTntStream(px, py, pz, dt, speed, vy, refresh, pin) {
  if (!dimSpec(dim)?.infinite) return;
  const pcx = Math.floor(px / TNT_CELL), pcy = Math.floor(py / TNT_CELL), pcz = Math.floor(pz / TNT_CELL);
  const now = performance.now();
  const t0 = now;
  // Cells/s entering the sphere at this speed, converted to a per-tick cap
  // (floor 4: the old flat budget, plenty at rest).
  const cap = Math.max(TNT_GEN_PER_TICK, Math.ceil(Math.PI * TNT_GEN_R * TNT_GEN_R * speed * dt / (TNT_CELL * TNT_CELL * TNT_CELL)));
  const batched = new Map();
  let made = 0;
  for (const [dx, dy, dz, len] of OFFSETS) {
    if (len * TNT_CELL > TNT_GEN_R + TNT_CELL) break;
    const k = cellKey(pcx + dx, pcy + dy, pcz + dz);
    const r = resident.get(k);
    if (!r) {
      if (ensureTntCellInto(pcx + dx, pcy + dy, pcz + dz, batched)) made++;
      // Budget: outpace the fall without hitching — the next tick restarts
      // nearest-first, so no hole ever jumps the queue.
      if (made >= cap || performance.now() - t0 > TNT_GEN_MS) break;
      continue;
    }
    r.seen = now;
  }
  // Fall shaft: a 2x-gravity dive (80 b/s) eats arrival space faster than
  // the sphere scan prioritizes it directionally — extend a 3x3 shaft below
  // the player to GEN_R + |vy|*3s. Same cells and logic as the sphere (the
  // resident set dedups the overlap); its own small budget so peripheral
  // misses never starve the fall line, and seen stays fresh so the shaft
  // outlives the 15 s evict delay while diving.
  if (vy < -15 && performance.now() - t0 <= TNT_GEN_MS) {
    const depth = TNT_GEN_R + Math.min(480, -vy * 3);
    const kMax = Math.ceil(depth / TNT_CELL);
    let shaftMade = 0;
    for (let k = 1; k <= kMax && shaftMade < TNT_SHAFT_PER_TICK; k++) {
      if (performance.now() - t0 > TNT_GEN_MS) break;
      for (let ox = -1; ox <= 1 && shaftMade < TNT_SHAFT_PER_TICK; ox++) {
        for (let oz = -1; oz <= 1 && shaftMade < TNT_SHAFT_PER_TICK; oz++) {
          const kk = cellKey(pcx + ox, pcy - k, pcz + oz);
          const rr = resident.get(kk);
          if (!rr) {
            if (ensureTntCellInto(pcx + ox, pcy - k, pcz + oz, batched)) { made++; shaftMade++; }
          } else rr.seen = now;
        }
      }
    }
  }
  if (refresh && batched.size) refresh([...batched.values()]);
  let n = 0;
  for (const [k, r] of resident) {
    if (r.hole) continue;
    if (pinned.has(k)) continue;
    if (pin && k === cellKey(pin.ix, pin.iy, pin.iz)) continue;
    const d = Math.hypot(r.cx - px, r.cy - py, r.cz - pz) - (r.r ?? 0);
    if (d > TNT_EVICT_R && now - r.seen > TNT_EVICT_DELAY_MS) {
      evictCell(k, r, refresh);
      if (++n >= 2) break;
    }
  }
}

// Standable top for a placed record: the recorded top block usually has
// headroom already; otherwise search a small neighborhood (same footing
// rule as the legacy spawn: TNT with two blocks of headroom).
function scanCloudTop(rec) {
  const cands = [[rec.topX, rec.top, rec.topZ]];
  for (let r = 1; r <= 10 && cands.length < 40; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let dy = 0; dy >= -6; dy--) cands.push([rec.topX + dx, rec.top + dy, rec.topZ + dz]);
      }
    }
  }
  for (const [x, y, z] of cands) {
    const id = getBlock(x, y, z);
    if (id !== TNT && id !== MEGA_TNT) continue;
    if (getBlock(x, y + 1, z) !== 0) continue;
    if (getBlock(x, y + 2, z) !== 0) continue;
    return { x, y, z };
  }
  return null;
}

// Spawn: the origin cell (0,1,0) usually holds a normal cloud (its own
// super-cell is mega-free and neighbours usually clear it), but on unlucky
// seeds a nearby mega holes it — so hunt expanding cell offsets for the
// first non-hole cloud with a standable top instead of assuming. The
// hardcoded point stays the final fallback.
export function findTntStreamSpawn(refresh) {
  for (let r = 0; r <= 2; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
          ensureTntCell(dx, 1 + dy, dz, refresh);
          const rec = resident.get(cellKey(dx, 1 + dy, dz));
          if (rec && !rec.hole) {
            const s = scanCloudTop(rec);
            if (s) return { ...s, yaw: 0 };
          }
        }
      }
    }
  }
  return { x: 24, y: 72, z: 24, yaw: 0 };
}

// Sky-grapple target: a point along the aim ray at distance D in
// [minD, maxD]. Prefer an existing deterministic cloud top near the ray;
// otherwise synthesize one small normal cloud (checked against every
// deterministic neighbour, registered resident so later cells see it).
// Returns a block-pick descriptor or null (grapple fizzles, as before).
export function skyGrappleTarget(eye, dir, minD, maxD, refresh) {
  const pick = hash2(Math.round(eye.x * 7 + dir.x * 131), Math.round(eye.z * 7 + dir.z * 131) + Math.round(eye.y), streamSeed + 9301);
  const D = minD + pick * Math.max(0, maxD - minD);
  const px = eye.x + dir.x * D, py = eye.y + dir.y * D, pz = eye.z + dir.z * D;
  const ccx = Math.floor(px / TNT_CELL), ccy = Math.floor(py / TNT_CELL), ccz = Math.floor(pz / TNT_CELL);
  // Snap: nearest raw center (normal or mega) within 60 of the ray point.
  // Megas snap to their owner cell (only even cells place a super-cell's
  // mega); the scan below follows the placed record either way.
  let snap = null, snapD = 60;
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let oz = -1; oz <= 1; oz++) {
        const ix = ccx + ox, iy = ccy + oy, iz = ccz + oz;
        const n = rawNormal(ix, iy, iz);
        if (n) {
          const d = Math.hypot(n.cx - px, n.cy - py, n.cz - pz);
          if (d < snapD) { snap = { cell: [ix, iy, iz] }; snapD = d; }
        }
        const [sx, sy, sz] = superOf(ix, iy, iz);
        const m = rawMega(sx, sy, sz);
        if (m) {
          const d = Math.hypot(m.cx - px, m.cy - py, m.cz - pz);
          if (d < snapD) { snap = { cell: [sx * 2, sy * 2, sz * 2] }; snapD = d; }
        }
      }
    }
  }
  if (snap) {
    // The snapped raw center may not be what the cell places (mega
    // ownership, conflict re-jitter), so scan the placed record — the
    // lattice guarantees it sits near the aim point anyway.
    ensureTntCell(snap.cell[0], snap.cell[1], snap.cell[2], refresh);
    const rec = resident.get(cellKey(snap.cell[0], snap.cell[1], snap.cell[2]));
    if (rec && !rec.hole) {
      const s = scanCloudTop(rec);
      if (s) return { kind: "block", x: s.x, y: s.y, z: s.z, id: getBlock(s.x, s.y, s.z), face: [0, 1, 0] };
    }
  }
  // Synthesize: small normal cloud at the ray point, rejection-sampled
  // against deterministic neighbours (growing lateral nudges — hole cells
  // sit next to megas, so the first tries may sit inside a mega's isolation
  // zone and need to walk out of it).
  const NUDGE = [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20], [40, 0], [-40, 0], [0, 40]];
  const salt = saltFor(ccx, ccy, ccz) + 97777;
  for (let attempt = 0; attempt < NUDGE.length; attempt++) {
    const sx = Math.round(px + NUDGE[attempt][0]);
    const sz = Math.round(pz + NUDGE[attempt][1]);
    const c = { cx: sx, cy: Math.round(py), cz: sz, tier: TNT, salt: salt + attempt };
    const rS = cloudRadius(sx, py, sz, c.salt);
    let ok = true;
    for (let ox = -1; ox <= 1 && ok; ox++) {
      for (let oy = -1; oy <= 1 && ok; oy++) {
        for (let oz = -1; oz <= 1 && ok; oz++) {
          const ix = ccx + ox, iy = ccy + oy, iz = ccz + oz;
          for (const n of [rawNormal(ix, iy, iz), rawMega(...superOf(ix, iy, iz))]) {
            if (!n) continue;
            const rN = cloudRadius(n.cx, n.cy, n.cz, n.salt);
            if (pairNeed(c.tier, c.salt, rS, n.tier, n.salt, rN, sx, py, sz, n.cx, n.cy, n.cz)) { ok = false; break; }
          }
          if (!ok) break;
          const r = resident.get(cellKey(ix, iy, iz));
          if (r && !r.hole && pairNeed(c.tier, c.salt, rS, r.tier, r.salt, r.r, sx, py, sz, r.cx, r.cy, r.cz)) ok = false;
        }
      }
    }
    if (!ok) continue;
    const k = cellKey(ccx, ccy, ccz);
    const chunks = new Map();
    const placed = placeCloudAt(sx, Math.round(py), sz, TNT, c.salt, (x, y, z) => {
      const ck = chunkOf(x) + "," + chunkOf(z);
      if (!chunks.has(ck)) chunks.set(ck, [x, y, z]);
    });
    resident.set(k, { cx: sx, cy: Math.round(py), cz: sz, tier: TNT, salt: c.salt, top: placed.top, topX: placed.topX, topZ: placed.topZ, r: placed.r, synth: true, seen: performance.now() });
    if (refresh && chunks.size) refresh([...chunks.values()]);
    const s = scanCloudTop(placed);
    if (s) return { kind: "block", x: s.x, y: s.y, z: s.z, id: getBlock(s.x, s.y, s.z), face: [0, 1, 0] };
    return null;
  }
  // Last resort: the nearest mega (the very cloud whose isolation zone
  // rejected the synth above) is always landable — ride it instead, via
  // its owner cell like the snap above.
  let far = null, farD = 150;
  const scx = Math.floor(px / TNT_MEGA_PITCH), scy = Math.floor(py / TNT_MEGA_PITCH), scz = Math.floor(pz / TNT_MEGA_PITCH);
  for (let ox = -2; ox <= 2; ox++) {
    for (let oy = -2; oy <= 2; oy++) {
      for (let oz = -2; oz <= 2; oz++) {
        const m = rawMega(scx + ox, scy + oy, scz + oz);
        if (!m) continue;
        const d = Math.hypot(m.cx - px, m.cy - py, m.cz - pz);
        if (d < farD) { far = { m, sx: scx + ox, sy: scy + oy, sz: scz + oz }; farD = d; }
      }
    }
  }
  if (far) {
    const cell = [far.sx * 2, far.sy * 2, far.sz * 2];
    ensureTntCell(cell[0], cell[1], cell[2], refresh);
    const rec = resident.get(cellKey(cell[0], cell[1], cell[2]));
    if (rec && !rec.hole) {
      const s = scanCloudTop(rec);
      if (s) return { kind: "block", x: s.x, y: s.y, z: s.z, id: getBlock(s.x, s.y, s.z), face: [0, 1, 0] };
    }
  }
  return null;
}

// Entry boot: fresh seed, empty maps, mesh-horizon pre-fill in slices. The
// spawn neighborhood (and everything displayable) exists before play; the
// tick only chases movement from there. Slice-yielded like the legacy cube
// path so entry never hitches; aborts on token change.
export async function bootTntStream(seed, abort) {
  setDimension("tnt");
  resetWorld("tnt");
  setTntStreamSeed(seed);
  resetTntStream();
  let n = 0;
  for (const [dx, dy, dz, len] of OFFSETS) {
    if (len * TNT_CELL > TNT_PREFILL_R) break;
    if (abort && abort()) return false;
    ensureTntCell(dx, dy, dz, null);
    if (++n % 8 === 7) await new Promise((r) => requestAnimationFrame(r));
  }
  return true;
}

export const __test = {
  centerForCell, rawNormal, rawMega, superOf, cellKey, saltFor,
  setTntStreamSeed, resetTntStream, resident, ensureTntCell, OFFSETS,
  evictCellAt(ix, iy, iz) {
    const k = cellKey(ix, iy, iz);
    const r = resident.get(k);
    if (r && !r.hole) evictCell(k, r, null);
  },
};
