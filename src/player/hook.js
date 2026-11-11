// Hook framework: pick → filter → fly → hook → pull → arrive/release → retract.
// A hook target is a descriptor; the picker is injected by the caller and the
// filter resolves it to an anchor point + landing, so new target kinds (mob
// grapple: { kind: "mob", ref }) add a table entry below, never a branch:
//   - picker(origin, dir) returns a descriptor or null (DDA, ray-vs-AABB…).
//   - the per-kind filter resolves it to an anchor point + landing.
// Hook kinds are data: shared flight/pull numbers live in HOOK_DEFAULTS,
// entries override only what differs — mob grab/release ship as registry
// entries with their own speeds, pull mode, ghost, and retarget,
// never a fork.
// Grapple (middle-click block hook) is the first specialization. The head is
// a visible projectile: it flies out boosted to the aimed face, latches
// visibly onto it, then rides back to the eye on release. The pull runs
// through the shared axis movers in small substeps with the anchor column
// ghosted, landing the player top-or-before while the rope stays on the
// face; the rope stays pinned until mouse-up. A settled hook with the body in
// liquid swims while held, wherever the shot came from (look-driven, eye
// forced back under the liquid): the top submerged cell floats, deeper cells
// swim freely, and nobody leaves the water while held. In open air it freezes
// the player until release.
import { pos, vel, yaw, pitch, playerBody, collideBody, headInWater, setOnGround, setGhostPass, noteFling, PLAYER_HW, PLAYER_H, EYE } from "./physics.js";
import { dim, isSolid } from "../core/store.js";
import { dimSpec } from "../world/dimensions.js";
import { skyGrappleTarget } from "../world/tntstream.js";
import { pickPortalFill, portalWindowLive, portalGhostCell, toast } from "../world/portals.js";
import { isSolidId } from "../core/blocks.js";
import { showRope, showPinnedRope, showTip, hideRope, hideLine, hideTip, applyRopeStyle } from "./rope.js";
import { pickBlock } from "./edit.js";
import { flyOn } from "./fly.js";
import { pickMob, grabScale, mobCenterOffset } from "../mobs/pick.js";
import { heldMob, holdMob, latchMob, holdFeet, releasePeerFree, settleReleased, grabHaulProtected, resolveBlockLanding, mobReleaseSpot } from "../mobs/carry.js";
import { mobType, allMobs } from "../mobs/registry.js";

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
    // player to the landing; mob kinds register "anchor-to-self" to haul
    // the anchor (a carried mob) instead.
    pull: "self-to-anchor",
    ghost: grappleGhost,
    retarget: retargetBlock,
    rope: { cube: 0x8a6d3b, head: 0x4a3a1e, opacity: 1 },
  },
  {
    // Mob grab: the head flies to the aimed mob, then hauls it to the hand
    // (hold pose below the sight line). No ghosting, no player pull.
    // Flies in fly mode too (master never gated the carry grapple on fly).
    ...HOOK_DEFAULTS,
    key: "mob-grab",
    throwSpeed: HOOK_DEFAULTS.throwSpeed * 1.25,
    mobPull: HOOK_DEFAULTS.throwSpeed * 1.25 * 1.25,
    pull: "anchor-to-self",
    allowFly: true,
    ghost: () => false,
    rope: { cube: 0x870000, head: 0x5a0000, opacity: 0.7 },
  },
  {
    // Mob release: the head ferries the held mob to the aimed block cell,
    // riding it visibly, then the placement rule settles it (or re-holds).
    // Flies in fly mode too, like the grab.
    ...HOOK_DEFAULTS,
    key: "mob-release",
    throwSpeed: HOOK_DEFAULTS.throwSpeed * 1.25,
    mobPull: HOOK_DEFAULTS.throwSpeed * 1.25 * 1.25,
    pull: "anchor-to-self",
    allowFly: true,
    ghost: () => false,
    rope: { cube: 0x870000, head: 0x5a0000, opacity: 0.7 },
  },
];

function hookKindOf(key) {
  return HOOK_TYPES.find((h) => h.key === key) ?? HOOK_TYPES[0];
}

let hook = null; // logic: { kind, spec, bx, by, bz, topY, topLand, fx, fy, fz, sx, sy, sz, tx, ty, tz, px, py, pz, ax, ay, az, hx, hy, hz, fly, dist, flying, arrived, pulling, stuck }
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

