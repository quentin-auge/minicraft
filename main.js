// MiniCraft static bootstrap: scene, input, main loop, world startup.
// No saves, no network — Play builds a fresh random world in the browser.
import * as THREE from "three";
import { generateOverworld, getSeed } from "./src/world/overworld.js";
import {
  pos, vel, keys, setYaw, setPitch,
  spawnPlayer, updatePlayer, tickKnockback,
} from "./src/player/physics.js";
import * as player from "./src/player/physics.js";
import { flyOn, setFly, updateFly } from "./src/player/fly.js";
import { updateTarget, breakTarget, placeAtSelection, breakBlockAt, purgeFloatingLiquidsAround } from "./src/player/edit.js";
import { fireHookTarget, grappleBlockPick, cancelHook, severHook, updateHook, hookActive, tickHookFx } from "./src/player/hook.js";
import { initRope } from "./src/player/rope.js";
import { tickTNT, initTNTFx, resetTNTMemory, onExplode, onLiquidPurge, shakeSpecFor, bandFront, bandActive, drainBandRemesh, accumulateBandRefresh, megaImminent, megaCarveActive, megaFxActive, MEGA_BLAST_T, MEGA_BLAST_TIME_SCALE } from "./src/fx/tnt.js";
import { initFx, tickFx, tickDenseFx, denseFxActive, prewarmDenseFx, spawnDense, flushDense, noteDenseSpawn } from "./src/fx/particles.js";
import { initPrecip, tickSnow } from "./src/fx/precip.js";
import { MOON_MIN_Y, MOON_R, generateMoon, generateMoonUnderRows, markMoonBuilt, moonReady, moonChunkCenters } from "./src/world/moon.js";
import { WATER, FLOWER, GLOWSTONE, MOON_WATER, BLOCK_INFO } from "./src/core/blocks.js";
import { resetGlowstoneMemory } from "./src/world/glowstone.js";
import { resetFlowerMemory } from "./src/world/flowers.js";
import { initBlockLights, tickBlockLights, rebuildBlockLightIndexes, resetBlockLightMemory } from "./src/render/blocklights.js";
import { initRenderer, rebuildAll, maybeStream, refreshBlocks, setEyeMedium, setRegionFade, UNLOAD_MARGIN } from "./src/render/mesher.js";
import { applyRegions } from "./src/render/regions.js";
import { resetItems, select, selected, selectedId, initHotbarInput, setItem, getItems } from "./src/ui/hotbar.js";
import { initMenu, enterGame, started, isLocked } from "./src/ui/menu.js";
import { initHelp, openHelp, closeHelp, isHelpOpen } from "./src/ui/help.js";
import { toggleDebug, tickDebug } from "./src/ui/debug.js";
import { tickWaterFog, eyeMediumId } from "./src/render/waterfog.js";
import { initSky, tickSky } from "./src/render/sky.js";
import {
  initPortals, buildPortalDom, setPortalTravelHook, tickPortals,
  resetFrameSet, scanWorldPortals, clearPortalFills, notePortalEdits,
  notePortalFramesOnly,
} from "./src/world/portals.js";
import { villageFrames } from "./src/world/village.js";
import { CHUNK, RENDER_DIST, setBlock, getBlock } from "./src/core/store.js";
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
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a6a4a, 0.75);
scene.add(hemi);

