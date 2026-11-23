// Chained editing: hold-to-paint, hold-to-dig, and hold-still bridge stairs.
// Port of master's hold-chain mechanics (main.js: CHAIN_HOLD/RATE/ACCEL,
// paint/dig sweeps, feetDest/lineStep/chainPad/chainSpiral) into a registry
// + injected-context module: this file owns the rules, main.js owns the
// wiring (input events, per-frame tick, refresh). All timers run on the
// sim dt passed into tickChain, so pause freezes the chain mid-hold.
import * as THREE from "three";
import { AIR, isLiquid } from "../core/blocks.js";
import { lineStep, strokeGatePass, hasSupport, cellPaintable } from "../core/gridwalk.js";
import { planetBodyAtPlaced, bodyReady, activeBodySeed } from "../world/planets.js";

// Single spec object: every threshold lives here, never scattered.
export const CHAIN_SPEC = {
  hold: 1.0, // dead time before repeats start (both buttons)
  rate: 10, // repeat rate at hold end (per second)
  accel: 10, // rate gain per extra held second
  maxRate: 60, // repeat cap
  range: 4, // anchor radius: chained cells must sit near the hold's history
  sampleStep: 0.5, // sweep sampling density (distance * angle / step)
  sampleMax: 64, // sweep sample cap
  movePx: 15, // deliberate-travel gate: right-hold skips the dead time past this
  bridgeStillPx: 15, // stillness tolerance: left-hold ignores summed travel below this (raw |dx|+|dy|, mirror of movePx)
  maxStepsPerTick: 2, // anti-spiral: bound repeater iterations per frame; surplus is
  // dropped, never banked, so a hitch slows the chain instead of bursting it
  sweepWalkPerTick: 64, // remote-stroke interpolation budget: cells walked
  // between sweep samples per tick; a longer stroke resumes next tick
  // (progressive growth over frames, never a whole body at once)
  sweepWalkSteps: 512, // hard cap on walk attempts per tick (placements +
  // refusals; handled ground passes free), bounding worst-case sweeps
};

// Anchors: every placed/removed cell of this hold (failed attempts count, so
// a paused stroke resumes across refused cells). Cleared on press/release
// only, never mid-hold. Bucketed by floor(c/range) cells, 27-cell lookup.
export class AnchorStore {
  constructor() {
    this.buckets = new Map();
  }
  clear() {
    this.buckets.clear();
  }
  get size() {
    return this.buckets.size;
  }
  push(x, y, z) {
    const r = CHAIN_SPEC.range;
    const k = Math.floor(x / r) + "," + Math.floor(y / r) + "," + Math.floor(z / r);
    let b = this.buckets.get(k);
    if (!b) {
      b = [];
      this.buckets.set(k, b);
    }
    b.push([x, y, z]);
  }
  near(x, y, z) {
    if (this.buckets.size === 0) return true;
    const r = CHAIN_SPEC.range;
    const r2 = r * r;
    const bx = Math.floor(x / r), by = Math.floor(y / r), bz = Math.floor(z / r);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const b = this.buckets.get(bx + dx + "," + (by + dy) + "," + (bz + dz));
          if (!b) continue;
          for (const [ax, ay, az] of b) {
            if ((x - ax) ** 2 + (y - ay) ** 2 + (z - az) ** 2 <= r2) return true;
          }
        }
    return false;
  }
}

// Hold state: one per game (both buttons share the anchor store, like master).
export function createChainState() {
  return {
    hold: { 0: { down: false, t: 0, acc: 0 }, 2: { down: false, t: 0, acc: 0 } },
    anchors: new AnchorStore(),
    chainId: null, // block id latched at left press; mid-hold slot switches are no-ops
    chainHome: null, // bridge cursor: where the stroke/press stopped, resumed while held
    chainPlat: null, // plateau running average (flat blocks per 1 rise/fall)
    chainSpin: 0, // spiral turn counter
    leftMoved: false, // mouse moved since last paint tick (one stroke per event)
    leftEverMoved: false, // deliberate travel since press (kills bridge path)
    leftMoveAcc: 0, // summed raw travel since press; gates leftMoved/leftEverMoved (mirror of rightMoveAcc)
    leftTimer: 0, // stillness accumulator before bridge latches
    leftStairs: false, // bridge mode latched
    leftNoPlace: false, // extension guard (master: TNT-locked aim); never set here
    rightMoved: false, // deliberate travel past movePx (skips the dead time)
    rightMoveAcc: 0,
    paintHasPrev: false,
    paintPrevDir: new THREE.Vector3(0, 0, -1),
    paintPrevEye: new THREE.Vector3(),
    paintPlacedCells: new Set(), // prevents a paint stroke from stacking off its own blocks
    paintLast: null, // persistent walk cursor across ticks (progressive strokes)
    digLast: null,
    paintDone: true, // false when the walk budget ran out: re-sweep next tick
    digDone: true,
    bodyAnchors: new Set(), // celestial body keys the stroke touches (same-body gate)
    walkBudget: 0, // refilled by tickChain every tick, shared by both sweeps
    walkSteps: 0, // hard work cap per tick, shared by both sweeps
    digHasPrev: false,
    digPrevDir: new THREE.Vector3(0, 0, -1),
    digPrevEye: new THREE.Vector3(),
  };
}

