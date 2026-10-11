// Hook framework: pick → filter → fly → hook → pull → arrive/release → retract.
// A hook target is a descriptor; the picker is injected by the caller and the
// filter resolves it to an anchor point + landing, so new target kinds (mob
// grapple: { kind: "mob", ref }) add a table entry below, never a branch:
//   - picker(origin, dir) returns a descriptor or null (DDA, ray-vs-AABB…).
//   - the per-kind filter resolves it to an anchor point + landing.
// Hook kinds are data: shared flight/pull numbers live in HOOK_DEFAULTS,
// entries override only what differs — a new kind (grab-grapple, ...) is one
// registry entry with its own speeds, pull mode, and landing, never a fork.
// Grapple (middle-click block hook) is the first specialization. The head is
// a visible projectile: it flies out at throw speed, latches, then rides
// back to the eye on release. The pull runs through the shared axis movers
// in small substeps with the anchor column ghosted, so the player passes
// through it and lands on top.
import { pos, vel, playerBody, collideBody, headInWater, setOnGround, setGhostPass, setLandGlide } from "./physics.js";
import { isSolid } from "../core/store.js";
import { isSolidId } from "../core/blocks.js";
import { showRope, hideRope } from "./rope.js";
import { pickBlock } from "./edit.js";
import { flyOn } from "./fly.js";

const HOOK_DEFAULTS = {
  throwSpeed: 70,
  retractSpeed: 275,
  // Minimum visible retract time: close shots slow to dist/minTime so the
  // ride back always spans a few frames instead of snapping in one step.
  retractMinTime: 0.08,
  arriveDist: 1.1,
  substep: 0.4,
  chest: 1.3,
};

export const HOOK_TYPES = [
  {
    ...HOOK_DEFAULTS,
    key: "grapple",
    pullSpeed: 26,
    flingSpeed: 34,
    landGlide: 0.5,
    pull: "self-to-anchor",
    ghost: grappleGhost,
    retarget: retargetBlock,
  },
];

function hookKindOf(key) {
  return HOOK_TYPES.find((h) => h.key === key) ?? HOOK_TYPES[0];
}

let hook = null; // logic: { kind, spec, bx, by, bz, topY, tx, ty, tz, hx, hy, hz, flying }
let line = null; // visual rope: { spec, hx, hy, hz, stuck, retracting, total? }

export function hookActive() {
  return !!hook;
}

// Block picker for the grapple: DDA hit → descriptor. Mob pickers return
// { kind: "mob", ref } and plug into fireHookTarget the same way.
export function grappleBlockPick(origin, dir) {
  const hit = pickBlock(origin, dir, true, 64);
  return hit ? { kind: "block", x: hit.x, y: hit.y, z: hit.z, id: hit.id } : null;
}

export function fireHookTarget(pick, origin, dir, kindKey = "grapple") {
  if (flyOn || hook) return false;
  const target = pick(origin, dir);
  if (!target) return false;
  // Registry dispatch, no kind-name switches: the filter table resolves the
  // target kind to an anchor. Unknown kinds (mob, ...) have no entry yet and
  // refuse, until they ship as table entries with follow-pull behavior.
  const fire = TARGET_FILTERS[target.kind];
  if (!fire) return false;
  return fire(target, hookKindOf(kindKey));
}

// Only standable blocks anchor: non-solid hits (flowers, liquids) have no
// top to land on.
function fireBlock(t, spec) {
  if (!isSolidId(t.id)) return false;
  const a = { kind: "block", bx: t.x, by: t.y, bz: t.z };
  spec.retarget(a);
  const tx = a.tx, ty = a.ty, tz = a.tz;
  if (Math.hypot(tx - pos.x, ty - pos.y, tz - pos.z) < 0.3) return false;
  hook = { ...a, spec, tx, ty, tz, hx: pos.x, hy: pos.y + spec.chest, hz: pos.z, flying: true };
  line = { spec, hx: pos.x, hy: pos.y + spec.chest, hz: pos.z, stuck: false, retracting: false };
  setGhostPass((bx, by, bz) => !!hook && hook.spec.ghost(bx, by, bz, hook));
  vel.set(0, 0, 0);
  return true;
}

const TARGET_FILTERS = { block: fireBlock };

// Re-resolve a block anchor every pull step: ride a 1-block stack up
// (master parity); taller pillars keep the base as the target and the
// landing gate below turns the pull into a hang instead of a clip.
function retargetBlock(h) {
  let q = 0;
  while (isSolid(h.bx, h.by + q + 1, h.bz)) q++;
  h.topY = q <= 1 ? h.by + q : h.by;
  h.tx = h.bx + 0.5; h.ty = h.topY + 1.001; h.tz = h.bz + 0.5;
}

// The anchor column is passable while pulling through it.
function grappleGhost(bx, by, bz, h) {
  return !h.flying && h.kind === "block" &&
    bx === h.bx && bz === h.bz && by >= h.by && by <= h.topY;
}

