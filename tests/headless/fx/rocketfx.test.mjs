// Rocket FX spec: the registry is well formed, the factor curves read the
// shipped numbers, the cloud and the shake stay linked, and the pure face
// finder reports the right walls, normals and positions — including the
// rule that the box's bottom face never reacts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ROCKET_FX_EFFECTS, ROCKET_FX_PALETTE, ROCKET_FX_CURVES,
  countdownFactor,
  ROCKET_FX_HALOS, ROCKET_FX_HALO_KEYS,
  ROCKET_FX_CONE_SIZES, ROCKET_FX_CONE_SIZE_KEYS, ROCKET_FX_DEFAULT_CONE,
  FX_LAYER_KINDS, FX_PLACES,
  fxScale, speedFactor, resolveLayer, validateRocketFx, exposedFaces,
  landingRingPoints, coneSpreadK, coneBaseMul,
} from "../../../src/fx/rocketfx.js";

const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- the registry ------------------------------------------------------------
{
  // The spec is self-consistent: every effect is well formed, every
  // layer names a renderer and a geometry the engine knows, and every
  // prop those read is present and finite.
  assert.deepEqual(validateRocketFx(), [], "the rocket FX spec validates");

  for (const [key, effect] of Object.entries(ROCKET_FX_EFFECTS)) {
    assert.equal(effect.key, key, `${key} carries its registry key`);
    assert.equal(typeof effect.label, "string");
    assert.ok(effect.label.length > 0, `${key} has a label`);
    assert.ok(Array.isArray(effect.layers), `${key} has a layer list`);
    assert.ok(effect.layers.length > 0, `${key} has layers`);
    if (effect.curve) assert.ok(effect.curve in ROCKET_FX_CURVES, `${key} names a known curve`);
    for (const layer of effect.layers) {
      assert.ok(layer.kind in FX_LAYER_KINDS, `${key}: the layer kind is known`);
      assert.ok(layer.place in FX_PLACES, `${key}: the layer place is known`);
    }
  }

  // The palette supplies the colour roles the layers point at.
  assert.equal(typeof ROCKET_FX_PALETTE.key, "string");
  assert.equal(typeof ROCKET_FX_PALETTE.flash, "number", "the palette has a flash colour");
  assert.ok(Array.isArray(ROCKET_FX_PALETTE.embers) && ROCKET_FX_PALETTE.embers.length > 0, "the palette has an ember palette");
  assert.equal(ROCKET_FX_PALETTE.dust.length, 3, "the palette has an rgb dust colour");
  for (const c of ROCKET_FX_PALETTE.embers) assert.equal(c.length, 3, "each ember colour is an rgb triple");

  // Every layer resolves to finite props at both ends of its curve and with
  // its ramp fully open — no NaN can reach the particle backend.
  for (const [key, effect] of Object.entries(ROCKET_FX_EFFECTS)) {
    const scales = effect.curve ? [fxScale(effect.curve, 0), fxScale(effect.curve, 1)] : [{}];
    for (const layer of effect.layers) {
      for (const scale of scales) {
        const props = resolveLayer(layer, { scale, ramp: 1, amount: 120 });
        for (const [prop, value] of Object.entries(props)) {
          if (typeof value !== "number") continue;
          assert.ok(Number.isFinite(value), `${key}.${layer.kind}: ${prop} resolves to a finite number`);
        }
          assert.ok(layer.kind === "flash" || props.count >= 1, `${key}.${layer.kind}: the count stays at least one`);
        }
      }
    }
}