export function chainAnchorPush(s, x, y, z) {
  pushAnchor(s, x, y, z);
}

// Anchor push that also records the celestial body (if any) the cell sits
// on: stroke samples on an already-touched body bypass the range-4 history
// gate (same-body continuation), while body-hopping stays gated.
function pushAnchor(s, x, y, z) {
  s.anchors.push(x, y, z);
  const b = planetBodyAtPlaced(x, y, z);
  if (b) s.bodyAnchors.add(b.key);
}

// Body key of a cell (null off-body), for the same-body stroke gate.
function bodyKeyOf(x, y, z) {
  const b = planetBodyAtPlaced(x, y, z);
  return b ? b.key : null;
}
// Paint support for one cell: real voxel support always counts; the body-
// volume clause only counts while that body is still unbuilt (built bodies
// answer from their voxels — otherwise chords seed floaters that validate
// each other, notably glowstone).
function paintableHere(s, ctx, x, y, z) {
  const bk = bodyKeyOf(x, y, z);
  return cellPaintable(
    hasSupport(ctx.getBlock, x, y, z),
    bk,
    bk === null || bodyReady(activeBodySeed(), bk),
    s.bodyAnchors,
    false,
  );
}
// A walk cell is actable when already handled, near the stroke history, or
// on a body the stroke touches; anything else lifts the pen (void between
// bodies never paints).
function walkCellPass(s, x, y, z) {
  if (s.anchors.near(x, y, z)) return true;
  return strokeGatePass(false, bodyKeyOf(x, y, z), s.bodyAnchors);
}
export function chainAnchorNear(s, x, y, z) {
  return s.anchors.near(x, y, z);
}
export function chainAnchorClear(s) {
  s.anchors.clear();
  s.bodyAnchors.clear();
}

// Landing cell for the bridge: one grid step ahead of the player at feet
// level. Over a cliff this prolongs the terrain straight out at foot level;
// solid cells build nothing, liquids are free cells (builds through water).
export function feetDest(px, py, pz, yaw, getBlock, isOob) {
  const cx = Math.round(px - Math.sin(yaw));
  const cz = Math.round(pz - Math.cos(yaw));
  const fy = Math.floor(py);
  if (isOob(cx, fy, cz)) return null;
  const c = getBlock(cx, fy, cz);
  if (c !== AIR && !isLiquid(c)) return null;
  return [cx, fy - 1, cz];
}

// Next grid cell along the straight ray from (fx,fy,fz) toward (dx,dy,dz).
// (Moved to core/gridwalk.js as the generic; re-exported here for compat.)
export { lineStep };

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _sDir = new THREE.Vector3();
const _sEye = new THREE.Vector3();

export function chainSavePaintRay(s, camera) {
  camera.getWorldDirection(s.paintPrevDir);
  s.paintPrevEye.copy(camera.position);
  s.paintHasPrev = true;
}
export function chainSaveDigRay(s, camera) {
  camera.getWorldDirection(s.digPrevDir);
  s.digPrevEye.copy(camera.position);
  s.digHasPrev = true;
}

function sweepCount(prevDir, liveDir, prevEye, liveEye, dist) {
  const ang = prevDir.angleTo(liveDir);
  if (ang > Math.PI / 2) return 1;
  // Far fans converge slowly on screen: consecutive samples 0.5 cells apart
  // is oversampling when a pixel spans tens of voxels — scale the step with
  // distance (local range unchanged) so remote strokes cost samples, not
  // full-length DDA walks; the walk below still covers every inter-sample
  // gap cell by cell.
  const step = CHAIN_SPEC.sampleStep * Math.max(1, dist / 512);
  return Math.min(CHAIN_SPEC.sampleMax, Math.max(1, Math.ceil((dist * ang) / step)));
}

// Interpolation between sweep samples: consecutive aim samples at distance
// land several cells apart, and the anchor range gate would drop them —
// walk every cell from the last one to the new target instead, bounded by
// the per-tick budget. Already-handled cells (this tick's seen set, earlier
// ticks' placements, dug-out air) pass free so a resumed stroke fast-
// forwards to its frontier; leftover resumes next tick (progressive growth).
// One lazy step from `cur` toward `to` (null when already there).
function walkNext(cur, to) {
  if (cur[0] === to[0] && cur[1] === to[1] && cur[2] === to[2]) return null;
  return lineStep(cur[0], cur[1], cur[2], to[0] - cur[0], to[1] - cur[1], to[2] - cur[2]);
}
function near3(cell, x, y, z) {
  return (
    cell &&
    Math.max(Math.abs(x - cell[0]), Math.abs(y - cell[1]), Math.abs(z - cell[2])) <= 3
  );
}

