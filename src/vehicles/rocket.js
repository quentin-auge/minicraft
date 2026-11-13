// Piloted rocket runtime (rule-based vessels, see ARCHITECTURE.md): the pick
// resolves WHAT would fly — the 18-connected component under the pilot's
// feet inside a pad takeoff box (union: one fresh record) or inside a parked
// vessel's box (intersection) — snapshots it into a moving instanced model
// (fading the ship so the pilot sees through it), and landing stamps the
// riding set back into the voxel store. The bbox carves every non-liquid
// block it intersects, whatever the direction — first, even held or
// paused — except while descending (dy < 0), where x/z clamp to the posed
// integer box so the fringe past the landed bbox survives; the pause
// (herd hold, strictly-descending ground contact) wins
// over further motion. Liquids never carve and the support under the bbox
// is never carved. Every hull is
// destructible. Registered in the vehicle registry (carriesMobs: true):
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
import { ROCKET_SPEC, rocketSite, rideBoardable, pickUnderFeet, takeoffAllowed, resetVessels, listVessels, vesselWorldBox, refreshAllVessels, stealCellsFromVessels, sweptBoxCells, flightCarveBox, shipBounds, registerVessel, updateVessel, removeVessel, resetPads, listPads, takeoffBox } from "../world/rocketpad.js";
import { registerVehicleType } from "./registry.js";
import { footprintTouches, stopBelow, bodyOverlapCells } from "./rocketbox.js";
import {
  pos, vel, keys, yaw, pitch, jumpingNow, setOnGround, WALK, PLAYER_HW, PLAYER_H,
} from "../player/physics.js";
import { FLY, flyOn } from "../player/fly.js";
import { clearGlowstoneAt, noteGlowstonePlace, noteGlowstonePlaceShared, glowVariantAt } from "../world/glowstone.js";
import { MOON_MIN_Y, markMoonDirty } from "../world/moon.js";
import { clearFlowerAt, noteFlowerPlace, noteFlowerPlaceShared, flowerVariantAt, flowerAngleAt } from "../world/flowers.js";
import { FLOWER_GEOS, flightFlowerMat } from "../render/flowers.js";
import { clearReactionAt } from "../world/reactions.js";
import { clearTNTBox } from "../fx/tnt.js";
import { notePortalEdits, ridingFillsFor, flightFillMat, noteStampedRides, toast } from "../world/portals.js";
import { rideSigFromKey } from "../world/portalfills.js";
import { severHook } from "../player/hook.js";
import { refreshBlocks, queueRefreshBlocks } from "../render/mesher.js";
import { ORDERS } from "../render/orders.js";
import { exposedFaces, speedFactor, countdownFactor, fxScale, ROCKET_FX_DEFAULT_CONE } from "../fx/rocketfx.js";
import { playFx } from "../fx/rocketimpact.js";
import { dimTntTiersUnlocked } from "../world/dimensions.js";
import { isTntTierUnlocked } from "../world/tntunlock.js";
import { villageFrames } from "../world/village.js";
import { listFarmMobs } from "../mobs/farm.js";
import { allMobs } from "../mobs/registry.js";
import { isCarried, staysHullPinned, landingBlockers, tallestBlockerTop, boxFree } from "../mobs/carry.js";

registerVehicleType({ key: "rocket", name: "Rocket", carriesMobs: true });

const COUNTDOWN = 3.0;
const FADE_TIME = 2.5;
const LANDING_FADE = 0.5;
// Safety margin: while the landing box is blocked the hull holds this far
// above the tallest blocking mob top, so bodies walk under it.
const LANDING_MARGIN = 0.5;
// Down-held lateral glide: while ArrowDown is held the heading/strafe
// vector keeps a walk-pace floor instead of dying with |vy|, so the mouse
// heading and a deliberate strafe glide the hull in XZ over the herd
// (see tickFlight). The Y hold below is rate-limited, so crossing mixed
// tops reads as a swell, never a flicker.
const DOWN_SLIDE = WALK;
// Blocked-hold Y slew: the hull tracks the margin floor at most this fast
// in either direction. A milling herd (or a glide across mixed tops)
// oscillates the floor faster than this, so the hull averages it out to
// ~static; a genuine lower/higher floor is followed within ~0.2 s —
// follow semantics both ways, never a snap, never a penetration.
const HOLD_SLEW = 2;
// Approach band: the hold engages this far above the margin floor, so a
// fast descent is caught before it can cross below it (the band exceeds
// the 0.6 max swept substep, so the catch lands above the floor). The
// floor is a fixed point instead of a sink-then-snap cycle — that cycle
// was the up/down flicker.
const HOLD_BAND = 0.7;
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

