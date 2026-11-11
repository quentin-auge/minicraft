// Rocket FX spec: every number the rocket's effects read, in one place.
//
// Three-free on purpose: this module owns data and pure logic only, the
// spawners live in rocketimpact.js.
//
// The spec has three parts:
//   ROCKET_FX_EFFECTS  key -> { key, label, curve, origin, layers }
//   ROCKET_FX_PALETTE  the colour roles a layer points at
//   ROCKET_FX_CURVES   the factor ramps a speed feeds
//
// A layer is { kind, place, ...props }. `kind` picks the renderer (flash /
// burst / debris), `place` picks the geometry (faces, faceCentroid,
// planeRing, hullShell, nozzles, point). The engine reads
// the props and the palette roles, never a name: a new effect is a
// registry entry.
//
// The blast rule: the rocket's bounding box is the authority. A solid block
// is blasted when one of the box's LATERAL faces or its TOP face reaches it.
// The bottom face never reacts, so the ground the rocket lands on survives.
import { PALETTES } from "./palettes.js";

// The colours the rocket FX paints with. Roles, not literals: a layer says
// `color: "dust"` and the palette says what dust is.
export const ROCKET_FX_PALETTE = {
  key: "tnt",
  label: "TNT orange",
  flash: PALETTES.fire.flash,
  embers: PALETTES.fire.embers,
  dust: [0.55, 0.5, 0.45],
  smoke: [0.62, 0.59, 0.55],
  exhaust: [0.9, 0.55, 0.2],
};

// The factor ramps. A curve answers the factors an effect's layers scale
// by, given a normalized input t (0 = nothing happened, 1 = the reference
// speed). The curves hold shapes only: the reference speeds live with the
// physics that measures them.
//
// The landing curve carries the camera shake beside the cloud's factors:
// the landing's feel is one curve, and its `intensity` knob scales the
// cloud's counts, the cloud's grain and the shake's amount by the same
// number — so a change to one is a change to the others.
export const ROCKET_FX_CURVES = {
  // The blast: counts 0.5 .. 1.5, sizes 0.6 .. 1.4, so a slow bore throws
  // pebbles while a max-speed dive throws a wall.
  impact: {
    count: [0.5, 1.5],
    size: [0.6, 1.4],
    clamp: { count: [0.1, 2], size: [0.2, 2] },
  },
// The touchdown: counts 0.05 .. 1.5 (a soft kiss barely shows), sizes
// 0.2 .. 1.15, the shell's span and drift 0 .. 1, the smoke's life
// 0.4 .. 1, and the shake from nothing to its cap — all five peaking
// together at the reference speed, all five scaled by the intensity.
// Height and duration carry the violence: a standstill touchdown reads
// as a low puff that dies at once, a max-speed drop as a tall cloud
// that hangs in the air.
landing: {
  count: [0.05, 1.5],
  size: [0.2, 1.15],
  height: [0, 1],
  duration: [0.4, 1],
  shake: [0, 0.5],
  intensity: 1.0,
  clamp: { count: [0.025, 2], size: [0.15, 1.5] },
},
};

// The countdown's full power, as a landing factor: a finished countdown
// plays factor 1, so liftoff reads the max-speed touchdown cloud (the
// cloud alone reaches the boosted cap — the shake saturates at the
// non-boost cap). The tremble scales height/density/shake linearly from 0
// to this.
export function countdownFactor(progress) {
  const p = Math.max(0, Math.min(1, progress ?? 0));
  return p;
}

