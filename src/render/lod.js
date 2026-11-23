// Celestial LOD state machine: meshes for in-range/touched bodies, exact
// proxies for the near rest, shared instanced impostors for the far rest,
// so the scene object count stays flat no matter how many planets the sky
// holds. Below the Moon fade band it only stages proxies (no queue, no
// dispose — the legacy streaming owns the ground).
// The proxy shows until its body
// is fully meshed (covering the block-generation pop-in), then crossfades
// out over the voxels AT THE MESH RANGE — celestial meshes are region
// meshes (scene-level, never fog-culled), so the swap lands where the
// voxel staircase is still sub-pixel — and fades back in over the meshes
// inside the dispose hysteresis band before the drop, so leaving never
// snaps. The proxy also fades out when the camera enters the body (grapple
// contact and cheat flybys never see near-plane streaks).
// Voxels are untouched (the store owns them) — only meshes are disposed and
// rebuilt through the existing budgeted celestial queue.
// Decisions come from the pure lodAction/departureStep/proxyTierFor in planets.js;
// this module applies the side effects with per-frame budgets: on disposal the meshes stay
// until the proxy fades back in over them (mirror of the arrival reveal —
// leaving never snaps), reveal-timed fade-out on convergence, both at the
// same speed so the two directions read identically. The
// proxy is co-located and co-sized with the real body, so the crossfade stays registered from any
// viewpoint, at grapple speed.
//
// Cost control: the chunk-mesh scan and queue/dispose decisions run at 10 Hz;
// every frame only advances active crossfades and refreshes proxy opacity
// (a few dozen material writes, no chunk scans).
import {
  bodySpecs, bodyTouched, bodyWiped, lodAction, MESH_DIST, MESH_OUT, REVEAL_TIME, departureStep,
  CELESTIAL_FADE_Y, proxyTierFor,
} from "../world/planets.js";
import { bodyChunkCenters, bodyChunkKeys } from "../world/moon.js";
import { regionByKey } from "./regions.js";
import { isChunkMeshed, queueCelestialChunks, dropChunkMesh, purgeChunkQueues } from "./mesher.js";
import {
  ensureProxy, hasProxy, dropFullProxy, setProxyVisible, setProxyOpacity, resetProxies,
  buildLiteProxies, ensureLiteProxies, setLiteBodyVisible, setLiteOpacity,
} from "./proxies.js";

// Whole-body dispose completions per frame: one body is ~118 chunk
// disposes, all in the same frame (all-or-nothing per body, so no
// half-meshed planet ever shows without its proxy).
const DISPOSE_BODIES_PER_FRAME = 4;
// Full-proxy builds per decide: approaching bodies upgrade from lite to
// full here — the lite instances keep covering meanwhile, so a spent
// budget only delays an invisible swap, never pops.
const FULL_BUILDS_PER_DECIDE = 2;
// Cover fade-in (meshes missing — pop-in cover, fast) vs blend fade-in
// (meshes held — symmetric with the reveal, 1/REVEAL_TIME, so arrival and
// departure read identically at any speed). A slow cover would ramp over
// the void; a fast blend would pop over drawn voxels.
const FADE_IN_FAST = 1 / 0.4;
// Proxy crossfade: in and out over REVEAL_TIME, both speed-adaptive (see
// tickLod) — arrival and departure read identically at any speed.
const DECIDE_DT = 0.1;
const cache = new Map(); // body key -> { spec, centers, keys, queued, fade, target, isMoon }
let acc = DECIDE_DT; // first tick decides immediately

export function resetLod() {
  // Pending departures land now: wanted-dead meshes must not outlive the
  // LOD entries that owned them (teardown paths clear the rest).
  for (const e of cache.values()) {
    if (e.pending) for (const k of e.keys) dropChunkMesh(k);
  }
  cache.clear();
  acc = DECIDE_DT;
  resetProxies();
}

// Boot prewarm: build every body's lite instances and the Moon's full
// proxy, so a ?startdim=moon entry reveals a complete sky — no planet pops
// in after Play. In-range bodies upgrade to FULL on the first decide()
// (lite covering the budgeted builds meanwhile, so convergence never
// pops); far bodies need nothing more. One synchronous pass: lite slots
// are microseconds per body, the single full build is the old cost.
export async function prewarmProxies(scene, seed) {
  buildLiteProxies(scene, bodySpecs(seed), seed);
  for (const spec of bodySpecs(seed)) {
    if (!bodyWiped(seed, spec.key)) setLiteBodyVisible(spec.key, true);
  }
  const moon = bodySpecs(seed)[0];
  ensureProxy(scene, moon, seed);
  const e = entryFor(moon);
  e.tier = "full";
  e.fade = 1;
  e.target = 1;
  e.pending = false;
}

