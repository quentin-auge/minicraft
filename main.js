// MiniCraft static bootstrap: scene, input, main loop, world startup.
// No saves, no network — Play builds a fresh random world in the browser.
import * as THREE from "three";
import { generateOverworldAsync, getSeed } from "./src/world/overworld.js";
import { tickTntStream, TNT_CELL, TNT_SKY_GRAPPLE_MAX } from "./src/world/tntstream.js";

// Hook-anchor pin for streaming eviction: the latched cloud never evicts
// mid-pull, so a sky-grapple landing survives the trip over.
function hookPin() {
  const a = hookAnchor();
  if (!a) return null;
  return {
    ix: Math.floor(a.x / TNT_CELL),
    iy: Math.floor(a.y / TNT_CELL),
    iz: Math.floor(a.z / TNT_CELL),
  };
}
import {
  pos, vel, keys, setYaw, setPitch,
  spawnPlayer, updatePlayer, tickKnockback,
} from "./src/player/physics.js";
import * as player from "./src/player/physics.js";
import { flyOn, setFly, setFlyMul, updateFly } from "./src/player/fly.js";
import { updateTarget, breakTarget, placeAtSelection, breakBlockAt, pickBlock, pickCelestialBody, tryPlace, currentBlock, flushChainBatch, purgeFloatingLiquidsAround, takeLiquidCells, endChainStroke, clearChainStroke } from "./src/player/edit.js";
import { fireHookTarget, fireSkyHook, grapplePick, mobGrabTarget, mobReleaseTarget, cancelHook, severHook, updateHook, hookActive, hookFillActive, hookHeldSwim, hookAnchor, tickHookFx, setMobAlpha, HELD_ALPHA } from "./src/player/hook.js";
import { initRope } from "./src/player/rope.js";
import { tickTNT, initTNTFx, resetTNTMemory, clearRegularTntDim, onExplode, onMegaPool, onCrater, onLiquidPurge, shakeSpecFor, bandActive, drainBlastRemesh, queueBlastRefresh, megaImminent, megaCarveActive, megaFxActive, MEGA_BLAST_T, MEGA_BLAST_TIME_SCALE, ultraFxSpec, useBodyTnt } from "./src/fx/tnt.js";
import { initFx, tickFx, tickDenseFx, denseFxActive, prewarmDenseFx, prewarmBursts, spawnDense, flushDense, noteDenseSpawn } from "./src/fx/particles.js";
import { initPrecip, tickSnow } from "./src/fx/precip.js";
import { MOON_MIN_Y, MOON_SURFACE_Y, MOON_R, generateMoon, generateMoonUnderRows, restoreBodyLakeWells, joinMoonLakeWater, markMoonBuilt, moonReady, moonChunkCenters, generateBody, generateBodySurface, generateBodySurfaceRows, generateBodyUnderRows, joinBodyLakeWaterStart, joinBodyLakeWaterSlice, bodyChunkCenters, bodyChunkKeys, findMoonSpawn, takeBodyFill, purgeUnsupportedKeeps, skyConverged } from "./src/world/moon.js";
import {
  bodySpecs, bodyReady, markBodyBuilt, moonSpec, nextBodyToStream,
  voronoiBodyAt, CELESTIAL_WATERS, CELESTIAL_STREAM_Y,
  rayBodyHit, bodyMeshWant, celestialRevealFactor, FOG_FAR,
} from "./src/world/planets.js";
import { tickLod, resetLod, prewarmProxies } from "./src/render/lod.js";
import { findPenOverwatch } from "./src/world/spawn.js";
import { AIR, WATER, FLOWER, GLOWSTONE, MOON_WATER, PLANET_WATERS, LAVA, TNT, BLOCK_INFO, shouldShowHighlight } from "./src/core/blocks.js";
import { resetGlowstoneMemory, clearGlowstoneDim, setGlowSeed } from "./src/world/glowstone.js";
import { resetFlowerMemory, clearFlowerDim, setFlowerSeed } from "./src/world/flowers.js";
import { tickReactions, resetReactionMemory, clearReactionsDim } from "./src/world/reactions.js";
import { initReactionFx, tickReactionFx, clearReactionFx } from "./src/render/reactions.js";
import { initPoolLights, tickPoolLights, resetPoolLightMemory, notePoolEdit } from "./src/render/poollights.js";
import { initRenderer, rebuildAll, maybeStream, streamChunks, drainChunkQueue, drainCelestial, isChunkMeshed, beginDispose, disposeSome, refreshBlocks, queueRefreshBlocks, queueRefreshKeys, queueCelestialChunks, refreshBuiltQueueCelestial, takeSuspendedBuilt, setRegionFade, setRegionLiquidFog, setSkyFree, nearestMissingDist, tickChunkFades, pinChunks, isChunkBuilt, chunkVersion, UNLOAD_MARGIN, FADE_CHUNKS, FADE_CHUNKS_FAST, celestialPendingSize, hasPendingChunks, CELESTIAL_DRAIN_MAX } from "./src/render/mesher.js";
import { setHaloSuspended } from "./src/render/halobake.js";
import { initChainProxy, proxyNote, proxyCull, proxyClear } from "./src/render/chainproxy.js";
import { applyRegions } from "./src/render/regions.js";
import { resetItems, select, selected, selectedId, initHotbarInput, setItem, getItems } from "./src/ui/hotbar.js";
import { initMenu, enterGame, started, isLocked } from "./src/ui/menu.js";
import { initHelp, openHelp } from "./src/ui/help.js";
import { toggleDebug, tickDebug } from "./src/ui/debug.js";
import { setLiquidFogOverride } from "./src/core/textures.js";
import { tickWaterFog, eyeMediumId } from "./src/render/waterfog.js";
import { initSky, tickSky } from "./src/render/sky.js";
import { initAmbient, tickAmbient, exitAmbient } from "./src/fx/ambient.js";
import { resetNetherDimension } from "./src/world/nether.js";
import {
  initPortals, buildPortalDom, setPortalTravelHook, tickPortals,
  resetFrameSet, scanWorldPortals, clearPortalFills, notePortalEdits,
  notePortalFramesOnly, tickPortalFillFades, completeDimTravel,
  resolveTravelArrival, resetTravelLinks, isLivePortalSill, toast,
  TRAVEL_MIN_MS, debugTravelTo,
} from "./src/world/portals.js";
import { villageFrames } from "./src/world/village.js";
import {
  createChainState, chainPressLeft, chainPressRight, chainReleaseLeft,
  chainReleaseRight, chainResetOnUnlock, chainNoteMouseMove, chainSavePaintRay,
  chainSaveDigRay, chainAnchorPush, chainNotePressPlace, chainHoldActive, chainBridgeActive, tickChain,
} from "./src/player/chain.js";
const chain = createChainState();
// Still-hold light suspension: while the left button drives bridge stairs the
// glowstone halo bake is suspended (dense placements rebuild geometry-only
// chunks) and pool-light resyncs pause; moving paint/dig strokes keep full
// lights. On bridge release the touched union plus every chunk built under
// suspension re-queue through the budgeted drain and the tint bakes then.
// Blast/countdown lights are untouched (owned by fx/tnt.js).
const GLOW_SUSPENDED = new Set(["glowstone"]);
let wasBridgeHeld = false;
let wasChainHeld = false;
const bridgeTouchedUnion = [];
import { CHUNK, renderDist, dim, setDimension, setBlock, getBlock, isSolid, outOfWorld, skyFreeY, worlds, chunkOf, noteFrameBudget } from "./src/core/store.js";
import { dimEnv, dimSpec, dimHasMoon, dimHotbar } from "./src/world/dimensions.js";
import { EYE, setFlyStepAllow, updateFreeSwim } from "./src/player/physics.js";
import { setExtraSolid } from "./src/player/physics.js";
import {
  isSprint, isConfirmCode, isFlyCode, isGrappleCode, isGrappleButton,
  isHelpCode, isSpawnPickerCode, isTargetDebugCode, isWorldCycleCode, isSpeedCycleCode,
  isHotbarPrevCode, isHotbarNextCode, isDebugCode,
} from "./src/player/keys.js";
import { setMobExtraSolid } from "./src/mobs/step.js";
import {
  initRocket, resetRocket, tickRocket, rocketTakesOver,
  rocketEditingBlocked, rocketSolidAt, rocketFlying, rocketBoostInfo, rocketClampEye, carryRiders,
} from "./src/vehicles/rocket.js";
import { initHomingTnt, fireHomingTnt, tickHomingTnt, clearHomingTnt } from "./src/mobs/homing.js";
import { enterEndMobs, clearEndMobs, clearEndermenDim, tickEndMobs, notifyEndermanVoxelChange, teleportBlastEndermen, dragonHealth, setDragonVictoryHook, setMobSeed } from "./src/mobs/end.js";
import { enterFarmMobs, clearFarmMobs, listFarmMobs, tickFarmMobs, handleFarmTravel, setFarmSeed } from "./src/mobs/farm.js";
import { launchMobBlast } from "./src/mobs/mover.js";
import { computeMegaLaunch } from "./src/core/launch.js";
import { spawnCatalog, spawnMobAt, spawnSelection, nextSpawnKey } from "./src/mobs/spawn.js";
import { mobLabel, mobType, allMobs } from "./src/mobs/registry.js";
import { openMobMenu, initMobMenu } from "./src/ui/mobmenu.js";
import { anyModalOpen, anyMenuOpen, anyPanelOpen, routeMenuKey, routeMenuKeyUp } from "./src/ui/menus.js";
import {
  initTargetDebug, targetDebugKeyDown, targetDebugKeyUp, tickTargetDebug, resetTargetDebug,
} from "./src/mobs/targets-debug.js";
import { heldMob, tickHeld, severCarry, isCarried, mobReleaseSpot, releasePeerFree, settleReleased } from "./src/mobs/carry.js";
import { endPortalFrameKeys, resetEndDimension, setEndCleared } from "./src/world/end.js";
import { resetTntUnlocks } from "./src/world/tntunlock.js";
import { isCheat } from "./src/core/cheat.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
// Fog far = FOG_FAR (planets.js): the single source the reveal chain is
// anchored on (clouds vanish behind the fog at cloud top + this).
scene.fog = new THREE.Fog(0x87ceeb, 60, FOG_FAR);
// Steady-state visibility, whatever the tuned range is: saved here so the
// closed-in load fog below always relaxes back to it.
const readyFog = { near: scene.fog.near, far: scene.fog.far };
// Air baseline for the dive murk: tracks the fog controller below, so the
// murk always relaxes back to current visibility instead of a stale range.
const envAir = { background: scene.background.clone(), near: readyFog.near, far: readyFog.far };
// Closed-in fog for the sliced-load reveal: far chunks still stream in
// behind it, so the reveal only opens over geometry that already exists
// (see tickReveal) — never ghost clarify, never visible pop-in.
const LOAD_FOG_NEAR = 8;
const LOAD_FOG_FAR = 20;
// Reveal duration: the closed-in fog eases open over this long, no snapping.
const REVEAL_MS = 1200;
// The fog controller only ever tightens past the tuned range, never loosens.
// Margin between the fog far plane and the nearest evictable chunk slab.
const FOG_MARGIN = 10;
// Typical surface height: the controller measures altitude above this.
const FOG_GROUND_REF = 20;