// Temporary vessel-box debug (?bb=1, session-fixed like ?color=1):
// translucent blue boxes around every parked vessel, the pad creation zone
// and the flying ship. Never fires in headless (no THREE import there).
const showVesselBoxes = typeof location !== "undefined" && new URLSearchParams(location.search).get("bb") === "1";
const bbBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const bbEdgeGeo = new THREE.EdgesGeometry(bbBoxGeo);
const bbFillMat = new THREE.MeshBasicMaterial({ color: 0x3388ff, transparent: true, opacity: 0.18, depthWrite: false });
const bbEdgeMat = new THREE.LineBasicMaterial({ color: 0x3388ff, transparent: true, opacity: 0.9 });
const bbMeshes = new Map();
function tickVesselBoxes() {
  if (!showVesselBoxes || !sceneRef) return;
  const seen = new Set();
  const draw = (id, x0, y0, z0, x1, y1, z1) => {
    seen.add(id);
    let g = bbMeshes.get(id);
    if (!g) {
      g = new THREE.Group();
      g.add(new THREE.Mesh(bbBoxGeo, bbFillMat));
      g.add(new THREE.LineSegments(bbEdgeGeo, bbEdgeMat));
      sceneRef.add(g);
      bbMeshes.set(id, g);
    }
    // Cell-inclusive bounds plus a hair, so no face is exactly coplanar
    // with the terrain and nothing fights it.
    const pad = 0.004;
    g.position.set((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (z0 + z1 + 1) / 2);
    g.scale.set(x1 - x0 + 1 + pad, y1 - y0 + 1 + pad, z1 - z0 + 1 + pad);
    g.visible = true;
  };
  if (dim === "over") {
    for (const p of listPads()) {
      const b = takeoffBox(p);
      if (!b) continue;
      draw("pad-" + p.id, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
    }
    for (const v of listVessels()) {
      if (v.status !== "parked") continue;
      const b = vesselWorldBox(v);
      draw("v-" + v.id, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
    }
    if ((piloting && (phase === "countdown" || phase === "flight")) || phase === "landing") {
      const ox = Math.floor(origin.x), oy = Math.floor(origin.y), oz = Math.floor(origin.z);
      draw("fly", ox + vesselBox.x0, oy + vesselBox.y0, oz + vesselBox.z0,
        ox + vesselBox.x1, oy + vesselBox.y1, oz + vesselBox.z1);
    }
  }
  for (const [id, g] of bbMeshes) {
    if (seen.has(id)) continue;
    sceneRef.remove(g);
    bbMeshes.delete(id);
  }
}

let phase = "parked"; // parked | countdown | flight | landing
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
// ends. A fresh press DURING the animation still counts: the freeze latches
// it and the relaunch fires the tick the freeze ends (released first
// cancels).
let takeoffArmed = true;
// A relaunch pressed mid-landing, fired at freeze end while still held.
let takeoffQueued = false;
// The chord state on the previous tick: only a rising edge queues.
let chordWas = false;
let dockedCells = [];
let landingTarget = new THREE.Vector3();
// The flying ship's 0-margin local box, set at takeoff from the resolved
// ship and translated with the hull. All effects, the carve, the touchdown
// test and the landing clear run on it.
let vesselBox = null;
// The flying vessel's registry id while airborne (null parked). The record
// follows the ship at landing; a pad creation registers one at liftoff.
let activeVesselId = null;
// Takeoff bookkeeping: the resolved offer (ship + box + vessel id) behind
// the live countdown/flight, and the prompt's offer behind the parked
// prompt. pickUnderFeet is the exact gate in both cases.
let takeoffOffer = null;
let pendingOffer = null;

const origin = new THREE.Vector3();
const rvel = new THREE.Vector3();
// Pilot offset captured at boarding (pos - origin): the pin keeps the pilot
// at this exact spot relative to the hull for the whole sequence, so
// boarding from anywhere in the ride box never teleports the player.
const pilotLocal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _hv = new THREE.Vector3();

let moving = null; // { group, solid, cells, meshes }
let movingBuiltVersion = -1;
// Riding voxel set: local cells + ids (+ glowstone variant, flower
// variant + angle) that travel with the hull and stamp back on landing.
// Scanned from the parked box at liftoff ({extra:false}), flight
// placements append ({extra:true}).
let modelCells = [];
// Riding portal fills: frozen quads ({box, spec} in the takeoff frame)
// that travel with the hull and are dropped at the stamp, where the portal
// index re-validates the canonical fills.
let ridingFills = [];
// Throttle for the blocked-landing toast: one note per episode, not per tick.
let lastMobToast = 0;
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
  resetVessels();
  resetPads();
  modelCells = [];
  ridingFills = [];
  phase = "parked";
  piloting = false;
  activeVesselId = null;
  takeoffOffer = null;
  pendingOffer = null;
  countdown = 0;
  landingT = 0;
  landingT0 = 0;
  shakeT0 = 0;
  thrustLevel = 0;
  brakeLevel = 0;
  launchBurn = 0;
  plumeT = 0;
  takeoffArmed = true;
  takeoffQueued = false;
  chordWas = false;
  hullFade = 0;
  clearFade();
  rvel.set(0, 0, 0);
  siteVersion = -1;
  landingTarget.set(0, 0, 0);
  defaultVesselBox();
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
  defaultVesselBox();
  // Prebuild the moving hull hidden at the parked spot: liftoff then only
  // clears voxels and unhides, so holding ENTER never hitches on model
  // creation. Looks are resolved from the world like the takeoff scan does,
  // so the prebuilt model matches and the liftoff reuses it.
  modelCells = layout().cells.map((c) => {
    const w = { x: Math.floor(origin.x) + c.x, y: Math.floor(origin.y) + c.y, z: Math.floor(origin.z) + c.z };
    const cell = { lx: c.x, ly: c.y, lz: c.z, id: c.id, v: -1, extra: false };
    if (c.id === GLOWSTONE) cell.v = glowVariantAt(w.x, w.y, w.z);
    else if (c.id === FLOWER) { cell.v = flowerVariantAt(w.x, w.y, w.z); cell.a = flowerAngleAt(w.x, w.y, w.z); }
    return cell;
  });
  ridingFills = [];
  buildMoving(modelCells);
  movingBuiltVersion = siteVersion;
  if (moving?.group) moving.group.visible = false;
  return true;
}

function layout() {
  return rocketSite.grid;
}

// Cells that never fly: every pad plate (infrastructure stays put) is wall
// to the flood — plates neither ride nor conduct it anymore.
function shipExclusions() {
  const out = new Set();
  for (const pad of listPads()) {
    for (let x = pad.minX; x <= pad.maxX; x++)
      for (let z = pad.minZ; z <= pad.maxZ; z++) out.add(x + "," + pad.vy + "," + z);
  }
  return out;
}

// Full-grid vessel: pre-boarding fallback (no player offset yet).
function defaultVesselBox() {
  vesselBox = { x0: 0, x1: ROCKET_SPEC.w - 1, y0: 0, y1: ROCKET_SPEC.h - 1, z0: 0, z1: ROCKET_SPEC.d - 1 };
}

// The rocket holds the player for the whole sequence: the countdown, the
// flight, and the landing animation — during the touchdown the pilot stays
// pinned until the hull has finished fading out, so plain walk physics
// never runs and nothing can walk away mid-sequence.
export function rocketTakesOver() {
  return (piloting && (phase === "countdown" || phase === "flight")) || phase === "landing";
}

// Takeoff gate: WHAT would fly from under the pilot's feet — the
// 18-connected component holding the seed cell, on a pad (union: fresh
// record) or in a parked vessel's box (intersection). Probe mode is exact
// (same flood, no degenerate box). Returns the offer or null.
function takeoffCtx() {
  const exclude = shipExclusions();
  // Lazy refresh keeps the registry exact at the player's reaction scale
  // with no per-edit hook.
  refreshAllVessels(getBlock, exclude);
  return { vessels: listVessels(), pads: listPads(), exclude };
}

export function rocketCanTakeOff() {
  if (!rocketSite.placed || dim !== "over") return null;
  // Old condition, restored: no probe, no stillness — the pilot must stand
  // on a flyable seed. Takeoff is still its own gesture: it never fires
  // while flying or mid-jump.
  if (!takeoffAllowed({ flying: flyOn, jumping: jumpingNow() })) return null;
  return pickUnderFeet(
    getBlock, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z),
    takeoffCtx(),
  );
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
  if (lx < vesselBox.x0 || lx > vesselBox.x1 || ly < vesselBox.y0 || ly > vesselBox.y1 || lz < vesselBox.z0 || lz > vesselBox.z1) return false;
  return moving.solid.has(lx + "," + ly + "," + lz);
}

function modelHas(lx, ly, lz) {
  return moving ? moving.solid.has(lx + "," + ly + "," + lz) : false;
}

function modelCellAt(lx, ly, lz) {
  return modelCells.find((c) => c.lx === lx && c.ly === ly && c.lz === lz) ?? null;
}

// Hull solids in world cells (fraction-fringe exact): the boarding gate
// below reads the mob's whole body through it, so a mid-hold boarder is
// never pinned inside the floor or the walls.
function hullSolidAtWorld(bx, by, bz) {
  if (!moving) return false;
  const fx = Math.floor(origin.x), fy = Math.floor(origin.y), fz = Math.floor(origin.z);
  for (let lx = bx - fx - 1; lx <= bx - fx; lx++)
    for (let ly = by - fy - 1; ly <= by - fy; ly++)
      for (let lz = bz - fz - 1; lz <= bz - fz; lz++) {
        if (!moving.solid.has(lx + "," + ly + "," + lz)) continue;
        if (origin.x + lx < bx + 1 && origin.x + lx + 1 > bx &&
            origin.y + ly < by + 1 && origin.y + ly + 1 > by &&
            origin.z + lz < bz + 1 && origin.z + lz + 1 > bz) return true;
      }
  return false;
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
  const v = vesselBox;
  if (nlx < v.x0 || nlx > v.x1 || nly < v.y0 || nly > v.y1 || nlz < v.z0 || nlz > v.z1) return false;
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
        // Faded riders composite like the hull, never occlude: depthless on
        // the vehicle band (drawn after the liquid sheets), so the water
        // behind a transparent rider survives instead of erasing.
        c.depthWrite = false;
        pairs.push([o, o.material, c, o.renderOrder]);
        o.material = c;
        o.renderOrder = ORDERS.VEHICLE;
      }
    });
    riders.set(mob, pairs);
  }
  rideFade(mob);
}