// A dig-walk cell must be a surface cell (open neighbour): the straight walk
// between two surface samples can cross the body interior, and breaking
// those would tunnel instead of sweeping the skin.
function walkIsSurface(ctx, x, y, z) {
  if (ctx.isOob(x, y, z)) return false;
  const g = ctx.getBlock;
  const open = (id) => id === AIR || isLiquid(id);
  return (
    open(g(x + 1, y, z)) || open(g(x - 1, y, z)) ||
    open(g(x, y + 1, z)) || open(g(x, y - 1, z)) ||
    open(g(x, y, z + 1)) || open(g(x, y, z - 1))
  );
}
function cellKey(x, y, z) {
  return x + "," + y + "," + z;
}

// Same-tick pick cache: consecutive sweep samples sit ~half a cell apart at
// the hit depth, so many re-walk the same ray. Reuse the previous hit when
// the new ray passes within half a voxel of the previous hit point at the
// previous hit distance — same-or-neighbour cell, invisible at any range.
// Staleness is self-correcting: a reused paint hit on a just-filled cell
// takes the already-placed skip branch, a reused dig hit on a just-dug cell
// breaks air (no-op), and the cache dies at the tick boundary. Keyed by
// skipLiquid (paint selection vs dig), the projection test absorbs eye moves.
let sweepPickCache = null;
function sweepPick(ctx, eye, dir, skip) {
  const c = sweepPickCache;
  if (c && c.skip === skip && c.hit && isFinite(c.t)) {
    const dx = eye.x + dir.x * c.t - (c.hit.x + 0.5);
    const dy = eye.y + dir.y * c.t - (c.hit.y + 0.5);
    const dz = eye.z + dir.z * c.t - (c.hit.z + 0.5);
    if (dx * dx + dy * dy + dz * dz <= 0.25) return c.hit;
  }
  const hit = ctx.pick(eye, dir, skip);
  if (hit && isFinite(hit.t)) sweepPickCache = { skip, t: hit.t, hit };
  return hit;
}
// ctx shape (injected by main.js, no imports from edit/physics here):
// { camera, currentBlock, selectedId, pick(eye,dir,skip)->hit|null,
//   place(id,x,y,z)->touched[], breakAt(x,y,z)->touched[],
//   getBlock(x,y,z)->id, isOob(x,y,z)->bool, pos:{x,y,z}, yaw }

