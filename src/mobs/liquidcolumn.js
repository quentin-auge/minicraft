// Liquid-column regime: lateral entry into ground-level liquid walls and
// columns, rise to the top, cruise at (or under) the surface, and leave
// through a shore hop or a free air fall. Three-free and headless-testable:
// plain {pos, yaw, hw, h, nose, tail} reads, voxel reads through the store,
// no THREE, no imports from step.js/mover.js (those modules import this one,
// never the reverse).
//
// Scope: dry commits stay untouched — they never treat a ground liquid
// cell as a special case. This regime only arms once a float-capable mob
// intersects liquid on its path (body overlap or nose probe ahead); while
// armed (`mob.liquid`) it preempts entry/nav/lottery/touch/grind until the
// whole body (core + nose + tail, rear included) leaves the liquid.
//
// Exit law: a validated shore at the liquid level keeps the ballistic hop
// (step.js `shoreExitTarget`); air with a real landing below walks out and
// falls with the shared step-down shape (support under core + nose, headroom
// above the landing) but never a drop limit — columns always drain.
import { BLOCK_INFO, isLiquid } from "../core/blocks.js";
import { getBlock, dimInfinite } from "../core/store.js";
import { floatTargetY } from "./livestock.js";
import { mobCanFloat } from "./registry.js";
import { SEP_GAP } from "./collide.js";

// Shared-window tolerance (feet and surfaces are integer tops; absorbs
// float dust, never a drop). Same value as step.js.
export const LIQUID_SWIM_EPS = 0.05;
// Drift descent budget under a solid lid (covers one lintel over any body
// height plus settle dust) and its search granularity.
export const LIQUID_DRIFT_DEPTH = 1.5;
export const LIQUID_DRIFT_STEP = 0.05;
// Air-exit landing scan depth (blocks): any real landing resolves, a plain
// infinite void refuses. Bounded so the refusal stays fast.
export const LIQUID_AIR_SCAN = 96;
// Lateral entry probe: how far ahead of the body the trigger reads.
export const LIQUID_PROBE = 0.45;
export const LIQUID_PROBE_AHEAD = 0.15;
// Column arming timeout (s): a stale commit that never floats releases.
export const LIQUID_TIMEOUT = 20;

export function liquidSolidAt(x, y, z) {
  return !!BLOCK_INFO[getBlock(x, y, z)]?.solid;
}

// Body overlap with liquid over a disc footprint, or null when dry.
export function liquidOverlapAt(px, py, pz, hw, h) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const y0 = Math.floor(py), y1 = Math.floor(py + h);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (isLiquid(getBlock(bx, by, bz))) return true;
      }
  return false;
}

// Highest liquid surface top overlapping the body, or null when dry.
export function liquidTouchSurface(mob) {
  let top = null;
  const { x: px, y: py, z: pz } = mob.pos;
  const x0 = Math.floor(px - mob.hw), x1 = Math.floor(px + mob.hw);
  const z0 = Math.floor(pz - mob.hw), z1 = Math.floor(pz + mob.hw);
  const y0 = Math.floor(py), y1 = Math.floor(py + mob.h);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++)
        if (isLiquid(getBlock(bx, by, bz))) top = top == null ? by + 1 : Math.max(top, by + 1);
  return top;
}

// True surface above a footprint: scans up through the continuous column.
export function liquidSurfaceTopAt(px, pz, hw, py, maxScan = 96) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const layerWet = (by) => {
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (isLiquid(getBlock(bx, by, bz))) return true;
      }
    return false;
  };
  const start = Math.floor(py);
  if (!layerWet(start)) return null;
  let top = start + 1;
  for (let by = start + 1; by <= start + maxScan; by++) {
    if (!layerWet(by)) break;
    top = by + 1;
  }
  return top;
}

// Highest surface top under a footprint, scanning down from topY.
export function liquidSurfaceTopBelow(px, pz, hw, topY, depth = 8) {
  let top = null;
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const start = Math.floor(topY);
  for (let by = start; by > start - depth; by--)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (isLiquid(getBlock(bx, by, bz))) top = top == null ? by + 1 : Math.max(top, by + 1);
      }
  return top;
}