// Far plane past the farthest planets (100k range): nearby depth precision
// is set by near=0.1 and barely moves, while the whole space stays unclipped.
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300000);
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
initChainProxy(scene);
initFx(scene);
initReactionFx(scene);
initSky(scene);
initPrecip(scene);
initTNTFx(scene);
initHomingTnt(scene);
initPoolLights(scene);
initAmbient(scene);
initRope(scene);
initPortals(scene);
initRocket(scene, addCamShake);
setExtraSolid(rocketSolidAt);
setMobExtraSolid(rocketSolidAt);
buildPortalDom();
// Fly steps up only onto bottom frames of portals with a live fill.
setFlyStepAllow((bx, by, bz) => isLivePortalSill(bx, by, bz));
setPortalTravelHook((plan) => {
  if (!plan?.dim) { completeDimTravel(); return; }
  void runTravel(plan.dim, plan.msg ?? null);
});
setDragonVictoryHook((unlocked) => {
  scanWorldPortals();
  // Rebuild the bar in place and pop only the tier this kill unlocked.
  resetItems(dimHotbar(dim), unlocked);
});

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false })
);
highlight.visible = false;
highlight.renderOrder = 999;
scene.add(highlight);
// Target debug overlay (green cells: selection, target, planned path).
initTargetDebug(scene);
const _hookDir = new THREE.Vector3();
const _spawnDir = new THREE.Vector3();
// Cheat B press tracking: tap (<250 ms) spawns the next selected kind, a
// 250–299 ms hold does nothing, holding >=300 ms opens the spawn menu.
let bPressT = 0;
let bHoldTimer = 0;
let bDown = false;
const bossBarEl = document.getElementById("bossbar");
const bossFillEl = document.getElementById("bossfill");
function updateBossBar() {
  const health = dim === "end" ? dragonHealth() : 0;
  if (health <= 0) { bossBarEl.style.display = "none"; return; }
  bossFillEl.style.width = `${Math.round(health * 100)}%`;
  bossBarEl.style.display = "block";
}

// Mega-blast camera shake (master: trauma capped at 1.5, decays 1.4/s,
// rotational + positional jitter scaled by trauma^1.5). One impulse per
// detonation, three zones per kind shake spec: max inside the blast,
// linear decay to 2x range, exponential decay to 3x — no sustain, same
// duration everywhere (1/2/3/4+, ground/fly, mega/ultra). Kinds without a
// spec don't shake.
let camTrauma = 0;
function addCamShake(a) { camTrauma = Math.min(1.5, camTrauma + a); }
// Flames around the lens: a camera-centered dense burst (depth test already
// off), so every look direction burns. Shared by point-blank mega (R12) and
// close-range ultra (spec radius).
function spawnLensBurst(R) {
  const FIRE = [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]];
  spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R, role: "fire", count: 3500, life: 0.9 * MEGA_BLAST_TIME_SCALE, palette: FIRE, speedMin: 2, speedMax: 10, up: 3, gravity: -4, size: 34, shape: "ball", occlude: false });
  spawnDense({ x: camera.position.x, y: camera.position.y, z: camera.position.z, R, role: "ember", count: 1500, life: 0.7 * MEGA_BLAST_TIME_SCALE, color: [1, 0.95, 0.85], variance: [0, 0.04, 0.06], speedMin: 4, speedMax: 14, up: 5, gravity: -3, size: 26, shape: "ball", occlude: false });
  flushDense();
  noteDenseSpawn(1.2 * MEGA_BLAST_TIME_SCALE);
}
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
  // Point-blank (camera inside the crater): full-screen fire, FOV kick.
  // The detonation punch always fires; there is no fire tail.
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
        fovKickV = 5;
        spawnLensBurst(12);
      } else if (seen) {
        fireMegaOverlay(0.45, 0.15);
      }
    } else if (seen) {
      // Ultra overlay follows the inferno spec. Close range adds a lens
      // burst + FOV kick like a point-blank mega; far away the overlay
      // alone carries it. Destruction runs its normal band wipe.
      const uf = ultraFxSpec();
      fireMegaOverlay(uf.overlay[0], uf.overlay[1]);
      if (uf.camBurst && dc < uf.fovRange) {
        spawnLensBurst(uf.camR);
        fovKickV = uf.fovKick;
      }
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
// Imported from tnt.js so particles, blast light, and overlays all share
// the post-detonation timeline. Shake itself is one impulse plus decay
// (no sustain): same duration everywhere.
const BLAST_T = MEGA_BLAST_T;
// Last-blast FOV kick decays back to 75 on sim-time.
let fovKickV = 0;
const BASE_FOV = 75;
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

// Mega-pool mob ejection: same centroid + R as the player knockback, same
// arc through the shared launcher. Carried/riding mobs keep their freeze;
// the dragon never flies (boss, not livestock). Same-dim Endermen caught in
// the member-sphere union teleport out at the same detonation.
onMegaPool(({ x, y, z, R, members, radii }) => {
  for (const m of listFarmMobs()) {
    if (!m.alive || isCarried(m) || m._riding || (m.dim ?? "over") !== dim) continue;
    const v = computeMegaLaunch(m.pos.x, m.pos.y + (m.h ?? 1.8) / 2, m.pos.z, x, y, z, R);
    if (v) launchMobBlast(m, v.vx, v.vy, v.vz);
  }
  teleportBlastEndermen(dim, camera,
    { spheres: members.map((m, i) => ({ x: m.x, y: m.y, z: m.z, r: radii[i] })) });
});

// Other blasts, same Enderman rule: only the mobs a blast could have touched
// teleport — normals report their spheres (one call per batch), ultras their
// wiped range once the wipe drains, landing on whatever surface remains.
// Mega pools never reach this hook (onMegaPool carries them).
onCrater((ev) => {
  if (ev.kind === "ultra") {
    teleportBlastEndermen(dim, camera, { yLo: ev.yLo, yHi: ev.yHi });
  } else {
    teleportBlastEndermen(dim, camera, { spheres: ev.spheres });
  }
});

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
  // Rocket speed lag (flight only): the eye trails the hull with speed,
  // clamped so it never enters the hull — the pre-space-boost feel, capped.
  rocketClampEye(camera.position);
}

let worldReady = false;
let building = false;
// Play is clickable from the first frame, but entry waits for the first
// rendered world frame: the click only arms this flag (plus a best-effort
// pointer lock while the gesture is fresh), and the loop enters the game
// once voxels exist — never an empty skybox.
let pendingPlay = false;
// Play loading gate: the click is always accepted, but entry waits until the
// visible neighborhood is meshed and the shaders compiled — the first-seconds
// shader/compile/upload costs pay behind the menu instead of after entry.
let playReady = false;
let gateT0 = 0;
let shadersCompiled = false;
// Entry needs only the visible neighborhood meshed: the closed-in fog and
// the reveal hide everything past a few chunks, and the fog controller keeps
// unbuilt distance fogged afterwards. 3 chunks covers the spawn ring (radius
// 2) with margin, whatever the spawn altitude (3D distance, Moon included).
const GATE_NEAR_R = 3 * CHUNK;
const GATE_FALLBACK_MS = 20000; // enable anyway past this: weak machines never soft-lock
// Fog reveal progress 0..1 (1 = done): advances per frame once the spawn
// neighborhood exists, never gating movement. Loader-exempt wall clock.
let revealT = 1;
let buildToken = 0;
// DPR-dip state for band wipes (false = full resolution).
let bandDpr = false;
// Celestial hotbar state: true while the reveal shows the sky (Moon or
// planets band, camera-driven only — voxel liveness ignored); the water slot
// tracks the Voronoi zone instead (planet water, Moon water, or plain water).
let skyRevealed = false;
let lastSkyWater = WATER;
// Moon-water eye medium (fog override off = air, on = submerged).
let lastMoonEyeFog = null;
// Lava eye medium (fog override off = air, on = submerged).
let lastLavaEyeFog = null;
// V (cheat only) cycles the world simulation speed. Player, camera, chain
// editing, and loader/visual transitions stay on real dt (world ticks use sdt).
const GAME_SPEEDS = [1, 2, 4, 8, 16];
let gameSpeed = 1;
// Boot dimension: the overworld by default; ?startdim=<dimension key> builds
// that registered dimension directly. Unknown values fall back to overworld.
// ?startdim=moon is an alias, not a dimension: it boots the overworld but
// spawns on the Moon surface (respawns stay on ground spawn). ?startdim=pen
// is the same kind of alias: overworld boot with the pen overwatch spawn
// (hovering above the pen in fly mode, respawns stay on ground spawn).
const _rawStartDim = new URLSearchParams(location.search).get("startdim");
const isMoonBoot = _rawStartDim === "moon";
const isPenBoot = _rawStartDim === "pen";
const BOOT_DIM = (isMoonBoot || isPenBoot) ? "over" : (dimSpec(_rawStartDim) ? _rawStartDim : "over");
// Reproducible worlds: ?seed=<integer> reuses that world seed instead of
// rolling a fresh one every boot. Without it every build rolls fresh.
const _seedParam = new URLSearchParams(location.search).get("seed");
const _seedNum = _seedParam !== null && _seedParam !== "" ? Math.floor(Number(_seedParam)) : NaN;
const _seedPinned = Number.isFinite(_seedNum);
function rollSeed() {
  return _seedPinned ? _seedNum : Math.floor(Math.random() * 100000);
}

// Session fly-speed multiplier: ?flymul=<factor> scales the player's base
// and sprint fly speeds (see fly.js) — the rocket caps keep reading the
// bare FLY, so deep-space speed is never affected. Invalid values ignored.
setFlyMul(Number(new URLSearchParams(location.search).get("flymul")));

// Boot slice budget (ms) behind the menu: wide slices (fewer rAF rounds,
// same total work — the menu stays alive on yields either way).
const BOOT_SLICE_MS = 120;
// Celestial drain batch cap behind the menu: the ms budget alone never
// bounds the gate (each drain call meshes at most CELESTIAL_DRAIN_MAX
// chunks), so the cap scales with the slice.
const BOOT_DRAIN_MAX = CELESTIAL_DRAIN_MAX * 5;
let tuneYieldN = 0;
function bootYield() {
  tuneYieldN++;
  if (tuneYieldN % 4 === 0) return new Promise((r) => requestAnimationFrame(r));
  return Promise.resolve();
}

// Held-mob teardown (travel, New World, respawn): opaque again first, then
// the pure state sever — the mob stays where the pose left it, movers resume.
function dropHeldMob() {
  const held = heldMob();
  if (held) setMobAlpha(held, 1);
  severCarry();
}