export function paintSweep(s, id, ctx) {
  const touched = [];
  const skipLiquid = !isLiquid(id);
  ctx.camera.getWorldDirection(_dir);
  _eye.copy(ctx.camera.position);
  let n = 1;
  if (s.paintHasPrev && ctx.currentBlock) {
    const d = Math.hypot(
      ctx.currentBlock.x + 0.5 - _eye.x,
      ctx.currentBlock.y + 0.5 - _eye.y,
      ctx.currentBlock.z + 0.5 - _eye.z
    );
    n = sweepCount(s.paintPrevDir, _dir, s.paintPrevEye, _eye, d);
  }
  if (n <= 1) {
    if (ctx.currentBlock) {
      const hit = ctx.currentBlock;
      if (hit.id === id && s.paintPlacedCells.has(cellKey(hit.x, hit.y, hit.z))) return touched;
      const wx = ctx.currentBlock.x + ctx.currentBlock.face[0];
      const wy = ctx.currentBlock.y + ctx.currentBlock.face[1];
      const wz = ctx.currentBlock.z + ctx.currentBlock.face[2];
      if (!paintableHere(s, ctx, wx, wy, wz)) {
        s.paintDone = true; // skipped: complete, waits for new mouse travel
        return touched;
      }
      if (s.anchors.near(wx, wy, wz)) {
        const got = ctx.place(id, wx, wy, wz);
        for (const c of got) touched.push(c);
        if (got.length) {
          s.paintPlacedCells.add(cellKey(wx, wy, wz));
          if (!s.chainHome) s.chainHome = [wx, wy, wz];
          s.paintLast = [wx, wy, wz];
        }
        pushAnchor(s, wx, wy, wz);
      }
    }
    s.paintDone = true; // single taps always complete: never force a re-sweep
    return touched;
  }
  const seen = new Set();
  let lastOk = s.paintLast ?? null;
  s.paintDone = true;
  for (let i = 1; i <= n && s.paintDone; i++) {
    const t = i / n;
    _sDir.copy(s.paintPrevDir).lerp(_dir, t).normalize();
    _sEye.copy(s.paintPrevEye).lerp(_eye, t);
    const hit = sweepPick(ctx, _sEye, _sDir, skipLiquid);
    if (!hit) {
      lastOk = null;
      continue;
    }
    const cx = hit.x + hit.face[0], cy = hit.y + hit.face[1], cz = hit.z + hit.face[2];
    // Stroke start (or teleport) needs the anchor gate — no teleport
    // starts; past that the walk's own contiguity is the gate, so distant
    // samples stop dropping and the chain covers the whole surface. On a
    // celestial body the stroke already touches, the range gate is waived
    // (same-body continuation — one pixel is tens of voxels out there).
    if (!lastOk) {
      if (!strokeGatePass(s.anchors.near(cx, cy, cz), bodyKeyOf(cx, cy, cz), s.bodyAnchors)) continue;
    } else if (
      !near3(lastOk, cx, cy, cz) &&
      !strokeGatePass(s.anchors.near(cx, cy, cz), bodyKeyOf(cx, cy, cz), s.bodyAnchors)
    ) {
      lastOk = null;
      continue;
    }
    if (hit.id === id && s.paintPlacedCells.has(cellKey(hit.x, hit.y, hit.z))) {
      lastOk = [cx, cy, cz];
      continue;
    }
    let cur = lastOk;
    if (!cur) {
      // Gated fresh target: place the cell itself, then later samples walk
      // on from here. Unsupported void cells are skipped (no mid-air
      // starts); body-volume cells pass via the gate below.
      const k = cx + "," + cy + "," + cz;
      lastOk = [cx, cy, cz];
      if (seen.has(k)) continue;
      seen.add(k);
      if (!paintableHere(s, ctx, cx, cy, cz)) continue;
      if ((s.walkBudget ?? 0) <= 0) {
        s.paintDone = false;
        break;
      }
      s.walkBudget--;
      const got = ctx.place(id, cx, cy, cz);
      for (const c of got) touched.push(c);
      if (got.length) {
        s.paintPlacedCells.add(k);
        if (!s.chainHome) s.chainHome = [cx, cy, cz];
      }
      pushAnchor(s, cx, cy, cz);
      continue;
    }
    for (;;) {
      const nx = walkNext(cur, [cx, cy, cz]);
      if (!nx) break;
      const k = nx[0] + "," + nx[1] + "," + nx[2];
      if (seen.has(k) || s.paintPlacedCells.has(k)) {
        cur = nx;
        lastOk = nx;
        continue; // handled ground: free pass to the frontier
      }
      // Void between bodies lifts the pen (never paint across it); the next
      // sample re-gates fresh, so the stroke resumes on the far side.
      if (!walkCellPass(s, nx[0], nx[1], nx[2])) {
        lastOk = null;
        break;
      }
      // Hard work cap per tick (placements + refusals): the stroke resumes
      // next tick instead of bursting.
      if (s.walkSteps >= CHAIN_SPEC.sweepWalkSteps) {
        s.paintDone = false;
        break;
      }
      s.walkSteps++;
      if ((s.walkBudget ?? 0) <= 0) {
        s.paintDone = false;
        break;
      }
      s.walkBudget--;
      cur = nx;
      lastOk = nx;
      seen.add(k);
      // Walk cells over bare void are skipped, not painted: chords cut the
      // body's curvature between distant samples, and floating paint reads
      // as debris (notably glowstone). Near-surface chord cells pass through
      // the body-volume clause; the walk continues past the gap.
      if (!paintableHere(s, ctx, nx[0], nx[1], nx[2])) continue;
      const got = ctx.place(id, nx[0], nx[1], nx[2]);
      for (const c of got) touched.push(c);
      // Refused cells (solid) refund the placement budget — but still cost
      // a work step above, so walls can't spin the walker forever.
      if (!got.length) s.walkBudget++;
      else {
        s.paintPlacedCells.add(k);
        if (!s.chainHome) s.chainHome = [nx[0], nx[1], nx[2]];
      }
      pushAnchor(s, nx[0], nx[1], nx[2]);
    }
  }
  s.paintLast = lastOk;
  return touched;
}