// Expected floating feet level over a cell, or null when no swimmable
// surface sits at the reference (at most a block above, never below).
export function liquidFloatLevelAt(mob, x, z, refY) {
  const surface = liquidSurfaceTopBelow(x, z, mob.hw, refY + mob.h + 1);
  if (surface == null) return null;
  if (surface < refY - LIQUID_SWIM_EPS || surface > refY + 1 + LIQUID_SWIM_EPS) return null;
  return { surface, y: floatTargetY(surface, mob.h) };
}

export function liquidHeadroomAt(px, feetY, pz, h) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  for (let by = Math.floor(feetY); by <= Math.floor(feetY + h - 1e-4); by++) {
    if (liquidSolidAt(bx, by, bz)) return false;
  }
  return true;
}

export function liquidBodyFitsAt(px, feetY, pz, hw, h) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  const y0 = Math.floor(feetY), y1 = Math.floor(feetY + h - 1e-4);
  for (let by = y0; by <= y1; by++)
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        if (bx + 1 <= px - hw || bx >= px + hw) continue;
        if (bz + 1 <= pz - hw || bz >= pz + hw) continue;
        if (by + 1 <= feetY || by >= feetY + h) continue;
        if (liquidSolidAt(bx, by, bz)) return false;
      }
  return true;
}

// Ride level for a known surface: the shared float level when the body
// fits, else the highest lower pose that fits — the drift level under a
// solid lid. Null when no pose fits.
export function liquidRideLevelFor(mob, x, z, surface) {
  const y = floatTargetY(surface, mob.h);
  if (liquidHeadroomAt(x, y, z, mob.h)) return { surface, y };
  const limit = y - LIQUID_DRIFT_DEPTH;
  for (let yy = y - LIQUID_DRIFT_STEP; yy >= limit; yy -= LIQUID_DRIFT_STEP) {
    if (liquidHeadroomAt(x, yy, z, mob.h)) return { surface, y: yy };
  }
  return null;
}

// Effective floating ride at a cell: shared float level, else drift under
// a lid. Null when the cell holds no reachable liquid.
export function liquidDriftLevelAt(mob, x, z, refY) {
  const fl = liquidFloatLevelAt(mob, x, z, refY);
  if (!fl) return null;
  return liquidRideLevelFor(mob, x, z, fl.surface);
}

// Lid-aware ride at a footprint, computed from that footprint's own true
// liquid column (no shared-window gate): a deep rise sees its ceiling
// early and eases into the drift instead of ramming it at full speed.
// Null when the footprint holds no continuous liquid column.
export function liquidLiddedRideAt(mob, x, z, r, py) {
  const ts = liquidSurfaceTopAt(x, z, r, py);
  if (ts == null) return null;
  return liquidRideLevelFor(mob, x, z, ts);
}

// Lowest lidded ride at the body column and the nose cells (the nose box
// is about to touch there). Null when no forward liquid is lidded. Unlike
// the windowed drift read it sees a lid from any depth, so a fast rise
// brakes in time. Only cells of the same liquid body count: a lower
// neighboring pool must not drag the ride down (its windowed drift would
// have refused it as unreachable). A lid only counts when it constrains
// below the natural float level — hovering exactly at the drift still
// reports it, so the regime never loses a lid it already sits under.
export function liquidLidTargetAt(mob, yaw) {
  const along = mob.nose?.along ?? 0;
  const reach = along + (mob.nose?.r ?? 0.2) + 0.05;
  const bodyTs = liquidSurfaceTopAt(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y)
    ?? liquidTouchSurface(mob);
  let best = null;
  for (const d of [0, along, reach]) {
    const nx = mob.pos.x + Math.sin(yaw) * d, nz = mob.pos.z + Math.cos(yaw) * d;
    const nl = liquidLiddedRideAt(mob, nx, nz, mob.nose?.r ?? 0.2, mob.pos.y);
    if (nl == null) continue;
    if (bodyTs != null && Math.abs(nl.surface - bodyTs) > 1 + LIQUID_SWIM_EPS) continue;
    if (nl.y < floatTargetY(nl.surface, mob.h) - 1e-3 && (best == null || nl.y < best)) best = nl.y;
  }
  return best;
}

