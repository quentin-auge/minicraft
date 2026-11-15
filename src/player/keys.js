export function isUp(k) { return !!(k["KeyW"] || k["ArrowUp"]); }
export function isDown(k) { return !!(k["KeyS"] || k["ArrowDown"]); }
export function isLeft(k) { return !!(k["KeyA"] || k["ArrowLeft"]); }
export function isRight(k) { return !!(k["KeyD"] || k["ArrowRight"]); }
export function isJump(k) { return !!(k["Space"] || k[" "] || k["Slash"] || k["/"]); }
export function isSprint(k) { return !!(k["ShiftLeft"] || k["ShiftRight"] || k["Shift"]); }
export function isConfirm(k) { return !!(k["Enter"] || k["NumpadEnter"]); }

export function isJumpCode(code) { return code === "Space" || code === "Slash"; }
export function isMenuUpCode(code) { return code === "ArrowUp" || code === "KeyW"; }
export function isMenuDownCode(code) { return code === "ArrowDown" || code === "KeyS"; }
export function isConfirmCode(code) { return code === "Enter" || code === "NumpadEnter"; }
export function isResumeCode(code) { return code === "Enter" || code === "NumpadEnter" || code === "Escape"; }
export function isFlyCode(code) { return code === "KeyF"; }
export function isGrappleCode(code) { return code === "KeyG"; }
export function isGrappleButton(button) { return button === 1; }
export function isHelpCode(code) { return code === "KeyH"; }
export function isSpawnPickerCode(code) { return code === "KeyB"; }
export function isTargetDebugCode(code) { return code === "KeyC"; }
export function isWorldCycleCode(code) { return code === "KeyZ"; }
export function isSpeedCycleCode(code) { return code === "KeyV"; }
export function isHotbarPrevCode(code) { return code === "KeyK"; }
export function isHotbarNextCode(code) { return code === "KeyL"; }
export function isDebugCode(code) { return code === "Equal"; }
export function isEscapeCode(code) { return code === "Escape"; }