// The smoke halo: the volumetric cloud that fills the space around the
// rocket instead of pooling at its feet — no flat sheet anywhere. Two
// hullShell layers: an inner skin hugging the hull (pad ~1, its spawn
// balls reaching back to the hull wall) plus an outer billow rolling
// further out, the two spawn volumes overlapping so no ring of clear air
// ever sits between the smoke and the hull. A single shipped look, shared
// by touchdown, liftoff and countdown tremble alike; the impact scales it
// like the rest of the landing.
export const ROCKET_FX_HALOS = {
  // An even cloud wrapping the whole hull, skin to billow.
  halo: {
    key: "halo",
    label: "Halo",
    layers: [
      {
        kind: "burst",
        place: "hullShell",
        color: "smoke",
        count: 9,
        life: 2.0,
        size: 1.3,
        gravity: 1.5,
        speedMin: 0.6,
        speedMax: 1.8,
        up: 0.8,
        spread: 0.65,
        fillRadius: 1.8,
        additive: false,
        foreground: false,
        variance: [0.14, 0.14, 0.14],
        pad: 1.0,
        steps: 32,
        rows: 6,
        dirY: 0.5,
        dirScale: 1.0,
        span: 0.5,
        scale: { count: "count", size: "size", span: "height", life: "duration", up: "height" },
      },
      {
        kind: "burst",
        place: "hullShell",
        color: "smoke",
        count: 8,
        life: 2.1,
        size: 1.4,
        gravity: 1.5,
        speedMin: 0.6,
        speedMax: 1.8,
        up: 0.8,
        spread: 0.65,
        fillRadius: 2.5,
        additive: false,
        foreground: false,
        variance: [0.14, 0.14, 0.14],
        pad: 3.2,
        steps: 32,
        rows: 5,
        dirY: 0.5,
        dirScale: 1.1,
        span: 0.4,
        scale: { count: "count", size: "size", span: "height", life: "duration", up: "height" },
      },
    ],
  },
};

// The halo key list: the engine plays the first entry, so a future
// variant family plugs back in by extending the registry.
export const ROCKET_FX_HALO_KEYS = Object.keys(ROCKET_FX_HALOS);

// The reactor cone widths: T picks how wide open the thruster jets spray.
// Multipliers over the authored spread, life and outward aim, so one knob
// reshapes every engine plume at once. The spawn disc itself opens with
// the preset, so T reads from the very first frame; the velocity spread
// only breathes. Life stays full: short jets read as puffs, never cones.
export const ROCKET_FX_CONE_SIZES = {
  // A tighter burn, far end doubled.
  narrow: { key: "narrow", label: "Flare narrow (x2)", spreadMul: 2.0, lifeMul: 1.0 },
  // The reference flare, far end tripled.
  flare: { key: "flare", label: "Flare (x3)", spreadMul: 3.0, lifeMul: 1.0 },
  // Wider still, far end quadrupled: barely a jet at all.
  wide: { key: "wide", label: "Flare wide (x4)", spreadMul: 4.0, lifeMul: 1.0 },
  // Fully open, far end quintupled: an engulfing fireball.
  max: { key: "max", label: "Flare max (x5)", spreadMul: 5.0, lifeMul: 1.0 },
};

// The shipped cone width.
export const ROCKET_FX_DEFAULT_CONE = "max";

// How a preset reshapes a plume: the aim slope breathes the velocity
// spread, the base slope opens the spawn disc — both ends widen, so a
// wide preset reads wide from the very first frame, not only downstream.
export function coneSpreadK(spreadMul, aimSlope = 0.15) {
  return 1 + (spreadMul - 1) * aimSlope;
}

export function coneBaseMul(spreadMul, baseSlope = 0.35) {
  return 1 + (spreadMul - 1) * baseSlope;
}

// The cone sizes in cycle order (the registry's own order).
export const ROCKET_FX_CONE_SIZE_KEYS = Object.keys(ROCKET_FX_CONE_SIZES);

// The next cone size in the cycle, wrapping around.
export function nextConeSize(key) {
  const keys = ROCKET_FX_CONE_SIZE_KEYS;
  const i = keys.indexOf(key);
  return keys[(i + 1) % keys.length];
}