// First landing under a liquid: the highest dry ground top, else the float
// level of the liquid body reached first, scanning down from fromY. The one
// read behind lateral air exits: a plain void column refuses.
export function liquidLandingBelow(mob, x, z, fromY, depth = LIQUID_AIR_SCAN) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const start = Math.floor(fromY);
  const stop = dimInfinite() ? start - depth : 0;
  for (let by = start; by >= stop && by > start - depth; by--) {
    if (liquidSolidAt(bx, by, bz)) return { y: by + 1, wet: false };
    if (isLiquid(getBlock(bx, by, bz))) {
      let top = by + 1;
      for (let uy = by + 1; uy <= start + 8; uy++) {
        if (isLiquid(getBlock(bx, uy, bz))) top = uy + 1;
        else break;
      }
      return { y: floatTargetY(top, mob.h), wet: true, surface: top };
    }
  }
  return null;
}

// Solid bank owning the ride level ahead: a solid body or nose box at the
// current feet level. Anything else (open water, level rise, lip over void)
// holds the press — never a lottery draw, never a latch.
export function liquidSolidAhead(mob) {
  const px = Math.sin(mob.yaw), pz = Math.cos(mob.yaw);
  const sx = mob.pos.x + px * LIQUID_PROBE, sz = mob.pos.z + pz * LIQUID_PROBE;
  const nx = sx + px * (mob.nose?.along ?? 0), nz = sz + pz * (mob.nose?.along ?? 0);
  return liquidBodyFitsAt(sx, mob.pos.y, sz, mob.hw, mob.h) === false ||
    liquidBodyFitsAt(nx, mob.pos.y, nz, mob.nose?.r ?? 0.2, mob.h) === false;
}

// Whole body (core + nose + tail, rear included) clear of liquid at the
// current pose. The exit gate: leaving water needs every disc dry, since
// the rear still drags the surface while the core already reads air.
export function bodyClearOfLiquid(mob) {
  const discs = [
    [mob.pos.x, mob.pos.z, 0.05],
    [mob.pos.x + Math.sin(mob.yaw) * (mob.nose?.along ?? 0),
     mob.pos.z + Math.cos(mob.yaw) * (mob.nose?.along ?? 0), mob.nose?.r ?? 0.2],
    [mob.pos.x - Math.sin(mob.yaw) * Math.abs(mob.tail?.along ?? 0),
     mob.pos.z - Math.cos(mob.yaw) * Math.abs(mob.tail?.along ?? 0), mob.tail?.r ?? 0.2],
  ];
  for (const [cx, cz, r] of discs) {
    if (liquidOverlapAt(cx, mob.pos.y, cz, r, mob.h)) return false;
  }
  return true;
}

// Rear overlap tolerated on the way out (m): the drop starts once the
// rear only grazes the surface within this rim instead of waiting for the
// last cell to dry. Core and nose stay strict — only the tail gets slack,
// measured by shrinking its disc: water that never reaches past the rim
// counts as clear.
export const LIQUID_TAIL_OVERLAP = 0.05;
export function liquidExitClear(mob) {
  const sx = Math.sin(mob.yaw), cz = Math.cos(mob.yaw);
  if (liquidOverlapAt(mob.pos.x, mob.pos.y, mob.pos.z, 0.05, mob.h)) return false;
  const nx = mob.pos.x + sx * (mob.nose?.along ?? 0), nz = mob.pos.z + cz * (mob.nose?.along ?? 0);
  if (liquidOverlapAt(nx, mob.pos.y, nz, mob.nose?.r ?? 0.2, mob.h)) return false;
  const tailR = Math.max(0.01, (mob.tail?.r ?? 0.2) - LIQUID_TAIL_OVERLAP);
  const tx = mob.pos.x - sx * Math.abs(mob.tail?.along ?? 0), tz = mob.pos.z - cz * Math.abs(mob.tail?.along ?? 0);
  if (liquidOverlapAt(tx, mob.pos.y, tz, tailR, mob.h)) return false;
  return true;
}