export function digSweep(s, ctx) {
  const touched = [];
  ctx.camera.getWorldDirection(_dir);
  _eye.copy(ctx.camera.position);
  const bt = sweepPick(ctx, _eye, _dir, true);
  let n = 1;
  if (s.digHasPrev && bt) {
    const d = Math.hypot(bt.x + 0.5 - _eye.x, bt.y + 0.5 - _eye.y, bt.z + 0.5 - _eye.z);
    n = sweepCount(s.digPrevDir, _dir, s.digPrevEye, _eye, d);
  }
  if (n <= 1) {
    if (bt && s.anchors.near(bt.x, bt.y, bt.z)) {
      const got = ctx.breakAt(bt.x, bt.y, bt.z);
      for (const c of got) touched.push(c);
      if (got.length) s.digLast = [bt.x, bt.y, bt.z];
      pushAnchor(s, bt.x, bt.y, bt.z);
    }
    s.digDone = true; // single taps always complete
    chainSaveDigRay(s, ctx.camera);
    return touched;
  }
  const seen = new Set();
  let lastOk = s.digLast ?? null;
  s.digDone = true;
  for (let i = 1; i <= n && s.digDone; i++) {
    const t = i / n;
    _sDir.copy(s.digPrevDir).lerp(_dir, t).normalize();
    _sEye.copy(s.digPrevEye).lerp(_eye, t);
    const hit = sweepPick(ctx, _sEye, _sDir, true);
    if (!hit) {
      lastOk = null;
      continue;
    }
    if (!lastOk) {
      if (!strokeGatePass(s.anchors.near(hit.x, hit.y, hit.z), bodyKeyOf(hit.x, hit.y, hit.z), s.bodyAnchors)) continue;
      // Gated fresh target: break the cell itself under the surface rule.
      lastOk = [hit.x, hit.y, hit.z];
      const k = hit.x + "," + hit.y + "," + hit.z;
      if (seen.has(k)) continue;
      seen.add(k);
      if ((s.walkBudget ?? 0) <= 0) {
        s.digDone = false;
        break;
      }
      s.walkBudget--;
      if (walkIsSurface(ctx, hit.x, hit.y, hit.z)) {
        const got = ctx.breakAt(hit.x, hit.y, hit.z);
        for (const c of got) touched.push(c);
      }
      pushAnchor(s, hit.x, hit.y, hit.z);
      continue;
    }
    if (
      !near3(lastOk, hit.x, hit.y, hit.z) &&
      !strokeGatePass(s.anchors.near(hit.x, hit.y, hit.z), bodyKeyOf(hit.x, hit.y, hit.z), s.bodyAnchors)
    ) {
      lastOk = null;
      continue;
    }
    let cur = lastOk;
    for (;;) {
      const nx = walkNext(cur, [hit.x, hit.y, hit.z]);
      if (!nx) break;
      const k = nx[0] + "," + nx[1] + "," + nx[2];
      const dug = ctx.getBlock(nx[0], nx[1], nx[2]) === AIR;
      if (seen.has(k) || dug) {
        cur = nx;
        lastOk = nx;
        continue; // handled ground: free pass to the frontier
      }
      // Void between bodies lifts the pen; interior (non-surface) cells are
      // skipped, not tunnelled — but still cost a work step below.
      if (!walkCellPass(s, nx[0], nx[1], nx[2])) {
        lastOk = null;
        break;
      }
      if (s.walkSteps >= CHAIN_SPEC.sweepWalkSteps) {
        s.digDone = false;
        break;
      }
      s.walkSteps++;
      if ((s.walkBudget ?? 0) <= 0) {
        s.digDone = false;
        break;
      }
      s.walkBudget--;
      cur = nx;
      lastOk = nx;
      seen.add(k);
      // Interior walk cells are skipped, not tunnelled: only skin breaks.
      // Skipped cells still cost the step above, so deep chords can't spin.
      if (!walkIsSurface(ctx, nx[0], nx[1], nx[2])) continue;
      const got = ctx.breakAt(nx[0], nx[1], nx[2]);
      for (const c of got) touched.push(c);
      // Refused breaks refund the placement budget (step still spent).
      if (!got.length) s.walkBudget++;
      pushAnchor(s, nx[0], nx[1], nx[2]);
    }
  }
  s.digLast = lastOk;
  if (s.digDone) chainSaveDigRay(s, ctx.camera);
  return touched;
}

// 2x2 pad: the cell plus its +x/+z neighbours, so consecutive steps overlap
// into a hole-free staircase. OOB cells are skipped (place would refuse them
// anyway in bounded dims, but must never stamp voxels outside the world).
function chainPad(s, ctx, id, nx, ny, nz) {
  const touched = [];
  const cells = [
    [nx, ny, nz],
    [nx, ny, nz + 1],
    [nx + 1, ny, nz],
    [nx + 1, ny, nz + 1],
  ];
  for (const [x, y, z] of cells) {
    if (ctx.isOob(x, y, z)) continue;
    const got = ctx.place(id, x, y, z);
    for (const c of got) touched.push(c);
    if (got.length) pushAnchor(s, x, y, z);
  }
  return touched;
}

