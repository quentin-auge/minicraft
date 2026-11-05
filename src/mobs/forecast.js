// Group predictive planner (three-free, pure): every tick, before any mob
// moves, all lane-less mobs reserve space-time along raw-heading
// trajectories, most-blocked first. Pairwise yield cannot see blocking
// cycles (A holds for B holds for C holds for A) or dense amasses; ordering
// the whole group over a shared horizon breaks them: the first mob keeps
// its line, the rest cross slowed when the brush stays shallow and sidestep
// narrow-first at full stride only when waiting won't resolve it — speed
// takes two levels only (full or PLAN_SLOW), the heading bends only for
// deep contact, and forced headings stay raw (no wind snap: quantizing the
// cap up to half a wind off the re-aim is the gauche-droite stutter).
// Nothing here writes a position: it only fills `mob._plan =
// {heading, slow, forced} | null`, consumed by the mover's lane-less
// drives while latched (`mob._planHold`, `PLAN_HOLD` max, dropped only on
// expiry or a hard wall ahead — never on predicted peer contact).
// Advisory only: override solely on predicted contact deeper than the
// crossing budget inside `ENGAGE_T` (free roam and shallow brushes
// otherwise); a marginal contact coasts the episode wind a few ticks to
// bridge flicker, a truly free line stands down at once.
// Evasions scope: only forced maneuvers (plan/detour) hold a heading;
// free roam/wander stays raw (see roam.js, mover.js).
// Deterministic: fixed order, no rand stream. Headless-testable.
import { normYaw } from "./corridor.js";
import { segmentWalkable } from "./step.js";
import { queryMobGrid } from "./grid.js";
import { worstPairPenAt, SEP_Y, PREDICT_T, GATE_ALLOW, CROSS_BUDGET } from "./mover.js";
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
// Sidestep episode cap (s): a forced wind persists across hold drops
// while it stays walkable (sticky — re-dealing the wind every time the
// contact flickers around the engage threshold is the left-right dance),
// but an episode never re-deals: once the last dodge goes invalid (or the
// cap lapses) the mob holds its commit line on reactive behavior only
// (yield + gate + maneuver) until the line reads free again. The geometry
// already rejected the last dodge — dealing another is the weave; a wedge
// is the stuck path's job, with committed pushes, not the planner's.
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

// Intended heading: the latched commit heading while it still describes
// motion, else the live re-aim bearing. Rewrite roam re-aims at the target
// point every tick, so slides, clamp halvings and separation shoves leave
// the latched heading stale within seconds — forcing a stale cap back
// reads as a yank, then the re-aim pulls back, which reads as the weave.
// But the re-aim bearing alone jitters with every slide, while the latched
// heading is rock-steady when aligned: use it until it visibly diverges
// (half a radian off the motion), then the bearing. Never the hold
// heading: the hold branch tests whether the ORIGINAL line still
// collides — predicting along the dodge itself always reads clear (you
// are leaving the threat), so the hold would drop every other tick and
// the drive would flap. Peers expose the same fields (their reserved
// trajectories, not this function, tell others where they go).
function planIntent(mob) {
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

// Steer cone (rad): sidesteps only answer threats ahead of the nose. A
// contact predicted abreast (formation flight, converging parallels)
// sequences temporally on the slowed line instead of jinking sideways:
// steering at a flank contact, resuming the line, re-engaging as the
// formation closes again is the limit cycle that reads as gauche-droite
// stutter. Walls steer regardless (see wallAhead): static geometry
// converges, peer flicker doesn't.
const STEER_CONE = 0.7;
function threatAhead(mob, intent, peers) {
  for (const o of peers) {
    if (o === mob || !o.alive) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > SEP_Y) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > 4 * 4) continue;
    if (Math.abs(normYaw(Math.atan2(dx, dz) - intent)) <= STEER_CONE) return true;
  }
  return false;
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
    if (Math.abs(lat) < 0.35 || Math.abs(lat) > 0.8) continue;
    if (!best || Math.abs(lat) < Math.abs(best.lat)) best = { lat };
  }
  if (!best) return null;
  // Fade the bias out as the gap opens (full at 0.35 m, zero at 0.8 m):
  // switching a constant bias on and off at the boundary would flap the
  // heading every time the pair breathes across it.
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