// --- the factor curves ------------------------------------------------------
{
  // The blast grows with the rocket speed: counts 0.5 .. 1.5, sizes
  // 0.6 .. 1.4, with 1.0 / 1.0 at the cruise cap (half the reference).
  const still = fxScale("impact", 0);
  assert.ok(near(still.count, 0.5) && near(still.size, 0.6), "a standstill blast is the smallest");
  const cruise = fxScale("impact", 0.5);
  assert.ok(near(cruise.count, 1) && near(cruise.size, 1), "the cruise cap keeps the shipped look");
  const fast = fxScale("impact", 1);
  assert.ok(near(fast.count, 1.5) && near(fast.size, 1.4), "a max-speed dive is the biggest");
  const mid = fxScale("impact", 0.75);
  assert.ok(mid.count > cruise.count && mid.count < fast.count, "counts rise monotonically with speed");
  assert.ok(mid.size > cruise.size && mid.size < fast.size, "sizes rise monotonically with speed");

  // The touchdown: the cloud and the shake come out of one curve, so all
  // five peak together at the reference speed, and all five run straight
  // from nothing to their cap. Height and duration carry the violence: a
  // soft kiss barely lifts off the ground and dies at once.
  const soft = fxScale("landing", 0);
  assert.ok(near(soft.count, 0.05 * 1.0) && near(soft.size, 0.2 * 1.0), "a standstill touchdown barely puffs");
  assert.equal(soft.shake, 0, "a standstill touchdown does not shake");
  assert.equal(soft.height, 0, "a standstill touchdown hugs the ground");
  assert.ok(near(soft.duration, 0.4 * 1.0), "but even the softest puff outlives a spawn tick");
  const hard = fxScale("landing", 1);
  assert.ok(near(hard.count, 1.5 * 1.0), "the cloud peaks at the reference speed");
  assert.ok(near(hard.size, 1.15 * 1.0), "the grain peaks there too");
  assert.ok(near(hard.height, 1.0), "the envelope climbs past the tip");
  assert.ok(near(hard.duration, 1.0), "and the smoke hangs in the air");
  assert.ok(near(hard.shake, 0.5 * 1.0), "and the shake peaks with them");
  // The five factors are straight lines in the speed: the middle of the
  // curve is the mean of its ends.
  const half = fxScale("landing", 0.5);
  for (const factor of ["count", "size", "height", "duration", "shake"]) {
    assert.ok(near(half[factor], (soft[factor] + hard[factor]) / 2), `${factor} is linear in the speed`);
  }
  // The shake max stays well under the camera trauma cap: the landing
  // thuds without pinning the lens.
  assert.ok(near(hard.shake, 0.5), "the shake max stays well under the camera cap");

  // The intensity knob scales the cloud and the shake by the same
  // percentage: +10 % on the shake is +10 % on the cloud.
  const curve = ROCKET_FX_CURVES.landing;
  const saved = curve.intensity;
  assert.equal(saved, 1.0, "the landing knob ships at unity");
  try {
    curve.intensity = 1;
    const full = fxScale("landing", 1);
    curve.intensity = saved;
    const tuned = fxScale("landing", 1);
    assert.ok(near(tuned.count / full.count, saved), "the cloud follows the intensity knob");
    assert.ok(near(tuned.size / full.size, saved), "the grain follows it too");
    assert.ok(near(tuned.shake / full.shake, saved), "and the shake moves with the cloud");
    curve.intensity = saved * 1.1;
    const louder = fxScale("landing", 1);
    assert.ok(near(louder.shake / tuned.shake, 1.1), "+10 % on the shake");
    assert.ok(near(louder.count / tuned.count, 1.1), "+10 % on the cloud");
    assert.ok(near(louder.size / tuned.size, 1.1), "+10 % on the grain");
  } finally {
    curve.intensity = saved;
  }

  // The tuned smoke envelope: height tunes span/drift, density the
  // count, both before the landing-curve scaling — never the lifetime.
  // The engine passes the baked envelope outright (height 0.2, density
  // 1.5, lifetime x0.8).
  const Y = { height: 0.2, density: 1.5 };
  assert.equal(countdownFactor(0), 0, "the countdown starts smokeless");
  assert.ok(near(countdownFactor(1), 1.0), "a finished countdown plays factor 1");
  assert.ok(near(countdownFactor(0.5), 0.5), "the tremble scales linearly into liftoff");

  // Each curve names the clamps its factors obey.
  for (const c of Object.values(ROCKET_FX_CURVES)) {
    for (const [factor, [lo, hi]] of Object.entries(c.clamp)) {
      assert.ok(lo <= hi, "a clamp is ordered");
      assert.ok(factor in c, "a clamped factor is one the curve answers");
    }
  }

  // The speed factor: how hard a landing reads against the reference.
  assert.equal(speedFactor(0, 60), 0, "no impact reads as nothing");
  assert.equal(speedFactor(30, 60), 0.5, "half the reference reads as half");
  assert.equal(speedFactor(60, 60), 1, "the reference reads as full");
  assert.equal(speedFactor(200, 60), 1, "faster than the reference clamps to full");
  assert.equal(speedFactor(-5, 60), 0, "a negative impact clamps to nothing");
  assert.equal(speedFactor(10, 0), 0, "no reference reads as nothing");
}

