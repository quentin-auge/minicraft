// Hook framework: pick → filter → fly → hook → pull → arrive/release → retract.
// A hook target is a descriptor; the picker is injected by the caller and the
// filter resolves it to an anchor point + landing, so new target kinds (mob
// grapple: { kind: "mob", ref }) add a table entry below, never a branch:
//   - picker(origin, dir) returns a descriptor or null (DDA, ray-vs-AABB…).
//   - the per-kind filter resolves it to an anchor point + landing.
// Hook kinds are data: shared flight/pull numbers live in HOOK_DEFAULTS,
// entries override only what differs — a new kind (grab-grapple, ...) is one
// registry entry with its own speeds, pull mode, ghost, and retarget,
// never a fork.
// Grapple (middle-click block hook) is the first specialization. The head is
// a visible projectile: it flies out boosted to the aimed face, latches
// visibly onto it, then rides back to the eye on release. The pull runs
// through the shared axis movers in small substeps with the anchor column
// ghosted, landing the player top-or-before while the rope stays on the
// face; the rope stays pinned until mouse-up.
import { pos, vel, playerBody, collideBody, headInWater, setOnGround, setGhostPass, setHookPlanar, setHookWet, PLAYER_HW, PLAYER_H, EYE } from "./physics.js";
import { dim, isSolid } from "../core/store.js";
import { dimSpec } from "../world/dimensions.js";
import { skyGrappleTarget } from "../world/tntstream.js";
import { pickPortalFill, portalWindowLive, portalGhostCell } from "../world/portals.js";
import { isSolidId } from "../core/blocks.js";
import { showRope, showPinnedRope, showTip, hideRope, hideLine, hideTip } from "./rope.js";
import { pickBlock } from "./edit.js";
import { flyOn } from "./fly.js";

const HOOK_DEFAULTS = {
  throwSpeed: 70,
  retractSpeed: 275,
  // Minimum visible retract time: close shots slow to dist/minTime so the
  // ride back always spans a few frames instead of snapping in one step.
  retractMinTime: 0.08,
  substep: 0.4,
  eyeDy: 0.3,
  // Uniform head boost in all directions (launch + retract).
  boost: 2,
  // Head surface offset: 0 centers the latched cube on the aimed face
  // plane, so half its volume sits buried in the block.
  headOff: 0,
  // Face-arrival backoff: face hooks stop this far off the aimed face along
  // its outward normal, so the latched cube clears the body and reads
  // clearly. Top landings snap exact (no hover).
  arriveGap: 0.15,
  // Under-ceiling hang: bottom-face arrivals dangle this far below the
  // latched cube (cube-to-eye clearance), so the mark reads looking up
  // instead of sitting inside the camera near plane.
  hangClear: 0.6,
};

export const HOOK_TYPES = [
  {
    ...HOOK_DEFAULTS,
    key: "grapple",
    pullSpeed: 26,
    flingSpeed: 34,
    // Pull mode, dispatched live by updateHook: "self-to-anchor" yanks the
    // player to the landing; a mob kind registers "anchor-to-self" to haul
    // the anchor instead.
    pull: "self-to-anchor",
    ghost: grappleGhost,
    retarget: retargetBlock,
  },
];

function hookKindOf(key) {
  return HOOK_TYPES.find((h) => h.key === key) ?? HOOK_TYPES[0];
}

let hook = null; // logic: { kind, spec, bx, by, bz, topY, topLand, fx, fy, fz, sx, sy, sz, tx, ty, tz, px, py, pz, ax, ay, az, hx, hy, hz, fly, dist, flying, arrived, hang, pulling, stuck }
let line = null; // visual rope: { spec, hx, hy, hz, retracting, total? }

export function hookActive() {
  return !!hook;
}

// Block picker for the grapple: unbounded DDA hit → descriptor (edit and
// highlight picks are unlimited too). Mob pickers return
// { kind: "mob", ref } and plug into fireHookTarget the same way.
export function grappleBlockPick(origin, dir) {
  const hit = pickBlock(origin, dir, true, Infinity, 1024);
  return hit ? { kind: "block", x: hit.x, y: hit.y, z: hit.z, id: hit.id, face: hit.face } : null;
}

// Combined grapple picker: block DDA plus the live portal-fill slabs (which
// are meshes, not blocks, so the DDA flies through them). Nearer hit wins —
// aiming at a fill beats the frame/wall behind it, aiming at a frame block
// still latches the block.
export function grapplePick(origin, dir) {
  const block = grappleBlockPick(origin, dir);
  const portal = pickPortalFill(origin, dir);
  if (!portal) return block;
  if (!block) return portal;
  const bd = Math.hypot(block.x + 0.5 - origin.x, block.y + 0.5 - origin.y, block.z + 0.5 - origin.z);
  return portal.dist <= bd ? portal : block;
}