// The effect registry. Every layer names its renderer and its geometry and
// carries every number the renderer reads: the engine holds no tuning of
// its own, so the whole look is this file.
//
// `curve` names the ramp the effect's factor feeds; `origin` is the offset
// above the hull base where the effect anchors (the touchdown dust sits on
// the ground, the hull dust a body-height up).
export const ROCKET_FX_EFFECTS = {
  // The walls a carve exposed: a flash shell, a dust cone, one voxel-debris
  // burst at the face centroid, and a shock ring lying in the plane of the
  // dominant contact normal, so a wall hit throws its ring across the wall.
  impact: {
    key: "impact",
    label: "Debris + shock",
    curve: "impact",
    layers: [
      {
        kind: "flash",
        place: "faces",
        color: "flash",
        life: 0.2,
        size: 0.2,
        growth: 3.2,
        scale: { size: "size", growth: "size" },
      },
      {
        // Soft non-additive dust cone, wider than the flash.
        kind: "burst",
        place: "faces",
        color: "dust",
        count: 6,
        life: 0.9,
        size: 0.45,
        gravity: 9,
        speedMin: 1,
        speedMax: 5,
        spread: 1.1,
        up: 0,
        additive: false,
        foreground: false,
        variance: [0.12, 0.12, 0.12],
        scale: { count: "count", size: "size" },
      },
      {
        // Instanced voxel debris thrown off the face. The debris cubes keep
        // the backend's own rock colour, so the palette does not reach them.
        kind: "debris",
        place: "faceCentroid",
        count: 120,
        life: 1.0,
        radius: 1.6,
        scale: { count: "count", radius: "size" },
      },
      {
        // Flat expanding shock ring around the impact: sparks spreading
        // across the surface, then detaching from it.
        kind: "burst",
        place: "planeRing",
        palette: "embers",
        count: 4,
        life: 0.55,
        size: 0.3,
        radius: 0.7,
        steps: 16,
        gravity: 6,
        speedMin: 6,
        speedMax: 13,
        spread: 0.25,
        up: 0,
        additive: true,
        foreground: false,
        nudge: 0.5,
        scale: { count: "count", size: "size", radius: "size", speedMin: "size", speedMax: "size" },
      },
    ],
  },

  // The touchdown cloud: a continuous envelope wrapping the whole hull
  // plus the single shipped smoke halo — a volumetric cloud all
  // around the rocket, scaled by the impact speed. No flat sheet anywhere:
  // every layer spawns a volume.
  landing: {
    key: "landing",
    label: "Touchdown dust",
    curve: "landing",
    origin: { y: 0.2 },
    halo: true,
    layers: [
      {
        kind: "burst",
        place: "hullShell",
        color: "smoke",
        count: 7,
        life: 2.2,
        size: 1.6,
        gravity: 0.4,
        speedMin: 0.4,
        speedMax: 1.0,
        up: 0.7,
        spread: 0.75,
        fillRadius: 1.6,
        additive: false,
        foreground: false,
        variance: [0.14, 0.14, 0.14],
        pad: 2.2,
        steps: 24,
        rows: 5,
        dirY: 0.5,
        dirScale: 1.1,
        span: 0.6,
        scale: { count: "count", size: "size", span: "height", life: "duration", up: "height" },
      },
    ],
  },

  // The hull's own rock dust: the volume the rocket tore loose, scaled with
  // the speed it tore it at. The count follows the torn volume (one extra
  // particle per twelve cleared cells), the grain follows the blast radius.
  carve: {
    key: "carve",
    label: "Hull rock dust",
    curve: "impact",
    origin: { y: 1.5 },
    layers: [
      {
        kind: "burst",
        place: "point",
        color: "dust",
        count: 8,
        countMin: 1,
        countMax: 60,
        amountPer: 12,
        life: 0.55,
        size: 0.35,
        gravity: 8,
        speedMin: 2,
        speedMax: 7,
        up: 1,
        spread: 0.35,
        additive: false,
        foreground: false,
        variance: [0.2, 0.2, 0.2],
        scale: { count: "count", size: "size" },
      },
    ],
  },

  // The engine jet under the four nozzles while the engines push: embers
  // draw in front of everything so the pilot sees the push through the
  // faded hull, the grey smoke reads from outside. Density and speed follow
  // the thrust level. The trail is short and the cones wide: the jet reads
  // as a broad flare, not a thin streak.
  plume: {
    key: "plume",
    label: "Engine plume",
    layers: [
      {
        kind: "burst",
        place: "nozzles",
        palette: "embers",
        count: 48,
        life: 0.55,
        size: 0.32,
        gravity: 5,
        speedMin: 1.4,
        speedMax: 2.8,
        spread: 0.35,
        baseRadius: 0.35,
        flare: 0.6,
        fillRadius: 0.2,
        up: 0,
        additive: true,
        foreground: true,
        ramp: { on: "level", count: 48, speedMax: 2.1 },
      },
      {
        kind: "burst",
        place: "nozzles",
        color: "dust",
        count: 24,
        life: 0.7334,
        size: 0.34,
        gravity: 2,
        speedMin: 0.7,
        speedMax: 2.1,
        up: 0.5,
        spread: 0.4,
        baseRadius: 0.4,
        flare: 0.6,
        fillRadius: 0.2,
        additive: false,
        foreground: false,
        variance: [0.1, 0.1, 0.1],
        ramp: { on: "level", count: 24 },
      },
    ],
  },

  // The burn under the nozzles while the engines run without a jet: the
  // countdown tremor and the landing fade, always spraying downward.
  exhaust: {
    key: "exhaust",
    label: "Thruster burn",
    layers: [
      {
        kind: "burst",
        place: "nozzles",
        color: "exhaust",
        count: 40,
        life: 0.8,
        size: 0.28,
        gravity: 1.5,
        speedMin: 0.7,
        speedMax: 2.8,
        up: 0.3,
        spread: 0.55,
        baseRadius: 0.3,
        flare: 0.5,
        fillRadius: 0.2,
        additive: true,
        foreground: false,
        variance: [0.1, 0.2, 0.2],
      },
    ],
  },
};