function entryFor(spec) {
  let e = cache.get(spec.key);
  if (!e || e.spec !== spec) {
    e = {
      spec, centers: bodyChunkCenters(spec), keys: [...bodyChunkKeys(spec)],
      queued: false, fade: 0, target: 0, isMoon: spec.key === "moon",
      pending: false, fullMesh: false,
    };
    cache.set(spec.key, e);
  }
  return e;
}

function decide(scene, px, py, pz, seed, qx = px, qy = py, qz = pz) {
  const specs = bodySpecs(seed);
  // Queue/want read the lead point (prefetch along the velocity so fast
  // arrivals converge before arrival); release/cover/dispose read the real
  // eye (visibility is where the player is). The handoff happens at the
  // mesh range: celestial meshes are region meshes — scene-level, never
  // fog-culled — so they are drawn at any distance once built, and the
  // swap lands where the voxel staircase is still sub-pixel (see lodAction).
  // Below the Moon fade band both region ramps read 0, so every proxy is
  // invisible: the LOD only stages proxies (no queue, no dispose). The
  // legacy streaming owns the ground alone down there (the spawn columns
  // share the Moon's XZ footprint while chunk keys are column-wide).
  const cold = py < CELESTIAL_FADE_Y;
  let disposed = 0, fullBuilds = 0;
  for (const spec of specs) {
    const isMoon = spec.key === "moon";
    // Wiped bodies hold no proxy at all: lite stays parked and any staged
    // entry is dropped — the drain left every chunk final, so only queued
    // builds purge (stateless: wipes are rare, a 10 Hz purge of an empty
    // queue is a Map walk). Re-touch resumes the normal path below.
    if (bodyWiped(seed, spec.key)) {
      if (!cold) {
        setLiteBodyVisible(spec.key, false);
        const ew = cache.get(spec.key);
        if (ew) {
          for (const k of ew.keys) purgeChunkQueues(k);
          setProxyVisible(spec.key, false);
          dropFullProxy(spec.key);
          cache.delete(spec.key);
        } else {
          for (const k of bodyChunkKeys(spec)) purgeChunkQueues(k);
        }
      }
      continue;
    }
    const qdx = spec.cx - qx, qdz = spec.cz - qz;
    const qdy = (spec.top + spec.bottom) / 2 - qy;
    const distLead = Math.hypot(qdx, qdy, qdz);
    const rdx = spec.cx - px, rdz = spec.cz - pz;
    const rdy = (spec.top + spec.bottom) / 2 - py;
    const distReal = Math.hypot(rdx, rdy, rdz);
    const touched = bodyTouched(seed, spec.key);
    const prev = cache.get(spec.key);
    let tier = proxyTierFor(distReal, prev?.tier ?? "lite", { touched, isMoon });
    if (tier === "lite" && prev && (prev.pending || prev.queued)) {
      // Departure in flight: hold FULL until the existing release/dispose
      // machinery finishes its drop — downgrading now would orphan queued
      // or Cover-held meshes with no entry left to release them.
      tier = "full";
    }
    if (tier === "lite") {
      // Far bodies need no entry and no chunk scans: untouched and beyond
      // every mesh range means no meshes can exist (touched bodies are
      // always FULL tier), so every LOD action below resolves statically
      // and the shared lite instances own the view. The meshes exist only
      // after a moon-boot prewarm — any other entry builds them here on
      // first need (one-time cost, two-comparison guard afterwards).
      ensureLiteProxies(scene, specs, seed);
      setLiteBodyVisible(spec.key, true);
      if (prev) {
        setProxyVisible(spec.key, false);
        dropFullProxy(spec.key);
        cache.delete(spec.key);
      }
      continue;
    }
    // FULL tier: stage the exact proxy while the queue/release/departure
    // machinery below runs unchanged. The lite instances park (the exact
    // proxy owns the view); a spent build budget only delays an invisible
    // swap — lite keeps covering meanwhile, so convergence never pops.
    const e = prev ?? entryFor(spec);
    e.tier = "full";
    if (!prev) {
      // Fresh entry: the proxy shows immediately at full strength — it
      // reads exactly like the lite instances it replaces (sub-pixel
      // deltas), so the swap never dips. The cover logic below takes over
      // from there (voxel convergence, departure).
      e.fade = 1;
      e.target = 1;
    }
    if (!hasProxy(spec.key)) {
      if (fullBuilds < FULL_BUILDS_PER_DECIDE) {
        ensureProxy(scene, spec, seed);
        fullBuilds++;
      } else {
        continue;
      }
    }
    setLiteBodyVisible(spec.key, false);
    let hasMesh = false, fullMesh = false;
    for (const k of e.keys) {
      if (isChunkMeshed(k)) hasMesh = true;
      else fullMesh = false;
    }
    e.fullMesh = fullMesh;
    if (fullMesh) e.queued = false;
    const aQ = lodAction({
      dist: distLead, range: MESH_DIST, out: MESH_OUT,
      touched, hasMesh, fullMesh,
    });
    const aR = lodAction({
      dist: distReal, range: MESH_DIST, out: MESH_OUT,
      touched, hasMesh, fullMesh,
    });
    if (!cold) {
      // Queue while wanted-but-incomplete, cover or not: the cover EXISTS to
      // hold the proxy while these meshes build — gating on `pending` (set
      // by every missing-mesh cover) starved the queue and left the handoff
      // to the close-range stream bubble. The departure path cannot
      // conflict: leaving, the lead point points outward past the queue
      // range, and built keys no-op in the queue.
      if (aQ.queue && !e.queued) {
        queueCelestialChunks(e.centers);
        e.queued = true;
      }
      // Departure crossfade (mirror of the arrival release): the cover
      // fades the proxy back in over the drawn meshes inside the dispose
      // hysteresis band, and the whole-body drop lands only once the cover
      // is complete AND the dispose range is reached — leaving never
      // snaps, and flying back in cancels instead of flapping.
      const step = departureStep(e.pending, e.fade, aR.cover, aR.dispose, aR.release);
      if (step) {
        e.pending = step.pending;
        if (step.target !== null) e.target = step.target;
        if (step.drop && disposed < DISPOSE_BODIES_PER_FRAME) {
          for (const k of e.keys) dropChunkMesh(k);
          e.queued = false;
          disposed++;
        } else if (step.drop) {
          e.pending = true; // budget spent: retry next decide
        }
      } else {
        e.target = 1;
      }
    }
  }
}