initRenderer(scene);
initFx(scene);
initSky(scene);
initPrecip(scene);
initTNTFx(scene);
initBlockLights(scene);
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
// Blast line of sight: voxel march from the eye to the blast center, blocked
// by the first opaque cube. Cheap (≤ a few hundred Map gets) and evaluated
// once per detonation — overlays never glare through rock.
function hasBlastLoS(bx, by, bz) {
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  const dx = bx - ox, dy = by - oy, dz = bz - oz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1.5) return true;
  const steps = Math.min(512, Math.ceil(dist * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const bid = getBlock(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t));
    if (bid !== undefined && BLOCK_INFO[bid]?.opaque) return false;
  }
  return true;
}
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
  // Mega ignition punches the fullscreen flash; the sim branch decays it.
  // DPR dips immediately so the blast frame itself renders cheap.
  // Point-blank (camera inside the crater): full-screen fire, max shake,
  // FOV kick — you feel the furnace instead of watching it decay.
  // Outside the crater the overlays need line of sight: a blast behind a
  // hill shakes the camera but never glares through rock.
  if (kindKey === "mega" || kindKey === "ultra") {
    const bx = cx + 0.5, by = cy + 0.5, bz = cz + 0.5;
    const incx = bx - camera.position.x;
    const incy = by - camera.position.y;
    const incz = bz - camera.position.z;
    const inside = Math.hypot(incx, incy, incz) < radius;
    const seen = inside || hasBlastLoS(bx, by, bz);
    if (kindKey === "mega") {
      if (inside) {
        fireMegaOverlay(1.0, 1.0);
        addCamShake(1.5);
        fovKickV = 5;
        // Flames around the lens: a camera-centered dense burst (depth test
        // already off), so every look direction burns.
        const FIRE = [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]];
      spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R: 12, role: "fire", count: 3500, life: 0.9 * MEGA_BLAST_TIME_SCALE, palette: FIRE, speedMin: 2, speedMax: 10, up: 3, gravity: -4, size: 34, shape: "ball", occlude: false });
      spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R: 12, role: "ember", count: 1500, life: 0.7 * MEGA_BLAST_TIME_SCALE, color: [1, 0.95, 0.85], variance: [0, 0.04, 0.06], speedMin: 4, speedMax: 14, up: 5, gravity: -3, size: 26, shape: "ball", occlude: false });
      flushDense();
      noteDenseSpawn(1.2 * MEGA_BLAST_TIME_SCALE);
        // Furnace mode: fire around you for the blast's own lifetime, then out.
        furnace = { cx: cx + 0.5, cy: cy + 0.5, cz: cz + 0.5, R: radius, t: simTime, burps: [0.8 * MEGA_BLAST_TIME_SCALE, 1.6 * MEGA_BLAST_TIME_SCALE], nextWave: 0.25 * MEGA_BLAST_TIME_SCALE, nextSmoke: 1.2 * MEGA_BLAST_TIME_SCALE };
      } else if (seen) {
        fireMegaOverlay(0.45, 0.15);
      }
      lastMegaBlast = { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5, R: radius, t: simTime };
    } else if (seen) {
      // Ultra overlay is fixed. No point-blank furnace: its full-level
      // radius would latch fire everywhere. Band shake already sustains
      // through bandFront(), and band carve dips the resolution.
      fireMegaOverlay(0.9, 0.4);
    }
    fxDip = true;
    renderer.setPixelRatio(1);
  }
});
// Mega-ignition fullscreen overlays: warm radial flash + sustained wash,
// both decayed on sim-time (pause-safe). Compositor-cheap punch that never
// costs a particle.
let megaFlashV = 0, megaVeilV = 0;
let megaFlashEl = null, megaVeilEl = null;
// Master blast timeline (sim-time seconds from detonation): every mega
// explosion — inside or outside the crater, R=15 or a 20-mega pool — ends
// on this clock. Presence inside only changes intensity, never duration.
// Imported from tnt.js so particles, blast light, shake, and overlays all
// share the doubled post-detonation timeline.
const BLAST_T = MEGA_BLAST_T;
// Last mega blast (sim-time stamped): sustains max shake + FOV while the
// camera stays inside the crater. FOV kick decays back to 75 on sim-time.
let lastMegaBlast = null;
let fovKickV = 0;
const BASE_FOV = 75;
// Furnace mode: a point-blank mega keeps fire on you for BLAST_T only —
// ember waves + crater burps + veil floor while inside; leaving the crater
// stops it immediately.
let furnace = null;
function fireMegaOverlay(flash, veil) {
  if (!megaFlashEl) megaFlashEl = document.getElementById("blastFlash");
  if (!megaVeilEl) megaVeilEl = document.getElementById("fireVeil");
  megaFlashV = Math.max(megaFlashV, flash);
  megaVeilV = Math.max(megaVeilV, veil);
  if (megaFlashEl && flash > 0) {
    megaFlashEl.style.display = "block";
    megaFlashEl.style.opacity = String(megaFlashV);
  }
  if (megaVeilEl && veil > 0) {
    megaVeilEl.style.display = "block";
    megaVeilEl.style.opacity = String(megaVeilV);
  }
}

// DPR-dip latch for mega blasts: set synchronously in onExplode (above) so
// the blast frame itself renders cheap; cleared once no dense FX remains.
let fxDip = false;

// Blast-stranded floating liquids collapse back to air. Injected here
// because tnt.js must not import edit.js (edit.js already depends on it).
onLiquidPurge((touched) => purgeFloatingLiquidsAround(touched));