function unride(mob) {
  const pairs = riders.get(mob);
  if (!pairs) return;
  for (const [mesh, orig, clone, order] of pairs) {
    mesh.material = orig;
    mesh.renderOrder = order;
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
    // Boarding check: every mob inside the vessel box boards, whatever it
    // stands on — but never into the hull itself. A mid-hold boarder whose
    // body overlaps a hull solid is refused (it keeps vetoing the landing
    // as a live body instead of riding), so no rider is ever pinned or
    // stamped inside the floor or the walls.
    const lx = Math.floor(mob.pos.x - ox), ly = Math.floor(mob.pos.y - oy), lz = Math.floor(mob.pos.z - oz);
    if (!rideBoardable(lx, ly, lz, moving.solid, vesselBox)) continue;
    if (!boxFree(hullSolidAtWorld, mob.pos.x, mob.pos.y, mob.pos.z, mob.hw ?? 0.32, mob.h ?? 1)) continue;
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

function pinPilot() {
  // No teleport: keep the boarding offset relative to the hull, so the
  // pilot rides exactly where they stood when the countdown started.
  pos.set(origin.x + pilotLocal.x, origin.y + pilotLocal.y, origin.z + pilotLocal.z);
  vel.set(0, 0, 0);
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
  // The gate already refuses flight and jumps, so pendingOffer alone decides.
  if (!piloting && dim === "over" && rocketSite.placed && phase === "parked" && pendingOffer) {
    t = "Hold SHIFT + ENTER to take off";
  }
  setPrompt(t);
}

function updateCountdown() {
  if (!countdownEl) return;
  if (phase === "countdown") {
    const t = String(Math.max(1, Math.ceil(countdown)));
    // The overlay lags a frame behind the FX when rewritten blindly every
    // tick: write only on change.
    if (countdownEl.textContent !== t) countdownEl.textContent = t;
    if (countdownEl.style.display !== "block") countdownEl.style.display = "block";
  } else if (countdownEl.style.display !== "none") {
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
    chordWas = chordHeld();
    tickVesselBoxes();
    return;
  }
  if (!syncSite()) {
    setPrompt("");
    updateCountdown();
    carveFaces.length = 0;
    chordWas = chordHeld();
    tickVesselBoxes();
    return;
  }
  if (moving?.group) moving.group.visible = phase !== "parked";
  // The launch chord re-arms the moment it is released (see takeoffArmed).
  if (!chordHeld()) takeoffArmed = true;
  if (phase === "parked") {
    // Resolve the exact liftoff gate for the prompt; the offer is
    // re-resolved once on the launch chord (same gate, no drift).
    pendingOffer = rocketCanTakeOff();
    if (pendingOffer) {
      // Fly mode stays on near a vessel: no prompt and no takeoff
      // while it is, takeoff only once it is off.
      if (takeoffArmed && holdTakeoff()) {
        const offer = rocketCanTakeOff();
        if (offer) startCountdown(offer);
        else pendingOffer = null;
      }
    }
  } else if (phase === "countdown") tickCountdown(dt);
  else if (phase === "flight") tickFlight(dt);
  else if (phase === "landing") tickLanding(dt);
  chordWas = chordHeld();
  tickHullFade(dt);
  applyHullFade();
  updatePrompt();
  updateCountdown();
  flushCarveFaces();
  tickVesselBoxes();
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

function startCountdown(offer) {
  severHook();
  // Adopt the resolved frame first, then capture the boarding spot relative
  // to it: the pin keeps this offset for countdown, flight and landing, so
  // boarding from any vessel never teleports the player.
  origin.set(offer.origin.x, offer.origin.y, offer.origin.z);
  pilotLocal.set(pos.x - origin.x, pos.y - origin.y, pos.z - origin.z);
  vesselBox = offer.box;
  takeoffOffer = offer;
  // The record follows the hull from here, not at liftoff: the snapshot is
  // about to clear the ship from the store, so a still-parked record would
  // read as an emptied ghost and prune itself — cancelling the countdown
  // would then restore voxels with no record left to fly them. Flying
  // records are exempt from the sweep; the cancel path re-parks through
  // stamp() via activeVesselId, and liftoff just confirms the same status.
  if (offer.kind === "vessel" && offer.vesselId && updateVessel(offer.vesselId, { status: "flying" })) {
    activeVesselId = offer.vesselId;
  }
  snapshot(offer.ship);
  piloting = true;
  // The chord is spent: relaunch needs a fresh release first. A relaunch
  // queued mid-landing fired through finalizeLanding instead.
  takeoffArmed = false;
  takeoffQueued = false;
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
    // Register the flying ship: pad takeoffs (union) always mint a fresh
    // record; vessel takeoffs move their record with the ship. Donor vessels
    // overlapped by the ship shrink (and split when cut).
    const flyingCells = modelCells.filter((c) => !c.extra);
    const flyingKeys = new Set(flyingCells.map((c) =>
      Math.floor(origin.x) + c.lx + "," + Math.floor(origin.y) + c.ly + "," + Math.floor(origin.z) + c.lz));
    stealCellsFromVessels(getBlock, flyingKeys, takeoffOffer?.vesselId ?? null, shipExclusions());
    if (takeoffOffer?.vesselId && takeoffOffer?.kind === "vessel" && updateVessel(takeoffOffer.vesselId, {
      status: "flying",
      cells: flyingCells.map((c) => ({ lx: c.lx, ly: c.ly, lz: c.lz })),
      box: { ...vesselBox },
    })) {
      activeVesselId = takeoffOffer.vesselId;
    } else {
      activeVesselId = registerVessel({
        status: "flying",
        ox: Math.floor(origin.x), oy: Math.floor(origin.y), oz: Math.floor(origin.z),
        cells: flyingCells.map((c) => ({ lx: c.lx, ly: c.ly, lz: c.lz })),
        box: { ...vesselBox },
      }).id;
    }
    // The touchdown cloud at factor 1; the thump below reads the same
    // curve input the cloud was built with.
    landingDust(BOOST_SPEED);
    shakeThump(1, "liftoff");
  }
}

// Nozzle world positions: the ship's THRUSTER cells, just under the hull.
// A shipless exotic (no thruster aboard) falls back to the vessel bottom
// corners so every flight still reads engine-driven.
function thrusterNozzles() {
  const out = [];
  for (const c of modelCells) {
    if (c.id !== THRUSTER || c.extra) continue;
    out.push([origin.x + c.lx + 0.5, origin.y + c.ly - 0.15, origin.z + c.lz + 0.5]);
  }
  if (out.length || !vesselBox) return out;
  const v = vesselBox;
  for (const [lx, lz] of [[v.x0, v.z0], [v.x1, v.z0], [v.x0, v.z1], [v.x1, v.z1]])
    out.push([origin.x + lx + 0.5, origin.y + v.y0 - 0.15, origin.z + lz + 0.5]);
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
  playFx("exhaust", { nozzles, cone: ROCKET_FX_DEFAULT_CONE });
  shake(SHAKE.burn);
}

// Landing-like smoke wrapping the ship while the engines spool: height and
// density scale with the liftoff approach, ending at a max-speed boosted
// landing. Shared by the landing fade: the touchdown rumble replays the
// same smoke, scaled by the touchdown and decaying with the fade.
function vesselSmoke() {
  const v = vesselBox;
  return {
    x: origin.x + v.x0, y: origin.y + v.y0, z: origin.z + v.z0,
    halfW: (v.x1 - v.x0 + 1) * 0.5, halfD: (v.z1 - v.z0 + 1) * 0.5,
    hullHeight: v.y1 - v.y0 + 1,
  };
}

function spawnCountdownSmoke(progress) {
  playFx("landing", {
    ...vesselSmoke(),
    factor: countdownFactor(progress),
  });
}

// Read the ship out of the store and turn it into a moving model: only the
// resolved ship cells ride (disconnected cells stay parked); the ship's own
// cells stay protected while they fly. The solid column above the ship (one
// vessel height) is destroyed at liftoff — liquids never carve — the ascent
// carve taking over after that.
function snapshot(shipCells) {
  const ox = Math.floor(origin.x), oy = Math.floor(origin.y), oz = Math.floor(origin.z);
  const box = vesselBox;
  const inShip = new Set(shipCells.map(([x, y, z]) => x + "," + y + "," + z));
  // Portal fills riding the hull: every live fill whose whole frame ring
  // sits in the ship's cells rides along as a frozen quad in the takeoff
  // frame. Collected before the voxels clear — the strict rule needs
  // standing rings, collected from live frames before the clear loop.
  // Each entry carries the takeoff window key plus a position-free ride
  // signature (see portalfills.js): the stamp re-validates at the landing
  // min, so the key alone never matches a translated landing.
  ridingFills = ridingFillsFor(inShip).map(({ box: b, ring, spec, key }) => ({
    x: b.cx - ox, y: b.cy - oy, z: b.cz - oz,
    sx: b.sx, sy: b.sy, sz: b.sz, spec, key,
    sig: rideSigFromKey(key, b, ring.length),
  }));
  const cleared = [];
  const scanned = [];
  const docks = [];
  for (let y = oy + box.y0; y <= oy + box.y1; y++)
    for (let x = ox + box.x0; x <= ox + box.x1; x++)
      for (let z = oz + box.z0; z <= oz + box.z1; z++) {
        if (!inShip.has(x + "," + y + "," + z)) continue;
        docks.push([x, y, z]);
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        unprotectCell(x, y, z);
        // The exact look rides along: a glowstone's variant, a flower's
        // variant + boarded angle (the angle only ever rides on flowers).
        const cell = { lx: x - ox, ly: y - oy, lz: z - oz, id, v: -1, extra: false };
        if (id === GLOWSTONE) {
          cell.v = glowVariantAt(x, y, z);
          clearGlowstoneAt(x, y, z);
        } else if (id === FLOWER) {
          cell.v = flowerVariantAt(x, y, z);
          cell.a = flowerAngleAt(x, y, z);
          clearFlowerAt(x, y, z);
        }
        clearReactionAt(x, y, z);
        setBlock(x, y, z, AIR);
        if (y >= MOON_MIN_Y) markMoonDirty();
        scanned.push(cell);
        cleared.push([x, y, z]);
      }
  modelCells = scanned;
  releaseDockedProtection();
  dockedCells = docks;
  for (const [x, y, z] of docks) protectCell(x, y, z);
  // Column above the sweep zone, one vessel height: solids destroyed at
  // liftoff (protected cells and worldgen frames stay, liquids never carve;
  // the climb carve handles everything higher on the way up).
  {
    const keepFrames = new Set(villageFrames);
    let tntUp = false;
    const upCleared = [];
    const vesselH = vesselBox.y1 - vesselBox.y0 + 1;
    for (let y = oy + box.y1 + 1; y <= oy + box.y1 + vesselH; y++)
      for (let x = ox + box.x0; x <= ox + box.x1; x++)
        for (let z = oz + box.z0; z <= oz + box.z1; z++) {
          const id = getBlock(x, y, z);
          if (id === AIR) continue;
          if (isLiquid(id)) continue;
          if (isCellProtected(x, y, z)) continue;
          if (keepFrames.has(key(x, y, z))) continue;
          if (isTntLike(id)) tntUp = true;
          clearVesselCell(x, y, z, id);
          upCleared.push([x, y, z]);
        }
    if (tntUp) clearTNTBox(ox + box.x0, oy + box.y1 + 1, oz + box.z0, ox + box.x1, oy + box.y1 + vesselH, oz + box.z1);
    for (const c of upCleared) cleared.push(c);
    // The column torn open above the hull at liftoff: its walls burst too.
    collectCarveFaces(upCleared);
  }
  if (cleared.length) {
    notePortalEdits(cleared);
    queueRefreshBlocks(cleared);
    // The liftoff sweep may have eaten parked neighbours stacked above.
    refreshAllVessels(getBlock, shipExclusions());
  }
  // Reuse the prebuilt hidden model when it already matches the scan —
  // cells and riding fills alike, so a stock hull carrying a portal still
  // rebuilds its frozen quads instead of flying quad-less.
  if (!(moving && movingBuiltVersion === rocketSite.version && sameModel(moving.cells, modelCells) && sameFills(moving.fills, ridingFills))) {
    buildMoving(modelCells);
    movingBuiltVersion = rocketSite.version;
  }
}

// Model identity: position + id plus the look a cell carries (a glowstone
// variant, a flower variant and boarded angle — extra flight placements
// never carry a look). Anything the snapshot resolved differently from
// the prebuilt model rebuilds it.
function cellKey(c) {
  return c.lx + "," + c.ly + "," + c.lz + ":" + c.id + ":" + (c.v ?? -1) + ":" + (c.a ?? 0);
}
function sameModel(a, b) {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(cellKey));
  return b.every((c) => keys.has(cellKey(c)));
}

// Fill identity for the rebuild decision: local box plus the family key
// (the ride is defined by the ring: same hole, same family, reuse).
function fillKey(f) {
  return f.x + "," + f.y + "," + f.z + ":" + f.sx + "x" + f.sy + "x" + f.sz + ":" + f.spec.key;
}
function sameFills(a, b) {
  if ((a ?? []).length !== (b ?? []).length) return false;
  const keys = new Set((a ?? []).map(fillKey));
  return (b ?? []).every((f) => keys.has(fillKey(f)));
}

function buildMoving(cells) {
  removeMoving();
  const group = new THREE.Group();
  group.position.copy(origin);
  const byId = new Map();
  const byFlowerVariant = new Map();
  const solid = new Set();
  for (const c of cells) {
    solid.add(c.lx + "," + c.ly + "," + c.lz);
    // Flowers ride as their own static-world shape — the baked per-variant
    // cluster with the boarded Y angle — breathing with the hull instead of
    // the opaque cutout cube.
    if (c.id === FLOWER) {
      const v = Math.max(0, Math.min(FLOWER_GEOS.length - 1, c.v ?? 0));
      if (!byFlowerVariant.has(v)) byFlowerVariant.set(v, []);
      byFlowerVariant.get(v).push(c);
      continue;
    }
    if (!byId.has(c.id)) byId.set(c.id, []);
    byId.get(c.id).push(c);
  }
  const meshes = [];
  const dummy = new THREE.Object3D();
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
    meshes.push({ mesh, mats: movingMatsFor(id) });
  }
  for (const [v, list] of byFlowerVariant) {
    const mats = [flightFlowerMat(v)];
    // Single material, not the fade array: the baked cluster geometry
    // carries no BoxGeometry-style groups, so a material array would draw
    // per-group — i.e. nothing at all.
    const mesh = new THREE.InstancedMesh(FLOWER_GEOS[v], mats[0], list.length);
    for (let i = 0; i < list.length; i++) {
      dummy.position.set(list[i].lx + 0.5, list[i].ly + 0.5, list[i].lz + 0.5);
      dummy.rotation.set(0, list[i].a ?? 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = ORDERS.VEHICLE;
    group.add(mesh);
    meshes.push({ mesh, mats });
  }
  // Portal fills whose whole ring rides along: frozen quads in the takeoff
  // frame, breathing with the hull. Never colliders, never pickable,
  // dropped at stamp where the portal index re-validates the canonical
  // fills — so no travel ever fires through a moving fill.
  for (const f of ridingFills) {
    const mats = [flightFillMat(f.spec)];
    // Single material, not the fade array: the slab reuses the shared
    // 6-group box geometry, and a 1-long array leaves five groups without
    // a material.
    const mesh = new THREE.Mesh(boxGeo, mats[0]);
    mesh.position.set(f.x, f.y, f.z);
    mesh.scale.set(f.sx, f.sy, f.sz);
    mesh.renderOrder = ORDERS.VEHICLE;
    group.add(mesh);
    meshes.push({ mesh, mats });
  }
  sceneRef.add(group);
  moving = { group, solid, cells, meshes, fills: ridingFills };
  applyHullFade();
}

function applyHullFade() {
  if (!moving?.meshes) return;
  // One material set per mesh, opacity only: no swap, no pop at either end.
  for (const { mats } of moving.meshes) {
    for (const m of mats) {
      const base = m.userData.baseOpacity ?? 1;
      const target = m.userData.fadeOpacity ?? Math.min(base, 0.5);
      m.opacity = base + (target - base) * hullFade;
    }
  }
}

// One landing decision for the whole descent: the touch pose is set, then
// the hull box must be free of live bodies. A live blocker holds the ship
// (toast, retry every tick, never abandoned) until it walks out of the
// footprint — the hull never lands on one, never traps one inside, and
// never moves one. The pilot keeps steering the whole time.
function tryStartLanding(dt) {
  if (!clearLandingBox()) { holdAtMargin(dt); return false; }
  startLanding();
  return true;
}

// Landing gate: the hull never stamps with a live body inside its volume.
// Live blockers hold the ship (no bury, no trap, no shove — the veto never
// moves a mob, it just refuses to land on one) until the footprint clears.
function clearLandingBox() {
  const box = sweptBoxCells(origin.x, origin.y, origin.z, vesselBox);
  return landingBlockers(allMobs(), dim, box).length === 0;
}

// Hover veto (safety net): a descent/lateral candidate whose box already
// overlaps a live body funnels through the hold — the band hold below
// normally catches the floor before that, but a spawned-in or teleported
// overlap still holds instead of burying the hull. Pure detection, same as
// the stamp veto: it never moves a mob.
function hoverVetoAt(ox, oy, oz) {
  return landingBlockers(allMobs(), dim, sweptBoxCells(ox, oy, oz, vesselBox)).length > 0;
}

// Safety-margin rule: while a live body stands under the footprint the
// hull approaches the tallest body top plus the margin and holds there, so
// bodies walk under it. The floor is an origin Y: box bottom float is
// origin.y + vesselBox.y0, hence tallest top + margin - y0. -Infinity when
// no body is under the footprint (free descent to the ground).
// Parameterized so the Down-held slide can read a destination column.
function marginFloorY(ox = origin.x, oy = origin.y, oz = origin.z) {
  const box = sweptBoxCells(ox, oy, oz, vesselBox);
  const top = tallestBlockerTop(allMobs(), dim, box);
  if (!Number.isFinite(top)) return -Infinity;
  return top + LANDING_MARGIN - vesselBox.y0;
}

// Hold-zone probe: the band hold catches the descent at this XZ, so the
// hull holds there instead of sinking onto the herd.
function holdZoneAt(ox, oz) {
  const floorY = marginFloorY(ox, origin.y, oz);
  return Number.isFinite(floorY) && origin.y <= floorY + HOLD_BAND;
}

// Lateral slide veto, Down-held only: a sideways step is refused when the
// destination column's tallest body would overlap the hull — its top above
// the hull bottom, a real collision. A column standing within the margin
// passes: the band hold below lifts the hull over it at slew pace, so the
// glide rides the herd instead of stopping at every taller body. Clear
// columns always pass. Pure detection, same as every other veto: it never
// moves a mob.
function slideVetoAt(nx, nz) {
  const dest = marginFloorY(nx, origin.y, nz);
  if (!Number.isFinite(dest)) return false;
  return dest - LANDING_MARGIN > origin.y + 1e-9;
}

// Blocked-descent hold: track the margin floor at most HOLD_SLEW per
// second in either direction (never a snap), stop the descent, keep the
// pilot steering and the model glued to the hull, and say why
// (throttled). Static while the same bodies block — a fast-oscillating
// floor (milling herd, glide across mixed tops) averages out to ~static
// while a genuine lower/higher floor is followed within ~0.2 s; when the
// herd lowers the ship follows down, and when the box clears the landing
// plays in full. The approach band guarantees the first catch lands above
// the floor, and the slew never dives past it, so no path can bury the
// hull in a body. Every blocked path funnels through here.
function holdAtMargin(dt) {
  const floorY = marginFloorY();
  if (Number.isFinite(floorY)) {
    const d = floorY - origin.y;
    const maxStep = HOLD_SLEW * dt;
    origin.y += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
  }
  holdForBlockedLanding();
}

// Hold instead of landing: stop the descent, keep the pilot steering and
// the model glued to the hull, and say why (throttled) until the box is
// clear and the landing can finally play in full.
function holdForBlockedLanding() {
  rvel.y = Math.max(0, rvel.y);
  if (moving?.group) moving.group.position.copy(origin);
  if (piloting) pinPilot();
  const now = performance.now();
  if (now - lastMobToast < 2000) return;
  lastMobToast = now;
  toast("Can't land here: there are mobs");
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
    // target instead of stepping, so LEFT/RIGHT never jolts. While
    // ArrowDown is held the vector keeps a walk-pace floor even when the
    // hold zeroes the climb, so the mouse heading and the strafe glide
    // the hull in XZ over the herd — the Y hold below is rate-limited,
    // so gliding across mixed tops reads as a swell, never a flicker.
    // Free descent keeps the same vector, climb-slaved as always.
    _hv.set(0, 0, 0);
    _hv.add(_fwd);
    if (keys["ArrowRight"]) _hv.add(_right);
    if (keys["ArrowLeft"]) _hv.sub(_right);
    const hBase = Math.abs(rvel.y) * Math.max(0, Math.cos(pitch));
    _hv.normalize().multiplyScalar(keys["ArrowDown"] ? Math.max(hBase, DOWN_SLIDE) : hBase);
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
  // Unified rule: the whole bbox carves, every substep and every direction
  // (non-liquids only — liquids never carve), even held or paused — a held
  // glide carves through whatever it overlaps. Terminal descent (dy < 0)
  // is the one exception: x/z clamp to the posed integer box at floor(o)
  // — the bbox once landed — so a fractional fringe column the posed ship
  // never touches survives (diagonal-low cliff/house landings); y keeps
  // the swept range. Pause wins over further
  // motion only: strictly descending (dy < 0) with a non-air block
  // directly under the bbox, the ship poses on first contact instead of
  // sinking — belly embedded snaps up one row (oblique cliff contact), the
  // cell below touching lands in place.
  const dist = rvel.length() * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.6));
  const sx = rvel.x * dt / steps, sy = rvel.y * dt / steps, sz = rvel.z * dt / steps;
  let carvedAny = false;
  const bw = vesselBox.x1 - vesselBox.x0, bd = vesselBox.z1 - vesselBox.z0;
  for (let i = 0; i < steps; i++) {
    origin.x += sx; origin.y += sy; origin.z += sz;
    if (origin.x < -WORLD_RADIUS) { origin.x = -WORLD_RADIUS; rvel.x = 0; }
    if (origin.x > WORLD_RADIUS - bw) { origin.x = WORLD_RADIUS - bw; rvel.x = 0; }
    if (origin.z < -WORLD_RADIUS) { origin.z = -WORLD_RADIUS; rvel.z = 0; }
    if (origin.z > WORLD_RADIUS - bd) { origin.z = WORLD_RADIUS - bd; rvel.z = 0; }
    if (origin.y < 1) { origin.y = 1; rvel.y = Math.max(0, rvel.y); }
    // Mob-aware lateral slide, Down-held only (see slideVetoAt): refuse
    // the XZ axes whose destination column would overlap a body, X-only
    // then Z-only, so steering glides along the herd instead of into it.
    // The systematic carve runs every substep even held, so a refused slide
    // carves through the rock it overlaps instead of merging into it.
    if (keys["ArrowDown"] && slideVetoAt(origin.x, origin.z)) {
      origin.x -= sx; origin.z -= sz;
      origin.x += sx;
      if (slideVetoAt(origin.x, origin.z)) origin.x -= sx;
      origin.z += sz;
      if (slideVetoAt(origin.x, origin.z)) origin.z -= sz;
    }
    // Systematic carve first — unconditional, every direction, even held
    // or paused: the descent-aware box (`flightCarveBox`) is the authority,
    // whatever rock it reaches is torn out, so a held glide carves through
    // the wall it overlaps instead of merging into it. Descending, x/z clamp
    // to the posed box so the fringe past the landed bbox survives; level
    // flight and climbs keep the expanded box covering the fractional fringe
    // so a 1-block hull at full speed leaves no wall remnant behind.
    // A budget cut stops the hull there instead of ghosting through rock.
    const { exhausted } = carveAt(origin, sy < 0);
    carvedAny = true;
    if (exhausted) break;
    // Herd hold (mob safety, position-based): a body standing
    // under the footprint pins the approach floor (tallest top + 0.5),
    // and the hold catches the hull a whole band above it — before any
    // substep can cross below — then tracks it at slew pace. The floor
    // is therefore a fixed point (no sink-then-snap cycle, no up/down
    // flicker) that follows the herd both ways: a taller body walking
    // under lifts the hull, a lower one lets it settle, and the landing
    // resumes the moment the footprint clears.
    if (sy <= 0 && holdZoneAt(origin.x, origin.z)) {
      holdAtMargin(dt);
      break;
    }
    // Ground stop, strictly descending (dy < 0), priority over further
    // motion: a non-air block directly under the bbox — the ship poses on
    // first contact instead of sinking. A belly already inside a block
    // (liquids and protected cells survive the carve — e.g. belly in water
    // over the lake bed snaps up onto the surface) snaps up one row
    // first, then the single landing decision runs.
    if (sy < 0 && groundBelowTouch()) {
      if (footprintTouch(Math.floor(origin.y) + vesselBox.y0)) {
        const ny = Math.floor(origin.y) + 1;
        if (hoverVetoAt(origin.x, ny, origin.z)) {
          holdAtMargin(dt);
          break;
        }
        origin.y = ny;
      }
      if (tryStartLanding(dt)) return;
      break;
    }
    // Still blocked after the carve (protected cells, budget cut): hold
    // position laterally instead of embedding — never a voxel write.
    // Reads the same descent-aware box as the carve, so a fringe column
    // outside the landed bbox never pins the hull.
    if (sy <= 0 && boxBlocked(sy < 0)) {
      origin.x -= sx; origin.z -= sz;
      rvel.x = 0; rvel.z = 0;
    }
  }
  if (carvedAny) refreshAllVessels(getBlock, shipExclusions());

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

  if (rvel.y < 0 && groundBelowTouch()) tryStartLanding(dt);
}

