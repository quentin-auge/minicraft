// Rocket FX engine: plays the effects the spec (rocketfx.js) describes.
//
// The engine holds no tuning: every number lives in the spec's layers, and
// the engine only knows HOW to place and draw them. A layer names its
// renderer (`kind`) and its geometry (`place`); the engine dispatches on
// those two and reads the props.
//
// Every rocket layer draws on the vehicle FX band of the compositing ladder
// (see src/render/orders.js), so the rocket's own effects never sit under
// the world's transparent bands.
import { spawnBurst, spawnBurstBatch, spawnFlashBatch, spawnDebris, coneBasis } from "./particles.js";
import { ROCKET_FX_EFFECTS, ROCKET_FX_HALOS, ROCKET_FX_HALO_KEYS, ROCKET_FX_REACTOR_DIAMETERS, ROCKET_FX_DEFAULT_DIAMETER, ROCKET_FX_REACTOR_DEPTHS, ROCKET_FX_DEFAULT_DEPTH, ROCKET_FX_PALETTE, fxScale, resolveLayer, landingRingPoints, coneSpreadK, coneBaseMul } from "./rocketfx.js";
import { ORDERS } from "../render/orders.js";

// Where a layer's particles start and which way they spray.
const PLACEMENTS = {
  // One center per exposed face, spraying along the face normal.
  faces(ctx) {
    const faces = ctx.faces ?? [];
    return {
      centers: faces.map((f) => [f.x, f.y, f.z]),
      dirs: faces.map((f) => [f.nx, f.ny, f.nz]),
    };
  },
  // The centroid of the exposed faces: the debris burst plays there, since
  // the debris pool is a single global burst.
  faceCentroid(ctx) {
    const faces = ctx.faces ?? [];
    if (!faces.length) return { centers: [], dirs: null };
    let cx = 0, cy = 0, cz = 0;
    for (const f of faces) { cx += f.x; cy += f.y; cz += f.z; }
    const n = faces.length;
    return { centers: [[cx / n, cy / n, cz / n]], dirs: null };
  },
  // A ring lying in the plane of the dominant contact normal, so a wall hit
  // spreads its ring across the wall instead of along the ground.
  planeRing(ctx, layer, props) {
    const faces = ctx.faces ?? [];
    if (!faces.length) return { centers: [], dirs: null };
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    for (const f of faces) {
      cx += f.x; cy += f.y; cz += f.z;
      nx += f.nx; ny += f.ny; nz += f.nz;
    }
    const n = faces.length;
    cx /= n; cy /= n; cz /= n;
    nx /= n; ny /= n; nz /= n;
    // Dominant normal: the axis the most faces point along.
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let axis;
    if (ax >= ay && ax >= az) axis = [Math.sign(nx) || 1, 0, 0];
    else if (ay >= az) axis = [0, Math.sign(ny) || 1, 0];
    else axis = [0, 0, Math.sign(nz) || 1];
    // Two vectors spanning the plane the ring lies in.
    const { right, upAxis } = coneBasis(axis);
    const steps = layer.steps;
    const radius = props.radius;
    const nudge = layer.nudge;
    const centers = [];
    const dirs = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      centers.push([
        cx + right[0] * c * radius + upAxis[0] * s * radius,
        cy + right[1] * c * radius + upAxis[1] * s * radius,
        cz + right[2] * c * radius + upAxis[2] * s * radius,
      ]);
      // Radial across the surface, plus a nudge off it.
      dirs.push([
        right[0] * c + upAxis[0] * s + axis[0] * nudge,
        right[1] * c + upAxis[1] * s + axis[1] * nudge,
        right[2] * c + upAxis[2] * s + axis[2] * nudge,
      ]);
    }
    return { centers, dirs };
  },
  // A continuous envelope around the whole hull: rows of superellipse
  // rings climbing the rocket, each row sampled at a different phase so no
  // seam lines up (one row-step per ring), every particle spraying outward.
  // The smoke surrounds the rocket instead of pooling at a few heights.
  hullShell(ctx, layer, props, anchor) {
    const rows = layer.rows, steps = layer.steps;
    // The shell's vertical extent scales with the touchdown: a soft landing
    // hugs the ground, a max-speed drop wraps the whole hull. `span` is 1
    // for a full hull height; the curve shrinks it toward 0.
    const height = (ctx.hullHeight ?? 0) * (props.span ?? 1);
    const centers = [];
    const dirs = [];
    for (let r = 0; r < rows; r++) {
      const y = anchor[1] + (r + 0.5) * (height / rows);
      const phase = r / 2;
      for (const [dx, dz] of landingRingPoints(ctx.halfW, ctx.halfD, layer.pad, steps, phase)) {
        const len = Math.hypot(dx, dz) || 1;
        const ox = dx / len, oz = dz / len;
        centers.push([anchor[0] + dx, y, anchor[2] + dz]);
        dirs.push([ox * layer.dirScale, layer.dirY, oz * layer.dirScale]);
      }
    }
    return { centers, dirs };
  },
  // The thruster nozzles, always spraying downward — braking thrust
  // included, so the exhaust never rises into the hull. Each nozzle emits
  // a small disc of spawn points (baseRadius, widened by the cone's base slope)
  // instead of a single point, with each sub-center aimed slightly
  // outward (flare): the cone reads wide from its very base, and both
  // ends widen with the preset.
  nozzles(ctx, layer, props) {
    const nozzles = ctx.nozzles ?? [];
    const R = props.baseRadius ?? 0;
    const flare = props.flare ?? 0;
    if (!nozzles.length) return { centers: [], dirs: null };
    if (!(R > 0)) {
      return { centers: nozzles, dirs: nozzles.map(() => [0, -1, 0]), nozzleCount: nozzles.length };
    }
    const SUB = 8;
    const centers = [];
    const dirs = [];
    for (const [nx, ny, nz] of nozzles) {
      for (let k = 0; k < SUB; k++) {
        const a = (k / SUB) * Math.PI * 2 + Math.PI / 4;
        const ox = Math.cos(a) * R;
        const oz = Math.sin(a) * R;
        centers.push([nx + ox, ny, nz + oz]);
        const len = Math.hypot(ox * flare, 1, oz * flare) || 1;
        dirs.push([(ox * flare) / len, -1 / len, (oz * flare) / len]);
      }
    }
    return { centers, dirs, nozzleCount: nozzles.length };
  },
  // A single center at the effect's anchor.
  point(ctx, layer, props, anchor) {
    return { centers: [[anchor[0], anchor[1] + (layer.lift ?? 0), anchor[2]]], dirs: null };
  },
};

