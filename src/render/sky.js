// High-altitude sky: day blue fades to black past the clouds and stays
// black; stars fade in alongside. Reveal regions (the Moon and future far
// bodies) are faded separately by regions.js, driven from main.js once this
// has refreshed the background colour. Every factor is smoothstepped and
// clamped. Runs before the dive murk each frame and rewrites its air
// baseline, so murk keeps working against the current sky.
import * as THREE from "three";

const DAY_SKY = new THREE.Color(0x87ceeb);
const SPACE_SKY = new THREE.Color(0x05070f);
// Hand-picked dusk band: blue holds below, totally black above.
const SKY_START = 475;
const SKY_END = 495;
const STAR_COUNT = 520;

let stars = null;

const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

export function skyFactor(y) {
  return smooth((y - SKY_START) / (SKY_END - SKY_START));
}

export function initSky(scene) {
  if (stars) return;
  const arr = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = Math.random() * 2 - 1;
    const ph = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    arr[i * 3] = Math.cos(ph) * r * 820;
    arr[i * 3 + 1] = u * 820;
    arr[i * 3 + 2] = Math.sin(ph) * r * 820;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const m = new THREE.PointsMaterial({
    color: 0xffffff, size: 2.2, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  stars = new THREE.Points(g, m);
  stars.frustumCulled = false;
  stars.visible = false;
  scene.add(stars);
}

// Stars self-initialize on the first tick if boot skipped them.
// baseSky/baseSun/baseHemi override the day preset per dimension (TNT red);
// null keeps the overworld defaults. The black-above-the-clouds fade with
// its stars is an overworld property: dimensions with an explicit env opt
// out unless they set space (TNT red sky never goes black, no stars there).
const _base = new THREE.Color();
export function tickSky(scene, camera, sun, hemi, envAir, env = null) {
  const y = camera.position.y;
  const s = env == null || env.space === true ? skyFactor(y) : 0;
  if (env?.sky !== undefined) _base.setHex(env.sky);
  else _base.copy(DAY_SKY);
  scene.background.copy(_base).lerp(SPACE_SKY, s);
  scene.fog.color.copy(scene.background);
  envAir.background.copy(scene.background);
  const sunI = env?.sunI ?? 1.1, hemiI = env?.hemiI ?? 0.75;
  sun.color.setHex(env?.sun ?? 0xfff5e0);
  hemi.color.setHex(env?.hemiSky ?? 0xbfd4ff);
  sun.intensity = sunI * (1 - 0.55 * s);
  hemi.intensity = hemiI * (1 - 0.55 * s);
  initSky(scene);
  stars.material.opacity = s;
  stars.position.copy(camera.position);
  stars.visible = s > 0.01;
}
