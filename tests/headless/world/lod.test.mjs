// LOD rules: mesh-want predicate and per-body transitions (three-free).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PLANET_R, MESH_DIST, REVEAL_TIME,
  lodAction, departureStep, bodyMeshWant, bodyCenter, bodyDist,
  noteBodyInteract, bodyTouched, resetPlanets,
  bodySpecs, setPlanetSeed,
} from "../../../src/world/planets.js";

resetPlanets();
setPlanetSeed(7);
const seed = 7;
const specs = bodySpecs(seed);
const p0 = bodyByKey0();

// Fixed mesh range and reveal crossfade.
assert.equal(MESH_DIST, 2500, "mesh range");
assert.equal(REVEAL_TIME, 1.5, "reveal time");

function bodyByKey0() {
  return specs.find((b) => b.key === "p0");
}

// bodyCenter/bodyDist: volumetric center and 3D distance.
{
  const c = bodyCenter(p0);
  assert.equal(c.x, p0.cx, "center x");
  assert.equal(c.z, p0.cz, "center z");
  assert.equal(c.y, (p0.top + p0.bottom) / 2, "center y");
  assert.ok(bodyDist(p0, c.x, c.y, c.z) < 0.001, "zero at center");
  assert.ok(bodyDist(p0, c.x + 300, c.y + 400, c.z) - 500 < 0.001, "3-4-5");
}

// bodyMeshWant: touched or inside the mesh range — voxels and meshes share
// it; out-of-range bodies materialize on demand. The Moon follows the same
// rules.
{
  assert.equal(bodyMeshWant(seed, "moon", 0, 0, 9000), false, "moon far reads unwanted");
  assert.equal(bodyMeshWant(seed, "moon", 0, 947, 0), true, "moon near reads wanted");
  const c = bodyCenter(p0);
  assert.equal(bodyMeshWant(seed, "p0", c.x, c.y, c.z), true, "meshes at center");
  assert.equal(bodyMeshWant(seed, "p0", c.x + MESH_DIST + 1, c.y, c.z), false, "meshes past range");
  assert.equal(bodyTouched(seed, "p0"), false, "untouched initially");
  noteBodyInteract(seed, "p0");
  assert.equal(bodyTouched(seed, "p0"), true, "interact noted");
  assert.equal(bodyMeshWant(seed, "p0", c.x + MESH_DIST + 5000, c.y, c.z), true, "touched meshes stay far away");
  resetPlanets();
  assert.equal(bodyTouched(seed, "p0"), false, "reset clears touches");
}

// lodAction truth table. The proxy covers until the body is fully meshed
// (pop-in cover), releases at the mesh range — celestial meshes are region
// meshes, drawn at any distance once built, so the voxel handoff happens
// where the staircase is still sub-pixel — and covers again inside the
// dispose hysteresis band (departure cover over drawn meshes). Queueing
// uses the mesh range only — queueing past it would build meshes the
// dispose rule drops on the next tick (build-then-dispose churn).
{
  // In range, unmeshed: queue, proxy up.
  assert.deepEqual(
    lodAction({ dist: 100, range: 2500, touched: false, hasMesh: false, fullMesh: false }),
    { queue: true, release: false, cover: true, dispose: false }, "near unmeshed queues");
  // In range, converged: steady, released (voxels own the view).
  assert.deepEqual(
    lodAction({ dist: 100, range: 2500, touched: false, hasMesh: true, fullMesh: true }),
    { queue: false, release: true, cover: false, dispose: false }, "near converged releases");
  // In range, converging: keep queueing, proxy stays up over the pop-in.
  assert.deepEqual(
    lodAction({ dist: 100, range: 2500, touched: false, hasMesh: true, fullMesh: false }),
    { queue: true, release: false, cover: true, dispose: false }, "converging hides behind proxy");
  // Far, meshed: dispose; the proxy covers through the drop (departure).
  assert.deepEqual(
    lodAction({ dist: 9000, range: 2500, touched: false, hasMesh: true, fullMesh: true }),
    { queue: false, release: false, cover: true, dispose: true }, "far meshed disposes under cover");
  // Far, unmeshed: proxy, nothing to do (no churn re-queue).
  assert.deepEqual(
    lodAction({ dist: 9000, range: 2500, touched: false, hasMesh: false, fullMesh: false }),
    { queue: false, release: false, cover: true, dispose: false }, "far unmeshed proxies");
  // Just past range, unmeshed: no queue either — the hysteresis band only
  // retains meshed bodies, never acquires new ones.
  assert.deepEqual(
    lodAction({ dist: 2750, range: 2500, touched: false, hasMesh: false, fullMesh: false }),
    { queue: false, release: false, cover: true, dispose: false }, "no acquire past range");
  // Hysteresis: meshed at 1.1x range stays (no flap), under departure cover.
  assert.deepEqual(
    lodAction({ dist: 2750, range: 2500, touched: false, hasMesh: true, fullMesh: true }),
    { queue: false, release: false, cover: true, dispose: false }, "hysteresis holds meshed");
  // Touched far body: queue, keep — and release everywhere (voxels own the
  // view at any range once fully meshed).
  assert.deepEqual(
    lodAction({ dist: 9000, range: 2500, touched: true, hasMesh: false, fullMesh: false }),
    { queue: true, release: false, cover: true, dispose: false }, "touched far queues");
  assert.deepEqual(
    lodAction({ dist: 9000, range: 2500, touched: true, hasMesh: true, fullMesh: true }),
    { queue: false, release: true, cover: false, dispose: false }, "touched far releases voxels");
}
{
  // Departure crossfade: released hands the frame to drawn meshes (proxy
  // off, cancels cover); otherwise cover keeps the proxy over the meshes
  // and the drop lands only once covered AND out of range.
  assert.equal(departureStep(false, 0, false, false, false), null, "no order, no-op");
  assert.deepEqual(departureStep(false, 0, true, false, false),
    { pending: true, target: 1, drop: false }, "cover starts pending");
  assert.deepEqual(departureStep(true, 0.4, true, false, false),
    { pending: true, target: 1, drop: false }, "meshes held mid-cover");
  assert.deepEqual(departureStep(true, 0.4, true, true, false),
    { pending: true, target: 1, drop: false }, "no drop before cover");
  assert.deepEqual(departureStep(true, 0.999, true, true, false),
    { pending: false, target: 1, drop: true }, "covered drop out of range");
  assert.deepEqual(departureStep(true, 0.999, true, false, false),
    { pending: true, target: 1, drop: false }, "no early drop in range");
  assert.deepEqual(departureStep(true, 0.4, true, false, true),
    { pending: false, target: 0, drop: false }, "release cancels cover");
  assert.deepEqual(departureStep(false, 0, false, false, true),
    { pending: false, target: 0, drop: false }, "release hands meshes the frame");
}
console.log("PASS lod-rules");

// Full-mesh scan init (lod.js needs three, so the wiring is asserted on
// source, headroom.test.mjs pattern): the scan must start optimistic and
// only clear on a missing chunk — initialized to false, the cover could
// never resolve into a release and the intact proxy would hide edited
// voxels (blast craters included) at every range past the shell fade.
{
  const lodSrc = readFileSync(fileURLToPath(new URL("../../../src/render/lod.js", import.meta.url)), "utf8");
  assert.ok(lodSrc.includes("let hasMesh = false, fullMesh = e.keys.length > 0;"),
    "scan starts optimistic (non-empty key set reads full)");
  assert.ok(lodSrc.includes("else fullMesh = false;"),
    "scan only clears on a missing chunk");
  console.log("PASS lod-fullmesh-init");
}
