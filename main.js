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
import { flyOn, setFly, updateFly } from "./src/player/fly.js";
import { updateTarget, breakTarget, placeAtSelection, breakBlockAt, pickBlock, tryPlace, currentBlock, flushChainBatch, purgeFloatingLiquidsAround, takeLiquidCells, endChainStroke, clearChainStroke } from "./src/player/edit.js";
import { fireHookTarget, fireSkyHook, grapplePick, mobGrabTarget, mobReleaseTarget, cancelHook, severHook, updateHook, hookActive, hookHeldSwim, hookAnchor, tickHookFx, setMobAlpha, HELD_ALPHA } from "./src/player/hook.js";
import { initRope } from "./src/player/rope.js";
import { tickTNT, initTNTFx, resetTNTMemory, clearRegularTntDim, onExplode, onMegaPool, onCrater, onLiquidPurge, shakeSpecFor, bandActive, drainBlastRemesh, queueBlastRefresh, megaImminent, megaCarveActive, megaFxActive, MEGA_BLAST_T, MEGA_BLAST_TIME_SCALE, ultraFxSpec } from "./src/fx/tnt.js";
import { initFx, tickFx, tickDenseFx, denseFxActive, prewarmDenseFx, spawnDense, flushDense, noteDenseSpawn } from "./src/fx/particles.js";
import { initPrecip, tickSnow } from "./src/fx/precip.js";
import { MOON_MIN_Y, MOON_R, generateMoon, generateMoonUnderRows, joinMoonLakeWater, markMoonBuilt, moonReady, moonChunkCenters, findMoonSpawn, isMoonGone } from "./src/world/moon.js";
import { findPenOverwatch } from "./src/world/spawn.js";
import { AIR, WATER, FLOWER, GLOWSTONE, MOON_WATER, LAVA, TNT, BLOCK_INFO } from "./src/core/blocks.js";
import { resetGlowstoneMemory, clearGlowstoneDim, setGlowSeed } from "./src/world/glowstone.js";
import { resetFlowerMemory, clearFlowerDim, setFlowerSeed } from "./src/world/flowers.js";
import { tickReactions, resetReactionMemory, clearReactionsDim } from "./src/world/reactions.js";
import { initReactionFx, tickReactionFx, clearReactionFx } from "./src/render/reactions.js";
import { initPoolLights, tickPoolLights, resetPoolLightMemory, notePoolEdit } from "./src/render/poollights.js";
import { initRenderer, rebuildAll, maybeStream, streamChunks, drainChunkQueue, beginDispose, disposeSome, refreshBlocks, queueRefreshBlocks, queueRefreshKeys, takeSuspendedBuilt, setRegionFade, setRegionLiquidFog, nearestMissingDist, tickChunkFades, UNLOAD_MARGIN } from "./src/render/mesher.js";
import { setHaloSuspended } from "./src/render/halobake.js";
import { initChainProxy, proxyNote, proxyCull, proxyClear } from "./src/render/chainproxy.js";
import { applyRegions, regionByKey } from "./src/render/regions.js";
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
import { CHUNK, renderDist, dim, setDimension, setBlock, getBlock, isSolid, outOfWorld, worlds } from "./src/core/store.js";
import { dimEnv, dimSpec, dimHasMoon, dimHotbar } from "./src/world/dimensions.js";
import { EYE, setFlyStepAllow, updateFreeSwim } from "./src/player/physics.js";
import { setExtraSolid } from "./src/player/physics.js";
import {
  initRocket, resetRocket, tickRocket, rocketTakesOver,
  rocketEditingBlocked, rocketSolidAt, rocketFlying, carryRiders,
  cycleConeSize,
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
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);
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
}

let worldReady = false;
let building = false;
// Play is clickable from the first frame, but entry waits for the first
// rendered world frame: the click only arms this flag (plus a best-effort
// pointer lock while the gesture is fresh), and the loop enters the game
// once voxels exist — never an empty skybox.
let pendingPlay = false;
// Fog reveal progress 0..1 (1 = done): advances per frame once the spawn
// neighborhood exists, never gating movement. Loader-exempt wall clock.
let revealT = 1;
let buildToken = 0;
// DPR-dip state for band wipes (false = full resolution).
let bandDpr = false;
// Moon hotbar state: true while the reveal shows the disc.
let moonRevealed = false;
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
async function buildWorld() {
  if (building) return;
  const token = ++buildToken;
  const aborted = () => token !== buildToken;
  building = true;
  worldReady = false;
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
    moonRevealed = false;
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
  if (dimHasMoon(dim)) fillMoonUnder(getSeed());
  warmupFx(token);
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
      drainChunkQueue(false, TRAVEL_DRAIN_MS);
      await raf();
      // A heavy slice (first-visit volcano chunks) breathes an extra frame
      // instead of stacking another long block right behind it.
      if (performance.now() - tD > TRAVEL_DRAIN_MS * 2) await raf();
    }
    if (!alive()) return;
    // Every fill relights behind the spiral, so its cost never shows.
    scanWorldPortals();
    moonRevealed = false;
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
  if (travelToken === token && dest === "over" && worlds.over.size > 0 && !moonReady(getSeed())) fillMoonUnder(getSeed());
}

