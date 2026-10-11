// Eye-in-liquid murk: while the camera sits inside a liquid cell — or inside
// air pocketed by liquid — fog and background lerp from the air baseline
// toward that liquid's tint. Gentle
// on purpose — heading and nearby geometry stay readable. The surfaces
// themselves are flat unlit sheets with no depth cue, so this tick is
// the only murk. Tints parallel LIQUID_SURFACE in textures.js without
// importing it (render-side tuning lives here).
import * as THREE from "three";
import { AIR, WATER, isLiquid } from "../core/blocks.js";
import { getBlock, isEyePocketed } from "../core/store.js";

const LIQUID_FOG = {
  [WATER]: { tint: 0x0d3b7a, near: 2, far: 30 },
};
const TINT_MIX = 0.55;
// Pocket tier: murk stacked over dive murk, as if deeper — tighter range,
// stronger tint, same progressive fade. Derived from the hemming liquid's
// spec so future liquids inherit it without forks.
const POCKET_TINT_MIX = 0.75;

const _tint = new THREE.Color();
let subSmooth = 0;

// Eye medium for pocket-veil gating (mesher.js `setEyeMedium`) and dive
// murk: liquid (with id), air pocketed by liquid (with the hemming liquid's
// id, so pockets murk exactly like divers — small bubbles and big sealed
// halls alike — or open air. The enclosed test rides the colTop fast path,
// so open sky resolves in O(1) per frame. A pocket eye reads its liquid
// from its direct neighbors first (exact near walls); deeper inside, where
// no liquid touches the eye cell, it reuses the last liquid seen: a sealed
// pocket is only reachable through its liquid, so the tint transits with
// the diver (a pocket beside mixed liquids murks with the first liquid
// neighbor found: up, down, ±x, ±z).
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

export function tickWaterFog(scene, camera, dt, envAir) {
  const m = eyeMediumId(camera.position.x, camera.position.y, camera.position.z);
  const pocket = m.type === "pocket";
  const target = (m.type === "liquid" || pocket) ? 1 : 0;
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
  scene.background.copy(envAir.background).lerp(_tint, k * (pocket ? POCKET_TINT_MIX : TINT_MIX));
  scene.fog.color.copy(scene.background);
  const murkNear = pocket ? Math.max(1, spec.near / 2) : spec.near;
  const murkFar = pocket ? spec.far / 2 : spec.far;
  scene.fog.near = envAir.near + (murkNear - envAir.near) * k;
  scene.fog.far = envAir.far + (murkFar - envAir.far) * k;
}
