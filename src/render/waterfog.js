// Eye-in-liquid murk: while the camera sits inside a liquid cell, fog and
// background lerp from the air baseline toward that liquid's tint. Gentle
// on purpose — heading and nearby geometry stay readable. The surfaces
// themselves are flat unlit sheets with no depth cue, so this tick is
// the only murk. Tints parallel LIQUID_SURFACE in textures.js without
// importing it (render-side tuning lives here).
import * as THREE from "three";
import { AIR, WATER, MOON_WATER, isLiquid } from "../core/blocks.js";
import { getBlock, isEyePocketed } from "../core/store.js";

const LIQUID_FOG = {
  [WATER]: { tint: 0x0d3b7a, near: 2, far: 30 },
  [MOON_WATER]: { tint: 0x7a7e82, near: 2, far: 13 },
};
const TINT_MIX = 0.55;

const _tint = new THREE.Color();
let subSmooth = 0;

// Eye medium for pocket-veil gating (mesher.js `setEyeMedium`): liquid
// (with id), air pocketed by liquid (with the hemming liquid's id, both
// veils hidden there so pockets read pure blue), or open air. The fog tick
// below only murks liquid eyes; pocket eyes stay clear. The enclosed test
// rides the colTop fast path,
// so open sky resolves in O(1) per frame. A pocket eye reads its liquid
// from its direct neighbors first (exact near walls); deeper inside, where
// no liquid touches the eye cell, it reuses the last liquid seen (kept for
// the veil gate; the fog itself stays clear there).
let lastPocketLiquid = 0;
export function eyeMediumId(ex, ey, ez) {
  const x = Math.floor(ex), y = Math.floor(ey), z = Math.floor(ez);
  const id = getBlock(x, y, z);
  if (isLiquid(id)) { lastPocketLiquid = id; return { type: "liquid", liquid: id }; }
  if (id === AIR && isEyePocketed(x, y, z)) {
    const ns = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const [dx, dy, dz] of ns) {
      const n = getBlock(x + dx, y + dy, z + dz);
      if (isLiquid(n)) { lastPocketLiquid = n; return { type: "pocket", liquid: n }; }
    }
    return { type: "pocket", liquid: lastPocketLiquid };
  }
  return { type: "air", liquid: 0 };
}

export function tickWaterFog(scene, camera, dt, envAir, medium) {
  // The caller (main.js) computes the eye medium once per frame and shares it
  // with the veil gate; the fallback keeps direct calls working.
  const m = medium ?? eyeMediumId(camera.position.x, camera.position.y, camera.position.z);
  const target = m.type === "liquid" ? 1 : 0;
  subSmooth += (target - subSmooth) * (1 - Math.exp(-dt * 8));
  if (Math.abs(subSmooth - target) < 0.002) subSmooth = target;
  if (subSmooth === 0) {
    scene.background.copy(envAir.background);
    scene.fog.color.copy(envAir.background);
    scene.fog.near = envAir.near;
    scene.fog.far = envAir.far;
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