// Narrow-first 8-wind offsets around a base wind (0 included: the current
// line always wins when free — minimal displacement).
const P = Math.PI;
const PLAN_WINDS = [0, P / 4, -P / 4, P / 2, -P / 2, (3 * P) / 4, -(3 * P) / 4, P];

// Plan the whole group: most-blocked first (stuckT desc, _peerIdx tiebreak),
// each mob reserving its trajectory for the rest. Keep existing behavior
// unless the intended line collides (then the narrowest free wind at full
// speed, slowed variants only as a last resort). Sets mob._plan on every
// lane-less mob (null = no override); lane mobs keep servo motion and
// read null.
export function planGroup(peers, dt, grid = null) {
  const reservations = new Map();
  for (const m of peers) {
    if (!m.alive) continue;
    m._plan = null;
    reservations.set(m, { mob: m, traj: null });
  }
  // Sample index for reserved paths (rebuilt every call): lets a later
  // mob find a trajectory-vs-trajectory meeting no live-pose query could
  // see. Null when grid is null (full scan covers everything).
  const NS = Math.max(1, Math.round(PREDICT_T / FORECAST_STEP));
  const trajGrids = grid ? Array.from({ length: NS }, () => new Map()) : null;
  const order = [...reservations.keys()]
    .filter((m) => !m.lane)
    .sort((a, b) => (b.stuckT ?? 0) - (a.stuckT ?? 0) || (a._peerIdx ?? 0) - (b._peerIdx ?? 0));
  for (const mob of order) {
    // Sticky age accrues every group tick; a fresh sidestep re-stamps it.
    if (mob._prevForce) mob._prevForce.age += dt;
    // Narrow-first wind cascade around a base heading (0 included: the
    // current line always wins when free — minimal displacement; slowed
    // variants run last, spatial re-winds first). All winds stay raw:
    // quantizing the cap off the re-aim reads as stutter. Deals stay
    // within ±90° of the line: ordering a ±135° or U-turn wind reads as
    // a spin when the geometry re-deals a minute later — reversals belong
    // to the stuck detour, which only fires on a hard block with a
    // validated short sidestep.
    const candidates = (base) => {
      const out = [{ h: base, slow: 1 }, { h: base, slow: PLAN_SLOW }];
      for (const dh of PLAN_WINDS.slice(1, 5)) {
        out.push({ h: normYaw(base + dh), slow: 1 });
      }
      for (const dh of PLAN_WINDS.slice(1, 5)) {
        out.push({ h: normYaw(base + dh), slow: PLAN_SLOW });
      }
      return out;
    };
    const place = (heading, slow) => {
      const eff = mob.speed * slow;
      mob._plan = { heading, slow, forced: true };
      mob._planHold = { heading, slow, t: 0 };
      mob._planFree = 0;
      reserveTraj(mob, extrapolate(mob, heading, eff), reservations, trajGrids);
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
      reserveTraj(mob, extrapolate(mob, intentHeading, mob.speed), reservations, trajGrids);
      return true;
    };
    // Staying threshold (loose): dealing a wind demands a strictly free
    // corridor (GATE_ALLOW), but keeping one tolerates shallow brushes —
    // the gate and the backstop clear up to CROSS_BUDGET anyway. A wind
    // that toggles between strictly-free and brushed would otherwise
    // flicker the drive every few ticks, and every plan-less tick yanks
    // the yaw at full rate back toward the raw re-aim.
    const STICKY_ALLOW = CROSS_BUDGET;
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
    if (mob._planHold) {
      mob._planHold.t += dt;
      const h = mob._planHold;
      const intent = planIntent(mob);
      const hit = trajHitTime(mob, intent, mob.speed, reservations, grid, trajGrids, GATE_ALLOW);
      const sidestep = Math.abs(normYaw(h.heading - intent)) > Math.PI / 8;
      const cap = sidestep ? SIDESTEP_HOLD : PLAN_HOLD;
      // A line-hold converts to a sidestep once contact ahead goes
      // imminent: slow-early sequences the approach, steer-late resolves
      // the meeting. Conversion deals once from fresh geometry (the
      // line-first cascade is skipped — the line we leave), then the
      // sidestep latches like any dodge: re-deciding every tick while
      // imminent is the weave. Never in-file: the follower paces the
      // leader instead of steering around it.
      const steerDue = hit != null && hit <= STEER_T && !sidestep && threatAhead(mob, intent, peers) && !fileAhead(mob, intent, peers);
      if (steerDue) {
        mob._planHold = null;
        mob._prevForce = null;
        // Deal winds strictly free (GATE_ALLOW): a brush-tolerant dodge
        // steered straight into the next mob reads as a shove, not a
        // sidestep — wedged meetings slow down and let the stuck detour
        // own the escape instead.
        for (const c of candidates(intent).slice(2)) {
          if (trajFree(mob, c.h, mob.speed * c.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
            place(c.h, c.slow);
            mob._prevForce = { heading: c.h, slow: c.slow, age: 0 };
            break;
          }
        }
        if (!mob._plan) {
          // Wedged with no narrow wind free: hold the slowed line instead
          // of standing down — the gate stops, the stuck detour owns the
          // escape.
          place(intent, PLAN_SLOW);
          mob._prevForce = { heading: intent, slow: PLAN_SLOW, age: 0 };
        }
        continue;
      }
      if (h.t < cap && holdWayFree(mob, h.heading) && hit != null) {
        mob._planFree = 0;
        mob._plan = { heading: h.heading, slow: h.slow, forced: true };
        reserveTraj(mob, extrapolate(mob, h.heading, mob.speed * h.slow), reservations, trajGrids);
        continue;
      }
      // Drop paths. A merely-free tick bridges (sampling flicker reads
      // null for a tick while the peer is still there): the hold is kept
      // one more tick instead of standing down and re-dealing next tick.
      // Only two consecutive free ticks end the episode clean — with a
      // line rebase when the sidestep was dodging a formation peer (same
      // direction, still ahead): coming back onto the old line re-creates
      // a meeting that never passes on its own. Crossers and head-on
      // peers pass through, so their episodes end with a plain resume.
      // An expired or walled hold with contact ahead falls through to the
      // engaged cascade below for a fresh decision.
      mob._planHold = null;
      if (hit == null) {
        if (bridgeFree(sidestep, intent)) continue;
        mob._plan = { heading: h.heading, slow: h.slow, forced: true };
        reserveTraj(mob, extrapolate(mob, h.heading, mob.speed * h.slow), reservations, trajGrids);
        continue;
      }
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
    // Free: no forced heading — but a live episode coasts at the loose
    // budget instead of standing down mid-flicker (re-dealing the wind
    // every contact blink is the left-right dance), and memory is kept
    // so a re-engage stays sticky. Only consecutive truly-free ticks end
    // the episode clean (single-tick nulls are sampling flicker, not
    // resolution): the stand-down then rebases the line for a formation
    // peer, or resumes it for a crosser that passed through on its own.
    if (hit == null || hit > engageT()) {
      // Formation spacing: holding abreast inside the comfort gap crabs
      // gently away — no episode, no memory, no rebase. A pure function
      // of the geometry, identical every tick, fading out as the gap
      // opens, so it reads as a straight parallel file instead of a
      // weave — and it preempts the engage/coast/re-engage cycle that
      // grinds formations down to brush range.
      const drift = formationDrift(mob, intent, peers);
      if (drift != null) {
        place(drift, 1);
        continue;
      }
      // Marginal contact: coast a live episode at the loose budget
      // instead of standing down mid-flicker (re-dealing the wind every
      // contact blink is the left-right dance). Never on a truly free
      // line — coasting there would drag a ghost dodge for seconds.
      if (hit != null) {
        const ep = mob._prevForce;
        if (ep && ep.age <= STICK_T &&
          trajFree(mob, ep.heading, mob.speed * ep.slow, reservations, grid, trajGrids, STICKY_ALLOW)) {
          place(ep.heading, ep.slow);
          continue;
        }
        // No episode to coast on: hold the line without forcing (reserve
        // only) but keep memory, so a re-engage stays sticky instead of
        // re-dealing from a clean slate.
        reserveTraj(mob, extrapolate(mob, intent, mob.speed), reservations, trajGrids);
        continue;
      }
      // Truly free: bridge single-tick nulls via the shared counter
      // above, stand down (rebase included) on the second consecutive
      // one. Reached only when hit == null: the marginal-contact branch
      // just above always continues.
      const ep = mob._prevForce;
      const wasSide = ep && Math.abs(normYaw(ep.heading - intent)) > Math.PI / 8;
      if (bridgeFree(wasSide, intent)) continue;
      reserveTraj(mob, extrapolate(mob, intent, mob.speed), reservations, trajGrids);
      continue;
    }
    // Engaged cascade (hit at or inside the window): slow early, steer
    // early too when the threat is ahead — turning onto a parallel line
    // a second early beats a late dodge, and the rebase at stand-down
    // terminates the excursion parallel instead of swinging back.
    // Crossing: the direct line slowed at the crossing budget — free for
    // the WHOLE horizon (no contact past the budget at any sample, wall
    // included via trajFree), the mob crosses instead of sidestepping.
    // The crossing records episode memory like any dodge, so flicker
    // around the threshold coasts on the slowed line instead of
    // dithering against the raw re-aim.
    if (trajFree(mob, intent, mob.speed * PLAN_SLOW, reservations, grid, trajGrids, CROSS_BUDGET)) {
      place(intent, PLAN_SLOW);
      mob._prevForce = { heading: intent, slow: PLAN_SLOW, age: 0 };
      continue;
    }
    // Episode logic (see STICK_T): the last dodge re-latches while
    // walkable — conversion already nulled line-holds at the steer
    // threshold, so what re-latches here is always a genuine sidestep.
    // A sustained episode with an invalid dodge holds the commit line on
    // reactive behavior instead of dealing a new wind — unless the line
    // itself runs into a wall. Peer flicker never converges (re-deal
    // is the weave); static wall geometry does, and the near-wall turn
    // is what keeps snouts off walls. A fresh wind only ever opens from
    // a clean slate (no episode memory), so sustained peer scuffles
    // steer at most one sidestep episode, then push through.
    const prev = mob._prevForce;
    if (prev) {
      if (prev.age <= STICK_T &&
        trajFree(mob, prev.heading, mob.speed * prev.slow, reservations, grid, trajGrids, STICKY_ALLOW)) {
        place(prev.heading, prev.slow);
        continue;
      }
      if (wallAhead(mob, intent)) {
        for (const c of candidates(intent).slice(2)) {
          if (trajFree(mob, c.h, mob.speed * c.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
            place(c.h, c.slow);
            mob._prevForce = { heading: c.h, slow: c.slow, age: 0 };
            break;
          }
        }
        if (mob._plan) continue;
      }
      reserveTraj(mob, extrapolate(mob, intent, mob.speed), reservations, trajGrids);
      continue;
    }
    // Fresh sidestep deal from a clean slate (no episode memory): narrow
    // winds only (±90° max — see candidates), only at threats ahead (see
    // STEER_CONE), and never in-file (see fileAhead): an abreast contact
    // sequences temporally on the slowed line instead of jinking, and a
    // follower paces its leader instead of steering around it. Winds stay
    // strictly free (GATE_ALLOW): brush-tolerant dodges plow into the
    // next mob and read as shoves. When wedged with no narrow wind free,
    // hold the slowed line instead of standing down: the drive keeps
    // signaling straight, the gate stops, and the stuck detour owns the
    // escape — a null plan here would hand the tick to the raw re-aim
    // and re-engage from scratch next tick, which is the churn.
    let dealt = false;
    if (threatAhead(mob, intent, peers) && !fileAhead(mob, intent, peers)) {
      for (const c of candidates(intent).slice(2)) {
        if (trajFree(mob, c.h, mob.speed * c.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
          place(c.h, c.slow);
          mob._prevForce = { heading: c.h, slow: c.slow, age: 0 };
          dealt = true;
          break;
        }
      }
    }
    if (!dealt) {
      place(intent, PLAN_SLOW);
      mob._prevForce = { heading: intent, slow: PLAN_SLOW, age: 0 };
    }
    continue;
  }
}