// The factors of a curve at a normalized input t (0 .. 1): the count, size,
// span, lifetime and shake the layers scale by. The intensity knob scales
// every factor alike, so the cloud and the shake move together by the same
// percentage.
export function fxScale(curveKey, t) {
  const curve = ROCKET_FX_CURVES[curveKey];
  const k = curve.intensity ?? 1;
  const out = {};
  for (const [key, range] of Object.entries(curve)) {
    if (key === "clamp" || key === "intensity") continue;
    const [lo, hi] = range;
    out[key] = lo + (hi - lo) * t;
  }
  for (const [key, [lo, hi]] of Object.entries(curve.clamp)) {
    out[key] = Math.max(lo, Math.min(hi, out[key]));
  }
  for (const key of Object.keys(out)) out[key] *= k;
  return out;
}

// The speed factor: how hard a landing reads, 0 .. 1 against its reference
// speed. The landing's cloud and its shake read the same one, so they
// always land together.
export function speedFactor(speed, refSpeed) {
  if (!refSpeed) return 0;
  return Math.max(0, Math.min(1, speed / refSpeed));
}

// The effective props of a layer: the ramp added, the live smoke Y
// applied (height to the span/drift, density to the count — never to the
// lifetime), the amount term added, the scale factors multiplied in, the
// count resolved. Pure, so the headless suite can pin it.
//
// The order matters: the ramp grows the base (the thrust level adds
// particles and jet speed), Y tunes the smoke's height/density before
// any speed scaling, the amount term adds the torn volume to the
// count, and the scale factors multiply the result — so the blast grows
// with the speed the hull carries.
export function resolveLayer(layer, { scale = {}, ramp = 0, amount = 0, smokeY = null } = {}) {
  const props = { ...layer };
  if (layer.ramp) {
    for (const [prop, per] of Object.entries(layer.ramp)) {
      if (prop === "on") continue;
      if (typeof layer[prop] !== "number") continue;
      props[prop] = layer[prop] + per * ramp;
    }
  }
  // The tuned smoke envelope (height to the span/drift, density to the
  // count): the engine always passes it, so there is no second baseline.
  const y = smokeY;
  if (y && layer.place === "hullShell" && layer.color === "smoke") {
    if (typeof props.count === "number") props.count = props.count * (y.density ?? 1);
    for (const prop of ["span", "up"]) {
      if (typeof props[prop] === "number") props[prop] = props[prop] * (y.height ?? 1);
    }
  }
  if (layer.amountPer) {
    props.count = (props.count ?? 0) + Math.floor(amount / layer.amountPer);
  }
  for (const [prop, factor] of Object.entries(layer.scale || {})) {
    if (typeof props[prop] !== "number") continue;
    props[prop] = props[prop] * (scale[factor] ?? 1);
  }
  if (typeof props.count === "number") {
    const min = layer.countMin ?? 1;
    const max = layer.countMax ?? Infinity;
    props.count = Math.max(min, Math.min(max, Math.round(props.count)));
  }
  return props;
}