// Mob-grab picker: nearest live mob along the ray with solid occlusion
// (a mob behind a wall never draws, like master). Ungrabbable kinds veto
// here with their message instead of falling through to a mob behind.
export function mobGrabTarget(origin, dir) {
  if (heldMob()) return null;
  const eye = { x: origin.x, y: origin.y, z: origin.z };
  const d = { x: dir.x, y: dir.y, z: dir.z };
  const block = pickBlock(origin, dir, true, Infinity, 1024);
  const blockT = block
    ? Math.hypot(
      block.x + 0.5 + block.face[0] * 0.5 - eye.x,
      block.y + 0.5 + block.face[1] * 0.5 - eye.y,
      block.z + 0.5 + block.face[2] * 0.5 - eye.z)
    : Infinity;
  const hit = pickMob(allMobs(), eye, d, {
    blockT,
    // Distance-scaled oriented pick box (exact up close, wider far away);
    // the hook itself latches the body middle, not the hit point.
    boxScale: grabScale,
    exclude: (m) => !m.alive || (m.dim ?? "over") !== dim || m._carried || m === heldMob(),
  });
  if (!hit) return null;
  if (!mobType(hit.mob.type)?.capabilities?.grabbable) {
    const msg = mobType(hit.mob.type)?.refuseMsg;
    if (msg) toast(msg);
    return null;
  }
  return { kind: "mob", ref: hit.mob };
}

// Mob-release target: the held mob plus the aimed block and face. The hook
// resolves the exact player-equivalent landing (shared rule) at fire time
// and tracks it live, like the player grapple. The caller owns the block
// aim (currentBlock).
export function mobReleaseTarget(mob, x, y, z, face) {
  return { kind: "mobRelease", ref: mob, cx: x, cy: y, cz: z, face };
}

// Camera-frame helpers for the mob landing (hold pose below the sight line).
function eyePos() {
  return { x: pos.x, y: pos.y + EYE, z: pos.z };
}

function lookDir() {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
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
  // Fly gate is per kind spec: the block grapple refuses in fly mode, mob
  // kinds carry `allowFly` (master never gated the carry grapple on fly).
  if (hook || (flyOn && !hookKindOf(kindKey).allowFly)) return false;
  const target = pick(origin, dir);
  if (!target) return false;
  // Registry dispatch, no kind-name switches: the filter table resolves the
  // target kind to an anchor. Unknown kinds refuse until they ship as table
  // entries with a following retarget and their own pull mode.
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
  hook = { ...a, spec, sx, sy, sz, tx: a.tx, ty: a.ty, tz: a.tz, hx: sx, hy: sy, hz: sz, fly: 0, dist, flying: true, arrived: false, pulling: false, stuck: 0 };
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
  hook = { ...a, sx, sy, sz, hx: sx, hy: sy, hz: sz, fly: 0, dist, flying: true, arrived: false, pulling: false, stuck: 0 };
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

const TARGET_FILTERS = { block: fireBlock, portal: firePortal, mob: fireMob, mobRelease: fireMobRelease };

// Carried-mob alpha (master: opaque while grappled, 0.35 once held).
// Clone-once per root (shared materials must never go transparent for every
// mob of that kind), skipping halo-marked meshes; needs no THREE import
// (traverse/clone are methods). Runs after displacement-color, which
// reassigns paintable materials every tick.
export const HELD_ALPHA = 0.35;

export function setMobAlpha(mob, alpha) {
  const root = mob?.root;
  if (!root) return;
  if (mob._alpha === alpha) return;
  mob._alpha = alpha;
  const trans = alpha < 1;
  if (!root.userData.ghostCloned) {
    root.userData.ghostCloned = true;
    root.traverse((obj) => {
      if (obj.isMesh && obj.material && !obj.userData.halo) {
        obj.material = Array.isArray(obj.material)
          ? obj.material.map((m) => m.clone())
          : obj.material.clone();
      }
    });
  }
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material || obj.userData.halo) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      m.transparent = trans;
      m.opacity = alpha;
      m.depthWrite = !trans;
      m.needsUpdate = true;
    }
  });
}

// Mob liveness: still alive in this dimension. A mob that dies or changes
// dim mid-flight severs the hook (retract, no placement) like a mined block.
function mobAlive(h) {
  return h.ref && h.ref.alive !== false && (h.ref.dim ?? "over") === dim;
}

