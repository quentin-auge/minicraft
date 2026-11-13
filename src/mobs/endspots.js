// Enderman teleport geometry (three-free, pure): world-band capping, the
// staged destination picker, and the pre-contact dodge check. No THREE,
// no scene, no rand stream of its own: randomness arrives via the caller's
// `rand` (the End module threads its seeded `mobHash` stream), voxel reads
// and the camera read via injected probes
// (`groundY`/`free`/`supported`/`inBounds`/`inView`/`los`/`mobBlocked`).
// Headless-tested by `tests/headless/mobs/enderman-bands.test.mjs`.
import { WORLD_RADIUS } from "../core/store.js";
import { CLOUD_MIN_Y, CLOUD_MAX_Y } from "../world/clouds.js";
import { MOON_MIN_Y } from "../world/moon.js";
import { worstPairPenAt, SEP_Y, PUSH_T, GATE_ALLOW, FARM_WALK } from "./mover.js";

// Staged teleport picker. Stage k ≥ 0 widens the search one axis at a time:
// even stages widen the XZ ring, odd stages raise the height ceiling —
//   XY ∈ [5 + 5·⌈k/2⌉, 10 + 5·⌈k/2⌉], |ΔY surface| ∈ [0, 5 + 5·⌊k/2⌋].
// (k=0: 5–10 out, 0–5 up/down; k=1: 10–15 out, 0–5; k=2: 10–15, 0–10; …).
// The height band stays anchored at 0: flat ground validates at every
// stage, higher stages only ADD elevated/depressed options on top.
// Each ring samples 16 bearings × 3 distances; the arrival Y is the column
// surface (towers count), so flat ground hits at stage 0. Nothing on the
// path blocks: only the arrival validates — in-bounds, ≥10 m from the
// player, same world band, free body volume, solid-or-liquid footing, seen
// (strictly inside the camera field, a metric lateral clearance off the view
// axis, line-of-sight clear), no live body overlap. The first ring holding
// any valid spot wins, drawn 1/distance-weighted among its valid spots —
// near wins, with variety.
// Returns `{ spot, stats }` (rejections per cause) or null-spot past KMAX.
export const STAGE_STEP = 5;
export const STAGE_KMAX = 72; // XY reach ≥ 200: the whole map from anywhere
// Standoff to the player: arrivals stay 10+ blocks away — the mob may blink
// aside, never onto you.
export const FAR_FROM_PLAYER = 10;
// Pre-contact horizon (s): the dodge fires on contact predicted ~two fork
// samples out — very shortly before contact, never across the map.
export const DODGE_T = [0.25, 0.5];
// Player vertical gate (taller than the mob SEP_Y: the player is 1.8 deep).
export const PLAYER_SEP_Y = 1.5;

// 16 unit bearings (cardinals, diagonals, half-winds): every ring samples
// all of them, so a pocket between two cardinal rays is never missed.
const DIRS16 = [];
for (let i = 0; i < 16; i++) {
  const a = (i * Math.PI) / 8;
  DIRS16.push([Math.sin(a), Math.cos(a)]);
}

// World band of a feet-Y position: the teleport may never leave it.
// Overworld has three bands (ground below the clouds, the cloud decks as one
// band so intra/inter-layer hops are legal, the moon); the 460–850 sky gap
// is bandless void and teleports never fire there. The Nether, the End, and
// the TNT sky are single-band worlds.
export function bandOf(dimName, y) {
  if (dimName === "end") return "platform";
  if (dimName === "nether") return "level";
  if (dimName === "tnt") return "clouds";
  if (dimName === "over") {
    if (y < CLOUD_MIN_Y) return "ground";
    if (y <= CLOUD_MAX_Y) return "clouds";
    if (y >= MOON_MIN_Y) return "moon";
    return "none";
  }
  return "none";
}

function shuffledIdx(n, rand) {
  const o = [];
  for (let i = 0; i < n; i++) o.push(i);
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = o[i]; o[i] = o[j]; o[j] = t;
  }
  return o;
}

