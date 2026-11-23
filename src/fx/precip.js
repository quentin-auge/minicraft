// Falling-precipitation backend: camera-following Points fields integrated
// every step (60 Hz snow — motion stays smooth under a moving camera).
// Drops fill the column above the camera, wrap around it in XZ so flight
// never leaves them behind, and vanish on landing before respawning
// at the top. Sway reads a precomputed sine table and landing heights are
// cached per drop (one typed-array read, refreshed staggered plus on wrap)
// with a single getBlock confirm only near the ground, instead of trig plus
// a Map lookup per drop per frame. Visibility is 100% flake world-position
// in the shader (radial + height fades, zero CPU cost) times a temporal
// field level (fast uniform fade-out on leave, progressive fade-in on
// return); past the off bounds the engine skips integration and the draw
// call entirely.
//
// Extension shape: PRECIP_TYPES is the registry; the engine below never
// branches on kind names. Snow registers first with master's numbers;
// rain later is one entry (faster fall, no sway, own active/groundY).
import * as THREE from "three";
import { AIR } from "../core/blocks.js";
import { getBlock, topAt, dim } from "../core/store.js";
import { dimHasMoon } from "../world/dimensions.js";
import { MOON_SURFACE_Y, isMoonGone } from "../world/moon.js";
import { MOON_SPEC } from "../world/planets.js";
import {
  SNOW_COUNT, SNOW_RANGE, SNOW_SIZE, SNOW_OPACITY, SNOW_FADE_R0, SNOW_FADE_RW,
  SNOW_SLAB_BELOW, SNOW_TOP_LO, SNOW_TOP_HI, SNOW_FULL_HI, SNOW_FADE_TOP,
  SNOW_OFF_Y, SNOW_OFF_R, SNOW_FLOOR_BELOW,
  snowAltitudeFade, snowFieldTarget, smoothShown,
  moonGroundY, spawnSnowDrop, stepSnowDrops,
} from "./snowfade.js";

const PRECIP_DEFAULTS = {
  count: 700,
  range: 36,
  size: 0.18,
  step: 1 / 30,
  color: 0xffffff,
  opacity: 0.9,
  fallMin: 2.5,
  fallMax: 5.5,
  drift: 0.5,
  sway: 0.5,
};

export const PRECIP_TYPES = [
  {
    key: "snow",
    ...PRECIP_DEFAULTS,
    count: SNOW_COUNT,
    range: SNOW_RANGE,
    size: SNOW_SIZE,
    opacity: SNOW_OPACITY,
    step: 1 / 60,
    slabBelow: SNOW_SLAB_BELOW,
    topMin: SNOW_TOP_LO,
    topMax: SNOW_TOP_HI,
    // Snow falls anywhere above moon-surface altitude, in moon dimensions
    // holding a surviving moon: once no MOON/MOON_WATER block remains the
    // field retires instead of snowing over an empty sky.
    active: (e) => dimHasMoon(dim) && !isMoonGone() && e.y >= MOON_SURFACE_Y - 8,
    // Drops land on the highest surface or the moon band, whichever is up —
    // and sink through open shafts down to 50 below the surface, never
    // into rock (moonGroundY resolves rock tops first).
    groundY: (bx, bz) => moonGroundY(topAt(dim, bx, bz)),
    // Initial fill spans the moon band down through the open floor up to
    // the spawn top, so the first frame already shows the full column.
    seedY: (top) => Math.min(top, (MOON_SURFACE_Y - SNOW_FLOOR_BELOW) + Math.random() * Math.max(1, top - (MOON_SURFACE_Y - SNOW_FLOOR_BELOW))),
    // Below the moon band a drop only lands on a real block.
    landed: (x, y, z, landY) => y <= landY + 2 &&
      (y <= MOON_SURFACE_Y || getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== AIR),
    // Surface weather, dense low and thinning with height: the shader
    // fades every drop by its own world position (full below +50 and
    // inside rim + 25, gone past +100 / rim + 50), so the whole field
    // thins as the camera leaves the layer — moon-to-planet corridor and
    // planets keep a clean sky with zero CPU fade work.
  },
];

const specByKey = new Map(PRECIP_TYPES.map((s) => [s.key, s]));
const states = new Map();
let sceneRef = null;
let rendererRef = null;

