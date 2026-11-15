import assert from "node:assert/strict";
import {
  isUp, isDown, isLeft, isRight, isJump, isSprint, isConfirm,
  isJumpCode, isMenuUpCode, isMenuDownCode, isConfirmCode, isResumeCode,
  isFlyCode, isGrappleCode, isGrappleButton, isHelpCode, isSpawnPickerCode,
  isTargetDebugCode, isWorldCycleCode, isSpeedCycleCode, isHotbarPrevCode,
  isHotbarNextCode, isDebugCode, isEscapeCode,
} from "../../../src/player/keys.js";

const k = (...codes) => Object.fromEntries(codes.map((c) => [c, true]));

assert.equal(isUp(k("KeyW")), true);
assert.equal(isUp(k("ArrowUp")), true);
assert.equal(isUp(k("KeyS")), false);
assert.equal(isDown(k("KeyS")), true);
assert.equal(isDown(k("ArrowDown")), true);
assert.equal(isLeft(k("KeyA")), true);
assert.equal(isLeft(k("ArrowLeft")), true);
assert.equal(isRight(k("KeyD")), true);
assert.equal(isRight(k("ArrowRight")), true);

assert.equal(isJump(k("Space")), true);
assert.equal(isJump(k(" ")), true);
assert.equal(isJump(k("Slash")), true);
assert.equal(isJump(k("/")), true);
assert.equal(isJump(k("KeyW")), false);

assert.equal(isSprint(k("ShiftLeft")), true);
assert.equal(isSprint(k("ShiftRight")), true);
assert.equal(isSprint(k("Shift")), true);
assert.equal(isSprint(k("KeyF")), false);

assert.equal(isConfirm(k("Enter")), true);
assert.equal(isConfirm(k("NumpadEnter")), true);
assert.equal(isConfirm(k("KeyE")), false);

assert.equal(isJumpCode("Space"), true);
assert.equal(isJumpCode("Slash"), true);
assert.equal(isJumpCode("KeyW"), false);
assert.equal(isMenuUpCode("ArrowUp"), true);
assert.equal(isMenuUpCode("KeyW"), true);
assert.equal(isMenuDownCode("ArrowDown"), true);
assert.equal(isMenuDownCode("KeyS"), true);
assert.equal(isConfirmCode("Enter"), true);
assert.equal(isConfirmCode("NumpadEnter"), true);
assert.equal(isResumeCode("Escape"), true);
assert.equal(isResumeCode("Enter"), true);
assert.equal(isFlyCode("KeyF"), true);
assert.equal(isGrappleCode("KeyG"), true);
assert.equal(isGrappleButton(1), true);
assert.equal(isGrappleButton(0), false);
assert.equal(isHelpCode("KeyH"), true);
assert.equal(isSpawnPickerCode("KeyB"), true);
assert.equal(isTargetDebugCode("KeyC"), true);
assert.equal(isWorldCycleCode("KeyZ"), true);
assert.equal(isSpeedCycleCode("KeyV"), true);
assert.equal(isHotbarPrevCode("KeyK"), true);
assert.equal(isHotbarNextCode("KeyL"), true);
assert.equal(isDebugCode("Equal"), true);
assert.equal(isEscapeCode("Escape"), true);

console.log("keys.test.mjs OK");
