// Navigation: how a mob reaches a target. The planner is a cell A* over
// the world's walkable feet cells; the executor drives the existing
// displacement primitives (open roam, wall-follow, 1-wide, 2-wide) along
// the planned cells, so no new locomotion code is introduced.
//
// Two registries keep the engine generic:
//   - traversal strategies (this file): how a mob crosses the world.
//     Each strategy owns its neighbour rule; the planner only knows
//     cells and costs. Ground walk ships; jump, swim, and fly register
//     their own strategy later and the planner picks it up through the
//     mob capabilities alone.
//   - target kinds (targets.js): what the mob is asked to reach.
//
// Three-free: plain cell math over the voxel store, no THREE. Headless
// rigs drive it on live voxels.
import { getBlock } from "../core/store.js";
import { isLiquid } from "../core/blocks.js";
import {
  groundBelow, centerHeadroom, aabbIntersectsSolid, hasSupport, floatLevelAt,
  SHORE_EXIT_EPS, liquidSurface, NO_EXPIRY,
  diagonalSweepFree, treadWide,
} from "./step.js";
import { dropAllowed } from "./livestock.js";
import { dirVec, normYaw } from "./corridor.js";
import { cornerCrossing, stairDiagonal, VIA_LEAVE_DROP } from "./stairs.js";
import { mobType, mobCanFloat } from "./registry.js";
import { contactGoalTiers, targetCells, targetKind } from "./targets.js";

// Traversal strategy registry (stable keys).
const TRAVERSAL_STRATEGIES = [];
const stratByKey = new Map();

export function registerTraversalStrategy(spec) {
  if (!spec?.key || stratByKey.has(spec.key)) throw new Error(`Invalid or duplicate traversal strategy: ${spec?.key}`);
  if (typeof spec.neighbors !== "function") throw new Error(`Traversal strategy without neighbors(): ${spec?.key}`);
  stratByKey.set(spec.key, spec);
  TRAVERSAL_STRATEGIES.push(spec);
  return spec;
}

// First registered strategy whose capability set the mob has. Registry
// order is the priority order (ground walk first).
export function pickStrategy(capabilities) {
  for (const s of TRAVERSAL_STRATEGIES) {
    if ((s.capabilities ?? []).every((c) => capabilities?.[c])) return s;
  }
  return null;
}

// 8-way neighbour order: cardinals first, then diagonals — fixed, so two
// plans over the same world always return the same path.
const DIRS8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
// A corner crossing is a detour: the mob walks wide around the core and
// drops, so it costs more than the straight diagonal and the planner
// prefers the cardinal way whenever one exists.
const STAIR_DETOUR_COST = 0.6;

// One floating step from a plan node: water, dry, or a legal shore exit.
// Water nodes carry their surface so the search keeps levels continuous;
// dry nodes behave exactly like ground-walk nodes.
function floatStep(ctx, from, x, z) {
  const mob = ctx.mob;
  const cx = x + 0.5, cz = z + 0.5;
  const fl = floatLevelAt(mob, cx, cz, from.y);
  if (fl) {
    if (from.wet && Math.abs(fl.surface - (from.surface ?? fl.surface)) > 1e-3) return null;
    // Water neighbours only need a continuous level surface with headroom:
    // the hull may graze a bank while crossing (the drive's contact slide
    // resolves it), so no body-fit veto here.
    if (!centerHeadroom(cx, fl.y, cz, mob.h)) return null;
    return { y: fl.y, wet: true, surface: fl.surface };
  }
  if (from.wet) {
    const g = groundBelow(cx, from.y + 1, cz);
    if (g == null || from.surface == null || g > from.surface + SHORE_EXIT_EPS) return null;
    if (g < from.y - (mob.maxDrop ?? 1) - 1e-3) return null;
    if (aabbIntersectsSolid(cx, g, cz, mob.hw, mob.h)) return null;
    if (!ctx.walkable(x, g, z)) return null;
    return { y: g, wet: false, surface: null };
  }
  const g = ctx.groundLevel(x, z, from.y);
  if (g == null) return null;
  if (!ctx.walkable(x, g, z)) return null;
  return { y: g, wet: false, surface: null };
}

// Floating traversal for walk+float mobs: the dry branch is ground-walk
// unchanged, while reachable water plans at the shared float level and
// only surface-level shores are plannable exits.
function floatWalkNeighbors(ctx, node) {
  const out = [];
  for (const [dx, dz] of DIRS8) {
    const to = floatStep(ctx, node, node.x + dx, node.z + dz);
    if (!to) continue;
    if (dx && dz) {
      if (!floatStep(ctx, node, node.x + dx, node.z)) continue;
      if (!floatStep(ctx, node, node.x, node.z + dz)) continue;
    }
    out.push({ x: node.x + dx, y: to.y, z: node.z + dz, wet: to.wet, surface: to.surface, cost: dx && dz ? Math.SQRT2 : 1 });
  }
  return out;
}

