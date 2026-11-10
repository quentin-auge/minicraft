// Group predictive planner (three-free, pure): every tick, before any mob
// moves, all mobs rank 0+ reserve space-time along raw-heading tiered
// intents (lane axis, slot bearing, legacy commit-or-yaw). Planning order
// IS the priority matrix (see mobRank): holders (4 JAUNE 2-wide exits and
// threads, 3 SORTIE-1 1-wide exits), then VIOLET commits (2), then BLUE
// rides (1), then FREE roam (0); RED rails (-1) plan nothing but stand as
// live-pose obstacles. Most-blocked first inside a tier, so a stuck free
// mob never reserves ahead of a holder. Pairwise yield cannot see blocking
// cycles (A holds for B holds for C holds for A) or dense amasses; ordering
// the whole group over a shared horizon breaks them: the first mob keeps
// its line, the rest cross slowed when the brush stays shallow and sidestep
// narrow-first at full stride only when waiting won't resolve it — speed
// takes two levels only (full or PLAN_SLOW), the heading bends only for
// deep contact ahead of the nose, and forced headings stay raw (no wind snap:
// quantizing the cap up to half a wind off the re-aim is the gauche-droite
// stutter).
// Nothing here writes a position: it only fills `mob._plan =
// {heading, slow, forced} | null` plus one-shot `_wantDetach` (blue → free
// roam) / `_wantAbort` (wedged 1-wide committer → giveUp path) flags,
// consumed by every drive while latched (`mob._planHold`, `PLAN_HOLD` max,
// dropped only on expiry or a hard wall ahead — never on predicted peer
// contact).
// Advisory only: override solely on predicted contact deeper than the
// crossing budget inside `ENGAGE_T` (free roam and shallow brushes
// otherwise); a marginal contact coasts the episode wind a few ticks to
// bridge flicker, a truly free line stands down at once.
// Evasions scope: only forced maneuvers (plan/detour) hold a heading;
// free roam/wander stays raw (see roam.js, mover.js).
// Deterministic: fixed order, no rand stream. Headless-testable.
import { prepareNarrowPairs } from "./narrow.js";
import { normYaw, mobHeadsToCooledMouth } from "./corridor.js";
import { segmentWalkable } from "./step.js";
import { queryMobGrid } from "./grid.js";
import { worstPairPenAt, SEP_Y, PREDICT_T, GATE_ALLOW, CROSS_BUDGET, mobRank } from "./mover.js";
import { noseReach } from "./collide.js";

// Trajectory sampling: every quarter second out to the prediction
// horizon (~12 samples at farm stride — half a stride each, so no blind
// spots between samples at body scale; a half-second step leaves metre
// gaps a crossing falls through every other tick — sampling aliasing
// that reads as plan flicker). Slowed alternatives are a last resort
// only (spatial re-winds run full speed first); the floor stays near full
// stride so evasion never reads as hesitation.
export const FORECAST_STEP = 0.25;
export const PLAN_SLOW = 0.8;
// A forced plan latches up to this long: the drive turns at rate, so a one-tick
// plan would never finish its turn before the next override — chatter.
// A hold lasts while its threat stays imminent (intent still collides
// inside ENGAGE_T) and no wall blocks the way, and drops the moment the
// straight line home reads free again — resuming early is what keeps a
// sidestep from becoming a trek. Sidesteps latch shorter still: a dodge
// is one quick sidestep, re-evaluated as the geometry moves — holding a
// 45° wind for the full cap walks metres into the crowd, then swings
// back, and the swing is the stutter. Line-crossings (heading ≈ intent)
// keep the full cap: they ARE the line home, slowed.
// Peer brushes never break a hold (brushing through on the committed
// heading is the job); true stillness escalates through the stuck path,
// which voids the hold outright.
export const PLAN_HOLD = 1.5;
const SIDESTEP_HOLD = 0.6;
// Sidestep episode cap (s): a bent wind persists across hold drops while it
// stays walkable (sticky — re-dealing the wind every time the contact
// flickers around the engage threshold is the left-right dance), then the
// mob holds its commit line on reactive behavior only (yield + gate +
// maneuver) until the line reads free again. A line-aligned episode never
// left the line — no excursion to swing back from — so it re-deals fresh
// instead of locking in a slowed pass-through when the first attempt found
// every wind wedged (transient crowds unblock).
export const STICK_T = 2.0;
// Engage window (s): a plan is only forced when contact is predicted at or
// inside this — early and gentle beats late and sharp. The slow-first
// cascade below means most engages only cost speed, never heading.
// Steer window (s): lateral winds deal only inside this — past it, the
// mob holds its line slowed and lets the meeting sequence temporally
// (straight + predictable); steering is the imminent-contact fallback.
export const ENGAGE_T = 1.2;
const STEER_T = 0.5;
export function engageT() { return ENGAGE_T; }
// Wall horizon (m): how far ahead the planner reads voxels, plus the nose
// reach so the warning precedes snout contact. Shipped at 0.05: far walls
// never veto an evasion, near walls still turn the mob in time.
const WALL_H = 0.05;
export function wallHorizon() { return WALL_H; }

// Intended heading, tiered by avoidance rank (see mobRank): laned wall
// rides plan along the lane axis — turn-true (live yaw while the body still
// sweeps between axes mid-blend/junction/lock-turn, past 0.5 rad off axis),
// entry commits aim at the claimed slot (the commit heading goes stale
// under slides), free roam keeps the legacy commit-heading-or-yaw rule.
// Raw headings only, never wind-snapped.
// Never the hold heading: the hold branch tests whether the ORIGINAL line
// still collides — predicting along the dodge itself always reads clear
// (you are leaving the threat), so the hold would drop every other tick
// and the drive would flap. Peers expose the same fields (their reserved
// trajectories, not this function, tell others where they go).
function planIntent(mob) {
  if (mob.lane?.axis != null) {
    // Turn-true intent: on straight runs yaw already sits on the lane axis
    // (stable, no jitter); mid-blend/junction/lock-turn the axis has flipped
    // while the body still sweeps between axes — the live yaw is the truth.
    // Same half-radian divergence rule as the roam re-aim below, so intent
    // always reads the direction of actual motion, in corners or out.
    const axis = normYaw(mob.lane.axis);
    if (Math.abs(normYaw(mob.yaw - axis)) > 0.5) return normYaw(mob.yaw);
    return axis;
  }
  if (mob.roam?.entry === true && mob.target) {
    const dx = mob.target.x - mob.pos.x, dz = mob.target.z - mob.pos.z;
    if (dx * dx + dz * dz > 1e-6) return Math.atan2(dx, dz);
  }
  if (mob.roam?.mode === "commit" && mob.roam.heading != null) {
    const t = mob.target;
    if (t) {
      const dx = t.x - mob.pos.x, dz = t.z - mob.pos.z;
      if (dx * dx + dz * dz > 1e-6) {
        const aim = Math.atan2(dx, dz);
        if (Math.abs(normYaw(mob.roam.heading - aim)) > 0.5) return aim;
      }
    }
    return mob.roam.heading;
  }
  return mob.yaw;
}