// The level loads behind the translucent menu in slices: voxels generate a
// dozen rows per frame, then the spawn neighborhood builds (radius 2: the
// closed-in fog only shows ~30 blocks, the clear-bubble guard covers the
// rest). Play stays clickable throughout but entry waits for the first
// rendered world frame, while far chunks stream in under the frame budget
// and the fog expands underneath. Shader warmup compiles after unlock so
// it never stacks onto the entry freeze.
// Boot-phase probe: records milestone timestamps for the browser driver so
// boot slices can be timed per phase (?startdim=moon). Inert unless the
// driver arms window.__bootProbe — zero prod impact (precedent: __fxProbe).
function bootProbe(phase, n = null) {
  if (typeof window !== "undefined" && window.__bootProbe) {
    window.__bootProbe.push({ phase, t: Math.round(performance.now()), n });
  }
}
async function buildWorld() {
  if (building) return;
  const token = ++buildToken;
  const aborted = () => token !== buildToken;
  building = true;
  bootProbe("boot");
  worldReady = false;
  shadersCompiled = false;
  resetLod();
  revealT = 0;
    severHook();
    dropHeldMob();
    resetRocket();
    clearHomingTnt();
  clearEndMobs();
  clearFarmMobs();
  resetTargetDebug();
  resetTravelLinks();
  resetTntUnlocks();
  if (BOOT_DIM !== "end") resetEndDimension();
  if (BOOT_DIM !== "nether") resetNetherDimension();
  resetTNTMemory();
  gameSpeed = 1;
  bandDpr = false;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  resetGlowstoneMemory();
  resetFlowerMemory();
  resetReactionMemory();
  clearReactionFx();
  resetPoolLightMemory();
  proxyClear();
  // A world reset ends any chain stroke: drop its pending tint pass and
  // its deferred liquid-purge union too (stale coordinates).
  setHaloSuspended(null);
  bridgeTouchedUnion.length = 0;
  wasBridgeHeld = false;
  wasChainHeld = false;
  clearChainStroke();
  scene.fog.near = LOAD_FOG_NEAR;
  scene.fog.far = LOAD_FOG_FAR;
  envAir.near = LOAD_FOG_NEAR;
  envAir.far = LOAD_FOG_FAR;
  await new Promise((r) => requestAnimationFrame(r));
  try {
    const seed = rollSeed();
    setGlowSeed(seed);
    setFlowerSeed(seed);
    setMobSeed(seed);
    setFarmSeed(seed);
    exitAmbient();
    // Direct End boot still prepares the Overworld destination so its return
    // portal has a real world to return to.
    if (BOOT_DIM === "end") {
      const overReady = await dimSpec("over").generateAsync(seed, aborted);
      if (!overReady || aborted()) return;
    }
    const gen = dimSpec(BOOT_DIM).generateAsync;
    const ok = await gen(seed, aborted);
    if (!ok || aborted()) return;
    bootProbe("generated");
    spawnPlayer();
    // Moon alias: override the ground spawn with the lunar surface pick
    // before meshing the neighborhood, so the first built chunks are lunar.
    if (isMoonBoot) {
      const m = findMoonSpawn();
      pos.set(m.x + 0.5, m.y + 1.01, m.z + 0.5);
      vel.set(0, 0, 0);
      setYaw(m.yaw);
      setPitch(0);
    }
    // Pen alias: override the ground spawn with the pen overwatch pick
    // before meshing the neighborhood, so the first built chunks are the pen.
    if (isPenBoot) {
      const p = findPenOverwatch();
      if (p) {
        pos.set(p.x + 0.5, p.y + 1.01, p.z + 0.5);
        vel.set(0, 0, 0);
        setYaw(p.yaw);
        setPitch(p.pitch);
        setFly(true);
      }
    }
    // No glowstone rescan: worldgen places none and the live index starts
    // empty (player edits track themselves).
    rebuildAll(pos.x, pos.z, 2);
    bootProbe("remeshed");
    if (isMoonBoot && !aborted()) {
      // ?startdim=moon starts at MOON_SURFACE_Y where planets are at full
      // visibility. Voxels and meshes for in-range bodies only: far bodies
      // stream in the background after entry (nearest-first) and read as
      // proxy meshes until then — the boot no longer pays the whole sky
      // up front. No refreshBlocks avalanche, no synchronous
      // drainChunkQueue(true): entry shows finished near planets.
      pinCelestialBodies();
      const _eye0 = { x: 0, y: MOON_SURFACE_Y, z: 0 };
      // Single layout evaluation per boot: bodySpecs is seed-cached, but the
      // mesh-want filters below must share one array instead of re-listing
      // the 200-planet shell twice.
      const _specs = bodySpecs(seed);
      // Voxels AND meshes for in-range bodies only: far bodies stream in the
      // background after entry (nearest-first, budgeted slices) and read as
      // proxies until then — the boot no longer pays the whole sky up front.
      const pSpecs = _specs.slice(1)
        .filter((s) => bodyMeshWant(seed, s.key, _eye0.x, _eye0.y, _eye0.z));
      for (const spec of pSpecs) {
        if (aborted()) return;
        generateBodyUnderRows(spec, seed, setBlock, spec.cx - spec.r, spec.cx + spec.r + 1, getBlock);
        if (aborted()) return;
        await bootYield();
        generateBodySurface(spec, seed, setBlock);
        if (aborted()) return;
        await bootYield();
        const joinSt = joinBodyLakeWaterStart();
        let joinGuard = 4096;
        let joinSlices = 0;
        while (!joinBodyLakeWaterSlice(spec, seed, setBlock, getBlock, joinSt)) {
          if (aborted()) return;
          if (--joinGuard <= 0) break;
          if (++joinSlices % 4 === 0) await new Promise((r) => requestAnimationFrame(r));
        }
        markBodyBuilt(seed, spec.key);
        bootProbe("body", spec.key);
        purgeUnsupportedKeeps(spec, seed, setBlock, getBlock);
        queueCelestialChunks(bodyChunkCenters(spec));
        await bootYield();
      }
      // Sky gate: drain the celestial queue in large slices (the menu/loader
      // stays alive on rAF yields) until every in-range body chunk — Moon
      // shell plus near planets — is meshed. Far bodies read as proxies
      // at entry and converge in the background after it. Nearest-first
      // from the spawn, so the ground under the player completes first. The
      // frame guard only abandons the wait (background convergence resumes
      // via maybeStream); it never hangs the boot.
      if (!aborted()) {
        const skySpecs = _specs
          .filter((s) => bodyMeshWant(seed, s.key, _eye0.x, _eye0.y, _eye0.z));
        let skyGuard = 3600;
        bootProbe("sky-gate");
        let skyIters = 0;
        while (skyGuard-- > 0 && !aborted() && !skyConverged(skySpecs, isChunkMeshed)) {
          const t0 = performance.now();
          let drained = 1;
          while (drained > 0 && performance.now() - t0 < BOOT_SLICE_MS) {
            drained = drainCelestial(pos.x, pos.z, BOOT_SLICE_MS, undefined, undefined, undefined, BOOT_DRAIN_MAX);
          }
          // The in-range body chunks ride the WINDOW queue (only centers
          // went celestial upfront): without draining it here the gate
          // only waits on the background stream.
          drainChunkQueue(false, BOOT_SLICE_MS, pos.x, pos.z);
          await new Promise((r) => requestAnimationFrame(r));
          if (++skyIters % 10 === 0) bootProbe("sky-tick", celestialPendingSize() * 100000 + (hasPendingChunks() ? 1 : 0));
        }
        bootProbe("sky-gated", 3600 - skyGuard);
      }
      // Every body displayed before entry: proxies prewarm (fade complete)
      // behind the menu, so the reveal never shows a sky mid-pop-in. Far
      // bodies stay proxies at entry; in-range meshed ones crossfade out
      // over their voxels from the first LOD tick.
      if (!aborted()) {
        await prewarmProxies(scene, getSeed());
        bootProbe("prewarmed");
      }
    }
    if (aborted()) return;
    clearPortalFills();
    if (BOOT_DIM === "end") {
      setDimension("over");
      resetFrameSet(dimSpec("over").frameKeys?.() ?? []);
      setDimension("end");
    }
    resetFrameSet(dimSpec(BOOT_DIM).frameKeys?.() ?? []);
    scanWorldPortals();
    // Direct Nether boot starts on the portal arrival, not the raw spawn pad.
    if (BOOT_DIM === "nether") {
      const arrival = resolveTravelArrival("nether", pos);
      if (arrival) placeArrival(arrival);
    }
    if (dim === "end") enterEndMobs(scene);
    if (dim === "over") enterFarmMobs(scene, "over");
    skyRevealed = false;
    lastSkyWater = WATER;
    resetItems(dimHotbar(dim));
    select(0);
    updateCamera();
    resetTNTMemory();
    worldReady = true;
    updateBossBar();
    // Nether boots start revealed: the dark sky (fog 380/760) makes the
    // closed-in reveal pointless, and prepareNetherDimensionAsync only
    // materializes the spawn chunks while the mesher streams the rest.
    if (dimSpec(BOOT_DIM)?.fullView) revealT = 1;
  } finally {
    if (token === buildToken) building = false;
  }
  if (aborted() || !worldReady) return;
  if (dimHasMoon(dim)) {
    // Background sky work waits for altitude (see tickPlanetStream): ground
    // boots pay zero celestial voxels, Moon boots converge after entry.
    if (camera.position.y >= CELESTIAL_STREAM_Y) fillMoonUnder(getSeed());
    pinCelestialBodies();
  }
  warmupFx(token);
}
// Pin the Moon + planet chunk meshes against the streaming dispose: leaving
// them rebuilds every body chunk by chunk on return. Pinned keys never
// evict (cleared on teardown), unmeshed ones still build through the normal
// paths — the pin only ever skips disposal.
function pinCelestialBodies() {
  if (!dimHasMoon(dim)) return;
  const keys = [];
  for (const spec of bodySpecs(getSeed())) {
    for (const k of bodyChunkKeys(spec)) keys.push(k);
  }
  pinChunks(keys);
}

// Cross-dimension travel behind the spiral: the destination loads in two
// phases while the overlay covers the screen, and the spiral lifts only once
// the arrival neighborhood is meshed — ready to go, no arrival hitch, no
// visible streaming. End and TNT regenerate on every entry (fresh seed,
// frame index rebuilt); the Overworld and the Nether retain voxels. Arrival
// uses the portal last left in the destination when it still validates
// (Overworld faces it, everywhere else arrives back to it), else the
// dimension spawn. Meshes, fills, lights, and fuses reset around the switch;
// fly mode persists (all portals), movement keys zero.
//
// Phase 1 (voxels, no mesher calls — the scene still shows the old world):
// switch the voxel store, generate only when needed, resolve the arrival on
// finished voxels and move the player there. Phase 2 (meshes, budgeted):
// dispose, queue the full ring, drain it in ~10 ms slices until the arrival
// neighborhood is built, refresh every portal fill (behind the spiral, so
// its cost never shows), then compile shaders — all before the reveal. Far
// chunks keep streaming under the fast reveal afterwards, hidden by the fog
// guard like steady state. Loader work throughout (rAF slices, no sim), with
// its own token: pausing never stalls it.
function placeArrival(arr) {
  pos.set(arr.spot.x, arr.spot.y, arr.spot.z);
  vel.set(0, 0, 0);
  setYaw(arr.yaw);
  setPitch(0);
}