// Floating start cell: a submerged float-capable mob plans from its
// expected float level instead of requiring dry support below it.
function floatStartCell(mob) {
  const wet = liquidSurface(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw, mob.h) != null;
  if (wet && mobCanFloat(mob)) {
    const fl = floatLevelAt(mob, mob.pos.x, mob.pos.z, mob.pos.y);
    if (fl) {
      return { x: Math.floor(mob.pos.x), y: fl.y, z: Math.floor(mob.pos.z), wet: true, surface: fl.surface };
    }
  }
  const g = startCell(mob);
  if (!g) return null;
  return { ...g, wet: false, surface: null };
}

registerTraversalStrategy({
  key: "float-walk",
  capabilities: ["walk", "float"],
  // Flat for execution and the green overlay: the surface path is drawn
  // as floor squares at the planned float levels.
  moves3D: false,
  startCell: floatStartCell,
  neighbors: floatWalkNeighbors,
});

// Ground walk: flat and step-down ground only (never up — walkers have
// no jump capability yet), dry feet, body and headroom clear. Diagonal
// moves never cut a corner: both orthogonal neighbours must walk from
// the same node, so corridors stay cardinal — and a corner (lone-tread,
// vector-driven) diagonal must sweep clear: no solid in either corner
// square inside the swept band, so a walkable-at-its-own-level corner (a
// lower tread, a standable top) never flanks the body at body height (the
// spiral's central column). Wide treads walk axis-separated and never
// sweep, so they keep the old rule.
registerTraversalStrategy({
  key: "ground-walk",
  capabilities: ["walk"],
  // A flat strategy: the mob walks the ground, so its path lies on the
  // floors. A strategy that moves in 3D (jump, swim, fly) declares
  // moves3D and keeps the volumetric path.
  moves3D: false,
  neighbors(ctx, node) {
    const out = [];
    for (const [dx, dz] of DIRS8) {
      const g = ctx.groundLevel(node.x + dx, node.z + dz, node.y);
      if (g == null) continue;
      if (!ctx.walkable(node.x + dx, g, node.z + dz)) continue;
      let stair = null;
      if (dx && dz) {
        // A stair diagonal: the flight turns around a solid corner (a
        // newel post), and the mob walks the crossing point clear of it
        // and drops onto the tread beyond. The corner cells do not walk,
        // so the plain corner rule would refuse the whole staircase.
        // Only a DROP is a staircase: a flat corner (the end of a wall)
        // keeps the plain rule, its body would never fit the crossing.
        //
        // The same rule the step scan reads (stairs.js): the diagonal is
        // walkable whenever the body can sweep the corner, and around a
        // core it takes the crossing point. Both must agree, or the plan
        // would refuse a staircase the yellow commit walks.
        if (g < node.y) {
          stair = stairDiagonal(ctx.mob, node.x, node.z, dx, dz, node.y);
          if (!stair) continue;
        } else {
          const gx = ctx.groundLevel(node.x + dx, node.z, node.y);
          const gz = ctx.groundLevel(node.x, node.z + dz, node.y);
          if (gx == null || gz == null) continue;
          if (!ctx.walkable(node.x + dx, gx, node.z)) continue;
          if (!ctx.walkable(node.x, gz, node.z + dz)) continue;
          const yaw = Math.atan2(dx, dz);
          if (!treadWide(ctx.mob, node.x + dx, node.z + dz, g, yaw) &&
            !diagonalSweepFree(ctx.mob, node.x, node.z, node.y, node.x + dx, node.z + dz, g)) continue;
        }
      }
      // A corner crossing is a detour: the mob walks wide around the core
      // and drops, so it costs more than the straight diagonal and the
      // planner prefers the cardinal way whenever one exists.
      out.push({ x: node.x + dx, y: g, z: node.z + dz,
        cost: dx && dz ? Math.SQRT2 + (stair ? STAIR_DETOUR_COST : 0) : 1 });
    }
    return out;
  },
});

// Planner budget: the search gives up rather than crawling a huge world.
// Node count bounds the work per plan; the radius keeps the search local
// to the target.
export const NAV_MAX_NODES = 20000;
export const NAV_MAX_RADIUS = 192;
export const NAV_RADIUS_MARGIN = 24;

// Executor tuning.
// NAV_PURSUIT: how far ahead along the planned line the mob aims (pure
// pursuit — the target is always ON the path, never a straight-line
// shortcut that leaves it).
export const NAV_PURSUIT = 1.2;
// The plan's direction and a rail's direction agree above this dot
// product (about 75°): below it the rail runs against the plan and the
// plan wins.
export const NAV_PLAN_DOT = 0.25;
// The band around the planned cells the mob's centre must stay inside: a
// diagonal corner cut alone costs 0.71, a corridor ride 0.5 — a ride one
// cell off the line ends.
export const NAV_BAND = 0.8;
// The wedged decision: a mob that stops advancing along its route (it
// pushes a wall, slides along it, or is wedged in a crowd) decides after
// this long. The clock measures the ROUTE, not the body: a mob sliding
// along a wall moves plenty but advances on its path not at all.
export const NAV_BLOCKED_T = 0.3;
// The route must shrink by this much to count as progress (a push that
// slides the mob sideways does not).
export const NAV_PROGRESS = 0.05;
// Two routes are the same way when their remaining lengths agree within
// this much (a route shifted by a push keeps its shape; a detour around
// a new wall is longer).
export const NAV_SAME_ROUTE = 1.0;
// The replan is uncapped: a blocked mob replans until it arrives. A route
// that exists is never abandoned — only a world without any path left
// ends the plan (there is nothing left to arrive at).

