// End dimension voxel generation and per-world boss progression.
import { ENDSTONE, PORTAL } from "../core/blocks.js";
import { key, protectCell, resetWorld, setBlock, setDimension } from "../core/store.js";

export const END_PLATFORM_TOP = 0;
export const END_PLATFORM_RADIUS = 36;
export const END_RETURN_Z = 16;
export const END_RETURN_BASE_Y = END_PLATFORM_TOP + 1;
export const END_SPAWN = { x: 0, y: END_PLATFORM_TOP, z: END_RETURN_Z - 3, yaw: 0 };

let endCleared = false;
let returnFrameKeys = [];

export function isEndCleared() {
  return endCleared;
}

export function setEndCleared(value) {
  endCleared = !!value;
}

export function endPortalFrameKeys() {
  return returnFrameKeys.slice();
}

export function resetEndDimension() {
  setDimension("end");
  resetWorld("end");
  endCleared = false;
  returnFrameKeys = [];
}

export function generateEndDimension() {
  resetEndDimension();
  const R = END_PLATFORM_RADIUS;
  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      setBlock(x, END_PLATFORM_TOP, z, ENDSTONE);
      protectCell(x, END_PLATFORM_TOP, z, "end");
    }
  }

  // The return window is always framed; portal.js gates its fill until the
  // dragon is defeated. The omitted corners match master's frame.
  for (let x = -2; x <= 2; x++) {
    for (let y = 0; y <= 4; y++) {
      const corner = (Math.abs(x) === 2 && (y === 0 || y === 4));
      const edge = Math.abs(x) === 2 || y === 0 || y === 4;
      if (!edge || corner) continue;
      const by = END_RETURN_BASE_Y + y;
      setBlock(x, by, END_RETURN_Z, PORTAL);
      protectCell(x, by, END_RETURN_Z, "end");
      returnFrameKeys.push(key(x, by, END_RETURN_Z));
    }
  }
  return true;
}

export function findEndSpawn() {
  return { ...END_SPAWN };
}
