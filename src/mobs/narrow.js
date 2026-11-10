// Contact-scoped passing agreements. Connectivity informs the existing servo;
// this module never writes a position or replaces locomotion.
import { makeCellFree, hasSupport, SERVO_STEP } from "./step.js";
import { worldRevision } from "../core/store.js";
import { normYaw, CARDINALS, dirVec } from "./corridor.js";
import {
  worstPairPenAt, noseReach, SEP_GAP, CROSS_BUDGET, PASS_OFF, PASS_BUDGET, WALL_ALLOW,
} from "./collide.js";

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
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

function progress(mob, path) {
  let best = Infinity, q = 0, direction = 1;
  const axis = mob.lane?.axis ?? mob.yaw;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const dot = Math.sin(axis) * dx + Math.cos(axis) * dz;
    // At a bend the nearest segment can be perpendicular to the intended
    // course. It cannot determine which side of the outgoing arm to use.
    if (Math.abs(dot) < 0.5) continue;
    const t = Math.max(0, Math.min(1, (mob.pos.x - a.x) * dx + (mob.pos.z - a.z) * dz));
    const d = Math.hypot(mob.pos.x - a.x - dx * t, mob.pos.z - a.z - dz * t);
    if (d < best) { best = d; q = i + t; direction = dot >= 0 ? 1 : -1; }
  }
  return { q, direction };
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
    const gap = Math.abs(pa.q - pb.q);
    const approaching = (pb.q - pa.q) * (pa.direction - pb.direction) > 0;
    const turning = mobs.some(m => m.noseTurn || (m.lane &&
      Math.abs(normYaw(m.yaw - m.lane.axis)) > Math.PI / 2));
    // An initially overlapping file can jam before either animal reaches
    // its first turn. Only sustained real contact permits an unstack slide.
    const blocked = pen > CROSS_BUDGET && mobs.every(m =>
      (m._adv ?? m.speed * SERVO_STEP) < m.speed * Math.min(dt, SERVO_STEP) * 0.1);
    meeting.jamT = blocked ? (meeting.jamT ?? 0) + dt : 0;
    const reach = noseReach(a) + noseReach(b);
    const near = gap < reach + 0.3 || pen > CONTACT_PEN;
    if (!meeting.active && near && (approaching || turning || meeting.jamT > JAM_TIME) &&
      (pen > CONTACT_PEN || gap < reach + SEP_GAP)) meeting.active = true;
    if (meeting.active && !approaching && !turning && pen < CLEAR_PEN) meeting.active = false;
    mobs.forEach((mob, i) => {
      const peer = mobs[1 - i], was = previous.get(mob);
      mob._narrow = { key: rail.key, path: rail.path, peer, meeting,
        side: was?.peer === peer ? was.side : (i === 0 ? 1 : -1) };
      // Closed connectivity has no outside mouth or wall-follow destination.
      if (!was) { mob.followLine = null; if (mob.roam?.entry) mob.roam = null; }
    });
  }
  for (const mob of peers) if (previous.get(mob) && !mob._narrow) releaseMeeting(mob);
}

export function narrowSide(mob) {
  const context = mob._narrow;
  return context ? context.side * progress(mob, context.path).direction : 1;
}

export function narrowPoseOk(mob, x, z, yaw, recover = true) {
  const peer = activeNarrowPeer(mob);
  if (!peer) return true;
  const pen = worstPairPenAt(x, z, Math.sin(yaw), Math.cos(yaw),
    mob.hw, mob.nose, mob.tail, peer, 0, 1)?.pen ?? 0;
  const cur = worstPairPenAt(mob.pos.x, mob.pos.z, Math.sin(mob.yaw), Math.cos(mob.yaw),
    mob.hw, mob.nose, mob.tail, peer, 0, 1)?.pen ?? 0;
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
  return core <= Math.max(coreBudget, recover ? curCore : 0) + 1e-9 &&
    pen <= Math.max(budget, recover ? cur : 0) + 1e-9;
}

export function narrowSense(mob) {
  if (!mob._narrow) return null;
  const free = makeCellFree(mob), cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const opens = CARDINALS.filter(d => { const [x, z] = dirVec(d); return free(cx + x, cz + z); });
  return { opens, walled: CARDINALS.filter(d => !opens.includes(d)) };
}