// Peer ceiling for the pass-under rule: a live body overhead in the same
// column caps the rise just below its own feet (plus the generous peer
// gap — stacked bodies rest with visible water between them instead of
// pressing head-to-tail) — the climber slides underneath instead of
// intersecting or queueing. Only a peer whose feet stand at or above the
// head counts as overhead: a mate
// standing on the ground next to the column shaft is never a ceiling, and
// without this gate its cap would sit below the climber's feet and drag
// the rise down instead of bounding it. Pure reads; carried mobs never
// count. Null when no peer caps the ride, and the cap never forces a body
// down (only bounds the rise).
export const LIQUID_PEER_GAP = 0.35;
export function liquidPeerCapY(mob, peers = null) {
  if (!peers) return null;
  const need = mob.hw * 2 + SEP_GAP;
  let best = null;
  for (const o of peers) {
    if (o === mob || !o.alive || o._carried || o._riding) continue;
    if (o.pos.y + 0.05 < mob.pos.y + mob.h) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > need * need) continue;
    const cap = o.pos.y - mob.h - LIQUID_PEER_GAP;
    if (best == null || cap < best) best = cap;
  }
  return best;
}

// Whether this body is someone's ceiling: a live peer below within the
// shaft need whose head sits at/below this body's feet reads this body as
// its peer cap (mirror of the liquidPeerCapY gate). Used by the top-yield
// watchdog: a ceiling with no progress must stand aside. Pure read.
export function liquidCapsAnyone(mob, peers = null) {
  if (!peers) return false;
  const need = mob.hw * 2 + SEP_GAP;
  for (const o of peers) {
    if (o === mob || !o.alive || o._carried || o._riding) continue;
    if (o.pos.y + (o.h ?? mob.h) > mob.pos.y + 0.05) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > need * need) continue;
    return true;
  }
  return false;
}

// Frontal cone for the lateral-entry trigger: the nose ray plus one ray
// each side at 45°. A mob facing tall liquid inside the cone turns into it
// through the enter drive; a graze (~90°) stays outside the cone and keeps
// the legacy wall-follow. Same range on every ray.
export const LIQUID_CONE_RAYS = [-Math.PI / 4, 0, Math.PI / 4];
// Re-arm blockers: a fast-falling body never draws the regime on its way
// down (it would brake a ballistic fall back into a hover), and every
// release holds the next draw off briefly so an exit fall or a hop landing
// doesn't instantly re-arm on the water it just left (which would brake the
// fall back into a hover instead of letting it land).
export const LIQUID_FALL_VY = -3;
export const LIQUID_REARM_T = 1.5;
// Top-yield anti-starvation (s): an uncapped float top that caps someone
// below must drain or stand aside — no net progress for this long backs it
// out (release glide + re-arm) instead of capping the chain below until
// the 20 s LIQUID_TIMEOUT. Layered under the 2 s driven window of the
// single progress ledger (which needs a live target): this one also
// watches targetless tops.
export const LIQUID_YIELD_T = 5;
// Wet commitment: the body overlaps liquid it cannot freely float on —
// either the true surface stands above the shared window (a tall column
// to rise), or the natural float level has no headroom (a lidded drift:
// the lid, not the surface, owns the ride, so the body never reaches the
// arm line by itself). A body already free-floating at its surface (pool,
// rim, open bank) is pool business and never commits: the headroom read,
// not the feet offset, tells a drift hold from a pool float. Pure read;
// metering aside — load only refuses newcomers, never drops an engaged
// body. The fast-fall veto applies: a ballistic descent never draws.
export function liquidWetCommit(mob, floating = null) {
  if (!mobCanFloat(mob)) return false;
  if ((mob.vel?.y ?? 0) < LIQUID_FALL_VY) return false;
  const wetBody = floating ?? liquidOverlapAt(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h);
  if (!wetBody) return false;
  const ts = liquidSurfaceTopAt(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y)
    ?? liquidTouchSurface(mob);
  if (ts == null) return false;
  if (ts > mob.pos.y + 1 + LIQUID_SWIM_EPS) return true;
  return !liquidHeadroomAt(mob.pos.x, floatTargetY(ts, mob.h), mob.pos.z, mob.h);
}
// Lateral-entry trigger: tall liquid only. Pools, lake rims, and shallow
// banks (surface within the shared ±1 window) keep the legacy contact
// lottery in transitions.js/mover.js; walls and columns standing above it
// arm this regime instead, so the pool rules never change.
//   dry: a frontal-cone probe ahead touches liquid whose surface stands
//   above the shared window (a wall/column face, never a pool rim);
//   wet: the body commits through liquidWetCommit above (tall column or
//   lidded drift — pool floaters at the surface level never arm).
// Returns {wet, qx?, qz?} or null.
export function liquidEntryProbe(mob, floating = null, peers = null) {
  if (!mobCanFloat(mob)) return null;
  // Falling fast: never draw the regime on the way down — the buoyancy
  // would brake a ballistic fall back into a hover instead of letting it
  // land like the dry step branch.
  if ((mob.vel?.y ?? 0) < LIQUID_FALL_VY) return null;
  const wetBody = floating ?? liquidOverlapAt(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h);
  if (!wetBody) {
    for (const off of LIQUID_CONE_RAYS) {
      const yaw = mob.yaw + off;
      const px = mob.pos.x + Math.sin(yaw) * (mob.hw + LIQUID_PROBE_AHEAD);
      const pz = mob.pos.z + Math.cos(yaw) * (mob.hw + LIQUID_PROBE_AHEAD);
      if (!liquidOverlapAt(px, mob.pos.y, pz, 0.05, mob.h)) continue;
      const surface = liquidSurfaceTopBelow(px, pz, 0.05, mob.pos.y + mob.h + 1);
      if (surface == null || surface <= mob.pos.y + 1 + LIQUID_SWIM_EPS) continue;
      // Entry metering (ground queue): a shaft only holds so many rungs —
      // when the neighborhood ahead is full, the newcomer waits outside
      // where the full ground avoidance still runs instead of piling in.
      // The wait is emergent (live occupancy, no tickets): as soon as a
      // rung frees, the next probe arms. Wet waders meter at the gate
      // below instead of here.
      if (peers != null) {
        const span = liquidSpanAt(px, pz, mob.pos.y, mob.h);
        if (span != null && liquidShaftLoad(mob, px, pz, peers) >= liquidShaftCapacity(mob, span)) {
          continue;
        }
      }
      return { wet: false, qx: px, qz: pz };
    }
    return null;
  }
  // Wet arm through the shared commitment gate (tall column or lidded
  // drift — pool floaters at the surface level never arm).
  if (!liquidWetCommit(mob, floating)) return null;
  // Entry metering for waders too: an unarmed body that walked into a full
  // shaft treads water at the rim (legacy pool float) instead of arming —
  // the queue forms in the water, and the sequential ticks arm at most one
  // waiter per freed rung. Metering only refuses newcomers: an engaged
  // body keeps its rung (see liquidWetCommit).
  if (peers != null) {
    const span = liquidSpanAt(mob.pos.x, mob.pos.z, mob.pos.y, mob.h);
    if (span != null && liquidShaftLoad(mob, mob.pos.x, mob.pos.z, peers) >= liquidShaftCapacity(mob, span)) {
      return null;
    }
  }
  return { wet: true };
}

