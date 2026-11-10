// Contact-scoped passing agreements. Connectivity informs the existing servo;
// this module never writes a position or replaces locomotion.
import { makeCellFree, hasSupport, SERVO_STEP } from "./step.js";
import { worldRevision } from "../core/store.js";
import { normYaw, CARDINALS, dirVec } from "./corridor.js";
import {
  worstPairPenAt, noseReach, SEP_GAP, CROSS_BUDGET, PASS_OFF, PASS_BUDGET, WALL_ALLOW,
  PART_CORE, partRadius,
} from "./collide.js";

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Scratch buffers for the per-part-pair penetrations (see narrowPoseOk).
const _parts = new Array(9).fill(0);
const _curParts = new Array(9).fill(0);
const CONTACT_PEN = 0.03;
const CLEAR_PEN = 0.02;
const JAM_TIME = 0.1;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const keyOf = p => p.join(",");
const censusCache = new Map();
let censusRevision = -1;

export function closedRail(mob) {
  if (censusRevision !== worldRevision || censusCache.size > 512) {
    censusCache.clear(); censusRevision = worldRevision;
  }
  const prefix = `${mob.dim}|${mob.pos.y}|${mob.h}|${mob.maxDrop}|`;
  const key = prefix + `${Math.floor(mob.pos.x)},${Math.floor(mob.pos.z)}`;
  if (censusCache.has(key)) return censusCache.get(key);
  const rail = discoverRail(mob);
  censusCache.set(key, rail);
  if (rail) for (const p of rail.path) censusCache.set(prefix + `${Math.floor(p.x)},${Math.floor(p.z)}`, rail);
  return rail;
}

function discoverRail(mob) {
  const free = makeCellFree(mob);
  const start = [Math.floor(mob.pos.x), Math.floor(mob.pos.z)];
  if (!free(...start)) return null;
  const cells = new Map(), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > 128) return null;
    const p = queue[i], key = keyOf(p);
    if (cells.has(key)) continue;
    const exits = NEIGHBOURS.map(([dx, dz]) => [p[0] + dx, p[1] + dz]).filter(p => free(...p));
    if (exits.length > 2 || exits.length === 0) return null;
    cells.set(key, exits);
    for (const p of exits) if (!cells.has(keyOf(p))) queue.push(p);
  }
  const ends = [...cells].filter(([, exits]) => exits.length === 1).map(([key]) => key).sort();
  if (ends.length !== 2) return null;
  const path = [];
  let previous = null, current = ends[0];
  while (current != null) {
    const [x, z] = current.split(',').map(Number);
    path.push({ x: x + 0.5, z: z + 0.5 });
    const next = cells.get(current).map(keyOf).find(k => k !== previous);
    previous = current; current = next;
  }
  return { key: `${mob.dim}|${mob.pos.y}|${[...cells.keys()].sort().join('|')}`, path };
}

// Nearest point on the rail polyline, optionally restricted to the
// course-aligned segments (perpendicular arms at a bend say nothing about
// which way the mob means to go, so the direction read skips them). The
// unrestricted coordinate never jumps at a bend; the restricted direction
// is the mob's INTENDED way (lane axis, else the last one it had — a mob
// that loses its lane for a tick would otherwise read its own wobbling yaw
// and flip the pair's sidestep sides — else live yaw), so a mob shoved
// sideways by its peer still reads as going its own way.
function nearestOnRail(mob, path, courseAxis = null) {
  let best = Infinity, q = 0, direction = 1;
  const ax = courseAxis == null ? 0 : Math.sin(courseAxis);
  const az = courseAxis == null ? 0 : Math.cos(courseAxis);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const dot = courseAxis == null ? 1 : ax * dx + az * dz;
    if (courseAxis != null && Math.abs(dot) < 0.5) continue;
    const t = Math.max(0, Math.min(1, (mob.pos.x - a.x) * dx + (mob.pos.z - a.z) * dz));
    const d = Math.hypot(mob.pos.x - a.x - dx * t, mob.pos.z - a.z - dz * t);
    if (d < best) { best = d; q = i + t; direction = dot >= 0 ? 1 : -1; }
  }
  return { q, direction };
}

function progress(mob, path) {
  return nearestOnRail(mob, path, mob.lane?.axis ?? mob._narrow?.axis ?? mob.yaw);
}

// Bend-continuous rail coordinate for gap/closing/swap (no course filter:
// the per-cell direction flips at every bend, so its delta is meaningless
// there).
function railQ(mob, path) {
  return nearestOnRail(mob, path).q;
}

export function activeNarrowPeer(mob) {
  const context = mob._narrow;
  return context?.meeting.active && context.peer.alive ? context.peer : null;
}