function cellKey(c) {
  return `${c.x},${c.y},${c.z}`;
}

function resolveCapabilities(mob, opts = {}) {
  if (opts.capabilities) return opts.capabilities;
  if (mob?.capabilities) return mob.capabilities;
  return mobType(mob?.type)?.capabilities ?? {};
}

// The cell the mob stands in: the support cell under its feet. Null
// when it is not grounded (mid-air, or over a void) — no plan starts
// from thin air.
//
// A mob at a tread lip straddles two cells: its centre already hangs over
// the next one while the feet still stand on the tread behind. The centre
// alone would then read a level below the feet and refuse to plan, so the
// support is read from the whole footprint — the cell that holds the mob
// up owns the plan.
function startCell(mob) {
  const cx = Math.floor(mob.pos.x), cz = Math.floor(mob.pos.z);
  const g0 = groundBelow(mob.pos.x, mob.pos.y + 1, mob.pos.z);
  if (g0 != null && Math.abs(mob.pos.y - g0) <= 0.6) return { x: cx, y: g0, z: cz };
  const hw = mob.hw ?? 0.3;
  let best = null;
  for (let bx = Math.floor(mob.pos.x - hw); bx <= Math.floor(mob.pos.x + hw); bx++) {
    for (let bz = Math.floor(mob.pos.z - hw); bz <= Math.floor(mob.pos.z + hw); bz++) {
      const g = groundBelow(bx + 0.5, mob.pos.y + 0.6, bz + 0.5);
      if (g == null || g > mob.pos.y + 0.6) continue;
      if (!best || g > best.g) best = { g, x: bx, z: bz };
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.g, z: best.z };
}

function makeCtx(mob, maxDrop, obstacles = null) {
  const stepUp = mob.stepUp ?? 0;
  return {
    mob,
    maxDrop,
    obstacles,
    // Ground top under a cell, when the step from `fromY` is legal
    // (never up for a walker, at most maxDrop down).
    groundLevel: (x, z, fromY) => {
      const g = groundBelow(x + 0.5, fromY + 1, z + 0.5);
      if (g == null) return null;
      if (!dropAllowed(fromY, g, maxDrop, stepUp)) return null;
      return g;
    },
    // A whole feet cell walks: the body fits, the head has room, the
    // feet are dry. Live mobs block the plan like blocks: their bodies
    // are obstacles the route must go around.
    walkable: (x, y, z) => {
      const cx = x + 0.5, cz = z + 0.5;
      if (obstacles && obstacleAt(obstacles, cx, cz)) return false;
      if (aabbIntersectsSolid(cx, y, cz, mob.hw, mob.h)) return false;
      if (!centerHeadroom(cx, y, cz, mob.h)) return false;
      if (isLiquid(getBlock(x, y, z))) return false;
      return true;
    },
  };
}

// A live mob in the way reads like a block: the cells its body covers
// are not walkable for the plan.
function obstacleAt(obstacles, cx, cz) {
  for (const o of obstacles) {
    const dx = cx - o.x, dz = cz - o.z;
    const r = o.r ?? 0.5;
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}

// The live mobs around the planner's mob, as plan obstacles (a moving
// mob counts exactly like a blocking one).
export function peerObstacles(peers, mob) {
  const out = [];
  for (const o of peers ?? []) {
    if (!o || o === mob || o.alive === false) continue;
    if (o.dim && mob.dim && o.dim !== mob.dim) continue;
    if (Math.abs(o.pos.y - mob.pos.y) > 1.2) continue;
    const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z;
    if (dx * dx + dz * dz > 32 * 32) continue;
    out.push({ x: o.pos.x, z: o.pos.z, r: (o.hw ?? 0.32) + 0.18 });
  }
  return out;
}

// Minimal binary heap (f, then insertion order): deterministic pops, so
// two plans over the same world return the same path.
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (before(items[i], items[p])) {
        const t = items[i]; items[i] = items[p]; items[p] = t;
        i = p;
      } else break;
    }
  }
  pop() {
    const items = this.items;
    if (!items.length) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < items.length && before(items[l], items[m])) m = l;
        if (r < items.length && before(items[r], items[m])) m = r;
        if (m === i) break;
        const t = items[i]; items[i] = items[m]; items[m] = t;
        i = m;
      }
    }
    return top;
  }
}

function before(a, b) {
  if (a.f !== b.f) return a.f < b.f;
  return a.order < b.order;
}