// --- the layer resolution ---------------------------------------------------
{
  const impact = ROCKET_FX_EFFECTS.impact;
  const dust = impact.layers.find((l) => l.place === "faces" && l.kind === "burst");
  const debris = impact.layers.find((l) => l.kind === "debris");
  const ring = impact.layers.find((l) => l.place === "planeRing");

  // The scale factors multiply the layer's props.
  const plain = resolveLayer(dust, {});
  assert.equal(plain.count, 6, "the dust keeps its count");
  assert.ok(near(plain.size, 0.45), "the dust keeps its size");
  const scaled = resolveLayer(dust, { scale: fxScale("impact", 1) });
  assert.equal(scaled.count, 9, "a max-speed dive throws half again the dust");
  assert.ok(near(scaled.size, 0.63), "and fatter grains");
  assert.ok(near(resolveLayer(debris, { scale: fxScale("impact", 1) }).radius, 1.6 * 1.4), "the debris spread grows with the blast");
  assert.ok(near(resolveLayer(ring, { scale: fxScale("impact", 1) }).radius, 0.7 * 1.4), "the shock ring widens with the blast");

  // The ramp adds to the base: the thrust level drives the plume's density
  // and jet speed.
  const ember = ROCKET_FX_EFFECTS.plume.layers[0];
  const hot = resolveLayer(ember, { ramp: 1 });
  assert.equal(hot.count, 96, "a full thrust doubles the ember count");
  assert.ok(near(hot.speedMax, 4.9), "and pushes the jet faster");
  const idle = resolveLayer(ember, { ramp: 0 });
  assert.equal(idle.count, 48, "an idle engine keeps the base count");

  // The spool smoke is gone: the countdown replays the landing look, so
  // the tremble and the touchdown share one smoke family.
  assert.ok(!("spool" in ROCKET_FX_EFFECTS), "the ignition spool effect is gone");

  // The hull dust counts the torn volume, then scales, then clamps.
  const carve = ROCKET_FX_EFFECTS.carve.layers[0];
  assert.equal(resolveLayer(carve, { amount: 24 }).count, 10, "two dozen cells add two particles");
  assert.equal(resolveLayer(carve, { amount: 2400 }).count, 60, "the hull dust stays capped");
  assert.equal(resolveLayer(carve, { amount: 2400, scale: fxScale("impact", 1) }).count, 60, "the cap survives the scaling");
}