function releaseMeeting(mob) {
  mob._passT = 0; mob._passPeer = null; mob._passPreT = 0; mob._passAge = 0;
  if (mob._lineOff) mob._passSettle = 0.15;
}

export function prepareNarrowPairs(peers, dt) {
  const previous = new Map(peers.map(m => [m, m._narrow]));
  const groups = new Map();
  for (const mob of peers) {
    mob._narrow = null;
    if (!mob.alive || mob._carried || mob._riding) continue;
    const rail = closedRail(mob);
    if (!rail) continue;
    const group = groups.get(rail.key) ?? { rail, mobs: [] };
    group.mobs.push(mob); groups.set(rail.key, group);
  }
  for (const { rail, mobs } of groups.values()) {
    if (mobs.length !== 2 || !mobs.every(m => m.speed > 0 && m.hw < 0.5 &&
      hasSupport(m.pos.x, m.pos.y, m.pos.z, m.hw))) continue;
    const [a, b] = mobs, old = previous.get(a);
    const meeting = old?.peer === b && old.key === rail.key ? old.meeting : { active: false };
    const pa = progress(a, rail.path), pb = progress(b, rail.path);
    const pen = worstPairPenAt(a.pos.x, a.pos.z, Math.sin(a.yaw), Math.cos(a.yaw),
      a.hw, a.nose, a.tail, b, 0, 1)?.pen ?? 0;
    // Bend-continuous rail coordinate (no course filter: the per-cell
    // direction flips at a bend, where a filtered delta is meaningless).
    // Memoized per rail: a delta measured against a stale rail would read
    // as a closing pair and hand a crossing allowance to mobs that are not
    // crossing.
    const qa = railQ(a, rail.path), qb = railQ(b, rail.path);
    const dqa = a._railQ?.key === rail.key ? qa - a._railQ.q : 0;
    const dqb = b._railQ?.key === rail.key ? qb - b._railQ.q : 0;
    a._railQ = { key: rail.key, q: qa }; b._railQ = { key: rail.key, q: qb };
    const gap = Math.abs(qb - qa);
    // Meeting signals, all read on the bend-continuous coordinate (centre
    // distance grows while a head-on pair approaches, so it cannot serve):
    // opposed = the two mean to travel opposite ways (intended courses, so
    // a shoved mob still reads its own way and a file never reads crossing;
    // latched, since the read flickers at the swap where the squeeze is
    // deepest); closing = the rail gap really shrinks; swapped = the rail
    // order inverted against the meeting's own baseline (fresh every
    // meeting, so a pair that swaps back re-reads clean). The sidestep rides
    // the approach: up while closing, down once swapped and bodies clear.
    const opposed = pa.direction !== pb.direction;
    const closing = (qb - qa) * (dqb - dqa) < 0;
    meeting.closing = closing;
    const approaching = opposed || closing;
    if (meeting.active) meeting.crossing = meeting.crossing || opposed;
    else meeting.crossing = opposed;
    if (meeting.active) {
      meeting.swapped = meeting.order !== 0 && Math.sign(qb - qa) !== meeting.order;
    }
    const turning = mobs.some(m => m.noseTurn || (m.lane &&
      Math.abs(normYaw(m.yaw - m.lane.axis)) > Math.PI / 2));
    // A pair that touches and stops is jammed whatever its geometry: the
    // agreement is what lets it sort out (the peer gate sits exactly at the
    // contact budget, so neither can step apart alone).
    const blocked = pen > CONTACT_PEN && mobs.every(m =>
      (m._adv ?? m.speed * SERVO_STEP) < m.speed * Math.min(dt, SERVO_STEP) * 0.1);
    meeting.jamT = blocked ? (meeting.jamT ?? 0) + dt : 0;
    const reach = noseReach(a) + noseReach(b);
    // Opens BEFORE the noses meet (the sidestep needs ticks to ramp out;
    // noses touch at two nose reaches — opening late interlocks the heads
    // nose to nose instead of sliding past side by side).
    const near = gap < reach + 0.8 || pen > CONTACT_PEN;
    if (!meeting.active && near && (approaching || turning || meeting.jamT > JAM_TIME) &&
      (pen > CONTACT_PEN || gap < reach + SEP_GAP)) {
      meeting.active = true;
      meeting.order = Math.sign(qb - qa);
      meeting.swapped = false;
    }
    // Held until the bodies really clear: a crossing passes THROUGH each
    // other, so penetration dips to zero at the swap (releasing there
    // re-collides the pair on the far side), and two bodies a body-length
    // apart cannot both sit on the centre line (noses need no room).
    const bodyClear = a.hw + b.hw + SEP_GAP + 0.3;
    if (meeting.active && !approaching && !turning && pen < CLEAR_PEN &&
        gap > bodyClear) {
      meeting.active = false; meeting.crossing = false;
    }
    mobs.forEach((mob, i) => {
      const peer = mobs[1 - i], was = previous.get(mob);
      mob._narrow = { key: rail.key, path: rail.path, peer, meeting,
        side: was?.peer === peer ? was.side : (i === 0 ? 1 : -1),
        axis: mob.lane?.axis ?? was?.axis ?? mob.yaw };
      // Closed connectivity has no outside mouth or wall-follow destination.
      if (!was) { mob.followLine = null; if (mob.roam?.entry) mob.roam = null; }
    });
  }
  // A mob that left the rail has no valid rail coordinate anymore: the
  // memoized reading is dropped with it, so returning to the same rail
  // later does not measure a delta against a stale position.
  for (const mob of peers) if (previous.get(mob) && !mob._narrow) { mob._railQ = null; releaseMeeting(mob); }
}