// Steer cone (rad): sidesteps answer threats ahead of the nose, plus any
// converging peer at close range (corners meet near ~90° — see
// convergingNear). A contact predicted abreast (formation flight,
// converging parallels) sequences temporally on the slowed line instead of jinking sideways:
// steering at a flank contact, resuming the line, re-engaging as the
// formation closes again is the limit cycle that reads as gauche-droite
// stutter. Walls steer regardless (see wallAhead): static geometry
// converges, peer flicker doesn't.
const STEER_CONE = 0.7;
// Close-range convergence (corners): an incoming peer very close counts
// from any bearing — entering/exiting corners meet near ~90°, far outside
// the steer cone, yet the contact is real and imminent. Same-direction
// pairs (formation flight) are excluded, mirroring formationAhead exactly,
// so settled files never read as meetings. Corner meetings steer LATE
// only (hit inside STEER_T): distant engagements keep sequencing
// temporally on the slowed line, or mills churn sidestep-into-sidestep.
// One rule behind every phase and every rank: detection no longer depends
// on corridor geometry.
const CLOSE_R = 2.0;
function convergingNear(mob, intent, o, dx, dz, hit) {
  if (hit == null || hit > STEER_T) return false;
  if (dx * dx + dz * dz > CLOSE_R * CLOSE_R) return false;
  if (Math.cos(normYaw(o.yaw - intent)) >= 0.5) return false;
  // Actually converging, not merely crossing headings: the gap itself must
  // close (corner meetings, head-on bends). Same-rotation pen circlers on
  // adjacent walls hold perpendicular headings at close range while their
  // gap opens — dealing there is churn, not avoidance.
  const svx = Math.sin(intent) * mob.speed, svz = Math.cos(intent) * mob.speed;
  const os = o.speed ?? mob.speed;
  const rvx = Math.sin(o.yaw) * os - svx, rvz = Math.cos(o.yaw) * os - svz;
  if (dx * rvx + dz * rvz >= 0) return false;
  return true;
}
// Acute same-direction convergence (overtake / file catch-up at a slight
// angle): a peer ahead-close moving the same way whose gap actually closes.
// convergingNear above excludes same-direction pairs (formation flight), and
// fileAhead/file formation logic holds the line — so a follower at ~20°
// walks into the leader and grinds. Same circle math as every other read
// (positions/yaw/speed only, no new shape): narrow ahead cone, close range,
// same heading, closing gap. Imminent-only (hit inside STEER_T) like corner
// meetings, so settled files at constant spacing never read as meetings.
const ACUTE_R = 2.5;
const ACUTE_CONE = 0.9;
function acuteSameDir(mob, intent, o, dx, dz, hit) {
  if (hit == null || hit > STEER_T) return false;
  if (dx * dx + dz * dz > ACUTE_R * ACUTE_R) return false;
  if (Math.abs(normYaw(Math.atan2(dx, dz) - intent)) > ACUTE_CONE) return false;
  if (Math.cos(normYaw(o.yaw - intent)) < 0.5) return false;
  const svx = Math.sin(intent) * mob.speed, svz = Math.cos(intent) * mob.speed;
  const os = o.speed ?? mob.speed;
  const rvx = Math.sin(o.yaw) * os - svx, rvz = Math.cos(o.yaw) * os - svz;
  if (dx * rvx + dz * rvz >= 0) return false;
  return true;
}
// Ungated jam scan: any live same-level peer in acute same-direction
// convergence, regardless of rank (the rank gates in threatPeer would hide
// FREE followers from BLUE holders and vice versa — the jam is about the
// geometry, the matrix still decides who moves).
function acuteJamAhead(mob, intent, peers, hit) {
  if (hit == null || hit > STEER_T) return false;
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > ACUTE_R * ACUTE_R) continue;
    if (acuteSameDir(mob, intent, o, dx, dz, hit)) return true;
  }
  return false;
}
// One bearing rule behind every threat read: in-cone ahead of the nose,
// plus any close-range converging peer (corners meet near ~90° — see
// convergingNear), plus acute same-direction catch-ups (see acuteSameDir).
// coneOnly skips both omni parts (deal-ordering only).
function bearingHit(mob, intent, o, dx, dz, hit, coneOnly) {
  if (Math.abs(normYaw(Math.atan2(dx, dz) - intent)) <= STEER_CONE) return true;
  if (!coneOnly && convergingNear(mob, intent, o, dx, dz, hit)) return true;
  if (!coneOnly && acuteSameDir(mob, intent, o, dx, dz, hit)) return true;
  return false;
}
// One rank rule behind the matrix: free roamers (0) never trigger anyone
// (they plan last and go around); RED rails (-1) count as moving-wall
// obstacles for every minRank; otherwise the foe must meet minRank. A
// same-rank first planner that steered would yield to the later one, so the
// gates below order single yields.
function rankPass(o, minRank) {
  const r = mobRank(o);
  if (r === 0) return false;
  if (r !== -1 && r < minRank) return false;
  return true;
}
// One threat scan behind every threat read: the same peer loop and the
// same bearing rule, returning the first peer instead of a boolean —
// attributes a deal to the threat it answers, so the other side of the
// meeting can see who yielded. minRank null skips the rank gate (legacy
// peer-only reads, where free roamers count); otherwise the foe must meet
// the rank rule (see rankPass).
function threatPeer(mob, intent, peers, hit = null, coneOnly = false, minRank = null) {
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > 4 * 4) continue;
    if (minRank != null && !rankPass(o, minRank)) continue;
    if (bearingHit(mob, intent, o, dx, dz, hit, coneOnly)) return o;
  }
  return null;
}
function threatAhead(mob, intent, peers, hit = null, coneOnly = false) {
  return threatPeer(mob, intent, peers, hit, coneOnly) != null;
}
// Formation flight (rad + m + heading): a peer ahead-close moving the same
// way. Only formations adopt the sidestep line for good (line rebase):
// resuming the old line re-creates a meeting that never passes, while a
// crosser or head-on peer passes through on its own. Rebased lines walk
// parallel at the comfort gap instead of swinging back.
function formationAhead(mob, intent, peers) {
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > 3 * 3) continue;
    if (Math.abs(normYaw(Math.atan2(dx, dz) - intent)) > STEER_CONE) continue;
    if (Math.cos(normYaw(o.yaw - intent)) < 0.5) continue;
    return true;
  }
  return false;
}
// In-file following: a same-direction peer dead ahead in the corridor.
// Never steer here — match its pace (see followSlow) and hold the line;
// sidestepping around a leader breaks the file, and the gate stops any
// true rear-ending for the detour to own.
function fileAhead(mob, intent, peers) {
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > 3 * 3) continue;
    if (Math.abs(normYaw(Math.atan2(dx, dz) - intent)) > 0.35) continue;
    if (Math.cos(normYaw(o.yaw - intent)) < 0.9) continue;
    return true;
  }
  return false;
}
// Ungated alias of the unified scan (see threatPeer): deal attribution and
// yield lookup read peers, never ranks.
function threatPeerAhead(mob, intent, peers, hit = null, coneOnly = false) {
  return threatPeer(mob, intent, peers, hit, coneOnly);
}
// Yield window (s): a detach deal covers the separation, not just the
// tick — next tick the roles flip (the yielder dropped to rank 0, the
// holder still laned plans first) and the holder would re-evaluate the
// still-close yielder as a fresh threat and detach too. Matches the
// FOLLOW_COOL rhythm: the yielder cannot re-latch inside it anyway.
const DETACH_YIELD_T = 2.0;
// Yield agreement: the trigger already detached for me — it dealt a
// validated dodge this tick or left the meeting moments ago (still near,
// agreement fresh), so I hold my wall line instead of dealing a second
// detach (the deal below would drop us both). Same-tick order alone cannot
// settle this (roles flip once the yielder drops rank), so the deal needs
// this memory — and the trigger still shows its lane on the dealing tick
// itself, which must not void the agreement (its detach expresses in the
// mover this tick). The holder paces the yielder (yieldPace): full stride
// behind a frank dodge once it cleared close range, slowed behind a gentle
// one — and slowed behind ANY dodge still inside close range (CLOSE_R):
// the dodge expresses at turn rate while the holder would otherwise keep
// closing at full stride straight into it. Slows only while necessary —
// past close range the holder is back at the yielder's pace.
function yieldPace(mob, intent, peers, hit) {
  const trigger = threatPeerAhead(mob, intent, peers, hit);
  if (!trigger || trigger._detachFor !== mob) return null;
  if (!trigger.alive) return null;
  if ((trigger._detachForAge ?? 99) > DETACH_YIELD_T) return null;
  const dx = trigger.pos.x - mob.pos.x, dz = trigger.pos.z - mob.pos.z;
  if (dx * dx + dz * dz > 4 * 4) return null;
  if (Math.abs(trigger.pos.y - mob.pos.y) > SEP_Y) return null;
  if (!holdWayFree(mob, intent)) return null;
  const pace = trigger._plan?.slow ?? 1;
  if (dx * dx + dz * dz <= CLOSE_R * CLOSE_R) return Math.min(pace, PLAN_SLOW);
  return pace;
}
// Ranked threat: the same bearing rule gated by the rank rule — a threat
// worth abandoning the wall for. `minRank` splits the matrix: BLUE detaches
// for rails, holders, commits and rides (1); VIOLET only steers for holders,
// rails and commits (2 — BLUE rides and roamers yield to it, so it holds
// slowed and lets them go around).
function rankedThreatAhead(mob, intent, peers, minRank = 1, hit = null, coneOnly = false) {
  return threatPeer(mob, intent, peers, hit, coneOnly, minRank) != null;
}
// 1-wide abort gate: someone already inside the passage coming out —
// between me and my hole slot and heading outward (opposed to my push).
// Static wedges (rings, walls) fail every test below and hold slowed
// instead of aborting; the stall slide or detour owns them. 1-wide only:
// 2-wide exits are JAUNE holders with untouched steering.
function exiterBlocking1(mob, peers) {
  if ((mob.roam?.passageKind ?? 1) !== 1) return false;
  const t = mob.target;
  if (!t) return false;
  const dx = t.x - mob.pos.x, dz = t.z - mob.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const ux = dx / len, uz = dz / len;
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const ox = o.pos.x - mob.pos.x, oz = o.pos.z - mob.pos.z;
    if (ox * ox + oz * oz > 4 * 4) continue;
    const s = ox * ux + oz * uz;
    if (s <= 0 || s > len + 1.5) continue;
    if (Math.abs(ox * uz - oz * ux) > 0.6) continue;
    if (Math.sin(o.yaw) * ux + Math.cos(o.yaw) * uz < -0.5) return true;
  }
  return false;
}
// Formation spacing: a same-heading peer holding abreast inside the
// comfort gap. Returns a small fixed heading bias away from the peer
// (about 12°), or null when the file already holds its gap. No episode,
// no memory, no rebase: the bias is a pure function of the geometry, so
// it is identical every tick (a steady lateral drift, never a weave),
// and it simply stops applying once the gap opens. Only for settled
// formations (same heading, same pace) — crossings and scrums keep the
// engaged machinery, which owns real meetings.
function formationDrift(mob, intent, peers) {
  if ((mob._planHold && Math.abs(normYaw(mob._planHold.heading - intent)) > Math.PI / 8) ||
      (mob._prevForce && Math.abs(normYaw(mob._prevForce.heading - intent)) > Math.PI / 8)) {
    return null; // a committed sidestep already owns the heading
  }
  let best = null;
  const fx = Math.sin(intent), fz = Math.cos(intent);
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 2 * 2 || d2 < 1e-8) continue;
    if (Math.cos(normYaw(o.yaw - intent)) < 0.9) continue;
    if (Math.abs((o.speed ?? mob.speed) - mob.speed) > 0.5) continue;
    const lat = dx * fz - dz * fx;
    // Inner edge from the mover's own body half-width (circles-only): the old
    // 0.35 hard floor left very close abreast pairs with no drift answer at
    // all. Closer pairs hold the full bias (they need at least as much
    // separation, not less) instead of fading out.
    const inner = Math.max(0.2, mob.hw - 0.07);
    if (Math.abs(lat) < inner || Math.abs(lat) > 0.8) continue;
    if (!best || Math.abs(lat) < Math.abs(best.lat)) best = { lat };
  }
  if (!best) return null;
  // Fade the bias out as the gap opens (full at 0.35 m and closer, zero at
  // 0.8 m): switching a constant bias on and off at the boundary would flap
  // the heading every time the pair breathes across it.
  const scale = Math.min(1, Math.max(0, (0.8 - Math.abs(best.lat)) / 0.45));
  if (scale <= 0) return null;
  return normYaw(intent - Math.sign(best.lat) * 0.21 * scale);
}