// Exhaust jet under the four nozzles while the engines push, always
// downward. The look comes from the spec (src/fx/rocketfx.js): an ember jet
// plus a grey puff, both denser and faster with the thrust level.
function spawnThrustPlume(L) {
  const nozzles = thrusterNozzles();
  if (!nozzles.length) return;
  playFx("plume", { nozzles, ramp: { level: L }, cone: ROCKET_FX_DEFAULT_CONE });
}

// Underside contact (pure rules in ./rocketbox.js, driven here): any
// non-air block (solids, liquids and flowers all hold the ship up, so it
// sits on water and meadows alike instead of sinking through them).
// Landing contact: the underside posed on a block.
function footprintTouch(by) {
  return footprintTouches(getBlock, origin.x, origin.z, vesselBox, by);
}

// Stop rule: a non-air block directly under the bbox — the ship poses on
// first contact instead of crushing it.
function groundBelowTouch() {
  return stopBelow(getBlock, origin.x, origin.y, origin.z, vesselBox);
}

// Lateral fallback: a hull cell still overlapping a solid after the carve
// (protected cells, budget cut) holds laterally instead of embedding —
// never a voxel write. Liquids never block. Descent-aware like the carve
// (same `flightCarveBox` selector): a descending hull tests the posed x/z
// box, so fringe outside the landed bbox never blocks.
function cellBlocks(x, y, z) {
  const id = getBlock(x, y, z);
  if (id === AIR || isLiquid(id)) return false;
  return true;
}
function boxBlocked(descending = false) {
  const b = flightCarveBox(origin.x, origin.y, origin.z, vesselBox, descending);
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++)
      for (let z = b.z0; z <= b.z1; z++)
        if (cellBlocks(x, y, z)) return true;
  return false;
}