// --- the reactor cones -----------------------------------------------------
{
  // The reactor cones read as cones, not puffs: a tight velocity spread
  // around an aimed base disc, and lives long enough to stretch. The ember
  // core outlives the old puff, the dust veil hangs, the idle burn reads
  // pre-launch.
  const plume = ROCKET_FX_EFFECTS.plume.layers;
  const exhaust = ROCKET_FX_EFFECTS.exhaust.layers[0];
  const close = (a, b) => Math.abs(a - b) < 1e-3;
  assert.ok(close(plume[0].life, 0.55), "the ember core stretches");
  assert.ok(close(plume[1].life, 1.0 * 2 / 3 * 1.1), "the dust veil hangs");
  assert.ok(close(exhaust.life, 0.8), "the idle burn reads pre-launch");
  assert.ok(close(plume[0].spread, 0.35), "the ember cone stays tight");
  assert.ok(close(plume[1].spread, 0.4), "the dust shroud stays tight");
  assert.ok(close(exhaust.spread, 0.55), "the burn stays tight");

  // Every nozzle layer carries a divergent base: a spawn disc plus an
  // outward aim, so the cone reads wide from its very base.
  for (const layer of [...plume, exhaust]) {
    assert.ok(layer.baseRadius > 0, "the cone has a base disc");
    assert.ok(layer.flare > 0, "the cone aims outward from the base");
    assert.ok(Number.isFinite(layer.baseRadius) && Number.isFinite(layer.flare), "the base stays finite");
    assert.ok(layer.fillRadius > 0, "the cone spawns a volume, not points");
  }
  // The preset opens both ends: the engine scales the outward aim and the spawn
  // disc itself through the cone slopes — the base never moves with the
  // raw preset multiplier, only with its own slope. Both ends widen
  // strictly with the presets.
  assert.ok(coneSpreadK(2.0) > 1 && coneBaseMul(2.0) > 1, "narrow opens aim and base");
  assert.ok(coneSpreadK(2.0) < coneSpreadK(5.0), "the aim widens with the preset");
  assert.ok(coneBaseMul(2.0) < coneBaseMul(5.0), "the base widens with the preset");
  assert.ok(coneBaseMul(1.0) === 1, "no preset leaves the disc alone");
  const impactSrc = readFileSync(fileURLToPath(new URL("../../../src/fx/rocketimpact.js", import.meta.url)), "utf8");
  assert.ok(!impactSrc.includes("baseRadius * cone.spreadMul"), "the preset never scales the base raw");
  assert.ok(impactSrc.includes("flare: props.flare = props.flare * live.spreadMul") || impactSrc.includes("props.flare * live.spreadMul"), "the preset opens the outward aim");
  assert.ok(impactSrc.includes("spreadK: coneSpreadK(cone.spreadMul)"), "the aim slope is read once");
  assert.ok(impactSrc.includes("baseK: coneBaseMul(cone.spreadMul)"), "the base slope is read once");
  assert.ok(impactSrc.includes("smokeLife: 0.8"), "the smoke lifetime is baked");
  assert.ok(impactSrc.includes("baseRadius = props.baseRadius * live.baseK"), "the preset widens the spawn disc");
  assert.ok(impactSrc.includes("fillRadius = props.fillRadius * live.baseK"), "the preset widens the spawn volume");
  assert.ok(impactSrc.includes("const SUB = 8"), "the disc samples eight points per nozzle");
  assert.ok(impactSrc.includes("i % 2 === 0"), "the smoke floor emits on every second center");
  assert.ok(impactSrc.includes("window.__fxProbe"), "the ?test=1 probe is armed in the engine");

  // The cone widths: both ends open x2 up to x5, max shipped fixed.
  assert.deepEqual(ROCKET_FX_CONE_SIZE_KEYS, Object.keys(ROCKET_FX_CONE_SIZES), "the cone registry lists its keys");
  assert.deepEqual(
    [ROCKET_FX_CONE_SIZES.flare.spreadMul, ROCKET_FX_CONE_SIZES.flare.lifeMul],
    [3.0, 1.0], "flare triples the far end at full reach");
  assert.deepEqual(
    [ROCKET_FX_CONE_SIZES.max.spreadMul, ROCKET_FX_CONE_SIZES.max.lifeMul],
    [5.0, 1.0], "max quintuples the far end at full reach");
  assert.ok(ROCKET_FX_CONE_SIZE_KEYS.length >= 3, "several cone widths ship");
  assert.ok(ROCKET_FX_DEFAULT_CONE in ROCKET_FX_CONE_SIZES, "the shipped width is a known width");
  for (const [key, size] of Object.entries(ROCKET_FX_CONE_SIZES)) {
    assert.equal(size.key, key, `${key} carries its registry key`);
    assert.equal(typeof size.label, "string");
    assert.equal(size.lifeMul, 1.0, `${key} keeps full reach`);
  }
  assert.equal(ROCKET_FX_DEFAULT_CONE, "max", "max ships");
}

