// Eye-in-liquid murk: while the camera sits inside a liquid cell, fog and
// background lerp from the air baseline toward that liquid's tint. Gentle
// on purpose — heading and nearby geometry stay readable. The surfaces
// themselves are flat unlit sheets with no depth cue, so this tick is
// the only murk. Tints parallel LIQUID_SURFACE in textures.js without
// importing it (render-side tuning lives here).
import * as THREE from "three";
import { WATER, LAVA, MOON_WATER, isLiquid } from "../core/blocks.js";
import { getBlock } from "../core/store.js";

const LIQUID_FOG = {
  [WATER]: { tint: 0x0d3b7a, near: 2, far: 30 },
  [LAVA]: { tint: 0x14145a, near: 1, far: 1.5 },
  // Long shaft view: the far plane stays open so the submerged eye reads
  // down the whole moon-water column.
  [MOON_WATER]: { tint: 0x7a7e82, near: 2, far: 45 },
};
const TINT_MIX = 0.55;

const _tint = new THREE.Color();
let subSmooth = 0;

// Eye medium: liquid (with id) or air. One interface type = one color, so
// the fog only needs to know whether the eye itself sits in liquid.
export function eyeMediumId(ex, ey, ez) {
  const id = getBlock(Math.floor(ex), Math.floor(ey), Math.floor(ez));
  if (isLiquid(id)) return { type: "liquid", liquid: id };
  return { type: "air", liquid: 0 };
}

export function tickWaterFog(scene, camera, dt, envAir, medium) {
  // The caller (main.js) computes the eye medium once per frame; the
  // fallback keeps direct calls working.
  const m = medium ?? eyeMediumId(camera.position.x, camera.position.y, camera.position.z);
  const target = m.type === "liquid" ? 1 : 0;
  subSmooth += (target - subSmooth) * (1 - Math.exp(-dt * 8));
  if (Math.abs(subSmooth - target) < 0.002) subSmooth = target;
  if (subSmooth === 0) {
    // Eye in air: the fog controller (main.js) owns near/far — copying
    // envAir back here would snap the fog onto every target jump and void
    // its easing. Background/color stay synced (same values, no-op).
    scene.background.copy(envAir.background);
    scene.fog.color.copy(envAir.background);
    return;
  }
  const spec = LIQUID_FOG[m.liquid] || LIQUID_FOG[WATER];
  const k = subSmooth;
  _tint.setHex(spec.tint);
  scene.background.copy(envAir.background).lerp(_tint, k * TINT_MIX);
  scene.fog.color.copy(scene.background);
  scene.fog.near = envAir.near + (spec.near - envAir.near) * k;
  scene.fog.far = envAir.far + (spec.far - envAir.far) * k;
}