function heuristic(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Plan a path from the mob to any goal cell of the target. Returns
// {cells, goalCells, goal, cost, tier} or null when no path exists (the
// mob gives up). Deterministic: same world, same mob, same target, same
// path.
//
// The goal cells come in tiers (on top of the target, then beside it):
// the planner tries them in order and keeps the first tier it can reach,
// so a block the mob can climb is reached on top and a block it cannot
// is approached from the side.
export function planPath(mob, target, opts = {}) {
  let tier = 0;
  for (const goalCells of contactGoalTiers(target)) {
    if (!goalCells.length) continue;
    const plan = planToGoals(mob, opts, goalCells, tier);
    if (plan) return plan;
    tier++;
  }
  return null;
}

// The goal cells a plan may use. A huge target would make the search
// explode (the goal set is read per expanded node), so only the cells
// nearest the mob are considered — the closest part of the target is
// what the mob walks to anyway.
export const NAV_MAX_GOALS = 32768;

function capGoals(goalCells, start) {
  if (goalCells.length <= NAV_MAX_GOALS) return goalCells;
  const sorted = [...goalCells].sort((a, b) => {
    const da = heuristic(start, a);
    const db = heuristic(start, b);
    if (da !== db) return da - db;
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.z - b.z;
  });
  return sorted.slice(0, NAV_MAX_GOALS);
}

// The A* itself: a path to any of the given goal cells.
function planToGoals(mob, opts, goalCells, tier) {
  const capabilities = resolveCapabilities(mob, opts);
  const strategy = pickStrategy(capabilities);
  if (!strategy) return null;
  const start = strategy.startCell ? strategy.startCell(mob) : startCell(mob);
  if (!start) return null;
  goalCells = capGoals(goalCells, start);
  const goals = new Set(goalCells.map(cellKey));
  const moves3D = !!strategy.moves3D;
  if (goals.has(cellKey(start))) {
    return { cells: [start], goalCells, goal: start, cost: 0, tier, moves3D };
  }
  const ctx = makeCtx(mob, mob.maxDrop ?? 1, opts.obstacles ?? null);
  // Search radius: the target plus a margin, bounded.
  let far = 0;
  for (const g of goalCells) far = Math.max(far, heuristic(start, g));
  const maxR = Math.min(NAV_MAX_RADIUS, Math.max(NAV_RADIUS_MARGIN, far + NAV_RADIUS_MARGIN));
  const open = new MinHeap();
  const gScore = new Map();
  const came = new Map();
  const startKey = cellKey(start);
  gScore.set(startKey, 0);
  open.push({ f: heuristic(start, goalCells[0]), g: 0, order: 0, node: start });
  let order = 1;
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    const curKey = cellKey(cur.node);
    if (cur.g > (gScore.get(curKey) ?? Infinity)) continue;
    if (goals.has(curKey)) {
      const cells = [];
      let node = cur.node;
      while (node) {
        cells.push({ x: node.x, y: node.y, z: node.z });
        node = came.get(cellKey(node));
      }
      cells.reverse();
      return {
        cells,
        goalCells,
        goal: { x: cur.node.x, y: cur.node.y, z: cur.node.z },
        cost: cur.g,
        tier,
        moves3D,
      };
    }
    if (++expanded > NAV_MAX_NODES) return null;
    for (const nb of strategy.neighbors(ctx, cur.node)) {
      if (Math.hypot(nb.x - start.x, nb.z - start.z) > maxR) continue;
      const nk = cellKey(nb);
      const g = cur.g + nb.cost;
      if (g >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, g);
      came.set(nk, cur.node);
      let h = Infinity;
      for (const goal of goalCells) h = Math.min(h, heuristic(nb, goal));
      open.push({ f: g + h, g, order: order++, node: nb });
    }
  }
  return null;
}

// Assign a target: plan the path and latch it on the mob. Returns the
// plan, or null (no path — the mob keeps walking free and the caller
// knows the target was refused).
export function assignNav(mob, target, opts = {}) {
  const plan = planPath(mob, target, opts);
  if (!plan) {
    clearNav(mob);
    return null;
  }
  const route = routeOf(plan.cells);
  // A latched plan outranks the contact lottery: clear any held dive/exit
  // veto so the planned water route stays walkable.
  mob._transNoDiveT = 0;
  mob._transNoExitT = 0;
  mob.nav = {
    target,
    path: plan.cells,
    points: route.points,
    cum: route.cum,
    goalCells: plan.goalCells,
    tier: plan.tier ?? 0,
    moves3D: !!plan.moves3D,
    capabilities: resolveCapabilities(mob, opts),
    index: 0,
    plan: { x: 0, z: 1 },
    steer: null,
    arc: 0,
    dev: 0,
    pressT: 0,
    lastRem: null,
    stillT: 0,
    lastX: mob.pos.x,
    lastZ: mob.pos.z,
    replans: 0,
  };
  return plan;
}

export function clearNav(mob) {
  if (!mob) return;
  mob.nav = null;
  // The stale commit still pointed into the wall: drop it so the mob
  // decides at once (the mover picks a fresh target this very tick)
  // instead of pushing into the wall until the next re-pick. The turn
  // itself stays smooth — the decision is instant, the rotation is not.
  if (mob.roam?.nav) {
    mob.roam = null;
    mob.target = null;
    mob.wanderT = 0;
  }
}