let travelToken = 0;
// Dimensions whose program set already linked this session (GL programs
// persist in the context): repeat trips skip the travel-time compile walk.
const compiledDims = new Set();
// Transition gate: while set, the loop skips chunk/voxel streaming and the
// canvas render — the overlay covers a frozen frame while runTravel drives
// the mesher itself below (streaming around the stale position inside the
// new dimension's bounds would generate chunks nobody arrives at).
let travelActive = false;
// Full-ring drain budget: phase 2 builds the whole queued ring in slices,
// nearest-first, so capping it still leaves the nearest geometry complete.
// Slices stay short on purpose: first-visit Nether chunks can each cost well
// past the budget, and only yielding between chunks keeps the spiral alive.
const TRAVEL_DRAIN_MS = 12;
const TRAVEL_DRAIN_FRAMES = 120;

async function runTravel(dest, msg) {
  const token = ++travelToken;
  const alive = () => token === travelToken;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  building = true;
  travelActive = true;
  // Departure behind the spiral: snap the fog closed (invisible: the canvas
  // stops rendering below and the overlay fades in over the frozen frame).
  scene.fog.near = LOAD_FOG_NEAR;
  scene.fog.far = LOAD_FOG_FAR;
  envAir.near = LOAD_FOG_NEAR;
  envAir.far = LOAD_FOG_FAR;
  revealT = 0;
  const t0 = performance.now();
  // Let the spiral paint before any heavy work: its fade starts now, so the
  // overlay reads immediate even though the load behind it takes seconds.
  await raf();
  await raf();
  if (!alive()) return;
  // Teardown in slices under the fade-in: one monolithic dispose of a full
  // ring reads as a freeze of its own, so the chunks go ~80 per frame while
  // the overlay covers the frozen frame. Nothing reads the scene until phase
  // 2 re-queues it (renders skipped, sim frozen, queue cleared last).
  beginDispose();
  resetLod(); // proxy meshes die with the chunk meshes; the new dim re-syncs them
  proxyClear(); // versions reset with the mesher; drop the overlay with them
  clearReactionFx(); // run cubes die with the chunks; the new dim re-syncs them
  // Travel ends any chain stroke: drop its pending tint pass and its
  // deferred liquid-purge union (coordinates are meaningless across dims).
  setHaloSuspended(null);
  bridgeTouchedUnion.length = 0;
  wasBridgeHeld = false;
  wasChainHeld = false;
  clearChainStroke();
  while (disposeSome(80)) {
    if (!alive()) return;
    await raf();
  }
  if (!alive()) return;
  try {
    severHook();
    dropHeldMob();
    clearHomingTnt();
    // End natives never travel: leaving the End drops that dim's mobs
    // (dragon + platform Endermen); cheat Endermen in retain dims survive.
    clearEndMobs("end");
    resetTNTMemory();
    clearPortalFills();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    setDimension(dest);
    // Regenerate dimensions rebuild voxels on every entry: drop their own
    // side memories (glowstone variants/index, flower looks, placed-TNT
    // index, that dim's farm mobs via handleFarmTravel below) so nothing
    // stale leaks into the fresh world — no ghost lights,
    // no inherited colors, no phantom chain links. Driven by the persistence
    // spec, so future regenerate dimensions inherit it. Retain dimensions
    // keep theirs across trips.
    if (dimSpec(dest)?.persistence === "regenerate") {
      clearGlowstoneDim(dest);
      clearFlowerDim(dest);
      clearReactionsDim(dest);
      clearRegularTntDim(dest);
      // Regenerate dims rebuild: drop that dim's placed Endermen too.
      if (dest !== "end") clearEndermenDim(dest);
    }
    if (dest === 'tnt') {
      const spec = dimSpec('tnt');
      resetFrameSet([]);
      const seed = rollSeed();
      setGlowSeed(seed);
      setFlowerSeed(seed);
      const ok = await spec.generateAsync(seed, () => !alive());
      if (!ok || !alive()) return;
      spawnPlayer();
    } else if (dest === "end") {
      const spec = dimSpec("end");
      const seed = rollSeed();
      setMobSeed(seed);
      const ok = await spec.generateAsync(seed, () => !alive());
      if (!ok || !alive()) return;
      resetFrameSet(endPortalFrameKeys());
      setEndCleared(false);
      spawnPlayer();
      const arrival = resolveTravelArrival("end", pos);
      if (arrival) placeArrival(arrival);
    } else if (dest === "nether") {
      const spec = dimSpec("nether");
      if (!worlds.nether.size) {
        const seed = rollSeed();
        setGlowSeed(seed);
        setFlowerSeed(seed);
        setMobSeed(seed);
        const ok = await spec.generateAsync(seed, () => !alive());
        if (!ok || !alive()) return;
        resetFrameSet(spec.frameKeys?.() ?? []);
      }
      // Spawn first so an unlinked arrival anchors on destination
      // coordinates (like the End branch); a found arrival overrides it.
      spawnPlayer();
      const arrival = resolveTravelArrival("nether", pos);
      if (arrival) placeArrival(arrival);
    } else {
      if (!worlds.over.size) {
        const seed = rollSeed();
        setGlowSeed(seed);
        setFlowerSeed(seed);
        const ok = await dimSpec('over').generateAsync(seed, () => !alive());
        if (!ok || !alive()) return;
        resetFrameSet(dimSpec('over').frameKeys?.() ?? []);
      }
      const arrival = resolveTravelArrival("over");
      if (arrival) placeArrival(arrival);
      else spawnPlayer();
    }
    updateCamera();
    // Voxels and arrival done: meshes from here on (the scene was already
    // disposed under the fade-in). Queue the full ring, then drain it in
    // slices until nothing is missing; the cap keeps the worst case bounded.
    streamChunks(pos.x, pos.z);
    for (let i = 0; i < TRAVEL_DRAIN_FRAMES; i++) {
      if (!alive()) return;
      if (nearestMissingDist(pos.x, camera.position.y, pos.z) === Infinity) break;
      const tD = performance.now();
      drainChunkQueue(false, TRAVEL_DRAIN_MS, pos.x, pos.z);
      await raf();
      // A heavy slice (first-visit volcano chunks) breathes an extra frame
      // instead of stacking another long block right behind it.
      if (performance.now() - tD > TRAVEL_DRAIN_MS * 2) await raf();
    }
    if (!alive()) return;
    // Every fill relights behind the spiral, so its cost never shows.
    scanWorldPortals();
    skyRevealed = false;
    lastSkyWater = WATER;
    // Per-dimension bar: the TNT cube holds TNT tiers only. Selection follows
    // by id, so a held TNT survives the trip; anything else clamps.
    resetItems(dimHotbar(dim));
    if (dest === "end") enterEndMobs(scene);
    handleFarmTravel(scene, dest);
    resetTargetDebug();
    updateBossBar();
    updateCamera();
    // Compile behind the spiral, once per dimension per session: programs
    // persist in the GL context, so repeat trips skip the traversal walk
    // entirely. (compileAsync links synchronously first, then polls — the
    // first link of a dimension's set is a real block, hence once-only.)
    if (!compiledDims.has(dest)) {
      if (alive()) await renderer.compileAsync(scene, camera);
      if (!alive()) return;
      compiledDims.add(dest);
    }
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    // Minimum spiral display: wait it out when retained dimensions load fast.
    while (performance.now() - t0 < TRAVEL_MIN_MS) {
      if (!alive()) return;
      await raf();
    }
    if (!alive()) return;
    // Arrival is fully loaded: open the fog straight to its final range, so
    // no reveal ever plays. If the frame cap hit first (deep Nether), the
    // missing-chunk guard still hides unbuilt distance without holes.
    revealT = 1;
    {
      const denv = dimEnv(dim);
      const far = denv?.fogFar ?? readyFog.far;
      const near = denv?.fogNear ?? readyFog.near;
      scene.fog.near = Math.max(Math.min(near, far - 1), LOAD_FOG_NEAR);
      scene.fog.far = Math.max(far, LOAD_FOG_FAR);
      envAir.near = scene.fog.near;
      envAir.far = scene.fog.far;
    }
    if (msg) toast(msg);
  } finally {
    if (alive()) {
      building = false;
      travelActive = false;
      updateCamera();
      // Arrival punch: the FOV stretches through the spiral fade-out, then
      // eases back on sim-time via the existing kick decay.
      fovKickV = 6;
      completeDimTravel();
    }
  }
  // Resume an interrupted moon fill when coming home: travelling out mid-fill
  // aborts the slices above, leaving the overworld moon half-built. The size
  // guard skips worlds whose overworld was never generated (temporary boot).
  // Same altitude gate as boot: no sky work while standing on the ground.
  if (travelToken === token && dest === "over" && worlds.over.size > 0) {
    if (!moonReady(getSeed()) && camera.position.y >= CELESTIAL_STREAM_Y) fillMoonUnder(getSeed());
    pinCelestialBodies();
  }
}

// Shader warmup behind the menu: pools enter the scene and compile before
// Play enables, so blast #1 never pays scene-add + compile + first upload
// mid-blast, the first countdown never pays the burst programs mid-tick,
// and entry never pays it.
async function warmupFx(token) {
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  if (token !== buildToken || !worldReady) return;
  prewarmDenseFx();
  prewarmBursts();
  renderer.compile(scene, camera);
  compiledDims.add(dim);
  shadersCompiled = true;
  resetTNTMemory();
}

// Reveal clock: pure wall time 0→1 over REVEAL_MS, monotonic by
// construction — it never stalls on slow chunks and never recedes when the
// player walks, unlike the old built-fraction gate. Hiding unbuilt geometry
// is the fog cap's job (see updateStreamingFog), which eases smoothly.
function tickReveal(dt) {
  if (revealT >= 1 || !worldReady) return;
  revealT = Math.min(1, revealT + dt / (REVEAL_MS / 1000));
}
// Slow-start reveal curve (t^2.5): keeps the fog dense through the first
// half regardless of loader speed.
function revealEase() {
  return Math.pow(revealT, 2.5);
}