// Post-unlock shader warmup: pools enter the scene and compile while the
// player already moves under closed-in fog, so blast #1 never pays
// scene-add + compile + first upload mid-blast and entry never pays it.
async function warmupFx(token) {
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  if (token !== buildToken || !worldReady) return;
  prewarmDenseFx();
  renderer.compile(scene, camera);
  compiledDims.add(dim);
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
      if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady || moonReady(seed)) return;
      generateMoonUnderRows(seed, setBlock, x0, x0 + STEP, getBlock);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady || moonReady(seed)) return;
    joinMoonLakeWater(seed, setBlock, getBlock);
    markMoonBuilt(seed);
    const centers = moonChunkCenters();
    for (let i = 0; i < centers.length; i += 2) {
      if (!dimHasMoon(dim) || getSeed() !== seed || building || !worldReady) return;
      refreshBlocks(centers.slice(i, i + 2));
      await new Promise((r) => requestAnimationFrame(r));
    }
  } finally {
    moonFilling = false;
  }
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
  // Entry itself waits for the first rendered world frame (see loop); the
  // lock is attempted now, while the click gesture is still fresh.
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
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

initHotbarInput(() => false);

document.addEventListener("mousemove", (e) => {
  if (!isLocked() || anyPanelOpen()) return;
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
    if (bt) {
      const changed = breakBlockAt(bt.x, bt.y, bt.z, { eyeY: camera.position.y });
      if (changed.length) {
        refreshBlocks(changed);
        notifyEndermanVoxelChange(changed, camera, dim);
      }
      chainAnchorPush(chain, bt.x, bt.y, bt.z);
    }
  } else if (e.button === 1) {
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
  if (e.button === 1 && hookActive()) cancelHook(true);
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
  if (e.code === "KeyH" && !e.repeat && !anyPanelOpen()) { openHelp(); e.preventDefault(); return; }
  if (e.code === "Equal" && !e.repeat) { toggleDebug(); return; }
  if (e.code === "KeyF" && !e.repeat && started && !anyModalOpen()) {
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
  // The reactor cone size: T cycles how wide and far the engine jets spray.
  if (e.code === "KeyT" && !e.repeat && started && !anyModalOpen() && isLocked()) {
    cycleConeSize();
    e.preventDefault();
    return;
  }
  if (e.code === "KeyG" && !e.repeat && started && !anyModalOpen() && isLocked()) {
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
  if (e.code === "KeyZ" && !e.repeat && started && !anyModalOpen() && isLocked() && !building && isCheat()) {
    if (rocketTakesOver()) { e.preventDefault(); return; }
    const at = WORLD_CYCLE.indexOf(dim);
    debugTravelTo(WORLD_CYCLE[(at + 1) % WORLD_CYCLE.length]);
    e.preventDefault();
    return;
  }
  if (e.code === "KeyV" && !e.repeat && started && !anyModalOpen() && isLocked() && isCheat()) {
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
  if (e.code === "KeyB" && !e.repeat && started && !anyPanelOpen() && isLocked() && isCheat()) {
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
  if (e.code === "KeyC" && !e.repeat && started && !anyModalOpen() && isLocked() && !building && isCheat()) {
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
  if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat && started && !anyModalOpen() && isLocked() && !building) {
    const launchChord = keys["ShiftLeft"] || keys["ShiftRight"] || keys["Shift"];
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
  if (e.code === "KeyK") select(selected - 1);
  if (e.code === "KeyL") select(selected + 1);
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
  if (e.code === "KeyH" && floatConsumed) {
    keys[e.code] = false;
    keys[e.key] = false;
    return;
  }
  if (e.code === "KeyB" && floatConsumed) {
    if (bHoldTimer) { clearTimeout(bHoldTimer); bHoldTimer = 0; }
    bDown = false;
    keys[e.code] = false;
    keys[e.key] = false;
    if (started && !isLocked() && !anyPanelOpen()) requestLockNow();
    return;
  }
  if (e.code === "KeyG" && hookActive()) cancelHook(true);
  if ((e.code === "Enter" || e.code === "NumpadEnter") && hookActive()) cancelHook(true);
  if (e.code === "KeyC" && isCheat()) targetDebugKeyUp();
  if (e.code === "KeyB") {
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
  last = now;
  // Pause = pointer unlocked (menu) or help open: everything sim and visual
  // freezes; only the loader, the debug readout, and the final render run.
  // The fog reveal is loader, not sim: it advances whenever voxels exist.
  tickReveal(dt);
  // Deferred Play entry: the click only armed pendingPlay, and this frame
  // renders voxels — so the world is entered on its first rendered frame.
  if (pendingPlay && worldReady) {
    pendingPlay = false;
    enterGame(renderer);
  }
  const simActive = worldReady && started && !building && isLocked() && !anyMenuOpen();
  updateCamera(simActive ? dt : 0);
  if (!worldReady || !started) {
    highlight.visible = false;
    if (worldReady) updateStreamingFog();
    maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far);
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
  tickDebug(dt, pos.x, pos.y, pos.z);
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
    applyRegions(camera.position, scene.background, setRegionFade);
    const medium = eyeMediumId(camera.position.x, camera.position.y, camera.position.z);
    tickWaterFog(scene, camera, dt, envAir, medium);
    // Moon-water eye fog: sheets read fog-free in air (fixed exterior, no
    // black at distance) and fogged while the eye is submerged (classic
    // interior). Transition-only flips; the murk itself is untouched.
    const inMoonWater = medium.type === "liquid" && medium.liquid === MOON_WATER;
    if (inMoonWater !== lastMoonEyeFog) {
      lastMoonEyeFog = inMoonWater;
      setLiquidFogOverride(MOON_WATER, inMoonWater);
      setRegionLiquidFog("moon", MOON_WATER, inMoonWater);
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
    // Moon hotbar: while the reveal shows the disc the water slot becomes
    // moon water and the flower slot becomes glowstone; both restore when
    // the moon hides again — or when no lunar block survives (the bar dies
    // with the moon, like the snow and the low gravity). Follows the region
    // factor (not a duplicated threshold), so the bar and the disc always
    // agree. Moon dimensions only.
    const moonNow = dimHasMoon(dim) && !isMoonGone() && regionByKey("moon").factor(camera.position) > 0;
    if (moonNow !== moonRevealed) {
      moonRevealed = moonNow;
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
    // Moon dimensions only: elsewhere this would stamp moon voxels into
    // the wrong map (the TNT cube sits entirely below the band, so an
    // unguarded check fires every frame there).
    if (dimHasMoon(dim) && !moonReady(getSeed()) && camera.position.y < MOON_MIN_Y - 8) {
      generateMoon(getSeed(), setBlock, getBlock);
      refreshBlocks(moonChunkCenters());
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
    // fall never ends.
    const floorY = dimSpec(dim).respawnY;
    if (floorY != null && pos.y < floorY) {
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
    let showHit = !!hit;
    if (showHit) {
      highlight.visible = true;
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      highlight.visible = false;
    }
    // Hold-chain editing (paint / dig-sweep / still-hold bridge): one tick
    // behind simActive, sim-time only, single batched refresh per frame.
    // Held edits queue (budgeted drain) instead of rebuilding inline, so a
    // max-rate bridge never pays a synchronous rebuildChunk per frame;
    // discrete taps keep the sync path in the mousedown handlers above.
    // Skipped in flight (no editing or aiming there at all).
    const touched = rocketFlying() ? [] : tickChain(chain, dt, {
      camera,
      currentBlock: hit,
      selectedId: selectedId(),
      pick: (eye, dir, skip) => pickBlock(eye, dir, skip),
      // Batched chain writes: per-cell portal/light work is deferred
      // to flushChainBatch below, once per tick over the union of cells;
      // the liquid purge waits for the stroke release (endChainStroke).
      place: (id, x, y, z) => tryPlace(id, x, y, z, { batch: true }) || [],
      breakAt: (x, y, z) => breakBlockAt(x, y, z, { batch: true }),
      getBlock: (x, y, z) => getBlock(x, y, z),
      isOob: (x, y, z) => outOfWorld(x, y, z),
      pos,
      yaw: player.yaw,
    });
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
        bridgeTouchedUnion.length = 0;
      }
      queueRefreshKeys(takeSuspendedBuilt());
      notePoolEdit();
    }
    wasBridgeHeld = bridge;
  } else {
    highlight.visible = false;
  }
  updateBossBar();
  if (!isLocked()) chainResetOnUnlock(chain);
  // Suspended while a travel transition owns the loader: streaming around
  // the stale position inside the new dimension's bounds would generate and
  // queue chunks nobody arrives at, and the canvas stays frozen behind the
  // opaque overlay. runTravel drives the mesher itself until the arrival is
  // meshed.
  if (!travelActive) maybeStream(pos.x, pos.z, camera.position.y, scene.fog.near, scene.fog.far);
  if (worldReady && !travelActive) tickTntStream(pos.x, pos.y, pos.z, dt, vel.length(), vel.y, queueRefreshBlocks, hookPin());
  tickChunkFades(dt, pos.x, camera.position.y, pos.z, scene.fog.far);
  tickPortalFillFades(dt, pos.x, camera.position.y, pos.z, scene.fog.far);
  proxyCull(simTime);
  if (!travelActive) renderer.render(scene, camera);
}

updateCamera();
requestAnimationFrame(loop);

// ?test=1 instrumentation hooks (tests/browser/mobs/hook.js + fx/hook.js):
// 1-wide path rigs + deterministic mob traces, reactor-cone probe.
// Dynamic imports, inert unless the param is set — no game behavior changes.
if (new URLSearchParams(location.search).get("test") === "1") {
  import("./tests/browser/mobs/hook.js").then((m) =>
    m.initTest({ scene, worldReady: () => worldReady }));
  import("./tests/browser/fx/hook.js").then((m) => m.initFxProbe());
}