// Steep-slope fallback: circle the cursor clockwise, one level per turn,
// until the slope to the feet flattens and plateauing resumes. Trimmed to
// one center + 6 skirt + 3 single-level walls (10 stamps/step): the ring
// still reads closed, without the double-height outer wall.
function chainSpiral(s, ctx, id, dest, nx, ny, nz) {
  const touched = [];
  const dirs = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ];
  const perps = [
    [0, -1],
    [-1, 0],
    [0, 1],
    [1, 0],
  ];
  const idx = s.chainSpin % 4;
  s.chainSpin = (s.chainSpin + 1) % 4;
  const d = dirs[idx], p = perps[idx];
  if (ny > dest[1]) ny--;
  else if (ny < dest[1]) ny++;
  if (ctx.isOob(nx, ny, nz)) return touched;
  s.chainHome = [nx, ny, nz];
  {
    const got = ctx.place(id, nx, ny, nz);
    for (const c of got) touched.push(c);
    if (got.length) pushAnchor(s, nx, ny, nz);
  }
  const offs = [
    [d[0], d[1]],
    [d[0] * 2, d[1] * 2],
    [d[0] + p[0], d[1] + p[1]],
    [d[0] * 2 + p[0], d[1] * 2 + p[1]],
    [d[0] + p[0] * 2, d[1] + p[1] * 2],
    [d[0] * 2 + p[0] * 2, d[1] * 2 + p[1] * 2],
  ];
  for (const o of offs) {
    const x = nx + o[0], z = nz + o[1];
    if (ctx.isOob(x, ny, z)) continue;
    const got = ctx.place(id, x, ny, z);
    for (const c of got) touched.push(c);
    if (got.length) pushAnchor(s, x, ny, z);
  }
  const walls = [
    [d[0] * 3, d[1] * 3],
    [d[0] * 3 + p[0] * 2, d[1] * 3 + p[1] * 2],
    [d[0] * 2 + p[0] * 3, d[1] * 2 + p[1] * 3],
  ];
  for (const o of walls) {
    const x = nx + o[0], z = nz + o[1];
    if (ctx.isOob(x, ny, z)) continue;
    const got = ctx.place(id, x, ny, z);
    for (const c of got) touched.push(c);
    if (got.length) pushAnchor(s, x, ny, z);
  }
  return touched;
}

export function chainStep(s, ctx, id) {
  const touched = [];
  if (!s.chainHome) return touched;
  const dest = feetDest(ctx.pos.x, ctx.pos.y, ctx.pos.z, ctx.yaw, ctx.getBlock, ctx.isOob);
  if (!dest) return touched;
  let nx = s.chainHome[0], ny = s.chainHome[1], nz = s.chainHome[2];
  const dx = dest[0] - nx, dy = dest[1] - ny, dz = dest[2] - nz;
  const horiz = Math.hypot(dx, dz);
  const vert = Math.abs(dy);
  // Arrival: pad the anchor, the vertical column, and the feet cell.
  if (horiz <= 1 && vert <= 1) {
    for (const c of chainPad(s, ctx, id, nx, ny, nz)) touched.push(c);
    if (ny > dest[1]) for (let y = ny - 1; y >= dest[1]; y--) for (const c of chainPad(s, ctx, id, dest[0], y, dest[2])) touched.push(c);
    else if (ny < dest[1]) for (let y = ny + 1; y <= dest[1]; y++) for (const c of chainPad(s, ctx, id, dest[0], y, dest[2])) touched.push(c);
    for (const c of chainPad(s, ctx, id, dest[0], dest[1], dest[2])) touched.push(c);
    s.chainHome = [dest[0], dest[1], dest[2]];
    return touched;
  }
  // Spiral while the slope is steeper than 45 degrees.
  if (vert > 0 && horiz / vert < 1) {
    return chainSpiral(s, ctx, id, dest, nx, ny, nz);
  }
  const avg = vert > 0 ? horiz / vert : 1;
  if (s.chainPlat == null) s.chainPlat = avg;
  else s.chainPlat = Math.min(s.chainPlat, avg);
  const diag = dx !== 0 && dz !== 0;
  if (diag) {
    nx += dx > 0 ? 1 : -1;
    nz += dz > 0 ? 1 : -1;
  } else {
    const px = nx, pz = nz;
    if (dx !== 0 || dz !== 0) {
      const h = lineStep(nx, ny, nz, dx, 0, dz);
      nx = h[0];
      nz = h[2];
    }
    if (nx === px && nz === pz) return touched;
  }
  const oldY = ny;
  if (vert > 0) {
    s.chainPlat -= 1;
    if (s.chainPlat < 1) {
      if (ny > dest[1]) ny--;
      else if (ny < dest[1]) ny++;
      s.chainPlat += avg;
    }
  }
  if (ctx.isOob(nx, ny, nz)) return touched;
  s.chainHome = [nx, ny, nz];
  if (oldY !== ny) for (const c of chainPad(s, ctx, id, nx, oldY, nz)) touched.push(c);
  for (const c of chainPad(s, ctx, id, nx, ny, nz)) touched.push(c);
  if (dx !== 0 && dz !== 0 && nx === dest[0] && nz === dest[2]) {
    if (!ctx.isOob(nx - 1, ny, nz - 1)) {
      const got = ctx.place(id, nx - 1, ny, nz - 1);
      for (const c of got) touched.push(c);
      if (got.length) pushAnchor(s, nx - 1, ny, nz - 1);
    }
  }
  return touched;
}

