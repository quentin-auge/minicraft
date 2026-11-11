// Piloted rocket runtime: boarding snapshots the live hull box into a
// moving instanced model (fading the hull so the pilot sees through it),
// the pilot stays pinned at the cabin stand, and landing stamps the riding
// set back into the voxel store. Only upward travel carves terrain; descents
// land on it. Registered in the vehicle registry (carriesMobs: true):
// overlapping farm mobs ride along and fade with the hull.
import * as THREE from "three";
import {
  AIR, GLASS, GLOWSTONE, FLOWER, THRUSTER, BLOCK_INFO, isLiquid, isTntLike,
} from "../core/blocks.js";
import {
  dim, getBlock, setBlock, isSolid, isCellProtected, protectCell,
  unprotectCell, WORLD_RADIUS, key,
} from "../core/store.js";
import { materialsFor } from "../core/textures.js";
import { ROCKET_SPEC, rocketSite, RIDE_BOX as RIDE, rideBoardable, partitionStampCells } from "../world/rocketpad.js";
import { registerVehicleType } from "./registry.js";
import {
  pos, vel, keys, yaw, pitch, setOnGround,
} from "../player/physics.js";
import { FLY, flyOn } from "../player/fly.js";
import { clearGlowstoneAt, noteGlowstonePlace, noteGlowstonePlaceShared, glowVariantAt } from "../world/glowstone.js";
import { MOON_MIN_Y, markMoonDirty } from "../world/moon.js";
import { clearFlowerAt, noteFlowerPlace } from "../world/flowers.js";
import { clearReactionAt } from "../world/reactions.js";
import { clearTNTBox } from "../fx/tnt.js";
import { notePortalEdits, toast } from "../world/portals.js";
import { severHook } from "../player/hook.js";
import { refreshBlocks, queueRefreshBlocks } from "../render/mesher.js";
import { ORDERS } from "../render/orders.js";
import { exposedFaces, speedFactor, countdownFactor, fxScale, nextConeSize, ROCKET_FX_CONE_SIZES, ROCKET_FX_DEFAULT_CONE } from "../fx/rocketfx.js";
import { playFx } from "../fx/rocketimpact.js";
import { dimTntTiersUnlocked } from "../world/dimensions.js";
import { isTntTierUnlocked } from "../world/tntunlock.js";
import { villageFrames } from "../world/village.js";
import { listFarmMobs } from "../mobs/farm.js";
import { isCarried, staysHullPinned } from "../mobs/carry.js";

registerVehicleType({ key: "rocket", name: "Rocket", carriesMobs: true });

const COUNTDOWN = 3.0;
const FADE_TIME = 2.5;
const LANDING_FADE = 0.5;
// Settle freeze after the landing fade: no FX, the pilot stays pinned
// until the camera has stabilized (fade + trauma tail + margin).
const LANDING_SETTLE = 0.6;
// The camera-trauma decay in main.js, named so the tracked shake rates
// below mirror it instead of hardcoding it twice. Mirror with main.js
// `camTrauma` decay if that ever changes.
const TRAUMA_DECAY = 1.4;
// The tremor adds trauma at the tracking rate (decay x tick cadence) so
// the camera follows the ramp instead of pinning at the cap early.
const TREMOR_TRACK = TRAUMA_DECAY * 0.12;
const ACCEL = 26;
// Liftoff burn: the old instant 5.2 kick as a real 0.2 s push at ACCEL, so
// the exhaust burns exactly while the hull accelerates off the pad.
const LAUNCH_BURN = 0.2;
// Thrust level glide rate: the exhaust ramps instead of popping.
const THRUST_RAMP = 8;
const MAX_SPEED = FLY * 3;
const BOOST_SPEED = FLY * 6;
const H_SMOOTH = 8;
const BOOST_RAMP = 3;
const CARVE_MAX = 2400;
// Impact FX budget per frame: the surfaces the rocket tears open, sampled so
// every side of the swept shaft keeps a share.
const CARVE_FACE_BUDGET = 24;
const CARVE_FACE_FRAME_CAP = 48;
// The hull's own rock dust starts once the carve has torn this many cells:
// below it the dust would be more noise than the blast it follows.
const CARVE_DUST_MIN_CELLS = 6;
// Camera shake for the rocket's beats. The ignition kick lands once, the
// tremor and the touchdown shake both come out of the landing curve, so
// they always match the cloud of that moment (see src/fx/rocketfx.js).
// The burn keeps a low rumble.
const SHAKE = {
  ignition: 0.03,
  burn: 0.02,
};

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
// Thruster exhaust: particles only, no flame meshes — the push reads as an
// ember jet plus grey smoke streaming down under the nozzles. The pilot
// sees the jet through the faded hull (foreground embers) and from outside
// (depth-tested smoke).
// See-through moving hull: one cloned material set per block id, used for
// the whole fade in both directions — no opaque/transparent swap, so the
// fade stays continuous at the 100 % opaque ends.
const movingMatCache = new Map();
function movingMatsFor(id) {
  let m = movingMatCache.get(id);
  if (!m) {
    m = materialsFor(id).map((src) => {
      const c = src.clone();
      c.transparent = true;
      // Depth writes stay on for every solid id: at opacity == base the model
      // reads exactly like the opaque voxels it replaces, so installing or
      // removing the transparent set causes no pop at either fade end. Glass
      // keeps its source depthless path: it is a window, not an occluder, so
      // the world behind it (liquids included) still composites through.
      c.depthWrite = src.depthWrite ?? true;
      c.userData.baseOpacity = src.opacity ?? 1;
      c.userData.fadeOpacity = Math.min(c.userData.baseOpacity, 0.5);
      c.opacity = c.userData.baseOpacity;
      return c;
    });
    movingMatCache.set(id, m);
  }
  return m;
}

let sceneRef = null;
let shakeFn = null;
let promptEl = null;
let countdownEl = null;
let promptText = "";

