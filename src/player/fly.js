// Fly mode, ported from master freeCam (KeyF): pitch-aware thrust at FLY
// speed (3x with sprint), per-axis slide collision through the shared axis
// movers, no gravity, stepping, or swimming.
import * as THREE from "three";
import { keys, yaw, pitch, playerBody, knockVel, collideBody } from "./physics.js";

export const FLY = 10;

export let flyOn = false;
export function setFly(v) {
  flyOn = v;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();

export function updateFly(dt) {
  const cp = Math.cos(pitch);
  _fwd.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _move.set(0, 0, 0);
  if (keys["KeyW"] || keys["ArrowUp"]) _move.add(_fwd);
  if (keys["KeyS"] || keys["ArrowDown"]) _move.sub(_fwd);
  if (keys["KeyD"] || keys["ArrowRight"]) _move.add(_right);
  if (keys["KeyA"] || keys["ArrowLeft"]) _move.sub(_right);
  const sprint = keys["Slash"] || keys["/"];
  const speed = FLY * (sprint ? 3 : 1);
  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(speed);
  playerBody.vel.set(_move.x, _move.y, _move.z);
  // Blast knockback rides on top of the thrust and decays away in physics.
  playerBody.vel.add(knockVel);
  collideBody(dt, playerBody, false);
}