// Mode registry: each entry names a hold phase; tickChain dispatches through
// it, never through button forks. New chain kinds register a spec here.
export const CHAIN_MODES = [
  { key: "paint", button: 0, moving: true },
  { key: "bridge", button: 0, moving: false },
  { key: "dig-sweep", button: 2, moving: true },
  { key: "dig-hold", button: 2, moving: false },
];

// Bridge stepper registry: arrival / spiral / plateau dispatch inside
// chainStep on (horiz, vert); geometric variants register here.
export const BRIDGE_STEPPERS = [{ key: "arrival" }, { key: "spiral" }, { key: "plateau" }];

function repeaterStep(chained) {
  return 1 / Math.min(CHAIN_SPEC.maxRate, CHAIN_SPEC.rate + CHAIN_SPEC.accel * chained);
}

// Input event hooks (called from main.js listeners).
export function chainPressLeft(s, selectedId) {
  const h = s.hold[0];
  h.down = true;
  h.t = 0;
  h.acc = 0;
  s.leftMoved = false;
  s.leftMoveAcc = 0;
  s.leftTimer = 0;
  s.leftStairs = false;
  s.leftEverMoved = false;
  s.leftNoPlace = false;
  s.chainPlat = null;
  s.chainSpin = 0;
  s.chainId = selectedId;
  s.paintLast = null;
  s.digLast = null;
  s.paintDone = true;
  s.digDone = true;
  s.anchors.clear();
  s.bodyAnchors.clear();
  s.paintPlacedCells.clear();
}
export function chainPressRight(s) {
  const h = s.hold[2];
  h.down = true;
  h.t = 0;
  h.acc = 0;
  s.rightMoved = false;
  s.rightMoveAcc = 0;
  s.paintLast = null;
  s.digLast = null;
  s.paintDone = true;
  s.digDone = true;
  s.anchors.clear();
  s.bodyAnchors.clear();
}
export function chainReleaseLeft(s) {
  const h = s.hold[0];
  h.down = false;
  h.t = 0;
  h.acc = 0;
  s.chainHome = null;
  s.chainPlat = null;
  s.chainSpin = 0;
  s.chainId = null;
  s.leftStairs = false;
  s.leftTimer = 0;
  s.leftNoPlace = false;
  s.leftMoved = false;
  s.leftMoveAcc = 0;
  s.paintLast = null;
  s.digLast = null;
  s.paintDone = true;
  s.digDone = true;
  s.anchors.clear();
  s.bodyAnchors.clear();
  s.paintHasPrev = false;
  s.paintPlacedCells.clear();
}
export function chainReleaseRight(s) {
  const h = s.hold[2];
  h.down = false;
  h.t = 0;
  h.acc = 0;
  s.rightMoved = false;
  s.rightMoveAcc = 0;
  s.paintLast = null;
  s.digLast = null;
  s.paintDone = true;
  s.digDone = true;
  s.anchors.clear();
  s.bodyAnchors.clear();
  s.digHasPrev = false;
}
export function chainResetOnUnlock(s) {
  s.hold[0].down = s.hold[2].down = false;
  s.hold[0].t = s.hold[2].t = 0;
  s.hold[0].acc = s.hold[2].acc = 0;
  s.chainHome = null;
  s.chainPlat = null;
  s.chainSpin = 0;
  s.chainId = null;
  s.leftStairs = false;
  s.leftTimer = 0;
  s.leftMoveAcc = 0;
  s.rightMoved = false;
  s.rightMoveAcc = 0;
  s.paintLast = null;
  s.digLast = null;
  s.paintDone = true;
  s.digDone = true;
  s.anchors.clear();
  s.bodyAnchors.clear();
  s.paintHasPrev = false;
  s.paintPlacedCells.clear();
  s.digHasPrev = false;
}
export function chainNoteMouseMove(s, dx, dy) {
  // Left-hold stillness tolerance (mirror of the right-hold movePx gate):
  // micro-travel below bridgeStillPx never sets leftMoved/leftEverMoved and
  // never resets the latch timer, so small tremors don't kill the bridge path.
  if (s.hold[0].down) {
    s.leftMoveAcc += Math.abs(dx) + Math.abs(dy);
    if (s.leftMoveAcc >= CHAIN_SPEC.bridgeStillPx) {
      s.leftMoved = true;
      s.leftEverMoved = true;
      s.leftTimer = 0;
    }
  }
  if (s.hold[2].down) {
    s.rightMoveAcc += Math.abs(dx) + Math.abs(dy);
    if (s.rightMoveAcc >= CHAIN_SPEC.movePx) s.rightMoved = true;
  }
}
// Press-place bookkeeping: successful discrete placements seed the bridge
// cursor and an anchor, so a held mouse continues where the tap stopped.
export function chainNotePressPlace(s, x, y, z) {
  s.chainHome = [x, y, z];
  s.chainPlat = null;
  s.chainSpin = 0;
  pushAnchor(s, x, y, z);
  s.paintPlacedCells.add(cellKey(x, y, z));
}