let phase = "parked"; // parked | countdown | flight | landing
// The reactor cone size the player picked (T).
let coneSize = ROCKET_FX_DEFAULT_CONE;
let piloting = false;
let siteVersion = -1;
let countdown = 0;
let landingT = 0;
let exhaustT = 0;
// The touchdown factor of the last landing: the fade replays the takeoff's
// smoke and tremor scaled by it, so the landing always lands as hard as it
// hit.
let landingT0 = 0;
// The touchdown's shake input, on the non-boost cap: at FLY x 3 and above
// the shake reads full takeoff violence, below it scales linearly. The
// cloud keeps the boosted cap (landingT0), so a max-boost drop looks
// bigger while shaking the same.
let shakeT0 = 0;
let thrustLevel = 0;
let brakeLevel = 0;
let launchBurn = 0;
let plumeT = 0;
let hullFade = 0;
// Fade segments, consumed in order: { from, to, t, dur, ease? }. The
// countdown runs an accelerating 1 s phase (`ease: "in"`) then a linear 1 s
// phase; solo tweens (landing, cancel) enqueue one segment.
const COUNTDOWN_FADE = [
  { to: 0.5, dur: 1.0, ease: "in" },
  { to: 1, dur: 1.0 },
];
let fadeSegs = [];
let boostF = 0;
// A new launch needs the chord released first: a pilot who never lets go of
// SHIFT+ENTER must not relaunch the rocket the instant a landing animation
// ends.
let takeoffArmed = true;
let dockedCells = [];
let landingTarget = new THREE.Vector3();

const origin = new THREE.Vector3();
const rvel = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _hv = new THREE.Vector3();

let moving = null; // { group, solid, cells, meshes }
let movingBuiltVersion = -1;
// Riding voxel set: local cells + ids (+ glowstone variant) that travel
// with the hull and stamp back on landing. Scanned from the parked box at
// liftoff ({extra:false}), flight placements append ({extra:true}).
let modelCells = [];
// Riding mobs: mob -> [{mesh, orig}] cloned materials for the shared fade.
const riders = new Map();

export function initRocket(scene, addShake) {
  sceneRef = scene;
  shakeFn = addShake;
  promptEl = document.getElementById("rocketPrompt");
  countdownEl = document.getElementById("rocketCountdown");
  resetRocket();
}

export function resetRocket() {
  releaseDockedProtection();
  removeMoving();
  releaseAllRiders();
  modelCells = [];
  phase = "parked";
  piloting = false;
  countdown = 0;
  landingT = 0;
  landingT0 = 0;
  shakeT0 = 0;
  thrustLevel = 0;
  brakeLevel = 0;
  launchBurn = 0;
  plumeT = 0;
  takeoffArmed = true;
  hullFade = 0;
  clearFade();
  rvel.set(0, 0, 0);
  siteVersion = -1;
  landingTarget.set(0, 0, 0);
  if (rocketSite.placed) origin.set(rocketSite.origin.x, rocketSite.origin.y, rocketSite.origin.z);
  setPrompt("");
  updateCountdown();
}

function shake(a) { if (shakeFn) shakeFn(a); }

// The tuned shake gains, baked in: tremor 3, liftoff 1, touchdown 3,
// fade 1. One table, read by the helpers below — no live knobs.
const SHAKE_GAIN = { tremor: 3, liftoff: 1, touchdown: 3, fade: 1 };

// A tracked add: the equilibrium follows the landing-curve value through
// the decay, so the camera rides the ramp instead of pinning at the cap.
// Tick form (decay x cadence) for the 0.12 s loops, frame form (decay x
// dt) for per-frame adds, thump form for one-shots.
function shakeTick(factor, knob) {
  shake((fxScale("landing", factor).shake ?? 0) * TREMOR_TRACK * SHAKE_GAIN[knob]);
}
function shakeFrame(factor, knob, dt) {
  shake((fxScale("landing", factor).shake ?? 0) * TRAUMA_DECAY * dt * SHAKE_GAIN[knob]);
}
function shakeThump(factor, knob) {
  shake((fxScale("landing", factor).shake ?? 0) * SHAKE_GAIN[knob]);
}

// Cycle the reactor cone size and say which one is now in use.
export function cycleConeSize() {
  coneSize = nextConeSize(coneSize);
  toast("Cone width: " + (ROCKET_FX_CONE_SIZES[coneSize]?.label ?? coneSize));
}

function fadeHull(to, duration = FADE_TIME, ease = undefined) {
  fadeSegs = [{ from: hullFade, to, t: 0, dur: duration, ease }];
}

function clearFade() {
  fadeSegs = [];
}

function tickHullFade(dt) {
  if (!fadeSegs.length) return;
  const s = fadeSegs[0];
  s.t += dt;
  const k = Math.min(1, s.t / s.dur);
  const ke = s.ease === "in" ? k * k : k;
  hullFade = s.from + (s.to - s.from) * ke;
  if (k >= 1) {
    hullFade = s.to;
    fadeSegs.shift();
  }
}

function removeMoving() {
  if (moving?.group && sceneRef) sceneRef.remove(moving.group);
  moving = null;
  movingBuiltVersion = -1;
}

function releaseDockedProtection() {
  for (const [x, y, z] of dockedCells) unprotectCell(x, y, z);
  dockedCells = [];
}

function syncSite() {
  if (!rocketSite.placed) return false;
  if (siteVersion === rocketSite.version) return true;
  releaseDockedProtection();
  removeMoving();
  phase = "parked";
  piloting = false;
  rvel.set(0, 0, 0);
  thrustLevel = 0;
  brakeLevel = 0;
  countdown = 0;
  hullFade = 0;
  clearFade();
  origin.set(rocketSite.origin.x, rocketSite.origin.y, rocketSite.origin.z);
  siteVersion = rocketSite.version;
  // Prebuild the moving hull hidden at the parked spot: liftoff then only
  // clears voxels and unhides, so holding ENTER never hitches on model
  // creation.
  modelCells = layout().cells.map((c) => ({ lx: c.x, ly: c.y, lz: c.z, id: c.id, v: -1, extra: false }));
  buildMoving(modelCells);
  movingBuiltVersion = siteVersion;
  if (moving?.group) moving.group.visible = false;
  return true;
}

function layout() {
  return rocketSite.grid;
}

// The rocket holds the player for the whole sequence: the countdown, the
// flight, and the landing animation — during the touchdown the pilot stays
// pinned until the hull has finished fading out, so plain walk physics
// never runs and nothing can walk away mid-sequence.
export function rocketTakesOver() {
  return (piloting && (phase === "countdown" || phase === "flight")) || phase === "landing";
}

