// Group predictive planner (three-free, pure): every tick, before any mob
// moves, all lane-less mobs reserve space-time along 8-wind trajectories,
// most-blocked first. Pairwise yield (`avoidMobs`) cannot see blocking
// cycles (A holds for B holds for C holds for A) or dense amasses; ordering
// the whole group over a shared horizon breaks them: the first mob keeps
// its line, the rest cross when the brush stays shallow and sidestep
// narrow-first at full stride only when waiting won't resolve it — speed
// stays near-constant, the heading bends only for deep contact.
// Nothing here writes a position: it only fills `mob._plan =
// {heading, slow, forced} | null`, consumed by the mover's lane-less
// drives while latched (`mob._planHold`, `PLAN_HOLD` max, dropped only on
// expiry or a hard wall ahead — never on predicted peer contact).
// Advisory only: override solely on predicted contact deeper than the
// crossing budget (`GATE_ALLOW` + X level) inside `ENGAGE_T` (free roam
// and shallow brushes otherwise).
// Evasions scope: only forced maneuvers (plan/wiggle/detour) snap to the
// 8-wind; free roam/wander stays raw (see roam.js, mover.js).
// Deterministic: fixed order, no rand stream. Headless-testable.
import { snap8, normYaw } from "./corridor.js";
import { segmentWalkable } from "./step.js";
import { queryMobGrid } from "./grid.js";
import { worstPairPenAt, SEP_Y, PREDICT_T, GATE_ALLOW, CROSS_BUDGET } from "./mover.js";
import { noseReach } from "./collide.js";

// Trajectory sampling: every half second out to the prediction horizon
// (~6 samples at farm stride — a full stride each, so no blind spots
// between samples at body scale). Slowed alternatives are a last resort
// only (spatial re-winds run full speed first); the floor stays near full
// stride so evasion never reads as hesitation.
export const FORECAST_STEP = 0.5;
export const PLAN_SLOW = 0.8;
// A forced plan latches up to this long: the drive turns at rate, so a one-tick
// plan would never finish its turn before the next override — chatter.
// A hold lasts while its threat stays imminent (intent still collides
// inside ENGAGE_T) and no wall blocks the way, and drops the moment the
// straight line home reads free again — resuming early is what keeps a
// sidestep from becoming a trek. Peer brushes never break it (brushing
// through on the committed heading is the job); true stillness escalates
// through the stuck path, which voids the hold outright.
export const PLAN_HOLD = 1.5;
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
// inside this — the CPA yield owns the far window, and forcing evasions
// seconds early just walks mobs off their lines (a 45° hold covers ~1.4 m
// of lateral ground per second). Inside the window the yield is exhausted,
// so the group order takes over. Small on purpose now that brushes are
// allowed: late, short sidesteps beat early, sweeping detours. Tuned per
// pen preset (0.3 s keeps lines longest); the shipped default holds lines.
export const ENGAGE_T = 0.7;
let _engageT = ENGAGE_T;
export function engageT() { return _engageT; }
// Wall horizon (m): how far ahead the planner reads voxels, plus the nose
// reach so the warning precedes snout contact. Shipped at 0.05: far walls
// never veto an evasion, near walls still turn the mob in time.
let _wallH = 0.05;
export function wallHorizon() { return _wallH; }