// Grab retarget: the body-middle anchor is re-derived from the live mob
// position every frame (flight and haul alike), so the hook follows a
// moving body; the landing tracks the hold pose below the sight line, so
// both ends follow a moving mob and a moving player mid-flight.
function retargetMobGrab(h) {
  h.ax = h.ref.pos.x + h.ox;
  h.ay = h.ref.pos.y + h.oy;
  h.az = h.ref.pos.z + h.oz;
  const f = holdFeet(eyePos(), lookDir(), h.ref.h ?? 1);
  h.tx = f.x;
  h.ty = f.y;
  h.tz = f.z;
}

// Release retarget: the shared player landing, recomputed live every frame
// (column edits under a flying head track exactly like the player grapple).
function retargetMobRelease(h) {
  const r = resolveBlockLanding(isSolid, h.bx, h.by, h.bz, [h.fx, h.fy, h.fz], h.spec.headOff);
  h.topLand = r.topLand;
  h.tx = r.tx; h.ty = r.ty; h.tz = r.tz;
  h.ax = r.ax; h.ay = r.ay; h.az = r.az;
}

// Release ride: the mob visibly rides the head (feet hang half a body below
// it) from the hand to the target cell.
function rideMobOnHead(h) {
  h.ref.pos.set(h.hx - h.ox, h.hy - h.oy, h.hz - h.oz);
  if (h.ref.root) h.ref.root.rotation.y = yaw + Math.PI;
}

function arriveMobGrab(h) {
  holdMob(h.ref);
  if (h.ref.vel?.set) h.ref.vel.set(0, 0, 0);
  setMobAlpha(h.ref, HELD_ALPHA);
  finishMobHook(h);
}

function abortMobGrab(h) {
  h.ref._carried = false; // flight abort: the mob was never frozen, it just
  setMobAlpha(h.ref, 1); // keeps moving; haul abort frees it instead
}

// Grab latch: the head just reached the live body — freeze it now (it kept
// moving, e.g. falling, for the whole flight). The haul owns its frame
// from here on.
function latchMobGrab(h) {
  latchMob(h.ref);
}

function arriveMobRelease(h) {
  // Player-equivalent arrival at the shared landing, validated with the mob
  // body: gaps first (conditional, like applyArriveGap), then the spot,
  // then a same-level ring only — never above. A blocked landing re-holds
  // instead of manufacturing support overhead; gravity then decides exactly
  // as if the player had been released there (falls iff unsupported). A
  // placed mob keeps facing the release direction and walks it (mover yaw
  // convention: same yaw + PI as the held pose, zero visual snap).
  const mob = h.ref;
  const hw = mob.hw ?? 0.3, mh = mob.h ?? 1;
  // Peer veto: never release onto a live mob's body — a peer-held spot
  // reads exactly like a walled one (fit-gated release re-holds instead).
  const peers = allMobs().filter((o) => o !== mob && o.alive && (o.dim ?? dim) === (mob.dim ?? dim));
  const peerFree = (x, y, z) => releasePeerFree(peers, mob, x, y, z);
  // Shared resolution (see carry.js): gaps, then the same-level ring.
  const spot = mobReleaseSpot(isSolid, hw, mh, h.bx, h.by, h.bz, [h.fx, h.fy, h.fz], peerFree, h.spec);
  if (spot) {
    mob.pos.set(spot.x, spot.y, spot.z);
    settleReleased(mob, yaw + Math.PI);
    setMobAlpha(mob, 1);
  } else {
    holdMob(mob); // nowhere free: keep holding instead of embedding
    setMobAlpha(mob, HELD_ALPHA);
  }
  finishMobHook(h);
}

function abortMobRelease(h) {
  holdMob(h.ref); // back to the hold pose, still frozen
  setMobAlpha(h.ref, HELD_ALPHA);
}