function startLanding() {
  phase = "landing";
  thrustLevel = 0;
  brakeLevel = 0;
  landingT = 0;
  exhaustT = 0;
  takeoffQueued = false;
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
    // boarding spot, released only once the hull has faded out.
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
  // boarding spot, no walk, no fly, no relaunch until the hull has faded out and
  // the camera has stabilized (fade, then settle freeze). A fresh
  // SHIFT+ENTER press still counts: latched here, fired at freeze end.
  pinPilot();
  if (chordHeld() && !chordWas) takeoffQueued = true;
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
          ...vesselSmoke(),
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
  // A mob that wandered under the fading hull holds the stamp — same gate,
  // same toast, retried every tick. Nothing is ever buried or displaced.
  if (!clearLandingBox()) { holdForBlockedLanding(); return; }
  hullFade = 0;
  clearFade();
  stamp();
  // The freeze ends here: a relaunch latched mid-animation fires on the
  // same tick while still held (released first cancels), so reprise is
  // immediate — no parked frame, no release-and-press round trip.
  if (takeoffQueued && holdTakeoff()) {
    const offer = rocketCanTakeOff();
    if (offer) startCountdown(offer);
  }
  takeoffQueued = false;
}

// Clear one world cell with vessel index cleanup (glowstone/flower/
// reaction indexes, moon dirty flag). Every vessel write path (liftoff
// column, systematic sweep, landing stamp) clears through here, so index
// handling cannot drift between them. Callers own the guards (liquids,
// protected cells, worldgen frames) and the TNT bookkeeping — this owns
// only the removal.
function clearVesselCell(x, y, z, id) {
  if (id === GLOWSTONE) clearGlowstoneAt(x, y, z);
  else if (id === FLOWER) clearFlowerAt(x, y, z);
  clearReactionAt(x, y, z);
  setBlock(x, y, z, AIR);
  if (y >= MOON_MIN_Y) markMoonDirty();
}