// Blast-crater exclusion for pre-carve teleports (normal/mega): arrivals
// whose mid-body sits inside any blast sphere are banned (closed ball, same
// convention as the pool union). Ultra teleports fire once the wipe drains,
// so the probes read the surface that remains and no exclusion is needed.
// Fits pickSpot's `exclude(x, y, z)` gate below.
export function sphereExclude(spheres, midH = 1) {
  return (x, y, z) => {
    for (const s of spheres) {
      const dx = x - (s.x + 0.5), dy = (y + midH) - (s.y + 0.5), dz = z - (s.z + 0.5);
      if (dx * dx + dy * dy + dz * dz <= s.r * s.r) return true;
    }
    return false;
  };
}
// Blast descriptor → both teleport predicates from one geometry, so the
// trigger and the landing can never disagree: `caught` selects exactly the
// mobs the blast could have touched, `exclude` keeps arrivals out of the
// carved void. Balls (normal/mega, valid outside pre-carve) report spheres;
// bands and windows (ultra, post-carve) report their wiped feet-Y range with
// no exclusion — the probes read the surface that remains.
export function blastPredicates(blast) {
  if (blast.spheres) {
    const inside = sphereExclude(blast.spheres);
    return { caught: inside, exclude: inside };
  }
  const { yLo, yHi } = blast;
  return {
    caught: (x, y, z) => y >= yLo && (yHi == null || y <= yHi),
    exclude: null,
  };
}
// Staged destination picker. Stage k ≥ 0 widens the search one axis at a time:
// even stages widen the XZ ring, odd stages raise the height ceiling —
//   XY ∈ [5 + 5·⌈k/2⌉, 10 + 5·⌈k/2⌉], |ΔY surface| ∈ [0, 5 + 5·⌊k/2⌋].
// (k=0: 5–10 out, 0–5 up/down; k=1: 10–15 out, 0–5; k=2: 10–15, 0–10; …).
// The height band stays anchored at 0: flat ground validates at every
// stage, higher stages only ADD elevated/depressed options on top.
// Each ring samples 16 bearings × 3 distances; the arrival Y is the column
// surface (towers count), so flat ground hits at stage 0. Nothing on the
// path blocks: only the arrival validates — in-bounds, ≥10 m from the
// player, free body volume on solid-or-liquid footing, seen (strictly in the
// camera field with a metric off-axis clearance, line-of-sight clear), same
// world band, no live body overlap. The first ring holding any valid spot
// wins, drawn 1/distance-weighted among its valid spots — near wins, with
// variety.
// Relaxation rungs, visibility-first (a teleported mob must stay findable):
// when a full scan finds nothing, the search reruns dropping one gate at a
// time — R1 the player standoff, R2 the frustum, R3 the line of sight, R4
// the band — then R5 takes the nearest free + supported cell in a small
// spiral, ignoring everything else. Only a true void (nothing to stand on)
// fails. The optional `exclude(x, y, z)` gate (blast craters) is never
// relaxed: arrivals it bans count `crater` rejections on every rung and in
// the spiral alike. An occluded spot is therefore only ever accepted once no
// line-of-sight-clear spot exists at any range, and a same-room visible spot
// close to the player beats every invisible one. Returns `{ spot, stats,
// level }`: `spot` is `{x, y, z}` or null, `level` is the winning rung
// (0–5) or null, `stats` counts rejections per cause across all rungs.
export function pickSpot({
  dim, band, from, hw, h, player = null,
  groundY, free, supported, mobBlocked, inBounds, inView = null, los = null,
  exclude = null, rand = Math.random, kmax = STAGE_KMAX,
}) {
  const stats = {
    bounds: 0, near: 0, surface: 0, height: 0, band: 0, view: 0, los: 0,
    free: 0, support: 0, mob: 0, crater: 0,
  };
  const farFromPlayer = !player ? () => true : (x, z) =>
    Math.hypot(x - player.x, z - player.z) >= FAR_FROM_PLAYER;
  const valid = (x, z, yHi, rung) => {
    if (!inBounds(x, z)) { stats.bounds++; return null; }
    // Visibility-first ladder: the standoff drops first (R1), so a visible
    // same-room spot near the player beats every invisible one; the line of
    // sight drops last (R3), so an occluded spot only wins once no
    // sight-clear spot exists at any range.
    if (rung <= 0 && !farFromPlayer(x, z)) { stats.near++; return null; }
    const y = groundY(x, z, yHi);
    if (y == null) { stats.surface++; return null; }
    if (Math.abs(y - from.y) > yHi) { stats.height++; return null; }
    // Blast exclusion (never relaxed, every rung): a crater arrival is
    // rejected wherever the search looks — the mob lands outside, or via
    // the R5 spiral when the whole neighbourhood is gone.
    if (exclude && exclude(x, y, z)) { stats.crater++; return null; }
    if (rung <= 3 && bandOf(dim, y) !== band) { stats.band++; return null; }
    if (!free(x, y, z, hw, h)) { stats.free++; return null; }
    if (!supported(x, y, z, hw)) { stats.support++; return null; }
    if (rung <= 1 && inView && !inView(x, y, z)) { stats.view++; return null; }
    if (rung <= 2 && los && !los(x, y, z)) { stats.los++; return null; }
    if (mobBlocked && mobBlocked(x, y, z, hw, h)) { stats.mob++; return null; }
    return { x, z, y };
  };
  for (let rung = 0; rung <= 4; rung++) {
    for (let k = 0; k <= kmax; k++) {
      const xyLo = STAGE_STEP + STAGE_STEP * Math.ceil(k / 2);
      const yHi = STAGE_STEP + STAGE_STEP * Math.floor(k / 2);
      const found = [];
      for (const i of shuffledIdx(DIRS16.length, rand)) {
        for (let s = 0; s < 3; s++) {
          const d = xyLo + ((s + rand()) / 3) * STAGE_STEP;
          const x = Math.round(from.x + DIRS16[i][0] * d);
          const z = Math.round(from.z + DIRS16[i][1] * d);
          const spot = valid(x, z, yHi, rung);
          if (spot) found.push({ spot, w: 1 / d });
        }
      }
      if (found.length) {
        let total = 0;
        for (const f of found) total += f.w;
        let r = rand() * total;
        for (const f of found) {
          r -= f.w;
          if (r <= 0) return { spot: f.spot, stats, level: rung };
        }
        return { spot: found[found.length - 1].spot, stats, level: rung };
      }
    }
  }
  // Last resort: the nearest free + supported cell, ignoring range, band,
  // player and view — a mob that cannot land anywhere else still lands.
  for (let r = 1; r <= 8; r++) {
    for (const dy of [0, -1, -2, -3, -4, -5, -6]) {
      for (const i of shuffledIdx(DIRS16.length, rand)) {
        const x = Math.round(from.x + DIRS16[i][0] * r);
        const z = Math.round(from.z + DIRS16[i][1] * r);
        const y = Math.round(from.y + dy);
        if (!inBounds(x, z)) { stats.bounds++; continue; }
        if (!free(x, y, z, hw, h)) { stats.free++; continue; }
        if (!supported(x, y, z, hw)) { stats.support++; continue; }
        if (exclude && exclude(x, y, z)) { stats.crater++; continue; }
        if (mobBlocked && mobBlocked(x, y, z, hw, h)) { stats.mob++; continue; }
        return { spot: { x, y, z }, stats, level: 5 };
      }
    }
  }
  return { spot: null, stats, level: null };
}