// Mob grab fire: latch the body middle on the live body and fly the head
// out — the mob stays simulated (a falling mob keeps falling) while the
// head homes on its live anchor; the latch freezes it, then the haul owns
// its frame to the hand.
function fireMob(t, spec) {
  const mob = t.ref;
  if (!mob || mob.alive === false || (mob.dim ?? "over") !== dim || mob._carried || heldMob()) return false;
  if (!mobType(mob.type)?.capabilities?.grabbable) return false;
  const c = mobCenterOffset(mob);
  const a = {
    kind: "mob", spec, ref: mob, ox: c.x, oy: c.y, oz: c.z,
    alive: mobAlive, retarget: retargetMobGrab, latch: latchMobGrab, onArrive: arriveMobGrab, onAbort: abortMobGrab,
  };
  hookRetarget(a);
  const sx = pos.x, sy = pos.y + spec.eyeDy, sz = pos.z;
  if (Math.hypot(a.ax - sx, a.ay - sy, a.az - sz) < 0.3) return false;
  const dist = Math.hypot(a.ax - sx, a.ay - sy, a.az - sz);
  hook = { ...a, sx, sy, sz, tx: a.tx, ty: a.ty, tz: a.tz, hx: sx, hy: sy, hz: sz, fly: 0, dist, flying: true, arrived: false, pulling: false, stuck: 0 };
  line = { spec, hx: sx, hy: sy, hz: sz, retracting: false };
  setGhostPass((bx, by, bz) => !!hook && !hook.arrived && hookGhost(bx, by, bz, hook));
  return true;
}

// Mob release fire: hands empty while the hook ferries the held mob to the
// shared player-equivalent landing for the aimed block (same conditions,
// ride-up included — a released mob falls if and only if the player would
// have fallen there after arrival + release).
function fireMobRelease(t, spec) {
  const mob = t.ref;
  if (!mob || heldMob() !== mob) return false;
  holdMob(null);
  mob._carried = true;
  const face = t.face ?? [0, 1, 0];
  const a = {
    kind: "mobRelease", spec, ref: mob, ox: 0, oy: (mob.h ?? 1) * 0.5, oz: 0,
    bx: t.cx, by: t.cy, bz: t.cz, fx: face[0], fy: face[1], fz: face[2],
    alive: mobAlive, retarget: retargetMobRelease, ride: rideMobOnHead,
    onArrive: arriveMobRelease, onAbort: abortMobRelease,
  };
  hookRetarget(a);
  const sx = pos.x, sy = pos.y + spec.eyeDy, sz = pos.z;
  if (Math.hypot(a.tx - sx, a.ty - sy, a.tz - sz) < 0.3) { holdMob(mob); return false; }
  const dist = Math.hypot(a.tx - sx, a.ty - sy, a.tz - sz);
  hook = { ...a, sx, sy, sz, hx: sx, hy: sy, hz: sz, fly: 0, dist, flying: true, arrived: false, pulling: false, stuck: 0 };
  line = { spec, hx: sx, hy: sy, hz: sz, retracting: false };
  setGhostPass((bx, by, bz) => !!hook && !hook.arrived && hookGhost(bx, by, bz, hook));
  return true;
}

// Mob-hook teardown: retract the rope with no player fling. Arrival converts
// (hold/place) through onArrive; ENTER-up aborts through onAbort.
function finishMobHook(h) {
  line = { spec: h.spec, hx: h.flying ? h.hx : h.ax, hy: h.flying ? h.hy : h.ay, hz: h.flying ? h.hz : h.az, retracting: true };
  clearHook();
}

function abortMobHook() {
  const h = hook;
  if (h?.onAbort) h.onAbort(h);
  if (h) line = { spec: h.spec, hx: h.flying ? h.hx : h.ax, hy: h.flying ? h.hy : h.ay, hz: h.flying ? h.hz : h.az, retracting: true };
  clearHook();
}

// "anchor-to-self": drive the mob toward the landing at the kind's haul
// speed while the head stays pinned on its anchor. The player frame freezes
// (like a settled grapple) so the hold pose can't drift mid-haul. Anchor
// death severs instead of placing thin air.
function pullAnchorToSelf(dt) {
  const h = hook, spec = h.spec, mob = h.ref;
  hookRetarget(h);
  if (!hookAlive(h)) { abortMobHook(); return false; }
  line.hx = h.ax; line.hy = h.ay; line.hz = h.az;
  const dx = h.tx - mob.pos.x, dy = h.ty - mob.pos.y, dz = h.tz - mob.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const step = (spec.mobPull ?? spec.pullSpeed) * dt;
  if (dist <= step + 0.15) {
    mob.pos.set(h.tx, h.ty, h.tz);
    h.hx = h.ax; h.hy = h.ay; h.hz = h.az;
    h.onArrive(h);
    return false;
  }
  const s = step / dist;
  mob.pos.x += dx * s;
  mob.pos.y += dy * s;
  mob.pos.z += dz * s;
  if (mob.root) mob.root.rotation.y = yaw + Math.PI;
  if (mob.vel?.set) mob.vel.set(0, 0, 0);
  h.hx = h.ax; h.hy = h.ay; h.hz = h.az;
  line.hx = h.ax; line.hy = h.ay; line.hz = h.az;
  h.pulling = true;
  return true;
}