export function rocketInsidePlayer() {
  if (!rocketSite.placed || dim !== "over") return false;
  const g = layout();
  if (!g) return false;
  const c = g.cabin;
  const lx = pos.x - origin.x;
  const ly = pos.y - origin.y;
  const lz = pos.z - origin.z;
  return lx > c.x0 - 0.31 && lx < c.x1 + 1.31 &&
         lz > c.z0 - 0.31 && lz < c.z1 + 1.31 &&
         ly > c.y0 - 0.8 && ly < c.y1 + 1.2;
}

export function rocketEditingBlocked() {
  // Only the transitional phases block edits: parked voxels edit normally
  // (the liftoff scan picks them up). Flight edits nothing (see main.js).
  return phase === "countdown" || phase === "landing";
}

export function rocketFlying() {
  return piloting && phase === "flight";
}

// Extra collider consulted by physics while the hull is out of the store.
// Cabin air is never in the set, so the pilot and walkers pass inside.
export function rocketSolidAt(bx, by, bz) {
  if (!moving || dim !== "over" || phase === "parked") return false;
  const lx = Math.floor(bx + 0.5 - origin.x);
  const ly = Math.floor(by + 0.5 - origin.y);
  const lz = Math.floor(bz + 0.5 - origin.z);
  if (lx < RIDE.x0 || lx > RIDE.x1 || ly < RIDE.y0 || ly > RIDE.y1 || lz < RIDE.z0 || lz > RIDE.z1) return false;
  return moving.solid.has(lx + "," + ly + "," + lz);
}

function modelHas(lx, ly, lz) {
  return moving ? moving.solid.has(lx + "," + ly + "," + lz) : false;
}

function modelCellAt(lx, ly, lz) {
  return modelCells.find((c) => c.lx === lx && c.ly === ly && c.lz === lz) ?? null;
}

// Ray vs one unit hull cell. Returns the entry distance and outward face.
function rayHullCell(o, d, x0, y0, z0, maxDist) {
  let tmin = 0, tmax = maxDist;
  const face = [0, 0, 0];
  const lo = [x0, y0, z0], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (dd[i] === 0) {
      if (oo[i] < lo[i] || oo[i] > lo[i] + 1) return null;
      continue;
    }
    let t1 = (lo[i] - oo[i]) / dd[i];
    let t2 = (lo[i] + 1 - oo[i]) / dd[i];
    let f = dd[i] > 0 ? -1 : 1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; f = -f; }
    if (t1 > tmin) { tmin = t1; face[0] = 0; face[1] = 0; face[2] = 0; face[i] = f; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0.001) return null;
  return { t: tmin, face };
}

// Aim hit on the moving hull (dormant: flight editing is disabled, the
// main loop never aims in flight): world cell + face shaped like an
// edit.js pick, plus the riding local cell.
export function rocketAimHit(o, d, maxDist = 64) {
  if (!rocketFlying() || !moving) return null;
  let best = null;
  for (const c of modelCells) {
    const hit = rayHullCell(o, d, origin.x + c.lx, origin.y + c.ly, origin.z + c.lz, maxDist);
    if (!hit) continue;
    if (!best || hit.t < best.t) best = { ...hit, cell: c };
  }
  if (!best) return null;
  return {
    x: Math.floor(origin.x + best.cell.lx + 0.5),
    y: Math.floor(origin.y + best.cell.ly + 0.5),
    z: Math.floor(origin.z + best.cell.lz + 0.5),
    face: best.face, dist: best.t, _cell: best.cell,
  };
}

// Place a block onto the flying hull (dormant: flight editing is disabled,
// the main loop never calls this in flight): it joins the riding set,
// renders in the model, fades with it, and stamps back on landing.
// Structure cells themselves are never editable in flight.
export function rocketPlaceExtra(hit, id) {
  if (!rocketFlying() || !hit?._cell) return false;
  const info = BLOCK_INFO[id];
  if (!info?.placeable || isLiquid(id)) return false;
  if (isTntLike(id) && !dimTntTiersUnlocked(dim) && !isTntTierUnlocked(id)) return false;
  const nlx = hit._cell.lx + hit.face[0];
  const nly = hit._cell.ly + hit.face[1];
  const nlz = hit._cell.lz + hit.face[2];
  if (nlx < RIDE.x0 || nlx > RIDE.x1 || nly < RIDE.y0 || nly > RIDE.y1 || nlz < RIDE.z0 || nlz > RIDE.z1) return false;
  if (modelHas(nlx, nly, nlz)) return false;
  const wx = Math.floor(origin.x) + nlx, wy = Math.floor(origin.y) + nly, wz = Math.floor(origin.z) + nlz;
  if (getBlock(wx, wy, wz) !== AIR) return false;
  modelCells.push({ lx: nlx, ly: nly, lz: nlz, id, v: -1, extra: true });
  buildMoving(modelCells);
  movingBuiltVersion = siteVersion;
  if (moving?.group) moving.group.visible = true;
  return true;
}

export function rocketBreakExtra(hit) {
  if (!rocketFlying() || !hit?._cell) return false;
  const idx = modelCells.indexOf(hit._cell);
  if (idx < 0 || !hit._cell.extra) return false;
  modelCells.splice(idx, 1);
  buildMoving(modelCells);
  movingBuiltVersion = siteVersion;
  if (moving?.group) moving.group.visible = true;
  return true;
}

// --- mob riders -------------------------------------------------------------
// Farm mobs overlapping the moving hull ride it: frozen statues pinned at
// their exact boarding spot relative to the hull (no self-motion at all —
// the mover tick is skipped for riders, so nothing can drift them or wedge
// them into a wall). Their cloned materials fade with the hull and restore
// on release.
function rideFade(mob) {
  const op = 1 - hullFade * 0.5;
  for (const [mesh] of riders.get(mob) ?? []) mesh.material.opacity = op;
}

function ride(mob) {
  if (!riders.has(mob)) {
    // Pin relative to the hull: this offset never changes until landing,
    // so the mob resumes exactly where it boarded.
    mob._riding = true;
    mob._rideLocal = mob.pos.clone().sub(origin);
    mob._rideYaw = mob.yaw;
    mob.vel.set(0, 0, 0);
    mob.target = null;
    mob.wanderT = Infinity;
    mob.yawTarget = mob.yaw;
    // Neutral pose: frozen mid-stride limbs read as motion, so park them.
    const ud = mob.root?.userData;
    for (const l of ud?.legs ?? []) l.pivot.rotation.x = 0;
    if (ud?.tailGroup) ud.tailGroup.rotation.y = 0;
    const pairs = [];
    mob.root.traverse((o) => {
      if (o.isMesh) {
        const c = o.material.clone();
        c.transparent = true;
        pairs.push([o, o.material, c]);
        o.material = c;
      }
    });
    riders.set(mob, pairs);
  }
  rideFade(mob);
}