// Unified release decision: one predicate behind the three release
// rules, so the regime holds exactly while the body is committed and
// releases the tick it is free — no stale commits, no mid-exit drops:
// - float: the whole body (rear included, within the tail overlap) left
//   the liquid AND truly landed, and no wet commitment holds anymore
//   (a straddle landing with the tail in tall/lidded liquid stays
//   engaged and walks fully clear instead of becalming mid-exit);
// - enter walk-away: dry, no tall liquid ahead, supported — the commit
//   paraded past its water;
// - rim graze: floating but every disc dry, with the surface at/below
//   the feet — a graze walks/falls past like a wall.
// The support read stays lazy (a closure): unarmed mobs pay no scan.
// Pure reads; the stepper owns the physics.
export function liquidShouldRelease(mob, floating, isGrounded) {
  const liq = mob.liquid;
  if (liq == null) return false;
  if (liq.phase === "float" && liquidExitClear(mob) && isGrounded()
    && !liquidWetCommit(mob, floating)) return true;
  if (liq.phase === "enter" && !floating && !liquidEntryProbe(mob, false)
    && isGrounded()) return true;
  if (floating && bodyClearOfLiquid(mob)) {
    const tsBelow = liquidSurfaceTopBelow(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y + mob.h + 1);
    if (tsBelow == null || tsBelow <= mob.pos.y + LIQUID_SWIM_EPS) return true;
  }
  return false;
}