// Snow shader: one draw call, visibility 100% flake world-position (radial
// fade + height fade), perspective size in world units with a pixel floor,
// square flakes.
const SNOW_VERT = `
uniform float uOpacity;
uniform float uSize;
uniform float uHeightPx;
uniform float uMinPx;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uFadeWidth;
uniform float uFullHi;
uniform float uFadeTop;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float r = distance(position.xz, uCenter);
  float h = 1.0 - smoothstep(uFullHi, uFadeTop, position.y);
  vAlpha = uOpacity * (1.0 - smoothstep(uRadius, uRadius + uFadeWidth, r)) * h;
  float proj = projectionMatrix[1][1];
  // World-size flakes with a pixel floor: distant drops stay a readable
  // grain instead of winking out sub-pixel over the whole disc.
  gl_PointSize = max(uSize * (uHeightPx * 0.5 * proj) / max(0.1, -mv.z), uMinPx);
}
`;
const SNOW_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  // Square flakes (Minecraft): no round sprite mask, uniform alpha.
  if (vAlpha <= 0.003) discard;
  gl_FragColor = vec4(uColor, vAlpha);
}
`;

export function initPrecip(scene, renderer = null) {
  sceneRef = scene;
  rendererRef = renderer;
}

function spawnDrop(spec, st, i, e, initial = false) {
  spawnSnowDrop(spec, st.pts.geometry.attributes.position.array, st.vel, st.ground,
    i, e.x, e.y, e.z, initial);
}

function ensureState(spec) {
  let st = states.get(spec.key);
  if (st) return st;
  const posA = new Float32Array(spec.count * 3);
  for (let i = 0; i < spec.count; i++) {
    posA[i * 3] = 0; posA[i * 3 + 1] = -100; posA[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posA, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setDrawRange(0, spec.count);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(spec.color) },
      uOpacity: { value: spec.opacity },
      uSize: { value: spec.size },
      uHeightPx: { value: 800 },
      // Fixed pixel floor: distant drops stay a readable grain instead of
      // winking out sub-pixel over the whole disc.
      uMinPx: { value: 1.2 },
      uCenter: { value: new THREE.Vector2(MOON_SPEC.cx, MOON_SPEC.cz) },
      uRadius: { value: SNOW_FADE_R0 },
      uFadeWidth: { value: SNOW_FADE_RW },
      uFullHi: { value: SNOW_FULL_HI },
      uFadeTop: { value: SNOW_FADE_TOP },
    },
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  sceneRef.add(pts);
  st = {
    pts,
    vel: new Float32Array(spec.count * 3),
    ground: new Float32Array(spec.count),
    acc: 0,
    tick: 0,
    fresh: true,
    shown: 1,
  };
  states.set(spec.key, st);
  return st;
}

function removeState(spec) {
  const st = states.get(spec.key);
  if (!st) return;
  sceneRef.remove(st.pts);
  st.pts.geometry.dispose();
  st.pts.material.dispose();
  states.delete(spec.key);
}

export function tickPrecip(key, dt, time, camera) {
  const spec = specByKey.get(key);
  if (!spec) return;
  if (!spec.active(camera.position)) { removeState(spec); return; }
  const st = ensureState(spec);
  const e = camera.position;
  const camR = Math.hypot(e.x - MOON_SPEC.cx, e.z - MOON_SPEC.cz);
  // Entry ramp off the gate (no pop-in), then the temporal field level
  // follows the camera inside the fade volume: fast out when leaving (one
  // uniform fade), progressive in when returning (no pop). Per-flake
  // spatial fades in the shader handle the rest. Past the off bounds no
  // flake in the camera slab can stay visible: skip the draw call AND the
  // integration entirely (distant planet visits cost nothing).
  const entry = snowAltitudeFade(e.y);
  const target = snowFieldTarget(e.y, camR);
  st.shown = smoothShown(st.shown, target, dt);
  const off = e.y > SNOW_OFF_Y || camR > SNOW_OFF_R;
  const uniforms = st.pts.material.uniforms;
  uniforms.uOpacity.value = spec.opacity * entry * st.shown;
  if (rendererRef) uniforms.uHeightPx.value = rendererRef.domElement.height || 800;
  st.pts.visible = entry > 0 && st.shown > 0 && !off;
  if (!st.pts.visible) return;
  if (st.fresh) {
    st.fresh = false;
    for (let i = 0; i < spec.count; i++) spawnDrop(spec, st, i, camera.position, true);
    // The accumulator below may never reach a step (frozen menu frame):
    // the fresh spawn still has to reach the GPU once.
    st.pts.geometry.attributes.position.needsUpdate = true;
  }
  st.acc += dt;
  if (st.acc < spec.step) return;
  const dtStep = st.acc;
  st.acc = 0;
  const tick = ++st.tick;
  const attr = st.pts.geometry.attributes.position;
  // Full-field 60 Hz integration: every drop moves every flushed step, so
  // motion stays smooth under a moving camera (no 15 Hz strobing).
  stepSnowDrops(spec, attr.array, st.vel, st.ground, spec.count, tick,
    e.x, e.y, e.z, time, dtStep);
  attr.needsUpdate = true;
}

export function tickSnow(dt, time, camera) {
  tickPrecip("snow", dt, time, camera);
}