// The planned line as cell centers — the polyline the mob follows — with
// the cumulative length along it (the route comparison reads it). The line
// is 3D: a staircase descends, so the level is part of the line and of its
// length. A spiral folds back on itself in plan (two legs share the same
// footprint one floor apart), and only the level tells them apart.
function routeOf(cells) {
  const points = cells.map((c) => ({ x: c.x + 0.5, z: c.z + 0.5, y: c.y }));
  const cum = [0];
  for (let i = 0; i + 1 < points.length; i++) {
    cum.push(cum[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z,
      (points[i + 1].y ?? 0) - (points[i].y ?? 0)));
  }
  return { points, cum, length: cum[cum.length - 1] ?? 0 };
}

function segLen(pts, i) {
  const a = pts[i], b = pts[i + 1];
  if (!b) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z, (b.y ?? 0) - (a.y ?? 0));
}

// Arrived: the mob stands on one of the target blocks — its centre is
// over the goal cell, at the goal level.
function arrivedAtGoal(mob, nav) {
  for (const g of nav.goalCells) {
    if (Math.abs(mob.pos.y - g.y) > 0.5) continue;
    const dx = mob.pos.x - (g.x + 0.5);
    const dz = mob.pos.z - (g.z + 0.5);
    if (Math.abs(dx) <= 0.5 && Math.abs(dz) <= 0.5) return g;
  }
  return null;
}

// Pressed at the goal: the mob's body is over the target block but it
// cannot centre itself there — a corridor end wall leaves its nose
// nowhere to go, so the last cell is only ever occupied up to the wall.
// Counted as reached once the mob has stopped advancing (the caller
// checks the stall clock).
//
// Only the on-top tier has this fallback: there the goal cell IS the
// target block, and the mob's body over it means it stood on the block.
// Beside the block (the side tier) the goal cell is a neighbour, and a
// body over that neighbour is not an arrival — the mob still has to walk
// the last step to touch the block.
function pressedAtGoal(mob, nav) {
  if ((nav.tier ?? 0) !== 0) return null;
  if (nav.index < nav.path.length - 2) return null;
  const reach = (mob.hw ?? 0.3) + 0.5;
  for (const g of nav.goalCells) {
    if (Math.abs(mob.pos.y - g.y) > 0.5) continue;
    const dx = mob.pos.x - (g.x + 0.5);
    const dz = mob.pos.z - (g.z + 0.5);
    if (dx * dx + dz * dz <= reach * reach) return g;
  }
  return null;
}

// Pressed at the side: the tier-1 counterpart of the above. A long nose
// (cow) presses the target block while the body stands a hair outside the
// arrival square — close enough that no step fits anymore, far enough
// that the centre test never fires. The stall clock already proved the
// mob cannot walk the last hair: nose on the block plus body at the goal
// cell reads as contact (the target definition), not as a stall.
function pressedAtSide(mob, nav) {
  if ((nav.tier ?? 0) === 0) return null;
  if (nav.index < nav.path.length - 2) return null;
  const kind = targetKind(nav.target?.key);
  // Default tiers only: the side goals are the lateral neighbours of the
  // target blocks, so a goal cell maps back to its block. A custom
  // goalTiers shape owns unknown geometry and keeps the exact behaviour.
  if (!kind || kind.goalTiers) return null;
  const near = [];
  const reach = (mob.hw ?? 0.3) + 0.6;
  for (const g of nav.goalCells) {
    if (Math.abs(mob.pos.y - g.y) > 0.5) continue;
    const dx = mob.pos.x - (g.x + 0.5);
    const dz = mob.pos.z - (g.z + 0.5);
    if (dx * dx + dz * dz <= reach * reach) near.push(g);
  }
  if (!near.length) return null;
  const blocks = new Set(targetCells(nav.target).map((c) => `${c.x},${c.y},${c.z}`));
  const r = (mob.nose?.r ?? 0.2) + 0.05;
  const nx = mob.pos.x + Math.sin(mob.yaw) * (mob.nose?.along ?? 0.3);
  const nz = mob.pos.z + Math.cos(mob.yaw) * (mob.nose?.along ?? 0.3);
  for (const g of near) {
    const cands = [[g.x - 1, g.z], [g.x + 1, g.z], [g.x, g.z - 1], [g.x, g.z + 1]];
    for (const [bx, bz] of cands) {
      if (!blocks.has(`${bx},${g.y},${bz}`)) continue;
      const cx = Math.min(Math.max(nx, bx), bx + 1);
      const cz = Math.min(Math.max(nz, bz), bz + 1);
      if ((nx - cx) * (nx - cx) + (nz - cz) * (nz - cz) <= r * r) return g;
    }
  }
  return null;
}