// Anchor readout for streaming eviction pins (null when unhooked).
export function hookAnchor() {
  if (!hook) return null;
  return { x: hook.ax, y: hook.ay, z: hook.az };
}

// Sky-grapple (dimensions with the skyGrapple capability, i.e. the infinite
// TNT one): when the DDA pick misses, the lattice materializes a cloud past
// the fog along the aim ray and the grapple latches it through the normal
// block filter. Same refusals as a regular shot (flying, already hooked);
// other dimensions fizzle as before.
export function fireSkyHook(origin, dir, minD, maxD, refresh) {
  if (flyOn || hook) return false;
  if (!dimSpec(dim)?.skyGrapple) return false;
  const target = skyGrappleTarget(origin, dir, minD, maxD, refresh);
  if (!target) return false;
  const fire = TARGET_FILTERS[target.kind];
  if (!fire) return false;
  return fire(target, hookKindOf("grapple"));
}

export function fireHookTarget(pick, origin, dir, kindKey = "grapple") {
  if (flyOn || hook) return false;
  const target = pick(origin, dir);
  if (!target) return false;
  // Registry dispatch, no kind-name switches: the filter table resolves the
  // target kind to an anchor. Unknown kinds (mob, ...) have no entry yet and
  // refuse, until they ship as table entries with a following retarget and
  // their own pull mode.
  const fire = TARGET_FILTERS[target.kind];
  if (!fire) return false;
  return fire(target, hookKindOf(kindKey));
}

// Any solid block anchors (ground, wall, ceiling — liquids never do):
// the landing resolves to its top or to the free cell before it.
function fireBlock(t, spec) {
  if (!isSolidId(t.id)) return false;
  const face = t.face ?? [0, 1, 0];
  const a = { kind: "block", spec, bx: t.x, by: t.y, bz: t.z, fx: face[0], fy: face[1], fz: face[2], alive: blockAlive };
  hookRetarget(a);
  const sx = pos.x, sy = pos.y + spec.eyeDy, sz = pos.z;
  if (Math.hypot(a.tx - sx, a.ty - sy, a.tz - sz) < 0.3) return false;
  const dist = Math.hypot(a.ax - sx, a.ay - sy, a.az - sz);
  hook = { ...a, spec, sx, sy, sz, tx: a.tx, ty: a.ty, tz: a.tz, hx: sx, hy: sy, hz: sz, fly: 0, dist, flying: true, arrived: false, hang: false, pulling: false, stuck: 0 };
  line = { spec, hx: sx, hy: sy, hz: sz, retracting: false };
  setGhostPass((bx, by, bz) => !!hook && !hook.arrived && hookGhost(bx, by, bz, hook));
  return true;
}

// Portal-fill grapple: fills are visual slabs over AIR/liquid, so the anchor
// is the slab hit point and the landing is the fill center — arriving snaps
// the body inside the fill and the normal touch-travel fires (mid-pull, too,
// if the body crosses the slab first). The frame ring ghosts, so the ride
// slides through it into the slab instead of stalling on it; the window is
// static while live, and a broken frame mid-flight/pull severs the hook
// through the liveness check below.
function firePortal(t, spec) {
  if (!portalWindowLive(t.win)) return false;
  const a = {
    kind: "portal", spec, win: t.win,
    fx: t.face[0], fy: t.face[1], fz: t.face[2],
    tx: t.cx, ty: t.cy, tz: t.cz,
    ax: t.px, ay: t.py, az: t.pz,
    topLand: true, retarget: retargetPortal,
    ghost: (bx, by, bz, h) => portalGhostCell(h.win, bx, by, bz),
    alive: (h) => portalWindowLive(h.win),
  };
  hookRetarget(a);
  const sx = pos.x, sy = pos.y + spec.eyeDy, sz = pos.z;
  if (Math.hypot(a.tx - sx, a.ty - sy, a.tz - sz) < 0.3) return false;
  const dist = Math.hypot(a.ax - sx, a.ay - sy, a.az - sz);
  hook = { ...a, sx, sy, sz, hx: sx, hy: sy, hz: sz, fly: 0, dist, flying: true, arrived: false, hang: false, pulling: false, stuck: 0 };
  line = { spec, hx: sx, hy: sy, hz: sz, retracting: false };
  setGhostPass((bx, by, bz) => !!hook && !hook.arrived && hookGhost(bx, by, bz, hook));
  return true;
}