// The single carve primitive behind the systematic sweep: clears every
// non-liquid integer cell of the given box from its own bottom up
// (never below it), so the margin hole under a held hull survives.
// Callers pass the swept box, except a descending hull which passes the
// terminal (posed x/z) box. Liquids never carve.
// Returns { cleared, exhausted } — exhausted when the budget cut the pass
// short, so a sweeping caller must stop the hull there instead of
// advancing through uncarved rock (the paged queue reads as a slow
// advance).
function carveBoxAt(o, b) {
  const { x0, y0, z0, x1, y1, z1 } = b;
  const cleared = [];
  let tntHit = false;
  let budget = CARVE_MAX;
  let exhausted = false;
  outer:
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        if (isLiquid(id)) continue;
        if (isCellProtected(x, y, z)) continue;
        if (isTntLike(id)) tntHit = true;
        clearVesselCell(x, y, z, id);
        cleared.push([x, y, z]);
        if (--budget <= 0) { rvel.set(0, 0, 0); exhausted = true; break outer; }
      }
  if (!cleared.length) return { cleared, exhausted };
  if (tntHit) clearTNTBox(x0, y0, z0, x1, y1, z1);
  notePortalEdits(cleared);
  queueRefreshBlocks(cleared);
  // Rock dust at the ship: the volume the vessel tore loose, scaled with
  // the speed it tore it at.
  if (cleared.length > CARVE_DUST_MIN_CELLS) {
    const v = vesselBox;
    playFx("carve", {
      x: o.x + v.x0, y: o.y + v.y0, z: o.z + v.z0,
      halfW: (v.x1 - v.x0 + 1) * 0.5,
      halfD: (v.z1 - v.z0 + 1) * 0.5,
      amount: cleared.length,
      factor: speedFactor(rvel.length(), BOOST_SPEED),
    });
  }
  // The rock this pass tore open: its exposed faces are the walls the
  // rocket just burst through, and they carry the explosive FX.
  collectCarveFaces(cleared);
  return { cleared, exhausted };
}