function unride(mob) {
  const pairs = riders.get(mob);
  if (!pairs) return;
  for (const [mesh, orig, clone] of pairs) {
    mesh.material = orig;
    clone.dispose();
  }
  riders.delete(mob);
  delete mob._riding;
  delete mob._rideLocal;
  delete mob._rideYaw;
  // Resume wandering on the next tick.
  mob.wanderT = 0;
}

function releaseAllRiders() {
  for (const [mob] of riders) unride(mob);
}

export function carryRiders() {
  if (dim !== "over" || !moving || phase === "parked") {
    if (riders.size) releaseAllRiders();
    return;
  }
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const seen = new Set();
  for (const mob of listFarmMobs()) {
    if (mob.dim !== "over" || !mob.alive) continue;
    if (riders.has(mob)) {
      // Grab-hold wins over hull-pin: a rider that gets grabbed is
      // released to the hold pose (the hook owns its frame from the
      // latch on), so a held mob is never fought over mid-trip.
      if (!staysHullPinned(mob)) { unride(mob); continue; }
      // Pinned: exact boarding spot, frozen heading, vel already zero.
      seen.add(mob);
      mob.pos.set(ox + mob._rideLocal.x, oy + mob._rideLocal.y, oz + mob._rideLocal.z);
      mob.yaw = mob._rideYaw;
      mob.yawTarget = mob._rideYaw;
      mob.root.rotation.y = mob._rideYaw;
      rideFade(mob);
      continue;
    }
    // Hook-owned mobs never board a hull: the hold pose (not the hull
    // pin) owns their frame for the whole trip.
    if (isCarried(mob)) continue;
    // Boarding check: mobs are 1 wide, so the feet cell must be air —
    // a solid feet cell means hull wall, and the mob stays behind.
    const lx = Math.floor(mob.pos.x - ox), ly = Math.floor(mob.pos.y - oy), lz = Math.floor(mob.pos.z - oz);
    if (!rideBoardable(lx, ly, lz, moving.solid)) continue;
    seen.add(mob);
    ride(mob);
    // Frozen for the ride: no self-propulsion (restored to a fresh wander
    // on release).
    mob.vel.set(0, 0, 0);
    mob.target = null;
    mob.wanderT = Infinity;
    mob.yawTarget = mob.yaw;
  }
  for (const [mob] of riders) if (!seen.has(mob)) unride(mob);
}

function holdTakeoff() {
  // Takeoff chord: SHIFT + ENTER held, never in fly mode. The chord never
  // fires the grab hook (main.js skips ENTER fire while Shift is down), so
  // launching and grabbing share no input.
  return chordHeld() && !flyOn;
}

// The launch chord itself, ignoring the fly-mode veto.
function chordHeld() {
  const shift = keys["ShiftLeft"] || keys["ShiftRight"] || keys["Shift"];
  const enter = keys["Enter"] || keys["NumpadEnter"];
  return !!shift && !!enter;
}

function placeAtStand() {
  const g = layout();
  if (!g) return;
  const st = g.stand;
  pos.set(origin.x + st.x + 0.5, origin.y + 1.001, origin.z + st.z + 0.5);
  vel.set(0, 0, 0);
}

function pinPilot() {
  placeAtStand();
  setOnGround(false);
}

function setPrompt(t) {
  if (t === promptText) return;
  promptText = t;
  if (!promptEl) return;
  promptEl.textContent = t;
  promptEl.style.display = t ? "block" : "none";
}

function updatePrompt() {
  let t = "";
  if (!piloting && !flyOn && dim === "over" && rocketSite.placed && phase === "parked" && rocketInsidePlayer()) {
    t = "Hold SHIFT + ENTER to take off";
  }
  setPrompt(t);
}

function updateCountdown() {
  if (!countdownEl) return;
  if (phase === "countdown") {
    countdownEl.style.display = "block";
    countdownEl.textContent = String(Math.max(1, Math.ceil(countdown)));
  } else {
    countdownEl.style.display = "none";
  }
}

export function tickRocket(dt) {
  if (dim !== "over") {
    if (piloting) piloting = false;
    releaseDockedProtection();
    if (moving?.group) moving.group.visible = false;
    countdown = 0;
  thrustLevel = 0;
  brakeLevel = 0;
  hullFade = 0;
  boostF = 0;
  clearFade();
    setPrompt("");
    updateCountdown();
    // Leaving the dimension drops any pending wall impacts.
    carveFaces.length = 0;
    return;
  }
  if (!syncSite()) {
    setPrompt("");
    updateCountdown();
    carveFaces.length = 0;
    return;
  }
  if (moving?.group) moving.group.visible = phase !== "parked";
  // The launch chord re-arms the moment it is released (see takeoffArmed).
  if (!chordHeld()) takeoffArmed = true;
  if (phase === "parked") {
    if (rocketInsidePlayer()) {
      // Fly mode stays on inside the cabin: no prompt and no takeoff
      // while it is, takeoff only once it is off.
      if (takeoffArmed && holdTakeoff()) startCountdown();
    }
  } else if (phase === "countdown") tickCountdown(dt);
  else if (phase === "flight") tickFlight(dt);
  else if (phase === "landing") tickLanding(dt);
  tickHullFade(dt);
  applyHullFade();
  updatePrompt();
  updateCountdown();
  flushCarveFaces();
}

// One batched blast per frame over the walls the ascent tore open.
function flushCarveFaces() {
  if (!carveFaces.length) return;
  const faces = carveFaces;
  carveFaces = [];
  // The blast grows with the speed the hull carries: a slow bore throws
  // pebbles, a max-speed dive throws a wall of debris.
  playFx("impact", { faces, factor: speedFactor(rvel.length(), BOOST_SPEED) });
}