function retargetPortal(h) {
  void h;
  // Fills never move while live: anchor and landing stay as fired. The
  // no-op override matters — falling back to the block resolver would read
  // undefined cells into NaN anchor/landing.
}

// Liveness: the ride only survives while its anchor exists. A mined,
// blasted, or evicted anchor severs the hook (retract, no fling) instead of
// pulling the player to empty air.
function blockAlive(h) { return isSolid(h.bx, h.by, h.bz); }

// Target-level dispatch, no kind switches: a target may override its kind
// spec's re-resolution/ghosting/liveness (portal fills do — static anchor,
// frame-ring ghost, window liveness); blocks fall through to the grapple
// spec, with anchor-cell solidity as their liveness.
function hookRetarget(h) { (h.retarget ?? h.spec.retarget)(h); }
function hookGhost(bx, by, bz, h) { return (h.ghost ?? h.spec.ghost)(bx, by, bz, h); }
function hookAlive(h) { return (h.alive ?? (() => true))(h); }

const TARGET_FILTERS = { block: fireBlock, portal: firePortal };

// Re-resolve every frame (flight and pull): the rope anchor sits centered
// on the aimed face plane (top faces: column-top surface point;
// side/bottom faces: face-centered), so the latched cube sits half-buried
// in the block, while the player landing resolves top-or-before —
// a short stack rides up onto the anchor top, taller faces land in the
// free cell before the hit, feet at its bottom. Re-resolving in flight
// tracks column edits under a flying head; mob kinds track mob.pos here.
function retargetBlock(h) {
  const off = h.spec.headOff;
  let q = 0;
  while (isSolid(h.bx, h.by + q + 1, h.bz)) q++;
  h.topLand = q <= 1;
  if (h.topLand) {
    h.topY = h.by + q;
    h.tx = h.bx + 0.5; h.ty = h.topY + 1.001; h.tz = h.bz + 0.5;
    h.ax = h.bx + 0.5; h.ay = h.topY + 1 + off; h.az = h.bz + 0.5;
  } else {
    h.tx = h.bx + h.fx + 0.5; h.ty = h.by + h.fy + 0.001; h.tz = h.bz + h.fz + 0.5;
    h.ax = h.bx + 0.5 + h.fx * (0.5 + off);
    h.ay = h.by + 0.5 + h.fy * (0.5 + off);
    h.az = h.bz + 0.5 + h.fz * (0.5 + off);
  }
}

// The anchor column is passable only for top landings (riding up to stand
// on top of it). Face landings run pure collision + slide, so the body
// never enters solid — not even transiently.
function grappleGhost(bx, by, bz, h) {
  return !h.flying && h.kind === "block" && h.topLand &&
    bx === h.bx && bz === h.bz && by >= h.by && by <= h.topY;
}

function clearHook() {
  hook = null;
  setGhostPass(null);
  setHookPlanar(false);
  setHookWet(false);
}

// Sever: instant silent teardown for teleports (out-of-level respawn, New
// World) — no fling, no retract ride across the jump. Release paths use
// cancelHook instead.
export function severHook() {
  hook = null;
  line = null;
  hideRope();
  setGhostPass(null);
  setHookPlanar(false);
  setHookWet(false);
}

// True when a player body fits at (tx, ty, tz): feet + head cells free.
function landingFree(tx, ty, tz) {
  const y0 = Math.floor(ty + 0.001), y1 = Math.floor(ty + PLAYER_H - 0.01);
  for (let y = y0; y <= y1; y++)
    for (let bx = Math.floor(tx - PLAYER_HW); bx <= Math.floor(tx + PLAYER_HW); bx++)
      for (let bz = Math.floor(tz - PLAYER_HW); bz <= Math.floor(tz + PLAYER_HW); bz++)
        if (isSolid(bx, y, bz)) return false;
  return true;
}

// True when solid ground sits directly under (tx, ty, tz).
function landingSupported(tx, ty, tz) {
  const fy = Math.floor(ty - 0.001);
  for (let bx = Math.floor(tx - PLAYER_HW); bx <= Math.floor(tx + PLAYER_HW); bx++)
    for (let bz = Math.floor(tz - PLAYER_HW); bz <= Math.floor(tz + PLAYER_HW); bz++)
      if (isSolid(bx, fy, bz)) return true;
  return false;
}

