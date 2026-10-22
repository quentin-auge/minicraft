// Chained editing: hold-to-paint, hold-to-dig, and hold-still bridge stairs.
// Port of master's hold-chain mechanics (main.js: CHAIN_HOLD/RATE/ACCEL,
// paint/dig sweeps, feetDest/lineStep/chainPad/chainSpiral) into a registry
// + injected-context module: this file owns the rules, main.js owns the
// wiring (input events, per-frame tick, refresh). All timers run on the
// sim dt passed into tickChain, so pause freezes the chain mid-hold.
import * as THREE from "three";
import { AIR, isLiquid } from "../core/blocks.js";

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
    digHasPrev: false,
    digPrevDir: new THREE.Vector3(0, 0, -1),
    digPrevEye: new THREE.Vector3(),
  };
}

export function chainAnchorPush(s, x, y, z) {
  s.anchors.push(x, y, z);
}
export function chainAnchorNear(s, x, y, z) {
  return s.anchors.near(x, y, z);
}
export function chainAnchorClear(s) {
  s.anchors.clear();
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
export function lineStep(fx, fy, fz, dx, dy, dz) {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const tMx = ux > 0 ? 0.5 / ux : ux < 0 ? 0.5 / -ux : Infinity;
  const tMy = uy > 0 ? 0.5 / uy : uy < 0 ? 0.5 / -uy : Infinity;
  const tMz = uz > 0 ? 0.5 / uz : uz < 0 ? 0.5 / -uz : Infinity;
  let nx = fx, ny = fy, nz = fz;
  if (tMy < tMx && tMy < tMz) ny += uy > 0 ? 1 : -1;
  else if (tMz < tMx) nz += uz > 0 ? 1 : -1;
  else nx += ux > 0 ? 1 : -1;
  return [nx, ny, nz];
}

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
  return Math.min(CHAIN_SPEC.sampleMax, Math.max(1, Math.ceil((dist * ang) / CHAIN_SPEC.sampleStep)));
}

function adjacentTo(cell, x, y, z) {
  return (
    cell &&
    Math.max(Math.abs(x - cell[0]), Math.abs(y - cell[1]), Math.abs(z - cell[2])) <= 1
  );
}
function cellKey(x, y, z) {
  return x + "," + y + "," + z;
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
      if (s.anchors.near(wx, wy, wz)) {
        const got = ctx.place(id, wx, wy, wz);
        for (const c of got) touched.push(c);
        if (got.length) {
          s.paintPlacedCells.add(cellKey(wx, wy, wz));
          if (!s.chainHome) s.chainHome = [wx, wy, wz];
        }
        s.anchors.push(wx, wy, wz);
      }
    }
    return touched;
  }
  const seen = new Set();
  let lastOk = null;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    _sDir.copy(s.paintPrevDir).lerp(_dir, t).normalize();
    _sEye.copy(s.paintPrevEye).lerp(_eye, t);
    const hit = ctx.pick(_sEye, _sDir, skipLiquid);
    if (!hit) {
      lastOk = null;
      continue;
    }
    const cx = hit.x + hit.face[0], cy = hit.y + hit.face[1], cz = hit.z + hit.face[2];
    if (!s.anchors.near(cx, cy, cz) && !adjacentTo(lastOk, cx, cy, cz)) continue;
    lastOk = [cx, cy, cz];
    if (hit.id === id && s.paintPlacedCells.has(cellKey(hit.x, hit.y, hit.z))) continue;
    const k = cx + "," + cy + "," + cz;
    if (seen.has(k)) continue;
    seen.add(k);
    const got = ctx.place(id, cx, cy, cz);
    for (const c of got) touched.push(c);
    if (got.length) {
      s.paintPlacedCells.add(k);
      if (!s.chainHome) s.chainHome = [cx, cy, cz];
    }
    s.anchors.push(cx, cy, cz);
  }
  return touched;
}

export function digSweep(s, ctx) {
  const touched = [];
  ctx.camera.getWorldDirection(_dir);
  _eye.copy(ctx.camera.position);
  const bt = ctx.pick(_eye, _dir, true);
  let n = 1;
  if (s.digHasPrev && bt) {
    const d = Math.hypot(bt.x + 0.5 - _eye.x, bt.y + 0.5 - _eye.y, bt.z + 0.5 - _eye.z);
    n = sweepCount(s.digPrevDir, _dir, s.digPrevEye, _eye, d);
  }
  if (n <= 1) {
    if (bt && s.anchors.near(bt.x, bt.y, bt.z)) {
      const got = ctx.breakAt(bt.x, bt.y, bt.z);
      for (const c of got) touched.push(c);
      s.anchors.push(bt.x, bt.y, bt.z);
    }
    chainSaveDigRay(s, ctx.camera);
    return touched;
  }
  const seen = new Set();
  let lastOk = null;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    _sDir.copy(s.digPrevDir).lerp(_dir, t).normalize();
    _sEye.copy(s.digPrevEye).lerp(_eye, t);
    const hit = ctx.pick(_sEye, _sDir, true);
    if (!hit) {
      lastOk = null;
      continue;
    }
    if (!s.anchors.near(hit.x, hit.y, hit.z) && !adjacentTo(lastOk, hit.x, hit.y, hit.z)) continue;
    lastOk = [hit.x, hit.y, hit.z];
    const k = hit.x + "," + hit.y + "," + hit.z;
    if (seen.has(k)) continue;
    seen.add(k);
    const got = ctx.breakAt(hit.x, hit.y, hit.z);
    for (const c of got) touched.push(c);
    s.anchors.push(hit.x, hit.y, hit.z);
  }
  chainSaveDigRay(s, ctx.camera);
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
    if (got.length) s.anchors.push(x, y, z);
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
    if (got.length) s.anchors.push(nx, ny, nz);
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
    if (got.length) s.anchors.push(x, ny, z);
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
    if (got.length) s.anchors.push(x, ny, z);
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
      if (got.length) s.anchors.push(nx - 1, ny, nz - 1);
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
  s.anchors.clear();
  s.paintPlacedCells.clear();
}
export function chainPressRight(s) {
  const h = s.hold[2];
  h.down = true;
  h.t = 0;
  h.acc = 0;
  s.rightMoved = false;
  s.rightMoveAcc = 0;
  s.anchors.clear();
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
  s.anchors.clear();
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
  s.anchors.clear();
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
  s.anchors.clear();
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
  s.anchors.push(x, y, z);
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
      s.leftMoved &&
      ctx.currentBlock
    ) {
      push(paintSweep(s, liveId, ctx));
      s.leftMoved = false;
    } else {
      s.leftMoved = false;
    }
    chainSavePaintRay(s, ctx.camera);
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
