// MiniCraft static bootstrap: scene, input, main loop, world startup.
// No saves, no network — Play builds a fresh random world in the browser.
import * as THREE from "three";
import { generateOverworld } from "./src/world/overworld.js";
import {
  pos, vel, keys, setYaw, setPitch,
  spawnPlayer, updatePlayer, tickKnockback,
} from "./src/player/physics.js";
import * as player from "./src/player/physics.js";
import { flyOn, setFly, updateFly } from "./src/player/fly.js";
import { updateTarget, breakTarget, placeAtSelection, breakBlockAt, purgeFloatingLiquidsAround } from "./src/player/edit.js";
import { fireHookTarget, grappleBlockPick, cancelHook, severHook, updateHook, hookActive, tickHookFx } from "./src/player/hook.js";
import { initRope } from "./src/player/rope.js";
import { tickTNT, initTNTFx, resetTNTMemory, onExplode, onLiquidPurge, shakeSpecFor } from "./src/fx/tnt.js";
import { initFx, tickFx } from "./src/fx/particles.js";
import { initRenderer, rebuildAll, maybeStream, refreshBlocks, drainChunkQueue, setEyeMedium, UNLOAD_MARGIN } from "./src/render/mesher.js";
import { buildHotbar, select, selected, selectedId, initHotbarInput } from "./src/ui/hotbar.js";
import { initMenu, enterGame, started, isLocked } from "./src/ui/menu.js";
import { initHelp, openHelp, closeHelp, isHelpOpen } from "./src/ui/help.js";
import { toggleDebug, tickDebug } from "./src/ui/debug.js";
import { tickWaterFog, eyeMediumId } from "./src/render/waterfog.js";
import {
  initPortals, buildPortalDom, setPortalTravelHook, tickPortals,
  rebuildPortalBlocks, scanWorldPortals, clearPortalFills, notePortalEdits,
} from "./src/world/portals.js";
import { CHUNK, RENDER_DIST } from "./src/core/store.js";
import { EYE } from "./src/player/physics.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);
// Steady-state visibility, whatever the tuned range is: saved here so the
// closed-in load fog below always relaxes back to it.
const readyFog = { near: scene.fog.near, far: scene.fog.far };
// Air baseline for the dive murk: tracks the fog controller below, so the
// murk always relaxes back to current visibility instead of a stale range.
const envAir = { background: scene.background.clone(), near: readyFog.near, far: readyFog.far };
// Closed-in fog for the instant-load reveal: the world is already fully
// built behind it, so the reveal is pure fog expansion, never ghost clarify.
const LOAD_FOG_NEAR = 12;
const LOAD_FOG_FAR = 30;
// Reveal duration: the closed-in fog eases open over this long, no snapping.
const REVEAL_MS = 1200;
// The fog controller only ever tightens past the tuned range, never loosens.
// Margin between the fog far plane and the nearest evictable chunk slab.
const FOG_MARGIN = 10;
// Typical surface height: the controller measures altitude above this.
const FOG_GROUND_REF = 20;

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1500);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById("game").appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xfff5e0, 1.1);
sun.position.set(60, 90, 40);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x5a6a4a, 0.75));

initRenderer(scene);
initFx(scene);
initTNTFx(scene);
initRope(scene);
initPortals(scene);
buildPortalDom();
setPortalTravelHook(() => severHook());

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false })
);
highlight.visible = false;
highlight.renderOrder = 999;
scene.add(highlight);
const _hookDir = new THREE.Vector3();

// Mega-blast camera shake (master: trauma capped at 1.5, decays 1.4/s,
// rotational + positional jitter scaled by trauma^1.5). Three zones per
// kind shake spec: max inside the blast, linear decay to 2x range,
// exponential decay to 3x. Kinds without a spec don't shake.
let camTrauma = 0;
function addCamShake(a) { camTrauma = Math.min(1.5, camTrauma + a); }
onExplode((cx, cy, cz, radius, kindKey) => {
  const spec = shakeSpecFor(kindKey);
  if (!spec) return;
  const dx = camera.position.x - (cx + 0.5);
  const dy = camera.position.y - (cy + 0.5);
  const dz = camera.position.z - (cz + 0.5);
  const dc = Math.hypot(dx, dy, dz);
  if (dc > spec.range * radius) return;
  let amp;
  if (dc <= radius) amp = spec.max;
  else if (dc <= 2 * radius) amp = spec.max * (1 - (1 - spec.knee) * (dc - radius) / radius);
  else amp = spec.max * spec.knee * Math.exp(-3 * (dc - 2 * radius) / radius);
  addCamShake(amp);
});