export function narrowSide(mob) {
  const context = mob._narrow;
  return context ? context.side * progress(mob, context.path).direction : 1;
}

export function narrowPoseOk(mob, x, z, yaw, recover = true, deep = false) {
  const peer = activeNarrowPeer(mob);
  if (!peer) return true;
  // Scratch for the per-part-pair penetrations (candidate and current).
  // The gate runs on the drive path, so the buffers are reused.
  const parts = _parts, curParts = _curParts;
  parts.fill(0); curParts.fill(0);
  worstPairPenAt(x, z, Math.sin(yaw), Math.cos(yaw),
    mob.hw, mob.nose, mob.tail, peer, 0, 1, parts);
  worstPairPenAt(mob.pos.x, mob.pos.z, Math.sin(mob.yaw), Math.cos(mob.yaw),
    mob.hw, mob.nose, mob.tail, peer, 0, 1, curParts);
  const core = mob.hw + peer.hw + SEP_GAP - distance({ x, z }, peer.pos);
  const curCore = mob.hw + peer.hw + SEP_GAP - distance(mob.pos, peer.pos);
  const turning = mob.noseTurn || peer.noseTurn ||
    Math.abs(normYaw(yaw - (mob.lane?.axis ?? yaw))) > 0.3 ||
    Math.abs(normYaw(peer.yaw - (peer.lane?.axis ?? peer.yaw))) > 0.3;
  const offset = m => Math.min(PASS_OFF, 0.5 - m.hw + WALL_ALLOW - 0.001);
  // Corner diagonals offer less separation than straight parallels. Size
  // adjusts that allowance, while a core merge still fails the same gate.
  const coreBudget = Math.max(PASS_BUDGET - SEP_GAP,
    mob.hw + peer.hw + SEP_GAP - (offset(mob) + offset(peer)) / Math.SQRT2);
  const budget = Math.max(coreBudget, turning ? PASS_BUDGET + CROSS_BUDGET : PASS_BUDGET);
  // Per-part-pair gates. A one-cell corridor is narrower than two bodies,
  // so a meeting must overlap: the head of one sweeps past the body of the
  // other, and those two discs may reach full coincidence (their own radii
  // plus the gap — nothing deeper is physically representable). Inside a
  // narrow meeting EVERY pair gets that coincidence limit: the meeting is
  // a passage, not a contact, and a pair that wedges on a part budget in a
  // one-cell corridor never sorts itself out (the leader blocked by the
  // follower's nose, the follower blocked by the leader). The two cores
  // stay inside the corridor fit, so bodies never merge into one blob.
  const squeeze = deep && mob._narrow.meeting.active;
  for (let ai = 0; ai < 3; ai++) for (let bi = 0; bi < 3; bi++) {
    if (ai === PART_CORE && bi === PART_CORE) continue;
    const k = ai * 3 + bi;
    const ceiling = squeeze
      ? Math.max(budget, partRadius(mob, ai) + partRadius(peer, bi) + SEP_GAP) : budget;
    if (parts[k] > Math.max(ceiling, recover ? curParts[k] : 0) + 1e-9) return false;
  }
  return core <= Math.max(coreBudget, recover ? curCore : 0) + 1e-9;
}

export function narrowSense(mob) {
  if (!mob._narrow) return null;
  const free = makeCellFree(mob), cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const opens = CARDINALS.filter(d => { const [x, z] = dirVec(d); return free(cx + x, cz + z); });
  return { opens, walled: CARDINALS.filter(d => !opens.includes(d)) };
}