// A latched hold survives predicted contacts — brushing through on the
// committed heading is the job (the gate caps brushes, the backstop
// clears them). It drops only on expiry or a hard wall ahead: the segment
// along the hold heading must stay walkable, since no turn can fix a wall.
// Peer deadlocks are the stuck detector's job (exact gate plus stillness),
// never the planner's — re-planning the hold on every predicted brush is
// exactly the every-second zigzag this replaces.
function holdWayFree(mob, heading) {
  const dist = 1.5;
  const tx = mob.pos.x + Math.sin(heading) * dist;
  const tz = mob.pos.z + Math.cos(heading) * dist;
  return segmentWalkable(mob, mob.pos.x, mob.pos.z, tx, tz);
}
// Wall immediately ahead along heading (planner scale: horizon plus the
// nose reach, so the warning precedes snout contact): the commit line runs
// into static geometry — steering around it converges, unlike peer
// flicker, and the near-wall turn is what keeps snouts off walls.
function wallAhead(mob, heading) {
  const reach = wallHorizon() + noseReach(mob);
  const tx = mob.pos.x + Math.sin(heading) * reach;
  const tz = mob.pos.z + Math.cos(heading) * reach;
  return !segmentWalkable(mob, mob.pos.x, mob.pos.z, tx, tz);
}
// Sampled trajectory: [{x, z, yaw}] at each step along heading at speed.
function extrapolate(mob, heading, speed) {
  const sx = Math.sin(heading), sz = Math.cos(heading);
  const out = [];
  for (let t = FORECAST_STEP; t <= PREDICT_T + 1e-9; t += FORECAST_STEP) {
    out.push({ x: mob.pos.x + sx * speed * t, z: mob.pos.z + sz * speed * t, yaw: heading });
  }
  return out;
}