// Blast-stranded floating liquids collapse back to air. Injected here
// because tnt.js must not import edit.js (edit.js already depends on it).
onLiquidPurge((touched) => purgeFloatingLiquidsAround(touched));

function updateCamera(dt = 0) {
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (camTrauma > 0) {
    camTrauma = Math.max(0, camTrauma - dt * 1.4);
    const sh = Math.pow(camTrauma, 1.5);
    const st = performance.now() / 1000;
    camera.rotation.x += Math.sin(st * 61.7) * 0.22 * sh;
    camera.rotation.y += Math.sin(st * 53.3 + 1.7) * 0.22 * sh;
    camera.rotation.z += Math.sin(st * 47.1 + 0.6) * 0.14 * sh;
    camera.position.x += Math.sin(st * 67.3 + 0.9) * 0.6 * sh;
    camera.position.y += Math.sin(st * 71.9) * 0.6 * sh;
    camera.position.z += Math.sin(st * 59.7 + 2.1) * 0.6 * sh;
  }
}

let worldReady = false;
let building = false;

// The level loads instantly behind the translucent menu: voxels generate,
// every chunk in range builds synchronously (a short freeze is accepted),
// and only then does closed-in fog expand to reveal the finished world.
// Play enters a solid world from the first frame — nothing ever pops in.
async function buildWorld() {
  if (building) return;
  building = true;
  severHook();
  resetTNTMemory();
  scene.fog.near = LOAD_FOG_NEAR;
  scene.fog.far = LOAD_FOG_FAR;
  await new Promise((r) => setTimeout(r, 30));
  try {
    generateOverworld(Math.floor(Math.random() * 100000));
    spawnPlayer();
    rebuildAll(pos.x, pos.z);
    drainChunkQueue(true);
    clearPortalFills();
    rebuildPortalBlocks();
    scanWorldPortals();
    buildHotbar();
    select(0);
    updateCamera();
    worldReady = true;
    // Expanding-fog reveal: ease from closed-in to the tuned range on a
    // smoothstep over REVEAL_MS, then hand off to the runtime controller.
    const revealStart = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - revealStart) / REVEAL_MS);
      const e = t * t * (3 - 2 * t);
      scene.fog.near = LOAD_FOG_NEAR + (readyFog.near - LOAD_FOG_NEAR) * e;
      scene.fog.far = LOAD_FOG_FAR + (readyFog.far - LOAD_FOG_FAR) * e;
      if (t >= 1) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
  } finally {
    building = false;
    scene.fog.near = readyFog.near;
    scene.fog.far = readyFog.far;
    envAir.near = readyFog.near;
    envAir.far = readyFog.far;
  }
}

// Runtime fog: a tightening-only guard so chunk loading and unloading stay
// hidden at any altitude or speed. Fog is spherical while chunk rings are
// cylindrical, so the far plane is capped by the 3D distance to the nearest
// evictable slab (minus margin); the clear bubble shrinks further with
// speed so fast flight never outruns the loader into clear view.
function updateStreamingFog() {
  const dh = Math.max(0, camera.position.y - FOG_GROUND_REF);
  const unloadHoriz = (RENDER_DIST + UNLOAD_MARGIN) * CHUNK;
  const limitFar = Math.sqrt(unloadHoriz * unloadHoriz + dh * dh) - FOG_MARGIN;
  const targetFar = Math.max(Math.min(readyFog.far, limitFar), LOAD_FOG_FAR);
  const ratio = readyFog.near / readyFog.far;
  const targetNear = Math.max(
    Math.min(targetFar * ratio * (1 - 0.2 * Math.min(1, vel.length() / 30)), targetFar - 1),
    LOAD_FOG_NEAR
  );
  const k = 0.12;
  scene.fog.near += (targetNear - scene.fog.near) * k;
  scene.fog.far += (targetFar - scene.fog.far) * k;
  envAir.near = targetNear;
  envAir.far = targetFar;
}