function arrive() {
  // Reached the landing: snap onto it and stop dead — the next jump is a
  // plain regular jump. Rope stays pinned on the face anchor until
  // mouse-up. Top-of-block hooks stand plane-locked with physics live;
  // face hooks hang frozen until release (plain drop).
  pos.set(hook.tx, hook.ty, hook.tz);
  settleArrival();
}

// Face arrivals clear the anchor surface so the latched cube sits in a
// visible gap instead of inside the body or the camera near plane: side
// faces back off along the outward normal, bottom faces dangle to a fixed
// cube-to-eye clearance. Applied only when the offset fits, else the exact
// stop is kept. Top landings snap exact.
function applyArriveGap() {
  if (hook.topLand) return;
  if (hook.fy === -1) {
    const oy = hook.ay - EYE - hook.spec.hangClear;
    if (landingFree(pos.x, oy, pos.z)) pos.y = oy;
    return;
  }
  const g = hook.spec.arriveGap;
  const ox = pos.x + hook.fx * g, oy = pos.y + hook.fy * g, oz = pos.z + hook.fz * g;
  if (landingFree(ox, oy, oz)) pos.set(ox, oy, oz);
}

// Still against the arrival point (never displaced past this): tip mark
// alone. Past it, the rope stays up until release.
const ARRIVAL_EPS = 0.05;

// Shared ending: clear the anchor surface, pin the rope, stop dead, arm
// the plane-lock. Movement at destination is allowed only for top-of-block
// hooks; face hooks hang.
function settleArrival() {
  applyArriveGap();
  hook.arrived = true;
  hook.pulling = false;
  // Rest spot: the rope shows from here on — tip alone until displaced.
  hook.px = pos.x; hook.py = pos.y; hook.pz = pos.z;
  line = { spec: hook.spec, hx: hook.ax, hy: hook.ay, hz: hook.az, retracting: false };
  vel.set(0, 0, 0);
  hook.hang = !hook.topLand;
  setOnGround(hook.topLand && landingSupported(pos.x, pos.y, pos.z));
  setHookPlanar(true);
  setHookWet(headInWater());
}

// Release (middle mouse-up): mid-pull yank flings along the launch
// direction (pull speed in liquid, no fling); flying, hanging, or standing
// releases just retract fast. Ground contact is re-measured so a hang-drop
// never inherits a stale grounded jump. The head rides back to the eye;
// movement resumes at once. The mark detaches from the anchor with the
// head, so nothing stays welded on the face during the ride back.
export function cancelHook(fling = true) {
  if (!hook && !line) return;
  const spec = (hook && hook.spec) || (line && line.spec) || HOOK_TYPES[0];
  const pulling = hook ? !!hook.pulling : false;
  if (pulling) {
    const dx = hook.tx - hook.sx, dy = hook.ty - hook.sy, dz = hook.tz - hook.sz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (fling && !headInWater()) {
      vel.set(dx / dist * spec.flingSpeed, dy / dist * spec.flingSpeed, dz / dist * spec.flingSpeed);
    } else if (headInWater()) {
      vel.set(dx / dist * spec.pullSpeed, dy / dist * spec.pullSpeed, dz / dist * spec.pullSpeed);
    }
  } else if (hook) {
    setOnGround(landingSupported(pos.x, pos.y, pos.z));
  }
  if (hook) {
    line = { spec, hx: hook.flying ? hook.hx : hook.ax, hy: hook.flying ? hook.hy : hook.ay, hz: hook.flying ? hook.hz : hook.az, retracting: true };
  } else if (line) {
    line.retracting = true;
  }
  clearHook();
}

// Runs alongside updatePlayer while the hook is live: fly the head out,
// then yank toward the landing until close (dispatched through spec.pull).
// Only the pull owns the frame (velocity driven toward the landing,
// sliding along obstacles); head flight and standing arrivals yield so
// normal physics runs — falls continue under a flying head. Face stops
// hang frozen, jump inert, until mouse-up; stalled pulls stop in place
// the same way.
// Returns true when the hook owns the frame (pulling/hanging); false
// otherwise, so the caller runs normal player physics with the visuals drawn.
export function updateHook(dt) {
  if (!hook) return false;
  if (hook.arrived) {
    if (!hookAlive(hook)) { cancelHook(false); return false; } // anchor mined under a settled hook: let go
    if (hook.hang) { vel.set(0, 0, 0); hook.pulling = false; return true; }
    hook.pulling = false;
    return false;
  }
  const spec = hook.spec;
  if (hook.flying) {
    hookRetarget(hook); // track column edits (mob kinds: mob.pos) mid-flight
    if (!hookAlive(hook)) { cancelHook(false); return false; } // anchor gone: retract
    const step = spec.throwSpeed * spec.boost * dt;
    hook.fly += step / hook.dist;
    if (hook.fly >= 1) {
      hook.fly = 1;
      hook.hx = hook.ax; hook.hy = hook.ay; hook.hz = hook.az;
      hook.flying = false;
      hook.pulling = false;
      line = { spec, hx: hook.ax, hy: hook.ay, hz: hook.az, retracting: false };
      return false;
    }
    hook.hx = hook.sx + (hook.ax - hook.sx) * hook.fly;
    hook.hy = hook.sy + (hook.ay - hook.sy) * hook.fly;
    hook.hz = hook.sz + (hook.az - hook.sz) * hook.fly;
    line.hx = hook.hx; line.hy = hook.hy; line.hz = hook.hz;
    hook.pulling = false;
    return false;
  }
  // Pull-mode dispatch: grapple yanks the player to the landing; future
  // kinds (mob grab: "anchor-to-self") add their branch beside it.
  if (spec.pull === "self-to-anchor") return pullSelfToAnchor(dt);
  return hook.hang;
}

