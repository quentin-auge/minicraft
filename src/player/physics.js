// Player physics: walk, sprint, jump (hold for higher), autojump on
// 1-block steps, swimming, and hold-jump rebound off water.
// Dropped from master: jump streak speed boost, grapple, fly, mob collision.
import * as THREE from "three";
import { isLiquid } from "../core/blocks.js";
import { getBlock, isSolid, colLiqTop, colTopIdx, dim } from "../core/store.js";
import { dimSpec, dimHasMoon } from "../world/dimensions.js";
import { MOON_MIN_Y } from "../world/moon.js";

export const PLAYER_HW = 0.3;
export const PLAYER_H = 1.8;
export const EYE = 1.62;
export const GRAVITY = 37.44;
export const WALK = 4.4;
export const SPRINT = 7.2;
export const JUMP_MIN = 8.2;
export const JUMP_HOLD_TIME = 0.7;
export const JUMP_THRUST = 45;
export const JUMP_RAMP = 0.25;
export const JUMP_BOOST_ACCEL = 40;
export const JUMP_BOOST_TIME = 0.15;
export const JUMP_BUFFER = 0.2;
export const AIR_STEER = 2.5;
export const AIR_SPRINT = 1.35;
// Grapple-release inertia: linear horizontal bleed (FLING_LIN) from the
// first frame after the fling, so the trajectory is a parabola with a
// vertical asymptote end to end. Below FLING_SNAP the fall reads vertical.
export const FLING_LIN = 0.9;
export const FLING_SNAP = 1.0;
export const STEP_SPEED = 9.5;
export const STEP_UP = 12;
export const STEP_UP_EASE = 0.03;
export const STEP_UP_MIN = 4;
const SWIM_ACCEL = 8;
const SWIM_AREA = 10;
const SWIM_BRAKE = 2.0;
const SWIM_MAX = 64;

export const pos = new THREE.Vector3(0, 20, 0);
export const vel = new THREE.Vector3();
// Shared body handle: movement modes (walk/swim, fly, hooks) all move the
// same player vectors through the axis movers below.
export const playerBody = { pos, vel };
export let yaw = 0;
export let pitch = 0;
export function setYaw(v) { yaw = v; }
export function setPitch(v) { pitch = v; }
export let onGround = false;
export function setOnGround(v) { onGround = v; }

// Ghost pass: a movement mode (hook pull-through, future mob phases) can
// exempt cells from collision without touching the voxel store. Ground
// support scans keep using isSolid; only the axis movers consult this.
let ghostPass = null;
export function setGhostPass(fn) { ghostPass = fn; }
function solidForMove(bx, by, bz) {
  return isSolid(bx, by, bz) && !(ghostPass && ghostPass(bx, by, bz));
}

let stepDown = false;
let wasOnGround = false;
let stepUp = false;
let stepUpClearY = 0;
let stepFromWater = false;
let wasInWater = false;
let airT = 0;
// Time since the last grapple fling (Infinity when inactive): drives the
// linear horizontal bleed above. Stamped by hook release via noteFling.
let flingT = Infinity;
export function noteFling() { flingT = 0; }
let jumpBuffer = 0;
let jumpOriginY = null;
let jumpPeakY = null;
let jumpHoldContinuous = false;
let lastSpaceDownY = null;
let prevSpace = false;

// Hook plane-lock: while a grapple arrival is pinned (not hanging), the
// player is locked to the horizontal plane — horizontal moves, regular
// gravity on drops, never up. Armed by hook arrival, cleared on release.
let hookPlanar = false;
export function setHookPlanar(v) { hookPlanar = v; }
// Hook wet snapshot: whether the arrival itself was in liquid. A wet
// arrival sinks and stays down (horizontal swim only); a dry arrival that
// walks into water floats normally.
let hookWet = false;
export function setHookWet(v) { hookWet = v; }

export const keys = {};