initMenu(renderer, async () => {
  enterGame(renderer);
}, async () => {
  await buildWorld();
  enterGame(renderer);
}, isHelpOpen, () => building);

// Pre-build the world behind the translucent menu; Play enters a finished
// world fading in through expanding fog.
buildWorld();

initHelp(() => {
  if (started && !isLocked()) requestLockNow();
});

function requestLockNow() {
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

initHotbarInput(() => false);

document.addEventListener("mousemove", (e) => {
  if (!isLocked()) return;
  setYaw(player.yaw - e.movementX * 0.0022);
  const p = player.pitch - e.movementY * 0.0022;
  setPitch(Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p)));
});

document.addEventListener("mousedown", (e) => {
  if (!isLocked() || isHelpOpen() || !started) return;
  if (e.button === 0) {
    const changed = placeAtSelection(selectedId());
    if (changed) refreshBlocks(changed);
  } else if (e.button === 2) {
    const bt = breakTarget(camera);
    if (bt) {
      const changed = breakBlockAt(bt.x, bt.y, bt.z);
      if (changed.length) refreshBlocks(changed);
    }
  } else if (e.button === 1) {
    camera.getWorldDirection(_hookDir);
    fireHookTarget(grappleBlockPick, camera.position, _hookDir);
  }
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 1 && hookActive()) cancelHook(true);
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (isHelpOpen()) {
    if (e.code === "Escape") closeHelp();
    return;
  }
  if (e.code === "KeyH" && !keys[e.code]) { openHelp(); e.preventDefault(); return; }
  if (e.code === "Equal" && !e.repeat) { toggleDebug(); return; }
  if (e.code === "KeyF" && !e.repeat && started && !isHelpOpen()) {
    if (!flyOn) {
      setFly(true);
      cancelHook(false);
    } else {
      setFly(false);
    }
    e.preventDefault();
    return;
  }
  keys[e.code] = true;
  keys[e.key] = true;
  if (e.code === "KeyK") select(selected - 1);
  if (e.code === "KeyL") select(selected + 1);
  if (["Space", "Slash", "Tab", "ArrowUp", "ArrowDown"].includes(e.code) || e.key === " ") e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  keys[e.code] = false;
  keys[e.key] = false;
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateCamera(dt);
  if (!worldReady || !started) {
    highlight.visible = false;
    if (worldReady && !building) updateStreamingFog();
    maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far);
    renderer.render(scene, camera);
    return;
  }
  tickFx(dt);
  tickDebug(dt);
  tickHookFx(dt);
  // Streaming fog first, so the loader sees the tightened range; dive murk
  // after (gated on building so it never fights the reveal), restoring the
  // tracked air baseline on resurface. The pocket veil gate rides along:
  // water-side white shows only for divers, the tinted veil only for
  // open-air eyes, flipping together with the murk.
  if (!building) updateStreamingFog();
  if (worldReady && !building) {
    tickWaterFog(scene, camera, dt, envAir);
    setEyeMedium(eyeMediumId(camera.position.x, camera.position.y, camera.position.z));
  }
  const simActive = isLocked() && !isHelpOpen();
  if (simActive) {
    // Knockback impulse decays every sim frame, whatever mode moves next;
    // the hook pull owns its frame and simply leaves it for afterwards.
    tickKnockback(dt);
    const hookOwnsFrame = hookActive() ? updateHook(dt) : false;
    if (!hookOwnsFrame) {
      if (flyOn) updateFly(dt);
      else updatePlayer(dt);
    }
    if (pos.y < -20) {
      vel.set(0, 0, 0);
      severHook();
      spawnPlayer();
    }
    tickTNT(dt, (touched) => { notePortalEdits(touched); refreshBlocks(touched); });
  }
  tickPortals(dt, simActive);
  if (isLocked() && !isHelpOpen()) {
    const hit = updateTarget(camera, selectedId());
    if (hit) {
      highlight.visible = true;
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      highlight.visible = false;
    }
  } else {
    highlight.visible = false;
  }
  maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far);
  renderer.render(scene, camera);
}

updateCamera();
requestAnimationFrame(loop);