// How a layer's props reach the particle backend.
const RENDERERS = {
  // An expanding flash shell, one instance per center in a single draw.
  flash(layer, props, place) {
    spawnFlashBatch({
      centers: place.centers,
      color: ROCKET_FX_PALETTE[layer.color],
      life: props.life,
      size: props.size,
      growth: props.growth,
      renderOrder: ORDERS.VEHICLE_FX,
    });
  },
  // A particle cloud: one batched draw for many centers, a single cloud
  // when there is one center and no direction to spray along.
  burst(layer, props, place) {
    // A layer either paints one flat colour or picks a palette entry per
    // particle; the palette role names which.
    const paint = layer.palette
      ? { palette: ROCKET_FX_PALETTE[layer.palette] }
      : { color: ROCKET_FX_PALETTE[layer.color] };
    // The divergent nozzle disc multiplies the centers per thruster: keep
    // the particle budget constant by dealing the count across sub-centers.
    let count = props.count;
    if (layer.place === "nozzles" && place.nozzleCount > 0 && place.centers.length > place.nozzleCount) {
      count = Math.max(1, Math.round(props.count * place.nozzleCount / place.centers.length));
    }
    // At the smoke floor (one particle per center or less) emit on every
    // second center instead: the minimum reads half as dense while the max
    // keeps every center. Deterministic stride, so no flicker.
    let centers = place.centers;
    let dirs = place.dirs;
    if (layer.place === "hullShell" && layer.color === "smoke" && props.count <= 1 && centers.length > 1) {
      centers = centers.filter((_, i) => i % 2 === 0);
      dirs = dirs ? dirs.filter((_, i) => i % 2 === 0) : dirs;
    }
    const common = {
      count,
      life: props.life,
      size: props.size,
      gravity: props.gravity,
      speedMin: props.speedMin,
      speedMax: props.speedMax,
      up: props.up,
      spread: props.spread,
      additive: props.additive,
      foreground: props.foreground ?? false,
      variance: props.variance,
      // Spawn ball: the particles start spread through it, so a row of
      // centers reads as a continuous volume instead of separate specks.
      fillRadius: props.fillRadius ?? 0,
      renderOrder: ORDERS.VEHICLE_FX,
      ...paint,
    };
    if (!dirs && centers.length === 1) {
      const c = centers[0];
      spawnBurst({ ...common, x: c[0], y: c[1], z: c[2] });
      return;
    }
    spawnBurstBatch({ ...common, centers, directions: dirs });
  },
  // Instanced voxel debris thrown off the impact.
  debris(layer, props, place) {
    const c = place.centers[0];
    spawnDebris({
      x: c[0], y: c[1], z: c[2],
      R: props.radius,
      count: props.count,
      life: props.life,
    });
  },
};