// Closest point on the planned line: a narrow window around the current
// arc (the path may fold back on itself, so a wide scan could jump to the
// wrong leg) with a global fallback when the mob is far off the line.
// The projection is 3D: on a spiral two legs share the same footprint one
// floor apart, and only the level tells the mob's own leg from the one
// above it.
function projectPath(nav, pos) {
  const pts = nav.points;
  if (pts.length < 2) return null;
  let best = null;
  let cellD = Infinity;
  const scan = (from, to) => {
    for (let i = from; i < to; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, dy = (b.y ?? 0) - (a.y ?? 0);
      const len2 = dx * dx + dz * dz;
      let t = 0;
      if (len2 > 1e-9) t = Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / len2));
      const px = a.x + dx * t, pz = a.z + dz * t, py = (a.y ?? 0) + dy * t;
      const d = Math.hypot(pos.x - px, pos.z - pz, (pos.y ?? 0) - py);
      if (!best || d < best.d) best = { d, x: px, z: pz, arc: i + t };
      // The distance to the nearest planned CELL — the band the mob's
      // centre must stay inside.
      const dc = Math.min(
        Math.hypot(pos.x - a.x, pos.z - a.z),
        Math.hypot(pos.x - b.x, pos.z - b.z));
      if (dc < cellD) cellD = dc;
    }
  };
  scan(Math.max(0, nav.index - 2), Math.min(pts.length - 1, nav.index + 4));
  if (!best || best.d > 2.5) {
    best = null;
    cellD = Infinity;
    scan(0, pts.length - 1);
  }
  best.cellD = cellD;
  return best;
}

