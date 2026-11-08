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
import { clearFlowerAt, noteFlowerPlace } from "../world/flowers.js";
import { clearTNTBox } from "../fx/tnt.js";
import { notePortalEdits } from "../world/portals.js";
import { severHook } from "../player/hook.js";
import { refreshBlocks, queueRefreshBlocks } from "../render/mesher.js";
import { spawnBurst, spawnBurstBatch } from "../fx/particles.js";
import { dimTntTiersUnlocked } from "../world/dimensions.js";
import { isTntTierUnlocked } from "../world/tntunlock.js";
import { villageFrames } from "../world/village.js";
import { listFarmMobs } from "../mobs/farm.js";
import { isCarried, staysHullPinned } from "../mobs/carry.js";

registerVehicleType({ key: "rocket", name: "Rocket", carriesMobs: true });

const COUNTDOWN = 3.0;
const FADE_TIME = 2.5;
const LANDING_FADE = 1.0;
const ACCEL = 26;
const MAX_SPEED = FLY * 3;
const BOOST_SPEED = FLY * 6;
const H_SMOOTH = 8;
const BOOST_RAMP = 3;
const CARVE_MAX = 2400;

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const flameGeo = new THREE.ConeGeometry(0.55, 1.6, 8);
const flameMat = new THREE.MeshBasicMaterial({
  color: 0xff9a33, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
});
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
      // Depth writes stay on: at opacity == base the model reads exactly
      // like the opaque voxels it replaces, so installing/removing the
      // transparent set causes no pop at either fade end. The glass keeps
      // its own depthless renderOrder path.
      c.depthWrite = true;
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
let piloting = false;
let siteVersion = -1;
let countdown = 0;
let landingT = 0;
let exhaustT = 0;
let thrustLevel = 0;
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
let dockedCells = [];
let landingTarget = new THREE.Vector3();

const origin = new THREE.Vector3();
const rvel = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _hv = new THREE.Vector3();

let moving = null; // { group, flames, solid, cells, meshes }
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
  thrustLevel = 0;
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

export function rocketPiloting() {
  return piloting;
}

// The player loop defers to the rocket while counting down or flying: the
// pilot is pinned, plain walk physics never runs.
export function rocketTakesOver() {
  return piloting && (phase === "countdown" || phase === "flight");
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
  return !!keys["Enter"] && !flyOn;
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
    t = "Hold ENTER to take off";
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
  hullFade = 0;
  boostF = 0;
  clearFade();
    setPrompt("");
    updateCountdown();
    return;
  }
  if (!syncSite()) {
    setPrompt("");
    updateCountdown();
    return;
  }
  if (moving?.group) moving.group.visible = phase !== "parked";
  if (phase === "parked") {
    if (rocketInsidePlayer()) {
      // Fly mode stays on inside the cabin: no prompt and no takeoff
      // while it is, takeoff only once it is off.
      if (holdTakeoff()) startCountdown();
    }
  } else if (phase === "countdown") tickCountdown(dt);
  else if (phase === "flight") tickFlight(dt);
  else if (phase === "landing") tickLanding(dt);
  tickHullFade(dt);
  applyHullFade();
  tickFlames();
  updatePrompt();
  updateCountdown();
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
  thrustLevel = 1;
  hullFade = 0;
  fadeSegs = [
    { from: 0, to: COUNTDOWN_FADE[0].to, t: 0, dur: COUNTDOWN_FADE[0].dur, ease: COUNTDOWN_FADE[0].ease },
    { from: COUNTDOWN_FADE[0].to, to: COUNTDOWN_FADE[1].to, t: 0, dur: COUNTDOWN_FADE[1].dur },
  ];
  pinPilot();
  shake(0.05);
}

function cancelCountdown() {
  phase = "parked";
  piloting = false;
  countdown = 0;
  exhaustT = 0;
  thrustLevel = 0;
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
  thrustLevel = 1;
  countdown -= dt;
  exhaustT -= dt;
  if (exhaustT <= 0) {
    exhaustT = 0.12;
    spawnExhaust();
  }
  if (countdown <= 0) {
    releaseDockedProtection();
    phase = "flight";
    countdown = 0;
    hullFade = 1;
    clearFade();
    rvel.set(0, 5.2, 0);
    shake(0.2);
  }
}