// Intended heading, same rule as the mover's predictor: the latched roam
// commit when there is one, else the current yaw. Peers expose the same
// fields, so the whole group predicts off committed intent.
function planIntent(mob) {
  return mob.roam?.mode === "commit" && mob.roam.heading != null ? mob.roam.heading : mob.yaw;
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
  // reports 0, exactly like
  // the legacy wall-first order.
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
    // Latched hold: keep driving the forced heading while the threat is
    // still imminent and no wall blocks the way (stability for the turn
    // rate AND the group — everyone else planned around it). Drop it as
    // soon as the straight line home reads free again — resuming the line
    // early is what keeps detours to sidesteps instead of cross-map treks.
    // Predicted brushes never break it (brushing through is the committed
    // behavior); true stillness escalates through the stuck path, which
    // voids the hold outright. Cap is PLAN_HOLD either way.
    if (mob._planHold) {
      mob._planHold.t += dt;
      const h = mob._planHold;
      const intent = snap8(planIntent(mob));
      const hit = trajHitTime(mob, intent, mob.speed, reservations, grid, trajGrids, CROSS_BUDGET);
      if (h.t < PLAN_HOLD && holdWayFree(mob, h.heading) && hit != null && hit <= engageT()) {
        mob._plan = { heading: h.heading, slow: h.slow, forced: true };
        reserveTraj(mob, extrapolate(mob, h.heading, mob.speed * h.slow), reservations, trajGrids);
        continue;
      }
      mob._planHold = null;
    }
    const place = (heading, slow) => {
      const eff = mob.speed * slow;
      mob._plan = { heading, slow, forced: true };
      mob._planHold = { heading, slow, t: 0 };
      reserveTraj(mob, extrapolate(mob, heading, eff), reservations, trajGrids);
    };
    // Cascade: full speed on the current line wins; then the SAME line
    // slowed — when the predicted brush stays within the crossing budget
    // the mob crosses instead of sidestepping (a slowdown keeps the gait
    // line, a sidestep bends it). Only deeper predicted contact falls
    // through to the narrowest free wind at full stride; slowed winds
    // only as a last resort.
    const candidates = (base) => {
      const out = [{ h: base, slow: 1 }, { h: base, slow: PLAN_SLOW }];
      for (const dh of PLAN_WINDS.slice(1)) {
        out.push({ h: normYaw(base + dh), slow: 1 });
      }
      for (const dh of PLAN_WINDS.slice(1)) {
        out.push({ h: normYaw(base + dh), slow: PLAN_SLOW });
      }
      return out;
    };
    const intent = snap8(planIntent(mob));
    // Brushes at or under the gate allowance never engage: the drive
    // walks through them on the committed line, exactly like the step
    // gate does. Deeper predicted contact engages — then the crossing
    // test below decides between holding the line and sidestepping.
    const hit = trajHitTime(mob, intent, mob.speed, reservations, grid, trajGrids, GATE_ALLOW);
    // Free: no override, but still reserve the intended line so the
    // rest predict where this mob is GOING, not a frozen live pose —
    // dodging a static ghost of a moving leader is how false
    // evasions start. Reserved at full speed (conservative: the drive
    // may yield slower, which only clears space earlier).
    if (hit == null || hit > engageT()) {
      reserveTraj(mob, extrapolate(mob, intent, mob.speed), reservations, trajGrids);
      mob._prevForce = null;
      continue;
    }
    // Crossing: the direct line slowed at the crossing budget — free for
    // the WHOLE horizon (no contact past the budget at any sample, wall
    // included via trajFree), the mob crosses instead of sidestepping.
    // A merely later contact (beyond ENGAGE_T but inside the horizon)
    // still falls through to the lateral winds: that is a collision
    // developing, not a brush. Only deep head-on contact steers.
    if (trajFree(mob, intent, mob.speed * PLAN_SLOW, reservations, grid, trajGrids, CROSS_BUDGET)) {
      place(intent, PLAN_SLOW);
      mob._prevForce = null;
      continue;
    }
    // Episode logic (see STICK_T): the last dodge re-latches while
    // walkable; a sustained episode with an invalid dodge holds the commit
    // line on reactive behavior instead of dealing a new wind — unless the
    // line itself runs into a wall. Peer flicker never converges (re-deal
    // is the weave); static wall geometry does, and the near-wall turn is
    // what keeps snouts off walls. A fresh wind only ever opens from a
    // clean slate (no episode memory), so sustained peer scuffles steer at
    // most one sidestep episode, then push through.
    const prev = mob._prevForce;
    if (prev) {
      if (prev.age <= STICK_T &&
        trajFree(mob, prev.heading, mob.speed * prev.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
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
    for (const c of candidates(intent).slice(2)) {
      if (trajFree(mob, c.h, mob.speed * c.slow, reservations, grid, trajGrids, GATE_ALLOW)) {
        place(c.h, c.slow);
        mob._prevForce = { heading: c.h, slow: c.slow, age: 0 };
        break;
      }
    }
    // Nothing validates: _plan stays null and the reactive layer
    // (yield/wiggle/detour) owns the tick.
  }
}