// A peer body posed at a trajectory sample, for the shared circle math.
function poseLike(mob, s) {
  return {
    pos: { x: s.x, y: mob.pos.y, z: s.z }, yaw: s.yaw,
    hw: mob.hw, nose: mob.nose, tail: mob.tail,
  };
}

// Trajectory sample index: one spatial hash per time slice (cell 3 m).
// A live-pose query can never see a trajectory-vs-trajectory meeting —
// the other mob's body is metres away even as its path crosses mine — so
// every reserved trajectory's samples are bucketed here as they are
// planned. Per-sample queries then find both static bodies and crossing
// paths with the same 3 m reach. Rebuilt every planGroup call.
const TRAJ_CELL = 3;
function reserveTraj(mob, traj, reservations, trajGrids) {
  reservations.set(mob, { mob, traj });
  if (!trajGrids) return;
  for (let i = 0; i < traj.length && i < trajGrids.length; i++) {
    const s = traj[i];
    const g = trajGrids[i];
    const k = Math.floor(s.x / TRAJ_CELL) + "," + Math.floor(s.z / TRAJ_CELL);
    let bucket = g.get(k);
    if (!bucket) { bucket = []; g.set(k, bucket); }
    bucket.push(mob);
  }
}

// Free corridor along heading at effective speed: voxel-walkable end to
// end (the whole predicted path, not just the endpoint) AND touching no
// reservation at any sample. reservations maps mob → {mob, traj|null}
// (null = live pose only, for mobs planning later). grid (optional)
// restricts the neighbor scan per sample instead of all reservations:
// 3 m covers every circle-pair reach (nose tips meet at ~2 m), so the hit
// set — and the returned earliest time — is identical. Live bodies and
// reserved paths interleave per sample index: reporting the earliest hit
// requires both sets at each step, not one pass then the other. Pure.
const _trajNear = [];
const _trajLive = [];
function trajHitTime(mob, heading, effSpeed, reservations, grid = null, trajGrids = null, minPen = 0) {
  const sx = Math.sin(heading), sz = Math.cos(heading);
  const traj = extrapolate(mob, heading, effSpeed);
  // Pair checks first: in a crowd most candidates collide, and skipping
  // the voxel walk then is pure win. Both enumeration paths (full scan vs
  // grid) must agree exactly, so they share the shape below: earliest pair
  // hit across every peer, then the wall check (horizon plus nose reach,
  // so the warning precedes snout contact). A pair hit inside the
  // engage window short-circuits: every consumer only tests null vs
  // beyond-ENGAGE_T, so the wall state cannot change the decision. A
  // blocked wall inside the horizon with no imminent pair hit still
  // reports 0, exactly like the legacy wall-first order.
  let pairHit = null;
  if (grid && trajGrids) {
    // Interleaved per sample: the earliest hit across static bodies AND
    // reserved paths decides. Checking all live samples first would let a
    // later live hit mask an earlier trajectory hit (or vice versa).
    for (let i = 0; i < traj.length && pairHit == null; i++) {
      const s = traj[i];
      // Static bodies without a reserved path (mobs planning later).
      const near = queryMobGrid(grid, s.x, s.z, 3.0, _trajLive);
      for (let k = 0; k < near.length; k++) {
        const other = near[k];
        if (other === mob || !other.alive) continue;
        const entry = reservations.get(other);
        if (entry && entry.traj) continue; // checked via its samples below
        const o = poseLike(other, { x: other.pos.x, z: other.pos.z, yaw: other.yaw });
        if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
        const w = worstPairPenAt(s.x, s.z, sx, sz, mob.hw, mob.nose, mob.tail, o, 0, 0);
        if (w && w.pen > minPen) {
          pairHit = (i + 1) * FORECAST_STEP;
          break;
        }
      }
      // Reserved paths at the same time index (a crosser metres away
      // whose line meets mine — invisible to any live-pose query).
      if (pairHit == null) {
        const tg = trajGrids[Math.min(i, trajGrids.length - 1)];
        tg.cell = TRAJ_CELL;
        const tnear = queryMobGrid(tg, s.x, s.z, 3.0, _trajNear);
        for (let k = 0; k < tnear.length; k++) {
          const other = tnear[k];
          if (other === mob || !other.alive) continue;
          const entry = reservations.get(other);
          const os = entry && entry.traj
            ? entry.traj[Math.min(i, entry.traj.length - 1)]
            : { x: other.pos.x, z: other.pos.z, yaw: other.yaw };
          const o = poseLike(other, os);
          if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
          const w = worstPairPenAt(s.x, s.z, sx, sz, mob.hw, mob.nose, mob.tail, o, 0, 0);
          if (w && w.pen > minPen) {
            pairHit = (i + 1) * FORECAST_STEP;
            break;
          }
        }
      }
    }
  } else {
    for (let i = 0; i < traj.length && pairHit == null; i++) {
      const s = traj[i];
      for (const r of reservations.values()) {
        if (r.mob === mob || !r.mob.alive) continue;
        const o = r.traj ? poseLike(r.mob, r.traj[Math.min(i, r.traj.length - 1)])
          : poseLike(r.mob, { x: r.mob.pos.x, z: r.mob.pos.z, yaw: r.mob.yaw });
        if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
        const w = worstPairPenAt(s.x, s.z, sx, sz, mob.hw, mob.nose, mob.tail, o, 0, 0);
        if (w && w.pen > minPen) {
          pairHit = (i + 1) * FORECAST_STEP;
          break;
        }
      }
    }
  }
  if (pairHit != null && pairHit <= engageT()) return pairHit;
  const horizon = wallHorizon();
  if (horizon > 0) {
    // Read past the horizon by the nose reach (mode-free): the warning
    // must precede snout contact in both unification modes, or short
    // horizons trade exploration for head taps.
    const reach = horizon + noseReach(mob);
    const ex = mob.pos.x + sx * effSpeed * reach;
    const ez = mob.pos.z + sz * effSpeed * reach;
    if (!segmentWalkable(mob, mob.pos.x, mob.pos.z, ex, ez)) return 0;
  }
  return pairHit;
}

function trajFree(mob, heading, effSpeed, reservations, grid = null, trajGrids = null, minPen = 0) {
  return trajHitTime(mob, heading, effSpeed, reservations, grid, trajGrids, minPen) == null;
}