// Teleport retry gate (anti retry-storm): a failed attempt arms a cooldown
// on the mob; attempts while it runs are skipped. Pure in sim-time.
export const TELEPORT_COOL = 1.5;
export function teleportReady(mob, now) {
  return (mob.teleportCoolUntil ?? -Infinity) <= now;
}
export function armTeleportCool(mob, now) {
  mob.teleportCoolUntil = now + TELEPORT_COOL;
}

// Pre-contact dodge: true when a live same-dim peer already overlaps past
// the push threshold (immediate contact) or will overlap past the crossing
// budget inside the dodge horizon (very shortly before contact). The
// enderman itself barely moves, so it is posed static while peers run along
// their yaw at stride; the player runs on its velocity. `self` and mob peers
// carry `{pos, yaw, hw, nose, tail, alive, dim, type, speed}` (nose/tail may
// be neutral `{along:0,r:0}`); `player` is `{x, y, z, vx, vz} | null` with
// `playerHw`. Holders (rank ≥ 3) and the dragon/fish kinds never trigger:
// their line is someone else's problem. Returns `{dodge, immediate}`.
export function shouldDodge({ self, peers = [], player = null, playerHw = 0.3, mobRank = null }) {
  const sx = Math.sin(self.yaw), sz = Math.cos(self.yaw);
  const threatKind = (o) => o.type !== "dragon" && o.type !== "fish";
  const eligible = (o) => {
    if (o === self || !o.alive) return false;
    if (o.dim !== self.dim) return false;
    if (!threatKind(o)) return false;
    if (mobRank && mobRank(o) >= 3) return false;
    if (Math.abs(o.pos.y - self.pos.y) > SEP_Y) return false;
    return true;
  };
  for (const o of peers) {
    if (!eligible(o)) continue;
    const w = worstPairPenAt(self.pos.x, self.pos.z, sx, sz, self.hw, self.nose, self.tail, o, 0, 0);
    if (w && w.pen > PUSH_T) return { dodge: true, immediate: true };
  }
  for (const o of peers) {
    if (!eligible(o)) continue;
    const sp = o.speed ?? FARM_WALK;
    if (sp <= 0) continue;
    const ox = Math.sin(o.yaw), oz = Math.cos(o.yaw);
    for (const t of DODGE_T) {
      const px = o.pos.x + ox * sp * t, pz = o.pos.z + oz * sp * t;
      const posed = { pos: { x: px, y: o.pos.y, z: pz }, yaw: o.yaw, hw: o.hw, nose: o.nose, tail: o.tail };
      const w = worstPairPenAt(self.pos.x, self.pos.z, sx, sz, self.hw, self.nose, self.tail, posed, 0, 0);
      if (w && w.pen > GATE_ALLOW) return { dodge: true, immediate: false };
    }
  }
  if (player) {
    if (Math.abs(player.y - self.pos.y) <= PLAYER_SEP_Y) {
      const pose = {
        pos: { x: player.x, y: self.pos.y, z: player.z },
        yaw: Math.atan2(player.vx || 0, player.vz || 0),
        hw: playerHw, nose: { along: 0, r: 0 }, tail: { along: 0, r: 0 },
      };
      const w0 = worstPairPenAt(self.pos.x, self.pos.z, sx, sz, self.hw, self.nose, self.tail, pose, 0, 0);
      if (w0 && w0.pen > PUSH_T) return { dodge: true, immediate: true };
      const sp = Math.hypot(player.vx || 0, player.vz || 0);
      if (sp > 0) {
        for (const t of DODGE_T) {
          const moved = {
            ...pose, pos: { x: player.x + player.vx * t, y: self.pos.y, z: player.z + player.vz * t },
          };
          const w = worstPairPenAt(self.pos.x, self.pos.z, sx, sz, self.hw, self.nose, self.tail, moved, 0, 0);
          if (w && w.pen > GATE_ALLOW) return { dodge: true, immediate: false };
        }
      }
    }
  }
  return { dodge: false, immediate: false };
}

// World XZ clamp shared by the bounded dims (End callers pass their own).
export function boundedXZ(x, z, r = WORLD_RADIUS - 2) {
  return x >= -r && x <= r && z >= -r && z <= r;
}