// Lazy body fill (startup perf): the Moon's surface is eager (spawn stands
// on it) so only its hollow shell fills here; planet surfaces stream in
// through the same slicer on approach. The shell + lake join run across
// idle frames, then built disc chunks remesh (streaming covers the rest:
// the fill completes before the refresh pass, so later builds include it).
// Aborts if a New World starts mid-fill; seed-tokened, and the overwrites
// are deterministic, so racing the safety net is harmless. One body at a
// time: planets queue behind the Moon.
let bodyFilling = null;
async function fillBodyUnder(seed, spec) {
  const isMoon = spec.key === "moon";
  const ready = () => isMoon ? moonReady(seed) : bodyReady(seed, spec.key);
  const markDone = () => isMoon ? markMoonBuilt(seed) : markBodyBuilt(seed, spec.key);
  if (bodyFilling || ready()) return;
  bodyFilling = spec.key;
  try {
    const R = spec.r ?? MOON_R, STEP = 16;
    const x0 = spec.cx - R, x1 = spec.cx + R + 1;
    // The Moon's surface is eager; planet surfaces stream in here instead,
    // one 16-row slice per frame (sub-ms) so the whole sky converges inside
    // a rocket ascent at a steady 60 fps — never a 32-row burst.
    if (!isMoon) {
      for (let x = x0; x < x1; x += STEP) {
        if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady || ready()) return;
        generateBodySurfaceRows(spec, seed, setBlock, x, x + STEP);
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    for (let x = x0; x < x1; x += STEP) {
      if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady || ready()) return;
      generateBodyUnderRows(spec, seed, setBlock, x, x + STEP, getBlock);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady || ready()) return;
    // Well restore: converge sealed-era rock back to open wells before the
    // join. The moon path never replays surface rows (player mining must
    // survive), so without this a sealed well would persist forever; stale
    // fill versions land here exactly once via the readiness gate above.
    restoreBodyLakeWells(spec, seed, setBlock, getBlock);
    // Sliced lake join (one lake per frame): the sync fixpoint would hitch a
    // frame per body, and the background now completes all ten planets one
    // by one at 60 fps.
    const joinSt = joinBodyLakeWaterStart();
    let joinGuard = 4096;
    for (;;) {
      if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady || ready()) return;
      if (joinBodyLakeWaterSlice(spec, seed, setBlock, getBlock, joinSt)) break;
      if (--joinGuard <= 0) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
    markDone();
    // In-fill placements that ended up floating are removed now that real
    // support decides; the centers refresh below covers the cleared cells.
    purgeUnsupportedKeeps(spec, seed, setBlock, getBlock);
    // Nearest-first so the pop residue reads as a focus pull, not random
    // tiles (insertion order is the drain order). Built chunks (the visible
    // neighborhood, e.g. the Moon shell under the spawn) remesh synchronously
    // so they read whole immediately — three per frame, never eight (at
    // 120 Hz+ an 8-chunk sync slice alone eats the frame); unbuilt ones
    // converge through the budgeted celestial queue — never the window
    // queue (which would trigger the behind-budget loan in maybeStream).
    const centers = bodyChunkCenters(spec);
    const cx0 = camera.position.x, cz0 = camera.position.z;
    centers.sort((a, b) =>
      (a[0] - cx0) * (a[0] - cx0) + (a[2] - cz0) * (a[2] - cz0) -
      ((b[0] - cx0) * (b[0] - cx0) + (b[2] - cz0) * (b[2] - cz0)));
    // Meshes for wanted bodies only: out-of-range bodies keep their proxy
    // until the player approaches (the LOD tick queues them then). Voxels
    // above are complete either way.
    const wantMesh = bodyMeshWant(seed, spec.key, camera.position.x, camera.position.y, camera.position.z);
    if (wantMesh) {
      for (let i = 0; i < centers.length; i += 3) {
        if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady) return;
        refreshBuiltQueueCelestial(centers.slice(i, i + 3));
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
  } finally {
    bodyFilling = null;
  }
}

function fillMoonUnder(seed) {
  return fillBodyUnder(seed, moonSpec());
}

// Planet streaming: the next unbuilt body starts its sliced fill (one at a
// time via bodyFilling), nearest first and range-free — standing on the
// Moon completes the planets one by one so they fade in progressively.
// Loading, not sim: runs behind the pause gate with the moon fill above.
// Background work waits below CELESTIAL_STREAM_Y (ground starts pay zero
// sky voxels); explicit first-touch fills (aim/click/grapple) always run.
// Near an unbuilt body the fill finishes synchronously instead, so
// descending never meets an unbuilt shell.
function tickPlanetStream() {
  if (!worldReady || building || !dimHasMoon(dim) || bodyFilling) return;
  const seed = getSeed();
  const lead = streamLead();
  // First-touch placements register their body here: the single-flight
  // slicer completes it over frames (queued behind any running fill).
  for (const spec of bodySpecs(seed)) {
    if (!bodyReady(seed, spec.key) && takeBodyFill(seed, spec.key)) {
      fillBodyUnder(seed, spec);
      return;
    }
  }
  // Altitude gate: no background voxels or meshing while the sky is
  // invisible — the overworld boot streams ground only at 60 fps.
  if (camera.position.y < CELESTIAL_STREAM_Y) return;
  // A celestial grapple fill owns the single flight: the background stream
  // pauses until it completes — no double frame cost, no voxel races
  // between the two slicers. Explicit first-touch requests above stay
  // pending and resume right after.
  if (hookFillActive()) return;
  const pick = nextBodyToStream(bodySpecs(seed), lead.x, lead.y, lead.z, (k) => bodyReady(seed, k));
  if (!pick) return;
  // Background fill shares the LOD mesh rule: out-of-range bodies
  // materialize on demand (first touch, grapple fill, safety net, ultra
  // slicer) instead of costing frame budget and voxel memory. The sync
  // safety net below always runs — it is in range by construction.
  if (!pick.sync && !bodyMeshWant(seed, pick.spec.key, lead.x, lead.y, lead.z)) return;
  if (pick.sync) {
    // Synchronous safety net: complete the fill before the player can
    // touch the shell. Built neighborhood chunks remesh synchronously (the
    // shell underfoot reads whole at once); the rest ride the celestial
    // queue — never a refreshBlocks avalanche over the whole disc.
    const spec = pick.spec;
    generateBody(spec, seed, setBlock, getBlock);
    markBodyBuilt(seed, spec.key);
    purgeUnsupportedKeeps(spec, seed, setBlock, getBlock);
    refreshBuiltQueueCelestial(bodyChunkCenters(spec));
    return;
  }
  fillBodyUnder(seed, pick.spec);
}

// Stream/LOD lead: prefetch along the velocity so fast flight and grapple
// arrivals converge before arrival instead of blinking in over 1-2 s.
// Zero at rest (identical behavior on foot); capped to bound prefetch waste
// on escape-velocity rides (the grapple slicer owns its own path anyway).
const LEAD_T = 2, LEAD_MAX = 1200;
function streamLead() {
  const vx = vel.x * LEAD_T, vy = vel.y * LEAD_T, vz = vel.z * LEAD_T;
  const len = Math.hypot(vx, vy, vz);
  const k = len > LEAD_MAX ? LEAD_MAX / len : 1;
  return { x: pos.x + vx * k, y: pos.y + vy * k, z: pos.z + vz * k };
}

// Runtime fog: a tightening-only guard so chunk loading and unloading stay
// hidden at any altitude or speed, eased every frame toward its target so it
// never snaps or recedes. Fog is spherical while chunk rings are
// cylindrical, so the far plane is capped by the 3D distance to the nearest
// evictable slab (minus margin) — and by the nearest still-missing chunk,
// so streaming always debuts fully fogged; the reveal curve caps it too,
// so there is no handoff between reveal and runtime. The clear bubble
// shrinks further with speed so fast flight never outruns the loader
// into clear view.
function updateStreamingFog() {
  // Per-dimension steady state: TNT and the Nether override fog via their
  // DIMENSIONS env.
  const denv = dimEnv(dim);
  const baseFar = denv?.fogFar ?? readyFog.far;
  const baseNear = denv?.fogNear ?? readyFog.near;
  const dh = Math.max(0, camera.position.y - FOG_GROUND_REF);
  const unloadHoriz = (renderDist() + UNLOAD_MARGIN) * CHUNK;
  const limitFar = Math.sqrt(unloadHoriz * unloadHoriz + dh * dh) - FOG_MARGIN;
  const missing = nearestMissingDist(camera.position.x, camera.position.y, camera.position.z);
  // The reveal curve caps the target too: one lerped writer from the first
  // frame, no handoff, so the fog can never snap or recede. fullView dims
  // (Nether) skip the unload-horizon cap so distant volcanoes never clip.
  const revealFar = dimSpec(dim)?.fullView ? baseFar : LOAD_FOG_FAR + (baseFar - LOAD_FOG_FAR) * revealEase();
  const farCaps = dimSpec(dim)?.fullView
    ? [baseFar, missing - FOG_MARGIN, revealFar]
    : [baseFar, limitFar, missing - FOG_MARGIN, revealFar];
  const targetFar = Math.max(Math.min(...farCaps), LOAD_FOG_FAR);
  const ratio = baseNear / baseFar;
  const targetNear = Math.max(
    Math.min(targetFar * ratio * (1 - 0.2 * Math.min(1, vel.length() / 30)), targetFar - 1),
    LOAD_FOG_NEAR
  );
  const k = 0.12;
  scene.fog.near += (targetNear - scene.fog.near) * k;
  scene.fog.far += (targetFar - scene.fog.far) * k;
  // envAir mirrors the eased scene values, not the target: tickWaterFog
  // copies envAir back into scene.fog every frame, so recording the target
  // here would bypass this easing and snap the fog onto every target jump.
  envAir.near = scene.fog.near;
  envAir.far = scene.fog.far;
}

initMenu(renderer, () => {
  // Entry itself waits for the loading gate plus the first rendered world
  // frame (see loop); the lock is attempted now, while the click gesture
  // is still fresh.
  pendingPlay = true;
  requestLockNow();
}, () => {
  // Lock on the click gesture (browsers demand it), then rebuild under the
  // closed-in fog: frames keep rendering, movement resumes at spawn.
  enterGame(renderer);
  buildWorld();
}, anyPanelOpen, () => building);

// Pre-build the world behind the translucent menu; a Play click enters on
// the first rendered world frame, movement unlocks as soon as the spawn
// neighborhood exists, while far chunks stream in and fog expands underneath.
buildWorld();

initHelp(() => {
  if (started && !isLocked()) requestLockNow();
});

initMobMenu(() => {
  if (started && !isLocked()) requestLockNow();
});

function requestLockNow() {
  if (document.pointerLockElement) return;
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

initHotbarInput(() => false);

document.addEventListener("mousemove", (e) => {
  // The Play click locks the pointer while it is still a fresh gesture, but
  // entry (and the overlay hiding) waits for the first rendered world frame
  // — frozen camera until then, so no look-around behind the start menu.
  if (!started || !isLocked() || anyPanelOpen()) return;
  setYaw(player.yaw - e.movementX * 0.0022);
  const p = player.pitch - e.movementY * 0.0022;
  setPitch(Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p)));
  chainNoteMouseMove(chain, e.movementX, e.movementY);
});