// One batched exhaust burst across all thrusters: a single Points cloud
// per tick instead of one allocation per nozzle. Shared by the countdown
// and the landing fade (mirror phases).
function spawnExhaust() {
  const centers = [];
  for (const c of layout().cells) {
    if (c.id !== THRUSTER) continue;
    centers.push([origin.x + c.x + 0.5, origin.y + 0.05, origin.z + c.z + 0.5]);
  }
  if (centers.length) spawnBurstBatch({
    centers, count: 10, life: 0.55, size: 0.4, gravity: 1.5,
    color: [0.9, 0.55, 0.2], variance: [0.1, 0.2, 0.2],
    speedMin: 1, speedMax: 4, up: 1,
  });
  shake(0.02);
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
        setBlock(x, y, z, AIR);
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
          setBlock(x, y, z, AIR);
          upCleared.push([x, y, z]);
        }
    if (tntUp) clearTNTBox(ox + RIDE.x0, oy + RIDE.y1 + 1, oz + RIDE.z0, ox + RIDE.x1, oy + RIDE.y1 + ROCKET_SPEC.h, oz + RIDE.z1);
    for (const c of upCleared) cleared.push(c);
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
    if (id === GLASS) mesh.renderOrder = 13;
    group.add(mesh);
    meshes.push({ id, mesh });
  }
  const flames = [];
  for (const c of layout().cells) {
    if (c.id !== THRUSTER) continue;
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.rotation.x = Math.PI;
    f.position.set(c.x + 0.5, c.y - 0.75, c.z + 0.5);
    f.visible = false;
    group.add(f);
    flames.push(f);
  }
  sceneRef.add(group);
  moving = { group, flames, solid, cells, meshes };
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

function tickFlames() {
  const flames = moving?.flames;
  if (!flames) return;
  const level = phase === "countdown" ? 1 : (phase === "flight" ? thrustLevel : 0);
  const on = level > 0;
  flameMat.opacity = 0.7 + 0.18 * Math.min(level, 1);
  for (const f of flames) {
    f.visible = on;
    if (on) {
      const flicker = 0.82 + Math.random() * 0.36;
      const width = (0.72 + 0.16 * level) * (0.9 + Math.random() * 0.14);
      const length = (0.9 + 0.62 * level) * flicker;
      f.scale.set(width, length, width);
    }
  }
}

function tickFlight(dt) {
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  thrustLevel = 0;
  // Ramped "/" factor: acceleration, caps, and flames glide instead of
  // stepping, so the camera never feels a pop.
  const boostTarget = (keys["Slash"] || keys["/"]) ? 1 : 0;
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
    if (keys["ArrowUp"]) rvel.y += accel * dt;
    if (keys["ArrowDown"]) rvel.y -= accel * dt;
    thrustLevel = 1 + 0.5 * boostF;
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
    // Only upward travel carves what the hull sweeps through.
    if (rvel.y > 0) carveAt(origin);
  }

  if (moving?.group) moving.group.position.copy(origin);
  if (piloting) pinPilot();

  if (rvel.y < -0.6 && groundBelow()) startLanding();
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
  landingT = 0;
  exhaustT = 0;
  landingTarget.set(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z));
  origin.copy(landingTarget);
  if (moving?.group) moving.group.position.copy(origin);
  rvel.set(0, 0, 0);
  if (piloting) {
    // Controls release the instant the hull touches down; the mirrored
    // 1 s fade-out (accelerating, exhaust on) runs while the player
    // already walks free.
    piloting = false;
    pinPilot();
    fadeHull(0, LANDING_FADE, "in");
  }
  landingDust();
  shake(0.22);
}

function tickLanding(dt) {
  thrustLevel = 0;
  landingT += dt;
  exhaustT -= dt;
  if (exhaustT <= 0) {
    exhaustT = 0.12;
    spawnExhaust();
  }
  if (landingT >= LANDING_FADE) finalizeLanding();
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
  outer:
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        if (isCellProtected(x, y, z)) continue;
        if (id === GLOWSTONE) clearGlowstoneAt(x, y, z);
        else if (id === FLOWER) clearFlowerAt(x, y, z);
        else if (isTntLike(id)) tntHit = true;
        setBlock(x, y, z, AIR);
        cleared.push([x, y, z]);
        if (--budget <= 0) { rvel.set(0, 0, 0); break outer; }
      }
  if (!cleared.length) return;
  if (tntHit) clearTNTBox(x0, y0, z0, x1, y1, z1);
  notePortalEdits(cleared);
  queueRefreshBlocks(cleared);
  if (cleared.length > 6) {
    spawnBurst({
      x: o.x + ROCKET_SPEC.w * 0.5, y: o.y + 1.5, z: o.z + ROCKET_SPEC.d * 0.5,
      count: Math.min(40, 8 + ((cleared.length / 12) | 0)), life: 0.55, size: 0.35,
      gravity: 8, additive: false, color: [0.55, 0.5, 0.45], variance: [0.2, 0.2, 0.2],
      speedMin: 2, speedMax: 7, up: 1,
    });
  }
}

function landingDust() {
  spawnBurst({
    x: origin.x + ROCKET_SPEC.w * 0.5, y: origin.y + 0.2, z: origin.z + ROCKET_SPEC.d * 0.5,
    count: 70, life: 0.9, size: 0.5, gravity: 9, additive: false,
    color: [0.55, 0.5, 0.45], variance: [0.2, 0.2, 0.2],
    speedMin: 3, speedMax: 10, up: 2,
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
        setBlock(x, y, z, AIR);
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