// The point on the planned line `dist` metres ahead of the arc position —
// the pure-pursuit target. It always lies ON the path, so the mob walks
// the plan instead of a straight-line shortcut that leaves it.
function pointAhead(nav, arc, dist) {
  const pts = nav.points;
  let i = Math.max(0, Math.min(pts.length - 2, Math.floor(arc)));
  let used = (arc - i) * segLen(pts, i);
  let need = dist;
  while (i < pts.length - 1) {
    const len = segLen(pts, i);
    const left = len - used;
    if (need <= left) {
      const t = len > 1e-9 ? (used + need) / len : 0;
      const a = pts[i], b = pts[i + 1];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    need -= left;
    used = 0;
    i++;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, z: last.z };
}

// The planned direction at the mob's position: the edge it is heading
// into (the segment ahead of the projection), as a unit vector. The
// primitives read it as the plan's preferred direction — the corridor
// servo takes the exit it points at, and a rail that runs the other way
// is dropped.
function planDirection(nav, arc) {
  const pts = nav.points;
  if (pts.length < 2) return { x: 0, z: 1 };
  const i = Math.max(0, Math.min(pts.length - 2, Math.ceil(arc - 1e-6)));
  const a = pts[i], b = pts[i + 1];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

// Does the plan allow a rail (a 1-wide lane or a wall ride) heading
// this way? A rail that runs against the plan is dropped: the plan's
// steering owns the mob. True when there is no plan.
export function navPlanAllows(mob, axis) {
  const nav = mob?.nav;
  if (!nav?.plan) return true;
  const [dx, dz] = dirVec(axis);
  return dx * nav.plan.x + dz * nav.plan.z >= NAV_PLAN_DOT;
}

// The length still to walk on the current route (from the mob's place
// on it). The route comparison reads it.
function remainingLength(nav) {
  const cum = nav.cum;
  if (!cum || cum.length < 2) return 0;
  const i = Math.max(0, Math.min(cum.length - 2, Math.floor(nav.arc)));
  const frac = nav.arc - i;
  const seg = cum[i + 1] - cum[i];
  const total = cum[cum.length - 1];
  return Math.max(0, total - (cum[i] + frac * seg));
}

// Is the new route the same way as the current one? The goal cell and
// the remaining length decide it: a route shifted by a push keeps its
// shape, a detour around a new wall is longer. When there is nothing
// new to try, the mob gives up instead of pressing on.
function sameRoute(nav, route, goal) {
  if (!goal) return false;
  const sameGoal = nav.goalCells.some((g) => g.x === goal.x && g.y === goal.y && g.z === goal.z);
  if (!sameGoal) return false;
  return Math.abs(route.length - remainingLength(nav)) <= NAV_SAME_ROUTE;
}

// How far the mob's centre strays from the planned cells. The mover reads
// it to end a rail that drifts off the band.
export function navPathDistance(mob) {
  return mob?.nav?.dev ?? 0;
}

// Is this cell inside the band around the planned line? A ride's corner
// take must land on the path, not beside it.
export function navCellOnPath(mob, x, z) {
  const nav = mob?.nav;
  if (!nav) return true;
  const cx = x + 0.5, cz = z + 0.5;
  const near = (from, to) => {
    let best = Infinity;
    for (let i = Math.max(0, from); i < Math.min(nav.points.length, to); i++) {
      const p = nav.points[i];
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d < best) best = d;
    }
    return best;
  };
  let best = near(nav.index - 2, nav.index + 6);
  if (best > 2.5) best = near(0, nav.points.length);
  return best <= NAV_BAND;
}

// Is this cell on the remaining planned path? The mouth machinery asks
// before it draws: a mouth that does not serve the plan never hijacks
// the goal.
export function navOnPath(mob, x, z, radius = 1.2) {
  const nav = mob?.nav;
  if (!nav) return true;
  const r2 = radius * radius;
  for (let i = nav.index; i < nav.path.length; i++) {
    const c = nav.path[i];
    const dx = c.x + 0.5 - x, dz = c.z + 0.5 - z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

// The stair diagonal the plan takes at the mob's position: the next
// planned cell is a diagonal DROP. The body must cross that corner
// OBLIQUELY — an axis-separated move would put the core over the void
// corner and stall there — so the commit targets the landing tread and
// drives diagonally, exactly as the step commit does.
//
// The step is the one the mob is STANDING on: a spiral's legs share a
// footprint one floor apart, so the nearest diagonal is not always the
// mob's own (it straddles a corner, both are equally near). The takeoff
// the mob's feet rest on decides it; the nearest one is the fallback.
//
// When a solid core stands in the corner (a newel post), the mob walks
// the crossing point clear of it and drops onto the tread beyond.
function planStair(nav, mob) {
  const cells = nav.path;
  if (!cells || cells.length < 2) return null;
  // Ranked single pass: rank 0 is the takeoff the feet rest on (its own
  // step, never the next leg's — a spiral's legs share a footprint one
  // floor apart, so the nearest diagonal is not always the mob's own),
  // rank 1 the nearest fallback.
  let step = null;
  for (let j = 0; j < cells.length - 1; j++) {
    const from = cells[j], to = cells[j + 1];
    const dx = to.x - from.x, dz = to.z - from.z;
    if (!dx || !dz) continue;
    // Only a DROP is a staircase: a flat diagonal is walked as a plain
    // diagonal, its body never leaves the level.
    if (to.y >= from.y) continue;
    // Only the step the mob is at (or just before it).
    const d = Math.hypot((from.x + 0.5) - mob.pos.x, (from.z + 0.5) - mob.pos.z);
    if (d > 1.6) continue;
    const rank = Math.abs(from.y - mob.pos.y) <= 0.5 ? 0 : 1;
    const cand = { from, to, d, rank, land: { x: to.x + 0.5, z: to.z + 0.5 } };
    if (!step || rank < step.rank || (rank === step.rank && d < step.d)) step = cand;
  }
  if (!step) return null;
  const via = cornerCrossing(mob, step.from.x, step.from.z,
    step.to.x - step.from.x, step.to.z - step.from.z, step.from.y, step.to.x, step.to.z);
  return { from: step.from, to: step.to, via, land: step.land };
}

// Publish the plan as the mob's commit: the existing roam commit drives
// the pursuit target, so the movement primitives (open roam, wall-follow,
// 1-wide, 2-wide) do the walking — the planner only chooses where. An
// entry commit owns the mob meanwhile (the mouth machinery drives it).
function publishNavCommit(mob, tx, tz, extra = {}) {
  const heading = Math.atan2(tx - mob.pos.x, tz - mob.pos.z);
  const target = { x: tx, z: tz };
  mob.target = target;
  mob.wanderT = NO_EXPIRY;
  mob.roam = { mode: "commit", heading, target, tgt: target, t: 0, span: NO_EXPIRY, runT: 0, nav: true, ...extra };
  return true;
}

export function navCommit(mob) {
  const nav = mob.nav;
  if (!nav || !nav.steer) return false;
  if (mob.roam?.entry === true) return false;
  // The stair diagonal the plan takes at the mob's position: the next
  // planned cell is a diagonal DROP. The body must cross that corner
  // OBLIQUELY — an axis-separated move would put the core over the void
  // corner and stall there — so the commit targets the landing tread and
  // drives diagonally, exactly as the step commit does.
  const stair = planStair(nav, mob);
  // A core crossing in progress is kept until the mob lands on the tread
  // beyond: the plan republishes its commit every tick, and the crossing
  // point must survive those republications.
  const cur = mob.roam;
  const crossing = cur && cur.cross === true && cur.via && cur.land &&
    mob.pos.y > cur.viaY - VIA_LEAVE_DROP
    ? { via: cur.via, land: cur.land, level: cur.viaY }
    : null;
  const tx = nav.steer.x, tz = nav.steer.z;
  if (crossing) {
    // The crossing point first, the tread beyond after: the mob steps off
    // the tread and drops onto it.
    return publishNavCommit(mob, crossing.via.x, crossing.via.z,
      { via: { x: crossing.via.x, z: crossing.via.z }, land: crossing.land, viaY: crossing.level, cross: true });
  }
  if (!stair) return publishNavCommit(mob, tx, tz);
  // The mob must STAND on the takeoff tread before it crosses the
  // corner: a mob still falling (or hovering over the void corner)
  // would drift off the tread while it turns, and wedge in the gap. It
  // holds its place until it is supported on the takeoff level.
  const onTakeoff = Math.abs(mob.pos.y - stair.from.y) <= 0.5 &&
    hasSupport(mob.pos.x, mob.pos.y, mob.pos.z, mob.hw);
  if (!onTakeoff) {
    return publishNavCommit(mob, mob.pos.x, mob.pos.z, { heading: mob.yaw, hold: true });
  }
  if (stair.via) {
    // A core stands in the corner: the mob walks the crossing point
    // clear of it and drops onto the tread beyond.
    return publishNavCommit(mob, stair.via.x, stair.via.z,
      { via: { x: stair.via.x, z: stair.via.z }, land: stair.land, viaY: stair.from.y, cross: true });
  }
  // A clear corner: the body crosses it on the diagonal, and the void
  // it passes over is the way down (not a wall).
  return publishNavCommit(mob, stair.land.x, stair.land.z,
    { diag: true, land: stair.land, viaY: stair.from.y });
}

// One nav tick: project the mob onto the planned line, aim at the point
// ahead on it, watch for stalls (replan, then give up), and publish the
// commit. Returns true while the mob is still navigating.
export function navTick(mob, dt, supported, floating, peers = null) {
  const nav = mob.nav;
  if (!nav) return false;
  if (arrivedAtGoal(mob, nav)) {
    clearNav(mob);
    return false;
  }
  const proj = projectPath(nav, mob.pos);
  if (!proj) {
    clearNav(mob);
    return false;
  }
  nav.index = Math.max(0, Math.min(nav.points.length - 2, Math.floor(proj.arc)));
  nav.arc = proj.arc;
  nav.dev = proj.cellD;
  nav.plan = planDirection(nav, proj.arc);
  nav.steer = pointAhead(nav, proj.arc, NAV_PURSUIT);
  // Progress along the route: the remaining length must shrink. A mob
  // that slides along a wall moves plenty but advances on its path not
  // at all — that is the wedged case, and the clock measures the route
  // so it catches it.
  const rem = remainingLength(nav);
  // The baseline moves only when the route really advanced, so a slow
  // walk still counts as progress (the mob may shrink the route by less
  // than the margin per tick).
  const progressed = nav.lastRem == null || rem <= nav.lastRem - NAV_PROGRESS;
  if (progressed) nav.lastRem = rem;
  if (progressed) {
    nav.pressT = 0;
    nav.stillT = 0;
  } else {
    nav.pressT += dt;
  }
  // The body clock: the mob does not move at all (not even a slide
  // along the wall). A mob that slides is still going somewhere; a mob
  // that stands still is wedged.
  const moved = Math.hypot(mob.pos.x - nav.lastX, mob.pos.z - nav.lastZ);
  nav.lastX = mob.pos.x;
  nav.lastZ = mob.pos.z;
  const stride = (mob.speed ?? 1) * dt;
  if (moved < stride * 0.2) nav.stillT += dt;
  else nav.stillT = 0;
  // Pressed at the goal: the mob is as close as it can get (its body is
  // over the block, its nose has nowhere to go). Counted as reached
  // rather than as a stall — the plan is done, not stuck.
  if (nav.pressT >= NAV_BLOCKED_T && pressedAtGoal(mob, nav)) {
    clearNav(mob);
    return false;
  }
  // Nose pressed against the target block with the body at the side goal:
  // contact, not a stall.
  if (nav.pressT >= NAV_BLOCKED_T && pressedAtSide(mob, nav)) {
    clearNav(mob);
    return false;
  }
  // Wedged: decide now. The replan reads the live mobs as obstacles (a
  // moving one exactly like a parked one), so the route goes around them
  // instead of pushing through; with no route around, the plain plan
  // stands — a peer never makes the path vanish. A new route is adopted
  // at once (the mob turns to it immediately).
  //
  // A route that EXISTS is never abandoned: the mob keeps its target and
  // keeps retrying, so a world that opens (a bridge built, a peer gone,
  // a staircase finished) still delivers it. Only a target no route can
  // reach at all ends the plan — there is nothing left to arrive at.
  if (nav.pressT >= NAV_BLOCKED_T) {
    nav.pressT = 0;
    nav.replans++;
    const obstacles = peerObstacles(peers, mob);
    let plan = obstacles.length
      ? planPath(mob, nav.target, { capabilities: nav.capabilities, obstacles })
      : null;
    if (!plan) plan = planPath(mob, nav.target, { capabilities: nav.capabilities });
    if (!plan) {
      // Unreachable: no route exists now and none can be built. The mob
      // gives the target up — it cannot arrive at what nothing reaches.
      clearNav(mob);
      return false;
    }
    const route = routeOf(plan.cells);
    if (sameRoute(nav, route, plan.goal)) {
      // Nothing new to try. A mob that keeps sliding is still getting
      // somewhere; a mob that stands still cannot walk this route yet.
      // The target stays: the route may open later, and the mob must
      // still arrive.
      nav.wedged = true;
    }
    nav.path = plan.cells;
    nav.points = route.points;
    nav.cum = route.cum;
    nav.goalCells = plan.goalCells;
    nav.tier = plan.tier ?? 0;
    nav.moves3D = !!plan.moves3D;
    nav.index = 0;
    nav.steer = null;
    nav.dev = 0;
    nav.lastRem = null;
  }
  navCommit(mob);
  return true;
}
