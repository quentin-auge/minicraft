// Block reactions: a trigger block placed on top of a base block starts a
// reaction on that base cell. The registry entry names the base block, the
// trigger blocks it accepts, and the action — so a new reacting block (or a
// new trigger, or a new outcome) is one registry row, never a fork.
//
// The trigger is eaten when the reaction arms (the soil drinks it), the
// reaction runs for `duration` seconds, then the base cell settles with a
// variant: a named look the render layer draws and other systems can query
// (wet soil today; a grown pine later).
//
// The framework decides, the callers apply: it never writes voxels and never
// touches the renderer. The edit layer consumes the trigger, the sim tick
// pulls in leftovers and refreshes what changed, the render layer draws the
// variants.
//
// Three-free (plain maps + data) so the headless suite drives it directly:
// the render layer reads the variants, the FX layer reads the runs.
import { DIRT, WATER, LAVA, MOON_WATER, isLiquid } from "../core/blocks.js";
import { DIMENSION_KEYS, dim, getBlock, setBlock, key } from "../core/store.js";

// Shared defaults: entries spread this first and override only what
// differs, so a new entry never restates the whole shape.
const REACTION_DEFAULTS = {
  // Seconds the reaction runs before it settles.
  duration: 0.5,
  // The trigger block is eaten when the reaction arms (the soil drinks it).
  consume: true,
  // A liquid standing on the base cell is pulled in when the reaction
  // settles (the soil drinks that too).
  absorbsAbove: false,
  // (ctx) => variant key settled on the base cell.
  variant: null,
  // (ctx) => true refuses the reaction before it arms. The trigger is eaten
  // anyway (the soil drank it) and the refusal is reported, so the caller
  // can play a fail blink.
  refuses: null,
  // (ctx) => [cells], extra work once the reaction settles (growing a pine).
  onComplete: null,
};

// A reaction entry:
//   key     stable id
//   base    block id the reaction sits on
//   accepts block ids accepted on top of it
//   ...REACTION_DEFAULTS
export const REACTION_TYPES = [
  {
    ...REACTION_DEFAULTS,
    key: "soak_dirt",
    base: DIRT,
    accepts: [WATER, LAVA, MOON_WATER],
    absorbsAbove: true,
    // Moon water soaks pale, plain water and lava soak blue.
    variant: (ctx) => (ctx.trigger === MOON_WATER ? "wet_moon" : "wet_water"),
  },
];

// Variants: the settled look a reaction leaves on its base cell. Pure data —
// the render layer turns it into materials, the FX layer into particles.
export const VARIANT_LOOKS = {
  wet_water: {
    key: "wet_water",
    // Blocks this variant may sit on.
    blocks: [DIRT],
    // Texture key in core/textures.js for the marked block's faces.
    texture: "dirtWet",
    // Translucent shell drawn around the settled cell: base opacity, the
    // breathing amplitude and its period (sim seconds). Water and lava read
    // stronger than master's 0.16 + 0.12 pulse on purpose (0.16..0.40).
    shell: { color: 0x2a5fd0, base: 0.16, amp: 0.24, period: 1.885 },
    // The trigger sinking into the cell while the reaction runs.
    indicator: { color: 0x3a6fd8, opacity: 0.75 },
    // Droplets kicked up when the reaction arms and when it settles.
    drip: {
      palette: [[0.3, 0.5, 0.9], [0.25, 0.45, 0.85], [0.35, 0.55, 0.95]],
      count: 14, life: 0.5, size: 0.22,
    },
  },
  wet_moon: {
    key: "wet_moon",
    blocks: [DIRT],
    texture: "dirtWet",
    // Moon water keeps master's own pulse (0.16..0.28).
    shell: { color: 0xeef1f4, base: 0.16, amp: 0.12, period: 1.885 },
    indicator: { color: 0x7a7e82, opacity: 0.75 },
    drip: {
      palette: [[0.48, 0.49, 0.51], [0.43, 0.44, 0.46], [0.53, 0.54, 0.56]],
      count: 14, life: 0.5, size: 0.22,
    },
  },
};

// Block ids that may carry a variant — the mesher only asks about these
// cells, so the per-cell lookup stays off the hot path for everything else.
export const VARIANT_BLOCKS = new Set(
  Object.values(VARIANT_LOOKS).flatMap((v) => v.blocks),
);

// Per-dimension state: running reactions and settled variants, both keyed by
// the base cell.
const fromKeys = (make) => Object.fromEntries(DIMENSION_KEYS.map((k) => [k, make()]));
const runs = fromKeys(() => new Map());      // cell key -> run
const variants = fromKeys(() => new Map());  // cell key -> variant key