// --- the hardcoded smoke ------------------------------------------------
{
  // The touchdown smoke is hardcoded: the landing plays a low envelope
  // plus the single shipped halo — one smoke family for takeoff,
  // tremble and touchdown alike.
  const landing = ROCKET_FX_EFFECTS.landing.layers;
  const envelope = landing.find((l) => l.place === "hullShell");
  assert.ok(envelope, "the landing wraps the hull");
  assert.ok(envelope.rows >= 5, "the landing climbs the hull in rows");
  assert.ok(envelope.fillRadius >= 1.5, "the landing spawns blobs, not points");
  assert.ok(envelope.steps >= 24, "the landing rings the hull finely enough");
  assert.ok(envelope.span <= 0.6, "the envelope stays low even at full strength");
  assert.deepEqual(envelope.scale, { count: "count", size: "size", span: "height", life: "duration", up: "height" },
    "the envelope scales by count, grain, span, life and drift");
  // A soft kiss collapses the envelope to the ground and kills the drift
  // and the lifetime; a max-speed drop blooms it to the knob-tuned height
  // (the lifetime stands alone, never the height's).
  const Y = { height: 0.2, density: 1.5 };
  const softProps = resolveLayer(envelope, { scale: fxScale("landing", 0), smokeY: Y });
  assert.equal(softProps.span, 0, "a soft kiss never climbs the hull");
  assert.equal(softProps.up, 0, "and never lifts off the ground");
  assert.ok(near(softProps.life, 2.2 * 0.4), "but outlives a spawn tick");
  const hardProps = resolveLayer(envelope, { scale: fxScale("landing", 1), smokeY: Y });
  assert.ok(near(hardProps.span, 0.6 * Y.height), "a max-speed drop stays low");
  assert.ok(near(hardProps.up, 0.7 * Y.height), "and drifts up gently");
  assert.ok(near(hardProps.life, 2.2), "and the cloud hangs briefly");
  assert.ok(near(hardProps.count, Math.round(7 * Y.density * 1.5)), "and the density follows the knob");
  assert.ok(!landing.some((l) => l.place === "footprintRing"), "the landing has no flat sheet left");
  assert.ok(ROCKET_FX_EFFECTS.landing.halo, "the landing plays a smoke halo");

  // The single shipped look: a volumetric cloud filling the space around
  // the rocket, no flat ring anywhere, scaled by the touchdown like the
  // envelope. One halo only — E no longer cycles anything.
  assert.deepEqual(ROCKET_FX_HALO_KEYS, ["halo"], "a single smoke look ships");
  for (const [key, halo] of Object.entries(ROCKET_FX_HALOS)) {
    assert.equal(halo.key, key, `${key} carries its registry key`);
    assert.equal(typeof halo.label, "string");
    assert.ok(halo.layers.length >= 2, `${key} layers skin plus billow, no air void`);
    assert.ok(halo.layers.some((l) => l.pad <= 1.2), `${key} hugs the hull skin`);
    for (const layer of halo.layers) {
      assert.equal(layer.place, "hullShell", `${key} is a volume, never a flat ring`);
      assert.ok(layer.fillRadius >= 1, `${key} spawns blobs, not points`);
      assert.ok(layer.dirY >= 0, `${key} never lies flat on the ground`);
    }
    // A soft kiss collapses the halo to the ground and kills its drift
    // and lifetime; a max-speed drop blooms it to the knob-tuned strength.
    for (const layer of halo.layers) {
      const soft = resolveLayer(layer, { scale: fxScale("landing", 0), smokeY: Y });
      assert.ok(soft.up >= 0 && soft.up < 0.5, `${key}: a soft kiss barely lifts off the ground`);
      assert.ok(soft.life < 1.2, `${key}: and dies almost at once`);
      const hard = resolveLayer(layer, { scale: fxScale("landing", 1), smokeY: Y });
      assert.ok(near(hard.span, layer.span * Y.height), `${key}: a max-speed drop reads the knob-tuned height`);
      assert.ok(near(hard.life, layer.life), `${key}: and the lifetime stands alone`);
    }
  }
  // The countdown replays the landing look: no separate ignition smoke.
  assert.ok(!("spool" in ROCKET_FX_EFFECTS), "no ignition-only smoke survives");
  const rocketSrc = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(rocketSrc.includes("countdownFactor("), "the countdown scales the landing cloud");
  assert.ok(rocketSrc.includes("landingDust(BOOST_SPEED)"), "liftoff wires the max landing cloud");
  assert.ok(!rocketSrc.includes("cycleHalo"), "no halo cycling survives");
  assert.ok(rocketSrc.includes("TRAUMA_DECAY = 1.4"), "the decay rate is named once");
  assert.ok(rocketSrc.includes("TREMOR_TRACK = TRAUMA_DECAY * 0.12"), "the tremor tracks decay x cadence");
  assert.ok(rocketSrc.includes("function shakeTick(factor, knob)"), "tracked ticks share one helper");
  assert.ok(rocketSrc.includes("function shakeFrame(factor, knob, dt)"), "per-frame adds share one helper");
  assert.ok(rocketSrc.includes("function shakeThump(factor, knob)"), "one-shots share one helper");
  assert.ok(rocketSrc.includes("SHAKE_GAIN = { tremor: 3, liftoff: 1, touchdown: 3, fade: 1 }"), "the tuned gains are baked in one table");
  assert.ok(rocketSrc.includes('shakeTick(countdownFactor(progress), "tremor")'), "the tremor gain is wired");
  assert.ok(rocketSrc.includes('shakeThump(1, "liftoff")'), "the liftoff thump is wired");
  assert.ok(rocketSrc.includes('shakeFrame(Math.max(0, launchBurn) / LAUNCH_BURN, "liftoff", dt)'), "the launch rumble is wired");
  assert.ok(rocketSrc.includes('shakeThump(shakeT0, "touchdown")'), "the contact thump is wired");
  assert.ok(rocketSrc.includes('shakeTick(shakeT0 * fadeK, "fade")'), "the fade rumble is tracked");
  assert.ok(!rocketSrc.includes("tremorWindow"), "no gating window survives");
  assert.ok(rocketSrc.includes("shakeT0 = Math.min(1, speedFactor(impact, MAX_SPEED))"), "the shake saturates at the non-boost cap");
  assert.ok(rocketSrc.includes('fxScale("landing", factor)'), "every helper shakes off the landing curve");
  assert.ok(rocketSrc.includes("shakeT0 * fadeK"), "the fade replays the shake input");
  assert.ok(rocketSrc.includes("LANDING_FADE = 0.5"), "the landing rumble lasts half a second");
  assert.ok(rocketSrc.includes("LANDING_SETTLE = 0.6"), "the landing holds past the fade");
  assert.ok(rocketSrc.includes("LANDING_SETTLE * shakeT0"), "the settle freeze follows the shake");
  assert.ok(rocketSrc.includes("ignition: 0.03"), "the ignition kick is halved");

  // Every shipped halo ring clears the hull, at both ends of a
  // phase-shifted stagger.
  for (const [key, halo] of Object.entries(ROCKET_FX_HALOS)) {
    for (const layer of halo.layers) {
      for (const phase of [0, 0.5]) {
        for (const [dx, dz] of landingRingPoints(3.5, 3.5, layer.pad, layer.steps, phase)) {
          assert.ok(Math.max(Math.abs(dx), Math.abs(dz)) >= 3.5 - 1e-9, `the shipped halo ${key} clears the hull`);
        }
      }
    }
  }
}