// Continuous water span under a footprint: the TRUE surface top (scanned
// up from the feet) plus the lowest connected liquid layer scanning down
// (bounded). Null when no liquid. The up-scan matters: a deep wader's
// surface sits far above feet+h+1, and a downward-only scan would report a
// shallow span and meter the shaft to nothing.
export function liquidSpanAt(px, pz, py, h) {
  const top = liquidSurfaceTopAt(px, pz, 0.05, py)
    ?? liquidSurfaceTopBelow(px, pz, 0.05, py + h + 1);
  if (top == null) return null;
  let bottom = top;
  for (let by = Math.floor(top) - 1; by > Math.floor(top) - 96; by--) {
    if (!isLiquid(getBlock(Math.floor(px), by, Math.floor(pz)))) break;
    bottom = by;
  }
  return { top, bottom };
}

// Shaft capacity in bodies: rungs of (body height + separation gap) over
// the local water span. A 5-high shaft holds ~4 pigs — the rest queue
// outside. At least 2 so a pair can always meet.
export function liquidShaftCapacity(mob, span) {
  return Math.max(2, Math.floor((span.top - span.bottom) / (mob.h + SEP_GAP)));
}

// Live shaft load around a point: bodies already climbing (armed) within
// the shaft need. Armed-only: unarmed floaters treading water at the rim
// are the queue itself, not the load — counting them would deadlock
// wet-spawned groups (everyone counts everyone, nobody arms). Per
// shaft-neighborhood (same lateral need as the peer cap), not global: a
// 3-wide shaft holds several neighborhoods, one queue per approach. Ticks
// run sequentially, so at most one waiter arms per tick when a rung frees.
export function liquidShaftLoad(mob, px, pz, peers = null) {
  if (!peers) return 0;
  const need = mob.hw * 2 + SEP_GAP;
  let n = 0;
  for (const o of peers) {
    if (o === mob || !o.alive || o._carried || o._riding) continue;
    if (o.liquid == null) continue;
    const dx = o.pos.x - px, dz = o.pos.z - pz;
    if (dx * dx + dz * dz > need * need) continue;
    n++;
  }
  return n;
}

// Aim point for ENTER: the center of the first liquid cell on the heading
// (up to two cells out), so the body turns onto the water instead of
// grinding its rim. Falls back to the probe point.
export function liquidAimCell(mob, yaw, range = 2.0) {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  for (let d = 0.2; d <= range; d += 0.2) {
    const bx = Math.floor(mob.pos.x + dx * d), bz = Math.floor(mob.pos.z + dz * d);
    if (isLiquid(getBlock(bx, Math.floor(mob.pos.y), bz))) return { x: bx + 0.5, z: bz + 0.5 };
    if (isLiquid(getBlock(bx, Math.floor(mob.pos.y) + 1, bz))) return { x: bx + 0.5, z: bz + 0.5 };
  }
  return null;
}

// Unified float ride target for a known true surface: the shared float
// level, lowered under a solid lid (live yaw + intent yaw) and under a
// peer cap (pass-under rule). One ride law for every floater — column
// climbers, pool swimmers, lidded drifts, capped bodies alike. Null cap
// means no ceiling.
export function floatRideTargetY(mob, ts, intentYaw = null, peerCap = null) {
  let target = floatTargetY(ts, mob.h);
  const yaws = intentYaw == null || Math.abs(intentYaw - mob.yaw) < 1e-9
    ? [mob.yaw] : [mob.yaw, intentYaw];
  for (const yaw of yaws) {
    const lid = liquidLidTargetAt(mob, yaw);
    if (lid != null && lid < target) target = lid;
  }
  const cap = peerCap != null ? peerCap : mob._liquidCapY;
  if (cap != null && cap < target) target = cap;
  return target;
}

// Ride target for the vertical plane: the true surface top above the body
// (tall columns included), lowered under a lid (live yaw + intent yaw) and
// under a peer cap (pass-under rule). Null when the body holds no liquid.
export function liquidRideTargetY(mob, intentYaw = null, peerCap = null) {
  const ts = liquidSurfaceTopAt(mob.pos.x, mob.pos.z, mob.hw, mob.pos.y)
    ?? liquidTouchSurface(mob);
  if (ts == null) return null;
  return floatRideTargetY(mob, ts, intentYaw, peerCap);
}