// Ring points hugging the hull footprint: a superellipse (rounded square)
// so every point sits outside the square base instead of dipping under
// its corners like a circle does. The corner arcs of a superellipse pull
// inward though, so they are pushed back out to the hull's edge: the ring
// may sit as close as the footprint allows, but never under it. Returns
// [dx, dz] pairs, centre-relative. `phase` shifts the sampling along the
// ring (in steps), so stacked rings never line their points up.
export function landingRingPoints(halfW, halfD, pad, steps, phase = 0) {
  const n = Math.max(4, steps | 0);
  const a = halfW + pad, b = halfD + pad;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + phase) / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    let dx = a * Math.sign(c) * Math.pow(Math.abs(c), 0.5);
    let dz = b * Math.sign(s) * Math.pow(Math.abs(s), 0.5);
    const edge = Math.max(Math.abs(dx) / halfW, Math.abs(dz) / halfD);
    if (edge < 1) {
      const k = 1 / edge;
      dx *= k;
      dz *= k;
    }
    pts.push([dx, dz]);
  }
  return pts;
}

// The six neighbour directions, used to find the faces a carve exposed.
const FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Faces exposed by a carve: for every cleared cell, the neighbours that are
// still solid are the walls the rocket just opened. `isSolidAt` is injected
// so the helper stays pure and headless-testable.
//
// Each face is reported as the point just inside the void next to the wall
// (so a point sprite never z-fights with the solid block) plus the normal
// pointing out of the wall, into the open air.
//
// The bottom face of the swept box never reacts: a contact whose solid
// neighbour lies BELOW the cleared cell is the floor the rocket rests on, and
// the ground stays intact under a landing. Those contacts are dropped.
//
// Faces are bucketed per direction and then sampled round-robin across the
// buckets, so the sides of the bored shaft each keep a share of the budget
// instead of one side crowding the others out.
export function exposedFaces(cells, isSolidAt, opts = {}) {
  const { maxFaces = 24, maxCells = 2400, skipBelow = true } = opts;
  const buckets = [[], [], [], [], [], []];
  if (!cells || !cells.length) return [];
  const n = Math.min(cells.length, maxCells);
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    for (let d = 0; d < FACE_DIRS.length; d++) {
      const dir = FACE_DIRS[d];
      // The box's bottom face: the ground under the rocket stays intact.
      if (skipBelow && dir[1] === -1) continue;
      if (!isSolidAt(c[0] + dir[0], c[1] + dir[1], c[2] + dir[2])) continue;
      buckets[d].push({
        x: c[0] + 0.5 + dir[0] * 0.35,
        y: c[1] + 0.5 + dir[1] * 0.35,
        z: c[2] + 0.5 + dir[2] * 0.35,
        nx: -dir[0], ny: -dir[1], nz: -dir[2],
      });
    }
  }
  const out = [];
  let more = true;
  while (out.length < maxFaces && more) {
    more = false;
    for (const b of buckets) {
      if (!b.length) continue;
      more = true;
      // Take from the middle of the bucket so the sample spreads along the
      // wall instead of hugging one end.
      out.push(b.splice((b.length / 2) | 0, 1)[0]);
      if (out.length >= maxFaces) break;
    }
  }
  return out;
}

// The spec's own contract: the renderers and the geometries the engine
// knows, and the props each of them reads. A layer that misses one of them
// would spawn with a silent default, so the validator refuses the spec
// instead.
//
// `sprays` marks the geometries that aim their particles along a direction:
// those layers must name their cone spread, the isotropic ones need not.
export const FX_LAYER_KINDS = {
  flash: { props: ["life", "size", "growth"], bools: [] },
  burst: { props: ["count", "life", "size", "gravity", "speedMin", "speedMax", "up"], bools: ["additive", "foreground"], triples: ["variance"] },
  debris: { props: ["count", "life", "radius"], bools: [] },
};

export const FX_PLACES = {
  faces: { props: [], sprays: true },
  faceCentroid: { props: [], sprays: false },
  planeRing: { props: ["radius", "steps", "nudge"], sprays: true },
  hullShell: { props: ["pad", "steps", "rows", "dirY", "dirScale", "span"], sprays: true },
  nozzles: { props: ["baseRadius", "flare"], sprays: true },
  point: { props: [], sprays: false },
};