// --- exposed faces -----------------------------------------------------------
{
  // A solid wall to the east (+X) of a cleared cell at the origin.
  const solid = new Set(["1,0,0"]);
  const isSolidAt = (x, y, z) => solid.has(`${x},${y},${z}`);
  const faces = exposedFaces([[0, 0, 0]], isSolidAt, { maxFaces: 24 });
  assert.equal(faces.length, 1, "one solid neighbour yields one face");
  const f = faces[0];
  assert.ok(Math.sign(f.nx) === -1 && f.ny === 0 && f.nz === 0, "the normal points out of the wall, into the void");
  assert.ok(f.x > 0.5 && f.x < 1, "the face sits just inside the void, not inside the wall");
  assert.equal(f.y, 0.5);
  assert.equal(f.z, 0.5);

  // Nothing solid around: no faces at all.
  assert.deepEqual(exposedFaces([[0, 0, 0]], () => false, { maxFaces: 24 }), [], "an open cell yields no face");
  // No cells: no faces.
  assert.deepEqual(exposedFaces([], () => true, { maxFaces: 24 }), [], "an empty carve yields no face");
  assert.deepEqual(exposedFaces(null, () => true, { maxFaces: 24 }), [], "a null carve yields no face");

  // A closed box: every one of the six directions is a wall.
  const solidBox = new Set();
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    solidBox.add(`${d[0]},${d[1]},${d[2]}`);
  }
  const box = exposedFaces([[0, 0, 0]], (x, y, z) => solidBox.has(`${x},${y},${z}`), { maxFaces: 24 });
  assert.equal(box.length, 5, "the five reacting directions yield five faces");
  // The bottom face never reacts: the ground under the rocket stays intact.
  for (const face of box) {
    assert.ok(!(face.ny > 0), "no face points up out of a floor the rocket stands on");
    assert.ok(Math.abs(face.nx) + Math.abs(face.ny) + Math.abs(face.nz) === 1, "the normal is axis-aligned");
  }
  // Skipping the bottom face is what drops it: the raw scan finds six.
  assert.equal(exposedFaces([[0, 0, 0]], (x, y, z) => solidBox.has(`${x},${y},${z}`), { maxFaces: 24, skipBelow: false }).length, 6,
    "the raw scan finds all six directions");
  // A floor contact (solid below the cleared cell) is dropped by default.
  const floor = exposedFaces([[0, 0, 0]], (x, y, z) => x === 0 && y === -1 && z === 0, { maxFaces: 24 });
  assert.deepEqual(floor, [], "a floor contact is not a reacting surface");

  // The face budget is honoured.
  const many = [];
  for (let i = 0; i < 100; i++) many.push([i, 0, 0]);
  const capped = exposedFaces(many, (x, y, z) => x === 100, { maxFaces: 12 });
  assert.ok(capped.length <= 12, "the face budget is respected");
  assert.ok(capped.length > 0, "a budgeted scan still reports faces");

  // Sampling spreads over a long wall instead of hugging one end.
  const longWall = new Set();
  for (let i = 0; i < 40; i++) longWall.add(`${i + 1},0,0`);
  const spread = exposedFaces([[0, 0, 0], [20, 0, 0]], (x, y, z) => longWall.has(`${x},${y},${z}`), { maxFaces: 8 });
  assert.ok(spread.length >= 2, "both wall segments are sampled");
  const xs = new Set(spread.map((f) => f.x));
  assert.ok(xs.size >= 2, "samples come from more than one spot");
}