document.addEventListener("mousedown", (e) => {
  if (!isLocked() || anyPanelOpen() || !started) return;
  if (rocketEditingBlocked()) return;
  // In flight no editing at all: no hull taps, no store taps — clicks are
  // inert (chain strokes are skipped separately in the tick below).
  if (rocketFlying()) return;
  if (e.button === 0) {
    const id = selectedId();
    if (id === TNT && fireHomingTnt(camera)) return;
    chainPressLeft(chain, selectedId());
    chainSavePaintRay(chain, camera);
    const face = currentBlock ? currentBlock.face : null;
    const base = currentBlock ? [currentBlock.x, currentBlock.y, currentBlock.z] : null;
    const changed = placeAtSelection(id, camera.position.y);
    if (changed) {
      refreshBlocks(changed);
      notifyEndermanVoxelChange(changed, camera, dim);
      if (face && base) chainNotePressPlace(chain, base[0] + face[0], base[1] + face[1], base[2] + face[2]);
      else for (const c of changed) chainAnchorPush(chain, c[0], c[1], c[2]);
    }
  } else if (e.button === 2) {
    chainPressRight(chain);
    chainSaveDigRay(chain, camera);
    const bt = breakTarget(camera);
    if (bt && !bt.body) {
      const changed = breakBlockAt(bt.x, bt.y, bt.z, { eyeY: camera.position.y });
      if (changed.length) {
        refreshBlocks(changed);
        notifyEndermanVoxelChange(changed, camera, dim);
      }
      chainAnchorPush(chain, bt.x, bt.y, bt.z);
    } else if (bt && bt.body) {
      // Remote body hit: the body's nearest TNT wins (ignite, else
      // detonate); with none on board, mine the aimed cell like local.
      const r = useBodyTnt(bt.body, getSeed(), bt.x, bt.y, bt.z);
      if (r && r.action === "detonated") {
        if (r.touched.length) refreshBlocks(r.touched);
        notePortalEdits(r.touched);
      } else if (!r) {
        const changed = breakBlockAt(bt.x, bt.y, bt.z, { eyeY: camera.position.y });
        if (changed.length) {
          refreshBlocks(changed);
          notifyEndermanVoxelChange(changed, camera, dim);
        } else toast("No TNT on this body");
      }
      chainAnchorPush(chain, bt.x, bt.y, bt.z);
    }
  } else if (isGrappleButton(e.button)) {
    camera.getWorldDirection(_hookDir);
    // Sky-grapple fallback (TNT dimension only): a miss synthesizes a cloud
    // past the fog instead of fizzling. Refusals (fly/hooked) stay refused.
    if (!fireHookTarget(grapplePick, camera.position, _hookDir)) {
      fireSkyHook(camera.position, _hookDir, scene.fog.far + 40, TNT_SKY_GRAPPLE_MAX, refreshBlocks);
    }
  }
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0) chainReleaseLeft(chain);
  if (e.button === 2) chainReleaseRight(chain);
  if (isGrappleButton(e.button) && hookActive()) cancelHook(true);
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  // Menus first: the registry routes to the topmost open modal (consuming
  // everything while one is open) then to the topmost open float (consuming
  // everything too — paused like a modal, Enter/Escape do nothing on
  // floats) then to the pause overlay for Enter/Escape resume, letting
  // other paused keys fall through to the game below.
  if (routeMenuKey(e, {
    toast,
    requestLock: requestLockNow,
    canResume: () => started && !isLocked() && !anyPanelOpen(),
  })) return;
  // Help float (hold H, works even before Play): shows while held, hides on
  // release (see keyup); the lock is kept throughout so there is no mouse.
  // Repeats while open are consumed above.
  if (isHelpCode(e.code) && !e.repeat && !anyPanelOpen()) { openHelp(); e.preventDefault(); return; }
  if (isDebugCode(e.code) && !e.repeat) { toggleDebug(); return; }
  if (isFlyCode(e.code) && !e.repeat && started && !anyModalOpen()) {
    // No fly toggle while the rocket holds the player (piloting or the
    // landing animation); the parked cabin keeps fly on (no prompt, no
    // takeoff until it is off).
    if (rocketTakesOver()) { e.preventDefault(); return; }
    if (!flyOn) {
      setFly(true);
      cancelHook(false);
    } else {
      setFly(false);
    }
    e.preventDefault();
    return;
  }
  if (isGrappleCode(e.code) && !e.repeat && started && !anyModalOpen() && isLocked()) {
    if (rocketTakesOver()) { e.preventDefault(); return; }
    camera.getWorldDirection(_hookDir);
    if (!fireHookTarget(grapplePick, camera.position, _hookDir)) {
      fireSkyHook(camera.position, _hookDir, scene.fog.far + 40, TNT_SKY_GRAPPLE_MAX, refreshBlocks);
    }
    e.preventDefault();
    return;
  }
  // Cheat travel: Z cycles Overworld -> End -> Nether -> TNT, no portal
  // needed (requires ?cheat=1). Gated like grapple (in game, locked, help
  // closed) plus never mid-build, so a stray keypress can't disturb boot,
  // New World, or a running transition (travelTo no-ops while busy anyway).
  const WORLD_CYCLE = ["over", "end", "nether", "tnt"];
  if (isWorldCycleCode(e.code) && !e.repeat && started && !anyModalOpen() && isLocked() && !building && isCheat()) {
    if (rocketTakesOver()) { e.preventDefault(); return; }
    const at = WORLD_CYCLE.indexOf(dim);
    debugTravelTo(WORLD_CYCLE[(at + 1) % WORLD_CYCLE.length]);
    e.preventDefault();
    return;
  }
  if (isSpeedCycleCode(e.code) && !e.repeat && started && !anyModalOpen() && isLocked() && isCheat()) {
    gameSpeed = GAME_SPEEDS[(GAME_SPEEDS.indexOf(gameSpeed) + 1) % GAME_SPEEDS.length];
    toast(`Speed ×${gameSpeed}`);
    e.preventDefault();
    return;
  }
  // Cheat spawn (requires ?cheat=1): tap B (<250 ms) drops the next
  // selected kind exactly where the mob-release grapple would have ferried
  // it, instantly (no hook flight, no ferry animation). A 250–299 ms hold
  // does nothing; holding B for 0.3 s opens the spawn float instead
  // (centered, unlocked, pausing like a modal), and releasing B closes it
  // keeping the live selection (release = save, never a spawn;
  // Enter/Escape do nothing on the float). Any dimension: each hook owns
  // its dimension rules, and debug mobs roam free until the persistence
  // rule clears them. No spot reads as No spot, like a release that
  // re-holds.
  if (isSpawnPickerCode(e.code) && !e.repeat && started && !anyPanelOpen() && isLocked() && isCheat()) {
    bDown = true;
    bPressT = performance.now();
    if (bHoldTimer) clearTimeout(bHoldTimer);
    bHoldTimer = setTimeout(() => {
      bHoldTimer = 0;
      if (!bDown || anyPanelOpen() || !isCheat() || !started || !isLocked()) return;
      openMobMenu(spawnCatalog(), spawnSelection());
      Object.keys(keys).forEach((k) => { keys[k] = false; });
    }, 300);
    e.preventDefault();
    return;
  }
  // Target debug (requires ?cheat=1): C aims a target, C held expands the
  // selection on the aimed block's face plane, C released arms it, and C
  // again on a mob sends it there. C while a mob walks cancels the target.
  if (isTargetDebugCode(e.code) && !e.repeat && started && !anyModalOpen() && isLocked() && !building && isCheat()) {
    targetDebugKeyDown(camera);
    e.preventDefault();
    return;
  }
  // Mob grab / release (ENTER): empty hands grab the aimed mob through the
  // mob-grab hook kind; holding hands release through the mob-release kind
  // toward the aimed block's face cell. Refusals (busy hook, no aim) fizzle.
  // SHIFT + ENTER never fires: that chord is the rocket takeoff, so
  // launching and grabbing share no input. No release while the rocket
  // takes over (countdown/flight) either: a held mob stays held for the
  // whole trip.
  if (isConfirmCode(e.code) && !e.repeat && started && !anyModalOpen() && isLocked() && !building) {
    const launchChord = isSprint(keys);
    if (!hookActive() && !launchChord) {
      camera.getWorldDirection(_hookDir);
      const held = heldMob();
      if (held) {
        const aim = updateTarget(camera, selectedId());
        if (aim && !rocketTakesOver()) {
          fireHookTarget(
            () => mobReleaseTarget(held, aim.x, aim.y, aim.z, aim.face),
            camera.position, _hookDir, "mob-release");
        }
      } else if (!rocketTakesOver()) {
        // No mob grab while the rocket holds the player (countdown, flight,
        // landing animation — a hook would move a frozen pilot); a hook
        // already out resolves normally.
        fireHookTarget(mobGrabTarget, camera.position, _hookDir, "mob-grab");
      }
    }
    e.preventDefault();
    return;
  }
  keys[e.code] = true;
  keys[e.key] = true;
  if (started) {
    // The hotbar is hidden behind the start menu: the selection freezes
    // with every other input until the menu hides.
    if (isHotbarPrevCode(e.code)) select(selected - 1);
    if (isHotbarNextCode(e.code)) select(selected + 1);
  }
  if (["Space", "Slash", "Tab", "ArrowUp", "ArrowDown"].includes(e.code) || e.key === " ") e.preventDefault();
});