// The problems a layer set carries: an unknown renderer or geometry, a
// missing prop, a palette role or scale factor that does not exist.
function layerProblems(name, layers, factors) {
  const problems = [];
  for (const layer of layers) {
    const kind = FX_LAYER_KINDS[layer.kind];
    if (!kind) {
      problems.push(`${name}: unknown layer kind ${layer.kind}`);
      continue;
    }
    const place = FX_PLACES[layer.place];
    if (!place) problems.push(`${name}: unknown place ${layer.place}`);
    const required = [...kind.props, ...(place ? place.props : [])];
    // A layer that sprays along a direction must name its cone spread.
    if (layer.kind === "burst" && place?.sprays) required.push("spread");
    for (const prop of required) {
      const value = layer[prop];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`${name}: ${prop} is missing or not a finite number`);
      }
    }
    for (const prop of kind.bools) {
      if (typeof layer[prop] !== "boolean") {
        problems.push(`${name}: ${prop} is missing or not a boolean`);
      }
    }
    for (const prop of kind.triples ?? []) {
      // The palette path ignores the variance: it picks a colour per
      // particle instead of jittering one.
      if (prop === "variance" && !layer.color) continue;
      const value = layer[prop];
      if (!Array.isArray(value) || value.length !== 3 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
        problems.push(`${name}: ${prop} is missing or not an rgb triple`);
      }
    }
    if (layer.color && !(layer.color in ROCKET_FX_PALETTE)) problems.push(`${name}: unknown palette role ${layer.color}`);
    if (layer.palette && !(layer.palette in ROCKET_FX_PALETTE)) problems.push(`${name}: unknown palette role ${layer.palette}`);
    for (const factor of Object.values(layer.scale || {})) {
      if (!factors.includes(factor)) problems.push(`${name}: unknown scale factor ${factor}`);
    }
    if (layer.ramp) {
      for (const prop of Object.keys(layer.ramp)) {
        if (prop === "on") continue;
        if (typeof layer[prop] !== "number") problems.push(`${name}: the ramp drives the missing prop ${prop}`);
      }
    }
  }
  return problems;
}

// The spec is valid when every effect is well formed: a known renderer, a
// known geometry, every prop the renderer reads present and finite, a
// palette role that exists, and a scale map that names factors the effect's
// curve really has. The halo variants are held to the same contract
// (they play on the landing curve), and every cone size names finite
// positive multipliers. Returns the problems it found (empty when sound).
export function validateRocketFx() {
  const problems = [];
  for (const [key, effect] of Object.entries(ROCKET_FX_EFFECTS)) {
    if (effect.key !== key) problems.push(`${key}: the effect's key does not match its registry key`);
    if (!effect.layers || !effect.layers.length) problems.push(`${key}: no layers`);
    const curve = effect.curve ? ROCKET_FX_CURVES[effect.curve] : null;
    if (effect.curve && !curve) problems.push(`${key}: unknown curve ${effect.curve}`);
    const factors = curve ? Object.keys(curve).filter((f) => f !== "clamp" && f !== "intensity") : [];
    problems.push(...layerProblems(key, effect.layers ?? [], factors));
  }
  const landingFactors = Object.keys(ROCKET_FX_CURVES.landing).filter((f) => f !== "clamp" && f !== "intensity");
  for (const [key, halo] of Object.entries(ROCKET_FX_HALOS)) {
    if (halo.key !== key) problems.push(`halo.${key}: the key does not match its registry key`);
    if (!halo.layers || !halo.layers.length) problems.push(`halo.${key}: no layers`);
    problems.push(...layerProblems(`halo.${key}`, halo.layers ?? [], landingFactors));
  }
  for (const [key, size] of Object.entries(ROCKET_FX_CONE_SIZES)) {
    if (size.key !== key) problems.push(`cone.${key}: the key does not match its registry key`);
    for (const prop of ["spreadMul", "lifeMul"]) {
      const value = size[prop];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        problems.push(`cone.${key}: ${prop} is missing or not a positive finite number`);
      }
    }
  }
  if (!(ROCKET_FX_DEFAULT_CONE in ROCKET_FX_CONE_SIZES)) problems.push("the default cone size names no known size");
  return problems;
}