function startCountdown() {
  severHook();
  snapshot();
  piloting = true;
  phase = "countdown";
  countdown = COUNTDOWN;
  // Board riders now, at their exact standing spots: the snapshot just
  // cleared the cabin floor, and the mobs' own tick runs later this frame —
  // a first falling tick (deep at high sim speed) would drop their feet
  // into the voxel-less floor row, which reads solid and refuses boarding
  // forever, sinking them through the floor while the rocket leaves.
  carryRiders();
  exhaustT = 0;
  thrustLevel = 0;
  brakeLevel = 0;
  launchBurn = 0;
  plumeT = 0;
  hullFade = 0;
  fadeSegs = [
    { from: 0, to: COUNTDOWN_FADE[0].to, t: 0, dur: COUNTDOWN_FADE[0].dur, ease: COUNTDOWN_FADE[0].ease },
    { from: COUNTDOWN_FADE[0].to, to: COUNTDOWN_FADE[1].to, t: 0, dur: COUNTDOWN_FADE[1].dur },
  ];
  pinPilot();
  shake(SHAKE.ignition);
}

function cancelCountdown() {
  phase = "parked";
  piloting = false;
  countdown = 0;
  exhaustT = 0;
  thrustLevel = 0;
  brakeLevel = 0;
  launchBurn = 0;
  plumeT = 0;
  hullFade = 0;
  clearFade();
  stamp();
}

function tickCountdown(dt) {
  if (!piloting || !holdTakeoff()) {
    cancelCountdown();
    return;
  }
  pinPilot();
  // The engines spool up instead of popping on.
  thrustLevel += (1 - thrustLevel) * Math.min(1, THRUST_RAMP * dt);
  countdown -= dt;
  // The ignition tremor: progressive over the whole countdown, ramping to
  // the landing violence at liftoff (the takeoff thump reads the same
  // curve input as a max non-boost touchdown). Adds are tracked so the
  // camera follows the ramp instead of pinning at the cap early; the
  // liftoff thump lands on top.
  const progress = Math.min(1, 1 - Math.max(0, countdown) / COUNTDOWN);
  exhaustT -= dt;
  if (exhaustT <= 0) {
    exhaustT = 0.12;
    spawnExhaust();
    spawnCountdownSmoke(progress);
    shakeTick(countdownFactor(progress), "tremor");
  }
  if (countdown <= 0) {
    releaseDockedProtection();
    phase = "flight";
    countdown = 0;
    hullFade = 1;
    clearFade();
    // Liftoff hits with the touchdown cloud at factor 1 plus its shake —
    // the same curve input as a max-speed non-boost touchdown.
    launchBurn = LAUNCH_BURN;
    plumeT = 0;
    rvel.set(0, 0, 0);
    // The touchdown cloud at factor 1; the thump below reads the same
    // curve input the cloud was built with.
    landingDust(BOOST_SPEED);
    shakeThump(1, "liftoff");
  }
}

// Nozzle world positions, just under the hull: shared by the exhaust,
// the countdown smoke and the flight plume.
function thrusterNozzles() {
  const out = [];
  for (const c of layout().cells) {
    if (c.id !== THRUSTER) continue;
    out.push([origin.x + c.x + 0.5, origin.y - 0.15, origin.z + c.z + 0.5]);
  }
  return out;
}

// One batched exhaust burst across all thrusters: a single Points cloud
// per tick instead of one allocation per nozzle. Shared by the countdown
// and the landing fade (mirror phases). Emitted just under the hull so the
// puffs are not swallowed by the base row, always sprayed downward —
// braking thrust included, so the exhaust never rises into the hull.
function spawnExhaust() {
  const nozzles = thrusterNozzles();
  if (!nozzles.length) return;
  playFx("exhaust", { nozzles, cone: coneSize });
  shake(SHAKE.burn);
}

// Landing-like smoke wrapping the hull while the engines spool: height and
// density scale with the liftoff approach, ending at a max-speed boosted
// landing. Shared by the landing fade: the touchdown rumble replays the
// same smoke, scaled by the touchdown and decaying with the fade.
function spawnCountdownSmoke(progress) {
  playFx("landing", {
    x: origin.x, y: origin.y, z: origin.z,
    halfW: ROCKET_SPEC.w * 0.5, halfD: ROCKET_SPEC.d * 0.5,
    hullHeight: ROCKET_SPEC.h,
    factor: countdownFactor(progress),
  });
}

// Read the live ride box out of the store and turn it into a moving model.
// Every non-air cell inside rides — the parked hull plus anything standing
// in the 1-cell margin — with glowstone variants remembered; the whole box
// stays protected while it flies. Side overhangs outside the box stay put;
// the column above the box (one hull height) is destroyed at liftoff, the
// ascent carve taking over after that.
function snapshot() {
  const ox = Math.floor(origin.x), oy = Math.floor(origin.y), oz = Math.floor(origin.z);
  const cleared = [];
  const scanned = [];
  const docks = [];
  for (let y = oy + RIDE.y0; y <= oy + RIDE.y1; y++)
    for (let x = ox + RIDE.x0; x <= ox + RIDE.x1; x++)
      for (let z = oz + RIDE.z0; z <= oz + RIDE.z1; z++) {
        docks.push([x, y, z]);
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        unprotectCell(x, y, z);
        let v = -1;
        if (id === GLOWSTONE) {
          v = glowVariantAt(x, y, z);
          clearGlowstoneAt(x, y, z);
        } else if (id === FLOWER) {
          clearFlowerAt(x, y, z);
        }
        clearReactionAt(x, y, z);
        setBlock(x, y, z, AIR);
        if (y >= MOON_MIN_Y) markMoonDirty();
        scanned.push({ lx: x - ox, ly: y - oy, lz: z - oz, id, v, extra: false });
        cleared.push([x, y, z]);
      }
  modelCells = scanned;
  releaseDockedProtection();
  dockedCells = docks;
  for (const [x, y, z] of docks) protectCell(x, y, z);
  // Column above the ride box, one hull height: destroyed at liftoff
  // (protected cells and worldgen frames stay; the climb carve handles
  // everything higher on the way up).
  {
    const keepFrames = new Set(villageFrames);
    let tntUp = false;
    const upCleared = [];
    for (let y = oy + RIDE.y1 + 1; y <= oy + RIDE.y1 + ROCKET_SPEC.h; y++)
      for (let x = ox + RIDE.x0; x <= ox + RIDE.x1; x++)
        for (let z = oz + RIDE.z0; z <= oz + RIDE.z1; z++) {
          const id = getBlock(x, y, z);
          if (id === AIR) continue;
          if (isCellProtected(x, y, z)) continue;
          if (keepFrames.has(key(x, y, z))) continue;
          if (id === GLOWSTONE) clearGlowstoneAt(x, y, z);
          else if (id === FLOWER) clearFlowerAt(x, y, z);
          else if (isTntLike(id)) tntUp = true;
          clearReactionAt(x, y, z);
          setBlock(x, y, z, AIR);
          if (y >= MOON_MIN_Y) markMoonDirty();
          upCleared.push([x, y, z]);
        }
    if (tntUp) clearTNTBox(ox + RIDE.x0, oy + RIDE.y1 + 1, oz + RIDE.z0, ox + RIDE.x1, oy + RIDE.y1 + ROCKET_SPEC.h, oz + RIDE.z1);
    for (const c of upCleared) cleared.push(c);
    // The column torn open above the hull at liftoff: its walls burst too.
    collectCarveFaces(upCleared);
  }
  if (cleared.length) {
    notePortalEdits(cleared);
    queueRefreshBlocks(cleared);
  }
  // Reuse the prebuilt hidden model when it already matches the scan.
  if (!(moving && movingBuiltVersion === rocketSite.version && sameModel(moving.cells, modelCells))) {
    buildMoving(modelCells);
    movingBuiltVersion = rocketSite.version;
  }
}

