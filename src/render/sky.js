// High-altitude sky: day blue fades to black past the clouds and stays
// black; stars fade in alongside; the Moon disc (rock + lakes) fades in
// over its approach band and is never visible below it. Every factor is
// smoothstepped and clamped. Runs before the dive murk each frame and
// rewrites its air baseline, so murk keeps working against the current sky.
import * as THREE from "three";
import { MOON_FADE_Y, MOON_FADE_END } from "../world/moon.js";

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

export function moonFactor(y) {
  return smooth((y - MOON_FADE_Y) / (MOON_FADE_END - MOON_FADE_Y));
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

// setMoonFade(m, skyColor) is injected by the caller (mesher owns the
// materials). The fade applies before any visual handling below, so a
// failure there can never leave the moon stuck visible; stars
// self-initialize on the first tick if boot skipped them.
export function tickSky(scene, camera, sun, hemi, envAir, setMoonFade) {
  const y = camera.position.y;
  const s = skyFactor(y);
  scene.background.copy(DAY_SKY).lerp(SPACE_SKY, s);
  scene.fog.color.copy(scene.background);
  envAir.background.copy(scene.background);
  sun.intensity = 1.1 * (1 - 0.55 * s);
  hemi.intensity = 0.75 * (1 - 0.55 * s);
  setMoonFade(moonFactor(y), scene.background);
  initSky(scene);
  stars.material.opacity = s;
  stars.position.copy(camera.position);
  stars.visible = s > 0.01;
}
