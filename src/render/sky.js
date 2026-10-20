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

// Sky-dome registry: a dimension opts in through its env preset
// (`dome: "<key>"`), and the dome is built lazily once, then follows the
// camera so its horizon never moves. New domes register a factory/tick pair;
// the sky tick never names a dimension.
export const SKY_DOMES = {
  nether: {
    create() {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(620, 32, 24),
        new THREE.MeshBasicMaterial({
          map: canvasDomeTexture(),
          side: THREE.BackSide,
          fog: false,
          depthWrite: false,
        })
      );
      const sun = new THREE.Mesh(
        new THREE.CircleGeometry(55, 28),
        new THREE.MeshBasicMaterial({
          color: 0xff8a2e, fog: false, depthWrite: false,
          transparent: true, opacity: 0.95,
        })
      );
      sun.position.set(0, 170, 500);
      dome.add(sun);
      dome.visible = false;
      return dome;
    },
    tick(dome, camera, dt) {
      dome.position.copy(camera.position);
      dome.rotation.y += dt * 0.01;
    },
  },
};

function canvasDomeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, "#0a1230");
  g.addColorStop(0.38, "#1a1c5c");
  g.addColorStop(0.58, "#3a2a92");
  g.addColorStop(0.72, "#5a3a80");
  g.addColorStop(0.84, "#b04a4a");
  g.addColorStop(0.92, "#ff7a3a");
  g.addColorStop(1.0, "#101a38");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.6})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 130, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const domeCache = new Map();
let activeDome = null;
function tickDome(scene, camera, key, dt) {
  if (activeDome && activeDome.key !== key) {
    activeDome.mesh.visible = false;
    activeDome = null;
  }
  if (!key) return;
  const spec = SKY_DOMES[key];
  if (!spec) return;
  let mesh = domeCache.get(key);
  if (!mesh) {
    mesh = spec.create();
    mesh.visible = false;
    domeCache.set(key, mesh);
    scene.add(mesh);
  }
  mesh.visible = true;
  spec.tick(mesh, camera, dt);
  activeDome = { key, mesh };
}

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
export function tickSky(scene, camera, sun, hemi, envAir, env = null, dt = 0) {
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
  tickDome(scene, camera, env?.dome ?? null, dt);
}