function sameModel(a, b) {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((c) => c.lx + "," + c.ly + "," + c.lz + ":" + c.id));
  return b.every((c) => keys.has(c.lx + "," + c.ly + "," + c.lz + ":" + c.id));
}

function buildMoving(cells) {
  removeMoving();
  const group = new THREE.Group();
  group.position.copy(origin);
  const byId = new Map();
  const solid = new Set();
  for (const c of cells) {
    solid.add(c.lx + "," + c.ly + "," + c.lz);
    let list = byId.get(c.id);
    if (!list) { list = []; byId.set(c.id, list); }
    list.push(c);
  }
  const meshes = [];
  for (const [id, list] of byId) {
    const mesh = new THREE.InstancedMesh(boxGeo, movingMatsFor(id), list.length);
    const a = mesh.instanceMatrix.array;
    for (let i = 0; i < list.length; i++) {
      const o = i * 16;
      a[o] = 1; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 1; a[o + 11] = 0;
      a[o + 12] = list[i].lx + 0.5; a[o + 13] = list[i].ly + 0.5; a[o + 14] = list[i].lz + 0.5; a[o + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    // The moving hull is translucent during flight, never an occluder: it
    // composites over the world's transparent bands (liquids included), and
    // its glass rides one band above the hull blocks so it is never tinted
    // by them.
    mesh.renderOrder = id === GLASS ? ORDERS.VEHICLE_GLASS : ORDERS.VEHICLE;
    group.add(mesh);
    meshes.push({ id, mesh });
  }
  sceneRef.add(group);
  moving = { group, solid, cells, meshes };
  applyHullFade();
}

function applyHullFade() {
  if (!moving?.meshes) return;
  // Single material set, opacity only: no swap, no pop at either end.
  for (const { id, mesh } of moving.meshes) {
    const mats = movingMatsFor(id);
    if (mesh.material !== mats) mesh.material = mats;
    for (const m of mats) {
      const base = m.userData.baseOpacity ?? 1;
      const target = m.userData.fadeOpacity ?? Math.min(base, 0.5);
      m.opacity = base + (target - base) * hullFade;
    }
  }
}

function tickFlight(dt) {
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  // Ramped boost factor: acceleration, caps, and thrust glide instead of
  // stepping, so the camera never feels a pop.
  const boostTarget = (keys["ShiftLeft"] || keys["ShiftRight"] || keys["Shift"]) ? 1 : 0;
  boostF += (boostTarget - boostF) * Math.min(1, BOOST_RAMP * dt);
  if (Math.abs(boostF - boostTarget) < 0.001) boostF = boostTarget;
  const cap = MAX_SPEED + (BOOST_SPEED - MAX_SPEED) * boostF;
  if (piloting) {
    // Heading steers at a speed slaved to the climb: |vy|, weighted by
    // the look pitch (level gaze = full, straight up/down = zero). The
    // strafe vector adds before normalization; velocity eases toward the
    // target instead of stepping, so LEFT/RIGHT never jolts.
    _hv.set(0, 0, 0);
    _hv.add(_fwd);
    if (keys["ArrowRight"]) _hv.add(_right);
    if (keys["ArrowLeft"]) _hv.sub(_right);
    _hv.normalize().multiplyScalar(Math.abs(rvel.y) * Math.max(0, Math.cos(pitch)));
    const k = Math.min(1, H_SMOOTH * dt);
    rvel.x += (_hv.x - rvel.x) * k;
    rvel.z += (_hv.z - rvel.z) * k;
    // Vertical stays acceleration-driven with the ramped cap.
    const accel = ACCEL * (1 + boostF);
    let upAccel = 0;
    let downAccel = 0;
    if (keys["ArrowUp"]) { rvel.y += accel * dt; upAccel = accel; }
    if (keys["ArrowDown"]) { rvel.y -= accel * dt; downAccel = accel; }
    // The liftoff is a real push, not a kick: the engines stay lit while
    // the hull accelerates off the pad, and the camera rumbles with the
    // burn — the landing fade in reverse, decaying as the push ends.
    if (launchBurn > 0) {
      launchBurn -= dt;
      rvel.y += ACCEL * dt;
      upAccel = Math.max(upAccel, ACCEL);
      shakeFrame(Math.max(0, launchBurn) / LAUNCH_BURN, "liftoff", dt);
    }
    // The exhaust follows the commanded vertical push only — bigger push,
    // denser jet (nominal = 1, boosted = 2) — and glides to it. The braking
    // push is tracked separately: it feeds the same downward jet.
    const target = upAccel / ACCEL;
    thrustLevel += (target - thrustLevel) * Math.min(1, THRUST_RAMP * dt);
    if (Math.abs(target - thrustLevel) < 0.01) thrustLevel = target;
    const brakeTarget = downAccel / ACCEL;
    brakeLevel += (brakeTarget - brakeLevel) * Math.min(1, THRUST_RAMP * dt);
    if (Math.abs(brakeTarget - brakeLevel) < 0.01) brakeLevel = brakeTarget;
  } else {
    thrustLevel = 0;
    brakeLevel = 0;
  }
  if (rvel.y > cap) rvel.y = cap;
  if (rvel.y < -cap) rvel.y = -cap;

  // Step the swept hull so fast moves never tunnel through a landing pad.
  const dist = rvel.length() * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.6));
  const sx = rvel.x * dt / steps, sy = rvel.y * dt / steps, sz = rvel.z * dt / steps;
  for (let i = 0; i < steps; i++) {
    origin.x += sx; origin.y += sy; origin.z += sz;
    if (origin.x < -WORLD_RADIUS) { origin.x = -WORLD_RADIUS; rvel.x = 0; }
    if (origin.x > WORLD_RADIUS - (ROCKET_SPEC.w - 1)) { origin.x = WORLD_RADIUS - (ROCKET_SPEC.w - 1); rvel.x = 0; }
    if (origin.z < -WORLD_RADIUS) { origin.z = -WORLD_RADIUS; rvel.z = 0; }
    if (origin.z > WORLD_RADIUS - (ROCKET_SPEC.d - 1)) { origin.z = WORLD_RADIUS - (ROCKET_SPEC.d - 1); rvel.z = 0; }
    if (origin.y < 1) { origin.y = 1; rvel.y = Math.max(0, rvel.y); }
    // Descending onto solid ground lands instead of carving it.
    if (rvel.y < -0.6 && footprintSolid(Math.floor(origin.y))) {
      origin.y = Math.floor(origin.y) + 1;
      startLanding();
      return;
    }
    // The bounding box is the authority: whatever rock the swept volume
    // reaches is torn out, in every direction. The box's bottom row is
    // never touched (the ground stays solid), so a landing leaves the
    // floor intact.
    if (rvel.x || rvel.y || rvel.z) carveAt(origin);
  }

  if (moving?.group) moving.group.position.copy(origin);
  // The exhaust jet under the nozzles, streaming while the engines push —
  // up-burn and braking alike, always downward.
  const jetLevel = Math.max(thrustLevel, brakeLevel);
  plumeT -= dt;
  if (jetLevel > 0.05 && plumeT <= 0) {
    plumeT = 0.06;
    spawnThrustPlume(jetLevel);
  }
  if (piloting) pinPilot();

  if (rvel.y < -0.6 && groundBelow()) startLanding();
}