// Landing needs two free cells above the anchor top (air or liquid).
function anchorPass(a) {
  return !isSolid(a.bx, a.topY + 1, a.bz) && !isSolid(a.bx, a.topY + 2, a.bz);
}

function clearHook() {
  hook = null;
  setGhostPass(null);
}

function arrive() {
  // Rope stays pinned to the anchor (drawn by tickHookFx) until release.
  // Horizontal pull speed carries into a short glide (see spec landGlide).
  const spec = hook.spec;
  line = { spec, hx: hook.tx, hy: hook.ty, hz: hook.tz, stuck: true, retracting: false };
  pos.set(hook.tx, hook.ty, hook.tz);
  setOnGround(true);
  clearHook();
  const sp = Math.hypot(vel.x, vel.z);
  if (sp > spec.pullSpeed) { vel.x *= spec.pullSpeed / sp; vel.z *= spec.pullSpeed / sp; }
  vel.y = 0;
  setLandGlide(spec.landGlide);
}

// Release: fling along the head direction (plain pull-through in liquid,
// no fling). The head rides back to the eye; movement resumes at once.
export function cancelHook(fling = true) {
  if (!hook && !line) return;
  const spec = (hook && hook.spec) || (line && line.spec) || HOOK_TYPES[0];
  const ax = hook ? (hook.flying ? hook.hx : hook.tx) : line.hx;
  const ay = hook ? (hook.flying ? hook.hy : hook.ty) : line.hy;
  const az = hook ? (hook.flying ? hook.hz : hook.tz) : line.hz;
  const dx = ax - pos.x, dy = ay - pos.y, dz = az - pos.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  if (fling && !headInWater()) {
    vel.set(dx / dist * spec.flingSpeed, dy / dist * spec.flingSpeed, dz / dist * spec.flingSpeed);
  } else if (headInWater()) {
    vel.set(dx / dist * spec.pullSpeed, dy / dist * spec.pullSpeed, dz / dist * spec.pullSpeed);
  } else {
    vel.set(0, 0, 0);
  }
  if (line) line.retracting = true;
  clearHook();
}

// Runs in place of updatePlayer while the hook is live: fly the head out,
// then yank toward the anchor top until close, hanging when the landing is
// blocked instead of clipping in.
export function updateHook(dt) {
  if (!hook) return;
  const spec = hook.spec;
  if (hook.flying) {
    const dx = hook.tx - hook.hx, dy = hook.ty - hook.hy, dz = hook.tz - hook.hz;
    const dist = Math.hypot(dx, dy, dz);
    const step = spec.throwSpeed * dt;
    if (dist <= step) {
      hook.hx = hook.tx; hook.hy = hook.ty; hook.hz = hook.tz;
      hook.flying = false;
      line = { spec, hx: hook.tx, hy: hook.ty, hz: hook.tz, stuck: true, retracting: false };
      return;
    }
    hook.hx += dx / dist * step;
    hook.hy += dy / dist * step;
    hook.hz += dz / dist * step;
    line.hx = hook.hx; line.hy = hook.hy; line.hz = hook.hz;
    return;
  }
  hook.spec.retarget(hook);
  line.hx = hook.tx; line.hy = hook.ty; line.hz = hook.tz;
  if (!anchorPass(hook)) { vel.set(0, 0, 0); return; }
  const dx = hook.tx - pos.x, dy = hook.ty - pos.y, dz = hook.tz - pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < spec.arriveDist) { arrive(); return; }
  const px = pos.x, py = pos.y, pz = pos.z;
  const step = Math.min(dist, spec.pullSpeed * dt);
  const n = Math.max(1, Math.ceil(step / spec.substep));
  vel.set(dx / dist * spec.pullSpeed, dy / dist * spec.pullSpeed, dz / dist * spec.pullSpeed);
  for (let i = 0; i < n; i++) collideBody(dt / n, playerBody, true);
  const moved = Math.hypot(pos.x - px, pos.y - py, pos.z - pz);
  if (moved < step * 0.25) { arrive(); return; }
}

// Visual tick, runs every frame even while walking: draws the live rope
// and rides a released head back to the eye.
export function tickHookFx(dt) {
  if (!line) return;
  const spec = line.spec;
  const cx = pos.x, cy = pos.y + spec.chest, cz = pos.z;
  if (line.retracting) {
    const dx = cx - line.hx, dy = cy - line.hy, dz = cz - line.hz;
    const dist = Math.hypot(dx, dy, dz);
    // Constant slowed speed from the initial gap: far shots keep full
    // speed, close ones ride at total/minTime so the trip lasts minTime.
    if (line.total == null) line.total = dist;
    const fullSpeed = spec.retractSpeed;
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
  }
  showRope(cx, cy, cz, line.hx, line.hy, line.hz);
}