// Knockback impulse shared by every movement mode: blasts add to it, each
// frame applies it on top of the mode's own velocity, then it decays.
// Walk mode keeps its direct vel.set path (unchanged feel); fly mode, which
// overwrites vel every frame, reads the impulse through here instead.
export const knockVel = new THREE.Vector3();
// Decay rate: a passive impulse travels v0 / KNOCK_DECAY blocks, so blast
// code calibrates its initial speed as travel distance x KNOCK_DECAY.
export const KNOCK_DECAY = 2.2;
export function addPlayerKnockback(x, y, z) {
  knockVel.x += x;
  knockVel.y += y;
  knockVel.z += z;
}
export function tickKnockback(dt) {
  const k = Math.exp(-KNOCK_DECAY * dt);
  knockVel.multiplyScalar(k);
  if (knockVel.lengthSq() < 0.25) knockVel.set(0, 0, 0);
}

// Spawn selection lives in the active dimension's spec (`DIMENSIONS`:
// pure voxel search over finished world data); here the pick is applied to
// the player body. Pitch resets so respawns and regens never inherit the
// old look angle.
export function spawnPlayer() {
  const s = dimSpec(dim).findSpawn();
  pos.set(s.x + 0.5, s.y + 1.01, s.z + 0.5);
  setYaw(s.yaw);
  setPitch(0);
  vel.set(0, 0, 0);
  knockVel.set(0, 0, 0);
  onGround = false;
  stepDown = false;
  stepUp = false;
}

export function headInWater() {
  const y0 = Math.floor(pos.y + 0.01);
  const y1 = Math.floor(pos.y + PLAYER_H - 0.01);
  for (let y = y0; y <= y1; y++)
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
        if (isLiquid(getBlock(bx, y, bz))) return true;
      }
  return false;
}

function waterSurfaceTop() {
  // O(1) per column via the liquid-top index: no scan, so swimming beside a
  // tall build costs the same as open water.
  let top = -Infinity;
  for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      const lt = colLiqTop[dim].get(colTopIdx(bx, bz));
      if (lt === undefined) continue;
      if (lt + 1 > top) top = lt + 1;
    }
  return top;
}

function tryStep(bx, by, bz) {
  if (stepDown) return false;
  if (hookPlanar) return false; // plane-locked: blocked, never climb
  if (!stepFromWater) {
    if (!onGround) return false;
    if (by !== Math.floor(pos.y)) return false;
    if (solidForMove(bx, by + 1, bz)) return false;
    stepUp = true;
    stepUpClearY = by + 1;
    vel.y = STEP_UP;
  } else {
    const fy = Math.floor(pos.y);
    if (by !== fy && by !== fy + 1) return false;
    if (solidForMove(bx, by + 1, bz)) return false;
    stepUp = true;
    stepUpClearY = by + 1;
    vel.y = STEP_UP;
  }
  onGround = false;
  stepDown = false;
  return true;
}

function moveAxisX(dx, body = playerBody, step = true) {
  body.pos.x += dx;
  if (dx === 0) return;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? body.pos.x + PLAYER_HW : body.pos.x - PLAYER_HW;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(body.pos.y + PLAYER_H); by >= Math.floor(body.pos.y); by--)
    for (let bz = Math.floor(body.pos.z - PLAYER_HW); bz <= Math.floor(body.pos.z + PLAYER_HW); bz++) {
      if (!solidForMove(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) {
        if (step) { if (!tryStep(cellX, by, bz)) body.vel.x = 0; }
        else body.vel.x = 0;
        body.pos.x = cellX - PLAYER_HW - 0.001; return;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        if (step) { if (!tryStep(cellX, by, bz)) body.vel.x = 0; }
        else body.vel.x = 0;
        body.pos.x = cellX + 1 + PLAYER_HW + 0.001; return;
      }
    }
}