// Exhaust jet under the four nozzles while the engines push, always
// downward. The look comes from the spec (src/fx/rocketfx.js): an ember jet
// plus a grey puff, both denser and faster with the thrust level.
function spawnThrustPlume(L) {
  const nozzles = thrusterNozzles();
  if (!nozzles.length) return;
  playFx("plume", { nozzles, ramp: { level: L }, cone: coneSize });
}

function footprintSolid(by) {
  const ox = Math.floor(origin.x), oz = Math.floor(origin.z);
  for (let lx = 0; lx < ROCKET_SPEC.w; lx++)
    for (let lz = 0; lz < ROCKET_SPEC.d; lz++)
      if (isSolid(ox + lx, by, oz + lz)) return true;
  return false;
}

function groundBelow() {
  return footprintSolid(Math.floor(origin.y) - 1);
}

function startLanding() {
  phase = "landing";
  thrustLevel = 0;
  brakeLevel = 0;
  landingT = 0;
  exhaustT = 0;
  // One shake scaled by the touchdown speed and the live peak knob:
  // linear up to the non-boost cap, full takeoff violence at FLY x 3 and
  // above. Trauma itself caps in main.js.
  const impact = Math.abs(rvel.y);
  landingTarget.set(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z));
  origin.copy(landingTarget);
  if (moving?.group) moving.group.position.copy(origin);
  rvel.set(0, 0, 0);
  if (piloting) {
    // The hull takes the pilot down with it: the mirrored fade-out
    // (accelerating, exhaust on) runs with the player frozen at the
    // stand, released only once the hull has faded out.
    piloting = false;
    pinPilot();
    fadeHull(0, LANDING_FADE, "in");
  }
  // The touchdown feel: the cloud reads the boosted cap while the shake
  // reads the non-boost cap — so the two stay together up to FLY x 3,
  // and past that only the cloud keeps growing.
  landingT0 = speedFactor(impact, BOOST_SPEED);
  shakeT0 = Math.min(1, speedFactor(impact, MAX_SPEED));
  landingDust(impact);
  shakeThump(shakeT0, "touchdown");
}

function tickLanding(dt) {
  thrustLevel = 0;
  brakeLevel = 0;
  // The pilot is frozen for the whole landing animation: pinned at the
  // stand, no walk, no fly, no relaunch until the hull has faded out and
  // the camera has stabilized (fade, then settle freeze).
  pinPilot();
  landingT += dt;
  // FX only over the fade: the settle freeze is still air, so the camera
  // truly stabilizes before control returns.
  if (landingT < LANDING_FADE) {
    exhaustT -= dt;
    if (exhaustT <= 0) {
      exhaustT = 0.12;
      spawnExhaust();
      // The touchdown rumble: the landing fade replays the landing smoke,
      // scaled by the touchdown and decaying with the fade — the countdown
      // in reverse, so the landing lasts as long as it hits instead of
      // dying on the impact frame. Ticks are tracked (decay x cadence, like
      // the countdown tremor) so a max drop swells without pinning the
      // lens.
      const fadeK = Math.max(0, 1 - landingT / LANDING_FADE);
      if (landingT0 > 0) {
        playFx("landing", {
          x: origin.x, y: origin.y, z: origin.z,
          halfW: ROCKET_SPEC.w * 0.5, halfD: ROCKET_SPEC.d * 0.5,
          hullHeight: ROCKET_SPEC.h,
          factor: landingT0 * fadeK,
        });
        shakeTick(shakeT0 * fadeK, "fade");
      }
    }
  }
  // The settle freeze scales with the shake input like the rumble does: a
  // max drop holds until full stabilization, a soft kiss barely holds
  // past the fade.
  if (landingT >= LANDING_FADE + LANDING_SETTLE * shakeT0) finalizeLanding();
}

function finalizeLanding() {
  hullFade = 0;
  clearFade();
  stamp();
}