// Event listeners: the world layer stays three-free, the render/FX layer
// listens (drips, indicator meshes).
const listeners = new Set();
export function onReaction(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(ev) {
  for (const fn of listeners) fn(ev);
}

// The reaction accepting this trigger on this base block, or null.
export function reactionFor(baseId, triggerId) {
  for (const spec of REACTION_TYPES) {
    if (spec.base !== baseId) continue;
    if (!spec.accepts.includes(triggerId)) continue;
    return spec;
  }
  return null;
}

// Try to start a reaction on the base cell (x, y, z) with the trigger block
// just placed on top of it (the cell above the base). Returns null when no
// reaction matches (wrong base or wrong trigger), otherwise:
//   armed    the reaction runs now
//   refused  a spec vetoed it
//   consumed the caller must clear the trigger block (the cell above)
//   mark     the variant key the reaction leaves when it settles
export function armReaction(x, y, z, triggerId) {
  const spec = reactionFor(getBlock(x, y, z), triggerId);
  if (!spec) return null;
  const k = key(x, y, z);
  const ctx = { x, y, z, dim, trigger: triggerId, spec, getBlock, setBlock };
  if (spec.refuses && spec.refuses(ctx)) {
    emit({ type: "refused", x, y, z, trigger: triggerId, spec });
    return { armed: false, refused: true, consumed: spec.consume, mark: null };
  }
  // A cell already running or already settled never reacts twice: the
  // trigger stays where it was put.
  if (runs[dim].has(k) || variants[dim].has(k)) {
    return { armed: false, refused: false, consumed: false, mark: null };
  }
  const mark = spec.variant ? spec.variant(ctx) : null;
  runs[dim].set(k, {
    key: spec.key,
    x, y, z,
    mark,
    trigger: triggerId,
    t: spec.duration,
    duration: spec.duration,
  });
  emit({ type: "armed", x, y, z, trigger: triggerId, mark, spec });
  return { armed: true, refused: false, consumed: spec.consume, mark };
}

// Advance the running reactions of the current dimension. Returns the
// settled cells (with the variant they carry, whether a liquid sits on top
// to be pulled in, and any cells the spec touched) and the cells whose
// reaction died because the base block changed.
export function tickReactions(dt) {
  const settled = [];
  const released = [];
  const map = runs[dim];
  if (!map.size) return { settled, released };
  for (const [k, run] of map) {
    const spec = REACTION_TYPES.find((r) => r.key === run.key);
    // The base block must still be there and still the reaction's base:
    // breaking or replacing it releases the reaction.
    if (!spec || getBlock(run.x, run.y, run.z) !== spec.base) {
      map.delete(k);
      released.push([run.x, run.y, run.z]);
      continue;
    }
    run.t -= dt;
    if (run.t > 0) continue;
    map.delete(k);
    const ctx = { x: run.x, y: run.y, z: run.z, dim, trigger: run.trigger, spec, getBlock, setBlock };
    const absorb = !!spec.absorbsAbove && isLiquid(getBlock(run.x, run.y + 1, run.z));
    const touched = [];
    if (spec.onComplete) {
      const extra = spec.onComplete(ctx);
      if (extra) for (const c of extra) touched.push(c);
    }
    if (run.mark) variants[dim].set(k, run.mark);
    settled.push({ x: run.x, y: run.y, z: run.z, mark: run.mark, absorb, touched });
    emit({ type: "settled", x: run.x, y: run.y, z: run.z, mark: run.mark, spec });
  }
  return { settled, released };
}

// The variant settled on a cell, or null. A cell whose block changed
// (broken or replaced) drops its variant on the spot.
export function variantAt(x, y, z) {
  const k = key(x, y, z);
  const variant = variants[dim].get(k);
  if (variant === undefined) return null;
  const look = VARIANT_LOOKS[variant];
  if (!look || !look.blocks.includes(getBlock(x, y, z))) {
    variants[dim].delete(k);
    return null;
  }
  return variant;
}

// Every running reaction of the current dimension (the FX layer reads them).
export function activeRuns() {
  return [...runs[dim].values()];
}

// Drop the state of a cell (the base block was broken or replaced).
export function clearReactionAt(x, y, z) {
  const k = key(x, y, z);
  runs[dim].delete(k);
  variants[dim].delete(k);
}

// Drop a dimension's state (regenerate dims rebuild from scratch).
export function clearReactionsDim(name) {
  runs[name].clear();
  variants[name].clear();
}

// Drop every dimension's state (new world).
export function resetReactionMemory() {
  for (const name of DIMENSION_KEYS) {
    runs[name].clear();
    variants[name].clear();
  }
}