// True while either button is held for chaining. The caller uses the queued
// (budgeted) remesh path for held edits and keeps the synchronous path for
// discrete taps, so a held bridge never pays an inline rebuild per frame.
export function chainHoldActive(s) {
  return s.hold[0].down || s.hold[2].down;
}

// True while the left button drives bridge stairs (still-hold latched,
// arrival / spiral / plateau steppers) as opposed to a moving paint stroke.
// Paint only runs when !leftStairs, so every placement under this gate is
// bridge-type — the official bridge-vs-chain switch for effects policy.
export function chainBridgeActive(s) {
  return s.hold[0].down && s.leftStairs;
}

// Per-frame tick behind simActive. Returns the flat touched-cell list; the
// caller performs the single refresh. Dead times (1.0 s still, both buttons)
// and the 10 -> 60/s acceleration match master exactly.
export function tickChain(s, dt, ctx) {
  const touched = [];
  // Remote-stroke interpolation budget: refilled every tick, shared by the
  // paint and dig sweeps below — a longer stroke resumes over frames.
  // walkSteps hard-caps the tick's walk attempts (placements + refusals).
  s.walkBudget = CHAIN_SPEC.sweepWalkPerTick;
  s.walkSteps = 0;
  // Fresh pick cache every tick (see sweepPick above).
  sweepPickCache = null;
  // Dedupe across pads, steps, and buttons: one Set covers the whole tick,
  // so overlapping 2x2 pads and catch-up iterations never dirty a cell twice.
  const seen = new Set();
  const push = (got) => {
    for (const c of got) {
      const k = c[0] + "," + c[1] + "," + c[2];
      if (!seen.has(k)) {
        seen.add(k);
        touched.push(c);
      }
    }
  };
  if (s.hold[0].down) {
    const liveId = s.chainId ?? ctx.selectedId;
    if (!s.leftStairs && !s.leftEverMoved) {
      if (!s.leftMoved) {
        s.leftTimer += dt;
        if (s.leftTimer >= CHAIN_SPEC.hold) {
          s.leftStairs = true;
          s.hold[0].t = CHAIN_SPEC.hold;
          s.hold[0].acc = 0;
        }
      } else {
        s.leftTimer = 0;
      }
    }
    if (s.leftStairs && !s.leftNoPlace) {
      const h = s.hold[0];
      h.t += dt;
      const chained = h.t - CHAIN_SPEC.hold;
      if (chained >= 0) {
        const step = repeaterStep(chained);
        // Clamp the banked time: surplus past the per-tick cap is dropped,
        // so a hitch yields a steady catch-up instead of a burst of steps.
        h.acc = Math.min(h.acc + dt, step * CHAIN_SPEC.maxStepsPerTick);
        let n = 0;
        while (h.acc >= step && n < CHAIN_SPEC.maxStepsPerTick) {
          h.acc -= step;
          n++;
          push(chainStep(s, ctx, liveId));
        }
      }
    } else if (
      !s.leftNoPlace &&
      (s.leftMoved || s.paintDone === false) &&
      ctx.currentBlock
    ) {
      push(paintSweep(s, liveId, ctx));
      // An unfinished walk re-sweeps next tick without needing new mouse
      // travel; a finished one waits for movement as before.
      s.leftMoved = s.paintDone === false;
    } else {
      s.leftMoved = false;
    }
    // An unfinished walk re-sweeps the SAME arc next tick (progressive
    // growth); only a finished sweep advances the previous ray.
    if (s.paintDone !== false) chainSavePaintRay(s, ctx.camera);
  }
  if (s.hold[2].down) {
    const h = s.hold[2];
    if (s.rightMoved) h.t = Math.max(h.t, CHAIN_SPEC.hold);
    h.t += dt;
    const chained = h.t - CHAIN_SPEC.hold;
    if (chained >= 0) {
      const step = repeaterStep(chained);
      h.acc = Math.min(h.acc + dt, step * CHAIN_SPEC.maxStepsPerTick);
      let n = 0;
      while (h.acc >= step && n < CHAIN_SPEC.maxStepsPerTick) {
        h.acc -= step;
        n++;
        if (ctx.currentBlock) push(digSweep(s, ctx));
      }
    }
  }
  return touched;
}