// "self-to-anchor": drive the player toward the landing in substepped
// collision + slide until close, then stand or hang by targeting.
function pullSelfToAnchor(dt) {
  const spec = hook.spec;
  hookRetarget(hook);
  if (!hookAlive(hook)) { cancelHook(false); return false; } // anchor gone: retract
  line.hx = hook.ax; line.hy = hook.ay; line.hz = hook.az;
  const dx = hook.tx - pos.x, dy = hook.ty - pos.y, dz = hook.tz - pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const step = spec.pullSpeed * dt;
  if (dist <= step + 0.001) {
    if (landingFree(hook.tx, hook.ty, hook.tz)) arrive();
    else settleArrival(); // landing area reached but blocked: stop against it
    return hook.hang;
  }
  const px = pos.x, py = pos.y, pz = pos.z;
  const n = Math.max(1, Math.ceil(step / spec.substep));
  vel.set(dx / dist * spec.pullSpeed, dy / dist * spec.pullSpeed, dz / dist * spec.pullSpeed);
  for (let i = 0; i < n; i++) collideBody(dt / n, playerBody, true);
  const moved = Math.hypot(pos.x - px, pos.y - py, pos.z - pz);
  if (moved < step * 0.25) {
    if (++hook.stuck >= 3) { settleArrival(); return hook.hang; } // stalled: stop in place
    hook.pulling = false;
    return true;
  }
  hook.stuck = 0;
  hook.pulling = true;
  return true;
}

// Visual tick, runs every frame even while walking: full rope while the
// head travels (fly/pull/retract); once pinned, always the mark on the
// anchor (dark cube + cross on the face) — alone while still against the
// arrival point, plus the S-wobble rope, clamped above its segment, from
// the first step away until mouse-up.
export function tickHookFx(dt) {
  if (!line) return;
  const spec = line.spec;
  const cx = pos.x, cy = pos.y + spec.eyeDy, cz = pos.z;
  if (line.retracting) {
    // Detach the mark from the anchor on arrival here, so the cross and dark
    // head follow the moving tip instead of staying pinned to the face.
    hideTip();
    const dx = cx - line.hx, dy = cy - line.hy, dz = cz - line.hz;
    const dist = Math.hypot(dx, dy, dz);
    // Constant slowed speed from the initial gap: far shots keep full
    // speed, close ones ride at total/minTime so the trip lasts minTime.
    if (line.total == null) line.total = dist;
    const fullSpeed = spec.retractSpeed * spec.boost;
    const speed = Math.min(fullSpeed, line.total / (spec.retractMinTime || 0.08));
    const step = speed * dt;
    if (dist <= step + 0.05) {
      line = null;
      hideRope();
      return;
    }
    line.hx += dx / dist * step;
    line.hy += dy / dist * step;
    line.hz += dz / dist * step;
    showRope(cx, cy, cz, line.hx, line.hy, line.hz);
    return;
  }
  if (hook && hook.arrived) {
    const n = hook.topLand ? [0, 1, 0] : [hook.fx, hook.fy, hook.fz];
    showTip(line.hx, line.hy, line.hz, n[0], n[1], n[2]);
    const displaced = Math.hypot(pos.x - hook.px, pos.y - hook.py, pos.z - hook.pz) > ARRIVAL_EPS;
    if (displaced) showPinnedRope(cx, cy, cz, line.hx, line.hy, line.hz);
    else hideLine();
    return;
  }
  showRope(cx, cy, cz, line.hx, line.hy, line.hz);
}