// --- the hull ring helper --------------------------------------------------
{
  // The ring hugs the square footprint: every point sits outside it, even
  // the corner arcs the superellipse pulls inward.
  const hw = 3.5, hd = 3.5, pad = 0.9;
  const pts = landingRingPoints(hw, hd, pad, 24);
  assert.equal(pts.length, 24, "the ring yields one point per step");
  for (const [dx, dz] of pts) {
    assert.ok(Math.max(Math.abs(dx), Math.abs(dz)) >= hw - 1e-9, "ring points stay outside the square base");
    assert.ok(Math.abs(dx) <= hw + pad + 1e-9 && Math.abs(dz) <= hd + pad + 1e-9, "ring points stay within the padded footprint");
  }
  // A phase shifts the sampling along the ring, so stacked rings never
  // line their points up — and the shifted points still clear the hull.
  const shifted = landingRingPoints(hw, hd, pad, 24, 0.5);
  assert.equal(shifted.length, 24, "the phase keeps one point per step");
  for (const [dx, dz] of shifted) {
    assert.ok(Math.max(Math.abs(dx), Math.abs(dz)) >= hw - 1e-9, "a shifted ring still clears the hull");
  }
  assert.ok(
    shifted.some(([dx, dz], i) => Math.abs(dx - pts[i][0]) > 1e-9 || Math.abs(dz - pts[i][1]) > 1e-9),
    "the phase moves the samples"
  );
  // A tight pad is safe too: the corner arcs ride the hull edge instead of
  // dipping under it.
  const tight = landingRingPoints(hw, hd, 0.4, 24);
  for (const [dx, dz] of tight) {
    assert.ok(Math.max(Math.abs(dx), Math.abs(dz)) >= hw - 1e-9, "a tight ring still clears the hull");
  }
}

// --- the liftoff alignment -------------------------------------------------
{
  // Takeoff reads the max-speed touchdown cloud, by construction: the
  // liftoff plays the full touchdown cloud (same call, factor 1) and
  // thumps the same curve input. Pin the wiring in the runtime source,
  // the way the render band ladder pins its own call sites.
  const rocket = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  const liftoff = rocket.match(/if \(countdown <= 0\) \{[\s\S]*?\n  \}/);
  assert.ok(liftoff, "the liftoff block exists");
  assert.ok(/landingDust\(BOOST_SPEED\)/.test(liftoff[0]), "the liftoff plays the max landing cloud");
  assert.ok(/shakeThump\(1, "liftoff"\)/.test(liftoff[0]), "the liftoff thumps the resolved landing feel");
}