// Play one effect of the registry.
//
// `ctx` carries the situation, never the styling:
//   factor     the normalized input the effect's curve reads (0 .. 1)
//   diameter   the key of the chosen reactor diameter
//   depth      the key of the chosen reactor depth
//   faces      the walls a carve exposed (the face placements)
//   nozzles    the thruster positions (the nozzle placement)
//   x, y, z    the hull's min corner; halfW/halfD its footprint
//   hullHeight how tall the hull is (the shell climbs it)
//   ramp       the ramp inputs a layer names (level, progress)
//   amount     the torn volume, for the layers that count it
//
// Returns the factors the effect's curve resolved, so the caller can read
// the landing's shake out of the very numbers the cloud was built with.
export function playFx(key, ctx = {}) {
  const effect = ROCKET_FX_EFFECTS[key];
  if (!effect) return {};
  const scale = effect.curve ? fxScale(effect.curve, ctx.factor ?? 0) : {};
  const anchor = effect.origin
    ? [ctx.x + ctx.halfW, ctx.y + (effect.origin.y ?? 0), ctx.z + ctx.halfD]
    : null;
  // The landing's surrounding cloud is the single shipped halo: its layers
  // play after the effect's own, with the same scale.
  const halo = effect.halo ? ROCKET_FX_HALOS[ROCKET_FX_HALO_KEYS[0]] : null;
  const layers = halo ? [...effect.layers, ...halo.layers] : effect.layers;
  // The tuned numbers, read once per effect: the smoke envelope's
  // density/height/lifetime, the diameter slopes and the depth lifetime.
  // One struct, no per-layer re-reads.
  const diameter = ROCKET_FX_REACTOR_DIAMETERS[ctx.diameter] ?? ROCKET_FX_REACTOR_DIAMETERS[ROCKET_FX_DEFAULT_DIAMETER] ?? { spreadMul: 1 };
  const depth = ROCKET_FX_REACTOR_DEPTHS[ctx.depth] ?? ROCKET_FX_REACTOR_DEPTHS[ROCKET_FX_DEFAULT_DEPTH] ?? { lifeMul: 1 };
  const live = {
    smokeY: { height: 0.2, density: 1.5 },
    smokeLife: 0.8,
    spreadK: coneSpreadK(diameter.spreadMul),
    baseK: coneBaseMul(diameter.spreadMul),
    spreadMul: diameter.spreadMul,
    lifeMul: depth.lifeMul,
  };
  // The shipped diameter for every engine plume: narrow opens the outward
  // aim (x2 on the far end) while the velocity spread breathes with the
  // aim slope — and the spawn disc itself widens with the base slope, so
  // the cone reads wide from the very first frame instead of only
  // downstream. The shipped depth shortens each jet along its thrust axis
  // without changing that width.
  for (const layer of layers) {
    const rampValue = layer.ramp ? (ctx.ramp?.[layer.ramp.on] ?? 0) : 0;
    const props = resolveLayer(layer, { scale, ramp: rampValue, amount: ctx.amount ?? 0, smokeY: live.smokeY });
    // The landing smoke hangs longer than the height alone would give
    // (it shares the look, so countdown and liftoff follow).
    if (layer.place === "hullShell" && layer.color === "smoke" && typeof props.life === "number") {
      props.life = props.life * live.smokeLife;
    }
    if (layer.place === "nozzles") {
      props.spread = props.spread * live.spreadK;
      props.life = props.life * live.lifeMul;
      if (typeof props.baseRadius === "number") props.baseRadius = props.baseRadius * live.baseK;
      if (typeof props.fillRadius === "number") props.fillRadius = props.fillRadius * live.baseK;
      if (typeof props.flare === "number") props.flare = props.flare * live.spreadMul;
    }
    const place = PLACEMENTS[layer.place](ctx, layer, props, anchor);
    if (!place || !place.centers.length) continue;
    // ?test=1 probe: record what the engine actually sprayed, so the
    // browser driver can assert widening/density per preset. Inert
    // unless the test hook armed window.__fxProbe — zero prod impact.
    if (layer.place === "nozzles" && typeof window !== "undefined" && window.__fxProbe && window.__fxProbe.length < 20000) {
      window.__fxProbe.push({
        fx: key, diameter: ctx.diameter ?? null, depth: ctx.depth ?? null,
        centers: place.centers.length,
        count: props.count, spread: props.spread, life: props.life,
        flare: props.flare ?? null, baseRadius: props.baseRadius ?? null,
      });
    }
    RENDERERS[layer.kind](layer, props, place);
  }
  return scale;
}