function updateCamera(dt = 0) {
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  // Pause contract: shake neither decays nor wobbles while paused (dt 0
  // skips the block entirely, freezing the frame instead of settling it).
  if (dt > 0) {
    // FOV kick: brief wide-angle souffle on point-blank ignition, eased
    // back to base on sim-time (pause freezes it mid-kick).
    if (fovKickV > 0) {
      fovKickV = Math.max(0, fovKickV - dt * (5 / 0.3));
      camera.fov = BASE_FOV + fovKickV;
      camera.updateProjectionMatrix();
    } else if (camera.fov !== BASE_FOV) {
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
  }
  if (dt > 0 && camTrauma > 0) {
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
// DPR-dip state for band wipes (false = full resolution).
let bandDpr = false;
// Moon-band hotbar (slots flip at the Moon's lower end); reset per world.
let moonBand = false;

// The level loads behind the translucent menu: voxels generate, the spawn
// neighborhood builds synchronously (a short freeze is accepted), then
// closed-in fog expands to reveal the world while far chunks keep streaming
// in under the frame budget — invisible behind the fog, and the clear-bubble
// guard builds anything entering visibility synchronously, so Play enters a
// solid world from the first frame and nothing ever pops in.
async function buildWorld() {
  if (building) return;
  building = true;
  severHook();
  resetTNTMemory();
  bandDpr = false;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  resetGlowstoneMemory();
  resetFlowerMemory();
  resetBlockLightMemory();
  scene.fog.near = LOAD_FOG_NEAR;
  scene.fog.far = LOAD_FOG_FAR;
  await new Promise((r) => setTimeout(r, 30));
  try {
    generateOverworld(Math.floor(Math.random() * 100000));
    spawnPlayer();
    // No glowstone rescan: worldgen places none and the live index starts
    // empty (player edits track themselves).
    rebuildBlockLightIndexes();
    rebuildAll(pos.x, pos.z);
    clearPortalFills();
    resetFrameSet(villageFrames);
    scanWorldPortals();
    moonBand = false;
    resetItems();
    select(0);
    updateCamera();
    // Dense-FX warmup behind the menu: pools enter the scene and their
    // shader programs compile on one hidden render, so the first mega of
    // the world never pays scene-add + compile + first upload mid-blast.
    prewarmDenseFx();
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    resetTNTMemory();
    worldReady = true;
    // Expanding-fog reveal: ease from closed-in to the tuned range on a
    // smoothstep over REVEAL_MS, then hand off to the runtime controller.
    // Far chunks stream in behind the fog under the frame budget meanwhile.
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
  if (worldReady) fillMoonUnder(getSeed());
}

// Lazy moon underside (startup perf): spawn stands on the eagerly-built
// surface, so the hollow shell below it fills after the reveal, sliced
// across idle frames, then built disc chunks remesh (streaming covers the
// rest: the fill completes before the refresh pass, so later builds include
// it). Aborts if a New World starts mid-fill; seed-tokened, and the
// overwrites are deterministic, so racing the safety net is harmless.
let moonFilling = false;
async function fillMoonUnder(seed) {
  if (moonFilling || moonReady(seed)) return;
  moonFilling = true;
  try {
    const R = MOON_R, STEP = 16;
    for (let x0 = -R; x0 <= R; x0 += STEP) {
      if (getSeed() !== seed || building || !worldReady || moonReady(seed)) return;
      generateMoonUnderRows(seed, setBlock, x0, x0 + STEP);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (getSeed() !== seed || building || !worldReady || moonReady(seed)) return;
    markMoonBuilt(seed);
    const centers = moonChunkCenters();
    for (let i = 0; i < centers.length; i += 2) {
      if (getSeed() !== seed || building || !worldReady) return;
      refreshBlocks(centers.slice(i, i + 2));
      await new Promise((r) => requestAnimationFrame(r));
    }
  } finally {
    moonFilling = false;
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
  if (e.code === "KeyG" && !e.repeat && started && !isHelpOpen() && isLocked()) {
    camera.getWorldDirection(_hookDir);
    fireHookTarget(grappleBlockPick, camera.position, _hookDir);
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
  if (e.code === "KeyG" && hookActive()) cancelHook(true);
  keys[e.code] = false;
  keys[e.key] = false;
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
// Pause contract: simTime advances only while the sim runs and drives every
// time-based visual (precip sway phase), so pausing freezes the frame.
let simTime = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Pause = pointer unlocked (menu) or help open: everything sim and visual
  // freezes; only the loader, the debug readout, and the final render run.
  const simActive = worldReady && started && !building && isLocked() && !isHelpOpen();
  updateCamera(simActive ? dt : 0);
  if (!worldReady || !started) {
    highlight.visible = false;
    if (worldReady && !building) updateStreamingFog();
    maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far);
    renderer.render(scene, camera);
    return;
  }
  tickDebug(dt, pos.x, pos.y, pos.z);
  if (simActive) {
    simTime += dt;
    tickFx(dt);
    tickDenseFx(dt);
    // Anticipated DPR dip: a lit mega within 0.6 s of detonation drops to
    // full-low before the blast frame, so the resize hitch never stacks on
    // top of carve + seeding + uploads.
    if (!fxDip && megaImminent()) {
      fxDip = true;
      renderer.setPixelRatio(1);
    }
    tickSnow(dt, simTime, camera);
    tickBlockLights(dt, camera);
    tickHookFx(dt);
    // Streaming fog first, so the loader sees the tightened range; dive murk
    // after (gated on building so it never fights the reveal), restoring the
    // tracked air baseline on resurface. The pocket veil gate rides along:
    // water-side white shows only for divers, the tinted veil only for
    // open-air eyes, flipping together with the murk.
    updateStreamingFog();
    tickSky(scene, camera, sun, hemi, envAir);
    applyRegions(camera.position, scene.background, setRegionFade);
    // One eye-medium lookup per frame, shared by the murk and the veil gate
    // (it used to run twice, with a bounded air flood each time in pockets).
    const medium = eyeMediumId(camera.position.x, camera.position.y, camera.position.z);
    tickWaterFog(scene, camera, dt, envAir, medium);
    setEyeMedium(medium);
    // Moon-band hotbar: 8 below the Moon's lower end the water slot becomes
    // moon water and the flower slot becomes glowstone; both restore on descent.
    const moonNow = pos.y >= MOON_MIN_Y - 8;
    if (moonNow !== moonBand) {
      moonBand = moonNow;
      if (moonNow) {
        const wi = getItems().indexOf(WATER);
        if (wi >= 0) setItem(wi, MOON_WATER);
        const fi = getItems().indexOf(FLOWER);
        if (fi >= 0) setItem(fi, GLOWSTONE);
      } else {
        const mi = getItems().indexOf(MOON_WATER);
        if (mi >= 0) setItem(mi, WATER);
        const gi = getItems().indexOf(GLOWSTONE);
        if (gi >= 0) setItem(gi, FLOWER);
      }
    }
    // Underside safety net: below the moon band the shell must exist now, so
    // descending onto (or under) a fresh moon never meets unbuilt rock.
    // Synchronous and rare (the background fill wins by ~30 s of descent).
    if (!moonReady(getSeed()) && camera.position.y < MOON_MIN_Y - 8) {
      generateMoon(getSeed(), setBlock);
      refreshBlocks(moonChunkCenters());
    }
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
    // While a band carves, blast refresh splits: portal frames track only
    // (fills heal from the dirty flag), chunk keys queue for the budgeted
    // remesh drain below — never a synchronous rebuild avalanche.
    tickTNT(dt, (touched) => {
      if (bandActive()) {
        notePortalFramesOnly(touched);
        accumulateBandRefresh(touched);
      } else {
        notePortalEdits(touched);
        refreshBlocks(touched);
      }
    });
    drainBandRemesh(pos.x, pos.z);
    // GPU relief while a wipe, dense mega, or sliced carve runs (master's
    // quality-tier dip): full resolution restores the frame the queues
    // empty. fxDip latches early (imminent fuse) or in onExplode so the
    // blast frame itself already renders cheap.
    const denseNow = denseFxActive() || megaFxActive() || megaCarveActive();
    const bandNow = fxDip || bandActive() || denseNow;
    if (!bandActive() && !denseNow) fxDip = false;
    if (bandNow !== bandDpr) {
      bandDpr = bandNow;
      renderer.setPixelRatio(bandNow ? 1 : Math.min(devicePixelRatio, 2));
    }
    // Mega overlay decay on sim-time (pause freezes the glare mid-fade).
    if (megaFlashV > 0 || megaVeilV > 0) {
      megaFlashV = Math.max(0, megaFlashV - dt / (0.9 * MEGA_BLAST_TIME_SCALE));
      megaVeilV = Math.max(0, megaVeilV - dt / BLAST_T);
      if (megaFlashEl) {
        megaFlashEl.style.opacity = String(megaFlashV);
        if (megaFlashV <= 0) megaFlashEl.style.display = "none";
      }
      if (megaVeilEl) {
        megaVeilEl.style.opacity = String(megaVeilV);
        if (megaVeilV <= 0) megaVeilEl.style.display = "none";
      }
    }
    // Ultra bands re-top the shake while the camera sits inside the
    // advancing front (decays naturally once outside); pause-safe, dt-driven.
    const bf = bandFront();
    if (bf) {
      const bdx = camera.position.x - bf.x, bdy = camera.position.y - bf.y, bdz = camera.position.z - bf.z;
      if (bdx * bdx + bdy * bdy + bdz * bdz < bf.r * bf.r) addCamShake(dt * 2);
    }
    // Ground-zero sustain: while the camera stays inside the last mega
    // crater (BLAST_T window), trauma re-tops to the cap every frame instead
    // of decaying — the furnace keeps shaking at full blast under you.
    if (lastMegaBlast && simTime - lastMegaBlast.t < BLAST_T) {
      const mdx = camera.position.x - lastMegaBlast.x;
      const mdy = camera.position.y - lastMegaBlast.y;
      const mdz = camera.position.z - lastMegaBlast.z;
      if (mdx * mdx + mdy * mdy + mdz * mdz < lastMegaBlast.R * lastMegaBlast.R) addCamShake(dt * 3);
    } else if (lastMegaBlast) {
      lastMegaBlast = null;
    }
    // Furnace tick: 5 s of fire around the lens after a point-blank mega.
    // Veil floor while inside; ember waves + crater burps follow you ~1.5 s
    // Furnace: fire follows you, but only for the blast's own lifetime
    // (BLAST_T — never longer) and only while you're inside the crater —
    // the moment you leave, it stops. Intensity differs inside/outside,
    // the timeline never does. All on sim-time (pause-safe).
    if (furnace) {
      const age = simTime - furnace.t;
      const fdx = camera.position.x - furnace.cx;
      const fdy = camera.position.y - furnace.cy;
      const fdz = camera.position.z - furnace.cz;
      const fin = fdx * fdx + fdy * fdy + fdz * fdz < furnace.R * furnace.R;
      if (age > BLAST_T) {
        furnace = null;
      } else {
        if (fin) {
          // Degressive floor: same 2.2 s end as outside, brighter while in.
          megaVeilV = Math.max(megaVeilV, 0.85 * (1 - age / BLAST_T));
          addCamShake(dt * 3);
        }
        if (fin) {
          if (age >= furnace.nextWave) {
            furnace.nextWave = age + 0.25 * MEGA_BLAST_TIME_SCALE;
            const F2 = [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]];
            spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R: 12, role: "fire", count: 2200, life: 0.8 * MEGA_BLAST_TIME_SCALE, palette: F2, speedMin: 2, speedMax: 9, up: 3, gravity: -4, size: 32, shape: "ball", occlude: false });
            spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R: 12, role: "ember", count: 1200, life: 0.7 * MEGA_BLAST_TIME_SCALE, color: [1, 0.9, 0.75], variance: [0, 0.05, 0.06], speedMin: 4, speedMax: 12, up: 5, gravity: -3, size: 24, shape: "ball", occlude: false });
            flushDense();
            noteDenseSpawn(1.0 * MEGA_BLAST_TIME_SCALE);
          }
          if (age >= furnace.nextSmoke) {
            furnace.nextSmoke = age + 1.2 * MEGA_BLAST_TIME_SCALE;
            spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R: 14, role: "smoke", count: 1500, life: 1.8 * MEGA_BLAST_TIME_SCALE, color: [0.25, 0.2, 0.17], variance: [0.08, 0.08, 0.08], speedMin: 1, speedMax: 5, up: 8, gravity: -3, size: 46, shape: "ball", occlude: false });
            flushDense();
            noteDenseSpawn(2.0 * MEGA_BLAST_TIME_SCALE);
          }
        }
        while (furnace.burps.length && age >= furnace.burps[0]) {
          furnace.burps.shift();
          spawnDense({ x: furnace.cx, y: furnace.cy, z: furnace.cz, R: furnace.R * 0.4, role: "fire", count: 2200, life: 1.1 * MEGA_BLAST_TIME_SCALE, palette: [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]], speedMin: 3, speedMax: 11, up: 10, gravity: -5, size: 30, shape: "ball" });
          flushDense();
          noteDenseSpawn(1.3 * MEGA_BLAST_TIME_SCALE);
        }
      }
    }
    tickPortals(dt, true);
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