// --- the landing relaunch queue ----------------------------------------------
{
  // SHIFT+ENTER freezes with the rest of the controls mid-landing, but a
  // fresh press latches and fires the tick the freeze ends — no parked
  // frame, no release-and-press round trip. Releasing first cancels;
  // holding the chord since takeoff never latches (rising edge only).
  const rocketSrc = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(rocketSrc.includes("takeoffArmed = false"), "the chord is spent on launch");
  assert.ok(rocketSrc.includes("if (chordHeld() && !chordWas) takeoffQueued = true"), "only a fresh press queues");
  assert.ok(rocketSrc.includes("takeoffQueued = false"), "the queue resets");
  assert.ok(rocketSrc.includes("chordWas = chordHeld()"), "the edge tracks every tick");
  const fin = rocketSrc.match(/function finalizeLanding\(\) \{[\s\S]*?\n\}/);
  assert.ok(fin, "the finalize block exists");
  assert.ok(/if \(takeoffQueued && holdTakeoff\(\)\) \{/.test(fin[0]), "the queued relaunch is gated on the chord");
  assert.ok(fin[0].includes("rocketCanTakeOff()"), "the relaunch re-resolves the takeoff offer");
  assert.ok(/startCountdown\(offer\)/.test(fin[0]), "the queued relaunch fires at freeze end");
}

// --- the countdown record handoff ------------------------------------------------
{
  // The record follows the hull from the countdown, not at liftoff: the
  // snapshot clears the ship from the store, so a still-parked record would
  // read as an emptied ghost and prune itself — cancelling the countdown
  // would then restore voxels with no record left to fly them (off-pad
  // vessels never taking off again). The cancel path re-parks through
  // stamp() via activeVesselId instead.
  const rocketSrc = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  const start = rocketSrc.match(/function startCountdown\(offer\) \{[\s\S]*?\n\}/);
  assert.ok(start, "the startCountdown block exists");
  const mark = start[0].indexOf('updateVessel(offer.vesselId, { status: "flying" })');
  assert.ok(mark >= 0, "the countdown marks the takeoff record flying");
  const snapCall = start[0].indexOf("snapshot(offer.ship)");
  assert.ok(snapCall >= 0, "the countdown snapshots the resolved ship");
  assert.ok(mark < snapCall, "the flying mark precedes the snapshot prune");
  assert.ok(start[0].includes("activeVesselId = offer.vesselId"), "the countdown holds the active id for cancel re-park");
}

// --- the snapshot ship filter ------------------------------------------------
{
  // The snapshot scans a ship passed in by the resolved offer: the membership
  // test must read the caller's set, never a bare out-of-scope name (that
  // exact slip crashed every liftoff with `ship is not defined`).
  const rocketSrc = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(rocketSrc.includes("function snapshot(shipCells)"), "the snapshot takes the resolved ship");
  const snap = rocketSrc.match(/function snapshot\(shipCells\) \{[\s\S]*?\n\}/);
  assert.ok(snap, "the snapshot block exists");
  assert.ok(snap[0].includes("inShip.has("), "the scan filters on the caller's set");
  assert.ok(!snap[0].includes("!ship.has("), "no out-of-scope ship reference survives");
}

// --- the first-countdown warmup ------------------------------------------------
{
  // The burst path builds material + geometry per call: without a warmup
  // the first exhaust tick pays two program links mid-tick and the
  // countdown overlay visibly lags. Seed particles prewarm every variant
  // behind the menu, before renderer.compile covers their programs.
  const parts = readFileSync(fileURLToPath(new URL("../../../src/fx/particles.js", import.meta.url)), "utf8");
  assert.ok(/export function prewarmBursts\(\)/.test(parts), "bursts prewarm");
  assert.ok(parts.includes("spawnBurstBatch({ centers:"), "the nozzle batch path prewarms");
  assert.ok(parts.includes("spawnFlash({"), "the flash geometry prewarms");
  assert.ok(parts.includes("spawnDebris({"), "the debris pool prewarms");
  const main = readFileSync(fileURLToPath(new URL("../../../main.js", import.meta.url)), "utf8");
  const warm = main.match(/async function warmupFx\(token\) \{[\s\S]*?\n\}/);
  assert.ok(warm, "the warmup block exists");
  assert.ok(warm[0].indexOf("prewarmBursts()") < warm[0].indexOf("renderer.compile("), "bursts seed before compile");
  const rocket2 = readFileSync(fileURLToPath(new URL("../../../src/vehicles/rocket.js", import.meta.url)), "utf8");
  assert.ok(rocket2.includes("countdownEl.textContent !== t"), "the overlay writes on change only");
}

console.log("rocketfx.test.mjs: ok");