export function tickLod(scene, px, py, pz, seed, dt, qx = px, qy = py, qz = pz) {
  acc += dt;
  if (acc >= DECIDE_DT) {
    acc = 0;
    decide(scene, px, py, pz, seed, qx, qy, qz);
  }
  const moonFade = regionByKey("moon").factor({ y: py });
  const planetFade = regionByKey("planets").factor({ y: py });
  // The far sky shares one opacity: per-palette materials, no per-body
  // work — the cache loop below only ever sees FULL-tier + Moon entries.
  setLiteOpacity(planetFade);
  // Speed-adaptive crossfades, arrival and departure at the same rate:
  // at rest the full REVEAL_TIME hides the swap; at 480 b/s the same fade
  // would drag a ~700-block veil behind the swap. Scale both directions
  // down with the lead distance (2 s × 120 b/s reference — motion masks
  // the swap, and the static proxy/voxel delta is ±3% so the fast fade
  // stays invisible).
  const leadD = Math.hypot(qx - px, qy - py, qz - pz);
  const speedUp = 1 + Math.min(leadD / 240, 7);
  const fadeOut = (1 / REVEAL_TIME) * speedUp;
  for (const e of cache.values()) {
    // Slow symmetric blend while the meshes are held, fast cover while
    // they still converge (a slow cover would ramp over the void).
    const fadeIn = (e.fullMesh ? 1 / REVEAL_TIME : FADE_IN_FAST) * speedUp;
    if (e.fade !== e.target) {
      e.fade = e.target > e.fade
        ? Math.min(e.target, e.fade + fadeIn * dt)
        : Math.max(e.target, e.fade - fadeOut * dt);
    }
    // Inside fade: the camera within the body (grapple contact, cheat fly,
    // standing on it) never sees near-plane streaks — it ramps 0→1 over
    // the shell so the swap-distance view is untouched.
    const s = e.spec;
    const ddx = s.cx - px, ddz = s.cz - pz;
    const ddy = (s.top + s.bottom) / 2 - py;
    const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    let inf = (d - s.r + 8) / 40;
    inf = inf < 0 ? 0 : inf > 1 ? 1 : inf;
    const inFade = inf * inf * (3 - 2 * inf);
    const opacity = (e.isMoon ? moonFade : planetFade) * e.fade * inFade;
    setProxyOpacity(e.spec.key, opacity);
    setProxyVisible(e.spec.key, opacity > 0.003);
  }
}