function carveAt(o) {
  const x0 = Math.floor(o.x) + RIDE.x0, y0 = Math.floor(o.y) + RIDE.y0, z0 = Math.floor(o.z) + RIDE.z0;
  const cleared = [];
  let tntHit = false;
  let budget = CARVE_MAX;
  const x1 = Math.floor(o.x) + RIDE.x1;
  const y1 = Math.floor(o.y) + RIDE.y1;
  const z1 = Math.floor(o.z) + RIDE.z1;
  // The box's bottom row is the face the hull rests on. While descending
  // that row is the landing surface, so it is spared: the ground the
  // rocket lands on stays solid. Ascending and moving sideways it is
  // ordinary fresh rock and goes with the rest.
  const skipBase = rvel.y < 0;
  outer:
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        if (skipBase && y === y0) continue;
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        if (isCellProtected(x, y, z)) continue;
        if (id === GLOWSTONE) clearGlowstoneAt(x, y, z);
        else if (id === FLOWER) clearFlowerAt(x, y, z);
        else if (isTntLike(id)) tntHit = true;
        clearReactionAt(x, y, z);
        setBlock(x, y, z, AIR);
        if (y >= MOON_MIN_Y) markMoonDirty();
        cleared.push([x, y, z]);
        if (--budget <= 0) { rvel.set(0, 0, 0); break outer; }
      }
  if (!cleared.length) return;
  if (tntHit) clearTNTBox(x0, y0, z0, x1, y1, z1);
  notePortalEdits(cleared);
  queueRefreshBlocks(cleared);
  // Rock dust at the hull: the volume the rocket tore loose, scaled with
  // the speed it tore it at.
  if (cleared.length > CARVE_DUST_MIN_CELLS) {
    playFx("carve", {
      x: o.x, y: o.y, z: o.z,
      halfW: ROCKET_SPEC.w * 0.5, halfD: ROCKET_SPEC.d * 0.5,
      amount: cleared.length,
      factor: speedFactor(rvel.length(), BOOST_SPEED),
    });
  }
  // The rock this pass tore open: its exposed faces are the walls the
  // rocket just burst through, and they carry the explosive FX.
  collectCarveFaces(cleared);
}

// Impact faces found by the carve passes of this frame, flushed once per
// tick so a fast ascent stays a handful of batched draw calls.
let carveFaces = [];

// Find the shaft walls the carve just exposed: a cleared cell whose
// neighbour is still solid is a face the rocket burst through.
function collectCarveFaces(cells) {
  if (carveFaces.length >= CARVE_FACE_FRAME_CAP) return;
  const faces = exposedFaces(cells, isSolid, { maxFaces: CARVE_FACE_BUDGET });
  for (const f of faces) {
    if (carveFaces.length >= CARVE_FACE_FRAME_CAP) break;
    carveFaces.push(f);
  }
}

function landingDust(impact = 0) {
  // The touchdown cloud: the single shipped smoke look, scaled by the
  // impact speed against the boosted vertical cap — soft landings barely
  // puff, a max-speed drop blooms. Returns the factors the landing curve
  // resolved, so the shake reads the same numbers.
  return playFx("landing", {
    x: origin.x, y: origin.y, z: origin.z,
    halfW: ROCKET_SPEC.w * 0.5, halfD: ROCKET_SPEC.d * 0.5,
    hullHeight: ROCKET_SPEC.h,
    factor: speedFactor(impact, BOOST_SPEED),
  });
}

function clearBox(x0, y0, z0, x1, y1, z1) {
  // Landing clear: everything non-air in the hull box disappears — including
  // protected cells — except the pad plate (it sits below the box in the
  // nominal case; the exception covers pit landings) and worldgen portal
  // frames, which are never collateral.
  const keepFrames = new Set(villageFrames);
  const pad = rocketSite.pad;
  const cleared = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        if (pad && y === pad.vy && x >= pad.minX && x <= pad.maxX && z >= pad.minZ && z <= pad.maxZ) continue;
        if (keepFrames.has(key(x, y, z))) continue;
        if (id === GLOWSTONE) clearGlowstoneAt(x, y, z);
        else if (id === FLOWER) clearFlowerAt(x, y, z);
        clearReactionAt(x, y, z);
        setBlock(x, y, z, AIR);
        if (y >= MOON_MIN_Y) markMoonDirty();
        cleared.push([x, y, z]);
      }
  return cleared;
}

function stamp() {
  releaseDockedProtection();
  const ox = Math.round(origin.x), oy = Math.round(origin.y), oz = Math.round(origin.z);
  const carry = { x: pos.x - origin.x, y: pos.y - origin.y, z: pos.z - origin.z };
  const cleared = clearBox(ox + RIDE.x0, oy + RIDE.y0, oz + RIDE.z0, ox + RIDE.x1, oy + RIDE.y1, oz + RIDE.z1);
  const worldCells = [];
  // Only the structural hull comes back protected (indestructible);
  // player placements scanned into the ride box stamp back plain so they
  // stay deletable.
  const grid = layout();
  const structural = new Set((grid?.cells ?? []).map((c) => c.x + "," + c.y + "," + c.z));
  const keepSet = new Set(partitionStampCells(modelCells, structural).keep);
  for (const c of modelCells) {
    const x = ox + c.lx, y = oy + c.ly, z = oz + c.lz;
    setBlock(x, y, z, c.id);
    if (y >= MOON_MIN_Y) markMoonDirty();
    if (c.id === GLOWSTONE) {
      if (c.v !== undefined && c.v >= 0) noteGlowstonePlaceShared(x, y, z, c.v);
      else noteGlowstonePlace(x, y, z);
    } else if (c.id === FLOWER) {
      noteFlowerPlace(x, y, z);
    }
    if (keepSet.has(c)) protectCell(x, y, z);
    worldCells.push([x, y, z]);
  }
  pos.set(ox + carry.x, oy + carry.y, oz + carry.z);
  rocketSite.origin = { x: ox, y: oy, z: oz };
  rocketSite.worldCells = worldCells;
  origin.set(ox, oy, oz);
  removeMoving();
  releaseAllRiders();
  phase = "parked";
  landingT = 0;
  thrustLevel = 0;
  hullFade = 0;
  clearFade();
  const touched = cleared.concat(worldCells);
  if (touched.length) {
    notePortalEdits(cleared);
    refreshBlocks(touched);
  }
}