// Carve the box at a pose (the systematic authority): the swept box in
// level flight and climb, the posed x/z box while descending — one
// `flightCarveBox` selector shared with the blocked-lateral fallback.
function carveAt(o, descending = false) {
  return carveBoxAt(o, flightCarveBox(o.x, o.y, o.z, vesselBox, descending));
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
    ...vesselSmoke(),
    factor: speedFactor(impact, BOOST_SPEED),
  });
}

// Landing stamp: the underside never crushes anything — the ship poses on
// first contact. Solid terrain colliding with stamped hull cells (flanks and
// top, e.g. a hillside entering the box above the pose plane) is carved;
// liquids are displaced silently; protected cells and worldgen frames are
// never collateral (a hull cell landing on one is dropped from the record
// instead of overwriting it). Terrain inside hull air (a pillar in the
// cabin void) survives untouched. Blocks overlapping the pilot or a rider
// at their final spots are carved too (same guards), so nobody lands buried
// in a surviving fringe wall. Portal frames heal through the portal
// index: a broken frame loses its fill like any portal.
function stamp() {
  releaseDockedProtection();
  const ox = Math.round(origin.x), oy = Math.round(origin.y), oz = Math.round(origin.z);
  const carry = { x: pos.x - origin.x, y: pos.y - origin.y, z: pos.z - origin.z };
  const keepFrames = new Set(villageFrames);
  const carved = [];
  const tntCells = [];
  const worldCells = [];
  const keptCells = [];
  // Hull solid cells at their final spots: the passenger clearance below
  // never touches these — the hull owns its own footprint.
  const hullKeys = new Set();
  for (const c of modelCells) if (c.id !== AIR) hullKeys.add((ox + c.lx) + "," + (oy + c.ly) + "," + (oz + c.lz));
  // Shared clear kernel behind the passenger clearance and the hull stamp:
  // solids only, same guards, TNT-noted, index-cleaned through
  // `clearVesselCell`. Hull-air cells (c.id === AIR) never reach it.
  const tryClearTerrain = (x, y, z) => {
    const cur = getBlock(x, y, z);
    if (cur === AIR || isLiquid(cur)) return false;
    if (isCellProtected(x, y, z) || keepFrames.has(key(x, y, z))) return false;
    if (isTntLike(cur)) tntCells.push([x, y, z]);
    clearVesselCell(x, y, z, cur);
    carved.push([x, y, z]);
    return true;
  };
  // Passenger clearance first: every solid cell the pilot or a rider would
  // overlap at their final spots is torn out (liquids, protected cells and
  // worldgen frames survive like everywhere else), so a fringe wall the
  // posed hull never touched cannot bury its crew.
  {
    const bodies = [[ox + carry.x, oy + carry.y, oz + carry.z, PLAYER_HW, PLAYER_H]];
    for (const [mob] of riders) {
      const rx = ox + (mob.pos.x - origin.x), ry = oy + (mob.pos.y - origin.y), rz = oz + (mob.pos.z - origin.z);
      bodies.push([rx, ry, rz, mob.hw ?? 0.32, mob.h ?? 1]);
    }
    const seen = new Set();
    for (const [bx, by, bz, hw, h] of bodies) {
      for (const [x, y, z] of bodyOverlapCells(bx, by, bz, hw, h)) {
        const k = x + "," + y + "," + z;
        if (seen.has(k) || hullKeys.has(k)) continue;
        seen.add(k);
        tryClearTerrain(x, y, z);
      }
    }
  }
  // The ship stamps back exactly as it flew — destructible like any blocks.
  for (const c of modelCells) {
    const x = ox + c.lx, y = oy + c.ly, z = oz + c.lz;
    if (c.id !== AIR) tryClearTerrain(x, y, z);
    setBlock(x, y, z, c.id);
    if (y >= MOON_MIN_Y) markMoonDirty();
    if (c.id === GLOWSTONE) {
      if (c.v !== undefined && c.v >= 0) noteGlowstonePlaceShared(x, y, z, c.v);
      else noteGlowstonePlace(x, y, z);
    } else if (c.id === FLOWER) {
      // Exact-look restore: the snapshot saved the boarded variant + angle,
      // so a round trip never reshuffles the bloom.
      if (c.v !== undefined && c.v >= 0) noteFlowerPlaceShared(x, y, z, c.v, c.a ?? 0);
      else noteFlowerPlace(x, y, z);
    }
    worldCells.push([x, y, z]);
    if (!c.extra) keptCells.push({ lx: c.lx, ly: c.ly, lz: c.lz });
  }
  // TNT index hygiene, point-exact: every destroyed TNT cell drops its
  // records (player-placed index, queued chains, displaced liquids), so no
  // chained blast fires from an empty cell after the landing. Point boxes —
  // never the carved bounds — so live neighbouring TNT stays tracked.
  for (const [x, y, z] of tntCells) clearTNTBox(x, y, z, x, y, z);
  pos.set(ox + carry.x, oy + carry.y, oz + carry.z);
  rocketSite.origin = { x: ox, y: oy, z: oz };
  origin.set(ox, oy, oz);
  // The record follows the ship: same id, new origin, box recomputed tight
  // (origin = min) from the stamped cells. Neighbours eaten by the flank
  // carve shrink or split through the lazy refresh. A ship with no block
  // left disappears from the registry instead of lingering as a ghost.
  if (activeVesselId) {
    if (!keptCells.length) {
      removeVessel(activeVesselId);
    } else {
      const wb = shipBounds(worldCells);
      updateVessel(activeVesselId, {
        status: "parked", ox, oy, oz, cells: keptCells,
        box: wb ? { x0: wb.x0 - ox, x1: wb.x1 - ox, y0: wb.y0 - oy, y1: wb.y1 - oy, z0: wb.z0 - oz, z1: wb.z1 - oz }
          : { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 },
      });
      refreshAllVessels(getBlock, shipExclusions());
    }
    activeVesselId = null;
  }
  releaseAllRiders();
  // Mark the rode-along fills before the portal index re-validates them:
  // stamped fills skip the validation fade-in, and the canonical fill is
  // created before the riding quad drops (overlap in the same tick), so
  // the handoff never renders an empty frame — translated or not.
  if (ridingFills.length) noteStampedRides(ridingFills.map((f) => f.key), ridingFills.map((f) => f.sig));
  ridingFills = [];
  phase = "parked";
  landingT = 0;
  thrustLevel = 0;
  hullFade = 0;
  clearFade();
  const touched = carved.concat(worldCells);
  if (touched.length) {
    notePortalEdits(touched);
    refreshBlocks(touched);
  }
  // The riding quad drops only once the canonical fills exist above
  // (overlap, then remove): no tick renders zero fills.
  removeMoving();
}
