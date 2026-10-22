// Baked halos: every registered source tints the opaque blocks around its
// positions, permanently, with no dynamic lights involved. The mesher stamps
// one instance color per block at chunk-build time (white = untouched);
// edits, blasts, and streaming rebuild the chunks in halo range, so the tint
// can never go stale or migrate. This baked tint is the whole glow: no
// dynamic lights involved anywhere, so every source reads lit instead of
// a max of the nearest ones.
//
// Extension shape: HALO_SOURCES is the registry (same pattern as
// registerChunkSource/registerRenderDist in core/store.js); sources
// self-register beside the data they read — glowstone in world/glowstone.js,
// portal frames in world/portals.js — and the bake below never switches on
// source names. New glowing families (new tree types, hook kinds, flower
// variants, particle effects) register a spec
// { key, radius, gain, max, positions, colorOf } and nothing else changes.
// Three-free (plain maps and hex math) so worldgen and the headless harness
// can use it; the mesher owns the THREE.Color scratch and the setColorAt loop.
import { keyXYZ } from "../core/store.js";

export const HALO_SOURCES = [];

// Suspended spec keys: the bake skips them until cleared. Still-hold bridge
// strokes suspend the glowstone halo so dense placements rebuild cheap
// geometry-only chunks; the caller re-queues the touched range on release and
// the tint bakes then. Null (default) suspends nothing.
let suspendedKeys = null;
export function setHaloSuspended(keys) {
  suspendedKeys = keys;
}
export function isHaloSuspended() {
  return suspendedKeys !== null;
}

// Source spec: radius (blocks, Euclidean cutoff), gain (adjacent-block lift),
// max (per-channel clamp against overlap blowout), positions(name) -> Set of
// voxel keys, colorOf(name, voxelKey) -> hex.
export function registerHaloSource(spec) {
  if (!HALO_SOURCES.some((s) => s.key === spec.key)) HALO_SOURCES.push(spec);
}

// Widest registered halo: an edit rebuilds every chunk its halo can touch.
// Computed live (not a const) so late-registered sources widen the range;
// R < CHUNK keeps every edit at 1..4 chunks.
export function haloRadius() {
  let r = 0;
  for (const s of HALO_SOURCES) if (s.radius > r) r = s.radius;
  return r;
}

// hex -> rgb, cached (chunk builds call colorOf per source block; the palette
// is a handful of entries, never per-block garbage).
const rgbCache = new Map();
function rgbOf(hex) {
  let t = rgbCache.get(hex);
  if (!t) {
    t = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    rgbCache.set(hex, t);
  }
  return t;
}

// Tint multipliers for the opaque cells of one chunk column, keyed
// "x,y,z" like the mesher's instance lists. Null when no source reaches the
// chunk (the mesher then skips instance colors entirely). yLo/yHi bound the
// chunk's own instances; sources are read R past them in every axis. The
// quadratic falloff mirrors the dynamic pool's decay 2, so baked and live
// light read as one gradient.
export function bakeHaloTint(name, x0, x1, z0, z1, yLo, yHi) {
  let out = null;
  let clamp = 0;
  for (const spec of HALO_SOURCES) {
    if (suspendedKeys && suspendedKeys.has(spec.key)) continue;
    const set = spec.positions(name);
    if (!set || !set.size) continue;
    if (spec.max > clamp) clamp = spec.max;
    const R = spec.radius, R2 = R * R, R1 = R + 1;
    for (const k of set) {
      const [sx, sy, sz] = keyXYZ(k);
      if (sx < x0 - R || sx > x1 + R || sz < z0 - R || sz > z1 + R) continue;
      if (sy < yLo - R || sy > yHi + R) continue;
      const [cr, cg, cb] = rgbOf(spec.colorOf(name, k));
      const ax0 = Math.max(x0, sx - R), ax1 = Math.min(x1, sx + R);
      const ay0 = Math.max(yLo, sy - R), ay1 = Math.min(yHi, sy + R);
      const az0 = Math.max(z0, sz - R), az1 = Math.min(z1, sz + R);
      for (let x = ax0; x <= ax1; x++) {
        const dx = x - sx;
        for (let y = ay0; y <= ay1; y++) {
          const dy = y - sy;
          for (let z = az0; z <= az1; z++) {
            const dz = z - sz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > R2) continue;
            const d = Math.sqrt(d2);
            const w = (1 - d / R1) * (1 - d / R1) * spec.gain;
            if (!out) out = new Map();
            const ck = x + "," + y + "," + z;
            let t = out.get(ck);
            if (!t) { t = [1, 1, 1]; out.set(ck, t); }
            t[0] += w * cr; t[1] += w * cg; t[2] += w * cb;
          }
        }
      }
    }
  }
  if (!out) return null;
  // Overlaps sum (dense groups): clamp so hot spots lift instead of blowing out.
  for (const t of out.values()) {
    if (t[0] > clamp) t[0] = clamp;
    if (t[1] > clamp) t[1] = clamp;
    if (t[2] > clamp) t[2] = clamp;
  }
  return out;
}