// Tiered-avoidance gates (rank >= 1 only — rank 0 keeps the legacy exact
// deal conditions bit-identical): every forced wind must walk on voxels
// (segment check covers drops and headroom, so detaches never strand a mob
// sideways into a wall or pit) and must not run back into the cooled mouth
// just left (the exit veto, so avoidance never ping-pongs a mob home).
function dodgeWalkable(mob, h, dist = 1.5) {
  const px = mob.pos.x + Math.sin(h) * dist, pz = mob.pos.z + Math.cos(h) * dist;
  return segmentWalkable(mob, mob.pos.x, mob.pos.z, px, pz);
}
function cooledAhead(mob, h, dist = 1.5) {
  if (!((mob.entryCoolT ?? 0) > 0 && mob.entryCoolKey != null)) return false;
  return mobHeadsToCooledMouth(
    mob, mob.pos.x + Math.sin(h) * dist, mob.pos.z + Math.cos(h) * dist);
}
// Committer slot gate: a dodge wind must keep the claimed slot reachable —
// the sidestep point walks from here AND the slot walks from there — so a
// sidestep stays hole-ward instead of dodging off the approach. False with
// no slot (never steer blind).
function slotGate(mob, h) {
  const t = mob.target;
  if (t == null) return false;
  const px = mob.pos.x + Math.sin(h) * 1.2, pz = mob.pos.z + Math.cos(h) * 1.2;
  return segmentWalkable(mob, mob.pos.x, mob.pos.z, px, pz) &&
    segmentWalkable(mob, px, pz, t.x, t.z);
}

// Narrow-first 8-wind offsets around a base wind (0 included: the current
// line always wins when free — minimal displacement).
const P = Math.PI;
const PLAN_WINDS = [0, P / 4, -P / 4, P / 2, -P / 2, (3 * P) / 4, -(3 * P) / 4, P];

// A live dodge episode still owns the heading while it stays valid: violet
// (rank 2) winds must keep the claimed slot reachable, laned winds must
// stay voxel-walkable and off the cooled mouth. Rank 0 keeps no gate
// (legacy peer-only deals, bit-identical).
function episodeWindValid(mob, heading) {
  if (mobRank(mob) === 2 && !slotGate(mob, heading)) return false;
  if (mob.lane && (!dodgeWalkable(mob, heading) || cooledAhead(mob, heading))) return false;
  return true;
}