// Re-resolve every frame (flight and pull): the rope anchor sits centered
// on the aimed face plane (top faces: column-top surface point;
// side/bottom faces: face-centered), so the latched cube sits half-buried
// in the block, while the player landing resolves top-or-before —
// a short stack rides up onto the anchor top, taller faces land in the
// free cell before the hit, feet at its bottom. Re-resolving in flight
// tracks column edits under a flying head; mob kinds track mob.pos here.
// The landing math is the shared rule in carry.js (mob release lands
// exactly where the player would).
function retargetBlock(h) {
  const r = resolveBlockLanding(isSolid, h.bx, h.by, h.bz, [h.fx, h.fy, h.fz], h.spec.headOff);
  h.topLand = r.topLand;
  h.topY = r.topY;
  h.tx = r.tx; h.ty = r.ty; h.tz = r.tz;
  h.ax = r.ax; h.ay = r.ay; h.az = r.az;
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
}

// Sever: instant silent teardown for teleports (out-of-level respawn, New
// World) — no fling, no retract ride across the jump. Release paths use
// cancelHook instead. Mob kinds abort through their own path instead of
// orphaning: a flying grab frees its (never frozen) mob, a ferry re-holds
// it — so a countdown liftoff never strands a carried mob with no holder.
export function severHook() {
  const h = hook;
  hook = null;
  line = null;
  hideRope();
  setGhostPass(null);
  if (h && (h.kind === "mob" || h.kind === "mobRelease") && h.onAbort) h.onAbort(h);
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
  // Reached the landing: snap onto it and stop dead. Rope stays pinned on
  // the face anchor until mouse-up. Settled movement is liquid-only: held
  // swim in liquid, frozen in open air until release.
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

// Shared ending: clear the anchor surface, pin the rope, stop dead. A settled
// hook only lets the player move while the body is in liquid; the rope stays
// attached either way. In open air it freezes until release.
function settleArrival() {
  applyArriveGap();
  hook.arrived = true;
  hook.pulling = false;
  // Rest spot: the rope shows from here on — tip alone until displaced.
  hook.px = pos.x; hook.py = pos.y; hook.pz = pos.z;
  line = { spec: hook.spec, hx: hook.ax, hy: hook.ay, hz: hook.az, retracting: false };
  vel.set(0, 0, 0);
  setOnGround(hook.topLand && landingSupported(pos.x, pos.y, pos.z));
}

// Settled frame: liquid hands movement back to physics (held swim while the
// body is submerged, wherever the shot came from). Open air owns the frame
// and holds the player still. Returns true when the hook owns the frame
// (frozen).
function settledFrame() {
  if (!hookAlive(hook)) { cancelHook(false); return false; }
  if (!headInWater()) { vel.set(0, 0, 0); hook.pulling = false; return true; }
  hook.pulling = false;
  return false;
}

// Main-loop dispatch: true while the held grapple owns liquid movement —
// settled, body submerged, fire origin irrelevant. The physics mover floats
// the top cell, swims deeper cells, drags a dry eye back under the surface,
// and never lets anyone out of the water. Portal anchors keep travel rules
// and never swim.
export function hookHeldSwim() {
  return !!hook && hook.arrived && hook.kind !== "portal" && headInWater();
}

// Release (middle mouse-up): mid-pull yank flings along the launch
// direction (pull speed in liquid, no fling); flying, settled, or standing
// releases just retract fast. Ground contact is re-measured so a settled
// drop never inherits a stale grounded jump. The head rides back to the eye;
// movement resumes at once. The mark detaches from the anchor with the
// head, so nothing stays welded on the face during the ride back.
export function cancelHook(fling = true) {
  if (!hook && !line) return;
  // Mob hooks never fling the player: ENTER-up aborts a flight (grab frees,
  // release re-holds) but never a latched grab haul — like master, the haul
  // to the hand always completes once the head has latched
  // (`grabHaulProtected`, regression-tested in carry.test.mjs).
  if (hook && hook.spec.pull === "anchor-to-self") {
    if (grabHaulProtected(hook.kind, hook.flying)) return;
    abortMobHook();
    return;
  }
  const spec = (hook && hook.spec) || (line && line.spec) || HOOK_TYPES[0];
  const pulling = hook ? !!hook.pulling : false;
  if (pulling) {
    const dx = hook.tx - hook.sx, dy = hook.ty - hook.sy, dz = hook.tz - hook.sz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (fling && !headInWater()) {
      vel.set(dx / dist * spec.flingSpeed, dy / dist * spec.flingSpeed, dz / dist * spec.flingSpeed);
      noteFling();
    } else if (headInWater()) {
      vel.set(dx / dist * spec.pullSpeed, dy / dist * spec.pullSpeed, dz / dist * spec.pullSpeed);
      noteFling();
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
// sliding along obstacles); head flight and settled liquid arrivals yield so
// the caller runs physics — falls continue under a flying head, and a settled
// hook with the body in liquid swims while held without ever leaving the
// water, wherever the shot came from. Settled stops in open air freeze in
// place, jump inert, until mouse-up; stalled pulls stop the same way.
// Returns true when the hook owns the frame (pulling/frozen); false
// otherwise, so the caller runs normal player physics with the visuals drawn.
export function updateHook(dt) {
  if (!hook) return false;
  if (hook.arrived) return settledFrame();
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
      if (hook.latch) hook.latch(hook); // grab latch: freeze the live body
      line = { spec, hx: hook.ax, hy: hook.ay, hz: hook.az, retracting: false };
      return false;
    }
    hook.hx = hook.sx + (hook.ax - hook.sx) * hook.fly;
    hook.hy = hook.sy + (hook.ay - hook.sy) * hook.fly;
    hook.hz = hook.sz + (hook.az - hook.sz) * hook.fly;
    if (hook.ride) hook.ride(hook); // release ferry: the mob rides the head
    line.hx = hook.hx; line.hy = hook.hy; line.hz = hook.hz;
    hook.pulling = false;
    return false;
  }
  // Pull-mode dispatch: grapple yanks the player to the landing; mob kinds
  // ("anchor-to-self") haul the anchor to the hand/cell instead.
  if (spec.pull === "self-to-anchor") return pullSelfToAnchor(dt);
  if (spec.pull === "anchor-to-self") return pullAnchorToSelf(dt);
  return false;
}

// "self-to-anchor": drive the player toward the landing in substepped
// collision + slide until close, then settle (free in liquid, frozen in air).
// The ride passes through any number of liquids in and out — only solids
// stop it (collision plus the stall guard below). Portal-fill pulls are
// exempt by kind: entering the fill is what fires travel.
function pullSelfToAnchor(dt) {
  const spec = hook.spec;
  hookRetarget(hook);
  if (!hookAlive(hook)) { cancelHook(false); return false; } // anchor gone: retract
  line.hx = hook.ax; line.hy = hook.ay; line.hz = hook.az;
  const dx = hook.tx - pos.x, dy = hook.ty - pos.y, dz = hook.tz - pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const step = spec.pullSpeed * dt;
  if (dist <= step + 0.001) {
    // Landing reached: snap on, or stop against it when blocked.
    if (landingFree(hook.tx, hook.ty, hook.tz)) arrive();
    else settleArrival(); // landing area reached but blocked: stop against it
    return settledFrame();
  }
  const px = pos.x, py = pos.y, pz = pos.z;
  const n = Math.max(1, Math.ceil(step / spec.substep));
  vel.set(dx / dist * spec.pullSpeed, dy / dist * spec.pullSpeed, dz / dist * spec.pullSpeed);
  for (let i = 0; i < n; i++) {
    collideBody(dt / n, playerBody, true);
  }
  const moved = Math.hypot(pos.x - px, pos.y - py, pos.z - pz);
  if (moved < step * 0.25) {
    if (++hook.stuck >= 3) { settleArrival(); return settledFrame(); } // stalled: stop in place
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
  applyRopeStyle(spec.rope);
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