document.addEventListener("keyup", (e) => {
  // Floats first: H/B release closes the matching hold-to-show panel
  // (B keeps the live selection and re-locks; H kept the lock throughout).
  // A consumed release never taps/spawns. Enter/Escape do nothing on floats.
  const floatConsumed = routeMenuKeyUp(e, {
    toast,
    requestLock: requestLockNow,
    canResume: () => started && !isLocked() && !anyPanelOpen(),
  });
  if (isHelpCode(e.code) && floatConsumed) {
    keys[e.code] = false;
    keys[e.key] = false;
    return;
  }
  if (isSpawnPickerCode(e.code) && floatConsumed) {
    if (bHoldTimer) { clearTimeout(bHoldTimer); bHoldTimer = 0; }
    bDown = false;
    keys[e.code] = false;
    keys[e.key] = false;
    if (started && !isLocked() && !anyPanelOpen()) requestLockNow();
    return;
  }
  if (isGrappleCode(e.code) && hookActive()) cancelHook(true);
  if (isConfirmCode(e.code) && hookActive()) cancelHook(true);
  if (isTargetDebugCode(e.code) && isCheat()) targetDebugKeyUp();
  if (isSpawnPickerCode(e.code)) {
    if (bHoldTimer) { clearTimeout(bHoldTimer); bHoldTimer = 0; }
    // The float release above already returned; a quick tap (menu never
    // opened) places the next ticked kind.
    if (bDown && isCheat() && started && isLocked()) {
      const dt = performance.now() - bPressT;
      if (dt < 250) {
        camera.getWorldDirection(_spawnDir);
        const hit = pickBlock(camera.position, _spawnDir, true);
        let mob = null;
        if (hit) {
          const key = nextSpawnKey(spawnSelection(), spawnCatalog());
          // Grapple-equivalent placement, instantly: the shared release
          // resolution on the same aim, then an exact spawn (no hook
          // flight, no ferry animation). Null spot reads as No spot,
          // like a grapple release that re-holds.
          const dims = key ? mobType(key)?.footprint?.() : null;
          if (key && dims) {
            const like = { hw: dims.hw, h: dims.h, alive: true, dim };
            const peers = allMobs().filter((o) => o.alive && (o.dim ?? dim) === dim);
            const spot = mobReleaseSpot(isSolid, dims.hw, dims.h,
              hit.x, hit.y, hit.z, hit.face,
              (x, y, z) => releasePeerFree(peers, like, x, y, z));
            if (spot) {
              const yaw = Math.atan2(_spawnDir.x, _spawnDir.z);
              mob = spawnMobAt(key, {
                scene, dim, x: spot.x, y: spot.y, z: spot.z,
                rand: Math.random, exact: true, yaw,
              });
              if (mob) settleReleased(mob, yaw);
            }
          }
        }
        toast(mob ? `${mobLabel(mob?.type)} spawned${dim === "over" ? "" : ` (${dim})`}` : "No spot");
      }
    }
    bDown = false;
  }
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
  const sdt = dt * gameSpeed;
  noteFrameBudget(now - last); // adaptive drain budgets (120 Hz+ screens)
  last = now;
  // Pause = pointer unlocked (menu) or help open: everything sim and visual
  // freezes; only the loader, the debug readout, and the final render run.
  // The fog reveal is loader, not sim: it advances whenever voxels exist.
  tickReveal(dt);
  // Deferred Play entry: the click only armed pendingPlay — the world is
  // entered on its first rendered frame once the loading gate passes
  // (neighborhood meshed), never into a still-loading world.
  if (pendingPlay && playReady) {
    pendingPlay = false;
    enterGame(renderer);
  }
  const simActive = worldReady && started && !building && isLocked() && !anyMenuOpen();
  updateCamera(0);
  if (!worldReady || !started) {
    highlight.visible = false;
    if (worldReady) updateStreamingFog();
    // Loading sky: the menu shows the world at the spawn altitude, so the
    // background (and the loading fog tinted by it) must read the sky the
    // game is about to open under — black behind the lunar spawn, not the
    // day-blue default. dt 0 freezes the dome like every paused visual:
    // this is loader work, not sim.
    tickSky(scene, camera, sun, hemi, envAir, dimEnv(dim), 0);
    applyRegions(camera.position, scene.background, setRegionFade);
    // Play loading gate: a rebuild (or a fresh boot) resets readiness;
    // otherwise, once the build is done and the shaders compiled, drain the
    // streams behind the menu with big slices, then enter as soon as the
    // visible neighborhood is meshed — far chunks keep converging behind
    // the fog after entry instead of holding Play.
    if (playReady && !worldReady) {
      playReady = false;
      gateT0 = 0;
    } else if (!playReady && worldReady && !building && shadersCompiled) {
      if (gateT0 === 0) gateT0 = now;
      drainCelestial(pos.x, pos.z, BOOT_SLICE_MS, undefined, undefined, undefined, BOOT_DRAIN_MAX);
      drainChunkQueue(false, BOOT_SLICE_MS, pos.x, pos.z);
      // Converged = the visible neighborhood meshed + no celestial builds
      // pending. Far window chunks are excluded on purpose: the closed-in
      // fog and the reveal hide everything past a few chunks at entry, and
      // the fog controller keeps unbuilt distance fogged afterwards — they
      // keep converging in the background instead of holding Play. The Moon
      // underside fill is excluded for the same reason (invisible from the
      // surface spawn; the sync safety net below covers descents).
      const converged = nearestMissingDist(pos.x, camera.position.y, pos.z) > GATE_NEAR_R &&
        celestialPendingSize() === 0;
      if (converged || now - gateT0 > GATE_FALLBACK_MS) {
        playReady = true;
        bootProbe("play-ready");
      }
    }
    const leadB = streamLead();
    const fadeB = vel.length() > 60 ? FADE_CHUNKS_FAST : FADE_CHUNKS;
    maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far, leadB.x, leadB.z, fadeB);
    // Celestial LOD runs at every altitude in moon dims: below the reveal
    // band the region ramps read 0, so proxies stay hidden exactly like the
    // voxel meshes — the legacy ascent look is unchanged, and descending
    // can never freeze a visible proxy behind (opacity is always driven).
    if (worldReady && dimHasMoon(dim)) {
      const leadQ = streamLead();
      tickLod(scene, pos.x, pos.y, pos.z, getSeed(), dt, leadQ.x, leadQ.y, leadQ.z);
    }
    // Voxel streaming joins the mesher here: behind the menu, before play,
    // and every frame after. Gated on worldReady so it never races the
    // boot slice (same reason as the fog line above).
    if (worldReady) tickTntStream(pos.x, pos.y, pos.z, dt, vel.length(), vel.y, queueRefreshBlocks, hookPin());
    tickChunkFades(dt, pos.x, camera.position.y, pos.z, scene.fog.far);
    tickPortalFillFades(dt, pos.x, camera.position.y, pos.z, scene.fog.far);
    proxyCull(simTime);
    renderer.render(scene, camera);
    return;
  }
  // Live rocket boost for the debug HUD: the deep-space multiplier and the
  // resulting cap while flying.
  const _boost = rocketBoostInfo();
  tickDebug(dt, pos.x, pos.y, pos.z,
    _boost ? ` | boost x${_boost.spaceF.toFixed(1)}  cap ${Math.round(_boost.cap)}` : "");
  if (simActive) {
    simTime += sdt;
    tickFx(sdt);
    tickDenseFx(sdt);
    tickReactionFx(simTime);
    // Anticipated DPR dip: a lit mega within 0.6 s of detonation drops to
    // full-low before the blast frame, so the resize hitch never stacks on
    // top of carve + seeding + uploads.
    if (!fxDip && megaImminent()) {
      fxDip = true;
      renderer.setPixelRatio(1);
    }
    tickSnow(sdt, simTime, camera);
    // Frozen while a bridge stroke is held (lamps pop back on release via the
    // forced resync there); blast and countdown lights live in fx/tnt.js.
    if (!chainBridgeActive(chain)) tickPoolLights(sdt, camera);
    tickHookFx(dt);
    // Streaming fog first, so the loader sees the tightened range; dive murk
    // after, restoring the tracked air baseline on resurface.
    updateStreamingFog();
    tickSky(scene, camera, sun, hemi, envAir, dimEnv(dim), simActive ? sdt : 0);
    tickAmbient(simActive ? sdt : 0, simTime, camera, dimSpec(dim)?.ambient);
    setSkyFree(dimHasMoon(dim) && camera.position.y >= skyFreeY());
    applyRegions(camera.position, scene.background, setRegionFade);
    const medium = eyeMediumId(camera.position.x, camera.position.y, camera.position.z);
    tickWaterFog(scene, camera, dt, envAir, medium);
    // Celestial-water eye fog: sheets read fog-free in air (fixed exterior,
    // no black at distance) and fogged while the eye is submerged (classic
    // interior). Transition-only flips; the murk itself is untouched. The
    // Moon reads the moon region, planet waters the planets region.
    const eyeLiquid = medium.type === "liquid" ? medium.liquid : 0;
    const eyeCelestial = (eyeLiquid === MOON_WATER || PLANET_WATERS.includes(eyeLiquid)) ? eyeLiquid : 0;
    if (eyeCelestial !== lastMoonEyeFog) {
      if (lastMoonEyeFog) {
        setLiquidFogOverride(lastMoonEyeFog, false);
        setRegionLiquidFog(lastMoonEyeFog === MOON_WATER ? "moon" : "planets", lastMoonEyeFog, false);
      }
      lastMoonEyeFog = eyeCelestial;
      if (eyeCelestial) {
        setLiquidFogOverride(eyeCelestial, true);
        setRegionLiquidFog(eyeCelestial === MOON_WATER ? "moon" : "planets", eyeCelestial, true);
      }
    }
    // Lava eye fog: sheets read fog-free in air (vivid sea vista at distance)
    // and fogged while the eye is submerged, so the murk — not the cull —
    // hides distant sheets and nothing pops at the cull edge while diving.
    // Only fires inside lava, so overworld water/air paths never reach it.
    // Transition-only flips; the murk itself is untouched.
    const inLava = medium.type === "liquid" && medium.liquid === LAVA;
    if (inLava !== lastLavaEyeFog) {
      lastLavaEyeFog = inLava;
      setLiquidFogOverride(LAVA, inLava);
    }
    // Static pocket colors (airpocket.js, decided at mesh build): trapped air
    // reads the inside color, open air the outside — no per-frame work here.
    // Celestial hotbar: the flower slot becomes glowstone while the reveal
    // shows the sky (Moon or planets band — camera altitude only, wiped or
    // living bodies alike), restoring on hide. The water slot is handled
    // with the aim below: it needs the crosshair hit. Moon dimensions only.
    const skyNow = dimHasMoon(dim) && celestialRevealFactor(camera.position.y) > 0;
    if (skyNow !== skyRevealed) {
      skyRevealed = skyNow;
      const items = getItems();
      if (skyNow) {
        const fi = items.indexOf(FLOWER);
        if (fi >= 0) setItem(fi, GLOWSTONE);
      } else {
        const gi = items.indexOf(GLOWSTONE);
        if (gi >= 0) setItem(gi, FLOWER);
      }
    }
    // Underside safety net: below the moon band the shell must exist now, so
    // descending onto (or under) a fresh moon never meets unbuilt rock.
    // Synchronous and rare (the background fill wins by ~30 s of descent).
    // Moon dimensions only: elsewhere this would stamp moon voxels into
    // the wrong map (the TNT cube sits entirely below the band, so an
    // unguarded check fires every frame there).
    if (dimHasMoon(dim) && !moonReady(getSeed()) && camera.position.y < MOON_MIN_Y - 8) {
      generateMoon(getSeed(), setBlock, getBlock);
      refreshBlocks(moonChunkCenters());
    }
    // Planets stream in the background (sliced), with a synchronous safety
    // net when the player closes in; the lunar fill above is untouched.
    // Moon dimensions only: elsewhere this would stamp sky voxels into
    // the wrong map. In-range bodies render as real voxels, far ones as
    // proxies until the LOD swaps them — so streaming stays the voxel read
    // path at every distance.
    if (dimHasMoon(dim)) {
      tickPlanetStream();
    }
    // Knockback impulse decays every sim frame, whatever mode moves next;
    // the hook pull owns its frame and simply leaves it for afterwards.
    tickRocket(dt);
    tickKnockback(dt);
    const hookOwnsFrame = hookActive() ? updateHook(dt) : false;
    if (!hookOwnsFrame) {
      if (rocketTakesOver()) {
        // Pilot stays pinned by tickRocket; the rocket reads the keys.
      } else if (hookHeldSwim()) updateFreeSwim(dt);
      else if (flyOn) updateFly(dt);
      else updatePlayer(dt);
    }
    // Held-mob pose: pinned in front of the eye every sim frame while held
    // (hook flights position the mob themselves; held is null then), kept
    // at the master held alpha (after displacement-color, which reassigns
    // paintable materials every tick).
    const heldPose = heldMob();
    if (heldPose) {
      camera.getWorldDirection(_hookDir);
      tickHeld(
        { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        { x: _hookDir.x, y: _hookDir.y, z: _hookDir.z },
        player.yaw,
      );
      setMobAlpha(heldPose, HELD_ALPHA);
    }
    // Per-dimension floor, bounded dims only (overworld: below -20 means out
    // of the world, so respawn). respawnY: null (TNT sky) means no floor: the
    // fall never ends. A piloting player never respawns — the rocket dives
    // with no clamp of its own, and thrust can always climb back out.
    const floorY = dimSpec(dim).respawnY;
    if (floorY != null && pos.y < floorY && !rocketFlying()) {
      vel.set(0, 0, 0);
      severHook();
      dropHeldMob();
      spawnPlayer();
    }
    // While a band carves, blast refresh splits: portal frames track only
    // (fills heal from the dirty flag), chunk keys queue for the budgeted
    // remesh drain below — never a synchronous rebuild avalanche.
    tickTNT(sdt, (touched) => {
      if (bandActive()) {
        notePortalFramesOnly(touched);
        queueBlastRefresh(touched);
      } else {
        notePortalEdits(touched);
        refreshBlocks(touched);
      }
      if (touched.length) notifyEndermanVoxelChange(touched, camera, dim);
    }, pos.x, pos.y, pos.z, scene.fog.far);
    tickHomingTnt(sdt, dim);
    tickEndMobs(sdt, camera, dim, {
      mobs: listFarmMobs(),
      player: { x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vz: vel.z },
    });
    tickFarmMobs(sdt, dim);
    // Target debug: the selection follows the aim while C is held, and
    // an active target ends when its plan does (arrival or give-up).
    tickTargetDebug(camera);
    // Riding mobs inherit the hull delta after their own tick ran, so their
    // gravity never pulls them through the moving (voxel-less) hull.
    carryRiders();
    drainBlastRemesh(pos.x, pos.y, pos.z, scene.fog.far);
    // Block reactions (world/reactions.js): advance the running soaks on sim
    // time. Settled cells refresh for their new look, and a liquid standing
    // above is drunk with them; released cells (base broken mid-run) refresh
    // so no stale visual lingers. Same split refresh as the blast path above.
    const react = tickReactions(sdt);
    if (react.settled.length || react.released.length) {
      const touched = [];
      for (const s of react.settled) {
        touched.push([s.x, s.y, s.z]);
        if (s.absorb) {
          setBlock(s.x, s.y + 1, s.z, AIR);
          touched.push([s.x, s.y + 1, s.z]);
          for (const p of purgeFloatingLiquidsAround([[s.x, s.y + 1, s.z]])) touched.push(p);
        }
        for (const c of s.touched) touched.push(c);
      }
      for (const c of react.released) touched.push(c);
      if (bandActive()) {
        notePortalFramesOnly(touched);
        queueBlastRefresh(touched);
      } else {
        notePortalEdits(touched);
        refreshBlocks(touched);
      }
      if (touched.length) notifyEndermanVoxelChange(touched, camera, dim);
    }
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
      megaFlashV = Math.max(0, megaFlashV - sdt / (0.9 * MEGA_BLAST_TIME_SCALE));
      megaVeilV = Math.max(0, megaVeilV - sdt / BLAST_T);
      if (megaFlashEl) {
        megaFlashEl.style.opacity = String(megaFlashV);
        if (megaFlashV <= 0) megaFlashEl.style.display = "none";
      }
      if (megaVeilEl) {
        megaVeilEl.style.opacity = String(megaVeilV);
        if (megaVeilV <= 0) megaVeilEl.style.display = "none";
      }
    }
    tickPortals(sdt, true);
    // No aiming in flight: no highlight, no target (chain strokes are
    // skipped below on the same gate).
    const hit = rocketFlying()
      ? null
      : (rocketEditingBlocked() ? null : updateTarget(camera, selectedId()));
    // Aim box: real voxels only (shouldShowHighlight) — a geometric body
    // pick is empty space, actionable (remote place, grapple, body TNT)
    // but never drawn. A single white box: mineable/buildable at once.
    let showHit = shouldShowHighlight(hit);
    if (showHit) {
      highlight.visible = true;
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      highlight.material.color.setHex(0xffffff);
    } else {
      highlight.visible = false;
    }
    // Celestial water: below the reveal plain water owns the slot; inside
    // the reveal the default is Moon water, and a real aimed voxel takes
    // the water of its Voronoi cell (wiped or living bodies alike — the
    // cells are positional). Geometric-only picks (id AIR) keep the Moon
    // default. Moon dimensions only.
    const revealed = dimHasMoon(dim) && celestialRevealFactor(camera.position.y) > 0;
    const waterTarget = !revealed ? WATER
      : (hit && hit.id !== AIR ? voronoiBodyAt(hit.x, hit.y, hit.z).water : MOON_WATER);
    if (waterTarget !== lastSkyWater) {
      const items = getItems();
      if (waterTarget === WATER) {
        for (const id of CELESTIAL_WATERS) {
          const i = items.indexOf(id);
          if (i >= 0) { setItem(i, WATER); break; }
        }
      } else if (lastSkyWater === WATER) {
        const i = items.indexOf(WATER);
        if (i >= 0) setItem(i, waterTarget);
      } else {
        for (const id of CELESTIAL_WATERS) {
          const i = items.indexOf(id);
          if (i >= 0) { setItem(i, waterTarget); break; }
        }
      }
      lastSkyWater = waterTarget;
    }
    // Hold-chain editing (paint / dig-sweep / still-hold bridge): one tick
    // behind simActive, sim-time only, single batched refresh per frame.
    // Held edits queue (budgeted drain) instead of rebuilding inline, so a
    // max-rate bridge never pays a synchronous rebuildChunk per frame;
    // discrete taps keep the sync path in the mousedown handlers above.
    // Skipped on the same gate as the stroke logic below — idle ticks pay
    // no ctx, no closures, no dedupe set (same gate as chainHoldActive).
    // Celestial pre-warm: aiming at an unbuilt body starts its sliced fill
    // now, so the first grapple (or remote edit) usually finds it built
    // instead of paying the sync fill on click. One body at a time,
    // idempotent, aborts safely — same slicer as the lazy fill. Gated by
    // altitude like the background stream: merely looking at the sky from
    // the ground must never stream every body behind a cloud ultra —
    // explicit grapples and edits still materialize on demand below.
    // The gate is "no real voxel aimed": a far body's pick is truthy
    // (the geometric surface cell) without holding voxels, so the fill
    // must fire on it too — the old `!hit` gate starved it (a not-ready
    // body could never build from aim alone, and remote digs read raw
    // store air).
    if ((!hit || hit.body) && dimHasMoon(dim) && worldReady && !building &&
        camera.position.y >= CELESTIAL_STREAM_Y) {
      camera.getWorldDirection(_hookDir);
      const bh = rayBodyHit(camera.position, _hookDir);
      if (bh && !bodyReady(getSeed(), bh.spec.key)) {
        fillBodyUnder(getSeed(), bh.spec);
      }
    }
    const chaining = !rocketFlying() && chainHoldActive(chain);
    const touched = chaining ? tickChain(chain, dt, {
      camera,
      currentBlock: hit,
      selectedId: selectedId(),
      pick: (eye, dir, skip) => pickBlock(eye, dir, skip) ?? pickCelestialBody(eye, dir),
      // Batched chain writes: per-cell portal/light work is deferred
      // to flushChainBatch below, once per tick over the union of cells;
      // the liquid purge waits for the stroke release (endChainStroke).
      place: (id, x, y, z) => tryPlace(id, x, y, z, { batch: true }) || [],
      breakAt: (x, y, z) => breakBlockAt(x, y, z, { batch: true }),
      getBlock: (x, y, z) => getBlock(x, y, z),
      isOob: (x, y, z) => outOfWorld(x, y, z),
      pos,
      yaw: player.yaw,
    }) : [];
    // Bridge-only suspension: still-hold placements (and streamed chunks
    // alike) build geometry-only; moving strokes keep the full bake.
    const bridge = chainBridgeActive(chain);
    setHaloSuspended(bridge ? GLOW_SUSPENDED : null);
    if (touched.length) {
      flushChainBatch(touched);
      notifyEndermanVoxelChange(touched, camera, dim);
      // Liquid transitions of this stroke (air/liquid→liquid): the mesher
      // rebuilds only chunks whose meshes can change instead of fanning out
      // over the halo range.
      const liquidCells = takeLiquidCells();
      if (chainHoldActive(chain)) {
        // Remember the bridge union for the release tint pass.
        if (bridge) for (const c of touched) bridgeTouchedUnion.push(c);
        queueRefreshBlocks(touched, liquidCells);
        // Remote celestial strokes (planets far past the window): the
        // budgeted drain drops unknown keys, so the same cells ride the
        // prune-exempt celestial queue to a guaranteed mesh.
        if (dimHasMoon(dim)) queueCelestialChunks(touched);
      } else refreshBlocks(touched, liquidCells);
      // Optimistic overlay: drawn this frame in the blocks' own materials,
      // culled as each chunk's real mesh rebuilds (see chainproxy.js).
      proxyNote(touched, simTime);
    }
    // Stroke release (paint and dig alike): the single deferred liquid
    // purge over the whole stroke union. Purged cells join the bridge tint
    // union on a bridge release, else rebuild synchronously like a discrete
    // edit; End notifies match the touched path above.
    if (wasChainHeld && !chainHoldActive(chain)) {
      const purged = endChainStroke();
      if (purged.length) {
        if (purged.length) notifyEndermanVoxelChange(purged, camera, dim);
        notePortalEdits(purged);
        if (wasBridgeHeld && !bridge) for (const c of purged) bridgeTouchedUnion.push(c);
        else refreshBlocks(purged);
      }
    }
    wasChainHeld = chainHoldActive(chain);
    // Bridge release: bake the whole stroke's tint through the budgeted drain
    // (touched union + chunks built under suspension), then resync pools once.
    if (wasBridgeHeld && !bridge) {
      if (bridgeTouchedUnion.length) {
        queueRefreshBlocks(bridgeTouchedUnion);
        if (dimHasMoon(dim)) queueCelestialChunks(bridgeTouchedUnion);
        bridgeTouchedUnion.length = 0;
      }
      queueRefreshKeys(takeSuspendedBuilt());
      notePoolEdit();
    }
    wasBridgeHeld = bridge;
  } else {
    highlight.visible = false;
  }
  // Late camera refresh: the sim above moved the player (rocket pin, hook
  // pull, walk), so the eye re-syncs here — a fast hull no longer outruns
  // the camera for a frame. FOV kick and trauma still run once per frame.
  updateCamera(simActive ? dt : 0);
  updateBossBar();
  if (!isLocked()) chainResetOnUnlock(chain);
  // Suspended while a travel transition owns the loader: streaming around
  // the stale position inside the new dimension's bounds would generate and
  // queue chunks nobody arrives at, and the canvas stays frozen behind the
  // opaque overlay. runTravel drives the mesher itself until the arrival is
  // meshed.
  const leadM = streamLead();
  const fadeM = vel.length() > 60 ? FADE_CHUNKS_FAST : FADE_CHUNKS;
  if (!travelActive) maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far, leadM.x, leadM.z, fadeM);
  if (worldReady && !travelActive && dimHasMoon(dim)) {
    tickLod(scene, pos.x, pos.y, pos.z, getSeed(), dt, leadM.x, leadM.y, leadM.z);
  }
  if (worldReady && !travelActive) tickTntStream(pos.x, pos.y, pos.z, dt, vel.length(), vel.y, queueRefreshBlocks, hookPin());
  tickChunkFades(dt, pos.x, camera.position.y, pos.z, scene.fog.far);
  tickPortalFillFades(dt, pos.x, camera.position.y, pos.z, scene.fog.far);
  proxyCull(simTime);
  if (!travelActive) renderer.render(scene, camera);
}

updateCamera();
requestAnimationFrame(loop);