// Narrow-first wind cascade around a base heading (0 included: the current
// line always wins when free — minimal displacement; slowed variants run
// last, spatial re-winds first). All winds stay raw: quantizing the cap off
// the re-aim reads as stutter. Deals stay within ±90° of the line: ordering
// a ±135° or U-turn wind reads as a spin — reversals belong to the stuck
// detour, which only fires on a hard block with a validated short sidestep.
function candidates(base) {
  const out = [{ h: base, slow: 1 }, { h: base, slow: PLAN_SLOW }];
  for (const dh of PLAN_WINDS.slice(1, 5)) out.push({ h: normYaw(base + dh), slow: 1 });
  for (const dh of PLAN_WINDS.slice(1, 5)) out.push({ h: normYaw(base + dh), slow: PLAN_SLOW });
  return out;
}
// Deal wind order: full-stride spatial re-winds first, slowed variants last
// — except corner (omni-only) deals, which go slowed-first. A late
// full-stride sidestep swings through third parties (mill churn for
// corner-grade meetings); a gentle bend resolves the corner while the slowed
// line keeps the gait. Full-stride stays as last resort, so a boxed corner
// with only a frank wind free still escapes.
function dealWinds(base, gentle) {
  const winds = candidates(base).slice(2);
  if (!gentle) return winds;
  return [...winds.filter((c) => c.slow < 1), ...winds.filter((c) => c.slow >= 1)];
}
// Bend-away deal order: prefer winds pointing away from the trigger's motion
// (reserved dodge heading when it dealt, else live yaw). Two meetings
// bending the same rotational way mirror each other and lock into a
// sustained grind; bending away from where the trigger goes breaks the
// symmetry deterministically. Tie → narrow-first. Voxel + reservation gates
// still decide freeness; this only orders preference.
function bendAway(winds, trigger) {
  if (!trigger) return winds;
  const tm = trigger._plan?.forced ? trigger._plan.heading : trigger.yaw;
  return [...winds].sort((a, b) =>
    Math.abs(normYaw(b.h - tm)) - Math.abs(normYaw(a.h - tm)) || winds.indexOf(a) - winds.indexOf(b));
}
// One dodge deal behind every phase: the narrowest free wind at full stride
// first (slowed-first for corner-only meetings), strictly free (GATE_ALLOW)
// so a brush-tolerant dodge never shoves into the next mob. Rank ≥ 1 adds
// the voxel + slot gates; rank 0 keeps the legacy peer-only deal
// bit-identical. Returns the deal plus its trigger, or null when wedged.
function dealDodge(mob, intent, peers, hit, rank, reservations, grid, trajGrids) {
  const minRank = rank >= 2 ? 2 : 1;
  const cone = rank >= 1
    ? rankedThreatAhead(mob, intent, peers, minRank, hit, true)
    : threatAhead(mob, intent, peers, hit, true);
  const trigger = threatPeerAhead(mob, intent, peers, hit);
  // Same-direction meetings keep narrow-first wind order: bending maximally
  // away from a leader's motion would pick a full perpendicular with no
  // forward progress (a follower's sidestep must stay goal-ward and
  // re-converge); opposed meetings keep the bend-away preference that
  // breaks mirror symmetry. Same yaw test as bendAway itself.
  const tm = trigger ? (trigger._plan?.forced ? trigger._plan.heading : trigger.yaw) : null;
  const ordered = (trigger == null || (tm != null && Math.cos(normYaw(tm - intent)) >= 0.5))
    ? dealWinds(intent, !cone)
    : bendAway(dealWinds(intent, !cone), trigger);
  for (const c of ordered) {
    if (rank >= 1) {
      if (rank === 2 && !slotGate(mob, c.h)) continue;
      if (!dodgeWalkable(mob, c.h) || cooledAhead(mob, c.h)) continue;
    }
    if (trajFree(mob, c.h, mob.speed * c.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
      return { ...c, trigger };
    }
  }
  return null;
}

// Staying threshold (loose): dealing a wind demands a strictly free
// corridor (GATE_ALLOW), but keeping one tolerates shallow brushes —
// the gate and the backstop clear up to CROSS_BUDGET anyway. A wind
// that toggles between strictly-free and brushed would otherwise
// flicker the drive every few ticks, and every plan-less tick yanks
// the yaw at full rate back toward the raw re-aim.
const STICKY_ALLOW = CROSS_BUDGET;

// Explicit plan rules: one function per phase, called in rule order
// (yield → convert → hold → free → engage) by the loop below. Each phase
// either decides the mob (true: plan placed, trajectory reserved) or
// declines (false: the next phase runs — only the hold phase can decline,
// when an expired or walled hold still sees contact ahead). Per-tick state
// travels in cx (mob, peers, grid, reservations, trajGrids, dt plus the
// place/tryYield/bridgeFree/holdLine/dealDetach closures); evaluation
// order and short-circuits match the historical cascade exactly.

// Latched hold: keep driving the forced heading while contact is still
// predicted anywhere inside the horizon and no wall blocks the way
// (stability for the turn rate AND the group — everyone else planned
// around it). Deal and keep read the SAME brush budget (GATE_ALLOW):
// dealing strict while keeping strict-er is the limit cycle — a brush
// at the threshold deals a dodge the next tick can't sustain, so the
// drive flaps every tick. A hold drops only on a twice-confirmed free
// line (single-tick nulls are sampling flicker, not resolution),
// expiry, or a hard wall. A sidestep that ends with company still
// ahead rebases the line instead of resuming it (coming back onto the
// old line re-creates the meeting: the formation weave). Predicted
// brushes never break it; true stillness escalates through the stuck
// path, which voids the hold outright. Caps: line-holds last
// PLAN_HOLD, sidesteps SIDESTEP_HOLD with re-evaluation off fresh
// geometry instead of trekking on stale wind. Never predict along the
// hold itself (see planIntent): the dodge always reads clear, so the
// hold would drop every other tick.
function holdPhase(cx, intent, hit) {
  const { mob, peers, grid, reservations, trajGrids, dt } = cx;
  mob._planHold.t += dt;
  const h = mob._planHold;
  const sidestep = Math.abs(normYaw(h.heading - intent)) > Math.PI / 8;
  const cap = sidestep ? SIDESTEP_HOLD : PLAN_HOLD;
  const rankHold = mobRank(mob);
  // Yield agreement first (rank < 3 only — holders never yield, not
  // even by agreement; their slowed line is the commitment others
  // route around): a holder with a live agreement holds its line at
  // the yielder's pace instead of converting or dropping it.
  if (rankHold < 3 && cx.tryYield(intent, hit)) return true;
  // A line-hold converts to a sidestep once contact ahead goes
  // imminent: slow-early sequences the approach, steer-late resolves
  // the meeting. Conversion deals once from fresh geometry (the
  // line-first cascade is skipped — the line we leave), then the
  // sidestep latches like any dodge: re-deciding every tick while
  // imminent is the weave. Never in-file: the follower paces the
  // leader instead of steering around it. Laned sidesteps convert
  // too: a laned dodge never expresses without a detach (the mover
  // only paces the rail), so a bent laned hold is a ghost, not an
  // excursion — converting re-deals it into a detach instead of
  // pacing a bent ghost slowed.
  const threatHold = rankHold >= 1
    ? rankedThreatAhead(mob, intent, peers, rankHold >= 2 ? 2 : 1, hit)
    : threatAhead(mob, intent, peers, hit);
  // File discipline holds the line — except an acute same-direction jam
  // (see acuteSameDir): pacing a leader the follower is actively rear-ending
  // is grinding, not filing. The jam converts like any imminent meeting.
  const jamHold = acuteJamAhead(mob, intent, peers, hit);
  const steerDue = rankHold < 3 && hit != null && hit <= STEER_T && (!sidestep || mob.lane != null) && threatHold && (!fileAhead(mob, intent, peers) || jamHold);
  if (steerDue) {
    mob._planHold = null;
    mob._prevForce = null;
    // One dodge deal (see dealDodge): strictly free winds, voxel + slot
    // gates for rank ≥ 1, legacy peer-only for rank 0. A detach deal
    // flags the mover switch. Wedged with no narrow wind free, hold the
    // slowed line instead of standing down — the gate stops, the stuck
    // detour owns the escape.
    if (!cx.dealDetach(intent, hit, rankHold)) cx.holdLine(intent);
    return true;
  }
  // A line-hold rides through shallow brushes (brushing through on the
  // committed heading is the job); deep contact drops it for a fresh
  // decision below instead of grinding — the hold-keep gate is
  // brush-blind by itself (any predicted contact counts). Agreement
  // holders never reach here (yielded above); sidestep holds keep the
  // old rule (the dodge leaves the threat, so the original line still
  // colliding is exactly the meeting ongoing).
  const lineHold = Math.abs(normYaw(h.heading - intent)) <= Math.PI / 8;
  const shallowHold = !lineHold ||
    trajFree(mob, intent, mob.speed * PLAN_SLOW, reservations, grid, trajGrids, CROSS_BUDGET);
  if (h.t < cap && holdWayFree(mob, h.heading) && hit != null && shallowHold) {
    mob._planFree = 0;
    mob._plan = { heading: h.heading, slow: h.slow, forced: true };
    reserveTraj(mob, extrapolate(mob, h.heading, (mob.speed * h.slow)), reservations, trajGrids);
    return true;
  }
  // Drop paths. A merely-free tick bridges (sampling flicker reads
  // null for a tick while the peer is still there): the hold is kept
  // one more tick instead of standing down and re-dealing next tick.
  // Only two consecutive free ticks end the episode clean — with a
  // line rebase when the sidestep was dodging a formation peer (same
  // direction, still ahead): coming back onto the old line re-creates
  // a meeting that never passes on its own. Crossers and head-on
  // peers pass through, so their episodes end with a plain resume.
  // An expired or walled hold with contact ahead declines, and the
  // engaged phase below decides fresh.
  mob._planHold = null;
  if (hit == null) {
    if (cx.bridgeFree(sidestep, intent)) return true;
    mob._plan = { heading: h.heading, slow: h.slow, forced: true };
    reserveTraj(mob, extrapolate(mob, h.heading, (mob.speed * h.slow)), reservations, trajGrids);
    return true;
  }
  return false;
}

// Free phase (no contact inside the engage window): no forced heading —
// but a live episode coasts at the loose budget instead of standing down
// mid-flicker (re-dealing the wind every contact blink is the
// left-right dance), and memory is kept so a re-engage stays sticky.
// Only consecutive truly-free ticks end the episode clean
// (single-tick nulls are sampling flicker, not resolution): the
// stand-down then rebases the line for a formation peer, or resumes it
// for a crosser that passed through on its own. Always decides.
function freePhase(cx, intent, hit) {
  const { mob, peers, grid, reservations, trajGrids } = cx;
  // Formation spacing: holding abreast inside the comfort gap crabs
  // gently away — no episode, no memory, no rebase. A pure function
  // of the geometry, identical every tick, fading out as the gap
  // opens, so it reads as a straight parallel file instead of a
  // weave — and it preempts the engage/coast/re-engage cycle that
  // grinds formations down to brush range.
  const drift = formationDrift(mob, intent, peers);
  if (drift != null) {
    cx.place(drift, 1);
    return true;
  }
  // Marginal contact: coast a live episode at the loose budget
  // instead of standing down mid-flicker (re-dealing the wind every
  // contact blink is the left-right dance). Never on a truly free
  // line — coasting there would drag a ghost dodge for seconds.
  if (hit != null) {
    const ep = mob._prevForce;
    if (ep && ep.age <= STICK_T && episodeWindValid(mob, ep.heading) &&
      trajFree(mob, ep.heading, mob.speed * ep.slow, reservations, grid, trajGrids, STICKY_ALLOW)) {
      const dropLine = mob.lane != null &&
        Math.abs(normYaw(ep.heading - intent)) > Math.PI / 8;
      if (dropLine && cx.tryYield(intent, hit)) return true;
      cx.place(ep.heading, ep.slow);
      if (dropLine) {
        mob._wantDetach = true;
        mob._detachFor = threatPeerAhead(mob, intent, peers, hit);
        mob._detachForAge = 0;
      }
      return true;
    }
    // No episode to coast on: hold the line without forcing (reserve
    // only) but keep memory, so a re-engage stays sticky instead of
    // re-dealing from a clean slate.
    reserveTraj(mob, extrapolate(mob, intent, (mob.speed)), reservations, trajGrids);
    return true;
  }
  // Truly free: bridge single-tick nulls via the shared counter,
  // stand down (rebase included) on the second consecutive one.
  const ep = mob._prevForce;
  const wasSide = ep && Math.abs(normYaw(ep.heading - intent)) > Math.PI / 8;
  if (cx.bridgeFree(wasSide, intent)) return true;
  reserveTraj(mob, extrapolate(mob, intent, (mob.speed)), reservations, trajGrids);
  return true;
}

// Engaged phase (contact at or inside the window): slow early, steer
// early too when the threat is ahead — turning onto a parallel line
// a second early beats a late dodge, and the rebase at stand-down
// terminates the excursion parallel instead of swinging back.
// Matrix enforcement: free roam never sequences through a ranked line
// at close range — it bends around holders (blue holds, violet holds,
// exits hold, rails stand), or wedges slowed on the fallback below.
// Ranked-vs-ranked and free-vs-free keep temporal sequencing; far
// meetings sequence slowed regardless (no mill churn). Always decides.
function engagePhase(cx, intent, hit) {
  const { mob, peers, grid, reservations, trajGrids } = cx;
  const rankedFoe = mobRank(mob) === 0 && hit != null && hit <= STEER_T &&
    rankedThreatAhead(mob, intent, peers, 0, hit);
  // Crossing: the direct line slowed at the crossing budget — free for
  // the WHOLE horizon (no contact past the budget at any sample, wall
  // included via trajFree), the mob crosses instead of sidestepping.
  // The crossing records episode memory like any dodge, so flicker
  // around the threshold coasts on the slowed line instead of
  // dithering against the raw re-aim.
  if (!rankedFoe && trajFree(mob, intent, mob.speed * PLAN_SLOW, reservations, grid, trajGrids, CROSS_BUDGET)) {
    cx.place(intent, PLAN_SLOW);
    mob._prevForce = { heading: intent, slow: PLAN_SLOW, age: 0 };
    return true;
  }
  // Episode logic (see STICK_T): a bent dodge re-latches while walkable;
  // a sustained episode with an invalid dodge holds the commit line on
  // reactive behavior instead — but ONLY while the contact stays shallow
  // (brushes the gate and backstop clear anyway). Deep contact with a
  // stale episode falls through to a fresh deal below: pushing through
  // deep contact is an avoidance failure in code terms, not patience.
  // Ranked foes always deal first (matrix: free roam bends around ranked
  // lines, never sequences through them). Line-aligned episodes skip this
  // and re-deal fresh below (no excursion to swing back from).
  const prev = mob._prevForce;
  const prevBent = prev && Math.abs(normYaw(prev.heading - intent)) > Math.PI / 8;
  if (prevBent) {
    if (prev.age <= STICK_T &&
      trajFree(mob, prev.heading, mob.speed * prev.slow, reservations, grid, trajGrids, STICKY_ALLOW)) {
      cx.place(prev.heading, prev.slow);
      return true;
    }
    if (wallAhead(mob, intent)) {
      for (const c of candidates(intent).slice(2)) {
        if (trajFree(mob, c.h, mob.speed * c.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
          cx.place(c.h, c.slow);
          mob._prevForce = { heading: c.h, slow: c.slow, age: 0 };
          break;
        }
      }
      if (mob._plan) return true;
      // Wall ahead and no wind free: the stuck path owns the escape —
      // hold the commit line without forcing (reserve only) instead of
      // grinding a forced heading into rock.
      reserveTraj(mob, extrapolate(mob, intent, (mob.speed)), reservations, trajGrids);
      return true;
    }
    if (!rankedFoe && trajFree(mob, intent, mob.speed * PLAN_SLOW, reservations, grid, trajGrids, CROSS_BUDGET)) {
      reserveTraj(mob, extrapolate(mob, intent, (mob.speed)), reservations, trajGrids);
      return true;
    }
    // Deep contact (or a ranked foe): fall through to a fresh deal below.
  }
  // Fresh sidestep deal from a clean slate (no episode memory): narrow
  // winds only (±90° max), only at threats ahead. In-file meetings pace by
  // default (an abreast contact sequences temporally on the slowed line, a
  // follower paces its leader) — except an acute same-direction jam, which
  // steers like any imminent meeting instead of grinding. Wedged with no
  // wind free, hold the slowed line: the gate stops, the stuck detour owns
  // the escape.
  // Deal threats read with the steer window clamped to imminent: the
  // cascade only gets here when the slowed line is already proven
  // blocked (crossing failed above) or the foe is ranked close —
  // sequencing is impossible, so steer early instead of waiting out a
  // line that can never clear. (Hold conversion keeps the raw hit:
  // imminent-only there, stability first.)
  // Priority cascade (mobRank): 4 JAUNE 2-wide exits/threads and 3
  // SORTIE-1 1-wide exits never steer (pace slowed side by side, 1-wide
  // exits hold for violet to abort against); 2 VIOLET steers hole-ward
  // only and aborts only for a 1-wide exiter coming out; 1 BLUE detaches
  // to a validated free-roam wind on deep contact (files pace, never
  // detach); 0 FREE keeps the legacy peer-only deal. Speed never drops
  // past PLAN_SLOW, headings bend at most ±90° — no freeze, no stops.
  const rank = mobRank(mob);
  if (rank >= 3) {
    cx.holdLine(intent);
    return true;
  }
  if (rank === 2 || mob.lane) {
    const laned = mob.lane != null;
    if (cx.tryYield(intent, hit)) return true;
    const jam = acuteJamAhead(mob, intent, peers, hit);
    if (!laned || !fileAhead(mob, intent, peers) || jam) {
      const threatTiered = rankedThreatAhead(mob, intent, peers, rank === 2 ? 2 : 1, hit);
      if ((threatTiered || (jam && threatAhead(mob, intent, peers, hit))) && (!fileAhead(mob, intent, peers) || jam)) {
        if (cx.dealDetach(intent, hit, rank)) return true;
      }
    }
    cx.holdLine(intent);
    // 1-wide commits abort only for an exiter already inside coming out
    // (head-on yield); static wedges hold slowed, holders keep the old
    // rule (never abort — they already continued above).
    if (rank === 2 && exiterBlocking1(mob, peers)) mob._wantAbort = true;
    return true;
  }
  // Legacy fresh-sidestep deal (rank 0 free roam, bit-identical to before
  // the tiers: peer-only GATE_ALLOW winds, slowed line when wedged). Files
  // pace by default; acute jams steer.
  const jamFree = acuteJamAhead(mob, intent, peers, hit);
  if (threatAhead(mob, intent, peers, hit) && (!fileAhead(mob, intent, peers) || jamFree)) {
    const deal = dealDodge(mob, intent, peers, hit, 0, reservations, grid, trajGrids);
    if (deal) {
      cx.place(deal.h, deal.slow);
      mob._prevForce = { heading: deal.h, slow: deal.slow, age: 0 };
      return true;
    }
  }
  cx.holdLine(intent);
  return true;
}

// Plan the whole group: avoidance tiers first (holders, then commits,
// then wall rides, then free roam), most-blocked first inside a tier —
// a stuck free mob never reserves ahead of a holder. Each mob reserves
// its trajectory for the rest. Red 1-wide rails (rank -1) plan nothing
// but stand as live-pose obstacles. Holders (rank >= 3) keep the legacy
// cascade paced slowed — 2-wide steering untouched. Sets mob._plan on
// every planned mob (null = no override) plus one-shot _wantDetach
// (blue → free-roam commit) / _wantAbort (wedged 1-wide committer →
// giveUp path) flags consumed by the mover this same tick.
export function planGroup(peers, dt, grid = null) {
  prepareNarrowPairs(peers, dt);
  const reservations = new Map();
  for (const m of peers) {
    if (!m.alive) continue;
    m._plan = null;
    m._wantDetach = false;
    m._wantAbort = false;
    // Yield agreements age out for every alive mob each tick, whatever
    // the plan order: void when the window lapses, the holder dies, or
    // the yielder re-lanes (riding again — fresh mutual evaluation).
    if (m._detachFor) {
      m._detachForAge = (m._detachForAge ?? 0) + dt;
      if (m._detachForAge > DETACH_YIELD_T || !m._detachFor.alive || m.lane) m._detachFor = null;
    }
    reservations.set(m, { mob: m, traj: null });
  }
  // Sample index for reserved paths (rebuilt every call): lets a later
  // mob find a trajectory-vs-trajectory meeting no live-pose query could
  // see. Null when grid is null (full scan covers everything).
  const NS = Math.max(1, Math.round(PREDICT_T / FORECAST_STEP));
  const trajGrids = grid ? Array.from({ length: NS }, () => new Map()) : null;
  const order = [...reservations.keys()]
    .filter((m) => mobRank(m) >= 0)
    .sort((a, b) => mobRank(b) - mobRank(a) ||
      (b.stuckT ?? 0) - (a.stuckT ?? 0) || (a._peerIdx ?? 0) - (b._peerIdx ?? 0));
  for (const mob of order) {
    // Sticky age accrues every group tick; a fresh sidestep re-stamps it.
    if (mob._prevForce) mob._prevForce.age += dt;
    const place = (heading, slow) => {
      const eff = mob.speed * slow;
      mob._plan = { heading, slow, forced: true };
      mob._planHold = { heading, slow, t: 0 };
      mob._planFree = 0;
      reserveTraj(mob, extrapolate(mob, heading, (eff)), reservations, trajGrids);
    };
    // Yielded meeting: the trigger already detached for me — hold the wall
    // line at the yielder's pace instead of dealing a second detach (the
    // deal below would drop us both). Walkable line only: into a wall, deal
    // as usual. Checked before any rank gate: the yielder dropped to rank 0,
    // but the agreement is about the peer, not its current rank.
    const tryYield = (intent, hit) => {
      const pace = mob.lane ? yieldPace(mob, intent, peers, hit) : null;
      if (pace == null) return false;
      place(intent, pace);
      mob._prevForce = { heading: intent, slow: pace, age: 0 };
      return true;
    };
    // Two-tick stand-down bridge. A single null read is sampling flicker,
    // not resolution: the first free tick keeps driving (hold heading when
    // the caller's hold just died, plain reserve otherwise); only two
    // consecutive free ticks end the episode clean — with a line rebase
    // when the sidestep was dodging a formation peer, plus a prev wipe.
    // Returns true on stand-down (already reserved + continued by the
    // helper's contract: caller just continues).
    const bridgeFree = (wasSide, intentHeading) => {
      const free = (mob._planFree ?? 0) + 1;
      if (free < 2) { mob._planFree = free; return false; }
      if (wasSide && formationAhead(mob, intentHeading, peers)) mob._rebase = true;
      mob._prevForce = null;
      mob._planFree = 0;
      reserveTraj(mob, extrapolate(mob, intentHeading, (mob.speed)), reservations, trajGrids);
      return true;
    };
    // Wedged fallback, shared by every phase: hold the slowed line — the
    // gate stops, the stuck detour owns the escape.
    const holdLine = (intent) => {
      place(intent, PLAN_SLOW);
      mob._prevForce = { heading: intent, slow: PLAN_SLOW, age: 0 };
    };
    // Shared dodge deal (see dealDodge): strictly free winds, voxel + slot
    // gates for rank ≥ 1, legacy peer-only for rank 0. A laned deal flags
    // the mover detach with its trigger. True when dealt.
    const dealDetach = (intent, hit, rank) => {
      const deal = dealDodge(mob, intent, peers, hit, rank, reservations, grid, trajGrids);
      if (!deal) return false;
      place(deal.h, deal.slow);
      mob._prevForce = { heading: deal.h, slow: deal.slow, age: 0 };
      if (mob.lane) {
        mob._wantDetach = true;
        mob._detachFor = deal.trigger;
        mob._detachForAge = 0;
      }
      return true;
    };
    // Per-tick rule context for the explicit phases below.
    const cx = { mob, peers, grid, reservations, trajGrids, dt, place, tryYield, bridgeFree, holdLine, dealDetach };
    // Rule order is the behavior: the latched hold first, then the free
    // or engaged phase on the original line when the hold declines.
    if (mob._planHold) {
      const hIntent = planIntent(mob);
      const hHit = trajHitTime(mob, hIntent, mob.speed, reservations, grid, trajGrids, GATE_ALLOW);
      if (holdPhase(cx, hIntent, hHit)) continue;
    }
    // Cascade: full speed on the same raw line wins; then the SAME line
    // slowed — when the predicted brush stays within the crossing budget
    // the mob crosses instead of sidestepping (a slowdown keeps the gait
    // line, a sidestep bends it). Only deeper predicted contact falls
    // through to the narrowest free wind at full stride; slowed winds
    // only as a last resort. All winds stay raw (no 8-wind snap):
    // quantizing the cap up to half a wind off the re-aim reads as a
    // permanent stutter on every engage/disengage.
    const intent = planIntent(mob);
    // Brushes at or under the gate allowance never engage: the drive
    // walks through them on the committed line, exactly like the step
    // gate does. Deeper predicted contact engages — then the crossing
    // test below decides between holding the line and sidestepping.
    const hit = trajHitTime(mob, intent, mob.speed, reservations, grid, trajGrids, GATE_ALLOW);
    if (hit == null || hit > engageT()) {
      freePhase(cx, intent, hit);
      continue;
    }
    engagePhase(cx, intent, hit);
    continue;
  }
}