function moveAxisZ(dz, body = playerBody, step = true) {
  body.pos.z += dz;
  if (dz === 0) return;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? body.pos.z + PLAYER_HW : body.pos.z - PLAYER_HW;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(body.pos.y + PLAYER_H); by >= Math.floor(body.pos.y); by--)
    for (let bx = Math.floor(body.pos.x - PLAYER_HW); bx <= Math.floor(body.pos.x + PLAYER_HW); bx++) {
      if (!solidForMove(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) {
        if (step) { if (!tryStep(bx, by, cellZ)) body.vel.z = 0; }
        else body.vel.z = 0;
        body.pos.z = cellZ - PLAYER_HW - 0.001; return;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        if (step) { if (!tryStep(bx, by, cellZ)) body.vel.z = 0; }
        else body.vel.z = 0;
        body.pos.z = cellZ + 1 + PLAYER_HW + 0.001; return;
      }
    }
}

function moveAxisYStep(dy, body = playerBody, step = true) {
  body.pos.y += dy;
  if (step) onGround = false;
  const top = body.pos.y + PLAYER_H, feet = body.pos.y;
  for (let bx = Math.floor(body.pos.x - PLAYER_HW); bx <= Math.floor(body.pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(body.pos.z - PLAYER_HW); bz <= Math.floor(body.pos.z + PLAYER_HW); bz++) {
      if (body.vel.y > 0 && solidForMove(bx, Math.floor(top), bz) && top > Math.floor(top)) {
        body.pos.y = Math.floor(top) - PLAYER_H - 0.001; body.vel.y = 0; return;
      }
      if (body.vel.y <= 0 && solidForMove(bx, Math.floor(feet), bz)) {
        body.pos.y = Math.floor(feet) + 1 + 0.001; body.vel.y = 0;
        if (step) { onGround = true; stepDown = false; stepUp = false; }
        return;
      }
    }
  if (!step) return;
  if (vel.y < 0 && wasOnGround && !stepDown) {
    const fy = Math.floor(pos.y) - 1;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !stepDown; bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
        if (isSolid(bx, fy, bz)) { stepDown = true; break; }
  }
  if (stepDown) {
    const fy = Math.floor(pos.y) - 1;
    let supp = false;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !supp; bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
        if (isSolid(bx, fy, bz)) supp = true;
    if (!supp) stepDown = false;
  }
}

function moveAxisY(dy, body = playerBody, step = true) {
  const n = Math.max(1, Math.ceil(Math.abs(dy) / 0.5));
  const s = dy / n;
  for (let i = 0; i < n; i++) {
    moveAxisYStep(s, body, step);
    if ((step && onGround) || body.vel.y === 0) break;
  }
}

function collide(dt) {
  collideBody(dt, playerBody, true);
}

// Shared mover: every movement mode integrates through the same axis
// collision. step=false disables auto-step and ground bookkeeping (fly,
// hooks); the body is always the player's { pos, vel }.
export function collideBody(dt, body, step) {
  moveAxisY(body.vel.y * dt, body, step);
  moveAxisX(body.vel.x * dt, body, step);
  moveAxisZ(body.vel.z * dt, body, step);
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();

export function updatePlayer(dt) {
  // Plane-locked (pinned grapple): never climb — drop any pending step-up
  // before the movement logic runs. The pull phase never passes through
  // here, so its stepping is unaffected.
  if (hookPlanar) stepUp = false;
  // Low gravity near the Moon and above (master rule): one factor per
  // frame, shared by every acceleration and energy calc below so arcs
  // stay consistent.
  const G = dimHasMoon(dim) && pos.y >= MOON_MIN_Y ? GRAVITY * 0.5 : GRAVITY;
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _move.set(0, 0, 0);
  const w = keys["KeyW"] || keys["ArrowUp"];
  const s = keys["KeyS"] || keys["ArrowDown"];
  const d = keys["KeyD"] || keys["ArrowRight"];
  const a = keys["KeyA"] || keys["ArrowLeft"];
  const sprintKey = !!(keys["Slash"] || keys["/"]);
  if (w) _move.add(_fwd);
  if (s) _move.sub(_fwd);
  if (d) _move.add(_right);
  if (a) _move.sub(_right);

  let inWater = headInWater();
  const enteredWater = inWater && !wasInWater;
  const spaceNow = !!(keys["ShiftLeft"] || keys["ShiftRight"] || keys["Space"] || keys[" "]);
  const spaceJustPressed = spaceNow && !prevSpace;
  const spaceJustReleased = !spaceNow && prevSpace;
  jumpBuffer = Math.max(0, jumpBuffer - dt);
  if (spaceJustPressed) {
    jumpBuffer = Math.max(jumpBuffer, JUMP_BUFFER + dt);
    lastSpaceDownY = pos.y;
    if (!onGround && !inWater) {
      jumpPeakY = pos.y;
      if (jumpOriginY === null) jumpOriginY = pos.y;
      jumpHoldContinuous = true;
    }
  }
  if (spaceJustReleased && vel.y > 0 && !onGround) { vel.y *= 0.45; airT = JUMP_HOLD_TIME; }
  prevSpace = spaceNow;
  if (!onGround && !spaceNow) jumpHoldContinuous = false;
  if (onGround) { jumpOriginY = null; jumpPeakY = null; if (!spaceNow) jumpHoldContinuous = false; }
  if (jumpOriginY !== null && !onGround) jumpPeakY = Math.max(jumpPeakY, pos.y);

  // Rebound: jumping toward water while holding jump bounces back out to the
  // height the jump started from.
  let bounced = false;
  if (enteredWater && spaceNow && !hookPlanar && (jumpOriginY !== null || lastSpaceDownY !== null)) {
    const surface = waterSurfaceTop();
    let liquid = false;
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
      for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
        if (isLiquid(getBlock(bx, surface - 1, bz))) liquid = true;
      }
    if (liquid && surface !== -Infinity) {
      let target = null;
      if (jumpHoldContinuous && jumpPeakY !== null) target = jumpPeakY;
      else if (lastSpaceDownY !== null) target = lastSpaceDownY;
      else target = jumpOriginY;
      if (target !== null && pos.y < target - 0.5) {
        const delta = target - (surface + 0.1);
        if (delta > 0) {
          vel.y = Math.sqrt(2 * G * delta);
          if (sprintKey) {
            if (_move.lengthSq() > 0) {
              const mn = _move.clone().normalize().multiplyScalar(SPRINT * 2);
              vel.x = mn.x; vel.z = mn.z;
            } else { vel.x *= 2; vel.z *= 2; }
          }
          airT = JUMP_HOLD_TIME;
          pos.y = surface + 0.1;
          inWater = false;
          wasInWater = false;
          onGround = false;
          stepUp = false; stepDown = false; stepFromWater = false;
          bounced = true;
        }
      }
    }
  }
  if (!bounced) {
    if (inWater && !wasInWater && vel.y < 0) vel.y *= 0.3;
    wasInWater = inWater;
  }

  if (bounced) {
    // Ballistic rebound arc; steering below applies.
  } else if (inWater) {
    stepDown = false;
    stepFromWater = true;
    const speed = (sprintKey && _move.lengthSq() > 0) ? SPRINT : 4.2;
    if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(speed);
    vel.x += (_move.x - vel.x) * Math.min(1, dt * 8);
    vel.z += (_move.z - vel.z) * Math.min(1, dt * 8);
    if (stepUp) {
      const glide = Math.max(STEP_UP_MIN, Math.min(STEP_UP, (stepUpClearY - pos.y) / STEP_UP_EASE));
      vel.y = glide;
      if (pos.y + glide * dt >= stepUpClearY) {
        pos.y = stepUpClearY;
        vel.y = 0;
        stepUp = false;
        onGround = true;
      }
    } else if (hookPlanar && hookWet) {
      // Pinned wet arrival: sink by gravity, horizontal only.
      vel.y -= G * dt;
      vel.y = Math.min(Math.max(vel.y, -SWIM_MAX), SWIM_MAX);
    } else {
      const surface = waterSurfaceTop();
      if (surface === -Infinity) {
        vel.y -= G * dt;
      } else {
        const targetY = surface - 1.17;
        const err = targetY - pos.y;
        if (err > SWIM_AREA) {
          vel.y += SWIM_ACCEL * dt;
        } else {
          const want = err * 4;
          vel.y += (want - vel.y) * Math.min(1, dt * SWIM_BRAKE * 2);
        }
      }
      vel.y = Math.min(Math.max(vel.y, -SWIM_MAX), SWIM_MAX);
    }
  } else {
    stepFromWater = false;
    const sprint = sprintKey && _move.lengthSq() > 0;
    const speed = sprint ? SPRINT : WALK;
    if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(speed);
    if ((!onGround && !stepUp)) {
      if (_move.lengthSq() > 0) {
        const k = Math.min(1, AIR_STEER * dt);
        const curSpd = Math.hypot(vel.x, vel.z);
        const airTarget = Math.max(curSpd, Math.min(speed * AIR_SPRINT, WALK * 3));
        vel.x += (_move.x * (airTarget / speed) - vel.x) * k;
        vel.z += (_move.z * (airTarget / speed) - vel.z) * k;
      } else if (flingT < Infinity) {
        // No input after a grapple fling: continuous linear drag from
        // release on — the arc steepens all the way to vertical.
        flingT += dt;
        const vh = Math.hypot(vel.x, vel.z);
        if (vh < FLING_SNAP) { vel.x = 0; vel.z = 0; flingT = Infinity; }
        else {
          const drag = Math.exp(-FLING_LIN * dt);
          vel.x *= drag; vel.z *= drag;
        }
      }
    } else {
      airT = 0;
      flingT = Infinity;
      if (_move.lengthSq() > 0) {
        vel.x += (_move.x - vel.x) * Math.min(1, dt * 12);
        vel.z += (_move.z - vel.z) * Math.min(1, dt * 12);
      } else {
        const friction = Math.max(0, 1 - dt * 5);
        vel.x *= friction; vel.z *= friction;
      }
    }
    if (stepUp) {
      const glide = Math.max(STEP_UP_MIN, Math.min(STEP_UP, (stepUpClearY - pos.y) / STEP_UP_EASE));
      vel.y = glide;
      if (pos.y + glide * dt >= stepUpClearY) {
        pos.y = stepUpClearY;
        vel.y = 0;
        stepUp = false;
        onGround = true;
      }
    } else if (stepDown) {
      const fy = Math.floor(pos.y) - 1;
      let supp = false;
      for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW) && !supp; bx++)
        for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++)
          if (isSolid(bx, fy, bz)) supp = true;
      if (!supp) { stepDown = false; vel.y -= G * dt; }
      else vel.y = -STEP_SPEED;
    } else {
      vel.y -= G * dt;
      if (!onGround && spaceNow && airT < JUMP_HOLD_TIME && vel.y > 0) {
        airT += dt;
        vel.y += JUMP_THRUST * Math.min(1, airT / JUMP_RAMP) * dt;
        if (airT <= JUMP_BOOST_TIME) vel.y += JUMP_BOOST_ACCEL * dt;
      }
    }
    if (jumpBuffer > 0 && onGround && !hookPlanar) {
      jumpBuffer = 0;
      vel.y = JUMP_MIN; onGround = false; stepDown = false; stepUp = false;
      jumpOriginY = pos.y; jumpPeakY = pos.y; jumpHoldContinuous = true; lastSpaceDownY = pos.y; airT = 0;
    }
    if (vel.y < -40) vel.y = -40;
  }
  wasOnGround = onGround;
  collide(dt);
}
